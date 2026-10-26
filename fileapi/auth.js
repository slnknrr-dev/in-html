// fileapi/auth.js - authorization of file API requests. An authorize function answers
// (req, scope, url, info) -> true | false | 'unauthenticated' for scope 'read' | 'write' | 'owner'; the handler turns
// 'unauthenticated' into 401 and false into 403. `info` = { op } names the endpoint ('info', 'mounts', 'grant',
// 'list', 'stat', 'raw', 'thumb', 'watch').
//
//   tokenAuth({ owner, readers = [], writers = [], queryToken = true }) -> authorize
//       The token comes from `Authorization: Bearer <t>`, or - for GET / HEAD of raw/ and thumb/ only, when
//       queryToken is on - from the query parameter `t` (media elements and <img> cannot send headers). The owner
//       token has every scope, writer tokens read + write, reader tokens read. Tokens are compared in constant time
//       against every configured token. No token -> 'unauthenticated'; a wrong token or a missing scope -> false.
//   openAuth() -> authorize that allows everything (the caller authenticated the request already, e.g. inside
//       Electron where only the application's own window reaches the server)
//   newToken(bytes = 24) -> URL-safe random string (base64url of globalThis.crypto.getRandomValues bytes)
//   bearerToken(req) -> the Bearer token of a Node request ('' when none)
//   sameToken(a, b) -> constant-time comparison of two strings (false when either is empty)

export const bearerToken = (req) => {
  const h = req && req.headers ? req.headers.authorization : '';
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(Array.isArray(h) ? h[0] : h || '');
  return m ? m[1] : '';
};

// Constant-time in the sense that matters: the loop always runs y.length iterations and accumulates differences with
// |, so the time does not reveal how many leading characters of a guess were right (the classic early-exit leak of
// ===). `i % x.length` keeps indexing in range when lengths differ; the length mismatch is folded into d first.
// y is the CONFIGURED token at the call site, so the loop count leaks only its (public-ish) length.
export function sameToken(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (!x || !y) return false;
  let d = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) d |= x.charCodeAt(i % x.length) ^ y.charCodeAt(i);
  return d === 0;
}

const QUERY_OPS = new Set(['raw', 'thumb']);

function opOf(url, info) {
  if (info && info.op) return info.op;
  // Without the handler's info: guess from the path (…/raw/<m>/… or …/thumb/<m>/…).
  const m = url && /\/(raw|thumb)\/[^/]+(\/|$)/.exec(String(url.pathname || ''));
  return m ? m[1] : '';
}

// Levels as integers (1 read < 2 write < 3 owner) make "has at least scope X" a single comparison; an unknown scope
// demands owner (deny-by-default). The query-token path is limited to safe methods on media endpoints because a
// token in a URL ends up in history, server logs and Referer headers - acceptable for <img>/<video> reads, never for
// writes. Prefer reader tokens for URLs that get embedded.
export function tokenAuth({ owner = '', readers = [], writers = [], queryToken = true } = {}) {
  const list = [];
  if (owner) list.push([String(owner), 3]);
  for (const t of writers || []) if (t) list.push([String(t), 2]);
  for (const t of readers || []) if (t) list.push([String(t), 1]);
  const need = { read: 1, write: 2, owner: 3 };
  return (req, scope, url, info) => {
    let token = bearerToken(req);
    if (!token && queryToken && (req.method === 'GET' || req.method === 'HEAD') && QUERY_OPS.has(opOf(url, info))) {
      token = (url && url.searchParams && url.searchParams.get('t')) || '';
    }
    if (!token) return 'unauthenticated';
    let level = 0;
    for (const [t, l] of list) if (sameToken(token, t) && l > level) level = l; // no early exit: same work for every token
    return level >= (need[scope] || 3);
  };
}

export const openAuth = () => () => true;

// CSPRNG bytes (Web Crypto, available in Node >= 19 and browsers), minimum 8 bytes = 64 bits; the default 24 bytes
// gives 192 bits and a 32-char token. base64url so it survives URLs and headers without escaping.
export function newToken(bytes = 24) {
  const b = new Uint8Array(Math.max(8, bytes | 0));
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
