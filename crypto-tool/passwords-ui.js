// crypto-tool/passwords-ui.js - the passwords page: a generator of passwords from alphabets (KeePassXC's character groups,
// Latin-1, Cyrillic, Greek, emoji, own characters; look-alikes; a character of every group; exact entropy), of
// passphrases (built-in, common English or own word list) and of random keys, several at once; and a checker that
// estimates a typed password like KeePassXC (zxcvbn: the cheapest decomposition into matches, entropy, quality, guesses,
// crack times, advice). Typed and generated passwords are never stored or logged; only the generator settings are
// remembered.
// 
// Two entropy figures on purpose: the exact entropy of the generator (log2 of the pool size^length, known because we
// chose the process) and the zxcvbn estimate (what an attacker without knowledge of the process would need). The
// estimate is usually lower for short passwords and is shown per generated value.
import { button, card, copyText, download, field, seg, select, textInput, toggle } from '../ui/app.js';
import { debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { fmtNum, startShell, strengthMeter, t } from './shell.js';
import { bytesToBase64, bytesToHex } from '../crypto/encoding.js';
import { randomBytes } from '../crypto/random.js';
import { ALPHABETS, LOOK_ALIKE, PASSPHRASE_SYMBOLS, WORDS, generatePassphrase, passwordGenerator } from '../crypto/password.js';
import { SCENARIOS, dictionaryInfo, passwordStrength, quality, wordList } from '../crypto/strength.js';

const KEY = 'ct-pw';
const SPECIAL = ALPHABETS.filter((a) => a.special).map((a) => a.id);
const DEF = {
  mode: 'password', count: 1,
  length: 20, alphabets: ['upper', 'lower', 'digits', ...SPECIAL], include: '', exclude: '', lookAlike: false, everyGroup: true,
  words: 6, list: 'english', separator: '-', wordCase: 'lower', number: false, symbol: false,
  bits: 256, fmt: 'hex',
};
// Settings only (no password, no own word list); unknown or mistyped values fall back to the defaults.
// Stored settings are validated field by field against the defaults (same type, array-ness); the own word list is never persisted.
const S = (() => {
  const saved = lsGet(KEY, {}) || {};
  const s = { ...DEF };
  for (const k of Object.keys(DEF)) if (saved[k] !== undefined && typeof saved[k] === typeof DEF[k] && Array.isArray(saved[k]) === Array.isArray(DEF[k])) s[k] = saved[k];
  s.alphabets = s.alphabets.filter((id) => ALPHABETS.some((a) => a.id === id));
  if (s.list === 'own') s.list = 'english'; // the own list itself is never saved
  return s;
})();
const save = () => lsSet(KEY, Object.fromEntries(Object.keys(DEF).map((k) => [k, S[k]])));
const main = document.getElementById('ct-main');

const MAX_LEN = 128, MAX_COUNT = 100;
const LABELS = {
  upper: 'A–Z', lower: 'a–z', digits: '0–9', braces: '( ) [ ] { }', punctuation: '. , : ;', quotes: '" \'', dashes: '- / \\ _ |',
  math: '! * + < = > ?', logograms: '# $ % & @ ^ ` ~', latin1: '¡ ¿ Ä ß ÿ', cyrillic: 'А–Я а–я', greek: 'Α–Ω α–ω', emoji: '😀 🐶',
};
const GRAPHS = { qwerty: '=QWERTY', dvorak: '=Dvorak', qwertz: '=QWERTZ', azerty: '=AZERTY', jcuken: '=ЙЦУКЕН', keypad: 'kb.keypad', mac_keypad: 'kb.mac_keypad' };
const tx = (s) => (String(s).startsWith('=') ? String(s).slice(1) : t(s));

// --- generation -----------------------------------------------------------------------------------------------

let ownWords = ''; // pasted word list: kept in memory only
const out = { values: [], entropy: 0, error: '', info: '' };

let englishWords = null;
// Common English words for passphrases: 4-9 letters, the 7776 most frequent (the size of a five-dice list).
// 7776 = 6^5 words, the size of a five-dice Diceware list (12.9 bits per word); lazily built on first use.
const english = () => englishWords || (englishWords = wordList('english').filter((w) => /^[a-z]{4,9}$/.test(w)).slice(0, 7776));
const ownList = () => [...new Set(ownWords.split(/[\s,;]+/).map((w) => w.trim().toLowerCase()).filter(Boolean))];
const listFor = (id) => (id === 'own' ? ownList() : id === 'short' ? WORDS : english());

// All randomness from crypto/password.js and randomBytes (crypto.getRandomValues), with rejection sampling in the library to avoid modulo bias.
function generate() {
  out.values = [];
  out.error = '';
  out.info = '';
  out.entropy = 0;
  const n = Math.max(1, Math.min(MAX_COUNT, S.count | 0));
  try {
    if (S.mode === 'password') {
      const g = passwordGenerator({ length: S.length, alphabets: S.alphabets, include: S.include, exclude: S.exclude, lookAlike: S.lookAlike, everyGroup: S.everyGroup });
      for (let i = 0; i < n; i++) out.values.push(g.next());
      out.entropy = g.entropy;
      out.info = `${t('pw.chars', { n: g.pool })} · ${t('pw.groupsN', { n: g.groups.length })}`;
    } else if (S.mode === 'passphrase') {
      const list = listFor(S.list);
      let size = 0;
      for (let i = 0; i < n; i++) {
        const r = generatePassphrase({ words: S.words, separator: S.separator, wordCase: S.wordCase, number: S.number, symbol: S.symbol, list });
        out.values.push(r.password);
        out.entropy = r.entropy;
        size = r.size;
      }
      out.info = t('pw.passInfo', { n: size, bits: fmtNum(Math.log2(size), 2) });
    } else {
      for (let i = 0; i < n; i++) {
        const k = randomBytes(S.bits / 8);
        out.values.push(S.fmt === 'base64' ? bytesToBase64(k) : bytesToHex(k));
      }
      out.entropy = S.bits;
      out.info = t('pw.keyInfo', { bits: S.bits });
    }
  } catch (e) {
    out.values = [];
    out.error = e.code === 'short' ? t('pw.err.short', { n: e.min }) : e.code === 'empty' ? t(S.mode === 'passphrase' ? 'pw.err.words' : 'pw.err.empty') : e.message;
  }
}

// --- small controls -------------------------------------------------------------------------------------------

// Slider and number box kept in step.
function rangeNumber(value, min, max, onChange, label) {
  const r = h('input', { type: 'range', class: 'ed-range', min, max, step: 1, value, 'aria-label': t(label) });
  const num = h('input', { type: 'number', class: 'ed-input ct-num', min, max, step: 1, value, inputmode: 'numeric', 'aria-label': t(label) });
  r.addEventListener('input', () => { num.value = r.value; onChange(+r.value); });
  num.addEventListener('input', () => {
    const v = Math.floor(+num.value);
    if (!(v >= min && v <= max)) return;
    r.value = String(v);
    onChange(v);
  });
  num.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Math.floor(+num.value) || min)); num.value = String(v); r.value = String(v); onChange(v); });
  return h('div', { class: 'ct-rangenum' }, r, num);
}

function chip(label, on, onToggle, title) {
  const b = h('button', { type: 'button', class: 'ed-chip ct-gchip' + (on ? ' ed-on' : ''), 'aria-pressed': String(on), title, 'aria-label': title }, label);
  b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); b.classList.toggle('ed-on', v); onToggle(v); });
  return b;
}

const iconBtn = (ic, label, onclick) => h('button', { type: 'button', class: 'ed-iconbtn', title: t(label), 'aria-label': t(label), onclick }, iconEl(ic));

// --- generator settings --------------------------------------------------------------------------------------

let paintResult = () => {};
const regen = () => { generate(); paintResult(); };
const set = (k, v, again = true) => { S[k] = v; save(); if (again) regen(); };

function groupChips(ids) {
  return h('div', { class: 'ct-chips' }, ids.map((id) => {
    const a = ALPHABETS.find((x) => x.id === id);
    const title = `${t('pw.grp.' + id)} (${[...a.chars].length})`;
    return chip(LABELS[id], S.alphabets.includes(id), (on) => {
      set('alphabets', on ? [...S.alphabets, id] : S.alphabets.filter((x) => x !== id));
    }, title);
  }));
}

function passwordOptions() {
  const lookAlike = [...LOOK_ALIKE].join(' ');
  return [
    field('pw.length', rangeNumber(S.length, 1, MAX_LEN, (v) => set('length', v), 'pw.length')),
    h('div', { class: 'ed-field' }, h('div', { class: 'ed-label' }, t('pw.groups')),
      h('div', { class: 'ct-group' }, h('h3', { class: 'ct-group-h' }, t('pw.basic')), groupChips(['upper', 'lower', 'digits'])),
      h('div', { class: 'ct-group' }, h('h3', { class: 'ct-group-h' }, t('pw.special')), groupChips(SPECIAL)),
      h('div', { class: 'ct-group' }, h('h3', { class: 'ct-group-h' }, t('pw.other')), groupChips(['latin1', 'cyrillic', 'greek', 'emoji']))),
    field('pw.include', textInput(S.include, (v) => set('include', v), { placeholder: t('pw.includePh'), autocomplete: 'off', class: 'ed-input ct-mono-in' })),
    field('pw.exclude', textInput(S.exclude, (v) => set('exclude', v), { placeholder: t('pw.excludePh'), autocomplete: 'off', class: 'ed-input ct-mono-in' })),
    field('pw.lookAlike', toggle(S.lookAlike, (v) => set('lookAlike', v)), '=' + t('pw.lookAlikeHint', { chars: lookAlike })),
    field('pw.everyGroup', toggle(S.everyGroup, (v) => set('everyGroup', v)), 'pw.everyGroupHint'),
  ];
}

function passphraseOptions(repaint) {
  const own = S.list === 'own';
  const ownInfo = h('div', { class: 'ed-hint' });
  const paintOwn = () => { ownInfo.textContent = `${t('pw.ownInfo', { n: ownList().length })} ${t('pw.ownHint')}`; };
  const area = textInput(ownWords, (v) => { ownWords = v; paintOwn(); regen(); }, { multiline: true, class: 'ed-input ed-textarea ct-own', placeholder: t('pw.ownPh'), 'aria-label': t('pw.list.own') });
  paintOwn();
  return [
    field('pw.words', rangeNumber(S.words, 1, 32, (v) => set('words', v), 'pw.words')),
    field('pw.list', select([
      { v: 'english', l: '=' + t('pw.list.english', { n: english().length }) },
      { v: 'short', l: '=' + t('pw.list.short', { n: WORDS.length }) },
      { v: 'own', l: 'pw.list.own' }], S.list, (v) => { set('list', v); repaint(); })),
    own ? h('div', { class: 'ed-field' }, area, ownInfo) : null,
    field('pw.separator', textInput(S.separator, (v) => set('separator', v.slice(0, 8)), { maxlength: 8, autocomplete: 'off', class: 'ed-input ct-mono-in ct-sep' }), 'pw.separatorHint'),
    field('pw.case', seg([{ v: 'lower', l: 'pw.case.lower' }, { v: 'title', l: 'pw.case.title' }, { v: 'upper', l: 'pw.case.upper' }, { v: 'mixed', l: 'pw.case.mixed' }], S.wordCase, (v) => set('wordCase', v), 'pw.case')),
    h('div', { class: 'ct-grid2' },
      field('pw.number', toggle(S.number, (v) => set('number', v))),
      field('pw.symbol', toggle(S.symbol, (v) => set('symbol', v)))),
    h('div', { class: 'ed-hint' }, t('pw.symbolHint', { chars: PASSPHRASE_SYMBOLS })),
  ];
}

function keyOptions() {
  return [
    field('pw.keySize', seg([128, 192, 256, 512].map((b) => ({ v: b, l: '=' + b })), S.bits, (v) => set('bits', +v), 'pw.keySize'), 'pw.keySizeHint'),
    field('pw.keyFormat', seg([{ v: 'hex', l: 'enc.hex' }, { v: 'base64', l: '=Base64' }], S.fmt, (v) => set('fmt', v), 'pw.keyFormat')),
  ];
}

function settingsCard() {
  const opts = h('div', { class: 'ed-fields' });
  const paintOpts = () => {
    opts.textContent = '';
    opts.append(...(S.mode === 'password' ? passwordOptions() : S.mode === 'passphrase' ? passphraseOptions(paintOpts) : keyOptions()).filter(Boolean));
  };
  paintOpts();
  const mode = seg([{ v: 'password', l: 'pw.mode.password' }, { v: 'passphrase', l: 'pw.mode.passphrase' }, { v: 'key', l: 'pw.mode.key' }], S.mode,
    (v) => { set('mode', v, false); paintOpts(); regen(); }, 'pw.mode');
  mode.classList.add('ct-wideseg');
  const c = card('pw.settings', mode, opts);
  c.classList.add('ct-pw-set');
  return c;
}

// --- generated passwords --------------------------------------------------------------------------------------

// Run counter: a newer generation cancels the slices of an older estimate still in progress.
let estimateRun = 0;
function resultCard() {
  const body = h('div', { class: 'ed-fields' });
  const count = h('input', { type: 'number', class: 'ed-input ct-num', min: 1, max: MAX_COUNT, step: 1, value: S.count, inputmode: 'numeric', 'aria-label': t('pw.count') });
  count.addEventListener('change', () => { const v = Math.max(1, Math.min(MAX_COUNT, Math.floor(+count.value) || 1)); count.value = String(v); set('count', v); });
  const tools = h('div', { class: 'ct-pw-tools' },
    h('label', { class: 'ct-count' }, t('pw.count'), count),
    h('span', { class: 'ed-spacer' }),
    button('pw.again', 'refresh', regen, 'primary'),
    button('pw.copyAll', 'copy', () => { if (out.values.length) copyText(out.values.join('\n'), t(out.values.length > 1 ? 'pw.copiedAll' : 'ap.copied')); }),
    button('pw.download', 'download', () => { if (out.values.length) download(out.values.join('\n') + '\n', 'passwords.txt', 'text/plain;charset=utf-8'); }));
  paintResult = () => {
    body.textContent = '';
    const run = ++estimateRun;
    if (out.error) { body.append(h('div', { class: 'ct-line ct-err' }, iconEl('warn'), out.error)); return; }
    const one = out.values.length === 1;
    const rows = out.values.map((v) => {
      const est = h('span', { class: 'ct-est' }, '…');
      const li = h('li', { class: 'ct-pw-item' + (one ? ' ct-pw-one' : '') },
        h('output', { class: 'ct-pw-val' }, v),
        est,
        iconBtn('copy', 'pw.copy', () => copyText(v)),
        iconBtn('search', 'pw.toCheck', () => checkThis(v)));
      return { li, est, value: v };
    });
    const list = h('ul', { class: 'ct-pw-list', 'aria-live': 'polite' }, rows.map((r) => r.li));
    const estLine = h('div', { class: 'ed-hint' });
    body.append(list,
      strengthMeter(out.entropy, quality(out.entropy), `${t('pw.exactNote')} ${out.info}`),
      estLine);
    // zxcvbn estimates of the rows, in slices of about 25 ms so a long batch never blocks the page.
    const bits = [];
    let k = 0;
    const step = () => {
      if (run !== estimateRun) return;
      for (const t0 = performance.now(); k < rows.length && performance.now() - t0 < 25; k++) {
        const r = passwordStrength(rows[k].value);
        bits.push(r.entropy);
        rows[k].est.textContent = t('pw.bitsShort', { bits: fmtNum(r.entropy, 1) });
        rows[k].est.dataset.q = r.quality;
        rows[k].est.title = `${t('pw.estimateTitle')}: ${t('pw.entropy', { bits: fmtNum(r.entropy, 2) })} · ${t('q.' + r.quality)}`;
      }
      if (k < rows.length) { setTimeout(step, 0); return; }
      const lo = Math.min(...bits), hi = Math.max(...bits);
      estLine.textContent = rows.length === 1 ? t('pw.estimateOne', { bits: fmtNum(lo, 2), q: t('q.' + quality(lo)) })
        : t('pw.estimateMany', { min: fmtNum(lo, 1), max: fmtNum(hi, 1) });
    };
    step();
  };
  paintResult();
  const c = card('pw.result', tools, body);
  c.classList.add('ct-pw-out');
  return c;
}

// --- checker --------------------------------------------------------------------------------------------------

const chk = { pw: '', user: '', show: false }; // never stored
let checkInput = null, paintCheck = () => {};

function checkThis(v) {
  chk.pw = v;
  if (checkInput) { checkInput.value = v; paintCheck(); checkInput.closest('.ap-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function guessesEl(r) {
  if (r.guessesLog10 < 9) return h('span', {}, fmtNum(Math.round(r.guesses)));
  const e = Math.floor(r.guessesLog10), m = 10 ** (r.guessesLog10 - e);
  return h('span', {}, `${fmtNum(m, 1)} × 10`, h('sup', {}, String(e)));
}

// zxcvbn units: a month is 31 days and a year 12 such months; 100+ years shown as "centuries".
function crackTime(sec) {
  if (!(sec >= 1)) return t('time.instant');
  const U = [['second', 1], ['minute', 60], ['hour', 3600], ['day', 86400], ['month', 86400 * 31], ['year', 86400 * 31 * 12]];
  if (sec >= 86400 * 31 * 12 * 100) return t('time.centuries');
  let u = U[0];
  for (const x of U) if (sec >= x[1]) u = x;
  return t('time.' + u[0], { n: Math.round(sec / u[1]) });
}

// Hidden mode: tokens masked by code point count (emoji are one bullet, not two).
const mask = (token) => '•'.repeat([...token].length);

function details(m, show) {
  const parts = [];
  switch (m.pattern) {
    case 'dictionary':
      parts.push(t('dict.' + m.dictionary), t('pw.rank', { n: fmtNum(m.rank) }));
      if (show && m.word !== m.token.toLowerCase()) parts.push(`“${m.translit || m.word}”`);
      else if (show && m.translit) parts.push(`“${m.translit}”`);
      if (m.translit) parts.push(t('pw.translit'));
      if (m.reversed) parts.push(t('pw.reversed'));
      if (m.l33t) parts.push(show ? t('pw.l33t', { s: Object.entries(m.sub).map(([a, b]) => `${a}→${b}`).join(' ') }) : t('pw.l33tHidden'));
      if (m.layout) parts.push(t(m.layout === 'ru' ? 'pw.layoutRu' : 'pw.layoutEn'));
      if (m.uppercaseVariations > 1) parts.push(t('pw.caseVar', { n: fmtNum(m.uppercaseVariations) }));
      break;
    case 'spatial':
      parts.push(tx(GRAPHS[m.graph] || '=' + m.graph), t('pw.turns', { n: m.turns }));
      if (m.shifted) parts.push(t('pw.shifted', { n: m.shifted }));
      break;
    case 'repeat': parts.push(show ? `“${m.base}” × ${m.count}` : `× ${m.count}`); break;
    case 'sequence': parts.push(t(m.ascending ? 'pw.asc' : 'pw.desc')); break;
    case 'regex': parts.push(t('pw.recentYear')); break;
    case 'date': if (show) parts.push(`${m.year}-${String(m.month).padStart(2, '0')}-${String(m.day).padStart(2, '0')}`); if (m.separator) parts.push(t('pw.withSep')); break;
    case 'bruteforce': parts.push(t('pw.pool', { n: m.cardinality })); break;
  }
  return parts.join(' · ');
}

function checkResult(r, show) {
  if (!r.length) return h('p', { class: 'ap-empty ct-chk-empty' }, t('pw.empty'));
  const box = h('div', { class: 'ct-chk' });
  const cs = r.charset;
  box.append(strengthMeter(r.entropy, r.quality),
    h('dl', { class: 'ap-kv ct-kv' },
      h('dt', {}, t('pw.length')), h('dd', {}, t('pw.chars', { n: r.length })),
      h('dt', {}, t('pw.guesses')), h('dd', {}, guessesEl(r)),
      h('dt', {}, t('pw.charsetL')), h('dd', {}, t('pw.charsetV', { bits: fmtNum(cs.bits, 2), pool: cs.pool, len: cs.length })),
      h('dt', {}, t('pw.score')), h('dd', {}, t('pw.scoreV', { n: r.score }))));
  const fb = r.feedback;
  if (fb.warning || fb.suggestions.length) {
    box.append(h('div', { class: 'ct-fb' },
      fb.warning ? h('div', { class: 'ct-line ct-warn' }, iconEl('warn'), t('fb.' + fb.warning)) : null,
      fb.suggestions.length ? h('ul', { class: 'ct-sugg' }, fb.suggestions.map((s) => h('li', {}, t('fb.' + s)))) : null));
  }
  // The decomposition: the password cut into its matches, coloured by pattern.
  box.append(h('h3', { class: 'ct-sub' }, t('pw.decomp')),
    h('div', { class: 'ct-decomp' }, r.sequence.map((m) => h('span', { class: 'ct-m', 'data-p': m.pattern, title: `${t('pat.' + m.pattern)} · ${t('pw.bitsShort', { bits: fmtNum(m.log2, 1) })}` },
      h('span', { class: 'ct-m-t' }, show ? m.token : mask(m.token)), h('span', { class: 'ct-m-l' }, t('pat.' + m.pattern))))));
  box.append(h('div', { class: 'ap-table-wrap ct-mtable' }, h('table', { class: 'ap-table' },
    h('thead', {}, h('tr', {}, ['pw.col.pattern', 'pw.col.part', 'pw.col.details', 'pw.col.guesses', 'pw.col.bits'].map((k) => h('th', {}, t(k))))),
    h('tbody', {}, r.sequence.map((m) => h('tr', {},
      h('td', {}, h('span', { class: 'ct-dot', 'data-p': m.pattern }), t('pat.' + m.pattern)),
      h('td', { class: 'ct-digest' }, show ? m.token : mask(m.token)),
      h('td', {}, details(m, show)),
      h('td', { class: 'ct-numcell' }, m.log2 < 30 ? fmtNum(Math.round(m.guesses)) : h('span', {}, '10', h('sup', {}, fmtNum(m.log2 / Math.log2(10), 1)))),
      h('td', { class: 'ct-numcell' }, fmtNum(m.log2, 2))))))));
  box.append(h('h3', { class: 'ct-sub' }, t('pw.crack')),
    h('dl', { class: 'ap-kv ct-times' }, Object.keys(SCENARIOS).flatMap((k) => [h('dt', {}, t('scn.' + k)), h('dd', {}, crackTime(r.crackTimes[k]))])));
  return box;
}

function checkCard() {
  const results = h('div', { 'aria-live': 'polite' });
  // Short passwords are estimated on every key; long pastes (slower to analyse) once typing pauses.
  const later = debounce(() => paintCheck(), 150);
  const inp = textInput(chk.pw, (v) => { chk.pw = v; if ([...v].length > 48) later(); else { later.cancel(); paintCheck(); } }, { type: chk.show ? 'text' : 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-label': t('pw.checkInput'), placeholder: t('pw.checkPh'), class: 'ed-input ct-mono-in' });
  checkInput = inp;
  const eye = h('button', {
    type: 'button', class: 'ed-iconbtn', title: t('pw.show'), 'aria-label': t('pw.show'), 'aria-pressed': String(chk.show),
    onclick: () => { chk.show = !chk.show; inp.type = chk.show ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(chk.show)); eye.firstChild.replaceWith(iconEl(chk.show ? 'eyeOff' : 'eye')); paintCheck(); },
  }, iconEl(chk.show ? 'eyeOff' : 'eye'));
  const clear = iconBtn('close', 'pw.clear', () => { chk.pw = ''; inp.value = ''; paintCheck(); inp.focus(); });
  const user = textInput(chk.user, (v) => { chk.user = v; paintCheck(); }, { autocomplete: 'off', placeholder: t('pw.userWordsPh'), 'aria-label': t('pw.userWords') });
  paintCheck = () => {
    const r = passwordStrength(chk.pw, { userInputs: chk.user.split(/[\s,;]+/).filter(Boolean) });
    results.textContent = '';
    results.append(checkResult(r, chk.show));
  };
  paintCheck();
  const c = card('pw.check',
    h('div', { class: 'ed-fields' },
      field('pw.checkInput', h('div', { class: 'ct-pw-row' }, inp, eye, clear)),
      field('pw.userWords', user, 'pw.userWordsHint'),
      results,
      h('div', { class: 'ed-hint' }, iconEl('shield'), ' ', t('pw.private')),
      h('details', { class: 'ct-about' }, h('summary', {}, t('pw.aboutH')),
        h('p', {}, t('pw.about', { w: fmtNum(Object.values(dictionaryInfo()).reduce((a, b) => a + b, 0)) })),
        h('p', {}, t('pw.thresholds')))));
  c.classList.add('ct-pw-chk');
  return c;
}

// --- page -----------------------------------------------------------------------------------------------------

function render() {
  main.textContent = '';
  if (!out.values.length && !out.error) generate();
  main.append(h('div', { class: 'ct-pw' }, settingsCard(), resultCard(), checkCard()));
}

startShell('passwords', render);
render();
