// knowledge-processor/ed-secret.js - 451 content in the editor: unlocking envelopes with their password (the key and
// the decrypted payload stay in memory for the session only), new secret pages and secret variants, password changes,
// turning a page secret or public, locking again. Every edit of an unlocked payload is sealed again (state.js).
//
// Threat model and invariants:
// - What is stored and exported is only the envelope (ciphertext + KDF parameters + key id). Plaintext payloads and
//   derived keys live in S.unlocked (memory) and vanish on lock, reload or tab close. Nothing here writes a
//   password or key to storage.
// - A secret page keeps an empty public shell (slug, title, versions cleared): the published site reveals that a
//   451 page exists and its optional public label, nothing else.
// - The KDF is slow on purpose (Argon2id / PBKDF2, see ed-base.js), so every derivation runs behind a modal with
//   progress, and unlockWith derives once per distinct KDF setting, not once per envelope.
// - Edits of unlocked content are re-sealed by state.js (commitTarget -> reseal) with the cached keys: no password
//   prompt per keystroke, and the stored base never contains plaintext.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, toast } from '../ui/overlays.js';
import { S, commit, emit, findSecret, select } from './state.js';
import { deriveKeys, kdfKey, kdfOf, openWith, sealWith } from './secret.js';
import { newPage, normPageFields, pageById, uid, uniqueSlug, cleanSlug } from './model.js';
import { payloadOf } from './site.js';
import { loadSecretMedia, payloadMedia } from './ed-media.js';
import { getMedia, putMedia } from './store.js';
import { b64decode } from '../codec/base64.js';

// A modal "working" note while a key is derived (the KDF is slow on purpose).
// No buttons: a KDF run cannot be cancelled midway here; finally closes the modal on success and on error.
async function busy(fn) {
  let close = () => {};
  const bar = h('progress', { max: 1, value: 0, class: 'kp-progress' });
  openDialog({ title: t('kp.deriving'), body: h('div', {}, h('p', { class: 'ed-dlg-text' }, t('kp.derivingHint')), bar), buttons: [], onMount: (o) => { close = o.close; } });
  try { return await fn((p) => { bar.value = p; }); } finally { close(); }
}

// New envelopes use the base's current KDF setting and the base salt; old envelopes keep the parameters they
// were sealed with, so changing the setting never breaks existing content.
const currentKdf = () => kdfOf(S.kb.kdf, S.kb.salt);

// Password (+ confirmation) dialog; extra: elements shown above. Resolves with { password, …values } or null.
// autocomplete=new-password: password managers offer to generate/save instead of filling a site login.
// The confirmation field catches typos, which with encryption mean unrecoverable content. onClick returning
// false keeps the dialog open with the error shown (role=alert announces it).
function passwordDialog(title, { confirm = true, extra = [], okLabel } = {}) {
  const pw = h('input', { type: 'password', class: 'ed-input', autocomplete: 'new-password', 'aria-label': t('kp.password') });
  const pw2 = h('input', { type: 'password', class: 'ed-input', autocomplete: 'new-password', 'aria-label': t('kp.passwordAgain') });
  const show = h('input', { type: 'checkbox', class: 'ed-switch' });
  show.addEventListener('change', () => { pw.type = pw2.type = show.checked ? 'text' : 'password'; });
  const err = h('p', { class: 'ed-error', role: 'alert' });
  const body = h('div', { class: 'ed-fields' }, ...extra,
    h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('kp.password')), pw),
    confirm ? h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('kp.passwordAgain')), pw2) : null,
    h('label', { class: 'ed-field ed-field-check' }, show, h('span', { class: 'ed-label' }, t('kp.showPassword'))),
    h('p', { class: 'ed-hint' }, t('kp.passwordHint')), err);
  return openDialog({
    title, body,
    buttons: [{ label: t('dlg.cancel'), value: null }, {
      label: okLabel || t('dlg.ok'), value: 'ok', primary: true,
      onClick: () => {
        if (!pw.value) { err.textContent = t('kp.passwordEmpty'); return false; }
        if (confirm && pw.value !== pw2.value) { err.textContent = t('kp.passwordMismatch'); return false; }
        return true;
      },
    }],
  }).then((v) => (v === 'ok' ? { password: pw.value } : null));
}

// Secret media carried by a payload: stored again in this browser when missing (project files omit their bytes).
// The id pattern is checked because ids come from decrypted (thus author-controlled, possibly imported) data and
// become IndexedDB keys and media references. Metadata is written into S.kb.media directly, outside commit():
// it is derived from the payload, so it is neither an undo step nor marks the base dirty (saved with the next edit).
async function restoreMedia(p) {
  for (const [id, m] of Object.entries(p.media || {})) {
    if (!m || typeof m.d !== 'string' || !/^[a-z][a-z0-9]{2,31}$/.test(id)) continue;
    if (!(await getMedia(S.kb.id, id))) await putMedia(S.kb.id, id, new Blob([b64decode(m.d)], { type: m.t || 'application/octet-stream' }));
    if (!S.kb.media[id]) S.kb.media[id] = { id, name: m.n || id, type: m.t || 'application/octet-stream', size: m.s || 0, w: m.w || 0, h: m.h || 0, alt: m.alt || '', credit: m.cr || '', secret: true };
  }
}
// Media bytes are dropped from the in-memory payload after restoring them to IndexedDB: keeps memory small.
// payloadMedia() re-attaches them when the payload is sealed again.
function payloadClean(p) { delete p.media; return p; }

export async function unlockEntry(sid) {
  const e = findSecret(sid);
  if (!e) return false;
  const r = await passwordDialog(t('kp.unlockTitle'), { confirm: false, okLabel: t('kp.unlock') });
  if (!r) return false;
  return unlockWith(r.password, e.secret.id);
}

// Opens every envelope of the base that the password opens (one derivation per KDF setting).
// One password may open many envelopes. Groups by kdfKey (salt + parameters): equal keys mean one derivation.
// keys.id identifies the derived key, so envelopes sealed with another password are skipped without a failed
// decryption attempt. A wrong password therefore yields n = 0, reported once.
export async function unlockWith(password, wanted = '') {
  const groups = new Map();
  for (const p of S.kb.pages) for (const s of p.secrets || []) if (s.env) groups.set(kdfKey(s.env.kdf), s.env.kdf);
  let n = 0;
  await busy(async (progress) => {
    for (const kdf of groups.values()) {
      const keys = await deriveKeys(password, kdf, { onProgress: progress });
      for (const p of S.kb.pages) for (const s of p.secrets || []) {
        if (!s.env || s.env.id !== keys.id || S.unlocked.has(s.id)) continue;
        const pl = openWith(keys, s.env);
        if (pl) { await restoreMedia(pl); S.unlocked.set(s.id, { keys, payload: payloadClean(pl) }); n++; }
      }
    }
  });
  if (!n) { toast(t('kp.unlockWrong'), 'warn'); return false; }
  toast(t('kp.unlockedN', { n }), 'ok');
  await loadSecretMedia();
  // A just-unlocked variant of a public page becomes the edited target; a secret page is selected by page id already.
  if (wanted) { const e = findSecret(wanted); if (e && e.page.access === 'public') select({ sid: wanted }); }
  emit('change', { structure: true });
  return !wanted || S.unlocked.has(wanted);
}

export function lockEntry(sid) {
  S.unlocked.delete(sid);
  if (S.sid === sid) select({ sid: '' });
  emit('change', { structure: true });
}
// Forgets every key and payload at once (toolbar lock button).
export function lockAll() {
  S.unlocked.clear();
  select({ sid: '' });
  emit('change', { structure: true });
}

// Built as a normal page, turned into a payload (payloadOf), sealed, and only the empty shell plus the envelope is
// committed. The id prefix 'sc' marks secret pages, 'sv' variants (readable in data dumps, not relied on by code
// here). route: payload.slug stays next to the envelope for the reader's routing.
export async function newSecretPage(parentId = '') {
  const title = h('input', { class: 'ed-input', type: 'text', value: t('kp.secretPageTitle') });
  const note = h('input', { class: 'ed-input', type: 'text', placeholder: t('kp.notePh') });
  const r = await passwordDialog(t('kp.newSecretPage'), { extra: [
    h('p', { class: 'ed-hint' }, t('kp.secretPageHint')),
    h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('kp.pageTitle')), title),
    h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('kp.editorNote')), note)] });
  if (!r) return;
  const keys = await busy((progress) => deriveKeys(r.password, currentKdf(), { onProgress: progress }));
  const page = newPage({ title: title.value || 'Secret', parent: parentId, versions: [{ id: 'main', label: '', blocks: [{ type: 'text', text: '' }] }] });
  page.slug = uniqueSlug(S.kb, cleanSlug(title.value || 'secret'));
  const payload = payloadOf(S.kb, page, { kind: 'page' });
  const sid = 'sc' + uid();
  const env = sealWith(keys, payload);
  S.unlocked.set(sid, { keys, payload });
  commit((kb) => {
    const p = { ...page, access: 'secret', slug: '', title: '', summary: '', versions: [], layers: [], cats: [], secrets: [{ id: sid, label: note.value || '', route: payload.slug, env }] };
    kb.pages.push(p);
    S.pageId = p.id;
  }, { structure: true });
  select({ pageId: S.pageId });
}

// A 451 variant of a public page: an alternative content shown to readers who know the password. By default a
// deep copy of the public page, so the author edits differences instead of starting blank.
export async function addVariant(pageId) {
  const page = pageById(S.kb, pageId);
  if (!page || page.access !== 'public') return;
  const label = h('input', { class: 'ed-input', type: 'text', value: t('kp.secretVersion') });
  const copy = h('input', { type: 'checkbox', class: 'ed-switch', checked: true });
  const r = await passwordDialog(t('kp.newVariant'), { extra: [
    h('p', { class: 'ed-hint' }, t('kp.variantHint')),
    h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('kp.variantLabel')), label),
    h('label', { class: 'ed-field ed-field-check' }, copy, h('span', { class: 'ed-label' }, t('kp.variantCopy')))] });
  if (!r) return;
  const keys = await busy((progress) => deriveKeys(r.password, currentKdf(), { onProgress: progress }));
  const base = copy.checked ? JSON.parse(JSON.stringify(page)) : { ...page, versions: [{ id: 'main', label: '', blocks: [{ type: 'text', text: '' }] }] };
  const payload = payloadOf(S.kb, page, { kind: 'variant', label: label.value, base });
  const sid = 'sv' + uid();
  S.unlocked.set(sid, { keys, payload });
  commit((kb) => {
    const p = pageById(kb, pageId);
    p.secrets.push({ id: sid, label: label.value || '', route: p.slug, env: sealWith(keys, payload) });
  }, { structure: true });
  select({ sid });
}

// Re-seals the same payload with keys from the new password; the old envelope is replaced, so the old password
// stops working for this entry once saved (copies of older exports are not affected, obviously).
export async function changePassword(sid) {
  const u = S.unlocked.get(sid);
  if (!u) return;
  const r = await passwordDialog(t('kp.changePassword'));
  if (!r) return;
  const keys = await busy((progress) => deriveKeys(r.password, currentKdf(), { onProgress: progress }));
  u.keys = keys;
  commit((kb) => {
    for (const p of kb.pages) for (const s of p.secrets || []) if (s.id === sid) { const m = payloadMedia(u.payload); s.env = sealWith(keys, m ? { ...u.payload, media: m } : u.payload); }
  });
  toast(t('kp.passwordChanged'), 'ok');
}

export async function deleteVariant(sid) {
  const e = findSecret(sid);
  if (!e) return;
  if (!(await confirmDialog(t('kp.deleteVariant'), t('kp.deleteVariantQ'), t('kp.delete'), true))) return;
  S.unlocked.delete(sid);
  if (S.sid === sid) select({ sid: '' });
  commit((kb) => { const p = pageById(kb, e.page.id); p.secrets = p.secrets.filter((s) => s.id !== sid); }, { structure: true });
}

// Public page -> secret page (its content sealed with a new password; the slug disappears from the published site).
// Existing variants are dropped (after consent): they were sealed for a public page whose public content is about
// to disappear. Every public field is blanked in the shell so no metadata (title, summary, image, date, author)
// leaks through the published site.
export async function makeSecret(pageId) {
  const page = pageById(S.kb, pageId);
  if (!page || page.access !== 'public') return;
  if (page.id === S.kb.home) { toast(t('kp.homeCannotBeSecret'), 'warn'); return; }
  if ((page.secrets || []).length && !(await confirmDialog(t('kp.makeSecret'), t('kp.makeSecretDropsVariants'), t('dlg.ok'), true))) return;
  const r = await passwordDialog(t('kp.makeSecret'), { extra: [h('p', { class: 'ed-hint' }, t('kp.secretPageHint'))] });
  if (!r) return;
  const keys = await busy((progress) => deriveKeys(r.password, currentKdf(), { onProgress: progress }));
  const payload = payloadOf(S.kb, page, { kind: 'page' });
  const sid = 'sc' + uid();
  for (const s of page.secrets || []) S.unlocked.delete(s.id);
  S.unlocked.set(sid, { keys, payload });
  commit((kb) => {
    const p = pageById(kb, pageId);
    const m = payloadMedia(payload);
    Object.assign(p, { access: 'secret', slug: '', title: '', display: '', summary: '', image: '', date: '', author: '', versions: [], layers: [], cats: [], secrets: [{ id: sid, label: '', route: payload.slug, env: sealWith(keys, m ? { ...payload, media: m } : payload) }] });
  }, { structure: true });
  select({ pageId, sid: '' });
}

// Secret page -> public page (needs it unlocked).
// Needs the page unlocked: the plaintext is the only source of the content. The slug is made unique again since
// another public page may have taken it meanwhile.
export async function makePublic(pageId) {
  const page = pageById(S.kb, pageId);
  if (!page || page.access !== 'secret') return;
  const s = page.secrets[0];
  const u = s && S.unlocked.get(s.id);
  if (!u) { toast(t('kp.unlockFirst'), 'warn'); return; }
  if (!(await confirmDialog(t('kp.makePublic'), t('kp.makePublicQ'), t('dlg.ok')))) return;
  commit((kb) => {
    const p = pageById(kb, pageId);
    normPageFields(u.payload, p);
    p.access = 'public';
    p.slug = uniqueSlug(kb, u.payload.slug || u.payload.title, p.id);
    p.secrets = [];
  }, { structure: true });
  S.unlocked.delete(s.id);
  select({ pageId, sid: '' });
}
