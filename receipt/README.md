# receipt/

Point-of-sale maths: exact money in integer minor units with explicit rounding modes, VAT included in prices (per
line and per rate), the cart and check totals with line and whole-check discounts, payments with loyalty points,
card and cash (change, cash rounding), returns linked to the original check, cash shift X / Z reports, the best price
of an item with promotions, price-tag data, a loyalty points ledger with segments and RFM scores, and plain-text
receipts for 58 mm / 80 mm thermal printers. Pure ES modules on plain arrays and objects: no DOM, no Node APIs, no
clock (callers pass days and times).

## Files

| file | contents |
|---|---|
| `money.js` | `divRound(a, b, mode)`, `mulDivRound(a, m, b, mode)` (BigInt beyond 2^53), `qtyMilli(qty)`, `lineAmount(qty, price)`, `percentOf(amount, pct)`, `allocate(total, weights)` (largest remainder), `parseMoney(text, digits)`, `formatMoney(minor, { digits, decimal, group, plus })`, `roundCash(amount, step)` |
| `vat.js` | `vatIncluded(amount, rate)`, `vatOnTop(net, rate)`, `netOf(amount, rate)`, `vatBreakdown(lines, { method: 'line' \| 'rate' })` → `{ rates, exempt, vat, gross }`, `addBreakdown(a, b, sign)`, `emptyBreakdown()` |
| `cart.js` | `addItem(cart, item, { qty, code })` → `{ cart, line, error }`, `setQty`, `removeLine`, `setLineDiscount`, `stockWarnings(cart)`, `computeCheck(cart, { discount, mode, vatMethod })` → `{ lines, subtotal, lineDiscounts, checkDiscount, discount, total, vat }` |
| `payment.js` | `settle(total, { points, card, cash }, loyalty, { cashStep })` → `{ payable, pointsValue, card, cashDue, cash, change, short, rounding, method, errors }`, `refundSplit(salePayment, salePayable, refund, alreadyCash)` |
| `returns.js` | `returnable(saleLines, previousReturns)`, `buildReturn(saleLines, request, previousReturns)` → `{ lines, total, vat, errors }`, `refundOf(sale, returnTotal, earlier)` → `{ points, pointsValue, money, cash, card }` |
| `doc.js` | `saleDoc(meta, cart, { discount, pay, loyalty, cashStep })`, `returnDoc(meta, sale, request, earlier)` (with `original: { number, fiscalNumber }`) |
| `shift.js` | `SHIFT_MAX_MS`, `shiftExpired(openedAt, at)`, `shiftReport(shift, docs, cashOps, at)` (X), `checkCashOp(report, kind, amount)`, `zReport(report, countedCash, extra)` |
| `price.js` | `ancestorsOf(nodes, id)`, `activePromotions(promotions, at)`, `promotionState(p, at)`, `promoPrice(base, p)`, `promoApplies(p, ctx)`, `bestPrice({ item, object, itemPrice, objectPrice, ancestors, promotions, at })` → `{ base, price, promo, source }`, `changedItems(history, since, { object, promoted })`, `TAG_SIZES`, `priceTags(items, opts)`, `unitPrice(price, packQty, per)` |
| `loyalty.js` | `LOYALTY_DEFAULTS`, `ean13(body12)`, `cardNumber(prefix, n)`, `pointsEarned(paid, settings)`, `maxSpend(total, settings)`, `checkSpend(points, total, customer)`, `pointsLedger(txs, opening)`, `returnPoints(sale, returned)`, `customerStats(purchases, today, window)`, `segmentOf(customer, stats, today, vipAmount)`, `rfmScores(customers, today)`, `daysBetween(a, b)` |
| `format.js` | `COLUMNS` (58 → 32, 80 → 48), `columnsFor(paperMm)`, `textWidth`, `padRight`, `padLeft`, `center`, `rule`, `wrap(text, width)`, `row(left, right, width)`, `columns(rows, specs, width)`, `LABELS`, `formatReceipt(doc, opts)`, `formatShift(report, opts)` |
| `test.js` | unit tests: `node receipt/test.js` (importing it runs nothing) |

## Money and VAT (money.js, vat.js)

- Every amount is an integer of minor units (tetri, cents). Products and divisions go through `mulDivRound`, which
  rounds the exact rational result by mode: `half-up` (half away from zero, the default), `half-even`, `down`, `up`.
  Quantities have up to three decimals (`0.375` kg), percentages up to four.
- Line amount = round(qty × price) once per line. Discounts are rounded once and `allocate` spreads a whole-check
  discount over the lines by largest remainder, so the lines always add up to the check total to the minor unit.
- Prices include VAT: VAT = amount × r ÷ (100 + r) (11.80 at 18 % → 1.80). `vatBreakdown` sums per-line VAT
  (`'line'`, what a per-line fiscal document shows) or rounds once per rate (`'rate'`, what many fiscal printers
  print). A `null` rate is "without VAT" and reported as `exempt`, apart from a 0 % rate.

## Checks, payments and returns (cart.js, payment.js, returns.js, doc.js)

- The cart merges the same item at the same price; a marking code (GS1 serial) may appear only once per check.
  `stockWarnings` lists lines above the known stock; selling into minus is the caller's decision.
- Payment order: points first (whole points, at most the balance and `maxSpendPct` % of the check), then card (at
  most the rest: a card never gives change), then cash with change. `payable` (total − points value) is the base
  for earning points. `cashStep` rounds the cash part to the smallest coin and reports the rounding.
- A return takes the prices actually paid (after discounts). A partial return is proportional to what is still
  returnable, and the last unit returns exactly the remaining amount, so several returns add up to the sale.
  Earned points are reversed and spent points refunded in the returned share (cumulatively, so rounding never
  over-refunds); a mixed sale refunds cash in the share cash had, never more than the cash received.

## Shifts (shift.js)

The X report totals the docs of a shift: sales and returns apart, each with count, total, cash, card, the money of
mixed checks and points (points are not money and go to neither cash nor card), VAT by rate (returns subtract) and
cash operations. Expected cash = opening + cash sales − cash returns + cash in − cash out; a cash out above it is
refused. The Z report adds the counted cash and the difference. A shift is expired after 24 hours.

## Prices (price.js)

The base is the object's own price, else the item's retail price. Promotions (percent off or a fixed price) apply to
listed items or anything under listed categories (`ancestorsOf`), at all or listed objects, between `from` and `to`
(ISO strings compared as text); the lowest promotional price wins, only when below the base. `priceTags` returns the
data of a tag (old price, badge, formatted price, meta line, size in mm and font sizes); `changedItems` picks the
items to re-tag after price changes.

## Text receipts (format.js)

58 mm paper has 32 columns, 80 mm 48 (font A). Widths count code points (combining marks take none), so Georgian,
Cyrillic and Latin text align alike. `row` keeps the amount on the last line of a wrapped name and keeps indents;
`columns` aligns cells with one flexible column. Labels default to English and can be replaced for any language;
dates arrive preformatted (`time`), the formatter never reads the clock.
