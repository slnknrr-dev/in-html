// lingua/bilex.js - one dictionary across languages: entries of several lexicons (the Georgian and Mingrelian
// lexicons, the Korean seed dictionary, the word lists of courses) indexed by headword and by every gloss, so a word
// can be looked up from either side (Russian or English → Georgian, Georgian → Mingrelian through the shared gloss)
// and any entry finds its equivalents in the other languages through a pivot language.
//
//   glossKeys(text, lang) -> ['give', 'hand over']         normalised senses of one gloss string
//   createIndex(entries) -> index                            entries: [{ lang, w, tr?, gloss: { ru?, en?, … }, ref? }]
//   lookup(index, q, { langs, limit }) -> [{ e, by: 'head' | 'gloss' | 'prefix', pivot? }]  best first
//   equivalents(index, entry, { pivots, limit }) -> { lang: [{ e, pivot, key, shared }] }
//
// Key decisions:
// - Pivot through glosses, not a pairwise dictionary: N lexicons glossed in ru/en give N^2 language pairs for free.
//   Price: polysemy in the pivot ("key" = ключ and клавиша) can link wrong senses, so equivalents are ranked by how
//   many senses they share and whether the match is the entry's first (primary) sense.
// - Normalisation is aggressive and shared (glossKeys / headKey): lowercase, NFC, no stress marks, ё -> е, no
//   bracketed notes or "to"/articles. Matching must be forgiving because glosses were written by different hands.
// - Plain Maps of arrays, built once: lookups are O(1) for exact keys; prefix search is a linear scan, acceptable for
//   a few tens of thousands of keys and run only when exact hits are too few.

// Parenthesised/bracketed remarks and quote/terminal punctuation are noise for sense matching.
const STRIP = /\s*\([^)]*\)|\s*\[[^\]]*\]|[«»"“”„!?.…]/g;

// A gloss string holds several senses separated by ; , / or "или"/"or". Each sense is normalised; senses longer than
// 40 chars are explanations, not equivalents, and are dropped (they would never match another gloss anyway).
export function glossKeys(text, lang = 'en') {
  const out = [];
  for (let part of String(text || '').toLowerCase().replace(STRIP, '').split(/[;,/]|\s+(?:или|or)\s+/)) {
    part = part.replace(/ё/g, 'е').replace(/́/g, '').trim();
    if (lang === 'en') part = part.replace(/^(to|a|an|the)\s+/, '');
    part = part.replace(/^[-–—\s]+|[-–—\s]+$/g, '').replace(/\s+/g, ' ');
    if (part && part.length <= 40 && !out.includes(part)) out.push(part);
  }
  return out;
}

export const headKey = (w) => String(w || '').toLowerCase().normalize('NFC').replace(/́/g, '').replace(/ё/g, 'е').replace(/[!?.,…«»"]/g, '').trim();

// Dedup key = lang + headword + serialized gloss: the same word imported from two lists collapses, while true
// homographs with different glosses stay separate. Side effect: writes e._keys onto the caller's entry objects (a
// cache of its gloss keys used by equivalents); callers must not freeze entries or rely on them being untouched.
export function createIndex(entries) {
  const head = new Map();   // key -> [entry]
  const gloss = new Map();  // glossLang + ':' + key -> [entry]
  const all = [];
  const langs = new Set();
  const seen = new Set();
  for (const e of entries) {
    if (!e || !e.w || !e.lang) continue;
    const id = e.lang + ':' + e.w + ':' + JSON.stringify(e.gloss || {});
    if (seen.has(id)) continue;
    seen.add(id);
    all.push(e);
    const hk = headKey(e.w);
    if (!head.has(hk)) head.set(hk, []);
    head.get(hk).push(e);
    e._keys = {};
    for (const [gl, text] of Object.entries(e.gloss || {})) {
      const ks = glossKeys(text, gl);
      e._keys[gl] = ks;
      langs.add(gl);
      for (const k of ks) { const kk = gl + ':' + k; if (!gloss.has(kk)) gloss.set(kk, []); gloss.get(kk).push(e); }
    }
  }
  return { head, gloss, all, langs };
}

// A query in any language: headwords first, then entries glossed with the query (back-lookup), then prefixes.
// Insertion order is the ranking (no scores): `have` dedups so an entry keeps its best `by`. Prefix search starts
// only from 2 chars, since a 1-char prefix matches most of the index. (The `k + ' '` test is subsumed by startsWith(k).)
export function lookup(index, q, { langs = null, limit = 60 } = {}) {
  const k = headKey(q);
  if (!k) return [];
  const out = [];
  const have = new Set();
  const add = (e, by, pivot = null) => { if ((!langs || langs.includes(e.lang)) && !have.has(e)) { have.add(e); out.push({ e, by, pivot }); } };
  for (const e of index.head.get(k) || []) add(e, 'head');
  for (const gl of index.langs) for (const e of index.gloss.get(gl + ':' + k) || []) add(e, 'gloss', gl);
  if (out.length < limit && k.length >= 2) {
    for (const [hk, list] of index.head) if (hk !== k && hk.startsWith(k)) for (const e of list) add(e, 'prefix');
    for (const [kk, list] of index.gloss) { const key = kk.slice(kk.indexOf(':') + 1); if (key !== k && key.length >= k.length && (key.startsWith(k + ' ') || key.startsWith(k))) for (const e of list) add(e, 'prefix', kk.slice(0, kk.indexOf(':'))); }
  }
  return out.slice(0, limit);
}

// Entries of other languages that share a sense with `entry` in a pivot language. An entry of a pivot language
// itself (a Russian or English word) pivots on its own headword.
// Ranking: number of shared senses (accumulated across keys and pivots), then exact = the hit's primary sense is the
// key, then the entry's tier (lower = more basic vocabulary; missing tier sorts last as 9).
export function equivalents(index, entry, { pivots = ['ru', 'en'], limit = 6 } = {}) {
  const by = {};
  const keysIn = (e, p) => (e.lang === p ? [headKey(e.w)] : (e._keys && e._keys[p]) || []);
  for (const p of pivots) {
    for (const key of keysIn(entry, p)) {
      const hits = [...(index.gloss.get(p + ':' + key) || []), ...(p !== entry.lang ? (index.head.get(key) || []).filter((e) => e.lang === p) : [])];
      for (const e of hits) {
        if (e === entry || e.lang === entry.lang) continue;
        const list = (by[e.lang] ||= []);
        const old = list.find((x) => x.e === e);
        if (old) { if (!old.pivots.includes(p)) old.pivots.push(p); old.shared++; continue; }
        list.push({ e, pivot: p, pivots: [p], key, shared: 1, exact: keysIn(e, p)[0] === key });
      }
    }
  }
  for (const l of Object.keys(by)) by[l] = by[l].sort((a, b) => b.shared - a.shared || b.exact - a.exact || (a.e.tier || 9) - (b.e.tier || 9)).slice(0, limit);
  return by;
}
