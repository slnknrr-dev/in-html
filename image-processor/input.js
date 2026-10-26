// image-processor/input.js - input files: format sniffing, metadata for the info panel (PNG chunks, JPEG
// segments, EXIF summary and tags) and decoding to RGBA. PNG and JPEG go through the own decoders (pixels as stored,
// EXIF orientation reported separately); other formats, and files those decoders reject, through the browser.

import { decodeJPEG } from '../jpg/decode.js';
import { exifEntries, exifSummary, readTiff } from '../jpg/exif.js';
import { jpegInfo } from '../jpg/segments.js';
import { decodePNG, pngInfo } from '../png/decode.js';
import { decodeICO } from '../ico/ico.js';

// Decoder pixel cap (120 MP = ~480 MB of RGBA): a "decompression bomb" (tiny file, huge dimensions) is refused
// before allocation instead of crashing the tab.
const MAX_PIXELS = 120e6;

/** 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'avif' | 'heic' | 'tiff' | 'ico' | 'svg' | 'unknown' */
// Format by magic bytes, never by extension or MIME type (both are user-controlled and often wrong). ISO-BMFF files
// (ftyp box) are told apart by their major brand: avif/avis vs heic/heix/mif1/msf1/hevc.
export function sniff(b) {
  if (!b || b.length < 12) return 'unknown';
  const s = (i, str) => [...str].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b[0] === 0x89 && s(1, 'PNG')) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (s(0, 'GIF8')) return 'gif';
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'webp';
  if (s(0, 'BM')) return 'bmp';
  if (s(4, 'ftyp')) { const brand = String.fromCharCode(...b.subarray(8, 12)); return /avi[fs]/.test(brand) ? 'avif' : /hei[cx]|mif1|msf1|hevc/.test(brand) ? 'heic' : 'unknown'; }
  if ((s(0, 'II') && b[2] === 42 && b[3] === 0) || (s(0, 'MM') && b[2] === 0 && b[3] === 42)) return 'tiff';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico';
  if (/^\s*(<\?xml|<svg)/i.test(String.fromCharCode(...b.subarray(0, 64)))) return 'svg';
  return 'unknown';
}

export const KIND_LABEL = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', bmp: 'BMP', avif: 'AVIF', heic: 'HEIC', tiff: 'TIFF', ico: 'ICO', svg: 'SVG', unknown: '?' };

const b16le = (b, p) => b[p] | (b[p + 1] << 8);
const b32le = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24);
// WebP canvas size from the VP8 / VP8L / VP8X header.
// WebP dimensions per chunk type: VP8X stores 24-bit (size - 1) values, VP8L packs 14-bit (size - 1) fields, lossy
// VP8 stores 14-bit sizes after the 3-byte frame tag and the 3-byte start code (offset 26).
function webpSize(b) {
  const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (tag === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  if (tag === 'VP8L') { const v = b32le(b, 21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  if (tag === 'VP8 ') return { width: b16le(b, 26) & 0x3fff, height: b16le(b, 28) & 0x3fff };
  return {};
}

const tiffOf = (exifBytes) => { try { return exifBytes ? readTiff(exifBytes) : null; } catch { return null; } };

/**
 * Metadata of a file (bytes may be just the first part of the file): { kind, width, height, orientation, format: [[key,
 * value]] (display rows), exif: { summary, entries } | null, text: [{ keyword, text }], icc: size, animated }.
 */
// Metadata from the header only (works on the first bytes of a file), wrapped in try/catch: a truncated or malformed
// header yields partial metadata plus m.error, never an exception in the UI.
export function readMeta(bytes) {
  const kind = sniff(bytes);
  const m = { kind, width: 0, height: 0, orientation: 1, format: [], exif: null, text: [], iccSize: 0, frames: 0 };
  try {
    if (kind === 'png') {
      const i = pngInfo(bytes);
      m.width = i.width; m.height = i.height;
      m.format.push(['colorType', `${i.colorTypeName}, ${i.bitDepth} bit`]);
      if (i.palette) m.format.push(['palette', String(i.palette.length / 3)]);
      if (i.interlaced) m.format.push(['interlaced', 'Adam7']);
      if (i.gamma) m.format.push(['gamma', String(i.gamma)]);
      if (i.srgb) m.format.push(['srgb', i.srgb]);
      if (i.iccp) { m.iccSize = i.iccp.size; m.format.push(['icc', `${i.iccp.name} (${i.iccp.size} B)`]); }
      if (i.phys && i.phys.dpi) m.format.push(['dpi', i.phys.dpi.join(' × ')]);
      if (i.time) m.format.push(['modified', i.time.toISOString().replace('.000Z', 'Z')]);
      if (i.animation) { m.frames = i.animation.frames; m.format.push(['frames', `${i.animation.frames} (APNG)`]); }
      m.text = i.text.map((e) => ({ keyword: e.keyword, text: e.text }));
      const t = tiffOf(i.exif);
      if (t) { m.exif = { summary: exifSummary(t), entries: exifEntries(t) }; m.orientation = m.exif.summary.orientation; }
    } else if (kind === 'jpeg') {
      const i = jpegInfo(bytes);
      m.width = i.width; m.height = i.height;
      m.format.push(['colorSpace', i.colorSpace]);
      if (i.subsampling && i.subsampling !== 'gray') m.format.push(['subsampling', i.subsampling]);
      m.format.push(['process', i.progressive ? 'progressive' : i.process || 'baseline']);
      if (i.quality) m.format.push(['quality', '≈ ' + i.quality]);
      if (i.icc) { m.iccSize = i.icc.length; m.format.push(['icc', `${i.icc.length} B`]); }
      if (i.jfif && i.jfif.units !== 'none') m.format.push(['dpi', `${i.jfif.xDensity} × ${i.jfif.yDensity} ${i.jfif.units}`]);
      if (i.xmp) m.format.push(['xmp', `${i.xmp.length} B`]);
      m.text = i.comments.map((c) => ({ keyword: 'Comment', text: c }));
      const t = tiffOf(i.exif);
      if (t) { m.exif = { summary: exifSummary(t), entries: exifEntries(t) }; m.orientation = m.exif.summary.orientation; }
    } else if (kind === 'gif') { m.width = b16le(bytes, 6); m.height = b16le(bytes, 8); }
    else if (kind === 'bmp' && bytes.length > 26) { m.width = Math.abs(b32le(bytes, 18)); m.height = Math.abs(b32le(bytes, 22)); }
    else if (kind === 'webp') Object.assign(m, webpSize(bytes));
  } catch (e) {
    m.error = String(e.message || e);
  }
  return m;
}

/**
 * Decodes a file to RGBA. Returns { img, kind, orientation (still to apply), exif (TIFF bytes), icc, text, via }.
 * `browserDecode(blob)` decodes with the platform (orientation already applied there).
 */
// Own PNG/JPEG decoders first: they return pixels exactly as stored plus EXIF orientation and ICC/text separately,
// so the pipeline can rotate deterministically and carry metadata over. Anything else (or a file the own decoder
// rejects) goes to the browser, which applies orientation itself (hence orientation 1) but gives no metadata - so
// re-encoded WebP/AVIF/HEIC inputs always lose their EXIF. The own decoder's error is preferred in the message,
// as it is more specific than the browser's.
export async function decodeInput(bytes, type, { browserDecode } = {}) {
  const kind = sniff(bytes);
  let err = null;
  if (kind === 'png') {
    try {
      const r = decodePNG(bytes, { maxPixels: MAX_PIXELS });
      const t = tiffOf(r.info.exif);
      const o = t && t.ifd0.Orientation >= 1 && t.ifd0.Orientation <= 8 ? t.ifd0.Orientation : 1;
      return {
        img: { width: r.width, height: r.height, data: r.data }, kind, orientation: o, via: 'png',
        exif: r.info.exif, icc: r.info.iccp && r.info.iccp.profile, text: r.info.text.map((e) => ({ keyword: e.keyword, text: e.text })),
      };
    } catch (e) { err = e; }
  } else if (kind === 'jpeg') {
    try {
      const r = decodeJPEG(bytes, { maxPixels: MAX_PIXELS });
      return {
        img: { width: r.width, height: r.height, data: r.data }, kind, orientation: r.orientation, via: 'jpeg',
        exif: r.exif, icc: r.icc, text: r.comments.map((c) => ({ keyword: 'Comment', text: c })),
      };
    } catch (e) { err = e; }
  } else if (kind === 'ico') {
    // the largest, deepest entry of the icon (own decoder: BMP and PNG entries, AND-mask transparency)
    try {
      const [r] = decodeICO(bytes);
      if (r) return { img: { width: r.width, height: r.height, data: r.data }, kind, orientation: 1, via: 'ico', exif: null, icc: null, text: [] };
    } catch (e) { err = e; }
  }
  if (!browserDecode) throw err || new Error('unsupported format');
  try {
    const img = await browserDecode(new Blob([bytes], { type: type || '' }));
    return { img, kind, orientation: 1, via: 'browser', exif: null, icc: null, text: [] };
  } catch (e) {
    throw err || e;
  }
}
