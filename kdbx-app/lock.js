// kdbx-app/lock.js - the locked screen: pick or drop a .kdbx file, unlock it with a password and / or a key file (key
// derivation in Workers without a time limit: progress, elapsed time, estimate, cancel), or create a new database.
// The file stays in memory (S.file) while locked, so unlocking again does not need the file picker.
import { button, download, dropZone, field, select, t, textInput, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { openDialog } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { KdbxCredentials, createKdbx, generateKeyFile, openKdbx, readHeader } from '../kdbx/kdbx.js';
import { S, fmtSize } from './state.js';
import { deriveKey, fmtDuration, kdfSummary } from './kdf.js';
import { strengthView } from './generator.js';

// Password input with a show / hide toggle: { input, row }.
// Show / hide toggles the input type; aria-pressed exposes the state to assistive tech.
export function secretInput(value = '', attrs = {}) {
  const input = textInput(value, () => {}, { type: 'password', autocomplete: 'off', spellcheck: 'false', ...attrs });
  const eye = h('button', {
    type: 'button', class: 'ed-iconbtn', title: t('kx.reveal'), 'aria-label': t('kx.reveal'), 'aria-pressed': 'false',
    onclick: () => { const on = input.type === 'password'; input.type = on ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(on)); eye.replaceChildren(iconEl(on ? 'eyeOff' : 'eye')); },
  }, iconEl('eye'));
  return { input, row: h('div', { class: 'kx-pw-row' }, input, eye) };
}

// KeePass accepts any file as a key file (its hash is used), so */* stays in the list.
const KEY_ACCEPT = '.key,.keyx,.xml,.txt,*/*';

export function renderLock(main, onOpened) {
  const st = { keyFile: null, busy: false };
  main.textContent = '';
  const fileLine = h('div', { class: 'kx-file-line' });
  // >
  const paintFile = () => {
    fileLine.textContent = '';
    if (!S.file) { fileLine.append(h('span', { class: 'ed-muted' }, t('kx.noFile'))); return; }
    fileLine.append(iconEl('vault'), h('strong', { class: 'kx-ellipsis', title: S.file.name }, S.file.name), h('span', { class: 'ed-muted' }, fmtSize(S.file.bytes.length)));
    // The key derivation parameters are in the plain header: shown before unlocking (an expensive one takes long).
    let sum = null;
    try { sum = kdfSummary(readHeader(S.file.bytes).kdf); } catch { /* not a KDBX file: unlocking reports it */ }
    if (sum) fileLine.append(h('span', { class: 'kx-kdf-line ed-muted' }, t(sum.key, sum.params)));
  };
  const take = async ([f]) => {
    if (!f) return;
    S.file = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
    paintFile();
    pw.input.focus();
  };
  // current-password lets a password manager fill the master password.
  const pw = secretInput('', { 'aria-label': t('kx.password'), autocomplete: 'current-password', id: 'kx-unlock-pw' });
  const keyLabel = h('span', { class: 'kx-ellipsis' }, t('kx.noKeyFile'));
  const keyClear = h('button', { type: 'button', class: 'ed-iconbtn ed-sm', hidden: true, title: t('kx.removeKeyFile'), 'aria-label': t('kx.removeKeyFile'), onclick: () => { st.keyFile = null; keyLabel.textContent = t('kx.noKeyFile'); keyClear.hidden = true; } }, iconEl('close'));
  const keyBtn = button('kx.chooseKeyFile', 'key', async () => {
    const [f] = await pickFiles({ accept: KEY_ACCEPT });
    if (!f) return;
    st.keyFile = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
    keyLabel.textContent = f.name;
    keyClear.hidden = false;
  });
  const bar = h('i'), label = h('div', { class: 'kx-progress-l' }), timing = h('div', { class: 'kx-progress-t ed-muted' });
  let ctl = null;
  const cancelBtn = button('dlg.cancel', 'close', () => ctl && ctl.abort());
  cancelBtn.classList.add('ed-sm');
  const prog = h('div', { class: 'kx-progress', hidden: true }, h('div', { class: 'ap-progress' }, bar), label, h('div', { class: 'kx-progress-row' }, timing, cancelBtn));
  const err = h('div', { class: 'kx-error', role: 'alert' });
  const openBtn = button('kx.unlock', 'unlock', () => unlock(), 'primary');
  openBtn.classList.add('kx-wide');

  // Errors are mapped to specific messages: wrong key, not a KDBX file, out of memory (huge Argon2 memory), cancelled.
  async function unlock() {
    if (st.busy) return;
    err.textContent = '';
    if (!S.file) { err.textContent = t('kx.pickFirst'); return; }
    if (!pw.input.value && !st.keyFile) { err.textContent = t('kx.needKey'); return; }
    st.busy = true;
    openBtn.disabled = true;
    prog.hidden = false;
    ctl = new AbortController();
    const t0 = Date.now();
    let frac = 0;
    // Elapsed time and, once the progress is meaningful, an estimate of the remaining time.
    // ETA only after 3 s and 1% progress: earlier estimates jump wildly.
    const tickTiming = () => {
      const ms = Date.now() - t0;
      timing.textContent = t('kx.elapsed', { t: fmtDuration(ms) }) + (frac > 0.01 && frac < 1 && ms > 3000 ? ' · ' + t('kx.eta', { t: fmtDuration((ms * (1 - frac)) / frac) }) : '');
    };
    const timer = setInterval(tickTiming, 1000);
    tickTiming();
    try {
      const creds = new KdbxCredentials({ password: pw.input.value || null, keyFile: st.keyFile ? st.keyFile.bytes : null });
      const db = await openKdbx(S.file.bytes, creds, {
        deriveKey, signal: ctl.signal,
        onProgress: ({ phase, fraction }) => {
          if (phase === 'kdf') frac = fraction;
          bar.style.width = Math.round(fraction * 100) + '%';
          label.textContent = t('kx.phase.' + phase, { p: Math.round(fraction * 100) });
        },
      });
      pw.input.value = '';
      onOpened(db);
    } catch (e) {
      err.textContent = ctl.signal.aborted ? t('kx.cancelled') : e.code === 'InvalidKey' ? t('kx.wrongKey') : e.code === 'BadSignature' ? t('kx.notKdbx')
        : /allocation|out of memory|Array buffer/i.test(e.message) ? t('kx.noMemory') : t('kx.openFailed', { msg: e.message });
      pw.input.select();
    } finally {
      clearInterval(timer);
      ctl = null;
      st.busy = false;
      openBtn.disabled = false;
      prog.hidden = true;
    }
  }
  pw.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  paintFile();
  main.append(h('div', { class: 'kx-lock' },
    h('section', { class: 'ap-card kx-lock-card', 'aria-labelledby': 'kx-lock-h' },
      h('div', { class: 'kx-lock-icon' }, iconEl('vault')),
      h('h2', { id: 'kx-lock-h', class: 'kx-lock-h' }, t(S.db === null && S.file ? 'kx.unlockTitle' : 'kx.openTitle')),
      dropZone({ onFiles: take, accept: '.kdbx', label: 'kx.dropDb' }),
      fileLine,
      h('div', { class: 'ed-fields' },
        field('kx.password', pw.row),
        field('kx.keyFile', h('div', { class: 'kx-key-row' }, keyBtn, keyLabel, keyClear))),
      err, prog, openBtn,
      h('div', { class: 'kx-or' }, h('span', {}, t('kx.or'))),
      button('kx.create', 'plus', () => createDialog(onOpened))),
    h('p', { class: 'kx-lock-note' }, iconEl('shield'), t('kx.privacy'))));
  if (S.file) setTimeout(() => pw.input.focus(), 50);
}

// New database: name, password (twice), optional key file (new or existing), key derivation, cipher.
// New database: the key file can be generated (.keyx: the XML key file format 2.0 of KeePass, read by KeePassXC too) and is downloaded at once; it is never stored by the page.
async function createDialog(onOpened) {
  const name = textInput(t('kx.defaultName'), () => {}, { 'aria-label': t('kx.dbName') });
  const p1 = secretInput('', { autocomplete: 'new-password', 'aria-label': t('kx.password') });
  const p2 = secretInput('', { autocomplete: 'new-password', 'aria-label': t('kx.repeat') });
  const meter = strengthView({ compact: true });
  p1.input.addEventListener('input', () => meter.set(p1.input.value));
  const st = { keyFile: null, kdf: 'argon2id', cipher: 'aes256' };
  const keyLabel = h('span', { class: 'kx-ellipsis ed-muted' }, t('kx.noKeyFile'));
  const err = h('div', { class: 'kx-error', role: 'alert' });
  const body = h('div', { class: 'ed-fields' },
    field('kx.dbName', name),
    field('kx.password', h('div', {}, p1.row, meter.el)),
    field('kx.repeat', p2.row),
    field('kx.keyFile', h('div', { class: 'kx-key-row' },
      button('kx.newKeyFile', 'plus', () => {
        const kf = generateKeyFile();
        st.keyFile = kf.bytes;
        download(kf.bytes, (name.value || 'Passwords') + '.keyx', 'application/xml');
        keyLabel.textContent = t('kx.keyFileSaved');
      }),
      button('kx.chooseKeyFile', 'key', async () => {
        const [f] = await pickFiles({ accept: KEY_ACCEPT });
        if (f) { st.keyFile = new Uint8Array(await f.arrayBuffer()); keyLabel.textContent = f.name; }
      }),
      keyLabel), 'kx.keyFileHint'),
    h('div', { class: 'kx-grid2' },
      field('kx.kdf', select([{ v: 'argon2id', l: '=Argon2id' }, { v: 'argon2d', l: '=Argon2d' }, { v: 'aes', l: '=AES-KDF' }], st.kdf, (v) => { st.kdf = v; })),
      field('kx.cipher', select([{ v: 'aes256', l: '=AES-256' }, { v: 'chacha20', l: '=ChaCha20' }], st.cipher, (v) => { st.cipher = v; }))),
    err);
  await openDialog({
    title: t('kx.createTitle'), body,
    buttons: [{ label: t('dlg.cancel'), value: null }, {
      label: t('kx.create'), primary: true, value: 'ok',
      onClick: () => {
        err.textContent = '';
        if (p1.input.value !== p2.input.value) { err.textContent = t('kx.mismatch'); return false; }
        if (!p1.input.value && !st.keyFile) { err.textContent = t('kx.needKey'); return false; }
        try {
          const creds = new KdbxCredentials({ password: p1.input.value || null, keyFile: st.keyFile });
          const db = createKdbx({ name: name.value.trim() || t('kx.defaultName'), credentials: creds, kdf: st.kdf, cipher: st.cipher });
          db.createGroup(db.root, t('kx.groupGeneral'));
          S.file = { name: (name.value.trim() || 'Passwords').replace(/[\\/:*?"<>|]+/g, ' ') + '.kdbx', bytes: null };
          onOpened(db, true);
          toast(t('kx.createdHint'), 'info');
        } catch (e) { err.textContent = e.message; return false; }
        return true;
      },
    }],
  });
}
