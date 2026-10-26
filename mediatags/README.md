# mediatags/

Everything a media library knows about a file without decoding it: embedded tags, stream information, chapters, covers
and lyrics of audio and video containers (read through random-access sources, so a multi-GB file over HTTP Range
requests costs a few small reads), the sidecar files next to it (subtitles, LRC, CUE, NFO, artwork), what its name and
folders say, path templates, and playlists. Pure ES modules for browsers and Node; no dependencies besides the
repository's format libraries (`mp3/`, `mp4/`, `ogg/`, `webm/`, `wav/`, `xml/`, `codec/`).

| file | contents |
| --- | --- |
| `source.js` | random-access sources: `bytesSource`, `blobSource`, `asSource`, `cachedSource` (block LRU), `countingSource`; `runSync` / `runAsync` drive the reader flows |
| `detect.js` | `EXT`, `extOf`, `kindOf(name, head?)`, `containerOf(head)`, `mimeOf(name)` |
| `read.js` | `readMedia(src, { name, cover })` / `readMediaSync(bytes, opts)` -> MediaInfo (MP3, AAC ADTS, FLAC, Ogg, MP4 / MOV, Matroska / WebM, WAV, AIFF, image sizes) |
| `fields.js` | the tag vocabulary (Vorbis-comment-like keys) and `normalizeTags(pairs)` -> MediaInfo tags, ReplayGain, synced lyrics, comment chapters |
| `id3frames.js` | ID3v2 frames beyond `mp3/id3.js` (multi-values, TXXX, COMM, USLT, SYLT, CHAP / CTOC, UFID, RVA2), Winamp genre list, APEv2 tags |
| `flac.js` | `parseFlacMeta(bytes)`, `flacFlow`, `buildFlacMeta` (STREAMINFO, VORBIS_COMMENT, PICTURE, CUESHEET) |
| `oggmeta.js` | `oggFlow`: Opus / Vorbis / FLAC / Speex / Theora headers + the final granules |
| `mp4meta.js` | `mp4Flow`: moov anywhere, `parseIlst` (all iTunes items, freeform), `parseChpl`, QuickTime chapter tracks, `mp4Codec` |
| `mkv.js` | `readMatroskaMeta` (async) / `readMatroskaMetaSync`: SeekHead -> Info, Tracks, Tags, Chapters, Attachments; `matroskaPairs`, `coverAttachment`, `MKV` ids |
| `lrc.js` | `parseLrc`, `serializeLrc`, `lineAt`, `wordAt`, `plainLyrics`, `isLrc` |
| `cue.js` | `parseCue`, `cueTracks`, `serializeCue`, `buildCue`, `msf`, `parseMsf` |
| `subs.js` | `parseSrt`, `parseVtt`, `parseAss`, `parseMicroDvd`, `parseSubs`, `toVtt`, `toSrt`, `shiftCues`, `formatTime` |
| `nfo.js` | `parseNfo`, `serializeNfo` (Kodi / Jellyfin movie, tvshow, episodedetails, musicvideo, album, artist) |
| `names.js` | `parseName(path, { hint })`, `parseScene`, `parseFansub`, `parseMovie`, `parseMusic`, `parseAudiobook`, `normTitle`, `sortTitle`, `cleanTitle` |
| `template.js` | `compileTemplate(tpl)` -> `{ source, fields, match(relPath), format(values) }`, `safeSegment` |
| `sidecar.js` | `groupSidecars(paths)`, `COVER_NAMES`, `isCoverName`, `langCode`, `subInfo` |
| `playlist.js` | `parseM3u` / `writeM3u`, `parsePls` / `writePls`, `parseXspf` / `writeXspf` |
| `test.js` | `node mediatags/test.js` or `node check.js tests mediatags` |

## Reading media

```js
import { readMedia } from '../mediatags/read.js';
const info = await readMedia(file);          // File / Blob / Uint8Array / { size, read(offset, length) }
// { container, kind, mime, duration, bitrate, audio: { codec, sampleRate, channels, bitsPerSample },
//   video: { codec, width, height, fps }, streams: [{ index, type, codec, lang, title, default, forced, ... }],
//   tags: { title, artist, artists, album, albumArtist, track, trackTotal, disc, discTotal, year, date, genre: [],
//           ..., mb: { recordingId, ... } },
//   replaygain: { trackGain, trackPeak, albumGain, albumPeak } | null, syncedLyrics, chapters: [{ start, end, title }],
//   cover: { mime, data, description, type } | null, pictures, warnings }
```

A source is `{ size, read(offset, length) -> Promise<Uint8Array> }`. `readMedia` wraps sources in `cachedSource`
(64 KiB blocks), so the many small header reads of a walk become a few real reads. Every container reader is a
generator that yields `[offset, length]` requests; `runSync` serves them from bytes, `runAsync` from a source, so the
same parser backs `readMedia` and `readMediaSync`.

What is read: the ID3v2 tag(s) at the start (<= 64 MB) and ID3v1 / APEv2 at the end; for MPEG audio the first frame
with its Xing / Info / VBRI header (duration from the frame count, else bytes / bit rate); FLAC metadata block headers
and the needed blocks (in `cover: false` mode no PICTURE data); Ogg pages up to the comment headers and the last
64 KiB (1 MiB if needed) for the final granule; the MP4 top-level box headers, moov (<= 64 MB) and the samples of a
chapter text track; Matroska level-1 headers up to the first Cluster, the SeekHead targets (elements <= 16 MB), the
attachment headers and only the cover image, the last 1 MiB when Info has no Duration; WAV / AIFF chunk headers, fmt /
COMM, LIST/INFO, ID3 chunks.

Tags of every container are first turned into one vocabulary (`fields.js`): `TITLE`, `ARTIST`, `ALBUMARTIST`,
`TRACKNUMBER` ('3/12'), `DATE`, `GENRE`, `REPLAYGAIN_*`, `MUSICBRAINZ_*` (Picard's names: `MUSICBRAINZ_TRACKID` is the
recording, `MUSICBRAINZ_RELEASETRACKID` the track), ... Mappings: ID3 frames and TXXX descriptions, MP4 ilst atoms and
`----:com.apple.iTunes:` names, Vorbis comments as they are, Matroska SimpleTags by target level (30 track, 50 album or
episode, 60 season / disc, 70 show; tags without level 30 map directly; per-track tags are skipped), WAV INFO ids,
AIFF text chunks. Absent values are omitted; numbers are numbers.

Chapters come from ID3 CHAP / CTOC, MP4 chapter tracks (else Nero `chpl`), Matroska Chapters (default edition),
Vorbis `CHAPTERnnn` comments, an embedded `CUESHEET` comment, or a FLAC CUESHEET block whose tracks are titled by
`CUE_TRACKnn_TITLE` comments. `syncedLyrics` is LRC text from ID3 SYLT (lines, or words grouped into lines with
enhanced timing) or from a lyrics tag that is LRC (then `tags.lyrics` holds the plain text).

## Names, templates, sidecars

`parseName('Anime/Title/Season 2/05.mkv')` -> `{ kind: 'episode', show: 'Title', season: 2, episode: 5, ext: 'mkv',
confidence }`. Scene names (`S01E02`, `S01E02E03`, `1x02`, daily dates), fansub names (`[Group] Title - 05v2 [crc]`,
specials `12.5`, `OVA`, `NCOP1`, absolute numbers), movies (year, edition, release tags), music (`01 - Artist -
Title`, `1-03 Title`, `Artist - Album - 03 - Title`), audiobooks (`Chapter 01 - ...`, `Part 1 of 12`, `001_Title`)
and the folders above the file (season, show, disc, album with year, artist, series with number, author).

`compileTemplate('{artist}/{year} - {album}/{track:02} {title}.{ext}')` matches the end of relative paths (a leading
`/` anchors at the root) and formats paths back; see the module header for the syntax (`{x:02}`, `{x?}`, `{_}`, `*`,
`**`, `{{ }}`).

`groupSidecars(paths)` assigns subtitles (language / forced / SDH from the name), LRC, NFO, CUE and images to media
files by stem and to folders by the Kodi / Jellyfin / Plex names (`cover`, `folder`, `fanart`, `banner`, `clearlogo`,
`season01-poster`, `tvshow.nfo`, ...).

## Limits

- No audio / video decoding; MPEG audio durations trust the VBR header or assume CBR, ADTS durations are estimated
  from the first 256 KiB; Ogg durations assume streams that start at granule 0 and ignore chained streams.
- Fragmented MP4 without mehd / sidx and Matroska without a SeekHead may miss what lies after the media data
  (warnings say so); MP4 `cmov` (compressed movie boxes), encrypted tracks and MP4 / AIFF / ASF / AVI / MPEG-TS tags
  beyond those listed are not read; AVI, TS, ASF, FLV, APE and WavPack are detected only.
- Matroska UIDs are hex strings; only top-level chapter atoms of one edition are returned; nested SimpleTags appear
  as `PARENT/CHILD` in `tags[].list` / `simple` but are not mapped to MediaInfo tags.
- Name parsing is heuristic: `confidence` says how much of the name matched a known pattern; titles containing
  release-tag words (`Web`, `Dual`, ...) may be cut or tagged.
- `langCode` knows about 80 languages (ISO 639-1 / 2, English and a few native names).
