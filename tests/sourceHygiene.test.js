// 原始碼不得含有看不見的字元（零寬、行分隔符號、方向控制等）。
// 這類字元在複製貼上時會被改掉（2026-11-07 曾讓 SQL 的正規式在 SQL Editor 失效），也可能藏住惡意內容。
// 需要時一律寫成跳脫序列（反斜線加 u 與四位十六進位）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// tests/ 不檢查：既有測試刻意放了 BOM、零寬字元當測試資料
const DIRS = ['js', 'css', 'supabase', 'supabase/patches', '.'];
const EXT = /\.(js|css|html|sql)$/;

test('原始碼不含看不見的字元', () => {
  const files = [...new Set(DIRS.flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => EXT.test(f)).map((f) => path.join(d, f))))];
  assert.ok(files.length > 8);
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const hits = [...text].filter((c) => /[\p{Cf}\p{Zl}\p{Zp}]/u.test(c)).map((c) => c.codePointAt(0).toString(16));
    if (hits.length) bad.push(`${f}: ${[...new Set(hits)].join(',')}`);
  }
  assert.deepEqual(bad, []);
});
