// schema/text.js - the small value cleaners every schema module shares: multilingual labels ({ en, ru, ka } with
// two-letter keys, trimmed and capped), picking a label for a language with fallbacks, the shape of keys (lower-case
// Latin, digits, underscore; a key is never invented for the user - a bad one is rejected), slug lists.
//
//   cleanKey(v) -> 'key' | ''          (/^[a-z][a-z0-9_]{0,39}$/ after trimming and lower-casing)
//   cleanFieldKey(v) -> 'key' | ''     (letters of any script, digits, underscore, 1..64: keys of user-made fields)
//   i18n(v, max = 200, defLang = 'en') -> { lang: text }   (a plain string becomes { [defLang]: string })
//   pick(labels, lang, fallbacks = ['en']) -> text            (lang, then fallbacks, then any non-empty)
//   slugList(v, cap = 20) -> ['slug', …]                     (array or comma list; unique, cleaned)

// Rejecting instead of slugifying: a silently rewritten key ("Floor Area" -> "floor_area") would collide or drift from
// the key the user believes they set; stored values are addressed by it forever.
export const cleanKey = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,39}$/.test(s) ? s : '';
};

// \p{L}\p{N} with the u flag: user-made fields may be named in Georgian or Cyrillic. Not lower-cased: for scripts
// with case the user's spelling is kept verbatim, uniqueness is by exact string.
export const cleanFieldKey = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[\p{L}\p{N}_]{1,64}$/u.test(s) ? s : '';
};

// Only two-letter keys: labels are UI text in a small language set; regional variants are not modelled here (unlike
// i18n/text.js for documents). Objects / arrays as values are dropped, numbers are stringified.
export function i18n(v, max = 200, defLang = 'en') {
  const out = {};
  if (typeof v === 'string') { const s = v.trim().slice(0, max); if (s) out[defLang] = s; return out; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (!/^[a-z]{2}$/.test(k) || x == null || typeof x === 'object') continue;
    const s = String(x).trim().slice(0, max);
    if (s) out[k] = s;
  }
  return out;
}

// Last resort is any non-empty label: showing a Russian label to an English user beats an empty column header.
export function pick(labels, lang = 'en', fallbacks = ['en']) {
  if (!labels || typeof labels !== 'object') return typeof labels === 'string' ? labels : '';
  if (labels[lang]) return labels[lang];
  for (const f of fallbacks) if (labels[f]) return labels[f];
  return Object.values(labels).find((x) => typeof x === 'string' && x) || '';
}

export function slugList(v, cap = 20) {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(',');
  const out = [];
  for (const x of raw) {
    const s = String(x ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}
