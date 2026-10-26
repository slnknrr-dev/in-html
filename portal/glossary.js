// portal/glossary.js - defined terms (pure): grouping of definitions under one term (several acts may define the same
// word), a matcher that finds terms in running text across inflected forms (Georgian case endings, Russian / Ukrainian
// endings, English plurals; see text.js stemEq), and linking of the first occurrence of each term in safe HTML.
//
//   termKey(name) -> 'folded stems'           identity of a term (dedupe: 'ბანკი' and 'ბანკის' are one term)
//   groupTerms(items, nameOf) -> [{ key, items }]   items with the same term, in first-seen order
//   termMatcher([{ id, names: [string] }]) -> { find(text) -> [{ start, end, id }], size }
//     longest name first, left to right, never overlapping; a name of several words matches consecutive words
//   linkTerms(html, matcher, { seen: Set, skip: Set(ids), open(id, text) -> '<a …>', close }) -> html
//     links the first occurrence of each term not in `seen` (seen is updated: one Set per article or block)
import { WORD_RE, fold, stemEq, stemOf, words } from './text.js';
import { mapText, wrapSpans } from './segments.js';

// Term identity = stems of its words: inflected headwords of different acts collapse into one entry.
export const termKey = (name) => words(name).map(stemOf).join(' ');

export function groupTerms(items, nameOf) {
  const map = new Map();
  for (const it of items || []) {
    const k = termKey(nameOf(it));
    if (!k) continue;
    if (!map.has(k)) map.set(k, { key: k, items: [] });
    map.get(k).items.push(it);
  }
  return [...map.values()];
}

// A fresh RegExp per call: WORD_RE is a shared /g regex, and reusing its lastIndex across calls (or reentrantly)
// would skip tokens. Trailing apostrophes / hyphens are trimmed so "ბანკის-" or "banks'" match.
const tokensOf = (text) => {
  const out = [];
  let m;
  const s = String(text);
  const re = new RegExp(WORD_RE.source, 'gu');
  while ((m = re.exec(s))) {
    const w = m[0].replace(/['’-]+$/g, '');
    out.push({ start: m.index, end: m.index + w.length, f: fold(w) });
  }
  return out;
};

// Index by the first 3 folded letters of a name's first word: candidate lookup is O(1) per token instead of trying
// every name. stemEq compares only words whose first 3 letters agree, which the stem rules guarantee for real
// matches (endings are added at the end). Candidates are tried longest name first, so "tax code" wins over "tax".
export function termMatcher(entries) {
  const byFirst = new Map();
  let size = 0;
  for (const e of entries || []) {
    for (const name of e.names || []) {
      const ws = words(name);
      if (!ws.length) continue;
      const k = ws[0].slice(0, 3);
      if (!byFirst.has(k)) byFirst.set(k, []);
      byFirst.get(k).push({ id: e.id, ws, len: ws.join(' ').length });
      size++;
    }
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.ws.length - a.ws.length || b.len - a.len);
  return {
    size,
    find(text) {
      const s = String(text == null ? '' : text);
      const toks = tokensOf(s);
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        const cands = byFirst.get(toks[i].f.slice(0, 3));
        if (!cands) continue;
        for (const c of cands) {
          let ok = true;
          for (let k = 0; k < c.ws.length && ok; k++) {
            const t = toks[i + k];
            if (!t || !stemEq(t.f, c.ws[k])) ok = false;
            // Words of a name are separated by spaces or hyphens only.
            else if (k > 0 && !/^[\s -]+$/.test(s.slice(toks[i + k - 1].end, t.start))) ok = false;
          }
          if (!ok) continue;
          out.push({ start: toks[i].start, end: toks[i + c.ws.length - 1].end, id: c.id });
          i += c.ws.length - 1;
          break;
        }
      }
      return out;
    },
  };
}

// Only text outside links / headings / code is touched (segments.js mapText); only the first occurrence of each term
// per `seen` scope is linked: a paragraph full of links to the same definition is noise, and screen readers announce
// every link.
export function linkTerms(html, matcher, { seen = new Set(), skip = new Set(), open, close = '</a>' } = {}) {
  if (!matcher || !matcher.size) return html;
  return mapText(html, (text) => {
    const spans = [];
    for (const h of matcher.find(text)) {
      if (seen.has(h.id) || skip.has(h.id)) continue;
      seen.add(h.id);
      spans.push({ start: h.start, end: h.end, open: open(h.id, text.slice(h.start, h.end)), close: typeof close === 'function' ? close(h.id) : close });
    }
    return spans.length ? wrapSpans(text, spans) : null;
  });
}
