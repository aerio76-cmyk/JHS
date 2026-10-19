// milestones.js 邊界測試：鎖住使用者確認過的里程碑規則，並確保異常輸入不會炸。
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSittings, sittingKey } = require('../js/stats.js');
const {
  heatLevel, rankChange, computeMilestones, topSubject, highlightSubject, termAverages,
  pickQuote, quoteForSitting, safeThemeColor, avatarSrc, diffText, rankDeltaText, formatScore,
} = require('../js/milestones.js');

const SUBJECTS = [
  { code: 'chi', display_name: '國文' },
  { code: 'eng', display_name: '英文' },
  { code: 'math', display_name: '數學' },
];

const SLOTS = [];
for (const g of [1, 2, 3]) for (const s of [1, 2]) for (const e of [1, 2, 3]) SLOTS.push({ grade: g, semester: s, exam_type: e });

// specs: [[grade, semester, exam_type, { chi: 80, ... }], ...]
function mk(specs) {
  const rows = [];
  for (const [grade, semester, exam_type, scores] of specs) {
    for (const [subject, score] of Object.entries(scores)) rows.push({ grade, semester, exam_type, subject, score });
  }
  return buildSittings(rows);
}

// 依序放在前 n 個段考，每科同分 = 平均
function byAverages(avgs) {
  return mk(avgs.map((a, i) => [SLOTS[i].grade, SLOTS[i].semester, SLOTS[i].exam_type, { chi: a, eng: a, math: a }]));
}

const ids = (ms) => ms.map((m) => m.id);
const only = (ms, id) => ms.filter((m) => m.id === id);
const at = (m) => sittingKey(m.at);

/* ---------- computeMilestones：資料量 ---------- */

test('computeMilestones：0 筆 → 空陣列', () => {
  assert.deepEqual(computeMilestones([], [], SUBJECTS), []);
});

test('computeMilestones：1 筆 → 只有踏出第一步', () => {
  const ms = computeMilestones(byAverages([80]), [], SUBJECTS);
  assert.deepEqual(ids(ms), ['first']);
  assert.equal(at(ms[0]), '1-1-1');
});

test('computeMilestones：2 筆、第二次全面較高 → 科目新高合併成 1 個 + 平均新高', () => {
  const ms = computeMilestones(mk([[1, 1, 1, { chi: 70, eng: 70, math: 70 }], [1, 1, 2, { chi: 80, eng: 75, math: 70 }]]), [], SUBJECTS);
  assert.deepEqual(ids(ms), ['first', 'subject-best', 'avg-best']);
  const sb = only(ms, 'subject-best');
  assert.equal(sb.length, 1);
  assert.match(sb[0].detail, /國文 80/);
  assert.match(sb[0].detail, /英文 75/);
  assert.doesNotMatch(sb[0].detail, /數學/); // 同分不算新高
});

test('computeMilestones：subjects 為空陣列不會炸，且不產生科目新高', () => {
  const ms = computeMilestones(byAverages([70, 80]), [], []);
  assert.deepEqual(ids(ms), ['first', 'avg-best']);
});

test('computeMilestones：第 1 筆不會觸發科目新高／平均新高／名次前進', () => {
  const ms = computeMilestones(byAverages([100]), [{ grade: 1, semester: 1, exam_type: 1, rank: 1, total: 300 }], SUBJECTS);
  assert.deepEqual(ids(ms), ['first']);
});

test('computeMilestones：每筆 at 指向取得的段考，且整體依時間排序', () => {
  const ms = computeMilestones(byAverages([70, 75, 80, 85]), [], SUBJECTS);
  for (const m of ms) assert.deepEqual(Object.keys(m.at).sort(), ['exam_type', 'grade', 'semester']);
  const order = ms.map((m) => m.at.grade * 100 + m.at.semester * 10 + m.at.exam_type);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

/* ---------- 科目新高 ---------- */

test('科目新高：同分不算；全滿分 100 連續多次不會一直給', () => {
  const ms = computeMilestones(byAverages([100, 100, 100, 100]), [], SUBJECTS);
  assert.equal(only(ms, 'subject-best').length, 0);
  assert.equal(only(ms, 'avg-best').length, 0);
});

test('科目新高：要高於「過去最高」而不是「上一次」', () => {
  const ms = computeMilestones(mk([
    [1, 1, 1, { math: 90 }], [1, 1, 2, { math: 60 }], [1, 1, 3, { math: 80 }], [1, 2, 1, { math: 91 }],
  ]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'subject-best').map(at), ['1-2-1']);
});

test('科目新高：缺科時跳過，下次出現仍跟過去最高比', () => {
  const ms = computeMilestones(mk([
    [1, 1, 1, { chi: 80, math: 70 }],
    [1, 1, 2, { chi: 80 }], // 缺數學
    [1, 1, 3, { chi: 80, math: 71 }],
  ]), [], SUBJECTS);
  const sb = only(ms, 'subject-best');
  assert.deepEqual(sb.map(at), ['1-1-3']);
  assert.match(sb[0].detail, /數學 71/);
});

test('科目新高：某科第一次出現（之前從沒考過）不算新高', () => {
  const ms = computeMilestones(mk([[1, 1, 1, { chi: 80 }], [1, 1, 2, { chi: 70, math: 100 }]]), [], SUBJECTS);
  assert.equal(only(ms, 'subject-best').length, 0);
});

test('科目新高：小數分數 87.5 正確顯示', () => {
  const ms = computeMilestones(mk([[1, 1, 1, { chi: 87 }], [1, 1, 2, { chi: 87.5 }]]), [], SUBJECTS);
  assert.match(only(ms, 'subject-best')[0].detail, /國文 87\.5/);
});

test('科目新高：不在 subjects 清單的科目會被忽略', () => {
  const ms = computeMilestones(mk([[1, 1, 1, { pe: 60 }], [1, 1, 2, { pe: 100 }]]), [], SUBJECTS);
  assert.equal(only(ms, 'subject-best').length, 0);
});

/* ---------- 平均新高 ---------- */

test('平均新高：要高於過去「所有次」，等於不給', () => {
  const ms = computeMilestones(byAverages([90, 70, 80, 90, 90.5]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'avg-best').map(at), ['1-2-2']);
  assert.match(only(ms, 'avg-best')[0].detail, /90\.5/);
});

/* ---------- 連續進步 ---------- */

test('連續進步：平均連續 2 次上升給一次；連續 3 次上升不再給', () => {
  const ms = computeMilestones(byAverages([70, 75, 80, 85, 90]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'rising').map(at), ['1-1-3']);
});

test('連續進步：只上升 1 次不給', () => {
  assert.equal(only(computeMilestones(byAverages([70, 75]), [], SUBJECTS), 'rising').length, 0);
  assert.equal(only(computeMilestones(byAverages([70, 75, 75]), [], SUBJECTS), 'rising').length, 0);
});

test('連續進步：中斷後重新累積到 2 會再給一次', () => {
  const ms = computeMilestones(byAverages([70, 75, 80, 70, 75, 80]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'rising').map(at), ['1-1-3', '1-2-3']);
});

test('連續進步：持平會中斷', () => {
  const ms = computeMilestones(byAverages([70, 75, 75, 80]), [], SUBJECTS);
  assert.equal(only(ms, 'rising').length, 0);
});

/* ---------- 穩定三連 ---------- */

test('穩定三連：前 3 筆資料不足（insufficient_data）不計，第 6 筆才剛好達到 3', () => {
  const ms = computeMilestones(byAverages([80, 80, 80, 80, 80, 80, 80, 80]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'steady').map(at), ['1-2-3']);
});

test('穩定三連：只有 5 筆時不會給', () => {
  const ms = computeMilestones(byAverages([80, 80, 80, 80, 80]), [], SUBJECTS);
  assert.equal(only(ms, 'steady').length, 0);
});

test('穩定三連：fluctuation 會中斷', () => {
  // i=3 stable、i=4 stable、i=5 低分 fluctuation → 重來
  const ms = computeMilestones(byAverages([80, 80, 80, 80, 80, 50]), [], SUBJECTS);
  assert.equal(only(ms, 'steady').length, 0);
});

test('穩定三連：peak / progress 也算在連續內', () => {
  // 70,80,90 之後 95(peak)、96(peak)、97(peak)
  const ms = computeMilestones(byAverages([70, 80, 90, 95, 96, 97]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'steady').map(at), ['1-2-3']);
});

/* ---------- 名次前進 / rankChange ---------- */

const R = (g, s, e, rank, total = 300) => ({ grade: g, semester: s, exam_type: e, rank, total });

test('rankChange：空排名、沒有這次排名、第一筆排名 → null', () => {
  const s = { grade: 1, semester: 1, exam_type: 2 };
  assert.equal(rankChange([], s), null);
  assert.equal(rankChange([R(1, 1, 1, 10)], s), null);
  assert.equal(rankChange([R(1, 1, 2, 10)], s), null);
});

test('rankChange：正數 = 前進；亂序輸入會先排序；不改動輸入', () => {
  const rk = [R(1, 1, 2, 5), R(1, 1, 1, 10)];
  const snapshot = JSON.parse(JSON.stringify(rk));
  assert.equal(rankChange(rk, { grade: 1, semester: 1, exam_type: 2 }), 5);
  assert.deepEqual(rk, snapshot);
});

test('名次前進：只比名次，不看總人數', () => {
  const sittings = byAverages([80, 80]);
  // 名次一樣但總人數變多 → 不給
  assert.equal(only(computeMilestones(sittings, [R(1, 1, 1, 5, 100), R(1, 1, 2, 5, 300)], SUBJECTS), 'rank-up').length, 0);
  // 名次數字變小但總人數也變少 → 仍給
  const ms = computeMilestones(sittings, [R(1, 1, 1, 50, 300), R(1, 1, 2, 40, 100)], SUBJECTS);
  assert.equal(only(ms, 'rank-up').length, 1);
  assert.match(only(ms, 'rank-up')[0].detail, /10/);
});

test('名次前進：第 1 名維持第 1 名不給；第 1 名掉到第 2 名不給', () => {
  const sittings = byAverages([80, 80, 80]);
  const ms = computeMilestones(sittings, [R(1, 1, 1, 1), R(1, 1, 2, 1), R(1, 1, 3, 2)], SUBJECTS);
  assert.equal(only(ms, 'rank-up').length, 0);
});

test('名次前進：最後一名（rank = total）前進 1 名', () => {
  const ms = computeMilestones(byAverages([80, 80]), [R(1, 1, 1, 300, 300), R(1, 1, 2, 299, 300)], SUBJECTS);
  assert.deepEqual(only(ms, 'rank-up').map(at), ['1-1-2']);
});

test('名次前進：中間某次沒有排名 → 該次不給，下一次跟「上一筆排名紀錄」比', () => {
  const ms = computeMilestones(byAverages([80, 80, 80]), [R(1, 1, 1, 20), R(1, 1, 3, 10)], SUBJECTS);
  const ru = only(ms, 'rank-up');
  assert.deepEqual(ru.map(at), ['1-1-3']);
  assert.match(ru[0].detail, /10/);
});

test('名次前進：排名紀錄比成績多（某次只有排名沒有成績）不會炸', () => {
  const ms = computeMilestones(byAverages([80]), [R(1, 1, 1, 20), R(1, 1, 2, 5)], SUBJECTS);
  assert.deepEqual(ids(ms), ['first']);
});

/* ---------- 學期完成 / 學年完成 ---------- */

test('學期完成：同學期 3 次都有，在第 3 次給', () => {
  const ms = computeMilestones(byAverages([80, 80, 80]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'semester').map(at), ['1-1-3']);
  assert.equal(only(ms, 'year').length, 0);
});

test('學期完成：缺第 2 次 → 不給', () => {
  const ms = computeMilestones(mk([[1, 1, 1, { chi: 80 }], [1, 1, 3, { chi: 80 }]]), [], SUBJECTS);
  assert.equal(only(ms, 'semester').length, 0);
});

test('學年完成：6 次都有 → 兩個學期完成 + 一個學年完成', () => {
  const ms = computeMilestones(byAverages([80, 80, 80, 80, 80, 80]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'semester').map(at), ['1-1-3', '1-2-3']);
  assert.deepEqual(only(ms, 'year').map(at), ['1-2-3']);
});

test('學年完成：上學期缺一次 → 只有下學期完成，沒有學年完成', () => {
  const ms = computeMilestones(mk([
    [1, 1, 1, { chi: 80 }], [1, 1, 3, { chi: 80 }],
    [1, 2, 1, { chi: 80 }], [1, 2, 2, { chi: 80 }], [1, 2, 3, { chi: 80 }],
  ]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'semester').map(at), ['1-2-3']);
  assert.equal(only(ms, 'year').length, 0);
});

test('學年完成：三年 18 次全滿 → 6 個學期完成、3 個學年完成', () => {
  const ms = computeMilestones(byAverages(SLOTS.map(() => 80)), [], SUBJECTS);
  assert.equal(only(ms, 'semester').length, 6);
  assert.deepEqual(only(ms, 'year').map(at), ['1-2-3', '2-2-3', '3-2-3']);
});

test('段考不連續（1-1-1 與 2-1-1）：不會炸，只有第一步與可能的新高', () => {
  const ms = computeMilestones(mk([[1, 1, 1, { chi: 70, eng: 70, math: 70 }], [2, 1, 1, { chi: 90, eng: 70, math: 70 }]]), [R(1, 1, 1, 10), R(2, 1, 1, 3)], SUBJECTS);
  assert.deepEqual(ids(ms), ['first', 'subject-best', 'avg-best', 'rank-up']);
  assert.equal(at(ms[1]), '2-1-1');
});

/* ---------- data-validator 回報後的修正（2026-10-19） ---------- */

test('平均新高：缺科那次即使平均較高也不給（只算登錄科目的平均不能公平比較）', () => {
  // 第 2 次缺英文（弱科），3 科中只登錄 2 科，平均被灌高到 85
  const ms = computeMilestones(mk([[1, 1, 1, { chi: 80, eng: 60, math: 80 }], [1, 1, 2, { chi: 85, math: 85 }]]), [], SUBJECTS);
  assert.equal(only(ms, 'avg-best').length, 0);
  // 科目新高照常給
  assert.equal(only(ms, 'subject-best').length, 1);
});

test('平均新高／連續進步：浮點加總順序造成的尾差不會誤判', () => {
  const scores = [80.1, 70.2, 90.3];
  const rows = (order, exam) => order.map((i) => ({ grade: 1, semester: 1, exam_type: exam, subject: SUBJECTS[i].code, score: scores[i] }));
  const sittings = buildSittings([...rows([0, 1, 2], 1), ...rows([2, 1, 0], 2)]);
  assert.equal(sittings[0].average, sittings[1].average);
  assert.equal(only(computeMilestones(sittings, [], SUBJECTS), 'avg-best').length, 0);
});

test('heatLevel：剛好 .5 時四捨五入往上（70／70.6／71.2 → 1／3／4）', () => {
  assert.deepEqual([70, 70.6, 71.2].map((a) => heatLevel(a, [70, 70.6, 71.2])), [1, 3, 4]);
});

test('heatLevel：NaN 不會產生 cell--lNaN，回 0', () => {
  assert.equal(heatLevel(80, [70, NaN, 90]), 0);
  assert.equal(heatLevel(NaN, [70, 80, 90]), 0);
});

test('diffText：用畫面上顯示的兩個值相減（83.0 與 80.8 → 2.2；80.8 與 80.2 → 0.6）', () => {
  assert.equal(diffText(83, 80.75), '比上次多 2.2 分');
  assert.equal(diffText(80.75, 80.2), '比上次多 0.6 分');
  assert.equal(diffText(80.2, 80.75), '與上次相差 0.6 分');
});

/* ---------- heatLevel ---------- */

test('heatLevel：資料少於 3 筆 → 0', () => {
  assert.equal(heatLevel(80, []), 0);
  assert.equal(heatLevel(80, [80]), 0);
  assert.equal(heatLevel(80, [70, 80]), 0);
});

test('heatLevel：average 為 null／undefined → 0', () => {
  assert.equal(heatLevel(null, [70, 80, 90]), 0);
  assert.equal(heatLevel(undefined, [70, 80, 90]), 0);
});

test('heatLevel：全部同分（含全滿分 100）→ 2', () => {
  assert.equal(heatLevel(80, [80, 80, 80]), 2);
  assert.equal(heatLevel(100, [100, 100, 100, 100]), 2);
});

test('heatLevel：min → 1、max → 4、中間落在 1..4', () => {
  const all = [60, 70, 80, 90];
  assert.equal(heatLevel(60, all), 1);
  assert.equal(heatLevel(90, all), 4);
  for (const a of all) {
    const lv = heatLevel(a, all);
    assert.ok(Number.isInteger(lv) && lv >= 1 && lv <= 4);
  }
});

test('heatLevel：小數分數', () => {
  assert.equal(heatLevel(87.5, [85, 87.5, 90]), 3); // 0.5*3=1.5 → round 2 → 3
});

/* ---------- topSubject / highlightSubject ---------- */

test('topSubject：沒有分數 → null；同分取科目順序在前', () => {
  assert.equal(topSubject({ scores: {} }, SUBJECTS), null);
  assert.deepEqual(topSubject({ scores: { math: 90, chi: 90 } }, SUBJECTS), { code: 'chi', score: 90 });
});

test('topSubject：0 分也算有分數', () => {
  assert.deepEqual(topSubject({ scores: { math: 0 } }, SUBJECTS), { code: 'math', score: 0 });
});

test('highlightSubject：第一次（prev 為 null）取最高分、gain 為 null', () => {
  assert.deepEqual(highlightSubject({ scores: { chi: 70, math: 95 } }, null, SUBJECTS), { code: 'math', score: 95, gain: null });
});

test('highlightSubject：取進步最多的科目', () => {
  const r = highlightSubject({ scores: { chi: 80, eng: 90, math: 75 } }, { scores: { chi: 70, eng: 88, math: 60 } }, SUBJECTS);
  assert.deepEqual(r, { code: 'math', score: 75, gain: 15 });
});

test('highlightSubject：進步幅度同分取科目順序在前', () => {
  const r = highlightSubject({ scores: { chi: 80, math: 80 } }, { scores: { chi: 70, math: 70 } }, SUBJECTS);
  assert.equal(r.code, 'chi');
});

test('highlightSubject：沒有任何科目進步 → 取最高分', () => {
  const r = highlightSubject({ scores: { chi: 60, math: 90 } }, { scores: { chi: 60, math: 95 } }, SUBJECTS);
  assert.deepEqual(r, { code: 'math', score: 90, gain: null });
});

test('highlightSubject：上次缺該科時不比較', () => {
  const r = highlightSubject({ scores: { chi: 61, math: 100 } }, { scores: { chi: 60 } }, SUBJECTS);
  assert.deepEqual(r, { code: 'chi', score: 61, gain: 1 });
});

test('highlightSubject：本次沒有任何分數 → null', () => {
  assert.equal(highlightSubject({ scores: {} }, { scores: { chi: 60 } }, SUBJECTS), null);
});

test('highlightSubject：小數進步 0.5', () => {
  const r = highlightSubject({ scores: { chi: 87.5 } }, { scores: { chi: 87 } }, SUBJECTS);
  assert.equal(r.gain, 0.5);
});

/* ---------- termAverages ---------- */

test('termAverages：0 筆 → []', () => {
  assert.deepEqual(termAverages([]), []);
});

test('termAverages：不連續學期只列有紀錄的，count 正確', () => {
  const r = termAverages(byAverages([80, 90]).concat(mk([[2, 1, 1, { chi: 87.5 }]])));
  assert.deepEqual(r, [
    { grade: 1, semester: 1, count: 2, average: 85 },
    { grade: 2, semester: 1, count: 1, average: 87.5 },
  ]);
});

/* ---------- pickQuote / quoteForSitting ---------- */

const Q = [
  { id: 1, category: 'stable', content: 'a' },
  { id: 2, category: 'stable', content: 'b' },
  { id: 3, category: 'stable', content: 'c' },
  { id: 4, category: 'peak', content: 'd' },
];

test('pickQuote：空清單或該類別沒有 → null', () => {
  assert.equal(pickQuote([], 'stable'), null);
  assert.equal(pickQuote(Q, 'progress'), null);
});

test('pickQuote：避開 recentIds', () => {
  for (const r of [0, 0.5, 0.999]) {
    assert.equal(pickQuote(Q, 'stable', [1, 2], () => r).id, 3);
  }
});

test('pickQuote：全部都用過就不避開', () => {
  assert.equal(pickQuote(Q, 'stable', [1, 2, 3], () => 0).id, 1);
  assert.equal(pickQuote(Q, 'stable', [1, 2, 3], () => 0.999).id, 3);
});

test('pickQuote：rand 注入決定挑選位置；未傳 recentIds／rand 也可用', () => {
  assert.equal(pickQuote(Q, 'stable', [], () => 0.4).id, 2);
  assert.equal(pickQuote(Q, 'peak').id, 4);
});

test('pickQuote：recentIds 含不存在的 id 不影響', () => {
  assert.equal(pickQuote(Q, 'peak', [999, 'x'], () => 0).id, 4);
});

test('pickQuote：rand() 回傳 1（超出 [0,1)）時仍回傳清單內的句子', () => {
  const q = pickQuote(Q, 'stable', [], () => 1);
  assert.ok(q && q.category === 'stable');
});

test('pickQuote：recentIds 傳 null 不會炸', () => {
  assert.doesNotThrow(() => pickQuote(Q, 'stable', null));
  assert.ok(pickQuote(Q, 'stable', null));
});

test('quoteForSitting：沒有該類別 → null；同一次段考固定同一句', () => {
  const s = { grade: 1, semester: 2, exam_type: 3 };
  assert.equal(quoteForSitting(Q, 'progress', s), null);
  const a = quoteForSitting(Q, 'stable', s);
  assert.ok(a);
  assert.equal(quoteForSitting(Q, 'stable', s), a);
});

test('quoteForSitting：18 個段考都能取到句子', () => {
  for (const s of SLOTS) assert.ok(quoteForSitting(Q, 'stable', s));
});

/* ---------- safeThemeColor ---------- */

test('safeThemeColor：合法 #RRGGBB（大小寫）', () => {
  assert.equal(safeThemeColor('#a1B2c3', '#000000'), '#a1B2c3');
  assert.equal(safeThemeColor('#FFFFFF', '#000000'), '#FFFFFF');
});

test('safeThemeColor：非法值退回 fallback', () => {
  const bad = [
    '#fff', '#fff;background:url(x)', '#ffffff;background:url(x)', 'javascript:alert(1)', '../x',
    'red', '#GGGGGG', '#1234567', ' #ffffff', '#ffffff ', '#ffffff\n', 'rgb(0,0,0)', '', null, undefined,
    0xffffff, {}, ['#ffffff'], { toString: () => '#ffffff' },
  ];
  for (const v of bad) assert.equal(safeThemeColor(v, 'FB'), 'FB', `應拒絕 ${String(v)}`);
});

/* ---------- avatarSrc ---------- */

const OK_URL = 'https://abcdef123.supabase.co/storage/v1/object/public/avatars/u1.png';

test('avatarSrc：合法上傳網址優先', () => {
  assert.equal(avatarSrc({ avatar_url: OK_URL, avatar_preset: 'bear' }), OK_URL);
});

test('avatarSrc：預設款 cat/bunny/bear/penguin', () => {
  for (const p of ['cat', 'bunny', 'bear', 'penguin']) assert.equal(avatarSrc({ avatar_preset: p }), `assets/avatars/${p}.svg`);
});

test('avatarSrc：非法網址退回預設款', () => {
  const bad = [
    'javascript:alert(1)',
    'http://abc.supabase.co/storage/v1/object/public/avatars/x.png',
    'https://evil.com/storage/v1/object/public/avatars/x.png',
    'https://abc.supabase.co.evil.com/storage/v1/object/public/avatars/x.png',
    'https://evil.com/?https://abc.supabase.co/storage/v1/object/public/avatars/',
    'https://abc.supabase.co/storage/v1/object/public/other/x.png',
    'https://a.b.supabase.co/storage/v1/object/public/avatars/x.png',
    '../../storage/v1/object/public/avatars/x.png',
    ' ' + OK_URL,
    '', null,
  ];
  for (const u of bad) assert.equal(avatarSrc({ avatar_url: u, avatar_preset: 'bunny' }), 'assets/avatars/bunny.svg', `應拒絕 ${u}`);
});

test('avatarSrc：非法預設款退回 cat', () => {
  const bad = ['dog', '../../etc/passwd', 'cat.svg', 'CAT', 'javascript:alert(1)', '__proto__', 'constructor', '', null, undefined, 1];
  for (const p of bad) assert.equal(avatarSrc({ avatar_preset: p }), 'assets/avatars/cat.svg', `應拒絕 ${String(p)}`);
});

test('avatarSrc：空物件 → cat', () => {
  assert.equal(avatarSrc({}), 'assets/avatars/cat.svg');
});

test('avatarSrc：avatars/ 之後含 ../ 一律拒絕，退回預設款', () => {
  const s = { avatar_url: 'https://abc.supabase.co/storage/v1/object/public/avatars/../../private/x.png', avatar_preset: 'bear' };
  assert.equal(avatarSrc(s), 'assets/avatars/bear.svg');
});

test('avatarSrc：student 為 null／undefined 時退回 cat，不會炸', () => {
  assert.equal(avatarSrc(null), 'assets/avatars/cat.svg');
  assert.equal(avatarSrc(undefined), 'assets/avatars/cat.svg');
});

/* ---------- diffText / rankDeltaText / formatScore ---------- */

test('diffText：第一次、增加、減少、相同', () => {
  assert.equal(diffText(80, null), '第一次記錄');
  assert.equal(diffText(80, undefined), '第一次記錄');
  assert.equal(diffText(87.5, 80), '比上次多 7.5 分');
  assert.equal(diffText(80, 87.5), '與上次相差 7.5 分');
  assert.equal(diffText(80, 80), '跟上次一樣');
  assert.equal(diffText(100, 0), '比上次多 100.0 分');
});

test('diffText：四捨五入後為 0（含 -0）顯示「跟上次一樣」，不出現「相差 0.0」', () => {
  assert.equal(diffText(80.04, 80), '跟上次一樣');
  assert.equal(diffText(80, 80.04), '跟上次一樣');
  assert.equal(diffText(87.45, 87.5), '跟上次一樣');
});

test('diffText：文案不出現「退步」', () => {
  for (const [c, p] of [[0, 100], [50, 51], [99.9, 100]]) assert.doesNotMatch(diffText(c, p), /退步/);
});

test('rankDeltaText：null／前進／後退／相同', () => {
  assert.equal(rankDeltaText(null), '這是第一筆排名紀錄');
  assert.equal(rankDeltaText(undefined), '這是第一筆排名紀錄');
  assert.equal(rankDeltaText(5), '比上次前進 5 名');
  assert.equal(rankDeltaText(-3), '與上次相差 3 名');
  assert.equal(rankDeltaText(0), '跟上次同名次');
  assert.doesNotMatch(rankDeltaText(-299), /退步/);
});

test('formatScore：null／undefined／NaN → —；一般數值保留 1 位小數', () => {
  assert.equal(formatScore(null), '—');
  assert.equal(formatScore(undefined), '—');
  assert.equal(formatScore(NaN), '—');
  assert.equal(formatScore(0), '0.0');
  assert.equal(formatScore(100), '100.0');
  assert.equal(formatScore(87.5), '87.5');
  assert.equal(formatScore(87.45), '87.5');
  assert.equal(formatScore(86.6667), '86.7');
});

/* ---------- reviewer 回報後的修正（2026-10-19） ---------- */
const { parseRoute, isSafeAvatarUrl } = require('../js/milestones.js');

const VIEWS = { home: 1, growth: 1, map: 1, history: 1, exam: 1 };

test('parseRoute：一般路由與段考參數', () => {
  assert.deepEqual(parseRoute('#/map', VIEWS), { name: 'map', arg: '' });
  assert.deepEqual(parseRoute('#/exam/1-2-3', VIEWS), { name: 'exam', arg: '1-2-3' });
  assert.deepEqual(parseRoute('', VIEWS), { name: 'home', arg: '' });
  assert.deepEqual(parseRoute(undefined, VIEWS), { name: 'home', arg: '' });
});

test('parseRoute：原型鏈上的名稱與未知路由一律退回首頁', () => {
  for (const h of ['#/constructor', '#/__proto__', '#/toString', '#/hasOwnProperty', '#/nope', '#/<img src=x>']) {
    assert.equal(parseRoute(h, VIEWS).name, 'home', h);
  }
});

test('isSafeAvatarUrl：只接受本專案 origin 的 avatars 路徑', () => {
  const origin = 'https://abc123.supabase.co';
  assert.equal(isSafeAvatarUrl(`${origin}/storage/v1/object/public/avatars/s1.webp?v=1`, origin), true);
  assert.equal(isSafeAvatarUrl('https://other99.supabase.co/storage/v1/object/public/avatars/s1.webp', origin), false);
  assert.equal(isSafeAvatarUrl(`${origin}/storage/v1/object/public/avatars/%2e%2e/private/x.png`, origin), false);
  assert.equal(isSafeAvatarUrl(`${origin}/storage/v1/object/public/avatars/%2E%2E%2Fx.png`, origin), false);
  assert.equal(isSafeAvatarUrl(`${origin}/storage/v1/object/public/avatars/%E0%A4%A`, origin), false); // 壞掉的編碼
  assert.equal(isSafeAvatarUrl(null, origin), false);
});

test('avatarSrc：有 allowedOrigin 時，別的 Supabase 專案退回預設款', () => {
  const s = { avatar_url: 'https://other99.supabase.co/storage/v1/object/public/avatars/x.webp', avatar_preset: 'penguin' };
  assert.equal(avatarSrc(s, 'https://abc123.supabase.co'), 'assets/avatars/penguin.svg');
});

test('平均新高：缺科段考的高平均不會壓掉之後齊全段考的新高', () => {
  const ms = computeMilestones(mk([
    [1, 1, 1, { chi: 70, eng: 70, math: 70 }],
    [1, 1, 2, { chi: 98 }], // 只登錄一科，平均 98
    [1, 1, 3, { chi: 80, eng: 80, math: 80 }], // 齊全，80 > 70 是正當新高
  ]), [], SUBJECTS);
  assert.deepEqual(only(ms, 'avg-best').map(at), ['1-1-3']);
});
