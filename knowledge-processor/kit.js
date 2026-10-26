// knowledge-processor/kit.js - the building kit of templates: a compact specification of a knowledge base (pages by
// slug, blocks as plain objects, media from SVG text, secret pages and secret variants with their passwords) turned
// into a normalized knowledge base with sealed 451 envelopes. Node and browsers.
//
//   await buildKB(spec, { onProgress }) -> kb (model.js normKB)
//   spec = {
//     title, tagline, lang, uiLang, theme, accent, logo (media key), home (page slug), nav: [{ label, link }], footer, license,
//     settings, layers: [{ id, label, on }], ruby (layer id of furigana), cats: [{ slug, name, desc }], kdf,
//     media: { key: { svg (SVG text) | data (base64), type, name, alt, credit, w, h } },     key = media id ([a-z][a-z0-9]{2,31})
//     pages: [{
//       slug, title, display, parent (slug), order, cats, summary, image (media key), date, author, hidden, toc, layout,
//       kind ('page' | 'redirect'), target, layers,
//       blocks: [block] | versions: [{ id, label, blocks }],
//       secret: { password, note }                      the whole page is a 451 page (404 without the password)
//       variants: [{ password, label, note, blocks | versions, layers, title, summary }]   451 variants of a public page
//     }] }
//   Blocks are plain objects { type, …fields } of blocks.js; ids are added. Links inside markup use slugs or titles:
//   [[slug]], [[slug|label]], [[Title]], [[category:slug]].
//   svgMedia(svg, { name, alt, credit, w, h }) -> media spec; b64utf8(text) -> base64
import { b64encode } from '../codec/base64.js';
import { mediaRefs, normKB, normPage, ID_RE } from './model.js';
import { payloadOf } from './site.js';
import { deriveKeys, kdfOf, sealWith } from './secret.js';

// TextEncoder first: btoa() only accepts Latin-1 and throws on any non-ASCII SVG text (Georgian, Japanese labels).
export const b64utf8 = (text) => b64encode(new TextEncoder().encode(String(text)));

// Intrinsic size from the viewBox width/height (3rd/4th numbers) when not given: the reader needs w/h to reserve
// layout space (no jump when the image loads). Regex, not a DOM parser: kit runs in Node too.
export function svgMedia(svg, o = {}) {
  const m = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(svg) || [];
  return { svg, type: 'image/svg+xml', name: o.name || 'image.svg', alt: o.alt || '', credit: o.credit || '', w: o.w || Math.round(+m[1] || 0), h: o.h || Math.round(+m[2] || 0) };
}

// Deterministic ids ('pg001'...) from spec order, not random: rebuilding a template yields identical ids, so
// diffs, tests and links between builds stay stable. base36 + pad 3 keeps ids short and sortable.
const pageIdOf = (i) => 'pg' + i.toString(36).padStart(3, '0');

export async function buildKB(spec, { onProgress } = {}) {
  const media = {};
  // Media keys double as ids; validated up front so a typo fails at build time, not as a broken image later.
  // size = decoded byte count estimated from base64 length (3 bytes per 4 chars); it ignores '=' padding, so it
  // can over-count by up to 2 bytes. Display-only, acceptable.
  for (const [key, m] of Object.entries(spec.media || {})) {
    if (!ID_RE.test(key)) throw new Error('media key must match ' + ID_RE + ': ' + key);
    const data = m.svg ? b64utf8(m.svg) : m.data || '';
    media[key] = { id: key, name: m.name || key, type: m.type || (m.svg ? 'image/svg+xml' : 'application/octet-stream'), size: Math.floor((data.length * 3) / 4), w: m.w || 0, h: m.h || 0, alt: m.alt || '', credit: m.credit || '', data, ...(m.secret ? { secret: true } : {}) };
  }
  const specPages = spec.pages || [];
  // Two passes: slug -> id map first, so `parent` and `home` may reference pages declared later in the spec.
  const idOf = new Map(specPages.map((p, i) => [p.slug, pageIdOf(i + 1)]));
  // spec.updated pins timestamps: reproducible builds (tests compare output); otherwise build time.
  const now = spec.updated || new Date().toISOString();
  const raw = specPages.map((p, i) => {
    const versions = p.versions || [{ id: 'main', label: '', blocks: p.blocks || [] }];
    return {
      id: pageIdOf(i + 1), slug: p.slug, title: p.title, display: p.display, parent: p.parent ? idOf.get(p.parent) || '' : '', order: p.order ?? i,
      cats: p.cats, summary: p.summary, image: p.image, date: p.date, author: p.author, hidden: p.hidden, toc: p.toc, layout: p.layout,
      kind: p.kind, target: p.target, layers: p.layers, versions, access: 'public', created: now, updated: p.updated || now,
    };
  });
  // normKB is the single normaliser: the kit only maps spec names to model fields and lets model.js fill
  // defaults and validate, so templates cannot produce a KB the editor would not.
  const kb = normKB({
    id: spec.id, title: spec.title, tagline: spec.tagline, lang: spec.lang, uiLang: spec.uiLang, theme: spec.theme, accent: spec.accent,
    logo: spec.logo, nav: spec.nav, footer: spec.footer, license: spec.license, settings: spec.settings, layers: spec.layers, ruby: spec.ruby,
    cats: spec.cats, kdf: spec.kdf, pages: raw, home: idOf.get(spec.home) || '', media, created: now, updated: now,
  });
  // 451 content: one key derivation per password.
  // KDF (PBKDF2/Argon-like, see secret.js) is deliberately slow; memoising per password makes a template with
  // many variants under one password cost one derivation, not N.
  const keys = new Map();
  const kdf = kdfOf(kb.kdf, kb.salt);
  const keysOf = async (pw) => {
    if (!keys.has(pw)) keys.set(pw, await deriveKeys(pw, kdf));
    return keys.get(pw);
  };
  // Media marked secret travel inside the payloads that use them (never in clear).
  // mediaRefs collects every media id the payload's blocks use; only secret ones are embedded (short keys t/n/s/...
  // match the site.js media meta shape so the reader treats them uniformly).
  const withMedia = (payload) => {
    const ids = mediaRefs([].concat(...(payload.versions || []).map((v) => v.blocks || [])));
    if (payload.image) ids.add(payload.image);
    const out = {};
    for (const id of ids) { const m = kb.media[id]; if (m && m.secret) out[id] = { t: m.type, n: m.name, s: m.size, w: m.w, h: m.h, alt: m.alt, cr: m.credit, d: m.data }; }
    return Object.keys(out).length ? { ...payload, media: out } : payload;
  };
  const jobs = specPages.filter((p) => p.secret || (p.variants && p.variants.length)).length;
  let done = 0;
  for (const sp of specPages) {
    if (!sp.secret && !(sp.variants && sp.variants.length)) continue;
    const page = kb.pages.find((p) => p.id === idOf.get(sp.slug));
    // A secret page is rebuilt as an empty shell (normPage with only structural fields): title, slug and blocks
    // exist only inside the envelope. The note is the editor-side label; route keeps the slug for the editor only
    // (remote.js and site.js strip/skip it on publish).
    if (sp.secret) {
      const payload = payloadOf(kb, page, { kind: 'page', label: sp.secret.label || '' });
      const env = sealWith(await keysOf(sp.secret.password), withMedia(payload));
      const note = sp.secret.note || '';
      Object.assign(page, normPage({ id: page.id, access: 'secret', parent: page.parent, order: page.order, created: page.created, updated: page.updated }));
      page.secrets = [{ id: 'sc' + page.id, label: note, route: sp.slug, env }];
    }
    // Variants seal an alternative version set of a public page: `base` carries the variant's own fields
    // (falling back to the public page's), the public page itself stays readable. Ids 'sv'+page+index are
    // deterministic like page ids.
    for (const [k, v] of (sp.variants || []).entries()) {
      const base = normPage({ ...page, title: v.title || page.title, summary: v.summary ?? page.summary, layers: v.layers || page.layers, versions: v.versions || [{ id: 'main', label: '', blocks: v.blocks || [] }], access: 'public' });
      const payload = payloadOf(kb, page, { kind: 'variant', label: v.label || '', base });
      page.secrets.push({ id: 'sv' + page.id + k, label: v.note || v.label || '', route: page.slug, env: sealWith(await keysOf(v.password), withMedia(payload)) });
    }
    if (onProgress) onProgress(++done / jobs);
  }
  return kb;
}
