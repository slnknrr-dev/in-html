// mediajobs/queue.js - a job queue as a pure state machine: what runs a job is passed in (runner.js makeRunner on a
// server, anything else in tests), so the same queue works in Node, Electron and browsers.
//
//   createQueue({ concurrency = 1, run, now = Date.now, maxLog = 400 }) -> queue
//     run(job, ctl) -> Promise<result>     ctl = { log(line), progress(p 0..1 | null, text?), signal (AbortSignal),
//                                                setVar(k, v), step(n, total) }
//   queue.add(spec, { id? }) -> job          starts on the next microtask when a slot is free (FIFO)
//   queue.cancel(id) -> bool                 queued: canceled at once; running: aborts ctl.signal, the job becomes
//                                            'canceled' when run settles (run must honour the signal)
//   queue.retry(id) -> job | null            a finished job (failed, canceled, interrupted, done) queued again
//   queue.remove(id) -> bool                 a running job is aborted and dropped
//   queue.clear(filter) -> count             filter: status | [statuses] | (job) => bool; default: every finished job
//   queue.list() -> [job]   queue.get(id) -> job | null   (live objects: read, do not change)
//   queue.on(listener) -> off                listener({ type, job, line?, key?, value? }); types: add, start, step,
//                                            progress, log, var, done, fail, cancel, retry, remove, restore
//   queue.snapshot() -> JSON-able [job]      queue.restore(jobs) -> [job]: queued jobs stay queued (and run),
//                                            running ones become 'interrupted'; ids already present are skipped
//   queue.setConcurrency(n), queue.concurrency
//   job: { id, kind, title, spec, status: 'queued'|'running'|'done'|'failed'|'canceled'|'interrupted', progress
//          (0..1 | null = unknown), progressText, step (1-based number of the running step, 0 before), steps, log:
//          [lines] (the last maxLog), logDropped, created, started, finished, error (message), result, vars }

// State machine: queued -> running -> done | failed | canceled; queued -> canceled; any finished -> queued (retry);
// running (at restore time) -> interrupted. The queue owns transitions; `run` only reports through ctl.
// clone: JSON round-trip for snapshots; non-JSON values (BigInt, cycles) degrade to null instead of throwing.
const FINISHED = new Set(['done', 'failed', 'canceled', 'interrupted']);
const clone = (v) => { try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch { return null; } };
const message = (e) => String((e && e.message) || e || 'failed');

// `now` is injectable so tests get deterministic timestamps and ids.
// Run tokens: each start() creates a fresh token object stored in `active`. Every ctl callback and finish() checks
// that the job's current token is still theirs, so a run that keeps calling ctl.log after being removed, or that
// resolves after a retry started a new run, cannot write into the new run's state (stale-closure protection).
export function createQueue({ concurrency = 1, run, now = Date.now, maxLog = 400 } = {}) {
  if (typeof run !== 'function') throw new Error('createQueue: run(job, ctl) is required');
  const jobs = [];
  const active = new Map(); // id -> { controller, token }
  const listeners = new Set();
  let limit = Math.max(1, Math.floor(concurrency) || 1);
  let seq = 0, scheduled = false;

  const get = (id) => jobs.find((j) => j.id === id) || null;
  // Iterate a copy: a listener may unsubscribe itself during the event. Listener exceptions are swallowed so one
  // broken UI subscriber cannot stall the queue.
  const emit = (type, job, extra = {}) => {
    for (const l of [...listeners]) { try { l({ type, job, ...extra }); } catch { /* a listener's error is its own */ } }
  };
  const newId = () => { let id; do { id = 'j' + now().toString(36) + (++seq).toString(36); } while (get(id)); return id; };

  // Ring-buffer semantics via splice: keep the last maxLog lines and count the dropped ones, so the UI can say
  // "N earlier lines omitted" instead of growing memory with a chatty ffmpeg run.
  function pushLog(job, text) {
    for (const line of String(text ?? '').split(/\r?\n/)) {
      job.log.push(line);
      emit('log', job, { line });
    }
    if (job.log.length > maxLog) { const n = job.log.length - maxLog; job.log.splice(0, n); job.logDropped += n; }
  }

  // Coalesced microtask scheduling: many add()/finish() calls in one tick produce one pump(). Starting on a
  // microtask (not synchronously inside add) lets the caller attach listeners and read the returned job first.
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => { scheduled = false; pump(); });
  }

  // FIFO by array order; recounts running jobs each time instead of keeping a counter that could drift.
  function pump() {
    let running = jobs.filter((j) => j.status === 'running').length;
    for (const job of jobs) {
      if (running >= limit) break;
      if (job.status !== 'queued') continue;
      start(job);
      running++;
    }
  }

  function start(job) {
    const controller = new AbortController();
    const token = {};
    active.set(job.id, { controller, token });
    Object.assign(job, { status: 'running', started: now(), finished: null, error: null, result: null, progress: 0, progressText: '', step: 0 });
    emit('start', job);
    const alive = () => active.get(job.id)?.token === token;
    const ctl = {
      signal: controller.signal,
      log: (line) => { if (alive()) pushLog(job, line); },
      progress: (p, text) => {
        if (!alive()) return;
        job.progress = p == null || !Number.isFinite(+p) ? null : Math.min(1, Math.max(0, +p));
        if (text != null) job.progressText = String(text);
        emit('progress', job);
      },
      setVar: (key, value) => { if (alive()) { job.vars[key] = value; emit('var', job, { key, value }); } },
      step: (n, total) => { if (alive()) { job.step = n; if (total) job.steps = total; emit('step', job); } },
    };
    let p;
    // run may throw synchronously or return a non-promise; both are normalized into one promise path.
    try { p = Promise.resolve(run(job, ctl)); } catch (e) { p = Promise.reject(e); }
    p.then((result) => finish(job, token, null, result), (err) => finish(job, token, err ?? new Error('failed')));
  }

  function finish(job, token, err, result) {
    const a = active.get(job.id);
    if (!a || a.token !== token) return; // removed (or restarted) meanwhile
    active.delete(job.id);
    job.finished = now();
    // Abort wins over the run's own outcome: a tool killed by cancel usually exits non-zero, which must read as
    // 'canceled', not 'failed'.
    if (a.controller.signal.aborted) { job.status = 'canceled'; job.error = 'canceled'; emit('cancel', job); }
    else if (err) { job.status = 'failed'; job.error = message(err); emit('fail', job); }
    else {
      job.status = 'done';
      job.result = result ?? null;
      if (result && typeof result === 'object' && result.vars && typeof result.vars === 'object') Object.assign(job.vars, result.vars);
      job.progress = 1;
      emit('done', job);
    }
    schedule();
  }

  function add(spec, { id = null } = {}) {
    if (!spec || typeof spec !== 'object') throw new Error('queue.add: a job spec is required');
    if (id != null && get(String(id))) throw new Error('queue.add: job id exists: ' + id);
    const job = {
      id: id != null ? String(id) : newId(), kind: spec.kind ?? null, title: spec.title ?? spec.kind ?? '', spec,
      status: 'queued', progress: 0, progressText: '', step: 0, steps: Array.isArray(spec.steps) ? spec.steps.length : 0,
      log: [], logDropped: 0, created: now(), started: null, finished: null, error: null, result: null, vars: {},
    };
    jobs.push(job);
    emit('add', job);
    schedule();
    return job;
  }

  function cancel(id) {
    const job = get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      Object.assign(job, { status: 'canceled', finished: now(), error: 'canceled' });
      emit('cancel', job);
      return true;
    }
    if (job.status === 'running') {
      const a = active.get(id);
      if (a && !a.controller.signal.aborted) { job.progressText = 'canceling'; a.controller.abort(); emit('progress', job); }
      return true;
    }
    return false;
  }

  function retry(id) {
    const job = get(id);
    if (!job || !FINISHED.has(job.status)) return null;
    Object.assign(job, { status: 'queued', progress: 0, progressText: '', step: 0, started: null, finished: null, error: null, result: null, vars: {} });
    pushLog(job, '--- retry ---');
    emit('retry', job);
    schedule();
    return job;
  }

  // Removing a running job deletes its active entry BEFORE aborting, so the run's eventual settlement hits the
  // token check in finish() and is ignored (no 'cancel' event for a job that no longer exists).
  function remove(id) {
    const i = jobs.findIndex((j) => j.id === id);
    if (i < 0) return false;
    const job = jobs[i];
    const a = active.get(id);
    if (a) { active.delete(id); a.controller.abort(); }
    jobs.splice(i, 1);
    emit('remove', job);
    if (a) schedule();
    return true;
  }

  function clear(filter) {
    const test = typeof filter === 'function' ? filter
      : typeof filter === 'string' ? (j) => j.status === filter
      : Array.isArray(filter) ? (j) => filter.includes(j.status)
      : (j) => FINISHED.has(j.status);
    let n = 0;
    for (const j of jobs.filter((x) => { try { return !!test(x); } catch { return false; } })) if (remove(j.id)) n++;
    return n;
  }

  function snapshot() {
    return jobs.map((j) => ({
      id: j.id, kind: j.kind, title: j.title, spec: clone(j.spec), status: j.status, progress: j.progress, progressText: j.progressText,
      step: j.step, steps: j.steps, log: [...j.log], logDropped: j.logDropped, created: j.created, started: j.started, finished: j.finished,
      error: j.error, result: clone(j.result), vars: clone(j.vars) || {},
    }));
  }

  // Restore after a restart: a job that was 'running' when the process died cannot be resumed (its child process is
  // gone), so it becomes 'interrupted' and the user may retry it. Unknown statuses also map to 'interrupted'.
  function restore(list) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || !s.spec || s.id == null || get(String(s.id))) continue;
      const status = s.status === 'running' ? 'interrupted' : ['queued', 'done', 'failed', 'canceled', 'interrupted'].includes(s.status) ? s.status : 'interrupted';
      const job = {
        id: String(s.id), kind: s.kind ?? s.spec.kind ?? null, title: s.title ?? s.spec.title ?? '', spec: s.spec, status,
        progress: status === 'queued' ? 0 : s.progress ?? 0, progressText: status === 'queued' ? '' : s.progressText ?? '', step: status === 'queued' ? 0 : s.step ?? 0,
        steps: s.steps ?? (s.spec.steps?.length || 0), log: Array.isArray(s.log) ? s.log.slice(-maxLog) : [], logDropped: s.logDropped ?? 0,
        created: s.created ?? now(), started: status === 'queued' ? null : s.started ?? null, finished: status === 'interrupted' ? s.finished ?? null : status === 'queued' ? null : s.finished ?? null,
        error: status === 'interrupted' && s.status === 'running' ? 'interrupted' : s.error ?? null, result: s.result ?? null, vars: s.vars || {},
      };
      jobs.push(job);
      out.push(job);
      emit('restore', job);
    }
    schedule();
    return out;
  }

  return {
    add, cancel, retry, remove, clear, get, snapshot, restore,
    list: () => jobs.slice(),
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setConcurrency(n) { limit = Math.max(1, Math.floor(n) || 1); schedule(); },
    get concurrency() { return limit; },
  };
}
