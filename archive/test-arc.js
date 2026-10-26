// archive/test-arc.js - tests of the ARC reader: `node archive/test-arc.js` (importing the module runs nothing).
// No tool on hand writes ARC archives, so the archives are built here by test-only encoders of every header type,
// written after the packers of ARC 4 / 5.21 and PKARC: stored (1 and 2), packed (RLE), squeezed (RLE + Huffman),
// crunched with the old hash (5, 6 with RLE), with the new hash (7), crunched dynamic (8: RLE + 9-12 bit LZW with
// adaptive clears), squashed (9: 9-13 bit LZW). Listing, extraction, partial reads, damaged copies, SFX stubs,
// ARC 6 directories, resynchronisation, truncation and the CRC-16/ARC check value are covered.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArchiveError, Reader, bytesSource, bytesStream, concat, decodeText, readAll } from './io.js';
import { arcCrc16, arcLzwStream, arcRleStream, openArc, uncrunchStream, unsqueezeStream } from './arc.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const te = new TextEncoder();
const DLE = 0x90;

// --- test-only encoders ----------------------------------------------------------------------------------------

// CRC-16/ARC, bit by bit (independent of the table in arc.js).
function crc16(b) {
  let c = 0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  }
  return c;
}

class BitsLSB {
  constructor() { this.out = []; this.bb = 0; this.bc = 0; }
  bit(v) { this.bb |= (v & 1) << this.bc; if (++this.bc === 8) { this.out.push(this.bb); this.bb = 0; this.bc = 0; } }
  bytes() { if (this.bc) this.out.push(this.bb); return Uint8Array.from(this.out); }
}

// ARC's getc_ncr: a run of 3..255 equal bytes becomes <byte> DLE <count>, a run of two stays as is, DLE becomes
// DLE 0 and never starts a run.
// Test-only encoders are written from the format descriptions, not from the decoder, so a misreading shared by
// both cannot cancel out; the round trip then checks the decoder against an independent model of the format.
function pack(d) {
  const out = [];
  for (let i = 0; i < d.length;) {
    const c = d[i++];
    out.push(c);
    if (c === DLE) { out.push(0); continue; }
    let cnt = 1;
    while (i < d.length && d[i] === c && cnt < 255) { cnt++; i++; }
    if (cnt === 2) out.push(c);
    else if (cnt > 2) out.push(DLE, cnt);
  }
  return Uint8Array.from(out);
}

// Squeeze: RLE, then a Huffman tree over the bytes + end code 256, written as ARC's node table (root = node 0,
// children: node index or -(value + 1)), then the codes LSB first.
function squeeze(data) {
  const p = pack(data);
  const freq = new Array(257).fill(0);
  for (const b of p) freq[b]++;
  freq[256] = 1;
  let items = [];
  for (let v = 0; v < 257; v++) if (freq[v]) items.push({ w: freq[v], leaf: v });
  if (items.length === 1) return new Uint8Array(2); // only the end code: no nodes
  while (items.length > 1) {
    items.sort((a, b) => a.w - b.w || (a.leaf ?? 999) - (b.leaf ?? 999));
    const [a, b] = items;
    items = items.slice(2);
    items.push({ w: a.w + b.w, kids: [a, b] });
  }
  const nodes = [items[0]];
  items[0].id = 0;
  const codes = new Array(257);
  const walk = (node, bits) => {
    if (!node.kids) { codes[node.leaf] = bits; return; }
    node.kids.forEach((k, i) => walk(k, bits.concat(i)));
  };
  for (let i = 0; i < nodes.length; i++) for (const k of nodes[i].kids) if (k.kids) { k.id = nodes.length; nodes.push(k); }
  walk(items[0], []);
  const head = [nodes.length & 255, nodes.length >> 8];
  for (const n of nodes) for (const k of n.kids) { const v = (k.kids ? k.id : -(k.leaf + 1)) & 0xffff; head.push(v & 255, v >> 8); }
  const w = new BitsLSB();
  for (const b of p) for (const bit of codes[b]) w.bit(bit);
  for (const bit of codes[256]) w.bit(bit);
  return concat([Uint8Array.from(head), w.bytes()]);
}

// Crunch of ARC 4 (types 5-7): the hashed 4096-slot string table, 12-bit codes high nibble first.
function crunchOld(d, newHash) {
  const used = new Uint8Array(4096), foll = new Uint8Array(4096), next = new Uint16Array(4096), pred = new Uint16Array(4096);
  const hash = newHash ? (p, c) => (((p + c) & 0xffff) * 15073) & 0xfff : (p, c) => {
    const k = ((p + c) | 0x800) & 0xffff;
    return Math.floor((k * k) / 64) & 0xfff;
  };
  const add = (p, c) => {
    let i = hash(p, c);
    if (used[i]) {
      while (next[i] !== 0) i = next[i];
      let j = (i + 101) % 4096;
      while (used[j]) j = (j + 1) % 4096;
      next[i] = j;
      i = j;
    }
    used[i] = 1; next[i] = 0; pred[i] = p; foll[i] = c;
  };
  const find = (p, c) => {
    let i = hash(p, c);
    if (!used[i]) return -1;
    for (;;) {
      if (pred[i] === p && foll[i] === c) return i;
      i = next[i];
      if (!i) return -1;
    }
  };
  for (let c = 0; c < 256; c++) add(0xffff, c);
  const codes = [];
  if (d.length) {
    let w = find(0xffff, d[0]), room = 4096 - 256;
    for (let i = 1; i < d.length; i++) {
      const c = d[i], k = find(w, c);
      if (k >= 0) { w = k; continue; }
      codes.push(w);
      if (room) { add(w, c); room--; }
      w = find(0xffff, c);
    }
    codes.push(w);
  }
  const out = [];
  for (let i = 0; i < codes.length; i += 2) {
    const a = codes[i];
    if (i + 1 < codes.length) { const b = codes[i + 1]; out.push(a >> 4, ((a & 15) << 4) | (b >> 8), b & 255); }
    else out.push(a >> 4, (a & 15) << 4);
  }
  return Uint8Array.from(out);
}

// compress(1)-style LZW (types 8 and 9): codes in groups of `width` bytes, a width change or a clear flushes the
// whole group. Clears when the table is full, and every `clearEvery` codes when given (any time is legal).
function lzw(d, maxBits, clearEvery = 0) {
  const maxmax = 1 << maxBits, out = [], dict = new Map();
  let nbits = 9, maxcode = 511, free = 257, clearFlg = false, buf = new Uint8Array(16), offset = 0;
  const flush = (n) => { for (let k = 0; k < n; k++) out.push(buf[k]); buf = new Uint8Array(16); };
  const output = (code) => {
    if (code < 0) { if (offset > 0) flush((offset + 7) >> 3); return; }
    for (let b = 0; b < nbits; b++) if ((code >> b) & 1) buf[(offset + b) >> 3] |= 1 << ((offset + b) & 7);
    offset += nbits;
    if (offset === nbits * 8) { flush(nbits); offset = 0; }
    if (free > maxcode || clearFlg) {
      if (offset > 0) { flush(nbits); offset = 0; }
      if (clearFlg) { nbits = 9; maxcode = 511; clearFlg = false; } else { nbits++; maxcode = nbits === maxBits ? maxmax : (1 << nbits) - 1; }
    }
  };
  if (d.length) {
    let ent = d[0], count = 0;
    for (let i = 1; i < d.length; i++) {
      const c = d[i], key = ent * 256 + c, k = dict.get(key);
      if (k !== undefined) { ent = k; continue; }
      output(ent);
      count++;
      ent = c;
      if (free < maxmax && !(clearEvery && count % clearEvery === 0)) dict.set(key, free++);
      else { dict.clear(); free = 257; clearFlg = true; output(256); }
    }
    output(ent);
  }
  output(-1);
  return Uint8Array.from(out);
}

const ENCODE = {
  1: (d) => d,
  2: (d) => d,
  3: pack,
  4: squeeze,
  5: (d) => crunchOld(d, false),
  6: (d) => crunchOld(pack(d), false),
  7: (d) => crunchOld(pack(d), true),
  8: (d) => concat([Uint8Array.of(12), lzw(pack(d), 12)]),
  9: (d) => lzw(d, 13),
};
const NAMES = ['', 'Stored', 'Stored', 'Packed', 'Squeezed', 'Crunched', 'Crunched', 'Crunched', 'Crunched', 'Squashed'];

const DATE = ((1995 - 1980) << 9) | (7 << 5) | 14, TIME = (12 << 11) | (34 << 5) | (56 >> 1);

function header(type, name, packedLen, crc, size) {
  const h = new Uint8Array(type === 1 ? 25 : 29);
  const v = new DataView(h.buffer);
  h[0] = 0x1a;
  h[1] = type;
  h.set(typeof name === 'string' ? te.encode(name) : name, 2);
  v.setUint32(15, packedLen, true);
  v.setUint16(19, DATE, true);
  v.setUint16(21, TIME, true);
  v.setUint16(23, crc, true);
  if (type !== 1) v.setUint32(25, size, true);
  return h;
}

// [{ name, type, data, packed? (override), crc? }] -> archive bytes (end marker unless end === false).
function arc(files, end = true) {
  const parts = [];
  for (const f of files) {
    const packed = f.packed || ENCODE[f.type](f.data);
    parts.push(header(f.type, f.name, packed.length, f.crc ?? crc16(f.data), f.data.length), packed);
  }
  if (end) parts.push(Uint8Array.of(0x1a, 0));
  return concat(parts);
}

// --- test data ---------------------------------------------------------------------------------------------------

let seed = 12345;
const rnd = (m) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % m; };
const WORDS = 'the of and to in archive is that for it as was with be by on not he this are or his from at which but have an they you were her she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three'.split(' ');
function text(n) {
  const parts = [];
  let len = 0;
  while (len < n) {
    const w = WORDS[rnd(WORDS.length)] + (rnd(12) ? ' ' : rnd(2) ? '.\r\n' : ', ');
    parts.push(w);
    len += w.length;
  }
  return te.encode(parts.join('')).subarray(0, n);
}
const random = (n) => Uint8Array.from({ length: n }, () => rnd(256));
function dleMix() {
  const out = [];
  const run = (b, n) => { for (let i = 0; i < n; i++) out.push(b); };
  run(DLE, 300); run(0x41, 600); out.push(DLE, 0x42, DLE, DLE, 0x41, 0x41, 0x41); run(0, 255); run(0, 256); run(0, 2);
  for (let i = 0; i < 3000; i++) out.push(rnd(3) ? DLE : rnd(4) ? 0x41 + rnd(3) : 0);
  run(0x55, 1000);
  out.push(DLE);
  return Uint8Array.from(out);
}
// 1 MB: text, runs, binary stretches and a long repetitive stretch (the LZW tables fill up and get cleared).
function big() {
  const parts = [];
  let n = 0;
  while (n < 1 << 20) {
    const k = rnd(4);
    const p = k === 0 ? random(2000 + rnd(30000)) : k === 1 ? dleMix() : text(5000 + rnd(60000));
    parts.push(p);
    n += p.length;
  }
  return concat(parts).subarray(0, 1 << 20);
}

// --- tests -------------------------------------------------------------------------------------------------------

export async function run() {
  let pass = 0, fail = 0;
  const ok = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`); } };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  const code = (fn) => { try { fn(); return 'none'; } catch (e) { return e instanceof ArchiveError ? e.code : 'Error: ' + e.message; } };
  const extract = (a, e) => readAll(a.open(e));
  const readSmall = (a, e, step) => { const s = a.open(e), parts = []; for (let b; (b = s.read(step));) parts.push(b.slice()); return concat(parts); };

  eq('crc16 check value', arcCrc16(te.encode('123456789')), 0xbb3d);
  eq('crc16 independent', arcCrc16(te.encode('ARC archive')), crc16(te.encode('ARC archive')));

  const files = [
    { name: 'TEXT.TXT', data: text(30000) },
    { name: 'BINARY.BIN', data: random(10000) },
    { name: 'DLE.DAT', data: dleMix() },
    { name: 'EMPTY', data: new Uint8Array(0) },
    { name: 'ONE.TXT', data: te.encode('x') },
    { name: 'BIG.DAT', data: big() },
  ];
  const t0 = Date.now();
  const built = {};
  for (let type = 1; type <= 9; type++) {
    const list = files.map((f) => ({ ...f, type, packed: ENCODE[type](f.data) }));
    const bytes = arc(list);
    built[type] = { list, bytes };
    let a;
    try { a = openArc([bytesSource(bytes, 'test.arc')]); } catch (e) { ok(`open type ${type}`, false, e.message); continue; }
    eq(`listing type ${type}`, a.entries.map((e) => [e.path, e.size, e.packed, e.method, e.crc, e.dir, e.kind]),
      list.map((f) => [f.name, f.data.length, f.packed.length, NAMES[type], crc16(f.data), false, 'file']));
    eq(`mtime type ${type}`, a.entries[0].mtime && a.entries[0].mtime.getTime(), new Date(1995, 6, 14, 12, 34, 56).getTime());
    eq(`info type ${type}`, [a.format, a.info.methods, a.info.warnings, a.info.sfx], ['arc', [NAMES[type]], undefined, undefined]);
    for (const [i, f] of list.entries()) {
      let got;
      try { got = extract(a, a.entries[i]); } catch (e) { ok(`extract type ${type} ${f.name}`, false, `${e.code} ${e.message}`); continue; }
      ok(`extract type ${type} ${f.name}`, same(got, f.data), `${got.length} bytes, want ${f.data.length}`);
    }
    try { ok(`small reads type ${type}`, same(readSmall(a, a.entries[2], 7), files[2].data) && same(readSmall(a, a.entries[0], 1000), files[0].data)); } catch (e) { ok(`small reads type ${type}`, false, e.message); }
    // Damaged copies: a wrong CRC in the header, and a flipped byte in the middle of the big entry's data.
    const badCrc = arc(list.map((f, i) => (i === 0 ? { ...f, crc: crc16(f.data) ^ 0x0101 } : f)));
    const b = openArc([bytesSource(badCrc)]);
    eq(`bad crc type ${type}`, code(() => extract(b, b.entries[0])), 'checksum');
    eq(`bad crc others fine type ${type}`, code(() => extract(b, b.entries[1])), 'none');
    const damaged = bytes.slice();
    const bigOff = bytes.length - 2 - list[5].packed.length;
    damaged[bigOff + (list[5].packed.length >> 1)] ^= 0x24;
    const d = openArc([bytesSource(damaged)]);
    const c = code(() => extract(d, d.entries[5]));
    ok(`damaged data type ${type}`, type <= 2 ? c === 'checksum' : ['checksum', 'corrupt', 'truncated'].includes(c), c);
  }
  const elapsed = Date.now() - t0;
  ok('methods round trip in time', elapsed < 20000, `${elapsed} ms`);
  ok('crunched dynamic compresses', built[8].list[5].packed.length < files[5].data.length * 0.7);
  ok('old crunch compresses text', built[5].list[0].packed.length < files[0].data.length * 0.6);

  // Decoders on their own: clears at 9 and 10 bits, a 13-bit table, single-symbol squeeze, runs past 255.
  const dec = (s) => readAll(s);
  const t = files[0].data;
  for (const every of [50, 700, 3000]) {
    ok(`lzw 12 clear every ${every}`, same(dec(arcLzwStream(new Reader(bytesStream(concat([Uint8Array.of(12), lzw(t, 12, every)]))), 0)), t));
    ok(`lzw 13 clear every ${every}`, same(dec(arcLzwStream(new Reader(bytesStream(lzw(t, 13, every))), 13)), t));
  }
  // Hand-assembled squeezed stream: one node (0 -> 'a', 1 -> end, int16 -(value + 1)), bits 0 0 0 1 LSB first.
  ok('squeeze by hand', new TextDecoder().decode(dec(unsqueezeStream(new Reader(bytesStream(Uint8Array.of(1, 0, 0x9e, 0xff, 0xff, 0xfe, 0x08)))))) === 'aaa');
  const ones = new Uint8Array(5000).fill(7);
  ok('squeeze one symbol', same(dec(arcRleStream(new Reader(unsqueezeStream(new Reader(bytesStream(squeeze(ones))))))), ones));
  ok('squeeze empty', dec(unsqueezeStream(new Reader(bytesStream(squeeze(new Uint8Array(0)))))).length === 0);
  ok('rle long run', same(dec(arcRleStream(new Reader(bytesStream(pack(ones))))), ones));
  ok('rle bytes', same(Array.from(pack(Uint8Array.of(1, 1, 1, DLE, DLE, 2, 2, 3))), [1, DLE, 3, DLE, 0, DLE, 0, 2, 2, 3]));
  ok('uncrunch new hash direct', same(dec(uncrunchStream(new Reader(bytesStream(crunchOld(t, true))), true)), t));
  ok('uncrunch with the wrong hash fails', code(() => { if (same(dec(uncrunchStream(new Reader(bytesStream(crunchOld(t, true))), false)), t)) throw new Error('same'); }) !== 'Error: same');
  eq('lzw bad code', code(() => dec(arcLzwStream(new Reader(bytesStream(Uint8Array.of(12, 0x41, 0xfe, 0xff, 0xff))), 0))), 'corrupt');

  // Type 1 (old header), the empty archive, a missing end marker, trailing data, not an archive.
  const old = openArc([bytesSource(arc([{ name: 'OLD.TXT', type: 1, data: te.encode('old style') }, { name: 'NEW.TXT', type: 2, data: te.encode('new') }]))]);
  eq('old header', old.entries.map((e) => [e.path, e.size, e.packed]), [['OLD.TXT', 9, 9], ['NEW.TXT', 3, 3]]);
  eq('old header data', new TextDecoder().decode(extract(old, old.entries[1])), 'new');
  eq('empty archive', openArc([bytesSource(Uint8Array.of(0x1a, 0))]).entries.length, 0);
  const noEnd = openArc([bytesSource(arc([{ name: 'A.TXT', type: 3, data: te.encode('aaaaa') }], false))]);
  eq('no end marker', [noEnd.entries.length, noEnd.info.warnings], [1, ['the end-of-archive marker is missing']]);
  const padded = openArc([bytesSource(concat([built[3].bytes, new Uint8Array(100), new Uint8Array(28).fill(0x1a)]))]);
  eq('padding after the end', [padded.entries.length, padded.info.warnings], [6, undefined]);
  const tail = openArc([bytesSource(concat([built[2].bytes, te.encode('PK comment')]))]);
  eq('data after the end', tail.info.warnings, ['10 bytes after the end of the archive ignored']);
  eq('not an archive', code(() => openArc([bytesSource(te.encode('just some text, not an archive at all'))])), 'format');
  eq('not an archive with marker', code(() => openArc([bytesSource(Uint8Array.of(0x1a, 4, 1, 2, 3))])), 'format');

  // Self-extractor stub (with stray 0x1A bytes) in front of the archive.
  const stub = random(5000);
  for (let i = 0; i < 5000; i += 97) stub[i] = 0x1a;
  const sfx = openArc([bytesSource(concat([stub, built[4].bytes]))]);
  eq('sfx offset', [sfx.info.sfx, sfx.entries.length], [5000, 6]);
  ok('sfx extract', same(extract(sfx, sfx.entries[2]), files[2].data));

  // Damaged stretch between two entries: skipped with a warning, the next entry is found again.
  const two = [{ name: 'ONE.TXT', type: 3, data: te.encode('first entry') }, { name: 'TWO.TXT', type: 4, data: text(500) }];
  const first = arc([two[0]], false);
  const garbled = openArc([bytesSource(concat([first, te.encode('garbage!'), arc([two[1]])]))]);
  eq('resync', [garbled.entries.map((e) => e.path), garbled.info.warnings], [['ONE.TXT', 'TWO.TXT'], [`8 damaged bytes skipped at offset ${first.length}`]]);
  ok('resync extract', same(extract(garbled, garbled.entries[1]), two[1].data));

  // Truncated archive: listed with a warning, the cut entry fails with 'truncated'.
  const cut = openArc([bytesSource(built[6].bytes.subarray(0, built[6].bytes.length - 5000))]);
  eq('truncated listing', [cut.entries.length, cut.info.warnings], [6, ['the archive is truncated (in BIG.DAT)']]);
  eq('truncated extract', code(() => extract(cut, cut.entries[5])), 'truncated');
  eq('truncated others fine', code(() => extract(cut, cut.entries[0])), 'none');

  // PAK methods and unknown types: listed as unsupported, the listing goes on.
  const pak = concat([header(10, 'CRUSH.TXT', 4, 0, 10), Uint8Array.of(1, 2, 3, 4), header(11, 'DIST.TXT', 3, 0, 10), Uint8Array.of(5, 6, 7),
    header(15, 'ODD.TXT', 2, 0, 2), Uint8Array.of(8, 9), arc([{ name: 'OK.TXT', type: 2, data: te.encode('fine') }])]);
  const p = openArc([bytesSource(pak)]);
  eq('pak listing', p.entries.map((e) => [e.path, e.method, e.unsupported]), [['CRUSH.TXT', 'Crushed', 'Crushed (PAK method 10)'],
    ['DIST.TXT', 'Distilled', 'Distilled (PAK method 11)'], ['ODD.TXT', 'type 15', 'ARC header type 15'], ['OK.TXT', 'Stored', undefined]]);
  eq('pak open unsupported', code(() => extract(p, p.entries[0])), 'unsupported');
  eq('pak after unsupported', new TextDecoder().decode(extract(p, p.entries[3])), 'fine');

  // ARC 6: an information block (skipped) and a sub-directory holding a nested archive.
  const nested = arc([{ name: 'A.TXT', type: 3, data: te.encode('in sub') }, { name: 'B.BIN', type: 8, data: random(3000) }]);
  const nestedFiles = [te.encode('in sub')];
  const info = Uint8Array.of(5, 0, 0, 0x41, 0x42);
  const withDir = concat([header(20, 'INFO', info.length, 0, info.length), info, header(30, 'SUB', nested.length, 0, 0), nested,
    arc([{ name: 'AFTER.TXT', type: 2, data: te.encode('after') }])]);
  const wd = openArc([bytesSource(withDir)]);
  eq('dir listing', wd.entries.map((e) => [e.path, e.dir, e.kind]), [['SUB', true, 'dir'], ['SUB/A.TXT', false, 'file'], ['SUB/B.BIN', false, 'file'], ['AFTER.TXT', false, 'file']]);
  ok('dir extract', same(extract(wd, wd.entries[1]), nestedFiles[0]) && new TextDecoder().decode(extract(wd, wd.entries[3])) === 'after');
  eq('dir entry data', extract(wd, wd.entries[0]).length, 0);

  // Name charsets: CP437 by request, io.js' 'auto' guess otherwise.
  const nameBytes = Uint8Array.of(0x4d, 0x81, 0x4c, 0x4c, 0x45, 0x52, 0x2e, 0x54, 0x58, 0x54);
  const umlaut = arc([{ name: nameBytes, type: 2, data: te.encode('x') }]);
  eq('cp437 name', openArc([bytesSource(umlaut)], { charset: 'cp437' }).entries[0].path, 'MüLLER.TXT');
  eq('auto name', openArc([bytesSource(umlaut)]).entries[0].path, decodeText(nameBytes, 'auto'));
  eq('backslash name', openArc([bytesSource(arc([{ name: 'DIR\\F.TXT', type: 2, data: te.encode('x') }]))]).entries[0].path, 'DIR/F.TXT');

  console.log(`archive arc: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
