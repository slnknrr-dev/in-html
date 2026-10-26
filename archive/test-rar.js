// archive/test-rar.js - tests of the RAR readers: `node archive/test-rar.js` (importing the module runs nothing).
//
// RAR is extraction only (the unRAR licence), so no compressed RAR data is produced here: the archives below are
// STORED archives built by the test (RAR 1.4, RAR 1.5-4.x and RAR 5 containers: Unicode names, directories, empty
// files, symlinks, times, comments, split volumes, AES data and header encryption, MAC checksums, SFX prefix) that are
// listed and extracted, and cross-checked with 7-Zip (7z.exe) and bsdtar when those exist. Decoder building blocks
// are unit-tested: bit input, Huffman tables (codes encoded here), all filters (forward transforms written here), the
// RAR 3 / RAR 5 key derivations against node:crypto, BLAKE2sp against digests computed with `7z h -scrcBLAKE2sp`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Reader, bytesSource, bytesStream, readAll } from './io.js';
import { crc32 } from '../codec/crc32.js';
import { AesCbc } from '../crypto/aes.js';
import { blake2sp } from '../crypto/blake2.js';
import { BitInput, DecodeTable, Unpacker, windowSize } from './rarbits.js';
import { arm, delta, e8e9 } from './unpack50.js';
import { runStandard, standardFilter } from './unpack29.js';
import { rar3Key, rar5CheckSum, rar5Keys, rar5MacCrc, rar5MacDigest } from './rarcrypt.js';
import { checksum14, decodeRarUnicode, openRar } from './rar.js';
import { openRar5 } from './rar5.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const te = new TextEncoder();
const hex = (u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('hex');
const cat = (...parts) => {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u16 = (n) => [n & 255, (n >>> 8) & 255];
const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const u64 = (n) => [...u32(n % 4294967296), ...u32(Math.floor(n / 4294967296))];
const vint = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return o; };

let seed = 0x12345678;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8;
const randBytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = rnd() & 255; return b; };
const pad16 = (b) => cat(b, new Uint8Array((16 - (b.length % 16)) % 16));
const aesCbc = (key, iv, b) => new AesCbc(key, iv, { padding: false }).update(pad16(b));

// --- external tools ----------------------------------------------------------------------------------------------
const SEVENZIP = ['C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe', '/usr/bin/7z', '/usr/bin/7zz', '/usr/local/bin/7zz']
  .find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
const BSDTAR = ['C:/Windows/System32/tar.exe', '/usr/bin/bsdtar', '/usr/local/bin/bsdtar']
  .find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
// The official RAR (only to create archives for the reader; this library never writes RAR data).
const RAREXE = ['C:/Program Files/WinRAR/Rar.exe', 'C:/Program Files (x86)/WinRAR/Rar.exe', '/usr/bin/rar', '/usr/local/bin/rar']
  .find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
function tool(exe, args) {
  try { return { ok: true, out: execFileSync(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1 << 26 }) }; }
  catch (e) { return { ok: false, out: e.stdout || Buffer.alloc(0), err: String(e.stderr || e.message) }; }
}

// --- RAR 5 builder (stored data only) ------------------------------------------------------------------------------
const SIG5 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
function head5(type, hflags, fields, extra, dataSize) {
  let f = hflags;
  if (extra && extra.length) f |= 1;
  if (dataSize != null) f |= 2;
  const content = cat(vint(type), vint(f), extra && extra.length ? vint(extra.length) : [], dataSize != null ? vint(dataSize) : [], fields, extra || []);
  const sized = cat(vint(content.length), content);
  return cat(u32(crc32(sized)), sized);
}
const rec5 = (type, data) => { const body = cat(vint(type), data); return cat(vint(body.length), body); };
const main5 = (flags = 0, vol = 0) => head5(1, 0, cat(vint(flags | (vol ? 2 : 0)), vol ? vint(vol) : []));
const end5 = (more = false) => head5(5, 0, vint(more ? 1 : 0));

// f: { name, data, dir, mtime (unix s), host (0 Windows, 1 Unix), attr, blake, times, link: [type, target], enc }
// o: { type, hflags, part (bytes of this volume), crc (CRC field override) }
function file5(f, o = {}) {
  const data = f.data || new Uint8Array(0);
  let fflags = (f.dir ? 1 : 0) | (f.mtime != null ? 2 : 0), crc = crc32(data), packed = data, keys = null;
  const extra = [];
  if (f.enc) {
    const e = f.enc;
    keys = rar5Keys(e.pw, e.salt, e.lg2);
    packed = aesCbc(keys.key, e.iv, data);
    const check = e.check === false ? [] : [...keys.check, ...rar5CheckSum(keys.check)];
    extra.push(rec5(1, cat(vint(0), vint((e.check === false ? 0 : 1) | (e.mac ? 2 : 0)), [e.lg2], e.salt, e.iv, check)));
    if (e.mac) crc = rar5MacCrc(keys.hashKey, crc);
  }
  if (!f.blake) fflags |= 4;
  else {
    let d = blake2sp(data);
    if (f.enc && f.enc.mac) d = rar5MacDigest(keys.hashKey, d);
    extra.push(rec5(2, cat(vint(0), d)));
  }
  if (f.times) {
    const t = f.times; // { unix: [m, c, a] seconds + ns } or { win: [m filetime] }
    if (t.unix) extra.push(rec5(3, cat(vint(1 | 2 | 4 | 8 | 0x10), u32(t.unix[0]), u32(t.unix[1]), u32(t.unix[2]), u32(t.ns[0]), u32(t.ns[1]), u32(t.ns[2]))));
    else extra.push(rec5(3, cat(vint(2), u64(t.win))));
  }
  if (f.link) { const n = te.encode(f.link[1]); extra.push(rec5(5, cat(vint(f.link[0]), vint(0), vint(n.length), n))); }
  if (f.owner) { const u = te.encode(f.owner); extra.push(rec5(6, cat(vint(1 | 4), vint(u.length), u, vint(1000)))); }
  const name = te.encode(f.name);
  const part = o.part || packed;
  const fields = cat(vint(fflags), vint(data.length), vint(f.attr ?? (f.dir ? 0x10 : 0x20)), f.mtime != null ? u32(f.mtime) : [],
    fflags & 4 ? u32(o.crc ?? crc) : [], vint(0), vint(f.host ?? 0), vint(name.length), name);
  return cat(head5(o.type || 2, o.hflags || 0, fields, cat(...extra), part.length), part);
}

// Encrypted headers: an archive encryption header, then every header as IV + AES-256-CBC(header padded to 16).
function hcrypt5(pw, salt, lg2) {
  const k = rar5Keys(pw, salt, lg2);
  return { head: head5(4, 0, cat(vint(0), vint(1), [lg2], salt, k.check, rar5CheckSum(k.check))), key: k.key };
}
function enc5(key, headerWithData, dataLen = 0) {
  const h = headerWithData.subarray(0, headerWithData.length - dataLen), d = headerWithData.subarray(h.length);
  const iv = randBytes(16);
  return cat(iv, aesCbc(key, iv, h), d);
}

// --- RAR 4 builder ---------------------------------------------------------------------------------------------------
const MARK4 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
function block4(type, flags, body, crcEnd) { // crcEnd: RAR 2.x main header CRCs skip the embedded comment
  const size = 7 + body.length, h = cat([0, 0, type, flags & 255, flags >>> 8, size & 255, size >>> 8], body);
  const c = crc32(h, 2, crcEnd ?? h.length) & 0xffff;
  h[0] = c & 255; h[1] = c >>> 8;
  return h;
}
const main4 = (flags = 0) => block4(0x73, flags, [0, 0, 0, 0, 0, 0]);
const end4 = (flags = 0) => block4(0x7b, flags, []);
function dosTime(d) {
  return (((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) >>> 0;
}
// EncodeFileName: modes 0 (byte), 1 (byte + high byte), 2 (16 bits); the legacy name keeps ASCII, '_' otherwise.
function encodeName(name) {
  const units = Array.from({ length: name.length }, (_, i) => name.charCodeAt(i));
  const ansi = units.map((c) => (c < 0x80 ? c : 0x5f));
  const highs = units.filter((c) => c >= 0x100).map((c) => c >> 8);
  const high = highs.length ? highs[0] : 0;
  const enc = [high];
  for (let i = 0; i < units.length; i += 4) {
    let flags = 0;
    const data = [];
    for (let j = 0; j < 4; j++) {
      const c = units[i + j];
      let mode = 0;
      if (c == null) mode = 0;
      else if (c < 0x100) { mode = 0; data.push(c); }
      else if (c >> 8 === high) { mode = 1; data.push(c & 255); }
      else { mode = 2; data.push(c & 255, c >> 8); }
      flags |= mode << (6 - 2 * j);
    }
    enc.push(flags, ...data);
  }
  return cat(ansi, [0], enc);
}
// f: { name, data, dir, unicode, host (default 2 Windows), attr, mtime (Date), ext (extended mtime), large, ver,
//      pw (AES, salted), long }   o: { flags (extra), part, crc }
function file4(f, o = {}, type = 0x74) {
  const data = f.data || new Uint8Array(0);
  let flags = 0x8000 | (o.flags || 0) | (f.dir ? 0xe0 : 0x20), salt = null, packed = data;
  const nameBytes = f.unicode ? encodeName(f.name) : te.encode(f.name);
  if (f.unicode) flags |= 0x200;
  if (f.pw) {
    flags |= 4 | 0x400;
    salt = randBytes(8);
    const k = rar3Key(f.pw, salt);
    packed = aesCbc(k.key, k.iv, data);
  }
  const part = o.part || packed;
  if (f.large) flags |= 0x100;
  let ext = [];
  if (f.ext) { flags |= 0x1000; ext = [0x00, 0xf0, 0x40, 0x4b, 0x4c]; } // mtime: +1 s, 3 remainder bytes = 0.5 s
  const t = dosTime(f.mtime || new Date(2020, 0, 2, 3, 4, 6));
  const body = cat(u32(part.length), u32(data.length), [f.host ?? 2], u32(o.crc ?? crc32(data)), u32(t), [f.ver ?? (f.pw ? 29 : 20)],
    [0x30], u16(nameBytes.length), u32(f.attr ?? (f.dir ? 0x10 : 0x20)), f.large ? [...u32(0), ...u32(0)] : [], nameBytes, salt || [], ext);
  return { head: block4(type, flags, body), data: part };
}
const file4b = (f, o, type) => { const r = file4(f, o, type); return cat(r.head, r.data); };
function hp4(pw, block) { // MHD_PASSWORD: salt + AES-128-CBC(block padded)
  const salt = randBytes(8), k = rar3Key(pw, salt);
  return cat(salt, aesCbc(k.key, k.iv, block));
}

// --- tests -------------------------------------------------------------------------------------------------------
export async function run() {
  let pass = 0, fail = 0, skipped = 0;
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info ? ': ' + info : ''}`); } };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  const code = (name, fn, want) => {
    try { fn(); fail++; console.log(`FAIL ${name}: no error (want ${want})`); }
    catch (e) { if (e.code === want) pass++; else { fail++; console.log(`FAIL ${name}: ${e.code || ''} ${e.message} (want ${want})`); } }
  };
  const extract = (arc, e) => readAll(arc.open(e));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-rar-'));
  const write = (name, bytes) => { const p = path.join(tmp, name); fs.writeFileSync(p, bytes); return p; };

  try {
    // --- bit input ---------------------------------------------------------------------------------------------
    {
      const ops = [], bw = { bytes: [], acc: 0, n: 0 };
      const put = (v, n) => { for (let i = n - 1; i >= 0; i--) { bw.acc = (bw.acc << 1) | ((v >>> i) & 1); if (++bw.n === 8) { bw.bytes.push(bw.acc); bw.acc = bw.n = 0; } } };
      for (let i = 0; i < 60000; i++) {
        const k = rnd() % 20;
        if (k === 0) { const pad = (8 - bw.n) & 7; put(0, pad); const b = rnd() & 255; put(b, 8); ops.push(['byte', b]); }
        else if (k === 1) { const v = (rnd() * 256 + (rnd() & 255)) >>> 0; put(v, 32); ops.push(['b32', v]); }
        else { const n = 1 + (rnd() % 16), v = rnd() & ((1 << n) - 1); put(v, n); ops.push(['bits', n, v]); }
      }
      put(0, 7);
      const bytes = Uint8Array.from(bw.bytes);
      let off = 0;
      const stream = { read(max) { if (off >= bytes.length) return null; const n = Math.min(max, 1 + (rnd() % 999), bytes.length - off); const r = bytes.subarray(off, off + n); off += n; return r; } };
      const inp = new BitInput(new Reader(stream, 4096));
      let bad = 0;
      for (const op of ops) {
        if (inp.pos > inp.border) inp.refill();
        if (op[0] === 'byte') { inp.align(); if (inp.byte() !== op[1]) bad++; }
        else if (op[0] === 'b32') { if (inp.getbits32() !== op[1]) bad++; inp.addbits(32); }
        else if (inp.bits(op[1]) !== op[2]) bad++;
      }
      ok('bit input: 60000 mixed reads over ' + bytes.length + ' bytes in odd chunks', bad === 0, bad + ' mismatches');
      ok('bit input: not over the end', !inp.over());
      for (let i = 0; i < 4; i++) { if (inp.pos > inp.border) inp.refill(); inp.addbits(16); }
      if (inp.pos > inp.border) inp.refill();
      ok('bit input: over() after the end', inp.over());
    }

    // --- Huffman decode tables ---------------------------------------------------------------------------------
    for (const [size, skew0] of [[20, 1.3], [28, 1.15], [60, 1.25], [299, 1.06], [306, 1.08]]) {
      // Code lengths of a Huffman code over skewed random weights (some codes longer than the 10 quick bits).
      let lens, skew = skew0;
      for (let tries = 0; ; tries++) {
        const w = Array.from({ length: size }, (_, i) => (rnd() % 7 === 0 ? 0 : Math.floor(1e6 / Math.pow(skew, i)) + (rnd() % 5) + 1));
        lens = huffLengths(w);
        if (Math.max(...lens) <= 15 && lens.filter((l) => l).length >= 2) break;
        skew = 1 + (skew - 1) * 0.8;
      }
      const codes = canonical(lens), bw = { bytes: [], acc: 0, n: 0 };
      const put = (v, n) => { for (let i = n - 1; i >= 0; i--) { bw.acc = (bw.acc << 1) | ((v >>> i) & 1); if (++bw.n === 8) { bw.bytes.push(bw.acc); bw.acc = bw.n = 0; } } };
      const used = lens.map((l, i) => (l ? i : -1)).filter((i) => i >= 0), syms = [];
      for (let i = 0; i < 5000; i++) { const s = used[rnd() % used.length]; syms.push(s); put(codes[s], lens[s]); }
      put(0, 7);
      const t = new DecodeTable(size);
      t.build(Uint8Array.from(lens), 0, size);
      const inp = new BitInput(new Reader({ read: (() => { let d = false; return () => (d ? null : (d = true, Uint8Array.from(bw.bytes))); })() }));
      let bad = 0;
      for (const s of syms) { if (inp.pos > inp.border) inp.refill(); if (t.decode(inp) !== s) bad++; }
      ok(`Huffman table of ${size} symbols (max length ${Math.max(...lens)}): 5000 codes`, bad === 0, bad + ' mismatches');
    }

    // --- window, flushing and filter scheduling (a scripted decoder instead of a bitstream) ------------------------
    {
      class Scripted extends Unpacker {
        init(solid, script) { this.script = script; this.i = 0; this.chain = true; }
        run(target) {
          const win = this.win, W = this.W;
          while (this.abs < target) {
            if (this.i >= this.script.length) { this.done = true; break; }
            const op = this.script[this.i++];
            if (op.lit) for (const b of op.lit) { win[this.ptr++] = b; this.abs++; if (this.ptr === W) this.ptr = 0; }
            else if (op.dist) {
              let src = this.ptr - op.dist;
              if (src < 0) src += W;
              for (let k = 0; k < op.len; k++) { win[this.ptr++] = win[src++]; if (this.ptr === W) this.ptr = 0; if (src === W) src = 0; }
              this.abs += op.len;
            } else this.filters.push({ start: this.abs + op.at, length: op.length, x: op.x });
          }
        }
        applyFilter(f, data, fileOffset) { const o = data.slice(); for (let i = 0; i < o.length; i++) o[i] ^= f.x ^ (fileOffset + i); return o; }
      }
      // Script + expected output of one file (the expectation applies the filters to the plain LZ output).
      const makeFile = (hist, n) => {
        const script = [], plain = hist.slice();
        while (plain.length - hist.length < n) {
          const k = rnd() % 10;
          if (k < 5) { const lit = randBytes(1 + (rnd() % 300)); script.push({ lit }); plain.push(...lit); }
          else if (k < 9 && plain.length > 10) {
            const dist = 1 + (rnd() % Math.min(plain.length, 0x10000)), len = 2 + (rnd() % 400);
            script.push({ dist, len });
            for (let j = 0; j < len; j++) plain.push(plain[plain.length - dist]);
          } else script.push({ at: rnd() % 5000, length: rnd() % 0x30000, x: rnd() & 255, chain: rnd() % 3 === 0 });
        }
        // Filters: absolute starts, in order; overlapping ones are left out, a third get a chained second filter.
        const out = plain.slice(hist.length), fileStart = hist.length, kept = [];
        let pos = hist.length, last = 0;
        for (const op of script) {
          if (op.lit) pos += op.lit.length;
          else if (op.dist) pos += op.len;
          else {
            op.start = pos + op.at;
            if (op.start < last || op.start + op.length > plain.length) { op.at = 1e9; continue; } // never reached
            last = op.start + op.length;
            kept.push(op);
          }
        }
        const total = plain.length - hist.length;
        for (const f of kept) {
          const s = f.start - fileStart, chainOps = [f.x];
          if (f.chain) chainOps.push(f.x ^ 0x5a);
          for (const x of chainOps) for (let i = 0; i < f.length; i++) out[s + i] ^= x ^ ((s + i) & 255);
        }
        const withChains = [];
        for (const op of script) { withChains.push(op); if (op.chain && op.at !== 1e9) withChains.push({ at: op.at, length: op.length, x: op.x ^ 0x5a, sameStart: true }); }
        // A chained filter is declared at the same position (same start), right after the first one.
        return { script: withChains, out: Uint8Array.from(out.slice(0, total)), plain };
      };
      const u = new Scripted(windowSize(0x10000, -1, 0x40000));
      const f1 = makeFile([], 2600000), f2 = makeFile(f1.plain, 1600000);
      const s1 = u.file(new Reader(bytesStream(new Uint8Array(0))), f1.out.length, false, f1.script);
      const got1 = readAll(s1);
      ok(`window / filters: ${f1.out.length} bytes through a ${u.W}-byte ring with ${f1.script.filter((o) => o.length != null).length} filters`, hex(got1) === hex(f1.out));
      const s2 = u.file(new Reader(bytesStream(new Uint8Array(0))), f2.out.length, true, f2.script);
      ok('window / filters: solid continuation', hex(readAll(s2)) === hex(f2.out));
      const v = new Scripted(windowSize(0x10000, -1, 0x40000));
      const a = v.file(new Reader(bytesStream(new Uint8Array(0))), f1.out.length, false, f1.script);
      a.read(1000);
      const b = v.file(new Reader(bytesStream(new Uint8Array(0))), f2.out.length, true, f2.script);
      ok('window / filters: next solid file after a partly read one', hex(readAll(b)) === hex(f2.out));
      code('window / filters: the abandoned stream fails', () => a.read(10), 'aborted');
    }

    // --- filters -----------------------------------------------------------------------------------------------
    {
      const FILE_SIZE = 0x1000000;
      const e8Forward = (d, fileOffset, e9, mod24) => {
        for (let pos = 0; pos + 4 < d.length;) {
          const b = d[pos++];
          if (b === 0xe8 || (e9 && b === 0xe9)) {
            const offset = mod24 ? (pos + fileOffset) % FILE_SIZE : (pos + fileOffset) % 4294967296;
            const r = d[pos] | (d[pos + 1] << 8) | (d[pos + 2] << 16) | (d[pos + 3] << 24); // signed
            let a = r;
            if (r >= -offset && r < FILE_SIZE - offset) a = r + offset;
            else if (r >= FILE_SIZE - offset && r < FILE_SIZE) a = r - FILE_SIZE;
            d.set(u32(a >>> 0), pos);
            pos += 4;
          }
        }
      };
      for (const [e9, mod24, fo] of [[false, true, 0], [true, true, 0x1fffff0], [true, false, 0x7ff00000], [false, false, 12345]]) {
        const orig = randBytes(20000);
        for (let i = 0; i < 1500; i++) { const p = rnd() % 19990; orig[p] = rnd() & 1 ? 0xe8 : 0xe9; if (rnd() & 1) orig.set(u32(rnd() % 0x2000000 - 0x1000000), p + 1); }
        const d = orig.slice();
        e8Forward(d, fo, e9, mod24);
        e8e9(d, fo, e9, mod24);
        ok(`E8${e9 ? 'E9' : ''} filter (${mod24 ? 'RAR 5' : 'RAR 3'}, file offset ${fo})`, hex(d) === hex(orig));
      }
      {
        const orig = randBytes(8000), fo = 0x123456;
        for (let p = 0; p < 8000; p += 4) if (rnd() % 3 === 0) orig[p + 3] = 0xeb;
        const d = orig.slice();
        for (let p = 0; p + 3 < d.length; p += 4) {
          if (d[p + 3] !== 0xeb) continue;
          const o = (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16)) + Math.floor((fo + p) / 4);
          d[p] = o; d[p + 1] = o >> 8; d[p + 2] = o >> 16;
        }
        arm(d, fo);
        ok('ARM filter', hex(d) === hex(orig));
      }
      for (const ch of [1, 2, 3, 4, 7]) {
        const orig = randBytes(3001), src = new Uint8Array(orig.length);
        let s = 0;
        for (let c = 0; c < ch; c++) { let prev = 0; for (let p = c; p < orig.length; p += ch) { src[s++] = (prev - orig[p]) & 0xff; prev = orig[p]; } }
        const out = new Uint8Array(orig.length);
        delta(src, ch, out);
        ok(`RAR 5 DELTA filter, ${ch} channels`, hex(out) === hex(orig));
        const mem = new Uint8Array(0x40004);
        mem.set(src);
        const R = new Uint32Array(7);
        R[0] = ch; R[4] = orig.length;
        ok(`RAR 3 DELTA filter, ${ch} channels`, runStandard('delta', mem, R) && hex(mem.subarray(orig.length, 2 * orig.length)) === hex(orig));
      }
      for (const [w, posR] of [[3 * 40, 0], [3 * 17, 1], [3 * 5, 2]]) {
        const n = w * 30 + 7, orig = new Uint8Array(n);
        for (let i = 0; i < n; i++) orig[i] = (Math.floor(i / 3) * 3 + (i % 3) * 40 + (rnd() % 9)) & 0xff; // smooth image-like rows
        const D = orig.slice();
        for (let i = posR; i < n - 2; i += 3) { const g = D[i + 1]; D[i] = (D[i] - g) & 0xff; D[i + 2] = (D[i + 2] - g) & 0xff; }
        const src = [];
        for (let c = 0; c < 3; c++) {
          let prev = 0;
          for (let i = c; i < n; i += 3) {
            let pred = prev;
            if (i >= w + 3) {
              const up = D[i - w], ul = D[i - w - 3];
              pred = prev + up - ul;
              const pa = Math.abs(pred - prev), pb = Math.abs(pred - up), pc = Math.abs(pred - ul);
              pred = pa <= pb && pa <= pc ? prev : pb <= pc ? up : ul;
            }
            src.push((pred - D[i]) & 0xff);
            prev = D[i];
          }
        }
        const mem = new Uint8Array(0x40004);
        mem.set(src);
        const R = new Uint32Array(7);
        R[0] = w + 3; R[1] = posR; R[4] = n;
        ok(`RAR 3 RGB filter (width ${w}, R at ${posR})`, runStandard('rgb', mem, R) && hex(mem.subarray(n, 2 * n)) === hex(orig));
      }
      for (const ch of [1, 2, 4]) {
        const n = 4000, orig = new Uint8Array(n);
        for (let i = 0; i < n; i++) orig[i] = (128 + Math.round(90 * Math.sin(i / (7 + (i % ch))))) + (rnd() % 5);
        const src = new Uint8Array(n), dif = new Uint32Array(7);
        let s = 0;
        for (let c = 0; c < ch; c++) {
          let prevByte = 0, prevDelta = 0, d1 = 0, d2 = 0, d3 = 0, k1 = 0, k2 = 0, k3 = 0;
          dif.fill(0);
          for (let i = c, cnt = 0; i < n; i += ch, cnt++) {
            d3 = d2; d2 = prevDelta - d1; d1 = prevDelta;
            const p = ((8 * prevByte + k1 * d1 + k2 * d2 + k3 * d3) >>> 3) & 0xff, out = orig[i], cur = (p - out) & 0xff;
            src[s++] = cur;
            prevDelta = ((out - prevByte) << 24) >> 24;
            prevByte = out;
            const d = ((cur << 24) >> 24) * 8;
            dif[0] += Math.abs(d); dif[1] += Math.abs(d - d1); dif[2] += Math.abs(d + d1); dif[3] += Math.abs(d - d2);
            dif[4] += Math.abs(d + d2); dif[5] += Math.abs(d - d3); dif[6] += Math.abs(d + d3);
            if ((cnt & 0x1f) === 0) {
              let min = dif[0], num = 0;
              dif[0] = 0;
              for (let j = 1; j < 7; j++) { if (dif[j] < min) { min = dif[j]; num = j; } dif[j] = 0; }
              if (num === 1 && k1 >= -16) k1--; if (num === 2 && k1 < 16) k1++; if (num === 3 && k2 >= -16) k2--;
              if (num === 4 && k2 < 16) k2++; if (num === 5 && k3 >= -16) k3--; if (num === 6 && k3 < 16) k3++;
            }
          }
        }
        const mem = new Uint8Array(0x40004);
        mem.set(src);
        const R = new Uint32Array(7);
        R[0] = ch; R[4] = n;
        ok(`RAR 3 AUDIO filter, ${ch} channels`, runStandard('audio', mem, R) && hex(mem.subarray(n, 2 * n)) === hex(orig));
      }
      {
        const n = 16 * 2000 + 5, orig = randBytes(n), fo = 0x5670;
        const get = (d, bit, k) => { let v = 0; for (let i = 0; i < k; i++) v |= ((d[(bit + i) >> 3] >> ((bit + i) & 7)) & 1) << i; return v >>> 0; };
        const set = (d, bit, k, v) => { for (let i = 0; i < k; i++) { const b = bit + i; d[b >> 3] = (d[b >> 3] & ~(1 << (b & 7))) | (((v >>> i) & 1) << (b & 7)); } };
        const MASKS = [4, 4, 6, 6, 0, 0, 7, 7, 4, 4, 0, 0, 4, 4, 0, 0];
        const d = orig.slice();
        let hits = 0;
        for (let p = 0, f = fo >>> 4; p < n - 21; p += 16, f++) {
          const b = (d[p] & 0x1f) - 0x10;
          if (b < 0 || !MASKS[b]) continue;
          for (let i = 0; i <= 2; i++) {
            if (!(MASKS[b] & (1 << i))) continue;
            const st = p * 8 + i * 41 + 5;
            if (get(d, st + 37, 4) === 5) { hits++; set(d, st + 13, 20, (get(d, st + 13, 20) + f) & 0xfffff); }
          }
        }
        const mem = new Uint8Array(0x40004);
        mem.set(d);
        const R = new Uint32Array(7);
        R[4] = n; R[6] = fo;
        ok(`RAR 3 ITANIUM filter (${hits} branches)`, hits > 10 && runStandard('itanium', mem, R) && hex(mem.subarray(0, n)) === hex(orig));
      }
      ok('RarVM: unknown program is not a standard filter', standardFilter(randBytes(53)) === null && standardFilter(new Uint8Array(0)) === null);
    }

    // --- key derivation ----------------------------------------------------------------------------------------
    {
      const pw = 'pässwörd 1', salt = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const raw = Buffer.concat([Buffer.from(pw, 'utf16le'), Buffer.from(salt)]);
      const h = createHash('sha1'), iv = Buffer.alloc(16);
      for (let i = 0; i < 0x40000; i++) {
        h.update(raw);
        h.update(Buffer.from([i & 255, (i >> 8) & 255, (i >> 16) & 255]));
        if (i % 0x4000 === 0) iv[i / 0x4000] = h.copy().digest()[19];
      }
      const d = h.digest(), key = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) key[i] = d[4 * (i >> 2) + 3 - (i & 3)];
      const k = rar3Key(pw, salt);
      eq('RAR 3 key derivation (node:crypto SHA-1)', [hex(k.key), hex(k.iv)], [hex(key), hex(iv)]);
    }
    for (const lg2 of [0, 5, 15]) {
      const pw = 'Пароль-5', salt = randBytes(16), n = 2 ** lg2;
      const k = rar5Keys(pw, salt, lg2);
      const v1 = pbkdf2Sync(pw, salt, n + 16, 32, 'sha256'), v2 = pbkdf2Sync(pw, salt, n + 32, 32, 'sha256');
      const check = new Uint8Array(8);
      for (let i = 0; i < 32; i++) check[i & 7] ^= v2[i];
      eq(`RAR 5 key derivation 2^${lg2} (node:crypto PBKDF2)`, [hex(k.key), hex(k.hashKey), hex(k.check)], [hex(pbkdf2Sync(pw, salt, n, 32, 'sha256')), hex(v1), hex(check)]);
    }

    // --- BLAKE2sp (digests from 7-Zip 26.01: 7z h -scrcBLAKE2sp) -----------------------------------------------
    {
      let s = 12345;
      const gen = () => (s = (s * 1103515245 + 12345) >>> 0) >>> 24;
      const B2SP = [[0, 'dd0e891776933f43c7d032b08a917e25741f8aa9a12c12e1cac8801500f2ca4f'], [1, '3c2bd6bbda401b0623920f6b2f9d7bbf9d43466a19714d1331dc44c1e4552812'],
        [63, '54f370b0f286a4bb08b4c29949d30657511edee20533afc8df5c24200f025029'], [64, 'd4d45286cce1ac251ba7a4ab30d61b07a04faaa9657c17b1a89a207b14f86439'],
        [65, 'e45795e65bfd138d20e89232984388b43d908bb83966b1c57f4d8b5a53da1ac4'], [127, '350b2d1c7f9dbc5ef56de653ed140b8fac7894e5947d7a52ee9d361fb72f06a1'],
        [128, '4dbd698354bba75d201730ab1a1a502240a44ad1462e0c1176de2f6b7a6316ae'], [448, '6b8fd58ec6f85ae80318202371d97566346567dc64f5d04e16eed083484b05a1'],
        [511, '7a67ae7691b8f2e14c1a8f9084521d43e6cd4b3b925e81175307bd5eeedc808c'], [512, 'c1fb1ad6c44c9273c586616f240ee7a0e72b8cc88e45da46302ecf4bee40a52c'],
        [513, 'ca90c983761454567ad84e4ff1f4c8d528eae6dd588fd00e5291384c26b8a144'], [1000, 'cfa28f93113e40e63f93dc66fcd62011b9574245758228b85e91c567b6377c08'],
        [1024, '5c7912c264cd6d778d1500b4afa5b7caedf987c4590fd22e1fd35756d46776ab'], [1025, '4cf2441f0fcf8c42888d29ed1ab9e8ed494ee9f8f3b2d662bc67ec5f2ffa2112'],
        [4096, 'de8ef5b33fdb410d865f1b94800d665f9ef8f832478289cc32e02951da1450cd'], [65537, '0d01f4eac5eb0833f60c70d2827caf87d49c63fb2b0411bd0b3508eb1f21d3fd'],
        [1048576, 'a55aed8c560cd8ae87e8b370a9fddc0a253142b0472f1d9e205ed361fa21005f'], [1234567, 'a729b89928832bd707e488b384b2c00aac32148da98fc4d36508b0dcf76341ec']];
      let bad = 0;
      for (const [n, want] of B2SP) {
        const b = new Uint8Array(n);
        for (let i = 0; i < n; i++) b[i] = gen();
        const h = blake2sp.create();
        for (let i = 0; i < n;) { const k = Math.min(n - i, 1 + ((i * 7) % 700)); h.update(b.subarray(i, i + k)); i += k; }
        if (hex(blake2sp(b)) !== want || hex(h.digest()) !== want) { bad++; console.log('  BLAKE2sp mismatch at size ' + n); }
      }
      ok(`BLAKE2sp: ${B2SP.length} sizes, one-shot and streaming (vs 7-Zip)`, bad === 0);
    }

    // --- names -------------------------------------------------------------------------------------------------
    {
      const names = ['plain.txt', 'Ünïcödé/файл.txt', '日本語の名前.bin', 'mixed Ωmega ω 𝄞 clef'];
      let bad = 0;
      for (const n of names) {
        const b = encodeName(n), z = b.indexOf(0);
        if (decodeRarUnicode(b.subarray(0, z), b.subarray(z + 1)) !== n) bad++;
      }
      ok('RAR 4 Unicode names, modes 0-2', bad === 0);
      eq('RAR 4 Unicode names, mode 3 copy', decodeRarUnicode(te.encode('abcdefgh'), Uint8Array.from([0, 0xc0, 4])), 'abcdef');
      eq('RAR 4 Unicode names, mode 3 correction', decodeRarUnicode(te.encode('0@A'), Uint8Array.from([0x04, 0xc0, 0x81, 0x10])), '\u0440\u0450\u0451');
    }

    // --- RAR 5 archives ----------------------------------------------------------------------------------------
    const files = [
      { name: 'dir', dir: true, mtime: 1600000000 },
      { name: 'dir/hello.txt', data: te.encode('Hello, RAR 5!\n'), mtime: 1600000001, host: 1, attr: 0o100644, times: { unix: [1600000001, 1500000000, 1700000000], ns: [500000000, 0, 123456789] } },
      { name: 'dir/Ünïcödé файл 日本.bin', data: randBytes(70000), blake: true },
      { name: 'empty', data: new Uint8Array(0) },
      { name: 'win-time.txt', data: te.encode('windows time'), times: { win: 132539328000000000 } },
      { name: 'link', data: new Uint8Array(0), host: 1, attr: 0o120777, link: [1, 'dir/hello.txt'] },
      { name: 'owned', data: te.encode('owner'), host: 1, attr: 0o100600, owner: 'user' },
    ];
    {
      const cmt = file5({ name: 'CMT', data: te.encode('RAR 5 comment ✓') }, { type: 3 });
      const bytes = cat(SIG5, main5(), cmt, ...files.map((f) => file5(f)), end5());
      const arc = openRar5([bytesSource(bytes, 't.rar')]);
      eq('RAR 5: entries', arc.entries.map((e) => [e.path, e.kind, e.size ?? null]), files.map((f) => [f.name, f.dir ? 'dir' : f.link ? 'symlink' : 'file', f.dir ? 0 : f.data.length]));
      let bad = 0;
      for (let i = 0; i < files.length; i++) if (!files[i].dir && hex(extract(arc, arc.entries[i])) !== hex(files[i].data)) bad++;
      ok('RAR 5: extraction', bad === 0);
      eq('RAR 5: comment', arc.info.comment, 'RAR 5 comment ✓');
      eq('RAR 5: unix times with ns', [arc.entries[1].mtime.getTime(), arc.entries[1].ctime.getTime(), arc.entries[1].atime.getTime()], [1600000001500, 1500000000000, 1700000000123]);
      eq('RAR 5: windows time', arc.entries[4].mtime.toISOString(), '2021-01-01T00:00:00.000Z');
      eq('RAR 5: mode, link, owner, crc', [arc.entries[1].mode, arc.entries[5].link, arc.entries[6].owner.user, arc.entries[1].crc], [0o100644, 'dir/hello.txt', 'user', crc32(files[1].data)]);
      eq('RAR 5: methods / props', [arc.info.methods, arc.info.props[0]], [['Store'], ['Version', 'RAR 5']]);
      // via openRar too, and an SFX / appended copy
      eq('openRar delegates RAR 5', openRar([bytesSource(bytes)]).format, 'rar5');
      const sfx = openRar([bytesSource(cat(te.encode('MZ'), randBytes(5000), Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 1, 2, 3]), randBytes(3000), bytes))]);
      eq('RAR 5: SFX offset (fake signature skipped)', [sfx.info.sfx, sfx.entries.length, hex(extract(sfx, sfx.entries[2]))], [5013 + 3000, files.length, hex(files[2].data)]);
      // corrupt data -> checksum
      const broken = bytes.slice(), at = broken.length - 200;
      broken[at] ^= 0xff;
      const ba = openRar5([bytesSource(broken)]);
      code('RAR 5: damaged data -> checksum (BLAKE2sp)', () => readAll(ba.open(ba.entries[2])), 'checksum');
      code('RAR 5: not RAR', () => openRar5([bytesSource(randBytes(100))]), 'format');
      if (SEVENZIP) {
        const p = write('t5.rar', bytes);
        const t = tool(SEVENZIP, ['t', p]);
        ok('7-Zip tests the RAR 5 archive', t.ok, t.err);
        const l = tool(SEVENZIP, ['l', '-slt', '-sccUTF-8', p]).out.toString('utf8');
        const paths = [...l.matchAll(/^Path = (.*)$/gm)].map((m) => m[1].replace(/\\/g, '/')).slice(1);
        eq('7-Zip lists the same RAR 5 names', paths, files.map((f) => f.name));
        const x = tool(SEVENZIP, ['x', '-so', p, 'dir' + path.sep + files[2].name.slice(4)]);
        ok('7-Zip extracts the Unicode-named RAR 5 file', x.ok && hex(x.out) === hex(files[2].data), x.err);
      } else skipped++;
      if (BSDTAR) {
        const p = write('t5b.rar', bytes);
        const x = tool(BSDTAR, ['-xOf', p, 'dir/hello.txt']);
        ok('bsdtar extracts from the RAR 5 archive', x.ok && x.out.toString() === 'Hello, RAR 5!\n', x.err);
      } else skipped++;
    }
    { // volumes
      const data = randBytes(50000), f = { name: 'big.bin', data, mtime: 1650000000 };
      const parts = [data.subarray(0, 17000), data.subarray(17000, 40000), data.subarray(40000)];
      const vols = parts.map((part, i) => cat(SIG5, main5(1, i), i === 0 ? file5({ name: 'small.txt', data: te.encode('first') }) : [],
        file5(f, { part, hflags: (i > 0 ? 8 : 0) | (i < 2 ? 0x10 : 0), crc: i < 2 ? crc32(part) : crc32(data) }), end5(i < 2)));
      const arc = openRar5(vols.map((v, i) => bytesSource(v, `v.part${i + 1}.rar`)));
      eq('RAR 5 volumes: entries', arc.entries.map((e) => [e.path, e.size, e.packed]), [['small.txt', 5, 5], ['big.bin', 50000, 50000]]);
      ok('RAR 5 volumes: extraction across 3 volumes', hex(extract(arc, arc.entries[1])) === hex(data));
      eq('RAR 5 volumes: count', arc.info.volumes, 3);
      const two = openRar5(vols.slice(0, 2).map((v) => bytesSource(v)));
      code('RAR 5 volumes: missing volume', () => readAll(two.open(two.entries[1])), 'volume');
      ok('RAR 5 volumes: first file of a partial set', new TextDecoder().decode(extract(two, two.entries[0])) === 'first');
      if (SEVENZIP) {
        const ps = vols.map((v, i) => write(`v5.part${i + 1}.rar`, v));
        const x = tool(SEVENZIP, ['x', '-so', ps[0], 'big.bin']);
        ok('7-Zip extracts the RAR 5 multi-volume file', x.ok && hex(x.out) === hex(data), x.err);
      } else skipped++;
    }
    { // encryption
      const pw = 'secret ключ', enc = (o) => ({ pw, lg2: 10, salt: randBytes(16), iv: randBytes(16), ...o });
      const fe = [
        { name: 'crc-mac.txt', data: randBytes(1000), enc: enc({ mac: true }) },
        { name: 'blake-mac.bin', data: randBytes(5000), blake: true, enc: enc({ mac: true }) },
        { name: 'plain-crc.txt', data: te.encode('not tweaked'), enc: enc({ mac: false }) },
        { name: 'nocheck.txt', data: randBytes(333), enc: enc({ mac: false, check: false }) },
      ];
      const bytes = cat(SIG5, main5(), ...fe.map((f) => file5(f)), end5());
      const arc = openRar5([bytesSource(bytes)], { password: pw });
      ok('RAR 5 encryption: listing', arc.info.encrypted && arc.entries.every((e) => e.encrypted) && arc.entries[2].crc === crc32(fe[2].data) && arc.entries[0].crc === undefined);
      let bad = 0;
      for (let i = 0; i < fe.length; i++) if (hex(extract(arc, arc.entries[i])) !== hex(fe[i].data)) bad++;
      ok('RAR 5 encryption: AES-256 data, CRC32 / BLAKE2sp with and without MAC', bad === 0);
      const wrong = openRar5([bytesSource(bytes)], { password: 'wrong' });
      code('RAR 5 encryption: wrong password (check value)', () => wrong.open(wrong.entries[0]), 'badPassword');
      code('RAR 5 encryption: wrong password (no check value)', () => readAll(wrong.open(wrong.entries[3])), 'badPassword');
      const none = openRar5([bytesSource(bytes)]);
      code('RAR 5 encryption: no password', () => none.open(none.entries[0]), 'password');
      if (SEVENZIP) {
        const p = write('e5.rar', bytes);
        const t = tool(SEVENZIP, ['t', '-p' + pw, p]);
        ok('7-Zip tests the encrypted RAR 5 archive (KDF, AES, MAC)', t.ok, t.err);
      } else skipped++;
    }
    { // encrypted headers
      const pw = 'hp-pass', salt = randBytes(16), { head, key } = hcrypt5(pw, salt, 10);
      const fs5 = [{ name: 'hidden name.txt', data: te.encode('hidden contents'), enc: { pw, lg2: 10, salt, iv: randBytes(16), mac: true } },
        { name: 'sub', dir: true }];
      const blocks = [main5(), ...fs5.map((f) => { const b = file5(f); return enc5(key, b, f.data ? pad16(f.data).length : 0); }), end5()];
      const bytes = cat(SIG5, head, enc5(key, blocks[0]), blocks[1], blocks[2], enc5(key, blocks[3]));
      const arc = openRar5([bytesSource(bytes)], { password: pw });
      eq('RAR 5 encrypted headers: listing', [arc.info.headersEncrypted, arc.entries.map((e) => e.path)], [true, ['hidden name.txt', 'sub']]);
      ok('RAR 5 encrypted headers: extraction', new TextDecoder().decode(extract(arc, arc.entries[0])) === 'hidden contents');
      code('RAR 5 encrypted headers: no password', () => openRar5([bytesSource(bytes)]), 'password');
      code('RAR 5 encrypted headers: wrong password', () => openRar5([bytesSource(bytes)], { password: 'nope' }), 'badPassword');
      if (SEVENZIP) {
        const p = write('h5.rar', bytes);
        const l = tool(SEVENZIP, ['l', '-slt', '-sccUTF-8', '-p' + pw, p]).out.toString('utf8');
        const t = tool(SEVENZIP, ['t', '-p' + pw, p]);
        ok('7-Zip reads the RAR 5 archive with encrypted headers', t.ok && l.includes('Path = hidden name.txt'), t.err);
      } else skipped++;
    }

    // --- archives made by the official RAR (optional: only when Rar.exe / rar is installed) ----------------------
    if (RAREXE) {
      const src = path.join(tmp, 'rsrc'), files = {};
      const put = (rel, data) => { const p = path.join(src, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); files[rel] = Buffer.from(data); };
      const words = 'solid volume filter window huffman archive delta table block header'.split(' ');
      const text = Array.from({ length: 9000 }, () => words[rnd() % words.length]).join(' ');
      put('text.txt', text);
      put('dir/Ünïcödé 日本.txt', 'unicode name\n'.repeat(50));
      put('dir/sub/empty.dat', new Uint8Array(0));
      put('random.bin', randBytes(9000));
      put('copy1.txt', text.slice(0, 9000));
      put('copy2.txt', text.slice(0, 9000));
      { // x86-like code: CALL / JMP rel32 among one-byte opcodes
        const b = Buffer.alloc(40000);
        for (let i = 0; i < b.length;) {
          const k = rnd() % 10;
          if (k < 3 && i + 5 < b.length) { b[i] = k ? 0xe8 : 0xe9; b.writeInt32LE((rnd() % 40000) - 20000, i + 1); i += 5; }
          else b[i++] = [0x55, 0x8b, 0xec, 0x83, 0xc4, 0x89, 0x45, 0xfc, 0x5d, 0xc3][rnd() % 10];
        }
        put('prog.exe', b);
      }
      { // 16-bit stereo WAV and a 24-bit BMP: RAR picks DELTA filters for both
        const n = 12000, w = Buffer.alloc(44 + 4 * n);
        w.write('RIFF', 0); w.writeUInt32LE(36 + 4 * n, 4); w.write('WAVEfmt ', 8); w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(2, 22);
        w.writeUInt32LE(44100, 24); w.writeUInt32LE(176400, 28); w.writeUInt16LE(4, 32); w.writeUInt16LE(16, 34); w.write('data', 36); w.writeUInt32LE(4 * n, 40);
        for (let i = 0; i < n; i++) { w.writeInt16LE(Math.round(12000 * Math.sin(i / 23)), 44 + 4 * i); w.writeInt16LE(Math.round(9000 * Math.sin(i / 31)), 46 + 4 * i); }
        put('sound.wav', w);
        const W = 120, H = 80, b = Buffer.alloc(54 + 3 * W * H);
        b.write('BM', 0); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(W, 18); b.writeInt32LE(H, 22);
        b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = 54 + 3 * (y * W + x); b[o] = x; b[o + 1] = y + (rnd() % 3); b[o + 2] = x + y; }
        put('image.bmp', b);
      }
      let hard = false;
      try { fs.linkSync(path.join(src, 'text.txt'), path.join(src, 'hard.txt')); files['hard.txt'] = files['text.txt']; hard = true; } catch { /* no hard links here */ }
      fs.writeFileSync(path.join(tmp, 'cmt.txt'), '﻿Comment ✓ Ü\r\n');
      const stat = Object.fromEntries(Object.keys(files).map((r) => [r, fs.statSync(path.join(src, r))]));
      const mk = (name, args, from = [path.join(src, '*')]) => {
        const arc = path.join(tmp, name + '.rar');
        const r = tool(RAREXE, ['a', '-r', '-ep1', '-idq', '-y', ...args, arc, ...from]);
        if (!r.ok) throw new Error(`Rar.exe ${args.join(' ')} failed: ${r.err}`);
        const vols = fs.readdirSync(tmp).filter((n) => n.startsWith(name + '.part') && n.endsWith('.rar'))
          .sort((a, b) => +a.match(/part(\d+)/)[1] - +b.match(/part(\d+)/)[1]).map((n) => path.join(tmp, n));
        const list = vols.length ? vols : [fs.existsSync(arc) ? arc : arc.replace(/\.rar$/, '.exe')];
        return list.map((p) => bytesSource(new Uint8Array(fs.readFileSync(p)), path.basename(p)));
      };
      const filtersSeen = {};
      const all = (label, srcs, opts = {}, more) => {
        let arc;
        try { arc = openRar(srcs, opts); } catch (e) { ok(`Rar.exe ${label}: open`, false, `${e.code} ${e.message}`); return null; }
        const bad = [], seen = new Set();
        for (const e of arc.entries) {
          seen.add(e.path);
          if (e.dir || e.kind === 'symlink') continue;
          try {
            const got = Buffer.from(readAll(arc.open(e)));
            if (!files[e.path] || !got.equals(files[e.path]) || e.size !== got.length) bad.push(e.path);
          } catch (err) { bad.push(`${e.path} (${err.code} ${err.message})`); }
        }
        for (const r of Object.keys(files)) if (!seen.has(r)) bad.push('missing ' + r);
        ok(`Rar.exe ${label}: ${arc.entries.length} entries listed and extracted`, bad.length === 0, bad.slice(0, 4).join('; '));
        if (more) more(arc);
        return arc;
      };
      const pwChecks = (label, srcs, pw) => {
        code(`Rar.exe ${label}: wrong password`, () => { const a = openRar(srcs, { password: pw + '!' }); readAll(a.open(a.entries.find((e) => e.size > 100))); }, 'badPassword');
        code(`Rar.exe ${label}: no password`, () => { const a = openRar(srcs); readAll(a.open(a.entries.find((e) => e.size > 100))); }, 'password');
      };
      // Count the RAR 5 filters the decoder applies (the archives should exercise DELTA and E8).
      const { Unpack50 } = await import('./unpack50.js');
      const apply = Unpack50.prototype.applyFilter;
      Unpack50.prototype.applyFilter = function (f, d, o) { filtersSeen[f.type] = (filtersSeen[f.type] || 0) + 1; return apply.call(this, f, d, o); };
      try {
        all('-m0', mk('m0', ['-m0']), {}, (a) => eq('Rar.exe -m0: methods', a.info.methods, ['Store']));
        all('-m1', mk('m1', ['-m1']));
        all('-m3 (DELTA for WAV / BMP)', mk('m3', ['-m3']));
        all('-m5 -s', mk('m5s', ['-m5', '-s', '-md1m']), {}, (a) => ok('Rar.exe -m5 -s: solid', a.info.solid && a.entries.filter((e) => e.solid).length > 3));
        all('-mce+ (E8 filter)', mk('e8', ['-mce+', '-m3']));
        all('-mc3d+ (DELTA everywhere)', mk('d3', ['-mc3d+', '-s']));
        all('-htb (BLAKE2sp)', mk('htb', ['-htb', '-s']));
        all('-rr -k -z (comment)', mk('rrk', ['-rr3%', '-k', '-z' + path.join(tmp, 'cmt.txt')]), {}, (a) => {
          eq('Rar.exe -rr -k -z: comment', a.info.comment, 'Comment ✓ Ü\r\n');
          ok('Rar.exe -rr -k -z: props', a.info.props.some((p) => p[0] === 'Recovery record') && a.info.props.some((p) => p[0] === 'Locked'));
        });
        all('-tsm4 -tsc4', mk('ts', ['-tsm4', '-tsc4', '-tsa0']), {}, (a) => {
          const e = a.entries.find((x) => x.path === 'random.bin');
          ok('Rar.exe -tsm4: mtime to the millisecond', Math.abs(e.mtime.getTime() - stat['random.bin'].mtimeMs) < 1, `${e.mtime.getTime()} vs ${stat['random.bin'].mtimeMs}`);
          ok('Rar.exe -tsc4: ctime stored', e.ctime instanceof Date);
        });
        if (hard) all('-oh (hard link)', mk('oh', ['-oh']), {}, (a) => ok('Rar.exe -oh: hard link entry', a.entries.some((e) => e.kind === 'hardlink' && e.link)));
        all('-oi (identical files as references)', mk('oi', ['-oi', '-s']));
        { const s = mk('p', ['-psecret pw', '-m3']); all('-p', s, { password: 'secret pw' }); pwChecks('-p', s, 'secret pw'); }
        { const s = mk('hp', ['-hphp pw', '-s']); all('-hp', s, { password: 'hp pw' }); code('Rar.exe -hp: wrong password', () => openRar(s, { password: 'x' }), 'badPassword'); code('Rar.exe -hp: no password', () => openRar(s), 'password'); }
        all('-v (compressed data across volumes)', mk('v', ['-v15k', '-m3']), {}, (a) => ok('Rar.exe -v: volumes', a.info.volumes >= 3, String(a.info.volumes)));
        { const s = mk('pv', ['-ppw', '-v15k', '-s']); all('-p -v (one AES stream across volumes)', s, { password: 'pw' }); }
        all('-sfx', mk('sfx', ['-sfx']), {}, (a) => ok('Rar.exe -sfx: offset', a.info.sfx > 0));
        { // directory junction / symlink stored as a link
          const jsrc = path.join(tmp, 'jsrc');
          fs.mkdirSync(jsrc);
          let link = false;
          try { fs.symlinkSync(path.join(src, 'dir'), path.join(jsrc, 'jdir'), 'junction'); link = true; } catch { /* not allowed here */ }
          if (link) {
            const a = openRar(mk('ol', ['-ol'], [path.join(jsrc, 'jdir')]));
            ok('Rar.exe -ol: directory link listed as a symlink', a.entries.length === 1 && a.entries[0].kind === 'symlink' && !a.entries[0].dir && /dir$/.test(a.entries[0].link));
          }
        }
        ok('Rar.exe archives exercised DELTA and E8 filters', filtersSeen[0] > 0 && filtersSeen[1] > 0, JSON.stringify(filtersSeen));
      } finally { Unpack50.prototype.applyFilter = apply; }
    }

    // --- RAR 4 archives ----------------------------------------------------------------------------------------
    {
      const when = new Date(2019, 4, 6, 7, 8, 10);
      const f4 = [
        { name: 'docs', dir: true, mtime: when },
        { name: 'docs\\readme.txt', data: te.encode('RAR 4 readme\r\n'), mtime: when, ext: true },
        { name: 'docs\\Ünïcödé файл 日本.txt', data: randBytes(9000), unicode: true },
        { name: 'empty.dat', data: new Uint8Array(0) },
        { name: 'large.bin', data: randBytes(3000), large: true },
        { name: 'unix-link', data: te.encode('docs/readme.txt'), host: 3, attr: 0o120777 },
        { name: 'unix-file.sh', data: te.encode('#!/bin/sh\n'), host: 3, attr: 0o100755 },
      ];
      const cmt = file4b({ name: 'CMT', data: te.encode('RAR 4 comment') }, {}, 0x7a);
      const bytes = cat(MARK4, main4(0), ...f4.map((f) => file4b(f)), cmt, end4());
      const arc = openRar([bytesSource(bytes, 't4.rar')]);
      const want = f4.map((f) => [f.name.replace(/\\/g, '/'), f.dir ? 'dir' : f.attr === 0o120777 ? 'symlink' : 'file', f.dir ? 0 : f.data.length]);
      eq('RAR 4: entries', arc.entries.map((e) => [e.path, e.kind, e.size]), want);
      let bad = 0;
      for (let i = 0; i < f4.length; i++) if (!f4[i].dir && hex(extract(arc, arc.entries[i])) !== hex(f4[i].data)) bad++;
      ok('RAR 4: extraction', bad === 0);
      eq('RAR 4: comment', arc.info.comment, 'RAR 4 comment');
      eq('RAR 4: extended mtime (+1.5 s)', arc.entries[1].mtime.getTime() - when.getTime(), 1500);
      eq('RAR 4: symlink target, mode, attrib', [arc.entries[5].link, arc.entries[6].mode, arc.entries[1].attrib], ['docs/readme.txt', 0o100755, 0x20]);
      eq('RAR 4: format', [arc.format, arc.info.methods], ['rar', ['Store']]);
      const idx = hexIndex(bytes, te.encode('RAR 4 readme'));
      const b2 = bytes.slice();
      b2[idx] ^= 0x20;
      const ba = openRar([bytesSource(b2)]);
      code('RAR 4: damaged data -> checksum', () => readAll(ba.open(ba.entries[1])), 'checksum');
      if (SEVENZIP) {
        const p = write('t4.rar', bytes);
        const t = tool(SEVENZIP, ['t', p]);
        ok('7-Zip tests the RAR 4 archive', t.ok, t.err);
        const l = tool(SEVENZIP, ['l', '-slt', '-sccUTF-8', p]).out.toString('utf8');
        const paths = [...l.matchAll(/^Path = (.*)$/gm)].map((m) => m[1].replace(/\\/g, '/')).slice(1);
        eq('7-Zip lists the same RAR 4 names (packed Unicode)', paths, want.map((w) => w[0]));
      } else skipped++;
      if (BSDTAR) {
        const p = write('t4b.rar', bytes);
        const x = tool(BSDTAR, ['-xOf', p, 'docs/readme.txt']);
        ok('bsdtar extracts from the RAR 4 archive', x.ok && x.out.toString() === 'RAR 4 readme\r\n', x.err);
      } else skipped++;
    }
    { // RAR 4 volumes
      const data = randBytes(30000), parts = [data.subarray(0, 10000), data.subarray(10000, 25000), data.subarray(25000)];
      const vols = parts.map((part, i) => cat(MARK4, main4(1 | 0x10 | (i === 0 ? 0x100 : 0)),
        file4b({ name: 'split.bin', data }, { part, flags: (i > 0 ? 1 : 0) | (i < 2 ? 2 : 0), crc: i < 2 ? crc32(part) : crc32(data) }), end4(i < 2 ? 1 : 0)));
      const arc = openRar(vols.map((v) => bytesSource(v)));
      eq('RAR 4 volumes: entry', arc.entries.map((e) => [e.path, e.size, e.packed]), [['split.bin', 30000, 30000]]);
      ok('RAR 4 volumes: extraction', hex(extract(arc, arc.entries[0])) === hex(data));
      const two = openRar(vols.slice(0, 2).map((v) => bytesSource(v)));
      code('RAR 4 volumes: missing volume', () => readAll(two.open(two.entries[0])), 'volume');
      if (SEVENZIP) {
        const ps = vols.map((v, i) => write(`v4.part${i + 1}.rar`, v));
        const x = tool(SEVENZIP, ['x', '-so', ps[0]]);
        ok('7-Zip extracts the RAR 4 multi-volume file', x.ok && hex(x.out) === hex(data), x.err);
      } else skipped++;
    }
    { // RAR 4 encryption (AES-128, salted; the long password exercises RAR 2.9's SHA-1 quirk)
      const pws = ['short pw', 'a much longer password of 40 characters!'];
      for (const pw of pws) {
        const fe = [{ name: 'secret.txt', data: te.encode('RAR 3 AES data ' + pw), pw }, { name: 'secret2.bin', data: randBytes(4099), pw }];
        const bytes = cat(MARK4, main4(0), ...fe.map((f) => file4b(f)), end4());
        const arc = openRar([bytesSource(bytes)], { password: pw });
        ok(`RAR 4 encryption (${pw.length} chars): extraction`, fe.every((f, i) => hex(extract(arc, arc.entries[i])) === hex(f.data)));
        const wrong = openRar([bytesSource(bytes)], { password: pw + 'x' });
        code(`RAR 4 encryption (${pw.length} chars): wrong password`, () => readAll(wrong.open(wrong.entries[1])), 'badPassword');
        if (SEVENZIP) {
          const p = write(`e4-${pw.length}.rar`, bytes);
          const x = tool(SEVENZIP, ['x', '-so', '-p' + pw, p, 'secret2.bin']);
          ok(`7-Zip decrypts the RAR 4 file (${pw.length}-char password)`, x.ok && hex(x.out) === hex(fe[1].data), x.err);
        } else skipped++;
      }
      const none = openRar([bytesSource(cat(MARK4, main4(0), file4b({ name: 'x', data: te.encode('x'), pw: 'p' }), end4()))]);
      code('RAR 4 encryption: no password', () => none.open(none.entries[0]), 'password');
    }
    { // RAR 4 encrypted headers
      const pw = 'header pass';
      const f = { name: 'hidden.txt', data: te.encode('hidden RAR 4 data'), pw };
      const r = file4(f);
      const bytes = cat(MARK4, main4(0x80), hp4(pw, r.head), r.data, hp4(pw, end4()));
      const arc = openRar([bytesSource(bytes)], { password: pw });
      eq('RAR 4 encrypted headers: listing', [arc.info.headersEncrypted, arc.entries.map((e) => e.path)], [true, ['hidden.txt']]);
      ok('RAR 4 encrypted headers: extraction', new TextDecoder().decode(extract(arc, arc.entries[0])) === 'hidden RAR 4 data');
      code('RAR 4 encrypted headers: no password', () => openRar([bytesSource(bytes)]), 'password');
      code('RAR 4 encrypted headers: wrong password', () => openRar([bytesSource(bytes)], { password: 'bad' }), 'badPassword');
      if (SEVENZIP) {
        const p = write('h4.rar', bytes);
        const x = tool(SEVENZIP, ['x', '-so', '-p' + pw, p]);
        ok('7-Zip reads the RAR 4 archive with encrypted headers', x.ok && x.out.toString() === 'hidden RAR 4 data', x.err);
      } else skipped++;
    }
    { // RAR 2.x style comment inside the main header (stored)
      const text = te.encode('old style comment');
      const cblock = block4(0x75, 0, cat(u16(text.length), [20, 0x30], u16(crc32(text) & 0xffff), text));
      const mh = block4(0x73, 2, cat([0, 0, 0, 0, 0, 0], cblock), 13);
      const bytes = cat(MARK4, mh, file4b({ name: 'a.txt', data: te.encode('a') }), end4());
      const arc = openRar([bytesSource(bytes)]);
      eq('RAR 2.x main header comment', [arc.info.comment, arc.entries.length], ['old style comment', 1]);
      if (SEVENZIP) ok('7-Zip tests the archive with an old-style comment', tool(SEVENZIP, ['t', write('c4.rar', bytes)]).ok);
      else skipped++;
    }
    { // RAR 1.4
      const data = te.encode('RAR 1.4 stored file\r\n'), name = te.encode('OLD.TXT');
      const fh = cat(u32(data.length), u32(data.length), u16(checksum14(data)), u16(21 + name.length), u32(dosTime(new Date(1995, 1, 2, 3, 4, 6))),
        [0x20, 0, 2, name.length, 0], name);
      const dir = cat(u32(0), u32(0), u16(0), u16(21 + 3), u32(0), [0x10, 0, 2, 3, 0], te.encode('SUB'));
      const bytes = cat([0x52, 0x45, 0x7e, 0x5e], u16(7), [0], dir, fh, data);
      const arc = openRar([bytesSource(bytes)]);
      eq('RAR 1.4: listing', [arc.format, arc.entries.map((e) => [e.path, e.dir, e.size])], ['rar14', [['SUB', true, 0], ['OLD.TXT', false, data.length]]]);
      ok('RAR 1.4: stored extraction (RAR 1.4 checksum)', hex(extract(arc, arc.entries[1])) === hex(data));
      const b2 = bytes.slice();
      b2[b2.length - 3] ^= 1;
      const ba = openRar([bytesSource(b2)]);
      code('RAR 1.4: damaged data -> checksum', () => readAll(ba.open(ba.entries[1])), 'checksum');
    }
  } catch (e) {
    fail++;
    console.log('FAIL (exception) ' + (e.stack || e));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`archive rar: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} external checks skipped (7z / bsdtar missing)` : ''}${RAREXE ? '' : ' (no Rar.exe: its archives were not tested)'}`);
  return fail;
}

function hexIndex(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

// Huffman code lengths (no limit; callers retry flatter weights when a code exceeds 15 bits).
// Plain Huffman by repeated merging of the two lightest nodes; O(n^2 log n) with the sort per step, irrelevant for
// alphabets of at most ~300 symbols in tests.
function huffLengths(w) {
  const nodes = w.map((x, i) => ({ w: x, sym: i })).filter((n) => n.w > 0);
  const lens = new Array(w.length).fill(0);
  if (nodes.length === 1) { lens[nodes[0].sym] = 1; return lens; }
  let list = nodes.slice();
  while (list.length > 1) {
    list.sort((a, b) => a.w - b.w);
    const [a, b] = list.splice(0, 2);
    list.push({ w: a.w + b.w, kids: [a, b] });
  }
  const walk = (n, d) => { if (n.kids) { walk(n.kids[0], d + 1); walk(n.kids[1], d + 1); } else lens[n.sym] = d; };
  walk(list[0], 0);
  return lens;
}

// Canonical codes as RAR assigns them: by length, then symbol order, starting from 0.
function canonical(lens) {
  const codes = new Array(lens.length).fill(0);
  let code = 0;
  for (let l = 1; l <= 15; l++) {
    for (let s = 0; s < lens.length; s++) if (lens[s] === l) codes[s] = code++;
    code <<= 1;
  }
  return codes;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
