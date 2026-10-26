// site-studio/viewer-backend.js - backend exports on the view side (CONTRACT.md §16): the export option
// `api` (P.makeCtx → ctx.api), the runtime's cfg.api, the browser-local endpoints a page uses, and content collections
// (list blocks bound to a public collection by the common prop `source`).
import { BLOCK_TYPES } from '../doc/product.js';
import { walkBlocks } from '../doc/model.js';
import { isObj, own, str } from '../util/value.js';

const API_MODES = ['server', 'auto'];

// Content collection names ('products', 'team-2025'); the same alphabet as anchors, so they are safe in paths.
const SOURCE_RE = /^[a-z][a-z0-9-]{0,30}$/;

// 'local:<collection>[/<key>]' (the key may still hold {placeholders}).
const LOCAL_URL_RE = /^local:([a-z0-9][a-z0-9._-]{0,39})(?:\/([^?#/]{1,120}))?$/;

// Collections the runtime or the server uses itself: never a content collection name.
const RESERVED_COLLECTIONS = new Set(['chat', 'api', 'admin', 'assets', 'data', 'site', 'build']);

// A list block type whose items can be managed as a content collection: items with a schema, not flagged
// `noSource` (field lists such as the form's, button rows).
function sourceType(type) {
  const t = own(BLOCK_TYPES, type);
  return !!(t && Array.isArray(t.itemSchema) && t.itemSchema.length && typeof t.itemDefaults === 'function' && !t.noSource);
}

// Normalized `source` of a block: a collection slug for a bindable type, else ''.
function normSource(v, type) {
  const s = str(v).trim().toLowerCase();
  return s && SOURCE_RE.test(s) && !RESERVED_COLLECTIONS.has(s) && sourceType(type) ? s : '';
}

// P.makeCtx: the export option api = { mode: 'server' | 'auto', base } becomes ctx.api (view exports only).
function backendCtx(ctx, opts) {
  const a = !ctx.edit && isObj(opts) && isObj(opts.api) ? opts.api : null;
  const base = a && typeof a.base === 'string' && /^(\.\.?\/)*([A-Za-z0-9._~-]+\/)*$/.test(a.base) ? a.base : '';
  ctx.api = a && API_MODES.includes(a.mode) ? { mode: a.mode, base } : null;
}

// Content collections of a document: name → { type, blocks: [block ids], shown (blocks not hidden), items (of the first
// block) }. Blocks bound to a name already taken by another block type are reported in `conflicts` and left unbound.
function contentCollections(doc) {
  const out = new Map();
  const conflicts = [];
  walkBlocks(doc, (b) => {
    const name = normSource(b.source, b.type);
    if (!name) return;
    const c = out.get(name);
    if (!c) out.set(name, { name, type: b.type, blocks: [b.id], shown: b.hidden ? 0 : 1, items: Array.isArray(b.items) ? b.items : [] });
    else if (c.type === b.type) { c.blocks.push(b.id); if (!b.hidden) c.shown++; }
    else conflicts.push({ name, block: b.id, type: b.type, owner: c.type });
  });
  return { collections: out, conflicts };
}

// The parts of a 'local:' URL: { collection, key } (key '' for the whole collection), or null.
function localParts(url) {
  const m = LOCAL_URL_RE.exec(str(url).trim());
  return m ? { collection: m[1], key: m[2] || '' } : null;
}

const reqOf = (doc, id) => (typeof id === 'string' && id ? (doc.requests || []).find((r) => isObj(r) && r.id === id) || null : null);

// cfg.api of the runtime (feature api): mode, base, public collections the page shows, collections whose writes reach
// the owner (forms, checkout and the chat; a static page fails them so the visitor gets the fallback channel).
function apiCfg(ctx, use) {
  const d = ctx.doc;
  const out = new Set();
  const ids = new Set(use.reqs);
  const co = d.shop && d.shop.checkout;
  if (use.features.has('checkout') && co && co.method === 'request') ids.add(co.req);
  for (const id of ids) {
    const r = reqOf(d, id);
    const p = r ? localParts(r.url) : null;
    if (p && r.method !== 'GET') out.add(p.collection);
  }
  if (use.features.has('chat')) out.add('chat');
  const pub = [];
  for (const [name, c] of contentCollections(d).collections) if (c.blocks.some((id) => ctx.rendered.has(id))) pub.push(name);
  return { m: ctx.api.mode === 'server' ? 'server' : 'auto', b: ctx.api.base, pub, out: [...out].sort() };
}

export {
  API_MODES,
  LOCAL_URL_RE,
  RESERVED_COLLECTIONS,
  SOURCE_RE,
  apiCfg,
  backendCtx,
  contentCollections,
  localParts,
  normSource,
  reqOf,
  sourceType
};
