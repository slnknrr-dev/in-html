// kdbx/otp.js - one-time passwords of entries: HOTP (RFC 4226), TOTP (RFC 6238, SHA-1/256/512, Steam Guard), the
// otpauth:// URI of KeePassXC's "otp" field, KeePassXC's legacy "TOTP Seed" / "TOTP Settings" and KeePass 2.47+
// "TimeOtp-*" / "HmacOtp-*" fields.
//
//   entryOtp(entry) -> { type: 'totp' | 'hotp', secret: Uint8Array, algorithm, digits, period, counter, encoder,
//                        issuer, account } | null
//   otpCode(otp, timeMs = Date.now()) -> { code, remaining (seconds, TOTP), period }
//   hotp(secret, counter, { algorithm, digits, encoder }), totp(secret, timeMs, { period, ... })
//   parseOtpUri(uri) / buildOtpUri(otp), setEntryOtp(entry, otp) (writes the "otp" field)
import { hmac } from '../crypto/hmac.js';
import { sha1 } from '../crypto/sha1.js';
import { sha256, sha512 } from '../crypto/sha2.js';
import { base32ToBytes, base64ToBytes, bytesToBase32, hexToBytes, utf8ToBytes } from '../crypto/encoding.js';

// Parsing policy: lenient and null-returning. A malformed OTP field must hide the code display, never break opening
// the entry or the database; unknown algorithms fall back to SHA1 (the RFC default, and what most issuers mean).

const HASHES = { SHA1: sha1, SHA256: sha256, SHA512: sha512 };
// Steam Guard: 26 symbols - no vowels, no look-alikes (missing: 0 1 A E I L O S U Z), 5 characters.
const STEAM = '23456789BCDFGHJKMNPQRTVWXY';

// RFC 4226: HMAC over the 8-byte big-endian counter, dynamic truncation (offset = low nibble of the last byte, take
// 31 bits there - & 0x7f drops the sign bit so the result is identical on signed/unsigned platforms), then mod 10^d.
// Counter split with Math.floor(c / 256), not >>, so counters above 2^32 (or TOTP steps far in the future) work.
// Steam: same truncation, then 5 base-26 digits least significant first; `digits` is ignored.
export function hotp(secret, counter, { algorithm = 'SHA1', digits = 6, encoder = '' } = {}) {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const mac = hmac(HASHES[algorithm] || sha1, secret, msg);
  const o = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  if (encoder === 'steam') {
    let v = bin, s = '';
    for (let i = 0; i < 5; i++) { s += STEAM[v % STEAM.length]; v = Math.floor(v / STEAM.length); }
    return s;
  }
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totp(secret, timeMs = Date.now(), { period = 30, ...opts } = {}) {
  return hotp(secret, Math.floor(timeMs / 1000 / period), opts);
}

const normAlgo = (a) => {
  const s = String(a || 'SHA1').toUpperCase().replace(/^HMAC-?/, '').replace(/-/g, '');
  return HASHES[s] ? s : 'SHA1';
};

// otpauth://TYPE/LABEL?secret=...  (Google Authenticator Key Uri Format). With the WHATWG URL parser a non-special
// scheme puts TYPE in hostname; the pathname fallback covers parsers that do not. Label "Issuer:Account" - the
// issuer query parameter wins over the label prefix (the spec says it is authoritative). Only the first ':' splits,
// though split(':', 2) drops anything after a second ':' in the account.
export function parseOtpUri(uri) {
  let u;
  try { u = new URL(String(uri).trim()); } catch { return null; }
  if (u.protocol !== 'otpauth:') return null;
  const type = u.hostname || u.pathname.replace(/^\/\//, '').split('/')[0];
  const p = u.searchParams;
  const secret = p.get('secret');
  if (!secret) return null;
  const label = decodeURIComponent(u.pathname.replace(/^\/+/, '').replace(/^(totp|hotp)\//, ''));
  const [issuerFromLabel, account] = label.includes(':') ? label.split(':', 2) : ['', label];
  const encoder = (p.get('encoder') || '').toLowerCase();
  return {
    type: /hotp/i.test(type) ? 'hotp' : 'totp',
    secret: base32ToBytes(secret),
    algorithm: normAlgo(p.get('algorithm')),
    digits: encoder === 'steam' ? 5 : parseInt(p.get('digits') || '6', 10) || 6,
    period: parseInt(p.get('period') || '30', 10) || 30,
    counter: parseInt(p.get('counter') || '0', 10) || 0,
    encoder,
    issuer: p.get('issuer') || issuerFromLabel || '',
    account: account || '',
  };
}

export function buildOtpUri(o) {
  const label = encodeURIComponent(o.issuer ? `${o.issuer}:${o.account || ''}` : o.account || 'account');
  const q = new URLSearchParams({ secret: bytesToBase32(o.secret, false) });
  if (o.issuer) q.set('issuer', o.issuer);
  q.set('period', String(o.period || 30));
  q.set('digits', String(o.digits || 6));
  q.set('algorithm', o.algorithm || 'SHA1');
  if (o.encoder) q.set('encoder', o.encoder);
  if (o.type === 'hotp') q.set('counter', String(o.counter || 0));
  return `otpauth://${o.type === 'hotp' ? 'hotp' : 'totp'}/${label}?${q.toString()}`;
}

// The OTP settings of an entry from any of the known field conventions (null when it has none).
// Priority: KeePassXC "otp" (a URI, or a bare base32 secret) > KeePassXC legacy "TOTP Seed"/"TOTP Settings"
// ("period;digits", digits 'S' = Steam) > KeePass 2.47 TimeOtp-*/HmacOtp-* (secret in one of four encodings).
// The whole function is wrapped in try: bad base32/hex throws inside the decoders and becomes null here.
// Note: HmacOtp entries read the algorithm from TimeOtp-Algorithm; KeePass HOTP is SHA-1 only, so this normally
// falls back to SHA1 anyway.
export function entryOtp(entry) {
  const get = (k) => (entry.fields.has(k) ? entry.get(k) : null);
  const otp = get('otp');
  try {
    if (otp) {
      const p = otp.trim().startsWith('otpauth:') ? parseOtpUri(otp) : { type: 'totp', secret: base32ToBytes(otp), algorithm: 'SHA1', digits: 6, period: 30, encoder: '' };
      if (p && p.secret.length) return p;
    }
    const seed = get('TOTP Seed');
    if (seed) {
      const st = (get('TOTP Settings') || '30;6').split(';');
      const steam = st[1] === 'S';
      return { type: 'totp', secret: base32ToBytes(seed), algorithm: 'SHA1', digits: steam ? 5 : parseInt(st[1], 10) || 6, period: parseInt(st[0], 10) || 30, encoder: steam ? 'steam' : '' };
    }
    for (const [prefix, type] of [['TimeOtp-', 'totp'], ['HmacOtp-', 'hotp']]) {
      let secret = null;
      if (get(prefix + 'Secret')) secret = utf8ToBytes(get(prefix + 'Secret'));
      else if (get(prefix + 'Secret-Hex')) secret = hexToBytes(get(prefix + 'Secret-Hex'));
      else if (get(prefix + 'Secret-Base32')) secret = base32ToBytes(get(prefix + 'Secret-Base32'));
      else if (get(prefix + 'Secret-Base64')) secret = base64ToBytes(get(prefix + 'Secret-Base64'));
      if (!secret || !secret.length) continue;
      return {
        type, secret,
        algorithm: normAlgo(get('TimeOtp-Algorithm')),
        digits: parseInt(get(type === 'totp' ? 'TimeOtp-Length' : 'HmacOtp-Length') || '6', 10) || 6,
        period: parseInt(get('TimeOtp-Period') || '30', 10) || 30,
        counter: parseInt(get('HmacOtp-Counter') || '0', 10) || 0,
        encoder: '',
      };
    }
  } catch { return null; }
  return null;
}

export function otpCode(o, timeMs = Date.now()) {
  if (o.type === 'hotp') return { code: hotp(o.secret, o.counter, o), remaining: null, period: null };
  const period = o.period || 30;
  const remaining = period - (Math.floor(timeMs / 1000) % period);
  return { code: totp(o.secret, timeMs, o), remaining, period };
}

// Stores the OTP as KeePassXC's "otp" field (otpauth URI), protected.
// One canonical field on write (the most widely read convention); legacy fields are left as they are, so the
// reading priority above makes the new "otp" value win.
export function setEntryOtp(entry, o) {
  if (!o) { entry.remove('otp'); return; }
  entry.set('otp', buildOtpUri(o), true);
}
