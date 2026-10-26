// site-studio/editor-remote.js - the editor as the constructor of a backend site (/_studio/ of a "backend +
// constructor" export): the server puts globalThis.SS_REMOTE = { load(), save(doc), admin, site } in front of the
// editor page; the project comes from the server and "Publish" sends it back (the server stores it and rebuilds the
// site). The transport lives in the host script, never in this module (offline builds stay without network code).
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { S } from '../studio/state.js';
import { fullDoc } from '../studio/doc.js';
import { startProject } from '../studio/projects.js';

// Duck-typed check rather than `if (globalThis.SS_REMOTE)`: a page that defines the name for something else must not
// switch the editor into remote mode and then crash on a missing method.
const remote = () => { const r = globalThis.SS_REMOTE; return r && typeof r.load === 'function' && typeof r.save === 'function' ? r : null; };

// `busy` guards against double publishing (button + keyboard shortcut); `bar` makes mountBar idempotent.
let bar = null;
let busy = false;

// fullDoc() serializes the complete project (attachments included); the server answers with the number of files it
// rebuilt. Errors surface as a toast; the editor state is untouched, so the user can retry.
async function publish(btn) {
  const R = remote();
  if (!R || busy) return;
  busy = true;
  btn.disabled = true;
  try {
    const r = await R.save(fullDoc());
    toast(t('rm.saved', { n: (r && r.files) || 0 }), 'ok');
  } catch (e) {
    toast(t('rm.failed', { msg: (e && e.message) || String(e) }), 'error');
  } finally { busy = false; btn.disabled = false; }
}

function mountBar() {
  if (bar) return;
  const R = remote();
  const pub = h('button', { type: 'button', class: 'ed-btn ed-primary ss-rm-pub', onclick: () => publish(pub) }, iconEl('upload'), h('span', {}, t('rm.publish')));
  bar = h('div', { class: 'ss-rm', role: 'region', 'aria-label': t('rm.label') },
    h('span', { class: 'ss-rm-dot', 'aria-hidden': 'true' }), h('span', { class: 'ss-rm-t' }, t('rm.label')),
    h('a', { class: 'ed-btn ed-sm', href: R.site || '/', target: '_blank', rel: 'noopener' }, iconEl('external'), h('span', {}, t('rm.site'))),
    h('a', { class: 'ed-btn ed-sm', href: R.admin || '/admin/', target: '_blank', rel: 'noopener' }, iconEl('settings'), h('span', {}, t('rm.admin'))), pub);
  document.body.append(bar);
  // Ctrl/Cmd+Shift+S publishes; plain Ctrl+S stays the studio's local save.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); publish(pub); }
  });
}

// After the editor has started: the server's project replaces whatever this browser had open.
// The server's copy wins unless the local one is the same project and newer (meta.modified, ISO strings compare
// lexically): an unpublished local edit is not overwritten by a reload. noGuard skips the "discard changes?" prompt
// since the switch is the point of opening /_studio/.
export function startRemote() {
  const R = remote();
  if (!R) return;
  const go = async () => {
    try {
      const doc = await R.load();
      if (doc && typeof doc === 'object' && (!S.doc || S.doc.id !== doc.id || String(doc.meta && doc.meta.modified) > String(S.doc.meta && S.doc.meta.modified))) {
        await startProject(doc, { noGuard: true });
      }
      mountBar();
    } catch (e) {
      toast(t('rm.failed', { msg: (e && e.message) || String(e) }), 'error');
    }
  };
  // The studio boots asynchronously and announces readiness via window.__edReady; polling (100 ms) avoids a coupling to
  // a studio event that may not exist in every build.
  if (window.__edReady) go();
  else {
    const tm = setInterval(() => { if (window.__edReady) { clearInterval(tm); go(); } }, 100);
  }
}
