# Durak (`durak-game`)

The card game Durak for desktop and phones: classic throw-in and transfer durak, jokers, double decks, teams and
exclusive variants; strategist bots with different principles and four levels; replays with a game notation and the
entropy of the public course; a style profile with achievements; online rooms with passwords and invite links; and a
constructor for your own decks, cards, rules, looks and bots. The rules engine and the bots are the
[`durak/`](../durak/) library, multiplayer is [`rooms/`](../rooms/), randomness [`prng/`](../prng/).

## Artifacts

Built from the NOTICE files (`node singlefile.js durak-game`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | the whole game in one file without any network code: bots, replays, profile, constructor — from disk, itch.io, a USB stick |
| `html@5_serverless/` | a static site: offline play, and online rooms on a server whose address the player enters |
| `html@5_backend/` | `node server.mjs [port] [--host 0.0.0.0]` (Node ≥ 18): the pages and the rooms API at `/api` on one origin |
| `html@5_standalone/index.html` | one file that opens from `file://` and connects to servers over HTTPS + CORS; no preset servers (the constructor exports a copy with servers written in) |

Pages read `globalThis.IN_HTML_ARTIFACT.mode`: the offline build hides online play (its rooms client has no network
code), backend pages use their own origin, serverless and standalone pages ask for a server (saved, plus the presets of
an exported standalone page). Development: `node durak-game/server.js` serves the sources and mounts `backend.js` at
`/api`, so online rooms work locally too.

## Playing

- **Table**: opponents along the top with their card counts, role (⚔ attacker, 🛡 defender, takes, done), a ring on
  whoever the game waits for and an optional turn-timer ring; the cloth with the stock, the open trump card under it,
  the discard pile and the bout (attack cards with their answers); your seat, the action buttons and your hand.
  Every change animates (cards fly from a player to the cloth, to the discard pile, to whoever takes them, from the
  stock into the hands) unless reduced motion is asked for (system setting or Settings → Animation).
- **Moves**: tap a card, then a highlighted target (an attack card to beat, the cloth to lead, throw in or transfer); a
  second tap on the card plays it when it has one use; drag a card onto its target; or right click / long press a card
  for its menu — every use it has now (beat which card, transfer to whom, throw in, lead all of a rank, take the open
  trump) and its details (trump tier, how many cards it beats and is beaten by, its special rules). Cards with no use
  are dimmed (hints can be switched off). Buttons: Take, Done (beaten / let them take), Transfer, Show trump, Take the
  trump card. Keys: ← → move along the hand, Enter / Space select and play, T take, D done, Esc clears the selection.
  The browser's menu, the touch callout and text selection never appear over the table and the hand.
- **Status line** tells whose turn it is and what can be done; the move log (☰ → Moves) lists every move in words.
- **End**: places, the durak, pogony, new achievements; replay the game, copy its record, play again (a seeded game's
  rematch deals `seed/1`, `seed/2`, …).
- **Bots** sit on every other seat: choose a template, a level, or your own constructed bot; the picker shows each
  template's principles, its rating at every level (from the simulations) and which strategists disrupt it and which
  it plays well next to.
- **Shuffle**: a seeded PRNG (xoshiro128** from SHA-256 of a readable seed — share the seed, get the same deal) or the
  browser's CSPRNG.

## Screens

- **Home**: play with the last setup, new game, online, replays, profile, settings, constructor, how to play.
- **New game**: the ruleset gallery (classic, exclusive, your own) with the rules in words, players (2–10 depending on
  the deck), a bot per seat, the shuffle.
- **Online**: server, public rooms, create a room (name, password, listed or not, ruleset, seats, bots, seed, "everybody
  sees my look"), join with a password or an invite link (`#room=…&server=…&invite=…` joins without the password), the
  lobby (players, bots, invite link, chat), then the table with chat and emotes. The room's look (table, faces, backs and
  uploaded pictures) and its ruleset travel with the room settings, so everybody sees and plays the same.
- **Replays**: paste a DGN record (or open a saved game), step through it on the table with all hands open when the
  record has the seed or the deal, the move list with the bits of every decision, the hidden-entropy curve and the
  course entropy per player (definitions in [`durak/README.md`](../durak/README.md)). Links `#dgn=…` open a record.
- **Profile**: name and avatar, results, your style (nine measured features next to the closest strategist), style
  badges, 18 achievements.
- **Settings**: name and avatar, table theme, card faces and backs, the room look switch, bot speed, turn timer,
  animation, hints, sound and volume, the rules of quick play and the way into the constructor (the "rules engine").

## Constructor

Reached from Settings → Rules engine or the home screen, so that the game itself stays clean. Tabs:

- **Overview**: name, id, author, description; start from a preset; your saved rulesets; import (file, share code,
  JSON); the rules in words.
- **Deck**: generated sets (ranks × suits × copies), suits (symbol, colour), ranks (label, value), colours.
- **Cards**: custom cards with code, name, designation, rank, suit, colour, copies, picture (joker, a symbol, or an
  uploaded image) and a note; their rules: trump (by suit / always with a tier / never), value, wildcard, extra ranks,
  beats / beaten by / only-restrictions as matchers ("own colour", a suit, a rank, a card…), play flags; one button
  makes a colour joker with the joker rules.
- **Rules**: players, hand size, first attack, direction, teams, trump mode, eternal trumps, trump exchange, pogony,
  throw-in rights and limits, transfers, rank groups, beat rules (with "never" rules), card rules by pattern.
- **Check**: validation errors and warnings, what beats what for any card under any trump, a quick bot tournament
  (game length, takes, the first attacker's durak rate against the fair share, unfinished games).
- **Look**: table themes (green felt, casino, navy, wood, slate, paper, high contrast, your picture), card faces
  (Anglo-American, classic Russian with В Д К Т, minimal, four colours, dark), backs (lattice, stripes, dots, crest,
  your picture); a ruleset can carry its recommended look.
- **Bots**: the bot constructor (traits, skills, targeting, level; the closest template is shown).
- **Export**: the ruleset as a file (with pictures), a share code (`DKR1:…`) or a link (`#rs=…` offers to add it), and
  — in the standalone build — **the standalone page with servers**: a copy of the running page with
  the servers written into `IN_HTML_ARTIFACT.servers`. Test play starts a game with the draft at any time.

## Files

| file | contents |
| --- | --- |
| `index.html`, `app.css` | the page and its stylesheet (table, phone layouts, screens) |
| `main.js` | home, settings, screens, links (`#room`, `#rs`, `#dgn`), artifact modes |
| `play.js` | a game session: room ↔ table, analysis recording, log, chat and emotes, timer, end of game |
| `table.js` | the table renderer: layout, animations, selection, drag and drop, card menus, keys |
| `cardart.js`, `skins.js` | card faces and backs (SVG), table themes, uploaded pictures |
| `setup.js` | new game, bot picker, bot constructor |
| `online.js` | servers, rooms, create / join, lobby |
| `replay.js`, `profile.js`, `studio.js` | replays with entropy, profile, constructor |
| `names.js`, `store.js`, `sound.js` | names and rules in words, local storage, WebAudio sounds |
| `strings*.js` | UI strings in en, ru, uk, de, fr, es, ka |
| `backend.js`, `server.js` | the rooms service of BACKEND builds; the development server |
| `e2e.js` | browser scenario: `node check.js e2e <url> durak-game/e2e.js --lang en [--mobile --size 390x844]` plays whole games through the interface (taps, drag and drop, card menus), the replay, the profile and every constructor tab |

## Limits

- Online rooms live in the server's memory (they expire after 30 idle minutes); there are no accounts.
- The turn timer acts for the player in their own browser; online, a player who closes the page is marked away and
  the others wait (bots keep playing their seats).
- Bots think on the page's main thread; Expert decisions take up to about 0.3 s on big decks.
- The standalone export works in the standalone build (one file with network code); the offline build has no network
  code and the multi-file builds are not one file to copy.
