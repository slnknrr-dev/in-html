// kdbx-app/kdf.js - key derivation off the main thread and without any time limit: Argon2 runs in a Worker, the two
// independent halves of AES-KDF run in two Workers at once (about twice as fast). A database tuned to take minutes takes
// minutes, with progress, elapsed time, an estimate and cancel. The Worker source is the page's own bundled module in the
// single-file build (main.js then calls kdfWorkerMain()) or a module that imports this file when served from sources;
// when no Worker can start, the derivation runs in the page, yielding to the event loop.
// 
// Why Workers: Argon2 with 1 GiB / many passes or AES-KDF with tens of millions of rounds would freeze the tab for the
// whole derivation; a Worker keeps the UI alive and can be terminated on cancel (true cancellation, not a flag).
// AES-KDF splits naturally: KeePass encrypts the two 16-byte halves of the composite key independently.
import { aesKdfFinish, aesKdfHalf, transformKey } from '../kdbx/kdbx.js';

// Distinguishes "no Worker possible" (fall back to the page) from real derivation errors (rethrown).
class WorkerUnavailable extends Error {}

function workerURL() {
  const here = import.meta.url;
  let src;
  if (/\/kdf\.js(?:[?#].*)?$/.test(here)) src = `import { kdfWorkerMain } from ${JSON.stringify(here)};\nkdfWorkerMain();\n`;
  else {
    const inline = Array.from(document.querySelectorAll('script[type="module"]')).find((s) => !s.src && s.textContent.length > 1000);
    if (!inline) throw new WorkerUnavailable('no inline module');
    src = inline.textContent;
  }
  return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}

// A started Worker (resolves on its 'ready' message).
// The Blob URL is revoked once the Worker reported ready (or failed): revoking earlier can race the module load.
function startWorker() {
  return new Promise((resolve, reject) => {
    let url, w;
    try { url = workerURL(); w = new Worker(url, { type: 'module' }); } catch (e) { reject(new WorkerUnavailable(e.message)); return; }
    const fail = (msg) => { clearTimeout(timer); try { w.terminate(); } catch { /* gone */ } URL.revokeObjectURL(url); reject(new WorkerUnavailable(msg)); };
    const timer = setTimeout(() => fail('worker did not start'), 15000);
    w.onmessage = (e) => { if (e.data && e.data.type === 'ready') { clearTimeout(timer); URL.revokeObjectURL(url); resolve(w); } };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); fail((e && e.message) || 'worker error'); };
  });
}

// One job in its own Worker: progress(fraction); resolves with the key bytes.
// One Worker per job, terminated when done or aborted: no long-lived Worker holding key material.
async function runInWorker(job, progress, signal) {
  const w = await startWorker();
  return new Promise((resolve, reject) => {
    const done = () => { if (signal) signal.removeEventListener('abort', abort); try { w.terminate(); } catch { /* gone */ } };
    const abort = () => { done(); reject(new Error('aborted')); };
    if (signal) { if (signal.aborted) { abort(); return; } signal.addEventListener('abort', abort, { once: true }); }
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progress') progress(m.p);
      else if (m.type === 'done') { done(); resolve(m.key); }
      else if (m.type === 'error') { done(); reject(new Error(m.message)); }
    };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); done(); reject(new Error((e && e.message) || 'worker error')); };
    w.postMessage(job);
  });
}

// deriveKey(composite, kdf, { onProgress({ phase, fraction }), signal }) — the run.deriveKey of kdbx/format.js.
export async function deriveKey(composite, kdf, run = {}) {
  const progress = (f) => run.onProgress && run.onProgress({ phase: 'kdf', fraction: f });
  try {
    if (kdf.type === 'aes') {
      const p = [0, 0];
      // Two Workers in parallel, progress averaged.
      // Caveat: if one half fails, Promise.all rejects but the other Worker is not terminated and runs to completion in the
      // background (wasted CPU, result discarded).
      const half = (i) => runInWorker({ type: 'aes', seed: kdf.salt.slice(), half: composite.slice(16 * i, 16 * i + 16), rounds: kdf.rounds },
        (f) => { p[i] = f; progress((p[0] + p[1]) / 2); }, run.signal);
      const [lo, hi] = await Promise.all([half(0), half(1)]);
      progress(1);
      return aesKdfFinish(lo, hi);
    }
    // Copies, so that views into the whole file are not cloned into the Worker.
    // slice() copies: a view into the whole file buffer would otherwise structured-clone the entire buffer into the Worker.
    const params = Object.fromEntries(Object.entries(kdf).map(([k, v]) => [k, v instanceof Uint8Array ? v.slice() : v]));
    return await runInWorker({ type: 'kdf', composite: composite.slice(), kdf: params }, progress, run.signal);
  } catch (e) {
    if (!(e instanceof WorkerUnavailable)) throw e;
    return transformKey(composite, kdf, run);
  }
}

export function kdfWorkerMain() {
  self.onmessage = async (e) => {
    const m = e.data || {};
    try {
      const onProgress = (f) => self.postMessage({ type: 'progress', p: f });
      const key = m.type === 'aes'
        ? await aesKdfHalf(m.seed, m.half, m.rounds, { onProgress })
        : await transformKey(m.composite, m.kdf, { onProgress: ({ fraction }) => onProgress(fraction) });
      // The derived key is transferred (moved), not copied: no second copy left in the Worker heap.
      self.postMessage({ type: 'done', key }, [key.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
  self.postMessage({ type: 'ready' });
}

// Human-readable KDF parameters of a header: { kind, text params } for the lock screen.
// Shown on the lock screen from the unencrypted header, so the user knows a slow unlock is expected.
export function kdfSummary(kdf) {
  if (!kdf) return null;
  if (kdf.type === 'aes') return { key: 'kx.kdfAes', params: { n: Number(kdf.rounds).toLocaleString() } };
  const mib = Number(kdf.memory) / 1048576;
  return {
    key: 'kx.kdfArgon',
    params: { type: kdf.type === 'argon2id' ? 'Argon2id' : 'Argon2d', mem: mib >= 1024 ? (mib / 1024).toFixed(mib % 1024 ? 1 : 0) + ' GiB' : Math.round(mib) + ' MiB', t: Number(kdf.iterations), p: Number(kdf.parallelism) },
  };
}

// "1:05", "12:30:00".
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
}
