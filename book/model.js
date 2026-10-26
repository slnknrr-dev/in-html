// book/model.js - the format-neutral book model shared by every reader, writer and converter (FB2 and EPUB are only
// read and written at the edges). Plain JSON-like data (images are Uint8Arrays), safe to structured-clone into
// IndexedDB.
//
// book = {
//   format: 'in-html-book', version: 1,
//   meta: { title, subtitle, authors: [person], translators: [person], lang, srcLang, series: [{ name, number }],
//           annotation: [block], keywords, genres: [fb2 code], subjects: [text], date, year, publisher, city, isbn,
//           ids: [{ scheme, value }], rights, cover: imageId, coverDesign, created, modified, docVersion,
//           docAuthors: [person], program, srcUrl, srcOcr },
//   styles: [{ id, name, kind: 'block' | 'inline', props: { font, size, bold, italic, smallCaps, align, indent,
//              spaceBefore, spaceAfter, color } }],
//   images: { id: { type, data: Uint8Array, name } },
//   title: [inline] lines | null       body title (an FB2 body may open with one; usually author and title)
//   front: [block]                     epigraphs and images before the first section
//   sections: [section],
//   notes: [{ id, kind: 'note' | 'comment', label: [inline], blocks: [block] }],
// }
// person  = { first, middle, last, nick }
// section = { id, title: [lines] | null, blocks: [block], sections: [section] }      (blocks first, then subsections)
// block   = { type: 'p', c: inline, style?, id? }    { type: 'subtitle', c }          { type: 'empty' }
//           { type: 'hr' } (scene break)              { type: 'code', text }           { type: 'image', src, alt, title: inline }
//           { type: 'epigraph' | 'cite', blocks, authors: [inline] }
//           { type: 'poem', title: lines | null, epigraphs: [block], stanzas: [{ title: lines | null, subtitle: inline, lines: [inline] }],
//             authors: [inline], date }
//           { type: 'table', rows: [{ cells: [{ c: inline, header, colspan, rowspan, align }] }] }
//           { type: 'list', ordered, items: [[block]] }
//           every block may carry `id` (link target)
// inline  = [string | { t: 'em' | 'strong' | 'strike' | 'sub' | 'sup' | 'code', c } | { t: 'a', href, c }
//           | { t: 'note', ref, c } | { t: 'style', name, c } | { t: 'img', src, alt } | { t: 'br' }]
//   href: '#id' (a section, block or note of the book) or an external http(s): / mailto: link.
//
// Exports: newBook, newSection, normalizeBook, personName, parsePersonName, inlineText, linesText, blockText,
// blockPlain, sectionTitle, walkSections, walkBlocks, toc, readingUnits, bookStats, collectIds, uniqueId, slug,
// cleanInline, isEmptyInline, mapInline, INLINE_TAGS, BLOCK_TYPES.

//
// Design decisions:
// - One neutral model, N edge converters: FB2 <-> model <-> EPUB/HTML/Markdown/text. Direct pairwise converters would
//   need N^2 code paths; a hub model needs 2N and makes every format round-trip through the same invariants.
// - Inline content is an array of strings and tagged nodes, not HTML: it cannot carry scripts or unknown markup, it
//   diffs and serialises as JSON, and every writer decides its own escaping.
// - normalizeBook is the trust boundary. Every importer (and JSON from disk / IndexedDB) goes through it: types are
//   coerced, strings length-capped, nesting depth and total item count bounded (LIMIT). A hostile or corrupted file
//   therefore cannot blow the stack (deep nesting) or the memory (millions of nodes) of the reader.
import { uid } from '../util/id.js';

export const BOOK_FORMAT = 'in-html-book';
export const BOOK_VERSION = 1;
export const INLINE_TAGS = ['em', 'strong', 'strike', 'sub', 'sup', 'code'];
export const BLOCK_TYPES = ['p', 'subtitle', 'empty', 'hr', 'code', 'image', 'epigraph', 'cite', 'poem', 'table', 'list'];
// depth 24 is far beyond real books (FB2 rarely nests sections past 5) yet keeps recursion well inside JS stack
// limits; items 200k covers a long novel's paragraphs with margin.
const LIMIT = { text: 2_000_000, depth: 24, items: 200_000 };

const str = (v, max = 100000) => (v == null ? '' : String(v)).slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

export function newBook(init = {}) {
  const now = new Date().toISOString();
  return normalizeBook({
    meta: { title: '', lang: 'en', ids: [{ scheme: 'uuid', value: uuid() }], created: now, modified: now, docVersion: '1.0', ...(init.meta || {}) },
    sections: init.sections || [],
    styles: init.styles || [],
    images: init.images || {},
    notes: init.notes || [],
    title: init.title || null,
    front: init.front || [],
  });
}

export function newSection(title = '', blocks = []) {
  return { id: 's-' + uid(), title: title ? [[title]] : null, blocks, sections: [] };
}

// RFC 4122 version 4 UUID.
// crypto.getRandomValues when available; Math.random fallback only for exotic hosts. The id identifies a book, it is
// not a secret, so a weak fallback is acceptable. Version (4) and variant (10xx) bits set per RFC 4122.
export function uuid() {
  const b = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// --- persons ------------------------------------------------------------------------------------------

export function personName(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  const full = [p.first, p.middle, p.last].filter(Boolean).join(' ').trim();
  return full || str(p.nick).trim();
}
// "Jane Q. Public" / "Public, Jane Q." -> { first, middle, last }
// Heuristic: "Last, First Middle" when a comma is present, else "First Middle... Last"; a single word is a nick
// (pen names, mononyms). Wrong for name orders like Chinese "Family Given", which have no reliable textual marker.
export function parsePersonName(s) {
  s = str(s, 300).replace(/\s+/g, ' ').trim();
  if (!s) return { first: '', middle: '', last: '', nick: '' };
  if (s.includes(',')) {
    const [last, rest] = [s.slice(0, s.indexOf(',')).trim(), s.slice(s.indexOf(',') + 1).trim()];
    const parts = rest.split(' ').filter(Boolean);
    return { first: parts[0] || '', middle: parts.slice(1).join(' '), last, nick: '' };
  }
  const parts = s.split(' ');
  if (parts.length === 1) return { first: '', middle: '', last: '', nick: s };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1], nick: '' };
}
// "Last, First Middle" (sorting key, EPUB file-as).
export function personFileAs(p) {
  if (!p) return '';
  if (p.last) return [p.last, [p.first, p.middle].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return personName(p);
}
function normPerson(p) {
  if (typeof p === 'string') return parsePersonName(p);
  if (!isObj(p)) return null;
  const o = { first: str(p.first, 200).trim(), middle: str(p.middle, 200).trim(), last: str(p.last, 200).trim(), nick: str(p.nick, 200).trim() };
  return o.first || o.middle || o.last || o.nick ? o : null;
}

// --- inline ---------------------------------------------------------------------------------------------

// Merges adjacent strings, drops empty wrappers; keeps the structure otherwise.
// Canonical form matters: equal content must have equal structure, so diffing, search offsets and round-trip tests
// compare reliably. Unknown tags are unwrapped (children kept), never dropped with their text.
// A note reference always keeps a visible label ('*' fallback): an empty <a> would be an invisible, unclickable link.
export function cleanInline(inl, depth = 0) {
  const out = [];
  for (const x of arr(inl)) {
    if (x == null) continue;
    if (typeof x === 'string' || typeof x === 'number') {
      const s = String(x);
      if (!s) continue;
      if (typeof out[out.length - 1] === 'string') out[out.length - 1] += s; else out.push(s);
      continue;
    }
    if (!isObj(x) || depth > LIMIT.depth) continue;
    const t = x.t;
    if (t === 'br') { out.push({ t: 'br' }); continue; }
    if (t === 'img') { if (x.src) out.push({ t: 'img', src: str(x.src, 200), alt: str(x.alt, 500) }); continue; }
    if (t === 'note') {
      if (!x.ref) continue;
      const c = cleanInline(x.c, depth + 1);
      out.push({ t: 'note', ref: str(x.ref, 200), c: c.length ? c : ['*'] });
      continue;
    }
    const c = cleanInline(x.c, depth + 1);
    if (!c.length) continue;
    if (INLINE_TAGS.includes(t)) out.push({ t, c });
    else if (t === 'a') { const href = str(x.href, 2000).trim(); if (href) out.push({ t: 'a', href, c }); else pushAll(out, c); }
    else if (t === 'style') { if (x.name) out.push({ t: 'style', name: str(x.name, 80), c }); else pushAll(out, c); }
    else pushAll(out, c);
  }
  return out;
}
function pushAll(out, c) {
  for (const y of c) {
    if (typeof y === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] += y; else out.push(y);
  }
}

// Plain text of inline content; note references give their label, images nothing, line breaks '\n' when asked.
export function inlineText(inl, br = '') {
  let s = '';
  for (const x of arr(inl)) {
    if (typeof x === 'string') s += x;
    else if (x && x.t === 'br') s += br;
    else if (x && x.c) s += inlineText(x.c, br);
  }
  return s;
}
export const isEmptyInline = (inl) => !arr(inl).some((x) => (typeof x === 'string' ? /\S/.test(x) : x && (x.t === 'img' || (x.c && !isEmptyInline(x.c)))));
export const linesText = (lines, sep = ' ') => arr(lines).map((l) => inlineText(l).trim()).filter(Boolean).join(sep);

// Applies fn to every inline node (depth first, children first); fn(node) may return a replacement array.
// Return contract of fn: undefined keeps the node, an array splices, null deletes, anything else replaces.
export function mapInline(inl, fn) {
  const out = [];
  for (const x of arr(inl)) {
    let y = x;
    if (y && typeof y === 'object' && y.c) y = { ...y, c: mapInline(y.c, fn) };
    const r = fn(y);
    if (r === undefined) out.push(y); else if (Array.isArray(r)) out.push(...r); else if (r !== null) out.push(r);
  }
  return out;
}

// --- blocks -------------------------------------------------------------------------------------------

// ctx.n counts every block and section across the whole book (shared object), so LIMIT.items bounds total work,
// not per-container work. Unknown block types return null and disappear: a block the writers cannot render must
// not reach them.
function normBlock(b, ctx, depth = 0) {
  if (!isObj(b) || depth > LIMIT.depth || ++ctx.n > LIMIT.items) return null;
  const id = b.id ? str(b.id, 120) : '';
  const withId = (o) => (id ? { ...o, id } : o);
  switch (b.type) {
    case 'p': {
      const o = { type: 'p', c: cleanInline(b.c) };
      if (b.style) o.style = str(b.style, 80);
      return withId(o);
    }
    case 'subtitle': return withId({ type: 'subtitle', c: cleanInline(b.c) });
    case 'empty': return withId({ type: 'empty' });
    case 'hr': return withId({ type: 'hr' });
    case 'code': return withId({ type: 'code', text: str(b.text, LIMIT.text) });
    case 'image': return b.src ? withId({ type: 'image', src: str(b.src, 200), alt: str(b.alt, 1000), title: cleanInline(b.title) }) : null;
    case 'epigraph': case 'cite': return withId({ type: b.type, blocks: normBlocks(b.blocks, ctx, depth + 1), authors: arr(b.authors).map((a) => cleanInline(a)).filter((a) => a.length) });
    case 'poem': {
      const stanzas = arr(b.stanzas).map((s) => (isObj(s) ? {
        title: normLines(s.title), subtitle: cleanInline(s.subtitle), lines: arr(s.lines).map((l) => cleanInline(l)),
      } : null)).filter((s) => s && (s.lines.length || s.title || s.subtitle.length));
      return withId({
        type: 'poem', title: normLines(b.title), epigraphs: normBlocks(b.epigraphs, ctx, depth + 1).filter((x) => x.type === 'epigraph'),
        stanzas: stanzas.length ? stanzas : [{ title: null, subtitle: [], lines: [[]] }],
        authors: arr(b.authors).map((a) => cleanInline(a)).filter((a) => a.length), date: str(b.date, 200),
      });
    }
    // colspan/rowspan are clamped: a hostile rowspan=1e9 would make table writers allocate absurd grids.
    case 'table': {
      const rows = arr(b.rows).map((r) => ({
        cells: arr(r && r.cells).map((c) => {
          const o = { c: cleanInline(c && c.c) };
          if (c && c.header) o.header = true;
          if (c && c.colspan > 1) o.colspan = Math.min(100, c.colspan | 0);
          if (c && c.rowspan > 1) o.rowspan = Math.min(1000, c.rowspan | 0);
          if (c && ['left', 'center', 'right', 'justify'].includes(c.align)) o.align = c.align;
          return o;
        }),
      })).filter((r) => r.cells.length);
      return rows.length ? withId({ type: 'table', rows }) : null;
    }
    case 'list': {
      const items = arr(b.items).map((it) => normBlocks(it, ctx, depth + 1)).filter((it) => it.length);
      return items.length ? withId({ type: 'list', ordered: !!b.ordered, items }) : null;
    }
    default: return null;
  }
}
const normBlocks = (list, ctx, depth = 0) => arr(list).map((b) => normBlock(b, ctx, depth)).filter(Boolean);
function normLines(lines) {
  const ls = arr(lines).map((l) => cleanInline(typeof l === 'string' ? [l] : l)).filter((l) => !isEmptyInline(l));
  return ls.length ? ls : null;
}

function normSection(s, ctx, depth = 0) {
  if (!isObj(s) || depth > LIMIT.depth || ++ctx.n > LIMIT.items) return null;
  return {
    id: s.id ? str(s.id, 120) : 's-' + uid(),
    title: normLines(s.title),
    blocks: normBlocks(s.blocks, ctx, depth),
    sections: arr(s.sections).map((x) => normSection(x, ctx, depth + 1)).filter(Boolean),
  };
}

// Named styles are whitelisted enumerations, never free CSS: css.js interpolates them into a stylesheet, so a free
// value like "red; } body { display:none" would be CSS injection. Colour must be #rrggbb for the same reason.
const STYLE_PROPS = {
  font: ['serif', 'sans', 'mono', 'script', ''], size: ['xs', 's', 'm', 'l', 'xl', ''], align: ['left', 'center', 'right', 'justify', ''],
  indent: ['none', 'first', 'hanging', 'block', ''], spaceBefore: ['0', '0.5', '1', '2', ''], spaceAfter: ['0', '0.5', '1', '2', ''],
};
export function normStyle(s) {
  if (!isObj(s)) return null;
  const id = slug(s.id || s.name || '');
  if (!id) return null;
  const p = isObj(s.props) ? s.props : {};
  const props = {};
  for (const [k, allowed] of Object.entries(STYLE_PROPS)) if (allowed.includes(String(p[k] ?? '')) && p[k]) props[k] = String(p[k]);
  for (const k of ['bold', 'italic', 'smallCaps', 'underline']) if (p[k]) props[k] = true;
  if (typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color)) props.color = p.color.toLowerCase();
  return { id, name: str(s.name || id, 80).trim() || id, kind: s.kind === 'inline' ? 'inline' : 'block', props };
}

// Lower-case ASCII identifier ('Chapter One!' -> 'chapter-one').
// NFKD + strip combining marks folds accents (e-acute -> e) before the ASCII filter; non-Latin scripts slug to ''.
// A leading letter is enforced ('x' prefix) because ids must be valid XML NCNames and CSS identifiers.
export function slug(s, max = 48) {
  const t = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  return /^[a-z]/.test(t) ? t : t ? 'x' + t : '';
}

// Never throws; returns a fresh normalized book.
// Image bytes accepted as Uint8Array, ArrayBuffer or any view (structured clone from IndexedDB may return any of
// them); the view is wrapped without copying, respecting byteOffset. The type is sniffed when missing.
// meta.cover is kept only if it points at an existing image, so writers never emit a dangling cover reference.
export function normalizeBook(raw) {
  const b = isObj(raw) ? raw : {};
  const m = isObj(b.meta) ? b.meta : {};
  const ctx = { n: 0 };
  const persons = (v) => arr(v).map(normPerson).filter(Boolean);
  const images = {};
  if (isObj(b.images)) {
    for (const [id, im] of Object.entries(b.images)) {
      if (!isObj(im) || !id) continue;
      const data = im.data instanceof Uint8Array ? im.data : im.data instanceof ArrayBuffer ? new Uint8Array(im.data) : ArrayBuffer.isView(im.data) ? new Uint8Array(im.data.buffer, im.data.byteOffset, im.data.byteLength) : null;
      if (!data) continue;
      images[str(id, 200)] = { type: str(im.type || sniffImage(data) || 'application/octet-stream', 100), data, name: str(im.name || id, 200) };
    }
  }
  const meta = {
    title: str(m.title, 1000).trim(), subtitle: str(m.subtitle, 1000).trim(),
    authors: persons(m.authors), translators: persons(m.translators),
    lang: str(m.lang || 'en', 35).trim() || 'en', srcLang: str(m.srcLang, 35).trim(),
    series: arr(m.series).map((s) => (isObj(s) && s.name ? { name: str(s.name, 500).trim(), number: str(s.number ?? '', 20).trim() } : null)).filter(Boolean),
    annotation: normBlocks(m.annotation, ctx),
    keywords: str(m.keywords, 2000).trim(),
    genres: arr(m.genres).map((g) => str(g, 60).trim()).filter(Boolean),
    subjects: arr(m.subjects).map((g) => str(g, 200).trim()).filter(Boolean),
    date: str(m.date, 60).trim(), year: str(m.year, 20).trim(),
    publisher: str(m.publisher, 500).trim(), city: str(m.city, 200).trim(), isbn: str(m.isbn, 40).trim(),
    ids: arr(m.ids).map((x) => (isObj(x) && x.value ? { scheme: str(x.scheme || '', 40).trim(), value: str(x.value, 300).trim() } : null)).filter(Boolean),
    rights: str(m.rights, 2000).trim(),
    cover: m.cover && images[m.cover] ? String(m.cover) : '',
    coverDesign: isObj(m.coverDesign) ? { design: str(m.coverDesign.design, 40), palette: str(m.coverDesign.palette, 40) } : null,
    created: str(m.created, 40), modified: str(m.modified, 40), docVersion: str(m.docVersion || '1.0', 20),
    docAuthors: persons(m.docAuthors), program: str(m.program, 200), srcUrl: str(m.srcUrl, 2000), srcOcr: str(m.srcOcr, 500),
  };
  if (!meta.ids.length) meta.ids.push({ scheme: 'uuid', value: uuid() });
  const styles = [];
  for (const s of arr(b.styles)) { const n = normStyle(s); if (n && !styles.some((x) => x.id === n.id)) styles.push(n); }
  const book = {
    format: BOOK_FORMAT, version: BOOK_VERSION, meta, styles, images,
    title: normLines(b.title),
    front: normBlocks(b.front, ctx),
    sections: arr(b.sections).map((s) => normSection(s, ctx)).filter(Boolean),
    notes: arr(b.notes).map((n) => (isObj(n) && n.id ? {
      id: str(n.id, 120), kind: n.kind === 'comment' ? 'comment' : 'note', label: cleanInline(n.label), blocks: normBlocks(n.blocks, ctx),
    } : null)).filter(Boolean),
  };
  dedupeIds(book);
  return book;
}

// Image type from magic bytes.
// Magic numbers: JPEG FF D8, PNG 89 'PNG', GIF 'GIF', WebP 'RIFF'....'WEBP' (bytes 8-9 'WE'), SVG by text.
// Content beats declared type: EPUB manifests and FB2 binaries often carry a wrong content-type.
export function sniffImage(d) {
  if (!d || d.length < 4) return '';
  if (d[0] === 0xff && d[1] === 0xd8) return 'image/jpeg';
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return 'image/png';
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return 'image/gif';
  if (d.length > 11 && d[0] === 0x52 && d[1] === 0x49 && d[8] === 0x57 && d[9] === 0x45) return 'image/webp';
  const head = String.fromCharCode(...d.subarray(0, 256)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return '';
}

// --- traversal ----------------------------------------------------------------------------------------

// fn(section, depth, parent, index) for every section, document order; false skips its subsections.
export function walkSections(list, fn, depth = 0, parent = null) {
  arr(list).forEach((s, i) => { if (fn(s, depth, parent, i) !== false) walkSections(s.sections, fn, depth + 1, s); });
}
// fn(block, owner) for every block, nested ones included (epigraph / cite / list contents, poem epigraphs, notes).
export function walkBlocks(book, fn) {
  const rec = (blocks, owner) => {
    for (const b of arr(blocks)) {
      fn(b, owner);
      if (b.blocks) rec(b.blocks, owner);
      if (b.epigraphs) rec(b.epigraphs, owner);
      if (b.items) for (const it of b.items) rec(it, owner);
    }
  };
  rec(book.meta && book.meta.annotation, 'annotation');
  rec(book.front, 'front');
  walkSections(book.sections, (s) => { rec(s.blocks, s); });
  for (const n of arr(book.notes)) rec(n.blocks, n);
}
// Every inline array of a block (paragraph text, titles, verse lines, cells, authors…).
export function blockInlines(b, out = []) {
  if (!b) return out;
  if (b.c) out.push(b.c);
  if (b.title && b.type === 'image') out.push(b.title);
  else if (b.title) out.push(...b.title);
  if (b.authors) out.push(...b.authors);
  if (b.stanzas) for (const s of b.stanzas) { if (s.title) out.push(...s.title); if (s.subtitle) out.push(s.subtitle); out.push(...s.lines); }
  if (b.rows) for (const r of b.rows) for (const c of r.cells) out.push(c.c);
  for (const x of arr(b.blocks)) blockInlines(x, out);
  for (const x of arr(b.epigraphs)) blockInlines(x, out);
  for (const it of arr(b.items)) for (const x of it) blockInlines(x, out);
  return out;
}

export const sectionTitle = (s) => (s && s.title ? linesText(s.title) : '');

// Plain text of a block for word counts, search previews and plain-text export ('\n' between lines).
export function blockText(b) {
  switch (b.type) {
    case 'p': case 'subtitle': return inlineText(b.c, '\n');
    case 'empty': return '';
    case 'hr': return '* * *';
    case 'code': return b.text;
    case 'image': return inlineText(b.title);
    case 'epigraph': case 'cite': return [...b.blocks.map(blockText), ...b.authors.map((a) => inlineText(a))].filter(Boolean).join('\n');
    case 'poem': return [b.title ? linesText(b.title, '\n') : '', ...b.epigraphs.map(blockText),
      ...b.stanzas.map((s) => [s.title ? linesText(s.title, '\n') : '', inlineText(s.subtitle), ...s.lines.map((l) => inlineText(l))].filter(Boolean).join('\n')),
      ...b.authors.map((a) => inlineText(a)), b.date].filter(Boolean).join('\n');
    case 'table': return b.rows.map((r) => r.cells.map((c) => inlineText(c.c)).join('\t')).join('\n');
    case 'list': return b.items.map((it) => it.map(blockText).join('\n')).join('\n');
    default: return '';
  }
}

// The exact text content of a block as rendered by book/html.js (the reader's highlight and search offsets): every
// inline array in render order, '\n' between line-level elements of containers, nothing for images and breaks.
// Invariant: blockPlain(b) === textContent of book/html.js's rendering of b. Reader highlights and search store
// character offsets into this string and map them back onto DOM text nodes; any divergence (an extra newline, a
// missing caption) shifts every highlight after it. Keep both files in sync when rendering changes.
export function blockPlain(b) {
  switch (b.type) {
    case 'p': case 'subtitle': return inlineText(b.c);
    case 'empty': case 'hr': return '';
    case 'code': return b.text;
    case 'image': return inlineText(b.title);
    case 'epigraph': case 'cite': return [...b.blocks.map(blockPlain), ...b.authors.map((a) => inlineText(a))].join('\n');
    case 'poem': {
      const parts = [];
      if (b.title) parts.push(b.title.map((l) => inlineText(l)).join('\n'));
      for (const e of b.epigraphs) parts.push(blockPlain(e));
      for (const s of b.stanzas) {
        const sp = [];
        if (s.title) sp.push(s.title.map((l) => inlineText(l)).join('\n'));
        if (s.subtitle && s.subtitle.length) sp.push(inlineText(s.subtitle));
        for (const l of s.lines) sp.push(inlineText(l));
        parts.push(sp.join('\n'));
      }
      for (const a of b.authors) parts.push(inlineText(a));
      if (b.date) parts.push(b.date);
      return parts.join('\n');
    }
    case 'table': return b.rows.map((r) => r.cells.map((c) => inlineText(c.c)).join('\n')).join('\n');
    case 'list': return b.items.map((it) => (it.length === 1 && it[0].type === 'p' ? inlineText(it[0].c) : it.map(blockPlain).join('\n'))).join('\n');
    default: return '';
  }
}
// Text of a section title as rendered (lines joined with '\n').
export const titlePlain = (lines) => arr(lines).map((l) => inlineText(l)).join('\n');

// Table of contents: [{ id, title, depth, children }] (untitled sections appear only when they have titled children).
export function toc(book, untitled = '…') {
  const rec = (list, depth) => arr(list).map((s) => ({ id: s.id, title: sectionTitle(s) || untitled, depth, untitled: !s.title, children: rec(s.sections, depth + 1) }));
  return rec(book.sections, 0);
}

// Reading units in document order — the unit of positions, highlights and search: the body title, the front blocks,
// then for every section its title and its blocks (subsections follow their parent's blocks). Each unit:
// { k, kind: 'title' | 'block', section (or null), path: [section indices], depth, block, lines, text (blockPlain / title) }.
// Units are the stable coordinates of reading positions: (k, offset in text). Block granularity, not section: a
// position survives edits elsewhere in a chapter better, and units stay small for fast search and highlighting.
export function readingUnits(book) {
  const units = [];
  const add = (u) => { u.k = units.length; units.push(u); };
  if (book.title) add({ kind: 'title', section: null, path: [], depth: -1, lines: book.title, text: titlePlain(book.title) });
  for (const b of arr(book.front)) add({ kind: 'block', section: null, path: [], depth: -1, block: b, text: blockPlain(b) });
  const rec = (list, depth, path) => arr(list).forEach((s, i) => {
    const p = [...path, i];
    if (s.title) add({ kind: 'title', section: s, path: p, depth, lines: s.title, text: titlePlain(s.title) });
    for (const b of s.blocks) add({ kind: 'block', section: s, path: p, depth, block: b, text: blockPlain(b) });
    rec(s.sections, depth + 1, p);
  });
  rec(book.sections, 0, []);
  return units;
}

// Words, characters, sections, notes, images; minutes at 230 words per minute.
export function bookStats(book) {
  let words = 0, chars = 0, sections = 0, blocks = 0;
  const count = (s) => { chars += s.length; words += (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length; };
  walkSections(book.sections, (s) => { sections++; if (s.title) count(linesText(s.title)); });
  walkBlocks(book, (b, owner) => { if (owner !== 'annotation') { blocks++; if (!b.blocks && !b.items) count(blockText(b)); } });
  return { words, chars, sections, blocks, notes: arr(book.notes).length, images: Object.keys(book.images || {}).length, minutes: Math.max(1, Math.round(words / 230)) };
}

// Every id of the book (sections, blocks, notes) -> kind.
export function collectIds(book) {
  const ids = new Map();
  walkSections(book.sections, (s) => { ids.set(s.id, 'section'); });
  walkBlocks(book, (b) => { if (b.id && !ids.has(b.id)) ids.set(b.id, 'block'); });
  for (const n of arr(book.notes)) ids.set(n.id, 'note');
  return ids;
}
export function uniqueId(base, taken) {
  let id = slug(base) || 'id';
  if (!taken.has(id)) { taken.add(id); return id; }
  for (let i = 2; ; i++) if (!taken.has(id + '-' + i)) { taken.add(id + '-' + i); return id + '-' + i; }
}

// Section, block and note ids are made unique (later duplicates are renamed; links keep pointing at the first).
// Ids must be valid XML ids (EPUB/FB2 are XML) and unique (HTML anchors). Sections are fixed first, then notes, then
// blocks, so on a collision the structurally important target keeps its id.
// KNOWN DEFECT: an id rewritten here (invalid -> slug, or a duplicate -> -2) does not update hrefs and note refs
// that pointed at the old value, so such links silently break. Fix: build an old -> new map and rewrite a.href /
// note.ref through mapInline after renaming.
function dedupeIds(book) {
  const seen = new Set();
  const fix = (o) => {
    if (!o.id) return;
    if (!/^[A-Za-z_][\w.:-]*$/.test(o.id)) o.id = slug(o.id) || 'id-' + uid();
    if (seen.has(o.id)) { let i = 2; while (seen.has(o.id + '-' + i)) i++; o.id = o.id + '-' + i; }
    seen.add(o.id);
  };
  walkSections(book.sections, fix);
  for (const n of book.notes) fix(n);
  walkBlocks(book, fix);
}
