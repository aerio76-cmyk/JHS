// 學習資料庫 patch（supabase/patches/2026-11-07_materials.sql）的權限矩陣與約束測試（PGlite）。
// 角色：匿名、陌生登入者（不在任何名單）、觀看帳號、管理員、super_admin。
// PGlite 測不到 Storage API 本身（簽名網址、bucket 大小與 MIME 限制），那些列在交接檔的使用者實機檢查。
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPGlite, makeDb, run, readSql } = require('./helpers/supabaseStub.js');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = { id: U(1), email: 'parent@example.com' };
const SUPER = { id: U(2), email: 'owner@example.com' };
const VIEWER = { id: U(3), email: 'viewer@example.test' };
const STRANGER = { id: U(4), email: 'stranger@example.test' };
const TWIN = { id: U(5), email: 'parent@example.com' }; // email 與管理員相同，但只有 Email 身分
const GKID = { id: U(6), email: 'kid@example.test' }; // 有 Google 身分、不在白名單

const M1 = 'aaaaaaaa-0000-4000-8000-000000000001'; // 學習中
const M2 = 'aaaaaaaa-0000-4000-8000-000000000002'; // 已學會
const ORPHAN = 'aaaaaaaa-0000-4000-8000-0000000000ff';
const NEW = 'bbbbbbbb-0000-4000-8000-000000000001';

const DENY = /row-level security|permission denied/;
/** 寫入被擋下：被權限擋下（RLS／欄位權限），或 RLS 讓它只影響 0 筆。SQL 寫錯、撞到約束不算 */
function assertNoWrite(r, label) {
  if (r.ok) assert.equal(r.affected, 0, `${label} 應該被擋下（影響了 ${r.affected} 筆）`);
  else assert.match(r.error.message, DENY, `${label} 應該是權限錯誤，實際：${r.error.message}`);
}
/** 讀取成功但 0 筆（被 RLS 濾掉）；出錯不算 */
function assertEmpty(r, label = '') {
  assert.equal(r.ok, true, `${label} 不應出錯：${r.error?.message}`);
  assert.equal(r.rows.length, 0, `${label} 應該是 0 筆`);
}
function assertDenied(r, label, pattern) {
  assert.equal(r.ok, false, `${label} 應該失敗`);
  if (pattern) assert.match(r.error.message, pattern, `${label} 錯誤訊息`);
}

async function seedFixtures(db) {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN.id}', '${ADMIN.email}'), ('${SUPER.id}', '${SUPER.email}'), ('${VIEWER.id}', '${VIEWER.email}'),
      ('${STRANGER.id}', '${STRANGER.email}'), ('${TWIN.id}', '${TWIN.email}'), ('${GKID.id}', '${GKID.email}');
    insert into auth.identities (user_id, provider, identity_data) values
      ('${ADMIN.id}', 'google', '{"email":"${ADMIN.email}"}'),
      ('${SUPER.id}', 'google', '{"email":"${SUPER.email}"}'),
      ('${VIEWER.id}', 'email', '{"email":"${VIEWER.email}"}'),
      ('${STRANGER.id}', 'email', '{"email":"${STRANGER.email}"}'),
      ('${TWIN.id}', 'email', '{"email":"${TWIN.email}"}'),
      ('${GKID.id}', 'google', '{"email":"${GKID.email}"}');
    insert into public.admins (email, role) values ('${ADMIN.email}', 'admin'), ('${SUPER.email}', 'super_admin');
    insert into public.viewers (user_id, label) values ('${VIEWER.id}', '平板');

    insert into public.subjects (code, display_name, sort_order) values ('math', '數學', 1);
    insert into public.students (id, name, enrolled_year) values ('${U(100)}', 'Enisa', 2025);
    insert into public.exam_scores (student_id, grade, semester, exam_type, subject, score) values ('${U(100)}', 1, 1, 1, 'math', 90);
    insert into public.exam_rankings (student_id, grade, semester, exam_type, rank, total_students) values ('${U(100)}', 1, 1, 1, 10, 300);
    insert into public.motivational_quotes (category, content) values ('progress', '加油');

    insert into public.material_folders (parent_id, name)
      select id, '電學' from public.material_folders where name = '理化';
    insert into public.materials (id, folder_id, title, storage_path, thumb_path, is_learned)
      select '${M1}', id, '歐姆定律整理', '${M1}.webp', '${M1}_t.webp', false from public.material_folders where name = '理化';
    insert into public.materials (id, folder_id, title, storage_path, thumb_path, is_learned)
      select '${M2}', id, '串聯與並聯', '${M2}.jpg', '${M2}_t.jpg', true from public.material_folders where name = '電學';
    insert into storage.objects (bucket_id, name) values
      ('materials', '${M1}.webp'), ('materials', '${M1}_t.webp'), ('materials', '${M2}.jpg'), ('materials', '${M2}_t.jpg'),
      ('materials', '${ORPHAN}.webp'), ('avatars', '${U(100)}.webp');
  `);
}

const folderId = async (db, name) => (await db.query('select id from public.material_folders where name = $1', [name])).rows[0].id;
const countRows = async (db, sql) => Number((await db.query(sql)).rows[0].n);

test('學習資料庫 patch', async (t) => {
  if (!(await loadPGlite())) {
    t.skip('沒有安裝 @electric-sql/pglite（npm install 後才會執行資料庫測試）');
    return;
  }

  await t.test('SQL 檔不含看不見的字元（複製貼到 SQL Editor 時會被改掉，造成正規式壞掉）', () => {
    for (const f of ['supabase/patches/2026-11-07_materials.sql', 'supabase/patches/2026-10-19_security_hardening.sql', 'supabase/schema.sql']) {
      const hits = [...readSql(f)].filter((ch) => /[\p{Cf}\p{Zl}\p{Zp}]/u.test(ch)).map((ch) => ch.codePointAt(0).toString(16));
      assert.deepEqual(hits, [], `${f} 含有看不見的字元`);
    }
  });

  await t.test('前置檢查：沒有先套安全強化 patch 就中止', async () => {
    const db = await makeDb({ hardening: false, materials: false });
    await assert.rejects(db.exec(readSql('supabase/patches/2026-11-07_materials.sql')), /2026-10-19_security_hardening\.sql/);
    await db.exec('rollback'); // 中止後連線停在已中止的 transaction（SQL Editor 也一樣），先 rollback
    assert.equal(await countRows(db, `select count(*) n from pg_tables where tablename in ('viewers','materials','material_folders')`), 0, '中止後不應留下任何表');
    await db.close();
  });

  const db = await makeDb();
  await seedFixtures(db);

  await t.test('種子：六個固定分類與預設子資料夾', async () => {
    const top = await db.query('select system_key from public.material_folders where parent_id is null order by sort');
    assert.deepEqual(top.rows.map((r) => r.system_key), ['chinese', 'english', 'math', 'science', 'social', 'other']);
    const subs = await db.query(`select p.system_key, string_agg(f.name, '、' order by f.sort) s from public.material_folders f
      join public.material_folders p on p.id = f.parent_id where p.parent_id is null group by p.system_key order by p.system_key`);
    assert.deepEqual(subs.rows, [{ system_key: 'science', s: '理化、生物、地球科學' }, { system_key: 'social', s: '歷史、地理、公民' }]);
    const b = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'materials'`)).rows[0];
    assert.deepEqual(b, { public: false, file_size_limit: 2097152, allowed_mime_types: ['image/jpeg', 'image/webp'] });
  });

  await t.test('重複執行：不出錯、不重複；家長刪掉的預設子資料夾不會長回來', async () => {
    const before = await db.query(`select
      (select count(*) from public.material_folders) folders,
      (select count(*) from pg_policies) policies,
      (select count(*) from pg_trigger where not tgisinternal) triggers`);
    await db.exec(`delete from public.material_folders where name = '地球科學'`);
    await db.exec(readSql('supabase/patches/2026-11-07_materials.sql'));
    await db.exec(readSql('supabase/patches/2026-11-07_materials.sql'));
    const after = await db.query(`select
      (select count(*) from public.material_folders) folders,
      (select count(*) from pg_policies) policies,
      (select count(*) from pg_trigger where not tgisinternal) triggers`);
    assert.equal(Number(after.rows[0].folders), Number(before.rows[0].folders) - 1);
    assert.equal(after.rows[0].policies, before.rows[0].policies);
    assert.equal(after.rows[0].triggers, before.rows[0].triggers);
    assert.equal(await countRows(db, `select count(*) n from public.material_folders where name = '地球科學'`), 0);
    assert.equal(await countRows(db, `select count(*) n from public.viewers`), 1, 'viewers 名單不受影響');
  });

  await t.test('權限函式：觀看帳號不是管理員，管理員不是觀看帳號', async () => {
    const q = 'select public.is_viewer() v, public.is_admin() a, public.is_super_admin() s';
    assert.deepEqual((await run(db, VIEWER, q)).rows[0], { v: true, a: false, s: false });
    assert.deepEqual((await run(db, ADMIN, q)).rows[0], { v: false, a: true, s: false });
    assert.deepEqual((await run(db, STRANGER, q)).rows[0], { v: false, a: false, s: false });
    assert.deepEqual((await run(db, TWIN, q)).rows[0], { v: false, a: false, s: false }, 'email 與管理員相同但沒有 Google 身分');
  });

  await t.test('匿名：讀寫不到任何學習資料', async () => {
    for (const tbl of ['viewers', 'material_folders', 'materials']) {
      assertDenied(await run(db, null, `select * from public.${tbl}`), `匿名讀 ${tbl}`, /permission denied/);
    }
    assertEmpty(await run(db, null, `select * from storage.objects where bucket_id = 'materials'`));
    assertDenied(await run(db, null, `insert into storage.objects (bucket_id, name) values ('materials', '${NEW}.webp')`), '匿名上傳');
  });

  await t.test('陌生登入者（例如開放註冊期間註冊的人）：讀不到', async () => {
    assertEmpty(await run(db, STRANGER, 'select * from public.material_folders'));
    assertEmpty(await run(db, STRANGER, 'select * from public.materials'));
    assertEmpty(await run(db, STRANGER, `select * from storage.objects where bucket_id = 'materials'`));
    assertDenied(await run(db, STRANGER, 'select * from public.viewers'), '陌生人讀 viewers', /permission denied/);
  });

  await t.test('觀看帳號：看得到資料夾與學習中的圖片，已學會與孤兒檔案看不到', async () => {
    const folders = await run(db, VIEWER, 'select * from public.material_folders');
    assert.equal(folders.rows.length, await countRows(db, 'select count(*) n from public.material_folders'));
    const mats = await run(db, VIEWER, 'select id from public.materials');
    assert.deepEqual(mats.rows.map((r) => r.id), [M1]);
    const files = await run(db, VIEWER, `select name from storage.objects order by name`);
    assert.deepEqual(files.rows.map((r) => r.name), [`${M1}.webp`, `${M1}_t.webp`]);
    assertDenied(await run(db, VIEWER, 'select * from public.viewers'), '觀看帳號讀 viewers', /permission denied/);
    assertEmpty(await run(db, VIEWER, 'select * from public.admins'), '讀不到白名單');
  });

  await t.test('觀看帳號：所有表與兩個 bucket 都寫不進去', async () => {
    const fid = await folderId(db, '理化');
    const cases = [
      ['students insert', `insert into public.students (name, enrolled_year) values ('Hacker', 2025)`],
      ['students update', `update public.students set name = 'Hacker'`],
      ['students delete', 'delete from public.students'],
      ['subjects insert', `insert into public.subjects values ('x', 'x', 9)`],
      ['subjects update', `update public.subjects set display_name = 'x'`],
      ['subjects delete', 'delete from public.subjects'],
      ['exam_scores insert', `insert into public.exam_scores (student_id, grade, semester, exam_type, subject, score) values ('${U(100)}', 1, 1, 2, 'math', 100)`],
      ['exam_scores update', 'update public.exam_scores set score = 100'],
      ['exam_scores delete', 'delete from public.exam_scores'],
      ['exam_rankings insert', `insert into public.exam_rankings (student_id, grade, semester, exam_type, rank, total_students) values ('${U(100)}', 1, 1, 2, 1, 300)`],
      ['exam_rankings update', 'update public.exam_rankings set rank = 1'],
      ['exam_rankings delete', 'delete from public.exam_rankings'],
      ['quotes insert', `insert into public.motivational_quotes (category, content) values ('progress', 'x')`],
      ['quotes update', `update public.motivational_quotes set content = 'x'`],
      ['quotes delete', 'delete from public.motivational_quotes'],
      ['admins insert', `insert into public.admins (email, role) values ('${VIEWER.email}', 'admin')`],
      ['admins delete', 'delete from public.admins'],
      ['viewers insert', `insert into public.viewers (user_id) values ('${STRANGER.id}')`],
      ['viewers delete', 'delete from public.viewers'],
      ['folders insert', `insert into public.material_folders (parent_id, name) values ('${fid}', '偷建')`],
      ['folders update', `update public.material_folders set name = '改名' where name = '理化'`],
      ['folders delete', 'delete from public.material_folders'],
      ['materials insert', `insert into public.materials (folder_id, title, storage_path, thumb_path) values ('${fid}', 'x', '${NEW}.webp', '${NEW}_t.webp')`],
      ['materials update', 'update public.materials set is_learned = true'],
      ['materials delete', 'delete from public.materials'],
      ['materials 檔案 insert', `insert into storage.objects (bucket_id, name) values ('materials', '${NEW}.webp')`],
      ['materials 檔案 update', `update storage.objects set name = '${NEW}.webp' where bucket_id = 'materials'`],
      ['materials 檔案 delete', `delete from storage.objects where bucket_id = 'materials'`],
      ['avatars 檔案 insert', `insert into storage.objects (bucket_id, name) values ('avatars', '${U(100)}.jpg')`],
      ['avatars 檔案 delete', `delete from storage.objects where bucket_id = 'avatars'`],
      ['buckets update', `update storage.buckets set public = true`],
    ];
    for (const [label, sql] of cases) assertNoWrite(await run(db, VIEWER, sql), `觀看帳號 ${label}`);
    // 陌生登入者、有 Google 身分但不在白名單的人、匿名，同樣寫不進去
    for (const [who, name] of [[STRANGER, '陌生人'], [GKID, '非白名單 Google'], [null, '匿名']]) {
      for (const [label, sql] of cases) assertNoWrite(await run(db, who, sql), `${name} ${label}`);
    }
    // 對照組：super_admin 執行同一句會成功，證明上面是權限擋下，不是語句寫錯
    const noControl = new Set(['subjects delete', 'viewers insert', 'viewers delete', 'materials 檔案 update', 'buckets update']);
    for (const [label, sql] of cases) {
      if (noControl.has(label)) continue;
      const c = await run(db, SUPER, sql);
      assert.ok(c.ok && c.affected > 0, `對照組 super_admin ${label} 應成功：${c.error?.message ?? `affected=${c.affected}`}`);
    }
  });

  await t.test('匿名讀頭像不會因為學習資料庫的政策出錯（回歸）', async () => {
    assertEmpty(await run(db, null, `select * from storage.objects where bucket_id = 'avatars'`), '匿名列出 avatars');
    assertEmpty(await run(db, null, 'select * from storage.objects'), '匿名列出全部');
    assertNoWrite(await run(db, null, `delete from storage.objects where bucket_id = 'avatars'`), '匿名刪頭像');
    assertEmpty(await run(db, VIEWER, `select * from storage.objects where bucket_id = 'avatars'`), '觀看帳號列出 avatars');
    assert.equal((await run(db, ADMIN, `select * from storage.objects where bucket_id = 'avatars'`)).rows.length, 1, '管理員看得到頭像');
  });

  await t.test('super_admin：看得到全部圖片（含已學會），但碰不到 viewers', async () => {
    assert.equal((await run(db, SUPER, 'select * from public.materials')).rows.length, 2);
    assertDenied(await run(db, SUPER, 'select * from public.viewers'), 'super_admin 讀 viewers', /permission denied/);
  });

  await t.test('觀看帳號被連上 Google 身分：不會變成管理員，觀看權限也自動失效', async () => {
    // 情境：自動連結把「白名單內管理員的 Google 身分」併進觀看帳號
    await db.exec(`insert into auth.identities (user_id, provider, identity_data) values ('${VIEWER.id}', 'google', '{"email":"${ADMIN.email}"}')`);
    try {
      const q = 'select public.is_viewer() v, public.is_admin() a, public.is_super_admin() s, public.my_google_email() e';
      assert.deepEqual((await run(db, VIEWER, q)).rows[0], { v: false, a: false, s: false, e: null });
      assertEmpty(await run(db, VIEWER, 'select * from public.materials'), '觀看權限失效');
      assertEmpty(await run(db, VIEWER, `select * from storage.objects where bucket_id = 'materials'`), '檔案也讀不到');
      assertNoWrite(await run(db, VIEWER, `update public.students set name = 'Hacker'`), '改學生');
      assertNoWrite(await run(db, VIEWER, `insert into public.admins (email, role) values ('x@example.test', 'admin')`), '加白名單');
      assertEmpty(await run(db, VIEWER, 'select * from public.admins'), '讀白名單');
    } finally {
      await db.exec(`delete from auth.identities where user_id = '${VIEWER.id}' and provider = 'google'`);
    }
    assert.deepEqual((await run(db, VIEWER, 'select public.is_viewer() v')).rows[0], { v: true }, '移除 Google 身分後恢復');
  });

  await t.test('viewers_guard 在 UPDATE 時也會檢查', async () => {
    await assert.rejects(db.query(`update public.viewers set user_id = '${GKID.id}' where user_id = '${VIEWER.id}'`), /Email 以外的登入身分/);
  });

  await t.test('trigger 專用函式不開放執行', async () => {
    const r = await db.query(`select bool_or(has_function_privilege(role, fn, 'execute')) x from
      unnest(array['anon', 'authenticated']) role,
      unnest(array['public.viewers_guard()', 'public.material_folders_depth_guard()', 'public.material_folders_immutable_guard()', 'public.materials_touch_updated_at()']) fn`);
    assert.equal(r.rows[0].x, false);
  });

  await t.test('重跑會套用新的約束定義、授權維持一致', async () => {
    const privs = async () => (await db.query(`select string_agg(grantee || ':' || table_name || ':' || column_name || ':' || privilege_type, ',' order by 1)
      s from information_schema.column_privileges where table_schema = 'public' and table_name in ('materials', 'material_folders', 'viewers')
      and grantee in ('anon', 'authenticated')`)).rows[0].s;
    const before = await privs();
    await db.exec('alter table public.materials drop constraint materials_title_check');
    await db.exec(readSql('supabase/patches/2026-11-07_materials.sql'));
    assert.equal(await countRows(db, `select count(*) n from pg_constraint where conname = 'materials_title_check'`), 1, '約束被補回');
    assert.equal(await privs(), before);
  });

  await t.test('viewers 名單：只能是「只有 Email 身分、email 不同於管理員」的帳號', async () => {
    await assert.rejects(db.query(`insert into public.viewers (user_id) values ('${GKID.id}')`), /Email 以外的登入身分/);
    await assert.rejects(db.query(`insert into public.viewers (user_id) values ('${TWIN.id}')`), /不能和管理員相同/);
    await assert.rejects(db.query(`insert into public.viewers (user_id) values ('${ADMIN.id}')`), /Email 以外的登入身分/);
  });

  await t.test('就算 viewers 被加錯（email 與管理員相同），仍然沒有任何管理權', async () => {
    await db.exec(`alter table public.viewers disable trigger viewers_guard;
      insert into public.viewers (user_id) values ('${TWIN.id}');
      alter table public.viewers enable trigger viewers_guard;`);
    try {
      assert.deepEqual((await run(db, TWIN, 'select public.is_viewer() v, public.is_admin() a')).rows[0], { v: true, a: false });
      assertNoWrite(await run(db, TWIN, `update public.students set name = 'Hacker'`), 'twin 改學生');
      assertNoWrite(await run(db, TWIN, `insert into public.admins (email, role) values ('x@example.test', 'admin')`), 'twin 加白名單');
      assertNoWrite(await run(db, TWIN, `update public.materials set is_learned = false`), 'twin 改圖片');
      assertEmpty(await run(db, TWIN, 'select * from public.admins'), 'twin 讀不到白名單');
    } finally {
      await db.exec(`delete from public.viewers where user_id = '${TWIN.id}'`);
    }
  });

  await t.test('撤銷：刪掉 viewers 的列，下一個請求起就讀不到', async () => {
    await db.exec(`delete from public.viewers where user_id = '${VIEWER.id}'`);
    try {
      assertEmpty(await run(db, VIEWER, 'select * from public.materials'));
      assertEmpty(await run(db, VIEWER, 'select * from public.material_folders'));
      assertEmpty(await run(db, VIEWER, `select * from storage.objects where bucket_id = 'materials'`));
    } finally {
      await db.exec(`insert into public.viewers (user_id, label) values ('${VIEWER.id}', '平板')`);
    }
  });

  await t.test('管理員：資料夾的新增、改名、刪除與限制', async () => {
    const sci = await folderId(db, '自然');
    const phy = await folderId(db, '理化');
    const elec = await folderId(db, '電學');
    const ok = async (sql, label) => { const r = await run(db, ADMIN, sql); assert.ok(r.ok && r.affected === 1, `${label}：${r.error?.message}`); };

    await ok(`insert into public.material_folders (parent_id, name) values ('${sci}', '力與運動')`, '新增第二層');
    await ok(`insert into public.material_folders (parent_id, name) values ('${phy}', '光學')`, '新增第三層');
    assertDenied(await run(db, ADMIN, `insert into public.material_folders (parent_id, name) values ('${elec}', '第四層')`), '第四層', /最多三層/);
    assertDenied(await run(db, ADMIN, `insert into public.material_folders (parent_id, name) values (null, '音樂')`), '新增頂層');
    assertDenied(await run(db, ADMIN, `insert into public.material_folders (parent_id, name, is_system) values ('${sci}', 'x', true)`), '設定 is_system', /permission denied/);
    assertDenied(await run(db, ADMIN, `insert into public.material_folders (parent_id, name, system_key) values ('${sci}', 'x', 'other')`), '設定 system_key', /permission denied/);
    assertNoWrite(await run(db, ADMIN, `update public.material_folders set name = '理科' where id = '${sci}'`), '固定分類改名');
    assertNoWrite(await run(db, ADMIN, `delete from public.material_folders where id = '${sci}'`), '刪除固定分類');
    await ok(`update public.material_folders set name = '物理化學' where id = '${phy}'`, '自訂資料夾改名');
    assertDenied(await run(db, ADMIN, `update public.material_folders set parent_id = '${sci}' where id = '${elec}'`), '移動資料夾（欄位權限）', /permission denied/);
    await assert.rejects(db.query(`update public.material_folders set parent_id = '${sci}' where id = '${elec}'`), /不能移動/, 'SQL Editor 也不能移動');
    await assert.rejects(db.query(`update public.material_folders set is_system = false where id = '${sci}'`), /不能變更固定分類/);
    assertDenied(await run(db, ADMIN, `insert into public.material_folders (parent_id, name) values ('${sci}', '生物')`), '同層重名', /duplicate key/);
    await assert.rejects(db.query(`insert into public.material_folders (name, is_system, system_key) values ('國文', true, 'other')`), /duplicate key/, '頂層重名');
    for (const bad of ['', ' 前後空白 ', '\u3000電學', '電\u200b學', '電\u00ad學', '一二三四五六七八九十一二三四五六七八九十一', 'tab\tname']) {
      assertDenied(await run(db, ADMIN, 'insert into public.material_folders (parent_id, name) values ($1, $2)', [sci, bad]), `名稱「${bad}」`, /material_folders_name_check/);
    }
  });

  await t.test('管理員：刪除自訂資料夾會連同子資料夾與圖片資料列一起刪除', async () => {
    const phy = await folderId(db, '理化');
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ADMIN.id]);
      await tx.exec('set local role authenticated');
      const del = await tx.query(`delete from public.material_folders where id = '${phy}'`);
      assert.equal(del.affectedRows, 1);
      assert.equal(Number((await tx.query('select count(*) n from public.materials')).rows[0].n), 0, '圖片資料列一起刪除');
      assert.equal(Number((await tx.query(`select count(*) n from public.material_folders where name = '電學'`)).rows[0].n), 0, '子資料夾一起刪除');
      assert.equal(Number((await tx.query(`select count(*) n from storage.objects where bucket_id = 'materials'`)).rows[0].n), 5, '檔案不會自動刪（由前端補刪）');
      await tx.rollback();
    });
  });

  await t.test('管理員：圖片資料列的約束', async () => {
    const fid = await folderId(db, '理化');
    const ins = (id, title, sp, tp, grade = null) => run(db, ADMIN,
      'insert into public.materials (id, folder_id, title, storage_path, thumb_path, grade_tag) values ($1, $2, $3, $4, $5, $6)',
      [id, fid, title, sp, tp, grade]);
    const good = await ins(NEW, '新圖片', `${NEW}.webp`, `${NEW}_t.webp`, 2);
    assert.ok(good.ok && good.affected === 1, good.error?.message);
    const jpg = await ins(NEW, 'Safari 改存 jpg', `${NEW}.jpg`, `${NEW}_t.jpg`);
    assert.ok(jpg.ok, jpg.error?.message);
    const bad = [
      ['路徑跳脫', '../x.webp', `${NEW}_t.webp`],
      ['子資料夾路徑', `x/${NEW}.webp`, `${NEW}_t.webp`],
      ['大寫 uuid', `${NEW.toUpperCase()}.webp`, `${NEW}_t.webp`],
      ['png 副檔名', `${NEW}.png`, `${NEW}_t.webp`],
      ['縮圖 uuid 不同', `${NEW}.webp`, `${M1}_t.webp`],
      ['縮圖沒有 _t', `${NEW}.webp`, `${NEW}.jpg`],
    ];
    for (const [label, sp, tp] of bad) assertDenied(await ins(NEW, 'x', sp, tp), label, /check constraint/);
    assertDenied(await ins(NEW, 'x'.repeat(61), `${NEW}.webp`, `${NEW}_t.webp`), '標題 61 字', /materials_title_check/);
    assertDenied(await ins(NEW, '', `${NEW}.webp`, `${NEW}_t.webp`), '空標題', /materials_title_check/);
    assertDenied(await ins(NEW, 'x', `${NEW}.webp`, `${NEW}_t.webp`, 4), '年級 4', /materials_grade_tag_check/);
    assertDenied(await ins(NEW, 'x', `${M1}.webp`, `${M1}_t.webp`), '重複路徑', /duplicate key/);

    await db.exec(`update public.materials set updated_at = '2000-01-01' where id = '${M1}'`);
    const upd = await run(db, ADMIN, `update public.materials set is_learned = true where id = '${M1}' returning updated_at`);
    assert.ok(upd.rows[0].updated_at > new Date('2001-01-01'), 'updated_at 自動更新');
  });

  await t.test('管理員：materials bucket 的檔案（上傳、讀取、刪除；不能覆寫）', async () => {
    const up = (name) => run(db, ADMIN, `insert into storage.objects (bucket_id, name) values ('materials', $1)`, [name]);
    for (const name of [`${NEW}.webp`, `${NEW}_t.jpg`]) { const r = await up(name); assert.ok(r.ok, `${name}：${r.error?.message}`); }
    for (const name of [`${NEW}.png`, `x/${NEW}.webp`, '../evil.webp', `${NEW}.webp.html`]) {
      assertDenied(await up(name), `上傳檔名 ${name}`, /row-level security/);
    }
    assert.equal((await run(db, ADMIN, `select * from storage.objects where bucket_id = 'materials'`)).rows.length, 5, '管理員看得到全部（含孤兒檔案）');
    assert.equal((await run(db, ADMIN, `delete from storage.objects where bucket_id = 'materials' and name = '${ORPHAN}.webp'`)).affected, 1);
    assertNoWrite(await run(db, ADMIN, `update storage.objects set name = '${NEW}.webp' where name = '${M1}.webp'`), '覆寫既有檔案');
    assertDenied(await run(db, ADMIN, 'select * from public.viewers'), '管理員讀 viewers（只能在 SQL Editor 維護）', /permission denied/);
  });

  await db.close();
});
