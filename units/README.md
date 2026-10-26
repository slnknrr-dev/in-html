# units/

Units of measurement for converters, forms and listings: a registry of eleven kinds of quantities (length, area,
volume, mass, temperature, speed, pressure, energy, power, data sizes, time) in metric, US customary and British
imperial units with affine conversion, labels and names in English, Russian and Georgian, parsing of quantities as
people type them, formatting with one rounding rule and the locale's separators, conversion tables and number → word
scales. Pure ES modules without dependencies: no DOM, they work in Node and in a page. Ported from the unit registry
and section scales of the KristinaHouse regional portal and extended.

## Files

| file | contents |
|---|---|
| `registry.js` | `KINDS`, `KIND_LABEL`, `SYSTEMS`, `SYSTEM_LABEL`, `BASE`, `UNITS` (`{ code: { kind, system, factor, offset, label, name, approx? } }`), `unit(code)`, `kindOf`, `baseUnit(kind)`, `inSystem(code, system)`, `unitsOfKind(kind, system?)`, `unitFor(kind, system)`, `unitPeer(code, system)`, `unitLabel` / `unitName(code, lang)`, `kindLabel`, `isKind` / `isSystem` / `normalizeKind` / `normalizeSystem`, `toNumber`, `toBase` / `fromBase`, `convert(v, from, to)`, `conversionOf(from, to)` → `{ factor, offset }` |
| `parse.js` | `parseNumber(s, { decimal })`, `normLabel`, `unitByLabel(label)`, `kindOfLabel(label)`, `parseQuantity(text, { kind, unit, decimal })` → `{ value, unit, kind, base, parts }`, `ALIAS_CONFLICTS` |
| `format.js` | `round(v, digits)`, `roundSignificant(v, n)`, `formatNumber(v, { lang, digits, significant, grouping })`, `formatQuantity(v, unit, { lang, digits, long, space })`, `show(base, kind, system, opts)`, `inputValue(base, kind, system)`, `LADDERS`, `humanize(v, unit, { system, binary })`, `formatCompound(v, unit, units, opts)`, `formatBytes(n, { binary })`, `formatDuration(seconds, { parts })` |
| `tables.js` | `convertAll(v, unit, { system })`, `conversionTable(from, to, { values \| start, step, count })`, `formulaText(from, to)`, `COMMON_PAIRS`, `kindList()` |
| `scales.js` | `SCALE_MODES`, `SCALE_MODE_NAME`, `cleanScaleKey`, `scaleI18n`, `normalizeScale(raw)`, `normalizeScales`, `mergeScales(chain)`, `scaleStepIndex(scale, n, { unit })`, `scalePick`, `scaleWord(scale, n, lang, { unit })`, `DISTANCE_SCALE` |
| `test.js` | unit tests: `node units/test.js` (importing it runs nothing) |

## Registry (registry.js)

- Every unit converts to the base unit of its kind by `base = value × factor + offset`. The offset exists only for
  temperatures, and the tests check temperatures away from zero (0 × k = 0 for any k, so a forgotten offset would pass
  a test at zero and turn 0 °C into 0 °F).
- Codes are unique across kinds (`m`, `m2`, `mps` for metres per second, `ms` for milliseconds), so `convert(v, from,
  to)` needs no kind and never converts by a wrong one. Different kinds, an unknown unit or a value that is not a
  number give `null` — a refusal, not a plausible number. An empty string is not zero.
- Systems: `metric`, `us`, `imperial`; a unit's own system may also be `customary` (shared by US and UK: inch, foot,
  pound, mph) or `other` (nautical mile, knot, carat, troy ounce, atmosphere, mmHg, kcal, data and time units: valid
  everywhere). The US and imperial gallon, quart, pint and fluid ounce are separate units; ton is short (US) or long
  (UK), tonne is metric.
- `unitFor(kind, system)` is the unit a system switch shows (named per kind, not "the first unit of the system").
  `unitPeer(code, system)` keeps the magnitude: km → mi, cm → in, ha → acre, l → gal (US) or gal (UK). A mileage of
  150 000 km must become 93 206 mi, not 492 125 984 ft.
- Exact factors: inch 0.0254 m, pound 0.45359237 kg, US gallon 231 in³, imperial gallon 4.54609 l, nautical mile
  1852 m, standard atmosphere 101 325 Pa, thermochemical calorie 4.184 J, IT BTU 1055.05585262 J, mechanical
  horsepower 745.69987… W, metric horsepower 735.49875 W. Month and year are Gregorian averages (`approx: true`).
- Currency is deliberately absent: rates change over time, a square metre does not.

## Parsing (parse.js)

- Numbers: "1 234,5", "1.234,5", "1,234.5", "1'234.5", "42,5", "−3", "1,5e-3", "½", "3¾", "1/4". With both separators
  the last one is decimal; a single comma or point is decimal unless it groups thousands more than once
  (`{ decimal: '.' }` decides for "1,234").
- Labels are matched after `normLabel` (NFKC so ² → 2, lower case, dots and spaces collapsed, "кв." / "კვ." / "square"
  → `sq`, "куб." / "კუბ." / "cubic" → `cu`). Every label and name of the registry plus a list of spellings in three
  languages are aliases; a few case-sensitive ones are kept apart (`K` kelvin, `B` byte, `MW` megawatt). The test
  checks that no alias is claimed by two units. An unknown label has no kind ("шт.", "pcs"): guessing would allow
  converting what must not be converted.
- Quantities: "42,5 м²", "3 sq ft", "-40 °F", "85 კვ. მ", "15 სოტკა", "100 км/ч", "1 1/2 in", and compounds of one
  kind: "5'11\"", "5 ft 11 in", "1 ч 30 мин", "2 kg 300 g" (the result is in the first unit; "-5 ft 6 in" is -5.5 ft).

## Formatting (format.js)

- One rounding rule: two decimals, trailing zeros removed ("78.97 m²", "120 m²"). Rounding belongs to display only:
  stored values keep full precision, because 850 sq ft → 78.967584 m² → exactly 850 sq ft, while a value rounded
  before storing comes back as 850.0044. `inputValue` gives an edit field the value in the system the author typed it.
- Numbers use `Intl.NumberFormat` (Russian and Georgian: decimal comma, no-break space groups) with a fallback table
  for engines without `Intl`. A non-number prints `''`, never "NaN m²".
- `humanize` picks the unit of a ladder (`mm cm m km`, `in ft mi`, `cm² m² ha km²`, bytes decimal or binary, `ms s min
  h d`) where the value is at least 1; `formatCompound` splits into whole parts with carrying (5 ft 12 in → 6 ft).

## Scales (scales.js)

A scale turns a number into a word: `exact` (a word per value) or `upto` (steps "up to N" ascending; a step without a
number is "otherwise" and may use `{n}`). Normalisation drops repeated numbers and a second "otherwise" and sorts the
steps. A scale knows no units unless it names one (`unit: 'm'`); then `scaleWord(scale, 0.5, 'en', { unit: 'km' })`
converts before comparing. `DISTANCE_SCALE` (close / nearby / walking distance / far) is the example. The portal's
"euro-layout" room scale is real-estate vocabulary and was left out of this library.
