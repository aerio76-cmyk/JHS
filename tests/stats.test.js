// stats.js 邊界測試：只鎖住現行行為與「不會炸」，不重新定義判定門檻。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sittingKey, sittingOrder, buildSittings, classifyScore, classifyLatestSitting, classifySubjectAt,
} = require('../js/stats.js');

const CATEGORIES = ['progress', 'stable', 'fluctuation', 'peak', 'insufficient_data'];

function row(grade, semester, exam_type, subject, score) {
  return { grade, semester, exam_type, subject, score };
}

// 3 年 × 2 學期 × 3 次 = 18 個段考
const SLOTS = [];
for (const g of [1, 2, 3]) for (const s of [1, 2]) for (const e of [1, 2, 3]) SLOTS.push({ grade: g, semester: s, exam_type: e });

test('sittingKey：格式為 grade-semester-exam_type', () => {
  assert.equal(sittingKey({ grade: 1, semester: 2, exam_type: 3 }), '1-2-3');
});

test('sittingOrder：18 個段考依時間嚴格遞增、沒有撞號', () => {
  const orders = SLOTS.map(sittingOrder);
  for (let i = 1; i < orders.length; i++) assert.ok(orders[i] > orders[i - 1], `slot ${i} 應大於前一個`);
  assert.equal(new Set(orders).size, 18);
});

test('sittingOrder：下學期第一次 > 上學期第三次；下一年級第一次 > 上一年級最後一次', () => {
  assert.ok(sittingOrder({ grade: 1, semester: 2, exam_type: 1 }) > sittingOrder({ grade: 1, semester: 1, exam_type: 3 }));
  assert.ok(sittingOrder({ grade: 2, semester: 1, exam_type: 1 }) > sittingOrder({ grade: 1, semester: 2, exam_type: 3 }));
});

/* ---------- buildSittings ---------- */

test('buildSittings：0 筆資料回傳空陣列', () => {
  assert.deepEqual(buildSittings([]), []);
});

test('buildSittings：1 筆資料', () => {
  const r = buildSittings([row(1, 1, 1, 'math', 90)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].total, 90);
  assert.equal(r[0].average, 90);
  assert.equal(r[0].subjectCount, 1);
});

test('buildSittings：亂序輸入會依時間排序', () => {
  const r = buildSittings([row(2, 1, 1, 'math', 70), row(1, 1, 2, 'math', 80), row(1, 1, 1, 'math', 60)]);
  assert.deepEqual(r.map(sittingKey), ['1-1-1', '1-1-2', '2-1-1']);
});

test('buildSittings：段考不連續（只有 1-1-1 與 2-1-1）', () => {
  const r = buildSittings([row(2, 1, 1, 'math', 70), row(1, 1, 1, 'math', 60)]);
  assert.deepEqual(r.map(sittingKey), ['1-1-1', '2-1-1']);
});

test('buildSittings：缺科時 average 只用有的科目計算', () => {
  const r = buildSittings([
    row(1, 1, 1, 'chi', 80), row(1, 1, 1, 'eng', 90), row(1, 1, 1, 'math', 70),
    row(1, 1, 2, 'chi', 80), row(1, 1, 2, 'eng', 90),
  ]);
  assert.equal(r[0].subjectCount, 3);
  assert.equal(r[0].average, 80);
  assert.equal(r[1].subjectCount, 2);
  assert.equal(r[1].average, 85);
  assert.equal(r[1].scores.math, undefined);
});

test('buildSittings：小數分數 87.5', () => {
  const r = buildSittings([row(1, 1, 1, 'chi', 87.5), row(1, 1, 1, 'eng', 92.5)]);
  assert.equal(r[0].total, 180);
  assert.equal(r[0].average, 90);
});

test('buildSittings：全滿分 100', () => {
  const r = buildSittings(['chi', 'eng', 'math', 'sci', 'soc'].map((s) => row(1, 1, 1, s, 100)));
  assert.equal(r[0].average, 100);
  assert.equal(r[0].total, 500);
});

test('buildSittings：0 分不會被當成缺科', () => {
  const r = buildSittings([row(1, 1, 1, 'chi', 0), row(1, 1, 1, 'eng', 100)]);
  assert.equal(r[0].subjectCount, 2);
  assert.equal(r[0].average, 50);
});

test('buildSittings：同一次同一科重複 → 後者覆蓋前者（現行行為）', () => {
  const r = buildSittings([row(1, 1, 1, 'math', 60), row(1, 1, 1, 'math', 90)]);
  assert.equal(r[0].subjectCount, 1);
  assert.equal(r[0].scores.math, 90);
});

test('buildSittings：不會改動輸入陣列', () => {
  const input = [row(2, 1, 1, 'math', 70), row(1, 1, 1, 'math', 60)];
  const snapshot = JSON.parse(JSON.stringify(input));
  buildSittings(input);
  assert.deepEqual(input, snapshot);
});

test('buildSittings：18 次 × 10 科的完整資料不會炸', () => {
  const rows = [];
  SLOTS.forEach((s, i) => {
    for (let k = 0; k < 10; k++) rows.push(row(s.grade, s.semester, s.exam_type, `s${k}`, (i * 7 + k) % 101));
  });
  const r = buildSittings(rows);
  assert.equal(r.length, 18);
  assert.ok(r.every((x) => x.subjectCount === 10));
});

/* ---------- classifyScore ---------- */

test('classifyScore：歷史 0／1／2 筆 → insufficient_data', () => {
  assert.equal(classifyScore(80, []), 'insufficient_data');
  assert.equal(classifyScore(80, [70]), 'insufficient_data');
  assert.equal(classifyScore(80, [70, 90]), 'insufficient_data');
});

test('classifyScore：歷史全同分（std = 0）不會除以 0', () => {
  assert.equal(classifyScore(80, [80, 80, 80]), 'stable'); // 跟過去一樣 → 穩定發揮（2026-10-19 使用者決定）
  assert.equal(classifyScore(81, [80, 80, 80]), 'peak');
  assert.equal(classifyScore(79, [80, 80, 80]), 'fluctuation');
});

test('classifyScore：全滿分 100 再考 100 → stable（不是 peak，也不是進步中）', () => {
  assert.equal(classifyScore(100, [100, 100, 100]), 'stable');
});

test('classifyScore：剛好落在 ±1σ 邊界時不受浮點誤差影響（data-validator 回報）', () => {
  assert.equal(classifyScore(78.8, [77.6, 78.2, 78.8]), 'progress');
  assert.equal(classifyScore(77.8, [77.8, 78.4, 79]), 'fluctuation');
});

test('classifyScore：門檻邊界（mean 80、std 10）', () => {
  const h = [70, 80, 90];
  assert.equal(classifyScore(91, h), 'peak');
  assert.equal(classifyScore(90, h), 'progress'); // 等於最高不算 peak
  assert.equal(classifyScore(87, h), 'stable'); // 介於 +0.5σ 與 +1σ 之間落到預設
  assert.equal(classifyScore(85, h), 'stable');
  assert.equal(classifyScore(75, h), 'stable');
  assert.equal(classifyScore(72, h), 'stable'); // 介於 -1σ 與 -0.5σ 之間落到預設
  assert.equal(classifyScore(70, h), 'fluctuation');
  assert.equal(classifyScore(0, h), 'fluctuation');
});

test('classifyScore：小數分數', () => {
  const h = [87.5, 88.5, 86.5]; // mean 87.5, std 1
  assert.equal(classifyScore(89, h), 'peak');
  assert.equal(classifyScore(88.5, h), 'progress');
  assert.equal(classifyScore(87.5, h), 'stable');
  assert.equal(classifyScore(86.5, h), 'fluctuation');
});

test('classifyScore：不會改動歷史陣列', () => {
  const h = [90, 70, 80];
  classifyScore(85, h);
  assert.deepEqual(h, [90, 70, 80]);
});

test('classifyScore：1000 筆歷史不會炸', () => {
  const h = Array.from({ length: 1000 }, (_, i) => i % 101);
  assert.ok(CATEGORIES.includes(classifyScore(50, h)));
});

test('classifyScore：current 為 NaN 不會丟例外（回傳仍是合法類別）', () => {
  assert.doesNotThrow(() => classifyScore(NaN, [70, 80, 90]));
  assert.ok(CATEGORIES.includes(classifyScore(NaN, [70, 80, 90])));
});

test.todo('classifyScore：current 為 NaN 目前回傳 stable，可能應該是 insufficient_data（待決定）');

/* ---------- classifyLatestSitting ---------- */

test('classifyLatestSitting：0 筆 → null', () => {
  assert.equal(classifyLatestSitting([]), null);
});

test('classifyLatestSitting：1、2、3 筆 → insufficient_data', () => {
  const rows = [row(1, 1, 1, 'm', 80), row(1, 1, 2, 'm', 80), row(1, 1, 3, 'm', 80)];
  for (let n = 1; n <= 3; n++) {
    const r = classifyLatestSitting(buildSittings(rows.slice(0, n)));
    assert.equal(r.category, 'insufficient_data');
    assert.equal(sittingKey(r.sitting), sittingKey(rows[n - 1]));
  }
});

test('classifyLatestSitting：第 4 筆有足夠歷史', () => {
  const s = buildSittings([row(1, 1, 1, 'm', 70), row(1, 1, 2, 'm', 80), row(1, 1, 3, 'm', 90), row(1, 2, 1, 'm', 95)]);
  assert.deepEqual(classifyLatestSitting(s), { sitting: s[3], category: 'peak' });
});

test('classifyLatestSitting：歷史中 average 為 null 會被濾掉', () => {
  const s = [
    { grade: 1, semester: 1, exam_type: 1, average: null },
    { grade: 1, semester: 1, exam_type: 2, average: 80 },
    { grade: 1, semester: 1, exam_type: 3, average: 80 },
    { grade: 1, semester: 2, exam_type: 1, average: 80 },
  ];
  assert.equal(classifyLatestSitting(s).category, 'insufficient_data');
});

/* ---------- classifySubjectAt ---------- */

test('classifySubjectAt：科目不存在 → null', () => {
  const rows = [row(1, 1, 1, 'chi', 80)];
  assert.equal(classifySubjectAt(rows, 'math', rows[0]), null);
});

test('classifySubjectAt：該次段考缺這一科 → null', () => {
  const rows = [row(1, 1, 1, 'chi', 80), row(1, 1, 2, 'eng', 80)];
  assert.equal(classifySubjectAt(rows, 'chi', { grade: 1, semester: 1, exam_type: 2 }), null);
});

test('classifySubjectAt：空資料 → null', () => {
  assert.equal(classifySubjectAt([], 'chi', { grade: 1, semester: 1, exam_type: 1 }), null);
});

test('classifySubjectAt：前 3 次 insufficient_data，第 4 次開始判定', () => {
  const rows = [row(1, 1, 1, 'm', 70), row(1, 1, 2, 'm', 80), row(1, 1, 3, 'm', 90), row(1, 2, 1, 'm', 70)];
  assert.equal(classifySubjectAt(rows, 'm', rows[0]), 'insufficient_data');
  assert.equal(classifySubjectAt(rows, 'm', rows[2]), 'insufficient_data');
  assert.equal(classifySubjectAt(rows, 'm', rows[3]), 'fluctuation');
});

test('classifySubjectAt：亂序 + 不連續的段考仍依時間取歷史', () => {
  const rows = [row(3, 1, 1, 'm', 100), row(1, 1, 1, 'm', 70), row(2, 2, 3, 'm', 90), row(1, 2, 1, 'm', 80)];
  assert.equal(classifySubjectAt(rows, 'm', { grade: 3, semester: 1, exam_type: 1 }), 'peak');
});

test('classifySubjectAt：其他科缺漏不影響本科', () => {
  const rows = [
    row(1, 1, 1, 'm', 80), row(1, 1, 1, 'e', 10),
    row(1, 1, 2, 'm', 80),
    row(1, 1, 3, 'm', 80), row(1, 1, 3, 'e', 99),
    row(1, 2, 1, 'm', 80),
  ];
  assert.equal(classifySubjectAt(rows, 'm', rows[5]), 'stable'); // 歷史 80,80,80 再考 80
});
