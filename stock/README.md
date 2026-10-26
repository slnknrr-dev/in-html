# stock/

Inventory maths of a retail network: ABC / XYZ analysis with the 3×3 matrix and service levels, safety stock from
the inverse normal distribution, replenishment planning (targets, warehouse-first allocation, supplier lots,
schedules and holidays, one order per supplier), sell-through verdicts, batches with expiry dates (FEFO / FIFO,
markdowns, write-offs), stock valuation (average cost, moving average, FIFO) and a stock ledger reducer (receipts,
sales, transfers, write-offs -> stock now and cost now). Pure ES modules on plain arrays and objects: no DOM, no
Node APIs, no clock (callers pass `today` as `'YYYY-MM-DD'`). Money is always in integer minor units.

## Files

| file | contents |
|---|---|
| `calendar.js` | `dayNumber(day)`, `fromDayNumber(n)`, `isDay`, `addDays(day, n)`, `daysBetween(a, b)`, `weekday(day)` (1 = Mon … 7 = Sun), `weeksBack(day, today)`, `periodDays(from, to)` |
| `safety.js` | `zOf(p)` (Acklam inverse normal), `normCdf(z)`, `safetyUnits(z, sdDaily, leadDays)`, `safetyStock(cls, leadDays, service)` → `{ serviceLevel, z, safety }`, `reorderPoint(rate, lead, safety)` |
| `abc.js` | `BASES`, `CELLS`, `DEFAULT_SETTINGS`, `validateSettings(input)` → `{ settings, errors }`, `basisValue(item, basis)`, `abcClasses(items, opts)`, `variation(series)`, `xyzClass(weekly, opts)`, `weeklySeries(sales, { today, weeks })`, `historyWeeks(firstDay, today, weeks)`, `aggregateSales(lines, { today, weeks, firstDays, costs })`, `classify(items, settings)`, `abcMatrix(classes)`, `cellAdvice(cls)`, `serviceLevelOf(cls, service)` |
| `replenish.js` | `roundOrder(qty, { minQty, multiple })`, `orderCheck(supplier, day)`, `holidayAhead(supplier, day, windowDays)`, `SELL_THROUGH`, `sellThrough(sold, received)`, `verdict(rate)`, `supplierResolver({ nodes, suppliers, items })`, `planReplenishment({ today, days, rows, suppliers, warehouses, service })`, `coverDays(stock, rate)` |
| `batches.js` | `fefoOrder`, `fifoOrder`, `consume(batches, qty, { order })`, `consumeFefo`, `consumeFifo`, `addBatch`, `mergeBatches`, `restoreLatest(batches, qty)`, `transferBatches(from, to, qty)`, `daysLeft(expires, today)`, `batchState(expires, today, warnDays)`, `MARKDOWN_DEFAULTS`, `markdownRule(left, rules)`, `markdownFor(batches, rules, today)`, `markdownPrice(price, pct)`, `writeOffExpired(batches, today)`, `expirySummary(batches, today, warnDays)` |
| `valuation.js` | `roundMinor(x)`, `lineAmount(qty, unitCost)`, `averageCost(receipts)` → `{ qty, amount, unit }`, `averageValue(stock, receipts)`, `movingAverage(moves)`, `fifoValuation(moves)` → `{ layers, qty, value, cogs, short }`, `margin(revenue, cogs)` |
| `ledger.js` | `emptyLedger()`, `applyEvent(state, event)` (pure), `buildLedger(events, { strict })`, `checkEvent(state, event)`, `stockNow(state, object, item)`, `costNow(state, object, item)`, `stockOf(state, object)`, `inTransit(state, to, item)`, `negativeStock(state)` |
| `test.js` | unit tests: `node stock/test.js` (importing it runs nothing) |

## ABC / XYZ (abc.js, safety.js)

- ABC ranks items by revenue, gross profit (revenue − qty × unit cost) or quantity. The class is decided by the
  cumulative share **before** the item (`< aCut` → A, `< bCut` → B, else C), so the first item is always A even if it
  alone makes 90 %; zero and negative values are always C. Defaults: A 80 %, B 95 %.
- XYZ is the coefficient of variation (population σ ÷ mean) of weekly quantities: `≤ xMax` X, `≤ yMax` Y, else Z
  (defaults 0.25 / 0.5). Only the weeks since the item's first sale count, and an item with fewer than `minWeeks`
  (8) weeks of history has no XYZ class (its cell is `null`, its advice `'new'`): leading zero weeks of a new item
  must not look like erratic demand. `aggregateSales` builds the inputs from sales lines `{ id, day, qty, price }`.
- `abcMatrix` counts and sums the 9 cells plus `A-`, `B-`, `C-` (items without XYZ). Advice: AX / BX `auto`
  (automatic reordering is safe), AZ `watch`, CZ `delist`.
- Each cell has a service level (AX 98 % … CZ 80 %). Safety stock = ⌈z(level) × σ_day × √lead⌉ with
  σ_day = σ_week ÷ √7; a lead time under a day counts as one day.

## Replenishment (replenish.js)

- `planReplenishment` takes rows per store × item (sold over the window, stock, in transit, on order, cover days,
  the item's supplier, an optional ABC/XYZ class or explicit safety stock). rate = sold ÷ days; target =
  ⌈rate × (lead + cover + holiday days)⌉ + safety, where the holiday is the supplier's next holiday starting within
  lead + cover days (its stock must be bought before it); need = target − stock − in transit − on order.
- Warehouses cover needs first, most urgent stores first (fewest days of stock left, then the biggest need), in
  whole units. The remaining shortage is rounded up to the supplier's minimum lot and then to its multiple.
- Orders are grouped by supplier, with lines per receiving store, amounts (qty × purchase price), `canOrder`, the
  next allowed order day by the supplier's weekdays and holidays, the delivery date, and warnings
  (`off_schedule`, `holiday`, `before_holiday`).
- `supplierResolver`: an assortment entry (best priority, then lowest price, with its own lead time and price)
  wins over the supplier set on the item or inherited from the nearest category above it.
- Sell-through = sold ÷ received: ≥ 100 % `more`, < 70 % `less`, else `keep`.

## Batches (batches.js)

FEFO takes the nearest expiry first (batches without expiry last), FIFO the earliest receipt. Customer returns go to
the latest-expiring batch; receipts merge with a batch of the same number and expiry; transfers move the consumed
batches to the receiver. Markdown rules `[{ days, pct }]` pick the rule with the fewest days that still covers the
days left of the nearest batch; expired stock gets no markdown (it is written off). All operations return new arrays.

## Valuation and ledger (valuation.js, ledger.js)

- `averageCost` is the "cost now" summary: the average of receipts with a known cost; issues do not move it.
  `movingAverage` issues at the current average and lets the last unit take exactly the remaining value;
  `fifoValuation` consumes the oldest layers and reports the cost of goods sold.
- The ledger state holds stock per object × item (the signed sum of all movements), the cost summary, transfers
  and warnings. A transfer leaves the sender when sent (`pending`, counted by `inTransit` at the receiver); `accept`
  makes it a receipt at the receiver at the cost it was sent with (the sender's cost now when the line had none);
  `reject` returns it to the sender. A count records the difference to the counted quantity. `buildLedger` in
  default mode applies oversells (an offline sale already happened) and lists a `negative` warning; `strict: true`
  refuses them like the server does (`insufficient_stock`). Quantities are kept to 6 decimals (weight goods).
