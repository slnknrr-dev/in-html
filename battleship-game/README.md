# Sea Battle (`battleship-game`)

Sea Battle (Battleship) for desktop and phones: the squared-paper school game, the board-game rules, Salvo, volleys,
fog of war, islands, polyomino fleets, free-for-all and teams, and special weapons (radar, air strike, cluster bomb,
mines) on a data-driven rules engine; bots with eight personalities and four levels (ratings and who beats whom from
simulations); replays with the information of every shot in bits, luck and skill; a style profile with achievements;
online rooms with passwords, invite links, chat and synced looks; and a constructor for your own seas, ship shapes,
fleets, rules and bots. The engine, the solver and the bots are the [`battleship/`](../battleship/) library,
multiplayer is [`rooms/`](../rooms/), randomness [`prng/`](../prng/).

## Artifacts

Built from the NOTICE files (`node singlefile.js battleship-game`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | the whole game in one file without any network code: bots, replays, profile, constructor — from disk, itch.io, a USB stick |
| `html@5_serverless/` | a static site: offline play, and online rooms on a server whose address the player enters |
| `html@5_backend/` | `node server.mjs [port] [--host 0.0.0.0]` (Node ≥ 18): the pages and the rooms API at `/api` on one origin; the fleets stay on the server |

Pages read `globalThis.IN_HTML_ARTIFACT.mode`: the offline build hides online play (its rooms client is
`rooms/client.offline.js`, without network code), backend pages use their own origin, serverless pages ask for a server.
Development: `node battleship-game/server.js [port]` serves the sources and mounts `backend.js` at `/api`, so online
rooms work locally too.

## Playing

- **Placement**: drag ships from the dock onto the sea (or select one and tap a cell); tap a placed ship to select it
  and tap it again to turn it, press R, or touch the sea with a second finger while dragging; the arrow keys move the
  selected ship, Delete sends it back to the dock, Ctrl+Z undoes. Random places the whole fleet with a strategy
  (uniform, along the edges, in the open sea, spread out, anti-density, quick random); Layouts saves and loads fleets
  per ruleset; rulesets with mines get a mine mode. Ships that break the touching rule turn red and Ready waits.
- **Battle**: the enemy sea (or seas: tap a sea's header to make it the target) and your own sea with the shots it took;
  the fleets afloat of every player (sunk ships struck through, as far as the rules make it public). Tap or click a cell
  to fire (optionally confirm with a second tap); salvos and volleys pick their cells and fire together (F); weapons
  preview their area (1, 2, 3 choose them, R turns the air strike); arrow keys and Enter fire from the keyboard; the
  cell menu (right click, long press, Menu key) fires, adds to the salvo, scans, strikes, marks a cell as water for
  yourself, or tells the chance of a ship there. Every answer animates — a splash, a hit, a ship going down, the halo
  appearing — unless reduced motion is asked for (system setting or Settings → Animation); sounds are synthesized.
- **Hints** (Settings): water anybody could deduce is dotted, the Hint button shows the chance of every cell (a heat
  map from Monte-Carlo fleets) and the best one; **take-backs** in games against bots (practice: no achievements).
- **Status line** tells whose turn it is and what can be done; the moves in words are in the drawer (☰); a turn timer
  fires for you when time runs out.
- **End**: both fleets open, shots, hits, accuracy, luck and skill per player (the analysis of the record, run in small
  steps), new achievements, the replay, the record (SBN) and a rematch (a seeded game continues with `seed/1`, …).

## Screens

- **Home**: play with the last setup, new game, online, replays, profile, settings, constructor, how to play.
- **New game**: the ruleset gallery (classic, party, exclusive, your own) with a picture of the sea and the rules in
  words, players (for free-for-all and teams), a bot per seat, the seed (shareable PRNG) or the CSPRNG.
- **Bot picker**: eight personalities with their principles, method and placement, the rating at every level from the
  simulations and whom they beat or lose to head to head; your own bots; the bot constructor (shooting method, placement
  strategy, targeting, six traits, level; the closest personality is shown).
- **Online**: server, public rooms, create a room (name, password, listed or not, ruleset, seats, bots, seed,
  "everybody sees my look"), join with a password or an invite link (`#room=…&server=…&invite=…` joins without the
  password), the lobby (players, bots, invite link, chat and emotes), then the battle with chat and emotes. Bots run on
  the server; every page receives only its own view.
- **Replays**: paste a record (or open a saved game, or a `#sbn=…` link), step through it with the fleets open when the
  record carries them, the moves in words with the bits of every answer, the entropy curve of every sea and the bits of
  every shot, and luck, skill and bits gathered per player (definitions in [`battleship/README.md`](../battleship/README.md)).
- **Profile**: name and avatar, results, your style (ten measured features next to the closest personality), badges,
  24 achievements.
- **Settings**: name and avatar, the look (ocean, squared-paper notebook, radar, pixel retro, high contrast), the room
  look switch, coordinates (a b c or а б в), bot speed, turn timer, animation, hints, confirm shots, take-backs, sound and
  volume, the rules of quick play and the way into the constructor.
- **Constructor**: overview (name, id, author, description, start from a preset, your rulesets, import), the sea (size,
  islands painted cell by cell or scattered), shapes (draw polyominoes on a 6 × 6 grid with rotation and mirror rights;
  copy from the shape library), fleet (shape, count, name per ship type), rules (players, teams, touching, shots, after a
  hit, announcements, halo, first shooter), weapons (radar, air strike, cluster bomb, mines), check (validation, how many
  fleets a sea can hide in bits, where ships lie and where hunters look, a quick bot tournament), look, bots, export (file,
  share code `BSR1:…`, link `#rs=…`). Test play starts a game with the draft at any time.

## Files

| file | contents |
| --- | --- |
| `index.html`, `app.css` | the page and its stylesheet (seas in five looks, effects, placement, the battle table, phone layouts, screens) |
| `main.js` | home, settings, screens, links (`#room`, `#rs`, `#sbn`), artifact modes |
| `play.js` | a game session: room ↔ placement and battle, firing, weapons, hints, timer, take-backs, log, chat, the end with the analysis |
| `grid.js` | one sea: SVG layers, the drawing of every look, animations, pointer / keyboard input, cell menus |
| `fleet.js` | the placement screen |
| `setup.js` | new game, bot picker, bot constructor |
| `online.js` | servers, rooms, create / join, lobby |
| `replay.js`, `profile.js`, `studio.js` | replays with the information curve, profile, constructor |
| `names.js`, `skins.js`, `store.js`, `sound.js` | names and rules in words, looks, local storage, WebAudio sounds |
| `strings*.js` | UI strings in en, ru, uk, de, fr, es, ka |
| `backend.js`, `server.js` | the rooms service of the backend build; the development server |
| `e2e.js` | browser scenario: `node check.js e2e <url> battleship-game/e2e.js --lang en [--mobile --size 390x844]` places a fleet (drag, R, Random), plays a game against a bot to the end (taps and the cell menu), opens the replay, the profile and every constructor tab, and — served over http with the rooms API — plays an online game between the page and a second page (an iframe joining by the invite link) |

## Limits

- Online rooms live in the server's memory (they expire after 30 idle minutes); there are no accounts. A player who
  closes the page is marked away and the others wait; bots keep playing their seats.
- Bots think on the page's main thread; Expert decisions take up to about a second on 20 × 20 seas (samples scale down
  with the size of the sea).
- The luck / skill analysis at the end and in replays uses Monte-Carlo samples: its numbers vary slightly between runs
  with different seeds.
