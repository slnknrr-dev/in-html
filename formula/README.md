# formula/

A spreadsheet formula engine for the workbook model of `xlsx/cells.js`: A1-style syntax with Excel function names,
array (dynamic-array) evaluation, a dependency graph with incremental recalculation, circular-reference detection and
spilled results. Pure ES modules; they work in Node and in a page. Number formats (`TEXT`) and date serials come from
`xlsx/`, text → number / date coercion from `csv/infer.js`.

## Files

| file | contents |
|---|---|
| `parser.js` | `tokenize`, `parseFormula(text) -> AST`, `printFormula(ast)`, `FormulaSyntaxError`, `translateFormula(text, dr, dc)`, `shiftFormula(text, { sheet, formulaSheet, axis, at, count })`, `renameSheetInFormula`, `dropSheetInFormula`, `mapRefs`, `translateAST`, `shiftAST`, `quoteSheet`, `normFuncName` |
| `values.js` | `Ref`, coercion `toNumber` / `toText` / `toBool` / `textToNumber`, `compare` / `equals` (spreadsheet order), `makeCriteria` (COUNTIF-style), `wildcardRe`, `numToText`, `round15` |
| `evaluate.js` | `evaluate(ast, ctx)`, operators with broadcasting, `FUNCTIONS` registry, `defineFunction`, `lift(signature, impl)`, `broadcast`, `deref`, `toMatrix`, `first`, `eachValue`, `numbers`, `numbersA`, `VOLATILE` |
| `functions.js` | math, aggregates, conditional aggregates, statistics, logic, information, text, date / time functions |
| `locale.js` | `localizeFormula(text, lang)`, `delocalizeFormula(text, lang)`, `parseLocalizedFormula`, `localFunctionName`, `canonicalFunctionName`, `FUNCTION_NAMES` / `ERROR_NAMES` / `BOOL_NAMES` (ru) |
| `lookup.js` | lookup, reference and dynamic-array functions |
| `engine.js` | `Engine`: `rebuild()`, `update(cells)`, `recalc()`, `evaluate(text, s, r, c)`, `precedents`, `dependents` |
| `test.js` | unit tests and a 200 000-formula workload: `node formula/test.js` (importing it runs nothing) |

## Syntax

Numbers (`1.5`, `.5`, `1E+3`), strings (`"a""b"`), `TRUE` / `FALSE`, error literals, references `A1`, `$A$1`,
`A1:B5`, whole columns `A:C` and rows `2:5`, sheet references `Sheet1!A1` and `'My sheet'!A1:B2`, defined names,
array constants `{1,2;3,4}`, function calls (`;` is accepted as an argument separator; `_xlfn.` / `_xlws.` prefixes
are dropped), missing arguments (`IF(A1,,1)`), parentheses and the operators in Excel precedence:
`:` range, unary `-` `+` (and `@` implicit intersection), `%`, `^` (left-associative, so `-2^2 = 4`), `* /`,
`+ -`, `&`, comparisons `= <> < > <= >=`. The printer writes the canonical text (upper-case names, no spaces, user
parentheses kept). Transforms move relative references for copy / sort (`translateFormula`), follow row / column
insertion and deletion (`shiftFormula`, deleted references become `#REF!`, ranges shrink or grow) and sheet renames.

## Localized formulas

Formulas are stored canonical (English names, `,` separators, `.` decimals) and shown in the user's language:
`localizeFormula('SUM(A1:A3,1.5)', 'ru')` → `СУММ(A1:A3;1,5)` and `delocalizeFormula` back, keeping the user's
spacing. The Russian table has the Excel ru-RU name of every registered function (`СУММЕСЛИМН`, `ВПР`, `ПРОСМОТРX`,
`СТАНДОТКЛОН.В` …), booleans `ИСТИНА` / `ЛОЖЬ` and error literals (`#Н/Д`, `#ЗНАЧ!`, `#ДЕЛ/0!` …). In the localized
form `;` separates arguments, `,` is the decimal mark and array constants use `\` between columns and `;` between rows
(`{1\2;3\4}`). Input may be in any case and with Е for Ё (`счетесли`). Cell references, sheet names, defined names and
strings are never translated; unknown function names pass through (and evaluate to `#NAME?`).

## Values and evaluation

Values are numbers, strings, booleans, `null` (blank), `CellError`, matrices (arrays of row arrays) and `Ref`
rectangles. Coercion follows Excel: blanks are 0 / "" / FALSE, numeric text and dates in text convert in arithmetic,
text in referenced ranges is skipped by aggregates while direct arguments are coerced; numbers compare to 15
significant digits (`0.1+0.2=0.3`); text compares case-insensitively; order is numbers < text < booleans.
Operators and scalar functions broadcast over arrays (dynamic arrays): `B1:B10*2`, `ISNUMBER(A1:A9)`,
`SUMPRODUCT((A1:A9>2)*B1:B9)`, `IF(range>0, "y", "n")`.

Functions (about 190): SUM, PRODUCT, AVERAGE(A), MIN(A), MAX(A), COUNT, COUNTA, COUNTBLANK, SUMSQ, SUMPRODUCT, MEDIAN,
MODE(.SNGL), VAR(.S/.P), VARP, STDEV(.S/.P), STDEVP, AVEDEV, DEVSQ, GEOMEAN, HARMEAN, LARGE, SMALL, RANK(.EQ),
PERCENTILE(.INC/.EXC), QUARTILE(.INC), CORREL, COUNTIF(S), SUMIF(S), AVERAGEIF(S), MAXIFS, MINIFS, ROUND, ROUNDUP,
ROUNDDOWN, MROUND, CEILING(.MATH), FLOOR(.MATH), TRUNC, INT, ABS, SIGN, MOD, QUOTIENT, POWER, SQRT, EXP, LN, LOG, LOG10,
PI, SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2, DEGREES, RADIANS, EVEN, ODD, FACT, GCD, LCM, RAND, RANDBETWEEN; IF, IFS,
IFERROR, IFNA, AND, OR, XOR, NOT, TRUE, FALSE, SWITCH, CHOOSE; ISBLANK, ISNUMBER, ISTEXT, ISNONTEXT, ISLOGICAL,
ISERROR, ISERR, ISNA, ISEVEN, ISODD, ISREF, NA, ERROR.TYPE, N, T, TYPE, ROW, COLUMN, ROWS, COLUMNS; LEN, LEFT, RIGHT,
MID, UPPER, LOWER, PROPER, TRIM, CLEAN, CONCAT, CONCATENATE, TEXTJOIN, SUBSTITUTE, REPLACE, FIND, SEARCH (wildcards),
VALUE, NUMBERVALUE, TEXT, FIXED, REPT, EXACT, CHAR, CODE, UNICHAR, UNICODE, TEXTBEFORE, TEXTAFTER, TEXTSPLIT; DATE,
TIME, TODAY, NOW, YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, WEEKDAY, WEEKNUM, ISOWEEKNUM, EDATE, EOMONTH, DAYS, DATEDIF,
DAYS360, NETWORKDAYS, WORKDAY, DATEVALUE, TIMEVALUE, YEARFRAC; VLOOKUP, HLOOKUP, LOOKUP, MATCH, XMATCH, XLOOKUP (all
match and search modes), INDEX (returns references), OFFSET, INDIRECT (A1 and R1C1), ADDRESS, HYPERLINK, TRANSPOSE,
UNIQUE, SORT, SORTBY, FILTER, SEQUENCE, TAKE, DROP, CHOOSECOLS, CHOOSEROWS, VSTACK, HSTACK.

Criteria (`COUNTIF` …): `5`, `">=10"`, `"<>x"`, `"a*"` / `"?b"` / `"~*"` wildcards, `""` (blank), `"<>"` (not blank),
dates in text (`">=2024-01-01"`), booleans. Exact lookups on vectors longer than 32 use a value → position index cached
per dereferenced range, so thousands of `VLOOKUP` / `XLOOKUP` / `MATCH` calls into one table stay linear.

## Engine

`new Engine(book, { now, random })` works directly on the model: formula cells are rich cells `{ f, v }` and the engine
writes `v`. A formula's record keeps its AST (reused while the text is unchanged — also after sorting, because the
record hangs off the cell object), the cells it reads and the ranges it reads; identical ranges share one dependency
entry, indexed by column (ranges up to 32 columns wide) or kept in a short list.

- `update(cells)` after edits: the transitive dependents are marked with a pass stamp (very wide fan-outs fall back to
  a full recalculation), ordered topologically (Kahn) over dense indices — range dependencies go through one virtual
  node per distinct range — and evaluated once each. Volatile functions (RAND, NOW, TODAY, OFFSET, INDIRECT, names)
  recalculate on every update.
- Cycles: Kahn stops at them; Tarjan's algorithm finds the strongly connected members, which get `#CIRC!`; formulas
  downstream then evaluate normally (the error propagates). Precedents that the static graph cannot know (INDIRECT,
  OFFSET, capped edges) are evaluated on demand with a depth cap.
- Spills: a matrix result fills empty neighbours with ghost cells `{ v, sp: ownerCell }`; a non-empty neighbour gives
  `#SPILL!` (re-checked on every update); changed ghost cells propagate to their dependents.
- `rebuild()` after structural edits (sorting, inserting / deleting rows or columns, sheets, renames).
- A whole range read is materialized once per pass (cache of dereferenced ranges); `A:A` stops at the last row.
- Measured in Node: 100 000 chained formulas plus 100 000 exact `VLOOKUP`s into a 100 000-row table rebuild in about
  2.5 s; a single edit at the head of the chain recalculates all 200 000 dependents in about 0.7 s; edits outside the
  chain are instant.

## Limits

- No R1C1 formula syntax (only `INDIRECT(…, FALSE)`), no structured references, LET / LAMBDA, 3D references
  (`Sheet1:Sheet3!A1`), union / intersection operators, iterative calculation, or financial / engineering /
  statistical-distribution functions.
- Approximate lookups use binary search like Excel and assume sorted data.
- `TEXT` uses English month names; numbers use `.` as the decimal mark in formulas (`locale.js` converts the Russian
  `,` form). Localized names: Russian only; the newest dynamic-array names follow Excel ru-RU as far as known.
