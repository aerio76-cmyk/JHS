-- Phase 1 追加：英文練習題系統
-- 在 schema.sql / seed_data.sql 執行過的基礎上，另外執行這份。

create table if not exists quiz_questions (
  id bigint generated always as identity primary key,
  topic text not null,
  question_no int4 not null,
  type text not null check (type in ('mc', 'fill')),
  question_text text not null,
  choice_a text,
  choice_b text,
  choice_c text,
  choice_d text,
  correct_answer text not null,
  hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic, question_no)
);

create table if not exists quiz_attempts (
  id bigint generated always as identity primary key,
  student_id uuid not null references students(id) on delete cascade,
  topic text not null,
  score int4 not null,
  total int4 not null,
  taken_at timestamptz not null default now()
);

alter table quiz_questions enable row level security;
alter table quiz_attempts enable row level security;

-- quiz_questions：題目本體（含正解/提示）只有白名單admin能直接讀取/管理，
-- 一般使用者（含小孩作答）一律透過下面的security definer函式取用，
-- 避免瀏覽器開發者工具直接看到題庫API回應裡的正解。
create policy "admin read quiz_questions" on quiz_questions for select using (is_admin());
create policy "admin insert quiz_questions" on quiz_questions for insert with check (is_admin());
create policy "admin update quiz_questions" on quiz_questions for update using (is_admin()) with check (is_admin());
create policy "admin delete quiz_questions" on quiz_questions for delete using (is_admin());

-- quiz_attempts：小孩做練習題不需要登入（前台本來就公開瀏覽），
-- 所以刻意開放任何人都能寫入自己的測驗記錄，讀取也公開（成長頁面之後可能會顯示練習記錄）。
create policy "public read quiz_attempts" on quiz_attempts for select using (true);
create policy "public insert quiz_attempts" on quiz_attempts for insert with check (true);

-- 給小孩作答用：只回傳題目本體，不含正解/提示
create or replace function get_quiz_batch(topic_in text, count_in int default 20)
returns table (
  id bigint,
  type text,
  question_text text,
  choice_a text,
  choice_b text,
  choice_c text,
  choice_d text
)
language sql stable security definer as $$
  select id, type, question_text, choice_a, choice_b, choice_c, choice_d
  from quiz_questions
  where topic = topic_in
  order by random()
  limit count_in;
$$;

-- 列出目前有哪些單元可以測驗＋各單元題數，不外洩題目內容
create or replace function list_quiz_topics()
returns table (topic text, question_count bigint)
language sql stable security definer as $$
  select topic, count(*) as question_count
  from quiz_questions
  group by topic
  order by topic;
$$;

-- 評分：傳入 {question_id: 作答內容} 的 jsonb，回傳分數＋每題對錯與提示
create or replace function grade_quiz(answers jsonb)
returns jsonb
language plpgsql stable security definer as $$
declare
  qid_text text;
  given_text text;
  rec quiz_questions%rowtype;
  is_correct boolean;
  score_count int := 0;
  total_count int := 0;
  results jsonb := '[]'::jsonb;
begin
  for qid_text, given_text in select * from jsonb_each_text(answers) loop
    select * into rec from quiz_questions where id = qid_text::bigint;
    if found then
      total_count := total_count + 1;
      is_correct := (trim(lower(coalesce(given_text, ''))) = trim(lower(rec.correct_answer)));
      if is_correct then
        score_count := score_count + 1;
      end if;
      results := results || jsonb_build_object(
        'question_id', rec.id,
        'correct', is_correct,
        'correct_answer', rec.correct_answer,
        'hint', rec.hint
      );
    end if;
  end loop;

  return jsonb_build_object('score', score_count, 'total', total_count, 'results', results);
end;
$$;

grant execute on function get_quiz_batch(text, int) to anon, authenticated;
grant execute on function list_quiz_topics() to anon, authenticated;
grant execute on function grade_quiz(jsonb) to anon, authenticated;
