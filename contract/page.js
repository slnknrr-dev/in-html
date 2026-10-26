// contract/page.js - the runtime of a compiled template (contract/compile.js): the whole fill-in page of one
// template in one HTML file. The modifiers as toggle buttons, the levels as segmented choices, the language of the
// contract (and side by side with a second one), the form of the fields the active text needs (contract/form.js),
// the live A4 preview (contract/render.js), the built-in checks and the template's JS validator in a Blob worker
// (contract/validate.js), printing, local autosave and the data as a JSON file. Nothing touches the network.
//
// The build bundles this module for another host (`new URL('../contract/page.js?bundle', import.meta.url)`, see
// bundle.js): the compiled page carries the bundle and calls
//   globalThis[Symbol.for('bundle:page.js')].boot({ template, lang, values?, modifiers?, levels? })
// Nothing runs at import.
import { h } from '../ui/dom.js';
import { normalizeTemplate, newDocument, normalizeDoc } from './model.js';
import { renderContract } from './render.js';
import { mountForm } from './form.js';
import { runUserValidator, validateDoc } from './validate.js';
import { DICTS, tr } from './dict.js';
import { isoDate } from './dates.js';
import { langName } from '../i18n/lang.js';
import { PAGE_SIZES } from '../paper/base.js';

// today: LOCAL calendar date built from getFullYear/Month/Date. toISOString() would give the UTC date, which is
// yesterday or tomorrow near midnight for users east/west of UTC: a contract dated off by one day.
// ls*: localStorage wrapped in try/catch: it throws in private modes, with storage disabled, or on quota; a file://
// page may also have no storage at all. Autosave is a convenience, so failures are silent.
const today = () => { const d = new Date(); return isoDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); };
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

// State model: `doc` is the single mutable source of truth; every change replaces doc (or one of its maps) and
// calls render(), which rebuilds the preview from scratch. No diffing: a contract renders in milliseconds and a full
// rebuild cannot drift out of sync with the data.
// Autosave key includes the template VERSION: a document saved against v1 is not loaded into v2 whose fields may
// have changed meaning. Priority on load: autosaved draft > values shipped in the page > empty/sample.
export function boot(data = {}) {
  const tpl = normalizeTemplate(data.template);
  const key = `agreement:${tpl.id}@${tpl.version}`;
  const saved = lsGet(key);
  let doc = saved ? normalizeDoc(saved) : newDocument(tpl, { empty: !data.values });
  if (!saved && data.values) doc.values = { ...data.values };
  if (!saved && data.modifiers) doc.modifiers = { ...doc.modifiers, ...data.modifiers };
  if (!saved && data.levels) doc.levels = { ...doc.levels, ...data.levels };
  let lang = tpl.langs.includes(doc.lang) ? doc.lang : tpl.langs.includes(data.lang) ? data.lang : tpl.main;
  let second = '';
  let tab = 'form';
  let userIssues = [];
  // The page UI speaks the contract language when a dictionary exists for it (the recipient chose that language),
  // otherwise English; own-property checks again because `lang` came from the data island.
  const ui = () => (Object.prototype.hasOwnProperty.call(DICTS, lang) ? lang : Object.prototype.hasOwnProperty.call(DICTS, lang.split('-')[0]) ? lang.split('-')[0] : 'en');
  const T = (k, v) => tr(ui(), k, v);
  const pick = (o) => (o && (o[lang] || o[tpl.main] || Object.values(o)[0])) || '';

  const root = document.getElementById('ctp-root') || document.body;
  const sheet = h('div', { class: 'ct-sheet ct-chips' });
  const side = h('aside', { class: 'ctp-side' });
  const issuesBox = h('div', { class: 'ctp-issues', hidden: true });
  const formHost = h('div', {});
  const stage = h('section', { class: 'ctp-stage' }, sheet);
  const main = h('main', { class: 'ctp-main', 'data-tab': tab }, side, stage);
  const top = h('header', { class: 'ctp-top' });
  const mods = h('div', { class: 'ctp-mods' });
  const tabs = h('nav', { class: 'ctp-tabs' });
  const foot = h('footer', { class: 'ctp-foot' });
  side.append(h('p', { class: 'ctp-hint' }), issuesBox, formHost);
  root.replaceChildren(top, mods, tabs, main, foot);

  let form = null;
  let timer = null, vtimer = null, vseq = 0;
  const save = () => { doc.updated = new Date().toISOString(); lsSet(key, doc); };

  function chrome() {
    document.documentElement.lang = lang;
    document.title = pick(tpl.name) || 'Agreement';
    const langSel = h('select', { 'aria-label': T('pg.lang'), title: T('pg.lang') }, tpl.langs.map((l) => h('option', { value: l }, langName(l))));
    langSel.value = lang;
    langSel.addEventListener('change', () => { lang = langSel.value; doc.lang = lang; save(); chrome(); render(true); });
    const sideSel = tpl.langs.length > 1 ? h('select', { 'aria-label': T('pg.side'), title: T('pg.side') }, h('option', { value: '' }, '—'), tpl.langs.map((l) => h('option', { value: l }, T('pg.side') + ': ' + langName(l)))) : null;
    if (sideSel) { sideSel.value = second; sideSel.addEventListener('change', () => { second = sideSel.value; render(false); }); }
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    // Import accepts only data exported for THIS template id; values are passed through normalizeDoc, so a
    // hand-edited file cannot inject unexpected shapes. alert/confirm: acceptable in a standalone offline page with
    // no UI framework, and they work under the strict CSP.
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      try {
        const raw = JSON.parse(await f.text());
        if (!raw || raw.template !== tpl.id) throw new Error('template');
        doc = normalizeDoc({ ...doc, values: raw.values, modifiers: raw.modifiers, levels: raw.levels });
        save(); chrome(); render(true);
      } catch { alert(T('pg.badFile')); }
      fileIn.value = '';
    });
    top.replaceChildren(h('h1', {}, pick(tpl.name)), langSel, sideSel,
      h('button', { type: 'button', class: 'ctp-btn', onclick: () => {
        const blob = new Blob([JSON.stringify({ template: tpl.id, version: tpl.version, values: doc.values, modifiers: doc.modifiers, levels: doc.levels }, null, 2)], { type: 'application/json' });
        // Download via a temporary <a download>: works from file:// with no server. The object URL is revoked
        // later, not immediately: revoking synchronously after click() cancels the download in some browsers.
        // The filename strips characters forbidden on Windows/macOS file systems.
        const a = h('a', { href: URL.createObjectURL(blob), download: (pick(tpl.name) || 'agreement').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.json' });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } }, T('pg.export')),
      h('button', { type: 'button', class: 'ctp-btn', onclick: () => fileIn.click() }, T('pg.import')), fileIn,
      h('button', { type: 'button', class: 'ctp-btn', onclick: () => { if (confirm(T('pg.resetQ'))) { doc = newDocument(tpl, { empty: true }); doc.lang = lang; save(); chrome(); render(true); } } }, T('pg.reset')),
      h('button', { type: 'button', class: 'ctp-btn ctp-primary', onclick: () => window.print() }, T('pg.print')));
    mods.replaceChildren(
      ...tpl.modifiers.map((m) => h('button', { type: 'button', class: 'ctp-mod', 'aria-pressed': String(!!doc.modifiers[m.id] || (doc.modifiers[m.id] === undefined && m.default)), title: pick(m.help) || null, 'data-mod': m.id,
        onclick: (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; doc.modifiers = { ...doc.modifiers, [m.id]: on }; e.currentTarget.setAttribute('aria-pressed', String(on)); save(); render(true); } }, pick(m.label))),
      ...tpl.levels.map((l) => h('span', { class: 'ct-f-seg', role: 'group', 'aria-label': pick(l.label), title: pick(l.label) },
        l.options.map((x) => h('button', { type: 'button', 'data-level': l.id + ':' + x.v, 'aria-pressed': String((doc.levels[l.id] || l.default) === x.v),
          onclick: () => { doc.levels = { ...doc.levels, [l.id]: x.v }; save(); chrome(); render(true); } }, pick(x.label))))));
    tabs.replaceChildren(...['form', 'doc'].map((k) => h('button', { type: 'button', 'aria-pressed': String(tab === k), onclick: () => { tab = k; main.dataset.tab = k; chrome(); fit(); } }, T('pg.' + k))));
    foot.textContent = T('pg.made');
    side.querySelector('.ctp-hint').textContent = T('pg.hint') + ' ' + T('pg.saved') + '.';
  }

  function issuesView(list) {
    issuesBox.hidden = false;
    issuesBox.replaceChildren(h('b', {}, T('pg.issues')), list.length ? h('ul', {}, list.map((x) => h('li', { class: x.level === 'warning' ? 'ctp-w' : 'ctp-e', onclick: () => { if (x.field && form) { tab = 'form'; main.dataset.tab = 'form'; form.focusField(x.field); } } }, (x.label ? x.label + ': ' : '') + x.message))) : h('div', {}, T('pg.ok')));
  }

  // Two-pass render: pass 1 produces `used` and the env needed by the built-in checks; if checks produce marks, pass
  // 2 re-renders with highlights. Cheaper alternatives (patching classes into the DOM) would need stable node ids.
  // innerHTML is safe here because renderContract escapes every value (escapeHTML/escapeAttr) and template texts are
  // parsed by syntax.js, never inserted raw.
  // The user validator runs debounced (350 ms) in a Worker with a 1500 ms timeout; `vseq` drops results of stale
  // runs that finish after a newer edit (classic out-of-order async response). render(false) on new results avoids
  // an infinite validate -> render -> validate loop; the JSON comparison skips a re-render when nothing changed.
  function render(validateUser) {
    const r = renderContract(tpl, doc, { lang, second, today: today(), marks: marksOf(userIssues), chips: true });
    const builtIn = validateDoc(tpl, doc, { lang, used: r.used, today: today(), env: r.env });
    const marks = marksOf([...builtIn, ...userIssues]);
    const r2 = Object.keys(marks).length ? renderContract(tpl, doc, { lang, second, today: today(), marks, chips: true }) : r;
    sheet.innerHTML = r2.html;
    const all = [...builtIn, ...userIssues].map((x) => ({ ...x, label: labelFor(x.field) }));
    issuesView(all);
    const opts = { tpl, doc, lang, used: r.used, issues: all, env: r.env, onChange };
    if (!form) form = mountForm(formHost, opts); else form.update(opts);
    if (validateUser && tpl.validator.trim()) {
      clearTimeout(vtimer);
      vtimer = setTimeout(async () => {
        const n = ++vseq;
        const res = await runUserValidator(tpl.validator, r.env.snapshot(), { lang, modifiers: r.env.modifiers(), levels: r.env.levels() }, { timeout: 1500 });
        if (n !== vseq) return;
        const extra = res.timedOut ? [{ field: '', level: 'warning', code: 'timeout', message: T('v.timeout', { n: 1500 }) }] : res.error ? [{ field: '', level: 'warning', code: 'user', message: T('v.user', { m: res.error }) }] : [];
        const next = [...res.issues, ...extra];
        if (JSON.stringify(next) !== JSON.stringify(userIssues)) { userIssues = next; render(false); }
      }, 350);
    }
    fit();
  }
  // Worst level wins per field (error is sticky over warning).
  // KNOWN DEFECT: the mark key is the first path segment, but renderPlaceholder looks marks up by the full resolved
  // field id; for dotted field ids ('tenant.name') the key 'tenant' never matches, so their placeholders are never
  // highlighted. Fix: key by resolvePath(byId, x.field)?.id instead of x.field.split('.')[0].
  const marksOf = (list) => { const m = {}; for (const x of list) { if (!x.field) continue; const id = x.field.split('.')[0]; if (m[id] !== 'error') m[id] = x.level; } return m; };
  const labelFor = (id) => { if (!id) return ''; const f = tpl.fields.find((x) => x.id === id || id.startsWith(x.id + '.')); return f ? pick(f.label) || f.id : id; };

  // Save immediately (losing a keystroke on tab close is worse than a cheap localStorage write), render debounced
  // at 120 ms so fast typing does not re-render the whole contract per key.
  function onChange(id, value) {
    doc.values = { ...doc.values, [id]: value };
    save();
    clearTimeout(timer);
    timer = setTimeout(() => render(true), 120);
  }

  // Phones: the A4 sheet is scaled to the width of the screen.
  // mm -> CSS px at the CSS reference 96 px/in (25.4 mm). The zoom is exported as a custom property consumed only by
  // the <=900px media query in pageCSS, so desktop layout is untouched. Floor 0.3: below that text is unreadable
  // and horizontal scroll is the lesser evil.
  function fit() {
    const w = stage.clientWidth;
    const sw = ((PAGE_SIZES[tpl.page.size] || PAGE_SIZES.A4).w * 96) / 25.4;
    document.documentElement.style.setProperty('--ctp-zoom', w && sw && w < sw ? String(Math.max(0.3, (w - 8) / sw)) : '1');
  }
  window.addEventListener('resize', fit);
  // One delegated listener for every chip: the sheet's innerHTML is replaced on each render, so per-chip listeners
  // would be lost (and leak) on every keystroke.
  sheet.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('[data-f]');
    if (chip && form) { tab = 'form'; main.dataset.tab = 'form'; chrome(); form.focusField(chip.dataset.f); }
  });
  chrome();
  render(true);
  return { get doc() { return doc; }, render };
}
