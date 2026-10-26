// hdkey/bip39.js - BIP-39 mnemonic codes: entropy <-> words with the SHA-256 checksum, the official word lists, seeds
// (PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic" + passphrase, both NFKD-normalised), word completion and the
// detection of the list a phrase is written in.
//
//   generateMnemonic(words = 12 | 15 | 18 | 21 | 24, wordlist = english) -> string        CSPRNG entropy
//   entropyToMnemonic(entropy, wordlist) -> string     mnemonicToEntropy(mnemonic, wordlist) -> Uint8Array
//   validateMnemonic(mnemonic, wordlist) -> boolean    checkMnemonic(mnemonic, wordlist) -> { ok, error, words, bad }
//   mnemonicToSeed(mnemonic, passphrase = '') -> Uint8Array(64)        mnemonicToSeedAsync(..., { onProgress, signal })
//   wordlistOf(mnemonic, lists = WORDLISTS) -> name | null              completeWord(prefix, wordlist) -> [words]
//   expandWords(mnemonic, wordlist) -> words (unique prefixes of 4+ letters completed)
//   WORDLISTS: { english, japanese, korean, spanish, chinese_simplified, chinese_traditional, french, italian, czech,
//   portuguese } -> 2048 words (only this module's importers that use WORDLISTS carry every list)
//
// Phrases are joined with spaces, Japanese with the ideographic space U+3000; input may use any whitespace.
//
// Normalization: every comparison and both PBKDF2 inputs use NFKD, as BIP-39 mandates. Without it the same phrase
// typed on two keyboards (precomposed é vs e + accent, full-width vs ASCII) would yield different seeds.
// Bit handling uses binary strings, not bit arithmetic: entropy is at most 264 bits, so clarity wins over speed.
import { sha256, sha512 } from '../crypto/sha2.js';
import { pbkdf2, pbkdf2Async } from '../crypto/kdf.js';
import { randomBytes } from '../crypto/random.js';
import { utf8ToBytes } from '../crypto/encoding.js';
import english from './wordlist-english.js';
import japanese from './wordlist-japanese.js';
import korean from './wordlist-korean.js';
import spanish from './wordlist-spanish.js';
import chineseSimplified from './wordlist-chinese-simplified.js';
import chineseTraditional from './wordlist-chinese-traditional.js';
import french from './wordlist-french.js';
import italian from './wordlist-italian.js';
import czech from './wordlist-czech.js';
import portuguese from './wordlist-portuguese.js';

export { english };

export const WORDLISTS = {
  english, japanese, korean, spanish, chinese_simplified: chineseSimplified, chinese_traditional: chineseTraditional,
  french, italian, czech, portuguese,
};

const nfkd = (s) => String(s).normalize('NFKD');
const splitWords = (m) => nfkd(m).trim().split(/[\s　]+/).filter(Boolean);
// The Japanese list (first word あいこくしん) joins with U+3000; comparing the word keeps the other lists out of bundles.
const joinWords = (words, list) => words.join(list[0] === 'あいこくしん' ? '　' : ' ');

// word (NFKD) -> index, per list.
// WeakMap keyed by the list array: built once per list, released if the list module is ever unloaded.
const INDEX = new WeakMap();
function indexOf(list) {
  let m = INDEX.get(list);
  if (!m) {
    if (!Array.isArray(list) || list.length !== 2048) throw new Error('a word list has 2048 words');
    m = new Map(list.map((w, i) => [nfkd(w), i]));
    INDEX.set(list, m);
  }
  return m;
}

export function entropyToMnemonic(entropy, wordlist = english) {
  const e = entropy instanceof Uint8Array ? entropy : Uint8Array.from(entropy);
  if (e.length < 16 || e.length > 32 || e.length % 4) throw new Error('entropy must be 16, 20, 24, 28 or 32 bytes');
  indexOf(wordlist);
  // ENT / 32 checksum bits: 4 for 128-bit entropy (12 words) up to 8 for 256-bit (24 words); words = (ENT + CS) / 11.
  const cs = e.length / 4; // checksum bits
  const hash = sha256(e);
  let bits = '';
  for (const b of e) bits += b.toString(2).padStart(8, '0');
  bits += [...hash.subarray(0, 1 + (cs >> 3))].map((b) => b.toString(2).padStart(8, '0')).join('').slice(0, cs);
  const words = [];
  for (let i = 0; i < bits.length; i += 11) words.push(wordlist[parseInt(bits.slice(i, i + 11), 2)]);
  return joinWords(words, wordlist);
}

const WORD_COUNTS = [12, 15, 18, 21, 24];

export function generateMnemonic(words = 12, wordlist = english) {
  if (!WORD_COUNTS.includes(words)) throw new Error('a mnemonic has 12, 15, 18, 21 or 24 words');
  return entropyToMnemonic(randomBytes((words / 3) * 4), wordlist);
}

// Every word must be in the list, the count 12..24 in steps of 3, the checksum right. The result says what is wrong:
// { ok, error: null | 'count' | 'word' | 'checksum', words, bad: [indexes of unknown words], entropy? }.
// Check order is unknown word, then count, then checksum: the most actionable error for a user typing a phrase.
// Words are matched exactly after NFKD (no case folding): BIP-39 lists are lower case and the seed is computed from
// the phrase as typed, so accepting 'Abandon' here would validate a phrase whose seed differs.
export function checkMnemonic(mnemonic, wordlist = english) {
  const words = splitWords(mnemonic);
  const idx = indexOf(wordlist);
  const bad = words.map((w, i) => (idx.has(w) ? -1 : i)).filter((i) => i >= 0);
  if (bad.length) return { ok: false, error: 'word', words, bad };
  if (!WORD_COUNTS.includes(words.length)) return { ok: false, error: 'count', words, bad };
  let bits = '';
  for (const w of words) bits += idx.get(w).toString(2).padStart(11, '0');
  const cs = words.length / 3;
  const ent = bits.slice(0, bits.length - cs);
  const entropy = new Uint8Array(ent.length / 8);
  for (let i = 0; i < entropy.length; i++) entropy[i] = parseInt(ent.slice(i * 8, i * 8 + 8), 2);
  const want = [...sha256(entropy).subarray(0, 1)].map((b) => b.toString(2).padStart(8, '0')).join('').slice(0, cs);
  if (want !== bits.slice(-cs)) return { ok: false, error: 'checksum', words, bad };
  return { ok: true, error: null, words, bad, entropy };
}

export function mnemonicToEntropy(mnemonic, wordlist = english) {
  const r = checkMnemonic(mnemonic, wordlist);
  if (!r.ok) throw new Error(r.error === 'word' ? `unknown word "${r.words[r.bad[0]]}"` : r.error === 'count' ? 'wrong number of words' : 'checksum mismatch');
  return r.entropy;
}

export const validateMnemonic = (mnemonic, wordlist = english) => checkMnemonic(mnemonic, wordlist).ok;

// PBKDF2 password = the phrase itself (not the entropy), salt = 'mnemonic' + passphrase. Any text yields a seed;
// that is why validation is a separate step.
const seedArgs = (mnemonic, passphrase) => [utf8ToBytes(nfkd(mnemonic)), utf8ToBytes('mnemonic' + nfkd(passphrase || ''))];

// The 64-byte seed. The phrase is not validated (BIP-39 allows any text); call validateMnemonic first.
export function mnemonicToSeed(mnemonic, passphrase = '') {
  const [pw, salt] = seedArgs(mnemonic, passphrase);
  return pbkdf2(sha512, pw, salt, 2048, 64);
}

export function mnemonicToSeedAsync(mnemonic, passphrase = '', opts) {
  const [pw, salt] = seedArgs(mnemonic, passphrase);
  return pbkdf2Async(sha512, pw, salt, 2048, 64, opts);
}

// Name of the first list (english first) that has every word of the phrase, or null.
// First list containing every word wins; lists overlap (English / French share words, the two Chinese lists share
// characters), so the order of WORDLISTS is the tie-break.
export function wordlistOf(mnemonic, lists = WORDLISTS) {
  const words = splitWords(mnemonic);
  if (!words.length) return null;
  for (const [name, list] of Object.entries(lists)) {
    const idx = indexOf(list);
    if (words.every((w) => idx.has(w))) return name;
  }
  return null;
}

// Words of the list starting with a prefix (NFKD, case-insensitive), at most `limit`.
export function completeWord(prefix, wordlist = english, limit = 8) {
  const p = nfkd(prefix).toLowerCase();
  if (!p) return [];
  const out = [];
  for (const w of wordlist) {
    if (nfkd(w).startsWith(p)) { out.push(w); if (out.length >= limit) break; }
  }
  return out;
}

// Words as typed with unique prefixes (most lists are unique in their first 4 letters) completed to the full words;
// unknown words stay as they are.
// BIP-39 English (and most lists) guarantee words are unique in their first 4 letters; requiring 3+ letters and a
// single candidate keeps the expansion unambiguous for the other lists as well.
export function expandWords(mnemonic, wordlist = english) {
  const idx = indexOf(wordlist);
  return splitWords(mnemonic).map((w) => {
    if (idx.has(w)) return w;
    const c = completeWord(w, wordlist, 2);
    return w.length >= 3 && c.length === 1 ? nfkd(c[0]) : w;
  });
}
