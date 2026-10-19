// 模擬圖的計算原型：里程碑、學年地圖分級、排名變化。
// 依賴正式的 js/stats.js（buildSittings、classifyScore、sittingKey…），判定門檻不另外改寫。
// Phase 2 會把這些純函式搬進 js/milestones.js 並補 node --test 測試；這裡只是原型。

const ALL_SLOTS = [];
for (const grade of [1, 2, 3]) {
  for (const semester of [1, 2]) {
    for (const exam_type of [1, 2, 3]) ALL_SLOTS.push({ grade, semester, exam_type });
  }
}

function slotShortLabel(s) {
  return `${GRADE_LABEL[s.grade]}${s.semester === 1 ? '上' : '下'}・${['', '一', '二', '三'][s.exam_type]}`;
}

function slotLongLabel(s) {
  return `${GRADE_LABEL[s.grade]}${s.semester === 1 ? '上' : '下'}・${EXAM_TYPE_LABEL[s.exam_type]}`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// 學年地圖：該次平均在「自己全部已考平均」中的相對位置 → 1..4 級；少於 3 筆回傳 0（中性）
function heatLevel(average, allAverages) {
  if (average == null || allAverages.length < 3) return 0;
  const min = Math.min(...allAverages);
  const max = Math.max(...allAverages);
  if (max === min) return 2;
  return 1 + Math.round(((average - min) / (max - min)) * 3);
}

// 與上一次段考的排名變化：正數 = 名次往前
function rankChange(rankings, sitting) {
  const sorted = [...rankings].sort((a, b) => sittingOrder(a) - sittingOrder(b));
  const idx = sorted.findIndex((r) => sittingKey(r) === sittingKey(sitting));
  if (idx <= 0) return null;
  return sorted[idx - 1].rank - sorted[idx].rank;
}

// 里程碑（規劃書 6.5）；回傳依時間排序的清單，每筆標記在哪次段考取得
function computeMilestones(sittings, rankings, subjects) {
  const result = [];
  const subjectBest = {};
  let risingStreak = 0;
  let steadyStreak = 0;
  const keys = new Set(sittings.map(sittingKey));
  const rankByKey = new Map(rankings.map((r) => [sittingKey(r), r]));

  sittings.forEach((s, i) => {
    const at = { grade: s.grade, semester: s.semester, exam_type: s.exam_type };
    const add = (id, title, detail) => result.push({ id, title, detail, at });

    if (i === 0) add('first', '踏出第一步', '記下了第一次段考');

    // 科目新高：同一次段考的多科合併成一個里程碑，避免數量灌水
    const newBests = [];
    for (const subj of subjects) {
      const score = s.scores[subj.code];
      if (score == null) continue;
      if (subj.code in subjectBest && score > subjectBest[subj.code]) newBests.push(`${subj.display_name} ${score}`);
      subjectBest[subj.code] = Math.max(subjectBest[subj.code] ?? -Infinity, score);
    }
    if (newBests.length) {
      add('subject-best', '科目新高', `${newBests.join('、')} 分，都超過自己之前的最高`);
    }

    const prevAverages = sittings.slice(0, i).map((p) => p.average);
    if (i > 0 && s.average > Math.max(...prevAverages)) {
      add('avg-best', '平均新高', `平均 ${round1(s.average).toFixed(1)} 分，是目前最高的一次`);
    }

    risingStreak = i > 0 && s.average > sittings[i - 1].average ? risingStreak + 1 : 0;
    if (risingStreak === 2) add('rising', '連續進步', '平均連續兩次往上');

    const category = classifyScore(s.average, prevAverages);
    steadyStreak = ['stable', 'progress', 'peak'].includes(category) ? steadyStreak + 1 : 0;
    if (steadyStreak === 3) add('steady', '穩定三連', '連續三次維持在自己的水準以上');

    const rank = rankByKey.get(sittingKey(s));
    const prevRank = i > 0 ? rankByKey.get(sittingKey(sittings[i - 1])) : null;
    if (rank && prevRank && rank.rank < prevRank.rank) {
      add('rank-up', '名次前進', `校排名前進 ${prevRank.rank - rank.rank} 名`);
    }

    if (s.exam_type === 3 && [1, 2, 3].every((e) => keys.has(`${s.grade}-${s.semester}-${e}`))) {
      add('semester', '學期完成', `${GRADE_LABEL[s.grade]}${SEMESTER_LABEL[s.semester]}三次段考都記錄了`);
      if (s.semester === 2 && [1, 2, 3].every((e) => keys.has(`${s.grade}-1-${e}`))) {
        add('year', '學年完成', `${GRADE_LABEL[s.grade]}六次段考全部完成`);
      }
    }
  });
  return result;
}

const MILESTONE_ICON = {
  first: 'foot', semester: 'flag', year: 'flag', rising: 'arrow', steady: 'leaf',
  'avg-best': 'star', 'rank-up': 'arrow', 'subject-best': 'star',
};
