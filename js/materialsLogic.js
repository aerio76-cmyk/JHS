// 學習資料庫的純函式：資料夾樹、名稱與標題檢查、批次上傳流程（含失敗補償）、孤兒檔案比對。
// 不碰 DOM、不直接連網路（Supabase 操作由呼叫端以 deps 注入），瀏覽器與 node --test 共用。
// 規則需與 supabase/patches/2026-11-07_materials.sql 的約束一致；資料庫才是最後把關。

const FOLDER_MAX_DEPTH = 3;
const FOLDER_NAME_MAX = 20;
const TITLE_MAX = 60;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000; // 24 小時內建立的檔案可能還在上傳流程中（含裝置休眠），不算孤兒
// 看不見的字元：控制字元、軟連字號、零寬字元、方向控制、BOM（與資料庫約束相同）
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
const EDGE_SPACE_RE = /^[ \u3000]+|[ \u3000]+$/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* ---------------- 名稱與標題 ---------------- */
// 移除看不見的字元與孤立的代理字元；tab、換行與連續半形空白收斂成一個空白；前後空白（含全形）去掉。
// 內文的全形空白保留（例如「第一章　數列」），與資料庫只修剪前後的規則一致
function cleanText(raw) {
  return String(raw ?? '')
    .replace(/[\t\n\r\f\v ]+/g, ' ')
    .replace(INVISIBLE_RE, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(EDGE_SPACE_RE, '');
}

function validateFolderName(raw, siblings = []) {
  const name = cleanText(raw);
  if (!name) return { ok: false, error: '請輸入資料夾名稱。' };
  if ([...name].length > FOLDER_NAME_MAX) return { ok: false, error: `資料夾名稱最多 ${FOLDER_NAME_MAX} 個字。` };
  if (siblings.some((s) => s === name)) return { ok: false, error: `這一層已經有「${name}」了，請換一個名稱。` };
  return { ok: true, value: name };
}

function validateTitle(raw) {
  const title = cleanText(raw);
  if (!title) return { ok: false, error: '請輸入標題。' };
  if ([...title].length > TITLE_MAX) return { ok: false, error: `標題最多 ${TITLE_MAX} 個字。` };
  return { ok: true, value: title };
}

// 從檔名產生預設標題：去掉副檔名、底線換成空白、截到 60 字
function titleFromFilename(filename) {
  const base = String(filename ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ');
  const t = cleanText(base);
  return t ? [...t].slice(0, TITLE_MAX).join('').replace(EDGE_SPACE_RE, '') : '未命名圖片';
}

/* ---------------- 資料夾樹 ---------------- */
// folders：[{ id, parent_id, name, sort, is_system, system_key }]
function buildFolderTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, { ...f, children: [] }]));
  const roots = [];
  for (const f of byId.values()) {
    const parent = f.parent_id ? byId.get(f.parent_id) : null;
    if (parent) parent.children.push(f);
    else if (!f.parent_id) roots.push(f);
  }
  const order = (a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'zh-Hant');
  const sortDeep = (list) => { list.sort(order); list.forEach((n) => sortDeep(n.children)); };
  sortDeep(roots);
  return { roots, byId };
}

function folderPath(byId, id) {
  const path = [];
  const seen = new Set();
  for (let f = byId.get(id); f && !seen.has(f.id); f = f.parent_id ? byId.get(f.parent_id) : null) {
    seen.add(f.id);
    path.unshift(f);
  }
  return path;
}

const folderDepth = (byId, id) => folderPath(byId, id).length;
const canAddSubfolder = (byId, id) => byId.has(id) && folderDepth(byId, id) < FOLDER_MAX_DEPTH;

function descendantIds(byId, id) {
  const out = [];
  const walk = (fid) => {
    out.push(fid);
    for (const c of byId.get(fid)?.children ?? []) walk(c.id);
  };
  if (byId.has(id)) walk(id);
  return out;
}

// 新增資料夾的排序值：同層最大值 + 1（預設子資料夾是 1..3，自訂的才會排在後面）
function nextSort(siblings) {
  return siblings.reduce((m, s) => Math.max(m, Number(s.sort) || 0), 0) + 1;
}

// 頂層分類的圖示路徑（風格 B）
function categoryIcon(systemKey) {
  const keys = ['chinese', 'english', 'math', 'science', 'social', 'other'];
  return keys.includes(systemKey) ? `assets/materials-icons/${systemKey}.svg` : null;
}

/* ---------------- 檔名 ---------------- */
const extFor = (mime) => (mime === 'image/webp' ? 'webp' : 'jpg');
function materialPaths(uuid, mainMime, thumbMime) {
  if (!UUID_RE.test(String(uuid))) throw new Error('invalid uuid');
  return { storage_path: `${uuid}.${extFor(mainMime)}`, thumb_path: `${uuid}_t.${extFor(thumbMime)}` };
}

/* ---------------- 上傳流程（含補償） ---------------- */
// 網路類錯誤才值得重試；權限、格式、大小錯誤重試也沒用
function isRetryableError(error) {
  if (!error) return false;
  if (error.retryable === false) return false;
  const raw = `${error.message ?? ''} ${error.code ?? ''} ${error.status ?? error.statusCode ?? ''}`;
  if (/row-level security|permission|42501|403|401|mime|exceed|too large|413|duplicate|23505|check constraint|23514/i.test(raw)) return false;
  return /fetch|network|timeout|timed out|Failed to|ECONN|5\d\d|429/i.test(raw);
}

/**
 * 上傳一張：（取得上傳槽位）→ 壓縮 → 上傳大圖 → 上傳縮圖 → 寫資料列。
 * 先取得上傳槽位再壓縮：同時最多只有「上傳並行數」張壓好的圖在記憶體裡（不會一路壓在前面）。
 * 補償：縮圖失敗刪大圖；寫列「確定被拒」才刪兩檔。寫列結果不確定（網路中斷、逾時）時先查這筆有沒有寫進去：
 *   有 → 當成功；沒有或查不到 → 保留檔案，回傳 resume，重試時沿用同一個 id 與檔案只重寫資料列（不會重複、不會壞圖）。
 * deps（呼叫端提供；瀏覽器接 Supabase，測試接假的）：
 *   process(file) → { blob, thumb }；uuid() → string；upload(path, blob) → { error }；remove(paths) → { error }
 *   insert(row) → { data, error }；fetchRow(id) → { data, error }（data 為 null 代表確定沒有）
 *   onStage(stage)（選用）：'processing' | 'uploading' | 'saving'
 * 回傳 { ok: true, row } 或 { ok: false, stage, retryable, error, cleanupFailed, resume }。
 */
async function uploadMaterial({ file, folderId, title, resume = null }, deps, limits = {}) {
  const runProcess = limits.process || ((fn) => fn());
  const runUpload = limits.upload || ((fn) => fn());
  const stage = (s) => deps.onStage && deps.onStage(s);
  return runUpload(async () => {
    let id;
    let paths;
    if (resume) {
      ({ id, paths } = resume);
    } else {
      let processed;
      try {
        processed = await runProcess(() => { stage('processing'); return deps.process(file); });
      } catch (error) {
        return { ok: false, stage: 'process', retryable: false, error };
      }
      id = deps.uuid();
      paths = materialPaths(id, processed.blob.type, processed.thumb.type);
      stage('uploading');
      const up1 = await safe(() => deps.upload(paths.storage_path, processed.blob));
      if (up1.error) return { ok: false, stage: 'upload', retryable: isRetryableError(up1.error), error: up1.error };
      const up2 = await safe(() => deps.upload(paths.thumb_path, processed.thumb));
      if (up2.error) {
        const rm = await safe(() => deps.remove([paths.storage_path]));
        return { ok: false, stage: 'upload', retryable: isRetryableError(up2.error), error: up2.error, cleanupFailed: Boolean(rm.error) };
      }
    }
    stage('saving');
    const ins = await safe(() => deps.insert({ id, folder_id: folderId, title, ...paths }));
    if (ins.data && !ins.error) return { ok: true, row: ins.data };
    const error = ins.error || { message: 'no rows returned', code: 'NO_ROWS' };
    const definite = isDefiniteRejection(ins.error) && !/duplicate|23505/i.test(`${ins.error.message} ${ins.error.code}`);
    if (definite) {
      const rm = await safe(() => deps.remove([paths.storage_path, paths.thumb_path]));
      return { ok: false, stage: 'save', retryable: false, error, cleanupFailed: Boolean(rm.error) };
    }
    // 結果不確定（或主鍵重複：上次其實寫進去了）：查這筆
    const check = await safe(() => deps.fetchRow(id));
    if (check.data) return { ok: true, row: check.data };
    return { ok: false, stage: 'save', retryable: true, error, resume: { id, paths } };
  });
}

/**
 * 換圖：處理新圖 → 上傳到「新檔名」→ 更新資料列 → 刪舊檔。
 * 更新結果不確定時先重讀這筆：已指向新檔 → 當成功並刪舊檔；仍是舊檔 → 刪新檔；查不到 → 什麼都不刪（交給孤兒清理）。
 * deps 同上，另加 update(id, patch) → { data, error }。
 */
async function replaceMaterialImage({ row, file }, deps) {
  let processed;
  try {
    processed = await deps.process(file);
  } catch (error) {
    return { ok: false, stage: 'process', retryable: false, error };
  }
  const id = deps.uuid();
  const paths = materialPaths(id, processed.blob.type, processed.thumb.type);
  const up1 = await safe(() => deps.upload(paths.storage_path, processed.blob));
  if (up1.error) return { ok: false, stage: 'upload', retryable: isRetryableError(up1.error), error: up1.error };
  const up2 = await safe(() => deps.upload(paths.thumb_path, processed.thumb));
  if (up2.error) {
    await safe(() => deps.remove([paths.storage_path]));
    return { ok: false, stage: 'upload', retryable: isRetryableError(up2.error), error: up2.error };
  }
  const removeOld = async (newRow) => {
    const rm = await safe(() => deps.remove([row.storage_path, row.thumb_path]));
    return { ok: true, row: newRow, oldFilesLeft: Boolean(rm.error) };
  };
  const upd = await safe(() => deps.update(row.id, paths));
  if (upd.data && !upd.error) return removeOld(upd.data);
  const error = upd.error || { message: 'no rows affected', code: 'NO_ROWS' };
  const check = await safe(() => deps.fetchRow(row.id));
  if (check.data && check.data.storage_path === paths.storage_path) return removeOld(check.data);
  if (check.data || (!check.error && check.data === null)) {
    // 確定還是舊檔（或這筆已被刪除）：新檔沒人用，刪掉
    await safe(() => deps.remove([paths.storage_path, paths.thumb_path]));
    return { ok: false, stage: 'save', retryable: false, error };
  }
  return { ok: false, stage: 'save', retryable: false, error, uncertain: true };
}

// 確定被資料庫或 Storage 拒絕（權限、約束、外鍵）：只有這種情況才可以放心刪掉剛上傳的檔案
function isDefiniteRejection(error) {
  if (!error) return false;
  const raw = `${error.message ?? ''} ${error.code ?? ''} ${error.status ?? error.statusCode ?? ''}`;
  return /row-level security|permission denied|42501|check constraint|23514|foreign key|23503|violates|22001|PGRST204/i.test(raw);
}

// 把丟出的例外也轉成 { error }，流程裡統一處理
async function safe(fn) {
  try {
    const r = await fn();
    return r || {};
  } catch (error) {
    return { error };
  }
}

// 同時最多 n 個（壓縮 1、上傳 2）
function createLimiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

/* ---------------- 刪除與孤兒檔案 ---------------- */
// 刪資料夾前：收集整個子樹裡所有圖片的檔案路徑（之後走 Storage API 刪）
function collectFolderFiles(byId, folderId, materials) {
  const ids = new Set(descendantIds(byId, folderId));
  const rows = materials.filter((m) => ids.has(m.folder_id));
  return { count: rows.length, folderCount: ids.size, paths: rows.flatMap((m) => [m.storage_path, m.thumb_path]) };
}

// bucket 裡沒有對應資料列的檔案；剛建立的（可能還在上傳中）先不算。
// 時間基準用伺服器時間（檔案清單裡最新的 created_at），不受這台裝置時鐘快慢影響；只有在不晚於本機時間時才採用
function findOrphans(files, materials, now = Date.now(), graceMs = ORPHAN_GRACE_MS) {
  const used = new Set(materials.flatMap((m) => [m.storage_path, m.thumb_path]));
  const times = files.map((f) => Date.parse(f?.created_at || f?.updated_at || '')).filter(Number.isFinite);
  const reference = times.length ? Math.min(now, Math.max(...times)) : now;
  return files.filter((f) => {
    if (!f || !f.name || used.has(f.name)) return false;
    const t = Date.parse(f.created_at || f.updated_at || '');
    return Number.isFinite(t) && reference - t > graceMs;
  });
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024 * 1024) return `${Math.max(0, Math.round(v / 1024))} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1048576).toFixed(1)} MB`;
  return `${(v / 1073741824).toFixed(2)} GB`;
}

// 批次上傳的摘要文字
function uploadSummary(items) {
  const n = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const busy = n - done - failed;
  const parts = [`${done} 張完成`];
  if (busy) parts.push(`${busy} 張處理中`);
  if (failed) parts.push(`${failed} 張沒有上傳`);
  return `${n} 張中：${parts.join('、')}`;
}

/* ---------------- 孩子端（materials.html） ---------------- */
// 觀看登入失敗的訊息：固定中文，不直接顯示伺服器回傳的文字；
// 不區分「帳號不存在」與「密碼錯誤」，避免洩漏帳號是否存在
function viewerLoginMessage(error) {
  if (!error) return '';
  const raw = `${error.code ?? ''} ${error.status ?? ''} ${error.message ?? ''}`;
  if (/over_request_rate_limit|over_email_send_rate_limit|429|rate limit/i.test(raw)) return '嘗試次數太多，請過幾分鐘再試。';
  if (/invalid_credentials|invalid login|400|email_not_confirmed|user_banned|validation_failed/i.test(raw)) return '帳號或密碼不正確，請再試一次。';
  if (error.status === 0 || error.name === 'AuthRetryableFetchError' || /load failed/i.test(raw)) return '無法連線，請確認網路後再試一次。'; // iPad Safari 的網路錯誤
  if (/fetch|network|timeout|5\d\d/i.test(raw)) return '無法連線，請確認網路後再試一次。';
  return '登入沒有成功，請再試一次；如果一直失敗，請問家長。';
}

// 只看「學習中」的圖片（管理員登入時資料庫會回傳全部，前端也要自己過濾）
const activeMaterials = (materials) => materials.filter((m) => !m.is_learned);

// 標題搜尋：不分大小寫、忽略多餘空白；空字串回傳空陣列
function searchMaterials(materials, query) {
  const q = cleanText(query).toLowerCase();
  if (!q) return [];
  const words = q.split(new RegExp(`[ ${String.fromCharCode(0x3000)}]+`)).filter(Boolean); // 全形空白也當分隔
  return materials.filter((m) => {
    const t = String(m.title ?? '').toLowerCase();
    return words.every((w) => t.includes(w));
  });
}

// 最近新增：依建立時間由新到舊
function recentMaterials(materials, n = 8) {
  return [...materials].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || String(a.id).localeCompare(String(b.id))).slice(0, n);
}

// 資料夾（含子資料夾）裡有幾張圖；孩子端隱藏 0 張的子資料夾（頂層分類一律顯示）
function deepMaterialCount(byId, folderId, materials) {
  const ids = new Set(descendantIds(byId, folderId));
  return materials.filter((m) => ids.has(m.folder_id)).length;
}

function visibleSubfolders(byId, folderId, materials) {
  return (byId.get(folderId)?.children ?? []).filter((c) => deepMaterialCount(byId, c.id, materials) > 0);
}

if (typeof module !== 'undefined') {
  module.exports = {
    FOLDER_MAX_DEPTH, FOLDER_NAME_MAX, TITLE_MAX, ORPHAN_GRACE_MS,
    cleanText, validateFolderName, validateTitle, titleFromFilename,
    buildFolderTree, folderPath, folderDepth, canAddSubfolder, descendantIds, nextSort, categoryIcon,
    materialPaths, isRetryableError, isDefiniteRejection, uploadMaterial, replaceMaterialImage, createLimiter,
    collectFolderFiles, findOrphans, formatBytes, uploadSummary,
    viewerLoginMessage, activeMaterials, searchMaterials, recentMaterials, deepMaterialCount, visibleSubfolders,
  };
}
