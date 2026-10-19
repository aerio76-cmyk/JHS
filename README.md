# 成長記錄本（JHS）

國中學業成長記錄網頁工具：段考成績紀錄 + 成長分析，一律「跟自己比」。
純前端（無框架）+ GitHub Pages + Chart.js + Supabase（資料庫／Auth／Storage）。
規格見 `國中學業成長記錄網頁工具_規劃書_v2.0.md`。

## 初次設定步驟

### 1. 建立資料庫

到 Supabase 專案的 SQL Editor，依序貼上執行：

1. `supabase/schema.sql`（建表 + RLS 政策 + 頭像用的 `avatars` Storage bucket）
2. `supabase/seed_data.sql`（5 科科目清單 + 32 筆勵志小語）

已經有舊版資料庫的話，不要重跑 schema.sql，改跑 `supabase/migrations/` 裡的遷移檔（見下方「資料庫遷移」）。

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

## 資料庫遷移（v1 → v2.0）

v2.0 移除了英文練習題系統與成長夥伴角色，資料庫變更拆成兩支，**都由使用者在 SQL Editor 手動執行**，順序固定：

1. 匯出 `students`、`exam_scores`、`exam_rankings`、`motivational_quotes` 的 CSV 備份
2. 執行 `supabase/migrations/2026-10-19_01_additive.sql`（只新增欄位、頭像 bucket 與政策，舊版前台不受影響）。
   執行完最後的查詢會列出學生，確認 Enisa、Milo 都有 `theme_color` 與 `avatar_preset`；若是空的，代表名字沒對上，請手動 update
3. 部署 v2.0 前台，確認正常
4. 執行 `supabase/migrations/2026-10-19_02_destructive.sql`（刪除 `companion_type`、`companion_reaction_key`、英文練習題的表與函式；**無法復原**）

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
    ├── seed_data.sql
    └── migrations/       # 既有資料庫的升級腳本（手動執行）
```

## 權限模型

- 前台（`index.html`）完全公開瀏覽，不需要登入；只顯示英文名與成績、校排名（v2.0 起加上頭像）。
- 寫入成績/排名/學生資料/頭像需登入 Google 帳號，且該 email 要在 `admins` 白名單內
  （資料表由 RLS、頭像由 Storage 政策把關）。
- 白名單管理（新增/移除其他人）只有 `role = 'super_admin'` 的帳號看得到，且無法刪除
  super_admin 自己那筆。
