// mail/encoding.js - the encodings of mail headers and bodies: UTF-8 bytes, RFC 2047 encoded words (B and Q) that
// never split a character and never let CR / LF through (no header injection), decoding of encoded words in any
// charset the engine knows, RFC 2231 parameter values (filename*=UTF-8''…), and base64 / quoted-printable bodies
// with 76-character lines (codec/ does the byte work).
//
// Invariant of the whole module: every string that ends up in a header has passed headerSafe (no CR, LF or other
// controls), so header injection is impossible regardless of what the caller passes.
import { b64decode, b64encode } from '../codec/base64.js';
import { qpDecode, qpEncode } from '../codec/quoted-printable.js';

const ENC = new TextEncoder();
export const utf8 = (s) => ENC.encode(String(s == null ? '' : s));
// Unknown charset labels fall back to Latin-1 (one char per byte) rather than throwing: a message in an exotic
// encoding stays readable in part. us-ascii is decoded as UTF-8 because mislabelled UTF-8 is far more common than
// real 8-bit ASCII violations.
export function decodeBytes(bytes, charset = 'utf-8') {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^(us-)?ascii$/, 'utf-8');
  try { return new TextDecoder(cs).decode(bytes); } catch { return String.fromCharCode(...bytes); }
}
const toBytes = (data) => (data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : utf8(data));

// Header text: CR / LF / TAB runs become one space (a value can never start a new header line).
export const headerSafe = (s) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

// One RFC 2047 encoded word per chunk of at most `maxBytes` UTF-8 bytes (45 bytes -> 60 base64 chars + 12 = 72 < 75).
// Chunking iterates code points and measures UTF-8 bytes, so a multi-byte character is never split across two
// encoded words (RFC 2047 6.3 requires each word to decode on its own). Words are joined by a space, which decoders
// drop between adjacent encoded words.
export function encodeWords(text, { mode = 'B', maxBytes = 45 } = {}) {
  const words = [];
  let cur = '', len = 0;
  for (const ch of String(text)) {
    const n = utf8(ch).length;
    if (len + n > maxBytes && cur) { words.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  if (cur) words.push(cur);
  return words.map((w) => (mode === 'Q' ? '=?UTF-8?Q?' + qWord(w) + '?=' : '=?UTF-8?B?' + b64encode(utf8(w)) + '?=')).join(' ');
}
// Q encoding allows only a conservative safe set in phrases (RFC 2047 5(3)): letters, digits and ! * + - /.
// Everything else, including '=', '?', '_' and all 8-bit bytes, becomes =XX; space becomes '_'.
function qWord(s) {
  let out = '';
  for (const b of utf8(s)) {
    if (b === 32) out += '_';
    else if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 33 || b === 42 || b === 43 || b === 45 || b === 47) out += String.fromCharCode(b);
    else out += '=' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

// A header value: printable ASCII as is (unless it contains '=?', which a reader would try to decode), anything
// else as encoded words. CR / LF are always removed.
export function encodeHeaderText(text, opts) {
  const s = headerSafe(text).trim();
  if (!s) return '';
  if (/^[\x20-\x7E]*$/.test(s) && !s.includes('=?')) return s;
  return encodeWords(s, opts);
}

// Decodes encoded words; whitespace between two adjacent encoded words is dropped (RFC 2047 §6.2).
// Two passes: first remove the whitespace between adjacent encoded words (it is not part of the text), then decode
// each word in its declared charset. 'charset*lang' (RFC 2231 language suffix) is cut. A word that fails to decode
// is left verbatim rather than dropped.
export function decodeWords(text) {
  return String(text == null ? '' : text).replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)(\s+(?==\?[^?\s]+\?[BbQq]\?[^?\s]*\?=))?/g, '$1')
    .replace(/=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g, (m, cs, enc, data) => {
      const charset = cs.split('*')[0];
      try {
        if (enc.toUpperCase() === 'B') return decodeBytes(b64decode(data), charset);
        const bytes = [];
        for (let i = 0; i < data.length; i++) {
          const c = data[i];
          if (c === '_') bytes.push(32);
          else if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(data.slice(i + 1, i + 3))) { bytes.push(parseInt(data.slice(i + 1, i + 3), 16)); i += 2; }
          else bytes.push(c.charCodeAt(0) & 0xff);
        }
        return decodeBytes(new Uint8Array(bytes), charset);
      } catch { return m; }
    });
}

// RFC 2231 extended parameter value: UTF-8''percent-encoded (attr-char kept).
export const rfc2231 = (s) => "UTF-8''" + Array.from(utf8(s), (b) => (/[A-Za-z0-9!#$&+.^_`|~-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0'))).join('');
export function decode2231(v) {
  const m = /^([^']*)'[^']*'(.*)$/.exec(v);
  if (!m) return v;
  const bytes = [];
  for (let i = 0; i < m[2].length; i++) {
    if (m[2][i] === '%' && /^[0-9A-Fa-f]{2}$/.test(m[2].slice(i + 1, i + 3))) { bytes.push(parseInt(m[2].slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(m[2].charCodeAt(i) & 0xff);
  }
  return decodeBytes(new Uint8Array(bytes), m[1] || 'utf-8');
}

// Body encodings (CRLF line ends, 76 characters per line).
export const base64Body = (data) => (b64encode(toBytes(data)).match(/.{1,76}/g) || ['']).join('\r\n');
export const qpBody = (data) => qpEncode(toBytes(data), { eol: '\r\n' });
// Is the text plain 7-bit with short lines (sendable without any transfer encoding)?
// 7bit transfer encoding requires ASCII, lines under 1000 octets incl. CRLF (hence the 999-char probe), and no bare
// CR or LF after normalisation.
export const is7bit = (s) => /^[\x00-\x7F]*$/.test(s) && !/[^\r\n]{999}/.test(s) && !/\r(?!\n)|(?<!\r)\n/.test(s.replace(/\r?\n/g, '\r\n'));

// A "binary string" (one char per byte) <-> bytes.
export const latin1Bytes = (s) => Uint8Array.from(String(s), (c) => c.charCodeAt(0) & 0xff);
// Chunked String.fromCharCode.apply: spreading a multi-megabyte array as arguments overflows the call stack.
export const bytesLatin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x2000)); return s; };

// Decodes a body by Content-Transfer-Encoding -> bytes. `binary`: the text holds one char per byte (a message read
// as bytes); otherwise 7bit / 8bit text is taken as already decoded characters and re-encoded as UTF-8.
export function decodeBody(text, cte = '7bit', binary = false) {
  const e = String(cte || '').toLowerCase().trim();
  if (e === 'base64') return b64decode(String(text).replace(/[^A-Za-z0-9+/=_-]/g, ''));
  if (e === 'quoted-printable') return qpDecode(text);
  return binary ? latin1Bytes(text) : utf8(text);
}
export { toBytes };
