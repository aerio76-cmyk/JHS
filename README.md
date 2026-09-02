# 成長記錄本（JHS）

國中學業成長記錄網頁工具。純前端（無框架）+ GitHub Pages + Chart.js + Supabase（資料庫／Auth）。

## 初次設定步驟

### 1. 建立資料庫

到 Supabase 專案的 SQL Editor，依序貼上執行：

1. `supabase/schema.sql`（建表 + RLS 政策）
2. `supabase/seed_data.sql`（5 科科目清單 + 鼓勵小語庫）

### 2. 手動塞入第一筆白名單資料（不要寫進版控）

`admins` 表的 RLS 只有 super_admin 能新增資料，所以第一筆一定要手動塞，之後才能在網站上用
「白名單管理」介面新增其他人。到 SQL Editor 執行（把 email 換成你的）：

```sql
insert into admins (email, role) values ('你的Email', 'super_admin');
```

同樣道理，兩個學生的資料也建議手動塞（`companion_type` 目前只吃 `fox` 或 `dragon`）：

```sql
insert into students (name, companion_type, enrolled_year) values
  ('Enisa', 'fox', 你的入學年度),
  ('Milo', 'dragon', 你的入學年度);
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

### 6.（選用）加入 jf-openhuninn 中文字型

目前中文字型會 fallback 到系統內建字型（Chiron Sans HK / 微軟正黑體），不影響使用。
如果想要規劃書指定的 jf open 粉圓手寫感，可以到
[justfont/open-huninn-font](https://github.com/justfont/open-huninn-font) 下載字型檔，
轉成 woff2 後放到 `assets/fonts/jf-openhuninn.woff2`，`css/style.css` 裡的 `@font-face`
已經接好路徑，放檔案進去就會自動生效。

## 專案結構

```
JHS/
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
├── assets/
│   ├── companions/       # Enisa（狐靈）/ Milo（幼龍）各 3 階段 SVG
│   └── badges/
└── supabase/
    ├── schema.sql
    └── seed_data.sql
```

## 權限模型

- 前台（`index.html`）完全公開瀏覽，不需要登入。
- 寫入成績/排名需登入 Google 帳號，且該 email 要在 `admins` 白名單內。
- 白名單管理（新增/移除其他人）只有 `role = 'super_admin'` 的帳號看得到，且無法刪除
  super_admin 自己那筆。
