// mail-composer/inspect.js - the inspect page: an .eml dropped, picked, pasted or handed over by the composer is read
// with mail/mime.js parseMessage and shown with the shared inspector (decoded subject and addresses, findings, the
// HTML body in a sandboxed srcdoc frame without scripts or network, the text body, attachments to download, the MIME
// tree with every part, the headers decoded next to their raw form, the source); "Edit as new" copies the message
// into the composer.
//
// Bytes vs text: files are parsed from their raw bytes (parseMessage honours each part's charset and transfer
// encoding); the UTF-8 decoded text is only for the source view. Pasted text is normalised to CRLF line ends, the
// wire format MIME parsers expect.
import { idbGet, idbSet, pageHref, renderInspector, startShell } from './common.js';
import { composeMessage, draftFromMessage } from './message.js';
import { button, card, dropZone, t, toast } from '../ui/app.js';
import { $, h } from '../ui/dom.js';
import { parseMessage } from '../mail/mime.js';

const main = $('#main');
main.classList.add('mc-inspect');
// CUR = the message on screen; persisted (as 'last' in IndexedDB) so a reload shows the same message.
const CUR = { name: '', raw: '', bytes: null, msg: null };

function render() {
  main.textContent = '';
  const zone = dropZone({ accept: '.eml,.txt,.mht,message/rfc822', onFiles: ([f]) => readFile(f), label: 'mc.i.drop' });
  const ta = h('textarea', { class: 'ed-input ed-textarea mc-mono mc-paste', id: 'mc-paste', rows: 4, spellcheck: 'false', placeholder: t('mc.i.pastePh'), 'aria-label': t('mc.i.paste') });
  const read = button('mc.i.read', 'check', () => { if (ta.value.trim()) show(ta.value.replace(/\r?\n/g, '\r\n'), null, t('mc.i.pasted')); });
  const sample = button('mc.i.sample', 'mail', showSample);
  const inputCard = card('mc.i.open', h('div', { class: 'mc-i-input' }, zone, h('div', { class: 'ed-fields' }, ta, h('div', { class: 'ap-row' }, read, sample))), h('div', { class: 'ed-hint' }, t('mc.h.inspect')));
  const out = h('div', { class: 'mc-i-out', id: 'mc-i-out', 'aria-live': 'polite' });
  main.append(inputCard, out);
  paint();
}

function paint() {
  const out = $('#mc-i-out');
  if (!out) return;
  if (!CUR.msg) { out.textContent = ''; out.append(h('div', { class: 'ap-empty' }, t('mc.i.empty'))); return; }
  renderInspector(out, CUR.msg, CUR.raw, { onEditAsNew: editAsNew, bytes: CUR.bytes ? CUR.bytes.length : undefined });
  if (CUR.name) out.prepend(h('div', { class: 'mc-i-file' }, h('span', { class: 'mc-chip' }, CUR.name)));
}

function show(raw, bytes, name) {
  try {
    const msg = parseMessage(bytes || raw);
    // No headers at all = not an e-mail (parseMessage is lenient; this is the sanity check).
    if (!msg.headers.length) { toast(t('mc.i.notEml'), 'error'); return; }
    Object.assign(CUR, { name, raw, bytes, msg });
    idbSet('last', { name, raw, bytes });
    paint();
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}

async function readFile(f) {
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    // D0 CF 11 E0 = OLE compound file: an Outlook .msg, a different format; refused with a clear message.
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) { toast(t('mc.i.msgFile'), 'error'); return; }
    show(new TextDecoder('utf-8').decode(bytes), bytes, f.name);
  } catch (e) { toast(t('ap.fileErr', { name: f.name, msg: e.message }), 'error'); }
}

// A sample: a Georgian subject, an HTML body with an inline image, an attachment with a non-ASCII name.
function showSample() {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAOklEQVR42mP4TyJgGLQa+Mvy4AhZGlMcXQOmkTg14DEVWQEDLvNw2cmARylWbQzEqMbnaZppGNJpCQBWxmpPiKklqwAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const S = { from: 'ნინო <nino@example.ge>', to: 'Giorgi <giorgi@example.com>, ana@example.org', cc: '', bcc: '', replyTo: '', subject: t('mc.sample.subject'), mode: 'markdown', md: t('mc.sample.md').replace(/\n\n/, '\n\n![logo](cid:logo)\n\n'), headers: [], draft: false, priority: 'normal', date: true, msgId: true, encoding: 'auto' };
  const files = [{ name: 'logo.png', type: 'image/png', data: png, inline: true, cid: 'logo' }, { name: 'განრიგი.txt', type: 'text/plain', data: new TextEncoder().encode('10:00 — შეხვედრა\n12:00 — სადილი\n'), inline: false, cid: '' }];
  // The sample is built by the composer itself (round trip): a Georgian subject (RFC 2047), an inline image
  // (multipart/related) and an attachment with a non-ASCII name (RFC 2231).
  const b = composeMessage(S, files, { now: Date.now(), offset: -new Date().getTimezoneOffset(), random: (n) => crypto.getRandomValues(new Uint8Array(n)), boundary: 'sample' });
  show(b.eml, null, 'sample.eml');
}

async function editAsNew(msg) {
  const d = draftFromMessage(msg);
  // Hand-over to the composer through IndexedDB: attachments are binary and can be large.
  await idbSet('handoff', d);
  location.href = pageHref('pg-compose') + '#from=inspect';
}

async function start() {
  // The composer hands a message over with #from=compose; the hash is removed so a reload shows the stored 'last'.
  if (/from=compose/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + location.search);
    const v = await idbGet('inspect');
    if (v && typeof v.text === 'string') { render(); show(v.text, null, v.name || 'message.eml'); return; }
  }
  const last = await idbGet('last');
  if (last && typeof last.raw === 'string') Object.assign(CUR, { name: last.name || '', raw: last.raw, bytes: last.bytes instanceof Uint8Array ? last.bytes : null, msg: (() => { try { return parseMessage(last.bytes instanceof Uint8Array ? last.bytes : last.raw); } catch { return null; } })() });
  render();
}

startShell('inspect', () => render());
start();
