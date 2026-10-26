// site-studio/wiki-site.js - the published form of a knowledge base ("site"): what a reader, a prerenderer or a
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
import { PAYLOAD_FIELDS, normPageFields, pageById } from './wiki-model.js';
import { normPath } from '../spa/route.js';

// MIME -> extension for exported file names. Servers and file:// pick Content-Type from the extension, so the
// type, not the user's original file name, decides; the name is only a fallback for unknown types.
const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'application/pdf': 'pdf', 'text/plain': 'txt', 'application/zip': 'zip',
};

export function mediaFileName(id, m) {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec((m && (m.name || m.n)) || '');
  const ext = EXT[(m && (m.type || m.t)) || ''] || (fromName ? fromName[1].toLowerCase() : 'bin');
  return id + '.' + ext;
}

// Whitelist copy, not {...p}: a new field added to the editor model stays private until deliberately published.
// A secret parent is replaced by '' so a public page does not leak the slug of a hidden one.
export function sitePage(kb, p) {
  const parent = p.parent ? pageById(kb, p.parent) : null;
  return {
    id: p.id, slug: p.slug, title: p.title, display: p.display, parent: parent && parent.access === 'public' ? parent.slug : '',
    order: p.order, cats: p.cats.slice(), summary: p.summary, image: p.image, date: p.date, author: p.author, hidden: p.hidden,
    toc: p.toc, layout: p.layout, kind: p.kind, target: p.target, layers: p.layers, versions: p.versions, updated: p.updated,
  };
}

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
  // Sorted by id, then iv: the order of envelopes in the output must not reveal which page each belongs to (page order
  // would). Sorting also makes exports deterministic for equal input.
  sealed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.iv < b.iv ? -1 : 1));
  return {
    v: 1, id: kb.id, title: kb.title, tagline: kb.tagline, lang: kb.lang, uiLang: kb.uiLang, theme: kb.theme, accent: kb.accent,
    // A logo that points at secret or missing media is dropped instead of producing a broken image.
    logo: kb.logo && media[kb.logo] ? kb.logo : '', home: home ? home.slug : '', nav: kb.nav, footer: kb.footer, license: kb.license,
    settings: kb.settings, layers: kb.layers, ruby: kb.ruby, cats: kb.cats, pages, media, sealed, updated: kb.updated,
  };
}

// The payload of a page for sealing. kind 'page': the whole page (access 'secret'); kind 'variant': an alternative
// version set of the public page `page` (its fields come from `base`, the variant's own content).
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
// Payloads come from decryption and are treated as untrusted shape: every field is renormalised (normPageFields),
// media accepted only with string bytes. A secret page may not shadow a public slug: otherwise whoever holds a
// password could replace a public page for themselves. Unlocked
// pages are hidden from listings (they appear only to the reader who typed the password).
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
      if (!slug || publicSlugs.has(slug)) continue;
      pages.set(slug, { ...f, id: String(pl.page || ''), slug, parent: normPath(pl.parent || ''), kind: 'page', hidden: true, order: 0, target: '', secret: true, label: String(pl.label || '') });
    }
  }
  return { pages, variants, media };
}
