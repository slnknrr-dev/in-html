// codec/base64.js - strict base64 of attachment payloads: b64encode(bytes) (chunked, multi-MB safe),
// b64decode(text) (base64url accepted), isB64(text).
//
// Contract: asymmetric on purpose. Output is always canonical standard base64 with padding (what data: URIs and
// embedded <script> payloads need); input is liberal (whitespace, url-safe alphabet, missing padding) because pasted
// text arrives in every dialect. Validation is a separate predicate (isB64) for places that must refuse rather than
// repair - e.g. before splicing a string into HTML.
// Built on btoa/atob (native, fast) rather than a JS table loop; the only work here is working around their limits:
// binary strings instead of bytes, and argument-count limits of fromCharCode.apply.

// Strict standard base64 (attachment payloads): nothing that could break out of <script>, url() or a data: URI.
// The alphabet excludes quotes, '<', ')', whitespace and '-'/'_' (url-safe is NOT accepted here, only by the decoder).
// Length % 4 === 0 enforces padding, so a truncated payload is rejected rather than silently shortened.
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const isB64 = (s) => typeof s === 'string' && s.length > 0 && s.length % 4 === 0 && B64_RE.test(s);

// Chunked (multi-MB safe): 24 KiB input chunks (multiple of 3) concatenate into valid base64.
// Why multiple of 3: each chunk then encodes without '=' padding, so chunk outputs join into one valid string; any
// other size would put padding in the middle.
// Inner 8 KiB slices (0x2000) for fromCharCode.apply: apply spreads the array as arguments and engines cap argument
// count (~65k in V8, lower in some), throwing RangeError on large inputs. A per-byte += loop would avoid that too but
// is several times slower on multi-MB attachments.
function b64encode(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const CH = 0x6000;
  const parts = [];
  for (let i = 0; i < u.length; i += CH) {
    const sub = u.subarray(i, i + CH);
    let bin = '';
    for (let j = 0; j < sub.length; j += 0x2000) bin += String.fromCharCode.apply(null, sub.subarray(j, j + 0x2000));
    parts.push(btoa(bin));
  }
  return parts.join('');
}

// Normalise then decode in 32 KiB character chunks: whitespace stripped, url-safe '-'/'_' mapped to '+'/'/', padding
// dropped and re-added per chunk. Chunks are multiples of 4 chars so each decodes independently; only the last can be
// short and gets padded back. Output is preallocated at the upper bound 3/4·len and trimmed with subarray (a view,
// no copy) if padding made it shorter.
// Error policy: invalid characters reach atob, which throws InvalidCharacterError - fail-fast, but the message is the
// browser's, not ours. A 4k+1 remainder (impossible in base64) also makes atob throw.
function b64decode(str) {
  const s = String(str || '').replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  const CH = 0x8000; // multiple of 4
  let o = 0;
  for (let i = 0; i < s.length; i += CH) {
    let part = s.slice(i, i + CH);
    if (part.length % 4) part += '==='.slice(0, 4 - (part.length % 4));
    const bin = atob(part);
    for (let j = 0; j < bin.length; j++) out[o++] = bin.charCodeAt(j);
  }
  return o === out.length ? out : out.subarray(0, o);
}

export {
  b64decode,
  b64encode,
  isB64
};
