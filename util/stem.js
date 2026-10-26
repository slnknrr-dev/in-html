// util/stem.js - a light stemmer for search keys (Russian and English) and prefix-scored matching of a query against
// a title and a body. Not a linguistic analyser (lingua/morph-ru.js is one): it only cuts common endings so that
// "перемещения", "перемещение", "перемещать" share the key "перемещ" and "suppliers", "supplier" share "supplier".
//
//   stem(word) -> key            lower case, ё -> е; Cyrillic: derivational suffixes, then endings, a stem of at least
//                                3-4 letters kept; Latin: -ies -> y, -ing, -ed, -es, -s
//   words(text) -> ['word', …]   letter / digit runs, lower case, ё -> е
//   searchKeys(text) -> [key, …] words(text).map(stem)
//   matchScore(query, { title, body, section }) -> number   0 unless every query key is a prefix of some word of the
//                                text; a hit in the title weighs 5, body / section hits count up to 10 per key
//
// Approach: suffix stripping with a minimum stem length, not dictionary lemmatisation. The criterion is recall in a
// search box over short app texts; over-stemming ("moved" -> "mov") is harmless because the same function builds both
// the index keys and the query keys, so they still meet. Minimum lengths stop it eating short roots (дом stays дом).

// Longest first, so 'иями' is tried before 'ями' and 'и' (the first match wins in stem()). The Set removes duplicates.
const RU_ENDINGS = [...new Set(['иями', 'ями', 'ами', 'иях', 'ях', 'ах', 'ией', 'ий', 'ый', 'ой', 'ая', 'яя', 'ое', 'ее', 'ие', 'ые', 'ого', 'его',
  'ому', 'ему', 'ыми', 'ими', 'ую', 'юю', 'ешь', 'ете', 'ить', 'ать', 'ять', 'еть', 'уть', 'ем', 'ом', 'ам', 'ям', 'ия', 'ья', 'ию', 'ью', 'ье',
  'ии', 'ей', 'ев', 'ов', 'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'ь'])].sort((a, b) => b.length - a.length);
// Derivational suffixes (nominalisations), tried before inflections with a longer minimum stem (4), so перемещение
// and перемещать meet at перемещ.
const RU_SUFFIXES = ['ировать', 'ировка', 'ировки', 'ение', 'ения', 'ений', 'ании', 'ание', 'ания', 'ость', 'ости'].sort((a, b) => b.length - a.length);
const EN_ENDINGS = [['ies', 'y'], ['ing', ''], ['ed', ''], ['es', ''], ['s', '']];

// Script dispatch by the presence of any Cyrillic letter. Other scripts take the English branch, where the Latin
// endings simply do not match and the word comes back unchanged.
export function stem(word) {
  const w = String(word).toLowerCase().replace(/ё/g, 'е');
  if (/[а-я]/.test(w)) {
    if (w.length <= 4) return w;
    for (const s of RU_SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length);
    for (const e of RU_ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length);
    return w;
  }
  if (w.length <= 3) return w;
  for (const [e, r] of EN_ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length) + r;
  return w;
}

// Unicode letter / digit runs: any script, punctuation splits, numbers stay searchable.
export const words = (text) => String(text ?? '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? [];
export const searchKeys = (text) => words(text).map(stem);

// AND semantics: every query key must prefix-match some word (so a half-typed word already hits), otherwise 0.
// Body hits are capped at 10 per key so a long text repeating a word cannot outrank title hits indefinitely.
// Keys shorter than 2 are dropped: a one-letter prefix matches nearly everything.
export function matchScore(query, { title = '', body = '', section = '' } = {}) {
  const q = searchKeys(query).filter((x) => x.length >= 2);
  if (!q.length) return 0;
  const T = searchKeys(title), B = [...searchKeys(section), ...searchKeys(body)];
  let total = 0;
  for (const s of q) {
    const inTitle = T.filter((x) => x.startsWith(s)).length;
    const inBody = B.filter((x) => x.startsWith(s)).length;
    if (!inTitle && !inBody) return 0;
    total += inTitle * 5 + Math.min(inBody, 10);
  }
  return total;
}
