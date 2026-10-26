// lingua/pinyin.js - Mandarin pinyin: tone numbers <-> tone marks, a syllable split into initial, final and tone.
//
//   marked('ni3 hao3') -> 'nǐ hǎo'      numbered('nǐ hǎo') -> 'ni3 hao3'
//   parse('zhōng') -> { initial: 'zh', final: 'ong', tone: 1, plain: 'zhong' }
//   INITIALS, TONES: [{ n, contour, ru, en }]

//
// Pure string functions. Input is forgiving (v and u: for ü, upper case, digit 5 or no mark for the neutral tone)
// because learners type pinyin on plain keyboards.

// Order matters: zh ch sh before z c s, so find() over startsWith picks the longest initial. y and w are spelling
// devices, not consonants; parse() maps them back to i / u in `sound`.
export const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
const MARKS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ' };
// Reverse map derived from MARKS (marked vowel -> [plain vowel, tone]), so the two cannot drift apart.
const UNMARK = {};
for (const [v, m] of Object.entries(MARKS)) [...m].forEach((c, i) => { UNMARK[c] = [v, i + 1]; });

export const TONES = [
  { n: 1, contour: '55', ru: 'ровный высокий', en: 'high level', ja: '高く平ら' },
  { n: 2, contour: '35', ru: 'восходящий', en: 'rising', ja: '上がる' },
  { n: 3, contour: '214', ru: 'нисходяще-восходящий (низкий)', en: 'dipping (low)', ja: '下がって上がる（低い）' },
  { n: 4, contour: '51', ru: 'резко нисходящий', en: 'falling', ja: '急に下がる' },
  { n: 5, contour: '—', ru: 'нейтральный (лёгкий, безударный)', en: 'neutral (light)', ja: '軽声' },
];

// The vowel that carries the mark (standard rule): a or e when present (they never co-occur); o in ou; otherwise the
// last vowel, which yields liù / guì for iu / ui without a special case.
function markSyllable(syl, tone) {
  const s = syl.replace(/v/g, 'ü').replace(/u:/g, 'ü');
  if (!tone || tone === 5) return s;
  let idx = s.search(/[ae]/);
  if (idx < 0) idx = s.indexOf('ou');
  if (idx < 0) { for (let i = s.length - 1; i >= 0; i--) if ('iouü'.includes(s[i])) { idx = i; break; } }
  if (idx < 0) return s;
  return s.slice(0, idx) + MARKS[s[idx]][tone - 1] + s.slice(idx + 1);
}

// A syllable is a letter run directly followed by a tone digit; runs without a digit pass through untouched, so
// mixed text ('ni3 hao3!') survives.
export function marked(text) {
  return String(text).replace(/([a-zA-Zü:]+)([1-5])/g, (_, syl, n) => markSyllable(syl.toLowerCase(), +n));
}

// Inverse: every letter run gets a digit; a run with no marked vowel is neutral (5). ü is written v (the ASCII
// convention). Caveat: a word written solid (nǐhǎo) collapses into one trailing digit (last tone wins); syllable
// segmentation is out of scope here.
export function numbered(text) {
  return String(text).replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+/gi, (w) => {
    let tone = 0, plain = '';
    for (const c of w.toLowerCase()) { if (UNMARK[c]) { plain += UNMARK[c][0]; tone = UNMARK[c][1]; } else plain += c; }
    return plain.replace(/ü/g, 'v') + (tone || 5);
  });
}

// One syllable -> parts. The `plain.length > i.length` guard keeps a syllable that is only an initial-looking letter
// (interjections n, m) as a final, not an initial with an empty final. `sound` is the pronounced final with the
// orthographic rules undone; `final` is the spelled one.
export function parse(syl) {
  let tone = 5, plain = '';
  for (const c of String(syl).toLowerCase()) { if (UNMARK[c]) { plain += UNMARK[c][0]; tone = UNMARK[c][1]; } else if (/[1-5]/.test(c)) tone = +c; else plain += c; }
  const initial = INITIALS.find((i) => plain.startsWith(i) && plain.length > i.length) || '';
  let final = plain.slice(initial.length);
  // spelling rules: y / w stand for i / u (yi = i, wu = u), j q x + u = ü
  let sound = final;
  if (initial === 'y') sound = final.startsWith('i') ? final : 'i' + final;
  if (initial === 'w') sound = final.startsWith('u') ? final : 'u' + final;
  if ('jqx'.includes(initial) && initial && final.startsWith('u')) sound = 'ü' + final.slice(1);
  return { initial, final, sound, tone, plain };
}

// Third-tone sandhi: a third tone before another third tone is read as a second (nǐ hǎo -> ní hǎo).
// Right to left, so 3-3-3 becomes 2-2-3, the default reading; real speech depends on prosodic grouping (3-3-3 may
// also be read 3-2-3), which a flat tone list cannot know.
export function toneSandhi(tones) {
  const t = [...tones];
  for (let i = t.length - 2; i >= 0; i--) if (t[i] === 3 && t[i + 1] === 3) t[i] = 2;
  return t;
}
