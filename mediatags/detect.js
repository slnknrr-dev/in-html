// mediatags/detect.js - what a file is: kind by extension (refined by magic bytes), container by magic bytes, media
// types.
//
//   EXT                       { audio: [...], video: [...], image, subtitle, lyrics, cue, nfo, playlist, text } (extensions)
//   extOf(name)               lowercase extension without the dot ('' when none)
//   kindOf(name, head?)       'audio' | 'video' | 'image' | 'subtitle' | 'lyrics' | 'cue' | 'nfo' | 'playlist' | 'text' |
//                             'other'. By extension; with `head` (the first bytes, a few KB) the magic bytes decide for
//                             unknown extensions and refine containers that may hold audio only (.webm .mkv .mp4 .m4v
//                             .ogg .ogv .mov .3gp): an Ogg stream without Theora, a Matroska Tracks element without a
//                             video track or an MP4 with only sound handlers is 'audio'. Without `head` the
//                             extension's usual kind is returned.
//   containerOf(head)         'mp3' | 'flac' | 'ogg' | 'mp4' | 'webm' | 'mkv' | 'wav' | 'aiff' | 'jpeg' | 'png' | 'webp' |
//                             'gif' | null; also 'aac' (ADTS), 'avi', 'ts', 'asf', 'flv', 'ape', 'wv', 'bmp', 'avif',
//                             'heic'. An ID3v2 prefix is looked through (FLAC / AAC after the tag; MP3 when the tag
//                             runs past `head`).
//   mimeOf(name)              media type by extension ('application/octet-stream' when unknown)
//   isMediaKind(kind)         kind is 'audio' or 'video'

//
// Why magic bytes beat extensions: extensions lie (.mp3 that is AAC, .ogg holding video, .m4a renamed .mp4), and the
// reader picked from the wrong extension fails or misreports. The extension stays the fallback when the head is
// unknown, and the tie-breaker between audio and video when the container cannot tell from the head alone.
// Ordering of checks in containerOf: exact multi-byte signatures first, weak ones last. MPEG audio sync (11 set bits)
// and ADTS occur by chance in any binary, so they are tested only after everything else and MPEG is confirmed by a
// second consistent frame header.
import { parseFrameHeader } from '../mp3/frame.js';

export const EXT = {
  audio: ['mp3', 'm4a', 'm4b', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'aiff', 'aif', 'wma', 'ape', 'wv', 'mka', 'alac', 'dsf'],
  video: ['mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'ts', 'm2ts', 'mpg', 'mpeg', 'flv', '3gp', 'ogv'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'],
  subtitle: ['srt', 'vtt', 'ass', 'ssa', 'sub'],
  lyrics: ['lrc'],
  cue: ['cue'],
  nfo: ['nfo'],
  playlist: ['m3u', 'm3u8', 'pls', 'xspf'],
  text: ['txt', 'md', 'log'],
};

// Reverse index ext -> kind, built once: O(1) lookups in kindOf for every file of a library scan.
const KIND = new Map();
for (const [kind, list] of Object.entries(EXT)) for (const e of list) KIND.set(e, kind);

const MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', wav: 'audio/wav', aiff: 'audio/aiff', aif: 'audio/aiff', wma: 'audio/x-ms-wma', ape: 'audio/x-ape',
  wv: 'audio/x-wavpack', mka: 'audio/x-matroska', alac: 'audio/mp4', dsf: 'audio/x-dsf',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv', ts: 'video/mp2t', m2ts: 'video/mp2t', mpg: 'video/mpeg', mpeg: 'video/mpeg', flv: 'video/x-flv',
  '3gp': 'video/3gpp', ogv: 'video/ogg',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
  srt: 'application/x-subrip', vtt: 'text/vtt', ass: 'text/x-ssa', ssa: 'text/x-ssa', sub: 'text/x-microdvd',
  lrc: 'application/x-lrc', cue: 'application/x-cue', nfo: 'text/x-nfo',
  m3u: 'audio/x-mpegurl', m3u8: 'audio/x-mpegurl', pls: 'audio/x-scpls', xspf: 'application/xspf+xml',
  txt: 'text/plain', md: 'text/markdown', log: 'text/plain',
};

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const ascii = (b, o, n) => { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; };
const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// Both separators (Windows paths and URLs). i > 0, not >= 0: a dotfile ('.nfo' alone) has no extension.
/** Lowercase extension of a file name or path ('' when none). */
export function extOf(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export const isMediaKind = (k) => k === 'audio' || k === 'video';

export function mimeOf(name) {
  return MIME[extOf(name)] || 'application/octet-stream';
}

// 'ID3', version byte != 0xff, then a 28-bit syncsafe size (7 bits per byte) excluding the 10-byte header; flag 0x10
// adds a 10-byte footer.
// Size of an ID3v2 tag at p (0 when none).
function id3Size(b, p = 0) {
  if (b.length < p + 10 || b[p] !== 0x49 || b[p + 1] !== 0x44 || b[p + 2] !== 0x33 || b[p + 3] === 0xff) return 0;
  return 10 + (((b[p + 6] & 0x7f) << 21) | ((b[p + 7] & 0x7f) << 14) | ((b[p + 8] & 0x7f) << 7) | (b[p + 9] & 0x7f)) + (b[p + 5] & 0x10 ? 10 : 0);
}

// ADTS: 12-bit sync 0xFFF, layer bits 00 (mask 0xf6 keeps the MPEG-version bit free), sampling index < 13 (13..15
// are reserved). Without the layer check every MP3 frame would look like AAC.
function isAdts(b, p) {
  return p + 7 <= b.length && b[p] === 0xff && (b[p + 1] & 0xf6) === 0xf0 && ((b[p + 2] >> 2) & 15) < 13;
}

// One header is not evidence (random bytes match ~1 in 2000); a second header exactly frameSize later with the same
// version / layer / rate is. A head ending inside the first frame gives the benefit of the doubt.
function mpegAt(b, p) {
  const h = parseFrameHeader(b, p);
  if (!h) return false;
  const q = p + h.frameSize;
  if (q + 4 > b.length) return true; // the head ends inside the first frame
  const n = parseFrameHeader(b, q);
  return !!n && n.version === h.version && n.layer === h.layer && n.sampleRate === h.sampleRate;
}

/** Container by magic bytes (see the header). */
export function containerOf(input) {
  const b = asBytes(input || []);
  if (b.length < 4) return null;
  // ID3v2 is a prefix, not a container: look through it. FLAC and ADTS AAC after the tag are recognised; anything else
  // (including a tag that runs past the head) is assumed MP3, the overwhelmingly common case for ID3v2.
  const tag = id3Size(b);
  if (tag) {
    if (tag + 4 > b.length) return 'mp3';
    let p = tag;
    while (p < b.length && p < tag + 4096 && b[p] === 0) p++; // padding after the declared size
    const rest = containerOf(b.subarray(p));
    return rest === 'flac' || rest === 'aac' ? rest : 'mp3';
  }
  const s4 = ascii(b, 0, 4);
  if (s4 === 'fLaC') return 'flac';
  if (s4 === 'OggS') return 'ogg';
  // RIFF family: RF64 / BW64 are the 64-bit-size broadcast variants of WAVE.
  if (s4 === 'RIFF' || s4 === 'RF64' || s4 === 'BW64') {
    const t = ascii(b, 8, 4);
    return t === 'WAVE' ? 'wav' : t === 'AVI ' ? 'avi' : t === 'WEBP' ? 'webp' : null;
  }
  if (s4 === 'FORM') { const t = ascii(b, 8, 4); return t === 'AIFF' || t === 'AIFC' ? 'aiff' : null; }
  // EBML magic; the DocType string ('webm' vs 'matroska') sits in the first few dozen bytes of the EBML header.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return /webm/.test(ascii(b, 0, Math.min(b.length, 64))) ? 'webm' : 'mkv';
  // ISO BMFF: the box type at offset 4. ftyp brands split AVIF / HEIF (still images in the same container) from MP4.
  // Files without ftyp (old QuickTime) start with moov / mdat / wide / free / skip / pnot; size >= 8 rejects text.
  const box = ascii(b, 4, 4);
  if (box === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (/^(heic|heix|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
    return 'mp4';
  }
  if (/^(moov|mdat|wide|free|skip|pnot)$/.test(box) && u32be(b, 0) >= 8) return 'mp4';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && s4.slice(1) === 'PNG') return 'png';
  if (s4 === 'GIF8') return 'gif';
  if (s4 === 'MAC ') return 'ape';
  if (s4 === 'wvpk') return 'wv';
  if (ascii(b, 0, 3) === 'FLV') return 'flv';
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return 'asf';
  // MPEG-TS: sync byte 0x47 repeating every 188 bytes (two or three packets); a single 0x47 is too weak.
  // BMP: 'BM' plus a known DIB header size at offset 14, since 'BM' alone matches text.
  if (b[0] === 0x47 && b.length >= 189 && b[188] === 0x47 && (b.length < 377 || b[376] === 0x47)) return 'ts';
  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 18 && [12, 40, 52, 56, 108, 124].includes(b[14] | (b[15] << 8))) return 'bmp';
  if (isAdts(b, 0)) return 'aac';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && mpegAt(b, 0)) return 'mp3';
  return null;
}

// --- audio-only refinements -----------------------------------------------------------------

// Ogg: walks BOS pages only (they precede all data pages by spec) and reads each first packet's codec signature.
// Ogg: the beginning-of-stream pages name every codec.
function oggKind(b) {
  let p = 0, video = false, audio = false;
  while (p + 27 <= b.length && ascii(b, p, 4) === 'OggS') {
    const n = b[p + 26];
    let len = 0;
    for (let i = 0; i < n; i++) len += b[p + 27 + i];
    const d = p + 27 + n;
    if (b[p + 5] & 2) {
      const sig = ascii(b, d, 8);
      if (sig.startsWith('\x80theora') || sig.startsWith('\x80daala') || sig.startsWith('BBCD')) video = true;
      else if (sig === 'OpusHead' || sig.startsWith('\x01vorbis') || sig.startsWith('\x7fFLAC') || sig.startsWith('Speex')) audio = true;
    } else break; // every BOS page comes first
    p = d + len;
  }
  return video ? 'video' : audio ? 'audio' : null;
}

// Matroska: a byte scan, not an EBML parse: after the Tracks id (16 54 AE 6B) look for TrackType (83) with a 1-byte
// size (81). Cheap and good enough for a head of a few KB; a false 83 81 01 in codec private data could report
// video for an audio file, an accepted risk since the extension decides when nothing is found.
// Matroska: TrackType values of the Tracks element when it is inside the head.
function matroskaKind(b) {
  let video = false, audio = false, seen = false;
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] === 0x16 && b[i + 1] === 0x54 && b[i + 2] === 0xae && b[i + 3] === 0x6b) seen = true;
    // TrackType element: id 0x83, size 0x81, value
    if (seen && b[i] === 0x83 && b[i + 1] === 0x81) {
      if (b[i + 2] === 1) video = true;
      else if (b[i + 2] === 2) audio = true;
    }
  }
  return video ? 'video' : audio ? 'audio' : null;
}

// MP4: M4A / M4B / M4P brands are audio by definition; otherwise hdlr boxes ('vide' / 'soun') found by scanning.
// Only works when moov is in the head (faststart files); otherwise the extension decides.
// MP4: handler types of the hdlr boxes inside the head (moov first).
function mp4Kind(b) {
  const brand = ascii(b, 8, 4);
  if (/^M4[ABP] $/.test(brand)) return 'audio';
  let video = false, audio = false;
  for (let i = 4; i + 16 <= b.length; i++) {
    if (b[i] !== 0x68 || ascii(b, i, 4) !== 'hdlr') continue;
    const h = ascii(b, i + 12, 4);
    if (h === 'vide') video = true;
    else if (h === 'soun') audio = true;
  }
  return video ? 'video' : audio ? 'audio' : null;
}

/** Kind of a file by name, refined by its first bytes (see the header). */
export function kindOf(name, head) {
  const ext = extOf(name);
  const byExt = KIND.get(ext) || null;
  if (!head) return byExt || 'other';
  const b = asBytes(head);
  const c = containerOf(b);
  if (!c) return byExt || 'other';
  if (['jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic'].includes(c)) return 'image';
  if (['mp3', 'flac', 'wav', 'aiff', 'aac', 'ape', 'wv'].includes(c)) return 'audio';
  // An audio/video extension is a better tie-breaker than a blanket default; defaults reflect what each container
  // usually holds (Ogg mostly audio, Matroska and MP4 mostly video).
  const av = isMediaKind(byExt) ? byExt : null;
  if (c === 'ogg') return oggKind(b) || av || 'audio';
  if (c === 'webm' || c === 'mkv') return matroskaKind(b) || av || 'video';
  if (c === 'mp4') return mp4Kind(b) || av || 'video';
  if (c === 'asf') return av || 'video';
  return av || 'video';
}
