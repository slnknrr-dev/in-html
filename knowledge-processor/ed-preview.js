// knowledge-processor/ed-preview.js - the live preview (right column): the real reader in a frame (memory routes)
// with the current data, unlocked 451 content and media; device widths; the address of the page in each export mode
// (one file: #/page, static site: /base/page, server: /page); back / forward; open the one-file export in a new tab;
// two-way sync with the editor (selecting a page shows it, following a link selects its page, a click on a block
// selects it) and a context menu on links (open, edit, create, copy link).
//
// Approach: the preview runs the real reader bundle (the code that ships in exports) in an iframe built with
// srcdoc, and feeds it data by postMessage. Why not render the page in the editor DOM: reader CSS and scripts would
// collide with the editor's, and "what you see" would not be what exports produce.
// Protocol (messages carry `kp`): editor -> frame 'load' (whole site + route), 'update' (new data, keep route),
// 'go' (navigate); frame -> editor 'ready', 'nav' (route changed), 'block' (a block was clicked).
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { openMenu, toast } from '../ui/overlays.js';
import { S, commit, on, select, target } from './state.js';
import { buildSite } from './site.js';
import { readerCSS } from './reader-css.js';
import { readerCode } from './bundles.js';
import { pageBySlug } from './model.js';
import { pathOf } from '../spa/base.js';
import { allMediaBlobs, mediaBlob, payloadMedia } from './ed-media.js';
import { exportSingle } from './export.js';
import { createPage, routeOf } from './ed-pages.js';

// Device emulation widths in CSS px (0 = fill the column). 390 = common modern phone, 820 = tablet portrait.
const DEVICES = { desktop: 0, tablet: 820, phone: 390 };
const MODES = ['single', 'static', 'server'];

export function createPreview(box) {
  let frame = null, ready = false, route = '', mode = lsGet('kp-ed-pmode', 'single'), device = lsGet('kp-ed-device', 'desktop');
  // follow: navigation inside the preview selects that page in the editor. lastSent: the route the editor last asked
  // for, used to avoid an echo loop (editor selects -> preview navigates -> 'nav' -> editor selects ...).
  let follow = true, lastSent = '';
  const addr = h('code', { class: 'kp-pv-addr', title: t('kp.addressHint') });
  const back = h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kp.back'), 'aria-label': t('kp.back'), onclick: () => frame && frame.contentWindow.history.back() }, iconEl('chevLeft'));
  const modeSel = h('select', { class: 'ed-input ed-select ed-sm kp-pv-mode', 'aria-label': t('kp.previewMode') }, MODES.map((m) => h('option', { value: m, selected: m === mode }, t('kp.mode.' + m))));
  modeSel.addEventListener('change', () => { mode = modeSel.value; lsSet('kp-ed-pmode', mode); paintAddr(); });
  const dev = h('div', { class: 'ed-seg kp-pv-dev', role: 'radiogroup', 'aria-label': t('kp.device') }, Object.keys(DEVICES).map((d) => h('button', {
    type: 'button', role: 'radio', class: 'ed-seg-btn' + (d === device ? ' ed-on' : ''), 'aria-checked': String(d === device), title: t('kp.dev.' + d), 'aria-label': t('kp.dev.' + d),
    onclick: () => { device = d; lsSet('kp-ed-device', d); for (const b of dev.children) { const on1 = b === dev.children[Object.keys(DEVICES).indexOf(d)]; b.classList.toggle('ed-on', on1); b.setAttribute('aria-checked', String(on1)); } fit(); },
  }, iconEl(d === 'desktop' ? 'monitor' : d === 'tablet' ? 'tablet' : 'phone'))));
  const openBtn = h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('kp.openTab'), 'aria-label': t('kp.openTab'), onclick: openInTab }, iconEl('external'));
  const stage = h('div', { class: 'kp-pv-stage' });
  box.replaceChildren(h('div', { class: 'kp-pv-bar' }, back, addr, modeSel, dev, openBtn), stage);

  // Shows what the current route would look like in the chosen export mode. Illustrative only: example.org and
  // localhost:8080 stand in for the real host; pathOf is the same mapping the static exporter uses.
  function paintAddr() {
    const r = route;
    const base = '/' + (S.kb ? (S.kb.title || 'kb').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'kb') + '/';
    addr.textContent = mode === 'single' ? `${(S.kb && S.kb.title) || 'kb'}.html#/${r}` : mode === 'static' ? `https://example.org${pathOf(r.split('?')[0], base, 'clean')}${r.includes('?') ? '?' + r.split('?')[1] : ''}` : `http://localhost:8080${pathOf(r.split('?')[0], '/', 'clean')}${r.includes('?') ? '?' + r.split('?')[1] : ''}`;
  }

  // Device mode: if the device width does not fit, the frame keeps its true width (media queries inside see the
  // device width) and is scaled down with transform; height is divided by the scale so the scaled frame still fills
  // the stage. Scaling the layout instead (zoom) would change what the reader's breakpoints see.
  function fit() {
    if (!frame) return;
    const w = DEVICES[device];
    const avail = stage.clientWidth - 2;
    if (!w || w <= avail) { frame.style.width = w ? w + 'px' : '100%'; frame.style.transform = ''; frame.style.height = '100%'; stage.classList.toggle('kp-pv-dev-on', !!w); return; }
    const k = avail / w;
    frame.style.width = w + 'px';
    frame.style.height = (stage.clientHeight / k) + 'px';
    frame.style.transform = `scale(${k})`;
    stage.classList.add('kp-pv-dev-on');
  }
  // ResizeObserver, not window resize: the stage also changes size when columns are toggled.
  new ResizeObserver(fit).observe(stage);

  // Unlocked 451 payloads go to the preview in clear (it is this tab's own frame); they never enter exports.
  function payloads() {
    const out = [];
    for (const p of S.kb.pages) for (const s of p.secrets || []) {
      const u = S.unlocked.get(s.id);
      if (!u) continue;
      const m = payloadMedia(u.payload);
      out.push(m ? { ...u.payload, media: m } : u.payload);
    }
    return out;
  }

  // The whole site is rebuilt and sent on every (debounced) change: simple and always consistent. Media as Blobs:
  // structured clone passes them by reference, no base64 copies.
  async function send(kind) {
    if (!frame || !ready || !S.kb) return;
    const site = buildSite(S.kb);
    const media = await allMediaBlobs();
    const msg = { kp: kind, site, media, payloads: payloads() };
    const select2 = variantSelection();
    if (select2) msg.select = select2;
    if (kind === 'load') msg.route = route;
    // targetOrigin '*': a srcdoc frame inherits this page's origin, but under file:// origins are opaque ("null") and a
    // concrete targetOrigin would not match. Acceptable because the frame only ever holds our own srcdoc document.
    frame.contentWindow.postMessage(msg, '*');
  }
  // The secret variant being edited is the one the preview shows.
  // Reader variant index: 0 = public content, k = k-th unlocked secret variant (the reader numbers only the variants
  // it received, hence the filter by S.unlocked before findIndex).
  function variantSelection() {
    const tg = target();
    if (!tg || tg.kind !== 'variant') return tg && tg.kind === 'page' ? { [tg.page.id]: 0 } : null;
    const idx = tg.page.secrets.filter((s) => S.unlocked.has(s.id)).findIndex((s) => s.id === tg.secret.id);
    return idx >= 0 ? { [tg.page.id]: idx + 1 } : null;
  }

  async function build() {
    let code = '';
    try { code = await readerCode(); } catch (e) {
      stage.replaceChildren(h('p', { class: 'ed-hint kp-pad' }, t('kp.previewUnavailable'), ' ', String(e.message || e)));
      return;
    }
    ready = false;
    frame = h('iframe', { class: 'kp-pv-frame', title: t('kp.preview') });
    const theme = document.documentElement.getAttribute('data-theme');
    // srcdoc instead of a blob: URL: inherits the origin (contentDocument access for the context menu), no URL to
    // revoke. '</script' inside the bundle would end the inline <script> early, so it is escaped as '<\/script'
    // (identical meaning inside JS strings and regexes). data-kp-scheme passes the editor's explicit theme choice.
    frame.srcdoc = `<!doctype html><html data-kp-mode="preview"${theme ? ` data-kp-scheme="${theme}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${readerCSS(null)}</style></head><body><script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
    stage.replaceChildren(frame);
    fit();
  }

  // Accept messages only from our frame (e.source check): any other window could post look-alike objects.
  window.addEventListener('message', (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.kp === 'ready') { ready = true; send('load'); attachContextMenu(); }
    else if (m.kp === 'nav') {
      route = m.route || '';
      paintAddr();
      if (follow && m.kind === 'page' && m.pageId && m.pageId !== S.pageId && S.kb.pages.some((p) => p.id === m.pageId)) { lastSent = route; select({ pageId: m.pageId }); }
      attachContextMenu();
    } else if (m.kp === 'block') {
      select({ blockId: m.id });
      requestAnimationFrame(() => { const c = document.querySelector(`.kp-bc[data-bid="${m.id}"]`); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    }
  });

  // Right click / long press on links inside the preview.
  // Re-attached after each navigation because the reader may replace its document; __kpCtx marks a document that
  // already has the listener. Menu coordinates: frame offset + event point times the device scale factor.
  function attachContextMenu() {
    const doc = frame && frame.contentDocument;
    if (!doc || doc.__kpCtx) return;
    doc.__kpCtx = true;
    doc.addEventListener('contextmenu', (e) => {
      const a = e.target.closest && e.target.closest('a[data-kp-route]');
      if (!a) return;
      e.preventDefault();
      const r = frame.getBoundingClientRect();
      const k = frame.style.transform ? r.width / frame.offsetWidth : 1;
      const path = a.getAttribute('data-kp-route');
      const p = pageBySlug(S.kb, path) || (path === '' ? S.kb.pages.find((x) => x.id === S.kb.home) : null);
      const missing = a.classList.contains('kp-new');
      openMenu({ x: r.left + e.clientX * k, y: r.top + e.clientY * k }, [
        { header: true, label: a.textContent.trim().slice(0, 40) },
        { label: t('kp.openHere'), icon: 'eye', action: () => go(path) },
        p ? { label: t('kp.editPage'), icon: 'edit', action: () => select({ pageId: p.id }) } : null,
        missing ? { label: t('kp.createPage'), icon: 'filePlus', action: () => { const np = createPage(''); commit((kb) => { const x = kb.pages.find((y) => y.id === np.id); x.title = a.textContent.trim(); x.slug = path; }, { structure: true }); } } : null,
        // Copies wiki-link markup ([[slug]]), ready to paste into another page's text.
        { label: t('kp.copyLink'), icon: 'copy', action: () => navigator.clipboard && navigator.clipboard.writeText(`[[${path}]]`).then(() => toast(t('kp.copied'), 'ok')) },
      ]);
    });
  }

  function go(r) {
    route = r;
    paintAddr();
    if (frame && ready) frame.contentWindow.postMessage({ kp: 'go', route: r, select: variantSelection() }, '*');
  }

  // Builds the real one-file export and opens it as a blob: URL. Revoked after 60 s: long enough for the new tab
  // to load, short enough not to keep a large Blob alive for the session.
  async function openInTab() {
    try {
      const code = await readerCode();
      const html = await exportSingle(S.kb, { mediaData: async (id) => { const b = await mediaBlob(id); return b ? new Uint8Array(await b.arrayBuffer()) : null; }, readerCode: code });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const w = window.open(url + (route ? '#/' + route : ''), '_blank');
      if (!w) toast(t('kp.popupBlocked'), 'warn');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast(String(e.message || e), 'error'); }
  }

  let timer = 0;
  // Debounced 300 ms: rebuilding the site on every keystroke would stall typing on large bases.
  on('change', () => { clearTimeout(timer); timer = setTimeout(() => send('update'), 300); });
  // Locked 451 pages have no route (null) and are not previewed.
  on('select', (o) => {
    if (o.pageId === undefined && o.sid === undefined) return;
    const p = S.kb.pages.find((x) => x.id === S.pageId);
    const r = p ? routeOf(p) : null;
    if (r == null) return;
    if (o.sid !== undefined) send('update');
    if (r !== lastSent || r !== route) { lastSent = r; go(r); }
  });
  on('kb', () => { route = ''; send('load'); });
  build();
  paintAddr();
  return { go, reload: build, setFollow: (v) => { follow = v; }, openInTab, get route() { return route; } };
}
