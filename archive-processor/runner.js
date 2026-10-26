// archive-processor/runner.js - page side of the engine: starts a module Worker from a Blob (the page's own bundled
// script in the single-file build, an import of engine.js when served from sources), runs one job at a time with
// progress, soft cancel (the job stops between chunks) and hard cancel (the worker is terminated and restarted, for
// work that cannot be interrupted, such as listing a large tar.gz). Without workers the jobs run in the page.
// 
// Why a Blob worker: the single-file build has no separate worker file to point new Worker() at, and file:// pages
// cannot start workers from URLs anyway. Re-running the page's own inline module in a worker reuses the bundle; main.js
// detects the worker context and calls workerMain() instead of building UI.
// Why one job at a time: the engine keeps open archives as worker state; concurrent jobs would interleave reads on the
// same sources. A FIFO queue (waiting) serialises them.

import { cancelJob, errInfo, runJob } from './engine.js';

// Served from sources: a two-line module importing engine.js by absolute URL. Built: the largest inline module script
// (> 1000 chars: the bundle, not a small helper) is copied verbatim into the Blob.
function workerURL() {
  const here = import.meta.url;
  let src;
  if (/\/runner\.js(?:[?#].*)?$/.test(here)) src = `import { workerMain } from ${JSON.stringify(here.replace(/runner\.js(?:[?#].*)?$/, 'engine.js'))};\nworkerMain();\n`;
  else {
    const inline = Array.from(document.querySelectorAll('script[type="module"]')).find((s) => !s.src && s.textContent.length > 1000);
    if (!inline) throw new Error('no inline module');
    src = inline.textContent;
  }
  return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}

export function createRunner({ onMode } = {}) {
  let worker = null, mode = 'starting', seq = 0, current = null;
  const waiting = [];
  let readyWait = [];
  // Mode: 'starting' -> 'worker' | 'inline'. Leaving 'starting' releases ready() waiters and starts queued jobs.
  const setMode = (m) => { mode = m; if (onMode) onMode(m); if (m !== 'starting') { for (const r of readyWait) r(); readyWait = []; } pump(); };

  function finish(err, res) {
    const c = current;
    current = null;
    if (c) { if (err) c.reject(err); else c.resolve(res); }
    pump();
  }

  function start() {
    let url;
    try { url = workerURL(); worker = new Worker(url, { type: 'module' }); } catch { setMode('inline'); return; }
    // A worker that never says ready within 10 s (blocked by CSP, broken module) falls back to in-page execution rather than hanging forever.
    const timer = setTimeout(() => { if (mode === 'starting') fallback(); }, 10000);
    const fallback = () => { clearTimeout(timer); try { worker.terminate(); } catch { /* gone */ } worker = null; setMode('inline'); };
    worker.onmessage = (e) => {
      const m = e.data || {};
      // The Blob URL is revoked only after the worker loaded it; revoking earlier races the module fetch.
      if (m.type === 'ready') { clearTimeout(timer); URL.revokeObjectURL(url); setMode('worker'); return; }
      // Late messages of a cancelled or killed job carry an old id and are ignored.
      if (!current || m.id !== current.id) return;
      if (m.type === 'progress') { if (current.onProgress) current.onProgress(m.p); }
      else if (m.type === 'done') finish(null, m.result);
      else if (m.type === 'error') finish(Object.assign(new Error(m.error.message), { code: m.error.code }));
    };
    // preventDefault stops the error from also being reported as an uncaught page error.
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (mode === 'starting') { fallback(); return; }
      // A crash (e.g. out of memory) fails the running job; a fresh worker takes the next ones.
      restart();
      finish(Object.assign(new Error((e && e.message) || 'the background worker stopped'), { code: 'crash' }));
    };
  }

  function restart() {
    try { worker.terminate(); } catch { /* gone */ }
    worker = null;
    mode = 'starting';
    start();
  }

  async function runInline(c) {
    try { finish(null, await runJob({ ...c.job, jobId: c.id }, (p) => c.onProgress && c.onProgress(p))); } catch (e) { const i = errInfo(e); finish(Object.assign(new Error(i.message), { code: i.code })); }
  }

  // Starts the next queued job if idle and a mode is known; called after every state change, so no job can be stranded.
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
    get busy() { return !!current; },
    ready: () => (mode === 'starting' ? new Promise((r) => readyWait.push(r)) : Promise.resolve()),
    run(job, onProgress) {
      return new Promise((resolve, reject) => { waiting.push({ job, onProgress, resolve, reject }); pump(); });
    },
    /** Stops the running job between two chunks (it rejects with code 'aborted'). */
    cancel() {
      if (!current) return;
      if (mode === 'worker') worker.postMessage({ type: 'cancel', id: current.id }); else cancelJob(current.id);
    },
    /** Hard stop: terminates the worker (the open archive is lost) and rejects the running job. */
    // Hard cancel loses all worker state (open archives). Inline mode cannot be killed: the page thread is the one running the job, so it falls back to a soft cancel.
    kill() {
      if (!current) return;
      if (mode !== 'worker') { cancelJob(current.id); return; }
      restart();
      finish(Object.assign(new Error('cancelled'), { code: 'aborted' }));
    },
  };
}
