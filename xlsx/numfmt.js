// xlsx/numfmt.js - spreadsheet number formats (ECMA-376 Part 1, 18.8.30-31): built-in format ids, date detection and
// a formatter for numbers, percentages, scientific, fractions, dates, times, elapsed time, text sections, colours and
// conditions ('[>=100]0;0.00').
//
//   formatValue(value, code = 'General', opts?) -> string
//     opts: { date1904, months, monthsShort, days, daysShort } (English names by default)
//   formatGeneral(n) -> string          the 'General' format (about 11 significant digits, E notation when large)
//   isDateFormat(code) / formatKind(code) -> 'general' | 'number' | 'percent' | 'scientific' | 'fraction' | 'date' |
//                                            'time' | 'datetime' | 'text'
//   builtinFormat(id) -> code | null     builtinId(code) -> id | -1
//   formatColor(value, code) -> colour name of the chosen section ('red') or null

//
// Architecture: code -> tokenize (lexer, one pass, sections split on ';') -> analyze (classify each section, resolve
// ambiguities such as 'm' = month or minute, ',' = grouping or /1000 scaling) -> cached compiled form -> per-value
// formatting. Compiling once per code matters: a column of 100k cells shares one format.
// Section semantics (Excel): 1 section = all numbers; 2 = positive/zero ; negative; 3 = + ; - ; zero; 4th = text.
// Negative sections print no minus of their own (the format supplies parentheses etc.), so values are passed as abs.
// Not supported on purpose: '*' fill and '_' width padding (they depend on column width; '_x' becomes one space),
// locale ids in [$-409] (only the currency symbol part is kept), non-Gregorian calendars (b1/b2 are dropped).
import { CellError, serialParts } from './cells.js';

const BUILTIN = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  5: '"$"#,##0_);\\("$"#,##0\\)', 6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)', 8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', 42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', 44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};
// East Asian built-in ids (27-36, 50-58) are dates in their locales; shown as ISO dates here.
// They are excluded from BUILTIN_IDS below so that writing 'yyyy-mm-dd' never maps back to a locale-dependent id.
for (const id of [27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]) BUILTIN[id] = 'yyyy-mm-dd';
for (const id of [32, 33, 55, 56]) BUILTIN[id] = 'h:mm:ss';

export const builtinFormat = (id) => BUILTIN[id] ?? null;
const BUILTIN_IDS = new Map();
for (const [id, code] of Object.entries(BUILTIN)) if (!BUILTIN_IDS.has(code) && +id < 50 && !(+id >= 27 && +id <= 36)) BUILTIN_IDS.set(code, +id);
export const builtinId = (code) => (BUILTIN_IDS.has(code) ? BUILTIN_IDS.get(code) : -1);

const EN = {
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

// --- General -----------------------------------------------------------------------------

const trimZeros = (s) => (s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s);

// Excel's General shows at most ~11 characters of number: scientific from 1e11 up or below 1e-9, otherwise as many
// decimals as fit in 10 significant digits after the integer part. toFixed then trimZeros avoids binary noise such as
// 0.1 + 0.2 = 0.30000000000000004 showing up.
export function formatGeneral(n) {
  if (!Number.isFinite(n)) return n > 0 ? '#NUM!' : n < 0 ? '#NUM!' : '#VALUE!';
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e11 || a < 1e-9) {
    const [m, e] = n.toExponential(5).split('e');
    const ex = +e;
    return trimZeros(m) + 'E' + (ex < 0 ? '-' : '+') + String(Math.abs(ex)).padStart(2, '0');
  }
  if (Number.isInteger(n)) return String(n);
  const digits = Math.min(Math.max(10 - Math.floor(Math.log10(a)), 0), 99);
  return trimZeros(n.toFixed(digits));
}

// --- compiling ---------------------------------------------------------------------------

const CACHE = new Map();
const DATE_TOKENS = new Set(['y', 'm', 'd', 'h', 's', 'ampm', 'elapsed', 'sub']);

// Order of the branches matters: quoted text and backslash escapes first (they can contain any character), then the
// bracket forms, then multi-letter keywords (General, AM/PM, A/P) before single date letters, otherwise the 'm' of
// AM/PM would be read as a month. 'e' is the year in East Asian formats (treated as 4-digit year).
function tokenize(code) {
  const sections = [{ toks: [], cond: null, color: null }];
  let sec = sections[0];
  const n = code.length;
  for (let i = 0; i < n;) {
    const ch = code[i];
    const lo = ch.toLowerCase();
    if (ch === '"') {
      let j = code.indexOf('"', i + 1);
      if (j < 0) j = n;
      sec.toks.push({ t: 'lit', v: code.slice(i + 1, j) });
      i = j + 1;
    } else if (ch === '\\') { sec.toks.push({ t: 'lit', v: code[i + 1] || '' }); i += 2; }
    else if (ch === '_') { sec.toks.push({ t: 'lit', v: ' ' }); i += 2; }
    else if (ch === '*') i += 2; // fill character: column width dependent, nothing here
    else if (ch === ';') { sec = { toks: [], cond: null, color: null }; sections.push(sec); i++; }
    else if (ch === '[') {
      let j = code.indexOf(']', i);
      if (j < 0) j = n;
      const body = code.slice(i + 1, j);
      i = j + 1;
      let m;
      if (/^(h+|m+|s+)$/i.test(body)) sec.toks.push({ t: 'elapsed', v: body[0].toLowerCase(), n: body.length });
      else if ((m = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+(?:[eE][-+]?\d+)?)$/.exec(body))) sec.cond = { op: m[1], v: +m[2] };
      else if (body[0] === '$') { const sym = body.slice(1).split('-')[0]; if (sym) sec.toks.push({ t: 'lit', v: sym }); }
      else sec.color = body.toLowerCase();
    } else if (code.slice(i, i + 7).toLowerCase() === 'general') { sec.toks.push({ t: 'general' }); i += 7; }
    else if (ch === '0' || ch === '#' || ch === '?') { sec.toks.push({ t: 'digit', v: ch }); i++; }
    else if (ch === '.') { sec.toks.push({ t: 'point' }); i++; }
    else if (ch === ',') { sec.toks.push({ t: 'comma' }); i++; }
    else if (ch === '%') { sec.toks.push({ t: 'pct' }); i++; }
    else if ((ch === 'E' || ch === 'e') && (code[i + 1] === '+' || code[i + 1] === '-')) { sec.toks.push({ t: 'exp', v: code[i + 1] }); i += 2; }
    else if (ch === '/') { sec.toks.push({ t: 'slash' }); i++; }
    else if (ch === '@') { sec.toks.push({ t: 'text' }); i++; }
    else if (code.slice(i, i + 5).toUpperCase() === 'AM/PM') { sec.toks.push({ t: 'ampm', v: code.slice(i, i + 5) }); i += 5; }
    else if (code.slice(i, i + 3).toUpperCase() === 'A/P') { sec.toks.push({ t: 'ampm', v: code.slice(i, i + 3) }); i += 3; }
    else if (lo === 'y' || lo === 'm' || lo === 'd' || lo === 'h' || lo === 's' || lo === 'e') {
      let j = i;
      while (j < n && code[j].toLowerCase() === lo) j++;
      sec.toks.push({ t: lo === 'e' ? 'y' : lo, n: lo === 'e' ? 4 : j - i });
      i = j;
    } else if ((lo === 'b') && (code[i + 1] === '1' || code[i + 1] === '2')) i += 2; // Buddhist calendar marks
    else { sec.toks.push({ t: 'lit', v: ch }); i++; }
  }
  return sections;
}

// Any date/time token makes the whole section a date section; number placeholders in it become literals (or
// sub-second digits right after a point). The month/minute rule follows Excel: 'm'/'mm' right after an hour or right
// before a second token means minutes, everywhere else months.
function analyze(sec) {
  const toks = sec.toks;
  const has = (t) => toks.some((k) => k.t === t);
  if (toks.some((k) => DATE_TOKENS.has(k.t))) {
    sec.kind = 'date';
    // Sub-second digits: '.0' / '.00' after seconds.
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].t === 'point' && toks[i + 1] && toks[i + 1].t === 'digit' && toks[i + 1].v === '0') {
        let j = i + 1;
        while (toks[j] && toks[j].t === 'digit') j++;
        toks.splice(i, j - i, { t: 'sub', n: j - i - 1 });
      }
    }
    sec.sub = Math.max(0, ...toks.filter((k) => k.t === 'sub').map((k) => k.n));
    sec.ampm = has('ampm');
    // 'm' next to hours or seconds means minutes.
    const dt = toks.filter((k) => DATE_TOKENS.has(k.t) && k.t !== 'sub');
    for (let i = 0; i < dt.length; i++) {
      const k = dt[i];
      if (k.t !== 'm' || k.n > 2) continue;
      const prev = dt[i - 1], next = dt[i + 1];
      if ((prev && (prev.t === 'h' || (prev.t === 'elapsed' && prev.v === 'h'))) || (next && (next.t === 's' || (next.t === 'elapsed' && next.v === 's')))) k.min = true;
    }
    sec.timeOnly = !dt.some((k) => k.t === 'y' || k.t === 'd' || (k.t === 'm' && !k.min));
    sec.dateOnly = !dt.some((k) => k.t === 'h' || k.t === 's' || k.t === 'elapsed' || k.min || k.t === 'ampm');
    // Date sections print '/', ',', '.' literally.
    for (const k of toks) {
      if (k.t === 'slash') { k.t = 'lit'; k.v = '/'; }
      else if (k.t === 'comma') { k.t = 'lit'; k.v = ','; }
      else if (k.t === 'point') { k.t = 'lit'; k.v = '.'; }
      else if (k.t === 'digit') { k.t = 'lit'; k.v = k.v === '?' ? ' ' : k.v; }
    }
    return sec;
  }
  if (has('general')) { sec.kind = 'general'; return sec; }
  if (!has('digit')) { sec.kind = has('text') ? 'text' : 'literal'; return sec; }
  sec.kind = 'number';
  sec.pct = toks.filter((k) => k.t === 'pct').length;
  // Commas: between integer digit placeholders = grouping; right after the last placeholder = scaling by 1000.
  sec.scale = 0;
  sec.group = false;
  const pointAt = toks.findIndex((k) => k.t === 'point' || k.t === 'exp' || k.t === 'slash');
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t !== 'comma') continue;
    let p = i - 1;
    while (p >= 0 && toks[p].t === 'comma') p--;
    let q = i + 1;
    while (q < toks.length && toks[q].t === 'comma') q++;
    const prevDigit = p >= 0 && toks[p].t === 'digit';
    const nextDigit = q < toks.length && toks[q].t === 'digit';
    if (prevDigit && nextDigit && (pointAt < 0 || i < pointAt)) sec.group = true;
    else if (prevDigit && !nextDigit) sec.scale++;
  }
  sec.toks = toks.filter((k) => k.t !== 'comma');
  const T = sec.toks;
  const slash = T.findIndex((k) => k.t === 'slash');
  if (slash > 0 && T.slice(0, slash).some((k) => k.t === 'digit')) {
    sec.frac = true;
    // numerator = last run of placeholders before '/', integer part = placeholders before it
    let e = slash - 1;
    while (e >= 0 && T[e].t !== 'digit') e--;
    let s = e;
    while (s > 0 && T[s - 1].t === 'digit') s--;
    sec.fracInt = T.slice(0, s).some((k) => k.t === 'digit');
    sec.numTok = T.slice(s, e + 1);
    const after = T.slice(slash + 1);
    const denDigits = after.filter((k) => k.t === 'digit');
    const fixed = after.filter((k) => k.t === 'lit' && /\d/.test(k.v)).map((k) => k.v).join('');
    sec.denFixed = denDigits.length ? 0 : +fixed || 0;
    sec.denLen = denDigits.length || fixed.length || 1;
    sec.preTok = T.slice(0, s);
    sec.midTok = T.slice(e + 1, slash);
    sec.postTok = after.filter((k) => !(k.t === 'lit' && /\d/.test(k.v)) && k.t !== 'digit');
    return sec;
  }
  const exp = T.findIndex((k) => k.t === 'exp');
  const point = T.findIndex((k) => k.t === 'point');
  const intEnd = point >= 0 ? point : exp >= 0 ? exp : T.length;
  sec.intTok = T.slice(0, intEnd);
  sec.decTok = point >= 0 ? T.slice(point + 1, exp >= 0 ? exp : T.length) : [];
  sec.hasPoint = point >= 0;
  sec.nInt = sec.intTok.filter((k) => k.t === 'digit').length;
  sec.nDec = sec.decTok.filter((k) => k.t === 'digit').length;
  if (exp >= 0) {
    sec.exp = T[exp].v;
    sec.expTok = T.slice(exp + 1);
    sec.nExp = sec.expTok.filter((k) => k.t === 'digit').length;
  }
  return sec;
}

// Cache cleared wholesale at 500 entries: simpler than LRU and a workbook rarely has more than a few dozen formats.
function compile(code) {
  let c = CACHE.get(code);
  if (c) return c;
  const secs = tokenize(String(code)).map(analyze);
  // The 4th section (or a lone section with '@') formats text.
  c = { secs, text: secs.length >= 4 ? secs[3] : secs.find((s) => s.kind === 'text') || null };
  if (CACHE.size > 500) CACHE.clear();
  CACHE.set(code, c);
  return c;
}

// --- numbers -----------------------------------------------------------------------------

const pad = (k) => (k === '0' ? '0' : k === '?' ? ' ' : '');

// Integer digits into placeholders (right to left), extra digits before the leftmost one.
// Placeholder semantics: '0' pads with zero, '?' pads with a space (aligns decimals in proportional fonts), '#' adds
// nothing. Digits that do not fit go before the leftmost placeholder (a format never truncates the integer part).
// With grouping the whole integer is emitted at the first placeholder: literals between placeholders inside a
// grouped integer are rare and Excel's own placement there is not reproduced.
function fillInt(toks, digits, group) {
  const out = [];
  const nPh = toks.filter((k) => k.t === 'digit').length;
  if (group) {
    const zeros = toks.filter((k) => k.t === 'digit' && k.v === '0').length;
    let d = digits.padStart(zeros, '0');
    d = d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    let placed = false;
    for (const k of toks) {
      if (k.t === 'digit') { if (!placed) { out.push(d); placed = true; } }
      else out.push(litOf(k));
    }
    return out.join('');
  }
  let di = digits.length - 1;
  let ph = 0;
  for (let i = toks.length - 1; i >= 0; i--) {
    const k = toks[i];
    if (k.t !== 'digit') { out.push(litOf(k)); continue; }
    ph++;
    let s = di >= 0 ? digits[di--] : pad(k.v);
    if (ph === nPh && di >= 0) { s = digits.slice(0, di + 1) + s; di = -1; }
    out.push(s);
  }
  return out.reverse().join('');
}

function fillDec(toks, digits) {
  let last = digits.length - 1;
  while (last >= 0 && digits[last] === '0') last--;
  const out = [];
  let di = 0;
  for (const k of toks) {
    if (k.t !== 'digit') { out.push(litOf(k)); continue; }
    const d = digits[di];
    out.push(di <= last ? d : pad(k.v));
    di++;
  }
  return out.join('');
}

const litOf = (k) => (k.t === 'lit' ? k.v : k.t === 'pct' ? '%' : k.t === 'point' ? '.' : k.t === 'text' ? '' : '');

// toFixed is used for rounding (half away from zero on the decimal string, as Excel shows). From 1e21 toFixed returns
// exponent notation, so General is used instead of mangling "1e+21" into placeholders.
function fmtNumber(sec, x) {
  if (sec.pct) x *= 100 ** sec.pct;
  if (sec.scale) x /= 1000 ** sec.scale;
  if (sec.frac) return fmtFraction(sec, x);
  if (sec.exp) return fmtScientific(sec, x);
  if (x >= 1e21) return formatGeneral(x);
  const s = x.toFixed(Math.min(sec.nDec, 100));
  let [ip, dp = ''] = s.split('.');
  if (ip === '0' && !sec.intTok.some((k) => k.t === 'digit' && k.v === '0')) ip = '';
  return fillInt(sec.intTok, ip, sec.group) + (sec.hasPoint ? '.' : '') + fillDec(sec.decTok, dp);
}

function fmtScientific(sec, x) {
  let e = x === 0 ? 0 : Math.floor(Math.log10(x));
  // Engineering formats ('##0.0E+0'): exponent is a multiple of the integer placeholders.
  if (sec.nInt > 1 && sec.intTok.some((k) => k.v === '#')) e = Math.floor(e / sec.nInt) * sec.nInt;
  else if (sec.nInt > 1) e -= sec.nInt - 1;
  let m = x === 0 ? 0 : x / 10 ** e;
  let ms = m.toFixed(sec.nDec);
  if (+ms >= 10 ** Math.max(1, sec.nInt) && sec.nInt <= 1) { e += 1; m = x / 10 ** e; ms = m.toFixed(sec.nDec); }
  let [ip, dp = ''] = ms.split('.');
  if (ip === '0' && !sec.intTok.some((k) => k.v === '0')) ip = '';
  const es = String(Math.abs(e)).padStart(sec.nExp, '0');
  const sign = e < 0 ? '-' : sec.exp === '+' ? '+' : '';
  return fillInt(sec.intTok, ip, false) + (sec.hasPoint ? '.' : '') + fillDec(sec.decTok, dp) + 'E' + sign + es + sec.expTok.filter((k) => k.t !== 'digit').map(litOf).join('');
}

// Brute force over denominators up to 9 / 99 / 999 ('?/?', '??/??', '???/???'): at most 999 iterations, exact and
// simpler than continued fractions, which also need a bound check to respect the digit limit.
function bestFraction(x, maxDen) {
  let bn = Math.round(x), bd = 1, err = Math.abs(x - bn);
  for (let d = 2; d <= maxDen && err > 1e-12; d++) {
    const nn = Math.round(x * d);
    const e = Math.abs(x - nn / d);
    if (e < err - 1e-15) { err = e; bn = nn; bd = d; }
  }
  return [bn, bd];
}

function fmtFraction(sec, x) {
  let whole = sec.fracInt ? Math.floor(x) : 0;
  const f = x - whole;
  let num, den;
  if (sec.denFixed) { den = sec.denFixed; num = Math.round(f * den); }
  else [num, den] = bestFraction(f, 10 ** sec.denLen - 1);
  if (num === den && sec.fracInt) { whole += 1; num = 0; }
  const numS = String(num).padStart(sec.numTok.length, ' ');
  const denS = String(den).padEnd(sec.denLen, ' ');
  let pre = sec.preTok.length ? fillInt(sec.preTok, whole ? String(whole) : '', false) : '';
  if (sec.fracInt && num === 0) return (pre || '0') + ' '.repeat(numS.length + denS.length + 1 + sec.midTok.map(litOf).join('').length);
  if (!sec.fracInt) num += whole * den;
  return pre + sec.midTok.map(litOf).join('') + (sec.fracInt ? numS : String(num)) + '/' + denS + sec.postTok.map(litOf).join('');
}

// --- dates -------------------------------------------------------------------------------

const p2 = (n) => String(n).padStart(2, '0');

// Excel shows '########' for dates outside 1900-01-00 .. 9999-12-31 (serial 2958465). The value is rounded to the
// shown sub-second precision first, so 23:59:59.6 with 'hh:mm:ss' rolls over to the next minute consistently in
// every field instead of printing :60.
function fmtDate(sec, serial, opts) {
  if (serial < 0 || serial > 2958465.99999) return '#'.repeat(8);
  const unit = 1 / 86400 / 10 ** sec.sub;
  const v = Math.round(serial / unit) * unit;
  const P = serialParts(v, opts.date1904);
  const fracSec = Math.round((v * 86400 - Math.floor(v * 86400 + 1e-9)) * 10 ** sec.sub);
  const names = { ...EN, ...opts };
  let out = '';
  for (const k of sec.toks) {
    switch (k.t) {
      case 'y': out += k.n <= 2 ? p2(P.y % 100) : String(P.y).padStart(4, '0'); break;
      case 'm':
        if (k.min) out += k.n === 1 ? P.mm : p2(P.mm);
        else if (k.n === 1) out += P.m;
        else if (k.n === 2) out += p2(P.m);
        else if (k.n === 3) out += names.monthsShort[P.m - 1];
        else if (k.n === 5) out += names.months[P.m - 1][0];
        else out += names.months[P.m - 1];
        break;
      case 'd':
        if (k.n === 1) out += P.d;
        else if (k.n === 2) out += p2(P.d);
        else if (k.n === 3) out += names.daysShort[P.wd];
        else out += names.days[P.wd];
        break;
      case 'h': { const hh = sec.ampm ? (P.hh % 12 || 12) : P.hh; out += k.n === 1 ? hh : p2(hh); break; }
      case 's': out += k.n === 1 ? P.ss : p2(P.ss); break;
      case 'sub': out += '.' + String(fracSec).padStart(sec.sub, '0').slice(0, k.n); break;
      case 'elapsed': {
        const tot = k.v === 'h' ? Math.floor(v * 24 + 1e-9) : k.v === 'm' ? Math.floor(v * 1440 + 1e-9) : Math.floor(v * 86400 + 1e-9);
        out += String(tot).padStart(k.n, '0');
        break;
      }
      case 'ampm': {
        const pm = P.hh >= 12;
        if (k.v.length === 3) out += (pm ? 'P' : 'A')[k.v[0] === 'a' ? 'toLowerCase' : 'toUpperCase']();
        else out += k.v[0] === 'a' ? (pm ? 'pm' : 'am') : (pm ? 'PM' : 'AM');
        break;
      }
      default: out += litOf(k);
    }
  }
  return out;
}

// --- public ------------------------------------------------------------------------------

function condOK(c, v) {
  switch (c.op) {
    case '<': return v < c.v;
    case '>': return v > c.v;
    case '=': return v === c.v;
    case '<=': return v <= c.v;
    case '>=': return v >= c.v;
    default: return v !== c.v;
  }
}

// Section for a number: [section, value to format, minus sign needed]
// Conditional sections ([>=100]) replace the sign-based choice entirely; an unmatched value falls back to General.
function pick(c, v) {
  const secs = c.secs.filter((s, i) => i < 3 && s.kind !== 'text');
  if (!secs.length) return [null, v, false];
  if (secs.some((s) => s.cond)) {
    for (const s of secs) {
      if (s.cond && !condOK(s.cond, v)) continue;
      // a section made for negatives ('[<0]') prints its own sign
      const negSec = s.cond && (s.cond.op === '<' || s.cond.op === '<=') && s.cond.v <= 0;
      return [s, Math.abs(v), v < 0 && !negSec];
    }
    return [null, v, false];
  }
  if (v < 0) return secs.length >= 2 ? [secs[1], -v, false] : [secs[0], -v, true];
  if (v === 0 && secs.length >= 3) return [secs[2], 0, false];
  return [secs[0], v, false];
}

function fmtSection(sec, v, opts) {
  switch (sec.kind) {
    case 'date': return fmtDate(sec, v, opts);
    case 'general': {
      const g = formatGeneral(v);
      return sec.toks.map((k) => (k.t === 'general' ? g : litOf(k))).join('');
    }
    case 'number': return fmtNumber(sec, v);
    default: return sec.toks.map(litOf).join('');
  }
}

// The minus is added only when the formatted text has a non-zero digit: -0.001 with '0.00' prints "0.00", not
// "-0.00" (Excel behaviour).
export function formatValue(value, code = 'General', opts = {}) {
  if (value == null) return '';
  if (value instanceof CellError) return value.code;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const c = compile(code || 'General');
  if (typeof value === 'string') {
    const ts = c.text;
    if (!ts) return value;
    return ts.toks.map((k) => (k.t === 'text' ? value : litOf(k))).join('');
  }
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return '#NUM!';
  const [sec, x, minus] = pick(c, value);
  if (!sec) return formatGeneral(value);
  const s = fmtSection(sec, x, opts);
  return minus && sec.kind !== 'date' && /[1-9]/.test(s) ? '-' + s : s;
}

export function formatColor(value, code) {
  if (typeof value !== 'number' || !code) return null;
  const [sec] = pick(compile(code), value);
  return sec && sec.color ? sec.color : null;
}

// Classified by the first section only: that is the one positive numbers use, and it decides how an editor treats
// the column (date picker, percent input).
export function formatKind(code) {
  const c = compile(code || 'General');
  const s = c.secs[0];
  if (!s || s.kind === 'general' || s.kind === 'literal') return 'general';
  if (s.kind === 'text') return 'text';
  if (s.kind === 'date') return s.timeOnly ? 'time' : s.dateOnly ? 'date' : 'datetime';
  if (s.frac) return 'fraction';
  if (s.exp) return 'scientific';
  return s.pct ? 'percent' : 'number';
}

export const isDateFormat = (code) => /^(date|time|datetime)$/.test(formatKind(code));
