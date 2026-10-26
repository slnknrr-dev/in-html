// mediajobs/runner.js - runs a job spec (mediajobs/job.js) step by step with Node APIs passed in (spawn, fs, path, os),
// so a bundled backend or Electron's main process can use it without node: imports here.
//
//   runJob(spec, { spawn, fs, path, os, tools: { ffmpeg: '/abs/ffmpeg', … }, workDir, signal, log(line),
//                  progress(p 0..1 | null, text), env, cwd, onStep(n, total), onVar(key, value), cleanup = false,
//                  platform = process.platform, killGrace = 3000 })
//       -> Promise<{ outputs, vars, captures: [stdout of capture steps], workDir }>
//     - every tool is checked first: a missing one (tools[x] null) rejects with "<tool> is not available …"
//       (err.code 'ENOTOOL', err.tool)
//     - auxiliary files go into workDir (created when missing; without one, a fresh folder under os.tmpdir() that is
//       removed at the end); {work} and {var:…} are substituted in argv and file texts
//     - each step is spawned without a shell (windowsHide), stdout / stderr decoded as UTF-8 and logged line by line
//       (lines cut at 4000 characters; ffmpeg's -progress lines, yt-dlp's download lines and captured JSON are not
//       logged); yt-dlp runs with PYTHONIOENCODING=utf-8
//     - progress: ffmpeg -progress against step.duration, yt-dlp progress lines; the overall fraction is
//       (finished steps + fraction of the running one) / steps
//     - parse: 'loudnorm' (stderr), 'ffprobe', 'ytdlp-info' (infoToCatalog of the JSON), 'identify' -> vars[parse];
//       yt-dlp 'filepath=' lines are added to outputs
//     - abort (signal): the process tree is killed (Windows: taskkill /pid <pid> /T /F; elsewhere SIGTERM, then
//       SIGKILL after killGrace ms) and runJob rejects with an AbortError
//     - a non-zero exit code rejects with an Error naming the tool, the code and the last stderr lines
//       (err.exitCode, err.stderr)
//   makeRunner(deps) -> run(job, ctl) for queue.js createQueue: deps as for runJob; deps.workDir is the root of
//     per-job folders (<root>/<job id>, default <os.tmpdir()>/mediajobs) or a function (job) -> folder; deps.cleanup
//     (default true) removes the folder when the job ends

import { toolCommand } from './tools.js';
import { parseLoudnorm, parseProgress, progressFraction } from './ffmpeg.js';
import { parseProbe } from './ffprobe.js';
import { infoToCatalog, parseProgressLine } from './ytdlp.js';
import { parseIdentify } from './magick.js';
import { substitute, usesWork } from './job.js';

// Memory bounds, each for a different stream: STDERR_KEEP is a rolling tail of stderr (loudnorm prints its JSON at
// the END of a long stderr, so a tail is enough), CAPTURE_MAX caps captured stdout (yt-dlp -J of a large playlist
// is big but finite; beyond the cap the process is killed rather than exhausting the heap), TAIL lines of stderr go
// into error messages, LINE_MAX cuts pathological lines (ffmpeg can print a megabyte-long line of codec params).
// NOTE: capture length is counted in UTF-16 code units of decoded text, not bytes, despite the error message.
const STDERR_KEEP = 256 * 1024;
const CAPTURE_MAX = 256 * 1024 * 1024;
const TAIL = 12;
const LINE_MAX = 4000;

function abortError() {
  const e = new Error('canceled');
  e.name = 'AbortError';
  e.code = 'ABORT_ERR';
  return e;
}

function startError(tool, program, e) {
  const why = e && e.code === 'ENOENT' ? 'not found' : (e && (e.code || e.message)) || 'unknown error';
  const err = new Error(`could not start ${tool} (${program}): ${why}`);
  err.code = e?.code || 'ESPAWN';
  return err;
}

// Incremental line splitter for chunked streams: keeps the unfinished tail between chunks. \r alone is a line end
// too, because progress-printing tools rewrite one line with carriage returns. A tail that grows past 1 MiB without
// a newline is flushed truncated, so a binary-ish stream cannot accumulate unbounded.
function splitter(fn) {
  let rest = '';
  return {
    push(t) {
      const parts = (rest + t).split(/\r\n|\n|\r/);
      rest = parts.pop();
      for (const p of parts) fn(p.length > LINE_MAX ? p.slice(0, LINE_MAX) + '…' : p);
      if (rest.length > 1 << 20) { fn(rest.slice(0, LINE_MAX) + '…'); rest = ''; }
    },
    end() { if (rest) fn(rest.length > LINE_MAX ? rest.slice(0, LINE_MAX) + '…' : rest); rest = ''; },
  };
}

// Kills the process and its children; returns the SIGKILL timer (null when none) so the caller can clear it.
// Why a tree kill: yt-dlp spawns ffmpeg for merging, and child.kill() on Windows only terminates the direct child
// (TerminateProcess), orphaning the grandchild which keeps writing the file. taskkill /T walks the tree.
// POSIX: SIGTERM first lets ffmpeg finalize the container (a playable partial file), SIGKILL after the grace period
// for a hung process; unref() so a pending kill timer never keeps Node alive.
function killTree(child, { spawn, platform, killGrace }) {
  if (!child) return null;
  if (platform === 'win32' && child.pid) {
    try {
      const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      k?.on?.('error', () => { try { child.kill(); } catch { /* gone */ } });
      return null;
    } catch { /* fall back to kill() */ }
  }
  try { child.kill('SIGTERM'); } catch { /* gone */ }
  const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, killGrace);
  t?.unref?.();
  return t;
}

// spawn WITHOUT a shell: argv goes to the program verbatim, so file names with spaces, quotes, $ or & need no
// quoting and cannot inject commands. One TextDecoder per stream with {stream:true}: a UTF-8 character split across
// two chunks is decoded correctly (decoding chunks independently would yield U+FFFD pairs). The final decode()
// in 'close' flushes any buffered partial sequence.
// settle() is the single exit: idempotent (done flag), removes the abort listener (no leak across steps), clears
// the SIGKILL timer. 'close' (not 'exit') is awaited because it fires after stdio is drained, so no output is lost.
function runProcess({ spawn, tool, program, args, cwd, env, signal, platform, killGrace, capture, onOutChunk, onOutLine, onErrLine }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    let child;
    try { child = spawn(program, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { reject(startError(tool, program, e)); return; }
    if (!child) { reject(startError(tool, program, null)); return; }
    let done = false, aborted = false, tooBig = false, killTimer = null;
    let captured = '', capturedLen = 0, errTail = '';
    const tail = [];
    const decO = new TextDecoder('utf-8'), decE = new TextDecoder('utf-8');
    const outLines = splitter((l) => onOutLine?.(l));
    const errLines = splitter((l) => { if (l.trim()) { tail.push(l); if (tail.length > TAIL) tail.shift(); } onErrLine?.(l); });
    const kill = () => { if (!killTimer) killTimer = killTree(child, { spawn, platform, killGrace }); };
    const onOut = (t) => {
      if (!t) return;
      if (capture) {
        capturedLen += t.length;
        if (capturedLen > CAPTURE_MAX) { if (!tooBig) { tooBig = true; kill(); } } else captured += t;
      }
      onOutChunk?.(t);
      if (onOutLine) outLines.push(t);
    };
    const onErr = (t) => { if (!t) return; errTail = (errTail + t).slice(-STDERR_KEEP); errLines.push(t); };
    const text = (dec, b) => (typeof b === 'string' ? b : dec.decode(b, { stream: true }));
    const onAbort = () => { aborted = true; kill(); };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const settle = (fn) => {
      if (done) return;
      done = true;
      signal?.removeEventListener?.('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      fn();
    };
    try {
      child.stdout?.on('data', (b) => onOut(text(decO, b)));
      child.stderr?.on('data', (b) => onErr(text(decE, b)));
      child.on('error', (e) => settle(() => reject(aborted ? abortError() : startError(tool, program, e))));
      child.on('close', (code, sig) => {
        if (done) return;
        onOut(decO.decode());
        onErr(decE.decode());
        outLines.end();
        errLines.end();
        settle(() => {
          if (aborted) reject(abortError());
          else if (tooBig) reject(new Error(`${tool}: output larger than ${CAPTURE_MAX} bytes`));
          else resolve({ code, signal: sig, stdout: captured, stderr: errTail, tail });
        });
      });
    } catch (e) {
      settle(() => reject(startError(tool, program, e)));
    }
  });
}

// Human progress text helpers: m:ss / h:mm:ss and binary units (KiB/MiB/GiB, as yt-dlp reports sizes).
const clock = (s) => {
  if (s == null || !Number.isFinite(s)) return '?';
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(x).padStart(2, '0');
};
const bytes = (n) => (n == null ? '?' : n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GiB' : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + ' MiB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KiB' : n + ' B');

function parseResult(kind, r) {
  switch (kind) {
    case 'loudnorm': return parseLoudnorm(r.stderr);
    case 'ffprobe': return parseProbe(r.stdout);
    case 'ytdlp-info': try { return infoToCatalog(JSON.parse(r.stdout)); } catch { return null; }
    case 'identify': return parseIdentify(r.stdout);
    default: return undefined;
  }
}

// Preflight before any side effect: every tool must resolve, so a 3-step job never runs step 1 and then fails on a
// missing step-2 tool, leaving partial output behind.
// The temporary work folder name mixes time and randomness: concurrent jobs in one process never share it.
export async function runJob(spec, opts = {}) {
  const { spawn, fs, path, os, tools = {}, signal = null, env = null, cwd = undefined, onStep = null, onVar = null, cleanup = false, killGrace = 3000 } = opts;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const progress = typeof opts.progress === 'function' ? opts.progress : () => {};
  const platform = opts.platform ?? globalThis.process?.platform;
  if (typeof spawn !== 'function') throw new Error('runJob: spawn is required');
  const steps = Array.isArray(spec?.steps) ? spec.steps : [];
  if (!steps.length) throw new Error('runJob: the job has no steps');
  for (const s of steps) {
    if (!toolCommand(tools, s.tool)) {
      const e = new Error(`${s.tool} is not available: install it or set its path in the settings`);
      e.code = 'ENOTOOL';
      e.tool = s.tool;
      throw e;
    }
  }
  if (signal?.aborted) throw abortError();
  let workDir = opts.workDir || null;
  let ownDir = false;
  if (!workDir && usesWork(spec)) {
    if (!os || !path) throw new Error('runJob: the job needs a work folder (pass workDir, or os and path)');
    workDir = path.join(os.tmpdir(), 'mediajobs-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    ownDir = true;
  }
  if (workDir) {
    if (!fs || !path) throw new Error('runJob: fs and path are required for a work folder');
    fs.mkdirSync(workDir, { recursive: true });
  }
  const baseEnv = env || globalThis.process?.env || {};
  const vars = {};
  const captures = [];
  const outputs = [...(spec.outputs || [])];
  const n = steps.length;
  try {
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw abortError();
      const step = steps[i];
      const label = step.comment || `${step.tool} (step ${i + 1} of ${n})`;
      onStep?.(i + 1, n);
      progress(i / n, label);
      const ctx = { work: workDir, vars, join: (w, ...p) => path.join(w, ...p) };
      for (const [name, text] of Object.entries(step.files || {})) {
        // Defense against path traversal: the name is joined into workDir, so separators and '.'/'..' are refused.
        if (!/^[\w.-]+$/.test(name) || /^\.+$/.test(name)) throw new Error(`step ${i + 1}: bad auxiliary file name ${JSON.stringify(name)}`);
        fs.writeFileSync(path.join(workDir, name), substitute(text, ctx), 'utf8');
      }
      let argv;
      try { argv = (step.argv || []).map((a) => substitute(a, ctx)); } catch (e) { throw new Error(`step ${i + 1} (${step.tool}): ${e.message}`); }
      const [program, ...pre] = toolCommand(tools, step.tool);
      // The logged command line is for humans only (JSON-quoted when needed); it is never executed by a shell.
      log(`$ ${step.tool} ${argv.map((a) => (/[\s"']/.test(a) || a === '' ? JSON.stringify(a) : a)).join(' ')}`);
      const ytdlp = step.tool === 'yt-dlp';
      const ffProgress = step.progress === 'ffmpeg';
      const capture = !!step.capture || ['ffprobe', 'ytdlp-info', 'identify'].includes(step.parse);
      const state = {};
      let lastFrac = -1;
      const report = (frac, text) => progress(frac == null ? i / n : (i + frac) / n, text);
      const onYtdlp = (line) => {
        const p = parseProgressLine(line);
        if (p?.kind === 'download') {
          const f = p.percent != null ? p.percent / 100 : null;
          report(f, `${label}: ${p.percent != null ? p.percent.toFixed(1) + '%' : ''} of ${bytes(p.total)}${p.speed ? ` at ${bytes(p.speed)}/s` : ''}${p.eta != null ? `, ${clock(p.eta)} left` : ''}`);
          return true;
        }
        if (p?.kind === 'filepath' && p.file && !outputs.includes(p.file)) outputs.push(p.file);
        if (p?.kind === 'postprocess') report(null, `${label}: ${p.postprocessor} (${p.status})`);
        return false;
      };
      const r = await runProcess({
        spawn, tool: step.tool, program, args: [...pre, ...argv], cwd, signal, platform, killGrace, capture,
        // yt-dlp is Python: on Windows its stdout encoding follows the console code page (cp1252/cp866) when piped,
        // mangling non-ASCII titles and file paths. Forcing UTF-8 makes the decoder above correct.
        env: ytdlp ? { ...baseEnv, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } : baseEnv,
        onOutChunk: ffProgress ? (t) => {
          parseProgress(t, state);
          const f = progressFraction(state, step.duration);
          if (f === lastFrac && !state.done) return;
          lastFrac = f;
          report(f, `${label}: ${clock(state.outTime)}${step.duration ? ' / ' + clock(step.duration) : ''}${state.speed ? ` (${state.speed}x)` : ''}`);
        } : null,
        onOutLine: capture || ffProgress ? null : (l) => { if (ytdlp && onYtdlp(l)) return; log(l); },
        onErrLine: (l) => { if (ytdlp && onYtdlp(l)) return; log(l); },
      });
      if (r.code !== 0) {
        const how = r.code == null ? `was stopped${r.signal ? ' (' + r.signal + ')' : ''}` : `exited with code ${r.code}`;
        const e = new Error(`${step.tool} ${how} in step ${i + 1} of ${n}${r.tail.length ? ':\n' + r.tail.join('\n') : ''}`);
        e.exitCode = r.code;
        e.stderr = r.tail.join('\n');
        throw e;
      }
      if (step.capture) captures.push(r.stdout);
      if (step.parse) {
        const v = parseResult(step.parse, r);
        if (v == null) throw new Error(`step ${i + 1} (${step.tool}): no ${step.parse} result in the output`);
        vars[step.parse] = v;
        onVar?.(step.parse, v);
      }
      progress((i + 1) / n, label);
    }
  // Cleanup in finally: runs on success, failure and abort alike. Errors are swallowed (an antivirus holding a file
  // on Windows must not turn a successful job into a failure).
  } finally {
    if ((cleanup || ownDir) && workDir) { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* left behind */ } }
  }
  return { outputs, vars, captures, workDir };
}

// Adapter between queue.js and runJob: maps ctl callbacks to runJob options and gives each job a deterministic
// folder <root>/<job id>, so a restarted job (retry) reuses and then cleans the same place.
export function makeRunner(deps = {}) {
  return (job, ctl = {}) => {
    const spec = job && job.spec ? job.spec : job;
    const id = String(job?.id ?? Date.now().toString(36)).replace(/[^\w.-]/g, '_');
    let workDir = null;
    if (typeof deps.workDir === 'function') workDir = deps.workDir(job);
    else if (usesWork(spec)) {
      if (!deps.path) throw new Error('makeRunner: path is required');
      const root = deps.workDir || (deps.os ? deps.path.join(deps.os.tmpdir(), 'mediajobs') : null);
      if (!root) throw new Error('makeRunner: workDir or os is required');
      workDir = deps.path.join(root, id);
    }
    return runJob(spec, {
      ...deps, workDir, cleanup: deps.cleanup ?? true,
      signal: ctl.signal, log: ctl.log, progress: ctl.progress, onStep: ctl.step, onVar: ctl.setVar,
    });
  };
}
