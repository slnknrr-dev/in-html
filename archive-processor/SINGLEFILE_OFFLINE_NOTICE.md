# Single-file offline build

`html@5_offline_singlefile/` holds the archive processor as self-contained HTML (`index.html`): scripts, styles and
icons are inlined and nothing is fetched — the build fails on any network API or remote resource. Open a file from
disk (`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Archives are opened from the device
and never leave it; extracted files leave as downloads, one ZIP or into a folder the user picks.
