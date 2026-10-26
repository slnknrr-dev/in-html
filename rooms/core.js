// rooms/core.js - one game room, independent of transport: seats (humans and bots), the lobby, starting, actions
// validated by the game definition, per-seat views, private / public events, bots and chat. The server
// (rooms/server.js) and the local room (rooms/local.js) both run their rooms on it, so a game behaves the same
// online and offline.
//
// Game definition (pure: runs in browsers and in Node):
//   { id, version, seats: { min, max } | (settings) => { min, max },
//     create(settings, rng) -> state                     settings.players = number of seats
//     act(state, seat, action, rng) -> { state, events?, error? }   on error the state must stay unchanged
//     view(state, seat) -> what the seat may see         seat -1 = spectator
//     result(state) -> null | { ... }                    non-null ends the game
//     bot?: { kinds: [{ id, ... }], create(kind, options) -> (view, seat, rng) -> action | null } }
// An event is { type, ..., to?: seat | seat[] } (private when `to` is given).
//
// Architecture: RoomCore is the single authority over game state; transports only translate. It never sends
// anything itself, it calls notify(kind, data) and lets the host decide who receives what. Hidden information is
// enforced by game.view(state, seat): clients only ever receive views, never the raw state, so a modified client
// cannot read other hands.
// Randomness is injected (rng), never Math.random, so a seeded room replays identically (tests, bug reports).

import { makeRandom } from '../prng/prng.js';

export const seatRange = (game, settings) => (typeof game.seats === 'function' ? game.seats(settings || {}) : game.seats || { min: 1, max: 1 });

export class RoomCore {
  // options: { game, settings, seats (count), random: { kind, seed }, botDelay, schedule(fn, ms), notify(kind, data) }
  constructor({ game, settings = {}, seats, random, botDelay = 500, schedule = (fn, ms) => setTimeout(fn, ms), notify = () => {}, lateJoin = false }) {
    const range = seatRange(game, settings);
    this.game = game;
    this.settings = settings;
    this.count = Math.max(range.min, Math.min(range.max, seats || range.max));
    this.seats = Array.from({ length: this.count }, () => null); // { name, bot?, token?, connected }
    this.random = random || { kind: 'crypto' };
    this.rng = makeRandom(this.random);
    this.botRng = this.rng.fork('bots'); // bots draw from their own stream: a seeded game replays the same deal
    this.games = 0;
    this.status = 'lobby';
    this.state = null;
    this.result = null;
    this.version = 0;
    this.botDelay = botDelay;
    this.schedule = schedule;
    this.notify = notify;
    this.lateJoin = lateJoin;
    this.botTimer = null;
    this.botTurn = -1;
    this.chatLog = [];
  }

  filled() { return this.seats.filter(Boolean).length; }
  free() { return this.seats.findIndex((s) => !s); }

  // Public list of seats: [{ seat, name, bot, connected }].
  players() {
    return this.seats.map((s, seat) => (s ? { seat, name: s.name, bot: s.bot ? s.bot.kind : null, connected: !!(s.bot || s.connected) } : { seat, name: null, bot: null, connected: false }));
  }

  // Takes a seat (or the first free one): -> seat | -1 when full.
  sit({ name = 'Player', seat = null, bot = null, token = null } = {}) {
    const at = seat !== null && seat >= 0 && seat < this.count && !this.seats[seat] ? seat : this.free();
    if (at < 0) return -1;
    if (this.status !== 'lobby' && !this.lateJoin && !bot) return -1;
    let fn = null;
    if (bot) {
      if (!this.game.bot) throw new Error('this game has no bots');
      fn = this.game.bot.create(bot.kind, bot.options || {});
    }
    this.seats[at] = { name: String(name).slice(0, 40), bot: bot ? { kind: bot.kind, options: bot.options || {}, fn } : null, token, connected: !bot };
    this.notify('players', this.players());
    if (this.status === 'playing') this.scheduleBots();
    return at;
  }

  leave(seat) {
    if (!this.seats[seat]) return;
    if (this.status === 'lobby') this.seats[seat] = null;
    else this.seats[seat].connected = false;
    this.notify('players', this.players());
  }

  setSettings(settings) {
    if (this.status === 'playing') throw new Error('the game is running');
    this.settings = { ...this.settings, ...settings };
    this.notify('settings', this.settings);
  }

  start() {
    const range = seatRange(this.game, this.settings);
    if (this.filled() < range.min) throw new Error(`at least ${range.min} players are needed`);
    // A rematch with a seed gets the next deterministic stream (seed, seed/1, seed/2, ...).
    if (this.games++ > 0) this.rng = this.random.kind === 'seeded' ? makeRandom({ kind: 'seeded', seed: `${this.random.seed}/${this.games - 1}` }) : makeRandom(this.random);
    this.botRng = this.rng.fork('bots');
    this.state = this.game.create({ ...this.settings, players: this.count, names: this.seats.map((s) => (s ? s.name : null)) }, this.rng);
    this.status = 'playing';
    this.result = null;
    this.version++;
    this.notify('status', { status: this.status });
    this.notify('views');
    this.scheduleBots();
  }

  // An action of a seat: { ok, error? }.
  // Validation lives in the game: act() must return an error without mutating state. Exceptions from game code are
  // caught and reported as an error result, so one buggy rule cannot take down the server process.
  act(seat, action) {
    if (this.status !== 'playing') return { ok: false, error: 'not playing' };
    if (seat < 0 || !this.seats[seat]) return { ok: false, error: 'not seated' };
    let r;
    try { r = this.game.act(this.state, seat, action, this.rng); } catch (e) { return { ok: false, error: e.message }; }
    if (!r || r.error) return { ok: false, error: (r && r.error) || 'illegal action' };
    this.state = r.state;
    this.version++;
    for (const ev of r.events || []) this.notify('event', ev);
    this.notify('views');
    const res = this.game.result ? this.game.result(this.state) : null;
    if (res) {
      this.status = 'over';
      this.result = res;
      this.notify('status', { status: this.status, result: res });
    } else this.scheduleBots();
    return { ok: true };
  }

  view(seat) { return this.state ? this.game.view(this.state, seat) : null; }

  // Replaces the game state (take-backs of local practice games): the views follow and the bots go on from there.
  replaceState(state) {
    if (!state) return;
    const res = this.game.result ? this.game.result(state) : null;
    this.state = state;
    this.status = res ? 'over' : 'playing';
    this.result = res || null;
    this.version++;
    this.notify('status', { status: this.status, result: this.result });
    this.notify('views');
    if (!res) this.scheduleBots();
  }

  // Bots act one at a time after a short delay, so that people can follow the game.
  // A single pending timer at a time (botTimer guard): many triggers in one tick collapse into one bot move, and the
  // move itself calls act(), which re-schedules. This serialises bots and gives humans time to see each move.
  scheduleBots() {
    if (this.botTimer || this.status !== 'playing' || !this.seats.some((s) => s && s.bot)) return;
    this.botTimer = this.schedule(() => {
      this.botTimer = null;
      if (this.status !== 'playing') return;
      // Bots take turns: the search starts after the bot that acted last, so a bot that always has something to do
      // (moving a cursor while it thinks) cannot starve the others.
      for (let k = 1; k <= this.count; k++) {
        const seat = (this.botTurn + k) % this.count;
        const s = this.seats[seat];
        if (!s || !s.bot) continue;
        let action = null;
        try { action = s.bot.fn(this.view(seat), seat, this.botRng); } catch (e) { this.notify('error', { seat, message: e.message }); }
        if (action == null) continue;
        this.botTurn = seat;
        const r = this.act(seat, action);
        if (!r.ok) this.notify('error', { seat, message: `bot ${s.bot.kind}: ${r.error}` });
        return; // act() schedules the next bot move
      }
    }, this.botDelay);
  }

  chat(seat, text) {
    const s = this.seats[seat];
    const msg = { seat, name: s ? s.name : 'spectator', text: String(text).slice(0, 500), at: Date.now() };
    this.chatLog.push(msg);
    if (this.chatLog.length > 100) this.chatLog.shift();
    this.notify('chat', msg);
  }

  // Events visible to a seat.
  static visible(ev, seat) {
    if (ev.to === undefined || ev.to === null) return true;
    return Array.isArray(ev.to) ? ev.to.includes(seat) : ev.to === seat;
  }

  // KNOWN DEFECT: clears with the global clearTimeout even when a custom `schedule` was injected (e.g. a fake clock
  // in tests or a different scheduler); its handle may not be a timeout id. Fix: accept a matching `cancel` option.
  dispose() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }
}

// A tiny event emitter for rooms: on(type, fn) -> off(); emit(type, data).
// Listener exceptions are caught and logged so one faulty UI handler cannot stop delivery to the others. '*'
// receives every event (logging, relays).
export function emitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type).delete(fn);
    },
    emit(type, data) {
      for (const fn of map.get(type) || []) { try { fn(data); } catch (e) { console.error(e); } }
      for (const fn of map.get('*') || []) { try { fn(type, data); } catch (e) { console.error(e); } }
    },
  };
}
