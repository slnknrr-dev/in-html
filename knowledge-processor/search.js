// knowledge-processor/search.js - client-side full-text search of a knowledge base (Node and browsers): an index of
// titles, headings, summaries and text of every page version, prefix matching of words in any script (diacritics and
// case folded), substring matching for scripts written without spaces (Japanese, Chinese), ranked results with
// highlighted snippets.
//
//   const ix = buildIndex(pages, { text(page) -> plain text, headings(page) -> [text] })
//   ix.add(page, text, headings)             (unlocked 451 pages join the index for the session)
//   ix.search(query, { limit }) -> [{ page, score, titleHTML, snippet }]       snippet / titleHTML are safe HTML
//   ix.suggest(query, n) -> [{ page, titleHTML }]   title prefix suggestions for the search box
//   fold(text) -> normalized text (NFKD, no combining marks, lower case)
//
// Why a hand-written index and not an inverted index: knowledge bases hold hundreds to a few thousand pages; a linear
// scan with precomputed folded strings and word sets answers in milliseconds, supports prefix and substring matching
// for free, and needs no build step or serialised index in the export. An inverted index pays off only far above this.
import { escapeHTML as esc } from '../html/escape.js';

// NFKD splits accented letters into base + combining mark, then the marks are stripped (the class lists the combining
// diacritic blocks), so "é" finds "e". NFKD also folds compatibility forms (full-width Latin, ligatures).
// Two language-specific folds that Unicode does not do: Russian ё -> е (commonly written without dots) and German ß -> ss.
export function fold(s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g, '').toLowerCase()
    .replace(/ё/g, 'е').replace(/ß/g, 'ss');
}

// A word starts with a letter or digit and may continue with marks, apostrophes, _ and -; \p{M} keeps Indic and other
// scripts whose vowel signs are combining marks (they survive NFKD stripping only outside the listed blocks).
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’_-]*/gu;
// Scripts written without spaces between words: word splitting is meaningless there, so terms in them match as
// substrings instead.
const NO_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

// Trailing apostrophes/dashes are trimmed so "rock'" and "rock" are the same word.
const words = (s) => (fold(s).match(WORD) || []).map((w) => w.replace(/['’_-]+$/g, ''));

// Folded text with a map back to offsets of the original string (snippets highlight the original characters).
// Folding can change length (ß -> ss, a decomposed letter loses its mark), so offsets found in folded text cannot be
// used on the original. map[k] = offset in the original of folded char k; per code point, so astral characters are
// never split.
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

// Snippet window: around the earliest match, starting 50 folded chars before it when it lies deeper than 60, snapped
// to spaces. Matching is repeated on the cut part (pf) to get exact local offsets. Output is escaped piecewise, so the
// only markup is <mark>; overlapping matches are skipped (a < pos), and marks are capped at 40 per snippet.
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

// Per document precomputed once: folded title / headings / body / slug and the word sets of title and headings.
// The body word list (bw) is computed lazily on the first query that needs it: most documents are rejected earlier.
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

  // Field weights encode where a match is meaningful: exact title 100, title word 30, title prefix 18, heading word 8,
  // body occurrences capped (12) so a long page cannot outrank a page about the term just by repeating it.
  // AND semantics: a term with no hit anywhere zeroes the document. A bonus of 10 rewards the query as an exact phrase.
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

  // Query terms mirror the indexing rules (same fold, same WORD), so a query matches exactly how text was indexed.
  // Deduplicated so "tea tea" does not double-score.
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
    // Ties broken by title for a stable, predictable order.
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
    // Autocomplete: titles that start with the input first, then titles containing it or a word starting with it; within
    // each group shorter titles first (closest to what was typed).
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

// Non-overlapping occurrence count, capped at 50: the score caps at 10 anyway, so counting further is wasted work.
function countOf(s, t) {
  let n = 0, i = s.indexOf(t);
  while (i >= 0 && n < 50) { n++; i = s.indexOf(t, i + t.length); }
  return n;
}
