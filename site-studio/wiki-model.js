// site-studio/wiki-model.js - the knowledge base model (format 'ss-wiki' v1): factories, normalization of untrusted
// input (never throws, bounded), lookups and the block schema walk shared by the editor, the exporter and the backend.
// Pure functions (Node and browsers).
//
// Knowledge base (the editable project; JSON files, IndexedDB, backend storage):
//   { format: 'ss-wiki', version: 1, id, title, tagline, lang, uiLang, theme, accent, logo (media id), home (page id),
//     nav: [{ label, link }], footer, license (markup), settings: { … }, layers: [{ id, label, on }], ruby (layer id of
//     furigana / ruby text), cats: [{ slug, name, desc }], kdf: { a: 'argon2id', t, m, p } | { a: 'pbkdf2-sha256', i },
//     salt (base64, the key derivation salt of every 451 envelope of this base), pages: [Page],
//     media: { id: { id, name, type, size, w, h, alt, credit, secret? } } (bytes live beside: IndexedDB, files, base64
//     `data` in JSON exports), created, updated, rev }
//   Page: { id, slug, title, display, parent (page id), order, cats: [slug], summary, image (media id), date, author,
//     hidden (unlisted), toc ('auto' | 'on' | 'off'), layout ('default' | 'wide' | 'full'), kind ('page' | 'redirect'),
//     target (redirect target), layers: [{ id, label, on }] (page-only layers), versions: [{ id, label, blocks }],
//     access ('public' | 'secret'), secrets: [{ id, label (editor note), route (route it was sealed for), env }],
//     created, updated }
//   A 'secret' page keeps everything (slug, title, versions) inside its envelopes (secret.js); a public page may carry
//   secret alternative variants. Blocks: { id, type, layer?, off?, …fields of BLOCKS[type].fields }.
// Design rules:
// - Normalise, never validate-and-reject: every input (an imported file, a server PUT, an old IndexedDB record, a
// decrypted payload) goes through norm*() and comes out in the current shape. Unknown fields are dropped, invalid
// ones replaced by defaults. One function owns the shape, so editor, exporter and servers can trust the result.
// - Bounded: LIMITS caps counts and string lengths, so a hostile file cannot make the editor or a server allocate
// without limit (a 5000-page cap, 600 blocks per version, nesting depth 3).
// - Never throws on data (only on programmer errors such as an unknown block type in newBlock).
// - Ids are short lowercase alphanumerics (ID_RE): safe in URLs, file names, storage keys and CSS selectors unescaped.
import { normPath, slugify } from '../spa/route.js';
import { BLOCKS } from './wiki-blocks.js';

export const KB_FORMAT = 'ss-wiki';
export const KB_VERSION = 1;
export const THEMES = ['encyclopedia', 'fandom-dark', 'magazine', 'minimal', 'scholarly'];
export const UI_LANGS = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka'];
// First route segments of the virtual pages and the export's asset folder: never page slugs.
// Kept in sync with the reader's virtual routes and the server prefixes; cleanSlug renames a page that would collide.
export const RESERVED = ['special', 'category', '_kp', 'api', 'kb', 'edit'];
// See secret.js kdfOf for the rationale of these parameters.
export const DEFAULT_KDF = { a: 'argon2id', t: 2, m: 19456, p: 1 };
export const DEFAULT_SETTINGS = {
  search: true, previews: true, toc: 'auto', tocMin: 3, numbered: false, recent: true, random: true, allPages: true,
  backlinks: true, crumbs: true, unlock: true, subpages: true, schemeToggle: true, footerInfo: true, lastEdited: true,
};

// Caps chosen far above real use (largest template: a few hundred pages) and far below what would hurt a browser.
// depth 3: columns inside columns inside columns; deeper nesting is never useful and would allow recursion bombs.
const LIMITS = { pages: 5000, blocks: 600, items: 400, text: 200000, line: 2000, media: 4000, depth: 3, layers: 40, cats: 500, versions: 12, secrets: 12 };

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Accepts strings and finite numbers (a hand-edited JSON with "order": 3 in a text field still works); everything
// else becomes ''. Truncation instead of rejection keeps the rest of the document.
export const str = (v, max = LIMITS.line) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').slice(0, max);
export const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
// Numeric strings accepted ('' is not a number here, though Number('') is 0); result clamped to [min, max].
export const num = (v, d, min = -Infinity, max = Infinity) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
export const oneOf = (v, list, d = list[0]) => (list.includes(v) ? v : d);
export const ID_RE = /^[a-z][a-z0-9]{2,31}$/;
export const LAYER_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const COLOR_RE = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
export const DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

// 10 chars, first a letter (ID_RE requires it; also valid as an HTML id / CSS identifier start). b % 36 has a slight
// modulo bias (256 = 7*36 + 4): irrelevant for uniqueness ids, which are not secrets. Math.random only where crypto
// is missing (very old runtimes): collisions are then repaired by normBlocks / normKB duplicate checks anyway.
export function uid() {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = new Uint8Array(10);
  const cr = globalThis.crypto;
  if (cr && cr.getRandomValues) cr.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = (Math.random() * 256) | 0;
  let s = c[b[0] % 26];
  for (let i = 1; i < b.length; i++) s += c[b[i] % 36];
  return s;
}
export const cleanId = (v, fallback = uid) => (typeof v === 'string' && ID_RE.test(v) ? v : fallback());
export const nowISO = () => new Date().toISOString();

// A page slug: route-like path ('concepts/bhakti'), never starting with a reserved segment.
// A leading '_' is reserved for export folders such as _kp (static hosts also hide such paths, e.g. Jekyll).
export function cleanSlug(v, fallback = 'page') {
  let s = slugify(normPath(str(v)), { slash: true, fallback });
  const first = s.split('/')[0];
  if (RESERVED.includes(first) || first.startsWith('_')) s = 'page-' + s.replace(/^_+/, '');
  return s;
}
export const cleanLayerId = (v) => {
  const s = slugify(str(v), { fallback: '' }).replace(/[^a-z0-9-]/g, '').replace(/^[^a-z]+/, '');
  return LAYER_RE.test(s) ? s : '';
};

// ---------------------------------------------------------------------------------------------
// Blocks: schema-driven normalization (BLOCKS[type].fields).
//   k: 'text' (multi-line markup) | 'line' (one line of inline markup) | 'plain' | 'day' (YYYY-MM-DD) | 'num' | 'bool' | 'select' | 'media' |
//      'link' (route, [[link]] or URL) | 'color' | 'layer' | 'list' (items of `item` fields) | 'grid' (rows of cells) |
//      'tiers' ({ layerId: markup }) | 'pts' ([[x, y], …] in percent) | 'cols' ([{ blocks }]) | 'layers' ([layerId])

// Schema-driven: the block's field descriptor (k = kind) decides the normaliser, so adding a block type to blocks.js
// needs no change here. 'grid' is padded to a rectangle so renderers never meet ragged rows; 'pts' (polygon points)
// are clamped to 0..100 percent of the picture. 'cols' recurses with depth+1 and stops at LIMITS.depth.
// The default branch passes unknown kinds through unchanged: a new field kind must be added here, or it would carry
// untrusted values as-is.
function normField(f, v, depth) {
  switch (f.k) {
    case 'text': return str(v, f.max || LIMITS.text);
    case 'line': case 'plain': return str(v, f.max || LIMITS.line);
    case 'link': return str(v, 600).trim();
    case 'day': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : '';
    case 'num': return num(v, f.d ?? null, f.min ?? -1e9, f.max ?? 1e9);
    case 'bool': return bool(v, !!f.d);
    case 'select': return oneOf(v, f.o, f.d ?? f.o[0]);
    case 'media': return typeof v === 'string' && ID_RE.test(v) ? v : '';
    case 'color': return typeof v === 'string' && COLOR_RE.test(v) ? v : '';
    case 'layer': return typeof v === 'string' && LAYER_RE.test(v) ? v : '';
    case 'layers': return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && LAYER_RE.test(x)))].slice(0, LIMITS.layers) : [];
    case 'list': {
      const out = [];
      if (!Array.isArray(v)) return out;
      for (const it of v.slice(0, f.max || LIMITS.items)) {
        if (!isObj(it)) continue;
        const o = {};
        for (const [k, sf] of Object.entries(f.item)) o[k] = normField(sf, it[k], depth);
        out.push(o);
      }
      return out;
    }
    case 'grid': {
      if (!Array.isArray(v)) return [['']];
      const rows = v.slice(0, 300).map((r) => (Array.isArray(r) ? r.slice(0, 40).map((c) => str(c, 20000)) : [])).filter((r) => r.length);
      const w = Math.max(1, ...rows.map((r) => r.length));
      return rows.length ? rows.map((r) => (r.length < w ? r.concat(Array(w - r.length).fill('')) : r)) : [['']];
    }
    case 'tiers': {
      const o = {};
      if (isObj(v)) for (const [k, x] of Object.entries(v)) if (LAYER_RE.test(k) && typeof x === 'string') o[k] = x.slice(0, 20000);
      return o;
    }
    case 'pts': return Array.isArray(v) ? v.slice(0, 200).filter((p) => Array.isArray(p) && p.length === 2).map((p) => [num(p[0], 0, 0, 100), num(p[1], 0, 0, 100)]) : [];
    case 'cols': {
      const cols = Array.isArray(v) ? v.slice(0, 4) : [];
      const out = cols.map((c) => ({ blocks: depth < LIMITS.depth ? normBlocks(isObj(c) ? c.blocks : [], depth + 1) : [] }));
      while (out.length < (f.min || 2)) out.push({ blocks: [] });
      return out;
    }
    default: return v === undefined ? null : v;
  }
}

// Defaults first, then the type's own defaults(), then overrides, then one more normalisation pass: `over` is trusted as little as file input.
export function newBlock(type, over = {}) {
  const t = BLOCKS[type];
  if (!t) throw new Error('unknown block type ' + type);
  const b = { id: uid(), type };
  for (const [k, f] of Object.entries(t.fields)) b[k] = normField(f, undefined, 1);
  Object.assign(b, typeof t.defaults === 'function' ? t.defaults() : {});
  return normBlock(Object.assign(b, over), 1) || b;
}

// hasOwnProperty, not `in`: type '__proto__' or 'toString' must not resolve through Object.prototype.
export function normBlock(src, depth = 1) {
  if (!isObj(src) || typeof src.type !== 'string' || !Object.prototype.hasOwnProperty.call(BLOCKS, src.type)) return null;
  const t = BLOCKS[src.type];
  const b = { id: cleanId(src.id), type: src.type };
  for (const [k, f] of Object.entries(t.fields)) b[k] = normField(f, src[k], depth);
  const layer = typeof src.layer === 'string' && LAYER_RE.test(src.layer) ? src.layer : '';
  if (layer) b.layer = layer;
  if (src.off === true) b.off = true;
  return b;
}

export function normBlocks(list, depth = 1) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(list)) return out;
  for (const x of list.slice(0, LIMITS.blocks)) {
    const b = normBlock(x, depth);
    if (!b) continue;
    // Duplicate ids (copy-pasted JSON) would make selection and undo address the wrong block: re-issue them.
    if (seen.has(b.id)) b.id = uid();
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

// Every block of a list, nested ones included: fn(block, list, index, depth).
export function walkBlocks(list, fn, depth = 0) {
  if (!Array.isArray(list)) return;
  list.forEach((b, i) => {
    fn(b, list, i, depth);
    const t = BLOCKS[b.type];
    if (!t) return;
    for (const [k, f] of Object.entries(t.fields)) if (f.k === 'cols' && Array.isArray(b[k])) for (const c of b[k]) walkBlocks(c.blocks, fn, depth + 1);
  });
}

// Every markup string of a block list: fn(text, block, key) (text, line and list / grid / tiers values).
// Link fields are wrapped as [[...]] so link scanners (backlinks, rename) see them like links written in text.
export function eachMarkup(list, fn) {
  walkBlocks(list, (b) => {
    const t = BLOCKS[b.type];
    const visit = (fields, obj) => {
      for (const [k, f] of Object.entries(fields)) {
        const v = obj[k];
        if (f.k === 'text' || f.k === 'line') { if (v) fn(v, b, k); }
        else if (f.k === 'link') { if (v) fn(/^\[\[/.test(v) ? v : `[[${v}]]`, b, k); }
        else if (f.k === 'list' && Array.isArray(v)) for (const it of v) visit(f.item, it);
        else if (f.k === 'grid' && Array.isArray(v)) for (const row of v) for (const c of row) if (c) fn(c, b, k);
        else if (f.k === 'tiers' && isObj(v)) for (const x of Object.values(v)) if (x) fn(x, b, k);
      }
    };
    if (t) visit(t.fields, b);
  });
}

// Media ids referenced by a block list.
// Two sources: media-typed fields and {{audio|id}} templates inside markup. Used to decide what secret media to seal with a payload and what an export must ship.
export function mediaRefs(list, out = new Set()) {
  walkBlocks(list, (b) => {
    const t = BLOCKS[b.type];
    const visit = (fields, obj) => {
      for (const [k, f] of Object.entries(fields)) {
        if (f.k === 'media' && obj[k]) out.add(obj[k]);
        else if (f.k === 'list' && Array.isArray(obj[k])) for (const it of obj[k]) visit(f.item, it);
      }
    };
    if (t) visit(t.fields, b);
  });
  eachMarkup(list, (text) => { for (const m of text.matchAll(/\{\{\s*audio\s*\|\s*([a-z][a-z0-9]{2,31})/g)) out.add(m[1]); });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Layers, versions, pages

export function normLayers(list) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(list)) return out;
  for (const l of list.slice(0, LIMITS.layers)) {
    if (!isObj(l)) continue;
    const id = typeof l.id === 'string' && LAYER_RE.test(l.id) ? l.id : cleanLayerId(l.label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: str(l.label, 80) || id, on: bool(l.on, true) });
  }
  return out;
}

export function normVersions(list) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(list)) {
    for (const v of list.slice(0, LIMITS.versions)) {
      if (!isObj(v)) continue;
      let id = typeof v.id === 'string' && LAYER_RE.test(v.id) ? v.id : cleanLayerId(v.label) || 'v' + (out.length + 1);
      while (seen.has(id)) id += '2';
      seen.add(id);
      out.push({ id, label: str(v.label, 80), blocks: normBlocks(v.blocks) });
    }
  }
  return out;
}

// Envelopes are opaque here, so only their shape is enforced: base64 alphabets and length bounds on salt, id and iv,
// KDF parameters clamped to sane ranges. The bounds are loose (m up to 4194304 KiB = 4 GiB), so a crafted
// envelope can still demand a huge Argon2 cost from a reader who types a password; tightening m is the lever. ct capped at 64 MiB.
export function normEnvelope(e) {
  if (!isObj(e) || e.v !== 1 || !isObj(e.kdf) || typeof e.id !== 'string' || typeof e.iv !== 'string' || typeof e.ct !== 'string') return null;
  const k = e.kdf;
  const kdf = k.a === 'pbkdf2-sha256' ? { a: k.a, s: str(k.s, 64), i: num(k.i, 600000, 1, 1e8) }
    : k.a === 'argon2id' ? { a: k.a, s: str(k.s, 64), t: num(k.t, 2, 1, 64), m: num(k.m, 19456, 8, 4194304), p: num(k.p, 1, 1, 16) } : null;
  if (!kdf || !/^[A-Za-z0-9+/=_-]{8,64}$/.test(kdf.s)) return null;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(e.id) || !/^[A-Za-z0-9+/=]{8,64}$/.test(e.iv) || !/^[A-Za-z0-9+/=]+$/.test(e.ct)) return null;
  return { v: 1, kdf, id: e.id, iv: e.iv, ct: e.ct.slice(0, 64 * 1024 * 1024), z: e.z === 1 ? 1 : 0 };
}

// Fields of a page that its 451 payload carries (public page fields minus identity / storage fields).
// Identity (id, slug, parent), structure (order, kind, target, hidden) and storage fields stay outside: the payload
// carries content only, the shell carries position. Adding a content field to Page means adding it here, or 451
// pages would silently lose it.
export const PAYLOAD_FIELDS = ['title', 'display', 'summary', 'image', 'cats', 'date', 'author', 'toc', 'layout', 'layers', 'versions'];

export function normPageFields(src, out = {}) {
  out.title = str(src.title, 300);
  out.display = str(src.display, 600);
  out.summary = str(src.summary, 2000);
  out.image = typeof src.image === 'string' && ID_RE.test(src.image) ? src.image : '';
  out.cats = Array.isArray(src.cats) ? [...new Set(src.cats.filter((c) => typeof c === 'string').map((c) => cleanSlug(c, '')).filter(Boolean))].slice(0, 50) : [];
  out.date = typeof src.date === 'string' && DATE_RE.test(src.date) ? src.date : '';
  out.author = str(src.author, 200);
  out.toc = oneOf(src.toc, ['auto', 'on', 'off']);
  out.layout = oneOf(src.layout, ['default', 'wide', 'full']);
  out.layers = normLayers(src.layers);
  out.versions = normVersions(src.versions);
  return out;
}

// Secret pages have slug '' in clear: the slug itself would reveal the topic (a route like 'plans/merger').
export function normPage(src) {
  if (!isObj(src)) return null;
  const p = { id: cleanId(src.id) };
  p.access = oneOf(src.access, ['public', 'secret']);
  p.slug = p.access === 'secret' ? '' : cleanSlug(src.slug || src.title);
  normPageFields(src, p);
  p.parent = typeof src.parent === 'string' && ID_RE.test(src.parent) ? src.parent : '';
  p.order = num(src.order, 0, -1e6, 1e6);
  p.hidden = bool(src.hidden);
  p.kind = oneOf(src.kind, ['page', 'redirect']);
  p.target = str(src.target, 300);
  p.secrets = [];
  if (Array.isArray(src.secrets)) {
    for (const s of src.secrets.slice(0, LIMITS.secrets)) {
      if (!isObj(s)) continue;
      const env = normEnvelope(s.env);
      if (!env) continue;
      p.secrets.push({ id: cleanId(s.id), label: str(s.label, 120), route: str(s.route, 300), env });
    }
  }
  if (p.access === 'secret') {
    // Nothing of a secret page is kept in clear except its editor note and position.
    for (const k of PAYLOAD_FIELDS) if (k !== 'versions' && k !== 'layers' && k !== 'cats') p[k] = '';
    p.toc = 'auto'; p.layout = 'default'; p.cats = []; p.layers = []; p.versions = [];
  } else if (!p.versions.length && p.kind === 'page') p.versions = [{ id: 'main', label: '', blocks: [] }];
  p.created = str(src.created, 40);
  p.updated = str(src.updated, 40);
  return p;
}

// MIME restricted to type/subtype token characters (it is echoed as Content-Type). Inline base64 data is checked on
// its first 1000 chars only: a full regex scan of megabytes would be slow, and a bad tail fails later in b64decode.
export function normMediaMeta(id, m) {
  if (!isObj(m) || !ID_RE.test(id)) return null;
  const type = typeof m.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(m.type) ? m.type.toLowerCase() : 'application/octet-stream';
  const out = { id, name: str(m.name, 200) || id, type, size: num(m.size, 0, 0, 1e10), w: num(m.w, 0, 0, 1e5), h: num(m.h, 0, 0, 1e5), alt: str(m.alt, 500), credit: str(m.credit, 500) };
  if (typeof m.data === 'string' && /^[A-Za-z0-9+/=\s]*$/.test(m.data.slice(0, 1000))) out.data = m.data.replace(/\s+/g, '');
  if (m.secret === true) out.secret = true;
  return out;
}

// Order matters: pages are normalised before references to them (parent, home) are checked. Duplicate public slugs
// get -2, -3 suffixes (first one wins), so routes stay unique. Parents are repaired in two passes: dangling or self
// references first, then cycles (walk up from every page; O(pages x depth), fine at 5000 pages). home falls back to
// the first public page: a secret page cannot be the home of a public site.
export function normKB(src) {
  const s = isObj(src) ? src : {};
  const kb = { format: KB_FORMAT, version: KB_VERSION, id: cleanId(s.id) };
  kb.title = str(s.title, 200) || 'Knowledge base';
  kb.tagline = str(s.tagline, 300);
  kb.lang = typeof s.lang === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(s.lang) ? s.lang : 'en';
  kb.uiLang = oneOf(s.uiLang, UI_LANGS, UI_LANGS.includes(kb.lang.split('-')[0]) ? kb.lang.split('-')[0] : 'en');
  kb.theme = oneOf(s.theme, THEMES);
  kb.accent = typeof s.accent === 'string' && COLOR_RE.test(s.accent) ? s.accent : '';
  kb.logo = typeof s.logo === 'string' && ID_RE.test(s.logo) ? s.logo : '';
  kb.nav = Array.isArray(s.nav) ? s.nav.filter(isObj).slice(0, 40).map((n) => ({ label: str(n.label, 120), link: str(n.link, 600).trim() })).filter((n) => n.label || n.link) : [];
  kb.footer = str(s.footer, 20000);
  kb.license = str(s.license, 4000);
  kb.settings = { ...DEFAULT_SETTINGS };
  if (isObj(s.settings)) {
    for (const [k, d] of Object.entries(DEFAULT_SETTINGS)) {
      const v = s.settings[k];
      if (typeof d === 'boolean') kb.settings[k] = bool(v, d);
      else if (typeof d === 'number') kb.settings[k] = num(v, d, 1, 20);
      else if (k === 'toc') kb.settings[k] = oneOf(v, ['auto', 'on', 'off']);
    }
  }
  kb.layers = normLayers(s.layers);
  kb.ruby = typeof s.ruby === 'string' && LAYER_RE.test(s.ruby) ? s.ruby : '';
  kb.cats = [];
  const catSeen = new Set();
  if (Array.isArray(s.cats)) {
    for (const c of s.cats.slice(0, LIMITS.cats)) {
      if (!isObj(c)) continue;
      const slug = cleanSlug(c.slug || c.name, '');
      if (!slug || catSeen.has(slug)) continue;
      catSeen.add(slug);
      kb.cats.push({ slug, name: str(c.name, 200) || slug, desc: str(c.desc, 20000) });
    }
  }
  const k = isObj(s.kdf) ? s.kdf : DEFAULT_KDF;
  kb.kdf = k.a === 'pbkdf2-sha256' ? { a: 'pbkdf2-sha256', i: num(k.i, 600000, 1000, 1e8) } : { a: 'argon2id', t: num(k.t, 2, 1, 64), m: num(k.m, 19456, 64, 4194304), p: num(k.p, 1, 1, 16) };
  // A missing or malformed salt gets a fresh one. Consequence: envelopes sealed with the old salt can no longer be
  // opened by keys derived from the base salt (they still carry their own kdf.s, so unlockAll still works).
  kb.salt = typeof s.salt === 'string' && /^[A-Za-z0-9+/=]{16,64}$/.test(s.salt) ? s.salt : newSalt();
  kb.pages = [];
  const ids = new Set(), slugs = new Set();
  if (Array.isArray(s.pages)) {
    for (const x of s.pages.slice(0, LIMITS.pages)) {
      const p = normPage(x);
      if (!p) continue;
      if (ids.has(p.id)) p.id = uid();
      ids.add(p.id);
      if (p.access === 'public') {
        let slug = p.slug, n = 2;
        while (slugs.has(slug)) slug = p.slug + '-' + n++;
        p.slug = slug;
        slugs.add(slug);
      }
      kb.pages.push(p);
    }
  }
  for (const p of kb.pages) if (p.parent && (!ids.has(p.parent) || p.parent === p.id)) p.parent = '';
  // Parent cycles are cut.
  const byId = new Map(kb.pages.map((p) => [p.id, p]));
  for (const p of kb.pages) {
    const seen = new Set([p.id]);
    for (let q = byId.get(p.parent); q; q = byId.get(q.parent)) {
      if (seen.has(q.id)) { p.parent = ''; break; }
      seen.add(q.id);
    }
  }
  kb.home = typeof s.home === 'string' && byId.has(s.home) && byId.get(s.home).access === 'public' ? s.home : (kb.pages.find((p) => p.access === 'public') || {}).id || '';
  kb.media = {};
  if (isObj(s.media)) {
    let n = 0;
    for (const [id, m] of Object.entries(s.media)) {
      if (n++ >= LIMITS.media) break;
      const mm = normMediaMeta(id, m);
      if (mm) kb.media[id] = mm;
    }
  }
  kb.created = str(s.created, 40) || nowISO();
  kb.updated = str(s.updated, 40) || kb.created;
  kb.rev = num(s.rev, 0, 0, 1e12);
  return kb;
}

// 16 random bytes (128-bit salt, the usual recommendation). Requires globalThis.crypto (server.mjs polyfills it on Node 18): a salt must never fall back to Math.random.
export function newSalt() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function newPage(over = {}) {
  const now = nowISO();
  return normPage({ id: uid(), title: 'New page', versions: [{ id: 'main', label: '', blocks: [] }], created: now, updated: now, ...over });
}

export function newKB(over = {}) {
  const home = newPage({ title: over.homeTitle || 'Main page', slug: 'main-page' });
  return normKB({ title: 'Knowledge base', pages: [home], home: home.id, ...over });
}

// ---------------------------------------------------------------------------------------------
// Lookups

export const pageById = (kb, id) => kb.pages.find((p) => p.id === id) || null;
export const pageBySlug = (kb, slug) => kb.pages.find((p) => p.access === 'public' && p.slug === slug) || null;

// Unique slug for a page (another page may not hold it).
export function uniqueSlug(kb, slug, selfId = '') {
  const base = cleanSlug(slug);
  let s = base, n = 2;
  while (kb.pages.some((p) => p.id !== selfId && p.access === 'public' && p.slug === s)) s = base + '-' + n++;
  return s;
}

// Every layer a page can use: the base's, then the page's own (same id: the page's label and default win).
// Map keeps insertion order: base layers keep their position even when a page overrides one of them.
export function pageLayers(kbLayers, page) {
  const map = new Map();
  for (const l of kbLayers || []) map.set(l.id, l);
  for (const l of (page && page.layers) || []) map.set(l.id, l);
  return [...map.values()];
}

// Children of a page (by parent id), ordered.
export function childrenOf(kb, id) {
  return kb.pages.filter((p) => p.parent === id).sort((a, b) => a.order - b.order || (a.title || '').localeCompare(b.title || ''));
}

// Whole knowledge base as JSON text with media bytes (getData(id) -> base64 | null) for files and backups.
// getData is async (IndexedDB blobs -> base64); media are read one by one to keep peak memory at one file.
export async function kbToJSON(kb, getData, { space = 0 } = {}) {
  const out = { ...kb, media: {} };
  for (const [id, m] of Object.entries(kb.media)) {
    const data = getData ? await getData(id) : m.data;
    out.media[id] = { ...m, ...(data ? { data } : {}) };
  }
  return JSON.stringify(out, null, space || undefined);
}
