# JHS — 國中學業成長記錄網頁工具

兩位國中生（Enisa、Milo）的段考成績紀錄與成長分析網站：3 年 × 2 學期 × 3 次段考 = 18 個記錄點，
一律「跟自己比」。純靜態（HTML + 原生 JS + Chart.js），GitHub Pages 託管，資料在 Supabase
（Google 登入 + `admins` 白名單 + RLS；前台免登入唯讀）。

- **規格依據**：`國中學業成長記錄網頁工具_規劃書_v2.2.md`（v2.1、v2.0、v1.0 已移到 `docs/archive/`，僅為歷史紀錄，不再修改）。
- v2.0 方向：移除所有遊戲化／夥伴角色／徽章／英文題庫；改為里程碑（前端計算）、學年地圖、段考回顧、頭像。
- 護欄：不新增後端、不引入打包工具／框架、不新增資料表；公開頁只顯示英文名與成績（不得出現真實姓名、學校、班級）。
- `stats.js` 判定門檻不改；使用者文案不用「退步」「差」等負面詞。
- SQL 只撰寫，**由使用者在 Supabase SQL Editor 手動執行**，不要代為連線執行。2026-10-19 起資料庫已依 v2.0 `schema.sql` 重建（不需遷移）。
- `.github/workflows/supabase-keepalive.yml` 必須留在 `main`（排程只在預設分支執行），防止 Supabase 免費專案閒置被暫停。

## 與 Cowork 協作（AI 協作橋接規範 v2 重點）

- 兩邊**只寫自己的檔案**，永遠不編輯對方的交接檔。
- 交接檔放在專案根目錄，檔名 `YYYY-MM-DD_HHMM_作者.md`（作者 `cowork` / `claudecode`，24 小時制）；寫完不再編輯，要接續就開新檔，開頭註明回應哪一份。
- 收到 Cowork 交接檔時，不只信文件：用 `git status` / `git diff` 核對實際變更，並逐一查證其列出的疑點。
- 兩個 session 無直接通訊，由使用者轉達。
- **未經使用者明確同意，不 commit、不 push**。
- 交接檔超過 12 份或 Phase 收尾時，依 Cowork 的可封存清單以 `git mv` 搬入 `handoff/archive/`（只搬不改）。**舊交接檔已移至 `handoff/archive/`**，裡面「回應：某檔案」的引用維持原檔名，到 archive 找即可。
- repo 是公開的：文件不寫 Auth 開關現況、弱點細節、帳號／email；安全相關只寫「建議設定」。

## 協作角色

`.claude/agents/`（implementer、test-writer、reviewer、fixer、security-auditor、data-validator、release-notes）
與 `/kickoff` 指令；本輪編制見規劃書第九節。
