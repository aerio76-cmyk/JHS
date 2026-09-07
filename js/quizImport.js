// entry.html 用：把 Excel/CSV 題庫範本解析成結構化資料，upsert 進 quiz_questions。
// 範本欄位（表頭文字需完全一致）：題號／題型／題目／選項A／選項B／選項C／選項D／正解／提示解析
// 題型欄位填 mc（選擇題）或 fill（填空題），fill 題型可以不填選項。

function parseQuizRows(rows, topic) {
  return rows
    .map((row, idx) => {
      const type = String(row['題型'] || 'mc').trim().toLowerCase() === 'fill' ? 'fill' : 'mc';
      return {
        topic,
        question_no: Number(row['題號']) || idx + 1,
        type,
        question_text: String(row['題目'] || '').trim(),
        choice_a: String(row['選項A'] || '').trim() || null,
        choice_b: String(row['選項B'] || '').trim() || null,
        choice_c: String(row['選項C'] || '').trim() || null,
        choice_d: String(row['選項D'] || '').trim() || null,
        correct_answer: String(row['正解'] || '').trim(),
        hint: String(row['提示解析'] || '').trim() || null,
        updated_at: new Date().toISOString(),
      };
    })
    .filter((q) => q.question_text && q.correct_answer);
}

async function handleQuizImport(e) {
  e.preventDefault();
  const msg = document.getElementById('quizImportMsg');
  msg.textContent = '';

  const topic = document.getElementById('quizTopicInput').value.trim();
  const file = document.getElementById('quizFileInput').files[0];
  if (!file) return;

  let questions;
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    questions = parseQuizRows(rows, topic);
  } catch (err) {
    msg.innerHTML = `<p class="form-error">讀取檔案失敗：${err.message}</p>`;
    return;
  }

  if (questions.length === 0) {
    msg.innerHTML = '<p class="form-error">沒有讀到有效的題目，請檢查欄位名稱是否跟範本一致。</p>';
    return;
  }

  const { error } = await sbClient
    .from('quiz_questions')
    .upsert(questions, { onConflict: 'topic,question_no' });

  if (error) {
    msg.innerHTML = `<p class="form-error">匯入失敗：${error.message}</p>`;
    return;
  }

  msg.innerHTML = `<p class="form-success"><span class="stamp">匯入完成</span> 共 ${questions.length} 題到「${topic}」單元。</p>`;
  e.target.reset();
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('quizImportForm');
  if (form) form.addEventListener('submit', handleQuizImport);
});
