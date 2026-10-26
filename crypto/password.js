// crypto/password.js - password and passphrase generation with crypto.getRandomValues (random.js), and entropy
// estimates.
//
//   generatePassword({ length = 20, lower, upper, digits, symbols, custom = '', exclude = '', excludeSimilar = false,
//                      eachClass = true }) -> { password, entropy (bits, exact for the uniform choice) }
//   passwordGenerator({ alphabets = ['upper', 'lower', 'digits'], include = '', exclude = '', lookAlike = false,
//                       everyGroup = true, length = 20 }) -> { groups, pool, length, everyGroup, entropy, next() }
//     character groups as in KeePassXC (ALPHABETS) plus Latin-1, Cyrillic, Greek and emoji; next() returns a password
//     drawn uniformly from every string of the pool that has a character of each group (everyGroup), entropy is
//     log2 of their exact count; errors carry err.code = 'length' | 'empty' | 'short'
//   generateFromAlphabets(options) -> { password, entropy }
//   passwordGroups(options) -> [{ id, chars }] the disjoint groups after the exclusions
//   generatePassphrase({ words = 6, separator = '-', wordCase = 'lower' | 'title' | 'upper' | 'mixed', capitalize,
//                        number = false, symbol = false, list = WORDS }) -> { password, entropy, size }
//   estimateEntropy(password) -> { bits, strength: 'very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong' }
//     (a light heuristic; crypto/strength.js is the zxcvbn estimator)
//   WORDS (the built-in list of short, common English words), CHARSETS, ALPHABETS, LOOK_ALIKE, PASSPHRASE_SYMBOLS
//
// Principles:
// - Every random choice goes through random.js (OS CSPRNG, rejection sampling): no Math.random, no modulo bias.
// - Entropy is computed for the DISTRIBUTION the generator samples from, not estimated from the output string. A
//   "must contain every class" rule shrinks the space; reporting len * log2(pool) would overstate it, so the exact
//   count of admissible strings is used (inclusion-exclusion, or the BigInt DP of coverTable).
// - "Every group" sampling must stay uniform over admissible strings. The naive fix (force one char per class into
//   fixed slots, or re-draw only the failing position) biases the output; rejection or exact weighted sampling
//   does not.
// - Characters are code points (Array.from / spread), never UTF-16 units: emoji and astral letters count once.
import { randomBytes, randomInt, shuffle } from './random.js';

export const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!"#$%&\'()*+,-./:;<=>?@[\]^_`{|}~',
};
const SIMILAR = 'Il1|O0o`\'"';

// Built-in passphrase words: common, short (3-8 letters), distinct, lower case.
// Data table (one string, split once): its size sets passphrase entropy, log2(WORDS.length) bits per word. Smaller
// than EFF's 7776-word list, so use more words for the same strength.
export const WORDS = (
  'able acid acorn actor adapt adobe adult agent agile aisle alarm album alert algae alien alley alloy alpha alpine ' +
  'amber ample angle ankle anvil apple april apron arch arena argue armor army aroma arrow artist aspen atlas atom ' +
  'attic audio audit aunt autumn avid awake award axis bacon badge bagel baker balmy bamboo banana band banjo ' +
  'barley barn baron basil basin basket batch beach beacon beam bean bear beaver bench berry bike bingo birch bird ' +
  'bison blade blank blaze blend bliss block bloom blue blush board boat bonus book boost boot booth boulder bow ' +
  'brain brave bread breeze brick bridge brief brisk brook broom brush bubble bucket budget buffalo bugle bunny ' +
  'butter button cabin cable cactus cake calm camel camera camp canal candle candy canoe canvas canyon cape carbon ' +
  'cargo carpet carrot cart castle cedar cello chalk charm chart cheese cherry chess chief chimney chorus cider ' +
  'cinema circle citrus civic clam clay cliff climb clock cloud clover coach coast cobalt cocoa coconut comet comic ' +
  'compass copper coral corn cotton couch cougar cousin cradle craft crane crayon creek crisp crown crystal cube ' +
  'cup curry cycle cypress daisy dance dawn deer delta denim depot desert desk dial diary diesel dinner disco dock ' +
  'dolphin domain donkey door dough dove dragon drama dream drift drum duck dune dusk eagle earth easel echo ' +
  'eclipse elbow elder elk ember emblem empire energy engine epic equal error essay ether event exact exit fable ' +
  'fabric falcon fancy farm feast feather fence ferry fiber field fig film finch fjord flag flame flash fleet flint ' +
  'float flock flora flute focus forest forge fossil fox frame fresh frog frost fruit fudge funnel galaxy garden ' +
  'garlic gate gecko gem genius ghost giant ginger glacier glade glass globe glove glow goat gold gong goose ' +
  'gorilla grain grape graph grass gravel gravy green grid grill grove guard guest guide guitar gull gust habit ' +
  'hammer harbor harp harvest hatch hawk hazel heart hedge helmet herb hero heron hill hive hobby holly honey hood ' +
  'hook horizon horn horse hotel hound house humble hunter husky hybrid icon idea igloo image inch index ink inlet ' +
  'input iris iron island ivory ivy jacket jaguar jam jar jasmine jazz jeans jelly jet jewel jigsaw jockey joke ' +
  'journal judge juice jumbo jungle juniper jury kale kayak kernel kettle key kid kidney kind king kiosk kite ' +
  'kitten kiwi knee knight knot koala label ladder lady lagoon lake lamp lantern laptop large laser latch lava lawn ' +
  'layer leaf lemon lens leopard letter level lever lilac lily lime linen lion liquid lizard llama lobby lobster ' +
  'locket lodge logic lotus lucky lumber lunar lunch lynx lyric macaw magnet maize mango manor maple marble margin ' +
  'market marsh mask meadow medal melon memo mentor merit mesa metal meteor micro mild mill mime mineral mint ' +
  'mirror mitten mixer model mole monkey moose morning mosaic moss motor mouse muffin mule mural museum music ' +
  'mustard myth nail napkin nation nature navy nectar needle nest net nickel night ninja noble noodle north notch ' +
  'note novel nugget nurse nutmeg nylon oak oasis oat object ocean octave olive omega onion opal opera orbit orchid ' +
  'organ otter outfit oval oven owl oxygen oyster paddle pagoda palace palm panda panel panther paper parade parcel ' +
  'parrot pasta pastel patch path peach peanut pear pebble pecan pelican pencil pepper piano picnic pigeon pillow ' +
  'pilot pine pixel pizza planet plaza plum pocket poem polar pond pony poplar poppy portal potato powder prairie ' +
  'prism pumpkin puppy puzzle pyramid quail quart quartz queen quest quick quiet quill quilt quiz quota rabbit ' +
  'raccoon radar radio radish raft rain raisin ramp ranch range raven razor recipe reef relay relic remote rhino ' +
  'ribbon rice ridge ring ripple river road robin robot rocket rodeo roof rose royal ruby rudder rugby ruler rumba ' +
  'runway rustic saddle safari saga sage sail salad salmon salt sand satin sauce savanna scarf school scout sculpt ' +
  'seal season second seed shadow shark shelf shell sherpa shield ship shore shrimp sierra signal silk silver siren ' +
  'sketch skill sky slate sled slope smile snail snow sofa solar sonnet sound spark sphere spice spider spiral ' +
  'sponge spoon spring sprout squid stable stamp star statue steam steel stone storm story straw stream studio ' +
  'sugar summit sun swan sweater swift symbol table tablet taco tail talent tango tank tea teapot temple tennis ' +
  'tent thistle thunder ticket tiger timber toast token tomato tonic topaz torch totem tower track trail train tram ' +
  'travel treaty tree trend tribe trophy trout truck trumpet tulip tundra tunnel turkey turtle tuxedo twig umbrella ' +
  'uncle unicorn union unit upper urban usher utopia vacuum valley valve vanilla vapor vase vault velvet venture ' +
  'verse vessel vest violet violin visa vista vivid vocal volcano voyage wafer wagon walnut walrus wand warm wasp ' +
  'water wave wax weasel weaver wheat wheel whisper willow window winter wizard wolf wombat wonder wood wool world ' +
  'wren yacht yak yard yarn year yeast yellow yeti yoga yogurt yolk zebra zenith zephyr zero zinc zipper zodiac ' +
  'zone zoom ').trim().split(' ');

// Exact entropy of a uniform string of `len` symbols over `pool` that contains at least one symbol of each class:
// log2 of the count by inclusion-exclusion over the classes (sizes `classes`, disjoint).
// count = sum over subsets S of (-1)^|S| (pool - |S's chars|)^len; computed as a ratio to pool^len so it stays in
// double range for len up to 1024. Floating cancellation can make tiny ratios slightly wrong; MIN_VALUE guards log2.
// 2^k subsets: fine for the <= 5 classes used here.
function constrainedBits(pool, classes, len) {
  let ratio = 0;
  const k = classes.length;
  for (let mask = 0; mask < 1 << k; mask++) {
    let removed = 0, bits = 0;
    for (let i = 0; i < k; i++) if (mask & (1 << i)) { removed += classes[i]; bits++; }
    ratio += (bits % 2 ? -1 : 1) * Math.pow((pool - removed) / pool, len);
  }
  return len * Math.log2(pool) + Math.log2(Math.max(ratio, Number.MIN_VALUE));
}

export function generatePassword(opts = {}) {
  const { length = 20, lower = true, upper = true, digits = true, symbols = true, custom = '', exclude = '',
    excludeSimilar = false, eachClass = true } = opts;
  if (!(length >= 1 && length <= 1024)) throw new Error('length must be 1..1024');
  const drop = new Set([...exclude, ...(excludeSimilar ? SIMILAR : '')]);
  const seen = new Set();
  const classes = [];
  const add = (chars) => {
    const list = [...chars].filter((c) => !drop.has(c) && !seen.has(c));
    list.forEach((c) => seen.add(c));
    if (list.length) classes.push(list);
  };
  if (lower) add(CHARSETS.lower);
  if (upper) add(CHARSETS.upper);
  if (digits) add(CHARSETS.digits);
  if (symbols) add(CHARSETS.symbols);
  if (custom) add(custom);
  const pool = classes.flat();
  if (!pool.length) throw new Error('no characters to choose from');
  const need = eachClass && classes.length > 1 && length >= classes.length;
  const pick = () => Array.from({ length }, () => pool[randomInt(pool.length)]);
  let chars = pick();
  // Rejection sampling keeps the choice uniform over the strings that contain every class.
  // Acceptance is high for realistic settings (for 20 chars over the 4 ASCII classes, ~0.9), so the 10 000-try cap
  // only trips on near-impossible constraints (length = class count with a tiny class).
  // Classes are disjoint by construction (`seen`), so the inclusion-exclusion count below is exact.
  for (let tries = 0; need && !classes.every((cl) => chars.some((c) => cl.includes(c))); tries++) {
    if (tries > 10000) throw new Error('could not satisfy the character classes');
    chars = pick();
  }
  const entropy = need ? constrainedBits(pool.length, classes.map((c) => c.length), length) : length * Math.log2(pool.length);
  return { password: chars.join(''), entropy };
}

// --- passwords from alphabets ------------------------------------------------------------------------------------

const span = (a, b, skip = []) => {
  let s = '';
  for (let c = a; c <= b; c++) if (!skip.includes(c)) s += String.fromCodePoint(c);
  return s;
};

// Character groups: the classes of KeePassXC's generator (upper, lower, digits, and the special characters split into
// braces, punctuation, quotes, dashes and slashes, math, logograms; extended ASCII = Latin-1 without the no-break
// space and the soft hyphen) and other alphabets.
export const ALPHABETS = [
  { id: 'upper', chars: span(0x41, 0x5a) },
  { id: 'lower', chars: span(0x61, 0x7a) },
  { id: 'digits', chars: '0123456789' },
  { id: 'braces', chars: '()[]{}', special: true },
  { id: 'punctuation', chars: '.,:;', special: true },
  { id: 'quotes', chars: '"\'', special: true },
  { id: 'dashes', chars: '-/\\_|', special: true },
  { id: 'math', chars: '!*+<=>?', special: true },
  { id: 'logograms', chars: '#$%&@^`~', special: true },
  { id: 'latin1', chars: span(0xa1, 0xff, [0xad]), extended: true },
  { id: 'cyrillic', chars: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', extended: true },
  { id: 'greek', chars: span(0x3b1, 0x3c9, [0x3c2]) + span(0x391, 0x3a9, [0x3a2]), extended: true },
  { id: 'emoji', chars: span(0x1f600, 0x1f64f) + span(0x1f400, 0x1f43e), extended: true },
];

// KeePassXC's look-alikes (0 O 1 l I | G 6 B 8) plus o, the quotes ` ' and Latin-1 marks that pass for ASCII.
export const LOOK_ALIKE = '0Oo1lI|G6B8`\'¦¡·¸´¨°ºª¹';
// Cyrillic and Greek letters that look like a Latin letter or a digit: with look-alikes excluded only the first
// character of each shape is kept (Latin before Cyrillic before Greek).
const HOMOGLYPHS = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', З: '3', Ч: '4',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', б: '6', ё: 'ë', Ё: 'Ë',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  α: 'a', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', υ: 'u', χ: 'x', γ: 'y',
};

// Errors with a machine-readable code so the UI can localise the message instead of showing the English text.
const fail = (code, msg) => Object.assign(new Error(msg), { code });

// Groups are made disjoint in ALPHABETS order (`seen`): a character belongs to the first selected group that has
// it, so the exact counts below never double-count. With lookAlike, one representative per visual shape survives
// (`taken` keyed by the HOMOGLYPHS shape), so "A" (Latin), "А" (Cyrillic) and "Α" (Greek) cannot all appear.
export function passwordGroups(opts = {}) {
  const { alphabets = ['upper', 'lower', 'digits'], include = '', exclude = '', lookAlike = false } = opts;
  const drop = new Set(Array.from(String(exclude)));
  const seen = new Set(), taken = new Set(), groups = [];
  for (const a of ALPHABETS) {
    if (!alphabets.includes(a.id)) continue;
    const chars = [];
    for (const c of Array.from(a.chars)) {
      if (drop.has(c) || seen.has(c)) continue;
      if (lookAlike) {
        const shape = HOMOGLYPHS[c] || c;
        if (LOOK_ALIKE.includes(c) || LOOK_ALIKE.includes(shape) || taken.has(shape)) continue;
        taken.add(shape);
      }
      seen.add(c);
      chars.push(c);
    }
    if (chars.length) groups.push({ id: a.id, chars });
  }
  // Own characters form one more group (look-alikes are not removed from it: they were chosen on purpose).
  const custom = [...new Set(Array.from(String(include)))].filter((c) => !drop.has(c) && !seen.has(c) && !/\p{Cc}/u.test(c));
  if (custom.length) groups.push({ id: 'custom', chars: custom });
  return groups;
}

// log2 of a positive BigInt.
// The leading 13 hex digits (52 bits) fit a double exactly; the rest contributes 4 bits per digit. Relative error
// < 2^-52 in the mantissa: plenty for an entropy readout. (Number(n) would overflow to Infinity above ~2^1024.)
function bigLog2(n) {
  const s = n.toString(16);
  return Math.log2(parseInt(s.slice(0, 13), 16)) + 4 * Math.max(0, s.length - 13);
}
// Uniform BigInt in [0, n).
// Rejection with a bit mask: draw exactly bitlen(n) random bits, retry when >= n. Acceptance > 1/2 per draw, so the
// expected number of draws is < 2 and no value is biased (unlike reducing a wider draw modulo n).
function randomBelow(n) {
  const bits = n.toString(2).length, bytes = Math.ceil(bits / 8), mask = 0xff >> (bytes * 8 - bits);
  for (;;) {
    const b = randomBytes(bytes);
    b[0] &= mask;
    const x = BigInt('0x' + Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(''));
    if (x < n) return x;
  }
}

// N[j][r]: strings of length r over groups j..k-1 that use every one of them (exact, BigInt):
// N[j][r] = sum over c >= 1 of C(r, c) * size_j^c * N[j+1][r-c].
// (choose which c positions get group j, fill them from group j, recurse on the rest.) BigInt because counts reach
// pool^L (e.g. ~2^130 for 20 characters of 94): doubles would round, breaking exact uniform sampling. O(k L^2)
// BigInt multiplications, which is why the DP is limited to L <= COVER_DP_MAX.
function coverTable(sizes, L) {
  const k = sizes.length;
  const C = [[1n]];
  for (let r = 1; r <= L; r++) {
    const row = [1n];
    for (let c = 1; c < r; c++) row.push(C[r - 1][c - 1] + C[r - 1][c]);
    row.push(1n);
    C.push(row);
  }
  const pow = sizes.map((s) => { const p = [1n], b = BigInt(s); for (let c = 1; c <= L; c++) p.push(p[c - 1] * b); return p; });
  const N = Array.from({ length: k + 1 }, () => new Array(L + 1).fill(0n));
  N[k][0] = 1n;
  for (let j = k - 1; j >= 0; j--) {
    const rest = k - j - 1;
    for (let r = rest + 1; r <= L; r++) {
      let sum = 0n;
      for (let c = 1; c <= r - rest; c++) sum += C[r][c] * pow[j][c] * N[j + 1][r - c];
      N[j][r] = sum;
    }
  }
  return { C, pow, N };
}

// A uniform string of length L that uses every group: the number of characters of each group is drawn with its
// exact weight, the group of each position is a uniform arrangement of those counts, the characters are uniform
// within their groups.
// Inverse-CDF walk: u uniform in [0, N[j][r]) selects c with probability proportional to its term. The last
// group's loop never breaks (all terms with c < r are 0 there) and ends with c = r, as required. The shuffle then
// places the labels uniformly among positions - valid because the C(r, c) factor already counted arrangements.
function sampleCover(groups, { C, pow, N }, L) {
  const labels = [];
  let r = L;
  for (let j = 0; j < groups.length; j++) {
    let u = randomBelow(N[j][r]);
    let c = 1;
    for (; c < r; c++) {
      const w = C[r][c] * pow[j][c] * N[j + 1][r - c];
      if (u < w) break;
      u -= w;
    }
    for (let t = 0; t < c; t++) labels.push(j);
    r -= c;
  }
  shuffle(labels);
  return labels.map((j) => groups[j].chars[randomInt(groups[j].chars.length)]).join('');
}

// Above this length the BigInt DP gets slow (quadratic in L per group) while rejection sampling becomes almost free
// (the chance of missing a group falls exponentially with L).
const COVER_DP_MAX = 128;

export function passwordGenerator(opts = {}) {
  const { length = 20, everyGroup = true } = opts;
  if (!(Number.isInteger(length) && length >= 1 && length <= 1024)) throw fail('length', 'length must be 1..1024');
  const groups = passwordGroups(opts);
  const pool = groups.flatMap((g) => g.chars);
  if (!pool.length) throw fail('empty', 'no characters to choose from');
  const each = everyGroup && groups.length > 1;
  if (each && length < groups.length) throw Object.assign(fail('short', `length must be at least ${groups.length} (one character of each group)`), { min: groups.length });
  const any = () => { let s = ''; for (let i = 0; i < length; i++) s += pool[randomInt(pool.length)]; return s; };
  let entropy, next;
  if (!each) {
    entropy = length * Math.log2(pool.length);
    next = any;
  } else if (length <= COVER_DP_MAX) {
    const table = coverTable(groups.map((g) => g.chars.length), length);
    entropy = bigLog2(table.N[0][length]);
    next = () => sampleCover(groups, table, length);
  } else {
    // Long passwords: rejection sampling (almost every string already uses every group); inclusion-exclusion count.
    const sizes = groups.map((g) => g.chars.length), P = pool.length;
    let ratio = 0;
    for (let mask = 0; mask < 1 << sizes.length; mask++) {
      let removed = 0, odd = 0;
      for (let i = 0; i < sizes.length; i++) if (mask & (1 << i)) { removed += sizes[i]; odd ^= 1; }
      ratio += (odd ? -1 : 1) * ((P - removed) / P) ** length;
    }
    entropy = length * Math.log2(P) + Math.log2(ratio);
    const sets = groups.map((g) => new Set(g.chars));
    next = () => {
      for (let tries = 0; tries < 1e5; tries++) {
        const s = any(), cs = Array.from(s);
        if (sets.every((set) => cs.some((c) => set.has(c)))) return s;
      }
      throw fail('short', 'could not satisfy the character groups');
    };
  }
  return { groups, pool: pool.length, length, everyGroup: each, entropy, next };
}

export function generateFromAlphabets(opts = {}) {
  const g = passwordGenerator(opts);
  return { password: g.next(), entropy: g.entropy };
}

// --- passphrases --------------------------------------------------------------------------------------------------

export const PASSPHRASE_SYMBOLS = '!#$%&*+=?@^~';

// Words are lower-cased and de-duplicated. Entropy: words x log2(list size), + words x log2(3) for mixed case (each
// word lower, Title or UPPER), + log2(10 x words) for a digit and log2(12 x words) for a symbol appended to a random
// word; exact when the words are distinct strings of two or more letters.
export function generatePassphrase(opts = {}) {
  const { words = 6, separator = '-', capitalize = false, number = false, symbol = false, list = WORDS } = opts;
  const wordCase = opts.wordCase || (capitalize ? 'title' : 'lower');
  if (!(words >= 1 && words <= 64)) throw fail('length', 'words must be 1..64');
  // De-duplication matters for entropy: a list with repeats would make some words likelier and the reported
  // log2(size) an overestimate.
  // KNOWN DEFECT (entropy overstatement in corner cases): words are not checked against the separator or for being
  // concatenations of other words, so with a custom list containing the separator inside words, or any list with
  // separator '' ("sun" + "flower" vs "sunflower"), different choices can produce the same string and the reported
  // entropy is too high. Fix: reject list words containing the separator; warn when separator is '' (prefix-free check).
  const dict = list === WORDS ? WORDS : [...new Set(Array.from(list, (w) => String(w).trim().toLowerCase()).filter(Boolean))];
  if (dict.length < 2) throw fail('empty', 'the word list needs at least two words');
  const title = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const CASES = { lower: (w) => w, upper: (w) => w.toUpperCase(), title };
  const parts = Array.from({ length: words }, () => {
    const w = dict[randomInt(dict.length)];
    if (wordCase === 'mixed') return [CASES.lower, CASES.title, CASES.upper][randomInt(3)](w);
    return (CASES[wordCase] || CASES.lower)(w);
  });
  let entropy = words * Math.log2(dict.length);
  if (wordCase === 'mixed') entropy += words * Math.log2(3);
  if (number) {
    // A digit appended to one of the words: 10 digits x `words` positions.
    const i = randomInt(parts.length);
    parts[i] += String(randomInt(10));
    entropy += Math.log2(10 * words);
  }
  if (symbol) {
    const i = randomInt(parts.length);
    parts[i] += PASSPHRASE_SYMBOLS[randomInt(PASSPHRASE_SYMBOLS.length)];
    entropy += Math.log2(PASSPHRASE_SYMBOLS.length * words);
  }
  return { password: parts.join(separator), entropy, size: dict.length };
}

// The most common leaked passwords (and their stems before trailing digits / symbols) are worth almost nothing.
const COMMON = new Set(('password passw0rd p@ssword qwerty qwertyuiop azerty 123456 1234567 12345678 123456789 1234567890 ' +
  'letmein welcome admin administrator iloveyou monkey dragon football baseball sunshine princess shadow master ' +
  'superman batman trustno1 abc123 qwerty123 starwars hello freedom whatever login secret').split(' '));

// Bit thresholds (upper bounds, exclusive). Coarse UI buckets for this heuristic only; strength.js uses KeePassXC's
// thresholds on its own estimate.
const STRENGTH = [[28, 'very-weak'], [36, 'weak'], [60, 'fair'], [128, 'strong'], [Infinity, 'very-strong']];
export const strengthOf = (bits) => STRENGTH.find(([max]) => bits < max)[1];

// Character-pool estimate with penalties for repeats, sequences and keyboard runs, and a word-list estimate for
// passphrases of the built-in words; the lower of the two applies.
// A quick, synchronous meter for typing feedback (no dictionaries to decode); strength.js is the real estimator.
// It can only lower the pool estimate via penalties, never raise it: an estimator should err toward "weak".
export function estimateEntropy(password) {
  const s = String(password || '');
  if (!s) return { bits: 0, strength: 'very-weak' };
  const chars = [...s];
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/[0-9]/.test(s)) pool += 10;
  if (/[!-/:-@[-`{-~ ]/.test(s)) pool += 33;
  if (/[^\x00-\x7f]/.test(s)) pool += 100;
  const per = Math.log2(Math.max(pool, 2));
  let bits = 0;
  const kb = 'qwertyuiopasdfghjklzxcvbnm1234567890';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], p = chars[i - 1], q = chars[i - 2];
    const cc = c.codePointAt(0), pc = p ? p.codePointAt(0) : -9;
    const seq = p && Math.abs(cc - pc) === 1 && q && cc - pc === pc - q.codePointAt(0);
    const key = p && kb.includes(p.toLowerCase() + c.toLowerCase());
    if (c === p) bits += 1;                    // repeated character
    else if (seq || key) bits += 1.5;          // abc, 321, qwe
    else if (chars.indexOf(c) < i) bits += per * 0.75; // reused character
    else bits += per;
  }
  // Passphrase of known words: words x log2(list size) (+ separators carry little entropy).
  const stem = s.toLowerCase().replace(/[^a-z0-9@]+$/, '').replace(/[0-9]{1,4}$/, '');
  if (COMMON.has(s.toLowerCase()) || COMMON.has(stem)) bits = Math.min(bits, 10);
  const parts = s.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (parts.length >= 2 && parts.every((w) => WORDS.includes(w))) bits = Math.min(bits, parts.length * Math.log2(WORDS.length) + 4);
  return { bits, strength: strengthOf(bits) };
}
