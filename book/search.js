// book/search.js - full-text search over the reading units of a book (book/model.js readingUnits): offsets are in
// the rendered text of each unit, so a result can be highlighted in the reader directly.
//
//   searchRegExp(query, { caseSensitive, wholeWord }) -> RegExp | null
//     spaces match any whitespace; without caseSensitive е / ё and quote variants match each other
//   searchUnits(units, query, opts) -> [{ k, start, end, before, match, after }]   (opts.max, default 500)
//   countWords(text) -> n

//
// Matching runs on the readingUnits text (blockPlain), so returned offsets are directly DOM text offsets in the
// rendered unit: no second mapping step between "search text" and "displayed text".
const ESC = /[.*+?^${}()|[\]\\]/g;

// Each query word is escaped (a user typing "C++" or "(1)" gets a literal match, not a regex error); words are
// joined by \s+ so line breaks and double spaces in the book do not defeat a phrase.
// Case-insensitive mode also folds Cyrillic ie/io (Russian texts use them interchangeably) and typographic quote
// variants, because readers type ASCII but books are typeset with curly quotes and apostrophes.
// wholeWord uses Unicode lookarounds (\p{L}\p{N}) instead of \b: \b is ASCII-only and would treat every Cyrillic or
// Georgian letter as a word boundary. The u flag is required for \p{...}; invalid patterns return null, not throw.
export function searchRegExp(query, { caseSensitive = false, wholeWord = false } = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  let src = q.split(/\s+/).map((w) => {
    let s = w.replace(ESC, '\\$&');
    if (!caseSensitive) s = s.replace(/[её]/gi, (c) => (c === c.toLowerCase() ? '[её]' : '[ЕЁ]')).replace(/['’ʼ]/g, "['’ʼ]").replace(/["“”«»„]/g, '["“”«»„]');
    return s;
  }).join('\\s+');
  if (wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  try { return new RegExp(src, caseSensitive ? 'gu' : 'giu'); } catch { return null; }
}

export function searchUnits(units, query, opts = {}) {
  const re = searchRegExp(query, opts);
  if (!re) return [];
  const max = opts.max || 500;
  const out = [];
  for (const u of units) {
    const text = u.text || '';
    if (!text) continue;
    re.lastIndex = 0;
    let m;
    // Zero-length matches are skipped with a manual lastIndex bump, the standard guard against an infinite exec loop.
    // Context snippets are trimmed to whole words (an ellipsis marks a cut) so previews do not start mid-word.
    while ((m = re.exec(text))) {
      if (!m[0]) { re.lastIndex++; continue; }
      const start = m.index, end = start + m[0].length;
      const flat = (s) => s.replace(/\s+/g, ' ');
      let before = flat(text.slice(Math.max(0, start - 60), start));
      if (start > 60) before = '…' + before.replace(/^\S*\s/, '');
      let after = flat(text.slice(end, end + 80));
      if (end + 80 < text.length) after = after.replace(/\s\S*$/, '') + '…';
      out.push({ k: u.k, start, end, before, match: flat(m[0]), after });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// A word starts with a letter or digit and may contain apostrophes and hyphens ("don't", "well-known" = 1 word).
export const countWords = (text) => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
