# 成長記錄本（JHS）

國中學業成長記錄網頁工具：段考成績紀錄 + 成長分析，一律「跟自己比」。
純前端（無框架）+ GitHub Pages + Chart.js + Supabase（資料庫／Auth／Storage）。
規格見 `國中學業成長記錄網頁工具_規劃書_v2.3.md`（舊版規劃書在 `docs/archive/`）。

## 初次設定步驟

### 1. 建立資料庫

到 Supabase 專案的 SQL Editor，依序貼上執行：

1. `supabase/schema.sql`（建表 + RLS 政策 + 頭像用的 `avatars` Storage bucket）
2. `supabase/seed_data.sql`（5 科科目清單 + 32 筆勵志小語）

**`schema.sql` 只能用在全新專案**；既有專案只執行 `supabase/patches/` 內的檔案。`schema.sql` 開頭有保護：資料庫裡已經有 JHS 的資料表時會自動中止、什麼都不改。要重建既有資料庫，見下方「資料庫重建」。

### 2. 手動塞入第一筆白名單資料（不要寫進版控）

`admins` 表的 RLS 只有 super_admin 能新增資料，所以第一筆一定要手動塞，之後才能在網站上用
「白名單管理」介面新增其他人。到 SQL Editor 執行（把 email 換成你的）：

```sql
insert into admins (email, role) values ('你的Email', 'super_admin');
```

同樣道理，兩個學生的資料也建議手動塞。`name` 是前台顯示的英文名（不要填真實姓名），
`theme_color` 是 `#RRGGBB` 主題色，`avatar_preset` 是內建頭像代號：

```sql
insert into students (name, theme_color, avatar_preset, enrolled_year) values
  ('Enisa', '#F28B6D', 'cat', 你的入學年度),
  ('Milo', '#3FA796', 'bear', 你的入學年度);
```

這兩段指令都**不要**存成檔案進 git，執行完就可以關掉分頁忘記它。

### 3. 填入 Supabase 連線資訊

打開 `js/config.js`，把 `SUPABASE_URL` 跟 `SUPABASE_ANON_KEY` 換成你 Supabase 專案
Settings → API 頁面看到的值。這組 anon key 設計上就是公開的，可以放心 commit 進 git，
安全性由 RLS 把關。

### 4. 設定 Google OAuth 登入

Supabase Dashboard → Authentication → Providers → Google，照官方引導設定 Google Cloud
OAuth Client ID/Secret。**Redirect URL** 記得設定成你的 GitHub Pages 網址（例如
`https://aerio76-cmyk.github.io/JHS/entry.html`），不然登入後會跳轉失敗。

建議設定：**平時關閉「Allow new users to sign up」**，只讓既有帳號登入。這時家長的 Google 帳號必須
已經存在於 Authentication → Users，且 email 跟 `admins` 白名單一致，否則第一次登入會被拒絕。

新增家長時：
1. 在家長端「白名單」加入對方 email。
2. Google Cloud → OAuth「目標對象」→ 測試使用者加入對方（測試狀態最多 100 位）。
3. Supabase 暫時開啟註冊 → 請對方用 Google 登入一次 → 確認 Users 出現對方 → 立刻關閉。

### 5. 開通 GitHub Pages

Repo Settings → Pages → Source 選 `main` 分支 / root，存檔後等幾分鐘即可透過
`https://aerio76-cmyk.github.io/JHS/` 瀏覽。

## 資料庫重建

v2.0 改版時（2026-10-19）資料庫是空的，所以直接刪除重建，沒有走遷移。之後若要重建：
必須先清空舊的 JHS 資料表（`schema.sql` 偵測到既有資料表會中止），再依序執行 `schema.sql`、`seed_data.sql`、
上面第 2 步的白名單／學生 insert，最後執行 `supabase/patches/` 內的檔案。
清空與重建的合併版放在本機的 `supabase/*.local.sql`（含 email，已被 `.gitignore` 排除）。
本機 rebuild 檔**不含** `supabase/patches/`，跑完 rebuild 後要另外執行 patches。
**重建會刪除所有成績，執行前請先下載完整備份。**

在 SQL Editor 執行任何檔案被中止後，如果接下來的查詢出現 `current transaction is aborted`，先單獨執行一次 `rollback;` 再繼續。

## 備份與還原

Supabase 免費方案沒有自動備份，請用家長端「資料備份」自己下載：

- **什麼時候**：每次輸入完一批成績後下載一次，至少每學期一次。
- **下載什麼**：「完整備份（JSON）」用來還原；「成績（CSV）」「校排名（CSV）」可以用 Excel 直接開啟（已含 BOM，中文不會亂碼）。
- **存在哪裡**：除了這台電腦，再存一份到雲端硬碟或隨身碟。檔案內有學生英文名與成績，請當成私人資料保管。
- **不在備份裡的**：頭像照片與頭像網址（還原到原本的資料庫時頭像維持原狀；還原到新資料庫時顯示預設頭像）、白名單、勵志小語（在 `seed_data.sql`）。
- 下載時請不要同時在其他裝置輸入成績，避免備份抓到一半的資料。

還原步驟：

1. 家長端「資料備份」→「選擇備份檔並產生 SQL」，選 JSON 備份檔，下載產生的 `.sql`。網站不會直接改資料庫。
2. 到 Supabase Dashboard → SQL Editor 貼上整份內容後執行。整份是一個 transaction，失敗會全部還原。
3. 最後的查詢會列出學生、成績、排名筆數，應該跟備份一致。

還原會**新增或覆蓋**同一位學生（以學生 id 比對）、同一次段考的資料，**不會刪除**備份裡沒有的資料。
如果資料庫裡已有**同名但 id 不同**的學生（例如重建資料庫時重新建立了學生），還原會自動中止並說明原因，
請先刪除那位學生（他的成績會一起刪除）或改在空的資料庫還原。

只用自己從家長端下載的備份檔，不要用別人傳來的檔案；網站產生 SQL 前會檢查檔案內容，不合格就拒絕。
建議先在測試用的 Supabase 專案試跑，再用在正式資料庫。

**試跑前請先確認目前開啟的是測試專案**：測試專案的名稱不要跟正式專案相同。後台左上角的 `main PRODUCTION`
標籤是每個專案預設分支的名稱，每個專案都會顯示，**不能用來分辨正式或測試**；請看專案名稱。

## 安全強化 patch

`supabase/patches/2026-10-19_security_hardening.sql`（2026-10-19 安全稽核後新增），在 `schema.sql` 之後執行：

- 白名單判斷改用 **Google 登入身分的 email**（`auth.identities`），使用者自己改不了，不再信任可被修改的帳號 email。
- `admins` 只能新增／刪除一般管理員；`students.name` 限英文名；`avatar_url` 限本專案 avatars bucket。
- 檔內寫死本專案的 project ref（頭像網址檢查用），換專案時要一併修改。
- **執行前提**：每個 super_admin 都要先用 Google 登入過一次；否則 patch 會自動中止（避免把自己鎖在門外）。
- 新專案的順序：`schema.sql` → `seed_data.sql` → 用 Google 登入一次 → 手動 insert 白名單 → 這份 patch。

Authentication 設定建議：**Confirm email、Secure email change 保持開啟**；Redirect URLs 只放精確網址（不要用 `*`）。

## Supabase 防暫停

免費方案連續 7 天沒有活動會被暫停。`.github/workflows/supabase-keepalive.yml` 每 3 天讀一次資料庫
（只在 `main` 分支執行）；失敗時 GitHub 會寄信通知，到 Supabase Dashboard 按 Restore 即可。

## 專案結構

```
JHS/                    # 省略規劃書、交接檔等協作文件
├── index.html          # 公開成長儀表板
├── entry.html          # 家長輸入頁（需登入）
├── css/style.css         # v2.0 設計 token + 版面（前台與家長端共用）
├── js/
│   ├── config.js        # Supabase 連線設定
│   ├── supabaseClient.js
│   ├── stats.js          # 判定邏輯（進步中/穩定發揮/醞釀成長期/個人巔峰）
│   ├── milestones.js     # 里程碑、學年地圖分級、排名變化等純函式
│   ├── dashboard.js      # index.html 用
│   ├── auth.js           # entry.html 共用登入邏輯
│   ├── entryLogic.js     # 家長端純函式：表單驗證、頭像檔案驗證與裁切
│   ├── backupLogic.js    # 資料備份純函式：分頁讀取、CSV、JSON、還原 SQL
│   └── entry.js          # entry.html 用
├── assets/avatars/       # 內建手繪頭像（cat, bunny, bear, penguin）
├── assets/icon.svg       # 網站圖示（另有 icon-32.png、apple-touch-icon.png）
├── tests/                # node --test 單元測試
├── handoff/archive/      # 已封存的協作交接檔
├── docs/archive/         # 舊版規劃書（v1.0、v2.0、v2.1）
└── supabase/
    ├── schema.sql        # 全新安裝用
    └── seed_data.sql
```

## 設計模擬圖

Phase 0 的靜態模擬圖（假資料）不放在上線的網站裡，保存在 git tag `phase0-mockups`：

```
git checkout phase0-mockups -- mockups/   # 取回到工作目錄（看完可刪除，不要 commit）
```

## 測試

計算與驗證邏輯（`js/stats.js`、`js/milestones.js`、`js/entryLogic.js`、`js/backupLogic.js`）是純函式，用 Node 內建測試執行，不需安裝任何套件：

```
npm test
```

（等同 `node --test "tests/**/*.test.js"`；Node 24 不接受只給資料夾 `tests/`。）

## 搜尋引擎

`index.html`、`entry.html` 都有 `<meta name="robots" content="noindex, nofollow">`，請搜尋引擎不要收錄。

- 這**不是存取控制**：知道網址的人仍然看得到前台，資料的保護靠 RLS。
- 已經被收錄的頁面要過一段時間才會從搜尋結果消失。
- GitHub Pages 的專案站（`/JHS/`）無法放網域根目錄的 `robots.txt`，所以不另外建立。

## 權限模型

- 前台（`index.html`）完全公開瀏覽，不需要登入；只顯示英文名與成績、校排名（v2.0 起加上頭像）。
- 寫入成績/排名/學生資料/頭像需登入 Google 帳號，且該 email 要在 `admins` 白名單內
  （資料表由 RLS、頭像由 Storage 政策把關）。
- 白名單管理（新增/移除其他人）只有 `role = 'super_admin'` 的帳號看得到，且無法刪除
  super_admin 自己那筆。
