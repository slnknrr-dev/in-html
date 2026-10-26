// site-studio/wiki-reader-boot.js - entry of the reader in published knowledge bases (bundled into every export,
// see export.js) and in the editor's preview frame. It finds the data and the mode of the page and starts reader.js:
//
//   <html data-kp-mode="single">   one HTML file: <script id="kp-data" type="application/json">{ site, media }</script>,
//                                  hash routes (#/page), media bytes inside the file (object URLs)
//   <html data-kp-mode="static">   static site: globalThis.KP_DATA = { site, style, base } from _kp/kb.js, real URL
//                                  paths with pushState; the base comes from the 404 bootstrap (SPA_BASE), a configured
//                                  base, or the route of a prerendered page (<meta name="kp-route">); from file:// the
//                                  routes fall back to the fragment
//   <html data-kp-mode="server">   like static, the server names the base (<meta name="kp-base">)
//   <html data-kp-mode="preview">  editor preview (memory routes): data and commands arrive by postMessage from the
//                                  parent window: { kp: 'load', site, media, route } | { kp: 'go', route } |
//                                  { kp: 'update', site, media }; it answers { kp: 'nav', route, title, kind, pageId },
//                                  { kp: 'block', id } and { kp: 'ready' }
import { startReader } from './wiki-reader.js';
import { baseFromRoute, normBase } from '../spa/base.js';
import { formatRoute } from '../spa/route.js';
import { relRoot } from '../spa/prerender.js';

// The mode is declared by the HTML that the exporter wrote (data-kp-mode), not sniffed from the URL: the same
// bundle must behave correctly from file://, a sub-path on a static host, or a server, and only the producer of the
// page knows which one it is.
function bootReader() {
  const html = document.documentElement;
  const mode = html.getAttribute('data-kp-mode') || 'single';
  const meta = (n) => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.getAttribute('content') : null; };
  const root = document.body;

  if (mode === 'preview') {
    let r = null;
    // targetOrigin '*': the preview is a srcdoc frame (wiki-ed-preview.js); when the editor runs from file:// its
    // origin is opaque ('null') and cannot be named as a target. Acceptable because only navigation info (route, title, ids) is posted, never content. Incoming messages
    // are filtered by e.source === window.parent, so no other window can drive the preview.
    const post = (m) => { try { window.parent.postMessage(m, '*'); } catch { /* detached */ } };
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent) return;
      const m = e.data || {};
      if (m.kp === 'load' && m.site) {
        if (r) { r.setSite(m.site, m.media || {}, { payloads: m.payloads, select: m.select }); if (m.route != null) r.go(m.route); return; }
        r = startReader({
          site: m.site, media: m.media || {}, mode: 'memory', root, initial: m.route || '', editor: true, payloads: m.payloads, select: m.select,
          onNavigate: (route, info) => post({ kp: 'nav', route: formatRoute(route), path: route.path, ...info }),
          onBlock: (id) => post({ kp: 'block', id }),
        });
      } else if (m.kp === 'update' && r && m.site) r.setSite(m.site, m.media, { payloads: m.payloads, select: m.select });
      else if (m.kp === 'go' && r) r.show(m.route || '', m.select);
      else if (m.kp === 'unlock' && r) r.unlock(m.password || '').then((n) => post({ kp: 'unlocked', n }));
    });
    post({ kp: 'ready' });
    return;
  }

  if (mode === 'single') {
    const el = document.getElementById('kp-data');
    let data = null;
    // A corrupt data island leaves the prerendered home page as is (still readable) instead of throwing.
    try { data = JSON.parse(el ? el.textContent : 'null'); } catch { data = null; }
    if (!data || !data.site) return;
    startReader({ site: data.site, media: data.media || {}, mode: 'hash', root });
    return;
  }

  // static / server
  const data = globalThis.KP_DATA;
  if (!data || !data.site) return;
  const route = meta('kp-route');
  // Base precedence: the 404 bootstrap's detected base (it knows the real mount), the server's declaration, the export
  // setting, then inference from the prerendered page (location.pathname minus its known route). This lets one static
  // export be uploaded under any sub-path without rebuilding.
  let base = globalThis.SPA_BASE || meta('kp-base') || data.base || '';
  if (!base && route != null) base = baseFromRoute(location.pathname, route) || '';
  base = normBase(base || '/');
  const style = data.style || 'clean';
  const enc = (s) => encodeURI(s);
  const mediaSrc = (id, m) => enc(base) + '_kp/media/' + encodeURIComponent(m.f || id);
  // file:// has no server to answer virtual paths and pushState across files is refused, so routing falls back to the
  // fragment of the current file; media are addressed relative to this file (relRoot), not to the base.
  if (location.protocol === 'file:') {
    // Opened from disk: no pushState across files; virtual pages live in the fragment of the current file.
    const rel = route != null ? relRoot(route, style) : '';
    if (!location.hash && route) history.replaceState(null, '', '#/' + route);
    startReader({ site: data.site, mode: 'hash', root, mediaSrc: (id, m) => rel + '_kp/media/' + encodeURIComponent(m.f || id) });
    return;
  }
  startReader({ site: data.site, mode: 'path', base, style, root, mediaSrc });
}

bootReader();
