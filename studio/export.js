// studio/export.js - the export dialog: options (clean / packed, minify, source, languages), size and tree-shaking
// report, download and preview; the product's packages (ED.exportModes: archives…) and its check before a download
// (ED.exportCheck).
//
// Model: o = the dialog's UI state (persisted subset in localStorage, per-document part in S.exportOpts);
// exportOptsFor(o) = the pure option object the exporter receives. Keeping them apart lets the UI remember things the
// exporter must not see (excluded languages, file name) and gives a canonical object to key the build cache on.
// Live report: every option change re-runs the real export (debounced 250 ms) and shows its true byte breakdown,
// so the size the user sees is the size they download, never an estimate.
import { exportHTML } from '../doc/export.js';
import { $$, clone, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { downloadBlob, fmtBytes, safeFileName } from '../ui/files.js';
import { iconEl } from '../ui/icons.js';
import { langLabel } from '../ui/lang.js';
import { t } from '../ui/i18n.js';
import { openDialog, toast } from '../ui/overlays.js';
import { S, edKey } from './state.js';
import { eachI18n, fullDoc, walk } from './doc.js';
import { flushRT } from './history.js';
import { fid, radioRoving } from './fields.js';
import { openPreview } from './preview.js';
import { ED } from './config.js';

// ===========================================================================
// 24. Export dialog (live size & tree-shaking report)
// ===========================================================================

// Export packages of the product (ED.exportModes); [] = only the built-in single HTML file.
const exportModes = () => (Array.isArray(ED.exportModes) ? ED.exportModes.filter((m) => m && typeof m.id === 'string') : []);
const modeOf = (id) => exportModes().find((m) => m.id === id) || exportModes()[0] || { id: 'html' };

function exportDefaults() {
  const saved = lsGet(edKey('export'), {}) || {};
  return {
    mode: saved.mode === 'packed' ? 'packed' : 'clean',
    minify: saved.minify !== false,
    embedSource: !!saved.embedSource,
    stripHidden: !!saved.stripHidden, // embedded source without hidden blocks (default: keep them for re-editing)
    excluded: [],                 // languages switched off by the user (new document languages are included)
    defaultLang: S.doc.defaultLang,
    docDefault: S.doc.defaultLang, // document default when defaultLang was chosen
    file: safeFileName(S.doc.name) + '.html',
    target: modeOf(saved.target).id, // package (ED.exportModes)
    extra: saved.extra && typeof saved.extra === 'object' ? { ...saved.extra } : {}, // package switches
  };
}

// Options a package does not support are forced off here (packed: false, source: false), not only hidden in the
// UI: a persisted value from another package must never leak into this one's build.
function exportOptsFor(o) {
  const langs = S.doc.langs.filter((l) => o.langs.includes(l));
  const m = modeOf(o.target);
  const packed = m.packed !== false && o.mode === 'packed';
  const embed = m.source !== false && !!o.embedSource;
  const opts = {
    mode: packed ? 'packed' : 'clean', minify: o.minify, embedSource: embed, langs,
    defaultLang: langs.includes(o.defaultLang) ? o.defaultLang : langs[0],
    stripHidden: !!(embed && o.stripHidden),
  };
  // Packages other than the built-in file carry their id and switches; the built-in file carries its switches only
  // when the product gave it some (its other options stay as they were).
  if (m.build) { opts.target = m.id; opts.extra = { ...(o.extra || {}) }; }
  else if (Array.isArray(m.options) && m.options.length) opts.extra = { ...(o.extra || {}) };
  return opts;
}

// The editable source embedded in an export. Exporting every language keeps the whole project. A language
// subset (or opts.stripHidden) gets a pruned copy: texts of the other languages are dropped, blocks shown only in
// those languages are removed (hidden blocks too with stripHidden), and files no longer referenced by any
// block, text link or font (or kept by the product: ED.keepAttachment, e.g. listed in an appendix) are left out.
function exportSource(doc, opts) {
  const subset = opts.langs.length < doc.langs.length;
  if (!subset && !opts.stripHidden) return doc;
  const d = clone(doc);
  const keep = new Set(opts.langs);
  if (subset) {
    eachI18n(d, (o) => { for (const k of Object.keys(o)) if (!keep.has(k)) delete o[k]; });
    d.langs = d.langs.filter((l) => keep.has(l));
    d.defaultLang = d.langs.includes(opts.defaultLang) ? opts.defaultLang : d.langs[0];
  }
  const drop = [];
  walk((b, list) => {
    if (opts.stripHidden && b.hidden) { drop.push([list, b]); return; }
    if (subset && Array.isArray(b.langs)) {
      const ls = b.langs.filter((l) => keep.has(l));
      if (b.langs.length && !ls.length) { drop.push([list, b]); return; }
      b.langs = ls.length && ls.length < d.langs.length ? ls : null;
    }
  }, d);
  for (const [list, b] of drop) { const i = list.indexOf(b); if (i >= 0) list.splice(i, 1); }
  // Reference test by substring over the serialised document: catches every reference form (fields, fonts, links
  // in rich text, product data) without knowing them. False positives only keep a file; ids are random, so a false
  // negative is impossible and an accidental match practically so.
  const hay = JSON.stringify({ ...d, attachments: null });
  for (const [id, a] of Object.entries(d.attachments || {})) {
    if (!(ED.keepAttachment && a && ED.keepAttachment(a)) && !hay.includes(id)) delete d.attachments[id];
  }
  return d;
}

// The exported page (a package's own page when it has one). doc: the document to export (default: the project).
async function runExport(o, doc = null) {
  flushRT();
  const d = doc || fullDoc();
  const opts = exportOptsFor(o);
  const m = modeOf(o.target);
  const full = { ...opts, source: opts.embedSource ? exportSource(d, opts) : d };
  if (m.build && typeof m.page === 'function') return m.page(d, full);
  return exportHTML(d, full);
}

// '<name>.<ext>' from a user-typed file name (falls back to the project name); ext: 'html' or a package's extension.
// ext is product-supplied: whitelisted to 1-8 alphanumerics so it cannot inject path separators or a double extension.
function exportFileName(raw, ext = 'html') {
  const x = /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'html';
  return safeFileName(String(raw || '').replace(/\.(html?|zip)$/i, ''), safeFileName(S.doc.name)) + '.' + x;
}

function openExport() {
  flushRT();
  // Already open (e.g. under the preview): bring it forward instead of stacking a second one.
  const openDlg = $$('#ed-overlays .ed-dlg-export').find((x) => !x.closest('.ed-out'));
  if (openDlg) { try { openDlg.focus(); } catch { /* ignore */ } return; }
  const o = S.exportOpts && S.exportOpts.docId === S.doc.id ? S.exportOpts : { ...exportDefaults(), docId: S.doc.id };
  // Exclusions are remembered (not inclusions), so languages added since last time are exported too.
  o.excluded = (o.excluded || []).filter((l) => S.doc.langs.includes(l));
  o.langs = S.doc.langs.filter((l) => !o.excluded.includes(l));
  if (!o.langs.length) { o.excluded = []; o.langs = S.doc.langs.slice(); }
  // The document's default language changed since the options were made: follow it.
  if (o.docDefault !== S.doc.defaultLang) { o.defaultLang = S.doc.defaultLang; o.docDefault = S.doc.defaultLang; }
  S.exportOpts = o;
  o.target = modeOf(o.target).id;
  if (!o.extra || typeof o.extra !== 'object') o.extra = {};
  const persist = () => lsSet(edKey('export'), { mode: o.mode, minify: o.minify, embedSource: o.embedSource, stripHidden: !!o.stripHidden,
    target: o.target, extra: o.extra });

  const body = h('div', { class: 'ed-export' });
  const left = h('div', { class: 'ed-export-opts ed-fields' });
  const report = h('div', { class: 'ed-export-report', 'aria-live': 'polite' });
  body.append(left, report);

  // Packages (ED.exportModes): the single HTML file, archives… Each one shows only the options it uses.
  const modes = exportModes();
  const extraBox = h('div', { class: 'ed-fields ed-export-extra' });
  let syncMode = () => {};
  if (modes.length > 1) {
    const cards = h('div', { class: 'ed-mode-cards ed-target-cards', role: 'radiogroup', 'aria-label': t('ex.target') }, modes.map((m) => h('button', {
      type: 'button', role: 'radio', class: 'ed-mode-card' + (o.target === m.id ? ' ed-on' : ''), 'aria-checked': String(o.target === m.id), dataset: { target: m.id },
      onclick: (e) => {
        o.target = m.id; persist();
        for (const c of cards.children) { c.classList.remove('ed-on'); c.setAttribute('aria-checked', 'false'); }
        e.currentTarget.classList.add('ed-on'); e.currentTarget.setAttribute('aria-checked', 'true');
        syncMode();
        update();
      },
    }, h('strong', {}, m.icon ? iconEl(m.icon) : null, t(m.label || 'ex.target')), m.desc ? h('small', {}, t(m.desc)) : null)));
    radioRoving(cards);
    left.append(h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ex.target')), cards));
  }

  const modeCards = h('div', { class: 'ed-mode-cards', role: 'radiogroup', 'aria-label': t('ex.mode') }, ['clean', 'packed'].map((m) => h('button', {
    type: 'button', role: 'radio', class: 'ed-mode-card' + (o.mode === m ? ' ed-on' : ''), 'aria-checked': String(o.mode === m),
    onclick: (e) => {
      o.mode = m; persist();
      for (const c of modeCards.children) { c.classList.remove('ed-on'); c.setAttribute('aria-checked', 'false'); }
      e.currentTarget.classList.add('ed-on'); e.currentTarget.setAttribute('aria-checked', 'true');
      update();
    },
  }, h('strong', {}, t('o.' + m)), h('small', {}, t(m === 'clean' ? 'ex.cleanD' : 'ex.packedD')))));
  radioRoving(modeCards);
  const packRow = h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ex.mode')), modeCards);
  left.append(packRow);

  const chk = (key, label, desc, obj = o) => {
    const id = fid();
    const cb = h('input', { type: 'checkbox', id, class: 'ed-switch', role: 'switch', checked: !!obj[key], onchange: (e) => { obj[key] = e.target.checked; persist(); update(); } });
    return h('div', { class: 'ed-field ed-field-check' }, cb, h('label', { for: id, class: 'ed-label' }, label, desc ? h('small', { class: 'ed-muted ed-block' }, desc) : null));
  };
  const embedRow = chk('embedSource', t('ex.embed'), t('ex.embedD'));
  const stripRow = chk('stripHidden', t('ex.stripHidden'), t('ex.stripHiddenD'));
  stripRow.classList.add('ed-sub');
  stripRow.hidden = !o.embedSource;
  embedRow.querySelector('input').addEventListener('change', () => { stripRow.hidden = !o.embedSource || modeOf(o.target).source === false; });
  left.append(chk('minify', t('ex.minify')), embedRow, stripRow, extraBox);

  const langBox = h('div', { class: 'ed-chips' });
  const defSel = h('select', { class: 'ed-input ed-select', 'aria-label': t('ex.defaultLang') });
  const fillLangs = () => {
    langBox.textContent = '';
    for (const l of S.doc.langs) {
      const on = o.langs.includes(l);
      langBox.append(h('button', {
        type: 'button', class: 'ed-chip' + (on ? ' ed-on' : ''), 'aria-pressed': String(on), title: langLabel(l),
        onclick: () => {
          if (on && o.langs.length <= 1) { toast(t('ex.needLang'), 'warn'); return; }
          o.excluded = on ? [...o.excluded.filter((x) => x !== l), l] : o.excluded.filter((x) => x !== l);
          o.langs = S.doc.langs.filter((x) => !o.excluded.includes(x));
          fillLangs();
          update();
        },
      }, `${l.toUpperCase()} · ${langLabel(l)}`));
    }
    defSel.textContent = '';
    for (const l of o.langs) defSel.append(h('option', { value: l }, langLabel(l)));
    if (!o.langs.includes(o.defaultLang)) o.defaultLang = o.langs.includes(S.doc.defaultLang) ? S.doc.defaultLang : o.langs[0];
    defSel.value = o.defaultLang;
  };
  defSel.addEventListener('change', () => { o.defaultLang = defSel.value; update(); });
  fillLangs();
  left.append(h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ex.langs')), langBox));
  left.append(h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ex.defaultLang')), defSel));
  const fileInp = h('input', { type: 'text', class: 'ed-input', value: o.file, spellcheck: 'false', 'aria-label': t('ex.file') });
  fileInp.addEventListener('input', () => { o.file = fileInp.value; });
  left.append(h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ex.file')), fileInp));

  // Options of the chosen package: clean / packed and the embedded source only where they apply, its own switches,
  // the file extension.
  syncMode = () => {
    const m = modeOf(o.target);
    packRow.hidden = m.packed === false;
    embedRow.hidden = m.source === false;
    stripRow.hidden = m.source === false || !o.embedSource;
    extraBox.textContent = '';
    for (const x of Array.isArray(m.options) ? m.options : []) if (x && x.key) extraBox.append(chk(x.key, t(x.label), x.desc ? t(x.desc) : '', o.extra));
    extraBox.hidden = !extraBox.childElementCount;
    fileInp.value = exportFileName(fileInp.value, m.ext || 'html');
    o.file = fileInp.value;
  };
  syncMode();

  // Concurrency: seq discards results of superseded updates (last writer wins on screen); running dedupes identical
  // in-flight builds; last caches the newest finished build so Download reuses it when nothing changed. S.gen in the
  // key invalidates the cache after any document edit (another tab of the UI can edit underneath the dialog).
  let seq = 0;
  let last = null;      // {key, res} of the newest finished build
  let running = null;   // {key, p} of the build in flight
  // Everything the exported file depends on: options + package + document edit generation.
  const keyOf = () => JSON.stringify(exportOptsFor(o)) + '|' + o.target + '|' + S.gen;
  const build = () => {
    const key = keyOf();
    if (running && running.key === key) return running.p;
    const p = runExport(o);
    running = { key, p };
    p.then((res) => { if (keyOf() === key) last = { key, res }; }, () => {}).finally(() => { if (running && running.p === p) running = null; });
    return p;
  };
  const update = debounce(async () => {
    const my = ++seq;
    report.classList.add('ed-busy');
    report.textContent = '';
    report.append(h('p', { class: 'ed-muted' }, t('ex.working')));
    try {
      const res = await build();
      if (my !== seq) return;
      showReport(report, res);
      // The package's own section (archive layout, server endpoints…).
      const m = modeOf(o.target);
      if (m.info) {
        const el = await m.info(fullDoc(), { ...exportOptsFor(o), target: m.id, extra: { ...o.extra } });
        if (my === seq && el) report.append(el);
      }
    } catch (e) {
      if (my !== seq) return;
      console.error(e);
      report.textContent = '';
      report.append(h('p', { class: 'ed-error' }, t('ex.err', { msg: e.message })));
    } finally { if (my === seq) report.classList.remove('ed-busy'); }
  }, 250);

  const fileName = () => exportFileName(fileInp.value, modeOf(o.target).ext || 'html');
  let closeDlg = null;
  openDialog({
    title: t(modes.length > 1 ? 'ex.titleAll' : 'ex.title'), body, wide: true, className: 'ed-dlg-export',
    onMount: ({ close }) => { closeDlg = close; },
    buttons: [
      { label: t('dlg.close'), value: null },
      { label: t('ex.preview'), icon: 'eye', value: null, onClick: async () => { openPreview(o, { fromExport: true }); return false; } },
      {
        label: t('ex.download'), icon: 'download', value: 'dl', primary: true, onClick: async () => {
          try {
            update.cancel();
            const m = modeOf(o.target);
            const doc0 = fullDoc();
            let doc = doc0;
            // The product's check (validation, questions): the document to export, false = stay, null = close.
            if (ED.exportCheck) {
              doc = await ED.exportCheck(doc0, { ...exportOptsFor(o), target: m.id, extra: { ...o.extra } });
              if (doc === null) { if (closeDlg) closeDlg(null); return false; }
              if (!doc) return false;
            }
            const name = fileName();
            if (m.build) {
              const opts = exportOptsFor(o);
              const blob = await m.build(doc, { ...opts, source: opts.embedSource ? exportSource(doc, opts) : doc });
              downloadBlob(blob, name);
            } else {
              // Never a stale build: only reuse a result made from exactly the current options and document.
              const res = doc === doc0 && last && last.key === keyOf() ? last.res : doc === doc0 ? await build() : await runExport(o, doc);
              downloadBlob(new Blob([res.html], { type: 'text/html;charset=utf-8' }), name);
            }
            toast(t('io.downloaded', { name }), 'ok');
            return true;
          } catch (e) { console.error(e); toast(t('ex.err', { msg: e.message }), 'error'); return false; }
        },
      },
    ],
  });
  update();
}

// Bars are relative to the total, with a 1 % floor so a tiny part stays visible. Types/features come from the
// exporter's tree-shaking: only code for block types and features actually used is included.
function showReport(box, res) {
  const r = res.report || {};
  box.textContent = '';
  const total = res.bytes ?? new Blob([res.html]).size;
  const parts = [['ex.css', r.cssBytes], ['ex.js', r.jsBytes], ['ex.att', r.attBytes], ['ex.src', r.srcBytes]].filter(([, v]) => v != null);
  const max = Math.max(1, total);
  box.append(
    h('h3', { class: 'ed-report-h' }, t('ex.report')),
    h('div', { class: 'ed-report-total' }, h('span', {}, t('ex.total')), h('strong', {}, fmtBytes(total))),
    h('div', { class: 'ed-report-bars' }, parts.map(([k, v]) => h('div', { class: 'ed-report-row' },
      h('span', { class: 'ed-report-k' }, t(k)),
      h('span', { class: 'ed-report-bar' }, h('span', { style: { width: Math.max(1, Math.round((v / max) * 100)) + '%' } })),
      h('span', { class: 'ed-report-v' }, fmtBytes(v))))),
    h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ex.types')),
      h('div', { class: 'ed-tags' }, (r.types || []).map((ty) => h('span', { class: 'ed-tag' }, t('b.' + ty))))),
    h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('ex.features')),
      (r.features || []).length ? h('div', { class: 'ed-tags' }, r.features.map((f) => h('span', { class: 'ed-tag ed-tag-accent' }, f))) : h('p', { class: 'ed-muted' }, t('ex.noFeatures'))),
    h('p', { class: 'ed-hint' }, t('ex.treeShake')),
    h('p', { class: 'ed-muted' }, `${t('ex.langs')}: ${(r.langs || []).map((l) => l.toUpperCase()).join(', ')}`));
}

export {
  exportFileName,
  exportOptsFor,
  openExport,
  runExport
};
