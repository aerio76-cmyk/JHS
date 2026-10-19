// entryLogic.js 邊界測試：只確保邊界情況「不會炸」並鎖住規格行為，不重新定義商業邏輯。
// 疑似問題以 test.todo 標記，不在此修正。
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/entryLogic.js');
const {
  THEME_SWATCHES, AVATAR_PRESET_OPTIONS, AVATAR_MAX_SOURCE_BYTES,
  isAllowedThemeColor, isAllowedAvatarPreset, validateStudentName, parseScoreInput, buildScoreChanges,
  validateRanking, validateEmail, validateAvatarFile, squareCropRect, avatarObjectPath, avatarObjectPaths, versionedAvatarUrl,
} = L;

const MB10 = 10 * 1024 * 1024;

// ---------- 色票 / 預設頭像 ----------

test('THEME_SWATCHES：6 色、hex 格式正確且不重複', () => {
  assert.equal(THEME_SWATCHES.length, 6);
  for (const s of THEME_SWATCHES) assert.match(s.hex, /^#[0-9A-F]{6}$/i);
  assert.equal(new Set(THEME_SWATCHES.map((s) => s.hex.toLowerCase())).size, 6);
});

test('isAllowedThemeColor：色票內 6 色大小寫皆接受', () => {
  for (const s of THEME_SWATCHES) {
    assert.equal(isAllowedThemeColor(s.hex), true);
    assert.equal(isAllowedThemeColor(s.hex.toLowerCase()), true);
    assert.equal(isAllowedThemeColor(s.hex.toUpperCase()), true);
  }
});

test('isAllowedThemeColor：色票外、格式變形、怪值一律 false 且不丟例外', () => {
  const bad = ['#000000', '#FFFFFF', 'F28B6D', '#F28B6', '#F28B6D ', ' #F28B6D', '#F28B6D00', 'red',
    '', null, undefined, 0, NaN, {}, [], 'javascript:alert(1)', '<script>alert(1)</script>', '#Ｆ28B6D'];
  for (const v of bad) assert.equal(isAllowedThemeColor(v), false, `應拒絕 ${String(v)}`);
});

test('isAllowedThemeColor：陣列 ["#F28B6D"] 經 String() 會被接受（鎖住現行行為）', () => {
  // String(['#F28B6D']) === '#F28B6D'；呼叫端只會傳字串，記錄即可
  assert.equal(isAllowedThemeColor(['#F28B6D']), true);
});

test('AVATAR_PRESET_OPTIONS / isAllowedAvatarPreset：只接受 cat/bunny/bear/penguin', () => {
  assert.deepEqual(AVATAR_PRESET_OPTIONS.map((p) => p.id), ['cat', 'bunny', 'bear', 'penguin']);
  for (const id of ['cat', 'bunny', 'bear', 'penguin']) assert.equal(isAllowedAvatarPreset(id), true);
  for (const id of ['Cat', 'CAT', ' cat', 'cat ', 'dog', '', null, undefined, 0, {}, '<script>', '__proto__', 'constructor']) {
    assert.equal(isAllowedAvatarPreset(id), false, `應拒絕 ${String(id)}`);
  }
});

// ---------- validateStudentName ----------

test('validateStudentName：一般英文名與允許符號', () => {
  for (const n of ['Amy', 'A', "O'Brien", 'Mary-Jane', 'Jr. Smith', 'Ann Lee', 'a']) {
    const r = validateStudentName(n);
    assert.equal(r.ok, true, n);
    assert.equal(r.value, n);
  }
});

test('validateStudentName：前後空白會 trim，trim 後回傳', () => {
  assert.deepEqual(validateStudentName('   Amy  '), { ok: true, value: 'Amy' });
  assert.deepEqual(validateStudentName('\t\nAmy\r\n'), { ok: true, value: 'Amy' });
});

test('validateStudentName：空值、只有空白（含全形空白）都拒絕', () => {
  for (const v of ['', '   ', '\t\n', '　　', null, undefined]) {
    const r = validateStudentName(v);
    assert.equal(r.ok, false, JSON.stringify(v));
    assert.equal(typeof r.error, 'string');
  }
});

test('validateStudentName：長度邊界 20 接受、21 拒絕；trim 前超長但 trim 後 ≤ 20 接受', () => {
  assert.equal(validateStudentName('A'.repeat(20)).ok, true);
  assert.equal(validateStudentName('A'.repeat(21)).ok, false);
  assert.equal(validateStudentName(' '.repeat(100) + 'A'.repeat(20) + ' '.repeat(100)).ok, true);
});

test('validateStudentName：超大輸入（100 萬字）快速回錯誤不炸', () => {
  const t0 = Date.now();
  const r = validateStudentName('A'.repeat(1_000_000));
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 1000);
});

test('validateStudentName：非字母開頭拒絕', () => {
  for (const n of ['1Amy', '-Amy', '.Amy', "'Amy", '_Amy']) assert.equal(validateStudentName(n).ok, false, n);
});

test('validateStudentName：Unicode / 全形字母 / 帶重音字母 / emoji 拒絕', () => {
  for (const n of ['小明', 'Ａｍｙ', 'Amｙ', 'José', 'Zoë', 'Amy😀', 'Аmy' /* 西里爾 А */, 'Amy​']) {
    assert.equal(validateStudentName(n).ok, false, n);
  }
});

test('validateStudentName：XSS / 特殊字元拒絕', () => {
  for (const n of ['<script>', 'a<b', 'Amy<script>alert(1)</script>', 'javascript:alert(1)', 'Amy"', 'Amy&Bob', 'Amy;', 'Amy/', 'Amy\\', 'Amy\nBob', 'Amy\tBob']) {
    assert.equal(validateStudentName(n).ok, false, JSON.stringify(n));
  }
});

test('validateStudentName：數字與物件輸入不丟例外', () => {
  assert.equal(validateStudentName(123).ok, false);
  assert.equal(validateStudentName({}).ok, false); // "[object Object]" 含 [ ]
  assert.doesNotThrow(() => validateStudentName(Symbol.iterator.description));
});

// ---------- parseScoreInput ----------

test('parseScoreInput：空白 / null / undefined → value null', () => {
  for (const v of ['', '   ', '\t', null, undefined]) assert.deepEqual(parseScoreInput(v), { ok: true, value: null }, JSON.stringify(v));
});

test('parseScoreInput：邊界 0、100、99.5、0.5 接受', () => {
  for (const [raw, v] of [['0', 0], ['100', 100], ['99.5', 99.5], ['0.5', 0.5], ['100.0', 100], ['85.0', 85]]) {
    assert.deepEqual(parseScoreInput(raw), { ok: true, value: v }, raw);
  }
});

test('parseScoreInput：數字型別輸入也可', () => {
  assert.deepEqual(parseScoreInput(85), { ok: true, value: 85 });
  assert.deepEqual(parseScoreInput(0), { ok: true, value: 0 });
});

test('parseScoreInput：前後空白 "  85  " → 85', () => {
  assert.deepEqual(parseScoreInput('  85  '), { ok: true, value: 85 });
});

test('parseScoreInput：非 0.5 單位拒絕（0.25、0.1、99.75、99.99）', () => {
  for (const raw of ['0.25', '0.1', '99.75', '99.99', '0.0001']) {
    const r = parseScoreInput(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(typeof r.error, 'string');
  }
});

test('parseScoreInput：範圍外與非數字拒絕', () => {
  for (const raw of ['-1', '-0.5', '100.5', '101', '1000', 'abc', 'NaN', 'Infinity', '-Infinity', '85分', '８５', '85,5', '8 5', '<script>', 'javascript:alert(1)',
    NaN, Infinity, -Infinity, '1e400']) {
    assert.equal(parseScoreInput(raw).ok, false, String(raw));
  }
});

test('parseScoreInput：只接受一般十進位寫法，指數與進位制字串一律拒絕', () => {
  for (const raw of ['1e2', '1e3', '0x10', '0b1', '0o7', '+85', '.5', '85.']) {
    assert.equal(parseScoreInput(raw).ok, false, raw);
  }
});

test('parseScoreInput：超長字串不炸、回錯誤', () => {
  assert.equal(parseScoreInput('9'.repeat(100_000)).ok, false);
  assert.equal(parseScoreInput('x'.repeat(1_000_000)).ok, false);
});

test('parseScoreInput：極接近 0.5 倍數的浮點（如 99.50000000000001）拒絕', () => {
  assert.equal(parseScoreInput('99.50000000000001').ok, false);
});

// ---------- buildScoreChanges ----------

const SUBJECTS = [
  { code: 'chinese', display_name: '國文' },
  { code: 'english', display_name: '英文' },
  { code: 'math', display_name: '數學' },
  { code: 'science', display_name: '自然' },
];

test('buildScoreChanges：全部空、原本也沒分數 → 全空結果', () => {
  assert.deepEqual(buildScoreChanges({}, {}, SUBJECTS), { upserts: [], deletes: [], errors: [] });
});

test('buildScoreChanges：subjects 為空陣列 → 全空結果', () => {
  assert.deepEqual(buildScoreChanges({ chinese: 80 }, { chinese: '90' }, []), { upserts: [], deletes: [], errors: [] });
});

test('buildScoreChanges：新增、修改、刪除、不變混合', () => {
  const existing = { chinese: 80, english: 70, math: 60 };
  const inputs = { chinese: '80', english: '75', math: '', science: '90' };
  const r = buildScoreChanges(existing, inputs, SUBJECTS);
  assert.deepEqual(r.upserts, [{ subject: 'english', score: 75 }, { subject: 'science', score: 90 }]);
  assert.deepEqual(r.deletes, ['math']);
  assert.deepEqual(r.errors, []);
});

test('buildScoreChanges：值相同不算變更（"85" vs 85、"85.0"、"  85  "、資料庫存字串 "85.0"）', () => {
  for (const [before, input] of [[85, '85'], [85, '85.0'], [85, '  85  '], ['85', '85'], ['85.0', '85'], [85.5, '85.5'], [0, '0']]) {
    const r = buildScoreChanges({ math: before }, { math: input }, [{ code: 'math', display_name: '數學' }]);
    assert.deepEqual(r, { upserts: [], deletes: [], errors: [] }, `${JSON.stringify(before)} vs ${JSON.stringify(input)}`);
  }
});

test('buildScoreChanges：原本分數 0 改成空白 → 刪除（0 不可被當成沒分數）', () => {
  const r = buildScoreChanges({ math: 0 }, { math: '' }, [{ code: 'math', display_name: '數學' }]);
  assert.deepEqual(r.deletes, ['math']);
});

test('buildScoreChanges：原本沒有 → 填 0 要 upsert', () => {
  const r = buildScoreChanges({}, { math: '0' }, [{ code: 'math', display_name: '數學' }]);
  assert.deepEqual(r.upserts, [{ subject: 'math', score: 0 }]);
});

test('buildScoreChanges：existing 值為 null / undefined 視為沒分數', () => {
  const subj = [{ code: 'math', display_name: '數學' }];
  assert.deepEqual(buildScoreChanges({ math: null }, { math: '' }, subj).deletes, []);
  assert.deepEqual(buildScoreChanges({ math: undefined }, { math: '50' }, subj).upserts, [{ subject: 'math', score: 50 }]);
});

test('buildScoreChanges：某科錯誤列入 errors，其他科照常判斷', () => {
  const existing = { chinese: 80, english: 70, math: 60 };
  const inputs = { chinese: '101', english: '0.25', math: '', science: '95' };
  const r = buildScoreChanges(existing, inputs, SUBJECTS);
  assert.deepEqual(r.errors.map((e) => e.code), ['chinese', 'english']);
  assert.ok(r.errors[0].message.includes('國文'));
  assert.ok(r.errors[1].message.includes('英文'));
  assert.deepEqual(r.deletes, ['math']);
  assert.deepEqual(r.upserts, [{ subject: 'science', score: 95 }]);
});

test('buildScoreChanges：錯誤的科目不會被刪除（就算原本有分數）', () => {
  const r = buildScoreChanges({ math: 60 }, { math: 'abc' }, [{ code: 'math', display_name: '數學' }]);
  assert.deepEqual(r.deletes, []);
  assert.deepEqual(r.upserts, []);
  assert.equal(r.errors.length, 1);
});

test('buildScoreChanges：inputs 有 subjects 以外的鍵 → 忽略', () => {
  const r = buildScoreChanges({}, { hacker: '100', '__proto__': '50' }, SUBJECTS);
  assert.deepEqual(r, { upserts: [], deletes: [], errors: [] });
});

test('buildScoreChanges：大量科目（10,000 科）不炸且結果正確', () => {
  const subjects = Array.from({ length: 10_000 }, (_, i) => ({ code: `s${i}`, display_name: `科${i}` }));
  const inputs = Object.fromEntries(subjects.map((s, i) => [s.code, String(i % 101)]));
  const r = buildScoreChanges({}, inputs, subjects);
  assert.equal(r.upserts.length, 10_000);
  assert.equal(r.errors.length, 0);
});

test('buildScoreChanges：XSS 的 display_name 只原樣出現在錯誤訊息（純字串，不做處理）', () => {
  const r = buildScoreChanges({}, { x: 'bad' }, [{ code: 'x', display_name: '<img src=x onerror=alert(1)>' }]);
  assert.equal(r.errors.length, 1);
  assert.equal(typeof r.errors[0].message, 'string');
});

test('buildScoreChanges：existing 或 inputs 為 null/undefined 時不丟例外', () => {
  const subj = [{ code: 'chi', display_name: '國文' }];
  assert.deepEqual(buildScoreChanges(null, { chi: '80' }, subj), { upserts: [{ subject: 'chi', score: 80 }], deletes: [], errors: [] });
  assert.deepEqual(buildScoreChanges({ chi: 80 }, undefined, subj), { upserts: [], deletes: ['chi'], errors: [] });
});

// ---------- validateRanking ----------

test('validateRanking：合法組合', () => {
  assert.deepEqual(validateRanking('1', '1'), { ok: true, rank: 1, total: 1 });
  assert.deepEqual(validateRanking(' 5 ', ' 300 '), { ok: true, rank: 5, total: 300 });
  assert.deepEqual(validateRanking(300, 300), { ok: true, rank: 300, total: 300 });
});

test('validateRanking：名次 > 總人數拒絕', () => {
  assert.equal(validateRanking('301', '300').ok, false);
  assert.equal(validateRanking('2', '1').ok, false);
});

test('validateRanking：0、負數、小數、空白、非數字拒絕', () => {
  const bad = [['0', '10'], ['-1', '10'], ['1.5', '10'], ['', '10'], ['   ', '10'], ['abc', '10'], [null, '10'], [undefined, '10'],
    ['1', '0'], ['1', '-5'], ['1', '2.5'], ['1', ''], ['1', null], ['NaN', '10'], ['Infinity', 'Infinity'], ['1', 'Infinity'],
    ['１', '１０'], ['<script>', '10'], ['javascript:1', '10']];
  for (const [r, t] of bad) {
    const res = validateRanking(r, t);
    assert.equal(res.ok, false, `${JSON.stringify(r)}/${JSON.stringify(t)}`);
    assert.equal(typeof res.error, 'string');
  }
});

test('validateRanking：只接受十進位整數字串（1e2、1.0、0x10 都拒絕）', () => {
  for (const [r, t] of [['1e2', '1e2'], ['1.0', '10'], ['0x10', '0x20'], ['0b1', '10']]) {
    assert.equal(validateRanking(r, t).ok, false, `${r}/${t}`);
  }
});

test('validateRanking：極大數字不炸', () => {
  assert.doesNotThrow(() => validateRanking('9'.repeat(400), '9'.repeat(400)));
  assert.equal(validateRanking('9'.repeat(400), '9'.repeat(400)).ok, false); // Infinity 非整數
});


// ---------- validateEmail ----------

test('validateEmail：轉小寫並 trim', () => {
  assert.deepEqual(validateEmail('  Parent@Example.COM  '), { ok: true, value: 'parent@example.com' });
});

test('validateEmail：常見合法格式', () => {
  for (const e of ['a@b.c', 'first.last+tag@sub.example.co.uk', 'x_y-z@domain.tw']) assert.equal(validateEmail(e).ok, true, e);
});

test('validateEmail：空值、只有空白、缺 @ 或缺網域點拒絕', () => {
  for (const e of ['', '   ', null, undefined, 'abc', 'a@b', '@b.c', 'a@', 'a@.c', 'a@b.', 'a@@b.c', 'a@b@c.d']) {
    assert.equal(validateEmail(e).ok, false, JSON.stringify(e));
  }
});

test('validateEmail：中間含空白（半形、tab、換行、全形空白、NBSP）拒絕', () => {
  for (const e of ['a b@c.d', 'a@b c.d', 'a\t@b.c', 'a@b.c\nx', 'a　b@c.d', 'a b@c.d']) {
    assert.equal(validateEmail(e).ok, false, JSON.stringify(e));
  }
});

test('validateEmail：含 < > " \' 拒絕（XSS）', () => {
  for (const e of ['<script>@a.b', 'a@b.c<script>', 'a"b@c.d', "a'b@c.d", 'a>b@c.d', '"><img src=x onerror=alert(1)>@a.b']) {
    assert.equal(validateEmail(e).ok, false, e);
  }
});

test('validateEmail：長度 254 接受、255 拒絕', () => {
  const domain = '@example.com'; // 12
  const ok = 'a'.repeat(254 - domain.length) + domain;
  const bad = 'a'.repeat(255 - domain.length) + domain;
  assert.equal(ok.length, 254);
  assert.equal(validateEmail(ok).ok, true);
  assert.equal(validateEmail(bad).ok, false);
});

test('validateEmail：長度以 trim 後計算', () => {
  const domain = '@example.com';
  const e = '   ' + 'a'.repeat(254 - domain.length) + domain + '   ';
  assert.equal(validateEmail(e).ok, true);
});

test('validateEmail：超大輸入（100 萬字）不炸、不卡住', () => {
  const t0 = Date.now();
  assert.equal(validateEmail('a'.repeat(1_000_000) + '@b.c').ok, false);
  assert.equal(validateEmail('a@' + 'b.'.repeat(500_000)).ok, false);
  assert.ok(Date.now() - t0 < 2000);
});

test('validateEmail：Unicode / 全形網域現行接受（規格未禁止，鎖住行為）', () => {
  assert.equal(validateEmail('家長@例子.台灣').ok, true);
  assert.equal(validateEmail('ＡＢＣ@ｅｘ.ｃｏｍ').value, 'ａｂｃ@ｅｘ.ｃｏｍ');
});

test('validateEmail：javascript: 前綴現行接受（不含禁止字元；呼叫端須以純文字顯示）', () => {
  assert.equal(validateEmail('javascript:alert(1)@x.com').ok, true);
});

// ---------- validateAvatarFile ----------

const file = (o) => ({ name: 'pic.png', type: 'image/png', size: 1024, ...o });

test('validateAvatarFile：null / undefined 回錯誤', () => {
  for (const v of [null, undefined, 0, '']) {
    const r = validateAvatarFile(v);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  }
});

test('validateAvatarFile：jpeg / png / webp 接受', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.deepEqual(validateAvatarFile(file({ type })), { ok: true });
});

test('validateAvatarFile：其他 MIME（含 svg、gif、大小寫變形、空字串）拒絕，訊息含檔名', () => {
  for (const type of ['image/gif', 'image/svg+xml', 'image/heic', 'IMAGE/PNG', 'image/jpg', 'image/png ', '', undefined, 'text/html', 'application/octet-stream']) {
    const r = validateAvatarFile(file({ type, name: 'evil.file' }));
    assert.equal(r.ok, false, String(type));
    assert.ok(r.error.includes('evil.file'));
  }
});

test('validateAvatarFile：size 0 拒絕且訊息含檔名', () => {
  const r = validateAvatarFile(file({ size: 0, name: 'empty.png' }));
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('empty.png'));
});

test('validateAvatarFile：size 1 byte 接受；剛好 10 MB 接受；10 MB + 1 拒絕', () => {
  assert.equal(AVATAR_MAX_SOURCE_BYTES, MB10);
  assert.equal(validateAvatarFile(file({ size: 1 })).ok, true);
  assert.equal(validateAvatarFile(file({ size: MB10 })).ok, true);
  const r = validateAvatarFile(file({ size: MB10 + 1, name: 'big.png' }));
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('big.png'));
});

test('validateAvatarFile：size 為負數、NaN、缺少 → 拒絕；Infinity → 拒絕', () => {
  for (const size of [-1, NaN, undefined, null, Infinity]) {
    assert.equal(validateAvatarFile(file({ size })).ok, false, String(size));
  }
});

test('validateAvatarFile：缺檔名時用預設字樣、不丟例外', () => {
  const r = validateAvatarFile({ type: 'image/gif', size: 10 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('這個檔案'));
});

test('validateAvatarFile：XSS 檔名與超長檔名不炸（訊息原樣含檔名，呼叫端須以純文字顯示）', () => {
  const xss = '<img src=x onerror=alert(1)>.gif';
  assert.ok(validateAvatarFile(file({ type: 'image/gif', name: xss })).error.includes(xss));
  const long = 'a'.repeat(100_000) + '.gif';
  assert.equal(validateAvatarFile(file({ type: 'image/gif', name: long })).ok, false);
});

// ---------- squareCropRect ----------

test('squareCropRect：正方形原圖', () => {
  assert.deepEqual(squareCropRect(1000, 1000), { sx: 0, sy: 0, side: 1000, output: 512 });
  assert.deepEqual(squareCropRect(512, 512), { sx: 0, sy: 0, side: 512, output: 512 });
});

test('squareCropRect：橫圖、直圖置中', () => {
  assert.deepEqual(squareCropRect(1600, 900), { sx: 350, sy: 0, side: 900, output: 512 });
  assert.deepEqual(squareCropRect(900, 1600), { sx: 0, sy: 350, side: 900, output: 512 });
});

test('squareCropRect：奇數差值向下取整', () => {
  assert.deepEqual(squareCropRect(5, 2), { sx: 1, sy: 0, side: 2, output: 2 });
  assert.deepEqual(squareCropRect(2, 5), { sx: 0, sy: 1, side: 2, output: 2 });
  assert.deepEqual(squareCropRect(1001, 1000), { sx: 0, sy: 0, side: 1000, output: 512 });
  assert.deepEqual(squareCropRect(1003, 1000), { sx: 1, sy: 0, side: 1000, output: 512 });
});

test('squareCropRect：極寬 / 極窄圖', () => {
  assert.deepEqual(squareCropRect(4000, 10), { sx: 1995, sy: 0, side: 10, output: 10 });
  assert.deepEqual(squareCropRect(10, 4000), { sx: 0, sy: 1995, side: 10, output: 10 });
  assert.deepEqual(squareCropRect(100000, 1), { sx: 49999, sy: 0, side: 1, output: 1 });
});

test('squareCropRect：1×1 不放大', () => {
  assert.deepEqual(squareCropRect(1, 1), { sx: 0, sy: 0, side: 1, output: 1 });
});

test('squareCropRect：裁切範圍一定落在原圖內', () => {
  for (const [w, h] of [[4000, 10], [10, 4000], [1, 1], [5, 2], [7, 3], [3000, 2999], [12345, 678]]) {
    const r = squareCropRect(w, h);
    assert.ok(r.sx >= 0 && r.sy >= 0);
    assert.ok(r.sx + r.side <= w && r.sy + r.side <= h, `${w}x${h}`);
    assert.ok(r.output <= r.side && r.output <= 512);
  }
});

test('squareCropRect：自訂 outputSize', () => {
  assert.deepEqual(squareCropRect(1000, 800, 256), { sx: 100, sy: 0, side: 800, output: 256 });
  assert.deepEqual(squareCropRect(100, 100, 256), { sx: 0, sy: 0, side: 100, output: 100 });
});

test('squareCropRect：寬或高 ≤ 0、NaN、非數字 → null', () => {
  for (const [w, h] of [[0, 100], [100, 0], [0, 0], [-1, 100], [100, -1], [NaN, 100], [100, NaN],
    [undefined, 100], [null, 100], ['abc', 100], [100, {}], [undefined, undefined]]) {
    assert.equal(squareCropRect(w, h), null, `${String(w)}x${String(h)}`);
  }
});

test('squareCropRect：Infinity 寬/高回 null', () => {
  assert.equal(squareCropRect(Infinity, 100), null);
  assert.equal(squareCropRect(Infinity, Infinity), null);
  assert.equal(squareCropRect(100, -Infinity), null);
});

test('squareCropRect：數字字串不接受（只吃真正的數字）', () => {
  assert.equal(squareCropRect('100', '50'), null);
});

// ---------- avatarObjectPath / avatarObjectPaths ----------

test('avatarObjectPath：webp → .webp，其他 → .jpg', () => {
  const id = '6f1c2a3b-0000-4000-8000-000000000001';
  assert.equal(avatarObjectPath(id, 'image/webp'), `${id}.webp`);
  for (const mime of ['image/jpeg', 'image/png', 'IMAGE/WEBP', '', undefined, null]) {
    assert.equal(avatarObjectPath(id, mime), `${id}.jpg`, String(mime));
  }
});

test('avatarObjectPaths：同時包含 webp 與 jpg，且與 avatarObjectPath 一致', () => {
  const id = 'abc';
  assert.deepEqual(avatarObjectPaths(id), ['abc.webp', 'abc.jpg']);
  assert.ok(avatarObjectPaths(id).includes(avatarObjectPath(id, 'image/webp')));
  assert.ok(avatarObjectPaths(id).includes(avatarObjectPath(id, 'image/jpeg')));
});

test('avatarObjectPath：id 為 null/undefined 不丟例外', () => {
  assert.doesNotThrow(() => avatarObjectPath(null, 'image/webp'));
  assert.doesNotThrow(() => avatarObjectPaths(undefined));
});

// ---------- versionedAvatarUrl ----------

test('versionedAvatarUrl：加上 ?v=', () => {
  assert.equal(versionedAvatarUrl('https://x.supabase.co/a/b.webp', 123), 'https://x.supabase.co/a/b.webp?v=123');
});

test('versionedAvatarUrl：移除原有 query（含多個 ? 與空 query）', () => {
  assert.equal(versionedAvatarUrl('https://h/a.jpg?v=1&x=2', 5), 'https://h/a.jpg?v=5');
  assert.equal(versionedAvatarUrl('https://h/a.jpg?', 5), 'https://h/a.jpg?v=5');
  assert.equal(versionedAvatarUrl('https://h/a.jpg?a=1?b=2', 5), 'https://h/a.jpg?v=5');
});

test('versionedAvatarUrl：重複套用只保留最後版本', () => {
  const u = versionedAvatarUrl(versionedAvatarUrl('https://h/a.jpg', 1), 2);
  assert.equal(u, 'https://h/a.jpg?v=2');
});

test('versionedAvatarUrl：版本字串會 encodeURIComponent', () => {
  assert.equal(versionedAvatarUrl('https://h/a.jpg', 'a b&c=d#e'), 'https://h/a.jpg?v=a%20b%26c%3Dd%23e');
  assert.equal(versionedAvatarUrl('https://h/a.jpg', '<script>'), 'https://h/a.jpg?v=%3Cscript%3E');
  assert.equal(versionedAvatarUrl('https://h/a.jpg', '版本'), 'https://h/a.jpg?v=%E7%89%88%E6%9C%AC');
});

test('versionedAvatarUrl：Date.now() 數字版本', () => {
  const now = 1760000000000;
  assert.equal(versionedAvatarUrl('https://h/a.jpg', now), `https://h/a.jpg?v=${now}`);
});

test('versionedAvatarUrl：怪值不丟例外', () => {
  assert.doesNotThrow(() => versionedAvatarUrl(null, undefined));
  assert.doesNotThrow(() => versionedAvatarUrl('', ''));
  assert.equal(versionedAvatarUrl('', ''), '?v=');
});

test('versionedAvatarUrl：孤立代理字元（lone surrogate）版本會讓 encodeURIComponent 丟 URIError（鎖住行為）', () => {
  assert.throws(() => versionedAvatarUrl('https://h/a.jpg', '\uD800'), URIError);
});

test('versionedAvatarUrl：URL 含 #fragment 時，?v= 插在 # 之前', () => {
  assert.equal(versionedAvatarUrl('https://h/a.jpg#x', 1), 'https://h/a.jpg?v=1#x');
  assert.equal(versionedAvatarUrl('https://h/a.jpg?old=1#x', 2), 'https://h/a.jpg?v=2#x');
});
