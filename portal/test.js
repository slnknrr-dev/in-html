// portal/test.js - unit tests of the portal library: `node portal/test.js` (also `node check.js tests portal`).
// Folding and inflection-tolerant matching, alphabet indexes (Georgian, Russian, Ukrainian, Latin with diacritics,
// mixed scripts), legal numbering (inserted articles, natural order, outline, paragraph structure, references in seven
// languages, act names next to references, links), glossary matching and linking, facets, prices, budgets, dates,
// request matching, the unified search, the site catalog, every block's markup through a plain view adapter, the CSS
// chunks, the runtime features (serializable, run in a VM with a small fake DOM: lists, checklist, copy link, folding
// identical to text.js) and the completeness of the strings in all seven languages.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { escapeHTML } from '../html/escape.js';
import { fold, highlight, slugId, splitList, stemEq, terms, words } from './text.js';
import { alphaIndex, alphabetOf, letterOf } from './alphabet.js';
import { actHint, aliasWords, compareNum, findRefs, isGone, linkRefs, numHTML, numKey, numText, outline, parseBody, parseChanges, parseNum, subKey } from './legal.js';
import { groupTerms, linkTerms, termKey, termMatcher } from './glossary.js';
import { budgetParts, daysUntil, facetOptions, matchEntries, money, priceParts, ratingSummary, recommendScore } from './records.js';
import { searchIndex } from './search.js';
import { buildCatalog } from './catalog.js';
import { PT_BLOCKS, PT_TYPES, defaults, itemDefaults } from './models.js';
import { PT_RENDER, mtavruli } from './markup.js';
import { PT_CSS, PT_TYPE_CHUNKS, portalCSS } from './css.js';
import { PT_FEATURES, PT_FEATURE_ORDER } from './runtime.js';
import { PT_LANGS, PT_UI, ptT } from './strings.js';
import { PT_EDITOR, ptFieldLabel, ptOptionLabel } from './strings-editor.js';
import { mapText } from './segments.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* ---------- a plain view adapter: values are strings or { lang: string } ---------- */

// Minimal view adapter (V) over plain values: lets the markup builders be tested without either host application.
export function plainView(b, { cat = null, langs = ['en'], lang = langs[0], p = 'xp', page = 'p1', today = null, edit = false } = {}) {
  const pick = (v, l) => (v == null ? '' : typeof v === 'object' ? String(v[l] ?? v[lang] ?? Object.values(v)[0] ?? '') : String(v));
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), b);
  const per = (fn) => {
    if (langs.length < 2) return fn(langs[0]);
    const m = new Map();
    for (const l of langs) { const v = fn(l); m.set(v, [...(m.get(v) || []), l]); }
    if (m.size === 1) return [...m.keys()][0];
    return [...m].map(([v, ls]) => (v ? `<span data-l="${ls.join(' ')}">${v}</span>` : '')).join('');
  };
  const longIn = (v, l) => pick(v, l).split(/\n\s*\n/).filter((x) => x.trim()).map((x) => `<p>${escapeHTML(x.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  const T = Object.fromEntries(langs.map((l) => [l, ptT(l)]));
  return {
    p, edit, langs, lang, page, cat, today: today ?? Math.floor(Date.UTC(2026, 9, 17) / 864e5), b,
    f: (path, kind, tag, cls) => {
      const v = get(path);
      const html = per((l) => (kind === 'long' ? longIn(v, l) : escapeHTML(pick(v, l))));
      return html ? (tag ? `<${tag}${cls ? ` class="${cls}"` : ''}>${html}</${tag}>` : html) : '';
    },
    has: (v) => langs.some((l) => !!pick(v, l).trim()),
    plain: (v, l) => pick(v, l),
    raw: (v, l) => pick(v, l),
    lineIn: (v, l) => escapeHTML(pick(v, l)),
    longIn,
    inline: (s) => escapeHTML(s),
    per,
    t: (k, vars) => per((l) => escapeHTML(T[l](k, vars))),
    tl: (k, l, vars) => T[l] ? T[l](k, vars) : ptT(l)(k, vars),
    attr: (name, fn) => ` ${name}="${escapeHTML(fn(lang))}"`,
    link: (v) => { const s = pick(v, lang).trim(); return s ? { href: s, ext: /^https?:/.test(s), title: '' } : null; },
    a: (href, cls, extra = '') => `<a${cls ? ` class="${cls}"` : ''} href="${escapeHTML(href)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}${extra}>`,
    img: (id, o = {}) => (id ? `<img src="${escapeHTML(id)}.png" alt="${escapeHTML(o.alt || '')}"${o.cls ? ` class="${o.cls}"` : ''}>` : ''),
    file: (id) => (id ? { href: id + '.pdf', name: id + '.pdf', type: 'application/pdf', size: 123456 } : null),
    date: (d, l) => { try { return new Intl.DateTimeFormat(l, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z')); } catch { return d; } },
    icon: (n) => `<i data-icon="${n}"></i>`,
    href: (a) => '#' + a,
    feature: (f) => { (plainView.used || (plainView.used = new Set())).add(f); },
    need: () => {},
    di: (i) => (edit ? ` data-item="${i}"` : ''),
  };
}

/* ---------- fixtures ---------- */

const ACT = {
  id: 'actblock1', type: 'act', ...defaults('act'), title: { en: 'Tax Code', ru: 'Налоговый кодекс' }, actType: { en: 'Code', ru: 'Кодекс' }, key: 'tax',
  aliases: { en: 'Tax Code', ru: 'Налоговый кодекс' }, number: '1234-IV', adopted: '2010-09-17', revised: '2026-04-01', status: 'amended', topics: { en: 'Taxes', ru: 'Налоги' },
  changes: { en: '2027-09-01: Articles 2 and 3 — new rates', ru: '2027-09-01: статьи 2 и 3 — новые ставки' },
  items: [
    { kind: 'chapter', num: 'I', title: { en: 'General provisions', ru: 'Общие положения' } },
    { kind: 'article', num: '1', title: { en: 'Scope', ru: 'Сфера' }, body: { en: '1. This Code governs taxes.\n2. Terms of Article 2 apply.\na) value added tax;\nb) excise.', ru: '1. Кодекс регулирует налоги.\n2. Применяются термины статьи 2.\nа) налог на добавленную стоимость;\nб) акциз.' } },
    { kind: 'article', num: '2', title: { en: 'Terms', ru: 'Термины' }, body: { en: '1. A taxpayer pays value added tax under paragraph 2 of Article 1.', ru: '1. Налогоплательщик уплачивает налог на добавленную стоимость по пункту 2 статьи 1.' }, tags: { en: 'VAT', ru: 'НДС' } },
    { kind: 'article', num: '2^1', title: { en: 'Inserted', ru: 'Вставленная' }, body: 'Text.' },
    { kind: 'chapter', num: 'II', title: { en: 'Rates', ru: 'Ставки' } },
    { kind: 'article', num: '3', status: 'repealed', title: '', body: '' },
  ],
};
const TERMS = {
  id: 'termsblock', type: 'terms', ...defaults('terms'), title: { en: 'Glossary', ru: 'Глоссарий' },
  items: [
    { term: { en: 'Value added tax', ru: 'Налог на добавленную стоимость' }, alt: { en: 'VAT', ru: 'НДС' }, def: { en: 'A tax on the value added at each stage.', ru: 'Налог на добавленную стоимость на каждом этапе.' }, source: { en: 'Tax Code, Article 2', ru: 'Налоговый кодекс, статья 2' }, related: { en: 'Taxpayer', ru: 'Налогоплательщик' }, tags: { en: 'Taxes', ru: 'Налоги' } },
    { term: { en: 'Taxpayer', ru: 'Налогоплательщик' }, def: { en: 'A person who pays value added tax.', ru: 'Лицо, уплачивающее налог.' }, tags: { en: 'Taxes', ru: 'Налоги' } },
    { term: { en: 'Value added tax', ru: 'Налог на добавленную стоимость' }, def: { en: 'Second definition from another act.', ru: 'Второе определение.' } },
  ].map((x) => ({ ...itemDefaults('terms'), ...x })),
};
const DIR = {
  id: 'dirblock01', type: 'directory', ...defaults('directory'), title: 'Specialists',
  items: [
    { kind: 'person', name: 'Nino Example', role: 'Tax lawyer', areas: 'Taxes, Corporate', langs: 'Georgian, English', city: 'Tbilisi', years: 12, rating: 4.8, reviews: 31, price: 100, priceKind: 'from', verified: true, phone: '+995 555 12 34 56', email: 'nino@example.org' },
    { kind: 'firm', name: 'Example & Partners', role: 'Law firm', areas: 'Corporate', langs: 'English', city: 'Batumi', rating: 4.2, reviews: 5, priceKind: 'ask', tier: 'Established' },
    { kind: 'person', name: 'Giorgi Sample', role: 'Notary', areas: 'Real estate', langs: 'Georgian', city: 'Tbilisi', status: 'away' },
  ].map((x) => ({ ...itemDefaults('directory'), ...x })),
};
const BOARD = {
  id: 'boardblock', type: 'board', ...defaults('board'), title: 'Open requests',
  items: [
    { title: 'Register a VAT payer', body: 'Need help under Article 2 of the Tax Code.', category: 'Taxes', budgetKind: 'range', budget: 300, budgetMax: 600, city: 'Tbilisi', posted: '2026-10-14', closes: '2026-10-19', status: 'open', responses: 2, langs: 'English' },
    { title: 'Company charter', body: 'Draft a charter.', category: 'Corporate', budgetKind: 'unsure', remote: true, posted: '2026-10-01', status: 'closed' },
  ].map((x) => ({ ...itemDefaults('board'), ...x })),
};
const HUB = { id: 'hubblock01', type: 'hub', ...defaults('hub'), topic: { en: 'Taxes', ru: 'Налоги' }, items: [] };
const HUBX = { id: 'hubblock02', type: 'hub', ...defaults('hub'), topic: '', items: [{ title: 'Taxes', topic: 'Taxes', text: 'All about taxes', href: '#taxes' }] };
const CHECK = {
  id: 'checkblock', type: 'checklist', ...defaults('checklist'), title: 'Monthly',
  items: [{ label: 'Returns', group: true }, { label: 'File the value added tax return', body: 'By the 15th, see Article 2 of the Tax Code.', due: '15th of each month', ref: 'Tax Code, Article 2' }, { label: 'Pay' }].map((x) => ({ ...itemDefaults('checklist'), ...x })),
};
const FINDER = { id: 'findblock1', type: 'finder', ...defaults('finder'), title: 'Search', suggest: 'VAT, taxpayer', items: [] };

function siteCatalog(langs = ['en', 'ru']) {
  const pick = (v, l) => (v == null ? '' : typeof v === 'object' ? String(v[l] ?? v.en ?? '') : String(v));
  return buildCatalog([ACT, TERMS, DIR, BOARD, HUB, CHECK].map((block) => ({ block, page: 'p1', href: (a) => '#' + a })), {
    langs, lang: langs[0], plain: pick, raw: pick, unitLabel: (k, n, l) => ptT(l)('pt.u.' + k, { n }),
  });
}

/* ---------- a small fake DOM for the runtime ---------- */

// Fake DOM with only the selector and node features the runtime uses: proves the runtime needs nothing beyond them.
function fakeDOM(html) {
  // Elements: { tag, attrs, children, parentNode, hidden, value, checked, textContent }
  const listeners = {};
  const mk = (tag, attrs = {}) => ({
    tag, attrs, children: [], parentNode: null, hidden: false, value: attrs.value || '', checked: false, _text: '', style: {}, id: attrs.id || '',
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }, set textContent(v) { this._text = String(v); this.children = []; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    appendChild(c) { if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; },
    get firstChild() { return this.children[0] || null; },
    addEventListener(t, fn) { (this.listeners || (this.listeners = {}))[t] = [...((this.listeners || {})[t] || []), fn]; },
    dispatch(t, extra = {}) { for (const fn of (this.listeners || {})[t] || []) fn({ target: this, currentTarget: this, preventDefault() {}, ...extra }); },
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } }; walk(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    closest(sel) { for (let n = this; n; n = n.parentNode) if (n.attrs && matches(n, sel)) return n; return null; },
    contains(x) { for (let n = x; n; n = n.parentNode) if (n === this) return true; return false; },
    get clientWidth() { return 1000; },
    focus() {}, select() {},
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  });
  // Selectors: [attr], [attr="v"], tag[attr], comma lists, ':not([hidden])' suffix.
  function matches(el, sel) {
    return sel.split(',').some((s0) => {
      let s = s0.trim();
      let notHidden = false;
      if (s.endsWith(':not([hidden])')) { notHidden = true; s = s.slice(0, -14); }
      const m = /^([a-z]*)((?:\[[^\]]+\])*)$/.exec(s);
      if (!m) return false;
      if (m[1] && el.tag !== m[1]) return false;
      for (const a of m[2].match(/\[[^\]]+\]/g) || []) {
        const x = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a);
        if (!x || !el.hasAttribute(x[1])) return false;
        if (x[2] != null && el.getAttribute(x[1]) !== x[2]) return false;
      }
      return !(notHidden && el.hidden);
    });
  }
  // Tiny HTML parser for the fixtures (well-formed markup of markup.js).
  const doc = mk('#document');
  const root = mk('html', { lang: 'en' });
  doc.appendChild(root);
  const body = mk('body');
  root.appendChild(body);
  const stack = [body];
  const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
  const re = /<!--[\s\S]*?-->|<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { const i = stack.map((x) => x.tag).lastIndexOf(m[1].toLowerCase()); if (i > 0) stack.length = i; continue; }
    if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = (a[2] ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const el = mk(m[2].toLowerCase(), attrs);
      if ('hidden' in attrs) el.hidden = true;
      if ('checked' in attrs) el.checked = true;
      stack[stack.length - 1].appendChild(el);
      if (!VOID.has(el.tag)) stack.push(el);
      continue;
    }
    if (m[4] && m[4].trim()) { const t = mk('#text'); t._text = m[4]; stack[stack.length - 1].appendChild(t); }
  }
  const all = () => { const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(doc); return out; };
  Object.assign(doc, {
    documentElement: root, body,
    createElement: (t) => mk(t), createTextNode: (s) => { const t = mk('#text'); t._text = s; return t; },
    getElementById: (id) => all().find((e) => e.id === id) || null,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    fire: (t, target) => { for (const fn of listeners[t] || []) fn({ target, preventDefault() {} }); },
  });
  return doc;
}

// Runtime features are serialized with toString and run in a vm context, exactly as exported pages receive them.
function runRuntime(html, features, extra = {}, store = new Map()) {
  const document = fakeDOM(html);
  const timers = [];
  const ctx = {
    document, window: {}, navigator: {}, location: { href: 'https://example.org/legal/', pathname: '/legal/' },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, Intl, JSON, Math, Date, String, Number, Object, Array, Boolean, RegExp, Error,
    ...extra,
  };
  ctx.window = ctx;
  const R = { t: (k, v) => ptT('en')(k, v), lang: () => 'en', store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, sid: 'site1' };
  ctx.R = R;
  vm.createContext(ctx);
  for (const f of features) vm.runInContext(`(${PT_FEATURES[f].toString()})(R)`, ctx);
  const flush = () => { while (timers.length) timers.shift()(); };
  return { document, R, store, flush };
}

/* ---------- tests ---------- */

export async function run() {
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  x ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : '')); } };
  const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });

  // text
  eq('fold', fold('  Ёлка  Ärger ß '), 'елка arger ss');
  eq('words', words('Article 12¹, “VAT”-rules; ბანკის'), ['article', '121', 'vat', 'rules', 'ბანკის']);
  eq('terms unique', terms('tax Tax TAX code'), ['tax', 'code']);
  for (const [a, b, want] of [['налоговый', 'налогового', true], ['кодекс', 'кодекса', true], ['ბანკი', 'ბანკმა', true], ['კოდექსი', 'კოდექსის', true], ['tax', 'taxes', true], ['agent', 'agency', false], ['tax', 'taxi', false], ['bank', 'bonus', false], ['налог', 'наложение', false]]) eq(`stemEq ${a}/${b}`, stemEq(a, b), want);
  ok('highlight marks folded matches', /<mark>Ärger<\/mark>/.test(highlight('Viel Ärger hier', ['arger'])));
  ok('highlight escapes', highlight('<b>tax</b>', ['tax']).includes('&lt;b&gt;<mark>tax</mark>'));
  eq('slugId', [slugId('საგადასახადო კოდექსი'), slugId('Налоговый кодекс'), slugId('  ', 'x')], ['sagadasakhado-kodeksi', 'nalogovyi-kodeks', 'x']);
  eq('splitList', splitList('a, b; A\nc'), ['a', 'b', 'c']);

  // alphabet
  eq('ka alphabet size', alphabetOf('ka').length, 33);
  eq('letters', [letterOf('ბანკი', 'ka').key, letterOf('Ёлка', 'ru').key, letterOf('Їжак', 'uk').key, letterOf('Йод', 'ru').key, letterOf('Ñandú', 'es').key, letterOf('Äpfel', 'de').key, letterOf('Élan', 'fr').key, letterOf('2fa', 'en').key, letterOf('«Quote»', 'en').key],
    ['ბ', 'Е', 'Ї', 'Й', 'Ñ', 'A', 'E', '0–9', 'Q']);
  eq('Mtavruli is filed under Mkhedruli', letterOf('Ა', 'ka').key, 'ა');
  const ix = alphaIndex(['ბანკი', 'აქცია', 'VAT', 'Bank', 'дебет', '12 rule', 'ერთეული'], { lang: 'ka' });
  eq('alpha: primary alphabet first, other scripts after, digits last', ix.groups.map((g) => g.key), ['ა', 'ბ', 'ე', 'Д', 'B', 'V', '0–9']);
  eq('alpha: full primary alphabet', ix.letters.filter((l) => l.script === 'ka').length, 33);
  eq('alpha: ids ascii', ix.groups.map((g) => g.id), ['ka-1', 'ka-2', 'ka-5', 'cyrl-5', 'latn-b', 'latn-v', 'num']);
  eq('alpha ru: Ё under Е, collation', alphaIndex(['ёж', 'еда', 'Яблоко'], { lang: 'ru', full: false }).groups.map((g) => [g.key, g.items]), [['Е', ['еда', 'ёж']], ['Я', ['Яблоко']]]);
  eq('mtavruli', mtavruli('ბანკი'), 'ᲑᲐᲜᲙᲘ');

  // legal numbers
  eq('parseNum', [parseNum('12^1'), parseNum('37¹⁰').ins, parseNum('IV').base, parseNum('abc').base], [{ base: 12, ins: [1], roman: false, raw: '12^1' }, [10], 4, null]);
  eq('numKey / numHTML / numText', [numKey('12¹'), numKey('12^1^2'), numHTML('12^1'), numText('12^10'), numKey('IV')], ['12-1', '12-1-2', '12<sup>1</sup>', '12¹⁰', 'iv']);
  eq('natural order', ['37¹⁰', '37²', '37¹', '37', '38', '3', '70²', '70'].sort(compareNum), ['3', '37', '37¹', '37²', '37¹⁰', '38', '70', '70²']);
  const tree = outline([{ kind: 'part' }, { kind: 'chapter' }, { kind: 'article' }, { kind: 'article' }, { kind: 'chapter' }, { kind: 'article' }, { kind: 'part' }, { kind: 'article' }]);
  eq('outline', tree.map((n) => [n.i, n.children.map((c) => [c.i, c.children.map((x) => x.i)])]), [[0, [[1, [2, 3]], [4, [5]]]], [6, [[7, []]]]]);
  const body = parseBody('1. First\ncontinued\n2. Second:\nა) one;\nბ) two;\nგ) (ამოღებულია - 01.01.2024)\n3. (repealed)\n\nFree text.');
  eq('parseBody structure', body.map((p) => [p.kind, p.num || '', p.lines.length, (p.subs || []).map((s) => s.key + (s.gone ? '!' : ''))]), [['p', '1', 2, []], ['p', '2', 1, ['a', 'b', 'c!']], ['p', '3', 1, []], ['text', '', 1, []]]);
  ok('parseBody repealed paragraph', body[2].gone === true && isGone('утратила силу') && isGone('(ამოღებულია)') && !isGone('Tax'));
  eq('subKey', [subKey('ბ'), subKey('в'), subKey('c'), subKey('ა.ბ'), subKey('„ა“')], ['b', 'c', 'c', 'a-b', 'a']);
  eq('parseChanges', parseChanges('2027-09-01: Articles 1 — x\n01.10.2027 y\nno date'), [{ day: '2027-09-01', text: 'Articles 1 — x' }, { day: '2027-10-01', text: 'y' }, { day: '', text: 'no date' }]);

  // references
  const refs = (s) => findRefs(s).map((r) => r.targets.map((t) => [s.slice(t.start, t.end), t.art, t.para, t.sub]));
  eq('ref en', refs('See Article 12(3)(a) and Articles 14, 15 and 16.'), [[['Article 12(3)(a)', '12', '3', 'a']], [['Articles 14', '14', '', ''], ['15', '15', '', ''], ['16', '16', '', '']]]);
  eq('ref en of', refs('subparagraph (b) of paragraph 2 of Article 7'), [[['subparagraph (b) of paragraph 2 of Article 7', '7', '2', 'b']]]);
  eq('ref ru', refs('подпункт «а» пункта 3 статьи 12 и ч. 2 ст. 5¹'), [[['подпункт «а» пункта 3 статьи 12', '12', '3', 'a']], [['ч. 2 ст. 5¹', '5-1', '2', '']]]);
  eq('ref uk', refs('частини 2 статті 7 та статтями 8 і 9'), [[['частини 2 статті 7', '7', '2', '']], [['статтями 8', '8', '', ''], ['9', '9', '', '']]]);
  eq('ref ka', refs('მე-12 მუხლის მე-3 პუნქტის „ა“ ქვეპუნქტი, მე-5 და მე-6 მუხლები, 1-ლი მუხლი, მუხლი 37¹⁰'),
    [[['მე-12 მუხლის მე-3 პუნქტის „ა“ ქვეპუნქტი', '12', '3', 'a']], [['მე-5', '5', '', ''], ['მე-6 მუხლები', '6', '', '']], [['1-ლი მუხლი', '1', '', '']], [['მუხლი 37¹⁰', '37-10', '', '']]]);
  eq('ref de', refs('Artikel 12 Absatz 2 Buchstabe a und § 5'), [[['Artikel 12 Absatz 2 Buchstabe a', '12', '2', 'a']], [['§ 5', '5', '', '']]]);
  eq('ref fr', refs("l'alinéa 2 de l'article 12"), [[["alinéa 2 de l'article 12", '12', '2', '']]]);
  eq('ref es', refs('el apartado 2 del artículo 12, letra b) y artículo 3'), [[['apartado 2 del artículo 12, letra b)', '12', '2', 'b']], [['artículo 3', '3', '', '']]]);
  eq('no refs in plain numbers', refs('In 2012 there were 12 articles of faith.'), []);
  const al = [{ key: 'tax', words: aliasWords('Tax Code, Налоговый кодекс, საგადასახადო კოდექსი') }, { key: 'bank', words: aliasWords('Banking Act') }];
  const hint = (s) => { const r = findRefs(s)[0]; return actHint(s, r.start, r.end, al); };
  eq('act named after / before a reference', [hint('статьи 12 Налогового кодекса'), hint('საგადასახადო კოდექსის მე-12 მუხლი'), hint('Article 3 of the Banking Act'), hint('Article 3 of this Code')], ['tax', 'tax', 'bank', '']);
  const linked = linkRefs('<p>See Article 2(1) and <a href="#x">Article 3</a>, Article 9.</p>', {
    resolve: (t) => (t.art === '9' ? null : '#tax-a' + t.art + (t.para ? '-p' + t.para : '')), current: 'tax', open: (h) => `<a href="${h}">`,
  });
  eq('linkRefs: links, never inside links, unresolved stay text', linked, '<p>See <a href="#tax-a2-p1">Article 2(1)</a> and <a href="#x">Article 3</a>, Article 9.</p>');
  eq('mapText decodes entities and skips headings', mapText('<h2>Tax</h2><p>Tax &amp; tax</p>', (t) => t.replace(/tax/gi, 'T')), '<h2>Tax</h2><p>T & T</p>');

  // glossary
  eq('termKey dedupes inflections', [termKey('ბანკი'), termKey('ბანკის')].map((k) => k.length > 0), [true, true]);
  eq('groupTerms', groupTerms(['Bank', 'bank', 'Tax'], (x) => x).map((g) => g.items.length), [2, 1]);
  const tm = termMatcher([{ id: 'vat', names: ['value added tax', 'VAT'] }, { id: 'tp', names: ['налогоплательщик'] }, { id: 'tax', names: ['tax'] }, { id: 'bank', names: ['ბანკი'] }]);
  const hits = (s) => tm.find(s).map((h) => [s.slice(h.start, h.end), h.id]);
  eq('terms: longest first, inflections', hits('The value added tax and taxes; налогоплательщиками; ბანკმა; VATs'), [['value added tax', 'vat'], ['taxes', 'tax'], ['налогоплательщиками', 'tp'], ['ბანკმა', 'bank'], ['VATs', 'vat']]);
  eq('terms: separated words do not form a name', hits('value, added tax').map((x) => x[1]), ['tax']);
  const seen = new Set();
  eq('linkTerms: first occurrence, outside links', linkTerms('<p>VAT, VAT and <a>tax</a> tax</p>', tm, { seen, open: (id) => `<a data-t="${id}">` }), '<p><a data-t="vat">VAT</a>, VAT and <a>tax</a> <a data-t="tax">tax</a></p>');
  ok('linkTerms: seen shared', seen.has('vat') && seen.has('tax'));

  // records
  const fo = facetOptions([{ a: { en: 'Tax, Corporate', ru: 'Налоги, Корпоративное' } }, { a: { en: 'Tax', ru: 'Налоги' } }], (it, l) => splitList(it.a[l]), { langs: ['en', 'ru'], lang: 'en' });
  eq('facet options aligned across languages', fo.options.map((o) => [o.id, o.n, o.label.ru]), [['tax', 2, 'Налоги'], ['corporate', 1, 'Корпоративное']]);
  ok('money', /1.?200/.test(money(1200, 'GEL', 'en')) && money(5, '', 'en') === '5');
  eq('price / budget parts', [priceParts('free').key, priceParts('from', null), budgetParts('range', 1, 2, 'USD', 'en').key, budgetParts('range', null, 2, 'USD', 'en').key, budgetParts('unsure').key, budgetParts('fixed').key],
    ['pt.price.free', null, 'pt.budget.range', 'pt.budget.upto', 'pt.budget.unsure', 'pt.budget.unsure']);
  eq('daysUntil', daysUntil('2026-10-20', Math.floor(Date.UTC(2026, 9, 17) / 864e5)), 3);
  ok('recommendScore orders verified / rated first', recommendScore({ verified: true, rating: 4.5, reviews: 10 }) > recommendScore({ rating: 4.9 }) && recommendScore({ status: 'away', rating: 5 }) < recommendScore({ rating: 2 }));
  eq('ratingSummary weights by reviews', ratingSummary([{ rating: 5, reviews: 3 }, { rating: 3, reviews: 1 }, { rating: 0 }]), { avg: 4.5, n: 4, count: 2 });
  const ms = matchEntries({ areas: ['Taxes'], city: 'Tbilisi', langs: ['English'] }, [{ id: 1, areas: ['Tax law'], city: 'Batumi', langs: ['English'] }, { id: 2, areas: ['Taxes'], city: 'Tbilisi', langs: ['Georgian'] }, { id: 3, areas: ['Real estate'], city: 'Tbilisi' }, { id: 4, areas: ['Taxes'], status: 'away' }], { limit: 5 });
  eq('matchEntries: areas required, city and language rank', ms.map((m) => [m.entry.id, m.why]), [[2, ['area', 'city']], [1, ['area', 'lang']]]);

  // search
  const si = searchIndex([{ id: 'a', type: 'article', title: 'Article 2. Terms', text: 'value added tax is paid', href: '#a', group: { key: 'tax', label: 'Tax Code' } },
    { id: 'b', type: 'term', title: 'Value added tax', text: 'A tax', href: '#b' }, { id: 'c', type: 'person', title: 'Nino', text: 'tax lawyer', href: '#c' }]);
  const sr = si.search('value tax');
  eq('search: every word, ranked, counts, groups', [sr.total, sr.results[0].entry.id, sr.counts, sr.groups.map((g) => [g.key, g.n])], [2, 'b', { article: 1, term: 1 }, [['tax', 1]]]);
  eq('search: type filter', si.search('tax', { type: 'person' }).results.map((r) => r.entry.id), ['c']);
  ok('search: highlighted', /<mark>tax<\/mark>/i.test(sr.results[0].titleHTML));

  // catalog
  const cat = siteCatalog();
  eq('catalog: act anchors', [cat.actBase('actblock1'), cat.anchor('actblock1', 1), cat.anchor('actblock1', 3)], ['tax', 'tax-a1', 'tax-a2-1']);
  eq('catalog: resolveRef (paragraph and subparagraph exist, else article)', [cat.resolveRef({ act: 'tax', art: '1', para: '2', sub: 'a' }), cat.resolveRef({ act: 'tax', art: '1', para: '9' }), cat.resolveRef({ act: 'tax', art: '99' }), cat.resolveRef({ act: 'nope', art: '1' })],
    ['#tax-a1-p2-a', '#tax-a1', null, null]);
  eq('catalog: terms grouped, anchors', cat.terms.map((e) => [e.anchor, e.items.length]), [['t-value-added-tax', 2], ['t-taxpayer', 1]]);
  eq('catalog: matcher per language', [cat.termMatcher('ru', 'p1').find('уплачивает НДС').length, cat.termMatcher('en', 'p1').find('pays VAT').length], [1, 1]);
  eq('catalog: request matching through the directory', cat.match(cat.requests[0], 3).map((m) => m.entry.anchor), ['pr-nino-example']);
  const topics = cat.topics('en');
  eq('catalog: topics', topics.map((t) => [t.label, t.n]).slice(0, 2), [['Taxes', 5], ['Corporate', 3]]);
  eq('catalog: topic groups', Object.fromEntries(Object.entries(cat.topic('taxes', 'en').groups).map(([k, v]) => [k, v.length])), { act: 1, term: 2, person: 1, request: 1 });
  const ents = cat.entries('ru');
  ok('catalog: search entries in the language', ents.some((e) => e.type === 'article' && e.title === 'Статья 1. Сфера' && e.group.key === 'tax') && ents.some((e) => e.type === 'term' && e.title === 'Налогоплательщик'));

  // markup
  plainView.used = new Set();
  const render = (b, o = {}) => PT_RENDER[b.type](b, plainView(b, { cat, langs: ['en'], ...o }));
  const act = render(ACT);
  ok('act: header, status, number', act.includes('id="tax"') && act.includes('xp-pt-b-amended') && act.includes('No. 1234-IV'));
  ok('act: toc links to articles and chapters', act.includes('data-pt-spy') && act.includes('href="#tax-a1"') && act.includes('href="#tax-ci"') && act.includes('<span class="xp-pt-tn">2<sup>1</sup></span>'));
  ok('act: articles with ids, paragraph and subparagraph ids', act.includes('id="tax-a1"') && act.includes('id="tax-a1-p2"') && act.includes('id="tax-a1-p2-a"'));
  ok('act: cross-reference inside the act', act.includes('<a class="xp-pt-xref" href="#tax-a1-p2">paragraph 2 of Article 1</a>') && act.includes('<a class="xp-pt-xref" href="#tax-a2">Article 2</a>'));
  ok('act: glossary term linked with a tooltip definition', act.includes('data-pt-tip="t-value-added-tax"') && act.includes('data-pt-tipd="t-value-added-tax"'));
  ok('act: repealed article', /xp-pt-art xp-pt-gone/.test(act) && act.includes('(repealed)'));
  ok('act: planned changes with links', act.includes('xp-pt-changes') && act.includes('href="#tax-a2"'));
  ok('act: find tools and copy links', act.includes('data-pt-list') && act.includes('data-pt-q') && act.includes('data-pt-copy="#tax-a1"'));
  const actRu = PT_RENDER.act(ACT, plainView(ACT, { cat, langs: ['en', 'ru'] }));
  ok('act: per-language groups', actRu.includes('data-l="ru"') && actRu.includes('Статья') && actRu.includes('href="#tax-a1-p2"'));
  const terms0 = render(TERMS);
  ok('terms: one entry per term with two definitions', (terms0.match(/class="xp-pt-tcard"/g) || []).length === 2 && terms0.includes('2 definitions') && terms0.includes('id="t-value-added-tax-2"'));
  ok('terms: alphabet with disabled letters', terms0.includes('data-pt-azl="az-termsblock-latn-t"') && terms0.includes('aria-disabled="true"'));
  ok('terms: source linked to the act', terms0.includes('href="#tax-a2"'));
  ok('terms: related term linked', terms0.includes('href="#t-taxpayer"'));
  ok('terms: never links a term inside its own definition', !/id="t-value-added-tax-1"[^]*?data-pt-tip="t-value-added-tax"[^]*?id="t-value-added-tax-2"/.test(terms0));
  const dir = render(DIR);
  ok('directory: tabs, facets, sort, data', dir.includes('data-pt-tab="kind:firm"') && dir.includes('data-pt-facet="area"') && dir.includes('data-pt-sort') && dir.includes('data-pt-f="kind:person area:taxes area:corporate city:tbilisi lang:georgian lang:english"'));
  ok('directory: verified, price, masked contacts', dir.includes('xp-pt-ver') && dir.includes('from') && dir.includes('data-pt-mask') && dir.includes('+995 555 •• •• 56') && dir.includes('href="tel:+995555123456"'));
  ok('directory: away status badge', dir.includes('xp-pt-b-away'));
  const board = render(BOARD);
  ok('board: open count, budget range, relative dates', board.includes('<b>1</b>') && /300.*600/.test(board) && board.includes('data-pt-rel="ago"') && board.includes('Closes in 2 days') && board.includes('3 days ago'));
  ok('board: responses and matching specialists', board.includes('Responses: 2 of 5') && board.includes('href="#pr-nino-example"'));
  ok('board: cross-reference in a request', board.includes('href="#tax-a2"'));
  const hub = render(HUB);
  ok('hub: stats and sections', hub.includes('xp-pt-stats') && hub.includes('<dt>Terms</dt><dd>2</dd>') && hub.includes('href="#t-taxpayer"'));
  const hubx = render(HUBX);
  ok('hub index: tiles with counts', hubx.includes('xp-pt-tile') && hubx.includes('5 items') && hubx.includes('href="#taxes"'));
  const ck = render(CHECK);
  ok('checklist: storage key, boxes, progress, group, legal basis link', ck.includes('data-pt-check="ck:checkblock"') && (ck.match(/data-pt-ck="/g) || []).length === 2 && ck.includes('0 of 2 done') && ck.includes('xp-pt-ckg') && ck.includes('href="#tax-a2"'));
  const fd = render(FINDER);
  const ixJson = /<script type="application\/json" data-pt-ix>([\s\S]*?)<\/script>/.exec(fd);
  ok('finder: index of the site', !!ixJson && JSON.parse(ixJson[1]).en.some((e) => e[0] === 'article' && e[5] === 'tax'));
  ok('finder: suggestions', fd.includes('data-pt-fs="VAT"'));
  const edit = PT_RENDER.directory(DIR, plainView(DIR, { cat, edit: true }));
  ok('edit mode: no list runtime, items addressable', !edit.includes('data-pt-list') && edit.includes('data-item="1"') && !edit.includes('data-pt-copy'));
  for (const t of PT_TYPES) {
    const empty = { id: 'empty' + t, type: t, ...defaults(t), items: [] };
    let html = '';
    try { html = PT_RENDER[t](empty, plainView(empty, { cat: null })); } catch (e) { html = 'ERR ' + e.message; }
    ok(`${t}: renders without items and without a catalog`, html.startsWith('<div class="xp-pt '), html.slice(0, 120));
  }

  // models and editor labels
  for (const t of PT_TYPES) {
    const spec = PT_BLOCKS[t];
    ok(`${t}: palette strings`, PT_LANGS.every((l) => PT_EDITOR[l]['b.' + t] && PT_EDITOR[l]['bd.' + t]));
    for (const f of [...spec.fields, ...(spec.item ? spec.item.fields : [])]) {
      ok(`${t}.${f.key}: label in 7 languages`, PT_LANGS.every((l) => PT_EDITOR[l][ptFieldLabel(f)]), ptFieldLabel(f));
      if (f.t === 'select') for (const v of f.o) ok(`${t}.${f.key}=${v}: option label`, PT_LANGS.every((l) => PT_EDITOR[l][ptOptionLabel(f, v)]), ptOptionLabel(f, v));
    }
  }
  for (const l of PT_LANGS) {
    eq(`viewer strings ${l}: same keys as en`, Object.keys(PT_UI[l]).filter((k) => !(k in PT_UI.en)), []);
    eq(`viewer strings ${l}: complete`, Object.keys(PT_UI.en).filter((k) => !(k in PT_UI[l])), []);
    eq(`editor strings ${l}: complete`, Object.keys(PT_EDITOR.en).filter((k) => !(k in PT_EDITOR[l])), []);
  }
  const src = fs.readFileSync(path.join(HERE, 'markup.js'), 'utf8') + fs.readFileSync(path.join(HERE, 'runtime.js'), 'utf8');
  const used = [...new Set([...src.matchAll(/'(pt\.[a-z][\w.]*[a-z])'/g)].map((m) => m[1]))].filter((k) => !/\.$/.test(k));
  eq('every literal UI key of markup and runtime exists', used.filter((k) => !(k in PT_UI.en)), []);
  eq('plural forms of ru', ptT('ru')('pt.act.articles', { n: 5 }), '5 статей');

  // css
  const css = portalCSS('lp', ['act']);
  ok('css: prefix replaced, only used chunks', css.includes('.lp-pt-toc') && !css.includes('__P__') && !css.includes('.lp-pt-tile') && css.includes('[data-pt-pop]'));
  ok('css: every type has chunks', PT_TYPES.every((t) => (PT_TYPE_CHUNKS[t] || []).every((c) => PT_CSS[c])));
  ok('css: no viewport media queries for layout', !/@media\s*\((?:max|min)-width/.test(Object.values(PT_CSS).join('')));

  // runtime: serializable, folding identical to text.js
  for (const f of PT_FEATURE_ORDER) {
    let okSyntax = true;
    try { new Function('R', `(${PT_FEATURES[f].toString()})(R)`); } catch (e) { okSyntax = false; }
    ok(`runtime ${f}: serializable`, okSyntax);
    ok(`runtime ${f}: no class names, no prefix`, !/__P__|classList|className/.test(PT_FEATURES[f].toString()));
  }
  const rt = runRuntime('<div data-pt="x"></div>', ['ptbase']);
  const samples = ['Ёлка Ärger', '  ბანკის  ', 'ÉCOLE ß', 'Налог на'];
  eq('runtime fold == text.fold', samples.map((s) => rt.R.pt.fold(s)), samples.map(fold));
  ok('runtime: roots marked for JS-only controls', rt.document.querySelector('[data-pt]').hasAttribute('data-pt-js'));

  // runtime: list filtering, facets, tabs, sorting, paging
  const dirB = { ...DIR, more: 2 };
  const dirHTML = PT_RENDER.directory(dirB, plainView(dirB, { cat }));
  const L = runRuntime(dirHTML, ['ptbase', 'ptlist']);
  const items = () => L.document.querySelectorAll('[data-pt-i]');
  const visible = () => items().filter((e) => !e.hidden).map((e) => e.id);
  eq('list: first page', visible(), ['pr-nino-example', 'pr-example-partners']);
  const more = L.document.querySelector('[data-pt-more]');
  ok('list: more button shown', !more.hidden);
  more.dispatch('click');
  eq('list: second page', visible().length, 3);
  const q = L.document.querySelector('[data-pt-q]');
  q.value = 'notar';
  q.dispatch('input');
  L.flush();
  eq('list: search', visible(), ['pr-giorgi-sample']);
  ok('list: count and reset', L.document.querySelector('[data-pt-count]').textContent === '1 result' && !L.document.querySelector('[data-pt-reset]').hidden);
  L.document.querySelector('[data-pt-reset]').dispatch('click');
  const area = L.document.querySelector('select[data-pt-facet="area"]');
  area.value = 'corporate';
  area.dispatch('change');
  eq('list: facet', visible(), ['pr-nino-example', 'pr-example-partners']);
  area.value = '';
  const tabFirm = L.document.querySelector('[data-pt-tab="kind:firm"]');
  tabFirm.dispatch('click', { currentTarget: tabFirm });
  eq('list: tab', visible(), ['pr-example-partners']);
  L.document.querySelector('[data-pt-tab=""]').dispatch('click', { currentTarget: L.document.querySelector('[data-pt-tab=""]') });
  const sort = L.document.querySelector('[data-pt-sort]');
  sort.value = 'name:a';
  sort.dispatch('change');
  more.dispatch('click');
  eq('list: sort A–Z reorders the DOM', items().map((e) => e.id), ['pr-example-partners', 'pr-giorgi-sample', 'pr-nino-example']);
  q.value = 'zzz';
  q.dispatch('input');
  L.flush();
  ok('list: empty state', !L.document.querySelector('[data-pt-empty]').hidden && visible().length === 0);

  // runtime: act search hides chapters and contents entries
  const A = runRuntime(PT_RENDER.act(ACT, plainView(ACT, { cat })), ['ptbase', 'ptlist']);
  const aq = A.document.querySelector('[data-pt-q]');
  aq.value = 'inserted';
  aq.dispatch('input');
  A.flush();
  eq('act find: articles', A.document.querySelectorAll('[data-pt-i]').filter((e) => !e.hidden).map((e) => e.id), ['tax-a2-1']);
  eq('act find: chapter without hits hidden', A.document.querySelectorAll('[data-pt-g]').map((g) => g.hidden), [false, true]);
  eq('act find: contents follow', A.document.querySelectorAll('[data-pt-for]').filter((e) => !e.hidden).map((e) => e.getAttribute('data-pt-for')), ['tax-a2-1']);

  // runtime: checklist ticks are kept
  const ckHTML = PT_RENDER.checklist(CHECK, plainView(CHECK, { cat }));
  const K = runRuntime(ckHTML, ['ptbase', 'ptcheck']);
  const box = K.document.querySelectorAll('input[data-pt-ck]')[0];
  box.checked = true;
  box.dispatch('change');
  ok('checklist: progress', K.document.querySelector('[data-pt-progt]').textContent === '1 of 2 done');
  ok('checklist: stored', [...K.store.values()].some((v) => v.includes(box.getAttribute('data-pt-ck'))));
  // A second visit with the same storage starts ticked.
  const K2 = runRuntime(ckHTML, ['ptbase', 'ptcheck'], {}, K.store);
  ok('checklist: restored', K2.document.querySelectorAll('input[data-pt-ck]')[0].checked && K2.document.querySelector('[data-pt-progt]').textContent === '1 of 2 done');
  K2.document.querySelector('[data-pt-ck-reset]').dispatch('click');
  ok('checklist: start over', !K2.document.querySelectorAll('input[data-pt-ck]')[0].checked);

  // runtime: copy link writes an absolute URL
  let copied = '';
  const C = runRuntime(PT_RENDER.act(ACT, plainView(ACT, { cat })), ['ptbase'], {
    navigator: { clipboard: { writeText: (s) => { copied = s; return { then: (a) => a() }; } } },
    URL: class { constructor(h, b) { this.href = new globalThis.URL(h, b).href; } },
  });
  const cb = C.document.querySelector('[data-pt-copy="#tax-a1"]');
  C.document.fire('click', cb);
  ok('copy link: absolute URL, feedback', copied === 'https://example.org/legal/#tax-a1' && cb.hasAttribute('data-pt-copied'), copied);
  C.flush();
  ok('copy link: announced, feedback ends', C.document.querySelector('[data-pt-live]').textContent === 'Link copied' && !cb.hasAttribute('data-pt-copied'));

  console.log(`portal: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) run().then((f) => process.exit(f ? 1 : 0));
