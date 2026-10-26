// pack/gzip.js - gzip writer (RFC 1952): one member with the original name, modification time and CRC-32 / ISIZE
// trailer; Deflate from ../codec/zlib.js.
//
//   gzip(data, { level = 6, name, mtime, comment }) -> Uint8Array

import { crc32 } from '../codec/crc32.js';
import { deflateRawSync } from '../codec/zlib.js';

// FNAME and FCOMMENT are ISO 8859-1, zero-terminated: NUL would end the field early and characters above 0xff do
// not exist there, so both become '_' (lossy but always a valid header).
const latin1 = (s) => Uint8Array.from(String(s), (c) => { const x = c.charCodeAt(0); return x > 0 && x < 256 ? x : 0x5f; });

export function gzip(data, { level = 6, name = '', mtime, comment = '' } = {}) {
  const body = deflateRawSync(data, { level });
  // Only the base name is stored: a path in FNAME is a path-traversal hazard on extraction (gunzip -N).
  const nm = name ? latin1(String(name).replace(/^.*[\\/]/, '')) : null;
  const cm = comment ? latin1(comment) : null;
  const head = new Uint8Array(10);
  head.set([0x1f, 0x8b, 8, (nm ? 8 : 0) | (cm ? 16 : 0)]);
  // MTIME 0 means "unknown"; negative or > 2^32 s times cannot be represented and clamp/wrap.
  const t = mtime instanceof Date ? mtime.getTime() : typeof mtime === 'number' ? mtime : 0;
  const s = Math.max(0, Math.floor(t / 1000)) >>> 0;
  head[4] = s; head[5] = s >>> 8; head[6] = s >>> 16; head[7] = s >>> 24;
  // XFL: 2 = maximum compression, 4 = fastest (informational only).
  head[8] = level >= 9 ? 2 : level <= 1 ? 4 : 0;
  head[9] = 3; // Unix
  const crc = crc32(data), n = data.length >>> 0;
  const tail = Uint8Array.of(crc, crc >>> 8, crc >>> 16, crc >>> 24, n, n >>> 8, n >>> 16, n >>> 24);
  const len = 10 + (nm ? nm.length + 1 : 0) + (cm ? cm.length + 1 : 0) + body.length + 8;
  const out = new Uint8Array(len);
  let o = 0;
  out.set(head, o); o += 10;
  if (nm) { out.set(nm, o); o += nm.length + 1; }
  if (cm) { out.set(cm, o); o += cm.length + 1; }
  out.set(body, o); o += body.length;
  out.set(tail, o);
  return out;
}
