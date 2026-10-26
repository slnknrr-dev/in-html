# rooms/

Multiplayer rooms for the games: one game definition runs locally (offline play with bots, hot seat) and on a server
(rooms with passwords and invite links, seats for people and bots, spectators, chat), behind the same `Room`
interface. No dependencies; the server needs Node ≥ 18, the client any browser or Node ≥ 18.

| file | contents |
| --- | --- |
| `core.js` | `RoomCore` (seats, lobby, start / rematch, actions, per-seat views, private events, bots, chat, `replaceState` for take-backs of local games), `seatRange`, `emitter` |
| `local.js` | `localRoom(game, settings, options)` — a room in the page, no network |
| `client.js` | `connect(serverUrl)` (HTTP + Server-Sent Events read with fetch), `localRoom`, `inviteLink`, `parseInvite`, `networked = true` |
| `client.offline.js` | the same exports without network code (`networked = false`): offline artifacts get it through the bundle.js variant |
| `server.js` | `createRoomService({ games, … })` → `{ handle(req, res, url), rooms, close() }` |
| `test.js` | `node rooms/test.js`: local rooms, a real HTTP server with clients, and the NOTICE build targets with their generated servers |

## Game definition

Pure code that runs in browsers and in Node:

```js
export const game = {
  id: 'race', version: 1,
  seats: { min: 2, max: 4 },                              // or (settings) => ({ min, max })
  create(settings, rng) { return state; },                // settings.players = number of seats, settings.names
  act(state, seat, action, rng) { return { state, events, error }; },  // on error the state stays unchanged
  view(state, seat) { return whatThisSeatMaySee; },      // seat -1 = spectator: hide other hands here
  result(state) { return null || { winner } },          // non-null ends the game
  bot: { kinds: [{ id: 'random' }], create(kind, options) { return (view, seat, rng) => action || null; } },
};
```

Events are `{ type, …, to? }`; with `to` (a seat or a list) only those seats receive them. `rng` comes from `prng/`:
a room created with `random: { kind: 'seeded', seed }` replays the same game (rematches use `seed/1`, `seed/2`, …), bots
draw from their own stream; otherwise the CSPRNG is used.

## Room interface

`localRoom(game, settings, { seats, seat, names, bots: [{ seat, kind, options }], random, botDelay })` and
`connect(url).open(roomId, token)` both return a `Room`: `id`, `seat`, `status` ('lobby' | 'playing' | 'over'),
`view`, `players`, `settings`, `result`, `on(type, fn) → off` for 'view', 'event', 'players', 'status', 'settings',
'chat', 'error' (and 'connection' online), `act(action)`, `start()`, `chat(text)`, `setSettings(settings)`, `leave()`;
online rooms also `addBot(kind, options, seat)`. A local room plays any human seat with `act(action, seat)`.

## Server API

`createRoomService({ games: { [id]: game }, prefix: '/api', maxRooms, maxBody, idleMinutes, maxHours, botDelay, rate })`.
JSON over HTTP, the player token in `Authorization: Bearer …`:

| request | answer |
| --- | --- |
| `GET /api/info` | `{ service, version, games: [{ id, version, seats, bots }] }` |
| `GET /api/rooms?game=` | public rooms (rooms with a password are not listed) |
| `POST /api/rooms` `{ game, name, player, settings, seats, password?, public?, random?, bots?, lateJoin? }` | `{ roomId, invite, token, seat: 0 }`; the creator owns the room |
| `POST /api/rooms/<id>/join` `{ player, password? \| invite?, spectate? }` | `{ token, seat }` (an invite skips the password; seat -1 = spectator) |
| `GET /api/rooms/<id>/events` | `text/event-stream`: `hello` (full state), `view`, `event`, `players`, `status`, `settings`, `chat` |
| `POST /api/rooms/<id>/action` `{ action }` | `{ ok, error? }` |
| `POST /api/rooms/<id>/start` · `leave` · `chat {text}` · `settings {settings}` · `bots {kind, options, seat}` | owner-only where it matters |

Passwords are stored as PBKDF2-SHA-256 hashes (120 000 iterations, Web Crypto); tokens and invites are random
(crypto.getRandomValues). Rooms live in memory and expire after `idleMinutes` without a connection or `maxHours`;
requests are limited per address (`rate` per minute). Room settings carry assets such as skins (up to `maxBody`), so
every player sees the same look. CORS allows every origin, so standalone pages opened from file:// (Origin: null) and
pages on other hosts (itch.io) can play; there are no cookies, only bearer tokens.

## Artifacts

An application with a backend provides `<app>/backend.js`:

```js
import { createRoomService } from '../rooms/server.js';
import { game } from '../sudoku/game.js';
export default function backend(ctx) { return createRoomService({ games: { [game.id]: game } }); }
```

`BACKEND_NOTICE.md` / `SINGLEFILE_BACKEND_NOTICE.md` (targets.js) bundle it with the server (hosting.js); the
development server (`node <app>/server.js`) mounts it too. Pages read `globalThis.IN_HTML_ARTIFACT.mode`:
`offline` (only local rooms — the offline client has no network code), `serverless` / `standalone` (local, or connect
to a server the user enters; `servers` lists presets), `backend` (the page's own origin is the server).
