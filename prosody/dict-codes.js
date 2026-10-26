// prosody/dict-codes.js - the one-character codes of the ARPAbet phonemes in dict-en.js and their IPA values.
//
//   ARPA_CODE: { 'AA': 'a', … }   CODE_ARPA: { a: 'AA', … }   ARPA_IPA: { AA: 'ɑ', … }   VOWELS_ARPA: Set

export const ARPA_CODE = {
  // vowels
  AA: 'a', AE: 'x', AH: 'u', AO: 'o', AW: 'A', AY: 'Y', EH: 'e', ER: 'R', EY: 'E', IH: 'i', IY: 'I', OW: 'O', OY: 'Q', UH: 'U', UW: 'W',
  // consonants
  B: 'b', CH: 'C', D: 'd', DH: 'D', F: 'f', G: 'g', HH: 'h', JH: 'J', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'N', P: 'p', R: 'r',
  S: 's', SH: 'S', T: 't', TH: 'T', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'Z',
};
export const CODE_ARPA = Object.fromEntries(Object.entries(ARPA_CODE).map(([k, v]) => [v, k]));
export const VOWELS_ARPA = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

// General American values; AH unstressed is ə, ER unstressed ɚ (phon-en.js picks them).
export const ARPA_IPA = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ',
  S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
