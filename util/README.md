# util

**Utilities.** Value coercion and safe lookups, ids, fuzzy matching, identifier normal forms, search stems.
Tests: `node util/test.js`.

| module | contents |
| --- | --- |
| `id.js` | short random ids. |
| `value.js` | small coercion and lookup helpers (no dependencies). |
| `fuzzy.js` | `damerau` / `levenshtein` with a cut-off, `similarity`, `typoBudget`, `fold`, `closest` / `bestMatch` ("did you mean"). |
| `ident.js` | `normalizeMac` (MAC / BSSID), `normalizeIPv4`, `normalizeIPv6` (RFC 5952), `normalizeIp`, `normalizeCode`, `normalizeIdent`, `compactIdent`. |
| `stem.js` | light Russian / English stemmer `stem`, `words`, `searchKeys`, prefix-scored `matchScore` for search. |
| `test.js` | unit tests (importing it runs nothing). |

The header comment of each module documents its API.

## Fuzzy matching

`damerau` is the optimal-string-alignment distance (insert, delete, substitute, swap two neighbours) over code
points; with `max` it stops as soon as a whole row exceeds it and returns `max + 1`. `closest(word, list)` compares
folded forms (lower case, ё → е, no accents) within `typoBudget` edits (0 up to 2 letters, 1 up to 5, else 2) and sorts
by distance, then by the length difference (a full form wins over a stem), then by list order.

## Identifiers

MAC addresses are stored `AA:BB:CC:DD:EE:FF` from any of the common spellings; IPv6 follows RFC 5952 (lower case,
no leading zeros, the longest zero run of two or more groups as `::`, IPv4-mapped addresses with a dotted tail;
brackets and `%zone` accepted); IPv4 drops leading zeros. `compactIdent` is the search key: `aa-bb` finds
`AA:BB:…`.

## Stems

`stem` cuts Russian derivational suffixes (-ение, -ость, -ировать…) and endings while at least 3–4 letters remain,
and English -ies / -ing / -ed / -es / -s. `matchScore` requires every query key to be a prefix of some word of the
title, section or body: a title hit weighs 5, body hits count up to 10 per key. For morphology proper see
`lingua/morph-ru.js`.
