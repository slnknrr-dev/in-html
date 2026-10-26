// rooms/test.js - unit and integration tests of the rooms: `node rooms/test.js` (importing the module runs nothing).
// A toy game runs in a local room (bots, seeds, private events) and through a real HTTP server with the client
// (passwords, invites, spectators, Server-Sent Events, CORS); then the NOTICE build targets (targets.js) are built for
// a scratch application and the generated servers are started and queried.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localRoom } from './local.js';
import { connect } from './client.js';
import { createRoomService } from './server.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 5000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await wait(10); } return true; }

// Race to 10: seats take turns adding 1 or 2; whoever reaches 10 wins. The deal is a secret number per seat.
export const RACE = {
  id: 'race', version: 1, seats: { min: 2, max: 4 },
  create(settings, rng) { return { total: 0, turn: 0, players: settings.players, secrets: Array.from({ length: settings.players }, () => rng.int(1000)), winner: null }; },
  act(state, seat, action) {
    if (state.winner !== null) return { error: 'over' };
    if (seat !== state.turn) return { error: 'not your turn' };
    if (action.add !== 1 && action.add !== 2) return { error: 'add 1 or 2' };
    const total = state.total + action.add;
    const next = { ...state, total, turn: (state.turn + 1) % state.players, winner: total >= 10 ? seat : null };
    return { state: next, events: [{ type: 'added', seat, add: action.add }, { type: 'secret', to: seat, value: state.secrets[seat] }] };
  },
  view(state, seat) { return { total: state.total, turn: state.turn, winner: state.winner, mySecret: seat >= 0 ? state.secrets[seat] : null }; },
  result(state) { return state.winner === null ? null : { winner: state.winner }; },
  bot: { kinds: [{ id: 'random' }], create: () => (view, seat, rng) => (view.turn === seat && view.winner === null ? { add: 1 + rng.int(2) } : null) },
};

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => eq(name, cond ? true : info ?? false, true);

  // --- local rooms --------------------------------------------------------------------------------------------
  const r1 = localRoom(RACE, {}, { seats: 2, bots: [{ seat: 1, kind: 'random' }], botDelay: 1, random: { kind: 'seeded', seed: 'abc' } });
  const events = [];
  r1.on('event', (e) => events.push(e));
  eq('local: started', r1.status, 'playing');
  eq('local: seat 0 view', r1.view.total, 0);
  eq('local: wrong turn rejected', (await r1.act({ add: 1 }, 1)).ok, false);
  eq('local: bad action rejected', (await r1.act({ add: 3 })).error, 'add 1 or 2');
  while (r1.status === 'playing') { if (r1.view.turn === 0) await r1.act({ add: 2 }); await wait(5); }
  eq('local: game over with a winner', typeof r1.result.winner, 'number');
  ok('local: only own private events', events.filter((e) => e.type === 'secret').every((e) => e.to === 0), events);
  const s1 = localRoom(RACE, {}, { seats: 2, random: { kind: 'seeded', seed: 'same' } }), s2 = localRoom(RACE, {}, { seats: 2, random: { kind: 'seeded', seed: 'same' } });
  eq('local: seed reproduces the deal', s1.core.state.secrets, s2.core.state.secrets);
  ok('local: crypto deals differ', JSON.stringify(localRoom(RACE, {}, { seats: 2 }).core.state.secrets) !== JSON.stringify(localRoom(RACE, {}, { seats: 2 }).core.state.secrets));
  s1.leave(); s2.leave();

  // --- server + client over HTTP ---------------------------------------------------------------------------------
  const service = createRoomService({ games: { race: RACE }, botDelay: 5 });
  const srv = http.createServer(async (req, res) => { if (!await service.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const pre = await fetch(url + '/api/rooms', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST' } });
    eq('cors: preflight', [pre.status, pre.headers.get('access-control-allow-origin')], [204, '*']);
    const server = connect(url);
    eq('info lists the game', (await server.info()).games.map((g) => g.id), ['race']);
    const host = await server.create({ game: 'race', name: 'Test', player: 'Ann', seats: 3, password: 'pw' });
    ok('create returns tokens', host.roomId && host.invite && host.token && host.seat === 0, host);
    let denied = null;
    try { await server.join(host.roomId, { player: 'Bob', password: 'nope' }); } catch (e) { denied = e.status; }
    eq('wrong password', denied, 403);
    const bob = await server.join(host.roomId, { player: 'Bob', password: 'pw' });
    eq('join with password', bob.seat, 1);
    const cat = await server.join(host.roomId, { player: 'Cat', invite: host.invite });
    eq('join with invite', cat.seat, 2);
    const spy = await server.join(host.roomId, { player: 'Spy', invite: host.invite, spectate: true });
    eq('spectator', spy.seat, -1);
    eq('locked room is not listed', (await server.list('race')).length, 0);
    const A = server.open(host.roomId, host.token), B = server.open(host.roomId, bob.token), S = server.open(host.roomId, spy.token);
    const bEvents = [];
    B.on('event', (e) => bEvents.push(e));
    ok('streams open', await until(() => A.info && B.info && S.info), [A.info, B.info]);
    eq('players visible', A.players.map((p) => p.name), ['Ann', 'Bob', 'Cat']);
    eq('only the owner starts', (await B.start()).ok, false);
    eq('owner starts', (await A.start()).ok, true);
    ok('views arrive', await until(() => A.view && B.view && A.status === 'playing' && B.view.total === 0), [A.view, B.view]);
    ok('own secret only', A.view.mySecret !== null && S.view.mySecret === null, [A.view, S.view]);
    eq('out of turn', (await B.act({ add: 1 })).ok, false);
    eq('turn', (await A.act({ add: 2 })).ok, true);
    ok('everyone sees the move', await until(() => B.view.total === 2 && S.view.total === 2), [B.view, S.view]);
    eq('bob moves', (await B.act({ add: 1 })).ok, true);
    ok('bob got his private event only', await until(() => bEvents.some((e) => e.type === 'secret')) && bEvents.filter((e) => e.type === 'secret').every((e) => e.to === 1), bEvents);
    await A.chat('hi');
    ok('chat', await until(() => B.chatLog.some((c) => c.text === 'hi')), B.chatLog);
    A.leave(); B.leave(); S.leave();
    // Bots on the server finish a game.
    const solo = await server.create({ game: 'race', player: 'Solo', seats: 2, bots: [{ seat: 1, kind: 'random' }] });
    const R = server.open(solo.roomId, solo.token);
    await until(() => R.info);
    await R.start();
    for (let i = 0; i < 20 && R.status !== 'over'; i++) { await until(() => R.view && (R.view.turn === 0 || R.status === 'over'), 2000); if (R.status === 'over') break; await R.act({ add: 1 }); await wait(30); }
    ok('server bot plays to the end', await until(() => R.status === 'over', 3000), R.view);
    R.leave();
  } finally {
    service.close();
    srv.close();
  }

  // --- NOTICE build targets ------------------------------------------------------------------------------------------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'in-html-targets-'));
  try {
    for (const lib of ['rooms', 'prng', 'crypto', 'codec']) fs.cpSync(path.join(REPO, lib), path.join(tmp, lib), { recursive: true });
    const app = path.join(tmp, 'race-game');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'index.html'), '<!DOCTYPE html><html><head><title>Race</title><script type="module" src="./main.js"></script></head><body><p id="m"></p></body></html>');
    fs.writeFileSync(path.join(app, '404.html'), '<!DOCTYPE html><html><head><title>Not found</title></head><body>missing page</body></html>');
    fs.writeFileSync(path.join(app, 'game.js'), `export const RACE = ${serialize(RACE)};\n`);
    fs.writeFileSync(path.join(app, 'main.js'), "import { connect, localRoom, networked } from '../rooms/client.js';\nimport { RACE } from './game.js';\nconst a = globalThis.IN_HTML_ARTIFACT;\nconst r = localRoom(RACE, {}, { seats: 2 });\ndocument.getElementById('m').textContent = (a ? a.mode : 'dev') + ' ' + networked + ' ' + r.view.total + ' ' + typeof connect;\n");
    fs.writeFileSync(path.join(app, 'backend.js'), "import { createRoomService } from '../rooms/server.js';\nimport { RACE } from './game.js';\nexport default function backend(ctx) { return createRoomService({ games: { race: RACE } }); }\n");
    for (const n of ['SINGLEFILE_OFFLINE_NOTICE.md', 'OFFLINE_NOTICE.md', 'SERVERLESS_NOTICE.md', 'SERVERLESS_SINGLEFILE_NOTICE.md', 'BACKEND_NOTICE.md', 'SINGLEFILE_BACKEND_NOTICE.md', 'STANDALONE_NOTICE.md']) fs.writeFileSync(path.join(app, n), '# notice\n');
    const { main } = await import('../singlefile.js');
    const log = console.log;
    console.log = () => {};
    let code;
    try { code = main(['race-game'], tmp); } finally { console.log = log; }
    eq('targets build', code, 0);
    const dirs = fs.readdirSync(app).filter((d) => d.startsWith('html@5')).sort();
    eq('target folders', dirs, ['html@5_backend', 'html@5_backend_singlefile', 'html@5_offline', 'html@5_offline_singlefile', 'html@5_serverless', 'html@5_serverless_singlefile', 'html@5_standalone']);
    const offline = fs.readFileSync(path.join(app, 'html@5_offline_singlefile', 'index.html'), 'utf8');
    ok('offline page: mode and no network code', /"mode":"offline"/.test(offline) && !/fetch\s*\(/.test(offline) && !/networked/.test('') , offline.slice(0, 200));
    const offFiles = fs.readdirSync(path.join(app, 'html@5_offline', 'rooms'));
    ok('offline copy uses the offline client', offFiles.includes('client.offline.js') && !offFiles.includes('client.js'), offFiles);
    const standalone = fs.readFileSync(path.join(app, 'html@5_standalone', 'index.html'), 'utf8');
    ok('standalone page: mode and network client', /"mode":"standalone"/.test(standalone) && /fetch/.test(standalone), standalone.slice(0, 200));
    eq('multi-file backend layout', ['server.mjs', 'backend.mjs', 'public/index.html'].map((f) => fs.existsSync(path.join(app, 'html@5_backend', f))), [true, true, true]);
    // Run the generated servers.
    const runServer = async (file, port) => {
      const child = spawn(process.execPath, [file, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      await until(() => /http:\/\//.test(out), 8000);
      return { child, out: () => out };
    };
    const port0 = 18000 + Math.floor(Math.random() * 1000);
    const s1 = await runServer(path.join(app, 'html@5_serverless_singlefile', 'race-game.mjs'), port0);
    try {
      const home = await fetch(`http://127.0.0.1:${port0}/`);
      const text = await home.text();
      eq('serverless script serves the page', [home.status, /"mode":"serverless"/.test(text)], [200, true]);
      const nf = await fetch(`http://127.0.0.1:${port0}/some/route`);
      eq('serverless script answers 404.html', [nf.status, /missing page/.test(await nf.text())], [404, true]);
    } finally { s1.child.kill(); }
    const s2 = await runServer(path.join(app, 'html@5_backend_singlefile', 'race-game.mjs'), port0 + 1);
    try {
      const info = await (await fetch(`http://127.0.0.1:${port0 + 1}/api/info`)).json();
      eq('backend script: rooms API', info.games.map((g) => g.id), ['race']);
      const page = await (await fetch(`http://127.0.0.1:${port0 + 1}/`)).text();
      ok('backend script: page with mode backend', /"mode":"backend"/.test(page), page.slice(0, 120));
    } finally { s2.child.kill(); }
    const s3 = await runServer(path.join(app, 'html@5_backend', 'server.mjs'), port0 + 2);
    try {
      const info = await (await fetch(`http://127.0.0.1:${port0 + 2}/api/info`)).json();
      eq('multi-file backend: rooms API', info.games.map((g) => g.id), ['race']);
      eq('multi-file backend: static', (await fetch(`http://127.0.0.1:${port0 + 2}/index.html`)).status, 200);
    } finally { s3.child.kill(); }
    // Removing a NOTICE removes its artifact folder.
    fs.rmSync(path.join(app, 'STANDALONE_NOTICE.md'));
    console.log = () => {};
    try { main(['race-game'], tmp); } finally { console.log = log; }
    eq('stale target removed', fs.existsSync(path.join(app, 'html@5_standalone')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`rooms: ${pass} passed, ${fail} failed`);
  return fail;
}

// Source text of the toy game for the scratch application.
function serialize(game) {
  const fn = (f) => (String(f).startsWith('function') || String(f).startsWith('(') || String(f).startsWith('async') ? String(f) : 'function ' + String(f));
  return `{ id: 'race', version: 1, seats: { min: 2, max: 4 }, create: ${fn(game.create)}, act: ${fn(game.act)}, view: ${fn(game.view)}, result: ${fn(game.result)}, bot: { kinds: [{ id: 'random' }], create: ${String(game.bot.create)} } }`;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
