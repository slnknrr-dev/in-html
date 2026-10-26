// regexp-app/panels.js - the views of Regex Studio: Matches, Replace, Split, Explain, Diagram, Code and the cheat
// sheet. Each view is built once per activation (build) and refreshed in place (update) so fields keep focus.
// 
// View contract: build(host, app) -> { update(), focus?(k), caret?(pos) }. main.js calls update() after every result
// or pattern change, caret() when the pattern caret moves, focus() when a match is hovered elsewhere. Views never write
// state except their own inputs (replacement, split limit, code language) and report changes through app.changed().
// Security: user text reaches innerHTML only through esc() or patternHTML(), which escapes.
import { esc, h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { button, t } from '../ui/app.js';
import { explain } from '../regexp/explain.js';
import { diagram } from '../regexp/diagram.js';
import { snippets, LANGUAGES } from '../regexp/codegen.js';
import { S } from './state.js';
import { diagramLabel, errorText, explainText, flagName, noteText } from './describe.js';
import { groupClass, patternHTML } from './editor.js';

// Table/list rows rendered at most: thousands of rows with event handlers would make every update slow. The count still shows the total.
const MAX_ROWS = 500;

// Visible whitespace for match texts in tables and lists.
// Whitespace made visible (· → ↵) after escaping: a match of spaces or a newline would otherwise look like an empty cell.
function shown(text) {
  if (text == null) return h('span', { class: 'rx-unset', title: t('rx.info.unset') }, '—');
  if (text === '') return h('span', { class: 'rx-unset' }, t('rx.emptyText'));
  const s = text.length > 200 ? text.slice(0, 200) + '…' : text;
  return h('span', { class: 'rx-vis', html: esc(s).replace(/ /g, '<i class="rx-ws">·</i>').replace(/\t/g, '<i class="rx-ws">→</i>').replace(/\n/g, '<i class="rx-ws">↵</i>') });
}

function emptyState(ic, text, hint) {
  return h('div', { class: 'rx-empty' }, iconEl(ic), h('p', {}, text), hint ? h('p', { class: 'ed-hint' }, hint) : null);
}

// A blocking state shared by the views that need a valid pattern / a finished run.
// Shared guard: invalid pattern, timeout or runtime error replaces the view body with an explanation instead of stale data.
function blocked(app) {
  if (!S.parsed || !S.parsed.ok) return emptyState('warn', t('rx.blockedError'), S.parsed && S.parsed.error ? errorText(S.parsed.error) : null);
  if (S.status === 'timeout') return emptyState('clock', t('rx.timeoutTitle'), t('rx.timeoutHint'));
  if (S.status === 'error') return emptyState('warn', t('rx.runError'), S.result && S.result.error);
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Matches

const matchesView = {
  build(host, app) {
    const body = h('div', { class: 'rx-pane-body' });
    host.append(body);
    return {
      update() {
        body.textContent = '';
        const b = blocked(app);
        if (b) { body.append(b); return; }
        const r = S.result;
        if (!r) { body.append(h('div', { class: 'rx-empty' }, h('span', { class: 'ed-spinner' }))); return; }
        if (!r.matches.length) { body.append(emptyState('search', t('rx.noMatches'), S.text ? t('rx.noMatchesHint') : t('rx.noTextHint'))); return; }
        // Columns come from the result itself: while a new run is pending the previous result stays on screen.
        const groups = r.matches[0].groups.map((g) => ({ index: g.n, name: g.name }));
        const head = h('div', { class: 'rx-pane-head' },
          h('span', { class: 'rx-count' }, t('rx.matchCount', { n: r.count })),
          r.truncated === 'count' ? h('span', { class: 'ed-badge' }, t('rx.listed', { n: r.matches.length })) : null,
          h('span', { class: 'ed-spacer' }),
          button('rx.copyJSON', 'copy', () => app.copy(JSON.stringify(r.matches.map((m) => ({
            index: m.index, match: m.text, groups: Object.fromEntries(m.groups.map((g) => [g.name || '$' + g.n, g.text])),
          })), null, 2))));
        head.lastChild.classList.add('ed-sm');
        const cols = groups.map((g) => h('th', { scope: 'col', title: t('rx.groupN', { n: g.index }) },
          h('span', { class: 'rx-gchip ' + groupClass(g.index) }, g.name || '$' + g.index)));
        const rows = r.matches.slice(0, MAX_ROWS).map((m, k) => {
          const tr = h('tr', {
            tabindex: '0', class: k === app.focusIndex() ? 'rx-row-on' : '', dataset: { m: String(k) },
            onclick: () => app.selectMatch(k), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.selectMatch(k); } },
            onmouseenter: () => app.focusMatch(k, false), onmouseleave: () => app.focusMatch(-1, false),
          },
          h('td', { class: 'rx-num' }, String(k + 1)),
          h('td', { class: 'rx-num rx-range' }, m.index + '–' + m.end),
          h('td', { class: 'rx-cell' }, shown(m.text)),
          m.groups.map((g) => h('td', { class: 'rx-cell' }, shown(g.text))));
          return tr;
        });
        body.append(head, h('div', { class: 'ap-table-wrap rx-table-wrap' }, h('table', { class: 'ap-table rx-table' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, t('rx.col.range')), h('th', { scope: 'col' }, t('rx.col.match')), cols)),
          h('tbody', {}, rows))),
        r.matches.length > MAX_ROWS ? h('p', { class: 'ed-hint' }, t('rx.moreRows', { n: r.matches.length - MAX_ROWS })) : '');
      },
      focus(k) {
        for (const tr of body.querySelectorAll('tr[data-m]')) tr.classList.toggle('rx-row-on', +tr.dataset.m === k);
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------
// Replace

// Replacement tokens: $&, numbered and named groups of the current pattern (first 9 numbered), $$, $` and $'. Rebuilt on each update because the groups change with the pattern.
function tokenButtons(insert) {
  const toks = [['$&', 'rx.tok.amp'], ...S.parsed?.ok ? S.parsed.groups.slice(0, 9).map((g) => ['$' + g.index, null, g.index]) : [],
    ...(S.parsed?.ok ? S.parsed.names.map((n) => ['$<' + n + '>', null, S.parsed.groups.find((g) => g.name === n).index, n]) : []), ['$$', 'rx.tok.dollar'], ['$`', 'rx.tok.before'], ['$\'', 'rx.tok.after']];
  return h('div', { class: 'rx-toks', role: 'group', 'aria-label': t('rx.insertToken') }, toks.map(([tok, key, n, name]) => h('button', {
    type: 'button', class: 'rx-tok' + (n ? ' ' + groupClass(n) : ''), title: key ? t(key) : name ? t('rx.groupNamed', { name }) : t('rx.groupN', { n }),
    onclick: () => insert(tok),
  }, tok)));
}

const replaceView = {
  build(host, app) {
    const input = h('input', { type: 'text', class: 'ed-input rx-mono', value: S.replacement, spellcheck: 'false', placeholder: t('rx.replacePh'), 'aria-label': t('rx.replaceWith'), id: 'rx-repl' });
    input.addEventListener('input', () => { S.replacement = input.value; app.changed('replacement'); });
    const insert = (tok) => {
      const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
      input.setRangeText(tok, a, b, 'end');
      input.focus();
      S.replacement = input.value;
      app.changed('replacement');
    };
    const toks = h('div', {});
    const out = h('div', { class: 'rx-pane-body' });
    host.append(h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'rx-repl' }, t('rx.replaceWith')), input), toks, out);
    app.registerReplaceInput(input);
    return {
      update() {
        toks.textContent = '';
        toks.append(tokenButtons(insert));
        out.textContent = '';
        const b = blocked(app);
        if (b) { out.append(b); return; }
        const r = S.result;
        if (!r || r.output == null) { out.append(h('div', { class: 'rx-empty' }, h('span', { class: 'ed-spinner' }))); return; }
        // Output assembled from pieces (literal / replaced) computed in the worker, so replaced parts can be marked without re-running the regex here.
        const n = r.pieces.filter((p) => p.replaced).length;
        const pre = h('pre', { class: 'rx-out', tabindex: '0', 'aria-label': t('ap.result') });
        pre.innerHTML = r.pieces.map((p) => (p.replaced ? `<mark class="rx-rep">${esc(p.text) || '<i class="rx-z"></i>'}</mark>` : esc(p.text))).join('') || '<span class="rx-unset">' + esc(t('rx.emptyText')) + '</span>';
        const copyB = button('ap.copy', 'copy', () => app.copy(r.output));
        const use = button('rx.useAsText', 'down', () => app.useText(r.output));
        for (const x of [copyB, use]) x.classList.add('ed-sm');
        out.append(h('div', { class: 'rx-pane-head' }, h('span', { class: 'rx-count' }, t('rx.replaced', { n })), h('span', { class: 'ed-spacer' }), copyB, use),
          pre, !S.parsed.flags.global && n ? h('p', { class: 'ed-hint' }, t('rx.replaceFirst')) : '');
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------
// Split

const splitView = {
  build(host, app) {
    const lim = h('input', { type: 'number', min: '0', step: '1', class: 'ed-input rx-limit', value: S.splitLimit, placeholder: t('rx.splitNoLimit'), id: 'rx-lim' });
    lim.addEventListener('input', () => { S.splitLimit = /^\d{0,6}$/.test(lim.value) ? lim.value : ''; app.changed('split'); });
    const out = h('div', { class: 'rx-pane-body' });
    host.append(h('div', { class: 'rx-split-head' }, h('label', { class: 'ed-label', for: 'rx-lim' }, t('rx.splitLimit')), lim, h('p', { class: 'ed-hint' }, t('rx.splitHint'))), out);
    return {
      update() {
        out.textContent = '';
        const b = blocked(app);
        if (b) { out.append(b); return; }
        const r = S.result;
        if (!r || !r.parts) { out.append(h('div', { class: 'rx-empty' }, h('span', { class: 'ed-spinner' }))); return; }
        const copyB = button('rx.copyJSON', 'copy', () => app.copy(JSON.stringify(r.parts.map((p) => p.text), null, 2)));
        copyB.classList.add('ed-sm');
        out.append(h('div', { class: 'rx-pane-head' }, h('span', { class: 'rx-count' }, t('rx.parts', { n: r.parts.length })), h('span', { class: 'ed-spacer' }), copyB),
          h('ol', { class: 'rx-parts', start: '0' }, r.parts.slice(0, MAX_ROWS).map((p, i) => h('li', { class: p.capture ? 'rx-part-cap' : '' },
            h('span', { class: 'rx-part-i' }, String(i)),
            p.capture ? h('span', { class: 'rx-gchip ' + groupClass(p.capture) }, '$' + p.capture) : null,
            p.text == null ? h('span', { class: 'rx-unset' }, 'undefined') : shown(p.text)))));
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------
// Explain

// Compact source for a tree row: short nodes in full; long nodes with children as head…tail (e.g. "(?:…)") so the row stays one line.
function chipText(node) {
  const raw = S.source.slice(node.start, node.end);
  if (raw.length <= 28 || !node.children.length) return raw.length > 60 ? raw.slice(0, 57) + '…' : raw;
  const a = node.children[0], z = node.children[node.children.length - 1];
  const head = S.source.slice(node.start, a.start), tail = S.source.slice(z.end, node.end);
  return (head || '') + '…' + (tail || '');
}

// ARIA tree: role=tree/treeitem/group with aria-level. Rows are focusable; focus and hover both highlight the pattern range.
const explainView = {
  build(host, app) {
    const body = h('div', { class: 'rx-pane-body rx-explain' });
    host.append(body);
    let rows = [];
    const row = (node, depth) => {
      const chip = chipText(node);
      const el = h('div', {
        class: 'rx-ex-row rx-k-' + node.kind, tabindex: '0', role: 'treeitem', 'aria-level': String(depth + 1),
        dataset: { s: String(node.start), e: String(node.end) },
        onmouseenter: () => app.hot(node), onmouseleave: () => app.hot(null), onfocus: () => app.hot(node), onblur: () => app.hot(null),
        onclick: () => app.selectPattern(node.start, node.end),
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); app.selectPattern(node.start, node.end); } },
      },
      chip ? h('code', { class: 'rx-ex-src', html: patternHTML(chip, S.flags) }) : null,
      h('span', { class: 'rx-ex-txt' }, explainText(node)));
      if (node.kind === 'group' && node.params.index) el.querySelector('.rx-ex-src')?.classList.add('rx-ex-grp', groupClass(node.params.index));
      rows.push(el);
      return h('li', { role: 'none' }, el, node.children.length ? h('ul', { role: 'group' }, node.children.map((c) => row(c, depth + 1))) : null);
    };
    return {
      update() {
        body.textContent = '';
        rows = [];
        if (!S.parsed || !S.parsed.ok) { body.append(emptyState('warn', t('rx.blockedError'), S.parsed && S.parsed.error ? errorText(S.parsed.error) : null)); return; }
        const tree = explain(S.parsed);
        const flags = [...S.parsed.flags.raw];
        body.append(h('div', { class: 'rx-ex-flags' },
          h('span', { class: 'ed-label' }, t('rx.flags')),
          flags.length ? flags.map((c) => h('span', { class: 'rx-flagpill', title: t('rx.flagHint.' + c) }, h('b', {}, c), ' ', flagName(c))) : h('span', { class: 'ed-muted' }, t('rx.noFlags'))));
        if (!S.source) body.append(h('p', { class: 'ed-hint' }, t('rx.emptyPattern')));
        body.append(h('ul', { class: 'rx-tree', role: 'tree', 'aria-label': t('rx.tab.explain') }, tree.children.map((c) => row(c, 0))));
        this.caret(app.caretPos());
      },
      // Smallest node containing the caret gets .rx-active: the most specific explanation for where the user is typing.
      caret(pos) {
        let best = null;
        for (const r of rows) {
          r.classList.remove('rx-active');
          const s = +r.dataset.s, e = +r.dataset.e;
          if (s <= pos && pos < e && (!best || e - s <= +best.dataset.e - +best.dataset.s)) best = r;
        }
        if (best) best.classList.add('rx-active');
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------
// Diagram

let measureCtx = null;
// Text width for diagram box sizes via a shared offscreen canvas: no layout, no DOM. The font strings must match the
// diagram's SVG fonts, otherwise boxes are too narrow or too wide.
function measure(text, kind) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = kind === 'mono' ? '12.5px ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace' : '600 10.5px system-ui, "Segoe UI", Roboto, sans-serif';
  return measureCtx.measureText(String(text)).width;
}

// CSS variables resolved for export. A downloaded SVG has no access to this page's stylesheet, so the live colours are
// read with getComputedStyle and baked into the standalone file (the live diagram uses var() instead).
const DG_VARS = ['--rx-dg-line', '--rx-dg-bg', '--rx-dg-lit', '--rx-dg-lit-b', '--rx-dg-lit-t', '--rx-dg-set', '--rx-dg-set-b', '--rx-dg-set-t', '--rx-dg-anc', '--rx-dg-anc-b',
  '--rx-dg-anc-t', '--rx-dg-ref', '--rx-dg-ref-b', '--rx-dg-ref-t', '--rx-dg-grp', '--rx-dg-grp-b', '--rx-dg-look', '--rx-dg-look-b', '--rx-dg-cap'];

function standalone(stage) {
  const cs = getComputedStyle(stage);
  const vars = {};
  for (const v of DG_VARS) { const x = cs.getPropertyValue(v).trim(); if (x) vars[v] = x; }
  const bg = cs.getPropertyValue('--rx-dg-paper').trim() || '#ffffff';
  return diagram(S.parsed, { label: diagramLabel, measure, idPrefix: 'rxd', vars, background: bg, title: t('rx.dg.title'), desc: '/' + S.source + '/' + S.flags });
}

const diagramView = {
  build(host, app) {
    const stage = h('div', { class: 'rx-dg-stage', tabindex: '0', 'aria-label': t('rx.tab.diagram') });
    const svgB = button('rx.dg.svg', 'download', () => {
      const d = standalone(stage);
      if (d) app.download(d.svg, 'regex-diagram.svg', 'image/svg+xml');
    });
    // PNG export: the SVG is loaded as an image from a blob URL and drawn on a canvas at 2x for sharp output. A blob URL
    // (same origin) keeps the canvas untainted, so toBlob is allowed. The URL is always revoked (finally).
    const pngB = button('rx.dg.png', 'image', async () => {
      const d = standalone(stage);
      if (!d) return;
      const k = 2;
      const url = URL.createObjectURL(new Blob([d.svg], { type: 'image/svg+xml' }));
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const c = document.createElement('canvas');
        c.width = Math.ceil(d.width * k);
        c.height = Math.ceil(d.height * k);
        const g = c.getContext('2d');
        g.scale(k, k);
        g.drawImage(img, 0, 0, d.width, d.height);
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        if (blob) app.download(blob, 'regex-diagram.png', 'image/png');
      } catch { app.toast(t('rx.dg.pngFail'), 'warn'); } finally { URL.revokeObjectURL(url); }
    });
    const fitB = button('rx.dg.fit', 'fitWidth', () => { S.dgFit = !S.dgFit; paintFit(); });
    fitB.classList.add('rx-dg-fitbtn');
    const paintFit = () => { stage.classList.toggle('rx-fit', !!S.dgFit); fitB.classList.toggle('ed-on', !!S.dgFit); fitB.setAttribute('aria-pressed', String(!!S.dgFit)); };
    paintFit();
    for (const b of [fitB, svgB, pngB]) b.classList.add('ed-sm');
    const head = h('div', { class: 'rx-pane-head' }, h('span', { class: 'ed-hint rx-dg-hint' }, t('rx.dg.hint')), h('span', { class: 'ed-spacer' }), fitB, svgB, pngB);
    host.append(head, stage);
    // Event delegation on the stage: the SVG is replaced on every update, so per-node listeners would be lost and re-added each time.
    stage.addEventListener('mouseover', (e) => {
      const g = e.target.closest?.('[data-s]');
      if (g) app.hot({ start: +g.dataset.s, end: +g.dataset.e });
    });
    stage.addEventListener('mouseleave', () => app.hot(null));
    stage.addEventListener('click', (e) => {
      const g = e.target.closest?.('[data-s]');
      if (g) app.selectPattern(+g.dataset.s, +g.dataset.e);
    });
    return {
      update() {
        stage.textContent = '';
        const ok = S.parsed && S.parsed.ok;
        svgB.disabled = pngB.disabled = !ok;
        if (!ok) { stage.append(emptyState('warn', t('rx.blockedError'), S.parsed && S.parsed.error ? errorText(S.parsed.error) : null)); return; }
        const d = diagram(S.parsed, { label: diagramLabel, measure, idPrefix: 'rxd-live', title: t('rx.dg.title'), desc: '/' + S.source + '/' + S.flags });
        stage.innerHTML = d.svg;
        this.caret(app.caretPos());
      },
      caret(pos) {
        let best = null;
        for (const g of stage.querySelectorAll('[data-s]')) {
          // rr-* classes belong to the diagram's own embedded style (regexp/diagram.js), not app.css.
          g.classList.remove('rr-hot');
          const s = +g.dataset.s, e = +g.dataset.e;
          if (s <= pos && pos < e && (!best || e - s <= +best.dataset.e - +best.dataset.s)) best = g;
        }
        if (best) best.classList.add('rr-hot');
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------
// Code

// Snippets generated by regexp/codegen.js with flavour notes (what differs from JS in that language). Language tabs use arrow keys like the main tab strip.
const codeView = {
  build(host, app) {
    const tabs = h('div', { class: 'rx-langs', role: 'tablist', 'aria-label': t('rx.code.lang') });
    const pre = h('pre', { class: 'rx-code', tabindex: '0' });
    const notes = h('div', { class: 'rx-notes' });
    const copyB = button('rx.code.copy', 'copy', () => app.copy(pre.textContent, t('rx.code.copied')));
    copyB.classList.add('ed-sm');
    host.append(h('div', { class: 'rx-pane-head' }, tabs, h('span', { class: 'ed-spacer' }), copyB), pre, notes);
    const paintTabs = () => {
      tabs.textContent = '';
      for (const l of LANGUAGES) {
        tabs.append(h('button', {
          type: 'button', role: 'tab', class: 'rx-lang' + (S.codeLang === l.id ? ' ed-on' : ''), 'aria-selected': String(S.codeLang === l.id),
          tabindex: S.codeLang === l.id ? '0' : '-1', dataset: { l: l.id },
          onclick: () => { S.codeLang = l.id; app.changed('codeLang'); view.update(); },
        }, l.name));
      }
    };
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = LANGUAGES.findIndex((l) => l.id === S.codeLang);
      const next = LANGUAGES[(i + (e.key === 'ArrowRight' ? 1 : LANGUAGES.length - 1)) % LANGUAGES.length];
      S.codeLang = next.id;
      app.changed('codeLang');
      view.update();
      tabs.querySelector(`[data-l="${next.id}"]`)?.focus();
    });
    const view = {
      update() {
        paintTabs();
        notes.textContent = '';
        if (!S.parsed || !S.parsed.ok) {
          pre.textContent = '';
          pre.hidden = true;
          copyB.disabled = true;
          notes.append(emptyState('warn', t('rx.blockedError'), S.parsed && S.parsed.error ? errorText(S.parsed.error) : null));
          return;
        }
        pre.hidden = false;
        copyB.disabled = false;
        const all = snippets(S.parsed, { text: S.text, replacement: S.replacement || null });
        const sn = all.find((x) => x.id === S.codeLang) || all[0];
        pre.textContent = sn.code;
        pre.setAttribute('aria-label', sn.name);
        notes.append(h('h3', { class: 'rx-notes-h' }, iconEl('info'), t('rx.code.notes')));
        if (!sn.notes.length) notes.append(h('p', { class: 'ed-hint' }, t(sn.id === 'js' ? 'rx.code.native' : 'rx.code.noNotes')));
        else notes.append(h('ul', { class: 'rx-note-list' }, sn.notes.map((n) => h('li', {}, noteText(n)))));
      },
    };
    return view;
  },
};

// ---------------------------------------------------------------------------------------------------------
// Cheat sheet

// Cheat sheet entries: [token, description key, required flag, text to insert, caret offset]. Insert text with a caret
// offset places the cursor inside the inserted group, e.g. "(?:)" with offset 3.
const CHEAT = [
  ['chars', [['.', 'dot'], ['\\n', 'lf'], ['\\t', 'tab'], ['\\x41', 'hex'], ['\\u0041', 'uni'], ['\\u{1F600}', 'cp', 'u'], ['\\.', 'escape']]],
  ['classes', [['[abc]', 'set'], ['[^abc]', 'negset'], ['[a-z]', 'range'], ['\\d', 'd'], ['\\D', 'D'], ['\\w', 'w'], ['\\W', 'W'], ['\\s', 's'], ['\\S', 'S']]],
  ['anchors', [['^', 'start'], ['$', 'end'], ['\\b', 'b'], ['\\B', 'B']]],
  ['groups', [['(…)', 'group', '', '()', 1], ['(?:…)', 'nc', '', '(?:)', 3], ['(?<name>…)', 'named', '', '(?<name>)', 8], ['\\1', 'ref'], ['\\k<name>', 'kref'], ['a|b', 'alt', '', '|', 1], ['(?i:…)', 'mod', '', '(?i:)', 4]]],
  ['quant', [['*', 'star'], ['+', 'plus'], ['?', 'opt'], ['{3}', 'exact'], ['{2,}', 'atLeast'], ['{2,5}', 'between'], ['+?', 'lazy']]],
  ['look', [['(?=…)', 'la', '', '(?=)', 3], ['(?!…)', 'nla', '', '(?!)', 3], ['(?<=…)', 'lb', '', '(?<=)', 4], ['(?<!…)', 'nlb', '', '(?<!)', 4]]],
  ['unicode', [['\\p{L}', 'pL', 'u'], ['\\p{Lu}', 'pLu', 'u'], ['\\P{L}', 'PL', 'u'], ['\\p{Script=Greek}', 'pSc', 'u'], ['\\p{RGI_Emoji}', 'pEmoji', 'v'],
    ['[\\w--\\d]', 'minus', 'v'], ['[\\p{L}&&\\p{ASCII}]', 'and', 'v'], ['[\\q{abc|d}]', 'q', 'v']]],
  ['repl', [['$&', 'rAmp'], ['$1', 'r1'], ['$<name>', 'rName'], ['$$', 'rDollar'], ['$`', 'rBefore'], ['$\'', 'rAfter']]],
];

const cheatView = {
  build(host, app) {
    host.append(h('p', { class: 'ed-hint rx-cs-hint' }, t('rx.cs.hint')),
      h('div', { class: 'rx-cheat' }, CHEAT.map(([sec, items]) => h('section', { class: 'rx-cs-sec' },
        h('h3', { class: 'rx-cs-h' }, t('rx.cs.' + sec)),
        // [token, description key, flag it needs, text to insert, caret offset in that text]
        h('dl', { class: 'rx-cs-list' }, items.map(([tok, key, flag, ins, back]) => [
          h('dt', {}, h('button', {
            type: 'button', class: 'rx-cs-tok', title: t(sec === 'repl' ? 'rx.cs.insertRepl' : 'rx.cs.insert', { tok }),
            html: sec === 'repl' ? esc(tok) : patternHTML(tok, flag === 'v' ? 'v' : flag === 'u' ? 'u' : ''),
            onclick: () => (sec === 'repl' ? app.insertReplacement(tok) : app.insert(ins || tok, ins ? back : tok.length)),
          })),
          h('dd', {}, t('rx.cs.' + key), flag ? h('span', { class: 'rx-cs-flag', title: t('rx.cs.needs', { flag }) }, flag) : null),
        ]))))));
    return { update() {} };
  },
};

export const VIEWS = { matches: matchesView, replace: replaceView, split: splitView, explain: explainView, diagram: diagramView, code: codeView, cheat: cheatView };
export const VIEW_ICONS = { matches: 'list', replace: 'replace', split: 'scissors', explain: 'tree', diagram: 'rail', code: 'code', cheat: 'help' };
