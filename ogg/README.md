# ogg/

Ogg container (RFC 3533), Ogg Opus (RFC 7845) and Vorbis comments. Pure functions over bytes, Node-importable.

## Files

- `ogg.js` — Ogg CRC (polynomial 0x04c11db7, not the zlib CRC), page reader / writer, packet reassembly, paginating writer.
- `opus.js` — OpusHead / OpusTags, Opus packet durations (TOC byte), Ogg Opus muxer and demuxer.
- `vorbis.js` — Vorbis comment blocks (also used by Opus and FLAC), FLAC picture blocks (cover art), Vorbis
  identification header, summary of every stream of an Ogg file.

## API

```js
import { oggCrc, readPages, readPackets, writePage, OggWriter } from '../ogg/ogg.js';
readPages(bytes, { verify = true })   // [{ offset, size, version, continued, bos, eos, granule (-1: none), serial, seq, crc, crcOk, lacing, data }]
readPackets(bytes)                     // Map(serial -> { serial, pages, packets: [{ data, granule, page, eos }] })
writePage({ data, lacing, serial, seq, granule, bos, eos, continued }) -> Uint8Array
const w = new OggWriter({ serial, pageSize: 4096 });
w.addPacket(bytes, granule, { flush, eos }); w.bytes() -> Uint8Array

import { parseOpusHead, buildOpusHead, parseOpusTags, buildOpusTags, opusPacketSamples, muxOggOpus, demuxOggOpus } from '../ogg/opus.js';
muxOggOpus(packets, { channels, preSkip = 312, inputSampleRate = 48000, head, tags, vendor, pictures, serial, totalSamples })
// packets: Uint8Array[] | [{ data }] | EncodedAudioChunk[]; head: OpusHead bytes (e.g. AudioEncoder decoderConfig.description);
// totalSamples: 48 kHz samples to keep after pre-skip (end trimming through the last granule position).
demuxOggOpus(bytes) // -> { head, tags, packets: [{ data, timestamp (µs), duration (µs), samples }], duration, channels, preSkip, serial }
opusPacketSamples(packet) -> 48 kHz samples of one packet

import { parseVorbisComment, buildVorbisComment, parseFlacPicture, buildFlacPicture, parseVorbisId, readOggInfo } from '../ogg/vorbis.js';
readOggInfo(bytes) // -> { streams: [{ serial, codec: opus | vorbis | flac | speex | theora | unknown, channels, sampleRate,
                   //      preSkip, duration, packets, bytes, bitrate, vendor, tags, pictures }], duration, tags }
```

Granule positions are Numbers (exact up to 2^53 samples). Tag names are mapped to friendly keys (`title`, `artist`,
`album`, `date`, `genre`, `track`, `comment`, ...); other fields keep their lower-cased name.

## Limits

No Vorbis / FLAC / Theora decoding or muxing (headers and comments only); chained Ogg files are read as separate
streams; Opus channel mapping family 1 defaults cover 3..8 channels.
