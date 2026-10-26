// language-studio/xl-tools.js - "Across languages": the tools that join the courses. One tool tab in every course
// with five panels (route #<course>/tools/xl/<panel>/<arg>):
//   links    word families across languages: cognates, loanwords, calques, Sino-xenic words, Kartvelian cognates and
//            false friends (lingua/xlinks.js), each word linked to its course's morpheme parser or word forms;
//   dict     one dictionary across all courses: any word or gloss in any language, back-lookup (Russian or English →
//            Georgian, Mingrelian, Korean…), equivalents through the shared gloss (lingua/bilex.js);
//   type     Latin typing of every script (lingua/typein.js);
//   deck     spaced-repetition cards between any two languages, direct or through a pivot (lingua/decks.js);
//   parallel a text and its translation aligned sentence by sentence, entities matched across them (lingua/align.js).
// Also the pieces other tools embed: linksPanel (the morpheme workbench), contrastEl (the Georgian sentence
// designer: the same structure in Russian or English), equivChips (dictionary rows: the word in other languages).
//
//   XL_TOOLS: { xl: { title, render(C, arg) } }
import './strings-xl.js';
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { select, seg, copyText } from '../ui/app.js';
import { LINKS, KINDS, LANG_NAMES, linksFor, searchLinks } from '../lingua/xlinks.js';
import { equivalents, headKey, lookup } from '../lingua/bilex.js';
import { TARGETS, typeIn } from '../lingua/typein.js';
import { deckLanguages, deckPairs } from '../lingua/decks.js';
import { contrastSentence } from '../lingua/contrast.js';
import { alignSentences, mapSentences, matchEntities, sentencesOf } from '../lingua/align.js';
import { analyzeText, detectLang } from '../lingua/discourse.js';
import { dueItems, review, strength } from '../lingua/srs.js';
import { LEXICON as XMF } from '../lingua/megruli.js';
import { CHARS } from './courses/cjk.js';
import { courseById } from './courses/index.js';
import { FONTS } from './draw.js';
import { allEntries, index, PARALLEL } from './xl-data.js';

const L = (C, o) => (o == null ? '' : typeof o === 'string' ? o : o[C.lang] || o.ru || o.en || Object.values(o)[0] || '');
const field = (label, control) => h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, label), control);
const textInput = (value, onInput, attrs = {}) => {
  const i = h(attrs.multiline ? 'textarea' : 'input', { class: 'ed-input' + (attrs.multiline ? ' ed-textarea' : ''), value, spellcheck: 'false', autocomplete: 'off', ...attrs, multiline: null });
  i.addEventListener('input', () => onInput(i.value));
  return i;
};
const langName = (C, l) => L(C, LANG_NAMES[l]) || l;
const LANG_ATTR = { ka: 'ka', xmf: 'xmf', ru: 'ru', en: 'en', sa: 'sa', ja: 'ja', zh: 'zh', ko: 'ko', la: 'la', grc: 'grc', de: 'de', fr: 'fr', fa: 'fa', ar: 'ar' };
const SCRIPT_OF = { ka: 'Geor', xmf: 'Geor', ru: 'Cyrl', sa: 'Deva', ja: 'Jpan', zh: 'Hans', ko: 'Kore', en: 'Latn' };
const wordEl = (l, w) => h('span', { class: 'xl-w', lang: LANG_ATTR[l] || null, style: SCRIPT_OF[l] ? { fontFamily: FONTS[SCRIPT_OF[l]] } : null }, w);
const enc = encodeURIComponent;

// Where a word of a language opens: Georgian → its word forms, Russian / English → the morpheme workbench,
// other courses → this tool's dictionary in that course.
function wordHref(l, w) {
  if (l === 'ka') return `#ka/tools/ka-forms/${enc(w)}`;
  if (l === 'ru' || l === 'en') return `#${l}/tools/morph/${enc(w)}`;
  if (courseById(l)) return `#${l}/tools/xl/dict/${enc(w)}`;
  return null;
}
const wordLink = (l, w) => { const href = wordHref(l, w); return href ? h('a', { class: 'xl-wl', href }, wordEl(l, w)) : wordEl(l, w); };

// --- word families ---------------------------------------------------------------------------------------------------
function linkCard(C, L0) {
  const langs = Object.keys(L0.words);
  return h('div', { class: 'ls-card xl-link xl-k-' + L0.kind },
    h('div', { class: 'xl-link-head' }, h('span', { class: 'ed-tag xl-kind' }, L(C, KINDS[L0.kind]))),
    h('table', { class: 'xl-link-table' }, h('tbody', null, langs.map((l) => h('tr', null, h('th', null, langName(C, l)),
      h('td', null, L0.words[l].map((x, i) => [i ? ', ' : '', wordLink(l, x.w), x.root ? h('small', { class: 'ed-muted' }, ' √' + x.root) : null])))))),
    h('p', { class: 'ls-note' }, L(C, L0.note)));
}

const LINK_SAMPLE = { ru: 'независимость', en: 'skyscraper', ka: 'დამოუკიდებლობა', xmf: 'წყარი', sa: 'bhrātṛ', ja: '経済', zh: '经济', ko: '학교' };
function linksPanel(C, arg) {
  const lang = C.course.id;
  const S = { q: arg || LINK_SAMPLE[lang] || '', kind: '' };
  const out = h('div', { class: 'ls-cards xl-links' });
  const run = () => {
    const own = S.q ? linksFor(lang, S.q) : [];
    const more = searchLinks(S.q, { kind: S.kind || null }).filter((x) => !own.includes(x));
    const list = [...own.filter((x) => !S.kind || x.kind === S.kind), ...more].slice(0, 60);
    out.replaceChildren(...(list.length ? list.map((x) => linkCard(C, x)) : [h('p', { class: 'ed-hint' }, t('ls.nothing'))]));
  };
  const inp = textInput(S.q, (v) => { S.q = v.trim(); run(); }, { type: 'search', lang: LANG_ATTR[lang], placeholder: t('xl.links.ph') });
  const kinds = seg([{ v: '', l: 'xl.all' }, ...Object.keys(KINDS).map((k) => ({ v: k, l: '=' + L(C, KINDS[k]) }))], '', (v) => { S.kind = v; run(); }, 'xl.kind');
  run();
  return h('div', { class: 'xl-panel' }, h('p', { class: 'ed-hint' }, t('xl.links.hint', { n: LINKS.length })), field(t('ls.tool.word'), inp), kinds, out);
}

// The morpheme workbench embeds the families of the parsed word.
export function linksInline(C, word, root) {
  const lang = C.course.id;
  const list = linksFor(lang, word, { root }).slice(0, 4);
  if (!list.length) return null;
  return h('div', { class: 'xl-inline' }, h('h4', null, t('xl.inline.title')), h('div', { class: 'ls-cards xl-links' }, list.map((x) => linkCard(C, x))),
    h('a', { class: 'ed-btn ed-sm', href: `#${lang}/tools/xl/links/${enc(word)}` }, t('xl.inline.more')));
}

// --- the dictionary across languages ---------------------------------------------------------------------------------
const glossText = (C, e) => { const g = e.gloss || e.m || {}; return g[C.lang] || g.ru || g.en || Object.values(g)[0] || ''; };
let BY_WORD = null;
const entryOf = (lang, w) => (BY_WORD ||= new Map(index().all.map((x) => [x.lang + '' + x.w, x]))).get(lang + '' + w);
// e: an index entry, or a word of the current course ({ w })
export function equivChips(C, e, { skip = [], max = 4 } = {}) {
  const idx = index();
  const ent = e._keys ? e : entryOf(C.course.id, e.w);
  if (!ent) return null;
  const by = equivalents(idx, ent, { limit: 2 });
  const langs = Object.keys(by).filter((l) => !skip.includes(l)).slice(0, max);
  if (!langs.length) return null;
  return h('div', { class: 'xl-equiv' }, langs.map((l) => h('span', { class: 'xl-eq' }, h('small', null, langName(C, l) + ': '),
    by[l].map((x, i) => [i ? ', ' : '', wordLink(l, x.e.w)]))));
}

function entryEl(C, hit) {
  const e = hit.e;
  const extra = [];
  if (e.lang === 'xmf' && e.ka) extra.push(h('p', { class: 'xl-cog' }, t('xl.dict.kaCognate') + ' ', wordLink('ka', e.ka), ' ', h('a', { class: 'ed-chip', href: `#xmf/tools/xmf-cognate/${enc(e.w)}` }, t('xl.dict.rules'))));
  if (e.lang === 'ka') { const cog = XMF.filter((x) => x.ka === e.w); if (cog.length) extra.push(h('p', { class: 'xl-cog' }, t('xl.dict.xmfCognate') + ' ', cog.map((x, i) => [i ? ', ' : '', h('a', { class: 'xl-wl', href: `#xmf/tools/xmf-cognate/${enc(x.w)}` }, wordEl('xmf', x.w))]))); }
  const links = linksFor(e.lang, e.w);
  return h('div', { class: 'ls-word xl-entry' },
    h('div', { class: 'ls-word-main' }, h('span', { class: 'ed-tag' }, langName(C, e.lang)), wordLink(e.lang, e.w), e.tr ? h('span', { class: 'ls-tr' }, e.tr) : null,
      hit.by === 'gloss' ? h('span', { class: 'ed-tag xl-back' }, t('xl.dict.back', { l: langName(C, hit.pivot) })) : null, e.unverified ? h('span', { class: 'ed-tag lx-unknown' }, t('lx.unverified')) : null),
    h('div', { class: 'ls-m' }, glossText(C, e)), ...extra,
    equivChips(C, e, { max: 6 }),
    links.length ? h('div', { class: 'xl-equiv' }, h('small', null, t('xl.dict.family') + ' '), links.slice(0, 3).map((x) => h('a', { class: 'ed-chip', href: `#${C.course.id}/tools/xl/links/${enc(e.w)}` }, L(C, KINDS[x.kind])))) : null);
}

const DICT_SAMPLE = { ka: 'вода', xmf: 'вода', ru: 'дом', en: 'water', sa: 'fire', ja: 'вода', zh: 'вода', ko: 'дом' };
function dictPanel(C, arg) {
  const S = { q: arg || DICT_SAMPLE[C.course.id] || 'вода', only: '' };
  const out = h('div', { class: 'ls-words xl-dict' });
  const run = () => {
    const hits = lookup(index(), S.q, { langs: S.only ? [S.only] : null, limit: 40 });
    out.replaceChildren(...(hits.length ? hits.map((x) => entryEl(C, x)) : [h('p', { class: 'ed-hint' }, t('ls.nothing'))]));
  };
  const langs = [...new Set(allEntries().map((e) => e.lang))];
  const inp = textInput(S.q, (v) => { S.q = v; clearTimeout(inp._t); inp._t = setTimeout(run, 200); }, { type: 'search', placeholder: t('xl.dict.ph') });
  run();
  return h('div', { class: 'xl-panel' }, h('p', { class: 'ed-hint' }, t('xl.dict.hint', { n: allEntries().length })),
    h('div', { class: 'ls-ctl' }, field(t('ls.tool.word'), inp), field(t('xl.dict.only'), select([{ v: '', l: 'xl.all' }, ...langs.map((l) => ({ v: l, l: '=' + langName(C, l) }))], '', (v) => { S.only = v; run(); }))),
    h('div', { class: 'ed-chips' }, ['вода', 'water', 'სახლი', 'дружба', 'book', 'мать', '물'].map((x) => h('button', { type: 'button', class: 'ed-chip', onclick: () => { inp.value = x; S.q = x; run(); } }, x))), out);
}

// --- typing every script ---------------------------------------------------------------------------------------------
const TYPE_DEFAULT = { ka: 'ka', xmf: 'xmf', ru: 'ru', sa: 'sa', ja: 'hira', zh: 'pinyin', ko: 'ko', en: 'ru' };
const noTone = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ü/g, 'u');
function typePanel(C) {
  const S = { target: TYPE_DEFAULT[C.course.id] || 'ka' };
  const T0 = () => TARGETS.find((x) => x.id === S.target);
  const out = h('div', { class: 'ls-out' });
  const run = () => {
    const r = typeIn(area.value, S.target);
    const tg = T0();
    const big = h('div', { class: 'ls-big xl-typed', lang: tg.lang, style: { fontFamily: FONTS[tg.script] } }, r.text || '…');
    const res = [big, h('div', { class: 'ap-actions' }, h('button', { type: 'button', class: 'ed-btn', onclick: () => copyText(r.text) }, t('lx.copy')),
      tg.lang === C.course.id && C.canSpeak ? h('button', { type: 'button', class: 'ed-btn', onclick: () => C.speak(r.text) }, t('ls.listen')) : null)];
    if (r.iast) res.push(h('p', { class: 'ls-tr' }, 'IAST: ' + r.iast));
    if (r.alts.length) res.push(h('div', { class: 'ls-also' }, h('b', null, t('lx.alternatives') + ' '), r.alts.map(([w, opts]) => h('span', { class: 'xl-alt' }, h('small', null, w + ': '), opts.map((o) => h('span', { class: 'ed-chip', lang: tg.lang }, o))))));
    if (S.target === 'pinyin') {
      // characters of the course whose reading matches each syllable
      const syl = r.text.split(/[\s,，.]+/).filter(Boolean);
      const cand = syl.map((s) => [s, CHARS.filter((c) => c.py && (c.py === s || (noTone(s) === s && noTone(c.py) === s))).map((c) => c.zh)]);
      if (cand.some(([, l]) => l.length)) res.push(h('div', { class: 'ls-also' }, h('b', null, t('xl.type.hanzi') + ' '), cand.map(([s, l]) => h('span', { class: 'xl-alt' }, h('small', null, s + ': '), l.length ? l.map((x) => h('span', { class: 'ed-chip', lang: 'zh' }, x)) : '—'))));
    }
    out.replaceChildren(...res);
  };
  const area = textInput(T0().sample, () => run(), { multiline: true, rows: 3 });
  const hint = h('p', { class: 'ed-hint' }, t('xl.type.how.' + S.target));
  const sel = select(TARGETS.map((x) => ({ v: x.id, l: 'xl.type.t.' + x.id })), S.target, (v) => { S.target = v; area.value = T0().sample; hint.textContent = t('xl.type.how.' + v); run(); });
  run();
  return h('div', { class: 'xl-panel' }, h('p', { class: 'ed-hint' }, t('xl.type.hint')), h('div', { class: 'ls-ctl' }, field(t('xl.type.target'), sel)), hint, field(t('xl.type.input'), area), out);
}

// --- decks between any two languages --------------------------------------------------------------------------------
function deckPanel(C) {
  const entries = allEntries();
  const langs = deckLanguages(entries).filter((l) => LANG_NAMES[l]);
  const S = { from: C.lang, to: C.course.id === C.lang ? (C.lang === 'ru' ? 'en' : 'ru') : C.course.id };
  const info = h('div', { class: 'xl-deck-info' });
  const stage = h('div', { class: 'ls-stage xl-deck' });
  let pairs = [];
  const now = () => Date.now();
  const refresh = () => {
    pairs = deckPairs(entries, S.from, S.to);
    const ids = pairs.map((p) => p.id);
    const due = ids.filter((id) => C.doc.cards[id] && C.doc.cards[id].d <= now()).length;
    const learned = ids.filter((id) => C.doc.cards[id] && C.doc.cards[id].n > 0).length;
    const via = pairs.filter((p) => p.via !== 'gloss').length;
    info.replaceChildren(h('p', null, t('xl.deck.count', { n: pairs.length, l: learned, d: due })), via ? h('p', { class: 'ed-hint' }, t('xl.deck.via', { n: via })) : null,
      h('button', { type: 'button', class: 'ed-btn ed-primary', disabled: !pairs.length, onclick: start }, t('xl.deck.start')));
    stage.replaceChildren();
  };
  const start = () => {
    const ids = dueItems(C.doc.cards, pairs.map((p) => p.id), now(), 20);
    const byId = new Map(pairs.map((p) => [p.id, p]));
    let i = 0, sum = 0;
    const next = () => {
      const p = byId.get(ids[i]);
      if (!p) { stage.replaceChildren(h('div', { class: 'ls-final' }, h('p', null, ids.length ? t('xl.deck.done', { n: ids.length, s: Math.round((sum / Math.max(1, ids.length)) * 100) }) : t('ls.game.nothingDue')), h('button', { type: 'button', class: 'ed-btn', onclick: refresh }, t('ls.back')))); return; }
      const backSide = h('div', { class: 'ls-explain', hidden: true }, wordEl(p.back.lang, p.back.w), p.back.tr ? h('span', { class: 'ls-tr' }, p.back.tr) : null,
        p.via !== 'gloss' ? h('span', { class: 'ed-tag' }, t('xl.deck.through', { l: langName(C, p.via) })) : null);
      const grades = h('div', { class: 'ls-grades', hidden: true }, [0, 1, 2, 3].map((g) => h('button', { type: 'button', class: 'ed-btn ls-g' + g, onclick: () => { C.doc.cards[p.id] = review(C.doc.cards[p.id], g); sum += g / 3; C.save(); i++; next(); } }, t('ls.grade.' + g))));
      const show = h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => { backSide.hidden = false; grades.hidden = false; show.hidden = true; } }, t('ls.game.show'));
      const card = C.doc.cards[p.id];
      stage.replaceChildren(h('div', { class: 'ls-gprog' }, h('span', null, t('ls.game.round', { i: i + 1, n: ids.length })), card ? h('span', { class: 'ed-hint' }, t('ls.strength', { n: Math.round(strength(card) * 100) })) : null),
        h('div', { class: 'ls-q' }, h('span', { class: 'ed-tag' }, langName(C, p.front.lang) + ' → ' + langName(C, p.back.lang)), h('span', { class: 'ls-glyph ls-glyph-word' }, wordEl(p.front.lang, p.front.w)), p.front.tr ? h('span', { class: 'ls-tr' }, p.front.tr) : null),
        backSide, show, grades);
      setTimeout(() => show.focus(), 20);
    };
    next();
  };
  const opts = langs.map((l) => ({ v: l, l: '=' + langName(C, l) }));
  const swap = h('button', { type: 'button', class: 'ed-btn', title: t('xl.deck.swap'), 'aria-label': t('xl.deck.swap'), onclick: () => { [S.from, S.to] = [S.to, S.from]; fromSel.set(S.from); toSel.set(S.to); refresh(); } }, '⇄');
  const fromSel = select(opts, S.from, (v) => { S.from = v; refresh(); });
  const toSel = select(opts, S.to, (v) => { S.to = v; refresh(); });
  refresh();
  return h('div', { class: 'xl-panel' }, h('p', { class: 'ed-hint' }, t('xl.deck.hint')), h('div', { class: 'ls-ctl xl-deck-ctl' }, field(t('xl.deck.from'), fromSel), swap, field(t('xl.deck.to'), toSel)), info, stage);
}

// --- parallel texts --------------------------------------------------------------------------------------------------
const ANALYSED = ['ka', 'ru', 'en'];
// texts in other scripts are aligned but not analysed
const langOf = (text) => (/[ऀ-ॿ぀-ヿ㐀-鿿가-힯]/.test(text) ? 'other' : detectLang(text));
function entitiesOn(text, lang, sentences) {
  const an = analyzeText(text, { lang });
  const map = mapSentences(text, an.sentences.map((s) => s.text), sentences);
  return { entities: an.entities.map((e) => ({ ...e, mentions: e.mentions.map((m) => ({ ...m, s: map[m.s] })) })) };
}
// Two entity labels translate each other when some dictionary entry glosses one in one language and the other in
// the other (directly, or a Georgian entry glossed in both Russian and English).
const stem = (e) => (e.key && e.key.length >= 3 ? e.key : String(e.label).toLowerCase());
function sameByDictionary(la, lb) {
  const idx = index();
  const fits = (key, k) => key.length >= 3 && (k === key || k.startsWith(key));
  const cache = new Map();
  const sensesOf = (e, l) => {
    const ck = l + ':' + e.id;
    if (cache.has(ck)) return cache.get(ck);
    const own = new Set();
    // entries headed by the word, and entries glossed with it
    for (const x of lookup(idx, e.label, { limit: 12 })) own.add(x.e);
    const st = stem(e);
    for (const x of idx.all) if ((x.lang === l && fits(st, headKey(x.w))) || (x._keys && (x._keys[l] || []).some((k) => fits(st, k)))) own.add(x);
    cache.set(ck, own);
    return own;
  };
  return (ea, eb) => {
    const A = sensesOf(ea, la), B = sensesOf(eb, lb);
    for (const x of A) if (B.has(x)) return true;
    return false;
  };
}
function parallelPanel(C) {
  const pair0 = C.course.id === 'en' ? ['en', 'ru'] : C.course.id === 'ru' ? ['ru', 'en'] : ['ka', 'ru'];
  const S = { text: 'legend', a: pair0[0], b: pair0[1] };
  const out = h('div', { class: 'ls-out' });
  const areaA = textInput('', () => later(), { multiline: true, rows: 6 });
  const areaB = textInput('', () => later(), { multiline: true, rows: 6 });
  const load = () => { const p = PARALLEL.find((x) => x.id === S.text); areaA.value = p.texts[S.a]; areaB.value = p.texts[S.b]; areaA.lang = S.a; areaB.lang = S.b; draw(); };
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(draw, 350); };
  const draw = () => {
    const la = langOf(areaA.value), lb = langOf(areaB.value);
    const sa = sentencesOf(areaA.value), sb = sentencesOf(areaB.value);
    // entities by lingua/discourse.js, their mentions moved onto the sentences that are aligned
    const anA = ANALYSED.includes(la) ? entitiesOn(areaA.value, la, sa) : null, anB = ANALYSED.includes(lb) ? entitiesOn(areaB.value, lb, sb) : null;
    const al = alignSentences(sa, sb);
    const matches = anA && anB ? matchEntities(al.beads, anA.entities, anB.entities, { same: sameByDictionary(la, lb) }) : [];
    // one colour per matched pair, the same on both sides
    const colourA = new Map(), colourB = new Map();
    matches.forEach((m, i) => { colourA.set(m.a, i % 8); colourB.set(m.b, i % 8); });
    const marks = (an, colour, si, text) => {
      if (!an) return [text];
      const tok = new Map();
      for (const e of an.entities) if (colour.has(e.id)) for (const m of e.mentions) if (m.s === si) tok.set(m.t, { c: colour.get(e.id), label: e.label });
      return text.split(/(\s+|[,.!?;:—–«»„“"()]+)/).map((p) => (tok.has(p) ? h('mark', { class: 'xl-ent lx-c' + tok.get(p).c, title: tok.get(p).label }, p) : p));
    };
    const rows = al.beads.map((b) => h('tr', { class: b.a.length === 1 && b.b.length === 1 ? '' : 'xl-bead-odd' },
      h('td', { lang: la }, b.a.map((i) => h('p', null, ...marks(anA, colourA, i, sa[i])))),
      h('td', { lang: lb }, b.b.map((i) => h('p', null, ...marks(anB, colourB, i, sb[i])))),
      h('td', { class: 'xl-bead' }, h('span', { class: 'ed-tag' }, b.a.length + '–' + b.b.length), b.anchors.map((x) => h('span', { class: 'ed-chip xl-anchor' }, x.replace(/^#/, ''))))));
    const ent = (an, id) => an.entities.find((e) => e.id === id);
    out.replaceChildren(
      h('div', { class: 'lx-stats' }, h('div', { class: 'cg-stat lx-stat' }, h('small', null, t('lx.sentences')), h('b', null, `${sa.length} / ${sb.length}`)), h('div', { class: 'cg-stat lx-stat' }, h('small', null, t('xl.par.beads')), h('b', null, String(al.beads.length))), h('div', { class: 'cg-stat lx-stat' }, h('small', null, t('xl.par.matched')), h('b', null, String(matches.length)))),
      h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table ls-table xl-par' }, h('thead', null, h('tr', null, h('th', null, langName(C, la)), h('th', null, langName(C, lb)), h('th', null, ''))), h('tbody', null, rows))),
      matches.length ? h('div', null, h('h4', null, t('xl.par.entities')), h('div', { class: 'xl-ents' }, matches.map((m, i) => h('div', { class: 'xl-entpair' },
        h('mark', { class: 'xl-ent lx-c' + (i % 8), lang: la }, ent(anA, m.a).label), ' ↔ ', h('mark', { class: 'xl-ent lx-c' + (i % 8), lang: lb }, ent(anB, m.b).label),
        h('small', { class: 'ed-muted' }, ' · ' + t('xl.par.by.' + m.by) + (m.by === 'cooccurrence' ? ' ' + m.score : '')))))) : !anA || !anB ? h('p', { class: 'ed-hint' }, t('xl.par.noEntities')) : null);
  };
  const pairs = [['ka', 'ru'], ['ka', 'en'], ['ru', 'en'], ['en', 'ru']];
  const textSel = select(PARALLEL.map((p) => ({ v: p.id, l: '=' + L(C, p.title) })), S.text, (v) => { S.text = v; load(); });
  const pairSel = select(pairs.map(([a, b]) => ({ v: a + '-' + b, l: '=' + langName(C, a) + ' ↔ ' + langName(C, b) })), S.a + '-' + S.b, (v) => { [S.a, S.b] = v.split('-'); load(); });
  load();
  return h('div', { class: 'xl-panel' }, h('p', { class: 'ed-hint' }, t('xl.par.hint')), h('div', { class: 'ls-ctl' }, field(t('xl.par.text'), textSel), field(t('xl.par.pair'), pairSel)),
    h('div', { class: 'xl-par-in' }, field(t('xl.par.a'), areaA), field(t('xl.par.b'), areaB)), out);
}

// --- the Georgian sentence designer: the same structure in Russian or English -----------------------------------------
const CASE_KA = { nom: 'სახ.', erg: 'მოთხ.', dat: 'მიც.', gen: 'ნათ.', ins: 'მოქმ.', adv: 'ვით.', tvis: '-თვის' };
export function contrastEl(C, r, state = { to: 'ru' }) {
  const box = h('div', { class: 'xl-contrast' });
  const draw = () => {
    const c = contrastSentence(r, state.to);
    box.replaceChildren(
      h('h4', null, t('xl.con.title', { l: langName(C, state.to) })),
      seg([{ v: 'ru', l: '=' + langName(C, 'ru') }, { v: 'en', l: '=' + langName(C, 'en') }], state.to, (v) => { state.to = v; draw(); }, 'xl.con.title'),
      h('p', { class: 'xl-gloss', lang: state.to }, c.gloss),
      h('p', null, h('b', null, t('xl.con.verb') + ' '), L(C, c.verb.label), h('span', { class: 'ed-tag' }, t('xl.con.series', { n: ['I', 'II', 'III'][c.verb.series - 1] }))),
      h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table ls-table' }, h('thead', null, h('tr', null, h('th', null, t('xl.con.ka')), h('th', null, ''), h('th', null, langName(C, state.to)))),
        h('tbody', null, c.rows.map((x) => h('tr', null, h('td', { lang: 'ka' }, h('b', null, x.ka), x.kaCase ? h('small', { class: 'ed-muted' }, ' ' + (CASE_KA[x.kaCase] || x.kaCase)) : null), h('td', null, h('b', { lang: state.to }, x.form)), h('td', { class: 'ls-note' }, L(C, x.label))))))),
      ...c.notes.map((n) => h('p', { class: 'lx-note' }, 'ℹ ' + L(C, n))));
  };
  draw();
  return box;
}

// --- the tool ----------------------------------------------------------------------------------------------------------
const PANELS = { links: linksPanel, dict: dictPanel, type: typePanel, deck: deckPanel, parallel: parallelPanel };
function xlTool(C, arg) {
  const [p0, ...rest] = String(arg || '').split('/');
  const panels = Object.keys(PANELS).filter((p) => p !== 'parallel' || ['ka', 'ru', 'en'].includes(C.course.id));
  const p = panels.includes(p0) ? p0 : 'links';
  const a = rest.length ? decodeURIComponent(rest.join('/')) : null;
  return h('div', { class: 'ls-tool xl-tool' },
    h('nav', { class: 'xl-panels', 'aria-label': t('xl.t.xl') }, panels.map((x) => h('a', { href: `#${C.course.id}/tools/xl/${x}`, class: 'ed-chip xl-pn' + (x === p ? ' ed-on' : ''), 'aria-current': x === p ? 'page' : null, dataset: { panel: x } }, t('xl.p.' + x)))),
    PANELS[p](C, a));
}

export const XL_TOOLS = { xl: { title: 'xl.t.xl', render: xlTool } };
