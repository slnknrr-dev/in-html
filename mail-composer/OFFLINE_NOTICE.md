# Offline multi-file build

`html@5_offline/` is the e-mail composer, inspector and tools as a small static site: `index.html` (compose),
`inspect.html` (read an .eml) and `tools.html` (header and SMTP tools), linked to each other, the application modules
and only the library modules they use (each tree-shaken and minified), with no network code at all — the build fails
if any appears. Nothing is ever sent: messages leave the page only as downloaded .eml / ZIP files or as a `mailto:`
link handed to the mail application. Serve the folder from any static host or open it through a local server. The
draft and its files stay in the browser's local storage and IndexedDB.
