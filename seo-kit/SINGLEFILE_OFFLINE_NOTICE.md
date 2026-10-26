# Single-file offline build

`html@5_offline_singlefile/` holds the SEO kit as self-contained HTML (`index.html` (the site and its generated
files), `og.html` (the Open Graph card designer) and `check.html` (the page checker), linked to each other): scripts,
styles and icons are inlined and nothing is fetched — the build fails on any network API or remote resource. Open a
file from disk (`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Everything is generated in
the page and leaves as downloads; the site, the card and the last checked page stay in the browser's local storage.
