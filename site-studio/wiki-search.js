// site-studio/wiki-search.js - client-side full-text search of a knowledge base (Node and browsers): an index of
// titles, headings, summaries and text of every page version, prefix matching of words in any script (diacritics and
// case folded), substring matching for scripts written without spaces (Japanese, Chinese), ranked results with
// highlighted snippets.
//
//   const ix = buildIndex(pages, { text(page) -> plain text, headings(page) -> [text] })
//   ix.add(page, text, headings)             (unlocked 451 pages join the index for the session)
//   ix.search(query, { limit }) -> [{ page, score, titleHTML, snippet }]       snippet / titleHTML are safe HTML
//   ix.suggest(query, n) -> [{ page, titleHTML }]   title prefix suggestions for the search box
//   fold(text) -> normalized text (NFKD, no combining marks, lower case)
import { escapeHTML as esc } from '../html/escape.js';

// Folding: NFKD splits accented letters into base + combining mark and maps compatibility forms (full-width Latin,
// ligatures) to plain ones; the character class then strips combining marks (Combining Diacritical Marks, their
// Extended and Supplement blocks, marks for symbols, half marks). ё->е and ß->ss are language conventions NFKD does
// not cover (Russian readers search "ежик" for "ёжик"). Lower case last, after decomposition.
export function fold(s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g, '').toLowerCase()
    .replace(/ё/g, 'е').replace(/ß/g, 'ss');
}

// A word starts with a letter or digit and may contain marks (needed for Indic scripts, whose vowel signs are \p{M}
// and survive folding), apostrophes, '_' and '-'. NO_SPACE: scripts written without word separators, where word
// splitting is impossible without a dictionary, so the whole run is matched as a substring instead.
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’_-]*/gu;
const NO_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

// Trailing punctuation stripped: "dog's'" and "end-" index as "dog's" and "end".
const words = (s) => (fold(s).match(WORD) || []).map((w) => w.replace(/['’_-]+$/g, ''));

// Folded text with a map back to offsets of the original string (snippets highlight the original characters).
// Folding changes length (ß -> ss, é -> e), so offsets in the folded text do not equal offsets in the original.
// Folding char by char records, for every folded char, the original index it came from; map has one extra entry
// (s.length) so an end offset of a match at the very end is valid. Iterates by code point: surrogate pairs stay
// whole. Assumes fold(char) concatenated equals fold(string), true for NFKD of single code points.
function foldMap(s) {
  let out = '';
  const map = [];
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    out += f;
    i += ch.length;
  }
  map.push(s.length);
  return { text: out, map };
}

// Snippet window: start ~50 folded chars before the first hit (only when the hit is beyond 60, so short leads are
// kept whole), cap at max chars, then snap both edges to spaces when that does not lose much text. Matches are found
// in the folded window and mapped back, so <mark> wraps the original characters (accents intact). Overlapping marks
// are skipped (a < pos); every piece is escaped, so the result is safe HTML. marks is capped at 40 per snippet.
function highlight(text, terms, max = 220) {
  const s = String(text || '');
  if (!s) return '';
  const { text: f, map } = foldMap(s);
  let first = -1;
  for (const t of terms) {
    const i = f.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  let start = 0;
  if (first > 60) start = map[first - 50] || 0;
  let end = Math.min(s.length, start + max);
  // Snap to word boundaries.
  if (start > 0) { const sp = s.indexOf(' ', start); if (sp > 0 && sp - start < 20) start = sp + 1; }
  if (end < s.length) { const sp = s.lastIndexOf(' ', end); if (sp > start + max / 2) end = sp; }
  const part = s.slice(start, end);
  const pf = foldMap(part);
  const marks = [];
  for (const t of terms) {
    if (!t) continue;
    let i = pf.text.indexOf(t);
    while (i >= 0 && marks.length < 40) {
      marks.push([pf.map[i], pf.map[i + t.length]]);
      i = pf.text.indexOf(t, i + t.length);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  let html = '', pos = 0;
  for (const [a, b] of marks) {
    if (a < pos) continue;
    html += esc(part.slice(pos, a)) + '<mark>' + esc(part.slice(a, b)) + '</mark>';
    pos = b;
  }
  html += esc(part.slice(pos));
  return (start > 0 ? '… ' : '') + html + (end < s.length ? ' …' : '');
}

// Not an inverted index: a linear scan over pre-folded documents. For a knowledge base (hundreds to a few thousand
// pages, searched on keystroke) this is fast enough, needs no build step, and supports prefix and substring matches
// that an exact-term inverted index would not. Body words (bw) are split lazily on the first search that
// reaches the body test, so building the index at page load stays cheap.
export function buildIndex(pages, { text = (p) => p.summary || '', headings = () => [] } = {}) {
  const docs = [];
  const add = (page, body, heads) => {
    const title = page.title || page.slug;
    docs.push({
      page, title, body: body || '', heads: heads || [],
      ft: fold(title), fh: fold((heads || []).join(' | ')), fb: fold(body || ''), fs: fold(page.slug.replace(/[-/]/g, ' ')),
      tw: new Set(words(title)), hw: new Set(words((heads || []).join(' '))), bw: null,
    });
  };
  for (const p of pages) add(p, text(p), headings(p));

  // Weights: exact title 100 > title word 30 > title word prefix 18 > title substring 8 > heading word 8 > slug 4;
  // body occurrences add up to 12 (exact 2, prefix 1), so a page that merely mentions a word often never outranks a
  // page titled with it. AND semantics: a term that matches nowhere zeroes the document. Bonus 10 when the terms
  // appear as one phrase in the body. CJK-like terms use substring counts (no word boundaries to rely on).
  function score(d, terms) {
    let s = 0;
    for (const t of terms) {
      const cjk = NO_SPACE.test(t);
      let ts = 0;
      if (d.ft === t) ts += 100;
      if (cjk) {
        if (d.ft.includes(t)) ts += 20;
        if (d.fh.includes(t)) ts += 6;
        const n = countOf(d.fb, t);
        ts += Math.min(10, n);
      } else {
        if (d.tw.has(t)) ts += 30; else if ([...d.tw].some((w) => w.startsWith(t))) ts += 18; else if (d.ft.includes(t)) ts += 8;
        if (d.fs.includes(t)) ts += 4;
        if (d.hw.has(t)) ts += 8; else if ([...d.hw].some((w) => w.startsWith(t))) ts += 5;
        if (!d.bw) d.bw = words(d.body);
        let n = 0;
        for (const w of d.bw) {
          if (w === t) n += 2;
          else if (w.startsWith(t)) n += 1;
          if (n > 20) break;
        }
        ts += Math.min(12, n);
        if (!ts && d.fb.includes(t)) ts += 1;
      }
      if (!ts) return 0; // every term must match
      s += ts;
    }
    if (terms.length > 1 && d.fb.includes(terms.join(' '))) s += 10;
    return s;
  }

  // Query terms use the same folding and word rule as the documents, otherwise a term could never match. Deduplicated.
  function terms(q) {
    const f = fold(q).trim();
    if (!f) return [];
    const out = [];
    for (const part of f.split(/\s+/)) {
      if (NO_SPACE.test(part)) out.push(part);
      else out.push(...(part.match(WORD) || []).map((w) => w.replace(/['’_-]+$/g, '')));
    }
    return [...new Set(out.filter(Boolean))];
  }

  return {
    add,
    get size() { return docs.length; },
    search(q, { limit = 50 } = {}) {
      const ts = terms(q);
      if (!ts.length) return [];
      const res = [];
      for (const d of docs) {
        const s = score(d, ts);
        if (s > 0) res.push({ d, s });
      }
      res.sort((a, b) => b.s - a.s || a.d.title.localeCompare(b.d.title));
      return res.slice(0, limit).map(({ d, s }) => ({ page: d.page, score: s, titleHTML: highlight(d.title, ts, 300), snippet: highlight(d.body || d.page.summary || '', ts) }));
    },
    // Title prefix matches first, then substring / word-prefix matches; shorter titles first (likelier the exact topic).
    suggest(q, n = 8) {
      const f = fold(q).trim();
      if (!f) return [];
      const starts = [], within = [];
      for (const d of docs) {
        if (d.ft.startsWith(f)) starts.push(d);
        else if (d.ft.includes(f) || [...d.tw].some((w) => w.startsWith(f))) within.push(d);
      }
      const by = (a, b) => a.title.length - b.title.length || a.title.localeCompare(b.title);
      return [...starts.sort(by), ...within.sort(by)].slice(0, n).map((d) => ({ page: d.page, titleHTML: highlight(d.title, [f], 300) }));
    },
  };
}

function countOf(s, t) {
  let n = 0, i = s.indexOf(t);
  while (i >= 0 && n < 50) { n++; i = s.indexOf(t, i + t.length); }
  return n;
}
