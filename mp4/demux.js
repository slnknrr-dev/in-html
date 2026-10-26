// mp4/demux.js - ISO BMFF demuxer: file brands, movie and track headers, sample descriptions (codec strings and
// WebCodecs decoder descriptions), sample tables and fragments (moof/trun) -> timed sample lists, iTunes-style
// metadata and cover art.
import { findAll, findBox, readBoxes } from './box.js';
import {
  codecName, opusHeadFromDOps, parseAv1C, parseAvcC, parseDOps, parseEsds, parseHvcC, parseVpcC,
} from './codecs.js';

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
//
// Strategy: read the box tree once, then decode only the boxes that matter. Every number read is bounded by the box
// it belongs to; a broken track becomes { type: 'unknown', error } instead of failing the whole file (phones and
// screen recorders produce many slightly non-conforming files).
// MP4 times are seconds since 1904-01-01 (the classic Mac epoch).
const MAC_EPOCH = Date.UTC(1904, 0, 1) / 1000;

const VISUAL = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp08', 'vp09', 'mp4v', 's263', 'encv', 'dvh1', 'dvhe', 'jpeg', 'mjpa', 'apcn', 'apch', 'apcs', 'apco', 'ap4h']);
const AUDIO = new Set(['mp4a', 'Opus', 'fLaC', 'ac-3', 'ec-3', '.mp3', 'alac', 'ipcm', 'fpcm', 'sowt', 'twos', 'lpcm', 'enca', 'samr', 'ulaw', 'alaw', 'in24', 'in32', 'fl32', 'fl64', 'raw ']);

// ISO-639-2/T language packed as 3 x 5 bits.
const lang = (v) => (v && v !== 0x7fff ? String.fromCharCode(((v >> 10) & 31) + 0x60, ((v >> 5) & 31) + 0x60, (v & 31) + 0x60) : 'und');

/**
 * Parses an MP4 / MOV file.
 * Returns { brands: { major, minor, compatible }, fragmented, timescale, duration (s), created, modified (Date | null),
 *   tracks: [track], metadata: { title, artist, album, date, genre, comment, encoder, ... }, cover: { mime, data } | null,
 *   boxes: [{ type, offset, size }] (top level) }.
 * track: { id, type ('video' | 'audio' | 'text' | ...), handler, handlerName, fourcc, codec (WebCodecs string),
 *   codecName, description (decoder configuration bytes for WebCodecs) | null, timescale, duration (s), language,
 *   width, height, displayWidth, displayHeight, sampleRate, channels, bitDepth, bitrate, frameRate, edits,
 *   samples: [{ offset, size, dts, cts, duration (timescale units), timestamp, durationUs (µs), keyframe, data }] }.
 */
export function parseMp4(input, { samples = true } = {}) {
  const b = asBytes(input);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const top = readBoxes(b, 0, b.length, 10);
  const out = {
    brands: null, fragmented: false, timescale: 1000, duration: 0, created: null, modified: null, tracks: [],
    metadata: {}, cover: null, boxes: top.map((x) => ({ type: x.type, offset: x.offset, size: x.size })),
  };
  const ftyp = top.find((x) => x.type === 'ftyp');
  if (ftyp) {
    const compatible = [];
    for (let p = ftyp.start + 8; p + 4 <= ftyp.end; p += 4) compatible.push(fourcc(b, p));
    out.brands = { major: fourcc(b, ftyp.start), minor: dv.getUint32(ftyp.start + 4), compatible };
  }
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) {
    if (!ftyp && !top.some((x) => x.type === 'mdat')) throw new Error('not an MP4 / ISO BMFF file');
    return out;
  }
  const mvhd = findBox(moov.children, 'mvhd');
  if (mvhd) {
    const v = b[mvhd.start];
    const p = mvhd.start + 4;
    const rd = (o, wide) => (wide ? dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4) : dv.getUint32(o));
    const created = rd(p, v === 1), modified = rd(p + (v === 1 ? 8 : 4), v === 1);
    const tsOff = p + (v === 1 ? 16 : 8);
    out.timescale = dv.getUint32(tsOff) || 1000;
    out.duration = rd(tsOff + 4, v === 1) / out.timescale;
    if (created) out.created = new Date((created + MAC_EPOCH) * 1000);
    if (modified) out.modified = new Date((modified + MAC_EPOCH) * 1000);
  }
  const trex = new Map();
  const mvex = findBox(moov.children, 'mvex');
  for (const t of findAll(mvex, 'trex')) {
    const p = t.start + 4;
    trex.set(dv.getUint32(p), { sdi: dv.getUint32(p + 4), duration: dv.getUint32(p + 8), size: dv.getUint32(p + 12), flags: dv.getUint32(p + 16) });
  }
  if (mvex) out.fragmented = true;
  for (const trak of findAll(moov, 'trak')) {
    try { out.tracks.push(parseTrak(b, dv, trak, out.timescale, samples)); } catch (e) { out.tracks.push({ id: 0, type: 'unknown', error: String(e.message || e), samples: [] }); }
  }
  if (top.some((x) => x.type === 'moof')) {
    out.fragmented = true;
    if (samples) readFragments(b, dv, top, out.tracks, trex);
  }
  for (const t of out.tracks) finishTrack(t, b, out.fragmented);
  // Fragmented files (MediaRecorder) leave the movie duration at 0 or at the first fragment.
  if (!out.duration || out.fragmented) out.duration = out.tracks.reduce((m, t) => Math.max(m, t.duration || 0), out.fragmented ? 0 : out.duration);
  readMetadata(b, dv, moov, out);
  return out;
}

// Fixed-offset reads follow the box layouts of ISO/IEC 14496-12; version 1 boxes use 64-bit times, hence the
// (v === 1 ? 16 : 8) skips. Rotation is derived from the tkhd matrix (phones store portrait video as landscape
// pixels + a 90 degree matrix).
function parseTrak(b, dv, trak, movieScale, wantSamples) {
  const t = { id: 0, type: 'unknown', handler: '', samples: [], edits: [] };
  const tkhd = findBox(trak.children, 'tkhd');
  if (tkhd) {
    const v = b[tkhd.start];
    t.enabled = !!(b[tkhd.start + 3] & 1);
    const p = tkhd.start + 4 + (v === 1 ? 16 : 8);
    t.id = dv.getUint32(p);
    const wOff = tkhd.end - 8;
    t.displayWidth = Math.round(dv.getUint32(wOff) / 65536);
    t.displayHeight = Math.round(dv.getUint32(wOff + 4) / 65536);
    // Rotation from the transformation matrix (a, b, c, d of the 3x3 matrix).
    const mOff = wOff - 36;
    const a = dv.getInt32(mOff) / 65536, bb = dv.getInt32(mOff + 4) / 65536;
    t.rotation = Math.round((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  }
  const elst = findBox(trak.children, 'edts/elst');
  if (elst) {
    const v = b[elst.start];
    const n = dv.getUint32(elst.start + 4);
    let p = elst.start + 8;
    for (let i = 0; i < n && p < elst.end; i++) {
      const segDur = v === 1 ? dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4) : dv.getUint32(p);
      const mediaTime = v === 1 ? dv.getInt32(p + 8) * 4294967296 + dv.getUint32(p + 12) : dv.getInt32(p + 4);
      p += v === 1 ? 16 : 8;
      const rate = dv.getInt16(p) + dv.getUint16(p + 2) / 65536;
      p += 4;
      t.edits.push({ duration: segDur / movieScale, mediaTime, rate });
    }
  }
  const mdia = findBox(trak.children, 'mdia');
  const mdhd = findBox(mdia?.children, 'mdhd');
  if (mdhd) {
    const v = b[mdhd.start];
    const p = mdhd.start + 4 + (v === 1 ? 16 : 8);
    t.timescale = dv.getUint32(p) || 1;
    const d = v === 1 ? dv.getUint32(p + 4) * 4294967296 + dv.getUint32(p + 8) : dv.getUint32(p + 4);
    t.duration = d === 0xffffffff ? 0 : d / t.timescale;
    t.language = lang(dv.getUint16(p + (v === 1 ? 12 : 8)));
  }
  const hdlr = findBox(mdia?.children, 'hdlr');
  if (hdlr) {
    t.handler = fourcc(b, hdlr.start + 8);
    t.handlerName = new TextDecoder().decode(b.subarray(hdlr.start + 24, hdlr.end)).replace(/\0+$/, '').replace(/^[\x00-\x1f]/, '');
    t.type = { vide: 'video', soun: 'audio', text: 'text', subt: 'text', sbtl: 'text', clcp: 'text', meta: 'metadata', hint: 'hint', tmcd: 'timecode' }[t.handler] || t.handler;
  }
  const stbl = findBox(mdia?.children, 'minf/stbl');
  if (!stbl) return t;
  const stsd = findBox(stbl.children, 'stsd');
  if (stsd) parseSampleEntry(b, dv, stsd, t);
  if (wantSamples) t.samples = sampleTable(b, dv, stbl);
  return t;
}

// Only the first sample entry is read (multiple entries are rare and mostly in broadcast files). Sample entry
// headers differ: visual entries carry 78 bytes of fields before child boxes, audio entries 28 (+16 / +36 for
// QuickTime sound description versions 1 / 2). The codec configuration child (avcC, esds ...) then yields the
// WebCodecs codec string and the decoder 'description' bytes.
function parseSampleEntry(b, dv, stsd, t) {
  const p = stsd.start + 8; // version/flags + entry count
  if (p + 8 > stsd.end) return;
  const size = dv.getUint32(p);
  const type = fourcc(b, p + 4);
  const end = Math.min(stsd.end, p + size);
  t.fourcc = type;
  t.codec = type;
  let childStart;
  if (VISUAL.has(type) || t.type === 'video') {
    t.width = dv.getUint16(p + 32);
    t.height = dv.getUint16(p + 34);
    t.bitDepth = 8;
    childStart = p + 86;
  } else if (AUDIO.has(type) || t.type === 'audio') {
    const ver = dv.getUint16(p + 16);
    t.channels = dv.getUint16(p + 24);
    t.sampleSize = dv.getUint16(p + 26);
    t.sampleRate = dv.getUint32(p + 32) / 65536;
    childStart = p + 36;
    if (ver === 1) childStart += 16;
    else if (ver === 2) {
      t.sampleRate = dv.getFloat64(p + 40);
      t.channels = dv.getUint32(p + 48);
      childStart += 36;
    }
  } else return;
  const kids = readBoxes(b, childStart, end, 3);
  const all = [...kids, ...kids.flatMap((k) => k.children || [])]; // QuickTime 'wave' wraps esds
  const get = (k) => all.find((x) => x.type === k);
  const body = (x) => b.subarray(x.start, x.end);
  try {
    if (type === 'avc1' || type === 'avc3') {
      const c = get('avcC');
      if (c) { const r = parseAvcC(body(c)); t.codec = r.codec.replace('avc1', type); t.description = body(c); t.bitDepth = r.bitDepth || 8; }
    } else if (type === 'hvc1' || type === 'hev1') {
      const c = get('hvcC');
      if (c) { const r = parseHvcC(body(c), type); t.codec = r.codec; t.description = body(c); t.bitDepth = r.bitDepth; }
    } else if (type === 'av01') {
      const c = get('av1C');
      if (c) { const r = parseAv1C(body(c)); t.codec = r.codec; t.description = body(c); t.bitDepth = r.bitDepth; }
    } else if (type === 'vp09' || type === 'vp08') {
      const c = get('vpcC');
      if (c) { const r = parseVpcC(body(c)); t.codec = type === 'vp08' ? 'vp8' : r.codec; t.bitDepth = r.bitDepth; } else t.codec = type === 'vp08' ? 'vp8' : 'vp09.00.10.08';
    } else if (type === 'mp4a') {
      const c = get('esds');
      if (c) {
        const r = parseEsds(body(c));
        t.codec = r.codec;
        if (r.asc) t.description = r.asc;
        if (r.sampleRate) t.sampleRate = r.sampleRate;
        if (r.channels) t.channels = r.channels;
        if (r.avgBitrate) t.declaredBitrate = r.avgBitrate;
      } else t.codec = 'mp4a.40.2';
    } else if (type === 'Opus') {
      const c = get('dOps');
      t.codec = 'opus';
      if (c) { const h = parseDOps(body(c)); t.description = opusHeadFromDOps(h); t.channels = h.channels; t.preSkip = h.preSkip; }
      t.sampleRate = 48000;
    } else if (type === 'fLaC') {
      const c = get('dfLa');
      t.codec = 'flac';
      if (c) { const blocks = b.subarray(c.start + 4, c.end); const d = new Uint8Array(4 + blocks.length); d.set([0x66, 0x4c, 0x61, 0x43]); d.set(blocks, 4); t.description = d; }
    } else if (type === '.mp3') t.codec = 'mp3';
    else if (type === 'ac-3') t.codec = 'ac-3';
    else if (type === 'ec-3') t.codec = 'ec-3';
    else if (type === 'ulaw') t.codec = 'ulaw';
    else if (type === 'alaw') t.codec = 'alaw';
    else if (['ipcm', 'sowt', 'twos', 'lpcm', 'in24', 'in32', 'fl32', 'fl64', 'raw '].includes(type)) t.codec = 'pcm';
  } catch { /* unknown record layout: keep the 4CC */ }
  const pasp = get('pasp');
  if (pasp) { t.pixelAspect = [dv.getUint32(pasp.start), dv.getUint32(pasp.start + 4)]; }
  const btrt = get('btrt');
  if (btrt) t.declaredBitrate = t.declaredBitrate || dv.getUint32(btrt.start + 8);
}

// Rebuilds per-sample records from the run-length tables: stsz (sizes), stco/co64 (chunk offsets), stsc (samples per
// chunk, as runs keyed by first chunk), stts (decode durations, runs), ctts (composition offsets, runs), stss (sync
// samples; absent = every sample is a keyframe). Samples the tables cannot place are dropped, not given offset 0.
function sampleTable(b, dv, stbl) {
  const get = (k) => stbl.children.find((x) => x.type === k);
  const stsz = get('stsz'), stz2 = get('stz2'), stco = get('stco'), co64 = get('co64'), stsc = get('stsc'), stts = get('stts'), ctts = get('ctts'), stss = get('stss');
  // sizes
  let sizes = [];
  if (stsz) {
    const fixed = dv.getUint32(stsz.start + 4), n = dv.getUint32(stsz.start + 8);
    if (fixed) sizes = new Array(n).fill(fixed);
    else { sizes = new Array(n); for (let i = 0; i < n; i++) sizes[i] = dv.getUint32(stsz.start + 12 + i * 4); }
  } else if (stz2) {
    const field = b[stz2.start + 7], n = dv.getUint32(stz2.start + 8);
    sizes = new Array(n);
    for (let i = 0; i < n; i++) {
      const o = stz2.start + 12;
      sizes[i] = field === 16 ? dv.getUint16(o + i * 2) : field === 8 ? b[o + i] : (b[o + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15;
    }
  }
  const n = sizes.length;
  if (!n) return [];
  // chunk offsets
  const offs = [];
  if (stco) { const c = dv.getUint32(stco.start + 4); for (let i = 0; i < c; i++) offs.push(dv.getUint32(stco.start + 8 + i * 4)); }
  else if (co64) { const c = dv.getUint32(co64.start + 4); for (let i = 0; i < c; i++) offs.push(dv.getUint32(co64.start + 8 + i * 8) * 4294967296 + dv.getUint32(co64.start + 12 + i * 8)); }
  // sample -> chunk
  const sc = [];
  if (stsc) { const c = dv.getUint32(stsc.start + 4); for (let i = 0; i < c; i++) { const o = stsc.start + 8 + i * 12; sc.push([dv.getUint32(o), dv.getUint32(o + 4)]); } }
  const samples = new Array(n);
  let s = 0;
  for (let e = 0; e < sc.length && s < n; e++) {
    const first = sc[e][0], per = sc[e][1];
    const last = e + 1 < sc.length ? sc[e + 1][0] : offs.length + 1;
    for (let ch = first; ch < last && s < n; ch++) {
      let o = offs[ch - 1];
      for (let k = 0; k < per && s < n; k++) { samples[s] = { offset: o, size: sizes[s], dts: 0, cts: 0, duration: 0, keyframe: !stss }; o += sizes[s]; s++; }
    }
  }
  for (; s < n; s++) samples[s] = { offset: 0, size: sizes[s], dts: 0, cts: 0, duration: 0, keyframe: !stss, missing: true };
  // timing
  let dts = 0, i = 0;
  if (stts) {
    const c = dv.getUint32(stts.start + 4);
    for (let e = 0; e < c; e++) {
      const cnt = dv.getUint32(stts.start + 8 + e * 8), delta = dv.getUint32(stts.start + 12 + e * 8);
      for (let k = 0; k < cnt && i < n; k++, i++) { samples[i].dts = dts; samples[i].cts = dts; samples[i].duration = delta; dts += delta; }
    }
  }
  if (ctts) {
    const v = b[ctts.start];
    const c = dv.getUint32(ctts.start + 4);
    i = 0;
    for (let e = 0; e < c; e++) {
      const cnt = dv.getUint32(ctts.start + 8 + e * 8);
      const off = v === 1 ? dv.getInt32(ctts.start + 12 + e * 8) : dv.getUint32(ctts.start + 12 + e * 8) | 0;
      for (let k = 0; k < cnt && i < n; k++, i++) samples[i].cts = samples[i].dts + off;
    }
  }
  if (stss) {
    const c = dv.getUint32(stss.start + 4);
    for (let e = 0; e < c; e++) { const k = dv.getUint32(stss.start + 8 + e * 4) - 1; if (samples[k]) samples[k].keyframe = true; }
  }
  return samples.filter((x) => !x.missing);
}

// Fragmented MP4 (MediaRecorder, DASH): samples live in moof/traf/trun runs. Defaults cascade trex -> tfhd -> trun;
// data offsets are relative to the moof (default-base-is-moof flag 0x20000) or to the end of the previous traf's data.
// Keyframe = sample_is_non_sync_sample bit (16) clear and sample_depends_on (bits 24-25) not "depends on others".
function readFragments(b, dv, top, tracks, trex) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const next = new Map(); // track id -> next decode time when tfdt is missing
  for (const moof of top.filter((x) => x.type === 'moof')) {
    let prevEnd = moof.offset;
    for (const traf of findAll(moof, 'traf')) {
      const tfhd = findBox(traf.children, 'tfhd');
      if (!tfhd) continue;
      const fl = dv.getUint32(tfhd.start) & 0xffffff;
      let p = tfhd.start + 4;
      const id = dv.getUint32(p); p += 4;
      const t = byId.get(id);
      const dflt = trex.get(id) || { duration: 0, size: 0, flags: 0 };
      let base = fl & 0x20000 ? moof.offset : prevEnd;
      if (fl & 1) { base = dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4); p += 8; }
      if (fl & 2) p += 4;
      let dDur = dflt.duration, dSize = dflt.size, dFlags = dflt.flags;
      if (fl & 8) { dDur = dv.getUint32(p); p += 4; }
      if (fl & 0x10) { dSize = dv.getUint32(p); p += 4; }
      if (fl & 0x20) { dFlags = dv.getUint32(p); p += 4; }
      const tfdt = findBox(traf.children, 'tfdt');
      let time = next.get(id) || 0;
      if (tfdt) time = b[tfdt.start] === 1 ? dv.getUint32(tfdt.start + 4) * 4294967296 + dv.getUint32(tfdt.start + 8) : dv.getUint32(tfdt.start + 4);
      for (const trun of findAll(traf, 'trun')) {
        const v = b[trun.start];
        const tf = dv.getUint32(trun.start) & 0xffffff;
        const count = dv.getUint32(trun.start + 4);
        let q = trun.start + 8;
        let off = base;
        if (tf & 1) { off = base + dv.getInt32(q); q += 4; }
        let firstFlags = null;
        if (tf & 4) { firstFlags = dv.getUint32(q); q += 4; }
        for (let k = 0; k < count; k++) {
          const dur = tf & 0x100 ? dv.getUint32((q += 4) - 4) : dDur;
          const size = tf & 0x200 ? dv.getUint32((q += 4) - 4) : dSize;
          let flags = tf & 0x400 ? dv.getUint32((q += 4) - 4) : dFlags;
          if (k === 0 && firstFlags != null) flags = firstFlags;
          const cto = tf & 0x800 ? (v === 1 ? dv.getInt32((q += 4) - 4) : dv.getUint32((q += 4) - 4)) : 0;
          if (t) t.samples.push({ offset: off, size, dts: time, cts: time + cto, duration: dur, keyframe: !((flags >> 16) & 1) && ((flags >> 24) & 3) !== 1 });
          off += size;
          time += dur;
        }
        prevEnd = off;
      }
      next.set(id, time);
    }
  }
}

// timestamp / durationUs are in microseconds, the unit WebCodecs EncodedVideoChunk expects. The header duration is
// replaced by the measured one when it is implausible (off by more than 4x): some writers leave garbage there.
function finishTrack(t, b, fragmented) {
  if (!t.samples) return;
  const ts = t.timescale || 1;
  let bytes = 0, maxEnd = 0, minCts = Infinity;
  for (const s of t.samples) { if (s.cts < minCts) minCts = s.cts; }
  // The first edit's media time shifts the presentation (B-frame delay, AAC priming).
  const shift = t.edits?.length && t.edits[0].mediaTime >= 0 ? t.edits[0].mediaTime : t.edits?.length > 1 && t.edits[0].mediaTime === -1 && t.edits[1].mediaTime >= 0 ? t.edits[1].mediaTime : 0;
  for (const s of t.samples) {
    s.timestamp = Math.round(((s.cts - shift) * 1e6) / ts);
    s.durationUs = Math.round((s.duration * 1e6) / ts);
    s.data = s.offset + s.size <= b.length ? b.subarray(s.offset, s.offset + s.size) : null;
    bytes += s.size;
    maxEnd = Math.max(maxEnd, s.cts + s.duration);
  }
  if (t.samples.length) {
    const d = (maxEnd - (Number.isFinite(minCts) ? minCts : 0)) / ts;
    if (fragmented || !t.duration || t.duration > d * 4 + 1 || t.duration < d / 4) t.duration = d;
    if (t.duration) t.bitrate = Math.round((bytes * 8) / t.duration);
    if (t.type === 'video' && t.duration) t.frameRate = Math.round((t.samples.length / t.duration) * 1000) / 1000;
  }
  t.bytes = bytes;
  t.codecName = codecName(t.codec);
}

// iTunes-style metadata (moov/udta/meta/ilst) and QuickTime udta text atoms.
const ILST = {
  '\xa9nam': 'title', '\xa9ART': 'artist', aART: 'albumArtist', '\xa9alb': 'album', '\xa9day': 'date', '\xa9gen': 'genre',
  '\xa9cmt': 'comment', '\xa9too': 'encoder', '\xa9wrt': 'composer', desc: 'description', cprt: 'copyright', '\xa9lyr': 'lyrics',
};
function readMetadata(b, dv, moov, out) {
  const udta = findBox(moov.children, 'udta');
  if (!udta) return;
  const dec = new TextDecoder();
  const ilst = findBox(udta.children, 'meta/ilst');
  for (const item of ilst?.children || []) {
    const data = (item.children || []).find((x) => x.type === 'data');
    if (!data) continue;
    const type = dv.getUint32(data.start) & 0xffffff;
    const payload = b.subarray(data.start + 8, data.end);
    if (item.type === 'covr') { out.cover = { mime: type === 14 ? 'image/png' : 'image/jpeg', data: payload }; continue; }
    if (item.type === 'trkn' && payload.length >= 6) { out.metadata.track = String((payload[2] << 8) | payload[3]); continue; }
    if (item.type === 'gnre' && payload.length >= 2) { out.metadata.genre ||= String((payload[0] << 8) | payload[1]); continue; }
    const key = ILST[item.type];
    if (key && (type === 1 || type === 0)) out.metadata[key] = dec.decode(payload);
  }
  for (const x of udta.children || []) {
    const key = ILST[x.type];
    if (!key || out.metadata[key] || x.end - x.start < 4) continue;
    const len = dv.getUint16(x.start);
    out.metadata[key] = dec.decode(b.subarray(x.start + 4, Math.min(x.end, x.start + 4 + len)));
  }
}

/** WebCodecs decoder config of a track: { codec, description?, codedWidth, codedHeight } or { codec, sampleRate, numberOfChannels, description? }. */
// description only for codecs whose decoders need out-of-band configuration (avcC / hvcC / av1C); VP9 is
// self-describing in its frames, and some decoders reject an unexpected description.
export function decoderConfig(track) {
  if (track.type === 'video') {
    const c = { codec: track.codec, codedWidth: track.width, codedHeight: track.height };
    if (track.description && /^(avc|hvc|hev|av01)/.test(track.codec)) c.description = track.description;
    return c;
  }
  const c = { codec: track.codec, sampleRate: track.sampleRate, numberOfChannels: track.channels };
  if (track.description) c.description = track.description;
  return c;
}
