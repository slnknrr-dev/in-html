// fileapi/test.js - tests of the file API: `node fileapi/test.js` (importing the module runs nothing).
// Pure helpers first (paths, globs, ranges, types, tokens), then a scratch folder under os.tmpdir() served by a real
// http.createServer on 127.0.0.1 (loopback only) with three API instances: tokens + CORS list + thumbnails + watching,
// open access with a small upload limit and CORS '*', uploads turned off. Requests go out with http.request (paths
// sent verbatim, so traversal attempts reach the handler unnormalized) and through client.js with Node's fetch.
//
// Why http.request for the attack cases: fetch() and the URL parser normalise '/../' and some encodings BEFORE the
// request leaves, so a traversal test written with fetch would pass even against a vulnerable server. Sending the
// raw path is the only way to test what an attacker's own client can send. A real loopback server (not mocked
// req/res objects) exercises the actual stream, header and backpressure behaviour of Node's http module.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { normRel, joinRel, parentRel, baseName, extOf, isHiddenName, resolveSafe, mountId, fnv64, compareNames } from './paths.js';
import { globToRegExp, matchGlob, matchAny, filterPaths } from './glob.js';
import { parseRange, contentRange } from './range.js';
import { typeOf, kindOf } from './types.js';
import { tokenAuth, openAuth, newToken } from './auth.js';
import { createFileApi, MOUNTS_KEY } from './handler.js';
import { createFileClient, FileApiError, encodePath } from './client.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bytes = (n, seed = 0) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function fakeStorage() {
  const map = new Map();
  return { map, read: (k) => (map.has(k) ? JSON.parse(map.get(k)) : null), write: (k, v) => { map.set(k, JSON.stringify(v)); } };
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => eq(name, cond ? true : info ?? false, true);

  // --- paths ----------------------------------------------------------------------------------------------------
  eq('normRel simple', normRel('a/b/c.mp3'), 'a/b/c.mp3');
  eq('normRel separators and dots', normRel('a\\.\\b//c/'), 'a/b/c');
  eq('normRel root', [normRel(''), normRel('.'), normRel('./'), normRel(undefined)], ['', '', '', '']);
  for (const bad of ['..', 'a/../b', '../x', 'a/..', '\\..\\x', '/etc/passwd', '\\x', 'C:', 'c:/x', 'a:b', 'a.mp3:stream', 'a\0b', 'a\nb', 'a\x7fb',
    'con', 'NUL.txt', 'a/COM1', 'lpt9.mp3', 'aux .txt', 'a./b', 'a /b', 'x.', '...', '. .', 'x'.repeat(256)]) {
    eq('normRel refuses ' + JSON.stringify(bad), normRel(bad), null);
  }
  eq('normRel win32 wildcards', [normRel('a?.mp3', { platform: 'win32' }), normRel('a?.mp3', { platform: 'linux' }), normRel('a<b', { platform: 'win32' })], [null, 'a?.mp3', null]);
  eq('normRel keeps names that only look like devices', normRel('Con Air.mkv/console.txt/.hidden/nul2'), 'Con Air.mkv/console.txt/.hidden/nul2');
  eq('joinRel', [joinRel('a', 'b/c'), joinRel('', 'x'), joinRel('a', ''), joinRel('a', '..')], ['a/b/c', 'x', 'a', null]);
  eq('parentRel', [parentRel('a/b/c'), parentRel('a'), parentRel('')], ['a/b', '', '']);
  eq('baseName', [baseName('a/b/c.mp3'), baseName('c'), baseName('')], ['c.mp3', 'c', '']);
  eq('extOf', [extOf('A.MP3'), extOf('a.tar.gz'), extOf('.bashrc'), extOf('noext'), extOf('dir.d/file')], ['mp3', 'gz', '', '', '']);
  eq('isHiddenName', ['.git', 'Thumbs.db', '$RECYCLE.BIN', 'System Volume Information', 'desktop.ini', '@eaDir', '.DS_Store', 'a.mp3', 'Desktop'].map(isHiddenName),
    [true, true, true, true, true, true, true, false, false]);
  eq('compareNames natural', ['track 10', 'Track 1', 'track 2', 'a'].sort(compareNames), ['a', 'Track 1', 'track 2', 'track 10']);
  const idWin = mountId('C:\\Music', 'win32');
  ok('mountId shape', /^[a-z2-7]{10}$/.test(idWin), idWin);
  eq('mountId win32 ignores case and separators', [mountId('c:/music/', 'win32'), mountId('C:\\MUSIC\\\\', 'win32')], [idWin, idWin]);
  eq('mountId win32 drive root', mountId('D:', 'win32'), mountId('d:\\', 'win32'));
  ok('mountId linux is case-sensitive', mountId('/music', 'linux') !== mountId('/Music', 'linux'));
  eq('mountId linux trailing slash', mountId('/srv/media/', 'linux'), mountId('/srv/media', 'linux'));
  eq('mountId stable value', mountId('/srv/media', 'linux'), mountId('/srv/media', 'linux'));
  ok('mountId differs per path', mountId('/srv/media', 'linux') !== mountId('/srv/media2', 'linux'));
  eq('fnv64 vectors', [fnv64(''), fnv64('a')], ['cbf29ce484222325', 'af63dc4c8601ec8c']);

  // --- globs ----------------------------------------------------------------------------------------------------
  const g = (p, glob, o) => matchGlob(p, glob, o);
  eq('glob base name at any depth', [g('a.mp3', '*.mp3'), g('x/y/a.MP3', '*.mp3'), g('x/a.mp3', '/*.mp3'), g('a.mp3', '/*.mp3')], [true, true, false, true]);
  eq('glob globstar', [g('a/b', 'a/**/b'), g('a/x/y/b', 'a/**/b'), g('a', 'a/**'), g('a/x/y', 'a/**'), g('b/x', 'a/**'), g('x/y/z', '**'), g('x/a.mp3', '**/*.mp3')],
    [true, true, true, true, false, true, true]);
  eq('glob star stays in a segment', [g('a/b/c', 'a/*'), g('a/b', 'a/*'), g('ab', 'a**b')], [false, true, true]);
  eq('glob ? and classes', [g('a1', 'a?'), g('a12', 'a?'), g('b.mp3', '[abc].mp3'), g('d.mp3', '[abc].mp3'), g('d.mp3', '[!a-c].mp3'), g('b.mp3', '[!a-c].mp3'),
    g('b.mp3', '[^a-c].mp3'), g('a/b', 'a[/]b')], [true, false, true, false, true, false, false, false]);
  eq('glob braces', [g('a.flac', '*.{mp3,flac}'), g('a.ogg', '*.{mp3,flac}'), g('x/a.opus', '*.{mp3,{ogg,opus}}'), g('music/a', '{music,video}/*'), g('m/a', '{music,video}/*')],
    [true, false, true, true, false]);
  eq('glob escapes and literals', [g('a*b', 'a\\*b'), g('axb', 'a\\*b'), g('{a}', '{a}'), g('[a', '[a'), g('{a,b', '{a,b'), g('a+b(1).mp3', 'a+b(1).mp3')], [true, false, true, true, true, true]);
  eq('glob dot', [g('.hidden.mp3', '*.mp3'), g('.hidden.mp3', '*.mp3', { dot: true }), g('.git/config', '**/config'), g('.git/config', '.git/*')], [false, true, false, true]);
  eq('glob nocase', [g('A.MP3', '*.mp3'), g('A.MP3', '*.mp3', { nocase: false })], [true, false]);
  ok('globToRegExp gives a RegExp', globToRegExp('*.mp3') instanceof RegExp);
  eq('matchAny', [matchAny('a.mp3', ['*.flac', '*.mp3']), matchAny('a.mp3', []), matchAny('a.mp3', '*.mp3')], [true, false, true]);
  eq('filterPaths', filterPaths(['a.mp3', 'b.txt', 'sub/c.mp3', 'skip/d.mp3', 'skip'], { include: ['*.mp3'], exclude: ['skip'] }), ['a.mp3', 'sub/c.mp3']);
  eq('filterPaths without include', filterPaths(['a', 'b/c', 'b'], { exclude: ['b'] }), ['a']);

  // --- ranges ---------------------------------------------------------------------------------------------------
  eq('range ignored', ['', 'items=0-1', 'bytes=abc', 'bytes=5-1', 'bytes=-', 'bytes=1-2-3'].map((h) => parseRange(h, 100)).concat(parseRange(undefined, 100)), Array(7).fill(null));
  eq('range first bytes', parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  eq('range clamped end', parseRange('bytes=90-200', 100), { start: 90, end: 99 });
  eq('range open', parseRange('bytes=95-', 100), { start: 95, end: 99 });
  eq('range suffix', [parseRange('bytes=-10', 100), parseRange('bytes=-500', 100)], [{ start: 90, end: 99 }, { start: 0, end: 99 }]);
  eq('range unsatisfiable', [parseRange('bytes=100-', 100), parseRange('bytes=-0', 100), parseRange('bytes=0-', 0)], ['unsatisfiable', 'unsatisfiable', 'unsatisfiable']);
  eq('range multiple -> first satisfiable', [parseRange('bytes=0-4, 10-19', 100), parseRange('bytes=500-600,10-19', 100)], [{ start: 0, end: 4 }, { start: 10, end: 19 }]);
  eq('contentRange', [contentRange(0, 9, 100), contentRange(null, null, 100)], ['bytes 0-9/100', 'bytes */100']);

  // --- types ----------------------------------------------------------------------------------------------------
  eq('typeOf', ['a.mp3', 'a.FLAC', 'a.opus', 'a.m4b', 'a.wav', 'a.weba', 'a.mka', 'a.mp4', 'a.webm', 'a.mkv', 'a.mov', 'a.avi', 'a.ts', 'a.ogv', 'a.vtt', 'a.srt',
    'a.ass', 'a.jpg', 'a.xyz'].map(typeOf), ['audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/x-matroska', 'video/mp4', 'video/webm',
    'video/x-matroska', 'video/quicktime', 'video/x-msvideo', 'video/mp2t', 'video/ogg', 'text/vtt', 'application/x-subrip', 'text/x-ssa', 'image/jpeg', 'application/octet-stream']);
  eq('kindOf', ['a.mp3', 'a.mkv', 'a.png', 'a.srt', 'a.lrc', 'a.m3u8', 'a.cue', 'a.zip', 'noext'].map(kindOf), ['audio', 'video', 'image', 'subtitle', 'text', 'text', 'text', 'other', 'other']);

  // --- tokens ---------------------------------------------------------------------------------------------------
  const TA = tokenAuth({ owner: 'own', writers: ['wri'], readers: ['rea'] });
  const az = (fn, method, tok, scope, href = '/api/fs/list/m/', op) => fn({ method, headers: tok ? { authorization: 'Bearer ' + tok } : {} }, scope, new URL(href, 'http://x'), op ? { op } : undefined);
  eq('auth without token', az(TA, 'GET', '', 'read'), 'unauthenticated');
  eq('auth scopes', [az(TA, 'GET', 'rea', 'read'), az(TA, 'PUT', 'rea', 'write'), az(TA, 'PUT', 'wri', 'write'), az(TA, 'POST', 'wri', 'owner'), az(TA, 'POST', 'own', 'owner'),
    az(TA, 'GET', 'own', 'read'), az(TA, 'GET', 'bad', 'read'), az(TA, 'GET', 're', 'read')], [true, false, true, false, true, true, false, false]);
  eq('auth query token for raw / thumb only', [az(TA, 'GET', '', 'read', '/api/fs/raw/m/a.mp3?t=rea', 'raw'), az(TA, 'HEAD', '', 'read', '/api/fs/thumb/m/a.mp3?t=rea', 'thumb'),
    az(TA, 'GET', '', 'read', '/api/fs/list/m/?t=rea', 'list'), az(TA, 'PUT', '', 'write', '/api/fs/raw/m/a?t=wri', 'raw'), az(TA, 'GET', '', 'read', '/api/fs/raw/m/a.mp3?t=rea')],
  [true, true, 'unauthenticated', 'unauthenticated', true]);
  eq('auth query token off', az(tokenAuth({ owner: 'o', queryToken: false }), 'GET', '', 'read', '/raw/m/a?t=o', 'raw'), 'unauthenticated');
  eq('openAuth', openAuth()({ method: 'PUT', headers: {} }, 'owner'), true);
  const tk = newToken();
  ok('newToken is URL-safe and random', /^[A-Za-z0-9_-]{32}$/.test(tk) && tk !== newToken(), tk);

  // --- fixture --------------------------------------------------------------------------------------------------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fileapi-'));
  const dirs = { root: 'music', outside: 'outside', up: 'up', up2: 'up2', single: 'single', thumbs: 'thumbs', extra: 'extra', extra2: 'extra2', linked: 'linked' };
  for (const k of Object.keys(dirs)) { dirs[k] = path.join(tmp, dirs[k]); if (k !== 'thumbs') fs.mkdirSync(dirs[k], { recursive: true }); }
  const { root, outside, up } = dirs;
  const A_MP3 = bytes(1000);
  const put = (rel, data) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
  put('a.mp3', A_MP3);
  for (const f of ['b.flac', 'Track 1.mp3', 'track 2.mp3', 'track 10.mp3', 'cover.jpg', 'space and #hash%.mp3', 'Ünïcode name.mp3', '.hidden.mp3', 'Thumbs.db',
    '.git/config', 'sub/c.ogg', 'sub/deep/d.wav', 'sub/deep/e.txt', 'sub/deep/.dot/x.mp3', 'Album 2/01.flac', 'Album 10/01.flac']) put(f, 'data of ' + f);
  put('empty.bin', '');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET');
  fs.writeFileSync(path.join(dirs.single, 'song.mp3'), bytes(300, 3));
  fs.writeFileSync(path.join(dirs.single, 'other.mp3'), 'TOP-SECRET other');
  fs.writeFileSync(path.join(dirs.extra, 'x.txt'), 'extra');
  fs.mkdirSync(path.join(dirs.linked, 'real'));
  fs.writeFileSync(path.join(dirs.linked, 'real', 'x.txt'), 'inside');
  let links = false, fileLink = false;
  try {
    fs.symlinkSync(outside, path.join(dirs.linked, 'escape'), 'junction');
    fs.symlinkSync(path.join(dirs.linked, 'real'), path.join(dirs.linked, 'inner'), 'junction');
    fs.symlinkSync(outside, path.join(up, 'escape'), 'junction');
    links = true;
  } catch (e) { console.log(`fileapi: symlinks / junctions cannot be created here (${e.code}), link tests skipped`); }
  try { fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dirs.linked, 'secret-link.txt'), 'file'); fileLink = true; } catch { /* needs a privilege on Windows */ }
  let watchable = true;
  try { fs.watch(tmp, { persistent: false }).close(); } catch { watchable = false; }

  const storage = fakeStorage();
  const makeCalls = [];
  const make = async (abs, size, kind) => {
    makeCalls.push({ name: path.basename(abs), size, kind });
    await wait(80);
    return kind === 'image' || kind === 'audio' ? { type: 'image/png', bytes: Uint8Array.from([137, 80, 78, 71, size & 255, path.basename(abs).length]) } : null;
  };
  const logs = [];
  const baseOpts = () => ({
    node: { fs, path }, storage, authorize: tokenAuth({ owner: 'own', writers: ['wri'], readers: ['rea'] }),
    mounts: [{ path: root, name: 'Music' }, { path: up, name: 'Uploads', writable: true }, { path: dirs.linked, name: 'Linked' }],
    cors: { origins: ['https://app.example', 'null'] }, thumbs: { dir: dirs.thumbs, make }, watch: true, log: (...a) => logs.push(a.join(' ')),
  });
  const api1 = createFileApi(baseOpts());
  const api2 = createFileApi({ node: { fs, path }, authorize: openAuth(), mounts: [{ path: dirs.up2, writable: true }], cors: { origins: ['*'] }, uploadLimit: 1000 });
  const api3 = createFileApi({ node: { fs, path }, authorize: openAuth(), mounts: [{ path: up, writable: true }], uploadLimit: 0 });
  const apis = [api1, api2, api3];
  const routes = [['/api/fs/', api1], ['/api2/fs/', api2], ['/api3/fs/', api3]];
  const server = http.createServer(async (req, res) => {
    const p = req.url.split('?')[0];
    const r = routes.find(([prefix]) => p.startsWith(prefix));
    try {
      if (r && await r[1].handle(req, res, new URL(req.url, 'http://127.0.0.1'), p.slice(r[0].length))) return;
      res.writeHead(404); res.end();
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const call = (method, p, { headers = {}, body, token, chunked } = {}) => new Promise((resolve, reject) => {
    const h = { ...headers };
    if (token) h.Authorization = 'Bearer ' + token;
    if (body !== undefined && !chunked && h['Content-Length'] === undefined) h['Content-Length'] = Buffer.byteLength(body);
    const rq = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text: buf.toString('utf8'), json: () => JSON.parse(buf.toString('utf8') || 'null') });
      });
      res.on('error', reject);
    });
    rq.on('error', reject);
    if (body !== undefined && chunked) { const b = Buffer.from(body); for (let i = 0; i < b.length; i += 500) rq.write(b.subarray(i, i + 500)); rq.end(); }
    else rq.end(body);
  });
  const M = mountId(root), U = mountId(up), L = mountId(dirs.linked);
  const F = '/api/fs/';
  const names = (r) => r.json().entries.map((e) => e.path);

  try {
    // --- info, mounts -------------------------------------------------------------------------------------------
    let r = await call('GET', F + 'info');
    eq('info without token: 401 with the API name', [r.status, r.json().api, r.json().version, r.json().auth, r.json().code, r.headers['www-authenticate']],
      [401, 'in-html-fileapi', 1, true, 'unauthorized', 'Bearer']);
    eq('JSON headers', [r.headers['content-type'], r.headers['cache-control'], r.headers['x-content-type-options']], ['application/json; charset=utf-8', 'no-store', 'nosniff']);
    r = await call('GET', F + 'info', { token: 'rea' });
    eq('info for a reader', [r.status, r.json().mounts, r.json().features, r.json().scopes], [200, 3, { upload: true, thumbs: true, watch: true }, ['read']]);
    eq('info for the owner', (await call('GET', F + 'info', { token: 'own' })).json().scopes, ['read', 'write', 'owner']);
    eq('info with a wrong token', (await call('GET', F + 'info', { token: 'nope' })).status, 403);
    r = await call('GET', F + 'mounts', { token: 'rea' });
    eq('mounts for a reader: no paths', r.json().map((m) => [m.id, m.name, m.writable, m.kind, m.fixed, m.available, 'path' in m]),
      [[M, 'Music', false, 'dir', true, true, false], [U, 'Uploads', true, 'dir', true, true, false], [L, 'Linked', false, 'dir', true, true, false]]);
    eq('mounts for the owner: paths', (await call('GET', F + 'mounts', { token: 'own' })).json().map((m) => m.path), [root, up, dirs.linked]);
    eq('one mount', (await call('GET', F + 'mounts/' + M, { token: 'rea' })).json().name, 'Music');
    eq('api2 and api3 info: features', [(await call('GET', '/api2/fs/info')).json().features, (await call('GET', '/api3/fs/info')).json().features.upload],
      [{ upload: true, thumbs: false, watch: false }, false]);

    // --- listing ------------------------------------------------------------------------------------------------
    const FLAT = ['Album 2', 'Album 10', 'sub', 'a.mp3', 'b.flac', 'cover.jpg', 'empty.bin', 'space and #hash%.mp3', 'Track 1.mp3', 'track 2.mp3', 'track 10.mp3', 'Ünïcode name.mp3'];
    r = await call('GET', F + `list/${M}/`, { token: 'rea' });
    eq('list: folders first, natural order, hidden names hidden', names(r), FLAT);
    eq('list: answer shape', [r.json().mount, r.json().path, r.json().truncated], [M, '', false]);
    const ea = r.json().entries.find((e) => e.name === 'a.mp3');
    eq('list: entry', [ea.path, ea.dir, ea.size, ea.type, ea.kind, typeof ea.mtime], ['a.mp3', false, 1000, 'audio/mpeg', 'audio', 'number']);
    eq('list: folder entry', r.json().entries[0], { ...r.json().entries[0], dir: true, size: 0, kind: 'dir' });
    eq('list without the trailing slash', names(await call('GET', F + `list/${M}`, { token: 'rea' })), FLAT);
    const hid = names(await call('GET', F + `list/${M}/?hidden=1`, { token: 'rea' }));
    ok('list hidden=1 shows hidden names', ['.git', '.hidden.mp3', 'Thumbs.db'].every((n) => hid.includes(n)), hid);
    const REC = ['Album 2', 'Album 2/01.flac', 'Album 10', 'Album 10/01.flac', 'sub', 'sub/deep', 'sub/deep/d.wav', 'sub/deep/e.txt', 'sub/c.ogg', ...FLAT.slice(3)];
    eq('list recursive', names(await call('GET', F + `list/${M}/?recursive=1`, { token: 'rea' })), REC);
    eq('list depth=1', names(await call('GET', F + `list/${M}/?depth=1`, { token: 'rea' })), FLAT);
    eq('list depth=2', names(await call('GET', F + `list/${M}/sub?depth=2`, { token: 'rea' })), ['sub/deep', 'sub/deep/d.wav', 'sub/deep/e.txt', 'sub/c.ogg']);
    eq('list depth=2 from the root', names(await call('GET', F + `list/${M}/?recursive=1&depth=2`, { token: 'rea' })).filter((p) => p.startsWith('sub')), ['sub', 'sub/deep', 'sub/c.ogg']);
    eq('list glob (files only)', names(await call('GET', F + `list/${M}/?recursive=1&dirs=0&glob=*.mp3`, { token: 'rea' })),
      ['a.mp3', 'space and #hash%.mp3', 'Track 1.mp3', 'track 2.mp3', 'track 10.mp3', 'Ünïcode name.mp3']);
    eq('list glob braces', names(await call('GET', F + `list/${M}/?recursive=1&dirs=0&glob=${encodeURIComponent('*.{ogg,wav}')}`, { token: 'rea' })), ['sub/deep/d.wav', 'sub/c.ogg']);
    eq('list several globs', names(await call('GET', F + `list/${M}/?recursive=1&dirs=0&glob=*.ogg&glob=*.txt`, { token: 'rea' })), ['sub/deep/e.txt', 'sub/c.ogg']);
    eq('list exclude a folder', names(await call('GET', F + `list/${M}/sub?recursive=1&exclude=deep`, { token: 'rea' })), ['sub/c.ogg']);
    eq('list exclude anchored', names(await call('GET', F + `list/${M}/?recursive=1&dirs=0&exclude=${encodeURIComponent('Album*')}&exclude=*.mp3&exclude=sub`, { token: 'rea' })),
      ['b.flac', 'cover.jpg', 'empty.bin']);
    r = await call('GET', F + `list/${M}/?recursive=1&limit=3`, { token: 'rea' });
    eq('list limit -> truncated', [names(r), r.json().truncated], [REC.slice(0, 3), true]);
    eq('list a file', [(r = await call('GET', F + `list/${M}/a.mp3`, { token: 'rea' })).status, r.json().code], [400, 'not-a-directory']);
    eq('list a missing folder', [(r = await call('GET', F + `list/${M}/nope`, { token: 'rea' })).status, r.json().code], [404, 'not-found']);
    eq('list an unknown mount', [(r = await call('GET', F + 'list/zzzzzzzzzz/', { token: 'rea' })).status, r.json().code], [404, 'not-found']);
    eq('list bad depth', (await call('GET', F + `list/${M}/?depth=0`, { token: 'rea' })).status, 400);

    // --- stat ---------------------------------------------------------------------------------------------------
    r = await call('GET', F + `stat/${M}/a.mp3`, { token: 'rea' });
    const sa = r.json();
    eq('stat a file', [r.status, sa.mount, sa.name, sa.path, sa.size, sa.dir, sa.kind, typeof sa.ctime, sa.ino === undefined || /^\d+$/.test(sa.ino)], [200, M, 'a.mp3', 'a.mp3', 1000, false, 'audio', 'number', true]);
    r = await call('GET', F + `stat/${M}/`, { token: 'rea' });
    eq('stat the root', [r.json().name, r.json().path, r.json().dir], ['Music', '', true]);
    eq('stat a missing file', (await call('GET', F + `stat/${M}/nope.mp3`, { token: 'rea' })).status, 404);
    eq('stat of a name with special characters', (await call('GET', F + `stat/${M}/${encodePath('space and #hash%.mp3')}`, { token: 'rea' })).json().name, 'space and #hash%.mp3');

    // --- raw bytes ----------------------------------------------------------------------------------------------
    const RAW = F + `raw/${M}/a.mp3`;
    r = await call('GET', RAW, { token: 'rea' });
    eq('raw: whole file', [r.status, same(new Uint8Array(r.body), A_MP3)], [200, true]);
    eq('raw: headers', [r.headers['accept-ranges'], r.headers['content-type'], r.headers['content-length'], /^W\/"/.test(r.headers.etag), !!r.headers['last-modified'],
      r.headers['x-content-type-options'], /sandbox/.test(r.headers['content-security-policy'])], ['bytes', 'audio/mpeg', '1000', true, true, 'nosniff', true]);
    const etag = r.headers.etag, lastMod = r.headers['last-modified'];
    const range = async (h) => { const x = await call('GET', RAW, { token: 'rea', headers: { Range: h } }); return [x.status, x.headers['content-range'] || null, x.body.length, x]; };
    let q = await range('bytes=0-9');
    eq('range: first bytes', [q[0], q[1], q[2], same(new Uint8Array(q[3].body), A_MP3.slice(0, 10))], [206, 'bytes 0-9/1000', 10, true]);
    q = await range('bytes=100-199');
    eq('range: middle', [q[0], q[1], q[2], same(new Uint8Array(q[3].body), A_MP3.slice(100, 200)), q[3].headers['content-length']], [206, 'bytes 100-199/1000', 100, true, '100']);
    q = await range('bytes=-50');
    eq('range: suffix', [q[0], q[1], same(new Uint8Array(q[3].body), A_MP3.slice(950))], [206, 'bytes 950-999/1000', true]);
    q = await range('bytes=990-');
    eq('range: open-ended', [q[0], q[1], q[2]], [206, 'bytes 990-999/1000', 10]);
    q = await range('bytes=1000-');
    eq('range: beyond the end', [q[0], q[1], q[3].json().code], [416, 'bytes */1000', 'bad-range']);
    q = await range('bytes=abc');
    eq('range: invalid header ignored', [q[0], q[2]], [200, 1000]);
    q = await range('bytes=5000-6000, 10-19');
    eq('range: multiple -> first satisfiable', [q[0], q[1], q[2]], [206, 'bytes 10-19/1000', 10]);
    q = [await call('GET', RAW, { token: 'rea', headers: { Range: 'bytes=0-9', 'If-Range': '"stale"' } })];
    eq('range: stale If-Range -> whole file', [q[0].status, q[0].body.length], [200, 1000]);
    r = await call('HEAD', RAW, { token: 'rea' });
    eq('HEAD', [r.status, r.headers['content-length'], r.body.length, r.headers['accept-ranges']], [200, '1000', 0, 'bytes']);
    r = await call('GET', RAW, { token: 'rea', headers: { 'If-None-Match': etag } });
    eq('ETag -> 304', [r.status, r.body.length, r.headers.etag], [304, 0, etag]);
    eq('If-Modified-Since -> 304', (await call('GET', RAW, { token: 'rea', headers: { 'If-Modified-Since': lastMod } })).status, 304);
    eq('other ETag -> 200', (await call('GET', RAW, { token: 'rea', headers: { 'If-None-Match': '"x"' } })).status, 200);
    r = await call('GET', F + `raw/${M}/${encodePath('Ünïcode name.mp3')}?download=1`, { token: 'rea' });
    eq('download=1: Content-Disposition', [r.status, r.headers['content-disposition']], [200, 'attachment; filename="_n_code name.mp3"; filename*=UTF-8\'\'%C3%9Cn%C3%AFcode%20name.mp3']);
    r = await call('GET', F + `raw/${M}/${encodePath('space and #hash%.mp3')}`, { token: 'rea' });
    eq('raw: encoded special characters', [r.status, r.text], [200, 'data of space and #hash%.mp3']);
    r = await call('GET', F + `raw/${M}/empty.bin`, { token: 'rea' });
    eq('raw: empty file', [r.status, r.headers['content-length'], r.body.length], [200, '0', 0]);
    eq('raw: a folder -> 400', [(r = await call('GET', F + `raw/${M}/sub`, { token: 'rea' })).status, r.json().code], [400, 'is-directory']);
    eq('raw: the root -> 400', (await call('GET', F + `raw/${M}/`, { token: 'rea' })).status, 400);
    eq('raw: hidden names are served by path', (await call('GET', F + `raw/${M}/.git/config`, { token: 'rea' })).status, 200);
    eq('raw: wrong method', [(r = await call('DELETE', RAW, { token: 'own' })).status, r.headers.allow], [405, 'GET, HEAD, PUT']);
    eq('unknown endpoint', (await call('GET', F + 'nope', { token: 'rea' })).status, 404);

    // --- traversal ------------------------------------------------------------------------------------------------
    const secretAbs = path.join(outside, 'secret.txt');
    const evil = ['..%2foutside%2fsecret.txt', '%2e%2e/outside/secret.txt', '%2E%2E%2Foutside%2Fsecret.txt', '..', '../outside/secret.txt', 'sub/../../outside/secret.txt',
      '%5c..%5coutside%5csecret.txt', '..%5c..%5coutside%5csecret.txt', '/' + secretAbs.replace(/\\/g, '/'), encodeURIComponent(secretAbs), '%2F' + encodeURIComponent(secretAbs),
      'C:/Windows/win.ini', 'c%3a%5cWindows%5cwin.ini', 'a.mp3:stream', 'a.mp3%3a%24DATA', 'a.mp3%00.txt', '%00', 'con', 'NUL.txt', 'a.mp3.', 'a.mp3%20', '%zz',
      'sub%2f..%2f..%2foutside%2fsecret.txt', '....//outside/secret.txt', '.%2e/outside/secret.txt', 'sub/%2e%2e/%2e%2e/outside/secret.txt', '%c0%ae%c0%ae/outside/secret.txt'];
    const evilResults = [];
    for (const e of evil) {
      for (const op of ['raw', 'stat', 'list']) {
        const x = await call('GET', F + `${op}/${M}/${e}`, { token: 'own' });
        if (![400, 403, 404].includes(x.status) || x.text.includes('TOP-SECRET') || x.text.includes(outside)) evilResults.push(`${op}/${e} -> ${x.status}`);
      }
    }
    eq('traversal attempts fail', evilResults, []);
    eq('traversal: codes', [(await call('GET', F + `raw/${M}/..%2fx`, { token: 'rea' })).json().code, (await call('GET', F + `raw/${M}/%zz`, { token: 'rea' })).json().code], ['bad-path', 'bad-path']);
    eq('traversal through the mount id', (await call('GET', F + 'raw/..%2f..%2f/outside/secret.txt', { token: 'own' })).status, 404);
    ok('resolveSafe refuses escapes', resolveSafe({ fs, path }, root, '../outside/secret.txt') === null && resolveSafe({ fs, path }, root, '.git/config') === null
      && resolveSafe({ fs, path }, root, '.git/config', { allowHidden: true }) === path.join(root, '.git', 'config')
      && resolveSafe({ fs, path }, root, 'new/folder/x.txt') === path.join(root, 'new', 'folder', 'x.txt'));
    if (links) {
      eq('links: escaping links are not listed', names(await call('GET', F + `list/${L}/`, { token: 'rea' })).filter((n) => n !== 'secret-link.txt'), ['inner', 'real']);
      eq('links: recursive listing follows inside links once', names(await call('GET', F + `list/${L}/?recursive=1`, { token: 'rea' })), ['inner', 'inner/x.txt', 'real']);
      r = await call('GET', F + `raw/${L}/escape/secret.txt`, { token: 'own' });
      eq('links: junction out of the root refused', [r.status, r.text.includes('TOP-SECRET')], [403, false]);
      eq('links: list through the escaping junction refused', (await call('GET', F + `list/${L}/escape`, { token: 'own' })).status, 403);
      eq('links: junction inside the root followed', (await call('GET', F + `raw/${L}/inner/x.txt`, { token: 'rea' })).text, 'inside');
      eq('links: upload through an escaping junction refused', (await call('PUT', F + `raw/${U}/escape/planted.txt`, { token: 'wri', body: 'x' })).status, 403);
      ok('links: nothing planted outside', !fs.existsSync(path.join(outside, 'planted.txt')));
      ok('resolveSafe refuses the junction', resolveSafe({ fs, path }, dirs.linked, 'escape/secret.txt') === null && resolveSafe({ fs, path }, dirs.linked, 'escape/new.txt') === null);
    }
    if (fileLink) {
      r = await call('GET', F + `raw/${L}/secret-link.txt`, { token: 'own' });
      eq('links: file symlink out of the root refused', [r.status, r.text.includes('TOP-SECRET')], [403, false]);
    }

    // --- auth -----------------------------------------------------------------------------------------------------
    eq('auth: list without a token', [(r = await call('GET', F + `list/${M}/`)).status, r.json().code], [401, 'unauthorized']);
    eq('auth: wrong token', [(r = await call('GET', F + `list/${M}/`, { token: 'wrong' })).status, r.json().code], [403, 'forbidden']);
    eq('auth: reader cannot PUT', [(r = await call('PUT', F + `raw/${U}/r.txt`, { token: 'rea', body: 'x' })).status, r.json().code], [403, 'forbidden']);
    eq('auth: query token for raw', [(r = await call('GET', RAW + '?t=rea')).status, r.body.length], [200, 1000]);
    eq('auth: query token for thumb', (await call('GET', F + `thumb/${M}/cover.jpg?t=rea`)).status, 200);
    eq('auth: query token not for list', (await call('GET', F + `list/${M}/?t=rea`)).status, 401);
    eq('auth: query token not for PUT', (await call('PUT', F + `raw/${U}/q.txt?t=own`, { body: 'x' })).status, 401);
    eq('auth: reader cannot add mounts', (await call('POST', F + 'mounts', { token: 'rea', body: JSON.stringify({ path: dirs.extra }) })).status, 403);

    // --- CORS -----------------------------------------------------------------------------------------------------
    r = await call('OPTIONS', F + `raw/${M}/a.mp3`, { headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,range' } });
    eq('CORS preflight allowed', [r.status, r.headers['access-control-allow-origin'], /Range/.test(r.headers['access-control-allow-headers']), /PUT/.test(r.headers['access-control-allow-methods']),
      r.headers['access-control-max-age'], r.headers.vary, r.headers['access-control-allow-credentials']], [204, 'https://app.example', true, true, '600', 'Origin', undefined]);
    r = await call('OPTIONS', F + `raw/${M}/a.mp3`, { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    eq('CORS preflight refused', [r.status, r.headers['access-control-allow-origin']], [403, undefined]);
    r = await call('OPTIONS', F + 'info', { headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true' } });
    eq('CORS private network', r.headers['access-control-allow-private-network'], 'true');
    r = await call('GET', RAW, { token: 'rea', headers: { Origin: 'https://app.example', Range: 'bytes=0-1' } });
    eq('CORS on a response', [r.headers['access-control-allow-origin'], /Content-Range/.test(r.headers['access-control-expose-headers']), r.headers.vary], ['https://app.example', true, 'Origin']);
    eq('CORS: the null origin (file:// pages)', (await call('GET', F + 'info', { token: 'rea', headers: { Origin: 'null' } })).headers['access-control-allow-origin'], 'null');
    r = await call('GET', F + 'info', { token: 'rea', headers: { Origin: 'https://evil.example' } });
    eq('CORS: foreign origin gets no CORS headers', [r.status, r.headers['access-control-allow-origin'], r.headers.vary], [200, undefined, 'Origin']);
    eq('CORS: "*"', (await call('GET', '/api2/fs/info', { headers: { Origin: 'https://any.example' } })).headers['access-control-allow-origin'], '*');
    r = await call('POST', F + 'mounts', { token: 'own', headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, body: JSON.stringify({ path: dirs.extra }) });
    eq('CORS: writes from a foreign origin refused', [r.status, api1.mounts().length], [403, 3]);
    eq('CORS: same-origin writes pass', (await call('PUT', F + `raw/${U}/same-origin.txt`, { token: 'wri', headers: { Origin: origin }, body: 'x' })).status, 201);

    // --- uploads ------------------------------------------------------------------------------------------------
    const PUTU = F + `raw/${U}/`;
    r = await call('PUT', PUTU + 'new.txt', { token: 'wri', body: 'hello' });
    eq('upload: new file', [r.status, r.json().size, r.json().path, r.json().mount, fs.readFileSync(path.join(up, 'new.txt'), 'utf8')], [201, 5, 'new.txt', U, 'hello']);
    eq('upload: existing file refused', [(r = await call('PUT', PUTU + 'new.txt', { token: 'wri', body: 'again' })).status, r.json().code], [409, 'exists']);
    eq('upload: overwrite=0 refused', (await call('PUT', PUTU + 'new.txt?overwrite=0', { token: 'wri', body: 'again' })).status, 409);
    r = await call('PUT', PUTU + 'new.txt?overwrite=1', { token: 'wri', body: 'hello world' });
    eq('upload: overwrite=1', [r.status, fs.readFileSync(path.join(up, 'new.txt'), 'utf8')], [200, 'hello world']);
    r = await call('PUT', PUTU + 'a/b/c/' + encodeURIComponent('déjà vu.txt'), { token: 'own', body: 'deep' });
    eq('upload: parent folders created', [r.status, r.json().path, fs.readFileSync(path.join(up, 'a', 'b', 'c', 'déjà vu.txt'), 'utf8')], [201, 'a/b/c/déjà vu.txt', 'deep']);
    eq('upload: onto a folder', [(r = await call('PUT', PUTU + 'a?overwrite=1', { token: 'wri', body: 'x' })).status, r.json().code], [409, 'is-directory']);
    eq('upload: read-only mount', [(r = await call('PUT', F + `raw/${M}/x.txt`, { token: 'own', body: 'x' })).status, r.json().code], [403, 'not-writable']);
    eq('upload: hidden name refused', (await call('PUT', PUTU + '.htaccess', { token: 'wri', body: 'x' })).status, 403);
    eq('upload: traversal refused', (await call('PUT', PUTU + '..%2fplanted.txt', { token: 'wri', body: 'x' })).status, 400);
    eq('upload: the root refused', (await call('PUT', PUTU, { token: 'wri', body: 'x' })).status, 400);
    ok('upload: nothing outside the mount', !fs.existsSync(path.join(tmp, 'planted.txt')));
    const big = 'z'.repeat(5000);
    eq('upload: Content-Length over the limit', [(r = await call('PUT', '/api2/fs/raw/' + mountId(dirs.up2) + '/big.bin', { body: big })).status, r.json().code], [413, 'too-large']);
    eq('upload: streamed over the limit', [(r = await call('PUT', '/api2/fs/raw/' + mountId(dirs.up2) + '/big2.bin', { body: big.slice(0, 3000), chunked: true })).status, r.json().code], [413, 'too-large']);
    eq('upload: under the limit', (await call('PUT', '/api2/fs/raw/' + mountId(dirs.up2) + '/small.bin', { body: big.slice(0, 900), chunked: true })).status, 201);
    eq('upload: nothing left by refused uploads', fs.readdirSync(dirs.up2), ['small.bin']);
    eq('upload: uploads off', [(r = await call('PUT', '/api3/fs/raw/' + U + '/off.txt', { body: 'x' })).status, r.json().code], [403, 'uploads-off']);
    const leftovers = [];
    const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.endsWith('.upload')) leftovers.push(e.name); else if (e.isDirectory() && !e.isSymbolicLink()) scan(path.join(d, e.name)); } };
    scan(up);
    eq('upload: no temporary files left', leftovers, []);

    // --- grant, single-file mounts, persistence -----------------------------------------------------------------------
    const song = path.join(dirs.single, 'song.mp3');
    r = await call('POST', F + 'grant', { token: 'own', body: JSON.stringify({ paths: [song, dirs.extra, path.join(root, 'sub', 'c.ogg'), root, path.join(tmp, 'nope'), 'relative/x'] }) });
    const gr = r.json();
    const FM = mountId(song), EM = mountId(dirs.extra);
    eq('grant', gr.map((x) => [x.mount, x.path, x.dir, x.code || null]),
      [[FM, 'song.mp3', false, null], [EM, '', true, null], [M, 'sub/c.ogg', false, null], [M, '', true, null], [null, null, false, 'not-found'], [null, null, false, 'bad-path']]);
    const fmount = api1.mounts().find((m) => m.id === FM);
    eq('grant: single-file mount', [fmount.kind, fmount.path, fmount.writable, fmount.fixed], ['file', song, false, false]);
    eq('grant: the file mount lists its file only', names(await call('GET', F + `list/${FM}/`, { token: 'rea' })), ['song.mp3']);
    r = await call('GET', F + `raw/${FM}/song.mp3`, { token: 'rea', headers: { Range: 'bytes=0-9' } });
    eq('grant: the file is served', [r.status, same(new Uint8Array(r.body), bytes(300, 3).slice(0, 10))], [206, true]);
    eq('grant: siblings are not reachable', [(await call('GET', F + `raw/${FM}/other.mp3`, { token: 'own' })).status, (await call('GET', F + `raw/${FM}/..%2fother.mp3`, { token: 'own' })).status,
      (await call('GET', F + `list/${FM}/song.mp3`, { token: 'own' })).status], [404, 400, 400]);
    eq('grant: stat of the file mount root', (await call('GET', F + `stat/${FM}/`, { token: 'rea' })).json().dir, true);
    const count = api1.mounts().length;
    eq('grant: mounts are reused', [api1.grant([song, path.join(dirs.extra, 'x.txt')]).map((x) => [x.mount, x.path]), api1.mounts().length], [[[FM, 'song.mp3'], [EM, 'x.txt']], count]);
    eq('grant: reader refused', (await call('POST', F + 'grant', { token: 'rea', body: JSON.stringify({ paths: [song] }) })).status, 403);
    eq('resolve', [api1.resolve(FM, 'song.mp3'), api1.resolve(M, 'sub/c.ogg'), api1.resolve(M, '../outside'), api1.resolve('nope', 'x'), api1.resolve(FM, '')],
      [song, path.join(root, 'sub', 'c.ogg'), null, null, null]);
    r = await call('POST', F + 'mounts', { token: 'own', body: JSON.stringify({ path: dirs.extra2, name: 'Extra 2', writable: true }) });
    const X2 = mountId(dirs.extra2);
    eq('POST mounts', [r.status, r.json().id, r.json().name, r.json().writable, r.json().path], [200, X2, 'Extra 2', true, dirs.extra2]);
    eq('POST mounts: missing path', [(r = await call('POST', F + 'mounts', { token: 'own', body: JSON.stringify({ path: path.join(tmp, 'nope') }) })).status, r.json().code], [404, 'not-found']);
    eq('POST mounts: relative path', (await call('POST', F + 'mounts', { token: 'own', body: JSON.stringify({ path: 'music' }) })).status, 400);
    eq('POST mounts: bad JSON', (await call('POST', F + 'mounts', { token: 'own', body: '{nope' })).status, 400);
    eq('mounts persisted', storage.read(MOUNTS_KEY).map((m) => [mountId(m.path), m.name]).sort(), [[FM, 'song.mp3'], [EM, 'extra'], [X2, 'Extra 2']].sort());
    const again = createFileApi(baseOpts());
    apis.push(again);
    eq('mounts restored with the same ids', again.mounts().map((m) => [m.id, m.kind, m.fixed]),
      [[M, 'dir', true], [U, 'dir', true], [L, 'dir', true], [FM, 'file', false], [EM, 'dir', false], [X2, 'dir', false]]);
    eq('DELETE mounts', [(await call('DELETE', F + 'mounts/' + EM, { token: 'own' })).status, storage.read(MOUNTS_KEY).some((m) => mountId(m.path) === EM)], [200, false]);
    eq('DELETE a fixed mount', [(r = await call('DELETE', F + 'mounts/' + M, { token: 'own' })).status, r.json().code], [403, 'fixed']);
    eq('DELETE an unknown mount', (await call('DELETE', F + 'mounts/' + EM, { token: 'own' })).status, 404);
    eq('DELETE by a writer', (await call('DELETE', F + 'mounts/' + X2, { token: 'wri' })).status, 403);

    // --- thumbnails ---------------------------------------------------------------------------------------------
    makeCalls.length = 0;
    const TH = F + `thumb/${M}/cover.jpg?size=300`; // 300 -> 320 (the 256 one exists already: auth test)
    const tr = await Promise.all(Array.from({ length: 5 }, () => call('GET', TH, { token: 'rea' })));
    eq('thumb: concurrent requests share one generation', [tr.map((x) => x.status), makeCalls.length, makeCalls[0] && makeCalls[0].size, makeCalls[0] && makeCalls[0].kind],
      [[200, 200, 200, 200, 200], 1, 320, 'image']);
    eq('thumb: same bytes, headers', [tr.every((x) => x.body.equals(tr[0].body)), tr[0].headers['content-type'], tr[0].headers['cache-control'], !!tr[0].headers.etag],
      [true, 'image/png', 'private, max-age=86400', true]);
    r = await call('GET', TH, { token: 'rea' });
    eq('thumb: cache hit', [r.status, makeCalls.length], [200, 1]);
    eq('thumb: ETag -> 304', (await call('GET', TH, { token: 'rea', headers: { 'If-None-Match': tr[0].headers.etag } })).status, 304);
    eq('thumb: cache files on disk', fs.readdirSync(dirs.thumbs).filter((f) => f.endsWith('.png')).length, 2);
    eq('thumb: no thumbnail', [(r = await call('GET', F + `thumb/${M}/sub/deep/e.txt`, { token: 'rea' })).status, r.json().code], [404, 'no-thumb']);
    await call('GET', F + `thumb/${M}/sub/deep/e.txt`, { token: 'rea' });
    eq('thumb: failures are remembered', makeCalls.filter((c) => c.name === 'e.txt').length, 1);
    const callsBefore = makeCalls.length;
    eq('thumb: memory index hit', [(await call('GET', TH, { token: 'rea' })).status, makeCalls.length], [200, callsBefore]);
    {
      // A second instance with the same cache folder serves from disk without generating.
      let n = 0;
      const other = createFileApi({ ...baseOpts(), thumbs: { dir: dirs.thumbs, make: async () => { n++; return null; } } });
      apis.push(other);
      routes.push(['/api4/fs/', other]);
      eq('thumb: other instance hits the disk cache', [(await call('GET', `/api4/fs/thumb/${M}/cover.jpg?size=256`, { token: 'rea' })).status, n], [200, 0]);
    }
    eq('thumb: sizes are clamped', [(await call('GET', F + `thumb/${M}/a.mp3?size=5000`, { token: 'rea' })).status, makeCalls[makeCalls.length - 1].size], [200, 1024]);
    eq('thumb: off', (await call('GET', '/api2/fs/thumb/' + mountId(dirs.up2) + '/small.bin')).status, 404);

    // --- watch ----------------------------------------------------------------------------------------------------
    eq('watch: off', (await call('GET', '/api2/fs/watch')).status, 404);
    r = await call('GET', F + 'watch', { token: 'rea' });
    const seq0 = r.json().seq;
    eq('watch: current sequence', [r.status, typeof seq0, r.json().events], [200, 'number', []]);
    eq('watch: since older than the buffer', (await call('GET', F + 'watch?since=1', { token: 'rea' })).json().reset, true);
    eq('watch: since from the future', (await call('GET', F + `watch?since=${seq0 + 1000}`, { token: 'rea' })).json().reset, true);
    eq('watch: timeout=0 answers at once', (await call('GET', F + `watch?since=${seq0}&timeout=0`, { token: 'rea' })).json().events, []);
    if (!watchable) console.log('fileapi: fs.watch is not available here, watch event test skipped');
    else {
      let since = seq0, found = null;
      const t0 = Date.now();
      setTimeout(() => fs.writeFileSync(path.join(root, 'sub', 'watched.txt'), 'new'), 300);
      while (!found && Date.now() - t0 < 6000) {
        const w = (await call('GET', F + `watch?since=${since}&timeout=3`, { token: 'rea' })).json();
        if (w.reset) break;
        found = w.events.find((e) => e.mount === M && e.path === 'sub/watched.txt') || null;
        since = w.seq;
      }
      ok('watch: event for a new file', found && (found.type === 'rename' || found.type === 'change') && found.seq > seq0, found);
    }

    // --- client ---------------------------------------------------------------------------------------------------
    let requests = 0;
    const countingFetch = (...a) => { requests++; return fetch(...a); };
    const c = createFileClient({ base: origin + '/api/fs', token: 'own', fetch: countingFetch });
    eq('client: info', [(await c.info()).api, (await c.info()).scopes.length], ['in-html-fileapi', 3]);
    eq('client: mounts', (await c.mounts()).find((m) => m.id === M).path, root);
    eq('client: list', (await c.list(M, '', { recursive: true, glob: ['*.flac'], dirs: false })).entries.map((e) => e.path), ['Album 2/01.flac', 'Album 10/01.flac', 'b.flac']);
    eq('client: list of a subfolder', (await c.list(M, 'sub/deep')).entries.map((e) => e.name), ['d.wav', 'e.txt']);
    eq('client: stat', (await c.stat(M, 'Ünïcode name.mp3')).name, 'Ünïcode name.mp3');
    eq('client: read ranges', [same(await c.read(M, 'a.mp3', 10, 20), A_MP3.slice(10, 20)), (await c.read(M, 'a.mp3')).length, (await c.read(M, 'a.mp3', 990)).length,
      (await c.read(M, 'a.mp3', 1000, 1010)).length, (await c.read(M, 'a.mp3', 5, 5)).length], [true, 1000, 10, 0, 0]);
    const src = await c.source(M, 'a.mp3');
    eq('client: source after stat', [src.size, same(await src.read(0, 4), A_MP3.slice(0, 4)), same(await src.read(995, 10), A_MP3.slice(995))], [1000, true, true]);
    const src2 = c.source(M, 'a.mp3', 1000, { blockSize: 64 });
    requests = 0;
    const span = await src2.read(60, 10);
    const first = requests;
    const inner = await src2.read(62, 4);
    eq('client: source block cache', [same(span, A_MP3.slice(60, 70)), first, same(inner, A_MP3.slice(62, 66)), requests, (await src2.read(2000, 5)).length], [true, 2, true, 2, 0]);
    eq('client: source of a big read', same(await src2.read(0, 900), A_MP3.slice(0, 900)), true);
    r = await fetch(c.rawURL(M, 'space and #hash%.mp3', { download: true }));
    eq('client: rawURL with the query token', [r.status, /^attachment/.test(r.headers.get('content-disposition')), await r.text()], [200, true, 'data of space and #hash%.mp3']);
    r = await fetch(c.thumbURL(M, 'cover.jpg', 256));
    eq('client: thumbURL', [r.status, r.headers.get('content-type')], [200, 'image/png']);
    eq('client: upload bytes', (await c.upload(U, 'client/up.bin', bytes(70))).size, 70);
    let err = null;
    try { await c.upload(U, 'client/up.bin', 'again'); } catch (e) { err = e; }
    eq('client: FileApiError', [err instanceof FileApiError, err && err.status, err && err.code], [true, 409, 'exists']);
    eq('client: upload string with overwrite', [(await c.upload(U, 'client/up.bin', 'text ü', { overwrite: true })).size, fs.readFileSync(path.join(up, 'client', 'up.bin'), 'utf8')], [7, 'text ü']);
    eq('client: upload Blob', (await c.upload(U, 'client/blob.bin', new Blob([bytes(33)]))).size, 33);
    eq('client: watch', typeof (await c.watch()).seq, 'number');
    eq('client: grant and removeMount', [(await c.grant([dirs.extra]))[0].mount, (await c.removeMount(EM)).ok], [EM, true]);
    eq('client: addMount', (await c.addMount(dirs.extra, { name: 'Again' })).name, 'Again');
    const anon = createFileClient({ base: origin + '/api/fs/' });
    err = null;
    try { await anon.info(); } catch (e) { err = e; }
    eq('client: 401 keeps the body', [err && err.status, err && err.code, err && err.body && err.body.auth], [401, 'unauthorized', true]);
    err = null;
    try { await c.list('zzzzzzzzzz'); } catch (e) { err = e; }
    eq('client: 404', [err && err.status, err && err.code], [404, 'not-found']);
    ok('client: rawURL without a token has no t=', !anon.rawURL(M, 'a b.mp3').includes('t=') && anon.rawURL(M, 'a b.mp3').endsWith(`/raw/${M}/a%20b.mp3`));
  } catch (e) {
    fail++;
    console.log('FAIL fileapi: unexpected exception', e && (e.stack || e));
  } finally {
    for (const a of apis) a.close();
    await new Promise((r) => { server.close(() => r()); server.closeAllConnections(); });
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) { console.log('fileapi: could not remove', tmp, e.code); }
  }
  if (fail && logs.length) console.log('fileapi: server log\n  ' + logs.join('\n  '));

  console.log(`fileapi: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
