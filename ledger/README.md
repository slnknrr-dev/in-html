# ledger/

Money of a managed property: integer minor units with explicit rounding, parties and roles, the split cascade
(percent / fixed / rest), an immutable journal with reversals, balances, statements and owner reports, the calculation
web (a graph of money flow: validation, cycles, evaluation, journal lines, a diagram), period KPIs (nights clipped to
the period, occupancy, ADR, RevPAR per currency), payout plans, building expenses split across flats, cross rates
through a base currency and CSV export. Pure ES modules: no DOM, no clock, no network; every date is an explicit ISO
day. Uses `../payments/money.js` (ISO 4217 exponents), `../csv/csv.js` (CSV writing) and `../diagram/graph.js` (only
`webview.js`).

## Files

| file | contents |
|---|---|
| `minor.js` | `MONEY_MAX`, `ROUNDING`, `cleanCurrency`, `toMinor(v, cur)`, `fromMinor`, `moneyText(m, cur, lang)`, `decimalText(m, cur)`, `mulDiv(a, b, d, mode)`, `roundNumber(x, mode)`, `allocate(total, weights)`, `minorUnits` |
| `parties.js` | `PARTY_ROLES`, `isPartyRole`, `partyRole`, `roleLabel`, `cleanId`, `sameId`, `normalizeParty({ role, ref, name, note })`, `partyName`, `LEDGER_ARTICLES`, `LEDGER_ARTICLE_I18N`, `cleanArticle`, `cleanArticleName`, `articleNames(rules)`, `articleLabel(article, names, lang)`, `LEDGER_KINDS`, `isLedgerKind`, `kindLabel` |
| `split.js` | `PCT_SCALE`, `PCT_FULL`, `toPct`, `fromPct`, `SPLIT_METHODS`, `normalizeSplitRule`, `normalizeSplit`, `distribute(base, rules, { rounding, exact })` → `{ rows, allocated, unallocated }`, `allocationOp(row)` |
| `journal.js` | `normalizeOp`, `appendOps(journal, ops)`, `reverseOp(journal, id, { day, note })`, `reversedIds`, `ledgerBalance(ops, { currency })`, `dueByCurrency(ops, party)`, `currenciesOf`, `statement(ops, party, { from, to, currency })`, `ownerReport`, `byArticle` |
| `period.js` | `isIsoDay`, `dayNum`, `dayIso`, `addDays`, `daysBetween`, `monthEnd`, `periodOf({ month } \| { from, to })`, `periodDays`, `inPeriod`, `stayNights`, `clipNights(from, to, period)`, `monthsOf` |
| `kpi.js` | `periodKpis(stays, ops, { period, owners, agency, units })`, `nightShare`, `occupancyText`, `payoutPlan(due, only)`, `payoutOps(plan, { partyId, day })`, `splitExpense(total, units, { by })`, `ownerKey` |
| `web.js` | `normalizeWeb`, `webOrder`, `validateWeb(web, { bound })`, `webErrors`, `evalWeb(web, { booking, surplus }, { nights, rounding })`, `webOps`, `webJournal(web, ev, { day, currency, ref })`, `starFromSplit`, `bindWeb`, `webHash`, `resolveWeb`, `starterWeb`, `emptyWeb`, `WEB_LIMITS` |
| `webview.js` | `webGraph(web, { ev, lang, currency, partyNames })` → a `../diagram/` graph (`graphSVG` draws it), `edgeRuleText` |
| `rates.js` | `normalizeRates({ base, rates })`, `crossRate`, `convert`, `convertMinor(minor, from, to, table, { rounding })`, `rebase`, `toPairs`, `sumIn` |
| `export.js` | `csvText(rows, { bom })`, `statementCsv(st, { lang, names })`, `journalCsv(ops, { lang })`, `kpiCsv(kpis)` |
| `test.js` | unit tests: `node ledger/test.js` (importing it runs nothing) |

## Money

- Amounts are integers in the currency's minor units (ISO 4217 exponent: GEL / USD / EUR 2, JPY 0, KWD 3). `toMinor`
  reads numbers and typed text (`'1 234,56'`, `'1.234,50'`) and rounds on the decimal digits, so `1.005` is 101, not
  100; junk is 0, never `NaN`; `MONEY_MAX` (10¹² minor units) stops a typo long before the 2⁵³ limit.
- Every division is `mulDiv(a, b, d, mode)` — exact through BigInt — with one of `half-up` (half away from zero, the
  default), `half-even`, `floor`, `ceil`, `trunc`. `allocate` is the largest-remainder split: parts are floors of the
  exact shares and the leftover units go to the largest remainders (ties to the earlier weight), so the parts always
  sum to the total (100.00 over three flats is 33.34 + 33.33 + 33.33).
- Currencies are never added together. Balances and statements take one currency; ops of another one are counted in
  `otherCurrency` so an incomplete statement says so.

## Split cascade (split.js)

An ordered list of rules `{ partyId, article, method, value }`; percentages are hundredths of a percent (`7000` = 70 %).
`pct` is taken from the base (not from what is left), `fixed` is minor units, `rest` takes the difference — including
the rounding unit — so with a rest the rows always equal the base. Without a rest the shortfall is `unallocated`; fixed
amounts above the base make the rest negative (a debt). `exact: true` computes the pct rows together (rounded total
percentage, split by largest remainder). Normalisation is idempotent: `value` is canonical, `pct` / `amount` are form
input, told apart by name; a second rest becomes `pct 0`. `allocationOp` turns the sign of a share into the journal
kind (a negative rest is a deduction).

## Journal (journal.js)

Operations `{ id, day, kind, partyId, article, amount, currency, ref, reverses, note }` with a positive amount; the kind
gives the direction (`accrual` adds, `deduction` and `payout` take away). `appendOps` and `reverseOp` return a new
array and never edit an operation: a mistake is cancelled by a reversal (`reverses`), both lines stay visible and both
are out of every sum. A statement covers `[from, to]` with both days included, lists every row (voided ones flagged),
carries the running `balance` from the `opening` balance and ends with `closing`; `refs` counts distinct references
behind the accruals (bookings). `byArticle` groups by the article key, not by its translation.

## Calculation web (web.js)

Nodes `source` (`booking`, `surplus`), `pool` (passes everything on) and `party` (keeps what is left); edges `pct` (of
the node's inflow), `fixed` (per booking / night / month = 30 nights; optionally guaranteed: paid in full by a party
that then goes negative; otherwise the shortfall is a `debt` on the edge) and `rest`. Inside a node: fixed, pct, rest,
then `ord`. `validateWeb` reports errors (`no_booking_source`, `source_unused`, `cycle`, `pool_dead_end`,
`party_unbound`, `party_not_assigned`) and warnings (`unreachable`, `may_stick`, `pct_over_100`,
`guarantee_needs_party`). `evalWeb` gives flows, inflows, what each node keeps and the money stuck in sources / pools;
money is conserved (tested on random webs). `webOps` gives one signed line per party × article; `webJournal` turns it
into journal operations. `starFromSplit` makes the same shares as `distribute`; `webHash` (FNV-1a) ignores canvas
positions and labels; `bindWeb` binds template roles to parties and names the missing roles.

## Periods and KPIs (period.js, kpi.js)

Revenue and shares belong to the period of the check-in day (as the journal accrues them); nights, occupancy (permille
of `days × units`), ADR and RevPAR count the nights inside the period, with the stay's total spread evenly over its
nights (`nightShare`). A stay counts when its status is empty or `confirmed`; `pending` is counted apart. Per currency:
gross, surplus, night revenue, nights, ADR, RevPAR, the agency's accruals, the owner's accrued / deducted / paid / net
and all deductions (expenses). `payoutPlan` pays only positive balances; `splitExpense` splits a building expense by
area, share or equally.

## Rates (rates.js)

A table `{ base, rates: { X: units of X per 1 base } }` brought by the caller. `crossRate` goes from → base → to;
`convertMinor` converts minor units between different exponents with an explicit rounding mode; `toPairs` gives the
`'GEL:USD'` form of `../payments/money.js`.
