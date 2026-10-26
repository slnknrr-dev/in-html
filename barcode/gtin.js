// barcode/gtin.js - GS1 identification numbers: the mod-10 check digit, GTIN-8 / 12 / 13 / 14 recognition and
// normalisation, UPC-E <-> UPC-A, the GS1 prefix table (which GS1 member organisation issued a number, restricted
// in-store ranges, coupons, ISSN / ISBN / ISMN), book and serial numbers (ISBN-10 / 13, ISSN, ISMN) and in-store
// variable-measure codes (scale labels with an embedded weight or price). Pure functions on digit strings.

//
// Numbers are handled as digit STRINGS throughout, never as Numbers: GTINs have significant leading zeros and a
// GTIN-14 exceeds nothing in float, but '0012345' -> 12345 would silently change its kind. Inputs are normalised by
// stripping only spaces, hyphens and dots (how people write them); any other character is an error, not ignored.

const DIGITS = /^\d+$/;
export const onlyDigits = (s) => String(s ?? '').replace(/[\s\-.]/g, '');

// GS1 mod-10 check digit of a digit string without its check digit (weights 3, 1, 3, … from the right).
// Weighting from the RIGHT is what makes one algorithm serve every GTIN length (and SSCC, GLN...): left-padding with
// zeros does not change the sum, so a GTIN-12 and its GTIN-14 form share the check digit. `w = 4 - w` alternates
// 3 and 1 without a branch. It detects every single-digit error and most adjacent transpositions (not 0<->5 etc.).
export function gs1CheckDigit(body) {
  const s = String(body);
  if (!DIGITS.test(s)) throw new Error('digits expected');
  let sum = 0;
  for (let i = s.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += (s.charCodeAt(i) - 48) * w;
  return (10 - (sum % 10)) % 10;
}

// True when the last digit of `code` is its GS1 check digit (any length >= 2).
export const hasValidCheck = (code) => DIGITS.test(String(code)) && String(code).length >= 2
  && gs1CheckDigit(String(code).slice(0, -1)) === +String(code).slice(-1);

// Appends the check digit: completeCheck('400638133393') -> '4006381333931'.
export const completeCheck = (body) => String(body) + gs1CheckDigit(body);

const GTIN_KIND = { 8: 'GTIN-8', 12: 'GTIN-12', 13: 'GTIN-13', 14: 'GTIN-14' };

/**
 * Looks at a GTIN-like string: { kind, digits, gtin14, valid, expected, issue }.
 * issue: 'empty' | 'chars' | 'length' | 'check' | null; `expected` is the correct check digit.
 */
export function inspectGtin(input) {
  const digits = onlyDigits(input);
  const r = { kind: null, digits, gtin14: null, valid: false, expected: null, issue: null };
  if (!digits) { r.issue = 'empty'; return r; }
  if (!DIGITS.test(digits)) { r.issue = 'chars'; return r; }
  r.kind = GTIN_KIND[digits.length] || null;
  if (!r.kind) { r.issue = 'length'; return r; }
  r.expected = gs1CheckDigit(digits.slice(0, -1));
  r.valid = r.expected === +digits.slice(-1);
  if (!r.valid) r.issue = 'check';
  r.gtin14 = digits.padStart(14, '0');
  return r;
}

export const isValidGtin = (s) => inspectGtin(s).valid;

// GTIN in its 14-digit form (leading zeros); null when invalid.
export function toGtin14(s) { const r = inspectGtin(s); return r.valid ? r.gtin14 : null; }

// Shortest GTIN form of a 14-digit GTIN: GTIN-8 when it fits in 8, GTIN-12 when the GTIN-13 starts with 0, else 13/14.
// Caveat: the 14-digit form erases the original length, so a GTIN-12/13 that happens to have six leading zeros in
// GTIN-14 form is returned as a GTIN-8 - the inverse is a convention, not a recovery of what was printed.
export function shortestGtin(s) {
  const g = toGtin14(s);
  if (!g) return null;
  if (g.startsWith('000000')) return g.slice(6);
  if (g.startsWith('00')) return g.slice(2);
  if (g.startsWith('0')) return g.slice(1);
  return g;
}

// --- UPC-E ------------------------------------------------------------------------------------------------------

// UPC-E (number system digit, six data digits, check digit; 6, 7 or 8 digits) -> UPC-A (12 digits).
// A 6-digit input means number system 0 and a computed check digit.
export function upcEToA(e) {
  let s = onlyDigits(e);
  if (!DIGITS.test(s) || ![6, 7, 8].includes(s.length)) return null;
  if (s.length === 6) s = '0' + s;
  const ns = s[0];
  if (ns !== '0' && ns !== '1') return null;
  const d = s.slice(1, 7), last = +d[5];
  let body;
  if (last <= 2) body = d[0] + d[1] + d[5] + '0000' + d[2] + d[3] + d[4];
  else if (last === 3) body = d[0] + d[1] + d[2] + '00000' + d[3] + d[4];
  else if (last === 4) body = d[0] + d[1] + d[2] + d[3] + '00000' + d[4];
  else body = d.slice(0, 5) + '0000' + d[5];
  const a = completeCheck(ns + body);
  if (s.length === 8 && s[7] !== a[11]) return null;
  return a;
}

// UPC-A (11 or 12 digits) -> UPC-E (8 digits) or null when the number has no zero-suppressed form.
// The four zero-suppression patterns of UPC-E are tried in specification order; the candidate is accepted only if it
// expands back to exactly the input (round-trip check), which guards against the patterns' overlapping edge cases.
export function upcAToE(a) {
  let s = onlyDigits(a);
  if (!DIGITS.test(s)) return null;
  if (s.length === 11) s = completeCheck(s);
  if (s.length === 13 && s[0] === '0') s = s.slice(1);
  if (s.length !== 12 || !hasValidCheck(s)) return null;
  const ns = s[0], m = s.slice(1, 6), p = s.slice(6, 11), c = s[11];
  if (ns !== '0' && ns !== '1') return null;
  let e = null;
  if (m.slice(3) === '00' && '012'.includes(m[2]) && p.startsWith('00')) e = m[0] + m[1] + p[2] + p[3] + p[4] + m[2];
  else if (m.slice(3) === '00' && p.startsWith('000')) e = m[0] + m[1] + m[2] + p[3] + p[4] + '3';
  else if (m[4] === '0' && p.startsWith('0000')) e = m.slice(0, 4) + p[4] + '4';
  else if (p.startsWith('0000') && +p[4] >= 5) e = m + p[4];
  return e && upcEToA(ns + e + c) === s ? ns + e + c : null;
}

// --- GS1 prefixes -----------------------------------------------------------------------------------------------

// [from, to, label] over the first three digits of a GTIN-13 (GTIN-12 gets a leading 0). Labels are GS1 member
// organisations (the country where the number was issued, not where the product was made) or special ranges.
export const GS1_PREFIXES = [
  [0, 19, 'GS1 US'], [20, 29, 'restricted:store'], [30, 39, 'GS1 US (drugs)'], [40, 49, 'restricted:company'],
  [50, 59, 'coupon:US'], [60, 139, 'GS1 US'], [200, 299, 'restricted:store'], [300, 379, 'France and Monaco'],
  [380, 380, 'Bulgaria'], [383, 383, 'Slovenia'], [385, 385, 'Croatia'], [387, 387, 'Bosnia and Herzegovina'],
  [389, 389, 'Montenegro'], [390, 390, 'Kosovo'], [400, 440, 'Germany'], [450, 459, 'Japan'], [460, 469, 'Russia'],
  [470, 470, 'Kyrgyzstan'], [471, 471, 'Taiwan'], [474, 474, 'Estonia'], [475, 475, 'Latvia'], [476, 476, 'Azerbaijan'],
  [477, 477, 'Lithuania'], [478, 478, 'Uzbekistan'], [479, 479, 'Sri Lanka'], [480, 480, 'Philippines'],
  [481, 481, 'Belarus'], [482, 482, 'Ukraine'], [483, 483, 'Turkmenistan'], [484, 484, 'Moldova'], [485, 485, 'Armenia'],
  [486, 486, 'Georgia'], [487, 487, 'Kazakhstan'], [488, 488, 'Tajikistan'], [489, 489, 'Hong Kong'], [490, 499, 'Japan'],
  [500, 509, 'United Kingdom'], [520, 521, 'Greece'], [528, 528, 'Lebanon'], [529, 529, 'Cyprus'], [530, 530, 'Albania'],
  [531, 531, 'North Macedonia'], [535, 535, 'Malta'], [539, 539, 'Ireland'], [540, 549, 'Belgium and Luxembourg'],
  [560, 560, 'Portugal'], [569, 569, 'Iceland'], [570, 579, 'Denmark, Faroe Islands and Greenland'], [590, 590, 'Poland'],
  [594, 594, 'Romania'], [599, 599, 'Hungary'], [600, 601, 'South Africa'], [603, 603, 'Ghana'], [604, 604, 'Senegal'],
  [605, 605, 'Uganda'], [606, 606, 'Angola'], [607, 607, 'Oman'], [608, 608, 'Bahrain'], [609, 609, 'Mauritius'],
  [611, 611, 'Morocco'], [613, 613, 'Algeria'], [615, 615, 'Nigeria'], [616, 616, 'Kenya'], [617, 617, 'Cameroon'],
  [618, 618, 'Côte d’Ivoire'], [619, 619, 'Tunisia'], [620, 620, 'Tanzania'], [621, 621, 'Syria'], [622, 622, 'Egypt'],
  [623, 623, 'Brunei'], [624, 624, 'Libya'], [625, 625, 'Jordan'], [626, 626, 'Iran'], [627, 627, 'Kuwait'],
  [628, 628, 'Saudi Arabia'], [629, 629, 'United Arab Emirates'], [630, 630, 'Qatar'], [631, 631, 'Namibia'],
  [640, 649, 'Finland'], [680, 681, 'China'], [690, 699, 'China'], [700, 709, 'Norway'], [729, 729, 'Israel'],
  [730, 739, 'Sweden'], [740, 740, 'Guatemala'], [741, 741, 'El Salvador'], [742, 742, 'Honduras'], [743, 743, 'Nicaragua'],
  [744, 744, 'Costa Rica'], [745, 745, 'Panama'], [746, 746, 'Dominican Republic'], [750, 750, 'Mexico'],
  [754, 755, 'Canada'], [759, 759, 'Venezuela'], [760, 769, 'Switzerland and Liechtenstein'], [770, 771, 'Colombia'],
  [773, 773, 'Uruguay'], [775, 775, 'Peru'], [777, 777, 'Bolivia'], [778, 779, 'Argentina'], [780, 780, 'Chile'],
  [784, 784, 'Paraguay'], [786, 786, 'Ecuador'], [789, 790, 'Brazil'], [800, 839, 'Italy, San Marino and Vatican City'],
  [840, 849, 'Spain and Andorra'], [850, 850, 'Cuba'], [858, 858, 'Slovakia'], [859, 859, 'Czechia'], [860, 860, 'Serbia'],
  [865, 865, 'Mongolia'], [867, 867, 'North Korea'], [868, 869, 'Türkiye'], [870, 879, 'Netherlands'],
  [880, 881, 'South Korea'], [883, 883, 'Myanmar'], [884, 884, 'Cambodia'], [885, 885, 'Thailand'], [888, 888, 'Singapore'],
  [890, 890, 'India'], [893, 893, 'Vietnam'], [896, 896, 'Pakistan'], [899, 899, 'Indonesia'], [900, 919, 'Austria'],
  [930, 939, 'Australia'], [940, 949, 'New Zealand'], [950, 950, 'GS1 Global Office'], [951, 951, 'GS1 Global Office (EPC)'],
  [955, 955, 'Malaysia'], [958, 958, 'Macau'], [960, 969, 'GS1 Global Office (GTIN-8)'], [977, 977, 'serial:ISSN'],
  [978, 978, 'book:ISBN'], [979, 979, 'book:ISBN / ISMN'], [980, 980, 'receipt:refund'], [981, 984, 'coupon:currency'],
  [990, 999, 'coupon'],
];

/**
 * GS1 prefix of a GTIN: { prefix, label, kind } where kind is 'country' | 'restricted' | 'coupon' | 'book' | 'serial'
 * | 'receipt' | 'global' | null (unassigned). GTIN-8 numbers starting with 0 or 2 are restricted (velocity codes).
 */
export function gs1Prefix(input) {
  const d = onlyDigits(input);
  if (!DIGITS.test(d)) return null;
  if (d.length === 8) {
    if (d[0] === '0' || d[0] === '2') return { prefix: d[0], label: 'restricted:store', kind: 'restricted' };
    return lookupPrefix(d.slice(0, 3));
  }
  const g13 = d.length === 14 ? d.slice(1) : d.length === 12 ? '0' + d : d;
  if (g13.length < 3) return null;
  return lookupPrefix(g13.slice(0, 3));
}

// Linear scan of ~150 ranges: microseconds, and the table stays readable/diffable against GS1's published list
// (a binary search would demand strict sorting discipline for no measurable gain). Gaps are unassigned -> kind null.
function lookupPrefix(p3) {
  const n = +p3;
  const hit = GS1_PREFIXES.find(([a, b]) => n >= a && n <= b);
  if (!hit) return { prefix: p3, label: null, kind: null };
  const label = hit[2];
  const m = /^(restricted|coupon|book|serial|receipt):(.*)$/.exec(label);
  const kind = m ? m[1] : /^GS1 Global/.test(label) ? 'global' : 'country';
  return { prefix: p3, label: m ? m[2] : label, kind };
}

// --- ISBN / ISSN / ISMN -----------------------------------------------------------------------------------------

// ISBN-10 / ISSN use mod 11 with descending weights - stronger than GS1 mod 10 (catches all single errors and all
// transpositions) at the cost of an 11th symbol, 'X' for 10. ISBN-13 drops it by reusing GS1 mod 10 under 978/979.
export function isbn10Check(body9) {
  let s = 0;
  for (let i = 0; i < 9; i++) s += (+body9[i]) * (10 - i);
  const c = (11 - (s % 11)) % 11;
  return c === 10 ? 'X' : String(c);
}

/** ISBN of any form -> { isbn13, isbn10 (null outside 978), valid, issue }. Hyphens and spaces are ignored. */
export function parseIsbn(input) {
  const s = String(input ?? '').replace(/^ISBN(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    if (isbn10Check(s.slice(0, 9)) !== s[9]) return { valid: false, issue: 'check', isbn10: s, isbn13: null };
    return { valid: true, issue: null, isbn10: s, isbn13: completeCheck('978' + s.slice(0, 9)) };
  }
  if (/^97[89]\d{10}$/.test(s)) {
    if (!hasValidCheck(s)) return { valid: false, issue: 'check', isbn10: null, isbn13: s };
    const isbn10 = s.startsWith('978') ? s.slice(3, 12) + isbn10Check(s.slice(3, 12)) : null;
    return { valid: true, issue: null, isbn10, isbn13: s, ismn: s.startsWith('9790') };
  }
  return { valid: false, issue: 'format', isbn10: null, isbn13: null };
}

// ISSN check character (mod 11 over 7 digits, X for 10).
export function issnCheck(body7) {
  let s = 0;
  for (let i = 0; i < 7; i++) s += (+body7[i]) * (8 - i);
  const c = (11 - (s % 11)) % 11;
  return c === 10 ? 'X' : String(c);
}

/** ISSN 'NNNN-NNNC' -> { valid, issn, ean13 (977 + 7 digits + variant + check) }. variant: 2 digits, default '00'. */
export function issnToEan(input, variant = '00') {
  const s = String(input ?? '').replace(/^ISSN:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^\d{7}[\dX]$/.test(s) || issnCheck(s.slice(0, 7)) !== s[7] || !/^\d{2}$/.test(variant)) return { valid: false, issn: s, ean13: null };
  return { valid: true, issn: s.slice(0, 4) + '-' + s.slice(4), ean13: completeCheck('977' + s.slice(0, 7) + variant) };
}

/** EAN-13 starting with 977 -> ISSN 'NNNN-NNNC' (or null). */
export function eanToIssn(ean) {
  const d = onlyDigits(ean);
  if (!/^977\d{10}$/.test(d) || !hasValidCheck(d)) return null;
  const b = d.slice(3, 10);
  return b.slice(0, 4) + '-' + b.slice(4) + issnCheck(b);
}

// --- variable-measure (scale) codes -----------------------------------------------------------------------------

/**
 * In-store EAN-13 templates. A template is 13 characters: digits are fixed, 'X' any digit (kept as a flag), 'I' the
 * item number, 'W' / 'P' / 'Q' the value (weight, price, count), 'C' the EAN check digit, 'V' a check digit of the value
 * (the GS1 4- / 5-digit price check, computed with the weighted mod-10 of the value digits when present).
 */
export const SCALE_TEMPLATES = {
  weight: { template: '2XIIIIIWWWWWC', decimals: 3, unit: 'kg' },
  price: { template: '2XIIIIIPPPPPC', decimals: 2, unit: 'money' },
  'weight-6': { template: '2IIIIIIWWWWWC', decimals: 3, unit: 'kg' },
  'price-check': { template: '2XIIIIIVPPPPC', decimals: 2, unit: 'money' },
  count: { template: '2XIIIIIQQQQQC', decimals: 0, unit: 'pcs' },
};

// Weighted mod-10 price check digit of a 4- or 5-digit value (GS1 General Specifications, 7.9.3 / 7.9.4).
// The tables are the spec's "weighting factor" products as lookups (e.g. w2m[d] = units digit of 2d minus its tens
// digit); the 5-digit variant ends with the INVERSE of the 5- table (indexOf), as the spec prescribes.
export function priceCheckDigit(value) {
  const v = String(value);
  const w2m = [0, 2, 4, 6, 8, 9, 1, 3, 5, 7];             // weight 2-
  const w3 = [0, 3, 6, 9, 2, 5, 8, 1, 4, 7];              // weight 3
  const w5p = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];             // weight 5+
  const w5m = [0, 5, 9, 4, 8, 3, 7, 2, 6, 1];             // weight 5-
  if (v.length === 4) {
    const s = w2m[+v[0]] + w2m[+v[1]] + w3[+v[2]] + w5m[+v[3]];
    return (s * 3) % 10;
  }
  if (v.length === 5) {
    const s = w5p[+v[0]] + w2m[+v[1]] + w5m[+v[2]] + w5p[+v[3]] + w2m[+v[4]];
    const r = (10 - (s % 10)) % 10;
    return w5m.indexOf(r);
  }
  throw new Error('4 or 5 digits expected');
}

function templateOf(t) {
  const tpl = typeof t === 'string' ? (SCALE_TEMPLATES[t] || { template: t, decimals: 0 }) : t;
  if (!/^[\dXIWPQCV]{13}$/.test(tpl.template)) throw new Error('bad template');
  return tpl;
}

/** Reads a scale code: { ok, item, value (number), raw, flag, issue } using a template (name or object). */
export function parseScaleCode(code, t = 'weight') {
  const tpl = templateOf(t), d = onlyDigits(code);
  if (!/^\d{13}$/.test(d)) return { ok: false, issue: 'length' };
  let item = '', raw = '', flag = '', vcheck = null;
  for (let i = 0; i < 13; i++) {
    const c = tpl.template[i], x = d[i];
    if (/\d/.test(c) && c !== x) return { ok: false, issue: 'prefix' };
    if (c === 'X') flag += x;
    else if (c === 'I') item += x;
    else if ('WPQ'.includes(c)) raw += x;
    else if (c === 'V') vcheck = +x;
  }
  if (!hasValidCheck(d)) return { ok: false, issue: 'check' };
  if (vcheck != null && priceCheckDigit(raw) !== vcheck) return { ok: false, issue: 'valueCheck' };
  return { ok: true, item, raw, flag, value: +raw / 10 ** (tpl.decimals || 0), unit: tpl.unit || null, issue: null };
}

/** Builds a scale code: buildScaleCode('weight', { item: '12345', value: 1.234, flag: '0' }) -> '2012345012343' + … */
// value is scaled to an integer with Math.round (1.2345 kg -> 1235 g at 3 decimals): truncation would make a label
// systematically under-state weight. Values that do not fit the field throw instead of being silently cut.
export function buildScaleCode(t, { item = '', value = 0, flag = '0' } = {}) {
  const tpl = templateOf(t);
  const nI = (tpl.template.match(/I/g) || []).length, nV = (tpl.template.match(/[WPQ]/g) || []).length;
  const it = String(item).padStart(nI, '0');
  const raw = String(Math.round(Number(value) * 10 ** (tpl.decimals || 0))).padStart(nV, '0');
  if (it.length !== nI || !/^\d+$/.test(it)) throw new Error('item does not fit');
  if (raw.length !== nV || !/^\d+$/.test(raw)) throw new Error('value does not fit');
  let out = '', ii = 0, vi = 0, fi = 0;
  const fl = String(flag);
  for (const c of tpl.template.slice(0, 12)) {
    if (/\d/.test(c)) out += c;
    else if (c === 'X') out += fl[fi++] ?? '0';
    else if (c === 'I') out += it[ii++];
    else if ('WPQ'.includes(c)) out += raw[vi++];
    else if (c === 'V') out += priceCheckDigit(raw);
  }
  return completeCheck(out);
}
