// regexp-app/generators.js - the generator forms of the library: numbers (any digit alphabet with variant characters,
// exact ranges, signs, grouping, decimals, exponents, prefixes) and word lists. Every change rebuilds the pattern live,
// shows it highlighted with its warnings and the examples it accepts and rejects; "Use" loads it into the editor.
// 
// Pattern construction lives in regexp/numbers.js and regexp/wordlist.js (pure, tested); this file is only the form.
// Form state is a plain object persisted to localStorage on each change, so a half-built generator survives a reload.
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { button, copyText, field, seg, select, t, textInput, toggle } from '../ui/app.js';
import { ALPHABETS, DEFAULTS, NUMBER_PRESETS, alphabetOf, alphabetText, numberPattern, parseAlphabet } from '../regexp/numbers.js';
import { wordListPattern } from '../regexp/wordlist.js';
import { parseRegExp } from '../regexp/parse.js';
import { lint } from '../regexp/lint.js';
import { patternHTML } from './editor.js';

export const GENERATORS = [
  { key: 'numbers', icon: 'hash', form: numbersForm },
  { key: 'words', icon: 'list', form: wordsForm },
];

// Script names come from the browser's own localized names (Intl.DisplayNames), so they follow the UI language.
// Alphabet key -> ISO 15924 script code for Intl.DisplayNames. Persian is a language (fa), not a script, hence the special case below.
const SCRIPT_CODE = {
  arabicIndic: 'Arab', nko: 'Nkoo', devanagari: 'Deva', bengali: 'Beng', gurmukhi: 'Guru', gujarati: 'Gujr', oriya: 'Orya', tamil: 'Taml',
  telugu: 'Telu', kannada: 'Knda', malayalam: 'Mlym', thai: 'Thai', lao: 'Laoo', tibetan: 'Tibt', myanmar: 'Mymr', khmer: 'Khmr', mongolian: 'Mong',
};
function alphabetLabel(a) {
  const lang = document.documentElement.lang || 'en';
  const sample = `${a.digits[0][0]}–${a.digits[a.digits.length - 1][0]}`;
  let name = null;
  try {
    if (SCRIPT_CODE[a.key]) name = new Intl.DisplayNames([lang], { type: 'script' }).of(SCRIPT_CODE[a.key]);
    else if (a.key === 'persian') name = new Intl.DisplayNames([lang], { type: 'language' }).of('fa');
  } catch { /* old engine: fall back below */ }
  if (name) return `${name[0].toUpperCase()}${name.slice(1)} (${sample})`;
  return t('rx.alpha.' + a.key);
}

// Code-point split (Array.from, not split("")): astral digits (e.g. mathematical digit sets) are two UTF-16 units each.
const chars = (s) => [...new Set(Array.from(String(s)).filter((c) => !/\s/.test(c)))];
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

// Pattern preview, warnings, examples and the actions; result: { source, flags, valid, invalid, error?, params? }.
// The result panel is re-rendered wholesale on each change (textContent = ''): the panel has no inputs, so nothing
// loses focus. aria-live=polite announces the new pattern to screen readers without interrupting typing.
function outputBox() {
  const box = h('div', { class: 'rx-gen-out', 'aria-live': 'polite' });
  let current = null;
  const paint = (r, sampleOf) => {
    current = r;
    box.textContent = '';
    if (r.error) { box.append(h('div', { class: 'rx-gen-err', role: 'alert' }, iconEl('warn'), t('rx.gen.err.' + r.error, r.params || {}))); return; }
    // Generated patterns go through the same parser and linter as typed ones: the generator gets no exemption from the warnings.
    const parsed = parseRegExp(r.source, r.flags);
    const warns = parsed.ok ? lint(parsed).filter((w) => w.severity !== 'info') : [];
    box.append(...[
      h('div', { class: 'rx-gen-head' }, h('b', {}, t('rx.gen.result')), h('span', { class: 'rx-gen-meta' }, `/${r.flags} · ${t('rx.gen.chars', { n: r.source.length })}`),
        h('span', { class: 'rx-gen-lint ' + (warns.length ? 'rx-gen-warn' : 'rx-gen-ok') }, iconEl(warns.length ? 'warn' : 'check'), warns.length ? t('rx.gen.lintWarn', { n: warns.length }) : t('rx.gen.lintOk'))),
      h('code', { class: 'rx-lib-src rx-gen-src', html: patternHTML(r.source, r.flags) }),
      (r.notes || []).length ? h('div', { class: 'ed-hint' }, r.notes.map((n) => t('rx.gen.note.' + n)).join(' ')) : null,
      h('div', { class: 'rx-gen-ex' },
        h('div', {}, h('div', { class: 'rx-gen-exh' }, iconEl('check'), t('rx.gen.matches')), h('ul', {}, (r.valid || []).map((s) => h('li', { class: 'rx-gen-yes' }, s || '∅')))),
        h('div', {}, h('div', { class: 'rx-gen-exh' }, iconEl('close'), t('rx.gen.rejects')), h('ul', {}, (r.invalid || []).map((s) => h('li', { class: 'rx-gen-no' }, s || '∅'))))),
      h('div', { class: 'rx-gen-actions' },
        button('ap.copy', 'copy', () => copyText(r.source)),
        button('rx.gen.use', 'check', () => box.onUse && box.onUse({ source: r.source, flags: r.flags, sample: sampleOf(r) }), 'primary')),
    ].filter(Boolean));
  };
  box.paint = paint;
  box.current = () => current;
  return box;
}

// --- numbers ------------------------------------------------------------------------------------------------------

// Two update paths: update() only recomputes the pattern (text inputs keep focus), paint() rebuilds the whole form
// (needed when a choice shows or hides fields, e.g. decimal hides the range).
function numbersForm(onUse) {
  const saved = lsGet('regex-gen-numbers', null);
  let st = { ...DEFAULTS, preset: 'custom', ...(saved || {}) };
  if (!st.digits) st.digits = alphabetOf(st.alphabet);
  const out = outputBox();
  out.onUse = onUse;
  const form = h('div', { class: 'rx-gen-form' });

  const sample = (r) => (st.anchor === 'find'
    ? `${t('rx.gen.sampleFound')}: ${r.valid.join(' · ')}\n${t('rx.gen.sampleNot')}: ${r.invalid.filter(Boolean).join(' · ')}`
    : [...r.valid, ...r.invalid.filter(Boolean)].join('\n'));
  const update = () => {
    const { preset, ...opts } = st;
    lsSet('regex-gen-numbers', st);
    out.paint(numberPattern({ ...opts, digits: st.digits }), sample);
  };
  // Any manual change leaves the preset: the preset select is reset to custom so it never claims a preset that no longer applies.
  const set = (k, v, repaint = false) => { st[k] = v; st.preset = 'custom'; if (repaint) paint(); else { presetSel.set('custom'); update(); } };

  const presetSel = select([{ v: 'custom', l: 'rx.gen.custom' }, ...Object.keys(NUMBER_PRESETS).map((k) => ({ v: k, l: /int\d/.test(k) ? '=' + t('rx.preset.int', { name: k, min: NUMBER_PRESETS[k].min, max: NUMBER_PRESETS[k].max }) : 'rx.preset.' + k }))],
    st.preset, (v) => {
      if (v === 'custom') return;
      const p = NUMBER_PRESETS[v];
      st = { ...DEFAULTS, ...p, preset: v };
      st.digits = alphabetOf(st.alphabet);
      paint();
    });

  function paint() {
    form.textContent = '';
    const dec = st.kind === 'decimal';
    const ranged = !dec && (st.min !== '' || st.max !== '');
    // KNOWN DEFECT (harmless): the selected expression "a.key === st.alphabet && st.digits === null ? true : a.key === st.alphabet"
    // reduces to a.key === st.alphabet in every case. Fix: use the simple comparison.
    const alphaSel = h('select', { class: 'ed-input ed-select', 'aria-label': t('rx.gen.alphabet') },
      ['standard', 'script'].map((g) => h('optgroup', { label: t(g === 'standard' ? 'rx.gen.std' : 'rx.gen.scripts') },
        ALPHABETS.filter((a) => a.group === g).map((a) => h('option', { value: a.key, selected: a.key === st.alphabet && st.digits === null ? true : a.key === st.alphabet }, alphabetLabel(a))))),
      h('option', { value: 'custom', selected: st.alphabet === 'custom' }, t('rx.gen.custom')));
    alphaSel.addEventListener('change', () => { st.alphabet = alphaSel.value; if (alphaSel.value !== 'custom') st.digits = alphabetOf(alphaSel.value); st.preset = 'custom'; paint(); });
    const digitsIn = textInput(alphabetText(st.digits), (v) => { st.digits = parseAlphabet(v); st.alphabet = 'custom'; alphaSel.value = 'custom'; base.textContent = t('rx.gen.base', { n: st.digits.length }); presetSel.set('custom'); st.preset = 'custom'; update(); },
      { multiline: true, rows: 2, class: 'ed-input ed-textarea rx-gen-digits', 'aria-label': t('rx.gen.alphabetText') });
    const base = h('span', { class: 'rx-gen-meta' }, t('rx.gen.base', { n: st.digits.length }));
    const txt = (k, label, attrs = {}) => field(label, textInput(Array.isArray(st[k]) ? (k === 'prefix' || k === 'suffix' ? st[k].join(', ') : st[k].join('')) : String(st[k] ?? ''),
      (v) => set(k, k === 'prefix' || k === 'suffix' ? list(v) : attrs.number ? Math.max(0, Math.floor(+v || 0)) : attrs.raw ? v.trim() : chars(v)), { autocomplete: 'off', ...(attrs.number ? { type: 'number', min: 0, inputmode: 'numeric' } : {}) }));
    const segOf = (k, values, label, repaint = true) => field(label, seg(values.map((v) => ({ v, l: `rx.gen.${k}.${v}` })), st[k], (v) => set(k, v, repaint), label));
    const rangeChips = h('div', { class: 'ed-chips rx-gen-chips' }, ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'uint64', 'int64'].map((k) => h('button', {
      type: 'button', class: 'ed-chip' + (st.min === NUMBER_PRESETS[k].min && st.max === NUMBER_PRESETS[k].max ? ' ed-on' : ''),
      onclick: () => { st.min = NUMBER_PRESETS[k].min; st.max = NUMBER_PRESETS[k].max; st.kind = 'integer'; st.preset = 'custom'; paint(); },
    }, k)));
    form.append(
      field('rx.gen.preset', presetSel),
      h('div', { class: 'ed-field' }, h('div', { class: 'rx-gen-row' }, h('label', { class: 'ed-label' }, t('rx.gen.alphabet')), base), alphaSel, digitsIn, h('div', { class: 'ed-hint' }, t('rx.gen.alphabetHint'))),
      h('div', { class: 'rx-gen-grid' },
        segOf('kind', ['integer', 'decimal'], 'rx.gen.kind'),
        field('rx.gen.sign', select(['none', 'minus', 'both', 'required'].map((v) => ({ v, l: 'rx.gen.sign.' + v })), st.sign, (v) => set('sign', v))),
        txt('minus', 'rx.gen.minus'), txt('plus', 'rx.gen.plus')),
      dec ? null : h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('rx.gen.range')),
        h('div', { class: 'rx-gen-grid' },
          field('rx.gen.min', textInput(st.min, (v) => set('min', v.trim()), { inputmode: 'numeric', autocomplete: 'off', placeholder: '−∞' })),
          field('rx.gen.max', textInput(st.max, (v) => set('max', v.trim()), { inputmode: 'numeric', autocomplete: 'off', placeholder: '+∞' }))),
        rangeChips, h('div', { class: 'ed-hint' }, t('rx.gen.rangeHint'))),
      h('div', { class: 'rx-gen-grid' },
        segOf('leadingZeros', ['no', 'yes', 'pad'], 'rx.gen.zeros'),
        st.leadingZeros === 'pad' ? txt('width', 'rx.gen.width', { number: true }) : ranged ? null : txt('maxDigits', 'rx.gen.maxDigits', { number: true })),
      h('div', { class: 'rx-gen-grid' },
        segOf('grouping', ['none', 'optional', 'required'], 'rx.gen.grouping'),
        st.grouping === 'none' ? null : field('rx.gen.groupStyle', select(['western', 'indian', 'myriad'].map((v) => ({ v, l: 'rx.gen.style.' + v })), st.groupStyle, (v) => set('groupStyle', v))),
        st.grouping === 'none' ? null : txt('groupSep', 'rx.gen.groupSep')),
      h('div', { class: 'rx-gen-grid' },
        txt('decimalSep', dec ? 'rx.gen.decimalSep' : 'rx.gen.decimalSepInt'),
        dec ? txt('fracMax', 'rx.gen.fracMax', { number: true }) : null,
        dec ? field('rx.gen.leadingDot', toggle(st.leadingDot, (v) => set('leadingDot', v))) : null,
        dec ? field('rx.gen.trailingDot', toggle(st.trailingDot, (v) => set('trailingDot', v))) : null),
      h('div', { class: 'rx-gen-grid' },
        segOf('exponent', ['none', 'optional', 'required'], 'rx.gen.exponent'),
        st.exponent === 'none' ? null : txt('expMarker', 'rx.gen.expMarker')),
      h('div', { class: 'rx-gen-grid' },
        field('rx.gen.prefix', h('div', { class: 'rx-gen-affix' }, textInput(st.prefix.join(', '), (v) => set('prefix', list(v)), { autocomplete: 'off', placeholder: '0x, 0X' }),
          seg(['none', 'optional', 'required'].map((v) => ({ v, l: 'rx.gen.mode.' + v })), st.prefixMode, (v) => set('prefixMode', v), 'rx.gen.prefix'))),
        field('rx.gen.suffix', h('div', { class: 'rx-gen-affix' }, textInput(st.suffix.join(', '), (v) => set('suffix', list(v)), { autocomplete: 'off', placeholder: 'n, %' }),
          seg(['none', 'optional', 'required'].map((v) => ({ v, l: 'rx.gen.mode.' + v })), st.suffixMode, (v) => set('suffixMode', v), 'rx.gen.suffix')))),
      h('div', { class: 'rx-gen-grid' },
        segOf('anchor', ['line', 'string', 'find'], 'rx.gen.anchor', false),
        field('rx.gen.groups', toggle(st.groups, (v) => set('groups', v)))));
    presetSel.set(st.preset);
    update();
  }
  paint();
  return h('div', { class: 'rx-gen' }, form, out);
}

// --- word lists -----------------------------------------------------------------------------------------------------

// Examples are synthesised: each word plus near misses (plural, truncated) that are not in the list, so the preview
// shows both accepted and rejected strings without user input.
function wordsForm(onUse) {
  const st = { words: 'cat\ncar\ncart\ncarton\ndog', caseless: false, whole: 'word', name: 'word', ...(lsGet('regex-gen-words', null) || {}) };
  const out = outputBox();
  out.onUse = onUse;
  const sample = () => {
    const ws = st.words.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
    const near = ws.flatMap((w) => [w + 's', w.slice(0, -1)]).filter((w) => w && !ws.includes(w));
    return st.whole === 'line' ? [...ws, ...near.slice(0, ws.length)].join('\n') : `${ws.join(', ')}.\n${near.slice(0, ws.length).join(', ')}.`;
  };
  const update = () => {
    lsSet('regex-gen-words', st);
    const ws = st.words.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
    if (!ws.length) { out.paint({ error: 'noWords' }, sample); return; }
    // Group name must be a valid JS identifier (ID_Start/ID_Continue, as the spec requires for (?<name>)); checked here so the error is specific instead of a generic parse failure.
    if (st.name && !/^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u.test(st.name)) { out.paint({ error: 'groupName' }, sample); return; }
    const r = wordListPattern(ws, { caseless: st.caseless, whole: st.whole, name: st.name });
    // Test regex anchored to the whole example: g/m flags removed, because test() with g is stateful (lastIndex) and would alternate results.
    const re = new RegExp(st.whole === 'line' ? r.source : `^(?:${r.source})$`, r.flags.replace(/[gm]/g, ''));
    const lines = sample().split(/\n|, |\.$/).map((s) => s.replace(/\.$/, '')).filter(Boolean);
    out.paint({ ...r, valid: lines.filter((s) => re.test(s)), invalid: lines.filter((s) => !re.test(s)) }, sample);
  };
  const form = h('div', { class: 'rx-gen-form' },
    field('rx.gen.wordsInput', textInput(st.words, (v) => { st.words = v; update(); }, { multiline: true, rows: 8, class: 'ed-input ed-textarea rx-gen-words', autocomplete: 'off' })),
    h('div', { class: 'rx-gen-grid' },
      field('rx.gen.whole', seg(['word', 'line', 'none'].map((v) => ({ v, l: 'rx.gen.whole.' + v })), st.whole, (v) => { st.whole = v; update(); }, 'rx.gen.whole')),
      field('rx.gen.caseless', toggle(st.caseless, (v) => { st.caseless = v; update(); })),
      field('rx.gen.groupName', textInput(st.name, (v) => { st.name = v.trim(); update(); }, { autocomplete: 'off', spellcheck: 'false' }))));
  update();
  return h('div', { class: 'rx-gen' }, form, out);
}
