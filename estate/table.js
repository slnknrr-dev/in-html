// estate/table.js - a developer's unit table (CSV / spreadsheet rows) -> units: cell parsing as real price lists write
// it ('42,5', '1 200 000', '$120,000.50', '42.5 m²', '42,5-58,3'), header sniffing in English, Russian and Georgian
// (with "price per m²" recognised as a RATE before anything can take it for the price), and a row-by-row report of
// what was skipped and why, with line numbers as a person sees them in Excel. Text input goes through ../csv/.
//
//   cellNumber(v) -> number | null, cellInt(v), cellText(v), headerKey(v)
//   UNIT_COLUMNS, unitColumnOf(header) -> 'flat' | 'floor' | 'area' | 'rooms' | 'price' | 'rate' | 'status' | null
//   sniffUnitColumns(headerRow) -> { flat: 0, floor: 1, ... }
//   isFlatNumber(v) -> bool                      a flat number has a digit ('12a', 'PH-1'; not 'Total')
//   unitStatusOf(v) -> 'free' | 'reserved' | 'sold' | 'closed' | ''
//   unitTable(rows, { max, step }) -> { columns, ignored, units, problems: [{ line, kind, text }] }
//     kind: 'no-flat' | 'dupe' | 'no-area' | 'no-price' | 'over-limit'
//   unitTableFromText(text, opts) -> the same, with the delimiter sniffed

import { parseCSV, sniffCSV } from '../csv/csv.js';
import { UNIT_GRID_MAX, unitPrice } from './chessboard.js';

/**
 * A number from a cell. Digit groups by spaces (also no-break and narrow no-break) and apostrophes, currency signs and
 * units around it, a range ('42,5-58,3') read as its FIRST number (a merged '42,558' would look like an ordinary area).
 * A comma followed by exactly three digits is a group separator only with another separator or a currency sign;
 * otherwise it is a decimal comma ('1,500' reads 1.5: a price of one and a half is a visible absurdity, an area of
 * 1500 m² would pass unnoticed).
 */
// Steps: detect currency before stripping; drop group spaces; cut a range to its first number; keep only digits,
// separators and a leading minus; then decide the decimal separator: with both present the LAST one is decimal
// ('1.200,50' and '1,200.50' both give 1200.5).
export function cellNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  let s = String(v ?? '').trim();
  if (!s) return null;
  const hadCurrency = /[$€₾₽£]|USD|EUR|GEL|RUB|лар|дол|евро|руб/i.test(s);
  s = s.replace(/[\s  ']/g, '');
  const range = s.match(/^([\d.,]+)[-–—][\d.,]+/);
  if (range) s = range[1];
  s = s.replace(/[^\d.,-]/g, '');
  s = s.replace(/(?!^)-/g, '');
  if (!s || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    const grouped = s.length - lastComma - 1 === 3 && (hadCurrency || (s.match(/,/g) || []).length > 1);
    s = grouped ? s.split(',').join('') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function cellInt(v) {
  const n = cellNumber(v);
  return n === null ? null : Math.trunc(n);
}

export function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

// Header key: no case, spaces or punctuation. '№', '#' and 'Nº' become 'n' BEFORE cleaning (a header '№' would
// otherwise vanish), superscript ² / ³ become digits ('м²' = 'м2').
export const headerKey = (v) => cellText(v).toLowerCase().replace(/ё/g, 'е')
  .replace(/№|#|nº/g, 'n').replace(/²/g, '2').replace(/³/g, '3').replace(/[^\p{L}\p{N}]+/gu, '');

// Synonyms are stored already in headerKey form (lower-case, no spaces or punctuation), so lookup is a plain compare.
export const UNIT_COLUMNS = {
  flat: ['квартира', 'номерквартиры', 'кв', 'номер', 'n', 'nкв', 'flat', 'apartment', 'apt', 'unit', 'no', 'number', 'ბინა', 'ნომერი'],
  floor: ['этаж', 'floor', 'level', 'storey', 'სართული'],
  area: ['площадь', 'площадьм2', 'общаяплощадь', 'квм', 'area', 'size', 'sqm', 'm2', 'ფართობი'],
  rooms: ['комнат', 'комнаты', 'комнатность', 'спален', 'rooms', 'bedrooms', 'numberofrooms', 'roomcount', 'noofrooms', 'ოთახები'],
  price: ['цена', 'стоимость', 'ценаgel', 'ценаusd', 'price', 'cost', 'ფასი'],
  rate: ['ценазам2', 'ценаза1м2', 'ставка', 'заm2', 'pricepersqm', 'persqm', 'ppm', 'pricem2'],
  status: ['статус', 'status', 'состояние', 'სტატუსი'],
};

const PRICE_WORD = /цена|стоимость|price|cost|ფასი/;
const PER_M2 = /за1?(м2|квм)|per1?(sqm|m2)|(м2|sqm|m2)$/;

/**
 * The meaning of a column from its header, null when unknown (not an error). Order matters more than any single
 * pass: (1) "price per m²" is a RATE - checked first, because the word "price" in it is real and any synonym pass
 * would make the rate of 1200 the price of the flat; (2) an exact synonym; (3) "starts with" (synonyms of 3+
 * letters) and "contains" (5+ letters): 'Area, m²' and 'Number of rooms' are spelled differently in every file.
 */
export function unitColumnOf(header) {
  const k = headerKey(header);
  if (!k) return null;
  if (PRICE_WORD.test(k) && PER_M2.test(k)) return 'rate';
  const entries = Object.entries(UNIT_COLUMNS);
  for (const [col, names] of entries) if (names.includes(k)) return col;
  for (const [col, names] of entries) if (names.some((n) => n.length >= 3 && k.startsWith(n))) return col;
  for (const [col, names] of entries) if (names.some((n) => n.length >= 5 && k.includes(n))) return col;
  return null;
}

// Meaning -> column index; a repeated meaning keeps the FIRST column.
export function sniffUnitColumns(header) {
  const map = {};
  (header || []).forEach((h, i) => {
    const col = unitColumnOf(h);
    if (col && map[col] === undefined) map[col] = i;
  });
  return map;
}

// 'Total' in the flat column is how spreadsheets sum up - it must not become a flat priced at the whole building.
// The cost of the rule is named: a flat called by letters only ('Penthouse') is skipped too, and reported.
export const isFlatNumber = (v) => /\d/.test(cellText(v));

const STATUS_WORDS = {
  free: ['free', 'available', 'свободна', 'свободно', 'свободен', 'в продаже', 'თავისუფალი'],
  reserved: ['reserved', 'booked', 'hold', 'бронь', 'забронирована', 'резерв', 'დაჯავშნილი'],
  sold: ['sold', 'продана', 'продано', 'продан', 'გაყიდული'],
  closed: ['closed', 'not for sale', 'снята', 'не продаётся', 'не продается'],
};
export function unitStatusOf(v) {
  const s = cellText(v).toLowerCase();
  if (!s) return '';
  for (const [k, words] of Object.entries(STATUS_WORDS)) if (words.includes(s)) return k;
  return '';
}

const quote = (s) => `"${String(s).slice(0, 40)}"`;

/**
 * Table rows -> units. The HEADER IS REQUIRED and parsing does not start without a flat column: guessing columns from
 * data fails silently (forty listings with floors for numbers). Empty rows are dropped together with their line
 * number, so `line` keeps pointing at the right row of the file. A row without a flat number ('Total', a signature)
 * is skipped and NAMED; a repeated number is skipped; an unreadable area or price drops the cell, not the row.
 * Price: the price column, else area × rate rounded by the same `unitPrice` as the regular grid.
 */
export function unitTable(rows, { max, step = 100 } = {}) {
  const cap = Math.max(1, Math.min(UNIT_GRID_MAX, Math.trunc(Number(max) || UNIT_GRID_MAX)));
  const out = { columns: {}, ignored: [], units: [], problems: [] };
  const list = (rows || []).map((row, i) => ({ row, line: i + 1 })).filter((x) => Array.isArray(x.row) && x.row.some((c) => cellText(c) !== ''));
  if (!list.length) return out;
  const header = list[0].row;
  const map = sniffUnitColumns(header);
  for (const [col, i] of Object.entries(map)) out.columns[col] = cellText(header[i]);
  header.forEach((h, i) => { const t = cellText(h); if (t && !Object.values(map).includes(i)) out.ignored.push(t); });
  if (map.flat === undefined) return out;
  const seen = new Set();
  const cell = (row, col) => (map[col] === undefined ? undefined : row[map[col]]);
  for (let r = 1; r < list.length; r++) {
    const { row, line } = list[r];
    const flat = cellText(row[map.flat]);
    if (!isFlatNumber(flat)) {
      const what = flat || cellText(row[0]);
      out.problems.push({ line, kind: 'no-flat', text: what ? `${quote(what)} is not a flat number` : '(empty)' });
      continue;
    }
    if (out.units.length >= cap) { out.problems.push({ line, kind: 'over-limit', text: `flat ${flat}` }); continue; }
    const key = flat.toLowerCase();
    if (seen.has(key)) { out.problems.push({ line, kind: 'dupe', text: `flat ${flat} is already above` }); continue; }
    seen.add(key);
    const area = map.area === undefined ? null : cellNumber(cell(row, 'area'));
    const rate = map.rate === undefined ? null : cellNumber(cell(row, 'rate'));
    const priceCell = map.price === undefined ? null : cellNumber(cell(row, 'price'));
    const price = priceCell ?? unitPrice(area || 0, rate || 0, step);
    if (map.area !== undefined && area === null && cellText(cell(row, 'area'))) out.problems.push({ line, kind: 'no-area', text: `${quote(cellText(cell(row, 'area')))} is not an area` });
    if (map.price !== undefined && priceCell === null && cellText(cell(row, 'price'))) out.problems.push({ line, kind: 'no-price', text: `${quote(cellText(cell(row, 'price')))} is not a price` });
    const unit = {
      flat: flat.slice(0, 24),
      // KNOWN DEFECT: a missing or unreadable floor becomes 0, which chessboard.js treats as a real ground floor
      // (its contract reserves null for "not given"), so such units are drawn on floor 0. Fix: keep null here.
      floor: (map.floor === undefined ? null : cellInt(cell(row, 'floor'))) ?? 0,
      area: area && area > 0 ? area : 0,
      price: price && price > 0 ? price : 0,
      rooms: (map.rooms === undefined ? null : cellInt(cell(row, 'rooms'))) ?? 0,
    };
    const status = map.status === undefined ? '' : unitStatusOf(cell(row, 'status'));
    if (status) unit.status = status;
    out.units.push(unit);
  }
  return out;
}

// Text of a CSV / TSV export: the delimiter is sniffed (',' ';' tab '|'), then the rows go to unitTable.
export function unitTableFromText(text, opts = {}) {
  const { delimiter, quote: q } = sniffCSV(String(text ?? ''));
  return unitTable(parseCSV(String(text ?? ''), { delimiter, quote: q }), opts);
}
