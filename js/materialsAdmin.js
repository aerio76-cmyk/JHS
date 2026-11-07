// entry.html「學習資料」：資料夾管理、批次上傳（壓縮＋縮圖）、改標題、移動、換圖、已學會、永久刪除、孤兒檔案清理。
// 依賴：entry.js 的 h／messageArea／describeError／setBusy、materialsLogic.js、imageLogic.js、backupLogic.js 的 fetchAllRows。
// 安全：標題與資料夾名稱一律 textContent；寫入一律 insert／update（不用 upsert）；檔案刪除一律走 Storage API。
// 權限真正的把關在 RLS 與 Storage 政策（supabase/patches/2026-11-07_materials.sql）。

const MAT_BUCKET = 'materials';
const MAT_THUMB_URL_TTL = 300; // 家長端縮圖用短效簽名網址（秒）；孩子端不用簽名網址（規劃書 9.4）

const mat = {
  folders: [],
  tree: null, // { roots, byId }
  materials: [],
  current: null, // 目前資料夾 id
  filter: 'all', // all | active | learned
  urls: new Map(), // path → { url, exp }
  uploads: [], // { key, file, title, folderId, status, text, pct, retryable }
  usage: null, // { files, bytes }
  msg: null,
  openMenu: null,
  loading: null, // 首次載入的 promise（避免載入中又切換路由）
  renderToken: 0, // 縮圖格只套用最新一次的結果
  previewToken: 0,
};

const matDb = () => sbClient.from('materials');
const folderDb = () => sbClient.from('material_folders');
const bucket = () => sbClient.storage.from(MAT_BUCKET);

/* ================= 讀取 ================= */
async function loadMaterialsData() {
  const [f, m] = await Promise.all([
    folderDb().select('id, parent_id, name, sort, is_system, system_key'),
    fetchAllRows((from, to) => matDb()
      .select('id, folder_id, title, grade_tag, storage_path, thumb_path, is_learned, created_at, updated_at')
      .order('created_at', { ascending: false }).order('id').range(from, to)),
  ]);
  if (f.error) throw f.error;
  mat.folders = f.data;
  mat.materials = m;
  mat.tree = buildFolderTree(mat.folders);
  if (!mat.current || !mat.tree.byId.has(mat.current)) mat.current = mat.tree.roots[0]?.id ?? null;
}

async function listAllFiles() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket().list('', { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    out.push(...data.filter((x) => x.id)); // 只要檔案（資料夾項目沒有 id）
    if (data.length < 1000) return out;
  }
}

async function refreshUsage() {
  try {
    const files = await listAllFiles();
    mat.usage = { files, bytes: files.reduce((s, x) => s + (Number(x.metadata?.size) || 0), 0) };
  } catch (error) {
    console.error(error);
    mat.usage = null;
  }
  renderUsage();
}

// 縮圖網址：短效簽名網址，批次取得並快取到快過期
async function signedUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => !(mat.urls.get(p)?.exp > now + 60_000));
  if (need.length) {
    const { data, error } = await bucket().createSignedUrls(need, MAT_THUMB_URL_TTL);
    if (error) console.error(error);
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) mat.urls.set(item.path, { url: item.signedUrl, exp: now + MAT_THUMB_URL_TTL * 1000 });
    }
  }
  return (p) => mat.urls.get(p)?.url ?? null;
}

/* ================= 畫面：資料夾樹 ================= */
const deepCount = (id) => {
  const ids = new Set(descendantIds(mat.tree.byId, id));
  return mat.materials.filter((m) => ids.has(m.folder_id)).length;
};

function folderIconImg(folder, size) {
  const root = folderPath(mat.tree.byId, folder.id)[0];
  const src = categoryIcon(root?.system_key);
  return src ? h('img', { src, alt: '', width: String(size), height: String(size) }) : null;
}

function renderTree() {
  const treeEl = document.getElementById('matTree');
  const node = (f) => {
    const link = h('a', { class: 'tree__link', href: `#/materials/${f.id}` },
      f.parent_id ? h('span', { 'aria-hidden': 'true', text: '📁' }) : folderIconImg(f, 28),
      h('span', { text: f.name }),
      h('small', {}, String(deepCount(f.id)), h('span', { class: 'visually-hidden', text: ' 張' })));
    if (f.id === mat.current) link.setAttribute('aria-current', 'true');
    const li = h('li', {}, h('div', { class: 'tree__row' }, link));
    if (f.children.length) li.append(h('ul', {}, ...f.children.map(node)));
    return li;
  };
  treeEl.replaceChildren(...mat.tree.roots.map(node));
}

/* ================= 畫面：目前資料夾 ================= */
function renderFolderHead() {
  const f = mat.tree.byId.get(mat.current);
  const path = folderPath(mat.tree.byId, mat.current);
  document.getElementById('matCrumbs').replaceChildren(...path.map((p, i) => h('li', {},
    i === path.length - 1 ? h('span', { 'aria-current': 'page', text: p.name }) : h('a', { href: `#/materials/${p.id}`, text: p.name }))));
  const icon = folderIconImg(f, 56);
  document.getElementById('matFolderIcon').replaceChildren(...(icon ? [icon] : []));
  document.getElementById('matFolderTitle').textContent = f.name;
  const canAdd = canAddSubfolder(mat.tree.byId, f.id);
  document.getElementById('matNewFolderBtn').disabled = !canAdd;
  document.getElementById('matRenameFolderBtn').hidden = f.is_system;
  document.getElementById('matDeleteFolderBtn').hidden = f.is_system;
  const notes = [];
  if (f.is_system) notes.push('六大分類是固定的，不能改名或刪除；可以在底下新增子資料夾。');
  if (!canAdd) notes.push('這裡已經是第三層，不能再往下新增資料夾。');
  const note = document.getElementById('matFolderNote');
  note.textContent = notes.join('');
  note.hidden = !notes.length;
}

async function renderThumbs() {
  const all = mat.materials.filter((m) => m.folder_id === mat.current);
  const list = all.filter((m) => mat.filter === 'all' || (mat.filter === 'learned' ? m.is_learned : !m.is_learned));
  document.getElementById('matImgCount').textContent = `${all.length} 張（已學會 ${all.filter((m) => m.is_learned).length}）`;
  document.querySelectorAll('[data-mat-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.matFilter === mat.filter)));
  const grid = document.getElementById('matThumbs');
  document.getElementById('matThumbsEmpty').hidden = list.length > 0;
  const token = ++mat.renderToken;
  const urlOf = list.length ? await signedUrls(list.map((m) => m.thumb_path)) : () => null;
  if (token !== mat.renderToken) return; // 快速切換時，晚回來的舊結果不蓋掉新畫面
  const hadFocus = grid.contains(document.activeElement) ? document.activeElement.closest('.thumb')?.dataset.id : null;
  grid.replaceChildren(...list.map((m) => thumbItem(m, urlOf(m.thumb_path))));
  if (hadFocus) focusThumb(hadFocus);
}

// 動作完成後把焦點還給那張圖的「⋯」按鈕（格子重建後要用 id 找回新節點）
function focusThumb(id) {
  const li = document.querySelector(`#matThumbs .thumb[data-id="${CSS.escape(id)}"]`);
  const target = li?.querySelector('.thumb__menu');
  if (target) target.focus();
}

function thumbItem(m, url) {
  const img = url ? h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'thumb__missing', text: '縮圖讀不到' });
  if (url) {
    // 簽名網址過期（停在頁面很久才捲到）時重新簽一次
    img.addEventListener('error', async () => {
      if (img.dataset.retried) return;
      img.dataset.retried = '1';
      mat.urls.delete(m.thumb_path);
      const fresh = (await signedUrls([m.thumb_path]))(m.thumb_path);
      if (fresh) img.src = fresh;
    });
  }
  const btn = h('button', { type: 'button', class: 'thumb__btn', 'aria-label': `預覽：${m.title}` }, img);
  btn.addEventListener('click', () => openPreview(m));
  const menuBtn = h('button', {
    type: 'button', class: 'icon-btn thumb__menu', 'aria-label': `「${m.title}」的操作`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', text: '⋯',
  });
  const li = h('li', { class: `thumb thumb--admin${m.is_learned ? ' thumb--learned' : ''}`, 'data-id': m.id }, btn);
  if (m.is_learned) li.append(h('span', { class: 'badge-learned', text: '✓ 已學會' }));
  const meta = [m.grade_tag ? ['', '國一', '國二', '國三'][m.grade_tag] : '', `${new Date(m.created_at).getMonth() + 1}/${new Date(m.created_at).getDate()} 新增`].filter(Boolean);
  li.append(menuBtn, h('span', { class: 'thumb__title', text: m.title }), h('span', { class: 'thumb__meta', text: meta.join('・') }));
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(li, menuBtn, m); });
  return li;
}

function renderUsage() {
  const el = document.getElementById('matUsage');
  const n = mat.materials.length;
  if (!mat.usage) {
    el.textContent = `目前 ${n} 張。`;
    return;
  }
  const pct = Math.min(100, (mat.usage.bytes / (1024 ** 3)) * 100);
  document.getElementById('matUsageBar').style.width = `${Math.max(pct, 0.5)}%`;
  document.getElementById('matUsageMeter').setAttribute('aria-label', `已使用約 ${pct.toFixed(1)}%`);
  el.textContent = `目前 ${n} 張，檔案約 ${formatBytes(mat.usage.bytes)}／免費額度 1 GB`;
}

function renderMaterials() {
  if (!mat.tree || !mat.current) return;
  renderTree();
  renderFolderHead();
  renderThumbs();
  renderUsage();
}

/* ================= 圖片操作選單 ================= */
function closeMenu() {
  if (!mat.openMenu) return;
  mat.openMenu.menu.remove();
  mat.openMenu.btn.setAttribute('aria-expanded', 'false');
  mat.openMenu = null;
}

function toggleMenu(li, btn, m) {
  const same = mat.openMenu?.btn === btn;
  closeMenu();
  if (same) return;
  const items = [
    ['✎ 編輯標題與年級', () => openEditDialog(m)],
    ['↪ 移動到…', () => openMoveDialog(m)],
    ['⟳ 換圖', () => openReplace(m)],
    [m.is_learned ? '↺ 取消已學會（給孩子看）' : '✓ 標為已學會（孩子端隱藏）', () => toggleLearned(m)],
    null,
    ['🗑 永久刪除', () => openDeleteImage(m), 'danger'],
  ];
  const menu = h('ul', { class: 'menu', role: 'menu', 'aria-label': `「${m.title}」的操作` });
  for (const it of items) {
    if (!it) { menu.append(h('li', { role: 'none' }, h('hr'))); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', class: it[2] || '', text: it[0] });
    b.addEventListener('click', async () => {
      btn.focus(); // 先把焦點放回「⋯」，選單移除後焦點不會掉到頁首
      closeMenu();
      await it[1]();
      if (!document.activeElement || document.activeElement === document.body) focusThumb(m.id);
    });
    menu.append(h('li', { role: 'none' }, b));
  }
  menu.addEventListener('keydown', (e) => {
    const bs = [...menu.querySelectorAll('button')];
    const i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
    if (e.key === 'Escape') { closeMenu(); btn.focus(); }
    if (e.key === 'Tab') closeMenu();
  });
  li.append(menu);
  btn.setAttribute('aria-expanded', 'true');
  mat.openMenu = { menu, btn };
  menu.querySelector('button').focus();
}

/* ================= 對話框共用 ================= */
// 開啟 <dialog>，回傳使用者按下的值（ok／cancel）
function runDialog(id, { onOpen, validate } = {}) {
  const dlg = document.getElementById(id);
  const err = dlg.querySelector('.msg--error');
  if (err) err.textContent = '';
  dlg.returnValue = ''; // 按 Esc 關閉時不會沿用上一次的「確定」
  onOpen?.(dlg);
  dlg.showModal();
  return new Promise((resolve) => {
    const form = dlg.querySelector('form');
    const onSubmit = (e) => {
      if (e.submitter?.value === 'ok' && validate) {
        const msg = validate(dlg);
        if (msg) { e.preventDefault(); if (err) err.textContent = msg; return; }
      }
    };
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('close', () => {
      form.removeEventListener('submit', onSubmit);
      resolve(dlg.returnValue === 'ok');
    }, { once: true });
  });
}

// 學習資料專用的錯誤說明：資料已被刪除、名稱重複講清楚，其餘沿用 describeError
function matError(error, action) {
  const raw = `${error?.message ?? ''} ${error?.code ?? ''}`;
  if (/NO_ROWS|PGRST116/.test(raw)) return `${action}失敗：找不到這筆資料，可能已在別處刪除。請重新整理頁面。`;
  if (/23505|duplicate/i.test(raw)) return `${action}失敗：同一層已經有同名的資料夾，請換一個名稱。`;
  return describeError(error, action);
}

const singleRow = (res) => (res.error ? res : (Array.isArray(res.data) && res.data.length ? { data: res.data[0] } : { error: NO_ROWS }));

/* ================= 資料夾：新增、改名、刪除 ================= */
async function addFolder() {
  const parent = mat.tree.byId.get(mat.current);
  let value = '';
  const ok = await runDialog('matDlgFolder', {
    onOpen: (dlg) => {
      dlg.querySelector('h2').textContent = '新增子資料夾';
      dlg.querySelector('[data-where]').textContent = `新增在「${folderPath(mat.tree.byId, parent.id).map((f) => f.name).join('／')}」底下。`;
      const input = dlg.querySelector('input');
      input.value = '';
      dlg.querySelector('button[value="ok"]').textContent = '新增';
    },
    validate: (dlg) => {
      const v = validateFolderName(dlg.querySelector('input').value, parent.children.map((c) => c.name));
      value = v.value;
      return v.ok ? '' : v.error;
    },
  });
  if (!ok) return;
  const res = singleRow(await folderDb().insert({ parent_id: parent.id, name: value, sort: nextSort(parent.children) }).select('id'));
  if (res.error) return mat.msg.error(matError(res.error, '新增資料夾'));
  await reloadAndRender(res.data.id);
  mat.msg.ok(`已新增資料夾「${value}」。`);
}

async function renameFolder() {
  const f = mat.tree.byId.get(mat.current);
  const parent = f.parent_id ? mat.tree.byId.get(f.parent_id) : null;
  let value = '';
  const ok = await runDialog('matDlgFolder', {
    onOpen: (dlg) => {
      dlg.querySelector('h2').textContent = '資料夾改名';
      dlg.querySelector('[data-where]').textContent = '';
      dlg.querySelector('input').value = f.name;
      dlg.querySelector('button[value="ok"]').textContent = '儲存';
    },
    validate: (dlg) => {
      const v = validateFolderName(dlg.querySelector('input').value, (parent?.children ?? []).filter((c) => c.id !== f.id).map((c) => c.name));
      value = v.value;
      return v.ok ? '' : v.error;
    },
  });
  if (!ok || value === f.name) return;
  const res = singleRow(await folderDb().update({ name: value }).eq('id', f.id).select('id'));
  if (res.error) return mat.msg.error(matError(res.error, '資料夾改名'));
  await reloadAndRender(f.id);
  mat.msg.ok(`已改名為「${value}」。`);
}

// 先收集路徑 → 刪資料列（子資料夾與圖片資料列由資料庫連帶刪除）→ 再走 Storage API 刪檔
async function deleteFolder() {
  const f = mat.tree.byId.get(mat.current);
  const files = collectFolderFiles(mat.tree.byId, f.id, mat.materials);
  const subs = files.folderCount - 1;
  const ok = await runDialog('matDlgDelFolder', {
    onOpen: (dlg) => {
      dlg.querySelector('[data-fname]').textContent = f.name;
      dlg.querySelector('[data-body]').textContent = files.count || subs
        ? `裡面有 ${subs ? `${subs} 個子資料夾、` : ''}${files.count} 張圖片，會連同資料夾一起刪除。`
        : '這個資料夾是空的。';
      dlg.querySelector('button[value="ok"]').textContent = files.count ? `刪除資料夾和 ${files.count} 張圖片` : '刪除資料夾';
      requestAnimationFrame(() => dlg.querySelector('button[value="cancel"]').focus());
    },
  });
  if (!ok) return;
  // 確認後重新向伺服器讀一次（對話框開著時可能有新上傳的圖、或別台裝置新增的資料），再計算要刪的檔案
  try {
    await loadMaterialsData();
  } catch (error) {
    return mat.msg.error(matError(error, '刪除資料夾'));
  }
  if (!mat.tree.byId.has(f.id)) return reloadAndRender(f.parent_id);
  const fresh = collectFolderFiles(mat.tree.byId, f.id, mat.materials);
  const res = singleRow(await folderDb().delete().eq('id', f.id).select('id'));
  if (res.error) return mat.msg.error(matError(res.error, '刪除資料夾'));
  const left = await removeFiles(fresh.paths);
  await reloadAndRender(f.parent_id);
  mat.msg.ok(left ? `已刪除資料夾；有 ${left} 個檔案沒刪掉，可以之後用「檢查多餘的檔案」清理。` : `已刪除資料夾「${f.name}」。`);
}

// 分批刪檔，回傳沒刪成功的數量
async function removeFiles(paths) {
  let failed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await bucket().remove(chunk);
    if (error) { console.error(error); failed += chunk.length; }
  }
  for (const p of paths) mat.urls.delete(p);
  return failed;
}

/* ================= 圖片：編輯、移動、已學會、刪除、換圖、預覽 ================= */
function patchLocal(row) {
  const i = mat.materials.findIndex((m) => m.id === row.id);
  if (i >= 0) mat.materials[i] = { ...mat.materials[i], ...row };
}

async function updateMaterial(m, patch, action) {
  const res = singleRow(await matDb().update(patch).eq('id', m.id).select('id, folder_id, title, grade_tag, storage_path, thumb_path, is_learned, created_at, updated_at'));
  if (res.error) { mat.msg.error(matError(res.error, action)); return null; }
  patchLocal(res.data);
  return res.data;
}

async function openEditDialog(m) {
  let value = '';
  let grade = null;
  const ok = await runDialog('matDlgEdit', {
    onOpen: (dlg) => {
      dlg.querySelector('#matEditTitle').value = m.title;
      dlg.querySelector('#matEditGrade').value = m.grade_tag ? String(m.grade_tag) : '';
    },
    validate: (dlg) => {
      const v = validateTitle(dlg.querySelector('#matEditTitle').value);
      value = v.value;
      grade = dlg.querySelector('#matEditGrade').value ? Number(dlg.querySelector('#matEditGrade').value) : null;
      return v.ok ? '' : v.error;
    },
  });
  if (!ok) return;
  if (await updateMaterial(m, { title: value, grade_tag: grade }, '儲存')) {
    await renderThumbs();
    focusThumb(m.id);
    mat.msg.ok('已儲存。');
  }
}

async function openMoveDialog(m) {
  let target = null;
  const ok = await runDialog('matDlgMove', {
    onOpen: (dlg) => {
      dlg.querySelector('[data-ititle]').textContent = m.title;
      const sel = dlg.querySelector('select');
      const opts = [];
      const add = (list, depth) => list.forEach((f) => {
        opts.push(h('option', { value: f.id, text: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${f.name}` }));
        add(f.children, depth + 1);
      });
      add(mat.tree.roots, 0);
      sel.replaceChildren(...opts);
      sel.value = m.folder_id;
    },
    validate: (dlg) => { target = dlg.querySelector('select').value; return ''; },
  });
  if (!ok || !target || target === m.folder_id) return;
  if (await updateMaterial(m, { folder_id: target }, '移動')) {
    renderTree();
    renderThumbs();
    mat.msg.ok(`已移動到「${mat.tree.byId.get(target)?.name ?? ''}」。`);
  }
}

async function toggleLearned(m) {
  const next = !m.is_learned;
  if (await updateMaterial(m, { is_learned: next }, '更新')) {
    await renderThumbs();
    focusThumb(m.id);
    mat.msg.ok(next ? `「${m.title}」已標為已學會，孩子端不再顯示。` : `「${m.title}」已取消已學會，孩子端會再顯示。`);
  }
}

async function openDeleteImage(m) {
  const ok = await runDialog('matDlgDelImage', {
    onOpen: (dlg) => {
      dlg.querySelector('[data-ititle]').textContent = m.title;
      requestAnimationFrame(() => dlg.querySelector('button[value="cancel"]').focus());
    },
  });
  if (!ok) return;
  const res = singleRow(await matDb().delete().eq('id', m.id).select('id'));
  if (res.error) return mat.msg.error(matError(res.error, '刪除'));
  const left = await removeFiles([m.storage_path, m.thumb_path]);
  mat.materials = mat.materials.filter((x) => x.id !== m.id);
  renderMaterials();
  refreshUsage();
  mat.msg.ok(left ? '已刪除；檔案沒刪乾淨，可以之後用「檢查多餘的檔案」清理。' : `已永久刪除「${m.title}」。`);
}

function materialDeps() {
  return {
    process: (file) => processMaterialImage(file),
    uuid: () => crypto.randomUUID(),
    upload: (path, blob) => bucket().upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '3600' }),
    remove: (paths) => bucket().remove(paths),
    insert: async (row) => singleRow(await matDb().insert(row).select('id, folder_id, title, grade_tag, storage_path, thumb_path, is_learned, created_at, updated_at')),
    fetchRow: async (id) => matDb().select('id, folder_id, title, grade_tag, storage_path, thumb_path, is_learned, created_at, updated_at').eq('id', id).maybeSingle(),
    update: async (id, patch) => singleRow(await matDb().update(patch).eq('id', id).select('id, folder_id, title, grade_tag, storage_path, thumb_path, is_learned, created_at, updated_at')),
  };
}

function openReplace(m) {
  const input = document.getElementById('matReplaceFile');
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    mat.msg.ok(`正在換圖：「${m.title}」…`);
    const r = await replaceMaterialImage({ row: m, file }, materialDeps());
    if (!r.ok) {
      if (r.uncertain) return mat.msg.error('換圖時連線中斷，無法確認是否完成。請重新整理頁面確認；多出來的檔案可以之後用「檢查多餘的檔案」清理。');
      return mat.msg.error(r.error?.userMessage || matError(r.error, '換圖'));
    }
    for (const p of [m.storage_path, m.thumb_path]) mat.urls.delete(p);
    patchLocal(r.row);
    renderThumbs();
    refreshUsage();
    mat.msg.ok(r.oldFilesLeft ? '已換圖；舊檔案沒刪乾淨，可以之後清理。' : `已換圖：「${m.title}」。`);
  };
  input.click();
}

async function openPreview(m) {
  const dlg = document.getElementById('matDlgPreview');
  dlg.querySelector('h2').textContent = m.title;
  const box = dlg.querySelector('[data-img]');
  box.replaceChildren(h('p', { class: 'hint', text: '載入中…' }));
  dlg.showModal();
  const token = ++mat.previewToken;
  const urlOf = await signedUrls([m.storage_path]);
  if (token !== mat.previewToken) return; // 換看別張時，前一張晚回來的網址不蓋掉
  const url = urlOf(m.storage_path);
  box.replaceChildren(url ? h('img', { src: url, alt: m.title }) : h('p', { class: 'msg msg--error', text: '圖片讀不到。' }));
}

/* ================= 批次上傳 ================= */
const limits = { process: createLimiter(1), upload: createLimiter(2) };
const STAGE_TEXT = { processing: '壓縮中…', uploading: '上傳中…', saving: '儲存中…' };

function queueFiles(files, { pasted = false } = {}) {
  if (!files.length) return;
  setUploadOpen(true);
  const folderId = mat.current;
  const stamp = new Date();
  for (const file of files) {
    const title = pasted
      ? `貼上的圖片 ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`
      : titleFromFilename(file.name);
    const item = { key: crypto.randomUUID(), file, title, folderId, status: 'waiting', text: '等待中', retryable: false };
    mat.uploads.push(item);
    runUpload(item);
  }
  renderUploads({ summary: true });
}

async function runUpload(item) {
  item.status = 'waiting';
  item.text = '等待中';
  renderUploads();
  const deps = { ...materialDeps(), onStage: (st) => { item.status = st; item.text = STAGE_TEXT[st]; renderUploads(); } };
  let r;
  try {
    r = await uploadMaterial({ file: item.file, folderId: item.folderId, title: item.title, resume: item.resume }, deps, limits);
  } catch (error) {
    r = { ok: false, retryable: false, error }; // 非預期的例外也要結束這一張，不能卡在處理中
  }
  if (r.ok) {
    item.status = 'done';
    item.text = '完成';
    item.resume = null;
    mat.materials = [r.row, ...mat.materials.filter((x) => x.id !== r.row.id)];
    if (r.row.folder_id === mat.current) renderThumbs();
    renderTree();
  } else {
    item.status = 'failed';
    item.retryable = r.retryable;
    item.resume = r.resume ?? null; // 檔案已上傳、只差寫資料列：重試時沿用同一個 id，不會重複
    item.text = r.error?.userMessage
      || (r.retryable ? '上傳失敗：網路不穩，可以按「重試」' : `沒有上傳：${matError(r.error, '上傳').replace(/^上傳失敗：/, '')}`);
    if (r.cleanupFailed) item.text += '（有檔案沒清乾淨，可以之後清理）';
    if (!r.error?.userMessage) console.error(r.error); // 檔案格式、大小等是使用者端的正常情況，只顯示不記錯誤
  }
  renderUploads({ summary: true });
  if (!mat.uploads.some((u) => !['done', 'failed'].includes(u.status))) refreshUsage();
}

// summary：只在加入與每張結束時更新摘要（role=status），避免每換一個階段就被報讀
function renderUploads({ summary = false } = {}) {
  const list = document.getElementById('matUploadList');
  list.replaceChildren(...mat.uploads.map((u) => {
    const cls = u.status === 'done' ? ' upload-item__status--ok' : u.status === 'failed' ? ' upload-item__status--err' : '';
    const mark = u.status === 'done' ? '✓ ' : u.status === 'failed' ? '✕ ' : '';
    const mid = h('div', {}, h('div', { class: 'upload-item__name', text: u.file.name || u.title }), h('div', { class: `upload-item__status${cls}`, text: mark + u.text }));
    let action = h('span');
    if (u.status === 'failed' && u.retryable) {
      action = h('button', { type: 'button', class: 'btn', text: '重試', 'aria-label': `重試「${u.file.name || u.title}」` });
      action.addEventListener('click', () => runUpload(u));
    }
    return h('li', { class: 'upload-item' }, h('span', { class: 'upload-item__dot', 'aria-hidden': 'true' }), mid, action);
  }));
  if (summary) document.getElementById('matUploadSummary').textContent = mat.uploads.length ? uploadSummary(mat.uploads) : '';
  const retry = mat.uploads.filter((u) => u.status === 'failed' && u.retryable);
  const retryAll = document.getElementById('matRetryAll');
  retryAll.hidden = !retry.length;
  retryAll.textContent = `重試失敗的 ${retry.length} 張`;
}

function setUploadOpen(open) {
  document.getElementById('matUploadPanel').hidden = !open;
  const t = document.getElementById('matUploadToggle');
  t.setAttribute('aria-expanded', String(open));
  t.textContent = open ? '收起上傳' : '上傳圖片';
}

/* ================= 多餘檔案（孤兒）清理 ================= */
async function checkOrphans() {
  const btn = document.getElementById('matOrphanBtn');
  setBusy(btn, true, '檢查中…');
  try {
    if (mat.uploads.some((u) => !['done', 'failed'].includes(u.status))) {
      return mat.msg.error('還有圖片正在上傳，等上傳完成再檢查。');
    }
    await reloadAndRender(mat.current);
    const files = await listAllFiles();
    const candidates = findOrphans(files, mat.materials);
    // 刪除前再向資料庫複核一次：分頁讀取期間若有變動，仍有資料列引用的檔案一律不刪
    const stillUsed = new Set();
    for (let i = 0; i < candidates.length; i += 100) {
      const names = candidates.slice(i, i + 100).map((x) => x.name);
      const [byMain, byThumb] = await Promise.all([
        matDb().select('storage_path').in('storage_path', names),
        matDb().select('thumb_path').in('thumb_path', names),
      ]);
      if (byMain.error || byThumb.error) throw byMain.error || byThumb.error;
      byMain.data.forEach((r) => stillUsed.add(r.storage_path));
      byThumb.data.forEach((r) => stillUsed.add(r.thumb_path));
    }
    const orphans = candidates.filter((x) => !stillUsed.has(x.name));
    if (!orphans.length) return mat.msg.ok('沒有多餘的檔案。');
    const ok = await runDialog('matDlgOrphans', {
      onOpen: (dlg) => {
        dlg.querySelector('[data-body]').textContent = `找到 ${orphans.length} 個沒有對應圖片資料的檔案（約 ${formatBytes(orphans.reduce((s, x) => s + (Number(x.metadata?.size) || 0), 0))}），通常是上傳中斷或刪除時沒刪乾淨留下的。最近 24 小時內建立的檔案（可能還在上傳中）不算在內。`;
        dlg.querySelector('button[value="ok"]').textContent = `刪除這 ${orphans.length} 個檔案`;
      },
    });
    if (!ok) return;
    const left = await removeFiles(orphans.map((x) => x.name));
    await refreshUsage();
    mat.msg.ok(left ? `已清理；有 ${left} 個檔案刪不掉。` : `已清理 ${orphans.length} 個多餘的檔案。`);
  } catch (error) {
    console.error(error);
    mat.msg.error(matError(error, '檢查'));
  } finally {
    setBusy(btn, false);
  }
}

/* ================= 初始化與路由 ================= */
async function reloadAndRender(folderId) {
  if (folderId) mat.current = folderId;
  await loadMaterialsData();
  if (location.hash !== `#/materials/${mat.current}`) history.replaceState(null, '', `#/materials/${mat.current}`);
  renderMaterials();
}

// entry.js 路由切到 materials 時呼叫；arg 是資料夾 id
async function showMaterials(arg) {
  if (!mat.tree) {
    // 載入中又切換路由時，等同一個 promise，不重複載入、也不會在資料還沒到時就渲染
    mat.loading ??= loadMaterialsData().then(() => { refreshUsage(); });
    try {
      await mat.loading;
    } catch (error) {
      console.error(error);
      mat.loading = null;
      mat.msg.error(matError(error, '讀取學習資料'));
      return;
    }
  }
  if (arg && mat.tree.byId.has(arg)) mat.current = arg;
  const fromTree = document.getElementById('matTree').contains(document.activeElement);
  closeMenu();
  renderMaterials();
  // 用資料夾樹切換時，焦點留在樹上目前的資料夾（不用從頁首重新 Tab）
  if (fromTree) document.querySelector('#matTree a[aria-current="true"]')?.focus();
}

function initMaterials() {
  mat.msg = messageArea(document.querySelector('[data-msg="materials"]'), 'materials-msg');
  // 「取消」改成一般按鈕：在輸入框按 Enter 會送出「確定」，不會變成取消
  document.querySelectorAll('[data-view="materials"] dialog button[value="cancel"]').forEach((b) => {
    b.type = 'button';
    b.addEventListener('click', () => b.closest('dialog').close('cancel'));
  });
  document.getElementById('matNewFolderBtn').addEventListener('click', addFolder);
  document.getElementById('matRenameFolderBtn').addEventListener('click', renameFolder);
  document.getElementById('matDeleteFolderBtn').addEventListener('click', deleteFolder);
  document.getElementById('matOrphanBtn').addEventListener('click', checkOrphans);
  document.querySelectorAll('[data-mat-filter]').forEach((b) => b.addEventListener('click', () => { mat.filter = b.dataset.matFilter; renderThumbs(); }));
  document.getElementById('matUploadToggle').addEventListener('click', () => setUploadOpen(document.getElementById('matUploadPanel').hidden));
  document.getElementById('matUploadDone').addEventListener('click', () => {
    mat.uploads = mat.uploads.filter((u) => !['done', 'failed'].includes(u.status));
    renderUploads({ summary: true });
    setUploadOpen(false);
  });
  document.getElementById('matRetryAll').addEventListener('click', () => mat.uploads.filter((u) => u.status === 'failed' && u.retryable).forEach(runUpload));
  const pick = document.getElementById('matFilePick');
  pick.addEventListener('change', () => { queueFiles([...pick.files]); pick.value = ''; });
  const drop = document.getElementById('matDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drop--over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop--over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drop--over');
    queueFiles([...(e.dataTransfer?.files ?? [])]);
  });
  // 貼上剪貼簿圖片：只在「學習資料」頁面、且焦點不在輸入框時
  document.addEventListener('paste', (e) => {
    if (document.querySelector('#entryPanel .view[data-view="materials"]')?.hidden) return;
    if (e.target.closest?.('input, textarea, dialog')) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); queueFiles(files, { pasted: true }); }
  });
  document.addEventListener('click', (e) => { if (mat.openMenu && !mat.openMenu.menu.contains(e.target)) closeMenu(); });
  window.addEventListener('beforeunload', (e) => {
    if (mat.uploads.some((u) => !['done', 'failed'].includes(u.status))) e.preventDefault();
  });
}
