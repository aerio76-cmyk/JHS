// quiz.html 主要邏輯：選單元 → 隨機抽題 → 作答 → 評分（透過 RPC，正解/提示不會提前送到瀏覽器）

let currentStudentId = null;
let currentTopic = null;
let currentQuestions = [];

function showPanel(id) {
  ['setupPanel', 'quizPanel', 'resultPanel'].forEach((p) => {
    document.getElementById(p).hidden = p !== id;
  });
}

async function loadSetupOptions() {
  const studentsRes = await sbClient.from('students').select('*').order('enrolled_year');
  const studentSelect = document.getElementById('quizStudent');
  studentSelect.innerHTML = (studentsRes.data || [])
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join('');

  const topicsRes = await sbClient.rpc('list_quiz_topics');
  const topicSelect = document.getElementById('quizTopic');
  const topics = topicsRes.data || [];
  if (topics.length === 0) {
    topicSelect.innerHTML = '<option value="">目前還沒有題庫</option>';
    document.querySelector('#setupForm button[type=submit]').disabled = true;
    return;
  }
  topicSelect.innerHTML = topics
    .map((t) => `<option value="${t.topic}">${t.topic}（${t.question_count} 題）</option>`)
    .join('');
}

function renderQuizForm() {
  const form = document.getElementById('quizForm');
  form.innerHTML = currentQuestions
    .map((q, idx) => {
      const choices = [
        ['A', q.choice_a],
        ['B', q.choice_b],
        ['C', q.choice_c],
        ['D', q.choice_d],
      ].filter(([, text]) => text);

      const inputHtml =
        q.type === 'mc'
          ? choices
              .map(
                ([key, text]) => `
              <label class="quiz-choice">
                <input type="radio" name="q_${q.id}" value="${key}" required />
                ${key}. ${text}
              </label>`
              )
              .join('')
          : `<input type="text" name="q_${q.id}" placeholder="請輸入答案" required />`;

      return `
        <div class="quiz-question">
          <strong>${idx + 1}. ${q.question_text}</strong>
          ${inputHtml}
        </div>`;
    })
    .join('');

  document.getElementById('quizProgress').textContent = `共 ${currentQuestions.length} 題`;
}

async function handleSetupSubmit(e) {
  e.preventDefault();
  currentStudentId = document.getElementById('quizStudent').value;
  currentTopic = document.getElementById('quizTopic').value;

  const { data, error } = await sbClient.rpc('get_quiz_batch', {
    topic_in: currentTopic,
    count_in: 20,
  });

  if (error || !data || data.length === 0) {
    document.getElementById('setupMsg').innerHTML = '<p class="form-error">題庫讀取失敗，請稍後再試。</p>';
    return;
  }

  currentQuestions = data;
  renderQuizForm();
  showPanel('quizPanel');
}

async function handleQuizSubmit(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const answers = {};
  currentQuestions.forEach((q) => {
    answers[q.id] = formData.get(`q_${q.id}`) || '';
  });

  const { data, error } = await sbClient.rpc('grade_quiz', { answers });
  if (error) {
    alert('評分失敗：' + error.message);
    return;
  }

  await sbClient.from('quiz_attempts').insert({
    student_id: currentStudentId,
    topic: currentTopic,
    score: data.score,
    total: data.total,
  });

  renderResult(data);
  showPanel('resultPanel');
}

function renderResult(result) {
  document.getElementById('resultScore').textContent = `${result.score} / ${result.total}`;

  const byId = new Map(result.results.map((r) => [String(r.question_id), r]));
  document.getElementById('resultReview').innerHTML = currentQuestions
    .map((q, idx) => {
      const r = byId.get(String(q.id));
      if (!r) return '';
      const tagClass = r.correct ? 'status-tag--progress' : 'status-tag--fluctuation';
      const tagText = r.correct ? '答對' : '答錯';
      const hintHtml =
        !r.correct && r.hint
          ? `<div class="quiz-hint">正解：${r.correct_answer}<br>${r.hint}</div>`
          : '';
      return `
        <div class="quiz-question">
          <strong>${idx + 1}. ${q.question_text}</strong>
          <span class="status-tag ${tagClass}">${tagText}</span>
          ${hintHtml}
        </div>`;
    })
    .join('');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSetupOptions();
  document.getElementById('setupForm').addEventListener('submit', handleSetupSubmit);
  document.getElementById('quizForm').addEventListener('submit', handleQuizSubmit);
  document.getElementById('retryBtn').addEventListener('click', () => {
    showPanel('setupPanel');
  });
});
