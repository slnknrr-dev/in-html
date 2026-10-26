// sudoku-game/pictures.js - small pictures of puzzles styled by the current skin (the same sd-* classes as the board):
// variant cards, the saved game, rules examples; and the example puzzle of every variant, made once per page in a
// Worker (gen.js) and shared by the screens.
//
//   picture(puzzle, symbols, { values, solution, cls }) -> '<svg …>'
//   example(variantId) -> Promise<{ puzzle, solution }>     cachedExample(id)     loadExamples(ids, onItem)

//
// Pictures are SVG strings (not DOM) so they can be cached, inserted with one innerHTML, exported and printed. Colours
// come from the stylesheet through the sd-* classes, so a skin change restyles every thumbnail for free.
import { geometryOf, layout, staticLayers, valueText } from '../sudoku/svg.js';
import { examplePuzzles, exampleSize } from './gen.js';

// One decimal in coordinates: visually exact at thumbnail size and keeps the markup short.
const f = (x) => Math.round(x * 10) / 10;

// Layer order matters in SVG (painter's model, no z-index): shading, under-lines, grid, over-clues, digits.
// Decorative pictures are aria-hidden; with a label they become role=img with an accessible name.
export function picture(puzzle, symbols, { values = null, solution = null, cls = 'sg-pic', label = '' } = {}) {
  const L = layout(puzzle);
  const g = geometryOf(puzzle);
  const st = staticLayers(puzzle, symbols);
  let vals = '';
  for (const i of g.cells) {
    const given = puzzle.givens && puzzle.givens[i];
    const v = given || (values && values[i]) || (solution && solution[i]) || 0;
    if (v) vals += valueText(puzzle, i, v, symbols, given ? 'sd-given' : 'sd-value', L);
  }
  return `<svg class="${cls}" viewBox="0 0 ${f(L.width)} ${f(L.height)}" role="img"${label ? ` aria-label="${label.replace(/"/g, '&quot;')}"` : ' aria-hidden="true"'}>` +
    st.shade + st.under + st.grid + st.over + vals + '</svg>';
}

// Examples are generated once per page load and shared by all screens; `waiting` holds promises of callers that
// asked before the worker delivered. `batch` is the one in-flight multi-variant job, so overlapping requests for the
// same ids do not start duplicate workers.
const cache = new Map();   // id -> { puzzle, solution }
const waiting = new Map(); // id -> [resolve]
let batch = null;

function deliver(item) {
  cache.set(item.variant, item);
  for (const r of waiting.get(item.variant) || []) r(item);
  waiting.delete(item.variant);
}

export const cachedExample = (id) => cache.get(id) || null;

// KNOWN DEFECT: if generation of this variant fails (exampleJob throws and the worker skips it), the promise never
// settles and a caller awaiting it waits forever. Fix: after examplePuzzles resolves, resolve remaining waiters of
// the requested ids with null (or reject).
export function example(id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  return new Promise((resolve) => {
    (waiting.get(id) || waiting.set(id, []).get(id)).push(resolve);
    if (!batch || !batch.ids.includes(id)) examplePuzzles([{ variant: id, n: exampleSize(id) }], deliver).catch(() => {});
  });
}

// Examples of many variants in one Worker job; onItem(item) for each (cached ones at once).
// Cached items are delivered synchronously; the rest join the current batch. Listeners accumulate on the batch, so
// every screen that asked gets every item as it arrives.
export function loadExamples(ids, onItem) {
  for (const id of ids) if (cache.has(id)) onItem(cache.get(id));
  const missing = ids.filter((id) => !cache.has(id) && !(batch && batch.ids.includes(id)));
  const listeners = batch ? batch.listeners : new Set();
  listeners.add(onItem);
  if (!missing.length) return;
  batch = { ids: [...(batch ? batch.ids : []), ...missing], listeners };
  examplePuzzles(missing.map((id) => ({ variant: id, n: exampleSize(id) })), (item) => { deliver(item); for (const fn of listeners) fn(item); }).catch(() => {});
}
