# estate/

Real-estate models: new-build complexes and handover quarters, the floor × unit "chessboard" with sale statuses and
price statistics, the regular grid of a building, mortgage payments and schedules (annuity and differentiated),
import of a developer's unit table with column sniffing, room trees with the room summary and the layout kind (Euro
n+1, studio, separate rooms), and number → word scales (the Euro layout words). Pure ES modules: no DOM, no clock
(today is an argument), no network. Uses `../csv/csv.js` (text tables) and `../ledger/minor.js` (rounding and
largest-remainder allocation).

## Files

| file | contents |
|---|---|
| `complex.js` | `cleanComplexSlug`, `COMPLEX_SLUG_RESERVED`, `cleanComplexName`, `complexName(c, lang)`, `READY_MIN` / `READY_MAX`, `readyNum(year, quarter)`, `cleanReady(v)`, `readyYear`, `readyQuarter`, `readyOfDay(iso)`, `readyBy(n, limit)`, `readyText(n, lang, today)` |
| `chessboard.js` | `UNIT_STATUSES`, `UNIT_STATUS_I18N`, `unitStatus`, `chessboard(units)` → `{ rows: [{ floor, cells, slots? }], total, free, reserved, sold, closed, floors, columns }`, `unitStats`, `unitPlans(units, { sold })`, `pricePerM2`, `unitPrice(area, rate, step)`, `unitGrid(spec)`, `UNIT_GRID_MAX` |
| `mortgage.js` | `loanMonthly(price, { downPct, years, ratePct })`, `annuityPayment`, `annuitySchedule(principal, { ratePct, months, rounding, startMonth })`, `differentiatedSchedule`, `mortgagePlan(price, { downPct, years, ratePct, kind })`, `affordablePrincipal(monthly, ratePct, months)` |
| `table.js` | `cellNumber`, `cellInt`, `cellText`, `headerKey`, `UNIT_COLUMNS`, `unitColumnOf`, `sniffUnitColumns`, `isFlatNumber`, `unitStatusOf`, `unitTable(rows, { max, step })` → `{ columns, ignored, units, problems }`, `unitTableFromText(text)` |
| `rooms.js` | `ROOM_ZONES`, `ROOM_TYPES`, `roomTypeDef`, `ROOM_BATH_TYPES`, `ROOM_SERVICE_TYPES`, `PLACE_TYPES`, `placeCapacity`, `normalizePlaces`, `cleanRoomKey`, `roomKeyFromName`, `normalizeRoom`, `normalizeRooms`, `roomZones`, `roomLabel(room, lang)`, `roomsSummary`, `roomsLayout`, `ROOMS_LAYOUT_NAME` |
| `scales.js` | `SCALE_MODES`, `cleanScaleKey`, `scaleI18n`, `normalizeScale`, `normalizeScales`, `mergeScales`, `scaleStepIndex`, `scalePick`, `scaleWord(scale, n, lang)`, `EURO_SCALE` |
| `test.js` | unit tests: `node estate/test.js` (importing it runs nothing) |

## Complex and handover (complex.js)

The slug is Latin, digits and `-` (2–48 characters, a few reserved words refused). Names are `{ en, ru, ka }` with
the fallback language → English → any → slug. The handover date is a quarter `year * 10 + quarter` (20272 = Q2 2027),
monotonic for range filters; `cleanReady` reads `20272`, `2027-Q2`, `2027 К2`, a date or month (collapsed into its
quarter) and a plain year (its last quarter). "Completed" is computed against an explicit today.

## Chessboard (chessboard.js)

A unit is `{ id, flat, floor, position?, area, price, currency, rooms, status | sold }`; statuses are `free`,
`reserved`, `sold`, `closed` (the older `sold: true` reads as sold). Rows go from the top floor down, flats in human
order (`2` before `10`, `12` before `12A`); units without a floor form the last row (never dropped), floor 0 is a real
floor. With `position` (riser) every row gets `slots` with gaps so risers line up. `unitStats` and `unitPlans` take
prices and areas from free units only and average one currency (the most frequent; `avgFrom` says over how many
units). `unitGrid` lays out floors × units per floor with repeating areas and room counts and prices `area × rate`
rounded to `step` (100 by default) — the same `unitPrice` as table import; at most 400 units.

## Mortgage (mortgage.js)

Integers in one unit (minor units recommended), nominal annual rate / 12, explicit rounding. `loanMonthly` is the
quick estimate next to a price (down payment 0–90 %, 1–30 years, 0–40 %). Schedules list `{ n, month?, payment,
interest, principal, balance }`; the principal parts always sum to the loan exactly (the annuity's last row takes the
rounding difference, the differentiated parts and zero-rate instalments are split by largest remainder). A zero rate
(interest-free developer instalments) has its own branch. Estimates, not bank offers.

## Unit tables (table.js)

The header row is required; columns are recognised in English, Russian and Georgian (`№`, `Квартира`, `Floor`,
`Площадь, м²`, `ფასი`, `Status`, …), and "price per m²" is recognised as a rate before anything can take it for the
price. Cells read real price lists (`42,5`, `1 200 000`, `$120,000.50`, `42.5 м²`, ranges as their first number).
Rows without a flat number (`Total`), repeated numbers and rows over the cap are skipped and reported with their line
number as Excel shows it; an unreadable area or price drops the cell, not the row. `unitTableFromText` sniffs the
delimiter of a CSV / TSV export.

## Rooms and layouts (rooms.js, scales.js)

A room is a top-level node with its zones (`parent`): "Hall + Hallway + Kitchen" is one room; deeper or broken
parents become rooms of their own. A lone kitchen is not a room, a kitchen-living room is; unknown types count as
rooms; bathrooms include the old names `toilet` / `wc`. `roomsLayout` gives `apartments` (Euro n+1: bedrooms, one
kitchen, every other living space with the kitchen), `studio` or `rooms`, and `size` = bedrooms + 1 for
`EURO_SCALE` ('Euro 1+1' / 'Евродвушка'). Scales map numbers to words exactly or by steps "up to N" with one
"otherwise" step whose word may contain `{n}`.
