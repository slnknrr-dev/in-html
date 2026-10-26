# Offline multi-file build

`html@5_offline/` is the crypto tools as a small static site: `index.html`, `hashing.html`, `ciphering.html`,
`encoding.html`, `passwords.html`, linked to each other, the application modules and only the library modules they use
(each tree-shaken and minified), with no network code at all — the build fails if any appears. Serve the folder from
any static host or open it through a local server; browsers can cache the files separately. Texts, files and keys are
processed in the page only; results leave as copies or downloads.
