# regexp/

Regular expressions as data: a full ECMAScript `RegExp` parser with source ranges and precise errors, structured
explanations, railroad diagrams, static warnings, safe evaluation (a Worker with a time limit), syntax highlighting,
a curated pattern library and code snippets for seven languages. Pure ES modules: importing them in Node touches no
DOM (`node -e "import('./regexp/parse.js')"`); only `createRunner()` uses `Worker` / `Blob` when they exist.

| file | contents |
|---|---|
| `parse.js` | `parseRegExp`, `parseFlags`, `splitLiteral`, `walk`, `childrenOf`, `nodesAt`, `mayContainStrings`, `MESSAGES`, `FLAGS`, `FLAG_NAMES`, `STRING_PROPERTIES`, `RegExpSyntaxError` |
| `explain.js` | `explain`, `explainPath`, `quantifierForm`, `propertyNames`, `flagList`, `charDisplay`, `codeLabel`, `GENERAL_CATEGORY`, `SCRIPTS` |
| `diagram.js` | `diagram`, `diagramSVG` |
| `run.js` | `evaluate`, `evaluateSync`, `createRunner` |
| `lint.js` | `lint`, `LINT_CODES` |
| `highlight.js` | `tokenize`, `segments` |
| `patterns.js` | `PATTERNS`, `CATEGORIES`, `findPattern` |
| `validators.js` | `VALIDATORS`, `VALIDATOR_CATEGORIES`, `sampleOf`, `findValidator` |
| `numbers.js` | `numberPattern`, `NUMBER_PRESETS`, `ALPHABETS`, `alphabetOf`, `parseAlphabet`, `alphabetText`, `formatNumber`, `rangeSequences`, `DEFAULTS` |
| `wordlist.js` | `wordListPattern`, `alternation`, `charClass`, `escapeLiteral`, `escapeChar`, `escapeClassChar` |
| `test.js` | unit tests: `node regexp/test.js` (validators with oracles, number ranges, word lists) |
| `codegen.js` | `snippets`, `translate`, `translateReplacement`, `LANGUAGES`, `NOTE_CODES` |

## Parser (`parse.js`)

```js
import { parseRegExp } from '../regexp/parse.js';

const r = parseRegExp('(?<year>\\d{4})-(\\d\\d)', 'gu');
// { ok: true, source, flags: { raw: 'gu', global: true, unicode: true, … }, ast, groups, groupCount: 2, names: ['year'], error: null }
parseRegExp('a(b', '').error;
// { code: 'unterminatedGroup', message: 'Unterminated group', part: 'pattern', start: 1, end: 3, params: null }
```

`parseRegExp(source, flags)` never throws on bad input. Syntax: ES2025 — flags `d g i m s u v y`; named groups,
duplicate names in different alternatives; lookahead / lookbehind; back-references `\1` and `\k<name>`; `\u{…}`,
surrogate pairs in Unicode mode; `\p{…}` / `\P{…}` (General_Category, Script, Script_Extensions, binary properties
and, with `v`, properties of strings); `v`-mode classes with `&&`, `--`, nested classes and `\q{…}`; quantifiers
`* + ? {n} {n,} {n,m}` and their lazy forms; modifiers `(?ims-ims:…)`; and the Annex B rules without `u` / `v`
(`\1` as a legacy octal escape when there is no group 1, `\8`, identity escapes, `\c` fallbacks, `{` and `]` as
literals, quantified lookaheads, `[\d-z]`, `\k` only special when the pattern has named groups).

Unicode property names and values are validated by the host engine: its Unicode database is the one that will run
the pattern. Everything else is checked by the parser. It agrees with `new RegExp` on a corpus of ~1 200 hand-made
patterns and ~180 000 generated ones (all flag modes).

**AST.** Every node has `type`, `start`, `end` (UTF-16 offsets into the source).

| type | fields |
|---|---|
| `Pattern`, `Group`, `CapturingGroup`, `Lookaround` | `alternatives: Alternative[]`; `Group.modifiers` (`{ add, remove, start, end }` or null); `CapturingGroup.index`, `name`, `nameStart`, `nameEnd`; `Lookaround.kind` (`'lookahead'`/`'lookbehind'`), `negate` |
| `Alternative` | `elements` |
| `Quantifier` | `min`, `max` (`Infinity` when unbounded), `greedy`, `qStart` (where the quantifier token starts), `element` |
| `Assertion` | `kind`: `'start'` (^), `'end'` ($), `'word'` (\b, `negate` for \B) |
| `Character` | `value` (code point with u / v, code unit otherwise), `escape`: `null`, `'identity'`, `'control'`, `'controlLetter'`, `'hex'`, `'unicode'`, `'unicodeBrace'`, `'null'`, `'octal'`, `'backspace'`, `'backslash'` |
| `CharacterSet` | `kind`: `'any'` (.), `'digit'`, `'space'`, `'word'`, `'property'` (`key`, `value`, `strings`); `negate` |
| `CharacterClass` | `negate`, `unicodeSets`, `kind` (`'union'`, `'intersection'`, `'subtraction'`), `elements` (characters, `ClassRange { min, max }`, sets, nested classes, `ClassStringDisjunction { alternatives: ClassString[] }`) |
| `Backreference` | `ref` (number or name), `named`, `groups` (the group indexes it may refer to) |

Error codes (`MESSAGES` holds English texts): `flagInvalid`, `flagDuplicate`, `flagsUV`, `escapeAtEnd`,
`unterminatedGroup`, `unmatchedParen`, `unterminatedClass`, `nothingToRepeat`, `invalidQuantifier`,
`loneQuantifierBracket`, `incompleteQuantifier`, `quantifierOrder`, `invalidGroup`, `invalidGroupName`,
`duplicateGroupName`, `invalidNamedReference`, `unknownGroupName`, `invalidBackreference`, `invalidModifiers`,
`repeatedModifier`, `invalidEscape`, `invalidUnicodeEscape`, `invalidDecimalEscape`, `invalidPropertyName`,
`rangeOrder`, `invalidClassRange`, `invalidClassChar`, `invalidClassOperation`, `negatedClassStrings`. Flag errors
have `part: 'flags'` and offsets into the flags string.

Helpers: `splitLiteral('/a\\/b/gi')` → `{ source: 'a/b', flags: 'gi' }`; `walk(node, visit)`; `childrenOf(node)`;
`nodesAt(ast, offset)` → the chain of nodes containing an offset; `mayContainStrings(classElement)`.

## Explanations (`explain.js`)

`explain(parsed)` → a tree `{ kind, start, end, params, children }` without prose; applications render each kind in
their language. Kinds: `pattern`, `alternation { count }`, `alternative { index, empty }`, `literal { text }` (runs
of plain characters), `char { char, cp, code, escape, name }` (`name`: `lf`, `tab`, `nbsp`, `zwj`… for invisible
characters), `any { dotAll }`, `set { set, negate }`, `property { key, value, negate, keyLong, valueLong, binary,
strings }`, `class { negate, op, empty }`, `range { from, to }`, `strings`, `string`, `group { index, name }`,
`noncapture`, `modifiers { add, remove }`, `lookahead` / `lookbehind { negate }`, `start` / `end { multiline }`,
`boundary { negate }`, `quantifier { min, max, greedy, form }` (`form`: `opt`, `star`, `plus`, `exact`, `atLeast`,
`between`), `backref { ref, named, groups }`, `empty`. `explainPath(tree, offset)` returns the nodes containing an
offset. `propertyNames(key, value)` gives long names (`Lu` → `Uppercase_Letter`, `sc=Grek` → `Script` / `Greek`).

## Railroad diagrams (`diagram.js`)

`diagram(parsed, options)` → `{ svg, width, height }` (`diagramSVG` returns the markup only). Sequences, alternation
(curved branches), repetition loops with a back arrow and a `min–max ×` caption, skip paths for optional parts,
lazy marks, capture groups and lookarounds as captioned frames, classes as "one of / none of" lists, anchors,
back-references. Options: `label(key, params)` for localized captions (keys: `title`, `start`, `end`, `any`,
`anyNl`, `digit`, `notDigit`, `word`, `notWord`, `space`, `notSpace`, `property`, `notProperty`, `oneOf`,
`noneOf`, `intersection`, `subtraction`, `group`, `namedGroup`, `modifiers`, `lookahead`, `negLookahead`,
`lookbehind`, `negLookbehind`, `lineStart`, `inputStart`, `lineEnd`, `inputEnd`, `wordBoundary`,
`notWordBoundary`, `backref`, `lazy`, `empty`, `strings`, `times`), `measure(text, 'mono' | 'sans')` (exact text
widths, e.g. from a canvas; a character-count estimate otherwise), `idPrefix`, `title`, `desc`, `vars` (custom
property values baked into the file), `background`, `scale`.

The SVG has `role="img"`, a `<title>` and a `<desc>`; colours come from CSS custom properties with fallbacks
(`--rx-dg-line`, `--rx-dg-lit`, `--rx-dg-lit-b`, `--rx-dg-lit-t`, `--rx-dg-set*`, `--rx-dg-anc*`, `--rx-dg-ref*`,
`--rx-dg-grp*`, `--rx-dg-look*`, `--rx-dg-cap`, `--rx-dg-hot`, `--rx-dg-mono`, `--rx-dg-font`), so it follows the
page theme inline and stands alone as a file. Every node carries `data-s` / `data-e` (its source range) and a
`<title>` with its source text; the class `rr-hot` on a node highlights it.

## Running (`run.js`)

`evaluate(job)` → `{ matches, count, truncated, indices, output?, pieces?, parts?, ms }` or `{ error }`. Job fields:
`source`, `flags`, `text`, `mode` (`'match'`, `'replace'`, `'split'`), `replacement`, `splitLimit`, `names` (group
names by number), `limit` (listed matches, 5000), `budget` (soft time budget in ms, checked between matches).

- Matches follow the engine: all of them with `g`, else the first one; empty matches advance by one code unit (code
  point with u / v). Each match has `index`, `end`, `text` and `groups: [{ n, name, start, end, text }]`; offsets
  come from the `d` flag (added automatically), with a text search as the fallback.
- Replace implements GetSubstitution (`$$`, `$&`, `` $` ``, `$'`, `$1`…`$99` with the two-digit rule, `$<name>`)
  and returns `output` plus `pieces: [{ text, replaced }]`; it equals `String.prototype.replace`.
- Split implements `RegExp.prototype[Symbol.split]` and tags captured parts: `parts: [{ text, capture }]`; it equals
  `String.prototype.split`.

`evaluate` is self-contained (its parameter, locals and built-ins only). `createRunner({ timeout = 1000, grace = 120 })`
serializes it into a Worker made from a Blob URL (no network) and returns `{ run(job) → Promise, terminate(), mode }`:
a job that runs past `timeout` resolves `{ timeout: true }` and the stuck worker is terminated (the next job gets a
fresh one); a newer job supersedes a waiting one (`{ cancelled: true }`) and interrupts one that already runs longer
than `grace`. Without `Worker` (Node, tests) `mode` is `'inline'` and jobs run synchronously (`evaluateSync`).

## Warnings (`lint.js`)

`lint(parsed)` → `[{ code, severity: 'danger' | 'warn' | 'info', start, end, params }]`, most severe first.

| code | finds |
|---|---|
| `nestedQuantifier` (danger) | an unbounded repetition whose body holds a variable repetition and no delimiter the inner repetitions cannot consume — `(a+)+`, `(\w+\s?)+`, `(x+x+)+` (not `(\s*,\s*\w+)*` or `(?:\d{3})+`) |
| `overlappingAlternatives` (danger) | repeated single-character alternatives that overlap — `(\w|\d)+` |
| `adjacentQuantifiers` | neighbouring unbounded repetitions of overlapping characters — `\d+\d+`, `.*.*` |
| `duplicateAlternative`, `emptyAlternative`, `emptyGroup`, `emptyClass`, `anyClass` (`[^]`, `[\s\S]`), `classOverlap`, `suspiciousRange` (`[A-z]`) | structure |
| `unknownEscape` (`\e`, `\A`… with a hint), `uselessEscape`, `octalEscape`, `loneControl`, `classBackspace` | escapes |
| `braceEscapeNoUnicode` (`\u{…}`), `propertyNoUnicode` (`\p{…}`), `astralNoUnicode` | Unicode syntax without u / v |
| `backrefEmpty`, `impossibleAnchor`, `greedyEnds`, `leadingWildcard`, `lazyAtEnd`, `quantifierOne`, `quantifierZero`, `quantifierShorthand`, `quantifiedAssertion`, `flagUnused` | semantics and style |

The backtracking checks use character-set algebra over code point ranges (`\d`, `\w`, `\s`, `.`, classes, case
folding for `i`; property escapes are approximated by letter / digit, space or punctuation sets).

## Highlighting (`highlight.js`)

`tokenize(source, flags)` works on any text, valid or not: `{ spans: [{ start, end, type, depth?, group? }], pairs,
groups }`. Types: `lit`, `esc`, `set`, `cls`, `clsch`, `range`, `op`, `grp`, `name`, `look`, `mod`, `quant`, `alt`,
`anchor`, `ref`, `err`; `group` is the capture number of group parentheses, names and references, `depth` the
nesting level; `pairs` lists matching brackets. `segments(source, spans, marks)` splits the source into
consecutive pieces carrying the token type and extra marks (an error range, a selection).

## Pattern library (`patterns.js`)

`PATTERNS`: 30 entries `{ key, cat, source, flags, sample, name, desc, tab?, replacement? }` — email, URL, domain,
IPv4, IPv6, MAC, ISO date, ISO date-time (named groups), 24-hour time, UUID, card-like digits, E.164 phone, slug,
HTML element (back-reference), JSON string, decimal number, thousands separators (lookahead + replace), repeated
words, trimming, whitespace runs, camelCase boundaries (split), price after a currency sign (lookbehind), hex colour,
SemVer, Markdown link, web server log line, Unicode hashtag (`\p{…}`), emoji (`\p{RGI_Emoji}`, v flag), password
rules (lookaheads) and a catastrophic-backtracking demo. `CATEGORIES`, `findPattern(key)`. Applications localize
names by `key`.

## Validators (`validators.js`)

`VALIDATORS`: 62 strict validators of standard formats `{ key, cat, std, flags, source, valid, invalid, name, desc }` in
10 categories (`VALIDATOR_CATEGORIES`): network (IPv4 strict / zero-padded / CIDR, IPv6 in every RFC 4291 form, full
form, with a zone, CIDR, port, host:port), MAC addresses (colons, hyphens, one consistent separator via a
back-reference, Cisco dots, bare, EUI-64, unicast, locally administered), web (RFC 1123 host name, FQDN, RFC 3986 URI,
RFC 9110 http(s) URL, RFC 8141 URN, media type with parameters, HTTP token, BCP 47 language tag, slug), email
(RFC 5321 complete with quoted local parts and address literals, practical, RFC 6531 internationalized, RFC 5322
name-addr), date and time (calendar date with leap years, RFC 3339 date-time, ordinal date, ISO week date with the
real 53-week years, 24 h / 12 h time, ISO 8601 duration, HTTP date), identifiers (UUID forms and versions, SemVer, JWT,
E.164, IBAN, payment card brands), numbers (JSON number, Roman numerals, latitude / longitude), encodings (canonical
Base64, Base64url, Base32, hex, hash digests by length), crypto (Bitcoin and XRP address formats) and systems (Unix
user name, portable and Windows file names, JavaScript identifier).

Rules, checked by `test.js`: anchored `^…$` (the m flag lets a sample hold one candidate per line); no wildcards
(no `.`, `[\s\S]`, negated classes or `\D \W \S`); lengths from the standards (DNS labels ≤ 63, local part ≤ 64,
address ≤ 254…) or a stated practical limit; no ambiguous repetition (the linter finds no backtracking risk and
adversarial inputs stay under a few milliseconds); parts in named groups, with the rules that would need one name
twice (month lengths, leap years, 53-week years, paired braces) checked in a lookahead before the capturing part.
Oracles in the tests: Node's `net.isIPv4` / `isIPv6`, every date of 1896–2104 and Feb 29 of 0000–9999, ISO week counts
of 1–9999, Buffer's Base64, the RFC 4648 codec, the official SemVer pattern, the JavaScript parser for identifiers and
Roman numeral arithmetic.

## Number generator (`numbers.js`)

`numberPattern(options)` → `{ source, flags, valid, invalid, notes }` or `{ error, params }`. A digit alphabet lists
the characters of each value — a value may have several (`A|a` is ten, `〇|零` zero) — from `ALPHABETS` (binary,
octal, decimal, hex in either or both cases, base 36, Unicode decimal digits of 19 scripts, any of them at once,
Chinese numerals with their financial forms) or `parseAlphabet("0 1 … 9 A|a …")`. Options (`DEFAULTS`): `kind`
integer / decimal; `sign` none / minus / both / required with the `minus` and `plus` characters; `min` / `max` —
exact integer ranges of any size in any base (BigInt), built from per-position digit intervals with adjacent
alternatives merged and runs of full digits folded (`[1-9][0-9]{0,17}`), negative magnitudes selected by a lookbehind
on the minus so that one `int` group serves both signs; `leadingZeros` no / yes (up to the width of the range) /
pad (fixed `width`); `maxDigits`; `grouping` none / optional / required with `groupStyle` western, Indian or myriad
and the `groupSep` characters (separators sit exactly at group boundaries, ranges included); `decimalSep`,
`fracMax`, `leadingDot`, `trailingDot`; `exponent` with `expMarker`; `prefix` / `suffix` lists with a mode;
`anchor` line / string / find (find adds Unicode-aware boundaries that also keep integers out of decimals and
unsigned numbers away from a minus); `groups` (named groups sign, prefix, int, frac, exp, suffix). The examples are
generated with random variant characters and checked against the pattern. `NUMBER_PRESETS`: uint8 … int64, C-like
double, JSON, hex byte, hex / binary literals, percentage, grouped, European, Swiss, Indian, Arabic-Indic, Persian,
Devanagari, Chinese, any script.

## Word lists (`wordlist.js`)

`wordListPattern(words, { caseless, whole: 'word' | 'line' | 'none', name })` builds a prefix tree: alternatives never
start with the same character, leaves become classes and endings optional suffixes (`cat, car, cart` →
`ca(?:t|rt?)`); 'word' boundaries are Unicode-aware lookarounds.

## Code snippets (`codegen.js`)

`snippets(parsed, { text, replacement })` → `[{ id, name, code, notes: [{ code, params }] }]` for JavaScript, Python
(`re`), Go (`regexp`), Java (`java.util.regex`), C# (.NET), PHP (PCRE) and Rust (`regex` crate): compile, list the
matches (all with `g`, else the first), replace when a template is given. `translate(parsed, flavour)` rewrites the
pattern: named groups (`(?P<…>)`, `(?P=…)`), escapes (`\u{…}` → `\U…` / `\x{…}` / surrogate pairs, `\cX`, `\0`,
`\v`, octal), `$` without m (`\Z`, `\z`, PHP's `D`), ASCII `\d` / `\w` where the flavour is Unicode-aware, `[^]`,
`[]`, literal `[` `&&` inside classes, PHP delimiters, Java / Rust set operations; flags become options or inline
`(?ims)`. `translateReplacement(template, parsed, flavour)` converts `$&`, `$1`, `$<name>`, `$$`. Note codes
(`NOTE_CODES`): `noLookaround`, `noBackrefs`, `lookbehindFixed`, `lookbehindBounded`, `noUnicodeProperty`,
`propertyPartial`, `noStringProperty`, `noSetOperations`, `duplicateNames`, `groupNameChars`, `sticky`,
`asciiSpace`, `unicodeShorthands`, `unicodeBoundary`, `byteOffsets`, `replaceContext`, `replaceFirst`,
`repeatLimit`, `astralUtf16`.

## Limits

- Property names follow the running engine's Unicode version; the explanation tables name the common scripts only
  (others are shown as written).
- The backtracking warnings are heuristics: they flag the classic shapes, not every slow pattern, and the time limit
  of the runner is the real safety net.
- Code translation covers the syntax differences listed above; behaviour differences that cannot be rewritten are
  reported as notes (it does not emulate JavaScript semantics in other engines).
