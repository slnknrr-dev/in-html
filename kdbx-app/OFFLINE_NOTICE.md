# Offline multi-file build

`html@5_offline/` is the KeePass-compatible password manager as a small static site: `index.html`, the application
modules and only the library modules they use (each tree-shaken and minified), with no network code at all — the build
fails if any appears. Serve the folder from any static host or open it through a local server; browsers can cache the
files separately. Databases are opened from the device and saved back as downloads; only the generator settings are
remembered in local storage, never a password.
