-- 學習資料庫（規劃書 v2.5 第九節）：觀看帳號、資料夾、圖片、私有 bucket 與權限
-- 執行方式：使用者在 Supabase Dashboard → SQL Editor 貼上整份執行。
--   ⚠ 先在「測試用」專案執行並完成檢查，之後才在正式專案執行。執行前先確認畫面左上角的專案名稱。
-- 前提：已執行 schema.sql 與 supabase/patches/2026-10-19_security_hardening.sql（下面會檢查，沒有就中止）。
-- ⚠ 本檔會重新定義 is_admin()／is_super_admin()／my_google_email()（加上「觀看帳號一律不是管理員」）。
--   之後若重跑 2026-10-19_security_hardening.sql，必須接著再跑一次本檔，否則這道保護會消失。
-- 可重複執行：表與欄位 if not exists；約束與索引一律先刪再建（改了條件重跑會生效）；函式 create or replace；
-- 政策與 trigger 先刪再建；授權先全部收回再重給；bucket 設定會被改回本檔的值。
-- 種子只在該分類「第一次建立」時才建立預設子資料夾（家長刪掉的預設子資料夾，重跑也不會長回來）。
-- 若之後有新 patch 調整這兩張表的授權或 bucket 設定，就不要再重跑本檔（會被改回）。
-- 整份是一個 transaction，任何一步失敗都會全部還原。
--
-- 權限摘要
--   讀取：管理員看全部；觀看帳號只看「沒有標為已學會」的圖片與其檔案，看不到沒有對應資料的檔案。
--   寫入：只有管理員；六個頂層分類（is_system）連管理員也不能改名或刪除。
--   viewers 名單：網站完全讀寫不到，只能在 SQL Editor 維護。
--   觀看帳號：一律不是管理員；只要多了 Email 以外的登入身分（例如被連上 Google），觀看權限自動失效。
--   匿名：讀寫不到任何學習資料。

begin;

-- ---------- 0. 前置檢查 ----------
do $materials_guard$
begin
  if to_regclass('public.admins') is null or to_regprocedure('public.is_admin()') is null then
    raise exception '中止：找不到 JHS 的資料表或權限函式。請先執行 schema.sql。';
  end if;
  -- 觀看帳號不能升權的前提：is_admin／is_super_admin 只認 Google 身分（安全強化 patch 的版本）
  if pg_get_functiondef('public.is_admin()'::regprocedure) not like '%auth.identities%'
     or pg_get_functiondef('public.is_super_admin()'::regprocedure) not like '%auth.identities%' then
    raise exception '中止：權限函式還是舊版。請先執行 supabase/patches/2026-10-19_security_hardening.sql，再執行本檔。';
  end if;
end $materials_guard$;

-- ---------- 1. viewers：觀看帳號名單（用 auth.uid 比對，不用 email） ----------
create table if not exists public.viewers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  label text not null default '觀看帳號',
  created_at timestamptz not null default now()
);
alter table public.viewers drop constraint if exists viewers_label_check;
alter table public.viewers add constraint viewers_label_check check (char_length(label) between 1 and 40);
alter table public.viewers enable row level security;
-- 不建任何政策、也不給權限：網站（anon／authenticated）完全讀寫不到，只能在 SQL Editor 維護
revoke all on public.viewers from anon, authenticated;

-- 觀看帳號：在名單裡，而且只有 Email 登入身分。
-- 被連上 Google 等其他身分時自動失效（孩子端會讀不到，等於出事的警訊），不會讓同 email 的 Google 登入取得觀看權。
create or replace function public.is_viewer() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.viewers v where v.user_id = auth.uid())
     and not exists (select 1 from auth.identities i where i.user_id = auth.uid() and i.provider <> 'email');
$$;

-- 管理員判斷加上「不在觀看名單」：就算觀看帳號日後被連上白名單內的 Google 身分，也不會變成管理員
create or replace function public.my_google_email() returns text
language sql security definer stable set search_path = '' as $$
  select lower(i.identity_data ->> 'email') from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'google'
    and not exists (select 1 from public.viewers v where v.user_id = auth.uid())
  limit 1;
$$;

create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = '' as $$
  select not exists (select 1 from public.viewers v where v.user_id = auth.uid())
     and exists (
       select 1
       from public.admins a
       join auth.identities i on i.user_id = auth.uid() and i.provider = 'google'
       where lower(i.identity_data ->> 'email') = a.email
     );
$$;

create or replace function public.is_super_admin() returns boolean
language sql security definer stable set search_path = '' as $$
  select not exists (select 1 from public.viewers v where v.user_id = auth.uid())
     and exists (
       select 1
       from public.admins a
       join auth.identities i on i.user_id = auth.uid() and i.provider = 'google'
       where lower(i.identity_data ->> 'email') = a.email and a.role = 'super_admin'
     );
$$;

-- 觀看帳號只能是「只有 Email 登入身分」的帳號，且 email 不能和任何管理員相同（預防設定錯誤）
create or replace function public.viewers_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  user_email text;
begin
  if exists (select 1 from auth.identities i where i.user_id = new.user_id and i.provider <> 'email') then
    raise exception '中止：這個帳號有 Email 以外的登入身分（例如 Google），不能當觀看帳號。請在後台另外建立只用 Email 登入的帳號。';
  end if;
  select lower(u.email) into user_email from auth.users u where u.id = new.user_id;
  if user_email is not null and exists (select 1 from public.admins a where a.email = user_email) then
    raise exception '中止：觀看帳號的 email 不能和管理員相同，請改用其他 email 建立觀看帳號。';
  end if;
  return new;
end;
$$;
drop trigger if exists viewers_guard on public.viewers;
create trigger viewers_guard before insert or update on public.viewers
  for each row execute function public.viewers_guard();

-- ---------- 2. material_folders：資料夾（頂層六類固定，總深度 ≤ 3） ----------
create table if not exists public.material_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.material_folders (id) on delete cascade,
  name text not null,
  sort int4 not null default 0,
  is_system boolean not null default false,
  system_key text unique, -- 頂層分類的代號（前端用來對應圖示）；自訂資料夾為 null
  created_at timestamptz not null default now()
);
-- 名稱：1–20 字；前後不能有空白（含全形空白）；不能有控制字元或零寬等看不見的字元（避免「看起來重名」）
alter table public.material_folders drop constraint if exists material_folders_name_check;
alter table public.material_folders add constraint material_folders_name_check check (
  char_length(name) between 1 and 20
  and name = btrim(name, ' ' || chr(12288))
  and name !~ '[[:cntrl:]\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]'
);
alter table public.material_folders drop constraint if exists material_folders_system_key_check;
alter table public.material_folders add constraint material_folders_system_key_check check (
  system_key in ('chinese', 'english', 'math', 'science', 'social', 'other')
);
-- 頂層一定是固定分類，固定分類一定在頂層，也一定有代號
alter table public.material_folders drop constraint if exists material_folders_top_check;
alter table public.material_folders add constraint material_folders_top_check check ((parent_id is null) = is_system);
alter table public.material_folders drop constraint if exists material_folders_system_key_top_check;
alter table public.material_folders add constraint material_folders_system_key_top_check check ((system_key is not null) = is_system);
-- 同一層不重名（頂層 parent_id 是 null，一般 unique 擋不到，另外建部分索引）
drop index if exists public.material_folders_sibling_name_key;
create unique index material_folders_sibling_name_key on public.material_folders (parent_id, name) where parent_id is not null;
drop index if exists public.material_folders_top_name_key;
create unique index material_folders_top_name_key on public.material_folders (name) where parent_id is null;
create index if not exists material_folders_parent_idx on public.material_folders (parent_id);

-- 新增時檢查深度（頂層＝1，最多到 3）。不用 security definer：只用呼叫者看得到的資料夾計算，
-- 非管理員一律只會收到 RLS 錯誤，無法拿來探測資料夾在第幾層。
create or replace function public.material_folders_depth_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  depth int := 1;
  p uuid := new.parent_id;
begin
  while p is not null loop
    depth := depth + 1;
    if depth > 3 then
      raise exception '資料夾最多三層（分類／子資料夾／子資料夾），不能再往下新增。';
    end if;
    select f.parent_id into p from public.material_folders f where f.id = p;
  end loop;
  return new;
end;
$$;
drop trigger if exists material_folders_depth_guard on public.material_folders;
create trigger material_folders_depth_guard before insert on public.material_folders
  for each row execute function public.material_folders_depth_guard();

-- 建立後不能換上層、不能改固定分類的身分（沒有移動資料夾功能，所以也不可能形成環）
create or replace function public.material_folders_immutable_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.parent_id is distinct from old.parent_id then
    raise exception '資料夾建立後不能移動到其他上層。';
  end if;
  if new.is_system is distinct from old.is_system or new.system_key is distinct from old.system_key then
    raise exception '不能變更固定分類。';
  end if;
  return new;
end;
$$;
drop trigger if exists material_folders_immutable_guard on public.material_folders;
create trigger material_folders_immutable_guard before update on public.material_folders
  for each row execute function public.material_folders_immutable_guard();

alter table public.material_folders enable row level security;
-- 欄位權限：網站只能設定上層、名稱、排序；is_system／system_key／id 只能由本檔的種子設定。
-- （supabase-js 請用 insert／update，不要用 upsert；payload 不要帶未授權的欄位）
revoke all on public.material_folders from anon, authenticated;
grant select, delete on public.material_folders to authenticated;
grant insert (parent_id, name, sort) on public.material_folders to authenticated;
grant update (name, sort) on public.material_folders to authenticated;

drop policy if exists "viewer or admin read material_folders" on public.material_folders;
create policy "viewer or admin read material_folders" on public.material_folders for select
  using ((select public.is_viewer()) or (select public.is_admin()));
drop policy if exists "admin insert material_folders" on public.material_folders;
create policy "admin insert material_folders" on public.material_folders for insert
  with check ((select public.is_admin()) and is_system = false);
drop policy if exists "admin update material_folders" on public.material_folders;
create policy "admin update material_folders" on public.material_folders for update
  using ((select public.is_admin()) and not is_system)
  with check ((select public.is_admin()) and not is_system);
drop policy if exists "admin delete material_folders" on public.material_folders;
create policy "admin delete material_folders" on public.material_folders for delete
  using ((select public.is_admin()) and not is_system);

-- ---------- 3. materials：圖片 ----------
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.material_folders (id) on delete cascade,
  title text not null,
  grade_tag int2,
  storage_path text not null,
  thumb_path text not null,
  is_learned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.materials drop constraint if exists materials_title_check;
alter table public.materials add constraint materials_title_check check (
  char_length(title) between 1 and 60
  and title = btrim(title, ' ' || chr(12288))
  and title !~ '[[:cntrl:]\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]'
);
alter table public.materials drop constraint if exists materials_grade_tag_check;
alter table public.materials add constraint materials_grade_tag_check check (grade_tag in (1, 2, 3));
-- 檔名只能是 {uuid}.webp|jpg 與 {同一個 uuid}_t.webp|jpg（副檔名依實際編碼格式）
alter table public.materials drop constraint if exists materials_storage_path_check;
alter table public.materials add constraint materials_storage_path_check check (
  storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
);
alter table public.materials drop constraint if exists materials_thumb_path_check;
alter table public.materials add constraint materials_thumb_path_check check (
  thumb_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_t\.(webp|jpg)$'
  and left(thumb_path, 36) = left(storage_path, 36)
);
drop index if exists public.materials_storage_path_key;
create unique index materials_storage_path_key on public.materials (storage_path);
drop index if exists public.materials_thumb_path_key;
create unique index materials_thumb_path_key on public.materials (thumb_path);
create index if not exists materials_folder_idx on public.materials (folder_id);
create index if not exists materials_created_idx on public.materials (created_at desc);

create or replace function public.materials_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists materials_touch_updated_at on public.materials;
create trigger materials_touch_updated_at before update on public.materials
  for each row execute function public.materials_touch_updated_at();

alter table public.materials enable row level security;
revoke all on public.materials from anon, authenticated;
grant select, delete on public.materials to authenticated;
grant insert (id, folder_id, title, grade_tag, storage_path, thumb_path, is_learned) on public.materials to authenticated;
grant update (folder_id, title, grade_tag, storage_path, thumb_path, is_learned) on public.materials to authenticated;

-- 觀看帳號看不到「已學會」的圖片（在資料庫層擋，不只是畫面隱藏）。
-- 管理員看得到全部：孩子端頁面若由管理員登入瀏覽，查詢仍要自己加 is_learned = false。
drop policy if exists "viewer or admin read materials" on public.materials;
create policy "viewer or admin read materials" on public.materials for select
  using ((select public.is_admin()) or ((select public.is_viewer()) and not is_learned));
drop policy if exists "admin insert materials" on public.materials;
create policy "admin insert materials" on public.materials for insert with check ((select public.is_admin()));
drop policy if exists "admin update materials" on public.materials;
create policy "admin update materials" on public.materials for update
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "admin delete materials" on public.materials;
create policy "admin delete materials" on public.materials for delete using ((select public.is_admin()));

-- ---------- 4. 種子：六個固定分類＋自然／社會的預設子資料夾 ----------
do $materials_seed$
declare
  r record;
  new_id uuid;
begin
  for r in
    select * from (values
      ('chinese', '國文', 1, null::text[]),
      ('english', '英文', 2, null),
      ('math', '數學', 3, null),
      ('science', '自然', 4, array['理化', '生物', '地球科學']),
      ('social', '社會', 5, array['歷史', '地理', '公民']),
      ('other', '其他', 6, null)
    ) as t (key, name, sort, subs)
  loop
    if not exists (select 1 from public.material_folders where system_key = r.key) then
      insert into public.material_folders (parent_id, name, sort, is_system, system_key)
      values (null, r.name, r.sort, true, r.key)
      returning id into new_id;
      if r.subs is not null then
        insert into public.material_folders (parent_id, name, sort)
        select new_id, s.name, s.ord::int4 from unnest(r.subs) with ordinality as s (name, ord);
      end if;
    end if;
  end loop;
end $materials_seed$;

-- ---------- 5. Storage：私有 bucket materials ----------
-- 不公開：只能用 createSignedUrl(s) 取得短效網址（需要下面的 select 權限）。
-- 沒有 update 政策：換圖一律上傳新檔名，不覆蓋既有檔案（upsert、move 都會被擋）。
-- MIME 只收 jpeg／webp：前端一律重新編碼成這兩種格式。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 觀看帳號能不能讀某個檔案：要有對應的資料列且沒標為已學會。
-- 用 security definer 函式包起來：政策裡不直接引用 public.materials，
-- 匿名或其他 bucket（例如 avatars）的請求才不會因為沒有 materials 的權限而出錯。
create or replace function public.can_view_material_file(obj_name text) returns boolean
language sql security definer stable set search_path = '' as $$
  select public.is_viewer()
     and exists (
       select 1 from public.materials m
       where (m.storage_path = obj_name or m.thumb_path = obj_name) and not m.is_learned
     );
$$;

drop policy if exists "admin read materials files" on storage.objects;
drop policy if exists "viewer read materials files" on storage.objects;
drop policy if exists "admin insert materials files" on storage.objects;
drop policy if exists "admin delete materials files" on storage.objects;

create policy "admin read materials files" on storage.objects for select
  using (bucket_id = 'materials' and (select public.is_admin()));
create policy "viewer read materials files" on storage.objects for select
  using (bucket_id = 'materials' and public.can_view_material_file(name));
create policy "admin insert materials files" on storage.objects for insert
  with check (
    bucket_id = 'materials' and (select public.is_admin())
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.(webp|jpg)$'
  );
create policy "admin delete materials files" on storage.objects for delete
  using (bucket_id = 'materials' and (select public.is_admin()));

-- trigger 專用函式不開放直接呼叫（政策會用到的 is_viewer／can_view_material_file 維持預設，匿名評估政策時也需要）
revoke execute on function public.viewers_guard() from public, anon, authenticated;
revoke execute on function public.material_folders_depth_guard() from public, anon, authenticated;
revoke execute on function public.material_folders_immutable_guard() from public, anon, authenticated;
revoke execute on function public.materials_touch_updated_at() from public, anon, authenticated;

commit;

-- ---------- 驗證：應看到 12 個資料夾（6 個固定分類＋6 個預設子資料夾，家長之後新增的也會列出） ----------
select f.name as folder, p.name as parent, f.is_system
from public.material_folders f left join public.material_folders p on p.id = f.parent_id
order by coalesce(p.sort, f.sort), f.parent_id nulls first, f.sort, f.name;
