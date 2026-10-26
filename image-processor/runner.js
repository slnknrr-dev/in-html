// image-processor/runner.js - page side of the processing: starts a module Worker from a Blob (the page's own
// bundled script in the single-file build, an import of worker.js when served from sources), runs one job at a time
// (live previews first, a newer preview replaces a waiting one) and falls back to running jobs in the page, in small
// steps, when no worker can be started.

import { dropCached, runJob } from './worker.js';

// Worker source: the inline module of the built page re-runs as a worker (main.js then calls workerMain()); from
// sources, a module that imports worker.js next to this file.
// Blob URL of a tiny module (dev) or of the page's own inline bundle (single-file build, where no separate worker
// file exists). Module workers from blob: URLs work offline and from file://, where a plain new Worker('worker.js')
// would be blocked by origin rules.
function workerURL() {
  const here = import.meta.url;
  let src;
  if (/\/runner\.js(?:[?#].*)?$/.test(here)) src = `import { workerMain } from ${JSON.stringify(here.replace(/runner\.js(?:[?#].*)?$/, 'worker.js'))};\nworkerMain();\n`;
  else {
    const inline = Array.from(document.querySelectorAll('script[type="module"]')).find((s) => !s.src && s.textContent.length > 1000);
    if (!inline) throw new Error('no inline module');
    src = inline.textContent;
  }
  return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}

// Lanes: draft (slider drag), preview (settled settings), export (downloads). Lower number = served first.
const PRIORITY = { draft: 0, preview: 1, export: 2 };

// One job at a time: image jobs are memory-heavy, and running two in parallel risks out-of-memory on phones for no
// throughput gain (the worker is single-threaded anyway). The worker announces "ready"; if it does not within 10 s
// (module workers unsupported, CSP, broken bundle) the runner falls back to in-page processing.
export function createRunner({ onMode } = {}) {
  let worker = null, mode = 'starting', seq = 0, current = null;
  const waiting = [];
  const setMode = (m) => { mode = m; if (onMode) onMode(m); pump(); };

  function finish(err, res) {
    const c = current;
    current = null;
    if (c) { if (err) c.reject(err); else c.resolve(res); }
    pump();
  }

  function start() {
    let url;
    try { url = workerURL(); worker = new Worker(url, { type: 'module' }); } catch { setMode('inline'); return; }
    const timer = setTimeout(() => { if (mode === 'starting') fallback(); }, 10000);
    const fallback = () => { clearTimeout(timer); try { worker.terminate(); } catch { /* gone */ } worker = null; setMode('inline'); };
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'ready') { clearTimeout(timer); URL.revokeObjectURL(url); setMode('worker'); return; }
      if (!current || m.id !== current.id) return;
      if (m.type === 'progress') { if (current.onProgress) current.onProgress(m.p, m.stage); }
      else if (m.type === 'done') finish(null, m.result);
      else if (m.type === 'error') finish(new Error(m.message));
    };
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (mode === 'starting') { fallback(); return; }
      // A crash (e.g. out of memory) fails the running job; a fresh worker takes the next ones.
      try { worker.terminate(); } catch { /* gone */ }
      worker = null;
      mode = 'starting';
      finish(new Error((e && e.message) || 'worker error'));
      start();
    };
  }

  // In-page fallback: same runJob, so results are identical; ticks inside runJob keep the UI responsive.
  async function runInline(c) {
    try { finish(null, await runJob(c.job, (p, s) => c.onProgress && c.onProgress(p, s))); } catch (e) { finish(e); }
  }

  function pump() {
    if (current || mode === 'starting' || !waiting.length) return;
    current = waiting.shift();
    current.id = ++seq;
    if (mode === 'worker') worker.postMessage({ type: 'job', id: current.id, job: current.job });
    else runInline(current);
  }

  if (typeof Worker === 'function') start(); else setMode('inline');

  return {
    get mode() { return mode; },
    get busy() { return !!current || waiting.length > 0; },
    /**
     * Queues a job. Lanes run in priority order draft < preview < export; a new 'draft' or 'preview' job replaces a
     * waiting one of its lane (which resolves with { superseded: true }).
     */
    run(job, { lane = 'export', onProgress } = {}) {
      return new Promise((resolve, reject) => {
        const entry = { job, lane, onProgress, resolve, reject };
        // Superseding: only the newest waiting draft/preview matters; older ones resolve as superseded instead of
        // rejecting, so callers can ignore them without error handling. Exports are never dropped.
        if (lane !== 'export') {
          const i = waiting.findIndex((w) => w.lane === lane);
          if (i >= 0) { waiting[i].resolve({ superseded: true }); waiting.splice(i, 1); }
        }
        const at = waiting.findIndex((w) => PRIORITY[w.lane] > PRIORITY[lane]);
        if (at < 0) waiting.push(entry); else waiting.splice(at, 0, entry);
        pump();
      });
    },
    /** Drops waiting jobs of a lane (they resolve with { cancelled: true }). */
    cancel(lane) {
      for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].lane === lane) { waiting[i].resolve({ cancelled: true }); waiting.splice(i, 1); }
    },
    drop(key) { if (worker && mode === 'worker') worker.postMessage({ type: 'drop', key }); else dropCached(key); },
    clear() { if (worker && mode === 'worker') worker.postMessage({ type: 'clear' }); else dropCached(null); },
  };
}
