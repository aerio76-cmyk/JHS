-- 國中學業成長記錄網頁工具 — Supabase Schema
-- 在 Supabase Dashboard -> SQL Editor 貼上整份執行一次即可。
-- 不含任何真實姓名/Email，這些請依 README「初次設定」章節的說明另外手動執行。

create extension if not exists pgcrypto;

-- ========== 1. students：學生基本資料 ==========
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  companion_type text not null check (companion_type in ('fox', 'dragon')),
  avatar_url text,
  enrolled_year int2 not null,
  created_at timestamptz not null default now()
);

-- ========== 2. subjects：科目對照表（固定 5 科） ==========
create table if not exists subjects (
  code text primary key,
  display_name text not null,
  sort_order int2 not null
);

-- ========== 3. exam_scores：逐科段考成績 ==========
create table if not exists exam_scores (
  id bigint generated always as identity primary key,
  student_id uuid not null references students(id) on delete cascade,
  grade int2 not null check (grade in (1, 2, 3)),
  semester int2 not null check (semester in (1, 2)),
  exam_type int2 not null check (exam_type in (1, 2, 3)),
  subject text not null references subjects(code),
  score numeric not null check (score >= 0 and score <= 100),
  exam_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, grade, semester, exam_type, subject)
);

-- ========== 4. exam_rankings：該次段考總分/平均校排名 ==========
create table if not exists exam_rankings (
  id bigint generated always as identity primary key,
  student_id uuid not null references students(id) on delete cascade,
  grade int2 not null check (grade in (1, 2, 3)),
  semester int2 not null check (semester in (1, 2)),
  exam_type int2 not null check (exam_type in (1, 2, 3)),
  rank int4 not null check (rank > 0),
  total_students int4 not null check (total_students > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, grade, semester, exam_type),
  check (rank <= total_students)
);

-- ========== 5. motivational_quotes：鼓勵小語庫 ==========
create table if not exists motivational_quotes (
  id bigint generated always as identity primary key,
  category text not null check (category in ('progress', 'stable', 'fluctuation', 'peak')),
  content text not null,
  source text,
  companion_reaction_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ========== 6. admins：白名單（含 super_admin 分層） ==========
create table if not exists admins (
  email text primary key,
  role text not null check (role in ('super_admin', 'admin')),
  created_at timestamptz not null default now()
);

-- ========== RLS ==========
alter table students enable row level security;
alter table subjects enable row level security;
alter table exam_scores enable row level security;
alter table exam_rankings enable row level security;
alter table motivational_quotes enable row level security;
alter table admins enable row level security;

-- 判斷目前登入者是否為白名單內的任何身分（admin 或 super_admin）
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from admins where email = auth.jwt() ->> 'email'
  );
$$;

-- 判斷目前登入者是否為 super_admin
create or replace function is_super_admin() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from admins where email = auth.jwt() ->> 'email' and role = 'super_admin'
  );
$$;

-- students：公開讀，白名單可寫
create policy "public read students" on students for select using (true);
create policy "admin insert students" on students for insert with check (is_admin());
create policy "admin update students" on students for update using (is_admin()) with check (is_admin());
create policy "admin delete students" on students for delete using (is_admin());

-- subjects：公開讀，固定參照資料，僅 super_admin 可異動
create policy "public read subjects" on subjects for select using (true);
create policy "super admin insert subjects" on subjects for insert with check (is_super_admin());
create policy "super admin update subjects" on subjects for update using (is_super_admin()) with check (is_super_admin());
create policy "super admin delete subjects" on subjects for delete using (is_super_admin());

-- exam_scores：公開讀，白名單可寫
create policy "public read exam_scores" on exam_scores for select using (true);
create policy "admin insert exam_scores" on exam_scores for insert with check (is_admin());
create policy "admin update exam_scores" on exam_scores for update using (is_admin()) with check (is_admin());
create policy "admin delete exam_scores" on exam_scores for delete using (is_admin());

-- exam_rankings：公開讀（顯示在成長儀表板上），白名單可寫
create policy "public read exam_rankings" on exam_rankings for select using (true);
create policy "admin insert exam_rankings" on exam_rankings for insert with check (is_admin());
create policy "admin update exam_rankings" on exam_rankings for update using (is_admin()) with check (is_admin());
create policy "admin delete exam_rankings" on exam_rankings for delete using (is_admin());

-- motivational_quotes：公開讀，白名單可寫
create policy "public read quotes" on motivational_quotes for select using (true);
create policy "admin insert quotes" on motivational_quotes for insert with check (is_admin());
create policy "admin update quotes" on motivational_quotes for update using (is_admin()) with check (is_admin());
create policy "admin delete quotes" on motivational_quotes for delete using (is_admin());

-- admins：本人可讀自己那筆（用來判斷自己是否為白名單成員/角色），
-- super_admin 額外可讀取全部（管理頁面用），且不能刪除自己那筆 super_admin 紀錄
create policy "read own admin row or super admin reads all" on admins for select using (
  email = (auth.jwt() ->> 'email') or is_super_admin()
);
create policy "super admin insert admins" on admins for insert with check (is_super_admin());
create policy "super admin delete admins" on admins for delete using (
  is_super_admin() and email <> (auth.jwt() ->> 'email')
);
