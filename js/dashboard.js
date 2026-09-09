// index.html 主要邏輯：抓資料、算統計、畫出整頁

const COMPANION_ASSET = {
  fox: (stage) => `assets/companions/fox-${stage}.svg`,
  dragon: (stage) => `assets/companions/dragon-${stage}.svg`,
};

const state = {
  students: [],
  subjects: [],
  currentStudent: null,
  examScores: [],
  examRankings: [],
  quizAttempts: [],
  sittings: [],
  selectedSubject: null,
  growthChart: null,
  subjectChart: null,
};

const HISTORY_PAGE_SIZE = 10; // 英文練習題記錄預設顯示筆數，超過用「顯示更多」展開

async function loadStudents() {
  const { data, error } = await sbClient.from('students').select('*').order('enrolled_year');
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

async function loadSubjects() {
  const { data, error } = await sbClient.from('subjects').select('*').order('sort_order');
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

async function loadExamScores(studentId) {
  const { data, error } = await sbClient.from('exam_scores').select('*').eq('student_id', studentId);
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

async function loadExamRankings(studentId) {
  const { data, error } = await sbClient
    .from('exam_rankings')
    .select('*')
    .eq('student_id', studentId);
  if (error) {
    console.error(error);
    return [];
  }
  return (data || []).sort((a, b) => sittingOrder(a) - sittingOrder(b));
}

async function loadQuizAttempts(studentId) {
  const { data, error } = await sbClient
    .from('quiz_attempts')
    .select('*')
    .eq('student_id', studentId)
    .order('taken_at', { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

async function loadQuote(category) {
  const { data, error } = await sbClient
    .from('motivational_quotes')
    .select('*')
    .eq('category', category)
    .eq('is_active', true);
  if (error || !data || data.length === 0) return null;
  return data[Math.floor(Math.random() * data.length)];
}

function subjectName(code) {
  const s = state.subjects.find((x) => x.code === code);
  return s ? s.display_name : code;
}

function renderStudentTabs() {
  const el = document.getElementById('studentTabs');
  el.innerHTML = '';
  state.students.forEach((student) => {
    const btn = document.createElement('button');
    btn.className = 'student-tab' + (state.currentStudent?.id === student.id ? ' is-active' : '');
    btn.textContent = student.name;
    btn.addEventListener('click', () => selectStudent(student));
    el.appendChild(btn);
  });
}

async function selectStudent(student) {
  state.currentStudent = student;
  renderStudentTabs();

  const [examScores, examRankings, quizAttempts] = await Promise.all([
    loadExamScores(student.id),
    loadExamRankings(student.id),
    loadQuizAttempts(student.id),
  ]);
  state.examScores = examScores;
  state.examRankings = examRankings;
  state.quizAttempts = quizAttempts;
  state.sittings = buildSittings(examScores);
  state.selectedSubject = state.subjects[0]?.code || null;

  await renderHeroCompanion();
  renderGrowthChart();
  renderBadgeWall();
  renderSubjectTabs();
  renderSubjectChart();
  renderSemesterCompare();
  renderRankCard();
  renderHistoryTable();
  renderQuizHistoryTable();
}

async function renderHeroCompanion() {
  const img = document.getElementById('companionImg');
  const bubble = document.getElementById('speechBubble');
  const stage = currentCompanionStage(state.sittings);
  const type = state.currentStudent.companion_type;
  img.src = COMPANION_ASSET[type](stage);
  img.alt = `${state.currentStudent.name} 的成長夥伴`;

  const latest = classifyLatestSitting(state.sittings);
  img.classList.toggle('is-peak', latest?.category === 'peak');

  if (!latest) {
    bubble.textContent = `${state.currentStudent.name}的成長記錄還沒開始，第一次段考結束後就會出現在這裡囉。`;
    return;
  }

  if (latest.category === 'insufficient_data') {
    bubble.textContent = '這是我們開始記錄的第一步，之後可以一起看你的成長軌跡。';
    return;
  }

  const quote = await loadQuote(latest.category);
  bubble.textContent = quote ? quote.content : CATEGORY_LABEL[latest.category];
}

function renderGrowthChart() {
  const ctx = document.getElementById('growthChart');
  const labels = state.sittings.map(
    (s) => `${GRADE_LABEL[s.grade]}${SEMESTER_LABEL[s.semester]}\n${EXAM_TYPE_LABEL[s.exam_type]}`
  );
  const data = state.sittings.map((s) => Math.round(s.average * 10) / 10);

  if (state.growthChart) state.growthChart.destroy();
  state.growthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '平均分數',
          data,
          borderColor: '#9FCB9A',
          backgroundColor: '#9FCB9A',
          borderWidth: 4,
          tension: 0.35,
          pointRadius: 6,
          pointBackgroundColor: '#FFFFFF',
          pointBorderColor: '#9FCB9A',
          pointBorderWidth: 3,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, ticks: { stepSize: 20 } },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

function renderBadgeWall() {
  const el = document.getElementById('badgeGrid');
  el.innerHTML = '';
  const requiredSubjectCount = state.subjects.length;

  for (let grade = 1; grade <= 3; grade++) {
    for (let semester = 1; semester <= 2; semester++) {
      for (let examType = 1; examType <= 3; examType++) {
        const sitting = state.sittings.find(
          (s) => s.grade === grade && s.semester === semester && s.exam_type === examType
        );
        const unlocked = sitting && sitting.subjectCount >= requiredSubjectCount;

        const badge = document.createElement('div');
        badge.className = 'badge ' + (unlocked ? 'is-unlocked' : 'is-locked');
        badge.title = `${GRADE_LABEL[grade]} ${SEMESTER_LABEL[semester]} ${EXAM_TYPE_LABEL[examType]}`;
        badge.innerHTML = '<span class="badge-icon"></span>';
        el.appendChild(badge);
      }
    }
  }
}

function renderSubjectTabs() {
  const el = document.getElementById('subjectTabs');
  el.innerHTML = '';
  state.subjects.forEach((subject) => {
    const btn = document.createElement('button');
    btn.className = 'student-tab' + (state.selectedSubject === subject.code ? ' is-active' : '');
    btn.textContent = subject.display_name;
    btn.addEventListener('click', () => {
      state.selectedSubject = subject.code;
      renderSubjectTabs();
      renderSubjectChart();
    });
    el.appendChild(btn);
  });
}

function renderSubjectChart() {
  const ctx = document.getElementById('subjectChart');
  const rows = state.examScores
    .filter((r) => r.subject === state.selectedSubject)
    .sort((a, b) => sittingOrder(a) - sittingOrder(b));
  const labels = rows.map((r) => `${GRADE_LABEL[r.grade]}${SEMESTER_LABEL[r.semester]}\n${EXAM_TYPE_LABEL[r.exam_type]}`);
  const data = rows.map((r) => r.score);

  if (state.subjectChart) state.subjectChart.destroy();
  state.subjectChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: subjectName(state.selectedSubject),
          data,
          borderColor: '#F3A489',
          backgroundColor: '#F3A489',
          borderWidth: 3,
          tension: 0.35,
          pointRadius: 5,
          pointBackgroundColor: '#FFFFFF',
          pointBorderColor: '#F3A489',
          pointBorderWidth: 2,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 100, ticks: { stepSize: 20 } }, x: { ticks: { font: { size: 10 } } } },
    },
  });
}

function renderSemesterCompare() {
  const el = document.getElementById('compareGrid');
  el.innerHTML = '';

  const groups = new Map();
  state.sittings.forEach((s) => {
    const key = `${s.grade}-${s.semester}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });

  if (groups.size === 0) {
    el.innerHTML = '<p class="form-hint">還沒有足夠的段考記錄可以比較。</p>';
    return;
  }

  Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([key, sittingsInGroup]) => {
      const [grade, semester] = key.split('-').map(Number);
      const cell = document.createElement('div');
      cell.className = 'compare-cell';
      const bars = sittingsInGroup
        .sort((a, b) => a.exam_type - b.exam_type)
        .map(
          (s) => `
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
            <span style="font-size:0.8rem;color:var(--ink-soft);width:64px;">${EXAM_TYPE_LABEL[s.exam_type]}</span>
            <div style="flex:1;background:#fff;border-radius:8px;overflow:hidden;height:10px;">
              <div style="width:${Math.min(s.average, 100)}%;background:var(--matcha);height:100%;"></div>
            </div>
            <span class="score-num" style="font-size:0.8rem;">${Math.round(s.average * 10) / 10}</span>
          </div>`
        )
        .join('');
      cell.innerHTML = `<strong>${GRADE_LABEL[grade]} ${SEMESTER_LABEL[semester]}</strong>${bars}`;
      el.appendChild(cell);
    });
}

function renderRankCard() {
  const card = document.getElementById('rankCard');
  const el = document.getElementById('rankDisplay');

  if (state.examRankings.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const latest = state.examRankings[state.examRankings.length - 1];
  const history = state.examRankings
    .slice(0, -1)
    .reverse()
    .map(
      (r) => `
      <tr>
        <td>${GRADE_LABEL[r.grade]} ${SEMESTER_LABEL[r.semester]} ${EXAM_TYPE_LABEL[r.exam_type]}</td>
        <td class="score-num">第 ${r.rank} 名 / ${r.total_students} 人</td>
      </tr>`
    )
    .join('');

  el.innerHTML = `
    <p style="color:var(--ink-soft);margin:0 0 4px;">${GRADE_LABEL[latest.grade]} ${SEMESTER_LABEL[latest.semester]} ${EXAM_TYPE_LABEL[latest.exam_type]}</p>
    <div class="rank-figure">第 ${latest.rank} 名 <span class="rank-total">/ ${latest.total_students} 人</span></div>
    ${history ? `<table style="margin-top:12px;">${history}</table>` : ''}
  `;
}

function examRowHtml(r) {
  const sitting = { grade: r.grade, semester: r.semester, exam_type: r.exam_type };
  const category = classifySubjectAt(state.examScores, r.subject, sitting) || 'insufficient_data';
  return `
    <tr>
      <td>${GRADE_LABEL[r.grade]} ${SEMESTER_LABEL[r.semester]}<br>${EXAM_TYPE_LABEL[r.exam_type]}</td>
      <td>${subjectName(r.subject)}</td>
      <td class="score-num">${r.score}</td>
      <td><span class="status-tag status-tag--${category}">${CATEGORY_LABEL[category]}</span></td>
    </tr>`;
}

// 預設只顯示「目前最新的那個學期」，更早的學期收合起來，避免手機上一次要滑一長串
function renderHistoryTable() {
  const recentBody = document.getElementById('historyTableRecent');
  const olderBody = document.getElementById('historyTableOlder');
  const showMoreBtn = document.getElementById('showMoreExamBtn');

  const rows = [...state.examScores].sort((a, b) => sittingOrder(b) - sittingOrder(a));

  if (rows.length === 0) {
    recentBody.innerHTML = '<tr><td colspan="4" class="form-hint">還沒有任何記錄</td></tr>';
    olderBody.innerHTML = '';
    olderBody.hidden = true;
    showMoreBtn.hidden = true;
    return;
  }

  const latestSitting = state.sittings[state.sittings.length - 1];
  const isRecent = (r) => r.grade === latestSitting.grade && r.semester === latestSitting.semester;

  const recentRows = rows.filter(isRecent);
  const olderRows = rows.filter((r) => !isRecent(r));

  recentBody.innerHTML = recentRows.map(examRowHtml).join('');
  olderBody.innerHTML = olderRows.map(examRowHtml).join('');
  olderBody.hidden = true;
  showMoreBtn.hidden = olderRows.length === 0;
  showMoreBtn.textContent = '顯示更早的歷史紀錄';
}

function quizRowHtml(a) {
  const date = new Date(a.taken_at).toLocaleDateString('zh-TW');
  return `
    <tr>
      <td>${date}</td>
      <td>${a.topic}</td>
      <td class="score-num">${a.score} / ${a.total}</td>
    </tr>`;
}

// 英文練習題沒有學期概念，改用「最近 N 筆」當預設顯示量，其餘收合
function renderQuizHistoryTable() {
  const recentBody = document.getElementById('quizHistoryRecent');
  const olderBody = document.getElementById('quizHistoryOlder');
  const showMoreBtn = document.getElementById('showMoreQuizBtn');

  if (state.quizAttempts.length === 0) {
    recentBody.innerHTML = '<tr><td colspan="3" class="form-hint">還沒有任何測驗記錄</td></tr>';
    olderBody.innerHTML = '';
    olderBody.hidden = true;
    showMoreBtn.hidden = true;
    return;
  }

  const recentRows = state.quizAttempts.slice(0, HISTORY_PAGE_SIZE);
  const olderRows = state.quizAttempts.slice(HISTORY_PAGE_SIZE);

  recentBody.innerHTML = recentRows.map(quizRowHtml).join('');
  olderBody.innerHTML = olderRows.map(quizRowHtml).join('');
  olderBody.hidden = true;
  showMoreBtn.hidden = olderRows.length === 0;
  showMoreBtn.textContent = '顯示更早的測驗記錄';
}

// 手機版分頁籤：切換 data-tab 對應區塊的顯示，桌面版由 CSS media query 整排隱藏籤列、
// 卡片一律顯示，這裡的邏輯不會影響桌面版
function applySectionFilter(target) {
  document.querySelectorAll('main .card[data-tab]').forEach((card) => {
    card.classList.toggle('tab-hidden', card.dataset.tab !== target);
  });
}

function initSectionTabs() {
  const tabs = document.querySelectorAll('#sectionTabs .section-tab');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      applySectionFilter(btn.dataset.section);
    });
  });

  // 頁面剛載入時，套用目前預設 is-active 那個分頁籤的篩選（HTML 預設是「首頁」）
  const initialTab = document.querySelector('#sectionTabs .section-tab.is-active') || tabs[0];
  if (initialTab) applySectionFilter(initialTab.dataset.section);
}

// 歷史紀錄卡片內的段考成績／英文練習題記錄切換，跟螢幕大小無關，桌面/手機都適用
function initHistorySubTabs() {
  const tabs = document.querySelectorAll('#historySubTabs .section-tab');
  const examPanel = document.getElementById('examHistoryPanel');
  const quizPanel = document.getElementById('quizHistoryPanel');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const showQuiz = btn.dataset.history === 'quiz';
      examPanel.hidden = showQuiz;
      quizPanel.hidden = !showQuiz;
    });
  });

  document.getElementById('showMoreExamBtn').addEventListener('click', (e) => {
    document.getElementById('historyTableOlder').hidden = false;
    e.target.hidden = true;
  });
  document.getElementById('showMoreQuizBtn').addEventListener('click', (e) => {
    document.getElementById('quizHistoryOlder').hidden = false;
    e.target.hidden = true;
  });
}

async function init() {
  state.students = await loadStudents();
  state.subjects = await loadSubjects();

  if (state.students.length === 0) {
    document.querySelector('main').innerHTML =
      '<p class="form-hint">還沒有學生資料，請先透過家長輸入頁面或 Supabase 後台新增。</p>';
    return;
  }

  renderStudentTabs();
  initSectionTabs();
  initHistorySubTabs();
  await selectStudent(state.students[0]);
}

document.addEventListener('DOMContentLoaded', init);
