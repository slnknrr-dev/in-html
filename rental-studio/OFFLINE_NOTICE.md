# Offline multi-file build

`html@5_offline/` is the short-let manager as a small static site: `index.html` (calendar), `prices.html` (rates and
quotes), `payouts.html` (calculation web, journal, owner statements) and `leads.html` (lead funnel and viewings),
linked to each other, the application modules and only the library modules they use (each tree-shaken and minified),
with no network code at all — the build fails if any appears. Serve the folder from any static host or open it through
a local server. The project (flats, bookings, prices, parties, the journal, leads) stays in the browser's local
storage and leaves only as files the user saves: the JSON project, iCal calendars, CSV statements and printouts.
