// util/fuzzy.js - fuzzy matching of words: edit distances with a cut-off and the closest candidates of a list
// ("did you mean").
//
//   damerau(a, b, max = Infinity) -> distance       optimal string alignment: insert, delete, substitute, swap two
//                                                    neighbours; any value above max is returned as max + 1
//   levenshtein(a, b, max = Infinity) -> distance    the same without swaps
//   similarity(a, b) -> 0..1                         1 - damerau / longer length
//   typoBudget(word) -> 0 | 1 | 2                    distance allowed for a typo: 0 up to 2 letters, 1 up to 5, else 2
//   fold(s) -> s                                     lower case, ё -> е, accents dropped (the default comparison key)
//   closest(word, candidates, { max, key, limit = 5, norm = fold }) -> [{ item, text, d }]
//   bestMatch(word, candidates, opts) -> item | null
//
// Distances count code points, so astral characters are one letter. Rows are reused and a row whose minimum exceeds
// max stops the computation, so scanning a vocabulary with a small max costs about length × max per word.
//
// Why optimal string alignment (OSA) and not true Damerau-Levenshtein: OSA needs only two previous rows and counts the
// dominant typo (two neighbours swapped) as one edit. True DL also allows edits inside a swapped pair (ca -> abc = 2
// instead of 3) at the cost of an alphabet-sized table; for "did you mean" that difference never changes the winner.

// Wagner-Fischer dynamic programming with three rolling rows (prev2 is needed only for the swap transition).
// Both early exits are exact: the length difference is a lower bound of the distance, and the row minimum never
// decreases from one row to the next, so once it exceeds max the final cell must too.
// Array.from splits by code point: an emoji is one letter, not two UTF-16 units.
function distance(a, b, max, swaps) {
  const s = Array.from(String(a)), t = Array.from(String(b));
  if (Math.abs(s.length - t.length) > max) return max + 1;
  if (!s.length || !t.length) return Math.max(s.length, t.length) > max ? max + 1 : Math.max(s.length, t.length);
  let prev2 = new Array(t.length + 1).fill(0), prev = Array.from({ length: t.length + 1 }, (_, j) => j), cur = new Array(t.length + 1);
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (swaps && i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    // Rotate instead of allocating: the stale prev2 buffer becomes the next `cur` and is fully overwritten.
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[t.length] > max ? max + 1 : prev[t.length];
}

export const damerau = (a, b, max = Infinity) => distance(a, b, max, true);
export const levenshtein = (a, b, max = Infinity) => distance(a, b, max, false);

export function similarity(a, b) {
  const n = Math.max(Array.from(String(a)).length, Array.from(String(b)).length);
  return n ? 1 - damerau(a, b) / n : 1;
}

// Allowed edits grow with length: one edit in a 2-letter word yields a different word, so short words must match
// exactly; the cap of 2 bounds false positives on long words.
export const typoBudget = (word) => { const n = Array.from(String(word)).length; return n <= 2 ? 0 : n <= 5 ? 1 : 2; };

// NFD + strip combining marks (U+0300-U+036F) drops accents (Café -> cafe); the final NFC recomposes anything whose
// marks lie outside that range. ё -> е is explicit so the Russian folding rule is visible, not a side effect of NFD.
export const fold = (s) => String(s).toLowerCase().replace(/ё/g, 'е').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

// Candidates within max edits, nearest first; at equal distance the one closest in length (a full form rather than a
// stem), then the list order.
export function closest(word, candidates, { max, key = (x) => x, limit = 5, norm = fold } = {}) {
  const w = norm(word);
  // `??`, not `||`: max = 0 (exact match only) is a legitimate request.
  const lim = max ?? typoBudget(w);
  const wl = Array.from(w).length;
  const out = [];
  let i = 0;
  for (const item of candidates) {
    const text = norm(key(item));
    const d = damerau(w, text, lim);
    if (d <= lim) out.push({ item, text, d, dl: Math.abs(Array.from(text).length - wl), i });
    i++;
  }
  out.sort((x, y) => x.d - y.d || x.dl - y.dl || x.i - y.i);
  return out.slice(0, limit).map(({ item, text, d }) => ({ item, text, d }));
}

export function bestMatch(word, candidates, opts = {}) {
  const r = closest(word, candidates, { ...opts, limit: 1 });
  return r.length ? r[0].item : null;
}
