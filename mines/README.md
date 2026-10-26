# mines/

Minesweeper without a user interface: board shapes, configurations, mine layouts from a seeded or a cryptographic
random source, "no guessing" generation with a logical solver, the state of a game (flood reveal, chording, flags and
question marks, win and loss, undo, recorded moves for replays), share codes and statistics. Pure ES modules; they run
in the browser and in Node. Randomness comes from [`prng/`](../prng/): the same seed, configuration and first click
give the same board everywhere.

| file | contents |
| --- | --- |
| `topology.js` | `topology({ w, h, grid, nb, wrap })`: square or hexagonal (odd-r, pointy-top) cells, neighbourhoods — square `king` (8), `cross` (4), `knight` (8 knight moves), `wide` (24, a 5 × 5 ring); hex `king` (6), `wide` (18) — and wrap-around edges (a torus); `neighbors(i, out)`, `xy(i)`, `at(x, y)` |
| `config.js` | `PRESETS` (beginner 9 × 9 / 10, intermediate 16 × 16 / 40, expert 30 × 16 / 99), `normalizeConfig()` (sides 3 … 500, mine limits, rules that need each other), `maxMines`, `density`, `minesForDensity`, `presetOf`, `configKey` (the key of statistics) |
| `layout.js` | `placeMines` (uniform partial Fisher–Yates around protected cells), `countNumbers`, `protectedCells`, `startCell`, `generateLayout`, `noGuessSteps` (generator with progress), `runSteps` / `runStepsAsync` (time slices for the page), `bbbv` (3BV) |
| `solver.js` | `Solver` (single-constraint, pair / subset and mine-count deductions on any topology), `probabilities()` (exact per frontier component, weighted by the arrangements of the cells no number touches), `analyzeView()` for hints |
| `game.js` | `Game`: layout at the first click or fixed by the seed, `reveal` / `chord` / `flag` / `undo`, `apply(move)` for replays, `view()` for the solver; cell states `HIDDEN`, `OPEN`, `FLAG`, `MARK` |
| `code.js` | `encodeGame` / `decodeGame` (configuration + seed or layout bits + start cell + moves as URL parameters, for links and the hash), `encodeMoves` / `decodeMoves` (varint time deltas in base64url), `minesToBits` / `bitsToMines` |
| `stats.js` | statistics and the five best times per configuration; assisted games (hints, undo, a retried board) are counted but never ranked |
| `test.js` | unit tests: `node mines/test.js` |

## Rules a configuration can set

- `first`: `'opening'` (the first click and its neighbourhood are free of mines; the board depends on the seed and on
  that click), `'safe'` (only the clicked cell), `'marked'` (the seed alone fixes the board and a marked start cell
  opens an area — everyone with the seed plays the same board), `'off'` (the seed alone fixes the board, no
  protection).
- `noGuess`: the generator moves mines until a fresh solver clears the board from the first opening without a single
  guess (needs `'opening'` or `'marked'`). Typical cost on a desktop: an expert board in about 1 ms, 100 × 100 at 20 %
  density in about 10 ms.
- `marks`: flagging a flag once more puts a question mark (the mine counter ignores it).
- `grid`, `nb`, `wrap`: the board shape and what the numbers count (numbers go up to 24 with `wide`).

## Example

```js
import { Game } from './mines/game.js';

const g = new Game({ w: 16, h: 16, mines: 40, noGuess: true }, { kind: 'seeded', seed: 'cold-river-amber-41' });
const first = 120;
g.prepare(g.layoutFirst(first)); // creates the layout around the first click
g.reveal(first, 0);              // -> { opened: [...], lost, won, boom }
const hidden = g.st.indexOf(0);  // HIDDEN
g.flag(hidden, 850);             // times are milliseconds since the start (kept for replays)
g.status;                        // 'ready' | 'playing' | 'won' | 'lost'
```

A `{ kind: 'crypto' }` source draws boards from `crypto.getRandomValues`; such a board cannot be recreated from a seed,
so share codes carry its layout bits (`layoutBits()`).
