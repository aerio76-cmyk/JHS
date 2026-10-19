-- 國中學業成長記錄網頁工具 — Supabase Schema
-- 只給「全新的 Supabase 專案」用：在 Dashboard -> SQL Editor 貼上整份執行一次即可。
-- 已有舊版資料庫的話不要跑這份，改跑 supabase/migrations/ 的遷移檔。
-- 不含任何真實姓名/Email，這些請依 README「初次設定」章節的說明另外手動執行。

create extension if not exists pgcrypto;

-- ========== 1. students：學生基本資料 ==========
-- name 即前台顯示的英文名；avatar_url 有值時優先於 avatar_preset（內建手繪頭像代號）
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  theme_color text,
  avatar_preset text,
  avatar_url text,
  enrolled_year int2 not null,
  created_at timestamptz not null default now(),
  -- 限制名稱與 migrations/2026-10-19_01_additive.sql 一致
  constraint students_theme_color_check check (theme_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint students_avatar_preset_check check (avatar_preset in ('cat', 'bunny', 'bear', 'penguin')),
  -- avatar_url 只接受本專案 avatars bucket 的公開網址（前台會當 <img src> 用）
  constraint students_avatar_url_check check (
    avatar_url is null or avatar_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/'
  )
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
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from admins where email = auth.jwt() ->> 'email'
  );
$$;

-- 判斷目前登入者是否為 super_admin
create or replace function is_super_admin() returns boolean
language sql security definer stable set search_path = public as $$
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

-- ========== Storage：學生頭像 ==========
-- public bucket：前台用公開網址讀圖，不經過 RLS。
-- ⚠ 前台只能用 getPublicUrl() 組網址；download()／createSignedUrl() 需要 select 權限，匿名會失敗。
-- select 政策只開給白名單（客戶端 upsert／remove 需要），避免任何人透過 API 列出 bucket 內檔名。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin read avatars" on storage.objects;
drop policy if exists "admin insert avatars" on storage.objects;
drop policy if exists "admin update avatars" on storage.objects;
drop policy if exists "admin delete avatars" on storage.objects;

create policy "admin read avatars" on storage.objects for select
  using (bucket_id = 'avatars' and public.is_admin());
create policy "admin insert avatars" on storage.objects for insert
  with check (bucket_id = 'avatars' and public.is_admin());
create policy "admin update avatars" on storage.objects for update
  using (bucket_id = 'avatars' and public.is_admin())
  with check (bucket_id = 'avatars' and public.is_admin());
create policy "admin delete avatars" on storage.objects for delete
  using (bucket_id = 'avatars' and public.is_admin());
