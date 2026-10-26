// crypto-tool/encoding-ui.js - the encoding page: text, hex or files through any registered binary-to-text encoding in
// either direction with its options, every encoding of an input at once, and detection of the encoding of a string
// (which decoders read it, exact round trips first).
// 
// Limits (constants below) keep O(n²) big-number encodings and the try-everything detection from freezing the page.
import { button, card, copyText, download, field, seg, select, textInput, toggle } from '../ui/app.js';
import { debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { pickFiles } from '../ui/files.js';
import { bytesToHex, bytesToUtf8, utf8ToBytes } from '../crypto/encoding.js';
import { createEncoding, getEncoding, getEncodings } from './encoding.js';
import { fmtSize, grouped, startShell, t } from './shell.js';

const SHOW_MAX = 500000;          // characters shown in the result box (Copy and Download take everything)
const ALL_MAX = 1 << 20;          // input limit of the "all encodings" table
const BIG_MAX = 1 << 20;          // input limit of the big-number encodings
const DETECT_MAX = 1 << 20;       // input limit of detection

const defs = () => grouped(getEncodings().map(getEncoding)).flatMap(([, list]) => list);
const S = {
  id: getEncoding(lsGet('ct-enc-id', 'base64')) ? lsGet('ct-enc-id', 'base64') : 'base64',
  dir: lsGet('ct-enc-dir', 'encode'),
  tab: lsGet('ct-enc-tab', 'convert'),
  fmt: lsGet('ct-enc-fmt', 'text'),   // input of encoding: UTF-8 text or hex bytes
  opts: lsGet('ct-enc-opts', {}),     // options set per encoding: { id: { key: value } }
  view: null,                         // decoded bytes shown as 'text' or 'hex' (null: whichever fits)
  text: '',
  file: null,                         // { name, bytes }
};
const main = document.getElementById('ct-main');
const save = () => { lsSet('ct-enc-id', S.id); lsSet('ct-enc-dir', S.dir); lsSet('ct-enc-tab', S.tab); lsSet('ct-enc-fmt', S.fmt); lsSet('ct-enc-opts', S.opts); };

const optsFor = (id) => ({ ...getEncoding(id).defaults, ...(S.opts[id] || {}) });
// The direction the input is read in: the "all" table encodes, detection decodes.
const mode = () => (S.tab === 'all' ? 'encode' : S.tab === 'detect' ? 'decode' : S.dir);

// Bytes -> string one code unit per byte (8-bit encodings like yEnc), in 8 KiB slices to stay under the argument limit of apply().
const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x2000)); return s; };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
// Bytes as readable text, or null (not UTF-8, or control characters other than tab and line breaks).
// A result counts as text only if it is valid UTF-8 without control characters; otherwise it is shown as hex.
function asText(bytes) {
  let s;
  try { s = bytesToUtf8(bytes, true); } catch { return null; }
  return CONTROL.test(s) ? null : s;
}

// --- input -----------------------------------------------------------------------------------------

// Bytes to encode (a string stays text: Punycode encodes characters, the others its UTF-8 bytes).
function encodeInput() {
  if (S.file) return S.file.bytes;
  if (S.fmt === 'hex') return createEncoding('base16').decode(S.text);
  return S.text;
}
const inputLength = (v) => (typeof v === 'string' ? utf8ToBytes(v).length : v.length);
// Text to decode (the bytes of an 8-bit encoding as they are).
const decodeInput = (def) => (S.file ? (def.binary ? S.file.bytes : bytesToUtf8(S.file.bytes)) : S.text);
const hasInput = () => !!(S.file || S.text);

async function loadFile(f) {
  S.file = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
  S.view = null;
  render();
}

function inputCard() {
  const m = mode();
  const ph = () => t(m === 'decode' ? 'enc.phDecode' : S.fmt === 'hex' ? 'enc.phHex' : 'enc.phText');
  const area = textInput(S.text, (v) => { S.text = v; S.view = null; later(); }, { multiline: true, class: 'ed-input ed-textarea ct-area', placeholder: ph(), 'aria-label': t('enc.input'), hidden: !!S.file });
  // A file can also be dropped onto the text area.
  area.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  area.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); loadFile(f); } });
  const fmt = m === 'encode' && !S.file
    ? seg([{ v: 'text', l: 'enc.text' }, { v: 'hex', l: 'enc.hex' }], S.fmt, (v) => { S.fmt = v; save(); area.placeholder = ph(); refresh(); }, 'enc.inputFormat')
    : null;
  const open = button('enc.openFile', 'upload', async () => { const [f] = await pickFiles({}); if (f) loadFile(f); });
  const file = S.file ? h('div', { class: 'ct-file-h ct-enc-file' }, iconEl('file'),
    h('span', { class: 'ct-file-name', title: S.file.name }, S.file.name), h('span', { class: 'ct-file-meta' }, fmtSize(S.file.bytes.length)), h('span', { class: 'ed-spacer' }),
    h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('enc.removeFile'), 'aria-label': t('enc.removeFile'), onclick: () => { S.file = null; S.view = null; render(); } }, iconEl('close'))) : null;
  return h('section', { class: 'ap-card' },
    h('div', { class: 'ct-card-row' }, h('h2', { class: 'ap-card-h' }, t('enc.input')), h('div', { class: 'ap-row' }, fmt, open)),
    file, area, h('div', { class: 'ed-hint', id: 'ct-enc-count' }));
}

function paintCount() {
  const el = document.getElementById('ct-enc-count');
  if (!el) return;
  if (S.file) { el.textContent = ''; return; }
  const chars = [...S.text].length;
  el.textContent = mode() === 'encode' && S.fmt === 'text' ? `${t('enc.chars', { n: chars })} · ${t('u.bytes', { n: utf8ToBytes(S.text).length })}` : t('enc.chars', { n: chars });
}

// --- conversion --------------------------------------------------------------------------------------

// One conversion with the selected encoding: { out (string), bytes (Uint8Array), info } or { error }.
// Quadratic encodings are refused above BIG_MAX instead of hanging; decoding input is text, so its limit is in characters (×2).
function convert() {
  const def = getEncoding(S.id);
  const ctx = createEncoding(S.id, optsFor(S.id));
  try {
    if (S.dir === 'encode') {
      const input = encodeInput();
      if (def.isQuadratic(optsFor(S.id)) && inputLength(input) > BIG_MAX) return { error: t('enc.tooLong', { max: fmtSize(BIG_MAX) }) };
      const out = ctx.encode(input);
      return { out: out instanceof Uint8Array ? latin1(out) : out, raw: out, info: ctx.info };
    }
    const input = decodeInput(def);
    if (def.isQuadratic(optsFor(S.id)) && input.length > BIG_MAX * 2) return { error: t('enc.tooLong', { max: fmtSize(BIG_MAX) }) };
    return { bytes: ctx.decode(input), info: ctx.info };
  } catch (e) {
    return { error: t('enc.error', { msg: e.message }) };
  }
}

function factsLine(info) {
  const chips = [];
  for (const k of ['name', 'mode', 'hrp', 'witness']) {
    if (info[k] !== undefined && info[k] !== '') chips.push(h('span', { class: 'ct-status ct-wait' }, `${t('enc.fact.' + k)}: ${info[k]}`));
  }
  if (info.size !== undefined && !Number.isNaN(info.size)) chips.push(h('span', { class: 'ct-status ' + (info.sizeOk ? 'ct-ok' : 'ct-bad') }, iconEl(info.sizeOk ? 'check' : 'warn'), `${t('enc.fact.size')}: ${fmtSize(info.size)}`));
  if (info.crc32 && info.crcOk !== undefined) {
    chips.push(h('span', { class: 'ct-status ' + (info.crcOk ? 'ct-ok' : info.crcOk === false ? 'ct-bad' : 'ct-wait') }, iconEl(info.crcOk === false ? 'warn' : 'check'), `CRC-32 ${info.crc32}`));
  }
  return chips.length ? h('div', { class: 'ct-line ct-facts' }, chips) : null;
}

// The result of a decoding as text or hex: { text, view, fallback }.
function shown(bytes) {
  const text = asText(bytes);
  const view = S.view || (text != null ? 'text' : 'hex');
  if (view === 'text' && text != null) return { text, view };
  return { text: bytesToHex(bytes), view: 'hex', fallback: view === 'text' };
}

let result = null;
function paintResult() {
  const box = document.getElementById('ct-enc-result');
  if (!box) return;
  box.textContent = '';
  const def = getEncoding(S.id);
  result = hasInput() ? convert() : null;
  if (!result) { box.append(h('div', { class: 'ap-empty' }, t('enc.empty'))); return; }
  if (result.error) { box.append(h('div', { class: 'ct-line' }, h('span', { class: 'ct-status ct-bad' }, iconEl('warn'), result.error))); return; }
  let text, hint = null, viewSeg = null;
  if (S.dir === 'encode') {
    text = result.out;
    if (def.binary) hint = t('note.binary');
  } else {
    const s = shown(result.bytes);
    text = s.text;
    viewSeg = seg([{ v: 'text', l: 'enc.text' }, { v: 'hex', l: 'enc.hex' }], s.view, (v) => { S.view = v; paintResult(); }, 'enc.view');
    if (s.fallback) hint = t('enc.notText');
  }
  const out = h('textarea', { class: 'ed-input ed-textarea ct-area ct-out', readonly: true, spellcheck: 'false', 'aria-label': t('ap.result') });
  out.value = text.length > SHOW_MAX ? text.slice(0, SHOW_MAX) : text;
  const stats = S.dir === 'encode'
    ? `${t('u.bytes', { n: inputLength(encodeInput()) })} → ${t('enc.chars', { n: result.raw instanceof Uint8Array ? result.raw.length : text.length })}`
    : `${t('enc.chars', { n: decodeInput(def).length })} → ${t('u.bytes', { n: result.bytes.length })}`;
  box.append(...[
    viewSeg ? h('div', { class: 'ap-row', style: { marginBottom: '8px' } }, h('span', { class: 'ed-label', style: { margin: 0 } }, t('enc.view')), viewSeg) : null,
    factsLine(result.info),
    out,
    h('div', { class: 'ed-hint' }, stats),
    text.length > SHOW_MAX ? h('div', { class: 'ed-hint' }, t('enc.truncated', { n: SHOW_MAX.toLocaleString() })) : null,
    hint ? h('div', { class: 'ed-hint' }, hint) : null,
    h('div', { class: 'ap-actions' },
      button('ap.copy', 'copy', () => copyText(text)),
      button('ap.download', 'download', saveResult),
      button('enc.swap', 'refresh', swap)),
  ].filter(Boolean));
}

function saveResult() {
  const def = getEncoding(S.id);
  if (!result || result.error) return;
  if (S.dir === 'encode') {
    const name = `${S.file ? S.file.name : 'encoded'}.${def.ext}`;
    if (result.raw instanceof Uint8Array) download(result.raw, name);
    else download(result.out, name, 'text/plain;charset=utf-8');
  } else {
    const fromFile = S.file && S.file.name.includes('.') ? S.file.name.replace(/\.[^.]+$/, '') : '';
    download(result.bytes, result.info.name || fromFile || 'decoded.bin');
  }
}

// The result becomes the input of the other direction.
function swap() {
  if (!result || result.error) return;
  if (S.dir === 'encode') {
    S.dir = 'decode';
    S.text = result.out;
  } else {
    S.dir = 'encode';
    const text = asText(result.bytes);
    S.fmt = text != null ? 'text' : 'hex';
    S.text = text != null ? text : bytesToHex(result.bytes);
  }
  S.file = null;
  S.view = null;
  save();
  render();
}

// The encodings as a drop-down list (the chips of the side panel come after the stage on narrow screens).
function encodingSelect() {
  const s = h('select', { class: 'ed-input ed-select ct-enc-select', 'aria-label': t('enc.encoding') },
    grouped(getEncodings().map(getEncoding)).map(([g, list]) => h('optgroup', { label: t('grp.' + g) },
      list.map((d) => h('option', { value: d.id, selected: d.id === S.id }, d.label)))));
  s.addEventListener('change', () => { S.id = s.value; S.view = null; save(); render(); });
  return s;
}

function convertPanel() {
  const def = getEncoding(S.id);
  const dir = seg([{ v: 'encode', l: 'enc.encode' }, { v: 'decode', l: 'enc.decode' }], S.dir, (v) => { S.dir = v; S.view = null; save(); render(); }, 'enc.dir');
  return h('div', { class: 'ct-panel' },
    h('div', { class: 'ap-row' }, dir, encodingSelect()),
    def.note ? h('div', { class: 'ed-hint', style: { marginTop: '-6px' } }, t('note.' + def.note)) : null,
    inputCard(),
    optionsCard(),
    card('ap.result', h('div', { id: 'ct-enc-result' })));
}

// --- every encoding of the input -------------------------------------------------------------------------

const clip = (s, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

function paintAll() {
  const box = document.getElementById('ct-enc-all');
  if (!box) return;
  box.textContent = '';
  if (!hasInput()) { box.append(h('div', { class: 'ap-empty' }, t('enc.empty'))); return; }
  let input;
  try { input = encodeInput(); } catch (e) { box.append(h('div', { class: 'ct-line' }, h('span', { class: 'ct-status ct-bad' }, iconEl('warn'), t('enc.error', { msg: e.message })))); return; }
  const n = inputLength(input);
  if (n > ALL_MAX) { box.append(h('div', { class: 'ap-empty' }, t('enc.allTooLong', { max: fmtSize(ALL_MAX) }))); return; }
  const rows = [];
  for (const [g, list] of grouped(getEncodings().map(getEncoding))) {
    rows.push(h('tr', { class: 'ct-group-row' }, h('th', { colspan: '3' }, t('grp.' + g))));
    for (const d of list) {
      let text = null, err = '';
      if (d.isQuadratic(optsFor(d.id)) && n > BIG_MAX / 16) err = t('enc.tooLong', { max: fmtSize(BIG_MAX / 16) });
      else {
        try { const o = createEncoding(d.id, optsFor(d.id)).encode(input); text = o instanceof Uint8Array ? latin1(o) : o; } catch (e) { err = e.message; }
      }
      const open = () => { S.id = d.id; S.dir = 'encode'; S.tab = 'convert'; save(); render(); };
      rows.push(h('tr', {},
        h('td', { class: 'ct-algo' }, h('button', { type: 'button', class: 'ct-link', title: t('enc.open'), onclick: open }, d.label)),
        h('td', { class: 'ct-digest' + (text == null ? ' ct-muted' : '') }, text == null ? err : clip(text)),
        h('td', { class: 'ct-act' }, text != null ? h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ap.copy'), 'aria-label': `${t('ap.copy')} ${d.label}`, onclick: () => copyText(text) }, iconEl('copy')) : null)));
    }
  }
  box.append(h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table ct-table ct-enc-table' },
    h('colgroup', {}, h('col', { class: 'ct-col-name' }), h('col'), h('col', { class: 'ct-col-act' })), h('tbody', {}, rows))));
}

function allPanel() {
  return h('div', { class: 'ct-panel' },
    inputCard(),
    card('tab.all', h('div', { class: 'ed-hint', style: { marginTop: 0, marginBottom: '8px' } }, t('enc.allHint')), h('div', { id: 'ct-enc-all' })));
}

// --- detection ---------------------------------------------------------------------------------------------

// The same text up to whitespace and padding; for a decoder that ignores case, the input must be in one case.
const strip = (s) => String(s).replace(/\s+/g, '').replace(/=+$/, '');
// Round-trip check ignores whitespace and trailing padding; for case-insensitive decoders the input must be in one case to count as exact.
function sameText(again, input, d) {
  const a = strip(again), b = strip(input);
  return a === b || (d.caseless && (b === b.toLowerCase() || b === b.toUpperCase()) && a.toLowerCase() === b.toLowerCase());
}
// Facts of a decoding as options of the encoder (Bech32 prefix, UU file name…), for the round trip.
const factsAsOptions = (d, info) => Object.fromEntries(d.options.filter((o) => info[o.key] !== undefined).map((o) => [o.key, o.type === 'choice' ? String(info[o.key]) : info[o.key]]));

// Try every decoder; rank by evidence: a verified checksum (4) > exact round trip (2) > readable text (1), ties in registry
// order. Decoders that return the input unchanged (percent, quoted-printable on plain text) are dropped: they prove nothing.
function detect() {
  const found = [];
  const order = defs();
  for (const d of order) {
    const opts = optsFor(d.id);
    try {
      const input = decodeInput(d);
      if (typeof input === 'string' ? !input.trim() : !input.length) continue;
      if (d.isQuadratic(opts) && input.length > BIG_MAX / 8) continue;
      const c = createEncoding(d.id, opts);
      const bytes = c.decode(input);
      if (!bytes.length) continue;
      let exact = false;
      try {
        const again = createEncoding(d.id, { ...opts, ...factsAsOptions(d, c.info) }).encode(bytes);
        exact = sameText(again instanceof Uint8Array ? latin1(again) : again, input instanceof Uint8Array ? latin1(input) : input, d);
      } catch { /* not reversible with these options */ }
      const text = asText(bytes);
      // Decoders that give the input back unchanged (quoted-printable or percent-encoding of plain text) say nothing.
      if (text != null && typeof input === 'string' && text.trim() === input.trim()) continue;
      // A verified checksum outweighs everything, then an exact round trip, then readable text.
      found.push({ d, bytes, text, exact, info: c.info, score: (d.checksum ? 4 : 0) + (exact ? 2 : 0) + (text != null ? 1 : 0) });
    } catch { /* not this encoding */ }
  }
  return found.sort((a, b) => b.score - a.score || order.indexOf(a.d) - order.indexOf(b.d));
}

function paintDetect() {
  const box = document.getElementById('ct-enc-detect');
  if (!box) return;
  box.textContent = '';
  if (!hasInput()) { box.append(h('div', { class: 'ap-empty' }, t('enc.empty'))); return; }
  if ((S.file ? S.file.bytes.length : S.text.length) > DETECT_MAX) { box.append(h('div', { class: 'ap-empty' }, t('enc.allTooLong', { max: fmtSize(DETECT_MAX) }))); return; }
  const found = detect();
  if (!found.length) { box.append(h('div', { class: 'ap-empty' }, t('enc.detectNone'))); return; }
  const rows = found.map((r) => {
    const open = () => { S.id = r.d.id; S.dir = 'decode'; S.tab = 'convert'; S.view = null; save(); render(); };
    return h('tr', { class: r.score >= 3 ? 'ct-match' : '' },
      h('td', { class: 'ct-algo' }, h('button', { type: 'button', class: 'ct-link', title: t('enc.open'), onclick: open }, r.d.label),
        r.d.checksum ? h('span', { class: 'ct-exact' }, t('enc.checksumOk')) : null,
        r.exact ? h('span', { class: 'ct-exact', title: t('enc.exactHint') }, t('enc.exact')) : null),
      h('td', { class: 'ct-digest' + (r.text == null ? ' ct-muted' : '') }, clip(r.text != null ? r.text : bytesToHex(r.bytes), 300)),
      h('td', { class: 'ct-size' }, t('u.bytes', { n: r.bytes.length })));
  });
  box.append(h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table ct-table ct-enc-table' },
    h('colgroup', {}, h('col', { class: 'ct-col-name' }), h('col'), h('col', { class: 'ct-col-size' })),
    h('thead', {}, h('tr', {}, h('th', {}, t('enc.col.encoding')), h('th', {}, t('enc.col.decoded')), h('th', { class: 'ct-size' }, t('enc.col.size')))),
    h('tbody', {}, rows))));
}

function detectPanel() {
  return h('div', { class: 'ct-panel' },
    inputCard(),
    card('tab.detect', h('div', { class: 'ed-hint', style: { marginTop: 0, marginBottom: '8px' } }, t('enc.detectHint')), h('div', { id: 'ct-enc-detect' })));
}

// --- side panel ---------------------------------------------------------------------------------------------

function encodingCard() {
  const groups = grouped(getEncodings().map(getEncoding)).map(([g, list]) => h('div', { class: 'ct-group' },
    h('h3', { class: 'ct-group-h' }, t('grp.' + g)),
    h('div', { class: 'ct-chips' }, list.map((d) => h('button', {
      type: 'button', class: 'ed-chip', 'aria-pressed': String(d.id === S.id), title: d.note ? t('note.' + d.note) : null,
      onclick: () => { S.id = d.id; S.view = null; save(); render(); },
    }, d.label)))));
  return card('enc.encoding', groups);
}

function optionControl(id, o) {
  const value = optsFor(id)[o.key];
  const set = (v) => { S.opts[id] = { ...(S.opts[id] || {}), [o.key]: v }; save(); refresh(); };
  const label = 'opt.' + o.key;
  if (o.type === 'bool') return field(label, toggle(value, set));
  if (o.type === 'choice') {
    const pick = (v) => set(o.choices.find((c) => String(c.v) === String(v)).v);
    return field(label, o.choices.length <= 3 ? seg(o.choices, value, pick, label) : select(o.choices, value, pick));
  }
  if (o.type === 'number') return field(label, textInput(String(value), (v) => { const n = Math.floor(+v); if (n >= o.min && n <= o.max) set(n); }, { type: 'number', min: o.min, max: o.max, inputmode: 'numeric' }));
  return field(label, textInput(value, set, { autocomplete: 'off' }));
}

// Options of the selected encoding in the current direction (no card without options).
function optionsCard() {
  const def = getEncoding(S.id);
  const list = def.options.filter((o) => o.dir === 'both' || o.dir === S.dir);
  if (!list.length) return null;
  const reset = S.opts[def.id] ? h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { delete S.opts[def.id]; save(); render(); } }, iconEl('undo'), t('enc.defaults')) : null;
  return h('section', { class: 'ap-card' },
    h('div', { class: 'ct-card-row' }, h('h2', { class: 'ap-card-h' }, `${def.label} · ${t('enc.options')}`), reset),
    h('div', { class: 'ct-enc-opts' }, list.map((o) => optionControl(def.id, o))));
}

// --- page -----------------------------------------------------------------------------------------------------

function refresh() {
  paintCount();
  paintResult();
  paintAll();
  paintDetect();
}
const later = debounce(refresh, 150);

function render() {
  main.textContent = '';
  const tabs = seg([{ v: 'convert', l: 'tab.convert' }, { v: 'all', l: 'tab.all' }, { v: 'detect', l: 'tab.detect' }], S.tab,
    (v) => { S.tab = v; save(); render(); }, 'enc.tabs');
  tabs.classList.add('ct-tabs');
  const stage = S.tab === 'all' ? allPanel() : S.tab === 'detect' ? detectPanel() : convertPanel();
  main.append(h('div', { class: 'ap-work ct-stage-first' },
    h('aside', { class: 'ap-side', 'aria-label': t('enc.encoding') }, encodingCard()),
    h('div', { class: 'ap-stage' }, tabs, stage)));
  refresh();
}

startShell('encoding', render);
render();
