// language-studio/morph-tools.js - the morpheme workbench of the Georgian, Russian and English courses: a word
// taken apart before the dictionary (pieces, the probable rule and its meaning, alternatives), search by preverb,
// prefix, root and suffix with filters by everyday use, correctness and literariness, and the possible words of a
// root built by the rules — attested ones with their labels, the others marked "not found in literature, but with
// its own meaning by rule". Also the labels of dictionary words for the dictionary's filters.
//
//   MORPH_TOOLS: { morph: { title, render(C, arg) } }      wordLabels(course, word, tier?) -> labels
//   labelFilter(onChange) -> element (three groups of toggles)

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { select } from '../ui/app.js';
import { LABELS, labelText, OWN } from '../lingua/morph.js';
import { parseKa, searchKa, possibleKa, rootsKa, attestedKa, PREVERBS_KA, PREFIXES_KA, SUFFIXES_KA } from '../lingua/morph-ka.js';
import { parseRu, searchRu, possibleRu, rootsRu, attestedRu, addAttestedRu, PREFIXES_RU, SUFFIXES_RU } from '../lingua/morph-ru.js';
import { parseEn, searchEn, possibleEn, rootsEn, attestedEn, addAttestedEn, PREFIXES_EN, SUFFIXES_EN } from '../lingua/morph-en.js';
import { dictionary } from './courses/index.js';
import { speakBtn } from './views.js';
import { linksInline } from './xl-tools.js';

const uniq = (items) => [...new Map(items.map((x) => [x.s, x])).values()];
const API = {
  ka: { parse: parseKa, search: searchKa, possible: possibleKa, roots: rootsKa, attested: attestedKa, preverbs: PREVERBS_KA, prefixes: PREFIXES_KA, suffixes: uniq(SUFFIXES_KA), sample: 'უსახლკარო', samples: ['უსახლო', 'მეთევზე', 'გადაწერა', 'სილამაზე', 'ქართველი', 'მეღვინეობა', 'მწერალი', 'უდიდესი', 'ჩამოსვლა', 'სახლებში'] },
  ru: { parse: parseRu, search: searchRu, possible: possibleRu, roots: rootsRu, attested: attestedRu, prefixes: uniq(PREFIXES_RU), suffixes: uniq(SUFFIXES_RU), sample: 'перечитывание', samples: ['бездомный', 'учитель', 'домище', 'ложить', 'перезвонить', 'сочувствие', 'разговорчивый', 'читалка', 'переписывающиеся'], add: addAttestedRu },
  en: { parse: parseEn, search: searchEn, possible: possibleEn, roots: rootsEn, attested: attestedEn, prefixes: uniq(PREFIXES_EN), suffixes: uniq(SUFFIXES_EN), sample: 'unfriendly', samples: ['friendless', 'inspector', 'biology', 'irregardless', 'childhood', 'reconstruction', 'transportable', 'gonna'], add: addAttestedEn },
};
const L = (C, o) => (o == null ? '' : typeof o === 'string' ? o : o[C.lang] || o.ru || o.en || '');

// The course's own dictionary counts as attested (Russian and English).
// Seeded lazily, once per course per page (the `seeded` set): building the dictionary is not free and most visits
// never open the workbench. wordLabels repeats the same guard because it can be called before any tool renders.
const seeded = new Set();
function api(C) {
  const A = API[C.course.id];
  if (A && A.add && !seeded.has(C.course.id)) { seeded.add(C.course.id); A.add(dictionary(C.course).map((w) => w.w)); }
  return A;
}

export function wordLabels(course, w, tier) {
  const A = API[course.id];
  if (!A) return null;
  if (A.add && !seeded.has(course.id)) { seeded.add(course.id); A.add(dictionary(course).map((x) => x.w)); }
  return A.attested(w) || (tier ? { use: tier === 1 ? 'everyday' : tier === 2 ? 'common' : 'rare', norm: 'norm', lit: 'neutral' } : null);
}

const roleName = (r) => t('mo.role.' + r);
const chips = (C, parts) => h('span', { class: 'mo-parts' }, parts.map((p) => h('span', { class: 'mo-p mo-' + p.role + (p.tag === 'unknown' ? ' mo-unknown' : ''), title: roleName(p.role) + (p.gloss ? ': ' + L(C, p.gloss) : p.tag === 'unknown' ? ': ' + t('mo.unknownRoot') : '') }, p.s)));
const labelBadges = (C, l) => !l ? null : h('span', { class: 'mo-labels' }, ['use', 'norm', 'lit'].map((k) => l[k] ? h('span', { class: `mo-l mo-${k}-${l[k]}` }, L(C, LABELS[k][l[k]])) : null), l.own ? h('span', { class: 'mo-l mo-own' }, L(C, OWN)) : null);

export function labelFilter(onChange) {
  const F = { use: [], norm: [], lit: [] };
  const box = h('div', { class: 'mo-filter' });
  for (const k of ['use', 'norm', 'lit']) {
    box.append(h('div', { class: 'mo-fgroup' }, h('b', null, t('mo.f.' + k)), Object.keys(LABELS[k]).map((v) => {
      const b = h('button', { type: 'button', class: 'ed-chip', 'aria-pressed': 'false', dataset: { k, v } }, t('mo.v.' + v));
      b.addEventListener('click', () => { const on = !F[k].includes(v); F[k] = on ? [...F[k], v] : F[k].filter((x) => x !== v); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('ed-on', on); onChange(F); });
      return b;
    })));
  }
  return box;
}

function morphTool(C, arg) {
  const A = api(C);
  const lang = C.course.id;
  // --- parse ---
  const parseOut = h('div', { class: 'mo-readings' });
  const runParse = (w) => {
    // The best reading and only the alternatives that come close to it.
    const all = A.parse(w, { max: 5 });
    const rs = all.filter((r, i) => i === 0 || (r.score >= all[0].score - 3 && i < 3));
    parseOut.replaceChildren(...(rs.length ? rs.map((r, i) => h('div', { class: 'mo-reading' + (i ? ' mo-alt' : '') },
      h('div', { class: 'mo-head' }, chips(C, r.parts), i === 0 ? speakBtn(C, r.word) : null, r.exception ? h('span', { class: 'ed-tag' }, t('mo.exception')) : null),
      r.rule ? h('p', null, h('b', null, L(C, r.rule.name) + ': '), L(C, r.rule.mean)) : h('p', { class: 'ed-muted' }, t('mo.noRule')),
      h('p', null, r.attested ? h('span', { class: 'ed-tag mo-att' }, t('mo.attested')) : h('span', { class: 'ed-tag mo-notatt' }, t('mo.notAttested')), ' ', labelBadges(C, r.labels)))) : [h('p', { class: 'ed-hint' }, t('ls.nothing'))]));
    // the same family in other languages (cognates, loans, calques) by the word or its root
    const root = rs.length ? (rs[0].parts.find((p) => p.role === 'root') || {}).s : null;
    const xl = linksInline(C, w, root);
    if (xl) parseOut.append(xl);
  };
  const word = h('input', { class: 'ed-input', value: arg || A.sample, spellcheck: 'false', lang });
  word.addEventListener('input', () => runParse(word.value));
  runParse(word.value);

  // --- search ---
  const S = { preverb: '', prefix: '', root: '', suffix: '', filter: null };
  const results = h('div', { class: 'mo-results' });
  const possible = h('div', { class: 'mo-possible' });
  const runSearch = () => {
    const hits = A.search({ ...S, limit: 200 });
    results.replaceChildren(h('p', { class: 'ed-hint' }, t('mo.found', { n: hits.length })), ...hits.map((x) => h('button', { type: 'button', class: 'mo-hit', onclick: () => { word.value = x.w; runParse(x.w); word.scrollIntoView({ block: 'center', behavior: 'smooth' }); } },
      h('b', { lang }, x.w), x.reading ? chips(C, x.reading.parts) : null, x.mean ? h('small', null, ' ' + L(C, x.mean)) : null, labelBadges(C, x.labels))));
    if (S.root) {
      const ps = A.possible(S.root);
      possible.replaceChildren(h('h4', null, t('mo.possible', { root: S.root })), h('p', { class: 'ed-hint' }, t('mo.possibleHint')),
        ...ps.map((x) => h('div', { class: 'mo-pw' + (x.attested ? '' : ' mo-pw-new') }, h('b', { lang }, x.w), x.attested ? null : h('span', { class: 'ed-tag mo-notatt' }, t('mo.notAttested')),
          x.rule ? h('small', { class: 'ed-muted' }, ' ' + L(C, x.rule)) : null, x.mean ? h('span', null, ' — ' + L(C, x.mean)) : null, labelBadges(C, x.labels))));
    } else possible.replaceChildren();
  };
  const opt = (list) => [{ v: '', l: '=—' }, ...list.map((p) => ({ v: p.s, l: '=' + p.s + (lang === 'ka' || p.s.length < 2 ? '' : '') + ' — ' + L(C, p.gloss) }))];
  const rootList = h('datalist', { id: 'mo-roots-' + lang }, A.roots().filter((r) => !r.fromLex && !r.old || r.words.length > 1).slice(0, 2000).map((r) => h('option', { value: r.s }, L(C, r.gloss))));
  const rootIn = h('input', { class: 'ed-input', list: 'mo-roots-' + lang, placeholder: t('mo.rootPh'), lang });
  rootIn.addEventListener('change', () => { S.root = rootIn.value.trim(); runSearch(); });
  const ctl = h('div', { class: 'ls-ctl mo-ctl' },
    A.preverbs ? h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('mo.preverb')), select(opt(A.preverbs), '', (v) => { S.preverb = v; runSearch(); })) : null,
    h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('mo.prefix')), select(opt(A.prefixes), '', (v) => { S.prefix = v; runSearch(); })),
    h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('mo.root')), rootIn, rootList),
    h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('mo.suffix')), select(opt(A.suffixes), '', (v) => { S.suffix = v; runSearch(); })));
  runSearch();
  return h('div', { class: 'ls-tool mo-tool' },
    h('p', { class: 'ed-hint' }, t('mo.hint')),
    h('div', { class: 'ed-chips' }, A.samples.map((x) => h('button', { type: 'button', class: 'ed-chip', lang, onclick: () => { word.value = x; runParse(x); } }, x))),
    h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('mo.word')), word), parseOut,
    h('h3', { class: 'mo-h' }, t('mo.searchTitle')), ctl, labelFilter((F) => { S.filter = F; runSearch(); }), possible, results);
}

export const MORPH_TOOLS = { morph: { title: 'mo.t.morph', render: morphTool } };
