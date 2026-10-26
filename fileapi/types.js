// fileapi/types.js - media types and kinds of files by extension (what the file API sends as Content-Type and lists
// as `type` / `kind`).
//
//   typeOf(name)  -> MIME type ('application/octet-stream' when unknown); text types carry no charset (the bytes are
//                    served as stored: cue sheets and lyrics are often not UTF-8)
//   kindOf(name)  -> 'audio' | 'video' | 'image' | 'subtitle' | 'text' | 'other' (playlists, cue sheets, lyrics,
//                    nfo and json are 'text')
//   TYPES         -> { ext: type } (extensions lower case, without the dot)
//   SUBTITLE_EXT, PLAYLIST_EXT -> Sets of extensions

import { extOf } from './paths.js';

// Extension -> type table rather than content sniffing: listing a directory must not open every file. The server is
// expected to send X-Content-Type-Options: nosniff, so the browser trusts these types; text/html and image/svg+xml
// are listed, which means a served .html/.svg executes script in the API's origin if opened directly - the handler is
// responsible for a sandboxing CSP or Content-Disposition on those.
export const TYPES = {
  // audio
  mp3: 'audio/mpeg', mp2: 'audio/mpeg', mpga: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  spx: 'audio/ogg', m4a: 'audio/mp4', m4b: 'audio/mp4', m4r: 'audio/mp4', aac: 'audio/mp4', wav: 'audio/wav', wave: 'audio/wav',
  weba: 'audio/webm', mka: 'audio/x-matroska', aif: 'audio/aiff', aiff: 'audio/aiff', aifc: 'audio/aiff', wma: 'audio/x-ms-wma',
  ape: 'audio/x-ape', wv: 'audio/x-wavpack', mpc: 'audio/x-musepack', tta: 'audio/x-tta', dsf: 'audio/x-dsf', dff: 'audio/x-dff',
  mid: 'audio/midi', midi: 'audio/midi', amr: 'audio/amr', caf: 'audio/x-caf', au: 'audio/basic', ac3: 'audio/ac3', dts: 'audio/vnd.dts',
  // video
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mk3d: 'video/x-matroska', mov: 'video/quicktime',
  avi: 'video/x-msvideo', ts: 'video/mp2t', m2ts: 'video/mp2t', mts: 'video/mp2t', ogv: 'video/ogg', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  m2v: 'video/mpeg', vob: 'video/mpeg', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
  // images
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', apng: 'image/apng', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl',
  // subtitles
  vtt: 'text/vtt', srt: 'application/x-subrip', ass: 'text/x-ssa', ssa: 'text/x-ssa', sub: 'text/plain', sbv: 'text/plain', ttml: 'application/ttml+xml',
  // text, playlists, metadata
  txt: 'text/plain', nfo: 'text/plain', lrc: 'text/plain', log: 'text/plain', md: 'text/markdown', cue: 'application/x-cue',
  m3u: 'audio/x-mpegurl', m3u8: 'application/vnd.apple.mpegurl', pls: 'audio/x-scpls', xspf: 'application/xspf+xml', wpl: 'application/vnd.ms-wpl',
  asx: 'video/x-ms-asf', json: 'application/json', xml: 'application/xml', csv: 'text/csv', html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript',
  // other common files
  pdf: 'application/pdf', zip: 'application/zip', epub: 'application/epub+zip', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', wasm: 'application/wasm',
};

export const SUBTITLE_EXT = new Set(['vtt', 'srt', 'ass', 'ssa', 'sub', 'sbv', 'ttml']);
export const PLAYLIST_EXT = new Set(['m3u', 'm3u8', 'pls', 'xspf', 'wpl', 'asx', 'cue']);
const TEXT_EXT = new Set(['txt', 'nfo', 'lrc', 'log', 'md', 'cue', 'm3u', 'm3u8', 'pls', 'xspf', 'wpl', 'asx', 'json', 'xml', 'csv']);

export const typeOf = (name) => TYPES[extOf(name)] || 'application/octet-stream';

// Explicit sets first: subtitle and playlist extensions have MIME types (application/x-subrip, audio/x-mpegurl)
// whose prefix would misclassify them as 'other' or 'audio'.
export function kindOf(name) {
  const ext = extOf(name);
  if (SUBTITLE_EXT.has(ext)) return 'subtitle';
  if (TEXT_EXT.has(ext)) return 'text';
  const t = TYPES[ext];
  if (!t) return 'other';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('image/')) return 'image';
  return 'other';
}
