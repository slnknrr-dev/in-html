# Rental Studio

A short-let manager for an owner or a small agency, in the browser without a network: flats on a month timeline with
bookings, conflicts and free gaps, iCal exchange with channels, nightly prices with seasons, weekday rates, minimum
stays, length-of-stay discounts and fees, quotes with explained refusals, a calculation web that splits every booking
between the owner, the agency, the cleaner and the tax office, an immutable journal with owner statements, KPIs and
payouts, and a lead funnel with viewing slots. Money is integer minor units throughout (GEL by default, USD / EUR at
hand-typed rates). Built on `booking/`, `ledger/`, `diagram/`, `payments/`, `csv/` and `ui/`.

```bash
node rental-studio/server.js        # development server
node singlefile.js rental-studio    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e rental-studio/html@5_offline_singlefile/index.html rental-studio/e2e.js
```

The first start seeds a demo: a family agency in Batumi with three flats of two owners, about forty bookings over four
months around today, a journal with the first months posted, a payout and a building expense, and eight leads.

## Pages

- **Calendar** (`index.html`): the flats as rows of a month timeline; a booking is a bar from the check-in half-day to
  the check-out half-day (stays are half-open), a second lane shows overlaps, requests are hatched, closed and past
  days are marked. Click a free day or a gap to book it.
  - Booking editor: flat, guest, contact, guests, dates, channel, status, price (pre-filled from the quote), surplus,
    note; conflicts with confirmed bookings and closed dates are shown before saving.
  - Conflicts of the whole calendar (double bookings, bookings on closed dates, requests on taken nights), the
    bookings of the month with filters, occupancy per flat, free gaps (gaps shorter than the minimum stay flagged).
  - iCal export / import per flat (`booking/ics.js`), project JSON save / open, demo reset.
- **Prices** (`prices.html`): base rate per night / week / month, minimum and maximum nights, guests, deposit, weekday
  rates, length-of-stay discounts, cleaning and other fees (per stay, night, guest, guest and night, after N guests),
  seasons and closed periods as an ordered rule list (the last matching rule wins). A quote for any dates with the
  nights grouped by rate, discount, fees, total, deposit, 30 % prepayment and the USD / EUR equivalents; refusals show
  the code (`bad_range`, `past`, `too_short`, …) and why. A price calendar of the month with the source of every rate.
- **Payouts** (`payouts.html`): KPIs of a month (bookings, nights, occupancy, ADR, RevPAR, revenue, agency, owners)
  overall and per flat, CSV; the split of every check-in of the month through the calculation web, posted to the
  journal once per booking and reversed as a whole; owner statements with opening and closing balances, CSV and a
  printable owner report; the payout plan; a building expense split across flats by area or equally; the calculation
  web editor (sources → pools → parties, percent / fixed per booking, night or month, optionally guaranteed / rest,
  order) with validation, a diagram and a test booking; parties; exchange rates; the journal with reversals and CSV.
- **Leads** (`leads.html`): the funnel and conversion, a board by status (moves only along `booking/deal.js`
  transitions), viewings with clash detection per agent, guests-in-the-flat warnings and free slots of the day.

## Files

| file | contents |
|---|---|
| `index.html`, `prices.html`, `payouts.html`, `leads.html` | the pages (hidden anchors `#pg-calendar` … `#pg-leads` give the build the links) |
| `calc.js` | the project model and the glue without DOM: normalisation, quotes, conflicts, web evaluation per booking, posting / reversing, expenses, payouts, KPI stays, rates table |
| `demo.js` | the seeded demo project |
| `common.js` | shell, icons, project store (localStorage, JSON export / import), money and date formatting, labels, widgets |
| `calendar.js`, `prices.js`, `payouts.js`, `leads.js` | the pages |
| `strings.js` | UI strings in the 7 UI languages (also the labels of library codes) |
| `app.css` | layout of the four pages and the printed owner report |
| `e2e.js` | in-page scenario: demo, conflicting booking warning, a quote and its refusals, posting and statement = splits |
| `server.js` | development server |

## Limits

- One project currency; other currencies are shown at hand-typed rates, never added to the journal.
- The ledger knows four roles: cleaners and the tax office are `contractor` parties with an app-level kind.
- The calculation web is one for all flats; the owner node binds to each flat's owner.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`. The project stays in the browser's local
storage.
