// event-invite/backend.js - the RSVP server of the BACKEND artifact (hosting.js mounts it; `node event-invite/server.js`
// too): published invitations and their replies as JSON files in the data folder (ctx.storage). Contract: default
// export (ctx) => ({ handle(req, res, url) }), ctx = { dataDir, storage: { read, write, list, remove }, log, node }.
//
// API below any base path (…/api/…, JSON, no cookies):
//   GET    api/info                               { app: 'event-invite', version }
//   POST   api/events            { invite, live } -> { id, token }      a new event; the token is shown once
//   PUT    api/events/<id>       { invite, live } -> { ok }             owner (Authorization: Bearer <token>)
//   GET    api/events/<id>                        { id, title, day, time, live }   public, no guest data
//   POST   api/events/<id>/rsvp  { guest, name, answer, plus, menu, diet, msg, lang } -> { ok, id }
//   GET    api/events/<id>/counts                 { yes, maybe, no, seats } only when the host allowed live counts
//   GET    api/events/<id>/replies[?format=csv]   owner: every reply
//   DELETE api/events/<id>/replies/<rid>          owner
// Guests never see other guests: the public routes return counts at most. CORS: EI_ORIGINS (comma-separated origins,
// 'null' for files opened from disk) limits the browsers allowed to call; unset allows any origin. Limits: bodies
// 8 KB (replies) / 256 KB (events), 30 replies per 10 minutes and 10 new events per hour per address, 3000 replies
// per event. Storage keys: event:<id>, replies:<id>.
//
// Security model in one paragraph: the host proves ownership with a bearer token generated here and returned once;
// only its SHA-256 is stored, so a leaked data folder does not leak write access. Guests are anonymous and can only
// append replies, so abuse is bounded by rate limits and size caps rather than by authentication. Every stored string
// is normalised (control characters removed, length capped) on the way in, so later readers (CSV export, the
// designer UI) never see raw attacker input shapes.
const VERSION = 1;
// "maybeNo" / "waitlist" exist only in the designer (manual statuses); the public form offers three answers.
const ANSWERS = ['yes', 'maybe', 'no'];

export default function backend(ctx) {
  const { storage, log = () => {} } = ctx;
  // Node crypto injected by the host (ctx.node) instead of imported: the same file is loaded by hosts that bundle it,
  // and an import of 'node:crypto' would break those. Fallbacks below keep it working, with weaker guarantees.
  const crypto = ctx.node && ctx.node.crypto;
  // Origin allow-list read once per backend instance; changing EI_ORIGINS needs a restart.
  const origins = String((globalThis.process && process.env.EI_ORIGINS) || '').split(',').map((s) => s.trim()).filter(Boolean);

  // Unbiased (256 % 32 == 0) random string from a look-alike-free alphabet. 32 chars = 160 bits for tokens, 10 chars
  // = 50 bits for ids: ids are public, only collisions matter; tokens must resist guessing.
  const random = (n = 24) => {
    const a = new Uint8Array(n);
    (crypto && crypto.webcrypto ? crypto.webcrypto : globalThis.crypto).getRandomValues(a);
    return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  };
  // KNOWN DEFECT: without ctx.node.crypto the "hash" is the token itself, so tokens are stored in plain text and the
  // leaked-data-folder guarantee above silently disappears. Fix: fail at startup (or use WebCrypto subtle.digest)
  // instead of degrading.
  const hash = (s) => (crypto ? crypto.createHash('sha256').update(String(s)).digest('hex') : String(s));
  // Constant-time comparison: the loop runs over the full length whatever the first mismatch, so response timing does
  // not reveal how many leading characters of a guessed hash were right. The early length check is safe here because
  // both sides are fixed-length hex digests.
  const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
  // line(): single-line fields (names, ids) lose every control char incl. newlines. text(): multi-line fields keep \n
  // (\u000a is excluded from the class) but lose \r, tabs and the rest, so CSV and HTML consumers see one line ending.
  const line = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
  const text = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, n);

  // Rate limits: token buckets per key. Refill is continuous (cap tokens per window), so bursts up to cap are allowed
  // and the long-run rate is cap/window. Map cleared wholesale above 20000 keys: crude, but bounds memory under a flood
  // of distinct addresses at the cost of briefly resetting everyone's budget.
  const buckets = new Map();
  const allow = (key, cap, windowMs) => {
    const now = Date.now();
    const b = buckets.get(key) || { n: cap, t: now };
    b.n = Math.min(cap, b.n + ((now - b.t) / windowMs) * cap); b.t = now;
    if (buckets.size > 20000) buckets.clear();
    if (b.n < 1) { buckets.set(key, b); return false; }
    b.n -= 1; buckets.set(key, b);
    return true;
  };
  // Socket address: behind a reverse proxy every client shares the proxy's address and therefore one bucket.
  // X-Forwarded-For is deliberately not trusted: without a known proxy it is client-controlled and would let anyone
  // pick a fresh bucket per request.
  const ipOf = (req) => String(req.socket && req.socket.remoteAddress || '');

  // CORS: no list = '*' (any page, incl. invitations opened from disk). With a list, the request origin is echoed only
  // when allowed; Vary: Origin keeps shared caches from serving one origin's header to another. No credentials are
  // used (bearer header, no cookies), so '*' never exposes ambient authority. Max-Age 600 caches preflights 10 min.
  const corsHeaders = (req) => {
    const o = req.headers.origin;
    const h = { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
    if (!origins.length) h['Access-Control-Allow-Origin'] = '*';
    else if (o && origins.includes(o)) h['Access-Control-Allow-Origin'] = o;
    return h;
  };
  // Every response: no-store (replies are private and change), nosniff (a JSON body is never sniffed into HTML),
  // no-referrer (event ids in URLs do not leak to third parties).
  const send = (req, res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...corsHeaders(req) });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    return true;
  };
  const fail = (req, res, status, error) => send(req, res, status, { error });

  // Streaming size cap: counts bytes as they arrive and destroys the socket past the limit instead of buffering an
  // arbitrarily large body first. Errors carry an HTTP status so the catch in handle() can answer with it.
  // KNOWN DEFECT: a valid JSON non-object body ("null", "1") resolves as-is; `body.live` / `b.answer` then throw a
  // TypeError without status and the request ends as a 500. Fix: resolve(v && typeof v === 'object' ? v : {}).
  const readJSON = (req, limit) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
  const owner = (req, ev) => {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    return !!(m && ev && same(hash(m[1]), ev.tokenHash));
  };
  // Only public fields of the invitation are kept (the host's contacts stay; guest lists never come here).
  // Whitelist copy, max 7 languages: the server stores just enough to answer GET api/events/<id>.
  const cleanInvite = (o) => {
    const v = o && typeof o === 'object' ? o : {};
    const map = (x, n) => (x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).slice(0, 7).map(([k, s]) => [line(k, 5), line(s, n)])) : {});
    return { title: map(v.title, 200), hosts: map(v.hosts, 200), day: line(v.day, 10), time: line(v.time, 5), endDay: line(v.endDay, 10), endTime: line(v.endTime, 5), tz: line(v.tz, 60), type: line(v.type, 30), langs: Array.isArray(v.langs) ? v.langs.slice(0, 7).map((l) => line(l, 5)) : [] };
  };
  const repliesOf = (id) => { const r = storage.read('replies:' + id); return Array.isArray(r) ? r : []; };
  // CSV injection guard: cells starting with = + - @ tab or CR are prefixed with ' so spreadsheet apps show them as
  // text instead of evaluating a formula from a guest-supplied name or message.
  const csvCell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  async function handle(req, res, url) {
    // Mounted below any prefix: the router finds '/api/' anywhere in the path, so the same backend works at the domain
    // root or under /event-invite/. Malformed %-escapes become '' instead of throwing (and then fail validation).
    const i = url.pathname.indexOf('/api/');
    if (i < 0) return false;
    const parts = url.pathname.slice(i + 5).split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
    // Preflight answered before routing: browsers send OPTIONS without auth, it must succeed for every route.
    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(req)); res.end(); return true; }
    try {
      if (parts[0] === 'info' && parts.length === 1) return send(req, res, 200, { app: 'event-invite', version: VERSION });
      if (parts[0] !== 'events') return fail(req, res, 404, 'not found');
      if (parts.length === 1 && req.method === 'POST') {
        if (!allow('ev:' + ipOf(req), 10, 3600e3)) return fail(req, res, 429, 'too many requests');
        const body = await readJSON(req, 256 * 1024);
        // The plain token goes back exactly once; only its hash is written.
        const id = random(10), token = random(32);
        storage.write('event:' + id, { id, tokenHash: hash(token), live: body.live === true, invite: cleanInvite(body.invite), created: new Date().toISOString() });
        log('event created', id);
        return send(req, res, 201, { id, token });
      }
      // Id sanitised to [\w-] before it becomes a storage key: no path or key-namespace injection.
      const id = String(parts[1] || '').replace(/[^\w-]/g, '').slice(0, 40);
      const ev = id ? storage.read('event:' + id) : null;
      if (!ev) return fail(req, res, 404, 'no such event');
      if (parts.length === 2) {
        if (req.method === 'GET') return send(req, res, 200, { id, title: ev.invite.title, day: ev.invite.day, time: ev.invite.time, live: ev.live });
        if (req.method === 'PUT') {
          if (!owner(req, ev)) return fail(req, res, 401, 'owner token required');
          const body = await readJSON(req, 256 * 1024);
          // Note: `live` is always rewritten, so a PUT that omits it turns live counts off (the designer always sends it).
          storage.write('event:' + id, { ...ev, invite: body.invite ? cleanInvite(body.invite) : ev.invite, live: body.live === true, updated: new Date().toISOString() });
          return send(req, res, 200, { ok: true });
        }
      }
      if (parts[2] === 'rsvp' && parts.length === 3 && req.method === 'POST') {
        if (!allow('r:' + ipOf(req), 30, 600e3)) return fail(req, res, 429, 'too many requests');
        const b = await readJSON(req, 8 * 1024);
        const answer = ANSWERS.includes(b.answer) ? b.answer : '';
        const name = line(b.name, 120);
        // Rate limit before parsing (cheap rejection), validation after: an invalid reply still costs a token.
        if (!answer || !name) return fail(req, res, 400, 'name and answer required');
        const list = repliesOf(id);
        if (list.length >= 3000) return fail(req, res, 409, 'reply limit reached');
        const yes = answer === 'yes';
        // Plus-ones, menu and diet are kept only for "yes": a "no" with plus-ones would inflate seat counts.
        const r = { id: random(10), at: new Date().toISOString(), guest: line(b.guest, 24).replace(/[^\w-]/g, ''), name, answer,
          plus: yes ? Math.max(0, Math.min(9, Math.floor(+b.plus) || 0)) : 0, menu: yes ? line(b.menu, 80) : '', diet: yes ? line(b.diet, 200) : '', msg: text(b.msg, 1000), lang: line(b.lang, 5) };
        list.push(r);
        storage.write('replies:' + id, list);
        return send(req, res, 201, { ok: true, id: r.id });
      }
      if (parts[2] === 'counts' && parts.length === 3 && req.method === 'GET') {
        if (!ev.live) return fail(req, res, 404, 'live counts are off');
        // The latest answer of each guest (or name) counts once: guests may change their mind; replies are appended,
        // never edited, so the last one per key wins. Name keys are lower-cased; guest-link ids are exact.
        const last = new Map();
        for (const r of repliesOf(id)) last.set(r.guest || 'n:' + r.name.toLowerCase(), r);
        const c = { yes: 0, maybe: 0, no: 0, seats: 0 };
        for (const r of last.values()) { c[r.answer]++; if (r.answer === 'yes') c.seats += 1 + r.plus; }
        return send(req, res, 200, c);
      }
      if (parts[2] === 'replies') {
        if (!owner(req, ev)) return fail(req, res, 401, 'owner token required');
        if (parts.length === 3 && req.method === 'GET') {
          const list = repliesOf(id);
          if (url.searchParams.get('format') === 'csv') {
            const cols = ['at', 'guest', 'name', 'answer', 'plus', 'menu', 'diet', 'msg', 'lang'];
            // '﻿' BOM first: Excel opens BOM-less UTF-8 CSV as the local code page and mangles non-Latin names. CRLF
            // line ends per RFC 4180.
            return send(req, res, 200, '﻿' + [cols.join(','), ...list.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\r\n') + '\r\n', 'text/csv; charset=utf-8');
          }
          return send(req, res, 200, { replies: list });
        }
        if (parts.length === 4 && req.method === 'DELETE') {
          const list = repliesOf(id), n = list.length;
          storage.write('replies:' + id, list.filter((r) => r.id !== parts[3]));
          // `removed` re-reads storage, so it reports what was actually deleted (0 for an unknown reply id).
          return send(req, res, 200, { ok: true, removed: n - repliesOf(id).length });
        }
      }
      return fail(req, res, 405, 'method not allowed');
    } catch (e) {
      // Only expected errors (with status) become JSON answers; anything else propagates so the host logs a real 500.
      if (e && e.status) return fail(req, res, e.status, e.message);
      throw e;
    }
  }
  return { handle };
}
