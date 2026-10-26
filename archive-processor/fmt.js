// archive-processor/fmt.js - display formats: sizes with localized units, dates, ratios, Unix modes and DOS attributes,
// file kinds by extension (icons, previews, MIME types), text detection and preview decoding.
// 
// Rules: pure functions, language read at call time (UI_STATE.lang), never throw on bad input ('' or '—' instead):
// formatters run inside render loops of virtual lists, where one exception would blank the whole view.
import { t } from '../ui/i18n.js';
import { UI_STATE } from '../ui/i18n.js';

// Intl.NumberFormat throws RangeError for an unknown locale tag; fall back to English instead of breaking every size cell.
const nf = (opts) => { try { return new Intl.NumberFormat(UI_STATE.lang, opts); } catch { return new Intl.NumberFormat('en', opts); } };

// Binary units (1024) with localized unit names; one decimal below 10 (1.5 MB), none above (15 MB): ~2–3 significant digits.
export function fmtSize(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return nf({ maximumFractionDigits: 0 }).format(n) + ' ' + t('ax.u.b');
  const units = ['kb', 'mb', 'gb', 'tb'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return nf({ maximumFractionDigits: v < 10 ? 1 : 0 }).format(v) + ' ' + t('ax.u.' + units[i]);
}

export const fmtCount = (n) => nf({ maximumFractionDigits: 0 }).format(n);

export function fmtDate(ms, long = false) {
  if (ms == null) return '';
  const d = new Date(ms);
  if (isNaN(d)) return '';
  try { return new Intl.DateTimeFormat(UI_STATE.lang, long ? { dateStyle: 'medium', timeStyle: 'medium' } : { dateStyle: 'short', timeStyle: 'short' }).format(d); } catch { return d.toISOString(); }
}

/** Packed / unpacked as a percentage ('—' when unknown). */
export function fmtRatio(packed, size) {
  if (!size || packed == null) return '—';
  return nf({ maximumFractionDigits: 1 }).format((packed / size) * 100) + ' %';
}

// ls -l style: file type from the S_IFMT bits (0o170000), then rwx triplets. setuid/setgid/sticky replace x with s/s/t,
// upper-case when the underlying x bit is off (as ls does).
export function fmtMode(m) {
  if (m == null) return '';
  const type = { 0o040000: 'd', 0o120000: 'l', 0o020000: 'c', 0o060000: 'b', 0o010000: 'p', 0o140000: 's' }[m & 0o170000] || '-';
  const r = (v, s, x, xs) => (v & 4 ? 'r' : '-') + (v & 2 ? 'w' : '-') + (s ? (v & 1 ? xs : xs.toUpperCase()) : v & 1 ? x : '-');
  return type + r((m >> 6) & 7, m & 0o4000, 'x', 's') + r((m >> 3) & 7, m & 0o2000, 'x', 's') + r(m & 7, m & 0o1000, 'x', 't');
}

// DOS attribute bits: 1 read-only, 2 hidden, 4 system, 16 directory, 32 archive.
export function fmtAttrib(a) {
  if (a == null) return '';
  return [[1, 'R'], [2, 'H'], [4, 'S'], [16, 'D'], [32, 'A']].map(([b, c]) => (a & b ? c : '')).join('');
}

// >>> 0 makes a signed 32-bit CRC unsigned before hex formatting.
export const fmtCrc = (c) => (c == null ? '' : (c >>> 0).toString(16).toUpperCase().padStart(8, '0'));

// 1–8 alphanumeric characters after the last dot; longer "extensions" are names, not types.
const EXT = (name) => { const m = /\.([a-z0-9]{1,8})$/i.exec(name); return m ? m[1].toLowerCase() : ''; };
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', svg: 'image/svg+xml' };
const TEXT = new Set('txt md markdown csv tsv json jsonc json5 xml html htm xhtml css scss less js mjs cjs ts tsx jsx vue svelte py rb php java kt kts c h cc cpp hpp cs go rs swift m mm sh bash zsh fish ps1 psm1 bat cmd ini cfg conf toml yaml yml log sql gradle properties env gitignore gitattributes editorconfig dockerfile makefile mk cmake tex bib rst adoc org srt vtt sub nfo diz lua pl pm r jl scala clj ex exs erl hs ml fs fsx vb pas asm s d nim zig dart groovy tf hcl proto graphql gql rtf'.split(' '));
const AUDIO = new Set('mp3 wav ogg oga opus flac m4a aac wma aif aiff mid midi'.split(' '));
const VIDEO = new Set('mp4 m4v mkv webm avi mov wmv flv mpg mpeg 3gp ts'.split(' '));
const ARCHIVE = new Set('zip 7z rar tar gz tgz bz2 tbz xz txz lzma tlz z iso arc jar apk cab arj lzh zst 001'.split(' '));
const SHEET = new Set('xls xlsx ods numbers'.split(' '));
const DOC = new Set('doc docx odt pdf epub fb2 djvu pages'.split(' '));
const EXE = new Set('exe dll msi com sys so dylib bin elf app deb rpm'.split(' '));

export function kindOf(name) {
  const x = EXT(name);
  if (IMAGE[x]) return 'image';
  if (TEXT.has(x) || /^(readme|license|licence|copying|changelog|makefile|dockerfile|authors|notice|todo)$/i.test(name)) return 'text';
  if (AUDIO.has(x)) return 'audio';
  if (VIDEO.has(x)) return 'video';
  if (ARCHIVE.has(x)) return 'archive';
  if (SHEET.has(x)) return 'sheet';
  if (DOC.has(x)) return 'doc';
  if (EXE.has(x)) return 'exe';
  return 'file';
}

export const imageMime = (name) => IMAGE[EXT(name)] || '';

/** Looks like text: no NUL bytes and few control characters in the first 8 KiB. */
// Heuristic on the first 8 KiB: any NUL means binary (UTF-16 without BOM is accepted as binary here); otherwise allow up
// to 1% control characters other than tab/newline/CR/ESC.
export function looksText(b) {
  const n = Math.min(b.length, 8192);
  let bad = 0;
  for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0) return false; if (c < 9 || (c > 13 && c < 32 && c !== 27)) bad++; }
  return bad <= n / 100;
}

/** Text of preview bytes: UTF-8 (with or without BOM), UTF-16 with a BOM, otherwise Windows-1251 / 1252 by guess. */
// Order: BOM-marked UTF-16, strict UTF-8, strict UTF-8 minus a possibly cut tail (a preview is truncated at an
// arbitrary byte), then a legacy guess: if most high bytes are >= 0xC0 the text is likely Cyrillic in Windows-1251
// (Cyrillic letters live at 0xC0–0xFF there), otherwise Windows-1252.
export function decodePreview(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* not UTF-8 */ }
  // A cut multi-byte sequence at the end of a truncated preview is not a reason to give up UTF-8.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.max(0, b.length - 3))); } catch { /* legacy */ }
  let cyr = 0, high = 0;
  for (let i = 0; i < Math.min(b.length, 65536); i++) if (b[i] >= 0x80) { high++; if (b[i] >= 0xc0) cyr++; }
  return new TextDecoder(high && cyr / high > 0.7 ? 'windows-1251' : 'windows-1252').decode(b);
}

// Classic 16-byte rows: offset, hex padded to 47 chars (16×3−1) so the ASCII column stays aligned on the last short row.
export function hexDump(b, max = 4096) {
  const lines = [];
  for (let o = 0; o < Math.min(b.length, max); o += 16) {
    const row = b.subarray(o, Math.min(o + 16, b.length));
    const hex = Array.from(row, (x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const asc = Array.from(row, (x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('');
    lines.push(o.toString(16).padStart(8, '0') + '  ' + hex + '  ' + asc);
  }
  return lines.join('\n');
}
