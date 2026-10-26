# Single-file offline build

`html@5_offline_singlefile/` holds the crypto tools as self-contained HTML (`index.html`, `hashing.html`,
`ciphering.html`, `encoding.html`, `passwords.html`, linked to each other): scripts, styles and icons are inlined and
nothing is fetched — the build fails on any network API or remote resource. Open a file from disk (`file://`), put it
on a USB stick, send it by e-mail or host it anywhere. Texts, files and keys are processed in the page only; results
leave as copies or downloads.
