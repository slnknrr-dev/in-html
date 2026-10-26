// rooms/local.js - a room in the page, without any network: the same Room interface as an online room, for offline
// play against bots or hot-seat play on one device.
//
//   localRoom(game, settings, { random, seats, seat = 0, names, bots: [{ seat, kind, options }], botDelay, start = true })
//     -> Room { id, seat, local: true, status, view, players, settings, on(type, fn) -> off, act(action, asSeat?),
//               start(), chat(text), setSettings(settings), viewOf(seat), leave() }
// Events: 'view' (this seat's view changed), 'event' (game events visible to the seat), 'players', 'status',
// 'settings', 'chat', 'error'. `act(action, asSeat)` lets a hot-seat interface play for any human seat.

import { RoomCore, emitter } from './core.js';

let counter = 0;

// Offline adapter: the same RoomCore with notify() mapped to local events, and every method returning a Promise so
// UI code is identical for local and networked rooms (it always awaits).
export function localRoom(game, settings = {}, { random, seats, seat = 0, names = [], bots = [], botDelay = 500, start = true, lateJoin = false } = {}) {
  const em = emitter();
  const room = {
    id: `local-${++counter}`, seat, local: true, status: 'lobby', view: null, players: [], settings, result: null,
    on: em.on,
  };
  const core = new RoomCore({
    game, settings, seats, random, botDelay, lateJoin,
    notify(kind, data) {
      if (kind === 'views') {
        room.view = core.view(room.seat);
        em.emit('view', room.view);
      } else if (kind === 'event') {
        if (RoomCore.visible(data, room.seat)) em.emit('event', data);
      } else if (kind === 'players') {
        room.players = data;
        em.emit('players', data);
      } else if (kind === 'status') {
        room.status = data.status;
        room.result = data.result || null;
        em.emit('status', data);
      } else if (kind === 'settings') {
        room.settings = data;
        em.emit('settings', data);
      } else em.emit(kind, data);
    },
  });
  const botSeats = new Map(bots.map((b) => [b.seat, b]));
  for (let i = 0; i < core.count; i++) {
    if (botSeats.has(i)) core.sit({ seat: i, name: names[i] || botSeats.get(i).name || botSeats.get(i).kind, bot: botSeats.get(i) });
    else core.sit({ seat: i, name: names[i] || `Player ${i + 1}` });
  }
  room.act = (action, asSeat = room.seat) => Promise.resolve(core.act(asSeat, action));
  room.start = () => { try { core.start(); return Promise.resolve({ ok: true }); } catch (e) { return Promise.resolve({ ok: false, error: e.message }); } };
  room.chat = (text) => { core.chat(room.seat, text); return Promise.resolve({ ok: true }); };
  room.setSettings = (s) => { try { core.setSettings(s); return Promise.resolve({ ok: true }); } catch (e) { return Promise.resolve({ ok: false, error: e.message }); } };
  room.viewOf = (s) => core.view(s);
  room.leave = () => { core.dispose(); room.status = 'closed'; em.emit('status', { status: 'closed' }); };
  room.core = core; // for tests and replays
  room.players = core.players();
  if (start) room.start();
  return room;
}
