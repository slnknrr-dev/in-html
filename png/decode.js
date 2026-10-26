// png/decode.js - PNG decoder: every colour type and bit depth (1/2/4/8/16), palette + tRNS, Adam7 interlacing,
// to RGBA 8-bit (Uint8ClampedArray) or 16-bit (Uint16Array, `depth16`). Colour chunks (gAMA, sRGB, iCCP, cHRM,
// sBIT), pHYs, text (tEXt / zTXt / iTXt), tIME, bKGD, eXIf and APNG info are read into `info`; pixels are not
// colour-managed. 16-bit samples become 8-bit by their high byte (as browsers do).
//
//   decodePNG(bytes, { depth16 = false, crc = false, maxPixels }) -> { width, height, depth, data, info }
//   pngInfo(bytes) -> info without decoding the pixels (header, colour, text, physical size, animation)

import { unzlibSync } from '../codec/zlib.js';
import { apngInfo, parseTextChunk, readChunks } from './chunks.js';

export const COLOR_TYPES = { 0: 'gray', 2: 'rgb', 3: 'palette', 4: 'gray-alpha', 6: 'rgba' };
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
// Adam7: [x0, y0, dx, dy] per pass.
export const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

const rd32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const rd16 = (b, p) => (b[p] << 8) | b[p + 1];
const latin1 = (b) => String.fromCharCode.apply(null, b);

function parseHeader(chunks) {
  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== 'IHDR' || ihdr.data.length < 13) throw new Error('PNG: missing IHDR');
  const d = ihdr.data;
  const h = { width: rd32(d, 0), height: rd32(d, 4), bitDepth: d[8], colorType: d[9], compression: d[10], filter: d[11], interlace: d[12] };
  if (!h.width || !h.height) throw new Error('PNG: empty image');
  if (!DEPTHS[h.colorType] || !DEPTHS[h.colorType].includes(h.bitDepth)) throw new Error(`PNG: invalid colour type ${h.colorType} / bit depth ${h.bitDepth}`);
  if (h.compression !== 0 || h.filter !== 0 || h.interlace > 1) throw new Error('PNG: unsupported compression, filter or interlace method');
  return h;
}

// Ancillary chunks -> info (malformed ancillary chunks are skipped, as decoders are expected to).
function readInfo(chunks, h) {
  const info = {
    width: h.width, height: h.height, bitDepth: h.bitDepth, colorType: h.colorType, colorTypeName: COLOR_TYPES[h.colorType],
    interlaced: h.interlace === 1, palette: null, transparency: null, gamma: null, srgb: null, iccp: null, chrm: null, sbit: null,
    phys: null, text: [], time: null, background: null, exif: null, animation: null, chunks: chunks.map((c) => c.type),
  };
  const intents = ['perceptual', 'relative', 'saturation', 'absolute'];
  for (const c of chunks) {
    const d = c.data;
    try {
      switch (c.type) {
        case 'PLTE':
          if (d.length % 3 || !d.length) throw new Error('PNG: bad palette');
          info.palette = new Uint8Array(d);
          break;
        case 'tRNS':
          if (h.colorType === 3) info.transparency = { alpha: new Uint8Array(d) };
          else if (h.colorType === 0 && d.length >= 2) info.transparency = { gray: rd16(d, 0) };
          else if (h.colorType === 2 && d.length >= 6) info.transparency = { rgb: [rd16(d, 0), rd16(d, 2), rd16(d, 4)] };
          break;
        case 'gAMA': if (d.length >= 4) info.gamma = rd32(d, 0) / 100000; break;
        case 'sRGB': if (d.length >= 1) info.srgb = intents[d[0]] || String(d[0]); break;
        case 'iCCP': {
          const z = d.indexOf(0);
          if (z > 0) {
            const name = latin1(d.subarray(0, z));
            let profile = null;
            try { profile = unzlibSync(d.subarray(z + 2)); } catch { profile = null; }
            info.iccp = { name, profile, size: profile ? profile.length : 0 };
          }
          break;
        }
        case 'cHRM': if (d.length >= 32) { const v = []; for (let i = 0; i < 8; i++) v.push(rd32(d, i * 4) / 100000); info.chrm = { white: [v[0], v[1]], red: [v[2], v[3]], green: [v[4], v[5]], blue: [v[6], v[7]] }; } break;
        case 'sBIT': info.sbit = Array.from(d); break;
        case 'pHYs': if (d.length >= 9) info.phys = { x: rd32(d, 0), y: rd32(d, 4), unit: d[8] === 1 ? 'meter' : 'unknown', dpi: d[8] === 1 ? [Math.round(rd32(d, 0) * 0.0254), Math.round(rd32(d, 4) * 0.0254)] : null }; break;
        case 'tEXt': case 'zTXt': case 'iTXt': { const e = parseTextChunk(c.type, d); if (e) info.text.push(e); break; }
        case 'tIME': if (d.length >= 7) info.time = new Date(Date.UTC(rd16(d, 0), d[2] - 1, d[3], d[4], d[5], d[6])); break;
        case 'bKGD': info.background = Array.from(d.length === 1 ? [d[0]] : d.length === 2 ? [rd16(d, 0)] : [rd16(d, 0), rd16(d, 2), rd16(d, 4)]); break;
        case 'eXIf': info.exif = new Uint8Array(d); break;
        default: break;
      }
    } catch (e) {
      if (c.type === 'PLTE') throw e;
    }
  }
  info.animation = apngInfo(chunks);
  return info;
}

/** Header, colour, text and animation info without decoding pixels. */
export function pngInfo(bytes) {
  const chunks = readChunks(bytes);
  return readInfo(chunks, parseHeader(chunks));
}

// --- unfiltering -------------------------------------------------------------------------------------

// Reverses the filter of one scanline in place (`cur` excludes the filter byte; `prev` is null for the first row).
// Filters predict each byte from left (a), up (b) and upper-left (c), counted in whole bytes (bpp >= 1, even for
// sub-byte pixels). Missing neighbours on the first row are zero, which the `prev` null branches implement.
// Paeth picks whichever of a, b, c is closest to a + b - c, ties resolved a, then b, then c, exactly as specified.
function unfilterRow(type, cur, prev, bpp) {
  const n = cur.length;
  switch (type) {
    case 0: return;
    case 1: for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255; return;
    case 2: if (prev) for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 255; return;
    case 3:
      if (prev) {
        for (let i = 0; i < bpp; i++) cur[i] = (cur[i] + (prev[i] >> 1)) & 255;
        for (let i = bpp; i < n; i++) cur[i] = (cur[i] + ((cur[i - bpp] + prev[i]) >> 1)) & 255;
      } else for (let i = bpp; i < n; i++) cur[i] = (cur[i] + (cur[i - bpp] >> 1)) & 255;
      return;
    case 4:
      if (!prev) { for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255; return; }
      for (let i = 0; i < bpp; i++) cur[i] = (cur[i] + prev[i]) & 255;
      for (let i = bpp; i < n; i++) {
        const a = cur[i - bpp], b = prev[i], c = prev[i - bpp];
        const p = a + b - c;
        const pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      return;
    default: throw new Error('PNG: bad filter type ' + type);
  }
}

// --- pixel conversion ----------------------------------------------------------------------------------

/**
 * Builds a converter of unfiltered scanlines to RGBA for the header + palette / transparency.
 * Returns (row, count, out, outIndex, step) writing `count` pixels to out at outIndex, outIndex + step, ...
 */
// One specialised closure per format instead of a per-pixel switch: the branch is taken once per image, the inner
// loops stay monomorphic. Sub-byte samples are unpacked MSB first; tRNS keys are compared against the raw sample
// value (before scaling), as the spec defines.
function rowConverter(h, info, wide) {
  const { bitDepth: bd, colorType: ct } = h;
  const max = wide ? 65535 : 255;
  const tr = info.transparency;
  if (ct === 3) {
    const pal = info.palette;
    if (!pal) throw new Error('PNG: palette image without PLTE');
    const n = pal.length / 3;
    // Out-of-range palette indices are an error per spec; browsers render them black, which is followed here rather
    // than rejecting the whole image.
    const lut = new Uint16Array(256 * 4); // entries past the palette decode as opaque black
    for (let i = 0; i < 256; i++) {
      const s = wide ? 257 : 1;
      if (i < n) { lut[i * 4] = pal[i * 3] * s; lut[i * 4 + 1] = pal[i * 3 + 1] * s; lut[i * 4 + 2] = pal[i * 3 + 2] * s; }
      lut[i * 4 + 3] = (tr && tr.alpha && i < tr.alpha.length ? tr.alpha[i] : 255) * s;
    }
    const mask = (1 << bd) - 1, per = 8 / bd;
    return (row, count, out, o, step) => {
      for (let x = 0; x < count; x++, o += step) {
        const idx = bd === 8 ? row[x] : (row[(x / per) | 0] >> (8 - bd - (x % per) * bd)) & mask;
        const l = idx * 4;
        out[o] = lut[l]; out[o + 1] = lut[l + 1]; out[o + 2] = lut[l + 2]; out[o + 3] = lut[l + 3];
      }
    };
  }
  if (ct === 0 && bd < 8) {
    const mask = (1 << bd) - 1, per = 8 / bd, scale = max / mask;
    const tg = tr && tr.gray != null ? tr.gray : -1;
    return (row, count, out, o, step) => {
      for (let x = 0; x < count; x++, o += step) {
        const v = (row[(x / per) | 0] >> (8 - bd - (x % per) * bd)) & mask;
        const g = Math.round(v * scale);
        out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = v === tg ? 0 : max;
      }
    };
  }
  const ch = CHANNELS[ct];
  if (bd === 8) {
    const tg = tr && tr.gray != null ? tr.gray : -1, trgb = tr && tr.rgb ? tr.rgb : null;
    const s = wide ? 257 : 1;
    return (row, count, out, o, step) => {
      for (let x = 0, i = 0; x < count; x++, o += step, i += ch) {
        if (ct === 6) { out[o] = row[i] * s; out[o + 1] = row[i + 1] * s; out[o + 2] = row[i + 2] * s; out[o + 3] = row[i + 3] * s; }
        else if (ct === 2) {
          const r = row[i], g = row[i + 1], b = row[i + 2];
          out[o] = r * s; out[o + 1] = g * s; out[o + 2] = b * s;
          out[o + 3] = trgb && r === trgb[0] && g === trgb[1] && b === trgb[2] ? 0 : max;
        } else if (ct === 0) { const g = row[i]; out[o] = out[o + 1] = out[o + 2] = g * s; out[o + 3] = g === tg ? 0 : max; }
        else { const g = row[i]; out[o] = out[o + 1] = out[o + 2] = g * s; out[o + 3] = row[i + 1] * s; }
      }
    };
  }
  // 16-bit samples
  const tg = tr && tr.gray != null ? tr.gray : -1, trgb = tr && tr.rgb ? tr.rgb : null;
  return (row, count, out, o, step) => {
    for (let x = 0, i = 0; x < count; x++, o += step, i += ch * 2) {
      const v0 = (row[i] << 8) | row[i + 1];
      let r, g, b, a;
      if (ct === 0) { r = g = b = v0; a = v0 === tg ? 0 : 65535; }
      else if (ct === 4) { r = g = b = v0; a = (row[i + 2] << 8) | row[i + 3]; }
      else {
        r = v0; g = (row[i + 2] << 8) | row[i + 3]; b = (row[i + 4] << 8) | row[i + 5];
        a = ct === 6 ? (row[i + 6] << 8) | row[i + 7] : trgb && r === trgb[0] && g === trgb[1] && b === trgb[2] ? 0 : 65535;
      }
      if (wide) { out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a; } else { out[o] = r >> 8; out[o + 1] = g >> 8; out[o + 2] = b >> 8; out[o + 3] = a >> 8; }
    }
  };
}

/**
 * Decodes a PNG to RGBA. depth16: Uint16Array output (0..65535) for every source depth.
 * maxPixels guards memory (default 2^28 pixels). The default image of an APNG is decoded.
 */
// The expected inflated size is computed from the header up front, so the inflater allocates once and a truncated or
// oversized stream is detected. maxPixels caps memory before any allocation (a decompression bomb declares a huge
// size in IHDR). Interlaced images are decoded pass by pass straight into their final positions (step = dx).
export function decodePNG(bytes, { depth16 = false, crc = false, maxPixels = 1 << 28 } = {}) {
  const chunks = readChunks(bytes, { crc });
  if (crc) { const bad = chunks.find((c) => c.crcOk === false && /^[A-Z]/.test(c.type)); if (bad) throw new Error('PNG: CRC mismatch in ' + bad.type); }
  const h = parseHeader(chunks);
  if (h.width * h.height > maxPixels) throw new Error('PNG: image too large');
  const info = readInfo(chunks, h);
  const idats = chunks.filter((c) => c.type === 'IDAT');
  if (!idats.length) throw new Error('PNG: no image data');
  let z;
  if (idats.length === 1) z = idats[0].data;
  else {
    z = new Uint8Array(idats.reduce((a, c) => a + c.data.length, 0));
    let o = 0;
    for (const c of idats) { z.set(c.data, o); o += c.data.length; }
  }
  const ch = CHANNELS[h.colorType], bitsPP = ch * h.bitDepth, bpp = Math.max(1, bitsPP >> 3);
  const passes = h.interlace ? ADAM7 : [[0, 0, 1, 1]];
  let rawSize = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((h.width - x0) / dx), ph = Math.ceil((h.height - y0) / dy);
    if (pw > 0 && ph > 0) rawSize += ph * (1 + Math.ceil((pw * bitsPP) / 8));
  }
  let raw;
  try { raw = unzlibSync(z, { size: rawSize, check: false }); } catch (e) { throw new Error('PNG: ' + e.message); }
  if (raw.length < rawSize) throw new Error('PNG: image data is truncated');
  const wide = !!depth16;
  const out = wide ? new Uint16Array(h.width * h.height * 4) : new Uint8ClampedArray(h.width * h.height * 4);
  const convert = rowConverter(h, info, wide);
  let p = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((h.width - x0) / dx), ph = Math.ceil((h.height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPP) / 8);
    let prev = null;
    for (let y = 0; y < ph; y++) {
      const type = raw[p];
      const cur = raw.subarray(p + 1, p + 1 + stride);
      unfilterRow(type, cur, prev, bpp);
      convert(cur, pw, out, ((y0 + y * dy) * h.width + x0) * 4, dx * 4);
      prev = cur;
      p += 1 + stride;
    }
  }
  return { width: h.width, height: h.height, depth: wide ? 16 : 8, data: out, info };
}
