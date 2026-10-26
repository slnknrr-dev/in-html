// png/encode.js - PNG encoder: RGBA input (8-bit Uint8Array / Uint8ClampedArray, or 16-bit Uint16Array) to the
// smallest lossless colour type (palette 1/2/4/8, gray 1-8 with tRNS, gray-alpha, RGB with tRNS, RGBA), per-row
// adaptive filters, zlib through the synchronous codec/zlib.js; optional lossy PNG-8 (quantize.js) with dithering,
// Adam7 interlacing, colour / physical / text / time chunks.
//
//   encodePNG({ width, height, data }, opts) -> Uint8Array
//   opts: level 0-9 (6)   filter 'adaptive' | 'none' | 'sub' | 'up' | 'average' | 'paeth'
//         colorType 'auto' | 'rgba' | 'rgb' | 'gray' | 'gray-alpha' | 'palette'
//         colors 0 | 2-256 (quantize to a palette when the image has more colours)   quantizer 'mediancut' | 'octree'
//         dither 0..1 | boolean   depth16 (keep 16-bit samples of Uint16Array input; default true)
//         interlace false   srgb intent name | true   gamma number   iccp { name, profile }   chrm
//         phys { x, y, unit: 'meter' } | { dpi }   time Date   text [{ keyword, text, compress, utf8, lang }] | { k: v }
//         chunks [{ type, data, after: 'IHDR' | 'PLTE' | 'IDAT' }] extra chunks
//   analyzePNG(image) -> { opaque, gray, binaryAlpha, colors (<= 257, 257 = more), grayDepth } (what 'auto' sees)
//
// Lossless by default: 'auto' picks the smallest colour type that represents every pixel exactly (palette when <= 256
// colours, gray when R = G = B, tRNS key instead of an alpha channel when alpha is only 0 / 255). Lossy reduction
// happens only when `colors` asks for it.

import { zlibSync } from '../codec/zlib.js';
import { makeChunk, PNG_SIGNATURE, textChunk } from './chunks.js';
import { ADAM7 } from './decode.js';
import { quantize } from './quantize.js';

const FILTERS = { none: 0, sub: 1, up: 2, average: 3, paeth: 4 };
const INTENTS = { perceptual: 0, relative: 1, saturation: 2, absolute: 3 };

const be32 = (v) => new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);

// Smallest gray depth that represents every gray value exactly (v = k * 255 / (2^d - 1)).
function grayDepthOf(seen) {
  let d = 1;
  for (let v = 0; v < 256; v++) {
    if (!seen[v]) continue;
    if (d < 8 && v % 17) d = 8;
    else if (d < 4 && v % 85) d = 4;
    else if (d < 2 && v !== 0 && v !== 255) d = 2;
  }
  return d;
}

/** Colour statistics of 8-bit RGBA pixels (used by colorType 'auto'). */
export function analyzePNG({ data }) {
  let opaque = true, gray = true, binaryAlpha = true;
  const grays = new Uint8Array(256);
  const map = new Map();
  let last = -1, many = false;
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2], a = data[p + 3];
    if (a !== 255) { opaque = false; if (a !== 0) binaryAlpha = false; }
    if (r !== g || g !== b) { if (a !== 0) gray = false; } else if (a !== 0) grays[r] = 1;
    if (!many) {
      // fully transparent pixels count as one colour (their RGB is invisible)
      const key = a === 0 ? 0 : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
      if (key !== last) {
        last = key;
        if (!map.has(key)) { map.set(key, map.size); if (map.size > 256) many = true; }
      }
    }
  }
  return { opaque, gray, binaryAlpha, colors: many ? 257 : map.size, colorMap: many ? null : map, grayDepth: grayDepthOf(grays), grays };
}

// --- filtering ---------------------------------------------------------------------------------------------

// Filters `row` (raw bytes) against `prev` (a zero row above the first) into out[o + 1 ..] with the filter byte at
// out[o]; returns the sum of the filtered bytes taken as signed magnitudes (libpng's minimum-sum heuristic).
// Cost = sum of filtered bytes as signed magnitudes: residuals near 0 (or near 256, i.e. small negatives) compress
// best, so the filter with the smallest sum is a good cheap predictor of deflate size (libpng's heuristic).
function filterRow(type, row, prev, bpp, out, o) {
  const n = row.length;
  out[o++] = type;
  let s = 0, v = 0, i = 0;
  switch (type) {
    case 0: out.set(row, o); for (; i < n; i++) { v = row[i]; s += v < 128 ? v : 256 - v; } return s;
    case 1:
      for (; i < bpp; i++) { out[o + i] = v = row[i]; s += v < 128 ? v : 256 - v; }
      for (; i < n; i++) { out[o + i] = v = (row[i] - row[i - bpp]) & 255; s += v < 128 ? v : 256 - v; }
      return s;
    case 2: for (; i < n; i++) { out[o + i] = v = (row[i] - prev[i]) & 255; s += v < 128 ? v : 256 - v; } return s;
    case 3:
      for (; i < bpp; i++) { out[o + i] = v = (row[i] - (prev[i] >> 1)) & 255; s += v < 128 ? v : 256 - v; }
      for (; i < n; i++) { out[o + i] = v = (row[i] - ((row[i - bpp] + prev[i]) >> 1)) & 255; s += v < 128 ? v : 256 - v; }
      return s;
    case 4:
      for (; i < bpp; i++) { out[o + i] = v = (row[i] - prev[i]) & 255; s += v < 128 ? v : 256 - v; }
      for (; i < n; i++) {
        const a = row[i - bpp], b = prev[i], c = prev[i - bpp];
        const pa = b > c ? b - c : c - b, pb = a > c ? a - c : c - a, pcx = a + b - c - c, pc = pcx < 0 ? -pcx : pcx;
        out[o + i] = v = (row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        s += v < 128 ? v : 256 - v;
      }
      return s;
    default: throw new Error('bad filter');
  }
}

// --- row packing -----------------------------------------------------------------------------------------

// Returns pack(y, x0, dx, count, row) writing one raw scanline of the target format into `row`.
function rowPacker(fmt, data, width) {
  const { type, depth, index, key } = fmt;
  if (type === 3) {
    return (y, x0, dx, count, row) => {
      if (depth === 8) { for (let x = 0, s = y * width + x0; x < count; x++, s += dx) row[x] = index(s); return; }
      row.fill(0);
      const per = 8 / depth;
      for (let x = 0, s = y * width + x0; x < count; x++, s += dx) row[(x / per) | 0] |= index(s) << (8 - depth - (x % per) * depth);
    };
  }
  if (depth === 16) {
    const ch = type === 0 ? 1 : type === 2 ? 3 : type === 4 ? 2 : 4;
    return (y, x0, dx, count, row) => {
      for (let x = 0, p = (y * width + x0) * 4, o = 0; x < count; x++, p += dx * 4) {
        const a = data[p + 3];
        const vals = ch === 1 ? [data[p]] : ch === 2 ? [data[p], a] : ch === 3 ? [data[p], data[p + 1], data[p + 2]] : [data[p], data[p + 1], data[p + 2], a];
        if (key && a === 0) { vals[0] = key[0]; if (ch === 3) { vals[1] = key[1]; vals[2] = key[2]; } }
        for (const v of vals) { row[o++] = v >> 8; row[o++] = v & 255; }
      }
    };
  }
  if (type === 0) {
    if (depth === 8) {
      return (y, x0, dx, count, row) => {
        for (let x = 0, p = (y * width + x0) * 4; x < count; x++, p += dx * 4) row[x] = key && data[p + 3] === 0 ? key[0] : data[p];
      };
    }
    const per = 8 / depth, sh = 8 - depth;
    return (y, x0, dx, count, row) => {
      row.fill(0);
      for (let x = 0, p = (y * width + x0) * 4; x < count; x++, p += dx * 4) {
        const v = (key && data[p + 3] === 0 ? key[0] : data[p]) >> sh;
        row[(x / per) | 0] |= v << (8 - depth - (x % per) * depth);
      }
    };
  }
  if (type === 4) return (y, x0, dx, count, row) => { for (let x = 0, p = (y * width + x0) * 4, o = 0; x < count; x++, p += dx * 4, o += 2) { row[o] = data[p]; row[o + 1] = data[p + 3]; } };
  if (type === 2) {
    return (y, x0, dx, count, row) => {
      for (let x = 0, p = (y * width + x0) * 4, o = 0; x < count; x++, p += dx * 4, o += 3) {
        if (key && data[p + 3] === 0) { row[o] = key[0]; row[o + 1] = key[1]; row[o + 2] = key[2]; } else { row[o] = data[p]; row[o + 1] = data[p + 1]; row[o + 2] = data[p + 2]; }
      }
    };
  }
  return (y, x0, dx, count, row) => {
    if (dx === 1) { row.set(data.subarray((y * width + x0) * 4, (y * width + x0 + count) * 4)); return; }
    for (let x = 0, p = (y * width + x0) * 4, o = 0; x < count; x++, p += dx * 4, o += 4) { row[o] = data[p]; row[o + 1] = data[p + 1]; row[o + 2] = data[p + 2]; row[o + 3] = data[p + 3]; }
  };
}

// A colour that no opaque pixel uses (tRNS key for binary transparency in RGB images), or null.
// A 2^24-bit bitmap (2 MB) of used RGB values; a few likely-unused candidates are tried first, then a coarse prime
// stride sweep. Returns null only if every probed colour is used, and the encoder then falls back to an alpha channel.
function freeColor(data) {
  const used = new Uint32Array(1 << 19);
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) continue;
    const c = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
    used[c >>> 5] |= 1 << (c & 31);
  }
  for (const c of [0x000000, 0xffffff, 0xff00ff, 0x00ff00, 0x010203]) if (!(used[c >>> 5] & (1 << (c & 31)))) return [c >> 16, (c >> 8) & 255, c & 255];
  for (let c = 0; c < 1 << 24; c += 7919) if (!(used[c >>> 5] & (1 << (c & 31)))) return [c >> 16, (c >> 8) & 255, c & 255];
  return null;
}

// --- format choice ----------------------------------------------------------------------------------------

const PAL_DEPTH = (n) => (n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8);

function chooseFormat(img, opts) {
  const { data, width, height } = img;
  const forced = opts.colorType || 'auto';
  const st = analyzePNG(img);
  const wantColors = Math.max(0, Math.min(256, opts.colors | 0));
  // Lossy palette: quantize when there are more colours than allowed.
  if ((wantColors >= 2 && st.colors > wantColors) || (forced === 'palette' && st.colors > 256)) {
    const q = quantize(data, width, height, { colors: wantColors >= 2 ? wantColors : 256, method: opts.quantizer || 'mediancut', dither: opts.dither || 0 });
    const order = paletteOrder(q.palette);
    const pal = new Uint8Array(q.palette.length);
    const remap = new Uint8Array(order.length);
    order.forEach((old, i) => { pal.set(q.palette.subarray(old * 4, old * 4 + 4), i * 4); remap[old] = i; });
    const idx = q.indices;
    return { type: 3, depth: PAL_DEPTH(order.length), palette: pal, index: (s) => remap[idx[s]], lossy: true };
  }
  const palOk = st.colors <= 256 && forced !== 'rgb' && forced !== 'rgba' && forced !== 'gray' && forced !== 'gray-alpha';
  const paletteFmt = () => {
    const pal = new Uint8Array(st.colors * 4);
    const entries = [...st.colorMap.keys()];
    const colorsArr = entries.map((k) => [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255]);
    const order = paletteOrder(Uint8Array.from(colorsArr.flat()));
    const slot = new Map();
    order.forEach((old, i) => { pal.set(colorsArr[old], i * 4); slot.set(entries[old], i); });
    let lastKey = -1, lastIdx = 0;
    const index = (s) => {
      const p = s * 4;
      const a = data[p + 3];
      const k = a === 0 ? 0 : (((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | a) >>> 0);
      if (k !== lastKey) { lastKey = k; lastIdx = slot.get(k); }
      return lastIdx;
    };
    return { type: 3, depth: PAL_DEPTH(st.colors), palette: pal, index };
  };
  if (forced === 'palette') return paletteFmt();
  // Binary transparency can use a tRNS key colour when an unused key exists.
  let key = null, keyDepth = 1;
  const wantAlpha = forced === 'rgba' || forced === 'gray-alpha';
  if (!st.opaque && st.binaryAlpha && !wantAlpha) {
    if (st.gray) {
      // smallest depth that has an unused gray level for the key
      for (let d = st.grayDepth; d <= 8 && !key; d *= 2) {
        const step = 255 / ((1 << d) - 1);
        for (let v = 0; v < 256; v += step) if (!st.grays[v]) { key = [v, v, v]; keyDepth = d; break; }
      }
    } else key = freeColor(data);
  }
  if ((st.gray && forced === 'auto') || forced === 'gray' || forced === 'gray-alpha') {
    if (forced === 'gray-alpha' || (!st.opaque && !key)) return { type: 4, depth: 8 };
    const depth = key ? Math.max(st.grayDepth, keyDepth) : st.grayDepth;
    if (forced === 'auto' && palOk && PAL_DEPTH(st.colors) < depth) return paletteFmt();
    return { type: 0, depth, key: st.opaque ? null : key };
  }
  if (forced === 'auto' && palOk) return paletteFmt();
  if (forced === 'rgba' || (!st.opaque && !key)) return { type: 6, depth: 8 };
  return { type: 2, depth: 8, key: st.opaque ? null : key };
}

// Translucent entries first (shorter tRNS), then the rest in their order.
function paletteOrder(pal) {
  const n = pal.length >> 2;
  const idx = Array.from({ length: n }, (_, i) => i);
  return idx.filter((i) => pal[i * 4 + 3] !== 255).concat(idx.filter((i) => pal[i * 4 + 3] === 255));
}

function format16(img, opts) {
  const { data } = img;
  let opaque = true, gray = true, binary = true;
  for (let p = 0; p < data.length; p += 4) {
    const a = data[p + 3];
    if (a !== 65535) { opaque = false; if (a !== 0) binary = false; }
    if (a !== 0 && (data[p] !== data[p + 1] || data[p + 1] !== data[p + 2])) gray = false;
  }
  const f = opts.colorType || 'auto';
  if (f === 'rgba') return { type: 6, depth: 16 };
  if (f === 'gray-alpha') return { type: 4, depth: 16 };
  if (f === 'gray' || (f === 'auto' && gray)) return opaque ? { type: 0, depth: 16 } : { type: 4, depth: 16 };
  if (f === 'rgb' && opaque) return { type: 2, depth: 16 };
  void binary;
  return opaque ? { type: 2, depth: 16 } : { type: 6, depth: 16 };
}

// --- ancillary chunks -------------------------------------------------------------------------------------

function ancillary(opts, where) {
  const out = [];
  if (where === 'IHDR') {
    if (opts.iccp && opts.iccp.profile) {
      const name = String(opts.iccp.name || 'ICC profile').replace(/[^\x20-\x7e]/g, '').slice(0, 79) || 'ICC profile';
      const z = zlibSync(opts.iccp.profile, { level: 9 });
      const d = new Uint8Array(name.length + 2 + z.length);
      for (let i = 0; i < name.length; i++) d[i] = name.charCodeAt(i);
      d.set(z, name.length + 2);
      out.push({ type: 'iCCP', data: d });
    } else if (opts.srgb) {
      out.push({ type: 'sRGB', data: new Uint8Array([INTENTS[opts.srgb] ?? 0]) });
    }
    if (opts.gamma || opts.srgb) out.push({ type: 'gAMA', data: be32(Math.round((opts.gamma || 1 / 2.2) * 100000)) });
    if (opts.chrm) {
      const c = opts.chrm, v = [c.white, c.red, c.green, c.blue].flat();
      const d = new Uint8Array(32);
      v.forEach((x, i) => d.set(be32(Math.round(x * 100000)), i * 4));
      out.push({ type: 'cHRM', data: d });
    }
  }
  if (where === 'PLTE') {
    if (opts.phys) {
      const ppm = opts.phys.dpi ? [Math.round(opts.phys.dpi / 0.0254), Math.round((opts.phys.dpiY || opts.phys.dpi) / 0.0254)] : [opts.phys.x, opts.phys.y];
      const d = new Uint8Array(9);
      d.set(be32(ppm[0] >>> 0), 0); d.set(be32(ppm[1] >>> 0), 4); d[8] = opts.phys.dpi || opts.phys.unit === 'meter' ? 1 : 0;
      out.push({ type: 'pHYs', data: d });
    }
    if (opts.time instanceof Date && !isNaN(opts.time)) {
      const t = opts.time;
      out.push({ type: 'tIME', data: new Uint8Array([t.getUTCFullYear() >> 8, t.getUTCFullYear() & 255, t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()]) });
    }
    const text = Array.isArray(opts.text) ? opts.text : Object.entries(opts.text || {}).map(([keyword, text]) => ({ keyword, text }));
    for (const e of text) out.push(textChunk(e.keyword, e.text, e));
  }
  for (const c of opts.chunks || []) if ((c.after || 'PLTE') === where) out.push({ type: c.type, data: c.data });
  return out;
}

/** Encodes RGBA pixels as PNG (see the header for options). */
export function encodePNG(image, opts = {}) {
  const { width, height } = image;
  let data = image.data;
  if (!(width > 0 && height > 0) || !data || data.length < width * height * 4) throw new Error('encodePNG: bad image');
  let fmt;
  if (data instanceof Uint16Array) {
    if (opts.depth16 === false || opts.colors) {
      const d8 = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) d8[i] = data[i] >> 8;
      data = d8;
    } else fmt = format16({ width, height, data }, opts);
  }
  if (!fmt && /^gray/.test(opts.colorType || '')) {
    // forced gray of a colour image: Rec. 601 luma
    const d = new Uint8Array(data.length);
    for (let p = 0; p < data.length; p += 4) { d[p] = d[p + 1] = d[p + 2] = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]); d[p + 3] = data[p + 3]; }
    data = d;
  }
  if (!fmt) fmt = chooseFormat({ width, height, data }, opts);
  const { type, depth } = fmt;
  const ch = type === 0 || type === 3 ? 1 : type === 4 ? 2 : type === 2 ? 3 : 4;
  const bitsPP = ch * depth, bpp = Math.max(1, bitsPP >> 3);
  const pack = rowPacker(fmt, data, width);
  const filt = opts.filter == null ? 'adaptive' : opts.filter;
  const fixed = typeof filt === 'number' ? filt : FILTERS[filt];
  const adaptive = fixed == null;
  // Palette and sub-byte images compress best unfiltered (PNG spec recommendation).
  // Palette indices are not numerically related, so prediction does not help them.
  const noFilter = type === 3 || depth < 8;
  const passes = opts.interlace ? ADAM7 : [[0, 0, 1, 1]];
  let total = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw > 0 && ph > 0) total += ph * (1 + Math.ceil((pw * bitsPP) / 8));
  }
  const raw = new Uint8Array(total);
  let o = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPP) / 8);
    let row = new Uint8Array(stride), prev = new Uint8Array(stride);
    let trial = adaptive && !noFilter ? new Uint8Array(stride + 1) : null, best = trial && new Uint8Array(stride + 1);
    const one = noFilter && !(fixed > 0 && opts.forceFilter) ? 0 : (fixed ?? 0);
    for (let y = 0; y < ph; y++) {
      pack(y0 + y * dy, x0, dx, pw, row);
      if (trial) {
        let bestCost = Infinity;
          // Try all five filters per row and keep the cheapest; trial / best buffers are swapped, not copied.
        for (let f = 0; f < 5; f++) {
          const c = filterRow(f, row, prev, bpp, trial, 0);
          if (c < bestCost) { bestCost = c; const t = best; best = trial; trial = t; }
        }
        raw.set(best, o);
      } else filterRow(one, row, prev, bpp, raw, o);
      o += stride + 1;
      const t = prev; prev = row; row = t;
    }
  }
  const z = zlibSync(raw, { level: opts.level ?? 6 });
  // Chunks
  const ihdr = new Uint8Array(13);
  ihdr.set(be32(width), 0); ihdr.set(be32(height), 4);
  ihdr[8] = depth; ihdr[9] = type; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = opts.interlace ? 1 : 0;
  const chunks = [{ type: 'IHDR', data: ihdr }, ...ancillary(opts, 'IHDR')];
  if (type === 3) {
    const n = fmt.palette.length >> 2;
    const plte = new Uint8Array(n * 3);
    let lastT = -1;
    for (let i = 0; i < n; i++) {
      plte[i * 3] = fmt.palette[i * 4]; plte[i * 3 + 1] = fmt.palette[i * 4 + 1]; plte[i * 3 + 2] = fmt.palette[i * 4 + 2];
      if (fmt.palette[i * 4 + 3] !== 255) lastT = i;
    }
    chunks.push({ type: 'PLTE', data: plte });
    if (lastT >= 0) { const t = new Uint8Array(lastT + 1); for (let i = 0; i <= lastT; i++) t[i] = fmt.palette[i * 4 + 3]; chunks.push({ type: 'tRNS', data: t }); }
  } else if (fmt.key) {
    const k = depth === 16 ? fmt.key : fmt.key.map((v) => (depth < 8 ? v >> (8 - depth) : v));
    chunks.push({ type: 'tRNS', data: type === 0 ? new Uint8Array([k[0] >> 8, k[0] & 255]) : new Uint8Array([k[0] >> 8, k[0] & 255, k[1] >> 8, k[1] & 255, k[2] >> 8, k[2] & 255]) });
  }
  chunks.push(...ancillary(opts, 'PLTE'));
  const IDAT_MAX = 1 << 20;
  for (let p = 0; p < z.length || p === 0; p += IDAT_MAX) chunks.push({ type: 'IDAT', data: z.subarray(p, Math.min(z.length, p + IDAT_MAX)) });
  chunks.push(...ancillary(opts, 'IDAT'));
  chunks.push({ type: 'IEND', data: new Uint8Array(0) });
  const parts = chunks.map((c) => makeChunk(c.type, c.data));
  const out = new Uint8Array(8 + parts.reduce((a, b) => a + b.length, 0));
  out.set(PNG_SIGNATURE);
  let q = 8;
  for (const p of parts) { out.set(p, q); q += p.length; }
  return out;
}
