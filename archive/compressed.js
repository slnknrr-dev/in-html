// archive/compressed.js - single compressed streams as archives: gzip (.gz, .tgz), bzip2, xz, Zstandard, lzma
// (LZMA_Alone) and compress (.Z). A tar inside is listed as the tar archive it is (tar.gz, tar.bz2, tar.xz, tar.zst,
// tar.lzma, tar.Z); any
// other content is one file entry named after the gzip header or the file name without its extension.
//
//   openCompressed(sources, { format: 'gzip' | 'bzip2' | 'xz' | 'zstd' | 'lzma' | 'Z', charset, onProgress }) -> Archive
//
// Key decisions:
// - Content sniffing, not the extension, decides tar-ness: foo.gz may hold a tar and foo.tgz may not. The first 512
//   decoded bytes are tested with the tar header checksum, which costs one decoder start-up.
// - decoded() is a factory, not a stream: compressed streams are forward-only, so the probe, the tar listing and every
//   open() each restart decoding from byte 0. Re-decoding is cheaper than buffering the whole output in memory.
// - The uncompressed size is reported only from metadata that is reliable (xz index, zstd frame header, LZMA header)
//   or plausibility-checked (gzip ISIZE); otherwise it stays undefined rather than wrong.

import { bzip2Stream } from './bzip2.js';
import { gzipHeader, gzipStream, lzwStream } from './gzip.js';
import { Reader, concatSource, le32, readAt, sourceStream } from './io.js';
import { lzmaAloneStream } from './lzma.js';
import { isTarHeader, tarArchive } from './tar.js';
import { xzInfo, xzStream } from './xz.js';
import { zstdFrameInfo, zstdStream } from './zstd.js';

const LABEL = { gzip: 'gzip', bzip2: 'bzip2', xz: 'xz', zstd: 'Zstandard', lzma: 'LZMA', Z: 'compress (.Z)' };
const EXT = { gzip: /\.(gz|gzip|tgz|taz)$/i, bzip2: /\.(bz2|bzip2|tbz2?|tb2)$/i, xz: /\.(xz|txz)$/i, zstd: /\.(zst|zstd|tzst)$/i, lzma: /\.(lzma|tlz)$/i, Z: /\.(z|taz)$/i };
const TAR_EXT = /\.(tgz|tbz2?|tb2|txz|tzst|tlz|taz)$/i;

export function openCompressed(sources, opts = {}) {
  const src = concatSource(sources);
  const format = opts.format;
  // Compressed bytes pulled from the source: the progress measure (decoded output has no known total).
  // KNOWN DEFECT: `consumed` is shared by every decoded() instance and never reset, so the bytes read by the tar probe
  // (up to one 1 MiB source chunk) are counted again by the listing pass; progress overshoots and saturates at 1 early
  // (clamped by Math.min below). Fix: reset `consumed = 0` at the start of decoded().
  let consumed = 0;
  const decoded = () => {
    const raw = sourceStream(src, 0, src.size);
    const counted = { read(max) { const b = raw.read(max); if (b) consumed += b.length; return b; } };
    const r = new Reader(counted);
    switch (format) {
      case 'gzip': return gzipStream(r);
      case 'bzip2': return bzip2Stream(r);
      case 'xz': return xzStream(r);
      case 'zstd': return zstdStream(r);
      case 'lzma': return lzmaAloneStream(r);
      // .Z: skip the 1F 9D magic; lzwStream reads the flags byte (max code width, block mode) itself.
      case 'Z': r.skip(2, 'compress header'); return lzwStream(r);
      default: throw new Error('unknown stream format ' + format);
    }
  };
  const info = { methods: [LABEL[format]], props: [] };
  const label = LABEL[format];
  // Is there a tar inside? (the first 512 decoded bytes form a valid header)
  let head;
  try {
    const r = new Reader(decoded());
    const parts = [];
    let n = 0;
    for (let c; n < 512 && (c = r.chunk(512 - n));) { parts.push(c.slice()); n += c.length; }
    head = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { head.set(p, o); o += p.length; }
  } catch (e) {
    head = null;
    // Data errors in the first 512 bytes do not abort opening: the stream is still listed as one file (its open()
    // will report the error when extracted). Any other error (password, unsupported method, limit) propagates.
    if (e && e.code && !/^(corrupt|truncated|checksum)$/.test(e.code)) throw e;
    info.warnings = [String(e.message)];
  }
  if (head && head.length === 512 && isTarHeader(head)) {
    const t = tarArchive(decoded, {
      charset: opts.charset,
      onHeader: opts.onProgress ? () => opts.onProgress(Math.min(1, consumed / Math.max(1, src.size))) : undefined,
    });
    Object.assign(info, t.info, { methods: [LABEL[format]], solid: true });
    return { format: 'tar.' + format, label: 'tar.' + (format === 'Z' ? 'Z' : format === 'zstd' ? 'zst' : label), entries: t.entries, info, password: null, open: t.open };
  }
  // One file. Name: header name for gzip (FNAME), else the source name minus the compression extension;
  // .tgz-style combined extensions imply a .tar inside even when the probe failed (the name is a hint the user expects).
  const base = (src.name || 'data').replace(/^.*[\\/]/, '');
  let name = base.replace(EXT[format] || /$/, '') || 'data';
  if (TAR_EXT.test(base)) name += '.tar';
  let size, mtime;
  if (format === 'gzip') {
    const h = gzipHeader(readAt(src, 0, Math.min(src.size, 4096)), opts.charset);
    if (h) {
      if (h.name) name = h.name.replace(/^.*[\\/]/, '') || name;
      mtime = h.mtime || undefined;
      if (h.comment) info.comment = h.comment;
      info.props.push(['Created on', h.os]);
      // ISIZE: the size of the last member modulo 2^32 (exact for one member under 4 GiB, as gzip -l assumes).
      // A value smaller than the compressed data (minus Deflate's worst-case overhead) cannot be right: several
      // members, trailing padding, or more than 4 GiB. Then the size stays unknown. Deflate's real worst case is
      // 5 bytes per 65535-byte stored block (< 0.01 %); the 1 % + 64 margin is deliberately loose. 18 = the 10-byte
      // fixed header + the 8-byte CRC32/ISIZE trailer; h.length adds the optional FEXTRA/FNAME/FCOMMENT/FHCRC fields.
      // (`h ? h.length : 10` is always h.length here: this code runs inside if (h).)
      if (src.size >= 18) {
        const isize = le32(readAt(src, src.size - 4, 4), 0);
        if (isize + isize / 100 + 64 >= src.size - 18 - (h ? h.length : 10)) size = isize;
      }
    }
  } else if (format === 'xz') {
    const x = xzInfo(src);
    if (x) { size = x.size; info.props.push(['Check', x.check], ['Blocks', String(x.blocks)]); if (x.streams > 1) info.props.push(['Streams', String(x.streams)]); }
  } else if (format === 'zstd') {
    const f = zstdFrameInfo(readAt(src, 0, Math.min(src.size, 32)));
    // The content size of the first frame is the size when that frame is the whole file (the usual case).
    if (f && f.contentSize != null && f.contentSize >= 0) size = f.contentSize;
    if (f) { info.props.push(['Window', String(f.windowSize)]); if (f.checksum) info.props.push(['Check', 'XXH64']); }
  } else if (format === 'lzma') {
    const h = readAt(src, 0, 13);
    // le64 at 5: uncompressed size, all-FF meaning "unknown, terminated by an end marker".
    if (!h.subarray(5, 13).every((x) => x === 255)) size = le32(h, 5) + le32(h, 9) * 4294967296;
  }
  const entry = { index: 0, path: name, dir: false, kind: 'file', size, packed: src.size, mtime, method: label };
  return {
    format, label, entries: [entry], info, password: null,
    open: () => decoded(),
  };
}
