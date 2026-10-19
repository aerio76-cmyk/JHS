-- v2.0 遷移 01：只新增、不刪除（舊版前台照常運作，可以先跑）
-- 執行方式：使用者在 Supabase Dashboard → SQL Editor 貼上整份執行。可重複執行。
-- 順序：先跑本檔 → 部署 v2.0 前台 → 確認正常 → 再跑 02_destructive.sql

begin;

-- ---------- students：主題色與預設頭像 ----------
-- 欄位與限制分開加：欄位若已存在（例如曾手動加過），add column if not exists 會整句略過，
-- 限制就補不上；所以限制一律先 drop 再 add，確保重跑後結果和 schema.sql 一致。
alter table students add column if not exists theme_color text;
alter table students add column if not exists avatar_preset text;

-- 格式限制同時防止把任意字串塞進前台的 CSS／圖片路徑
alter table students drop constraint if exists students_theme_color_check;
alter table students add constraint students_theme_color_check
  check (theme_color ~ '^#[0-9A-Fa-f]{6}$');
alter table students drop constraint if exists students_avatar_preset_check;
alter table students add constraint students_avatar_preset_check
  check (avatar_preset in ('cat', 'bunny', 'bear', 'penguin'));

-- avatar_url 只接受本專案 avatars bucket 的公開網址（前台會當 <img src> 用）。
-- not valid：不檢查既有資料（避免舊資料讓整份遷移失敗），只約束之後的寫入。
alter table students drop constraint if exists students_avatar_url_check;
alter table students add constraint students_avatar_url_check
  check (avatar_url is null or avatar_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/')
  not valid;

-- 過渡期（跑完 01、還沒跑 02）companion_type 仍是 not null；放寬它，新增學生才不會失敗
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'companion_type') then
    alter table students alter column companion_type drop not null;
  end if;
end $$;

-- 現有兩位學生的預設值（只填空值，不覆蓋已設定的）
update students set theme_color = '#F28B6D' where name = 'Enisa' and theme_color is null;
update students set avatar_preset = 'cat' where name = 'Enisa' and avatar_preset is null;
update students set theme_color = '#3FA796' where name = 'Milo' and theme_color is null;
update students set avatar_preset = 'bear' where name = 'Milo' and avatar_preset is null;

-- ---------- 權限函式：固定 search_path（security definer 的建議寫法） ----------
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from admins where email = auth.jwt() ->> 'email'
  );
$$;

create or replace function public.is_super_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from admins where email = auth.jwt() ->> 'email' and role = 'super_admin'
  );
$$;

-- ---------- Storage：avatars bucket ----------
-- public bucket：前台用公開網址讀圖，不經過 RLS。
-- ⚠ 前台只能用 getPublicUrl() 組網址；download()／createSignedUrl() 需要 select 權限，匿名會失敗。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- PostgreSQL 的 create policy 沒有 if not exists，先 drop 才能重複執行。
-- select 只開給白名單（客戶端 upsert／remove 需要），避免任何人透過 API 列出 bucket 內所有檔名。
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

commit;

-- ---------- 驗證：兩位學生都應該有主題色與頭像代號（若是 null，代表名字沒對上，請手動 update） ----------
select name, theme_color, avatar_preset, avatar_url from students order by enrolled_year;
