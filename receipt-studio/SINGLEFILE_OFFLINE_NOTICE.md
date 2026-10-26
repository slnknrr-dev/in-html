# Single-file offline build

`html@5_offline_singlefile/` holds the cashier simulator and receipt calculator as self-contained HTML (`index.html`
(POS), `returns.html` (returns) and `shift.html` (shift, X / Z reports, journal), linked to each other): scripts,
styles and icons are inlined and nothing is fetched — the build fails on any network API or remote resource. Open a
file from disk (`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Receipts are calculated,
previewed and printed in the page; settings, the catalogue, the shift and the journal stay in the browser's local
storage.
