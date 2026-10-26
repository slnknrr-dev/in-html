// sudoku-game/backend.js - the server side of Sudoku Variants for BACKEND builds and the development server: the
// rooms service (rooms/server.js: rooms, invites, passwords, spectators, chat, server-side bots) with the sudoku game
// definition (sudoku/game.js). The generated server (hosting.js) mounts it at /api.
// The server is game-agnostic: it validates and relays moves through the game definition (sudoku/game.js), which
// is the same module the client uses, so rules cannot drift between client and server.
import { createRoomService } from '../rooms/server.js';
import { game } from '../sudoku/game.js';

export default function backend() {
  return createRoomService({ games: { [game.id]: game } });
}
