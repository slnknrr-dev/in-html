// html/escape.js - HTML escaping: escapeHTML (text), escapeAttr (attribute values), decodeEnt (the entities
// they produce).
//
// Both escapers encode all five significant characters regardless of context, so one function is safe in text,
// double-quoted and single-quoted attributes alike. Unquoted attributes are never generated (unsafe with any escaper).
// '&#39;' rather than '&apos;': &apos; is not an HTML 4 entity and some old consumers (email clients) show it literally.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHTML(s) {
  return s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}
// Newlines become &#10;: a raw newline in an attribute survives HTML parsing, but this output is also embedded in
// one-line contexts (JSON strings, data URIs, whitespace-collapsing minification) where it would be mangled.
function escapeAttr(s) {
  return s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ESC[c]).replace(/\r?\n/g, '&#10;');
}

// Inverse of the escapers only (plus &#x27; from other producers), not a general entity decoder. Decoding more would
// turn an escaped '&lt;' typed by a user back into markup, so the restricted set is deliberate.
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
const decodeEnt = (s) => s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ENT[m]);

export {
  decodeEnt,
  escapeAttr,
  escapeHTML
};
