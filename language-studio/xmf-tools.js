// language-studio/xmf-tools.js - the tools of the Mingrelian course: the word analyser (morphemes with their glosses,
// the rule that produced each reading, alternatives, the score, the transcriptions and the Georgian cognate) and the
// cognate explorer (Mingrelian ↔ Georgian by the sound correspondences, attested pairs first, proposals checked
// against both lexicons). Forms the references did not confirm carry a visible "unverified" badge. Styles: the xmf-*
// section of app.css (formerly a separate xmf.css, since merged).
//
//   XMF_TOOLS: { 'xmf-parse' | 'xmf-cognate': { title, render(C, arg) } }      arg: a word from the route
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { seg } from '../ui/app.js';
import { lexByWord as kaLex } from '../lingua/kartuli-lexicon.js';
import {
  CASES, SCREEVES, POS, RULES, EPENTHESIS, lexByWord, parse, toScript, translit, toMegruli, toGeorgian, explainPair, ruleById,
} from '../lingua/megruli.js';
import { partsEl, speakBtn, X } from './views.js';

const field = (label, control) => h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, label), control);
const textInput = (value, onInput, attrs = {}) => {
  const i = h('input', { class: 'ed-input', value, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none', ...attrs });
  i.addEventListener('input', () => onInput(i.value));
  return i;
};
const unvBadge = () => h('span', { class: 'xmf-unv', title: t('xmf.unverifiedHint') }, '⚠ ' + t('xmf.unverified'));
const trLine = (C, w) => h('span', { class: 'xmf-trs' },
  h('span', { class: 'ls-tr' }, translit(w, 'lat')), ' · ', h('span', { class: 'ls-tr' }, translit(w, 'ru')), ' · ', h('span', { class: 'xmf-ipa' }, '/' + translit(w, 'ipa') + '/'));
const meter = (score) => h('span', { class: 'xmf-score', title: t('xmf.score', { n: Math.round(score * 100) }) }, h('span', { style: { width: Math.round(Math.min(1, score) * 100) + '%' } }));
const kaKnown = (w) => kaLex(w).length > 0;
const kaGloss = (C, w) => { const e = kaLex(w)[0]; return e ? (C.lang === 'en' ? e.en : e.ru) || '' : ''; };
const ruleChip = (C, id) => {
  const r = ruleById(id);
  if (!r) return h('span', { class: 'ed-chip' }, id);
  const label = r.id === 'epenthesis' ? '+V' : `${r.ka}→${r.xmf}`;
  return h('span', { class: 'ed-chip xmf-rule' + (r.sporadic ? ' xmf-sporadic' : ''), title: X(C, r), lang: 'ka' }, label);
};

// --- the word analyser -------------------------------------------------------------------------------------------
function tagText(C, r) {
  const out = [];
  const tg = r.tags || {};
  if (tg.case) out.push(X(C, CASES.find((c) => c.id === tg.case)));
  if (tg.number === 'pl') out.push(C.lang === 'en' ? 'plural' : 'мн. ч.');
  if (tg.screeve) out.push(X(C, SCREEVES.find((s) => s.id === tg.screeve)));
  if (tg.s) out.push(tg.s + (tg.o ? ' → ' + tg.o : ''));
  if (tg.inverted) out.push(C.lang === 'en' ? 'inverted' : 'инверсия');
  if (tg.aff) out.push(C.lang === 'en' ? 'affirmative k-' : 'утвердительная ქ-');
  if (tg.masdar) out.push(C.lang === 'en' ? 'masdar' : 'масдар');
  return out.join(' · ');
}

function readingEl(C, r, main) {
  const gloss = r.gloss ? X(C, r.gloss) : t('xmf.guess');
  const cog = r.ka || r.entry?.ka;
  return h('div', { class: 'ls-parse xmf-reading' + (r.score < 0.5 ? ' ls-guess' : '') },
    h('div', { class: 'xmf-head' },
      h('b', { lang: 'ka' }, r.lemma), h('span', { class: 'ls-m' }, gloss),
      POS[r.pos] ? h('span', { class: 'ed-tag' }, X(C, POS[r.pos])) : null,
      r.unverified ? unvBadge() : null, meter(r.score)),
    partsEl(C, r.parts.map((p) => ({ s: p.s, role: p.role, gloss: p.gloss }))),
    tagText(C, r) ? h('div', { class: 'ls-note' }, tagText(C, r)) : null,
    h('div', { class: 'xmf-why' }, h('b', null, t('xmf.rule') + ' '), X(C, r.rule)),
    main && cog ? h('div', { class: 'xmf-cog' }, h('b', null, t('xmf.cognateOf') + ' '),
      h('a', { href: `#xmf/tools/xmf-cognate/${encodeURIComponent(r.lemma)}`, lang: 'ka' }, cog), ' ', h('span', { class: 'ls-tr' }, kaGloss(C, cog))) : null);
}

function wordBlock(C, raw) {
  const w = toScript(raw).replace(/[.,!?;:«»"“”()]+/g, '');
  const rs = parse(w);
  const head = h('div', { class: 'xmf-word-head' }, h('span', { class: 'ls-w', lang: 'ka' }, w), speakBtn(C, w), trLine(C, w));
  if (!rs.length) return h('div', { class: 'xmf-word' }, head, h('p', { class: 'ls-note' }, t('xmf.noReading')));
  const [first, ...rest] = rs;
  return h('div', { class: 'xmf-word' }, head, readingEl(C, first, true),
    rest.length ? h('details', { class: 'xmf-alt' }, h('summary', null, t('xmf.alternatives', { n: rest.length })), ...rest.slice(0, 6).map((r) => readingEl(C, r, false))) : null);
}

const PARSE_EXAMPLES = ['ვჭარუნქ', 'ჭარუნს', 'კოჩიშა', 'ჯოღორეფს', 'დიდაქ', 'ოხორიშე', 'მიჩქუ', 'დოჭარუ', 'კოჩიშენ', "margalepi"];
function xmfParse(C, arg) {
  const out = h('div', { class: 'ls-out' });
  const run = (v) => {
    const words = String(v).trim().split(/\s+/).filter(Boolean).slice(0, 8);
    out.replaceChildren(...words.map((w) => wordBlock(C, w)));
  };
  const start = arg ? decodeURIComponent(arg) : 'ვჭარუნქ';
  const inp = textInput(start, run, { lang: 'ka' });
  run(start);
  return h('div', { class: 'ls-tool xmf-tool' }, h('p', { class: 'ed-hint' }, t('xmf.parseHint')),
    h('div', { class: 'ed-chips' }, PARSE_EXAMPLES.map((x) => h('button', { type: 'button', class: 'ed-chip', lang: 'ka', onclick: () => { inp.value = x; run(x); } }, x))),
    field(t('ls.tool.word'), inp), out);
}

// --- the cognate explorer ----------------------------------------------------------------------------------------
function candidateRow(C, c, dir) {
  const badges = [];
  if (c.attested) badges.push(h('span', { class: 'xmf-badge xmf-att' }, t('xmf.attested')));
  if (dir === 'toKa' ? kaKnown(c.form) : !!lexByWord(c.form)) badges.push(h('span', { class: 'xmf-badge' }, t(dir === 'toKa' ? 'xmf.inKa' : 'xmf.inXmf')));
  const e = dir === 'toXmf' ? lexByWord(c.form) : null;
  if (e && e.unverified) badges.push(unvBadge());
  const gloss = dir === 'toKa' ? kaGloss(C, c.form) : e ? (C.lang === 'en' ? e.en : e.ru) : '';
  return h('div', { class: 'xmf-cand' + (c.attested ? ' xmf-cand-att' : '') },
    h('span', { class: 'ls-w', lang: 'ka' }, c.form), h('span', { class: 'ls-tr' }, translit(c.form, C.lang === 'ru' ? 'ru' : 'lat')),
    gloss ? h('span', { class: 'ls-m' }, gloss) : null,
    h('span', { class: 'xmf-rules' }, c.rules.length ? c.rules.map((id) => ruleChip(C, id)) : c.irregular ? h('span', { class: 'ls-note' }, t('xmf.irregularOnly')) : h('span', { class: 'ls-note' }, t('xmf.sameWord'))),
    ...badges, meter(c.score / 3.5));
}

function pairEl(C, xmf, ka) {
  const ex = explainPair(xmf, ka);
  const e = lexByWord(xmf);
  return h('div', { class: 'ls-parse xmf-pair' },
    h('div', { class: 'xmf-head' }, h('b', { lang: 'ka' }, ka), ' → ', h('b', { lang: 'ka' }, xmf), e ? h('span', { class: 'ls-m' }, C.lang === 'en' ? e.en : e.ru) : null, e && e.unverified ? unvBadge() : null, e && !e.kaSure ? h('span', { class: 'xmf-badge' }, t('xmf.proposedKin')) : null),
    h('div', { class: 'xmf-rules' }, xmf === ka ? h('span', { class: 'ls-note' }, t('xmf.sameWord')) : ex.rules.map((id) => ruleChip(C, id)),
      !ex.reached ? h('span', { class: 'ls-note' }, ' ' + t('xmf.irregular', { n: ex.rest, via: ex.via })) : null),
    h('div', { class: 'ls-note' }, ex.rules.map((id) => X(C, ruleById(id))).join('; ')),
    // the Georgian word's forms and the word across languages (xl-tools.js)
    h('div', { class: 'xl-equiv' }, h('a', { class: 'ed-chip', href: `#ka/tools/ka-forms/${encodeURIComponent(ka)}`, lang: 'ka' }, t('lx.t.forms') + ': ' + ka), h('a', { class: 'ed-chip', href: `#xmf/tools/xl/dict/${encodeURIComponent(xmf)}` }, t('xl.t.xl'))));
}

function xmfCognate(C, arg) {
  const S = { dir: 'toKa', w: arg ? decodeURIComponent(arg) : 'ჯოღორი' };
  const out = h('div', { class: 'ls-out' });
  const chips = h('div', { class: 'ed-chips' });
  const EX = { toKa: ['ჯოღორი', 'კოჩი', 'ბჟა', 'ჩხორო', 'ოში', 'ქვალი', 'ჸუჯი', 'წყარი'], toXmf: ['ძაღლი', 'კაცი', 'მზე', 'ცხრა', 'ასი', 'ყველი', 'ქათამი', 'თხილი'] };
  const run = () => {
    const w = toScript(S.w.trim());
    chips.replaceChildren(...EX[S.dir].map((x) => h('button', { type: 'button', class: 'ed-chip', lang: 'ka', onclick: () => { inp.value = x; S.w = x; run(); } }, x)));
    if (!w) { out.replaceChildren(); return; }
    const res = [];
    if (S.dir === 'toKa') {
      const e = lexByWord(w);
      if (e && e.ka) res.push(pairEl(C, w, e.ka));
      else if (e) res.push(h('p', { class: 'ls-note' }, t('xmf.noCognate', { w })));
      res.push(h('h3', null, t('xmf.proposed')), ...toGeorgian(w, { known: kaKnown }).map((c) => candidateRow(C, c, 'toKa')));
    } else {
      const att = toMegruli(w).filter((c) => c.attested);
      for (const c of att) res.push(pairEl(C, c.form, w));
      res.push(h('h3', null, t('xmf.proposed')), ...toMegruli(w).map((c) => candidateRow(C, c, 'toXmf')));
    }
    out.replaceChildren(...res);
  };
  const inp = textInput(S.w, (v) => { S.w = v; run(); }, { lang: 'ka' });
  const dirSeg = seg([{ v: 'toKa', l: 'xmf.toKa' }, { v: 'toXmf', l: 'xmf.toXmf' }], S.dir, (v) => { S.dir = v; run(); });
  const rules = h('details', { class: 'xmf-ruleref' }, h('summary', null, t('xmf.rulesTitle')),
    h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table ls-table' }, h('tbody', null, [...RULES, EPENTHESIS].map((r) => h('tr', null,
      h('td', { lang: 'ka' }, r.id === 'epenthesis' ? '+ ი / ო / უ' : `${r.ka} → ${r.xmf}`), h('td', null, X(C, r)),
      h('td', null, r.ex.map(([k, x]) => h('button', { type: 'button', class: 'ed-chip', lang: 'ka', onclick: () => { S.dir = 'toXmf'; dirSeg.querySelectorAll('button').forEach((b) => { const on = b.dataset.v === 'toXmf'; b.classList.toggle('ed-on', on); b.setAttribute('aria-checked', String(on)); }); inp.value = k; S.w = k; run(); } }, `${k} → ${x}`)))))))));
  run();
  return h('div', { class: 'ls-tool xmf-tool' }, h('p', { class: 'ed-hint' }, t('xmf.cognateHint')), dirSeg, chips, field(t('ls.tool.word'), inp), out, rules);
}

export const XMF_TOOLS = {
  'xmf-parse': { title: 'xmf.t.parse', render: xmfParse },
  'xmf-cognate': { title: 'xmf.t.cognate', render: xmfCognate },
};
