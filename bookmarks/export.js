// bookmarks/export.js - a library (or a part of it) as files: the Netscape bookmark file browsers import (folders,
// TAGS, PRIVATE, TOREAD, descriptions), this application's lossless JSON backup, CSV and Markdown.
//
//   toNetscape(lib, { ids, title }) -> html      ids: only these bookmarks (with the folders that hold them)
//   toJSONBackup(lib, { ids }) -> json text       { format: 'in-html-bookmarks', version: 1, exported, folders, bookmarks }
//   toCSV(lib, { ids }) -> csv text               url, title, notes, tags, folder, created, modified, visited, unread,
//                                                 favorite, public, archived (formula injection guarded)
//   toMarkdown(lib, { ids, title }) -> markdown   "## Folder / Sub" headings, "- [title](url) — notes #tag" lines
//   exportName(format, date) -> 'bookmarks-2026-10-13.html'

import { serializeCSV } from '../csv/csv.js';

const escHTML = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const secs = (ms) => (ms ? String(Math.floor(ms / 1000)) : '');
const iso = (ms) => (ms ? new Date(ms).toISOString() : '');

// Bookmarks to export, in folder order: { folders: Set(ids needed), byFolder: Map(folderId -> [bookmarks]) }.
function selection(lib, ids) {
  const want = ids ? new Set(ids) : null;
  const t = lib.tree();
  const byFolder = new Map();
  const needed = new Set();
  for (const b of lib.bookmarks()) {
    if (want && !want.has(b.id)) continue;
    const f = lib.folderOf(b);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f).push(b);
    for (let x = f; x; x = t.parentOf(x)) needed.add(x);
  }
  if (!want) for (const f of lib.folders()) needed.add(f.id);
  for (const list of byFolder.values()) list.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  return { t, byFolder, needed };
}

// The Netscape bookmark file is the de facto interchange format every browser imports: tag-soup HTML with <DL><p>
// nesting, upper-case attribute names and seconds (not ms) for dates. Values are HTML-escaped; PRIVATE/TOREAD/TAGS
// are the attributes Pinboard and Delicious established, kept for round-trips with those services.
export function toNetscape(lib, { ids = null, title = 'Bookmarks' } = {}) {
  const { t, byFolder, needed } = selection(lib, ids);
  const out = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<TITLE>${escHTML(title)}</TITLE>`,
    `<H1>${escHTML(title)}</H1>`,
    '<DL><p>',
  ];
  const attr = (name, v) => (v === '' || v === undefined || v === null ? '' : ` ${name}="${escHTML(v)}"`);
  const writeFolder = (fid, depth) => {
    const pad = '    '.repeat(depth);
    for (const b of byFolder.get(fid) || []) {
      out.push(`${pad}<DT><A HREF="${escHTML(b.url)}"${attr('ADD_DATE', secs(b.created))}${attr('LAST_MODIFIED', secs(b.modified))}` +
        `${attr('LAST_VISIT', secs(b.visited))}${attr('TAGS', b.tags.join(','))}${attr('PRIVATE', b.public ? '0' : '1')}` +
        `${b.unread ? ' TOREAD="1"' : ''}${b.fav ? ' FAVORITE="1"' : ''}${b.archived ? ' ARCHIVED="1"' : ''}${attr('ICON', b.icon)}>${escHTML(b.title || b.url)}</A>`);
      if (b.notes) out.push(`${pad}<DD>${escHTML(b.notes)}`);
    }
    for (const f of t.children(fid)) {
      if (!needed.has(f.id)) continue;
      out.push(`${pad}<DT><H3${attr('ADD_DATE', secs(f.created))}>${escHTML(f.name)}</H3>`);
      out.push(`${pad}<DL><p>`);
      writeFolder(f.id, depth + 1);
      out.push(`${pad}</DL><p>`);
    }
  };
  writeFolder('', 1);
  out.push('</DL><p>');
  return out.join('\n') + '\n';
}

export function toJSONBackup(lib, { ids = null, now = Date.now() } = {}) {
  const { t, byFolder, needed } = selection(lib, ids);
  const folders = lib.folders().filter((f) => needed.has(f.id)).map((f) => ({ id: f.id, name: f.name, parent: t.parentOf(f.id), created: f.created }));
  const bookmarks = [];
  for (const list of byFolder.values()) {
    for (const b of list) {
      const o = { ...b };
      delete o.type; delete o.del;
      o.folder = lib.folderOf(b);
      bookmarks.push(o);
    }
  }
  bookmarks.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  return JSON.stringify({ format: 'in-html-bookmarks', version: 1, exported: new Date(now).toISOString(), folders, bookmarks }, null, 1);
}

// guard: true makes serializeCSV neutralize cells starting with = + - @ (CSV formula injection: a bookmark title
// like =HYPERLINK(...) would otherwise execute when the file is opened in a spreadsheet).
export function toCSV(lib, { ids = null } = {}) {
  const { t, byFolder } = selection(lib, ids);
  const rows = [['url', 'title', 'notes', 'tags', 'folder', 'created', 'modified', 'visited', 'unread', 'favorite', 'public', 'archived']];
  const order = ['', ...lib.folders().map((f) => f.id)];
  for (const fid of order) {
    for (const b of byFolder.get(fid) || []) {
      rows.push([b.url, b.title, b.notes, b.tags.join(', '), t.path(fid).join(' / '), iso(b.created), iso(b.modified), iso(b.visited),
        String(b.unread), String(b.fav), String(b.public), String(b.archived)]);
    }
  }
  return serializeCSV(rows, { guard: true });
}

// Markdown escaping of link text, and percent-encoding of characters that would end a link target early.
const mdEsc = (s) => String(s ?? '').replace(/([\\[\]*_`<>])/g, '\\$1');
const mdURL = (u) => String(u).replace(/[()\s<>]/g, (c) => encodeURIComponent(c));

export function toMarkdown(lib, { ids = null, title = 'Bookmarks' } = {}) {
  const { t, byFolder, needed } = selection(lib, ids);
  const out = [`# ${title}`, ''];
  const line = (b) => {
    const tags = b.tags.map((x) => '#' + x.replace(/\s+/g, '_')).join(' ');
    const notes = (b.notes || '').replace(/\s+/g, ' ').trim();
    return `- [${mdEsc(b.title || b.url)}](${mdURL(b.url)})${notes ? ' — ' + notes.replace(/(^|\s)#/g, '$1\\#') : ''}${tags ? ' ' + tags : ''}`;
  };
  const walk = (fid) => {
    const list = byFolder.get(fid) || [];
    if (fid && (list.length || t.children(fid).some((c) => needed.has(c.id)))) out.push(`## ${t.path(fid).join(' / ')}`, '');
    if (list.length) { for (const b of list) out.push(line(b)); out.push(''); }
    for (const f of t.children(fid)) if (needed.has(f.id)) walk(f.id);
  };
  walk('');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export const EXPORT_FORMATS = {
  html: { ext: 'html', type: 'text/html;charset=utf-8', fn: toNetscape },
  json: { ext: 'json', type: 'application/json', fn: toJSONBackup },
  csv: { ext: 'csv', type: 'text/csv;charset=utf-8', fn: toCSV },
  md: { ext: 'md', type: 'text/markdown;charset=utf-8', fn: toMarkdown },
};

export function exportName(format, date = new Date()) {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `bookmarks-${d}.${(EXPORT_FORMATS[format] || EXPORT_FORMATS.html).ext}`;
}
