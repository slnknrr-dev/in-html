// xlsx/ftext.js - formula text as stored in spreadsheet files: future-function prefixes (_xlfn., _xlfn._xlws.),
// shared-formula expansion (relative references moved by an offset) and OpenDocument formulas (of:=SUM([.A1:.B2])).
// Text-level transforms with a small scanner, so the file layer does not depend on the formula engine.
//
//   fromFileFormula(text) -> text without '=' and without _xlfn. / _xlws. prefixes
//   toFileFormula(text) -> text with the prefixes newer Excel functions need in files
//   shiftFormulaText(text, dr, dc) -> text with relative A1 references moved
//   fromODFFormula(text) -> A1 formula text (null when it is not an OpenFormula expression)

import { colIndex, colName, MAX_ROWS } from './cells.js';

// Functions Excel stores with the _xlfn. prefix ("future functions"); FILTER and SORT also need _xlws.
const XLFN = new Set(['CEILING.MATH', 'FLOOR.MATH', 'CONCAT', 'DAYS', 'IFNA', 'IFS', 'ISOWEEKNUM', 'MAXIFS', 'MINIFS',
  'MODE.SNGL', 'NUMBERVALUE', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'QUARTILE.INC', 'QUARTILE.EXC', 'RANK.EQ', 'SEQUENCE',
  'SORTBY', 'STDEV.S', 'STDEV.P', 'SWITCH', 'TEXTJOIN', 'UNIQUE', 'VAR.S', 'VAR.P', 'XLOOKUP', 'XMATCH', 'XOR', 'UNICHAR',
  'UNICODE', 'TEXTBEFORE', 'TEXTAFTER', 'TEXTSPLIT', 'TAKE', 'DROP', 'CHOOSECOLS', 'CHOOSEROWS', 'VSTACK', 'HSTACK',
  'COVARIANCE.S', 'COVARIANCE.P', 'AGGREGATE', 'LET', 'LAMBDA', 'RANDARRAY', 'ERF.PRECISE', 'NORM.DIST', 'NORM.INV']);
const XLWS = new Set(['FILTER', 'SORT']);

// One alternation, ordered by priority: string literals and quoted sheet names first (so "A1" inside text is never
// touched), then function calls ("NAME("), cell refs, column ranges, row ranges, numbers, bare names. The negative
// lookaheads stop LOG10( or a sheet prefix (A1!) from being read as a cell reference. Global flag + lastIndex make
// it a scanner; mapTokens resets lastIndex because the regex object is shared.
const TOKEN = /"(?:[^"]|"")*"|'(?:[^']|'')*'|[A-Za-z_\\][\w.\\]*\s*\(|\$?[A-Za-z]{1,3}\$?\d{1,7}(?![\w(.!])|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}(?![\w(.!])|\$?\d{1,7}:\$?\d{1,7}(?![\w(.])|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|[A-Za-z_\\][\w.\\]*/g;

// Calls fn(token) for every token the regexp recognizes; text in between is kept.
function mapTokens(text, fn) {
  let out = '', last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    out += text.slice(last, m.index) + fn(m[0]);
    last = TOKEN.lastIndex;
  }
  return out + text.slice(last);
}

// Cheap pre-check: most formulas have no prefix, so the scan is skipped entirely.
export function fromFileFormula(text) {
  const s = String(text).replace(/^=/, '');
  if (!/_xl/i.test(s)) return s;
  return mapTokens(s, (t) => (/\($/.test(t) ? t.replace(/^(_xlfn\.)?(_xlws\.)?/i, '') : t));
}

export function toFileFormula(text) {
  return mapTokens(String(text).replace(/^=/, ''), (t) => {
    if (!/\($/.test(t)) return t;
    const name = t.replace(/\s*\($/, '').toUpperCase();
    if (XLWS.has(name)) return '_xlfn._xlws.' + t;
    if (XLFN.has(name)) return '_xlfn.' + t;
    return t;
  });
}

// Shared formulas store one master formula; each cell of the range gets it moved by its offset. Absolute parts ($)
// stay; a reference pushed off the sheet becomes #REF!, as Excel does.
// Limitation: row ranges are not checked against MAX_ROWS (only the lower bound).
function shiftRef(t, dr, dc) {
  let m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(t);
  if (m) {
    const c = colIndex(m[2]) + (m[1] ? 0 : dc), r = +m[4] - 1 + (m[3] ? 0 : dr);
    if (c < 0 || r < 0 || r >= MAX_ROWS || colIndex(m[2]) < 0) return '#REF!';
    return m[1] + colName(c) + m[3] + (r + 1);
  }
  if ((m = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})$/.exec(t))) {
    const a = colIndex(m[2]) + (m[1] ? 0 : dc), b = colIndex(m[4]) + (m[3] ? 0 : dc);
    return a < 0 || b < 0 ? '#REF!' : m[1] + colName(a) + ':' + m[3] + colName(b);
  }
  if ((m = /^(\$?)(\d+):(\$?)(\d+)$/.exec(t))) {
    const a = +m[2] + (m[1] ? 0 : dr), b = +m[4] + (m[3] ? 0 : dr);
    return a < 1 || b < 1 ? '#REF!' : m[1] + a + ':' + m[3] + b;
  }
  return t;
}

export function shiftFormulaText(text, dr, dc) {
  if (!dr && !dc) return String(text);
  return mapTokens(String(text), (t) => (/^\$?[A-Za-z]{1,3}\$?\d|^\$?[A-Za-z]{1,3}:|^\$?\d+:/.test(t) ? shiftRef(t, dr, dc) : t));
}

// OpenFormula references: [.A1], [.A1:.B2], [.B:.B], [.2:.5], [Sheet2.A1], [$'My sheet'.A1:.C3]; ';' separates arguments.
const ODF_REF = /\[\$?((?:'(?:[^']|'')*'|[^.[\]:';]*))?\.(\$?[A-Za-z]{0,3}\$?\d*)(?::\$?((?:'(?:[^']|'')*'|[^.[\]:';]*))?\.(\$?[A-Za-z]{0,3}\$?\d*))?\]/g;

// Namespace prefix decides the dialect: of: (OpenFormula), oooc: (old OpenOffice), msoxl: (already Excel syntax,
// returned as is). split with a capturing group keeps string literals at odd indexes, so rewriting ';' to ',' never
// touches text inside quotes.
export function fromODFFormula(text) {
  const t = String(text);
  const m = /^(of|oooc|msoxl):=?([\s\S]*)$/i.exec(t);
  const s = m ? m[2] : t.replace(/^=/, '');
  if (m && m[1].toLowerCase() === 'msoxl') return s;
  let out = '';
  // outside string literals: references and separators
  const parts = s.split(/("(?:[^"]|"")*")/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2) { out += parts[i]; continue; }
    out += parts[i]
      .replace(ODF_REF, (all, sh1, a, sh2, b) => {
        const pre = sh1 ? (sh1.startsWith("'") ? sh1 : /^[A-Za-z_][\w.]*$/.test(sh1) ? sh1 : `'${sh1.replace(/'/g, "''")}'`) + '!' : '';
        return pre + a + (b ? ':' + b : '');
      })
      .replace(/;/g, ',')
      .replace(/\b(?:COM\.MICROSOFT|_xlfn)\.(?=[A-Za-z_][\w.]*\s*\()/gi, ''); // Excel-only functions as LibreOffice names them
  }
  return out;
}
