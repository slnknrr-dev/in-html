# crypto-tools

Hashing, encryption, encoding and password tools that run entirely in the browser, offline (standalone class: zero
network). Five pages, each built into one self-contained HTML file:

| page | artifact | contents |
|---|---|---|
| `index.html` | `html@5_offline_singlefile/index.html` | overview; the algorithm lists are read from the registries |
| `hashing.html` | `html@5_offline_singlefile/hashing.html` | text and file hashing, HMAC, comparison, checksum lists, password hashing |
| `ciphering.html` | `html@5_offline_singlefile/ciphering.html` | password and raw-key encryption of text and files, generator |
| `encoding.html` | `html@5_offline_singlefile/encoding.html` | 37 binary-to-text encodings in both directions, all at once, detection |
| `passwords.html` | `html@5_offline_singlefile/passwords.html` | password generator from alphabets, passphrases, keys; KeePassXC-style strength checker |

All cryptography comes from the `crypto/` library and the encodings from `codec/` (pure JavaScript, checked against
official test vectors).

## Features

**Hashing**: 24 digests (MD2, MD4, MD5, SHA-1, RIPEMD-160, SHA-224/256/384/512, SHA-512/224, SHA-512/256, SHA3-224/256/384/512,
Keccak-256/512, SHAKE128/256, BLAKE2b-256/512, BLAKE2s-256, CRC-32, Adler-32), any subset at once; HMAC with a text or
hex key (BLAKE2 uses its native keyed mode); hex, HEX or Base64 output; an expected checksum (hex or Base64, separators
ignored) is matched against every result; files of any size are read in 1 MiB slices with progress and cancel; checksum
lists in GNU (`sha256sum`, `*` binary marker, `\` escapes) or BSD / `--tag` format are verified against dropped files
(algorithm from the tag or the digest length, or chosen); password hashing with Argon2id / Argon2i / Argon2d, scrypt,
PBKDF2-HMAC-SHA1/256/512 and HKDF-SHA256/512.

**Encryption**: password mode (Argon2id or PBKDF2-HMAC-SHA256 → AES-256-GCM or XChaCha20-Poly1305, container format
below; text as an armored Base64 message, files as `name.enc`, the original file name travels inside the encryption);
raw mode with any registered cipher (AES-128/192/256 in ECB, CBC with PKCS#7, CTR, GCM; ChaCha20, XChaCha20,
ChaCha20-Poly1305, XChaCha20-Poly1305, Salsa20, XSalsa20) with a hex key and IV, optional associated data, Base64 or
hex text output (AEAD output is `ciphertext || tag`); generator for passwords (classes, look-alikes, exact entropy),
passphrases (built-in list of 816 words) and random keys. The strength of the password is shown as on the Passwords
page (entropy and KeePassXC quality).

**Passwords**: a generator modelled on KeePassXC's: character groups upper case, lower case, digits and the special
characters split like KeePassXC (braces `()[]{}`, punctuation `.,:;`, quotes `"'`, dashes and slashes `-/\_|`, math
`!*+<=>?`, logograms `#$%&@^`~`), extended ASCII (Latin-1 without the no-break space and the soft hyphen), and other
alphabets (Russian Cyrillic, Greek, 143 emoji); own characters to add ("also choose from") or leave out; "exclude
look-alike characters" (KeePassXC's `0 O 1 l I | G 6 B 8` plus `o`, `` ` ``, `'`, Latin-1 marks, and Cyrillic or Greek
letters shaped like a Latin letter or digit that is also in the pool); "pick characters from every group"; length 1-128;
1-100 passwords at once (copy all, download as text). The choice is uniform over every password the settings allow,
also with "every group" (the counts per group are drawn with their exact BigInt weights, then arranged uniformly), so the
displayed entropy is exact: log2 of that number. Passphrases: 1-32 words from the common English words of the strength
dictionary (up to 7776 words of 4-9 letters), the built-in list of 816 words, or an own list (pasted, kept in memory
only); separator, lower / Title / UPPER / mixed case, a digit and a symbol appended to random words, exact entropy.
Keys: 128-512 random bits as hex or Base64. Each generated password also gets the estimate described next.

The checker estimates a typed password as KeePassXC does (zxcvbn, see `crypto/README.md`): "Entropy: N bit" with the
quality of KeePassXC's `PasswordHealth` (Poor < 40 bit, Weak < 75, Good < 100, Excellent; Bad for an empty password)
on a 0-200 bit bar, the guesses, the naive character-pool entropy (length x log2 of the pool of the character classes
used) next to it, the zxcvbn score, advice, the decomposition into coloured matches (word with dictionary, rank,
substitutions, reversal, keyboard layout or transliteration; keyboard pattern with turns and Shift; repeat; sequence;
year; date; brute force) with guesses and bits per part, and crack times for four attacks (throttled and unthrottled
online, slow and fast offline hashes). Optional "words related to you" count as known words. Hidden input masks the
parts of the decomposition too. Typed and generated passwords are never stored, logged or put in a URL; only the
generator settings are remembered (localStorage `ct-pw`).

**Encoding**: 37 binary-to-text encodings, in both directions — number bases per byte or as one number (Base2,
Base8, Base10, Base16), big-number alphabets (Base26, Base36 upper / lower case, Base58, Flickr Base58, Ripple Base58, Base62),
Base32 (RFC 4648 with and without padding, base32hex, Crockford, z-base-32), Base64 (standard with optional padding and
line length, Base64URL, GMP order), Base85 (RFC 1924), Ascii85, Adobe85, Z85, basE91, Base92, Base45, Base100, with a
checksum (Base58Check with the Bitcoin or the Ripple alphabet — XRP Ledger addresses —, Bech32 and Bech32m with a prefix and an optional SegWit version), mail and Usenet (UUencode and
XXencode with file name and mode, yEnc with size and CRC-32 check, quoted-printable), URLs and domain names
(percent-encoding in four modes, Punycode for a label or a whole domain name). Input as UTF-8 text, hex bytes or a file;
the result is copied, downloaded, or used as the input of the other direction (decoded bytes as text or hex, facts such
as the UU file name or the yEnc checksum status shown). "All encodings" shows the input in every encoding at once;
"Detect" tries every decoder on a string and lists the encodings that read it, exact round trips and readable results
first.

Long work never freezes the page: key derivation and file processing run in slices that yield to the event loop
(progress bars), there are no workers or network requests.

## The registry (metaprogramming pattern of the proof of concept)

`hash.js`, `cipher.js` and `encode.js` define base classes `Hash` / `Cipher` / `Encode` with **static primitives**
(steps), and `DiscoverableHash` / `DiscoverableCipher` / `DiscoverableEncoding` whose constructor registers the
instance in a static `Map`. An algorithm is
declared, not coded, as three pipelines of steps:

```js
const sha_256 =
  new DiscoverableHash('sha-256', {
    initialize: [Hash.engine(sha256), Hash.hmac(sha256)],
    update: [Hash.bytes, Hash.absorb],
    finalize: [Hash.squeeze],
  });

new DiscoverableCipher('aes-256-gcm', {
  initialize: [Cipher.key(32), Cipher.iv(12, 16, 8), Cipher.engine((c) => new AesGcm(c.key, c.iv, { decrypt: c.decrypt, aad: c.options.aad }))],
  update: [Cipher.bytes, Cipher.detachTag(16), Cipher.transform],
  finalize: [Cipher.verifyTag, Cipher.flush, Cipher.appendTag],
});

new DiscoverableEncoding('base64', {
  encode: [Encode.bytes, Encode.codec((b) => bitsEncode(b, B64, { pad: true })), Encode.padding(true), Encode.wrap(0)],
  decode: [Encode.strip, Encode.codec((s) => bitsDecode(s, B64))],
});
```

Each step is `(context, value) -> value`; a phase feeds every step the previous result (a step may return a promise:
key derivation). Steps carry metadata that the registry reads back, so capabilities are discovered from the
declaration: `keyed` (HMAC / native key), `kdf`, `outputLen`, `xof`; `keySizes`, `ivSizes`, `aead`, `tagLength`,
`padding`; the options of an encoding (`Encode.opt`: key, default, choices) with their direction, `binary`, `textual`,
`caseless`, `quadratic`. `getHashes()` / `getCiphers()` / `getEncodings()` list the ids, `getHash(id)` / `getCipher(id)`
/ `getEncoding(id)` return the definitions, `createHash(id, options)` / `createCipher(id, options)` /
`createEncoding(id, options)` return running contexts:

```js
createHash('sha-256', { key }).update(data).digest();               // HMAC-SHA-256
await createHash('argon2id', { salt, m: 65536, t: 3, p: 4 }).update(password).digest();
const c = createCipher('xchacha20-poly1305', { key, iv: nonce24, aad, decrypt: false });
const out = concat(c.update(chunk1), c.update(chunk2), c.final());   // ciphertext || tag
createEncoding('bech32m', { hrp: 'bc', witness: '1' }).encode(program); // a Taproot address
const e = createEncoding('uuencode'); e.decode(text); e.info;            // { name, mode } of the begin line
```

`hashing.js`, `ciphering.js` and `encoding.js` register every algorithm and encoding of the libraries (importing them
is enough).

## Container format "CTENC" version 1 (password mode)

All integers are big-endian.

| offset | size | field |
|---|---|---|
| 0 | 5 | magic `CTENC` (`43 54 45 4E 43`) |
| 5 | 1 | version = 1 |
| 6 | 1 | KDF: 1 = Argon2id (version 0x13), 2 = PBKDF2-HMAC-SHA256 |
| 7 | 1 | cipher: 1 = AES-256-GCM, 2 = XChaCha20-Poly1305 |
| 8 | 1 | chunk size exponent `e` (plaintext chunk = 2^e bytes, 10..24; the tool writes 18 = 256 KiB) |
| 9 | 1 | salt length `S` (16..64; the tool writes 16) |
| 10 | S | salt |
| 10+S | 9 or 4 | Argon2id: memory in KiB (u32), iterations (u32), parallelism (u8); PBKDF2: iterations (u32) |
| … | 1 | nonce prefix length `N` (7 for AES-256-GCM, 19 for XChaCha20-Poly1305) |
| … | N | random nonce prefix |

The bytes above are the **header**. The key is the 32-byte output of the KDF over the UTF-8 bytes of the password in
Unicode NFC, with the salt and the parameters of the header. Readers refuse out-of-range parameters (memory above
1 GiB, more than 64 passes or lanes, PBKDF2 outside 1000..20,000,000 iterations) before deriving anything.

The **plaintext stream** is `u16 name length || UTF-8 file name || content` (length 0 for text). It is cut into chunks
of exactly 2^e bytes, except the last one (1..2^e bytes; the stream is never empty). Chunk `i` (from 0) is sealed with
the AEAD of the header:

```
nonce_i = prefix || u32(i) || u8(last ? 1 : 0)          (12 bytes for AES-GCM, 24 for XChaCha20)
chunk_i = AEAD-Encrypt(key, nonce_i, plaintext_i, aad = header) = ciphertext_i || tag_i(16)
file    = header || chunk_0 || chunk_1 || ... || chunk_n
```

The header is authenticated by every chunk; the counter prevents reordering; the last-chunk flag detects truncation
at a chunk boundary; a wrong password fails on the first chunk. Text messages are the Base64 of the file between
`-----BEGIN CRYPTO TOOLS MESSAGE-----` and `-----END CRYPTO TOOLS MESSAGE-----` (64-character lines; the markers are
optional when reading).

## Files

| file | role |
|---|---|
| `hash.js`, `cipher.js`, `encode.js` | registries: base classes with static primitives, discoverable subclasses, `get*` / `create*` |
| `hashing.js`, `ciphering.js`, `encoding.js` | declarations of every algorithm and encoding |
| `container.js` | the CTENC container: `encryptContainer`, `decryptContainer`, `parseHeader`, `armor`, `unarmor` |
| `checksums.js` | `parseChecksumList` (GNU and BSD checksum files) |
| `shell.js` | shared page shell (links between pages, digest and number formatting, grouping, the strength meter) |
| `hub.js`, `hashing-ui.js`, `ciphering-ui.js`, `encoding-ui.js`, `passwords-ui.js` | the five pages |
| `strings.js` | UI strings in en, ru, uk, de, fr, es, ka |
| `tools.css` | page styles on top of `ui/base.css` and `ui/app.css` |

## Limits

- Pure JavaScript speed (one core): SHA-256 ~70 MB/s, AES-GCM ~25 MB/s, XChaCha20-Poly1305 ~50 MB/s; Argon2id with
  64 MiB and 3 passes takes about two seconds.
- Results of file encryption are kept in memory until they are saved (the browser stores the parts as a Blob).
- Raw mode decrypts streamed AEAD input but releases the plaintext only after the tag has been checked.
- No public-key cryptography.
- The big-number encodings (Base26…Base62, Base58Check, the number layout of Base2/8/10) take inputs up to 1 MiB on
  the Convert tab (BigInt divide and conquer: about 20 ms for 16 KiB) and 64 KiB in the "All encodings" table; the
  table and detection take inputs up to 1 MiB.
- yEnc reads single-part messages; UUencode reads one file per text.
- The strength estimate is only as good as its dictionaries: 22,450 frequency-ranked words written for this project
  (common passwords, English words, given names, surnames, Russian words; see `crypto/README.md`), not the large lists
  of zxcvbn or of real attackers; German, French, Spanish, Ukrainian or Georgian words are not in them and count as
  names or brute force. Passwords longer than 128 characters are estimated in pieces of 128 (zxcvbn advises
  truncating at 100); a long paste is estimated once typing pauses.
- The Passwords and Encryption pages carry the compressed dictionaries (111 KB of Base64; about 400 and 490 KB per
  page); every page carries the strings of all pages in the seven languages.
