# 成長記錄本（JHS）

國中學業成長記錄網頁工具：段考成績紀錄 + 成長分析，一律「跟自己比」。
純前端（無框架）+ GitHub Pages + Chart.js + Supabase（資料庫／Auth／Storage）。
規格見 `國中學業成長記錄網頁工具_規劃書_v2.1.md`。

## 初次設定步驟

### 1. 建立資料庫

到 Supabase 專案的 SQL Editor，依序貼上執行：

1. `supabase/schema.sql`（建表 + RLS 政策 + 頭像用的 `avatars` Storage bucket）
2. `supabase/seed_data.sql`（5 科科目清單 + 32 筆勵志小語）

`schema.sql` 只給全新專案用；要重建既有資料庫，見下方「資料庫重建」。

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

目前 Authentication 設定**關閉了「Allow new users to sign up」**：家長的 Google 帳號必須**已經存在於
Authentication → Users**，且 email 跟 `admins` 白名單一致，否則第一次登入會被拒絕。
之後要加第二位家長時，先暫時開啟註冊讓對方登入一次（或在 Users 頁手動建立），再關回來。

### 5. 開通 GitHub Pages

Repo Settings → Pages → Source 選 `main` 分支 / root，存檔後等幾分鐘即可透過
`https://aerio76-cmyk.github.io/JHS/` 瀏覽。

## 資料庫重建

v2.0 改版時（2026-10-19）資料庫是空的，所以直接刪除重建，沒有走遷移。之後若要重建：
把 `schema.sql`、`seed_data.sql` 和上面第 2 步的白名單／學生 insert 依序在 SQL Editor 執行即可
（本機的 `supabase/*.local.sql` 可放含 email 的合併版，已被 `.gitignore` 排除）。

## 安全強化 patch

`supabase/patches/2026-10-19_security_hardening.sql`（2026-10-19 安全稽核後新增），在 `schema.sql` 之後執行：

- 白名單判斷改用 **Google 登入身分的 email**（`auth.identities`），使用者自己改不了，不再信任可被修改的帳號 email。
- `admins` 只能新增／刪除一般管理員；`students.name` 限英文名；`avatar_url` 限本專案 avatars bucket。
- 檔內寫死本專案 ref（`cfalawxigobkpqjtcpzq`），換專案時要一併修改。
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
│   └── entry.js          # entry.html 用
├── assets/avatars/       # 內建手繪頭像（cat, bunny, bear, penguin）
├── tests/                # node --test 單元測試（stats / milestones）
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

計算與驗證邏輯（`js/stats.js`、`js/milestones.js`、`js/entryLogic.js`）是純函式，用 Node 內建測試執行，不需安裝任何套件：

```
npm test
```

（等同 `node --test "tests/**/*.test.js"`；Node 24 不接受只給資料夾 `tests/`。）

## 權限模型

- 前台（`index.html`）完全公開瀏覽，不需要登入；只顯示英文名與成績、校排名（v2.0 起加上頭像）。
- 寫入成績/排名/學生資料/頭像需登入 Google 帳號，且該 email 要在 `admins` 白名單內
  （資料表由 RLS、頭像由 Storage 政策把關）。
- 白名單管理（新增/移除其他人）只有 `role = 'super_admin'` 的帳號看得到，且無法刪除
  super_admin 自己那筆。
