# Single-file offline artifact

`html@5_offline_singlefile/index.html`: the editor as one self-contained HTML file with no network code at all
(`remote.offline.js`, `bundles.offline.js`). Knowledge bases stay in this browser (IndexedDB); the reader and the
server of the exports travel inside the file, so every export mode (one file, static site, Node server) works offline.
