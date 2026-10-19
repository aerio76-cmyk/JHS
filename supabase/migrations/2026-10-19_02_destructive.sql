-- v2.0 遷移 02：刪除舊欄位與英文練習題系統（無法復原）
-- ⚠ 執行前提：
--   1. 已跑過 01_additive.sql
--   2. v2.0 新前台已部署上線並確認正常（舊版前台讀 companion_type 會壞）
--   3. 已把 students、exam_scores、exam_rankings、motivational_quotes 匯出 CSV 備份
--      （英文練習題資料若要留存，也一併匯出 quiz_questions、quiz_attempts）
-- 執行方式：使用者在 Supabase Dashboard → SQL Editor 貼上整份執行。可重複執行。
-- 整份包在 transaction 裡：任何一句失敗就全部不生效，不會停在刪一半的狀態。

begin;

-- ---------- 英文練習題：先 drop 函式，再 drop 表（表上的 RLS 政策會一併刪除） ----------
drop function if exists public.get_quiz_batch(text, int);
drop function if exists public.list_quiz_topics();
drop function if exists public.grade_quiz(jsonb);

drop table if exists public.quiz_attempts;
drop table if exists public.quiz_questions;

-- ---------- 移除成長夥伴相關欄位（欄位上的 check 限制會一併刪除） ----------
alter table students drop column if exists companion_type;
alter table motivational_quotes drop column if exists companion_reaction_key;

commit;

-- ---------- 驗證：下面兩個查詢都應該回傳 0 筆 ----------
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and column_name in ('companion_type', 'companion_reaction_key');

select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('get_quiz_batch', 'list_quiz_topics', 'grade_quiz');
