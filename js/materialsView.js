// materials.html：孩子端（唯讀）學習資料庫。
// 圖片一律用需登入的下載（storage download → blob），不使用可外流的簽名網址；每次請求都由 RLS／Storage 政策重新檢查權限。
// 安全：標題與資料夾名稱一律 textContent；登入錯誤訊息固定中文，不顯示伺服器原文；不在 console 輸出任何網址或權杖。
// 共用帳號：登出只登出這台裝置（scope: 'local'），不影響其他平板。

const MV_BUCKET = 'materials';
const THUMB_CACHE_MAX = 300; // 縮圖 blob 快取上限（每張約 20–40 KB）

const mv = {
  tree: null, // { roots, byId }
  materials: [], // 只有學習中的圖片
  userId: null,
  role: null, // 'viewer' | 'admin'
  gen: 0, // 登入世代：登出或換人時遞增，舊的下載完成後直接丟棄
  thumbUrls: new Map(), // thumb_path → blob URL（依使用順序，超過上限時釋放最舊且不在畫面上的）
  fullUrls: new Map(), // storage_path → Promise<blob URL | null>（只留目前與前後一張）
  thumbLimit: createLimiter(4),
  observer: null,
  lb: { list: [], idx: 0, token: 0, skipPop: false },
  focusNext: false, // 下一次 route 是否把焦點移到標題
};

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
};
const bucket = () => sbClient.storage.from(MV_BUCKET);
const GRADE = { 1: '國一', 2: '國二', 3: '國三' };
const MATERIAL_COLS = 'id, folder_id, title, grade_tag, storage_path, thumb_path, is_learned, created_at';
// 只接受圖片：縱深防禦（bucket 已限制 jpeg／webp）。其他類型的檔案不建立 blob 網址，避免在本站開出 HTML
const SAFE_IMAGE_TYPES = ['image/jpeg', 'image/webp'];
const safeImageUrl = (blob) => (blob && SAFE_IMAGE_TYPES.includes(blob.type) ? URL.createObjectURL(blob) : null);

/* ================= 畫面切換與訊息 ================= */
const VIEWS = ['login', 'noaccess', 'home', 'folder', 'search'];
function show(name) {
  for (const v of VIEWS) document.querySelector(`[data-view="${v}"]`).hidden = v !== name;
  $('who').hidden = !['home', 'folder', 'search'].includes(name) && name !== 'noaccess';
  // 登入後的瀏覽畫面：頁首有回成長記錄本；管理員再加回家長管理。
  // 登入、無權限畫面的卡片裡本身已有返回鈕，頁首不重複
  const browsing = ['home', 'folder', 'search'].includes(name);
  $('siteLinks').hidden = !browsing;
  $('adminBackLink').hidden = !browsing || mv.role !== 'admin';
  document.querySelector('a.brand').setAttribute('href', browsing ? '#/home' : 'index.html');
  $('loadMsg').textContent = '';
  $('retryBox').hidden = true;
  $('viewError').textContent = '';
}

function showLoadError(text) {
  for (const v of VIEWS) document.querySelector(`[data-view="${v}"]`).hidden = true;
  $('siteLinks').hidden = true; // 錯誤畫面的出口在「重新整理」旁；頁首不重複，也不會留下舊身分的「回家長管理」
  document.querySelector('a.brand').setAttribute('href', 'index.html');
  $('loadMsg').className = 'load-msg load-msg--error';
  $('loadMsg').textContent = text;
  $('retryBox').hidden = false;
}

/* ================= 登入、登出、session 變化 ================= */
function resetPasswordToggle() {
  $('pwToggle').setAttribute('aria-pressed', 'false');
  $('loginPw').type = 'password';
}

// 清掉這個 session 的所有資料與畫面（登出、被登出、換人時）
function clearSessionState() {
  mv.gen++;
  mv.tree = null;
  mv.materials = [];
  mv.userId = null;
  mv.role = null;
  if (mv.observer) mv.observer.disconnect();
  const lb = $('lightbox');
  if (lb.open) lb.close();
  mv.lb.list = [];
  for (const u of mv.thumbUrls.values()) URL.revokeObjectURL(u);
  mv.thumbUrls.clear();
  trimFullUrls(new Set());
  for (const id of ['catGrid', 'recent', 'thumbs', 'searchThumbs', 'crumbs', 'subfolders', 'folderIcon']) $(id).replaceChildren();
  $('adminNotice').hidden = true;
  $('folderTitle').textContent = '';
  $('searchTitle').textContent = '';
}

function showLogin(message = '') {
  clearSessionState();
  resetPasswordToggle();
  $('loginPw').value = '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  show('login');
  $('loginError').textContent = message;
  $('loginEmail').focus();
}

async function logout() {
  // 只登出這台裝置：共用的觀看帳號在其他平板上不受影響
  mv.userId = null; // 自己按的登出，不再顯示「已經登出」的提示
  await sbClient.auth.signOut({ scope: 'local' });
  showLogin();
}

function setupLogin() {
  $('pwToggle').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    $('loginPw').type = on ? 'text' : 'password';
  });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('loginEmail').value.trim();
    const password = $('loginPw').value;
    const err = $('loginError');
    err.textContent = '';
    $('loginPw').removeAttribute('aria-invalid');
    if (!email || !password) {
      err.textContent = '請輸入帳號和密碼。';
      return;
    }
    const btn = $('loginBtn');
    btn.disabled = true;
    btn.textContent = '登入中…';
    let error = null;
    try {
      ({ error } = await sbClient.auth.signInWithPassword({ email, password }));
    } catch (thrown) {
      error = thrown;
    } finally {
      btn.disabled = false;
      btn.textContent = '登入';
    }
    if (error) {
      err.textContent = viewerLoginMessage(error);
      $('loginPw').setAttribute('aria-invalid', 'true');
      $('loginPw').setAttribute('aria-describedby', 'loginError');
      $('loginPw').select();
      return;
    }
    $('loginPw').value = '';
    resetPasswordToggle();
    mv.focusNext = true; // 登入後焦點移到首頁標題，不要留在已隱藏的登入按鈕上
    await start();
  });
  $('logoutBtn').addEventListener('click', logout);
  $('adminLogout').addEventListener('click', logout);
  $('noAccessLogout').addEventListener('click', logout);
  $('retryBtn').addEventListener('click', () => { $('loadMsg').className = 'load-msg'; $('loadMsg').textContent = '載入中…'; $('retryBox').hidden = true; start(); });

  // 在其他分頁登出、refresh token 失效、帳號被刪除：回到登入頁；換成另一個人登入：重新載入
  sbClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      if (mv.userId) setTimeout(() => showLogin('已經登出，請重新登入。'), 0);
      return;
    }
    if (mv.userId && session?.user?.id && session.user.id !== mv.userId) setTimeout(start, 0);
  });
}

// 下載失敗時確認是不是 session 已經失效（避免一直顯示「無法顯示」卻沒有路回登入頁）
let sessionCheck = null;
function checkSessionSoon() {
  sessionCheck ??= setTimeout(async () => {
    sessionCheck = null;
    const { data } = await sbClient.auth.getSession();
    if (!data.session && mv.userId) showLogin('登入已經過期，請重新登入。');
  }, 300);
}

/* ================= 載入 ================= */
async function start() {
  const gen = ++mv.gen;
  const { data } = await sbClient.auth.getSession();
  if (gen !== mv.gen) return;
  if (!data.session) {
    show('login');
    return;
  }
  // 觀看帳號或管理員才能看。任一個查詢失敗、而另一個沒有明確回答「是」時，當成「無法確認」，不要誤判成沒有權限
  const [v, a] = await Promise.all([sbClient.rpc('is_viewer'), sbClient.rpc('is_admin')]);
  if (gen !== mv.gen) return;
  const isViewer = v.data === true;
  const isAdmin = a.data === true;
  if (!isViewer && !isAdmin && (v.error || a.error)) {
    showLoadError('無法確認登入狀態，請確認網路後按「重新整理」。');
    return;
  }
  mv.userId = data.session.user.id;
  if (!isViewer && !isAdmin) {
    mv.role = null;
    $('whoLabel').textContent = '已登入';
    show('noaccess');
    return;
  }
  mv.role = isViewer ? 'viewer' : 'admin';
  // 家長在孩子的平板上用 Google 登入時，提醒看完要登出（否則孩子之後開家長端就有編輯權限）
  $('whoLabel').textContent = isViewer ? '觀看帳號' : '家長帳號';
  $('adminNotice').hidden = isViewer;
  try {
    const [folders, materials] = await Promise.all([
      fetchAllRows((from, to) => sbClient.from('material_folders').select('id, parent_id, name, sort, is_system, system_key').order('id').range(from, to)),
      fetchAllRows((from, to) => sbClient.from('materials').select(MATERIAL_COLS)
        .eq('is_learned', false).order('created_at', { ascending: false }).order('id').range(from, to)),
    ]);
    if (gen !== mv.gen) return;
    mv.tree = buildFolderTree(folders);
    mv.materials = activeMaterials(materials);
  } catch (error) {
    console.error('讀取學習資料失敗', error?.code ?? '');
    if (gen === mv.gen) showLoadError('學習資料讀取失敗，請確認網路後按「重新整理」。');
    return;
  }
  route();
}

/* ================= 縮圖（需登入的下載、進入畫面才載入） ================= */
function rememberThumb(path, url) {
  mv.thumbUrls.delete(path);
  mv.thumbUrls.set(path, url);
  if (mv.thumbUrls.size <= THUMB_CACHE_MAX) return;
  const inUse = new Set([...document.querySelectorAll('img[src^="blob:"]')].map((i) => i.src));
  for (const [p, u] of mv.thumbUrls) {
    if (mv.thumbUrls.size <= THUMB_CACHE_MAX) break;
    if (inUse.has(u)) continue;
    URL.revokeObjectURL(u);
    mv.thumbUrls.delete(p);
  }
}

async function loadThumb(m, img) {
  const cached = mv.thumbUrls.get(m.thumb_path);
  if (cached) {
    rememberThumb(m.thumb_path, cached);
    img.src = cached;
    return;
  }
  const gen = mv.gen;
  const result = await mv.thumbLimit(async () => {
    // 排隊期間已換頁或登出：不再下載（省流量，也不會讓新畫面排在舊的後面太久）
    if (!img.isConnected || gen !== mv.gen) return null;
    return bucket().download(m.thumb_path);
  });
  if (!result) return;
  if (gen !== mv.gen) return;
  const url = result.error ? null : safeImageUrl(result.data);
  if (!url) {
    if (img.isConnected) img.replaceWith(el('span', { class: 'thumb__missing', text: '這張圖目前無法顯示' }));
    if (result.error) checkSessionSoon();
    return;
  }
  rememberThumb(m.thumb_path, url);
  if (img.isConnected) img.src = url;
}

function renderThumbList(ul, list, opts) {
  if (!mv.observer) {
    mv.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        mv.observer.unobserve(e.target);
        if (e.target.__material) loadThumb(e.target.__material, e.target);
      }
    }, { rootMargin: '300px 0px' });
  }
  mv.observer.disconnect(); // 一次只有一份清單在畫面上；舊節點不再觀察
  ul.replaceChildren(...list.map((m, i) => thumbItem(m, list, i, opts)));
  ul.querySelectorAll('img[data-lazy]').forEach((img) => mv.observer.observe(img));
}

function thumbItem(m, list, i, { showPath = false } = {}) {
  const img = el('img', { alt: '', 'data-lazy': '1', width: '320', height: '320' });
  img.__material = m;
  const btn = el('button', { type: 'button', class: 'thumb__btn', 'aria-label': `放大：${m.title}`, 'data-id': m.id }, img);
  btn.addEventListener('click', () => openLightbox(list, i));
  const li = el('li', { class: 'thumb' }, btn, el('span', { class: 'thumb__title', text: m.title }));
  const meta = [];
  if (showPath) meta.push(folderPath(mv.tree.byId, m.folder_id).map((f) => f.name).join('／'));
  if (m.grade_tag) meta.push(GRADE[m.grade_tag]);
  if (meta.length) li.append(el('span', { class: 'thumb__meta', text: meta.join('・') }));
  return li;
}

/* ================= 首頁、資料夾、搜尋 ================= */
function renderHome() {
  $('catGrid').replaceChildren(...mv.tree.roots.map((f) => {
    const n = deepMaterialCount(mv.tree.byId, f.id, mv.materials);
    const src = categoryIcon(f.system_key);
    return el('a', { class: 'cat-tile', href: `#/folder/${f.id}` },
      src ? el('img', { src, alt: '', width: '96', height: '96' }) : null,
      el('span', { class: 'cat-tile__name', text: f.name }),
      el('span', { class: 'cat-tile__count', text: `${n} 張` }));
  }));
  const recent = recentMaterials(mv.materials, 8);
  $('recentCard').hidden = !recent.length;
  renderThumbList($('recent'), recent, { showPath: true });
}

function renderFolder(id) {
  const f = mv.tree.byId.get(id);
  const path = folderPath(mv.tree.byId, id);
  $('crumbs').replaceChildren(
    el('li', {}, el('a', { href: '#/home', text: '學習資料庫' })),
    ...path.map((p, i) => el('li', {}, i === path.length - 1
      ? el('span', { 'aria-current': 'page', text: p.name })
      : el('a', { href: `#/folder/${p.id}`, text: p.name }))),
  );
  const src = categoryIcon(path[0]?.system_key);
  $('folderIcon').replaceChildren(...(src ? [el('img', { src, alt: '', width: '56', height: '56' })] : []));
  $('folderTitle').textContent = f.name;
  // 返回按鈕：上一層（第一層的上一層就是首頁）；已在第一層時不重複顯示「首頁」
  const parent = f.parent_id ? mv.tree.byId.get(f.parent_id) : null;
  $('upLink').href = parent ? `#/folder/${parent.id}` : '#/home';
  $('upLabel').textContent = `上一層：${parent ? parent.name : '學習資料庫首頁'}`;
  $('homeLink').hidden = !parent;
  const subs = visibleSubfolders(mv.tree.byId, id, mv.materials);
  $('subfolders').hidden = !subs.length;
  $('subfolders').replaceChildren(...subs.map((s) => el('li', {}, el('a', { class: 'subfolder', href: `#/folder/${s.id}` },
    el('span', { 'aria-hidden': 'true', text: '📁' }), el('span', { text: s.name }),
    el('small', { text: `${deepMaterialCount(mv.tree.byId, s.id, mv.materials)} 張` })))));
  const list = mv.materials.filter((m) => m.folder_id === id);
  $('thumbs').hidden = !list.length;
  renderThumbList($('thumbs'), list);
  $('folderEmpty').hidden = list.length > 0 || subs.length > 0;
}

function renderSearch(q) {
  const list = searchMaterials(mv.materials, q);
  $('q2').value = q;
  $('searchTitle').textContent = list.length ? `「${q}」找到 ${list.length} 張` : `找不到「${q}」，換個關鍵字試試`;
  renderThumbList($('searchThumbs'), list, { showPath: true });
}

function setupSearch() {
  document.querySelectorAll('[data-search]').forEach((form) => form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const q = cleanText(input.value);
    if (!q) {
      input.focus();
      return;
    }
    const hash = `#/search/${encodeURIComponent(q)}`;
    mv.focusNext = true;
    if (location.hash === hash) route(); // 同一個關鍵字再搜一次也要有反應
    else location.hash = hash;
  }));
}

/* ================= 放大檢視 ================= */
// 原圖：同一張正在下載時共用同一個請求（不重複下載、不遺失 blob）
function fullUrl(m) {
  if (mv.fullUrls.has(m.storage_path)) return mv.fullUrls.get(m.storage_path);
  const gen = mv.gen;
  const p = bucket().download(m.storage_path).then(({ data, error }) => {
    const url = error ? null : safeImageUrl(data);
    if (!url) {
      mv.fullUrls.delete(m.storage_path);
      if (error) checkSessionSoon();
      return null;
    }
    if (gen !== mv.gen || mv.fullUrls.get(m.storage_path) !== p) { URL.revokeObjectURL(url); return null; } // 已被釋放或登出
    return url;
  }, () => { mv.fullUrls.delete(m.storage_path); return null; });
  mv.fullUrls.set(m.storage_path, p);
  return p;
}

// 只保留 keep 裡的原圖，其餘（含還在下載的）完成後釋放
function trimFullUrls(keep) {
  for (const [path, p] of mv.fullUrls) {
    if (keep.has(path)) continue;
    mv.fullUrls.delete(path);
    p.then((u) => { if (u) URL.revokeObjectURL(u); });
  }
}

async function paintLightbox() {
  const { list, idx } = mv.lb;
  const m = list[idx];
  const token = ++mv.lb.token;
  $('lbTitle').textContent = m.title;
  $('lbCount').textContent = `${idx + 1} / ${list.length}`;
  $('lbStatus').textContent = `${m.title}，第 ${idx + 1} 張，共 ${list.length} 張`;
  $('lbPrev').disabled = idx === 0;
  $('lbNext').disabled = idx === list.length - 1;
  $('lbImg').replaceChildren(el('p', { class: 'lightbox__loading', text: '載入中…' }));
  const neighbors = [list[idx - 1], list[idx + 1]].filter(Boolean);
  trimFullUrls(new Set([m, ...neighbors].map((x) => x.storage_path)));
  const url = await fullUrl(m);
  if (token !== mv.lb.token || !$('lightbox').open) return; // 已經換張或關閉
  $('lbImg').replaceChildren(url
    ? el('img', { src: url, alt: m.title })
    : el('p', { class: 'lightbox__loading', text: '這張圖目前無法顯示（可能已被家長移除或標為已學會）。' }));
  neighbors.forEach((x) => { fullUrl(x); }); // 預先載入前後一張
}

function openLightbox(list, idx) {
  mv.lb.list = list;
  mv.lb.idx = idx;
  const lb = $('lightbox');
  if (!lb.open) {
    lb.showModal();
    history.pushState({ lightbox: true }, ''); // 平板的「返回」先關閉放大檢視
  }
  $('lbClose').focus();
  paintLightbox();
}

const zoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;

function setupLightbox() {
  const lb = $('lightbox');
  const stage = $('lbStage');
  const step = (d) => {
    const n = mv.lb.idx + d;
    if (n >= 0 && n < mv.lb.list.length) { mv.lb.idx = n; paintLightbox(); }
  };
  $('lbPrev').addEventListener('click', () => step(-1));
  $('lbNext').addEventListener('click', () => step(1));
  $('lbClose').addEventListener('click', () => lb.close());
  lb.addEventListener('close', () => {
    mv.lb.token++; // 還在下載的原圖不要再塞進已關閉的畫面
    trimFullUrls(new Set());
    $('lbImg').replaceChildren();
    stage.classList.remove('is-zoomed');
    // 焦點回到「目前正在看的那張」縮圖（等瀏覽器把焦點還給開啟按鈕之後再設定，才不會被蓋掉）
    const m = mv.lb.list[mv.lb.idx];
    mv.lb.returnFocus = () => {
      // 同一張圖可能同時在「最近新增」（隱藏中的首頁）和資料夾裡：只找畫面上看得到的那一份
      const btn = m && [...document.querySelectorAll(`.thumb__btn[data-id="${CSS.escape(m.id)}"]`)].find((b) => b.offsetParent);
      if (btn) btn.focus();
    };
    if (history.state?.lightbox) {
      mv.lb.skipPop = true;
      history.back(); // 焦點在 popstate 之後再還（返回動作完成前設定會被蓋掉）
    } else {
      setTimeout(mv.lb.returnFocus, 0);
    }
  });
  window.addEventListener('popstate', () => {
    if (mv.lb.skipPop) {
      mv.lb.skipPop = false;
      setTimeout(() => mv.lb.returnFocus?.(), 0);
      return;
    }
    if (lb.open) lb.close();
  });
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  // 雙指放大後，讓瀏覽器處理拖動（可以看長圖的左右兩邊），不判斷成換張
  window.visualViewport?.addEventListener('resize', () => stage.classList.toggle('is-zoomed', lb.open && zoomed()));
  // 觸控滑動：沒有放大、水平位移超過 50 px 且大於垂直位移才換張；多指（縮放）不處理
  let sx = null;
  let sy = 0;
  stage.addEventListener('pointerdown', (e) => { if (e.isPrimary && e.pointerType !== 'mouse' && !zoomed()) { sx = e.clientX; sy = e.clientY; } });
  stage.addEventListener('pointerup', (e) => {
    if (sx == null || !e.isPrimary) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    sx = null;
    if (zoomed()) return;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => { sx = null; });
}

/* ================= 路由 ================= */
function route() {
  if (!mv.tree) return;
  const [, name = 'home', arg = ''] = location.hash.split('/');
  const focus = mv.focusNext;
  mv.focusNext = true; // 之後每次換頁都把焦點移到標題（第一次載入除外）
  const lb = $('lightbox');
  if (lb.open) lb.close();
  if (name === 'folder' && mv.tree.byId.has(arg)) {
    show('folder');
    renderFolder(arg);
    if (focus) $('folderTitle').focus();
    return;
  }
  let q = '';
  if (name === 'search') {
    try { q = cleanText(decodeURIComponent(arg)); } catch { q = ''; } // 網址編碼壞掉時回首頁
  }
  if (q) {
    show('search');
    renderSearch(q);
    if (focus) $('searchTitle').focus();
    return;
  }
  show('home');
  renderHome();
  if (focus) document.querySelector('[data-view="home"] h1').focus();
}

document.addEventListener('DOMContentLoaded', () => {
  // 不允許被別的網站用框架嵌入（meta CSP 不支援 frame-ancestors）
  if (window.top !== window.self) {
    document.body.replaceChildren();
    return;
  }
  setupLogin();
  setupSearch();
  setupLightbox();
  window.addEventListener('hashchange', route);
  start().catch((error) => {
    console.error('初始化失敗', error?.code ?? '');
    showLoadError('無法載入，請確認網路後按「重新整理」。');
  });
});
