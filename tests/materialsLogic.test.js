// materialsLogic.js：名稱與標題、資料夾樹、上傳與換圖的失敗補償、並行限制、孤兒檔案
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/materialsLogic.js');

const ch = (cp) => String.fromCharCode(cp);
const ZWSP = ch(0x200b);
const IDEO_SPACE = ch(0x3000);
const SOFT_HYPHEN = ch(0xad);

test('cleanText／validateFolderName：去掉看不見的字元與前後空白（含全形空白）', () => {
  assert.equal(L.cleanText(`  電${ZWSP}學${IDEO_SPACE}`), '電學');
  assert.equal(L.cleanText(`電${SOFT_HYPHEN}學`), '電學');
  assert.equal(L.cleanText('力與\n\t運動'), '力與 運動');
  assert.deepEqual(L.validateFolderName(' 光學 '), { ok: true, value: '光學' });
  assert.match(L.validateFolderName(`${IDEO_SPACE}${ZWSP}`).error, /請輸入/);
  assert.match(L.validateFolderName('一二三四五六七八九十一二三四五六七八九十一').error, /最多 20/);
  assert.equal(L.validateFolderName('一二三四五六七八九十一二三四五六七八九十').ok, true);
  assert.match(L.validateFolderName(`電${ZWSP}學`, ['電學']).error, /已經有「電學」/, '看起來重名也擋');
});

test('validateTitle／titleFromFilename', () => {
  assert.equal(L.validateTitle('x'.repeat(60)).ok, true);
  assert.match(L.validateTitle('x'.repeat(61)).error, /最多 60/);
  assert.equal(L.titleFromFilename('歐姆定律_整理.PNG'), '歐姆定律 整理');
  assert.equal(L.titleFromFilename('.jpg'), '未命名圖片');
  assert.equal(L.titleFromFilename(''), '未命名圖片');
  assert.equal([...L.titleFromFilename('長'.repeat(80) + '.webp')].length, 60);
  assert.equal(L.validateTitle(L.titleFromFilename(`${' '.repeat(5)}a${'b'.repeat(58)} c.jpg`)).ok, true, '截斷後不會留下尾端空白');
});

const FOLDERS = [
  { id: 'sci', parent_id: null, name: '自然', sort: 4, is_system: true, system_key: 'science' },
  { id: 'chi', parent_id: null, name: '國文', sort: 1, is_system: true, system_key: 'chinese' },
  { id: 'phy', parent_id: 'sci', name: '理化', sort: 1, is_system: false },
  { id: 'bio', parent_id: 'sci', name: '生物', sort: 2, is_system: false },
  { id: 'my', parent_id: 'sci', name: '自訂', sort: 0, is_system: false },
  { id: 'ele', parent_id: 'phy', name: '電學', sort: 1, is_system: false },
];

test('buildFolderTree／folderPath／深度與子樹', () => {
  const { roots, byId } = L.buildFolderTree(FOLDERS);
  assert.deepEqual(roots.map((r) => r.id), ['chi', 'sci'], '依 sort 排序');
  assert.deepEqual(byId.get('sci').children.map((c) => c.id), ['my', 'phy', 'bio']);
  assert.deepEqual(L.folderPath(byId, 'ele').map((f) => f.name), ['自然', '理化', '電學']);
  assert.equal(L.folderDepth(byId, 'ele'), 3);
  assert.equal(L.canAddSubfolder(byId, 'phy'), true);
  assert.equal(L.canAddSubfolder(byId, 'ele'), false, '第三層不能再新增');
  assert.equal(L.canAddSubfolder(byId, 'nope'), false);
  assert.deepEqual(L.descendantIds(byId, 'sci').sort(), ['bio', 'ele', 'my', 'phy', 'sci']);
  assert.equal(L.nextSort(byId.get('sci').children), 3);
  assert.equal(L.nextSort([]), 1);
});

test('folderPath：資料異常（環）也不會無窮迴圈', () => {
  const { byId } = L.buildFolderTree([{ id: 'a', parent_id: 'b', name: 'A', sort: 0 }, { id: 'b', parent_id: 'a', name: 'B', sort: 0 }]);
  assert.equal(L.folderPath(byId, 'a').length, 2);
});

test('categoryIcon 與 materialPaths', () => {
  assert.equal(L.categoryIcon('math'), 'assets/materials-icons/math.svg');
  assert.equal(L.categoryIcon('../x'), null);
  const u = '0f0e0d0c-0b0a-4908-8706-050403020100';
  assert.deepEqual(L.materialPaths(u, 'image/webp', 'image/jpeg'), { storage_path: `${u}.webp`, thumb_path: `${u}_t.jpg` });
  assert.throws(() => L.materialPaths('../evil', 'image/webp', 'image/webp'));
});

test('isRetryableError：網路錯誤可重試；權限、格式、大小、重複不行', () => {
  assert.equal(L.isRetryableError({ message: 'Failed to fetch' }), true);
  assert.equal(L.isRetryableError({ message: 'Gateway timeout', status: 504 }), true);
  assert.equal(L.isRetryableError({ message: 'new row violates row-level security policy' }), false);
  assert.equal(L.isRetryableError({ message: 'mime type image/gif is not supported' }), false);
  assert.equal(L.isRetryableError({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }), false);
  assert.equal(L.isRetryableError({ message: 'Failed to fetch', retryable: false }), false);
  assert.equal(L.isRetryableError(null), false);
});

/* ---------- 上傳流程 ---------- */
const UUID = '11111111-2222-4333-8444-555555555555';
function fakeDeps(over = {}) {
  const log = [];
  const deps = {
    process: async () => ({ blob: { type: 'image/webp' }, thumb: { type: 'image/webp' } }),
    uuid: () => UUID,
    upload: async (path) => { log.push(['upload', path]); return {}; },
    remove: async (paths) => { log.push(['remove', ...paths]); return {}; },
    insert: async (row) => { log.push(['insert', row.storage_path]); return { data: { ...row, is_learned: false } }; },
    update: async (id, patch) => { log.push(['update', id, patch.storage_path]); return { data: { id, ...patch } }; },
    onStage: (s) => log.push(['stage', s]),
    ...over,
  };
  return { deps, log };
}

test('uploadMaterial：成功時依序上傳大圖、縮圖、寫資料列', async () => {
  const { deps, log } = fakeDeps();
  const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: '歐姆定律' }, deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.row, { id: UUID, folder_id: 'f1', title: '歐姆定律', storage_path: `${UUID}.webp`, thumb_path: `${UUID}_t.webp`, is_learned: false });
  assert.deepEqual(log.filter((x) => x[0] !== 'stage'), [['upload', `${UUID}.webp`], ['upload', `${UUID}_t.webp`], ['insert', `${UUID}.webp`]]);
  assert.deepEqual(log.filter((x) => x[0] === 'stage').map((x) => x[1]), ['processing', 'uploading', 'saving']);
});

test('uploadMaterial：處理失敗 → 不上傳任何東西、不可重試', async () => {
  const { deps, log } = fakeDeps({ process: async () => { throw Object.assign(new Error('太大'), { userMessage: '太大' }); } });
  const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: 't' }, deps);
  assert.deepEqual([r.ok, r.stage, r.retryable], [false, 'process', false]);
  assert.equal(log.filter((x) => x[0] !== 'stage').length, 0);
});

test('uploadMaterial：大圖上傳失敗 → 沒有東西要清', async () => {
  const { deps, log } = fakeDeps({ upload: async (p) => { log.push(['upload', p]); return { error: { message: 'Failed to fetch' } }; } });
  const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: 't' }, deps);
  assert.deepEqual([r.ok, r.stage, r.retryable], [false, 'upload', true]);
  assert.equal(log.some((x) => x[0] === 'remove'), false);
});

test('uploadMaterial：縮圖上傳失敗 → 刪掉大圖', async () => {
  let n = 0;
  const { deps, log } = fakeDeps({ upload: async (p) => { log.push(['upload', p]); return ++n === 2 ? { error: { message: 'new row violates row-level security policy' } } : {}; } });
  const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: 't' }, deps);
  assert.deepEqual([r.ok, r.retryable], [false, false]);
  assert.deepEqual(log.filter((x) => x[0] === 'remove'), [['remove', `${UUID}.webp`]]);
});

test('uploadMaterial：寫資料列「確定被拒」（權限、約束）→ 兩個檔都刪、不可重試', async () => {
  for (const message of ['new row violates row-level security policy for table "materials"', 'violates check constraint "materials_title_check"']) {
    const { deps, log } = fakeDeps({ insert: async () => ({ error: { message } }), fetchRow: async () => { throw new Error('不該查'); } });
    const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: 't' }, deps);
    assert.deepEqual([r.ok, r.stage, r.retryable], [false, 'save', false]);
    assert.deepEqual(log.filter((x) => x[0] === 'remove'), [['remove', `${UUID}.webp`, `${UUID}_t.webp`]]);
  }
});

test('uploadMaterial：寫入結果不確定，但其實已寫進去 → 當成功，不刪檔、不重複（回歸）', async () => {
  for (const insert of [
    async () => ({ error: { message: 'Failed to fetch' } }),
    async () => { throw new Error('network down'); },
    async () => ({ data: null }),
    async () => ({ error: { message: 'duplicate key value violates unique constraint "materials_pkey"', code: '23505' } }),
  ]) {
    const { deps, log } = fakeDeps({ insert, fetchRow: async (id) => ({ data: { id, title: 't' } }) });
    const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: 't' }, deps);
    assert.equal(r.ok, true);
    assert.equal(r.row.id, UUID);
    assert.equal(log.some((x) => x[0] === 'remove'), false);
  }
});

test('uploadMaterial：寫入結果不確定且確定沒寫進去（或查不到）→ 保留檔案，回傳 resume 讓重試只寫資料列', async () => {
  for (const fetchRow of [async () => ({ data: null }), async () => ({ error: { message: 'Failed to fetch' } })]) {
    const { deps, log } = fakeDeps({ insert: async () => ({ error: { message: 'Failed to fetch' } }), fetchRow });
    const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: 't' }, deps);
    assert.deepEqual([r.ok, r.retryable], [false, true]);
    assert.deepEqual(r.resume, { id: UUID, paths: { storage_path: `${UUID}.webp`, thumb_path: `${UUID}_t.webp` } });
    assert.equal(log.some((x) => x[0] === 'remove'), false, '檔案留著');
  }
});

test('uploadMaterial：用 resume 重試 → 不再壓縮與上傳，沿用同一個 id 寫資料列', async () => {
  const resume = { id: UUID, paths: { storage_path: `${UUID}.webp`, thumb_path: `${UUID}_t.webp` } };
  const { deps, log } = fakeDeps({ process: async () => { throw new Error('不該壓縮'); }, uuid: () => 'other' });
  const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: 't', resume }, deps);
  assert.equal(r.ok, true);
  assert.deepEqual(log.filter((x) => x[0] !== 'stage'), [['insert', `${UUID}.webp`]]);
});

test('uploadMaterial：補償刪檔失敗時回報 cleanupFailed', async () => {
  const { deps } = fakeDeps({ insert: async () => ({ error: { message: 'row-level security' } }), remove: async () => ({ error: { message: 'gone' } }) });
  const r = await L.uploadMaterial({ file: {}, folderId: 'f1', title: 't' }, deps);
  assert.equal(r.cleanupFailed, true);
});

test('isDefiniteRejection：只有權限、約束、外鍵算「確定被拒」', () => {
  assert.equal(L.isDefiniteRejection({ message: 'new row violates row-level security policy' }), true);
  assert.equal(L.isDefiniteRejection({ code: '23514', message: 'x' }), true);
  assert.equal(L.isDefiniteRejection({ message: 'Failed to fetch' }), false);
  assert.equal(L.isDefiniteRejection({ message: 'The operation was aborted' }), false, '不認得的錯誤不算，先查再說');
  assert.equal(L.isDefiniteRejection(null), false);
});

test('replaceMaterialImage：上傳新檔名 → 更新 → 刪舊檔；更新失敗刪新檔、保留舊檔', async () => {
  const row = { id: 'm1', storage_path: 'old.webp', thumb_path: 'old_t.webp' };
  const ok = fakeDeps();
  const r = await L.replaceMaterialImage({ row, file: {} }, ok.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(ok.log, [['upload', `${UUID}.webp`], ['upload', `${UUID}_t.webp`], ['update', 'm1', `${UUID}.webp`], ['remove', 'old.webp', 'old_t.webp']]);

  const bad = fakeDeps({ update: async () => ({ error: { message: 'row-level security' } }), fetchRow: async () => ({ data: { ...row } }) });
  const r2 = await L.replaceMaterialImage({ row, file: {} }, bad.deps);
  assert.equal(r2.ok, false);
  assert.deepEqual(bad.log.filter((x) => x[0] === 'remove'), [['remove', `${UUID}.webp`, `${UUID}_t.webp`]], '只刪新檔，舊檔還在');

  // 更新其實成功、只是回應遺失：重讀發現已指向新檔 → 當成功並刪舊檔（不能刪新檔，否則圖片遺失）
  const lost = fakeDeps({ update: async () => ({ error: { message: 'Failed to fetch' } }), fetchRow: async () => ({ data: { ...row, storage_path: `${UUID}.webp`, thumb_path: `${UUID}_t.webp` } }) });
  const r3 = await L.replaceMaterialImage({ row, file: {} }, lost.deps);
  assert.equal(r3.ok, true);
  assert.deepEqual(lost.log.filter((x) => x[0] === 'remove'), [['remove', 'old.webp', 'old_t.webp']]);

  // 連重讀都失敗：什麼都不刪（交給孤兒清理）
  const unknown = fakeDeps({ update: async () => ({ error: { message: 'Failed to fetch' } }), fetchRow: async () => ({ error: { message: 'Failed to fetch' } }) });
  const r4 = await L.replaceMaterialImage({ row, file: {} }, unknown.deps);
  assert.deepEqual([r4.ok, r4.uncertain], [false, true]);
  assert.equal(unknown.log.some((x) => x[0] === 'remove'), false);

  const leftover = fakeDeps({ remove: async () => ({ error: { message: 'x' } }) });
  assert.equal((await L.replaceMaterialImage({ row, file: {} }, leftover.deps)).oldFilesLeft, true);
});

test('createLimiter：同時執行數不超過上限，全部都會完成', async () => {
  const limit = L.createLimiter(2);
  let active = 0;
  let peak = 0;
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(async () => {
    active++; peak = Math.max(peak, active); await tick(); active--; return n;
  })));
  assert.deepEqual(results, [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  await assert.rejects(limit(async () => { throw new Error('boom'); }), /boom/, '例外會傳回呼叫端');
  assert.equal(await limit(async () => 'still works'), 'still works', '例外後仍可繼續使用');
});

test('uploadMaterial 搭配 limiter：壓縮一次一張、上傳最多兩張', async () => {
  const limits = { process: L.createLimiter(1), upload: L.createLimiter(2) };
  let proc = 0; let procPeak = 0; let up = 0; let upPeak = 0;
  const wait = () => new Promise((r) => setTimeout(r, 3));
  let k = 0;
  const deps = {
    process: async () => { proc++; procPeak = Math.max(procPeak, proc); await wait(); proc--; return { blob: { type: 'image/jpeg' }, thumb: { type: 'image/jpeg' } }; },
    uuid: () => `11111111-2222-4333-8444-${String(++k).padStart(12, '0')}`,
    upload: async () => { up++; upPeak = Math.max(upPeak, up); await wait(); up--; return {}; },
    remove: async () => ({}),
    insert: async (row) => ({ data: row }),
  };
  let pending = 0; let pendingPeak = 0; // 已壓好、還沒寫完資料列的張數（＝記憶體裡的 blob）
  const origProcess = deps.process;
  deps.process = async () => { const r = await origProcess(); pending++; pendingPeak = Math.max(pendingPeak, pending); return r; };
  deps.insert = async (row) => { pending--; return { data: row }; };
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => L.uploadMaterial({ file: {}, folderId: 'f', title: 't' }, deps, limits)));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(procPeak, 1);
  assert.ok(upPeak <= 2, `同時上傳最多兩張（實際 ${upPeak}）`);
  assert.ok(pendingPeak <= 2, `壓好待上傳的圖最多兩張，不會一路堆在記憶體（實際 ${pendingPeak}）`);
  assert.equal(new Set(rs.map((r) => r.row.id)).size, 6);
});

/* ---------- 刪除與孤兒 ---------- */
test('collectFolderFiles：整個子樹的圖片檔案路徑', () => {
  const { byId } = L.buildFolderTree(FOLDERS);
  const mats = [
    { folder_id: 'phy', storage_path: 'a.webp', thumb_path: 'a_t.webp' },
    { folder_id: 'ele', storage_path: 'b.jpg', thumb_path: 'b_t.jpg' },
    { folder_id: 'bio', storage_path: 'c.webp', thumb_path: 'c_t.webp' },
  ];
  assert.deepEqual(L.collectFolderFiles(byId, 'phy', mats), { count: 2, folderCount: 2, paths: ['a.webp', 'a_t.webp', 'b.jpg', 'b_t.jpg'] });
});

test('findOrphans：沒有對應資料列、且建立超過 24 小時的檔案', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const files = [
    { name: 'a.webp', created_at: '2026-11-01T00:00:00Z' },
    { name: 'a_t.webp', created_at: '2026-11-01T00:00:00Z' },
    { name: 'orphan.webp', created_at: '2026-11-05T10:00:00Z' },
    { name: 'uploading.webp', created_at: '2026-11-07T11:50:00Z' },
    { name: 'yesterday.webp', created_at: '2026-11-06T18:00:00Z' },
    { name: 'no-date.webp' },
  ];
  const mats = [{ storage_path: 'a.webp', thumb_path: 'a_t.webp' }];
  assert.deepEqual(L.findOrphans(files, mats, now).map((f) => f.name), ['orphan.webp']);
});

test('findOrphans：這台裝置時鐘快很多時，以伺服器時間（最新檔案）為準，不會誤刪上傳中的檔案', () => {
  const fastClock = Date.parse('2026-11-20T00:00:00Z'); // 本機時鐘快了將近兩週
  const files = [
    { name: 'uploading.webp', created_at: '2026-11-07T11:50:00Z' },
    { name: 'old.webp', created_at: '2026-11-01T00:00:00Z' },
  ];
  assert.deepEqual(L.findOrphans(files, [], fastClock).map((f) => f.name), ['old.webp']);
});

test('cleanText：內文的全形空白保留、孤立代理字元去掉', () => {
  assert.equal(L.cleanText(`第一章${IDEO_SPACE}數列`), `第一章${IDEO_SPACE}數列`);
  assert.equal(L.cleanText(`a${String.fromCharCode(0xd800)}b`), 'ab');
  assert.equal(L.cleanText(`😀 ok`), '😀 ok', '正常的 emoji（成對代理字元）保留');
});

test('formatBytes／uploadSummary', () => {
  assert.equal(L.formatBytes(500 * 1024), '500 KB');
  assert.equal(L.formatBytes(15.4 * 1048576), '15.4 MB');
  assert.equal(L.uploadSummary([{ status: 'done' }, { status: 'done' }, { status: 'uploading' }, { status: 'failed' }]), '4 張中：2 張完成、1 張處理中、1 張沒有上傳');
});
