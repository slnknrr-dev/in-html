// site-studio/wiki-ed-sync.js - knowledge bases on the application's own server (backend builds and the
// development server): upload a base, keep it in sync after every save (with a revision check: a newer server
// version is never overwritten silently), the editing token (asked once, kept in this browser).
import { h, lsGet, lsSet } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { openDialog, toast } from '../ui/overlays.js';
import { S, addSaver, emit } from './wiki-state.js';
import { putKB } from './wiki-store.js';
import { mediaBlob } from './wiki-ed-media.js';
import { putServerKB, putServerMedia } from './wiki-remote.js';

// Design rules:
// - Local first: IndexedDB is the source of truth for the editor; the server copy follows asynchronously (a saver
// registered with wiki-state.js), so a slow or offline server never blocks typing or loses work.
// - Optimistic concurrency: every PUT carries the last known server revision (kb.remote.rev); the server answers 409
// when someone else saved in between, and the user explicitly chooses "overwrite" (a PUT without baseRev).
// - server.info is set once at boot (wiki-main.js probeBackend); null means "no backend" and disables everything here.
export const server = { info: null, busy: false, failed: false };

// The token is kept in localStorage: convenient for a team member on their own device, but readable by any script
// on this origin. Acceptable for an editing token of a self-hosted tool; a wrong token is cleared on 401.
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
// server.busy makes concurrent syncs impossible; a save that arrives during a sync is dropped here, and the next save
// syncs the newer state anyway (the debounce in the saver guarantees one more call after typing stops).
// Media upload is incremental: a per-base list of "id:size" signatures in localStorage records what the server
// already has. KNOWN DEFECT: a media file replaced by another of exactly the same size keeps its signature and is not
// re-uploaded. Fix: include a content hash or the media's updated time in the signature.
export async function syncToServer(force = false, overwrite = false) {
  if (!server.info || !S.kb || server.busy) return false;
  if (!S.kb.remote && !force) return false;
  let token = lsGet('kp-ed-token', '');
  if (!token) token = await askToken();
  if (!token) return false;
  server.busy = true;
  const kb = S.kb;
  try {
    const upKey = 'kp-ed-up:' + kb.id;
    const done = new Set(lsGet(upKey, []));
    for (const [id, m] of Object.entries(kb.media)) {
      const sig = id + ':' + m.size;
      if (done.has(sig) || m.secret) continue;
      const b = await mediaBlob(id);
      if (b) { await putServerMedia(kb.id, id, b, token); done.add(sig); }
    }
    lsSet(upKey, [...done]);
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
    if (e.status === 401) { lsSet('kp-ed-token', ''); toast(t('kp.tokenWrong'), 'warn', { label: t('kp.retry'), fn: () => syncToServer(force, overwrite) }); }
    else if (e.status === 409) toast(t('kp.conflict'), 'warn', { label: t('kp.overwrite'), fn: () => syncToServer(true, true) });
    else toast(t('kp.syncFailed', { msg: e.message || e }), 'error');
    emit('saved', {});
    return false;
  } finally { server.busy = false; }
}

let timer = 0;
// 1.5 s debounce after the local save: bursts of edits become one upload; only bases linked to the server (kb.remote) sync.
addSaver(async (kb) => {
  if (!server.info || !kb.remote) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncToServer(false), 1500);
});
