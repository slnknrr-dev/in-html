// ico/ico.js - Windows icon files (image/vnd.microsoft.icon, .ico): encodes several RGBA images of different sizes
// into one file and reads such files back. No DOM: pages, workers and Node.
//
// Images are { width, height, data: Uint8ClampedArray | Uint8Array (RGBA, not premultiplied) }, 1..256 px a side.
// Entries are stored as 32-bit BMP (BGRA + AND mask: every Windows version and every icon reader) or as PNG (Vista
// and later; much smaller for 256 px). 'auto' uses PNG for 256 px and BMP below, which is what Windows' own icons do.
//
// Contract / key decisions:
// - All integers little-endian, read/written byte by byte (no DataView): works on any Uint8Array view, including
//   subarrays with a non-zero byteOffset, and keeps the hot loops monomorphic.
// - Encoder is strict (throws on out-of-range sizes: a silently clamped icon is a wrong icon). Decoder is lenient per
//   entry (a broken entry is skipped, the rest survive): real-world .ico files from old tools are often half-broken.
// - Decoder caps bitmaps at 4096 px a side: a hostile header must not allocate gigabytes (W*H*4 bytes).

import { encodePNG } from '../png/encode.js';
import { decodePNG } from '../png/decode.js';

export const ICO_MIME = 'image/vnd.microsoft.icon';
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Little-endian readers. u32 ends with >>> 0 (unsigned: sizes, offsets); i32 keeps the sign (BMP height is signed:
// negative means top-down rows). `<< 24` alone yields a negative int32 for a top byte >= 0x80, hence the split.
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
function put16(b, o, v) { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; }
function put32(b, o, v) { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; }

/** One entry as a 32-bit BMP (BITMAPINFOHEADER, bottom-up BGRA, then the 1-bit AND mask: 1 where alpha is 0). */
export function encodeBMPEntry(img) {
  const { width: W, height: H, data } = img;
  // BMP rows are padded to 4 bytes: 1 bit per pixel -> ceil(W/32) dwords. BGRA rows at 32 bpp are always aligned.
  // Header height is H*2: the ICO convention counts XOR (colour) + AND (mask) planes together; readers halve it.
  // The mask is written although alpha makes it redundant: pre-XP shells and some readers only honour the mask.
  const maskStride = ((W + 31) >> 5) << 2;
  const out = new Uint8Array(40 + W * H * 4 + maskStride * H);
  put32(out, 0, 40); put32(out, 4, W); put32(out, 8, H * 2); put16(out, 12, 1); put16(out, 14, 32);
  put32(out, 20, W * H * 4 + maskStride * H);
  let p = 40;
  for (let y = H - 1; y >= 0; y--) {
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4;
      out[p++] = data[s + 2]; out[p++] = data[s + 1]; out[p++] = data[s]; out[p++] = data[s + 3];
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = 0; x < W; x++) if (!data[(y * W + x) * 4 + 3]) out[p + (x >> 3)] |= 0x80 >> (x & 7);
    p += maskStride;
  }
  return out;
}

/**
 * images: RGBA images (any order; sorted by size, one per size). opts.png: 'auto' (PNG for 256 px) | 'all' | 'none';
 * opts.level: PNG compression level. Returns the .ico bytes.
 */
export function encodeICO(images, { png = 'auto', level = 9 } = {}) {
  // Largest first, the order Windows' own resources use; shells scan the directory for the best match anyway.
  const list = [...images].filter(Boolean).sort((a, b) => b.width - a.width || b.height - a.height);
  if (!list.length) throw new Error('ico: no images');
  if (list.length > 0xffff) throw new Error('ico: too many images');
  const blobs = list.map((img) => {
    if (!(img.width >= 1 && img.width <= 256 && img.height >= 1 && img.height <= 256)) throw new Error(`ico: ${img.width}x${img.height} is outside 1..256`);
    const asPNG = png === 'all' || (png === 'auto' && (img.width >= 256 || img.height >= 256));
    return asPNG ? encodePNG(img, { level }) : encodeBMPEntry(img);
  });
  // ICONDIR (6 bytes: reserved 0, type 1 = icon, count) + one 16-byte ICONDIRENTRY per image, then the blobs.
  const head = 6 + 16 * list.length;
  const out = new Uint8Array(head + blobs.reduce((n, b) => n + b.length, 0));
  put16(out, 2, 1); put16(out, 4, list.length);
  let off = head;
  list.forEach((img, i) => {
    const e = 6 + 16 * i;
    out[e] = img.width & 255; out[e + 1] = img.height & 255;   // 0 means 256
    put16(out, e + 4, 1); put16(out, e + 6, 32);
    put32(out, e + 8, blobs[i].length); put32(out, e + 12, off);
    out.set(blobs[i], off);
    off += blobs[i].length;
  });
  return out;
}

const isPNG = (b, o) => b[o] === 0x89 && b[o + 1] === 0x50 && b[o + 2] === 0x4e && b[o + 3] === 0x47;

// Reads one DIB entry of any classic depth (1/4/8 palette, 16 = 5-5-5, 24, 32). Header height is doubled (XOR+AND),
// hence `>> 1`. Only BI_RGB (0) and BI_BITFIELDS (3) are accepted: RLE inside icons is practically nonexistent.
// KNOWN DEFECT: BITFIELDS masks are skipped, not read, so a 16-bit 5-6-5 entry decodes with wrong colours through
// the 5-5-5 path. Fix: read the three masks and derive shift/width per channel from them.
function decodeBMPEntry(b, o, len) {
  const hs = u32(b, o);
  const W = Math.abs(i32(b, o + 4)), H2 = i32(b, o + 8), bpp = u16(b, o + 14), comp = u32(b, o + 16);
  const H = Math.abs(H2) >> 1, bottomUp = H2 > 0;
  if (!W || !H || W > 4096 || H > 4096) throw new Error('ico: bad bitmap size');
  if (comp !== 0 && comp !== 3) throw new Error('ico: compressed bitmaps are not supported');
  let used = u32(b, o + 32);
  const pal = [];
  let p = o + hs;
  if (bpp <= 8) {
    used = used || 1 << bpp;
    for (let i = 0; i < used; i++, p += 4) pal.push([b[p + 2], b[p + 1], b[p]]);
  } else if (comp === 3) p += hs >= 52 ? 0 : 12;   // BITFIELDS masks after a 40-byte header (assumed standard order)
  const stride = ((W * bpp + 31) >> 5) << 2;
  const maskStride = ((W + 31) >> 5) << 2;
  const xorEnd = p + stride * H;
  // +4 slack: some writers under-report the entry size by the final row padding; the bytes are still in the buffer.
  if (xorEnd > o + len + 4) throw new Error('ico: truncated bitmap');
  const data = new Uint8ClampedArray(W * H * 4);
  let anyAlpha = false;
  for (let row = 0; row < H; row++) {
    const y = bottomUp ? H - 1 - row : row;
    const r = p + row * stride;
    for (let x = 0; x < W; x++) {
      const d = (y * W + x) * 4;
      if (bpp === 32) { data[d] = b[r + x * 4 + 2]; data[d + 1] = b[r + x * 4 + 1]; data[d + 2] = b[r + x * 4]; data[d + 3] = b[r + x * 4 + 3]; if (data[d + 3]) anyAlpha = true; }
      else if (bpp === 24) { data[d] = b[r + x * 3 + 2]; data[d + 1] = b[r + x * 3 + 1]; data[d + 2] = b[r + x * 3]; data[d + 3] = 255; }
      else if (bpp === 16) { const v = u16(b, r + x * 2); data[d] = ((v >> 10) & 31) * 255 / 31; data[d + 1] = ((v >> 5) & 31) * 255 / 31; data[d + 2] = (v & 31) * 255 / 31; data[d + 3] = 255; }
      else {
        const bit = x * bpp;
        const idx = (b[r + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const c = pal[idx] || [0, 0, 0];
        data[d] = c[0]; data[d + 1] = c[1]; data[d + 2] = c[2]; data[d + 3] = 255;
      }
    }
  }
  // 32-bit entries with no alpha at all (old writers) and every other depth take transparency from the AND mask.
  // Mask rows are bounded by the file length, not the entry size: a truncated mask degrades to opaque, not a throw.
  if (bpp < 32 || !anyAlpha) {
    for (let row = 0; row < H && xorEnd + (row + 1) * maskStride <= b.length; row++) {
      const y = bottomUp ? H - 1 - row : row;
      const r = xorEnd + row * maskStride;
      for (let x = 0; x < W; x++) data[(y * W + x) * 4 + 3] = (b[r + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
    }
  }
  return { width: W, height: H, data, bpp };
}

/** Directory of an .ico / .cur file without decoding the images: [{ width, height, bpp, size, offset, png }]. */
// Type 1 = icon, 2 = cursor (.cur shares the layout; entry bytes 4..7 are then the hotspot, reported as-is in bpp).
// Width/height byte 0 means 256 (one byte cannot hold it). Entries whose data lies outside the file are dropped.
export function icoInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 6 || u16(b, 0) !== 0 || (u16(b, 2) !== 1 && u16(b, 2) !== 2)) throw new Error('ico: not an icon file');
  const n = u16(b, 4);
  if (6 + 16 * n > b.length) throw new Error('ico: truncated directory');
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i;
    const size = u32(b, e + 8), offset = u32(b, e + 12);
    if (offset + Math.min(size, 8) > b.length) continue;
    out.push({ width: b[e] || 256, height: b[e + 1] || 256, bpp: u16(b, e + 6), size, offset, png: isPNG(b, offset) });
  }
  return out;
}

/** Every image of an .ico file: [{ width, height, data, bpp, png }], largest first; broken entries are skipped. */
export function decodeICO(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = [];
  for (const e of icoInfo(b)) {
    try {
      if (e.png) {
        const img = decodePNG(b.subarray(e.offset, e.offset + e.size));
        // View, not copy: reinterpret the decoder's bytes as clamped RGBA (ImageData-compatible) at zero cost.
        out.push({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.width * img.height * 4), bpp: 32, png: true });
      } else out.push({ ...decodeBMPEntry(b, e.offset, e.size), png: false });
    } catch { /* skipped */ }
  }
  return out.sort((a, c) => c.width * c.height - a.width * a.height || c.bpp - a.bpp);
}
