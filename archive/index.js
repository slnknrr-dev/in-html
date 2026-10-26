// archive/index.js - one entry point for every format of the library: detection by signature, dispatch to the
// format module, safe entry paths and summary statistics.
//
//   openArchive(sources, { password, charset, onProgress }) -> Archive (README.md) plus
//     archive.stats = { files, dirs, size, packed, encrypted, unknownSizes }
//   groupVolumes(names), detectFormat(src), ArchiveError, sources: bytesSource / fileSource / concatSource
//
// Contract with the format modules: open<Format>(sources, opts) returns { entries, info?, open(entry), … } with
// entry paths already '/'-separated (each module converts its native '\' separators, see zip.js / tar.js / arc.js).
// This module then applies the one security policy for all formats (cleanPath) and computes the statistics, so a
// new format cannot forget either.

import { openArc } from './arc.js';
import { openCompressed } from './compressed.js';
import { UNSUPPORTED_LABELS, detectFormat, groupVolumes } from './detect.js';
import { ArchiveError, bytesSource, concatSource, fail, fileSource, readAll } from './io.js';
import { openIso } from './iso.js';
import { openRar } from './rar.js';
import { openRar5 } from './rar5.js';
import { openSevenZip } from './sevenzip.js';
import { openTar } from './tar.js';
import { openZip } from './zip.js';

export { ArchiveError, bytesSource, concatSource, detectFormat, fileSource, groupVolumes, readAll };

/**
 * Entry paths become relative paths without empty, '.' or '..' segments (an archive cannot write outside the
 * folder it is extracted to); entries that name only the root are dropped. `unsafe` marks a path that had '..'.
 */
// Zip-slip defence: '..' segments are dropped (not resolved against earlier segments: 'a/../../b' must not climb out
// via a resolved '../b'), empty segments drop leading '/' (absolute paths) and '//' runs. A drive prefix 'C:' is only
// flagged, not stripped: the consumer (a browser download or an in-memory tree) cannot write to a drive anyway, and
// the flag lets the UI warn. Splitting on '/' only is safe because the format modules have already turned '\' into '/'.
export function cleanPath(p) {
  const segs = [];
  let unsafe = false;
  for (const s of String(p).split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') { unsafe = true; continue; }
    segs.push(s);
  }
  return { path: segs.join('/'), unsafe: unsafe || /^[a-z]:/i.test(p) };
}

export function openArchive(sources, opts = {}) {
  if (!sources.length) fail('format', 'no files');
  const d = detectFormat(sources[0]);
  if (!d) fail('format', 'unknown format');
  if (UNSUPPORTED_LABELS[d.format]) fail('unsupported', 'not supported: ' + d.label, { formatLabel: d.label });
  // `??` for the password: an empty string is a valid (if weak) password and must not become null. `offset` carries the
  // SFX stub length found by detection, so the reader starts at the embedded archive.
  const o = { password: opts.password ?? null, charset: opts.charset || 'auto', onProgress: opts.onProgress, offset: d.offset };
  let arc;
  switch (d.format) {
    case '7z': arc = openSevenZip(sources, o); break;
    case 'rar5': arc = openRar5(sources, o); break;
    case 'rar': case 'rar14': arc = openRar(sources, o); break;
    case 'zip': arc = openZip(sources, o); break;
    case 'gzip': case 'bzip2': case 'xz': case 'zstd': case 'lzma': case 'Z': arc = openCompressed(sources, { ...o, format: d.format }); break;
    case 'tar': arc = openTar(sources, o); break;
    case 'iso': case 'udf': arc = openIso(sources, o); break;
    case 'arc': arc = openArc(sources, o); break;
    default: fail('unsupported', 'not supported: ' + d.label);
  }
  if (d.offset && arc.info && arc.info.sfx == null) arc.info.sfx = d.offset;
  // Clean paths; keep the format's own entry objects (open() receives them).
  const entries = [];
  const stats = { files: 0, dirs: 0, size: 0, packed: 0, encrypted: 0, unknownSizes: 0 };
  for (const e of arc.entries) {
    const c = cleanPath(e.path);
    // An entry naming only the root ('/', '.', '..') has nothing to extract; ids are assigned after filtering so they
    // stay dense indices into the returned array.
    if (!c.path) continue;
    e.path = c.path;
    if (c.unsafe) e.unsafe = true;
    e.id = entries.length;
    entries.push(e);
    if (e.dir) { stats.dirs++; continue; }
    stats.files++;
    // Unknown sizes (streams without a trailer length) are counted, not guessed, so the UI can say "at least N bytes".
    if (e.size == null) stats.unknownSizes++; else stats.size += e.size;
    if (e.packed) stats.packed += e.packed;
    if (e.encrypted) stats.encrypted++;
  }
  arc.entries = entries;
  arc.stats = stats;
  arc.detected = d;
  if (!arc.info) arc.info = {};
  return arc;
}
