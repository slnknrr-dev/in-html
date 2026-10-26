// battleship-game/backend.js - the server side of online play (BACKEND targets and the development server): rooms of
// the Sea Battle game definition with passwords, invite links, server-side bots, spectators and chat (rooms/server.js).
// The fleets stay on the server; every seat and spectator receives only its own view.
import { createRoomService } from '../rooms/server.js';
import { game } from '../battleship/game.js';

export default function backend() {
  return createRoomService({ games: { [game.id]: game } });
}
