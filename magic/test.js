// magic/test.js - unit tests of type detection and structure layouts: `node magic/test.js` (importing runs nothing).
// Hand-made headers of every family, containers refined by content (Office Open XML, ODF, EPUB, JAR, APK made with
// the ZIP writer; RIFF; ISO BMFF brands; Ogg codecs; EBML doc types), text sniffing, the name as a tie-breaker, and
// the field layouts of ZIP (with the central directory from the tail), PNG (CRCs checked), tar, gzip, 7z and xz.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from '../codec/crc32.js';
import { gzip } from '../pack/gzip.js';
import { sevenZip } from '../pack/sevenzip.js';
import { tar } from '../pack/tar.js';
import { xz } from '../pack/xz.js';
import { writeZip } from '../zip/zip.js';
import { SIGNATURES, detectType, mimeOfName } from './index.js';
import { describeStructure } from './structure.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const te = new TextEncoder();
const A = (s) => Array.from(s, (c) => c.charCodeAt(0));
const bytes = (...parts) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? A(p) : Array.isArray(p) ? p : [p])));
const pad = (b, n) => { const o = new Uint8Array(Math.max(n, b.length)); o.set(b); return o; };
const be32 = (v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

function pngChunk(type, data) {
  const body = bytes(type, Array.from(data));
  const c = crc32(body);
  return [...be32(data.length), ...body, ...be32(c)];
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const mime = (b, name) => detectType(b, name).mime;

  // --- signatures --------------------------------------------------------------------------------------------------
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pngChunk('IHDR', bytes(be32(16), be32(8), 8, 6, 0, 0, 0)), pngChunk('IEND', new Uint8Array(0)));
  const cases = [
    ['png', png, 'image/png'], ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF\0'), 'image/jpeg'], ['gif', bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0]), 'image/gif'],
    ['bmp', pad(bytes('BM', [0, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0]), 64), 'image/bmp'], ['tiff', bytes([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), 'image/tiff'],
    ['ico', pad(bytes([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]), 40), 'image/x-icon'], ['psd', bytes('8BPS', [0, 1]), 'image/vnd.adobe.photoshop'], ['qoi', bytes('qoif'), 'image/qoi'],
    ['webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'image/webp'], ['wav', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '), 'audio/wav'], ['avi', bytes('RIFF', [0, 0, 0, 0], 'AVI LIST'), 'video/x-msvideo'],
    ['flac', bytes('fLaC', [0, 0, 0, 34]), 'audio/flac'], ['mp3 id3', bytes('ID3', [3, 0, 0, 0, 0, 0, 0], [0xff, 0xfb, 0x90, 0x64]), 'audio/mpeg'], ['mp3 frame', bytes([0xff, 0xfb, 0x90, 0x64, 0, 0]), 'audio/mpeg'],
    ['aac adts', bytes([0xff, 0xf1, 0x50, 0x80, 0, 0x1f, 0xfc]), 'audio/aac'], ['midi', bytes('MThd', [0, 0, 0, 6]), 'audio/midi'],
    ['opus', bytes('OggS', [0, 2], new Array(20).fill(0), [1, 19], 'OpusHead'), 'audio/opus'], ['vorbis', bytes('OggS', [0, 2], new Array(20).fill(0), [1, 30], [1], 'vorbis'), 'audio/ogg'],
    ['theora', bytes('OggS', [0, 2], new Array(20).fill(0), [1, 42], [0x80], 'theora'), 'video/ogg'],
    ['webm', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0x82, 0x84], 'webm'), 'video/webm'], ['mkv', bytes([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x82, 0x88], 'matroska'), 'video/x-matroska'],
    ['mp4', bytes([0, 0, 0, 0x18], 'ftypisom', [0, 0, 2, 0], 'isomiso2'), 'video/mp4'], ['m4a', bytes([0, 0, 0, 0x14], 'ftypM4A ', [0, 0, 0, 0], 'M4A '), 'audio/mp4'],
    ['mov', bytes([0, 0, 0, 0x14], 'ftypqt  ', [0, 0, 0, 0], 'qt  '), 'video/quicktime'], ['heic', bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0], 'mif1heic'), 'image/heic'],
    ['avif', bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'avifmif1miaf'), 'image/avif'], ['3gp', bytes([0, 0, 0, 0x14], 'ftyp3gp4', [0, 0, 0, 0], 'isom'), 'video/3gpp'],
    ['pdf', bytes('%PDF-1.7\n'), 'application/pdf'], ['rtf', bytes('{\\rtf1\\ansi'), 'application/rtf'], ['sqlite', bytes('SQLite format 3\0', [16, 0]), 'application/vnd.sqlite3'],
    ['woff2', bytes('wOF2', [0, 1, 0, 0]), 'font/woff2'], ['otf', bytes('OTTO', [0, 9]), 'font/otf'], ['ttf', bytes([0, 1, 0, 0, 0, 0x10]), 'font/ttf'],
    ['elf', bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], new Array(8).fill(0), [3, 0, 0x3e, 0]), 'application/x-elf'], ['wasm', bytes([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), 'application/wasm'],
    ['macho', bytes([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]), 'application/x-mach-binary'], ['java class', bytes([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]), 'application/java-vm'],
    ['7z', bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), 'application/x-7z-compressed'], ['rar5', bytes('Rar!', [0x1a, 7, 1, 0]), 'application/vnd.rar'], ['rar4', bytes('Rar!', [0x1a, 7, 0]), 'application/vnd.rar'],
    ['xz', bytes([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]), 'application/x-xz'], ['bzip2', bytes('BZh91AY&SY'), 'application/x-bzip2'], ['zstd', bytes([0x28, 0xb5, 0x2f, 0xfd, 0x20]), 'application/zstd'],
    ['gzip', bytes([0x1f, 0x8b, 8, 0]), 'application/gzip'], ['lzma', pad(bytes([0x5d, 0, 0, 0x80, 0]), 20), 'application/x-lzma'], ['cab', bytes('MSCF\0\0\0\0'), 'application/vnd.ms-cab-compressed'],
    ['ar', bytes('!<arch>\n'), 'application/x-archive'], ['rpm', bytes([0xed, 0xab, 0xee, 0xdb, 3, 0]), 'application/x-rpm'], ['lz4', bytes([4, 0x22, 0x4d, 0x18]), 'application/x-lz4'],
    ['kdbx', bytes([0x03, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5]), 'application/x-keepass2'], ['mpeg-ts', Uint8Array.from({ length: 564 }, (_, i) => (i % 188 === 0 ? 0x47 : 0)), 'video/mp2t'],
    ['iso', (() => { const b = new Uint8Array(0x8800); b.set(A('CD001'), 0x8001); return b; })(), 'application/x-iso9660-image'],
    ['tar', tar([{ path: 'a.txt', data: te.encode('x') }]), 'application/x-tar'],
  ];
  for (const [name, b, want] of cases) eq('signature ' + name, mime(b), want);
  {
    const pe = new Uint8Array(512);
    pe.set(A('MZ'));
    pe[0x3c] = 0x80;
    pe.set(A('PE\0\0'), 0x80);
    pe.set([0x64, 0x86], 0x84);
    const r = detectType(pe);
    eq('PE x64', [r.mime, r.detail], ['application/vnd.microsoft.portable-executable', 'x64']);
    pe.set([0x02, 0x20], 0x96); // characteristics: DLL
    eq('PE dll', detectType(pe).label, 'Windows library');
    eq('DOS exe', detectType(bytes('MZ', new Array(70).fill(0))).label, 'DOS executable');
  }

  // --- containers refined by content ---------------------------------------------------------------------------------
  const zipOf = async (files) => writeZip(files.map(([name, data]) => ({ name, data, store: true })));
  eq('docx', mime(await zipOf([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<w/>']])), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  eq('xlsx', mime(await zipOf([['[Content_Types].xml', '<Types/>'], ['xl/workbook.xml', '<x/>']])), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  eq('pptx', mime(await zipOf([['[Content_Types].xml', '<Types/>'], ['ppt/presentation.xml', '<p/>']])), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  eq('epub', mime(await zipOf([['mimetype', 'application/epub+zip'], ['META-INF/container.xml', '<c/>']])), 'application/epub+zip');
  eq('odt', mime(await zipOf([['mimetype', 'application/vnd.oasis.opendocument.text'], ['content.xml', '<c/>']])), 'application/vnd.oasis.opendocument.text');
  eq('jar', mime(await zipOf([['META-INF/MANIFEST.MF', 'Manifest-Version: 1.0'], ['a/B.class', 'x']])), 'application/java-archive');
  eq('apk', mime(await zipOf([['AndroidManifest.xml', 'x'], ['classes.dex', 'dex\n035']])), 'application/vnd.android.package-archive');
  eq('plain zip', mime(await zipOf([['a.txt', 'x']])), 'application/zip');
  {
    const cfb = new Uint8Array(2048);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    cfb[0x1e] = 9;
    const dir = 512; // directory in sector 0
    const name = 'Root Entry'; for (let i = 0; i < name.length; i++) cfb[dir + i * 2] = name.charCodeAt(i);
    const w = 'WordDocument'; for (let i = 0; i < w.length; i++) cfb[dir + 128 + i * 2] = w.charCodeAt(i);
    eq('doc by stream name', mime(cfb), 'application/msword');
    cfb.set([0x84, 0x10, 0x0c, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46], dir + 0x50);
    eq('msi by CLSID', mime(cfb), 'application/x-msi');
  }

  // --- text -----------------------------------------------------------------------------------------------------
  const tx = (s, name) => detectType(te.encode(s), name);
  eq('html', tx('  <!DOCTYPE html><html>').mime, 'text/html');
  eq('svg', tx('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>').mime, 'image/svg+xml');
  eq('xml', tx('<?xml version="1.0"?><root/>').mime, 'application/xml');
  eq('json', tx('{"a": [1, 2, {"b": null}]}').mime, 'application/json');
  eq('shebang python', tx('#!/usr/bin/env python3\nprint(1)').mime, 'text/x-python');
  eq('shebang sh', tx('#!/bin/sh\necho').mime, 'application/x-sh');
  eq('pem', tx('-----BEGIN CERTIFICATE-----\nMIIB').mime, 'application/x-pem-file');
  eq('plain utf-8', [tx('Привет, мир').mime, tx('Привет, мир').detail], ['text/plain', 'UTF-8']);
  eq('csv by name', tx('a,b\n1,2', 'data.csv').mime, 'text/csv');
  eq('utf-16 bom', detectType(bytes([0xff, 0xfe], 'a\0b\0')).detail, 'UTF-16 LE');
  eq('binary', detectType(bytes([0, 1, 2, 3, 0, 0, 0xff, 7, 0, 9])).mime, 'application/octet-stream');
  eq('binary with name', [detectType(bytes([0, 1, 2, 3]), 'thing.docx').by, detectType(bytes([0, 1, 2, 3]), 'thing.docx').kind], ['name', 'document']);
  eq('signature wins over the name', mime(png, 'photo.jpg'), 'image/png');
  eq('empty', detectType(new Uint8Array(0)).mime, 'application/x-empty');
  eq('mimeOfName', [mimeOfName('a.tar.gz').label, mimeOfName('B.JPEG').mime, mimeOfName('x.unknownext')], ['tar.gz', 'image/jpeg', null]);
  eq('table size', SIGNATURES.length >= 100, true);
  eq('ids unique', new Set(SIGNATURES.map((s) => s.id)).size, SIGNATURES.length);

  // --- structures -------------------------------------------------------------------------------------------------
  {
    const s = describeStructure(png);
    eq('png format', s.format, 'PNG');
    eq('png chunk types', s.fields.filter((f) => f.name === 'Chunk type').map((f) => f.value.slice(0, 4)), ['IHDR', 'IEND']);
    eq('png IHDR value', s.fields.find((f) => f.name === 'Chunk data (IHDR)').value, '16 × 8, 8-bit, colour type 6');
    eq('png CRC ok', s.fields.filter((f) => f.name === 'CRC-32').every((f) => f.ok !== false && f.value.endsWith('✓')), true);
    const bad = png.slice(); bad[20] ^= 1;
    eq('png CRC mismatch flagged', describeStructure(bad).fields.find((f) => f.name === 'CRC-32').ok, false);
    eq('png fields ordered and disjoint', s.fields.every((f, i) => i === 0 || f.start >= s.fields[i - 1].end), true);
  }
  {
    const z = await writeZip([{ name: 'a.txt', data: 'hello', store: true }, { name: 'dir/b.txt', data: 'world!', store: true }]);
    const s = describeStructure(z, { size: z.length });
    eq('zip local names', s.fields.filter((f) => f.name === 'File name').map((f) => f.value), ['a.txt', 'dir/b.txt', 'a.txt', 'dir/b.txt']);
    eq('zip end record', s.fields.some((f) => f.name === 'End of central directory'), true);
    eq('zip method', s.fields.find((f) => f.name === 'Method').value, 'stored');
    // Only the head and a tail of a large file.
    const head = z.subarray(0, 40), tailOffset = z.length - 60;
    const s2 = describeStructure(head, { size: z.length, tail: z.subarray(tailOffset), tailOffset });
    eq('zip tail fields have file offsets', s2.fields.find((f) => f.name === 'End of central directory').start, z.length - 22);
  }
  {
    const t = tar([{ path: 'a.txt', data: te.encode('abc'), mtime: 0 }]);
    const s = describeStructure(t);
    eq('tar fields', [s.format, s.fields.find((f) => f.name === 'Name').value, s.fields.find((f) => f.name === 'Size').value], ['tar', 'a.txt', '3']);
    const g = gzip(te.encode('hello'), { name: 'h.txt', mtime: 1700000000000 });
    const sg = describeStructure(g, { size: g.length });
    eq('gzip fields', [sg.fields.find((f) => f.name === 'Original name').value, sg.fields.find((f) => f.name === 'Uncompressed size (mod 2³²)').value], ['h.txt', '5']);
    const s7 = describeStructure(sevenZip([{ path: 'a', data: te.encode('aaaa') }]));
    eq('7z start header CRC checked', s7.fields.find((f) => f.name === 'Start header CRC').value.endsWith('✓'), true);
    const sx = describeStructure(xz(te.encode('x')), {});
    eq('xz check type', sx.fields.find((f) => f.name === 'Stream flags').value, 'check CRC64');
    eq('unknown structure', describeStructure(te.encode('just text')), null);
  }

  console.log(`magic: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) run().then((f) => process.exit(f ? 1 : 0));
