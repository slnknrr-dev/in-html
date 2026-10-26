// contract/langs.js - the languages of a template: add one (optionally starting from the main language's text as a
// draft), remove one, make one the main language (the fallback of every missing translation), and the translation
// status of every language: which clause texts, titles and labels are missing. Pure: each function returns a new
// template.
//
//   addLanguage(tpl, code, { copy }) -> tpl      removeLanguage(tpl, code) -> tpl      setMainLanguage(tpl, code) -> tpl
//   translationStatus(tpl) -> { lang: { total, done, percent, missing: [{ kind, section, clause, field }] } }
//   texts(tpl) -> [{ kind, section?, clause?, field?, value: {lang} }]   every translatable text of a template
import { canonLang } from '../i18n/lang.js';
import { isEmptyText } from '../i18n/text.js';

// One enumerator of every translatable string, each returned with a live reference to its {lang: text} object:
// translationStatus reads through it, addLanguage/removeLanguage write through it on a cloned template. Adding a new
// translatable place to the model means adding it here only.
export function texts(tpl) {
  const out = [];
  const add = (kind, value, at = {}) => { if (value && typeof value === 'object') out.push({ kind, value, ...at }); };
  add('name', tpl.name);
  add('title', tpl.title);
  for (const m of tpl.modifiers) add('modifier', m.label, { field: m.id });
  for (const l of tpl.levels) { add('level', l.label, { field: l.id }); for (const x of l.options) add('option', x.label, { field: l.id + ':' + x.v }); }
  for (const g of tpl.groups) add('group', g.label, { field: g.id });
  for (const f of tpl.fields) {
    add('label', f.label, { field: f.id });
    for (const x of f.options || []) add('option', x.label, { field: f.id + ':' + x.v });
    for (const x of f.kinds || []) if (x && x.label) add('option', x.label, { field: f.id + ':' + x.v });
    for (const it of f.items || []) add('label', it.label, { field: f.id + '.' + it.id });
  }
  for (const s of tpl.sections) {
    if (s.title && Object.keys(s.title).length) add('section', s.title, { section: s.id });
    for (const c of s.clauses) {
      if (c.title) add('clauseTitle', c.title, { section: s.id, clause: c.id });
      add('clause', c.text, { section: s.id, clause: c.id });
      if (c.by && c.variants) for (const [k, v] of Object.entries(c.variants)) add('variant', v, { section: s.id, clause: c.id, field: k });
    }
  }
  return out;
}

// A text counts when the main language has it (an empty main text needs no translation).
export function translationStatus(tpl) {
  const all = texts(tpl).filter((x) => !isEmptyText(x.value[tpl.main]));
  const res = {};
  for (const l of tpl.langs) {
    const missing = all.filter((x) => isEmptyText(x.value[l])).map(({ kind, section, clause, field }) => ({ kind, section, clause, field }));
    const total = all.length;
    res[l] = { total, done: total - missing.length, percent: total ? Math.round(((total - missing.length) / total) * 100) : 100, missing };
  }
  return res;
}

// Templates are plain JSON, so a JSON round-trip is a correct deep clone (structuredClone would also work; JSON keeps
// older engines). Functions are pure: callers keep undo history by holding the previous template object.
const clone = (v) => JSON.parse(JSON.stringify(v));

export function addLanguage(tpl, code, o = {}) {
  const c = canonLang(code);
  if (!c || tpl.langs.includes(c)) return tpl;
  const t = clone(tpl);
  t.langs.push(c);
  if (o.copy) for (const x of texts(t)) if (!isEmptyText(x.value[t.main]) && isEmptyText(x.value[c])) x.value[c] = x.value[t.main];
  return t;
}

export function removeLanguage(tpl, code) {
  if (!tpl.langs.includes(code) || tpl.langs.length < 2) return tpl;
  const t = clone(tpl);
  t.langs = t.langs.filter((l) => l !== code);
  if (t.main === code) t.main = t.langs[0];
  for (const x of texts(t)) delete x.value[code];
  return t;
}

// The main language is also moved first in langs: language lists in the UI and in compiled pages follow this order.
export function setMainLanguage(tpl, code) {
  if (!tpl.langs.includes(code) || tpl.main === code) return tpl;
  const t = clone(tpl);
  t.main = code;
  t.langs = [code, ...t.langs.filter((l) => l !== code)];
  return t;
}
