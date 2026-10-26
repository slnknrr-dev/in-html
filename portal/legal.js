// portal/legal.js - legal acts (pure): unit numbers with inserted articles (12¹, 37¹⁰), natural order, anchors, the
// outline of an act from a flat list of units, the paragraph structure of an article body (numbered paragraphs,
// lettered subparagraphs in Latin, Cyrillic or Georgian letters, repeal notes) and references written in running text
// in English, Russian, Ukrainian, German, French, Spanish and Georgian ("Article 12(3)(a)", "подпункт «а» пункта 3
// статьи 12", "მე-12 მუხლის მე-3 პუნქტის „ა“ ქვეპუნქტი", lists "Articles 12, 14 and 16", "მე-5 და მე-6 მუხლები").
//
//   UNIT_KINDS, UNIT_RANK                      part > section > chapter > article; 'text' = an unnumbered passage
//   parseNum('12^1' | '12¹' | 'IV') -> { base, ins: [1], roman }    numKey -> '12-1' | 'iv'   numHTML -> '12<sup>1</sup>'
//   compareNum(a, b)                           natural order: base, then insertion indices (37¹ < 37² < 37¹⁰)
//   outline(units) -> [{ unit, i, level, children }]    tree by kind rank (articles under chapters under sections …)
//   parseBody(text) -> [{ kind: 'p', num, key, gone, lines, subs: [{ mark, key, gone, lines }] } | { kind: 'text', lines }]
//   subKey(mark) -> 'a' | 'b' …                position of a subparagraph letter in its alphabet as a Latin letter
//   findRefs(text) -> [{ start, end, targets: [{ start, end, art, para, sub }] }]   art / para: numKey, sub: subKey
//   actHint(text, start, end, aliases) -> act key | ''   an act named right after (or, Georgian style, before) a reference
//   isGone(text)                               a repeal note ("(repealed …)", "утратила силу", "ამოღებულია" …)
//   linkRefs(html, { resolve, aliases, current, open }) -> html with the references that resolve as links
//   unitAnchor(base, art, para, sub) -> 'tax-a12-p3-a'      anchors of articles, paragraphs and subparagraphs
import { fold, stemEq, slugId, words } from './text.js';
import { mapText, wrapSpans } from './segments.js';

export const UNIT_KINDS = ['part', 'section', 'chapter', 'article', 'text'];
export const UNIT_RANK = { part: 1, section: 2, chapter: 3, article: 4, text: 5 };
export const ACT_STATUSES = ['force', 'amended', 'pending', 'repealed', 'draft'];

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUP_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/;
const ROMAN = /^[ivxlcdm]+$/i;
const supToDigits = (s) => [...s].map((c) => SUP.indexOf(c)).join('');

// Subtractive Roman numerals (IV = 4). Not validated: "IIII" gives 4 too, which is acceptable for chapter numbers.
function romanValue(s) {
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const t = s.toLowerCase();
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const a = v[t[i]];
    const b = v[t[i + 1]] || 0;
    n += a < b ? -a : a;
  }
  return n;
}

// '12', '12¹', '12¹⁰', '12^1', '12^1^2', 'IV', '3.1' -> { base, ins, roman }; base null when there is no number.
// Inserted articles (12¹, 12^1, 12.1) are the drafting convention for articles added between existing ones; ins[]
// keeps every insertion level. NOTE: ROMAN matches single letters too, so a unit numbered "C" or "D" is read as
// 100 / 500.
export function parseNum(s) {
  const raw = String(s == null ? '' : s).trim();
  if (!raw) return { base: null, ins: [], roman: false, raw };
  if (ROMAN.test(raw)) return { base: romanValue(raw), ins: [], roman: true, raw };
  const m = /^(\d+)((?:\s?[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\^\d+|\.\d+)*)/.exec(raw);
  if (!m) return { base: null, ins: [], roman: false, raw };
  const ins = [];
  const re = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\^(\d+)|\.(\d+)/g;
  let x;
  while ((x = re.exec(m[2]))) ins.push(Number(x[1] || x[2] || supToDigits(x[0].trim())));
  return { base: Number(m[1]), ins, roman: false, raw };
}

// Anchor-safe key: "12-1" for 12¹, lowercase roman for chapters, slug for anything else.
export function numKey(s) {
  const n = parseNum(s);
  if (n.base == null) return slugId(s, '');
  if (n.roman) return n.raw.toLowerCase();
  return [n.base, ...n.ins].join('-');
}

const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function numHTML(s) {
  const n = parseNum(s);
  if (n.base == null || n.roman) return escH(n.raw);
  if (!n.ins.length) return String(n.base);
  return n.base + n.ins.map((i) => `<sup>${i}</sup>`).join('');
}

// Plain display ('12¹'), for titles, search entries and tooltips.
export function numText(s) {
  const n = parseNum(s);
  if (n.base == null || n.roman) return n.raw;
  return n.base + n.ins.map((i) => [...String(i)].map((d) => SUP[+d]).join('')).join('');
}

// Missing insertion index sorts first (-1): 37 < 37¹ < 37² < 37¹⁰ (numeric, not lexicographic).
export function compareNum(a, b) {
  const x = parseNum(a);
  const y = parseNum(b);
  if (x.base == null || y.base == null) return x.base == null && y.base == null ? String(a).localeCompare(String(b)) : x.base == null ? 1 : -1;
  if (x.base !== y.base) return x.base - y.base;
  for (let i = 0; i < Math.max(x.ins.length, y.ins.length); i++) {
    const p = x.ins[i] ?? -1;
    const q = y.ins[i] ?? -1;
    if (p !== q) return p - q;
  }
  return 0;
}

export function unitAnchor(base, art, para, sub) {
  let s = (base ? base + '-' : '') + 'a' + art;
  if (para) s += '-p' + para;
  if (sub) s += '-' + sub;
  return s;
}

// Tree of a flat unit list: a unit nests under the closest previous unit of a higher rank.
// Stack-based nesting by rank: only containers (rank < article) are pushed, so articles never get children.
export function outline(units) {
  const root = { level: 0, rank: 0, children: [] };
  const stack = [root];
  (units || []).forEach((u, i) => {
    const rank = UNIT_RANK[u && u.kind] || UNIT_RANK.article;
    while (stack.length > 1 && stack[stack.length - 1].rank >= rank) stack.pop();
    const node = { unit: u, i, rank, level: stack.length, children: [] };
    stack[stack.length - 1].children.push(node);
    if (rank < UNIT_RANK.article) stack.push(node);
  });
  return root.children;
}

/* ---------- article bodies ---------- */

const GONE_RE = /^[(\[]?\s*(?:repealed|deleted|excluded|утратил[аио]?|исключ[её]н[аоы]?|виключено|втратил[аи]?|втратив|aufgehoben|gestrichen|abrog[ée]e?s?|supprim[ée]e?s?|derogad[oa]s?|suprimid[oa]s?|ამოღებულია|ძალადაკარგულია)/i;
export const isGone = (text) => GONE_RE.test(String(text || '').replace(/^\s*[-–—]\s*/, ''));

// Subparagraph letters in the order the drafting traditions use (Russian skips й ъ ы ь; Georgian uses the 33 modern
// letters): a mark's key is its position as a Latin letter, so 'б', 'ბ' and 'b' are all 'b'.
const SUB_ALPHABETS = ['abcdefghijklmnopqrstuvwxyz', 'абвгдежзиклмнопрстуфхцчшщэюя', 'абвгґдеєжзиіїклмнопрстуфхцчшщюя', 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ'];
// Letters map to their position in their own alphabet, expressed as a Latin letter: references in any language land on the same id.
export function subKey(mark) {
  const m = String(mark || '').toLowerCase().replace(/[„“"«»)(\s]/g, '').replace(/\.+$/, '');
  if (!m) return '';
  const parts = m.split(/[.]/).filter(Boolean);
  const one = (ch) => {
    const c = [...ch][0];
    const sup = [...ch].slice(1).join('');
    for (const a of SUB_ALPHABETS) {
      const i = a.indexOf(c);
      if (i >= 0) return (i < 26 ? 'abcdefghijklmnopqrstuvwxyz'[i] : 'z' + (i - 25)) + (sup ? supToDigits(sup) || '' : '');
    }
    return slugId(c, '');
  };
  // Nested marks ('ა.ა)') keep both levels.
  return parts.length > 1 ? parts.map(one).join('-') : one(m);
}

const PARA_RE = /^(\d+(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\^\d+)?(?:\.\d+)*)[.)]\s+(.*)$/;
const SUB_RE = /^[„"«(]?((?:[a-zа-яіїєґა-ჰ][⁰¹²³⁴⁵⁶⁷⁸⁹]*)(?:\.[a-zа-яіїєґა-ჰ][⁰¹²³⁴⁵⁶⁷⁸⁹]*)?)[“"»]?\)\s+(.*)$/i;

// Line-oriented state machine: a numbered line opens a paragraph, a lettered line a subparagraph; continuation lines
// join the open unit until a blank line. NOTE: the condition (cur || out.length === 0 || !blank || true) is always
// true, a leftover; any lettered line becomes a subparagraph.
export function parseBody(text) {
  const out = [];
  let cur = null;   // current paragraph
  let sub = null;   // current subparagraph
  let free = null;  // current free text block
  let blank = true;
  for (const raw of String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { blank = true; sub = null; free = null; continue; }
    let m = PARA_RE.exec(line);
    if (m) {
      cur = { kind: 'p', num: m[1], key: numKey(m[1].replace(/\./g, '^')), gone: isGone(m[2]), lines: [m[2]], subs: [] };
      out.push(cur);
      sub = null; free = null; blank = false;
      continue;
    }
    m = SUB_RE.exec(line);
    if (m && (cur || out.length === 0 || !blank || true)) {
      if (!cur) { cur = { kind: 'p', num: '', key: '', gone: false, lines: [], subs: [] }; out.push(cur); }
      sub = { mark: m[1], key: subKey(m[1]), gone: isGone(m[2]), lines: [m[2]] };
      cur.subs.push(sub);
      free = null; blank = false;
      continue;
    }
    if (!blank && sub) sub.lines.push(line);
    else if (!blank && cur && !cur.subs.length) cur.lines.push(line);
    else if (!blank && free) free.lines.push(line);
    else {
      free = { kind: 'text', lines: [line] };
      out.push(free);
      cur = blank ? null : cur;
      sub = null;
    }
    blank = false;
  }
  return out;
}

/* ---------- references in running text ---------- */

// Pattern fragments built with String.raw so backslashes stay literal; lookbehind NB / lookahead NA replace \b, which is ASCII-only in JS.
const N = String.raw`\d+(?:\s?[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\^\d+)?`;
const NB = String.raw`(?<![\p{L}\p{N}])`;   // no letter / digit before
const NA = String.raw`(?![\p{L}\p{N}])`;    // no letter / digit after
const KA_WORDS = ['პირველი', 'მეორე', 'მესამე', 'მეოთხე', 'მეხუთე', 'მეექვსე', 'მეშვიდე', 'მერვე', 'მეცხრე', 'მეათე'];
const KA_ORD = String.raw`(?:მე-?${N}(?:-ე)?|${N}-ლი|${KA_WORDS.join('|')})`;
const LIST_SEP = String.raw`\s*(?:,|–|—|-|\band\b|\bor\b|и|или|та|і|або|und|oder|et|ou|y|o|და|ან)\s*`;
const KA_SEP = String.raw`\s*(?:,|–|—|და|ან)\s*`;
const SUBQ = (name) => String.raw`[„"«“(]?(?<${name}>[a-zа-яіїєґა-ჰ])[“"»”)]?`;

const P = (s) => new RegExp(s, 'giu');
// One regex per language family, all flags giu. Named groups (list, para, sub and their alternates) let findRefs
// read every pattern the same way. Georgian puts the act name before the reference and uses ordinals (მე-12).
const PATTERNS = [
  // Georgian: "მე-12 მუხლის მე-3 პუნქტის „ა“ ქვეპუნქტი", "მე-5 და მე-6 მუხლები", "1-ლი მუხლი"
  { re: P(String.raw`${NB}(?<list>${KA_ORD}(?:${KA_SEP}${KA_ORD})*)\s+მუხლ[ა-ჰ]*(?:\s+(?<para>${KA_ORD})\s+(?:ნაწილ|პუნქტ)[ა-ჰ]*)?(?:\s+${SUBQ('sub')}\s+ქვეპუნქტ[ა-ჰ]*)?`), ka: true },
  // Georgian heading style: "მუხლი 12", "მუხლის 12"
  { re: P(String.raw`${NB}მუხლ(?:ი|ის|ით|ში|ზე)?\s+(?<list>${N})${NA}`) },
  // Russian / Ukrainian: "подпункт «а» пункта 3 статьи 12", "части 2 статьи 5", "ст. 12", "статей 12 и 14"
  { re: P(String.raw`${NB}(?:(?:под|під)пункт[\p{L}]*\s*${SUBQ('sub')}\s+|пп\.\s*${SUBQ('sub2')}\s+)?(?:(?:пункт|част|частин)[\p{L}]*\s+(?<para>\d+)\s+|(?:п|ч)\.\s*(?<para2>\d+)\s+)?(?:стат(?:ь|т)[\p{L}]*|ст\.)\s*(?<list>${N}(?:${LIST_SEP}${N})*)${NA}`) },
  // English: "subparagraph (a) of paragraph 3 of Article 12", "paragraph 3 of Article 12", "Article 12(3)(a)", "Articles 12 and 14"
  { re: P(String.raw`${NB}(?:(?:sub-?paragraph|point|letter)\s*\(?(?<sub>[a-z])\)?\s+of\s+)?(?:(?:paragraph|para\.)\s*(?<para>\d+)\s+of\s+)?(?:the\s+)?(?:articles?|arts?\.)\s*(?<list>${N}(?:${LIST_SEP}${N})*)(?:\s*\((?<para2>\d+)\))?(?:\s*\((?<sub2>[a-z])\))?(?:,\s*(?:paragraph|para\.)\s*(?<para3>\d+))?${NA}`) },
  // German: "Artikel 12 Absatz 2 Buchstabe a", "Art. 12 Abs. 2", "§ 12"
  { re: P(String.raw`(?:${NB}Art(?:ikel|\.)|§)\s*(?<list>${N}(?:${LIST_SEP}${N})*)(?:\s+Abs(?:atz|\.)\s*(?<para>\d+))?(?:\s+(?:Buchst(?:abe|\.)|lit\.)\s*(?<sub>[a-z]))?${NA}`) },
  // French: "l'alinéa 2 de l'article 12", "article 12, alinéa 2"
  { re: P(String.raw`${NB}(?:(?:alinéa|paragraphe)\s+(?<para>\d+)\s+de\s+l['’])?articles?\s+(?<list>${N}(?:${LIST_SEP}${N})*)(?:,\s*(?:alinéa|paragraphe)\s+(?<para2>\d+))?${NA}`) },
  // Spanish: "apartado 2 del artículo 12", "artículo 12, letra a)"
  { re: P(String.raw`${NB}(?:(?:apartado|párrafo|numeral)\s+(?<para>\d+)\s+del\s+)?art(?:ículos?|\.)\s*(?<list>${N}(?:${LIST_SEP}${N})*)(?:,\s*(?:apartado|párrafo)\s+(?<para2>\d+))?(?:,?\s*letra\s+(?<sub>[a-z])\)?)?${NA}`) },
];

const KA_WORD_NUM = Object.fromEntries(KA_WORDS.map((w, i) => [w, String(i + 1)]));
const NUM_IN = new RegExp(String.raw`${KA_WORDS.join('|')}|${N}`, 'gu');

// '12¹' / 'მე-12' / 'პირველი' -> numKey
function refNum(s) {
  const t = String(s).trim();
  if (KA_WORD_NUM[t]) return KA_WORD_NUM[t];
  const m = new RegExp(N, 'u').exec(t);
  return m ? numKey(m[0].replace(/\s+/g, '')) : '';
}

// Matches of all patterns are collected, then the earliest / longest wins and overlaps are dropped. A list ("Articles
// 12, 14 and 16") yields one link per number; a reference with paragraph / subparagraph yields one link for the whole
// phrase.
export function findRefs(text) {
  const s = String(text == null ? '' : text);
  const found = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(s))) {
      const g = m.groups || {};
      const paraRaw = g.para || g.para2 || g.para3 || '';
      const para = paraRaw ? refNum(paraRaw) : '';
      const subRaw = g.sub || g.sub2 || '';
      const sub = subRaw ? subKey(subRaw) : '';
      // Numbers of the list with their positions inside the match.
      const listStart = m.index + m[0].indexOf(g.list);
      const nums = [];
      NUM_IN.lastIndex = 0;
      let x;
      while ((x = NUM_IN.exec(g.list))) nums.push({ start: listStart + x.index, end: listStart + x.index + x[0].length, art: refNum(x[0]) });
      // Georgian ordinals keep their "მე-" prefix inside the link.
      if (p.ka) for (const n of nums) { const pre = s.slice(Math.max(0, n.start - 3), n.start); if (pre === 'მე-') n.start -= 3; else if (s.slice(n.start - 2, n.start) === 'მე') n.start -= 2; }
      const start = m.index;
      const end = m.index + m[0].length;
      let targets;
      if (nums.length === 1 || para || sub) targets = [{ start, end, art: nums[0] ? nums[0].art : '', para, sub }];
      else {
        targets = nums.map((n, i) => ({ start: i === 0 && !p.ka ? start : n.start, end: p.ka && i === nums.length - 1 ? end : n.end, art: n.art, para: '', sub: '' }));
      }
      found.push({ start, end, targets: targets.filter((t) => t.art) });
    }
  }
  // Earliest, then longest; overlapping matches of other patterns are dropped.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let pos = -1;
  for (const f of found) {
    if (f.start < pos || !f.targets.length) continue;
    out.push(f);
    pos = f.end;
  }
  return out;
}

// Act named next to a reference: aliases = [{ key, words: [[folded words of a name], …] }]. Looks at up to eight words
// after the reference ("… of the Tax Code", "… Налогового кодекса") and, for languages that put the act first, the words
// right before it ("საგადასახადო კოდექსის მე-12 მუხლი"). Returns the key of the longest name found, or ''.
// Window of 8 words on each side; the longest alias wins, so "Tax Code" beats "Code".
export function actHint(text, start, end, aliases) {
  if (!aliases || !aliases.length) return '';
  const s = String(text);
  const after = words(s.slice(end, end + 160)).slice(0, 8);
  const before = words(s.slice(Math.max(0, start - 160), start)).slice(-8);
  let best = '';
  let bestLen = 0;
  const seqAt = (ws, i, name) => name.every((w, k) => ws[i + k] && stemEq(ws[i + k], w));
  for (const a of aliases) {
    for (const name of a.words || []) {
      if (!name.length || name.length <= bestLen) continue;
      let hit = false;
      // After: the name starts within the first four words (skipping "of the", "настоящего", "des" …).
      for (let i = 0; i <= Math.min(3, after.length - name.length) && !hit; i++) hit = seqAt(after, i, name);
      // Before: the name ends right before the reference.
      if (!hit && before.length >= name.length) hit = seqAt(before, before.length - name.length, name);
      if (hit) { best = a.key; bestLen = name.length; }
    }
  }
  return best;
}

// Folded word lists of act names for actHint (comma / semicolon separated aliases, the title).
export function aliasWords(...names) {
  const out = [];
  for (const n of names) for (const part of String(n || '').split(/[,;\n]+/)) {
    const w = words(part.replace(/[„“"«»]/g, ''));
    if (w.length) out.push(w);
  }
  return out;
}

export const foldTitle = (s) => fold(String(s || '').replace(/^[„“"«»\s]+/, ''));

// Planned changes, one per line: 'YYYY-MM-DD: Articles 12 and 14 — what changes' (or DD.MM.YYYY) -> [{ day, text }];
// lines without a date keep day ''.
export function parseChanges(text) {
  const out = [];
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m = /^(\d{4})-(\d{2})-(\d{2})\s*[:—–-]?\s*(.*)$/.exec(line);
    if (m) { out.push({ day: `${m[1]}-${m[2]}-${m[3]}`, text: m[4] }); continue; }
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[:—–-]?\s*(.*)$/.exec(line);
    if (m) { out.push({ day: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, text: m[4] }); continue; }
    out.push({ day: '', text: line });
  }
  return out;
}

// References in the text of safe HTML become links: resolve({ act, art, para, sub }) -> href | null (no link when the
// target does not exist). `act` is the key named next to the reference (actHint) or `current`.
// open(href, target) -> '<a …>'.
// Unresolvable references stay plain text: a link must never point at an article that is not on the site.
export function linkRefs(html, { resolve, aliases = [], current = '', open } = {}) {
  return mapText(html, (text) => {
    const refs = findRefs(text);
    if (!refs.length) return null;
    const spans = [];
    for (const r of refs) {
      const act = actHint(text, r.start, r.end, aliases) || current;
      for (const t of r.targets) {
        const target = { act, art: t.art, para: t.para, sub: t.sub };
        const href = resolve(target);
        if (href) spans.push({ start: t.start, end: t.end, open: open(href, target), close: '</a>' });
      }
    }
    return spans.length ? wrapSpans(text, spans) : null;
  });
}
