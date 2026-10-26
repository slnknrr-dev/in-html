// mediatags/test.js - unit tests of the media tags library: `node mediatags/test.js` (importing the module runs nothing).
// Every fixture is generated here: MP3 (mp3/encoder.js + ID3v2.3 / 2.4 with hand-built SYLT, CHAP / CTOC, UFID frames +
// ID3v1), FLAC (metadata blocks), Ogg Opus (ogg/opus.js), WAV (wav/wav.js + an id3 chunk), AIFF, MP4 / M4B (mp4/box.js:
// ilst, Nero chpl, a QuickTime chapter text track, moov after a large mdat), Matroska (webm/ebml.js: SeekHead to
// metadata after a large cluster, read through a counting source) and the text formats.

// Why generated fixtures: no binary blobs in the repo, every byte of a fixture is explainable from this file, and
// edge cases (moov after mdat, metadata after a large cluster) are built deliberately rather than hoped for.
// The counting source asserts the reader seeks instead of scanning whole files: the performance contract is tested.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeMp3 } from '../mp3/encoder.js';
import { writeId3v1, writeId3v2 } from '../mp3/id3.js';
import { scanMp3 } from '../mp3/frame.js';
import { muxOggOpus } from '../ogg/opus.js';
import { encodeWav } from '../wav/wav.js';
import { MATRIX, ascii, box, cat, fixed16, fixed8, fullBox, i16, u16, u32, u64, u8, utf8, zeros } from '../mp4/box.js';
import { buildAudioSpecificConfig, buildEsds } from '../mp4/codecs.js';
import { ID, el, elBinary, elFloat, elString, elUint, elVoid, encodeId } from '../webm/ebml.js';
import { asSource, blobSource, bytesSource, cachedSource, countingSource } from './source.js';
import { EXT, containerOf, kindOf, mimeOf } from './detect.js';
import { readMedia, readMediaSync } from './read.js';
import { buildFlacMeta, parseFlacMeta } from './flac.js';
import { MKV, readMatroskaMeta, readMatroskaMetaSync } from './mkv.js';
import { isLrc, lineAt, parseLrc, plainLyrics, serializeLrc, wordAt } from './lrc.js';
import { buildCue, cueTracks, msf, parseCue, parseMsf, serializeCue } from './cue.js';
import { parseAss, parseSrt, parseSubs, parseVtt, shiftCues, toSrt, toVtt } from './subs.js';
import { parseNfo, serializeNfo } from './nfo.js';
import { cleanTitle, normTitle, parseName, sortTitle } from './names.js';
import { compileTemplate } from './template.js';
import { COVER_NAMES, groupSidecars, isCoverName, langCode } from './sidecar.js';
import { parseM3u, parsePls, parseXspf, writeM3u, writePls, writeXspf } from './playlist.js';
import { normalizeTags } from './fields.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const enc = new TextEncoder();
const latin = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const be32 = (n) => new Uint8Array([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
const le32 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
const ss = (n) => new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const PNG = cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), ascii('IHDR'), u32(640), u32(480), new Uint8Array([8, 6, 0, 0, 0]), u32(0));

function sine(n, rate, f = 440) {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / rate);
  return s;
}

// --- ID3 helpers -------------------------------------------------------------------------------

function id3frame(id, payload, v4) {
  return cat(latin(id), v4 ? ss(payload.length) : be32(payload.length), new Uint8Array(2), payload);
}
// Appends frames to a tag written by writeId3v2 (no padding) and fixes the tag size.
function withFrames(tag, frames) {
  const body = cat(tag.subarray(10), ...frames);
  const head = tag.slice(0, 10);
  head.set(ss(body.length), 6);
  return cat(head, body);
}
const t3 = (s) => cat(new Uint8Array([3]), enc.encode(s));

function sylt(entries) {
  return cat(new Uint8Array([3]), latin('eng'), new Uint8Array([2, 1]), new Uint8Array([0]),
    ...entries.map(([text, ms]) => cat(enc.encode(text), new Uint8Array([0]), be32(ms))));
}
function chap(id, start, end, title, v4) {
  return cat(latin(id), new Uint8Array([0]), be32(start), be32(end), be32(0xffffffff), be32(0xffffffff), id3frame('TIT2', t3(title), v4));
}
function ctoc(id, children, v4) {
  return cat(latin(id), new Uint8Array([0, 3, children.length]), ...children.map((c) => cat(latin(c), new Uint8Array([0]))), id3frame('TIT2', t3('Contents'), v4));
}

// --- MP4 helpers -------------------------------------------------------------------------------

const data = (flag, bytes) => box('data', u32(flag), u32(0), bytes);
const text = (s) => data(1, utf8(s));
const freeform = (name, value) => box('----', fullBox('mean', 0, 0, ascii('com.apple.iTunes')), fullBox('name', 0, 0, ascii(name)), text(value));
const langCodeMp4 = (s) => (((s.charCodeAt(0) - 0x60) << 10) | ((s.charCodeAt(1) - 0x60) << 5) | (s.charCodeAt(2) - 0x60));
const hdlr = (type, name) => fullBox('hdlr', 0, 0, u32(0), ascii(type), zeros(12), ascii(name + '\0'));
const dinf = () => box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
const tkhd = (id, dur, w = 0, h = 0) => fullBox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(dur), zeros(8), i16(0), i16(0), fixed8(1), u16(0), MATRIX, fixed16(w), fixed16(h));
const mdhd = (scale, dur, lang = 'eng') => fullBox('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(dur), u16(langCodeMp4(lang)), u16(0));

function stbl(entry, samples, durations, offsets) {
  const stts = fullBox('stts', 0, 0, u32(durations.length), durations.map((d) => [u32(1), u32(d)]));
  const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1));
  const stsz = fullBox('stsz', 0, 0, u32(0), u32(samples.length), samples.map((s) => u32(s)));
  const stco = fullBox('stco', 0, 0, u32(offsets.length), offsets.map((o) => u32(o)));
  return box('stbl', fullBox('stsd', 0, 0, u32(1), entry), stts, stsc, stsz, stco);
}

function mp4aEntry(rate, ch) {
  return box('mp4a', zeros(6), u16(1), u16(0), u16(0), u32(0), u16(ch), u16(16), u16(0), u16(0), u32(rate * 65536),
    box('esds', buildEsds({ asc: buildAudioSpecificConfig({ objectType: 2, sampleRate: rate, channels: ch }) })));
}
const avc1Entry = (w, h) => box('avc1', zeros(6), u16(1), zeros(16), u16(w), u16(h), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(24), i16(-1));
const textEntry = () => box('text', zeros(6), u16(1), zeros(40));
const chapterSample = (title) => cat(u16(enc.encode(title).length), utf8(title), box('encd', u32(0x100)));

// An M4B audiobook: AAC track (+ tref/chap) and a chapter text track; chpl too. `moovLast` puts moov after a large mdat.
function buildM4b({ moovLast = false, pad = 0, video = false } = {}) {
  const titles = ['Opening', 'The Middle', 'The End'];
  const chStarts = [0, 60000, 150000], total = 200000; // ms
  const chSamples = titles.map(chapterSample);
  const audioSamples = Array.from({ length: 20 }, () => 100);
  const ilst = box('ilst',
    box('\xa9nam', text('Book Title')), box('\xa9ART', text('Author Name')), box('aART', text('Author Name')), box('\xa9alb', text('Book Title')),
    box('trkn', data(0, new Uint8Array([0, 0, 0, 1, 0, 2, 0, 0]))), box('disk', data(0, new Uint8Array([0, 0, 0, 1, 0, 1]))),
    box('\xa9day', text('2019-06-01')), box('\xa9gen', text('Audiobook')), box('\xa9wrt', text('Composer X')), box('\xa9cmt', text('A comment')),
    box('\xa9nrt', text('Narrator Y')), box('desc', text('Short')), box('ldes', text('Long description')), box('cpil', data(21, new Uint8Array([0]))),
    box('tmpo', data(21, new Uint8Array([0, 100]))), box('stik', data(21, new Uint8Array([video ? 10 : 2]))), box('covr', data(13, JPEG)),
    video ? box('tvsh', text('The Show')) : null, video ? box('tvsn', data(21, new Uint8Array([0, 0, 0, 3]))) : null,
    video ? box('tves', data(21, new Uint8Array([0, 0, 0, 7]))) : null, video ? box('tvnn', text('NET')) : null,
    freeform('replaygain_track_gain', '-3.50 dB'), freeform('replaygain_track_peak', '0.75'), freeform('MusicBrainz Track Id', 'mbid-rec'),
    freeform('MusicBrainz Album Id', 'mbid-album'), freeform('SERIES', 'The Series'), freeform('SERIES-PART', '2'), freeform('iTunSMPB', 'junk'));
  const meta = fullBox('meta', 0, 0, hdlr('mdir', ''), ilst);
  const chpl = fullBox('chpl', 1, 0, u32(0), u8(titles.length), titles.map((t, i) => [u64(chStarts[i] * 10000), u8(enc.encode(t).length), utf8(t)]));
  const ftyp = box('ftyp', ascii(video ? 'mp42' : 'M4B '), u32(0), ascii('M4A mp42isom'));
  const build = (mdatStart) => {
    // mdat layout: [pad][audio samples][chapter samples]
    let o = mdatStart + 8 + pad;
    const aOff = [];
    for (const s of audioSamples) { aOff.push(o); o += s; }
    const cOff = [];
    for (const s of chSamples) { cOff.push(o); o += s.length; }
    const audio = box('trak', tkhd(1, total), box('tref', box('chap', u32(2))), box('mdia', mdhd(44100, Math.round(total * 44.1)), hdlr('soun', 'SoundHandler'),
      box('minf', fullBox('smhd', 0, 0, u16(0), u16(0)), dinf(), stbl(mp4aEntry(44100, 2), audioSamples, audioSamples.map(() => 1024), aOff))));
    const durs = chStarts.map((s, i) => (i + 1 < chStarts.length ? chStarts[i + 1] : total) - s);
    const chapters = box('trak', tkhd(2, total), box('mdia', mdhd(1000, total), hdlr('text', 'ChapterHandler'),
      box('minf', box('gmhd'), dinf(), stbl(textEntry(), chSamples.map((s) => s.length), durs, cOff))));
    const vtrak = video ? box('trak', tkhd(3, total, 1280, 720), box('mdia', mdhd(24000, total * 24, 'und'), hdlr('vide', 'VideoHandler'),
      box('minf', fullBox('vmhd', 0, 1, zeros(8)), dinf(), stbl(avc1Entry(1280, 720), Array(4800).fill(10), Array(4800).fill(1000), [aOff[0]])))) : null;
    const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(total), fixed16(1), fixed8(1), zeros(10), MATRIX, zeros(24), u32(4));
    const moov = box('moov', mvhd, audio, chapters, vtrak, box('udta', chpl, meta));
    const mdat = box('mdat', zeros(pad), audioSamples.map((s) => zeros(s)), chSamples);
    return { moov, mdat };
  };
  if (moovLast) {
    const { moov, mdat } = build(ftyp.length);
    return cat(ftyp, mdat, moov);
  }
  const first = build(0);
  const { moov, mdat } = build(ftyp.length + first.moov.length);
  return cat(ftyp, moov, mdat);
}

// --- Matroska helpers --------------------------------------------------------------------------

const simple = (name, value) => el(ID.SimpleTag, elString(ID.TagName, name), elString(ID.TagString, value));
const tag = (targets, ...simples) => el(ID.Tag, el(ID.Targets, targets), simples);
const atom = (uid, ns, title) => el(MKV.ChapterAtom, elUint(MKV.ChapterUID, uid), elUint(MKV.ChapterTimeStart, ns), el(MKV.ChapterDisplay, elString(MKV.ChapString, title), elString(MKV.ChapLanguage, 'eng')));
const attached = (name, mime, bytes, uid) => el(MKV.AttachedFile, elString(MKV.FileName, name), elString(MKV.FileMediaType, mime), elBinary(MKV.FileData, bytes), elUint(MKV.FileUID, uid));
const ebmlHeader = (doc) => el(ID.EBML, elUint(ID.EBMLVersion, 1), elUint(ID.EBMLReadVersion, 1), elUint(ID.EBMLMaxIDLength, 4), elUint(ID.EBMLMaxSizeLength, 8),
  elString(ID.DocType, doc), elUint(ID.DocTypeVersion, 4), elUint(ID.DocTypeReadVersion, 2));

// Video with SeekHead -> Info, Tracks before a big cluster and Tags, Chapters, Attachments after it.
function buildMkv(clusterBytes) {
  const info = el(ID.Info, elUint(ID.TimestampScale, 1000000), elFloat(ID.Duration, 1425000), elString(ID.Title, 'Segment Title'),
    elString(ID.MuxingApp, 'mediatags-test'), elString(ID.WritingApp, 'mediatags-test'));
  const tracks = el(ID.Tracks,
    el(ID.TrackEntry, elUint(ID.TrackNumber, 1), elUint(ID.TrackUID, 0x1111), elUint(ID.TrackType, 1), elString(ID.CodecID, 'V_MPEG4/ISO/AVC'),
      elUint(ID.DefaultDuration, 41708333), el(ID.Video, elUint(ID.PixelWidth, 1920), elUint(ID.PixelHeight, 1080))),
    el(ID.TrackEntry, elUint(ID.TrackNumber, 2), elUint(ID.TrackUID, 0x2222), elUint(ID.TrackType, 2), elString(ID.CodecID, 'A_OPUS'),
      elString(ID.Language, 'jpn'), el(ID.Audio, elFloat(ID.SamplingFrequency, 48000), elUint(ID.Channels, 2))),
    el(ID.TrackEntry, elUint(ID.TrackNumber, 3), elUint(ID.TrackUID, 0x3333), elUint(ID.TrackType, 0x11), elString(ID.CodecID, 'S_TEXT/ASS'),
      elString(ID.Name, 'Signs'), elUint(ID.FlagDefault, 0), elUint(ID.FlagForced, 1)));
  const cluster = el(ID.Cluster, elUint(ID.Timestamp, 0), el(ID.SimpleBlock, new Uint8Array([0x81, 0, 0, 0x80]), new Uint8Array(clusterBytes)));
  const tags = el(ID.Tags,
    tag(elUint(MKV.TargetTypeValue, 70), simple('TITLE', 'My Show')),
    tag(elUint(MKV.TargetTypeValue, 60), simple('PART_NUMBER', '2')),
    tag([elUint(MKV.TargetTypeValue, 50), elString(MKV.TargetType, 'EPISODE')], simple('TITLE', 'Pilot'), simple('PART_NUMBER', '5'),
      simple('DATE_RELEASED', '2011-04-17'), simple('GENRE', 'Drama'), simple('COMMENT', 'Episode comment')),
    tag(elUint(MKV.TagTrackUID, 0x2222), simple('BPS', '128000')));
  const chapters = el(ID.Chapters, el(MKV.EditionEntry, elUint(MKV.EditionFlagDefault, 1),
    atom(1, 0, 'Opening'), atom(2, 90e9, 'Part A'), atom(3, 700e9, 'Part B')));
  const attachments = el(ID.Attachments, attached('font.ttf', 'application/x-truetype-font', new Uint8Array(100000), 11), attached('cover.jpg', 'image/jpeg', JPEG, 12));
  const order = [[ID.Info, info], [ID.Tracks, tracks], [null, cluster], [ID.Tags, tags], [ID.Chapters, chapters], [ID.Attachments, attachments]];
  const seekHead = (pos) => el(ID.SeekHead, order.filter(([id]) => id).map(([id]) => el(ID.Seek, elBinary(ID.SeekID, encodeId(id)), elUint(ID.SeekPosition, pos.get(id) || 0, 8))));
  const voidEl = elVoid(64);
  const sh0 = seekHead(new Map());
  const pos = new Map();
  let o = sh0.length + voidEl.length;
  for (const [id, x] of order) { if (id) pos.set(id, o); o += x.length; }
  const segment = el(ID.Segment, seekHead(pos), voidEl, order.map(([, x]) => x));
  return cat(ebmlHeader('matroska'), segment);
}

// Audio-only WebM: no SeekHead, no Duration, music tags (album 50 + track 30).
function buildMka() {
  const info = el(ID.Info, elUint(ID.TimestampScale, 1000000), elString(ID.MuxingApp, 'x'));
  const tracks = el(ID.Tracks, el(ID.TrackEntry, elUint(ID.TrackNumber, 1), elUint(ID.TrackUID, 7), elUint(ID.TrackType, 2), elString(ID.CodecID, 'A_VORBIS'),
    el(ID.Audio, elFloat(ID.SamplingFrequency, 44100), elUint(ID.Channels, 2))));
  const tags = el(ID.Tags,
    tag(elUint(MKV.TargetTypeValue, 50), simple('TITLE', 'The Album'), simple('ARTIST', 'Album Artist'), simple('TOTAL_PARTS', '10'), simple('DATE_RELEASED', '2003')),
    tag(elUint(MKV.TargetTypeValue, 30), simple('TITLE', 'Track Title'), simple('ARTIST', 'Track Artist'), simple('PART_NUMBER', '4'), simple('GENRE', 'Jazz')));
  const block = (rel) => el(ID.SimpleBlock, new Uint8Array([0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80]), new Uint8Array(20));
  const c1 = el(ID.Cluster, elUint(ID.Timestamp, 0), block(0), block(200));
  const c2 = el(ID.Cluster, elUint(ID.Timestamp, 5000), block(0), block(400));
  return cat(ebmlHeader('webm'), el(ID.Segment, info, tracks, tags, c1, c2));
}

// --- AIFF ---------------------------------------------------------------------------------------

function buildAiff() {
  const chunk = (id, body) => cat(latin(id), be32(body.length), body, body.length & 1 ? new Uint8Array(1) : new Uint8Array(0));
  const comm = cat(u16(2), u32(44100), u16(16), new Uint8Array([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]));
  const body = cat(latin('AIFF'), chunk('COMM', comm), chunk('NAME', latin('Aiff Song')), chunk('ID3 ', writeId3v2({ artist: 'Aiff Artist' }, { version: 3 })),
    chunk('SSND', cat(u32(0), u32(0), new Uint8Array(400))));
  return cat(latin('FORM'), be32(body.length), body);
}

// --- tests ---------------------------------------------------------------------------------------

export async function run() {
  let pass = 0, fail = 0;
  // canonical JSON: sorted object keys, byte arrays by length
  const show = (v) => JSON.stringify(v, (k, x) => {
    if (x instanceof Uint8Array) return `<${x.length} bytes>`;
    if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]]));
    return x;
  });
  const eq = (name, got, want) => {
    if (show(got) === show(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${show(got)}\n  want ${show(want)}`); }
  };
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + show(info) : ''}`); } };
  const near = (name, got, want, tol = 1e-3) => ok(name, typeof got === 'number' && Math.abs(got - want) <= tol, { got, want });
  const fixtures = []; // [name, bytes] of every container fixture, for the async / damage checks at the end
  const subset = (name, got, want) => {
    const bad = Object.entries(want).filter(([k, v]) => show(got?.[k]) !== show(v));
    if (!bad.length) pass++;
    else { fail++; console.log(`FAIL ${name}: ${bad.map(([k, v]) => `${k}: got ${show(got?.[k])} want ${show(v)}`).join('; ')}\n  all: ${show(got)}`); }
  };

  // --- sources ---
  {
    const big = new Uint8Array(300000).map((_, i) => i & 0xff);
    const cnt = countingSource(bytesSource(big));
    // drop .bytes so the cache really reads
    const raw = { size: cnt.size, read: cnt.read };
    const c = cachedSource(raw, { block: 65536 });
    let okAll = true;
    for (let i = 0; i < 100; i++) { const b = await c.read(i * 100, 10); if (b[0] !== ((i * 100) & 0xff) || b.length !== 10) okAll = false; }
    ok('cached small reads', okAll);
    eq('cached reads hit one block', cnt.stats.reads, 1);
    const across = await c.read(65530, 20);
    eq('read across blocks', [across.length, across[0], across[19]], [20, 65530 & 0xff, 65549 & 0xff]);
    const end = await c.read(299990, 100);
    eq('read at the end is short', end.length, 10);
    const blob = blobSource(new Blob([big]));
    eq('blob source', Array.from(await blob.read(256, 3)), [0, 1, 2]);
    eq('asSource of ArrayBuffer', asSource(big.buffer).size, 300000);
  }

  // --- detect ---
  eq('kindOf by extension', ['a.mkv', 'b.MP3', 'c.lrc', 'd.cue', 'e.nfo', 'f.m3u8', 'g.srt', 'h.jpg', 'i.txt', 'j.xyz'].map((n) => kindOf(n)),
    ['video', 'audio', 'lyrics', 'cue', 'nfo', 'playlist', 'subtitle', 'image', 'text', 'other']);
  eq('EXT tables', [EXT.audio.includes('opus'), EXT.video.includes('m2ts'), EXT.lyrics], [true, true, ['lrc']]);
  eq('mimeOf', ['x.flac', 'x.mkv', 'x.vtt', 'x.zzz'].map(mimeOf), ['audio/flac', 'video/x-matroska', 'text/vtt', 'application/octet-stream']);
  eq('containerOf images', [containerOf(JPEG), containerOf(PNG)], ['jpeg', 'png']);

  // --- MP3 / ID3v2.3 ---
  const pcm = sine(44100, 44100);
  const mp3 = encodeMp3([pcm], { sampleRate: 44100, bitrate: 64, channels: 1 });
  const lrcLyrics = '[00:01.00]First line\n[00:02.50]Second line\n';
  {
    const tag = withFrames(writeId3v2({
      title: 'Song v2.3', artist: 'Artist A / Artist B', albumArtist: 'Various', track: '3/12', disc: '1/2', genre: '(17)', year: '1999',
      composer: 'Comp', comment: 'Main comment', lyrics: lrcLyrics, bpm: '120',
      user: { REPLAYGAIN_TRACK_GAIN: '-6.20 dB', REPLAYGAIN_TRACK_PEAK: '0.988000', REPLAYGAIN_ALBUM_GAIN: '-5.5 dB', 'MusicBrainz Album Id': 'mb-album', CATALOGNUMBER: 'CAT-1' },
    }, { version: 3, pictures: [{ mime: 'image/png', type: 4, data: PNG }, { mime: 'image/jpeg', type: 3, description: 'front', data: JPEG }] }),
    [id3frame('TDAT', cat(new Uint8Array([0]), latin('1503')), false), id3frame('COMM', cat(new Uint8Array([0]), latin('eng'), latin('iTunNORM'), new Uint8Array([0]), latin(' 0000')), false)]);
    const file = cat(tag, mp3, writeId3v1({ title: 'v1 title', album: 'V1 Album', genre: 'Blues' }));
    fixtures.push(['mp3 id3v2.3', file]);
    const m = readMediaSync(file);
    subset('mp3 v2.3 info', m, { container: 'mp3', kind: 'audio', mime: 'audio/mpeg', pictures: 2 });
    subset('mp3 v2.3 audio', m.audio, { codec: 'mp3', sampleRate: 44100, channels: 1, bitsPerSample: null });
    const scan = scanMp3(mp3);
    near('mp3 duration (Info frame)', m.duration, scan.duration, 0.03);
    ok('mp3 bitrate', Math.abs(m.bitrate - 64) <= 3, m.bitrate);
    subset('mp3 v2.3 tags', m.tags, {
      title: 'Song v2.3', artist: 'Artist A / Artist B', artists: ['Artist A', 'Artist B'], albumArtist: 'Various', album: 'V1 Album', track: 3,
      trackTotal: 12, disc: 1, discTotal: 2, year: 1999, date: '1999-03-15', genre: ['Rock'], composer: 'Comp', comment: 'Main comment', bpm: 120,
      catalog: 'CAT-1', lyrics: 'First line\nSecond line', mb: { albumId: 'mb-album' },
    });
    eq('mp3 v2.3 replaygain', m.replaygain, { trackGain: -6.2, trackPeak: 0.988, albumGain: -5.5, albumPeak: null });
    eq('mp3 LRC lyrics -> syncedLyrics', m.syncedLyrics, lrcLyrics);
    eq('mp3 front cover preferred', [m.cover.type, m.cover.mime, m.cover.description, m.cover.data.length], [3, 'image/jpeg', 'front', JPEG.length]);
    ok('mp3 no warnings', !m.warnings.length, m.warnings);
    const nc = readMediaSync(file, { cover: false });
    eq('mp3 cover: false', [nc.cover, nc.pictures], [null, 2]);
    // async through a counting source equals the sync result
    const cnt = countingSource(bytesSource(file));
    const am = await readMedia({ size: cnt.size, read: cnt.read });
    eq('mp3 async = sync', show(am), show(m));
    ok('mp3 async reads are few', cnt.stats.reads <= 3, cnt.stats);
  }

  // --- MP3 / ID3v2.4 with SYLT, CHAP / CTOC, UFID, multi-values ---
  {
    const tag = withFrames(writeId3v2({ title: 'Song v2.4', album: 'Album 4', year: '2024-03-15', composer: 'C', publisher: 'Label X', grouping: 'Grp', language: 'eng',
      bpm: '128', user: { MOOD: 'Calm', 'MusicBrainz Artist Id': 'mb-artist', ARTISTS: 'Artist A\u0000Artist B' } }, { version: 4 }), [
      id3frame('TPE1', t3('Artist A\u0000Artist B'), true),
      id3frame('TCON', t3('Rock\u0000Pop\u000013'), true),
      id3frame('TCMP', t3('1'), true),
      id3frame('TDOR', t3('1990'), true),
      id3frame('TKEY', t3('Am'), true),
      id3frame('TSRC', t3('USXXX0000001'), true),
      id3frame('UFID', cat(latin('http://musicbrainz.org'), new Uint8Array([0]), latin('mb-recording')), true),
      id3frame('SYLT', sylt([['Hello', 1000], ['\nWorld', 3000], [' again', 3500]]), true),
      id3frame('CTOC', ctoc('toc', ['ch2', 'ch1'], true), true),
      id3frame('CHAP', chap('ch1', 0, 400, 'Intro', true), true),
      id3frame('CHAP', chap('ch2', 400, 1000, 'Main', true), true),
    ]);
    fixtures.push(['mp3 id3v2.4', cat(tag, mp3)]);
    const m = readMediaSync(cat(tag, mp3));
    subset('mp3 v2.4 tags', m.tags, {
      title: 'Song v2.4', artist: 'Artist A, Artist B', artists: ['Artist A', 'Artist B'], album: 'Album 4', year: 2024, date: '2024-03-15', originalYear: 1990,
      genre: ['Rock', 'Pop'], compilation: true, bpm: 128, key: 'Am', isrc: 'USXXX0000001', label: 'Label X',
      publisher: 'Label X', grouping: 'Grp', language: 'eng', mood: 'Calm', mb: { recordingId: 'mb-recording', artistId: 'mb-artist' },
    });
    eq('mp3 SYLT -> LRC', m.syncedLyrics, '[00:01.00]Hello\n[00:03.00]<00:03.00>World<00:03.50> again\n');
    eq('mp3 CHAP in CTOC order', m.chapters, [{ start: 0.4, end: 1, title: 'Main' }, { start: 0, end: 0.4, title: 'Intro' }].sort((a, b) => a.start - b.start));
  }

  // --- FLAC ---
  const flacMeta = buildFlacMeta({
    streamInfo: { sampleRate: 48000, channels: 2, bitsPerSample: 24, totalSamples: 48000 * 300, minBlock: 4096, maxBlock: 4096 },
    comments: [['TITLE', 'Flac Song'], ['ARTIST', 'One'], ['ARTIST', 'Two'], ['ALBUM', 'Flac Album'], ['ALBUM ARTIST', 'The Band'], ['TRACKNUMBER', '5'],
      ['TRACKTOTAL', '9'], ['DISCNUMBER', '1/2'], ['DATE', '2010-05-01'], ['GENRE', 'Jazz'], ['GENRE', 'Fusion'], ['COMPOSER', 'Writer'],
      ['LYRICS', 'Plain words'], ['COMPILATION', '0'], ['BPM', '90.5'], ['REPLAYGAIN_ALBUM_GAIN', '+1.25 dB'], ['REPLAYGAIN_ALBUM_PEAK', '0.5'],
      ['MUSICBRAINZ_TRACKID', 'rec-id'], ['MUSICBRAINZ_RELEASETRACKID', 'track-id'], ['MUSICBRAINZ_RELEASEGROUPID', 'rg-id'], ['LABEL', 'Lbl'],
      ['ISRC', 'GB0000000001'], ['ORIGINALDATE', '1975'], ['MOOD', 'Happy'], ['CUE_TRACK01_TITLE', 'Part One'], ['CUE_TRACK02_TITLE', 'Part Two']],
    pictures: [{ type: 4, mime: 'image/png', data: PNG, width: 640, height: 480 }, { type: 3, mime: 'image/jpeg', description: 'Front', data: JPEG }],
    cuesheet: { catalog: '1234567890123', leadIn: 88200, isCd: true, tracks: [
      { number: 1, offset: 0, isrc: 'GB0000000001', indices: [{ number: 1, offset: 0 }] },
      { number: 2, offset: 48000 * 100, indices: [{ number: 0, offset: 0 }, { number: 1, offset: 48000 }] },
      { number: 170, offset: 48000 * 300, indices: [] }] },
    padding: 64,
  });
  const flac = cat(flacMeta, new Uint8Array([0xff, 0xf8, 0x69, 0x18]), new Uint8Array(2000));
  fixtures.push(['flac', flac], ['id3 + flac', cat(writeId3v2({ title: 'From ID3' }), flac)]);
  {
    const p = parseFlacMeta(flac);
    subset('flac streamInfo', p.streamInfo, { sampleRate: 48000, channels: 2, bitsPerSample: 24, totalSamples: 14400000, duration: 300, minBlock: 4096 });
    eq('flac blocks', [p.pictures.length, p.pictures[0].width, p.tags.comments.length, p.audioOffset], [2, 640, 26, flacMeta.length]);
    eq('flac cuesheet', [p.cuesheet.catalog, p.cuesheet.isCd, p.cuesheet.tracks.length, p.cuesheet.tracks[1].indices[1].offset, p.cuesheet.tracks[0].isrc],
      ['1234567890123', true, 3, 48000, 'GB0000000001']);
    const m = readMediaSync(flac);
    subset('flac media', m, { container: 'flac', kind: 'audio', mime: 'audio/flac', duration: 300, pictures: 2 });
    eq('flac audio', m.audio, { codec: 'flac', sampleRate: 48000, channels: 2, bitsPerSample: 24 });
    subset('flac tags', m.tags, {
      title: 'Flac Song', artist: 'One, Two', artists: ['One', 'Two'], album: 'Flac Album', albumArtist: 'The Band', track: 5, trackTotal: 9, disc: 1,
      discTotal: 2, date: '2010-05-01', year: 2010, originalYear: 1975, genre: ['Jazz', 'Fusion'], composer: 'Writer', lyrics: 'Plain words',
      compilation: false, bpm: 90.5, label: 'Lbl', isrc: 'GB0000000001', mood: 'Happy', mb: { trackId: 'track-id', recordingId: 'rec-id', releaseGroupId: 'rg-id' },
    });
    eq('flac replaygain', m.replaygain, { trackGain: null, trackPeak: null, albumGain: 1.25, albumPeak: 0.5 });
    eq('flac cover', [m.cover.type, m.cover.mime, m.cover.description], [3, 'image/jpeg', 'Front']);
    eq('flac CUESHEET chapters', m.chapters, [{ start: 0, end: 101, title: 'Part One' }, { start: 101, end: 300, title: 'Part Two' }]);
    const noCover = readMediaSync(flac, { cover: false });
    eq('flac cover: false', [noCover.cover, noCover.pictures], [null, 2]);
    const id3flac = readMediaSync(cat(writeId3v2({ title: 'From ID3' }), flac));
    eq('ID3-prefixed FLAC', [containerOf(cat(writeId3v2({ title: 'x' }), flac.subarray(0, 100))), id3flac.container, id3flac.tags.title], ['flac', 'flac', 'Flac Song']);
  }

  // --- Ogg Opus ---
  {
    const packets = Array.from({ length: 100 }, () => new Uint8Array([0xf8, 1, 2, 3, 4, 5, 6, 7]));
    const ogg = muxOggOpus(packets, { channels: 2, preSkip: 312, serial: 1234, tags: {
      title: 'Opus Song', artist: 'Opus Artist', album: 'Opus Album', TRACKNUMBER: '2/7', R128_TRACK_GAIN: '-512',
      CHAPTER001: '00:00:00.000', CHAPTER001NAME: 'Start', CHAPTER002: '00:00:01.250', CHAPTER002NAME: 'Later',
    }, pictures: [{ type: 3, mime: 'image/jpeg', data: JPEG }] });
    fixtures.push(['ogg opus', ogg]);
    const m = readMediaSync(ogg);
    subset('opus media', m, { container: 'ogg', kind: 'audio', mime: 'audio/ogg', pictures: 1 });
    near('opus duration (granule - pre-skip)', m.duration, (100 * 960 - 312) / 48000, 1e-6);
    eq('opus audio', m.audio, { codec: 'opus', sampleRate: 48000, channels: 2, bitsPerSample: null });
    subset('opus tags', m.tags, { title: 'Opus Song', artist: 'Opus Artist', album: 'Opus Album', track: 2, trackTotal: 7 });
    eq('opus R128 gain', m.replaygain.trackGain, 3);
    eq('opus chapters', m.chapters, [{ start: 0, end: 1.25, title: 'Start' }, { start: 1.25, end: m.duration, title: 'Later' }]);
    eq('opus cover', [m.cover.mime, m.cover.data.length], ['image/jpeg', JPEG.length]);
    eq('kindOf ogg head', kindOf('x.ogg', ogg.subarray(0, 4096)), 'audio');
  }

  // --- WAV ---
  {
    const wav = encodeWav([sine(4000, 8000)], { sampleRate: 8000, info: { title: 'Wav Song', artist: 'Wav Artist', album: 'Wav Album', date: '2005', genre: 'Ambient', comment: 'note', track: '7' } });
    const m = readMediaSync(wav);
    subset('wav media', m, { container: 'wav', kind: 'audio', duration: 0.5, bitrate: 128 });
    eq('wav audio', m.audio, { codec: 'pcm', sampleRate: 8000, channels: 1, bitsPerSample: 16 });
    subset('wav INFO tags', m.tags, { title: 'Wav Song', artist: 'Wav Artist', album: 'Wav Album', year: 2005, genre: ['Ambient'], comment: 'note', track: 7 });
    const id3 = writeId3v2({ title: 'ID3 Title', bpm: '99' }, { version: 3 });
    const chunk = cat(latin('id3 '), le32(id3.length), id3, id3.length & 1 ? new Uint8Array(1) : new Uint8Array(0));
    const wav2 = cat(wav, chunk);
    wav2.set(le32(wav2.length - 8), 4);
    fixtures.push(['wav', wav], ['wav + id3', wav2]);
    const m2 = readMediaSync(wav2);
    subset('wav id3 chunk over INFO', m2.tags, { title: 'ID3 Title', artist: 'Wav Artist', bpm: 99 });
  }

  // --- AIFF ---
  {
    fixtures.push(['aiff', buildAiff()]);
    const m = readMediaSync(buildAiff());
    subset('aiff media', m, { container: 'aiff', kind: 'audio', duration: 1 });
    eq('aiff audio', m.audio, { codec: 'pcm', sampleRate: 44100, channels: 2, bitsPerSample: 16 });
    subset('aiff tags', m.tags, { title: 'Aiff Song', artist: 'Aiff Artist' });
  }

  // --- MP4 / M4B ---
  {
    const m4b = buildM4b();
    fixtures.push(['m4b', m4b], ['mp4 video', buildM4b({ video: true })], ['m4b moov last', buildM4b({ moovLast: true, pad: 5000 })]);
    const m = readMediaSync(m4b, { name: 'book.m4b' });
    subset('m4b media', m, { container: 'mp4', kind: 'audio', mime: 'audio/mp4', duration: 200, pictures: 1 });
    eq('m4b audio', m.audio, { codec: 'aac', sampleRate: 44100, channels: 2, bitsPerSample: null });
    subset('m4b tags', m.tags, {
      title: 'Book Title', artist: 'Author Name', albumArtist: 'Author Name', album: 'Book Title', track: 1, trackTotal: 2, disc: 1, discTotal: 1,
      date: '2019-06-01', year: 2019, genre: ['Audiobook'], composer: 'Composer X', comment: 'A comment', narrator: 'Narrator Y',
      description: 'Long description', compilation: false, bpm: 100, mediaKind: 'audiobook', series: 'The Series', seriesPart: 2,
      mb: { recordingId: 'mbid-rec', albumId: 'mbid-album' },
    });
    eq('m4b replaygain', m.replaygain, { trackGain: -3.5, trackPeak: 0.75, albumGain: null, albumPeak: null });
    eq('m4b chapter track', m.chapters, [{ start: 0, end: 60, title: 'Opening' }, { start: 60, end: 150, title: 'The Middle' }, { start: 150, end: 200, title: 'The End' }]);
    eq('m4b streams', m.streams.map((s) => [s.type, s.codec, s.lang]), [['audio', 'aac', 'eng'], ['data', 'mov_text', 'eng']]);
    eq('m4b cover', [m.cover.mime, m.cover.type, m.cover.data.length], ['image/jpeg', 3, JPEG.length]);
    // moov after a 3 MB mdat, read through a counting source
    const tail = buildM4b({ moovLast: true, pad: 3 << 20 });
    const cnt = countingSource(bytesSource(tail));
    const t = await readMedia({ size: cnt.size, read: cnt.read });
    eq('moov at the end', [t.duration, t.tags.title, t.chapters.length, t.chapters[2].title], [200, 'Book Title', 3, 'The End']);
    ok('moov at the end: partial reads', cnt.stats.bytes < 400000, cnt.stats);
    // video with TV tags
    const v = readMediaSync(buildM4b({ video: true }));
    subset('mp4 video', v, { kind: 'video', mime: 'video/mp4' });
    eq('mp4 video info', v.video, { codec: 'h264', width: 1280, height: 720, fps: 24 });
    subset('mp4 tv tags', v.tags, { show: 'The Show', season: 3, episode: 7, network: 'NET', episodeTitle: 'Book Title', mediaKind: 'tvshow' });
  }

  // --- Matroska ---
  {
    const big = 8 << 20;
    const mkv = buildMkv(big);
    const cnt = countingSource(bytesSource(mkv));
    const src = { size: cnt.size, read: cnt.read };
    const m = await readMedia(src);
    ok('mkv partial reads (metadata after an 8 MB cluster)', cnt.stats.bytes < 1 << 20 && mkv.length > big, cnt.stats);
    subset('mkv media', m, { container: 'mkv', kind: 'video', mime: 'video/x-matroska', duration: 1425, pictures: 1 });
    eq('mkv video', m.video, { codec: 'h264', width: 1920, height: 1080, fps: 23.976 });
    eq('mkv audio', m.audio, { codec: 'opus', sampleRate: 48000, channels: 2, bitsPerSample: null });
    eq('mkv streams', m.streams.map((s) => [s.index, s.type, s.codec, s.lang, s.title, s.default, s.forced]), [
      [0, 'video', 'h264', 'eng', null, true, false], [1, 'audio', 'opus', 'jpn', null, true, false], [2, 'subtitle', 'ass', 'eng', 'Signs', false, true],
      [3, 'attachment', 'application/x-truetype-font', null, 'font.ttf', false, false], [4, 'attachment', 'image/jpeg', null, 'cover.jpg', false, false]]);
    subset('mkv TV tags', m.tags, { show: 'My Show', season: 2, episode: 5, title: 'Pilot', episodeTitle: 'Pilot', date: '2011-04-17', year: 2011, genre: ['Drama'], comment: 'Episode comment' });
    eq('mkv chapters', m.chapters, [{ start: 0, end: 90, title: 'Opening' }, { start: 90, end: 700, title: 'Part A' }, { start: 700, end: 1425, title: 'Part B' }]);
    eq('mkv cover attachment', [m.cover.mime, m.cover.data.length, m.cover.type], ['image/jpeg', JPEG.length, 3]);
    const meta = await readMatroskaMeta(mkv);
    eq('readMatroskaMeta', [meta.title, meta.duration, meta.tracks.length, meta.tags.length, meta.tags[3].targetTrackUid, meta.attachments.map((a) => [a.name, a.size, !!a.data])],
      ['Segment Title', 1425, 3, 4, '2222', [['font.ttf', 100000, false], ['cover.jpg', JPEG.length, true]]]);
    eq('readMatroskaMeta tags', [meta.tags[2].targetType, meta.tags[2].targetTypeName, meta.tags[2].simple.TITLE], [50, 'EPISODE', 'Pilot']);
    const mka = buildMka();
    fixtures.push(['mkv', buildMkv(3000)], ['webm audio', mka]);
    const a = readMediaSync(mka);
    subset('webm audio-only', a, { container: 'webm', kind: 'audio', mime: 'audio/webm' });
    near('webm duration from the last cluster', a.duration, 5.4);
    subset('webm music tags (50 + 30)', a.tags, { title: 'Track Title', artist: 'Track Artist', album: 'The Album', albumArtist: 'Album Artist', track: 4, trackTotal: 10, year: 2003, genre: ['Jazz'] });
    ok('readMatroskaMetaSync estimate flag', readMatroskaMetaSync(mka).durationEstimated === true);
    eq('kindOf webm head', [kindOf('a.webm', mka.subarray(0, 4096)), kindOf('a.mkv', mkv.subarray(0, 4096))], ['audio', 'video']);
  }

  // --- images and unknown data ---
  {
    const p = readMediaSync(PNG);
    eq('png image', [p.container, p.kind, p.mime, p.image], ['png', null, 'image/png', { width: 640, height: 480 }]);
    const u = readMediaSync(enc.encode('just some text'));
    eq('unknown data', [u.container, u.kind, u.warnings.length > 0, u.tags], [null, null, true, {}]);
  }

  // --- every container: reading through a source equals reading bytes; damaged copies never throw ---
  {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    fixtures.push(['png', PNG]);
    for (const [name, b] of fixtures) {
      const a = await readMedia({ size: b.length, read: async (o, n) => b.slice(o, o + n) });
      eq(`${name}: async = sync`, show(a), show(readMediaSync(b)));
      let bad = null;
      const check = (x, how) => {
        try {
          const m = readMediaSync(x);
          const sane = (m.duration == null || (Number.isFinite(m.duration) && m.duration > 0)) && (m.bitrate == null || Number.isFinite(m.bitrate)) && Array.isArray(m.warnings);
          if (!sane) bad = bad || `${how}: ${show({ duration: m.duration, bitrate: m.bitrate })}`;
        } catch (e) { bad = bad || `${how}: ${e.message}`; }
      };
      for (let i = 0; i <= 30; i++) check(b.subarray(0, Math.floor((b.length * i) / 31)), `cut ${i}/31`);
      for (let k = 0; k < 30; k++) {
        const c = b.slice();
        for (let j = 0; j < 6; j++) c[Math.floor(rnd() * c.length)] = Math.floor(rnd() * 256);
        check(c, `corrupt ${k}`);
      }
      ok(`${name}: damaged copies never throw`, !bad, bad);
    }
  }

  // --- tag vocabulary ---
  {
    const n = normalizeTags([['ARTIST', 'A; B'], ['TRACKNUMBER', '03'], ['YEAR', '1987'], ['TOTALTRACKS', '11'], ['SERIES-PART', '1.5'], ['ALBUM_ARTIST', 'X']]);
    eq('normalizeTags aliases', n.tags, { artist: 'A; B', artists: ['A', 'B'], albumArtist: 'X', track: 3, trackTotal: 11, date: '1987', year: 1987, seriesPart: 1.5 });
  }

  // --- LRC ---
  {
    const src = '\ufeff[ar:Singer]\n[ti:Song]\n[offset:+500]\n[00:12.00][01:15.30]Chorus line\n[00:05.5]First\n[00:20.123]<00:20.123>Word <00:21.00>by <00:21.50>word\n[00:30:50]\nnot timed\n';
    const l = parseLrc(src);
    eq('lrc meta', l.meta, { ar: 'Singer', ti: 'Song', offset: 500 });
    eq('lrc lines', l.lines.map((x) => [x.time, x.text]), [[5, 'First'], [11.5, 'Chorus line'], [19.623, 'Word by word'], [30, ''], [74.8, 'Chorus line']]);
    eq('lrc words', l.lines[2].words, [{ time: 19.623, text: 'Word ' }, { time: 20.5, text: 'by ' }, { time: 21, text: 'word' }]);
    eq('lrc round trip', parseLrc(serializeLrc(l)), l);
    eq('lrc not enhanced', serializeLrc(l, { enhanced: false }).includes('<'), false);
    eq('lrc lineAt', [lineAt(l, 0), lineAt(l, 5), lineAt(l, 12), lineAt(l, 100)], [-1, 0, 1, 4]);
    eq('lrc wordAt', [wordAt(l.lines[2], 19), wordAt(l.lines[2], 20.6), wordAt(l.lines[0], 6)], [-1, 1, -1]);
    eq('lrc plain', plainLyrics(l).split('\n')[0], 'First');
    const p = parseLrc('Just text\nsecond line\n\n');
    eq('lrc unsynced', [p.synced, p.lines.length, p.lines[0].time, lineAt(p, 3)], [false, 2, null, -1]);
    eq('isLrc', [isLrc('[00:01.00]a\n[00:02.00]b'), isLrc('hello [world]'), isLrc('[ar:x]\nplain')], [true, false, false]);
    eq('lrc [mm:ss] and [mm:ss.xxx]', parseLrc('[01:02]a\n[01:02.345]b').lines.map((x) => x.time), [62, 62.345]);
  }

  // --- CUE ---
  {
    const src = '\ufeffREM GENRE "Progressive Rock"\r\nREM DATE 1973\r\nREM DISCID 1234ABCD\r\nperformer "Pink Floyd"\r\nTITLE "The Dark Side"\r\nCATALOG 0077774644222\r\n' +
      'FILE "CD 1.flac" WAVE\r\n  TRACK 01 AUDIO\r\n    TITLE "Speak to Me"\r\n    ISRC GBN9Y1100088\r\n    INDEX 01 00:00:00\r\n' +
      '  track 02 audio\r\n    TITLE "Breathe"\r\n    PERFORMER "Roger"\r\n    FLAGS DCP PRE\r\n    INDEX 00 01:05:30\r\n    INDEX 01 01:07:00\r\n' +
      'FILE second.wav WAVE\r\n  TRACK 03 AUDIO\r\n    PREGAP 00:02:00\r\n    REM COMPOSER Waters\r\n    TITLE On the Run\r\n    INDEX 01 00:00:00\r\n';
    const c = parseCue(src);
    eq('cue disc', [c.performer, c.title, c.catalog, c.rem], ['Pink Floyd', 'The Dark Side', '0077774644222', { genre: 'Progressive Rock', date: '1973', discid: '1234ABCD' }]);
    eq('cue files', c.files.map((f) => [f.name, f.type, f.tracks.length]), [['CD 1.flac', 'WAVE', 2], ['second.wav', 'WAVE', 1]]);
    const t2 = c.files[0].tracks[1];
    eq('cue track', [t2.number, t2.title, t2.performer, t2.flags, t2.indexes.length, t2.start], [2, 'Breathe', 'Roger', ['DCP', 'PRE'], 2, 67]);
    eq('cue track 3', [c.files[1].tracks[0].pregap, c.files[1].tracks[0].rem, c.files[1].tracks[0].title], [2, { composer: 'Waters' }, 'On the Run']);
    eq('cueTracks', cueTracks(c, { durations: { 'CD 1.flac': 200 } }).map((t) => [t.file, t.number, t.performer, t.start, t.end]),
      [['CD 1.flac', 1, 'Pink Floyd', 0, 67], ['CD 1.flac', 2, 'Roger', 67, 200], ['second.wav', 3, 'Pink Floyd', 0, null]]);
    eq('cue round trip', parseCue(serializeCue(c)), c);
    eq('msf', [msf(67), msf(65 + 30 / 75), parseMsf('01:05:30'), parseMsf('3:20'), msf(3600)], ['01:07:00', '01:05:30', 65.4, 200, '60:00:00']);
    const b = buildCue({ performer: 'P', title: 'Album', file: 'album.flac', type: 'WAVE', tracks: [{ title: 'One', start: 0 }, { title: 'Two', start: 125.4 }], rem: { date: '2020' } });
    eq('buildCue', cueTracks(parseCue(serializeCue(b)), { durations: { 'album.flac': 300 } }).map((t) => [t.title, t.start, t.end]), [['One', 0, 125.4], ['Two', 125.4, 300]]);
    near('buildCue rounds to CD frames', buildCue({ tracks: [{ start: 10.001 }] }).files[0].tracks[0].start, 10, 1 / 75);
  }

  // --- subtitles ---
  {
    const srt = '\ufeff1\r\n00:00:01,000 --> 00:00:04,500\r\nHello <font color="red">there</font>\r\n<I>world</I>\r\n\r\n00:00:05.000 --> 00:00:06.000 X1:10\r\n{\\an8}Second\r\n3\r\n00:01:00,250 --> 00:01:02,000\r\nThird & last\r\n';
    const s = parseSrt(srt);
    eq('srt cues', s.cues, [{ start: 1, end: 4.5, text: 'Hello there\n<i>world</i>' }, { start: 5, end: 6, text: 'Second' }, { start: 60.25, end: 62, text: 'Third & last' }]);
    eq('srt round trip', parseSrt(toSrt(s.cues)).cues, s.cues);
    const vttOut = toVtt(s.cues);
    ok('toVtt escapes', vttOut.startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:04.500\n') && vttOut.includes('Third &amp; last') && vttOut.includes('<i>world</i>'), vttOut);
    const vtt = 'WEBVTT - title\nKind: captions\n\nNOTE a comment\nspanning lines\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.000 --> 00:02.000 align:start line:0\n<v Bob>Hi &amp; <b>bye</b></v>\n\n00:00:03.000 --> 00:00:04.000\n<c.yellow>Coloured</c> &lt;tag&gt;\n';
    const v = parseVtt(vtt);
    eq('vtt cues', v.cues, [{ start: 1, end: 2, text: 'Hi & <b>bye</b>', id: 'intro', settings: 'align:start line:0', voice: 'Bob' }, { start: 3, end: 4, text: 'Coloured <tag>' }]);
    eq('vtt styles', v.styles, ['::cue { color: red }']);
    eq('vtt round trip', parseVtt(toVtt(v.cues)).cues.map(({ voice, ...c }) => c), v.cues.map(({ voice, ...c }) => c));
    const ass = '[Script Info]\nTitle: Test\nScriptType: v4.00+\nPlayResX: 1920\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour\nStyle: Default,Arial,48,&H00FFFFFF\nStyle: Sign,Arial,30,&H00FFFF00\n\n' +
      '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
      'Dialogue: 0,0:00:05.00,0:00:07.50,Default,Kai,0,0,0,,{\\i1}Hello{\\i0}\\Nworld, with commas\n' +
      'Dialogue: 1,0:00:01.00,0:00:02.00,Sign,,0,0,0,,{\\pos(10,10)\\b1}Bold\\hsign\n' +
      'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}\n' +
      'Comment: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,ignored\n';
    const a = parseAss(ass);
    eq('ass info / styles', [a.format, a.info.Title, a.info.PlayResX, a.styles.map((x) => [x.name, x.fontsize])], ['ass', 'Test', '1920', [['Default', 48], ['Sign', 30]]]);
    eq('ass cues', a.cues, [
      { start: 1, end: 2, text: '<b>Bold sign</b>', style: 'Sign', layer: 1, name: '', effect: '' },
      { start: 5, end: 7.5, text: '<i>Hello</i>\nworld, with commas', style: 'Default', layer: 0, name: 'Kai', effect: '' }]);
    eq('parseSubs by name / sniff', [parseSubs(ass, 'x.ass').format, parseSubs(vtt).format, parseSubs(srt, 'a.srt').format, parseSubs('{1}{1}25\n{25}{50}Line|two\n', 'a.sub').cues],
      ['ass', 'vtt', 'srt', [{ start: 1, end: 2, text: 'Line\ntwo' }]]);
    eq('shiftCues', shiftCues(s.cues, -4.75).map((c) => [c.start, c.end]), [[0.25, 1.25], [55.5, 57.25]]);
  }

  // --- NFO ---
  {
    const movie = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>Fast & Furious</title>
  <originaltitle>Fast &amp; Furious</originaltitle>
  <sorttitle>Fast 4</sorttitle>
  <ratings><rating name="imdb" max="10" default="true"><value>6.5</value><votes>290,000</votes></rating><rating name="tmdb"><value>6.7</value></rating></ratings>
  <userrating>8</userrating>
  <plot>Dom &eacute; back.</plot>
  <runtime>107</runtime>
  <thumb aspect="poster">https://img/poster.jpg</thumb>
  <fanart><thumb>https://img/fanart.jpg</thumb></fanart>
  <mpaa>PG-13</mpaa>
  <uniqueid type="imdb" default="true">tt1013752</uniqueid>
  <uniqueid type="tmdb">13804</uniqueid>
  <genre>Action</genre><genre>Crime</genre>
  <tag>cars</tag>
  <set><name>Fast Collection</name></set>
  <country>USA</country>
  <credits>Chris Morgan</credits>
  <director>Justin Lin</director>
  <premiered>2009-04-03</premiered>
  <year>2009</year>
  <studio>Universal</studio>
  <actor><name>Vin Diesel</name><role>Dom</role><order>0</order><thumb>https://img/vin.jpg</thumb></actor>
  <actor><name>Paul Walker</name><role>Brian</role><order>1</order></actor>
  <watched>true</watched>
  <playcount>2</playcount>
</movie>
https://www.imdb.com/title/tt1013752/
`;
    const p = parseNfo(movie);
    eq('nfo movie', [p.kind, p.url, p.fields.title, p.fields.originaltitle, p.fields.plot, p.fields.runtime, p.fields.year, p.fields.watched, p.fields.set],
      ['movie', 'https://www.imdb.com/title/tt1013752/', 'Fast & Furious', 'Fast & Furious', 'Dom &eacute; back.', 107, 2009, true, 'Fast Collection']);
    eq('nfo lists', [p.fields.genre, p.fields.studio, p.fields.director, p.fields.credits, p.fields.tag], [['Action', 'Crime'], ['Universal'], ['Justin Lin'], ['Chris Morgan'], ['cars']]);
    eq('nfo ids / ratings', [p.fields.uniqueid, p.fields.ratings], [{ imdb: 'tt1013752', default: 'imdb', tmdb: '13804' },
      [{ name: 'imdb', value: 6.5, votes: 290000, max: 10, default: true }, { name: 'tmdb', value: 6.7 }]]);
    eq('nfo actors / art', [p.fields.actor, p.fields.thumb, p.fields.fanart], [[{ name: 'Vin Diesel', role: 'Dom', order: 0, thumb: 'https://img/vin.jpg' },
      { name: 'Paul Walker', role: 'Brian', order: 1 }], [{ url: 'https://img/poster.jpg', aspect: 'poster' }], ['https://img/fanart.jpg']]);
    eq('nfo round trip', parseNfo(serializeNfo('movie', p.fields)).fields, p.fields);
    const multi = '<episodedetails><title>One</title><season>1</season><episode>1</episode><aired>2010-01-01</aired></episodedetails>\n' +
      '<episodedetails><title>Two</title><season>1</season><episode>2</episode></episodedetails>';
    const e = parseNfo(multi);
    eq('nfo multi-episode', [e.kind, e.fields.title, e.episodes.map((x) => [x.title, x.season, x.episode])], ['episodedetails', 'One', [['One', 1, 1], ['Two', 1, 2]]]);
    eq('nfo multi round trip', parseNfo(serializeNfo('episodedetails', e.episodes)).episodes, e.episodes);
    const tv = parseNfo('<tvshow><title>Show</title><id>12345</id><rating>8.1</rating><votes>100</votes><thumb aspect="banner">b.jpg</thumb><thumb aspect="poster" type="season" season="1">s1.jpg</thumb></tvshow>');
    eq('nfo tvshow legacy fields', [tv.kind, tv.fields.uniqueid, tv.fields.ratings, tv.fields.thumb[1]], ['tvshow', { unknown: '12345' }, [{ name: 'default', value: 8.1, votes: 100 }],
      { url: 's1.jpg', aspect: 'poster', season: '1', type: 'season' }]);
    eq('nfo malformed', [parseNfo('<movie><title>x</movie>'), parseNfo('http://www.imdb.com/title/tt0111161/'), parseNfo('')],
      [{ kind: null, fields: {} }, { kind: null, fields: {}, url: 'http://www.imdb.com/title/tt0111161/' }, { kind: null, fields: {} }]);
    const album = parseNfo('<album><title>Abbey Road</title><artist>The Beatles</artist><genre>Rock</genre><label>Apple</label><year>1969</year><releasedate>1969-09-26</releasedate></album>');
    eq('nfo album', album.fields, { title: 'Abbey Road', releasedate: '1969-09-26', label: 'Apple', year: 1969, genre: ['Rock'], artist: ['The Beatles'] });
    ok('serializeNfo declaration', serializeNfo('album', album.fields).startsWith('<?xml version="1.0" encoding="UTF-8"'));
  }

  // --- playlists ---
  {
    const m3u = '#EXTM3U url-tvg="http://x/epg.xml"\n#PLAYLIST:My List\n#EXTINF:123 tvg-logo="http://x/l.png" group-title="News, World",Artist One - Song One\n#EXTALB:Album One\n#EXTIMG:cover.jpg\nMusic\\Artist One\\01.mp3\n' +
      '#EXTINF:-1,Stream\nhttp://radio.example/stream?x=1\n# a comment\nrelative/02.flac\n';
    const p = parseM3u(m3u, { base: 'C:/Lists' });
    eq('m3u header', [p.header, p.title, p.attrs], [true, 'My List', { 'url-tvg': 'http://x/epg.xml' }]);
    eq('m3u entries', p.entries.map((e) => [e.path || e.url, e.title, e.artist, e.duration]), [['Music/Artist One/01.mp3', 'Song One', 'Artist One', 123],
      ['http://radio.example/stream?x=1', 'Stream', null, null], ['relative/02.flac', null, null, null]]);
    eq('m3u attrs / extra / resolved', [p.entries[0].attrs, p.entries[0].extra, p.entries[0].resolved, p.entries[1].url, p.entries[2].resolved],
      [{ 'tvg-logo': 'http://x/l.png', 'group-title': 'News, World' }, { album: 'Album One', image: 'cover.jpg' }, 'C:/Lists/Music/Artist One/01.mp3',
        'http://radio.example/stream?x=1', 'C:/Lists/relative/02.flac']);
    const back = parseM3u(writeM3u(p), { base: 'C:/Lists' });
    eq('m3u round trip', back.entries, p.entries);
    eq('m3u plain', writeM3u({ entries: p.entries }, { extended: false }), 'Music/Artist One/01.mp3\nhttp://radio.example/stream?x=1\nrelative/02.flac\n');
    const pls = parsePls('[playlist]\nFile1=a.mp3\nTitle1=A\nLength1=60\nFile2=http://s/2\nLength2=-1\nNumberOfEntries=2\nVersion=2\n');
    eq('pls', pls.entries, [{ title: 'A', duration: 60, path: 'a.mp3' }, { title: null, duration: null, url: 'http://s/2' }]);
    eq('pls round trip', parsePls(writePls(pls)).entries, pls.entries);
    const xspf = writeXspf({ title: 'X & Y', creator: 'Me', entries: [{ location: 'file:///music/a%20b.mp3', title: 'A', creator: 'Art', album: 'Alb', trackNum: 1, duration: 61.5, image: 'c.jpg', meta: { 'http://x/rating': '5' } },
      { locations: ['http://h/1.ogg', 'http://h/2.ogg'], title: 'B', identifier: 'urn:x' }] });
    const x = parseXspf(xspf);
    eq('xspf', [x.title, x.creator, x.entries.length, x.entries[0].location, x.entries[0].duration, x.entries[0].trackNum, x.entries[0].meta, x.entries[1].locations, x.entries[1].identifier],
      ['X & Y', 'Me', 2, 'file:///music/a%20b.mp3', 61.5, 1, { 'http://x/rating': '5' }, ['http://h/1.ogg', 'http://h/2.ogg'], 'urn:x']);
    eq('xspf round trip', parseXspf(writeXspf(x)).entries, x.entries);
    eq('xspf malformed', parseXspf('<playlist>').entries, []);
  }

  // --- names ---
  {
    const cases = [
      ['Show.Name.S01E02.1080p.WEB-DL.x264-GROUP.mkv', {}, { kind: 'episode', show: 'Show Name', season: 1, episode: 2, resolution: '1080p', source: 'WEB-DL', vcodec: 'x264', group: 'GROUP', ext: 'mkv' }],
      ['Show Name - S01E02E03 - Title.mkv', {}, { kind: 'episode', show: 'Show Name', season: 1, episode: 2, episodeEnd: 3, title: 'Title' }],
      ['Show.Name.1x02.avi', {}, { kind: 'episode', show: 'Show Name', season: 1, episode: 2, ext: 'avi' }],
      ['Show (2005) - s02e10.mkv', {}, { show: 'Show', year: 2005, season: 2, episode: 10 }],
      ['Show.2024.03.15.mkv', {}, { kind: 'episode', show: 'Show', date: '2024-03-15', year: 2024 }],
      ['[Group] Title - 05 [1080p][ABCD1234].mkv', {}, { kind: 'episode', group: 'Group', show: 'Title', episode: 5, absolute: 5, resolution: '1080p', crc: 'ABCD1234' }],
      ['[Group] Title S2 - 05v2 (BD 1080p HEVC FLAC) [ABCD1234].mkv', {}, { show: 'Title', season: 2, episode: 5, version: 2, source: 'BD', resolution: '1080p', vcodec: 'hevc', acodec: 'flac', crc: 'ABCD1234', absolute: undefined }],
      ['[Group] Title - 12.5 [1080p].mkv', {}, { kind: 'episode', show: 'Title', episode: 12.5, special: true }],
      ['[Group] Title - NCOP1 [1080p].mkv', {}, { kind: 'extra', extra: 'ncop', index: 1, show: 'Title' }],
      ['[Group] Title - ED2 [1080p].mkv', {}, { kind: 'extra', extra: 'ed', index: 2 }],
      ['[Group] Title OVA - 02 [720p].mkv', {}, { kind: 'episode', show: 'Title', special: true, episode: 2, absolute: undefined }],
      ['[Group] Title (2013) - 03 (1080p).mkv', {}, { show: 'Title', year: 2013, episode: 3, resolution: '1080p' }],
      ['Title - 1001 [1080p].mkv', {}, { kind: 'episode', show: 'Title', episode: 1001, absolute: 1001, resolution: '1080p' }],
      ['[Group] 進撃の巨人 - 05 [1080p].mkv', {}, { show: '進撃の巨人', episode: 5 }],
      ['Сериал.S01E03.1080p.mkv', {}, { show: 'Сериал', season: 1, episode: 3 }],
      ['Мастер и Маргарита (2024).mkv', {}, { kind: 'movie', title: 'Мастер и Маргарита', year: 2024 }],
      ['Movie Name (1999) [1080p].mkv', {}, { kind: 'movie', title: 'Movie Name', year: 1999, resolution: '1080p' }],
      ['Movie.Name.1999.Directors.Cut.2160p.UHD.BluRay.x265-GRP.mkv', {}, { kind: 'movie', title: 'Movie Name', year: 1999, edition: "Director's Cut", resolution: '2160p', source: 'BluRay', vcodec: 'x265', group: 'GRP' }],
      ['Blade.Runner.2049.2017.1080p.BluRay.x264.DTS-HD.MA.5.1-GRP.mkv', {}, { title: 'Blade Runner 2049', year: 2017, acodec: 'dts-hd ma', channels: '5.1', group: 'GRP' }],
      ['2001.A.Space.Odyssey.1968.720p.mkv', {}, { title: '2001 A Space Odyssey', year: 1968, resolution: '720p' }],
      ['The.Matrix.1999.REMASTERED.1080p.BluRay.x264-GRP.mkv', {}, { title: 'The Matrix', year: 1999, edition: 'Remastered' }],
      ['Movie.Name.2010.HDR.2160p.WEB-DL.DDP5.1.Atmos.H.265-GRP.mkv', {}, { title: 'Movie Name', year: 2010, hdr: 'HDR', acodec: 'eac3', channels: '5.1', vcodec: 'hevc', source: 'WEB-DL' }],
      ['Movie.Name.2015.Trailer.mkv', {}, { kind: 'extra', extra: 'trailer', title: 'Movie Name', year: 2015 }],
      ['01 - Artist - Title.mp3', {}, { kind: 'track', track: 1, artist: 'Artist', title: 'Title', ext: 'mp3' }],
      ['01. Title.flac', {}, { kind: 'track', track: 1, title: 'Title' }],
      ['1-03 Title.m4a', {}, { kind: 'track', disc: 1, track: 3, title: 'Title' }],
      ['Artist - Album - 03 - Title.ogg', {}, { kind: 'track', artist: 'Artist', album: 'Album', track: 3, title: 'Title' }],
      ['05 Song Name.flac', {}, { track: 5, title: 'Song Name' }],
      ['Artist - Song.mp3', {}, { artist: 'Artist', title: 'Song' }],
      ['Track 07.mp3', {}, { track: 7 }],
      ['Artist - 02 - Song.mp3', {}, { artist: 'Artist', track: 2, title: 'Song' }],
      ['Chapter 01 - The Beginning.mp3', { hint: 'audiobook' }, { kind: 'chapter', chapter: 1, title: 'The Beginning' }],
      ['Part 1 of 12.mp3', { hint: 'audiobook' }, { kind: 'chapter', part: 1, partTotal: 12 }],
      ['001_Book_Title.mp3', { hint: 'audiobook' }, { kind: 'chapter', track: 1, title: 'Book Title' }],
      ['Book Title - 03.m4b', {}, { kind: 'chapter', album: 'Book Title', track: 3, ext: 'm4b' }],
      ['Anime/Title/Season 2/05.mkv', {}, { kind: 'episode', show: 'Title', season: 2, episode: 5, absolute: undefined }],
      ['Music/Artist/1999 - Album/01 Title.flac', {}, { kind: 'track', artist: 'Artist', album: 'Album', year: 1999, track: 1, title: 'Title' }],
      ['Audiobooks/Author/Series 03 - Book/01.mp3', {}, { kind: 'chapter', author: 'Author', series: 'Series', seriesPart: 3, album: 'Book', track: 1 }],
      ['TV Shows/Show Name (2010)/Season 01/Show Name - S01E05 - Episode Title.mkv', {}, { show: 'Show Name', season: 1, episode: 5, title: 'Episode Title' }],
      ['Movies/Inception (2010)/movie.mkv', {}, { kind: 'movie', title: 'Inception', year: 2010 }],
      ['Show/Specials/Show - S00E01.mkv', {}, { season: 0, episode: 1 }],
      ['Music/Artist/Album (2005)/CD2/04 - Song.mp3', {}, { disc: 2, album: 'Album', year: 2005, artist: 'Artist', track: 4, title: 'Song' }],
      ['Some.Show.S03E04.720p.HDTV.x264-GRP[rarbg].mkv', {}, { show: 'Some Show', season: 3, episode: 4, source: 'HDTV', group: 'GRP' }],
      ['show.name.s01e01-e03.mkv', {}, { show: 'show name', episode: 1, episodeEnd: 3 }],
      ['Show Name - 1x05 - The Title.avi', {}, { show: 'Show Name', season: 1, episode: 5, title: 'The Title' }],
      ['[SubsPlease] Frieren - 12 (1080p) [5A9D6E3B].mkv', {}, { group: 'SubsPlease', show: 'Frieren', episode: 12, resolution: '1080p', crc: '5A9D6E3B' }],
      ['[Group] Title 2nd Season - 03 [720p].mkv', {}, { show: 'Title', season: 2, episode: 3 }],
      ['Show.Name.S01E02.Episode.Title.720p.mkv', {}, { show: 'Show Name', title: 'Episode Title' }],
      ['07.mkv', { hint: 'series' }, { kind: 'episode', episode: 7 }],
      ['Show.Name.S02E03.REPACK.1080p.AMZN.WEB-DL.DDP5.1.H.264-GRP.mkv', {}, { season: 2, episode: 3, repack: true, acodec: 'eac3', vcodec: 'h264' }],
      ['[Group] Title - 07 [1080p 10bit].mkv', {}, { episode: 7, bitDepth: 10 }],
      ['Spider-Man - Into the Spider-Verse (2018).mkv', {}, { kind: 'movie', title: 'Spider-Man - Into the Spider-Verse', year: 2018 }],
      ['Show - 01 - Pilot.mkv', {}, { kind: 'episode', show: 'Show', episode: 1, title: 'Pilot' }],
      ['Re Zero - Starting Life - 05 [1080p].mkv', {}, { kind: 'episode', show: 'Re Zero - Starting Life', episode: 5 }],
      ['Friends.S01E01.The.One.Where.Monica.Gets.a.Roommate.DVDRip.XviD-GRP.avi', {}, { show: 'Friends', title: 'The One Where Monica Gets a Roommate', source: 'DVDRip', vcodec: 'xvid', group: 'GRP' }],
      ['[Judas] Shingeki no Kyojin - S04E28 [1080p][HEVC x265 10bit][Multi-Subs].mkv', {}, { group: 'Judas', show: 'Shingeki no Kyojin', season: 4, episode: 28, bitDepth: 10 }],
      ['Audiobooks/Terry Pratchett/Discworld/Guards! Guards!/Part 03.mp3', {}, { kind: 'chapter', part: 3, album: 'Guards! Guards!', series: 'Discworld', author: 'Terry Pratchett' }],
    ];
    for (const [input, opts, want] of cases) subset(`parseName ${input}`, parseName(input, opts), want);
    ok('names: 40+ cases', cases.length >= 40, cases.length);
    ok('parseName confidence', parseName('Show.S01E01.mkv').confidence > parseName('whatever.mkv').confidence);
    eq('normTitle', [normTitle('Amélie & the Café!'), normTitle('  The   Office (US) '), normTitle('Ёжик в тумане')], ['amelie and the cafe', 'the office us', 'ежик в тумане']);
    eq('sortTitle', [sortTitle('The Beatles'), sortTitle('A Tribe Called Quest'), sortTitle('Le Petit Prince', 'fr'), sortTitle("L'Amour", 'fr'), sortTitle('Die Ärzte', 'de'), sortTitle('Theater')],
      ['Beatles, The', 'Tribe Called Quest, A', 'Petit Prince, Le', "Amour, L'", 'Ärzte, Die', 'Theater']);
    eq('cleanTitle', [cleanTitle('Show.Name_2'), cleanTitle('Mr. Robot'), cleanTitle('  a  -  ')], ['Show Name 2', 'Mr. Robot', 'a']);
  }

  // --- templates ---
  {
    const t1 = compileTemplate('{artist}/{year} - {album}/{track:02} {title}.{ext}');
    eq('template fields', t1.fields, ['artist', 'year', 'album', 'track', 'title', 'ext']);
    eq('template music match', t1.match('Music/Pink Floyd/1973 - The Dark Side of the Moon/03 Time.flac'), { artist: 'Pink Floyd', year: 1973, album: 'The Dark Side of the Moon', track: 3, title: 'Time', ext: 'flac' });
    eq('template music format', t1.format({ artist: 'AC/DC', year: 1980, album: 'Back in Black', track: 1, title: 'Hells Bells?', ext: 'mp3' }), 'AC-DC/1980 - Back in Black/01 Hells Bells_.mp3');
    eq('template no match', t1.match('Pink Floyd/The Dark Side/03 Time.flac'), null);
    const t2 = compileTemplate('Anime/{title}/S{season:02}E{episode:02}.{ext}');
    eq('template anime', [t2.match('Media/Anime/Frieren/S01E05.mkv'), t2.match('Other/Frieren/S01E05.mkv'), t2.format({ title: 'Frieren', season: 1, episode: 5, ext: 'mkv' })],
      [{ title: 'Frieren', season: 1, episode: 5, ext: 'mkv' }, null, 'Anime/Frieren/S01E05.mkv']);
    const t3 = compileTemplate('{show}/Season {season}/{show} - S{season:02}E{episode:02} - {title}.{ext}');
    eq('template tv', [t3.match('TV/Lost/Season 1/Lost - S01E02 - Pilot (2).mkv'), t3.match('Lost/Season 2/Lost - S01E02 - x.mkv'), t3.match('Lost/Season 1/Other - S01E02 - x.mkv'), t3.match('lost/season 1/Lost - s01e02 - x.mkv')],
      [{ show: 'Lost', season: 1, episode: 2, title: 'Pilot (2)', ext: 'mkv' }, null, null, { show: 'lost', season: 1, episode: 2, title: 'x', ext: 'mkv' }]);
    eq('template tv format', t3.format({ show: 'Lost', season: 1, episode: 2, title: 'Pilot', ext: 'mkv' }), 'Lost/Season 1/Lost - S01E02 - Pilot.mkv');
    const t4 = compileTemplate('{author}/{series} {seriesPart} - {album}/{chapter} {title}.{ext}');
    eq('template audiobook', t4.match('Books/Brandon Sanderson/The Stormlight Archive 2 - Words of Radiance/03 Chapter Three.mp3'),
      { author: 'Brandon Sanderson', series: 'The Stormlight Archive', seriesPart: 2, album: 'Words of Radiance', chapter: 3, title: 'Chapter Three', ext: 'mp3' });
    const t5 = compileTemplate('**/{artist} - {title}.{ext}');
    eq('template globstar', [t5.match('a/b/c/Queen - Bohemian Rhapsody.mp3'), t5.match('Queen - X.mp3'), t5.match('NoDash.mp3')],
      [{ artist: 'Queen', title: 'Bohemian Rhapsody', ext: 'mp3' }, { artist: 'Queen', title: 'X', ext: 'mp3' }, null]);
    const t6 = compileTemplate('{artist}/{album}/{track:02?} - {title}.{ext}');
    eq('template optional', [t6.match('A/B/03 - T.mp3'), t6.match('A/B/T.mp3'), t6.format({ artist: 'A', album: 'B', title: 'T', ext: 'mp3' }), t6.format({ artist: 'A', album: 'B', track: 4, title: 'T', ext: 'mp3' })],
      [{ artist: 'A', album: 'B', track: 3, title: 'T', ext: 'mp3' }, { artist: 'A', album: 'B', title: 'T', ext: 'mp3' }, 'A/B/T.mp3', 'A/B/04 - T.mp3']);
    const t7 = compileTemplate('/{artist}/{title}.{ext}');
    eq('template anchored', [t7.match('A/T.mp3'), t7.match('X/A/T.mp3')], [{ artist: 'A', title: 'T', ext: 'mp3' }, null]);
    eq('template braces / star / ignore', [compileTemplate('{{x}}/{title}.{ext}').match('{x}/T.mp3'), compileTemplate('{artist}/*/{_} {title}.{ext}').match('A/whatever/01 T.mp3')],
      [{ title: 'T', ext: 'mp3' }, { artist: 'A', title: 'T', ext: 'mp3' }]);
    let threw = false;
    try { t1.format({ artist: 'A' }); } catch { threw = true; }
    ok('template missing field throws', threw);
  }

  // --- sidecars ---
  {
    const files = [
      'Movies/Movie (2010)/Movie (2010).mkv', 'Movies/Movie (2010)/Movie (2010).srt', 'Movies/Movie (2010)/Movie (2010).en.srt',
      'Movies/Movie (2010)/Movie (2010).en.forced.srt', 'Movies/Movie (2010)/Movie (2010).eng.sdh.srt', 'Movies/Movie (2010)/Movie (2010).nfo',
      'Movies/Movie (2010)/Movie (2010)-poster.jpg', 'Movies/Movie (2010)/Movie (2010)-fanart.jpg', 'Movies/Movie (2010)/fanart.jpg',
      'Movies/Movie (2010)/Subs/2_English.srt', 'Movies/Movie (2010)/Movie (2010).Part2.mkv', 'Movies/Movie (2010)/Movie (2010).Part2.ru.srt',
      'Shows/Show/tvshow.nfo', 'Shows/Show/poster.jpg', 'Shows/Show/banner.jpg', 'Shows/Show/season01-poster.jpg', 'Shows/Show/season-specials-poster.jpg',
      'Shows/Show/clearlogo.png', 'Shows/Show/Season 1/Show - S01E01.mkv', 'Shows/Show/Season 1/Show - S01E01.ja.ass', 'Shows/Show/Season 1/Show - S01E01.nfo',
      'Shows/Show/Season 1/Show - S01E01-thumb.jpg', 'Shows/Show/Season 1/Show - S01E02.mkv', 'Shows/Show/Season 1/Subs/Show - S01E02/3_Russian.srt',
      'Music\\Artist\\Album\\01 Song.flac', 'Music/Artist/Album/01 Song.lrc', 'Music/Artist/Album/02 Other.flac', 'Music/Artist/Album/folder.jpg',
      'Music/Artist/Album/cover.jpg', 'Music/Artist/Album/Album.cue', 'Music/Artist/Album/album.nfo', 'Music/Artist/Album/back.jpg',
      'Music/A2/Album2/01.mp3', 'Music/A2/Album2/Scans/Front.jpg', 'Music/A2/Album2/Scans/Back.jpg',
    ];
    const { media, folders } = groupSidecars(files);
    const mv = media.get('Movies/Movie (2010)/Movie (2010).mkv');
    eq('sidecar movie subs', mv.subs.map((s) => [s.path.split('/').pop(), s.lang, s.forced, s.sdh]), [
      ['Movie (2010).srt', null, false, false], ['Movie (2010).en.srt', 'en', false, false], ['Movie (2010).en.forced.srt', 'en', true, false],
      ['Movie (2010).eng.sdh.srt', 'en', false, true]]);
    eq('sidecar movie files', [mv.nfo, mv.cover, mv.art.fanart], ['Movies/Movie (2010)/Movie (2010).nfo', 'Movies/Movie (2010)/Movie (2010)-poster.jpg', 'Movies/Movie (2010)/Movie (2010)-fanart.jpg']);
    eq('sidecar longest stem', media.get('Movies/Movie (2010)/Movie (2010).Part2.mkv').subs.map((s) => s.lang), ['ru']);
    eq('sidecar Subs/ folder', media.get('Movies/Movie (2010)/Movie (2010).mkv').subs.length, 4);
    eq('sidecar folder fanart', folders.get('Movies/Movie (2010)').fanart, 'Movies/Movie (2010)/fanart.jpg');
    const show = folders.get('Shows/Show');
    eq('sidecar show folder', [show.nfo.tvshow, show.cover, show.banner, show.logo, show.posters], ['Shows/Show/tvshow.nfo', 'Shows/Show/poster.jpg', 'Shows/Show/banner.jpg', 'Shows/Show/clearlogo.png',
      { 0: 'Shows/Show/season-specials-poster.jpg', 1: 'Shows/Show/season01-poster.jpg' }]);
    const ep = media.get('Shows/Show/Season 1/Show - S01E01.mkv');
    eq('sidecar episode', [ep.subs.map((s) => s.lang), ep.nfo, ep.art.thumb], [['ja'], 'Shows/Show/Season 1/Show - S01E01.nfo', 'Shows/Show/Season 1/Show - S01E01-thumb.jpg']);
    eq('sidecar Subs/<stem>/', media.get('Shows/Show/Season 1/Show - S01E02.mkv').subs.map((s) => [s.lang, s.path]), [['ru', 'Shows/Show/Season 1/Subs/Show - S01E02/3_Russian.srt']]);
    const al = folders.get('Music/Artist/Album');
    eq('sidecar album folder', [al.cover, al.cue, al.nfo.album, al.extras.sort()], ['Music/Artist/Album/cover.jpg', ['Music/Artist/Album/Album.cue'], 'Music/Artist/Album/album.nfo',
      ['Music/Artist/Album/back.jpg', 'Music/Artist/Album/folder.jpg']]);
    eq('sidecar lyrics', media.get('Music/Artist/Album/01 Song.flac').lyrics, 'Music/Artist/Album/01 Song.lrc');
    eq('sidecar scans cover', folders.get('Music/A2/Album2').cover, 'Music/A2/Album2/Scans/Front.jpg');
    eq('langCode', ['en', 'eng', 'English', 'en-US', 'pt_BR', 'jpn', 'japanese', 'русский', 'ger', 'chi', 'xx', 'zzz'].map(langCode), ['en', 'en', 'en', 'en', 'pt', 'ja', 'ja', 'ru', 'de', 'zh', null, null]);
    eq('cover names', [COVER_NAMES[0], isCoverName('Folder.JPG'), isCoverName('AlbumArt_{X}_Large.jpg'), isCoverName('cover.txt'), isCoverName('track.jpg')], ['cover', true, true, false, false]);
  }

  console.log(`mediatags: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
