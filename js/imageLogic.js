// 圖片處理（頭像與學習資料共用）。
// 純函式（檔頭解析、尺寸計算、檔案檢查）不碰 DOM，瀏覽器與 node --test 共用；
// 瀏覽器專用的解碼與編碼（decodeScaled、encodeCanvas、processMaterialImage、processAvatarImage）只在呼叫時才用到 DOM。
//
// 記憶體：先從檔頭讀出尺寸，超過像素上限的圖片「不解碼」直接拒絕；能用 createImageBitmap 的縮放選項時，
// 解碼當下就縮小，避免整張大圖展開在記憶體裡（手機照片 4000×3000 展開約 48 MB）。

const IMAGE_SOURCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_PIXELS = 50_000_000;
const IMAGE_MAX_SIDE = 20000; // 單邊上限：極細長的圖即使總像素不多，退回整張解碼時仍很吃記憶體
const IMAGE_MAX_RATIO = 30; // 長寬比上限（1:30）
const IMAGE_HEADER_BYTES = 256 * 1024; // 足夠涵蓋 JPEG 的 EXIF 區段

const MATERIAL_MAX_WIDTH = 1600;
const MATERIAL_MAX_HEIGHT = 4800;
const MATERIAL_THUMB_SIZE = 320;
const MATERIAL_MAX_BYTES = 2 * 1024 * 1024; // 與 bucket 上限相同

/* ---------------- 檔頭解析 ---------------- */
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

// JPEG 的 EXIF 方向（1–8）。不是 Exif 區段（例如 XMP）回傳 null；是 Exif 但沒有方向標記回傳 1
function readExifOrientation(b, start, end) {
  if (end - start < 14 || ascii(b, start, 4) !== 'Exif') return null;
  const t = start + 6;
  const le = ascii(b, t, 2) === 'II';
  if (!le && ascii(b, t, 2) !== 'MM') return 1;
  const r16 = (i) => (le ? u16le(b, i) : u16be(b, i));
  const r32 = (i) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i));
  const ifd = t + r32(t + 4);
  if (ifd + 2 > end) return 1;
  const count = r16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/**
 * 從檔案開頭的位元組讀出格式與尺寸（不解碼）。
 * 回傳 { type, width, height, orientation }；width／height 是「轉正後」的顯示尺寸。認不出來回傳 null。
 */
function readImageHeader(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const result = (type, width, height, orientation = 1) => {
    if (!(width > 0 && height > 0)) return null;
    const rotated = orientation >= 5 && orientation <= 8;
    return { type, width: rotated ? height : width, height: rotated ? width : height, orientation };
  };
  // PNG
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    return result('image/png', u32be(b, 16), u32be(b, 20));
  }
  // WebP
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') return result('image/webp', 1 + u24le(b, 24), 1 + u24le(b, 27));
    if (chunk === 'VP8 ') return result('image/webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const w = 1 + (b[21] | ((b[22] & 0x3f) << 8));
      const h = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10));
      return result('image/webp', w, h);
    }
    return null;
  }
  // JPEG：逐段找 SOF（記下途中 APP1 的 EXIF 方向）
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    let orientation = 1;
    let exifFound = false;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; } // 填充位元組
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      const segStart = i + 4;
      const segEnd = Math.min(i + 2 + len, b.length);
      if (marker === 0xe1 && !exifFound) {
        const o = readExifOrientation(b, segStart, segEnd);
        if (o != null) { orientation = o; exifFound = true; } // 只採用第一個 Exif；後面的 XMP 等 APP1 不覆蓋
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (segStart + 5 > b.length) return null;
        return result('image/jpeg', u16be(b, segStart + 3), u16be(b, segStart + 1), orientation);
      }
      if (marker === 0xda || marker === 0xd9) return null; // 到了影像資料還沒有 SOF
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/* ---------------- 尺寸計算 ---------------- */
// 等比縮到不超過 maxW × maxH（小圖不放大）
function fitWithin(width, height, maxW, maxH) {
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

// 縮圖：正方形；橫圖取中間、直圖取最上面（長的資訊圖標題通常在上方）；小圖不放大
function thumbCropRect(width, height, size = MATERIAL_THUMB_SIZE) {
  if (!(width > 0 && height > 0)) return null;
  const side = Math.min(width, height);
  return {
    sx: width > height ? Math.floor((width - side) / 2) : 0,
    sy: 0,
    side,
    output: Math.min(size, side),
  };
}

// 頭像：先把短邊縮到 output（解碼時就縮），再置中裁正方形
function avatarDecodeSize(width, height, output) {
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, output / Math.min(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/* ---------------- 檔案檢查 ---------------- */
function validateImageSource(file) {
  if (!file) return { ok: false, retryable: false, error: '沒有選到檔案。' };
  const name = String(file.name || '這個檔案');
  if (!IMAGE_SOURCE_TYPES.includes(file.type)) return { ok: false, retryable: false, error: `「${name}」不是 JPG、PNG 或 WebP，沒有上傳。` };
  if (!(file.size > 0)) return { ok: false, retryable: false, error: `「${name}」是空的檔案，沒有上傳。` };
  if (file.size > IMAGE_MAX_SOURCE_BYTES) {
    return { ok: false, retryable: false, error: `「${name}」超過 10 MB（${(file.size / 1048576).toFixed(1)} MB），請先縮小再上傳。` };
  }
  return { ok: true };
}

// 檔頭檢查：認不出格式、像素太多都拒絕（在解碼之前）。宣告格式與實際不同不拒絕：一律重新編碼，沒有安全影響
function checkImageHeader(header, file) {
  const name = String(file?.name || '這個檔案');
  if (!header) return { ok: false, retryable: false, error: `「${name}」無法辨識圖片內容，可能檔案損壞，沒有上傳。` };
  if (Math.max(header.width, header.height) > IMAGE_MAX_SIDE || Math.max(header.width, header.height) / Math.min(header.width, header.height) > IMAGE_MAX_RATIO) {
    return { ok: false, retryable: false, error: `「${name}」的形狀太細長（${header.width}×${header.height}），請先裁切再上傳。` };
  }
  if (header.width * header.height > IMAGE_MAX_PIXELS) {
    const mp = Math.round((header.width * header.height) / 1e6);
    return { ok: false, retryable: false, error: `「${name}」尺寸太大（約 ${mp} 百萬像素，上限 50），請先縮小再上傳。` };
  }
  return { ok: true };
}

/* ---------------- 瀏覽器專用：解碼與編碼 ---------------- */
async function readHeaderOf(file) {
  const read = async (n) => readImageHeader(new Uint8Array(await file.slice(0, n).arrayBuffer()));
  const header = await read(IMAGE_HEADER_BYTES);
  // JPEG 前面若有很長的 XMP／ICC 區段，SOF 可能在 256 KB 之後：多讀一段再試
  if (!header && file.size > IMAGE_HEADER_BYTES) return read(Math.min(file.size, 4 * 1024 * 1024));
  return header;
}

// 解碼時盡量就縮小。只傳寬度，高度由瀏覽器依「轉正後」的比例計算，不依賴自己解析的 EXIF 方向；
// 瀏覽器不支援縮放選項時退回整張解碼。呼叫端一律以 bitmap 的實際尺寸重新計算，不假設縮放有生效。
async function decodeScaled(file, targetWidth) {
  try {
    return await createImageBitmap(file, { resizeWidth: Math.max(1, Math.round(targetWidth)), resizeQuality: 'high' });
  } catch {
    return createImageBitmap(file);
  }
}

// 畫到新的 canvas：先填白底（透明 PNG 存成 jpeg 時才不會變黑），高品質縮放
function drawToCanvas(source, sx, sy, sw, sh, dw, dh) {
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dw, dh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas;
}

function releaseCanvas(canvas) {
  if (canvas) { canvas.width = 0; canvas.height = 0; }
}

// webp 優先，不支援時 jpeg；超過 maxBytes 就降低品質重試
async function encodeCanvas(canvas, maxBytes) {
  const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
  for (const q of [0.85, 0.75, 0.65, 0.55]) {
    let blob = await toBlob('image/webp', q);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', q);
    if (!blob) throw new Error('encode failed');
    if (!maxBytes || blob.size <= maxBytes) return blob;
  }
  return null;
}

/**
 * 學習資料：檢查 → 讀檔頭 → 解碼縮到 1600×4800 內 → 編碼大圖與 320 縮圖（重新編碼即移除 EXIF）。
 * 回傳 { blob, thumb, width, height }；失敗時丟出 { userMessage, retryable: false }。
 */
async function processMaterialImage(file) {
  const fail = (error) => { const e = new Error(error); e.userMessage = error; e.retryable = false; throw e; };
  const v = validateImageSource(file);
  if (!v.ok) fail(v.error);
  const header = await readHeaderOf(file);
  const hv = checkImageHeader(header, file);
  if (!hv.ok) fail(hv.error);
  const planned = fitWithin(header.width, header.height, MATERIAL_MAX_WIDTH, MATERIAL_MAX_HEIGHT);
  let bitmap = null;
  let main = null;
  let thumbCanvas = null;
  try {
    bitmap = await decodeScaled(file, planned.width);
    // 以實際解碼出來的尺寸（已轉正）重新計算，瀏覽器沒套用縮放或方向時也不會變形
    const target = fitWithin(bitmap.width, bitmap.height, MATERIAL_MAX_WIDTH, MATERIAL_MAX_HEIGHT);
    main = drawToCanvas(bitmap, 0, 0, bitmap.width, bitmap.height, target.width, target.height);
    bitmap.close();
    bitmap = null;
    const blob = await encodeCanvas(main, MATERIAL_MAX_BYTES);
    if (!blob) fail(`「${file.name}」壓縮後仍超過 2 MB，請先裁小再上傳。`);
    const r = thumbCropRect(target.width, target.height);
    thumbCanvas = drawToCanvas(main, r.sx, r.sy, r.side, r.side, r.output, r.output);
    const thumb = await encodeCanvas(thumbCanvas, MATERIAL_MAX_BYTES);
    if (!thumb) fail(`「${file.name}」無法產生縮圖。`);
    return { blob, thumb, width: target.width, height: target.height };
  } catch (error) {
    if (error.userMessage) throw error;
    fail(`「${file.name}」無法讀取，可能檔案損壞或瀏覽器不支援這種圖片。`);
  } finally {
    if (bitmap) bitmap.close();
    releaseCanvas(main);
    releaseCanvas(thumbCanvas);
  }
}

/**
 * 頭像：檢查 → 讀檔頭 → 解碼時把短邊縮到 512 → 置中裁正方形 → 編碼。
 * 回傳 { canvas, blob }（canvas 給預覽用，呼叫端用完要自己釋放）。
 */
async function processAvatarImage(file, output) {
  const fail = (error) => { const e = new Error(error); e.userMessage = error; throw e; };
  const v = validateImageSource(file);
  if (!v.ok) fail(v.error);
  const header = await readHeaderOf(file);
  const hv = checkImageHeader(header, file);
  if (!hv.ok) fail(hv.error);
  const size = avatarDecodeSize(header.width, header.height, output);
  const bitmap = await decodeScaled(file, size.width);
  try {
    // 以實際解碼出來的尺寸計算（瀏覽器沒套用縮放選項時也正確）
    const side = Math.min(bitmap.width, bitmap.height);
    const out = Math.min(output, side);
    const canvas = drawToCanvas(bitmap, Math.floor((bitmap.width - side) / 2), Math.floor((bitmap.height - side) / 2), side, side, out, out);
    const blob = await encodeCanvas(canvas, 0);
    return { canvas, blob };
  } finally {
    bitmap.close();
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    IMAGE_SOURCE_TYPES, IMAGE_MAX_SOURCE_BYTES, IMAGE_MAX_PIXELS, IMAGE_MAX_SIDE, IMAGE_MAX_RATIO, MATERIAL_MAX_WIDTH, MATERIAL_MAX_HEIGHT, MATERIAL_THUMB_SIZE, MATERIAL_MAX_BYTES,
    readImageHeader, fitWithin, thumbCropRect, avatarDecodeSize, validateImageSource, checkImageHeader,
  };
}
