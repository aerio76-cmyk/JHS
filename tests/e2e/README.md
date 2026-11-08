# 端對端測試（Edge + Playwright，假 Supabase）

在本機用 Edge 實際操作 `index.html`、`entry.html`（家長端）與 `materials.html`（孩子端），**不連任何真實服務**：

- `fakeSupabase.js`：記憶體裡的假 supabase-js（資料表、Storage、帳號密碼登入、觀看帳號與管理員身分、故意失敗的開關）。
- 測試時攔截 CDN 的 supabase-js 換成假的；因為雜湊值不同，只在攔截到的 HTML 回應裡拿掉 `integrity`（實際檔案不動）。
- 功能測試略過 CSP（Playwright 的等待需要 eval）；另有一組**不略過 CSP** 的檢查，確認正式 CSP 下沒有違規。
- 圖片在瀏覽器裡用 canvas 產生，repo 不放任何真實教材圖片。

## 執行

Python Playwright 裝在 `~/.claude/mcp-envs/playwright`（不是主要的 Python）：

```
~/.claude/mcp-envs/playwright/Scripts/python.exe tests/e2e/admin_e2e.py
~/.claude/mcp-envs/playwright/Scripts/python.exe tests/e2e/viewer_e2e.py
~/.claude/mcp-envs/playwright/Scripts/python.exe tests/e2e/nav_e2e.py
```

- `admin_e2e.py`：家長端「學習資料」（上傳、補償、資料夾、清理、頭像）。
- `viewer_e2e.py`：孩子端 `materials.html`（登入、瀏覽、搜尋、放大檢視、session、安全）。
- `nav_e2e.py`：三個站之間的導覽與返回（每個畫面都有出口、管理員互通、段考回顧依來源返回）。

Windows 主控台若出現編碼錯誤，先設定 `PYTHONIOENCODING=utf-8`。截圖存到 `tests/e2e/screenshots/`（不進版控）。
最後一行會印出「通過 N／M」；任何 ✗ 都要先查清楚再合併。
