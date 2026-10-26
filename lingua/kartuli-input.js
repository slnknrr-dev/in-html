// lingua/kartuli-input.js - Georgian typed in Latin or Russian transcription: the national romanisation (k = ქ,
// k' = კ, kh = ხ, q' = ყ), ISO 9984-like spellings (c, č, š, ž, x, ǧ, apostrophes or modifier letters), loose
// spellings (kh for ქ, ts / ch / t / p / k without marks) and Russian ones (к, к', кх, къ, гъ, ц', ч', дж, дз, ж,
// ш …). The converter knows which sounds a spelling can stand for, looks the readings up among the forms of the
// lexicon, picks the known word and explains every sound that the spelling left open or marked wrongly.
//
//   units(word) -> [{ src, opts: [{ ch, cost }], kind, explicit }]       one unit per Georgian letter (я, ю: two)
//   convert(text, { max = 6 }) -> { georgian, words: [{ src, chosen, known, candidates: [{ ka, cost, notes }],
//                                   notes: [{ level: 'info' | 'fix', unit, ch, ru, en }], hint, latin }], seps }
//   pronunciation(ka) -> { ipa, notes: [{ ru, en }] }
//   SOUNDS: { letter: { ipa, ru, en, kind } }
//   (actual shapes: SOUNDS[letter] = [ipa, kind]; convert returns { georgian, words } without `seps`.)
//
// Algorithm (noisy-channel decoding against a lexicon):
// 1. units(): greedy longest-match tokenisation of the transcription into units, each with weighted Georgian options
//    (cost 0 = what the spelling means, small = a common sloppy reading, >= 2 = the spelling marked a different sound).
// 2. Candidate retrieval by skeleton: letters that a single unit can confuse are collapsed into one class (ქ კ ყ ხ ღ გ
//    ჰ -> K, ...). INVARIANT: all options of one unit must fall into one class, otherwise the right word would sit
//    under a different skeleton and never be found. The skeleton index covers every inflected form of the lexicon.
// 3. align(): exact left-to-right alignment of units to a candidate (no DP needed: each unit consumes the start of
//    the remaining word, and options of one unit never share a prefix ambiguity that would need backtracking).
// 4. Rank by total cost + a small frequency penalty (tier), and explain every non-trivial choice as a note.
// Unknown words fall back to each unit's default letter, so output is always Georgian script.

import { formIndex } from './kartuli-grammar.js';
import { lexicon } from './kartuli-lexicon.js';
import { translit } from './kartuli.js';

// Letter -> IPA and a short description of the sound (kind: ej ejective, asp aspirated, vd voiced, fr fricative …).
export const SOUNDS = {
  'ა': ['ɑ', 'v'], 'ე': ['ɛ', 'v'], 'ი': ['i', 'v'], 'ო': ['ɔ', 'v'], 'უ': ['u', 'v'],
  'ბ': ['b', 'vd'], 'დ': ['d', 'vd'], 'გ': ['ɡ', 'vd'], 'ძ': ['dz', 'vd'], 'ჯ': ['dʒ', 'vd'],
  'ფ': ['pʰ', 'asp'], 'თ': ['tʰ', 'asp'], 'ქ': ['kʰ', 'asp'], 'ც': ['tsʰ', 'asp'], 'ჩ': ['tʃʰ', 'asp'],
  'პ': ['pʼ', 'ej'], 'ტ': ['tʼ', 'ej'], 'კ': ['kʼ', 'ej'], 'წ': ['tsʼ', 'ej'], 'ჭ': ['tʃʼ', 'ej'], 'ყ': ['qʼ', 'uv'],
  'ხ': ['χ', 'fr'], 'ღ': ['ʁ', 'gh'], 'ჰ': ['h', 'h'], 'ვ': ['v', 'c'], 'ზ': ['z', 'c'], 'ს': ['s', 'c'], 'შ': ['ʃ', 'c'], 'ჟ': ['ʒ', 'c'],
  'ლ': ['l', 'c'], 'მ': ['m', 'c'], 'ნ': ['n', 'c'], 'რ': ['r', 'c'],
};
const KIND_NOTE = {
  asp: { ru: 'придыхательный: с лёгким выдохом после смычки (как английские p, t, k в начале слова: «pin», «tin», «kit»)', en: 'aspirated: a puff of breath after the stop, as English p, t, k at the start of a word ("pin", "tin", "kit")' },
  ej: { ru: 'смычно-гортанный (абруптив): гортань сомкнута, звук короткий и резкий, без выдоха', en: 'ejective: the glottis is closed, a short sharp sound without breath' },
  uv: { ru: 'ყ — глубокий увулярный абруптив («къ» в глубине горла), не путать с ქ / კ', en: 'ყ: a deep uvular ejective (a "k" far back in the throat), not ქ / კ' },
  fr: { ru: 'ხ — горловое «х», грубее русского', en: 'ხ: a rough throat "kh", like German Bach' },
  gh: { ru: 'ღ — звонкое горловое «гъ», как французское r или южнорусское г, глубже', en: 'ღ: a voiced throat sound, like a French r' },
  h: { ru: 'ჰ — лёгкий выдох, английское h', en: 'ჰ: a light h' },
};
export function pronunciation(ka) {
  const letters = [...String(ka)];
  const ipa = letters.map((c) => (SOUNDS[c] ? SOUNDS[c][0] : c)).join('');
  const kinds = [...new Set(letters.map((c) => SOUNDS[c] && SOUNDS[c][1]).filter((k) => KIND_NOTE[k]))];
  const notes = kinds.map((k) => ({ kind: k, letters: [...new Set(letters.filter((c) => SOUNDS[c] && SOUNDS[c][1] === k))].join(' '), ...KIND_NOTE[k] }));
  return { ipa, notes };
}

// Spelling units: [spelling, [letter, cost]…, kind]. Order matters: longer spellings first. Costs: 0 the reading
// the spelling stands for; small: a common loose reading; large (>= 2): the spelling marks a different sound (fix).
const E = 2.5; // explicit mark, other sound
const LAT = [
  ["ts'", [['წ', 0], ['ც', E]], 'ej'], ["tz'", [['წ', 0], ['ც', E]], 'ej'], ["ch'", [['ჭ', 0], ['ჩ', E]], 'ej'], ["tch'", [['ჭ', 0]], 'ej'],
  ["k'", [['კ', 0], ['ქ', E], ['ყ', E]], 'ej'], ["t'", [['ტ', 0], ['თ', E]], 'ej'], ["p'", [['პ', 0], ['ფ', E]], 'ej'], ["q'", [['ყ', 0], ['კ', E], ['ქ', E]], 'uv'],
  ["c'", [['წ', 0], ['ც', E]], 'ej'], ["č'", [['ჭ', 0], ['ჩ', E]], 'ej'],
  ['tsh', [['ც', 0], ['წ', E]], 'asp'], ['chh', [['ჩ', 0], ['ჭ', E]], 'asp'],
  ['kh', [['ხ', 0], ['ქ', 0.4], ['ყ', 1.5]], 'kh'], ['gh', [['ღ', 0], ['გ', 2]], 'gh'], ['zh', [['ჟ', 0]], ''], ['sh', [['შ', 0]], ''],
  ['tch', [['ჩ', 0], ['ჭ', 0.6]], 'plain'], ['ch', [['ჩ', 0], ['ჭ', 0.6]], 'plain'], ['ts', [['ც', 0], ['წ', 0.6]], 'plain'], ['tz', [['ც', 0], ['წ', 0.6]], 'plain'],
  ['dzh', [['ჯ', 0]], ''], ['dz', [['ძ', 0]], ''], ['dj', [['ჯ', 0]], ''], ['th', [['თ', 0], ['ტ', E]], 'asp'], ['ph', [['ფ', 0], ['პ', E]], 'asp'],
  ['kʰ', [['ქ', 0], ['კ', E]], 'asp'], ['tʰ', [['თ', 0], ['ტ', E]], 'asp'], ['pʰ', [['ფ', 0], ['პ', E]], 'asp'],
  ['k', [['ქ', 0], ['კ', 0.6], ['ყ', 1.4]], 'plain'], ['t', [['თ', 0], ['ტ', 0.6]], 'plain'], ['p', [['ფ', 0], ['პ', 0.6]], 'plain'],
  ['q', [['ყ', 0], ['ქ', 1.8], ['კ', 1.8]], 'uv'], ['c', [['ც', 0], ['წ', 0.6]], 'plain'], ['č', [['ჩ', 0], ['ჭ', 0.6]], 'plain'],
  ['x', [['ხ', 0], ['ყ', 1.5]], 'kh'], ['ǧ', [['ღ', 0]], 'gh'], ['ğ', [['ღ', 0]], 'gh'], ['ɣ', [['ღ', 0]], 'gh'], ['š', [['შ', 0]], ''], ['ž', [['ჟ', 0]], ''],
  ['j', [['ჯ', 0], ['ჟ', 1.5]], ''], ['g', [['გ', 0], ['ღ', 1.6]], 'g'], ['h', [['ჰ', 0], ['ხ', 1.2]], 'h'], ['f', [['ფ', 0.3], ['პ', 1]], 'plain'],
  ['w', [['ვ', 0]], ''], ['v', [['ვ', 0]], ''], ['y', [['ი', 0.5]], ''], ['b', [['ბ', 0]], ''], ['d', [['დ', 0]], ''], ['z', [['ზ', 0]], ''], ['l', [['ლ', 0]], ''],
  ['m', [['მ', 0]], ''], ['n', [['ნ', 0]], ''], ['r', [['რ', 0]], ''], ['s', [['ს', 0]], ''],
  ['a', [['ა', 0]], 'v'], ['e', [['ე', 0]], 'v'], ['i', [['ი', 0]], 'v'], ['o', [['ო', 0]], 'v'], ['u', [['უ', 0]], 'v'],
];
const RUS = [
  ["ц'", [['წ', 0], ['ც', E]], 'ej'], ["ч'", [['ჭ', 0], ['ჩ', E]], 'ej'], ["к'", [['კ', 0], ['ქ', E], ['ყ', E]], 'ej'], ["т'", [['ტ', 0], ['თ', E]], 'ej'], ["п'", [['პ', 0], ['ფ', E]], 'ej'],
  ['къ', [['ყ', 0], ['კ', 1.5]], 'uv'], ['кь', [['კ', 0], ['ყ', 1]], 'ej'], ['гъ', [['ღ', 0]], 'gh'], ['гх', [['ღ', 0]], 'gh'], ['гь', [['ღ', 0.3]], 'gh'], ['хх', [['ყ', 0.3], ['ხ', 0.8]], 'uv'],
  ['кх', [['ქ', 0], ['ხ', 1]], 'asp'], ['тх', [['თ', 0], ['ტ', E]], 'asp'], ['пх', [['ფ', 0], ['პ', E]], 'asp'], ['цх', [['ც', 0], ['წ', E]], 'asp'], ['чх', [['ჩ', 0], ['ჭ', E]], 'asp'],
  ['дз', [['ძ', 0]], ''], ['дж', [['ჯ', 0]], ''], ['ж', [['ჟ', 0]], ''], ['ш', [['შ', 0]], ''], ['щ', [['შ', 0.8]], ''],
  ['к', [['ქ', 0], ['კ', 0.6], ['ყ', 1.4]], 'plain'], ['т', [['თ', 0], ['ტ', 0.6]], 'plain'], ['п', [['ფ', 0], ['პ', 0.6]], 'plain'], ['ц', [['ც', 0], ['წ', 0.6]], 'plain'],
  ['ч', [['ჩ', 0], ['ჭ', 0.6]], 'plain'], ['х', [['ხ', 0], ['ყ', 1.3]], 'kh'], ['г', [['გ', 0], ['ღ', 1.2]], 'g'], ['һ', [['ჰ', 0]], 'h'], ['ф', [['ფ', 0.3]], 'plain'],
  ['в', [['ვ', 0]], ''], ['б', [['ბ', 0]], ''], ['д', [['დ', 0]], ''], ['з', [['ზ', 0]], ''], ['л', [['ლ', 0]], ''], ['м', [['მ', 0]], ''], ['н', [['ნ', 0]], ''], ['р', [['რ', 0]], ''], ['с', [['ს', 0]], ''],
  ['а', [['ა', 0]], 'v'], ['э', [['ე', 0]], 'v'], ['е', [['ე', 0]], 'v'], ['и', [['ი', 0]], 'v'], ['ы', [['ი', 0.5]], 'v'], ['й', [['ი', 0.3]], 'v'], ['о', [['ო', 0]], 'v'], ['у', [['უ', 0]], 'v'],
  ['я', [['ია', 0]], 'v'], ['ю', [['იუ', 0]], 'v'], ['ё', [['იო', 0]], 'v'],
];
// One merged table: Latin and Cyrillic never share a spelling, so a word may even mix both. `explicit` marks spellings
// that deliberately signal a sound (apostrophe, ʰ, ъ/ь, Russian Cх aspirate digraphs): overriding them is a "fix"
// note, overriding an unmarked spelling is only "info".
const TABLE = [...LAT, ...RUS].map(([s, opts, kind]) => ({ s, opts: opts.map(([ch, cost]) => ({ ch, cost })), kind, explicit: /['ʰ]|[ъь]$|^(?:тх|пх|цх|чх|кх)$/.test(s) }));

// All apostrophe look-alikes (typographic, modifier letters, backtick, acute, primes) fold to ASCII ' before matching.
const normApos = (s) => s.replace(/[’ʼ`´‘ʹ′]/g, "'");

// One word in transcription -> units (letters it can stand for). Unknown characters become single fixed units.
export function units(word) {
  const w = normApos(String(word).toLowerCase());
  const out = [];
  for (let i = 0; i < w.length;) {
    if (w[i] === "'") { i++; continue; } // a stray apostrophe
    const u = TABLE.find((x) => w.startsWith(x.s, i));
    if (u) { out.push({ src: u.s, opts: u.opts, kind: u.kind, explicit: u.explicit }); i += u.s.length; }
    else { if (/[ა-ჰ]/.test(w[i])) out.push({ src: w[i], opts: [{ ch: w[i], cost: 0 }], kind: 'ka', explicit: true }); i++; }
  }
  return out;
}

// Coarse classes so that every option of a unit falls into one class: lookups go by the skeleton of a word.
const CLS = { 'ქ': 'K', 'კ': 'K', 'ყ': 'K', 'ხ': 'K', 'ღ': 'K', 'გ': 'K', 'ჰ': 'K', 'თ': 'T', 'ტ': 'T', 'ფ': 'P', 'პ': 'P', 'ც': 'C', 'წ': 'C', 'ჩ': 'Č', 'ჭ': 'Č', 'ჯ': 'J', 'ჟ': 'J' };
const skel = (ka) => [...ka].map((c) => CLS[c] || c).join('');
// Built lazily once (formIndex enumerates all inflected forms: expensive), skeleton -> Set of forms; FREQ keeps the
// best (lowest) tier seen per form. Multi-word lexicon entries are skipped: input is converted word by word.
let SKEL = null, FREQ = null;
function skeletons() {
  if (SKEL) return SKEL;
  SKEL = new Map();
  FREQ = new Map();
  const put = (f, tier) => {
    const k = skel(f);
    if (!SKEL.has(k)) SKEL.set(k, new Set());
    SKEL.get(k).add(f);
    FREQ.set(f, Math.min(FREQ.get(f) || 9, tier));
  };
  for (const [form, recs] of formIndex()) put(form, Math.min(...recs.map((r) => lexicon()[r[0]].tier || 2)));
  for (const e of lexicon()) if (!e.w.includes(' ')) put(e.w.replace(/^-/, ''), e.tier || 2);
  return SKEL;
}

// Cost of reading the units as the Georgian word (Infinity when impossible), with per-unit choices.
function align(us, ka) {
  const picks = [];
  let cost = 0, pos = 0;
  for (const u of us) {
    const opt = u.opts.find((o) => ka.startsWith(o.ch, pos));
    if (!opt) return { cost: Infinity };
    picks.push({ u, ch: opt.ch, cost: opt.cost });
    cost += opt.cost;
    pos += opt.ch.length;
  }
  return pos === ka.length ? { cost, picks } : { cost: Infinity };
}

const LETTER_TR = (ch) => translit(ch, 'lat');
// Notes for a chosen reading: what each open or wrongly marked spelling turned out to be.
// Three levels: explicit spelling overridden (fix), unmarked spelling read as a costly option (fix), unmarked
// ambiguous spelling resolved to anything (info, a teaching hint). Vowels and unambiguous units are silent.
function notesOf(picks) {
  const notes = [];
  for (const p of picks) {
    const { u, ch } = p;
    if (u.kind === 'v' || u.kind === '' || u.kind === 'ka') continue;
    const def = u.opts[0].ch;
    const snd = SOUNDS[ch] || [];
    const kn = KIND_NOTE[snd[1]] || { ru: '', en: '' };
    const right = LETTER_TR(ch);
    if (u.explicit && ch !== def) {
      notes.push({ level: 'fix', unit: u.src, ch, right, ru: `«${u.src}» обозначает ${def}, а в этом слове ${ch} (${right}): ${kn.ru}`, en: `"${u.src}" stands for ${def}, but this word has ${ch} (${right}): ${kn.en}` });
    } else if (ch !== def && p.cost >= 1) {
      notes.push({ level: 'fix', unit: u.src, ch, right, ru: `«${u.src}» здесь — ${ch} (${right}): ${kn.ru}`, en: `"${u.src}" here is ${ch} (${right}): ${kn.en}` });
    } else if (u.opts.length > 1 && !u.explicit) {
      notes.push({ level: 'info', unit: u.src, ch, right, ru: `«${u.src}» здесь — ${ch} (${right}): ${kn.ru}`, en: `"${u.src}" here is ${ch} (${right}): ${kn.en}` });
    }
  }
  return notes;
}

function convertWord(src, max) {
  const us = units(src);
  if (!us.length) return { src, chosen: src, known: false, candidates: [], notes: [], hint: null, latin: src };
  // a skeleton key per unit option class (Russian я / ю give two letters: their skeleton is the letters)
  const keyFull = us.map((u) => [...u.opts[0].ch].map((c) => CLS[c] || c).join('')).join('');
  const pool = skeletons().get(keyFull) || new Set();
  const cands = [];
  for (const ka of pool) {
    const a = align(us, ka);
    if (a.cost < Infinity) cands.push({ ka, cost: a.cost + ((FREQ.get(ka) || 3) - 1) * 0.15, picks: a.picks });
  }
  cands.sort((x, y) => x.cost - y.cost);
  const known = cands.length > 0;
  let chosen, picks;
  if (known) ({ ka: chosen, picks } = cands[0]);
  else { picks = us.map((u) => ({ u, ch: u.opts[0].ch, cost: 0 })); chosen = picks.map((p) => p.ch).join(''); }
  return {
    src, chosen, known,
    candidates: cands.slice(0, max).map((c) => ({ ka: c.ka, cost: Math.round(c.cost * 100) / 100, notes: notesOf(c.picks) })),
    notes: notesOf(picks), hint: pronunciation(chosen), latin: translit(chosen, 'lat'),
  };
}

// The whole text: words converted, everything else (spaces, punctuation, Georgian already typed) kept.
// split with one capture group: even indices are word runs, odd indices separators (always, even when empty).
export function convert(text, { max = 6 } = {}) {
  const s = String(text || '');
  const parts = s.split(/([^a-zа-яёčšžǧğɣʰһ'’ʼ`´‘ა-ჰ]+)/i);
  const words = [];
  let georgian = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (i % 2 === 1) { georgian += p; continue; }
    if (/^[ა-ჰ]+$/.test(p)) { georgian += p; continue; }
    const r = convertWord(p, max);
    words.push(r);
    georgian += r.chosen;
  }
  return { georgian, words };
}
