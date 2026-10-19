-- 安全強化（Phase 4 security-auditor 建議，2026-10-19）
-- 執行方式：使用者在 Supabase Dashboard → SQL Editor 貼上整份執行。可重複執行；整份是一個 transaction，
-- 任何一步失敗（包括下面的安全檢查）都會全部還原，不會改到一半。
--
-- 內容：
--   1. 白名單判斷改用「Google 登入身分的 email」（auth.identities），而不是 JWT 裡的 email。
--      原因：Confirm email 關閉時，已登入的使用者可以自己改 email；改成白名單上的 email 就會被當成管理員。
--      Google 身分的 email 由 Google 提供，使用者自己改不了。
--   2. admins：只能新增／刪除一般 admin（super_admin 不能透過 API 被新增或刪除）；email 一律小寫。
--   3. students.name：資料庫層也限定英文名格式（避免繞過前端把真實姓名寫進公開頁）。
--   4. students.avatar_url：限定本專案（cfalawxigobkpqjtcpzq）avatars bucket 的 {學生 id}.webp／.jpg。

begin;

-- ---------- 0. 安全檢查：每個 super_admin 都必須已有對應的 Google 身分，否則改完會被鎖在門外 ----------
do $$
declare
  missing text;
begin
  select string_agg(a.email, ', ') into missing
  from public.admins a
  where a.role = 'super_admin'
    and not exists (
      select 1 from auth.identities i
      where i.provider = 'google' and lower(i.identity_data ->> 'email') = lower(a.email)
    );
  if missing is not null then
    raise exception '中止：這些 super_admin 沒有對應的 Google 登入身分（%）。請先用該 Google 帳號登入一次，再執行本檔。', missing;
  end if;
end $$;

-- ---------- 1. 權限函式改用 Google 身分 ----------
-- 目前登入者的 Google email。auth.identities 一般使用者讀不到，所以包成 security definer 函式
create or replace function public.my_google_email() returns text
language sql security definer stable set search_path = '' as $$
  select lower(i.identity_data ->> 'email') from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'google'
  limit 1;
$$;

create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.admins a
    join auth.identities i on i.user_id = auth.uid() and i.provider = 'google'
    where lower(i.identity_data ->> 'email') = a.email
  );
$$;

create or replace function public.is_super_admin() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.admins a
    join auth.identities i on i.user_id = auth.uid() and i.provider = 'google'
    where lower(i.identity_data ->> 'email') = a.email and a.role = 'super_admin'
  );
$$;

-- ---------- 2. admins ----------
update public.admins set email = lower(email) where email <> lower(email);
alter table public.admins drop constraint if exists admins_email_lower_check;
alter table public.admins add constraint admins_email_lower_check check (email = lower(email));

drop policy if exists "super admin insert admins" on public.admins;
create policy "super admin insert admins" on public.admins for insert
  with check (public.is_super_admin() and role = 'admin');

drop policy if exists "super admin delete admins" on public.admins;
create policy "super admin delete admins" on public.admins for delete
  using (public.is_super_admin() and role = 'admin');

-- 自己那筆的讀取改用 Google 身分比對（原本比對 JWT email）
drop policy if exists "read own admin row or super admin reads all" on public.admins;
create policy "read own admin row or super admin reads all" on public.admins for select using (
  email = public.my_google_email() or public.is_super_admin()
);

-- ---------- 3. students.name ----------
alter table public.students drop constraint if exists students_name_check;
alter table public.students add constraint students_name_check
  check (name ~ '^[A-Za-z][A-Za-z .''-]{0,19}$');

-- ---------- 4. students.avatar_url ----------
alter table public.students drop constraint if exists students_avatar_url_check;
alter table public.students add constraint students_avatar_url_check check (
  avatar_url is null or avatar_url ~ '^https://cfalawxigobkpqjtcpzq\.supabase\.co/storage/v1/object/public/avatars/[0-9a-f-]{36}\.(webp|jpg)(\?v=[0-9]+)?$'
);

commit;

-- ---------- 驗證：每位管理員的 has_google_identity 都應該是 true ----------
select a.email, a.role,
  exists (select 1 from auth.identities i where i.provider = 'google' and lower(i.identity_data ->> 'email') = a.email) as has_google_identity
from public.admins a order by a.role desc;
