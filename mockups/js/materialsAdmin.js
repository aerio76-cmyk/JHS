// 學習資料庫 Phase 0：家長端管理。只示範畫面與互動，不連 Supabase、不真的上傳。
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const MAX_DEPTH = 3; // 頂層分類＋最多兩層自訂
  let current = 'sci-phy';
  let filter = 'all';
  let openMenu = null;

  // ---------- 資料夾樹 ----------
  function treeNode(f) {
    const li = el('li');
    const row = el('div', 'tree__row');
    const a = el('a', 'tree__link');
    a.href = `#/folder/${f.id}`;
    if (f.id === current) a.setAttribute('aria-current', 'true');
    if (!f.parent) { const img = el('img'); img.src = `materials-icons/b-${f.icon}.svg`; img.alt = ''; a.appendChild(img); }
    else a.appendChild(document.createTextNode('📁'));
    a.append(document.createTextNode(f.name), el('small', null, String(MAT.inFolder(f.id, { deep: true, includeLearned: true }).length)));
    row.appendChild(a);
    li.appendChild(row);
    const kids = MAT.children(f.id);
    if (kids.length) { const ul = el('ul'); kids.forEach(k => ul.appendChild(treeNode(k))); li.appendChild(ul); }
    return li;
  }
  function renderTree() { $('tree').replaceChildren(...MAT.children(null).map(treeNode)); }

  // ---------- 目前資料夾 ----------
  function renderFolder() {
    const f = MAT.byId[current];
    const path = MAT.path(current);
    const crumbs = $('crumbs');
    crumbs.replaceChildren(...path.map((p, i) => {
      const li = el('li');
      if (i === path.length - 1) { const s = el('span', null, p.name); s.setAttribute('aria-current', 'page'); li.appendChild(s); }
      else { const a = el('a', null, p.name); a.href = `#/folder/${p.id}`; li.appendChild(a); }
      return li;
    }));
    $('folderIcon').src = `materials-icons/b-${path[0].icon}.svg`;
    $('folderTitle').textContent = f.name;
    const [btnNew, btnRename, btnDel] = $('folderActions').children;
    btnRename.hidden = btnDel.hidden = Boolean(f.system);
    btnNew.disabled = MAT.depth(current) >= MAX_DEPTH;
    const notes = [];
    if (f.system) notes.push('六大分類是固定的，不能改名或刪除；可以在底下新增子資料夾。');
    if (MAT.depth(current) >= MAX_DEPTH) notes.push('這裡已經是第三層，不能再往下新增資料夾。');
    $('folderNote').textContent = notes.join('');
    $('folderNote').hidden = !notes.length;
    renderThumbs();
  }

  function renderThumbs() {
    const all = MAT.inFolder(current, { includeLearned: true });
    const list = all.filter(m => filter === 'all' || (filter === 'learned' ? m.learned : !m.learned));
    const nLearned = all.filter(m => m.learned).length;
    $('imgsCount').textContent = `${all.length} 張（已學會 ${nLearned}）`;
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    $('thumbs').replaceChildren(...list.map(adminThumb));
    $('thumbsEmpty').hidden = list.length > 0;
  }

  function adminThumb(m) {
    const li = el('li', `thumb thumb--admin${m.learned ? ' thumb--learned' : ''}`);
    const b = el('button', 'thumb__btn');
    b.type = 'button';
    b.setAttribute('aria-label', `預覽：${m.title}`);
    b.appendChild(MAT.placeholder(m));
    li.appendChild(b);
    if (m.learned) li.appendChild(el('span', 'badge-learned', '✓ 已學會'));
    const mb = el('button', 'icon-btn thumb__menu', '⋯');
    mb.type = 'button';
    mb.setAttribute('aria-label', `「${m.title}」的操作`);
    mb.setAttribute('aria-haspopup', 'menu');
    mb.setAttribute('aria-expanded', 'false');
    mb.addEventListener('click', e => { e.stopPropagation(); toggleMenu(li, mb, m); });
    li.append(mb, el('span', 'thumb__title', m.title));
    const meta = [MAT.GRADE[m.grade], `${MAT.fmtDate(m.created)} 新增`].filter(Boolean);
    li.appendChild(el('span', 'thumb__meta', meta.join('・')));
    return li;
  }

  // ---------- 單張圖片的操作選單 ----------
  function closeMenu() {
    if (!openMenu) return;
    openMenu.menu.remove();
    openMenu.btn.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }
  function toggleMenu(li, btn, m) {
    const same = openMenu && openMenu.btn === btn;
    closeMenu();
    if (same) return;
    const menu = el('ul', 'menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `「${m.title}」的操作`);
    const items = [
      ['✎ 改標題', () => openRename('圖片標題', m.title)],
      ['↪ 移動到…', () => openItemDlg('dlgMove', m)],
      ['⟳ 換圖', () => openItemDlg('dlgReplace', m)],
      [m.learned ? '↺ 取消已學會（給孩子看）' : '✓ 標為已學會（孩子端隱藏）', () => { m.learned = !m.learned; renderTree(); renderThumbs(); }],
      null,
      ['🗑 永久刪除', () => openItemDlg('dlgDelItem', m), 'danger'],
    ];
    for (const it of items) {
      const mi = el('li'); mi.setAttribute('role', 'none');
      if (!it) { mi.appendChild(el('hr')); menu.appendChild(mi); continue; }
      const b = el('button', it[2] || '', it[0]);
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => { closeMenu(); it[1](); });
      mi.appendChild(b); menu.appendChild(mi);
    }
    menu.addEventListener('keydown', e => {
      const bs = [...menu.querySelectorAll('button')];
      const i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      if (e.key === 'Escape') { closeMenu(); btn.focus(); }
    });
    li.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    openMenu = { menu, btn };
    menu.querySelector('button').focus();
  }
  document.addEventListener('click', e => { if (openMenu && !openMenu.menu.contains(e.target)) closeMenu(); });

  // ---------- 對話框 ----------
  const firstItem = () => MAT.inFolder(current, { includeLearned: true })[0];
  function openItemDlg(id, m) {
    m = m || firstItem();
    document.querySelectorAll(`#${id} [data-ititle]`).forEach(s => { s.textContent = m.title; });
    if (id === 'dlgMove') {
      const sel = $('moveTo');
      const opts = [];
      (function add(parent, depth) {
        for (const f of MAT.children(parent)) {
          const o = el('option', null, `${'　'.repeat(depth)}${depth ? '└ ' : ''}${f.name}`);
          o.value = f.id; o.selected = f.id === m.folder;
          opts.push(o); add(f.id, depth + 1);
        }
      })(null, 0);
      sel.replaceChildren(...opts);
    }
    $(id).showModal();
  }
  function openRename(label, value) {
    $('renameLabel').textContent = label;
    $('dlgRenameTitle').textContent = label === '圖片標題' ? '改標題' : '資料夾改名';
    $('renameInput').value = value;
    $('dlgRename').showModal();
  }
  function openNew() {
    const full = MAT.depth(current) >= MAX_DEPTH;
    $('dlgNewWhere').textContent = `新增在「${MAT.path(current).map(f => f.name).join('／')}」底下。`;
    $('dlgNewField').hidden = full;
    $('dlgNewOk').hidden = full;
    $('dlgNewFull').textContent = full ? '資料夾最多三層（分類／子資料夾／子資料夾），這裡已經是第三層，請改在上一層新增。' : '';
    $('dlgNew').showModal();
  }
  function openDelFolder() {
    const n = MAT.inFolder(current, { deep: true, includeLearned: true }).length;
    const subs = MAT.descendants(current).length - 1;
    document.querySelectorAll('[data-fname]').forEach(s => { s.textContent = MAT.byId[current].name; });
    $('delFolderBody').textContent = n || subs
      ? `裡面有 ${subs ? `${subs} 個子資料夾、` : ''}${n} 張圖片，會連同資料夾一起刪除。`
      : '這個資料夾是空的。';
    $('delFolderOk').textContent = n ? `刪除資料夾和 ${n} 張圖片` : '刪除資料夾';
    $('dlgDelFolder').showModal();
  }
  document.querySelectorAll('[data-dlg]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.dlg === 'dlgNew') openNew();
    else if (b.dataset.dlg === 'dlgRename') openRename('資料夾名稱', MAT.byId[current].name);
    else openDelFolder();
  }));

  // ---------- 篩選、上傳 ----------
  document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; renderThumbs(); }));
  function setUpload(open) {
    $('uploadPanel').hidden = !open;
    $('uploadToggle').setAttribute('aria-expanded', String(open));
    $('uploadToggle').textContent = open ? '收起上傳' : '上傳圖片';
  }
  $('uploadToggle').addEventListener('click', () => setUpload($('uploadPanel').hidden));
  $('uploadDone').addEventListener('click', () => setUpload(false));

  // 示範各種逐檔狀態（正式版：同時最多處理 2–3 張，失敗不留下孤兒檔案）
  const UPLOADS = [
    ['電功率公式.png', 'ok', '完成', 100],
    ['焦耳定律講義.jpg', 'ok', '完成', 100],
    ['電流磁效應.webp', 'busy', '上傳中…', 70],
    ['右手定則.jpg', 'busy', '壓縮中…', 35],
    ['電磁感應.png', 'wait', '等待中', 0],
    ['動畫示範.gif', 'err', '沒有上傳：只支援 JPG、PNG、WebP', null],
    ['掃描整本講義.png', 'err', '沒有上傳：檔案超過 10 MB（14.2 MB）', null],
    ['電路符號表.jpg', 'err', '上傳失敗：網路中斷，可以按「重試」', null],
  ];
  function renderUploads() {
    $('uploadList').replaceChildren(...UPLOADS.map(([name, st, text, pct], i) => {
      const li = el('li', 'upload-item');
      li.appendChild(MAT.placeholder({ folder: current, tall: i % 2 }));
      const mid = el('div');
      mid.append(el('div', 'upload-item__name', name));
      const s = el('div', `upload-item__status${st === 'ok' ? ' upload-item__status--ok' : st === 'err' ? ' upload-item__status--err' : ''}`, (st === 'ok' ? '✓ ' : st === 'err' ? '✕ ' : '') + text);
      mid.appendChild(s);
      if (pct != null && st !== 'ok') {
        const mt = el('div', 'meter'); mt.setAttribute('role', 'progressbar');
        mt.setAttribute('aria-label', name); mt.setAttribute('aria-valuenow', pct); mt.setAttribute('aria-valuemin', 0); mt.setAttribute('aria-valuemax', 100);
        const bar = el('span'); bar.style.width = `${pct}%`; mt.appendChild(bar); mid.appendChild(mt);
      }
      li.appendChild(mid);
      if (st === 'err' && text.includes('重試')) { const r = el('button', 'btn', '重試'); r.type = 'button'; li.appendChild(r); }
      else li.appendChild(el('span'));
      return li;
    }));
    $('uploadSummary').textContent = '8 張中：2 張完成、3 張處理中、3 張沒有上傳';
  }
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop--over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop--over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drop--over'); });

  // ---------- 路由（只給模擬圖切換狀態用） ----------
  function route() {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    closeMenu();
    const [, state = 'folder', id = 'sci-phy'] = location.hash.split('/');
    current = MAT.byId[id] ? id : 'sci-phy';
    filter = state === 'learned' ? 'learned' : 'all';
    renderTree(); renderFolder();
    setUpload(state === 'upload');
    drop.classList.toggle('drop--over', state === 'upload');
    if (state === 'upload') renderUploads();
    if (state === 'menu') { const li = $('thumbs').querySelector('.thumb'); if (li) li.querySelector('.thumb__menu').click(); }
    if (state === 'new') openNew();
    if (state === 'del-folder') openDelFolder();
    if (state === 'del-item') openItemDlg('dlgDelItem');
    if (state === 'move') openItemDlg('dlgMove');
    if (state === 'replace') openItemDlg('dlgReplace');
    document.querySelectorAll('.mock-bar a').forEach(a => a.setAttribute('aria-current', String(a.getAttribute('href') === location.hash)));
  }
  $('usageCount').textContent = String(MAT.materials.length);
  addEventListener('hashchange', route);
  route();
})();
