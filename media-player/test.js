// media-player/test.js - backend tests of the media player against a temporary folder: `node media-player/test.js`
// (also `node check.js tests media-player`). A real HTTP server on 127.0.0.1 runs hosting.js createHosting with
// backend.js in the BACKEND mode (tokens) and the Electron mode (trusted): the file API on the configured root, the
// catalogue API with long-polled changes, blobs, a server-side scan of generated WAV / MP3 files with cover sidecars,
// Range requests, jobs (previews with bash / cmd.exe commands; a real ImageMagick collage when magick is installed, a
// real ffmpeg conversion when ffmpeg is installed — skipped otherwise), the stream endpoint without yt-dlp, CORS
// settings. Nothing is downloaded.

// Test strategy: a real HTTP server on 127.0.0.1 with a temporary data folder, exercised over HTTP like a client
// would, so auth, CORS, Range and long polling are tested end to end rather than by calling handlers. Media files
// are synthesized (WAV / MP3 encoders of this repository) so the suite needs no fixtures and no network; tool-
// dependent tests are skipped, not failed, when ffmpeg / magick are absent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createHosting } from '../hosting.js';
import backend from './backend.js';
import { encodeWav } from '../wav/wav.js';
import { writeId3v2 } from '../mp3/id3.js';
import { encodeMp3 } from '../mp3/encoder.js';
import { buildJob } from './jobs.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function png(w, h, rgb) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function startServer(mode, dataDir) {
  const hosting = createHosting({ dir: path.join(dataDir, 'public'), backend, name: 'media-player', dataDir, mode, log: () => {} });
  const server = http.createServer(hosting.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  return { hosting, server, base, close: async () => { await hosting.close(); server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } };
}

export async function run() {
  let pass = 0, fail = 0, skipped = [];
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + JSON.stringify(info).slice(0, 600) : ''}`); } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'media-player-test-'));
  const media = path.join(tmp, 'media');
  const data = path.join(tmp, 'data');
  const dl = path.join(tmp, 'downloads');
  fs.mkdirSync(path.join(media, 'Music', 'Tone Band', '2020 - Tones'), { recursive: true });
  fs.mkdirSync(path.join(data, 'public'), { recursive: true });
  fs.writeFileSync(path.join(data, 'public', 'index.html'), '<!doctype html><title>t</title>');
  const sine = (hz) => { const x = new Float32Array(22050); for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * hz * i / 22050); return x; };
  const album = path.join(media, 'Music', 'Tone Band', '2020 - Tones');
  fs.writeFileSync(path.join(album, '01 Low.wav'), encodeWav([sine(220)], { sampleRate: 22050, info: { title: 'Low', artist: 'Tone Band', album: 'Tones', track: '1' } }));
  fs.writeFileSync(path.join(album, '02 High.wav'), encodeWav([sine(880)], { sampleRate: 22050, info: { title: 'High', artist: 'Tone Band', album: 'Tones', track: '2' } }));
  const mp3 = encodeMp3([sine(440)], { sampleRate: 44100, bitrate: 64 });
  const id3 = writeId3v2({ title: 'Middle', artist: 'Tone Band', album: 'Tones', track: '3', year: '2020' }, { version: 3 });
  fs.writeFileSync(path.join(album, '03 Middle.mp3'), Buffer.concat([Buffer.from(id3), Buffer.from(mp3)]));
  fs.writeFileSync(path.join(album, 'cover.png'), png(64, 64, [200, 60, 40]));
  const envBefore = { ...process.env };
  process.env.MP_TOKEN = 'owner-test-token';
  process.env.MP_GUEST_TOKEN = 'guest-test-token';
  process.env.MP_ROOTS = media;
  process.env.MP_DOWNLOADS = dl;
  delete process.env.MP_CORS;
  let srv = null;
  try {
    srv = await startServer('backend', data);
    const { base } = srv;
    const H = (token = 'owner-test-token', extra = {}) => ({ Authorization: 'Bearer ' + token, ...extra });
    const get = async (p, token, extra) => { const r = await fetch(base + p, { headers: token === null ? {} : H(token, extra) }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers }; };
    const post = async (p, body, token) => { const r = await fetch(base + p, { method: 'POST', headers: { ...H(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

    const info = await get('api/info', null);
    ok('info without token', info.status === 200 && info.body.app === 'media-player' && info.body.auth === true, info.body);
    ok('db needs a token', (await get('api/db', null)).status === 401);
    ok('wrong token refused', (await get('api/db', 'nope')).status === 403);
    ok('guest reads', (await get('api/db', 'guest-test-token')).status === 200);
    ok('guest cannot write', (await post('api/db/ops', { ops: [] }, 'guest-test-token')).status === 403);
    const mounts = (await get('api/fs/mounts')).body;
    const root = mounts.find((m) => m.name === 'media');
    ok('mounts: root and downloads', !!root && mounts.some((m) => m.name === 'Downloads' && m.writable), mounts);

    // Server-side scan of a folder source.
    const src = { id: 'src1', type: 'source', kind: 'folder', name: 'Media', loc: { mount: root.id, path: '' }, hint: 'auto', include: [], exclude: ['.*'], templates: [], useTags: true, useSidecars: true, created: 1, updated: 1, tags: [] };
    const put = await post('api/db/ops', { ops: [{ op: 'put', node: src }] });
    ok('ops applied', put.status === 200 && put.body.applied === 1, put.body);
    ok('scan starts', (await post('api/scan', { source: 'src1' })).status === 200);
    let scan;
    for (let i = 0; i < 100; i++) { scan = (await get('api/scan')).body.src1; if (scan && scan.status !== 'running') break; await sleep(100); }
    ok('scan done', scan && scan.status === 'done' && scan.report.added === 3, scan);
    const dbNow = (await get('api/db')).body;
    const works = dbNow.nodes.filter((n) => n.type === 'work');
    const alb = works.find((w) => w.kind === 'album');
    ok('album with tracks and cover', alb && alb.title === 'Tones' && works.filter((w) => w.parent === alb.id).length === 3 && alb.cover && alb.cover.loc && alb.cover.loc.path.endsWith('cover.png'), works.map((w) => [w.kind, w.title]));
    const medias = dbNow.nodes.filter((n) => n.type === 'media');
    const mp3Media = medias.find((m) => m.name === '03 Middle.mp3');
    ok('mp3 duration (22050 samples at 44.1 kHz) and tags', mp3Media && mp3Media.duration > 0.4 && mp3Media.duration < 0.7 && works.some((w) => w.title === 'Middle'), mp3Media && mp3Media.duration);

    // Range over the file API.
    const raw = await fetch(base + `api/fs/raw/${root.id}/${mp3Media.path.split('/').map(encodeURIComponent).join('/')}?t=guest-test-token`, { headers: { Range: 'bytes=0-9' } });
    ok('raw Range with query token', raw.status === 206 && (await raw.arrayBuffer()).byteLength === 10);

    // Long-polled changes.
    const since = dbNow.rev;
    const waiting = get(`api/db/changes?since=${since}&wait=5`);
    await sleep(150);
    await post('api/db/ops', { ops: [{ op: 'put', node: { id: 'w-new', type: 'work', kind: 'track', title: 'Added later', created: 2, updated: 2, tags: [] } }] });
    const ch = (await waiting).body;
    ok('long poll wakes on a change', ch.ops && ch.ops.some((o) => o.node && o.node.id === 'w-new'), ch);
    ok('changes since an old revision', (await get('api/db/changes?since=0')).body.ops.length >= 5);

    // Blobs.
    const blobBytes = png(8, 8, [1, 2, 3]);
    const pr = await fetch(base + 'api/blobs/test-blob?type=image/png', { method: 'PUT', headers: H(), body: blobBytes });
    ok('blob put', pr.status === 200);
    const gb = await get('api/blobs/test-blob?t=guest-test-token', null);
    ok('blob get with query token', gb.status === 200 && Buffer.compare(gb.body, blobBytes) === 0 && gb.headers.get('content-type') === 'image/png');

    // Jobs: previews with commands, missing tools refused.
    const wavMedia = medias.find((m) => m.name === '01 Low.wav');
    const prev = await post('api/jobs/preview', { kind: 'convertAudio', params: { media: wavMedia.id, format: 'mp3', quality: 'high' } });
    ok('job preview: bash and cmd commands', prev.status === 200 && /ffmpeg/.test(prev.body.commands.bash) && /-i /.test(prev.body.commands.bash) && /\^$/m.test(prev.body.commands.cmd) === prev.body.commands.cmd.includes('^'), prev.body);
    ok('job preview: tags from the catalogue', /title=Low/.test(prev.body.commands.bash) && /album=Tones/.test(prev.body.commands.bash), prev.body.commands && prev.body.commands.bash);
    ok('unknown job kind', (await post('api/jobs', { kind: 'rm', params: {} })).status === 400);
    const tools = (await get('api/tools')).body.tools;
    if (!tools.ffmpeg) {
      const r = await post('api/jobs', { kind: 'convertAudio', params: { media: wavMedia.id, format: 'mp3' } });
      ok('missing ffmpeg: 501 with the commands to run yourself', r.status === 501 && r.body.commands && r.body.missing.includes('ffmpeg'), r.body);
      skipped.push('ffmpeg conversion (ffmpeg not found)');
    } else {
      const r = await post('api/jobs', { kind: 'convertAudio', params: { media: wavMedia.id, format: 'mp3', addVersion: true } });
      ok('ffmpeg job queued', r.status === 200, r.body);
      let j;
      for (let i = 0; i < 200; i++) { j = (await get('api/jobs/' + r.body.id)).body; if (['done', 'failed', 'canceled'].includes(j.status)) break; await sleep(100); }
      ok('ffmpeg job done', j && j.status === 'done', j && [j.status, j.error, (j.log || []).slice(-5)]);
      await sleep(200);
      const after = (await get('api/db')).body.nodes.filter((n) => n.type === 'media' && n.work === wavMedia.work);
      ok('converted file added as a version', after.length === 2, after.map((m) => m.name));
    }
    if (tools.magick) {
      const coll = { id: 'coll1', type: 'collection', kind: 'playlist', name: 'P', items: works.filter((w) => w.parent === alb.id).map((w) => ({ ref: w.id })), created: 3, updated: 3, tags: [] };
      await post('api/db/ops', { ops: [{ op: 'put', node: coll }] });
      const r = await post('api/jobs', { kind: 'collage', params: { collection: 'coll1', size: 128 } });
      ok('magick collage queued', r.status === 200, r.body);
      let j;
      for (let i = 0; i < 300; i++) { j = (await get('api/jobs/' + r.body.id)).body; if (['done', 'failed', 'canceled'].includes(j.status)) break; await sleep(100); }
      ok('magick collage done', j && j.status === 'done', j && [j.status, j.error, (j.log || []).slice(-5)]);
      await sleep(200);
      const c = (await get('api/db')).body.nodes.find((n) => n.id === 'coll1');
      ok('collage became the playlist cover', c && c.cover && c.cover.blob, c);
      const cmd = await get('api/jobs/' + r.body.id + '/command?shell=cmd');
      ok('job command for cmd.exe', cmd.status === 200 && /magick|convert/.test(cmd.body.text), cmd.body);
    } else skipped.push('ImageMagick collage (magick not found)');
    const stream = await get('api/stream?media=' + wavMedia.id);
    ok('stream needs a source', stream.status === 404);

    // CORS settings: an origin the owner allows gets preflight and headers.
    await post('api/settings', { cors: ['https://player.example'] });
    const pre = await fetch(base + 'api/db', { method: 'OPTIONS', headers: { Origin: 'https://player.example', 'Access-Control-Request-Method': 'GET' } });
    ok('preflight allowed origin', pre.status === 204);
    const pre2 = await fetch(base + 'api/fs/mounts', { method: 'OPTIONS', headers: { Origin: 'https://player.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    ok('file API follows the settings', pre2.status === 204, pre2.status);
    const bad = await fetch(base + 'api/db', { headers: { ...H(), Origin: 'https://evil.example' } });
    ok('other origins refused', bad.status === 403);
    await srv.close();

    // Persistence across a restart, and the Electron mode (trusted, no token).
    srv = await startServer('electron', data);
    const e = await fetch(srv.base + 'api/db');
    const ej = await e.json();
    ok('electron mode: no token, catalogue persisted', e.status === 200 && ej.nodes.some((n) => n.id === 'w-new'), e.status);
    const grant = await fetch(srv.base + 'api/fs/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [album] }) });
    const gj = await grant.json();
    ok('electron: grant a picked folder', grant.status === 200 && gj[0] && gj[0].mount, gj);
    // jobs.js in the browser: display paths (the commands a serverless page shows).
    const envB = { media: (id) => ej.nodes.find((n) => n.id === id), work: (id) => ej.nodes.find((n) => n.id === id), facts: () => ({ title: 'Low', artist: ['Tone Band'], author: [], albumartist: [], album: 'Tones', tags: new Set(), year: 2020 }), pathOf: (m) => m.name, outPath: (i, ext) => i.replace(/\.[^.]+$/, '.' + ext), coverPath: () => null };
    const b = buildJob('convertAudio', { media: wavMedia.id, format: 'opus' }, envB);
    ok('browser-side job spec', b.spec.steps[0].argv.includes('01 Low.wav') && b.outputs[0].path === '01 Low.opus', b.spec.steps[0].argv);
  } catch (e) {
    fail++;
    console.log('FAIL backend scenario: ' + (e && e.stack || e));
  } finally {
    if (srv) await srv.close().catch(() => {});
    for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k];
    Object.assign(process.env, envBefore);
    await sleep(100);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked */ }
  }
  for (const s of skipped) console.log('media-player: skipped ' + s);
  console.log(`media-player: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) run().then((f) => { process.exitCode = f ? 1 : 0; });
