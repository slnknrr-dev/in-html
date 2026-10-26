// lingua/sandhi.js - external sandhi of Sanskrit (the sound changes where two words meet), in IAST without accents.
//
//   join(a, b) -> { text, rule, parts: [left, right] }   one junction; `rule` is a key of RULES (explanations below)
//   joinAll(words) -> { text, steps: [{ at, rule, text }] }
//   RULES: { key: { ru, en } } - what each rule does
//
// Covered: vowel sandhi (savarṇa-dīrgha, guṇa, vṛddhi, yaṇ, ay/av/āy/āv, e/o + a with avagraha), visarga sandhi
// (aḥ, āḥ, other vowels + ḥ before voiced sounds, ḥ before c / ṭ / t / ś ṣ s, before r), final consonants (voicing
// before voiced sounds, nasals, t + c / j / l / ś, m before consonants, n before c / t / l / ś). The Vedic texts
// sometimes keep hiatus that classical Sanskrit would join: this module gives the classical result.

//
// Algorithm: join() looks only at the end of the left word and the start of the right word and returns the first
// rule that applies, in the order visarga, vowel + vowel, final consonant. Order matters: a word in -aḥ must reach the
// visarga rules before the vowel rules see its a. Strings are IAST code points; digraph consonants (kh, ch …) are
// read by initialCons with the aspirates tried first. Not covered: n doubling after a short vowel before a vowel
// (-ann a-), internal sandhi, Vedic exceptions. The glue argument of res() decides whether the result is written as
// one word ('') or two (' '): vowel coalescence fuses, consonant changes keep the word break, as in printed texts.

// Vowel classes: SIMPLE maps a vowel to its short class (for like-vowel tests), LONG_OF gives the long of a class.
const SIMPLE = { a: 'a', 'ā': 'a', i: 'i', 'ī': 'i', u: 'u', 'ū': 'u', 'ṛ': 'ṛ', 'ṝ': 'ṛ' };
const LONG_OF = { a: 'ā', i: 'ī', u: 'ū', 'ṛ': 'ṝ' };
const VOWEL_RE = /^(ai|au|[aāiīuūṛṝḷeo])/;
const LAST_VOWEL_RE = /(ai|au|[aāiīuūṛṝḷeo])$/;
const VOICED_CONS = ['g', 'gh', 'j', 'jh', 'ḍ', 'ḍh', 'd', 'dh', 'b', 'bh', 'ṅ', 'ñ', 'ṇ', 'n', 'm', 'y', 'r', 'l', 'v', 'h'];
const NASAL = ['ṅ', 'ñ', 'ṇ', 'n', 'm'];
// words whose final ḥ stands for r, not s: they keep r before voiced sounds (punar ramate → punā ramate)
const R_FINAL = new Set(['punaḥ', 'antaḥ', 'prātaḥ', 'svaḥ', 'ahaḥ', 'dvāḥ']);

export const RULES = {
  savarna: { ru: 'Одинаковые простые гласные сливаются в долгую: a/ā + a/ā → ā, i/ī + i/ī → ī, u/ū + u/ū → ū.', en: 'Two like simple vowels merge into the long one: a/ā + a/ā → ā, i + i → ī, u + u → ū.' },
  guna: { ru: 'Гуна: a/ā + i/ī → e, a/ā + u/ū → o, a/ā + ṛ → ar.', en: 'Guṇa: a/ā + i/ī → e, a/ā + u/ū → o, a/ā + ṛ → ar.' },
  vrddhi: { ru: 'Вриддхи: a/ā + e/ai → ai, a/ā + o/au → au.', en: 'Vṛddhi: a/ā + e/ai → ai, a/ā + o/au → au.' },
  yan: { ru: 'Перед непохожей гласной i/ī → y, u/ū → v, ṛ → r.', en: 'Before an unlike vowel i/ī → y, u/ū → v, ṛ → r.' },
  ayadi: { ru: 'Перед гласной (кроме a) e → a, o → a (из ay, av с выпавшим y/v), ai → ā, au → āv.', en: 'Before a vowel (other than a) e → a, o → a (ay, av with the y / v dropped), ai → ā, au → āv.' },
  avagraha: { ru: 'e/o + a: начальное a исчезает, на его месте знак аваграха (ऽ, в IAST апостроф).', en: 'e/o + a: the initial a disappears, marked by the avagraha (ऽ, an apostrophe in IAST).' },
  ahVoiced: { ru: 'aḥ перед звонкой согласной → o.', en: 'aḥ before a voiced consonant → o.' },
  ahA: { ru: 'aḥ + a → o\' (a выпадает, аваграха).', en: 'aḥ + a → o\' (the a drops, avagraha).' },
  ahVowel: { ru: 'aḥ перед гласной (кроме a) → a, висарга исчезает (зияние остаётся).', en: 'aḥ before a vowel other than a → a, the visarga goes (the hiatus stays).' },
  aahVoiced: { ru: 'āḥ перед звонким звуком → ā (висарга исчезает).', en: 'āḥ before a voiced sound → ā (the visarga goes).' },
  ihVoiced: { ru: 'Висарга после других гласных перед звонким звуком → r.', en: 'A visarga after other vowels before a voiced sound → r.' },
  hR: { ru: 'Перед r висарга (r) выпадает, а гласная перед ней удлиняется.', en: 'Before r the visarga (r) drops and the vowel before it is lengthened.' },
  hSibilant: { ru: 'Висарга уподобляется следующей глухой: перед c/ch → ś, перед ṭ/ṭh → ṣ, перед t/th → s.', en: 'The visarga takes the place of the next voiceless stop: before c/ch → ś, ṭ/ṭh → ṣ, t/th → s.' },
  hKeep: { ru: 'Перед k, kh, p, ph, ś, ṣ, s и в конце висарга остаётся.', en: 'Before k, kh, p, ph, ś, ṣ, s and at the end the visarga stays.' },
  voicing: { ru: 'Конечная глухая озвончается перед звонким звуком: k → g, ṭ → ḍ, t → d, p → b.', en: 'A final voiceless stop becomes voiced before a voiced sound: k → g, ṭ → ḍ, t → d, p → b.' },
  nasal: { ru: 'Конечная смычная перед носовым становится носовой своего ряда: k → ṅ, ṭ → ṇ, t → n, p → m.', en: 'A final stop before a nasal becomes the nasal of its row: k → ṅ, ṭ → ṇ, t → n, p → m.' },
  tPalatal: { ru: 't перед c/ch → c, перед j/jh → j, перед l → l, перед ś → c + ch.', en: 't before c/ch → c, before j/jh → j, before l → l, before ś → c + ch.' },
  mAnusvara: { ru: 'Конечное m перед согласной → анусвара ṃ.', en: 'A final m before a consonant → anusvāra ṃ.' },
  nPalatal: { ru: 'n перед c/ch → ṃś, перед t/th → ṃs, перед l → ṃl (назализованное l), перед ś → ñ (ñś или ñch).', en: 'n before c/ch → ṃś, before t/th → ṃs, before l → ṃl (nasal l), before ś → ñ (ñś or ñch).' },
  none: { ru: 'Изменений нет.', en: 'No change.' },
};

// Aspirated digraphs first, then single letters, so 'kh' is never read as k + h.
const initialCons = (b) => (/^(kh|gh|ch|jh|ṭh|ḍh|th|dh|ph|bh)/.exec(b) || /^[kgṅcjñṭḍṇtdnpbmyrlvśṣsh]/.exec(b) || [''])[0];

export function join(a, b) {
  a = String(a).trim(); b = String(b).trim();
  const res = (left, right, rule, glue = '') => ({ text: left + glue + right, rule, parts: [left, right] });
  if (!a) return res('', b, 'none');
  if (!b) return res(a, '', 'none');
  const bV = (VOWEL_RE.exec(b) || [''])[0];
  const bC = bV ? '' : initialCons(b);
  const voiced = !!bV || VOICED_CONS.includes(bC);

  // --- visarga
  if (a.endsWith('ḥ')) {
    const stem = a.slice(0, -1);
    const v = (LAST_VOWEL_RE.exec(stem) || [''])[0];
    if (v === 'a' && !R_FINAL.has(a)) {
      if (bV === 'a') return res(stem.slice(0, -1) + 'o', "'" + b.slice(1), 'ahA', ' ');
      if (bV) return res(stem, b, 'ahVowel', ' ');
      if (voiced) return res(stem.slice(0, -1) + 'o', b, 'ahVoiced', ' ');
    } else if (v === 'ā' && !R_FINAL.has(a)) {
      if (voiced) return res(stem, b, 'aahVoiced', ' ');
    } else if (voiced) {
      if (bC === 'r') return res(stem.slice(0, -v.length) + (LONG_OF[v] || v), b, 'hR', ' ');
      return res(stem + 'r', b, 'ihVoiced', bV ? '' : ' ');
    }
    if (bC === 'c' || bC === 'ch') return res(stem + 'ś', b, 'hSibilant', ' ');
    if (bC === 'ṭ' || bC === 'ṭh') return res(stem + 'ṣ', b, 'hSibilant', ' ');
    if (bC === 't' || bC === 'th') return res(stem + 's', b, 'hSibilant', ' ');
    return res(a, b, 'hKeep', ' ');
  }

  // --- vowels meeting
  // Priority: like vowels (savarṇa) > a + other (guṇa / vṛddhi) > i u ṛ + unlike (yaṇ) > e o ai au + vowel (ayādi /
  // avagraha). ḷ is in VOWEL_RE but in no class, so it falls through to 'none'.
  const aV = (LAST_VOWEL_RE.exec(a) || [''])[0];
  if (aV && bV) {
    const left = a.slice(0, -aV.length), right = b.slice(bV.length);
    const sa = SIMPLE[aV], sb = SIMPLE[bV];
    if (sa && sb && sa === sb) return res(left + LONG_OF[sa], right, 'savarna');
    if (sa === 'a') {
      if (sb === 'i') return res(left + 'e', right, 'guna');
      if (sb === 'u') return res(left + 'o', right, 'guna');
      if (sb === 'ṛ') return res(left + 'ar', right, 'guna');
      if (bV === 'e' || bV === 'ai') return res(left + 'ai', right, 'vrddhi');
      if (bV === 'o' || bV === 'au') return res(left + 'au', right, 'vrddhi');
    }
    if (sa === 'i') return res(left + 'y', b, 'yan');
    if (sa === 'u') return res(left + 'v', b, 'yan');
    if (sa === 'ṛ') return res(left + 'r', b, 'yan');
    if (aV === 'e' || aV === 'o') {
      if (bV === 'a') return res(a, "'" + right, 'avagraha', ' ');
      return res(left + 'a', b, 'ayadi', ' ');
    }
    if (aV === 'ai') return res(left + 'ā', b, 'ayadi', ' ');
    if (aV === 'au') return res(left + 'āv', b, 'ayadi');
  }

  // --- final consonants
  // m and n first (anusvāra / palatal assimilation), then t's special assimilations, then the general rule for the
  // four stops: nasal before a nasal, voiced before any voiced sound.
  const last = a.slice(-1);
  const left = a.slice(0, -1);
  if (last === 'm' && bC) return res(left + 'ṃ', b, 'mAnusvara', ' ');
  if (last === 'n' && bC) {
    if (bC === 'c' || bC === 'ch') return res(left + 'ṃś', b, 'nPalatal', ' ');
    if (bC === 't' || bC === 'th') return res(left + 'ṃs', b, 'nPalatal', ' ');
    if (bC === 'l') return res(left + 'ṃl', b, 'nPalatal', ' ');
    if (bC === 'ś') return res(left + 'ñ', b, 'nPalatal', ' ');
  }
  if (last === 't') {
    if (bC === 'c' || bC === 'ch') return res(left + 'c', b, 'tPalatal', ' ');
    if (bC === 'j' || bC === 'jh') return res(left + 'j', b, 'tPalatal', ' ');
    if (bC === 'l') return res(left + 'l', b, 'tPalatal', ' ');
    if (bC === 'ś') return res(left + 'c', 'ch' + b.slice(1), 'tPalatal', ' ');
  }
  const stops = { k: ['g', 'ṅ'], 'ṭ': ['ḍ', 'ṇ'], t: ['d', 'n'], p: ['b', 'm'] };
  if (stops[last]) {
    if (NASAL.includes(bC)) return res(left + stops[last][1], b, 'nasal', ' ');
    if (voiced) return res(left + stops[last][0], b, 'voicing', bV ? '' : ' ');
  }
  return res(a, b, 'none', ' ');
}

// Left fold: each new word is joined with the last space-separated token of the running text, so a fused result
// (ityapi) is treated as one word for the next junction, exactly as sandhi applies left to right.
export function joinAll(words) {
  const w = words.map((x) => String(x).trim()).filter(Boolean);
  if (!w.length) return { text: '', steps: [] };
  let text = w[0];
  const steps = [];
  for (let i = 1; i < w.length; i++) {
    // join the last word of the running text with the next word
    const sp = text.lastIndexOf(' ');
    const head = sp >= 0 ? text.slice(0, sp + 1) : '';
    const r = join(text.slice(sp + 1), w[i]);
    text = head + r.text;
    steps.push({ at: i, rule: r.rule, text });
  }
  return { text, steps };
}
