# Single-file offline build

`html@5_offline_singlefile/` holds the KeePass-compatible password manager as self-contained HTML (`index.html`):
scripts, styles and icons are inlined and nothing is fetched — the build fails on any network API or remote resource.
Open the file from disk (`file://`), put it on a USB stick, send it by e-mail or host it anywhere. Databases are
opened from the device and saved back as downloads; only the generator settings are remembered in local storage, never
a password.
