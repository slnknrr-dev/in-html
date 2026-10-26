// csv/mapping.js - mapping of imported columns to the fields of a target: a Russian / English / Georgian header
// dictionary, scored suggestions with a one-to-one assignment, and the loose value coercions of imports (yes / no
// words in several languages, numbers with either decimal mark, d.m.y dates and Excel serial numbers).
//
//   HEADER_SYNONYMS: { field: ['название', 'name', 'დასახელება', …] }
//   normHeader(text) -> text                     lower case, ё -> е, runs of non-letters / digits -> one space
//   suggestMapping(headers, targets, synonyms = HEADER_SYNONYMS, { min = 0.5, fuzzy = true })
//       -> { columns: { header: field | '' }, scores: [{ header, field, score, how }] }
//       targets: ['name', …] or [{ key, label?, synonyms?, multi? }]; how: 'exact' | 'word' | 'part' | 'fuzzy'
//   parseFlag(text) -> boolean | null            да / нет, yes / no, так / ні, კი / არა, 1 / 0, + / -, ✓, x, on / off …
//   parseLooseNumber(text) -> number | null      '1 234,56', '1.234,56', '1,234.56', '42,5' (decimal mark guessed)
//   parseLooseDate(text, { order = 'dmy', serials = true }) -> serial | null   1900-system serial (xlsx/cells.js);
//                                                Excel serial numbers 20000-80000 (1954-2119) pass through
//   coerceField(field, text) -> value            field.type: 'number' | 'bool' | 'date' | 'multiselect' | 'select' | text
//
// Scores: a header equal to a synonym, the field key or its label is 1; one containing a synonym of four or more
// letters as a whole word 0.85, as a part of a word 0.7; a near spelling (util/fuzzy.js similarity >= 0.8) 0.6 × the
// similarity. Pairs are assigned best first; every header gets at most one field and every field at most one header
// unless the target says multi: true. csv/infer.js does the strict per-column typing; these coercions are for values
// the user already declared to be of a type.

import { similarity } from '../util/fuzzy.js';
import { dateSerial, parseDate, parseNumber } from './infer.js';

export const HEADER_SYNONYMS = {
  name: ['название', 'наименование', 'товар', 'номенклатура', 'имя', 'name', 'product', 'item', 'title', 'დასახელება', 'სახელი', 'პროდუქტი'],
  code: ['код', 'артикул', 'sku', 'code', 'article', 'item code', 'part number', 'კოდი', 'არტიკული'],
  barcode: ['штрихкод', 'штрих-код', 'штрих код', 'баркод', 'ean', 'gtin', 'upc', 'barcode', 'шк', 'შტრიხკოდი'],
  category: ['категория', 'группа', 'подкатегория', 'раздел', 'вид', 'тип', 'category', 'group', 'subcategory', 'type', 'კატეგორია', 'ჯგუფი', 'სახეობა', 'ტიპი'],
  quantity: ['количество', 'кол-во', 'кол.', 'колво', 'остаток', 'шт', 'qty', 'quantity', 'count', 'pcs', 'stock', 'რაოდენობა', 'ნაშთი'],
  unit: ['ед. изм.', 'единица', 'единица измерения', 'ед', 'unit', 'uom', 'ერთეული'],
  price: ['цена', 'стоимость', 'price', 'cost', 'unit price', 'ფასი', 'ღირებულება'],
  amount: ['сумма', 'итого', 'всего', 'amount', 'total', 'sum', 'ჯამი', 'თანხა'],
  currency: ['валюта', 'currency', 'ვალუტა'],
  date: ['дата', 'день', 'дата и время', 'date', 'datetime', 'day', 'თარიღი'],
  place: ['объект', 'магазин', 'склад', 'точка', 'филиал', 'store', 'shop', 'location', 'warehouse', 'branch', 'ობიექტი', 'მაღაზია', 'საწყობი', 'ფილიალი'],
  person: ['продавец', 'кассир', 'сотрудник', 'ответственный', 'seller', 'cashier', 'employee', 'გამყიდველი', 'მოლარე', 'თანამშრომელი'],
  firstName: ['имя', 'first name', 'given name', 'სახელი'],
  lastName: ['фамилия', 'last name', 'surname', 'family name', 'გვარი'],
  email: ['email', 'e-mail', 'почта', 'электронная почта', 'эл. почта', 'mail', 'ელფოსტა', 'ელ. ფოსტა'],
  phone: ['телефон', 'тел', 'тел.', 'мобильный', 'phone', 'mobile', 'tel', 'ტელეფონი', 'მობილური'],
  address: ['адрес', 'address', 'მისამართი'],
  city: ['город', 'населённый пункт', 'city', 'town', 'ქალაქი'],
  note: ['комментарий', 'примечание', 'описание', 'note', 'comment', 'notes', 'description', 'შენიშვნა', 'კომენტარი', 'აღწერა'],
};

export const normHeader = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Score ladder: exact 1 > whole word 0.85 > substring 0.7 > fuzzy (scaled similarity). Short candidates (< 4 letters)
// may only match exactly or as whole words, since 'шт' or 'ед' as substrings would match unrelated headers.
function scorePair(h, words, cands) {
  let best = { score: 0, how: '' };
  const take = (score, how) => { if (score > best.score) best = { score, how }; };
  for (const c of cands) {
    if (!c) continue;
    if (c === h) { take(1, 'exact'); break; }
    if (c.length >= 4 || c.includes(' ')) {
      if (` ${h} `.includes(` ${c} `)) take(0.85, 'word');
      else if (c.length >= 4 && h.includes(c)) take(0.7, 'part');
    }
    if (h.length >= 4 && c.length >= 4) { const sim = similarity(h, c); if (sim >= 0.8) take(0.6 * sim, 'fuzzy'); }
    for (const w of words) if (w.length >= 5 && c.length >= 5 && w !== h) { const sim = similarity(w, c); if (sim >= 0.8) take(0.5 * sim, 'fuzzy'); }
  }
  return best;
}

// Greedy assignment over pairs sorted by score: optimal enough for a dozen columns, and predictable for users
// (the strongest match always wins). Hungarian matching would maximise total score but can give a header a worse
// field to satisfy another, which looks wrong in a UI.
export function suggestMapping(headers, targets, synonyms = HEADER_SYNONYMS, { min = 0.5, fuzzy = true } = {}) {
  const fields = (targets ?? Object.keys(synonyms)).map((t) => (typeof t === 'string' ? { key: t } : t));
  const pairs = [];
  headers.forEach((header, hi) => {
    const h = normHeader(header);
    if (!h) return;
    const words = h.split(' ');
    fields.forEach((f, fi) => {
      const own = Object.prototype.hasOwnProperty.call(synonyms, f.key) ? synonyms[f.key] : [];
      const cands = [...new Set([f.key, f.label, ...(f.synonyms ?? []), ...own].filter(Boolean).map(normHeader))];
      const r = scorePair(h, words, cands);
      if (r.score >= min && (fuzzy || r.how !== 'fuzzy')) pairs.push({ hi, fi, header, field: f.key, score: Math.round(r.score * 1000) / 1000, how: r.how });
    });
  });
  // Best first; ties keep the order of headers, then of fields.
  pairs.sort((a, b) => b.score - a.score || a.hi - b.hi || a.fi - b.fi);
  const columns = Object.fromEntries(headers.map((h) => [h, '']));
  const usedH = new Set(), usedF = new Set(), scores = [];
  for (const p of pairs) {
    if (usedH.has(p.hi) || (usedF.has(p.fi) && !fields[p.fi].multi)) continue;
    usedH.add(p.hi);
    usedF.add(p.fi);
    columns[p.header] = p.field;
    scores.push({ header: p.header, field: p.field, score: p.score, how: p.how });
  }
  return { columns, scores };
}

const TRUE_WORDS = new Set(['1', 'да', 'д', 'yes', 'y', 'true', 'истина', 'x', '✓', '✔', '+', 'on', 'вкл', 'так', 'т', 'істина', 'კი', 'ki', 'დიახ', 'ჰო']);
const FALSE_WORDS = new Set(['0', 'нет', 'н', 'no', 'n', 'false', 'ложь', '-', '−', '✗', 'off', 'выкл', 'ні', 'хибність', 'არა', 'ara']);

export function parseFlag(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;
  return TRUE_WORDS.has(s) ? true : FALSE_WORDS.has(s) ? false : null;
}

// The decimal mark is guessed per value from the last mark present; strict typing (infer.js) is not appropriate here
// because the user has already declared the column numeric.
export function parseLooseNumber(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const dot = s.lastIndexOf('.'), com = s.lastIndexOf(',');
  // The later mark is the decimal one; a lone comma is decimal unless it groups thousands more than once (1,234,567).
  let dec = com > dot ? ',' : '.';
  if (dot < 0 && com >= 0 && /^\d{1,3}(,\d{3}){2,}$/.test(s.replace(/^[-+−]/, ''))) dec = '.';
  const p = parseNumber(s, dec) ?? parseNumber(s, dec === ',' ? '.' : ',');
  return p ? p.v : null;
}

// Bare numbers count as Excel serials only within 20000-80000 (1954-2119), so a year like 2024 or a quantity is not
// mistaken for a date.
export function parseLooseDate(text, { order = 'dmy', serials = true } = {}) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (serials && /^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 20000 && n < 80000 ? n : null;
  }
  const p = parseDate(s, order);
  return p ? dateSerial(p) : null;
}

export function coerceField(field, text) {
  const v = String(text ?? '').trim();
  switch (field && field.type) {
    case 'number': return parseLooseNumber(v);
    case 'bool': return parseFlag(v);
    case 'date': return parseLooseDate(v, field);
    case 'multiselect': return v.split(/\s*[;,]\s*/).filter(Boolean);
    case 'select': return (field.options ?? []).find((o) => String(o).toLowerCase() === v.toLowerCase()) ?? v;
    default: return v;
  }
}
