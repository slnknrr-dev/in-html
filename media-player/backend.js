// media-player/backend.js - the server side of the media player, the same code in three places: the BACKEND artifact
// (hosting.js on a port: a home media server), the ELECTRON artifact (in-process, reached only through the app's own
// in-html:// scheme) and the development server (node media-player/server.js). Contract: hosting.js — default export
// (ctx) => ({ handle(req, res, url), close() }); it uses ctx.node.{ fs, path, os, child_process, https, http, crypto }.
//
// API below the page's base (<base>api/…; JSON unless said otherwise):
//   GET  api/info                           { app, version, mode, auth, features, desktop } (no token needed)
//   *    api/fs/…                           the file API (fileapi/handler.js): mounts, grant, list, stat, raw (Range),
//                                           thumb, watch
//   GET  api/db                             the catalogue { format, rev, nodes }
//   GET  api/db/changes?since=R&wait=S      ops after revision R (long poll up to S <= 25 s) | { reset: true }
//   POST api/db/ops                         { ops: [{ op: 'put', node } | { op: 'del', id }] } -> { rev }
//   GET|PUT|DELETE api/blobs/<id>           blob store (covers, imported files); GET supports Range; GET api/blobs lists
//   GET  api/tools  POST api/tools          detected yt-dlp / ffmpeg / ffprobe / magick; POST { configured: { bin: path } }
//   GET  api/jobs  POST api/jobs            { kind, params } (media-player/jobs.js) -> job; POST api/jobs/preview -> commands
//   POST api/jobs/<id>/cancel | retry  DELETE api/jobs/<id>  GET api/jobs/<id>/command?shell=bash|cmd
//   POST api/scan { source }  GET api/scan  index a folder source on the server (catalog/indexer.js)
//   GET  api/stream?media=<id>&mode=audio|video   play a source-level item: yt-dlp resolves a direct URL, the server
//                                           proxies it with Range (same origin, so the page's audio graph works)
//   GET  api/cover?media=<id>               the embedded picture of a media file (cached as a blob)
//   GET  api/settings  POST api/settings    server settings the owner may change: allowed origins (CORS)
// Auth: in the BACKEND artifact every call except api/info needs `Authorization: Bearer <token>` (or ?t= for media
// URLs): the owner token (env MP_TOKEN, else generated on the first start, kept in the data folder and printed to the
// log) can do everything; MP_GUEST_TOKEN (optional) can read and play. In Electron and the development server only
// the app itself reaches the backend, so requests are trusted.
// Roots: env MP_ROOTS (folders separated by the path delimiter, ';' on Windows, ':' elsewhere) and `--root <folder>`
// arguments become fixed read-only mounts; MP_WRITABLE=1 makes them writable; the owner adds more through the page.
// Downloads (yt-dlp) and converter outputs without a folder go to MP_DOWNLOADS, else <Downloads>/Media Player in
// Electron, else <data>/downloads — a writable mount named Downloads. Tools: PATH or MP_FFMPEG / MP_FFPROBE /
// MP_YTDLP / MP_MAGICK, or the paths the owner sets.

// SECURITY MODEL (fail closed)
// - The server never executes client-supplied argv: POST api/jobs carries { kind, params }, buildJob() (jobs.js)
//   rebuilds the spec, and every input / output path is resolved through a mount (files.resolve), so a client cannot
//   name an arbitrary path or binary. Paths outside mounts resolve to null and the request fails.
// - Blob ids are whitelisted by ID_RE before touching the disk: no "..", no separators, so blobPath() cannot escape.
// - Bodies are size-capped while streaming (readBody destroys the request past the limit) instead of after reading,
//   so a huge upload cannot exhaust memory.
// - Every JSON response is no-store + nosniff: catalogue data must not sit in shared caches, and a JSON body must
//   never be sniffed into HTML.
import { createFileApi } from '../fileapi/handler.js';
import { tokenAuth, openAuth, newToken } from '../fileapi/auth.js';
import { parseRange } from '../fileapi/range.js';
import { typeOf } from '../fileapi/types.js';
import { createDB } from '../catalog/db.js';
import { normNode, now, uid } from '../catalog/model.js';
import { facts } from '../catalog/facts.js';
import { scanSource, indexYtdlp, attachDownload } from '../catalog/indexer.js';
import { coverSources } from '../catalog/collections.js';
import { readMedia } from '../mediatags/read.js';
import { detectTools } from '../mediajobs/tools.js';
import { createQueue } from '../mediajobs/queue.js';
import { makeRunner } from '../mediajobs/runner.js';
import { renderJob } from '../mediajobs/shell.js';
import { sourceURL, parseSource } from '../mediajobs/ytdlp.js';
import { thumbJob } from '../mediajobs/magick.js';
import { frame as frameJob } from '../mediajobs/ffmpeg.js';
import { buildJob, JOB_KINDS } from './jobs.js';

const VERSION = 1;
const BODY_JSON = 64 * 1024 * 1024;
const BLOB_MAX = 1024 * 1024 * 1024;
// Doubles as a path-safety check (see SECURITY MODEL) and as the filter for listing blob files (skips .type / .tmp).
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const json = (res, status, v, extra = {}) => {
  const body = Buffer.from(JSON.stringify(v));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
  return true;
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJSON = async (req) => { const b = await readBody(req, BODY_JSON); try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); } };

// Reads repeated `--name value` pairs; process may be absent when hosting.js runs this in a restricted context.
function argList(name) {
  const out = [];
  const a = (globalThis.process && process.argv) || [];
  for (let i = 0; i < a.length - 1; i++) if (a[i] === '--' + name) out.push(a[i + 1]);
  return out;
}

export default function backend(ctx) {
  const { node, storage, dataDir, mode = 'backend' } = ctx;
  const { fs, path, os, child_process: cp, crypto } = node;
  const log = ctx.log || (() => {});
  const env = (globalThis.process && process.env) || {};
  const platform = (globalThis.process && process.platform) || 'linux';
  const trusted = mode === 'electron' || mode === 'dev';

  // --- auth -------------------------------------------------------------------------------------------------------------
  // Token persisted on first start so restarting the server does not log out every device; printed once to the log
  // because the operator needs it to open the page (#token=...). Trusted modes (Electron, dev) skip auth: only the
  // app's own scheme / localhost dev server can reach them.
  let owner = env.MP_TOKEN || storage.read('owner-token');
  if (!owner) { owner = newToken(24); storage.write('owner-token', owner); }
  const guest = env.MP_GUEST_TOKEN || null;
  const authorize = trusted ? openAuth() : tokenAuth({ owner, readers: guest ? [guest] : [] });
  if (!trusted) log(`media-player: owner token ${owner}  (open the page once with #token=${owner}; set MP_TOKEN to choose one)`);
  const settings = { cors: [], ...(storage.read('settings') || {}) };
  const corsOrigins = () => [...new Set([...(env.MP_CORS ? env.MP_CORS.split(',').map((s) => s.trim()).filter(Boolean) : []), ...(settings.cors || [])])];

  // --- folders: roots, downloads, work, blobs -------------------------------------------------------------------------
  const roots = [...(env.MP_ROOTS ? env.MP_ROOTS.split(path.delimiter) : []), ...argList('root')].filter(Boolean).map((p) => path.resolve(p));
  const desktop = ctx.desktop && ctx.desktop.paths ? ctx.desktop.paths : null;
  const downloads = path.resolve(env.MP_DOWNLOADS || (desktop && desktop.downloads ? path.join(desktop.downloads, 'Media Player') : path.join(dataDir, 'downloads')));
  const workRoot = path.join(dataDir, 'work');
  const blobDir = path.join(dataDir, 'blobs');
  const thumbDir = path.join(dataDir, 'thumbs');
  for (const d of [downloads, workRoot, blobDir, thumbDir]) { try { fs.mkdirSync(d, { recursive: true }); } catch { /* read-only data folder */ } }

  // --- tools and jobs ---------------------------------------------------------------------------------------------------
  let tools = { ffmpeg: null, ffprobe: null, 'yt-dlp': null, magick: null };
  let toolsReady = null;
  const configuredTools = () => ({ ffmpeg: env.MP_FFMPEG || null, ffprobe: env.MP_FFPROBE || null, 'yt-dlp': env.MP_YTDLP || null, magick: env.MP_MAGICK || null, ...(storage.read('tools') || {}) });
  const detect = () => (toolsReady = detectTools({ spawn: cp.spawn, env, platform, fs, path, configured: configuredTools(), extra: desktop && desktop.home ? [path.join(desktop.home, '.local', 'bin')] : [] })
    .then((t) => { tools = t; log('media-player tools:', Object.entries(t).map(([k, v]) => `${k} ${v ? v.version || 'found' : '-'}`).join(', ')); return t; })
    .catch(() => tools));
  detect();
  const toolPaths = () => Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, v ? v.path : null]));

  // --- catalogue -------------------------------------------------------------------------------------------------------
  const saved = storage.read('catalog');
  // Same catalogue engine as the browser (catalog/db.js): one schema, so ops from clients apply verbatim. Saving is
  // debounced (700 ms) because a scan emits thousands of ops; waiters are the long-poll requests woken on every change.
  const db = createDB({ nodes: (saved && Array.isArray(saved.nodes) ? saved.nodes : []).map(normNode).filter(Boolean), rev: saved && saved.rev || 0 });
  let saveTimer = null;
  const save = () => { saveTimer = null; try { storage.write('catalog', { format: 'in-html-media-db', schema: 1, rev: db.rev, nodes: db.all() }); } catch (e) { log('media-player: saving the catalogue failed', e.message); } };
  const waiters = new Set();
  db.on(() => {
    if (!saveTimer) saveTimer = setTimeout(save, 700);
    for (const w of [...waiters]) w();
  });

  // --- blobs -----------------------------------------------------------------------------------------------------------
  const blobPath = (id) => (ID_RE.test(id) ? path.join(blobDir, id) : null);
  const blobType = (id) => { try { return fs.readFileSync(path.join(blobDir, id + '.type'), 'utf8').trim(); } catch { return 'application/octet-stream'; } };
  // Write-to-temp then rename: rename is atomic on one filesystem, so a reader never sees a half-written blob and a
  // crash leaves only a .tmp. The content type is validated (type/subtype token chars) because it is echoed back as a
  // Content-Type header.
  const putBlob = (bytes, type, id = 'b' + uid(10)) => {
    fs.writeFileSync(path.join(blobDir, id + '.tmp'), bytes);
    fs.renameSync(path.join(blobDir, id + '.tmp'), path.join(blobDir, id));
    fs.writeFileSync(path.join(blobDir, id + '.type'), /^[\w.+-]+\/[\w.+-]+$/.test(type || '') ? type : 'application/octet-stream');
    return id;
  };
  // Content-addressed cover ids ('c' + sha1): the same embedded picture in 12 tracks of an album is stored once.
  const hashBytes = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 20);

  // --- file API ------------------------------------------------------------------------------------------------------
  // Thumbnail strategy by kind, cheapest capable tool first: ImageMagick for images, an ffmpeg frame at 20 s for video
  // (0 s is often black), the embedded tag picture for audio; without tools, small images are served as is. Any
  // failure returns null (the file API then answers 404 and the page draws a generated cover).
  const thumbMaker = async (abs, size, kind) => {
    await toolsReady;
    const tmp = path.join(workRoot, 'thumb-' + uid(8) + '.jpg');
    const runSpec = (spec) => makeRunner({ spawn: cp.spawn, fs, path, os, tools: toolPaths(), workDir: workRoot, cleanup: false, platform })({ spec, id: 'thumb' }, {});
    try {
      if (kind === 'image' && tools.magick) {
        await runSpec(thumbJob({ input: abs, output: tmp, size }));
      } else if (kind === 'video' && tools.ffmpeg) {
        await runSpec(frameJob({ input: abs, output: tmp, at: 20, width: size }));
      } else if (kind === 'audio') {
        const info = await readMedia(fileSource(abs), { name: abs, cover: true });
        return info && info.cover ? { type: info.cover.mime || 'image/jpeg', bytes: info.cover.data } : null;
      } else if (kind === 'image') {
        const st = fs.statSync(abs);
        return st.size < 8 * 1024 * 1024 ? { type: typeOf(abs), bytes: fs.readFileSync(abs) } : null;
      } else return null;
      const bytes = fs.readFileSync(tmp);
      return { type: 'image/jpeg', bytes };
    } catch { return null; } finally { try { fs.rmSync(tmp, { force: true }); } catch { /* none */ } }
  };
  // The file API reads its allowed origins when it is created: a settings change creates it again.
  const makeFiles = () => createFileApi({
    node: { fs, path }, platform, storage, authorize, watch: true, log,
    mounts: [...roots.map((p) => ({ path: p, name: path.basename(p) || p, writable: env.MP_WRITABLE === '1', fixed: true })), { path: downloads, name: 'Downloads', writable: true, fixed: true }],
    cors: { origins: corsOrigins() },
    thumbs: { dir: thumbDir, make: thumbMaker },
  });
  let files = makeFiles();
  const downloadsMount = () => files.mounts().find((m) => path.resolve(m.path || '') === downloads) || files.mounts().find((m) => m.name === 'Downloads');
  // Inverse of files.resolve: absolute path -> { mount, relative path with '/' }. The `root + path.sep` check prevents
  // /music2 from matching mount /music (a plain startsWith would).
  const mountOfAbs = (abs) => {
    const a = path.resolve(abs);
    for (const m of files.mounts()) {
      if (!m.path) continue;
      const root = path.resolve(m.path);
      if (m.kind === 'file' ? a === root : a === root || a.startsWith(root + path.sep)) return { mount: m.id, path: m.kind === 'file' ? path.basename(a) : path.relative(root, a).split(path.sep).join('/') };
    }
    return null;
  };

  // A random-access source over a file (mediatags readMedia).
  // Random-access reader for tag parsing: opens per read instead of loading the file, so a 4 GB video costs a few KB.
  function fileSource(abs) {
    const size = fs.statSync(abs).size;
    return {
      size,
      async read(offset, length) {
        const fd = fs.openSync(abs, 'r');
        try { const b = Buffer.alloc(Math.max(0, Math.min(length, size - offset))); fs.readSync(fd, b, 0, b.length, offset); return new Uint8Array(b.buffer, b.byteOffset, b.length); } finally { fs.closeSync(fd); }
      },
    };
  }

  const pathOfMedia = (m) => (m && m.loc && m.loc.kind === 'fs' ? files.resolve(m.loc.mount, m.loc.path || '') : m && m.loc && m.loc.kind === 'blob' ? blobPath(m.loc.blob) : null);

  // --- job environment (jobs.js) -------------------------------------------------------------------------------------
  // Output naming: chosen folder, else the input's folder when its mount is writable, else Downloads. Characters
  // illegal on Windows are replaced (outputs may land on NTFS shares), and " 2", " 3"... avoid overwriting.
  const outPathFn = (input, ext, suffix, outDir, nameOverride) => {
    const dir = outDir && outDir.mount ? files.resolve(outDir.mount, outDir.path || '') : input && mountOfAbs(input) && files.mounts().find((m) => m.id === mountOfAbs(input).mount && m.writable) ? path.dirname(input) : downloads;
    if (!dir) throw Object.assign(new Error('the output folder is not available'), { status: 400 });
    const base = (nameOverride || path.basename(input || 'output', path.extname(input || ''))).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'output';
    const e = ext || path.extname(input || '').slice(1) || 'out';
    let out = path.join(dir, `${base}${suffix ? ' (' + suffix + ')' : ''}.${e}`);
    for (let i = 2; fs.existsSync(out) && i < 1000; i++) out = path.join(dir, `${base}${suffix ? ' (' + suffix + ')' : ''} ${i}.${e}`);
    return out;
  };
  const jobEnv = () => ({
    media: (id) => db.get(id), work: (id) => db.get(id), facts: (w) => facts(db, w), pathOf: pathOfMedia,
    resolve: (mount, rel) => files.resolve(mount, rel), blobPath, downloads, ffmpegDir: tools.ffmpeg ? path.dirname(tools.ffmpeg.path) : null,
    outPath: outPathFn,
    outDirOf: (input, outDir, name) => {
      const parent = outDir && outDir.mount ? files.resolve(outDir.mount, outDir.path || '') : path.dirname(outPathFn(input, 'x', '', null));
      const d = path.join(parent, String(name).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'split');
      fs.mkdirSync(d, { recursive: true });
      return d;
    },
    tmpFile: (name) => path.join(workRoot, name.replace(/[^\w.-]/g, '_')),
    coverPath: (w) => {
      const chain = [w && w.cover, ...(w ? db.mediaOf(w.id).map((m) => m.cover) : []), w && w.parent && db.get(w.parent) && db.get(w.parent).cover].filter(Boolean);
      for (const c of chain) {
        if (c.blob && blobPath(c.blob) && fs.existsSync(blobPath(c.blob))) return blobPath(c.blob);
        if (c.loc && c.loc.kind === 'fs') { const p = files.resolve(c.loc.mount, c.loc.path || ''); if (p && fs.existsSync(p)) return p; }
      }
      return null;
    },
    // CUE images: several media nodes pointing at one file with segments -> split points; else the file's chapters.
    segments: (m) => {
      if (!m) return [];
      const siblings = db.all('media').filter((x) => x.loc && m.loc && x.loc.path === m.loc.path && x.loc.mount === m.loc.mount && x.segment);
      if (siblings.length > 1) return siblings.map((x) => { const w = db.get(x.work); const f = w ? facts(db, w) : {}; return { number: w && w.order, title: f.title, artist: (f.artist || [])[0], start: x.segment.start, end: x.segment.end }; }).sort((a, b) => a.start - b.start);
      return (m.chapters || []).map((c, i) => ({ number: i + 1, title: c.title, start: c.start, end: c.end }));
    },
    chapters: (book) => db.children(book.id).map((c) => { const m = db.mediaOf(c.id).find((x) => x.presence === 'file'); const p = pathOfMedia(m); return p ? { path: p, title: c.title, duration: m.duration } : null; }).filter(Boolean),
    collageInputs: (collId) => {
      const c = db.get(collId);
      if (!c) return [];
      const out = [];
      for (const id of coverSources(db, c, 4)) { const p = jobEnv().coverPath(db.get(id)); if (p) out.push(p); }
      return out;
    },
  });

  const hooks = new Map(); // job id -> { after, outputs }
  // Concurrency 2: ffmpeg is CPU-bound and already multi-threaded; more parallel jobs only thrash the disk.
  // toolsReady is awaited per job, so a job queued during startup waits for detection instead of failing.
  const queue = createQueue({
    concurrency: 2,
    run: async (job, ctl) => {
      await toolsReady;
      return makeRunner({ spawn: cp.spawn, fs, path, os, tools: toolPaths(), workDir: workRoot, platform, env })(job, ctl);
    },
  });
  queue.on((ev) => { if (ev.type === 'done') onJobDone(ev.job).catch((e) => log('media-player: job hook failed', e.message)); });

  // Post-job hooks fold results back into the catalogue in one batch (one revision, one UI refresh): attach a
  // download, take its thumbnail as a cover only when the work has none, index yt-dlp playlist info, add a version.
  async function onJobDone(job) {
    const h = hooks.get(job.id);
    if (!h) return;
    const { after, outputs } = h;
    const result = job.result || {};
    const outs = (result.outputs || []).concat(outputs.map((o) => o.path)).filter((p, i, a) => p && a.indexOf(p) === i && fs.existsSync(p));
    db.batch(() => {
      if (after.download && after.media) {
        const file = outs.find((p) => !/\.(json|jpg|webp|png|vtt|srt)$/i.test(p));
        const loc = file && mountOfAbs(file);
        if (loc) attachDownload(db, after.media, { kind: 'fs', mount: loc.mount, path: loc.path }, { filename: path.basename(file) });
        const thumb = outs.find((p) => /\.(jpg|webp|png)$/i.test(p));
        const m = db.get(after.media);
        if (thumb && m && db.get(m.work) && !db.get(m.work).cover) db.patch(m.work, { cover: { blob: putBlob(fs.readFileSync(thumb), typeOf(thumb)) } });
      }
      if (after.info && job.vars && job.vars['ytdlp-info']) {
        const src = after.info.sourceId && db.get(after.info.sourceId);
        if (src) indexYtdlp(db, src, job.vars['ytdlp-info']);
      }
      if (after.cover) {
        const pic = outs[0];
        if (pic) { const id = putBlob(fs.readFileSync(pic), 'image/jpeg'); if (db.get(after.cover)) db.patch(after.cover, { cover: { blob: id } }); }
      }
      if (after.addVersion && after.work) {
        for (const o of outputs.filter((x) => x.role === 'media')) {
          const loc = mountOfAbs(o.path);
          if (loc && fs.existsSync(o.path)) db.put({ id: uid(), type: 'media', work: after.work, presence: 'file', loc: { kind: 'fs', mount: loc.mount, path: loc.path }, name: path.basename(o.path), path: loc.path, size: fs.statSync(o.path).size, version: job.kind, created: now(), updated: now(), tags: [] });
        }
      }
    }, { label: 'job ' + job.kind });
  }

  // --- scans -------------------------------------------------------------------------------------------------------------
  const scans = new Map(); // source id -> { status, progress, report, error }
  // Server-side scan with the same indexer as the browser (catalog/indexer.js), given a Node io adapter. The walk
  // skips symlinks (loops, escaping the mount) and caps depth 40 / 400k files so a mis-chosen root (/) cannot hang it.
  // The hash reads only the first 64 KB: enough to recognise a moved file, cheap on large videos.
  async function runScan(src) {
    const st = { status: 'running', progress: null, started: now() };
    scans.set(src.id, st);
    try {
      const mount = src.loc && src.loc.mount;
      const base = (src.loc && src.loc.path) || '';
      const rootAbs = files.resolve(mount, base);
      if (!rootAbs) throw new Error('the folder of this source is not mounted here');
      const list = [];
      const walk = (abs, rel, depth) => {
        if (depth > 40 || list.length > 400000) return;
        let ents;
        try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (e.isSymbolicLink()) continue;
          const p = path.join(abs, e.name);
          const r = rel ? rel + '/' + e.name : e.name;
          if (e.isDirectory()) walk(p, r, depth + 1);
          else if (e.isFile()) { try { const s = fs.statSync(p); list.push({ path: r, size: s.size, mtime: s.mtimeMs }); } catch { /* vanished */ } }
        }
      };
      const io = {
        list: async () => { walk(rootAbs, '', 0); return list; },
        readMedia: async (p) => readMedia(fileSource(path.join(rootAbs, ...p.split('/'))), { name: p, cover: true }),
        readText: async (p) => { const a = path.join(rootAbs, ...p.split('/')); const s = fs.statSync(a); return s.size < 2 * 1024 * 1024 ? fs.readFileSync(a, 'utf8') : null; },
        loc: (p) => ({ kind: 'fs', mount, path: base ? base + '/' + p : p }),
        hash: async (p, entry) => { const a = path.join(rootAbs, ...p.split('/')); const fd = fs.openSync(a, 'r'); try { const b = Buffer.alloc(Math.min(65536, entry.size)); fs.readSync(fd, b, 0, b.length, 0); return entry.size.toString(36) + '-' + hashBytes(b); } finally { fs.closeSync(fd); } },
        saveCover: async (pic) => { const id = 'c' + hashBytes(pic.data); if (!fs.existsSync(path.join(blobDir, id))) putBlob(pic.data, pic.mime || 'image/jpeg', id); return { blob: id }; },
        concurrency: 4,
      };
      st.report = await scanSource(db, db.get(src.id), io, { onProgress: (p) => { st.progress = p; } });
      st.status = 'done';
    } catch (e) {
      st.status = 'failed';
      st.error = String(e && e.message || e);
    }
    st.finished = now();
  }

  // --- yt-dlp stream proxy ----------------------------------------------------------------------------------------------
  const resolved = new Map(); // key -> { url, headers, at }
  // yt-dlp -J resolves a direct media URL; cached 30 min because those URLs are signed and expire (typically hours),
  // while resolving costs seconds. Format strings prefer a single progressive file (audio+video, mp4) because the
  // proxy streams one URL; adaptive DASH pairs would need muxing.
  const resolveDirect = async (ref, kind) => {
    const key = kind + ':' + ref;
    const hit = resolved.get(key);
    if (hit && now() - hit.at < 30 * 60 * 1000) return hit;
    await toolsReady;
    if (!tools['yt-dlp']) throw Object.assign(new Error('yt-dlp is not available'), { status: 501 });
    const p = parseSource(ref);
    if (!p) throw Object.assign(new Error('not a source reference'), { status: 400 });
    const format = kind === 'video' ? 'b[vcodec!=none][acodec!=none][ext=mp4]/b[vcodec!=none][acodec!=none]' : 'ba[ext=m4a]/ba/b';
    const out = await new Promise((resolve, reject) => {
      const child = cp.spawn(tools['yt-dlp'].path, ['--no-warnings', '--no-playlist', '-f', format, '-J', sourceURL(p)], { windowsHide: true, env: { ...env, PYTHONIOENCODING: 'utf-8' } });
      const chunks = [];
      child.stdout.on('data', (c) => chunks.push(c));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('yt-dlp exited with ' + code))));
    });
    const info = JSON.parse(out);
    const fmt = (info.requested_formats && info.requested_formats[0]) || info;
    const r = { url: fmt.url || info.url, headers: fmt.http_headers || info.http_headers || {}, at: now(), ext: fmt.ext || info.ext };
    if (!/^https?:\/\//.test(r.url || '')) throw new Error('no direct URL');
    resolved.set(key, r);
    return r;
  };
  // Same-origin proxy: the page's WebAudio graph refuses cross-origin audio without CORS, so streaming through the
  // backend makes the EQ / visualizer work. Range is forwarded (seeking), cookies stripped (never forward a user's
  // cookies upstream), redirects followed at most 5 times, upstream errors mapped to 502, and both directions are
  // destroyed when either side closes so abandoned seeks do not leak sockets.
  function proxy(req, res, target, redirects = 0) {
    const u = new URL(target.url);
    const lib = u.protocol === 'https:' ? node.https : node.http;
    const headers = { ...target.headers };
    if (req.headers.range) headers.Range = req.headers.range;
    delete headers.Cookie; delete headers.cookie;
    const up = lib.request(u, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects < 5) { r.resume(); proxy(req, res, { ...target, url: new URL(r.headers.location, u).href }, redirects + 1); return; }
      const out = { 'Content-Type': r.headers['content-type'] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      for (const k of ['content-length', 'content-range']) if (r.headers[k]) out[k.replace(/(^|-)\w/g, (m) => m.toUpperCase())] = r.headers[k];
      res.writeHead(r.statusCode === 206 ? 206 : r.statusCode >= 400 ? 502 : 200, out);
      r.pipe(res);
      res.on('close', () => r.destroy());
    });
    up.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'upstream failed' }); else res.destroy(); });
    req.on('close', () => up.destroy());
    up.end();
  }

  // --- routing -----------------------------------------------------------------------------------------------------------
  // No Origin header = same-origin or non-browser client: allowed (auth still applies). Otherwise the origin must be
  // listed; the echoed origin needs Vary: Origin so caches do not serve one origin's headers to another. Expose-Headers
  // lets cross-origin players read Content-Range for seeking.
  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const allowed = corsOrigins();
    if (allowed.includes('*') || allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, ETag, Content-Type');
      return true;
    }
    return false;
  }

  async function api(req, res, url, rest) {
    const parts = rest.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
    const head = parts[0] || '';
    // The file API does its own CORS, preflight and auth (fileapi/handler.js), so it is dispatched before ours.
    if (head === 'fs') return files.handle(req, res, url, rest.replace(/^fs\/?/, ''));
    if (req.method === 'OPTIONS') {
      if (!cors(req, res)) { res.writeHead(403); res.end(); return true; }
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Range, Content-Type', 'Access-Control-Max-Age': '600' });
      res.end();
      return true;
    }
    const corsOk = cors(req, res);
    // api/info is public (before the auth check): the page needs it to learn whether a token is required at all.
    if (head === 'info') {
      await toolsReady;
      return json(res, 200, {
        app: 'media-player', version: VERSION, mode, auth: !trusted, desktop: mode === 'electron',
        features: { files: true, upload: true, jobs: !!(tools.ffmpeg || tools.magick || tools['yt-dlp']), ffmpeg: !!tools.ffmpeg, ffprobe: !!tools.ffprobe, ytdlp: !!tools['yt-dlp'], magick: !!tools.magick, scan: true },
      });
    }
    if (!corsOk) return json(res, 403, { error: 'origin not allowed' });
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    // Scope ladder: settings (even reading them) and tool paths are owner-only, because a tool path is an executable
    // the server will spawn; other writes need a write token, reads a guest token. op 'raw' allows ?t= in media URLs
    // (an <audio src> cannot send an Authorization header).
    const scope = head === 'settings' || head === 'tools' && write ? 'owner' : write ? 'write' : 'read';
    const ok = authorize(req, scope, url, { op: head === 'blobs' || head === 'stream' || head === 'cover' ? 'raw' : 'api' });
    if (ok !== true) return json(res, ok === 'unauthenticated' ? 401 : 403, { error: ok === 'unauthenticated' ? 'token needed' : 'not allowed' });

    if (head === 'db') {
      if (parts[1] === 'changes') {
        const since = Number(url.searchParams.get('since')) || 0;
        const wait = Math.min(25, Number(url.searchParams.get('wait')) || 0);
        // Long poll: answer immediately when there are changes, else park until a change, the timeout (<= 25 s, below common
        // proxy idle limits of 30-60 s) or the client disconnecting. Cheaper than WebSockets through hosting.js and works
        // through any HTTP proxy.
        if (since >= db.rev && wait > 0) {
          await new Promise((resolve) => {
            const done = () => { waiters.delete(done); clearTimeout(timer); resolve(); };
            const timer = setTimeout(done, wait * 1000);
            waiters.add(done);
            req.on('close', done);
          });
        }
        return json(res, 200, db.changesSince(since));
      }
      if (parts[1] === 'ops' && req.method === 'POST') {
        const body = await readJSON(req);
        const ops = (Array.isArray(body.ops) ? body.ops : []).slice(0, 20000).map((o) => (o && o.op === 'put' ? { op: 'put', node: normNode(o.node) } : o && o.op === 'del' && typeof o.id === 'string' ? { op: 'del', id: o.id } : null)).filter((o) => o && (o.op === 'del' || o.node));
        db.apply(ops, { origin: 'client' });
        return json(res, 200, { rev: db.rev, applied: ops.length });
      }
      if (!parts[1] && req.method === 'GET') return json(res, 200, { format: 'in-html-media-db', schema: 1, rev: db.rev, nodes: db.all() });
      return json(res, 405, { error: 'method not allowed' });
    }

    if (head === 'blobs') {
      const id = parts[1];
      if (!id) return json(res, 200, fs.readdirSync(blobDir).filter((n) => ID_RE.test(n)));
      const p = blobPath(id);
      if (!p) return json(res, 400, { error: 'bad id' });
      if (req.method === 'PUT') {
        const bytes = await readBody(req, BLOB_MAX);
        putBlob(bytes, url.searchParams.get('type') || req.headers['content-type'], id);
        return json(res, 200, { ok: true, id, size: bytes.length });
      }
      if (req.method === 'DELETE') { for (const f of [p, p + '.type']) { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } } return json(res, 200, { ok: true }); }
      let st;
      try { st = fs.statSync(p); } catch { return json(res, 404, { error: 'not found' }); }
      const r = parseRange(req.headers.range, st.size);
      if (r === 'unsatisfiable') { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return true; }
      const start = r ? r.start : 0, end = r ? r.end : st.size - 1;
      res.writeHead(r ? 206 : 200, { 'Content-Type': blobType(id), 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(r ? { 'Content-Range': `bytes ${start}-${end}/${st.size}` } : {}), 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; sandbox" });
      if (req.method === 'HEAD' || st.size === 0) { res.end(); return true; }
      const s = fs.createReadStream(p, { start, end });
      res.on('close', () => s.destroy());
      s.pipe(res);
      return true;
    }

    if (head === 'tools') {
      if (req.method === 'POST') {
        const body = await readJSON(req);
        const conf = {};
        for (const k of ['ffmpeg', 'ffprobe', 'yt-dlp', 'magick']) { const v = body.configured && body.configured[k]; if (typeof v === 'string' && v.length < 1000) conf[k] = v || null; }
        storage.write('tools', conf);
        await detect();
      } else await toolsReady;
      return json(res, 200, { tools, configured: configuredTools(), downloads, workRoot });
    }

    if (head === 'jobs') {
      const id = parts[1];
      if (!id && req.method === 'GET') return json(res, 200, queue.snapshot().map((j) => ({ ...j, spec: undefined, steps: j.steps, log: j.log.slice(-60) })));
      if ((id === 'preview' || !id) && req.method === 'POST') {
        const body = await readJSON(req);
        let built;
        try { built = buildJob(String(body.kind || ''), body.params || {}, jobEnv()); } catch (e) { return json(res, e.status || 400, { error: e.message }); }
        await toolsReady;
        const t = toolPaths();
        const commands = { bash: renderJob(built.spec, 'bash', { tools: t }).text, cmd: renderJob(built.spec, 'cmd', { tools: t }).text };
        if (id === 'preview') return json(res, 200, { spec: built.spec, commands, missing: missingTools(built.spec) });
        const missing = missingTools(built.spec);
        if (missing.length) return json(res, 501, { error: 'not installed: ' + missing.join(', '), missing, commands });
        const job = queue.add(built.spec);
        hooks.set(job.id, { after: built.after, outputs: built.outputs });
        return json(res, 200, { id: job.id, title: job.title, commands });
      }
      const job = id && queue.get(id);
      if (!job) return json(res, 404, { error: 'no such job' });
      if (parts[2] === 'cancel' && req.method === 'POST') return json(res, 200, { ok: queue.cancel(id) });
      if (parts[2] === 'retry' && req.method === 'POST') return json(res, 200, { ok: !!queue.retry(id) });
      if (parts[2] === 'command') {
        const shell = url.searchParams.get('shell') === 'cmd' ? 'cmd' : 'bash';
        return json(res, 200, { text: renderJob(job.spec, shell, { tools: toolPaths() }).text });
      }
      if (req.method === 'DELETE') { hooks.delete(id); return json(res, 200, { ok: queue.remove(id) }); }
      if (req.method === 'GET') return json(res, 200, { ...job, spec: undefined });
      return json(res, 405, { error: 'method not allowed' });
    }

    if (head === 'scan') {
      if (req.method === 'POST') {
        const body = await readJSON(req);
        const src = db.get(String(body.source || ''));
        if (!src || src.type !== 'source') return json(res, 404, { error: 'no such source' });
        if (scans.get(src.id) && scans.get(src.id).status === 'running') return json(res, 409, { error: 'already scanning' });
        runScan(src);
        return json(res, 200, { ok: true });
      }
      return json(res, 200, Object.fromEntries(scans));
    }

    if (head === 'stream') {
      const m = db.get(url.searchParams.get('media') || '');
      const ref = m && m.source && (m.source.url || m.source.ref);
      if (!ref) return json(res, 404, { error: 'no source' });
      let target;
      try { target = await resolveDirect(ref, url.searchParams.get('mode') === 'video' ? 'video' : 'audio'); } catch (e) { return json(res, e.status || 502, { error: e.message }); }
      proxy(req, res, target);
      return true;
    }

    if (head === 'cover') {
      const m = db.get(url.searchParams.get('media') || '');
      const abs = pathOfMedia(m);
      if (!abs) return json(res, 404, { error: 'no file' });
      try {
        const info = await readMedia(fileSource(abs), { name: abs, cover: true });
        if (!info.cover) return json(res, 404, { error: 'no embedded picture' });
        const cid = 'c' + hashBytes(info.cover.data);
        if (!fs.existsSync(path.join(blobDir, cid))) putBlob(info.cover.data, info.cover.mime || 'image/jpeg', cid);
        return json(res, 200, { blob: cid });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }

    // The file API captures its CORS list when created (see makeFiles), so changing origins rebuilds it.
    if (head === 'settings') {
      if (req.method === 'POST') {
        const body = await readJSON(req);
        if (Array.isArray(body.cors)) settings.cors = body.cors.filter((o) => typeof o === 'string' && (o === 'null' || o === '*' || /^https?:\/\/[^\s/]+$/.test(o))).slice(0, 40);
        storage.write('settings', settings);
        try { files.close(); } catch { /* closed */ }
        files = makeFiles();
      }
      return json(res, 200, { cors: settings.cors, envCors: env.MP_CORS || '' });
    }
    return json(res, 404, { error: 'not found' });
  }

  function missingTools(spec) {
    const need = new Set((spec.steps || []).map((s) => s.tool));
    return [...need].filter((t) => !tools[t]);
  }

  return {
    db, queue, get files() { return files; },
    async handle(req, res, url) {
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { return false; }
      const m = /^(.*?\/)api\/(.*)$/.exec(url.pathname);
      if (!m || !p) return false;
      try { return await api(req, res, url, m[2]); } catch (e) {
        if (!res.headersSent) return json(res, e.status || 500, { error: e.message || 'failed' });
        res.destroy();
        return true;
      }
    },
    async close() {
      if (saveTimer) { clearTimeout(saveTimer); save(); }
      try { files.close(); } catch { /* closed */ }
      for (const j of queue.list()) if (j.status === 'running' || j.status === 'queued') queue.cancel(j.id);
    },
  };
}

export { JOB_KINDS };
