// site-studio/backend-auth.js - accounts of a backend site (bundled into lib/site.mjs with backend-server.js; imports
// only pure modules, the Node built-ins come from the launcher):
//   sign-in by password (scrypt) or by a one-time link sent by e-mail, registration (doc.auth.signup: open | invite |
//   closed), profile, sign-out; sessions in an HttpOnly cookie; roles of doc.auth (viewer-access.js, access/roles.js)
//   deciding which closed pages an account may open; the admin side: accounts (role, block, delete, invite) and the
//   mail outbox (links that could not be sent because no SMTP server is configured, and every message sent).
//
//   createAuth({ fs, path, crypto, net, tls, DATA, env, log, writeFile, readJSON, getDoc }) -> {
//     user(req), handle(req, res, segs, url, h) (api/_auth/*), verifyRoute(req, res, url, h) (/_auth/link),
//     admin(req, res, segs, h) (api/_admin/users…, api/_admin/outbox), isAdmin(req), info() }
//   h = { json, fail, send, readJSONBody, allow, clientIP }
//
// Data: DATA/accounts.json { v, users: [{ id, email, name, role, hash, salt, created, seen, blocked, verified }] },
// DATA/sessions.json { sid-hash: { uid, at, seen } }, DATA/links.json { token-hash: { email, at, back, invite } },
// DATA/outbox.json [{ id, at, to, subject, text, sent, error }].
// SMTP: env SMTP_URL = smtp://user:pass@host:587 (STARTTLS when offered) or smtps://user:pass@host:465, MAIL_FROM.
//
// Security design (read before changing anything below):
// - Secrets at rest are hashed: session ids and link tokens are stored only as SHA-256 of a 256-bit random value. A
//   leaked sessions.json / links.json therefore grants nothing; plain SHA-256 (not scrypt) is enough because the input
//   has full entropy, nothing to brute-force. Passwords, which are low-entropy, get scrypt with a per-user salt.
// - Dependency injection (fs, crypto, net, tls from the launcher): this file is bundled into lib/site.mjs and also
//   imported by browser-side code paths for typing / tests, so it must not import Node built-ins itself.
// - State lives in memory and is written through on every change (writeFile with mode 0600). Single-process server
//   assumed: two processes on the same DATA directory would overwrite each other's sessions.
// - Failure answers are short machine codes ('wrong', 'taken', 'weak'); the page runtime maps them to texts.
import { smtpScript, parseSmtpReply } from '../mail/smtp.js';
import { buildMessage } from '../mail/mime.js';
import { canonEmail } from '../mail/address.js';
import { pageAllowed } from './viewer-access.js';
import { isObj, str } from '../util/value.js';

// SESSION_DAYS: absolute lifetime from sign-in (not sliding). LINK_MIN: one-time link lifetime; invites live 7 * 72 times
// longer (20 min * 504 = 7 days). MAX_USERS bounds accounts.json, which is rewritten whole on every change.
const SESSION_DAYS = 30;
const LINK_MIN = 20;
const COOKIE = 'ss_sid';
const MAX_USERS = 50000;

export function createAuth(o) {
  const { fs, path, crypto, DATA, env = {}, log, writeFile, readJSON, getDoc } = o;
  const Buffer = o.Buffer || globalThis.Buffer;
  const FILE = { users: path.join(DATA, 'accounts.json'), sessions: path.join(DATA, 'sessions.json'), links: path.join(DATA, 'links.json'), outbox: path.join(DATA, 'outbox.json') };
  // Records without a string id / email are dropped at load: a hand-edited file must not crash every request later.
  const db = readJSON(FILE.users, null);
  const users = isObj(db) && Array.isArray(db.users) ? db.users.filter((u) => isObj(u) && typeof u.id === 'string' && typeof u.email === 'string') : [];
  const sessions = (() => { const s = readJSON(FILE.sessions, {}); return isObj(s) ? s : {}; })();
  const links = (() => { const s = readJSON(FILE.links, {}); return isObj(s) ? s : {}; })();
  let outbox = (() => { const s = readJSON(FILE.outbox, []); return Array.isArray(s) ? s : []; })();
  const save = (what) => {
    if (what === 'users') writeFile(FILE.users, JSON.stringify({ v: 1, users }), 0o600);
    else if (what === 'sessions') writeFile(FILE.sessions, JSON.stringify(sessions), 0o600);
    else if (what === 'links') writeFile(FILE.links, JSON.stringify(links), 0o600);
    else if (what === 'outbox') writeFile(FILE.outbox, JSON.stringify(outbox.slice(-500)), 0o600);
  };
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  const rnd = (n) => crypto.randomBytes(n).toString('base64url');
  const byEmail = (e) => users.find((u) => u.email === e) || null;
  const byId = (id) => users.find((u) => u.id === id) || null;
  // The policy is read from the current document on every call (getDoc), so publishing a new doc from the constructor
  // changes sign-up rules without a restart. The fallback is the permissive default of a fresh backend site.
  const auth = () => { const d = getDoc(); return (d && d.auth) || { signup: 'open', password: true, link: true, defaultRole: 'member', roles: [] }; };
  // 'admin' and 'member' are always valid even if the document's role list omits them: the server depends on both.
  const roleIds = () => new Set(((auth().roles) || []).map((r) => r.id).concat('admin', 'member'));
  // Public projection: hash and salt never leave the server; `password` only says whether one is set.
  const pub = (u) => ({ id: u.id, email: u.email, name: u.name || '', role: u.role, created: u.created, seen: u.seen || null, blocked: !!u.blocked, verified: !!u.verified, password: !!u.hash });

  // The first account becomes an administrator unless ADMIN_EMAIL names one (that address is always admin).
  // Bootstrap rule: without ADMIN_EMAIL the first account to register becomes admin. Deploy-time race: whoever registers
  // first on a freshly deployed open site owns it, hence ADMIN_EMAIL is the recommended setting.
  const adminEmail = canonEmail(str(env.ADMIN_EMAIL)).ok ? canonEmail(env.ADMIN_EMAIL).address : '';
  const roleForNew = (email) => (email === adminEmail || (!adminEmail && !users.length) ? 'admin' : auth().defaultRole || 'member');

  // scrypt N=2^14, r=8, p=1: about 16 MiB and tens of ms per hash, the interactive-login parameters from the scrypt paper.
  // maxmem is raised explicitly because Node's default (32 MiB) sits too close to 128*N*r. NFC normalization: the same
  // password typed on macOS (NFD input) and Windows (NFC) must hash identically.
  function hashPass(pass, salt) {
    return crypto.scryptSync(String(pass).normalize('NFC'), Buffer.from(salt, 'base64url'), 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url');
  }
  // timingSafeEqual compares in constant time; the length check first is required (it throws on unequal lengths) and
  // leaks nothing, since all hashes have the same length.
  // KNOWN DEFECT: for an unknown e-mail this returns before running scrypt, so login answers measurably faster for
  // non-existent accounts (account enumeration by timing). Fix: hash against a dummy salt when `u` is missing.
  function checkPass(u, pass) {
    if (!u || !u.hash || !u.salt) return false;
    const a = Buffer.from(hashPass(pass, u.salt));
    const b = Buffer.from(u.hash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /* ---------- sessions ---------- */

  // Minimal Cookie header parser: first '=' splits name / value, no decoding (the sid is base64url, needs none).
  const cookies = (req) => {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  };
  // X-Forwarded-Proto is trusted only with TRUST_PROXY=1: otherwise any client could claim https. Behind a TLS-terminating
  // proxy without that setting the cookie simply lacks Secure (works, less strict), never the reverse.
  const secure = (req) => !!(req.socket && req.socket.encrypted) || (env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-proto'] || '') === 'https');
  // HttpOnly: page scripts (and XSS) cannot read the session. SameSite=Lax: the cookie is not sent on cross-site POSTs,
  // which is the CSRF defence for the JSON API; top-level GET navigations (the e-mail link) still carry it.
  const cookieOf = (req, sid, maxAge) => `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;
  // A new random sid per sign-in (session fixation is impossible: a client-supplied sid is never adopted).
  function startSession(req, u) {
    const sid = rnd(32);
    sessions[sha(sid)] = { uid: u.id, at: Date.now(), seen: Date.now() };
    u.seen = new Date().toISOString();
    save('sessions');
    save('users');
    return cookieOf(req, sid, SESSION_DAYS * 86400);
  }
  // `seen` is refreshed at most hourly per session and flushed to disk at most once a minute overall: a busy site must
  // not rewrite sessions.json on every request. Losing up to a minute of `seen` on a crash is harmless.
  let touched = 0;
  // The format check runs before hashing: arbitrary cookie garbage never reaches the store lookup. Expired sessions are
  // deleted lazily on use; never-used expired ones remain in the file (bounded by sign-ins, acceptable).
  function user(req) {
    const sid = cookies(req)[COOKIE];
    if (!sid || !/^[A-Za-z0-9_-]{20,80}$/.test(sid)) return null;
    const k = sha(sid);
    const s = sessions[k];
    if (!s) return null;
    if (Date.now() - s.at > SESSION_DAYS * 864e5) { delete sessions[k]; save('sessions'); return null; }
    const u = byId(s.uid);
    if (!u || u.blocked) return null;
    if (Date.now() - (s.seen || 0) > 3600e3) { s.seen = Date.now(); if (Date.now() - touched > 60e3) { touched = Date.now(); save('sessions'); } }
    return u;
  }
  // Used on block and delete: revocation is immediate because every request re-reads `sessions`.
  function endSessions(uid) {
    for (const [k, s] of Object.entries(sessions)) if (s.uid === uid) delete sessions[k];
    save('sessions');
  }

  /* ---------- mail ---------- */

  // Parsed once at start. Invalid or non-smtp(s) URLs disable mail instead of failing later per message; userinfo is
  // percent-decoded because passwords with '@' or ':' must be URL-encoded in SMTP_URL.
  const smtp = (() => {
    const raw = str(env.SMTP_URL).trim();
    if (!raw) return null;
    try {
      const u = new URL(raw);
      if (!/^smtps?:$/.test(u.protocol)) return null;
      return { tls: u.protocol === 'smtps:', host: u.hostname, port: Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587), user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) };
    } catch { return null; }
  })();
  const from = canonEmail(str(env.MAIL_FROM)).ok ? env.MAIL_FROM : smtp && smtp.user && canonEmail(smtp.user).ok ? smtp.user : 'no-reply@localhost';

  // One SMTP transaction over net / tls (STARTTLS when the server offers it); resolves to '' or an error text.
  // A tiny SMTP client: smtpScript (mail/smtp.js) produces the command list with expected reply codes; this function
  // only drives the socket. Never rejects: resolves '' on success or an error text, so callers record the outcome in
  // the outbox instead of crashing a request. The 30 s timer bounds hung servers.
  function smtpSend(to, message) {
    return new Promise((resolve) => {
      if (!smtp || !o.net || !o.tls) { resolve('no SMTP server configured'); return; }
      let steps;
      try { steps = smtpScript({ helo: 'site', from, to: [to], message, auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : null, starttls: !smtp.tls }); } catch (e) { resolve(String(e.message || e)); return; }
      let sock = smtp.tls ? o.tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host }) : o.net.connect({ host: smtp.host, port: smtp.port });
      let buf = '';
      let i = -1; // -1: waiting for the greeting
      let done = false;
      const finish = (err) => { if (done) return; done = true; clearTimeout(tm); try { sock.end(); } catch { /* closed */ } resolve(err); };
      const tm = setTimeout(() => finish('SMTP timeout'), 30000);
      const next = () => {
        i++;
        if (i >= steps.length) { finish(''); return; }
        const st = steps[i];
        sock.write(st.raw ? st.send : st.send + '\r\n');
      };
      // latin1 decoding keeps bytes 1:1 (SMTP replies are ASCII; nothing is lost if a server sends 8-bit). Replies can arrive
      // split or coalesced, so the loop parses as many complete replies as the buffer holds.
      const onData = (chunk) => {
        buf += chunk.toString('latin1');
        for (;;) {
          const r = parseSmtpReply(buf);
          if (!r) return;
          buf = r.rest;
          if (i < 0) { if (r.code !== 220) { finish('SMTP greeting ' + r.code); return; } next(); continue; }
          const st = steps[i];
          // Without STARTTLS support the script's STARTTLS step fails: plain servers on 587 are refused on purpose.
          if (!st.expect.includes(r.code)) { finish(`SMTP ${st.secret ? 'AUTH' : st.send.split(' ')[0]}: ${r.code} ${r.text}`.slice(0, 300)); return; }
          // STARTTLS: upgrade the same TCP socket in place; the buffer is cleared because pre-TLS bytes must not be trusted
          // after the upgrade (STARTTLS command injection).
          if (st.tls) {
            sock.removeListener('data', onData);
            sock = o.tls.connect({ socket: sock, servername: smtp.host }, () => { buf = ''; next(); });
            sock.on('data', onData);
            sock.on('error', (e) => finish('SMTP TLS: ' + e.message));
            return;
          }
          next();
        }
      };
      sock.on('data', onData);
      sock.on('error', (e) => finish('SMTP: ' + e.message));
    });
  }

  // Every message, sent or not, lands in the outbox (last 500 kept): without SMTP the admin can still copy the sign-in
  // link from the console, which makes link sign-in usable on a fresh install.
  async function mail(to, subject, text) {
    const entry = { id: rnd(9), at: Date.now(), to, subject, text, sent: false, error: '' };
    const message = buildMessage({ from, to: [to], subject, text, date: Date.now(), messageId: rnd(12) + '@site', auto: true });
    entry.error = await smtpSend(to, message);
    entry.sent = !entry.error;
    outbox.push(entry);
    save('outbox');
    if (!entry.sent) log(`mail to ${to} not sent (${entry.error}); it is in the admin console → Accounts → Outbox`);
    return entry.sent;
  }

  /* ---------- links ---------- */

  // KNOWN DEFECT: the link origin is taken from the client's Host header (only filtered to host characters). An attacker
  // can request a link for a victim's address with "Host: attacker.example"; the victim receives a genuine e-mail whose
  // link carries a valid token to the attacker's host (token theft by Host header poisoning). Fix: build links from a
  // configured site URL (doc.meta.siteUrl or an env setting) and use Host only as a development fallback.
  const origin = (req) => (secure(req) ? 'https://' : 'http://') + String(req.headers.host || 'localhost').replace(/[^A-Za-z0-9.:[\]-]/g, '');
  // Open-redirect guard: only same-origin paths survive. Parsing against a dummy base and requiring host 'x' also catches
  // '/\evil.example' (WHATWG URL treats '\' as '/' for http, giving host evil.example); '//' is excluded explicitly.
  const safeBack = (b) => { const s = str(b); try { const u = new URL(s, 'http://x'); return u.host === 'x' && s.startsWith('/') && !s.startsWith('//') ? u.pathname + u.search + u.hash : '/'; } catch { return '/'; } };
  // Expired links are swept on every send, which bounds links.json without a timer.
  async function sendLink(req, email, back, invite) {
    const tok = rnd(32);
    links[sha(tok)] = { email, at: Date.now(), back: safeBack(back), invite: invite || null };
    for (const [k, v] of Object.entries(links)) if (Date.now() - v.at > LINK_MIN * 60e3 * (v.invite ? 7 * 72 : 1)) delete links[k];
    save('links');
    const d = getDoc();
    const site = str(d && d.meta && d.meta.title && (d.meta.title[d.defaultLang] || Object.values(d.meta.title)[0])) || str(d && d.name) || 'site';
    const url = origin(req) + '/_auth/link?t=' + tok;
    const text = invite
      ? `You are invited to ${site}.\n\nOpen this link to sign in (valid for 7 days):\n${url}\n`
      : `Sign in to ${site}:\n${url}\n\nThe link works once and for ${LINK_MIN} minutes. If you did not ask for it, ignore this message.\n`;
    return mail(email, invite ? `Invitation: ${site}` : `Sign-in link: ${site}`, text);
  }

  /* ---------- public API: api/_auth/* ---------- */

  // 'me' is excluded from the rate limit (pages call it on every load); every POST operation counts against the per-IP
  // 'auth' budget before the body is even read.
  async function handle(req, res, segs, url, h) {
    const a = auth();
    const m = req.method;
    const op = segs[0] || '';
    const ip = h.clientIP(req);
    if (op === 'me') {
      const u = user(req);
      if (m === 'GET' || m === 'HEAD') return h.json(req, res, 200, { ok: true, user: u ? pub(u) : null, signup: a.signup, password: a.password, link: a.link });
      if (m === 'PATCH') {
        if (!u) return h.fail(req, res, 401, 'unauthorized');
        const body = await h.readJSONBody(req, 8192);
        if (isObj(body) && typeof body.name === 'string') u.name = body.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
        if (isObj(body) && typeof body.password === 'string' && a.password) {
          // KNOWN DEFECT: changing the password needs no current password and keeps all other sessions alive, so a stolen session
          // can take over the account permanently. Fix: require the old password when one is set, and endSessions(u.id) except
          // the current session after a change.
          if (body.password.length < 8) return h.fail(req, res, 400, 'weak');
          u.salt = rnd(16); u.hash = hashPass(body.password, u.salt);
        }
        save('users');
        return h.json(req, res, 200, { ok: true, user: pub(u) });
      }
      return h.fail(req, res, 405, 'method not allowed');
    }
    if (m !== 'POST') return h.fail(req, res, 405, 'method not allowed');
    const wait = h.allow(ip, 'auth');
    if (wait) return h.fail(req, res, 429, 'too many attempts', { 'Retry-After': String(wait) });
    const body = (await h.readJSONBody(req, 8192)) || {};
    // Logout deletes the server-side session (not just the cookie), so a copied cookie stops working too.
    if (op === 'logout') {
      const sid = cookies(req)[COOKIE];
      if (sid) { delete sessions[sha(sid)]; save('sessions'); }
      return h.json(req, res, 200, { ok: true }, { 'Set-Cookie': cookieOf(req, '', 0) });
    }
    const em = canonEmail(str(body.email).trim());
    if (!em.ok) return h.fail(req, res, 400, 'email');
    const email = em.address;
    // Blocked is checked after the password, so the 'blocked' answer is given only to someone who knows the password.
    if (op === 'login') {
      if (!a.password) return h.fail(req, res, 403, 'password sign-in is off');
      const u = byEmail(email);
      if (!u || !checkPass(u, str(body.password))) return h.fail(req, res, 401, 'wrong');
      if (u.blocked) return h.fail(req, res, 403, 'blocked');
      return h.json(req, res, 200, { ok: true, user: pub(u) }, { 'Set-Cookie': startSession(req, u) });
    }
    // 'taken' reveals that an address has an account; accepted for open sign-up UX (the link endpoint below is the
    // non-revealing path). A password may be omitted only when link sign-in is on; then the account is confirmed by mail.
    if (op === 'register') {
      if (a.signup !== 'open') return h.fail(req, res, 403, 'closed');
      if (byEmail(email)) return h.fail(req, res, 409, 'taken');
      if (users.length >= MAX_USERS) return h.fail(req, res, 507, 'full');
      const pass = str(body.password);
      if (a.password && pass.length < 8 && !(a.link && !pass)) return h.fail(req, res, 400, 'weak');
      const u = { id: 'u' + rnd(12).replace(/[^A-Za-z0-9]/g, ''), email, name: str(body.name).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120), role: roleForNew(email), created: new Date().toISOString(), seen: null, blocked: false, verified: false };
      if (pass) { u.salt = rnd(16); u.hash = hashPass(pass, u.salt); }
      users.push(u);
      save('users');
      log(`account created: ${email} (${u.role})`);
      if (!pass) { await sendLink(req, email, str(body.back) || '/', null); return h.json(req, res, 201, { ok: true, pending: true }); }
      return h.json(req, res, 201, { ok: true, user: pub(u) }, { 'Set-Cookie': startSession(req, u) });
    }
    if (op === 'link') {
      if (!a.link) return h.fail(req, res, 403, 'link sign-in is off');
      const u = byEmail(email);
      // The answer never tells whether an account exists; a new address gets an account only where sign-up is open.
      if ((u && !u.blocked) || (!u && a.signup === 'open')) await sendLink(req, email, str(body.back) || '/', null);
      return h.json(req, res, 200, { ok: true, pending: true });
    }
    return h.fail(req, res, 404, 'unknown');
  }

  // GET /_auth/link?t=… : the one-time link from the e-mail → session cookie → back to the page it was asked on.
  // Token is single-use: deleted before anything else can fail. The interpolated `msg` values are fixed literals from
  // this function, never user input, so the inline HTML is not an injection point. Cache-Control: no-store keeps the
  // token URL's answer out of caches; the 302 strips the token from the address bar.
  function verifyRoute(req, res, url, h) {
    const tok = str(url.searchParams.get('t'));
    const k = /^[A-Za-z0-9_-]{30,80}$/.test(tok) ? sha(tok) : '';
    const L = k ? links[k] : null;
    const page = (msg) => h.send(req, res, 400, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${msg}</title><body style="font:16px system-ui;margin:3em auto;max-width:32em;padding:0 1em"><h1>${msg}</h1><p><a href="/">←</a></p>`, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    if (!L || Date.now() - L.at > LINK_MIN * 60e3 * (L.invite ? 7 * 72 : 1)) return page('The link has expired');
    delete links[k];
    save('links');
    let u = byEmail(L.email);
    if (!u) {
      if (auth().signup !== 'open' && !L.invite) return page('Sign-up is closed');
      u = { id: 'u' + rnd(12).replace(/[^A-Za-z0-9]/g, ''), email: L.email, name: '', role: (L.invite && L.invite.role) || roleForNew(L.email), created: new Date().toISOString(), seen: null, blocked: false, verified: true };
      users.push(u);
    }
    if (u.blocked) return page('This account is blocked');
    u.verified = true;
    save('users');
    return h.send(req, res, 302, '', { Location: L.back || '/', 'Set-Cookie': startSession(req, u), 'Cache-Control': 'no-store' });
  }

  /* ---------- admin ---------- */

  const isAdmin = (req) => { const u = user(req); return !!(u && u.role === 'admin'); };

  // Authorization is the caller's job (backend-server.js checks isAdmin / the admin token before dispatching here).
  // Returns null for paths it does not own, so the caller can continue routing.
  async function admin(req, res, segs, h) {
    const [a, id] = segs;
    const m = req.method;
    if (a === 'outbox' && m === 'GET') return h.json(req, res, 200, { outbox: outbox.slice().reverse().slice(0, 200), smtp: !!smtp });
    if (a !== 'users') return null;
    if (!id && m === 'GET') return h.json(req, res, 200, { users: users.map(pub), roles: auth().roles, signup: auth().signup });
    // An invite pre-creates the account (unverified) and sends a 7-day link that carries the role; an invalid role from
    // the client falls back to the default role rather than failing.
    if (id === 'invite' && m === 'POST') {
      const body = (await h.readJSONBody(req, 8192)) || {};
      const em = canonEmail(str(body.email).trim());
      if (!em.ok) return h.fail(req, res, 400, 'email');
      const role = roleIds().has(str(body.role)) ? body.role : auth().defaultRole;
      let u = byEmail(em.address);
      if (!u) {
        u = { id: 'u' + rnd(12).replace(/[^A-Za-z0-9]/g, ''), email: em.address, name: str(body.name).trim().slice(0, 120), role, created: new Date().toISOString(), seen: null, blocked: false, verified: false };
        users.push(u);
        save('users');
      }
      const sent = await sendLink(req, em.address, '/', { role });
      return h.json(req, res, 201, { ok: true, user: pub(u), sent });
    }
    const u = byId(id);
    if (!u) return h.fail(req, res, 404, 'not found');
    if (m === 'PATCH') {
      const body = (await h.readJSONBody(req, 8192)) || {};
      if (typeof body.role === 'string' && roleIds().has(body.role)) u.role = body.role;
      if (typeof body.blocked === 'boolean') { u.blocked = body.blocked; if (u.blocked) endSessions(u.id); }
      if (typeof body.name === 'string') u.name = body.name.trim().slice(0, 120);
      save('users');
      return h.json(req, res, 200, { ok: true, user: pub(u) });
    }
    // No guard against deleting or demoting the last administrator; the ADMIN_EMAIL rule can restore one on next sign-up.
    if (m === 'DELETE') {
      users.splice(users.indexOf(u), 1);
      endSessions(u.id);
      save('users');
      return h.json(req, res, 200, { ok: true });
    }
    return h.fail(req, res, 405, 'method not allowed');
  }

  const allowed = (page, req) => pageAllowed(getDoc(), page, user(req));
  const info = () => ({ users: users.length, smtp: !!smtp, outbox: outbox.filter((x) => !x.sent).length });
  return { user, handle, verifyRoute, admin, isAdmin, allowed, info };
}
