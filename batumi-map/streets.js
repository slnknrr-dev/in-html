// batumi-map/streets.js - the street list: an alphabetical gazetteer of Batumi with the Georgian, English and
// Russian names of every street, the number of addresses, a letter index, a filter that matches any script (the
// same search as the map page) and a link to the street on the map; exports of the streets and of all addresses as
// CSV (formula-injection safe, with the ODbL attribution in the file name and the page).
import { DATA_DATE, OSM_COPYRIGHT, fmtCount, latinOf, pageHref, search, startShell, streetName, streets, t } from './common.js';
import { button, card, download, field, select, textInput } from '../ui/app.js';
import { $, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { serializeCSV } from '../csv/csv.js';
//
// The list is rebuilt wholesale on every filter/sort change (~500 streets, cheap). Without a filter rows are sorted
// by the chosen name column with locale collation and grouped by first letter (letter index = in-page anchors);
// with a filter the order is the search relevance of the map page, so both pages agree on what matches.

const SKEY = 'bm-streets';
// Persisted state is whitelisted (sort enum, filter text capped at 80 chars).
const S = { sort: 'ka', q: '', ...pickState(lsGet(SKEY, null)) };
function pickState(o) {
  const out = {};
  if (o && ['ka', 'en', 'ru'].includes(o.sort)) out.sort = o.sort;
  if (o && typeof o.q === 'string') out.q = o.q.slice(0, 80);
  return out;
}
const save = () => lsSet(SKEY, S);

const main = $('#main');
main.classList.add('bm-list');
const els = {};
// Collation locale per sort column: Georgian, English and Russian alphabets sort differently.
const COLL = { ka: 'ka', en: 'en', ru: 'ru' };

// Sort key of a street in a column: its name, or the transliteration of the Georgian name for English.
const keyOf = (s, l) => (l === 'en' ? s.en || latinOf(s.ka) : s[l]) || '';
// First letter after leading punctuation; any digit groups under '#'. toLocaleUpperCase with the column's locale
// (Georgian Mkhedruli has no case, so it is unchanged).
const firstLetter = (s) => { const c = [...s.replace(/^[^\p{L}\p{N}]+/u, '')][0] || '#'; return /\p{N}/u.test(c) ? '#' : c.toLocaleUpperCase(COLL[S.sort]); };

function render() {
  main.textContent = '';
  const all = streets();
  const houses = all.reduce((n, s) => n + s.count, 0);
  els.filter = textInput(S.q, (v) => { S.q = v; save(); paintSoon(); }, { type: 'search', placeholder: t('bm.st.filterPh'), autocomplete: 'off', id: 'bm-filter' });
  const sort = select(['ka', 'en', 'ru'].map((v) => ({ v, l: 'bm.l.' + v })), S.sort, (v) => { S.sort = v; save(); paint(); });
  els.count = h('div', { class: 'bm-st-count', role: 'status', 'aria-live': 'polite' });
  els.letters = h('nav', { class: 'bm-letters', 'aria-label': t('bm.st.letters') });
  els.body = h('div', { class: 'bm-st-body' });
  const exp = h('div', { class: 'ap-actions' },
    button('bm.st.exportStreets', 'download', exportStreets, 'primary'),
    button('bm.st.exportAddr', 'download', exportAddresses));
  main.append(
    h('div', { class: 'bm-st-head' },
      h('h2', { class: 'bm-st-title' }, t('bm.st.title')),
      h('p', { class: 'ap-lead' }, t('bm.st.lead', { n: fmtCount(all.length), h: fmtCount(houses) }), ' ',
        h('a', { href: OSM_COPYRIGHT, target: '_blank', rel: 'noopener noreferrer' }, t('bm.attr')), ', ODbL 1.0, ', DATA_DATE, '.')),
    h('div', { class: 'bm-st-work' },
      card('bm.st.tools', h('div', { class: 'ed-fields' }, field('bm.st.filter', els.filter), field('bm.st.sort', sort)), els.count, exp, h('div', { class: 'ed-hint' }, t('bm.st.exportHint'))),
      h('div', { class: 'bm-st-main' }, els.letters, els.body)));
  paint();
}

const paintSoon = debounce(() => paint(), 120);

function rows() {
  const all = streets();
  const q = S.q.trim();
  let list;
  if (q) {
    const r = search(q, { limit: 400 });
    list = r.results.map((x) => x.street);
  } else {
    list = all.slice().sort((a, b) => {
      const ka = keyOf(a, S.sort), kb = keyOf(b, S.sort);
      // Streets without a name in the sort language go last ((!ka) - (!kb) is 0/1/-1), then localeCompare.
      return (!ka) - (!kb) || ka.localeCompare(kb, COLL[S.sort]);
    });
  }
  return list;
}

function paint() {
  const list = rows();
  const total = streets().length;
  els.count.textContent = t('bm.st.shown', { n: fmtCount(list.length), total: fmtCount(total) });
  els.body.textContent = '';
  els.letters.textContent = '';
  if (!list.length) { els.body.append(h('div', { class: 'ap-empty' }, t('bm.st.empty'))); return; }
  const mapHref = pageHref('pg-map');
  const groups = [];
  if (S.q.trim()) groups.push({ letter: '', items: list });
  else for (const s of list) {
    const k = keyOf(s, S.sort);
    const L = k ? firstLetter(k) : '—';
    if (!groups.length || groups[groups.length - 1].letter !== L) groups.push({ letter: L, items: [] });
    groups[groups.length - 1].items.push(s);
  }
  if (groups.length > 1) els.letters.append(...groups.map((g, i) => h('a', { href: '#bm-l' + i, class: 'bm-letter' }, g.letter)));
  const table = h('table', { class: 'ap-table bm-st-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('bm.l.ka')), h('th', { scope: 'col' }, t('bm.l.en')), h('th', { scope: 'col' }, t('bm.l.ru')),
      // The last header is visually empty but has screen-reader text, so the column of action links is still named.
      h('th', { scope: 'col', class: 'bm-num' }, t('bm.st.col.addr')), h('th', { scope: 'col' }, h('span', { class: 'bm-sr' }, t('bm.st.onMap'))))));
  groups.forEach((g, gi) => {
    const tb = h('tbody', {});
    // Letter rows: <th scope="rowgroup"> labels the tbody group; each group is its own <tbody>, which is what rowgroup
    // refers to.
    if (g.letter) tb.append(h('tr', { class: 'bm-st-letter', id: 'bm-l' + gi }, h('th', { colspan: '5', scope: 'rowgroup' }, g.letter)));
    for (const s of g.items) {
      const en = s.en || (s.ka ? h('span', {}, latinOf(s.ka), ' ', h('em', { class: 'bm-muted' }, t('bm.translit'))) : '');
      tb.append(h('tr', { dataset: { sid: String(s.id) } },
        // lang per cell: screen readers switch pronunciation, and fonts with Georgian glyphs are picked correctly.
        h('td', { lang: 'ka' }, s.ka || '—'), h('td', { lang: 'en' }, en || '—'), h('td', { lang: 'ru' }, s.ru || '—'),
        h('td', { class: 'bm-num' }, fmtCount(s.count)),
        h('td', {}, h('a', { class: 'ed-btn ed-sm bm-onmap', href: mapHref + '#street=' + s.id, 'aria-label': t('bm.st.onMapOf', { name: streetName(s) }) }, t('bm.st.onMap')))));
    }
    table.append(tb);
  });
  els.body.append(h('div', { class: 'ap-table-wrap bm-st-wrap' }, table));
}

// --- exports ------------------------------------------------------------------------------------------------------

// The file name carries source, date and licence, so the attribution survives even when the CSV is detached.
const csvName = (what) => `batumi-${what}-${DATA_DATE}-osm-odbl.csv`;

function exportStreets() {
  const out = [['id', 'name_ka', 'name_en', 'name_ru', 'addresses', 'lat', 'lng']];
  for (const s of rows()) out.push([s.id, s.ka, s.en, s.ru, s.count, s.centre ? s.centre[0].toFixed(5) : '', s.centre ? s.centre[1].toFixed(5) : '']);
  // '﻿' BOM for Excel's UTF-8 detection; guard: true neutralises cells starting with = + - @ (CSV injection).
  // Exports follow the current filter (rows()), so "export what I see" holds.
  download('﻿' + serializeCSV(out, { guard: true }), csvName('streets'), 'text/csv;charset=utf-8');
}

function exportAddresses() {
  const out = [['street_id', 'street_ka', 'street_en', 'street_ru', 'house', 'lat', 'lng']];
  for (const s of rows()) for (const x of s.houses()) out.push([s.id, s.ka, s.en, s.ru, x.label, x.pt[0].toFixed(5), x.pt[1].toFixed(5)]);
  download('﻿' + serializeCSV(out, { guard: true }), csvName('addresses'), 'text/csv;charset=utf-8');
}

startShell('streets', () => render());
render();
