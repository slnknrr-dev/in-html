// site-studio/wiki-ed-preview.js - the live preview (right column): the real reader in a frame (memory routes)
// with the current data, unlocked 451 content and media; device widths; the address of the page in each export mode
// (one file: #/page, static site: /base/page, server: /page); back / forward; open the one-file export in a new tab;
// two-way sync with the editor (selecting a page shows it, following a link selects its page, a click on a block
// selects it) and a context menu on links (open, edit, create, copy link).
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { openMenu, toast } from '../ui/overlays.js';
import { S, commit, on, select, target } from './wiki-state.js';
import { buildSite } from './wiki-site.js';
import { readerCSS } from './wiki-reader-css.js';
import { readerCode } from './wiki-bundles.js';
import { pageBySlug } from './wiki-model.js';
import { pathOf } from '../spa/base.js';
import { allMediaBlobs, mediaBlob, payloadMedia } from './wiki-ed-media.js';
import { exportSingle } from './wiki-export.js';
import { createPage, routeOf } from './wiki-ed-pages.js';

// Design rules:
// - The preview runs the real reader bundle (readerCode) in a srcdoc iframe, so what the author sees is exactly
// what readers get; only the router is in 'memory' mode (no URL changes in the editor window).
// - The frame is a separate document: editor CSS cannot leak into it and reader CSS cannot leak out.
// - Communication is postMessage only (see wiki-reader-boot.js for the protocol); on every change the whole site
// (buildSite) plus media blobs is posted. Simple and always consistent; costs a structured clone per update, cheap
// for Blobs (passed by reference) and acceptable for document-sized JSON.
// Device widths: 820 (tablet) and 390 (modern phone CSS width); 0 = fill the column.
const DEVICES = { desktop: 0, tablet: 820, phone: 390 };
const MODES = ['single', 'static', 'server'];

export function createPreview(box) {
  let frame = null, ready = false, route = '', mode = lsGet('kp-ed-pmode', 'single'), device = lsGet('kp-ed-device', 'desktop');
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

  function paintAddr() {
    const r = route;
    const base = '/' + (S.kb ? (S.kb.title || 'kb').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'kb') + '/';
    addr.textContent = mode === 'single' ? `${(S.kb && S.kb.title) || 'kb'}.html#/${r}` : mode === 'static' ? `https://example.org${pathOf(r.split('?')[0], base, 'clean')}${r.includes('?') ? '?' + r.split('?')[1] : ''}` : `http://localhost:8080${pathOf(r.split('?')[0], '/', 'clean')}${r.includes('?') ? '?' + r.split('?')[1] : ''}`;
  }

  // Device emulation: when the device is wider than the column, the frame keeps the device width (so media queries
  // inside fire as on the device) and is scaled down with transform; its height is divided by the same factor so the
  // scaled frame still fills the stage.
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
  new ResizeObserver(fit).observe(stage);

  // Unlocked 451 payloads are sent decrypted (with their secret media) so the author previews secret pages; the frame is local and never persists them.
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

  async function send(kind) {
    if (!frame || !ready || !S.kb) return;
    const site = buildSite(S.kb);
    const media = await allMediaBlobs();
    const msg = { kp: kind, site, media, payloads: payloads() };
    const select2 = variantSelection();
    if (select2) msg.select = select2;
    if (kind === 'load') msg.route = route;
    frame.contentWindow.postMessage(msg, '*');
  }
  // The secret variant being edited is the one the preview shows.
  // The preview shows the variant currently being edited: index among the unlocked variants + 1 (0 is the public page), matching the reader's numbering.
  function variantSelection() {
    const tg = target();
    if (!tg || tg.kind !== 'variant') return tg && tg.kind === 'page' ? { [tg.page.id]: 0 } : null;
    const idx = tg.page.secrets.filter((s) => S.unlocked.has(s.id)).findIndex((s) => s.id === tg.secret.id);
    return idx >= 0 ? { [tg.page.id]: idx + 1 } : null;
  }

  // srcdoc document: the reader CSS is inlined and the bundle injected as an inline module ('</script' broken so the
  // code cannot close the tag). data-kp-scheme copies the editor's theme so the preview follows light/dark.
  async function build() {
    let code = '';
    try { code = await readerCode(); } catch (e) {
      stage.replaceChildren(h('p', { class: 'ed-hint kp-pad' }, t('kp.previewUnavailable'), ' ', String(e.message || e)));
      return;
    }
    ready = false;
    frame = h('iframe', { class: 'kp-pv-frame', title: t('kp.preview') });
    const theme = document.documentElement.getAttribute('data-theme');
    frame.srcdoc = `<!doctype html><html data-kp-mode="preview"${theme ? ` data-kp-scheme="${theme}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${readerCSS(null)}</style></head><body><script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
    stage.replaceChildren(frame);
    fit();
  }

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
        { label: t('kp.copyLink'), icon: 'copy', action: () => navigator.clipboard && navigator.clipboard.writeText(`[[${path}]]`).then(() => toast(t('kp.copied'), 'ok')) },
      ]);
    });
  }

  function go(r) {
    route = r;
    paintAddr();
    if (frame && ready) frame.contentWindow.postMessage({ kp: 'go', route: r, select: variantSelection() }, '*');
  }

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
  on('change', () => { clearTimeout(timer); timer = setTimeout(() => send('update'), 300); });
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
