// book/open.js - one entry point for book files: the format is recognised from the content (and the name as a
// hint), then the matching converter runs.
//
//   detectFormat(bytes, name) -> 'epub' | 'fb2' | 'fb2.zip' | 'zip' | 'html' | 'markdown' | 'text' | 'json'
//   readBook(bytes, name) -> Promise<{ book, format, encoding? }>   (.epub, .fb2, .fb2.zip / zipped FB2, .html,
//     .xhtml, .md, .txt, and the library's own JSON)
//   writeBook(book, format, opts) -> Promise<{ data: Uint8Array | string, ext, mime }>  format: 'epub' | 'epub2' |
//     'fb2' | 'fb2.zip' | 'markdown' | 'html' | 'text' | 'json'
//   ACCEPT: the <input accept> list of readable files

import { readZip, writeZip } from '../zip/zip.js';
import { b64decode, b64encode } from '../codec/base64.js';
import { decodeText } from './markup.js';
import { readFB2, writeFB2 } from './fb2.js';
import { readEpub, writeEpub } from './epub.js';
import { bookToHTML, htmlToBook } from './html.js';
import { bookCSS, stylesCSS } from './css.js';
import { bookToMarkdown, bookToText, markdownToBook, textToBook } from './text.js';
import { BOOK_FORMAT, normalizeBook } from './model.js';

//
// Detection order: content first, name second. File names lie (a .txt that is really FB2, an .epub renamed .zip),
// while magic bytes and root elements do not; the name breaks ties only where content is ambiguous (plain text vs
// Markdown, a generic ZIP).
export const ACCEPT = '.epub,.fb2,.zip,.fbz,.txt,.md,.markdown,.html,.htm,.xhtml,.json,application/epub+zip,text/plain,text/markdown,text/html';

// PK 3 4 (local file header) or PK 5 6 (end of central directory: an empty archive).
const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
const ascii = (b, n = 2048) => String.fromCharCode(...b.subarray(0, n));

export function detectFormat(bytes, name = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const lower = String(name).toLowerCase();
  // EPUB OCF requires an uncompressed first entry named "mimetype" containing "application/epub+zip", so the string
  // appears verbatim near offset 30; reading 120 bytes finds it without unzipping.
  if (isZip(b)) {
    if (ascii(b, 120).includes('mimetypeapplication/epub+zip') || lower.endsWith('.epub')) return 'epub';
    return lower.endsWith('.fb2.zip') || lower.endsWith('.fbz') ? 'fb2.zip' : 'zip';
  }
  // The BOM (U+FEFF) is stripped before testing root elements; only the first 4 KB is decoded, enough for any prolog.
  const head = decodeText(b.subarray(0, 4096)).text.replace(/^﻿/, '').trimStart();
  if (/<FictionBook[\s>]/.test(head)) return 'fb2';
  if (head.startsWith('{') && head.includes(`"${BOOK_FORMAT}"`)) return 'json';
  if (/^<!doctype html|^<html[\s>]|^<\?xml[^>]*\?>\s*(<!doctype html|<html)/i.test(head) || /\.(x?html?)$/.test(lower)) return 'html';
  if (/\.fb2$/.test(lower)) return 'fb2';
  if (/\.(md|markdown)$/.test(lower)) return 'markdown';
  if (/\.txt$/.test(lower)) return 'text';
  // Markdown when headings or front matter are present.
  if (/^---\n[\s\S]*?\n---\n|^#{1,3} \S/m.test(head.replace(/\r\n?/g, '\n'))) return 'markdown';
  return 'text';
}

const baseName = (name) => String(name || '').replace(/^.*[\\/]/, '').replace(/\.(fb2\.zip|fbz|epub|fb2|zip|txt|md|markdown|html?|xhtml|json)$/i, '');

export async function readBook(bytes, name = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const format = detectFormat(b, name);
  const title = baseName(name);
  switch (format) {
    case 'epub': return { book: await readEpub(b), format };
    case 'fb2': { const d = decodeText(b); return { book: readFB2(d.text), format, encoding: d.encoding }; }
    case 'fb2.zip': case 'zip': {
      // __MACOSX/ entries are Finder resource-fork junk (they even carry .fb2 names); ignoring them avoids opening a
      // binary AppleDouble file as the book. Preference: FB2, EPUB, Markdown, HTML, text.
      const entries = readZip(b).filter((e) => !e.dir && !/(^|\/)__MACOSX\//.test(e.name));
      const pick = entries.find((e) => /\.fb2$/i.test(e.name)) || entries.find((e) => /\.epub$/i.test(e.name))
        || entries.find((e) => /\.(md|markdown)$/i.test(e.name)) || entries.find((e) => /\.(x?html?)$/i.test(e.name)) || entries.find((e) => /\.txt$/i.test(e.name));
      if (!pick) throw new Error('the archive holds no book (FB2, EPUB, Markdown, HTML or text)');
      const r = await readBook(await pick.data(), pick.name);
      return { ...r, format: r.format === 'fb2' ? 'fb2.zip' : r.format };
    }
    case 'json': return { book: fromJSON(decodeText(b).text), format };
    case 'html': return { book: htmlToBook(decodeText(b, { html: true }).text, { name: title }), format };
    case 'markdown': return { book: markdownToBook(decodeText(b).text, { name: title }), format };
    default: { const d = decodeText(b); return { book: textToBook(d.text, { name: title }), format: 'text', encoding: d.encoding }; }
  }
}

// The library's own JSON (images as base64).
// Base64 for images: JSON has no binary type. ~33% size overhead is accepted for a self-contained single file.
export function toJSON(book) {
  const images = {};
  for (const [id, im] of Object.entries(book.images)) images[id] = { type: im.type, name: im.name, data: b64encode(im.data) };
  return JSON.stringify({ ...book, images });
}
export function fromJSON(text) {
  const raw = JSON.parse(text);
  if (!raw || raw.format !== BOOK_FORMAT) throw new Error('not a book JSON file');
  const images = {};
  for (const [id, im] of Object.entries(raw.images || {})) { try { images[id] = { ...im, data: b64decode(im.data) }; } catch { /* skip */ } }
  return normalizeBook({ ...raw, images });
}

export const FORMATS = {
  epub: { ext: 'epub', mime: 'application/epub+zip' },
  epub2: { ext: 'epub', mime: 'application/epub+zip' },
  fb2: { ext: 'fb2', mime: 'application/x-fictionbook+xml' },
  'fb2.zip': { ext: 'fb2.zip', mime: 'application/zip' },
  markdown: { ext: 'md', mime: 'text/markdown;charset=utf-8' },
  html: { ext: 'html', mime: 'text/html;charset=utf-8' },
  text: { ext: 'txt', mime: 'text/plain;charset=utf-8' },
  json: { ext: 'json', mime: 'application/json' },
};

// Serializes a book; opts.labels localizes generated headings (Contents, Notes, Cover…), opts.fileName names the
// FB2 inside a .fb2.zip.
// opts.now is threaded to the writers so output can be made byte-reproducible in tests (no wall-clock timestamps).
export async function writeBook(book, format, opts = {}) {
  const f = FORMATS[format];
  if (!f) throw new Error('unknown format ' + format);
  let data;
  switch (format) {
    case 'epub': data = await writeEpub(book, { version: 3, labels: opts.labels, now: opts.now }); break;
    case 'epub2': data = await writeEpub(book, { version: 2, labels: opts.labels, now: opts.now }); break;
    case 'fb2': data = writeFB2(book, { notesTitle: opts.labels?.notes, now: opts.now }); break;
    case 'fb2.zip': data = await writeZip([{ name: (opts.fileName || 'book') + '.fb2', data: writeFB2(book, { notesTitle: opts.labels?.notes, now: opts.now }) }]); break;
    case 'markdown': data = bookToMarkdown(book); break;
    case 'text': data = bookToText(book); break;
    case 'json': data = toJSON(book); break;
    // Standalone HTML export: the page shell CSS (centred 40em measure, serif, dark mode via prefers-color-scheme)
    // plus the book stylesheet scoped under .book; images are inlined as data: URIs so the file works offline alone.
    case 'html': {
      const css = 'body { margin: 0; background: #fbfaf7; color: #222; } .book { max-width: 40em; margin: 0 auto; padding: 2em 1.2em 4em; font: 1.1em/1.6 Georgia, "Times New Roman", serif; }\n'
        + '.book-head { text-align: center; margin-bottom: 3em; } .cover img { max-width: 100%; max-height: 80vh; } .toc ol { list-style: none; padding-left: 1.2em; } .toc a { color: inherit; }\n'
        + '@media (prefers-color-scheme: dark) { body { background: #16161a; color: #ddd; } a { color: #9cf; } }\n' + bookCSS({ scope: '.book' }) + stylesCSS(book.styles, { scope: '.book' });
      data = bookToHTML(book, { css, labels: opts.labels, imgSrc: (id) => (book.images[id] ? `data:${book.images[id].type};base64,${b64encode(book.images[id].data)}` : '') });
      break;
    }
    default: break;
  }
  return { data, ext: f.ext, mime: f.mime };
}
