// embroidery-studio/catalog.js - the catalogue of schemes from every source: the demo schemes (built in), my schemes
// (this browser), the static site's published schemes (catalog/index.json next to the page) and the server's
// approved schemes (backend). Items share one shape; schemes load on demand by key ('demo:owl', 'my:<id>',
// 'site:<id>', 'srv:<id>').
//
//   loadCatalog({ force }) -> items     item = { key, src, id, title, designer, category, tags, difficulty, width,
//                                                height, colors, stitches, created, updated, description, thumb,
//                                                views, downloads, brand }
//   getScheme(key) -> scheme            getItem(key) -> item | null
//   queryItems(items, q) -> items       q = { text, category, difficulty: [], size, colors, src, sort }
//   thumbFor(item) -> data URL          (cached in IndexedDB)
//   saveMine(scheme, { origin, from }) -> record      mineRecord(scheme, extra) -> record
//   onCatalogChange(fn)

//
// Design: one item shape for four sources keeps every screen (cards, filters, sorting) source-agnostic; the `key`
// prefix tells getScheme where the full chart lives, so lists stay light (metadata only) and charts load on demand.
// Remote metadata is untrusted: fromRemote coerces every field to its type and caps lengths before it reaches the DOM.
import { t } from '../ui/i18n.js';
import { fromJSON, toJSON, normScheme, cloneScheme } from '../stitch/model.js';
import { stats } from '../stitch/estimate.js';
import { DEMOS, demoScheme } from './demo.js';
import { listMine, getMine, putMine, getThumb, putThumb } from './store.js';
import { siteIndex, siteScheme, serverList, serverScheme, probeBackend } from './remote.js';
import { thumbURL, itemTitle, artifactMode } from './common.js';

// `backend` uses undefined = "not probed yet" vs null = "probed, none": the probe runs once per page.
let items = null, loading = null, backend = undefined;
const listeners = new Set();
export const onCatalogChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { for (const fn of listeners) fn(); };

// Only backend builds and the dev server can have a server next to the page; other modes skip the network probe.
export async function backendInfo() {
  if (backend !== undefined) return backend;
  const mode = artifactMode();
  backend = mode === 'backend' || mode === 'dev' ? await probeBackend() : null;
  return backend;
}

function demoItems() {
  return DEMOS.map((d) => ({
    key: 'demo:' + d.id, src: 'demo', id: d.id, title: '', designer: 'in-html Studio', category: d.category, tags: d.tags, difficulty: d.difficulty,
    width: d.w, height: d.h, colors: d.colors, stitches: d.stitches, created: '2026-10-01T00:00:00.000Z', updated: '2026-10-01T00:00:00.000Z', brand: 'DMC', license: 'CC BY 4.0',
  }));
}

const fromRecord = (r) => ({
  key: 'my:' + r.id, src: 'my', id: r.id, title: r.title, designer: r.designer || '', category: r.category || 'other', tags: r.tags || [], difficulty: r.difficulty || 0,
  width: r.width, height: r.height, colors: r.colors, stitches: r.stitches || 0, created: r.created, updated: r.updated, thumb: r.thumb || null, origin: r.origin, from: r.from,
});
const fromRemote = (src) => (x) => ({
  key: src + ':' + x.id, src, id: String(x.id), title: String(x.title || ''), designer: String(x.designer || ''), category: String(x.category || 'other'),
  tags: Array.isArray(x.tags) ? x.tags.map(String).slice(0, 30) : [], difficulty: +x.difficulty || 0, width: +x.width || 0, height: +x.height || 0,
  colors: +x.colors || 0, stitches: +x.stitches || 0, created: String(x.created || ''), updated: String(x.updated || x.created || ''),
  description: String(x.description || '').slice(0, 4000), thumb: typeof x.thumb === 'string' && /^data:image\/png;base64,/.test(x.thumb) ? x.thumb : null,
  views: +x.views || 0, downloads: +x.downloads || 0, brand: String(x.brand || ''), license: String(x.license || ''),
});

// Single-flight: concurrent callers share the in-flight promise. Sources degrade independently: storage, the static
// index and the server can each fail without hiding the others (demo items always show).
export async function loadCatalog({ force = false } = {}) {
  if (items && !force) return items;
  if (loading && !force) return loading;
  loading = (async () => {
    const out = demoItems();
    try { out.push(...(await listMine()).map(fromRecord)); } catch { /* storage unavailable */ }
    const [site, info] = await Promise.all([artifactMode() === 'serverless' ? siteIndex().catch(() => null) : null, backendInfo()]);
    if (site) out.push(...site.items.map(fromRemote('site')));
    if (info) { try { out.push(...(await serverList()).items.map(fromRemote('srv'))); } catch { /* server down */ } }
    items = out;
    loading = null;
    changed();
    return items;
  })();
  return loading;
}

export const getItem = (key) => (items || []).find((x) => x.key === key) || null;

// Demo charts are cloned before the translated title is set: the shared demo object must stay pristine, and every
// caller may edit its copy.
export async function getScheme(key) {
  const i = String(key).indexOf(':');
  const src = key.slice(0, i), id = key.slice(i + 1);
  if (src === 'demo') {
    const s = demoScheme(id);
    if (!s) throw new Error(t('err.notFound'));
    const c = cloneScheme(s);
    c.meta.title = t('demo.' + id + '.title');
    c.meta.description = t('demo.' + id + '.desc');
    return c;
  }
  if (src === 'my') { const r = await getMine(id); if (!r) throw new Error(t('err.notFound')); const s = fromJSON(r.json); s.id = id; return s; }
  if (src === 'site') return normScheme(await siteScheme(id));
  if (src === 'srv') return normScheme(await serverScheme(id));
  throw new Error(t('err.notFound'));
}

// --- search, filters, sorting --------------------------------------------------------------------------------------

// Search folding: lower-case, NFKD decomposition, then strip combining marks (U+0300..U+036F), so "cafe" matches
// "Café". Cyrillic and Georgian letters have no such marks and pass unchanged.
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
// AND across words; each word must appear in the haystack of title, designer, translated category and tags (both
// the raw tag and its translation, so searching in the UI language finds tags stored in English).
export function queryItems(all, q = {}) {
  const words = fold(q.text).split(/\s+/).filter(Boolean);
  const out = all.filter((x) => {
    if (q.src && q.src !== 'all' && x.src !== q.src) return false;
    if (q.category && q.category !== 'all' && x.category !== q.category) return false;
    if (q.difficulty && q.difficulty.length && !q.difficulty.includes(x.difficulty || 0)) return false;
    const side = Math.max(x.width, x.height);
    if (q.size === 's' && side > 50) return false;
    if (q.size === 'm' && (side <= 50 || side > 120)) return false;
    if (q.size === 'l' && side <= 120) return false;
    if (q.colors === 'few' && x.colors > 10) return false;
    if (q.colors === 'some' && (x.colors <= 10 || x.colors > 30)) return false;
    if (q.colors === 'many' && x.colors <= 30) return false;
    if (q.designer && x.designer !== q.designer) return false;
    if (q.tag && !x.tags.some((tg) => fold(tg) === fold(q.tag))) return false;
    if (words.length) {
      const hay = fold([itemTitle(x), x.designer, t('cat.' + x.category), ...x.tags, ...x.tags.map((tg) => t('tag.' + fold(tg).replace(/[^a-z0-9]+/g, '-')))].join(' '));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const by = q.sort || 'new';
  const title = (x) => itemTitle(x).toLowerCase();
  if (by === 'new') out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)) || title(a).localeCompare(title(b)));
  else if (by === 'title') out.sort((a, b) => title(a).localeCompare(title(b)));
  else if (by === 'size') out.sort((a, b) => a.width * a.height - b.width * b.height);
  else if (by === 'colors') out.sort((a, b) => a.colors - b.colors);
  else if (by === 'easy') out.sort((a, b) => (a.difficulty || 3) - (b.difficulty || 3) || a.width * a.height - b.width * b.height);
  // Popularity weights a download as three views: downloading signals stronger intent than opening the page.
  else if (by === 'popular') out.sort((a, b) => (b.views + 3 * b.downloads) - (a.views + 3 * a.downloads));
  return out;
}

// --- thumbnails ----------------------------------------------------------------------------------------------------

// Version suffix in the cache key: bump it when thumbnail rendering changes and stale cached images are ignored.
const THUMB_V = 'v2';
const pendingThumbs = new Map();
// Cached in IndexedDB; concurrent requests for the same thumbnail share one promise. Note: a failed generation stays
// cached as a rejected promise for the page lifetime (no retry until reload).
export function thumbFor(item) {
  if (item.thumb) return Promise.resolve(item.thumb);
  const key = item.key + ':' + THUMB_V;
  if (pendingThumbs.has(key)) return pendingThumbs.get(key);
  const p = (async () => {
    const cached = await getThumb(key).catch(() => null);
    if (cached) return cached;
    // Give the page a frame before building a scheme.
    await new Promise((r) => setTimeout(r, 0));
    const s = await getScheme(item.key);
    const url = thumbURL(s, 200);
    putThumb(key, url).catch(() => {});
    return url;
  })();
  pendingThumbs.set(key, p);
  return p;
}

// --- my schemes ------------------------------------------------------------------------------------------------------

export function mineRecord(scheme, extra = {}) {
  const st = stats(scheme);
  const now = new Date().toISOString();
  return {
    id: scheme.id, json: toJSON(scheme), title: scheme.meta.title, designer: scheme.meta.designer, category: scheme.meta.category || 'other',
    tags: scheme.meta.tags, difficulty: scheme.meta.difficulty || st.difficulty, width: scheme.width, height: scheme.height,
    colors: scheme.palette.length, stitches: Math.round(st.stitches), created: scheme.meta.created || now, updated: now,
    thumb: thumbURL(scheme, 200), ...extra,
  };
}

// origin / from (where a scheme came from: new, convert, copy of a catalogue item) are preserved across re-saves;
// the in-memory list is patched in place instead of reloading every source.
export async function saveMine(scheme, extra = {}) {
  scheme.meta.updated = new Date().toISOString();
  if (!scheme.meta.created) scheme.meta.created = scheme.meta.updated;
  const prev = await getMine(scheme.id).catch(() => null);
  const rec = mineRecord(scheme, { origin: prev ? prev.origin : 'new', from: prev ? prev.from : '', ...extra });
  await putMine(rec);
  if (items) {
    const it = fromRecord(rec);
    const i = items.findIndex((x) => x.key === it.key);
    if (i >= 0) items[i] = it; else items.push(it);
    changed();
  }
  return rec;
}

export function dropMineFromCache(id) {
  if (!items) return;
  items = items.filter((x) => x.key !== 'my:' + id);
  changed();
}
