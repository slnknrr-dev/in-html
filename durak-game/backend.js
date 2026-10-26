// durak-game/backend.js - the server side of online play (BACKEND targets and the development server): rooms of the
// Durak game definition with passwords, invite links, server-side bots, spectators and chat (rooms/server.js).
//
// The app contributes only the game definition; the generic room service owns transport, seats and persistence. The
// same durak/game.js runs in the browser and here, so the server validates every move with the exact rules the client
// renders: a modified client cannot play an illegal card. Default export = factory, called by the dev server and the
// backend builds once at startup.
import { createRoomService } from '../rooms/server.js';
import { game } from '../durak/game.js';

export default function backend() {
  return createRoomService({ games: { [game.id]: game } });
}
