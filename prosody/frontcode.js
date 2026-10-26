// prosody/frontcode.js - reads the front-coded word lists of dict-en.js and dict-ru.js.
//
//   decodeFront(data, split) -> Map(word -> payload)
//   split(rest) -> [wordTail, payload]: where the word ends inside an entry (after the prefix-length character)

// Front coding: sorted words share long prefixes, so each entry stores only "how many leading chars to reuse from
// the previous word" (one char, code 48 + n) plus the new tail - roughly halves dictionary size before gzip and
// decodes in one linear pass. Entries depend on their predecessor, so the list must be read in order.
export function decodeFront(data, split) {
  const out = new Map();
  let prev = '';
  for (const e of data.split(',')) {
    if (!e) continue;
    const k = e.charCodeAt(0) - 48;
    const [tail, payload] = split(e.slice(1));
    const w = prev.slice(0, k) + tail;
    out.set(w, payload);
    prev = w;
  }
  return out;
}
