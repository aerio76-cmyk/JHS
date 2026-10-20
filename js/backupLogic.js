// 資料備份與還原的純函式：分頁讀取、CSV 序列化（含公式注入防護）、JSON 備份格式、還原 SQL 產生。
// 不碰 DOM、不連網路，瀏覽器與 node --test 共用。
// 還原只產生 SQL 文字檔，由使用者在 Supabase SQL Editor 手動執行（網站本身不寫回資料庫）。
// ⚠ 還原 SQL 會以高權限執行，所以備份檔一律視為「不可信任的輸入」：每個值都先驗證型別與格式，
//   任何不合格就整份拒絕，不產生半份 SQL；所有寫進 SQL 的字串都經過 sqlLiteral 或 sqlComment。

const BACKUP_FORMAT = 'jhs-backup-1';
const BACKUP_PAGE_SIZE = 1000; // 每頁請求的列數（伺服器實際上限可能更小，fetchAllRows 不依賴它）
const BACKUP_MAX_ROWS = 10000; // 每張表的合理上限（2 位學生 × 18 次 × 5 科\uFF1D180 列）
const TEXT_MAX_LENGTH = 1000;

// 每張表要備份的欄位。exam_scores／exam_rankings 的 identity 主鍵 id 不備份（還原時以唯一鍵比對）；
// students.avatar_url 不備份：頭像圖檔不在備份裡，且網址含專案位址（還原到別的專案會被 CHECK 擋下）。
const BACKUP_COLUMNS = {
  students: ['id', 'name', 'theme_color', 'avatar_preset', 'enrolled_year', 'created_at'],
  exam_scores: ['student_id', 'grade', 'semester', 'exam_type', 'subject', 'score', 'exam_date', 'created_at', 'updated_at'],
  exam_rankings: ['student_id', 'grade', 'semester', 'exam_type', 'rank', 'total_students', 'created_at', 'updated_at'],
};
const REQUIRED_COLUMNS = {
  students: ['id', 'name', 'enrolled_year'],
  exam_scores: ['student_id', 'grade', 'semester', 'exam_type', 'subject', 'score'],
  exam_rankings: ['student_id', 'grade', 'semester', 'exam_type', 'rank', 'total_students'],
};
// 分頁要穩定排序，否則翻頁時可能漏列或重複（排序鍵\uFF1D唯一鍵）
const BACKUP_ORDER = {
  students: ['id'],
  exam_scores: ['student_id', 'grade', 'semester', 'exam_type', 'subject'],
  exam_rankings: ['student_id', 'grade', 'semester', 'exam_type'],
};
const CONFLICT_KEYS = BACKUP_ORDER;
const TABLE_LABEL = { students: '學生', exam_scores: '成績', exam_rankings: '排名' };

// 給畫面顯示的錯誤：訊息一定是中文、可以直接給家長看
class BackupError extends Error {}

// 分頁讀完整張表。fetchPage(from, to) 回傳 Promise<{ data, error }>（對應 supabase 的 .range(from, to)）。
// 讀到「空頁」才停，並依實際收到的列數前進：伺服器上限比 pageSize 小時也不會漏資料。
async function fetchAllRows(fetchPage, pageSize = BACKUP_PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new BackupError('分頁大小必須是正整數。');
  const rows = [];
  for (let from = 0; ;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) return rows;
    rows.push(...data);
    from += data.length;
    if (rows.length > BACKUP_MAX_ROWS * 10) throw new BackupError('資料筆數異常地多，已停止讀取。');
  }
}

/* ---------- CSV ---------- */
const CSV_BOM = '\uFEFF'; // 讓 Excel 以 UTF-8 開啟中文

// 單一儲存格：null → 空白；文字以 = + - @ Tab CR（含全形 \uFF1D\uFF0B\uFF0D\uFF20）開頭時加 ' 防止被試算表當成公式；
// 含逗號、雙引號、換行時用雙引號包起來並把 " 變成 ""
function csvCell(value) {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

const GRADE_TEXT = { 1: '國一', 2: '國二', 3: '國三' };
const SEMESTER_TEXT = { 1: '上學期', 2: '下學期' };
const EXAM_TEXT = { 1: '第一次', 2: '第二次', 3: '第三次' };

// 依學生（入學年、名字）→ 年級 → 學期 → 段考 → 科目順序排列，跟家長端看到的順序一致
function sortForCsv(rows, students, subjects) {
  const studentRank = new Map([...students]
    .sort((a, b) => (a.enrolled_year - b.enrolled_year) || String(a.name).localeCompare(String(b.name)))
    .map((s, i) => [s.id, i]));
  const subjectRank = new Map(subjects.map((s, i) => [s.code, i]));
  return [...rows].sort((a, b) =>
    ((studentRank.get(a.student_id) ?? 1e9) - (studentRank.get(b.student_id) ?? 1e9))
    || (a.grade - b.grade) || (a.semester - b.semester) || (a.exam_type - b.exam_type)
    || ((subjectRank.get(a.subject) ?? 1e9) - (subjectRank.get(b.subject) ?? 1e9)));
}

function scoresCsv(scores, students, subjects) {
  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  const subjectOf = new Map(subjects.map((s) => [s.code, s.display_name]));
  const rows = sortForCsv(scores, students, subjects).map((r) => [
    nameOf.get(r.student_id) ?? r.student_id,
    GRADE_TEXT[r.grade] ?? r.grade, SEMESTER_TEXT[r.semester] ?? r.semester, EXAM_TEXT[r.exam_type] ?? r.exam_type,
    subjectOf.get(r.subject) ?? r.subject, r.score == null ? '' : Number(r.score), r.exam_date ?? '',
  ]);
  return toCsv(['英文名', '年級', '學期', '段考', '科目', '分數', '考試日期'], rows);
}

function rankingsCsv(rankings, students) {
  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  const rows = sortForCsv(rankings, students, []).map((r) => [
    nameOf.get(r.student_id) ?? r.student_id,
    GRADE_TEXT[r.grade] ?? r.grade, SEMESTER_TEXT[r.semester] ?? r.semester, EXAM_TEXT[r.exam_type] ?? r.exam_type,
    r.rank, r.total_students,
  ]);
  return toCsv(['英文名', '年級', '學期', '段考', '名次', '總人數'], rows);
}

/* ---------- JSON 備份 ---------- */
// 只挑白名單欄位，避免把查詢多帶的欄位（或任何意外的資料）寫進檔案
function pickColumns(rows, columns) {
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] === undefined ? null : r[c]])));
}

function buildBackup(tables, exportedAt) {
  return {
    format: BACKUP_FORMAT,
    exportedAt: new Date(exportedAt).toISOString(),
    tables: Object.fromEntries(Object.keys(BACKUP_COLUMNS).map((t) => [t, pickColumns(tables[t] ?? [], BACKUP_COLUMNS[t])])),
  };
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// 讀回備份檔並檢查格式與內容；不合格就丟出給家長看的中文錯誤
function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    throw new BackupError('這不是有效的備份檔（JSON 格式錯誤）。');
  }
  if (!isPlainObject(data) || data.format !== BACKUP_FORMAT) throw new BackupError(`這不是成長記錄本的備份檔（需要格式 ${BACKUP_FORMAT}）。`);
  if (typeof data.exportedAt !== 'string' || !ISO_UTC.test(data.exportedAt) || Number.isNaN(Date.parse(data.exportedAt))) {
    throw new BackupError('備份檔的匯出時間格式不正確，檔案可能被修改過。');
  }
  if (!isPlainObject(data.tables)) throw new BackupError('備份檔缺少資料。');
  for (const t of Object.keys(BACKUP_COLUMNS)) {
    const rows = data.tables[t];
    if (!Array.isArray(rows)) throw new BackupError(`備份檔缺少「${TABLE_LABEL[t]}」資料。`);
    if (rows.length > BACKUP_MAX_ROWS) throw new BackupError(`備份檔的「${TABLE_LABEL[t]}」筆數異常（超過 ${BACKUP_MAX_ROWS} 筆）。`);
    rows.forEach((r, i) => {
      if (!isPlainObject(r)) throw new BackupError(`備份檔「${TABLE_LABEL[t]}」第 ${i + 1} 筆格式不正確。`);
      for (const c of REQUIRED_COLUMNS[t]) {
        if (r[c] == null) throw new BackupError(`備份檔「${TABLE_LABEL[t]}」第 ${i + 1} 筆缺少「${c}」。`);
      }
    });
  }
  return data;
}

// 檔名用本機時間：jhs-backup-20261020-1137.json
function backupFilename(kind, ext, date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new BackupError('時間不正確，無法產生檔名。');
  const pad = (n) => String(n).padStart(2, '0');
  return `jhs-${kind}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

/* ---------- 還原 SQL ---------- */
// 欄位型別（用來把值安全地寫成 SQL 字面值；不合型別的值直接拒絕，不轉型、不硬塞）
const COLUMN_TYPES = {
  id: 'uuid', student_id: 'uuid', name: 'text', theme_color: 'text', avatar_preset: 'text', subject: 'text',
  enrolled_year: 'int', grade: 'int', semester: 'int', exam_type: 'int', rank: 'int', total_students: 'int',
  score: 'num', exam_date: 'date', created_at: 'timestamptz', updated_at: 'timestamptz',
};

const describeValue = (v) => {
  try {
    return String(v).slice(0, 40);
  } catch {
    return '（無法顯示）';
  }
};

function isValidCalendarDate(text) {
  const [y, m, d] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function sqlLiteral(value, type, where) {
  if (value == null) return 'null';
  const bad = () => { throw new BackupError(`${where}：值「${describeValue(value)}」不符合 ${type} 格式，已停止產生還原 SQL。`); };
  const asText = typeof value === 'string' ? value : null;
  switch (type) {
    case 'int':
      if (typeof value === 'number' ? !Number.isSafeInteger(value) : !(asText && /^-?\d{1,15}$/.test(asText))) bad();
      return String(Number(value));
    case 'num':
      if (typeof value === 'number' ? !Number.isFinite(value) : !(asText && /^-?\d{1,15}(\.\d{1,6})?$/.test(asText))) bad();
      return typeof value === 'number' ? String(value) : asText;
    case 'uuid':
      if (!(asText && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(asText))) bad();
      return `'${asText.toLowerCase()}'`;
    case 'date':
      if (!(asText && /^\d{4}-\d{2}-\d{2}$/.test(asText) && isValidCalendarDate(asText))) bad();
      return `'${asText}'`;
    case 'timestamptz': // 一律要求帶時區的 ISO 格式，避免 JS 與 PostgreSQL 對時區的解讀不同
      if (!(asText && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/.test(asText) && !Number.isNaN(Date.parse(asText.replace(' ', 'T'))))) bad();
      return `'${asText}'`;
    default: // text：拒絕控制字元、$（不可能跳出 dollar quote）與超長字串；單引號加倍（standard_conforming_strings 下反斜線不是跳脫字元）
      if (asText === null || asText.length > TEXT_MAX_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f$]/.test(asText)) bad();
      return `'${asText.replace(/'/g, "''")}'`;
  }
}

// 放進 SQL 註解的文字：移除所有換行類字元，註解就不可能被跳出
function sqlComment(text) {
  return `-- ${String(text).replace(/[\r\n\u2028\u2029\u0085]/g, ' ')}`;
}

function checkUniqueKeys(table, rows) {
  const seen = new Set();
  rows.forEach((r, i) => {
    const key = CONFLICT_KEYS[table].map((c) => String(r[c]).toLowerCase()).join('|');
    if (seen.has(key)) throw new BackupError(`備份檔「${TABLE_LABEL[table]}」第 ${i + 1} 筆跟前面的資料重複（同一位學生、同一次段考${table === 'exam_scores' ? '、同一科' : ''}），檔案可能被合併或修改過。`);
    seen.add(key);
  });
}

function insertStatement(table, rows) {
  if (!rows.length) return `${sqlComment(`${TABLE_LABEL[table]}：備份裡沒有資料`)}\n`;
  const cols = BACKUP_COLUMNS[table];
  const keys = CONFLICT_KEYS[table];
  const values = rows.map((r, i) => `  (${cols.map((c) => sqlLiteral(r[c], COLUMN_TYPES[c], `${TABLE_LABEL[table]}第 ${i + 1} 筆的 ${c}`)).join(', ')})`);
  const updates = cols.filter((c) => !keys.includes(c) && c !== 'created_at').map((c) => `${c} = excluded.${c}`);
  return `insert into public.${table} (${cols.join(', ')}) values\n${values.join(',\n')}\n`
    + `on conflict (${keys.join(', ')}) do update set ${updates.join(', ')};\n`;
}

function buildRestoreSql(backup) {
  const t = backup.tables;
  // 先在網站上把會讓 SQL 失敗的情況擋下來，錯誤訊息才看得懂
  // 學生的 id、name 先驗證（後面的比對都依賴它們），錯誤訊息才會指到真正有問題的欄位
  const idList = t.students.map((s, i) => sqlLiteral(s.id, 'uuid', `學生第 ${i + 1} 筆的 id`)).join(', ');
  const nameList = t.students.map((s, i) => sqlLiteral(s.name, 'text', `學生第 ${i + 1} 筆的 name`)).join(', ');
  for (const table of Object.keys(BACKUP_COLUMNS)) checkUniqueKeys(table, t[table]);
  const studentIds = new Set(t.students.map((s) => String(s.id).toLowerCase()));
  for (const table of ['exam_scores', 'exam_rankings']) {
    t[table].forEach((r, i) => {
      if (!studentIds.has(String(r.student_id).toLowerCase())) {
        throw new BackupError(`備份檔「${TABLE_LABEL[table]}」第 ${i + 1} 筆的 student_id 不在備份的學生名單裡，檔案可能不完整或被修改過。`);
      }
    });
  }
  const exportedAt = new Date(backup.exportedAt).toISOString(); // 再轉一次：保證只有 ISO 字元
  const body = [
    insertStatement('students', t.students),
    insertStatement('exam_scores', t.exam_scores),
    insertStatement('exam_rankings', t.exam_rankings),
  ];
  // 同名但 id 不同的學生（例如資料庫重建後用新 id 建了同一位學生）：直接還原會變成兩位，先中止並說明
  const duplicateGuard = t.students.length ? [
    'do $jhs_guard$',
    'begin',
    `  if exists (select 1 from public.students where name in (${nameList}) and id not in (${idList})) then`,
    "    raise exception '中止還原：資料庫裡已有同名但 id 不同的學生。請先刪除那位學生（他的成績與排名會一起刪除），或改在空的資料庫還原。';",
    '  end if;',
    'end $jhs_guard$;',
    '',
  ] : [];
  const counts = t.students.length
    ? `select (select count(*) from public.students where id in (${idList})) as students, `
      + `(select count(*) from public.exam_scores where student_id in (${idList})) as exam_scores, `
      + `(select count(*) from public.exam_rankings where student_id in (${idList})) as exam_rankings;`
    : 'select 0 as students, 0 as exam_scores, 0 as exam_rankings;';
  return [
    sqlComment('成長記錄本 還原 SQL'),
    sqlComment(`備份格式 ${BACKUP_FORMAT}，匯出時間 ${exportedAt}`),
    sqlComment('執行方式：Supabase Dashboard → SQL Editor 貼上整份執行。整份是一個 transaction，失敗會全部還原。'),
    sqlComment('會新增或覆蓋：學生、段考成績、校排名（同一位學生、同一次段考、同一科以備份為準）。'),
    sqlComment('不會刪除備份裡沒有的資料；不含白名單、勵志小語與頭像（已上傳的頭像維持原狀）。'),
    sqlComment('只用自己從成長記錄本下載的備份檔；建議先在測試用的 Supabase 專案試跑。'),
    '',
    'begin;',
    '',
    ...duplicateGuard,
    ...body,
    'commit;',
    '',
    sqlComment(`驗證：以下三個數字應該分別是 ${t.students.length}、${t.exam_scores.length}、${t.exam_rankings.length}`),
    counts,
    '',
  ].join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = {
    BACKUP_FORMAT, BACKUP_PAGE_SIZE, BACKUP_MAX_ROWS, BACKUP_COLUMNS, BACKUP_ORDER, CSV_BOM, BackupError,
    fetchAllRows, csvCell, toCsv, scoresCsv, rankingsCsv, buildBackup, parseBackup, backupFilename, sqlLiteral, sqlComment, buildRestoreSql,
  };
}
