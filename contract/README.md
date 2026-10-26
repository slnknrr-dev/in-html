# contract

**Contract templates.** A template model with typed fields, modifiers (toggles), levels (enumerated variants such
as strictness), conditional and repeatable text, computed values and per-language texts with a main language; the
billing-period calculator of leases; numbers, money and dates as contracts write them; built-in validators and a
sandboxed runner for a template's own JavaScript validator; rendering to HTML (A4 paper, print CSS); compilation of a
template into one self-contained offline HTML fill-in page. Pure ES modules (Node and browsers); only `form.js`,
`page.js` and `runUserValidator` touch the DOM / workers, and only when called. Used by
[`agreement-constructor/`](../agreement-constructor/).

## The template language

Clause texts are plain text with placeholders and blocks (`syntax.js`), expressions are interpreted, never evaluated
as JavaScript (`expr.js`):

```
{{tenant.name}}                       a field (dotted ids and parts of composite values: term.end, schedule.total)
{{rent | words}}  {{rent | money}}    filters: words, money, moneyWords, num, date:'short', upper, lower, cap, initials,
{{n | plural:'день','дня','дней'}}    plural, g (gender agreement with a party), table, inline, details, default, yesno, raw
{{rent * depositMonths | moneyWords}} any expression: + - * / % comparisons && || ! ?: and functions (round, sum,
                                      count, min, max, addDays, addMonths, days, months, join, if, default …)
{{#deposit}}  {{#}}                   the number of a clause / section (appendices have their own counter)
[[if poa]] … [[elif x]] … [[else]] … [[end]]          conditions (modifiers, levels, fields)
[[each services as s]] {{index}}. {{s.name}} [[end]]   lists
**bold**, a line break, an empty line (new paragraph), Tab (a right-aligned second column: place and date)
```

Sections are `numbered` (1., 1.1.), `plain`, `appendix` (new page, "Appendix N") or `signatures` (columns); sections
and clauses have a `when` condition; a clause bound to a level (`by: 'strictness'`) has a text per option. Field types:
text, longtext, number, money (currency), date, period (start + months or a move-out date), select, bool, party (person
or organisation with passport, address, INN, representative… and their full legal description), docref (kind,
number, date, issuer, validity: notarial / simple power of attorney, agency agreement…), list (typed columns, tables
with totals), computed (expression), schedule (payment schedule from a term and an amount).

## Billing periods

`billingSchedule({ start, months | end, anchorDay, amount, prorata, dueOffset })`: every period runs from day D of a
month to day D−1 of the next one; the first starts on the start date, the last ends the day before the move-out date
(start + months, clamped to the month end). Start 23 Jan 2027, 11 months: 23 Jan – 22 Feb, 23 Feb – 22 Mar, …,
23 Nov – 22 Dec; move-out 23 Dec. Anchors are always taken from D (a lease from the 31st: 31 Jan – 27 Feb, 28 Feb –
30 Mar, 31 Mar – 29 Apr), leap days clamp, a move-out between anchors or another anchor day gives partial periods
charged by days (`prorata`) or in full.

## Modules

| module | contents |
| --- | --- |
| `model.js` | template and document shapes, `normalizeTemplate` / `normalizeDoc` (never throw, bounded), `newTemplate`, `newDocument`, JSON export / `parseImport` |
| `syntax.js` | the clause text language: `parseText` (cached, errors as nodes), `textRefs`, `clauseRefs`, `placeholders` |
| `expr.js` | the expression language: `parseExpr`, `parsePipe`, `evaluate` (own properties only, bounded), `refsOf`, `FUNCTIONS` |
| `fields.js` | field values by type (`coerceValue`, `defaultValue`, `isEmptyValue`), `resolvePath`, `collectRefs`, `syncFields` (fields extracted from the text, types guessed from names), `inferField` |
| `env.js` | the evaluation scope of a filled template: values, modifiers, levels, computed fields (cycle detection), schedules; records the fields the active text reads |
| `render.js` | `renderContract` → HTML, the outline, used fields, fallbacks of missing translations, errors; bilingual layout; `formatValue`, `FILTERS` |
| `period.js` | `billingSchedule`, `termOf` |
| `dates.js` | ISO dates: parsing, day numbers, adding days / months with clamping, differences |
| `words.js` | numbers in words (ru, uk with gender and plural agreement; en), currencies and their units |
| `format.js` | numbers, money with the amount in words, legal dates («23» января 2027 г.), plurals, initials |
| `validate.js` | `validateDoc` (required, ranges, dates, masks with check digits: passport, INN, SNILS, OGRN, BIC, account, phone, e-mail…), `runUserValidator` (Blob worker, network objects removed, timeout), `userValidatorCore`, `cleanIssues` |
| `langs.js` | `addLanguage` (optionally from the main text), `removeLanguage`, `setMainLanguage`, `translationStatus` |
| `dict.js` | the words of contracts and forms in seven languages: party phrases, schedule tables, validation messages, compiled page UI |
| `css.js` | `paperCSS(page)` (sheet, typography, tables, signatures, appendices, chips, print, @page), `formCSS`, `pageCSS` |
| `form.js` | the fill-in form (DOM): one control per field type, issues under fields, focus kept across rebuilds |
| `compile.js` | `compileTemplate` → one HTML file (data, CSS, prerendered contract, the bundled runtime, CSP `connect-src 'none'`), `compileStatic` |
| `page.js` | the runtime of compiled pages (`boot(data)`): modifiers, levels, languages, form, live preview, checks, autosave, data JSON, print |
| `lease.js` | the built-in residential lease (ru main, en) |
| `samples.js` | `SAMPLES`: the lease, a services agreement, a receipt for a deposit, a simple power of attorney |

## Compiled pages

`compileTemplate(tpl, { lang, runtime })` writes the template's data, its CSS and the prerendered contract into one
page; `runtime` is `page.js` bundled for another host (`new URL('../contract/page.js?bundle', import.meta.url)` in an
application, `assetBundle` of `bundle.js` in Node), which the page calls through
`globalThis[Symbol.for('bundle:page.js')].boot(data)`. The page declares `connect-src 'none'`, carries no external
resource and passes the zero-network audit; the template's validator runs in a Blob worker there too.

## Checks

```
node check.js tests contract
node check.js modules contract
```

## Limits

- Words for amounts exist for Russian, Ukrainian and English; other languages print digits and the currency code.
- Names are not declined: phrases are written so that names stay in the nominative ("от имени которого действует …").
- The user validator is sandboxed best-effort (a worker without DOM, storage or network objects, killed after 1.5 s);
  compiled pages add a CSP that forbids connections.
