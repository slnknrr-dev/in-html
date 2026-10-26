# sudoku/

Sudoku engine: grids of any size from 4 × 4 to 64 × 64 with rectangular boxes, irregular (jigsaw) regions or no boxes,
overlapping multi-grid layouts, 40 variants with their clues, an exact solver that counts solutions, a human-style
logical solver that grades puzzles and explains every step, a seeded generator of puzzles with exactly one solution,
symbol alphabets, compact puzzle codes, SVG drawing and a `rooms/` game definition for shared and race games. Pure ES
modules without DOM access: the same code runs in browsers, Workers and Node.

| file | contents |
| --- | --- |
| `geometry.js` | shapes: `makeGeometry({ n, box, regions, layout })` → cells, houses (rows, columns, boxes / regions of every sub-grid), region ids; `boxShapes(n)`, `defaultBox(n)`; multi-grid `LAYOUTS` (samurai, twodoku, butterfly, sohei, flower); `randomRegions(n, rng)` and `regionsForSolution(n, solution, rng)` (jigsaw regions); neighbour helpers |
| `bits.js` | candidate sets as bit masks (bit v = value v + 1; up to 31 values in one int32); sets for every size (`setOf`, `setHas`, `setWith`, `setBits`…: an int32, or `[lo, hi]` once a value above 32 is in it) for pencil marks and hint steps |
| `wide.js` | grids above 31 × 31 (up to 64): two int32 words per cell — houses, propagation, search, logical techniques up to level 2; `solver.js` and `logic.js` hand wide models over once per model, so smaller grids keep the int32 code |
| `constraints.js` | propagators shared by both solvers: houses, pair relations (consecutive, double, sums, order, whispers, parity…), linear sums, combination sets (cages, renban), sandwich, skyscraper, X-sums, between lines, zippers, quadruples, enumerated windows |
| `rules.js` | global rules: diagonal, windoku, disjoint groups, centre dot, asterisk, girandola, anti-knight, anti-king, non-consecutive, magic square, and the negative rules of dot / sign variants ("all dots are given") |
| `clues.js` | the drawn clues (cage, parity, kropki, xv, consec, gt, thermo, arrow, renban, whisper, dutch, palindrome, parityline, between, zipper, entropic, modular, quad, sandwich, sky, xsum, frame, little) and the constraints they stand for |
| `model.js` | `compile(puzzle)` → the solver model (houses, all-different groups, constraints, peers, initial candidates); `startFor(model, values)` |
| `solver.js` | exact solver: propagation to a fixpoint + MRV search with a counted node budget; `solve(model, { limit })` counts solutions, `isUnique`, `randomSolution(model, rng)`, `propagated` |
| `logic.js` | logical solver: full house, naked / hidden singles, clue logic, locked candidates, naked / hidden pairs, triples, quads, X-wing, swordfish, jellyfish, XY- and XYZ-wings, simple colouring, trial; `createLogic(model)` → `next`, `apply`, `solve`, `hint`; `grade(model)`; `TECHNIQUES`, `LEVEL_NAMES` |
| `variants.js` | the catalogue: `VARIANTS` (shape, rules, clue makers, supported sizes), `variant(id)`, `sizesFor(id)` (the listed sizes 4–25), `sizeProblem(id, n)` (why a typed size cannot be played), `wideOK`, `WIDE_RULES`, `EXTRA_RULES` |
| `generate.js` | `generate(options, rng, { onProgress })` → `{ puzzle, solution, grade }`; `normalize(options)`, `DIFFICULTIES`, `difficultiesFor(n)`, `SYMMETRIES` |
| `symbols.js` | alphabets (digits, hex, Latin, Greek, Cyrillic, Georgian, hiragana, Roman numerals, shapes, fruit, animals, colours) and custom lists: `symbolsFor`, `parseCustom`, `keyMap`, `needsLegend` |
| `codec.js` | puzzle codes (`S1` + base64url of deflated JSON): `encodePuzzle`, `decodePuzzle` (strict), `cleanPuzzle`; classic grid text: `gridString`, `parseGrid` |
| `board.js` | a player's board (values, corner and centre marks, colours) changed only by moves; every move returns an undo patch |
| `svg.js` | SVG strings of puzzles: `layout`, `staticLayers` (shading, lines, grid, clues), `valueText`, `notesSVG`, `puzzleSVG` (documents for export and print, `EXPORT_CSS`) |
| `game.js` | the `rooms/` game definition: shared (`coop`) and `race` modes, cursors, checks, reveals, spectators, bots that solve logically |
| `test.js` | `node sudoku/test.js`: known puzzles, uniqueness, grades, generator determinism, every variant generated and checked by an independent rule checker, codes, boards, alphabets, rooms games |

## Puzzles

A puzzle is plain JSON: `{ n, box: [w, h] | null, regions: number[n·n] | null, layout: id | null, rules: [id],
clues: [{ t, … }], givens: number[rows·cols], variant, difficulty, level, seed }`. Cells are indices in the rows × cols
frame (`r * cols + c`); multi-grid layouts leave holes. Numbers are 1..n everywhere; an alphabet only changes how they
are drawn and typed, so arithmetic clues keep their meaning (number k is the k-th symbol).

## Generation

`generate()` makes a random complete grid that satisfies every rule (seeded `prng/` streams forked per attempt, every
search with a counted budget, so a seed always gives the same puzzle), derives the variant's clues from it, removes
givens in symmetric groups (batch removal with group testing) while the puzzle stays unique and solvable by the
techniques of the difficulty, prunes clues that are not needed, and grades the result. Jigsaw grids above 12 × 12 are
made solution first: the regions are bent around a complete grid by moving cells of one number along cycles of
neighbouring regions. Grids above 16 × 16 are offered up to *hard* (grading expert puzzles of 625 cells takes minutes;
medium and hard above 25 × 25 can take a minute). Grids above 31 × 31 keep two words of candidates per cell
(`wide.js`), have houses and "must differ" pairs only (classic, no boxes, diagonal, windoku, disjoint groups, centre dot,
anti-knight, anti-king; no drawn clues) and are *easy* only: 49 × 49 takes about 2 s, 64 × 64 about 20 s. Prime sizes
have no boxes. Codes and alphabets (digits, hex) go on to 64 symbols; the first 25 never change, so old codes decode.

| difficulty | techniques (levels of `logic.js`) |
| --- | --- |
| easy | singles and simple clue logic (1) |
| medium | + locked candidates, pairs, arithmetic clue logic (2) |
| hard | + triples, X-wing, quads, swordfish, jellyfish, wings (3–4) |
| expert | + colouring and trial (5–6) |
| extreme | the hardest candidate found, possibly beyond the techniques (6–7) |
