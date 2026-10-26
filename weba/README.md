# weba/

Audio-only WebM (`.weba`, `audio/webm`) helpers built on `../webm/` and `../ogg/`. Node-importable.

## Files

- `weba.js` — Opus muxing, audio extraction (stream copy), audio info, Opus WebM -> Ogg Opus.

## API

```js
import { muxOpus, extractAudio, parseWeba, webmToOggOpus } from '../weba/weba.js';

muxOpus(packets, { sampleRate = 48000, channels = 2, preSkip = 312, head, title }) -> Uint8Array
// packets: Uint8Array[] (timed from their TOC bytes) or [{ data, timestamp (µs), duration }] / EncodedAudioChunk[];
// head: OpusHead bytes (AudioEncoder decoderConfig.description) when available.

extractAudio(webmBytes, { track }) -> { codec, codecId, sampleRate, channels, codecPrivate, codecDelay (ns),
                                        duration (s), packets: [{ data, timestamp, duration }], bytes }
// bytes: an audio-only WebM with the same packets (Opus / Vorbis), null for other codecs.

parseWeba(bytes) -> { codec, codecName, sampleRate, channels, duration, bitrate, title, tags, muxingApp, writingApp }

webmToOggOpus(webmBytes, { tags }) -> { bytes, duration }   // Opus packets copied into Ogg Opus, pre-skip kept
```

## Limits

Only the first audio track is used unless `track` is given; Vorbis and other codecs can be extracted to WebM / packets
but not converted to Ogg.
