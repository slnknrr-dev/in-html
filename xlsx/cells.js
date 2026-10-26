// xlsx/cells.js - spreadsheet cell basics shared by the file readers / writers and the formula engine: A1 references,
// error values, date serial numbers (1900 and 1904 systems) and accessors of the workbook model.
//
// Workbook model (xlsx/read.js, xlsx/ods.js produce it, xlsx/write.js consumes it, formula/engine.js computes it):
//   { sheets: [{ name, rows: cell[][], cols?: [{ width (characters), hidden, fmt (default number format) }],
//                merges?: [{ r1, c1, r2, c2 }], freeze?: { rows, cols },
//                hidden? }], date1904? }
//   cell: null | number | string | boolean | CellError | { v, f?, s?, link? }
//     v     value (number, string, boolean, CellError or null)
//     f     formula text without the leading '=' (A1 style, Excel function names)
//     s     style { bold, italic, fill: '#rrggbb', color: '#rrggbb', fmt: number format code }
//     link  hyperlink target (URL or '#Sheet!A1')
//   Dates are serial numbers (1900 system) with a date number format.
//
// Why primitives for plain cells and objects only when needed: a 100k-row sheet of numbers stays a compact array of
// doubles instead of 100k small objects (memory and GC). Every consumer must go through cellValue / cellFormula /
// cellStyle, never read .v directly. Rows are sparse arrays: holes mean empty, and long empty runs cost nothing.
// Indexes are 0-based internally, 1-based only in A1 text: the conversion lives in this file and nowhere else.

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;

// 0 -> 'A', 25 -> 'Z', 26 -> 'AA'
// Bijective base 26 (no zero digit), hence the (n - 1) shifts: plain base 26 would map 26 to 'BA' instead of 'AA'.
export function colName(c) {
  let s = '';
  let n = Math.floor(c) + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - 1 - m) / 26;
  }
  return s;
}

// 'A' -> 0, 'aa' -> 26; -1 when not a column name
export function colIndex(name) {
  const s = String(name).toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return -1;
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1 < MAX_COLS ? n - 1 : -1;
}

// '$B$3' -> { r: 2, c: 1, ar: true, ac: true }; null when malformed or outside the sheet
export function parseA1(ref) {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/.exec(String(ref).trim());
  if (!m) return null;
  const c = colIndex(m[2]);
  const r = +m[4] - 1;
  if (c < 0 || r < 0 || r >= MAX_ROWS) return null;
  return { r, c, ac: !!m[1], ar: !!m[3] };
}

export const formatA1 = (r, c, ar = false, ac = false) => `${ac ? '$' : ''}${colName(c)}${ar ? '$' : ''}${r + 1}`;

// 'A1:C3' / 'B2' -> { r1, c1, r2, c2 } (normalized so that r1 <= r2, c1 <= c2); null when malformed
export function parseRange(ref) {
  const [a, b] = String(ref).split(':');
  const p = parseA1(a);
  const q = b == null ? p : parseA1(b);
  if (!p || !q) return null;
  return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) };
}

export function formatRange({ r1, c1, r2, c2 }) {
  const a = formatA1(r1, c1);
  return r1 === r2 && c1 === c2 ? a : a + ':' + formatA1(r2, c2);
}

// --- error values ------------------------------------------------------------------------

// Interned error values: compare with === or isError(); `code` is the text ('#DIV/0!').
// A class rather than strings: the string '#N/A' typed by a user is text, not an error. Interning keeps === valid.
export class CellError {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}

// Errors Excel stores in files; '#CIRC!' (circular reference) and '#ERROR!' (formula syntax) are engine-only.
export const FILE_ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!'];
const INTERN = new Map();
for (const code of [...FILE_ERRORS, '#CIRC!', '#ERROR!']) INTERN.set(code, new CellError(code));

// Unknown codes are interned too (files from newer Excel versions), so identity comparison still works for them.
export function cellError(code) {
  const k = String(code).toUpperCase();
  let e = INTERN.get(k);
  if (!e) { e = new CellError(k); INTERN.set(k, e); }
  return e;
}
export const isError = (v) => v instanceof CellError;
export const ERR = {
  NULL: cellError('#NULL!'), DIV0: cellError('#DIV/0!'), VALUE: cellError('#VALUE!'), REF: cellError('#REF!'),
  NAME: cellError('#NAME?'), NUM: cellError('#NUM!'), NA: cellError('#N/A'), SPILL: cellError('#SPILL!'),
  CALC: cellError('#CALC!'), CIRC: cellError('#CIRC!'), ERROR: cellError('#ERROR!'),
};

// --- cells of the model ------------------------------------------------------------------

// A rich cell is a plain object with a `v` (value), as opposed to primitives, CellError and Date (writers accept Dates).
export const isRich = (cell) => cell !== null && typeof cell === 'object' && !(cell instanceof CellError) && !(cell instanceof Date);
export const cellValue = (cell) => (isRich(cell) ? (cell.v === undefined ? null : cell.v) : cell === undefined ? null : cell);
export const cellFormula = (cell) => (isRich(cell) && cell.f != null ? cell.f : null);
export const cellStyle = (cell) => (isRich(cell) && cell.s ? cell.s : null);
export const isBlank = (cell) => { const v = cellValue(cell); return v === null || v === ''; };

// Cell at (r, c) of a sheet ({ rows }) or undefined.
export const getCell = (sheet, r, c) => { const row = sheet.rows[r]; return row ? row[c] : undefined; };

// Extent of the used area: { rows, cols } (counts, trailing empty rows / columns excluded).
// Scans bottom-up and right-to-left so trailing empties end each row scan early. A rich cell with v '' still counts
// (it may carry a style or formula). Note: any row's last value widens cols, so the result is the bounding box.
export function usedSize(sheet) {
  let rows = 0, cols = 0;
  for (let r = sheet.rows.length - 1; r >= 0; r--) {
    const row = sheet.rows[r];
    if (!row) continue;
    for (let c = row.length - 1; c >= 0; c--) {
      if (row[c] != null && !(row[c] === '' && !isRich(row[c]))) {
        if (!rows) rows = r + 1;
        if (c + 1 > cols) cols = c + 1;
        break;
      }
    }
  }
  return { rows, cols };
}

// --- dates -------------------------------------------------------------------------------

// Lotus 1-2-3 treated 1900 as a leap year; Excel kept the bug for compatibility, so serial 60 is "1900-02-29" and
// every serial from 61 on is one day "late". Choosing the epoch 1899-12-30 makes serials >= 61 exact and shifts only
// the first two months, which the +1 / -1 corrections below handle. All arithmetic is in UTC milliseconds: a local
// time zone would make DST days 23 or 25 hours long and shift serials.
const DAY = 86400000;
const EPOCH_1900 = Date.UTC(1899, 11, 30); // serial 0 for dates from 1900-03-01 on (the 1900 leap-year bug)
const EPOCH_1904 = Date.UTC(1904, 0, 1);
// Serials between 1462 (1904-01-01 in the 1900 system) offset the 1904 system.
export const DATE1904_OFFSET = 1462;

// Serial -> UTC milliseconds. Serial 60 (the non-existent 1900-02-29) lands on 1900-03-01; serialParts() keeps it
// as February 29 for display.
export function serialToMs(serial, date1904 = false) {
  if (date1904) return Math.round(EPOCH_1904 + serial * DAY);
  const s = serial < 61 && serial >= 1 ? serial + 1 : serial;
  return Math.round(EPOCH_1900 + s * DAY);
}

export const serialToDate = (serial, date1904 = false) => new Date(serialToMs(serial, date1904));

// UTC milliseconds or a Date (its UTC fields) -> serial
export function dateToSerial(d, date1904 = false) {
  const ms = d instanceof Date ? d.getTime() : +d;
  if (date1904) return (ms - EPOCH_1904) / DAY;
  let s = (ms - EPOCH_1900) / DAY;
  if (s < 61) s -= 1; // before 1900-03-01: Excel counts the fictitious 1900-02-29
  return s;
}

// Local wall-clock Date -> serial (date pickers, NOW(), TODAY() use the local time zone).
export const localDateToSerial = (d) => dateToSerial(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()));

// Excel DATE(y, m, d): months and days overflow; years 0..1899 are offset by 1900.
// Date.UTC itself normalises month overflow (month 13 = January next year); days are added as milliseconds so a
// negative or huge d also rolls over, exactly like Excel.
export function ymdToSerial(y, m, d) {
  y = Math.trunc(y); m = Math.trunc(m); d = Math.trunc(d);
  if (y >= 0 && y < 1900) y += 1900;
  if (y === 1900 && m === 2 && d === 29) return 60;
  return Math.round(dateToSerial(Date.UTC(y, m - 1, 1) + (d - 1) * DAY));
}

// Serial -> { y, m (1-12), d, hh, mm, ss, ms, wd (0 = Sunday) }; time rounded to the millisecond.
// Time is rounded to the millisecond before splitting: 0.9999999 of a day must become the next day 00:00, not
// 23:59:59.999 shown as "24:00" by a formatter. Serial 0 / 60 are special-cased to the dates Excel displays.
export function serialParts(serial, date1904 = false) {
  let days = Math.floor(serial);
  let msOfDay = Math.round((serial - days) * DAY);
  if (msOfDay >= DAY) { days += 1; msOfDay -= DAY; }
  let y, m, d, wd;
  if (!date1904 && days === 60) { y = 1900; m = 2; d = 29; wd = 3; }
  else {
    const t = new Date(serialToMs(days, date1904));
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); wd = t.getUTCDay();
    if (!date1904 && days === 0) { y = 1900; m = 1; d = 0; wd = 6; } // Excel shows 1900-01-00
  }
  const hh = Math.floor(msOfDay / 3600000);
  const mm = Math.floor((msOfDay % 3600000) / 60000);
  const ss = Math.floor((msOfDay % 60000) / 1000);
  return { y, m, d, hh, mm, ss, ms: msOfDay % 1000, wd };
}
