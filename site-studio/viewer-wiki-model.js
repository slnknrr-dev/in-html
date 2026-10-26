// site-studio/viewer-wiki-model.js - the knowledge base settings of a site document (doc.wiki):
//   layers  [{ id, label, on }]  toggles readers switch (translations, transcription, glosses…); wiki blocks carry
//                                 `layer`, wiki markup marks inline text {{layer|id|…}}
//   ruby    layer id of furigana / ruby text {漢字|かんじ} ('' = always shown)
//   alias   { name: page id }     other names wiki links may use for a page (the address a page had in a knowledge
//                                 base before its address was made ASCII, an old title)
// Layer ids become CSS attribute-selector values and storage keys at runtime: a strict lowercase charset makes them
// safe in both without escaping. The same regex guards block `layer` values (viewer-blocks-wiki.js).
const LAYER_RE = /^[a-z][a-z0-9-]{0,31}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Normalizer contract: total (any input -> valid shape), idempotent, bounded (40 layers, 5000 aliases, length caps) so
// an imported or hostile document cannot bloat every exported page. Duplicates keep the first occurrence; ruby must
// name an existing layer or is cleared.
export function normWiki(v) {
  const w = isObj(v) ? v : {};
  const layers = [];
  const seen = new Set();
  for (const l of Array.isArray(w.layers) ? w.layers : []) {
    if (!isObj(l) || !LAYER_RE.test(String(l.id)) || seen.has(l.id) || layers.length >= 40) continue;
    seen.add(l.id);
    layers.push({ id: l.id, label: String(l.label == null ? '' : l.label).slice(0, 80), on: l.on !== false });
  }
  const alias = {};
  let n = 0;
  if (isObj(w.alias)) {
    for (const [k, id] of Object.entries(w.alias)) {
      if (n >= 5000 || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || !k || k.length > 200) continue;
      // Lowercased keys: wiki link lookup (pageIndex) is case-insensitive.
      alias[k.toLowerCase()] = id;
      n++;
    }
  }
  return { layers, ruby: LAYER_RE.test(String(w.ruby)) && seen.has(w.ruby) ? w.ruby : '', alias };
}
