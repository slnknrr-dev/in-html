// knowledge-processor/site.js - the published form of a knowledge base ("site"): what a reader, a prerenderer or a
// server needs and nothing secret in clear. Pure functions (Node and browsers).
//
//   buildSite(kb) -> site
//     { v: 1, id, title, tagline, lang, uiLang, theme, accent, logo, home (slug), nav, footer, license, settings,
//       layers, ruby, cats, pages: [SitePage], media: { id: { t, n, s, w, h, alt, cr, f (file name) } },
//       sealed: [envelope] (every 451 envelope of the base, sorted by id: secret pages and secret variants alike),
//       updated }
//     SitePage: { id, slug, title, display, parent (slug), order, cats, summary, image, date, author, hidden, toc,
//       layout, kind, target, layers, versions, updated }
//     Secret pages are absent (their slug, title and text exist only inside envelopes); media marked secret is absent
//     too (its bytes travel inside the envelopes that use it).
//   payloadOf(kb, page, { kind, label, base }) -> the 451 payload of a page (editor: before sealing)
//   applyPayloads(site, payloads) -> { pages: Map(slug -> page), variants: Map(pageId -> [variant]), media: { id: meta+d } }
//     decrypted payloads as reader pages: secret pages get `secret: true`; variants { label, …page fields }
//   mediaFileName(id, meta) -> 'id.ext' (static exports)
import { PAYLOAD_FIELDS, normPageFields, pageById } from './model.js';
import { normPath } from '../spa/route.js';

// MIME -> extension for static exports: servers pick Content-Type from the extension, so a wrong one makes a
// browser refuse to play/show the file. Unknown types fall back to the original name's extension, then 'bin'.
const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'application/pdf': 'pdf', 'text/plain': 'txt', 'application/zip': 'zip',
};

// Accepts both the KB shape (name/type) and the compact site shape (n/t): called from editor and reader.
export function mediaFileName(id, m) {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec((m && (m.name || m.n)) || '');
  const ext = EXT[(m && (m.type || m.t)) || ''] || (fromName ? fromName[1].toLowerCase() : 'bin');
  return id + '.' + ext;
}

// A parent is linked only when public: pointing at a secret parent's slug would reveal its existence.
// cats.slice(): the site must not alias editor arrays (later edits would mutate a built site in memory).
export function sitePage(kb, p) {
  const parent = p.parent ? pageById(kb, p.parent) : null;
  return {
    id: p.id, slug: p.slug, title: p.title, display: p.display, parent: parent && parent.access === 'public' ? parent.slug : '',
    order: p.order, cats: p.cats.slice(), summary: p.summary, image: p.image, date: p.date, author: p.author, hidden: p.hidden,
    toc: p.toc, layout: p.layout, kind: p.kind, target: p.target, layers: p.layers, versions: p.versions, updated: p.updated,
  };
}

// Security invariant: nothing secret in clear. Secret pages are filtered out entirely, secret media skipped,
// and only envelopes (ciphertext) are carried. Home falls back to '' when the home page is secret.
export function buildSite(kb) {
  const home = kb.pages.find((p) => p.id === kb.home && p.access === 'public');
  const pages = kb.pages.filter((p) => p.access === 'public').map((p) => sitePage(kb, p));
  const media = {};
  for (const [id, m] of Object.entries(kb.media || {})) {
    if (m.secret) continue;
    media[id] = { t: m.type, n: m.name, s: m.size, w: m.w, h: m.h, alt: m.alt, cr: m.credit, f: mediaFileName(id, m) };
  }
  const sealed = [];
  for (const p of kb.pages) for (const s of p.secrets || []) if (s.env) sealed.push(s.env);
  // Sorted by id then iv: envelope order would otherwise leak which page each belongs to (kb.pages order) and
  // make exports non-deterministic. Ties fall to iv, which is random per seal, so order is total in practice.
  sealed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.iv < b.iv ? -1 : 1));
  return {
    v: 1, id: kb.id, title: kb.title, tagline: kb.tagline, lang: kb.lang, uiLang: kb.uiLang, theme: kb.theme, accent: kb.accent,
    // Logo kept only if its media survived filtering (a secret logo would be a dangling reference).
    logo: kb.logo && media[kb.logo] ? kb.logo : '', home: home ? home.slug : '', nav: kb.nav, footer: kb.footer, license: kb.license,
    settings: kb.settings, layers: kb.layers, ruby: kb.ruby, cats: kb.cats, pages, media, sealed, updated: kb.updated,
  };
}

// The payload of a page for sealing. kind 'page': the whole page (access 'secret'); kind 'variant': an alternative
// version set of the public page `page` (its fields come from `base`, the variant's own content).
// Only PAYLOAD_FIELDS are copied (whitelist from model.js): editor-only fields (secrets, remote, revisions)
// can never leak into ciphertext that is shipped to every reader. Slug and parent exist only for kind 'page';
// a variant reuses the public page's route.
export function payloadOf(kb, page, { kind = 'page', label = '', base = null, media = null } = {}) {
  const src = base || page;
  const out = { kind, label: String(label || ''), page: page.id };
  if (kind === 'page') {
    out.slug = normPath(src.slug || '');
    const parent = page.parent ? pageById(kb, page.parent) : null;
    out.parent = parent && parent.access === 'public' ? parent.slug : '';
  }
  for (const k of PAYLOAD_FIELDS) out[k] = src[k];
  if (media && Object.keys(media).length) out.media = media;
  return out;
}

// Decrypted payloads -> reader pages.
// Payloads come from decrypting reader-supplied passwords: treat them as untrusted input. Each is type-checked
// and normalised (normPageFields), media accepted only with string data.
export function applyPayloads(site, payloads) {
  const pages = new Map(), variants = new Map(), media = {};
  const publicSlugs = new Set((site.pages || []).map((p) => p.slug));
  for (const pl of payloads || []) {
    if (!pl || typeof pl !== 'object') continue;
    if (pl.media && typeof pl.media === 'object') for (const [id, m] of Object.entries(pl.media)) if (m && typeof m.d === 'string') media[id] = m;
    const f = normPageFields(pl);
    if (pl.kind === 'variant') {
      const list = variants.get(pl.page) || [];
      list.push({ ...f, label: String(pl.label || ''), secret: true });
      variants.set(pl.page, list);
    } else if (pl.kind === 'page') {
      const slug = normPath(pl.slug || '');
      // A secret page may not shadow a public slug: otherwise a crafted envelope could replace a public page.
      if (!slug || publicSlugs.has(slug)) continue;
      // hidden: true keeps decrypted pages out of nav and listings; `secret` lets the reader badge them.
      pages.set(slug, { ...f, id: String(pl.page || ''), slug, parent: normPath(pl.parent || ''), kind: 'page', hidden: true, order: 0, target: '', secret: true, label: String(pl.label || '') });
    }
  }
  return { pages, variants, media };
}
