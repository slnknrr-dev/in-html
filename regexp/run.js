// regexp/run.js - safe evaluation of a pattern against a text: matches with group indices, replace preview, split.
//
// evaluate(job) is synchronous and self-contained (it uses only its parameter, its locals and JavaScript built-ins),
// so createRunner() can serialize it with Function.prototype.toString into a Worker built from a Blob URL: a pattern
// that backtracks catastrophically is stopped by terminating the worker after `timeout` ms, and the page never
// freezes. Without Worker support (Node, tests) the runner calls evaluate() in place.
//
// Why the hard limit lives outside evaluate(): a single exec() call that backtracks exponentially never returns to
// JavaScript, so no in-loop clock check can interrupt it. Only Worker.terminate() can. The soft `budget` inside
// evaluate() handles the other case: millions of cheap matches.
// Constraint for editors of evaluate(): no imports, no closures over module scope, no helper functions outside it;
// toString() serializes only its own body, and anything else is undefined inside the worker.

/**
 * job: { source, flags, text, mode: 'match' | 'replace' | 'split', replacement, splitLimit, names, limit, budget }
 *   names   capture names by group number ([null, 'year', …]) for the result groups
 *   limit   maximum number of matches listed (default 5000)
 *   budget  soft time budget in ms checked between matches (default 1500)
 * → { matches: [{ index, end, text, groups: [{ n, name, start, end, text }] }], count, truncated: null | 'count' | 'time',
 *     indices: 'd' | 'search' (how group offsets were found), output?, parts?, ms } or { error }
 */
export function evaluate(job) {
  const clock = typeof performance === 'object' && performance && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();
  const t0 = clock();
  const source = String(job.source ?? ''), flags = String(job.flags ?? ''), text = String(job.text ?? '');
  const limit = job.limit > 0 ? job.limit : 5000, budget = job.budget > 0 ? job.budget : 1500;
  const names = Array.isArray(job.names) ? job.names : [];
  const unicode = flags.includes('u') || flags.includes('v');
  let re, reD = null;
  try { re = new RegExp(source, flags); } catch (e) { return { error: String((e && e.message) || e) }; }
  // The d flag gives the offsets of every group; engines without it fall back to searching group text in the match.
  if (!flags.includes('d')) { try { reD = new RegExp(source, flags + 'd'); } catch { reD = null; } } else reD = re;
  // After an empty match, step over a whole code point in Unicode mode (spec AdvanceStringIndex); stepping one unit
  // would land inside a surrogate pair and report a phantom match there.
  const advance = (s, i) => {
    if (!unicode || i + 1 >= s.length) return i + 1;
    const c = s.charCodeAt(i);
    if (c < 0xd800 || c > 0xdbff) return i + 1;
    const d = s.charCodeAt(i + 1);
    return d >= 0xdc00 && d <= 0xdfff ? i + 2 : i + 1;
  };
  const pack = (m) => {
    const groups = [];
    for (let k = 1; k < m.length; k++) {
      let start = -1, end = -1;
      const g = m[k];
      if (m.indices && m.indices[k]) { start = m.indices[k][0]; end = m.indices[k][1]; }
      // Approximation: the first occurrence of the group text inside the match. Wrong for /(a)a\1/-like repeats, but
      // only engines without the d flag (pre-2021) take this path.
      else if (g !== undefined) { const at = m[0].indexOf(g); start = m.index + Math.max(0, at); end = start + g.length; }
      groups.push({ n: k, name: names[k] || null, start, end, text: g === undefined ? null : g });
    }
    const res = { index: m.index, end: m.index + m[0].length, text: m[0], groups };
    // The named captures object of the engine (undefined without named groups) for $<name>; not posted back.
    Object.defineProperty(res, 'caps', { value: m.groups, enumerable: false });
    return res;
  };

  // Matches as the engine finds them: all with g, else the first one (sticky: only at the start).
  const run = reD || re;
  const all = run.global;
  const matches = [];
  let truncated = null, count = 0;
  run.lastIndex = 0;
  for (;;) {
    const m = run.exec(text);
    if (!m) break;
    count++;
    if (matches.length < limit) matches.push(pack(m));
    if (!all) break;
    if (m[0] === '') run.lastIndex = advance(text, run.lastIndex);
    if (matches.length >= limit) { truncated = 'count'; break; }
    // Clock every 64 matches: performance.now() is not free, and per-match calls dominate for tiny matches.
    if ((count & 63) === 0 && clock() - t0 > budget) { truncated = 'time'; break; }
  }
  const out = { matches, count, truncated, indices: reD ? 'd' : 'search' };

  if (job.mode === 'replace') {
    // GetSubstitution of the specification, applied to the same matches, so every replaced piece is known.
    const tpl = String(job.replacement ?? '');
    const sub = (m) => {
      const caps = m.groups.length;
      let r = '';
      for (let i = 0; i < tpl.length; i++) {
        const c = tpl[i];
        if (c !== '$' || i + 1 >= tpl.length) { r += c; continue; }
        const d = tpl[i + 1];
        if (d === '$') { r += '$'; i++; }
        else if (d === '&') { r += m.text; i++; }
        else if (d === '`') { r += text.slice(0, m.index); i++; }
        else if (d === '\'') { r += text.slice(Math.min(m.end, text.length)); i++; }
        else if (d >= '0' && d <= '9') {
          let digits = 1, idx = +d;
          const d2 = tpl[i + 2];
          if (d2 >= '0' && d2 <= '9') {
            digits = 2;
            idx = idx * 10 + +d2;
            if (idx > caps) { digits = 1; idx = +d; }
          }
          if (idx >= 1 && idx <= caps) { const g = m.groups[idx - 1].text; r += g == null ? '' : g; }
          else r += tpl.slice(i, i + 1 + digits);
          i += digits;
        } else if (d === '<' && m.caps) {
          const close = tpl.indexOf('>', i + 2);
          if (close < 0) { r += '$<'; i++; }
          else {
            const g = m.caps[tpl.slice(i + 2, close)];
            r += g == null ? '' : String(g);
            i = close;
          }
        } else r += '$';
      }
      return r;
    };
    const pieces = [];
    let last = 0, output = '';
    // Replacement works on every match even beyond the listing limit, so it runs its own loop when truncated.
    const list = truncated === 'count' ? null : matches;
    const each = (m) => {
      if (m.index > last) pieces.push({ text: text.slice(last, m.index), replaced: false });
      const r = sub(m);
      pieces.push({ text: r, replaced: true, from: m.index, to: m.end });
      output += text.slice(last, m.index) + r;
      last = m.end;
    };
    if (list) list.forEach(each);
    else {
      run.lastIndex = 0;
      for (;;) {
        const m = run.exec(text);
        if (!m) break;
        each(pack(m));
        if (!all) break;
        if (m[0] === '') run.lastIndex = advance(text, run.lastIndex);
        if (clock() - t0 > budget) { out.truncated = 'time'; break; }
      }
    }
    if (last < text.length) pieces.push({ text: text.slice(last), replaced: false });
    output += text.slice(last);
    out.output = output;
    out.pieces = pieces;
  } else if (job.mode === 'split') {
    // RegExp.prototype[Symbol.split] of the specification (a sticky copy), keeping track of captured parts.
    // Sticky matching at each candidate q is what the spec algorithm does; a global search would skip positions and
    // differ for patterns with lookbehind or ^ / $.
    const lim = job.splitLimit > 0 ? job.splitLimit >>> 0 : 4294967295;
    let sp;
    try { sp = new RegExp(source, flags.includes('y') ? flags : flags + 'y'); } catch (e) { return { error: String((e && e.message) || e) }; }
    const parts = [];
    const size = text.length;
    if (lim === 0) { /* nothing */ } else if (size === 0) {
      sp.lastIndex = 0;
      if (!sp.exec(text)) parts.push({ text, capture: 0 });
    } else {
      let p = 0, q = 0;
      while (q < size) {
        sp.lastIndex = q;
        const z = sp.exec(text);
        if (!z) { q = advance(text, q); continue; }
        const e = Math.min(sp.lastIndex, size);
        if (e === p) { q = advance(text, q); continue; }
        parts.push({ text: text.slice(p, q), capture: 0 });
        if (parts.length === lim) break;
        p = e;
        for (let k = 1; k < z.length; k++) {
          parts.push({ text: z[k] === undefined ? null : z[k], capture: k });
          if (parts.length === lim) break;
        }
        if (parts.length === lim) break;
        q = p;
        if (clock() - t0 > budget) { out.truncated = 'time'; break; }
      }
      if (parts.length < lim) parts.push({ text: text.slice(p), capture: 0 });
    }
    out.parts = parts;
  }
  out.ms = clock() - t0;
  return out;
}

/** Synchronous evaluation (Node, tests, pages without Worker support): no protection against runaway patterns. */
export function evaluateSync(job) { return evaluate(job); }

/**
 * A runner that evaluates jobs in a Worker with a hard time limit.
 *   createRunner({ timeout = 1000 }) → { run(job) → Promise<result>, terminate(), mode }
 * The result of a job that exceeds `timeout` is { timeout: true, ms }; the stuck worker is terminated and the next job
 * gets a fresh one. A newer job supersedes a waiting one ({ cancelled: true }) and interrupts one that already runs
 * longer than a short grace period. mode: 'worker' | 'inline' (no Worker: evaluate() runs in the page).
 */
export function createRunner({ timeout = 1000, grace = 120 } = {}) {
  const canWorker = typeof Worker === 'function' && typeof Blob === 'function' && typeof URL === 'function' && typeof URL.createObjectURL === 'function';
  let worker = null, url = null, seq = 0, busy = null, queued = null, mode = canWorker ? 'worker' : 'inline';

  // Worker from a Blob URL: works from file:// and inside a single-file build, where a separate worker .js file
  // could not be loaded. The URL is revoked on kill() to free the blob.
  function spawn() {
    const src = 'const evaluate = ' + evaluate.toString() + ';\n'
      + 'self.onmessage = function (e) { var r; try { r = evaluate(e.data.job); } catch (err) { r = { error: String((err && err.message) || err) }; } self.postMessage({ id: e.data.id, result: r }); };\n';
    try {
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch {
      worker = null;
      mode = 'inline';
      return false;
    }
    worker.onmessage = (e) => {
      const d = e.data || {};
      // Stale reply from a superseded job: ignore; ids make late messages harmless.
      if (!busy || d.id !== busy.id) return;
      const b = busy;
      busy = null;
      clearTimeout(b.timer);
      b.resolve(d.result);
      next();
    };
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const b = busy;
      busy = null;
      kill();
      if (b) { clearTimeout(b.timer); b.resolve({ error: String((e && e.message) || 'worker error') }); }
      next();
    };
    return true;
  }

  function kill() {
    if (worker) { try { worker.terminate(); } catch { /* gone */ } }
    worker = null;
    if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
    url = null;
  }

  function start(item) {
    if (!worker && !spawn()) { item.resolve(evaluate(item.job)); next(); return; }
    busy = item;
    item.began = Date.now();
    item.timer = setTimeout(() => {
      if (busy !== item) return;
      busy = null;
      kill();
      item.resolve({ timeout: true, ms: timeout });
      next();
    }, timeout);
    worker.postMessage({ id: item.id, job: item.job });
  }

  function next() {
    if (busy || !queued) return;
    const q = queued;
    queued = null;
    start(q);
  }

  // Single-slot queue: only the latest job matters while the user types, so a waiting job is cancelled rather than
  // queued behind (latest-wins), and a long-running one is killed after `grace` ms instead of after full `timeout`.
  function run(job) {
    if (mode === 'inline') return Promise.resolve().then(() => evaluate(job));
    return new Promise((resolve) => {
      const item = { id: ++seq, job, resolve, timer: 0, began: 0 };
      if (queued) queued.resolve({ cancelled: true });
      queued = item;
      // A job that runs past the grace period is probably stuck on the old pattern: restart instead of waiting.
      if (busy && Date.now() - busy.began > grace) {
        const b = busy;
        busy = null;
        clearTimeout(b.timer);
        kill();
        b.resolve({ cancelled: true });
      }
      next();
    });
  }

  return {
    run,
    terminate() { kill(); if (busy) { clearTimeout(busy.timer); busy.resolve({ cancelled: true }); busy = null; } if (queued) { queued.resolve({ cancelled: true }); queued = null; } },
    get mode() { return mode; },
  };
}
