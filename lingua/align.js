// lingua/align.js - parallel texts: sentences of a text and its translation aligned (1-1, 1-2, 2-1, 1-0, 0-1, 2-2
// beads by dynamic programming over the length ratio, as in Gale & Church, plus anchors: numbers and names that read
// alike across scripts once romanised), and the entities of the two texts matched to each other (by the romanised name,
// otherwise by appearing in the same aligned sentences).
//
//   sentencesOf(text) -> ['…', …]           paragraphs, then sentences (dialogue dashes and quotes kept)
//   nameKey(word) -> 'vakhtang'             romanised, case endings of Georgian / Russian removed
//   alignTexts(a, b) -> { a: [s], b: [s], beads: [{ a: [i], b: [j], cost, anchors: [] }] }
//   alignSentences(sa, sb) -> the same over sentences split elsewhere (lingua/discourse.js analyzeText)
//   matchEntities(beads, entsA, entsB) -> [{ a, b, by: 'name' | 'cooccurrence', score }]
//     ents: [{ id, label, mentions: [{ s }] }] (lingua/discourse.js analyzeText(...).entities)
//     (also by: 'dictionary' when opts.same is given)
//
// Key decisions:
// - Length-based alignment (Gale & Church 1993) needs no dictionary, so it works for any language pair the app
//   teaches; characters, not words, are the length unit (G&C's finding: char counts correlate better, and Georgian /
//   Russian / English word counts differ wildly through agglutination).
// - Anchors are a cheap lexical signal on top: digits and romanised proper names survive translation almost
//   unchanged, so a shared anchor lowers a bead's cost. Script-independence comes from romanising first.
// - Entity matching is precision-first: name match, then dictionary, then mutual-best co-occurrence with no ties;
//   an unmatched entity is better than a wrong link that the UI would draw as fact.
import { romanize } from './translit.js';

// Abbreviations whose trailing period does not end a sentence (en / ru / ka). Anchored at the end of the text so far.
const ABBR = /(?:^|\s)(?:mr|mrs|dr|st|vs|etc|e\.g|i\.e|т\.е|т\.д|т\.п|г|гг|ул|им|см|ср|др|თ|წ)\.$/i;

// Newlines are hard paragraph breaks; inside a paragraph, split after terminal punctuation keeping the whitespace
// as its own array item (capture group), so parts[i + 2] is the next non-space piece. A boundary is vetoed when the
// next piece starts lowercase or with a comma: that is the narrative tail of dialogue ("...?" - ответила она).
// Lookbehind (?<=) requires ES2018; acceptable for the app's evergreen-browser target.
export function sentencesOf(text) {
  const out = [];
  for (const para of String(text || '').split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    let cur = '';
    const parts = p.split(/(?<=[.!?…])(\s+)/);
    for (let i = 0; i < parts.length; i++) {
      const x = parts[i];
      if (/^\s+$/.test(x)) { cur += x; continue; }
      cur += x;
      const next = parts[i + 2] || '';
      // keep "— ответила она." with its line; an abbreviation does not end a sentence
      if (/[.!?…]["»”]?$/.test(cur.trim()) && !ABBR.test(cur.trim()) && !/^[a-zа-яё,]/.test(next)) { out.push(cur.trim()); cur = ''; }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

// Crude case-ending strippers (longest first in each alternation, since regex alternation is leftmost-first, not
// longest-match). Applied only to words longer than 4 letters, so short names are not eaten (Ия, Ада).
// nameKey then normalises romanisation noise: doubled letters, kh/h, y/i, so "Вахтанг" and "ვახტანგი" meet.
const KA_END = /(?:ებს|ებით|ებმა|ებში|ებზე|ების|ისა|ის|ით|ად|მა|ს|ი|ო|მ)$/;
const RU_END = /(?:ами|ями|ого|его|ому|ему|ой|ей|ом|ем|ам|ям|ах|ях|ы|и|а|я|у|ю|е|ь)$/;
export function nameKey(word) {
  let w = String(word || '').replace(/[^\p{L}\p{N}-]/gu, '');
  if (!w) return '';
  if (/[ა-ჿ]/.test(w)) w = w.length > 4 ? w.replace(KA_END, '') : w;
  else if (/[а-яё]/i.test(w)) w = w.length > 4 ? w.replace(RU_END, '') : w;
  else w = w.replace(/'s$/, '');
  return romanize(w, { apostrophes: false }).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').replace(/(.)\1+/g, '$1').replace(/kh/g, 'h').replace(/y/g, 'i');
}

// Name detection: Georgian has no capitals, so every Georgian word of 3+ letters is a candidate (the length >= 4 key
// filter and the cross-text match prune false positives). Elsewhere: capitalised and not sentence-initial.
// Numbers get a '#' prefix so they never fuzzy-match a name, and shared() demands exact equality for them.
const isName = (w, first) => /^[ა-ჿ]/.test(w) ? w.length >= 3 : /^\p{Lu}/u.test(w) && !first;
function anchorsOf(s) {
  const out = new Set();
  for (const n of s.match(/\d+/g) || []) out.add('#' + n);
  const words = s.split(/[\s,.;:!?«»"“”„()—–-]+/).filter(Boolean);
  words.forEach((w, i) => { if (isName(w, i === 0) || /^[ა-ჿ]/.test(w)) { const k = nameKey(w); if (k.length >= 4) out.add(k); } });
  return out;
}
// a little fuzzy: Russian and Georgian forms of one name may keep one more or one fewer letter
const near = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2);
function shared(A, B) {
  const hits = [];
  for (const a of A) for (const b of B) if (near(a, b) && (a[0] !== '#' || a === b)) { hits.push(a); break; }
  return hits;
}

// Normal tail probability for the length cost.
// phi is the standard normal CDF via the Abramowitz-Stegun 26.2.17 polynomial (|error| < 7.5e-8), valid for z >= 0,
// which holds since z is an absolute value. PRIOR: G&C's bead-type frequencies from the Canadian Hansard.
const phi = (z) => { const t = 1 / (1 + 0.2316419 * z); const d = 0.3989423 * Math.exp(-z * z / 2); return 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); };
const PRIOR = { '1-1': 0.89, '1-0': 0.0099, '0-1': 0.0099, '2-1': 0.089, '1-2': 0.089, '2-2': 0.011 };
const BEADS = [[1, 1], [1, 0], [0, 1], [2, 1], [1, 2], [2, 2]];

export const alignTexts = (textA, textB) => alignSentences(sentencesOf(textA), sentencesOf(textB));

// DP over the (n+1) x (m+1) lattice: cost[i][j] = best cost of aligning a[0..i) with b[0..j). Forward relaxation
// (push from each reached cell) rather than pull; equivalent, and skipping Infinity cells prunes nothing reachable.
// Bead cost = -log prior - log P(length match) - 1.5 per shared anchor. Length match: G&C model the target length
// as N(c*sa, s2*sa); here c = the global char ratio of the two texts (computed, not G&C's fixed 1), s2 = 6.8 (their
// estimate). 2*(1-phi(z)) is the two-tailed probability; clamped at 1e-12 so log never sees 0.
// Insertions/deletions (1-0, 0-1) get a flat +4 on top of their tiny prior: without anchors or lengths they are the
// cheapest way to "explain away" a hard region, so they are taxed to keep 1-1 dominant.
// Complexity O(n*m*6) time and memory: fine for chapters (hundreds of sentences), not for whole books; G&C bands
// the diagonal for that, not done here.
export function alignSentences(a, b) {
  const la = a.map((s) => s.length), lb = b.map((s) => s.length);
  const ratio = (lb.reduce((x, y) => x + y, 0) || 1) / (la.reduce((x, y) => x + y, 0) || 1);
  const anA = a.map(anchorsOf), anB = b.map(anchorsOf);
  const n = a.length, m = b.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (cost[i][j] === Infinity) continue;
      for (const [di, dj] of BEADS) {
        if (i + di > n || j + dj > m) continue;
        const sa = la.slice(i, i + di).reduce((x, y) => x + y, 0), sb = lb.slice(j, j + dj).reduce((x, y) => x + y, 0);
        let c = -Math.log(PRIOR[di + '-' + dj]);
        if (di && dj) {
          const z = Math.abs(sb - sa * ratio) / Math.sqrt(Math.max(1, sa) * 6.8 * ratio);
          c += -Math.log(Math.max(1e-12, 2 * (1 - phi(z))));
          const A = new Set(), Bs = new Set();
          for (let k = i; k < i + di; k++) for (const x of anA[k]) A.add(x);
          for (let k = j; k < j + dj; k++) for (const x of anB[k]) Bs.add(x);
          c -= 1.5 * shared(A, Bs).length;
        } else c += 4;
        const t = cost[i][j] + c;
        if (t < cost[i + di][j + dj]) { cost[i + di][j + dj] = t; back[i + di][j + dj] = [di, dj, c]; }
      }
    }
  }
  // Backtrace from (n, m). `if (!bk) break` only triggers at (0,0) in practice: 1-0 and 0-1 beads make every cell
  // reachable, so cost[n][m] is always finite. Each bead stores its own cost for the UI's confidence shading.
  const beads = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const bk = back[i][j];
    if (!bk) break;
    const [di, dj, c] = bk;
    const ai = Array.from({ length: di }, (_, k) => i - di + k), bj = Array.from({ length: dj }, (_, k) => j - dj + k);
    const A = new Set(ai.flatMap((k) => [...anA[k]])), Bs = new Set(bj.flatMap((k) => [...anB[k]]));
    beads.unshift({ a: ai, b: bj, cost: Math.round(c * 100) / 100, anchors: shared(A, Bs) });
    i -= di; j -= dj;
  }
  return { a, b, beads };
}

// opts.same(ea, eb) -> true when a dictionary says the two labels translate each other (the UI passes one built on
// lingua/bilex.js); such pairs need one shared aligned bead.
export function matchEntities(beads, entsA, entsB, { same = null } = {}) {
  const out = [];
  const used = new Set(), done = new Set();
  const take = (ea, eb, by, score) => { used.add(eb.id); done.add(ea.id); out.push({ a: ea.id, b: eb.id, by, score }); };
  // 1) names that read alike
  for (const ea of entsA) {
    const ka = nameKey(ea.label);
    if (ka.length < 3) continue;
    const eb = entsB.find((x) => !used.has(x.id) && near(nameKey(x.label), ka));
    if (eb) take(ea, eb, 'name', 1);
  }
  // Each entity -> the set of bead indices its mentions fall in; mention.s is a sentence index on that side.
  const beadOf = (side) => { const map = new Map(); beads.forEach((bd, k) => { for (const i of bd[side]) map.set(i, k); }); return map; };
  const ba = beadOf('a'), bb = beadOf('b');
  const setOf = (e, map) => new Set(e.mentions.map((x) => map.get(x.s)).filter((x) => x !== undefined));
  const SA = new Map(entsA.map((e) => [e.id, setOf(e, ba)])), SB = new Map(entsB.map((e) => [e.id, setOf(e, bb)]));
  const common = (ea, eb) => [...SA.get(ea.id)].filter((x) => SB.get(eb.id).has(x)).length;
  // 2) the dictionary
  if (same) for (const ea of entsA) {
    if (done.has(ea.id)) continue;
    const eb = entsB.find((x) => !used.has(x.id) && common(ea, x) >= 1 && same(ea, x));
    if (eb) take(ea, eb, 'dictionary', 1);
  }
  // 3) the same aligned sentences: only a mutual best without ties (two entities that always appear together
  // cannot be told apart this way)
  // Dice coefficient of the bead sets; threshold 0.66 in bestOf. The extra guard (>= 2 shared beads, unless A
  // occurs once) stops a single coincidental co-occurrence from linking two frequent entities.
  const dice = (ea, eb) => { const c = common(ea, eb); return c ? (2 * c) / (SA.get(ea.id).size + SB.get(eb.id).size) : 0; };
  const bestOf = (e, others, f) => {
    let best = null, tie = false;
    for (const o of others) { const d = f(e, o); if (d < 0.66) continue; if (!best || d > best.d) { best = { o, d }; tie = false; } else if (d === best.d) tie = true; }
    return best && !tie ? best : null;
  };
  for (const ea of entsA) {
    if (done.has(ea.id)) continue;
    const freeB = entsB.filter((x) => !used.has(x.id));
    const b = bestOf(ea, freeB, dice);
    if (!b) continue;
    const back = bestOf(b.o, entsA.filter((x) => !done.has(x.id)), (eb, x) => dice(x, eb));
    if (back && back.o === ea && (common(ea, b.o) >= 2 || SA.get(ea.id).size === 1)) take(ea, b.o, 'cooccurrence', Math.round(b.d * 100) / 100);
  }
  return out;
}

// Sentence indices of one split of a text mapped onto another split of the same text (by character offsets), so
// mentions found by lingua/discourse.js fall into the sentences that were aligned.
// Offsets found by a forward indexOf cursor (pieces appear in order, so repeated sentences resolve to the right
// occurrence); a piece not found (normalised differently) inherits the cursor. Each `from` sentence maps to the last
// `to` sentence starting at or before it: O(|from| * |to|) linear scan, fine at chapter size.
export function mapSentences(text, from, to) {
  const offs = (parts) => { let at = 0; return parts.map((p) => { const i = text.indexOf(p, at); const o = i < 0 ? at : i; at = o + p.length; return o; }); };
  const F = offs(from), T = offs(to);
  return F.map((o) => { let k = 0; while (k + 1 < T.length && T[k + 1] <= o) k++; return k; });
}
