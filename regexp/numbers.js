// regexp/numbers.js - generator of number patterns. A digit alphabet lists the characters of every digit value, and a
// value may have several characters ('A' and 'a' are both 10; 〇 and 零 are both 0). From it the generator builds
// integers (exact ranges in any base: uint8, int32, 0–65535…), signed and unsigned decimals with fractions and
// exponents, leading-zero rules, digit grouping (western 1,234,567, Indian 12,34,567, myriad 1234,5678), prefixes
// (0x) and suffixes; the parts are captured in named groups (sign, prefix, int, frac, exp, suffix).
//
//   ALPHABETS                          standard (bin, oct, dec, hex…) and Unicode decimal digit sets of many scripts
//   parseAlphabet(text) -> digits      "0 1 2 … 9 A|a B|b …": values separated by spaces or lines, variants by |
//   numberPattern(options) -> { source, flags, valid, invalid, notes, error? }
//   NUMBER_PRESETS                     ready-made option sets (uint8 … int64, decimal, JSON, hex byte, locales)
//
// Every repetition is over an explicit digit class; ranges are exact (BigInt), with alternatives that start with
// disjoint digits, so matching never backtracks more than a few positions.
//
// Self-check: every result carries generated valid / invalid examples tested against the produced pattern, so a
// generator bug shows up as a mismatch (see `mismatches`) instead of silently shipping a wrong regex.

import { alternation, charClass, escapeClassChar, escapeLiteral } from './wordlist.js';

// --- alphabets ---------------------------------------------------------------------------------------------------

const seq = (start, n = 10) => Array.from({ length: n }, (_, i) => [String.fromCodePoint(start + i)]);
const ascii = (chars) => Array.from(chars, (c) => [c]);
// Digit values 10+ get both cases: 55 + v = 'A'.., 87 + v = 'a'.. (so 'A' and 'a' both mean 10).
const latinCase = (n) => Array.from({ length: n }, (_, v) => (v < 10 ? [String(v)] : [String.fromCharCode(55 + v), String.fromCharCode(87 + v)]));

// Unicode decimal digit sets (General_Category Nd, positional, values 0–9) by the code point of their zero.
const SCRIPTS = {
  arabicIndic: 0x0660, persian: 0x06F0, nko: 0x07C0, devanagari: 0x0966, bengali: 0x09E6, gurmukhi: 0x0A66, gujarati: 0x0AE6,
  oriya: 0x0B66, tamil: 0x0BE6, telugu: 0x0C66, kannada: 0x0CE6, malayalam: 0x0D66, thai: 0x0E50, lao: 0x0ED0, tibetan: 0x0F20,
  myanmar: 0x1040, khmer: 0x17E0, mongolian: 0x1810, fullwidth: 0xFF10, mathBold: 0x1D7CE,
};
const CHINESE = [['〇', '零'], ['一', '壹'], ['二', '贰', '貳'], ['三', '叁', '參'], ['四', '肆'], ['五', '伍'], ['六', '陆', '陸'], ['七', '柒'], ['八', '捌'], ['九', '玖']];

export const ALPHABETS = [
  { key: 'bin', group: 'standard', digits: ascii('01') },
  { key: 'oct', group: 'standard', digits: ascii('01234567') },
  { key: 'dec', group: 'standard', digits: ascii('0123456789') },
  { key: 'hex', group: 'standard', digits: latinCase(16) },
  { key: 'hexUpper', group: 'standard', digits: ascii('0123456789ABCDEF') },
  { key: 'hexLower', group: 'standard', digits: ascii('0123456789abcdef') },
  { key: 'base36', group: 'standard', digits: latinCase(36) },
  { key: 'decAnyScript', group: 'script', digits: Array.from({ length: 10 }, (_, v) => [String(v), ...Object.values(SCRIPTS).map((z) => String.fromCodePoint(z + v))]) },
  ...Object.entries(SCRIPTS).map(([key, zero]) => ({ key, group: 'script', digits: seq(zero) })),
  { key: 'chinese', group: 'script', digits: CHINESE },
];

export const alphabetOf = (key) => (ALPHABETS.find((a) => a.key === key) || ALPHABETS[2]).digits;

export function parseAlphabet(text) {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  return tokens.map((t) => t.split('|').filter(Boolean));
}

export const alphabetText = (digits) => digits.map((v) => v.join('|')).join(' ');

// --- ranges ------------------------------------------------------------------------------------------------------

// BigInt throughout: int64 / uint64 bounds exceed Number.MAX_SAFE_INTEGER (2^53), where Number would round silently.
function toDigits(n, B) {
  const b = BigInt(B), out = [];
  do { out.unshift(Number(n % b)); n /= b; } while (n > 0n);
  return out;
}

// Sequences of per-position value intervals covering exactly [a, b] for digit arrays of one length.
// Classic range-to-regex split: equal leading digit -> recurse; otherwise peel [a0 a.., a0 max..], the full middle
// block [a0+1 .. b0-1] x anything, and [b0 0.., b0 b..]. The pieces are disjoint and start with disjoint digit
// intervals, which is what keeps the generated alternation free of backtracking.
function sameLength(a, b, B) {
  const L = a.length;
  if (!L) return [[]];
  const rest = (x) => x.slice(1);
  if (a[0] === b[0]) return sameLength(rest(a), rest(b), B).map((s) => [[a[0], a[0]], ...s]);
  const restMin = rest(a).every((d) => d === 0), restMax = rest(b).every((d) => d === B - 1);
  const out = [];
  let lo = a[0], hi = b[0];
  if (!restMin) { out.push(...sameLength(rest(a), Array(L - 1).fill(B - 1), B).map((s) => [[a[0], a[0]], ...s])); lo++; }
  const tail = restMax ? [] : sameLength(Array(L - 1).fill(0), rest(b), B).map((s) => [[b[0], b[0]], ...s]);
  if (!restMax) hi--;
  if (lo <= hi) out.push([[lo, hi], ...Array.from({ length: L - 1 }, () => [0, B - 1])]);
  out.push(...tail);
  return out;
}

// Interval sequences for every value in [lo, hi] (BigInt, 0 ≤ lo ≤ hi), shortest numbers first.
export function rangeSequences(lo, hi, B) {
  const dl = toDigits(lo, B), dh = toDigits(hi, B), out = [];
  for (let L = dl.length; L <= dh.length; L++) {
    // Each length is handled separately: [lo, B^L - 1] for the shortest, [B^(L-1), ..] for longer ones, so no
    // sequence ever needs a leading zero.
    const a = L === dl.length ? dl : [1, ...Array(L - 1).fill(0)];
    const b = L === dh.length ? dh : Array(L).fill(B - 1);
    out.push(...sameLength(a, b, B));
  }
  return mergeSequences(out);
}

// Two sequences that differ in one position with adjacent intervals become one.
// Fixed-point loop, restarted after each merge: O(n^3) worst case, but n is the number of split pieces (about
// 2 * digits * lengths), so a few dozen at most.
function mergeSequences(list) {
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.length !== b.length) continue;
        let diff = -1, same = true;
        for (let k = 0; k < a.length; k++) {
          if (a[k][0] === b[k][0] && a[k][1] === b[k][1]) continue;
          if (diff >= 0) { same = false; break; }
          diff = k;
        }
        if (!same || diff < 0) continue;
        const [x, y] = a[diff][0] <= b[diff][0] ? [a[diff], b[diff]] : [b[diff], a[diff]];
        if (x[1] + 1 !== y[0]) continue;
        const merged = a.slice();
        merged[diff] = [x[0], y[1]];
        list.splice(j, 1);
        list[i] = merged;
        changed = true;
        break outer;
      }
    }
  }
  return list;
}

// --- rendering ----------------------------------------------------------------------------------------------------

// sepAt(k): is there a group separator before the digit that has k digits to its right? Indian grouping: first
// group of 3 (thousands), then groups of 2 (lakh, crore).
const GROUPING = {
  western: (k) => k > 0 && k % 3 === 0,
  indian: (k) => k === 3 || (k > 3 && (k - 3) % 2 === 0),
  myriad: (k) => k > 0 && k % 4 === 0,
};
const GROUP_SIZE = { western: 3, indian: 2, myriad: 4 };

function quant(min, max) {
  if (max === Infinity) return min === 0 ? '*' : min === 1 ? '+' : `{${min},}`;
  if (min === max) return min === 1 ? '' : `{${min}}`;
  return min === 0 && max === 1 ? '?' : `{${min},${max}}`;
}

// One alphabet, with memoised classes per value interval (the same [1-9] is requested dozens of times per pattern).
class Digits {
  constructor(digits) {
    this.digits = digits;
    this.base = digits.length;
    this.cache = new Map();
  }

  // Class of the characters of values lo..hi.
  cls(lo, hi) {
    const key = lo + ':' + hi;
    if (!this.cache.has(key)) this.cache.set(key, charClass(this.digits.slice(lo, hi + 1).flat()));
    return this.cache.get(key);
  }

  get all() { return this.cls(0, this.base - 1); }
  get nonZero() { return this.cls(1, this.base - 1); }
  get zero() { return this.cls(0, 0); }

  // A sequence of intervals with separators where `sepAt(digitsToTheRight)` says so; equal neighbours collapse to {n}.
  render(seqn, sep = null, sepAt = null) {
    const L = seqn.length;
    let out = '';
    for (let i = 0; i < L;) {
      const [a, b] = seqn[i];
      let j = i + 1;
      while (j < L && seqn[j][0] === a && seqn[j][1] === b && !(sep && sepAt(L - j))) j++;
      // A single character repeats literally up to three times (1844…, not 184{2}…); classes use {n}.
      const c = this.cls(a, b), n = j - i;
      out += !c.startsWith('[') && n < 4 ? c.repeat(n) : c + quant(n, n);
      if (j < L && sep && sepAt(L - j)) out += sep;
      i = j;
    }
    return out;
  }
}

// Dedupe before joining: different interval sequences can render to identical text after collapsing.
const alt = (parts) => {
  const list = [...new Set(parts)];
  return list.length === 1 ? list[0] : `(?:${list.join('|')})`;
};

// --- the generator ------------------------------------------------------------------------------------------------

export const DEFAULTS = {
  alphabet: 'dec', digits: null, kind: 'integer', sign: 'minus', minus: ['-'], plus: ['+'],
  min: '', max: '', leadingZeros: 'no', width: 0, maxDigits: 0,
  grouping: 'none', groupStyle: 'western', groupSep: [','],
  decimalSep: ['.'], fracMax: 0, leadingDot: false, trailingDot: false,
  exponent: 'none', expMarker: ['e', 'E'], expMax: 0,
  prefix: [], prefixMode: 'none', suffix: [], suffixMode: 'none',
  anchor: 'line', groups: true,
};

export const NUMBER_PRESETS = {
  uint8: { kind: 'integer', min: '0', max: '255' },
  int8: { kind: 'integer', min: '-128', max: '127' },
  uint16: { kind: 'integer', min: '0', max: '65535' },
  int16: { kind: 'integer', min: '-32768', max: '32767' },
  uint32: { kind: 'integer', min: '0', max: '4294967295' },
  int32: { kind: 'integer', min: '-2147483648', max: '2147483647' },
  uint64: { kind: 'integer', min: '0', max: '18446744073709551615' },
  int64: { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' },
  double: { kind: 'decimal', sign: 'both', leadingDot: true, trailingDot: true, exponent: 'optional' },
  json: { kind: 'decimal', sign: 'minus', exponent: 'optional', expMarker: ['e', 'E'] },
  hexByte: { alphabet: 'hex', kind: 'integer', min: '0', max: '255', leadingZeros: 'pad', width: 2 },
  hexLiteral: { alphabet: 'hex', kind: 'integer', sign: 'none', prefix: ['0x', '0X'], prefixMode: 'required' },
  binaryLiteral: { alphabet: 'bin', kind: 'integer', sign: 'none', prefix: ['0b', '0B'], prefixMode: 'required' },
  percent: { kind: 'decimal', sign: 'none', min: '', max: '', suffix: ['%'], suffixMode: 'required' },
  grouped: { kind: 'decimal', grouping: 'required', groupStyle: 'western', groupSep: [','], decimalSep: ['.'] },
  european: { kind: 'decimal', grouping: 'optional', groupStyle: 'western', groupSep: ['.', ' ', ' '], decimalSep: [','] },
  swiss: { kind: 'decimal', grouping: 'optional', groupStyle: 'western', groupSep: ["'", '’'], decimalSep: ['.'] },
  indian: { kind: 'decimal', grouping: 'optional', groupStyle: 'indian', groupSep: [','], decimalSep: ['.'] },
  arabic: { alphabet: 'arabicIndic', kind: 'decimal', grouping: 'optional', groupSep: ['٬'], decimalSep: ['٫'], minus: ['-', '−'] },
  persian: { alphabet: 'persian', kind: 'decimal', grouping: 'optional', groupSep: ['٬'], decimalSep: ['٫'], minus: ['-', '−'] },
  devanagari: { alphabet: 'devanagari', kind: 'decimal', grouping: 'optional', groupStyle: 'indian', groupSep: [','] },
  chinese: { alphabet: 'chinese', kind: 'integer', sign: 'minus', minus: ['-', '负', '負'] },
  anyScript: { alphabet: 'decAnyScript', kind: 'decimal', minus: ['-', '−'] },
};

// Strict integer syntax or null: '' means "no bound", and "1e3" / "0x10" are rejected rather than reinterpreted.
const big = (s) => { const t = String(s ?? '').trim(); return /^[+-]?[0-9]+$/.test(t) ? BigInt(t) : null; };

export function numberPattern(input = {}) {
  const o = { ...DEFAULTS, ...input };
  const notes = [];
  const digits = o.digits || alphabetOf(o.alphabet);
  // Validation of the alphabet: at least two values, single code points, no character in two values.
  if (!Array.isArray(digits) || digits.length < 2) return { error: 'alphabet' };
  const seen = new Map();
  for (let v = 0; v < digits.length; v++) {
    if (!digits[v].length) return { error: 'alphabetEmpty', params: { v } };
    for (const ch of digits[v]) {
      if (Array.from(ch).length !== 1) return { error: 'alphabetChar', params: { ch } };
      if (seen.has(ch) && seen.get(ch) !== v) return { error: 'alphabetDup', params: { ch } };
      seen.set(ch, v);
    }
  }
  const D = new Digits(digits);
  const B = D.base;
  const MINUS = o.minus.length ? charClass(o.minus) : null, PLUS = o.plus.length ? charClass(o.plus) : null;
  const SEP = o.grouping !== 'none' && o.groupSep.length ? charClass(o.groupSep) : null;
  const DEC = o.kind === 'decimal' && o.decimalSep.length ? charClass(o.decimalSep) : null;
  const sepAt = GROUPING[o.groupStyle] || GROUPING.western;
  // A sign or separator that is also a digit would make the pattern ambiguous (is ',' a digit or a group mark?).
  const reserved = [...o.minus, ...o.plus, ...(SEP ? o.groupSep : []), ...(DEC ? o.decimalSep : [])].filter((c) => seen.has(c));
  if (reserved.length) return { error: 'alphabetClash', params: { ch: reserved[0] } };

  let lo = o.kind === 'integer' ? big(o.min) : null, hi = o.kind === 'integer' ? big(o.max) : null;
  if ((lo !== null) !== (hi !== null)) return { error: 'rangeBoth' };
  if (lo !== null && lo > hi) return { error: 'rangeOrder' };
  let leadingZeros = o.leadingZeros;
  // Leading zeros and grouping conflict (where does the first group of 007,123 start?); grouping wins, with a note.
  if (SEP && leadingZeros !== 'no') { notes.push('groupingNoZeros'); leadingZeros = 'no'; }

  // --- integer part --------------------------------------------------------------------------------------------
  // Digits of the largest magnitude of a range: zero padding goes up to it ('yes') or to the fixed width ('pad').
  const maxMag = lo === null ? 0n : (-lo > hi ? -lo : hi);
  const maxLen = lo === null ? 0 : toDigits(maxMag < 0n ? -maxMag : maxMag, B).length;
  // Renders interval sequences (grouping mode decides the separators); padding adds leading zeros.
  const renderSeqs = (input) => {
    const parts = [];
    // Fixed width: shorter numbers get explicit zero positions first, so that neighbours merge ([0-9A-F]{2}).
    let seqs = leadingZeros === 'pad' && o.width
      ? mergeSequences(input.map((s) => [...Array.from({ length: Math.max(0, o.width - s.length) }, () => [0, 0]), ...s]))
      : input;
    // Without separators or leading zeros, "X", "X D", "X D D"… of consecutive lengths become one "X D{0,n}".
    if (!SEP && leadingZeros === 'no') {
      const full = (iv) => iv[0] === 0 && iv[1] === B - 1;
      const byHead = new Map();
      for (const s of seqs) if (s.slice(1).every(full)) { const k = s[0].join(':'); if (!byHead.has(k)) byHead.set(k, []); byHead.get(k).push(s.length); }
      const merged = [];
      const taken = new Set();
      for (const [k, lens] of byHead) {
        lens.sort((a, b) => a - b);
        for (let i = 0; i < lens.length;) {
          let j = i;
          while (j + 1 < lens.length && lens[j + 1] === lens[j] + 1) j++;
          if (j > i) {
            const [a, b] = k.split(':').map(Number);
            merged.push(D.cls(a, b) + D.all + quant(lens[i] - 1, lens[j] - 1));
            for (let n = lens[i]; n <= lens[j]; n++) taken.add(k + '/' + n);
          }
          i = j + 1;
        }
      }
      if (merged.length) {
        seqs = seqs.filter((s) => !(s.slice(1).every(full) && taken.has(s[0].join(':') + '/' + s.length)));
        parts.push(...merged);
      }
    }
    for (const s of seqs) {
      const plain = D.render(s);
      const grouped = SEP ? D.render(s, SEP, sepAt) : plain;
      const pad = leadingZeros === 'pad' ? Math.max(0, (o.width || 0) - s.length) : 0;
      const zeros = leadingZeros === 'pad' ? (pad ? D.zero + quant(pad, pad) : '')
        : leadingZeros === 'yes' && maxLen > s.length ? D.zero + quant(0, maxLen - s.length) : '';
      if (o.grouping === 'required' || !SEP) parts.push(zeros + grouped);
      else { parts.push(zeros + grouped); if (grouped !== plain) parts.push(zeros + plain); }
    }
    return alt(parts);
  };

  let intPos = null, intNeg = null;
  if (lo !== null) {
    if (hi >= 0n) intPos = renderSeqs(rangeSequences(lo > 0n ? lo : 0n, hi, B));
    if (lo < 0n) intNeg = renderSeqs(rangeSequences(hi < 0n ? -hi : 1n, -lo, B));
    if (leadingZeros === 'pad' && (o.width || 0) < maxLen) return { error: 'widthSmall', params: { n: maxLen } };
  } else {
    // Unbounded: no leading zeros means a non-zero first digit or the single zero.
    const M = o.maxDigits > 0 ? o.maxDigits : Infinity;
    if (leadingZeros === 'pad') intPos = D.all + quant(o.width || 1, o.width || 1);
    else if (M !== Infinity) {
      const seqs = [];
      for (let n = 1; n <= M; n++) seqs.push([[leadingZeros === 'yes' ? 0 : 1, B - 1], ...Array.from({ length: n - 1 }, () => [0, B - 1])]);
      intPos = renderSeqs(mergeSequences(seqs));
      if (leadingZeros !== 'yes') intPos = alt([intPos, D.zero]);
    } else {
      const first = leadingZeros === 'yes' ? D.all : D.nonZero;
      const zero = leadingZeros === 'yes' ? [] : [D.zero];
      const plain = first + D.all + '*';
      if (!SEP) intPos = alt([plain, ...zero]);
      else {
        const s = GROUP_SIZE[o.groupStyle] || 3;
        let groupedMany, small;
        // Grouped forms require at least one separator (the + / the trailing {3}); the plain or small form covers
        // numbers below the first separator. Each separator is followed by an exact digit count, so the split is
        // deterministic.
        if (o.groupStyle === 'indian') {
          groupedMany = `${first}${D.all}?(?:${SEP}${D.all}{2})*${SEP}${D.all}{3}`;
          small = `${first}${D.all}{0,2}`;
        } else {
          groupedMany = `${first}${D.all}${quant(0, s - 1)}(?:${SEP}${D.all}{${s}})+`;
          small = `${first}${D.all}${quant(0, s - 1)}`;
        }
        intPos = o.grouping === 'required' ? alt([groupedMany, small, ...zero]) : alt([groupedMany, plain, ...zero]);
      }
    }
    if (o.sign === 'minus' || o.sign === 'both' || o.sign === 'required') intNeg = intPos;
  }

  // --- sign, prefix, integer group -------------------------------------------------------------------------------
  const PREFIX = o.prefixMode !== 'none' && o.prefix.length ? alternation(o.prefix) : null;
  const SUFFIX = o.suffixMode !== 'none' && o.suffix.length ? alternation(o.suffix) : null;
  const g = (name, body) => (o.groups ? `(?<${name}>${body})` : `(?:${body})`);
  const opt = (s, mode) => (mode === 'required' ? s : `${s.startsWith('(') ? s : `(?:${s})`}?`);
  let signPart = '', intPart;
  const plusAllowed = PLUS && (o.sign === 'both' || o.sign === 'required');
  const signRequired = o.sign === 'required';
  const prefixPart = PREFIX ? opt(g('prefix', PREFIX), o.prefixMode) : '';
  if (lo !== null) {
    if (intPos && intNeg) {
      if (!MINUS) return { error: 'noMinus' };
      const signs = plusAllowed ? charClass([...o.minus, ...o.plus]) : MINUS;
      signPart = signRequired ? g('sign', signs) : `${g('sign', signs)}?`;
      // The integer group checks which sign precedes it (through the prefix): negative magnitudes after a minus.
      // Lookbehind instead of two top-level branches (sign + neg | pos): keeps one named 'int' group in one place,
      // so consumers can read m.groups.int regardless of sign; requires a lookbehind-capable engine (ES2018).
      const after = PREFIX ? `(?:${PREFIX})${o.prefixMode === 'required' ? '' : '?'}` : '';
      intPart = g('int', `(?<=${MINUS}${after})${intNeg}|(?<!${MINUS}${after})${intPos}`);
    } else if (intNeg) {
      if (!MINUS) return { error: 'noMinus' };
      signPart = g('sign', MINUS);
      intPart = g('int', intNeg);
    } else {
      signPart = plusAllowed ? (signRequired ? g('sign', PLUS) : `${g('sign', PLUS)}?`) : '';
      intPart = g('int', intPos);
    }
  } else {
    const chars = [...(o.sign === 'none' ? [] : o.minus), ...(plusAllowed ? o.plus : [])];
    if (chars.length) signPart = signRequired ? g('sign', charClass(chars)) : `${g('sign', charClass(chars))}?`;
    intPart = g('int', intPos);
  }

  // --- fraction and exponent -----------------------------------------------------------------------------------
  let body;
  if (o.kind === 'decimal' && DEC) {
    const fracQ = quant(o.trailingDot ? 0 : 1, o.fracMax > 0 ? o.fracMax : Infinity);
    const frac = `(?:${DEC}${g('frac', D.all + fracQ)})?`;
    // With a leading dot the integer part is optional, but the lookahead demands that a digit follows, either
    // directly or after the separator: '.' alone or the empty string must not match.
    const intAndFrac = o.leadingDot ? `(?=${D.all}|${DEC}${D.all})${intPart}?${frac}` : `${intPart}${frac}`;
    body = signPart + prefixPart + intAndFrac;
  } else body = signPart + prefixPart + intPart;
  if (o.exponent !== 'none' && o.expMarker.length) {
    const E = charClass(o.expMarker);
    // Exponents are decimal by convention even for other alphabets of base 10; non-decimal bases fall back to ASCII.
    const expDigits = D.base === 10 ? D.all : '[0-9]';
    const expSigns = [...o.minus, ...o.plus].length ? charClass([...o.minus, ...o.plus]) : '';
    const exp = `${E}${g('exp', `${expSigns ? `${expSigns}?` : ''}${expDigits}${quant(1, o.expMax > 0 ? o.expMax : Infinity)}`)}`;
    body += o.exponent === 'required' ? exp : `(?:${exp})?`;
  }
  if (SUFFIX) body += opt(g('suffix', SUFFIX), o.suffixMode);

  // --- anchoring -----------------------------------------------------------------------------------------------
  let source, flags;
  if (o.anchor === 'find') {
    // Not inside a longer word or number, and not after a sign the pattern cannot take ("5" of "-5" is no uint).
    const negAllowed = lo !== null ? lo < 0n : o.sign !== 'none';
    const signChars = [...(negAllowed ? [] : o.minus), ...(plusAllowed ? [] : o.plus)];
    const digitChars = [...seen.keys()].filter((c) => !/[\p{L}\p{N}_]/u.test(c)).map(escapeClassChar).join('');
    const left = `[\\p{L}\\p{N}_${digitChars}${signChars.map(escapeClassChar).join('')}]`;
    const right = `[\\p{L}\\p{N}_${digitChars}]`;
    // Integers are not taken out of decimals either ("1.5" holds no integer): the decimal separators bound them too.
    const SEPS = o.decimalSep.length ? charClass(o.decimalSep) : null;
    const decAfter = SEPS ? `|${SEPS}${D.all}` : '';
    source = `(?<!${left}${SEPS ? `|${SEPS}` : ''})${body}(?!${right}${decAfter})`;
    flags = 'gu';
  } else {
    source = `^${body}$`;
    flags = o.anchor === 'line' ? 'gmu' : 'u';
  }

  // Examples are whole strings, so they are checked against the anchored body whatever the anchoring.
  const re = new RegExp(`^${body}$`, 'u');
  const ex = examples(o, { D, lo, hi, plusAllowed, leadingZeros, SEP: SEP ? o.groupSep : null, sepAt, PREFIX });
  const full = (s) => re.test(s);
  return {
    source, flags, notes,
    valid: ex.valid.filter(full),
    invalid: ex.invalid.filter((s) => !full(s)),
    // Kept for tests and diagnostics: generated examples that contradict the pattern (should stay empty).
    mismatches: [...ex.valid.filter((s) => !full(s)).map((s) => ['valid', s]), ...ex.invalid.filter(full).map((s) => ['invalid', s])],
  };
}

// --- examples -----------------------------------------------------------------------------------------------------

// Mulberry32 PRNG with a fixed seed: examples must be reproducible (tests compare them, UI must not flicker on
// re-render), which Math.random cannot give.
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A number value as text: digits with variant characters, grouping, sign, prefix.
export function formatNumber(value, o, { digits, rnd = Math.random, grouped = false, pad = 0, variant = 'random', minusChar, plusSign = false, prefix = '' } = {}) {
  const B = digits.length;
  const neg = value < 0n;
  let ds = toDigits(neg ? -value : value, B);
  if (pad > ds.length) ds = [...Array(pad - ds.length).fill(0), ...ds];
  const pick = (v) => (variant === 'first' ? digits[v][0] : digits[v][Math.floor(rnd() * digits[v].length)]);
  let out = '';
  const sepAt = GROUPING[o.groupStyle] || GROUPING.western;
  ds.forEach((d, i) => {
    if (grouped && i > 0 && sepAt(ds.length - i)) out += o.groupSep[0];
    out += pick(d);
  });
  const sign = neg ? (minusChar || o.minus[0]) : plusSign ? o.plus[0] : '';
  return sign + prefix + out;
}

function examples(o, { D, lo, hi, plusAllowed, leadingZeros, SEP, sepAt, PREFIX }) {
  const rnd = mulberry(0x5eed);
  const digits = D.digits, B = D.base;
  const valid = [], invalid = [];
  const pre = PREFIX ? o.prefix[0] : '';
  const needPre = o.prefixMode === 'required' ? pre : '';
  const suf = o.suffixMode === 'required' && o.suffix.length ? o.suffix[0] : '';
  const group = o.grouping === 'required';
  const fmt = (v, { grouped = false, plusSign = false } = {}) => formatNumber(v, o, {
    digits, rnd, grouped: !!SEP && (group || (o.grouping === 'optional' && grouped)), prefix: needPre, pad: leadingZeros === 'pad' ? o.width : 0, plusSign,
  }) + suf;
  // 128 random bits modulo the span: bias is negligible for spans up to 2^64, and BigInt keeps it exact.
  const randBig = (a, b) => { const span = b - a + 1n; let r = 0n; for (let i = 0; i < 4; i++) r = (r << 32n) | BigInt(Math.floor(rnd() * 4294967296)); return a + (r % span); };
  let vals;
  if (lo !== null) {
    vals = [lo, hi, ...(lo <= 0n && hi >= 0n ? [0n] : []), randBig(lo, hi), randBig(lo, hi)];
    valid.push(...[...new Set(vals)].map((v, i) => fmt(v, { grouped: i % 2 === 1 })));
    invalid.push(fmt(hi + 1n), fmt(lo - 1n));
    if (leadingZeros === 'no' && hi >= 1n) invalid.push(digits[0][0] + fmt(hi > 7n ? 7n : hi).replace(/^[-+]/, ''));
    if (lo >= 0n && o.minus.length && hi >= 1n) invalid.push(o.minus[0] + fmt(1n));
  } else {
    const max = BigInt(B) ** BigInt(Math.min(o.maxDigits > 0 ? o.maxDigits : 7, 7)) - 1n;
    vals = [0n, randBig(1n, max), randBig(1n, max), randBig(1n, BigInt(B) ** 4n)];
    const signed = o.sign !== 'none';
    for (let i = 0; i < vals.length; i++) {
      const v = signed && i === 2 && o.sign !== 'required' ? -vals[i] : vals[i];
      let s = fmt(v, { grouped: i % 2 === 1, plusSign: o.sign === 'required' && v >= 0n });
      if (o.kind === 'decimal' && o.decimalSep.length && i > 0) {
        const fracLen = 1 + Math.floor(rnd() * 3);
        const frac = Array.from({ length: Math.min(fracLen, o.fracMax || fracLen) }, () => digits[Math.floor(rnd() * B)][0]).join('');
        s = s.slice(0, s.length - suf.length) + o.decimalSep[0] + frac + suf;
      }
      if (o.exponent === 'required' || (o.exponent === 'optional' && i === 3)) s = s.slice(0, s.length - suf.length) + o.expMarker[0] + (o.minus[0] || '') + '5' + suf;
      valid.push(s);
    }
    if (leadingZeros === 'no') invalid.push(digits[0][0] + digits[1][0] + suf);
    if (o.sign === 'none' && o.minus.length) invalid.push(o.minus[0] + digits[1][0] + suf);
    if (o.sign === 'required') invalid.push(digits[1][0] + suf);
  }
  // Characters that are not digits of this alphabet, grouping in the wrong places, doubled signs, empty parts.
  const foreign = ['x', 'Z', '9', '٩', '_'].find((c) => !digits.some((v) => v.includes(c)) && !o.decimalSep.includes(c) && !o.groupSep.includes(c));
  if (foreign) invalid.push(needPre + digits[1][0] + foreign + suf);
  if (SEP) invalid.push(needPre + digits[1][0] + SEP[0] + digits[1][0] + SEP[0] + digits[1][0] + suf);
  if (o.minus.length && o.sign !== 'none') invalid.push(o.minus[0] + o.minus[0] + needPre + digits[1][0] + suf);
  invalid.push('');
  if (o.kind === 'decimal' && o.decimalSep.length) {
    if (!o.trailingDot) invalid.push(needPre + digits[1][0] + o.decimalSep[0] + suf);
    if (!o.leadingDot) invalid.push(o.decimalSep[0] + digits[1][0] + suf);
    invalid.push(needPre + digits[1][0] + o.decimalSep[0] + digits[1][0] + o.decimalSep[0] + digits[1][0] + suf);
  }
  if (o.prefixMode === 'required' && pre) invalid.push(digits[1][0] + suf);
  if (o.exponent === 'required') invalid.push(needPre + digits[1][0] + suf);
  return { valid: [...new Set(valid)], invalid: [...new Set(invalid)].filter((s) => !valid.includes(s)) };
}

// Re-export for callers that only import this module.
export const escapeText = escapeLiteral;
