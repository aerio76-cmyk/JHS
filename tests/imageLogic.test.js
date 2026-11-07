// imageLogic.js：檔頭解析（不解碼就知道尺寸）、縮放與縮圖尺寸、檔案檢查
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/imageLogic.js');

const be16 = (n) => [(n >> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >> 8) & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const asc = (s) => [...s].map((c) => c.charCodeAt(0));

const png = (w, h) => new Uint8Array([0x89, ...asc('PNG'), 13, 10, 26, 10, 0, 0, 0, 13, ...asc('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0]);

// JPEG：SOI → (可選 APP1 EXIF 方向) → (可選 APP1 XMP) → SOF0
function jpeg(w, h, orientation, { littleEndian = true, sofMarker = 0xc0, junkBefore = false, xmpBefore = false, xmpAfter = false } = {}) {
  const out = [0xff, 0xd8];
  const xmp = () => { const seg = asc('http://ns.adobe.com/xap/1.0/ <x:xmpmeta/>'); out.push(0xff, 0xe1, ...be16(seg.length + 2), ...seg); };
  if (junkBefore) out.push(0xff, 0xe0, ...be16(6), 1, 2, 3, 4); // APP0
  if (xmpBefore) xmp();
  if (orientation) {
    const r16 = littleEndian ? le16 : be16;
    const r32 = littleEndian ? (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255] : be32;
    const tiff = [...asc(littleEndian ? 'II' : 'MM'), ...r16(42), ...r32(8), ...r16(1), ...r16(0x0112), ...r16(3), ...r32(1), ...r16(orientation), 0, 0, ...r32(0)];
    const seg = [...asc('Exif'), 0, 0, ...tiff];
    out.push(0xff, 0xe1, ...be16(seg.length + 2), ...seg);
  }
  if (xmpAfter) xmp();
  out.push(0xff, 0xc4, ...be16(4), 0, 0); // DHT（不是 SOF，要跳過）
  out.push(0xff, sofMarker, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  out.push(0xff, 0xda, ...be16(2));
  return new Uint8Array(out);
}

const webpVP8X = (w, h) => new Uint8Array([...asc('RIFF'), 0, 0, 0, 0, ...asc('WEBP'), ...asc('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const webpVP8 = (w, h) => new Uint8Array([...asc('RIFF'), 0, 0, 0, 0, ...asc('WEBP'), ...asc('VP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]);
function webpVP8L(w, h) {
  const a = w - 1;
  const b = h - 1;
  const bits = [a & 0xff, ((a >> 8) & 0x3f) | ((b & 0x03) << 6), (b >> 2) & 0xff, (b >> 10) & 0x0f];
  return new Uint8Array([...asc('RIFF'), 0, 0, 0, 0, ...asc('WEBP'), ...asc('VP8L'), 0, 0, 0, 0, 0x2f, ...bits, 0, 0, 0, 0, 0]);
}

test('readImageHeader：PNG', () => {
  assert.deepEqual(L.readImageHeader(png(1200, 800)), { type: 'image/png', width: 1200, height: 800, orientation: 1 });
  assert.deepEqual(L.readImageHeader(png(8000, 7000)).width, 8000);
});

test('readImageHeader：JPEG（略過非 SOF 區段、各種 SOF）', () => {
  assert.deepEqual(L.readImageHeader(jpeg(4032, 3024)), { type: 'image/jpeg', width: 4032, height: 3024, orientation: 1 });
  assert.equal(L.readImageHeader(jpeg(640, 480, 0, { sofMarker: 0xc2 })).width, 640, '漸進式 JPEG（SOF2）');
  assert.equal(L.readImageHeader(jpeg(640, 480, 0, { junkBefore: true })).height, 480);
});

test('readImageHeader：JPEG 的 EXIF 方向 5–8 會對調寬高（手機直拍照片）', () => {
  assert.deepEqual(L.readImageHeader(jpeg(4032, 3024, 6)), { type: 'image/jpeg', width: 3024, height: 4032, orientation: 6 });
  assert.deepEqual(L.readImageHeader(jpeg(4032, 3024, 8, { littleEndian: false })), { type: 'image/jpeg', width: 3024, height: 4032, orientation: 8 });
  assert.equal(L.readImageHeader(jpeg(4032, 3024, 3)).width, 4032, '方向 3（倒過來）不對調');
});

test('readImageHeader：Exif 後面接 XMP（手機照片常見）時，方向不被 XMP 蓋掉（回歸）', () => {
  assert.deepEqual(L.readImageHeader(jpeg(400, 200, 6, { xmpAfter: true })), { type: 'image/jpeg', width: 200, height: 400, orientation: 6 });
  assert.deepEqual(L.readImageHeader(jpeg(400, 200, 8, { xmpBefore: true })), { type: 'image/jpeg', width: 200, height: 400, orientation: 8 });
  assert.deepEqual(L.readImageHeader(jpeg(400, 200, 0, { xmpBefore: true, xmpAfter: true })).orientation, 1, '只有 XMP、沒有 Exif');
});

test('readImageHeader：WebP 三種格式', () => {
  assert.deepEqual(L.readImageHeader(webpVP8X(1600, 4800)), { type: 'image/webp', width: 1600, height: 4800, orientation: 1 });
  assert.deepEqual(L.readImageHeader(webpVP8(800, 600)), { type: 'image/webp', width: 800, height: 600, orientation: 1 });
  assert.deepEqual(L.readImageHeader(webpVP8L(1000, 3000)), { type: 'image/webp', width: 1000, height: 3000, orientation: 1 });
});

test('readImageHeader：認不出來或損壞回傳 null，不丟例外', () => {
  for (const bytes of [
    new Uint8Array([]), new Uint8Array([0xff]), asc('GIF89a'), asc('<svg xmlns="http://www.w3.org/2000/svg">'),
    jpeg(100, 100).subarray(0, 10), png(0, 100), new Uint8Array([0xff, 0xd8, 0x00, 0x00]), new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]),
  ]) {
    assert.equal(L.readImageHeader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), null);
  }
});

test('fitWithin：等比縮到 1600×4800 內，小圖不放大', () => {
  assert.deepEqual(L.fitWithin(4032, 3024, 1600, 4800), { width: 1600, height: 1200, scale: 1600 / 4032 });
  assert.deepEqual(L.fitWithin(1000, 8000, 1600, 4800), { width: 600, height: 4800, scale: 0.6 }, '超長圖以高度為限');
  assert.deepEqual(L.fitWithin(800, 600, 1600, 4800), { width: 800, height: 600, scale: 1 });
  assert.equal(L.fitWithin(0, 100, 1600, 4800), null);
  assert.equal(L.fitWithin(50000, 1, 1600, 4800).height, 1, '極細的圖至少 1 px');
});

test('thumbCropRect：橫圖取中間、直圖取最上面、不放大', () => {
  assert.deepEqual(L.thumbCropRect(1600, 1200), { sx: 200, sy: 0, side: 1200, output: 320 });
  assert.deepEqual(L.thumbCropRect(1000, 4800), { sx: 0, sy: 0, side: 1000, output: 320 });
  assert.deepEqual(L.thumbCropRect(200, 100), { sx: 50, sy: 0, side: 100, output: 100 });
  assert.equal(L.thumbCropRect(0, 0), null);
});

test('avatarDecodeSize：短邊縮到 512', () => {
  assert.deepEqual(L.avatarDecodeSize(4032, 3024, 512), { width: 683, height: 512 });
  assert.deepEqual(L.avatarDecodeSize(300, 200, 512), { width: 300, height: 200 });
});

test('validateImageSource：格式、空檔、10 MB 上限', () => {
  const f = (type, size, name = 'a.jpg') => ({ type, size, name });
  assert.equal(L.validateImageSource(f('image/jpeg', 1000)).ok, true);
  assert.equal(L.validateImageSource(f('image/png', 10 * 1024 * 1024)).ok, true);
  assert.match(L.validateImageSource(f('image/gif', 1000, '動畫.gif')).error, /不是 JPG、PNG 或 WebP/);
  assert.match(L.validateImageSource(f('image/svg+xml', 1000)).error, /不是 JPG/);
  assert.match(L.validateImageSource(f('image/jpeg', 0)).error, /空的檔案/);
  assert.match(L.validateImageSource(f('image/jpeg', 14.2 * 1048576, '講義.png')).error, /超過 10 MB（14\.2 MB）/);
  assert.equal(L.validateImageSource(null).ok, false);
  assert.equal(L.validateImageSource(f('image/gif', 1)).retryable, false);
});

test('checkImageHeader：認不出來、超過 5000 萬像素都拒絕（在解碼之前）', () => {
  assert.match(L.checkImageHeader(null, { name: 'x.png' }).error, /無法辨識/);
  assert.match(L.checkImageHeader({ width: 10000, height: 6000 }, { name: 'x.png' }).error, /約 60 百萬像素/);
  assert.equal(L.checkImageHeader({ width: 8000, height: 6000 }, { name: 'x.png' }).ok, true);
});
