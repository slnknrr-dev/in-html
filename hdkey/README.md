# hdkey

Hierarchical deterministic keys of Bitcoin, Ethereum and other secp256k1 coins: BIP-39 mnemonic phrases (the ten
official word lists) and BIP-32 extended keys with the SLIP-132 version bytes. Pure ES modules on `crypto/`
(`secp256k1.js`, SHA-2, RIPEMD-160, HMAC, PBKDF2, CSPRNG), importable in Node and browsers, no DOM. Used by the
`bitcoin/` and `ethereum/` libraries and by the wallet applications.

| file | contents |
| --- | --- |
| `bip39.js` | `generateMnemonic(words = 12, wordlist)` (CSPRNG entropy), `entropyToMnemonic(entropy, wordlist)`, `mnemonicToEntropy(mnemonic, wordlist)`, `validateMnemonic`, `checkMnemonic(mnemonic, wordlist)` → `{ ok, error: 'word' \| 'count' \| 'checksum' \| null, words, bad, entropy }`, `mnemonicToSeed(mnemonic, passphrase)` (PBKDF2-HMAC-SHA512, 2048 rounds, NFKD), `mnemonicToSeedAsync(…, { onProgress, signal })`, `wordlistOf(mnemonic)` (detects the list), `completeWord(prefix, wordlist, limit)`, `expandWords(mnemonic, wordlist)` (4-letter prefixes → words), `WORDLISTS`, `english` |
| `bip32.js` | `HDKey.fromMasterSeed(seed, prefix)`, `HDKey.fromExtendedKey(text)` (any SLIP-132 prefix, every BIP-32 validity rule), `key.derive(path)`, `key.deriveChild(index)`, `key.neuter()`, `key.wipe()`, `key.privateKey`, `key.publicKey` (compressed), `key.chainCode`, `key.depth`, `key.index`, `key.parentFingerprint`, `key.fingerprint`, `key.identifier`, `key.toExtendedKey(prefix)`, `key.xprv` / `key.xpub`; `parsePath`, `formatPath`, `HARDENED`, `convertExtendedKey(text, prefix)` (zpub → xpub …), `extendedKeyPrefix(text)`, `twinPrefix`, `fingerprintHex`, `hash160`, `VERSIONS` |
| `wordlist-*.js` | the official BIP-39 lists (English, Japanese, Korean, Spanish, Chinese simplified / traditional, French, Italian, Czech, Portuguese), byte-exact copies of `bip-0039/*.txt` |
| `test.js`, `test-vectors.json` | unit tests: `node hdkey/test.js` (or `node check.js tests hdkey`) |

## Details

- **Phrases**: words are matched after NFKD normalisation, so accented and decomposed forms (French, Spanish, Czech,
  Japanese dakuten) are accepted; any whitespace separates words; Japanese phrases are written with U+3000. A bundle
  carries only the word lists its code references (`WORDLISTS` and `wordlistOf` pull in all ten, about 180 KB).
- **SLIP-132**: `xpub` / `xprv` (P2PKH, BIP-44), `ypub` (P2SH-P2WPKH, BIP-49), `zpub` (P2WPKH, BIP-84), `Ypub` / `Zpub`
  (P2SH-P2WSH / P2WSH multisig) and the testnet twins `tpub`, `upub`, `vpub`, `Upub`, `Vpub` (also used by signet and
  regtest). `HDKey.prefix` remembers the family of a parsed key; `toExtendedKey(prefix)` writes any other one.
- **Paths**: `m/84'/0'/0'/0/5`, `84h/0H/0'` (relative), indexes below 2^31 before hardening.

## Tests

`node hdkey/test.js`: BIP-32 test vectors 1–5 (every chain, private and public derivation, the 16 invalid keys),
the BIP-39 reference vectors of Trezor (all 24 English ones and the first ones of the nine other official lists,
passphrase "TREZOR": phrase, entropy, seed, master xprv), the 24 Japanese vectors of bip32JP (NFKD of phrase and
passphrase), the SHA-256 of every word list, the account keys of the BIP-49 (upub / tprv), BIP-84 (zpub / zprv) and
BIP-86 test vectors.

## Limits

- The secrets are ordinary `Uint8Array`s: `key.wipe()` and `crypto/encoding.js` `wipe()` overwrite them, but copies
  made by the JavaScript engine (strings, garbage) cannot be cleared. secp256k1 arithmetic is not constant time (see
  `crypto/README.md`).
- A child index whose HMAC output is out of range (probability below 2^-127) throws instead of skipping to the next
  index.
- Electrum seeds, SLIP-39 Shamir shares and BIP-85 are not implemented.
