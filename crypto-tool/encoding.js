// crypto-tool/encoding.js - every binary-to-text encoding of the codec library, declared through the
// DiscoverableEncoding registry (encode.js). Importing this module registers them (side effect at import time).
// 
// Families: digits per byte (base2/8/10/16), whole-input big numbers (base26..base62, O(n²)), RFC 4648 bit groups
// (Base32/Base64 variants, linear), Base85 family, special alphabets, checksummed (Base58Check, Bech32), mail/Usenet
// (uu/xx, yEnc, quoted-printable) and web (percent, Punycode/IDNA). Decoders strip whitespace where the alphabet has
// none, so pasted, wrapped text decodes.
import { Encode, DiscoverableEncoding, getEncodings, getEncoding, createEncoding } from './encode.js';
import { RADIX, byteDigits, parseByteDigits, radixDecode, radixEncode } from '../codec/radix.js';
import { B32, B32HEX, B64, B64URL, CROCKFORD, CROCKFORD_ALIASES, GMP64, ZBASE32, bitsDecode, bitsEncode } from '../codec/rfc4648.js';
import { base45Decode, base45Encode } from '../codec/base45.js';
import { Z85, ascii85Decode, ascii85Encode, base85Decode, base85Encode } from '../codec/base85.js';
import { base91Decode, base91Encode } from '../codec/base91.js';
import { base92Decode, base92Encode } from '../codec/base92.js';
import { base100Decode, base100Encode } from '../codec/base100.js';
import { bech32Decode, bech32Encode, fromWords, toWords } from '../codec/bech32.js';
import { uuDecode, uuEncode } from '../codec/uu.js';
import { yencDecode, yencEncode } from '../codec/yenc.js';
import { qpDecode, qpEncode } from '../codec/quoted-printable.js';
import { percentDecode, percentEncode } from '../codec/percent.js';
import { domainToASCII, domainToUnicode, punycodeDecode, punycodeEncode } from '../codec/punycode.js';
import { base58checkDecode, base58checkEncode } from '../crypto/base58check.js';

const opt = Encode.opt;
const choices = (key, values) => values.map((v) => ({ v, l: `opt.${key}.${v}` }));

// The canonical shape: bytes in, the codec, the options it reads; decoding drops whitespace first.
const base64 =
  new DiscoverableEncoding('base64', {
    label: 'Base64', group: 'b64', ext: 'b64',
    encode: [
      Encode.bytes, Encode.codec((b) => bitsEncode(b, B64, { pad: true })), Encode.padding(true), Encode.wrap(0),
    ],
    decode: [
      Encode.strip, Encode.codec((s) => bitsDecode(s, B64)),
    ],
  });

// --- digits per byte, or the whole input as one number ------------------------------------------------------------

// Separators between per-byte digit groups; "line" puts each byte on its own line.
const SEP = { space: ' ', none: '', comma: ', ', line: '\n' };
for (const [id, base, label, sep] of [['base2', 2, 'Base2', 'space'], ['base8', 8, 'Base8 (octal)', 'space'], ['base10', 10, 'Base10 (decimal)', 'space']]) {
  const alphabet = RADIX['base' + base];
  new DiscoverableEncoding(id, {
    label, group: 'num',
    encode: [Encode.bytes, Encode.tag(Encode.codec(
      (b, o) => (o.layout === 'number' ? radixEncode(b, alphabet) : byteDigits(b, base, { sep: SEP[o.sep], pad: base !== 10 || o.sep === 'none' })),
      opt('layout', 'bytes', { choices: choices('layout', ['bytes', 'number']) }), opt('sep', sep, { choices: choices('sep', Object.keys(SEP)) }),
    ), { quadratic: (o) => o.layout === 'number' })],
    decode: [Encode.codec((s, o) => (o.layout === 'number' ? radixDecode(s, alphabet) : parseByteDigits(s, base)))],
  });
}

// Hex decoding is tolerant: any non-hex character separates bytes, so "de:ad be-ef" and "0xde 0xad" both work.
new DiscoverableEncoding('base16', {
  label: 'Base16 (hex)', group: 'num', ext: 'hex',
  encode: [Encode.bytes, Encode.codec((b, o) => byteDigits(b, 16, { sep: SEP[o.sep], upper: o.case === 'upper' }),
    opt('case', 'upper', { choices: [{ v: 'upper', l: '=ABC' }, { v: 'lower', l: '=abc' }] }), opt('sep', 'none', { choices: choices('sep', Object.keys(SEP)) }))],
  // "0x" prefixes are dropped; any other non-hex character separates bytes.
  decode: [Encode.tag(Encode.codec((s) => parseByteDigits(String(s).replace(/\b0x/gi, ' '), 16)), { caseless: true })],
});

// --- the whole input as one big number in an alphabet (leading zero bytes kept as leading zero digits) --------------

// Leading zero bytes are kept as leading zero digits (as in Bitcoin Base58), otherwise they would vanish in the number.
const bigNumber = (id, alphabet, label, caseless = false) => new DiscoverableEncoding(id, {
  label, group: 'radix', note: 'quadratic',
  encode: [Encode.bytes, Encode.tag(Encode.codec((b) => radixEncode(b, alphabet)), { quadratic: true })],
  decode: [Encode.tag(Encode.codec((s) => radixDecode(s, alphabet, { caseless })), { caseless })],
});
bigNumber('base26', RADIX.base26, 'Base26', true);
bigNumber('base36', RADIX.base36, 'Base36', true);
bigNumber('base36-lower', RADIX.base36lower, 'Base36 lowercase', true);
bigNumber('base58', RADIX.base58, 'Base58');
bigNumber('base58-flickr', RADIX.flickr58, 'Flickr Base58');
bigNumber('base58-ripple', RADIX.ripple58, 'Ripple Base58');
bigNumber('base62', RADIX.base62, 'Base62');

// --- Base32 family (5 bits per letter) ---------------------------------------------------------------------------

new DiscoverableEncoding('base32', {
  label: 'Base32', group: 'b32',
  encode: [Encode.bytes, Encode.codec((b) => bitsEncode(b, B32, { pad: true }))],
  decode: [Encode.strip, Encode.tag(Encode.codec((s) => bitsDecode(s, B32, { caseless: true })), { caseless: true })],
});
new DiscoverableEncoding('base32-nopad', {
  label: 'Base32 (no padding)', group: 'b32',
  encode: [Encode.bytes, Encode.codec((b) => bitsEncode(b, B32))],
  decode: [Encode.strip, Encode.tag(Encode.codec((s) => bitsDecode(s, B32, { caseless: true })), { caseless: true })],
});
new DiscoverableEncoding('base32hex', {
  label: 'Base32hex', group: 'b32',
  encode: [Encode.bytes, Encode.codec((b) => bitsEncode(b, B32HEX, { pad: true })), Encode.padding(true)],
  decode: [Encode.strip, Encode.tag(Encode.codec((s) => bitsDecode(s, B32HEX, { caseless: true })), { caseless: true })],
});
// Crockford: human-friendly decoding (O→0, I/L→1, hyphens ignored).
new DiscoverableEncoding('base32-crockford', {
  label: 'Base32 Crockford', group: 'b32',
  encode: [Encode.bytes, Encode.codec((b) => bitsEncode(b, CROCKFORD))],
  // Look-alikes (O, I, L) are read as 0 and 1, hyphens are skipped.
  decode: [Encode.strip, Encode.tag(Encode.codec((s) => bitsDecode(s, CROCKFORD, { caseless: true, aliases: CROCKFORD_ALIASES, ignore: '-' })), { caseless: true })],
});
new DiscoverableEncoding('z-base-32', {
  label: 'z-base-32', group: 'b32',
  encode: [Encode.bytes, Encode.codec((b) => bitsEncode(b, ZBASE32))],
  decode: [Encode.strip, Encode.tag(Encode.codec((s) => bitsDecode(s, ZBASE32, { caseless: true })), { caseless: true })],
});

// --- Base64 family (6 bits per letter) ---------------------------------------------------------------------------

new DiscoverableEncoding('base64url', {
  label: 'Base64URL', group: 'b64',
  encode: [Encode.bytes, Encode.codec((b) => bitsEncode(b, B64URL, { pad: true })), Encode.padding(false)],
  decode: [Encode.strip, Encode.codec((s) => bitsDecode(s, B64URL))],
});
new DiscoverableEncoding('base64-gmp', {
  label: 'GMP Base64', group: 'b64',
  encode: [Encode.bytes, Encode.codec((b) => bitsEncode(b, GMP64, { pad: true })), Encode.padding(false)],
  decode: [Encode.strip, Encode.codec((s) => bitsDecode(s, GMP64))],
});

// --- Base85 and denser -------------------------------------------------------------------------------------------

new DiscoverableEncoding('base85', {
  label: 'Base85', group: 'b85',
  encode: [Encode.bytes, Encode.codec((b) => base85Encode(b))],
  decode: [Encode.codec((s) => base85Decode(s))],
});
new DiscoverableEncoding('ascii85', {
  label: 'Ascii85', group: 'b85', ext: 'a85',
  encode: [Encode.bytes, Encode.codec((b, o) => ascii85Encode(b, { foldSpaces: o.fold }), opt('fold', false)), Encode.wrap(0, [64, 76, 80])],
  decode: [Encode.codec((s) => ascii85Decode(s))],
});
// Adobe variant framed by <~ … ~>; the end marker distinguishes it from plain Ascii85 during detection.
new DiscoverableEncoding('adobe85', {
  label: 'Adobe85', group: 'b85', ext: 'a85',
  encode: [Encode.bytes, Encode.codec((b) => ascii85Encode(b, { adobe: true })), Encode.wrap(0, [64, 76, 80])],
  // The "~>" end marker is required (it tells Adobe's variant from plain Ascii85).
  decode: [Encode.codec((s) => {
    const t = String(s).trim();
    if (!t.endsWith('~>')) throw new Error('missing "~>"');
    return ascii85Decode(t);
  })],
});
new DiscoverableEncoding('z85', {
  label: 'Z85', group: 'b85',
  encode: [Encode.bytes, Encode.codec((b) => base85Encode(b, Z85))],
  decode: [Encode.codec((s) => base85Decode(s, Z85))],
});
new DiscoverableEncoding('base91', {
  label: 'basE91', group: 'b85',
  encode: [Encode.bytes, Encode.codec((b) => base91Encode(b))],
  decode: [Encode.codec((s) => base91Decode(s))],
});
new DiscoverableEncoding('base92', {
  label: 'Base92', group: 'b85',
  encode: [Encode.bytes, Encode.codec((b) => base92Encode(b))],
  decode: [Encode.strip, Encode.codec((s) => base92Decode(s))],
});

// --- special alphabets -------------------------------------------------------------------------------------------

new DiscoverableEncoding('base45', {
  label: 'Base45', group: 'special',
  encode: [Encode.bytes, Encode.codec((b) => base45Encode(b))],
  // Space is a Base45 letter: only line breaks are dropped.
  decode: [Encode.codec((s) => base45Decode(String(s).replace(/[\r\n]+/g, '')))],
});
new DiscoverableEncoding('base100', {
  label: 'Base100', group: 'special',
  encode: [Encode.bytes, Encode.codec((b) => base100Encode(b))],
  decode: [Encode.codec((s) => base100Decode(s))],
});

// --- with a checksum ---------------------------------------------------------------------------------------------

for (const [id, label, alphabet] of [['base58check', 'Base58Check', RADIX.base58], ['base58check-ripple', 'Ripple Base58Check', RADIX.ripple58]]) {
  new DiscoverableEncoding(id, {
    label, group: 'check', note: 'quadratic',
    encode: [Encode.bytes, Encode.tag(Encode.codec((b) => base58checkEncode(b, alphabet)), { quadratic: true })],
    decode: [Encode.strip, Encode.tag(Encode.codec((s) => base58checkDecode(s, alphabet)), { checksum: true })],
  });
}

// Bech32 / Bech32m: plain data, or a SegWit address (a witness version word before the program). With the witness
// option off, decoding still reads bc / tb / bcrt strings that follow the BIP-350 rules as addresses; the length
// limit of BIP-173 is lifted.
// BIP-173/350: witness version 0 must use Bech32, versions 1–16 Bech32m; v0 programs are exactly 20 or 32 bytes.
const SEGWIT_HRP = /^(bc|tb|bcrt)$/;
const segwitProgram = (words, variant) => {
  const v = words[0];
  if (!(v <= 16) || (v === 0) !== (variant === 'bech32')) return null;
  try {
    const program = fromWords(words.slice(1));
    return program.length >= 2 && program.length <= 40 && (v !== 0 || program.length === 20 || program.length === 32) ? program : null;
  } catch { return null; }
};
// Read by both directions: the encoder writes the version word, the decoder expects it.
const WITNESS = opt('witness', 'none', { choices: [{ v: 'none', l: 'opt.witness.none' }, ...Array.from({ length: 17 }, (_, i) => ({ v: String(i), l: '=' + i }))] });
for (const [id, label, variant] of [['bech32', 'Bech32', 'bech32'], ['bech32m', 'Bech32m', 'bech32m']]) {
  new DiscoverableEncoding(id, {
    label, group: 'check',
    encode: [Encode.bytes, Encode.codec((b, o) => {
      const words = toWords(b);
      if (o.witness !== 'none') words.unshift(+o.witness);
      return bech32Encode(String(o.hrp).trim().toLowerCase() || 'data', words, variant, { limit: 0 });
    }, opt('hrp', 'data'), WITNESS)],
    decode: [Encode.strip, Encode.tag(Encode.codec((s, o) => {
      const r = bech32Decode(s, { limit: 0 });
      if (r.variant !== variant) throw new Error(`the checksum is ${r.variant === 'bech32' ? 'Bech32' : 'Bech32m'}`);
      if (o.witness !== 'none') {
        if (!r.words.length || r.words[0] > 16) throw new Error('no witness version');
        return { bytes: fromWords(r.words.slice(1)), hrp: r.hrp, witness: r.words[0] };
      }
      const program = SEGWIT_HRP.test(r.hrp) ? segwitProgram(r.words, variant) : null;
      return program ? { bytes: program, hrp: r.hrp, witness: r.words[0] } : { bytes: fromWords(r.words), hrp: r.hrp };
    }, WITNESS), { checksum: true }), Encode.facts],
  });
}

// --- mail and Usenet ---------------------------------------------------------------------------------------------

for (const [id, label, table, ext] of [['uuencode', 'UUencode', 'uu', 'uue'], ['xxencode', 'XXencode', 'xx', 'xxe']]) {
  new DiscoverableEncoding(id, {
    label, group: 'mail', ext,
    encode: [Encode.bytes, Encode.codec((b, o) => uuEncode(b, { table, name: o.name || 'data.bin', mode: /^[0-7]{3,4}$/.test(o.mode) ? o.mode : '644', frame: o.frame }),
      opt('name', 'data.bin'), opt('mode', '644'), opt('frame', true))],
    decode: [Encode.codec((s) => uuDecode(s, { table })), Encode.facts],
  });
}

// yEnc output is 8-bit (binary: true): returned as bytes, shown as Latin-1 text.
new DiscoverableEncoding('yenc', {
  label: 'yEnc', group: 'mail', note: 'binary', ext: 'yenc',
  encode: [Encode.bytes, Encode.tag(Encode.codec((b, o) => yencEncode(b, { name: o.name || 'data.bin', line: Math.max(32, Math.min(997, +o.line || 128)) }),
    opt('name', 'data.bin'), opt('line', 128, { min: 32, max: 997 })), { binary: true })],
  decode: [Encode.codec((v) => yencDecode(v)), Encode.facts],
});

new DiscoverableEncoding('quoted-printable', {
  label: 'Quoted-printable', group: 'mail', ext: 'qp',
  encode: [Encode.bytes, Encode.codec((b, o) => qpEncode(b, { binary: o.binary, lineLength: Math.max(4, Math.min(998, +o.line || 76)), eol: '\n' }),
    opt('binary', false), opt('line', 76, { min: 4, max: 998 }))],
  decode: [Encode.codec((s) => qpDecode(s))],
});

// --- URLs and domain names ---------------------------------------------------------------------------------------

new DiscoverableEncoding('percent', {
  label: 'Percent-encoding', group: 'web',
  encode: [Encode.bytes, Encode.codec((b, o) => percentEncode(b, { mode: o.pmode, lower: o.lower }),
    opt('pmode', 'component', { choices: choices('pmode', ['component', 'uri', 'form', 'all']) }), opt('lower', false))],
  decode: [Encode.codec((s, o) => percentDecode(String(s).trim(), { plus: o.plus }), opt('plus', false))],
});

// Punycode encodes text: a label ("bücher" -> "bcher-kva") or, with idna, a whole domain name ("xn--" labels).
// A label ("bücher" -> "bcher-kva") or, with IDNA or any "xn--" label present, a whole domain name; full-width dots (。．｡) count as separators.
new DiscoverableEncoding('punycode', {
  label: 'Punycode', group: 'web',
  encode: [Encode.text, Encode.codec((s, o) => (o.idna ? domainToASCII(s.trim()) : punycodeEncode(s)), opt('idna', false))],
  decode: [Encode.codec((s, o) => {
    const t = String(s).trim();
    return o.idna || /(^|[.。．｡])xn--/i.test(t) ? domainToUnicode(t) : punycodeDecode(t);
  }, opt('idna', false)), Encode.utf8],
});

export { Encode, DiscoverableEncoding, getEncodings, getEncoding, createEncoding };
