// codec/yenc.js - yEnc 1.3 (Usenet binaries): every byte + 42, the critical ones (NUL, LF, CR, '=', and TAB / SPACE
// at a line edge, '.' at a line start) escaped as '=' + (byte + 64); "=ybegin" / "=yend" lines with the size and the
// CRC-32. The output is 8-bit: a Uint8Array (or a latin1 string for display).
//
//   yencEncode(bytes, { name = 'data.bin', line = 128 }) -> Uint8Array
//   yencDecode(bytes | latin1 string) -> { bytes, name, size, crc32 (hex), crcOk, sizeOk }   single-part messages;
//                                        "=ypart" lines are skipped

//
// Why yEnc: Usenet is 8-bit clean except for a handful of bytes, so shifting by 42 and escaping only the critical
// ones costs ~1-2 % instead of base64's 33 %. Consequently the output is BYTES, not text: a JS string would only be
// safe as latin1 (one char per byte), and UTF-8 encoding it would destroy the payload.
// The +42 shift moves the most common binary bytes (0x00, 0xFF runs) away from the critical values.

import { crc32 } from './crc32.js';

// latin1 conversions: char code & 255 <-> byte. Lossless only for strings that are latin1 already.
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

// Critical set: NUL, LF, CR (break transports), '=' (the escape itself); TAB/SPACE at a line edge (stripped by
// servers); '.' at line start (NNTP dot-stuffing would double it). An escaped char counts 2 columns, so a line may
// overshoot `line` by one - allowed by the spec. No line break after the last byte: the trailer adds its own CRLF.
// The header carries name last because names may contain spaces; the decoder's `name=.*` relies on that.
export function yencEncode(bytes, { name = 'data.bin', line = 128 } = {}) {
  const out = [];
  const push = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255); };
  push(`=ybegin line=${line} size=${bytes.length} name=${name}\r\n`);
  let col = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = (bytes[i] + 42) & 255;
    const edge = col === 0 || col >= line - 1 || i === bytes.length - 1;
    const critical = c === 0 || c === 10 || c === 13 || c === 61 || ((c === 9 || c === 32) && edge) || (c === 46 && col === 0);
    if (critical) { out.push(61, (c + 64) & 255); col += 2; } else { out.push(c); col++; }
    if (col >= line && i < bytes.length - 1) { out.push(13, 10); col = 0; }
  }
  push(`\r\n=yend size=${bytes.length} crc32=${hex8(crc32(bytes))}\r\n`);
  return Uint8Array.from(out);
}

// Header keyword lookup. `(?:^| )` anchors the key at a word start so 'crc32' never matches inside 'pcrc32';
// 'name' takes the rest of the line, every other key one whitespace-free token.
const param = (head, key) => {
  const m = new RegExp(`(?:^| )${key}=(${key === 'name' ? '.*' : '\\S+'})`).exec(head);
  return m ? m[1].trim() : null;
};

// Lenient decoder: reports integrity instead of throwing on it (sizeOk / crcOk, crcOk null when no CRC was sent), so
// a damaged post can still be salvaged. Only a missing frame throws. Splitting on /\r?\n/ is safe because CR/LF are
// always escaped inside data. An '=' as the very last char of a line has nothing to unescape and is decoded as a
// literal byte; encoders never produce that.
// Multi-part: "=ypart" lines are skipped and pcrc32 (part CRC) is accepted, but only one part is decoded - parts are
// not reassembled by offset.
export function yencDecode(input) {
  const b = typeof input === 'string' ? ascii(input) : input;
  const text = Array.from(b, (x) => String.fromCharCode(x)).join('');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('=ybegin '));
  if (start < 0) throw new Error('no "=ybegin" line');
  const head = lines[start];
  const out = [];
  let tail = '';
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('=ypart ')) continue;
    if (l.startsWith('=yend')) { tail = l; break; }
    for (let j = 0; j < l.length; j++) {
      let c = l.charCodeAt(j);
      if (c === 61 && j + 1 < l.length) { j++; c = (l.charCodeAt(j) - 64) & 255; }
      out.push((c - 42) & 255);
    }
  }
  if (!tail) throw new Error('no "=yend" line');
  const bytes = Uint8Array.from(out);
  const size = Number(param(tail, 'size') ?? param(head, 'size'));
  const crc = param(tail, 'crc32') || param(tail, 'pcrc32');
  const actual = hex8(crc32(bytes));
  return {
    bytes, name: param(head, 'name') || '', size,
    crc32: actual, sizeOk: size === bytes.length, crcOk: crc ? crc.toLowerCase().padStart(8, '0') === actual : null,
  };
}
