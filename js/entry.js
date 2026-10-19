// entry.html 主要邏輯：登入狀態切換、段考成績（輸入／編輯）、校排名、學生與頭像、白名單（僅 super_admin）。
// 驗證與計算在 entryLogic.js；這裡只負責 DOM 與 Supabase。
// 安全：資料庫字串（學生名、科目名、email、錯誤訊息）一律用 textContent 輸出，不用 innerHTML。
// 權限真正的把關在 RLS 與 Storage 政策；前端隱藏按鈕只是介面。

const ADMIN_VIEWS = { scores: '段考成績', ranks: '校排名', students: '學生與頭像', admins: '白名單' };
const FALLBACK_ACCENT = '#F28B6D';

const entry = {
  status: null, // { email, role }
  students: [],
  subjects: [],
  existingScores: {}, // 目前選到那次段考、已在資料庫的分數 { subjectCode: score }
  existingDate: null,
  loadedScoreExam: null, // 最後一次「成功載入」的段考；跟畫面選擇不一致時不准存
  loadedRankExam: null,
  loadToken: { score: 0, rank: 0 }, // 只套用最新一次讀取的結果（避免慢回應蓋掉新選擇）
};

/* ================= 小工具 ================= */
const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v; // 走 CSSOM，不受 CSP 的 inline style 限制
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
};

// 每個訊息區一組常駐 live region：錯誤用 alert、成功用 status。
// 先清空、下一個 frame 再寫入，同一句話連續出現也會被報讀。
function messageArea(container, id) {
  const err = h('p', { class: 'msg msg--error', role: 'alert', id: `${id}-error` });
  const ok = h('p', { class: 'msg msg--ok', role: 'status', id: `${id}-ok` });
  container.replaceChildren(err, ok);
  const say = (target, other, text) => {
    other.textContent = '';
    target.textContent = '';
    requestAnimationFrame(() => { target.textContent = text; });
  };
  return {
    errorId: err.id,
    error(text) { say(err, ok, text); },
    ok(text) { say(ok, err, text); },
    clear() { err.textContent = ''; ok.textContent = ''; },
  };
}

// 被 RLS 擋下的 UPDATE／DELETE 不會報錯，只會影響 0 筆；用這個錯誤代表「實際沒寫進去」
const NO_ROWS = { code: 'NO_ROWS', message: 'no rows affected' };

// Supabase 錯誤轉成給家長看的句子；權限不足時講清楚原因
function describeError(error, action) {
  const raw = `${error?.message ?? ''} ${error?.code ?? ''}`;
  if (/row-level security|permission denied|42501|Unauthorized|403|NO_ROWS|PGRST116/i.test(raw)) {
    return `${action}失敗：這個帳號沒有寫入權限，請確認已加入白名單。`;
  }
  if (/JWT|session/i.test(raw)) return `${action}失敗：登入已過期，請重新整理頁面再登入一次。`;
  return `${action}失敗：${error?.message || '未知錯誤'}`;
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label ?? button.textContent;
    button.disabled = false;
  }
}

function markInvalid(input, msgArea, text) {
  input.setAttribute('aria-invalid', 'true');
  msgArea.error(text);
  input.focus();
}

const sameExam = (a, b) => !!a && !!b && a.student_id === b.student_id && a.grade === b.grade && a.semester === b.semester && a.exam_type === b.exam_type;

/* ================= 段考選擇器（成績、排名共用） ================= */
function buildExamPicker(container, prefix, onChange) {
  const field = (id, label, options) => {
    const select = h('select', { class: 'input', id });
    for (const [value, text] of options) select.append(h('option', { value: String(value), text }));
    select.addEventListener('change', onChange);
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), select);
  };
  container.replaceChildren(
    field(`${prefix}Student`, '學生', entry.students.map((s) => [s.id, s.name])),
    field(`${prefix}Grade`, '年級', [[1, '國一'], [2, '國二'], [3, '國三']]),
    field(`${prefix}Semester`, '學期', [[1, '上學期'], [2, '下學期']]),
    field(`${prefix}ExamType`, '段考', [[1, '第一次'], [2, '第二次'], [3, '第三次']]),
  );
}

function pickedExam(prefix) {
  const v = (id) => document.getElementById(`${prefix}${id}`).value;
  return { student_id: v('Student'), grade: Number(v('Grade')), semester: Number(v('Semester')), exam_type: Number(v('ExamType')) };
}

const examMatch = (q, ex) => q.eq('student_id', ex.student_id).eq('grade', ex.grade).eq('semester', ex.semester).eq('exam_type', ex.exam_type);
const examLabel = (ex) => `${entry.students.find((s) => s.id === ex.student_id)?.name ?? ''} ${slotLongLabel(ex)}`;

/* ================= 段考成績 ================= */
function buildSubjectInputs(msg) {
  const wrap = document.getElementById('subjectInputs');
  wrap.replaceChildren();
  for (const s of entry.subjects) {
    const id = `score-${s.code}`;
    wrap.append(h('div', { class: 'field' },
      h('label', { for: id, text: s.display_name }),
      h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: '0', max: '100', step: '0.5', id, 'data-subject': s.code, 'aria-describedby': msg.errorId })));
  }
}

// 選好學生與段考後，把資料庫裡的分數帶進表單，才能「編輯」。
// 讀取期間與讀取失敗時，欄位一律清空並鎖住，避免把上一次的分數存進這一次。
async function loadExistingScores(msg) {
  const ex = pickedExam('score');
  const token = ++entry.loadToken.score;
  const fields = document.getElementById('scoreFields');
  const status = document.getElementById('scoreStatus');
  entry.loadedScoreExam = null;
  fields.disabled = true;
  for (const input of document.querySelectorAll('#subjectInputs input')) {
    input.value = '';
    input.removeAttribute('aria-invalid');
  }
  document.getElementById('scoreExamDate').value = '';
  status.textContent = '讀取這次的紀錄中…';
  msg?.clear();

  const { data, error } = await examMatch(sbClient.from('exam_scores').select('subject, score, exam_date'), ex);
  if (token !== entry.loadToken.score) return; // 已經換成別次段考
  if (error) {
    console.error(error);
    status.textContent = `${describeError(error, '讀取')} 請重新選一次段考，或重新整理頁面。`;
    return; // 保持鎖住
  }
  entry.existingScores = Object.fromEntries(data.map((r) => [r.subject, Number(r.score)]));
  entry.existingDate = data.find((r) => r.exam_date)?.exam_date ?? null;
  for (const input of document.querySelectorAll('#subjectInputs input')) {
    const v = entry.existingScores[input.dataset.subject];
    input.value = v == null ? '' : String(v);
  }
  document.getElementById('scoreExamDate').value = entry.existingDate ?? '';
  status.textContent = data.length
    ? `${examLabel(ex)}：已有 ${data.length} 科紀錄，修改後按「儲存成績」。`
    : `${examLabel(ex)}：還沒有紀錄。`;
  entry.loadedScoreExam = ex;
  fields.disabled = false;
}

async function handleScoreSubmit(e, msg) {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('[type="submit"]');
  const ex = pickedExam('score');
  if (!sameExam(entry.loadedScoreExam, ex)) {
    msg.error('這次段考的紀錄還沒讀取完成，請稍候再儲存。');
    return;
  }

  const inputs = {};
  let badInput = null;
  for (const input of document.querySelectorAll('#subjectInputs input')) {
    input.removeAttribute('aria-invalid');
    // type=number 打到無法解析的內容時 value 會是空字串；不能當成「清空」，否則會誤刪
    if (input.validity.badInput) badInput ??= input;
    inputs[input.dataset.subject] = input.value;
  }
  if (badInput) {
    markInvalid(badInput, msg, `${entry.subjects.find((s) => s.code === badInput.dataset.subject)?.display_name ?? ''}：這格不是有效的數字，請重新輸入。`);
    return;
  }
  const { upserts, deletes, errors } = buildScoreChanges(entry.existingScores, inputs, entry.subjects);
  if (errors.length) {
    for (const err of errors) document.getElementById(`score-${err.code}`).setAttribute('aria-invalid', 'true');
    msg.error(errors.map((x) => x.message).join(' '));
    document.getElementById(`score-${errors[0].code}`).focus();
    return;
  }
  const examDate = document.getElementById('scoreExamDate').value || null;
  const hasExisting = Object.keys(entry.existingScores).length > 0;
  const dateChanged = hasExisting && examDate !== entry.existingDate;
  if (!upserts.length && !deletes.length) {
    if (!hasExisting) return msg.error('請至少輸入一科分數。');
    if (!dateChanged) return msg.ok('沒有任何變更。');
  }
  if (deletes.length) {
    const names = deletes.map((code) => entry.subjects.find((s) => s.code === code)?.display_name ?? code).join('、');
    if (!confirm(`要刪除 ${examLabel(ex)} 的 ${names} 分數嗎？（欄位清空＝刪除，刪除後無法復原）`)) return;
  }

  form.inert = true; // 儲存期間不能改段考或分數
  setBusy(button, true, '儲存中…');
  try {
    if (upserts.length) {
      const now = new Date().toISOString();
      const rows = upserts.map((u) => ({ ...ex, ...u, exam_date: examDate, updated_at: now }));
      const { error } = await sbClient.from('exam_scores').upsert(rows, { onConflict: 'student_id,grade,semester,exam_type,subject' });
      if (error) throw error;
    }
    if (deletes.length) {
      const { data, error } = await examMatch(sbClient.from('exam_scores').delete(), ex).in('subject', deletes).select('subject');
      if (error) throw error;
      if (data.length !== deletes.length) throw NO_ROWS;
    }
    // 考試日期是整次段考共用：有改就套到這次所有科目
    if (dateChanged) {
      const { data, error } = await examMatch(sbClient.from('exam_scores').update({ exam_date: examDate }), ex).select('subject');
      if (error) throw error;
      if (!data.length) throw NO_ROWS;
    }
    const parts = [];
    if (upserts.length) parts.push(`儲存 ${upserts.length} 科`);
    if (deletes.length) parts.push(`刪除 ${deletes.length} 科`);
    if (!parts.length) parts.push('更新考試日期');
    await loadExistingScores();
    msg.ok(`已${parts.join('、')}：${examLabel(ex)}。`);
  } catch (error) {
    console.error(error);
    // 三個請求不是原子操作：失敗時重新讀取，讓畫面跟資料庫一致
    await loadExistingScores();
    msg.error(`${describeError(error, '儲存')} 部分變更可能已寫入，畫面已重新讀取資料庫目前的內容。`);
  } finally {
    form.inert = false;
    setBusy(button, false);
  }
}

/* ================= 校排名 ================= */
async function loadExistingRank(msg) {
  const ex = pickedExam('rank');
  const token = ++entry.loadToken.rank;
  const fields = document.getElementById('rankFields');
  const status = document.getElementById('rankStatus');
  entry.loadedRankExam = null;
  fields.disabled = true;
  document.getElementById('rankValue').value = '';
  document.getElementById('rankTotal').value = '';
  status.textContent = '讀取這次的排名中…';
  msg?.clear();

  const { data, error } = await examMatch(sbClient.from('exam_rankings').select('rank, total_students'), ex).maybeSingle();
  if (token !== entry.loadToken.rank) return;
  if (error) {
    console.error(error);
    status.textContent = `${describeError(error, '讀取')} 請重新選一次段考，或重新整理頁面。`;
    return;
  }
  document.getElementById('rankValue').value = data ? String(data.rank) : '';
  document.getElementById('rankTotal').value = data ? String(data.total_students) : '';
  status.textContent = data ? `${examLabel(ex)}：目前是第 ${data.rank} 名／共 ${data.total_students} 人。` : `${examLabel(ex)}：還沒有排名紀錄。`;
  entry.loadedRankExam = ex;
  fields.disabled = false;
}

async function handleRankSubmit(e, msg) {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('[type="submit"]');
  const ex = pickedExam('rank');
  if (!sameExam(entry.loadedRankExam, ex)) {
    msg.error('這次段考的排名還沒讀取完成，請稍候再儲存。');
    return;
  }
  const rankInput = document.getElementById('rankValue');
  const totalInput = document.getElementById('rankTotal');
  rankInput.removeAttribute('aria-invalid');
  totalInput.removeAttribute('aria-invalid');
  const check = validateRanking(rankInput.validity.badInput ? 'x' : rankInput.value, totalInput.validity.badInput ? 'x' : totalInput.value);
  if (!check.ok) {
    markInvalid(/總人數/.test(check.error) ? totalInput : rankInput, msg, check.error);
    return;
  }
  form.inert = true;
  setBusy(button, true, '儲存中…');
  try {
    const { error } = await sbClient.from('exam_rankings').upsert(
      { ...ex, rank: check.rank, total_students: check.total, updated_at: new Date().toISOString() },
      { onConflict: 'student_id,grade,semester,exam_type' });
    if (error) throw error;
    await loadExistingRank();
    msg.ok(`已儲存：${examLabel(ex)} 第 ${check.rank} 名／共 ${check.total} 人。`);
  } catch (error) {
    console.error(error);
    msg.error(describeError(error, '儲存'));
  } finally {
    form.inert = false;
    setBusy(button, false);
  }
}

/* ================= 學生與頭像 ================= */
// 讀檔 → 置中裁正方形 → 縮到 512（小圖不放大）→ 重新編碼 webp（瀏覽器不支援時退回 jpeg）
async function reencodeAvatar(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = squareCropRect(bitmap.width, bitmap.height);
    if (!crop) throw new Error('empty image');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = crop.output;
    canvas.getContext('2d').drawImage(bitmap, crop.sx, crop.sy, crop.side, crop.side, 0, 0, crop.output, crop.output);
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('encode failed');
    return { canvas, blob };
  } finally {
    bitmap.close();
  }
}

// 從 avatar_url 取出 Storage 物件名稱（例如 e.webp）
function objectNameFromUrl(url) {
  return typeof url === 'string' ? url.split('?')[0].split('#')[0].split('/').pop() : null;
}

// 改名後同步更新段考選擇器裡的學生名稱
function renameStudentOptions(student) {
  for (const id of ['scoreStudent', 'rankStudent']) {
    const opt = document.querySelector(`#${id} option[value="${CSS.escape(student.id)}"]`);
    if (opt) opt.textContent = student.name;
  }
}

function studentCard(student) {
  // 編輯中的狀態：pending 是剛選好、還沒存的新圖；cleared 代表按了「恢復預設」；
  // colorTouched：只有家長真的點了色票才寫回主題色（避免把資料庫裡的色票外顏色洗成 null）
  const st = {
    color: isAllowedThemeColor(student.theme_color) ? student.theme_color.toUpperCase() : null,
    colorTouched: false,
    preset: isAllowedAvatarPreset(student.avatar_preset) ? student.avatar_preset : 'cat',
    pending: null,
    cleared: false,
  };
  const card = h('section', { class: 'card student-card', 'aria-labelledby': `t-${student.id}` });

  const ringImg = h('img', { alt: '' });
  const chipImg = h('img', { alt: '' });
  for (const img of [ringImg, chipImg]) {
    img.addEventListener('error', () => {
      const fallback = `assets/avatars/${st.preset}.svg`;
      if (!img.src.endsWith(fallback)) img.src = fallback;
    });
  }
  const chipName = h('span', { text: student.name });
  const title = h('h2', { id: `t-${student.id}`, text: student.name });
  card.append(h('div', { class: 'student-card__head' },
    h('div', { class: 'avatar-ring' }, ringImg),
    h('div', {}, title, h('p', { class: 'hint', text: '前台切換鈕預覽：' }), h('span', { class: 'preview-chip' }, chipImg, chipName))));

  const currentAvatarUrl = () => (st.cleared ? null : student.avatar_url);
  let resetBtn;
  const refresh = () => {
    const src = st.pending ? st.pending.previewUrl : avatarSrc({ avatar_url: currentAvatarUrl(), avatar_preset: st.preset }, SUPABASE_ORIGIN);
    ringImg.src = src;
    chipImg.src = src;
    card.style.setProperty('--card-accent', safeThemeColor(st.color ?? student.theme_color, FALLBACK_ACCENT));
    resetBtn.disabled = !st.pending && !currentAvatarUrl();
  };

  // 英文名
  const nameMsgBox = h('div', {});
  const nameMsg = messageArea(nameMsgBox, `n-msg-${student.id}`);
  const nameInput = h('input', { class: 'input', id: `n-${student.id}`, maxlength: '20', autocomplete: 'off', 'aria-describedby': `nh-${student.id} ${nameMsg.errorId}` });
  nameInput.value = student.name;
  nameInput.addEventListener('input', () => {
    chipName.textContent = nameInput.value.trim() || '（未填）';
    nameInput.removeAttribute('aria-invalid');
    nameMsg.clear();
  });
  card.append(h('div', { class: 'field' },
    h('label', { for: `n-${student.id}`, text: '英文名' }), nameInput,
    h('p', { class: 'hint', id: `nh-${student.id}`, text: '前台顯示用，可用英文字母、空白與 . \' -' }), nameMsgBox));

  // 主題色（只有色票，不開放任意色）
  const swatches = h('div', { class: 'swatches' });
  for (const c of THEME_SWATCHES) {
    const input = h('input', { type: 'radio', name: `c-${student.id}`, value: c.hex, 'aria-label': c.name });
    input.checked = st.color === c.hex;
    input.addEventListener('change', () => { st.color = c.hex; st.colorTouched = true; refresh(); });
    const dot = h('span');
    dot.style.setProperty('--sw', c.hex);
    swatches.append(h('label', { class: 'swatch', title: c.name }, input, dot));
  }
  card.append(h('fieldset', { class: 'field' }, h('legend', { text: '主題色' }), swatches));

  // 預設頭像
  const presets = h('div', { class: 'presets' });
  for (const p of AVATAR_PRESET_OPTIONS) {
    const input = h('input', { type: 'radio', name: `p-${student.id}`, value: p.id, 'aria-label': p.label });
    input.checked = st.preset === p.id;
    input.addEventListener('change', () => { st.preset = p.id; refresh(); });
    presets.append(h('label', { class: 'preset' }, input, h('img', { src: `assets/avatars/${p.id}.svg`, alt: '' })));
  }
  card.append(h('fieldset', { class: 'field' }, h('legend', { text: '預設頭像' }), presets,
    h('p', { class: 'hint', text: '有上傳照片時會優先顯示照片。' })));

  // 上傳照片：可見的是真的 <button>，file input 隱藏，由按鈕觸發
  const preview = h('div', { class: 'dropzone__preview', text: student.avatar_url ? '已上傳' : '尚未上傳' });
  const file = h('input', { type: 'file', accept: AVATAR_ALLOWED_TYPES.join(','), hidden: '' });
  const pickBtn = h('button', { type: 'button', class: 'btn', text: '選擇圖片' });
  resetBtn = h('button', { type: 'button', class: 'btn', text: '恢復預設頭像' });
  const upMsgBox = h('div', {});
  const upMsg = messageArea(upMsgBox, `up-msg-${student.id}`);
  pickBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    const check = validateAvatarFile(f);
    if (!check.ok) return upMsg.error(check.error);
    try {
      const { canvas, blob } = await reencodeAvatar(f);
      if (blob.size > AVATAR_BUCKET_MAX_BYTES) throw new Error('too large after encode');
      if (st.pending) URL.revokeObjectURL(st.pending.previewUrl);
      st.pending = { blob, previewUrl: URL.createObjectURL(blob) };
      st.cleared = false;
      preview.replaceChildren(canvas);
      refresh();
      upMsg.ok(`已裁成 ${canvas.width}×${canvas.height}（${Math.max(1, Math.round(blob.size / 1024))} KB），按「儲存」後才會上傳。`);
    } catch {
      // 檔案無法解碼是使用者端的正常情況（例如副檔名是 png 但內容損壞），只提示不記錯誤
      upMsg.error(`「${f.name}」無法讀取成圖片，請換一張。`);
    }
  });
  resetBtn.addEventListener('click', () => {
    if (st.pending) URL.revokeObjectURL(st.pending.previewUrl);
    st.pending = null;
    st.cleared = true;
    preview.replaceChildren('尚未上傳');
    refresh();
    pickBtn.focus();
    upMsg.ok('已改回預設頭像，按「儲存」後會刪除上傳的照片。');
  });
  card.append(h('fieldset', { class: 'field' },
    h('legend', { text: '上傳照片' }),
    h('div', { class: 'dropzone' }, preview,
      h('div', {},
        h('p', { style: 'margin:0 0 8px', text: 'JPG、PNG 或 WebP，10 MB 以內。會自動裁成正方形並縮成 512 px。' }),
        h('div', { class: 'actions' }, pickBtn, resetBtn), file)),
    upMsgBox));

  // 儲存
  const saveBtn = h('button', { type: 'button', class: 'btn btn--primary', text: `儲存 ${student.name} 的設定` });
  const saveMsgBox = h('div', {});
  const saveMsg = messageArea(saveMsgBox, `save-msg-${student.id}`);
  saveBtn.addEventListener('click', async () => {
    const name = validateStudentName(nameInput.value);
    if (!name.ok) return markInvalid(nameInput, nameMsg, name.error);
    if (st.colorTouched && !isAllowedThemeColor(st.color)) return saveMsg.error('請從色票選一個主題色。');

    const sent = { pending: st.pending, cleared: st.cleared }; // 記下這次送出的內容
    const oldName = objectNameFromUrl(student.avatar_url);
    const store = sbClient.storage.from('avatars');
    let uploadedPath = null;
    card.inert = true; // 儲存期間鎖住整張卡片，避免中途換圖被吃掉
    setBusy(saveBtn, true, '儲存中…');
    try {
      const update = { name: name.value, avatar_preset: st.preset };
      if (st.colorTouched) update.theme_color = st.color;

      if (sent.pending) {
        // 先確認網址會被前台與資料庫接受，再上傳（避免傳完才被 CHECK 擋、留下孤兒檔）
        const path = avatarObjectPath(student.id, sent.pending.blob.type);
        const url = versionedAvatarUrl(store.getPublicUrl(path).data.publicUrl, Date.now());
        if (!isSafeAvatarUrl(url, SUPABASE_ORIGIN)) throw new Error('頭像網址不是本專案的 Storage，已取消上傳');
        const { error: upError } = await store.upload(path, sent.pending.blob, { upsert: true, contentType: sent.pending.blob.type, cacheControl: '3600' });
        if (upError) throw upError;
        uploadedPath = path;
        update.avatar_url = url;
      } else if (sent.cleared) {
        update.avatar_url = null;
      }

      // 資料列成功更新之後，才清掉不再使用的舊檔
      const { data: saved, error } = await sbClient.from('students').update(update).eq('id', student.id).select().single();
      if (error) throw error;
      const stale = sent.pending
        ? avatarObjectPaths(student.id).filter((p) => p !== uploadedPath)
        : sent.cleared ? avatarObjectPaths(student.id) : [];
      if (stale.length) {
        const { error: rmError } = await store.remove(stale);
        if (rmError) console.warn('舊頭像檔案沒有清掉（資料已更新，不影響顯示）', rmError);
      }

      Object.assign(student, saved);
      if (st.pending === sent.pending) {
        if (st.pending) URL.revokeObjectURL(st.pending.previewUrl);
        st.pending = null;
        preview.replaceChildren(student.avatar_url ? '已上傳' : '尚未上傳');
        upMsg.clear();
      }
      if (st.cleared === sent.cleared) st.cleared = false;
      st.colorTouched = false;
      title.textContent = student.name;
      saveBtn.dataset.label = `儲存 ${student.name} 的設定`;
      renameStudentOptions(student);
      refresh();
      saveMsg.ok(`已儲存 ${student.name} 的設定，前台重新整理就會看到。`);
    } catch (error) {
      console.error(error);
      // 新檔已上傳但資料沒更新：如果它不是資料庫原本指向的那個檔，就刪掉，不留孤兒檔
      if (uploadedPath && uploadedPath !== oldName) await store.remove([uploadedPath]);
      saveMsg.error(describeError(error, '儲存'));
    } finally {
      card.inert = false;
      setBusy(saveBtn, false);
    }
  });
  card.append(h('div', { class: 'actions' }, saveBtn), saveMsgBox);

  refresh();
  return card;
}

function renderStudents() {
  const wrap = document.getElementById('studentCards');
  wrap.replaceChildren(...entry.students.map(studentCard));
}

/* ================= 白名單（super_admin） ================= */
async function renderAdminList(msg) {
  const list = document.getElementById('adminList');
  const { data, error } = await sbClient.from('admins').select('email, role').order('created_at');
  if (error) {
    list.replaceChildren(h('li', { class: 'hint', text: describeError(error, '讀取白名單') }));
    return;
  }
  list.replaceChildren();
  for (const a of data) {
    const isSuper = a.role === 'super_admin';
    const li = h('li', { class: 'admin-list__item' },
      h('span', { class: 'admin-list__email', text: a.email }),
      h('span', { class: 'tag', text: isSuper ? '主管理帳號' : '管理員' }));
    if (!isSuper) {
      const btn = h('button', { type: 'button', class: 'btn', text: '移除' });
      btn.setAttribute('aria-label', `移除 ${a.email}`);
      btn.addEventListener('click', async () => {
        if (!confirm(`確定要移除 ${a.email} 的編輯權限嗎？`)) return;
        setBusy(btn, true, '移除中…');
        try {
          const { data: removed, error: delError } = await sbClient.from('admins').delete().eq('email', a.email).select('email');
          if (delError) throw delError;
          if (!removed.length) throw NO_ROWS;
          msg.ok(`已移除 ${a.email}。`);
          await renderAdminList(msg);
        } catch (err) {
          console.error(err);
          msg.error(describeError(err, '移除'));
          setBusy(btn, false);
        }
      });
      li.append(btn);
    }
    list.append(li);
  }
}

async function handleAddAdmin(e, msg) {
  e.preventDefault();
  const input = document.getElementById('newAdminEmail');
  const button = e.target.querySelector('[type="submit"]');
  input.removeAttribute('aria-invalid');
  const check = validateEmail(input.value);
  if (!check.ok) return markInvalid(input, msg, check.error);
  setBusy(button, true, '加入中…');
  try {
    const { error } = await sbClient.from('admins').insert({ email: check.value, role: 'admin' });
    if (error) {
      msg.error(/duplicate|23505/i.test(`${error.message} ${error.code}`) ? '這個 Email 已經在白名單裡了。' : describeError(error, '新增'));
      return;
    }
    input.value = '';
    msg.ok(`已加入 ${check.value}。`);
    await renderAdminList(msg);
  } finally {
    setBusy(button, false);
  }
}

/* ================= 路由與初始化 ================= */
function renderRoute() {
  const views = entry.status?.role === 'super_admin' ? ADMIN_VIEWS : { scores: 1, ranks: 1, students: 1 };
  const { name } = parseRoute(location.hash, views);
  const current = name === 'home' ? 'scores' : name;
  document.querySelectorAll('#entryPanel .view').forEach((v) => (v.hidden = v.dataset.view !== current));
  document.querySelectorAll('.admin-nav a').forEach((a) => {
    if (a.dataset.route === current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${ADMIN_VIEWS[current]}・家長管理`;
  return current;
}

function showPanel(name) {
  for (const id of ['loginGate', 'noAccessPanel', 'entryPanel']) document.getElementById(id).hidden = id !== name;
}

const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(window.APP_CONFIG.SUPABASE_URL).origin;
  } catch {
    return null;
  }
})();

async function init() {
  const loadMsg = document.getElementById('loadMsg');
  document.getElementById('googleLoginBtn').addEventListener('click', loginWithGoogle);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('logoutBtnNoAccess').addEventListener('click', logout);

  let status;
  try {
    status = await getCurrentAdminStatus();
  } catch (error) {
    console.error(error);
    loadMsg.className = 'load-msg load-msg--error';
    loadMsg.textContent = '無法確認登入狀態，請稍後重新整理頁面。';
    return;
  }
  loadMsg.textContent = '';
  entry.status = status;

  if (!status) return showPanel('loginGate');
  document.getElementById('who').hidden = false;
  document.getElementById('loggedInEmail').textContent = status.email;
  if (status.role === 'none') return showPanel('noAccessPanel');

  const [studentsRes, subjectsRes] = await Promise.all([
    sbClient.from('students').select('id, name, theme_color, avatar_preset, avatar_url, enrolled_year').order('enrolled_year'),
    sbClient.from('subjects').select('code, display_name, sort_order').order('sort_order'),
  ]);
  if (studentsRes.error || subjectsRes.error) {
    console.error(studentsRes.error || subjectsRes.error);
    loadMsg.className = 'load-msg load-msg--error';
    loadMsg.textContent = '學生或科目資料讀取失敗，請稍後重新整理頁面。';
    return;
  }
  entry.students = studentsRes.data;
  entry.subjects = subjectsRes.data;
  showPanel('entryPanel');

  const scoreMsg = messageArea(document.querySelector('[data-msg="score"]'), 'score-msg');
  const rankMsg = messageArea(document.querySelector('[data-msg="rank"]'), 'rank-msg');
  const adminMsg = messageArea(document.querySelector('[data-msg="admin"]'), 'admin-msg');
  for (const id of ['rankValue', 'rankTotal']) document.getElementById(id).setAttribute('aria-describedby', rankMsg.errorId);
  document.getElementById('newAdminEmail').setAttribute('aria-describedby', `adminEmailHint ${adminMsg.errorId}`);

  buildExamPicker(document.querySelector('[data-picker="score"]'), 'score', () => loadExistingScores(scoreMsg));
  buildExamPicker(document.querySelector('[data-picker="rank"]'), 'rank', () => loadExistingRank(rankMsg));
  buildSubjectInputs(scoreMsg);
  document.getElementById('scoreForm').addEventListener('submit', (e) => handleScoreSubmit(e, scoreMsg));
  document.getElementById('rankForm').addEventListener('submit', (e) => handleRankSubmit(e, rankMsg));
  renderStudents();

  if (status.role === 'super_admin') {
    document.querySelector('.admin-nav a[data-route="admins"]').hidden = false;
    document.getElementById('addAdminForm').addEventListener('submit', (e) => handleAddAdmin(e, adminMsg));
    renderAdminList(adminMsg);
  }

  window.addEventListener('hashchange', () => {
    const current = renderRoute();
    document.querySelector(`#entryPanel .view[data-view="${current}"] h1`)?.focus({ preventScroll: true });
  });
  document.querySelectorAll('#entryPanel .view h1').forEach((h1) => h1.setAttribute('tabindex', '-1'));
  renderRoute();
  loadExistingScores(scoreMsg);
  loadExistingRank(rankMsg);
}

document.addEventListener('DOMContentLoaded', init);
