// knowledge-processor/reader.js - the runtime of a published knowledge base: one page that behaves like a site of
// many pages (spa/router.js) in every export mode, renders pages with render.js, and adds the interactive parts:
// hover previews of internal links and footnotes, search with suggestions, random page, layer toggles (remembered per
// base), versions and 451 variants, unlocking with `#?451=<password>` or the unlock form (keys kept for the browser
// tab), image lightbox, spoilers, flash cards, sortable tables, audio buttons and interlinear timestamps, diagrams
// (label / region highlighting), mobile navigation drawer and the colour scheme toggle. Nothing runs at module
// evaluation; reader-boot.js starts it.
//
//   const r = startReader({ site, mode, base, style, root, mediaSrc, media, initial, editor, onNavigate, onBlock })
//     site      buildSite() output (site.js)        mode  'hash' | 'path' | 'memory'        base / style  spa/base.js
//     mediaSrc  (id, meta) -> URL of a public media item; media: { id: Blob | base64 string } (single file, preview):
//               turned into object URLs on first use
//     initial   first route in 'memory' mode          editor  data-bid on blocks (editor preview)
//     onNavigate(route, { title, kind, pageId })      onBlock(blockId) (editor preview: a click on a block)
//   r.go(route), r.setSite(site, media), r.unlock(password) -> Promise<count>, r.current(), r.stop()
//
// Design decisions:
// - Event delegation: a handful of listeners on `root` (click, mouseover/out, focusin/out, input, keydown, submit)
//   serve every page. Page HTML is replaced wholesale on navigation (innerHTML of #kp-main), so per-element listeners
//   would have to be re-bound after every render and would leak if forgotten.
// - Rendering is the same render.js used by prerender and servers, so the client output matches the server HTML.
// - State that must survive reloads is scoped per base (key() = kp:<site id>:...): layer choices in localStorage
//   (a preference), 451 keys in sessionStorage (secrets: gone when the tab closes, never persisted to disk).
// - Storage access is wrapped (store): private modes and sandboxed frames throw on access; the reader must still run.
import { createRouter } from '../spa/router.js';
import { parseQuery } from '../spa/route.js';
import { createRenderer, icon } from './render.js';
import { readerT } from './strings-reader.js';
import { buildIndex } from './search.js';
import { applyPayloads } from './site.js';
import { keysFromJSON, keysToJSON, openAllWith, unlockAll } from './secret.js';
import { eachMarkup } from './model.js';
import { plainText } from './markup.js';
import { b64decode } from '../codec/base64.js';
import { startPortal } from '../portal/runtime.js';

// 450ms before a link preview: long enough that sweeping the pointer across text does not flash popups, short enough
// to feel responsive. Footnotes and tips use 200ms (the user is clearly aiming at a small marker).
const HOVER_DELAY = 450;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } },
  sget(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } },
};

// Readable text colour on an accent colour.
// Same luminance rule as pages.js onAccent (kept in sync by hand: the reader must not import the page generator).
function onAccent(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '';
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const lin = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return L > 0.4 ? '#111111' : '#ffffff';
}

// The stored scheme is global (not per base): a reader who prefers dark wants it on every base.
export function applyTheme(site, doc = document) {
  const html = doc.documentElement;
  html.setAttribute('data-kp-theme', site.theme || 'encyclopedia');
  if (site.lang) html.lang = site.lang;
  if (site.accent) { html.style.setProperty('--kp-accent', site.accent); html.style.setProperty('--kp-accent-fg', onAccent(site.accent)); }
  else { html.style.removeProperty('--kp-accent'); html.style.removeProperty('--kp-accent-fg'); }
  const sc = store.get('kp-scheme');
  if (sc === 'light' || sc === 'dark') html.setAttribute('data-kp-scheme', sc);
}

export function startReader(opts) {
  let site = opts.site;
  const root = opts.root || document.body;
  const doc = root.ownerDocument || document;
  const win = doc.defaultView || window;
  let t = readerT(site.uiLang);
  const key = (k) => `kp:${site.id}:${k}`;
  const blobURLs = new Map();
  let media = opts.media || {};
  const extraMedia = {};
  const unlocked = new Map();      // slug -> secret page
  const variants = new Map();      // page id -> [variant]
  const variantSel = new Map();    // page id -> selected index (0 = public)
  let sessionKeys = keysFromJSON(store.sget(key('keys')));
  let R = null, index = null, router = null, cur = null, curPage = null, pt = null;
  let layerState = store.get(key('layers')) || {};

  // Object URLs are created once per media id and cached; the cache entry is also what gets revoked on update/stop,
  // so the Blob is not kept alive forever. A decoding failure caches '' to avoid retrying on every render.
  function urlOfData(id, data, type) {
    if (blobURLs.has(id)) return blobURLs.get(id);
    let url = '';
    try {
      const blob = data instanceof Blob ? data : new Blob([b64decode(data)], { type: type || 'application/octet-stream' });
      url = URL.createObjectURL(blob);
    } catch { url = ''; }
    blobURLs.set(id, url);
    return url;
  }
  // Precedence: media unlocked from 451 payloads, then inline media (single file / preview: a ready URL string or bytes),
  // then the mode's URL builder (static and server: a file under _kp/media/).
  function mediaSrc(id) {
    if (extraMedia[id]) return urlOfData(id, extraMedia[id].d, extraMedia[id].t || extraMedia[id].type);
    const m = (site.media || {})[id];
    if (!m) return '';
    if (media[id] != null) return typeof media[id] === 'string' && /^(blob:|data:|https?:|\/|\.)/.test(media[id]) ? media[id] : urlOfData(id, media[id], m.t);
    return opts.mediaSrc ? opts.mediaSrc(id, m) : '';
  }

  // A new renderer whenever the visible data changes (site update, unlock); the search index depends on it and is reset.
  function makeRenderer() {
    R = createRenderer(site, { t, href: (r) => router.href(r), mediaSrc, unlocked, extraMedia: (id) => extraMedia[id], editor: !!opts.editor });
    index = null;
  }

  // ---- search index (lazy)
  function pageText(p) {
    const v = (p.versions || [])[0];
    if (!v) return p.summary || '';
    const parts = [];
    const c = { link: R.link, media: R.mediaInfo, t };
    if (p.summary) parts.push(plainText(p.summary, c));
    eachMarkup(v.blocks, (text) => { parts.push(plainText(text, c)); });
    return parts.join(' ');
  }
  function pageHeads(p) {
    const v = (p.versions || [])[0];
    const out = [];
    if (!v) return out;
    for (const b of v.blocks || []) {
      if (b.type === 'heading') out.push(b.text);
      if (b.type === 'text') for (const m of String(b.text).matchAll(/^#{1,4}\s+(.+)$/gm)) out.push(m[1]);
    }
    return out.map((h) => plainText(h, { link: R.link, t }));
  }
  // Built on first search, not at start: most visits never search, and indexing every page's text costs time on large
  // bases. Unlocked 451 pages join the index for this session.
  function getIndex() {
    if (!index) {
      const list = R.pages.filter((p) => p.kind !== 'redirect');
      index = buildIndex([...list, ...unlocked.values()], { text: pageText, headings: pageHeads });
    }
    return index;
  }

  // ---- layers
  // The reader's own choice (layerState) beats the author's default; hasOwnProperty so a stored false is respected.
  function layerOn(l) { return Object.prototype.hasOwnProperty.call(layerState, l.id) ? !!layerState[l.id] : l.on !== false; }
  let layerStyle = null;
  // One shared <style> in the head hides off layers. CSS rather than toggling elements: it also applies to content
  // rendered later (popups, re-renders) and costs one style recalculation. Ids are LAYER_RE-validated, safe in a selector.
  function applyLayers(layers) {
    if (!layerStyle) { layerStyle = doc.createElement('style'); layerStyle.id = 'kp-layer-css'; doc.head.append(layerStyle); }
    const off = [];
    for (const l of layers || []) if (!layerOn(l)) off.push(l.id);
    layerStyle.textContent = off.map((id) => `#kp-main [data-layer="${id}"]{display:none!important}`).join('');
    for (const b of root.querySelectorAll('[data-kp-layer]')) {
      const l = (layers || []).find((x) => x.id === b.dataset.kpLayer);
      const on = l ? layerOn(l) : true;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.dataset.on = on ? '1' : '0';
    }
  }

  // ---- rendering
  const main = () => root.querySelector('#kp-main');
  let curLayers = [];
  // The prerender's .kp-layer-defaults style is removed: from here on applyLayers owns layer visibility (the reader's
  // stored choice may differ from the author's default).
  function setMain(out, route, info) {
    const m = main();
    if (!m) return;
    m.innerHTML = out.html;
    if (pt) pt.scan(m);
    const st = m.querySelector('.kp-layer-defaults');
    if (st) st.remove();
    curLayers = out.layers || [];
    applyLayers(curLayers);
    doc.title = out.title ? `${out.title} — ${site.title}` : site.title;
    const app = root.querySelector('#kp-app');
    if (app) app.dataset.route = route.path;
    for (const a of root.querySelectorAll('.kp-topnav a, .kp-side-main a')) a.classList.toggle('kp-cur', a.dataset.kpRoute === route.path);
    closeSide();
    hidePop();
    if (opts.onNavigate) opts.onNavigate(route, { title: out.title, kind: info.kind, pageId: info.pageId || '' });
  }

  function variantList(page) {
    const list = variants.get(page.id);
    return list && list.length ? [{ label: '', secret: false }, ...list] : [];
  }
  // Index 0 is the public page; i > 0 overlays the decrypted variant's fields and marks the result secret.
  function pageForVariant(page, i) {
    if (!i) return page;
    const v = variants.get(page.id)[i - 1];
    return { ...page, title: v.title || page.title, display: v.display, summary: v.summary, image: v.image || page.image, date: v.date || page.date,
      author: v.author || page.author, toc: v.toc, layout: v.layout, layers: v.layers, versions: v.versions, secret: true };
  }

  function renderPage(page, route, extra = {}) {
    curPage = page;
    const vl = variantList(page);
    let vi = vl.length ? Math.min(variantSel.get(page.id) ?? 0, vl.length - 1) : 0;
    const shown = pageForVariant(page, vi);
    const out = R.article(shown, { version: route.query.v, variants: vl, variant: vi, redirectedFrom: extra.redirectedFrom });
    setMain(out, route, { kind: 'page', pageId: page.id });
  }

  function renderSpecial(kind, arg, route, data) {
    curPage = null;
    const out = R.special(kind, arg, data);
    setMain(out, route, { kind });
    if (kind === 'missing') {
      const m = main();
      if (m) m.dataset.status = '404';
    }
  }

  // The password can arrive as ?451= in the query or as #?451= inside the fragment (fragments never reach the server,
  // so the password does not land in server logs). It is removed from the address bar immediately with replaceState,
  // so it does not stay in history or get shared by copying the URL.
  async function onRoute(route, info) {
    cur = route;
    // `#?451=password` (also inside the fragment of path URLs).
    let pw = route.query['451'];
    if (route.frag && route.frag[0] === '?') {
      const q = parseQuery(route.frag.slice(1));
      if (q['451'] != null) pw = q['451'];
      route = { ...route, frag: '' };
    }
    if (pw != null) {
      const query = { ...route.query };
      delete query['451'];
      route = { ...route, query };
      cur = route;
      if (router.mode !== 'memory') { try { win.history.replaceState(win.history.state, '', router.href(route)); } catch { /* sandboxed */ } }
      renderSpecial('busy', '', route);
      const n = await unlock(pw).catch(() => 0);
      if (n) {
        const r0 = R.resolveRoute(route.path);
        if (r0.kind === 'missing' || route.path === '') {
          const first = lastUnlocked.pages[0] || lastUnlocked.variantPages[0];
          if (first && first !== route.path) { router.go({ path: first, query: {}, frag: '' }, { replace: true }); return; }
        }
      }
    }
    const r = R.resolveRoute(route.path);
    // A variant unlocked just now is selected once on its page; the selection is then consumed.
    if (r.kind === 'page') { if (lastUnlocked.select.has(r.page.id)) { variantSel.set(r.page.id, lastUnlocked.select.get(r.page.id)); lastUnlocked.select.delete(r.page.id); } renderPage(r.page, route); }
    else if (r.kind === 'redirect') renderPage(r.page, route, { redirectedFrom: r.from.title });
    else if (r.kind === 'category') renderSpecial('category', r.arg, route);
    else if (r.kind === 'special') {
      const name = r.name;
      // Random redirects with replace:true so Back does not land on the random URL and bounce again. info.initial ===
      // 'loop' guards against a redirect loop; the all-pages list is the fallback.
      if (name === 'random') {
        const list = R.pages.filter((p) => !p.hidden && p.kind !== 'redirect' && (!curPage || p.slug !== curPage.slug));
        const p = list[Math.floor(Math.random() * list.length)];
        if (p && info.initial !== 'loop') { router.go({ path: R.routeOfPage(p), query: {}, frag: '' }, { replace: true }); return; }
        renderSpecial('all', '', route);
      } else if (name === 'search') {
        const q = route.query.q || '';
        const results = q ? getIndex().search(q) : [];
        const exact = q ? R.findPage(q) : null;
        // Portal entries (articles, terms, people, requests, obligations) in type tabs (?type=).
        const portal = q && R.portalSearch().size ? R.portalSearch().search(q, { type: route.query.type || '', limit: 100 }) : null;
        renderSpecial('search', q, route, { results, exact: exact && !exact.secret && exact.kind !== 'redirect' ? exact : null, portal, type: route.query.type || '' });
      } else if (['all', 'recent', 'categories', 'unlock'].includes(name)) renderSpecial(name, '', route);
      else if (name === 'links') renderSpecial('links', r.arg, route);
      else renderSpecial('missing', route.path, route);
    } else renderSpecial('missing', route.path, route);
  }

  // ---- 451
  const lastUnlocked = { pages: [], variantPages: [], select: new Map() };
  function selectVariants(map) { for (const [id, i] of Object.entries(map || {})) variantSel.set(id, +i || 0); }
  // Merge decrypted payloads: new secret pages are added by route, variants are deduplicated by JSON signature so
  // repeating an unlock with the same password does not add duplicate variants. Returns how many items were added.
  function addPayloads(payloads) {
    const r = applyPayloads(site, payloads);
    lastUnlocked.pages = [];
    lastUnlocked.variantPages = [];
    for (const [slug, p] of r.pages) { if (!unlocked.has(slug)) lastUnlocked.pages.push(slug); unlocked.set(slug, p); }
    for (const [id, list] of r.variants) {
      const have = variants.get(id) || [];
      const sig = new Set(have.map((v) => JSON.stringify(v)));
      const add = list.filter((v) => !sig.has(JSON.stringify(v)));
      if (!add.length) continue;
      variants.set(id, [...have, ...add]);
      lastUnlocked.select.set(id, have.length + 1);
      const page = (site.pages || []).find((p) => p.id === id);
      if (page) lastUnlocked.variantPages.push(R ? R.routeOfPage(page) : page.slug);
    }
    Object.assign(extraMedia, r.media);
    makeRenderer();
    return r.pages.size + [...r.variants.values()].reduce((s, l) => s + l.length, 0);
  }

  // Tries the password against every sealed envelope (secret.js). Derived keys, not the password, are kept in
  // sessionStorage, so reloads in this tab reopen the content without asking again (openAllWith at start).
  async function unlock(pw, onProgress) {
    if (!pw || !(site.sealed || []).length) return 0;
    const res = await unlockAll(pw, site.sealed, { onProgress });
    if (!res.payloads.length) return 0;
    const known = new Set(sessionKeys.map((k) => k.id + k.kdf.s));
    for (const k of res.keys) if (!known.has(k.id + k.kdf.s)) sessionKeys.push(k);
    store.sset(key('keys'), keysToJSON(sessionKeys));
    return addPayloads(res.payloads);
  }

  // ---- previews and footnote popups
  let pop = null, popTimer = 0, popFor = null;
  const popEl = () => (pop && pop.isConnected ? pop : (pop = root.querySelector('#kp-pop')));
  function hidePop() { clearTimeout(popTimer); popFor = null; const p = popEl(); if (p) p.hidden = true; }
  // Popup positioning in document coordinates: below the target, clamped 8px inside the viewport horizontally, flipped
  // above when it would overflow the bottom and fits above. For SVG regions the pointer position is used (pt), as the
  // region's bounding box can be large.
  function place(p, el, pt) {
    const r = el.getBoundingClientRect();
    const sx = win.scrollX, sy = win.scrollY, vw = doc.documentElement.clientWidth;
    p.hidden = false;
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let x = (pt ? pt.x : r.left) + sx;
    x = Math.max(sx + 8, Math.min(x, sx + vw - pw - 8));
    let y = r.bottom + sy + 6;
    if (r.bottom + ph + 12 > win.innerHeight && r.top - ph - 8 > 0) y = r.top + sy - ph - 6;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
  }
  // No previews for chrome links (top bar, side, breadcrumbs, suggestions, bars): they are navigation, not content.
  // KNOWN DEFECT: pv.img.src is interpolated into src="..." without esc(); a media URL containing '"' (an inline media
  // string supplied to the preview) would break out of the attribute. Fix: esc(pv.img.src), as openLightbox does.
  function showPreview(a, pt) {
    const route = a.getAttribute('data-kp-route');
    if (route == null || (site.settings && site.settings.previews === false)) return;
    if (a.closest('.kp-top, .kp-side, .kp-crumbs, .kp-sugg, .kp-pop, .kp-bar')) return;
    const pv = R.preview(route);
    const p = popEl();
    if (!pv || !p) return;
    p.className = 'kp-pop';
    p.innerHTML = (pv.img ? `<img class="kp-pop-img" src="${pv.img.src}" alt="">` : '') + `<div class="kp-pop-b">${pv.secret ? `<div class="kp-pop-s">${esc(t('r.secretPage'))}</div>` : ''}<div class="kp-pop-t">${esc(pv.title)}</div>${pv.text ? `<div class="kp-pop-x">${esc(pv.text)}</div>` : ''}</div>`;
    place(p, a, pt);
  }
  // Footnote popups copy the note's already-rendered (safe) HTML from the page.
  function showRef(a) {
    const id = a.getAttribute('data-kp-ref');
    const li = id && doc.getElementById(id);
    const p = popEl();
    if (!li || !p) return;
    const txt = li.querySelector('.kp-ref-text');
    p.className = 'kp-pop kp-pop-ref';
    p.innerHTML = `<div class="kp-pop-b">${txt ? txt.innerHTML : ''}</div>`;
    place(p, a);
  }
  function showTip(el) {
    const b = el.querySelector('.kp-tipb');
    const p = popEl();
    if (!b || !p) return;
    p.className = 'kp-pop kp-pop-ref';
    p.innerHTML = `<div class="kp-pop-b">${b.innerHTML}</div>`;
    place(p, el);
  }
  function showNote(el) {
    const n = el.querySelector('.kp-dia-note');
    const p = popEl();
    if (!n || !p) return;
    p.className = 'kp-pop kp-pop-ref';
    p.innerHTML = `<div class="kp-pop-b"><div class="kp-pop-t">${el.querySelector('.kp-dia-t') ? el.querySelector('.kp-dia-t').innerHTML : ''}</div>${n.innerHTML}</div>`;
    place(p, el);
  }
  // Local escaper (also escapes ') for attribute and text contexts in the reader's own templates.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hoverTarget(e) {
    const el = e.target && e.target.closest ? e.target.closest('a[data-kp-route], a[data-kp-ref], .kp-tip, .kp-dia-lbl, svg a[data-kp-route]') : null;
    return el && root.contains(el) ? el : null;
  }
  // Touch pointers are ignored: there is no hover on touch, and a tap would both open a popup and follow the link.
  function onOver(e) {
    if (e.pointerType === 'touch') return;
    const el = hoverTarget(e);
    highlightDia(e.target, true);
    if (!el || el === popFor) return;
    clearTimeout(popTimer);
    popFor = el;
    const pt = el.closest('svg') ? { x: e.clientX, y: e.clientY } : null;
    popTimer = setTimeout(() => {
      if (popFor !== el) return;
      if (el.matches('a[data-kp-ref]')) showRef(el);
      else if (el.matches('.kp-tip')) showTip(el);
      else if (el.matches('.kp-dia-lbl') && !el.hasAttribute('data-kp-route')) showNote(el);
      else showPreview(el, pt);
    }, el.matches('a[data-kp-ref], .kp-tip') ? 200 : HOVER_DELAY);
  }
  // Moving from the link into the popup keeps it open (relatedTarget check); otherwise it hides after 180ms, which
  // gives the pointer time to cross the gap.
  function onOut(e) {
    highlightDia(e.target, false);
    const el = hoverTarget(e);
    if (!el) return;
    const to = e.relatedTarget;
    const p = popEl();
    if (to && (el.contains(to) || (p && p.contains(to)))) return;
    clearTimeout(popTimer);
    popTimer = setTimeout(hidePop, 180);
  }
  // Label, region and legend entry share data-i; hovering any one highlights all three.
  function highlightDia(target, on) {
    const el = target && target.closest ? target.closest('.kp-dia-lbl, .kp-dia-it, .kp-dia-legend li') : null;
    if (!el) return;
    const fig = el.closest('.kp-dia');
    const i = el.getAttribute('data-i') || (el.closest('[data-i]') && el.closest('[data-i]').getAttribute('data-i'));
    if (!fig || !i) return;
    for (const x of fig.querySelectorAll(`[data-i="${i}"]`)) x.classList.toggle('kp-hl', on);
  }

  // ---- search box
  let sugg = [], suggSel = -1;
  // Combobox pattern: the input keeps focus, aria-activedescendant points at the highlighted option, aria-expanded
  // reflects the listbox. Options carry tabindex=-1 so Tab leaves the widget instead of walking the suggestions.
  function renderSugg(input) {
    const box = root.querySelector('#kp-sugg');
    if (!box) return;
    const q = input.value.trim();
    if (!q) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    sugg = getIndex().suggest(q, 7);
    suggSel = -1;
    const item = (s, i) => {
      const pv = R.preview(R.routeOfPage(s.page)) || {};
      const route = R.routeOfPage(s.page);
      return `<li role="option" id="kp-sg-${i}" aria-selected="false"><a href="${esc(router.href({ path: route, query: {}, frag: '' }))}" data-kp-route="${esc(route)}" tabindex="-1">${pv.img ? `<img src="${pv.img.src}" alt="">` : ''}<span><b>${s.titleHTML}</b>${pv.text ? `<small>${esc(pv.text.slice(0, 90))}</small>` : ''}</span></a></li>`;
    };
    box.innerHTML = sugg.map(item).join('') + `<li role="option" id="kp-sg-${sugg.length}" class="kp-sugg-all" aria-selected="false"><a href="${esc(router.href({ path: 'special/search', query: { q }, frag: '' }))}" tabindex="-1">${esc(t('r.searchAll', { q }))}</a></li>`;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function closeSugg() {
    const box = root.querySelector('#kp-sugg');
    if (box) box.hidden = true;
    const i = root.querySelector('#kp-q');
    if (i) { i.setAttribute('aria-expanded', 'false'); i.removeAttribute('aria-activedescendant'); }
  }
  function onInput(e) { if (e.target.id === 'kp-q') renderSugg(e.target); }
  // Arrow keys cycle through the options plus a "no selection" state (-1), so the user can return to the typed text.
  // Space/Enter activate spoilers and tips, which are spans with role=button (native buttons would do this themselves).
  function onKey(e) {
    if (e.target.id === 'kp-q') {
      const box = root.querySelector('#kp-sugg');
      if (!box || box.hidden) return;
      const items = [...box.querySelectorAll('li')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        suggSel = (suggSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length + 1) % (items.length + 1);
        if (suggSel === items.length) suggSel = -1;
        items.forEach((li, i) => li.setAttribute('aria-selected', String(i === suggSel)));
        if (suggSel >= 0) e.target.setAttribute('aria-activedescendant', items[suggSel].id); else e.target.removeAttribute('aria-activedescendant');
      } else if (e.key === 'Enter' && suggSel >= 0) {
        e.preventDefault();
        const a = items[suggSel].querySelector('a');
        closeSugg();
        e.target.value = '';
        a.click();
      } else if (e.key === 'Escape') closeSugg();
      return;
    }
    if (e.key === 'Escape') { hidePop(); closeSide(); closeLightbox(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.kp-spoiler, .kp-tip')) { e.preventDefault(); e.target.click(); }
  }

  // ---- misc interactions
  function closeSide() {
    const app = root.querySelector('#kp-app');
    if (app && app.classList.contains('kp-side-open')) {
      app.classList.remove('kp-side-open');
      const b = root.querySelector('.kp-burger');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
  }
  let lightbox = null;
  function closeLightbox() { if (lightbox) { lightbox.remove(); lightbox = null; } }
  // Modal dialog built on demand; focus moves to its close button and returns to the opener on close (focus restore).
  function openLightbox(btn) {
    const img = btn.querySelector('img');
    if (!img) return;
    const fig = btn.closest('figure');
    const cap = fig && fig.querySelector(':scope > figcaption');
    lightbox = doc.createElement('div');
    lightbox.className = 'kp-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.innerHTML = `<figure><img src="${esc(img.getAttribute('src'))}" alt="${esc(img.getAttribute('alt') || '')}">${cap ? `<figcaption>${cap.innerHTML}</figcaption>` : ''}</figure><button type="button" aria-label="${esc(t('r.close'))}">×</button>`;
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target.closest('button')) { closeLightbox(); btn.focus(); } });
    doc.body.append(lightbox);
    lightbox.querySelector('button').focus();
  }
  // Numbers are compared numerically after normalising spaces, thousands separators, decimal comma and Unicode minus;
  // text uses localeCompare in the base's language. aria-sort tells assistive tech the current order.
  function sortTable(th) {
    const table = th.closest('table');
    const idx = [...th.parentNode.children].indexOf(th);
    const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    for (const x of th.parentNode.children) x.removeAttribute('aria-sort');
    th.setAttribute('aria-sort', dir);
    const tb = table.tBodies[0];
    const rows = [...tb.rows];
    const val = (r) => { const c = r.cells[idx]; const s = c ? c.textContent.trim() : ''; const n = parseFloat(s.replace(/[\s ]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.').replace('−', '-')); return /^[-+−]?[\d\s .,]+/.test(s) && Number.isFinite(n) ? n : s.toLowerCase(); };
    rows.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), site.lang); return dir === 'ascending' ? c : -c; });
    for (const r of rows) tb.append(r);
  }
  let audio = null, audioBtn = null;
  // One shared Audio element: starting a new clip stops the previous; clicking the playing button pauses it.
  function playSay(btn) {
    const src = btn.getAttribute('data-kp-audio');
    if (audio && audioBtn === btn && !audio.paused) { audio.pause(); return; }
    if (audio) audio.pause();
    if (audioBtn) audioBtn.classList.remove('kp-playing');
    audio = new win.Audio(src);
    audioBtn = btn;
    btn.classList.add('kp-playing');
    audio.addEventListener('ended', () => btn.classList.remove('kp-playing'));
    audio.addEventListener('pause', () => btn.classList.remove('kp-playing'));
    audio.play().catch(() => btn.classList.remove('kp-playing'));
  }
  // The timeupdate listener is bound once per audio element (dataset flag) and highlights the last line whose start
  // time has passed; 50ms tolerance absorbs timeupdate granularity.
  function ilPlay(btn) {
    const sec = btn.closest('.kp-il');
    const a = sec && sec.querySelector('.kp-il-audio');
    if (!a) return;
    a.currentTime = +btn.dataset.t || 0;
    a.play().catch(() => {});
    if (!a.dataset.kpBound) {
      a.dataset.kpBound = '1';
      a.addEventListener('timeupdate', () => {
        const lines = [...sec.querySelectorAll('.kp-il-line[data-t]')];
        let curLine = null;
        for (const l of lines) if (+l.dataset.t <= a.currentTime + 0.05) curLine = l;
        for (const l of lines) l.classList.toggle('kp-cur', l === curLine);
      });
    }
  }

  // Search and unlock forms are handled client side (preventDefault); the unlock password is cleared from the field
  // right after use.
  async function onSubmit(e) {
    const f = e.target;
    if (f.matches('[data-kp-search]')) {
      e.preventDefault();
      const q = (f.querySelector('input[name="q"]') || {}).value || '';
      closeSugg();
      router.go({ path: 'special/search', query: q.trim() ? { q: q.trim() } : {}, frag: '' });
      const i = root.querySelector('#kp-q');
      if (i && f.contains(i)) i.blur();
    } else if (f.matches('[data-kp-unlock]')) {
      e.preventDefault();
      const input = f.querySelector('input[name="pw"]');
      const msg = f.querySelector('.kp-unlock-msg');
      const btn = f.querySelector('button');
      if (!input || !input.value) return;
      btn.disabled = true;
      msg.className = 'kp-unlock-msg';
      msg.innerHTML = `<span class="kp-busy"><span class="kp-spin" aria-hidden="true"></span> ${esc(t('r.unlocking'))}</span>`;
      const n = await unlock(input.value).catch(() => 0);
      btn.disabled = false;
      input.value = '';
      if (!n) { msg.textContent = t('r.unlockWrong'); return; }
      msg.className = 'kp-unlock-msg kp-ok';
      const links = [...lastUnlocked.pages, ...lastUnlocked.variantPages].map((path) => {
        const p = R.findPage(path) || unlocked.get(path);
        return `<li><a class="kp-link" href="${esc(router.href({ path, query: {}, frag: '' }))}" data-kp-route="${esc(path)}">${esc(p ? p.title : path)}</a></li>`;
      }).join('');
      msg.innerHTML = `${esc(t('r.unlockedN', { n }))}${links ? `<ul>${links}</ul>` : ''}`;
    }
  }

  // Ordered dispatch: the first matching control wins. Clicks outside the open drawer close it and are swallowed, so
  // the first tap does not also follow a link under the overlay.
  function onClick(e) {
    const el = e.target;
    if (!el || !el.closest) return;
    const q = (s) => el.closest(s);
    let x;
    if ((x = q('[data-kp-layer]'))) {
      const id = x.dataset.kpLayer;
      const l = curLayers.find((y) => y.id === id) || { id, on: true };
      layerState = { ...layerState, [id]: !layerOn(l) };
      store.set(key('layers'), layerState);
      applyLayers(curLayers);
      return;
    }
    if ((x = q('[data-kp-variant]'))) {
      if (!curPage) return;
      variantSel.set(curPage.id, +x.dataset.kpVariant || 0);
      const y = win.scrollY;
      renderPage(curPage, cur);
      win.scrollTo(0, y);
      return;
    }
    if ((x = q('.kp-burger'))) {
      const app = root.querySelector('#kp-app');
      const open = !app.classList.contains('kp-side-open');
      app.classList.toggle('kp-side-open', open);
      x.setAttribute('aria-expanded', String(open));
      if (open) { const f = root.querySelector('.kp-side a'); if (f) f.focus(); }
      return;
    }
    if (q('#kp-app.kp-side-open') && !q('.kp-side')) { closeSide(); e.preventDefault(); return; }
    // The toggle flips the scheme currently in effect (explicit choice, else theme, else OS preference) and stores it.
    if ((x = q('.kp-scheme'))) {
      const html = doc.documentElement;
      const dark = win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = html.getAttribute('data-kp-theme');
      const curScheme = html.getAttribute('data-kp-scheme') || (theme === 'fandom-dark' ? 'dark' : dark ? 'dark' : 'light');
      const next = curScheme === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-kp-scheme', next);
      store.set('kp-scheme', next);
      return;
    }
    if ((x = q('.kp-spoiler'))) { x.classList.add('kp-shown'); x.setAttribute('aria-pressed', 'true'); return; }
    if ((x = q('.kp-card'))) { x.setAttribute('aria-pressed', x.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); return; }
    if ((x = q('[data-kp-zoom]'))) { if (!opts.editor) openLightbox(x); return; }
    if ((x = q('.kp-say'))) { if (x.hasAttribute('data-kp-audio')) playSay(x); return; }
    if ((x = q('.kp-il-play'))) { ilPlay(x); return; }
    if ((x = q('.kp-sortable thead th'))) { sortTable(x); return; }
    if ((x = q('.kp-tip'))) { if (popFor === x && popEl() && !popEl().hidden) hidePop(); else { popFor = x; showTip(x); } return; }
    if ((x = q('.kp-dia-lbl')) && !x.hasAttribute('href')) { popFor = x; showNote(x); return; }
    if ((x = q('a[data-kp-ref]'))) {
      // Footnote markers: scroll to the note (the router handles the fragment) and keep the popup away.
      hidePop();
      return;
    }
    if (opts.editor && opts.onBlock && (x = q('[data-bid]')) && !q('a, button, summary, input')) { opts.onBlock(x.dataset.bid); return; }
    if (!q('.kp-pop')) hidePop();
  }
  function onDocClick(e) {
    // Clicks outside the search box close the suggestions.
    if (!e.target.closest || !e.target.closest('.kp-search')) closeSugg();
  }

  let topBtn = null;
  function onScroll() {
    if (!topBtn) return;
    topBtn.classList.toggle('kp-show', win.scrollY > 900);
  }

  // The unlock tool is removed when the base has no sealed content: an unlock page with nothing to unlock is noise.
  function renderShell() {
    root.innerHTML = R.shell('', { route: cur ? cur.path : '' });
    if (!opts.editor) {
      topBtn = doc.createElement('button');
      topBtn.type = 'button';
      topBtn.className = 'kp-totop';
      topBtn.setAttribute('aria-label', t('r.top'));
      topBtn.innerHTML = icon('top');
      topBtn.addEventListener('click', () => { win.scrollTo({ top: 0, behavior: 'smooth' }); const m = main(); if (m) m.focus({ preventScroll: true }); });
      root.querySelector('#kp-app').append(topBtn);
    }
    const tools = root.querySelector('[data-kp-unlock-link]');
    if (tools && !(site.sealed || []).length) tools.closest('li').remove();
  }

  // ---- start
  applyTheme(site, doc);
  // focus(): after each navigation the router moves focus to the page title (data-spa-focus).
  router = createRouter({
    mode: opts.mode || 'hash', base: opts.base || '/', style: opts.style || 'clean',
    onRoute,
    focus: () => root.querySelector('[data-spa-focus]'),
  });
  makeRenderer();
  // Reopen with keys from this tab's session; the editor preview receives payloads directly instead.
  if (sessionKeys.length && (site.sealed || []).length && !opts.editor) {
    const pl = openAllWith(sessionKeys, site.sealed);
    if (pl.length) { addPayloads(pl); lastUnlocked.select.clear(); }
  }
  if (opts.payloads && opts.payloads.length) { addPayloads(opts.payloads); lastUnlocked.select.clear(); }
  if (opts.select) selectVariants(opts.select);
  renderShell();
  // Runtime of the portal blocks (../portal/runtime.js): scroll-spy, copy link, term tooltips, lists, checklists;
  // every rendered page is scanned again (setMain).
  pt = startPortal({
    t: (k, v) => t(k, v), lang: () => site.lang || 'en', get sid() { return site.id; },
    store: { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } } },
  });
  root.addEventListener('click', onClick);
  root.addEventListener('mouseover', onOver);
  root.addEventListener('mouseout', onOut);
  root.addEventListener('focusin', (e) => { const el = hoverTarget(e); if (el && el.matches('a[data-kp-route], .kp-tip') && !el.closest('.kp-sugg')) { popFor = el; clearTimeout(popTimer); popTimer = setTimeout(() => (el.matches('.kp-tip') ? showTip(el) : showPreview(el)), HOVER_DELAY); } });
  root.addEventListener('focusout', () => { clearTimeout(popTimer); popTimer = setTimeout(hidePop, 150); });
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  root.addEventListener('submit', onSubmit);
  doc.addEventListener('click', onDocClick);
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', hidePop);
  router.start(opts.initial || '');

  return {
    go: (r, o) => router.go(r, o),
    // Shows a route again even when it is the current one (editor preview after a variant change).
    // Re-rendering the current route explicitly: router.go would ignore navigation to the same URL.
    show(r, select) {
      if (select) selectVariants(select);
      const c = cur;
      const target = typeof r === 'string' ? r : '';
      if (c && (c.path === target.split('?')[0].split('#')[0]) && !target.includes('?')) return onRoute(c, {});
      return router.go(r);
    },
    current: () => cur,
    unlock: (pw) => unlock(pw).then((n) => { if (n && cur) onRoute(cur, {}); return n; }),
    router,
    // Replaces the published data (editor preview): the current route is rendered again.
    // extra: { payloads (decrypted 451 payloads to show, replacing the unlocked ones), select: { pageId: variant index } }
    // Editor preview update. Object URLs of media whose bytes changed (or disappeared) are revoked; unchanged ones are kept
    // to avoid image flicker. Scroll position is restored after the re-render.
    setSite(next, nextMedia, extra = {}) {
      site = next;
      t = readerT(site.uiLang);
      unlocked.clear();
      variants.clear();
      for (const k of Object.keys(extraMedia)) { const u = blobURLs.get(k); if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); blobURLs.delete(k); delete extraMedia[k]; }
      if (nextMedia) {
        // Blobs arrive as new objects with every update: the same size and type count as the same file.
        const sig = (v) => (v instanceof Blob ? 'b' + v.size + ':' + v.type : String(v).slice(0, 64) + String(v).length);
        for (const [id, url] of [...blobURLs]) if (media[id] != null && (nextMedia[id] == null || sig(media[id]) !== sig(nextMedia[id])) && url && url.startsWith('blob:')) { URL.revokeObjectURL(url); blobURLs.delete(id); }
        media = nextMedia;
      }
      layerState = store.get(key('layers')) || {};
      applyTheme(site, doc);
      makeRenderer();
      if (extra.payloads && extra.payloads.length) { addPayloads(extra.payloads); lastUnlocked.select.clear(); }
      if (extra.select) selectVariants(extra.select);
      const y = win.scrollY;
      renderShell();
      if (cur) onRoute(cur, {}).then(() => win.scrollTo(0, y));
    },
    // KNOWN DEFECT: the anonymous focusin/focusout listeners and the window resize listener are not removed, and the
    // portal runtime (pt) is not stopped, so a stopped reader still reacts to focus and resize. Fix: name those handlers
    // and remove them here, and stop pt if its API offers it.
    stop() {
      router.stop();
      root.removeEventListener('click', onClick);
      root.removeEventListener('mouseover', onOver);
      root.removeEventListener('mouseout', onOut);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('submit', onSubmit);
      doc.removeEventListener('click', onDocClick);
      win.removeEventListener('scroll', onScroll);
      for (const url of blobURLs.values()) if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
    },
  };
}
