# Offline multi-file build

`html@5_offline/` is the floor planner as a small static site: `index.html` (the plan editor) and `seating.html`
(guest seating), linked to each other, the application modules and only the library modules they use (each
tree-shaken and minified), with no network code at all — the build fails if any appears. Serve the folder from any
static host or open it through a local server. Plans are drawn, checked, printed and exported in the page; the plan,
the guest list and the settings stay in the browser's local storage, and plan files are saved and opened as JSON.
