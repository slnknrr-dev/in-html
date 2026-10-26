// archive-processor/engine.js - background side of the archive processor: opens archives from File objects (read in
// slices with FileReaderSync inside a Worker, whole in memory as the in-page fallback), lists them, extracts selected
// entries to Blobs, to a ZIP built on the fly (zip/zip.js ZipWriter) or into a folder of the File System Access API,
// tests them and reads previews. The same runJob() serves the in-page fallback; workerMain() binds the message protocol:
//   in:  { type: 'job', id, job: { op: 'open' | 'extract' | 'test' | 'preview' | 'close'
//          | 'vopen' | 'vclose' | 'repack' | 'pack' | 'hash' | 'compare', … } } | { type: 'cancel', id }
// The commander (commander.js) keeps several archives open at once: 'vopen' opens one under a key, and 'extract',
// 'test', 'preview' and 'repack' take that key; 'pack' builds a new archive (../pack/), 'hash' computes checksums of a
// Blob or an entry, 'compare' compares two Blobs byte by byte.
//   out: { type: 'ready' } | { type: 'progress', id, p } | { type: 'done', id, result } | { type: 'error', id, error }
// 
// Design rules:
// - Cooperative cancellation: long loops check cancelled.has(id) between 1 MiB chunks and yield (tick) every ~120 ms,
//   so the 'cancel' message can be processed. Decoders that cannot yield (one huge synchronous call) need the runner's
//   hard kill instead.
// - Progress is throttled to ~8 messages/s: postMessage per chunk would flood the page with layout work.
// - Errors cross the worker boundary as plain { code, message } (errInfo): Error subclasses do not survive structured
//   cloning with their class. Password errors are fatal to a job (the page asks and re-runs); other per-entry errors
//   are collected so one damaged file does not abort a whole extraction.
// - Results with large byte arrays are transferred (zero-copy), not cloned.

import { ArchiveError, bytesSource, fileSource, openArchive } from '../archive/index.js';
import { ZipWriter } from '../zip/zip.js';
import { crc32 } from '../crypto/checksum.js';
import { md5 } from '../crypto/md5.js';
import { sha1 } from '../crypto/sha1.js';
import { sha256 } from '../crypto/sha2.js';
import { packArchive } from '../pack/index.js';

const S = { arc: null, files: null, opts: null, mounts: new Map() };
const cancelled = new Set();
// setTimeout(0) yields to the event loop so queued messages (cancel) run; a resolved promise would not, microtasks run first.
const tick = () => new Promise((r) => setTimeout(r, 0));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const errInfo = (e) => ({
  code: e instanceof ArchiveError ? e.code : e && e.name === 'AbortError' ? 'aborted' : e && e.code === 'aborted' ? 'aborted' : 'error',
  message: String((e && e.message) || e),
});

class Aborted extends Error { constructor() { super('cancelled'); this.code = 'aborted'; } }

// In a worker, FileReaderSync reads arbitrary slices synchronously, so archives of any size are never loaded whole. The page has no sync reader: files are read into memory.
async function sourcesOf(files) {
  if (typeof FileReaderSync === 'function') return files.map((f) => fileSource(f, f.name));
  // In the page (no Worker): the files are read into memory.
  return Promise.all(files.map(async (f) => bytesSource(new Uint8Array(await f.arrayBuffer()), f.name)));
}

const time = (d) => (d instanceof Date && !isNaN(d) ? d.getTime() : null);
// Plain serializable copy of the entry list: Date -> ms, undefined -> null. The archive object itself (with streams, closures) stays in the worker.
function summary(arc) {
  const entries = arc.entries.map((e) => ({
    id: e.id, path: e.path, dir: !!e.dir, kind: e.kind || (e.dir ? 'dir' : 'file'), size: e.size ?? null, packed: e.packed ?? null,
    mtime: time(e.mtime), ctime: time(e.ctime), atime: time(e.atime), method: e.method || '', encrypted: !!e.encrypted,
    crc: e.crc ?? null, link: e.link || null, unsupported: e.unsupported || null, attrib: e.attrib ?? null, mode: e.mode ?? null,
    comment: e.comment || null, solid: !!e.solid, unsafe: !!e.unsafe,
  }));
  return { format: arc.format, label: arc.label, info: arc.info || {}, stats: arc.stats, entries, password: arc.password != null };
}

async function open(job, progress) {
  S.arc = null;
  S.files = job.files;
  S.opts = { password: job.password ?? null, charset: job.charset || 'auto' };
  const sources = await sourcesOf(job.files);
  const arc = openArchive(sources, { ...S.opts, onProgress: (p) => progress({ p }) });
  S.arc = arc;
  return summary(arc);
}

// A changed password is applied to the open archive in place: re-opening a big archive just to retry a password would repeat the whole listing.
function current(job) {
  const arc = job.key != null ? S.mounts.get(job.key) : S.arc;
  if (!arc) throw new ArchiveError('format', 'no archive is open');
  if (job.password != null && job.password !== arc.password) arc.password = job.password;
  return arc;
}

async function vopen(job, progress) {
  const sources = await sourcesOf(job.files);
  const arc = openArchive(sources, { password: job.password ?? null, charset: job.charset || 'auto', onProgress: (p) => progress({ p }) });
  S.mounts.set(job.key, arc);
  return summary(arc);
}

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

// Whole decoded data of an entry (repacking).
async function entryBytes(arc, e, ctl) {
  const parts = [];
  let n = 0;
  await pump(arc.open(e), (b) => { parts.push(b.slice()); n += b.length; }, ctl);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Rewrites an open archive: entries under `remove` paths are dropped, `add` items ({ path, blob, dir, mtime, mode })
 * replace or join the rest, and the result is packed again in `format` (a ../pack/ format id).
 */
// Archives are rewritten, never patched: every kept entry is fully decoded and re-encoded into the target format. Simple
// and format-independent; the cost is O(archive size) per change, acceptable for in-browser workspace sizes.
async function repack(job, progress) {
  const arc = current(job);
  const gone = (p) => (job.remove || []).some((r) => p === r || p.startsWith(r + '/'));
  const adding = new Map((job.add || []).map((a) => [a.path, a]));
  const keep = arc.entries.filter((e) => !gone(e.path) && !adding.has(e.path));
  const ctl = { id: job.jobId, done: 0, last: 0, total: keep.reduce((n, e) => n + (e.size || 0), 0) + (job.add || []).reduce((n, a) => n + (a.blob ? a.blob.size : 0), 0), file: '', n: 0 };
  ctl.report = () => progress({ done: ctl.done, total: ctl.total, file: ctl.file, n: ctl.n, count: keep.length + adding.size });
  const items = [];
  for (const e of keep) {
    ctl.file = e.path; ctl.report();
    const mtime = e.mtime instanceof Date && !isNaN(e.mtime) ? e.mtime : undefined;
    if (e.dir) items.push({ path: e.path, dir: true, mtime, mode: e.mode ?? undefined });
    else if (e.kind === 'symlink' && e.link) items.push({ path: e.path, kind: 'symlink', link: e.link, mtime });
    else if (e.kind !== 'other') items.push({ path: e.path, data: await entryBytes(arc, e, ctl), mtime, mode: e.mode ?? undefined });
    ctl.n++;
  }
  for (const a of adding.values()) {
    ctl.file = a.path; ctl.report();
    const data = a.dir ? undefined : a.blob ? await bytesOf(a.blob) : new Uint8Array(0);
    if (data) ctl.done += data.length;
    items.push({ path: a.path, dir: !!a.dir, data, mtime: a.mtime != null ? new Date(a.mtime) : undefined, mode: a.mode ?? undefined });
    ctl.n++;
  }
  // Parents before children (sorted paths).
  // Code-unit order puts "a" before "a/b": parents precede children, which some formats (tar readers) expect.
  items.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  ctl.file = ''; ctl.report();
  await tick();
  const out = await packArchive(job.format, items, { level: job.level });
  return { blob: new Blob([out]), size: out.length };
}

async function pack(job, progress) {
  const items = [];
  let done = 0;
  const total = job.items.reduce((n, a) => n + (a.blob ? a.blob.size : 0), 0);
  for (const a of job.items) {
    if (cancelled.has(job.jobId)) throw new Aborted();
    const data = a.dir ? undefined : a.blob ? await bytesOf(a.blob) : new Uint8Array(0);
    if (data) done += data.length;
    progress({ done, total, file: a.path, n: items.length, count: job.items.length });
    items.push({ path: a.path, dir: !!a.dir, data, mtime: a.mtime != null ? new Date(a.mtime) : undefined, mode: a.mode ?? undefined });
  }
  await tick();
  const out = await packArchive(job.format, items, { level: job.level });
  return { blob: new Blob([out]), size: out.length };
}

const HASHES = { crc32, md5, sha1, sha256 };
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Checksums of a Blob (job.blob) or of an archive entry (job.key + job.entry), read in 1 MiB slices. */
async function hash(job, progress) {
  const algos = (job.algos || Object.keys(HASHES)).filter((a) => HASHES[a]);
  const hs = algos.map((a) => HASHES[a].create());
  const ctl = { id: job.jobId, done: 0, last: 0, total: 0, file: job.name || '', n: 0 };
  ctl.report = () => progress({ done: ctl.done, total: ctl.total, file: ctl.file, n: 0, count: 1 });
  const take = (b) => { for (const x of hs) x.update(b); };
  if (job.blob) {
    ctl.total = job.blob.size;
    for (let o = 0; o < job.blob.size; o += 1 << 20) {
      if (cancelled.has(ctl.id)) throw new Aborted();
      const b = await bytesOf(job.blob.slice(o, o + (1 << 20)));
      take(b);
      ctl.done += b.length;
      if (now() - ctl.last > 120) { ctl.last = now(); ctl.report(); await tick(); }
    }
  } else {
    const arc = current(job);
    const e = arc.entries.find((x) => x.id === job.entry);
    if (!e || e.dir) throw new ArchiveError('format', 'no such file');
    ctl.total = e.size || 0;
    await pump(arc.open(e), take, ctl);
  }
  const out = {};
  algos.forEach((a, i) => { out[a] = hexOf(hs[i].digest()); });
  return { sums: out, size: ctl.done };
}

/** Byte comparison of two Blobs: equal, first difference, differing bytes (the first 200 listed). */
// Size differences count as a difference at the shorter length; only the first 200 differing bytes are listed, all are counted.
async function compare(job, progress) {
  const { a, b } = job;
  const n = Math.min(a.size, b.size);
  let first = -1, count = 0, last = 0;
  const diffs = [];
  for (let o = 0; o < n; o += 1 << 20) {
    if (cancelled.has(job.jobId)) throw new Aborted();
    const x = await bytesOf(a.slice(o, o + (1 << 20))), y = await bytesOf(b.slice(o, o + (1 << 20)));
    for (let i = 0; i < x.length; i++) {
      if (x[i] === y[i]) continue;
      if (first < 0) first = o + i;
      count++;
      if (diffs.length < 200) diffs.push([o + i, x[i], y[i]]);
    }
    if (now() - last > 120) { last = now(); progress({ done: o, total: n, file: '', n: 0, count: 1 }); await tick(); }
  }
  if (first < 0 && a.size !== b.size) first = n;
  return { equal: first < 0, first, count, diffs, sizeA: a.size, sizeB: b.size };
}

// Pulls a stream to its end through `take`, reporting progress and honouring cancellation between chunks.
// stream.read(n) returns null at the end. await take(b) lets writers (FileSystemWritableFileStream) apply backpressure.
async function pump(stream, take, ctl) {
  for (;;) {
    if (cancelled.has(ctl.id)) throw new Aborted();
    const b = stream.read(1 << 20);
    if (!b) return;
    await take(b);
    ctl.done += b.length;
    if (now() - ctl.last > 120) { ctl.last = now(); ctl.report(); await tick(); }
  }
}

function plan(arc, ids) {
  const want = ids ? new Set(ids) : null;
  return arc.entries.filter((e) => !want || want.has(e.id));
}

// Windows-safe file and folder names (the File System Access API refuses some characters).
// Windows rules (FS Access API enforces them on every OS): reserved characters and controls become _, trailing dots and
// spaces are stripped, reserved device names (CON, NUL, COM1…) are prefixed, length capped below the 255 limit.
// Path traversal is impossible by construction: each segment is created as a child handle; ".." is not a path here.
function safeSegment(s) {
  let n = String(s).replace(/[<>:"|?*\u0000-\u001f\\]/g, '_').replace(/[. ]+$/, '');
  if (!n) n = '_';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = '_' + n;
  return n.slice(0, 240);
}

async function extract(job, progress) {
  const arc = current(job);
  const list = plan(arc, job.ids);
  const files = list.filter((e) => !e.dir);
  const ctl = { id: job.jobId, done: 0, last: 0, total: files.reduce((n, e) => n + (e.size || 0), 0), file: '', n: 0 };
  ctl.report = () => progress({ done: ctl.done, total: ctl.total, file: ctl.file, n: ctl.n, count: files.length });
  const errors = [], skipped = [];
  // Entries that need a password stop the job: the page asks for it and runs the job again.
  const fatal = (e) => e instanceof Aborted || (e instanceof ArchiveError && (e.code === 'password' || e.code === 'badPassword'));
  // Directory handles are cached per path (dirs map): one getDirectoryHandle per folder instead of one per file.
  if (job.mode === 'dir') {
    const root = job.dir;
    const dirs = new Map([['', root]]);
    const dirOf = async (path) => {
      if (dirs.has(path)) return dirs.get(path);
      const i = path.lastIndexOf('/');
      const parent = await dirOf(i < 0 ? '' : path.slice(0, i));
      const h = await parent.getDirectoryHandle(safeSegment(path.slice(i + 1)), { create: true });
      dirs.set(path, h);
      return h;
    };
    for (const e of list) {
      ctl.file = e.path; ctl.report();
      try {
        if (e.dir) { await dirOf(e.path); continue; }
        if (e.kind === 'symlink' || e.kind === 'other') { skipped.push({ path: e.path, kind: e.kind }); continue; }
        const i = e.path.lastIndexOf('/');
        const dir = await dirOf(i < 0 ? '' : e.path.slice(0, i));
        const stream = arc.open(e);
        const fh = await dir.getFileHandle(safeSegment(e.path.slice(i + 1)), { create: true });
        const w = await fh.createWritable();
        // b.slice(): decoders may reuse their output buffer; the writer must own a copy. On failure abort() discards the partial file.
        try { await pump(stream, (b) => w.write(b.slice()), ctl); await w.close(); } catch (err) { try { await w.abort(); } catch { /* closed */ } throw err; }
        ctl.n++;
      } catch (err) { if (fatal(err)) throw err; errors.push({ path: e.path, ...errInfo(err) }); }
    }
    ctl.report();
    return { mode: 'dir', count: ctl.n, errors, skipped };
  }
  // ZIP built as a stream: each entry is an async generator, so only one chunk of one entry is in memory at a time.
  if (job.mode === 'zip') {
    const zip = new ZipWriter({ method: job.zipMethod === 'store' ? 'store' : 'deflate' });
    for (const e of list) {
      ctl.file = e.path; ctl.report();
      const opts = { time: e.mtime instanceof Date ? e.mtime : undefined, mode: e.mode ?? undefined };
      try {
        if (e.dir) { await zip.add(e.path + '/', null, { ...opts, dir: true }); continue; }
        // Symlinks stored the Unix way in ZIP: link target as content, mode 0o120777 (S_IFLNK).
        if (e.kind === 'symlink' && e.link) { await zip.add(e.path, new TextEncoder().encode(e.link), { ...opts, mode: 0o120777, store: true }); continue; }
        if (e.kind === 'other') { skipped.push({ path: e.path, kind: e.kind }); continue; }
        const stream = arc.open(e);
        await zip.add(e.path, (async function* () {
          for (;;) {
            if (cancelled.has(ctl.id)) throw new Aborted();
            const b = stream.read(1 << 20);
            if (!b) return;
            ctl.done += b.length;
            yield b;
            if (now() - ctl.last > 120) { ctl.last = now(); ctl.report(); await tick(); }
          }
        })(), opts);
        ctl.n++;
      } catch (err) { if (fatal(err)) throw err; errors.push({ path: e.path, ...errInfo(err) }); }
    }
    const blob = await zip.finish();
    ctl.report();
    return { mode: 'zip', blob, count: ctl.n, errors, skipped };
  }
  // Separate Blobs (one file, or a few the page saves one by one).
  const out = [];
  for (const e of files) {
    ctl.file = e.path; ctl.report();
    try {
      if (e.kind === 'other') { skipped.push({ path: e.path, kind: e.kind }); continue; }
      const stream = arc.open(e);
      const parts = [];
      let pending = [], size = 0;
      // Chunks are folded into a Blob every 32 MiB: browsers can page Blobs to disk, a list of thousands of small arrays stays in the JS heap.
      await pump(stream, (b) => { pending.push(b.slice()); size += b.length; if (size > 32 << 20) { parts.push(new Blob(pending)); pending = []; size = 0; } }, ctl);
      out.push({ path: e.path, blob: new Blob([...parts, ...pending]), mtime: time(e.mtime) });
      ctl.n++;
    } catch (err) { if (fatal(err)) throw err; errors.push({ path: e.path, ...errInfo(err) }); }
  }
  ctl.report();
  return { mode: 'files', files: out, errors, skipped };
}

async function test(job, progress) {
  const arc = current(job);
  const files = plan(arc, job.ids).filter((e) => !e.dir && e.kind !== 'other');
  const ctl = { id: job.jobId, done: 0, last: 0, total: files.reduce((n, e) => n + (e.size || 0), 0), file: '', n: 0 };
  ctl.report = () => progress({ done: ctl.done, total: ctl.total, file: ctl.file, n: ctl.n, count: files.length });
  const results = [];
  const t0 = now();
  for (const e of files) {
    ctl.file = e.path; ctl.report();
    const before = ctl.done;
    try {
      if (e.unsupported) throw new ArchiveError('unsupported', 'not supported: ' + e.unsupported);
      await pump(arc.open(e), () => {}, ctl);
      results.push({ id: e.id, path: e.path, ok: true, size: ctl.done - before });
    } catch (err) {
      if (err instanceof Aborted || (err instanceof ArchiveError && (err.code === 'password' || err.code === 'badPassword'))) throw err;
      results.push({ id: e.id, path: e.path, ok: false, ...errInfo(err) });
    }
    ctl.n++;
  }
  ctl.report();
  return { results, bytes: ctl.done, ms: Math.round(now() - t0) };
}

// Reads at most max bytes (default 1 MiB): a preview never decompresses a whole multi-GB entry.
async function preview(job) {
  const arc = current(job);
  const e = arc.entries.find((x) => x.id === job.entry);
  if (!e || e.dir) throw new ArchiveError('format', 'no such file');
  const max = job.max || 1 << 20;
  const stream = arc.open(e);
  const parts = [];
  let n = 0, truncated = false;
  const ctl = { id: job.jobId };
  for (;;) {
    if (cancelled.has(ctl.id)) throw new Aborted();
    const b = stream.read(Math.min(1 << 20, max - n));
    if (!b) break;
    parts.push(b.slice());
    n += b.length;
    if (n >= max) { truncated = e.size == null || e.size > n; break; }
    await tick();
  }
  const bytes = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  return { bytes, truncated };
}

/** One job; progress(object) reports along the way. */
export async function runJob(job, progress = () => {}) {
  try {
    switch (job.op) {
      case 'open': return await open(job, progress);
      case 'extract': return await extract(job, progress);
      case 'test': return await test(job, progress);
      case 'preview': return await preview(job);
      case 'close': S.arc = null; S.files = null; return null;
      case 'vopen': return await vopen(job, progress);
      case 'vclose': S.mounts.delete(job.key); return null;
      case 'repack': return await repack(job, progress);
      case 'pack': return await pack(job, progress);
      case 'hash': return await hash(job, progress);
      case 'compare': return await compare(job, progress);
      default: throw new Error('unknown job ' + job.op);
    }
  } finally { cancelled.delete(job.jobId); }
}

export function cancelJob(id) { cancelled.add(id); }
export { errInfo };

// Only preview results carry bytes; transferring the ArrayBuffer moves it to the page without a copy.
const transfer = (res) => (res && res.bytes instanceof Uint8Array ? [res.bytes.buffer] : []);

/** Worker entry: message protocol (see the header). */
export function workerMain() {
  self.onmessage = async (ev) => {
    const m = ev.data || {};
    if (m.type === 'cancel') { cancelJob(m.id); return; }
    if (m.type !== 'job') return;
    try {
      const res = await runJob({ ...m.job, jobId: m.id }, (p) => self.postMessage({ type: 'progress', id: m.id, p }));
      self.postMessage({ type: 'done', id: m.id, result: res }, transfer(res));
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, error: errInfo(err) });
    }
  };
  self.postMessage({ type: 'ready' });
}
