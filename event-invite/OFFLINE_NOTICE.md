# Offline multi-file build

`html@5_offline/` is the invitation designer and guest manager as a small static site: `index.html` (designer) and
`guests.html` (guests), linked to each other, the application modules and only the library modules they use, with no
network code at all — the build fails if any appears. The event and the guest list stay in the browser's local
storage; invitations, calendar files, CSV and print sheets leave as downloads.
