// mediajobs/test.js - unit tests of the media jobs: `node mediajobs/test.js` (importing the module runs nothing).
//   - argument building of every builder (exact argv for a few), ffmetadata / ffconcat escaping read back the way
//     ffmpeg reads them, parsers on canned output (ffmpeg -progress, loudnorm, ffprobe JSON, yt-dlp lines and JSON)
//   - tool lookup on fake file systems (Windows, macOS, Linux), version parsing, detection with a fake spawn
//   - renderJob for bash and cmd.exe; where the shells exist, the rendered scripts run with node standing in for the
//     tools and the received argv and auxiliary files are compared with the job
//   - the queue state machine; the runner with a fake spawn (progress, captures, variables, exit codes, abort) and
//     with real processes (node as a fake ffmpeg: two-pass loudnorm, killing a process tree)
//   - real ImageMagick jobs when magick is found; ffmpeg / ffprobe jobs when they are found; yt-dlp --version only
//     (never the network). Missing tools are reported as skipped.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getToken, parseGraph } from '../ffcmd/parse.js';
import { commandLine } from '../cmdline/quote.js';
import { encodeWav } from '../wav/wav.js';
import { encodePNG } from '../png/encode.js';
import { Args, fileSafe, hashId, joinPath, makeStep, parseTime, placeholders, substitute, usesWork } from './job.js';
import { TOOLS, detectTools, findTool, parseVersion, toolCommand, toolId } from './tools.js';
import { FFMPEG_HEAD, concatList, convertAudio, convertVideo, embedMeta, extractAudio, ffmetadata, frame, joinChapters, loudnessScan, normalize, parseLoudnorm, parseProgress, progressFraction, remux, splitTracks, tagPairs, waveformImage } from './ffmpeg.js';
import { parseProbe, probeJob } from './ffprobe.js';
import { DL_TEMPLATE, downloadJob, formatSource, infoJob, infoToCatalog, isSourceRef, parseProgressLine, parseSource, sourceURL } from './ytdlp.js';
import { cells, collageJob, convertJob, coverJob, identifyJob, parseIdentify, thumbJob } from './magick.js';
import { renderJob } from './shell.js';
import { createQueue } from './queue.js';
import { makeRunner, runJob } from './runner.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// `until` polls a condition with a deadline instead of fixed sleeps: tests wait exactly as long as needed on a fast
// machine and still pass on a slow CI box; a timeout returns false so the following assertion reports the failure.
const H = FFMPEG_HEAD;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await tick(2); } return true; };

// --- readers that mimic ffmpeg ----------------------------------------------------------------------------------

// Round-trip testing strategy: escaping is verified by re-implementing the CONSUMER's parser (ffmpeg's C readers),
// not by comparing against expected strings, so the test asserts "ffmpeg will read back what we meant".
// libavformat/ffmetadec.c: lines (a backslash keeps the next byte, a line break too), ';' / '#' comment lines,
// [CHAPTER] sections with TIMEBASE / START / END, key=value split at the first unescaped '=', backslashes removed.
function readFFMetadata(text) {
  const lines = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { cur += c + (text[i + 1] ?? ''); i++; } else if (c === '\n') { lines.push(cur); cur = ''; } else cur += c;
  }
  if (cur) lines.push(cur);
  const unescape = (s) => s.replace(/\\(.)/gs, '$1');
  const tag = (l) => {
    for (let i = 0; i < l.length; i++) { if (l[i] === '\\') { i++; continue; } if (l[i] === '=') return [unescape(l.slice(0, i)), unescape(l.slice(i + 1))]; }
    return null;
  };
  if (lines[0] !== ';FFMETADATA1') throw new Error('no header');
  const out = { tags: {}, chapters: [] };
  let ch = null;
  for (const l of lines.slice(1)) {
    if (!l || l[0] === ';' || l[0] === '#') continue;
    if (l === '[CHAPTER]') { ch = { tags: {} }; out.chapters.push(ch); continue; }
    if (ch && /^TIMEBASE=/.test(l)) { ch.timebase = l.slice(9); continue; }
    if (ch && /^START=/.test(l)) { ch.start = +l.slice(6); continue; }
    if (ch && /^END=/.test(l)) { ch.end = +l.slice(4); continue; }
    const t = tag(l);
    if (t) (ch ? ch.tags : out.tags)[t[0]] = t[1];
  }
  return out;
}

// libavformat/concatdec.c: 'file' directives, the argument read with av_get_token.
function readConcat(text) {
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  if (lines[0] !== 'ffconcat version 1.0') throw new Error('no header');
  return lines.slice(1).map((l) => { if (!l.startsWith('file ')) throw new Error('not a file line: ' + l); return getToken(l, 5, '').value; });
}

// --- fakes ------------------------------------------------------------------------------------------------------

// Minimal fake of the two fs calls tools.js uses. Windows mode lowercases and converts separators to mimic the
// case-insensitive NTFS lookup, so the PATHEXT / Program Files logic can be tested on any OS.
function fakeFs(files, win) {
  const sep = win ? '\\' : '/';
  const norm = (p) => { const s = win ? String(p).replace(/\//g, '\\') : String(p); return (win ? s.toLowerCase() : s).replace(/[\\/]+$/, ''); };
  const F = new Set(files.map(norm));
  const kids = new Map();
  for (const f of files) {
    let p = win ? f.replace(/\//g, '\\') : f;
    while (p.lastIndexOf(sep) > 0) {
      const d = p.slice(0, p.lastIndexOf(sep));
      const k = norm(d);
      if (!kids.has(k)) kids.set(k, new Set());
      kids.get(k).add(p.slice(d.length + 1));
      p = d;
    }
  }
  const enoent = () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; return e; };
  return {
    statSync(p) {
      const k = norm(p);
      if (F.has(k)) return { isFile: () => true, isDirectory: () => false };
      if (kids.has(k)) return { isFile: () => false, isDirectory: () => true };
      throw enoent();
    },
    readdirSync(p) { const k = norm(p); if (!kids.has(k)) throw enoent(); return [...kids.get(k)]; },
  };
}

// Fake ChildProcess: emits 'data' Buffers like real pipes, kill() closes asynchronously with the signal (as a real
// process would), finish() is idempotent like the real 'close' event.
class FakeChild extends EventEmitter {
  constructor(pid) { super(); this.pid = pid; this.stdout = new EventEmitter(); this.stderr = new EventEmitter(); this.killed = []; this.exitCode = null; this.closed = false; }
  kill(sig = 'SIGTERM') { this.killed.push(sig); setTimeout(() => this.finish(null, sig), 1); return true; }
  out(t) { this.stdout.emit('data', typeof t === 'string' ? Buffer.from(t) : t); }
  err(t) { this.stderr.emit('data', typeof t === 'string' ? Buffer.from(t) : t); }
  finish(code, sig = null) { if (this.closed) return; this.closed = true; this.exitCode = code; this.emit('close', code, sig); }
}

// The script runs on a later macrotask, after runProcess has attached its listeners, which is the ordering a real
// spawn guarantees; calling it synchronously would emit events nobody hears.
function fakeSpawn(script) {
  const calls = [];
  const fn = (program, args, options) => {
    const child = new FakeChild(4000 + calls.length);
    const call = { program, args, options, child };
    calls.push(call);
    setTimeout(() => script(child, call, calls), 0);
    return child;
  };
  fn.calls = calls;
  return fn;
}

// --- shells -----------------------------------------------------------------------------------------------------

// On Windows only an MSYS/Git bash is accepted (uname reports MINGW/MSYS/CYGWIN): WSL's bash.exe would run the
// script in a Linux file system namespace where the Windows temp paths do not exist.
function findBash() {
  const list = [process.env.BASH];
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
      list.push(path.join(base, 'Git', 'bin', 'bash.exe'), path.join(base, 'Git', 'usr', 'bin', 'bash.exe'));
    }
  }
  list.push('bash');
  for (const b of list.filter(Boolean)) {
    try {
      const r = spawnSync(b, ['-c', 'command -v mkdir >/dev/null && uname -s'], { encoding: 'utf8', timeout: 20000 });
      if (r.status !== 0) continue;
      if (process.platform === 'win32' && !/MINGW|MSYS|CYGWIN/i.test(r.stdout)) continue;
      return b;
    } catch { /* next */ }
  }
  return null;
}

// spawnSync without blocking: { status, stdout, stderr, error }
function exec(program, args, { input = null, cwd, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    let child, out = '', err = '', done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ status: null, stdout: out, stderr: err, error: 'timeout' }); }, timeout);
    try { child = nodeSpawn(program, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { finish({ status: null, stdout: '', stderr: '', error: e.message }); return; }
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('error', (e) => finish({ status: null, stdout: out, stderr: err, error: e.message }));
    child.on('close', (status) => finish({ status, stdout: out, stderr: err }));
    child.stdin.end(input ?? undefined);
  });
}

const cmdRuns = () => { if (process.platform !== 'win32') return false; try { return spawnSync('cmd.exe', ['/d', '/c', 'exit 0'], { stdio: 'ignore' }).status === 0; } catch { return false; } };

// --- canned tool output -----------------------------------------------------------------------------------------

// Canned outputs are real tool output trimmed to the parts the parsers read. In PROGRESS out_time_ms equals
// out_time_us: that is ffmpeg's actual behaviour (the "ms" key carries microseconds).
const LOUDNORM_STDERR = `Input #0, wav, from 'in.wav':
  Duration: 00:00:05.00, bitrate: 1411 kb/s
[Parsed_loudnorm_0 @ 0000020a5c4e8f40]
{
	"input_i" : "-27.61",
	"input_tp" : "-4.47",
	"input_lra" : "18.06",
	"input_thresh" : "-39.20",
	"output_i" : "-16.58",
	"output_tp" : "-1.50",
	"output_lra" : "14.78",
	"output_thresh" : "-27.71",
	"normalization_type" : "dynamic",
	"target_offset" : "0.58"
}
[out#0/null @ 0000020a5c4e9000] video:0KiB audio:938KiB subtitle:0KiB
`;

const PROGRESS = 'frame=0\nfps=0.00\nstream_0_0_q=-0.0\nbitrate= 128.0kbits/s\ntotal_size=40000\nout_time_us=2500000\nout_time_ms=2500000\nout_time=00:00:02.500000\ndup_frames=0\ndrop_frames=0\nspeed=41.7x\nprogress=continue\n' +
  'frame=0\nfps=0.00\nbitrate= 128.0kbits/s\ntotal_size=80000\nout_time_us=5000000\nout_time_ms=5000000\nout_time=00:00:05.000000\nspeed=42.1x\nprogress=end\n';

const PROBE_MP3 = {
  streams: [
    { index: 0, codec_name: 'mp3', codec_type: 'audio', sample_rate: '44100', channels: 2, bits_per_sample: 0, duration: '215.484082', disposition: { default: 0, attached_pic: 0 }, tags: { encoder: 'LAME3.100' },
      side_data_list: [{ side_data_type: 'Replay Gain', track_gain: '-7.300000', track_peak: '0.988000' }] },
    { index: 1, codec_name: 'mjpeg', codec_type: 'video', width: 600, height: 600, r_frame_rate: '90000/1', avg_frame_rate: '0/0', disposition: { default: 0, attached_pic: 1 }, tags: { title: 'Album cover', comment: 'Cover (front)' } },
  ],
  chapters: [],
  format: { filename: 'C:\\Music\\song.mp3', nb_streams: 2, format_name: 'mp3', duration: '215.484082', size: '8700000', bit_rate: '322987',
    tags: { title: 'Песня', artist: 'Artist One; Artist Two', album: 'The Album', album_artist: 'The Band', track: '3/12', disc: '1/2', date: '2019-05-01', genre: 'Rock;Indie', comment: 'Nice', TBPM: '120', compilation: '1', 'lyrics-eng': 'la la', REPLAYGAIN_ALBUM_GAIN: '-6.10 dB' } },
};

const PROBE_MKV = {
  streams: [
    { index: 0, codec_name: 'h264', codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '24000/1001', avg_frame_rate: '24000/1001', disposition: { default: 1, forced: 0, attached_pic: 0 }, tags: { DURATION: '00:42:00.000000000' } },
    { index: 1, codec_name: 'aac', codec_type: 'audio', sample_rate: '48000', channels: 6, disposition: { default: 1 }, tags: { language: 'eng', title: 'Surround' } },
    { index: 2, codec_name: 'subrip', codec_type: 'subtitle', disposition: { default: 0, forced: 1 }, tags: { language: 'rus', title: 'Forced' } },
    { index: 3, codec_name: 'ass', codec_type: 'subtitle', disposition: { default: 0 }, tags: { language: 'und' } },
    { index: 4, codec_name: 'ttf', codec_type: 'attachment', tags: { filename: 'font.ttf', mimetype: 'font/ttf' } },
  ],
  chapters: [
    { id: 1, time_base: '1/1000000000', start: 0, start_time: '0.000000', end: 600000000000, end_time: '600.000000', tags: { title: 'Opening' } },
    { id: 2, time_base: '1/1000000000', start_time: '600.000000', end_time: '2520.000000', tags: { title: 'Part 2' } },
  ],
  format: { filename: '/v/show.mkv', format_name: 'matroska,webm', duration: '2520.042000', bit_rate: '5000000', tags: { title: 'Episode 1', SHOW: 'My Show', SEASON_NUMBER: '2', EPISODE_SORT: '5', ENCODER: 'libebml v1.4.2' } },
};

const PROBE_M4A = {
  streams: [{ index: 0, codec_name: 'aac', codec_type: 'audio', sample_rate: '44100', channels: 2, disposition: { default: 1 } }],
  format: { filename: 'x.m4a', format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '10.0', bit_rate: '256000', tags: { major_brand: 'M4A ', title: 'T', artist: 'A', 'track': '7' } },
};

const YT_VIDEO = {
  id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', extractor: 'youtube', extractor_key: 'Youtube',
  uploader: 'Rick Astley', channel: 'Rick Astley', upload_date: '20091025', duration: 212, description: 'The official video', tags: ['rick', 'astley'], categories: ['Music'],
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  thumbnails: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg', width: 120, height: 90 }, { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', width: 1280, height: 720 }, { id: 'x' }],
  chapters: [{ start_time: 0, end_time: 30, title: 'Intro' }, { start_time: 30, end_time: 212, title: 'Song' }],
  subtitles: { en: [{ ext: 'json3' }, { ext: 'vtt' }], de: [{ ext: 'vtt' }] }, automatic_captions: { fr: [{ ext: 'vtt' }] },
  vcodec: 'avc1.640028', acodec: 'mp4a.40.2', width: 1920, height: 1080, language: 'en',
};
const YT_TRACK = {
  id: 'abcdefghijk', title: 'Song', track: 'Song', artist: 'Artist A, Artist B', artists: ['Artist A', 'Artist B'], album: 'Album', release_year: 2021, track_number: 4,
  webpage_url: 'https://music.youtube.com/watch?v=abcdefghijk', extractor: 'youtube', vcodec: 'none', acodec: 'opus', duration: 180.5, genre: 'Pop',
  playlist_id: 'OLAK5uy_abcdefghijklmnopqrstuvwxyz0123456', playlist_title: 'Album', playlist_index: 4, n_entries: 10,
};
const YT_PLAYLIST = {
  _type: 'playlist', id: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', title: 'My List', extractor: 'youtube:tab', extractor_key: 'YoutubeTab',
  webpage_url: 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', playlist_count: 2, uploader: 'Someone',
  entries: [
    { _type: 'url', ie_key: 'Youtube', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'One', duration: 212, channel: 'C' },
    { _type: 'url', ie_key: 'Youtube', id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Two', duration: null, thumbnails: [{ url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', width: 480, height: 360 }] },
  ],
};
const SC_TRACK = { id: '293', title: 'Flickermood', extractor: 'soundcloud', webpage_url: 'https://soundcloud.com/forss/flickermood', uploader: 'Forss', acodec: 'mp3', vcodec: 'none', duration: 213.3 };
const EPISODE = { id: 'e1', title: 'Pilot', series: 'Show', season_number: 1, episode_number: 2, webpage_url: 'https://example.com/show/e1', extractor: 'generic' };

// ------------------------------------------------------------------------------------------------------------------

// Mixed unit/integration suite: pure builders and parsers always run; fake-spawn runner tests always run; real
// shells and real tools run only when found and are reported as skipped otherwise, so the suite is green on a
// machine without ffmpeg yet exercises everything on a developer machine. All temp files live in one mkdtemp
// folder removed in finally.
export async function run() {
  let pass = 0, fail = 0;
  const skipped = [];
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info ? '\n  ' + info : ''}`); } };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  const throws = (name, fn, re = null) => { try { fn(); fail++; console.log(`FAIL ${name}: no error`); } catch (e) { ok(name, !re || re.test(e.message), e.message); } };
  const rejects = async (name, p, re = null) => { try { await p; fail++; console.log(`FAIL ${name}: resolved`); } catch (e) { ok(name, !re || re.test(e.message) || re.test(e.name), `${e.name}: ${e.message}`); } };
  const skip = (what) => { skipped.push(what); console.log(`mediajobs: skipped ${what}`); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediajobs-test-'));
  // MEDIAJOBS_TIMES=1 prints how long each section took
  let t0 = Date.now(), section = 'start';
  const mark = (next) => { if (process.env.MEDIAJOBS_TIMES) console.log(`mediajobs: ${section} ${Date.now() - t0} ms`); section = next; t0 = Date.now(); };

  try {
    mark('job.js');
    // --- job.js -------------------------------------------------------------------------------------------------
    eq('parseTime', [75, '75', '1:15', '01:02:03.5', '0:00:00.250', '', null, 'x', '1:2:3:4'].map(parseTime), [75, 75, 75, 3723.5, 0.25, null, null, null, null]);
    eq('fileSafe', ['AC/DC: Back in Black?', 'CON', 'con.txt', 'name. ', '  a\tb\nc  ', 'Привет, мир', '<>', '..'].map((s) => fileSafe(s)),
      ['AC_DC_ Back in Black_', '_CON', '_con.txt', 'name', 'a b c', 'Привет, мир', '__', '_']);
    const long = fileSafe('Ж'.repeat(300) + '.flac');
    ok('fileSafe bytes', new TextEncoder().encode(long).length <= 200 && long.endsWith('.flac'), long.length);
    eq('joinPath', [joinPath('C:\\Music', 'a.mp3'), joinPath('/m', 'a'), joinPath('/m/', 'a'), joinPath('', 'a'), joinPath('C:/x', 'a')], ['C:\\Music\\a.mp3', '/m/a', '/m/a', 'a', 'C:/x/a']);
    eq('substitute', [substitute('{work}/a.txt', { work: 'W' }), substitute('{work}/a/b.txt', { work: 'W', join: (...p) => p.join('|') }), substitute('I={var:loudnorm.input_i}', { vars: { loudnorm: { input_i: -27.61 } } })], ['W/a.txt', 'W|a|b.txt', 'I=-27.61']);
    throws('substitute missing var', () => substitute('{var:loudnorm.input_i}', { vars: {} }), /has no value/);
    throws('substitute missing work', () => substitute('{work}/x', {}), /work folder/);
    eq('placeholders', placeholders('{work}/x {var:a.b} {other}'), [{ type: 'work' }, { type: 'var', name: 'a.b' }]);
    const ag = new Args().add('-i', 'a').add('-y').opt('-t', null).opt('-ss', 0).addIf(false, '-x');
    eq('Args', [ag.argv, ag.groups], [['-i', 'a', '-y', '-ss', '0'], [2, 1, 2]]);
    eq('makeStep defaults', makeStep({ tool: 'ffmpeg', argv: ['-i', 'x', null], groups: [5] }), { tool: 'ffmpeg', argv: ['-i', 'x'], groups: null, comment: '', files: {}, capture: null, parse: null, progress: null, duration: null });
    ok('hashId stable', hashId({ a: 1 }) === hashId({ a: 1 }) && /^[0-9a-f]{8}$/.test(hashId('x')));

    mark('tools.js');
    // --- tools.js -----------------------------------------------------------------------------------------------
    eq('TOOLS bins', Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.bin])), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp', magick: 'magick' });
    eq('toolId', [toolId('yt-dlp'), toolId('magick')], ['ytdlp', 'magick']);
    eq('toolCommand', [toolCommand({ 'yt-dlp': '/y' }, 'yt-dlp'), toolCommand({ ytdlp: ['python', '-m', 'yt_dlp'] }, 'yt-dlp'), toolCommand({ magick: { path: 'M', version: '7' } }, 'magick'), toolCommand({ ffmpeg: null }, 'ffmpeg'), toolCommand({}, 'ffprobe')],
      [['/y'], ['python', '-m', 'yt_dlp'], ['M'], null, null]);
    const winFiles = ['C:\\tools\\ffmpeg.exe', 'C:\\tools\\yt-dlp.cmd', 'C:\\Windows\\System32\\convert.exe', 'C:\\Program Files\\ImageMagick-7.1.0-Q16\\magick.exe',
      'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe', 'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\ffmpeg.exe', 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\yt-dlp.exe',
      'C:\\Users\\u\\scoop\\shims\\ffprobe.exe', 'D:\\portable\\ffmpeg.exe'];
    const winOpts = { platform: 'win32', path: path.win32, fs: fakeFs(winFiles, true), env: { Path: 'C:\\Windows\\System32;"C:\\tools"', PATHEXT: '.COM;.EXE;.BAT;.CMD', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', USERPROFILE: 'C:\\Users\\u' } };
    eq('findTool windows', ['ffmpeg', 'ffprobe', 'yt-dlp', 'magick'].map((b) => findTool(b, winOpts)),
      ['C:\\tools\\ffmpeg.exe', 'C:\\Users\\u\\scoop\\shims\\ffprobe.exe', 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\yt-dlp.exe', 'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe']);
    eq('findTool configured', [findTool('ffmpeg', { ...winOpts, configured: 'D:\\portable\\ffmpeg.exe' }), findTool('ffmpeg', { ...winOpts, configured: 'D:\\portable' }), findTool('ffmpeg', { ...winOpts, configured: 'D:\\missing.exe' })],
      ['D:\\portable\\ffmpeg.exe', 'D:\\portable\\ffmpeg.exe', 'C:\\tools\\ffmpeg.exe']);
    eq('findTool windows: no system convert', findTool('magick', { ...winOpts, fs: fakeFs(['C:\\Windows\\System32\\convert.exe'], true) }), null);
    eq('findTool windows: ffmpeg in ImageMagick folder', findTool('ffmpeg', { ...winOpts, env: { ...winOpts.env, Path: '' } }), 'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\ffmpeg.exe');
    const nix = { platform: 'linux', path: path.posix, fs: fakeFs(['/usr/bin/convert', '/home/u/.local/bin/yt-dlp', '/opt/x/ffmpeg'], false), env: { PATH: '/bin', HOME: '/home/u' } };
    eq('findTool linux', [findTool('magick', nix), findTool('yt-dlp', nix), findTool('ffmpeg', nix), findTool('ffmpeg', { ...nix, extra: ['/opt/x'] })], ['/usr/bin/convert', '/home/u/.local/bin/yt-dlp', null, '/opt/x/ffmpeg']);
    eq('findTool macos', findTool('ffmpeg', { platform: 'darwin', path: path.posix, fs: fakeFs(['/opt/homebrew/bin/ffmpeg'], false), env: { PATH: '/usr/bin' } }), '/opt/homebrew/bin/ffmpeg');
    eq('parseVersion', [
      parseVersion('ffmpeg', 'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers\nbuilt with gcc 13'),
      parseVersion('C:\\ff\\ffprobe.exe', 'ffprobe version 2024-03-07-git-97beb63a66-full_build-www.gyan.dev Copyright'),
      parseVersion('yt-dlp', '2024.08.06\n'),
      parseVersion('magick', 'Version: ImageMagick 7.1.2-0 Q16-HDRI x64 3a1a1b5:20250712 https://imagemagick.org\nCopyright: (C)'),
      parseVersion('/usr/bin/convert', 'Version: ImageMagick 6.9.11-60 Q16 x86_64 2021-01-25'),
      parseVersion('magick', 'nothing here'),
    ], ['6.1.1-3ubuntu5', '2024-03-07-git-97beb63a66-full_build-www.gyan.dev', '2024.08.06', '7.1.2-0', '6.9.11-60', null]);
    {
      const sp = fakeSpawn((child, call) => {
        if (/ffprobe/.test(call.program)) { child.emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })); return; }
        if (/yt-dlp/.test(call.program)) { child.out('2025.01.15\n'); child.finish(0); return; }
        if (/magick/.test(call.program)) { child.out('Version: ImageMagick 7.1.1-38 Q16-HDRI x64\n'); child.finish(0); return; }
        child.out('ffmpeg version 7.1 Copyright (c) 2000-2024\n'); child.finish(0);
      });
      const r = await detectTools({ ...winOpts, spawn: sp, timeout: 1000 });
      eq('detectTools (fake)', r, {
        ffmpeg: { path: 'C:\\tools\\ffmpeg.exe', version: '7.1' }, ffprobe: null,
        'yt-dlp': { path: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\yt-dlp.exe', version: '2025.01.15' },
        magick: { path: 'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe', version: '7.1.1-38' },
      });
      eq('detectTools version args', sp.calls.map((c) => [path.win32.basename(c.program), c.args[0], c.options.windowsHide]).sort(), [['ffmpeg.exe', '-version', true], ['ffprobe.exe', '-version', true], ['magick.exe', '-version', true], ['yt-dlp.exe', '--version', true]]);
      const hang = fakeSpawn(() => {});
      const t0 = Date.now();
      const r2 = await detectTools({ ...winOpts, spawn: hang, timeout: 50 });
      ok('detectTools timeout', Date.now() - t0 < 2000 && r2.ffmpeg && r2.ffmpeg.version === null && hang.calls.every((c) => c.child.killed.length === 1), JSON.stringify(r2));
    }
    const real = await detectTools({ spawn: nodeSpawn, env: process.env, platform: process.platform, fs, path });
    console.log('mediajobs: tools here: ' + Object.entries(real).map(([k, v]) => `${k} ${v ? v.version + ' (' + v.path + ')' : 'not found'}`).join(', '));
    ok('detectTools (real) shape', ['ffmpeg', 'ffprobe', 'yt-dlp', 'magick'].every((k) => k in real && (real[k] === null || (typeof real[k].path === 'string' && path.isAbsolute(real[k].path)))), JSON.stringify(real));
    if (real.magick) ok('detectTools magick version', /^[67]\./.test(real.magick.version || ''), real.magick.version);

    mark('ffmpeg.js builders');
    // --- ffmpeg.js builders --------------------------------------------------------------------------------------
    const tagsMp3 = { title: 'Title = 1', artist: 'Artist', album: 'Album', albumArtist: 'Band', track: 3, trackTotal: 12, disc: 1, year: 2020, genre: ['Rock', 'Pop'], comment: null, mediaType: 1 };
    eq('tagPairs', tagPairs(tagsMp3), [['title', 'Title = 1'], ['artist', 'Artist'], ['album', 'Album'], ['album_artist', 'Band'], ['genre', 'Rock; Pop'], ['media_type', '1'], ['track', '3/12'], ['disc', '1'], ['date', '2020']]);
    const ca = convertAudio({ input: 'in.flac', output: 'out.mp3', quality: 'high', tags: tagsMp3, cover: 'cover.jpg' });
    eq('convertAudio mp3 argv', ca.steps[0].argv, [...H, '-i', 'in.flac', '-i', 'cover.jpg', '-map', '0:a:0', '-map', '1:v:0', '-c:a', 'libmp3lame', '-q:a', '0',
      '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)',
      '-metadata', 'title=Title = 1', '-metadata', 'artist=Artist', '-metadata', 'album=Album', '-metadata', 'album_artist=Band', '-metadata', 'genre=Rock; Pop', '-metadata', 'media_type=1',
      '-metadata', 'track=3/12', '-metadata', 'disc=1', '-metadata', 'date=2020', '-id3v2_version', '3', 'out.mp3']);
    eq('convertAudio job', [ca.kind, ca.outputs, ca.steps.length, ca.steps[0].tool, ca.steps[0].progress, ca.steps[0].groups.reduce((a, b) => a + b, 0) === ca.steps[0].argv.length], ['ffmpeg.convertAudio', ['out.mp3'], 1, 'ffmpeg', 'ffmpeg', true]);
    const keep = convertAudio({ input: 'a.m4a', output: 'b.flac', quality: 'lossless' });
    eq('convertAudio keeps the input cover', keep.steps[0].argv.slice(H.length), ['-i', 'a.m4a', '-map', '0:a:0', '-map', '0:v:0?', '-c:a', 'flac', '-compression_level', '8', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)', 'b.flac']);
    const opus = convertAudio({ input: 'a.mp3', output: 'b.opus', quality: 'med', cover: 'c.jpg', start: 10, end: '0:40', sampleRate: 48000, channels: 1 });
    eq('convertAudio opus argv', opus.steps[0].argv.slice(H.length), ['-ss', '10', '-i', 'a.mp3', '-map', '0:a:0', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '1', '-t', '30', 'b.opus']);
    ok('convertAudio opus cover note', /cannot embed a cover/.test(opus.notes?.[0] || '') && opus.steps[0].duration === 30, JSON.stringify(opus.notes));
    ok('convertAudio aac tags note', /ADTS/.test(convertAudio({ input: 'a.wav', output: 'b.aac', tags: { title: 'x' } }).notes?.join(' ') || ''));
    eq('convertAudio ogg / wav codecs', [convertAudio({ input: 'a', output: 'b.ogg', quality: 'low' }).steps[0].argv.slice(-5), convertAudio({ input: 'a', output: 'b.wav', bits: 24 }).steps[0].argv.slice(-3)],
      [['-c:a', 'libvorbis', '-q:a', '3', 'b.ogg'], ['-c:a', 'pcm_s24le', 'b.wav']]);
    const two = convertAudio({ input: 'in.wav', output: 'out.m4a', loudnorm: { I: -14 }, duration: 5 });
    eq('loudnorm two-pass: pass 1', two.steps[0].argv, [...H, '-i', 'in.wav', '-map', '0:a:0', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
    eq('loudnorm two-pass: pass 2', two.steps[1].argv.slice(H.length), ['-i', 'in.wav', '-map', '0:a:0', '-af',
      'loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={var:loudnorm.input_i}:measured_TP={var:loudnorm.input_tp}:measured_LRA={var:loudnorm.input_lra}:measured_thresh={var:loudnorm.input_thresh}:offset={var:loudnorm.target_offset}:linear=true:print_format=summary',
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', 'out.m4a']);
    eq('loudnorm two-pass: steps', two.steps.map((s) => [s.parse, s.duration]), [['loudnorm', 5], [null, 5]]);
    const nm = normalize({ input: 'a.mp3', output: 'b.mp3', target: { I: -16, TP: -1, LRA: 9 }, measured: { input_i: -20.5, input_tp: -2, input_lra: 7.25, input_thresh: -31, target_offset: 0.3 } });
    eq('normalize with measured values', [nm.kind, nm.steps.length, nm.steps[0].argv[nm.steps[0].argv.indexOf('-af') + 1]],
      ['ffmpeg.loudnorm', 1, 'loudnorm=I=-16:TP=-1:LRA=9:measured_I=-20.5:measured_TP=-2:measured_LRA=7.25:measured_thresh=-31:offset=0.3:linear=true:print_format=summary']);
    eq('normalize two steps', normalize({ input: 'a.mp3', output: 'b.mp3', target: {} }).steps.map((s) => s.parse), ['loudnorm', null]);
    const nv = normalize({ input: 'film.mkv', output: 'film2.mkv', target: {} }).steps[1].argv.slice(H.length);
    eq('normalize a video', nv.slice(0, 10), ['-i', 'film.mkv', '-map', '0:v?', '-map', '0:a:0', '-map', '0:s?', '-c', 'copy']);
    eq('loudnessScan', loudnessScan({ input: 'a.flac', I: -23, TP: -2, LRA: 7 }).steps[0], makeStep({ tool: 'ffmpeg', argv: [...H, '-i', 'a.flac', '-map', '0:a:0', '-af', 'loudnorm=I=-23:TP=-2:LRA=7:print_format=json', '-f', 'null', '-'],
      groups: [3, 3, 2, 2, 2, 3], comment: 'Measure the loudness (target -23 LUFS)', parse: 'loudnorm', progress: 'ffmpeg' }));
    eq('convertVideo mp4', convertVideo({ input: 'in.mkv', output: 'out.mp4', quality: 'high', maxHeight: 720 }).steps[0].argv.slice(H.length),
      ['-i', 'in.mkv', '-map', '0:v:0', '-map', '0:a?', '-vf', 'scale=-2:trunc(min(ih\\,720)/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-sn', 'out.mp4']);
    const burn = convertVideo({ input: 'C:\\Movies\\a.mkv', output: 'a.mp4', subtitles: 'burn', start: 60, end: 90, crf: 20, preset: 'slow', audio: false, maxHeight: 480 }).steps[0].argv.slice(H.length);
    const vf = burn[burn.indexOf('-vf') + 1];
    eq('convertVideo burn + crf + preset', burn.filter((a) => a !== vf), ['-i', 'C:\\Movies\\a.mkv', '-ss', '60', '-t', '30', '-map', '0:v:0', '-vf', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-sn', 'a.mp4']);
    eq('convertVideo burn filter read back', parseGraph(vf)[0].filters.map((x) => [x.name, x.opts]), [['subtitles', [['filename', 'C:\\Movies\\a.mkv'], ['si', '0']]], ['scale', [[null, '-2'], [null, 'trunc(min(ih,480)/2)*2']]]]);
    const webm = convertVideo({ input: 'a.mp4', output: 'a.webm', subtitles: 'copy', start: 5 }).steps[0].argv;
    ok('convertVideo webm subtitles', webm.includes('libvpx-vp9') && webm.join(' ').includes('-map 0:s? ') && webm.join(' ').includes('-c:s webvtt') && webm.indexOf('-ss') < webm.indexOf('-i'), webm.join(' '));
    throws('convertVideo format', () => convertVideo({ input: 'a', output: 'b.avi' }), /format/);
    eq('remux all', remux({ input: 'a.mkv', output: 'a.mp4' }).steps[0].argv.slice(H.length), ['-i', 'a.mkv', '-map', '0', '-c', 'copy', '-c:s', 'mov_text', '-movflags', '+faststart', 'a.mp4']);
    eq('remux av', remux({ input: 'a.mp4', output: 'a.mkv', streams: 'av' }).steps[0].argv.slice(H.length), ['-i', 'a.mp4', '-map', '0:v?', '-map', '0:a?', '-c', 'copy', 'a.mkv']);
    eq('extractAudio copy', extractAudio({ input: 'v.mp4', output: 'a.m4a' }).steps[0].argv.slice(H.length), ['-i', 'v.mp4', '-map', '0:a:0', '-c:a', 'copy', '-movflags', '+faststart', 'a.m4a']);
    const ex = extractAudio({ input: 'v.mp4', output: 'a.mp3', copy: false, quality: 'med' });
    eq('extractAudio encode', [ex.kind, ex.steps[0].argv.slice(H.length)], ['ffmpeg.extractAudio', ['-i', 'v.mp4', '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '4', '-id3v2_version', '3', 'a.mp3']]);
    eq('output starting with a dash', extractAudio({ input: 'v.mp4', output: '-a.m4a' }).steps[0].argv.slice(-1), ['./-a.m4a']);

    const sp = splitTracks({ input: 'C:\\Rips\\album.flac', outDir: 'C:\\Music\\Album', album: 'Album', albumArtist: 'Band', year: 1999, genre: 'Jazz', cover: 'C:\\Rips\\cover.jpg',
      tracks: [{ title: 'Intro: "The" Beginning?', start: 0 }, { title: 'Two', start: '3:05.5', artist: 'Guest' }, { title: 'Two', start: 400, end: 520 }] });
    eq('splitTracks outputs', sp.outputs, ['C:\\Music\\Album\\01 Intro_ _The_ Beginning_.flac', 'C:\\Music\\Album\\02 Two.flac', 'C:\\Music\\Album\\03 Two.flac']);
    eq('splitTracks track 2', sp.steps[1].argv.slice(H.length), ['-ss', '185.5', '-i', 'C:\\Rips\\album.flac', '-i', 'C:\\Rips\\cover.jpg', '-t', '214.5', '-map', '0:a:0', '-map', '1:v:0',
      '-c:a', 'flac', '-compression_level', '8', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)',
      '-map_metadata', '-1', '-map_chapters', '-1', '-metadata', 'title=Two', '-metadata', 'artist=Guest', '-metadata', 'album=Album', '-metadata', 'album_artist=Band', '-metadata', 'genre=Jazz',
      '-metadata', 'track=2/3', '-metadata', 'date=1999', 'C:\\Music\\Album\\02 Two.flac']);
    eq('splitTracks durations', sp.steps.map((s) => [s.duration, s.comment]), [[185.5, 'Track 1: Intro: "The" Beginning?'], [214.5, 'Track 2: Two'], [120, 'Track 3: Two']]);
    const sp2 = splitTracks({ input: 'a.mp3', copy: true, pattern: '{artist} - {title}.{ext}', tracks: [{ title: 'X', artist: 'A/B', start: 0, end: 10 }, { title: 'X', artist: 'A/B', start: 10 }] });
    eq('splitTracks copy + duplicate names', [sp2.outputs, sp2.steps[1].argv.includes('-t'), sp2.steps[0].argv.slice(sp2.steps[0].argv.indexOf('-c:a'), sp2.steps[0].argv.indexOf('-c:a') + 4)], [['A_B - X.mp3', 'A_B - X (2).mp3'], false, ['-c:a', 'copy', '-c:v', 'copy']]);

    const jc = joinChapters({ inputs: [{ path: '/books/01 It\'s "one".mp3', title: 'Chapter = 1; #a', duration: 61.5 }, { path: '/books/02 Два.mp3', duration: 120.25 }], output: '/out/book.m4b', tags: { title: 'Book', artist: 'Author', genre: 'Audiobook' }, cover: '/books/cover.jpg' });
    eq('joinChapters argv', jc.steps[0].argv.slice(H.length), ['-f', 'concat', '-safe', '0', '-i', '{work}/list.ffconcat', '-f', 'ffmetadata', '-i', '{work}/chapters.txt', '-i', '/books/cover.jpg',
      '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1', '-map', '2:v:0', '-c:a', 'aac', '-b:a', '128k', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-movflags', '+faststart', '/out/book.m4b']);
    eq('joinChapters list', readConcat(jc.steps[0].files['list.ffconcat']), ['/books/01 It\'s "one".mp3', '/books/02 Два.mp3']);
    const md = readFFMetadata(jc.steps[0].files['chapters.txt']);
    eq('joinChapters chapters', md, { tags: { title: 'Book', artist: 'Author', genre: 'Audiobook' }, chapters: [
      { tags: { title: 'Chapter = 1; #a' }, timebase: '1/1000', start: 0, end: 61500 }, { tags: { title: '02 Два' }, timebase: '1/1000', start: 61500, end: 181750 }] });
    eq('joinChapters duration', [jc.steps[0].duration, usesWork(jc)], [181.75, true]);
    eq('joinChapters mka attach', joinChapters({ inputs: [{ path: 'a.opus', duration: 1 }], output: 'b.mka', cover: 'c.png', copy: true }).steps[0].argv.slice(-8),
      ['-c:a', 'copy', '-attach', 'c.png', '-metadata:s:t:0', 'mimetype=image/png', '-metadata:s:t:0', 'filename=cover.png', 'b.mka'].slice(-8));
    throws('joinChapters needs durations', () => joinChapters({ inputs: [{ path: 'a.mp3' }], output: 'b.m4b' }), /duration/);

    const em = embedMeta({ input: 'a.mp3', output: 'b.mp3', tags: { title: 'New' }, cover: 'c.jpg', chapters: [{ start: 0, title: 'A' }, { start: 30, title: 'B' }], duration: 60 });
    eq('embedMeta argv', em.steps[0].argv.slice(H.length), ['-i', 'a.mp3', '-f', 'ffmetadata', '-i', '{work}/chapters.txt', '-i', 'c.jpg', '-map', '0:a', '-map', '2:v:0', '-c', 'copy', '-map_metadata', '0', '-map_chapters', '1',
      '-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)', '-metadata', 'title=New', '-id3v2_version', '3', 'b.mp3']);
    eq('embedMeta chapters', readFFMetadata(em.steps[0].files['chapters.txt']).chapters.map((c) => [c.start, c.end, c.tags.title]), [[0, 30000, 'A'], [30000, 60000, 'B']]);
    eq('embedMeta video tags only', embedMeta({ input: 'v.mp4', output: 'w.mp4', tags: { title: 'T' } }).steps[0].argv.slice(H.length), ['-i', 'v.mp4', '-map', '0', '-c', 'copy', '-map_metadata', '0', '-metadata', 'title=T', '-movflags', '+faststart', 'w.mp4']);
    eq('frame', frame({ input: 'v.mkv', output: 'cover.jpg', at: '0:01:30', width: 600 }).steps[0].argv.slice(H.length), ['-ss', '90', '-i', 'v.mkv', '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=600:-2', '-q:v', '2', '-update', '1', 'cover.jpg']);
    ok('waveformImage', waveformImage({ input: 'a.mp3', output: 'w.png', width: 800, height: 100 }).steps[0].argv.includes('[0:a:0]showwavespic=s=800x100:colors=#3b82f6:split_channels=0[wave]'));

    // ffmetadata / ffconcat escaping read back like ffmpeg reads them
    const TRICKY = ["It's", 'a=b', 'semi;colon', '#hash', ';lead', 'back\\slash', 'line1\nline2', 'crlf\r\nend', 'Привет, мир', '  spaces  ', '[CHAPTER]', '\\', '=', 'end\\'];
    const back = readFFMetadata(ffmetadata({ title: 'x' }, TRICKY.map((t, i) => ({ start: i, end: i + 1, title: t }))));
    eq('ffmetadata round trip', back.chapters.map((c) => c.tags.title), TRICKY.map((t) => t.replace(/\r\n/g, '\n')));
    eq('ffmetadata keys escaped', readFFMetadata(ffmetadata({ 'we=ird;key': 'v#1' })).tags, { 'we=ird;key': 'v#1' });
    const PATHS = ["it's.mp3", "a''b.mp3", 'a "b" c.mp3', 'C:\\Music\\x y.mp3', 'Привет мир.mp3', '#1.mp3', 'back\\slash\\', '/abs/path/ok.flac', ' lead space.mp3'];
    eq('concatList round trip', readConcat(concatList(PATHS)), PATHS);
    throws('concatList line break', () => concatList(['a\nb.mp3']), /line break/);

    // progress and loudnorm parsers
    const whole = parseProgress(PROGRESS);
    eq('parseProgress', [whole.outTime, whole.speed, whole.frame, whole.fps, whole.totalSize, whole.bitrate, whole.done], [5, 42.1, 0, 0, 80000, 128, true]);
    for (const size of [1, 7, 13, 50]) {
      const st = {};
      const seen = [];
      for (let i = 0; i < PROGRESS.length; i += size) { parseProgress(PROGRESS.slice(i, i + size), st); seen.push(st.outTime); }
      eq(`parseProgress chunks of ${size}`, [st.outTime, st.speed, st.totalSize, st.done, seen.includes(2.5)], [5, 42.1, 80000, true, true]);
    }
    const crlf = parseProgress('out_time_us=1500000\r\nspeed=N/A\r\nprogress=continue\r\n');
    eq('parseProgress CRLF / N/A', [crlf.outTime, crlf.speed, crlf.done, progressFraction(crlf, 3), progressFraction({ outTime: 9 }, 3), progressFraction({ outTime: 1 }, null)], [1.5, null, false, 0.5, 1, null]);
    eq('parseLoudnorm', parseLoudnorm(LOUDNORM_STDERR), { input_i: -27.61, input_tp: -4.47, input_lra: 18.06, input_thresh: -39.2, output_i: -16.58, output_tp: -1.5, output_lra: 14.78, output_thresh: -27.71, normalization_type: 'dynamic', target_offset: 0.58 });
    const silent = parseLoudnorm('{\n "input_i" : "-inf",\n "input_tp" : "-inf",\n "input_lra" : "0.00",\n "input_thresh" : "-inf",\n "target_offset" : "inf"\n}');
    eq('parseLoudnorm silence', [silent.input_i, silent.input_tp, silent.input_lra, silent.input_thresh, silent.target_offset], [-99, -99, 0, -99, 99]);
    eq('parseLoudnorm none', [parseLoudnorm('no json here'), parseLoudnorm('{ "input_i" : "x" ')], [null, null]);

    mark('ffprobe.js');
    // --- ffprobe.js -----------------------------------------------------------------------------------------------
    eq('probeJob', [probeJob('C:\\a b.mp3').steps[0].argv, probeJob('-x.mp3').steps[0].argv.slice(-2), probeJob('x').steps[0].capture, probeJob('x').steps[0].parse],
      [['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', 'C:\\a b.mp3'], ['-i', '-x.mp3'], 'json', 'ffprobe']);
    const mp3 = parseProbe(JSON.stringify(PROBE_MP3));
    eq('parseProbe mp3 basics', [mp3.container, mp3.kind, mp3.mime, mp3.duration, mp3.bitrate, mp3.audio, mp3.video, mp3.pictures, mp3.cover, mp3.syncedLyrics],
      ['mp3', 'audio', 'audio/mpeg', 215.484082, 323, { codec: 'mp3', sampleRate: 44100, channels: 2, bitsPerSample: null }, null, 1, null, null]);
    eq('parseProbe mp3 tags', mp3.tags, { title: 'Песня', artist: 'Artist One; Artist Two', album: 'The Album', albumArtist: 'The Band', track: 3, trackTotal: 12, disc: 1, discTotal: 2, date: '2019-05-01',
      genre: ['Rock', 'Indie'], comment: 'Nice', bpm: 120, compilation: true, lyrics: 'la la', artists: ['Artist One', 'Artist Two'], year: 2019 });
    eq('parseProbe mp3 replaygain', mp3.replaygain, { trackGain: -7.3, trackPeak: 0.988, albumGain: -6.1, albumPeak: null });
    eq('parseProbe mp3 streams', mp3.streams, [{ index: 0, type: 'audio', codec: 'mp3', lang: null, title: null, default: false, forced: false, channels: 2 },
      { index: 1, type: 'video', codec: 'mjpeg', lang: null, title: 'Album cover', default: false, forced: false, width: 600, height: 600, picture: true }]);
    const mkv = parseProbe(PROBE_MKV);
    eq('parseProbe mkv', [mkv.container, mkv.kind, mkv.mime, mkv.video, mkv.audio, mkv.bitrate, mkv.pictures], ['mkv', 'video', 'video/x-matroska', { codec: 'h264', width: 1920, height: 1080, fps: 23.976 }, { codec: 'aac', sampleRate: 48000, channels: 6, bitsPerSample: null }, 5000, 0]);
    eq('parseProbe mkv streams', mkv.streams.map((s) => [s.type, s.codec, s.lang, s.title, s.default, s.forced]),
      [['video', 'h264', null, null, true, false], ['audio', 'aac', 'eng', 'Surround', true, false], ['subtitle', 'subrip', 'rus', 'Forced', false, true], ['subtitle', 'ass', null, null, false, false], ['attachment', 'ttf', null, null, false, false]]);
    eq('parseProbe mkv chapters', mkv.chapters, [{ start: 0, end: 600, title: 'Opening' }, { start: 600, end: 2520, title: 'Part 2' }]);
    eq('parseProbe mkv tags', mkv.tags, { title: 'Episode 1', show: 'My Show', season: 2, episode: 5, encoder: 'libebml v1.4.2' });
    const m4a = parseProbe(PROBE_M4A);
    eq('parseProbe m4a', [m4a.container, m4a.kind, m4a.mime, m4a.tags], ['mp4', 'audio', 'audio/mp4', { title: 'T', artist: 'A', track: 7, artists: ['A'] }]);
    eq('parseProbe mov / m4v', [parseProbe({ ...PROBE_MKV, format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', tags: { major_brand: 'qt  ' } } }).mime,
      parseProbe({ ...PROBE_MKV, format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', tags: { major_brand: 'M4V ' } } }).mime, parseProbe({ ...PROBE_M4A, format: { ...PROBE_M4A.format, format_name: 'matroska,webm', filename: 'a.mka' } }).mime],
      ['video/quicktime', 'video/x-m4v', 'audio/x-matroska']);
    const ogg = parseProbe({ streams: [{ index: 0, codec_type: 'audio', codec_name: 'opus', sample_rate: '48000', channels: 2,
      tags: { TITLE: 'Ogg title', ARTISTS: 'X;Y', ARTIST: 'X / Y', TRACKNUMBER: '2', TRACKTOTAL: '9', LABEL: 'Lbl', ORIGINALDATE: '1975-03-01', MUSICBRAINZ_ALBUMID: 'abc-1', R128_TRACK_GAIN: '-512' } }],
      format: { filename: 'a.opus', format_name: 'ogg', duration: '3.5' } });
    eq('parseProbe ogg stream tags', [ogg.container, ogg.mime, ogg.tags, ogg.replaygain], ['ogg', 'audio/ogg', { title: 'Ogg title', artists: ['X', 'Y'], artist: 'X / Y', track: 2, trackTotal: 9, label: 'Lbl', originalYear: 1975, mb: { albumId: 'abc-1' } },
      { trackGain: 3, trackPeak: null, albumGain: null, albumPeak: null }]);
    const png = parseProbe({ streams: [{ index: 0, codec_type: 'video', codec_name: 'png', width: 10, height: 12 }], format: { format_name: 'png_pipe' } });
    eq('parseProbe image', [png.kind, png.container, png.mime, png.image], [null, 'png', 'image/png', { width: 10, height: 12 }]);
    eq('parseProbe junk', [parseProbe('not json'), parseProbe('{}'), parseProbe(null)], [null, null, null]);

    mark('ytdlp.js');
    // --- ytdlp.js ---------------------------------------------------------------------------------------------------
    const SOURCES = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'video'],
      ['https://youtu.be/dQw4w9WgXcQ?t=42', 'youtube', 'dQw4w9WgXcQ', 'video'],
      ['https://www.youtube.com/shorts/abcdefghijk', 'youtube', 'abcdefghijk', 'video'],
      ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'video'],
      ['https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', 'youtube', 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', 'playlist'],
      ['https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijklmnopqrstuvwxyz0123456', 'youtube', 'OLAK5uy_abcdefghijklmnopqrstuvwxyz0123456', 'playlist'],
      ['https://www.youtube.com/@LinusTechTips', 'youtube', '@LinusTechTips', 'channel'],
      ['https://www.youtube.com/@handle/videos', 'youtube', '@handle/videos', 'channel'],
      ['https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', 'youtube', 'UCuAXFkgsw1L7xaCfnd5JJOw', 'channel'],
      ['youtube:dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'video'],
      ['m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'video'],
      ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'video'],
      ['https://www.youtube.com/live/abcdefghijk?si=x', 'youtube', 'abcdefghijk', 'video'],
      ['https://vimeo.com/76979871', 'vimeo', '76979871', 'video'],
      ['https://vimeo.com/123456789/abcdef1234', 'vimeo', '123456789/abcdef1234', 'video'],
      ['https://player.vimeo.com/video/76979871?h=0123abcd', 'vimeo', '76979871/0123abcd', 'video'],
      ['https://vimeo.com/showcase/7031352', 'vimeo', 'showcase/7031352', 'playlist'],
      ['https://vimeo.com/channels/staffpicks', 'vimeo', 'channels/staffpicks', 'channel'],
      ['https://vimeo.com/channels/staffpicks/123456', 'vimeo', '123456', 'video'],
      ['https://www.dailymotion.com/video/x7tgad0', 'dailymotion', 'x7tgad0', 'video'],
      ['https://dai.ly/x7tgad0', 'dailymotion', 'x7tgad0', 'video'],
      ['https://www.dailymotion.com/playlist/x6hynp', 'dailymotion', 'playlist/x6hynp', 'playlist'],
      ['https://soundcloud.com/forss/flickermood?in=x', 'soundcloud', 'forss/flickermood', 'video'],
      ['https://soundcloud.com/forss/sets/soulhack', 'soundcloud', 'forss/sets/soulhack', 'playlist'],
      ['https://soundcloud.com/forss', 'soundcloud', 'forss', 'channel'],
      ['https://soundcloud.com/forss/tracks', 'soundcloud', 'forss/tracks', 'channel'],
      ['https://soundcloud.com/discover', 'soundcloud', null, 'unknown'],
      ['https://blackmetal.bandcamp.com/track/the-song', 'bandcamp', 'blackmetal/track/the-song', 'video'],
      ['https://blackmetal.bandcamp.com/album/the-album', 'bandcamp', 'blackmetal/album/the-album', 'playlist'],
      ['https://blackmetal.bandcamp.com/', 'bandcamp', 'blackmetal', 'channel'],
      ['https://www.twitch.tv/videos/1234567890', 'twitch', 'v1234567890', 'video'],
      ['https://clips.twitch.tv/FunnyClipName', 'twitch', 'clip/FunnyClipName', 'video'],
      ['https://www.twitch.tv/somestreamer/clip/OtherClip', 'twitch', 'clip/OtherClip', 'video'],
      ['https://www.twitch.tv/somestreamer', 'twitch', 'somestreamer', 'channel'],
      ['https://www.nicovideo.jp/watch/sm9', 'niconico', 'sm9', 'video'],
      ['https://nico.ms/sm9', 'niconico', 'sm9', 'video'],
      ['https://www.nicovideo.jp/user/12345/mylist/678', 'niconico', 'mylist/678', 'playlist'],
      ['https://www.bilibili.com/video/BV1xx411c7mD?p=2', 'bilibili', 'BV1xx411c7mD', 'video'],
      ['https://space.bilibili.com/123456', 'bilibili', 'space/123456', 'channel'],
      ['https://framatube.org/w/9c9de5e8-0a1e-484a-b099-e80766180a6d', 'peertube', 'framatube.org/w/9c9de5e8-0a1e-484a-b099-e80766180a6d', 'video'],
      ['https://peertube.example/videos/watch/9c9de5e8-0a1e-484a-b099-e80766180a6d', 'peertube', 'peertube.example/w/9c9de5e8-0a1e-484a-b099-e80766180a6d', 'video'],
      ['https://tube.example/w/p/2Xrb7JmCdL3hVqxDqKbTRW', 'peertube', 'tube.example/w/p/2Xrb7JmCdL3hVqxDqKbTRW', 'playlist'],
      ['https://example.com/some/video.mp4', 'generic', null, 'unknown'],
      ['soundcloud:forss/flickermood', 'soundcloud', 'forss/flickermood', 'video'],
      ['bilibili:av170001', 'bilibili', 'av170001', 'video'],
      ['twitch:v42', 'twitch', 'v42', 'video'],
    ];
    for (const [s, ex, id, kind] of SOURCES) {
      const p = parseSource(s);
      eq('parseSource ' + s, p && [p.extractor, p.id, p.kind], [ex, id, kind]);
    }
    eq('parseSource not sources', ['not a url', '/music/a.mp3', 'C:\\Music\\a.mp3', 'ftp://x/y', 'youtube:abc', 'unknownsite:123', '', null, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ extra'].map(parseSource), [null, null, null, null, null, null, null, null, null]);
    eq('parseSource playlist context', parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG').playlist, 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
    eq('formatSource', [formatSource(parseSource('https://youtu.be/dQw4w9WgXcQ')), formatSource({ extractor: 'generic', id: null, url: 'https://e.com/x' }), formatSource(null)], ['youtube:dQw4w9WgXcQ', 'https://e.com/x', null]);
    eq('sourceURL', ['youtube:dQw4w9WgXcQ', 'youtube:PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', 'youtube:@handle', 'youtube:UCuAXFkgsw1L7xaCfnd5JJOw', 'vimeo:76979871', 'dailymotion:user/someone', 'bandcamp:blackmetal/album/x',
      'twitch:v42', 'twitch:clip/Abc', 'niconico:sm9', 'bilibili:ep123', 'bilibili:space/5', 'peertube:tube.example/w/2Xrb7JmCdL3hVqxDqKbTRW', 'https://example.com/a?b=c', { extractor: 'youtube', id: 'dQw4w9WgXcQ' }, 'nope'].map(sourceURL),
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', 'https://www.youtube.com/@handle', 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
        'https://vimeo.com/76979871', 'https://www.dailymotion.com/someone', 'https://blackmetal.bandcamp.com/album/x', 'https://www.twitch.tv/videos/42', 'https://clips.twitch.tv/Abc', 'https://www.nicovideo.jp/watch/sm9',
        'https://www.bilibili.com/bangumi/play/ep123', 'https://space.bilibili.com/5', 'https://tube.example/w/2Xrb7JmCdL3hVqxDqKbTRW', 'https://example.com/a?b=c', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', null]);
    eq('isSourceRef', ['youtube:dQw4w9WgXcQ', 'https://e.com/v', '/local/file.mp3', 'C:\\x.mp3'].map(isSourceRef), [true, true, false, false]);
    for (const [s, ex, id] of SOURCES.filter((x) => x[2])) eq('ref round trip ' + s, parseSource(formatSource(parseSource(s)))?.id, id);

    eq('infoJob', infoJob('youtube:dQw4w9WgXcQ').steps[0].argv, ['-J', '--flat-playlist', '--no-warnings', '--no-progress', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
    eq('infoJob options', infoJob('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', { flat: false, playlistItems: '1:5' }).steps[0], makeStep({ tool: 'yt-dlp',
      argv: ['-J', '--no-warnings', '--no-progress', '--playlist-items', '1:5', 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'], groups: [1, 1, 1, 2, 1],
      comment: 'Read the information of youtube:PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', capture: 'json', parse: 'ytdlp-info' }));
    throws('infoJob rejects text', () => infoJob('--exec rm'), /not a source/);
    const dl = downloadJob('https://youtu.be/dQw4w9WgXcQ', { outDir: '/media/in', mode: 'audio', audioFormat: 'mp3', archive: '/media/archive.txt', ffmpegLocation: '/opt/ff/ffmpeg', rateLimit: '2M' });
    eq('downloadJob audio argv', dl.steps[0].argv, ['--newline', '--progress', '--progress-template', DL_TEMPLATE, '--progress-template', 'postprocess:[pp] %(progress.status)s %(progress.postprocessor)s',
      '--print', 'after_move:filepath=%(filepath)s', '-P', '/media/in', '-o', '%(title)s [%(id)s].%(ext)s', '-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '--embed-thumbnail', '--convert-thumbnails', 'jpg', '--embed-metadata', '--embed-chapters', '--write-info-json', '--no-playlist', '--download-archive', '/media/archive.txt',
      '--ffmpeg-location', '/opt/ff/ffmpeg', '--limit-rate', '2M', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
    const dv = downloadJob('youtube:PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', { mode: 'video', maxHeight: 720, subs: { langs: ['en', 'de'], auto: true, embed: true }, thumbnail: true, infoJson: false, playlistItems: '1-3' }).steps[0].argv.join(' ');
    ok('downloadJob video', dv.includes('-f bv*[height<=720]+ba/b[height<=720] -S vcodec:h264,res,acodec:aac --merge-output-format mp4') && dv.includes('--write-subs --write-auto-subs --sub-langs en,de --sub-format vtt/srt/best --embed-subs')
      && dv.includes('--playlist-items 1-3 --yes-playlist') && !dv.includes('--write-info-json'), dv);
    const db = downloadJob('vimeo:76979871', {}).steps[0].argv.join(' ');
    ok('downloadJob best writes the thumbnail', db.includes('-f bv*+ba/b') && db.includes('--write-thumbnail --convert-thumbnails jpg') && !db.includes('--embed-thumbnail'), db);
    ok('downloadJob never cookies', ![dl, downloadJob('youtube:dQw4w9WgXcQ', { mode: 'video' })].some((j) => /cookie|password|username|netrc/i.test(j.steps[0].argv.join(' '))));
    eq('downloadJob step', [dl.kind, dl.steps[0].tool, dl.steps[0].progress, dl.outputs], ['ytdlp.download', 'yt-dlp', 'ytdlp', []]);

    const L = (s) => { const p = parseProgressLine(s); return p && Object.fromEntries(Object.entries(p).filter(([, v]) => v != null)); };
    eq('progress template', L('[dl] downloading 1048576 4194304 NA 524288.5 6 /dl/My Video [abc].f137.mp4'), { kind: 'download', percent: 25, downloaded: 1048576, total: 4194304, speed: 524288.5, eta: 6, file: '/dl/My Video [abc].f137.mp4', status: 'downloading' });
    eq('progress template estimate', L('[dl] downloading 1000 NA 4000.0 NA NA NA'), { kind: 'download', percent: 25, downloaded: 1000, total: 4000, status: 'downloading' });
    eq('progress template finished', L('[dl] finished 4194304 4194304 NA NA NA C:\\dl\\x.mp4').percent, 100);
    eq('postprocess template', L('[pp] started FFmpegExtractAudio'), { kind: 'postprocess', status: 'started', postprocessor: 'FFmpegExtractAudio' });
    eq('filepath print', L('filepath=/dl/My Video [abc].mp3'), { kind: 'filepath', file: '/dl/My Video [abc].mp3' });
    eq('default download line', L('[download]  45.3% of ~  12.34MiB at    1.23MiB/s ETA 00:12 (frag 3/12)'), { kind: 'download', percent: 45.3, downloaded: 5861561, total: 12939428, speed: 1289748, eta: 12 });
    eq('default download done', L('[download] 100% of   45.67MiB in 00:00:12 at 3.71MiB/s'), { kind: 'download', percent: 100, downloaded: 47888466, total: 47888466, speed: 3890217 });
    eq('destination lines', ['[download] Destination: /dl/x.f251.webm', '[Merger] Merging formats into "/dl/x.mkv"', '[ExtractAudio] Destination: /dl/x.mp3', '[download] /dl/x.mp4 has already been downloaded'].map((s) => L(s).file), ['/dl/x.f251.webm', '/dl/x.mkv', '/dl/x.mp3', '/dl/x.mp4']);
    eq('message lines', ['WARNING: [youtube] Falling back', 'ERROR: [youtube] abc: Video unavailable', '[youtube] dQw4w9WgXcQ: Downloading webpage', 'random text', '', null].map((s) => parseProgressLine(s)?.kind ?? null), ['warning', 'error', 'info', null, null, null]);

    const cv = infoToCatalog(YT_VIDEO);
    eq('catalog video', [cv.source, cv.url, cv.extractor, cv.id, cv.kind, cv.uploadDate, cv.uploader, cv.channel, cv.duration, cv.tags, cv.chapters, cv.subtitles, cv.autoSubtitles, cv.thumbnails.length, cv.thumbnail, cv.language, cv.playlist, cv.entries, cv.filepath],
      ['youtube:dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'video', '2009-10-25', 'Rick Astley', 'Rick Astley', 212, ['rick', 'astley'],
        [{ start: 0, end: 30, title: 'Intro' }, { start: 30, end: 212, title: 'Song' }], { en: ['json3', 'vtt'], de: ['vtt'] }, ['fr'], 2, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', 'en', null, [], null]);
    const ct = infoToCatalog(YT_TRACK);
    eq('catalog music track', [ct.source, ct.kind, ct.artist, ct.artists, ct.album, ct.track, ct.trackNumber, ct.releaseYear, ct.genres, ct.playlist],
      ['youtube:abcdefghijk', 'track', 'Artist A, Artist B', ['Artist A', 'Artist B'], 'Album', 'Song', 4, 2021, ['Pop'], { id: 'OLAK5uy_abcdefghijklmnopqrstuvwxyz0123456', title: 'Album', index: 4, count: 10 }]);
    const cp = infoToCatalog(YT_PLAYLIST);
    eq('catalog playlist', [cp.source, cp.kind, cp.title, cp.count, cp.entries.map((e) => [e.source, e.kind, e.title, e.duration, e.thumbnails.length])],
      ['youtube:PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', 'playlist', 'My List', 2, [['youtube:dQw4w9WgXcQ', 'video', 'One', 212, 0], ['youtube:abcdefghijk', 'video', 'Two', null, 1]]]);
    eq('catalog soundcloud', [infoToCatalog(SC_TRACK).source, infoToCatalog(SC_TRACK).kind], ['soundcloud:forss/flickermood', 'track']);
    const ce = infoToCatalog(EPISODE);
    eq('catalog episode', [ce.source, ce.kind, ce.series, ce.season, ce.episode], ['https://example.com/show/e1', 'episode', 'Show', 1, 2]);
    eq('catalog downloaded file', infoToCatalog({ ...YT_VIDEO, requested_downloads: [{ filepath: '/dl/x.mp4' }] }).filepath, '/dl/x.mp4');

    mark('magick.js');
    // --- magick.js --------------------------------------------------------------------------------------------------
    eq('coverJob argv', coverJob({ input: 'in.png', output: 'cover.jpg' }).steps[0].argv, ['in.png[0]', '-auto-orient', '-background', '#000', '-alpha', 'remove', '-alpha', 'off', '-resize', '600x600^', '-gravity', 'center', '-extent', '600x600', '-strip', '-quality', '90', 'cover.jpg']);
    eq('coverJob pad png', coverJob({ input: 'in.jpg', output: 'c.png', size: 300, fit: 'pad', background: 'none' }).steps[0].argv, ['in.jpg[0]', '-auto-orient', '-resize', '300x300', '-background', 'none', '-gravity', 'center', '-extent', '300x300', '-strip', 'c.png']);
    eq('coverJob format prefix', coverJob({ input: 'a', output: 'cover', format: 'webp', fit: 'none' }).steps[0].argv.slice(-4), ['-strip', '-quality', '90', 'webp:cover']);
    eq('thumbJob', thumbJob({ input: 'a.webp', output: 't.jpg', size: 128 }).steps[0].argv, ['a.webp[0]', '-auto-orient', '-background', '#fff', '-alpha', 'remove', '-alpha', 'off', '-thumbnail', '128x128>', '-strip', '-quality', '85', 't.jpg']);
    eq('cells', [cells(1, 600), cells(2, 600, 10), cells(3, 601, 1).map((c) => [c.w, c.h]), cells(4, 600, 0).map((c) => [c.x, c.y])],
      [[{ x: 0, y: 0, w: 600, h: 600 }], [{ x: 0, y: 0, w: 295, h: 600 }, { x: 305, y: 0, w: 295, h: 600 }], [[300, 601], [300, 300], [300, 300]], [[0, 0], [300, 0], [0, 300], [300, 300]]]);
    const col = collageJob({ inputs: ['a.png', 'b.png'], output: 'c.jpg', size: 400, gap: 4, background: '#123456' });
    eq('collageJob argv', col.steps[0].argv, ['-size', '400x400', 'xc:#123456', '(', 'a.png[0]', '-auto-orient', '-resize', '198x400^', '-gravity', 'center', '-extent', '198x400', ')', '-gravity', 'northwest', '-geometry', '+0+0', '-composite',
      '(', 'b.png[0]', '-auto-orient', '-resize', '198x400^', '-gravity', 'center', '-extent', '198x400', ')', '-gravity', 'northwest', '-geometry', '+202+0', '-composite', '-alpha', 'off', '-strip', '-quality', '90', 'c.jpg']);
    ok('collageJob bash parentheses', commandLine(['magick', ...col.steps[0].argv], 'bash').includes(' \\( a.png[0] ') || commandLine(['magick', ...col.steps[0].argv], 'bash').includes(" \\( 'a.png[0]' "), commandLine(['magick', ...col.steps[0].argv], 'bash'));
    throws('collageJob without inputs', () => collageJob({ inputs: [], output: 'x.jpg' }));
    eq('convertJob', convertJob({ input: 'a.gif', output: 'a.png', resize: '50%' }).steps[0].argv, ['a.gif[0]', '-auto-orient', '-resize', '50%', 'a.png']);
    eq('identifyJob', identifyJob('a b.png').steps[0], makeStep({ tool: 'magick', argv: ['a b.png[0]', '-format', '%m %w %h\\n', 'info:'], groups: [1, 2, 1], comment: 'Format and size of the first picture', capture: 'text', parse: 'identify' }));
    eq('parseIdentify', [parseIdentify('JPEG 600 600\r\n'), parseIdentify('in.png PNG 320x200 320x200+0+0 8-bit sRGB 1.2KB 0.000u 0:00.000'), parseIdentify('')], [{ format: 'JPEG', width: 600, height: 600 }, { format: 'PNG', width: 320, height: 200 }, null]);

    mark('shell.js');
    // --- shell.js ---------------------------------------------------------------------------------------------------
    const small = { id: 'a1', ...extractAudio({ input: 'my video.mp4', output: "it's.m4a" }) };
    eq('renderJob bash', renderJob(small, 'bash').text, "# Extract the audio of my video.mp4\n# Copy the first audio stream without re-encoding\nffmpeg -hide_banner -nostdin -y -progress pipe:1 -nostats -i 'my video.mp4' -map 0:a:0 -c:a copy \\\n  -movflags +faststart 'it'\\''s.m4a'");
    eq('renderJob cmd', renderJob(small, 'cmd', { width: 0, tools: { ffmpeg: 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe' } }).text,
      'REM Extract the audio of my video.mp4\nREM Copy the first audio stream without re-encoding\n"C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe" -hide_banner -nostdin -y -progress pipe:1 -nostats -i "my video.mp4" -map 0:a:0 -c:a copy -movflags +faststart "it\'s.m4a"');
    eq('renderJob without progress flags', renderJob(small, 'bash', { width: 0, progress: false }).text.split('\n')[2], "ffmpeg -hide_banner -nostdin -y -i 'my video.mp4' -map 0:a:0 -c:a copy -movflags +faststart 'it'\\''s.m4a'");
    const rn = renderJob({ id: 'n1', spec: normalize({ input: 'a.wav', output: 'b.mp3', target: {} }) }, 'bash', { width: 0 });
    ok('renderJob variables', rn.text.includes("'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=<input_i from step 1>:measured_TP=<input_tp from step 1>:") && rn.text.includes('# <name from step N>'), rn.text);
    const rj = renderJob({ id: 'b7', ...jc }, 'bash');
    ok('renderJob heredoc', rj.text.includes("mkdir -p job-b7\ncat > job-b7/list.ffconcat <<'EOF'\nffconcat version 1.0\nfile '/books/01 It'\\''s \"one\".mp3'\n") && rj.text.includes('-i job-b7/list.ffconcat') && rj.work === 'job-b7', rj.text);
    eq('renderJob pieces', [rj.pieces.map((p) => p.text).join('') === rj.text, [...new Set(rj.pieces.map((p) => p.ref))]], [true, ['job', null, 'file:list.ffconcat', 'file:chapters.txt', 'step:0']]);
    const rc = renderJob({ id: 'b7', ...jc }, 'cmd', { batch: true });
    ok('renderJob cmd certutil', rc.text.startsWith('@echo off\nchcp 65001 >NUL\nREM ') && rc.text.includes('if not exist job-b7 mkdir job-b7') && rc.text.includes('certutil -f -decode job-b7\\list.ffconcat.b64 job-b7\\list.ffconcat >NUL')
      && rc.text.includes('REM   ffconcat version 1.0') && rc.text.includes('-i job-b7\\list.ffconcat'), rc.text);
    const nlJob = { id: 'nl', ...embedMeta({ input: 'a.mp3', output: 'b.mp3', tags: { lyrics: 'one\ntwo' } }) };
    ok('renderJob cmd line breaks', renderJob(nlJob, 'cmd').text.includes('"lyrics=one two"') && /cannot pass line breaks/.test(renderJob(nlJob, 'cmd').text) && renderJob(nlJob, 'bash').text.includes("'lyrics=one\ntwo'"));
    ok('renderJob default id', /^job-[0-9a-f]{8}$/.test(renderJob(jc, 'bash').work));

    // Real shells: node stands in for the tools; the argv each step receives and the auxiliary files must be the job's.
    const bash = findBash();
    const cmdOk = cmdRuns();
    const fakeTool = path.join(tmp, 'fake-tool.mjs');
    fs.writeFileSync(fakeTool, "import fs from 'node:fs';\nfs.appendFileSync('calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');\n");
    const trickyJobs = (withVars) => {
      const j1 = joinChapters({ inputs: [{ path: path.join(tmp, '01 It\'s "Intro" & more 100%.mp3'), title: 'Intro; part=1 #a ^ & | < > ! "q"', duration: 61.5 }, { path: path.join(tmp, 'Привет мир.mp3'), title: 'Line\nEOF\n/?', duration: 120 }],
        output: 'out book.m4b', tags: { title: withVars ? 'Book %PATH% ^ & | < > !' : 'Book 100% ^ & | < > !', artist: 'Автор' }, cover: 'cover (1).jpg' });
      const j2 = convertAudio({ input: 'in (1).wav', output: 'out & co.mp3', tags: { title: withVars ? 'A & B | C > D < E ^ F ! G %USERPROFILE% "H" \'I\' 50%' : 'A & B | C > D < E ^ F ! G "H" \'I\' 50%', artist: withVars ? 'Пётр' : 'Petr' } });
      const j3 = collageJob({ inputs: ['a b.png', 'c(1).png', 'd.png'], output: 'col lage.jpg', gap: 2 });
      return [j1, j2, j3];
    };
    const runShell = async (name, jobs, shell, mode) => {
      const dir = fs.mkdtempSync(path.join(tmp, `sh-${shell}-${mode}-`));
      const tools = { ffmpeg: [process.execPath, fakeTool], magick: [process.execPath, fakeTool] };
      const texts = jobs.map((j, i) => renderJob({ id: `t${i}`, spec: j }, shell, { tools, batch: mode === 'bat', width: 90 }).text);
      let r;
      if (shell === 'bash') r = await exec(bash, ['-s'], { input: texts.join('\n') + '\n', cwd: dir });
      else if (mode === 'bat') { fs.writeFileSync(path.join(dir, 'run.bat'), texts.join('\r\n').replace(/\r?\n/g, '\r\n') + '\r\n'); r = await exec('cmd.exe', ['/d', '/c', path.join(dir, 'run.bat')], { cwd: dir }); }
      else r = await exec('cmd.exe', ['/d', '/q', '/k'], { input: texts.join('\n').replace(/\n/g, '\r\n') + '\r\nexit\r\n', cwd: dir });
      ok(`${name}: shell ran`, r.status === 0, `${r.status} ${r.error || ''}\n${r.stdout}\n${r.stderr}`);
      let calls = [];
      try { calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { /* none */ }
      const sep = shell === 'cmd' ? '\\' : '/';
      const want = jobs.flatMap((j, i) => j.steps.map((s) => s.argv.map((a) => substitute(a, { work: `job-t${i}`, join: (w, ...p) => [w, ...p].join(sep) }))));
      eq(`${name}: argv`, calls, want);
      jobs.forEach((j, i) => j.steps.forEach((s) => Object.entries(s.files).forEach(([f, text]) => {
        let got = null;
        try { got = fs.readFileSync(path.join(dir, `job-t${i}`, f), 'utf8'); } catch { /* missing */ }
        eq(`${name}: file ${f}`, got, text);
        ok(`${name}: no ${f}.b64 left`, !fs.existsSync(path.join(dir, `job-t${i}`, f + '.b64')));
      })));
      ok(`${name}: no stray files`, fs.readdirSync(dir).every((f) => /^(calls\.jsonl|run\.bat|job-t\d)$/.test(f)), fs.readdirSync(dir).join(', '));
    };
    if (!bash) skip('bash round trips (no bash)');
    if (!cmdOk) skip('cmd.exe round trips (not Windows)');
    await Promise.all([bash && runShell('bash', trickyJobs(true), 'bash', 'stdin'),
      cmdOk && runShell('cmd .bat', trickyJobs(true), 'cmd', 'bat'), cmdOk && runShell('cmd window', trickyJobs(false).slice(0, 2), 'cmd', 'stdin')]);

    mark('queue.js');
    // --- queue.js ---------------------------------------------------------------------------------------------------
    {
      const pending = new Map();
      const started = [];
      const q = createQueue({
        concurrency: 2, maxLog: 5, now: (() => { let t = 1000; return () => t++; })(),
        run: (job, ctl) => new Promise((resolve, reject) => {
          started.push(job.id);
          ctl.step(1, 2);
          ctl.signal.addEventListener('abort', () => reject(new Error('aborted')));
          pending.set(job.id, { resolve, reject, ctl });
        }),
      });
      const events = [];
      const off = q.on((e) => events.push(e.type));
      const spec = (k) => ({ kind: 'test', title: 'job ' + k, steps: [{}, {}] });
      const a = q.add(spec('a'), { id: 'a' }), b = q.add(spec('b'), { id: 'b' }), c = q.add(spec('c'), { id: 'c' }), d = q.add(spec('d'), { id: 'd' });
      throws('queue duplicate id', () => q.add(spec('x'), { id: 'a' }), /exists/);
      eq('queue added', q.list().map((j) => j.status), ['queued', 'queued', 'queued', 'queued']);
      await tick();
      eq('queue concurrency', [q.list().map((j) => j.status), started, a.step, a.steps], [['running', 'running', 'queued', 'queued'], ['a', 'b'], 1, 2]);
      ok('queue cancel queued', q.cancel('d') && d.status === 'canceled' && d.finished != null);
      const ca1 = pending.get('a').ctl;
      for (let i = 0; i < 8; i++) ca1.log('line ' + i);
      ca1.progress(1.7, 'almost'); const p1 = a.progress; ca1.progress(null); const p2 = a.progress; ca1.progress(0.5, 'half');
      ca1.setVar('loudnorm', { input_i: -20 });
      eq('queue log bound / progress / vars', [a.log, a.logDropped, p1, p2, a.progress, a.progressText, a.vars], [['line 3', 'line 4', 'line 5', 'line 6', 'line 7'], 3, 1, null, 0.5, 'half', { loudnorm: { input_i: -20 } }]);
      pending.get('a').resolve({ outputs: ['x'], vars: { extra: 1 } });
      await tick();
      eq('queue done -> next', [a.status, a.progress, a.result.outputs, a.vars, c.status, started], ['done', 1, ['x'], { loudnorm: { input_i: -20 }, extra: 1 }, 'running', ['a', 'b', 'c']]);
      ok('queue cancel running', q.cancel('b') && b.status === 'running' && pending.get('b').ctl.signal.aborted);
      await tick();
      eq('queue canceled', [b.status, b.error], ['canceled', 'canceled']);
      pending.get('c').reject(new Error('ffmpeg exited with code 1'));
      await tick();
      eq('queue failed', [c.status, c.error], ['failed', 'ffmpeg exited with code 1']);
      ok('queue retry', q.retry('c') === c && c.status === 'queued' && c.error === null && q.retry('zzz') === null);
      await tick();
      eq('queue retried runs', [c.status, started.slice(-1)[0], c.log.slice(-1)[0]], ['running', 'c', '--- retry ---']);
      const e = q.add(spec('e'), { id: 'e' });
      await tick();
      ok('queue remove running', q.remove('c') && !q.get('c') && pending.get('c').ctl.signal.aborted);
      pending.get('c').resolve('late');
      await tick();
      eq('queue after remove', [e.status, q.list().map((j) => j.id)], ['running', ['a', 'b', 'd', 'e']]);
      const snap = q.snapshot();
      ok('queue snapshot JSON', JSON.stringify(JSON.parse(JSON.stringify(snap))) === JSON.stringify(snap) && snap.length === 4 && !('controller' in snap[0]));
      eq('queue clear finished', [q.clear(), q.list().map((j) => j.id)], [3, ['e']]);
      eq('queue clear by status', q.clear('running'), 1);
      off();
      ok('queue events', ['add', 'start', 'step', 'log', 'progress', 'var', 'done', 'cancel', 'fail', 'retry', 'remove'].every((t) => events.includes(t)), [...new Set(events)].join(' '));

      const ran = [];
      const q2 = createQueue({ run: async (job) => { ran.push(job.id); return { ok: true }; } });
      const restored = q2.restore([...snap, { id: 'r1', spec: spec('r1'), status: 'running', progress: 0.4 }, { id: 'r2', spec: spec('r2'), status: 'queued' }, { id: 'r1', spec: spec('dup'), status: 'queued' }, { id: 'bad' }]);
      eq('queue restore statuses', restored.map((j) => [j.id, j.status]), [['a', 'done'], ['b', 'canceled'], ['d', 'canceled'], ['e', 'interrupted'], ['r1', 'interrupted'], ['r2', 'queued']]);
      await until(() => q2.get('r2').status === 'done');
      eq('queue restore runs queued only', [ran, q2.get('r1').status, q2.get('r1').error], [['r2'], 'interrupted', 'interrupted']);
      q2.retry('r1');
      await until(() => q2.get('r1').status === 'done');
      eq('queue retry interrupted', ran, ['r2', 'r1']);
      const q3 = createQueue({ run: () => { throw new Error('sync throw'); } });
      const j3 = q3.add({ kind: 'x', steps: [] });
      await tick();
      eq('queue sync throw', [j3.status, j3.error], ['failed', 'sync throw']);
      throws('createQueue needs run', () => createQueue({}), /run/);
    }

    mark('runner.js with a fake spawn');
    // --- runner.js with a fake spawn --------------------------------------------------------------------------------
    {
      const tools = { ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe', 'yt-dlp': ['/usr/bin/python3', '-m', 'yt_dlp'], magick: '/bin/magick' };
      const base = { fs, path, os, tools, platform: 'linux', env: { PATH: '/bin' } };
      // success with progress
      {
        const sp = fakeSpawn((child) => {
          child.err('Input #0, wav\n  Duration: 00:00:05.00\n');
          for (let i = 0; i < PROGRESS.length; i += 9) child.out(PROGRESS.slice(i, i + 9));
          child.err('last line without newline');
          child.finish(0);
        });
        const logs = [], prog = [];
        const r = await runJob(convertAudio({ input: 'in.wav', output: 'out.flac', duration: 5 }), { ...base, spawn: sp, log: (l) => logs.push(l), progress: (p, t) => prog.push([p, t]) });
        eq('runner result', [r.outputs, r.captures, r.workDir], [['out.flac'], [], null]);
        eq('runner spawn', [sp.calls[0].program, sp.calls[0].args.slice(0, 6), sp.calls[0].options.windowsHide, sp.calls[0].options.stdio], ['/bin/ffmpeg', H, true, ['ignore', 'pipe', 'pipe']]);
        ok('runner logs stderr, not progress', logs.includes('  Duration: 00:00:05.00') && logs.includes('last line without newline') && !logs.some((l) => /out_time/.test(l)) && /^\$ ffmpeg /.test(logs[0]), JSON.stringify(logs));
        ok('runner progress', prog.some(([p]) => p === 0.5) && prog[prog.length - 1][0] === 1 && prog.every(([p], i) => i === 0 || p >= prog[i - 1][0]), JSON.stringify(prog));
      }
      // two-pass loudnorm: the measured values reach the second command
      {
        const sp = fakeSpawn((child, call, calls) => {
          if (calls.length === 1) { child.err(LOUDNORM_STDERR.slice(0, 100)); child.err(LOUDNORM_STDERR.slice(100)); }
          child.finish(0);
        });
        const vars = [];
        const r = await runJob(normalize({ input: 'in.wav', output: 'out.mp3', target: { I: -16 } }), { ...base, spawn: sp, onVar: (k, v) => vars.push(k) });
        const af = sp.calls[1].args[sp.calls[1].args.indexOf('-af') + 1];
        eq('runner loudnorm second pass', af, 'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-27.61:measured_TP=-4.47:measured_LRA=18.06:measured_thresh=-39.2:offset=0.58:linear=true:print_format=summary');
        eq('runner vars', [r.vars.loudnorm.input_i, vars], [-27.61, ['loudnorm']]);
      }
      // capture + parse ffprobe, output split inside a UTF-8 character
      {
        const json = Buffer.from(JSON.stringify(PROBE_MP3));
        const cut = json.indexOf(Buffer.from('Песня')) + 1;
        const sp = fakeSpawn((child) => { child.out(json.subarray(0, cut)); child.out(json.subarray(cut)); child.finish(0); });
        const r = await runJob(probeJob('song.mp3'), { ...base, spawn: sp });
        eq('runner capture', [r.captures[0] === json.toString('utf8'), r.vars.ffprobe.tags.title, r.vars.ffprobe.pictures], [true, 'Песня', 1]);
      }
      // exit code and missing tools
      {
        const sp = fakeSpawn((child) => { for (let i = 1; i <= 15; i++) child.err(`err line ${i}\n`); child.finish(1); });
        try { await runJob(frame({ input: 'a', output: 'b.jpg' }), { ...base, spawn: sp }); ok('runner exit code', false, 'resolved'); } catch (e) {
          ok('runner exit code', /ffmpeg exited with code 1 in step 1 of 1:\nerr line 4\n[\s\S]*err line 15$/.test(e.message) && e.exitCode === 1 && !/err line 3\n/.test(e.message), e.message);
        }
        const sp2 = fakeSpawn((child) => child.finish(0));
        await rejects('runner missing tool', runJob(probeJob('a'), { ...base, tools: { ffmpeg: '/x', ffprobe: null }, spawn: sp2 }), /ffprobe is not available/);
        eq('runner missing tool: nothing spawned', sp2.calls.length, 0);
        const sp3 = fakeSpawn((child) => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
        await rejects('runner start error', runJob(probeJob('a'), { ...base, spawn: sp3 }), /could not start ffprobe \(\/bin\/ffprobe\): not found/);
        const sp4 = fakeSpawn((child) => { child.out('{}'); child.finish(0); });
        await rejects('runner parse error', runJob(probeJob('a'), { ...base, spawn: sp4 }), /no ffprobe result/);
      }
      // abort: Windows kills the tree with taskkill, elsewhere SIGTERM
      for (const platform of ['win32', 'linux']) {
        const sp = fakeSpawn((child, call, calls) => {
          if (call.program === 'taskkill') { const pid = call.args[1]; calls.find((c) => String(c.child.pid) === pid)?.child.finish(1); child.finish(0); }
        });
        const ac = new AbortController();
        const p = runJob(convertAudio({ input: 'a.wav', output: 'b.mp3' }), { ...base, platform, spawn: sp, signal: ac.signal });
        await until(() => sp.calls.length === 1);
        ac.abort();
        await rejects(`runner abort (${platform})`, p, /AbortError|canceled/);
        if (platform === 'win32') eq('runner taskkill', [sp.calls[1]?.program, sp.calls[1]?.args], ['taskkill', ['/pid', String(sp.calls[0].child.pid), '/T', '/F']]);
        else eq('runner SIGTERM', sp.calls[0].child.killed, ['SIGTERM']);
      }
      {
        const ac = new AbortController();
        ac.abort();
        const sp = fakeSpawn(() => {});
        await rejects('runner aborted before start', runJob(frame({ input: 'a', output: 'b.png' }), { ...base, spawn: sp, signal: ac.signal }), /canceled/);
        eq('runner aborted before start: nothing spawned', sp.calls.length, 0);
      }
      // auxiliary files in the work folder
      {
        const work = path.join(tmp, 'work-aux');
        const sp = fakeSpawn((child) => child.finish(0));
        await runJob(jc, { ...base, spawn: sp, workDir: work });
        eq('runner aux files', [fs.readFileSync(path.join(work, 'list.ffconcat'), 'utf8') === jc.steps[0].files['list.ffconcat'], fs.readFileSync(path.join(work, 'chapters.txt'), 'utf8') === jc.steps[0].files['chapters.txt']], [true, true]);
        eq('runner {work} paths', [sp.calls[0].args[sp.calls[0].args.indexOf('concat') + 4], sp.calls[0].args[sp.calls[0].args.indexOf('ffmetadata') + 2]], [path.join(work, 'list.ffconcat'), path.join(work, 'chapters.txt')]);
        const sp2 = fakeSpawn((child) => child.finish(0));
        const r2 = await runJob(jc, { ...base, spawn: sp2 });
        ok('runner temporary work folder removed', r2.workDir && r2.workDir.startsWith(os.tmpdir()) && !fs.existsSync(r2.workDir), r2.workDir);
      }
      // yt-dlp: progress lines, final paths, the environment
      {
        const sp = fakeSpawn((child) => {
          child.err('[youtube] dQw4w9WgXcQ: Downloading webpage\n');
          child.err('[dl] downloading 500 1000 NA 100.0 5 /dl/x.f251.webm\n[dl] downloading 1000 1000 NA 100.0 0 /dl/x.f251.webm\n');
          child.err('[pp] started FFmpegExtractAudio\n');
          child.out('filepath=/dl/Song [dQw4w9WgXcQ].mp3\n');
          child.finish(0);
        });
        const logs = [], prog = [];
        const r = await runJob(downloadJob('youtube:dQw4w9WgXcQ', { mode: 'audio', audioFormat: 'mp3' }), { ...base, spawn: sp, log: (l) => logs.push(l), progress: (p, t) => prog.push([p, t]) });
        eq('runner yt-dlp outputs', r.outputs, ['/dl/Song [dQw4w9WgXcQ].mp3']);
        eq('runner yt-dlp program', [sp.calls[0].program, sp.calls[0].args.slice(0, 3), sp.calls[0].options.env.PYTHONIOENCODING, sp.calls[0].options.env.PATH], ['/usr/bin/python3', ['-m', 'yt_dlp', '--newline'], 'utf-8', '/bin']);
        ok('runner yt-dlp progress', prog.some(([p, t]) => p === 0.5 && /50\.0%/.test(t)) && !logs.some((l) => l.startsWith('[dl]')) && logs.includes('[youtube] dQw4w9WgXcQ: Downloading webpage'), JSON.stringify([prog, logs]));
      }
      // makeRunner + createQueue
      {
        const sp = fakeSpawn((child, call) => { if (call.args.includes('-print_format')) child.out(JSON.stringify(PROBE_MKV)); child.finish(0); });
        const q = createQueue({ run: makeRunner({ ...base, spawn: sp, workDir: path.join(tmp, 'queue-work') }) });
        const j1 = q.add(probeJob('/v/show.mkv'));
        const j2 = q.add(jc, { id: 'join 1' });
        await until(() => j2.status !== 'queued' && j2.status !== 'running');
        eq('makeRunner jobs', [j1.status, j1.vars.ffprobe?.kind, j1.step, j1.steps, j2.status, j2.result?.workDir], ['done', 'video', 1, 1, 'done', path.join(tmp, 'queue-work', 'join_1')]);
        ok('makeRunner cleans the job folder', !fs.existsSync(path.join(tmp, 'queue-work', 'join_1')));
      }
    }

    mark('runner.js with real processes');
    // --- runner.js with real processes (node as a fake ffmpeg) ------------------------------------------------------
    {
      const fake = path.join(tmp, 'fake-ffmpeg.mjs');
      fs.writeFileSync(fake, `
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const af = args[args.indexOf('-af') + 1] || '';
if (args.includes('--sleep')) {
  const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(args[args.indexOf('--sleep') + 1], String(g.pid));
  setTimeout(() => {}, 60000);
} else {
  process.stdout.write('out_time_us=1000000\\nspeed=10x\\nprogress=continue\\n');
  if (af.includes('print_format=json')) process.stderr.write(${JSON.stringify(LOUDNORM_STDERR)});
  else fs.writeFileSync(args[args.length - 1], JSON.stringify(args));
  process.stdout.write('out_time_us=2000000\\nprogress=end\\n');
  if (args.some((a) => a.endsWith('fail.mp3'))) { process.stderr.write('Error: something broke\\n'); process.exit(3); }
}
`);
      const tools = { ffmpeg: [process.execPath, fake] };
      const out = path.join(tmp, 'real-out.mp3');
      const twoPass = async () => {
        const prog = [];
        const r = await runJob(convertAudio({ input: 'in.wav', output: out, loudnorm: { I: -14 }, duration: 2 }), { spawn: nodeSpawn, fs, path, os, tools, progress: (p) => prog.push(p) });
        const args2 = JSON.parse(fs.readFileSync(out, 'utf8'));
        ok('real runner: two-pass values', args2.some((a) => a.includes('measured_I=-27.61:measured_TP=-4.47')) && r.vars.loudnorm.target_offset === 0.58, JSON.stringify(args2));
        ok('real runner: progress', prog.includes(0.25) && prog.includes(1), JSON.stringify(prog));
      };
      const abort = async () => {
        const pidFile = path.join(tmp, 'grandchild.pid');
        const sleepJob = { kind: 'test', title: 'sleep', steps: [makeStep({ tool: 'ffmpeg', argv: ['--sleep', pidFile] })], outputs: [] };
        const ac = new AbortController();
        const t0 = Date.now();
        const p = runJob(sleepJob, { spawn: nodeSpawn, fs, path, os, tools, signal: ac.signal, killGrace: 500 });
        await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').length > 0, 15000);
        ac.abort();
        await rejects('real runner: abort', p, /canceled/);
        ok('real runner: abort is quick', Date.now() - t0 < 15000);
        const gpid = +fs.readFileSync(pidFile, 'utf8');
        const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
        if (process.platform === 'win32') {
          await until(() => !alive(gpid), 5000);
          ok('real runner: process tree killed', !alive(gpid), 'grandchild ' + gpid);
        } else { try { process.kill(gpid); } catch { /* gone */ } }
      };
      await Promise.all([twoPass(), abort(),
        rejects('real runner: exit code', runJob(convertAudio({ input: 'in.wav', output: path.join(tmp, 'fail.mp3') }), { spawn: nodeSpawn, fs, path, os, tools }), /exited with code 3[\s\S]*something broke/)]);
    }

    mark('real tools');
    // --- real tools ------------------------------------------------------------------------------------------------
    const realTools = Object.fromEntries(Object.entries(real).map(([k, v]) => [k, v && v.path]));
    const deps = { spawn: nodeSpawn, fs, path, os, tools: realTools };
    if (real.magick) {
      const dir = fs.mkdtempSync(path.join(tmp, 'magick-'));
      const img = (w, h, alpha) => {
        const d = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4; d[p] = (x * 255) / w; d[p + 1] = (y * 255) / h; d[p + 2] = 128; d[p + 3] = alpha ? (x < w / 2 ? 255 : 90) : 255; }
        return encodePNG({ width: w, height: h, data: d });
      };
      const A = path.join(dir, 'wide picture.png'), B = path.join(dir, 'tall (1).png');
      fs.writeFileSync(A, img(320, 200, false));
      fs.writeFileSync(B, img(150, 260, true));
      const f = (n) => path.join(dir, n);
      // the jobs run in parallel: through runJob, through the queue (identifyJob included) and as rendered scripts
      const q = createQueue({ run: makeRunner(deps), concurrency: 2 });
      const qa = q.add(coverJob({ input: B, output: f('q1.png'), size: 120 })), qb = q.add(identifyJob(A));
      const scriptJob = collageJob({ inputs: [A, B], output: 'shell collage.jpg', size: 200 });
      const bashDir = bash ? fs.mkdtempSync(path.join(dir, 'bash-')) : null;
      const cmdDir = cmdOk ? fs.mkdtempSync(path.join(dir, 'cmd-')) : null;
      if (cmdDir) fs.writeFileSync(path.join(cmdDir, 'run.bat'), renderJob(scriptJob, 'cmd', { tools: realTools, batch: true }).text.replace(/\n/g, '\r\n') + '\r\n');
      const runs = await Promise.allSettled([
        runJob(coverJob({ input: A, output: f('cover.jpg') }), deps).then(() => runJob(convertJob({ input: f('cover.jpg'), output: f('conv.png'), resize: '50%' }), deps)),
        runJob(coverJob({ input: B, output: f('pad.png'), size: 300, fit: 'pad', background: 'none' }), deps),
        runJob(coverJob({ input: A, output: f('fit.webp'), size: 100, fit: 'none' }), deps),
        runJob(collageJob({ inputs: [A, B, A, B], output: f('collage 4.jpg'), gap: 6 }), deps),
        runJob(collageJob({ inputs: [A, B, A], output: f('collage3.png'), size: 301, background: '#ff0000' }), deps),
        runJob(thumbJob({ input: B, output: f('thumb.jpg'), size: 64 }), deps),
        until(() => [qa, qb].every((j) => j.status === 'done' || j.status === 'failed'), 30000),
        bashDir ? exec(bash, ['-s'], { input: renderJob(scriptJob, 'bash', { tools: realTools }).text + '\n', cwd: bashDir }) : null,
        cmdDir ? exec('cmd.exe', ['/d', '/c', path.join(cmdDir, 'run.bat')], { cwd: cmdDir }) : null,
      ]);
      runs.forEach((r, i) => ok(`magick run ${i}`, r.status === 'fulfilled', String(r.reason?.message || r.reason)));
      const sizes = { 'cover.jpg': 'JPEG 600 600', 'pad.png': 'PNG 300 300', 'fit.webp': 'WEBP 100 63', 'collage 4.jpg': 'JPEG 600 600', 'collage3.png': 'PNG 301 301', 'thumb.jpg': 'JPEG 37 64', 'conv.png': 'PNG 300 300', 'q1.png': 'PNG 120 120' };
      const id = spawnSync(real.magick.path, [...Object.keys(sizes).map((n) => f(n) + '[0]'), '-format', '%m %w %h\\n', 'info:'], { encoding: 'utf8', timeout: 60000 });
      eq('magick outputs identified', id.stdout.trim().split(/\r?\n/).map((l) => { const p = parseIdentify(l); return p && `${p.format} ${p.width} ${p.height}`; }), Object.values(sizes));
      eq('magick through the queue', [qa.status, qb.status, qb.vars.identify], ['done', 'done', { format: 'PNG', width: 320, height: 200 }]);
      if (bashDir) ok('magick script in bash', runs[7].value?.status === 0 && fs.existsSync(path.join(bashDir, 'shell collage.jpg')), runs[7].value?.stderr);
      if (cmdDir) ok('magick script in cmd.exe', runs[8].value?.status === 0 && fs.existsSync(path.join(cmdDir, 'shell collage.jpg')), (runs[8].value?.stdout || '') + (runs[8].value?.stderr || ''));
    } else skip('real ImageMagick jobs (magick not found)');

    if (real.ffmpeg && real.ffprobe) {
      const dir = fs.mkdtempSync(path.join(tmp, 'ffmpeg-'));
      const sr = 44100, n = sr * 6;
      const tone = (f) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * f * i) / sr));
      const wav = path.join(dir, 'tone.wav');
      fs.writeFileSync(wav, encodeWav([tone(440), tone(660)], { sampleRate: sr }));
      const probe = async (file) => (await runJob(probeJob(file), deps)).vars.ffprobe;
      const flac = path.join(dir, 'Тон «1».flac');
      await runJob(convertAudio({ input: wav, output: flac, tags: { title: 'Тон', artist: 'A; B', track: 2, trackTotal: 5 }, loudnorm: {}, duration: 6 }), deps);
      const pf = await probe(flac);
      eq('ffmpeg convert + loudnorm', [pf.container, pf.kind, pf.audio.codec, pf.tags.title, pf.tags.track, Math.round(pf.duration)], ['flac', 'audio', 'flac', 'Тон', 2, 6]);
      const sj = splitTracks({ input: wav, outDir: dir, format: 'wav', tracks: [{ title: 'One', start: 0 }, { title: 'Two', start: 2.5 }] });
      await runJob(sj, deps);
      eq('ffmpeg split', await Promise.all(sj.outputs.map(async (f) => Math.round((await probe(f)).duration * 10) / 10)), [2.5, 3.5]);
      const book = path.join(dir, 'book.m4a');
      await runJob(joinChapters({ inputs: sj.outputs.map((p, i) => ({ path: p, title: `Part ${i + 1}`, duration: i ? 3.5 : 2.5 })), output: book, tags: { title: 'Book' } }), deps);
      const pb = await probe(book);
      eq('ffmpeg join chapters', [pb.container, pb.chapters.map((c) => c.title), pb.tags.title], ['m4a', ['Part 1', 'Part 2'], 'Book']);
    } else skip('real ffmpeg / ffprobe jobs (ffmpeg or ffprobe not found)');
    if (real['yt-dlp']) ok('yt-dlp version', /^\d{4}\.\d+\.\d+/.test(real['yt-dlp'].version || ''), real['yt-dlp'].version);
    else skip('yt-dlp --version (yt-dlp not found; the yt-dlp jobs are only built and parsed, never run)');
    mark('end');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left in the temp folder */ }
  }

  console.log(`mediajobs: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
