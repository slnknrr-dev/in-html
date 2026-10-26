// rooms/server.js - multiplayer rooms over HTTP for Node >= 18 (no dependencies, no node: imports: it only uses the
// req / res objects it is given and Web Crypto): rooms with optional passwords and invite tokens, seats for people and
// server-side bots, an authoritative game (rooms/core.js), per-seat views over Server-Sent Events, chat, room expiry,
// a simple rate limit and CORS for every origin (pages opened from file:// send "Origin: null").
//
//   createRoomService({ games: { [id]: game }, prefix = '/api', maxRooms = 500, maxBody = 4 MB, idleMinutes = 30,
//                       maxHours = 12, botDelay = 600, rate = 300 }) -> { handle(req, res, url) -> Promise<boolean>,
//                       rooms, close() }
//
// HTTP API (JSON; the player token goes in "Authorization: Bearer <token>"):
//   GET  /api/info                         { service, version, games: [{ id, version, seats, bots }] }
//   GET  /api/rooms?game=<id>              public rooms: [{ id, game, name, seats, players, open, locked, status }]
//   POST /api/rooms                        { game, name, player, settings, seats, password?, public?, random?, bots?, lateJoin? }
//                                          -> { roomId, invite, token, seat: 0 }   (the creator owns the room)
//   POST /api/rooms/<id>/join              { player, password? | invite?, spectate? } -> { token, seat } (seat -1: spectator)
//   GET  /api/rooms/<id>/events            text/event-stream: hello, view, event, players, status, settings, chat
//   POST /api/rooms/<id>/action            { action } -> { ok, error? }
//   POST /api/rooms/<id>/start | leave     owner starts (or restarts after the end); anyone leaves
//   POST /api/rooms/<id>/chat              { text }
//   POST /api/rooms/<id>/settings          { settings } (owner, not while playing): skins and other assets travel here
//   POST /api/rooms/<id>/bots              { seat?, kind, options? } (owner, in the lobby)
//
// Security model: room ids and invite / player tokens are random (Web Crypto), passwords are stored as PBKDF2
// hashes and compared in constant time, request bodies are size-capped, and every room expires. CORS allows any
// origin on purpose: auth is by bearer token, not cookies, so a foreign page gains nothing it could not already do
// with the token, and pages opened from file:// must be able to connect.

import { RoomCore, seatRange } from './core.js';

const enc = new TextEncoder();
// Spread into fromCharCode is safe here: tokens are a few dozen bytes.
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 18) => b64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));

// PBKDF2-SHA256 with 120000 iterations and a per-room salt: slows offline guessing if memory is dumped. Room
// passwords are low-value, so a memory-hard KDF would cost more than it protects.
async function hashPassword(password, salt) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120000 }, key, 256);
  return new Uint8Array(bits);
}
// Constant-time comparison: the loop always runs to the end, so timing does not reveal the matching prefix length.
const sameBytes = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '600',
};

function sendJSON(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// Streams with a running size check and destroys the request past the limit, so an oversized upload is rejected
// without being buffered in full.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function createRoomService({ games, prefix = '/api', maxRooms = 500, maxBody = 4 * 1024 * 1024, idleMinutes = 30, maxHours = 12, botDelay = 600, rate = 300 } = {}) {
  const rooms = new Map();
  const hits = new Map(); // ip -> { n, t }

  // Fixed one-minute window per remote address. Behind a reverse proxy every client shares the proxy's address;
  // deploy with the limit raised or keyed on a trusted forwarded header in that case.
  function limited(req) {
    const ip = req.socket && req.socket.remoteAddress || '?';
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now - h.t > 60000) { h = { n: 0, t: now }; hits.set(ip, h); }
    return ++h.n > rate;
  }

  // The query-string fallback exists for clients that cannot set headers; such tokens can end up in access logs.
  function token(req, url) {
    const auth = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/i.exec(auth);
    return m ? m[1] : url.searchParams.get('token');
  }

  function roomOf(id) {
    const r = rooms.get(id);
    if (!r) throw new HttpError(404, 'no such room');
    r.touched = Date.now();
    return r;
  }

  function seatOf(room, req, url) {
    const t = token(req, url);
    if (!t || !room.tokens.has(t)) throw new HttpError(401, 'not in this room');
    return room.tokens.get(t);
  }

  function send(stream, type, data) {
    try { stream.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  }

  function createRoom(body) {
    const game = games[body.game];
    if (!game) throw new HttpError(400, 'unknown game');
    if (rooms.size >= maxRooms) throw new HttpError(503, 'too many rooms');
    const room = {
      id: randomToken(6), game, name: String(body.name || 'Room').slice(0, 60), public: body.public !== false && !body.password,
      invite: randomToken(12), tokens: new Map(), streams: new Set(), created: Date.now(), touched: Date.now(),
      password: null, owner: 0,
    };
    room.core = new RoomCore({
      game, settings: body.settings || {}, seats: body.seats, random: body.random && body.random.kind === 'seeded' ? { kind: 'seeded', seed: String(body.random.seed) } : { kind: 'crypto' },
      botDelay, lateJoin: !!body.lateJoin,
      notify: (kind, data) => broadcast(room, kind, data),
    });
    rooms.set(room.id, room);
    return room;
  }

  function broadcast(room, kind, data) {
    for (const s of room.streams) {
      if (kind === 'views') send(s, 'view', { view: room.core.view(s.seat), version: room.core.version });
      else if (kind === 'event') { if (RoomCore.visible(data, s.seat)) send(s, 'event', data); }
      else if (kind === 'error') { if (data && data.seat === s.seat) send(s, 'error', data); }
      else send(s, kind, data);
    }
  }

  function hello(room, seat) {
    const c = room.core;
    return {
      room: { id: room.id, game: room.game.id, name: room.name, seats: c.count, status: c.status, owner: room.owner, locked: !!room.password },
      seat, players: c.players(), view: c.view(seat), settings: c.settings, version: c.version, result: c.result, chat: c.chatLog.slice(-30),
    };
  }

  // SSE response: 'retry' tells EventSource-style clients the reconnect delay; X-Accel-Buffering disables nginx
  // buffering, which would otherwise hold events back. A comment ping every 20 s keeps proxies from closing an idle
  // connection. A seat counts as connected while at least one of its streams is open (several tabs).
  function openStream(room, seat, req, res) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const stream = { res, seat };
    room.streams.add(stream);
    const s = room.core.seats[seat];
    if (s && !s.bot && !s.connected) { s.connected = true; broadcast(room, 'players', room.core.players()); }
    send(stream, 'hello', hello(room, seat));
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      room.streams.delete(stream);
      const still = [...room.streams].some((x) => x.seat === seat);
      const st = room.core.seats[seat];
      if (st && !st.bot && !still) { st.connected = false; broadcast(room, 'players', room.core.players()); }
    });
  }

  // unref() below: the sweep timer alone must not keep a Node process alive.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, r] of rooms) {
      if ((!r.streams.size && now - r.touched > idleMinutes * 60000) || now - r.created > maxHours * 3600000) {
        for (const s of r.streams) { try { s.res.end(); } catch { /* gone */ } }
        r.core.dispose();
        rooms.delete(id);
      }
    }
    for (const [ip, h] of hits) if (now - h.t > 60000) hits.delete(ip);
  }, 60000);
  if (cleanup.unref) cleanup.unref();

  async function route(req, res, url) {
    const p = url.pathname.slice(prefix.length);
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    if (limited(req)) throw new HttpError(429, 'too many requests');
    if (req.method === 'GET' && p === '/info') {
      sendJSON(res, 200, { service: 'in-html rooms', version: 1, games: Object.values(games).map((g) => ({ id: g.id, version: g.version || 1, seats: seatRange(g, {}), bots: g.bot ? g.bot.kinds : [] })) });
      return;
    }
    if (req.method === 'GET' && p === '/rooms') {
      const game = url.searchParams.get('game');
      sendJSON(res, 200, [...rooms.values()].filter((r) => r.public && (!game || r.game.id === game)).slice(0, 200).map((r) => ({
        id: r.id, game: r.game.id, name: r.name, seats: r.core.count, players: r.core.filled(), open: r.core.free() >= 0, locked: !!r.password, status: r.core.status,
      })));
      return;
    }
    if (req.method === 'POST' && p === '/rooms') {
      const body = await readBody(req, maxBody);
      const room = createRoom(body);
      if (body.password) {
        const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
        room.password = { salt, hash: await hashPassword(body.password, salt) };
        room.public = !!body.public;
      }
      const t = randomToken();
      const seat = room.core.sit({ name: body.player || 'Host', token: t, seat: 0 });
      room.tokens.set(t, seat);
      for (const b of Array.isArray(body.bots) ? body.bots : []) room.core.sit({ seat: b.seat ?? null, name: b.name || b.kind, bot: { kind: b.kind, options: b.options || {} } });
      sendJSON(res, 200, { roomId: room.id, invite: room.invite, token: t, seat });
      return;
    }
    const m = /^\/rooms\/([A-Za-z0-9_-]+)\/(join|events|action|start|leave|chat|settings|bots)$/.exec(p);
    if (!m) throw new HttpError(404, 'not found');
    const room = roomOf(m[1]);
    const what = m[2];
    if (what === 'events' && req.method === 'GET') { openStream(room, seatOf(room, req, url), req, res); return; }
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    const body = await readBody(req, maxBody);
    if (what === 'join') {
      const known = body.token && room.tokens.has(body.token);
      if (known) { sendJSON(res, 200, { token: body.token, seat: room.tokens.get(body.token) }); return; }
      const viaInvite = body.invite && body.invite === room.invite;
      if (room.password && !viaInvite) {
        if (!body.password) throw new HttpError(403, 'password required');
        const h = await hashPassword(body.password, room.password.salt);
        if (!sameBytes(h, room.password.hash)) throw new HttpError(403, 'wrong password');
      }
      const t = randomToken();
      // A full room yields seat -1 from sit(): the joiner silently becomes a spectator rather than getting an error.
      const seat = body.spectate ? -1 : room.core.sit({ name: body.player || 'Player', token: t });
      room.tokens.set(t, seat);
      sendJSON(res, 200, { token: t, seat });
      return;
    }
    const seat = seatOf(room, req, url);
    const owner = seat === room.owner;
    if (what === 'action') { sendJSON(res, 200, room.core.act(seat, body.action)); return; }
    if (what === 'start') {
      if (!owner) throw new HttpError(403, 'only the owner starts the game');
      if (room.core.status === 'playing') throw new HttpError(409, 'already playing');
      room.core.start();
      sendJSON(res, 200, { ok: true });
      return;
    }
    if (what === 'leave') { if (seat >= 0) room.core.leave(seat); sendJSON(res, 200, { ok: true }); return; }
    if (what === 'chat') { room.core.chat(seat, body.text || ''); sendJSON(res, 200, { ok: true }); return; }
    if (what === 'settings') {
      if (!owner) throw new HttpError(403, 'only the owner changes settings');
      room.core.setSettings(body.settings || {});
      sendJSON(res, 200, { ok: true });
      return;
    }
    if (what === 'bots') {
      if (!owner || room.core.status !== 'lobby') throw new HttpError(403, 'only the owner adds bots, in the lobby');
      const at = room.core.sit({ seat: body.seat ?? null, name: body.name || body.kind, bot: { kind: body.kind, options: body.options || {} } });
      if (at < 0) throw new HttpError(409, 'no free seat');
      sendJSON(res, 200, { ok: true, seat: at });
      return;
    }
    throw new HttpError(404, 'not found');
  }

  return {
    rooms,
    async handle(req, res, url = new URL(req.url, 'http://local')) {
      if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return false;
      try { await route(req, res, url); } catch (e) {
        const status = e instanceof HttpError ? e.status : 400;
        if (!res.headersSent) sendJSON(res, status, { ok: false, error: e.message });
      }
      return true;
    },
    close() {
      clearInterval(cleanup);
      for (const r of rooms.values()) { for (const s of r.streams) { try { s.res.end(); } catch { /* gone */ } } r.core.dispose(); }
      rooms.clear();
    },
  };
}
