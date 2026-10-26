// mp4/box.js - ISO BMFF (MP4 / MOV / 3GP) box primitives: a box tree reader and byte writers for building boxes.

//
// Box = [size u32][type fourcc][payload]; size 1 means a 64-bit size follows, 0 means "to the end of the file".
// The reader never copies: boxes are offset records into the original bytes, so a 2 GB recording is indexed without
// duplicating it. Writers build each box with one allocation via cat(), which sizes the result before copying.
const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// Boxes whose payload is a list of child boxes; `meta` is a full box (4 bytes of version/flags first) in ISO files
// but a plain container in QuickTime: detected from the payload.
export const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'udta', 'mvex', 'moof', 'traf',
  'mfra', 'meta', 'ilst', 'sinf', 'schi', 'tref', 'wave', 'gmhd', 'tapt', 'iprp', 'ipco']);

/**
 * Reads the boxes in [start, end): [{ type, offset, size, headerSize, start (payload), end, children? }].
 * Containers (CONTAINERS) are read recursively up to `depth`; ilst items are containers of 'data' boxes.
 */
// Defensive against damaged files: a box claiming more bytes than remain is clamped (truncated: true) instead of
// throwing, and a size smaller than its own header stops the scan (it would loop forever or go backwards).
export function readBoxes(input, start = 0, end, depth = 8, parent = '') {
  const b = asBytes(input);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const stop = end == null ? b.length : Math.min(end, b.length);
  const out = [];
  let p = start;
  while (p + 8 <= stop) {
    let size = dv.getUint32(p);
    const type = fourcc(b, p + 4);
    let hdr = 8;
    if (size === 1) {
      if (p + 16 > stop) break;
      size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12);
      hdr = 16;
    } else if (size === 0) size = stop - p;
    if (type === 'uuid') hdr += 16;
    if (size < hdr) break;
    const boxEnd = Math.min(stop, p + size);
    const box = { type, offset: p, size, headerSize: hdr, start: p + hdr, end: boxEnd, truncated: p + size > stop };
    if (depth > 0) {
      let cs = box.start;
      if (type === 'meta') {
        // ISO: full box (version/flags) before the children; QuickTime: children directly (size then 'hdlr').
        if (fourcc(b, cs + 4) !== 'hdlr') cs += 4;
      }
      if (CONTAINERS.has(type) || parent === 'ilst') box.children = readBoxes(b, cs, boxEnd, depth - 1, type);
    }
    out.push(box);
    p += size;
  }
  return out;
}

/** First box of a path below `boxes`: find(tree, 'moov/trak/mdia'). */
export function findBox(boxes, path) {
  let cur = { children: boxes };
  for (const t of path.split('/')) {
    cur = (cur.children || []).find((x) => x.type === t);
    if (!cur) return null;
  }
  return cur;
}

/** Every child box of a type. */
export const findAll = (box, type) => (box?.children || []).filter((x) => x.type === type);

// ---------------------------------------------------------------------------------------------
// Writer helpers: values -> bytes. A box is built from parts (Uint8Array) in one allocation.

export const u8 = (v) => new Uint8Array([v & 0xff]);
export const u16 = (v) => new Uint8Array([(v >> 8) & 0xff, v & 0xff]);
export const i16 = (v) => u16(v < 0 ? v + 65536 : v);
export const u24 = (v) => new Uint8Array([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
export function u32(v) { const o = new Uint8Array(4); new DataView(o.buffer).setUint32(0, v >>> 0); return o; }
export function i32(v) { const o = new Uint8Array(4); new DataView(o.buffer).setInt32(0, v | 0); return o; }
// JS numbers are exact up to 2^53, enough for any file offset; split by division because >> works on 32 bits only.
export function u64(v) { const o = new Uint8Array(8); const dv = new DataView(o.buffer); dv.setUint32(0, Math.floor(v / 4294967296)); dv.setUint32(4, v % 4294967296); return o; }
export const fixed16 = (v) => u32(Math.round(v * 65536));
export const fixed8 = (v) => u16(Math.round(v * 256));
export const ascii = (s) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0) & 0xff));
export const zeros = (n) => new Uint8Array(n);
export const utf8 = (s) => new TextEncoder().encode(s);

/** Concatenates parts (Uint8Array or nested arrays). */
export function cat(...parts) {
  const flat = [];
  const walk = (x) => { if (x == null) return; if (Array.isArray(x)) x.forEach(walk); else flat.push(asBytes(x)); };
  walk(parts);
  let n = 0;
  for (const x of flat) n += x.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of flat) { out.set(x, o); o += x.length; }
  return out;
}

/** box('moov', ...parts) -> bytes with a 32-bit size (64-bit when needed). */
// The size is known only after the body is built, hence body first, header second (one extra copy per box level,
// negligible next to sample data, which is never wrapped by this function).
export function box(type, ...parts) {
  const body = cat(parts);
  if (body.length + 8 > 0xffffffff) return cat(u32(1), ascii(type), u64(body.length + 16), body);
  return cat(u32(body.length + 8), ascii(type), body);
}

/** Full box: version (8 bits) + flags (24 bits) before the payload. */
export const fullBox = (type, version, flags, ...parts) => box(type, u8(version), u24(flags), ...parts);

// Unity transformation matrix of mvhd / tkhd.
export const MATRIX = cat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
