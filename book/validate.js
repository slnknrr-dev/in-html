// book/validate.js - checks: the book itself (what a reader or a format will miss), and the structure of written
// EPUB and FB2 files (strict XML well-formedness through xml/xml.js, package / manifest / spine / navigation
// consistency, links, required FB2 elements). Results are codes with arguments; CHECK_TEXT has English texts.
//
//   validateBook(book) -> [{ level: 'error' | 'warn' | 'info', code, args, target: { kind: 'section' | 'note' | 'image' | 'meta', id } }]
//   checkEpub(bytes) -> Promise<{ ok, errors: [{ code, args }], warnings: [{ code, args }], files, version }>
//   checkFB2(text) -> { ok, errors, warnings }
//   checkText(issue) -> English sentence

import { parseXML, root as xmlRoot, children as xmlChildren, child as xmlChild, attr as xmlAttr, local, textOf, walkXML } from '../xml/xml.js';
import { readZip } from '../zip/zip.js';
import { blockInlines, collectIds, inlineText, isEmptyInline, walkBlocks, walkSections } from './model.js';

//
// Two different jobs. validateBook lints the model (what an author should fix: missing metadata, broken links,
// unused notes); checkEpub / checkFB2 verify written files structurally, so writer regressions are caught by tests
// without an external epubcheck (Java) run. Results are codes + args, not sentences: the UI localises them;
// CHECK_TEXT is only the English fallback.
// LANG_RE: a pragmatic BCP 47 shape (2-3 letter primary subtag + subtags), not full registry validation.
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

// Levels: error = a reader or format will break or lose content; warn = probably wrong; info = could be better.
// Sorted by level so the UI shows blocking issues first.
export function validateBook(book) {
  const out = [];
  const add = (level, code, args = {}, target = null) => out.push({ level, code, args, target });
  const m = book.meta;
  if (!m.title) add('error', 'noTitle', {}, { kind: 'meta', id: 'title' });
  if (!m.authors.length) add('warn', 'noAuthor', {}, { kind: 'meta', id: 'authors' });
  if (!m.lang) add('error', 'noLang', {}, { kind: 'meta', id: 'lang' });
  else if (!LANG_RE.test(m.lang)) add('warn', 'badLang', { lang: m.lang }, { kind: 'meta', id: 'lang' });
  if (!m.cover) add('info', 'noCover', {}, { kind: 'meta', id: 'cover' });
  else if (!/^image\/(jpeg|png)$/.test((book.images[m.cover] || {}).type || '')) add('warn', 'coverType', { type: (book.images[m.cover] || {}).type || '?' }, { kind: 'meta', id: 'cover' });
  if (!m.genres.length) add('info', 'noGenre', {}, { kind: 'meta', id: 'genres' });
  if (!m.annotation.length) add('info', 'noAnnotation', {}, { kind: 'meta', id: 'annotation' });
  if (!book.sections.length) add('error', 'empty');
  walkSections(book.sections, (s, depth) => {
    if (!s.blocks.length && !s.sections.length) add('warn', 'emptySection', { title: s.title ? inlineText(s.title[0]) : '' }, { kind: 'section', id: s.id });
    else if (!s.title && depth === 0 && book.sections.length > 1) add('info', 'untitledSection', {}, { kind: 'section', id: s.id });
  });
  // References: links, notes, images, styles.
  const ids = collectIds(book);
  const noteIds = new Set(book.notes.map((n) => n.id));
  const usedNotes = new Set();
  const usedImages = new Set();
  const styles = new Set(book.styles.map((s) => s.id));
  if (m.cover) usedImages.add(m.cover);
  const seenStyles = new Set();
  // Each undefined style is reported once (seenStyles), not at every use: a missing style used 500 times is one issue.
  const checkInline = (inl, owner) => {
    for (const x of inl || []) {
      if (!x || typeof x !== 'object') continue;
      if (x.t === 'note') { if (!noteIds.has(x.ref)) add('error', 'missingNote', { ref: x.ref }, owner); usedNotes.add(x.ref); }
      else if (x.t === 'img') { if (!book.images[x.src]) add('error', 'missingImage', { src: x.src }, owner); usedImages.add(x.src); }
      else if (x.t === 'a' && x.href.startsWith('#') && !ids.has(x.href.slice(1))) add('warn', 'brokenLink', { href: x.href }, owner);
      else if (x.t === 'style' && !styles.has(x.name) && !seenStyles.has(x.name)) { seenStyles.add(x.name); add('warn', 'styleMissing', { name: x.name }, owner); }
      if (x.c) checkInline(x.c, owner);
    }
  };
  const ownerOf = (o) => (o && typeof o === 'object' && o.id ? { kind: book.notes.includes(o) ? 'note' : 'section', id: o.id } : { kind: 'meta', id: String(o || '') });
  walkBlocks(book, (b, owner) => {
    const own = ownerOf(owner);
    if (b.type === 'image') { if (!book.images[b.src]) add('error', 'missingImage', { src: b.src }, own); usedImages.add(b.src); }
    if (b.style && !styles.has(b.style) && !seenStyles.has(b.style)) { seenStyles.add(b.style); add('warn', 'styleMissing', { name: b.style }, own); }
    for (const inl of blockInlines({ ...b, blocks: null, epigraphs: null, items: null })) checkInline(inl, own);
  });
  walkSections(book.sections, (s) => { for (const l of s.title || []) checkInline(l, { kind: 'section', id: s.id }); });
  for (const l of book.title || []) checkInline(l, { kind: 'meta', id: 'title' });
  for (const n of book.notes) {
    if (!usedNotes.has(n.id)) add('warn', 'unusedNote', { label: inlineText(n.label) }, { kind: 'note', id: n.id });
    if (!n.blocks.some((b) => b.type !== 'p' || !isEmptyInline(b.c))) add('warn', 'emptyNote', { label: inlineText(n.label) }, { kind: 'note', id: n.id });
  }
  for (const [id, im] of Object.entries(book.images)) {
    if (!usedImages.has(id)) add('info', 'unusedImage', { id }, { kind: 'image', id });
    if (!/^image\/(jpeg|png)$/.test(im.type)) add('warn', 'imageType', { id, type: im.type }, { kind: 'image', id });
    if (im.data.length > 2 * 1024 * 1024) add('info', 'bigImage', { id, size: Math.round(im.data.length / 1024) }, { kind: 'image', id });
  }
  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// --- EPUB ---------------------------------------------------------------------------------------------

const MEDIA = { xhtml: 'application/xhtml+xml', html: 'application/xhtml+xml', css: 'text/css', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ncx: 'application/x-dtbncx+xml', opf: 'application/oebps-package+xml', otf: 'font/otf', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2' };
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
// Resolves a manifest href relative to the OPF directory: percent-decoding first (hrefs are URLs, zip names are
// not), then '.'/'..' segments. '..' above the root is silently clamped, which also neutralises path traversal.
function resolve(base, rel) {
  let r = String(rel);
  try { r = decodeURIComponent(r); } catch { /* keep */ }
  const out = [];
  for (const p of (dirOf(base) + r).split('/')) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
  return out.join('/');
}

export async function checkEpub(bytes) {
  const errors = [], warnings = [];
  const err = (code, args = {}) => errors.push({ code, args });
  const warn = (code, args = {}) => warnings.push({ code, args });
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const res = () => ({ ok: !errors.length, errors, warnings, files: 0, version: '' });
  // Read from the raw local header, not through readZip: the OCF rule is about physical layout (first entry, method
  // 0 = stored, so the bytes "mimetypeapplication/epub+zip" appear at offset 30 for magic-number sniffing).
  // mimetype: first entry, stored, no extra field, exact content.
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 30 || dv.getUint32(0, true) !== 0x04034b50) { err('zip'); return res(); }
  const nameLen = dv.getUint16(26, true), extraLen = dv.getUint16(28, true);
  const firstName = new TextDecoder().decode(b.subarray(30, 30 + nameLen));
  if (firstName !== 'mimetype') err('mimetypeFirst');
  else {
    if (dv.getUint16(8, true) !== 0) err('mimetypeStored');
    if (extraLen) warn('mimetypeExtra');
    const content = new TextDecoder().decode(b.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + dv.getUint32(18, true)));
    if (content !== 'application/epub+zip') err('mimetypeValue', { value: content });
  }
  let entries;
  try { entries = readZip(b); } catch (e) { err('zip', { msg: e.message }); return res(); }
  const files = new Map(entries.filter((e) => !e.dir).map((e) => [e.name, e]));
  const read = async (p) => new TextDecoder().decode(await files.get(p).data());
  const xml = async (p) => {
    try { return parseXML(await read(p), { trim: false }); } catch (e) { err('xmlParse', { href: p, msg: e.message }); return null; }
  };
  if (!files.has('META-INF/container.xml')) { err('container'); return res(); }
  const container = await xml('META-INF/container.xml');
  let opfPath = null;
  if (container) walkXML(container, (nd) => { if (local(nd.name) === 'rootfile' && !opfPath) opfPath = xmlAttr(nd, 'full-path'); });
  if (!opfPath || !files.has(opfPath)) { err('rootfile', { href: opfPath || '' }); return res(); }
  const opfDoc = await xml(opfPath);
  if (!opfDoc) return res();
  const pkg = xmlRoot(opfDoc);
  const version = xmlAttr(pkg, 'version') || '';
  const v3 = version.startsWith('3');
  if (!/^[23]\.\d/.test(version)) err('opfVersion', { version });
  const md = xmlChildren(pkg).find((c) => local(c.name) === 'metadata');
  const metaEls = md ? xmlChildren(md) : [];
  const dc = (n) => metaEls.filter((c) => c.name === 'dc:' + n || local(c.name) === n && c.name.startsWith('dc'));
  for (const n of ['identifier', 'title', 'language']) if (!dc(n).some((x) => textOf(x).trim())) err('metaMissing', { name: 'dc:' + n });
  const uidRef = xmlAttr(pkg, 'unique-identifier');
  if (!uidRef || !dc('identifier').some((x) => xmlAttr(x, 'id') === uidRef)) err('uidMismatch', { id: uidRef || '' });
  // EPUB 3 requires dcterms:modified in exactly CCYY-MM-DDThh:mm:ssZ (no milliseconds): reading systems use it with
  // the identifier as the release identifier.
  if (v3 && !metaEls.some((c) => local(c.name) === 'meta' && xmlAttr(c, 'property') === 'dcterms:modified' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(textOf(c).trim()))) err('modifiedMissing');
  // Manifest.
  const manifestEl = xmlChildren(pkg).find((c) => local(c.name) === 'manifest');
  const items = new Map();
  const byHref = new Map();
  for (const it of manifestEl ? xmlChildren(manifestEl).filter((c) => local(c.name) === 'item') : []) {
    const id = xmlAttr(it, 'id'), href = xmlAttr(it, 'href'), type = xmlAttr(it, 'media-type');
    if (!id || !href || !type) { err('manifestItem', { id: id || '', href: href || '' }); continue; }
    if (items.has(id)) err('manifestDup', { id });
    const path = resolve(opfPath, href);
    const item = { id, href, path, type, props: String(xmlAttr(it, 'properties') || '').split(/\s+/).filter(Boolean) };
    items.set(id, item);
    byHref.set(path, item);
    if (!files.has(path)) err('manifestMissing', { href: path });
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (MEDIA[ext] && MEDIA[ext] !== type) warn('mediaType', { href: path, type });
  }
  // Files not in the manifest are warnings, not errors: harmless for reading, but epubcheck reports them.
  for (const name of files.keys()) {
    if (name === 'mimetype' || name.startsWith('META-INF/') || name === opfPath) continue;
    if (!byHref.has(name)) warn('fileNotInManifest', { name });
  }
  // Spine.
  const spineEl = xmlChildren(pkg).find((c) => local(c.name) === 'spine');
  const refs = spineEl ? xmlChildren(spineEl).filter((c) => local(c.name) === 'itemref') : [];
  if (!refs.length) err('spineEmpty');
  for (const r of refs) {
    const it = items.get(xmlAttr(r, 'idref'));
    if (!it) err('spineRef', { id: xmlAttr(r, 'idref') || '' });
    else if (!/xhtml|html|svg/.test(it.type)) err('spineType', { id: it.id, type: it.type });
  }
  const tocId = spineEl && xmlAttr(spineEl, 'toc');
  if (tocId && !items.has(tocId)) err('ncxMissing', { id: tocId });
  if (!v3 && !tocId) err('ncxMissing', { id: '' });
  // Navigation document (EPUB 3).
  const nav = [...items.values()].filter((x) => x.props.includes('nav'));
  if (v3) {
    if (nav.length !== 1) err('navMissing');
    else if (files.has(nav[0].path)) {
      const d = await xml(nav[0].path);
      let toc = false;
      if (d) walkXML(d, (nd) => { if (local(nd.name) === 'nav' && /\btoc\b/.test(String(xmlAttr(nd, 'epub:type') || ''))) toc = true; });
      if (d && !toc) err('navToc');
    }
    const covers = [...items.values()].filter((x) => x.props.includes('cover-image'));
    if (covers.length > 1) err('coverImage');
    for (const c of covers) if (!c.type.startsWith('image/')) err('coverImage');
  }
  // Two passes: first collect ids of every document, then check links, so a link to an id in a later file resolves.
  // External schemes (http:, mailto:) are skipped by the scheme regex; remote resources get a warning because EPUB 3
  // requires them to be declared (remote-resources property) and offline reading breaks.
  // Content documents: well-formed XML, links and images resolve.
  const docs = [...items.values()].filter((x) => x.type === 'application/xhtml+xml' && files.has(x.path));
  const idsOf = new Map();
  const parsed = new Map();
  for (const it of docs) {
    const d = await xml(it.path);
    if (!d) continue;
    parsed.set(it.path, d);
    const ids = new Set();
    walkXML(d, (nd) => { const id = xmlAttr(nd, 'id'); if (id) { if (ids.has(id)) warn('dupId', { href: it.path, id }); ids.add(id); } });
    idsOf.set(it.path, ids);
    const h = xmlRoot(d);
    if (!h || local(h.name) !== 'html') err('xhtmlRoot', { href: it.path });
  }
  for (const [path, d] of parsed) {
    walkXML(d, (nd) => {
      const n = local(nd.name);
      const href = n === 'a' ? xmlAttr(nd, 'href') : null;
      const src = n === 'img' ? xmlAttr(nd, 'src') : n === 'link' ? xmlAttr(nd, 'href') : n === 'image' ? (xmlAttr(nd, 'xlink:href') || xmlAttr(nd, 'href')) : null;
      if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        const i = href.indexOf('#');
        const p = i < 0 ? href : href.slice(0, i), frag = i < 0 ? '' : href.slice(i + 1);
        const target = p ? resolve(path, p) : path;
        if (!byHref.has(target)) err('linkBroken', { href: path, target: href });
        else if (frag && idsOf.has(target) && !idsOf.get(target).has(frag)) err('linkBroken', { href: path, target: href });
      }
      if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !byHref.has(resolve(path, src))) err('resourceMissing', { href: path, target: src });
      if (src && /^https?:/i.test(src)) warn('remoteResource', { href: path, target: src });
    });
  }
  return { ok: !errors.length, errors, warnings, files: files.size, version };
}

// --- FB2 ----------------------------------------------------------------------------------------------

// Strict parse here (parseXML), unlike readFB2: this checks what writeFB2 produced, which must be well-formed.
// Notes: a broken link with type="note" is an error (a reader shows an empty popup), a plain broken link a warning.
export function checkFB2(text) {
  const errors = [], warnings = [];
  const err = (code, args = {}) => errors.push({ code, args });
  const warn = (code, args = {}) => warnings.push({ code, args });
  let doc;
  try { doc = parseXML(text, { trim: false }); } catch (e) { err('xmlParse', { msg: e.message }); return { ok: false, errors, warnings }; }
  const fb = xmlRoot(doc);
  if (!fb || local(fb.name) !== 'FictionBook') { err('root'); return { ok: false, errors, warnings }; }
  if (xmlAttr(fb, 'xmlns') !== 'http://www.gribuser.ru/xml/fictionbook/2.0') warn('ns');
  const desc = xmlChild(fb, 'description');
  if (!desc) { err('description'); return { ok: false, errors, warnings }; }
  const ti = xmlChild(desc, 'title-info');
  if (!ti) err('titleInfo');
  else {
    if (!xmlChildren(ti, 'genre').length) err('genre');
    if (!xmlChildren(ti, 'author').length) err('author');
    if (!textOf(xmlChild(ti, 'book-title')).trim()) err('bookTitle');
    if (!textOf(xmlChild(ti, 'lang')).trim()) err('lang');
  }
  const di = xmlChild(desc, 'document-info');
  if (!di) err('documentInfo');
  else {
    if (!xmlChildren(di, 'author').length) err('docAuthor');
    if (!xmlChild(di, 'date')) err('docDate');
    if (!textOf(xmlChild(di, 'id')).trim()) err('docId');
    if (!textOf(xmlChild(di, 'version')).trim()) err('docVersion');
  }
  if (!xmlChildren(fb, 'body').length) err('body');
  // ids, binaries, references.
  const ids = new Set();
  walkXML(fb, (nd) => { const id = xmlAttr(nd, 'id'); if (id) { if (ids.has(id)) err('dupId', { id }); ids.add(id); } });
  const binaries = new Map(xmlChildren(fb, 'binary').map((b) => [xmlAttr(b, 'id'), xmlAttr(b, 'content-type')]));
  for (const [id, type] of binaries) if (!/^image\/(jpeg|png)$/.test(type || '')) warn('binaryType', { id, type: type || '' });
  walkXML(fb, (nd) => {
    const n = local(nd.name);
    const href = xmlAttr(nd, 'l:href') || xmlAttr(nd, 'xlink:href');
    if (n === 'image' && href) { if (!href.startsWith('#') || !binaries.has(href.slice(1))) err('binaryRef', { id: href }); }
    if (n === 'a' && href && href.startsWith('#') && !ids.has(href.slice(1))) (xmlAttr(nd, 'type') === 'note' ? err : warn)('noteRef', { id: href });
    if (n === 'section') {
      const kidsN = xmlChildren(nd).map((c) => local(c.name));
      if (kidsN.includes('section') && kidsN.some((k) => ['p', 'poem', 'cite', 'subtitle', 'empty-line', 'table'].includes(k))) warn('sectionMixed');
    }
  });
  return { ok: !errors.length, errors, warnings };
}

export const CHECK_TEXT = {
  noTitle: 'The book has no title.', noAuthor: 'No author is given.', noLang: 'The language is missing.', badLang: 'The language code “{lang}” is not a valid BCP 47 tag.',
  noCover: 'The book has no cover.', coverType: 'The cover is {type}; FB2 readers and many EPUB readers expect JPEG or PNG.', noGenre: 'No FB2 genre is set (a default one is written).',
  noAnnotation: 'The book has no annotation.', empty: 'The book has no sections.', emptySection: 'Section “{title}” is empty.', untitledSection: 'A top-level section has no title.',
  missingNote: 'A note reference points to a missing note ({ref}).', missingImage: 'An image is missing ({src}).', brokenLink: 'A link points nowhere ({href}).',
  styleMissing: 'The style “{name}” is used but not defined.', unusedNote: 'Note {label} is never referenced.', emptyNote: 'Note {label} is empty.',
  unusedImage: 'Image {id} is not used.', imageType: 'Image {id} is {type}; JPEG or PNG are the safest.', bigImage: 'Image {id} is large ({size} KB).',
  zip: 'Not a ZIP archive.', mimetypeFirst: 'The mimetype file must be the first entry.', mimetypeStored: 'The mimetype file must be stored without compression.',
  mimetypeExtra: 'The mimetype entry has an extra field.', mimetypeValue: 'The mimetype file must contain application/epub+zip.', container: 'META-INF/container.xml is missing.',
  rootfile: 'The package document named in container.xml is missing ({href}).', xmlParse: '{href} is not well-formed XML: {msg}', opfVersion: 'Unknown package version {version}.',
  metaMissing: 'Required metadata {name} is missing.', uidMismatch: 'The unique identifier ({id}) does not match a dc:identifier.', modifiedMissing: 'EPUB 3 needs a dcterms:modified date (CCYY-MM-DDThh:mm:ssZ).',
  manifestItem: 'A manifest item lacks id, href or media type.', manifestDup: 'Duplicate manifest id {id}.', manifestMissing: 'A manifest item is missing from the archive ({href}).',
  mediaType: '{href} is declared as {type}.', fileNotInManifest: '{name} is not listed in the manifest.', spineEmpty: 'The spine is empty.', spineRef: 'The spine refers to a missing item ({id}).',
  spineType: 'Spine item {id} is not a content document ({type}).', ncxMissing: 'The NCX table of contents is missing.', navMissing: 'EPUB 3 needs exactly one navigation document.',
  navToc: 'The navigation document has no toc nav.', coverImage: 'The cover-image property is wrong.', dupId: 'Duplicate id {id} in {href}.', xhtmlRoot: '{href} has no html root element.',
  linkBroken: 'Broken link in {href}: {target}.', resourceMissing: 'Missing resource in {href}: {target}.', remoteResource: 'Remote resource in {href}: {target}.',
  root: 'The root element is not FictionBook.', ns: 'The FictionBook namespace is missing or wrong.', description: '<description> is missing.', titleInfo: '<title-info> is missing.',
  genre: 'At least one <genre> is required.', author: 'At least one <author> is required.', bookTitle: '<book-title> is empty.', lang: '<lang> is missing.', documentInfo: '<document-info> is missing.',
  docAuthor: 'The document info needs an author.', docDate: 'The document info needs a date.', docId: 'The document info needs an id.', docVersion: 'The document info needs a version.',
  body: 'The book has no <body>.', binaryRef: 'An image refers to a missing binary ({id}).', noteRef: 'A link refers to a missing id ({id}).', binaryType: 'Binary {id} is {type}.',
  sectionMixed: 'A section mixes subsections and content.',
};
// {name} placeholders are replaced by args; unknown placeholders stay visible rather than turning into "undefined".
export function checkText(issue) {
  const s = CHECK_TEXT[issue.code] || issue.code;
  return s.replace(/\{(\w+)\}/g, (m, k) => (issue.args && issue.args[k] != null ? String(issue.args[k]) : m));
}
