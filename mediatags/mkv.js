// mediatags/mkv.js - Matroska / WebM metadata on webm/ebml.js without reading the clusters: the EBML header, the
// level-1 elements before the first Cluster and everything the SeekHead(s) point to (Info, Tracks, Tags, Chapters,
// Attachments), each element read on its own and bounded; attachment data only for small images.
//
//   readMatroskaMeta(src | bytes, opts) -> Promise<meta>        readMatroskaMetaSync(bytes, opts) -> meta
//   matroskaFlow(size, opts) -> reader flow (source.js) giving meta
//     opts { data: 'images' (default: images <= maxImage) | 'cover' (only the cover attachment) | 'none',
//            maxElement = 16 MB, maxImage = 8 MB, tail = true (no Duration: estimate it from the last Cluster) }
//   meta = { docType, title, duration (s) | null, durationEstimated, timestampScale, muxingApp, writingApp, date,
//     tracks: [{ number, uid (hex), type ('video' | 'audio' | 'subtitle' | 'complex' | 'logo' | 'buttons' | 'control' |
//       'metadata'), codecId, codec (short id: h264 hevc av1 vp8 vp9 mpeg4 mpeg2 theora aac opus vorbis flac mp3 ac3
//       eac3 dts truehd pcm alac srt ass ssa vtt pgs vobsub ...), codecName, lang (Language, default 'eng'; BCP 47
//       when given), name, default, forced, hearingImpaired, commentary, enabled, width, height, displayWidth,
//       displayHeight, fps, sampleRate, channels, bitDepth }],
//     tags: [{ targetType (TargetTypeValue, default 50), targetTypeName?, targetTrackUid?, targetTrackUids?,
//       targetChapterUid?, targetEditionUid?, targetAttachmentUid?, simple: { NAME: value } (first value; nested
//       SimpleTags as 'PARENT/CHILD'), list: [[NAME, value, lang]] }],
//     chapters: [{ start, end, title, lang, uid }] (the default edition, else the first; top-level atoms that are not
//       hidden; end from ChapterTimeEnd, else the next start, else the duration),
//     attachments: [{ name, mime, size, description, uid, offset, data? }], warnings: [] }
//   matroskaPairs(meta) -> [[KEY, value]] in the fields.js vocabulary (track-level tags 30, album 50, season 60,
//     collection 70; TV shows from 70 TITLE / 60 PART_NUMBER / 50 PART_NUMBER; tags without level 30 map directly)
//   coverAttachment(attachments) -> index of the cover (cover.*, cover_land.*, small_cover.*, names with cover /
//     front / folder / poster, then the first image) or -1
//   MKV                              element ids (webm/ebml.js ID plus chapters, tags, attachments, track flags)
//   matroskaCodec(codecId) -> short codec id

//
// EBML in one paragraph: every element is [variable-length id][variable-length size][body]; the leading-zero count
// of the first byte gives the field width (1..4 bytes for ids, 1..8 for sizes). An all-ones size means 'unknown'
// (live streams), so the element runs to its parent's end. Ids keep their length marker bits (0x1A45DFA3).
// Strategy: metadata elements (Info, Tracks, Tags, Chapters, Attachments) are small and either precede the first
// Cluster or are indexed by a SeekHead; Clusters (the media) can be gigabytes. We read element HEADERS (12 bytes) to
// navigate and only the bodies we parse, each capped, so a 40 GB remux costs a few dozen small reads. The SeekHead
// is essential because mkvmerge and others write Tags / Cues after the clusters.
import { ID, children, readFloat, readHeader, readId, readInt, readSize, readString, readUint } from '../webm/ebml.js';
import { asBytes, asSource, cachedSource, runAsync, runSync } from './source.js';

// Ids not covered by webm/ebml.js (WebM subset); values from the Matroska specification (RFC 9559).
export const MKV = {
  ...ID,
  FlagHearingImpaired: 0x55ab, FlagVisualImpaired: 0x55ac, FlagOriginal: 0x55ae, FlagCommentary: 0x55af,
  EditionEntry: 0x45b9, EditionUID: 0x45bc, EditionFlagHidden: 0x45bd, EditionFlagDefault: 0x45db, EditionFlagOrdered: 0x45dd,
  ChapterAtom: 0xb6, ChapterUID: 0x73c4, ChapterStringUID: 0x5654, ChapterTimeStart: 0x91, ChapterTimeEnd: 0x92,
  ChapterFlagHidden: 0x98, ChapterFlagEnabled: 0x4598, ChapterDisplay: 0x80, ChapString: 0x85, ChapLanguage: 0x437c,
  ChapLanguageBCP47: 0x437d,
  TargetTypeValue: 0x68ca, TargetType: 0x63ca, TagTrackUID: 0x63c5, TagEditionUID: 0x63c9, TagChapterUID: 0x63c4,
  TagAttachmentUID: 0x63c6, TagLanguageBCP47: 0x447b, TagDefault: 0x4484, TagBinary: 0x4485,
  AttachedFile: 0x61a7, FileDescription: 0x467e, FileName: 0x466e, FileMediaType: 0x4660, FileData: 0x465c, FileUID: 0x46ae,
};

// TrackType values (RFC 9559 5.1.4.1.3).
const TRACK_TYPES = { 1: 'video', 2: 'audio', 3: 'complex', 0x10: 'logo', 0x11: 'subtitle', 0x12: 'buttons', 0x20: 'control', 0x21: 'metadata' };

// CodecID prefixes -> short ids. Order matters where prefixes nest: V_MPEG4/ISO/AVC must precede the generic
// V_MPEG4/ISO/ (ASP), and A_EAC3 precedes A_AC3 (which would not match it anyway, but keeps intent explicit).
const CODECS = [
  [/^V_MPEG4\/ISO\/AVC/, 'h264'], [/^V_MPEGH\/ISO\/HEVC/, 'hevc'], [/^V_AV1/, 'av1'], [/^V_VP8/, 'vp8'], [/^V_VP9/, 'vp9'],
  [/^V_MPEG4\/ISO\//, 'mpeg4'], [/^V_MPEG4\/MS/, 'msmpeg4'], [/^V_MPEG2/, 'mpeg2'], [/^V_MPEG1/, 'mpeg1'], [/^V_THEORA/, 'theora'],
  [/^V_MJPEG/, 'mjpeg'], [/^V_PRORES/, 'prores'], [/^V_REAL/, 'real'], [/^V_MS\/VFW/, 'vfw'], [/^V_FFV1/, 'ffv1'],
  [/^A_AAC/, 'aac'], [/^A_OPUS/, 'opus'], [/^A_VORBIS/, 'vorbis'], [/^A_FLAC/, 'flac'], [/^A_MPEG\/L3/, 'mp3'], [/^A_MPEG\/L2/, 'mp2'],
  [/^A_EAC3/, 'eac3'], [/^A_AC3/, 'ac3'], [/^A_DTS/, 'dts'], [/^A_TRUEHD/, 'truehd'], [/^A_PCM/, 'pcm'], [/^A_ALAC/, 'alac'],
  [/^A_WAVPACK/, 'wavpack'], [/^A_TTA/, 'tta'], [/^A_MS\/ACM/, 'acm'], [/^A_REAL/, 'real'],
  [/^S_TEXT\/UTF8/, 'srt'], [/^S_TEXT\/ASCII/, 'srt'], [/^S_TEXT\/ASS/, 'ass'], [/^S_ASS/, 'ass'], [/^S_TEXT\/SSA/, 'ssa'], [/^S_SSA/, 'ssa'],
  [/^S_TEXT\/WEBVTT/, 'vtt'], [/^D_WEBVTT/, 'vtt'], [/^S_HDMV\/PGS/, 'pgs'], [/^S_VOBSUB/, 'vobsub'], [/^S_DVBSUB/, 'dvbsub'],
  [/^S_HDMV\/TEXTST/, 'textst'], [/^S_TEXT\/USF/, 'usf'], [/^S_KATE/, 'kate'],
];

export function matroskaCodec(id) {
  for (const [re, name] of CODECS) if (re.test(id || '')) return name;
  return (id || '').toLowerCase() || null;
}

// UIDs are up to 64-bit unsigned: rendered as hex strings, never Numbers (2^53 would silently corrupt them and two
// distinct UIDs could compare equal). Leading zeros stripped so equal values from different widths match.
const uidHex = (b, s, e) => {
  let h = '';
  for (let i = s; i < e; i++) h += b[i].toString(16).padStart(2, '0');
  return h.replace(/^0+(?=.)/, '') || '0';
};

// 12 bytes = the maximum id (4) plus the maximum size field (8). end is clamped to the parent limit, so a lying size
// cannot make later reads leave the parent; unknown size (-1) extends to the limit.
// Element header at p from a small read: { id, size (-1 unknown), offset, start, end } or null.
function* hdr(p, limit) {
  if (p >= limit) return null;
  const b = yield [p, 12];
  const id = readId(b, 0);
  if (!id) return null;
  const sz = readSize(b, id.length);
  if (!sz) return null;
  const start = p + id.length + sz.length;
  return { id: id.id, size: sz.value, offset: p, start, end: sz.value < 0 ? limit : Math.min(limit, start + sz.value) };
}

// Body read with a cap: returns null (caller warns) instead of pulling an oversized element.
function* body(h, max) {
  if (h.end - h.start > max) return null;
  return yield [h.start, h.end - h.start];
}

// Duration is a float in TimestampScale units (default 1 ms = 1e6 ns). DateUTC is a signed ns offset from the
// Matroska epoch 2001-01-01T00:00:00Z, hence the /1e6 to milliseconds for Date.
function parseInfo(b, out) {
  let dur = null;
  for (const c of children(b, 0, b.length)) {
    if (c.id === ID.TimestampScale) out.timestampScale = readUint(b, c.start, c.end) || 1000000;
    else if (c.id === ID.Duration) dur = readFloat(b, c.start, c.end);
    else if (c.id === ID.Title) out.title = readString(b, c.start, c.end);
    else if (c.id === ID.MuxingApp) out.muxingApp = readString(b, c.start, c.end);
    else if (c.id === ID.WritingApp) out.writingApp = readString(b, c.start, c.end);
    else if (c.id === ID.DateUTC) out.date = new Date(Date.UTC(2001, 0, 1) + readInt(b, c.start, c.end) / 1e6);
  }
  if (dur != null && dur > 0) out.duration = (dur * out.timestampScale) / 1e9;
}

// Defaults follow the spec, not zero values: Language defaults to 'eng', FlagDefault / FlagEnabled to 1. Channels
// default to 1 per spec. LanguageBCP47, when present, overrides the legacy ISO 639-2 Language. OutputSamplingFrequency
// wins over SamplingFrequency (HE-AAC / SBR: the core runs at half the output rate).
function parseTracks(b) {
  const tracks = [];
  for (const te of children(b, 0, b.length)) {
    if (te.id !== ID.TrackEntry) continue;
    const t = {
      number: 0, uid: null, type: 'unknown', codecId: '', codec: null, codecName: null, lang: 'eng', name: null, default: true, forced: false,
      hearingImpaired: false, commentary: false, enabled: true,
    };
    let bcp = null, dd = 0;
    for (const c of children(b, te.start, te.end)) {
      const u = () => readUint(b, c.start, c.end);
      switch (c.id) {
        case ID.TrackNumber: t.number = u(); break;
        case ID.TrackUID: t.uid = uidHex(b, c.start, c.end); break;
        case ID.TrackType: t.type = TRACK_TYPES[u()] || 'unknown'; break;
        case ID.CodecID: t.codecId = readString(b, c.start, c.end); break;
        case ID.CodecName: t.codecName = readString(b, c.start, c.end); break;
        case ID.Name: t.name = readString(b, c.start, c.end); break;
        case ID.Language: t.lang = readString(b, c.start, c.end); break;
        case ID.LanguageBCP47: bcp = readString(b, c.start, c.end); break;
        case ID.FlagDefault: t.default = !!u(); break;
        case ID.FlagForced: t.forced = !!u(); break;
        case ID.FlagEnabled: t.enabled = !!u(); break;
        case MKV.FlagHearingImpaired: t.hearingImpaired = !!u(); break;
        case MKV.FlagCommentary: t.commentary = !!u(); break;
        case ID.DefaultDuration: dd = u(); break;
        case ID.Video:
          for (const v of children(b, c.start, c.end)) {
            const vu = () => readUint(b, v.start, v.end);
            if (v.id === ID.PixelWidth) t.width = vu();
            else if (v.id === ID.PixelHeight) t.height = vu();
            else if (v.id === ID.DisplayWidth) t.displayWidth = vu();
            else if (v.id === ID.DisplayHeight) t.displayHeight = vu();
            else if (v.id === ID.FrameRate) t.fps = Math.round(readFloat(b, v.start, v.end) * 1000) / 1000;
          }
          break;
        case ID.Audio: {
          let out = null;
          for (const a of children(b, c.start, c.end)) {
            if (a.id === ID.SamplingFrequency) t.sampleRate = readFloat(b, a.start, a.end);
            else if (a.id === ID.OutputSamplingFrequency) out = readFloat(b, a.start, a.end);
            else if (a.id === ID.Channels) t.channels = readUint(b, a.start, a.end);
            else if (a.id === ID.BitDepth) t.bitDepth = readUint(b, a.start, a.end);
          }
          if (out) t.sampleRate = out;
          if (t.sampleRate) t.sampleRate = Math.round(t.sampleRate);
          if (!t.channels) t.channels = 1;
          break;
        }
        default:
      }
    }
    if (bcp) t.lang = bcp;
    t.codec = matroskaCodec(t.codecId);
    // DefaultDuration is ns per frame: fps = 1e9 / dd. FrameRate (deprecated) wins when present.
    if (t.type === 'video' && dd && !t.fps) t.fps = Math.round((1e9 / dd) * 1000) / 1000;
    tracks.push(t);
  }
  return tracks;
}

// Each Tag has Targets (TargetTypeValue: 70 collection, 60 season/volume, 50 album/movie, 30 track/chapter, ... ;
// default 50 per spec) and SimpleTags, which nest (e.g. ARTIST/SORT_WITH). Nested names are flattened 'PARENT/CHILD'.
// UID 0 in a target means 'all', so it is treated as no target.
function parseTags(b) {
  const tags = [];
  for (const tag of children(b, 0, b.length)) {
    if (tag.id !== ID.Tag) continue;
    const t = { targetType: 50, simple: {}, list: [] };
    const trackUids = [];
    const simple = (start, end, prefix) => {
      for (const st of children(b, start, end)) {
        if (st.id !== ID.SimpleTag) continue;
        let name = '', value = null, lang = 'und';
        const nested = [];
        for (const x of children(b, st.start, st.end)) {
          if (x.id === ID.TagName) name = readString(b, x.start, x.end);
          else if (x.id === ID.TagString) value = readString(b, x.start, x.end);
          else if (x.id === ID.TagLanguage || x.id === MKV.TagLanguageBCP47) lang = readString(b, x.start, x.end);
          else if (x.id === ID.SimpleTag) nested.push(x);
        }
        const key = prefix + name.toUpperCase();
        if (name && value != null) {
          t.list.push([key, value, lang]);
          if (!(key in t.simple)) t.simple[key] = value;
        }
        if (nested.length) simple(st.start, st.end, key + '/');
      }
    };
    for (const c of children(b, tag.start, tag.end)) {
      if (c.id === ID.Targets) {
        for (const x of children(b, c.start, c.end)) {
          if (x.id === MKV.TargetTypeValue) t.targetType = readUint(b, x.start, x.end);
          else if (x.id === MKV.TargetType) t.targetTypeName = readString(b, x.start, x.end).toUpperCase();
          else if (x.id === MKV.TagTrackUID) { const u = uidHex(b, x.start, x.end); if (u !== '0') trackUids.push(u); }
          else if (x.id === MKV.TagChapterUID) { const u = uidHex(b, x.start, x.end); if (u !== '0') t.targetChapterUid = u; }
          else if (x.id === MKV.TagEditionUID) { const u = uidHex(b, x.start, x.end); if (u !== '0') t.targetEditionUid = u; }
          else if (x.id === MKV.TagAttachmentUID) { const u = uidHex(b, x.start, x.end); if (u !== '0') t.targetAttachmentUid = u; }
        }
      }
    }
    simple(tag.start, tag.end, '');
    if (trackUids.length) { t.targetTrackUid = trackUids[0]; if (trackUids.length > 1) t.targetTrackUids = trackUids; }
    tags.push(t);
  }
  return tags;
}

// Edition choice: the default non-hidden edition, else the first non-hidden, else the first. Only top-level
// ChapterAtoms (nested atoms are sub-chapters, not shown in flat lists). Hidden or disabled atoms are skipped. Times
// are ns regardless of TimestampScale. Only the first ChapterDisplay is used for the title (one language).
function parseChapters(b) {
  const editions = [];
  for (const ed of children(b, 0, b.length)) {
    if (ed.id !== MKV.EditionEntry) continue;
    const e = { default: false, hidden: false, atoms: [] };
    for (const c of children(b, ed.start, ed.end)) {
      if (c.id === MKV.EditionFlagDefault) e.default = !!readUint(b, c.start, c.end);
      else if (c.id === MKV.EditionFlagHidden) e.hidden = !!readUint(b, c.start, c.end);
      else if (c.id === MKV.ChapterAtom) {
        const a = { start: 0, end: null, title: '', lang: null, uid: null, hidden: false, enabled: true };
        for (const x of children(b, c.start, c.end)) {
          if (x.id === MKV.ChapterTimeStart) a.start = readUint(b, x.start, x.end) / 1e9;
          else if (x.id === MKV.ChapterTimeEnd) a.end = readUint(b, x.start, x.end) / 1e9;
          else if (x.id === MKV.ChapterUID) a.uid = uidHex(b, x.start, x.end);
          else if (x.id === MKV.ChapterFlagHidden) a.hidden = !!readUint(b, x.start, x.end);
          else if (x.id === MKV.ChapterFlagEnabled) a.enabled = !!readUint(b, x.start, x.end);
          else if (x.id === MKV.ChapterDisplay && !a.title) {
            for (const d of children(b, x.start, x.end)) {
              if (d.id === MKV.ChapString) a.title = readString(b, d.start, d.end);
              else if (d.id === MKV.ChapLanguage || d.id === MKV.ChapLanguageBCP47) a.lang = readString(b, d.start, d.end);
            }
          }
        }
        if (!a.hidden && a.enabled) e.atoms.push(a);
      }
    }
    editions.push(e);
  }
  const ed = editions.find((e) => e.default && !e.hidden) || editions.find((e) => !e.hidden) || editions[0];
  if (!ed) return [];
  const atoms = ed.atoms.sort((x, y) => x.start - y.start);
  return atoms.map(({ start, end, title, lang, uid }) => ({ start, end, title, lang, uid }));
}

// Ranking follows the Matroska attachment naming convention (cover.jpg, cover_land.jpg, small_cover.jpg), then
// common names, then any image. Strict '<' keeps the earliest attachment among equals.
/** Index of the cover image among attachments, -1 when there is none. */
export function coverAttachment(atts) {
  const isImg = (a) => /^image\//.test(a.mime || '') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(a.name || '');
  const rank = (a) => {
    const n = (a.name || '').toLowerCase();
    if (/^cover\.\w+$/.test(n)) return 0;
    if (/^cover_land\.\w+$/.test(n)) return 1;
    if (/^small_cover/.test(n)) return 2;
    if (/cover|front|folder|poster/.test(n)) return 3;
    return 4;
  };
  let best = -1;
  atts.forEach((a, i) => { if (isImg(a) && (best < 0 || rank(a) < rank(atts[best]))) best = i; });
  return best;
}

// Used when Info has no Duration (live captures, some WebM recorders). Scans backwards for the Cluster id; requiring
// the Timestamp child right after the header rejects random matches inside block data. The block relative timestamp
// is a signed 16-bit after the track-number vint. The result ignores the last frame's own duration (slight underestimate),
// hence durationEstimated.
// Duration estimate from the last Cluster: its Timestamp + the largest block offset in it.
function tailDuration(t, scale) {
  for (let i = t.length - 4; i >= 0; i--) {
    if (t[i] !== 0x1f || t[i + 1] !== 0x43 || t[i + 2] !== 0xb6 || t[i + 3] !== 0x75) continue;
    const h = readHeader(t, i);
    if (!h || t[h.start] !== ID.Timestamp) continue; // muxers write the cluster Timestamp first
    let ts = null, maxRel = 0;
    const scan = (start, end) => {
      for (const c of children(t, start, end)) {
        if (c.id === ID.Timestamp) ts = readUint(t, c.start, c.end);
        else if (c.id === ID.SimpleBlock || c.id === ID.Block) {
          const v = readSize(t, c.start);
          if (v && c.start + v.length + 2 <= t.length) maxRel = Math.max(maxRel, ((t[c.start + v.length] << 24) >> 16) | t[c.start + v.length + 1]);
        } else if (c.id === ID.BlockGroup) scan(c.start, c.end);
        if (c.size < 0) break;
      }
    };
    scan(h.start, h.end);
    if (ts != null) return ((ts + maxRel) * scale) / 1e9;
  }
  return null;
}

// Level-1 elements we parse; everything else (Cues, Clusters, Void) is skipped by header.
const WANTED = [ID.Info, ID.Tracks, ID.Tags, ID.Chapters, ID.Attachments];

/** Reader flow of Matroska metadata (see the header). */
export function* matroskaFlow(size, { data = 'images', maxElement = 16 << 20, maxImage = 8 << 20, tail = true } = {}) {
  const out = {
    docType: 'matroska', title: null, duration: null, durationEstimated: false, timestampScale: 1000000, muxingApp: null, writingApp: null,
    date: null, tracks: [], tags: [], chapters: [], attachments: [], warnings: [],
  };
  // The EBML header is tiny; 4 KB also covers any leading junk elements. DocType tells 'webm' from 'matroska'.
  const head = yield [0, 4096];
  const eh = readHeader(head, 0);
  if (!eh || eh.id !== ID.EBML) throw new Error('not a Matroska / WebM file');
  for (const c of children(head, eh.start, Math.min(eh.end, head.length))) if (c.id === ID.DocType) out.docType = readString(head, c.start, c.end);
  let p = eh.end, seg = null;
  for (let i = 0; i < 16 && p < size; i++) {
    const h = yield* hdr(p, size);
    if (!h) break;
    if (h.id === ID.Segment) { seg = h; break; }
    if (h.size < 0) break;
    p = h.end;
  }
  if (!seg) throw new Error('Matroska: no Segment');
  // SeekPosition values are relative to the Segment body start, not the file. Positions are collected per id because
  // a file may legitimately hold several Tags elements (one indexed, one before clusters).
  const segStart = seg.start, segEnd = seg.size < 0 ? size : Math.min(size, seg.end);
  const found = new Map();
  const add = (id, pos) => { if (!found.has(id)) found.set(id, []); const l = found.get(id); if (!l.includes(pos)) l.push(pos); };
  // level-1 elements before the first Cluster
  let q = segStart;
  for (let i = 0; i < 512 && q < segEnd; i++) {
    const h = yield* hdr(q, segEnd);
    if (!h || h.id === ID.Cluster) break;
    if (WANTED.includes(h.id) || h.id === ID.SeekHead) add(h.id, q);
    if (h.size < 0) break;
    q = h.end;
  }
  // At most 4 rounds of SeekHead indirection: real files use 1 or 2; the bound and the done-set stop cycles.
  // seek heads (a seek head may point to another one, usually at the end)
  const done = new Set();
  for (let round = 0; round < 4; round++) {
    const heads = (found.get(ID.SeekHead) || []).filter((x) => !done.has(x));
    if (!heads.length) break;
    for (const pos of heads) {
      done.add(pos);
      const h = yield* hdr(pos, segEnd);
      if (!h || h.id !== ID.SeekHead) { out.warnings.push('SeekHead entry points to nothing'); continue; }
      const b = yield* body(h, 1 << 20);
      if (!b) continue;
      for (const s of children(b, 0, b.length)) {
        if (s.id !== ID.Seek) continue;
        let id = 0, position = -1;
        for (const c of children(b, s.start, s.end)) {
          if (c.id === ID.SeekID) id = readUint(b, c.start, c.end);
          else if (c.id === ID.SeekPosition) position = readUint(b, c.start, c.end);
        }
        if (position >= 0 && (WANTED.includes(id) || id === ID.SeekHead) && segStart + position < segEnd) add(id, segStart + position);
      }
    }
  }
  if (!found.has(ID.SeekHead) && !found.has(ID.Tags)) out.warnings.push('no SeekHead: elements after the clusters are not read');
  // Verifies the id at each seek position: a stale SeekHead (file edited without rewriting it) points at the wrong
  // element, which must be a warning, not a mis-parse.
  const elements = function* (id) {
    const list = [];
    for (const pos of found.get(id) || []) {
      const h = yield* hdr(pos, segEnd);
      if (!h || h.id !== id) { out.warnings.push(`element 0x${id.toString(16)} not found at its seek position`); continue; }
      list.push(h);
    }
    return list;
  };
  for (const h of yield* elements(ID.Info)) { const b = yield* body(h, 1 << 20); if (b) parseInfo(b, out); }
  for (const h of yield* elements(ID.Tracks)) {
    const b = yield* body(h, maxElement);
    if (b) { if (!out.tracks.length) out.tracks = parseTracks(b); } else out.warnings.push('Tracks element too large');
  }
  for (const h of yield* elements(ID.Tags)) {
    const b = yield* body(h, maxElement);
    if (b) out.tags.push(...parseTags(b)); else out.warnings.push('Tags element too large');
  }
  for (const h of yield* elements(ID.Chapters)) {
    const b = yield* body(h, maxElement);
    if (b && !out.chapters.length) out.chapters = parseChapters(b); else if (!b) out.warnings.push('Chapters element too large');
  }
  // Attachments are walked by headers only: FileData (fonts, images, possibly MBs) is located, not read; small fields
  // (name, mime, uid; <= 64 KB) are read. Image data is fetched afterwards, only for what the caller wants.
  for (const ah of yield* elements(ID.Attachments)) {
    let r = ah.start;
    for (let i = 0; i < 4096 && r < ah.end; i++) {
      const fh = yield* hdr(r, ah.end);
      if (!fh || fh.size < 0) break;
      if (fh.id === MKV.AttachedFile) {
        const a = { name: null, mime: null, size: 0, description: null, uid: null, offset: -1 };
        let k = fh.start;
        for (let j = 0; j < 64 && k < fh.end; j++) {
          const ch = yield* hdr(k, fh.end);
          if (!ch || ch.size < 0) break;
          if (ch.id === MKV.FileData) { a.size = ch.end - ch.start; a.offset = ch.start; }
          else if (ch.end - ch.start <= 65536) {
            const b = yield [ch.start, ch.end - ch.start];
            if (ch.id === MKV.FileName) a.name = readString(b, 0, b.length);
            else if (ch.id === MKV.FileMediaType) a.mime = readString(b, 0, b.length);
            else if (ch.id === MKV.FileDescription) a.description = readString(b, 0, b.length);
            else if (ch.id === MKV.FileUID) a.uid = uidHex(b, 0, b.length);
          }
          k = ch.end;
        }
        out.attachments.push(a);
      }
      r = fh.end;
    }
  }
  const isImg = (a) => /^image\//.test(a.mime || '') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(a.name || '');
  const wantData = data === 'images' ? out.attachments.map((a, i) => (isImg(a) ? i : -1)).filter((i) => i >= 0)
    : data === 'cover' ? [coverAttachment(out.attachments)].filter((i) => i >= 0) : [];
  for (const i of wantData) {
    const a = out.attachments[i];
    if (a.offset >= 0 && a.size <= maxImage) a.data = yield [a.offset, a.size];
  }
  if (out.duration == null && tail && segEnd > segStart) {
    const len = Math.min(segEnd - segStart, 1 << 20);
    const t = yield [segEnd - len, len];
    const d = tailDuration(t, out.timestampScale);
    if (d != null) { out.duration = d; out.durationEstimated = true; }
  }
  // Chapter end fallback: the next chapter's start, else the (possibly estimated) duration.
  const end = out.duration;
  out.chapters.forEach((c, i) => {
    if (c.end == null) c.end = i + 1 < out.chapters.length ? out.chapters[i + 1].start : end ?? null;
  });
  return out;
}

/** Matroska metadata of a source or bytes (see the header). */
// An in-memory source runs synchronously; a real source goes through the block cache, since header reads are tiny and
// clustered (many 12-byte reads in the same 64 KB block).
export async function readMatroskaMeta(input, opts = {}) {
  const src = asSource(input);
  if (src.bytes) return readMatroskaMetaSync(src.bytes, opts);
  return runAsync(matroskaFlow(src.size, opts), cachedSource(src));
}

export function readMatroskaMetaSync(bytes, opts = {}) {
  const b = asBytes(bytes);
  return runSync(matroskaFlow(b.length, opts), b);
}

// --- vocabulary ----------------------------------------------------------------------------------

// Matroska official tag names that differ from the Vorbis vocabulary. '_' keys are intermediate: resolved below
// (_DATE_RECORDED becomes DATE only when no DATE_RELEASED exists; _LEAD_PERFORMER depends on level).
const RENAME = {
  DATE_RELEASED: 'DATE', DATE_RECORDED: '_DATE_RECORDED', CATALOG_NUMBER: 'CATALOGNUMBER', NARRATED_BY: 'NARRATOR', WRITTEN_BY: 'AUTHOR',
  LEAD_PERFORMER: '_LEAD_PERFORMER', CONTENT_TYPE: '_CONTENT_TYPE',
};

/** Vocabulary pairs of Matroska tags (see the header). */
// Level mapping. Only global tags (no track/chapter/attachment/edition target) describe the file. Music: level 30 is
// the track, 50 the album (TITLE -> ALBUM, ARTIST -> ALBUMARTIST, TOTAL_PARTS -> TRACKTOTAL), 60 the disc. Without
// level 30 the file is a single item and level-50 tags map directly. TV: a file with 60/70 levels (or EPISODE /
// SEASON type names) and no 30 is an episode: 70 TITLE = show, 60 PART_NUMBER = season, 50 PART_NUMBER = episode.
// Sorted ascending so the most specific level's values come first and win in normalizeTags (first value wins);
// Segment Info Title is appended last as the fallback title.
export function matroskaPairs(meta) {
  const global = (meta.tags || []).filter((t) => !t.targetTrackUid && !t.targetChapterUid && !t.targetAttachmentUid && !t.targetEditionUid);
  const levels = new Set(global.map((t) => t.targetType));
  const has30 = levels.has(30);
  const names = new Set(global.map((t) => t.targetTypeName).filter(Boolean));
  const tv = !has30 && (levels.has(60) || levels.has(70) || names.has('EPISODE') || names.has('SEASON'));
  const pairs = [];
  const sorted = [...global].sort((a, b) => a.targetType - b.targetType);
  for (const t of sorted) {
    const lvl = t.targetType;
    if (lvl < 30) continue;
    for (const [rawKey, value] of t.list) {
      if (rawKey.includes('/')) continue;
      let key = RENAME[rawKey] || rawKey;
      if (key === 'REPLAYGAIN_GAIN') key = lvl >= 50 && has30 ? 'REPLAYGAIN_ALBUM_GAIN' : 'REPLAYGAIN_TRACK_GAIN';
      if (key === 'REPLAYGAIN_PEAK') key = lvl >= 50 && has30 ? 'REPLAYGAIN_ALBUM_PEAK' : 'REPLAYGAIN_TRACK_PEAK';
      if (tv) {
        if (lvl >= 70) { if (key === 'TITLE') pairs.push(['SHOW', value]); else if (key !== 'PART_NUMBER' && key !== 'TOTAL_PARTS') pairs.push([key, value]); continue; }
        if (lvl >= 60) { if (key === 'PART_NUMBER') pairs.push(['SEASON', value]); else if (key === 'TITLE') pairs.push(['_SEASON_TITLE', value]); else if (key !== 'TOTAL_PARTS') pairs.push([key, value]); continue; }
        if (key === 'TITLE') { pairs.push(['TITLE', value], ['EPISODETITLE', value]); continue; }
        if (key === 'PART_NUMBER') { pairs.push(['EPISODE', value]); continue; }
        if (key === 'TOTAL_PARTS') continue;
        pairs.push([key, value]);
        continue;
      }
      if (lvl >= 70) continue;
      if (lvl >= 60) {
        if (key === 'PART_NUMBER') pairs.push(['DISCNUMBER', value]);
        else if (key === 'TOTAL_PARTS') pairs.push(['DISCTOTAL', value]);
        continue;
      }
      if (lvl >= 50 && has30) {
        if (key === 'TITLE') pairs.push(['ALBUM', value]);
        else if (key === 'ARTIST' || key === '_LEAD_PERFORMER') pairs.push(['ALBUMARTIST', value]);
        else if (key === 'TOTAL_PARTS') pairs.push(['TRACKTOTAL', value]);
        else if (key !== 'PART_NUMBER') pairs.push([key, value]);
        continue;
      }
      if (key === 'PART_NUMBER') pairs.push(['TRACKNUMBER', value]);
      else if (key === 'TOTAL_PARTS') pairs.push(['TRACKTOTAL', value]);
      else if (key === '_LEAD_PERFORMER') pairs.push(['ARTIST', value]);
      else pairs.push([key, value]);
    }
  }
  const dr = pairs.find(([k]) => k === '_DATE_RECORDED');
  if (dr && !pairs.some(([k]) => k === 'DATE')) pairs.push(['DATE', dr[1]]);
  if (meta.title) pairs.push(['TITLE', meta.title]);
  return pairs;
}
