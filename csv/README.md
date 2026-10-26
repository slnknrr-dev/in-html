# csv/

Delimiter-separated values and typed values from text. Pure ES modules: no DOM access, they work in Node and in a
page. Used by the Sheets processor (`sheets-processor/`) and by the formula engine for text → number / date
coercion.

## Files

| file | contents |
|---|---|
| `csv.js` | `parseCSV(text, { delimiter, quote, maxRows })`, `serializeCSV(rows, { delimiter, quote, newline, quoteAll, guard })`, `sniffCSV(text)`, `hasHeader(rows)`, `CSVParser` (`push(chunk)` / `end()`), `parseCSVAsync(text, { sliceRows, onProgress, signal })` |
| `encoding.js` | `detectEncoding(bytes)`, `decodeBytes(bytes, { encoding })`, `encodeText(text, { encoding, bom })` |
| `infer.js` | `parseNumber(text, decimal)`, `parseBool`, `parseDate(text, order)`, `dateSerial(parts)`, `detectColumn(values, { decimal, dateOrder })`, `convertValue`, `convertColumn`, `inferValue(text)` |
| `mapping.js` | `HEADER_SYNONYMS` (ru / en / ka), `normHeader`, `suggestMapping(headers, targets, synonyms, { min, fuzzy })`, `parseFlag`, `parseLooseNumber`, `parseLooseDate(text, { order, serials })`, `coerceField(field, text)` |
| `test.js` | unit tests: `node csv/test.js` (importing it runs nothing) |

## Parsing (RFC 4180, lenient)

- Fields are quoted with `"` (or the given quote; `''` disables quoting); a doubled quote is a literal quote; quoted
  fields may contain delimiters, CR, LF and CRLF. Records end with CRLF, LF or a lone CR.
- A trailing newline does not create an empty record; empty lines in between are kept as `['']`.
- Lenient where real files are sloppy: characters after a closing quote are appended to the field
  (`"ab"c` → `abc`), an unterminated quote takes the rest of the text. A leading BOM is dropped.
- The scanner jumps with `indexOf` / a sticky character-class regexp instead of walking characters one by one.
- Large inputs: `CSVParser.push(chunk)` returns the records completed so far and keeps the unfinished record
  (including a quote or CR at the chunk edge) for the next chunk; `parseCSVAsync` parses a whole text in slices of
  `sliceRows` records with a macrotask between slices and reports progress (0..1).
- `serializeCSV` quotes fields containing the delimiter, the quote, CR / LF or leading / trailing spaces;
  `guard: true` prefixes `'` to text starting with `= + - @` (formula injection) unless it is a plain number.

## Sniffing

`sniffCSV(text)` looks at the first 64 KiB: the delimiter (`,` `;` tab `|`) whose records have the most consistent
field count greater than one wins (ties: the list order); `'` is the quote only when it clearly encloses fields;
the newline style is counted; `header` comes from `hasHeader`.

`hasHeader(rows)` votes per column in the spirit of Python's `csv.Sniffer`: a column whose body is numbers / dates /
booleans while the first cell is text votes for a header; fixed-width text columns vote by the first cell's length;
duplicate labels vote against. Without evidence, distinct text labels that never repeat in their column are a header.

## Encodings

BOMs (UTF-8, UTF-16 LE / BE) first; BOM-less UTF-16 is recognised by the zero bytes of Latin / Cyrillic text; then a
strict (fatal) UTF-8 decode; otherwise a single-byte legacy file: windows-1251 when high bytes come in runs (Cyrillic
words), windows-1252 when they sit between ASCII letters (accented Latin). `encodeText` writes UTF-8 (optionally with
a BOM, which Excel needs to recognise UTF-8 CSV) or UTF-16 LE / BE.

## Type inference

- Numbers: decimal point or comma, grouping by `,` `.` space, no-break / thin space or `'` in groups of three,
  scientific notation, `+` / `-` / `−` signs, accounting negatives `(42)`, percent `12.5%` (→ 0.125), currency signs
  `$ € £ ¥ ₽ ₴ ₾ ₹ ₩ ₺ ₪ ₫ ฿` before or after. More than 15 significant digits stay text (identifiers, card numbers);
  so do integers with leading zeros in column detection (`007`).
- Dates: ISO `yyyy-mm-dd` (with `T` / space time, seconds, fractions, `Z` / offsets ignored), `yyyy/mm/dd`,
  `dd.mm.yyyy` (always day first), `mm/dd/yyyy` or `dd/mm/yyyy` (order from the column — a part above 12 decides —
  else the locale hint), `5 Mar 2024`, `March 5, 2024`, times `14:30`, `2:30:15 PM`. Two-digit years: 00–29 → 20xx.
  Values become 1900-system serial numbers (`xlsx/cells.js`).
- Booleans: `true` / `false` and their spreadsheet spellings in the repository's UI languages (ИСТИНА, WAHR, VRAI…).
- `detectColumn` samples up to 2000 values spread over the column and picks the first type that explains at least
  95 % of them (all of them below 20 values): boolean, number (the decimal mark that explains more values; ties go to
  the hint), date, else text. It returns a suggested number format (`#,##0.00`, `0.0%`, `"€"#,##0.00`,
  `dd.mm.yyyy`, `yyyy-mm-dd hh:mm`, …). Values that do not convert stay text.

## Column mapping

`suggestMapping(headers, targets)` proposes which column feeds which field of an import. Headers are normalised
(lower case, ё → е, punctuation → spaces) and compared with the field key, its label, its own `synonyms` and the
dictionary (`HEADER_SYNONYMS`: name, code, barcode, category, quantity, unit, price, amount, currency, date, place,
person, firstName, lastName, email, phone, address, city, note in Russian, English and Georgian; pass your own
dictionary as the third argument). An exact match scores 1, a synonym of four or more letters as a whole word 0.85,
inside a word 0.7, a near spelling (`util/fuzzy.js` similarity ≥ 0.8) 0.6 × the similarity. Pairs under `min` are
dropped; the rest are assigned best first, one header per field (several for `multi: true` fields), and every
assignment is returned with its score and how it matched.

Coercions for values whose type the user already chose (looser than the per-column `detectColumn`):
`parseFlag` (1 / 0, да / нет, yes / no, так / ні, კი / არა, + / -, ✓, x, on / off, вкл / выкл, ИСТИНА / ЛОЖЬ),
`parseLooseNumber` (the later of `.` / `,` is the decimal mark, a lone comma is decimal unless it groups thousands
twice), `parseLooseDate` (ISO, d.m.y, d/m/y by default, Excel serial numbers 20000–80000 as they are) and
`coerceField` (number, bool, date, multiselect split on `;` / `,`, select matched case-insensitively).

## Limits

- Single-character delimiters and quotes; no comment lines or escape characters other than doubled quotes.
- Legacy encodings detected: windows-1251 / windows-1252 only (other code pages can be forced with
  `decodeBytes(bytes, { encoding })`, which accepts any `TextDecoder` label).
- Month names in dates: English only.
