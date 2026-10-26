# Single-file offline build

`html@5_offline_singlefile/` holds the floor planner as self-contained HTML (`index.html` (the plan editor) and
`seating.html` (guest seating), linked to each other): scripts, styles and icons are inlined and nothing is fetched —
the build fails on any network API or remote resource. Open a file from disk (`file://`), put it on a USB stick, send
it by e-mail or host it anywhere. The plan, the guest list and the settings stay in the browser's local storage; plan
files are saved and opened as JSON.
