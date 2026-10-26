// prosody/poem.js - a whole poem at once: words, the meter, the rhyme scheme and the "catch" of every line — how well
// its end rhymes with the line it has to rhyme with and how well it keeps the meter.
//
//   analyzePoem(text, { lang, scheme, meter, overrides }) -> P
//     lang: 'en' | 'ru' | 'ka' (detected when absent); scheme: 'auto' | an id of SCHEMES | a pattern ('ABAB');
//     meter: 'auto' | an id of METERS; overrides: Map(norm -> stressed syllable) of the user's stress marks
//   P = { lang, meter, feet, scheme: { id (the scheme used: a SCHEMES id, 'detected' or the pattern asked), asked,
//         letters (per line, '-' for none), detected: [[line, letter]] | null }, lines: [L] }
//   completeScheme(detectedLetters) -> the SCHEMES id agreeing best with the rhymes found, or null
//   L = { text, words: [{ text, start, end, W }], scan, unit, letter, target, rhyme (compareRhyme against the target),
//         expected (template slots), rhythm 0…1, catch 0…1, verdict 'good' | 'fair' | 'poor' | null, marks: [verdict
//         per word] }   (an empty line has words: [] and nulls)
import { tokenize, analyzeWord, detectLang } from './words.js';
import { detectMeter, scanLine, template, METERS } from './meter.js';
import { rhymeUnit, compareRhyme } from './rhyme.js';
import { detectScheme, expandScheme, partners, SCHEMES } from './scheme.js';

export const RU_ENCLITICS = new Set(['же', 'ж', 'ли', 'ль', 'бы', 'б', 'то', 'ка']);
export const verdictOf = (x) => (x === null || x === undefined ? null : x >= 0.75 ? 'good' : x >= 0.5 ? 'fair' : 'poor');

// The rhyming word of a line: its last word with a vowel (a Russian enclitic joins the word before it: знаешь ли).
export function lineEnd(words, lang) {
  let k = words.length - 1;
  while (k >= 0 && !words[k].W.syl.some((s) => s.v >= 0)) k--;
  if (k < 0) return null;
  const W = words[k].W;
  if (lang === 'ru' && k > 0 && RU_ENCLITICS.has(W.norm)) {
    const P = words[k - 1].W;
    return { index: k - 1, W: { ...P, norm: P.norm + ' ' + W.norm, text: P.text + ' ' + W.text, syl: P.syl.concat(W.syl.map((s) => ({ ...s, st: 0 }))) } };
  }
  return { index: k, W };
}

// The named scheme that agrees best with the rhymes found (a line not rhymed yet then still has a target): every pair
// the detection joins counts +1 when the scheme joins it too and -1 when it does not; a pair only the scheme joins
// counts -0.3. Nothing rhymed: two lines are a couplet, more are free verse.
export function completeScheme(detected) {
  const n = detected.length;
  if (!detected.some((l) => l !== '-')) return n <= 2 ? 'couplet' : 'free';
  let best = null;
  for (const id of ['cross', 'couplet', 'enclosing', 'mono', 'terza', 'sonnet', 'rubai', 'onegin']) {
    if ((id === 'sonnet' || id === 'onegin') && n < 12) continue;
    const exp = expandScheme(id, n);
    let sc = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < Math.min(n, i + 5); j++) {
      const d = detected[i] !== '-' && detected[i] === detected[j], e = exp[i] !== '-' && exp[i] === exp[j];
      if (d) sc += e ? 1 : -1; else if (e) sc -= 0.3;
    }
    if (!best || sc > best.sc + 1e-9) best = { id, sc };
  }
  return best && best.sc > 0 ? best.id : null;
}

export function analyzePoem(text, { lang = null, scheme = 'auto', meter = 'auto', overrides = null } = {}) {
  const raw = String(text || '').split(/\r?\n/);
  lang = lang || detectLang(text);
  const cache = new Map();
  const wordOf = (t) => { const k = t.toLowerCase(); if (!cache.has(k)) cache.set(k, analyzeWord(t, lang, { overrides })); return cache.get(k); };
  const lines = raw.map((s) => {
    const words = tokenize(s, lang).map((t) => ({ ...t, W: wordOf(t.text) }));
    const has = words.some((w) => w.W.syl.some((x) => x.v >= 0));
    return { text: s, words: has ? words : [], scan: null, unit: null, letter: '-', target: -1, rhyme: null, expected: [], rhythm: null, catch: null, verdict: null, marks: [] };
  });
  const filled = lines.map((l, i) => (l.words.length ? i : -1)).filter((i) => i >= 0);
  // meter
  let meterId = null, feet = 0;
  if (meter === 'auto' || !METERS[meter]) {
    const d = detectMeter(filled.map((i) => lines[i].words.map((w) => w.W)), lang);
    meterId = d.meter; feet = d.feet;
    filled.forEach((i, k) => { lines[i].scan = d.scans[k]; });
  } else {
    meterId = meter;
    const first = filled.map((i) => scanLine(lines[i].words.map((w) => w.W), lang, meterId));
    const counts = new Map();
    for (const s of first) if (s) counts.set(s.feet, (counts.get(s.feet) || 0) + 1);
    feet = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
    filled.forEach((i, k) => { lines[i].scan = METERS[meterId].kind === 'accentual' ? scanLine(lines[i].words.map((w) => w.W), lang, meterId, feet) : first[k]; });
  }
  // a word read with another stress the dictionary knows (за́мок / замо́к, ле́су / лесу́) is transcribed again with it
  for (const i of filled) {
    const L = lines[i];
    if (!L.scan || !L.scan.stress) continue;
    L.words.forEach((w, k) => {
      const st = L.scan.stress[k];
      if (st === undefined || st < 0 || st === w.W.stress || w.W.syl.length < 2) return;
      const W2 = analyzeWord(w.text, lang, { overrides: new Map([[w.W.norm, st]]) });
      W2.src = 'meter';
      W2.alt = [w.W.stress, ...w.W.alt.filter((x) => x !== st)];
      w.W = W2;
    });
  }
  // rhyming parts: English may rhyme on the ictus the meter puts after the word stress (temperate / date)
  for (const i of filled) {
    const L = lines[i];
    const end = lineEnd(L.words, lang);
    if (!end) continue;
    let from = null;
    if (lang === 'en' && L.scan && L.scan.pos) {
      const strong = L.scan.pos.filter((p) => p.w === end.index && p.strong && !p.elided).map((p) => p.s);
      const last = strong.length ? strong[strong.length - 1] : null;
      if (last !== null && last > end.W.stress) from = last;
    }
    L.unit = rhymeUnit(end.W, { from });
    L.endIndex = end.index;
  }
  // scheme
  const units = filled.map((i) => lines[i].unit);
  let letters, schemeId = scheme, detected = null;
  if (scheme !== 'auto') letters = expandScheme(scheme, filled.length);
  else if (meterId === 'prose') { letters = units.map(() => '-'); schemeId = 'free'; }
  else {
    detected = detectScheme(units, compareRhyme);
    schemeId = completeScheme(detected);
    letters = schemeId ? expandScheme(schemeId, filled.length) : detected;
    if (!schemeId) schemeId = 'detected';
  }
  const part = partners(letters);
  filled.forEach((i, k) => { lines[i].letter = letters[k]; lines[i].target = part[k] >= 0 ? filled[part[k]] : -1; });
  // the catch
  for (const i of filled) {
    const L = lines[i];
    const T = L.target >= 0 ? lines[L.target] : null;
    if (T && L.unit && T.unit) L.rhyme = compareRhyme(L.unit, T.unit);
    const clausula = T && T.scan ? T.scan.clausula : L.scan ? L.scan.clausula : 0;
    L.expected = meterId ? template(meterId, METERS[meterId].kind === 'syllabic' ? (L.scan && L.scan.L) || feet : feet, clausula) : [];
    if (!L.scan || meterId === 'prose') L.rhythm = 1;
    else {
      const read = L.scan.pos.filter((p) => !p.elided).length;
      const diff = L.expected.length ? Math.abs(read - L.expected.length) : 0;
      L.rhythm = Math.max(0, Math.min(1, L.scan.fit - 0.15 * diff));
    }
    L.catch = L.rhyme ? 0.6 * L.rhyme.score + 0.4 * L.rhythm : L.rhythm;
    L.verdict = verdictOf(L.catch);
    // words: the rhyming word by the rhyme, the others by the issues of their syllables
    L.marks = L.words.map((w, k) => {
      if (k === L.endIndex && L.rhyme) return verdictOf(L.rhyme.score);
      const issues = L.scan ? L.scan.pos.filter((p) => p.w === k).map((p) => p.issue) : [];
      return issues.includes('shift') || issues.includes('extra') ? 'poor' : issues.includes('caesura') ? 'fair' : 'good';
    });
  }
  return { lang, meter: meterId, feet, scheme: { id: schemeId, asked: scheme, letters: lines.map((l) => l.letter), detected: detected ? filled.map((i, k) => [i, detected[k]]) : null }, lines };
}
