// knowledge-processor/ed-sync.js - knowledge bases on the application's own server (backend builds and the
// development server): upload a base, keep it in sync after every save (with a revision check: a newer server
// version is never overwritten silently), the editing token (asked once, kept in this browser).
//
// Security note: the editing token is kept in localStorage in clear. Acceptable for a personal editor on a trusted
// device (the token only authorises writes to this app's own server); any script on the same origin can read it.
// A 401 clears it so a wrong token is not retried forever.
import { h, lsGet, lsSet } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { openDialog, toast } from '../ui/overlays.js';
import { S, addSaver, emit } from './state.js';
import { putKB } from './store.js';
import { mediaBlob } from './ed-media.js';
import { putServerKB, putServerMedia } from './remote.js';

// Shared mutable status read by main.js (bar text) and ed-bases.js: info = backend probe result (null = no backend),
// busy = an upload runs (re-entrancy guard), failed = last sync failed.
export const server = { info: null, busy: false, failed: false };

// type=password + autocomplete=off: not shown on screen, not offered to the password manager as a site login.
async function askToken() {
  const inp = h('input', { type: 'password', class: 'ed-input', autocomplete: 'off', value: lsGet('kp-ed-token', '') });
  const v = await openDialog({
    title: t('kp.tokenTitle'),
    body: h('div', { class: 'ed-fields' }, h('p', { class: 'ed-hint' }, t('kp.tokenHint')), h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('kp.token')), inp)),
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }],
  });
  if (v !== 'ok' || !inp.value) return '';
  lsSet('kp-ed-token', inp.value);
  return inp.value;
}

// Uploads the current base (media first). force: also when the base is not linked to the server yet / overwrite.
// Optimistic concurrency: the stored revision (kb.remote.rev) is sent; the server answers 409 if its copy is newer.
// overwrite (user confirmed after a 409) or a first upload sends no revision.
export async function syncToServer(force = false, overwrite = false) {
  // KNOWN DEFECT: a debounced auto-sync that fires while an upload is busy is dropped, and nothing re-schedules it;
  // edits saved during a long upload reach the server only with the next save. Fix: remember a pending flag and
  // call syncToServer again in the finally block.
  if (!server.info || !S.kb || server.busy) return false;
  if (!S.kb.remote && !force) return false;
  let token = lsGet('kp-ed-token', '');
  if (!token) token = await askToken();
  if (!token) return false;
  server.busy = true;
  const kb = S.kb;
  try {
    // Uploaded-media ledger per base in localStorage, signature id + size: unchanged media is not re-sent on every
    // save. Secret (451) media is skipped here.
    const upKey = 'kp-ed-up:' + kb.id;
    const done = new Set(lsGet(upKey, []));
    for (const [id, m] of Object.entries(kb.media)) {
      const sig = id + ':' + m.size;
      if (done.has(sig) || m.secret) continue;
      const b = await mediaBlob(id);
      if (b) { await putServerMedia(kb.id, id, b, token); done.add(sig); }
    }
    lsSet(upKey, [...done]);
    // Deep copy without the local-only `remote` marker: the server must not store its own client-side bookkeeping.
    const plain = JSON.parse(JSON.stringify(kb));
    delete plain.remote;
    const r = await putServerKB(plain, token, overwrite || !kb.remote ? undefined : kb.remote.rev);
    kb.remote = { server: true, rev: r.rev };
    await putKB(kb);
    server.failed = false;
    emit('saved', {});
    if (force) toast(t('kp.uploaded'), 'ok', { label: t('kp.openSite'), fn: () => window.open('kb/' + encodeURIComponent(kb.id) + '/', '_blank', 'noopener') });
    return true;
  } catch (e) {
    server.failed = true;
    // Each failure kind gets its own recovery action in the toast: retry with a new token, or overwrite on conflict.
    if (e.status === 401) { lsSet('kp-ed-token', ''); toast(t('kp.tokenWrong'), 'warn', { label: t('kp.retry'), fn: () => syncToServer(force, overwrite) }); }
    else if (e.status === 409) toast(t('kp.conflict'), 'warn', { label: t('kp.overwrite'), fn: () => syncToServer(true, true) });
    else toast(t('kp.syncFailed', { msg: e.message || e }), 'error');
    emit('saved', {});
    return false;
  } finally { server.busy = false; }
}

// Auto-sync after each local save of a server-linked base, debounced 1.5 s: a burst of saves while typing becomes
// one upload. Runs after the local save, so the browser copy is never behind the server copy.
let timer = 0;
addSaver(async (kb) => {
  if (!server.info || !kb.remote) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncToServer(false), 1500);
});
