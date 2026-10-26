// mp3/id3.js - ID3 tags: ID3v2.2 / 2.3 / 2.4 reading (text frames, comments, pictures, unsynchronisation, extended
// headers), ID3v2.3 / 2.4 writing, ID3v1 / v1.1 reading and writing, and tag stripping.
//
// Versions differ in ways that break naive parsers: v2.2 uses 3-char ids and 3-byte sizes, v2.3 plain 32-bit sizes,
// v2.4 syncsafe sizes (7 bits per byte so no false frame sync appears); unsynchronisation is tag-wide in v2.3 and
// per frame in v2.4. Reading tolerates all three; writing produces v2.4 (UTF-8) or v2.3 (Latin-1 / UTF-16).

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
// Syncsafe integer: 4 bytes x 7 bits = 28 bits; the top bit of each byte is always 0, so a size never contains FF.
const syncsafe = (b, p) => ((b[p] & 0x7f) << 21) | ((b[p + 1] & 0x7f) << 14) | ((b[p + 2] & 0x7f) << 7) | (b[p + 3] & 0x7f);
const u32be = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;

export const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies',
  'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack',
  'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game',
  'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock',
  'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult',
  'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes',
  'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];

// Tag fields <- frame ids (v2.3 / v2.4 and v2.2).
const TEXT_FRAMES = {
  TIT2: 'title', TPE1: 'artist', TALB: 'album', TPE2: 'albumArtist', TCOM: 'composer', TRCK: 'track', TPOS: 'disc', TCON: 'genre',
  TYER: 'year', TDRC: 'year', TCOP: 'copyright', TENC: 'encodedBy', TSSE: 'encoder', TBPM: 'bpm', TPUB: 'publisher', TIT1: 'grouping',
  TIT3: 'subtitle', TLAN: 'language', TKEY: 'key', TSRC: 'isrc',
  TT2: 'title', TP1: 'artist', TAL: 'album', TP2: 'albumArtist', TCM: 'composer', TRK: 'track', TPA: 'disc', TCO: 'genre', TYE: 'year',
  TCR: 'copyright', TEN: 'encodedBy', TSS: 'encoder', TBP: 'bpm',
};

/** Size in bytes of an ID3v2 tag at the start of the data (header, body and footer), 0 when there is none. */
export function id3v2Size(input, p = 0) {
  const b = asBytes(input);
  if (b.length < p + 10 || b[p] !== 0x49 || b[p + 1] !== 0x44 || b[p + 2] !== 0x33 || b[p + 3] === 0xff) return 0;
  return 10 + syncsafe(b, p + 6) + (b[p + 5] & 0x10 ? 10 : 0);
}

// Encodings: 0 Latin-1, 1 UTF-16 with BOM, 2 UTF-16BE, 3 UTF-8. Multi-value frames separate values with NUL.
// Spread into fromCharCode: an extremely long UTF-16 frame (lyrics of several hundred kB) could exceed the engine's
// argument limit and throw; readFrame's try / catch then drops that frame.
function decodeText(enc, b) {
  if (!b.length) return '';
  let s;
  if (enc === 1 || enc === 2) {
    let le = enc === 1, p = 0;
    if (enc === 1 && b.length >= 2) {
      if (b[0] === 0xff && b[1] === 0xfe) { le = true; p = 2; } else if (b[0] === 0xfe && b[1] === 0xff) { le = false; p = 2; }
    }
    const codes = [];
    for (; p + 1 < b.length; p += 2) codes.push(le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
    // UTF-16 lists restart with a BOM per value: drop the stray BOMs
    s = String.fromCharCode(...codes.filter((c) => c !== 0xfeff));
  } else if (enc === 3) s = new TextDecoder().decode(b);
  else s = Array.from(b, (c) => String.fromCharCode(c)).join('');
  return s.replace(/\0+$/, '');
}

// Length of a terminated string in encoding `enc` starting at p (excluding the terminator).
function strEnd(b, p, enc) {
  if (enc === 1 || enc === 2) { for (let i = p; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i; return b.length; }
  const i = b.indexOf(0, p);
  return i < 0 ? b.length : i;
}
const termLen = (enc) => (enc === 1 || enc === 2 ? 2 : 1);

// Unsynchronisation inserted 00 after every FF so tag bytes never look like an MPEG frame sync; removing it restores
// the data.
function undoUnsync(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0) i++; }
  return new Uint8Array(out);
}

function genreName(v) {
  // "(17)", "(17)Rock", "17", "Rock" -> names
  return v.replace(/\((\d+)\)/g, (m, n) => (GENRES[+n] ? GENRES[+n] + ' ' : '')).replace(/^(\d+)$/, (m, n) => GENRES[+n] || m).trim();
}

/**
 * Reads an ID3v2 tag at the start of the data.
 * Returns null or { version: [major, revision], size, frames: [{ id, data }], tags: { title, artist, album, year,
 * track, genre, comment, albumArtist, composer, encoder, lyrics, ...; user: { DESCRIPTION: value } },
 * pictures: [{ mime, type, description, data }] }.
 */
export function readId3v2(input) {
  const b = asBytes(input);
  const size = id3v2Size(b);
  if (!size) return null;
  const major = b[3], rev = b[4], flags = b[5];
  let body = b.subarray(10, Math.min(b.length, 10 + syncsafe(b, 6)));
  if (major < 4 && flags & 0x80) body = undoUnsync(body);
  let p = 0;
  // The extended header size includes itself in v2.4 but not in v2.3 (hence + 4).
  if (flags & 0x40) p = major === 4 ? syncsafe(body, 0) : u32be(body, 0) + 4; // extended header
  const out = { version: [major, rev], size, frames: [], tags: {}, pictures: [] };
  const idLen = major === 2 ? 3 : 4, hdr = major === 2 ? 6 : 10;
  while (p + hdr <= body.length) {
    if (body[p] === 0) break; // padding
    const id = String.fromCharCode(...body.subarray(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize = major === 2 ? (body[p + 3] << 16) | (body[p + 4] << 8) | body[p + 5] : major === 4 ? syncsafe(body, p + 4) : u32be(body, p + 4);
    const fflags = major === 2 ? 0 : (body[p + 8] << 8) | body[p + 9];
    let data = body.subarray(p + hdr, Math.min(body.length, p + hdr + fsize));
    p += hdr + fsize;
    if (major === 4) {
      if (fflags & 0x0001) data = data.subarray(4); // data length indicator
      if (fflags & 0x0002) data = undoUnsync(data);
      // Compressed (zlib) and encrypted frames are skipped rather than decoded: rare, and a wrong decode is worse.
      if (fflags & 0x000c) continue; // compressed / encrypted
    } else if (major === 3 && fflags & 0x00c0) continue;
    out.frames.push({ id, data });
    try { readFrame(id, data, out, major); } catch { /* malformed frame */ }
  }
  return out;
}

function readFrame(id, d, out, major) {
  const enc = d[0];
  if (TEXT_FRAMES[id] && id[0] === 'T') {
    const key = TEXT_FRAMES[id];
    let v = decodeText(enc, d.subarray(1)).split('\0').filter(Boolean).join('; ');
    if (key === 'genre') v = genreName(v);
    if (v) out.tags[key] = v;
  } else if (id === 'TXXX' || id === 'TXX') {
    const e = strEnd(d, 1, enc);
    const desc = decodeText(enc, d.subarray(1, e));
    (out.tags.user ||= {})[desc] = decodeText(enc, d.subarray(e + termLen(enc)));
  } else if (id === 'COMM' || id === 'COM' || id === 'USLT' || id === 'ULT') {
    const e = strEnd(d, 4, enc);
    const desc = decodeText(enc, d.subarray(4, e));
    const text = decodeText(enc, d.subarray(e + termLen(enc)));
    const key = id[0] === 'U' ? 'lyrics' : 'comment';
    if (!out.tags[key] || !desc) out.tags[key] = text;
  } else if (id === 'APIC' || id === 'PIC') {
    let p, mime;
    if (major === 2) { const f = String.fromCharCode(d[1], d[2], d[3]).toUpperCase(); mime = f === 'PNG' ? 'image/png' : 'image/jpeg'; p = 4; }
    else { const e = d.indexOf(0, 1); mime = decodeText(0, d.subarray(1, e)) || 'image/jpeg'; p = e + 1; if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase(); }
    const type = d[p++];
    const e = strEnd(d, p, enc);
    const description = decodeText(enc, d.subarray(p, e));
    out.pictures.push({ mime, type, description, data: d.subarray(e + termLen(enc)) });
  } else if (id === 'WXXX' || /^W[A-Z]{3}$/.test(id)) {
    if (id === 'WXXX') { const e = strEnd(d, 1, enc); (out.tags.urls ||= {})[decodeText(enc, d.subarray(1, e)) || 'url'] = decodeText(0, d.subarray(e + termLen(enc))); }
    else (out.tags.urls ||= {})[id] = decodeText(0, d);
  }
}

// ---------------------------------------------------------------------------------------------
// Writing

const FRAME_OF = { title: 'TIT2', artist: 'TPE1', album: 'TALB', albumArtist: 'TPE2', composer: 'TCOM', track: 'TRCK', disc: 'TPOS',
  genre: 'TCON', copyright: 'TCOP', encodedBy: 'TENC', encoder: 'TSSE', bpm: 'TBPM', publisher: 'TPUB', grouping: 'TIT1', subtitle: 'TIT3', language: 'TLAN' };

const isLatin1 = (s) => /^[\x00-\xff]*$/.test(s);

// Text bytes in an ID3v2 encoding: 0 ISO-8859-1, 1 UTF-16 with a BOM, 3 UTF-8.
function textBytes(s, enc) {
  if (enc === 3) return new TextEncoder().encode(s);
  if (enc === 0) return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 + i * 2] = c & 0xff; out[3 + i * 2] = c >> 8; }
  return out;
}
// v2.4 -> UTF-8; v2.3 -> ISO-8859-1 when every string fits, else UTF-16.
const pickEnc = (v4, ...strs) => (v4 ? 3 : strs.every(isLatin1) ? 0 : 1);

function cat(parts) {
  let n = 0;
  for (const x of parts) n += x.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

const ss = (n) => new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const be32 = (n) => new Uint8Array([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

/**
 * Builds an ID3v2 tag.
 *   tags  { title, artist, album, albumArtist, composer, year, track, disc, genre, comment, lyrics, encoder, ...,
 *           user: { DESCRIPTION: value } }
 *   opts  { version: 3 | 4 (default 4), pictures: [{ mime, type = 3, description, data }], padding = 0 }
 */
// No unsynchronisation is applied when writing: every modern player handles raw tags, and v2.4 syncsafe sizes
// already prevent false syncs in the header.
export function writeId3v2(tags = {}, opts = {}) {
  const v4 = (opts.version || 4) === 4;
  const frames = [];
  const frame = (id, payload) => frames.push(cat([Uint8Array.from(id, (c) => c.charCodeAt(0)), v4 ? ss(payload.length) : be32(payload.length), new Uint8Array(2), payload]));
  const term = (enc) => new Uint8Array(enc === 1 || enc === 2 ? 2 : 1);
  for (const [k, id] of Object.entries(FRAME_OF)) {
    const v = tags[k];
    if (v == null || v === '') continue;
    const enc = pickEnc(v4, String(v));
    frame(id, cat([new Uint8Array([enc]), textBytes(String(v), enc)]));
  }
  if (tags.year != null && tags.year !== '') {
    const enc = pickEnc(v4, String(tags.year));
    frame(v4 ? 'TDRC' : 'TYER', cat([new Uint8Array([enc]), textBytes(String(tags.year), enc)]));
  }
  for (const [k, id] of [['comment', 'COMM'], ['lyrics', 'USLT']]) {
    if (!tags[k]) continue;
    const enc = pickEnc(v4, String(tags[k]));
    frame(id, cat([new Uint8Array([enc, 0x65, 0x6e, 0x67]), textBytes('', enc), term(enc), textBytes(String(tags[k]), enc)]));
  }
  for (const [desc, value] of Object.entries(tags.user || {})) {
    const enc = pickEnc(v4, desc, String(value));
    frame('TXXX', cat([new Uint8Array([enc]), textBytes(desc, enc), term(enc), textBytes(String(value), enc)]));
  }
  for (const pic of opts.pictures || []) {
    const enc = pickEnc(v4, pic.description || '');
    frame('APIC', cat([new Uint8Array([enc]), textBytes(pic.mime || 'image/jpeg', 0), new Uint8Array([0, pic.type ?? 3]), textBytes(pic.description || '', enc), term(enc), asBytes(pic.data)]));
  }
  const body = cat([...frames, new Uint8Array(opts.padding || 0)]);
  return cat([new Uint8Array([0x49, 0x44, 0x33, v4 ? 4 : 3, 0, 0]), ss(body.length), body]);
}

/** Reads an ID3v1 / v1.1 tag (last 128 bytes): { title, artist, album, year, comment, track, genre } or null. */
// ID3v1.1: a zero byte at 125 followed by a non-zero byte at 126 means the last comment bytes hold the track number.
export function readId3v1(input) {
  const b = asBytes(input);
  if (b.length < 128) return null;
  const p = b.length - 128;
  if (b[p] !== 0x54 || b[p + 1] !== 0x41 || b[p + 2] !== 0x47) return null;
  const str = (o, n) => decodeText(0, b.subarray(p + o, p + o + n)).replace(/\0.*$/, '').trim();
  const out = { title: str(3, 30), artist: str(33, 30), album: str(63, 30), year: str(93, 4), comment: str(97, 30) };
  if (b[p + 125] === 0 && b[p + 126]) { out.comment = str(97, 28); out.track = String(b[p + 126]); }
  if (GENRES[b[p + 127]]) out.genre = GENRES[b[p + 127]];
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

/** Builds a 128-byte ID3v1.1 tag (Latin-1, truncated fields). */
export function writeId3v1(tags = {}) {
  const out = new Uint8Array(128);
  out.set([0x54, 0x41, 0x47]);
  const put = (o, n, s) => { const t = String(s || ''); for (let i = 0; i < Math.min(n, t.length); i++) { const c = t.charCodeAt(i); out[o + i] = c < 256 ? c : 0x3f; } };
  put(3, 30, tags.title); put(33, 30, tags.artist); put(63, 30, tags.album); put(93, 4, tags.year); put(97, 28, tags.comment);
  const tr = parseInt(tags.track, 10);
  if (tr > 0 && tr < 256) out[126] = tr;
  const g = tags.genre ? GENRES.findIndex((x) => x.toLowerCase() === String(tags.genre).toLowerCase()) : -1;
  out[127] = g >= 0 ? g : 255;
  return out;
}

/** Removes ID3v2 tags at the start (repeated ones too), ID3v1 and APEv2 at the end: { audio, id3v2, id3v1 }. */
export function stripId3(input) {
  const b = asBytes(input);
  let start = 0, n;
  const v2 = readId3v2(b);
  while ((n = id3v2Size(b, start))) start += n;
  let end = b.length;
  const v1 = readId3v1(b);
  if (v1) end -= 128;
  if (end >= 32 && String.fromCharCode(...b.subarray(end - 32, end - 24)) === 'APETAGEX') {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    end -= dv.getUint32(end - 20, true) + ((dv.getUint32(end - 12, true) >>> 31) ? 32 : 0);
  }
  return { audio: b.subarray(start, Math.max(start, end)), id3v2: v2, id3v1: v1 };
}

/** Replaces the tags of an MP3: new ID3v2 (opts.version, opts.pictures) and, with opts.v1, an ID3v1 tag at the end. */
export function setId3(input, tags, opts = {}) {
  const { audio } = stripId3(input);
  return cat([writeId3v2(tags, opts), audio, opts.v1 ? writeId3v1(tags) : new Uint8Array(0)]);
}
