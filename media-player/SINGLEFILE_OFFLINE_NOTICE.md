# Single-file offline build

`html@5_offline_singlefile/index.html` is the media player as one self-contained HTML file: scripts, styles and
icons are inlined, and the build is made with the `offline` module variant (`net.offline.js`), so the page has no
network code at all — the build fails on any network API or remote resource. Open it from disk (`file://`), put it
on a USB stick or host it anywhere. It plays the files and folders you open or drop into the page; the catalogue,
tags, playlists, tracking and settings stay in the browser's storage. Links that need yt-dlp, the converter with
yt-dlp / ffmpeg / ImageMagick and the home media server are not part of this build (use the serverless, backend or
Electron builds for them).
