// archive/test-iso.js - tests of archive/iso.js: `node archive/test-iso.js` (importing the module runs nothing).
// With bsdtar (libarchive: Windows' tar.exe, or bsdtar elsewhere) images are generated in a temp dir from a tar built
// here (Rock Ridge with symlinks, modes and relocated deep directories, Joliet with Unicode names, levels 1-3,
// ISO 9660:1999, zisofs, the three El Torito emulations) and compared with the originals, and with 7-Zip's listing
// when 7z is installed. An image built byte by byte below covers what the tools cannot write (multi-extent and
// interleaved files, CE continuation areas, split NM / SL entries, TF long form, a hand-made zisofs file, a
// three-entry boot catalog, loops, bad records, raw 2352-byte sectors, truncation). UDF: an embedded IMAPI2 image
// (UDF 2.50 metadata partition bridged with ISO 9660 + Joliet; deflated, ~10 KB of base64), also with two file
// entries rewritten as embedded data and as a symlink. Without the tools the built and embedded images still run.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIso, openUdf } from './iso.js';
import { ArchiveError, bytesSource, readAll, le16, le32, le64 } from './io.js';
import { inflateRawSync, zlibSync } from '../codec/zlib.js';
import { crc32 } from '../codec/crc32.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const te = new TextEncoder();
const T0 = 1700000000; // 2023-11-14T22:13:20Z
const crc = (b) => crc32(b, 0, b.length, 0);
const pattern = (n, f) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = f(i); return b; };

// --- tools -----------------------------------------------------------------------------------------------------

function findTool(candidates, args, re) {
  for (const c of candidates) {
    try { if (re.test(execFileSync(c, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))) return c; } catch { /* next */ }
  }
  return null;
}

/** ustar + pax ('path', 'linkpath') tarball: items { path, type: 'f' | 'd' | 'l', data, link, mode }. */
function tarball(items) {
  const out = [];
  const header = (name, type, size, mode, link = '') => {
    const h = new Uint8Array(512);
    const put = (s, o, n) => h.set(te.encode(s).subarray(0, n), o);
    const oct = (v, o, n) => put(v.toString(8).padStart(n - 1, '0'), o, n - 1);
    put(name, 0, 100); oct(mode, 100, 8); oct(1000, 108, 8); oct(100, 116, 8); oct(size, 124, 12); oct(T0, 136, 12);
    h.fill(32, 148, 156); h[156] = type.charCodeAt(0); put(link, 157, 100); put('ustar\x0000', 257, 8);
    let sum = 0;
    for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return h;
  };
  const pad = (b) => { const o = new Uint8Array(Math.ceil(b.length / 512) * 512); o.set(b); return o; };
  const record = (k, v) => { const body = ` ${k}=${v}\n`, n = te.encode(body).length; let len = n + 1; while (String(len).length + n !== len) len = String(len).length + n; return len + body; };
  for (const it of items) {
    const name = it.path + (it.type === 'd' ? '/' : ''), data = it.data || new Uint8Array(0);
    const pax = te.encode(record('path', name) + (it.link ? record('linkpath', it.link) : ''));
    out.push(header('PaxHeader', 'x', pax.length, 0o644), pad(pax));
    out.push(header(name.replace(/[^\x20-\x7e]/g, '_'), { f: '0', d: '5', l: '2' }[it.type], it.type === 'f' ? data.length : 0, it.mode ?? (it.type === 'd' ? 0o755 : it.type === 'l' ? 0o777 : 0o644), it.link || ''));
    if (it.type === 'f') out.push(pad(data));
  }
  out.push(new Uint8Array(1024));
  const all = new Uint8Array(out.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of out) { all.set(b, o); o += b.length; }
  return all;
}

function writeTree(dir, items) {
  for (const it of items) {
    const f = path.join(dir, it.path);
    if (it.type === 'd') fs.mkdirSync(f, { recursive: true });
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, it.data); }
  }
}

// --- a byte-level ISO 9660 writer for what the tools cannot produce --------------------------------------------

const bytes = (s) => [...te.encode(s)];
const le16b = (v) => [v & 255, (v >> 8) & 255];
const le32b = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];
const both16 = (v) => [...le16b(v), ...le16b(v).reverse()];
const both32 = (v) => [...le32b(v), ...le32b(v).reverse()];
const su = (sig, data, ver = 1) => [...bytes(sig), 4 + data.length, ver, ...data];
const DATE = [123, 11, 15, 6, 13, 20, 32]; // 2023-11-15 06:13:20 at GMT+8 = T0
const dec17 = (s, tz) => [...bytes(s), tz];

function rec(name, { lba = 0, size = 0, flags = 0, fus = 0, gap = 0, sua = [] } = {}) {
  const n = typeof name === 'number' ? [name] : bytes(name);
  const r = [0, 0, ...both32(lba), ...both32(size), ...DATE, flags, fus, gap, ...both16(1), n.length, ...n];
  if (!(n.length & 1)) r.push(0);
  r.push(...sua);
  if (r.length & 1) r.push(0);
  r[0] = r.length;
  return r;
}

const SECTORS = 60;
const MULTI = new Uint8Array([...new Uint8Array(2048).fill(65), ...new Uint8Array(2048).fill(66), ...new Uint8Array(500).fill(67)]);
const INTER = pattern(5000, (i) => (i * 13 + (i >> 8)) & 255);
const ZDATA = new Uint8Array(70000);
ZDATA.set(pattern(32768, (i) => 97 + (i % 26)), 0);
ZDATA.set(pattern(70000 - 65536, (i) => 48 + (i % 10)), 65536);

/** zisofs file: header, block pointers, zlib blocks (all-zero blocks as empty ones). */
// zisofs blocks of 32 KiB, each zlib-compressed; an all-zero block is stored as zero length (a hole), the case
// readers most often get wrong, so the generator produces it deliberately.
function zisofs(data) {
  const n = Math.ceil(data.length / 32768), blocks = [];
  for (let i = 0; i < n; i++) { const b = data.subarray(i * 32768, (i + 1) * 32768); blocks.push(b.every((v) => !v) ? new Uint8Array(0) : zlibSync(b)); }
  const head = [0x37, 0xe4, 0x53, 0x96, 0xc9, 0xdb, 0xd6, 0x07, ...le32b(data.length), 4, 15, 0, 0];
  let at = 16 + (n + 1) * 4;
  const ptrs = [];
  for (const b of blocks) { ptrs.push(...le32b(at)); at += b.length; }
  ptrs.push(...le32b(at));
  return new Uint8Array([...head, ...ptrs, ...blocks.flatMap((b) => [...b])]);
}

function buildImage() {
  const img = new Uint8Array(SECTORS * 2048);
  const put = (sector, data, off = 0) => img.set(data, sector * 2048 + off);
  const sector = (...records) => records.flat();
  // volume descriptors: primary (16), El Torito boot record (17), terminator (18)
  const pvd = new Uint8Array(2048);
  pvd.set([1, ...bytes('CD001'), 1]);
  pvd.set(bytes('TEST SYSTEM'.padEnd(32)), 8);
  pvd.set(bytes('PROGRAMMATIC'.padEnd(32)), 40);
  pvd.set(both32(SECTORS), 80);
  pvd.set([...both16(1), ...both16(1), ...both16(2048)], 120);
  pvd.set(rec(0, { lba: 20, size: 2048, flags: 2 }), 156);
  pvd.set(bytes('PUBLISHER'.padEnd(128)), 318);
  pvd.set(bytes('TEST-ISO'.padEnd(128)), 574);
  pvd.set(dec17('2023111422132000', 0), 813);
  pvd.set(dec17('2023111506132000', 32), 830);
  pvd[881] = 1;
  put(16, pvd);
  const br = new Uint8Array(2048);
  br.set([0, ...bytes('CD001'), 1, ...bytes('EL TORITO SPECIFICATION')]);
  br.set(le32b(19), 0x47);
  put(17, br);
  put(18, [255, ...bytes('CD001'), 1]);
  // boot catalog (19): validation entry, no-emulation initial entry, a final section with hard disk and floppy entries
  const cat = new Uint8Array(2048);
  cat.set([1, 0, 0, 0, ...bytes('TEST')]);
  cat.set([0x55, 0xaa], 30);
  let sum = 0;
  for (let i = 0; i < 32; i += 2) sum += cat[i] | (cat[i + 1] << 8);
  cat.set(le16b((0x10000 - (sum & 0xffff)) & 0xffff), 28);
  cat.set([0x88, 0, 0, 0, 0, 0, ...le16b(4), ...le32b(46)], 32);
  cat.set([0x91, 0, ...le16b(2)], 64);
  cat.set([0x88, 4, 0, 0, 0x83, 0, ...le16b(1), ...le32b(47)], 96);
  cat.set([0x00, 2, 0, 0, 0, 0, ...le16b(1), ...le32b(48)], 128);
  put(19, cat);
  // root (20): SP + ER, then the entries
  const tf = [0x87, ...dec17('2023010203040500', 0), ...dec17('2023111422132000', 0), ...dec17('2024060708091000', 0)];
  const ce = [...su('NM', [0, ...bytes('continued.txt')]), ...su('PX', [...both32(0o100640), ...both32(1), ...both32(7), ...both32(8)]), ...su('TF', tf)];
  put(24, ce, 100);
  const ceLen = ce.length;
  const zf = zisofs(ZDATA);
  put(52, zf);
  const sl1 = su('SL', [1, 8, 0, 0, 3, ...bytes('usr'), 1, 2, ...bytes('li')]);
  const sl2 = su('SL', [0, 0, 1, ...bytes('b'), 4, 0, 2, 0, 0, 1, ...bytes('x')]);
  put(20, sector(
    rec(0, { lba: 20, size: 2048, flags: 2, sua: [...su('SP', [0xbe, 0xef, 0]), ...su('ER', [10, 0, 0, 1, ...bytes('RRIP_1991A')])] }),
    rec(1, { lba: 20, size: 2048, flags: 2 }),
    rec('LONGNAME.;1', { lba: 42, size: 11, sua: [...su('NM', [1, ...bytes('a-rock-ridge-name-')]), ...su('CE', [...both32(24), ...both32(100), ...both32(ceLen)])] }),
    rec('DEEP', { sua: [...su('NM', [0, ...bytes('deep')]), ...su('CL', both32(23))] }),
    rec('HIDDEN.TXT;1', { lba: 43, size: 6, flags: 1 }),
    rec('INTER.BIN;1', { lba: 36, size: INTER.length, fus: 1, gap: 1 }),
    rec('LINK.;1', { sua: [...su('NM', [0, ...bytes('link')]), ...su('PX', [...both32(0o120777), ...both32(1), ...both32(0), ...both32(0), ...both32(99)]), ...sl1, ...sl2] }),
    rec('MULTI.BIN;1', { lba: 30, size: 2048, flags: 0x80 }),
    rec('MULTI.BIN;1', { lba: 34, size: 2048, flags: 0x80 }),
    rec('MULTI.BIN;1', { lba: 32, size: 500 }),
    rec('NOEXT.;1', { lba: 44, size: 5 }),
    rec('RR_MOVED', { lba: 22, size: 2048, flags: 2, sua: su('NM', [0, ...bytes('rr_moved')]) }),
    rec('SUB', { lba: 21, size: 2048, flags: 2, sua: su('NM', [0, ...bytes('sub')]) }),
    rec('VERSIONED.TXT;1', { lba: 45, size: 3, flags: 4 }),
    rec('VERSIONED.TXT;1', { lba: 45, size: 3 }),
    rec('ZISOFS.BIN;1', { lba: 52, size: zf.length, sua: [...su('NM', [0, ...bytes('zisofs.bin')]), ...su('ZF', [...bytes('pz'), 4, 15, ...both32(ZDATA.length)])] }),
  ));
  // sub (21): a loop back to the root, a file, a bad record (name longer than the record), a record after it
  const bad = new Array(40).fill(0);
  bad[0] = 40;
  bad[32] = 100;
  put(21, sector(rec(0, { lba: 21, size: 2048, flags: 2 }), rec(1, { lba: 20, size: 2048, flags: 2 }), rec('BACK', { lba: 20, size: 2048, flags: 2 }), rec('FILE.TXT;1', { lba: 49, size: 4 }), bad, rec('AFTER.TXT;1', { lba: 49, size: 4 })));
  // rr_moved (22) with the relocated directory (23)
  put(22, sector(rec(0, { lba: 22, size: 2048, flags: 2 }), rec(1, { lba: 20, size: 2048, flags: 2 }), rec('DEEP', { lba: 23, size: 2048, flags: 2, sua: [...su('NM', [0, ...bytes('deep')]), ...su('RE', [])] })));
  put(23, sector(
    rec(0, { lba: 23, size: 2048, flags: 2, sua: su('PX', [...both32(0o40750), ...both32(2), ...both32(0), ...both32(0)]) }),
    rec(1, { lba: 22, size: 2048, flags: 2, sua: su('PL', both32(20)) }),
    rec('INNER.TXT;1', { lba: 51, size: 6, sua: su('NM', [0, ...bytes('inner.txt')]) }),
  ));
  // file data
  put(30, MULTI.subarray(0, 2048)); put(31, new Uint8Array(2048).fill(74)); put(32, MULTI.subarray(4096)); put(33, new Uint8Array(2048).fill(74)); put(34, MULTI.subarray(2048, 4096));
  put(36, INTER.subarray(0, 2048)); put(37, new Uint8Array(2048).fill(0xee)); put(38, INTER.subarray(2048, 4096)); put(39, new Uint8Array(2048).fill(0xee)); put(40, INTER.subarray(4096));
  put(42, te.encode('longname!!\n')); put(43, te.encode('hidden')); put(44, te.encode('noext')); put(45, te.encode('ver'));
  put(46, new Uint8Array(2048).fill(0x11));
  const mbr = new Uint8Array(2048).fill(0x33);
  mbr.fill(0, 0, 512);
  mbr.set([0x80, 0, 0, 0, 0x83, 0, 0, 0, ...le32b(1), ...le32b(3)], 446);
  mbr.set([0x55, 0xaa], 510);
  put(47, mbr);
  put(48, new Uint8Array(2048).fill(0x22));
  put(49, te.encode('file')); put(51, te.encode('inner\n'));
  return img;
}

/** Raw 2352-byte sectors: sync, BCD address, mode, then Mode 1 data or a Mode 2 Form 1 subheader and data. */
function toRaw(img, mode) {
  const n = img.length / 2048, out = new Uint8Array(n * 2352);
  const bcd = (v) => ((v / 10) | 0) * 16 + (v % 10);
  for (let s = 0; s < n; s++) {
    const o = s * 2352, a = s + 150;
    out.set([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, bcd((a / 4500) | 0), bcd(((a / 75) | 0) % 60), bcd(a % 75), mode], o);
    out.set(img.subarray(s * 2048, s * 2048 + 2048), o + (mode === 1 ? 16 : 24));
  }
  return out;
}

/** Directory chain deeper than the nesting limit. */
function deepImage(levels) {
  const img = new Uint8Array((21 + levels + 1) * 2048);
  const pvd = new Uint8Array(2048);
  pvd.set([1, ...bytes('CD001'), 1]);
  pvd.set(both32(img.length / 2048), 80);
  pvd.set([...both16(1), ...both16(1), ...both16(2048)], 120);
  pvd.set(rec(0, { lba: 20, size: 2048, flags: 2 }), 156);
  img.set(pvd, 16 * 2048);
  img.set([255, ...bytes('CD001'), 1], 17 * 2048);
  for (let i = 0; i <= levels; i++) {
    const lba = 20 + i;
    img.set([...rec(0, { lba, size: 2048, flags: 2 }), ...rec(1, { lba: Math.max(20, lba - 1), size: 2048, flags: 2 }), ...(i < levels ? rec('D', { lba: lba + 1, size: 2048, flags: 2 }) : [])], lba * 2048);
  }
  return img;
}

// --- embedded UDF fixture --------------------------------------------------------------------------------------

// IMAPI2 (Windows) image of a small tree: UDF 2.50 with a metadata partition, bridged with ISO 9660 + Joliet; deflated.
const UDF_FIXTURE = `
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`;
const SMALL = [
  { path: 'a', type: 'd' }, { path: 'a/b', type: 'd' }, { path: 'a/b/c', type: 'd' }, { path: 'a/b/c/x.txt', type: 'f', data: te.encode('x') },
  { path: 'blocks.bin', type: 'f', data: pattern(5000, (i) => 97 + ((i >> 11) & 7) + (i % 7 === 6 ? -65 : 0)) },
  { path: 'dir', type: 'd' }, { path: 'dir/empty.dat', type: 'f', data: new Uint8Array(0) }, { path: 'dir/hello.txt', type: 'f', data: te.encode('hello world\n') },
  { path: 'emptydir', type: 'd' }, { path: 'Привет 😀.txt', type: 'f', data: te.encode('unicode') },
];

// --- tests -----------------------------------------------------------------------------------------------------

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${extra ? ': ' + extra : ''}`); } };
  const throws = (name, fn, code) => {
    try { fn(); fail++; console.log(`FAIL ${name}: no error`); } catch (e) {
      if (e instanceof ArchiveError && (!code || e.code === code)) pass++;
      else { fail++; console.log(`FAIL ${name}: ${e.code || ''} ${e.message}`); }
    }
  };
  const guard = (name, fn) => { try { fn(); } catch (e) { fail++; console.log(`FAIL ${name}: ${e.stack || e}`); } };
  const open = (b, opts) => openIso([bytesSource(b, 'test.iso')], opts);
  const data = (a, e) => readAll(a.open(e));
  const byPath = (a) => new Map(a.entries.map((e) => [e.path, e]));
  /** Every original item is listed with the right kind, size, link and bytes; nothing else is listed. */
  const compare = (name, a, items, { extra = [], mtime = true } = {}) => {
    const m = byPath(a);
    for (const it of items) {
      const e = m.get(it.path);
      if (!e) { fail++; console.log(`FAIL ${name}: missing ${it.path}`); continue; }
      m.delete(it.path);
      const kind = { f: 'file', d: 'dir', l: 'symlink' }[it.type];
      if (e.kind !== kind) { fail++; console.log(`FAIL ${name}: ${it.path} is ${e.kind}, not ${kind}`); continue; }
      if (it.type === 'l') { eq(`${name} link ${it.path}`, e.link, it.link); continue; }
      if (mtime) eq(`${name} mtime ${it.path}`, e.mtime && e.mtime.getTime(), T0 * 1000);
      if (it.type === 'f') {
        eq(`${name} size ${it.path}`, e.size, it.data.length);
        const d = data(a, e);
        ok(`${name} data ${it.path}`, d.length === it.data.length && crc(d) === crc(it.data));
      }
    }
    for (const p of extra) m.delete(p);
    eq(`${name} unexpected entries`, [...m.keys()], []);
  };

  // --- byte-level image -----------------------------------------------------------------------------------------
  const img = buildImage();
  guard('built image', () => {
    const a = open(img);
    const m = byPath(a);
    eq('built format', [a.format, a.label], ['iso', 'ISO 9660']);
    eq('built paths', a.entries.map((e) => e.path), [
      'a-rock-ridge-name-continued.txt', 'deep', 'deep/inner.txt', 'HIDDEN.TXT', 'INTER.BIN', 'link', 'MULTI.BIN', 'NOEXT', 'sub', 'sub/BACK', 'sub/FILE.TXT',
      'VERSIONED.TXT', 'zisofs.bin', '[BOOT]', '[BOOT]/1-Boot-NoEmul.img', '[BOOT]/2-Boot-HardDisk.img', '[BOOT]/3-NotBoot-1.44M.img',
    ]);
    eq('built warnings', a.info.warnings, ['bad directory record', 'directory loop skipped']);
    const props = Object.fromEntries(a.info.props);
    eq('built props', [props.Volume, props.System, props.Publisher, props.Application, props.Extensions, props.Names, props['Block size']],
      ['PROGRAMMATIC', 'TEST SYSTEM', 'PUBLISHER', 'TEST-ISO', 'Rock Ridge, zisofs, El Torito', 'Rock Ridge', 2048]);
    eq('built dates (GMT offsets)', [props.Created.getTime(), props.Modified.getTime()], [T0 * 1000, T0 * 1000]);
    const ln = m.get('a-rock-ridge-name-continued.txt');
    eq('NM + CE + PX(36) + TF long', [ln.mode, ln.uid, ln.gid, ln.mtime.getTime(), ln.atime.toISOString(), ln.ctime.toISOString()],
      [0o100640, 7, 8, T0 * 1000, '2024-06-07T08:09:10.000Z', '2023-01-02T03:04:05.000Z']);
    eq('NM data', new TextDecoder().decode(data(a, ln)), 'longname!!\n');
    eq('relocated dir', [m.get('deep').dir, m.get('deep').mode, new TextDecoder().decode(data(a, m.get('deep/inner.txt')))], [true, 0o40750, 'inner\n']);
    eq('symlink', [m.get('link').kind, m.get('link').link, m.get('link').mode], ['symlink', '/usr/lib/.././x', 0o120777]);
    eq('symlink open', new TextDecoder().decode(data(a, m.get('link'))), '/usr/lib/.././x');
    eq('record date GMT+8', m.get('NOEXT').mtime.getTime(), T0 * 1000);
    eq('hidden', [m.get('HIDDEN.TXT').attrib, m.has('sub/AFTER.TXT')], [2, false]);
    const multi = m.get('MULTI.BIN');
    eq('multi-extent', [multi.size, crc(data(a, multi))], [MULTI.length, crc(MULTI)]);
    const inter = m.get('INTER.BIN');
    eq('interleaved', [inter.size, crc(data(a, inter))], [INTER.length, crc(INTER)]);
    const z = m.get('zisofs.bin');
    eq('zisofs', [z.size, z.method, crc(data(a, z))], [ZDATA.length, 'zisofs', crc(ZDATA)]);
    eq('zisofs small reads', (() => { const s = a.open(z); let n = 0; for (let b; (b = s.read(1000));) { if (b.length > 1000) return -1; n += b.length; } return n; })(), ZDATA.length);
    eq('directory open', data(a, m.get('sub')).length, 0);
    eq('boot sizes', ['1-Boot-NoEmul', '2-Boot-HardDisk', '3-NotBoot-1.44M'].map((n) => m.get(`[BOOT]/${n}.img`).size), [2048, 2048, (SECTORS - 48) * 2048]);
    eq('boot data', crc(data(a, m.get('[BOOT]/2-Boot-HardDisk.img'))), crc(img.subarray(47 * 2048, 48 * 2048)));
    for (const mode of [1, 2]) {
      const r = open(toRaw(img, mode));
      eq(`raw mode ${mode} listing`, r.entries.map((e) => [e.path, e.size]), a.entries.map((e) => [e.path, e.size]));
      eq(`raw mode ${mode} data`, [crc(data(r, r.entries[6])), crc(data(r, r.entries[4])), crc(data(r, r.entries[12]))], [crc(MULTI), crc(INTER), crc(ZDATA)]);
      ok(`raw mode ${mode} sector size`, r.info.props.some(([k, v]) => k === 'Sector size' && v === 2352));
    }
    const cut = open(img.subarray(0, 41 * 2048));
    ok('truncated warning', (cut.info.warnings || []).some((w) => /truncated/.test(w)), JSON.stringify(cut.info.warnings));
    throws('truncated data', () => readAll(cut.open(byPath(cut).get('NOEXT'))), 'truncated');
    eq('truncated multi-extent still readable', crc(data(cut, byPath(cut).get('MULTI.BIN'))), crc(MULTI));
    const corruptZ = img.slice();
    corruptZ[52 * 2048 + 16 + 16 + 10] ^= 0xff;
    throws('corrupt zisofs block', () => { const c = open(corruptZ); readAll(c.open(byPath(c).get('zisofs.bin'))); }, 'corrupt');
    const deep = open(deepImage(70));
    eq('nesting limit', [deep.entries.length, deep.info.warnings], [64, ['directories nested deeper than 64 levels skipped']]);
  });
  throws('not an image', () => open(pattern(80000, (i) => i & 255)), 'format');
  throws('empty input', () => open(new Uint8Array(0)), 'format');
  throws('openUdf on plain ISO 9660', () => openUdf([bytesSource(img)]), 'format');

  // --- embedded UDF bridge ----------------------------------------------------------------------------------------
  const udfImage = inflateRawSync(Uint8Array.from(atob(UDF_FIXTURE.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
  guard('UDF fixture', () => {
    const u = open(udfImage);
    eq('UDF format', [u.format, u.label], ['udf', 'UDF']);
    compare('UDF', u, SMALL);
    const props = Object.fromEntries(u.info.props);
    eq('UDF props', [props.Volume, props.Version, props.Partitions, props.Bridge], ['BRIDGE250', '2.50', 'metadata', 'ISO 9660 + Joliet']);
    eq('UDF mode', byPath(u).get('dir/hello.txt').mode & 0o170000, 0o100000);
    eq('openUdf', openUdf([bytesSource(udfImage)]).entries.length, SMALL.length);
    const j = open(udfImage, { filesystem: 'iso9660' });
    eq('bridge ISO side', [j.format, Object.fromEntries(j.info.props).Names], ['iso', 'Joliet']);
    compare('bridge Joliet', j, SMALL);
    const raw = open(toRaw(udfImage, 1));
    compare('UDF on raw sectors', raw, SMALL);
    // IMAPI2 writes only short / long allocation descriptors: rewrite extended file entries (main and mirror metadata
    // copies) as data embedded in the entry (hello.txt) and as a symlink (x.txt), with fixed tag checksums.
    const patched = udfImage.slice();
    const patch = (size, fn) => {
      let n = 0;
      for (let o = 0; o + 2048 <= patched.length; o += 2048) {
        const b = patched.subarray(o, o + 2048);
        if (le16(b, 0) !== 266 || b[27] !== 5 || le64(b, 56) !== size) continue;
        fn(b);
        b[34] = (b[34] & ~7) | 3;
        let sum = 0;
        for (let i = 0; i < 16; i++) if (i !== 4) sum += b[i];
        b[4] = sum & 255;
        n++;
      }
      return n;
    };
    const embed = (b, d) => { b.set(le32b(d.length), 212); b.set(d, 216 + le32(b, 208)); };
    ok('UDF patch embedded', patch(12, (b) => embed(b, te.encode('hello world\n'))) > 0);
    const target = [2, 0, 0, 0, 5, 4, 0, 0, 8, ...bytes('usr'), 3, 0, 0, 0, 4, 0, 0, 0, 5, 3, 0, 0, 8, ...bytes('bx')];
    ok('UDF patch symlink', patch(1, (b) => { b[27] = 12; b.set([...le32b(target.length), 0, 0, 0, 0], 56); b.set([...le32b(target.length), 0, 0, 0, 0], 64); embed(b, target); }) > 0);
    const pu = open(patched);
    const hello = byPath(pu).get('dir/hello.txt'), link = byPath(pu).get('a/b/c/x.txt');
    eq('UDF embedded data', [hello.size, hello.packed, new TextDecoder().decode(data(pu, hello))], [12, 12, 'hello world\n']);
    eq('UDF symlink', [link.kind, link.link, link.mode & 0o170000], ['symlink', '/usr/.././bx', 0o120000]);
  });

  // --- generated by bsdtar ----------------------------------------------------------------------------------------
  const bsdtar = findTool(['C:/Windows/System32/tar.exe', 'bsdtar', 'tar'], ['--version'], /bsdtar/);
  const sevenZip = findTool(['C:/Program Files/7-Zip/7z.exe', '7z', '7zz'], ['i'], /7-Zip/);
  if (!bsdtar) console.log('archive iso: bsdtar not found, generated images skipped');
  else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-iso-'));
    try {
      const mkiso = (name, options, input) => {
        const file = path.join(tmp, name);
        const src = typeof input === 'string' ? ['-C', input, '.'] : ['@' + writeTar(input)];
        execFileSync(bsdtar, ['-c', '--format', 'iso9660', '--options', options, '-f', file, ...src], { stdio: 'pipe' });
        return fs.readFileSync(file);
      };
      let tars = 0;
      const writeTar = (items) => { const f = path.join(tmp, `in${tars++}.tar`); fs.writeFileSync(f, tarball(items)); return f; };
      const run1 = (name, fn) => guard(name, fn);

      // Rock Ridge: symlinks (with . and ..), strict modes, owners, a 3 MB file, 12-level directories (relocated)
      const big = pattern(3 * 1024 * 1024 + 123, (i) => (i * 7 + (i >> 9)) & 255);
      const RR = [
        { path: 'dir', type: 'd' }, { path: 'dir/hello.txt', type: 'f', data: te.encode('hello world\n') }, { path: 'dir/empty.dat', type: 'f', data: new Uint8Array(0) },
        { path: 'dir/link', type: 'l', link: '../target/file.txt' }, { path: 'dir/abs', type: 'l', link: '/usr/lib/x' }, { path: 'dir/dots', type: 'l', link: './a/../b' },
        { path: 'target', type: 'd' }, { path: 'target/file.txt', type: 'f', data: te.encode('target\n'.repeat(100)) },
        { path: 'A very long file name that exceeds the sixty-four characters of Joliet names by far.txt', type: 'f', data: te.encode('long') },
        { path: 'exec.sh', type: 'f', data: te.encode('#!/bin/sh\necho hi\n'), mode: 0o755 }, { path: 'noext', type: 'f', data: te.encode('noext') },
        { path: 'big.bin', type: 'f', data: big },
      ];
      let deep = 'deep';
      RR.push({ path: deep, type: 'd' });
      for (let i = 0; i < 12; i++) RR.push({ path: (deep += '/d' + i), type: 'd' });
      RR.push({ path: deep + '/leaf.txt', type: 'f', data: te.encode('leaf') });
      run1('bsdtar Rock Ridge', () => {
        const a = open(mkiso('rr.iso', 'iso9660:rockridge=strict,iso9660:volume-id=RRTEST', RR));
        compare('rr', a, RR);
        const m = byPath(a);
        eq('rr modes', [m.get('exec.sh').mode, m.get('dir/hello.txt').mode, m.get('dir').mode, m.get('dir/link').mode & 0o170000], [0o100755, 0o100644, 0o40755, 0o120000]);
        eq('rr owners', [m.get('exec.sh').uid, m.get('exec.sh').gid], [1000, 100]);
        const props = Object.fromEntries(a.info.props);
        eq('rr props', [props.Volume, props.Extensions, props.Names], ['RRTEST', 'Joliet, Rock Ridge', 'Rock Ridge']);
        eq('rr warnings', a.info.warnings, undefined);
        const j = open(fs.readFileSync(path.join(tmp, 'rr.iso')), { filesystem: 'iso9660' });
        eq('rr open again', j.entries.length, a.entries.length);
      });

      // Joliet only: Unicode names (with a non-BMP character), depth up to 7
      const JOL = [
        { path: 'Привет 😀.txt', type: 'f', data: te.encode('unicode') }, { path: 'Ünïcödé', type: 'd' }, { path: 'Ünïcödé/日本語のファイル.txt', type: 'f', data: te.encode('nihongo') },
        { path: 'Mixed Case Name, with spaces & signs (1).txt', type: 'f', data: te.encode('mixed') }, { path: 'noext', type: 'f', data: te.encode('noext') },
        { path: 'empty', type: 'f', data: new Uint8Array(0) }, { path: 'sub', type: 'd' }, { path: 'sub/s1', type: 'd' }, { path: 'sub/s1/s2', type: 'd' },
        { path: 'sub/s1/s2/s3', type: 'd' }, { path: 'sub/s1/s2/s3/s4', type: 'd' }, { path: 'sub/s1/s2/s3/s4/x.bin', type: 'f', data: pattern(70000, (i) => i % 251) },
      ];
      run1('bsdtar Joliet', () => {
        const a = open(mkiso('joliet.iso', 'iso9660:!rockridge', JOL));
        compare('joliet', a, JOL);
        eq('joliet names', Object.fromEntries(a.info.props).Names, 'Joliet');
      });

      // Levels 1-3 (primary tree only) and ISO 9660:1999: mangled names, the same files
      const files = (items) => items.filter((it) => it.type === 'f').map((it) => [it.data.length, crc(it.data)].join(':')).sort();
      for (const level of [1, 2, 3, 4]) {
        run1(`bsdtar level ${level}`, () => {
          const a = open(mkiso(`l${level}.iso`, `iso9660:!rockridge,iso9660:!joliet,iso9660:iso-level=${level}`, JOL));
          eq(`level ${level} files`, a.entries.filter((e) => e.kind === 'file').map((e) => [e.size, crc(data(a, e))].join(':')).sort(), files(JOL));
          eq(`level ${level} dirs`, a.entries.filter((e) => e.dir).length, JOL.filter((it) => it.type === 'd').length);
          const re = level === 1 ? /^[A-Z0-9_]{1,8}(\.[A-Z0-9_]{1,3})?$/ : level < 4 ? /^[A-Z0-9_.]{1,31}$/ : /^[^/]+$/;
          eq(`level ${level} names`, a.entries.map((e) => e.path.split('/').pop()).filter((n) => !re.test(n)), []);
          eq(`level ${level} kind`, Object.fromEntries(a.info.props).Names, level < 4 ? 'ISO 9660' : 'ISO 9660:1999');
          ok(`level ${level} names kept`, level < 4 || byPath(a).has('noext'));
          if (sevenZip && level < 4) {
            const out = execFileSync(sevenZip, ['l', '-slt', path.join(tmp, `l${level}.iso`)], { encoding: 'utf8' });
            const paths = [...out.matchAll(/^Path = (.*)$/gm)].slice(1).map((x) => x[1].trim().replace(/\\/g, '/')).sort();
            eq(`level ${level} vs 7-Zip`, a.entries.map((e) => e.path).sort(), paths);
          }
        });
      }

      // zisofs (from a directory: bsdtar 3.8.4 writes broken zisofs extents when reading a tar)
      const ZT = [
        { path: 'text.txt', type: 'f', data: te.encode('lorem ipsum dolor sit amet '.repeat(20000)) }, { path: 'zero.bin', type: 'f', data: new Uint8Array(300000) },
        { path: 'pattern.bin', type: 'f', data: pattern(1 << 20, (i) => (i * 7 + (i >> 9)) & 255) }, { path: 'tiny.txt', type: 'f', data: te.encode('tiny') },
        { path: 'empty.txt', type: 'f', data: new Uint8Array(0) },
      ];
      run1('bsdtar zisofs', () => {
        writeTree(path.join(tmp, 'zt'), ZT);
        const a = open(mkiso('zisofs.iso', 'iso9660:zisofs', path.join(tmp, 'zt')));
        compare('zisofs', a, ZT, { mtime: false });
        const m = byPath(a);
        eq('zisofs methods', ['text.txt', 'zero.bin', 'pattern.bin'].map((p) => m.get(p).method), ['zisofs', 'zisofs', 'zisofs']);
        ok('zisofs packed', m.get('zero.bin').packed < 1000 && m.get('text.txt').packed < 10000);
        eq('zisofs info', a.info.methods, ['zisofs']);
      });

      // El Torito: no emulation (size of the boot file in the tree), 1.44M floppy, hard disk (size from the MBR)
      const hd = pattern(64 * 512, (i) => (i < 512 ? 0 : 9));
      hd.set([0x80, 0, 0, 0, 0x83, 0, 0, 0, ...le32b(1), ...le32b(63)], 446);
      hd.set([0x55, 0xaa], 510);
      const BT = [
        { path: 'noemu.bin', type: 'f', data: pattern(5000, (i) => i % 7) }, { path: 'floppy.img', type: 'f', data: pattern(1474560, (i) => i % 13) },
        { path: 'hd.img', type: 'f', data: hd },
      ];
      run1('bsdtar El Torito', () => {
        writeTree(path.join(tmp, 'bt'), BT);
        for (const [type, file, name] of [['no-emulation', 'noemu.bin', 'Boot-NoEmul.img'], ['fd', 'floppy.img', 'Boot-1.44M.img'], ['hard-disk', 'hd.img', 'Boot-HardDisk.img']]) {
          const a = open(mkiso(`boot-${type}.iso`, `iso9660:boot=${file},iso9660:boot-type=${type}`, path.join(tmp, 'bt')));
          const m = byPath(a), e = m.get('[BOOT]/' + name), want = BT.find((it) => it.path === file).data;
          ok(`boot ${type} entry`, !!e, a.entries.map((x) => x.path).join(', '));
          if (e) eq(`boot ${type} data`, [e.size, crc(data(a, e))], [want.length, crc(want)]);
          ok(`boot ${type} extension`, Object.fromEntries(a.info.props).Extensions.includes('El Torito'));
        }
      });

      if (sevenZip) {
        run1('7-Zip UDF', () => {
          const f = path.join(tmp, 'udf.iso');
          fs.writeFileSync(f, udfImage);
          const out = execFileSync(sevenZip, ['l', '-slt', f], { encoding: 'utf8' });
          eq('UDF vs 7-Zip', /Type = Udf/.test(out) && [...out.matchAll(/^Size = (\d+)/gm)].map((x) => +x[1]).sort((x, y) => x - y).join(), SMALL.filter((it) => it.type === 'f').map((it) => it.data.length).sort((x, y) => x - y).join());
        });
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  console.log(`archive iso: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
