// pack/index.js - archive creation in pure JavaScript: one entry point over the writers of this folder and the ZIP
// writer of ../zip/zip.js. Every writer is synchronous except ZIP (Compression Streams).
//
//   packArchive(format, entries, { level, name }) -> Promise<Uint8Array>
//     format: one of PACK_FORMATS ids; entries as in tar.js ({ path, data, dir, kind, link, mtime, mode });
//     single-stream formats (gz, bz2, xz, zst, lzma) take exactly one file
//   PACK_FORMATS: [{ id, label, ext, single?, levels: [min, max, default] }]
//   packFormatOf(name) -> format id by the file name ('backup.tar.xz' -> 'tar.xz'), or null
//   compressStream(format, bytes, opts) -> Uint8Array   ('gz' | 'bz2' | 'xz' | 'zst' | 'lzma')

import { ZipWriter } from '../zip/zip.js';
import { bzip2 } from './bzip2.js';
import { gzip } from './gzip.js';
import { lzmaAlone } from './lzma.js';
import { sevenZip } from './sevenzip.js';
import { tar } from './tar.js';
import { xz } from './xz.js';
import { zstd } from './zstd.js';

export { bzip2, gzip, lzmaAlone, sevenZip, tar, xz, zstd };

// levels: [min, max, default] for the UI slider; null = no level (plain tar). ZIP offers only store (0) / deflate.
// 'single' formats compress one byte stream and cannot hold a tree.
export const PACK_FORMATS = [
  { id: 'zip', label: 'ZIP', ext: '.zip', levels: [0, 1, 1] },
  { id: '7z', label: '7z (LZMA2)', ext: '.7z', levels: [1, 9, 5] },
  { id: 'tar', label: 'tar', ext: '.tar', levels: null },
  { id: 'tar.gz', label: 'tar.gz', ext: '.tar.gz', levels: [1, 9, 6] },
  { id: 'tar.bz2', label: 'tar.bz2', ext: '.tar.bz2', levels: [1, 9, 9] },
  { id: 'tar.xz', label: 'tar.xz', ext: '.tar.xz', levels: [0, 9, 6] },
  { id: 'tar.zst', label: 'tar.zst', ext: '.tar.zst', levels: [1, 9, 3] },
  { id: 'gz', label: 'gzip', ext: '.gz', single: true, levels: [1, 9, 6] },
  { id: 'bz2', label: 'bzip2', ext: '.bz2', single: true, levels: [1, 9, 9] },
  { id: 'xz', label: 'xz', ext: '.xz', single: true, levels: [0, 9, 6] },
  { id: 'zst', label: 'Zstandard', ext: '.zst', single: true, levels: [1, 9, 3] },
  { id: 'lzma', label: 'LZMA', ext: '.lzma', single: true, levels: [0, 9, 6] },
];

// Short Unix aliases first; they do not end with any PACK_FORMATS ext.
const ALIASES = [[/\.(tgz|taz)$/i, 'tar.gz'], [/\.(tbz2?|tb2)$/i, 'tar.bz2'], [/\.txz$/i, 'tar.xz'], [/\.tzst$/i, 'tar.zst']];

export function packFormatOf(name) {
  const n = String(name).toLowerCase();
  for (const [re, id] of ALIASES) if (re.test(n)) return id;
  // Longest matching extension wins, so 'x.tar.gz' is 'tar.gz' and not 'gz'.
  let best = null;
  for (const f of PACK_FORMATS) if (n.endsWith(f.ext) && (!best || f.ext.length > best.ext.length)) best = f;
  return best ? best.id : null;
}

export function compressStream(format, data, { level, name, mtime } = {}) {
  const f = PACK_FORMATS.find((x) => x.id === format);
  // '??' not '||': level 0 is a real choice (xz/lzma -0).
  const lv = level ?? (f && f.levels ? f.levels[2] : undefined);
  switch (format) {
    case 'gz': return gzip(data, { level: lv, name, mtime });
    case 'bz2': return bzip2(data, { level: lv });
    case 'xz': return xz(data, { level: lv });
    case 'zst': return zstd(data, { level: lv });
    case 'lzma': return lzmaAlone(data, { level: lv });
    default: throw new Error('not a stream format: ' + format);
  }
}

export async function packArchive(format, entries, opts = {}) {
  const f = PACK_FORMATS.find((x) => x.id === format);
  if (!f) throw new Error('unknown format: ' + format);
  if (f.single) {
    // Directories are ignored rather than refused, so selecting a folder with one file in it still works.
    const files = entries.filter((e) => !e.dir && e.kind !== 'dir');
    if (files.length !== 1) throw Object.assign(new Error(f.label + ' holds exactly one file'), { code: 'single' });
    const e = files[0];
    return compressStream(format, e.data || new Uint8Array(0), { level: opts.level, name: e.path.replace(/^.*\//, ''), mtime: e.mtime });
  }
  if (format === 'zip') {
    const z = new ZipWriter({ method: opts.level === 0 ? 'store' : 'deflate' });
    for (const e of entries) {
      const time = e.mtime instanceof Date ? e.mtime : typeof e.mtime === 'number' ? new Date(e.mtime) : undefined;
      if (e.dir || e.kind === 'dir') await z.add(e.path + '/', null, { time, mode: e.mode, dir: true });
      // Symlinks as Info-ZIP stores them: the target as stored data plus S_IFLNK in the external attributes.
      else if (e.kind === 'symlink' && e.link != null) await z.add(e.path, new TextEncoder().encode(e.link), { time, mode: 0o120777, store: true });
      else await z.add(e.path, e.data || new Uint8Array(0), { time, mode: e.mode });
    }
    return new Uint8Array(await (await z.finish()).arrayBuffer());
  }
  if (format === '7z') return sevenZip(entries, { level: opts.level ?? f.levels[2] });
  // tar.* = tar, then one stream compressor over the whole archive (solid by construction).
  const t = tar(entries);
  if (format === 'tar') return t;
  return compressStream({ 'tar.gz': 'gz', 'tar.bz2': 'bz2', 'tar.xz': 'xz', 'tar.zst': 'zst' }[format], t, { level: opts.level });
}
