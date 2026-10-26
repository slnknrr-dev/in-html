// lingua/translit.js - official romanisations of Georgian, Russian and Ukrainian and ASCII URL slugs from text in any
// mix of these scripts and Latin.
//
//   romanizeKa(text, { apostrophes = true }) -> Latin       Georgian national system (2002); without apostrophes as
//                                                           on passports and road signs (კ k, ყ q, წ ts …)
//   kaFromLatin(text) -> Georgian                           the inverse for the national system (k' = კ, k = ქ)
//   romanizeRu(text) -> Latin                               ICAO Doc 9303 (Russian passports since 2014)
//   romanizeUk(text) -> Latin                               Ukrainian KMU 2010 (resolution no. 55)
//   romanize(text, { lang = 'auto', apostrophes }) -> Latin  Georgian letters by the national system, Cyrillic as
//                                                           Ukrainian ('uk') or Russian ('ru'); 'auto': Ukrainian when
//                                                           the text has і ї є ґ
//   slugify(text, { lang, max = 60, sep = '-' }) -> 'tbilisi-rustaveli-12'   ASCII only; '' when nothing is left
//
// Case is kept: a capital gives a capitalised group (Щука -> Shchuka), a word in capitals stays in capitals
// (ЩУКА -> SHCHUKA). Letters of other scripts pass through unchanged. kartuli.js translit and russian.js translit
// are readable learner schemes; kartuli-input.js convert reads loose Latin spellings of Georgian with a lexicon.

// Georgian national system table. Ejectives carry the apostrophe; romanizeKa strips it on demand, which is why the
// passport form is lossy (კ and ქ both become k) and kaFromLatin needs the apostrophe form.
const KA = {
  'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z', 'თ': 't', 'ი': 'i', 'კ': "k'", 'ლ': 'l', 'მ': 'm', 'ნ': 'n',
  'ო': 'o', 'პ': "p'", 'ჟ': 'zh', 'რ': 'r', 'ს': 's', 'ტ': "t'", 'უ': 'u', 'ფ': 'p', 'ქ': 'k', 'ღ': 'gh', 'ყ': "q'", 'შ': 'sh',
  'ჩ': 'ch', 'ც': 'ts', 'ძ': 'dz', 'წ': "ts'", 'ჭ': "ch'", 'ხ': 'kh', 'ჯ': 'j', 'ჰ': 'h',
};
// Mtavruli capitals (U+1C90…) are the Mkhedruli letters (U+10D0…) written large.
const MTAVRULI = 0x1c90 - 0x10d0;
const RE_KA = /[ა-ჰᲐ-Ჰ]/g;

// Mtavruli is folded to Mkhedruli by a constant offset (the blocks are parallel), then the result is uppercased:
// one table serves both cases. Archaic letters in the range but not in KA pass through.
export function romanizeKa(text, { apostrophes = true } = {}) {
  return String(text).replace(RE_KA, (c) => {
    const code = c.charCodeAt(0);
    const cap = code >= 0x1c90;
    const t = KA[cap ? String.fromCharCode(code - MTAVRULI) : c];
    if (t == null) return c;
    const s = apostrophes ? t : t.replace("'", '');
    return cap ? s.toUpperCase() : s;
  });
}

const KA_BACK = Object.fromEntries(Object.entries(KA).map(([k, v]) => [v, k]));
// Longest units first: ts' ch' before ts ch before t c.
const RE_KA_LAT = /ts'|ch'|[kptq]'|zh|gh|sh|ch|ts|dz|kh|[a-z]/g;

// Typographic apostrophes are normalised to ASCII first so pasted text works. A bare q (no apostrophe) is still read
// as ყ: the system has no plain q, so the only sensible reading is the ejective.
export function kaFromLatin(text) {
  return String(text).replace(/[’ʼ`]/g, "'").replace(/[A-Za-z]+(?:'[A-Za-z]*)*/g, (w) =>
    w.toLowerCase().replace(RE_KA_LAT, (u) => KA_BACK[u] ?? (u === 'q' ? 'ყ' : u)));
}

// ICAO 9303: ё e, й i, х kh, ц ts, щ shch, ъ ie, ь omitted, ю iu, я ia.
const ICAO = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'i', 'к': 'k', 'л': 'l',
  'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch',
  'ш': 'sh', 'щ': 'shch', 'ъ': 'ie', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'iu', 'я': 'ia',
};
// KMU 2010: г h, ґ g, и y, і i; є ї й ю я are ye yi y yu ya at the start of a word and ie i i iu ia inside it;
// зг is zgh (not zh); ь and the apostrophe are omitted.
const KMU = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'к': 'k', 'л': 'l',
  'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch',
  'ш': 'sh', 'щ': 'shch', 'ь': '', "'": '', '’': '', 'ʼ': '',
};
const KMU_START = { 'є': 'ye', 'ї': 'yi', 'й': 'y', 'ю': 'yu', 'я': 'ya' };
const KMU_MID = { 'є': 'ie', 'ї': 'i', 'й': 'i', 'ю': 'iu', 'я': 'ia' };

// Words of Cyrillic letters (apostrophes inside a word belong to it: п'ять, Знам'янка).
const RE_CYR_WORD = /[Ѐ-ӿ](?:[Ѐ-ӿ]|['’ʼ](?=[Ѐ-ӿ]))*/g;

// Case transfer for multi-letter outputs: whole word in capitals -> all caps (ЩУКА -> SHCHUKA); a capital letter in a
// mixed word -> capitalise only the first output letter (Щука -> Shchuka, not SHCHuka).
function caseLike(src, out, allCaps) {
  if (!out) return out;
  if (allCaps) return out.toUpperCase();
  return src !== src.toLowerCase() ? out[0].toUpperCase() + out.slice(1) : out;
}

// Word-at-a-time because KMU depends on position (word-initial є ї й ю я) and case needs the whole word. A one-letter
// word is never "all caps", so 'Я' gives 'Ia', not 'IA'.
function romanizeWord(word, uk) {
  const letters = word.replace(/['’ʼ]/g, '');
  const allCaps = letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const chars = Array.from(word);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], l = c.toLowerCase();
    let t;
    if (uk) {
      if (l === 'з' && chars[i + 1] && chars[i + 1].toLowerCase() === 'г') {
        out += caseLike(c, 'z', allCaps) + caseLike(chars[i + 1], 'gh', allCaps);
        i++;
        continue;
      }
      t = KMU_START[l] ? (i === 0 ? KMU_START[l] : KMU_MID[l]) : KMU[l];
    } else t = ICAO[l];
    out += t == null ? c : caseLike(c, t, allCaps);
  }
  return out;
}

export const romanizeRu = (text) => String(text).replace(RE_CYR_WORD, (w) => romanizeWord(w, false));
export const romanizeUk = (text) => String(text).replace(RE_CYR_WORD, (w) => romanizeWord(w, true));

// Georgian first (it never collides with Cyrillic). 'auto' detects Ukrainian only by letters Russian lacks; a
// Ukrainian text without і ї є ґ is romanised as Russian (unavoidable without a lexicon).
export function romanize(text, { lang = 'auto', apostrophes = true } = {}) {
  const s = romanizeKa(text, { apostrophes });
  const uk = lang === 'uk' || (lang === 'auto' && /[іїєґІЇЄҐ]/.test(s));
  return uk ? romanizeUk(s) : romanizeRu(s);
}

// Latin letters that do not decompose into a base letter and marks.
const LATIN_EXTRA = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ħ': 'h' };

// Pipeline: romanise (no apostrophes) -> NFKD and strip marks (é -> e) -> fold the non-decomposing letters -> every
// non [a-z0-9] run becomes one sep -> trim sep, cut, trim again. sep is regex-escaped because it is user-supplied.
export function slugify(text, { lang = 'auto', max = 60, sep = '-' } = {}) {
  let s = romanize(String(text ?? ''), { lang, apostrophes: false }).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
  s = s.replace(/[ßæœøłđðþıħ]/g, (c) => LATIN_EXTRA[c]).replace(/['’ʼ`]/g, '');
  const e = sep.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  s = s.replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^(?:${e})+|(?:${e})+$`, 'g'), '');
  if (s.length > max) s = s.slice(0, max).replace(new RegExp(`(?:${e})+$`), '');
  return s;
}
