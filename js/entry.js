// entry.html 主要邏輯：登入狀態切換、成績表單、排名表單、白名單管理（僅 super_admin）

let subjectsCache = [];
let studentsCache = [];

function showPanel(name) {
  document.getElementById('loginGate').hidden = name !== 'loginGate';
  document.getElementById('noAccessPanel').hidden = name !== 'noAccessPanel';
  document.getElementById('entryPanel').hidden = name !== 'entryPanel';
}

function fillStudentSelect(selectEl) {
  selectEl.innerHTML = studentsCache
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join('');
}

function buildSubjectInputs() {
  const el = document.getElementById('subjectInputs');
  el.innerHTML = subjectsCache
    .map(
      (s) => `
      <label>${s.display_name}
        <input type="number" step="0.5" min="0" max="100" data-subject="${s.code}" class="subject-score-input" />
      </label>`
    )
    .join('');
}

async function handleScoreSubmit(e) {
  e.preventDefault();
  const msg = document.getElementById('scoreFormMsg');
  msg.textContent = '';

  const student_id = document.getElementById('scoreStudent').value;
  const grade = Number(document.getElementById('scoreGrade').value);
  const semester = Number(document.getElementById('scoreSemester').value);
  const exam_type = Number(document.getElementById('scoreExamType').value);
  const exam_date = document.getElementById('scoreExamDate').value || null;

  const inputs = document.querySelectorAll('.subject-score-input');
  const rows = [];
  inputs.forEach((input) => {
    if (input.value !== '') {
      rows.push({
        student_id,
        grade,
        semester,
        exam_type,
        subject: input.dataset.subject,
        score: Number(input.value),
        exam_date,
        updated_at: new Date().toISOString(),
      });
    }
  });

  if (rows.length === 0) {
    msg.innerHTML = '<p class="form-error">請至少輸入一科分數。</p>';
    return;
  }

  const { error } = await sbClient
    .from('exam_scores')
    .upsert(rows, { onConflict: 'student_id,grade,semester,exam_type,subject' });

  if (error) {
    console.error(error);
    msg.innerHTML = `<p class="form-error">儲存失敗：${error.message}</p>`;
    return;
  }

  msg.innerHTML = '<p class="form-success"><span class="stamp">記錄完成</span></p>';
  e.target.reset();
  buildSubjectInputs();
}

async function handleRankSubmit(e) {
  e.preventDefault();
  const msg = document.getElementById('rankFormMsg');
  msg.textContent = '';

  const row = {
    student_id: document.getElementById('rankStudent').value,
    grade: Number(document.getElementById('rankGrade').value),
    semester: Number(document.getElementById('rankSemester').value),
    exam_type: Number(document.getElementById('rankExamType').value),
    rank: Number(document.getElementById('rankValue').value),
    total_students: Number(document.getElementById('rankTotal').value),
    updated_at: new Date().toISOString(),
  };

  if (row.rank > row.total_students) {
    msg.innerHTML = '<p class="form-error">名次不能大於總人數。</p>';
    return;
  }

  const { error } = await sbClient
    .from('exam_rankings')
    .upsert(row, { onConflict: 'student_id,grade,semester,exam_type' });

  if (error) {
    console.error(error);
    msg.innerHTML = `<p class="form-error">儲存失敗：${error.message}</p>`;
    return;
  }

  msg.innerHTML = '<p class="form-success"><span class="stamp">記錄完成</span></p>';
  e.target.reset();
}

async function loadAdminList() {
  const { data, error } = await sbClient.from('admins').select('*').order('created_at');
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

async function renderAdminPanel(currentEmail) {
  const admins = await loadAdminList();
  const list = document.getElementById('adminList');
  list.innerHTML = admins
    .map((a) => {
      const canDelete = a.role !== 'super_admin';
      return `
        <li class="admin-list-item">
          <span>${a.email}${a.role === 'super_admin' ? '（主管理帳號）' : ''}</span>
          ${canDelete ? `<button class="btn-danger" data-email="${a.email}">移除</button>` : ''}
        </li>`;
    })
    .join('');

  list.querySelectorAll('button[data-email]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`確定要移除 ${btn.dataset.email} 的編輯權限嗎？`)) return;
      const { error } = await sbClient.from('admins').delete().eq('email', btn.dataset.email);
      if (error) {
        alert('移除失敗：' + error.message);
        return;
      }
      renderAdminPanel(currentEmail);
    });
  });
}

async function handleAddAdmin(e) {
  e.preventDefault();
  const msg = document.getElementById('addAdminMsg');
  const email = document.getElementById('newAdminEmail').value.trim();

  const { error } = await sbClient.from('admins').insert({ email, role: 'admin' });
  if (error) {
    msg.innerHTML = `<p class="form-error">新增失敗：${error.message}</p>`;
    return;
  }
  msg.innerHTML = '<p class="form-success">已新增。</p>';
  e.target.reset();
  renderAdminPanel();
}

async function init() {
  document.getElementById('googleLoginBtn').addEventListener('click', loginWithGoogle);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('logoutBtnNoAccess').addEventListener('click', logout);
  document.getElementById('scoreForm').addEventListener('submit', handleScoreSubmit);
  document.getElementById('rankForm').addEventListener('submit', handleRankSubmit);
  document.getElementById('addAdminForm').addEventListener('submit', handleAddAdmin);

  const status = await getCurrentAdminStatus();

  if (!status) {
    showPanel('loginGate');
    return;
  }
  if (status.role === 'none') {
    showPanel('noAccessPanel');
    return;
  }

  showPanel('entryPanel');
  document.getElementById('loggedInEmail').textContent = status.email;

  const studentsRes = await sbClient.from('students').select('*').order('enrolled_year');
  const subjectsRes = await sbClient.from('subjects').select('*').order('sort_order');
  studentsCache = studentsRes.data || [];
  subjectsCache = subjectsRes.data || [];

  fillStudentSelect(document.getElementById('scoreStudent'));
  fillStudentSelect(document.getElementById('rankStudent'));
  buildSubjectInputs();

  if (status.role === 'super_admin') {
    document.getElementById('adminPanel').hidden = false;
    renderAdminPanel(status.email);
  }
}

document.addEventListener('DOMContentLoaded', init);
