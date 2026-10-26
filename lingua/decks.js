// lingua/decks.js - spaced-repetition decks between any two languages of the studio. A card asks a word of one
// language and expects its equivalent in another: directly when a word list glosses its words in that language
// (a Georgian word with its Russian meaning: ru → ka and ka → ru), or through a pivot language when both sides are
// glossed in it (Georgian → Korean through their shared Russian or English gloss).
//
//   deckPairs(entries, from, to, { pivots, limit }) -> [{ id, front: { lang, w, tr? }, back: { lang, w, tr? }, via }]
//     entries: [{ lang, w, tr?, m: { lang: gloss } }]; via: 'gloss' (direct) or the pivot language
//   deckLanguages(entries) -> languages that can be asked or answered
//
// Key decisions:
// - Card identity = direction + normalised front word, so SRS progress survives reordering or regenerating the deck
//   (ids are stable as long as the word is). Truncated to 200 chars to bound storage keys.
// - One card per front word: the first source wins (direct glosses are pushed before pivot matches, so a curated
//   gloss beats an inferred equivalence). Later candidates for the same front are dropped, not merged.
// - Only the first sense of a gloss is shown on the front ("give; hand over" -> "give"): a card must have one
//   answer, and the first sense is the lexicographer's primary one.
// - Pivot matching reuses bilex.glossKeys so decks and the dictionary agree on what "the same sense" means.
import { glossKeys } from './bilex.js';

// Same normalisation as bilex.headKey minus punctuation stripping (U+0301 stress mark removed, ё folded to е).
const keyOf = (s) => String(s).toLowerCase().normalize('NFC').replace(/́/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const first = (gloss) => String(gloss).split(/;\s*/)[0].trim();

export function deckLanguages(entries) {
  const s = new Set();
  for (const e of entries) { s.add(e.lang); for (const l of Object.keys(e.m || {})) s.add(l); }
  return [...s];
}

export function deckPairs(entries, from, to, { pivots = ['ru', 'en'], limit = 2000 } = {}) {
  if (!from || !to || from === to) return [];
  const out = [];
  const seen = new Set();
  const push = (front, back, via) => {
    const k = keyOf(front.w);
    if (!k || seen.has(k) || !back.w) return;
    seen.add(k);
    out.push({ id: `x:${from}>${to}:${k}`.slice(0, 200), front, back, via });
  };
  // direct: a word of `to` glossed in `from`, or a word of `from` glossed in `to`
  for (const e of entries) {
    if (e.lang === to && e.m && e.m[from]) push({ lang: from, w: first(e.m[from]) }, { lang: to, w: e.w, tr: e.tr || '' }, 'gloss');
    else if (e.lang === from && e.m && e.m[to]) push({ lang: from, w: e.w, tr: e.tr || '' }, { lang: to, w: first(e.m[to]) }, 'gloss');
  }
  // through a pivot: both words glossed in the same pivot language with the same sense
  for (const p of pivots) {
    if (p === from || p === to) continue;
    // Hash join on the pivot sense: index `to` words by every gloss key (first entry per key wins), then probe with
    // each `from` word. O(E) instead of the O(E^2) pairwise comparison.
    const byKey = new Map();
    for (const e of entries) if (e.lang === to && e.m && e.m[p]) for (const k of glossKeys(e.m[p], p)) if (!byKey.has(k)) byKey.set(k, e);
    for (const e of entries) {
      if (e.lang !== from || !e.m || !e.m[p]) continue;
      const k = glossKeys(e.m[p], p).find((x) => byKey.has(x));
      if (k) { const b = byKey.get(k); push({ lang: from, w: e.w, tr: e.tr || '' }, { lang: to, w: b.w, tr: b.tr || '' }, p); }
    }
  }
  return out.slice(0, limit);
}
