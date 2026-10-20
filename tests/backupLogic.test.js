// backupLogic.js 邊界測試：只確保邊界情況「不會炸」並鎖住規格行為，不重新定義商業邏輯。
// 疑似問題以 test.todo 標記（斷言寫的是「預期行為」，目前失敗不影響整體結果），不在此修正。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BACKUP_FORMAT, BACKUP_PAGE_SIZE, BACKUP_COLUMNS, CSV_BOM,
  fetchAllRows, csvCell, toCsv, scoresCsv, rankingsCsv, buildBackup, parseBackup, backupFilename, sqlLiteral, buildRestoreSql,
  sqlComment, BackupError,
} = require('../js/backupLogic.js');

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const HAS_CJK = /[一-鿿]/;
// SQL 字串字面值是否「封閉且內部單引號全部成對」：沒有任何單引號能跳出字串
const SAFE_LITERAL = /^'(?:[^']|'')*'$/;

// 產生 n 列的假分頁來源；記錄每次呼叫的 (from, to)
function fakeSource(total, { errorAtCall = -1, error = new Error('boom') } = {}) {
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    if (calls.length - 1 === errorAtCall) return { data: null, error };
    const data = [];
    for (let i = from; i <= to && i < total; i += 1) data.push({ i });
    return { data, error: null };
  };
  return { fetchPage, calls };
}

// ---------- fetchAllRows ----------

test('fetchAllRows：預設 pageSize 為 1000', () => {
  assert.equal(BACKUP_PAGE_SIZE, 1000);
});

// 讀到空頁才停（不依賴伺服器上限）：呼叫次數 = 有資料的頁數 + 1
for (const [total, expectedCalls] of [[0, 1], [1, 2], [999, 2], [1000, 2], [1001, 3], [2345, 4], [3000, 4]]) {
  test(`fetchAllRows：共 ${total} 列 → 呼叫 ${expectedCalls} 次、列數與順序正確`, async () => {
    const { fetchPage, calls } = fakeSource(total);
    const rows = await fetchAllRows(fetchPage);
    assert.equal(rows.length, total);
    assert.equal(calls.length, expectedCalls);
    // 每頁從「已收到的列數」開始（依實際收到的列數前進）
    let expectedFrom = 0;
    calls.forEach(([from, to]) => {
      assert.equal(from, expectedFrom);
      assert.equal(to, from + 999);
      expectedFrom += Math.max(0, Math.min(1000, total - from));
    });
    rows.forEach((r, k) => assert.equal(r.i, k));
  });
}

test('fetchAllRows：剛好 1000 列時第二頁 range 為 (1000, 1999) 並拿到 0 列才停', async () => {
  const { fetchPage, calls } = fakeSource(1000);
  await fetchAllRows(fetchPage);
  assert.deepEqual(calls, [[0, 999], [1000, 1999]]);
});

test('fetchAllRows：自訂 pageSize（3、1）', async () => {
  let s = fakeSource(7);
  assert.equal((await fetchAllRows(s.fetchPage, 3)).length, 7);
  assert.deepEqual(s.calls, [[0, 2], [3, 5], [6, 8], [7, 9]]);
  s = fakeSource(2);
  assert.equal((await fetchAllRows(s.fetchPage, 1)).length, 2);
  assert.deepEqual(s.calls, [[0, 0], [1, 1], [2, 2]]);
});

test('fetchAllRows：第一頁就回 error → 丟出同一個 error 物件', async () => {
  const err = new Error('permission denied for table students');
  const { fetchPage } = fakeSource(5000, { errorAtCall: 0, error: err });
  await assert.rejects(fetchAllRows(fetchPage), (e) => e === err);
});

test('fetchAllRows：中途第三頁回 error → 丟出、不回傳半份資料', async () => {
  const err = { message: 'timeout', code: '57014' };
  const { fetchPage, calls } = fakeSource(5000, { errorAtCall: 2, error: err });
  await assert.rejects(fetchAllRows(fetchPage), (e) => e === err);
  assert.equal(calls.length, 3);
});

test('fetchAllRows：fetchPage 本身 reject（網路斷線）→ 往外傳遞', async () => {
  await assert.rejects(fetchAllRows(async () => { throw new TypeError('Failed to fetch'); }), /Failed to fetch/);
});

test('fetchAllRows：伺服器回傳超過 pageSize 列（忽略 range）→ 不漏資料、會繼續讀', async () => {
  let n = 0;
  const rows = await fetchAllRows(async () => {
    n += 1;
    return { data: n === 1 ? [1, 2, 3, 4, 5] : [], error: null };
  }, 3);
  assert.deepEqual(rows, [1, 2, 3, 4, 5]);
});

test('fetchAllRows：pageSize 為 0、負數、小數 → 立即丟錯，不呼叫 fetchPage', async () => {
  for (const size of [0, -1, 1.5]) {
    let n = 0;
    await assert.rejects(fetchAllRows(async () => { n += 1; return { data: [], error: null }; }, size));
    assert.equal(n, 0, `pageSize=${size}`);
  }
});

test('fetchAllRows：伺服器上限比 pageSize 小（每頁只回 500 列）→ 依實際列數前進，不漏資料', async () => {
  const calls = [];
  const fetchPage = async (from) => {
    calls.push(from);
    const data = [];
    for (let i = from; i < Math.min(from + 500, 1234); i += 1) data.push({ i });
    return { data, error: null };
  };
  const rows = await fetchAllRows(fetchPage, 1000);
  assert.equal(rows.length, 1234);
  rows.forEach((r, k) => assert.equal(r.i, k));
  assert.deepEqual(calls, [0, 500, 1000, 1234]);
});

test('fetchAllRows：data 為 null 且沒有 error → 視為讀完，不炸', async () => {
  assert.deepEqual(await fetchAllRows(async () => ({ data: null, error: null })), []);
});

// ---------- csvCell ----------

test('csvCell：null / undefined → 空字串；空字串 → 空字串', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(''), '');
});

test('csvCell：數字照原樣，負數、0、小數不加前綴', () => {
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(100), '100');
  assert.equal(csvCell(0.5), '0.5');
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(-0.5), '-0.5');
});

test('csvCell：公式注入開頭字元（= + - @ Tab）加前綴 \'', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-2'), "'-2");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('=1+1'), "'=1+1");
});

test('csvCell：CR 開頭 → 加前綴且因含 \\r 需要雙引號包起來', () => {
  assert.equal(csvCell('\r=1'), '"\'\r=1"');
});

test('csvCell：前綴與跳脫同時發生（=a,b、-"x"、+換行）', () => {
  assert.equal(csvCell('=a,b'), '"\'=a,b"');
  assert.equal(csvCell('-"x"'), '"\'-""x"""');
  assert.equal(csvCell('+a\nb'), '"\'+a\nb"');
});

test('csvCell：中間出現 = + - @ 不加前綴', () => {
  assert.equal(csvCell('a=b'), 'a=b');
  assert.equal(csvCell('Mary-Jane'), 'Mary-Jane');
  assert.equal(csvCell('a@b.com'), 'a@b.com');
});

test('csvCell：逗號、雙引號、\\r、\\n、CRLF 要包雙引號並把 " 變 ""', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell('a\rb'), '"a\rb"');
  assert.equal(csvCell('a\r\nb'), '"a\r\nb"');
  assert.equal(csvCell('"'), '""""');
  assert.equal(csvCell("O'Neil"), "O'Neil");
});

test('csvCell：中文、emoji、超長字串不炸', () => {
  assert.equal(csvCell('國文'), '國文');
  assert.equal(csvCell('Milo 🐱'), 'Milo 🐱');
  const long = 'x'.repeat(1_000_000);
  assert.equal(csvCell(long), long);
  const longComma = 'a,'.repeat(200_000);
  assert.equal(csvCell(longComma).length, longComma.length + 2);
});

test('csvCell：怪型別（boolean、NaN、物件）不丟例外', () => {
  assert.doesNotThrow(() => csvCell(true));
  assert.doesNotThrow(() => csvCell(Number.NaN));
  assert.doesNotThrow(() => csvCell({ a: 1 }));
  assert.doesNotThrow(() => csvCell([1, 2]));
});

// ---------- toCsv ----------

test('toCsv：開頭 BOM、CRLF 換行、結尾 CRLF', () => {
  assert.equal(CSV_BOM, '﻿');
  const out = toCsv(['a', 'b'], [[1, 'x'], [null, 'y,z']]);
  assert.equal(out, '﻿a,b\r\n1,x\r\n,"y,z"\r\n');
});

test('toCsv：空 rows 只輸出標題列', () => {
  assert.equal(toCsv(['英文名', '分數'], []), '﻿英文名,分數\r\n');
});

test('toCsv：值內嵌 CRLF 不會被當成多出來的一列（在雙引號內）', () => {
  const out = toCsv(['a'], [['x\r\ny']]);
  assert.equal(out, '﻿a\r\n"x\r\ny"\r\n');
});

// 實際資料只有幾百列；這裡只防「效能退化到不能用」，門檻放寬避免在較慢的機器上偶發失敗
test('toCsv：20 萬列在 2 秒內完成', () => {
  const rows = Array.from({ length: 200_000 }, (_, i) => [i, 'Enisa']);
  const t0 = performance.now();
  const out = toCsv(['n', 'name'], rows);
  const ms = performance.now() - t0;
  assert.ok(out.endsWith('199999,Enisa\r\n'));
  assert.ok(ms < 2000, `toCsv 20 萬列花了 ${ms.toFixed(0)} ms`);
});

// ---------- scoresCsv / rankingsCsv ----------

const STUDENTS = [
  { id: U2, name: 'Milo', enrolled_year: 2025 },
  { id: U1, name: 'Enisa', enrolled_year: 2025 },
  { id: U3, name: 'Aaron', enrolled_year: 2026 },
];
const SUBJECTS = [
  { code: 'chinese', display_name: '國文' },
  { code: 'english', display_name: '英文' },
  { code: 'math', display_name: '數學' },
];
const lines = (csv) => csv.replace(/^﻿/, '').split('\r\n').slice(0, -1);

test('scoresCsv：標題列、中文年級學期段考、0 筆只有標題', () => {
  assert.deepEqual(lines(scoresCsv([], STUDENTS, SUBJECTS)), ['英文名,年級,學期,段考,科目,分數,考試日期']);
  const out = lines(scoresCsv([
    { student_id: U1, grade: 1, semester: 1, exam_type: 1, subject: 'math', score: 0.5, exam_date: '2026-10-01' },
  ], STUDENTS, SUBJECTS));
  assert.deepEqual(out[1].split(','), ['Enisa', '國一', '上學期', '第一次', '數學', '0.5', '2026-10-01']);
});

test('scoresCsv：分數 0 / 100、考試日期 null → 空白', () => {
  const out = lines(scoresCsv([
    { student_id: U1, grade: 3, semester: 2, exam_type: 3, subject: 'chinese', score: 0, exam_date: null },
    { student_id: U1, grade: 3, semester: 2, exam_type: 3, subject: 'english', score: 100, exam_date: undefined },
  ], STUDENTS, SUBJECTS));
  assert.equal(out[1], 'Enisa,國三,下學期,第三次,國文,0,');
  assert.equal(out[2], 'Enisa,國三,下學期,第三次,英文,100,');
});

test('scoresCsv：排序 學生(入學年→名字) → 年級 → 學期 → 段考 → 科目（subjects 陣列順序）', () => {
  const mk = (sid, g, s, e, subj) => ({ student_id: sid, grade: g, semester: s, exam_type: e, subject: subj, score: 1, exam_date: null });
  const input = [
    mk(U3, 1, 1, 1, 'chinese'),
    mk(U2, 1, 1, 1, 'chinese'),
    mk(U1, 2, 1, 1, 'chinese'),
    mk(U1, 1, 2, 1, 'chinese'),
    mk(U1, 1, 1, 2, 'chinese'),
    mk(U1, 1, 1, 1, 'math'),
    mk(U1, 1, 1, 1, 'chinese'),
    mk(U1, 1, 1, 1, 'english'),
  ];
  const got = lines(scoresCsv(input, STUDENTS, SUBJECTS)).slice(1).map((l) => l.split(',').slice(0, 5).join(','));
  assert.deepEqual(got, [
    'Enisa,國一,上學期,第一次,國文',
    'Enisa,國一,上學期,第一次,英文',
    'Enisa,國一,上學期,第一次,數學',
    'Enisa,國一,上學期,第二次,國文',
    'Enisa,國一,下學期,第一次,國文',
    'Enisa,國二,上學期,第一次,國文',
    'Milo,國一,上學期,第一次,國文',
    'Aaron,國一,上學期,第一次,國文',
  ]);
});

test('scoresCsv：不修改傳入的陣列順序', () => {
  const input = [
    { student_id: U2, grade: 1, semester: 1, exam_type: 1, subject: 'math', score: 1 },
    { student_id: U1, grade: 1, semester: 1, exam_type: 1, subject: 'math', score: 1 },
  ];
  const before = input.map((r) => r.student_id);
  scoresCsv(input, STUDENTS, SUBJECTS);
  assert.deepEqual(input.map((r) => r.student_id), before);
});

test('scoresCsv：找不到學生 → 顯示 student_id，並排在已知學生之後；找不到科目 → 顯示代碼', () => {
  const out = lines(scoresCsv([
    { student_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', grade: 1, semester: 1, exam_type: 1, subject: 'unknown', score: 50 },
    { student_id: U1, grade: 1, semester: 1, exam_type: 1, subject: 'math', score: 50 },
  ], STUDENTS, SUBJECTS));
  assert.match(out[1], /^Enisa,/);
  assert.equal(out[2], 'ffffffff-ffff-4fff-8fff-ffffffffffff,國一,上學期,第一次,unknown,50,');
});

test('scoresCsv：英文名含逗號 / 撇號 / 公式字元、科目名含特殊字元要正確跳脫', () => {
  const students = [
    { id: U1, name: 'Lee, Jr.', enrolled_year: 2025 },
    { id: U2, name: "O'Neil", enrolled_year: 2025 },
    { id: U3, name: '=cmd|calc', enrolled_year: 2025 },
  ];
  const subjects = [{ code: 's', display_name: '自然"理化",生物' }];
  const out = scoresCsv([
    { student_id: U1, grade: 1, semester: 1, exam_type: 1, subject: 's', score: 90 },
    { student_id: U2, grade: 1, semester: 1, exam_type: 1, subject: 's', score: 90 },
    { student_id: U3, grade: 1, semester: 1, exam_type: 1, subject: 's', score: 90 },
  ], students, subjects);
  assert.ok(out.includes('"Lee, Jr.",國一,上學期,第一次,"自然""理化"",生物",90,\r\n'));
  assert.ok(out.includes("O'Neil,國一,上學期,第一次,"));
  assert.ok(out.includes("'=cmd|calc,國一"));
});

test('scoresCsv：中文名、emoji 名、空字串名不炸', () => {
  const students = [
    { id: U1, name: '小明', enrolled_year: 2025 },
    { id: U2, name: '🐱Milo', enrolled_year: 2025 },
    { id: U3, name: '', enrolled_year: 2025 },
  ];
  const rows = [U1, U2, U3].map((sid) => ({ student_id: sid, grade: 1, semester: 1, exam_type: 1, subject: 'math', score: 1 }));
  const out = lines(scoresCsv(rows, students, SUBJECTS));
  assert.equal(out.length, 4);
  assert.ok(out.some((l) => l.startsWith('小明,')));
  assert.ok(out.some((l) => l.startsWith('🐱Milo,')));
  assert.ok(out.some((l) => l.startsWith(',國一')));
});

test('scoresCsv：年級／學期／段考超出範圍時顯示原值，不炸', () => {
  const out = lines(scoresCsv([{ student_id: U1, grade: 9, semester: 0, exam_type: null, subject: 'math', score: 1 }], STUDENTS, SUBJECTS));
  assert.equal(out[1], 'Enisa,9,0,,數學,1,');
});

test('scoresCsv：students / subjects 為空陣列不炸', () => {
  assert.doesNotThrow(() => scoresCsv([{ student_id: U1, grade: 1, semester: 1, exam_type: 1, subject: 'math', score: 1 }], [], []));
});

test('rankingsCsv：標題列、中文欄位、0 筆只有標題', () => {
  assert.deepEqual(lines(rankingsCsv([], STUDENTS)), ['英文名,年級,學期,段考,名次,總人數']);
  const out = lines(rankingsCsv([
    { student_id: U2, grade: 2, semester: 1, exam_type: 2, rank: 3, total_students: 250 },
    { student_id: U1, grade: 1, semester: 2, exam_type: 3, rank: 1, total_students: null },
    { student_id: 'missing', grade: 1, semester: 1, exam_type: 1, rank: 9, total_students: 9 },
  ], STUDENTS));
  assert.deepEqual(out.slice(1), [
    'Enisa,國一,下學期,第三次,1,',
    'Milo,國二,上學期,第二次,3,250',
    'missing,國一,上學期,第一次,9,9',
  ]);
});

// ---------- buildBackup ----------

test('buildBackup：format、exportedAt ISO、白名單欄位、多餘欄位丟棄、缺欄位補 null', () => {
  const b = buildBackup({
    students: [{ id: U1, name: 'Enisa', apikey: 'k', secret: 's', enrolled_year: 2025 }],
    exam_scores: [{ id: 42, student_id: U1, grade: 1, semester: 1, exam_type: 1, subject: 'math', score: 90, secret: 'x' }],
    exam_rankings: [{ id: 7, student_id: U1, grade: 1, semester: 1, exam_type: 1, rank: 1 }],
  }, Date.UTC(2026, 9, 20, 3, 37));
  assert.equal(b.format, BACKUP_FORMAT);
  assert.equal(b.format, 'jhs-backup-1');
  assert.equal(b.exportedAt, '2026-10-20T03:37:00.000Z');
  for (const t of ['students', 'exam_scores', 'exam_rankings']) {
    for (const row of b.tables[t]) assert.deepEqual(Object.keys(row), BACKUP_COLUMNS[t]);
  }
  assert.equal(b.tables.students[0].avatar_url, undefined); // 刻意不備份：頭像不在備份裡，且網址含專案位址
  assert.equal(b.tables.exam_scores[0].exam_date, null);
  assert.equal(b.tables.exam_rankings[0].total_students, null);
  const json = JSON.stringify(b);
  assert.ok(!json.includes('apikey'));
  assert.ok(!json.includes('secret'));
  assert.equal(b.tables.exam_scores[0].id, undefined);
});

test('buildBackup：tables 缺表 / 空物件 → 三張表都是空陣列', () => {
  const b = buildBackup({}, new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(b.tables, { students: [], exam_scores: [], exam_rankings: [] });
  const b2 = buildBackup({ students: [{ id: U1 }] }, '2026-10-20T00:00:00Z');
  assert.equal(b2.tables.students.length, 1);
  assert.deepEqual(b2.tables.exam_scores, []);
});

test('buildBackup：保留 0、空字串、false 等 falsy 值（不被當成缺值）', () => {
  const b = buildBackup({ exam_scores: [{ student_id: U1, score: 0, subject: '' }] }, 0);
  assert.equal(b.tables.exam_scores[0].score, 0);
  assert.equal(b.tables.exam_scores[0].subject, '');
  assert.equal(b.exportedAt, '1970-01-01T00:00:00.000Z');
});

test('buildBackup → JSON → parseBackup 來回一致', () => {
  const b = buildBackup({ students: [{ id: U1, name: '🐱 "Enisa"\r\n', enrolled_year: 2026 }] }, Date.now());
  assert.deepEqual(parseBackup(JSON.stringify(b, null, 2)), b);
});

// ---------- parseBackup ----------

const VALID = () => ({ format: 'jhs-backup-1', exportedAt: '2026-10-20T00:00:00.000Z', tables: { students: [], exam_scores: [], exam_rankings: [] } });

test('parseBackup：可帶 BOM', () => {
  assert.deepEqual(parseBackup('﻿' + JSON.stringify(VALID())), VALID());
});

test('parseBackup：非 JSON / 空字串 / null / undefined → 中文錯誤', () => {
  for (const bad of ['', 'not json', '{', '﻿', null, undefined, '<html>']) {
    assert.throws(() => parseBackup(bad), (e) => e instanceof Error && HAS_CJK.test(e.message), `輸入 ${JSON.stringify(bad)}`);
  }
});

test('parseBackup：JSON 合法但 format 不對或不是物件 → 中文錯誤', () => {
  for (const bad of ['null', '0', '"x"', '[]', 'true', '{}', JSON.stringify({ ...VALID(), format: 'jhs-backup-2' })]) {
    assert.throws(() => parseBackup(bad), (e) => HAS_CJK.test(e.message), `輸入 ${bad}`);
  }
});

test('parseBackup：缺任一表、tables 不存在、表不是陣列 → 中文錯誤且指出表名', () => {
  for (const t of ['students', 'exam_scores', 'exam_rankings']) {
    const missing = VALID(); delete missing.tables[t];
    const label = { students: '學生', exam_scores: '成績', exam_rankings: '排名' }[t]; // 訊息用中文表名
    assert.throws(() => parseBackup(JSON.stringify(missing)), (e) => e.message.includes(label));
    for (const v of [null, {}, 'x', 1]) {
      const wrong = VALID(); wrong.tables[t] = v;
      assert.throws(() => parseBackup(JSON.stringify(wrong)), (e) => e.message.includes(label));
    }
  }
  const noTables = VALID(); delete noTables.tables;
  assert.throws(() => parseBackup(JSON.stringify(noTables)), (e) => HAS_CJK.test(e.message));
});

// ---------- backupFilename ----------

test('backupFilename：本機時間、補零', () => {
  assert.equal(backupFilename('backup', 'json', new Date(2026, 0, 5, 3, 7)), 'jhs-backup-20260105-0307.json');
  assert.equal(backupFilename('scores', 'csv', new Date(2026, 11, 31, 23, 59, 59)), 'jhs-scores-20261231-2359.csv');
  assert.equal(backupFilename('restore', 'sql', new Date(2026, 9, 20, 0, 0).getTime()), 'jhs-restore-20261020-0000.sql');
});

test('backupFilename：無效日期 → 丟出中文錯誤，不產生 NaN 檔名', () => {
  assert.throws(() => backupFilename('x', 'json', 'not a date'), (e) => HAS_CJK.test(e.message));
});

// ---------- sqlLiteral ----------

test('sqlLiteral：null / undefined → null（任何型別）', () => {
  for (const type of ['text', 'int', 'num', 'uuid', 'date', 'timestamptz']) {
    assert.equal(sqlLiteral(null, type, 'w'), 'null');
    assert.equal(sqlLiteral(undefined, type, 'w'), 'null');
  }
});

test('sqlLiteral text：單引號加倍、反斜線原樣、空字串、中文、emoji、CRLF', () => {
  assert.equal(sqlLiteral("O'Neil", 'text', 'w'), "'O''Neil'");
  assert.equal(sqlLiteral('a\\b\\', 'text', 'w'), "'a\\b\\'");
  assert.equal(sqlLiteral('', 'text', 'w'), "''");
  assert.equal(sqlLiteral('小明🐱', 'text', 'w'), "'小明🐱'");
  assert.equal(sqlLiteral('a\r\nb', 'text', 'w'), "'a\r\nb'");
  assert.equal(sqlLiteral("''", 'text', 'w'), "''''''");
});

test('sqlLiteral text：SQL 注入字串被完整關在字面值內', () => {
  for (const s of ["x'; drop table students; --", "'", "\\'; select 1; --", "a''b", "'); delete from admins; --"]) {
    assert.match(sqlLiteral(s, 'text', 'w'), SAFE_LITERAL, s);
  }
});

test('sqlLiteral text：上限 1000 字（剛好 1000 可以、1001 丟錯），長字串仍封閉', () => {
  const out = sqlLiteral("'".repeat(1000), 'text', 'w');
  assert.equal(out.length, 2002);
  assert.match(out, SAFE_LITERAL);
  assert.throws(() => sqlLiteral('a'.repeat(1001), 'text', 'W-long'), (e) => e.message.includes('W-long'));
});

test('sqlLiteral text：控制字元與 $ 一律拒絕（$ 可能跳出 dollar quote）', () => {
  for (const v of ['a\u0000b', 'a\u0007', 'x$$; drop table admins; --', '$jhs_guard$', 'a\u007f']) {
    assert.throws(() => sqlLiteral(v, 'text', 'W-ctl'), (e) => e.message.includes('W-ctl'), JSON.stringify(v));
  }
});

test('sqlLiteral text：非字串（數字、物件、陣列、boolean）丟錯且訊息含 where', () => {
  for (const v of [1, 0, {}, [], true, { toString: () => "x'" }]) {
    assert.throws(() => sqlLiteral(v, 'text', 'students 第 1 列 name'), (e) => e.message.includes('students 第 1 列 name'));
  }
});

test('sqlLiteral：Object.create(null) 也給出含 where 的中文錯誤（不會被 String() 本身的 TypeError 蓋掉）', () => {
  assert.throws(() => sqlLiteral(Object.create(null), 'text', 'W'), (e) => e.message.includes('W') && HAS_CJK.test(e.message));
});

test('sqlLiteral int：合法整數（數字、十進位整數字串、負數、0）', () => {
  assert.equal(sqlLiteral(0, 'int', 'w'), '0');
  assert.equal(sqlLiteral(-3, 'int', 'w'), '-3');
  assert.equal(sqlLiteral('2025', 'int', 'w'), '2025');
});

test('sqlLiteral int／num：嚴格型別（前後空白、boolean、陣列、十六進位、指數一律拒絕，不偷偷轉型）', () => {
  for (const v of [' 7 ', true, [5], '0x10', '1e1']) assert.throws(() => sqlLiteral(v, 'int', 'W-int'), (e) => e.message.includes('W-int'), JSON.stringify(v));
  for (const v of [true, [88.5], '0x1F', '1e2', '88.1234567']) assert.throws(() => sqlLiteral(v, 'num', 'W-num'), (e) => e.message.includes('W-num'), JSON.stringify(v));
});

test('sqlLiteral int：非數字、小數、空字串、空白、NaN、Infinity → 丟錯含 where', () => {
  for (const v of ['', '   ', 'abc', '1.5', 1.5, Number.NaN, Infinity, '1; drop table students', "1'"]) {
    assert.throws(() => sqlLiteral(v, 'int', 'WHERE-int'), (e) => e.message.includes('WHERE-int'), `值 ${String(v)}`);
  }
});

test('sqlLiteral num：0.5 / 0 / 100 / 字串數字', () => {
  assert.equal(sqlLiteral(0.5, 'num', 'w'), '0.5');
  assert.equal(sqlLiteral(0, 'num', 'w'), '0');
  assert.equal(sqlLiteral(100, 'num', 'w'), '100');
  assert.equal(sqlLiteral('87.5', 'num', 'w'), '87.5');
});

test('sqlLiteral num：非數字、空字串、NaN、Infinity → 丟錯含 where', () => {
  for (const v of ['', ' ', 'abc', Number.NaN, Infinity, -Infinity, '1,5', "0'; --"]) {
    assert.throws(() => sqlLiteral(v, 'num', 'WHERE-num'), (e) => e.message.includes('WHERE-num'), `值 ${String(v)}`);
  }
});

test('sqlLiteral int/num：輸出只含數字字元', () => {
  assert.match(sqlLiteral('2025', 'int', 'w'), /^-?[0-9]+$/);
  assert.match(sqlLiteral('87.5', 'num', 'w'), /^-?[0-9.]+$/);
});

test('sqlLiteral uuid：合法（大寫轉小寫）', () => {
  assert.equal(sqlLiteral(U1, 'uuid', 'w'), `'${U1}'`);
  assert.equal(sqlLiteral(U1.toUpperCase(), 'uuid', 'w'), `'${U1}'`);
});

test('sqlLiteral uuid：格式不符 / 注入字串 / 尾端換行 → 丟錯含 where', () => {
  for (const v of ['', 'x', "x'; drop table students; --", `${U1}'; --`, `${U1}\n`, ` ${U1}`, U1.replace(/-/g, ''), 'gggggggg-1111-4111-8111-111111111111', 123]) {
    assert.throws(() => sqlLiteral(v, 'uuid', 'WHERE-uuid'), (e) => e.message.includes('WHERE-uuid'), `值 ${JSON.stringify(v)}`);
  }
});

test('sqlLiteral date：只收 YYYY-MM-DD', () => {
  assert.equal(sqlLiteral('2026-10-20', 'date', 'w'), "'2026-10-20'");
  for (const v of ['', '2026/10/20', '2026-10-20T00:00:00Z', '20261020', "2026-10-20'; --", '2026-10-20\n', 'today', '2026-02-30', '2026-13-01']) {
    assert.throws(() => sqlLiteral(v, 'date', 'WHERE-date'), (e) => e.message.includes('WHERE-date'), `值 ${JSON.stringify(v)}`);
  }
});

test('sqlLiteral timestamptz：可 Date.parse 才收；輸出是封閉字面值', () => {
  assert.equal(sqlLiteral('2026-10-20T03:37:00.123456+00:00', 'timestamptz', 'w'), "'2026-10-20T03:37:00.123456+00:00'");
  for (const v of ['', 'not a time', "x'; drop table students; --", "Jan 1 2026 (x'); drop table students; --)", '2026-10-19T08:00:00', '1']) {
    assert.throws(() => sqlLiteral(v, 'timestamptz', 'WHERE-ts'), (e) => e.message.includes('WHERE-ts'), `值 ${JSON.stringify(v)}`);
  }
});

test('sqlLiteral：錯誤訊息只截取前 40 字，超長值不會讓訊息爆量', () => {
  const v = 'z'.repeat(100_000);
  assert.throws(() => sqlLiteral(v, 'int', 'w'), (e) => e.message.length < 200);
});

// ---------- buildRestoreSql ----------

const fullBackup = () => buildBackup({
  students: [
    { id: U1, name: "O'Neil", theme_color: '#E8A0BF', avatar_preset: 'cat', avatar_url: null, enrolled_year: 2025, created_at: '2026-10-19T01:00:00+00:00' },
    { id: U2, name: '小明🐱', theme_color: null, avatar_preset: null, avatar_url: 'https://x/a.png?v=1', enrolled_year: 2025, created_at: '2026-10-19T01:00:00+00:00' },
  ],
  exam_scores: [
    { id: 99, student_id: U1, grade: 1, semester: 1, exam_type: 1, subject: 'math', score: 0.5, exam_date: '2026-10-01', created_at: '2026-10-19T01:00:00Z', updated_at: '2026-10-19T01:00:00Z' },
    { student_id: U2, grade: 3, semester: 2, exam_type: 3, subject: 'english', score: 100, exam_date: null, created_at: '2026-10-19T01:00:00Z', updated_at: null },
  ],
  exam_rankings: [
    { student_id: U1, grade: 1, semester: 1, exam_type: 1, rank: 1, total_students: 250, created_at: '2026-10-19T01:00:00Z', updated_at: '2026-10-19T01:00:00Z' },
  ],
}, '2026-10-20T03:37:00Z');

function conflictClauses(sql) {
  return [...sql.matchAll(/insert into public\.(\w+) \(([^)]*)\) values[\s\S]*?on conflict \(([^)]*)\) do update set ([^;]*);/g)]
    .map(([, table, cols, keys, set]) => ({
      table,
      cols: cols.split(', '),
      keys: keys.split(', '),
      setCols: set.split(', ').map((p) => { const [c, rhs] = p.split(' = '); assert.equal(rhs, `excluded.${c}`); return c; }),
    }));
}

test('buildRestoreSql：begin/commit、三段 insert、on conflict 唯一鍵、驗證 select', () => {
  const sql = buildRestoreSql(fullBackup());
  const beginAt = sql.indexOf('\nbegin;\n');
  const commitAt = sql.indexOf('\ncommit;\n');
  assert.ok(beginAt > 0 && commitAt > beginAt);
  const clauses = conflictClauses(sql);
  assert.deepEqual(clauses.map((c) => c.table), ['students', 'exam_scores', 'exam_rankings']);
  assert.deepEqual(clauses[0].keys, ['id']);
  assert.deepEqual(clauses[1].keys, ['student_id', 'grade', 'semester', 'exam_type', 'subject']);
  assert.deepEqual(clauses[2].keys, ['student_id', 'grade', 'semester', 'exam_type']);
  for (const c of clauses) {
    assert.deepEqual(c.cols, BACKUP_COLUMNS[c.table]);
    assert.ok(!c.setCols.includes('created_at'), `${c.table} update set 不應含 created_at`);
    for (const k of c.keys) assert.ok(!c.setCols.includes(k), `${c.table} update set 不應含唯一鍵 ${k}`);
    assert.ok(c.setCols.length > 0);
    // 所有非鍵、非 created_at 欄位都要被更新
    assert.deepEqual(c.setCols, c.cols.filter((x) => !c.keys.includes(x) && x !== 'created_at'));
  }
  const selectAt = sql.indexOf('select (select count(*) from public.students where id in (');
  assert.ok(selectAt > commitAt, '驗證 select 在 commit 之後');
  // insert 都在 transaction 內
  for (const m of sql.matchAll(/insert into/g)) assert.ok(m.index > beginAt && m.index < commitAt);
});

test('buildRestoreSql：值正確轉成字面值（撇號、中文、emoji、null、0.5）', () => {
  const sql = buildRestoreSql(fullBackup());
  assert.ok(sql.includes("'O''Neil'"));
  assert.ok(sql.includes("'小明🐱'"));
  assert.ok(sql.includes(`('${U1}', 1, 1, 1, 'math', 0.5, '2026-10-01',`));
  assert.ok(sql.includes(`('${U2}', 3, 2, 3, 'english', 100, null,`));
  assert.ok(!/\bid\b[^,]*99/.test(sql), 'exam_scores 的 identity id 不應出現在還原 SQL');
});

test('buildRestoreSql：每張表為空時輸出註解而非 insert', () => {
  const sql = buildRestoreSql(parseBackup(JSON.stringify(VALID())));
  assert.ok(!sql.includes('insert into'));
  for (const t of ['學生', '成績', '排名']) {
    assert.ok(sql.split('\n').some((l) => l.startsWith('--') && l.includes(`${t}：備份裡沒有資料`)), `${t} 應有註解`);
  }
  assert.ok(sql.includes('begin;') && sql.includes('commit;'));
});

test('buildRestoreSql：只有部分表為空', () => {
  const b = fullBackup(); b.tables.exam_rankings = [];
  const sql = buildRestoreSql(b);
  assert.deepEqual(conflictClauses(sql).map((c) => c.table), ['students', 'exam_scores']);
  assert.ok(sql.includes('-- 排名：備份裡沒有資料'));
});

test('buildRestoreSql：任一欄位不合格就整個丟錯（訊息含表名、列號、欄位）', () => {
  const cases = [
    ['students', 0, 'id', "x'; drop table students; --"],
    ['students', 1, 'name', 123],
    ['students', 0, 'enrolled_year', 'abc'],
    ['exam_scores', 1, 'score', ''],
    ['exam_scores', 0, 'exam_date', '2026/10/01'],
    ['exam_rankings', 0, 'rank', 1.5],
    ['exam_rankings', 0, 'updated_at', 'yesterday'],
    ['exam_rankings', 0, 'student_id', 'not-a-uuid'],
  ];
  for (const [table, idx, col, val] of cases) {
    const b = fullBackup();
    b.tables[table][idx][col] = val;
    let result;
    const label = { students: '學生', exam_scores: '成績', exam_rankings: '排名' }[table];
    assert.throws(() => { result = buildRestoreSql(b); }, (e) => e.message.includes(label) && e.message.includes(`第 ${idx + 1} 筆`) && e.message.includes(col), `${table}.${col}=${JSON.stringify(val)}`);
    assert.equal(result, undefined);
  }
});

test('buildRestoreSql：備份檔多帶的欄位不會進入 SQL（只用白名單欄位）', () => {
  const b = parseBackup(JSON.stringify(fullBackup()));
  b.tables.students[0].evil = "'); drop table admins; --";
  const sql = buildRestoreSql(b);
  assert.ok(!sql.includes('evil'));
  assert.ok(!sql.includes('drop table admins'));
});

test('buildRestoreSql：所有字串字面值都封閉（注入字串放進 text 欄位）', () => {
  const b = fullBackup();
  b.tables.students[0].name = "x'); drop table students; --";
  b.tables.exam_scores[0].subject = "math'; delete from exam_scores; --";
  const sql = buildRestoreSql(b);
  // 去掉合法字面值後，SQL 本體中不應再出現 drop / delete
  const stripped = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n').replace(/'(?:[^']|'')*'/g, "''");
  assert.ok(!/drop table|delete from/i.test(stripped), stripped);
});

test('buildRestoreSql：1 萬列成績不炸', () => {
  const scores = [];
  for (let i = 0; i < 10_000; i += 1) scores.push({ student_id: U1, grade: 1, semester: 1, exam_type: 1, subject: `s${i}`, score: i % 101, exam_date: null, created_at: null, updated_at: null });
  const b = buildBackup({ students: [{ id: U1, name: 'Enisa', enrolled_year: 2026 }], exam_scores: scores }, 0);
  const sql = buildRestoreSql(b);
  assert.equal((sql.match(/\n {2}\('/g) || []).length, 10_001); // 1 位學生 + 1 萬列成績
  assert.ok(sql.includes('1、10000、0'));
});

// ---------- 審查後的回歸測試（2026-10-20） ----------

test('還原 SQL 注入：exportedAt 含換行 → parseBackup 拒絕；繞過 parse 也只會丟錯、不會產生可執行的 SQL', () => {
  for (const bad of ['2026-10-20\ndrop table students;\n--', '2026-10-20T00:00:00.000Z\rdelete from admins;', ['x\ndrop'], 1]) {
    assert.throws(() => parseBackup(JSON.stringify({ ...VALID(), exportedAt: bad })), (e) => HAS_CJK.test(e.message), JSON.stringify(bad));
    let sql = '';
    try { sql = buildRestoreSql({ ...VALID(), exportedAt: bad }); } catch { continue; } // 丟錯也合格
    const beforeBegin = sql.slice(0, sql.indexOf('\nbegin;\n')).split('\n');
    for (const l of beforeBegin) assert.ok(l === '' || l.startsWith('--'), `註解區出現非註解行：${JSON.stringify(l)}`);
  }
});

test('sqlComment：所有換行類字元都換成空白，註解只有一行', () => {
  const c = sqlComment('a\nb\rc\u2028d\u2029e\u0085f');
  assert.equal(c.split(/[\r\n\u2028\u2029\u0085]/).length, 1);
  assert.ok(c.startsWith('-- '));
});

test('parseBackup：某列為 null／非物件／缺必填欄位 → 中文錯誤', () => {
  const rows = [[null], ['x'], [[1]], [{ id: U1, name: 'A' }]]; // 最後一個缺 enrolled_year
  for (const students of rows) {
    assert.throws(() => parseBackup(JSON.stringify({ ...VALID(), tables: { students, exam_scores: [], exam_rankings: [] } })), (e) => e instanceof BackupError && HAS_CJK.test(e.message), JSON.stringify(students));
  }
});

test('buildRestoreSql：唯一鍵重複 → 中文錯誤（不留給資料庫報英文錯）', () => {
  const b = fullBackup();
  b.tables.exam_scores.push({ ...b.tables.exam_scores[0] });
  assert.throws(() => buildRestoreSql(b), (e) => e instanceof BackupError && e.message.includes('重複'));
});

test('buildRestoreSql：成績或排名的 student_id 不在學生名單 → 中文錯誤', () => {
  const b = fullBackup();
  b.tables.exam_rankings[0].student_id = U3;
  assert.throws(() => buildRestoreSql(b), (e) => e instanceof BackupError && e.message.includes('student_id'));
});

test('buildRestoreSql：含同名不同 id 的防護（在 transaction 內、用專屬 dollar tag），驗證查詢只算備份內的 id', () => {
  const sql = buildRestoreSql(fullBackup());
  const guardAt = sql.indexOf('do $jhs_guard$');
  assert.ok(guardAt > sql.indexOf('\nbegin;\n') && guardAt < sql.indexOf('insert into'));
  assert.ok(sql.includes('raise exception') && sql.includes('同名但 id 不同'));
  assert.ok(!/\$\$/.test(sql), '不應出現裸的 $$');
  assert.ok(sql.includes(`where student_id in ('${U1}', '${U2}')`));
});

test('BACKUP_COLUMNS：students 不含 avatar_url（不備份專案網址）', () => {
  assert.ok(!BACKUP_COLUMNS.students.includes('avatar_url'));
});
