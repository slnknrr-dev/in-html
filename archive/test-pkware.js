// archive/test-pkware.js - tests of the legacy PKZIP decoders: `node archive/test-pkware.js` (importing runs nothing).
// Test-only encoders make raw shrink, reduce (factors 1-4) and implode (4 / 8 KiB window, with and without the
// literal tree) streams of several inputs; the decoders must give the inputs back, also in small reads, and fail on
// cut or damaged streams. The same streams wrapped in a minimal ZIP go through the independent decoders found on the
// machine, 7-Zip (extraction, byte comparison) and Info-ZIP UnZip (`unzip -t`, CRC-32), so the encoders (and with
// them the decoders) follow the real formats. Neither decodes reduce (7-Zip has no reduce; UnZip 6 is usually built
// COPYRIGHT_CLEAN): entries a tool refuses are reported, not failed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from '../codec/crc32.js';
import { ArchiveError, Reader, bytesStream, concat, readAll } from './io.js';
import { explodeStream, unreduceStream, unshrinkStream } from './pkware.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const te = new TextEncoder();
const DLE = 0x90;

// --- test-only encoders ----------------------------------------------------------------------------------------

class BitW {
  constructor() { this.buf = new Uint8Array(1 << 16); this.n = 0; this.bb = 0; this.bc = 0; }
  put(v, k) { // LSB first, k <= 16
    this.bb |= v << this.bc;
    this.bc += k;
    while (this.bc >= 8) {
      if (this.n === this.buf.length) { const b = new Uint8Array(this.n * 2); b.set(this.buf); this.buf = b; }
      this.buf[this.n++] = this.bb & 255;
      this.bb >>>= 8;
      this.bc -= 8;
    }
  }
  bytes() { if (this.bc) this.put(0, 8 - this.bc); return this.buf.slice(0, this.n); }
}

const stats = { shrinkClears: 0, shrinkWidth: 9, sets: new Set() };

// Shrink: LZW whose encoder keeps an exact model of the decoder's table. The decoder adds (previous code, first byte)
// when it reads a code, so the entry for the code just sent is added after any control codes that follow it. When
// the table gets full the next code is sent as a single byte (never a leaf) and a partial clear follows.
function shrink(data) {
  const N = 8192, FREE = 0xffff;
  const parent = new Uint16Array(N).fill(FREE), suffix = new Uint8Array(N), isParent = new Uint8Array(N);
  const dict = new Map(), w = new BitW();
  let width = 9, head = 257, used = 0, mustClear = false;
  const emit = (code) => {
    while (code >= 1 << width) { w.put(256, width); w.put(1, width); width++; }
    stats.shrinkWidth = Math.max(stats.shrinkWidth, width);
    w.put(code, width);
  };
  const clear = () => {
    w.put(256, width);
    w.put(2, width);
    stats.shrinkClears++;
    isParent.fill(0);
    for (let i = 257; i < N; i++) if (parent[i] !== FREE && parent[i] > 256) isParent[parent[i]] = 1;
    for (let i = 257; i < N; i++) {
      if (parent[i] !== FREE && !isParent[i]) { dict.delete(parent[i] * 256 + suffix[i]); parent[i] = FREE; used--; }
    }
    head = 257;
  };
  if (data.length) {
    let cur = data[0];
    for (let i = 1; i < data.length; i++) {
      const c = data[i];
      if (!mustClear) {
        const k = dict.get(cur * 256 + c);
        if (k !== undefined) { cur = k; continue; }
      }
      emit(cur);
      if (mustClear) { clear(); mustClear = false; }
      let f = head;
      while (parent[f] !== FREE) f++;
      parent[f] = cur;
      suffix[f] = c;
      dict.set(cur * 256 + c, f);
      head = f + 1;
      if (++used === N - 257) mustClear = true;
      cur = c;
    }
    emit(cur);
  }
  return w.bytes();
}

// Greedy LZ77 over hash chains -> flat [len, dist | byte] pairs (len 0: literal). `zeros`: the window starts full
// of zeros (both formats read zeros before the start), so leading zeros can be matched at once.
function lz(data, { minLen, maxLen, maxDist, zeros = false, accept = () => true, chain = 48 }) {
  const pre = zeros ? maxDist : 0, n = pre + data.length;
  const buf = new Uint8Array(n + 2);
  buf.set(data, pre);
  const head = new Int32Array(1 << 16).fill(-1), prev = new Int32Array(n).fill(-1);
  const hash = minLen === 2 ? (i) => (buf[i] << 8) | buf[i + 1] : (i) => ((buf[i] << 8) ^ (buf[i + 1] << 4) ^ buf[i + 2]) & 0xffff;
  const insert = (i) => { if (i + minLen <= n) { const h = hash(i); prev[i] = head[h]; head[h] = i; } };
  for (let i = 0; i < pre; i++) insert(i);
  const toks = [];
  for (let i = pre; i < n;) {
    let best = 0, bestD = 0;
    if (i + minLen <= n) {
      const lim = Math.min(maxLen, n - i);
      for (let j = head[hash(i)], steps = chain; j >= 0 && i - j <= maxDist && steps-- > 0; j = prev[j]) {
        let l = 0;
        while (l < lim && buf[j + l] === buf[i + l]) l++;
        if (l >= minLen && l > best && accept(l, i - j)) { best = l; bestD = i - j; if (l === lim) break; }
      }
    }
    if (best) { toks.push(best, bestD); for (let k = 0; k < best; k++) insert(i + k); i += best; } else { toks.push(0, buf[i]); insert(i); i++; }
  }
  return toks;
}

const B = (n) => (n <= 2 ? 1 : 32 - Math.clz32(n - 1));

// Reduce: DLE matches (V = high distance bits | length bits, all-ones length bits add a byte), then follower sets
// chosen per previous byte by cost.
function reduce(data, factor, { zeros = false } = {}) {
  const lmask = [0, 127, 63, 31, 15][factor], dshift = 8 - factor;
  // V = 0 would read as a literal DLE: a 3-byte match needs a distance above 256.
  const toks = lz(data, { minLen: 3, maxLen: lmask + 255 + 3, maxDist: 256 << factor, zeros, accept: (l, d) => l > 3 || d > 256 });
  const mid = [];
  for (let t = 0; t < toks.length; t += 2) {
    if (!toks[t]) { const b = toks[t + 1]; if (b === DLE) mid.push(DLE, 0); else mid.push(b); continue; }
    const L = toks[t] - 3, d = toks[t + 1] - 1;
    mid.push(DLE, ((d >> 8) << dshift) | Math.min(L, lmask));
    if (L >= lmask) mid.push(L - lmask);
    mid.push(d & 255);
  }
  const cnt = Array.from({ length: 256 }, () => new Uint32Array(256));
  let last = 0;
  for (const c of mid) { cnt[last][c]++; last = c; }
  const sets = [];
  for (let j = 0; j < 256; j++) {
    const cand = [...Array(256).keys()].filter((c) => cnt[j][c]).sort((a, b) => cnt[j][b] - cnt[j][a] || a - b);
    const total = cand.reduce((s, c) => s + cnt[j][c], 0);
    let bestN = 0, bestCost = 8 * total, inSet = 0;
    for (let n = 1; n <= Math.min(32, cand.length); n++) {
      inSet += cnt[j][cand[n - 1]];
      const cost = 8 * n + inSet * (1 + B(n)) + (total - inSet) * 9;
      if (cost < bestCost) { bestCost = cost; bestN = n; }
    }
    sets[j] = cand.slice(0, bestN);
    stats.sets.add(bestN);
  }
  const w = new BitW();
  for (let x = 255; x >= 0; x--) { w.put(sets[x].length, 6); for (const c of sets[x]) w.put(c, 8); }
  last = 0;
  for (const c of mid) {
    const s = sets[last], i = s.indexOf(c);
    if (!s.length) w.put(c, 8);
    else if (i >= 0) { w.put(0, 1); w.put(i, B(s.length)); } else { w.put(1, 1); w.put(c, 8); }
    last = c;
  }
  return w.bytes();
}

// Huffman code lengths over all symbols (every symbol needs a code in a Shannon-Fano tree), limited to `limit` bits
// and complete.
// Length-limited and complete codes matter here: implode's Shannon-Fano trees must assign a code to every
// symbol, and an incomplete or over-long code set would make the decoder accept streams real PKZIP never wrote.
function codeLengths(freq, limit) {
  const nodes = freq.map((w, sym) => ({ w, sym, up: null }));
  let live = nodes.slice();
  while (live.length > 1) {
    live.sort((a, b) => a.w - b.w);
    const [a, b] = live;
    const p = { w: a.w + b.w, up: null };
    a.up = p; b.up = p;
    live = live.slice(2);
    live.push(p);
  }
  const lens = nodes.map((nd) => { let d = 0; for (let x = nd; x.up; x = x.up) d++; return d; });
  const num = new Array(Math.max(limit, ...lens) + 1).fill(0);
  for (const l of lens) num[Math.min(l, limit)]++;
  let total = 0;
  for (let i = 1; i <= limit; i++) total += num[i] * 2 ** (limit - i);
  while (total > 2 ** limit) {
    num[limit]--;
    for (let i = limit - 1; i > 0; i--) if (num[i]) { num[i]--; num[i + 1] += 2; break; }
    total--;
  }
  const bySym = [...freq.keys()].sort((a, b) => freq[b] - freq[a] || a - b);
  const out = new Array(freq.length);
  let k = 0;
  for (let l = 1; l <= limit; l++) for (let c = 0; c < num[l]; c++) out[bySym[k++]] = l;
  return out;
}

// A Shannon-Fano tree: description bytes and codes. The codes are taken as the bit complement of canonical
// (deflate-style) codes, which is what APPNOTE's construction yields for a complete code (Info-ZIP's view).
function sfTree(freq) {
  const lens = codeLengths(freq.map((f) => f * 64 + 1), 16);
  const desc = [];
  for (let i = 0; i < lens.length;) {
    let run = 1;
    while (i + run < lens.length && lens[i + run] === lens[i] && run < 16) run++;
    desc.push(((run - 1) << 4) | (lens[i] - 1));
    i += run;
  }
  const count = new Array(18).fill(0), next = new Array(18).fill(0);
  for (const l of lens) count[l]++;
  for (let l = 1, code = 0; l <= 16; l++) { code = (code + count[l - 1]) << 1; next[l] = code; }
  const codes = lens.map((l) => {
    const canon = next[l]++;
    const sf = ~canon & ((1 << l) - 1);
    let rev = 0;
    for (let i = 0; i < l; i++) rev |= ((sf >> (l - 1 - i)) & 1) << i; // MSB first on the wire
    return rev;
  });
  return { desc: Uint8Array.from([desc.length - 1, ...desc]), lens, codes };
}

function implode(data, { bigDictionary = false, literalTree = false, zeros = false } = {}) {
  const lowBits = bigDictionary ? 7 : 6, minLen = literalTree ? 3 : 2;
  const toks = lz(data, { minLen, maxLen: minLen + 63 + 255, maxDist: 64 << lowBits, zeros });
  const lf = new Array(256).fill(0), nf = new Array(64).fill(0), df = new Array(64).fill(0);
  for (let t = 0; t < toks.length; t += 2) {
    if (!toks[t]) lf[toks[t + 1]]++;
    else { nf[Math.min(toks[t] - minLen, 63)]++; df[(toks[t + 1] - 1) >> lowBits]++; }
  }
  const lit = literalTree ? sfTree(lf) : null, len = sfTree(nf), dist = sfTree(df);
  const w = new BitW();
  const code = (t, s) => w.put(t.codes[s], t.lens[s]);
  for (let t = 0; t < toks.length; t += 2) {
    if (!toks[t]) {
      w.put(1, 1);
      if (lit) code(lit, toks[t + 1]); else w.put(toks[t + 1], 8);
      continue;
    }
    const d = toks[t + 1] - 1, L = toks[t] - minLen;
    w.put(0, 1);
    w.put(d & ((1 << lowBits) - 1), lowBits);
    code(dist, d >> lowBits);
    code(len, Math.min(L, 63));
    if (L >= 63) w.put(L - 63, 8);
  }
  return concat([...(lit ? [lit.desc] : []), len.desc, dist.desc, w.bytes()]);
}

// Minimal ZIP (local headers, central directory, end record) around raw streams, for 7-Zip.
function zip(entries) {
  const parts = [], central = [];
  let off = 0;
  for (const e of entries) {
    const name = te.encode(e.name), crc = crc32(e.data);
    const lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 10, true); v.setUint16(6, e.flags, true); v.setUint16(8, e.method, true);
    v.setUint16(12, 0x21, true); v.setUint32(14, crc, true); v.setUint32(18, e.comp.length, true); v.setUint32(22, e.data.length, true);
    v.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 10, true); c.setUint16(6, 10, true); c.setUint16(8, e.flags, true); c.setUint16(10, e.method, true);
    c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, e.comp.length, true); c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    ch.set(name, 46);
    parts.push(lh, e.comp);
    central.push(ch);
    off += lh.length + e.comp.length;
  }
  const cd = concat(central), end = new Uint8Array(22), x = new DataView(end.buffer);
  x.setUint32(0, 0x06054b50, true); x.setUint16(8, entries.length, true); x.setUint16(10, entries.length, true);
  x.setUint32(12, cd.length, true); x.setUint32(16, off, true);
  return concat([...parts, cd, end]);
}

// External decoders: check(zipFile, workDir, entries) -> Map(name -> 'ok' | 'unsupported' | problem).
const findExe = (list) => list.find((p) => p && fs.existsSync(p));
const ORACLES = [
  {
    name: '7-Zip',
    exe: findExe([process.env.SEVENZIP, 'C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe', '/usr/bin/7z', '/usr/bin/7zz', '/usr/local/bin/7zz', '/opt/homebrew/bin/7zz']),
    check(exe, file, dir, entries) {
      const outDir = path.join(dir, '7z');
      const res = spawnSync(exe, ['x', '-y', '-bd', '-o' + outDir, file], { encoding: 'utf8', maxBuffer: 1 << 24 });
      const lines = ((res.stdout || '') + (res.stderr || '')).split(/\r?\n/);
      return new Map(entries.map((e) => {
        const line = lines.find((l) => l.includes(e.name) && /error|unsupported|crc|data/i.test(l));
        if (line) return [e.name, /unsupported/i.test(line) ? 'unsupported' : line.trim()];
        const f = path.join(outDir, e.name);
        if (!fs.existsSync(f)) return [e.name, 'missing'];
        const got = new Uint8Array(fs.readFileSync(f));
        return [e.name, got.length === e.data.length && got.every((x, i) => x === e.data[i]) ? 'ok' : 'different output'];
      }));
    },
  },
  {
    name: 'Info-ZIP UnZip',
    exe: findExe([process.env.UNZIP, 'C:/Program Files/Git/usr/bin/unzip.exe', '/usr/bin/unzip', '/usr/local/bin/unzip']),
    check(exe, file, dir, entries) {
      const res = spawnSync(exe, ['-t', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
      const status = new Map();
      for (const l of ((res.stdout || '') + (res.stderr || '')).split(/\r?\n/)) {
        const m = /^\s*(testing|skipping):\s+(\S+)\s+(.*)$/.exec(l);
        if (m) status.set(m[2], m[1] === 'testing' && m[3].trim() === 'OK' ? 'ok' : /not supported/.test(m[3]) ? 'unsupported' : m[3].trim());
      }
      return new Map(entries.map((e) => [e.name, status.get(e.name) || 'not tested']));
    },
  },
];

// --- test data ---------------------------------------------------------------------------------------------------

let seed = 4711;
const rnd = (m) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % m; };
const WORDS = 'zip shrink reduce implode explode archive follower set tree code length distance window literal match table clear leaf node string byte bit stream header central directory local file data method flag size crc check the of and to in is it for on with as by this that from at or be are was'.split(' ');
function text(n) {
  let s = '';
  while (s.length < n) s += WORDS[rnd(WORDS.length)] + (rnd(10) ? ' ' : '.\r\n');
  return te.encode(s.slice(0, n));
}
const random = (n) => Uint8Array.from({ length: n }, () => rnd(256));
function runs() {
  const out = [];
  const run = (b, n) => { for (let i = 0; i < n; i++) out.push(b); };
  run(0, 3000); run(0x61, 2000); run(DLE, 700);
  for (let i = 0; i < 4000; i++) out.push(rnd(3) ? DLE : rnd(2) ? 0x41 + rnd(4) : 0);
  for (let i = 0; i < 300; i++) run(rnd(256), 1 + rnd(400));
  return Uint8Array.from(out);
}
function big() {
  const parts = [];
  let n = 0;
  while (n < 300000) { const p = rnd(3) ? text(3000 + rnd(30000)) : rnd(2) ? random(500 + rnd(6000)) : runs().subarray(rnd(5000)); parts.push(p); n += p.length; }
  return concat(parts).subarray(0, 300000);
}

// --- tests -------------------------------------------------------------------------------------------------------

export async function run() {
  let pass = 0, fail = 0;
  const ok = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`); } };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const code = (fn) => { try { fn(); return 'none'; } catch (e) { return e instanceof ArchiveError ? e.code : 'Error: ' + e.message; } };
  const rd = (bytes) => new Reader(bytesStream(bytes));
  const small = (s, step) => { const parts = []; for (let b; (b = s.read(step));) parts.push(b.slice()); return concat(parts); };

  const data = {
    text: text(60000), binary: random(20000), runs: runs(), empty: new Uint8Array(0), one: Uint8Array.of(0x90), big: big(),
    zeros: concat([new Uint8Array(3000), text(4000), new Uint8Array(9000)]),
  };
  const variants = [
    { id: 'shrink', method: 1, flags: 0, enc: shrink, dec: (b, o) => unshrinkStream(rd(b), o) },
    ...[1, 2, 3, 4].map((f) => ({ id: 'reduce' + f, method: 1 + f, flags: 0, enc: (d) => reduce(d, f), dec: (b, o) => unreduceStream(rd(b), f, o) })),
    ...[[false, false], [true, false], [false, true], [true, true]].map(([bigDictionary, literalTree]) => ({
      id: `implode${bigDictionary ? 8 : 4}k${literalTree ? 'lit' : ''}`, method: 6, flags: (bigDictionary ? 2 : 0) | (literalTree ? 4 : 0),
      enc: (d) => implode(d, { bigDictionary, literalTree }), dec: (b, o) => explodeStream(rd(b), { bigDictionary, literalTree, ...o }),
      zeros: (d) => implode(d, { bigDictionary, literalTree, zeros: true }),
    })),
  ];
  for (const f of [1, 2, 3, 4]) variants[f].zeros = (d) => reduce(d, f, { zeros: true });

  const t0 = Date.now();
  const zipEntries = [];
  for (const v of variants) {
    for (const [name, d] of Object.entries(data)) {
      const comp = v.enc(d);
      zipEntries.push({ name: `${v.id}-${name}.bin`, method: v.method, flags: v.flags, comp, data: d });
      let got;
      try { got = readAll(v.dec(comp, { size: d.length })); } catch (e) { ok(`${v.id} ${name}`, false, `${e.code} ${e.message}`); continue; }
      ok(`${v.id} ${name}`, same(got, d), `${got.length} bytes, want ${d.length}`);
      if (name === 'text' || name === 'runs') {
        try { ok(`${v.id} ${name} small reads`, same(small(v.dec(comp, { size: d.length }), 5), d)); } catch (e) { ok(`${v.id} ${name} small reads`, false, e.message); }
      }
      if (name === 'text' || name === 'binary') {
        // Without the size: shrink and explode end exactly with the input; reduce may decode padding bits.
        try {
          const all = readAll(v.dec(comp, {}));
          ok(`${v.id} ${name} no size`, v.method > 1 && v.method < 6 ? same(all.subarray(0, d.length), d) : same(all, d), `${all.length} bytes`);
        } catch (e) { ok(`${v.id} ${name} no size`, false, e.message); }
        // A cut stream: reduce / implode fail, shrink ends early.
        const c = code(() => { const all = readAll(v.dec(comp.subarray(0, comp.length >> 1), { size: d.length })); if (all.length >= d.length) throw new Error('not cut'); });
        ok(`${v.id} ${name} cut`, v.method === 1 ? c === 'none' : c === 'truncated', c);
      }
      if (name === 'zeros' && v.zeros) {
        const z = v.zeros(d);
        ok(`${v.id} zeros window shorter`, z.length < comp.length || v.method === 6, `${z.length} vs ${comp.length}`);
        zipEntries.push({ name: `${v.id}-zerowindow.bin`, method: v.method, flags: v.flags, comp: z, data: d });
        try { ok(`${v.id} zeros window`, same(readAll(v.dec(z, { size: d.length })), d)); } catch (e) { ok(`${v.id} zeros window`, false, e.message); }
      }
    }
  }
  const elapsed = Date.now() - t0;
  ok('encode + decode in time', elapsed < 20000, `${elapsed} ms`);
  ok('shrink partial clears exercised', stats.shrinkClears >= 2, String(stats.shrinkClears));
  ok('shrink widths up to 13 bits', stats.shrinkWidth === 13, String(stats.shrinkWidth));
  ok('reduce follower sets of 0, 1, 2 and 32', [0, 1, 2, 32].every((n) => stats.sets.has(n)), [...stats.sets].sort((a, b) => a - b).join(','));

  // Damaged input.
  const tc = implode(data.text, { literalTree: true });
  const badTree = tc.slice();
  badTree[0] = 0;
  ok('explode bad tree', ['corrupt', 'truncated'].includes(code(() => readAll(explodeStream(rd(badTree), { literalTree: true, size: 100 })))));
  const over = Uint8Array.of(3, 0xf0, 0xf0, 0xf0, 0xf0, 3, 0xf5, 0xf5, 0xf5, 0xf5, 0, 0, 0); // 64 one-bit codes
  ok('explode oversubscribed tree', code(() => readAll(explodeStream(rd(over), { size: 100 }))) === 'corrupt');
  ok('unreduce bad factor', code(() => unreduceStream(rd(new Uint8Array(4)), 5, {})) === 'unsupported');
  const badShrink = new BitW();
  badShrink.put(0x41, 9); badShrink.put(300, 9);
  ok('unshrink unknown code', code(() => readAll(unshrinkStream(rd(badShrink.bytes()), {}))) === 'corrupt');
  const badCtl = new BitW();
  badCtl.put(0x41, 9); badCtl.put(256, 9); badCtl.put(3, 9);
  ok('unshrink bad control code', code(() => readAll(unshrinkStream(rd(badCtl.bytes()), {}))) === 'corrupt');
  // KwKwK right away: "aaaa" is a, then code 257 (= a + a) before it is defined.
  const kw = new BitW();
  kw.put(0x61, 9); kw.put(257, 9); kw.put(0x61, 9);
  ok('unshrink kwkwk', new TextDecoder().decode(readAll(unshrinkStream(rd(kw.bytes()), {}))) === 'aaaa');
  ok('empty with size 0', [unshrinkStream, (r, o) => unreduceStream(r, 2, o), explodeStream].every((f) => readAll(f(rd(new Uint8Array(0)), { size: 0 })).length === 0));

  // Independent decoders on the same streams in a ZIP.
  const available = ORACLES.filter((o) => o.exe);
  if (!available.length) console.log('archive pkware: no 7-Zip / UnZip found, ZIP oracles skipped');
  if (available.length) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkware-'));
    try {
      const file = path.join(dir, 'legacy.zip');
      fs.writeFileSync(file, zip(zipEntries));
      for (const o of available) {
        const status = o.check(o.exe, file, dir, zipEntries);
        let agree = 0;
        const refused = new Set();
        for (const e of zipEntries) {
          const s = status.get(e.name);
          if (s === 'ok') { agree++; pass++; } else if (s === 'unsupported') refused.add(e.name.split('-')[0]);
          else { fail++; console.log(`FAIL ${o.name} ${e.name}: ${s}`); }
        }
        console.log(`archive pkware: ${o.name} agrees on ${agree} of ${zipEntries.length} entries` + (refused.size ? `; refuses ${[...refused].join(', ')}` : ''));
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`archive pkware: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
