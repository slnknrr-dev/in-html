# Single-file offline build

`html@5_offline_singlefile/` holds the short-let manager as self-contained HTML (`index.html` (calendar),
`prices.html`, `payouts.html` and `leads.html`, linked to each other): scripts, styles and icons are inlined and
nothing is fetched — the build fails on any network API or remote resource. Open a file from disk (`file://`), put it
on a USB stick or host it anywhere. The project stays in the browser's local storage; iCal, JSON and CSV files come in
by file pick and leave as downloads.
