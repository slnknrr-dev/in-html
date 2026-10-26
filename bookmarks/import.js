// bookmarks/import.js - bookmark files of browsers and services into one item shape, tolerant of real-world files.
//
//   parseImport(input, { name, format, mapping }) -> { format, items, folders, warnings, columns?, mapping?, rows? }
//     input     text, or bytes (Uint8Array / ArrayBuffer): BOM, UTF-8, the HTML meta charset, windows-1251 / 1252
//     name      file name (a hint for the format)
//     format    'auto' | one of FORMATS
//     mapping   CSV / JSON columns: { url, title, notes, tags, folder, created, modified, unread, fav, public, private,
//               archived } -> column name ('' = none); missing entries are guessed from the header
//   item = { url, title, notes, tags: [], folder: ['A', 'B'], created, modified, visited, unread, fav, public, icon,
//            archived }    (times in ms since 1970, 0 when unknown)
//   folders: every folder path met, also empty ones: [['A'], ['A', 'B']]
//
// FORMATS: netscape (the HTML every browser exports; also Pinboard, Pocket, Raindrop, linkding, Shaarli, Delicious,
// Instapaper HTML), chrome (Chrome / Edge / Brave "Bookmarks" profile JSON), firefox (Firefox JSON backup), pinboard
// (Pinboard JSON), own (this application's JSON backup), json (any array of objects with URLs, linkding API pages),
// csv (Raindrop, Instapaper, Pocket, generic, with column mapping), markdown ([title](url) lists under headings), urls
// (one URL per line, or URLs found in any text).
//   detectFormat(text, name) -> format;   decodeInput(input) -> { text, encoding };   guessMapping(header) -> mapping

import { decodeBytes } from '../csv/encoding.js';
import { parseCSV, sniffCSV } from '../csv/csv.js';
import { cleanTag } from './record.js';
import { findURLs, parseUserURL } from './url.js';

export const FORMATS = ['netscape', 'chrome', 'firefox', 'pinboard', 'own', 'json', 'csv', 'markdown', 'urls'];

// --- text --------------------------------------------------------------------------------------------------------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°', plusmn: '±', times: '×', divide: '÷', para: '¶',
  shy: '­', iexcl: '¡', iquest: '¿', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', ccedil: 'ç', ntilde: 'ñ', oacute: 'ó',
  iacute: 'í', uacute: 'ú', ocirc: 'ô', ucirc: 'û', icirc: 'î', aring: 'å', aelig: 'æ', oslash: 'ø', Eacute: 'É',
};
// Numeric references are decoded only to valid scalar values (no surrogates, <= U+10FFFF); unknown named entities
// stay literal. hasOwnProperty keeps "&constructor;" from resolving to an Object.prototype member.
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});?/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

const META_CHARSET = /<meta\b[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i;

// Encoding detection order: BOM / valid UTF-8 / UTF-16 (decodeBytes), then for anything else the charset an HTML
// file declares in its first 4 KB (old Netscape exports from Russian or Japanese systems), else the single-byte guess.
export function decodeInput(input) {
  if (typeof input === 'string') return { text: input.replace(/^﻿/, ''), encoding: 'text' };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const first = decodeBytes(bytes);
  // Not UTF-8: an HTML file names its charset (KOI8-R, Shift_JIS, …) better than a single-byte guess.
  if (first.encoding !== 'utf-8' && !/^utf-16/.test(first.encoding)) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
    const m = META_CHARSET.exec(head);
    if (m) {
      try { return { text: new TextDecoder(m[1].toLowerCase()).decode(bytes), encoding: m[1].toLowerCase() }; } catch { /* unknown label */ }
    }
  }
  return first;
}

// --- shared helpers ----------------------------------------------------------------------------------------------

// Seconds, milliseconds, microseconds or nanoseconds since 1970, an ISO / RFC date, or 0.
// Unit inference by magnitude: exporters use seconds (Netscape), ms (JS), us (Firefox) or ns. Present-day epoch
// times in each unit fall into disjoint decades (~1.7e9 s, 1.7e12 ms, 1.7e15 us, 1.7e18 ns), so thresholds at 1e11 /
// 1e14 / 1e17 classify them reliably.
export function toTime(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' || /^\s*\d+(\.\d+)?\s*$/.test(String(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n < 1e11) return Math.round(n * 1000);
    if (n < 1e14) return Math.round(n);
    if (n < 1e17) return Math.round(n / 1000);
    return Math.round(n / 1e6);
  }
  const t = Date.parse(String(v).trim());
  return Number.isFinite(t) && t > 0 ? t : 0;
}

const TRUE = /^(1|true|yes|y|on|x|✓|✔|starred|favou?rite)$/i;
export const toBool = (v) => (typeof v === 'boolean' ? v : TRUE.test(String(v ?? '').trim()));

export function splitTags(v, sep = null) {
  if (Array.isArray(v)) return uniqTags(v);
  const s = String(v ?? '').trim();
  if (!s) return [];
  if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return uniqTags(a.map(String)); } catch { /* text */ } }
  const parts = sep ? s.split(sep) : s.includes('|') ? s.split('|') : s.includes(',') ? s.split(',') : s.split(/\s+/);
  return uniqTags(parts);
}

function uniqTags(list) {
  const out = [], seen = new Set();
  for (const t of list) {
    const c = cleanTag(t);
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  }
  return out;
}

const item = (o) => ({
  url: '', title: '', notes: '', tags: [], folder: [], created: 0, modified: 0, visited: 0, unread: false, fav: false,
  public: false, icon: '', archived: false, ...o,
});

// Schemes that are not bookmarks of pages: Firefox smart folders, browser-internal pages, empty links.
const SKIP_URL = /^(place:|about:blank$|chrome:\/\/newtab|edge:\/\/newtab)/i;

function finish(format, items, folders, warnings, extra = {}) {
  const kept = [];
  let skipped = 0;
  for (const it of items) {
    const url = String(it.url || '').trim();
    if (!url || SKIP_URL.test(url)) { skipped++; continue; }
    it.url = url;
    it.title = String(it.title || '').replace(/\s+/g, ' ').trim();
    it.notes = String(it.notes || '').replace(/\r\n?/g, '\n').trim();
    kept.push(it);
  }
  if (skipped) warnings.push({ code: 'skipped', count: skipped });
  const seen = new Set();
  const paths = [];
  for (const p of folders) { const k = p.join('\u0000'); if (p.length && !seen.has(k)) { seen.add(k); paths.push(p); } }
  return { format, items: kept, folders: paths, warnings, ...extra };
}

// --- Netscape bookmark file ------------------------------------------------------------------------------------------

const TAG_RE = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s*[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)|</g;
const ATTR_RE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function attrsOf(s) {
  const out = {};
  for (const m of String(s || '').matchAll(ATTR_RE)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

// Streaming tag scanner instead of a DOM: Netscape files are tag soup (unclosed <DT>, <p> inside <DL>), and browsers'
// own exporters disagree. Folder structure comes from a stack of open <DL> elements, each remembering whether an <H3>
// opened it; the text of <A>, <H3> and <DD> is captured until the next tag that ends it. Broken nesting degrades
// to flatter structure, never to lost bookmarks.
export function parseNetscape(text) {
  const items = [], folders = [], warnings = [];
  const path = [];
  const dls = [];             // per open <DL>: did it open a folder?
  let pending = null;         // folder name from <H3>, waiting for its <DL>
  let capture = null;         // { kind: 'a' | 'h3' | 'h1' | 'dd', text, attrs, item }
  let last = null;            // last item (a <DD> describes it)
  let section = '';           // last <H1> text (Pocket: "Unread" / "Read Archive")
  let pocket = false;

  const flushPending = () => {
    // An <H3> without its <DL> (broken nesting): an empty folder at the current level.
    if (pending !== null) { folders.push([...path, pending]); pending = null; }
  };
  const endCapture = () => {
    if (!capture) return;
    const txt = decodeEntities(capture.text).replace(/\s+/g, ' ').trim();
    if (capture.kind === 'a') capture.item.title = txt;
    else if (capture.kind === 'h3') { flushPending(); pending = txt || 'Folder'; }
    else if (capture.kind === 'h1') section = txt;
    else if (capture.kind === 'dd' && capture.item) {
      const note = decodeEntities(capture.text.replace(/<br\s*\/?>/gi, '\n')).replace(/[ \t]+/g, ' ').replace(/\n /g, '\n').trim();
      if (note) capture.item.notes = capture.item.notes ? capture.item.notes + '\n' + note : note;
    }
    capture = null;
  };

  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text))) {
    if (m[0].startsWith('<!--')) continue;
    const textPart = m[4] ?? (m[2] ? null : m[0]);
    if (textPart !== null && textPart !== undefined) { if (capture) capture.text += textPart; continue; }
    const close = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (capture && capture.kind === 'dd' && ['dt', 'dl', 'h3', 'a', 'dd', 'p', 'hr', 'li', 'ul', 'h1'].includes(tag) && !(tag === 'p' && !close && !capture.text.trim())) endCapture();
    if (capture && capture.kind === 'dd' && tag === 'br') { capture.text += '\n'; continue; }
    if (capture && capture.kind !== 'dd' && close && tag === capture.kind) { endCapture(); continue; }
    if (capture && capture.kind !== 'dd' && !close && (tag === 'dt' || tag === 'dl' || tag === 'h3' || tag === 'a' || tag === 'dd')) endCapture();
    if (close) {
      if (tag === 'dl') {
        flushPending();
        const opened = dls.pop();
        if (opened) path.pop();
      }
      continue;
    }
    if (tag === 'dl') {
      if (pending !== null) { path.push(pending); folders.push([...path]); pending = null; dls.push(true); } else dls.push(false);
    } else if (tag === 'h3') {
      flushPending();
      capture = { kind: 'h3', text: '' };
    } else if (tag === 'h1') {
      capture = { kind: 'h1', text: '' };
    } else if (tag === 'a') {
      flushPending();
      const a = attrsOf(m[3]);
      if (!a.href) { capture = null; continue; }
      if (a.time_added !== undefined) pocket = true;
      const it = item({
        url: a.href, folder: [...path], created: toTime(a.add_date ?? a.time_added), modified: toTime(a.last_modified),
        visited: toTime(a.last_visit), tags: splitTags(a.tags || '', ','), unread: toBool(a.toread),
        fav: toBool(a.favorite), archived: toBool(a.archived),
        public: a.private !== undefined ? !toBool(a.private) : a.shared !== undefined ? toBool(a.shared) : false,
        icon: /^data:image\//i.test(a.icon || '') ? a.icon.replace(/\s+/g, '') : '',
      });
      if (pocket) {
        if (/unread/i.test(section)) it.unread = true;
        else if (/archive|read/i.test(section)) it.archived = true;
      }
      items.push(it);
      last = it;
      capture = { kind: 'a', text: '', item: it };
    } else if (tag === 'dd') {
      capture = { kind: 'dd', text: '', item: last };
    } else if (tag === 'dt' || tag === 'li') {
      last = tag === 'dt' ? null : last;
    }
  }
  endCapture();
  flushPending();
  return finish('netscape', items, folders, warnings);
}

// --- browser JSON --------------------------------------------------------------------------------------------------

// Chrome / Edge: microseconds since 1601-01-01.
// Chrome stores microseconds since 1601-01-01 (Windows FILETIME epoch); 11644473600000 ms is 1601 -> 1970.
const webkitTime = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n / 1000 - 11644473600000) : 0; };

export function parseChrome(data) {
  const items = [], folders = [];
  const ROOT_NAMES = { bookmark_bar: 'Bookmarks bar', other: 'Other bookmarks', synced: 'Mobile bookmarks' };
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'url') {
      items.push(item({ url: node.url, title: node.name, folder: path, created: webkitTime(node.date_added), visited: webkitTime(node.date_last_used), modified: webkitTime(node.date_modified) }));
    } else if (Array.isArray(node.children)) {
      if (path.length) folders.push(path);
      for (const c of node.children) walk(c, c && c.type === 'folder' ? [...path, String(c.name || 'Folder')] : path);
    }
  };
  for (const [key, root] of Object.entries(data.roots || {})) {
    if (!root || typeof root !== 'object' || !Array.isArray(root.children)) continue;
    walk(root, [String(root.name || ROOT_NAMES[key] || key)]);
  }
  return finish('chrome', items, folders, []);
}

export function parseFirefox(data) {
  const items = [], folders = [];
  const ROOTS = { bookmarksMenuFolder: 'Bookmarks Menu', toolbarFolder: 'Bookmarks Toolbar', unfiledBookmarksFolder: 'Other Bookmarks', mobileFolder: 'Mobile Bookmarks' };
  const walk = (node, path, top) => {
    if (!node || typeof node !== 'object') return;
    const type = node.type || ({ 1: 'text/x-moz-place', 2: 'text/x-moz-place-container', 3: 'text/x-moz-place-separator' })[node.typeCode];
    if (type === 'text/x-moz-place') {
      const notes = Array.isArray(node.annos) ? (node.annos.find((a) => a && a.name === 'bookmarkProperties/description') || {}).value || '' : '';
      items.push(item({
        url: node.uri, title: node.title, folder: path, created: toTime(node.dateAdded), modified: toTime(node.lastModified),
        tags: splitTags(node.tags || '', ','), notes,
      }));
    } else if (type === 'text/x-moz-place-container' || Array.isArray(node.children)) {
      let next = path;
      if (!top) {
        const name = ROOTS[node.root] || node.title || 'Folder';
        next = [...path, String(name)];
        folders.push(next);
      }
      for (const c of node.children || []) walk(c, next, false);
    }
  };
  walk(data, [], data.root === 'placesRoot' || data.guid === 'root________');
  return finish('firefox', items, folders, []);
}

export function parsePinboard(list) {
  const items = list.filter((x) => x && typeof x === 'object').map((x) => item({
    url: x.href, title: x.description, notes: x.extended, tags: splitTags(x.tags || '', /\s+/), created: toTime(x.time),
    public: x.shared === undefined ? false : x.shared === true || x.shared === 'yes', unread: x.toread === true || x.toread === 'yes',
  }));
  return finish('pinboard', items, [], []);
}

// --- columns (CSV and JSON objects) ------------------------------------------------------------------------------------

const SYNONYMS = {
  url: ['url', 'link', 'href', 'uri', 'address', 'website', 'web address', 'page'],
  title: ['title', 'name', 'page title'],
  notes: ['notes', 'note', 'description', 'excerpt', 'extended', 'comment', 'comments', 'selection', 'summary', 'annotation', 'highlights'],
  tags: ['tags', 'tag', 'tag_names', 'labels', 'label', 'keywords', 'categories'],
  folder: ['folder', 'collection', 'path', 'category', 'list', 'group', 'directory'],
  created: ['created', 'created_at', 'date_added', 'time_added', 'added', 'add_date', 'date', 'timestamp', 'time', 'saved', 'saved_at', 'createdat'],
  modified: ['modified', 'updated', 'updated_at', 'last_modified', 'date_modified', 'lastmodified'],
  unread: ['unread', 'toread', 'to_read', 'read_later', 'status'],
  fav: ['favorite', 'favourite', 'starred', 'star', 'fav', 'is_favorite'],
  public: ['public', 'shared', 'is_public'],
  private: ['private', 'is_private'],
  archived: ['archived', 'is_archived', 'archive'],
};
export const MAPPING_FIELDS = Object.keys(SYNONYMS);

const normCol = (s) => String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export function guessMapping(header) {
  const cols = header.map(normCol);
  const used = new Set();
  const map = {};
  for (const field of MAPPING_FIELDS) {
    for (const syn of SYNONYMS[field]) {
      const i = cols.findIndex((c, j) => !used.has(j) && (c === syn || c === syn.replace(/\s+/g, '_')));
      if (i >= 0) { map[field] = header[i]; used.add(i); break; }
    }
    if (!map[field]) map[field] = '';
  }
  return map;
}

// One object (CSV row by header, JSON object) through a mapping into an item.
function fromObject(o, map) {
  const get = (f) => (map[f] ? o[map[f]] : undefined);
  const it = item({
    url: String(get('url') ?? '').trim(), title: String(get('title') ?? ''), notes: String(get('notes') ?? ''),
    tags: splitTags(get('tags')), created: toTime(get('created')), modified: toTime(get('modified')),
    fav: toBool(get('fav')), archived: toBool(get('archived')),
  });
  const pub = get('public'), priv = get('private');
  if (pub !== undefined && pub !== '') it.public = toBool(pub);
  else if (priv !== undefined && priv !== '') it.public = !toBool(priv);
  const status = get('unread');
  if (status !== undefined) {
    const s = String(status).trim().toLowerCase();
    if (s === 'unread' || s === 'to-read') it.unread = true;
    else if (s === 'archive' || s === 'archived' || s === 'read') { it.unread = false; if (s !== 'read') it.archived = true; }
    else it.unread = toBool(s);
  }
  const folder = get('folder');
  if (folder !== undefined && String(folder).trim()) {
    const f = String(folder).trim();
    // Instapaper keeps the reading state in its Folder column.
    if (/^unread$/i.test(f)) it.unread = true;
    else if (/^archive$/i.test(f)) it.archived = true;
    else if (/^starred$/i.test(f)) it.fav = true;
    else if (!/^unsorted$/i.test(f)) it.folder = f.split(/\s+[/›>]\s+/).map((x) => x.trim()).filter(Boolean);
  }
  if (!parseUserURL(it.url)) {
    const found = findURLs(it.url);
    it.url = found[0] || '';
  }
  return it;
}

export function parseCSVText(text, { mapping } = {}) {
  const sn = sniffCSV(text);
  const rows = parseCSV(text, { delimiter: sn.delimiter || ',', quote: sn.quote ?? '"' }).filter((r) => r.some((c) => String(c).trim()));
  if (!rows.length) return finish('csv', [], [], [], { columns: [], mapping: {}, rows: [] });
  const guessed = guessMapping(rows[0]);
  const hasHeader = !!guessed.url || MAPPING_FIELDS.filter((f) => guessed[f]).length >= 2;
  let header, body;
  if (hasHeader) { header = rows[0].map((c, i) => String(c).trim() || `#${i + 1}`); body = rows.slice(1); }
  else {
    header = rows[0].map((c, i) => `#${i + 1}`);
    body = rows;
    // Without a header: the first column holding URLs is the URL, the next text column the title.
    const ui = rows[0].findIndex((c) => parseUserURL(c));
    if (ui >= 0) { guessed.url = header[ui]; const ti = rows[0].findIndex((c, i) => i !== ui && String(c).trim()); guessed.title = ti >= 0 ? header[ti] : ''; }
  }
  const map = { ...guessed, ...(mapping || {}) };
  const objects = body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  const items = objects.map((o) => fromObject(o, map));
  return finish('csv', items, items.map((i) => i.folder), [], { columns: header, mapping: map, rows: body.slice(0, 50) });
}

function parseJSONObjects(list, mapping) {
  const objs = list.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
  const keys = [...new Set(objs.slice(0, 50).flatMap((o) => Object.keys(o)))];
  const map = { ...guessMapping(keys), ...(mapping || {}) };
  // linkding: unread / is_archived booleans, tag_names arrays; notes and description both exist.
  const items = objs.map((o) => {
    const it = fromObject(o, map);
    if (o.description && o.notes && map.notes === 'notes') it.notes = [o.description, o.notes].filter(Boolean).join('\n\n');
    return it;
  });
  return finish('json', items, items.map((i) => i.folder), [], { columns: keys, mapping: map });
}

// --- Markdown and plain text -------------------------------------------------------------------------------------------

const MD_LINK = /\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g;

export function parseMarkdown(text) {
  const items = [], folders = [];
  let path = [];
  const stack = []; // open headings: { level, names } ("## A / B" opens two folders at once)
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      const level = h[1].length, name = h[2].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (level > 1) stack.push({ level, names: name.includes(' / ') ? name.split(' / ').map((s) => s.trim()).filter(Boolean) : [name] });
      else stack.length = 0;
      path = stack.flatMap((x) => x.names);
      for (let i = 1; i <= path.length; i++) folders.push(path.slice(0, i));
      continue;
    }
    const body = line.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
    const links = [...body.matchAll(MD_LINK)];
    if (links.length) {
      for (let i = 0; i < links.length; i++) {
        const m = links[i];
        const url = m[2];
        if (!parseUserURL(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url)) continue;
        // Text after the link (up to the next link): " — notes #tag #tag".
        let rest = links.length === 1 ? body.slice(m.index + m[0].length) : '';
        const tags = [];
        rest = rest.replace(/(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_.:/+-]*)/gu, (x, sp, t) => { tags.push(t.replace(/_/g, ' ')); return ' '; });
        rest = rest.replace(/^\s*[—–:-]\s*/, '').replace(/\s+/g, ' ').trim();
        items.push(item({ url, title: m[1].replace(/\\(.)/g, '$1'), notes: rest || m[3] || '', tags: splitTags(tags, ','), folder: [...path] }));
      }
      continue;
    }
    for (const url of findURLs(body)) items.push(item({ url, folder: [...path] }));
  }
  return finish('markdown', items, folders, []);
}

export function parseURLList(text) {
  const items = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const direct = /\s/.test(line) ? null : parseUserURL(line);
    if (direct) { items.push(item({ url: direct })); continue; }
    const found = findURLs(line);
    if (found.length === 1) {
      // "Title https://…" or "https://… Title": the rest of the line is the title.
      const title = line.replace(/\b(?:(?:https?|ftp):\/\/|www\.)\S+/i, ' ').replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, '').replace(/\s+/g, ' ');
      items.push(item({ url: found[0], title }));
    } else for (const url of found) items.push(item({ url }));
  }
  return finish('urls', items, [], []);
}

// --- detection and entry point -------------------------------------------------------------------------------------------

function jsonKind(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.format === 'in-html-bookmarks') return 'own';
    if (data.roots && typeof data.roots === 'object') return 'chrome';
    if (data.type === 'text/x-moz-place-container' || data.root === 'placesRoot' || data.guid === 'root________') return 'firefox';
    if (Array.isArray(data.results) || Array.isArray(data.bookmarks) || Array.isArray(data.items) || Array.isArray(data.data)) return 'json';
  }
  if (Array.isArray(data)) {
    const first = data.find((x) => x && typeof x === 'object');
    if (first && 'href' in first && ('description' in first || 'extended' in first || 'hash' in first)) return 'pinboard';
    return 'json';
  }
  return null;
}

export function detectFormat(text, name = '') {
  const head = String(text).slice(0, 4096);
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase() || '';
  if (/<!DOCTYPE\s+NETSCAPE-Bookmark-file/i.test(head) || /<DT>\s*<(A|H3)\b/i.test(head) || ((ext === 'html' || ext === 'htm') && /<a\s[^>]*href/i.test(text))) return 'netscape';
  const trimmed = head.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { const k = jsonKind(JSON.parse(text)); if (k) return k; } catch { /* not JSON */ }
  }
  if (/<a\s[^>]*href\s*=/i.test(head) && /<\/a>/i.test(head)) return 'netscape';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'md' || ext === 'markdown' || /\]\(\s*(?:https?|ftp):\/\//i.test(head)) return 'markdown';
  const firstLine = head.split(/\r?\n/)[0] || '';
  if (/[,;\t]/.test(firstLine) && /\b(url|link|href)\b/i.test(firstLine)) return 'csv';
  return 'urls';
}

export function parseImport(input, { name = '', format = 'auto', mapping = null } = {}) {
  const { text, encoding } = decodeInput(input);
  const fmt = format && format !== 'auto' ? format : detectFormat(text, name);
  let r;
  try {
    switch (fmt) {
      case 'netscape': r = parseNetscape(text); break;
      case 'chrome': r = parseChrome(JSON.parse(text)); break;
      case 'firefox': r = parseFirefox(JSON.parse(text)); break;
      case 'pinboard': r = parsePinboard(JSON.parse(text)); break;
      case 'own': {
        const data = JSON.parse(text);
        r = { format: 'own', items: [], folders: [], warnings: [], backup: data, count: Array.isArray(data.bookmarks) ? data.bookmarks.length : 0 };
        break;
      }
      case 'json': {
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : data.results || data.bookmarks || data.items || data.data || [];
        r = parseJSONObjects(list, mapping);
        break;
      }
      case 'csv': r = parseCSVText(text, { mapping }); break;
      case 'markdown': r = parseMarkdown(text); break;
      default: r = parseURLList(text); break;
    }
  } catch (e) {
    r = { format: fmt, items: [], folders: [], warnings: [{ code: 'error', message: String(e && e.message || e) }] };
  }
  r.encoding = encoding;
  return r;
}
