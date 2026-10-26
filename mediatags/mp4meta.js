// mediatags/mp4meta.js - ISO BMFF (MP4 / M4A / M4B / MOV) metadata from a random-access source: a walk over the
// top-level box headers to `moov` wherever it is (only moov is read, bounded), tracks through mp4/demux.js, every
// iTunes ilst item (freeform '----' items included), Nero `chpl` chapters, QuickTime chapter text tracks (tref/chap;
// the chapter samples are read one by one from mdat), duration of fragmented files (mehd, sidx).
//
//   mp4Flow(size, { cover = true, maxMoov = 64 MB }) -> reader flow (source.js) giving the raw result read.js
//     assembles: { container, brand, duration, audio, video, streams, pairs, pictures, pictureCount, chapters,
//     warnings, mime }
//   parseIlst(bytes, ilstBox, { cover = true }) -> { pairs: [[KEY, value]], pictures, pictureCount }   (box from
//     mp4/box.js readBoxes)
//   parseChpl(bytes, chplBox) -> [{ start (s), title }]
//   mp4Codec(track) -> short codec id (h264 hevc av1 vp9 vp8 mpeg4 mjpeg prores aac mp3 opus flac alac ac3 eac3 pcm
//     mov_text vtt ...)

//
// Strategy: an MP4 is a sequence of top-level boxes [u32 size][fourcc] (size 1 = 64-bit size follows, 0 = to EOF).
// Everything metadata lives in moov, which may sit before mdat (faststart) or after gigabytes of it. Walking only the
// 16-byte headers finds moov in O(number of top-level boxes) reads without touching mdat. moov is then read whole
// (bounded by maxMoov) and parsed in memory, because its internals are a dense tree of small boxes where per-box
// reads would cost thousands of round trips.
import { findAll, findBox, readBoxes } from '../mp4/box.js';
import { parseMp4 } from '../mp4/demux.js';
import { GENRE_NAMES, imageMime } from './id3frames.js';
import { vocabKey } from './fields.js';

const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const u32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const u64 = (b, p) => u32(b, p) * 4294967296 + u32(b, p + 4);
// ilst 'data' type flags: 0 = implicit/binary, 1 = UTF-8, 2 = UTF-16BE, 13 = JPEG, 14 = PNG, 21 = signed BE int,
// 22 = unsigned BE int, 27 = BMP. Text is decoded by the flag, not guessed.
const utf8 = new TextDecoder();

function utf16be(b) {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
}

// Accumulated in a double (not with <<), so 5..8-byte values do not overflow 32-bit bitwise arithmetic; exact up to 2^53.
// Big-endian integer of 1..8 bytes, signed when `signed`.
function intOf(b, signed) {
  if (!b.length || b.length > 8) return null;
  let v = 0;
  for (const x of b) v = v * 256 + x;
  if (signed && b[0] & 0x80) v -= 2 ** (8 * b.length);
  return v;
}

// iTunes atom names -> vocabulary keys. '©' is the (c) byte 0xA9 that prefixes Apple's original text atoms; it is
// spelled as an escape so the source stays ASCII and matches fourcc(), which maps bytes 1:1 to char codes.
const ILST = {
  '\xa9nam': 'TITLE', '\xa9ART': 'ARTIST', aART: 'ALBUMARTIST', '\xa9alb': 'ALBUM', '\xa9day': 'DATE', '\xa9gen': 'GENRE',
  '\xa9wrt': 'COMPOSER', '\xa9cmt': 'COMMENT', '\xa9lyr': 'LYRICS', '\xa9grp': 'GROUPING', '\xa9nrt': 'NARRATOR', '\xa9pub': 'PUBLISHER',
  '\xa9too': 'ENCODER', cprt: 'COPYRIGHT', desc: 'DESCRIPTION', ldes: 'LONGDESCRIPTION', tvsh: 'SHOW', tvnn: 'NETWORK', tven: 'EPISODEID',
  '\xa9mvn': 'MOVEMENTNAME', '\xa9wrk': 'WORK', '\xa9con': 'CONDUCTOR', '\xa9dir': 'DIRECTOR', keyw: 'KEYWORDS', catg: 'CATEGORY',
  '\xa9lbl': 'LABEL', '\xa9aut': 'AUTHOR', '\xa9st3': 'SUBTITLE', soal: 'ALBUMSORT', soar: 'ARTISTSORT', sonm: 'TITLESORT',
  soaa: 'ALBUMARTISTSORT', soco: 'COMPOSERSORT', sosn: 'SHOWSORT',
};
// Integer atoms. trkn / disk / gnre have their own layouts and are handled in the switch.
// Freeform '----' items written by iTunes / encoders that hold machine data (loudness, gapless info) are skipped.
const INTS = { tmpo: 'BPM', cpil: 'COMPILATION', tvsn: 'SEASON', tves: 'EPISODE', stik: '_MEDIAKIND', '\xa9mvi': 'MOVEMENT', '\xa9mvc': 'MOVEMENTTOTAL', pgap: '_GAPLESS' };
const SKIP_FREEFORM = /^(itunnorm|itunsmpb|itunmovi|itunpgap|itunes_cddb_\w+|encoding params|tool)$/i;

/** iTunes metadata items of an ilst box (see the header). */
export function parseIlst(b, ilst, { cover = true } = {}) {
  const pairs = [], pictures = [];
  let pictureCount = 0;
  for (const item of ilst?.children || []) {
    const kids = item.children || [];
    const datas = kids.filter((x) => x.type === 'data');
    // Freeform item: mean ('com.apple.iTunes') + name + data; the name is the key (MusicBrainz, REPLAYGAIN_*), so these
    // map exactly like Vorbis comments. name has a 4-byte version/flags prefix.
    let freeform = null;
    if (item.type === '----') {
      const name = kids.find((x) => x.type === 'name');
      if (!name) continue;
      freeform = utf8.decode(b.subarray(name.start + 4, name.end));
      if (SKIP_FREEFORM.test(freeform)) continue;
    }
    // An item may hold several data boxes (several covers, multi-value text); each data box is [u32 type flag (low 24
    // bits)][u32 locale] + value.
    for (const d of datas) {
      if (d.end - d.start < 8) continue;
      const flag = u32(b, d.start) & 0xffffff;
      const v = b.subarray(d.start + 8, d.end);
      const text = () => (flag === 2 ? utf16be(v) : utf8.decode(v)).replace(/\u0000+$/, '');
      if (freeform != null) { if (flag === 0 || flag === 1 || flag === 2) pairs.push([vocabKey(freeform), text()]); continue; }
      switch (item.type) {
        case 'covr':
          pictureCount++;
          if (cover) pictures.push({ mime: flag === 14 ? 'image/png' : flag === 27 ? 'image/bmp' : flag === 13 ? 'image/jpeg' : imageMime(v) || 'image/jpeg', type: 3, description: '', data: v });
          break;
        // trkn / disk: 2 reserved bytes, u16 number, u16 total (disk may omit the trailing reserved bytes).
        case 'trkn': case 'disk': {
          if (v.length < 4) break;
          const n = u16(v, 2), total = v.length >= 6 ? u16(v, 4) : 0;
          if (n || total) pairs.push([item.type === 'trkn' ? 'TRACKNUMBER' : 'DISCNUMBER', total ? `${n}/${total}` : String(n)]);
          break;
        }
        // gnre stores ID3v1 genre index + 1 (0 = none), hence g - 1.
        case 'gnre': { const g = intOf(v, false); if (g && GENRE_NAMES[g - 1]) pairs.push(['GENRE', GENRE_NAMES[g - 1]]); break; }
        default:
          if (INTS[item.type]) { const n = intOf(v, flag === 21); if (n != null) pairs.push([INTS[item.type], String(n)]); }
          else if (ILST[item.type] && (flag === 1 || flag === 2 || flag === 0)) pairs.push([ILST[item.type], text()]);
      }
    }
  }
  return { pairs, pictures, pictureCount };
}

// chpl: full box (version, flags), v1 adds 4 reserved bytes, u8 count, then [u64 start in 100 ns units, u8 length,
// UTF-8 title]. Bounded by box.end. box.start is the payload start (mp4/box.js convention).
/** Nero chapters (moov/udta/chpl): [{ start, title }]. */
export function parseChpl(b, box) {
  const out = [];
  let p = box.start;
  const v = b[p];
  p += 4;
  if (v === 1) p += 4;
  const n = b[p++];
  for (let i = 0; i < n && p + 9 <= box.end; i++) {
    const start = u64(b, p) / 1e7;
    const len = b[p + 8];
    const title = utf8.decode(b.subarray(p + 9, Math.min(box.end, p + 9 + len)));
    out.push({ start, title });
    p += 9 + len;
  }
  return out;
}

// QuickTime / ISO sample entry fourccs for uncompressed audio (endianness and width variants all map to 'pcm').
const PCM = new Set(['ipcm', 'fpcm', 'sowt', 'twos', 'lpcm', 'in24', 'in32', 'fl32', 'fl64', 'raw ', 'NONE']);

// Sample-entry fourcc decides; for 'mp4a' the object type in the codec string distinguishes AAC from MP3 in MP4
// (0x6B MPEG-1 audio, 0x69 MPEG-2 audio). Unknown fourccs pass through lowercased rather than becoming null.
export function mp4Codec(t) {
  const f = t.fourcc || '', c = String(t.codec || '').toLowerCase();
  if (/^avc[13]$/.test(f)) return 'h264';
  if (/^(hvc1|hev1|dvh1|dvhe)$/.test(f)) return 'hevc';
  if (f === 'av01') return 'av1';
  if (f === 'vp09') return 'vp9';
  if (f === 'vp08') return 'vp8';
  if (f === 'mp4v') return 'mpeg4';
  if (/^(jpeg|mjpa|mjpb)$/.test(f)) return 'mjpeg';
  if (/^ap(cn|ch|cs|co|4h)$/.test(f)) return 'prores';
  if (f === 's263') return 'h263';
  if (f === 'mp4a') return c === 'mp4a.6b' || c === 'mp4a.69' ? 'mp3' : 'aac';
  if (f === 'Opus') return 'opus';
  if (f === 'fLaC') return 'flac';
  if (f === 'alac') return 'alac';
  if (f === 'ac-3') return 'ac3';
  if (f === 'ec-3') return 'eac3';
  if (f === '.mp3') return 'mp3';
  if (f === 'samr') return 'amr';
  if (f === 'ulaw' || f === 'alaw') return f;
  if (PCM.has(f)) return 'pcm';
  if (f === 'tx3g' || f === 'text') return 'mov_text';
  if (f === 'wvtt') return 'vtt';
  if (f === 'stpp') return 'ttml';
  if (f === 'c608') return 'eia608';
  return f.trim().toLowerCase() || null;
}

// Rebuilds sample positions from the sample table: stsz (sizes, or one fixed size), stco / co64 (chunk offsets),
// stsc (runs of chunks with N samples each, 1-based chunk numbers), stts (run-length sample durations). Chunks are
// contiguous, so a sample offset is its chunk offset plus the sizes of earlier samples in the chunk. Capped at
// `max` entries per table so a hostile table cannot allocate millions of objects.
// Samples of a track's sample table: [{ offset, size, time (timescale units) }].
function samplesOf(b, stbl, max = 10000) {
  const get = (k) => findBox(stbl.children, k);
  const stsz = get('stsz'), stco = get('stco'), co64 = get('co64'), stsc = get('stsc'), stts = get('stts');
  if (!stsz || !(stco || co64) || !stsc) return [];
  const fixed = u32(b, stsz.start + 4), n = Math.min(max, u32(b, stsz.start + 8));
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(fixed || u32(b, stsz.start + 12 + i * 4));
  const offs = [];
  if (stco) { const c = u32(b, stco.start + 4); for (let i = 0; i < c && i < max; i++) offs.push(u32(b, stco.start + 8 + i * 4)); }
  else { const c = u32(b, co64.start + 4); for (let i = 0; i < c && i < max; i++) offs.push(u64(b, co64.start + 8 + i * 8)); }
  const sc = [];
  const ce = u32(b, stsc.start + 4);
  for (let i = 0; i < ce && i < max; i++) { const o = stsc.start + 8 + i * 12; sc.push([u32(b, o), u32(b, o + 4)]); }
  const out = [];
  let s = 0;
  for (let e = 0; e < sc.length && s < n; e++) {
    const last = e + 1 < sc.length ? sc[e + 1][0] : offs.length + 1;
    for (let ch = sc[e][0]; ch < last && s < n; ch++) {
      let o = offs[ch - 1];
      if (o == null) break;
      for (let k = 0; k < sc[e][1] && s < n; k++) { out.push({ offset: o, size: sizes[s], time: 0 }); o += sizes[s]; s++; }
    }
  }
  if (stts) {
    let t = 0, i = 0;
    const c = u32(b, stts.start + 4);
    for (let e = 0; e < c && i < out.length; e++) {
      const cnt = u32(b, stts.start + 8 + e * 8), delta = u32(b, stts.start + 12 + e * 8);
      for (let k = 0; k < cnt && i < out.length; k++, i++) { out[i].time = t; t += delta; }
    }
  }
  return out;
}

const sampleCount = (b, stbl) => { const z = stbl && findBox(stbl.children, 'stsz'); return z ? u32(b, z.start + 8) : 0; };

// QuickTime text sample: u16 byte length, then text; a BOM selects UTF-16 (either order), otherwise UTF-8.
// Any trailing style atoms (styl, hlit) after the length are ignored.
// Text of a QuickTime chapter sample: 16-bit length + UTF-8 (or UTF-16 with a BOM).
function chapterText(s) {
  if (s.length < 2) return '';
  const len = Math.min(u16(s, 0), s.length - 2);
  const t = s.subarray(2, 2 + len);
  if (t[0] === 0xfe && t[1] === 0xff) return utf16be(t.subarray(2));
  if (t[0] === 0xff && t[1] === 0xfe) { let r = ''; for (let i = 2; i + 1 < t.length; i += 2) r += String.fromCharCode(t[i] | (t[i + 1] << 8)); return r; }
  return utf8.decode(t);
}

/** Reader flow over an ISO BMFF file (see the header). */
export function* mp4Flow(size, { cover = true, maxMoov = 64 << 20 } = {}) {
  const out = {
    container: 'mp4', brand: null, duration: null, audio: null, video: null, streams: [], pairs: [], pictures: [], pictureCount: 0,
    chapters: [], warnings: [], mime: null,
  };
  // Top-level walk. Guards: 100000 boxes; a fourcc outside printable ASCII (+0xA9) means we lost sync, stop instead of
  // reading nonsense lengths; len < header size would loop forever, stop. After moov, the first moof means the
  // remaining boxes are fragments: nothing more to learn.
  // sidx (segment index, fragmented MP4 / DASH): sum of subsegment durations / timescale, the only duration source
  // when mvhd says 0. Its field offsets assume a 32-bit box header, which is what writers use for such small boxes.
  let p = 0, moov = null, sidxDur = null;
  for (let n = 0; p + 8 <= size && n < 100000; n++) {
    const h = yield [p, 16];
    if (h.length < 8) break;
    let len = u32(h, 0), hs = 8;
    const type = fourcc(h, 4);
    if (!/^[\x20-\x7e\xa9]{4}$/.test(type)) { out.warnings.push('garbage between top-level boxes'); break; }
    if (len === 1) { len = u64(h, 8); hs = 16; } else if (len === 0) len = size - p;
    if (len < hs) break;
    if (type === 'ftyp') { const f = yield [p, Math.min(len, 256)]; out.brand = fourcc(f, 8); }
    else if (type === 'moov') {
      if (len > maxMoov) { out.warnings.push('moov box too large'); break; }
      moov = yield [p, len];
    } else if (type === 'sidx' && len < (1 << 20)) {
      const s = yield [p, len];
      const v = s[8];
      const ts = u32(s, 16);
      let q = 20 + (v === 0 ? 8 : 16) + 2;
      const count = u16(s, q); q += 2;
      let d = 0;
      for (let i = 0; i < count && q + 12 <= s.length; i++, q += 12) d += u32(s, q + 4);
      if (ts) sidxDur = (sidxDur || 0) + d / ts;
    } else if (type === 'moof' && moov) break;
    p += len;
  }
  if (out.brand === 'qt  ') { out.container = 'mov'; out.mime = 'video/quicktime'; }
  if (!moov) { out.warnings.push('no moov box'); return out; }
  // moov is parsed twice on purpose: mp4/demux.js gives normalised track facts, readBoxes gives the raw tree for
  // tref / ilst / chpl that demux does not expose. Tracks from both line up by index (trak order).
  const boxes = readBoxes(moov, 0, moov.length, 12);
  const mv = boxes[0];
  const parsed = parseMp4(moov, { samples: false });
  const traks = findAll(mv, 'trak');
  // tref/chap lists track ids that are chapter text tracks; such a text track is not a subtitle stream.
  const chapterIds = new Set();
  for (const tr of traks) {
    const chap = findBox(tr.children || [], 'tref');
    if (!chap) continue;
    for (const c of readBoxes(moov, chap.start, chap.end, 0)) if (c.type === 'chap') for (let q = c.start; q + 4 <= c.end; q += 4) chapterIds.add(u32(moov, q));
  }
  parsed.tracks.forEach((t, i) => {
    const tr = traks[i];
    const stbl = tr && findBox(tr.children || [], 'mdia/minf/stbl');
    const type = t.type === 'video' ? 'video' : t.type === 'audio' ? 'audio' : t.type === 'text' && !chapterIds.has(t.id) ? 'subtitle' : 'data';
    const st = { index: i, type, codec: mp4Codec(t), lang: t.language && t.language !== 'und' ? t.language : null, title: null, default: t.enabled !== false, forced: false };
    if (type === 'audio') st.channels = t.channels || null;
    if (type === 'video') {
      st.width = t.width || t.displayWidth || null;
      st.height = t.height || t.displayHeight || null;
      const n = sampleCount(moov, stbl);
      st.fps = n > 1 && t.duration ? Math.round((n / t.duration) * 1000) / 1000 : null;
    }
    out.streams.push(st);
    if (type === 'audio' && !out.audio) {
      out.audio = {
        codec: st.codec, sampleRate: t.sampleRate ? Math.round(t.sampleRate) : null, channels: t.channels || null,
        bitsPerSample: ['alac', 'pcm', 'flac'].includes(st.codec) && t.sampleSize ? t.sampleSize : null,
      };
    }
    // MJPEG video tracks in audio files are usually embedded cover art, not video.
    if (type === 'video' && !out.video && st.codec !== 'mjpeg') out.video = { codec: st.codec, width: st.width, height: st.height, fps: st.fps };
  });
  // Duration fallbacks in order of trust: mvhd, mehd (fragment duration, in the movie timescale), sidx sum, longest track.
  let duration = parsed.duration || 0;
  const mehd = findBox(mv.children || [], 'mvex/mehd');
  if (!duration && mehd) duration = (moov[mehd.start] === 1 ? u64(moov, mehd.start + 4) : u32(moov, mehd.start + 4)) / (parsed.timescale || 1000);
  if (!duration && sidxDur) duration = sidxDur;
  if (!duration) duration = parsed.tracks.reduce((m, t) => Math.max(m, t.duration || 0), 0);
  out.duration = duration || null;
  // tags
  // ilst normally lives at moov/udta/meta/ilst; some writers put meta directly under moov.
  const udta = findBox(mv.children || [], 'udta');
  const ilst = findBox(udta?.children || [], 'meta/ilst') || findBox(mv.children || [], 'meta/ilst');
  if (ilst) {
    const r = parseIlst(moov, ilst, { cover });
    out.pairs.push(...r.pairs);
    out.pictures.push(...r.pictures);
    out.pictureCount += r.pictureCount;
  }
  // Chapter samples are tiny but live in mdat, so they are fetched one by one (2000 max, 64 KB each max).
  // chapters: QuickTime chapter track first (iTunes, m4b), else Nero chpl
  for (const id of chapterIds) {
    const i = parsed.tracks.findIndex((t) => t.id === id);
    if (i < 0) continue;
    const stbl = findBox(traks[i].children || [], 'mdia/minf/stbl');
    const ts = parsed.tracks[i].timescale || 1;
    const list = stbl ? samplesOf(moov, stbl, 2000) : [];
    for (const s of list) {
      if (s.size > 65536) continue;
      const data = yield [s.offset, s.size];
      out.chapters.push({ start: s.time / ts, end: null, title: chapterText(data) });
    }
    if (out.chapters.length) break;
  }
  const chpl = findBox(udta?.children || [], 'chpl');
  if (!out.chapters.length && chpl) out.chapters = parseChpl(moov, chpl).map((c) => ({ start: c.start, end: null, title: c.title }));
  // MIME by content: no video track means audio/mp4 regardless of the extension or brand.
  if (!out.mime) {
    const audioOnly = !out.video;
    out.mime = audioOnly ? 'audio/mp4' : out.brand === 'M4V ' || out.brand === 'M4VH' ? 'video/x-m4v' : 'video/mp4';
  }
  return out;
}
