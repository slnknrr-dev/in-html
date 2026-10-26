// geo/address.js - addresses of Georgia (and of Russian-speaking cities) in three scripts: house numbers with letters
// in Latin, Cyrillic or Mkhedruli, fractions and korpus / block markers; the same letter in other scripts by its
// place in the series; street names reduced to a key without generic words, the kind of street (street / avenue /
// lane / dead end …), a cross-script skeleton that matches Georgian, Russian and Latin spellings of one street, the
// nearest key for a case-inflected name; ready locative phrases; addresses back to text; a free-text address split.
//
//   parseHouseNumber(raw) -> { house, korpus, fraction, raw }        houseNumberText(parts, lang)
//   addressText({ city, street, house, korpus, fraction, flat }, { lang, city, flat }) -> 'Batumi, Rustaveli Ave, 65 bldg 2, apt 4'
//   parseAddress(text) -> { city, street, house, korpus, fraction, flat }
//   korpusTwinSpellings(korpus) -> ['ბ', 'b'] for 'б'
//   normStreetName(name) -> key        streetType(name) -> 'street' | 'avenue' | 'lane' | … | ''
//   streetSkeleton(name) -> Latin words        sameStreet(a, b) -> boolean      streetVariants(name) -> { ka?, lat, ru? }
//   streetKeyIndex(nodes) -> { byKey, hasKa }  nearestStreetKey(keys, raw) -> key | ''
//   streetLocGuess(name, lang) -> 'на улице Руставели' | 'რუსთაველის ქუჩაზე' | 'on Rustaveli Street' | ''
//
// Rationale from the portal: one parser for every path (importer, form, panel), or "65б" and "65 б" become two houses.
// The letter is recognised in all three scripts but never converted: "65ა" and "65a" are probably one house, the
// Cyrillic "б" and the Latin "b" may be different series in different towns; twins are a question for a person, not
// a merge. Twins are found by PLACE in the series of house letters (А Б В … = ა ბ გ … = A B C …), not by sound or
// shape: the Cyrillic series skips й ъ ы ь (never house letters) and ё = е. Measured on 11 611 Batumi houses: 17
// twin pairs, three of them more than 100 m apart - different buildings. Street matching is a SUGGESTION: a wrong
// automatic match files a street's houses under another street for good.
import { translit } from '../lingua/kartuli.js';
import { slugId } from '../portal/text.js';

const LITER = 'a-zа-яё\\u10D0-\\u10F0';
const RE_MAIN = new RegExp(`^(\\d{1,6})\\s*([${LITER}]{1,3})?$`, 'iu');
// An explicit korpus / block marker at the end: "65 к2", "65 корп. 3", "65 bldg B", "65 კორპ. 2", "65 block 4".
const RE_KORPUS = new RegExp(`[\\s,./-]*(?:корпус|корп|кор|к|bldg|building|block|blk|კორპუსი|კორპ|ბლოკი|ბლ)\\s*\\.?\\s*([0-9${LITER}]{1,4})\\s*$`, 'iu');

/**
 * House number -> fields: "65" · "65б" · "65 б" · "65-б" · "65/1" · "65б/1" · "65 к2" · "65 корп. 3" · "37 G". An OSM
 * range "1-3" becomes house 1, fraction 3 (we do not guess for the mapper). Unparsed input is kept whole in `house`:
 * losing an address is worse than keeping a crooked one.
 */
export function parseHouseNumber(raw) {
  let s = String(raw ?? '').replace(/[№#]/g, ' ').replace(/\\/g, '/').replace(/\s+/g, ' ').trim().toLowerCase();
  const out = { house: '', korpus: '', fraction: '', raw: s };
  if (!s) return out;
  const mk = s.match(RE_KORPUS);
  if (mk && mk.index > 0) { out.korpus = mk[1]; s = s.slice(0, mk.index).trim(); }
  let tail = '';
  const cut = s.search(/[/-]/);
  if (cut > 0) { tail = s.slice(cut + 1).trim(); s = s.slice(0, cut).trim(); }
  const mm = s.match(RE_MAIN);
  if (mm) {
    out.house = mm[1].replace(/^0+(?=\d)/, '');
    if (mm[2] && !out.korpus) out.korpus = mm[2];
    else if (mm[2]) out.fraction = out.fraction || mm[2];
  } else out.house = s.slice(0, 24);
  if (tail) {
    const mt = tail.match(RE_MAIN);
    if (mt && !mt[2]) out.fraction = mt[1].replace(/^0+(?=\d)/, '');
    else if (mt && mt[2]) out.fraction = mt[1].replace(/^0+(?=\d)/, '') + mt[2];
    else if (new RegExp(`^[${LITER}]{1,3}$`, 'iu').test(tail) && !out.korpus) out.korpus = tail;
    else out.fraction = tail.slice(0, 12);
  }
  return out;
}

// A stable signature of a parsed house on a street (for de-duplication).
export const houseKey = (streetKey, n) => [streetKey, n.house, n.korpus, n.fraction].join('|');

const KORPUS_ROWS = [
  [...'абвгдежзиклмнопрстуфхцчшщэюя'],          // Cyrillic house-letter series (no ё й ъ ы ь)
  [...'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ'],    // Mkhedruli, alphabet order
  [...'abcdefghijklmnopqrstuvwxyz'],
];

/**
 * The same korpus letter in the other scripts by its place in the series; digits stay. '' for mixed scripts, letters
 * outside a series, or a place another series does not have (Latin has 26). Input is lower-cased (Mtavruli too).
 */
export function korpusTwinSpellings(korpus) {
  const chars = [...String(korpus ?? '').trim().toLowerCase().replace(/ё/g, 'е')];
  let row = -1;
  const pos = [];
  for (const ch of chars) {
    const r = KORPUS_ROWS.findIndex((x) => x.includes(ch));
    if (r < 0) { if (/^[0-9]$/.test(ch)) { pos.push(-1); continue; } return []; }
    if (row >= 0 && r !== row) return [];
    row = r;
    pos.push(KORPUS_ROWS[r].indexOf(ch));
  }
  if (row < 0) return [];
  const out = [];
  for (let r = 0; r < KORPUS_ROWS.length; r++) {
    if (r === row || pos.some((p) => p >= KORPUS_ROWS[r].length)) continue;
    const s = chars.map((ch, i) => (pos[i] < 0 ? ch : KORPUS_ROWS[r][pos[i]])).join('');
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

const WORDS = {
  en: { korpus: 'bldg', flat: 'apt' },
  ru: { korpus: 'к', flat: 'кв.' },
  ka: { korpus: 'კორპ.', flat: 'ბ.' },
};

// "65" · "65/1" · "65 к2" (ru) · "65/1 bldg 2" (en) · "65 კორპ. 2" (ka). No house number -> ''.
export function houseNumberText(p, lang = 'ru') {
  const house = String(p?.house ?? '').trim(), fraction = String(p?.fraction ?? '').trim(), korpus = String(p?.korpus ?? '').trim();
  if (!house) return '';
  const w = WORDS[lang] || WORDS.en;
  return house + (fraction ? '/' + fraction : '') + (korpus ? (lang === 'ru' ? ' ' + w.korpus + korpus : ' ' + w.korpus + ' ' + korpus) : '');
}

// One line: "Батуми, Шерифа Химшиашвили, 65 к2, кв. 44"; empty levels are skipped, not dashed.
export function addressText(p, { lang = 'ru', city = true, flat = true } = {}) {
  const parts = [];
  const t = (v) => String(v ?? '').trim();
  if (city && t(p.city)) parts.push(t(p.city));
  if (t(p.street)) parts.push(t(p.street));
  const num = houseNumberText(p, lang);
  if (num) parts.push(num);
  if (flat && t(p.flat)) parts.push((WORDS[lang] || WORDS.en).flat + ' ' + t(p.flat));
  return parts.join(', ');
}

// --- streets ---------------------------------------------------------------------------------------------------

// Generic words -> street type. They do not distinguish streets ("ул. X" = "X улица"), but the TYPE does: "X Street"
// and "X Lane" are two streets; compare types with sameStreet().
const GENERIC = {
  street: ['улица', 'ул', 'street', 'st', 'str', 'ქუჩა', 'ქ'],
  avenue: ['проспект', 'просп', 'пр-т', 'пр', 'avenue', 'ave', 'av', 'გამზირი', 'გამზ'],
  lane: ['переулок', 'пер', 'lane', 'ln', 'შესახვევი', 'შეს'],
  dead_end: ['тупик', 'deadend', 'cul-de-sac', 'ჩიხი'],
  highway: ['шоссе', 'ш', 'highway', 'hwy', 'გზატკეცილი'],
  boulevard: ['бульвар', 'б-р', 'бул', 'boulevard', 'blvd', 'ბულვარი'],
  embankment: ['набережная', 'наб', 'embankment', 'სანაპირო'],
  square: ['площадь', 'пл', 'square', 'sq', 'მოედანი'],
  passage: ['проезд', 'passage', 'გასასვლელი'],
  road: ['road', 'rd', 'дорога', 'გზა'],
  drive: ['drive', 'dr'],
  alley: ['alley', 'аллея', 'ხეივანი'],
};
const TYPE_OF = new Map(Object.entries(GENERIC).flatMap(([t, ws]) => ws.map((w) => [w, t])));

const tidy = (raw) => String(raw ?? '').toLowerCase().replace(/[.,'"«»()„“”‘’`]/g, ' ').replace(/[‐-―]/g, '-')
  .replace(/\bdead\s+end\b/g, 'deadend').replace(/\s+/g, ' ').trim();

/**
 * Street key: generic words, punctuation and case removed, word order kept ("Lenina Gorkogo" is not "Gorkogo
 * Lenina"). A name of generic words only keeps them (all unnamed streets must not become one). Keys are per
 * language: compare a ka name with a ka key, or use streetSkeleton() across scripts.
 */
export function normStreetName(raw) {
  const s = tidy(raw);
  if (!s) return '';
  const parts = s.split(' ').filter((w) => w && !TYPE_OF.has(w.replace(/-$/, '')));
  return (parts.length ? parts.join(' ') : s).trim();
}

// The kind of street from its generic word ('' when the name has none).
export function streetType(raw) {
  for (const w of tidy(raw).split(' ')) { const t = TYPE_OF.get(w.replace(/-$/, '')); if (t) return t; }
  return '';
}

const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia' };

// Latin ASCII of a word in any of the three scripts (Georgian by the national romanisation, ejective marks dropped).
function latinOf(w) {
  if (/[ა-ჿ]/.test(w)) return translit(w, 'lat').replace(/['’]/g, '');
  return [...w].map((c) => CYR[c] ?? c).join('').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// Spelling-neutral Latin: dzh / j, kh / h, ts / c, doubled letters, y / i and w / v differences folded.
const neutral = (w) => w.replace(/dzh/g, 'j').replace(/kh/g, 'h').replace(/tz|ts/g, 'c').replace(/y/g, 'i').replace(/w/g, 'v').replace(/ph|f/g, 'p').replace(/(.)\1+/g, '$1').replace(/[^a-z0-9]/g, '');

/**
 * Cross-script skeleton of a street name: the key's words in neutral Latin with the Georgian genitive (-ის, -ს) and
 * Russian genitive (-а, -я) endings dropped: 'რუსთაველის გამზირი', 'проспект Руставели', 'Rustaveli Avenue' ->
 * ['rustaveli'].
 */
export function streetSkeleton(raw) {
  return normStreetName(raw).split(' ').filter(Boolean).map((w) => {
    let x = w;
    if (/[ა-ჿ]/.test(x) && x.length > 4) x = x.replace(/(ის|ს)$/u, '');
    if (/[а-я]/.test(x) && x.length > 4) x = x.replace(/[ая]$/u, '');
    return neutral(latinOf(x));
  }).filter(Boolean);
}

/**
 * Two names of one street? Skeletons equal word by word (a word may extend the other by at most two letters, the
 * case endings left), and the street types agree when both are known. Word order counts ("Lenina Gorkogo" is another
 * street than "Gorkogo Lenina"); `anyOrder: true` accepts the swapped given name and surname of OSM addr:street
 * values ("ლორთქიფანიძე გრიგოლის ქ." ~ "Grigol Lortkipanidze Street"). A suggestion, never an automatic merge.
 */
export function sameStreet(a, b, { anyOrder = false } = {}) {
  const ta = streetType(a), tb = streetType(b);
  if (ta && tb && ta !== tb) return false;
  let x = streetSkeleton(a), y = streetSkeleton(b);
  if (!x.length || x.length !== y.length) return false;
  if (anyOrder) { x = x.slice().sort(); y = y.slice().sort(); }
  return x.every((w, i) => { const v = y[i]; const [s, l] = w.length <= v.length ? [w, v] : [v, w]; return s.length >= 3 && l.startsWith(s) && l.length - s.length <= 2; });
}

// A name in other scripts: Georgian -> Latin and Russian transcription; Russian -> Latin; Latin stays.
export function streetVariants(raw) {
  const s = String(raw ?? '').trim();
  if (/[ა-ჿ]/.test(s)) return { ka: s, lat: translit(s, 'lat'), ru: translit(s, 'ru').replace(/’/g, '') };
  if (/[а-яё]/i.test(s)) return { ru: s, lat: slugId(s, '').replace(/-/g, ' ') };
  return { lat: s };
}

/**
 * Index of street nodes { id, kind, name: { ru, en, ka } } by key in every language; `hasKa` marks nodes that already
 * have a Georgian name (a fallback match by another language must not merge a street and its lane).
 */
export function streetKeyIndex(nodes) {
  const byKey = new Map(), hasKa = new Set();
  for (const g of nodes || []) {
    if (g.kind && g.kind !== 'street') continue;
    if (normStreetName((g.name || {}).ka)) hasKa.add(+g.id);
    for (const l of ['ru', 'en', 'ka']) {
      const k = normStreetName((g.name || {})[l]);
      if (k && !byKey.has(k)) byKey.set(k, +g.id);
    }
  }
  return { byKey, hasKa };
}

/**
 * The nearest key to an addr:street value by shared words, where a word also matches in another Georgian case
 * ('ადლიის' ~ 'ადლიას'). Score = shared / max(words), threshold 0.5. A hint for a person.
 */
// Jaccard-like word overlap with a crude Georgian case-ending stem; the strict > 0.5 threshold means a single shared
// word out of two never wins. Linear in the number of keys: used at import time, not per keystroke.
export function nearestStreetKey(keys, raw) {
  const want = normStreetName(raw).split(' ').filter(Boolean);
  if (!want.length) return '';
  const stem = (w) => w.replace(/(ის|ას|ეს|ოს|ს)$/u, '');
  const alike = (a, b) => a === b || (stem(a) && stem(a) === stem(b));
  let best = '', bestScore = 0.5;
  for (const key of keys) {
    const have = String(key || '').split(' ').filter(Boolean);
    if (!have.length) continue;
    const hits = want.filter((w) => have.some((h) => alike(w, h))).length;
    const score = hits / Math.max(want.length, have.length);
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best;
}

// --- locative phrases ------------------------------------------------------------------------------------------

// A closed dictionary: unknown generic words give '' (a person writes the phrase; no morphology is guessed).
const RU_GENERIC = {
  'улица': { prep: 'на', loc: 'улице', ord: ['-я', '-й'] }, 'переулок': { prep: 'в', loc: 'переулке', ord: ['-й', '-м'] },
  'тупик': { prep: 'в', loc: 'тупике', ord: ['-й', '-м'] }, 'проезд': { prep: 'в', loc: 'проезде', ord: ['-й', '-м'] },
  'шоссе': { prep: 'на', loc: 'шоссе', ord: ['-е', '-м'] }, 'площадь': { prep: 'на', loc: 'площади', ord: ['-я', '-й'] },
  'бульвар': { prep: 'на', loc: 'бульваре', ord: ['-й', '-м'] }, 'проспект': { prep: 'на', loc: 'проспекте', ord: ['-й', '-м'] },
  'набережная': { prep: 'на', loc: 'набережной', ord: ['-я', '-й'] },
};
// Georgian: the generic word comes last and takes the postposition (-ზე on, -ში in), changing the stem.
const KA_GENERIC = {
  'ქუჩა': 'ქუჩაზე', 'ჩიხი': 'ჩიხში', 'შესახვევი': 'შესახვევში', 'გამზირი': 'გამზირზე', 'გზატკეცილი': 'გზატკეცილზე',
  'მოედანი': 'მოედანზე', 'სანაპირო': 'სანაპიროზე', 'ბულვარი': 'ბულვარზე',
};
const EN_PREP = { street: 'on', avenue: 'on', highway: 'on', square: 'on', boulevard: 'on', embankment: 'on', road: 'on', lane: 'in', alley: 'in', end: 'in', passage: 'in' };

/**
 * The locative phrase of a street by its name: 'улица Руставели' -> 'на улице Руставели', '3-й тупик Адлиа' ->
 * 'в 3-м тупике Адлиа' (the ordinal agrees), 'რუსთაველის ქუჩა' -> 'რუსთაველის ქუჩაზე', 'Adlia Street' ->
 * 'on Adlia Street'. '' when the name has no known generic word.
 */
export function streetLocGuess(name, lang = 'ru') {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const words = raw.split(' ');
  if (lang === 'ka') {
    const g = KA_GENERIC[words[words.length - 1]];
    return g ? [...words.slice(0, -1), g].join(' ') : '';
  }
  if (lang === 'en') {
    const prep = EN_PREP[words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '')];
    return prep ? `${prep} ${raw}` : '';
  }
  const at = words.findIndex((w) => RU_GENERIC[w.toLowerCase()]);
  if (at < 0) return '';
  const g = RU_GENERIC[words[at].toLowerCase()];
  const out = words.slice();
  out[at] = g.loc;
  if (g.ord && at > 0 && new RegExp(`^\\d+${g.ord[0]}$`).test(out[at - 1])) out[at - 1] = out[at - 1].slice(0, -g.ord[0].length) + g.ord[1];
  return `${g.prep} ${out.join(' ')}`;
}

// --- free text -------------------------------------------------------------------------------------------------

const FLAT_RE = /^(?:кв\.?|квартира|apt\.?|apartment|flat|ბინა|ბ\.)\s*(\d\S*)$/iu;
const HOUSE_AT_END = new RegExp(`^(.*?\\D)\\s+(?:д\\.?\\s*|дом\\s+|№\\s*)?(\\d{1,6}\\s*[${LITER}]{0,3}(?:\\s*[/-]\\s*\\w+)?(?:\\s*(?:к|корп|корпус|bldg|block|კორპ)\\.?\\s*[0-9${LITER}]{1,4})?)$`, 'iu');

/**
 * Splits "Batumi, Rustaveli Ave 65b, apt 4" / "г. Батуми, ул. Руставели, д. 65 к2, кв. 4" /
 * "ბათუმი, რუსთაველის გამზ. 12, ბ. 3" into { city, street, house, korpus, fraction, flat }. The first of two
 * name-like parts is the city unless it has a street word; `cities` (lower-case names) makes the city explicit.
 */
export function parseAddress(text, { cities = [] } = {}) {
  const out = { city: '', street: '', house: '', korpus: '', fraction: '', flat: '' };
  const parts = String(text ?? '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const names = [];
  for (const raw of parts) {
    const p = raw.replace(/^(?:г|город|city|ქ)\.\s*/iu, '');
    let m = p.match(FLAT_RE);
    if (m) { out.flat = m[1]; continue; }
    if (/^(?:д\.?\s*|дом\s+|№\s*)?\d/iu.test(p)) {
      const n = parseHouseNumber(p.replace(/^(?:д\.?\s*|дом\s+|№\s*)/iu, ''));
      Object.assign(out, { house: n.house, korpus: n.korpus, fraction: n.fraction });
      continue;
    }
    m = p.match(HOUSE_AT_END);
    if (m && !out.house) {
      const n = parseHouseNumber(m[2]);
      Object.assign(out, { house: n.house, korpus: n.korpus, fraction: n.fraction });
      names.push({ text: m[1].trim(), street: true });
      continue;
    }
    names.push({ text: p, street: !!streetType(p), city: raw !== p || cities.includes(p.toLowerCase()) });
  }
  const city = names.find((n) => n.city) || (names.length > 1 ? names.find((n) => !n.street) : null);
  if (city) out.city = city.text;
  const street = names.find((n) => n !== city && n.street) || names.find((n) => n !== city);
  if (street) out.street = street.text;
  return out;
}
