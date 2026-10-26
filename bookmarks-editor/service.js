// bookmarks-editor/service.js - the hosted bookmark service (Node >= 18, no node: imports: it works on the req / res
// objects it is given, Web Crypto, and the Node modules the hosting context passes in for outgoing fetches).
//
//   createBookmarkService({ storage, log, node, env, now }) -> { handle(req, res, url) -> Promise<boolean>, close() }
//     storage   { read(key), write(key, value), list(prefix), remove?(key) }  JSON per key, atomic writes (hosting.js)
//     env       BOOKMARKS_FETCH_META=1|0, BOOKMARKS_CORS="null,https://a.example", BOOKMARKS_PUBLIC=1|0,
//               BOOKMARKS_TRUST_PROXY=1, BOOKMARKS_FETCH_ALLOW="127.0.0.1:8080" (tests only), BOOKMARKS_PBKDF2_ITERATIONS
//
// Accounts: the first visit sets up the owner; more users join with invite links the owner makes. Passwords are
// PBKDF2-SHA-256 hashes (310 000 iterations, random salt). Sessions are random tokens stored as SHA-256 hashes: an
// HttpOnly SameSite=Lax cookie for pages of this origin, or a bearer token (Authorization: Bearer …) for other
// clients (the standalone page, scripts). A cookie only counts on requests from this origin (Origin / Sec-Fetch-Site),
// so cross-origin callers always need a token; CORS answers only the configured origins and never allows credentials.
// Logins are rate limited per address and per user name; every response carries security headers.
//
// JSON API under /api (errors: { error: code, message }):
//   GET  info | session            service description, setup state, features / the signed-in user
//   POST setup {name, password, token?, label?}       the owner account (only while there is none)
//   POST login {name, password, token?, label?}       -> cookie, or { token } with token: true (or cross-origin)
//   POST logout | register {invite, name, password, token?}
//   GET  sync?since=N | POST sync {since, changes}    -> { rev, changes, now, rejected, reset }
//   GET  meta?url=…                                    page title, description, canonical URL, favicon (when enabled)
//   POST password {old, new}   GET/POST tokens {label}   DELETE tokens/<id>
//   owner: GET users, DELETE users/<name>, GET/POST invites {days}, DELETE invites/<id>, GET/PUT config
// Pages: GET /u/<name> (public bookmarks, ?tag=, ?page=), GET /u/<name>/feed (Atom), GET /add?url&title&selection
// (the bookmarklet window; POST /add saves, POST /add/login signs in).

//
// Storage model: whole JSON documents per key (accounts, sessions, config, lib.<uid>), held in memory and written
// through on change. Fine for a personal / family server (thousands of bookmarks, a handful of users); the cost is
// that every write serialises the full document. Not designed for concurrent server processes on one data folder.
// Secrets at rest: passwords as PBKDF2 hashes, session and invite tokens as SHA-256 hashes. A stolen data folder
// yields no usable session; only the CSRF HMAC secret is stored raw (it signs nothing a thief could not do anyway
// with the folder).
import { syncLog } from '../bookmarks/sync.js';
import { cleanTag, cloneRecord, isDeleted, maxStamp, newRecord, setFields, valueOf } from '../bookmarks/record.js';
import { createClock, newId } from '../bookmarks/clock.js';
import { cleanURL, isLinkable, parseUserURL, urlKey } from '../bookmarks/url.js';
import { tagURI, toAtom } from '../bookmarks/atom.js';
import { createFetcher } from './fetcher.js';
import { cspFor, pickLang, renderAdd, renderLogin, renderMessage, renderPublic, tr } from './pages.js';

const enc = new TextEncoder();
const COOKIE = 'bm_session';
// Lower-case ASCII names: they appear in URLs (/u/<name>) and must compare by simple string equality (no Unicode
// confusables, no case folding questions).
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
// CSP for the application pages served next to the API. 'unsafe-inline' for scripts and styles because the
// single-file builds inline everything; connect-src 'self' still prevents exfiltration by fetch to other hosts.
const APP_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const randomToken = (n = 32) => b64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));
async function sha256hex(s) { return Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(String(s)))).toString('hex'); }
async function pbkdf2(password, salt, iterations) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
async function hmac(secret, data) {
  const key = await globalThis.crypto.subtle.importKey('raw', Buffer.from(secret, 'base64'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(String(data)))));
}
// Constant-time comparison: the loop always runs to the end, so response time does not reveal how many leading
// bytes of a hash or CSRF token matched. The length check leaks only the length, which is public (fixed-size hashes).
const sameBytes = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const sameText = (a, b) => sameBytes(enc.encode(String(a)), enc.encode(String(b)));

class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}

// Body cap enforced while streaming; after the limit the rest is drained (resume) so the socket can answer 413
// instead of hanging with a full receive buffer.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) { failed = true; reject(new HttpError(413, 'too_large', 'request too large')); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => { if (!failed) reject(e); });
  });
}

// Requiring Content-Type application/json is also a CSRF defence: an HTML form cannot send that type, and a
// cross-origin fetch with it needs a CORS preflight, which this server answers only for listed origins.
async function readJSON(req, limit) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'json_required', 'send application/json');
  const text = await readBody(req, limit);
  if (!text) return {};
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : {}; } catch { throw new HttpError(400, 'invalid', 'invalid JSON'); }
}

async function readForm(req, limit = 256 * 1024) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'form_required', 'send a form');
  return Object.fromEntries(new URLSearchParams(await readBody(req, limit)));
}

// Minimal cookie parser: split at the first '=', values left raw (tokens are base64url, never quoted or encoded).
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const flag = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(String(v)));
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

// iterations: floor of 100 000 even if the environment asks for less (tests may lower it for speed, never to 0).
export function createBookmarkService({ storage, log = () => {}, node = null, env = (globalThis.process && globalThis.process.env) || {}, now = () => Date.now() } = {}) {
  if (!storage) throw new Error('the bookmark service needs a storage');
  const remove = (key) => (storage.remove ? storage.remove(key) : storage.write(key, null));
  const iterations = Math.max(100000, Number(env.BOOKMARKS_PBKDF2_ITERATIONS) || 310000);
  const trustProxy = flag(env.BOOKMARKS_TRUST_PROXY, false);

  // --- state -----------------------------------------------------------------------------------------------------------
  const accounts = storage.read('accounts') || { version: 1, users: {}, invites: {}, secret: '' };
  // Per-server random secret for CSRF tokens, created on first start and persisted.
  if (!accounts.secret) { accounts.secret = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString('base64'); storage.write('accounts', accounts); }
  const sessions = storage.read('sessions') || {};
  const saved = storage.read('config') || {};
  // Environment variables override the saved config and lock the setting (shown read-only in the owner UI):
  // the operator's deployment config beats clicks in the web UI. CORS default ['null'] = pages opened from disk
  // (Origin: null) may call the API with a token; nothing else cross-origin.
  const cfg = {
    fetchMeta: flag(env.BOOKMARKS_FETCH_META, !!saved.fetchMeta),
    cors: env.BOOKMARKS_CORS !== undefined ? list(env.BOOKMARKS_CORS) : Array.isArray(saved.cors) ? saved.cors : ['null'],
    publicPages: flag(env.BOOKMARKS_PUBLIC, saved.publicPages !== false),
    fetchAllow: env.BOOKMARKS_FETCH_ALLOW !== undefined ? list(env.BOOKMARKS_FETCH_ALLOW) : Array.isArray(saved.fetchAllow) ? saved.fetchAllow : [],
  };
  const locked = { fetchMeta: env.BOOKMARKS_FETCH_META !== undefined, cors: env.BOOKMARKS_CORS !== undefined, publicPages: env.BOOKMARKS_PUBLIC !== undefined };
  const saveAccounts = () => storage.write('accounts', accounts);
  const saveSessions = () => storage.write('sessions', sessions);
  const saveConfig = () => storage.write('config', { fetchMeta: cfg.fetchMeta, cors: cfg.cors, publicPages: cfg.publicPages, fetchAllow: saved.fetchAllow || [] });
  let fetcher = null;
  const getFetcher = () => {
    if (!node) throw new HttpError(501, 'meta_unavailable', 'this server cannot fetch pages');
    if (!fetcher) fetcher = createFetcher({ node, allow: cfg.fetchAllow, now });
    return fetcher;
  };

  // Per-user revision logs loaded lazily on first access and kept in memory.
  const libs = new Map();
  const libOf = (uid) => {
    let l = libs.get(uid);
    if (!l) { l = syncLog(storage.read('lib.' + uid)); libs.set(uid, l); }
    return l;
  };
  const saveLib = (uid) => storage.write('lib.' + uid, libOf(uid).toJSON());
  const userByName = (name) => Object.values(accounts.users).find((u) => u.name === String(name || '').toLowerCase()) || null;
  const hasOwner = () => Object.values(accounts.users).some((u) => u.role === 'owner');
  const serverClock = createClock('srv' + newId(5));

  // --- requests ------------------------------------------------------------------------------------------------------
  // X-Forwarded-* are trusted only when the operator says a proxy is in front (BOOKMARKS_TRUST_PROXY); otherwise
  // any client could spoof its address and dodge the per-IP rate limits.
  const ipOf = (req) => {
    if (trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || '?';
  };
  const hostOfReq = (req) => String((trustProxy && req.headers['x-forwarded-host']) || req.headers.host || 'localhost').split(',')[0].trim();
  const protoOf = (req) => (trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : req.socket && req.socket.encrypted ? 'https' : 'http');
  const baseOf = (req) => `${protoOf(req)}://${hostOfReq(req)}`;
  // A request counts as same-origin when its Origin host matches our Host and Sec-Fetch-Site (if sent) says
  // same-origin or none (typed URL / bookmark). Missing headers (old browsers, curl) are allowed: such clients are
  // not browsers carrying a victim's cookie in a cross-site attack.
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (origin) { try { if (new URL(origin).host !== hostOfReq(req)) return false; } catch { return false; } }
    const site = req.headers['sec-fetch-site'];
    return !site || site === 'same-origin' || site === 'none';
  };

  // Rate limits: { key -> [times] } over a window.
  // Sliding-window rate limiter: per key an array of timestamps; expired ones are dropped on access. Memory is
  // reclaimed by the periodic cleanup below.
  const hits = new Map();
  function count(key, windowMs) {
    const t = now();
    let a = hits.get(key);
    if (!a) hits.set(key, (a = []));
    while (a.length && t - a[0] > windowMs) a.shift();
    return a;
  }
  function limitCheck(key, max, windowMs) {
    const a = count(key, windowMs);
    if (a.length >= max) throw new HttpError(429, 'rate', 'too many attempts', { retry: Math.ceil((windowMs - (now() - a[0])) / 1000) });
  }
  const failure = (key, windowMs) => count(key, windowMs).push(now());
  const LOGIN_WINDOW = 15 * 60000;
  // Two limits: per address (10 failures / 15 min) stops spraying many names from one host; per user name
  // (20 / 15 min) stops a distributed guess against one account. Only failures count (loginFailed).
  function loginGate(req, name) {
    limitCheck('ip:' + ipOf(req), 10, LOGIN_WINDOW);
    if (name) limitCheck('user:' + name, 20, LOGIN_WINDOW);
  }
  function loginFailed(req, name) { failure('ip:' + ipOf(req), LOGIN_WINDOW); if (name) failure('user:' + name, LOGIN_WINDOW); }
  // Every 10 minutes: drop idle rate-limit keys, expired sessions and invites. unref(): the timer must not keep the
  // Node process alive on shutdown.
  const cleanup = setInterval(() => {
    const t = now();
    for (const [k, a] of hits) if (!a.length || t - a[a.length - 1] > LOGIN_WINDOW) hits.delete(k);
    let changed = false;
    for (const [k, s] of Object.entries(sessions)) if (s.expires && s.expires < t) { delete sessions[k]; changed = true; }
    for (const [k, inv] of Object.entries(accounts.invites)) if (inv.expires < t) { delete accounts.invites[k]; saveAccounts(); }
    if (changed) saveSessions();
  }, 10 * 60000);
  if (cleanup.unref) cleanup.unref();

  // --- sessions ----------------------------------------------------------------------------------------------------------
  // The token is returned once and only its SHA-256 is stored. A fast hash is enough here (unlike passwords): the
  // token has 256 random bits, so brute force is infeasible regardless of hash speed. Cookie sessions expire after
  // 30 days of inactivity; API tokens never expire (until revoked).
  async function newSession(user, kind, label) {
    const token = randomToken();
    const key = await sha256hex(token);
    sessions[key] = { user: user.id, kind, label: String(label || '').slice(0, 80), created: now(), used: now(), expires: kind === 'cookie' ? now() + 30 * 864e5 : 0 };
    saveSessions();
    return { token, key };
  }
  // Bearer token first (scripts, standalone page). The cookie counts only for same-origin requests, or for a
  // top-level GET navigation when the caller allows it (the bookmarklet popup is opened from another site, so its
  // first request is cross-site; it is a GET that only renders a form, protected by the CSRF token on POST).
  // The session kind must match how the token arrived: a cookie token replayed as Bearer is refused.
  async function sessionOf(req, { navigation = false } = {}) {
    let token = null, kind = null;
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/i.exec(String(req.headers.authorization || ''));
    if (m) { token = m[1]; kind = 'api'; }
    else {
      const c = cookies(req)[COOKIE];
      const nav = navigation && req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate';
      if (c && /^[A-Za-z0-9_-]{20,200}$/.test(c) && (sameOrigin(req) || nav)) { token = c; kind = 'cookie'; }
    }
    if (!token) return null;
    const key = await sha256hex(token);
    const s = sessions[key];
    if (!s || s.kind !== kind || (s.expires && s.expires < now())) return null;
    const user = accounts.users[s.user];
    if (!user) return null;
    // Sliding expiry, but the sessions file is rewritten at most once an hour per session, not on every request.
    if (now() - (s.used || 0) > 3600000) {
      s.used = now();
      if (s.kind === 'cookie') s.expires = now() + 30 * 864e5;
      saveSessions();
    }
    return { user, session: s, key };
  }
  async function needUser(req) {
    const s = await sessionOf(req);
    if (!s) throw new HttpError(401, 'auth', 'sign in first');
    return s;
  }
  // HttpOnly: unreachable from page scripts (XSS cannot steal it). SameSite=Lax: not sent on cross-site POSTs.
  // Secure only over https (or behind a trusted https proxy), otherwise local http testing would lose the cookie.
  const cookieHeader = (req, token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${protoOf(req) === 'https' ? '; Secure' : ''}`;

  async function checkPassword(user, password) {
    const p = user.pwd;
    const h = await pbkdf2(password, Buffer.from(p.salt, 'base64'), p.iter);
    return sameBytes(h, Buffer.from(p.hash, 'base64'));
  }
  async function passwordRecord(password) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(password, salt, iterations);
    return { salt: Buffer.from(salt).toString('base64'), hash: Buffer.from(hash).toString('base64'), iter: iterations };
  }
  function validName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!NAME_RE.test(n)) throw new HttpError(400, 'bad_name', 'user names: 1-32 characters a-z, 0-9, _ . -');
    return n;
  }
  // Upper bound 1024: PBKDF2 cost grows with input in some implementations; a megabyte password would be a cheap
  // DoS on the hashing path.
  function validPassword(p) {
    const s = String(p || '');
    if (s.length < 8 || s.length > 1024) throw new HttpError(400, 'bad_password', 'passwords need 8 to 1024 characters');
    return s;
  }
  const userInfo = (u) => ({ name: u.name, role: u.role, created: u.created });

  // A signed-in answer: a cookie for same-origin callers, a bearer token when asked (or cross-origin).
  // Cross-origin callers can never use the cookie (sessionOf ignores it cross-origin), so they always get a token.
  async function signIn(req, res, user, body, status = 200) {
    const wantToken = body.token === true || !sameOrigin(req);
    const { token } = await newSession(user, wantToken ? 'api' : 'cookie', wantToken ? body.label || 'API token' : req.headers['user-agent']);
    const out = { user: userInfo(user), ...(wantToken ? { token } : {}) };
    sendJSON(res, status, out, wantToken ? {} : { 'Set-Cookie': cookieHeader(req, token, 30 * 86400) });
  }

  // --- responses -----------------------------------------------------------------------------------------------------------
  function sendJSON(res, status, value, headers = {}) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers });
    res.end(body);
  }
  async function sendHTML(res, status, html, kind = 'page', headers = {}) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': await cspFor(kind),
      'Content-Length': Buffer.byteLength(html), ...headers,
    });
    res.end(html);
  }
  // Reflect the Origin only when listed; never Access-Control-Allow-Credentials, so browsers do not attach cookies
  // to cross-origin calls at all. Vary: Origin keeps shared caches from serving one origin's answer to another.
  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin) return {};
    // Pages opened from disk send "null" (Chrome started with --allow-file-access-from-files sends "file://").
    const listed = origin === 'file://' ? cfg.cors.includes('null') : cfg.cors.includes(origin);
    const ok = cfg.cors.includes('*') || listed || sameOrigin(req);
    if (!ok) return {};
    return {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600',
    };
  }

  // --- sync helpers -------------------------------------------------------------------------------------------------------------
  // Edits the server makes itself (bookmarklet, metadata) get stamps newer than every stamp of the record.
  // The server clock observes the record's newest stamp first, so its own edit is guaranteed to win last-writer-wins
  // against what it just read, even if the client clocks run ahead of the server.
  function serverEdit(uid, id, type, fields) {
    const lg = libOf(uid);
    const cur = lg.get(id);
    const rec = cur ? cloneRecord(cur) : newRecord(type, id);
    serverClock.observe(maxStamp(rec));
    setFields(rec, fields, serverClock.next());
    lg.put(rec);
    saveLib(uid);
    return valueOf(rec);
  }
  const liveValues = (uid, type) => libOf(uid).records().filter((r) => r.type === type && !isDeleted(r)).map(valueOf);

  // Folder tree for the bookmarklet <select>. Defensive against corrupt data from clients: a parent that does not
  // exist or points to itself is treated as root, and `seen` stops cycles (A->B->A) from recursing forever.
  function folderList(uid) {
    const folders = liveValues(uid, 'folder');
    const byId = new Map(folders.map((f) => [f.id, f]));
    const kids = new Map();
    for (const f of folders) {
      const p = byId.has(f.parent) && f.parent !== f.id ? f.parent : '';
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(f);
    }
    const out = [], seen = new Set();
    const walk = (p, depth) => {
      for (const f of (kids.get(p) || []).sort((a, b) => a.name.localeCompare(b.name))) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        out.push({ id: f.id, name: f.name, depth });
        walk(f.id, depth + 1);
      }
    };
    walk('', 0);
    return out;
  }
  function tagList(items) {
    const m = new Map();
    for (const b of items) for (const t of b.tags) { const k = t.toLowerCase(); const e = m.get(k); if (e) e.count++; else m.set(k, { tag: t, count: 1 }); }
    return [...m.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  // --- API ------------------------------------------------------------------------------------------------------------------------
  // Global per-IP cap of 900 API requests per minute protects the server from a runaway client loop.
  async function api(req, res, url) {
    const cors = corsHeaders(req);
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') { res.writeHead(cors['Access-Control-Allow-Origin'] ? 204 : 403); res.end(); return; }
    const ip = ipOf(req);
    const a = count('api:' + ip, 60000);
    if (a.length >= 900) throw new HttpError(429, 'rate', 'too many requests', { retry: 60 });
    a.push(now());
    const p = url.pathname.replace(/^\/api/, '') || '/';
    const M = req.method;

    if (M === 'GET' && p === '/info') {
      sendJSON(res, 200, { service: 'in-html bookmarks', version: 1, setup: !hasOwner(), features: { meta: cfg.fetchMeta && !!node, public: cfg.publicPages }, now: now() });
      return;
    }
    if (M === 'GET' && p === '/session') {
      const s = await sessionOf(req);
      sendJSON(res, 200, { user: s ? userInfo(s.user) : null, kind: s ? s.session.kind : null, setup: !hasOwner(), features: { meta: cfg.fetchMeta && !!node, public: cfg.publicPages }, now: now() });
      return;
    }
    // hasOwner() checked twice: before and after the slow password hash. Two concurrent setup requests could both
    // pass the first check while hashing; the second check (no await in between it and the write) closes the race.
    if (M === 'POST' && p === '/setup') {
      const body = await readJSON(req, 64 * 1024);
      loginGate(req, '');
      if (hasOwner()) throw new HttpError(409, 'setup_done', 'this server already has an owner');
      const name = validName(body.name), pwd = validPassword(body.password);
      failure('ip:' + ip, LOGIN_WINDOW); // setup and registration cost a hash too
      const record = await passwordRecord(pwd);
      if (hasOwner()) throw new HttpError(409, 'setup_done', 'this server already has an owner');
      const user = { id: newId(10), name, role: 'owner', created: now(), pwd: record };
      accounts.users[user.id] = user;
      saveAccounts();
      log('owner account created:', name);
      await signIn(req, res, user, body, 201);
      return;
    }
    if (M === 'POST' && p === '/login') {
      const body = await readJSON(req, 64 * 1024);
      const name = String(body.name || '').trim().toLowerCase();
      loginGate(req, name);
      const user = userByName(name);
      // Unknown users cost a hash as well, so timing does not tell which names exist.
      // The dummy PBKDF2 for unknown names keeps both paths equally slow (user enumeration via timing).
      const ok = user ? await checkPassword(user, String(body.password || '')) : (await pbkdf2(String(body.password || ''), new Uint8Array(16), iterations), false);
      if (!ok) { loginFailed(req, name); throw new HttpError(401, 'wrong_login', 'wrong user name or password'); }
      // A successful login clears that name's failure counter, so the owner is not locked out by earlier typos.
      count('user:' + name, LOGIN_WINDOW).length = 0;
      await signIn(req, res, user, body);
      return;
    }
    if (M === 'POST' && p === '/logout') {
      const s = await sessionOf(req);
      if (s) { delete sessions[s.key]; saveSessions(); }
      sendJSON(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
      return;
    }
    // Invites are single-use: looked up by hash, re-validated after the slow hash (same race as setup), then deleted.
    if (M === 'POST' && p === '/register') {
      const body = await readJSON(req, 64 * 1024);
      loginGate(req, '');
      const name = validName(body.name), pwd = validPassword(body.password);
      const invKey = await sha256hex(String(body.invite || ''));
      const valid = () => { const inv = accounts.invites[invKey]; return inv && inv.expires > now() ? inv : null; };
      if (!valid()) { loginFailed(req, ''); throw new HttpError(403, 'bad_invite', 'this invitation is not valid'); }
      if (userByName(name)) throw new HttpError(409, 'name_taken', 'this name is taken');
      failure('ip:' + ip, LOGIN_WINDOW);
      const record = await passwordRecord(pwd);
      if (!valid()) throw new HttpError(403, 'bad_invite', 'this invitation is not valid');
      if (userByName(name)) throw new HttpError(409, 'name_taken', 'this name is taken');
      delete accounts.invites[invKey];
      const user = { id: newId(10), name, role: 'user', created: now(), pwd: record };
      accounts.users[user.id] = user;
      saveAccounts();
      log('account created by invitation:', name);
      await signIn(req, res, user, body, 201);
      return;
    }

    // Everything below needs a signed-in user.
    const s = await needUser(req);
    const user = s.user;
    // Push then pull in one round trip. lg.apply validates and merges records (bookmarks/sync.js); invalid ones come
    // back in `rejected` instead of failing the batch. `reset`: a client whose `since` is ahead of the server (data
    // folder restored from backup) gets everything again from revision 0.
    if (p === '/sync' && (M === 'GET' || M === 'POST')) {
      const body = M === 'POST' ? await readJSON(req, 16 * 1024 * 1024) : {};
      const lg = libOf(user.id);
      let rejected = [];
      if (Array.isArray(body.changes) && body.changes.length) {
        if (body.changes.length > 20000) throw new HttpError(413, 'too_large', 'send at most 20000 records at a time');
        // Coarse quota: counts updates to existing records too, so a full library may refuse an edit batch near the cap.
        if (lg.size + body.changes.length > 300000) throw new HttpError(413, 'too_many', 'this library is full');
        const r = lg.apply(body.changes, { now: now() });
        rejected = r.rejected;
        if (r.changed.length) saveLib(user.id);
      }
      let since = Number(M === 'POST' ? body.since : url.searchParams.get('since')) || 0;
      const reset = since > lg.rev;
      if (reset) since = 0;
      const out = lg.since(since);
      sendJSON(res, 200, { rev: out.rev, changes: out.records, now: now(), rejected, reset });
      return;
    }
    // Outgoing fetch on behalf of a user: off unless the operator enabled it, 60 per user per minute, http(s) only,
    // and the fetcher itself refuses private addresses (fetcher.js). Blocked targets answer 403, other failures 502.
    if (M === 'GET' && p === '/meta') {
      if (!cfg.fetchMeta) throw new HttpError(403, 'meta_disabled', 'page metadata is turned off on this server');
      const f = getFetcher();
      const lim = count('meta:' + user.id, 60000);
      if (lim.length >= 60) throw new HttpError(429, 'rate', 'too many requests', { retry: 60 });
      lim.push(now());
      const target = parseUserURL(url.searchParams.get('url') || '');
      if (!target || !/^https?:/i.test(target)) throw new HttpError(400, 'bad_url', 'not a web address');
      let meta;
      try { meta = await f.page(target); } catch (e) { throw new HttpError(e.code === 'blocked' || e.code === 'scheme' || e.code === 'credentials' ? 403 : 502, e.code === 'blocked' ? 'blocked_address' : 'fetch_failed', e.message, { reason: e.code }); }
      const icon = url.searchParams.get('icon') === '0' ? '' : await f.icon(meta.url, meta.icons).catch(() => '');
      sendJSON(res, 200, { url: meta.url, canonical: meta.canonical, title: meta.title, description: meta.description, siteName: meta.siteName, lang: meta.lang, icon });
      return;
    }
    // Changing the password signs out every other session of the user (a leaked session dies with the old password).
    if (M === 'POST' && p === '/password') {
      const body = await readJSON(req, 64 * 1024);
      loginGate(req, user.name);
      const pwd = validPassword(body.new);
      if (!(await checkPassword(user, String(body.old || '')))) { loginFailed(req, user.name); throw new HttpError(403, 'wrong_password', 'the current password is wrong'); }
      user.pwd = await passwordRecord(pwd);
      saveAccounts();
      for (const [k, x] of Object.entries(sessions)) if (x.user === user.id && k !== s.key) delete sessions[k];
      saveSessions();
      sendJSON(res, 200, { ok: true });
      return;
    }
    // Token ids are the first 16 hex chars of the stored hash: enough to address one, useless to authenticate.
    if (p === '/tokens' && M === 'GET') {
      sendJSON(res, 200, Object.entries(sessions).filter(([, x]) => x.user === user.id)
        .map(([k, x]) => ({ id: k.slice(0, 16), kind: x.kind, label: x.label, created: x.created, used: x.used, current: k === s.key }))
        .sort((a, b) => b.used - a.used));
      return;
    }
    if (p === '/tokens' && M === 'POST') {
      const body = await readJSON(req, 64 * 1024);
      const { token, key } = await newSession(user, 'api', body.label || 'API token');
      sendJSON(res, 201, { id: key.slice(0, 16), token });
      return;
    }
    let m;
    if ((m = /^\/tokens\/([0-9a-f]{16})$/.exec(p)) && M === 'DELETE') {
      const k = Object.keys(sessions).find((x) => x.startsWith(m[1]) && sessions[x].user === user.id);
      if (!k) throw new HttpError(404, 'not_found', 'no such token');
      delete sessions[k];
      saveSessions();
      sendJSON(res, 200, { ok: true }, k === s.key && s.session.kind === 'cookie' ? { 'Set-Cookie': cookieHeader(req, '', 0) } : {});
      return;
    }

    // Owner only.
    if (user.role !== 'owner') throw new HttpError(403, 'forbidden', 'only the owner can do this');
    if (p === '/users' && M === 'GET') {
      sendJSON(res, 200, Object.values(accounts.users).map((u) => ({ ...userInfo(u), bookmarks: liveValues(u.id, 'bookmark').length, me: u.id === user.id }))
        .sort((a, b) => a.created - b.created));
      return;
    }
    if ((m = /^\/users\/([a-z0-9_.-]{1,32})$/.exec(p)) && M === 'DELETE') {
      const u = userByName(m[1]);
      if (!u) throw new HttpError(404, 'not_found', 'no such user');
      if (u.id === user.id) throw new HttpError(400, 'self', 'the owner account stays');
      delete accounts.users[u.id];
      saveAccounts();
      for (const [k, x] of Object.entries(sessions)) if (x.user === u.id) delete sessions[k];
      saveSessions();
      libs.delete(u.id);
      remove('lib.' + u.id);
      log('account deleted:', u.name);
      sendJSON(res, 200, { ok: true });
      return;
    }
    if (p === '/invites' && M === 'GET') {
      sendJSON(res, 200, Object.entries(accounts.invites).filter(([, x]) => x.expires > now())
        .map(([k, x]) => ({ id: k.slice(0, 16), created: x.created, expires: x.expires })).sort((a, b) => b.created - a.created));
      return;
    }
    if (p === '/invites' && M === 'POST') {
      const body = await readJSON(req, 64 * 1024);
      const days = Math.min(30, Math.max(1, Math.floor(Number(body.days) || 7)));
      const token = randomToken(18);
      const key = await sha256hex(token);
      accounts.invites[key] = { created: now(), expires: now() + days * 864e5, by: user.id };
      saveAccounts();
      sendJSON(res, 201, { id: key.slice(0, 16), token, expires: accounts.invites[key].expires });
      return;
    }
    if ((m = /^\/invites\/([0-9a-f]{16})$/.exec(p)) && M === 'DELETE') {
      const k = Object.keys(accounts.invites).find((x) => x.startsWith(m[1]));
      if (!k) throw new HttpError(404, 'not_found', 'no such invitation');
      delete accounts.invites[k];
      saveAccounts();
      sendJSON(res, 200, { ok: true });
      return;
    }
    if (p === '/config' && M === 'GET') {
      sendJSON(res, 200, { fetchMeta: cfg.fetchMeta, cors: cfg.cors, publicPages: cfg.publicPages, canFetch: !!node, locked });
      return;
    }
    // CORS entries must be exact origins (scheme://host[:port], no path) or the special values null / *; anything
    // else is refused so a typo cannot silently open or break access.
    if (p === '/config' && M === 'PUT') {
      const body = await readJSON(req, 64 * 1024);
      if (typeof body.fetchMeta === 'boolean' && !locked.fetchMeta) cfg.fetchMeta = body.fetchMeta;
      if (typeof body.publicPages === 'boolean' && !locked.publicPages) cfg.publicPages = body.publicPages;
      if (Array.isArray(body.cors) && !locked.cors) {
        const origins = body.cors.map((o) => String(o).trim()).filter(Boolean).slice(0, 50);
        for (const o of origins) {
          if (o === 'null' || o === '*') continue;
          let u = null;
          try { u = new URL(o); } catch { /* invalid */ }
          if (!u || !/^https?:$/.test(u.protocol) || u.origin !== o) throw new HttpError(400, 'bad_origin', `not an origin: ${o}`);
        }
        cfg.cors = origins;
      }
      saveConfig();
      sendJSON(res, 200, { fetchMeta: cfg.fetchMeta, cors: cfg.cors, publicPages: cfg.publicPages, canFetch: !!node, locked });
      return;
    }
    throw new HttpError(404, 'not_found', 'not found');
  }

  // --- public pages -----------------------------------------------------------------------------------------------------------------
  // Public pages and the Atom feed show only bookmarks flagged public. The feed allows any origin
  // (Access-Control-Allow-Origin: *) because it is public data and web feed readers fetch it cross-origin.
  async function publicPage(req, res, url, name, feed) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', 'method not allowed');
    const lang = pickLang(req.headers['accept-language'], url.searchParams.get('lang'));
    const user = userByName(name);
    if (!cfg.publicPages || !user) {
      await sendHTML(res, 404, renderMessage({ lang, title: tr(lang, 'err.title'), text: tr(lang, cfg.publicPages ? 'err.text' : 'err.off') }));
      return;
    }
    const tag = String(url.searchParams.get('tag') || '').slice(0, 100);
    let items = liveValues(user.id, 'bookmark').filter((b) => b.public).sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : 1));
    const tags = tagList(items).slice(0, 60);
    if (tag) items = items.filter((b) => b.tags.some((x) => x.toLowerCase() === tag.toLowerCase()));
    const base = `${baseOf(req)}/u/${user.name}`;
    if (feed) {
      const entries = items.slice(0, 50).map((b) => ({
        // tag: URIs (RFC 4151) give entries permanent ids independent of the bookmark URL, as Atom requires.
        id: tagURI(hostOfReq(req), user.created, `bookmarks/${user.name}/${b.id}`), title: b.title || b.url, link: isLinkable(b.url) ? b.url : base,
        summary: b.notes, published: b.created, updated: b.modified || b.created, categories: b.tags,
      }));
      const xml = toAtom({
        id: tagURI(hostOfReq(req), user.created, `bookmarks/${user.name}${tag ? '/tag/' + tag : ''}`), title: tr(lang, 'pub.title', { name: user.name }) + (tag ? ` · ${tag}` : ''),
        link: base + (tag ? '?tag=' + encodeURIComponent(tag) : ''), self: `${base}/feed${tag ? '?tag=' + encodeURIComponent(tag) : ''}`, author: user.name,
        updated: entries.reduce((x, e) => Math.max(x, e.updated || 0), 0) || user.created, entries,
      });
      res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(xml), 'Access-Control-Allow-Origin': '*' });
      res.end(req.method === 'HEAD' ? undefined : xml);
      return;
    }
    const per = 50;
    const pages = Math.max(1, Math.ceil(items.length / per));
    // Clamp the page number from the query: garbage, negatives and too-large pages all land on a valid page.
    const page = Math.min(pages, Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1)));
    const html = renderPublic({ lang, user: user.name, items: items.slice((page - 1) * per, page * per), tags, tag, page, pages, total: items.length, feed: `${base}/feed${tag ? '?tag=' + encodeURIComponent(tag) : ''}`, base });
    await sendHTML(res, 200, html);
  }

  // --- bookmarklet window -------------------------------------------------------------------------------------------------------------
  // Length caps on every field that comes from the bookmarklet query string.
  const formOf = (q) => ({
    url: String(q.url || '').slice(0, 8192), title: String(q.title || '').slice(0, 2000), selection: String(q.selection || '').slice(0, 4000),
  });
  async function addPage(req, res, url) {
    const lang = pickLang(req.headers['accept-language'], url.searchParams.get('lang'));
    if (url.pathname === '/add/login') {
      if (req.method !== 'POST') throw new HttpError(405, 'method', 'method not allowed');
      const q = await readForm(req);
      const form = formOf(q);
      const l = pickLang(req.headers['accept-language'], q.lang);
      const name = String(q.name || '').trim().toLowerCase();
      // Login form POST must come from our own page (login CSRF would sign the victim into the attacker's account).
      if (!sameOrigin(req)) throw new HttpError(403, 'forbidden', 'cross-site form');
      try { loginGate(req, name); } catch (e) {
        await sendHTML(res, 429, renderLogin({ lang: l, form, error: tr(l, 'add.rate', { min: Math.ceil(((e.extra && e.extra.retry) || 60) / 60) }) }), 'page', { 'Retry-After': String((e.extra && e.extra.retry) || 60) });
        return;
      }
      const user = userByName(name);
      const ok = user ? await checkPassword(user, String(q.password || '')) : (await pbkdf2(String(q.password || ''), new Uint8Array(16), iterations), false);
      if (!ok) { loginFailed(req, name); await sendHTML(res, 401, renderLogin({ lang: l, form, error: tr(l, 'add.wrong') })); return; }
      const { token } = await newSession(user, 'cookie', req.headers['user-agent']);
      const back = `/add?${new URLSearchParams({ url: form.url, title: form.title, selection: form.selection, lang: l })}`;
      // 303 See Other after POST: the browser follows with GET, so reload does not resubmit the password (PRG).
      res.writeHead(303, { Location: back, 'Set-Cookie': cookieHeader(req, token, 30 * 86400), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (req.method === 'GET') {
      const form = formOf(Object.fromEntries(url.searchParams));
      if (!hasOwner()) { await sendHTML(res, 200, renderMessage({ lang, title: tr(lang, 'add.title'), text: tr(lang, 'add.noSetup'), link: '/' })); return; }
      const s = await sessionOf(req, { navigation: true });
      if (!s) { await sendHTML(res, 200, renderLogin({ lang, form })); return; }
      const parsed = parseUserURL(form.url);
      const items = liveValues(s.user.id, 'bookmark');
      const key = parsed ? urlKey(parsed) : '';
      // Saving a page that is already bookmarked edits that bookmark (matched by normalised URL key) and appends the
      // new text selection as a quote to its notes, instead of creating a duplicate.
      const existing = parsed ? items.find((b) => urlKey(b.url) === key) : null;
      const sel = form.selection.trim();
      const view = existing
        ? { url: existing.url, title: existing.title, notes: existing.notes + (sel && !existing.notes.includes(sel) ? (existing.notes ? '\n\n' : '') + quote(sel) : ''), tags: existing.tags.join(', '), folder: existing.folder, unread: existing.unread, fav: existing.fav, public: existing.public }
        : { url: parsed ? cleanURL(parsed) : form.url, title: form.title, notes: sel ? quote(sel) : '', tags: '', folder: '', unread: false, fav: false, public: false };
      await sendHTML(res, 200, renderAdd({ lang, form: view, folders: folderList(s.user.id), tags: tagList(items), csrf: await hmac(accounts.secret, s.key), existing }));
      return;
    }
    if (req.method !== 'POST') throw new HttpError(405, 'method', 'method not allowed');
    const q = await readForm(req);
    const l = pickLang(req.headers['accept-language'], q.lang);
    const s = await sessionOf(req);
    if (!s) { await sendHTML(res, 401, renderLogin({ lang: l, form: formOf(q) })); return; }
    // CSRF token = HMAC(server secret, session hash): stateless (nothing stored per form), bound to this session,
    // and unforgeable without the secret. Compared in constant time.
    if (!q.csrf || !sameText(q.csrf, await hmac(accounts.secret, s.key))) {
      await sendHTML(res, 403, renderMessage({ lang: l, title: tr(l, 'add.title'), text: tr(l, 'add.expired') }));
      return;
    }
    const parsed = parseUserURL(q.url);
    const uid = s.user.id;
    if (!parsed) {
      await sendHTML(res, 400, renderAdd({ lang: l, form: { ...q, unread: !!q.unread, fav: !!q.fav, public: !!q.public }, folders: folderList(uid), tags: tagList(liveValues(uid, 'bookmark')), csrf: q.csrf, existing: null, error: tr(l, 'add.badUrl') }));
      return;
    }
    const folders = new Set(liveValues(uid, 'folder').map((f) => f.id));
    const fields = {
      url: cleanURL(parsed), title: String(q.title || '').trim(), notes: String(q.notes || '').replace(/\r\n?/g, '\n').trim(),
      tags: String(q.tags || '').split(',').map(cleanTag).filter(Boolean), folder: folders.has(q.folder) ? q.folder : '',
      unread: !!q.unread, fav: !!q.fav, public: !!q.public, modified: now(),
    };
    const lg = libOf(uid);
    // The hidden id is client input: validated in shape, and it only counts if it names a live bookmark of this user.
    const prev = q.id && /^[A-Za-z0-9_-]{1,64}$/.test(q.id) ? lg.get(q.id) : null;
    let id;
    if (prev && !isDeleted(prev) && prev.type === 'bookmark') { id = prev.id; serverEdit(uid, id, 'bookmark', fields); }
    else { id = newId(); serverEdit(uid, id, 'bookmark', { ...fields, created: now(), visited: 0, archived: false, icon: '', del: false }); }
    // The favicon arrives later (when this server fetches page metadata).
    if (cfg.fetchMeta && node && !(prev && valueOf(prev).icon)) {
      const f = getFetcher();
      // Fire-and-forget: the popup answers at once; the icon lands later as a server edit and syncs to clients.
      f.page(fields.url).then((meta) => f.icon(meta.url, meta.icons)).then((icon) => { if (icon && lg.get(id) && !isDeleted(lg.get(id))) serverEdit(uid, id, 'bookmark', { icon }); }).catch(() => {});
    }
    await sendHTML(res, 200, renderMessage({ lang: l, title: tr(l, prev ? 'add.updated' : 'add.saved'), text: fields.title || fields.url, close: true }), 'closing');
  }
  const quote = (s) => s.split('\n').map((x) => '> ' + x).join('\n');

  // --- entry --------------------------------------------------------------------------------------------------------------------------------
  return {
    config: () => ({ ...cfg }),
    // Returns false for paths this service does not own, so the host can serve static files for them.
    async handle(req, res, url = new URL(req.url, 'http://local')) {
      // Security headers for everything this server answers, the static application pages included (hosting.js /
      // server.js write their headers over these with writeHead, which keeps headers set here).
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', APP_CSP);
      const p = url.pathname;
      let m = null;
      const isApi = p === '/api' || p.startsWith('/api/');
      const isAdd = p === '/add' || p === '/add/login';
      if (!isApi && !isAdd && !(m = /^\/u\/([a-z0-9][a-z0-9_.-]{0,31})(\/feed)?\/?$/.exec(p))) return false;
      try {
        if (isApi) await api(req, res, url);
        else if (isAdd) await addPage(req, res, url);
        else await publicPage(req, res, url, m[1], !!m[2]);
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) log('error', req.method, p, e && e.stack || e);
        if (!res.headersSent) {
          const extra = e instanceof HttpError && e.extra && e.extra.retry ? { 'Retry-After': String(e.extra.retry) } : {};
          // 500s never echo the internal message (may contain paths or stack details); it goes to the log instead.
          if (isApi) sendJSON(res, status, { error: e.code || 'error', message: status === 500 ? 'server error' : e.message, ...(e.extra || {}) }, extra);
          else { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...extra }); res.end(status === 500 ? 'server error\n' : e.message + '\n'); }
        } else res.destroy();
      }
      return true;
    },
    close() { clearInterval(cleanup); },
  };
}
