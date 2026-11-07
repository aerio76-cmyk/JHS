// 學習資料庫 Phase 0：孩子端（唯讀）。只示範畫面與互動，不連 Supabase。
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const views = document.querySelectorAll('[data-view]');
  const who = $('who');

  function show(name) {
    views.forEach(v => { v.hidden = v.dataset.view !== name; });
    who.hidden = name === 'login';
    document.querySelectorAll('.mock-bar a').forEach(a => a.setAttribute('aria-current', String(a.getAttribute('href') === location.hash)));
  }

  // ---------- 登入 ----------
  const LOGIN_MSG = {
    // 固定文字，不區分「帳號不存在」與「密碼錯誤」，避免洩漏帳號是否存在
    error: '帳號或密碼不正確，請再試一次。',
    limit: '嘗試次數太多，請過幾分鐘再試。',
  };
  function renderLogin(kind) {
    $('loginError').textContent = LOGIN_MSG[kind] || '';
    $('loginPw').setAttribute('aria-invalid', String(Boolean(kind)));
    $('loginPw').setAttribute('aria-describedby', kind ? 'loginError' : '');
  }
  $('pwToggle').addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? '隱藏' : '顯示';
    $('loginPw').type = on ? 'text' : 'password';
  });
  $('loginForm').addEventListener('submit', e => { e.preventDefault(); location.hash = '#/home'; });
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go; });

  // ---------- 縮圖 ----------
  function thumbItem(m, list, i, { showPath = false } = {}) {
    const li = el('li', 'thumb');
    const b = el('button', 'thumb__btn');
    b.type = 'button';
    b.setAttribute('aria-label', `放大：${m.title}`);
    b.appendChild(MAT.placeholder(m));
    b.addEventListener('click', () => openLightbox(list, i, b));
    li.append(b, el('span', 'thumb__title', m.title));
    const meta = [];
    if (showPath) meta.push(MAT.path(m.folder).map(f => f.name).join('／'));
    if (m.grade) meta.push(MAT.GRADE[m.grade]);
    if (meta.length) li.appendChild(el('span', 'thumb__meta', meta.join('・')));
    return li;
  }

  // ---------- 首頁 ----------
  function renderHome() {
    const grid = $('catGrid');
    grid.replaceChildren();
    for (const f of MAT.children(null)) {
      const a = el('a', 'cat-tile');
      a.href = `#/folder/${f.id}`;
      a.style.setProperty('--cat', `hsl(${f.hue} 55% 55%)`);
      const img = el('img'); img.src = `materials-icons/b-${f.icon}.svg`; img.alt = '';
      const n = MAT.inFolder(f.id, { deep: true }).length;
      a.append(img, el('span', 'cat-tile__name', f.name), el('span', 'cat-tile__count', `${n} 張`));
      grid.appendChild(a);
    }
    const recent = [...MAT.materials].filter(m => !m.learned).sort((a, b) => b.created - a.created).slice(0, 8);
    $('recent').replaceChildren(...recent.map((m, i) => thumbItem(m, recent, i, { showPath: true })));
  }

  // ---------- 資料夾 ----------
  function renderFolder(id) {
    const f = MAT.byId[id];
    if (!f) { location.hash = '#/home'; return; }
    const path = MAT.path(id);
    const crumbs = $('crumbs');
    crumbs.replaceChildren();
    const home = el('li'); const ha = el('a', null, '學習資料庫'); ha.href = '#/home'; home.appendChild(ha); crumbs.appendChild(home);
    path.forEach((p, i) => {
      const li = el('li');
      if (i === path.length - 1) { const s = el('span', null, p.name); s.setAttribute('aria-current', 'page'); li.appendChild(s); }
      else { const a = el('a', null, p.name); a.href = `#/folder/${p.id}`; li.appendChild(a); }
      crumbs.appendChild(li);
    });
    $('folderIcon').src = `materials-icons/b-${path[0].icon}.svg`;
    $('folderTitle').textContent = f.name;

    const subs = MAT.children(id);
    $('subfolders').hidden = !subs.length;
    $('subfolders').replaceChildren(...subs.map(s => {
      const li = el('li'); const a = el('a', 'subfolder'); a.href = `#/folder/${s.id}`;
      a.append(document.createTextNode('📁 ' + s.name), el('small', null, `${MAT.inFolder(s.id, { deep: true }).length} 張`));
      li.appendChild(a); return li;
    }));
    const list = MAT.inFolder(id);
    $('thumbs').replaceChildren(...list.map((m, i) => thumbItem(m, list, i)));
    $('thumbs').hidden = !list.length;
    $('folderEmpty').hidden = list.length > 0 || subs.length > 0;
    return list;
  }

  // ---------- 搜尋 ----------
  function renderSearch(q) {
    const list = MAT.materials.filter(m => !m.learned && m.title.includes(q));
    $('q2').value = q;
    $('searchTitle').textContent = list.length ? `「${q}」找到 ${list.length} 張` : `找不到「${q}」，換個關鍵字試試`;
    $('searchThumbs').replaceChildren(...list.map((m, i) => thumbItem(m, list, i, { showPath: true })));
  }
  document.querySelectorAll('[data-search]').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    const q = f.querySelector('input').value.trim();
    if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
  }));

  // ---------- 放大檢視 ----------
  const lb = $('lightbox');
  let lbList = [], lbIdx = 0, lbOpener = null;
  function paintLightbox() {
    const m = lbList[lbIdx];
    $('lbTitle').textContent = m.title;
    $('lbCount').textContent = `${lbIdx + 1} / ${lbList.length}`;
    $('lbImg').replaceChildren(MAT.placeholder(m));
    $('lbPrev').disabled = lbIdx === 0;
    $('lbNext').disabled = lbIdx === lbList.length - 1;
  }
  function openLightbox(list, i, opener) {
    lbList = list; lbIdx = i; lbOpener = opener || null;
    paintLightbox();
    if (!lb.open) lb.showModal();
    $('lbClose').focus();
  }
  const step = d => { const n = lbIdx + d; if (n >= 0 && n < lbList.length) { lbIdx = n; paintLightbox(); } };
  $('lbPrev').addEventListener('click', () => step(-1));
  $('lbNext').addEventListener('click', () => step(1));
  $('lbClose').addEventListener('click', () => lb.close());
  lb.addEventListener('close', () => { if (lbOpener && document.contains(lbOpener)) lbOpener.focus(); });
  lb.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  // 觸控滑動：水平位移超過 50 px 且大於垂直位移才換張；多指（縮放）時不處理
  let sx = null, sy = 0;
  $('lbStage').addEventListener('pointerdown', e => { if (e.isPrimary && e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
  $('lbStage').addEventListener('pointerup', e => {
    if (sx == null || !e.isPrimary) return;
    const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
  $('lbStage').addEventListener('pointercancel', () => { sx = null; });

  // ---------- 路由 ----------
  let firstRoute = true;
  function route() {
    const [, name = 'login', a, b] = location.hash.split('/');
    const focusTitle = !firstRoute; firstRoute = false; // 第一次載入不搶焦點，換頁時才把焦點移到標題
    if (lb.open && name !== 'view') lb.close();
    if (name.startsWith('login')) { show('login'); renderLogin(name.split('-')[1]); return; }
    if (name === 'folder') { show('folder'); renderFolder(a); if (focusTitle) $('folderTitle').focus(); return; }
    if (name === 'search') { show('search'); renderSearch(decodeURIComponent(a || '')); if (focusTitle) $('searchTitle').focus(); return; }
    if (name === 'view') { show('folder'); const list = renderFolder(a) || []; if (list.length) openLightbox(list, Math.min(+b || 0, list.length - 1)); return; }
    show('home'); renderHome();
  }
  addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/login';
  route();
})();
