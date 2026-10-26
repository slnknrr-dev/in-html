# Sapper (`miner-game`)

Minesweeper that runs entirely in the browser and never touches the network: any board size up to 500 × 500, hexagons,
a torus and other neighbourhoods, boards without guessing, alphabets instead of numbers, six themes, seeds you can
share, replays. Phones and tablets are first-class. Built from its NOTICE files (`node singlefile.js
miner-game`):

- `html@5_offline_singlefile/index.html` — the whole game in one file (about 320 KB): open it from disk, upload it to
  itch.io as an HTML game, host it anywhere;
- `html@5_offline/` — the same as a small static site with separate, cacheable modules.

Development: `node miner-game/server.js`. The rules engine is the [`mines/`](../mines/) library, randomness
comes from [`prng/`](../prng/).

## Features

- **Boards**: Beginner 9 × 9 / 10, Intermediate 16 × 16 / 40, Expert 30 × 16 / 99, or any width and height from 3 to
  500 with a mine count or a density. Square or hexagonal cells; numbers count the 8 cells around (classic), a cross
  of 4, knight moves, or a wide 5 × 5 ring (numbers up to 24; hexagons: 6 or 18); wrap-around edges (a torus, with
  faded copies of the opposite edges drawn around the board).
- **First click**: opens an area (default), is never a mine, a marked start cell (the seed alone fixes the board, so
  everyone with the seed plays the same one), or not protected.
- **No guessing**: a logical solver (single numbers, pairs of numbers, the mine count) checks that the board can be
  cleared from the first opening; the generator moves mines until it can. Large boards are built in time slices with a
  progress card and a cancel button.
- **Seeds**: seeded boards (xoshiro128** seeded with SHA-256 of a readable seed such as `cold-river-amber-41`) or
  secure ones (`crypto.getRandomValues`, no seed). The current seed is shown and copied, any text can be played as a
  seed, and a link (the hash carries configuration + seed, or the layout itself for secure boards) gives a friend the
  same board. A daily challenge (intermediate, no guessing, marked start, seed `daily-YYYY-MM-DD`) is the same for
  everyone on a given day.
- **Playing**: flags, optional question marks, chording (middle click, both buttons, a right click or — optional — a
  click on a satisfied number), mine counter and timer on seven-segment displays, the face button, hints (a safe cell
  or a certain mine with the reason, a wrong flag, or the safest guess with its probability), optional undo (off by
  default; hints and undo keep a game out of the best times), the game resumes after a reload.
- **Results and records**: time, 3BV, 3BV/s and efficiency; statistics, streaks and the five best times for every
  configuration; replays of any finished game (play / pause, seek, 0.5–8× speed), the last game and every best time
  replayable.
- **Look**: six themes — Classic (grey bevels, red LCD digits, the yellow face), Meadow (checkered grass), Flat,
  Neon (glow), Paper (hand-drawn; a blueprint in the dark), Terminal (green phosphor) — each with a light and a dark
  palette following the page theme (Neon and Terminal are always dark). Symbols for the numbers: digits, Roman
  numerals, Latin, Greek, Cyrillic or Georgian letters, Chinese numerals, Arabic-Indic and Devanagari digits,
  hexadecimal, binary, bars, moods, dice pips, or your own list (`🍎🍐🍊…`, `one two three`); your own mine and flag
  symbols. Animations (reveal ripple, flag pop, explosion and mine cascade, confetti) follow `prefers-reduced-motion`
  unless set on or off; sound effects are synthesized with WebAudio (off by default).
- **Big boards**: the canvas draws only the visible cells from a sprite atlas, and cells too small for pictures as
  colour blocks: a 500 × 500 board opens and redraws in milliseconds. Zoom from 5 to 110 px per cell.
- 7 UI languages (en, ru, uk, de, fr, es, ka), screen-reader announcements of the cursor cell and the result.

## Controls

| | |
| --- | --- |
| Mouse | left click opens, right click (Control-click on a Mac) flags (then a question mark, when on); middle click, both buttons, a right click on a number or a click on a satisfied number open around it; drag pans, the wheel zooms (touchpads pan, Ctrl + wheel zooms) |
| Touch and pen | tap opens, a long press flags with a short vibration (delay 200–900 ms, default 380); the Open / Flag switch — or the setting "A tap or a left click: flags" — swaps them; one finger pans, two fingers pinch-zoom |
| Keyboard | arrows move a cursor (Shift: five cells; Home / End / PageUp / PageDown jump to the edges), Enter or Space opens, F flags, C opens around, the Menu key or Shift+F10 lists the actions of the cell, H hint, M switches the tap mode, N or F2 new game, Z / U / Ctrl+Z undo, + − 0 zoom and fit, Esc closes the result or the replay |
| Face button | click: new game; right click or long press: difficulty, daily challenge, retry, copy link |

The right button and the long press are game input: the browser menu, the touch callout, text selection and the
magnifier never appear over the game (`contextmenu`, `selectstart` and `touchstart` are cancelled on the board; the
stage is not selectable). Wide boards are turned by a quarter on tall screens (and tall ones on wide screens) so the
cells stay large; touch screens keep cells at least 30 px.

## Files

| file | purpose |
| --- | --- |
| `index.html` | page skeleton, favicon |
| `main.js` | settings and storage, the game flow (layout at the first click, no-guess generation with progress, reveal / flag / chord, win and loss), HUD, toolbar, result card, hints, replays, share links, daily challenge, menus, resume after a reload |
| `board.js` | the canvas view: sprite atlas, visible-cell rendering, camera (zoom, pan, fit, upright turn), square and hex hit testing, torus ghosts, animations |
| `input.js` | mouse (chorded buttons through pointer events), touch and pen (long press, pan, pinch), keyboard cursor and the cell menu key |
| `panel.js` | the settings panel (a bottom sheet on phones): new game, rules, controls, seed and sharing, look, records, help |
| `skins.js` | themes and their palettes, symbol sets, the cell painter (hidden, pressed, numbers, flags, marks, mines) |
| `hud.js` | the face and seven-segment digits as inline SVG |
| `sound.js` | synthesized sound effects |
| `strings.js` | UI strings (`mn.*`) in 7 languages |
| `app.css` | layout, the skins of the stage, HUD, toolbar, cards, panel |
| `server.js` | development server instance |
| `OFFLINE_NOTICE.md`, `SINGLEFILE_OFFLINE_NOTICE.md` | the build targets |

Local storage: `miner-settings`, `miner-stats` (statistics, best times with their replays), `miner-resume` (the game
in progress), `miner-last` (the last finished game); the shell keeps `miner-theme` and `miner-ui`.

## itch.io

Upload `html@5_offline_singlefile/index.html` (or a ZIP of `html@5_offline/`) as an HTML game; it runs in the iframe
with no network access and keeps statistics in the iframe's local storage. A viewport of about 1280 × 800 suits
desktops; the page also adapts to phones (the settings become a bottom sheet). Enable itch.io's full-screen button: the
in-game full-screen button needs the iframe's `allowfullscreen`.

## Limits

- Boards up to 500 × 500 cells; share links of secure (CSPRNG) boards carry the layout (about 1.4 characters per 8
  cells), and replays longer than 24 000 characters are not kept with a best time.
- No-guess boards are made by moving mines where the solver gets stuck, so very dense ones get clumps of mines. In
  tests the generator succeeded on every board tried (expert size up to 60 % mines, 500 × 500 at 16 % in about
  0.2 s); if it ever gives up, the game says so and the board may need a guess. The solver reasons locally (single
  numbers, pairs of numbers, the mine count): boards whose only way on needs three or more numbers at once are not
  produced, and hints beyond those rules come from exact probabilities.
- Hexagonal boards are not turned upright on tall screens.
- Vibration needs the Vibration API (not in iOS Safari); full screen is unavailable in iframes without permission.
