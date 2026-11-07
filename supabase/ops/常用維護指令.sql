-- =====================================================================
-- JHS 常用維護指令（學習資料庫的觀看帳號、管理員、檢查）
-- =====================================================================
-- 使用方式：
--   1. 在 Supabase Dashboard → SQL Editor，**只複製需要的那一段**貼上執行，不要整份一起執行。
--   2. 執行前先確認畫面左上角的專案名稱是正確的專案。
--   3. 會修改資料的指令（標示【會修改】）執行前，建議先到家長端「資料備份」下載一份完整備份。
--   4. 把 '換成…' 的地方換成實際的值。**不要把真實的 email 或密碼存回這個檔案**（repo 是公開的）。
--   5. 【唯讀】的指令只查詢，不會改到任何東西，可以放心執行。
--
-- 目錄
--   A. 觀看帳號（孩子用的帳號）
--     A1【唯讀】查看觀看帳號目前的狀態
--     A2【唯讀】列出所有帳號，以及誰在觀看名單裡
--     A3【會修改】把帳號加入觀看名單
--     A4【會修改】把帳號移出觀看名單（平板遺失、密碼外流時立即撤銷）
--     A5【會修改】直接修改觀看帳號的 email（不需要確認信）
--     A6【會修改】重設觀看帳號的密碼
--   B. 管理員（家長，Google 登入）
--     B1【唯讀】確認每位管理員都有 Google 登入身分
--   C. 檢查
--     C1【唯讀】學習資料的數量與用量
--     C2【唯讀】圖片空間（bucket）的設定
--     C3【唯讀】Storage 的權限規則都有限定圖片空間
--     C4【唯讀】管理員判斷是不是最新版（重跑安全 patch 之後要確認）
-- =====================================================================


-- ---------------------------------------------------------------------
-- A1【唯讀】查看觀看帳號目前的狀態
-- 用途：孩子端登不進去、或顯示「不能看學習資料」時，先看這裡。
-- 看結果：
--   ・查不到任何一列 → 觀看名單是空的（例如帳號被刪掉重建），用 A3 加回去。
--   ・「待確認的新email」有值 → 改 email 還在等確認信（收不到信的地址永遠不會生效），用 A5 直接改。
--   ・「登入方式」不是只有 email → 帳號被連上了其他身分（例如 Google），觀看權限會自動失效；
--     建議刪掉這個帳號，重新建立一個只用 email 登入的帳號，再用 A3 加入。
-- ---------------------------------------------------------------------
select u.email                as 目前email,
       u.email_change         as 待確認的新email,
       u.email_confirmed_at is not null as email已確認,
       u.last_sign_in_at      as 最後登入時間,
       u.updated_at           as 最後修改時間,
       (select string_agg(i.provider, ',') from auth.identities i where i.user_id = u.id) as 登入方式
from auth.users u
where u.id in (select user_id from public.viewers);


-- ---------------------------------------------------------------------
-- A2【唯讀】列出所有帳號，以及誰在觀看名單裡
-- 用途：找不到觀看帳號、或想確認有沒有多出來的帳號時使用。
--   「登入方式」是 google 的是家長；是 email 的才可能是觀看帳號。
-- ---------------------------------------------------------------------
select u.email,
       u.created_at as 建立時間,
       (select string_agg(i.provider, ',') from auth.identities i where i.user_id = u.id) as 登入方式,
       exists (select 1 from public.viewers v where v.user_id = u.id) as 在觀看名單
from auth.users u
order by u.created_at desc;


-- ---------------------------------------------------------------------
-- A3【會修改】把帳號加入觀看名單
-- 用途：新建觀看帳號之後，或帳號被刪掉重建之後（重建的帳號不會自動回到名單）。
-- 先做：在 Authentication → Users → Add user 建立帳號（勾選自動確認）。
-- 出現錯誤時：
--   ・「有 Email 以外的登入身分」→ 這個帳號連著 Google，不能當觀看帳號，請換一個 email 重建。
--   ・「不能和管理員相同」→ email 跟某位管理員一樣，請換一個 email。
-- 最後一行應該顯示名單人數（通常是 1）。
-- ---------------------------------------------------------------------
insert into public.viewers (user_id, label)
select id, '平板' from auth.users where email = '換成觀看帳號的email'
on conflict (user_id) do nothing;

select count(*) as 名單人數 from public.viewers;


-- ---------------------------------------------------------------------
-- A4【會修改】把帳號移出觀看名單（立即撤銷）
-- 用途：平板遺失、密碼外流。移除後，下一次請求起就看不到任何學習資料。
-- 之後：再到 Authentication → Users 刪除或重設這個帳號。要恢復時用 A3 加回來。
-- ---------------------------------------------------------------------
delete from public.viewers
where user_id = (select id from auth.users where email = '換成觀看帳號的email');

select count(*) as 名單人數 from public.viewers;


-- ---------------------------------------------------------------------
-- A5【會修改】直接修改觀看帳號的 email（不需要確認信）
-- 用途：在後台改 email 後一直沒生效（新地址收不到確認信），或想改成收不到信的地址（例如 xxx@test.invalid）。
-- 只會改到「在觀看名單裡、而且目前 email 是舊 email」的那一個帳號。觀看名單不用跟著改。
-- 最後的查詢應該只有一列，email 是新的、待確認的新email 是空的。
-- ---------------------------------------------------------------------
begin;

update auth.users
set email = '換成新的email',
    email_change = '',
    email_change_token_new = '',
    email_change_token_current = '',
    email_change_confirm_status = 0,
    email_confirmed_at = coalesce(email_confirmed_at, now())
where email = '換成舊的email'
  and id in (select user_id from public.viewers);

update auth.identities
set identity_data = jsonb_set(identity_data, '{email}', to_jsonb('換成新的email'::text))
where provider = 'email'
  and user_id in (select id from auth.users where email = '換成新的email')
  and user_id in (select user_id from public.viewers);

commit;

select u.email, u.email_change as 待確認的新email
from auth.users u where u.id in (select user_id from public.viewers);


-- ---------------------------------------------------------------------
-- A6【會修改】重設觀看帳號的密碼
-- 用途：忘記密碼、密碼外流、孩子自己改了密碼。（觀看帳號的 email 收不到信，不能用「忘記密碼」）
-- 只會改到「在觀看名單裡、而且 email 符合」的那一個帳號。
-- 注意：SQL Editor 會保留執行紀錄，密碼會留在你自己的後台裡；介意的話執行後到歷史紀錄刪除這一筆。
-- 改完後，每台平板都要用新密碼重新登入。
-- ---------------------------------------------------------------------
update auth.users
set encrypted_password = extensions.crypt('換成新的密碼', extensions.gen_salt('bf'))
where email = '換成觀看帳號的email'
  and id in (select user_id from public.viewers);


-- ---------------------------------------------------------------------
-- B1【唯讀】確認每位管理員都有 Google 登入身分
-- 用途：新增管理員之後，或家長登入後看到「沒有編輯權限」時。
--   「有google登入」是 false → 對方還沒用 Google 登入過，或帳號是在後台用 email 建立的。
--   處理方式：刪掉那個 email 帳號 → 暫時開放註冊 → 請對方在家長端用 Google 登入一次 → 立刻關閉註冊
--   （詳見規劃書第四節「新增第二位管理員」）。
-- ---------------------------------------------------------------------
select a.email, a.role,
       exists (select 1 from auth.identities i
               where i.provider = 'google' and lower(i.identity_data ->> 'email') = a.email) as 有google登入
from public.admins a
order by a.role desc, a.email;


-- ---------------------------------------------------------------------
-- C1【唯讀】學習資料的數量與用量
-- 用途：想知道總共有幾張、多少已學會、檔案佔多少空間（免費額度 1 GB）。
-- ---------------------------------------------------------------------
select
  (select count(*) from public.material_folders)                    as 資料夾數,
  (select count(*) from public.materials)                           as 圖片數,
  (select count(*) from public.materials where is_learned)          as 已學會,
  (select count(*) from storage.objects where bucket_id = 'materials') as 檔案數,
  (select pg_size_pretty(coalesce(sum((metadata ->> 'size')::bigint), 0))
     from storage.objects where bucket_id = 'materials')            as 檔案總大小;


-- ---------------------------------------------------------------------
-- C2【唯讀】圖片空間（bucket）的設定
-- 應該是：public = false、file_size_limit = 2097152（2 MB）、allowed_mime_types = {image/jpeg,image/webp}
-- 不一樣的話，重跑 supabase/patches/2026-11-07_materials.sql 會改回來。
-- ---------------------------------------------------------------------
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'materials';


-- ---------------------------------------------------------------------
-- C3【唯讀】Storage 的權限規則都有限定圖片空間
-- 用途：確認沒有「沒限定 bucket」的寬鬆規則（例如從 Dashboard 範本建立的）。
-- 看結果：每一列的「條件」或「新增條件」裡都應該有 bucket_id = '...'。
-- ---------------------------------------------------------------------
select policyname as 規則名稱, cmd as 動作, qual as 條件, with_check as 新增條件
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;


-- ---------------------------------------------------------------------
-- C4【唯讀】管理員判斷是不是最新版
-- 用途：重跑 supabase/patches/2026-10-19_security_hardening.sql 之後一定要確認。
-- 三個都應該是 true；有 false 就再執行一次 supabase/patches/2026-11-07_materials.sql。
--   ・認google身分：只有 Google 登入的家長才算管理員
--   ・排除觀看帳號：觀看帳號一律不是管理員
-- ---------------------------------------------------------------------
select
  pg_get_functiondef('public.is_admin()'::regprocedure) like '%auth.identities%'       as 認google身分,
  pg_get_functiondef('public.is_admin()'::regprocedure) like '%public.viewers%'        as 排除觀看帳號,
  pg_get_functiondef('public.is_super_admin()'::regprocedure) like '%public.viewers%'  as super也排除觀看帳號;
