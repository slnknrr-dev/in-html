# calendar/

Calendars and dates of events, reports and rosters: civil-date arithmetic with ISO weeks and IANA zones, iCalendar
(RFC 5545) write and read with recurrence rules, month / week grids, report periods and schedules, shift rosters,
the language of event dates (en / ru / ka) and guest lists with RSVP. Pure ES modules: no DOM, no Node APIs, no
clock reads — every "today" and "now" is an argument. Zones come from `Intl` (fixed offsets work without it).

## Files

| file | contents |
|---|---|
| `date.js` | `parseDay` (ISO, compact, `DD.MM.YYYY`), `parseTime`, `formatTime`, `splitDateTime`, `daysInMonth`, `isLeapYear`, `dayNumber` / `fromDayNumber`, `addDays`, `addMonths` (clamped), `dayDiff`, `daysBetween`, `isoDow` (Monday 0), `startOfWeek`, `startOfMonth`, `endOfMonth`, `isoWeek`, `isoWeekKey`, `isoWeekStart`, `isoWeeksInYear`, `tzOffset(ms, tz)`, `zonedParts`, `dayInZone`, `zonedToUtc(day, time, tz)`, `isTimeZone` |
| `ics.js` | `buildCalendar({ prodId, method, name, tz, events, todos })`, `buildEvent`, `eventLines`, `todoLines`, `icsDate`, `parseIcsDate`, `icsEscape` / `icsUnescape`, `foldLine` / `unfoldLines`, `contentLine`, `parseContentLine`, `formatDuration` / `parseDuration`, `parseICS(text)` → component tree, `readCalendar(text)` → `{ events, todos, timezones, … }`, `readEvent`, `readTodo` |
| `rrule.js` | `parseRRule`, `formatRRule`, `expandRRule(start, rule, { from, to, limit, exdate, tz })`, `describeRRule`, `WEEKDAYS` |
| `period.js` | `periodRange(preset, today)` → `{ from, to, days }`, `PERIOD_PRESETS`, `previousPeriod(range, mode)`, `periodLabel`, `nextRun(schedule, after)`, `runsBetween`, `localDay` |
| `grid.js` | `monthGrid(year, month, { items, dayOf, weekStart, today, fixedWeeks })`, `weekGrid(day, opts)`, `groupByDay`, `weekdayOrder`, `monthsOf(days)`, `layoutSpans(items)` (multi-day bars in lanes) |
| `roster.js` | `shiftHours(start, end)` (overnight wrap), `isOvernight`, `shiftSpan`, `spansOverlap`, `shiftConflicts(shift, others, { absences, minRest })`, `rosterConflicts`, `weeklyTotals`, `dayCoverage`, `timesheet(shifts, entries, { tz, now, lateMinutes })` |
| `event.js` | `parseWhen`, `whenDay`, `formatEventDate(raw, lang, { weekday, time })`, `monthName`, `weekdayName`, `MONTHS`, `WEEKDAYS`, `dayBadge`, `relativeDay`, `WHEN_MODES`, `BUCKETS`, `eventBucket(day, today)`, `passesWhen`, `fullness(going, capacity)`, phases (`phaseAt`, `sortPhases`, `activePhase`, `whenMs`, `isAddressed`), `scheduleDays(items)`, `eventDays`, `spanDays`, `EVENT_TYPES`, `EVENT_CATEGORIES`, `eventType`, `eventCategory`, `localName` |
| `guests.js` | `RSVP_AXES`, `RSVP_RESPONSES`, `rsvpAxis`, `rsvpDefaults`, `rsvpOptions(block)`, `rsvpOption`, `rsvpTagPool`, `rsvpApplyTags`, `tagKey`, `normalizeTags`, `hasTag`, `tagCounts`, `parseGuestLine(line, locales)`, `parseGuestList`, `guestName`, `rsvpSummary(guests, { capacity })`, `pollBars`, `guestsCsv(rows, { extra, labels, delimiter, bom })`, `GUEST_CSV_LABELS` |
| `test.js` | unit tests: `node calendar/test.js` (importing it runs nothing) |

## Dates and zones (date.js)

- A day is a `'YYYY-MM-DD'` string and the arithmetic runs on day numbers since 1970-01-01, so no machine zone can
  move an event to the neighbouring day (`new Date('2026-09-19')` is UTC midnight, the 18th in Los Angeles).
- `tzOffset` accepts an IANA name (`Asia/Tbilisi`), a fixed offset (`+04:00`, `UTC-3`) or minutes east of UTC; an
  unknown zone counts as UTC instead of throwing. `zonedToUtc` turns a wall clock into an instant (two fixed-point
  steps; a time inside a DST gap lands an hour off, as in most calendar software).
- ISO weeks belong to the year of their Thursday (2027-01-01 is in 2026-W53).

## iCalendar (ics.js, rrule.js)

- Model values: `'YYYY-MM-DD'` (all-day, `VALUE=DATE`), `'YYYY-MM-DDTHH:MM[:SS]'` (floating wall clock, or with
  `tz` → `TZID=`), `'…Z'`, `Date` or epoch ms (UTC). All-day `end` is the inclusive last day in the model; the file
  gets the exclusive `DTEND` the standard wants, and the reader converts it back. `DURATION` is resolved to `end`.
- TEXT values escape `\ ; ,` and newlines; lines fold at 75 octets counted in UTF-8 without splitting characters;
  parameter values with `: ; ,` are quoted (`CN="Doe, John"`). Header-like injection is impossible: every value
  goes through escaping or has CR / LF removed.
- Supported: VEVENT (summary, description, location, geo, url, status, transp, categories, class, priority,
  sequence, organizer, attendees with role / partstat / rsvp, RRULE / EXDATE / RDATE, X- properties), VTODO (due,
  completed, percent), VALARM (minutes before, a duration relative to start or end, an absolute time; DISPLAY,
  AUDIO, EMAIL). VTIMEZONE blocks are not generated (TZID names are; calendar clients know the zones) and are
  listed by name when read.
- `expandRRule` works on wall-clock values, so a weekly 19:00 stays 19:00 across DST. DAILY / WEEKLY / MONTHLY /
  YEARLY with INTERVAL, COUNT, UNTIL (a UTC UNTIL is converted with `tz`), BYDAY with ordinals, BYMONTHDAY (negative
  from the end), BYMONTH, BYSETPOS, WKST. The start is always the first occurrence; COUNT counts before EXDATE;
  months without the start's day are skipped (the 31st), Feb 29 recurs in leap years only.
- Not supported: BYWEEKNO, BYYEARDAY, BYHOUR / BYMINUTE / BYSECOND and sub-daily frequencies.

## Periods and schedules (period.js)

Presets `today`, `yesterday`, `week`, `prevweek`, `last7`, `last30` (and any `lastN` or bare `N`), `mtd`, `month`,
`prevmonth`, `qtd`, `prevquarter`, `ytd`, `prevyear`, `isoweek:2026-W43`, `month:2026-09`, `year:2026`,
`custom:a..b`, all resolved against an explicit day (use `localDay(now, tz)` for the reader's day).
`previousPeriod` gives the comparison range (the same length right before, or a year earlier). `nextRun` finds the
next daily / weekdays / weekly (weekday 1 = Monday … 7) / monthly (monthday, `-1` = last; short months run on their
last day) run at a local hour in a zone — the zone is minutes *east* of UTC or a name, unlike `getTimezoneOffset`.

## Rosters (roster.js)

A shift is `{ member, day, start, end }`; an end at or before the start wraps past midnight. Conflicts compare
absolute minute spans, so a 22:00-06:00 night shift collides with the next morning's 05:00 shift; `minRest` reports
too short breaks; approved absences block their days. `timesheet` matches clock-in entries to shifts (3 hours early
… the shift end), counts late arrivals after a grace period and missed shifts that have ended.

## Events and guests (event.js, guests.js)

- `formatEventDate` prints the year always, Russian months in the genitive (`3 октября 2026`), Georgian as
  `3 ოქტომბერი, 2026`, other languages through `Intl`.
- Buckets by calendar days: `today`, `tomorrow`, `weekend` (Saturday / Sunday within 6 days), `week` (the other
  days within 6 days — never both), `later`, `past`, `nodate`. `passesWhen('any')` passes undated and past events.
- Phases: `default` (−∞), `before N` / `after N` days relative to the start; the latest reached wins, an addressee's
  own phase (`for` / `forParty`) beats the calendar, and nothing addressed ever falls back to other guests.
- RSVP: an option is a label + an axis from the closed list `yes / maybe / maybeNo / no` + tags. Only `yes` takes
  seats (1 + companions), so an author's wording never breaks capacity; option tags are mutually exclusive per
  block and the author's own tags are kept.
- `guestsCsv` writes `;`-separated CSV with a BOM (spreadsheets in many locales expect both) and guards cells that
  start with `= + - @` against formula injection (through `csv/serializeCSV`).
