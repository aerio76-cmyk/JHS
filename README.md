# 成長記錄本（JHS）

國中學業成長記錄網頁工具：段考成績紀錄 + 成長分析，一律「跟自己比」。
純前端（無框架）+ GitHub Pages + Chart.js + Supabase（資料庫／Auth／Storage）。
規格見 `國中學業成長記錄網頁工具_規劃書_v2.0.md`。

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

### 5. 開通 GitHub Pages

Repo Settings → Pages → Source 選 `main` 分支 / root，存檔後等幾分鐘即可透過
`https://aerio76-cmyk.github.io/JHS/` 瀏覽。

## 資料庫重建

v2.0 改版時（2026-10-19）資料庫是空的，所以直接刪除重建，沒有走遷移。之後若要重建：
把 `schema.sql`、`seed_data.sql` 和上面第 2 步的白名單／學生 insert 依序在 SQL Editor 執行即可
（本機的 `supabase/*.local.sql` 可放含 email 的合併版，已被 `.gitignore` 排除）。

## Supabase 防暫停

免費方案連續 7 天沒有活動會被暫停。`.github/workflows/supabase-keepalive.yml` 每 3 天讀一次資料庫
（只在 `main` 分支執行）；失敗時 GitHub 會寄信通知，到 Supabase Dashboard 按 Restore 即可。

## 專案結構

```
JHS/                    # 省略規劃書、交接檔等協作文件
├── index.html          # 公開成長儀表板
├── entry.html          # 家長輸入頁（需登入）
├── css/style.css
├── js/
│   ├── config.js        # Supabase 連線設定
│   ├── supabaseClient.js
│   ├── stats.js          # 判定邏輯（進步中/穩定發揮/醞釀成長期/個人巔峰）
│   ├── dashboard.js      # index.html 用
│   ├── auth.js           # entry.html 共用登入邏輯
│   └── entry.js          # entry.html 用
├── mockups/              # v2.0 設計模擬圖（靜態、假資料）
└── supabase/
    ├── schema.sql        # 全新安裝用
    └── seed_data.sql
```

## 權限模型

- 前台（`index.html`）完全公開瀏覽，不需要登入；只顯示英文名與成績、校排名（v2.0 起加上頭像）。
- 寫入成績/排名/學生資料/頭像需登入 Google 帳號，且該 email 要在 `admins` 白名單內
  （資料表由 RLS、頭像由 Storage 政策把關）。
- 白名單管理（新增/移除其他人）只有 `role = 'super_admin'` 的帳號看得到，且無法刪除
  super_admin 自己那筆。
