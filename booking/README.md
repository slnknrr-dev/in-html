# booking/

Short-let and deal primitives: calendar days on `'YYYY-MM-DD'` strings, stays as half-open intervals with
occupancy and availability, the per-night price cascade with seasons, weekday rates, minimum stays, length-of-stay
discounts and fees, quotes with error codes, the lead funnel of sales and long-term rents with viewing slots,
handovers of a listing to an agent, blind mutual reviews, timed auctions and iCalendar exchange. Pure ES modules
without dependencies on the DOM, Node or a clock: `today` / `now` are always inputs. Money is integer minor units
(`payments/money.js` converts and formats). Day arithmetic is built on `contract/dates.js`.

## Files

| file | contents |
|---|---|
| `days.js` | `isDay`, `dayNum` / `dayIso`, `dayAdd`, `monthAdd`, `nightsBetween`, `cmpDay`, `minDay` / `maxDay`, `eachDay(from, to)`, `monthOf`, `monthStart`, `daysInMonth('YYYY-MM')`, `weekday` (Monday = 0), `isWeekend(day, weekend)`, `monthGrid(month, { weekStart })` |
| `stays.js` | `BOOKING_STATUSES`, `BLOCKING_STATUSES`, `statusBlocks`, `rangesOverlap`, `stayOk`, `staysOverlap`, `stayConflicts`, `blockingStays`, `busyDays`, `mergeStays`, `freeGaps`, `firstFree`, `occupancy` → `{ nights, busy, free, rate }`, `occupancyCalendar(month, { bookings, blocks, today })`, `availFacts`, `availRank`, `availOrder`, departures (`normalizeDeparture(s)`, `departureFree`, `departureSoldOut`, `upcomingDepartures`, `seatsByDay`) |
| `rates.js` | `normalizeCalRule`, `blockedStays`, `baseNightly(price, per)`, `nightlyRate(day, base, rules, weekdayRates)`, `minNightsFor`, `lengthDiscountPct`, `feeAmount`, `priceCalendar(month, opts)`, `quoteStay(input)`, `QUOTE_ERRORS` / `QUOTE_ERROR_TEXT`, `prepayment(total, pct)` |
| `deal.js` | `DEAL_STATUSES`, `DEAL_NEXT`, `DEAL_STATUS_I18N`, `dealFlowOf(settings)`, `dealLabel`, `dealCanGo`, `dealNext`, `dealFunnel`, `dealOpenCount`, `dealConversion`; viewings: `cleanShowAt`, `normalizeShow`, `minuteNum`, `showsOverlap`, `showConflicts`, `showBusy`, `freeShowSlots` |
| `handover.js` | `HANDOVER_KINDS` / `STATUSES` / `ACTIONS` / `RIGHTS` (+ labels), `createHandover`, `handoverNext(status, action, side)`, `handoverActions`, `applyHandover`, `canReclaim`, `normalizeRights`, `rightOfKey(key, table)`, `stateRight`, `handoverManager`, `handoverAllows(h, who, right)` |
| `reviews.js` | `faceKey` / `parseFaceKey` / `sameFace`, `cleanStars`, `BLIND_DAYS`, `reviewRevealed(r, now)`, `canReview` → reason codes, `submitReview(list, review, now)`, `averageStars`, `replySpeedMinutes` (median), `faceRep`, `replySpeedText`, `repLine(rep, lang)`, `plural` |
| `auction.js` | `normalizeAuction`, `auctionLive(a, paidUntil, today)`, `auctionState`, `nextBid`, `bidCeiling`, `bidRefusal`, `auctionTop`, `auctionOutcome`, `bidWithdrawable`, `auctionTermsChanged`, `publicTerms`, `roundBids`, `settleBids`, `restartAuction` |
| `ics.js` | `staysToIcs(stays, { name, stamp, domain })`, `icsToStays(text)`, `icsEscape` / `icsUnescape` |
| `test.js` | unit tests: `node booking/test.js` (importing it runs nothing) |

## Days and stays

- A day number is an integer (days since 1970-01-01) computed with civil-calendar arithmetic, so DST switches never
  shift a day; `isDay` accepts only existing `YYYY-MM-DD` days.
- A stay is `[from, to)`: the check-out day is free, back-to-back bookings do not conflict. The same `rangesOverlap`
  serves days (stays) and minutes (viewings).
- Only a **confirmed** booking holds dates; a pending request never makes a day busy (it shows as `pending` in the
  occupancy calendar). Owner-closed periods are a separate state (`blocked`), so a guest learns whether to move the
  dates or leave.
- `availOrder` sorts listings: new and free, free, soon free (earliest first), busy. Departures of tours count seats
  (`seats: 0` = not counted, `free: null`); taken seats are summed from bookings (`seatsByDay`), never stored.

## Prices (rates.js)

- The calendar is rules, not 365 prices: `price` rules (a season price, optional `minNights`, optional `weekdays`)
  and `block` rules. The rate of each night: base → weekday rate → the **last** matching price rule in list order.
- A monthly base is divided by 30 nights, weekly by 7 (rounded to a minor unit per night).
- The minimum stay is that of the **arrival** day's season. The longest matching length-of-stay threshold wins (capped
  at 90 %); the discount applies to the sum; fees (`stay`, `night`, `guest`, `guest_night`, with `after` included
  guests; `cleaning` as a shortcut) come after the discount; the deposit is reported apart.
- `quoteStay` refuses in the order a person can fix: `bad_range`, `past`, `too_short`, `too_long`, `guests`,
  `blocked`, `busy`, `no_price`; a refusal still carries `nights`, `minNights` and the `conflicts`.

## Deals, handovers, reviews, auctions

- The lead funnel has a closed status list and a transition table; closed leads only reopen. Sections switch steps
  off and rename them (`st_<status>`, `nm_<status>`), never `new` / `closed`; the funnel is counted from statuses and
  always sums to the number of leads. Viewings conflict only within one agent's slots.
- A handover goes `offered → active | declined | withdrawn`, `active → ended`; closed handovers are final. The
  intermediary uses only the given rights while it is active; `rightOfKey` maps an application's doors and blocks to
  rights (`always` / `never`, unknown keys are `never`).
- Reviews are allowed after a completed deal, compared by face (namespace + id), hidden until both sides reviewed or
  `BLIND_DAYS` passed; an edit keeps the reveal; only visible reviews count in `faceRep`; reply speed is a median.
- Auctions: the first bid may equal the start, then top + step (step 0 adds 1); bids above 10 × max(top, start) are
  refused; ties go to the earlier bid; the leader cannot withdraw; the reserve is never exposed (`publicTerms`);
  terms are locked while bids stand; `settleBids` settles a round once and `restartAuction` opens a new round.

## iCalendar (ics.js)

Stays become all-day `VEVENT`s whose exclusive `DTEND` is the check-out day; pending stays are `TENTATIVE`. Lines are
CRLF and folded at 75 octets; `DTSTAMP` is an input. `icsToStays` reads channel feeds (dates or date-times, unfolded
lines, cancelled events skipped), so imported blocks feed `quoteStay({ busy })` and `occupancyCalendar` directly.
