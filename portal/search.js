// portal/search.js - unified search over everything a portal holds (pure): pages, acts and their articles, defined
// terms, people and firms, requests, checklist items. Results carry their type (tabs with counts), a group (the act an
// article belongs to: "found in N articles of …"), highlighted titles and snippets.
//
//   RESULT_TYPES                               tab order
//   searchIndex(entries) -> ix
//     entry: { id, type, title, text, href, sub (context line: act title, role …), group: { key, label } }
//   ix.search(q, { type, limit }) -> { q, total, counts: { type: n }, groups: [{ key, label, n }],
//     results: [{ entry, score, titleHTML, snippet }] }     every query word must match (prefix of a word)
//   ix.size
import { escapeHTML } from '../html/escape.js';
import { fold, highlight, terms, words } from './text.js';

export const RESULT_TYPES = ['page', 'act', 'article', 'term', 'person', 'firm', 'org', 'request', 'check'];

// In-memory index of folded fields. Body words (bw) and folded body (fb) are computed lazily on first scoring: most
// queries reject a document on its title / sub before ever touching the body.
export function searchIndex(entries) {
  const docs = (entries || []).filter((e) => e && e.title).map((e) => {
    const title = String(e.title);
    const text = String(e.text || '');
    return { e, ft: fold(title), tw: words(title), fs: fold(e.sub || ''), bw: null, text, fb: null };
  });
  // AND semantics: every term must hit somewhere, else score 0. Weights: exact title word 30 > title word prefix 18 >
  // title substring 8 > context line 3 > body occurrences (capped at 12, so a long article cannot outrank a title
  // match by repetition). Multi-word phrases found verbatim get a bonus.
  function score(d, ts) {
    let s = 0;
    for (const t of ts) {
      let x = 0;
      if (d.tw.includes(t)) x += 30;
      else if (d.tw.some((w) => w.startsWith(t))) x += 18;
      else if (d.ft.includes(t)) x += 8;
      if (d.fs.includes(t)) x += 3;
      if (!d.bw) d.bw = words(d.text);
      let n = 0;
      for (const w of d.bw) {
        if (w === t) n += 2;
        else if (w.startsWith(t)) n += 1;
        if (n > 20) break;
      }
      x += Math.min(12, n);
      if (!x) return 0;
      s += x;
    }
    if (ts.length > 1) {
      if (!d.fb) d.fb = fold(d.text);
      if (d.fb.includes(ts.join(' ')) || d.ft.includes(ts.join(' '))) s += 10;
    }
    return s;
  }
  return {
    size: docs.length,
    search(q, { type = '', limit = 50 } = {}) {
      const ts = terms(q);
      const counts = {};
      const groups = new Map();
      if (!ts.length) return { q, total: 0, counts, groups: [], results: [] };
      const hits = [];
      for (const d of docs) {
        const s = score(d, ts);
        if (!s) continue;
        counts[d.e.type] = (counts[d.e.type] || 0) + 1;
        if (d.e.group && d.e.group.key) {
          const g = groups.get(d.e.group.key) || { key: d.e.group.key, label: d.e.group.label || d.e.group.key, href: d.e.group.href || '', n: 0 };
          g.n++;
          groups.set(g.key, g);
        }
        if (!type || d.e.type === type) hits.push({ d, s });
      }
      hits.sort((a, b) => b.s - a.s || a.d.e.title.localeCompare(b.d.e.title));
      const total = hits.length;
      const results = hits.slice(0, limit).map(({ d, s }) => ({
        entry: d.e, score: s, titleHTML: highlight(d.e.title, ts, { max: 300 }) || escapeHTML(d.e.title), snippet: highlight(d.text, ts),
      }));
      return { q, total, counts, groups: [...groups.values()].sort((a, b) => b.n - a.n), results };
    },
  };
}
