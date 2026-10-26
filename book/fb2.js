// book/fb2.js - FictionBook 2 (FB2 2.0 / 2.1) read and write: description (title / document / publish info), bodies,
// sections, poems, citations, epigraphs, tables, inline styles, notes and comments bodies, binary images (base64),
// a stylesheet with the book's named styles. Files in any encoding (XML declaration, BOM, windows-1251 fallback);
// malformed files are read as far as they make sense.
//
//   readFB2(bytesOrText) -> book
//   writeFB2(book, { program, notesTitle, commentsTitle, now }) -> FB2 text (UTF-8, schema order)
//   FB2_GENRES: [[code, English label]] — common genre codes

import { escapeXML, escapeXMLAttr } from '../xml/xml.js';
import { b64decode, b64encode } from '../codec/base64.js';
import { decodeText, getAttr, kid, kids, ln, parseMarkup, rootOf, textContent } from './markup.js';
import { tidyInline } from './html.js';
import { stylesCSS, readStylesCSS } from './css.js';
import { blockText, cleanInline, inlineText, isEmptyInline, newBook, normalizeBook, sniffImage, slug, uuid } from './model.js';

//
// Read side: the tolerant markup.js parser (not strict XML), because a large share of FB2 files circulating are not
// well-formed (bad entities, unclosed tags, wrong declared encodings); rejecting them would make the reader useless
// for its main format. Write side: strict, schema-ordered, UTF-8, validated by validate.checkFB2 in tests.
// FB2 quirks handled: notes live in extra <body name="notes"> sections and are referenced by <a type="note">;
// images are base64 <binary> elements referenced by l:href="#id"; paragraphs cannot contain line breaks.
export const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

export const FB2_GENRES = [
  ['prose_contemporary', 'Contemporary prose'], ['prose_classic', 'Classic prose'], ['prose_history', 'Historical prose'],
  ['prose_rus_classic', 'Russian classics'], ['prose_su_classics', 'Soviet classics'], ['prose_counter', 'Counterculture'],
  ['sf', 'Science fiction'], ['sf_fantasy', 'Fantasy'], ['sf_social', 'Social science fiction'], ['sf_space', 'Space fiction'],
  ['sf_horror', 'Horror'], ['sf_humor', 'Humorous fantasy'], ['sf_cyberpunk', 'Cyberpunk'], ['sf_heroic', 'Heroic fantasy'],
  ['det_classic', 'Classic detective'], ['det_police', 'Police procedural'], ['detective', 'Detective'], ['thriller', 'Thriller'],
  ['love_contemporary', 'Contemporary romance'], ['love_history', 'Historical romance'], ['adventure', 'Adventure'],
  ['adv_history', 'Historical adventure'], ['adv_geo', 'Travel and geography'], ['child_tale', 'Fairy tales'],
  ['child_prose', 'Children’s prose'], ['child_verse', 'Children’s verse'], ['poetry', 'Poetry'], ['dramaturgy', 'Drama'],
  ['antique', 'Ancient literature'], ['nonf_biography', 'Biography and memoirs'], ['nonf_publicism', 'Essays and journalism'],
  ['sci_history', 'History'], ['sci_philosophy', 'Philosophy'], ['sci_psychology', 'Psychology'], ['sci_popular', 'Popular science'],
  ['science', 'Science'], ['religion', 'Religion'], ['reference', 'Reference'], ['comp_programming', 'Programming'],
  ['humor', 'Humor'], ['home_cooking', 'Cooking'], ['other', 'Other'],
];

// --- reading ------------------------------------------------------------------------------------------

const WS = /[ \t\n\r\f]+/g;
const hrefOf = (nd) => String(getAttr(nd, 'href') || '').trim();
const isScene = (s) => /^[\s*⁂•·∗✱~#_ .–—-]{1,24}$/.test(s) && /[*⁂•∗✱~#]/.test(s);

// Note detection happens before body parsing: an <a href="#x"> is a note reference if x is a section of a notes
// body, which must be known when the main body's inline content is converted.
export function readFB2(input) {
  const text = typeof input === 'string' ? input : decodeText(input).text;
  const doc = parseMarkup(text);
  const fb = rootOf(doc);
  if (!fb || ln(fb) !== 'fictionbook') throw new Error('not a FictionBook (FB2) document');
  const book = newBook();
  const m = book.meta;
  m.ids = [];
  const desc = kid(fb, 'description');
  const ti = kid(desc, 'title-info');
  const di = kid(desc, 'document-info');
  const pi = kid(desc, 'publish-info');
  const person = (nd) => ({
    first: clean(textContent(kid(nd, 'first-name'))), middle: clean(textContent(kid(nd, 'middle-name'))),
    last: clean(textContent(kid(nd, 'last-name'))), nick: clean(textContent(kid(nd, 'nickname'))),
  });
  const persons = (nd, name) => kids(nd, name).map(person).filter((p) => p.first || p.middle || p.last || p.nick);

  // Notes: ids of sections in the other bodies (and every <a type="note"> target).
  const bodies = kids(fb, 'body');
  const isNotesBody = (b) => /^(notes|comments|footnotes|endnotes)$/i.test(String(getAttr(b, 'name') || ''));
  // The main body is the first body that is not a notes/comments body, whatever its position in the file.
  const main = bodies.find((b) => !isNotesBody(b)) || bodies[0] || null;
  const noteBodies = bodies.filter((b) => b !== main);
  const noteIds = new Set();
  const collect = (nd) => { for (const s of kids(nd, 'section')) { const id = getAttr(s, 'id'); if (id) noteIds.add(id); collect(s); } };
  for (const b of noteBodies) collect(b);

  const ctx = { noteIds, styles: new Set() };
  if (ti) {
    m.genres = kids(ti, 'genre').map((g) => clean(textContent(g))).filter(Boolean);
    m.authors = persons(ti, 'author');
    m.title = clean(textContent(kid(ti, 'book-title')));
    const ann = kid(ti, 'annotation');
    if (ann) m.annotation = fbBlocks(ann.children, ctx);
    m.keywords = clean(textContent(kid(ti, 'keywords')));
    const date = kid(ti, 'date');
    if (date) m.date = clean(getAttr(date, 'value') || textContent(date));
    const cp = kid(ti, 'coverpage');
    const cimg = cp && kid(cp, 'image');
    if (cimg) m.cover = hrefOf(cimg).replace(/^#/, '');
    m.lang = clean(textContent(kid(ti, 'lang'))) || 'en';
    m.srcLang = clean(textContent(kid(ti, 'src-lang')));
    m.translators = persons(ti, 'translator');
    m.series = kids(ti, 'sequence').map((s) => ({ name: clean(getAttr(s, 'name')), number: clean(getAttr(s, 'number')) })).filter((s) => s.name);
  }
  if (di) {
    m.docAuthors = persons(di, 'author');
    m.program = clean(textContent(kid(di, 'program-used')));
    const d = kid(di, 'date');
    if (d) m.created = clean(getAttr(d, 'value') || textContent(d));
    m.srcUrl = clean(textContent(kid(di, 'src-url')));
    m.srcOcr = clean(textContent(kid(di, 'src-ocr')));
    const id = clean(textContent(kid(di, 'id')));
    if (id) m.ids.push({ scheme: /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? 'uuid' : 'fb2', value: id });
    m.docVersion = clean(textContent(kid(di, 'version'))) || '1.0';
  }
  if (pi) {
    m.publisher = clean(textContent(kid(pi, 'publisher')));
    m.city = clean(textContent(kid(pi, 'city')));
    m.year = clean(textContent(kid(pi, 'year')));
    m.isbn = clean(textContent(kid(pi, 'isbn')));
    if (m.isbn) m.ids.push({ scheme: 'isbn', value: m.isbn });
    if (!m.series.length) m.series = kids(pi, 'sequence').map((s) => ({ name: clean(getAttr(s, 'name')), number: clean(getAttr(s, 'number')) })).filter((s) => s.name);
  }
  // custom-info carries what FB2 has no element for (subtitle, subjects, rights); writeFB2 writes the same keys, so
  // these fields round-trip through FB2.
  for (const ci of kids(desc, 'custom-info')) {
    const type = String(getAttr(ci, 'info-type') || '').toLowerCase();
    const v = clean(textContent(ci));
    if (!v) continue;
    if (type === 'subtitle') m.subtitle = v;
    else if (type === 'subjects') m.subjects = v.split(/\s*;\s*/).filter(Boolean);
    else if (type === 'rights') m.rights = v;
  }
  const sheet = kid(fb, 'stylesheet');
  if (sheet) book.styles = readStylesCSS(textContent(sheet));
  for (const st of book.styles) ctx.styles.add(st.id);

  if (main) {
    const secs = [];
    let loose = null;
    for (const c of kids(main)) {
      const n = ln(c);
      if (n === 'title') book.title = titleLines(c, ctx);
      else if (n === 'epigraph') book.front.push(boxOf(c, 'epigraph', ctx));
      else if (n === 'image' && !secs.length) book.front.push(imageOf(c));
      else if (n === 'section') { loose = null; secs.push(sectionOf(c, ctx)); }
      else {
        // Content directly in a body (not allowed, but seen): an untitled section.
        const bl = fbBlocks([c], ctx);
        if (!bl.length) continue;
        if (!loose) { loose = { id: '', title: null, blocks: [], sections: [] }; secs.push(loose); }
        loose.blocks.push(...bl);
      }
    }
    book.sections = secs;
  }
  for (const b of noteBodies) {
    const kind = /comment/i.test(String(getAttr(b, 'name') || '')) ? 'comment' : 'note';
    const rec = (nd) => {
      for (const s of kids(nd, 'section')) {
        const id = getAttr(s, 'id');
        const sub = kids(s, 'section');
        if (id) {
          const t = kid(s, 'title');
          const label = t ? cleanInline(titleLines(t, ctx).flatMap((l, i) => (i ? [' ', ...l] : l))) : [];
          const blocks = fbBlocks(kids(s).filter((x) => !['title', 'section'].includes(ln(x))), ctx);
          book.notes.push({ id, kind, label: label.length ? label : [id], blocks });
        }
        if (sub.length) rec(s);
      }
    };
    rec(b);
  }
  // Undecodable binaries are skipped individually (one bad image must not lose the book). Type: sniffed bytes beat the
  // declared content-type, which is frequently wrong in the wild.
  for (const bin of kids(fb, 'binary')) {
    const id = getAttr(bin, 'id');
    if (!id) continue;
    let data;
    try { data = b64decode(textContent(bin)); } catch { continue; }
    if (!data.length) continue;
    const type = sniffImage(data) || clean(getAttr(bin, 'content-type')) || 'application/octet-stream';
    book.images[id] = { type, data, name: id };
  }
  if (!m.title) m.title = book.title ? book.title.map((l) => inlineText(l)).join(' ') : '';
  if (!m.ids.length) m.ids.push({ scheme: 'uuid', value: uuid() });
  return normalizeBook(book);
}

const clean = (s) => String(s ?? '').replace(WS, ' ').trim();

// Inline mapping: FB2 emphasis/strikethrough plus HTML-ish names seen in sloppy files (em, i, s). Links: in-book
// fragments, http(s) and mailto only; anything else keeps its text and loses the link (same policy as HTML import).
function fbInline(nodes, ctx, pre = false) {
  const out = [];
  for (const nd of nodes || []) {
    if (nd.type === 'text') { out.push(pre ? nd.text : nd.text.replace(WS, ' ')); continue; }
    if (nd.type !== 'element') continue;
    const n = ln(nd);
    const sub = () => fbInline(nd.children, ctx, pre || n === 'code');
    switch (n) {
      case 'strong': out.push({ t: 'strong', c: sub() }); break;
      case 'emphasis': case 'em': case 'i': out.push({ t: 'em', c: sub() }); break;
      case 'strikethrough': case 's': out.push({ t: 'strike', c: sub() }); break;
      case 'sub': out.push({ t: 'sub', c: sub() }); break;
      case 'sup': out.push({ t: 'sup', c: sub() }); break;
      case 'code': out.push({ t: 'code', c: sub() }); break;
      case 'style': {
        const name = slug(getAttr(nd, 'name') || '');
        if (name) out.push({ t: 'style', name, c: sub() }); else out.push(...sub());
        break;
      }
      case 'a': {
        const href = hrefOf(nd);
        const target = href.startsWith('#') ? href.slice(1) : '';
        if (target && (ctx.noteIds.has(target) || String(getAttr(nd, 'type')).toLowerCase() === 'note')) out.push({ t: 'note', ref: target, c: sub() });
        else if (target) out.push({ t: 'a', href, c: sub() });
        else if (/^(https?:|mailto:)/i.test(href)) out.push({ t: 'a', href, c: sub() });
        else out.push(...sub());
        break;
      }
      case 'image': { const src = hrefOf(nd).replace(/^#/, ''); if (src) out.push({ t: 'img', src, alt: getAttr(nd, 'alt') || '' }); break; }
      default: out.push(...sub());
    }
  }
  return out;
}
const inl = (nd, ctx) => tidyInline(fbInline(nd.children, ctx));

function titleLines(nd, ctx) {
  const lines = [];
  for (const c of kids(nd)) {
    if (ln(c) === 'p') { const l = inl(c, ctx); if (!isEmptyInline(l)) lines.push(l); }
  }
  // Text directly in <title> (malformed) is one line.
  if (!lines.length) { const l = tidyInline(fbInline(nd.children, ctx)); if (!isEmptyInline(l)) lines.push(l); }
  return lines.length ? lines : null;
}

function imageOf(nd) {
  const b = { type: 'image', src: hrefOf(nd).replace(/^#/, ''), alt: getAttr(nd, 'alt') || '', title: getAttr(nd, 'title') ? [clean(getAttr(nd, 'title'))] : [] };
  const id = getAttr(nd, 'id');
  if (id) b.id = id;
  return b;
}

function withId(b, nd) { const id = getAttr(nd, 'id'); if (id) b.id = id; return b; }

function boxOf(nd, type, ctx) {
  const authors = kids(nd, 'text-author').map((a) => inl(a, ctx)).filter((a) => a.length);
  const blocks = fbBlocks(kids(nd).filter((c) => ln(c) !== 'text-author'), ctx);
  return withId({ type, blocks, authors }, nd);
}

function poemOf(nd, ctx) {
  const b = { type: 'poem', title: null, epigraphs: [], stanzas: [], authors: [], date: '' };
  for (const c of kids(nd)) {
    const n = ln(c);
    if (n === 'title') b.title = titleLines(c, ctx);
    else if (n === 'epigraph') b.epigraphs.push(boxOf(c, 'epigraph', ctx));
    else if (n === 'stanza') {
      const st = { title: null, subtitle: [], lines: [] };
      for (const x of kids(c)) {
        const k = ln(x);
        if (k === 'title') st.title = titleLines(x, ctx);
        else if (k === 'subtitle') st.subtitle = inl(x, ctx);
        else if (k === 'v' || k === 'p') st.lines.push(inl(x, ctx));
      }
      b.stanzas.push(st);
    } else if (n === 'v') {
      // Verses without a stanza (malformed).
      const last = b.stanzas[b.stanzas.length - 1];
      if (last && last.loose) last.lines.push(inl(c, ctx)); else b.stanzas.push({ title: null, subtitle: [], lines: [inl(c, ctx)], loose: true });
    } else if (n === 'text-author') b.authors.push(inl(c, ctx));
    else if (n === 'date') b.date = clean(textContent(c));
  }
  for (const s of b.stanzas) delete s.loose;
  return withId(b, nd);
}

function tableOf(nd, ctx) {
  const rows = [];
  for (const tr of kids(nd, 'tr')) {
    const cells = kids(tr).filter((c) => ['td', 'th'].includes(ln(c))).map((c) => {
      const o = { c: inl(c, ctx) };
      if (ln(c) === 'th') o.header = true;
      const cs = +getAttr(c, 'colspan'), rs = +getAttr(c, 'rowspan');
      if (cs > 1) o.colspan = cs;
      if (rs > 1) o.rowspan = rs;
      const al = String(getAttr(c, 'align') || '').toLowerCase();
      if (['left', 'center', 'right', 'justify'].includes(al)) o.align = al;
      return o;
    });
    if (cells.length) rows.push({ cells });
  }
  return rows.length ? withId({ type: 'table', rows }, nd) : null;
}

function fbBlocks(nodes, ctx) {
  const out = [];
  for (const c of nodes) {
    if (c.type !== 'element') continue;
    const n = ln(c);
    switch (n) {
      case 'p': {
        const b = withId({ type: 'p', c: inl(c, ctx) }, c);
        const st = slug(getAttr(c, 'style') || '');
        if (st) b.style = st;
        out.push(b);
        break;
      }
      case 'subtitle': { const c2 = inl(c, ctx); out.push(withId(isScene(inlineText(c2)) ? { type: 'hr' } : { type: 'subtitle', c: c2 }, c)); break; }
      case 'empty-line': out.push({ type: 'empty' }); break;
      case 'image': out.push(imageOf(c)); break;
      case 'poem': out.push(poemOf(c, ctx)); break;
      case 'cite': case 'annotation': out.push(boxOf(c, 'cite', ctx)); break;
      case 'epigraph': out.push(boxOf(c, 'epigraph', ctx)); break;
      case 'table': { const t = tableOf(c, ctx); if (t) out.push(t); break; }
      case 'text-author': out.push({ type: 'p', c: inl(c, ctx), style: '' }); break;
      case 'title': { const ls = titleLines(c, ctx); if (ls) out.push({ type: 'subtitle', c: cleanInline(ls.flatMap((l, i) => (i ? [{ t: 'br' }, ...l] : l))) }); break; }
      case 'section': out.push(...fbBlocks(kids(c), ctx)); break;
      default: { const l = inl(c, ctx); if (!isEmptyInline(l)) out.push({ type: 'p', c: l }); }
    }
  }
  return mergeCode(out);
}

// Consecutive paragraphs that are entirely <code> (how code blocks are written to FB2) become one code block.
// FB2 has no code block: writers emit one <p><code> per line. Reading merges consecutive all-code paragraphs back
// into one code block; `merged` is a temporary marker so an explicit code block is not merged into by accident.
function mergeCode(blocks) {
  const out = [];
  const isCode = (b) => b.type === 'p' && !b.style && b.c.length === 1 && b.c[0] && b.c[0].t === 'code' && b.c[0].c.every((x) => typeof x === 'string');
  for (const b of blocks) {
    if (isCode(b)) {
      const text = b.c[0].c.join('');
      const last = out[out.length - 1];
      if (last && last.type === 'code' && last.merged) last.text += '\n' + text;
      else out.push({ type: 'code', text, merged: true, ...(b.id ? { id: b.id } : {}) });
    } else out.push(b);
  }
  for (const b of out) delete b.merged;
  return out;
}

// Only a title before any content counts as the section title; a later <title> is treated as content (a subtitle),
// so malformed files do not lose text.
function sectionOf(nd, ctx) {
  const sec = { id: getAttr(nd, 'id') || '', title: null, blocks: [], sections: [] };
  const content = [];
  for (const c of kids(nd)) {
    const n = ln(c);
    if (n === 'title' && !sec.title && !content.length && !sec.sections.length) sec.title = titleLines(c, ctx);
    else if (n === 'section') sec.sections.push(sectionOf(c, ctx));
    else content.push(c);
  }
  sec.blocks = fbBlocks(content, ctx);
  return sec;
}

// --- writing ------------------------------------------------------------------------------------------

const e = escapeXML;
const a = (name, v) => (v == null || v === '' ? '' : ` ${name}="${escapeXMLAttr(v)}"`);
// Binary and element ids must be XML NCNames (no colon, letter/_ first); model ids may not be, so images get
// sanitised ids (img-slug, '_' suffixes for collisions) and other ids are written only when valid and unique (idA).
const NCNAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// Element order follows the FB2 2.0 XSD sequence (title-info, document-info, publish-info, custom-info); strict
// validators and some readers reject out-of-order elements. Required elements get fallbacks (a default genre, an
// "Unknown" author) so the output always validates.
export function writeFB2(book, { program = 'in-html book processor', notesTitle = 'Notes', commentsTitle = 'Comments', now = new Date() } = {}) {
  const m = book.meta;
  // Binary ids must be NCNames.
  const imgIds = new Map();
  const taken = new Set();
  for (const id of Object.keys(book.images)) {
    let x = NCNAME.test(id) ? id : 'img-' + (slug(id) || 'x');
    while (taken.has(x)) x += '_';
    taken.add(x);
    imgIds.set(id, x);
  }
  const img = (id) => imgIds.get(id) || id;
  const ctx = { img, ids: new Set() };
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">`);
  if (book.styles.length) out.push(`<stylesheet type="text/css">${e(stylesCSS(book.styles))}</stylesheet>`);
  out.push('<description>');
  // title-info (schema order)
  out.push('<title-info>');
  const genres = m.genres.length ? m.genres : ['prose_contemporary'];
  for (const g of genres) out.push(`<genre>${e(g)}</genre>`);
  const authors = m.authors.length ? m.authors : [{ first: '', middle: '', last: '', nick: 'Unknown' }];
  for (const p of authors) out.push(personXML('author', p));
  out.push(`<book-title>${e(m.title || 'Untitled')}</book-title>`);
  if (m.annotation.length) out.push(`<annotation>${blocksXML(m.annotation, ctx, 'annotation')}</annotation>`);
  if (m.keywords) out.push(`<keywords>${e(m.keywords)}</keywords>`);
  if (m.date) out.push(`<date${/^\d{4}-\d{2}-\d{2}$/.test(m.date) ? a('value', m.date) : ''}>${e(m.date)}</date>`);
  if (m.cover && book.images[m.cover]) out.push(`<coverpage><image l:href="#${escapeXMLAttr(img(m.cover))}"/></coverpage>`);
  out.push(`<lang>${e(m.lang || 'en')}</lang>`);
  if (m.srcLang) out.push(`<src-lang>${e(m.srcLang)}</src-lang>`);
  for (const p of m.translators) out.push(personXML('translator', p));
  for (const s of m.series) out.push(`<sequence${a('name', s.name)}${/^\d+$/.test(s.number) ? a('number', s.number) : ''}/>`);
  out.push('</title-info>');
  // document-info
  out.push('<document-info>');
  const docAuthors = m.docAuthors.length ? m.docAuthors : authors;
  for (const p of docAuthors) out.push(personXML('author', p));
  out.push(`<program-used>${e(program)}</program-used>`);
  const iso = now.toISOString().slice(0, 10);
  out.push(`<date value="${iso}">${iso}</date>`);
  if (m.srcUrl) out.push(`<src-url>${e(m.srcUrl)}</src-url>`);
  if (m.srcOcr) out.push(`<src-ocr>${e(m.srcOcr)}</src-ocr>`);
  const id = (m.ids.find((x) => x.scheme === 'uuid' || x.scheme === 'fb2') || m.ids[0] || { value: uuid() }).value;
  out.push(`<id>${e(id)}</id>`);
  out.push(`<version>${e(/^\d+(\.\d+)?$/.test(m.docVersion) ? m.docVersion : '1.0')}</version>`);
  out.push('</document-info>');
  if (m.publisher || m.city || m.year || m.isbn) {
    out.push('<publish-info>');
    out.push(`<book-name>${e(m.title)}</book-name>`);
    if (m.publisher) out.push(`<publisher>${e(m.publisher)}</publisher>`);
    if (m.city) out.push(`<city>${e(m.city)}</city>`);
    if (m.year) out.push(`<year>${e(m.year)}</year>`);
    if (m.isbn) out.push(`<isbn>${e(m.isbn)}</isbn>`);
    out.push('</publish-info>');
  }
  // What FB2 has no element for travels in custom-info.
  if (m.subtitle) out.push(`<custom-info info-type="subtitle">${e(m.subtitle)}</custom-info>`);
  if (m.subjects.length) out.push(`<custom-info info-type="subjects">${e(m.subjects.join('; '))}</custom-info>`);
  if (m.rights) out.push(`<custom-info info-type="rights">${e(m.rights)}</custom-info>`);
  out.push('</description>');
  // main body
  out.push('<body>');
  const front = book.front.filter((b) => b.type === 'image').slice(0, 1);
  if (front.length) out.push(`<image l:href="#${escapeXMLAttr(img(front[0].src))}"/>`);
  if (book.title) out.push(titleXML(book.title, ctx));
  for (const b of book.front) if (b.type === 'epigraph') out.push(boxXML(b, 'epigraph', ctx));
  const restFront = book.front.filter((b) => b.type !== 'epigraph' && b !== front[0]);
  const sections = book.sections.length ? book.sections : [{ id: '', title: null, blocks: [], sections: [] }];
  sections.forEach((s, i) => out.push(sectionXML(i === 0 && restFront.length ? { ...s, blocks: [...restFront, ...s.blocks] } : s, ctx)));
  out.push('</body>');
  for (const kind of ['note', 'comment']) {
    const notes = book.notes.filter((n) => n.kind === kind);
    if (!notes.length) continue;
    out.push(`<body name="${kind === 'note' ? 'notes' : 'comments'}">`);
    out.push(`<title><p>${e(kind === 'note' ? notesTitle : commentsTitle)}</p></title>`);
    for (const n of notes) {
      const label = inlineXML(n.label, ctx) || e(n.id);
      out.push(`<section id="${escapeXMLAttr(n.id)}"><title><p>${label}</p></title>${blocksXML(n.blocks, ctx, 'section') || '<p/>'}</section>`);
    }
    out.push('</body>');
  }
  for (const [id, im] of Object.entries(book.images)) {
    out.push(`<binary id="${escapeXMLAttr(img(id))}" content-type="${escapeXMLAttr(im.type || 'image/jpeg')}">${wrap76(b64encode(im.data))}</binary>`);
  }
  out.push('</FictionBook>');
  return out.join('\n') + '\n';
}

// Base64 wrapped at 76 columns (MIME convention): some FB2 tools choke on multi-megabyte single lines.
const wrap76 = (s) => s.replace(/.{1,76}/g, (x) => x + '\n').replace(/\n$/, '');

// The schema requires first-name + last-name, or a nickname; empty elements fill the missing half.
function personXML(tag, p) {
  const parts = [];
  if (p.first) parts.push(`<first-name>${e(p.first)}</first-name>`);
  if (p.middle) parts.push(`<middle-name>${e(p.middle)}</middle-name>`);
  if (p.last) parts.push(`<last-name>${e(p.last)}</last-name>`);
  if (p.nick || (!p.first && !p.last)) parts.push(`<nickname>${e(p.nick || 'Unknown')}</nickname>`);
  // The schema wants first-name + last-name or a nickname.
  if (p.first && !p.last && !p.nick) parts.push('<last-name/>');
  if (!p.first && p.last) parts.unshift('<first-name/>');
  return `<${tag}>${parts.join('')}</${tag}>`;
}

function inlineXML(inl, ctx) {
  let s = '';
  for (const x of inl || []) {
    if (typeof x === 'string') { s += e(x); continue; }
    switch (x && x.t) {
      case 'em': s += `<emphasis>${inlineXML(x.c, ctx)}</emphasis>`; break;
      case 'strong': s += `<strong>${inlineXML(x.c, ctx)}</strong>`; break;
      case 'strike': s += `<strikethrough>${inlineXML(x.c, ctx)}</strikethrough>`; break;
      case 'sub': s += `<sub>${inlineXML(x.c, ctx)}</sub>`; break;
      case 'sup': s += `<sup>${inlineXML(x.c, ctx)}</sup>`; break;
      case 'code': s += `<code>${inlineXML(x.c, ctx)}</code>`; break;
      case 'style': s += `<style name="${escapeXMLAttr(x.name)}">${inlineXML(x.c, ctx)}</style>`; break;
      case 'a': s += /^(#|https?:|mailto:)/i.test(x.href) ? `<a l:href="${escapeXMLAttr(x.href)}">${inlineXML(x.c, ctx)}</a>` : inlineXML(x.c, ctx); break;
      case 'note': s += `<a l:href="#${escapeXMLAttr(x.ref)}" type="note">${inlineXML(x.c, ctx)}</a>`; break;
      case 'img': s += `<image l:href="#${escapeXMLAttr(ctx.img(x.src))}"/>`; break;
      // Inside one FB2 paragraph a line break can only become a space; pXML splits at <br> beforehand where possible.
      case 'br': s += ' '; break;
      default: if (x && x.c) s += inlineXML(x.c, ctx);
    }
  }
  return s;
}

// Inline content split at line breaks (FB2 paragraphs have none).
function splitBr(inl) {
  const lines = [[]];
  for (const x of inl || []) { if (x && x.t === 'br') lines.push([]); else lines[lines.length - 1].push(x); }
  return lines;
}
const idA = (b, ctx) => (b.id && !ctx.ids.has(b.id) && NCNAME.test(b.id) ? (ctx.ids.add(b.id), a('id', b.id)) : '');

function pXML(inl, ctx, attrs = '', tag = 'p') {
  return splitBr(inl).map((l, i) => `<${tag}${i ? '' : attrs}>${inlineXML(l, ctx)}</${tag}>`).join('');
}

function titleXML(lines, ctx) {
  return `<title>${lines.map((l) => pXML(l, ctx)).join('')}</title>`;
}

// where: 'section' | 'cite' | 'epigraph' | 'annotation' | 'cell' — what FB2 allows there decides the mapping.
// Note: in the 'epigraph' case below every branch yields a cite (ctx.atStart is always false here, because
// sectionXML emits the leading epigraphs itself), and `where === 'annotation' && false` in the 'cite' case is dead
// code. Both are harmless leftovers of earlier placement rules.
// Lists have no FB2 equivalent: items become paragraphs prefixed with a number or a bullet (lossy, readable).
function blocksXML(blocks, ctx, where) {
  const out = [];
  blocks.forEach((b, i) => {
    switch (b.type) {
      case 'p': out.push(pXML(b.c, ctx, idA(b, ctx) + (b.style ? a('style', b.style) : ''))); break;
      case 'subtitle': out.push(where === 'epigraph' ? pXML([{ t: 'strong', c: b.c }], ctx, idA(b, ctx)) : pXML(b.c, ctx, idA(b, ctx), 'subtitle')); break;
      case 'empty': out.push('<empty-line/>'); break;
      case 'hr': out.push(where === 'epigraph' ? '<p>* * *</p>' : '<subtitle>* * *</subtitle>'); break;
      case 'code': out.push(b.text.split('\n').map((l, k) => `<p${k ? '' : idA(b, ctx)}><code>${e(l || ' ')}</code></p>`).join('')); break;
      case 'image': {
        const tag = `<image l:href="#${escapeXMLAttr(ctx.img(b.src))}"${a('alt', b.alt)}${b.title && b.title.length ? a('title', inlineText(b.title)) : ''}${where === 'section' ? idA(b, ctx) : ''}/>`;
        out.push(where === 'section' ? tag : `<p>${tag}</p>`);
        break;
      }
      case 'epigraph':
        // Epigraphs belong right after a title; elsewhere they are citations.
        out.push(where === 'section' && blocks.slice(0, i).every((x) => x.type === 'epigraph') && ctx.atStart ? boxXML(b, 'epigraph', ctx) : where === 'epigraph' ? boxXML(b, 'cite', ctx) : boxXML(b, 'cite', ctx));
        break;
      case 'cite': out.push(where === 'cite' || where === 'annotation' && false ? blocksXML(b.blocks, ctx, where) : boxXML(b, 'cite', ctx)); break;
      case 'poem': out.push(poemXML(b, ctx)); break;
      case 'table': out.push(where === 'epigraph' ? b.rows.map((r) => `<p>${r.cells.map((c) => inlineXML(c.c, ctx)).join(' | ')}</p>`).join('') : tableXML(b, ctx)); break;
      case 'list': b.items.forEach((it, k) => {
        const marker = b.ordered ? `${k + 1}. ` : '• ';
        it.forEach((x, j) => {
          if (x.type === 'p' && j === 0) out.push(pXML([marker, ...x.c], ctx, k === 0 ? idA(b, ctx) : ''));
          else out.push(blocksXML([x], ctx, where));
        });
      });
        break;
      default: break;
    }
  });
  return out.join('');
}

function boxXML(b, tag, ctx) {
  // A citation inside a citation is not allowed: its blocks are inlined.
  const inner = blocksXML(b.blocks.flatMap((x) => (x.type === 'cite' || x.type === 'epigraph' ? x.blocks : [x])), { ...ctx, atStart: false }, tag);
  const authors = b.authors.map((x) => `<text-author>${inlineXML(x, ctx)}</text-author>`).join('');
  return `<${tag}${idA(b, ctx)}>${inner || (authors ? '' : '<empty-line/>')}${authors}</${tag}>`;
}

function poemXML(b, ctx) {
  const parts = [];
  if (b.title) parts.push(titleXML(b.title, ctx));
  for (const ep of b.epigraphs) parts.push(boxXML(ep, 'epigraph', ctx));
  for (const s of b.stanzas) {
    const sp = [];
    if (s.title) sp.push(titleXML(s.title, ctx));
    if (s.subtitle && s.subtitle.length) sp.push(`<subtitle>${inlineXML(s.subtitle, ctx)}</subtitle>`);
    const lines = s.lines.flatMap((l) => splitBr(l));
    for (const l of lines.length ? lines : [[]]) sp.push(`<v>${inlineXML(l, ctx)}</v>`);
    parts.push(`<stanza>${sp.join('')}</stanza>`);
  }
  for (const x of b.authors) parts.push(`<text-author>${inlineXML(x, ctx)}</text-author>`);
  if (b.date) parts.push(`<date>${e(b.date)}</date>`);
  return `<poem${idA(b, ctx)}>${parts.join('')}</poem>`;
}

function tableXML(b, ctx) {
  const rows = b.rows.map((r) => '<tr>' + r.cells.map((c) => {
    const tag = c.header ? 'th' : 'td';
    return `<${tag}${c.colspan > 1 ? a('colspan', c.colspan) : ''}${c.rowspan > 1 ? a('rowspan', c.rowspan) : ''}${c.align ? a('align', c.align) : ''}>${inlineXML(c.c, ctx)}</${tag}>`;
  }).join('') + '</tr>');
  return `<table${idA(b, ctx)}>${rows.join('')}</table>`;
}

// FB2 sections contain either subsections or content, never both: leading content before subsections is wrapped
// in an untitled first subsection. An empty section gets <empty-line/> because the schema forbids empty sections.
function sectionXML(s, ctx) {
  const parts = [];
  if (s.title) parts.push(titleXML(s.title, ctx));
  const sctx = { ...ctx, atStart: true };
  // Leading epigraphs keep their place; the rest of the content is section content.
  let i = 0;
  while (i < s.blocks.length && s.blocks[i].type === 'epigraph') parts.push(boxXML(s.blocks[i++], 'epigraph', ctx));
  const rest = s.blocks.slice(i);
  if (s.sections.length) {
    // FB2 sections hold either subsections or content: leading content becomes an untitled first subsection.
    if (rest.length) parts.push(`<section>${blocksXML(rest, { ...sctx, atStart: false }, 'section')}</section>`);
    for (const sub of s.sections) parts.push(sectionXML(sub, ctx));
  } else {
    const body = blocksXML(rest, { ...sctx, atStart: false }, 'section');
    parts.push(body || '<empty-line/>');
  }
  const id = s.id && NCNAME.test(s.id) && !ctx.ids.has(s.id) ? (ctx.ids.add(s.id), a('id', s.id)) : '';
  return `<section${id}>\n${parts.join('\n')}\n</section>`;
}

export { blockText };
