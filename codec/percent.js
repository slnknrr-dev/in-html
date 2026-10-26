// codec/percent.js - percent-encoding (RFC 3986 §2.1) of UTF-8 bytes.
//
//   percentEncode(bytes, { mode = 'component' | 'uri' | 'form' | 'all', lower = false }) -> string
//     component  keeps only the unreserved characters A-Z a-z 0-9 - . _ ~ (a path segment, query value…)
//     uri        also keeps the reserved delimiters : / ? # [ ] @ ! $ & ' ( ) * + , ; = (a whole URI)
//     form       application/x-www-form-urlencoded (HTML forms): keeps A-Z a-z 0-9 * - . _, space becomes '+'
//     all        every byte as %XX
//   percentDecode(text, { plus = false }) -> Uint8Array   plus: '+' means space (form data); a '%' without two hex
//                                                         digits stays literal
//
// Why not encodeURIComponent / encodeURI: they take strings, not bytes (cannot encode non-UTF-8 payloads), throw on
// lone surrogates, and encodeURIComponent keeps ! ' ( ) * which RFC 3986 counts as reserved. Working on bytes gives
// exact control per mode. Decoding is lenient on purpose (malformed '%' kept literally, like browsers' URL parser),
// while decodeURIComponent throws URIError on the first stray '%'.

// Single-character tests (no anchors needed: they run on one char). '-' escaped inside the class to be literal.
const UNRESERVED = /[A-Za-z0-9\-._~]/;
const RESERVED = /[:/?#[\]@!$&'()*+,;=]/;
const FORM = /[A-Za-z0-9*\-._]/;
const HEX = '0123456789ABCDEF';

// Bytes >= 128 never pass a keep-test (c is '' for them), so every UTF-8 continuation byte is escaped individually.
// Form mode checks space before escaping: '+' for 0x20 is the only substitution in any mode.
// Upper-case hex by default (RFC 3986 section 2.1 "should"); `lower` exists for byte-exact matching of other tools.
export function percentEncode(bytes, { mode = 'component', lower = false } = {}) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const c = b < 128 ? String.fromCharCode(b) : '';
    const keep = mode !== 'all' && c && (mode === 'form' ? FORM.test(c) : UNRESERVED.test(c) || (mode === 'uri' && RESERVED.test(c)));
    if (keep) out += c;
    else if (mode === 'form' && b === 32) out += '+';
    else {
      const h = '%' + HEX[b >> 4] + HEX[b & 15];
      out += lower ? h.toLowerCase() : h;
    }
  }
  return out;
}

// Unescaped characters are re-encoded as UTF-8 so the output is bytes throughout (a raw "é" in the input yields
// C3 A9, the same as "%C3%A9"). codePointAt + `i++` for astral characters: s[i] would split a surrogate pair and
// TextEncoder would turn each half into U+FFFD.
export function percentDecode(text, { plus = false } = {}) {
  const s = String(text);
  const out = [];
  const enc = new TextEncoder();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '%' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; continue; }
    if (c === '+' && plus) { out.push(32); continue; }
    const code = s.codePointAt(i);
    if (code > 0xffff) i++;
    for (const b of enc.encode(String.fromCodePoint(code))) out.push(b);
  }
  return Uint8Array.from(out);
}
