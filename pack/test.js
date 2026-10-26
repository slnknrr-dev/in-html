// pack/test.js - unit tests of the archive writers: `node pack/test.js` (importing the module runs nothing).
// Round trips through the readers of ../archive/ (which are checked against real archives there), byte-exact
// reference outputs of xz-utils and bzip2 for the empty input, CRCs in the containers, damaged data detected by the
// checks, and - when the tools exist on this machine - decoding by the reference implementations: Node's zlib (gzip,
// Zstandard), xz, bzip2 and 7-Zip.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { crc32 } from '../codec/crc32.js';
import { bzip2Stream } from '../archive/bzip2.js';
import { openArchive } from '../archive/index.js';
import { Reader, bytesSource, bytesStream, readAll } from '../archive/io.js';
import { lzma2Stream, lzmaAloneStream } from '../archive/lzma.js';
import { isTarHeader } from '../archive/tar.js';
import { xzStream } from '../archive/xz.js';
import { zstdStream } from '../archive/zstd.js';
import { bwtOrder, bzip2 } from './bzip2.js';
import { gzip } from './gzip.js';
import { PACK_FORMATS, packArchive, packFormatOf } from './index.js';
import { lzma2, lzma2DictProp, lzmaAlone } from './lzma.js';
import { sevenZip } from './sevenzip.js';
import { tar } from './tar.js';
import { xz } from './xz.js';
import { zstd } from './zstd.js';

// Run only when executed directly, so ../check.js can import run() and aggregate results.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const te = new TextEncoder();
const hex = (b) => Buffer.from(b).toString('hex');
const same = (a, b) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));

// Deterministic generators: reproducible failures. text() is compressible multi-byte UTF-8, random() is not.
function lcg(seed) { let x = seed >>> 0; return () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0); }
const WORDS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau archive файл ქართული'.split(' ');
function text(n, seed = 1) { const r = lcg(seed); let s = ''; while (s.length < n) s += WORDS[r() % WORDS.length] + (r() % 9 ? ' ' : '\n'); return te.encode(s).subarray(0, n); }
function random(n, seed = 2) { const r = lcg(seed), b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = r() >>> 24; return b; }

// Probes for a reference tool. A non-ENOENT failure (e.g. 7z exiting non-zero without arguments) still means the
// binary exists.
function tool(cmd) {
  const cands = cmd === '7z' ? ['7z', '7za', 'C:/Program Files/7-Zip/7z.exe', '/usr/bin/7z'] : [cmd];
  for (const c of cands) { try { execFileSync(c, cmd === '7z' ? [] : ['--version'], { stdio: 'pipe' }); return c; } catch (e) { if (e.status != null && e.code !== 'ENOENT') return c; } }
  return null;
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${info}`); } };
  const throwsCode = (name, fn, code) => { try { fn(); fail++; console.log(`FAIL ${name}: no throw`); } catch (e) { eq(name, e.code || String(e), code); } };
  const dec = (fn, z) => readAll(fn(new Reader(bytesStream(z))));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-test-'));
  const T = { xz: tool('xz'), bzip2: tool('bzip2'), sz: tool('7z') };
  const ext = (cmd, args, input) => execFileSync(cmd, args, { input, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });

  // Edge cases for every codec: empty, one byte, long runs (RLE paths), short period (BWT/LZ worst cases),
  // text, incompressible data (stored/raw fallbacks) and a mix (fallback switching mid-stream).
  const samples = [
    ['empty', new Uint8Array(0)], ['one', te.encode('a')], ['zeros', new Uint8Array(70000)], ['periodic', te.encode('abcabcabd'.repeat(4000))],
    ['text', text(150000)], ['random', random(90000)], ['mixed', new Uint8Array([...text(40000, 5), ...random(30000, 6), ...text(40000, 5)])],
  ];

  // --- BWT --------------------------------------------------------------------------------------------------------
  {
    const b = te.encode('banana');
    const sa = bwtOrder(b, b.length);
    eq('bwt banana order', Array.from(sa), [5, 3, 1, 0, 4, 2]);
    const per = te.encode('abab');
    eq('bwt periodic is a permutation', Array.from(bwtOrder(per, 4)).sort(), [0, 1, 2, 3]);
  }

  // --- bzip2 -----------------------------------------------------------------------------------------------------
  eq('bzip2 empty = bzip2(1)', hex(bzip2(new Uint8Array(0))), '425a683917724538509000000000');
  for (const [name, d] of samples) {
    const z = bzip2(d);
    ok('bzip2 round trip ' + name, same(dec(bzip2Stream, z), d));
    if (T.bzip2) ok('bzip2(1) decodes ' + name, same(ext(T.bzip2, ['-dc'], z), d));
  }
  {
    const d = text(250000, 9);
    const z = bzip2(d, { level: 1 }); // three blocks of 100 kB
    ok('bzip2 level 1 several blocks', same(dec(bzip2Stream, z), d));
    eq('bzip2 level byte', z[3], 0x31);
    const bad = z.slice(); bad[z.length >> 1] ^= 0x10;
    let code = null;
    try { dec(bzip2Stream, bad); } catch (e) { code = e.code; }
    ok('bzip2 damage detected', code === 'checksum' || code === 'corrupt', code);
    // Stream CRC: the last 4 bytes before padding combine the block CRCs (checked by the decoder above).
  }

  // --- LZMA / LZMA2 / xz -------------------------------------------------------------------------------------------
  eq('xz empty = xz-utils', hex(xz(new Uint8Array(0))), 'fd377a585a000004e6d6b446000000001cdf44211fb6f37d010000000004595a');
  eq('lzma2 dict prop 8 MiB', lzma2DictProp(1 << 23), 22);
  eq('lzma2 dict prop 1.5 MiB', lzma2DictProp(3 << 19), 17);
  for (const [name, d] of samples) {
    const z = xz(d);
    ok('xz round trip ' + name, same(dec(xzStream, z), d));
    if (T.xz) ok('xz(1) decodes ' + name, same(ext(T.xz, ['-dc'], z), d));
    const a = lzmaAlone(d);
    ok('lzma round trip ' + name, same(dec(lzmaAloneStream, a), d));
    if (T.xz) ok('xz --format=lzma decodes ' + name, same(ext(T.xz, ['-dc', '--format=lzma'], a), d));
    const r = lzma2(d, { level: 1 });
    ok('lzma2 raw level 1 ' + name, same(dec((rd) => lzma2Stream(rd, lzma2DictProp(r.dictSize)), r), d));
  }
  {
    const d = text(150000);
    const z9 = xz(d, { level: 9 }), z0 = xz(d, { level: 0 });
    ok('xz levels compress text', z9.length < d.length / 3 && z0.length < d.length / 2, z9.length + ' ' + z0.length);
    ok('xz random stays near its size', xz(random(90000)).length < 90000 + 200);
    for (const check of ['crc32', 'none']) ok('xz check ' + check, same(dec(xzStream, xz(d, { check })), d));
    const bad = z9.slice(); bad[bad.length - 40] ^= 1; // inside the index / check region
    let code = null;
    try { dec(xzStream, bad); } catch (e) { code = e.code; }
    ok('xz damage detected', !!code, code);
    // Large input: several 2 MiB LZMA2 chunks.
    const big = new Uint8Array(4_500_000);
    for (let i = 0; i < big.length; i += 150000) big.set(text(Math.min(150000, big.length - i), i), i);
    const zb = xz(big, { level: 1 });
    ok('xz several chunks', same(dec(xzStream, zb), big));
    if (T.xz) ok('xz(1) several chunks', same(ext(T.xz, ['-dc'], zb), big));
  }

  // --- gzip --------------------------------------------------------------------------------------------------------
  for (const [name, d] of samples) {
    const z = gzip(d, { name: 'file.txt', mtime: 1700000000000 });
    ok('gzip zlib decodes ' + name, same(zlib.gunzipSync(z), d));
    eq('gzip CRC trailer ' + name, z[z.length - 8] | (z[z.length - 7] << 8) | (z[z.length - 6] << 16) | ((z[z.length - 5] << 24) >>> 0), crc32(d) | 0);
  }
  {
    const z = gzip(te.encode('x'), { name: 'имя/name.txt', mtime: 1700000000000 });
    const arc = openArchive([bytesSource(z, 'name.txt.gz')]);
    eq('gzip header name', arc.entries[0].path, 'name.txt');
    eq('gzip header time', arc.entries[0].mtime.getTime(), 1700000000000);
  }

  // --- Zstandard ---------------------------------------------------------------------------------------------------
  for (const [name, d] of samples) {
    const z = zstd(d);
    ok('zstd round trip ' + name, same(dec(zstdStream, z), d));
    if (zlib.zstdDecompressSync) ok('zstd zlib decodes ' + name, same(zlib.zstdDecompressSync(z), d));
  }
  {
    const d = text(150000);
    const z = zstd(d, { level: 6 });
    ok('zstd compresses text', z.length < d.length / 2.5, z.length);
    const big = new Uint8Array(600000);
    for (let i = 0; i < big.length; i += 150000) big.set(text(150000, i));
    ok('zstd several blocks', same(dec(zstdStream, zstd(big)), big));
    const bad = z.slice(); bad[bad.length - 2] ^= 1; // the XXH64 checksum
    throwsCode('zstd checksum checked', () => dec(zstdStream, bad), 'checksum');
    const nock = zstd(d, { level: 6, checksum: false });
    ok('zstd without checksum', same(dec(zstdStream, nock), d) && nock.length === z.length - 4);
  }

  // --- tar -------------------------------------------------------------------------------------------------------
  const tree = [
    { path: 'docs', dir: true, mtime: new Date('2024-01-02T03:04:05Z') },
    { path: 'docs/readme.txt', data: text(5000), mtime: 1700000000000, mode: 0o644 },
    { path: 'docs/Ünïcödé — файл.txt', data: te.encode('юникод') },
    { path: 'empty.txt', data: new Uint8Array(0), mtime: 1700000000000 },
    { path: 'emptydir', dir: true },
    { path: 'deep/'.repeat(40) + 'long-name-file.bin', data: random(3000) },
    { path: 'run.sh', data: te.encode('#!/bin/sh\necho hi\n'), mode: 0o755, mtime: 1700000000500 },
    { path: 'link', kind: 'symlink', link: 'docs/readme.txt' },
  ];
  {
    const t = tar(tree);
    eq('tar record padding', t.length % 10240, 0);
    ok('tar header checksum', isTarHeader(t.subarray(0, 512)));
    const arc = openArchive([bytesSource(t, 't.tar')]);
    eq('tar paths', arc.entries.map((e) => e.path), tree.map((e) => e.path));
    eq('tar kinds', arc.entries.map((e) => e.kind), ['dir', 'file', 'file', 'file', 'dir', 'file', 'file', 'symlink']);
    eq('tar link target', arc.entries[7].link, 'docs/readme.txt');
    eq('tar mode', arc.entries[6].mode & 0o777, 0o755);
    eq('tar fractional time (pax)', arc.entries[6].mtime.getTime(), 1700000000500);
    ok('tar data', same(readAll(arc.open(arc.entries[5])), tree[5].data));
  }

  // --- 7z ----------------------------------------------------------------------------------------------------------
  {
    const z = sevenZip(tree.filter((e) => e.kind !== 'symlink'));
    const arc = openArchive([bytesSource(z, 't.7z')]);
    eq('7z paths', arc.entries.map((e) => e.path).sort(), tree.filter((e) => e.kind !== 'symlink').map((e) => e.path).sort());
    const byPath = new Map(arc.entries.map((e) => [e.path, e]));
    ok('7z data', same(readAll(arc.open(byPath.get('docs/readme.txt'))), tree[1].data));
    eq('7z CRC', byPath.get('docs/readme.txt').crc, crc32(tree[1].data));
    eq('7z empty file', [byPath.get('empty.txt').dir, byPath.get('empty.txt').size], [false, 0]);
    eq('7z empty dir', byPath.get('emptydir').dir, true);
    eq('7z time', byPath.get('docs/readme.txt').mtime.getTime(), 1700000000000);
    eq('7z unix mode', byPath.get('run.sh').mode & 0o777, 0o755);
    eq('7z method', /LZMA2/.test(arc.info.methods.join(' ')), true);
    eq('7z empty archive', openArchive([bytesSource(sevenZip([]), 'e.7z')]).entries.length, 0);
    const rnd = sevenZip([{ path: 'r.bin', data: random(5000) }]);
    eq('7z incompressible data is stored', openArchive([bytesSource(rnd, 'r.7z')]).info.methods.join(','), 'Copy');
    const bad = z.slice(); bad[40] ^= 0x55;
    let code = null;
    try { const a = openArchive([bytesSource(bad, 'b.7z')]); for (const e of a.entries) if (!e.dir) readAll(a.open(e)); } catch (e) { code = e.code; }
    ok('7z damage detected', !!code, code);
  }

  // --- packArchive -------------------------------------------------------------------------------------------------
  eq('packFormatOf', ['a.tar.gz', 'a.TGZ', 'b.tar.xz', 'c.7z', 'd.zip', 'e.txt.zst', 'f.tbz2', 'g.txt'].map(packFormatOf), ['tar.gz', 'tar.gz', 'tar.xz', '7z', 'zip', 'zst', 'tar.bz2', null]);
  for (const f of PACK_FORMATS) {
    const entries = f.single ? [{ path: 'one.txt', data: text(20000) }] : tree;
    const out = await packArchive(f.id, entries);
    const name = 'p' + f.ext;
    const arc = openArchive([bytesSource(out, name)]);
    const files = arc.entries.filter((e) => !e.dir && e.kind === 'file');
    const want = entries.filter((e) => !e.dir && e.kind !== 'symlink');
    ok('pack ' + f.id + ' reads back', files.length === want.length && files.every((e) => same(readAll(arc.open(e)), (want.find((w) => w.path === e.path) || want[0]).data)), arc.label);
    if (T.sz && f.id !== 'lzma') {
      const file = path.join(tmp, name);
      fs.writeFileSync(file, out);
      let res = '';
      try { res = ext(T.sz, ['t', file]).toString(); } catch (e) { res = String(e.stdout || e.message); }
      ok('7-Zip tests ' + f.id, /Everything is Ok/.test(res), res.slice(-200));
    }
  }
  try { await packArchive('xz', tree); fail++; console.log('FAIL xz of a tree: no throw'); } catch (e) { eq('xz of a tree refused', e.code, 'single'); }

  fs.rmSync(tmp, { recursive: true, force: true });
  const tools = Object.entries(T).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none';
  console.log(`pack: ${pass} passed, ${fail} failed (reference tools: ${tools}${zlib.zstdDecompressSync ? ', zlib zstd' : ''})`);
  return fail;
}

if (isMain) run().then((f) => process.exit(f ? 1 : 0));
