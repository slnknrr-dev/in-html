// codec/quoted-printable.js - Quoted-Printable (RFC 2045 §6.7): printable ASCII kept, other bytes and '=' as =XX,
// whitespace before a line end encoded, soft line breaks "=" keep lines within 76 characters.
//
//   qpEncode(bytes, { binary = false, lineLength = 76, eol = '\r\n' }) -> string   text mode keeps the input's line
//            breaks as hard breaks (eol); binary mode encodes CR and LF as =0D / =0A
//   qpDecode(text) -> Uint8Array   soft breaks removed, =XX decoded (either case), trailing whitespace of lines dropped,
//            malformed '=' sequences kept literally

//
// Encoder strategy: emit tokens (one literal char or one "=XX" triplet) and break softly between tokens, never inside
// a triplet - splitting "=3D" across lines would corrupt it. RFC 2045 rule 3: a space/tab at the end of a line must be
// encoded, because mail transports strip trailing whitespace.
// Decoder strategy: robust (RFC 2045 recommends it) - strip trailing whitespace, keep malformed '=' as literal.

// Upper-case hex is mandatory on output (RFC 2045: "uppercase letters must be used"); decoder accepts both.
const HEX = '0123456789ABCDEF';
const esc = (b) => '=' + HEX[b >> 4] + HEX[b & 15];

export function qpEncode(bytes, { binary = false, lineLength = 76, eol = '\r\n' } = {}) {
  const lines = [];
  let cur = '';
  // Appends one token, breaking softly before it when the line would exceed the limit (the '=' counts).
  const put = (tok) => {
    if (cur.length + tok.length > lineLength - 1) { lines.push(cur + '='); cur = ''; }
    cur += tok;
  };
  const hard = () => { lines.push(cur); cur = ''; };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (!binary && (b === 13 || b === 10)) {
      if (b === 13 && bytes[i + 1] === 10) i++;
      hard();
      continue;
    }
    // Text mode: CR, LF or CRLF become one hard break (normalised to eol). atEnd = the next byte ends the line, so a
    // space/tab here must be escaped (=20 / =09). Note that whitespace just before a SOFT break is not escaped, but
    // it is followed by '=' on the same line, so it is not trailing - transports will not strip it.
    const atEnd = i === bytes.length - 1 || (!binary && (bytes[i + 1] === 13 || bytes[i + 1] === 10));
    if ((b === 32 || b === 9) && !atEnd) put(String.fromCharCode(b));
    else if (b >= 33 && b <= 126 && b !== 61) put(String.fromCharCode(b));
    else put(esc(b));
  }
  lines.push(cur);
  return lines.join(eol);
}

// Line ends normalised to '\n' first, then each line: trailing whitespace dropped (added by transports, never data),
// a final '=' marks a soft break (no CRLF emitted), otherwise CRLF between lines (canonical MIME line end).
// Unencoded characters should be ASCII; anything else is accepted best-effort.
// KNOWN DEFECT: characters U+0080..U+00FF are pushed as one Latin-1 byte, while characters above U+00FF are UTF-8
// encoded - inconsistent; and since the loop walks UTF-16 units, an astral character is encoded as two lone
// surrogates (each -> EF BF BD). Fix: iterate by code point and UTF-8 encode every non-ASCII character.
export function qpDecode(text) {
  const s = String(text).replace(/\r\n?/g, '\n');
  const out = [];
  const lines = s.split('\n');
  lines.forEach((raw, li) => {
    const line = raw.replace(/[ \t]+$/, '');
    let soft = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '=') {
        if (i === line.length - 1) { soft = true; break; }
        const h = line.slice(i + 1, i + 3);
        if (/^[0-9A-Fa-f]{2}$/.test(h)) { out.push(parseInt(h, 16)); i += 2; continue; }
        out.push(61);
        continue;
      }
      const x = c.charCodeAt(0);
      if (x > 255) for (const b of new TextEncoder().encode(c)) out.push(b); else out.push(x);
    }
    if (!soft && li < lines.length - 1) out.push(13, 10);
  });
  return Uint8Array.from(out);
}
