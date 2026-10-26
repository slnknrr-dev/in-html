// regexp-app/editor.js - caret-safe highlighted editors: a transparent <textarea> over a mirror layer that draws the
// colours (pattern syntax, match and group marks). The textarea keeps its value, caret, selection, undo and IME; the
// mirror only repaints. Both share font, padding and wrapping (app.css), and the textarea grows with its text.
// 
// Why this technique: contenteditable with spans would put the colours and the caret in one DOM, but every repaint then
// destroys the selection and the browser's undo stack, and IME composition breaks when nodes change under it. With the
// overlay, repainting the mirror (innerHTML) never touches the element the user is typing into.
// Security: all user text goes through esc() before innerHTML; class names come from fixed tables only.
import { esc, h } from '../ui/dom.js';
import { segments, tokenize } from '../regexp/highlight.js';

export const GROUP_COLORS = 6;
// Group n -> one of 6 colour classes; Math.max(1, n) maps group 0 / missing to the first colour instead of a negative modulo.
export const groupClass = (n) => 'rx-c' + ((Math.max(1, n) - 1) % GROUP_COLORS);

/**
 * createEditor({ kind: 'pattern' | 'text', label, placeholder, onInput(value), onCaret(start, end), onKey(e) })
 * → { el, ta, mirror, value, paint(html), grow(), select(start, end), setLabels(label, placeholder) }
 */
export function createEditor({ kind, label, placeholder, onInput, onCaret, onKey }) {
  const mirror = h('div', { class: 'rx-mirror', 'aria-hidden': 'true' });
  // Writing aids disabled: spellcheck squiggles, autocorrect and autocapitalize would alter or decorate regex syntax;
  // data-gramm=false opts out of the Grammarly extension, translate=no of page translators rewriting the text.
  const ta = h('textarea', {
    class: 'rx-ta', rows: 1, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
    'aria-label': label, placeholder, 'data-gramm': 'false', translate: 'no',
  });
  const el = h('div', { class: 'rx-ed rx-ed-' + kind }, mirror, ta);
  let raf = 0;
  // Auto-grow: reset to auto first so scrollHeight can shrink too (otherwise the box only ever grows), then set it to the
  // content height. The mirror is absolutely positioned, so it follows this height.
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  };
  const caret = () => { if (onCaret) onCaret(ta.selectionStart, ta.selectionEnd); };
  ta.addEventListener('input', () => { grow(); onInput(ta.value); caret(); });
  ta.addEventListener('keydown', (e) => { if (onKey) onKey(e); });
  // selectionchange fires on the document; follow it while this field has focus.
  // Caret moves without input (arrows, clicks) only surface as document selectionchange. Coalesced to one rAF: a drag
  // selection fires many events per frame. Listener is never removed: editors are created once and live for the page.
  document.addEventListener('selectionchange', () => {
    if (document.activeElement !== ta) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(caret);
  });
  ta.addEventListener('focus', caret);
  // Width changes rewrap the text: keep the height in step.
  // Only width changes rewrap text, so height recompute is gated on clientWidth; height changes we cause ourselves would otherwise loop.
  if (typeof ResizeObserver === 'function') {
    let w = 0;
    new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; grow(); } }).observe(el);
  } else window.addEventListener('resize', () => grow());
  return {
    el, ta, mirror, grow,
    get value() { return ta.value; },
    // Assignment only when different: setting the same value would reset the caret to the end in some browsers.
    set value(v) { if (ta.value !== v) { ta.value = v; grow(); } },
    // A trailing newline needs a character after it, or the mirror's last line collapses.
    paint(html) { mirror.innerHTML = html + (ta.value.endsWith('\n') || !ta.value ? '&#8203;' : ''); },
    // preventScroll: selecting an error range must not jump the page; the field is already visible.
    select(start, end = start) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(start, end);
      caret();
    },
    setLabels(lab, ph) { ta.setAttribute('aria-label', lab); ta.setAttribute('placeholder', ph); },
  };
}

/**
 * Pattern mirror markup: syntax colours, group colours, the error range, warning ranges (dotted underlines), a
 * highlighted range and bracket pairs.
 */
// Marks are overlays on top of syntax spans; segments() (regexp/highlight.js) splits the source at every token and mark
// boundary so each output span has one syntax class plus any marks. Empty ranges are widened to one character so a
// zero-length error or hot spot is still visible.
export function patternHTML(source, flags, { error = null, hot = null, caret = -1, warnings = [] } = {}) {
  if (!source) return '';
  const tk = tokenize(source, flags);
  const marks = [];
  for (const w of warnings) if (w.severity !== 'info' && w.end > w.start) marks.push({ start: w.start, end: w.end, type: 'rx-w-' + w.severity });
  if (error) {
    const s = Math.min(error.start, source.length - 1);
    marks.push({ start: Math.max(0, s), end: Math.max(error.end, s + 1), type: 'rx-bad' });
  }
  if (hot) marks.push({ start: hot.start, end: Math.max(hot.end, hot.start + 1), type: 'rx-hot' });
  // Bracket pairing: the caret touching either side of either bracket highlights both; first pair wins (innermost-first order is up to the tokenizer).
  if (caret >= 0) {
    for (const [a, b] of tk.pairs) {
      if (caret === a || caret === a + 1 || caret === b || caret === b + 1) {
        marks.push({ start: a, end: a + 1, type: 'rx-pair' }, { start: b, end: b + 1, type: 'rx-pair' });
        break;
      }
    }
  }
  let out = '';
  for (const s of segments(source, tk.spans, marks)) {
    const cls = [];
    if (s.type) cls.push('rx-t-' + s.type);
    if (s.group) cls.push(groupClass(s.group));
    else if (s.depth != null && (s.type === 'grp' || s.type === 'look')) cls.push('rx-d' + (s.depth % 3));
    if (s.mark) cls.push(s.mark);
    const text = esc(source.slice(s.start, s.end));
    out += cls.length ? `<span class="${cls.join(' ')}">${text}</span>` : text;
  }
  return out;
}

/**
 * Test text mirror markup: alternating match backgrounds, the innermost capture group underlined in its colour,
 * zero-length matches as thin bars. Every piece of a match carries data-m (its index) for hover lookups.
 */
// Builds the test-text mirror. Algorithm: collect every boundary (match starts/ends, group starts/ends inside a match),
// sort them, then emit one span per elementary interval. Each interval belongs to at most one match (JS matches never
// overlap), found by advancing a pointer mi over non-empty matches — O(points + matches) instead of a search per
// interval. Zero-length matches are emitted as <i class="rx-z"> markers at their position.
export function textHTML(text, matches, focus = -1) {
  if (!matches || !matches.length) return esc(text);
  const pts = new Set([0, text.length]);
  const zeros = new Map();
  for (let k = 0; k < matches.length; k++) {
    const m = matches[k];
    if (m.end === m.index) { zeros.set(m.index, [...(zeros.get(m.index) || []), k]); continue; }
    pts.add(m.index); pts.add(m.end);
    for (const g of m.groups) if (g.start >= m.index && g.end <= m.end && g.end > g.start) { pts.add(g.start); pts.add(g.end); }
  }
  for (const z of zeros.keys()) pts.add(z);
  const points = [...pts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  let out = '', mi = 0;
  const nonEmpty = matches.map((m, k) => k).filter((k) => matches[k].end > matches[k].index);
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    for (const k of zeros.get(a) || []) out += `<i class="rx-z${k === focus ? ' rx-focus' : ''}" data-m="${k}"></i>`;
    if (i + 1 >= points.length) break;
    const b = points[i + 1];
    while (mi < nonEmpty.length && matches[nonEmpty[mi]].end <= a) mi++;
    const k = mi < nonEmpty.length ? nonEmpty[mi] : -1;
    const piece = esc(text.slice(a, b));
    if (k < 0 || matches[k].index > a) { out += piece; continue; }
    const m = matches[k];
    // Innermost group covering the interval: the smallest one wins, so nested groups show the most specific colour.
    let best = null;
    for (const g of m.groups) if (g.start <= a && g.end >= b && g.end > g.start && g.start >= m.index && g.end <= m.end && (!best || g.end - g.start <= best.end - best.start)) best = g;
    const cls = 'rx-m rx-m' + (k % 2) + (best ? ' rx-g ' + groupClass(best.n) : '') + (k === focus ? ' rx-focus' : '')
      + (a === m.index ? ' rx-mstart' : '') + (b === m.end ? ' rx-mend' : '');
    out += `<span class="${cls}" data-m="${k}">${piece}</span>`;
  }
  return out;
}

/**
 * Old matches moved across a text edit (common prefix / suffix), so marks stay in place until the new evaluation
 * arrives; matches touching the edited span are dropped.
 */
// Optimistic re-use of old matches while the worker recomputes: find the common prefix p and suffix s of the old and
// new text; matches entirely before the edit stay, matches entirely after shift by delta, matches touching the edit
// are dropped (they may no longer match). Avoids marks flickering off on every keystroke.
export function shiftMatches(before, after, matches) {
  if (!matches) return null;
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const endOld = before.length - s, delta = after.length - before.length;
  const move = (x) => (x >= endOld ? x + delta : x);
  const out = [];
  for (const m of matches) {
    if (m.end <= p) out.push(m);
    else if (m.index >= endOld) out.push({ ...m, index: move(m.index), end: move(m.end), groups: m.groups.map((g) => (g.start < 0 ? g : { ...g, start: move(g.start), end: move(g.end) })) });
  }
  return out;
}
