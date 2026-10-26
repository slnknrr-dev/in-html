// sudoku/symbols.js - the alphabets a grid can be shown in. Puzzles always hold the numbers 1..n; an alphabet only
// changes what is drawn and typed (number k is the k-th symbol), so arithmetic clues keep their meaning: with letters
// A = 1, B = 2, … (the app shows a legend).
//
//   ALPHABETS[id] = { id, kind: 'text' | 'color', symbols: [...] (the longest list), max }
//   symbolsFor(id, n, custom?) -> [{ text, color? }] × n      (throws when the alphabet is too short)
//   parseCustom(text, n) -> { ok, symbols, error: 'count' | 'duplicate' | 'long' | 'empty', count }
//   keyMap(symbols) -> Map(key -> number)                     typed keys: the symbol itself, then digits 1-9, 0 = 10
//   graphemes(text) -> [string]

const seq = (s) => [...s];

// Alphabets are display-only; the model always uses numbers 1..n. Lists are spread with [...s] (code points) so
// astral characters count as one symbol; emoji lists are written as arrays because some are multi-code-point
// sequences that [...s] would split.
export const ALPHABETS = {
  // digits and hex go on up to 64 symbols (Q-Z, then lowercase letters, then signs); the first 25 never change
  digits: { kind: 'text', symbols: seq('123456789ABCDEFGHIJKLMNOP' + 'QRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#&') },
  hex: { kind: 'text', symbols: seq('0123456789ABCDEFGHIJKLMNO' + 'PQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#') },
  latin: { kind: 'text', symbols: seq('ABCDEFGHIJKLMNOPQRSTUVWXY') },
  greek: { kind: 'text', symbols: seq('ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ') },
  cyrillic: { kind: 'text', symbols: seq('АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ') },
  georgian: { kind: 'text', symbols: seq('აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ') },
  hiragana: { kind: 'text', symbols: seq('あいうえおかきくけこさしすせそたちつてとなにぬねの') },
  roman: { kind: 'text', symbols: 'I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX XXI XXII XXIII XXIV XXV'.split(' ') },
  shapes: { kind: 'text', symbols: seq('●■▲◆★♥♠♣✚⬟⬢◐▼◀▶✦✿❖☀☾♪⚑✈☂⌘') },
  fruit: { kind: 'text', symbols: ['🍎', '🍊', '🍋', '🍇', '🍉', '🍓', '🍒', '🍑', '🍍', '🥝', '🥥', '🍌', '🍐', '🫐', '🍈', '🥭', '🍅', '🥑', '🌽', '🥕', '🍆', '🥦', '🥔', '🧅', '🍄'] },
  animals: { kind: 'text', symbols: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦉', '🐺', '🐗', '🐴', '🦄'] },
  colors: {
    kind: 'color',
    symbols: ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#00acc1', '#ec407a', '#7cb342', '#3949ab', '#f4511e',
      '#26a69a', '#c0ca33', '#5e35b1', '#ffb300', '#546e7a', '#d81b60', '#00897b', '#8d6e63', '#9e9d24', '#0277bd', '#ad1457', '#4e342e', '#212121'],
  },
};
for (const [id, a] of Object.entries(ALPHABETS)) { a.id = id; a.max = a.symbols.length; }

// Intl.Segmenter gives user-perceived characters (flags, ZWJ emoji, combining marks); the code-point fallback is only approximate.
export function graphemes(text) {
  const s = String(text ?? '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
  return [...s];
}

export function symbolsFor(id, n, custom = null) {
  if (id === 'custom') {
    const r = parseCustom(custom || '', n);
    if (!r.ok) throw new Error('custom alphabet: ' + r.error);
    return r.symbols.map((text) => ({ text }));
  }
  const a = ALPHABETS[id] || ALPHABETS.digits;
  if (a.max < n) throw new Error(`alphabet ${a.id} has only ${a.max} symbols`);
  // digits: 1-9 for n <= 9; for larger grids 1-9 then letters (hex: 0-9 then letters, numbering from 0)
  const list = a.symbols.slice(0, n);
  return a.kind === 'color' ? list.map((color, i) => ({ text: String(i + 1), color })) : list.map((text) => ({ text }));
}

// Custom symbols: separated by spaces or commas, or one symbol per character (grapheme) when there are no separators.
// Validation order gives the most actionable error first: too long, then duplicates, then count. NFC normalization
// makes "e + combining accent" and the precomposed letter the same symbol, so duplicates are found.
export function parseCustom(text, n) {
  const s = String(text ?? '').trim();
  if (!s) return { ok: false, error: 'empty', count: 0, symbols: [] };
  const parts = /[\s,;]/.test(s) ? s.split(/[\s,;]+/).filter(Boolean) : graphemes(s);
  const symbols = parts.map((p) => p.normalize('NFC'));
  if (symbols.some((p) => graphemes(p).length > 3)) return { ok: false, error: 'long', count: symbols.length, symbols };
  if (new Set(symbols).size !== symbols.length) return { ok: false, error: 'duplicate', count: symbols.length, symbols };
  if (symbols.length !== n) return { ok: false, error: 'count', count: symbols.length, symbols };
  return { ok: true, symbols, count: n };
}

// Typed keys: if the alphabet contains both cases of a letter (digits above 35 do), keys stay case-sensitive;
// otherwise both cases map, so Caps Lock does not matter. Digit keys 1-9 / 0 = 10 are fallbacks that never shadow
// a symbol key.
export function keyMap(symbols) {
  const map = new Map();
  // both cases among the symbols (digits above 35): keys are case-sensitive
  const texts = new Set(symbols.map((s) => s.text));
  const cased = symbols.some((s) => s.text !== s.text.toLowerCase() && texts.has(s.text.toLowerCase()));
  symbols.forEach((s, i) => {
    const t = s.text;
    if (s.color || graphemes(t).length !== 1) return;
    for (const k of cased ? [t] : [t, t.toLowerCase(), t.toUpperCase()]) if (!map.has(k)) map.set(k, i + 1);
  });
  for (let d = 1; d <= Math.min(9, symbols.length); d++) if (!map.has(String(d))) map.set(String(d), d);
  if (symbols.length >= 10 && !map.has('0')) map.set('0', 10);
  return map;
}

// Arithmetic clues refer to numbers: a legend is needed when the symbols are not those numbers.
export const needsLegend = (symbols) => symbols.some((s, i) => s.color || s.text !== String(i + 1));
