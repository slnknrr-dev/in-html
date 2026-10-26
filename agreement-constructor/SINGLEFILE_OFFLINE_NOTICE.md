# Single-file offline artifact

`html@5_offline_singlefile/index.html` is the whole constructor in one self-contained HTML file with no network code:
the built-in templates (residential lease, services agreement, receipt, power of attorney), modifiers and levels,
editing of clause texts in place, fields extracted from the text, the JS validator in a sandboxed worker, languages,
printing, JSON import / export and the compilation of a template into its own single HTML fill-in page (the runtime of
that page is carried inside this file). Templates and documents stay in this browser (IndexedDB, or localStorage
where IndexedDB is unavailable). Open it from disk (`file://`), keep it on a USB stick; move work between browsers
with the JSON export.
