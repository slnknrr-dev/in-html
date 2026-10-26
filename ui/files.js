// ui/files.js - files: pickFiles, readFileB64, downloadBlob, MIME guessing, size formatting, safe file names.
// Everything here is local: no network, no server — files are read with FileReader and saved via blob: URLs.
import { h } from './dom.js';

// Binary units (1024) labelled KB/MB as users expect. One decimal below 10 KB, where it carries information.
function fmtBytes(n) {
  n = +n || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// Download name from a document title. NFKC first folds look-alike/full-width forms so the character filter below
// sees canonical characters. Removes characters forbidden on Windows (the strictest target) and control chars.
// KNOWN DEFECT: unlike safeAttName below, Windows device names (CON, NUL, …) and trailing dots are not handled; a
// title "con" downloads as "con.ext", which Windows refuses. Fix: reuse safeAttName's two extra rules.
function safeFileName(name, fallback = 'document') {
  const s = String(name || '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (s || fallback).slice(0, 80);
}

// '.pdf' from 'cv.pdf' ('' when none; a leading dot alone is not an extension).
const fileExt = (name) => (/[^./\\](\.[a-z0-9]{1,8})$/i.exec(String(name || '')) || ['', ''])[1];
// Attachment file name: the export offers it for download, so no path separators, control or reserved characters,
// no Windows device names or trailing dots; the original extension is kept (appended when the new name lacks it).
function safeAttName(input, orig) {
  const ext = fileExt(orig);
  let s = String(input || '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (ext && s.toLowerCase().endsWith(ext.toLowerCase())) s = s.slice(0, -ext.length).replace(/[.\s]+$/, '');
  if (!s) return null;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(s)) s = '_' + s;
  return s.slice(0, 120) + ext;
}

// Save via a temporary <a download href=blob:>. Must be attached for Firefox to honour the click. The object URL is
// revoked later, not immediately: revoking synchronously can cancel the download before the browser starts reading
// the blob (seen in Safari/Firefox); 30 s is generous, and the URL holds the blob in memory until then.
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Base64 of a File (for embedding attachments in JSON documents). readAsDataURL then strip "data:<mime>;base64,":
// the browser does the encoding natively; btoa over a binary string would need manual chunking for large files.
function readFileB64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : '');
    };
    fr.onerror = () => reject(fr.error || new Error('read error'));
    fr.readAsDataURL(file);
  });
}

// Fallback MIME table, used only when the browser gave no File.type (often empty for fonts, markdown, docx on some
// OSes). The browser's own type always wins (guessMime returns it first).
const EXT_MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', txt: 'text/plain', html: 'text/html', htm: 'text/html', json: 'application/json',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', zip: 'application/zip', csv: 'text/csv', md: 'text/markdown',
};
function guessMime(name, type) {
  if (type) return type;
  const ext = String(name).split('.').pop().toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}
const isImageMime = (m) => /^image\//.test(m || '');
const isFontMime = (m, name = '') => /^font\//.test(m || '') || /\.(woff2?|ttf|otf)$/i.test(name);

// Opens the native file chooser from code; resolves File[] (empty on cancel), never rejects. The hidden input is
// attached because some engines ignore click() on detached inputs. `cancel` exists only in newer engines; where it
// is missing a cancelled dialog leaves the promise pending and the input in the DOM until the next pick — harmless
// for callers that just await a choice, but a known leak. `done` guards against change+cancel both firing.
// Must be called from a user gesture (click handler), or the browser blocks the dialog.
function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    let done = false;
    const finish = (files) => { if (done) return; done = true; inp.remove(); resolve(files); };
    inp.addEventListener('change', () => finish(Array.from(inp.files || [])));
    inp.addEventListener('cancel', () => finish([]));
    document.body.append(inp);
    inp.click();
  });
}

export {
  downloadBlob,
  fileExt,
  fmtBytes,
  guessMime,
  isFontMime,
  isImageMime,
  pickFiles,
  readFileB64,
  safeAttName,
  safeFileName
};
