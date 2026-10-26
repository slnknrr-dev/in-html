# mp4/

ISO BMFF (MP4 / MOV / M4A / 3GP) parsing, sample tables for WebCodecs decoding and a progressive MP4 muxer for
WebCodecs output. Also the codec configuration records shared with `../webm/`. Pure functions, Node-importable.

## Files

- `box.js` — box tree reader (`readBoxes`, `findBox`, `findAll`) and byte writers (`box`, `fullBox`, `u32`, ...).
- `codecs.js` — avcC (with SPS dimensions), hvcC, av1C (with the AV1 sequence header OBU parser), vpcC (with the VP9
  frame header), AudioSpecificConfig / esds, dOps <-> OpusHead, WebCodecs codec strings, `codecName`.
- `demux.js` — `parseMp4`, `decoderConfig`.
- `mux.js` — `Mp4Muxer`.

## API

```js
import { parseMp4, decoderConfig } from '../mp4/demux.js';
const m = parseMp4(bytes, { samples: true });
// m.brands { major, minor, compatible }, m.fragmented, m.duration (s), m.created, m.modified, m.metadata { title,
// artist, album, date, genre, comment, encoder, track, ... }, m.cover { mime, data } | null, m.boxes (top level)
// m.tracks [{ id, type: video | audio | text ..., handler, fourcc, codec (WebCodecs string), codecName, description,
//             timescale, duration, language, width, height, displayWidth, displayHeight, rotation, sampleRate,
//             channels, bitDepth, bitrate, frameRate, edits,
//             samples: [{ offset, size, dts, cts, duration, timestamp (µs), durationUs, keyframe, data }] }]
decoderConfig(track) // VideoDecoder / AudioDecoder config (avcC / hvcC / av1C, AudioSpecificConfig, OpusHead)

import { Mp4Muxer } from '../mp4/mux.js';
const mux = new Mp4Muxer({
  video: { codec: 'avc1.42001f' | 'hvc1…' | 'av01…' | 'vp09…', width, height },
  audio: { codec: 'mp4a.40.2' | 'opus', sampleRate, channels },
  metadata: { title, artist, … } });
mux.addVideoChunk(chunk, meta);  mux.addAudioChunk(chunk, meta);   // WebCodecs encoder outputs
const bytes = mux.finalize();     // ftyp + moov + mdat; finalize({ parts: true }) -> Uint8Array[]
```

## Details

- Demuxer: 32/64-bit boxes, stsz/stz2, stco/co64, stsc, stts, ctts (signed), stss, edit lists (presentation
  shift), fragmented files (mvex/trex, moof/traf/tfhd/tfdt/trun with all optional fields), QuickTime audio
  entries v1/v2 and `wave`, iTunes metadata (ilst) and QuickTime udta text, cover art.
- Muxer: moov before mdat (fast start); samples interleaved in ~0.5 s chunks; 90 kHz video timescale, audio in its
  sample rate (48 kHz for Opus); ctts + edit list when frames are reordered; empty edit when a track starts late;
  avcC / hvcC from the encoder description (H.264 must use `avc: { format: 'avc' }`), av1C from the first keyframe,
  vpcC from the codec string and the VP9 frame header, esds from the AudioSpecificConfig, dOps from OpusHead;
  co64 when the file exceeds 4 GB.

## Limits

No encryption (cenc), no fragmented output, timed text tracks are listed but not muxed, samples are held in memory
until `finalize()`.
