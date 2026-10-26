// readme-editor/files.js - files of the editor: open / save / save as / download of the Markdown file (File System
// Access API where the browser has it, a file input and downloads elsewhere), a project folder (read-write through
// showDirectoryPicker, read-only through a folder input) whose images preview by their relative paths, images added
// to the document in this session, and saving an image into the folder.
//
// Capability ladder (feature-detected per call, never by user agent):
//   1. File System Access API (showOpenFilePicker / showSaveFilePicker / showDirectoryPicker, Chromium): real file
//      handles, Save overwrites in place, the folder is read-write so images can be saved next to the README.
//   2. Fallback (Firefox, Safari): <input type=file> to open, a download to save, <input webkitdirectory> for a
//      read-only folder snapshot (File objects keyed by relative path).
// State F: dir = directory handle (rung 1) | readOnly = Map(path to File) (rung 2); mem = images added this session
// (shown before they are saved anywhere); urls = blob URL cache per path; base = folder of the open file, so
// relative image paths resolve from the README's own location, as on GitHub.
// AbortError (user cancelled a picker) is a normal outcome and returns null/false; other errors propagate to the
// caller's toast.

import { pickFiles, downloadBlob } from '../ui/files.js';
import { h } from '../ui/dom.js';
import { S, load, markSaved } from './doc.js';

export const F = { dir: null, dirName: '', mdFiles: [], readOnly: new Map(), mem: new Map(), urls: new Map(), base: '' };
// '.txt' is accepted because READMEs are often exported or mailed as text; isMarkdownFile also falls back to the
// MIME type for files dragged from sources that drop the extension.
const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }];
export const isMarkdownFile = (f) => /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name) || f.type === 'text/markdown';
export const hasFolderAccess = () => typeof window.showDirectoryPicker === 'function';

// A path of the document, relative to the open file: './img/a.png', 'docs/x.png', '../logo.svg' -> folder path.
// Resolves a document-relative path against F.base into a folder-relative key: query/hash dropped, percent-escapes
// decoded (an image "my%20logo.png" is stored as "my logo.png"), '.' skipped, '..' popped. A path that climbs
// above the folder root returns null: the folder handle cannot reach it, and refusing is safer than clamping.
function folderPath(rel) {
  let p = String(rel).split(/[?#]/)[0];
  try { p = decodeURI(p); } catch { /* keep */ }
  const parts = (F.base ? F.base + '/' : '').concat(p.replace(/^\.\//, '')).split('/');
  const out = [];
  for (const x of parts) { if (!x || x === '.') continue; if (x === '..') { if (!out.length) return null; out.pop(); } else out.push(x); }
  return out.join('/');
}
// Relative = no scheme ("https:", "data:"), not protocol-relative ("//cdn"), not a fragment ("#top").
export const isRelative = (src) => !!src && !/^([a-z][\w+.-]*:|\/\/|#)/i.test(src);

// Blob URL of a relative image (session images, then the folder) or null.
// Lookup order: blob URL cache, session images, read-only snapshot, then the live directory handle (walking one
// getDirectoryHandle per segment). Blob URLs are cached per path because each createObjectURL allocates a new URL
// that pins the Blob in memory until revoked; repainting the preview must not leak one per paint.
export async function localURL(src) {
  const p = folderPath(src);
  if (p == null) return null;
  if (F.urls.has(p)) return F.urls.get(p);
  let blob = F.mem.get(p) || F.readOnly.get(p) || null;
  if (!blob && F.dir) {
    try {
      let d = F.dir;
      const parts = p.split('/');
      for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x);
      blob = await (await d.getFileHandle(parts[parts.length - 1])).getFile();
    } catch { blob = null; }
  }
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  F.urls.set(p, u);
  return u;
}
export const folderOpen = () => !!(F.dir || F.readOnly.size);
// A new session image invalidates the cached URL of that path, so the preview shows the new picture.
export function rememberImage(src, file) { const p = folderPath(src); if (p != null) { F.mem.set(p, file); F.urls.delete(p); } }

export async function saveIntoFolder(src, blob) {
  const p = folderPath(src);
  if (!F.dir || p == null) throw new Error('no folder');
  let d = F.dir;
  const parts = p.split('/');
  // { create: true } on directories and file: saving "img/new/logo.png" creates missing folders like `mkdir -p`.
  // createWritable writes to a swap file and commits on close(), so a crash mid-write leaves the old file intact.
  for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x, { create: true });
  const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
  await w.write(blob);
  await w.close();
}

export async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [hd] = await window.showOpenFilePicker({ types: MD_TYPES });
      const f = await hd.getFile();
      F.base = '';
      load(await f.text(), f.name, hd);
      return true;
    // Any non-abort failure of the native picker (e.g. a sandboxed iframe forbids it) falls through to the input.
    } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const [f] = await pickFiles({ accept: '.md,.markdown,.txt,text/markdown' });
  if (!f) return false;
  F.base = '';
  load(await f.text(), f.name, null);
  return true;
}
export async function openDropped(file) { F.base = ''; load(await file.text(), file.name, null); }

// Folder: read-write where the browser allows it, otherwise read-only (a folder input; saving downloads).
// Opening another folder revokes every cached blob URL first: they point into the previous folder's files.
export async function openFolder() {
  F.urls.forEach((u) => URL.revokeObjectURL(u));
  F.urls.clear();
  if (hasFolderAccess()) {
    try { F.dir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
    catch (e) { if (e.name === 'AbortError') return null; throw e; }
    F.dirName = F.dir.name;
    F.readOnly.clear();
    F.mdFiles = [];
    // The listing skips dot entries and node_modules and stops at depth 2: a README project rarely nests docs deeper,
    // and walking a large repository through async handles would take seconds.
    const walk = async (d, pre, depth) => {
      for await (const [n, hd] of d.entries()) {
        if (n.startsWith('.') || n === 'node_modules') continue;
        if (hd.kind === 'file' && /\.(md|markdown)$/i.test(n)) F.mdFiles.push(pre + n);
        else if (hd.kind === 'directory' && depth < 2) await walk(hd, pre + n + '/', depth + 1);
      }
    };
    await walk(F.dir, '', 0);
  } else {
    const files = await new Promise((resolve) => {
      // Hidden input appended to the DOM before click(): some browsers ignore click() on detached inputs. The 'cancel'
      // event (newer browsers) resolves the promise on dismissal; where it is unsupported the promise stays pending,
      // which is harmless (nothing awaits it except this dialog flow).
      const inp = h('input', { type: 'file', webkitdirectory: true, multiple: true, style: { display: 'none' } });
      inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
      inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
      document.body.append(inp);
      inp.click();
    });
    if (!files.length) return null;
    F.dir = null;
    F.readOnly.clear();
    // webkitRelativePath is "picked-folder/sub/file"; the first segment (the folder name) is stripped for the key.
    for (const f of files) F.readOnly.set(f.webkitRelativePath.split('/').slice(1).join('/'), f);
    F.dirName = files[0].webkitRelativePath.split('/')[0];
    F.mdFiles = [...F.readOnly.keys()].filter((p) => /\.(md|markdown)$/i.test(p));
  }
  // Sort: shallow first, README first within the same depth (boolean subtraction gives -1/0/1), then alphabetical.
  F.mdFiles.sort((a, b) => (a.split('/').length - b.split('/').length) || (/^readme/i.test(b.split('/').pop()) - /^readme/i.test(a.split('/').pop())) || a.localeCompare(b));
  return F.mdFiles;
}
export async function openFromFolder(path) {
  // { create: true }: the "+ new file" entry of the folder select opens a not-yet-existing file by name.
  F.base = path.split('/').slice(0, -1).join('/');
  if (F.dir) {
    let d = F.dir;
    const parts = path.split('/');
    for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x);
    const hd = await d.getFileHandle(parts[parts.length - 1], { create: true });
    load(await (await hd.getFile()).text(), parts[parts.length - 1], hd);
  } else {
    const f = F.readOnly.get(path);
    load(f ? await f.text() : '', path.split('/').pop(), null);
  }
}

export async function save({ as = false } = {}) {
  // Save: overwrite through the handle when there is one (no dialog), else ask for a location, else download.
  // createWritable is checked because handles restored from other contexts may be read-only.
  if (!as && S.handle && S.handle.createWritable) {
    const w = await S.handle.createWritable();
    await w.write(S.text);
    await w.close();
    markSaved();
    return 'saved';
  }
  if (window.showSaveFilePicker) {
    try {
      const hd = await window.showSaveFilePicker({ suggestedName: S.name, types: MD_TYPES });
      const w = await hd.createWritable();
      await w.write(S.text);
      await w.close();
      markSaved(hd.name, hd);
      return 'saved';
    } catch (e) { if (e.name === 'AbortError') return null; }
  }
  download();
  return 'downloaded';
}
// A download counts as saved: the user has a copy, so the dirty marker is cleared.
export function download() {
  downloadBlob(new Blob([S.text], { type: 'text/markdown;charset=utf-8' }), S.name || 'README.md');
  markSaved();
}
export const readDataURL = (file) => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(file); });
