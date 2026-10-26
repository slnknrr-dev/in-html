// agreement-constructor/main.js - Agreement Constructor: the page. A bar of modifier buttons above three panes: the
// library and the outline (nav.js), the live A4 contract with in-place editing (editor.js), the fields extracted from
// the template text and the JS validator (side.js). Templates and documents live in IndexedDB (store.js); a document
// refers to the version of its template; the contract logic is the contract/ library. This module owns the state
// transitions (values, modifiers, levels, languages, template edits with versioning, autosave), the actions of the
// bar (new, import, export, compile to one HTML file, print) and the render cycle.
//
// Core model and the decisions behind it:
// - Documents pin a template version (doc.templateId + doc.templateVersion; snapshots in store.versions). Editing a
//   template that other documents use bumps its version first (copy-on-write, see changeTemplate), so a signed or
//   sent contract never changes its wording behind the user's back; old documents open read-only with an "update"
//   banner. This is the legal-document equivalent of immutable releases.
// - One render cycle (A.refresh): render the contract, run the built-in validation, re-render once more with field
//   marks if there are issues, then let the panes paint from S.result. Rendering twice is simpler than threading
//   validation into the renderer and is cheap at contract sizes.
// - The template's own JavaScript validator is untrusted code (templates are imported from files): it runs in a
//   sandboxed worker with a 1.5 s timeout (contract/validate.js runUserValidator), never in the page.
// - Autosave: a single debounced persist (600 ms) writes whatever is dirty; it is flushed before switching documents
//   and when the page is hidden, so quick navigation never loses the last keystrokes.

import './strings.js';
import { startApp, download } from '../ui/app.js';
import { h, debounce, lsGet, lsSet } from '../ui/dom.js';
import { pickFiles, safeFileName } from '../ui/files.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { confirmDialog, openMenu, promptDialog, toast } from '../ui/overlays.js';
import { langLabel } from '../ui/lang.js';
import { exportJSON, newDocument, newTemplate, normalizeDoc, normalizeTemplate, parseImport } from '../contract/model.js';
import { renderContract } from '../contract/render.js';
import { syncFields } from '../contract/fields.js';
import { runUserValidator, validateDoc } from '../contract/validate.js';
import { compileStatic, compileTemplate } from '../contract/compile.js';
import { formCSS, paperCSS } from '../contract/css.js';
import { isoDate } from '../contract/dates.js';
import { SAMPLES } from '../contract/samples.js';
import { uid } from '../util/id.js';
import { openStore } from './store.js';
import { A, S, pick } from './state.js';
import { mountNav } from './nav.js';
import { mountEditor } from './editor.js';
import { mountSide } from './side.js';
import { compileDialog, languagesDialog, templateDialog } from './dialogs.js';
import { pageRuntime } from './bundles.js';

const LOGO = 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6M10 8h2';
addIcons({ agreement: LOGO, toggleOn: 'M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7zM16 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', compile: 'M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2M9 9l3 3-3 3M13 15h3' });
// Deployment mode injected by the build; serverless and dev builds may load the page runtime over the network.
const mode = (globalThis.IN_HTML_ARTIFACT && globalThis.IN_HTML_ARTIFACT.mode) || 'dev';
// Today as a local calendar date (not toISOString, which is UTC and can be yesterday or tomorrow).
const today = () => { const d = new Date(); return isoDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); };
const nowISO = () => new Date().toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));
// A debounced call that can also run at once (before switching documents, before the page goes away).
// Like debounce, plus flush(): run the pending call now (used before navigation and on hide).
function later(fn, ms) {
  let tm = null;
  const d = () => { clearTimeout(tm); tm = setTimeout(() => { tm = null; fn(); }, ms); };
  d.flush = () => { if (tm) { clearTimeout(tm); tm = null; fn(); } };
  return d;
}

const main = document.getElementById('main');
startApp({ key: 'ac', name: 'app.name', logo: LOGO, offline: mode === 'offline' ? true : 'serverless', onLang: () => { if (!nav) return; renderBar(); renderTabs(); nav.renderLibrary(); A.refresh(); } });

// --- layout --------------------------------------------------------------------------------------------------
const bar = h('div', { class: 'ac-bar', id: 'ac-bar', role: 'toolbar', 'aria-label': t('ac.bar') });
const tabs = h('nav', { class: 'ac-tabs', 'aria-label': t('ac.panes') });
const navPane = h('aside', { class: 'ac-pane ac-nav', id: 'ac-nav', 'aria-label': t('ac.library') });
const docPane = h('section', { class: 'ac-pane ac-doc', id: 'ac-doc', 'aria-label': t('ac.contract') });
const sidePane = h('aside', { class: 'ac-pane ac-side', id: 'ac-side', 'aria-label': t('ac.fields') });
const grid = h('div', { class: 'ac-grid', 'data-tab': S.tab }, navPane, docPane, sidePane);
// The paper/form CSS of contract/css.js is injected into one <style> and refreshed per render, because page size,
// font and margins are template settings.
const ctStyle = h('style', { id: 'ac-ct-css' });
document.head.append(ctStyle);
main.append(bar, tabs, grid);
document.body.classList.add('ac-body');

let nav = null, editor = null, side = null;
A.renderBar = () => renderBar();

// --- render cycle --------------------------------------------------------------------------------------------
// One mark per field: an error outranks a warning; nested issue paths mark their top-level field.
const marksOf = (list) => { const m = {}; for (const x of list) { if (!x.field) continue; const id = x.field.split('.')[0]; if (m[id] !== 'error') m[id] = x.level; } return m; };

A.refresh = (o = {}) => {
  if (!S.tpl) return;
  ctStyle.textContent = paperCSS(S.tpl.page) + formCSS();
  const opts = { lang: S.lang, second: S.second, today: today(), chips: true };
  let r = renderContract(S.tpl, S.doc, opts);
  const builtIn = validateDoc(S.tpl, S.doc, { lang: S.lang, used: r.used, today: today(), env: r.env });
  S.issues = [...builtIn, ...S.userIssues];
  const marks = marksOf(S.issues);
  if (Object.keys(marks).length) r = renderContract(S.tpl, S.doc, { ...opts, marks });
  S.result = r;
  if (o.preview !== false) editor.render();
  if (o.form !== false) side.render();
  if (o.nav !== false) nav.renderOutline();
  if (o.validate !== false) runValidatorSoon();
};
const refreshSoon = debounce(() => A.refresh(), 130);
A.refreshSoon = refreshSoon;

// The template's JS validator in a worker, after the edits settle; a changed result re-renders the marks.
let vSeq = 0;
const runValidatorSoon = debounce(() => A.runValidator(), 450);
// Sequence number: only the latest validator run may apply its result (an older, slower run is discarded). Results
// are compared before re-rendering, so an unchanged result does not cause a render loop.
A.runValidator = async () => {
  if (!S.tpl || !S.result) return;
  const code = S.tpl.validator;
  const n = ++vSeq;
  if (!code.trim()) { S.userRun = { ms: 0, error: '', timedOut: false, running: false, at: Date.now() }; if (S.userIssues.length) { S.userIssues = []; A.refresh({ validate: false }); } else side.renderValidator(); return; }
  S.userRun = { ...S.userRun, running: true };
  side.renderValidator();
  const env = S.result.env;
  const res = await runUserValidator(code, env.snapshot(), { lang: S.lang, modifiers: env.modifiers(), levels: env.levels() }, { timeout: 1500 });
  if (n !== vSeq) return;
  S.userRun = { ms: res.ms, error: res.error, timedOut: res.timedOut, running: false, at: Date.now() };
  const next = res.issues;
  if (JSON.stringify(next) !== JSON.stringify(S.userIssues)) { S.userIssues = next; A.refresh({ validate: false }); }
  else side.renderValidator();
};

// --- persistence -----------------------------------------------------------------------------------------------
let dirtyTpl = false, dirtyDoc = false;
const persist = later(async () => {
  const tpl = S.tpl, doc = S.doc;
  if (!tpl) return;
  const stamp = nowISO();
  // A template opened without a document edits its sample values: those are saved into the template itself.
  if (!S.docId) {
    // The template opened by itself: its example values are part of it.
    if (dirtyDoc) { tpl.sample = { values: clone(doc.values), modifiers: clone(doc.modifiers), levels: clone(doc.levels) }; dirtyTpl = true; }
  } else if (dirtyDoc || dirtyTpl) {
    doc.templateId = tpl.id;
    doc.templateVersion = tpl.version;
    doc.updated = stamp;
    await S.store.docs.put(doc);
    // The exact version the document was filled with is stored as a snapshot (read-only documents of old versions
    // never write).
    if (!S.oldVersion) await S.store.versions.put(tpl);
    const i = S.docs.findIndex((d) => d.id === doc.id);
    if (i >= 0) S.docs[i] = clone(doc); else S.docs.push(clone(doc));
  }
  if (dirtyTpl && !S.oldVersion) {
    tpl.updated = stamp;
    await S.store.templates.put(tpl);
    const i = S.templates.findIndex((x) => x.id === tpl.id);
    if (i >= 0) S.templates[i] = clone(tpl); else S.templates.push(clone(tpl));
  }
  dirtyTpl = dirtyDoc = false;
  nav.renderLibrary();
  side.renderSaved(stamp);
}, 600);
const saveDoc = () => { dirtyDoc = true; persist(); };

// Values are replaced immutably ({ ...values, [id]: v }) so render inputs from a previous cycle are never mutated.
A.setValue = (id, v) => { S.doc.values = { ...S.doc.values, [id]: v }; saveDoc(); refreshSoon(); };
A.setModifier = (id, on) => { S.doc.modifiers = { ...S.doc.modifiers, [id]: on }; saveDoc(); renderBar(); A.refresh(); };
A.setLevel = (id, v) => { S.doc.levels = { ...S.doc.levels, [id]: v }; saveDoc(); renderBar(); A.refresh(); };
A.setLang = (l) => { S.lang = l; S.doc.lang = l; if (S.second === l) S.second = ''; saveDoc(); renderBar(); A.refresh(); };
A.setSecond = (l) => { S.second = l; renderBar(); A.refresh(); };
A.setEdit = (on) => {
  if (on && S.oldVersion) { toast(t('ac.oldVersionEdit'), 'warn'); return; }
  S.edit = !!on;
  lsSet('ac-edit', S.edit);
  renderBar();
  A.refresh({ form: false, nav: false, validate: false });
};

// Placeholders written into the text become fields (contract/fields.js syncFields). While a clause is being typed
// this waits for a pause, so half-typed names ({{ren}} on the way to {{rent2}}) never become fields.
// syncFields adds a field definition for every new {{placeholder}} in the text and reports fields no text uses.
function addExtracted(tpl) {
  const sync = syncFields(tpl, { lang: S.lang });
  S.unused = sync.unused;
  if (!sync.added.length) return tpl;
  S.added = [...new Set([...S.added, ...sync.added])];
  toast(t('ac.fieldsAdded', { n: sync.added.length, list: sync.added.join(', ') }), 'ok');
  return normalizeTemplate(sync.template);
}
// 1.4 s pause before extracting while typing: shorter would create fields for half-typed names.
const extractSoon = debounce(() => {
  if (!S.tpl || S.oldVersion) return;
  const next = addExtracted(S.tpl);
  if (next === S.tpl) return;
  S.tpl = next;
  dirtyTpl = true;
  persist();
  A.refresh({ preview: !S.edit });
}, 1400);

// Template edits: `fn(tpl)` mutates a copy. A version that another document refers to is never changed in place:
// the template moves on to a new version.
A.changeTemplate = (fn, o = {}) => {
  if (S.oldVersion) { toast(t('ac.oldVersionEdit'), 'warn'); return; }
  const next = clone(S.tpl);
  fn(next);
  let tpl = normalizeTemplate(next);
  if (o.quiet) extractSoon(); else tpl = addExtracted(tpl);
  // Copy-on-write versioning, decided once per opened item (versionOwned): if any other document points at this exact
  // version, the edit goes into version + 1 and this document moves along; the old version stays for the others.
  if (!S.versionOwned) {
    const others = S.docs.some((d) => d.templateId === tpl.id && d.templateVersion === tpl.version && d.id !== S.docId);
    if (others) tpl.version += 1;
    S.versionOwned = true;
  }
  S.tpl = tpl;
  if (!S.tpl.langs.includes(S.lang)) S.lang = S.tpl.main;
  if (S.second && !S.tpl.langs.includes(S.second)) S.second = '';
  dirtyTpl = true;
  if (S.docId) dirtyDoc = true;
  persist();
  if (o.bar !== false) renderBar();
  if (o.now) A.refresh(o.refresh || {});
  else if (o.quiet) refreshSoonQuiet();
  else refreshSoon();
};
// While a clause is being typed, the paper keeps its editors: only the fields pane and the outline follow.
const refreshSoonQuiet = debounce(() => A.refresh({ preview: false }), 250);

// --- opening ---------------------------------------------------------------------------------------------------
async function loadLists() {
  S.templates = await S.store.templates.list();
  S.docs = await S.store.docs.list();
}

function enter(tpl, doc, docId, o = {}) {
  // Flush pending writes of the previous item before the state switches to the new one.
  persist.flush();
  S.tpl = tpl;
  S.doc = doc;
  S.docId = docId;
  S.lang = tpl.langs.includes(doc.lang) ? doc.lang : tpl.main;
  S.second = '';
  S.userIssues = [];
  S.added = [];
  S.unused = syncFields(tpl, { add: false }).unused;
  S.oldVersion = !!o.oldVersion;
  S.latest = o.latest || tpl.version;
  S.versionOwned = false;
  if (S.oldVersion) S.edit = false;
  S.store.meta.set('last', { kind: docId ? 'doc' : 'tpl', id: docId || tpl.id });
  renderBar();
  nav.renderLibrary();
  A.refresh();
  editor.scrollTop();
}

A.openTemplate = async (id) => {
  const tpl = await S.store.templates.get(id);
  if (!tpl) return;
  const doc = newDocument(tpl);
  doc.name = '';
  enter(tpl, doc, null);
};

A.openDoc = async (id) => {
  const doc = await S.store.docs.get(id);
  if (!doc) return;
  const latest = await S.store.templates.get(doc.templateId);
  // Prefer the latest template when it is the document's version, else the stored snapshot of that version; a missing
  // snapshot falls back to the latest template (better than refusing to open).
  let tpl = latest && latest.version === doc.templateVersion ? latest : await S.store.versions.get(doc.templateId, doc.templateVersion);
  if (!tpl) tpl = latest;
  if (!tpl) { toast(t('ac.noTemplate'), 'error'); return; }
  enter(tpl, doc, doc.id, { oldVersion: !!latest && tpl.version < latest.version, latest: latest ? latest.version : tpl.version });
};

A.updateToLatest = async () => {
  const latest = await S.store.templates.get(S.tpl.id);
  if (!latest) return;
  S.doc.templateVersion = latest.version;
  await S.store.docs.put(S.doc);
  await A.openDoc(S.doc.id);
  toast(t('ac.updated', { v: latest.version }), 'ok');
};

// A new document stores a version snapshot first, so it can always be reopened at the version it was created with.
A.newDoc = async (tplId) => {
  const tpl = await S.store.templates.get(tplId || S.tpl.id);
  if (!tpl) return;
  const doc = newDocument(tpl, { empty: true, now: nowISO() });
  doc.name = `${pick(tpl.name, tpl.main)} — ${new Date().toLocaleDateString(UI_STATE.lang)}`;
  doc.lang = tpl.main;
  await S.store.versions.put(tpl);
  await S.store.docs.put(doc);
  S.docs.push(doc);
  enter(tpl, doc, doc.id);
  toast(t('ac.docCreated'), 'ok');
};

A.newTemplate = async () => {
  const name = await promptDialog(t('ac.newTemplate'), t('ac.name'), t('ac.untitled'));
  if (name == null) return;
  const main = S.lang || 'ru';
  const tpl = newTemplate({ main: ['ru', 'en', 'uk', 'de', 'fr', 'es', 'ka'].includes(UI_STATE.lang) ? UI_STATE.lang : main, name: name || t('ac.untitled'), title: (name || t('ac.untitled')).toUpperCase(), section: t('ac.firstSection'), now: nowISO() });
  tpl.sections[0].clauses[0].text[tpl.main] = t('ac.firstClause');
  await S.store.templates.put(tpl);
  S.templates.push(tpl);
  enter(tpl, newDocument(tpl), null);
  A.setEdit(true);
};

A.duplicate = async (kind, id) => {
  if (kind === 'tpl') {
    const src = await S.store.templates.get(id);
    if (!src) return;
    const copy = normalizeTemplate({ ...clone(src), id: uid(), version: 1, builtin: false, name: Object.fromEntries(Object.entries(src.name).map(([k, v]) => [k, v + ' (' + t('ac.copy') + ')'])), created: nowISO(), updated: nowISO() });
    await S.store.templates.put(copy);
    S.templates.push(copy);
    enter(copy, newDocument(copy), null);
  } else {
    const src = await S.store.docs.get(id);
    if (!src) return;
    const copy = normalizeDoc({ ...clone(src), id: uid(), name: src.name + ' (' + t('ac.copy') + ')', created: nowISO(), updated: nowISO() });
    await S.store.docs.put(copy);
    S.docs.push(copy);
    await A.openDoc(copy.id);
  }
  toast(t('ac.duplicated'), 'ok');
};

A.rename = async (kind, id) => {
  if (kind === 'tpl') {
    const tpl = id === S.tpl.id ? S.tpl : await S.store.templates.get(id);
    const name = await promptDialog(t('ac.rename'), t('ac.name'), pick(tpl.name));
    if (!name) return;
    if (id === S.tpl.id && !S.oldVersion) { A.changeTemplate((x) => { x.name[S.lang] = name; }, { now: true }); return; }
    tpl.name[S.lang] = name;
    await S.store.templates.put(tpl);
  } else {
    const doc = id === S.docId ? S.doc : await S.store.docs.get(id);
    const name = await promptDialog(t('ac.rename'), t('ac.name'), doc.name);
    if (!name) return;
    doc.name = name;
    await S.store.docs.put(doc);
    if (id === S.docId) S.doc.name = name;
  }
  await loadLists();
  renderBar();
  nav.renderLibrary();
};

A.remove = async (kind, id) => {
  // Deleting a template keeps the documents that use it: they still open from their version snapshots.
  if (kind === 'tpl') {
    const used = S.docs.filter((d) => d.templateId === id).length;
    if (!await confirmDialog(t('ac.deleteTemplate'), used ? t('ac.deleteTemplateUsed', { n: used }) : t('ac.deleteSure'), t('dlg.delete'), true)) return;
    await S.store.templates.remove(id);
  } else {
    if (!await confirmDialog(t('ac.deleteDoc'), t('ac.deleteSure'), t('dlg.delete'), true)) return;
    await S.store.docs.remove(id);
  }
  await loadLists();
  if ((kind === 'tpl' && S.tpl.id === id && !S.docId) || (kind === 'doc' && S.docId === id)) await openFirst();
  else nav.renderLibrary();
  toast(t('ac.deleted'), 'ok');
};

// Start-up order: the last opened item, the residential lease, any template, and on an empty store re-seed the
// built-ins (a library can never be left with nothing to open).
async function openFirst() {
  const last = await S.store.meta.get('last', null);
  if (last && last.kind === 'doc' && S.docs.some((d) => d.id === last.id)) return A.openDoc(last.id);
  if (last && last.kind === 'tpl' && S.templates.some((x) => x.id === last.id)) return A.openTemplate(last.id);
  const first = S.templates.find((x) => x.id === 'lease-residential') || S.templates[0];
  if (first) return A.openTemplate(first.id);
  await seed(true);
  await loadLists();
  return A.openTemplate(S.templates[0].id);
}

// Built-in templates: added once each (a deleted one comes back only with "Restore built-in templates").
// Built-ins are seeded once per id ('seeded' meta key), so a user who deletes one does not get it back on reload.
async function seed(force) {
  const done = new Set((await S.store.meta.get('seeded', [])) || []);
  const have = new Set((await S.store.templates.list()).map((x) => x.id));
  for (const raw of SAMPLES) {
    if (have.has(raw.id) || (done.has(raw.id) && !force)) continue;
    const tpl = normalizeTemplate({ ...raw, created: nowISO(), updated: nowISO() });
    await S.store.templates.put(tpl);
    done.add(raw.id);
  }
  await S.store.meta.set('seeded', [...done]);
}
A.restoreBuiltins = async () => { await seed(true); await loadLists(); nav.renderLibrary(); toast(t('ac.restored'), 'ok'); };

// --- files -----------------------------------------------------------------------------------------------------
const baseName = () => safeFileName(S.docId ? S.doc.name : pick(S.tpl.name), 'agreement');

A.exportJSON = (what = S.docId ? 'doc' : 'tpl') => {
  if (what === 'doc') download(exportJSON(S.tpl, S.doc), baseName() + '.agreement.json', 'application/json');
  else download(exportJSON(S.tpl), safeFileName(pick(S.tpl.name), 'template') + '.template.json', 'application/json');
};

A.exportStatic = () => {
  download(compileStatic(S.tpl, S.doc, { lang: S.lang, second: S.second, today: today() }), baseName() + '.html', 'text/html');
};

A.importJSON = async () => {
  const files = await pickFiles({ accept: '.json,application/json', multiple: false });
  const f = files && files[0];
  if (!f) return;
  const res = parseImport(await f.text());
  if (res.error) { toast(t(res.error === 'json' ? 'ac.importJson' : 'ac.importFormat'), 'error'); return; }
  let tpl = res.template;
  const existing = await S.store.templates.get(tpl.id);
  // Same id with different content: keep both, unless the import is a newer version of the same template.
  if (existing && JSON.stringify({ ...existing, updated: '', created: '' }) !== JSON.stringify({ ...tpl, updated: '', created: '' })) {
    // The same id with other content: keep both (the imported one as a new template unless it is a newer version).
    if (tpl.version <= existing.version) tpl = normalizeTemplate({ ...tpl, id: uid(), builtin: false });
  }
  tpl.builtin = false;
  await S.store.templates.put(tpl);
  await S.store.versions.put(tpl);
  if (res.doc) {
    const doc = normalizeDoc({ ...res.doc, id: S.docs.some((d) => d.id === res.doc.id) ? uid() : res.doc.id, templateId: tpl.id, templateVersion: tpl.version, updated: nowISO() });
    await S.store.docs.put(doc);
    await loadLists();
    await A.openDoc(doc.id);
  } else {
    await loadLists();
    enter(tpl, newDocument(tpl), null);
  }
  toast(t('ac.imported'), 'ok');
};

A.compile = async () => {
  const o = await compileDialog();
  if (!o) return;
  try {
    // Compile = a standalone HTML contract with its form and the page runtime embedded (see bundles.js), usable
    // without this app.
    const runtime = await pageRuntime();
    const html = compileTemplate(S.tpl, { lang: o.lang, runtime, withSample: o.sample, doc: o.current ? S.doc : null, today: today() });
    download(html, safeFileName(pick(S.tpl.name, o.lang), 'template') + '.html', 'text/html');
    toast(t('ac.compiled', { kb: Math.round(html.length / 1024) }), 'ok');
  } catch (e) {
    toast(t('ac.compileFail', { msg: e.message }), 'error');
  }
};

A.print = () => {
  // Print the reading view, not the editors (app.css @media print hides everything but the paper).
  if (S.edit) A.setEdit(false);
  setTimeout(() => window.print(), 60);
};

A.focusField = (id) => { if (matchMedia('(max-width: 900px)').matches) setTab('fields'); side.focusField(id); };
A.jump = (id) => { if (matchMedia('(max-width: 900px)').matches) setTab('doc'); editor.jump(id); };

// --- the bar of modifiers and actions --------------------------------------------------------------------------
function renderBar() {
  const tpl = S.tpl;
  bar.replaceChildren();
  if (!tpl) return;
  const title = h('input', { class: 'ed-input ac-title', 'aria-label': t('ac.name'), title: S.docId ? t('ac.docName') : t('ac.tplName'), value: S.docId ? S.doc.name : pick(tpl.name) });
  title.addEventListener('change', () => {
    const v = title.value.trim();
    if (!v) return;
    if (S.docId) { S.doc.name = v; saveDoc(); nav.renderLibrary(); }
    else A.changeTemplate((x) => { x.name[S.lang] = v; }, { bar: false });
  });
  const kind = h('span', { class: 'ac-kind', title: S.docId ? t('ac.kindDoc') : t('ac.kindTpl') }, iconEl(S.docId ? 'doc' : 'template'));
  const mods = tpl.modifiers.map((m) => {
    // Modifier buttons are toggles (aria-pressed), levels are radio groups; both write to the document, not the template.
    const on = S.doc.modifiers[m.id] ?? m.default;
    return h('button', { type: 'button', class: 'ac-mod' + (on ? ' ac-on' : ''), 'aria-pressed': String(!!on), 'data-mod': m.id, title: pick(m.help) || pick(m.label), onclick: () => A.setModifier(m.id, !on) }, pick(m.label) || m.id);
  });
  const levels = tpl.levels.map((l) => {
    const cur = S.doc.levels[l.id] || l.default;
    return h('div', { class: 'ed-seg ac-level', role: 'radiogroup', 'aria-label': pick(l.label), title: pick(l.label), 'data-level': l.id },
      l.options.map((x) => h('button', { type: 'button', class: 'ed-seg-btn' + (x.v === cur ? ' ed-on' : ''), role: 'radio', 'aria-checked': String(x.v === cur), 'data-v': x.v, onclick: () => A.setLevel(l.id, x.v) }, pick(x.label) || x.v)));
  });
  const langSel = h('select', { class: 'ed-input ed-select ac-lang', title: t('ac.contractLang'), 'aria-label': t('ac.contractLang') },
    tpl.langs.map((l) => h('option', { value: l }, langLabel(l) + (l === tpl.main ? ' ★' : ''))));
  langSel.value = S.lang;
  langSel.addEventListener('change', () => A.setLang(langSel.value));
  // Side-by-side mode renders a second language next to the main one (bilingual contracts are common in Georgia).
  const secondSel = tpl.langs.length > 1 ? h('select', { class: 'ed-input ed-select ac-lang', title: t('ac.sideBySide'), 'aria-label': t('ac.sideBySide') },
    h('option', { value: '' }, t('ac.single')), tpl.langs.filter((l) => l !== S.lang).map((l) => h('option', { value: l }, '⇆ ' + langLabel(l)))) : null;
  if (secondSel) { secondSel.value = S.second; secondSel.addEventListener('change', () => A.setSecond(secondSel.value)); }
  const btn = (key, ic, fn, cls = '') => h('button', { type: 'button', class: 'ed-btn ed-sm ' + cls, title: t(key), 'aria-label': t(key), onclick: fn }, iconEl(ic), h('span', { class: 'ac-bl' }, t(key)));
  const editBtn = h('button', { type: 'button', class: 'ed-btn ed-sm' + (S.edit ? ' ed-primary' : ''), 'aria-pressed': String(S.edit), title: t('ac.editText'), onclick: () => A.setEdit(!S.edit), id: 'ac-edit' }, iconEl('edit'), h('span', { class: 'ac-bl' }, t('ac.editText')));
  const more = h('button', { type: 'button', class: 'ed-btn ed-sm', title: t('ac.more'), 'aria-label': t('ac.more'), 'aria-haspopup': 'menu' }, iconEl('more'));
  more.addEventListener('click', () => openMenu(more, [
    { label: t('ac.exportTpl'), icon: 'download', action: () => A.exportJSON('tpl') },
    S.docId ? { label: t('ac.exportDoc'), icon: 'download', action: () => A.exportJSON('doc') } : null,
    { label: t('ac.exportStatic'), icon: 'file', action: A.exportStatic },
    { label: t('ac.import'), icon: 'upload', action: A.importJSON },
    { sep: true },
    { label: t('ac.languages'), icon: 'languages', action: () => languagesDialog() },
    { label: t('ac.templateSettings'), icon: 'settings', action: () => templateDialog() },
  ], { label: t('ac.more') }));
  const newBtn = h('button', { type: 'button', class: 'ed-btn ed-sm', title: t('ac.new'), 'aria-haspopup': 'menu' }, iconEl('filePlus'), h('span', { class: 'ac-bl' }, t('ac.new')));
  newBtn.addEventListener('click', () => openMenu(newBtn, [
    { header: true, label: t('ac.newDocFrom') },
    ...S.templates.slice().sort((a, b) => (b.builtin - a.builtin) || pick(a.name).localeCompare(pick(b.name))).map((x) => ({ label: pick(x.name, x.main), icon: 'doc', action: () => A.newDoc(x.id) })),
    { sep: true },
    { label: t('ac.newTemplate'), icon: 'template', action: A.newTemplate },
    { label: t('ac.duplicateTpl'), icon: 'copy', action: () => A.duplicate('tpl', S.tpl.id) },
  ], { label: t('ac.new') }));
  const banner = S.oldVersion ? h('div', { class: 'ac-banner' }, iconEl('info'), h('span', {}, t('ac.oldVersion', { v: S.tpl.version, n: S.latest })), h('button', { type: 'button', class: 'ed-btn ed-sm ed-primary', onclick: A.updateToLatest }, t('ac.update'))) : null;
  bar.append(
    h('div', { class: 'ac-bar-row' }, kind, title, h('span', { class: 'ac-ver', title: t('ac.version') }, 'v' + tpl.version), h('span', { class: 'ed-spacer' }),
      newBtn, btn('ac.import', 'upload', A.importJSON, 'ac-hide-s'), editBtn, btn('ac.compile', 'compile', A.compile), btn('ac.print', 'print', A.print), more),
    h('div', { class: 'ac-bar-row ac-mods' }, mods, levels, h('span', { class: 'ed-spacer' }), langSel, secondSel));
  if (banner) bar.append(banner);
}

function setTab(k) {
  S.tab = k;
  grid.dataset.tab = k;
  for (const b of tabs.children) { const on = b.dataset.k === k; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('ed-on', on); }
  if (k === 'doc') editor.fit();
}
function renderTabs() {
  tabs.replaceChildren(...[['nav', 'folder', 'ac.library'], ['doc', 'doc', 'ac.contract'], ['fields', 'sliders', 'ac.fields']].map(([k, ic, key]) =>
    h('button', { type: 'button', class: 'ac-tab' + (S.tab === k ? ' ed-on' : ''), 'data-k': k, 'aria-pressed': String(S.tab === k), onclick: () => setTab(k) }, iconEl(ic), h('span', {}, t(key)))));
}

// --- start -----------------------------------------------------------------------------------------------------
(async () => {
  S.store = await openStore();
  S.edit = !!lsGet('ac-edit', false);
  nav = mountNav(navPane);
  editor = mountEditor(docPane);
  side = mountSide(sidePane);
  renderTabs();
  await seed(false);
  await loadLists();
  await openFirst();
  // beforeunload cannot await IndexedDB, so a write started there may not finish; the visibilitychange flush, which
  // fires earlier (when the tab is hidden), is the reliable save point.
  window.addEventListener('beforeunload', () => persist.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist.flush(); });
  // Debug/test hook: e2e.js reads state through window.__ac.
  window.__ac = { S, A }; // inspection hook for checks
})();

