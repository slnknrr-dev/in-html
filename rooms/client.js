// rooms/client.js - the client of rooms/server.js (browser or Node 18+), plus local rooms (rooms/local.js) behind the
// same Room interface. Offline artifacts get rooms/client.offline.js instead (bundle.js variant): the same exports
// without any network code.
//
//   const server = connect('https://games.example.org')     // the server's origin; '' = this page's origin
//   await server.info() / server.list(gameId)
//   const { roomId, invite, token, seat } = await server.create({ game, name, player, settings, seats, password?, bots?, random? })
//   const { token, seat } = await server.join(roomId, { player, password?, invite?, spectate? })
//   const room = server.open(roomId, token)    // Room: { id, seat, status, view, players, settings, result,
//                                              //   on(type, fn) -> off, act(action), start(), chat(text),
//                                              //   setSettings(settings), addBot(kind, options, seat), leave() }
//   inviteLink(pageUrl, serverUrl, roomId, invite) -> page#room=…&server=…&invite=…;  parseInvite(location) -> { … } | null
// Room events: 'view', 'event', 'players', 'status', 'settings', 'chat', 'error', 'connection' ('connecting' | 'open' |
// 'retrying' | 'closed'). The event stream is read with fetch (works from file:// pages and in Node) and reconnects
// with backoff; every reconnection starts with the full state.
//
// Why fetch + a hand-written SSE reader instead of EventSource: EventSource cannot send an Authorization header
// (the token would have to go in the URL, where it leaks into logs and history), does not exist in Node, and gives
// no control over reconnect backoff. Every (re)connection starts with a full 'hello' snapshot, so missed events
// during a disconnect never leave the client in an inconsistent state.

import { emitter } from './core.js';

export { localRoom } from './local.js';
export const networked = true;

class RoomsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function connect(serverUrl = '', { fetchImpl = globalThis.fetch } = {}) {
  const base = String(serverUrl || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/+$/, '') + '/api';
  async function call(method, path, body, token) {
    const res = await fetchImpl(base + path, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw new RoomsError(res.status, (data && data.error) || res.statusText || 'request failed');
    return data;
  }
  return {
    url: base.slice(0, -4),
    info: () => call('GET', '/info'),
    list: (game) => call('GET', '/rooms' + (game ? `?game=${encodeURIComponent(game)}` : '')),
    create: (opts) => call('POST', '/rooms', opts),
    join: (roomId, opts = {}) => call('POST', `/rooms/${encodeURIComponent(roomId)}/join`, opts),
    open: (roomId, token) => openRoom(base, roomId, token, call, fetchImpl),
  };
}

function openRoom(base, roomId, token, call, fetchImpl) {
  const em = emitter();
  const room = { id: roomId, seat: null, status: 'connecting', view: null, players: [], settings: {}, result: null, chatLog: [], on: em.on, info: null };
  let closed = false, controller = null, delay = 1000;
  // Room methods resolve with { ok: false, error } instead of rejecting: game UIs treat a refused action like an
  // illegal move, not an exception.
  const post = (what, body) => call('POST', `/rooms/${encodeURIComponent(roomId)}/${what}`, body || {}, token).catch((e) => ({ ok: false, error: e.message }));
  room.act = (action) => post('action', { action });
  room.start = () => post('start');
  room.chat = (text) => post('chat', { text });
  room.setSettings = (settings) => post('settings', { settings });
  room.addBot = (kind, options = {}, seat = null) => post('bots', { kind, options, seat });
  room.leave = () => { closed = true; if (controller) controller.abort(); em.emit('connection', 'closed'); return post('leave'); };

  function dispatch(type, data) {
    if (type === 'hello') {
      room.info = data.room; room.seat = data.seat; room.players = data.players; room.view = data.view; room.settings = data.settings;
      room.status = data.room.status; room.result = data.result; room.chatLog = data.chat || [];
      em.emit('players', data.players); em.emit('settings', data.settings); em.emit('status', { status: room.status, result: room.result });
      em.emit('view', data.view);
    } else if (type === 'view') { room.view = data.view; em.emit('view', data.view); }
    else if (type === 'players') { room.players = data; em.emit('players', data); }
    else if (type === 'status') { room.status = data.status; room.result = data.result || null; em.emit('status', data); }
    else if (type === 'settings') { room.settings = data; em.emit('settings', data); }
    else if (type === 'chat') { room.chatLog.push(data); em.emit('chat', data); }
    else em.emit(type, data);
  }

  async function run() {
    while (!closed) {
      controller = new AbortController();
      em.emit('connection', 'connecting');
      try {
        const res = await fetchImpl(`${base}/rooms/${encodeURIComponent(roomId)}/events`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: controller.signal });
        if (res.status === 401 || res.status === 404) { em.emit('error', { message: res.status === 404 ? 'room closed' : 'not in this room' }); closed = true; break; }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        em.emit('connection', 'open');
        delay = 1000;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          // Minimal SSE framing: blocks separated by a blank line, 'event:' and 'data:' fields. Two simplifications
          // relative to the spec: CRLF line ends are not recognised, and several data lines are concatenated without
          // the '\n' the spec inserts. Both are fine for rooms/server.js, which writes LF and one data line of JSON.
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let type = 'message', data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) type = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
            }
            if (data) { try { dispatch(type, JSON.parse(data)); } catch (e) { em.emit('error', { message: e.message }); } }
          }
        }
      } catch (e) {
        if (closed) break;
        em.emit('error', { message: e.message });
      }
      if (closed) break;
      em.emit('connection', 'retrying');
      await new Promise((r) => setTimeout(r, delay));
      // Exponential backoff capped at 15 s, reset to 1 s after a successful connection: a restarting server is not
      // hammered, and a short network blip recovers quickly.
      delay = Math.min(delay * 2, 15000);
    }
  }
  run();
  return room;
}

// Parameters go in the fragment, not the query: the fragment is never sent to the page's host, so the invite token
// stays out of server logs and Referer headers.
export function inviteLink(pageUrl, serverUrl, roomId, invite) {
  const p = String(pageUrl).split('#')[0];
  const q = new URLSearchParams({ room: roomId, ...(serverUrl ? { server: serverUrl } : {}), ...(invite ? { invite } : {}) });
  return `${p}#${q}`;
}

export function parseInvite(loc = typeof location !== 'undefined' ? location : null) {
  if (!loc || !loc.hash) return null;
  const q = new URLSearchParams(loc.hash.slice(1));
  const room = q.get('room');
  return room ? { room, server: q.get('server') || '', invite: q.get('invite') || '' } : null;
}
