// funding-studio/server-util.js - small helpers of the backend (no node: imports; the backend gets Node modules
// through hosting.js ctx.node): JSON responses, bounded request bodies, CORS, rate limits, tokens, ids, URL checks.

// Security headers on every response: no-store (ledger and admin data must never sit in a shared cache or the
// browser's back/forward cache), nosniff (JSON is never sniffed as HTML/script), no-referrer (donation ids in URLs do
// not leak to third parties). CORS is '*' without credentials: published pages may live on any static host and only
// call public endpoints; admin endpoints authenticate with a Bearer token, never cookies, so a wildcard origin cannot
// be abused for CSRF. Max-Age 600 caches the preflight for 10 minutes.
export const SEC_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' };

// Content-Length from the encoded bytes, not string length: multi-byte UTF-8 (Georgian, Cyrillic) would be truncated.
export function send(res, status, body, type, extra = {}) {
  const data = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': data.length, ...SEC_HEADERS, ...extra });
  res.end(data);
}
export const json = (res, status, v, extra = {}) => send(res, status, JSON.stringify(v), 'application/json; charset=utf-8', extra);
export const redirect = (res, to) => { res.writeHead(302, { Location: to, ...SEC_HEADERS }); res.end(); };

// Raw body (Uint8Array) up to `limit` bytes; rejects with .status 413 beyond.
// Counted while streaming and the socket destroyed at the limit: trusting Content-Length would let a client lie and
// stream gigabytes into memory. Raw bytes (not text) because webhook signatures (Stripe) are computed over the exact
// bytes received; re-serialising parsed JSON would break verification.
export function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const out = new Uint8Array(size);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      resolve(out);
    });
    req.on('error', reject);
  });
}

export async function readJSON(req, limit) {
  const raw = await readBody(req, limit);
  try { return JSON.parse(new TextDecoder().decode(raw)); } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); }
}

// CSPRNG id (Web Crypto, available in Node 19+ as globalThis.crypto). 16 chars of 36 symbols ~ 82 bits.
// Note: b % 36 has a slight modulo bias (256 = 7 x 36 + 4, so the first 4 symbols are ~14 % more likely); it lowers
// entropy marginally and is acceptable for ids, but rejection sampling would remove it for secrets.
export function randomId(n = 16, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}

// Constant-time comparison for tokens: XOR-accumulate over every character instead of returning at the first
// mismatch, so response timing does not reveal how many leading characters were right. Length is compared first and
// does leak (acceptable: token lengths are not secret). Empty secrets never match, so an unset token cannot be
// "guessed" by sending an empty header.
export function sameSecret(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const bearer = (req) => { const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || '')); return m ? m[1].trim() : ''; };

// The socket peer, deliberately not X-Forwarded-For (client-controlled, would let anyone dodge rate limits). Behind a
// reverse proxy every client shares the proxy's IP, so limits become global - the safe failure direction.
// '::ffff:' strips the IPv4-mapped IPv6 prefix so one client has one key.
export function clientIP(req) {
  return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}

// Token buckets per key: allow(key) -> bool.
// Each bucket refills continuously at capacity per windowMs (lazy refill computed on access, no timers) and a request
// costs one token: bursts up to `capacity`, sustained rate capacity/window. Memory bound: past 5000 keys, idle
// buckets (untouched for a full window, i.e. full again) are swept.
// Caveat: if more than 5000 keys are all active, the sweep frees nothing and runs O(n) on every call.
export function rateLimiter(capacity, windowMs) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: capacity, at: now }; buckets.set(key, b); }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / windowMs) * capacity);
    b.at = now;
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.at > windowMs) buckets.delete(k);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

// The public base URL of this server as the browser sees it ('https://host/prefix/').
// A configured base always wins. Otherwise it trusts X-Forwarded-Proto/-Host (first value), needed behind proxies.
// KNOWN DEFECT (risk): without a configured base, any client can set X-Forwarded-Host / Host, and URLs derived from
// this (return/cancel URLs sent to payment providers, receipt links) would point at the attacker's host. Fix: honour
// forwarded headers only from a configured trusted proxy, or require the public base in settings for production.
export function publicBase(req, prefix, configured) {
  if (configured) return configured.replace(/\/*$/, '/');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}${prefix}`;
}

export const originOf = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.origin : ''; } catch { return ''; } };

// Appends query parameters before the fragment ('page.html#/thanks' -> 'page.html?d=…#/thanks').
export function withQuery(url, params) {
  const s = String(url);
  const i = s.indexOf('#');
  const head = i < 0 ? s : s.slice(0, i);
  const frag = i < 0 ? '' : s.slice(i);
  try {
    const u = new URL(head);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.href + frag;
  } catch { return s; }
}

// Single-line text for stored donor fields: control characters (incl. CR/LF, which enable header/log/CSV injection)
// collapse to a space, then trim and cap at n characters.
export const line = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
export const emailOK = (v) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(String(v || '')) && String(v).length <= 254;

// CSV of flat rows; cells a spreadsheet would run as formulas get a leading apostrophe.
// Donor names and messages are attacker-controlled, so =HYPERLINK(...) in a message must not execute when the owner
// opens the export (OWASP CSV injection). Quoting also triggers on ';' because European Excel uses it as delimiter.
// CRLF line ends per RFC 4180.
export function toCSV(rows, cols) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}
