// crypto/base58check.js - Base58Check (Bitcoin): payload + the first 4 bytes of SHA-256(SHA-256(payload)), in Base58.
// The payload usually starts with a version byte (0x00 addresses, 0x80 private keys, …). The alphabet is Bitcoin's
// by default; the XRP Ledger uses the same scheme with RADIX.ripple58 (account addresses "r…": 0x00 + account id).
//   base58checkEncode(payload, alphabet) -> string      base58checkDecode(text, alphabet) -> payload (throws on a
//   checksum mismatch)
import { RADIX, radixDecode, radixEncode } from '../codec/radix.js';
import { sha256 } from './sha2.js';
import { equalBytes } from './encoding.js';

// Double SHA-256 truncated to 32 bits: a typo detector (a random corruption passes with probability 2^-32), not an
// authenticator - anyone can compute it. Base58 itself (codec/radix.js) maps each leading 0x00 byte to one leading
// alphabet[0] character, which is why version 0x00 addresses start with '1' (and XRP accounts with 'r').
const checksum = (payload) => sha256(sha256(payload)).subarray(0, 4);

export function base58checkEncode(payload, alphabet = RADIX.base58) {
  const out = new Uint8Array(payload.length + 4);
  out.set(payload);
  out.set(checksum(payload), payload.length);
  return radixEncode(out, alphabet);
}

export function base58checkDecode(text, alphabet = RADIX.base58) {
  const all = radixDecode(text, alphabet);
  if (all.length < 4) throw new Error('too short for a checksum');
  const payload = all.subarray(0, all.length - 4);
  // equalBytes is not needed for secrecy here (the checksum is public); it is simply the library's comparison.
  if (!equalBytes(checksum(payload), all.subarray(all.length - 4))) throw new Error('checksum mismatch');
  // slice(): return an independent buffer, not a view that pins the decoded array including the checksum.
  return payload.slice();
}
