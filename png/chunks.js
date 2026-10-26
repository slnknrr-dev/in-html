// png/chunks.js - PNG chunk level: list / build chunks, text chunks (tEXt, zTXt, iTXt), metadata stripping, APNG
// animation info (acTL / fcTL). Pure byte work, synchronous (zlib through codec/zlib.js).
//
//   isPNG(bytes)                                  signature check
//   readChunks(bytes, { crc }) -> [{ type, offset, length, data, crc, crcOk }]
//   makeChunk(type, data) -> Uint8Array            one chunk with length and CRC
//   writeChunks([{ type, data }]) -> Uint8Array    signature + chunks
//   readText(bytes | chunks) -> [{ keyword, text, type, lang, translated, compressed }]
//   textChunk(keyword, text, { compress, utf8, lang, translated }) -> { type, data }
//   setText(bytes, entries, { replace = true }) -> Uint8Array      entries: [{ keyword, text, ... }] or { k: v }
//   stripMetadata(bytes, { keepColor = true, keepPhys = true, keepText = false, keep = [] }) -> Uint8Array
//   apngInfo(bytes | chunks) -> null | { frames, plays, width, height, firstIsDefault, duration, list: [...] }

import { crc32 } from '../codec/crc32.js';
import { unzlibSync, zlibSync } from '../codec/zlib.js';

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function isPNG(bytes) {
  if (!bytes || bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const rd32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const wr32 = (b, p, v) => { b[p] = v >>> 24; b[p + 1] = (v >>> 16) & 255; b[p + 2] = (v >>> 8) & 255; b[p + 3] = v & 255; };
const typeStr = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);

/** Chunks of a PNG file (data are views into `bytes`). Stops at IEND; a truncated chunk ends the list. */
// CRC verification is opt-in: browsers ignore ancillary CRC errors, and checksumming every chunk of a large file
// costs a full pass. A truncated final chunk is reported (truncated: true) instead of thrown, so tools can still
// show and repair the rest.
export function readChunks(input, { crc = false } = {}) {
  const b = u8(input);
  if (!isPNG(b)) throw new Error('not a PNG file');
  const out = [];
  let p = 8;
  while (p + 12 <= b.length) {
    const length = rd32(b, p);
    const type = typeStr(b, p + 4);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('corrupt PNG chunk at ' + p);
    if (p + 12 + length > b.length) { out.push({ type, offset: p, length, data: b.subarray(p + 8, b.length), crc: 0, crcOk: false, truncated: true }); break; }
    const data = b.subarray(p + 8, p + 8 + length);
    const c = rd32(b, p + 8 + length);
    out.push({ type, offset: p, length, data, crc: c, crcOk: crc ? crc32(b, p + 4, p + 8 + length) === c : null });
    p += 12 + length;
    if (type === 'IEND') break;
  }
  return out;
}

/** One serialized chunk: length, type, data, CRC-32 of type + data. */
export function makeChunk(type, data = new Uint8Array(0)) {
  const d = u8(data);
  const c = new Uint8Array(12 + d.length);
  wr32(c, 0, d.length);
  for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
  c.set(d, 8);
  wr32(c, 8 + d.length, crc32(c, 4, 8 + d.length));
  return c;
}

/** PNG file from chunks [{ type, data }] (the signature is added). */
export function writeChunks(chunks) {
  const parts = chunks.map((c) => makeChunk(c.type, c.data));
  const out = new Uint8Array(8 + parts.reduce((a, p) => a + p.length, 0));
  out.set(PNG_SIGNATURE);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// --- text ------------------------------------------------------------------------------------------

const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
const toLatin1 = (s) => Uint8Array.from(String(s), (ch) => { const c = ch.charCodeAt(0); return c < 256 ? c : 63; });
const utf8dec = new TextDecoder('utf-8', { fatal: false });
const utf8enc = new TextEncoder();
const zero = (b, from) => { for (let i = from; i < b.length; i++) if (b[i] === 0) return i; return -1; };

// One text chunk -> entry, or null when malformed (text chunks are ancillary: never fatal).
// Text chunk layouts: tEXt keyword NUL text (Latin-1); zTXt keyword NUL method zlib(text); iTXt keyword NUL flag
// method lang NUL translated-keyword NUL text (UTF-8, optionally zlib). Keywords are 1-79 bytes by spec.
export function parseTextChunk(type, data) {
  try {
    const z = zero(data, 0);
    if (z < 1 || z > 79) return null;
    const keyword = latin1(data.subarray(0, z));
    if (type === 'tEXt') return { keyword, text: latin1(data.subarray(z + 1)), type, lang: '', translated: '', compressed: false };
    if (type === 'zTXt') {
      if (data[z + 1] !== 0) return null;
      return { keyword, text: latin1(unzlibSync(data.subarray(z + 2))), type, lang: '', translated: '', compressed: true };
    }
    if (type === 'iTXt') {
      const flag = data[z + 1], method = data[z + 2];
      const zl = zero(data, z + 3);
      if (zl < 0) return null;
      const zt = zero(data, zl + 1);
      if (zt < 0) return null;
      const lang = latin1(data.subarray(z + 3, zl));
      const translated = utf8dec.decode(data.subarray(zl + 1, zt));
      let body = data.subarray(zt + 1);
      if (flag) { if (method !== 0) return null; body = unzlibSync(body); }
      return { keyword, text: utf8dec.decode(body), type, lang, translated, compressed: !!flag };
    }
  } catch { /* corrupt compressed text */ }
  return null;
}

/** Text entries of a PNG (bytes or the result of readChunks). */
export function readText(input) {
  const chunks = Array.isArray(input) ? input : readChunks(input);
  const out = [];
  for (const c of chunks) {
    if (c.type !== 'tEXt' && c.type !== 'zTXt' && c.type !== 'iTXt') continue;
    const e = parseTextChunk(c.type, c.data);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Text chunk { type, data }. Latin-1 text goes to tEXt (zTXt with `compress`); other text, `utf8`, `lang` or
 * `translated` select iTXt (compressed with `compress`). Keywords are 1-79 Latin-1 characters.
 */
// The cheapest chunk that represents the text exactly: tEXt for Latin-1, iTXt (UTF-8) as soon as any character
// falls outside Latin-1 or a language is given. Non-Latin-1 characters in keywords are removed, not transcoded.
export function textChunk(keyword, text, { compress = false, utf8 = false, lang = '', translated = '' } = {}) {
  const key = String(keyword || '').replace(/[^\x20-\x7e\xa1-\xff]/g, '').trim().slice(0, 79) || 'Comment';
  const s = String(text ?? '');
  const intl = utf8 || lang || translated || /[^\x00-\xff]/.test(s);
  const k = toLatin1(key);
  if (!intl) {
    const body = compress ? zlibSync(toLatin1(s), { level: 9 }) : toLatin1(s);
    const d = new Uint8Array(k.length + 1 + (compress ? 1 : 0) + body.length);
    d.set(k); let o = k.length + 1;
    if (compress) d[o++] = 0;
    d.set(body, o);
    return { type: compress ? 'zTXt' : 'tEXt', data: d };
  }
  const l = toLatin1(lang), tr = utf8enc.encode(translated);
  const body = compress ? zlibSync(utf8enc.encode(s), { level: 9 }) : utf8enc.encode(s);
  const d = new Uint8Array(k.length + 3 + l.length + 1 + tr.length + 1 + body.length);
  d.set(k); let o = k.length + 1;
  d[o++] = compress ? 1 : 0; d[o++] = 0;
  d.set(l, o); o += l.length + 1;
  d.set(tr, o); o += tr.length + 1;
  d.set(body, o);
  return { type: 'iTXt', data: d };
}

const TEXT_TYPES = new Set(['tEXt', 'zTXt', 'iTXt']);

/** Adds text entries (before the first IDAT); with `replace`, earlier chunks of the same keywords are dropped. */
// New text goes before the first IDAT: decoders that stream the image read metadata before pixel data.
export function setText(bytes, entries, { replace = true } = {}) {
  const list = Array.isArray(entries) ? entries : Object.entries(entries || {}).map(([keyword, text]) => ({ keyword, text }));
  const fresh = list.map((e) => textChunk(e.keyword, e.text, e));
  const keys = new Set(fresh.map((c) => latin1(c.data.subarray(0, zero(c.data, 0)))));
  const out = [];
  let placed = false;
  for (const c of readChunks(bytes)) {
    if (replace && TEXT_TYPES.has(c.type) && keys.has(latin1(c.data.subarray(0, Math.max(0, zero(c.data, 0)))))) continue;
    if (!placed && (c.type === 'IDAT' || c.type === 'IEND')) { out.push(...fresh); placed = true; }
    out.push({ type: c.type, data: c.data });
  }
  return writeChunks(out);
}

// --- metadata stripping ----------------------------------------------------------------------------

// Chunks that describe pixels (never stripped): image data, palette, transparency, animation.
const IMAGE_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'acTL', 'fcTL', 'fdAT']);
const COLOR_CHUNKS = new Set(['gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'cICP', 'mDCv', 'cLLi']);

/**
 * PNG without metadata. Kept: image chunks, colour description (keepColor), pHYs (keepPhys), text (keepText),
 * any type listed in `keep`. Dropped: text, tIME, eXIf, bKGD, hIST, sPLT, private and unknown chunks.
 */
// Allowlist, not blocklist: unknown and private chunks are dropped by default, which is the safe choice for removing
// tracking data (EXIF location, tIME, software text) from images before sharing.
export function stripMetadata(bytes, { keepColor = true, keepPhys = true, keepText = false, keep = [] } = {}) {
  const extra = new Set(keep);
  const out = [];
  for (const c of readChunks(bytes)) {
    const t = c.type;
    if (c.truncated) continue;
    if (IMAGE_CHUNKS.has(t) || extra.has(t) || (keepColor && COLOR_CHUNKS.has(t)) || (keepPhys && t === 'pHYs') || (keepText && TEXT_TYPES.has(t))) {
      out.push({ type: t, data: c.data });
    }
  }
  return writeChunks(out);
}

// --- APNG -------------------------------------------------------------------------------------------

const DISPOSE = ['none', 'background', 'previous'];
const BLEND = ['source', 'over'];

/** Animation info of an APNG, null for a still PNG. Frame delays are in milliseconds (0 = as fast as possible). */
// APNG: an fcTL before the first IDAT means the default image is also the first frame; otherwise IDAT is a fallback
// still for non-APNG viewers. Delay = num / den seconds, den 0 meaning 1/100 s per the APNG spec.
export function apngInfo(input) {
  const chunks = Array.isArray(input) ? input : readChunks(input);
  const actl = chunks.find((c) => c.type === 'acTL');
  if (!actl || actl.data.length < 8) return null;
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const firstIdat = chunks.findIndex((c) => c.type === 'IDAT');
  const list = [];
  let firstIsDefault = false;
  chunks.forEach((c, i) => {
    if (c.type !== 'fcTL' || c.data.length < 26) return;
    const d = c.data;
    const num = (d[20] << 8) | d[21];
    const den = ((d[22] << 8) | d[23]) || 100;
    if (firstIdat >= 0 && i < firstIdat) firstIsDefault = true;
    list.push({
      seq: rd32(d, 0), width: rd32(d, 4), height: rd32(d, 8), x: rd32(d, 12), y: rd32(d, 16),
      delay: Math.round((num / den) * 1000), dispose: DISPOSE[d[24]] || 'none', blend: BLEND[d[25]] || 'source',
    });
  });
  return {
    frames: rd32(actl.data, 0), plays: rd32(actl.data, 4),
    width: ihdr ? rd32(ihdr.data, 0) : 0, height: ihdr ? rd32(ihdr.data, 4) : 0,
    firstIsDefault, duration: list.reduce((a, f) => a + f.delay, 0), list,
  };
}
