# Event Invite

Beautiful invitations and guest lists, made offline: pick an event type (wedding, birthday, kids party, anniversary,
Georgian supra, party, corporate evening, conference), write the texts in up to seven languages, set the date, place,
programme, dress code and reply options, choose a theme and ornament, and export one self-contained HTML invitation
with an animated envelope, RSVP replies by e-mail / SMS / copy / QR, an .ics file and printable cards. Built on
`calendar/`, `qr/`, `mail/` and `ui/`.

```bash
node event-invite/server.js        # development server
node singlefile.js event-invite    # builds html@5_offline/, html@5_offline_singlefile/, html@5_serverless/, html@5_backend/
node event-invite/html@5_backend/server.mjs 8080   # the backend build: pages + RSVP API
node check.js e2e event-invite/html@5_offline_singlefile/index.html event-invite/e2e.js
```

## Pages

- **Invitation** (`index.html`): event type chips (a scenario fills texts in every content language, programme,
  theme, ornament, lettering, dress code, companions, "maybe", menu; Undo in the toast), content languages with a
  main one and an editing language, hosts / title / text, date, start / end, last day, time zone, the "when" line in
  words for every language (calendar/event.js) with a countdown, venue, address, coordinates (pasted "lat, lon",
  geo:, OpenStreetMap or Google Maps links), a programme over one or several days, dress code with colours, reply
  contacts / deadline / companions / menu / note, 9 themes, 7 ornaments, 4 font stacks, envelope with a wax seal
  (initials), animation on / off. A live preview (phone / wide, language, replay of the envelope) is a sandboxed
  frame of the real export, updated by messages.
  - Exports: invitation `.html`, `.ics` (calendar/ics.js, text shown and copyable), A5 / A6 printed cards (one page
    per language, QR of the invitation address when set), project `.json` save / open.
- **Guests** (`guests.html`): pasted lists (calendar/guests.js parseGuestList, one name per content language),
  group and allowed companions, tags, RSVP status, companions coming, table; summary tiles, capacity bar, poll bars,
  groups / tags / tables / menu chips; filters; CSV (guestsCsv); per guest: personal link (`#guest=<token>`), a
  personal invitation file, an invitation e-mail (mailto); reading pasted replies (`[RSVP|id|answer|n|name|menu]`
  tags); printed folded name cards (four per A4).

## The exported invitation

One HTML file, zero network: data in `<script type="application/json">`, the runtime (`invite-runtime.js` bundled
through `new URL('./invite-runtime.js?bundle', import.meta.url)`, see `bundles.js`) inline, a no-script card in
`<noscript>`. The guest token carries only that guest (id, name, companions, language), so the file holds no guest
list. Envelope opening respects `prefers-reduced-motion`. Without a server, replies leave as mailto: / sms: links,
copy, and a QR (MATMSG / SMSTO / text).

## Exports (designer)

- **HTML**: zero network unless an RSVP server is set and the invitation published; then the page also carries
  `invite-net.js` and posts replies (JSON, three tries with back-off), confirms them and shows live counts when
  allowed; on failure the offline reply (mailto / SMS / QR / copy) remains. The designer preview never posts.
- **E-mail** (`mailer.js`): an .eml with multipart/alternative (plain text + table-layout HTML with inline styles, no
  scripts) and the .ics attached (text/calendar); the guests page makes a mail-merge ZIP, one personalised .eml per guest.
- **PDF** (`cards-pdf.js`, pdf/): A5 / A6 cards (one page per language, vector QR of the invitation address) and
  folded name cards; a TTF / OTF font picked by the user is embedded as a subset (Georgian needs one), else Helvetica.

## RSVP server

`backend.js` (BACKEND build, also mounted by the development server): `POST api/events` (id + owner token),
`PUT api/events/<id>`, `POST api/events/<id>/rsvp` (name, answer, plus, menu, diet, msg), `GET …/counts` (only when
live counts are on), `GET …/replies[?format=csv]` and `DELETE …/replies/<rid>` with `Authorization: Bearer <token>`.
JSON files in the data folder; size and rate limits; CORS from `EI_ORIGINS`; guests never get other guests' data.
Network code of the pages lives in `net.js` / `invite-net.js`; `net.offline.js` and `bundles.offline.js` keep the
offline builds free of it. The guests page **Sync replies** applies server answers, keeps answers set by hand and lists
conflicts (keep mine / use the server's).

## Files

| file | contents |
|---|---|
| `index.html`, `guests.html` | the pages (hidden anchors `#pg-design`, `#pg-guests`) |
| `invite.js` | pure invitation core: themes, fonts, ornaments, envelope, card / RSVP markup, CSS, ICS, guest tokens, reply text and parser, page HTML |
| `invite-runtime.js` | script of the exported page |
| `bundles.js`, `bundles.offline.js` | runtime bundle loader (dev server / inline data: URL) |
| `common.js` | shell, icons, scenarios, state (localStorage `ei-event`), invitation data and export, guest links |
| `main.js` | designer page |
| `guests.js` | guests page |
| `strings.js` | UI and invitation strings in the 7 UI languages |
| `app.css` | layout and print sheets |
| `net.js`, `net.offline.js`, `invite-net.js` | network door of the pages / its offline twin / the poster of exported pages |
| `mailer.js`, `cards-pdf.js` | .eml and mail-merge ZIP; PDF cards and name cards |
| `backend.js` | RSVP server |
| `e2e.js` | template, date, ICS DTSTART, RSVP reply in the exported page, guests and summary, reply import |

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`,
both audited for zero network use; `SERVERLESS_NOTICE.md` (static site, server address set by the host) and
`BACKEND_NOTICE.md` (server.mjs + backend.mjs + public/) add the online builds.

## Limits

Calendar event types have no supra; the app adds it on top of the `dinner` type. Seating is a table field per guest
(no plan/ floor plan). Map links are navigation only; the invitation shows no map tiles.
