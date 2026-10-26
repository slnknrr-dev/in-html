# crypto

Pure-JavaScript cryptography for the browser and Node / Bun: hashes, MACs, key derivation, ciphers, AEADs,
randomness, password generation, a zxcvbn-style password strength estimator and the secp256k1 curve (ECDSA, BIP-340
Schnorr). Vanilla ES modules, no dependencies,
no WebAssembly, no `BigInt` in hot loops (except the curve arithmetic of `secp256k1.js`), no DOM; everything is synchronous except the optional `*Async` variants of
the slow KDFs, which yield to the event loop so a page stays responsive. Inputs are `Uint8Array` (strings are UTF-8 encoded, other buffers are viewed),
outputs are `Uint8Array`.

Every primitive is checked against the official test vectors (FIPS 180-4 / 197 / 202, RFC 1321, 2104, 4231, 5869,
6070, 7693, 7914, 8439, 9106, the GCM specification, draft-irtf-cfrg-xchacha, the Salsa20 specification and ECRYPT
vectors, BIP-340, Wycheproof secp256k1) and cross-checked against Node's `node:crypto` with random inputs of many lengths.

> Pure JavaScript cannot guarantee constant-time execution (table lookups in AES, BigInt arithmetic of secp256k1, JIT).
> The library is meant for offline tools and wallets in the user's own browser where the attacker cannot time the
> code; tags and MACs are compared in constant time.

## Files

| file | contents |
|---|---|
| `encoding.js` | `toBytes`, `utf8ToBytes`, `bytesToUtf8`, `bytesToHex`, `hexToBytes`, `bytesToBase64`, `bytesToBase64Url`, `base64ToBytes`, `bytesToBase32`, `base32ToBytes`, `concatBytes`, `equalBytes` (constant time), `wipe`, `readU32LE/BE`, `writeU32LE/BE`, `readU64LE`, `writeU64LE/BE` |
| `hasher.js` | the hash interface (`hasher`) and Merkle-Damgard buffering (`MDHasher`) |
| `md2.js` | `md2` (RFC 1319, 16-byte blocks, with the checksum erratum) |
| `md4.js` | `md4` (RFC 1320) |
| `md5.js` | `md5` (RFC 1321) |
| `sha1.js` | `sha1` |
| `sha2.js` | `sha224`, `sha256`, `sha384`, `sha512`, `sha512_224`, `sha512_256` |
| `sha3.js` | `sha3_224`, `sha3_256`, `sha3_384`, `sha3_512`, `shake128`, `shake256` (`{ dkLen }`), `keccak256`, `keccak512`, `keccakF1600` |
| `blake2.js` | `blake2b` (1..64 bytes), `blake2b256`, `blake2s` (1..32 bytes); options `{ dkLen, key, salt, personalization }`; `blake2sp` (8-way parallel BLAKE2s tree, as in RAR 5) |
| `ripemd.js` | `ripemd160` |
| `base58check.js` | `base58checkEncode(payload, alphabet)`, `base58checkDecode(text, alphabet)` (Base58 of payload + the first 4 bytes of double SHA-256; Bitcoin alphabet by default, `RADIX.ripple58` for XRP Ledger addresses; throws on a checksum mismatch) |
| `secp256k1.js` | the secp256k1 curve of Bitcoin and Ethereum (BigInt): `getPublicKey`, `Point`, key tweaks (`privateAdd`, `publicAdd`, …), ECDSA with RFC 6979 nonces and low S (`ecdsaSign`, `ecdsaVerify`, `ecdsaRecover`, `Signature` DER / compact), BIP-340 Schnorr (`schnorrSign`, `schnorrVerify`, `taggedHash`, `liftX`), BIP-341 tweaks (`taprootOutputKey`, `taprootTweakPrivateKey`), ECDH (`getSharedSecret`) |
| `test.js` | unit tests: `node crypto/test.js` (RFC 1319 / 1320 / 1321 suites, SHA-256, Bitcoin and XRP addresses, password strength estimator, password generator; secp256k1 through `test-ec.js`) |
| `test-ec.js`, `secp256k1-wycheproof.json` | secp256k1 tests: every BIP-340 vector, the 464 Wycheproof ECDSA vectors of the Bitcoin variant, RFC 6979 nonces, BIP-341 tweaks, cross-checks with OpenSSL (`node:crypto`) |
| `checksum.js` | `crc32`, `adler32` with the hash interface (big-endian 4-byte digest), built on `../codec/crc32.js` |
| `hmac.js` | `hmac(hashFn, key, data)`, `hmac.create(hashFn, key)` |
| `kdf.js` | `pbkdf2`, `pbkdf2Async`, `hkdf`, `hkdfExtract`, `hkdfExpand`, `runSync`, `runAsync`, `nextTick` |
| `argon2.js` | `argon2d`, `argon2i`, `argon2id`, `argon2Async(type, ...)` (RFC 9106, versions 0x13 and 0x10) |
| `scrypt.js` | `scrypt`, `scryptAsync` (RFC 7914) |
| `aes.js` | `AES` block cipher (128/192/256); `AesEcb`, `AesCbc` (PKCS#7), `AesCtr`, `AesGcm` streams; `aesEcbEncrypt/Decrypt`, `aesCbcEncrypt/Decrypt`, `aesCtr`, `aesGcmEncrypt/Decrypt` |
| `chacha.js` | `ChaCha20` stream (8-, 12- or 24-byte nonce), `chacha20`, `xchacha20`, `hchacha20`, `Poly1305`, `poly1305`, `ChaCha20Poly1305` stream, `chacha20poly1305Encrypt/Decrypt`, `xchacha20poly1305Encrypt/Decrypt` |
| `salsa.js` | `Salsa20` stream (16- or 32-byte key, 8- or 24-byte nonce), `salsa20`, `xsalsa20`, `hsalsa20`, `salsa20Core` |
| `random.js` | `randomBytes`, `randomInt` (unbiased), `randomChoice`, `shuffle`, `randomUUID` |
| `password.js` | `passwordGenerator`, `generateFromAlphabets`, `passwordGroups`, `ALPHABETS`, `LOOK_ALIKE`, `generatePassword`, `generatePassphrase`, `PASSPHRASE_SYMBOLS`, `estimateEntropy`, `strengthOf`, `WORDS`, `CHARSETS` |
| `strength.js` | `passwordStrength` (zxcvbn-style estimator, KeePassXC quality), `quality`, `charsetEntropy`, `omnimatch`, `dictionaryInfo`, `wordList`, `FEEDBACK`, `SCENARIOS`, `QUALITY_THRESHOLDS`, `DICTIONARIES` |
| `strength-data.js` | generated: `WORD_LISTS` (packed dictionaries), `WORD_COUNTS` |
| `strength-words.txt`, `strength-pack.js` | the dictionaries as plain word lists and their packer: `node crypto/strength-pack.js` |
| `index.js` | everything above |

## API

### Hashes

Every hash is a function with the same shape:

```js
import { sha256 } from '../crypto/sha2.js';
sha256('abc');                          // Uint8Array(32)
const h = sha256.create();              // streaming
h.update(chunk1).update(chunk2);
h.digest();                             // Uint8Array; the object is finished afterwards
sha256.outputLen; sha256.blockLen; sha256.algo;   // 32, 64, 'sha256'
```

| function | output | notes |
|---|---|---|
| `md2`, `md4` | 16, 16 | broken; legacy formats only (old X.509 / PKCS#1 signatures, NTLM, ed2k) |
| `md5`, `sha1` | 16, 20 | broken for collisions; checksums only |
| `sha224`, `sha256`, `sha384`, `sha512`, `sha512_224`, `sha512_256` | 28..64 | FIPS 180-4 |
| `sha3_224` .. `sha3_512` | 28..64 | FIPS 202 |
| `shake128(data, { dkLen })`, `shake256` | any | default 32 / 64 bytes |
| `keccak256`, `keccak512` | 32, 64 | original Keccak padding (Ethereum) |
| `blake2b(data, { dkLen, key, salt, personalization })` | 1..64 | key up to 64 bytes, salt / personalization 16 bytes |
| `blake2s(data, { ... })` | 1..32 | key up to 32 bytes, salt / personalization 8 bytes |
| `blake2sp` | 32 | BLAKE2sp: 8 BLAKE2s leaves over interleaved 64-byte blocks + root (RAR 5 file hash); no options |
| `ripemd160` | 20 | |
| `crc32`, `adler32` | 4 | non-cryptographic |

### MAC and KDF

| call | result |
|---|---|
| `hmac(hashFn, key, data)` / `hmac.create(hashFn, key)` | tag (`hashFn.outputLen` bytes) |
| `pbkdf2(hashFn, password, salt, iterations, dkLen)` | derived key |
| `pbkdf2Async(..., { onProgress(f), signal })` | `Promise` of the key |
| `hkdf(hashFn, ikm, salt, info, length)` | RFC 5869 |
| `argon2id(password, salt, { t = 3, m = 65536 (KiB), p = 1, dkLen = 32, secret, ad, version = 0x13 })` | also `argon2d`, `argon2i` |
| `argon2Async('argon2d' \| 'argon2i' \| 'argon2id', password, salt, opts, { onProgress, signal })` | `Promise` |
| `scrypt(password, salt, { N = 16384, r = 8, p = 1, dkLen = 32 })`, `scryptAsync(..., run)` | RFC 7914 |

Argon2 keeps its memory in one `Int32Array` (64 MiB for `m = 65536`) and computes the lanes one after another (the
result does not depend on it). In V8 it needs roughly 0.6-0.8 s per pass over 64 MiB.

### Ciphers

| call | notes |
|---|---|
| `aesEcbEncrypt(key, data, { padding = false })`, `aesEcbDecrypt` | key 16 / 24 / 32 bytes |
| `aesCbcEncrypt(key, iv16, data, { padding = true })`, `aesCbcDecrypt` | PKCS#7; bad padding throws |
| `aesCtr(key, iv16, data)` | 128-bit big-endian counter, same call decrypts |
| `aesGcmEncrypt(key, iv, plaintext, aad)` -> `ciphertext \|\| tag16`, `aesGcmDecrypt(key, iv, sealed, aad)` | any IV length (12 recommended); a bad tag throws before any plaintext is returned |
| `chacha20(key32, nonce, data, counter = 0)` | nonce 12 (RFC 8439), 8 (original, 64-bit counter) or 24 (XChaCha20) |
| `xchacha20(key32, nonce24, data)`, `hchacha20(key32, nonce16)` | |
| `chacha20poly1305Encrypt(key32, nonce12, plaintext, aad)`, `...Decrypt` | RFC 8439 AEAD |
| `xchacha20poly1305Encrypt(key32, nonce24, plaintext, aad)`, `...Decrypt` | random nonces are safe |
| `poly1305(key32, msg)` | one-time authenticator |
| `salsa20(key, nonce8, data, counter = 0)`, `xsalsa20(key32, nonce24, data)`, `hsalsa20` | |

Streaming classes follow Node's cipher objects: `update(chunk) -> bytes`, `final() -> bytes`; AEADs also have
`getTag()` (after `final()` when encrypting) and `setTag(tag)` (before `final()` when decrypting; `final()` throws on
a mismatch). `new AesGcm(key, iv, { decrypt, aad, tagLength })`, `new ChaCha20Poly1305(key, nonce12or24, { decrypt,
aad })`, `new AesCbc(key, iv, { decrypt, padding })`, `new AesEcb(key, { decrypt, padding })`, `new AesCtr(key, iv)`,
`new ChaCha20(key, nonce, counter)`, `new Salsa20(key, nonce, counter)` (`keystream(n)` on the stream ciphers).

### Randomness and passwords

| call | result |
|---|---|
| `randomBytes(n)` | `crypto.getRandomValues`, any length |
| `randomInt(max)` | uniform in `[0, max)`, rejection sampling |
| `randomUUID()` | version 4 UUID |
| `generatePassword({ length, lower, upper, digits, symbols, custom, exclude, excludeSimilar, eachClass })` | `{ password, entropy }`; uniform over the strings that contain every chosen class, `entropy` exact in bits |
| `passwordGenerator({ alphabets, include, exclude, lookAlike, everyGroup = true, length = 20 })` | `{ groups, pool, length, everyGroup, entropy, next() }`: a generator over the groups of `ALPHABETS` (below); `next()` returns one password; errors carry `code` `'length'`, `'empty'` or `'short'` (with `min`) |
| `generateFromAlphabets(options)` | `{ password, entropy }` of one password |
| `passwordGroups(options)` | the disjoint groups `[{ id, chars }]` after exclusions (`custom` = own characters) |
| `generatePassphrase({ words = 6, separator = '-', wordCase, capitalize, number, symbol, list = WORDS })` | `{ password, entropy, size }`; `wordCase` `'lower'`, `'title'`, `'upper'` or `'mixed'` (each word one of the three, +log2 3 bits per word); `number` / `symbol` append a digit / one of `PASSPHRASE_SYMBOLS` to a random word (+log2(10 x words), +log2(12 x words)); the list is lower-cased and de-duplicated, `size` is its length |
| `estimateEntropy(password)` | `{ bits, strength }`: a light heuristic (character pool with penalties for repeats, sequences, keyboard runs, common passwords and passphrases of known words); `strength.js` is the real estimator |
| `passwordStrength(password, { userInputs, maxLength = 128 })` | the zxcvbn-style estimate described below |

`ALPHABETS` are KeePassXC's character classes (`PasswordGenerator::passwordGroups`): `upper` A-Z, `lower` a-z, `digits`,
`braces` `()[]{}`, `punctuation` `.,:;`, `quotes` `"'`, `dashes` `-/\_|`, `math` `!*+<=>?`, `logograms` `#$%&@^`~`,
`latin1` (U+00A1-U+00FF without the soft hyphen: KeePassXC's extended ASCII), plus `cyrillic` (the 66 letters of the
Russian alphabet), `greek` (48 letters) and `emoji` (143 single-code-point emoji: U+1F600-U+1F64F, U+1F400-U+1F43E).
`include` adds own characters as one more group, `exclude` removes characters from every group, `lookAlike` removes
`LOOK_ALIKE` (KeePassXC's `0 O 1 l I | G 6 B 8` plus `o`, `` ` ``, `'` and Latin-1 marks such as `¦ · ´ ° º ¹`) and
keeps only the first of letters with the same shape across Latin, Cyrillic and Greek (Cyrillic `а е о р с у х` and
Greek `Α Β Ο Ρ ...` go when the Latin twin is in the pool). Groups are made disjoint (a character belongs to the first
group that has it). With `everyGroup`, every password contains a character of each group and is drawn uniformly from
all such strings: up to 128 characters the number of characters of each group is drawn with its exact weight from a
BigInt table N[j][r] = sum over c of C(r, c) size_j^c N[j+1][r-c], the arrangement is a uniform shuffle and the
characters are uniform within their groups; longer passwords use rejection sampling. `entropy` is log2 of the exact
count of those strings (the table, or inclusion-exclusion over the groups), not an approximation. Unlike KeePassXC
(one character of each group, then the rest, then a shuffle) no string is more likely than another.

### Password strength (`strength.js`)

`passwordStrength(password)` estimates the number of guesses an attacker needs, in the manner of zxcvbn (Dropbox) whose
C port zxcvbn-c gives KeePassXC its "Entropy: N bit" and password quality:

1. **Matching** finds every part of the password an attacker would try as a unit: dictionary words of five
   frequency-ranked lists (`passwords`, `english`, `names`, `surnames`, `russian`; case-insensitive; also optional
   `userInputs`), reversed words, l33t substitutions (zxcvbn's table: `4 @`→a, `8`→b, `( { [ <`→c, `3`→e, `6 9`→g,
   `1 ! |`→i, `1 | 7`→l, `0`→o, `$ 5`→s, `+ 7`→t, `%`→x, `2`→z), words typed with the other keyboard layout (a
   Russian word on the Latin layout, `gfhjkm` = пароль, and a Latin word on the Russian layout, `зфыыцщкв` = password),
   transliterated Russian words (up to 12 Latin spellings per word: `privet`, `lyubov` / `ljubov` / `lubov`,
   `solnyshko`), keyboard patterns on QWERTY, Dvorak, QWERTZ, AZERTY, Russian JCUKEN and two numeric keypads (zxcvbn's
   adjacency graphs built from the layouts; turns and Shift counted), repeats (also of whole sequences such as
   `abcabc`, the base is estimated recursively), sequences with a constant step up to 5 (Latin, digits, Cyrillic,
   Greek, any Unicode), years 1900-2049 and dates (day, month, 2- or 4-digit year, with or without one of `/ \ _ . -`
   or a space, as zxcvbn).
2. **Guesses per match** as in zxcvbn: dictionary rank x capitalisation variants x l33t variants x 2 if reversed x 2 if
   typed in the other layout; spatial patterns from the starting keys, average degree, turns and shifted keys;
   repeats = base guesses x count; sequences = 4, 10 or the alphabet size x 2 if descending x length; years and dates
   from the distance to the current year (at least 20 years) x 365 x 4 with a separator; a part shorter than the
   password needs at least 10 (one character) or 50 guesses.
3. **The cheapest decomposition**: zxcvbn's dynamic programme over the end positions minimises l! x prod(guesses) +
   10000^(l-1) for a sequence of l parts, everything not covered being brute force. As in zxcvbn-c (KeePassXC) and
   unlike zxcvbn's fixed 10 per character, brute force costs the character pool of the password per character (lower
   26, upper 26, digits 10, ASCII symbols and space 33, Latin-1 96, Cyrillic 33 + 33, Greek 25 + 24, anything else 100
   once), so a random string scores close to its naive entropy. All arithmetic is in log2, so long passwords do not
   overflow; inputs longer than `maxLength` are estimated in pieces whose bits add up.

The result: `entropy` = log2(guesses) in bits, `guesses`, `guessesLog10`, `score` 0-4 (zxcvbn's thresholds 10^3,
10^6, 10^8, 10^10), `quality` with KeePassXC's thresholds on the entropy (`PasswordHealth::quality()`: <= 0 bad, < 40
poor, < 75 weak, < 100 good, otherwise excellent; `quality(bits)`), `charset` = `charsetEntropy(password)` (length x
log2(pool): the naive estimate), `sequence` (the matches with `pattern`, `token`, `i`, `j` in code points, `guesses`,
`log2` and the details of each pattern), `crackTimes` in seconds for `SCENARIOS` (100 guesses per hour, 10 per second,
10^4 per second for a slow hash, 10^10 per second for a fast hash) and `feedback` `{ warning, suggestions }` as codes
(zxcvbn's advice plus `layout` / `otherLayout`; English texts in `FEEDBACK`).

**Differences from KeePassXC.** KeePassXC links zxcvbn-c, which sums per-match entropies (with its own dictionaries,
"multi-word" extra bits and UTF-8 bytes as brute-force units); this module follows zxcvbn 4.4.2 (guesses, factorial
sequence penalty) with zxcvbn-c's brute-force cardinality, so the numbers agree in magnitude and quality level but not
to the decimal. KeePassXC shows a zxcvbn estimate for generated passwords and the exact entropy for passphrases; the
Passwords page shows both for every kind.

**Dictionaries.** `strength-words.txt` holds the lists, most frequent first, as written for this project from general
knowledge of public frequency data (not copied from zxcvbn or any other list): 3,875 common passwords of breach
corpora (RockYou, the yearly "worst passwords" lists, Russian-language leaks, including Russian words typed in the
Latin layout), 9,818 English words by frequency, 3,457 given names and 3,357 surnames (US and European), 4,479
Russian words, names and password words in Cyrillic. `node crypto/strength-pack.js` lower-cases them, drops words
shorter than 3 characters, keeps each word only in the list where it ranks best and writes `strength-data.js`
(22,450 words: passwords 3,023, english 8,853, names 3,047, surnames 3,058, russian 4,469; 197 KB of text, 83 KB
deflated, 111 KB as Base64): the lists as "name\nword..." sections joined by NUL, raw deflate level 9
(`codec/zlib.js`), Base64. They are decoded on the first estimate (about 70 ms in Node) into one `Map` together with
the Latin transliterations of the Russian words. Ranks beyond the first thousand or so entries of a list are
approximate; other languages (German, French, Spanish, Ukrainian, Georgian...) are not covered.

## Limits

- Throughput in V8 (one core): SHA-256 ~70 MB/s, SHA-512 ~40 MB/s, SHA3-256 ~30 MB/s, BLAKE2b ~25 MB/s, AES ~25-30
  MB/s (GCM ~25), ChaCha20 ~100 MB/s, ChaCha20-Poly1305 ~45-60 MB/s. Long jobs belong in chunks with yields
  (`runAsync`, streaming objects).
- 64-bit lengths and counters are exact up to 2^53 bytes / blocks.
- No RSA, no elliptic curves other than secp256k1 (no NIST curves, no Ed25519), no Twofish, no ARCFOUR.

### secp256k1 (`secp256k1.js`)

Keys and scalars are 32-byte `Uint8Array`s, 64-digit hex strings or `bigint`s; public keys are 33-byte compressed or
65-byte uncompressed encodings; results are `Uint8Array`s.

| call | result |
|---|---|
| `getPublicKey(priv, compressed = true)` | 33 / 65 bytes; `isValidPrivateKey`, `isValidPublicKey`, `convertPublicKey(pub, compressed)` |
| `privateAdd(priv, tweak)`, `privateNegate`, `privateMultiply`; `publicAdd(pub, tweak)` (P + t·G), `publicMultiply`, `publicCombine`, `publicNegate` | BIP-32 child keys and other tweaks; out-of-range tweaks and zero results throw |
| `ecdsaSign(hash32, priv, { lowS = true, extraEntropy, lowR = false })` | `Signature { r, s, recovery }`: RFC 6979 (HMAC-SHA256) nonce, extra entropy appended like libsecp256k1, low S by default; `lowR` grinds like Bitcoin Core (signatures equal Core's, one byte shorter in DER) |
| `ecdsaVerify(sig, hash32, pub, { lowS = false })` | boolean; `sig` is a `Signature` or 64 bytes r ‖ s; `lowS` also rejects s > n/2 (Bitcoin standardness, Ethereum EIP-2) |
| `ecdsaRecover(sig, recovery, hash32, compressed)`, `sig.recoverPublicKey(hash)` | the signer's public key (Bitcoin message signatures, Ethereum senders) |
| `Signature.fromDER(bytes, { strict = true })` (BIP-66 rules), `Signature.fromCompact(64)`, `sig.toDER()`, `sig.toCompact()`, `sig.normalizeS()`, `sig.hasHighS()` | encodings |
| `schnorrSign(msg, priv, auxRand = randomBytes(32))`, `schnorrVerify(sig64, msg, pubX32)`, `schnorrPublicKey(priv)` | BIP-340 (messages of any length) |
| `taggedHash(tag, ...parts)`, `liftX(x)` | BIP-340 helpers |
| `taprootTweak(internalX, merkleRoot)`, `taprootOutputKey(internalX, merkleRoot)` → `{ key, parity }`, `taprootTweakPrivateKey(priv, merkleRoot)` | BIP-341 |
| `getSharedSecret(priv, pub, compressed = true)` | ECDH point; its x coordinate is bytes 1..33 |
| `Point` (`fromBytes`, `fromPrivateKey`, `add`, `double`, `multiply`, `negate`, `toBytes`, `BASE`, `ZERO`), `CURVE`, `mod`, `invert`, `bytesToNumber`, `numberToBytes` | lower level |

Arithmetic uses `BigInt` with Jacobian coordinates; k·G uses a lazily built table of 960 multiples (64 windows of 4
bits, one addition per window, a dummy one for zero digits), other points a 4-bit window. In V8 a public key takes
about 0.5 ms, a signature about 1 ms, a verification about 3 ms. **Not constant time**: `BigInt` operations and table
lookups take time that depends on secret values, so an attacker who can time many signatures on the same machine
might learn about the key. The library is meant for wallets that sign in the user's own browser; it is not a
replacement for libsecp256k1 on a server. Signatures are deterministic (RFC 6979), so no nonce depends on the quality
of a random source; Schnorr signatures mix fresh randomness into the nonce as BIP-340 recommends.

Tests (`test-ec.js`): the 19 BIP-340 vectors (signing with the given aux_rand and verification), the 464 Wycheproof
`ecdsa_secp256k1_sha256_bitcoin` vectors (strict DER and low S; 162 valid, 302 invalid), RFC 6979 vectors of
trezor-crypto / python-ecdsa, the BIP-341 key-path tweak, and random cross-checks against OpenSSL through `node:crypto`
(public keys, ECDH, ECDSA signatures verified both ways, recovery).
