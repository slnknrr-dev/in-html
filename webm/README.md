# webm/

EBML, Matroska / WebM demuxing and muxing for WebCodecs, and a fixer that makes MediaRecorder recordings seekable.
Pure functions over bytes, Node-importable. Codec configuration records come from `../mp4/codecs.js`.

## Files

- `ebml.js` — EBML variable-size integers, element headers and typed readers, element writers, Matroska ids (`ID`).
- `demux.js` — `parseWebm`: tracks, frames with timestamps, cues, seek head, tags; `decoderConfig` for WebCodecs.
- `mux.js` — `WebmMuxer`: seekable WebM / Matroska from encoded chunks; `matroskaCodecId`.
- `fix.js` — `fixWebm`: Duration + SeekHead + Cues for live (unknown-size) WebM, blocks copied byte for byte.

## API

```js
import { parseWebm, decoderConfig } from '../webm/demux.js';
const w = parseWebm(bytes, { frames: true });
// w.info { timestampScale, duration (s), title, muxingApp, writingApp, date }, w.duration (s), w.hasDuration, w.hasCues
// w.tracks [{ number, type: video | audio | subtitle ..., codecId, codec (WebCodecs string), codecName, codecPrivate,
//            width, height, displayWidth, displayHeight, alphaMode, sampleRate, channels, bitDepth, defaultDuration,
//            codecDelay, seekPreRoll, language, name, frames, bytes, duration, bitrate, frameRate }]
// w.frames [{ track, timestamp (µs), duration (µs), keyframe, invisible, offset, size, data }]  (file order)
// w.cues [{ time (s), track, clusterPosition (file offset) }], w.clusters, w.seekHead, w.tags
decoderConfig(track) // VideoDecoder / AudioDecoder config (description = CodecPrivate for AVC / HEVC / Opus / Vorbis / FLAC / AAC)

import { WebmMuxer } from '../webm/mux.js';
const mux = new WebmMuxer({
  video: { codec: 'vp8' | 'vp09.00.10.08' | 'av01.0.04M.08', width, height, frameRate?, alpha? },
  audio: { codec: 'opus' | 'vorbis', sampleRate, channels, codecPrivate?, preSkip? },
  title?, writingApp?, shiftToZero = true });
videoEncoder output: (chunk, meta) => mux.addVideoChunk(chunk, meta);
audioEncoder output: (chunk, meta) => mux.addAudioChunk(chunk, meta);
const bytes = mux.finalize();            // or mux.finalize({ parts: true }) -> Uint8Array[] for new Blob(parts)

import { fixWebm } from '../webm/fix.js';
const { bytes, duration, cues, changed } = fixWebm(recording, { duration? /* s */ });
```

## Details

- Demuxer: unknown-size Segment and Clusters (live recordings), Xiph / EBML / fixed lacing, BlockGroups
  (keyframe = no ReferenceBlock), truncated tails, resync on damaged data. VP9 profile / bit depth and AV1 codec
  strings are refined from the first keyframe.
- Muxer: frames are buffered; `finalize()` writes known sizes, a SeekHead, Info with Duration, a cluster at every
  video keyframe (at most 5 s per cluster), and Cues pointing at keyframe clusters (every cluster for audio-only).
  The AV1 CodecPrivate (av1C) is built from the sequence header of the first keyframe; Opus gets OpusHead,
  CodecDelay (pre-skip) and SeekPreRoll 80 ms. H.264 / HEVC / AAC / FLAC / PCM are written with DocType `matroska`.
- Timestamps are microseconds in the API and milliseconds in the file (TimestampScale 1 000 000).

## Limits

No encryption / content compression, subtitles are listed but not muxed, BlockAdditions (VP8/VP9 alpha) are not
written, frames are held in memory until `finalize()`.
