// sudoku-game/gen.js - puzzle generation off the main thread. A job runs in its own Worker (cancel = terminate), so
// big grids never freeze the page; the progress of the generator (sudoku/generate.js) is reported as it goes. The
// Worker source is the page's own bundled module in the single-file build (main.js then calls genWorkerMain()) or a
// module that imports this file when served from sources; without Workers the job runs in the page.
//
//   makePuzzle(options, random, { onProgress, signal }) -> Promise<{ puzzle, solution, grade, code }>
//   examplePuzzles(items, onItem, { signal }) -> Promise   items: [{ variant, n }], onItem({ variant, n, puzzle, solution })
//   exampleSize(variantId) -> n                           genWorkerMain()

//
// Why a Worker per job (not a pool): generation of a 16x16 or 25x25 expert puzzle can take seconds of pure CPU, and
// JS has no way to interrupt a running loop. terminate() is the only real cancel, and a terminated worker is gone, so
// each job gets a fresh one. Startup cost (~tens of ms) is negligible next to generation.
import { generate } from '../sudoku/generate.js';
import { encodePuzzle } from '../sudoku/codec.js';
import { sizesFor, variant as variantOf } from '../sudoku/variants.js';
import { makeRandom } from '../prng/prng.js';

class WorkerUnavailable extends Error {}

// The worker needs this module's code. From sources: a tiny module that imports gen.js by its absolute URL. In the
// single-file build there is no gen.js URL, so the whole inline <script type=module> (the bundle) becomes the worker
// source; main.js detects the worker context and calls genWorkerMain() instead of starting the UI.
// The "> 1000 chars" filter picks the bundle and skips small inline helper scripts.
function workerURL() {
  const here = import.meta.url;
  let src;
  if (/\/gen\.js(?:[?#].*)?$/.test(here)) src = `import { genWorkerMain } from ${JSON.stringify(here)};\ngenWorkerMain();\n`;
  else {
    const inline = Array.from(document.querySelectorAll('script[type="module"]')).find((s) => !s.src && s.textContent.length > 1000);
    if (!inline) throw new WorkerUnavailable('no inline module');
    src = inline.textContent;
  }
  return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}

// Sticky flag: once a worker failed to start (CSP forbids blob: workers, file:// restrictions), later jobs go straight
// to the in-page fallback instead of paying the 15 s timeout again.
let workersBroken = false;

function startWorker() {
  return new Promise((resolve, reject) => {
    if (workersBroken || typeof Worker === 'undefined') { reject(new WorkerUnavailable('no workers')); return; }
    let url, w;
    try { url = workerURL(); w = new Worker(url, { type: 'module' }); } catch (e) { workersBroken = true; reject(new WorkerUnavailable(e.message)); return; }
    const fail = (msg) => { clearTimeout(timer); try { w.terminate(); } catch { /* gone */ } URL.revokeObjectURL(url); workersBroken = true; reject(new WorkerUnavailable(msg)); };
    // Handshake: the worker posts 'ready' after its module graph loaded. No 'ready' in 15 s = treat as unavailable.
    // The blob URL is revoked once the worker started: it already holds the source, and the URL would leak otherwise.
    const timer = setTimeout(() => fail('worker did not start'), 15000);
    w.onmessage = (e) => { if (e.data && e.data.type === 'ready') { clearTimeout(timer); URL.revokeObjectURL(url); resolve(w); } };
    // preventDefault stops the error from also being reported as an uncaught error in the page console.
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); fail((e && e.message) || 'worker error'); };
  });
}

// Runs a job in a Worker: onMessage(m) for 'progress' / 'item' messages; resolves with the 'done' payload.
// AbortSignal integration: abort terminates the worker and rejects with { cancelled: true }, which callers treat
// as a silent cancel (not an error toast).
async function runInWorker(job, onMessage, signal) {
  const w = await startWorker();
  return new Promise((resolve, reject) => {
    const done = () => { if (signal) signal.removeEventListener('abort', abort); try { w.terminate(); } catch { /* gone */ } };
    const abort = () => { done(); reject(Object.assign(new Error('cancelled'), { cancelled: true })); };
    if (signal) { if (signal.aborted) { abort(); return; } signal.addEventListener('abort', abort, { once: true }); }
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'done') { done(); resolve(m.result); }
      else if (m.type === 'error') { done(); reject(new Error(m.message)); }
      else onMessage(m);
    };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); done(); reject(new Error((e && e.message) || 'worker error')); };
    w.postMessage(job);
  });
}

// Fallback path runs on the main thread: yield one task first so the "generating" overlay can paint before the
// page freezes for the duration of the job.
const yieldToPage = () => new Promise((r) => setTimeout(r, 30));

// --- jobs (the same code in the Worker and in the page) -------------------------------------------------------

// Same function in worker and page: seeded random -> reproducible puzzle (share links, daily); otherwise crypto
// randomness. The seed is stored on the puzzle so a share link can be produced later.
function makeJob({ options, random }, onProgress) {
  const rng = makeRandom(random && random.kind === 'seeded' ? { kind: 'seeded', seed: String(random.seed) } : { kind: 'crypto' });
  const r = generate(options, rng, { onProgress });
  if (random && random.kind === 'seeded') r.puzzle.seed = String(random.seed);
  return { puzzle: r.puzzle, solution: r.solution, grade: r.grade, code: encodePuzzle(r.puzzle) };
}

// Thumbnails use the smallest pleasant size (6x6 if offered, else 9x9); multi-grid layouts use 4x4 grids to keep
// samurai-like pictures generation-cheap and still recognisable.
export function exampleSize(id) {
  const v = variantOf(id);
  const sizes = sizesFor(id);
  if (!v || !sizes.length) return 9;
  if (v.layout) return 4;
  return sizes.includes(6) ? 6 : sizes.includes(9) ? 9 : sizes[0];
}

// Fixed seed per variant: every visit shows the same example picture, and the rules dialog can describe it.
function exampleJob(item) {
  const r = generate({ variant: item.variant, n: item.n || exampleSize(item.variant), difficulty: 'medium' }, makeRandom({ kind: 'seeded', seed: `example ${item.variant}` }));
  return { variant: item.variant, n: r.puzzle.n, puzzle: r.puzzle, solution: r.solution };
}

// --- public API ------------------------------------------------------------------------------------------------

export async function makePuzzle(options, random, { onProgress = () => {}, signal = null } = {}) {
  try {
    return await runInWorker({ type: 'gen', options, random }, (m) => { if (m.type === 'progress') onProgress(m.p); }, signal);
  } catch (e) {
    if (!(e instanceof WorkerUnavailable)) throw e;
    await yieldToPage();
    if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
    return makeJob({ options, random }, onProgress);
  }
}

export async function examplePuzzles(items, onItem, { signal = null } = {}) {
  try {
    await runInWorker({ type: 'examples', items }, (m) => { if (m.type === 'item') onItem(m.item); }, signal);
  } catch (e) {
    if (!(e instanceof WorkerUnavailable)) throw e;
    for (const it of items) {
      if (signal && signal.aborted) return;
      await yieldToPage();
      try { onItem(exampleJob(it)); } catch { /* skip */ }
    }
  }
}

export function genWorkerMain() {
  self.onmessage = (e) => {
    const m = e.data || {};
    try {
      if (m.type === 'gen') {
        let last = 0;
        // Progress throttled to one message per 80 ms: the generator reports far more often, and flooding the
        // message channel would slow both threads.
        const result = makeJob(m, ({ fraction }) => {
          const now = Date.now();
          if (now - last > 80) { last = now; self.postMessage({ type: 'progress', p: { fraction } }); }
        });
        self.postMessage({ type: 'done', result });
      } else if (m.type === 'examples') {
        for (const it of m.items || []) {
          try { self.postMessage({ type: 'item', item: exampleJob(it) }); } catch { /* a variant that fails is skipped */ }
        }
        self.postMessage({ type: 'done', result: true });
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
  self.postMessage({ type: 'ready' });
}
