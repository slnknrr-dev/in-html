// pdf/image.js - raster images as PDF image XObjects: JPEG passes through untouched (DCTDecode; grey, RGB and CMYK,
// with the inverted Decode of Adobe CMYK files), PNG is decoded by ../png/ and stored as Flate-compressed RGB or grey
// plus a soft mask when it has transparency, and raw RGBA pixels ({ width, height, data }) are stored the same way.
//
//   imageKind(bytes) -> 'jpeg' | 'png' | null
//   prepareImage(src, { interpolate }) -> { width, height, colorSpace, bpc, filter, decode, data, smask }
//       src: Uint8Array of a JPEG / PNG file, or { width, height, data: RGBA bytes }
//   jpegInfo(bytes) -> { width, height, components, adobe, progressive }

import { zlibSync } from '../codec/zlib.js';
import { decodePNG } from '../png/decode.js';
import { isJPEG, parseSOF, readSegments, isSOF } from '../jpg/segments.js';

export function imageKind(b) {
  if (!(b instanceof Uint8Array) || b.length < 8) return null;
  if (isJPEG(b)) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

export function jpegInfo(bytes) {
  const segs = readSegments(bytes);
  const sof = segs.find((s) => isSOF(s.marker));
  if (!sof) throw new Error('JPEG: no frame header');
  const f = parseSOF(sof.data, sof.marker);
  const adobe = segs.some((s) => s.marker === 0xee && s.data.length >= 5 && String.fromCharCode(...s.data.subarray(0, 5)) === 'Adobe');
  return { width: f.width, height: f.height, components: f.components.length, adobe, progressive: f.progressive, precision: f.precision };
}

// One pass detects both "any transparency" and "all pixels grey" (early exit once both answers are known); grey
// images are stored with 1 channel instead of 3, alpha goes to a separate /SMask image because PDF has no RGBA image
// type. Both streams are zlib-compressed (FlateDecode expects the zlib wrapper, not raw deflate).
function fromRGBA(width, height, rgba, { grayHint = true } = {}) {
  const n = width * height;
  let alpha = false, gray = grayHint;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (rgba[p + 3] !== 255) alpha = true;
    if (gray && (rgba[p] !== rgba[p + 1] || rgba[p] !== rgba[p + 2])) gray = false;
    if (alpha && !gray) break;
  }
  const ch = gray ? 1 : 3;
  const px = new Uint8Array(n * ch);
  for (let i = 0; i < n; i++) {
    if (gray) px[i] = rgba[i * 4];
    else { px[i * 3] = rgba[i * 4]; px[i * 3 + 1] = rgba[i * 4 + 1]; px[i * 3 + 2] = rgba[i * 4 + 2]; }
  }
  let smask = null;
  if (alpha) {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = rgba[i * 4 + 3];
    smask = { width, height, colorSpace: 'DeviceGray', bpc: 8, filter: 'FlateDecode', data: zlibSync(a, { level: 6 }) };
  }
  return { width, height, colorSpace: gray ? 'DeviceGray' : 'DeviceRGB', bpc: 8, filter: 'FlateDecode', data: zlibSync(px, { level: 6 }), smask };
}

// JPEG is embedded byte-for-byte (DCTDecode): no re-encoding, no quality loss, no decoder needed. Adobe-marked CMYK
// JPEGs store inverted values, hence the Decode [1 0 ...] array; without it such images print as negatives.
// KNOWN DEFECT: jpegInfo reports `precision`, but bpc is always written as 8; a 12-bit JPEG would get a wrong
// /BitsPerComponent. Fix: reject (or pass through) j.precision !== 8 explicitly.
// The `{ interpolate }` option in the header comment is not implemented by this function.
export function prepareImage(src) {
  if (src instanceof Uint8Array || src instanceof ArrayBuffer) {
    const b = src instanceof Uint8Array ? src : new Uint8Array(src);
    const kind = imageKind(b);
    if (kind === 'jpeg') {
      const j = jpegInfo(b);
      const cs = j.components === 1 ? 'DeviceGray' : j.components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
      return { width: j.width, height: j.height, colorSpace: cs, bpc: 8, filter: 'DCTDecode', decode: j.components === 4 && j.adobe ? [1, 0, 1, 0, 1, 0, 1, 0] : null, data: b, smask: null };
    }
    if (kind === 'png') {
      const img = decodePNG(b);
      return fromRGBA(img.width, img.height, img.data);
    }
    throw new Error('PDF image: only JPEG, PNG or { width, height, data } pixels are supported');
  }
  if (src && src.width > 0 && src.height > 0 && src.data && src.data.length >= src.width * src.height * 4) return fromRGBA(src.width, src.height, src.data);
  throw new Error('PDF image: bad pixel source');
}
