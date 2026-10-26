// embroidery-studio/backend.js - the server of the scheme site (BACKEND artifact, and the development server
// `node embroidery-studio/server.js`): a catalogue of approved schemes, uploads from readers into a moderation queue,
// moderation with a token, view / download counters, and readers' stitching progress kept under a reader key (a
// secret the reader's browser makes; the same key on another device continues the same progress).
// Contract: default export (ctx) => ({ handle(req, res, url) }), ctx = { storage: { read, write, list, remove }, log }.
//
// API below the page (<base>api/…, JSON):
//   GET  api/info                               { app: 'embroidery-studio', version, moderation: true }
//   GET  api/schemes                            { items: [meta] }      approved schemes, newest first
//   GET  api/schemes/<id>                       the scheme (stitch/model JSON)
//   POST api/schemes/<id>/hit  { kind }         'view' | 'download' counters
//   POST api/uploads  { scheme, thumb, contact } -> { id, status: 'pending' }   (8 MB, 30 uploads an hour per address)
//   GET  api/moderation                         { pending: [meta], approved: [meta] }       Authorization: Bearer <token>
//   GET  api/moderation/<id>                    the scheme with its record                   (token)
//   POST api/moderation/<id>  { action: 'approve' | 'reject' | 'delete' | 'update', meta }  (token)
//   GET / PUT api/progress/<reader>/<key>       a reader's progress of one scheme (2 MB)
// Storage keys: 'token', 'scheme:<id>' { id, status, meta, json, thumb, contact, created, updated, views, downloads },
// 'progress:<reader>:<key>'. The token: env ES_TOKEN, else generated on the first start and printed to the log.

//
// Trust model: uploads are anonymous and untrusted. Every scheme is re-normalised server-side (normScheme clamps and
// rebuilds the structure) and stored as the server's own JSON serialisation, never the client's text; metadata is
// recomputed from the normalised scheme (metaOf), so a client cannot lie about size or colour count. Nothing is
// public until a moderator approves it. Moderation uses one shared bearer token (no user accounts): adequate for a
// single-owner site, compared in constant time.
import { normScheme, toJSON } from '../stitch/model.js';
import { stats } from '../stitch/estimate.js';

// Strict id / reader / key patterns: these values become storage keys, so anything outside the alphabet (path
// separators, colons beyond the expected one) is rejected before touching storage.
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const READER_RE = /^[a-z0-9]{12,40}$/;
const KEY_RE = /^[a-z]{2,5}:[A-Za-z0-9_.-]{1,80}$/;

// Content-Length from the encoded bytes (not string length: non-ASCII titles are multi-byte). nosniff stops
// browsers from guessing a different type for the JSON.
const send = (res, status, v) => {
  const body = new TextEncoder().encode(JSON.stringify(v));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
  return true;
};

// Size limit enforced while streaming; the socket is destroyed on overflow instead of buffering an unbounded body.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } resolve(out); });
    req.on('error', reject);
  });
}
async function readJSON(req, limit) {
  const b = await readBody(req, limit);
  return JSON.parse(new TextDecoder().decode(b));
}

const sameToken = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const bearer = (req) => { const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || ''); return m ? m[1].trim() : ''; };
// 32-symbol alphabet without look-alikes (no l, o, 0, 1): `x & 31` maps each random byte uniformly (256 is a
// multiple of 32, so there is no modulo bias).
const randomId = (n = 10) => { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return Array.from(b, (x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x & 31]).join(''); };
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
// Thumbnails accepted only as PNG data URLs of bounded size: they are shown in <img> on other people's screens, so
// no other scheme (javascript:, http: tracking pixels, SVG) gets through.
const THUMB_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]{20,400000}$/;

// Catalogue metadata of a stored record.
function meta(r) {
  const m = r.meta || {};
  return {
    id: r.id, title: m.title, designer: m.designer, category: m.category, tags: m.tags, difficulty: m.difficulty, width: m.width, height: m.height,
    colors: m.colors, stitches: m.stitches, brand: m.brand, description: m.description, license: m.license, created: r.created, updated: r.updated,
    views: r.views || 0, downloads: r.downloads || 0, thumb: r.thumb || null, status: r.status,
  };
}
function metaOf(s) {
  const S = stats(s);
  return {
    title: s.meta.title || 'Untitled', designer: s.meta.designer, category: s.meta.category || 'other', tags: s.meta.tags, difficulty: s.meta.difficulty || S.difficulty,
    width: s.width, height: s.height, colors: s.palette.length, stitches: Math.round(S.stitches), brand: s.palette[0] ? s.palette[0].brand : '',
    description: s.meta.description.slice(0, 4000), license: s.meta.license,
  };
}

// The moderation token is printed to the server log at start: the operator reads it there; it never travels in a
// page. ES_TOKEN overrides it for reproducible deployments.
export default function backend(ctx) {
  const { storage, log } = ctx;
  let token = (globalThis.process && process.env && process.env.ES_TOKEN) || storage.read('token');
  if (!token) { token = randomId(24); storage.write('token', token); }
  log(`embroidery-studio: moderation token ${token} (set ES_TOKEN to choose one)`);
  const uploads = new Map(); // address -> [times]
  const records = () => storage.list('scheme:').map((k) => storage.read(k)).filter(Boolean);
  const authed = (req) => sameToken(bearer(req), token);

  async function api(req, res, parts) {
    const [a, b, c] = parts;
    const m = req.method;
    if (a === 'info' && m === 'GET') return send(res, 200, { app: 'embroidery-studio', version: 1, moderation: true });
    // Only approved records are visible here; a pending or rejected id answers 404, indistinguishable from "absent".
    if (a === 'schemes') {
      if (!b && m === 'GET') return send(res, 200, { items: records().filter((r) => r.status === 'approved').map(meta).sort((x, y) => String(y.updated).localeCompare(String(x.updated))) });
      if (!ID_RE.test(b || '')) return send(res, 400, { error: 'bad id' });
      const r = storage.read('scheme:' + b);
      if (!r || r.status !== 'approved') return send(res, 404, { error: 'not found' });
      if (!c && m === 'GET') {
        const body = new TextEncoder().encode(r.json);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(body);
        return true;
      }
      // View / download counters are unauthenticated and not rate limited: they are popularity hints, not data
      // anyone relies on. Anyone can inflate them; acceptable for this purpose.
      if (c === 'hit' && m === 'POST') {
        let kind = 'view';
        try { kind = (await readJSON(req, 1024)).kind; } catch { /* default */ }
        if (kind === 'download') r.downloads = (r.downloads || 0) + 1; else r.views = (r.views || 0) + 1;
        storage.write('scheme:' + b, r);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'method not allowed' });
    }
    // 30 uploads per hour per remote address (in memory, reset on restart). Behind a reverse proxy all clients share
    // the proxy's address, so the limit then applies to everyone together.
    if (a === 'uploads' && m === 'POST') {
      const ip = req.socket && req.socket.remoteAddress || '?';
      const now = Date.now();
      const list = (uploads.get(ip) || []).filter((x) => now - x < 3600e3);
      if (list.length >= 30) return send(res, 429, { error: 'too many uploads, try later' });
      let body;
      try { body = await readJSON(req, 8 * 1024 * 1024); } catch (e) { return send(res, e.status || 400, { error: e.status ? 'too large' : 'bad JSON' }); }
      if (!body || typeof body.scheme !== 'object') return send(res, 400, { error: 'no scheme' });
      const s = normScheme(body.scheme);
      // Cap at one million cells: bigger charts are impractical to stitch and would make every catalogue read heavy.
      if (s.width * s.height > 1000 * 1000) return send(res, 413, { error: 'chart too large' });
      const id = randomId(10);
      s.id = id;
      const iso = new Date().toISOString();
      storage.write('scheme:' + id, { id, status: 'pending', meta: metaOf(s), json: toJSON(s), thumb: typeof body.thumb === 'string' && THUMB_RE.test(body.thumb) ? body.thumb : null, contact: str(body.contact, 200), created: iso, updated: iso, views: 0, downloads: 0 });
      list.push(now);
      uploads.set(ip, list);
      log('upload', id, s.meta.title);
      return send(res, 200, { id, status: 'pending' });
    }
    if (a === 'moderation') {
      if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
      if (!b && m === 'GET') {
        const all = records().sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
        return send(res, 200, { pending: all.filter((r) => r.status === 'pending').map((r) => ({ ...meta(r), contact: r.contact })), approved: all.filter((r) => r.status === 'approved').map(meta), rejected: all.filter((r) => r.status === 'rejected').map(meta) });
      }
      if (!ID_RE.test(b || '')) return send(res, 400, { error: 'bad id' });
      const r = storage.read('scheme:' + b);
      if (!r) return send(res, 404, { error: 'not found' });
      if (m === 'GET') return send(res, 200, { record: { ...meta(r), contact: r.contact }, scheme: JSON.parse(r.json) });
      if (m === 'POST') {
        let body;
        try { body = await readJSON(req, 64 * 1024); } catch { return send(res, 400, { error: 'bad JSON' }); }
        const act = body && body.action;
        if (act === 'delete') { storage.remove('scheme:' + b); log('deleted', b); return send(res, 200, { ok: true }); }
        if (act === 'approve' || act === 'reject') r.status = act === 'approve' ? 'approved' : 'rejected';
        else if (act !== 'update') return send(res, 400, { error: 'bad action' });
        // Moderator metadata edits are applied to the scheme itself and re-serialised, so the downloadable file and
        // the catalogue entry always agree. Lengths are capped like uploads.
        if (body.meta && typeof body.meta === 'object') {
          const s = normScheme(JSON.parse(r.json));
          for (const k of ['title', 'designer', 'category', 'description', 'license']) if (typeof body.meta[k] === 'string') s.meta[k] = body.meta[k].slice(0, k === 'description' ? 4000 : 200);
          if (Array.isArray(body.meta.tags)) s.meta.tags = body.meta.tags.map((x) => str(x, 40)).filter(Boolean).slice(0, 30);
          if (Number.isInteger(body.meta.difficulty)) s.meta.difficulty = Math.max(0, Math.min(5, body.meta.difficulty));
          r.json = toJSON(s);
          r.meta = metaOf(s);
        }
        r.updated = new Date().toISOString();
        storage.write('scheme:' + b, r);
        log('moderation', act, b);
        return send(res, 200, { ok: true, status: r.status });
      }
      return send(res, 405, { error: 'method not allowed' });
    }
    // Reader progress: no account; the reader id is a random secret generated in the browser and acts as a bearer
    // credential (whoever knows it can read and write that progress). Every field is coerced and capped before
    // storing: 2 MB body, bounded arrays, numbers forced with + and |0.
    if (a === 'progress') {
      if (!READER_RE.test(b || '') || !KEY_RE.test(c || '')) return send(res, 400, { error: 'bad key' });
      const k = 'progress:' + b + ':' + c;
      if (m === 'GET') { const p = storage.read(k); return p ? send(res, 200, p) : send(res, 404, { error: 'not found' }); }
      if (m === 'PUT') {
        let body;
        try { body = await readJSON(req, 2 * 1024 * 1024); } catch (e) { return send(res, e.status || 400, { error: 'bad JSON' }); }
        if (!body || typeof body !== 'object' || typeof body.done !== 'string') return send(res, 400, { error: 'bad progress' });
        const p = {
          key: c, w: +body.w || 0, h: +body.h || 0, done: body.done.slice(0, 2e6), parts: Array.isArray(body.parts) ? body.parts.slice(0, 100000).map(String) : [],
          parked: Array.isArray(body.parked) ? body.parked.slice(0, 5000).filter((x) => Array.isArray(x) && x.length === 2).map(([i, p]) => [+i | 0, +p | 0]) : [],
          started: str(body.started, 40), updated: str(body.updated, 40) || new Date().toISOString(), log: body.log && typeof body.log === 'object' ? Object.fromEntries(Object.entries(body.log).slice(-800).map(([d, n]) => [String(d).slice(0, 10), +n || 0])) : {},
          total: +body.total || 0, doneCount: +body.doneCount || 0,
        };
        storage.write(k, p);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'method not allowed' });
    }
    return send(res, 404, { error: 'not found' });
  }

  return {
    // The API lives under "<base>api/" at any mount depth (the page may be served from a sub-path); a malformed
    // percent-encoding is not ours to answer (false = let the host handle the request).
    async handle(req, res, url) {
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { return false; }
      const m = /^(.*?\/)api\/(.*)$/.exec(p);
      if (!m) return false;
      try { return await api(req, res, m[2].split('/').filter(Boolean)); } catch (e) { log('error', e && e.message); return send(res, 500, { error: 'server error' }); }
    },
  };
}
