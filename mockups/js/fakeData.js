// 模擬圖專用假資料（不連 Supabase）。欄位形狀與正式資料表 exam_scores / exam_rankings 一致。
// 網址參數 ?data=full|one|empty 可切換資料量，用來檢查空狀態。

const MOCK_SUBJECTS = [
  { code: 'chi', display_name: '國文' },
  { code: 'eng', display_name: '英文' },
  { code: 'math', display_name: '數學' },
  { code: 'sci', display_name: '自然' },
  { code: 'soc', display_name: '社會' },
];

const MOCK_STUDENTS = [
  { id: 'enisa', name: 'Enisa', theme_color: '#F28B6D', avatar_preset: 'cat', avatar_url: null },
  { id: 'milo', name: 'Milo', theme_color: '#3FA796', avatar_preset: 'bear', avatar_url: null },
];

// [grade, semester, exam_type, {subject: score}, rank, total]
const RAW = {
  enisa: [
    [1, 1, 1, { chi: 82, eng: 88, math: 71, sci: 76, soc: 85 }, 96, 412],
    [1, 1, 2, { chi: 85, eng: 90, math: 68, sci: 79, soc: 83 }, 88, 412],
    [1, 1, 3, { chi: 80, eng: 86, math: 74, sci: 81, soc: 88 }, 81, 410],
    [1, 2, 1, { chi: 84, eng: 91, math: 77, sci: 78, soc: 86 }, 64, 408],
    [1, 2, 2, { chi: 79, eng: 87, math: 72, sci: 75, soc: 84 }, 92, 408],
    [1, 2, 3, { chi: 86, eng: 92, math: 80, sci: 83, soc: 87 }, 51, 407],
    [2, 1, 1, { chi: 88, eng: 90, math: 83, sci: 85, soc: 89 }, 40, 405],
    [2, 1, 2, { chi: 87, eng: 94, math: 81, sci: 88, soc: 90 }, 33, 405],
  ],
  milo: [
    [1, 1, 1, { chi: 74, eng: 68, math: 90, sci: 86, soc: 72 }, 72, 330],
    [1, 1, 2, { chi: 78, eng: 70, math: 93, sci: 84, soc: 75 }, 60, 330],
    [1, 1, 3, { chi: 76, eng: 73, math: 88, sci: 90, soc: 74 }, 58, 329],
    // 缺科示範：自然這次沒有登錄
    [1, 2, 1, { chi: 80, eng: 71, math: 95, soc: 77 }, 55, 329],
    [1, 2, 2, { chi: 79, eng: 76, math: 91, sci: 89, soc: 80 }, 41, 328],
  ],
};

const MOCK_QUOTES = {
  progress: ['這次的分數比你上一次更靠近自己想要的樣子了，很扎實的一步。', '看得出來這陣子的努力沒有白費，繼續保持這個節奏就好。'],
  stable: ['穩穩地維持在自己的水準，這種穩定本身就是一種實力。', '平穩前進也是一種前進，繼續照自己的步調走就好。'],
  fluctuation: ['這次的分數只是這段時間的其中一個切片，不是全部的你。', '分數會波動很正常，重要的是你還在持續往前走。'],
  peak: ['這是你目前為止最亮眼的一次，好好記住這個感覺。'],
  insufficient_data: ['每一次段考都是一頁新的紀錄，先把它們一筆一筆存起來。'],
};

function mockDataMode() {
  const mode = new URLSearchParams(location.search).get('data');
  return ['full', 'one', 'empty'].includes(mode) ? mode : 'full';
}

function mockRecordsFor(studentId) {
  const mode = mockDataMode();
  let rows = RAW[studentId] || [];
  if (mode === 'one') rows = rows.slice(0, 1);
  if (mode === 'empty') rows = [];

  const examScores = [];
  const examRankings = [];
  for (const [grade, semester, exam_type, scores, rank, total_students] of rows) {
    for (const [subject, score] of Object.entries(scores)) {
      examScores.push({ grade, semester, exam_type, subject, score });
    }
    examRankings.push({ grade, semester, exam_type, rank, total_students });
  }
  return { examScores, examRankings };
}
