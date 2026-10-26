# Sudoku Variants (`sudoku-game`)

Sudoku in 40 variants — from the classic to rare rule sets — on grids from 4 × 4 to 64 × 64, with hints that explain
the logic, your own symbols, six looks, a daily puzzle, and games with friends or bots. Phones and tablets are
first-class. The puzzles come from the [`sudoku/`](../sudoku/) engine, randomness from [`prng/`](../prng/), shared and
race games from [`rooms/`](../rooms/).

Built from its NOTICE files (`node singlefile.js sudoku-game`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | the whole game in one file (about 600 KB) without any network code: open it from disk, upload it to itch.io as an HTML game, host it anywhere; games alone and against bots |
| `html@5_serverless/` | a static site for any static host; online rooms with a game server the player enters |
| `html@5_backend/` | a self-hosted game server: `node html@5_backend/server.mjs [port]` (Node ≥ 18, no dependencies) serves the game and the rooms API; invite links work at once |
| `html@5_standalone/index.html` | one file that also opens from `file://` and reaches game servers over HTTPS + CORS (no server preset) |

Development: `node sudoku-game/server.js` serves the sources and mounts `backend.js` at `/api`, so online rooms work
on the development page too.

## Features

- **40 variants** in six families, each with its rules, an example (with its solution) and a picture in the
  catalogue: *classic* (any box shape, or none: a Latin square); *shapes* — jigsaw, samurai, twodoku, butterfly, sohei,
  flower; *extra rules* — diagonal, windoku, disjoint groups, centre dot, asterisk, girandola, anti-knight, anti-king,
  non-consecutive, magic square; *cell clues* — killer, even–odd, kropki, XV, consecutive, greater-than, quadruple;
  *lines* — thermometer, arrow, renban, German and Dutch whispers, palindrome, parity, between, zipper, entropic and
  modular lines; *outside clues* — sandwich, skyscraper, X-sums, frame, little killer. Extra rules can be added to any
  variant where they fit (a jigsaw with anti-knight, a killer with diagonals…).
- **Sizes and difficulty**: every size the variant supports (4 × 4 … 25 × 25 in the list; *Custom…* takes any size typed
  as `a` or `a×a` up to 64 × 64, says why a size does not fit the variant and stays in the list once used; boxes of every shape such as 2 × 3 or
  4 × 3, or none), five difficulties graded by the techniques a solver needs (singles up to colouring and trial),
  symmetric givens (rotational, mirror, diagonal or none). Puzzles are made in a Worker with a progress bar and a
  cancel button; every puzzle has exactly one solution.
- **Randomness**: secure random (the browser's CSPRNG, a fresh unpredictable puzzle) or a seed (any text, or a random
  readable seed): the same seed and options always give the same puzzle. The seed is shown and copied; *Share* makes
  a link with the options and the seed (or the puzzle code); *Open a puzzle* accepts codes, links and classic 81-digit
  grids. A daily puzzle (a different variant every day) is the same for everybody.
- **Playing**: tap / click, drag to select several cells, Ctrl / Shift to add, double tap for every cell with a
  symbol; normal, corner, centre and colour modes; a number pad sized for phones with the counts left; keyboard
  (symbols, Shift / Alt + digit for marks, arrows, Space, Z X C V, Ctrl+Z / Ctrl+Y, H, P); undo / redo; highlighting of
  the row, column and box and of the same symbol (also in pencil marks); rule conflicts (repeated symbols, broken
  clues); optional instant mistakes; candidates for all cells or a selection; check, reveal a cell, show the solution;
  timer with pause (also when the page is hidden); the game is saved after every move and resumes after a reload.
- **The cell menu**: a right click, a long press by touch or pen, the Menu key or Shift+F10 open a small menu of the
  cell (pencil marks, highlight this symbol, candidates here, clear, reveal). The browser's menu, the touch callout and
  text selection never appear over the board.
- **Hints that teach**: the logical solver runs from your correct entries to the next placement; the hint first
  highlights the area, then explains every step (technique, houses, cells, symbols, eliminations drawn on the board),
  then places the symbol. Wrong entries are found first.
- **Big grids**: pinch, Ctrl + wheel or the buttons zoom, one finger or the wheel pans when zoomed, the keyboard
  cursor stays in view; 25 × 25 grids stay playable on phones; above 25 symbols the number pad gets smaller keys and
  scrolls.
- **Symbols**: digits, hexadecimal, Latin, Greek, Cyrillic or Georgian letters, hiragana, Roman numerals, shapes,
  fruit, animals, colours, or your own list (`ABCDEFGHI`, `🍎🍐🍊…`, `one two three`), validated for the size. A legend
  shows which symbol stands for which number when the clues are arithmetic.
- **Looks**: Modern, Newspaper (serif ink on paper; a night edition in the dark), Wood (a carved board), Pastel,
  Neon (glowing, always dark) and High contrast, each with a light and a dark palette following the page theme;
  animations respect `prefers-reduced-motion`; optional synthesized sounds.
- **Together**: *against bots* (in the page, also in the offline build) — a race or a shared grid with one to three
  bots at four speeds; *online rooms* — shared grid (everybody's cursor in colour, symbols in the colour of who placed
  them) or race (progress bars), 2–8 seats, server-side bots, an optional password, public listing, invite links with
  a QR code, a lobby, chat, spectators, rematches with a new puzzle.
- **Results and records**: the result card (time, hints, mistakes, best time), statistics per variant, size and
  difficulty (best and average times, solved without hints).
- **Print and export**: the puzzle, your progress or the solution as SVG, PNG or printed.
- 7 UI languages (en, ru, uk, de, fr, es, ka) — rules, technique names and hint explanations included; screen-reader
  announcements of the selected cell.

## Files

| file | purpose |
| --- | --- |
| `index.html` | page skeleton, favicon |
| `main.js` | entry: shell, skins, making games (progress dialog), resume, share and invite links, Back button; in a Worker only the generator runs |
| `home.js` | the home screen: game in progress, daily puzzle, catalogue with filters and pictures, options of a new game |
| `play.js` | the play screen for games alone and in rooms: input, moves, undo, conflicts, hints, timer, saving, results |
| `view.js` | the board: SVG layers, pointer input, zoom and pan, the cell menu |
| `hints.js` | hints: the next logical placement and the explanation of each step |
| `online.js` | games against bots, online rooms (create, join, invite, lobby, chat, rematch) |
| `dialogs.js` | rules with examples, settings, how to play, statistics, export, open a puzzle, progress |
| `gen.js` | puzzle generation in a Worker (the page's own module in single-file builds) |
| `pictures.js` | small pictures of puzzles in the current skin, example puzzles of every variant |
| `common.js` | the artifact mode, symbols, names, links, the daily puzzle, player colours |
| `store.js` | local storage: preferences, the game in progress, statistics, daily results |
| `shell.js` | links between the screens |
| `strings.js`, `strings-variants.js` | UI strings, variant rules, techniques and explanations in 7 languages |
| `app.css` | skins, board, play screen, home, dialogs |
| `backend.js` | the rooms service with the sudoku game (BACKEND builds and the development server) |
| `server.js` | development server instance |
| `*_NOTICE.md` | the build targets |

Local storage: `sudoku-prefs` (look, symbols, aids, name, server, the last options), `sudoku-save` (the game in
progress), `sudoku-stats`, `sudoku-daily`; the shell uses `sudoku-ui` and `sudoku-theme`; an online room is remembered
for the tab in `sessionStorage` (`sudoku-room`).

## itch.io

Upload `html@5_offline_singlefile/index.html` (or a zip of `html@5_serverless/`) as an HTML game; the page fits any
iframe size, has a full-screen command and needs no server. For online rooms with the serverless or standalone build,
run the backend build somewhere reachable over HTTPS and enter its address in *Online*.

## Limits

- Expert and extreme puzzles on big grids (12 × 12 and more) can take up to a minute to make; grids above 16 × 16 are
  offered up to *hard* (medium and hard above 25 × 25 take up to a minute or two); grids above 31 × 31 are *easy*
  only, for the classic and the rule variants without clues (64 × 64 takes about half a minute).
- Online rooms live in the server's memory (they end after 30 idle minutes or 12 hours); a page reload rejoins the room
  of the tab.
- Bots solve logically and never make mistakes; their speed is a thinking time per placement.
