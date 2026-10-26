# Single-file offline build

`html@5_offline_singlefile/index.html` is the whole game in one self-contained HTML file: scripts, styles and icons
are inlined and nothing is fetched. Open it from disk (`file://`), put it on a USB stick, upload it to itch.io as an
HTML game or host it anywhere. Every variant, the hints, the daily puzzle and games against bots work; online rooms
are left out (the offline client of `rooms/` has no network code). Settings, statistics and the game in progress stay
in the browser's local storage.
