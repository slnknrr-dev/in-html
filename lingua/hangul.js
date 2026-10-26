// lingua/hangul.js - the Korean alphabet: syllable blocks ↔ jamo, the standard pronunciation (liaison, ㅎ rules,
// palatalisation, cluster simplification, final neutralisation, nasalisation, ㄹ / ㄴ assimilation, tensing) with
// every change explained, the Revised Romanization, a Russian transcription after Kontsevich and Latin → Hangul input.
//
//   decompose(ch) -> { L, V, T } | null       compose(L, V, T?) -> syllable | null     toJamo(text) -> jamo string
//   assemble(jamo) -> text   (two-set keyboard automaton: ㅎㅏㄴㄱㅡㄹ -> 한글)
//   parts(jamo) -> [jamo]    (ㄲ -> ㄱㄱ, ㅘ -> ㅗㅏ, ㄳ -> ㄱㅅ)
//   pronounce(text, { tense }) -> { text, changes: [{ at, rule, from, to }] }   SOUND_RULES[rule] -> { ru, en }
//   romanize(text) -> RR (pronunciation based, without tensing)   translit(text) -> letter by letter RR
//   kontsevich(text) -> Russian transcription                     fromRoman(latin, { score }) -> { text, alts }
//   JAMO: [{ ch, kind: 'c'|'v', rr, ipa, name, nameRr }]
//
// Design rules of this module:
// - Arithmetic, not tables, for blocks: Unicode lays out the 11172 precomposed syllables U+AC00..U+D7A3 as
//   L*588 + V*28 + T (19 initials x 21 vowels x 28 finals incl. "none"), so decompose/compose are O(1) and need no
//   data. The three lists below MUST stay in Unicode order; reordering them silently corrupts every syllable.
// - Jamo are the *compatibility* jamo (U+3131..U+3163), the ones a keyboard emits and a learner sees, not the
//   conjoining jamo (U+1100..). One code point serves as initial and final (ㄱ), which is why L/T lists share chars.
// - Pronunciation is a pipeline over syllable boundaries, mutating { L, V, T } records in place and logging every
//   step. Order of rules is the order of the Standard Pronunciation (표준 발음법) feeding relations: a rule may only
//   see the output of the rules before it (cluster -> neutral -> nasal -> lateral -> tense). Swapping two steps gives
//   wrong output, not an error (e.g. nasalising before neutralising misses 꽃말 -> [꼰말]).
// - Romanization/transcription are derived from the pronounced syllables, never from spelling, so one rule engine
//   feeds RR, Kontsevich and the input method; fixing a rule fixes all three.
// - Pure functions, no DOM, no state except a memo cache keyed by input (safe: outputs depend only on inputs).

// Unicode order of initials (19), medials (21), finals (27 + '' for "no final" at index 0).
export const L_LIST = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
export const V_LIST = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
export const T_LIST = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const BASE = 0xac00; // 가: L=ㄱ V=ㅏ T=''

// Multi-letter jamo spelled out. ㅐㅔㅒㅖ appear in COMPOUND_V for stroke/typing explanations (historically a+i),
// but JOIN_V excludes them: a two-set keyboard types ㅐ as one key, so ㅏ+ㅣ must NOT merge into ㅐ while typing.
// JOIN_T / JOIN_V are the inverse maps ("ㄹㄱ" -> ㄺ) used by the typing automaton.
export const CLUSTERS = { ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ' };
export const DOUBLES = { ㄲ: 'ㄱㄱ', ㄸ: 'ㄷㄷ', ㅃ: 'ㅂㅂ', ㅆ: 'ㅅㅅ', ㅉ: 'ㅈㅈ' };
export const COMPOUND_V = { ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ', ㅐ: 'ㅏㅣ', ㅔ: 'ㅓㅣ', ㅒ: 'ㅑㅣ', ㅖ: 'ㅕㅣ' };
const JOIN_T = Object.fromEntries(Object.entries(CLUSTERS).map(([k, v]) => [v, k]));
const JOIN_V = Object.fromEntries(Object.entries(COMPOUND_V).filter(([k]) => !'ㅐㅔㅒㅖ'.includes(k)).map(([k, v]) => [v, k]));

// codePointAt, not charCodeAt: robust for astral chars (they simply fail the range test instead of splitting).
export const isSyllable = (ch) => { const c = String(ch).codePointAt(0); return c >= BASE && c <= 0xd7a3; };
export const isJamo = (ch) => { const c = String(ch).codePointAt(0); return c >= 0x3131 && c <= 0x3163; };
export const isVowel = (j) => V_LIST.includes(j);

export function decompose(ch) {
  if (!isSyllable(ch)) return null;
  const n = ch.codePointAt(0) - BASE;
  return { L: L_LIST[Math.floor(n / 588)], V: V_LIST[Math.floor((n % 588) / 28)], T: T_LIST[n % 28] };
}

// Missing initial defaults to ㅇ (the silent placeholder), so compose('', 'ㅏ') = 아. Any unknown jamo -> null rather
// than a wrong code point: callers (assemble) rely on null to fall back to loose jamo.
export function compose(L, V, T = '') {
  const l = L_LIST.indexOf(L || 'ㅇ'), v = V_LIST.indexOf(V), t = T_LIST.indexOf(T || '');
  if (l < 0 || v < 0 || t < 0) return null;
  return String.fromCharCode(BASE + l * 588 + v * 28 + t);
}
const syl = (s) => compose(s.L, s.V, s.T);

// parts: a compound vowel splits only if it is typeable as two keys (in JOIN_V); ㅐ stays whole, matching assemble.
// toJamo keeps the silent ㅇ so assemble(toJamo(x)) round-trips. (The ㅇ ternary is an identity; harmless.)
export const parts = (j) => [...(DOUBLES[j] || CLUSTERS[j] || (JOIN_V[COMPOUND_V[j]] ? COMPOUND_V[j] : j))];
export const toJamo = (text) => [...String(text)].map((ch) => { const d = decompose(ch); return d ? (d.L === 'ㅇ' ? 'ㅇ' : d.L) + d.V + d.T : ch; }).join('');

// The two-set keyboard: consonants and vowels typed one by one become blocks; a final moves to the next block when
// a vowel follows (ㅎㅏㄴㄱㅡㄹ -> 한글, ㄷㅏㄹㄱㅇㅣ... ), vowels and finals combine (ㅗ+ㅏ = ㅘ, ㄹ+ㄱ = ㄺ).
// Automaton: `cur` is the block under construction { L, V, T }; it is committed (flush) only when the next jamo
// cannot extend it. Greedy final-taking is correct because the vowel branch can undo it: when a vowel arrives
// after a final, the final (or the second half of a cluster: 닭+ㅣ -> 달기) migrates to become the next initial,
// exactly what IMEs do. Double consonants ㄸㅃㅉ are initials only (not in T_LIST), so they always open a new block.
// Lone vowels/consonants are emitted as loose jamo, never forced into a syllable with a fake ㅇ.
export function assemble(jamo) {
  let out = '', cur = null;
  const flush = () => { if (cur) out += cur.L && cur.V ? syl(cur) : (cur.L || '') + (cur.V || ''); cur = null; };
  for (const j of String(jamo)) {
    if (DOUBLES[j] || (L_LIST.includes(j) || T_LIST.includes(j)) && !isVowel(j)) {
      if (!cur || !cur.V) { flush(); cur = { L: j, V: '', T: '' }; continue; }
      if (!cur.L) { flush(); cur = { L: j, V: '', T: '' }; continue; }
      if (!cur.T && T_LIST.includes(j)) { cur.T = j; continue; }
      if (cur.T && JOIN_T[cur.T + j]) { cur.T = JOIN_T[cur.T + j]; continue; }
      flush(); cur = { L: j, V: '', T: '' };
    } else if (isVowel(j)) {
      if (cur && cur.L && !cur.V) { cur.V = j; continue; }
      if (cur && cur.V && !cur.T && JOIN_V[cur.V + j]) { cur.V = JOIN_V[cur.V + j]; continue; }
      if (cur && cur.T) {
        const c = CLUSTERS[cur.T];
        let moved;
        if (c) { cur.T = c[0]; moved = c[1]; } else { moved = cur.T; cur.T = ''; }
        flush(); cur = { L: moved, V: j, T: '' }; continue;
      }
      flush(); cur = { L: '', V: j, T: '' };
    } else { flush(); out += j; }
  }
  flush();
  return out;
}

// --- pronunciation -------------------------------------------------------------------------------------------------

// Rule id -> bilingual learner-facing explanation. Ids are the `rule` field of pronounce().changes; UI keys on them.
export const SOUND_RULES = {
  liaison: { ru: 'Связывание (연음): конечный согласный переходит в следующий слог, начинающийся с гласной (ㅇ немая).', en: 'Liaison (연음): a final consonant moves into the next syllable when it starts with a vowel (silent ㅇ).' },
  'h-asp': { ru: 'Придыхание с ㅎ (격음화): ㄱ ㄷ ㅂ ㅈ рядом с ㅎ сливаются в ㅋ ㅌ ㅍ ㅊ.', en: 'Aspiration with ㅎ (격음화): ㄱ ㄷ ㅂ ㅈ next to ㅎ merge into ㅋ ㅌ ㅍ ㅊ.' },
  'h-s': { ru: 'ㅎ + ㅅ = ㅆ: конечное ㅎ делает следующее ㅅ напряжённым.', en: 'ㅎ + ㅅ = ㅆ: a final ㅎ makes the following ㅅ tense.' },
  'h-n': { ru: 'ㅎ перед ㄴ читается как ㄴ.', en: 'ㅎ before ㄴ is pronounced ㄴ.' },
  'h-drop': { ru: 'ㅎ перед гласной не произносится (좋아 [조아]).', en: 'ㅎ before a vowel is silent (좋아 [조아]).' },
  palatal: { ru: 'Палатализация (구개음화): ㄷ ㅌ перед 이 (и ㅎ+이) становятся ㅈ ㅊ (같이 [가치]).', en: 'Palatalisation (구개음화): ㄷ ㅌ before 이 become ㅈ ㅊ (같이 [가치]).' },
  cluster: { ru: 'Упрощение двойного конечного (자음군 단순화): перед согласным и в конце слова читается один из двух.', en: 'Cluster simplification (자음군 단순화): before a consonant or at the end only one of the two finals is said.' },
  neutral: { ru: 'Нейтрализация конечных (받침): в конце слога звучат только 7 согласных — ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅇ (ㅋ ㄲ → ㄱ; ㅅ ㅆ ㅈ ㅊ ㅌ ㅎ → ㄷ; ㅍ → ㅂ).', en: 'Final neutralisation (받침): only seven consonants sound at the end of a syllable — ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅇ.' },
  nasal: { ru: 'Назализация (비음화): ㄱ ㄷ ㅂ перед ㄴ ㅁ становятся ㅇ ㄴ ㅁ (합니다 [함니다]).', en: 'Nasalisation (비음화): ㄱ ㄷ ㅂ before ㄴ ㅁ become ㅇ ㄴ ㅁ (합니다 [함니다]).' },
  'l-n': { ru: 'ㄹ после ㅁ ㅇ (и ㄱ ㅂ) читается как ㄴ (종로 [종노], 국립 [궁닙]).', en: 'ㄹ after ㅁ ㅇ (and ㄱ ㅂ) is pronounced ㄴ (종로 [종노], 국립 [궁닙]).' },
  lateral: { ru: 'Латерализация (유음화): ㄴ рядом с ㄹ становится ㄹ (신라 [실라], 설날 [설랄]).', en: 'Lateralisation (유음화): ㄴ next to ㄹ becomes ㄹ (신라 [실라], 설날 [설랄]).' },
  tense: { ru: 'Напряжение (경음화): после ㄱ ㄷ ㅂ согласные ㄱ ㄷ ㅂ ㅅ ㅈ становятся напряжёнными ㄲ ㄸ ㅃ ㅆ ㅉ (학교 [학꾜]).', en: 'Tensing (경음화): after ㄱ ㄷ ㅂ the consonants ㄱ ㄷ ㅂ ㅅ ㅈ become tense ㄲ ㄸ ㅃ ㅆ ㅉ (학교 [학꾜]).' },
};

// Sound-change maps. BEFORE_H: final -> [what stays in the final, aspirated initial] when the next syllable starts
// with ㅎ; for clusters the first member stays (ㄺ+ㅎ -> ㄹ + ㅋ: 밝히다 [발키다]).
const ASP = { ㄱ: 'ㅋ', ㄷ: 'ㅌ', ㅈ: 'ㅊ', ㅂ: 'ㅍ' };
const TENSE = { ㄱ: 'ㄲ', ㄷ: 'ㄸ', ㅂ: 'ㅃ', ㅅ: 'ㅆ', ㅈ: 'ㅉ' };
const NEUTRAL = { ㄲ: 'ㄱ', ㅋ: 'ㄱ', ㅅ: 'ㄷ', ㅆ: 'ㄷ', ㅈ: 'ㄷ', ㅊ: 'ㄷ', ㅌ: 'ㄷ', ㅎ: 'ㄷ', ㅍ: 'ㅂ' };
const NASAL = { ㄱ: 'ㅇ', ㄷ: 'ㄴ', ㅂ: 'ㅁ' };
const BEFORE_H = { ㄱ: ['', 'ㅋ'], ㄲ: ['', 'ㅋ'], ㅋ: ['', 'ㅋ'], ㄷ: ['', 'ㅌ'], ㅅ: ['', 'ㅌ'], ㅆ: ['', 'ㅌ'], ㅈ: ['', 'ㅊ'], ㅊ: ['', 'ㅊ'], ㅌ: ['', 'ㅌ'], ㅂ: ['', 'ㅍ'], ㅍ: ['', 'ㅍ'], ㄺ: ['ㄹ', 'ㅋ'], ㄵ: ['ㄴ', 'ㅊ'], ㄼ: ['ㄹ', 'ㅍ'], ㄳ: ['ㄱ', 'ㅆ'] };

// The changes between syllable a (its final) and b (its initial). `out` collects { at, rule, from, to }.
// Mutates a and b in place: the next boundary (b, c) must see b's *changed* initial-side state, and b's final is
// untouched here, so left-to-right processing is consistent. `rec` snapshots the pair after each step so the UI
// can show a derivation chain (from -> to), not just the end result.
// Branch order = rule priority; early `return`s mark rules that bleed all later ones at this boundary:
//   1. final ㅎ (and ㄶ ㅀ) - aspiration / ㅆ / ㄴ / silent. h-drop falls through when a consonant remains (ㄶ+ㅇ ->
//      ㄴ liaison: 않아 [아나]). ㅂ is excluded from h-asp because no ㅎ+ㅂ aspiration exists in the standard.
//   2. initial ㅎ - aspiration from the other side; ㅌ+이 then palatalises (닫히다 [다치다]).
//   3. palatalisation before 이 must precede liaison, else 같이 would liaise to [가티].
//   4. liaison into silent ㅇ; final ㅇ never moves (it is [ŋ], not a consonant waiting for a vowel).
//   5. otherwise the consonant-consonant chain: cluster -> neutral -> nasal -> ㄹ rules -> tensing.
// Cluster choice: ㄺ keeps ㄱ except before ㄱ (맑게 [말께]); ㄼ keeps ㄹ except in 밟- (the ㅂ+ㅏ test is a heuristic
// for 밟다, the standard's named exception); ㄻ ㄿ keep the second member; the rest keep the first.
// `obstr`: a simplified cluster always triggers tensing (넓고 [널꼬]) even though the surviving final is ㄹ.
function boundary(a, b, at, out, tense) {
  if (!a.T) return;
  let from = syl(a) + syl(b);
  const rec = (rule) => { const to = syl(a) + syl(b); out.push({ at, rule, from, to }); from = to; };
  if (a.T === 'ㅎ' || a.T === 'ㄶ' || a.T === 'ㅀ') {
    const rest = { ㅎ: '', ㄶ: 'ㄴ', ㅀ: 'ㄹ' }[a.T];
    if (ASP[b.L] && b.L !== 'ㅂ') { b.L = ASP[b.L]; a.T = rest; rec('h-asp'); return; }
    if (b.L === 'ㅅ') { b.L = 'ㅆ'; a.T = rest; rec('h-s'); return; }
    if (b.L === 'ㄴ') { if (a.T === 'ㅀ') { a.T = 'ㄹ'; b.L = 'ㄹ'; rec('lateral'); } else { a.T = 'ㄴ'; rec('h-n'); } return; }
    if (b.L === 'ㅇ') { a.T = rest; rec('h-drop'); if (!a.T) return; }
  }
  if (b.L === 'ㅎ' && BEFORE_H[a.T]) {
    [a.T, b.L] = BEFORE_H[a.T];
    if (b.L === 'ㅌ' && b.V === 'ㅣ') b.L = 'ㅊ';
    rec('h-asp'); return;
  }
  if (b.L === 'ㅇ' && b.V === 'ㅣ' && (a.T === 'ㄷ' || a.T === 'ㅌ' || a.T === 'ㄾ')) {
    [a.T, b.L] = { ㄷ: ['', 'ㅈ'], ㅌ: ['', 'ㅊ'], ㄾ: ['ㄹ', 'ㅊ'] }[a.T];
    rec('palatal'); return;
  }
  if (b.L === 'ㅇ') {
    if (a.T === 'ㅇ') return;
    const c = CLUSTERS[a.T];
    if (c) { a.T = c[0]; b.L = c[1] === 'ㅅ' && tense ? 'ㅆ' : c[1]; } else { b.L = a.T; a.T = ''; }
    rec('liaison'); return;
  }
  let obstr = false;
  if (CLUSTERS[a.T]) {
    const [x, y] = CLUSTERS[a.T];
    a.T = a.T === 'ㄺ' ? (b.L === 'ㄱ' ? 'ㄹ' : 'ㄱ') : a.T === 'ㄼ' ? (a.L === 'ㅂ' && a.V === 'ㅏ' ? 'ㅂ' : 'ㄹ') : a.T === 'ㄻ' || a.T === 'ㄿ' ? y : x;
    obstr = true;
    rec('cluster');
  }
  if (NEUTRAL[a.T]) { a.T = NEUTRAL[a.T]; rec('neutral'); }
  if ((b.L === 'ㄴ' || b.L === 'ㅁ') && NASAL[a.T]) { a.T = NASAL[a.T]; rec('nasal'); }
  if (b.L === 'ㄹ') {
    if (a.T === 'ㅁ' || a.T === 'ㅇ') { b.L = 'ㄴ'; rec('l-n'); } else if (NASAL[a.T]) { b.L = 'ㄴ'; rec('l-n'); a.T = NASAL[a.T]; rec('nasal'); } else if (a.T === 'ㄴ') { a.T = 'ㄹ'; rec('lateral'); }
  } else if (b.L === 'ㄴ' && a.T === 'ㄹ') { b.L = 'ㄹ'; rec('lateral'); }
  if (tense && TENSE[b.L] && (a.T && 'ㄱㄷㅂ'.includes(a.T) || obstr)) { b.L = TENSE[b.L]; rec('tense'); }
}

// Word-final syllable: no following initial, so only cluster simplification and neutralisation apply. ㄺ here keeps
// ㄱ (닭 [닥]), unlike before ㄱ in boundary().
function finalOf(a, at, out) {
  if (!a.T) return;
  let from = syl(a);
  const rec = (rule) => { const to = syl(a); out.push({ at, rule, from, to }); from = to; };
  if (CLUSTERS[a.T]) { const [x, y] = CLUSTERS[a.T]; a.T = a.T === 'ㄺ' || a.T === 'ㄻ' || a.T === 'ㄿ' ? y : x; rec('cluster'); }
  if (NEUTRAL[a.T]) { a.T = NEUTRAL[a.T]; rec('neutral'); }
}

// Runs of Hangul syllables (words) and the rest. Sound rules apply only inside a run: a space or punctuation is a
// pause, and Korean sandhi does not cross pauses. Positions `at` count code points ([...s]), matching what the UI
// indexes with Array.from, so surrogate pairs in the non-Hangul runs do not shift highlights.
function chunks(text) {
  const out = [];
  for (const ch of String(text)) {
    const d = decompose(ch);
    const last = out[out.length - 1];
    if (d) { if (last && last.h) last.s.push(d); else out.push({ h: true, s: [d] }); } else if (last && !last.h) last.raw += ch; else out.push({ h: false, raw: ch });
  }
  return out;
}

function pronounceChunks(text, tense) {
  const changes = [];
  const cs = chunks(text);
  let at = 0;
  for (const c of cs) {
    if (!c.h) { at += [...c.raw].length; continue; }
    for (let i = 0; i + 1 < c.s.length; i++) boundary(c.s[i], c.s[i + 1], at + i, changes, tense);
    finalOf(c.s[c.s.length - 1], at + c.s.length - 1, changes);
    at += c.s.length;
  }
  return { cs, changes };
}

export function pronounce(text, { tense = true } = {}) {
  const { cs, changes } = pronounceChunks(text, tense);
  return { text: cs.map((c) => (c.h ? c.s.map(syl).join('') : c.raw)).join(''), changes };
}

// --- romanization --------------------------------------------------------------------------------------------------
// RR (2000) is pronunciation-based but deliberately ignores tensing (학교 = hakgyo, not hakkyo): hence
// pronounceChunks(text, false). TR_T is the letter-for-letter transliteration of finals (RR's "transliteration"
// variant, used for dictionaries), which keeps every cluster member.

const RR_L = { ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp', ㅅ: 's', ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h' };
const RR_V = { ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo', ㅔ: 'e', ㅕ: 'yeo', ㅖ: 'ye', ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae', ㅚ: 'oe', ㅛ: 'yo', ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we', ㅟ: 'wi', ㅠ: 'yu', ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i' };
const RR_T = { '': '', ㄱ: 'k', ㄲ: 'k', ㄳ: 'k', ㄴ: 'n', ㄵ: 'n', ㄶ: 'n', ㄷ: 't', ㄹ: 'l', ㄺ: 'k', ㄻ: 'm', ㄼ: 'l', ㄽ: 'l', ㄾ: 'l', ㄿ: 'p', ㅀ: 'l', ㅁ: 'm', ㅂ: 'p', ㅄ: 'p', ㅅ: 't', ㅆ: 't', ㅇ: 'ng', ㅈ: 't', ㅊ: 't', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 't' };
const TR_T = { '': '', ㄱ: 'g', ㄲ: 'kk', ㄳ: 'gs', ㄴ: 'n', ㄵ: 'nj', ㄶ: 'nh', ㄷ: 'd', ㄹ: 'l', ㄺ: 'lg', ㄻ: 'lm', ㄼ: 'lb', ㄽ: 'ls', ㄾ: 'lt', ㄿ: 'lp', ㅀ: 'lh', ㅁ: 'm', ㅂ: 'b', ㅄ: 'bs', ㅅ: 's', ㅆ: 'ss', ㅇ: 'ng', ㅈ: 'j', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h' };
export const RR = { L: RR_L, V: RR_V, T: RR_T };

// ㄹㄹ is written "ll" in RR (설날 -> seollal), the only initial whose spelling depends on the preceding final.
const rrSyls = (s) => s.map((x, i) => (x.L === 'ㄹ' && i > 0 && s[i - 1].T === 'ㄹ' ? 'l' : RR_L[x.L]) + RR_V[x.V] + RR_T[x.T]).join('');

export function romanize(text) {
  return pronounceChunks(text, false).cs.map((c) => (c.h ? rrSyls(c.s) : c.raw)).join('');
}
// The hyphen before a silent-ㅇ syllable after a final marks the syllable break so the Latin is reversible
// (밥이 -> bab-i, not "babi" which also reads as 바비).
export function translit(text) {
  return chunks(text).map((c) => (c.h ? c.s.map((x, i) => (i && x.L === 'ㅇ' && c.s[i - 1].T ? '-' : '') + RR_L[x.L] + RR_V[x.V] + TR_T[x.T]).join('') : c.raw)).join('');
}

// Russian (Kontsevich): ㄱ ㄷ ㅂ ㅈ are voiced between voiced sounds, ㅓ = о, ㅡ = ы, final ㄹ = ль, ㅇ = н.
const KO_L = { ㄱ: 'к', ㄲ: 'кк', ㄴ: 'н', ㄷ: 'т', ㄸ: 'тт', ㄹ: 'р', ㅁ: 'м', ㅂ: 'п', ㅃ: 'пп', ㅅ: 'с', ㅆ: 'сс', ㅇ: '', ㅈ: 'ч', ㅉ: 'чч', ㅊ: 'чх', ㅋ: 'кх', ㅌ: 'тх', ㅍ: 'пх', ㅎ: 'х' };
const KO_VOICED = { ㄱ: 'г', ㄷ: 'д', ㅂ: 'б', ㅈ: 'дж' };
const KO_V = { ㅏ: 'а', ㅐ: 'э', ㅑ: 'я', ㅒ: 'йе', ㅓ: 'о', ㅔ: 'е', ㅕ: 'ё', ㅖ: 'е', ㅗ: 'о', ㅘ: 'ва', ㅙ: 'вэ', ㅚ: 'ве', ㅛ: 'ё', ㅜ: 'у', ㅝ: 'во', ㅞ: 'ве', ㅟ: 'ви', ㅠ: 'ю', ㅡ: 'ы', ㅢ: 'ый', ㅣ: 'и' };
const KO_TENSE1 = { ㄲ: 'к', ㄸ: 'т', ㅃ: 'п', ㅆ: 'с', ㅉ: 'ч' };
const KO_V0 = { ㅔ: 'э', ㅖ: 'йе', ㅒ: 'йе' };
const KO_T = { '': '', ㄱ: 'к', ㄴ: 'н', ㄷ: 'т', ㄹ: 'ль', ㅁ: 'м', ㅂ: 'п', ㅇ: 'н' };

// Built on the tensed pronunciation (Kontsevich renders tense consonants), with two refinements per syllable:
// - voicing: a lax plosive after a vowel or sonorant final (ㄴㄹㅁㅇ) is written voiced (아버지 -> абоджи);
// - after an obstruent final the tense initial is written single (학교 [학꾜] -> хаккё, not хакккё): the doubling is
//   already heard in the final. ㅔ/ㅖ/ㅒ after silent ㅇ get word-initial spellings (э, йе).
// Finals fall back through NEUTRAL so any leftover non-standard final still maps to one of the seven sounds.
export function kontsevich(text) {
  return pronounceChunks(text, true).cs.map((c) => {
    if (!c.h) return c.raw;
    return c.s.map((x, i) => {
      const p = c.s[i - 1];
      const voiced = p && (!p.T || 'ㄴㄹㅁㅇ'.includes(p.T));
      const after = p && 'ㄱㄷㅂ'.includes(p.T || '-') && KO_TENSE1[x.L];
      const l = after ? KO_TENSE1[x.L] : x.L === 'ㄹ' && p && p.T === 'ㄹ' ? 'л' : voiced && KO_VOICED[x.L] ? KO_VOICED[x.L] : KO_L[x.L];
      const v = x.L === 'ㅇ' && KO_V0[x.V] ? KO_V0[x.V] : x.L === 'ㅇ' && x.V === 'ㅖ' ? 'йе' : KO_V[x.V];
      const nx = c.s[i + 1];
      const t = x.T === 'ㄹ' && nx && nx.L === 'ㄹ' ? 'л' : KO_T[x.T] ?? KO_T[NEUTRAL[x.T]] ?? '';
      return l + v + t;
    }).join('');
  }).join('');
}

// --- Latin → Hangul ------------------------------------------------------------------------------------------------
// The inverse of romanize is ambiguous: "hakgyo" could be 학교, 핚교, 학꾜... Strategy: segment the word at vowels
// (longest vowel token first, so "eo" beats "e"+"o"), then for each consonant run between two vowels enumerate every
// (final, initial) pair whose *romanized pronunciation* yields that run, and beam-search the combinations ranked by a
// cheap plausibility score (frequent syllables, simple finals) plus an optional caller-supplied lexicon score.
// Generating candidates through romanize() itself guarantees the inverse is consistent with the forward rules.
// V_TOKENS sorted by length desc: required for greedy longest-match ("yae" before "ya", "eo" before "e").

const V_TOKENS = Object.entries(RR_V).map(([j, r]) => [r, j]).sort((a, b) => b[0].length - a[0].length);
const L_IN = { ...Object.fromEntries(Object.entries(RR_L).filter(([, r]) => r).map(([j, r]) => [r, [j]])), l: ['ㄹ'], k: ['ㅋ', 'ㄱ'], t: ['ㅌ', 'ㄷ'], p: ['ㅍ', 'ㅂ'], ch: ['ㅊ', 'ㅈ'], '': ['ㅇ'] };
// Word-initial Latin -> candidate initials, best first. k/t/p/ch are listed as aspirate first, lax second: people
// often write "kimchi" for 김치. Then g/d/b/j/r are pinned to one letter (overriding the reverse map built above).
L_IN.g = ['ㄱ']; L_IN.d = ['ㄷ']; L_IN.b = ['ㅂ']; L_IN.j = ['ㅈ']; L_IN.r = ['ㄹ'];
// Frequent syllables: candidates made of them rank first. A hand-picked unigram prior (duplicates in the string are
// harmless, it becomes a Set); non-syllables filtered defensively.
const COMMON = new Set([...'이가는을를에서의도만고하다요니습합있없어아해했세시사람한국말일년나너우리저그것수때보알오가주자지기리대로게면데도야요저제내네뭐무엇왜어디언누구몇안못잘더많작크좋싫예쁘맛공부학교생선친구집물밥먹마시가오사랑감안녕히계십시오수고반갑습만나뵙겠죄송미괜찮잠깐실례여보세요정말진짜아주너무조금빨리천천히오늘내일어제지금시간분초월화목금토요일주말아침점심저녁밤낮소개이름나라말씀드리부탁드려요축하해요행복건강가족부모님아버지어머니형누나오빠언니동생아들딸할머니할아버지남편아내결혼회사일하원은행병원약국시장식당카페커피차우유물술빵과일사과배포도딸기바나나김치불고기비빔밥냉면라면떡국길버스지하철택시기차비행기역공항호텔방문창문책상의자컴퓨터전화핸드폰돈원얼마싸비싸옷신발모자가방색빨간파란노란하얀검은날씨덥춥따뜻시원비눈바람봄여름가을겨울산강바다하늘별달해꽃나무새개고양이몸머리눈코입귀손발마음생각꿈사랑노래춤영화음악그림운동축구여행휴가쉬다읽쓰듣말하배우가르치알모르좋아싫어하기원했었겠던든싶같은데랑과와께게께서까지부터처럼보다마다밖에뿐씩쯤째번개명마리권잔병장대살층호일이삼사오육칠팔구십백천만억하나둘셋넷다섯여섯일곱여덟아홉열스물서른마흔쉰'].filter(isSyllable));

function bestFinalInitial(run, nextV) {
  // every (T, L) whose sound (romanize) or spelling (translit) between two vowels is `run`
  // Brute force over 28 x 19 = 532 pairs, each embedded in a probe 아+T / L+nextV so the real boundary rules fire;
  // the probe's vowels are sliced off to leave the consonant romanization. Cost s (lower = better): exact RR sound
  // 0, transliteration 0.5, finals romanized without sandhi 0.6, loose spellings 0.9. nextV matters because
  // palatalisation and liaison depend on the following vowel. Memoised by candidates(); results are pure.
  const res = [];
  for (const T of T_LIST) {
    for (const L of L_LIST) {
      const a = { L: 'ㅇ', V: 'ㅏ', T }, b = { L, V: nextV, T: '' };
      const pr = romanize(syl(a) + syl(b)).slice(RR_V[a.V].length).slice(0, -RR_V[nextV].length);
      const lit = TR_T[T] + RR_L[L];
      if (pr === run) res.push({ T, L, s: 0 });
      else if (lit === run) res.push({ T, L, s: 0.5 });
      else if (RR_T[T] + RR_L[L] === run) res.push({ T, L, s: 0.6 });
      else if ((LOOSE_T[T] || []).some((f) => f + RR_L[L] === run || (RR_L[L] && f.endsWith(RR_L[L][0]) && f + RR_L[L].slice(1) === run))) res.push({ T, L, s: 0.9 });
    }
  }
  return res;
}

// spellings people use for finals besides RR: 'meokgesseumnida', 'joh-a'
const LOOSE_T = { ㅆ: ['ss', 's', 't'], ㅅ: ['s'], ㄱ: ['k', 'g'], ㄷ: ['t', 'd'], ㅂ: ['p', 'b'], ㅈ: ['j'], ㅊ: ['ch'], ㅎ: ['h'], ㅌ: ['t'], ㅍ: ['p'], ㅋ: ['k'] };
const memo = new Map();
function candidates(run, nextV) {
  const k = run + '|' + nextV;
  if (!memo.has(k)) memo.set(k, bestFinalInitial(run, nextV));
  return memo.get(k);
}
// Latin -> finals for a word-final run or an explicit hyphen split ("joh-a"): both RR and transliteration spellings.
// LOOSE_T is declared after its first textual use in bestFinalInitial; fine, since that runs only after module init.
const FINAL_IN = {};
for (const T of T_LIST) { (FINAL_IN[RR_T[T]] ||= []).push(T); if (TR_T[T] !== RR_T[T]) (FINAL_IN[TR_T[T]] ||= []).push(T); }

// One Latin word -> syllable skeletons: [{ L-run, V }] with the consonant runs between them.
function scanLatin(w) {
  const segs = [];
  let i = 0, cons = '';
  while (i < w.length) {
    const m = V_TOKENS.find(([r]) => w.startsWith(r, i));
    if (m) { segs.push({ run: cons, V: m[1] }); cons = ''; i += m[0].length; } else { cons += w[i]; i++; }
  }
  return { segs, tail: cons };
}

// Split with a capture group keeps separators in the array, so join('') restores the original spacing/punctuation.
// `alts` lists only genuinely ambiguous words, for a "did you mean" UI.
export function fromRoman(latin, { score = null, max = 5 } = {}) {
  const words = String(latin).toLowerCase().split(/([^a-z'\-]+)/);
  const best = [], alts = [];
  for (const w of words) {
    if (!/[a-z]/.test(w)) { best.push(w); continue; }
    const r = romanWord(w, score, max);
    best.push(r[0] || w);
    if (r.length > 1) alts.push({ word: w, options: r });
  }
  return { text: best.join(''), alts };
}

function romanWord(w, score, max) {
  const { segs, tail } = scanLatin(w);
  if (!segs.length) return [];
  // beam over the syllables: state = list of { syls, s }
  // Beam width 24 bounds the search to O(syllables x 24 x |opts|) instead of the exponential full product; the
  // lexicon score (expensive, caller-supplied) is applied only in the final re-rank of the top 12, not per step.
  // An apostrophe/hyphen in a run is the user's explicit syllable break and bypasses the sound-based candidates.
  let beam = [];
  const first = segs[0].run.replace(/['-]/g, '');
  for (const L of L_IN[first] || []) beam.push({ syls: [{ L, V: segs[0].V, T: '' }], s: L_IN[first].indexOf(L) * 0.3 });
  if (!beam.length) return [];
  for (let k = 1; k < segs.length; k++) {
    const { run, V } = segs[k];
    const next = [];
    let opts;
    const hy = run.search(/['-]/);
    if (hy >= 0) {
      const a = run.slice(0, hy), b = run.slice(hy + 1).replace(/['-]/g, '');
      opts = (FINAL_IN[a] || []).flatMap((T) => (L_IN[b] || []).map((L) => ({ T, L, s: 0 })));
    } else opts = candidates(run, V);
    for (const st of beam) {
      for (const o of opts) {
        const syls = st.syls.map((x) => ({ ...x }));
        syls[syls.length - 1].T = o.T;
        syls.push({ L: o.L, V, T: '' });
        next.push({ syls, s: st.s + o.s });
      }
    }
    beam = rank(next, score).slice(0, 24);
  }
  if (tail) {
    const next = [];
    for (const st of beam) for (const T of FINAL_IN[tail.replace(/['-]/g, '')] || []) { const syls = st.syls.map((x) => ({ ...x })); syls[syls.length - 1].T = T; next.push({ syls, s: st.s }); }
    beam = rank(next, score);
  }
  return [...new Set(rank(rank(beam, null).slice(0, 12), score, true).map((b) => b.syls.map(syl).join('')))].slice(0, max);
}

// Heuristic plausibility (higher = better): +1 per frequent syllable, minus accumulated candidate cost; penalise a
// ㅅ-ending cluster before ㅅ/ㅆ (a doubled-s reading that is almost never meant), clusters in general, and rare
// finals. Sorts in place and returns the same array (callers slice).
function rank(list, score, full = false) {
  for (const b of list) {
    const text = b.syls.map(syl).join('');
    let v = -b.s;
    for (const ch of text) v += COMMON.has(ch) ? 1 : 0;
    b.syls.forEach((x, i) => { const n = b.syls[i + 1]; if (n && (CLUSTERS[x.T] || '')[1] === 'ㅅ' && 'ㅅㅆ'.includes(n.L)) v -= 1.5; });
    for (const x of b.syls) if (CLUSTERS[x.T]) v -= 0.6; else if (x.T && !'ㄱㄴㄹㅁㅂㅇㅅㅆ'.includes(x.T)) v -= 0.3;
    if (full && score) v += score(text) || 0;
    b.v = v;
  }
  return list.sort((a, b) => b.v - a.v);
}

// --- the letters ---------------------------------------------------------------------------------------------------
// Data table: [jamo, RR, IPA (lax plosives: voiceless ~ voiced between voiced sounds), Korean name, its RR].
// Order is the dictionary/teaching order (basic 14, then doubles), not Unicode order. Vowel names are the vowel
// written with silent ㅇ (아, 야...), computed rather than listed.

const C_INFO = [
  ['ㄱ', 'g/k', 'k ~ g', '기역', 'giyeok'], ['ㄴ', 'n', 'n', '니은', 'nieun'], ['ㄷ', 'd/t', 't ~ d', '디귿', 'digeut'], ['ㄹ', 'r/l', 'ɾ ~ l', '리을', 'rieul'],
  ['ㅁ', 'm', 'm', '미음', 'mieum'], ['ㅂ', 'b/p', 'p ~ b', '비읍', 'bieup'], ['ㅅ', 's', 's ~ ɕ', '시옷', 'siot'], ['ㅇ', 'ng', '∅ ~ ŋ', '이응', 'ieung'],
  ['ㅈ', 'j', 'tɕ ~ dʑ', '지읒', 'jieut'], ['ㅊ', 'ch', 'tɕʰ', '치읓', 'chieut'], ['ㅋ', 'k', 'kʰ', '키읔', 'kieuk'], ['ㅌ', 't', 'tʰ', '티읕', 'tieut'],
  ['ㅍ', 'p', 'pʰ', '피읖', 'pieup'], ['ㅎ', 'h', 'h', '히읗', 'hieut'],
  ['ㄲ', 'kk', 'k͈', '쌍기역', 'ssanggiyeok'], ['ㄸ', 'tt', 't͈', '쌍디귿', 'ssangdigeut'], ['ㅃ', 'pp', 'p͈', '쌍비읍', 'ssangbieup'], ['ㅆ', 'ss', 's͈', '쌍시옷', 'ssangsiot'], ['ㅉ', 'jj', 't͈ɕ', '쌍지읒', 'ssangjieut'],
];
const V_IPA = { ㅏ: 'a', ㅐ: 'ɛ', ㅑ: 'ja', ㅒ: 'jɛ', ㅓ: 'ʌ', ㅔ: 'e', ㅕ: 'jʌ', ㅖ: 'je', ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wɛ', ㅚ: 'we', ㅛ: 'jo', ㅜ: 'u', ㅝ: 'wʌ', ㅞ: 'we', ㅟ: 'wi', ㅠ: 'ju', ㅡ: 'ɯ', ㅢ: 'ɰi', ㅣ: 'i' };
export const JAMO = [
  ...C_INFO.map(([ch, rr, ipa, name, nameRr]) => ({ ch, kind: 'c', rr, ipa, name, nameRr })),
  ...V_LIST.map((ch) => ({ ch, kind: 'v', rr: RR_V[ch], ipa: V_IPA[ch], name: compose('ㅇ', ch), nameRr: RR_V[ch] })),
];
