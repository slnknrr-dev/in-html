// language-studio/service.js - accounts and progress storage of Language Studio for BACKEND builds and the development
// server (Node >= 18, no node: imports: it works on the req / res objects it is given and on Web Crypto).
//
//   createStudioService({ storage, log, env, now }) -> { handle(req, res, url) -> Promise<boolean>, close() }
//     storage  { read(key), write(key, value), remove?(key) }  JSON per key, atomic writes (hosting.js)
//     env      STUDIO_REGISTRATION=open|closed (default open), STUDIO_TRUST_PROXY=1, STUDIO_PBKDF2_ITERATIONS
//
// Accounts: anyone may register while registration is open (the first account is the owner, who can close it).
// Passwords are PBKDF2-SHA-256 hashes with a random salt; sessions are random 256-bit tokens kept only as SHA-256
// hashes, sent as an HttpOnly SameSite=Lax cookie. The cookie counts only on requests from this origin (Origin /
// Sec-Fetch-Site), state-changing calls need JSON bodies, sign-in and registration are rate limited per address and
// per name, and every response carries security headers.
//
// JSON API under /api (errors: { error: code, message }):
//   GET  info                          { registration, user | null }
//   GET  session                       { user } or 401
//   POST register {name, password}     POST login {name, password}     POST logout
//   GET  progress                      { doc }        PUT progress { doc } -> { doc } (merged with the stored copy)
//   POST password {old, new}           POST delete {password}  (removes the account and its progress)
//   owner: POST registration {open}
import { cleanProgress, emptyProgress, mergeProgress } from './progress.js';

const enc = new TextEncoder();
const COOKIE = 'ls_session';
// Account names: lowercase ASCII, 2..32 characters, starting alphanumeric. Lowercase-only removes case-confusable
// duplicates ("Ann" / "ann"); ASCII removes homoglyph look-alikes; the set is safe in storage keys and cookies.
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
const DAY = 864e5;

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const randomToken = (n = 32) => b64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));
async function sha256hex(s) { return Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(String(s)))).toString('hex'); }
async function pbkdf2(password, salt, iterations) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
// Constant-time comparison of equal-length hashes: OR-accumulate the XOR of every byte instead of returning at the
// first difference, so response timing does not reveal how many leading bytes of a password hash matched. The
// early length check leaks only the length, which is fixed (256-bit hashes) and public anyway.
const sameBytes = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}

// Streamed body with a hard size cap: rejects as soon as the limit is crossed (413) instead of buffering an unbounded
// upload first; req.resume() drains the rest so the socket is not left stalled.
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

// Requiring Content-Type: application/json is a CSRF defence: an HTML form on another site can only send
// urlencoded, multipart or text/plain bodies without a CORS preflight, so it cannot reach these handlers.
async function readJSON(req, limit = 64 * 1024) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'json_required', 'send application/json');
  const text = await readBody(req, limit);
  if (!text) return {};
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : {}; } catch { throw new HttpError(400, 'invalid', 'invalid JSON'); }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const flag = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on|open)$/i.test(String(v)));

export function createStudioService({ storage, log = () => {}, env = (globalThis.process && globalThis.process.env) || {}, now = () => Date.now() } = {}) {
  if (!storage) throw new Error('the studio service needs a storage');
  const remove = (key) => (storage.remove ? storage.remove(key) : storage.write(key, null));
  const iterations = Math.max(100000, Number(env.STUDIO_PBKDF2_ITERATIONS) || 310000);
  const trustProxy = flag(env.STUDIO_TRUST_PROXY, false);
  const accounts = storage.read('accounts') || { version: 1, users: {}, registration: true };
  const sessions = storage.read('sessions') || {};
  const regLocked = env.STUDIO_REGISTRATION !== undefined;
  const registrationOpen = () => (regLocked ? flag(env.STUDIO_REGISTRATION, true) : accounts.registration !== false);
  const saveAccounts = () => storage.write('accounts', accounts);
  const saveSessions = () => storage.write('sessions', sessions);
  const userByName = (name) => Object.values(accounts.users).find((u) => u.name === String(name || '').toLowerCase()) || null;

  const ipOf = (req) => (trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : (req.socket && req.socket.remoteAddress) || '?');
  const hostOf = (req) => String((trustProxy && req.headers['x-forwarded-host']) || req.headers.host || 'localhost').split(',')[0].trim();
  const secure = (req) => (trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).startsWith('https') : !!(req.socket && req.socket.encrypted));
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (origin) { try { if (new URL(origin).host !== hostOf(req)) return false; } catch { return false; } }
    const site = req.headers['sec-fetch-site'];
    return !site || site === 'same-origin' || site === 'none';
  };

  // rate limits: failures per key over a window
  const hits = new Map();
  const WINDOW = 15 * 60000;
  const recent = (key) => { const t = now(); const a = (hits.get(key) || []).filter((x) => t - x < WINDOW); hits.set(key, a); return a; };
  function gate(req, name) {
    for (const [key, max] of [['ip:' + ipOf(req), 10], ['user:' + name, 20]]) {
      const a = recent(key);
      if (a.length >= max) throw new HttpError(429, 'rate', 'too many attempts', { retry: Math.ceil((WINDOW - (now() - a[0])) / 1000) });
    }
  }
  const failed = (req, name) => { recent('ip:' + ipOf(req)).push(now()); recent('user:' + name).push(now()); };
  const cleanup = setInterval(() => {
    const t = now();
    for (const [k, a] of hits) if (!a.length || t - a[a.length - 1] > WINDOW) hits.delete(k);
    let changed = false;
    for (const [k, s] of Object.entries(sessions)) if (s.expires < t) { delete sessions[k]; changed = true; }
    if (changed) saveSessions();
  }, 10 * 60000);
  if (cleanup.unref) cleanup.unref();

  async function newSession(user) {
    const token = randomToken();
    sessions[await sha256hex(token)] = { user: user.id, created: now(), expires: now() + 30 * DAY };
    saveSessions();
    return token;
  }
  async function sessionOf(req) {
    const c = cookies(req)[COOKIE];
    if (!c || !/^[A-Za-z0-9_-]{20,200}$/.test(c) || !sameOrigin(req)) return null;
    const key = await sha256hex(c);
    const s = sessions[key];
    if (!s || s.expires < now()) return null;
    const user = accounts.users[s.user];
    return user ? { key, user } : null;
  }
  const cookieHeader = (req, token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;
  const pub = (u) => ({ name: u.name, owner: !!u.owner, created: u.created });

  async function checkPassword(user, password) {
    const hash = await pbkdf2(password, Buffer.from(user.salt, 'base64'), user.iter);
    return sameBytes(hash, Buffer.from(user.hash, 'base64'));
  }
  async function setPassword(user, password) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    user.salt = Buffer.from(salt).toString('base64');
    user.iter = iterations;
    user.hash = Buffer.from(await pbkdf2(password, salt, iterations)).toString('base64');
  }
  const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

  function send(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...headers,
    });
    res.end(text);
  }

  const routes = {
    'GET info': async (req) => { const s = await sessionOf(req); return { registration: registrationOpen(), locked: regLocked, user: s ? pub(s.user) : null }; },
    'GET session': async (req) => { const s = await sessionOf(req); if (!s) throw new HttpError(401, 'auth', 'not signed in'); return { user: pub(s.user) }; },
    'POST register': async (req, res) => {
      const b = await readJSON(req);
      const name = String(b.name || '').trim().toLowerCase();
      gate(req, name);
      const first = !Object.keys(accounts.users).length;
      if (!first && !registrationOpen()) throw new HttpError(403, 'closed', 'registration is closed');
      if (!NAME_RE.test(name)) throw new HttpError(400, 'bad_name', 'name: 2–32 of a–z, 0–9, _ . -');
      if (!validPassword(b.password)) throw new HttpError(400, 'bad_password', 'password: at least 8 characters');
      if (userByName(name)) { failed(req, name); throw new HttpError(409, 'name_taken', 'this name is taken'); }
      const user = { id: randomToken(9), name, owner: first, created: now() };
      await setPassword(user, b.password);
      accounts.users[user.id] = user;
      saveAccounts();
      log(`language-studio: account ${name} registered`);
      const token = await newSession(user);
      res.setHeader('Set-Cookie', cookieHeader(req, token, 30 * 86400));
      return { user: pub(user) };
    },
    'POST login': async (req, res) => {
      const b = await readJSON(req);
      const name = String(b.name || '').trim().toLowerCase();
      gate(req, name);
      const user = userByName(name);
      if (!user || typeof b.password !== 'string' || !(await checkPassword(user, b.password))) { failed(req, name); throw new HttpError(401, 'wrong_login', 'wrong name or password'); }
      const token = await newSession(user);
      res.setHeader('Set-Cookie', cookieHeader(req, token, 30 * 86400));
      return { user: pub(user) };
    },
    'POST logout': async (req, res) => {
      await readJSON(req).catch(() => ({}));
      const s = await sessionOf(req);
      if (s) { delete sessions[s.key]; saveSessions(); }
      res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
      return { ok: true };
    },
    'GET progress': async (req) => {
      const s = await need(req);
      return { doc: cleanProgress(storage.read('progress.' + s.user.id) || emptyProgress()) };
    },
    'PUT progress': async (req) => {
      const s = await need(req);
      const b = await readJSON(req, 4 * 1024 * 1024);
      const doc = mergeProgress(storage.read('progress.' + s.user.id) || emptyProgress(), b.doc);
      storage.write('progress.' + s.user.id, doc);
      return { doc };
    },
    'POST password': async (req) => {
      const s = await need(req);
      const b = await readJSON(req);
      gate(req, s.user.name);
      if (!(await checkPassword(s.user, String(b.old || '')))) { failed(req, s.user.name); throw new HttpError(403, 'wrong_password', 'wrong password'); }
      if (!validPassword(b.new)) throw new HttpError(400, 'bad_password', 'password: at least 8 characters');
      await setPassword(s.user, b.new);
      for (const [k, x] of Object.entries(sessions)) if (x.user === s.user.id && k !== s.key) delete sessions[k];
      saveAccounts(); saveSessions();
      return { ok: true };
    },
    'POST delete': async (req, res) => {
      const s = await need(req);
      const b = await readJSON(req);
      gate(req, s.user.name);
      if (!(await checkPassword(s.user, String(b.password || '')))) { failed(req, s.user.name); throw new HttpError(403, 'wrong_password', 'wrong password'); }
      delete accounts.users[s.user.id];
      for (const [k, x] of Object.entries(sessions)) if (x.user === s.user.id) delete sessions[k];
      remove('progress.' + s.user.id);
      saveAccounts(); saveSessions();
      res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
      return { ok: true };
    },
    'POST registration': async (req) => {
      const s = await need(req);
      if (!s.user.owner) throw new HttpError(403, 'forbidden', 'only the owner');
      if (regLocked) throw new HttpError(409, 'locked', 'set by STUDIO_REGISTRATION');
      const b = await readJSON(req);
      accounts.registration = !!b.open;
      saveAccounts();
      return { registration: registrationOpen() };
    },
  };
  async function need(req) {
    const s = await sessionOf(req);
    if (!s) throw new HttpError(401, 'auth', 'not signed in');
    return s;
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    const route = routes[req.method + ' ' + url.pathname.slice(5)];
    try {
      if (!route) throw new HttpError(404, 'not_found', 'no such API');
      if (req.method !== 'GET' && !sameOrigin(req)) throw new HttpError(403, 'bad_origin', 'cross-origin request');
      send(res, 200, await route(req, res, url));
    } catch (e) {
      if (!(e instanceof HttpError)) { log('language-studio: ' + (e && e.stack || e)); e = new HttpError(500, 'server', 'server error'); }
      send(res, e.status, { error: e.code, message: e.message, ...(e.extra || {}) }, e.status === 429 && e.extra ? { 'Retry-After': String(e.extra.retry) } : {});
    }
    return true;
  }

  return { handle, close: () => clearInterval(cleanup) };
}
