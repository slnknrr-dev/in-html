// agreement-constructor/dialogs.js - the dialogs of the editor: a field's definition (id, type, labels and help in
// every template language, group, required, default, masks, ranges, currency, options, list items, document kinds,
// computed expression, schedule settings; renaming an id renames its references in the template), the template's
// languages (add one, mark the main one, translation status, remove), the template's settings (names, modifiers,
// levels, groups, page) and the compile options.
//
//   fieldDialog(id | null)   languagesDialog()   templateDialog()   compileDialog() -> Promise<{ lang, sample, current } | null>
//
// Pattern: every dialog edits a deep copy (JSON round trip) and commits through A.changeTemplate(mutator, { now })
// only on Save, so Cancel leaves the template untouched and each Save is one versioned change. Validation that can
// fail (ids, expressions) runs in the Save button's onClick and returns false to keep the dialog open, instead of
// closing and reporting afterwards. Per-language texts are edited for the current contract language; other
// languages' labels are carried over from the previous value (spread of prev.label).
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, toast } from '../ui/overlays.js';
import { SUGGESTED_LANGS, contentLangCode, langLabel } from '../ui/lang.js';
import { LANG_NAMES } from '../i18n/lang.js';
import { FIELD_TYPES, LIST_ITEM_TYPES, MASKS, isFieldId, isName } from '../contract/model.js';
import { parseExpr } from '../contract/expr.js';
import { CURRENCIES } from '../contract/words.js';
import { addLanguage, removeLanguage, setMainLanguage, translationStatus } from '../contract/langs.js';
import { PAGE_SIZES } from '../paper/base.js';
import { A, S, pick } from './state.js';

// <label> wrapping caption + control: accessible name without ids; a click on the caption focuses the control.
const row = (label, control, hint) => h('label', { class: 'ed-field ac-dlg-f' }, h('span', { class: 'ed-label' }, label), control, hint ? h('span', { class: 'ed-hint' }, hint) : null);
const inp = (value, attrs = {}) => { const i = h('input', { class: 'ed-input', spellcheck: 'false', ...attrs }); i.value = value ?? ''; return i; };
const area = (value, attrs = {}) => { const i = h('textarea', { class: 'ed-input ed-textarea', spellcheck: 'false', rows: 4, ...attrs }); i.value = value ?? ''; return i; };
const sel = (options, value) => { const s = h('select', { class: 'ed-input ed-select' }, options.map(([v, l]) => h('option', { value: v }, l))); s.value = value ?? ''; return s; };
const chk = (checked) => h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', checked: !!checked });

// Line format "value = label | extra" (extra: e.g. the issuer of a document kind).
// "value = label" lines <-> options of the current language (other languages keep their labels).
function optionsText(opts, extra) {
  return (opts || []).map((o) => `${o.v} = ${pick(o.label)}${extra ? ' | ' + pick(o[extra]) : ''}`).join('\n');
}
function parseOptions(text, old, extra) {
  const out = [];
  for (const line of String(text).split('\n')) {
    // The value runs up to the first '=' or '|'; label and extra are optional. Empty or malformed lines are skipped.
    const m = /^\s*([^=|]+?)\s*(?:=\s*([^|]*?))?\s*(?:\|\s*(.*?))?\s*$/.exec(line);
    if (!m || !m[1]) continue;
    const prev = (old || []).find((o) => o.v === m[1]);
    const o = { v: m[1], label: { ...(prev ? prev.label : {}), [S.lang]: m[2] || m[1] } };
    if (extra) o[extra] = { ...(prev && prev[extra] ? prev[extra] : {}), [S.lang]: m[3] || '' };
    out.push(o);
  }
  return out;
}

// References to `old` (a field, modifier or level id) inside placeholders, blocks and expressions become `neu`.
function renameRefs(tpl, old, neu) {
  // Word-boundary-like match that treats '.' and '$' as part of identifiers: renaming "rent" must not touch "rent2" or
  // "x.rent". Replacement happens only inside {{ }} and [[ ]] blocks and in expression fields, never in plain prose,
  // so a field named "term" does not rewrite the word "term" in clause text.
  const re = new RegExp(`(?<![\\w.$])${old.replace(/\./g, '\\.')}(?=[^\\w$]|$)`, 'g');
  const inBlocks = (s) => String(s).replace(/\{\{[\s\S]*?\}\}|\[\[[\s\S]*?\]\]/g, (m) => m.replace(re, neu));
  const each = (o) => { for (const k of Object.keys(o || {})) o[k] = inBlocks(o[k]); };
  each(tpl.title);
  for (const s of tpl.sections) {
    each(s.title);
    if (s.when) s.when = s.when.replace(re, neu);
    for (const c of s.clauses) {
      each(c.text); each(c.title);
      if (c.when) c.when = c.when.replace(re, neu);
      if (c.by === old) c.by = neu;
      for (const v of Object.values(c.variants || {})) each(v);
    }
  }
  for (const f of tpl.fields) {
    if (f.expr) f.expr = f.expr.replace(re, neu);
    if (f.amount) f.amount = f.amount.replace(re, neu);
    if (f.term === old) f.term = neu;
    if (f.after === old) f.after = neu;
    if (f.when) f.when = f.when.replace(re, neu);
  }
}

export function fieldDialog(id) {
  const isNew = !id;
  // New field: empty skeleton; existing: deep copy, so edits in the dialog never leak into the live template.
  const f0 = isNew ? { id: '', type: 'text', label: {}, help: {}, group: '', required: false } : JSON.parse(JSON.stringify(S.tpl.fields.find((x) => x.id === id)));
  if (!f0) return;
  const idIn = inp(f0.id, { 'aria-label': t('ac.fieldId'), placeholder: 'tenant.phone' });
  const type = sel(FIELD_TYPES.map((x) => [x, t('ac.type.' + x)]), f0.type);
  const group = sel([['', '—'], ...S.tpl.groups.map((g) => [g.id, pick(g.label) || g.id])], f0.group);
  const req = chk(f0.required);
  const labels = S.tpl.langs.map((l) => [l, inp(f0.label[l], { 'aria-label': t('ac.label') + ' ' + l, placeholder: f0.label[S.tpl.main] || '' })]);
  const helps = S.tpl.langs.map((l) => [l, inp(f0.help[l], { 'aria-label': t('ac.help') + ' ' + l })]);
  const specific = h('div', { class: 'ac-dlg-spec' });
  let collect = () => ({});

  // The type-specific part is rebuilt on type change; `collect` is reassigned to read exactly the controls of the
  // current type (a closure per type), so switching types cannot leave stale values in the result.
  function buildSpecific() {
    const ty = type.value;
    specific.replaceChildren();
    const f = { ...f0, type: ty };
    const add = (...els) => specific.append(...els);
    if (ty === 'text' || ty === 'longtext') {
      const mask = sel(MASKS.map((m) => [m, m || '—']), f.mask || '');
      const pattern = inp(f.pattern || '', { placeholder: '^\\d{4}$' });
      const def = inp(typeof f.default === 'string' ? f.default : '');
      add(row(t('ac.mask'), mask), row(t('ac.pattern'), pattern, t('ac.patternHint')), row(t('ac.default'), def));
      collect = () => ({ mask: mask.value, pattern: pattern.value.trim() || undefined, default: def.value });
    } else if (ty === 'number' || ty === 'money') {
      // Empty number inputs mean "no limit" (undefined, removed before saving), not 0.
      const min = inp(f.min ?? '', { inputmode: 'decimal' }), max = inp(f.max ?? '', { inputmode: 'decimal' }), def = inp(f.default ?? '', { inputmode: 'decimal' });
      const cur = sel(Object.keys(CURRENCIES).map((c) => [c, c + ' ' + CURRENCIES[c].symbol]), f.currency || 'RUB');
      const unit = inp(f.unit ? f.unit[S.lang] || '' : '', { placeholder: t('ac.unitPh') });
      add(h('div', { class: 'ac-dlg-row' }, row(t('ac.min'), min), row(t('ac.max'), max), row(t('ac.default'), def)), ty === 'money' ? row(t('ac.currency'), cur) : row(t('ac.unit'), unit));
      collect = () => ({ min: min.value === '' ? undefined : +min.value, max: max.value === '' ? undefined : +max.value, default: def.value === '' ? null : +def.value, currency: ty === 'money' ? cur.value : undefined, unit: ty === 'number' && unit.value ? { ...(f.unit || {}), [S.lang]: unit.value } : undefined });
    } else if (ty === 'date') {
      const def = sel([['', '—'], ['today', t('ac.today')]], f.default === 'today' ? 'today' : '');
      const after = sel([['', '—'], ...S.tpl.fields.filter((x) => (x.type === 'date' || x.type === 'period') && x.id !== f.id).map((x) => [x.id, x.id])], f.after || '');
      add(row(t('ac.default'), def), row(t('ac.after'), after));
      collect = () => ({ default: def.value, after: after.value || undefined });
    } else if (ty === 'select') {
      const opts = area(optionsText(f.options), { placeholder: 'transfer = Bank transfer\ncash = Cash' });
      add(row(t('ac.options'), opts, t('ac.optionsHint')));
      collect = () => { const options = parseOptions(opts.value, f.options); return { options, default: options[0] ? options[0].v : '' }; };
    } else if (ty === 'bool') {
      const def = chk(f.default);
      add(h('label', { class: 'ed-field ed-field-check' }, def, h('span', { class: 'ed-label' }, t('ac.defaultOn'))));
      collect = () => ({ default: def.checked });
    } else if (ty === 'period') {
      const months = inp(f.default && f.default.months ? f.default.months : 11, { inputmode: 'numeric' });
      add(row(t('ac.defaultMonths'), months, t('ac.periodHint')));
      collect = () => ({ default: { months: +months.value || 11 } });
    } else if (ty === 'party') {
      const person = chk(!f.kinds || f.kinds.includes('person')), org = chk(!f.kinds || f.kinds.includes('org'));
      add(h('div', { class: 'ac-dlg-row' }, h('label', { class: 'ed-field ed-field-check' }, person, h('span', { class: 'ed-label' }, t('ac.kindPerson'))), h('label', { class: 'ed-field ed-field-check' }, org, h('span', { class: 'ed-label' }, t('ac.kindOrg')))));
      collect = () => ({ kinds: [person.checked ? 'person' : null, org.checked ? 'org' : null].filter(Boolean) });
    } else if (ty === 'docref') {
      const kinds = area(optionsText(f.kinds, 'issuer'), { placeholder: 'notarial = a notarised power of attorney | certified by' });
      add(row(t('ac.docKinds'), kinds, t('ac.docKindsHint')));
      collect = () => ({ kinds: parseOptions(kinds.value, f.kinds, 'issuer') });
    } else if (ty === 'list') {
      const items = area((f.items || []).map((it) => `${it.id} : ${it.type} = ${pick(it.label)}`).join('\n'), { placeholder: 'name : text = Service\nprice : money = Price' });
      const cur = sel(Object.keys(CURRENCIES).map((c) => [c, c]), f.currency || 'RUB');
      add(row(t('ac.items'), items, t('ac.itemsHint', { types: LIST_ITEM_TYPES.join(', ') })), row(t('ac.currency'), cur));
      collect = () => ({
        currency: cur.value,
        items: items.value.split('\n').map((line) => /^\s*([A-Za-z_]\w*)\s*(?::\s*(\w+))?\s*(?:=\s*(.*?))?\s*$/.exec(line)).filter(Boolean).map((m) => {
          const prev = (f.items || []).find((x) => x.id === m[1]);
          return { ...(prev || {}), id: m[1], type: LIST_ITEM_TYPES.includes(m[2]) ? m[2] : 'text', label: { ...(prev ? prev.label : {}), [S.lang]: m[3] || m[1] }, currency: cur.value };
        }),
      });
    } else if (ty === 'computed') {
      const expr = inp(f.expr || '', { placeholder: "rent * 2", class: 'ed-input ac-mono-in' });
      const format = sel(['', 'number', 'money', 'date', 'text', 'bool'].map((x) => [x, x || '—']), f.format || '');
      const cur = sel(Object.keys(CURRENCIES).map((c) => [c, c]), f.currency || 'RUB');
      add(row(t('ac.expr'), expr, t('ac.exprHint')), h('div', { class: 'ac-dlg-row' }, row(t('ac.format'), format), row(t('ac.currency'), cur)));
      collect = () => {
        const p = parseExpr(expr.value);
        // Expressions are parsed at save time; a syntax error becomes the toast message and keeps the dialog open.
        if (p.error) throw new Error(t('ac.exprError', { m: p.error }));
        return { expr: expr.value.trim(), format: format.value, currency: cur.value };
      };
    } else if (ty === 'schedule') {
      const term = sel(S.tpl.fields.filter((x) => x.type === 'period').map((x) => [x.id, x.id]), f.term || 'term');
      const amount = inp(f.amount || 'rent', { class: 'ed-input ac-mono-in' });
      const prorata = chk(f.prorata !== false);
      const due = inp(f.dueOffset || 0, { inputmode: 'numeric' });
      const cur = sel(Object.keys(CURRENCIES).map((c) => [c, c]), f.currency || 'RUB');
      add(h('div', { class: 'ac-dlg-row' }, row(t('ac.term'), term), row(t('ac.amount'), amount)), h('div', { class: 'ac-dlg-row' }, row(t('ac.dueOffset'), due, t('ac.dueHint')), row(t('ac.currency'), cur)),
        h('label', { class: 'ed-field ed-field-check' }, prorata, h('span', { class: 'ed-label' }, t('ac.prorata'))), h('p', { class: 'ed-hint' }, t('ac.scheduleHint')));
      collect = () => {
        const p = parseExpr(amount.value);
        if (p.error) throw new Error(t('ac.exprError', { m: p.error }));
        return { term: term.value, amount: amount.value.trim(), prorata: prorata.checked, dueOffset: +due.value || 0, currency: cur.value };
      };
    } else collect = () => ({});
  }
  type.addEventListener('change', buildSpecific);
  buildSpecific();

  const body = h('div', { class: 'ac-dlg' },
    h('div', { class: 'ac-dlg-row' }, row(t('ac.fieldId'), idIn, t('ac.fieldIdHint')), row(t('ac.fieldType'), type)),
    h('div', { class: 'ac-dlg-row' }, row(t('ac.group'), group), h('label', { class: 'ed-field ed-field-check ac-req' }, req, h('span', { class: 'ed-label' }, t('ac.required')))),
    h('fieldset', { class: 'ac-dlg-langs' }, h('legend', {}, t('ac.label')), labels.map(([l, i]) => row(langLabel(l) + (l === S.tpl.main ? ' ★' : ''), i))),
    h('fieldset', { class: 'ac-dlg-langs' }, h('legend', {}, t('ac.help')), helps.map(([l, i]) => row(langLabel(l), i))),
    specific);

  return openDialog({
    title: isNew ? t('ac.addField') : t('ac.editField') + ' · ' + id, body, wide: true, className: 'ac-dialog',
    buttons: [
      ...(isNew ? [] : [{ label: t('dlg.delete'), danger: true, value: 'delete', className: 'ac-left', onClick: async () => confirmDialog(t('ac.deleteField'), t('ac.deleteFieldSure', { id }), t('dlg.delete'), true) }]),
      { label: t('dlg.cancel'), value: null },
      { label: t('ac.save'), primary: true, value: 'save', onClick: () => {
        // Ids are validated (isFieldId) and must not collide with other fields or with modifier/level names, because all of
        // them share one namespace inside expressions.
        const nid = idIn.value.trim();
        if (!isFieldId(nid)) { toast(t('ac.badId'), 'error'); return false; }
        if (nid !== id && (S.tpl.fields.some((x) => x.id === nid) || S.tpl.modifiers.some((m) => m.id === nid.split('.')[0]) || S.tpl.levels.some((l) => l.id === nid.split('.')[0]))) { toast(t('ac.idTaken'), 'error'); return false; }
        try { collect(); } catch (e) { toast(e.message, 'error'); return false; }
        return true;
      } },
    ],
  }).then((v) => {
    if (v === 'delete') { A.changeTemplate((tpl) => { tpl.fields = tpl.fields.filter((x) => x.id !== id); }, { now: true }); return; }
    if (v !== 'save') return;
    const nid = idIn.value.trim();
    const spec = collect();
    const label = Object.fromEntries(labels.map(([l, i]) => [l, i.value.trim()]).filter(([, x]) => x));
    const help = Object.fromEntries(helps.map(([l, i]) => [l, i.value.trim()]).filter(([, x]) => x));
    const def = { ...f0, ...spec, id: nid, type: type.value, group: group.value, required: req.checked, label, help };
    // Undefined members are deleted so the stored template stays minimal (no "min": undefined artefacts in exports).
    for (const k of Object.keys(def)) if (def[k] === undefined) delete def[k];
    A.changeTemplate((tpl) => {
      if (isNew) tpl.fields.push(def);
      else {
        const i = tpl.fields.findIndex((x) => x.id === id);
        if (i >= 0) tpl.fields[i] = def;
        if (nid !== id) renameRefs(tpl, id, nid);
      }
    }, { now: true });
    // A renamed field moves its value in the open document too. Other documents keep the old key: they reference an
    // immutable template version (store.js), and the value is re-mapped only if they are updated to the new version.
    if (S.doc.values[id] !== undefined && nid !== id) { S.doc.values[nid] = S.doc.values[id]; delete S.doc.values[id]; }
  });
}

export function languagesDialog() {
  const body = h('div', { class: 'ac-dlg' });
  const draw = () => {
    // The table is redrawn after each change (status, main language, removals) because translation status depends on
    // the whole template.
    const st = translationStatus(S.tpl);
    const codeIn = inp('', { placeholder: 'de, fr, uk, pt-BR…', list: 'ac-lang-list', 'aria-label': t('ac.langCode') });
    const copy = chk(true);
    body.replaceChildren(
      h('p', { class: 'ed-hint' }, t('ac.langsHelp')),
      h('table', { class: 'ap-table ac-langs' }, h('thead', {}, h('tr', {}, h('th', {}, t('ac.language')), h('th', {}, t('ac.main')), h('th', {}, t('ac.translated')), h('th', {}, ''))),
        h('tbody', {}, S.tpl.langs.map((l) => h('tr', {},
          h('td', {}, langLabel(l), ' ', h('code', {}, l)),
          h('td', {}, h('input', { type: 'radio', name: 'ac-main', checked: l === S.tpl.main, 'aria-label': t('ac.makeMain') + ' ' + l, onchange: () => { A.changeTemplate((tpl) => Object.assign(tpl, setMainLanguage(tpl, l)), { now: true }); draw(); } })),
          h('td', {}, h('div', { class: 'ac-meter', title: `${st[l].done} / ${st[l].total}` }, h('i', { style: { width: st[l].percent + '%' } })), ` ${st[l].percent}%`,
            st[l].missing.length ? h('button', { type: 'button', class: 'ac-linkbtn', onclick: () => { A.setLang(l); A.setEdit(true); toast(t('ac.translateHint'), 'info'); } }, t('ac.translate')) : null),
          h('td', {}, S.tpl.langs.length > 1 ? h('button', { type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('ac.removeLang'), 'aria-label': t('ac.removeLang') + ' ' + l, onclick: async () => {
            if (!await confirmDialog(t('ac.removeLang'), t('ac.removeLangSure', { lang: langLabel(l) }), t('dlg.delete'), true)) return;
            A.changeTemplate((tpl) => Object.assign(tpl, removeLanguage(tpl, l)), { now: true }); draw();
          } }, '×') : null))))),
      h('datalist', { id: 'ac-lang-list' }, [...new Set([...SUGGESTED_LANGS, ...Object.keys(LANG_NAMES)])].filter((l) => !S.tpl.langs.includes(l)).map((l) => h('option', { value: l }, LANG_NAMES[l] || l))),
      h('div', { class: 'ac-dlg-row ac-addlang' }, row(t('ac.addLanguage'), codeIn), h('label', { class: 'ed-field ed-field-check' }, copy, h('span', { class: 'ed-label' }, t('ac.copyMainDraft'))),
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => {
          const c = contentLangCode(codeIn.value);
          if (!c) { toast(t('ac.badLang'), 'error'); return; }
          if (S.tpl.langs.includes(c)) { toast(t('ac.langExists'), 'warn'); return; }
          // addLanguage can pre-fill the new language with the main language's texts as a translation draft.
          A.changeTemplate((tpl) => Object.assign(tpl, addLanguage(tpl, c, { copy: copy.checked })), { now: true });
          draw();
        } }, t('ac.add'))));
  };
  draw();
  return openDialog({ title: t('ac.languages'), body, wide: true, className: 'ac-dialog', buttons: [{ label: t('dlg.close'), value: null, primary: true }] });
}

export function templateDialog() {
  // Modifiers and levels keep their original id (old) during editing, so renamed ids can be rewritten across the
  // template on save (renameRefs) before the lists are replaced.
  const tpl = JSON.parse(JSON.stringify(S.tpl));
  const names = tpl.langs.map((l) => [l, inp(tpl.name[l], { 'aria-label': t('ac.name') + ' ' + l })]);
  const desc = area(tpl.description[S.lang] || '', { rows: 2 });
  const modBox = h('div', { class: 'ac-rows' });
  const lvlBox = h('div', { class: 'ac-rows' });
  const mods = tpl.modifiers.map((m) => ({ ...m, old: m.id }));
  const lvls = tpl.levels.map((l) => ({ ...l, old: l.id }));
  const drawMods = () => modBox.replaceChildren(...mods.map((m, i) => {
    const id = inp(m.id, { 'aria-label': t('ac.modId'), class: 'ed-input ac-mono-in' });
    const label = inp(pick(m.label), { 'aria-label': t('ac.label') });
    const help = inp(pick(m.help), { 'aria-label': t('ac.help'), placeholder: t('ac.help') });
    const def = chk(m.default);
    id.addEventListener('input', () => { m.id = id.value.trim(); });
    label.addEventListener('input', () => { m.label = { ...m.label, [S.lang]: label.value }; });
    help.addEventListener('input', () => { m.help = { ...m.help, [S.lang]: help.value }; });
    def.addEventListener('change', () => { m.default = def.checked; });
    return h('div', { class: 'ac-rowed' }, id, label, help, h('label', { class: 'ed-field-check', title: t('ac.defaultOn') }, def), h('button', { type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('dlg.delete'), 'aria-label': t('dlg.delete'), onclick: () => { mods.splice(i, 1); drawMods(); } }, '×'));
  }), h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { mods.push({ id: 'mod' + (mods.length + 1), label: { [S.lang]: t('ac.newModifier') }, help: {}, default: false }); drawMods(); } }, '+ ' + t('ac.addModifier')));
  const drawLvls = () => lvlBox.replaceChildren(...lvls.map((l, i) => {
    const id = inp(l.id, { 'aria-label': t('ac.levelId'), class: 'ed-input ac-mono-in' });
    const label = inp(pick(l.label), { 'aria-label': t('ac.label') });
    const opts = area(optionsText(l.options), { rows: 3, 'aria-label': t('ac.options') });
    id.addEventListener('input', () => { l.id = id.value.trim(); });
    label.addEventListener('input', () => { l.label = { ...l.label, [S.lang]: label.value }; });
    opts.addEventListener('input', () => { l.options = parseOptions(opts.value, l.options); if (!l.options.some((o) => o.v === l.default)) l.default = l.options[0] ? l.options[0].v : ''; });
    return h('div', { class: 'ac-rowed ac-rowed-l' }, id, label, opts, h('button', { type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('dlg.delete'), 'aria-label': t('dlg.delete'), onclick: () => { lvls.splice(i, 1); drawLvls(); } }, '×'));
  }), h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { lvls.push({ id: 'level' + (lvls.length + 1), label: { [S.lang]: t('ac.newLevel') }, options: [{ v: 'a', label: { [S.lang]: 'A' } }, { v: 'b', label: { [S.lang]: 'B' } }], default: 'a' }); drawLvls(); } }, '+ ' + t('ac.addLevel')));
  drawMods();
  drawLvls();
  const groups = area(tpl.groups.map((g) => `${g.id} = ${pick(g.label)}`).join('\n'), { rows: 4 });
  const size = sel(Object.keys(PAGE_SIZES).map((k) => [k, k]), tpl.page.size);
  const font = sel([['serif', t('ac.fontSerif')], ['sans', t('ac.fontSans')]], tpl.page.font);
  const fs = inp(tpl.page.fontSize, { inputmode: 'decimal' });
  const margins = inp(tpl.page.margins.join(' '), { placeholder: '20 15 20 25' });
  const body = h('div', { class: 'ac-dlg' },
    h('fieldset', { class: 'ac-dlg-langs' }, h('legend', {}, t('ac.name')), names.map(([l, i]) => row(langLabel(l), i))),
    row(t('ac.description'), desc),
    h('fieldset', {}, h('legend', {}, t('ac.modifiers')), h('p', { class: 'ed-hint' }, t('ac.modifiersHint')), modBox),
    h('fieldset', {}, h('legend', {}, t('ac.levels')), h('p', { class: 'ed-hint' }, t('ac.levelsHint')), lvlBox),
    row(t('ac.groups'), groups, t('ac.optionsHint')),
    h('fieldset', {}, h('legend', {}, t('ac.page')), h('div', { class: 'ac-dlg-row' }, row(t('ac.pageSize'), size), row(t('ac.font'), font), row(t('ac.fontSize'), fs), row(t('ac.margins'), margins, t('ac.marginsHint')))),
    h('p', { class: 'ed-hint' }, t('ac.versionInfo', { v: tpl.version, id: tpl.id })));
  return openDialog({
    title: t('ac.templateSettings'), body, wide: true, className: 'ac-dialog',
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ac.save'), primary: true, value: 'save', onClick: () => {
      const ids = [...mods.map((m) => m.id), ...lvls.map((l) => l.id)];
      // Modifier and level ids must be valid names and unique among themselves.
      if (ids.some((x) => !isName(x)) || new Set(ids).size !== ids.length) { toast(t('ac.badId'), 'error'); return false; }
      return true;
    } }],
  }).then((v) => {
    if (v !== 'save') return;
    A.changeTemplate((x) => {
      x.name = Object.fromEntries(names.map(([l, i]) => [l, i.value.trim()]).filter(([, s]) => s));
      x.description = { ...x.description, [S.lang]: desc.value.trim() };
      for (const m of mods) if (m.old && m.old !== m.id) renameRefs(x, m.old, m.id);
      for (const l of lvls) if (l.old && l.old !== l.id) renameRefs(x, l.old, l.id);
      x.modifiers = mods.map(({ old, ...m }) => m);
      x.levels = lvls.map(({ old, ...l }) => l);
      x.groups = parseOptions(groups.value, x.groups).map((g) => ({ id: g.v, label: g.label }));
      const mm = margins.value.trim().split(/[\s,;]+/).map(Number);
      // Margins accept "top right bottom left" in mm separated by spaces, commas or semicolons; anything but four numbers
      // keeps the previous margins.
      x.page = { size: size.value, font: font.value, fontSize: +fs.value || 12, margins: mm.length === 4 && mm.every(Number.isFinite) ? mm : x.page.margins };
    }, { now: true });
  });
}

export function compileDialog() {
  // Compile = a standalone HTML contract for one language, starting empty, with the template's sample values, or with
  // the current document's values.
  const lang = sel(S.tpl.langs.map((l) => [l, langLabel(l) + (l === S.tpl.main ? ' ★' : '')]), S.lang);
  const start = sel([['empty', t('ac.startEmpty')], ['sample', t('ac.startSample')], ...(S.docId ? [['current', t('ac.startCurrent')]] : [])], 'empty');
  const body = h('div', { class: 'ac-dlg' }, h('p', { class: 'ed-hint' }, t('ac.compileHelp')), row(t('ac.compileLang'), lang), row(t('ac.compileStart'), start));
  return openDialog({ title: t('ac.compile'), body, className: 'ac-dialog', buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ac.compileGo'), primary: true, value: 'go' }] })
    .then((v) => (v === 'go' ? { lang: lang.value, sample: start.value === 'sample', current: start.value === 'current' } : null));
}

