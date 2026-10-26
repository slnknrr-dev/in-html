// site-studio/editor-wiki.js - the knowledge base in the site editor: Site → Knowledge base (layers and the ruby
// layer, doc.wiki) and the inspector controls of the wiki blocks' structured fields: tables as text (wkgrid: rows by
// line, cells by |), lists of layer ids (wkcsv), per-layer tiers (wktiers: 'id: text' lines) and JSON (wkjson).
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { S } from '../studio/state.js';
import { commit } from '../studio/history.js';
import { section } from '../studio/fields.js';
import { renderDocSettings } from '../studio/right.js';
import { WIKI_TYPES } from './viewer-blocks-wiki.js';
import { BLOCKS as KB } from './wiki-blocks.js';

// Layer ids become CSS class / data-attribute values on the published page: lowercase identifiers, max 32 chars.
const LAYER_RE = /^[a-z][a-z0-9-]{0,31}$/;

// Commits on 'change' (blur), not 'input': these texts are parsed into structures, and parsing a half-typed line on
// every keystroke would store garbage states in history.
function area(value, onChange, id, rows = 6) {
  return h('textarea', { id, class: 'ed-input ed-textarea ed-mono', rows, spellcheck: false, value,
    onchange: (e) => onChange(e.target.value, false) });
}

// Text round-trips for structured fields: each control serializes the value to an editable text and parses it back.
// The formats are lossy by design (empty grid rows dropped, invalid layer ids filtered), which normalizes input.
export const WIKI_CONTROLS = {
  wkgrid: (f, v, onChange, id) => area((Array.isArray(v) ? v : []).map((r) => (Array.isArray(r) ? r : []).join(' | ')).join('\n'), (s) => {
    const rows = String(s).split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('|').map((c) => c.trim()));
    onChange(rows.length ? rows : [['']]);
  }, id),
  wkcsv: (f, v, onChange, id) => h('input', { id, class: 'ed-input ed-mono', value: (Array.isArray(v) ? v : []).join(', '),
    onchange: (e) => onChange(String(e.target.value).split(/[\s,;]+/).map((x) => x.trim()).filter((x) => LAYER_RE.test(x))) }),
  wktiers: (f, v, onChange, id) => area(Object.entries(v && typeof v === 'object' ? v : {}).map(([k, x]) => k + ': ' + x).join('\n'), (s) => {
    const o = {};
    for (const l of String(s).split(/\r?\n/)) { const m = /^\s*([a-z][a-z0-9-]{0,31})\s*:\s?(.*)$/.exec(l); if (m) o[m[1]] = m[2]; }
    onChange(o);
  }, id, 3),
  // Invalid JSON is not committed; the textarea is flagged instead, so the stored value stays the last valid one.
  wkjson: (f, v, onChange, id) => {
    const el = area(JSON.stringify(v == null ? [] : v, null, 1), (s) => {
      try { onChange(JSON.parse(s)); el.classList.remove('ed-invalid'); } catch { el.classList.add('ed-invalid'); }
    }, id, 6);
    return el;
  },
};

export const WIKI_ICONS = Object.fromEntries(WIKI_TYPES.map((x) => ['wk-' + x, KB[x].icon || 'type']).concat([['wk-versions', 'layers'], ['wk-layers', 'eye'], ['wk-secret', 'lock']]));

// render: 'all' because layers change what wiki blocks show on the canvas.
function setWiki(fn) {
  commit('doc wiki', () => fn(S.doc.wiki), { render: 'all' });
  renderDocSettings();
}

// Renaming or deleting a layer keeps doc.wiki.ruby consistent (it names a layer id) in the same commit.
export function dsWiki(body) {
  if (!S.doc.wiki) return;
  const w = S.doc.wiki;
  const rows = w.layers.map((l, i) => h('div', { class: 'ss-role' },
    h('input', { class: 'ed-input ed-mono', value: l.id, 'aria-label': t('kb.id'), onchange: (e) => {
      const v = String(e.target.value).trim().toLowerCase();
      if (!LAYER_RE.test(v) || w.layers.some((x, k) => k !== i && x.id === v)) { e.target.value = l.id; return; }
      setWiki((ww) => { if (ww.ruby === ww.layers[i].id) ww.ruby = v; ww.layers[i].id = v; });
    } }),
    h('input', { class: 'ed-input', value: l.label, 'aria-label': t('kb.label'), onchange: (e) => setWiki((ww) => { ww.layers[i].label = String(e.target.value).slice(0, 80); }) }),
    h('label', { class: 'ed-check' }, h('input', { type: 'checkbox', checked: l.on, onchange: (e) => setWiki((ww) => { ww.layers[i].on = e.target.checked; }) }), ' ', t('kb.on')),
    h('button', { type: 'button', class: 'ed-btn ed-icon ed-sm', 'aria-label': t('files.delete'), onclick: () => setWiki((ww) => { const gone = ww.layers.splice(i, 1)[0]; if (gone && ww.ruby === gone.id) ww.ruby = ''; }) }, iconEl('trash'))));
  const add = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => setWiki((ww) => { let n = 1; while (ww.layers.some((x) => x.id === 'layer-' + n)) n++; ww.layers.push({ id: 'layer-' + n, label: '', on: true }); }) }, iconEl('plus'), t('kb.add'));
  const ruby = h('select', { class: 'ed-input', 'aria-label': t('kb.ruby'), onchange: (e) => setWiki((ww) => { ww.ruby = e.target.value; }) },
    h('option', { value: '' }, t('kb.none')), ...w.layers.map((l) => h('option', { value: l.id, selected: l.id === w.ruby }, l.label || l.id)));
  body.append(h('p', { class: 'ed-hint' }, t('kb.intro')));
  body.append(section('ds-wiki', t('kb.layers'), h('div', {}, h('div', { class: 'ss-roles' }, ...rows), add,
    h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('kb.ruby')), ruby))));
}
