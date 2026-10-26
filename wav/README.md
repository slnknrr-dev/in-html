# wav/

WAV (RIFF/WAVE) reading and writing. Pure functions over bytes (browsers, Node, Bun), no dependencies.

## Files

- `wav.js` — parser, decoder, encoder, LIST/INFO metadata, channel (de)interleaving.

## API

```js
import { parseWav, decodeWav, encodeWav, interleave, deinterleave, INFO_TAGS } from '../wav/wav.js';

parseWav(bytes)
// -> { formatTag, format: 'pcm' | 'float' | 'alaw' | 'mulaw' | 'unknown', channels, sampleRate, byteRate, blockAlign,
//      bitsPerSample, validBits, channelMask, extensible, dataOffset, dataSize, frames, duration (s),
//      info: { title, artist, album, comment, date, genre, software, track, copyright, ... }, chunks: [{ id, offset, size }] }

decodeWav(bytes)            // parseWav(...) + { channelData: Float32Array[] } (planar, -1..1)

encodeWav(channelData, { sampleRate, bitDepth: 8 | 16 | 24 | 32, float: false, info: { title, artist, ... }, extensible })
// -> Uint8Array. float: true writes IEEE float (32-bit, or 64 with bitDepth: 64). WAVE_FORMAT_EXTENSIBLE is used
//    automatically for more than 2 channels or integer samples deeper than 16 bits (default speaker masks).

interleave(channelData) -> Float32Array        deinterleave(samples, channels) -> Float32Array[]
```

## Details

- Reads PCM 8 (unsigned) / 16 / 24 / 32-bit, IEEE float 32 / 64, G.711 A-law / mu-law, and the same inside
  WAVE_FORMAT_EXTENSIBLE (sub-format GUID).
- Streaming writers that leave the data size at 0 or 0xFFFFFFFF: the data runs to the end of the file.
- Odd-sized chunks are padded as RIFF requires; unknown chunks are listed in `chunks`.
- INFO text is written as UTF-8 and read as UTF-8 when valid, else Latin-1.
- Integer encoding uses the decoding scale (x * 2^(bits-1), clipped), so encode -> decode round trips within half a step.

## Limits

RF64 / BW64 (files over 4 GB), RIFX (big-endian) and compressed formats other than G.711 are not supported.
