// prosody/scheme.js - rhyme schemes: named patterns, their expansion over the lines of a poem, detection from the line
// endings, and the line each line has to catch.
//
//   SCHEMES: { id: pattern }        expandScheme(idOrPattern, n) -> ['A', 'B', '-', …]
//   detectScheme(units, compare, { window, threshold }) -> letters      partners(letters) -> index of the target or -1
//   schemeString(letters) -> 'ABAB CDCD' (grouped by stanza length when it repeats)
//
// A pattern is letters ('-' for an unrhymed line, spaces ignored); a pattern shorter than the poem repeats with fresh
// letters for every stanza (ABAB → ABAB CDCD …). 'terza' is Dante's chain ABA BCB CDC …, 'free' has no rhyme.

export const SCHEMES = {
  couplet: 'AABB', cross: 'ABAB', enclosing: 'ABBA', mono: 'AAAA', rubai: 'AABA', sonnet: 'ABABCDCDEFEFGG',
  onegin: 'ABABCCDDEFFEGG', terza: 'terza', free: '-',
};
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letter = (k) => (k < 26 ? LETTERS[k] : LETTERS[k % 26] + Math.floor(k / 26));

export function expandScheme(id, n) {
  const pat = SCHEMES[id] || String(id || '').toUpperCase().replace(/[^A-Z-]/g, '');
  if (!pat || pat === '-') return new Array(n).fill('-');
  if (pat.toUpperCase() === 'TERZA') {
    // line 3t, 3t + 2 -> letter t, 3t + 1 -> letter t + 1
    return Array.from({ length: n }, (_, i) => { const t = Math.floor(i / 3), r = i % 3; return letter(r === 1 ? t + 1 : t); });
  }
  const distinct = [...new Set(pat.replace(/-/g, ''))].sort();
  return Array.from({ length: n }, (_, i) => {
    const c = pat[i % pat.length];
    if (c === '-') return '-';
    const stanza = Math.floor(i / pat.length);
    return letter(distinct.indexOf(c) + stanza * distinct.length);
  });
}

// Greedy: a line takes the letter of the best earlier line within the window that it rhymes with.
// Greedy left-to-right: each line takes the letter of the best-rhyming line among the previous `window` (4 covers
// AABB, ABAB, ABBA and enclosing stanzas); identical words are not counted as rhymes (repetition is not rhyme).
// Letters used once are demoted to '-' afterwards and the rest renumbered A, B, C... in order of appearance.
export function detectScheme(units, compare, { window = 4, threshold = 0.7 } = {}) {
  const letters = new Array(units.length).fill('-');
  let next = 0;
  units.forEach((u, i) => {
    if (!u) return;
    let best = -1, bestScore = threshold;
    for (let j = i - 1; j >= Math.max(0, i - window); j--) {
      if (!units[j]) continue;
      const r = compare(u, units[j]);
      if (r.kind !== 'identical' && r.score > bestScore + 1e-9) { bestScore = r.score; best = j; }
    }
    letters[i] = best >= 0 ? letters[best] : letter(next++);
  });
  // letters that never got a partner are unrhymed
  const count = {};
  for (const l of letters) count[l] = (count[l] || 0) + 1;
  // renumber the rhymed letters in order of appearance
  const map = {};
  let k = 0;
  return letters.map((l) => (l === '-' || count[l] < 2 ? '-' : (map[l] ||= letter(k++))));
}

// The partner of each line: the nearest earlier line with its letter, or (for the first of a letter) the next one.
export function partners(letters) {
  return letters.map((l, i) => {
    if (l === '-') return -1;
    for (let j = i - 1; j >= 0; j--) if (letters[j] === l) return j;
    for (let j = i + 1; j < letters.length; j++) if (letters[j] === l) return j;
    return -1;
  });
}

export function schemeString(letters, stanza = 0) {
  const s = letters.map((l) => (l.length > 1 ? `(${l})` : l));
  if (!stanza) return s.join('');
  const out = [];
  for (let i = 0; i < s.length; i += stanza) out.push(s.slice(i, i + stanza).join(''));
  return out.join(' ');
}
