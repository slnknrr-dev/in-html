// photo/cmdview.js - the command card: a shell command (or loop script) rendered from segments with every fragment
// tied to a step of the operation list below it. Clicking or hovering a fragment highlights its step and the other
// way round; the owner hears about it (onStep / onHover) to point at its own controls. Shell (bash / cmd.exe), line
// wrapping, a scope switch (e.g. this image / batch) and the .bat form are remembered per storage key.
//
//   const view = createCommandView({ storageKey, scopes?: [{ v, l }], onChange(), onStep(i, step), onHover(i|null) })
//   view.render({ segments, steps, notes?, missing?, title?, empty? })   steps: [{ label, fidelity, note?, argsText? }]
//   view.state -> { shell, wrap, scope, bat }       view.highlight(indexes, 'hover' | 'on')       view.el
//
// Segments come from the owner (e.g. image-processor/commands.js): [{ text, step? }].

// Design rules:
// - The owner supplies already-quoted segments; this view never quotes. Copy uses `plain`, the exact concatenation of
//   segment texts, so what is copied is byte-for-byte what is shown (colouring only wraps text in spans).
// - Selection is remembered by step id, not index: when the owner re-renders with a step inserted or removed, the
//   highlight stays on the same logical step.

// Side-effect imports: register icons and strings before the first render.
import './icons.js';
import './strings.js';
import { copyText, seg, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';

const FID_ICON = { exact: 'check', approx: 'approx', none: 'minus' };

// Light syntax colouring of one command fragment: options, quoted strings, loop words.
function colour(text) {
  const out = [];
  // Tokens: a bash single-quoted string (with the '\'' idiom for an embedded quote), a cmd.exe double-quoted string
  // (with "" for an embedded quote), whitespace, or a bare word. A lexer, not a parser: it only needs to find where
  // strings start and end so options inside quotes are not coloured as options.
  const re = /('(?:[^']|'\\'')*'|"(?:[^"]|"")*"|\s+|[^\s'"]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const w = m[0];
    let cls = null;
    if (/^\s/.test(w)) { out.push(w); continue; }
    if (/^['"]/.test(w)) cls = 'ph-c-str';
    // ImageMagick options start with '-' or '+' (+repage, +channel); a sign followed by a digit is a number or a
    // geometry offset, not an option.
    else if (/^[-+][A-Za-z]/.test(w) && !/^[-+]\d/.test(w)) cls = 'ph-c-opt';
    else if (/^(magick|for|in|do|done|mkdir|shopt|@echo)$/.test(w)) cls = 'ph-c-kw';
    else if (/^[\\^]$/.test(w)) cls = 'ph-c-cont';
    out.push(cls ? h('span', { class: cls }, w) : w);
  }
  return out;
}

export function createCommandView({ storageKey = 'cmdview', scopes = null, onChange = () => {}, onStep = () => {}, onHover = () => {} } = {}) {
  const st = {
    // Default shell guessed from navigator.platform ('Win32'); stored values are re-validated below because
    // localStorage is user-editable and may hold a value from an older version.
    shell: lsGet(storageKey + '-shell', /win/i.test((typeof navigator !== 'undefined' && navigator.platform) || '') ? 'cmd' : 'bash'),
    wrap: lsGet(storageKey + '-wrap', true),
    scope: scopes ? lsGet(storageKey + '-scope', scopes[0].v) : null,
    bat: lsGet(storageKey + '-bat', false),
  };
  if (!['bash', 'cmd'].includes(st.shell)) st.shell = 'bash';
  if (scopes && !scopes.some((s) => s.v === st.scope)) st.scope = scopes[0].v;
  const save = (k) => { lsSet(storageKey + '-' + k, st[k]); onChange(); };

  const title = h('h2', { class: 'ap-card-h ph-cmd-title' });
  const badge = h('span', { class: 'ph-cmd-im', title: 'ImageMagick 7' }, 'ImageMagick 7');
  const tools = h('div', { class: 'ph-cmd-tools' });
  const code = h('pre', { class: 'ph-cmd-code', tabindex: '0' });
  const summary = h('div', { class: 'ph-cmd-sum', 'aria-live': 'polite' });
  const list = h('ol', { class: 'ph-cmd-steps' });
  const notes = h('ul', { class: 'ph-cmd-notes' });
  const missing = h('div', { class: 'ph-cmd-missing' });
  const empty = h('p', { class: 'ed-hint ph-cmd-empty' });
  const body = h('div', { class: 'ph-cmd-body' }, code, summary, list, missing, notes);
  const el = h('section', { class: 'ap-card ph-cmd' }, h('div', { class: 'ph-cmd-head' }, title, badge, h('span', { class: 'ed-spacer' }), tools), empty, body);

  let model = null;
  let plain = '';
  let selected = -1, selectedId = null; // the selection follows its step (by id) across re-renders

  const fragments = (i) => [...code.querySelectorAll(`[data-step="${i}"]`)];
  const rows = (i) => [...list.querySelectorAll(`[data-step="${i}"]`)];
  // Two independent highlight layers ('ph-hover' transient, 'ph-on' sticky selection) so hovering never erases the
  // selection mark. Each call clears its own class everywhere, then marks fragments and rows of the given steps.
  function highlight(indexes, mode = 'hover') {
    const cls = mode === 'on' ? 'ph-on' : 'ph-hover';
    for (const n of el.querySelectorAll('.' + cls)) n.classList.remove(cls);
    for (const i of [].concat(indexes ?? [])) for (const n of [...fragments(i), ...rows(i)]) n.classList.add(cls);
  }
  // `from` suppresses scrolling the side the user just clicked on (scrolling the element under the pointer would be
  // disorienting); the other side scrolls the matching piece into view.
  function select(i, from) {
    selected = i; selectedId = model && model.steps[i] ? model.steps[i].id ?? null : null;
    highlight([i], 'on');
    const r = rows(i)[0];
    if (r && from !== 'row') r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const f = fragments(i)[0];
    if (f && from !== 'code') f.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    onStep(i, model && model.steps[i]);
  }

  function renderTools() {
    const parts = [];
    if (scopes) parts.push(seg(scopes, st.scope, (v) => { st.scope = v; save('scope'); }, 'cmd.scope'));
    parts.push(seg([{ v: 'bash', l: '=bash' }, { v: 'cmd', l: '=cmd.exe' }], st.shell, (v) => { st.shell = v; save('shell'); }, 'cmd.shell'));
    if (st.shell === 'cmd' && model && model.batch) parts.push(seg([{ v: false, l: 'cmd.window' }, { v: true, l: 'cmd.batFile' }], st.bat, (v) => { st.bat = v === true || v === 'true'; save('bat'); }, 'cmd.cmdForm'));
    const wrapBtn = h('button', { type: 'button', class: 'ed-iconbtn ph-cmd-wrap' + (st.wrap ? ' ed-on' : ''), 'aria-pressed': String(!!st.wrap), title: t('cmd.wrap'), 'aria-label': t('cmd.wrap'), onclick: () => { st.wrap = !st.wrap; save('wrap'); } }, iconEl('wrapLines'));
    const copyBtn = h('button', { type: 'button', class: 'ed-btn ed-sm ph-cmd-copy', onclick: () => copyText(plain, t('cmd.copied')) }, iconEl('copy'), t('cmd.copy'));
    parts.push(h('span', { class: 'ph-cmd-btns' }, wrapBtn, copyBtn));
    tools.replaceChildren(...parts);
  }

  function render(m) {
    model = m;
    title.textContent = m && m.title ? m.title : t('cmd.title');
    renderTools();
    const has = m && m.segments && m.segments.length;
    empty.hidden = !!has;
    body.hidden = !has;
    if (!has) { empty.textContent = (m && m.empty) || t('cmd.none'); plain = ''; return; }
    plain = m.segments.map((s) => s.text).join('');
    code.replaceChildren(...m.segments.map((s) => (s.step == null ? colour(s.text) : h('span', {
      class: 'ph-frag', dataset: { step: String(s.step) }, title: m.steps[s.step] ? m.steps[s.step].label : null,
      onclick: () => select(s.step, 'code'), onmouseenter: () => { highlight([s.step]); onHover(s.step); }, onmouseleave: () => { highlight([]); onHover(null); },
    }, colour(s.text)))).flat());
    code.classList.toggle('ph-nowrap', !st.wrap);
    code.setAttribute('aria-label', t('cmd.codeLabel'));
    const n = { exact: 0, approx: 0, none: 0 };
    // Summary: one "all exact" line only when nothing is approximate and nothing is missing; otherwise counts per
    // fidelity class, so the user sees at a glance how far the command can be trusted. aria-live announces changes.
    for (const s of m.steps) n[s.fidelity] = (n[s.fidelity] || 0) + 1;
    const total = m.steps.length;
    summary.replaceChildren(...(total && !n.approx && !n.none && !(m.missing && m.missing.length)
      ? [h('span', { class: 'ph-fid ph-fid-exact' }, iconEl('check'), t('cmd.allExact'))]
      : [n.exact ? h('span', { class: 'ph-fid ph-fid-exact' }, iconEl('check'), t('cmd.nExact', { n: n.exact })) : null,
        n.approx ? h('span', { class: 'ph-fid ph-fid-approx' }, iconEl('approx'), t('cmd.nApprox', { n: n.approx })) : null,
        m.missing && m.missing.length ? h('span', { class: 'ph-fid ph-fid-none' }, iconEl('minus'), t('cmd.nMissing', { n: m.missing.length })) : null].filter(Boolean)));
    list.replaceChildren(...m.steps.map((s, i) => h('li', { class: 'ph-step ph-step-' + s.fidelity, dataset: { step: String(i) } },
      h('button', {
        type: 'button', class: 'ph-step-b', dataset: { step: String(i) },
        onclick: () => select(i, 'row'), onmouseenter: () => { highlight([i]); onHover(i); }, onmouseleave: () => { highlight([]); onHover(null); },
        onfocus: () => highlight([i]),
      },
      h('span', { class: 'ph-step-ic', role: 'img', 'aria-label': t('cmd.fid.' + s.fidelity), title: t('cmd.fid.' + s.fidelity) }, iconEl(FID_ICON[s.fidelity] || 'minus')),
      h('span', { class: 'ph-step-l' }, s.label),
      s.argsText ? h('code', { class: 'ph-step-a' }, s.argsText) : null),
      s.note ? h('p', { class: 'ph-step-n' }, s.note) : null)));
    missing.hidden = !(m.missing && m.missing.length);
    if (m.missing && m.missing.length) {
      missing.replaceChildren(h('p', { class: 'ph-miss-h' }, iconEl('info'), m.missingTitle || t('cmd.missingTitle')),
        h('ul', {}, m.missing.map((x) => h('li', {}, iconEl(x.icon || 'minus'), h('span', {}, x.text)))));
    }
    notes.hidden = !(m.notes && m.notes.length);
    notes.replaceChildren(...(m.notes || []).map((x) => h('li', {}, iconEl(x.icon || 'info'), h('span', {}, x.text))));
    selected = selectedId == null ? -1 : m.steps.findIndex((s) => s.id === selectedId);
    if (selected >= 0) highlight([selected], 'on');
  }

  return {
    el,
    render,
    highlight,
    select: (i) => select(i, 'external'),
    clearSelection() { selected = -1; selectedId = null; highlight([], 'on'); },
    get state() { return { ...st }; },
    get text() { return plain; },
  };
}
