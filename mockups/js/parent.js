// Phase 0 家長端「學生與頭像」模擬：預設頭像、主題色、上傳（只在本機裁切預覽，不會送出）。

if (new URLSearchParams(location.search).has('shot')) document.documentElement.classList.add('is-shot');

const PRESETS = [
  { id: 'cat', label: '貓咪' },
  { id: 'bunny', label: '兔子' },
  { id: 'bear', label: '小熊' },
  { id: 'penguin', label: '企鵝' },
];
const SWATCHES = [
  { hex: '#F28B6D', name: '珊瑚橘' },
  { hex: '#3FA796', name: '青綠' },
  { hex: '#6C8EF2', name: '天空藍' },
  { hex: '#E6A93B', name: '芥末黃' },
  { hex: '#B57FD8', name: '薰衣草紫' },
  { hex: '#E77FA6', name: '莓果粉' },
];
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SOURCE_BYTES = 10 * 1024 * 1024; // 原始檔上限；重編碼後的 512px 圖遠小於 bucket 的 2 MB
const OUTPUT_SIZE = 512;

const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
};

// 每個訊息區塊一組常駐的 live region：錯誤用 alert、成功用 status，只換文字不切 hidden
function messageArea() {
  const err = h('p', { class: 'msg msg--error', role: 'alert' });
  const ok = h('p', { class: 'msg msg--ok', role: 'status' });
  const wrap = h('div', {}, err, ok);
  wrap.show = (kind, text) => {
    err.textContent = kind === 'error' ? text : '';
    ok.textContent = kind === 'ok' ? text : '';
  };
  wrap.errId = (err.id = `e-${Math.random().toString(36).slice(2, 8)}`);
  return wrap;
}

// 讀檔 → 置中裁正方形 → 縮到 512 → 重編碼 webp（不支援時退回 jpeg）
async function squareReencode(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OUTPUT_SIZE;
  canvas.getContext('2d').drawImage(
    bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  bitmap.close();
  let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  return { canvas, blob };
}

function studentCard(s, demoError) {
  const st = { color: s.theme_color, preset: s.avatar_preset, uploaded: null };
  const card = h('section', { class: 'card student-card', 'aria-labelledby': `t-${s.id}` });
  card.style.setProperty('--card-accent', st.color);

  // 標頭：目前頭像 + 名稱預覽
  const ringImg = h('img', { alt: `${s.name} 目前的頭像` });
  const chipImg = h('img', { alt: '' });
  const chipName = h('span', { text: s.name });
  const head = h('div', { class: 'student-card__head' },
    h('div', { class: 'avatar-ring' }, ringImg),
    h('div', {},
      h('h2', { id: `t-${s.id}`, text: s.name }),
      h('p', { class: 'hint', text: '前台切換鈕預覽：' }),
      h('span', { class: 'preview-chip' }, chipImg, chipName)));
  card.append(head);

  const refreshAvatar = () => {
    const src = st.uploaded || `avatars/${st.preset}.svg`;
    ringImg.src = src;
    chipImg.src = src;
    card.style.setProperty('--card-accent', st.color);
  };

  // 英文名
  const nameMsg = messageArea();
  const nameInput = h('input', {
    class: 'input', id: `n-${s.id}`, value: s.name, maxlength: '20', autocomplete: 'off',
    pattern: "[A-Za-z][A-Za-z .'-]*", 'aria-describedby': `nh-${s.id} ${nameMsg.errId}`,
  });
  nameInput.addEventListener('input', () => {
    chipName.textContent = nameInput.value || '（未填）';
    nameInput.removeAttribute('aria-invalid');
    nameMsg.show('ok', '');
  });
  card.append(h('div', { class: 'field' },
    h('label', { for: `n-${s.id}`, text: '英文名' }), nameInput,
    h('p', { class: 'hint', id: `nh-${s.id}`, text: '前台顯示用，可用英文字母、空白與 . \' -' }),
    nameMsg));

  // 主題色
  const sw = h('div', { class: 'swatches' });
  for (const c of SWATCHES) {
    const input = h('input', { type: 'radio', name: `c-${s.id}`, value: c.hex, 'aria-label': c.name });
    if (c.hex === st.color) input.checked = true;
    input.addEventListener('change', () => { st.color = c.hex; custom.value = c.hex; refreshAvatar(); });
    const span = h('span');
    span.style.setProperty('--sw', c.hex);
    sw.append(h('label', { class: 'swatch', title: c.name }, input, span));
  }
  const custom = h('input', { type: 'color', value: st.color, 'aria-label': '自訂主題色' });
  custom.addEventListener('input', () => {
    st.color = custom.value;
    sw.querySelectorAll('input').forEach((i) => (i.checked = false));
    refreshAvatar();
  });
  sw.append(h('label', { class: 'custom-color' }, custom, '自訂'));
  card.append(h('fieldset', { class: 'field' }, h('legend', { text: '主題色' }), sw));

  // 預設頭像
  const presets = h('div', { class: 'presets' });
  for (const p of PRESETS) {
    const input = h('input', { type: 'radio', name: `p-${s.id}`, value: p.id, 'aria-label': p.label });
    if (p.id === st.preset) input.checked = true;
    input.addEventListener('change', () => { st.preset = p.id; refreshAvatar(); });
    presets.append(h('label', { class: 'preset' }, input, h('img', { src: `avatars/${p.id}.svg`, alt: '' })));
  }
  card.append(h('fieldset', { class: 'field' }, h('legend', { text: '預設頭像' }), presets,
    h('p', { class: 'hint', text: '有上傳照片時會優先顯示照片。' })));

  // 上傳：可見的是真的 <button>，file input 完全隱藏，由按鈕觸發，焦點樣式自然落在按鈕上
  const preview = h('div', { class: 'dropzone__preview', text: '尚未上傳' });
  const file = h('input', { type: 'file', accept: ALLOWED_TYPES.join(','), hidden: '' });
  const pickBtn = h('button', { type: 'button', class: 'btn', text: '選擇圖片' });
  pickBtn.addEventListener('click', () => file.click());
  const upMsg = messageArea();
  const resetBtn = h('button', { type: 'button', class: 'btn', text: '恢復預設頭像' });
  resetBtn.disabled = true;
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    if (!ALLOWED_TYPES.includes(f.type)) {
      upMsg.show('error', `「${f.name}」不是 JPG、PNG 或 WebP，請換一張圖片。`);
      return;
    }
    if (f.size > MAX_SOURCE_BYTES) {
      upMsg.show('error', `「${f.name}」超過 10 MB，請先縮小再上傳。`);
      return;
    }
    try {
      const { canvas, blob } = await squareReencode(f);
      preview.replaceChildren(canvas);
      st.uploaded = canvas.toDataURL();
      refreshAvatar();
      resetBtn.disabled = false;
      upMsg.show('ok', `已裁成 512×512（${Math.round(blob.size / 1024)} KB），按「儲存」後才會上傳。`);
    } catch {
      upMsg.show('error', '這個檔案無法讀取成圖片，請換一張。');
    }
  });
  resetBtn.addEventListener('click', () => {
    st.uploaded = null;
    preview.replaceChildren('尚未上傳');
    resetBtn.disabled = true;
    refreshAvatar();
    pickBtn.focus();
    upMsg.show('ok', '已改回預設頭像，按「儲存」後會刪除上傳的照片。');
  });
  card.append(h('fieldset', { class: 'field' },
    h('legend', { text: '上傳照片' }),
    h('div', { class: 'dropzone' }, preview,
      h('div', {},
        h('p', { style: 'margin:0 0 8px', text: 'JPG、PNG 或 WebP。會自動裁成正方形並縮成 512 px。' }),
        h('div', { class: 'actions' }, pickBtn, resetBtn), file)),
    upMsg));

  // 錯誤狀態示範（截圖用）
  if (demoError) upMsg.show('error', '「class-photo.gif」不是 JPG、PNG 或 WebP，請換一張圖片。');

  const save = h('button', { type: 'button', class: 'btn btn--primary', text: `儲存 ${s.name} 的設定` });
  const saveMsg = messageArea();
  save.addEventListener('click', () => {
    if (!nameInput.checkValidity() || !nameInput.value.trim()) {
      nameInput.setAttribute('aria-invalid', 'true');
      nameMsg.show('error', '英文名只能有英文字母、空白、句點、撇號或連字號，而且不能空白。');
      nameInput.focus();
      return;
    }
    saveMsg.show('ok', `已儲存 ${nameInput.value} 的設定（模擬，未送出）。`);
  });
  card.append(h('div', { class: 'actions' }, save), saveMsg);

  refreshAvatar();
  return card;
}

const wrap = document.getElementById('studentCards');
MOCK_STUDENTS.forEach((s, i) => wrap.append(studentCard(s, i === 1)));
