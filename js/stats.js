// 統計與判定邏輯（對應規劃書第五節：相對於自己歷史表現的判定，而非跟他人比較）

const EXAM_TYPE_LABEL = { 1: '第一次段考', 2: '第二次段考', 3: '第三次段考' };
const SEMESTER_LABEL = { 1: '上學期', 2: '下學期' };
const GRADE_LABEL = { 1: '國一', 2: '國二', 3: '國三' };
const CATEGORY_LABEL = {
  progress: '進步中',
  stable: '穩定發揮',
  fluctuation: '醞釀成長期',
  peak: '個人巔峰',
  insufficient_data: '記錄累積中',
};

function sittingKey(row) {
  return `${row.grade}-${row.semester}-${row.exam_type}`;
}

function sittingOrder(row) {
  return row.grade * 10 + row.semester * 3 + row.exam_type;
}

// 把逐科的 exam_scores 攤平成「一次段考一筆」的彙總，並依時間排序
function buildSittings(examScores) {
  const map = new Map();
  for (const row of examScores) {
    const key = sittingKey(row);
    if (!map.has(key)) {
      map.set(key, { grade: row.grade, semester: row.semester, exam_type: row.exam_type, scores: {} });
    }
    map.get(key).scores[row.subject] = row.score;
  }
  const sittings = Array.from(map.values()).map((s) => {
    const values = Object.values(s.scores);
    const total = values.reduce((a, b) => a + b, 0);
    const average = values.length ? total / values.length : null;
    return { ...s, total, average, subjectCount: values.length };
  });
  sittings.sort((a, b) => sittingOrder(a) - sittingOrder(b));
  return sittings;
}

// 依「本次成績 vs 歷史平均與標準差」判定類別，thresholds 對應規劃書第五節的規則
function classifyScore(currentScore, historicalScores) {
  if (historicalScores.length < 3) return 'insufficient_data';

  const mean = historicalScores.reduce((a, b) => a + b, 0) / historicalScores.length;
  const variance =
    historicalScores.reduce((a, b) => a + (b - mean) ** 2, 0) / (historicalScores.length - 1);
  const std = Math.sqrt(variance);
  const maxHistorical = Math.max(...historicalScores);

  if (currentScore > maxHistorical) return 'peak';
  if (currentScore >= mean + std) return 'progress';
  if (currentScore >= mean - 0.5 * std && currentScore <= mean + 0.5 * std) return 'stable';
  if (currentScore <= mean - std) return 'fluctuation';
  return 'stable';
}

// 針對「整次段考的平均分」做判定，用於 hero 區的整體鼓勵語
function classifyLatestSitting(sittings) {
  if (sittings.length === 0) return null;
  const latest = sittings[sittings.length - 1];
  const historical = sittings.slice(0, -1).map((s) => s.average).filter((v) => v !== null);
  const category = classifyScore(latest.average, historical);
  return { sitting: latest, category };
}

// 針對某一科目在某次段考的判定，用於歷史紀錄表格逐列標籤
function classifySubjectAt(examScores, subjectCode, sittingRow) {
  const sameSubject = examScores
    .filter((r) => r.subject === subjectCode)
    .sort((a, b) => sittingOrder(a) - sittingOrder(b));
  const idx = sameSubject.findIndex(
    (r) => r.grade === sittingRow.grade && r.semester === sittingRow.semester && r.exam_type === sittingRow.exam_type
  );
  if (idx === -1) return null;
  const current = sameSubject[idx];
  const historical = sameSubject.slice(0, idx).map((r) => r.score);
  return classifyScore(current.score, historical);
}

// 目前學生走到第幾個「學年進化階段」：依最新一次已記錄段考的年級，沒有資料則預設國一
function currentCompanionStage(sittings) {
  if (sittings.length === 0) return 1;
  return sittings[sittings.length - 1].grade;
}
