# Offline multi-file build

`html@5_offline/` is the cashier simulator and receipt calculator as a small static site: `index.html` (POS),
`returns.html` (returns by the original receipt) and `shift.html` (cash shift, X / Z reports, journal), linked to each
other, the application modules and only the library modules they use (each tree-shaken and minified), with no network
code at all — the build fails if any appears. Serve the folder from any static host or open it through a local server.
Settings, the catalogue, the open shift and the journal of receipts stay in the browser's local storage.
