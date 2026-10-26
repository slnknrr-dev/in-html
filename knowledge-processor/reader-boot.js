// knowledge-processor/reader-boot.js - entry of the reader in published knowledge bases (bundled into every export,
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
//
// Why one entry for four modes: the reader runtime is identical; only where data comes from and how URLs map to
// routes differ. The mode is declared by the document itself (data-kp-mode written by pages.js), so the same bundle
// needs no build-time configuration and cannot be started in the wrong mode.
import { startReader } from './reader.js';
import { baseFromRoute, normBase } from '../spa/base.js';
import { formatRoute } from '../spa/route.js';
import { relRoot } from '../spa/prerender.js';

function bootReader() {
  const html = document.documentElement;
  const mode = html.getAttribute('data-kp-mode') || 'single';
  const meta = (n) => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.getAttribute('content') : null; };
  const root = document.body;

  if (mode === 'preview') {
    let r = null;
    // targetOrigin '*': the editor may run from file:// or a blob/srcdoc context whose origin is opaque and cannot be
    // named. Acceptable because the messages carry only navigation info the parent already has. try/catch: the frame may
    // already be detached while a message is in flight.
    const post = (m) => { try { window.parent.postMessage(m, '*'); } catch { /* detached */ } };
    window.addEventListener('message', (e) => {
      // Inbound trust check: commands are accepted only from the parent window. With an opaque origin, comparing e.source
      // is the reliable test (e.origin would be the string "null" for every sandboxed sender).
      if (e.source !== window.parent) return;
      const m = e.data || {};
      if (m.kp === 'load' && m.site) {
        // A second 'load' updates the running reader instead of starting another: listeners and state would otherwise double.
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
    // Handshake: the parent waits for 'ready' before its first 'load', so no message is sent before the listener exists.
    post({ kp: 'ready' });
    return;
  }

  // Data is inert JSON in a script element, parsed with JSON.parse (no eval). Broken or missing data leaves the
  // prerendered home page in place instead of throwing: the page stays readable without the reader.
  if (mode === 'single') {
    const el = document.getElementById('kp-data');
    let data = null;
    try { data = JSON.parse(el ? el.textContent : 'null'); } catch { data = null; }
    if (!data || !data.site) return;
    startReader({ site: data.site, media: data.media || {}, mode: 'hash', root });
    return;
  }

  // static / server
  const data = globalThis.KP_DATA;
  if (!data || !data.site) return;
  const route = meta('kp-route');
  // Base resolution order: what the 404 bootstrap measured (SPA_BASE) > what the server declared (kp-base) > what the
  // export was configured with > derived from the current URL minus the page's known route (kp-route). The last one
  // makes a static export work under any sub-path without configuration.
  let base = globalThis.SPA_BASE || meta('kp-base') || data.base || '';
  if (!base && route != null) base = baseFromRoute(location.pathname, route) || '';
  base = normBase(base || '/');
  const style = data.style || 'clean';
  const enc = (s) => encodeURI(s);
  const mediaSrc = (id, m) => enc(base) + '_kp/media/' + encodeURIComponent(m.f || id);
  // From disk pushState cannot change files, and absolute /_kp/ paths would point at the drive root; so routes move to
  // the fragment and media paths are made relative to the current file. replaceState (not assign) adds no history entry.
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
