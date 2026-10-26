// regexp-app/main.js - Regex Studio: a regular expression workbench. Pattern editor with live syntax colours, flags,
// warnings, test text with match and group marks, and the views (matches, replace, split, explain, diagram, code,
// cheat sheet). Parsing, explanations, diagrams, warnings and code generation live in ../regexp/.
// 
// Key decisions:
// - Matching runs in a Worker with a time limit (../regexp/run.js). A catastrophic-backtracking pattern on the main
//   thread would freeze the tab with no way to cancel; a worker can be terminated. Parsing and linting stay on the main
//   thread: they are linear in the pattern length and give instant feedback.
// - Latest request wins: every run gets a sequence number (evalSeq); results of older runs are discarded on arrival.
// - Two render granularities: renderAll() rebuilds the DOM (startup, language change); paint*() functions update one
//   region. Editors are created once at module level and re-attached, so a language switch keeps caret and undo.
// - Persistence is debounced (saveSoon 300 ms, history 2 s): localStorage writes are synchronous and serialise the
//   whole state; per keystroke they would stall typing on large texts.
import './strings.js';
import './strings-library.js';
import { $, debounce, h } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { button, copyText, download, startApp, t, toast } from '../ui/app.js';
import { promptDialog } from '../ui/overlays.js';
import { parseRegExp, splitLiteral, FLAGS } from '../regexp/parse.js';
import { lint } from '../regexp/lint.js';
import { createRunner } from '../regexp/run.js';
import { S, TABS, assign, load, readShare, remember, save, saveCurrent, shareCode } from './state.js';
import { createEditor, groupClass, patternHTML, shiftMatches, textHTML } from './editor.js';
import { VIEWS, VIEW_ICONS } from './panels.js';
import { openLibrary, openSaved } from './library.js';
import { errorText, flagName, lintText } from './describe.js';

addIcons({
  book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20M8 7h8M8 10.5h6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  tree: 'M4 4h6v4H4zM14 10h6v4h-6zM14 17h6v4h-6zM7 8v11h7M7 12h7',
  rail: 'M2 12h2M20 12h2M4 9h6v6H4zM14 9h6v6h-6zM10 12h4M4 12c0 5 2 7 4 7h8c2 0 4-2 4-7',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  zap2: 'M13 2 3 14h9l-1 8 10-12h-9z',
});

const LOGO = 'M14 3v9M10 5.5l8 4M18 5.5l-8 4M6 16.5a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 1 0 0-4.4z';
// One second: long enough for heavy legitimate patterns on 200 KB of text, short enough that a runaway pattern feels like an error, not a hang.
const TIME_LIMIT = 1000;
const runner = createRunner({ timeout: TIME_LIMIT });
const UI = {};
let view = null, focusIdx = -1, lintOpen = false, evalSeq = 0, spinTimer = 0;

// ---------------------------------------------------------------------------------------------------------
// Editors (long-lived: re-attached on language changes)

const patEd = createEditor({
  kind: 'pattern', label: '', placeholder: '',
  onInput: (v) => { S.source = v; patternChanged(); },
  onCaret: (a) => { if (S.caret !== a) { S.caret = a; caretMoved(); } },
  // A regex is one line: Enter would insert a newline the user did not mean (and the textarea would grow).
  onKey: (e) => { if (e.key === 'Enter') e.preventDefault(); },
});
// Pasting a whole literal like /abc/gi over the entire field splits it into source and flags. Only when the selection
// covers everything: pasting into the middle of a pattern must stay literal text.
patEd.ta.addEventListener('paste', (e) => {
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  const lit = text && patEd.ta.selectionStart === 0 && patEd.ta.selectionEnd === patEd.ta.value.length ? splitLiteral(text) : null;
  if (!lit || !/^[dgimsuvy]*$/.test(lit.flags)) return;
  e.preventDefault();
  S.source = lit.source;
  S.flags = [...FLAGS].filter((c) => lit.flags.includes(c)).join('');
  patEd.value = S.source;
  patternChanged();
  toast(t('rx.literalSplit'), 'ok');
});

const textEd = createEditor({
  kind: 'text', label: '', placeholder: '',
  onInput: (v) => {
    const before = S.text;
    S.text = v;
    // Shift old marks across the edit before repainting (see shiftMatches) so marks do not flicker while the worker runs.
    if (S.result && S.result.matches) S.result = { ...S.result, matches: shiftMatches(before, v, S.result.matches) };
    paintText();
    // Large texts are debounced (120 ms): each run copies the whole text to the worker; small texts run on every keystroke for immediacy.
    if (v.length > 50000) scheduleSlow(); else schedule();
    saveSoon();
  },
  onCaret: (a) => paintInfo(a),
});

// Match details under the pointer.
const tip = h('div', { class: 'rx-tip', role: 'tooltip', hidden: true });
let tipRaf = 0;
// Hover lookup through the textarea: it covers the mirror, so events never reach the spans. elementsFromPoint returns
// the whole stack under the pointer, including the mirror spans below. One lookup per frame (rAF).
textEd.ta.addEventListener('mousemove', (e) => {
  cancelAnimationFrame(tipRaf);
  tipRaf = requestAnimationFrame(() => {
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.dataset && x.dataset.m != null && textEd.mirror.contains(x));
    if (!el) { hideTip(); return; }
    showTip(+el.dataset.m, e.clientX, e.clientY);
  });
});
textEd.ta.addEventListener('mouseleave', () => { cancelAnimationFrame(tipRaf); hideTip(); });

function matchDetails(m, k) {
  return [
    h('div', { class: 'rx-tip-h' }, h('b', {}, t('rx.matchN', { n: k + 1 })), h('span', { class: 'rx-tip-r' }, m.index + '–' + m.end)),
    h('div', { class: 'rx-tip-m' }, m.text === '' ? h('i', {}, t('rx.emptyMatch')) : m.text.length > 120 ? m.text.slice(0, 120) + '…' : m.text),
    m.groups.length ? h('dl', { class: 'rx-tip-g' }, m.groups.slice(0, 12).map((g) => [
      h('dt', {}, h('span', { class: 'rx-gchip ' + groupClass(g.n) }, g.name || '$' + g.n)),
      h('dd', {}, g.text == null ? h('i', { class: 'rx-unset' }, t('rx.info.unset')) : g.text === '' ? h('i', { class: 'rx-unset' }, t('rx.emptyText')) : g.text.length > 80 ? g.text.slice(0, 80) + '…' : g.text),
    ])) : null,
  ];
}

// Content rebuilt only when the match under the pointer changes (dataset.k); position is clamped to the viewport and flips above the pointer near the bottom edge.
function showTip(k, x, y) {
  const m = S.result && S.result.matches[k];
  if (!m) { hideTip(); return; }
  if (tip.dataset.k !== String(k)) {
    tip.dataset.k = String(k);
    tip.textContent = '';
    tip.append(...matchDetails(m, k).filter(Boolean));
  }
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.round(Math.min(x + 14, innerWidth - r.width - 8)) + 'px';
  tip.style.top = Math.round(y + 18 + r.height > innerHeight - 8 ? y - r.height - 12 : y + 18) + 'px';
  setFocus(k, false);
}
function hideTip() { tip.hidden = true; tip.dataset.k = ''; if (focusIdx >= 0) setFocus(-1, false); }

// ---------------------------------------------------------------------------------------------------------
// Changes

const saveSoon = debounce(save, 300);
const rememberSoon = debounce(() => remember(), 2000);
// scheduleSlow is cancelled by schedule() itself, so a pending slow run never fires after a newer immediate one.
const scheduleSlow = debounce(() => schedule(), 120);

// Order matters: parse and lint first (everything else reads S.parsed / S.warnings), then repaint, then start the run.
function patternChanged() {
  S.parsed = parseRegExp(S.source, S.flags);
  S.warnings = lint(S.parsed);
  S.hot = null;
  paintPattern();
  paintMessage();
  paintLint();
  paintFlags();
  if (view) view.update();
  schedule();
  saveSoon();
  if (S.parsed.ok && S.source) rememberSoon();
}

// The caret of the pattern drives the Explain / Diagram highlight only while the pattern field has focus.
const caretPos = () => (document.activeElement === patEd.ta ? S.caret : -1);
function caretMoved() {
  paintPattern();
  if (view && view.caret) view.caret(caretPos());
}
patEd.ta.addEventListener('blur', () => { paintPattern(); if (view && view.caret) view.caret(-1); });

// names[0] = null keeps group numbers as array indices. limit/budget cap the number of matches and the work per run
// (enforced by regexp/run.js) so a pattern matching every character cannot build millions of DOM nodes.
function job() {
  const names = [null];
  for (const g of S.parsed.groups) names[g.index] = g.name;
  return {
    source: S.source, flags: S.flags, text: S.text, names, limit: 5000, budget: 800,
    mode: S.tab === 'replace' ? 'replace' : S.tab === 'split' ? 'split' : 'match',
    replacement: S.replacement, splitLimit: S.splitLimit === '' ? undefined : +S.splitLimit,
  };
}

// Runs the pattern in the worker; the latest request wins.
// The spinner is delayed 150 ms: fast runs (the usual case) finish before it shows, so the status pill does not blink.
function schedule() {
  scheduleSlow.cancel();
  const seq = ++evalSeq;
  if (!S.parsed || !S.parsed.ok) { S.result = null; S.status = 'invalid'; paintResults(); return; }
  S.status = 'running';
  clearTimeout(spinTimer);
  spinTimer = setTimeout(() => { if (seq === evalSeq && S.status === 'running') paintStats(); }, 150);
  runner.run(job()).then((r) => {
    if (seq !== evalSeq || r.cancelled) return;
    clearTimeout(spinTimer);
    if (r.timeout) { S.status = 'timeout'; S.result = null; }
    else if (r.error) { S.status = 'error'; S.result = r; }
    else { S.status = 'ok'; S.result = r; }
    paintResults();
  });
}

// ---------------------------------------------------------------------------------------------------------
// Painting

function paintPattern() {
  patEd.paint(patternHTML(S.source, S.flags, {
    error: S.parsed && !S.parsed.ok && S.parsed.error.part === 'pattern' ? S.parsed.error : null,
    hot: S.hot, caret: document.activeElement === patEd.ta ? S.caret : -1, warnings: S.warnings,
  }));
  if (UI.flagTxt) UI.flagTxt.textContent = S.flags;
}

function paintMessage() {
  const box = UI.msg;
  if (!box) return;
  box.textContent = '';
  const p = S.parsed;
  box.className = 'rx-msg' + (p && !p.ok ? ' rx-msg-err' : '');
  if (!p) return;
  if (!p.ok) {
    const e = p.error;
    box.append(iconEl('warn'), h('span', {}, h('b', {}, errorText(e)), ' ',
      h('span', { class: 'rx-pos' }, e.part === 'flags' ? t('rx.inFlags') : t('rx.atPos', { a: e.start, b: e.end }))));
    if (e.part === 'pattern') {
      box.append(h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => patEd.select(e.start, e.end) }, t('rx.showError')));
    }
    return;
  }
  const bits = [t('rx.valid')];
  bits.push(t('rx.groups', { n: p.groupCount }));
  if (p.names.length) bits.push(p.names.join(', '));
  if (!S.source) bits.push(t('rx.emptyPattern'));
  box.append(iconEl('check'), h('span', {}, bits.join(' · ')));
}

const SEV_ICON = { danger: 'zap2', warn: 'warn', info: 'info' };
// At most three warnings by default; the rest behind a "more" toggle. Hovering a warning highlights its range in the pattern.
function paintLint() {
  const box = UI.lint;
  if (!box) return;
  box.textContent = '';
  const ws = S.warnings;
  box.hidden = !ws.length;
  if (!ws.length) return;
  const shown = lintOpen ? ws : ws.slice(0, 3);
  box.append(h('ul', { class: 'rx-lint-list', 'aria-label': t('rx.lint.title') }, shown.map((w) => h('li', {}, h('button', {
    type: 'button', class: 'rx-lint-item rx-sev-' + w.severity,
    onclick: () => { if (w.end > w.start) patEd.select(w.start, w.end); else patEd.ta.focus(); },
    onmouseenter: () => setHot(w.end > w.start ? w : null), onmouseleave: () => setHot(null),
  },
  iconEl(SEV_ICON[w.severity]),
  h('span', { class: 'rx-sev' }, t('rx.sev.' + w.severity)),
  h('span', { class: 'rx-lint-txt' }, lintText(w)),
  w.end > w.start ? h('code', { class: 'rx-lint-src', html: patternHTML(S.source.slice(w.start, w.end).slice(0, 40), S.flags) }) : null)))));
  if (ws.length > 3) {
    box.append(h('button', { type: 'button', class: 'rx-more', 'aria-expanded': String(lintOpen), onclick: () => { lintOpen = !lintOpen; paintLint(); } },
      lintOpen ? t('rx.lint.less') : t('rx.lint.more', { n: ws.length - 3 })));
  }
}

function paintFlags() {
  for (const b of UI.flagBtns || []) {
    const on = S.flags.includes(b.dataset.f);
    b.classList.toggle('ed-on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  if (UI.flagTxt) UI.flagTxt.textContent = S.flags;
}

function paintText() {
  const matches = S.status === 'timeout' || !S.parsed || !S.parsed.ok ? null : S.result && S.result.matches;
  textEd.paint(textHTML(S.text, matches, focusIdx));
}

function paintStats() {
  const box = UI.stat;
  if (!box) return;
  box.textContent = '';
  box.className = 'rx-stat';
  // Results of the previous run fade while a slow run is pending.
  for (const el of [UI.views, textEd.mirror]) if (el) el.classList.toggle('rx-busy', S.status === 'running');
  const r = S.result;
  if (S.status === 'running') { box.append(h('span', { class: 'rx-spin' }), t('rx.running')); return; }
  if (S.status === 'invalid') { box.classList.add('rx-stat-bad'); box.append(iconEl('warn'), t('rx.patternInvalid')); return; }
  if (S.status === 'timeout') { box.classList.add('rx-stat-bad'); box.append(iconEl('clock'), t('rx.timeoutShort')); return; }
  if (S.status === 'error') { box.classList.add('rx-stat-bad'); box.append(iconEl('warn'), t('rx.runError')); return; }
  if (!r) return;
  box.classList.add(r.count ? 'rx-stat-ok' : 'rx-stat-none');
  box.append(h('b', {}, r.count ? t('rx.matchCount', { n: r.count }) : t('rx.noMatches')),
    h('span', { class: 'rx-time', title: t('rx.msHint') }, r.ms < 1 ? '<1 ms' : Math.round(r.ms) + ' ms'));
  if (r.truncated) box.append(h('span', { class: 'ed-badge', title: t('rx.truncated.' + r.truncated, { n: r.matches.length }) }, t('rx.truncatedShort')));
}

function paintBanner() {
  const b = UI.banner;
  if (!b) return;
  b.hidden = S.status !== 'timeout';
  if (b.hidden) return;
  b.textContent = '';
  const risky = S.warnings.some((w) => w.severity === 'danger');
  b.append(iconEl('clock'), h('div', {}, h('b', {}, t('rx.timeout', { s: TIME_LIMIT / 1000 })), h('p', {}, t(risky ? 'rx.timeoutRisk' : 'rx.timeoutHint'))));
}

function paintInfo(pos) {
  const box = UI.info;
  if (!box) return;
  box.textContent = '';
  const ms = S.result && S.status === 'ok' ? S.result.matches : null;
  const k = ms ? ms.findIndex((m) => (m.index <= pos && pos < m.end) || (m.index === m.end && m.index === pos)) : -1;
  if (k < 0) { box.append(h('span', { class: 'ed-hint' }, t(ms && ms.length ? 'rx.infoHint' : 'rx.infoNone'))); return; }
  const m = ms[k];
  box.append(h('b', {}, t('rx.matchN', { n: k + 1 })), h('span', { class: 'rx-info-r' }, m.index + '–' + m.end),
    ...m.groups.slice(0, 8).map((g) => h('span', { class: 'rx-info-g' }, h('span', { class: 'rx-gchip ' + groupClass(g.n) }, g.name || '$' + g.n), ' ',
      g.text == null ? h('i', { class: 'rx-unset' }, t('rx.info.unset')) : g.text.length > 40 ? g.text.slice(0, 40) + '…' : g.text || '∅')));
}

function paintResults() {
  paintText();
  paintStats();
  paintBanner();
  paintInfo(textEd.ta.selectionStart || 0);
  if (view && ['matches', 'replace', 'split'].includes(S.tab)) view.update();
}

function setHot(range) {
  S.hot = range ? { start: range.start, end: range.end } : null;
  paintPattern();
}

// Marks one match (pointer, table row): only the classes of its pieces change, the mirror is not rebuilt.
// Class toggles on existing nodes instead of a mirror rebuild: hover over a table row must stay cheap on 5000 matches.
function setFocus(k, scroll) {
  if (focusIdx !== k) {
    for (const el of textEd.mirror.querySelectorAll('.rx-focus')) el.classList.remove('rx-focus');
    if (k >= 0) for (const el of textEd.mirror.querySelectorAll('[data-m="' + k + '"]')) el.classList.add('rx-focus');
    focusIdx = k;
    if (view && view.focus) view.focus(k);
  }
  if (scroll && k >= 0) {
    const el = textEd.mirror.querySelector(`[data-m="${k}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Actions

// Facade passed to the views (panels.js): they call back through it instead of importing main.js, which would be a
// circular import and would expose every internal.
const app = {
  changed(kind) {
    if (kind === 'replacement' || kind === 'split') schedule();
    saveSoon();
  },
  hot: setHot,
  selectPattern(a, b) { patEd.select(a, b); },
  selectMatch(k) {
    const m = S.result && S.result.matches[k];
    if (!m) return;
    textEd.select(m.index, m.end);
    setFocus(k, true);
  },
  focusMatch(k, scroll) { setFocus(k, scroll); },
  focusIndex: () => focusIdx,
  caretPos: () => caretPos(),
  // setRangeText keeps the native undo stack in most browsers, unlike assigning value; caret is the offset inside the inserted text.
  insert(text, caret) {
    const ta = patEd.ta;
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.focus();
    ta.setRangeText(text, a, b, 'end');
    ta.setSelectionRange(a + caret, a + caret);
    S.source = ta.value;
    patEd.grow();
    patternChanged();
  },
  insertReplacement(tok) {
    if (S.tab !== 'replace') setTab('replace');
    const inp = UI.replInput;
    if (!inp) return;
    const a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a;
    inp.setRangeText(tok, a, b, 'end');
    inp.focus();
    S.replacement = inp.value;
    schedule();
    saveSoon();
  },
  registerReplaceInput(inp) { UI.replInput = inp; },
  useText(text) {
    S.text = text;
    textEd.value = text;
    schedule();
    saveSoon();
    toast(t('rx.textReplaced'), 'ok');
  },
  copy(text, msg) { copyText(text, msg); },
  download(data, name, type) { download(data, name, type); },
  toast,
};

// u and v are mutually exclusive (new RegExp throws with both): enabling one removes the other. Flags are re-ordered canonically by FLAGS.
function toggleFlag(c) {
  let f = S.flags.includes(c) ? S.flags.replace(c, '') : S.flags + c;
  if (c === 'u' && f.includes('u')) f = f.replace('v', '');
  if (c === 'v' && f.includes('v')) f = f.replace('u', '');
  S.flags = [...FLAGS].filter((x) => f.includes(x)).join('');
  patternChanged();
}

function load_(entry, msgKey) {
  assign(entry);
  patEd.value = S.source;
  textEd.value = S.text;
  focusIdx = -1;
  S.result = null;
  lintOpen = false;
  patternChanged();
  buildView();
  if (msgKey) toast(msgKey, 'ok');
}

function pickLibrary(p) {
  load_({ source: p.source, flags: p.flags, text: p.sample, replacement: p.replacement ?? '', tab: p.tab || (S.tab === 'replace' || S.tab === 'split' ? 'matches' : S.tab) },
    t('rx.lib.loaded', { name: p.label || t('rx.pat.' + p.key) }));
}

// The share code goes into the URL fragment: fragments are never sent to the server, so the pattern and text stay local
// until the user pastes the link somewhere. replaceState instead of location.hash: no history entry, no hashchange.
function share() {
  const s = shareCode();
  const url = location.href.split('#')[0] + '#' + s.code;
  try { history.replaceState(null, '', '#' + s.code); } catch { /* sandboxed */ }
  copyText(url, t('rx.shareCopied'));
  if (s.shortened) toast(t('rx.shareShort', { n: s.limit }), 'info');
}

async function saveDialog() {
  const name = await promptDialog(t('rx.sv.saveTitle'), t('rx.sv.name'), S.source.length > 32 ? S.source.slice(0, 32) + '…' : S.source || t('rx.sv.untitled'));
  if (!name) return;
  saveCurrent(name);
  toast(t('rx.sv.savedToast', { name }), 'ok');
}

// ---------------------------------------------------------------------------------------------------------
// Layout

// Matches / replace / split need different worker modes; a re-run happens only when the mode actually changes.
function setTab(v) {
  if (!TABS.includes(v)) return;
  const modeBefore = job0();
  S.tab = v;
  buildView();
  UI.tabBtns.find((b) => b.dataset.v === v)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (modeBefore !== job0() && S.parsed && S.parsed.ok) schedule();
  saveSoon();
}
const job0 = () => (S.tab === 'replace' ? 'replace' : S.tab === 'split' ? 'split' : 'match');

// Roving tabindex on the tabs (WAI-ARIA tabs pattern): only the selected tab is in the Tab order, arrows move between tabs.
function buildView() {
  const pane = UI.pane;
  if (!pane) return;
  for (const b of UI.tabBtns) {
    const on = b.dataset.v === S.tab;
    b.classList.toggle('ed-on', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  pane.textContent = '';
  pane.setAttribute('aria-labelledby', 'rx-tab-' + S.tab);
  UI.replInput = null;
  view = VIEWS[S.tab].build(pane, app);
  view.update();
}

function headButton(label, ic, onClick, extra = '') {
  const b = button('', ic, onClick, extra);
  b.append(h('span', { class: 'rx-btn-l' }, t(label)));
  b.title = t(label);
  b.classList.add('rx-hbtn');
  return b;
}

// Full rebuild: called at start and on every language change. Editors keep their state because the same elements are re-appended.
function renderAll() {
  const main = $('#main');
  main.textContent = '';
  main.classList.add('rx-main');
  patEd.setLabels(t('rx.patternAria'), t('rx.patternPh'));
  textEd.setLabels(t('rx.testAria'), t('rx.testPh'));

  // Pattern card
  UI.flagTxt = h('span', { class: 'rx-flagtxt', 'aria-hidden': 'true' }, S.flags);
  UI.flagBtns = [...FLAGS].map((c) => h('button', {
    type: 'button', class: 'rx-flag', dataset: { f: c }, 'aria-pressed': 'false', title: t('rx.flagHint.' + c), onclick: () => toggleFlag(c),
  }, h('b', {}, c), h('span', { class: 'rx-flag-n' }, flagName(c))));
  UI.msg = h('div', { class: 'rx-msg', role: 'status' });
  UI.lint = h('div', { class: 'rx-lint' });
  const top = h('section', { class: 'ap-card rx-top', 'aria-labelledby': 'rx-pat-h' },
    h('div', { class: 'rx-bar' },
      h('h2', { class: 'ap-card-h rx-h', id: 'rx-pat-h' }, t('rx.pattern')),
      h('span', { class: 'ed-spacer' }),
      headButton('rx.library', 'book', () => openLibrary(pickLibrary)),
      headButton('rx.saved', 'clock', () => openSaved((e) => load_(e, t('rx.sv.opened', { name: e.name || e.source.slice(0, 24) })))),
      headButton('rx.save', 'star', saveDialog),
      headButton('rx.share', 'link', share, 'primary')),
    h('div', { class: 'rx-pat-row' }, h('span', { class: 'rx-slash', 'aria-hidden': 'true' }, '/'), patEd.el, h('span', { class: 'rx-slash', 'aria-hidden': 'true' }, '/'), UI.flagTxt),
    h('div', { class: 'rx-flags', role: 'group', 'aria-label': t('rx.flags') }, UI.flagBtns),
    UI.msg, UI.lint);

  // Test text card
  UI.stat = h('div', { class: 'rx-stat', role: 'status', 'aria-live': 'polite' });
  UI.banner = h('div', { class: 'rx-banner', role: 'alert', hidden: true });
  UI.info = h('div', { class: 'rx-info' });
  const clearB = button('', 'trash', () => { app.useText(''); textEd.ta.focus(); });
  clearB.classList.add('ed-sm');
  clearB.title = t('rx.clearText');
  clearB.setAttribute('aria-label', t('rx.clearText'));
  const test = h('section', { class: 'ap-card rx-test', 'aria-labelledby': 'rx-test-h' },
    h('div', { class: 'rx-bar' }, h('h2', { class: 'ap-card-h rx-h', id: 'rx-test-h' }, t('rx.test')), UI.stat, h('span', { class: 'ed-spacer' }), clearB),
    UI.banner,
    h('div', { class: 'rx-test-scroll' }, textEd.el),
    UI.info);

  // Views
  UI.tabBtns = TABS.map((v) => h('button', {
    type: 'button', role: 'tab', id: 'rx-tab-' + v, class: 'rx-tab' + (S.tab === v ? ' ed-on' : ''), 'aria-selected': String(S.tab === v),
    'aria-controls': 'rx-pane', tabindex: S.tab === v ? '0' : '-1', dataset: { v }, onclick: () => setTab(v),
  }, iconEl(VIEW_ICONS[v]), h('span', {}, t('rx.tab.' + v))));
  const tabs = h('div', { class: 'rx-tabs', role: 'tablist', 'aria-label': t('rx.tabs') }, UI.tabBtns);
  UI.tabs = tabs;
  // 2px tolerance: sub-pixel scroll positions on zoomed or high-DPI screens never reach the exact end.
  const edges = () => {
    tabs.classList.toggle('rx-more-l', tabs.scrollLeft > 2);
    tabs.classList.toggle('rx-more-r', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
  };
  tabs.addEventListener('scroll', edges, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(edges).observe(tabs);
  // Arrow keys wrap around; Home/End jump. Automatic activation (selection follows focus) is fine here: building a view is cheap.
  tabs.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(S.tab);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    setTab(TABS[j]);
    UI.tabBtns[j].focus();
  });
  UI.pane = h('div', { class: 'rx-pane', id: 'rx-pane', role: 'tabpanel', tabindex: '-1' });
  const views = h('section', { class: 'ap-card rx-views', 'aria-label': t('rx.tabs') }, tabs, UI.pane);
  UI.views = views;

  main.append(top, h('div', { class: 'rx-work' }, test, views));
  if (!tip.isConnected) document.body.append(tip);
  patEd.grow();
  textEd.grow();
  paintPattern();
  paintMessage();
  paintLint();
  paintFlags();
  buildView();
  paintResults();
}

// ---------------------------------------------------------------------------------------------------------
// Start

// A share link beats the stored state, but does not overwrite storage until the user edits (save is only called from changes).
const fromLink = readShare(location.hash);
if (fromLink) assign(fromLink); else load();
patEd.value = S.source;
textEd.value = S.text;
S.parsed = parseRegExp(S.source, S.flags);
S.warnings = lint(S.parsed);
startApp({ key: 'regex', name: 'rx.name', logo: LOGO, offline: true, onLang: () => renderAll() });
renderAll();
schedule();
if (fromLink) toast(t('rx.fromLink'), 'ok');
// Pasting another share link into the address bar of an open tab loads it without a reload.
window.addEventListener('hashchange', () => {
  const s = readShare(location.hash);
  if (s && (s.source !== S.source || s.flags !== S.flags || s.text !== S.text)) load_(s, t('rx.fromLink'));
});
