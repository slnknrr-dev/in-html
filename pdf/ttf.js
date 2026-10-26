// pdf/ttf.js - TrueType fonts for PDF embedding: parsing of the tables a writer needs (head, hhea, maxp, hmtx, cmap
// formats 4 / 12 / symbol, loca / glyf with composite glyphs, OS/2, post, name), glyph subsetting that keeps glyph ids
// (so a CIDFontType2 can use /CIDToGIDMap /Identity), and a builder of small synthetic fonts (tests, generated icon
// fonts). Collections (.ttc) are read by index; CFF-flavoured OpenType ('OTTO') is rejected with a clear error.
//
//   parseTTF(bytes, { index }) -> Font { unitsPerEm, numGlyphs, numberOfHMetrics, ascent, descent, lineGap, capHeight,
//       xHeight, bbox, italicAngle, fixedPitch, bold, italic, weight, embeddable, postscriptName, familyName, cmap: Map,
//       gidFor(cp), advance(gid) (font units), widthOf(gid) (1/1000 em), glyphRange(gid), components(gid), tables }
//   subsetTTF(font, gids) -> Uint8Array   a valid TrueType file with only those glyphs (plus .notdef and composite
//       components) under their original ids; numGlyphs shrinks to the highest used id + 1
//   buildTTF({ unitsPerEm, ascent, descent, glyphs: [{ advance, contours: [[[x, y, on?], …]] } | { advance, components:
//       [{ glyph, dx, dy }] }], cmap: { cp: gid }, name, hmetrics, fsType, weight }) -> Uint8Array
//   writeSFNT(tables: { tag: Uint8Array }) -> Uint8Array   (table directory, checksums, head.checkSumAdjustment)
//   tableChecksum(bytes)

//
// Robustness policy: fonts come from users, so every offset read from the file is bounds-checked against the buffer
// (truncated tables throw a named error, out-of-range glyph indices are skipped) and every loop driven by file data
// has a hard cap (cmap groups, composite components). All multi-byte reads go through DataView: SFNT is big-endian.
// Hinting tables (cvt, fpgm, prep) are copied verbatim into subsets because glyph programs reference them by index.

const u8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));
const tagOf = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// --- reading ------------------------------------------------------------------------------------------------------

function directory(b, dv, index) {
  let base = 0;
  const first = dv.getUint32(0);
  if (first === 0x74746366) { // 'ttcf'
    const n = dv.getUint32(8);
    if (index < 0 || index >= n) throw new Error(`TTF: collection has ${n} fonts, index ${index}`);
    base = dv.getUint32(12 + index * 4);
  }
  const ver = dv.getUint32(base);
  if (ver === 0x4f54544f) throw new Error('TTF: CFF-based OpenType (OTTO) has no glyf outlines; use a TrueType font');
  if (ver !== 0x00010000 && ver !== 0x74727565) throw new Error('TTF: not a TrueType font (version 0x' + ver.toString(16) + ')');
  const n = dv.getUint16(base + 4);
  const t = {};
  for (let i = 0; i < n; i++) {
    const o = base + 12 + i * 16;
    const off = dv.getUint32(o + 8), len = dv.getUint32(o + 12);
    if (off + len > b.length) throw new Error('TTF: table ' + tagOf(b, o) + ' is truncated');
    t[tagOf(b, o)] = { off, len };
  }
  return t;
}

// cmap -> Map(code point -> glyph id). Unicode subtables (3/1, 3/10, 0/*): format 4 first, format 12 over it (a font
// may have only format 4, e.g. Noto Sans Georgian). Symbol fonts (3/0) map U+F0xx; their codes are also exposed at xx.
function readCmap(b, dv, off) {
  const map = new Map();
  const n = dv.getUint16(off + 2);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const o = off + 4 + i * 8;
    const sub = off + dv.getUint32(o + 4);
    if (sub + 4 > b.length) continue;
    subs.push({ pid: dv.getUint16(o), eid: dv.getUint16(o + 2), sub, fmt: dv.getUint16(sub) });
  }
  const unicode = (s) => s.pid === 0 || (s.pid === 3 && (s.eid === 1 || s.eid === 10));
  // Format 4: parallel arrays endCode / (reservedPad) / startCode / idDelta / idRangeOffset. idRangeOffset is a
  // self-relative byte offset FROM ITS OWN ARRAY SLOT into glyphIdArray - the notorious pointer trick of the spec,
  // reproduced literally (rangeO + i*2 + ro + (c - start)*2). Deltas are applied modulo 65536.
  const fmt4 = (s, shift) => {
    const seg2 = dv.getUint16(s.sub + 6), seg = seg2 >> 1;
    const endO = s.sub + 14, startO = endO + seg2 + 2, deltaO = startO + seg2, rangeO = deltaO + seg2;
    for (let i = 0; i < seg; i++) {
      const end = dv.getUint16(endO + i * 2), start = dv.getUint16(startO + i * 2);
      if (start === 0xffff || start > end) continue;
      const delta = dv.getInt16(deltaO + i * 2), ro = dv.getUint16(rangeO + i * 2);
      for (let c = start; c <= end; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = rangeO + i * 2 + ro + (c - start) * 2;
          if (gi + 1 >= b.length) continue;
          g = dv.getUint16(gi);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) { map.set(c, g); if (shift && c >= 0xf000 && c <= 0xf0ff && !map.has(c - 0xf000)) map.set(c - 0xf000, g); }
      }
    }
  };
  const uni = subs.filter(unicode);
  for (const s of uni) if (s.fmt === 4) fmt4(s, false);
  for (const s of uni) {
    if (s.fmt !== 12) continue;
    const groups = dv.getUint32(s.sub + 12);
    for (let i = 0; i < groups; i++) {
      const o = s.sub + 16 + i * 12;
      const start = dv.getUint32(o), end = dv.getUint32(o + 4), gid = dv.getUint32(o + 8);
      const last = Math.min(end, start + 0xffff, 0x10ffff); // a corrupt group of millions of codes must not hang
      for (let c = start; c <= last; c++) map.set(c, gid + (c - start));
    }
  }
  if (!map.size) for (const s of subs) if (s.pid === 3 && s.eid === 0 && s.fmt === 4) fmt4(s, true);
  return map;
}

function readName(b, dv, t) {
  const out = {};
  if (!t.name) return out;
  const off = t.name.off, count = dv.getUint16(off + 2), strOff = off + dv.getUint16(off + 4);
  for (let i = 0; i < count; i++) {
    const o = off + 6 + i * 12;
    const pid = dv.getUint16(o), eid = dv.getUint16(o + 2), lang = dv.getUint16(o + 4), id = dv.getUint16(o + 6);
    const len = dv.getUint16(o + 8), so = strOff + dv.getUint16(o + 10);
    if (id !== 1 && id !== 4 && id !== 6) continue;
    let s = '';
    if (pid === 3 || pid === 0) { for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(so + k)); }
    else if (pid === 1 && eid === 0) { for (let k = 0; k < len; k++) s += String.fromCharCode(b[so + k]); }
    else continue;
    const prefer = pid === 3 && (lang === 0x409 || !out[id]);
    if (s && (prefer || !out[id])) out[id] = s;
  }
  return out;
}

const cleanPsName = (s) => String(s || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);

// Metrics are converted to the PDF's 1/1000 em once here (k = 1000 / unitsPerEm), so the rest of the library never
// sees font units. Vertical metrics: hhea by default, OS/2 typo metrics when USE_TYPO_METRICS says the designer
// intended them - the same choice browsers make, so PDF line spacing matches the web rendering of the font.
// Missing capHeight / xHeight (old OS/2 versions) are estimated from the ascent rather than left at 0, because
// PDF readers use them for font substitution and a zero produces odd fallbacks.
export function parseTTF(bytes, { index = 0 } = {}) {
  const b = u8(bytes);
  if (b.length < 12) throw new Error('TTF: file too short');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = directory(b, dv, index);
  for (const need of ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'loca', 'glyf']) if (!t[need]) throw new Error('TTF: missing table ' + need);
  const head = t.head.off;
  const upem = dv.getUint16(head + 18) || 1000;
  const k = 1000 / upem;
  const longLoca = dv.getInt16(head + 50) === 1;
  const numGlyphs = dv.getUint16(t.maxp.off + 4);
  const numH = Math.max(1, Math.min(numGlyphs, dv.getUint16(t.hhea.off + 34)));
  // The last hmtx entry repeats for every glyph after numberOfHMetrics (a monospaced tail).
  const adv = new Uint16Array(numGlyphs);
  let lastW = 0;
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numH && t.hmtx.off + i * 4 + 2 <= b.length) lastW = dv.getUint16(t.hmtx.off + i * 4);
    adv[i] = lastW;
  }
  const loca = new Uint32Array(numGlyphs + 1);
  for (let i = 0; i <= numGlyphs; i++) {
    const p = t.loca.off + i * (longLoca ? 4 : 2);
    loca[i] = p + (longLoca ? 4 : 2) > t.loca.off + t.loca.len ? loca[i - 1] || 0 : longLoca ? dv.getUint32(p) : dv.getUint16(p) * 2;
  }
  let ascent = dv.getInt16(t.hhea.off + 4), descent = dv.getInt16(t.hhea.off + 6), lineGap = dv.getInt16(t.hhea.off + 8);
  let capHeight = 0, xHeight = 0, weight = 400, embeddable = true, fsSelection = 0;
  if (t['OS/2'] && t['OS/2'].len >= 78) {
    const o = t['OS/2'].off, ver = dv.getUint16(o);
    weight = dv.getUint16(o + 4);
    const fsType = dv.getUint16(o + 8);
    embeddable = !(fsType & 0x0002) || !!(fsType & 0x000c); // restricted licence, unless preview / editable allowed
    fsSelection = dv.getUint16(o + 62);
    if (fsSelection & 0x80) { ascent = dv.getInt16(o + 68); descent = dv.getInt16(o + 70); lineGap = dv.getInt16(o + 72); } // USE_TYPO_METRICS
    if (ver >= 2 && t['OS/2'].len >= 90) { xHeight = dv.getInt16(o + 86); capHeight = dv.getInt16(o + 88); }
  }
  let italicAngle = 0, fixedPitch = false;
  if (t.post && t.post.len >= 16) { italicAngle = dv.getInt32(t.post.off + 4) / 65536; fixedPitch = dv.getUint32(t.post.off + 12) !== 0; }
  const macStyle = dv.getUint16(head + 44);
  const names = readName(b, dv, t);
  const cmap = readCmap(b, dv, t.cmap.off);
  const glyf = t.glyf.off;
  const font = {
    bytes: b, tables: t, unitsPerEm: upem, numGlyphs, numberOfHMetrics: numH, longLoca, cmap,
    ascent: Math.round(ascent * k), descent: Math.round(descent * k), lineGap: Math.round(lineGap * k),
    capHeight: Math.round((capHeight || ascent * 0.7) * k), xHeight: Math.round((xHeight || ascent * 0.5) * k),
    bbox: [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)].map((v) => Math.round(v * k)),
    italicAngle, fixedPitch, weight, bold: !!(macStyle & 1) || weight >= 600, italic: !!(macStyle & 2) || !!(fsSelection & 1), embeddable,
    postscriptName: cleanPsName(names[6] || names[4] || names[1]) || 'Font', familyName: names[1] || '',
    gidFor(cp) { return cmap.get(cp) || 0; },
    advance(gid) { return adv[gid] || 0; },
    widthOf(gid) { return Math.round((adv[gid] || 0) * k); },
    glyphRange(gid) { return gid >= 0 && gid < numGlyphs && loca[gid + 1] > loca[gid] ? [glyf + loca[gid], glyf + loca[gid + 1]] : null; },
    components(gid) {
      const r = font.glyphRange(gid);
      if (!r || r[1] - r[0] < 10 || dv.getInt16(r[0]) >= 0) return [];
      const out = [];
      let p = r[0] + 10;
      for (let guard = 0; guard < 256 && p + 4 <= r[1]; guard++) {
        const flags = dv.getUint16(p), g = dv.getUint16(p + 2);
        out.push(g);
        p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        if (!(flags & 0x20)) break;
      }
      return out;
    },
  };
  return font;
}

// --- writing ------------------------------------------------------------------------------------------------------

// Sum of big-endian uint32 words, the table zero-padded to a multiple of 4 (missing bytes read as 0), modulo 2^32.
export function tableChecksum(b) {
  let sum = 0;
  const n = b.length;
  for (let i = 0; i < n; i += 4) sum = (sum + (((b[i] << 24) | ((b[i + 1] || 0) << 16) | ((b[i + 2] || 0) << 8) | (b[i + 3] || 0)) >>> 0)) >>> 0;
  return sum;
}

// Table directory sorted by tag (required for binary search by readers), searchRange/entrySelector/rangeShift from
// the largest power of two <= numTables, tables 4-byte aligned. head.checkSumAdjustment is zeroed, the whole file
// summed, then set to 0xB1B0AFBA - sum (the spec's magic constant). Note: the zeroing mutates the caller's head array.
export function writeSFNT(tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  const sr = (1 << es) * 16;
  let size = 12 + n * 16;
  for (const tg of tags) size += (tables[tg].length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00010000); dv.setUint16(4, n); dv.setUint16(6, sr); dv.setUint16(8, es); dv.setUint16(10, n * 16 - sr);
  let off = 12 + n * 16, headAt = -1;
  tags.forEach((tg, i) => {
    const data = tables[tg];
    if (tg === 'head') { data.fill(0, 8, 12); headAt = off; }
    const o = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[o + j] = tg.charCodeAt(j);
    dv.setUint32(o + 4, tableChecksum(data)); dv.setUint32(o + 8, off); dv.setUint32(o + 12, data.length);
    out.set(data, off);
    off += (data.length + 3) & ~3;
  });
  if (headAt >= 0) dv.setUint32(headAt + 8, (0xb1b0afba - tableChecksum(out)) >>> 0);
  return out;
}

// A cmap with only the terminating format-4 segment (the PDF uses glyph ids; a cmap keeps strict readers happy).
function emptyCmap() {
  const b = new Uint8Array(12 + 24);
  const dv = new DataView(b.buffer);
  dv.setUint16(2, 1); dv.setUint16(4, 3); dv.setUint16(6, 1); dv.setUint32(8, 12);
  const s = 12;
  dv.setUint16(s, 4); dv.setUint16(s + 2, 24); dv.setUint16(s + 6, 2); dv.setUint16(s + 8, 2); dv.setUint16(s + 10, 0); dv.setUint16(s + 12, 0);
  dv.setUint16(s + 14, 0xffff); dv.setUint16(s + 18, 0xffff); dv.setInt16(s + 20, 1); dv.setUint16(s + 22, 0);
  return b;
}

function post3(font) {
  const b = new Uint8Array(32);
  const src = font.tables.post;
  if (src && src.len >= 32) b.set(font.bytes.subarray(src.off, src.off + 32));
  new DataView(b.buffer).setUint32(0, 0x00030000);
  return b;
}

/** Glyph ids actually needed for `gids`: .notdef, the glyphs, and (recursively) their composite components. */
export function glyphClosure(font, gids) {
  const keep = new Set([0]);
  const stack = [...gids].filter((g) => g >= 0 && g < font.numGlyphs);
  while (stack.length) {
    const g = stack.pop();
    if (keep.has(g) && g !== 0) continue;
    keep.add(g);
    for (const c of font.components(g)) if (!keep.has(c) && c < font.numGlyphs) stack.push(c);
  }
  return keep;
}

// Subsetting by EMPTYING, not renumbering: unused glyphs keep their slot with zero length in loca, so glyph ids in
// the PDF content stay valid without a remapping table, and composite glyphs keep pointing at the right components.
// The tail beyond the highest used id is truncated. loca is always rewritten in the long format (no 2-byte halving
// constraint). cmap is replaced by an empty one and post by version 3 (no glyph names): the PDF addresses glyphs by
// id and ToUnicode supplies the text, so both would only add size.
export function subsetTTF(font, gids) {
  const keep = glyphClosure(font, gids);
  const count = Math.max(...keep) + 1;
  const b = font.bytes, t = font.tables;
  // a copy (never Buffer.slice, which is a view in Node: patching it would change the caller's font bytes)
  const table = (tg) => (t[tg] ? new Uint8Array(b.subarray(t[tg].off, t[tg].off + t[tg].len)) : null);
  let glyfLen = 0;
  for (const g of keep) { const r = font.glyphRange(g); if (r) glyfLen += (r[1] - r[0] + 3) & ~3; }
  const glyf = new Uint8Array(glyfLen);
  const loca = new Uint8Array((count + 1) * 4);
  const lv = new DataView(loca.buffer);
  let p = 0;
  for (let g = 0; g < count; g++) {
    lv.setUint32(g * 4, p);
    const r = keep.has(g) ? font.glyphRange(g) : null;
    if (r) { glyf.set(b.subarray(r[0], r[1]), p); p += (r[1] - r[0] + 3) & ~3; }
  }
  lv.setUint32(count * 4, p);
  const numH = Math.min(font.numberOfHMetrics, count);
  const hmtx = new Uint8Array(numH * 4 + (count - numH) * 2);
  hmtx.set(b.subarray(t.hmtx.off, t.hmtx.off + Math.min(hmtx.length, t.hmtx.len)));
  const head = table('head'); new DataView(head.buffer).setInt16(50, 1); // long loca
  const hhea = table('hhea'); new DataView(hhea.buffer).setUint16(34, numH);
  const maxp = table('maxp'); new DataView(maxp.buffer).setUint16(4, count);
  const out = { head, hhea, maxp, hmtx, loca, glyf, cmap: emptyCmap(), post: post3(font) };
  for (const tg of ['cvt ', 'fpgm', 'prep', 'OS/2']) { const x = table(tg); if (x) out[tg] = x; }
  return writeSFNT(out);
}

// --- synthetic fonts ----------------------------------------------------------------------------------------------

function cmapTable(map) {
  const pairs = [...map].map(([c, g]) => [+c, g]).filter(([c, g]) => c >= 0 && c <= 0x10ffff && g > 0).sort((a, b) => a[0] - b[0]);
  const bmp = pairs.filter(([c]) => c < 0xffff);
  const segs = [];
  for (const [c, g] of bmp) {
    const s = segs[segs.length - 1];
    if (s && c === s.end + 1 && g - c === s.delta) s.end = c;
    else segs.push({ start: c, end: c, delta: g - c });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  const len4 = 16 + n * 8;
  const big = pairs.some(([c]) => c > 0xffff);
  const groups = [];
  if (big) for (const [c, g] of pairs) { const x = groups[groups.length - 1]; if (x && c === x.end + 1 && g === x.gid + (c - x.start)) x.end = c; else groups.push({ start: c, end: c, gid: g }); }
  const len12 = big ? 16 + groups.length * 12 : 0;
  const nt = big ? 2 : 1;
  const b = new Uint8Array(4 + nt * 8 + len4 + len12);
  const dv = new DataView(b.buffer);
  dv.setUint16(2, nt);
  dv.setUint16(4, 3); dv.setUint16(6, 1); dv.setUint32(8, 4 + nt * 8);
  if (big) { dv.setUint16(12, 3); dv.setUint16(14, 10); dv.setUint32(16, 4 + nt * 8 + len4); }
  let o = 4 + nt * 8;
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  dv.setUint16(o, 4); dv.setUint16(o + 2, len4); dv.setUint16(o + 6, n * 2); dv.setUint16(o + 8, 2 << es); dv.setUint16(o + 10, es); dv.setUint16(o + 12, n * 2 - (2 << es));
  segs.forEach((s, i) => {
    dv.setUint16(o + 14 + i * 2, s.end);
    dv.setUint16(o + 16 + n * 2 + i * 2, s.start);
    dv.setUint16(o + 16 + n * 4 + i * 2, s.delta & 0xffff);
  });
  if (big) {
    o += len4;
    dv.setUint16(o, 12); dv.setUint32(o + 4, len12); dv.setUint32(o + 12, groups.length);
    groups.forEach((x, i) => { dv.setUint32(o + 16 + i * 12, x.start); dv.setUint32(o + 20 + i * 12, x.end); dv.setUint32(o + 24 + i * 12, x.gid); });
  }
  return b;
}

// Simple glyph in the plainest legal encoding: every point flagged on/off-curve only (no repeat or short-vector
// flags), coordinates as 16-bit deltas. Larger than a real font's packing, but trivially correct - this builder is
// for tests and generated icon fonts, not for size.
function glyphBytes(contours) {
  const pts = contours.flat();
  if (!pts.length) return { data: new Uint8Array(0), bbox: [0, 0, 0, 0], points: 0 };
  const xs = pts.map((p) => Math.round(p[0])), ys = pts.map((p) => Math.round(p[1]));
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const size = 10 + contours.length * 2 + 2 + pts.length * 5;
  const b = new Uint8Array((size + 3) & ~3);
  const dv = new DataView(b.buffer);
  dv.setInt16(0, contours.length);
  bbox.forEach((v, i) => dv.setInt16(2 + i * 2, v));
  let o = 10, end = -1;
  for (const c of contours) { end += c.length; dv.setUint16(o, end); o += 2; }
  dv.setUint16(o, 0); o += 2; // no instructions
  for (const p of pts) b[o++] = p[2] === false ? 0 : 1;
  let px = 0;
  for (const x of xs) { dv.setInt16(o, x - px); px = x; o += 2; }
  let py = 0;
  for (const y of ys) { dv.setInt16(o, y - py); py = y; o += 2; }
  return { data: b, bbox, points: pts.length };
}

function nameTable(names) {
  const recs = Object.entries(names).filter(([, s]) => s);
  const strs = recs.map(([, s]) => { const a = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { a[i * 2] = s.charCodeAt(i) >> 8; a[i * 2 + 1] = s.charCodeAt(i) & 255; } return a; });
  const start = 6 + recs.length * 12;
  const b = new Uint8Array(start + strs.reduce((a, s) => a + s.length, 0));
  const dv = new DataView(b.buffer);
  dv.setUint16(2, recs.length); dv.setUint16(4, start);
  let so = 0;
  recs.forEach(([id], i) => {
    const o = 6 + i * 12;
    dv.setUint16(o, 3); dv.setUint16(o + 2, 1); dv.setUint16(o + 4, 0x409); dv.setUint16(o + 6, +id); dv.setUint16(o + 8, strs[i].length); dv.setUint16(o + 10, so);
    b.set(strs[i], start + so);
    so += strs[i].length;
  });
  return b;
}

// A composite glyph: components [{ glyph, dx, dy }] placed with 16-bit offsets.
function compositeBytes(parts, bbox) {
  const b = new Uint8Array((10 + parts.length * 8 + 3) & ~3);
  const dv = new DataView(b.buffer);
  dv.setInt16(0, -1);
  bbox.forEach((v, i) => dv.setInt16(2 + i * 2, v));
  parts.forEach((c, i) => {
    const o = 10 + i * 8;
    dv.setUint16(o, 0x0001 | 0x0002 | (i < parts.length - 1 ? 0x0020 : 0)); // ARG_1_AND_2_ARE_WORDS, ARGS_ARE_XY_VALUES, MORE_COMPONENTS
    dv.setUint16(o + 2, c.glyph); dv.setInt16(o + 4, c.dx || 0); dv.setInt16(o + 6, c.dy || 0);
  });
  return { data: b, bbox, points: 0 };
}

function os2Table({ ascent, descent, lineGap, weight, fsType, capHeight, xHeight }) {
  const b = new Uint8Array(96);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, 4); dv.setUint16(4, weight); dv.setUint16(6, 5); dv.setUint16(8, fsType);
  dv.setUint16(62, weight >= 600 ? 0x20 : 0x40); dv.setUint16(64, 0x20); dv.setUint16(66, 0xffff);
  dv.setInt16(68, ascent); dv.setInt16(70, descent); dv.setInt16(72, lineGap); dv.setUint16(74, ascent); dv.setUint16(76, -descent);
  dv.setInt16(86, xHeight); dv.setInt16(88, capHeight);
  return b;
}

export function buildTTF({ unitsPerEm = 1000, ascent = 800, descent = -200, lineGap = 0, glyphs = [], cmap = {}, name = 'Synthetic', hmetrics = 0, fsType = 0, weight = 400, capHeight = 700, xHeight = 500 } = {}) {
  const list = glyphs.length ? glyphs : [{ advance: 500, contours: [] }];
  const enc = list.map((g) => glyphBytes(g.contours || []));
  list.forEach((g, i) => {
    if (!g.components) return;
    const bb = g.components.map((c) => { const e = enc[c.glyph]; return [e.bbox[0] + (c.dx || 0), e.bbox[1] + (c.dy || 0), e.bbox[2] + (c.dx || 0), e.bbox[3] + (c.dy || 0)]; });
    enc[i] = compositeBytes(g.components, [Math.min(...bb.map((x) => x[0])), Math.min(...bb.map((x) => x[1])), Math.max(...bb.map((x) => x[2])), Math.max(...bb.map((x) => x[3]))]);
  });
  const n = list.length;
  const glyfLen = enc.reduce((a, e) => a + e.data.length, 0);
  const glyf = new Uint8Array(glyfLen);
  const loca = new Uint8Array((n + 1) * 4);
  const lv = new DataView(loca.buffer);
  let p = 0;
  enc.forEach((e, i) => { lv.setUint32(i * 4, p); glyf.set(e.data, p); p += e.data.length; });
  lv.setUint32(n * 4, p);
  // hmetrics < n: only that many advance + lsb pairs, the rest are lsb only (the monospaced tail of real fonts)
  const nh = hmetrics > 0 && hmetrics < n ? hmetrics : n;
  const hmtx = new Uint8Array(nh * 4 + (n - nh) * 2);
  const hv = new DataView(hmtx.buffer);
  list.forEach((g, i) => {
    if (i < nh) { hv.setUint16(i * 4, Math.max(0, Math.round(g.advance || 0))); hv.setInt16(i * 4 + 2, enc[i].bbox[0]); }
    else hv.setInt16(nh * 4 + (i - nh) * 2, enc[i].bbox[0]);
  });
  const all = enc.filter((e) => e.data.length);
  const bb = all.length ? [Math.min(...all.map((e) => e.bbox[0])), Math.min(...all.map((e) => e.bbox[1])), Math.max(...all.map((e) => e.bbox[2])), Math.max(...all.map((e) => e.bbox[3]))] : [0, 0, 0, 0];
  const head = new Uint8Array(54);
  const h = new DataView(head.buffer);
  h.setUint32(0, 0x00010000); h.setUint32(4, 0x00010000); h.setUint32(12, 0x5f0f3cf5); h.setUint16(16, 0x000b); h.setUint16(18, unitsPerEm);
  bb.forEach((v, i) => h.setInt16(36 + i * 2, v));
  h.setUint16(44, weight >= 600 ? 1 : 0); h.setUint16(46, 8); h.setInt16(48, 2); h.setInt16(50, 1);
  const hhea = new Uint8Array(36);
  const hh = new DataView(hhea.buffer);
  hh.setUint32(0, 0x00010000); hh.setInt16(4, ascent); hh.setInt16(6, descent); hh.setInt16(8, lineGap);
  hh.setUint16(10, Math.max(0, ...list.map((g) => g.advance || 0))); hh.setInt16(18, 1); hh.setUint16(34, nh);
  const maxp = new Uint8Array(32);
  const mv = new DataView(maxp.buffer);
  mv.setUint32(0, 0x00010000); mv.setUint16(4, n); mv.setUint16(6, Math.max(0, ...enc.map((e) => e.points)));
  mv.setUint16(8, Math.max(0, ...list.map((g) => (g.contours || []).length))); mv.setUint16(14, 1);
  mv.setUint16(28, Math.max(0, ...list.map((g) => (g.components || []).length))); mv.setUint16(30, list.some((g) => g.components) ? 1 : 0);
  const map = cmap instanceof Map ? cmap : new Map(Object.entries(cmap).map(([k, v]) => [+k, v]));
  const post = new Uint8Array(32); new DataView(post.buffer).setUint32(0, 0x00030000);
  return writeSFNT({
    head, hhea, maxp, hmtx, loca, glyf, cmap: cmapTable(map), post, 'OS/2': os2Table({ ascent, descent, lineGap, weight, fsType, capHeight, xHeight }),
    name: nameTable({ 1: name, 4: name, 6: cleanPsName(name) }),
  });
}
