// book-processor/io.js - files in and out: importing book files into the library (format detection by the
// book/ library, thumbnails, duplicate detection), exports in every format with labels in the book's language,
// images as blob URLs, generated covers (SVG, rasterized on a canvas), file names.
import { readBook, writeBook, FORMATS } from '../book/open.js';
import { coverSVG, COVER_DESIGNS, COVER_PALETTES } from '../book/cover.js';
import { bookStats, personName } from '../book/model.js';
import { download } from '../ui/app.js';
import { safeFileName } from '../ui/files.js';
import { ED_I18N, t } from '../ui/i18n.js';
import { primary } from '../i18n/lang.js';
import { uid } from '../util/id.js';
import { db } from './db.js';
import { authorsText } from './state.js';

// Headings the exporters write into the book (Contents, Notes, Cover…) in the book's own language.
// Generated headings follow the book's language, not the UI's: a Russian book exported from an English UI must say
// "Содержание". Falls back per key to English, so a partial dictionary still yields a complete book.
export function genLabels(lang) {
  const d = ED_I18N[primary(lang)] || {};
  const en = ED_I18N.en;
  const g = (k) => d['gen.' + k] || en['gen.' + k];
  return { contents: g('contents'), notes: g('notes'), cover: g('cover'), start: g('start'), untitled: '…', title: g('title') };
}

export function fileBase(book) {
  const a = book.meta.authors[0];
  const who = a ? (a.last || personName(a)) : '';
  return safeFileName([who, book.meta.title].filter(Boolean).join(' - ') || 'book', 'book');
}

// A deterministic generated cover look for books without a cover image.
// Deterministic: a 31-multiplier string hash (>>> 0 keeps it an unsigned 32-bit integer) picks design and palette,
// so a coverless book gets the same cover on every device and every render, with no stored state. Different bits
// (h and h >>> 8) choose design and palette so they do not move in lockstep.
export function autoDesign(title) {
  let h = 0;
  for (const ch of String(title || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const designs = COVER_DESIGNS, palettes = Object.keys(COVER_PALETTES);
  return { design: designs[h % designs.length], palette: palettes[(h >>> 8) % palettes.length] };
}

export function coverSVGFor(book, design) {
  const m = book.meta;
  const d = design || m.coverDesign || autoDesign(m.title);
  const series = m.series[0] ? m.series[0].name + (m.series[0].number ? ' · ' + m.series[0].number : '') : '';
  return coverSVG({ title: m.title || t('bk.untitled'), subtitle: m.subtitle, author: authorsText(book), series, design: d.design, palette: d.palette, width: 600, height: 900 });
}
export const svgURL = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

// Draws an image source (SVG text or image bytes) on a canvas and returns JPEG / PNG bytes.
// Rasterisation through <img> + canvas: the browser's own SVG and image decoders, no library. img.decode() awaits
// full decoding (onload can fire before decoding is done). A white fill first, because JPEG has no alpha and
// transparent pixels would turn black. fit 'cover' crops to fill, 'contain' letterboxes.
export async function raster(src, { width, height, type = 'image/jpeg', quality = 0.9, fit = 'cover' } = {}) {
  const blob = typeof src === 'string' ? new Blob([src], { type: 'image/svg+xml' }) : new Blob([src.data], { type: src.type });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const iw = img.naturalWidth || width, ih = img.naturalHeight || height;
    const w = width || iw, h = height || Math.round(w * ih / iw);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    const s = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    g.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    const out = await new Promise((r) => c.toBlob(r, type, quality));
    return out ? new Uint8Array(await out.arrayBuffer()) : null;
  } finally { URL.revokeObjectURL(url); }
}

// Small JPEG of the cover for the shelf (null without a cover image).
// 240x360 JPEG at q 0.82: a few KB per shelf record; the grid never decodes full-size covers.
export async function makeThumb(book) {
  const im = book.meta.cover && book.images[book.meta.cover];
  if (!im) return null;
  try {
    const bytes = await raster(im, { width: 240, height: 360, quality: 0.82 });
    return bytes ? new Blob([bytes], { type: 'image/jpeg' }) : null;
  } catch { return null; }
}

export function shelfRecord(book, extra = {}) {
  const st = bookStats(book);
  const m = book.meta;
  return {
    title: m.title || t('bk.untitled'), authors: authorsText(book), lang: m.lang, words: st.words,
    series: m.series[0] ? m.series[0].name + (m.series[0].number ? ' #' + m.series[0].number : '') : '',
    added: new Date().toISOString(), opened: '', progress: 0, pos: null, uid: (m.ids[0] || {}).value || '',
    cover: m.cover ? null : (m.coverDesign || autoDesign(m.title)),
    ...extra,
  };
}

// Adds files to the library; returns [{ id, title, duplicate }] (errors are reported per file through onError).
export async function importFiles(files, { onError, onProgress } = {}) {
  const out = [];
  const shelf = await db.shelf();
  let i = 0;
  for (const file of files) {
    onProgress?.(i++, files.length, file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { book, format } = await readBook(bytes, file.name);
      // Duplicate = same book id AND same byte size AND same title: the id alone is unreliable (many FB2 tools reuse ids
      // or leave defaults), size alone collides by chance; together they catch re-imports without false merges.
      const dup = shelf.find((r) => r.uid && r.uid === (book.meta.ids[0] || {}).value && r.size === bytes.length && r.title === book.meta.title);
      if (dup) { out.push({ id: dup.id, title: dup.title, duplicate: true }); continue; }
      const id = 'b-' + uid();
      const rec = shelfRecord(book, { id, format, fileName: file.name, size: bytes.length });
      rec.thumb = await makeThumb(book);
      // Content is written before the shelf record: if the second write fails, an orphan content record is invisible,
      // whereas a shelf record without content would show a book that cannot open.
      await db.putContent({ id, book, original: bytes, originalName: file.name });
      await db.putShelf(rec);
      shelf.push(rec);
      out.push({ id, title: rec.title, duplicate: false });
    } catch (e) {
      console.error(e);
      onError?.(file.name, e);
    }
  }
  return out;
}

// Adds (or replaces) a book model in the library; returns the shelf id.
export async function saveToLibrary(book, { id, format = 'writer', fileName } = {}) {
  const old = id ? await db.getShelf(id) : null;
  const newId = old ? old.id : 'b-' + uid();
  const rec = shelfRecord(book, { id: newId, format, fileName: fileName || fileBase(book) + '.epub', size: 0 });
  if (old) Object.assign(rec, { added: old.added, opened: old.opened, progress: old.progress, pos: old.pos });
  rec.thumb = await makeThumb(book);
  await db.putContent({ id: newId, book, original: null, originalName: '' });
  await db.putShelf(rec);
  return newId;
}

export const EXPORTS = [
  ['epub', 'EPUB 3'], ['epub2', 'EPUB 2'], ['fb2', 'FB2'], ['fb2.zip', 'FB2 (zip)'],
  ['markdown', 'Markdown'], ['html', 'HTML'], ['text', 'Text'], ['json', 'JSON'],
];

export async function exportBook(book, format, base = fileBase(book)) {
  const w = await writeBook(book, format, { labels: genLabels(book.meta.lang), fileName: base });
  const ext = FORMATS[format].ext;
  download(w.data, `${base}.${ext}`, w.mime);
  return w;
}

// Blob URLs of a book's images (revoke() when the book is closed).
// Blob URLs are created lazily per image and revoked together when the book closes; data: URLs would inflate every
// image by a third and stay in the DOM as huge strings.
export function imageURLs(book) {
  const urls = new Map();
  return {
    url(id) {
      if (urls.has(id)) return urls.get(id);
      const im = book.images[id];
      if (!im) return '';
      const u = URL.createObjectURL(new Blob([im.data], { type: im.type }));
      urls.set(id, u);
      return u;
    },
    drop(id) { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } },
    revoke() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); },
  };
}
