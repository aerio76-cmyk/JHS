---
description: 分析本次專案/任務，決定需要啟用哪些協作角色
---

請分析目前的需求文件與程式碼庫，依照下列判斷邏輯決定本次任務需要啟用哪些角色，並列出清單與理由，再等待使用者確認：

- 一般功能開發，至少啟用：implementer、test-writer、reviewer、fixer、release-notes
- 若專案含有登入/權限/金流/使用者個資 → 額外啟用 security-auditor
- 若專案為資料比對/回填/自動化腳本 → 額外啟用 data-validator

輸出格式：
| 角色 | 是否啟用 | 理由 |
