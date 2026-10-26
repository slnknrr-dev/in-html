// knowledge-processor/ed-export.js - publishing from the editor: one HTML file (offline, hash routes), static site
// (.zip with prerendered pages and 404.html routing; URL style, base path, site URL for the sitemap), Node server (.zip
// with server.mjs and the editing API), project archive (.zip) and JSON backup; publishing to an exported server's
// editing API (not in offline builds); the published address on this application's own server (backend builds).
//
// Design: one builder (buildExport) returns every format as data, the dialog only collects options and downloads.
// The same builder is used by the e2e scenario (main.js exposes it), so tests exercise the real export path.
// Locked 451 content is exported as it is stored: sealed envelopes, never decrypted text.
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { openDialog, toast } from '../ui/overlays.js';
import { download } from '../ui/app.js';
import { safeFileName } from '../ui/files.js';
import { writeZip } from '../zip/zip.js';
import { S, saveNow } from './state.js';
import { exportJSON, exportServer, exportSingle, exportStatic } from './export.js';
import { readerCode, serverCode } from './bundles.js';
import { projectZip } from './store.js';
import { mediaBlob } from './ed-media.js';
import { REMOTE, publishToKBServer } from './remote.js';
import { input, row, selectEl } from './ed-fields.js';

const mediaData = async (id) => { const b = await mediaBlob(id); return b ? new Uint8Array(await b.arrayBuffer()) : null; };
const fileBase = () => safeFileName(S.kb.title || 'knowledge-base', 'knowledge-base');
// store (no compression) for binaries over 2 KiB: media (JPEG, PNG, WebP) is already compressed, deflating it again
// costs time for ~0% gain. Text files stay deflated.
const zipOf = async (files) => writeZip([...files].map(([name, data]) => ({ name, data, store: data instanceof Uint8Array && data.length > 2048 })));

// Number of 451 sections still sealed in this session; shown as a hint so the author knows they ship encrypted.
function lockedCount() {
  let n = 0;
  for (const p of S.kb.pages) for (const s of p.secrets || []) if (!S.unlocked.has(s.id)) n++;
  return n;
}

// The "exporting" toast appears only if the job takes over 300 ms: fast exports do not flash a message.
// saveNow() first: the export reads the stored media and must see the latest edits.
async function run(label, fn) {
  const tm = setTimeout(() => toast(t('kp.exporting', { what: label }), 'info'), 300);
  try { await saveNow(); await fn(); } catch (e) { console.error(e); toast(t('kp.exportFailed', { msg: e.message || e }), 'error'); } finally { clearTimeout(tm); }
}

// One publishing format of the open base: { name, data, type, files? } (files: the Map of a zipped site / server).
export async function buildExport(kind, o = {}) {
  if (kind === 'single') return { name: fileBase() + '.html', type: 'text/html', data: await exportSingle(S.kb, { mediaData, readerCode: await readerCode() }) };
  if (kind === 'static') {
    const files = await exportStatic(S.kb, { mediaData, readerCode: await readerCode(), style: o.style || 'clean', base: o.base || '', siteURL: o.siteURL || '' });
    return { name: fileBase() + '-site.zip', type: 'application/zip', files, data: await zipOf(files) };
  }
  if (kind === 'server') {
    const files = await exportServer(S.kb, { mediaData, readerCode: await readerCode(), serverCode: await serverCode(), style: o.style || 'clean', base: '/' });
    return { name: fileBase() + '-server.zip', type: 'application/zip', files, data: await zipOf(files) };
  }
  if (kind === 'project') return { name: fileBase() + '.kp.zip', type: 'application/zip', data: await projectZip(S.kb, mediaBlob) };
  return { name: fileBase() + '.kp.json', type: 'application/json', data: await exportJSON(S.kb, { mediaData }) };
}
const save = (kind, label, o) => run(label, async () => { const r = await buildExport(kind, o); download(r.data, r.name, r.type); });

// Exported although only the dialog uses it today: a one-call entry point for the most common format.
export const exportSingleFile = () => save('single', t('kp.ex.single'));

// Option values persist in localStorage (per device), not in the base: deployment details such as a base path
// are about where this browser publishes, not about the content.
export function openExportDialog({ backendURL = '' } = {}) {
  const st = lsGet('kp-ed-export', { style: 'clean', base: '', siteURL: '', serverURL: '' });
  const keep = () => lsSet('kp-ed-export', st);
  const card = (icon, title, desc, ...kids) => h('section', { class: 'kp-ex-card' }, h('div', { class: 'kp-ex-h' }, iconEl(icon), h('h3', {}, title)), h('p', { class: 'ed-hint' }, desc), ...kids);
  let close = () => {};
  const done = (fn) => () => { close(); fn(); };
  const style = selectEl(['clean', 'folders', 'html'].map((v) => ({ v, l: t('kp.style.' + v) })), st.style, (v) => { st.style = v; keep(); });
  const base = input(st.base, (v) => { st.base = v; keep(); }, { placeholder: '/repository/' });
  const siteURL = input(st.siteURL, (v) => { st.siteURL = v; keep(); }, { placeholder: 'https://example.org/repository/' });
  const serverURL = input(st.serverURL, (v) => { st.serverURL = v; keep(); }, { placeholder: 'https://kb.example.org/' });
  const token = h('input', { type: 'password', class: 'ed-input', autocomplete: 'off', 'aria-label': t('kp.token') });
  const locked = lockedCount();
  const body = h('div', { class: 'kp-ex' },
    locked ? h('p', { class: 'ed-hint kp-secret-hint' }, iconEl('lock'), t('kp.exportSealed', { n: locked })) : h('p', { class: 'ed-hint kp-secret-hint' }, iconEl('lock'), t('kp.exportSealedAll')),
    h('div', { class: 'kp-ex-grid' },
      card('file', t('kp.ex.single'), t('kp.ex.singleHint'), h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: done(exportSingleFile) }, iconEl('download'), t('kp.download') + ' .html')),
      card('globe', t('kp.ex.static'), t('kp.ex.staticHint'),
        row(t('kp.urlStyle'), style, t('kp.urlStyleHint')),
        row(t('kp.basePath'), base, t('kp.basePathHint')),
        row(t('kp.siteURL'), siteURL, t('kp.siteURLHint')),
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: done(() => save('static', t('kp.ex.static'), st)) }, iconEl('download'), t('kp.download') + ' .zip')),
      card('terminal', t('kp.ex.server'), t('kp.ex.serverHint'),
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: done(() => save('server', t('kp.ex.server'), st)) }, iconEl('download'), t('kp.download') + ' .zip')),
      card('save', t('kp.ex.project'), t('kp.ex.projectHint'),
        h('div', { class: 'kp-row' },
          h('button', { type: 'button', class: 'ed-btn', onclick: done(() => save('project', t('kp.ex.project'))) }, iconEl('download'), '.zip'),
          h('button', { type: 'button', class: 'ed-btn', onclick: done(() => save('json', 'JSON')) }, iconEl('download'), '.json'))),
      // REMOTE is false in offline builds: the card that talks to a network server is not even rendered there.
      REMOTE ? card('send', t('kp.ex.publish'), t('kp.ex.publishHint'),
        row(t('kp.serverURL'), serverURL),
        row(t('kp.token'), token),
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => run(t('kp.ex.publish'), async () => {
          if (!st.serverURL) { toast(t('kp.serverURLMissing'), 'warn'); return; }
          await publishToKBServer(st.serverURL, token.value, S.kb, mediaBlob);
          toast(t('kp.published'), 'ok', { label: t('kp.openSite'), fn: () => window.open(st.serverURL, '_blank', 'noopener') });
        }) }, iconEl('send'), t('kp.publish'))) : null,
      backendURL ? card('globe', t('kp.ex.hosted'), t('kp.ex.hostedHint'), h('a', { class: 'ed-btn', href: backendURL, target: '_blank', rel: 'noopener' }, iconEl('external'), backendURL)) : null));
  openDialog({ title: t('kp.exportTitle'), body, wide: true, className: 'kp-ex-dlg', onMount: (o) => { close = o.close; } });
}
