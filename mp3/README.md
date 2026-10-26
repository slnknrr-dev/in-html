# mp3/

MPEG audio frame parsing, ID3 tags and an MPEG-1 Layer III encoder. Pure JavaScript, Node-importable.

## Files

- `tables.js` — bit rates, sample rates, scale factor bands, the polyphase window (table B.3) and the Huffman code
  tables (table B.7, stored in codeword order), code builders.
- `frame.js` — frame headers (MPEG-1 / 2 / 2.5, layers I-III), frame sync, Xing / Info (+ LAME extension) and
  VBRI headers, stream scan (frames, duration, bit rate).
- `id3.js` — ID3v2.2 / 2.3 / 2.4 reading, ID3v2.3 / 2.4 writing (text frames, comments, lyrics, TXXX, APIC
  pictures), ID3v1 / v1.1, stripping (ID3v2, ID3v1, APEv2).
- `encoder.js` — MPEG-1 Layer III encoder.

## API

```js
import { parseFrameHeader, findFrame, readVbrHeader, scanMp3 } from '../mp3/frame.js';
scanMp3(bytes) // -> { audioStart, audioEnd, id3v2Size, hasId3v1, version, layer, sampleRate, channels, mode, frames,
               //      duration (s), bitrate (kbps), cbr, vbr: { type: Xing | Info | VBRI, frames, bytes, toc,
               //      encoder, encoderDelay, encoderPadding } | null, firstFrame, samplesPerFrame }

import { readId3v2, writeId3v2, readId3v1, writeId3v1, stripId3, setId3, id3v2Size } from '../mp3/id3.js';
readId3v2(bytes) // -> { version, size, frames, tags: { title, artist, album, albumArtist, year, track, genre, comment,
                 //      lyrics, composer, encoder, user: { DESC: value } }, pictures: [{ mime, type, description, data }] }
writeId3v2(tags, { version: 3 | 4, pictures, padding }) -> Uint8Array
setId3(mp3Bytes, tags, { version, pictures, v1 }) -> Uint8Array   // replaces existing tags

import { Mp3Encoder, encodeMp3, encodeMp3Async } from '../mp3/encoder.js';
encodeMp3([left, right], { sampleRate: 44100, bitrate: 128 }) -> Uint8Array   // Info frame + audio frames
await encodeMp3Async(channels, { sampleRate, bitrate, channels: 1 | 2, onProgress, signal })
const enc = new Mp3Encoder({ sampleRate, channels, bitrate, lowpass });
enc.encode(l, r) -> bytes; enc.flush() -> bytes; enc.infoFrame() -> CBR Info frame (frame / byte counts, seek table)
```

## Encoder

- MPEG-1 Layer III, 32 / 44.1 / 48 kHz, mono or stereo (independent channels, no joint stereo), CBR 32-320 kbps.
- 512-tap polyphase analysis filterbank (C = D / 32 of the standard window), 36-point MDCT of normal (long) blocks,
  alias-reduction butterflies, global-gain search per granule (binary search on the bit count), region split by
  the standard table, Huffman table selection per region (with linbits), count1 table A/B choice, bit reservoir
  (main_data_begin up to 511 bytes), padding slots at 44.1 kHz, a bitrate-dependent low-pass.
- No psychoacoustic model, scale factors or block switching: quality is good at 128 kbps and above for most
  material, transients may pre-echo. Other sample rates must be resampled first (e.g. OfflineAudioContext).
- Verified by decoding in Chrome: a sine round trips at ~80 dB SNR; total delay 1057 samples, the encoder pads the
  end so that nothing is cut.
