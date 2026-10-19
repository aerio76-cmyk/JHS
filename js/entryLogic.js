// 家長端（entry.html）的純函式：表單驗證、成績變更計算、頭像檔案驗證與裁切尺寸。
// 不碰 DOM、不連網路，瀏覽器與 node --test 共用。

// 主題色票：兩位學生的預設色 + 4 個備選（不開放任意色，確保文字加深後對比 ≥ 4.5:1）
const THEME_SWATCHES = [
  { hex: '#F28B6D', name: '珊瑚橘' },
  { hex: '#3FA796', name: '青綠' },
  { hex: '#6C8EF2', name: '天空藍' },
  { hex: '#E6A93B', name: '芥末黃' },
  { hex: '#B57FD8', name: '薰衣草紫' },
  { hex: '#E77FA6', name: '莓果粉' },
];

const AVATAR_PRESET_OPTIONS = [
  { id: 'cat', label: '貓咪' },
  { id: 'bunny', label: '兔子' },
  { id: 'bear', label: '小熊' },
  { id: 'penguin', label: '企鵝' },
];

const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX_SOURCE_BYTES = 10 * 1024 * 1024; // 原始檔上限；重新編碼後遠小於 bucket 的 2 MB
const AVATAR_BUCKET_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 512;

function isAllowedThemeColor(hex) {
  return THEME_SWATCHES.some((s) => s.hex.toLowerCase() === String(hex).toLowerCase());
}

function isAllowedAvatarPreset(id) {
  return AVATAR_PRESET_OPTIONS.some((p) => p.id === id);
}

// 英文名：英文字母開頭，可含空白、句點、撇號、連字號，最多 20 字（資料庫只要求非空，這裡把關前台顯示）
function validateStudentName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, error: '請填寫英文名。' };
  if (name.length > 20) return { ok: false, error: '英文名最多 20 個字。' };
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(name)) return { ok: false, error: '英文名只能有英文字母、空白、句點、撇號或連字號，並以字母開頭。' };
  return { ok: true, value: name };
}

// 單科分數：空白＝沒填；其餘必須是 0–100、以 0.5 為單位
function parseScoreInput(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: true, value: null };
  // 只接受一般十進位寫法（Number() 會把 0x10、1e2 也當數字）
  if (!/^\d{1,3}(\.\d+)?$/.test(text)) return { ok: false, error: '分數要在 0 到 100 之間。' };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: '分數要在 0 到 100 之間。' };
  if (Math.round(n * 2) !== n * 2) return { ok: false, error: '分數以 0.5 分為單位。' };
  return { ok: true, value: n };
}

// 比對「資料庫既有分數」與「表單輸入」，算出要寫入與要刪除的科目。
// existing：{ subjectCode: score }；inputs：{ subjectCode: 原始輸入字串 }
function buildScoreChanges(existing, inputs, subjects) {
  existing = existing ?? {};
  inputs = inputs ?? {};
  const upserts = [];
  const deletes = [];
  const errors = [];
  for (const subj of subjects) {
    const parsed = parseScoreInput(inputs[subj.code]);
    if (!parsed.ok) {
      errors.push({ code: subj.code, message: `${subj.display_name}：${parsed.error}` });
      continue;
    }
    const before = existing[subj.code];
    if (parsed.value == null) {
      if (before != null) deletes.push(subj.code); // 原本有分數、這次清空＝刪除這科
    } else if (before == null || Number(before) !== parsed.value) {
      upserts.push({ subject: subj.code, score: parsed.value });
    }
  }
  return { upserts, deletes, errors };
}

// 校排名：正整數，且名次 ≤ 總人數
function validateRanking(rankRaw, totalRaw) {
  const rankText = String(rankRaw ?? '').trim();
  const totalText = String(totalRaw ?? '').trim();
  if (!/^\d{1,6}$/.test(rankText)) return { ok: false, error: '名次要是 1 以上的整數。' };
  if (!/^\d{1,6}$/.test(totalText)) return { ok: false, error: '總人數要是 1 以上的整數。' };
  const rank = Number(rankText);
  const total = Number(totalText);
  if (!Number.isInteger(rank) || rank < 1) return { ok: false, error: '名次要是 1 以上的整數。' };
  if (!Number.isInteger(total) || total < 1) return { ok: false, error: '總人數要是 1 以上的整數。' };
  if (rank > total) return { ok: false, error: '名次不能大於總人數。' };
  return { ok: true, rank, total };
}

function validateEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) || email.length > 254) {
    return { ok: false, error: '請輸入有效的 Email。' };
  }
  return { ok: true, value: email };
}

// 上傳前檢查原始檔（只看 type 與大小；真正能不能解碼由 createImageBitmap 決定）
function validateAvatarFile(file) {
  if (!file) return { ok: false, error: '沒有選到檔案。' };
  const name = String(file.name ?? '這個檔案');
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) return { ok: false, error: `「${name}」不是 JPG、PNG 或 WebP，請換一張圖片。` };
  if (!(file.size > 0)) return { ok: false, error: `「${name}」是空的檔案，請換一張圖片。` };
  if (file.size > AVATAR_MAX_SOURCE_BYTES) return { ok: false, error: `「${name}」超過 10 MB，請先縮小再上傳。` };
  return { ok: true };
}

// 置中裁成正方形：回傳來源圖要取的區域（sx, sy, side），以及輸出邊長（不放大小圖）
function squareCropRect(width, height, outputSize = AVATAR_OUTPUT_SIZE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const side = Math.min(width, height);
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
    output: Math.min(outputSize, side),
  };
}

// Storage 物件路徑：固定 {student_id}.webp；瀏覽器不支援 webp 編碼時改存 .jpg
function avatarObjectPath(studentId, mimeType) {
  return `${studentId}.${mimeType === 'image/webp' ? 'webp' : 'jpg'}`;
}

// 同一位學生所有可能的頭像物件（換檔或恢復預設時一併清掉，避免留下另一種副檔名的舊檔）
function avatarObjectPaths(studentId) {
  return [`${studentId}.webp`, `${studentId}.jpg`];
}

// 公開網址加上版本參數，換圖後瀏覽器不會拿到舊快取
function versionedAvatarUrl(publicUrl, version) {
  const [beforeHash, ...hashParts] = String(publicUrl).split('#');
  const base = beforeHash.split('?')[0];
  const hash = hashParts.length ? `#${hashParts.join('#')}` : '';
  return `${base}?v=${encodeURIComponent(String(version))}${hash}`;
}

if (typeof module !== 'undefined') {
  module.exports = {
    THEME_SWATCHES, AVATAR_PRESET_OPTIONS, AVATAR_ALLOWED_TYPES, AVATAR_MAX_SOURCE_BYTES, AVATAR_BUCKET_MAX_BYTES, AVATAR_OUTPUT_SIZE,
    isAllowedThemeColor, isAllowedAvatarPreset, validateStudentName, parseScoreInput, buildScoreChanges,
    validateRanking, validateEmail, validateAvatarFile, squareCropRect, avatarObjectPath, avatarObjectPaths, versionedAvatarUrl,
  };
}
