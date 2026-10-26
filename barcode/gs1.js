// barcode/gs1.js - GS1 Application Identifiers: the AI dictionary (formats, predefined lengths, check digits, dates,
// implied decimals), parsing of element strings in every form a scanner or a person produces (HRI with parentheses,
// raw data with GS / FNC1 separators, symbology identifiers ]C1 ]d2 ]Q3 ]e0 ]J1, GS1 Digital Link URIs), validation,
// and building of element strings (HRI text, the data of GS1-128 / DataMatrix with separators, Digital Link URIs).
import { gs1CheckDigit } from './gtin.js';

//
// Core difficulty: in raw data, elements are concatenated without delimiters. A parser knows where an element ends
// only from (a) the PREDEFINED length table (keyed by the first two AI digits - a fixed list GS1 promises never to
// change, so old scanners keep working) or (b) a GS (0x1D) separator after variable-length fields. That is why the
// builder puts fixed-length elements first: they need no separator, so the symbol gets shorter.
// AIs are prefix-free, so trying 2, 3, 4 digits in order finds the unique match.

export const GS = '\x1d';

// [ai, data format, title]. Format: N / X fixed or '..' variable components joined by '+'; flags after a space:
// 'check' (last digit is a GS1 check digit), 'date' (YYMMDD, DD may be 00), 'dec' (the last AI digit is the number of
// decimals), 'cur' (the first 3 digits are an ISO 4217 currency code), 'iso' (ISO 3166 numeric country codes).
const AI_LIST = [
  ['00', 'N18 check', 'SSCC'], ['01', 'N14 check', 'GTIN'], ['02', 'N14 check', 'CONTENT'], ['10', 'X..20', 'BATCH/LOT'],
  ['11', 'N6 date', 'PROD DATE'], ['12', 'N6 date', 'DUE DATE'], ['13', 'N6 date', 'PACK DATE'], ['15', 'N6 date', 'BEST BEFORE'],
  ['16', 'N6 date', 'SELL BY'], ['17', 'N6 date', 'USE BY OR EXPIRY'], ['20', 'N2', 'VARIANT'], ['21', 'X..20', 'SERIAL'],
  ['22', 'X..20', 'CPV'], ['235', 'X..28', 'TPX'], ['240', 'X..30', 'ADDITIONAL ID'], ['241', 'X..30', 'CUST. PART No.'],
  ['242', 'N..6', 'MTO VARIANT'], ['243', 'X..20', 'PCN'], ['250', 'X..30', 'SECONDARY SERIAL'], ['251', 'X..30', 'REF. TO SOURCE'],
  ['253', 'N13+X..17 check', 'GDTI'], ['254', 'X..20', 'GLN EXTENSION COMPONENT'], ['255', 'N13+N..12 check', 'GCN'],
  ['30', 'N..8', 'VAR. COUNT'],
  ['310', 'N6 dec', 'NET WEIGHT (kg)'], ['311', 'N6 dec', 'LENGTH (m)'], ['312', 'N6 dec', 'WIDTH (m)'], ['313', 'N6 dec', 'HEIGHT (m)'],
  ['314', 'N6 dec', 'AREA (m²)'], ['315', 'N6 dec', 'NET VOLUME (l)'], ['316', 'N6 dec', 'NET VOLUME (m³)'],
  ['320', 'N6 dec', 'NET WEIGHT (lb)'], ['330', 'N6 dec', 'GROSS WEIGHT (kg)'], ['331', 'N6 dec', 'LENGTH (m), log'],
  ['332', 'N6 dec', 'WIDTH (m), log'], ['333', 'N6 dec', 'HEIGHT (m), log'], ['334', 'N6 dec', 'AREA (m²), log'],
  ['335', 'N6 dec', 'VOLUME (l), log'], ['336', 'N6 dec', 'VOLUME (m³), log'],
  ['37', 'N..8', 'COUNT'], ['390', 'N..15 dec', 'AMOUNT'], ['391', 'N3+N..15 dec cur', 'AMOUNT (ISO currency)'],
  ['392', 'N..15 dec', 'PRICE'], ['393', 'N3+N..15 dec cur', 'PRICE (ISO currency)'], ['394', 'N4 dec', 'PRCNT OFF'],
  ['400', 'X..30', 'ORDER NUMBER'], ['401', 'X..30', 'GINC'], ['402', 'N17 check', 'GSIN'], ['403', 'X..30', 'ROUTE'],
  ['410', 'N13 check', 'SHIP TO LOC'], ['411', 'N13 check', 'BILL TO'], ['412', 'N13 check', 'PURCHASE FROM'],
  ['413', 'N13 check', 'SHIP FOR LOC'], ['414', 'N13 check', 'LOC No.'], ['415', 'N13 check', 'PAY TO'],
  ['416', 'N13 check', 'PROD/SERV LOC'], ['417', 'N13 check', 'PARTY'], ['420', 'X..20', 'SHIP TO POST'],
  ['421', 'N3+X..9 iso', 'SHIP TO POST (country)'], ['422', 'N3 iso', 'ORIGIN'], ['423', 'N3+N..12 iso', 'COUNTRY - INITIAL PROCESS.'],
  ['424', 'N3 iso', 'COUNTRY - PROCESS.'], ['425', 'N3+N..12 iso', 'COUNTRY - DISASSEMBLY'], ['426', 'N3 iso', 'COUNTRY - FULL PROCESS'],
  ['427', 'X..3', 'ORIGIN SUBDIVISION'],
  ['7001', 'N13', 'NSN'], ['7002', 'X..30', 'MEAT CUT'], ['7003', 'N10', 'EXPIRY TIME'], ['7004', 'N..4', 'ACTIVE POTENCY'],
  ['7005', 'X..12', 'CATCH AREA'], ['7006', 'N6 date', 'FIRST FREEZE DATE'], ['7007', 'N6..12', 'HARVEST DATE'],
  ['7008', 'X..3', 'AQUATIC SPECIES'], ['7009', 'X..10', 'FISHING GEAR TYPE'], ['7010', 'X..2', 'PROD METHOD'],
  ['7020', 'X..20', 'REFURB LOT'], ['7021', 'X..20', 'FUNC STAT'], ['7022', 'X..20', 'REV STAT'], ['7023', 'X..30', 'GIAI - ASSEMBLY'],
  ['7240', 'X..20', 'PROTOCOL'],
  ['8001', 'N14', 'DIMENSIONS'], ['8002', 'X..20', 'CMT No.'], ['8003', 'N14+X..16', 'GRAI'], ['8004', 'X..30', 'GIAI'],
  ['8005', 'N6', 'PRICE PER UNIT'], ['8006', 'N14+N2+N2', 'ITIP'], ['8007', 'X..34', 'IBAN'], ['8008', 'N8+N..4', 'PROD TIME'],
  ['8009', 'X..50', 'OPTSEN'], ['8010', 'X..30', 'CPID'], ['8011', 'N..12', 'CPID SERIAL'], ['8012', 'X..20', 'VERSION'],
  ['8013', 'X..25', 'GMN'], ['8017', 'N18 check', 'GSRN - PROVIDER'], ['8018', 'N18 check', 'GSRN - RECIPIENT'],
  ['8019', 'N..10', 'SRIN'], ['8020', 'X..25', 'REF No.'], ['8026', 'N14+N2+N2', 'ITIP CONTENT'], ['8200', 'X..70', 'PRODUCT URL'],
  ['90', 'X..30', 'INTERNAL'], ['91', 'X..90', 'INTERNAL'], ['92', 'X..90', 'INTERNAL'], ['93', 'X..90', 'INTERNAL'],
  ['94', 'X..90', 'INTERNAL'], ['95', 'X..90', 'INTERNAL'], ['96', 'X..90', 'INTERNAL'], ['97', 'X..90', 'INTERNAL'],
  ['98', 'X..90', 'INTERNAL'], ['99', 'X..90', 'INTERNAL'],
];

// Element strings whose total length (AI + data) is predefined: no separator follows them (GS1 General Specifications
// figure 5.10.1-2, keyed by the first two digits of the AI).
export const PREDEFINED = {
  '00': 20, '01': 16, '02': 16, '03': 16, '04': 18, '11': 8, '12': 8, '13': 8, '14': 8, '15': 8, '16': 8, '17': 8, '18': 8,
  '19': 8, '20': 4, '31': 10, '32': 10, '33': 10, '34': 10, '35': 10, '36': 10, '41': 16,
};

function parseFormat(spec) {
  const [fmt, ...flags] = spec.split(' ');
  const parts = fmt.split('+').map((p) => {
    const m = /^([NX])(\.\.)?(\d+)(?:\.\.(\d+))?$/.exec(p);
    if (m[4]) return { type: m[1], min: +m[3], max: +m[4] };
    return { type: m[1], min: m[2] ? 1 : +m[3], max: +m[3] };
  });
  return { parts, min: parts.reduce((s, p) => s + p.min, 0), max: parts.reduce((s, p) => s + p.max, 0), flags: new Set(flags) };
}

// The dictionary: ai (with the decimal digit for 'dec' families, '3103') -> definition.
const DEFS = new Map();
for (const [ai, spec, title] of AI_LIST) {
  const f = parseFormat(spec);
  const def = { ai, title, spec: spec.split(' ')[0], ...f, check: f.flags.has('check'), date: f.flags.has('date'), dec: f.flags.has('dec'), cur: f.flags.has('cur'), iso: f.flags.has('iso') };
  if (def.dec) for (let d = 0; d <= (spec.startsWith('N4') ? 2 : 9); d++) DEFS.set(ai + d, { ...def, ai: ai + d, decimals: d });
  else DEFS.set(ai, def);
}

export const aiDefinition = (ai) => DEFS.get(String(ai)) || null;
export const allAIs = () => [...DEFS.values()];

// Length of the element string (AI + data) when predefined, else null.
export const predefinedLength = (ai) => PREDEFINED[String(ai).slice(0, 2)] ?? null;

// GS1 AI encodable character set 82.
const CSET82 = /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]*$/;

// The AI at the start of a raw element string (AIs are prefix-free: 2, 3 or 4 digits).
export function matchAI(s, i = 0) {
  for (const n of [2, 3, 4]) {
    const ai = s.slice(i, i + n);
    if (DEFS.has(ai)) return ai;
  }
  return null;
}

// --- values -----------------------------------------------------------------------------------------------------

/**
 * Decodes a GS1 YYMMDD date with the GS1 century rule (sliding window around `now`). Day 00 means the last day of
 * the month. -> 'YYYY-MM-DD' or null.
 */
// Century rule (GS1 General Specifications 7.12): a year 51..99 ahead of now is last century, 50 or more behind is
// next century - expiry dates read correctly across 2099/2100 without a fixed pivot year. `now` is an input for tests.
export function gs1Date(yymmdd, now = new Date()) {
  const m = /^(\d\d)(\d\d)(\d\d)$/.exec(yymmdd);
  if (!m) return null;
  const yy = +m[1], mm = +m[2], dd = +m[3];
  if (mm < 1 || mm > 12) return null;
  const cur = now.getUTCFullYear(), cy = cur % 100, base = cur - cy;
  const diff = yy - cy;
  const year = diff >= 51 ? base - 100 + yy : diff <= -50 ? base + 100 + yy : base + yy;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const day = dd === 0 ? last : dd;
  if (day > last) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Checks one element: -> [] or a list of issues { code, ai } ('unknown' | 'length' | 'chars' | 'check' | 'date').
 */
export function validateElement(ai, value) {
  const def = DEFS.get(ai);
  if (!def) return [{ code: 'unknown', ai }];
  const v = String(value ?? '');
  const issues = [];
  if (v.length < def.min || v.length > def.max) issues.push({ code: 'length', ai });
  // Component types in order (the first components are fixed-length).
  let pos = 0;
  for (const p of def.parts) {
    const len = p.min === p.max ? p.max : Math.min(p.max, v.length - pos);
    const piece = v.slice(pos, pos + len);
    if (p.type === 'N' ? !/^\d*$/.test(piece) : !CSET82.test(piece)) { issues.push({ code: 'chars', ai }); break; }
    pos += len;
  }
  if (def.check && !issues.length) {
    const n = def.parts[0].max, body = v.slice(0, n);
    if (gs1CheckDigit(body.slice(0, -1)) !== +body.slice(-1)) issues.push({ code: 'check', ai });
  }
  if (def.date && !issues.length && !gs1Date(v)) issues.push({ code: 'date', ai });
  if (ai === '7007' && !issues.length && (!gs1Date(v.slice(0, 6)) || (v.length === 12 && !gs1Date(v.slice(6))) || (v.length !== 6 && v.length !== 12))) issues.push({ code: 'date', ai });
  return issues;
}

/** Meaning of a value: { date } | { number, decimals } | { currency, number } | { country } | {}. */
export function interpret(ai, value, now) {
  const def = DEFS.get(ai);
  const v = String(value);
  if (!def) return {};
  if (def.date) return { date: gs1Date(v, now) };
  if (def.cur) return { currency: v.slice(0, 3), number: +v.slice(3) / 10 ** def.decimals, decimals: def.decimals };
  if (def.dec) return { number: +v / 10 ** def.decimals, decimals: def.decimals };
  if (def.iso) return { country: v.slice(0, 3) };
  if (ai === '7003' && v.length === 10) { const d = gs1Date(v.slice(0, 6), now); return d ? { date: `${d}T${v.slice(6, 8)}:${v.slice(8)}` } : {}; }
  return {};
}

// --- parsing ----------------------------------------------------------------------------------------------------

const SYMBOLOGY_IDS = /^\](C1|e0|e1|e2|d2|Q3|J1|E0|E3)/;
const SEP_TOKENS = /<GS>|\{GS\}|\{FNC1\}|␝|\\x1[dD]|\\u001[dD]/g;

/**
 * Parses an element string in any common form. -> { elements: [{ ai, value, title, ...interpret, issues }], form,
 * symbology, issues, rest }. form: 'hri' | 'raw' | 'link'. Never throws; unknown AIs and leftovers end up in issues.
 */
// Input forms are recognised in order: Digital Link URI, then an optional symbology identifier, then textual
// separator spellings ('<GS>', '{FNC1}', '\x1d' typed literally...) normalised to a real GS, then HRI '(01)...'
// vs raw. Variable fields end at the next GS or at their maximum length, whichever comes first. Limitation of the
// HRI form: a value containing '(' would be cut there, since parentheses are the only delimiter.
export function parseGs1(input, { now } = {}) {
  let s = String(input ?? '').trim();
  const out = { elements: [], form: 'raw', symbology: null, issues: [], rest: '' };
  if (/^https?:\/\//i.test(s)) {
    const link = parseDigitalLink(s);
    out.form = 'link';
    if (!link) { out.issues.push({ code: 'link' }); return out; }
    for (const e of link) add(out, e.ai, e.value, now);
    return out;
  }
  const sym = SYMBOLOGY_IDS.exec(s);
  if (sym) { out.symbology = ']' + sym[1]; s = s.slice(sym[0].length); }
  s = s.replace(SEP_TOKENS, GS);
  if (/^\(\d{2,4}\)/.test(s)) {
    out.form = 'hri';
    const re = /\((\d{2,4})\)([^(]*)/gy;
    let m, last = 0;
    while ((m = re.exec(s))) { add(out, m[1], m[2].replace(/\s+$/, ''), now); last = re.lastIndex; }
    if (last < s.length) { out.rest = s.slice(last); out.issues.push({ code: 'rest' }); }
    return out;
  }
  if (s.startsWith(GS)) s = s.slice(1);
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    const ai = matchAI(s, i);
    if (!ai) { out.rest = s.slice(i); out.issues.push({ code: 'unknown', at: i }); break; }
    const def = DEFS.get(ai), pre = predefinedLength(ai);
    let end;
    if (pre) end = i + pre;
    else { const g = s.indexOf(GS, i + ai.length); end = g < 0 ? s.length : g; end = Math.min(end, i + ai.length + def.max); }
    add(out, ai, s.slice(i + ai.length, end), now);
    i = end;
  }
  return out;
}

function add(out, ai, value, now) {
  const def = DEFS.get(ai);
  const issues = validateElement(ai, value);
  out.elements.push({ ai, value, title: def ? def.title : null, ...(def ? interpret(ai, value, now) : {}), issues });
  out.issues.push(...issues);
}

// --- building ---------------------------------------------------------------------------------------------------

/**
 * Builds an element string from [{ ai, value }] (or [[ai, value]]).
 *   order: 'keep' | 'optimal' (predefined-length elements first, so fewer separators are needed)
 * -> { hri '(01)…(10)…', data (raw with GS separators, no leading FNC1), elements, issues }
 */
export function buildGs1(list, { order = 'optimal' } = {}) {
  let els = list.map((e) => (Array.isArray(e) ? { ai: String(e[0]), value: String(e[1]) } : { ai: String(e.ai), value: String(e.value) }));
  if (order === 'optimal') els = [...els.filter((e) => predefinedLength(e.ai)), ...els.filter((e) => !predefinedLength(e.ai))];
  const issues = els.flatMap((e) => validateElement(e.ai, e.value));
  let data = '';
  els.forEach((e, k) => {
    data += e.ai + e.value;
    if (!predefinedLength(e.ai) && k < els.length - 1) data += GS;
  });
  return { hri: els.map((e) => `(${e.ai})${e.value}`).join(''), data, elements: els, issues };
}

// --- GS1 Digital Link -------------------------------------------------------------------------------------------

// Primary keys with their key qualifiers in path order (GS1 Digital Link 1.2).
const DL_KEYS = {
  '01': ['22', '10', '21'], '00': [], '253': [], '255': [], '401': [], '402': [], '414': ['254'], '417': [],
  '8003': [], '8004': [], '8006': ['22', '10', '21'], '8010': ['8011'], '8013': [], '8017': ['8019'], '8018': ['8019'],
};

/** [{ ai, value }] -> 'https://id.gs1.org/01/…/10/…?17=…' (null without a primary key). */
export function toDigitalLink(list, base = 'https://id.gs1.org') {
  const els = list.map((e) => (Array.isArray(e) ? { ai: String(e[0]), value: String(e[1]) } : e));
  const key = els.find((e) => DL_KEYS[e.ai]);
  if (!key) return null;
  let path = `/${key.ai}/${encodeURIComponent(key.value)}`;
  const used = new Set([key]);
  for (const q of DL_KEYS[key.ai]) {
    const e = els.find((x) => x.ai === q);
    if (e) { path += `/${q}/${encodeURIComponent(e.value)}`; used.add(e); }
  }
  const query = els.filter((e) => !used.has(e)).map((e) => `${e.ai}=${encodeURIComponent(e.value)}`).join('&');
  return base.replace(/\/+$/, '') + path + (query ? '?' + query : '');
}

/** Digital Link URI -> [{ ai, value }] or null. Any host is accepted; the path is searched for a primary key. */
export function parseDigitalLink(uri) {
  let u;
  try { u = new URL(uri); } catch { return null; }
  const segs = u.pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const start = segs.findIndex((x, k) => DL_KEYS[x] && k + 1 < segs.length);
  if (start < 0) return null;
  const out = [];
  for (let k = start; k + 1 < segs.length; k += 2) {
    if (!DEFS.has(segs[k])) return null;
    out.push({ ai: segs[k], value: segs[k + 1] });
  }
  for (const [k, v] of u.searchParams) if (/^\d{2,4}$/.test(k) && DEFS.has(k)) out.push({ ai: k, value: v });
  return out;
}
