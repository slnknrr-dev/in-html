// studio/doc.js - document helpers of the editor: block registry lookups, tree walking and list paths, field access,
// block / item labels, link targets and anchors, rich-text paths, translation traversal and completeness.
//
// Document model in one paragraph: doc.regions = { <region>: [block] } in the product's region order; a block is
// { id, type, ...props }; container blocks hold child lists declared by the registry (def.lists, with 'a.*.b' for
// lists inside list items such as columns). A list is addressed by a string path: 'regions.<r>' or
// '<ownerBlockId>:<prop>[.<i>.<prop>]'. Paths, not object references, because they survive JSON snapshots (history
// restores a fresh tree) and can be stored in DOM attributes (data-list) for drag and drop.
// Translatable text is an I18n object { <lang>: string } at any depth.
// Performance: lookups are linear walks (findBlock is O(blocks)), no id index. Deliberate: documents are hundreds of
// blocks, and an index would have to be rebuilt after every snapshot restore and every mutate(); a stale index is
// a correctness bug, a walk is merely microseconds.
import { getPath, own } from '../util/value.js';
import { uid } from '../util/id.js';
import { BLOCK_TYPES, ICONS, P } from '../doc/product.js';
import { isEmptyText, pickText } from '../i18n/text.js';
import { clone, esc, h, htmlText, isObj } from '../ui/dom.js';
import { LANG_RE } from '../ui/lang.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { ED } from './config.js';
import { S } from './state.js';
import { sanitizeHTML } from '../richtext/sanitize.js';

// Viewer icon (V.ICONS entry) as SVG markup — handles full SVG strings, path data or {svg|d|path} objects.
function viewerIcon(key) {
  const v = own(ICONS, key) ?? null;
  if (!v) return '';
  let s = v;
  if (isObj(v)) s = v.svg || v.d || v.path || '';
  s = String(s).trim();
  if (s.startsWith('<svg')) return s;
  // Viewer icons are 24×24 stroke paths (fill:none; stroke:currentColor).
  const open = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
  if (s.startsWith('<')) return `${open}${s}</svg>`;
  return `${open}<path d="${esc(s)}"/></svg>`;
}

// Icon of a block type: the editor icon the product maps it to (ED.typeIcons), else the registry's viewer icon.
function typeIcon(type) {
  const k = own(ED.typeIcons, type);
  if (k) return icon(k);
  const vk = own(BLOCK_TYPES, type)?.icon;
  return (typeof vk === 'string' && viewerIcon(vk)) || icon('file');
}
const typeIconEl = (type) => h('span', { class: 'ed-ic', html: typeIcon(type) });

// ===========================================================================
// 5. Document helpers
// ===========================================================================

// Page regions of the product in document order ('header', 'main', …).
const regions = () => P.regions;
// Region of a top-level list path ('regions.footer' → 'footer'), else null.
const regionOf = (listPath) => (listPath && listPath.startsWith('regions.') ? listPath.slice(8) : null);

function typeDef(type) { return own(BLOCK_TYPES, type) || {}; }

// The list that receives blocks meant for the main region: 'regions.main', or the edited page of a multi-page
// product (ED.mainList).
function mainPath() {
  const p = ED.mainList ? ED.mainList() : '';
  return typeof p === 'string' && p ? p : 'regions.main';
}

// A container whose children form the top level of a page (registry flag `transparent`): its list counts as a region.
const isTransparent = (b) => !!(b && typeDef(b.type).transparent);

// Call fn(childList, listPath) for every child block list of a container block.
// The only place that knows how child lists are laid out; walk, getList and drag targets all derive from it.
function eachChildList(block, fn) {
  const def = typeDef(block.type);
  if (!def.container) return;
  for (const lp of def.lists || []) {
    if (lp.includes('.*.')) {
      const [a, b] = lp.split('.*.');
      (block[a] || []).forEach((c, i) => { if (c && Array.isArray(c[b])) fn(c[b], `${block.id}:${a}.${i}.${b}`); });
    } else if (Array.isArray(block[lp])) fn(block[lp], `${block.id}:${lp}`);
  }
}

// Depth-first walk over every block: fn(block, list, index, parent, listPath) → return true to stop.
function walk(fn, doc = S.doc) {
  let stop = false;
  const rec = (list, lp, parent) => {
    for (let i = 0; i < list.length && !stop; i++) {
      const b = list[i];
      if (!b) continue;
      if (fn(b, list, i, parent, lp) === true) { stop = true; return; }
      eachChildList(b, (l, p) => { if (!stop) rec(l, p, b); });
    }
  };
  for (const r of regions()) { if (stop) break; rec((doc.regions && doc.regions[r]) || [], 'regions.' + r, null); }
}

function findBlock(id, doc = S.doc) {
  if (!id || !doc) return null;
  let out = null;
  walk((block, list, index, parent, listPath) => {
    if (block.id === id) { out = { block, list, index, parent, listPath }; return true; }
    return false;
  }, doc);
  return out;
}

// Resolves a list path; creates a missing region array (a region newly added by a product version must accept
// drops into an older document). Unknown region names are refused, never created: paths may come from the DOM.
function getList(listPath, doc = S.doc) {
  if (!listPath) return null;
  if (listPath.startsWith('regions.')) {
    const r = listPath.slice(8);
    if (!regions().includes(r)) return null;
    if (!isObj(doc.regions)) doc.regions = {};
    if (!Array.isArray(doc.regions[r])) doc.regions[r] = [];
    return doc.regions[r];
  }
  const i = listPath.indexOf(':');
  if (i < 0) return null;
  const fb = findBlock(listPath.slice(0, i), doc);
  if (!fb) return null;
  let o = fb.block;
  for (const p of listPath.slice(i + 1).split('.')) { if (o == null) return null; o = o[p]; }
  return Array.isArray(o) ? o : null;
}

// Owner block id of a list path (null for regions).
function listOwner(listPath) {
  return listPath && !listPath.startsWith('regions.') ? listPath.slice(0, listPath.indexOf(':')) : null;
}

// Is block `id` equal to or nested inside block `ancestorId`?
function isWithin(id, ancestorId) {
  let fb = findBlock(id);
  while (fb) {
    if (fb.block.id === ancestorId) return true;
    fb = fb.parent ? findBlock(fb.parent.id) : null;
  }
  return false;
}

const pathGet = getPath;

// I18n value at `path` for `lang` ('' if missing).
function getField(block, path, lang = S.lang) {
  const v = pathGet(block, path);
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return typeof v[lang] === 'string' ? v[lang] : '';
}

// Set I18n[lang] at `path` (creates intermediate objects).
// Intermediate containers: an array when the next segment is numeric ('items.0.title'), else an object.
function setField(block, path, lang, value) {
  const parts = String(path).split('.');
  let o = block;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (o[p] == null || typeof o[p] !== 'object') o[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[p];
  }
  const last = parts[parts.length - 1];
  if (!isObj(o[last])) o[last] = {};
  o[last][lang] = value;
}

function pickT(i18n, lang = S.lang) {
  if (!i18n) return '';
  if (typeof i18n === 'string') return i18n;
  try { return pickText(i18n, lang, S.doc) || ''; } catch { return i18n[lang] || ''; }
}

function attList() {
  return Object.values(S.doc?.attachments || {}).map((a) => ({
    id: a.id, name: a.name, mime: a.mime, size: a.size,
    title: pickT(a.title) || a.name,
  }));
}

// --- labels ----------------------------------------------------------------------

// Plain text of an i18n value (or a string) for labels.
const labelText = (x) => (isObj(x) ? htmlText(pickT(x)) : typeof x === 'string' ? htmlText(x) : x == null ? '' : String(x));

// Option label of a select field ('o.<value>' dictionary key, literal text or the value itself).
const optionLabel = (o) => (o.text != null ? String(o.text) : t(o.l != null ? o.l : 'o.' + o.v));

// Text of a list item: the registry's itemLabel key first, then the usual name-like keys; '' if none.
function itemText(block, it, i) {
  if (!it || typeof it !== 'object') return '';
  const def = typeDef(block.type);
  const keys = [def.itemLabel, 'name', 'title', 'label', 'q', 'value', 'date', 'sku'].filter((k, j, a) => typeof k === 'string' && a.indexOf(k) === j);
  for (const k of keys) {
    const s = labelText(it[k]);
    if (s) {
      // A select-valued key (contact kind…) shows its option label.
      const f = (def.itemSchema || []).find((x) => x && x.key === k && x.type === 'select');
      const o = f && (f.options || []).find((x) => String(x.v) === String(it[k]));
      return o ? optionLabel(o) : s;
    }
  }
  if (it.kind != null) {
    const f = (def.itemSchema || []).find((x) => x && x.key === 'kind' && x.type === 'select');
    const o = f && (f.options || []).find((x) => String(x.v) === String(it.kind));
    const v = labelText(it.value);
    if (o) return optionLabel(o) + (v ? ': ' + v : '');
  }
  return '';
}

// Short human label of a block (outline, menus): its first title-like text, a file name, its items, its anchor.
// Heuristic by common key names rather than a required registry field: new block types get usable labels without
// any configuration. Truncated to 40 chars + ellipsis for outline rows and menus.
function blockLabel(b) {
  if (!b) return '';
  const def = typeDef(b.type);
  let s = '';
  for (const k of ['title', 'text', 'brand', 'name', 'eyebrow', 'caption', 'label', 'html', 'lead']) {
    if (b[k] != null && typeof b[k] !== 'boolean' && typeof b[k] !== 'number') { s = labelText(b[k]); if (s) break; }
  }
  if (!s) {
    // The file of a media block (image, embed…): its title or name.
    for (const f of def.schema || []) {
      if (!f || f.type !== 'att' || !b[f.key]) continue;
      const a = own(S.doc?.attachments, b[f.key]);
      if (a) { s = pickT(a.title) || a.name || ''; if (s) break; }
    }
  }
  if (!s && Array.isArray(b.items) && b.items.length) {
    s = b.items.slice(0, 3).map((it, i) => itemText(b, it, i)).filter(Boolean).join(', ');
  }
  if (!s && b.type === 'qr') s = b.url || '';
  if (!s && b.anchor) s = '#' + b.anchor;
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s ? (s.length > 42 ? s.slice(0, 40) + '…' : s) : '';
}

// --- anchors and link targets ---------------------------------------------------

// Block anchors (products with P.anchors): a slug unique per document, the target of '#anchor' links in
// navigation and buttons. 'top', 'cart' and 'lang' are taken by the page itself; 'b-…' / 'att-…' would shadow the
// generated block / attachment ids, so the editor refuses them too.
const ANCHOR_RE = /^[a-z][a-z0-9-]{0,40}$/;
const RESERVED_ANCHORS = new Set(['top', 'cart', 'lang']);
const anchorReserved = (a) => RESERVED_ANCHORS.has(a) || /^(b|att)-/.test(a);

// Transliteration for slugs (Cyrillic, Georgian Mkhedruli, ß); other letters lose their diacritics (NFKD).
const TRANSLIT = (() => {
  const m = new Map();
  const pairs = ('а a б b в v г g ґ g д d е e ё e є ye ж zh з z и i і i ї yi й y к k л l м m н n о o п p р r с s т t '
    + 'у u ф f х kh ц ts ч ch ш sh щ shch ъ - ы y ь - э e ю yu я ya ა a ბ b გ g დ d ე e ვ v ზ z თ t ი i კ k ლ l მ m '
    + 'ნ n ო o პ p ჟ zh რ r ს s ტ t უ u ფ p ქ k ღ gh ყ q შ sh ჩ ch ც ts ძ dz წ ts ჭ ch ხ kh ჯ j ჰ h ß ss').split(' ');
  for (let i = 0; i + 1 < pairs.length; i += 2) m.set(pairs[i], pairs[i + 1] === '-' ? '' : pairs[i + 1]);
  return m;
})();

// 'Наши вина' → 'nashi-vina', 'ღვინო' → 'ghvino', '  Über uns!' → 'uber-uns'; '' when nothing usable is left.
// Transliterate before NFKD: NFKD would decompose й into и + combining breve and lose the distinction. The result
// must start with a letter (valid, CSS-selector-safe id) and match ANCHOR_RE, else '' (caller reports invalid).
function slugify(raw) {
  let s = Array.from(String(raw ?? '').toLowerCase(), (c) => (TRANSLIT.has(c) ? TRANSLIT.get(c) : c)).join('');
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 41).replace(/-+$/, '');
  return ANCHOR_RE.test(s) ? s : '';
}

// Link target of a block in the page: its anchor slug when it has one, else the generated block id.
const blockHref = (b) => '#' + (b.anchor && ANCHOR_RE.test(b.anchor) ? b.anchor : 'b-' + b.id);

// Anchor slugs in use: Map(slug → block id), first one wins (as in normalizeDoc).
function anchorMap(doc = S.doc) {
  const m = new Map();
  if (doc) walk((b) => { if (b.anchor && ANCHOR_RE.test(b.anchor) && !m.has(b.anchor)) m.set(b.anchor, b.id); }, doc);
  return m;
}

// A free slug for `base` ('about' → 'about', then 'about-2'…), ignoring block `selfId`.
function uniqueAnchor(base, selfId = null, doc = S.doc) {
  const used = anchorMap(doc);
  let s = slugify(base) || 'section';
  if (anchorReserved(s)) s = 'sec-' + s;
  s = s.slice(0, 36).replace(/-+$/, '');
  if (!used.has(s) || used.get(s) === selfId) return s;
  for (let n = 2; n < 1000; n++) {
    const c = `${s}-${n}`;
    if (!used.has(c) || used.get(c) === selfId) return c;
  }
  return s + '-' + uid().slice(0, 4).toLowerCase();
}

// Point links to '#from' at '#to' everywhere (nav / button / item hrefs and links inside texts). Returns the count.
// Two match forms: a string that IS the href (nav/button fields) and href="#from" inside rich-text HTML. The
// quote-delimited regex matches only whole attribute values, so '#about' never rewrites '#about-us'. 'data' keys
// (attachment base64) are skipped: huge and never contain links. Depth cap guards against pathological nesting.
// Scope: doc.regions only; hrefs in meta or product document-level texts (ED.i18nRoots) are not remapped.
function remapAnchorRefs(doc, from, to) {
  if (!from || from === to) return 0;
  const oldH = '#' + from, newH = '#' + to;
  const linkRe = new RegExp('(href\\s*=\\s*["\'])' + oldH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(["\'])', 'g');
  let n = 0;
  const rec = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 60) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') {
        if (v === oldH) { o[k] = newH; n++; }
        else if (v.includes(oldH)) { const nv = v.replace(linkRe, (m, a, b) => { n++; return a + newH + b; }); if (nv !== v) o[k] = nv; }
      } else if (v && typeof v === 'object' && k !== 'data') rec(v, depth + 1);
    }
  };
  rec(doc.regions, 1);
  return n;
}

// Link targets inside the document (rich-text link dialog, href suggestions): with anchors, every top-level block
// and every nested block that has an anchor; otherwise blocks of the types the product lists (ED.linkTypes).
function blockAnchors() {
  const out = [];
  if (!S.doc) return out;
  const types = ED.linkTypes || [];
  walk((b, list, i, parent, lp) => {
    // Blocks directly on a page (transparent parent) count as top-level blocks.
    const nested = parent && !isTransparent(parent);
    if (P.anchors ? nested && !b.anchor : !types.includes(b.type)) return;
    const name = blockLabel(b);
    out.push({
      id: b.id, href: blockHref(b), anchor: b.anchor || '', type: b.type, region: regionOf(lp), parent: parent ? parent.id : null,
      label: name ? `${t('b.' + b.type)} · ${name}` : t('b.' + b.type),
    });
  });
  return out;
}

// Full doc (deep copy) with attachment data merged — for save / export.
// The only way a document with bytes is produced: S.doc never holds data (state.js), save / export merge it here.
function fullDoc() {
  const d = clone(S.doc);
  for (const id of Object.keys(d.attachments || {})) d.attachments[id].data = S.attData.get(id) || '';
  return d;
}

// --- rich text paths -------------------------------------------------------------

// Rich / inline field kinds per block type, from the registry (richFields {path: kind}, itemRichFields
// {key: kind} → 'items.*.key'). Used to sanitize imported / pasted content and to keep formatted fields out of
// plain inspector textboxes. Table cells are always rich (richtext/ edits them as such).
// Cached per type: the registry is fixed after boot; the wildcard pattern compiles once into an anchored regex
// ('*' -> \d+ index).
const richPathCache = new Map();
function richPaths(type) {
  if (richPathCache.has(type)) return richPathCache.get(type);
  const def = typeDef(type);
  const out = [];
  const add = (pat, kind) => { if ((kind === 'rich' || kind === 'inline') && typeof pat === 'string' && pat && !out.some((x) => x[0] === pat)) out.push([pat, kind]); };
  if (isObj(def.richFields)) for (const [p, k] of Object.entries(def.richFields)) add(p, k);
  if (isObj(def.itemRichFields)) for (const [p, k] of Object.entries(def.itemRichFields)) add('items.*.' + p, k);
  if (type === 'table') add('rows.*.*.html', 'rich');
  const res = out.map(([pat, kind]) => [pat, kind, new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '\\d+') + '$')]);
  richPathCache.set(type, res);
  return res;
}
function richKind(type, path) {
  for (const [, kind, re] of richPaths(type)) if (re.test(path)) return kind;
  return null;
}
// Visit I18n objects at a wildcard path.
function eachAtPath(obj, parts, fn) {
  if (obj == null) return;
  if (!parts.length) { if (isObj(obj)) fn(obj); return; }
  const [p, ...rest] = parts;
  if (p === '*') { if (Array.isArray(obj)) obj.forEach((x) => eachAtPath(x, rest, fn)); }
  else eachAtPath(obj[p], rest, fn);
}
// Security boundary for imported documents: every rich field passes the richtext/ allowlist sanitizer. If the
// sanitizer throws, the value is HTML-escaped (shown as text) rather than kept raw: fail closed.
function sanitizeDocRich(doc) {
  walk((b) => {
    for (const [pat, kind] of richPaths(b.type)) {
      eachAtPath(b, pat.split('.'), (i18n) => {
        for (const k of Object.keys(i18n)) {
          if (typeof i18n[k] === 'string') { try { i18n[k] = sanitizeHTML(i18n[k], kind); } catch { i18n[k] = esc(i18n[k]); } }
        }
      });
    }
  }, doc);
}

// --- translations ----------------------------------------------------------------

// I18n detection for generic traversal (completeness, copy, language removal).
// Structural detection: an object whose keys all look like language codes and whose values are all strings.
// An empty object qualifies too (eachI18n skips it). Heuristic, hence NON_I18N_KEYS for known non-text objects.
function isI18n(o) {
  if (!isObj(o)) return false;
  const ks = Object.keys(o);
  return ks.every((k) => LANG_RE.test(k) && (typeof o[k] === 'string'));
}
// Keys that never hold texts (block style, theme / layout / output settings, configured requests).
const NON_I18N_KEYS = new Set(['style', 'margin', 'theme', 'layout', 'output', 'requests', 'headers']);
// fn(i18nObject, ownerBlockOrNull) for the texts of meta, the product's document-level texts (ED.i18nRoots), blocks
// and attachments.
function eachI18n(doc, fn) {
  const rec = (o, owner, depth) => {
    if (o == null || typeof o !== 'object' || depth > 40) return;
    if (Array.isArray(o)) { o.forEach((x) => rec(x, owner, depth + 1)); return; }
    if (isI18n(o)) { if (Object.keys(o).length) fn(o, owner); return; }
    const isBlock = typeof o.type === 'string' && typeof o.id === 'string' && !!own(BLOCK_TYPES, o.type);
    for (const [k, v] of Object.entries(o)) {
      if (k === 'data' || (NON_I18N_KEYS.has(k) && !Array.isArray(v))) continue;
      rec(v, isBlock ? o : owner, depth + 1);
    }
  };
  rec(doc.meta, null, 0);
  for (const o of ED.i18nRoots ? ED.i18nRoots(doc) : []) rec(o, null, 0);
  rec(doc.regions, null, 0);
  rec(doc.attachments, null, 0);
}

// Translation completeness of `lang` in %.
// Counts only texts filled in at least one document language (empty everywhere = not translatable content yet),
// and skips blocks limited to other languages (block.langs). An empty document is 100 %.
function completeness(lang, doc = S.doc) {
  let total = 0, done = 0;
  eachI18n(doc, (o, owner) => {
    if (owner && Array.isArray(owner.langs) && !owner.langs.includes(lang)) return;
    const any = doc.langs.some((l) => !emptyText(o[l]));
    if (!any) return;
    total++;
    if (!emptyText(o[lang])) done++;
  });
  return total ? Math.round((done / total) * 100) : 100;
}
function emptyText(s) {
  if (s == null) return true;
  try { return isEmptyText(s); } catch { return !String(s).trim(); }
}

export {
  ANCHOR_RE,
  anchorMap,
  anchorReserved,
  attList,
  blockAnchors,
  blockHref,
  blockLabel,
  completeness,
  eachAtPath,
  eachChildList,
  eachI18n,
  emptyText,
  findBlock,
  fullDoc,
  getField,
  getList,
  isTransparent,
  isWithin,
  itemText,
  labelText,
  listOwner,
  mainPath,
  optionLabel,
  pathGet,
  pickT,
  regionOf,
  regions,
  remapAnchorRefs,
  richKind,
  richPaths,
  sanitizeDocRich,
  setField,
  slugify,
  typeDef,
  typeIcon,
  typeIconEl,
  uniqueAnchor,
  viewerIcon,
  walk
};
