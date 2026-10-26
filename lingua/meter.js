// lingua/meter.js - scansion of Vedic verse in IAST: syllables, their weight (guru – / laghu ⏑) and the meter.
//
//   scan(text) -> { padas: [{ text, syl: [{ text, heavy, why }], pattern: '–⏑–…', count }], meter: { id, fit } | null,
//                   counts: [8, 8, 8], cadence: [{ pada, ok, want }] }
//   METERS: { id: { padas: [8, 8, 8], cadence: '⏑–⏑×' | null } }
//
// Pādas (verse quarters) are separated by new lines, '|' or '/'. A Vedic meter is defined by the number of syllables
// in its pādas; only the cadence (the last four or five syllables) has a regular rhythm: iambic ⏑–⏑× in the
// eight-syllable pādas, trochaic –⏑–× in the eleven-syllable triṣṭubh and ⏑–⏑–× (… –⏑–⏑×) in the twelve-syllable
// jagatī. The recited text often has fewer syllables than the meter needs because later sandhi contracted vowels
// (tvám is read tu-am, vāyav ā as vā-ya-va ā): such pādas count one or two short; the fit allows that.
//
// Design: syllabification and weight live in iast.js (one source of truth shared with the reader views); this module
// only groups, counts and scores. Meter choice is a nearest-template search, not a parser: Vedic practice is too
// irregular for a strict grammar, so a score that tolerates the known deviation (syllables lost to contraction) and
// rewards the regular part (the cadence) is the honest model. Pure: no DOM, no state.
import { syllables } from './iast.js';

// Templates: syllables per pada and the cadence pattern ('×' = anceps, either weight; null = no cadence checked, used
// for the mixed 8/12 meters where one cadence would be wrong for part of the padas). The jagati cadence is stored as
// the shared ⏑–⏑× tail: the last four syllables already separate it from tristubh –⏑–×.
export const METERS = {
  gayatri: { padas: [8, 8, 8], cadence: '⏑–⏑×', name: 'gāyatrī' },
  anushtubh: { padas: [8, 8, 8, 8], cadence: '⏑–⏑×', name: 'anuṣṭubh' },
  ushnih: { padas: [8, 8, 12], cadence: null, name: 'uṣṇih' },
  brhati: { padas: [8, 8, 12, 8], cadence: null, name: 'bṛhatī' },
  pankti: { padas: [8, 8, 8, 8, 8], cadence: '⏑–⏑×', name: 'paṅkti' },
  trishtubh: { padas: [11, 11, 11, 11], cadence: '–⏑–×', name: 'triṣṭubh' },
  jagati: { padas: [12, 12, 12, 12], cadence: '⏑–⏑×', name: 'jagatī' },
  dvipada: { padas: [11, 11], cadence: '–⏑–×', name: 'dvipadā virāj' },
};

const HEAVY = '–', LIGHT = '⏑';

// Split on line breaks, dandas typed as '|' / '||' and '/'; verse numbers and punctuation are blanked (not removed)
// so neighbouring words cannot fuse. Empty pieces (a trailing '||') are dropped.
export function splitPadas(text) {
  return String(text).split(/\n|\|+|\//).map((s) => s.replace(/[0-9.,;:!?"“”]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Compare the tail of the weight pattern with the cadence position by position; '×' accepts either weight. A pada
// shorter than the cadence fails rather than matching a partial tail (a too-short pada proves nothing).
function cadenceOk(pattern, want) {
  if (!want) return true;
  const tail = pattern.slice(-want.length);
  if (tail.length < want.length) return false;
  for (let i = 0; i < want.length; i++) if (want[i] !== '×' && want[i] !== tail[i]) return false;
  return true;
}

export function scan(text) {
  const padas = splitPadas(text).map((p) => {
    const syl = syllables(p);
    // the last syllable of a pāda counts as either (anceps); show its own weight
    return { text: p, syl, pattern: syl.map((s) => (s.heavy ? HEAVY : LIGHT)).join(''), count: syl.length };
  });
  const counts = padas.map((p) => p.count);
  // Scoring. Hard filter: same number of padas, each 0..2 syllables short of the template (an excess is never
  // explained by contraction, so it disqualifies). Soft score: -0.12 per missing syllable dominates +0.03 per complete
  // pada with a correct cadence, so the count decides and the cadence only breaks ties. Strict '>' keeps the first
  // template on an exact tie: the order of METERS is the priority order (gayatri before ushnih, etc.).
  let best = null;
  for (const [id, m] of Object.entries(METERS)) {
    if (m.padas.length !== counts.length) continue;
    let miss = 0, bad = false;
    for (let i = 0; i < counts.length; i++) {
      const d = m.padas[i] - counts[i];
      if (d < 0 || d > 2) { bad = true; break; }
      miss += d;
    }
    if (bad) continue;
    const cad = m.cadence ? padas.filter((p, i) => p.count === m.padas[i] && cadenceOk(p.pattern, m.cadence)).length : 0;
    const fit = 1 - miss * 0.12 + cad * 0.03;
    if (!best || fit > best.fit) best = { id, fit: Math.round(fit * 100) / 100, missing: miss };
  }
  // Cadence is judged only on complete padas (ok: null otherwise): on a contracted pada the positions are shifted and
  // a mismatch would be a false alarm. Note: the returned `meter` is the score record { id, fit, missing }, not the
  // template; callers look the template up in METERS by id.
  const meter = best ? METERS[best.id] : null;
  const cadence = meter ? padas.map((p, i) => ({ pada: i, want: meter.cadence, full: p.count === meter.padas[i], ok: p.count === meter.padas[i] ? cadenceOk(p.pattern, meter.cadence) : null })) : [];
  return { padas, counts, meter: best, cadence };
}
