// webm/fix.js - makes MediaRecorder WebM output seekable: rewrites the segment with known element sizes, adds the
// Info Duration, a SeekHead and Cues. Blocks are copied byte for byte (no re-encoding).
//
// Why rewriting is needed: MediaRecorder streams WebM with unknown sizes and no Duration or Cues, so players show no
// length and cannot seek. Rebuilding the segment with known sizes and an index fixes both without touching the
// encoded frames.
import { ID, LEVEL1, children, concat, el, elFloat, elUint, encodeId, encodeSize, readHeader, readUint } from './ebml.js';
import { parseWebm } from './demux.js';

const asBytes = (b) => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const KEEP = new Set([ID.Tags, ID.Chapters, ID.Attachments]);

/**
 * Rewrites a (live, unknown-size) WebM file into a seekable one.
 *   opts.duration  seconds (overrides the duration computed from the frames)
 * Returns { bytes, duration (s), clusters, cues, changed }.
 */
export function fixWebm(input, opts = {}) {
  const b = asBytes(input);
  const parsed = parseWebm(b);
  const ebml = readHeader(b, 0);
  let p = ebml.end, seg = null;
  while (p < b.length) {
    const h = readHeader(b, p);
    if (!h) break;
    if (h.id === ID.Segment) { seg = h; break; }
    if (h.size < 0) break;
    p = h.end;
  }
  if (!seg) throw new Error('fixWebm: no Segment');
  const segEnd = seg.size < 0 ? b.length : Math.min(b.length, seg.end);
  const scale = parsed.info.timestampScale || 1000000;
  const video = parsed.tracks.find((t) => t.type === 'video');
  const cueTrack = (video || parsed.tracks[0])?.number || 1;
  let infoChildren = [], tracksRaw = null;
  const extra = [];
  const clusters = []; // { ts, parts: [raw child elements], key }
  let q = seg.start;
  while (q < segEnd) {
    const h = readHeader(b, q, segEnd);
    if (!h) break;
    if (h.id === ID.Cluster) {
      const limit = h.size < 0 ? segEnd : h.end;
      const c = { ts: 0, parts: [], cue: false };
      let r = h.start;
      while (r < limit) {
        const x = readHeader(b, r, limit);
        if (!x) { r = limit; break; }
        if (h.size < 0 && (LEVEL1.has(x.id) || x.id === ID.EBML)) break;
        if (x.size < 0 || x.start + x.size > b.length) { r = limit; break; } // truncated tail
        if (x.id === ID.Timestamp) c.ts = readUint(b, x.start, x.end);
        else if (x.id === ID.SimpleBlock || x.id === ID.BlockGroup) {
          c.parts.push(b.subarray(x.offset, x.end));
          if (!c.cue && isCueBlock(b, x, cueTrack, !!video)) c.cue = true;
        }
        r = x.end;
      }
      if (c.parts.length) clusters.push(c);
      q = h.size < 0 ? r : h.end;
      continue;
    }
    if (h.size < 0) break;
    if (h.id === ID.Info) {
      for (const c of children(b, h.start, h.end)) if (c.id !== ID.Duration && c.id !== ID.Void && c.id !== ID.CRC32) infoChildren.push(b.subarray(c.offset, c.end));
    } else if (h.id === ID.Tracks) tracksRaw = b.subarray(h.offset, h.end);
    else if (KEEP.has(h.id)) extra.push(b.subarray(h.offset, h.end));
    q = h.end;
  }
  if (!tracksRaw) throw new Error('fixWebm: no Tracks');
  const duration = opts.duration > 0 ? opts.duration : parsed.framesDuration || parsed.duration;
  const info = el(ID.Info, infoChildren, elFloat(ID.Duration, (duration * 1e9) / scale));
  const clusterEls = clusters.map((c) => {
    const ts = elUint(ID.Timestamp, c.ts);
    const size = ts.length + c.parts.reduce((n, x) => n + x.length, 0);
    // Cluster header and the original block bytes are kept as separate parts: one final concat, no per-cluster copy.
    return [concat([encodeId(ID.Cluster), encodeSize(size, 8), ts]), ...c.parts];
  });
  const seekEntry = (id, pos) => el(ID.Seek, el(ID.SeekID, encodeId(id)), elUint(ID.SeekPosition, pos, 8));
  // Two-pass layout: SeekPosition is written with a fixed 8-byte width, so the SeekHead's length is known before the
  // real offsets are, and every later position can be computed in one pass.
  const seekLen = el(ID.SeekHead, seekEntry(ID.Info, 0), seekEntry(ID.Tracks, 0), seekEntry(ID.Cues, 0)).length;
  const infoPos = seekLen, tracksPos = infoPos + info.length;
  let pos = tracksPos + tracksRaw.length;
  for (const x of extra) pos += x.length;
  const cuePoints = [];
  clusterEls.forEach((parts, i) => {
    if (clusters[i].cue) cuePoints.push(el(ID.CuePoint, elUint(ID.CueTime, clusters[i].ts), el(ID.CueTrackPositions, elUint(ID.CueTrack, cueTrack), elUint(ID.CueClusterPosition, pos))));
    for (const x of parts) pos += x.length;
  });
  // A file without keyframe clusters still gets a cue for its first cluster.
  if (!cuePoints.length && clusters.length) cuePoints.push(el(ID.CuePoint, elUint(ID.CueTime, clusters[0].ts), el(ID.CueTrackPositions, elUint(ID.CueTrack, cueTrack), elUint(ID.CueClusterPosition, tracksPos + tracksRaw.length + extra.reduce((n, x) => n + x.length, 0)))));
  const cues = el(ID.Cues, cuePoints);
  const seekHead = el(ID.SeekHead, seekEntry(ID.Info, infoPos), seekEntry(ID.Tracks, tracksPos), seekEntry(ID.Cues, pos));
  const segSize = pos + cues.length;
  const bytes = concat([b.subarray(0, ebml.end), encodeId(ID.Segment), encodeSize(segSize, 8), seekHead, info, tracksRaw, ...extra, ...clusterEls.flat(), cues]);
  return { bytes, duration, clusters: clusters.length, cues: cuePoints.length, changed: !parsed.hasDuration || !parsed.hasCues || seg.size < 0 };
}

// Does this block start a seek point: a keyframe of the cue track (any block of an audio-only file)?
// Keyframe test: SimpleBlock flag 0x80, or a BlockGroup without ReferenceBlock. The track number is read as a
// 1-byte vint (< 127), which covers every MediaRecorder file.
function isCueBlock(b, x, track, hasVideo) {
  let p = x.start;
  let blockStart = p;
  if (x.id === ID.BlockGroup) {
    let blk = null, ref = false;
    for (const c of children(b, x.start, x.end)) { if (c.id === ID.Block) blk = c; else if (c.id === ID.ReferenceBlock) ref = true; }
    if (!blk || ref) return false;
    blockStart = blk.start;
  }
  const tn = b[blockStart] & 0x7f; // track numbers below 127 (1-byte vint)
  if (tn !== track) return false;
  if (!hasVideo) return true;
  return x.id === ID.BlockGroup || !!(b[blockStart + 3] & 0x80);
}
