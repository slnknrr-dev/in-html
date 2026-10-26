// fileapi/range.js - HTTP byte ranges (RFC 9110 section 14).
//
//   parseRange(header, size) -> null | { start, end } | 'unsatisfiable'
//     null            no header, another unit than bytes, or a syntactically invalid header (the request is answered
//                     with the whole representation, status 200, as the RFC requires for an invalid Range)
//     { start, end }  inclusive offsets: 'bytes=0-499', open 'bytes=500-' (to the end), suffix 'bytes=-500' (the
//                     last 500 bytes); an end past the size is clamped. Multiple ranges ('bytes=0-1,5-9') are not
//                     answered as multipart/byteranges: the first satisfiable range is served alone (media elements
//                     and tag readers only ask for one)
//     'unsatisfiable' no range overlaps the representation (answer 416 with contentRange(null, null, size))
//   contentRange(start, end, size) -> 'bytes 0-499/1234', or 'bytes */1234' when start is null

// Two-phase parse: validate ALL specs first (one malformed spec makes the whole header invalid -> null -> 200), then
// pick the first satisfiable one. The 100-part cap bounds work against "bytes=0-0,0-0,..." abuse (a known DoS
// pattern against servers that build multipart responses). Number() of a huge digit string is Infinity, which the
// comparisons below treat correctly (start >= size -> skipped; end clamped).
const SPEC = /^\s*(\d*)\s*-\s*(\d*)\s*$/;

export function parseRange(header, size) {
  if (typeof header !== 'string' || !header) return null;
  const m = /^\s*bytes\s*=(.*)$/i.exec(header);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (!parts.length || parts.length > 100) return null;
  const specs = [];
  for (const p of parts) {
    const r = SPEC.exec(p);
    if (!r || (r[1] === '' && r[2] === '')) return null;
    const a = r[1] === '' ? null : Number(r[1]);
    const b = r[2] === '' ? null : Number(r[2]);
    if (a !== null && b !== null && b < a) return null;
    specs.push([a, b]);
  }
  for (const [a, b] of specs) {
    if (a === null) {
      // Suffix: the last b bytes.
      if (b === 0 || size === 0) continue;
      return { start: Math.max(0, size - b), end: size - 1 };
    }
    if (a >= size) continue;
    return { start: a, end: b === null ? size - 1 : Math.min(b, size - 1) };
  }
  return 'unsatisfiable';
}

export const contentRange = (start, end, size) => (start === null || start === undefined ? `bytes */${size}` : `bytes ${start}-${end}/${size}`);
