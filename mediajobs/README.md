# mediajobs/

Media jobs for ffmpeg, ffprobe, yt-dlp and ImageMagick as plain JSON data: builders describe a job (conversions,
loudness normalization, splitting and joining with chapters, tags and covers, probing, online downloads, cover art),
a renderer shows the whole job as a copyable bash or cmd.exe script, a pure queue schedules jobs, and a runner executes
them with Node APIs passed in. Every module is a pure ES module that imports in browsers and Node: nothing imports
`node:` modules (a bundled backend or Electron's main process passes `spawn`, `fs`, `path`, `os` in), and nothing touches
the DOM. The browser renders the same specs the server runs.

| file | contents |
| --- | --- |
| `job.js` | the job model: `makeStep`, `makeJob`, `Args` (argument groups), placeholders (`substitute`, `placeholders`, `getVar`, `varStep`, `usesWork`), `parseTime`, `fileSafe`, `joinPath`, `baseName`, `extOf`, `argPath`, `plainText`, `hashId` |
| `tools.js` | `TOOLS`, `toolId`, `toolCommand`, `findTool`, `parseVersion`, `detectTools` |
| `ffmpeg.js` | builders `convertAudio`, `convertVideo`, `remux`, `extractAudio`, `loudnessScan`, `normalize`, `splitTracks`, `joinChapters`, `embedMeta`, `frame`, `waveformImage`; `ffmetadata`, `concatList`, `tagPairs`, `resolveChapters`, `audioCodecArgs`; parsers `parseLoudnorm`, `parseProgress`, `progressFraction`; `FFMPEG_HEAD`, `AUDIO_FORMATS`, `AUDIO_EXT` |
| `ffprobe.js` | `probeJob`, `parseProbe` (MediaInfo, the tag reader's shape) |
| `ytdlp.js` | `parseSource`, `formatSource`, `sourceURL`, `isSourceRef`, `infoJob`, `downloadJob`, `parseProgressLine`, `infoToCatalog`; `EXTRACTORS`, `DL_TEMPLATE`, `PP_TEMPLATE`, `FILEPATH_PRINT` |
| `magick.js` | `coverJob`, `thumbJob`, `collageJob`, `convertJob`, `identifyJob`, `parseIdentify`, `cells` |
| `shell.js` | `renderJob(job, 'bash' \| 'cmd', options)` → `{ text, pieces, work }` |
| `queue.js` | `createQueue({ concurrency, run, now, maxLog })` |
| `runner.js` | `runJob(spec, deps)`, `makeRunner(deps)` (the `run` of a queue) |
| `test.js` | `node mediajobs/test.js` (or `node check.js tests mediajobs`) |

## Job model

```
{ kind: 'ffmpeg.convertAudio', title, notes?: [text],
  steps: [{ tool: 'ffmpeg' | 'ffprobe' | 'yt-dlp' | 'magick', argv: [strings, without the program],
            groups: [n] | null,          // argument groups kept on one line when rendered (optional)
            comment, files: { 'chapters.txt': text },   // auxiliary files written into the job's work folder
            capture: 'json' | 'text' | null, parse: 'loudnorm' | 'ffprobe' | 'ytdlp-info' | 'identify' | null,
            progress: 'ffmpeg' | 'ytdlp' | null, duration: seconds | null }],
  outputs: [paths] }
```

Kinds: `ffmpeg.convertAudio`, `ffmpeg.convertVideo`, `ffmpeg.remux`, `ffmpeg.extractAudio`, `ffmpeg.loudnessScan`,
`ffmpeg.loudnorm` (normalize), `ffmpeg.split`, `ffmpeg.joinChapters`, `ffmpeg.embed`, `ffmpeg.frame`,
`ffmpeg.waveform`, `ffprobe`, `ytdlp.info`, `ytdlp.download`, `magick.cover`, `magick.thumb`, `magick.collage`,
`magick.convert`, `magick.identify`. `notes` tells what a builder had to leave out (e.g. a cover in an Ogg file).

Placeholders in argv and auxiliary file texts: `{work}` is the job's private work folder (`{work}/list.ffconcat`), and
`{var:loudnorm.input_i}` a value an earlier step parsed (`vars[parse]`). The runner substitutes them; the renderer
shows `{work}` as `job-<id>` and variables as `<input_i from step 1>`.

## API

**tools.js** — `findTool(bin, { env, platform, fs, path, extra, configured })` → absolute path | null: the configured
file (or a folder holding the program), then PATH (Windows: PATHEXT without `.bat` / `.cmd`, which cannot be spawned
without a shell), the `extra` folders, then common install folders (Windows: `C:\Program Files\ImageMagick-*` newest
first, `C:\ffmpeg\bin`, `%ProgramFiles%\ffmpeg\bin`, WinGet Links, scoop shims, chocolatey; macOS: `/opt/homebrew/bin`,
`/usr/local/bin`, `/opt/local/bin`, `~/.local/bin`; Linux: `/usr/bin`, `/usr/local/bin`, `~/.local/bin`, `/snap/bin`,
`/bin`). For `magick` outside Windows the ImageMagick 6 `convert` is the fallback (the job argv works with both).
`detectTools({ spawn, env, platform, fs, path, configured, timeout = 5000 })` → `{ ffmpeg, ffprobe, 'yt-dlp', magick }`,
each `{ path, version, legacy? }` or null; never throws. `toolCommand(tools, bin)` accepts tools keyed by bin name or
id, with a path, an array (`['python', '-m', 'yt_dlp']`) or a detectTools entry.

**ffmpeg.js** — every step starts with `-hide_banner -nostdin -y -progress pipe:1 -nostats`: never waits for input,
overwrites outputs, reports machine-readable progress on stdout and keeps stderr for messages. No `-loglevel`: the
default level keeps loudnorm's JSON report on stderr. Seeking is input seeking (`-ss` before `-i`), accurate when
re-encoding; ends become `-t`. Times are seconds or `hh:mm:ss.xxx`.

- `convertAudio({ input, output, format: 'mp3'|'opus'|'aac'|'m4a'|'flac'|'wav'|'ogg', quality: 'low'|'med'|'high'|'lossless',
  bitrate, sampleRate, channels, bits, tags, cover, keepCover, start, end, loudnorm, measured, duration })` — mp3 VBR
  `-q:a 6/4/0` (lossless: 320k), opus 64/128/160/256k, AAC 96/160/256/320k, Vorbis `-q:a 3/5/7/10`, FLAC level 8, PCM.
  `loudnorm: { I = -16, TP = -1.5, LRA = 11 }` without `measured` adds a measuring pass and a second pass with
  `{var:loudnorm.*}` (linear mode); the output rate is then set (48 kHz unless `sampleRate`), since loudnorm works at
  192 kHz.
- `convertVideo({ input, output, format: 'mp4'|'webm'|'mkv', quality, maxHeight, crf, preset, audio, subtitles:
  'copy'|'burn'|'none', subtitleFile, subtitleStream, start, end, duration })` — ffcmd/codecs.js `encodeArgs`
  (H.264 + AAC, or VP9 + Opus for webm); burning uses an output seek so the subtitles filter stays in sync.
- `remux({ input, output, streams: 'all'|'av' })`, `extractAudio({ input, output, copy = true, format })`.
- `loudnessScan({ input, I, TP, LRA })`, `normalize({ input, output, target, measured, format })` (audio or video
  outputs; video streams are copied).
- `splitTracks({ input, tracks: [{ number, title, artist, start, end }], outDir, pattern = '{track:02} {title}.{ext}',
  format, copy, album, albumArtist, year, genre, cover })` — one step per track, `-map_metadata -1 -map_chapters -1`
  and the track's own tags; names through `fileSafe` (valid on every system), duplicates numbered; an end defaults to
  the next start.
- `joinChapters({ inputs: [{ path, title, duration }], output, tags, cover, bitrate, copy })` — the concat demuxer
  (`list.ffconcat`, `-safe 0`) and an FFMETADATA1 file (`TIMEBASE=1/1000`) with the tags and one chapter per input;
  durations are required (probe first). Inputs should share codec and sample rate; use absolute paths (relative ones
  resolve against the work folder).
- `embedMeta({ input, output, tags, cover, chapters, duration })` — stream copy; chapters through FFMETADATA1.
- `frame({ input, output, at, width })` (`-update 1`: the name is literal), `waveformImage({ input, output, width,
  height, color })`.
- `ffmetadata(tags, chapters)` escapes `= ; # \` and line breaks with a backslash; `concatList(paths)` quotes with
  `'…'` and writes `'` as `'\''` (a path with a line break cannot be listed and throws).
- `parseProgress(text, state)` keeps an unfinished line in `state.rest`; `parseLoudnorm(stderr)` returns numbers and
  clamps the infinities of silent input to the ranges the second pass accepts.

Covers: an attached picture in mp3, MP4 family and FLAC; an attachment in mkv / mka; ffmpeg cannot write pictures into
Ogg / Opus / WAV / ADTS AAC (a note). Audio inputs that can hold a picture keep theirs (`-map 0:v:0?`).

**ffprobe.js** — `probeJob(input)`: `-v error -print_format json -show_format -show_streams -show_chapters <input>`.
`parseProbe(json | text)` → MediaInfo `{ container, kind, mime, duration, bitrate, audio, video, streams, tags,
replaygain, syncedLyrics: null, chapters, cover: null, pictures, warnings, image? }` with the tag reader's vocabulary
(mediatags/): containers `mp4` (m4a / m4b too), `mov`, `mkv`, `webm`, `ogg`, `mp3`, …; tags `title`, `artist`
(as written), `artists` (split on NUL, `;`, ` / `), `album`, `albumArtist`, `track` / `trackTotal`, `disc` /
`discTotal`, `year`, `date`, `genre` (list), `composer`, `comment`, `description`, `lyrics`, `compilation`, `bpm`,
`show`, `season`, `episode`, `label`, `originalYear`, `mb`, …. Attached pictures do not make an audio file a video.

**ytdlp.js** — references `extractor:id` for YouTube, Vimeo, Dailymotion, SoundCloud, Bandcamp, Twitch, Niconico,
Bilibili and PeerTube (ids carry what the canonical URL needs: `youtube:dQw4w9WgXcQ`, `youtube:PL…`,
`youtube:@handle`, `soundcloud:artist/track`, `bandcamp:artist/album/slug`, `twitch:v123`, `peertube:host/w/<id>`);
other http(s) URLs are `generic`. `infoJob(ref, { flat = true, playlistItems })`: `-J --flat-playlist --no-warnings
--no-progress <url>`. `downloadJob(ref, options)`: `--newline --progress` with two `--progress-template`s
(`[dl] status downloaded total estimate speed eta filename`, `[pp] status postprocessor`) and `--print
after_move:filepath=%(filepath)s` for the final path; modes `best` (yt-dlp's best; the thumbnail as a file, since webm
cannot embed one), `video` (H.264 / AAC in MP4, `-S vcodec:h264,res,acodec:aac`), `audio` (`-x`, `--audio-format`);
`--no-playlist` for single videos. Never cookies or credentials. URLs only reach yt-dlp after `parseSource` accepted
them (no option injection). `infoToCatalog(info)` → catalog entries for videos, music tracks (artist, album, track
number, release year), episodes and playlists (flat entries included).

**magick.js** — IM7 argument order (`input[0] operators output`), parentheses as separate arguments (bash shows them
as `\(`). `coverJob` crop (fill and cut), pad (fit and fill) or none (shrink to fit); JPEG flattens transparency.
`collageJob` 1–4 pictures: whole, halves, half + quarters, 2x2. `identifyJob` prints `%m %w %h`.

**shell.js** — `renderJob(job, shell, { tools, width = 100, batch = false, workDir, progress = true })`. Commands go
through ffcmd/command.js `renderCommand`, so quoting and wrapping are cmdline/quote.js's. Pieces carry refs `job`,
`file:<name>`, `step:<i>`. Auxiliary files:

- bash: `mkdir -p job-<id>` and `cat > job-<id>/name <<'EOF'` (quoted delimiter: nothing expands; another delimiter
  when a line equals it). The file ends with a line break.
- cmd.exe: `echo` cannot write arbitrary text byte for byte (CRLF line ends, the console code page, `% ^ & | < > " !`),
  so the text is written as base64 lines and decoded with `certutil -f -decode` (present on every Windows): the exact
  UTF-8 bytes with LF line ends. REM lines above show the text for reading. Scripts with non-ASCII text start with
  `chcp 65001 >NUL` (save `.bat` files as UTF-8); `batch: true` adds `@echo off`, doubles `%` and stops after a failed
  step.

`progress: false` drops the runner-only flags (`-progress pipe:1 -nostats`, `--newline`, `--progress-template`).

**queue.js** — `createQueue({ concurrency = 1, run, now, maxLog = 400 })` → `add(spec, { id })`, `cancel(id)`,
`retry(id)`, `remove(id)`, `clear(filter)`, `list()`, `get(id)`, `on(listener)` → off, `snapshot()`, `restore(jobs)`,
`setConcurrency(n)`. Jobs: `{ id, kind, title, spec, status: 'queued'|'running'|'done'|'failed'|'canceled'|'interrupted',
progress (0..1, null = unknown), progressText, step (1-based), steps, log, logDropped, created, started, finished, error,
result, vars }`. `run(job, ctl)` gets `ctl = { log, progress, signal, setVar, step }`. Restored running jobs become
`interrupted`; queued ones run.

**runner.js** — `runJob(spec, { spawn, fs, path, os, tools, workDir, signal, log, progress, env, cwd, onStep, onVar,
cleanup })` → `{ outputs, vars, captures, workDir }`. Missing tools fail first (`ENOTOOL`); no shell, `windowsHide`;
UTF-8 decoding across chunks; ffmpeg progress against `step.duration`, yt-dlp progress lines; `filepath=` lines join
`outputs`; abort kills the process tree (`taskkill /pid <pid> /T /F` on Windows, SIGTERM then SIGKILL elsewhere); a
non-zero exit rejects with the last stderr lines. `makeRunner(deps)` gives each job `<workDir or tmp>/mediajobs/<id>`
and removes it afterwards.

## Tests

Exact argv of the builders, ffmetadata and ffconcat texts read back by re-implementations of ffmpeg's readers,
parsers on canned output (progress in chunks of every size, loudnorm, ffprobe JSON of an mp3 with a cover, an mkv with
subtitles and chapters, Ogg, MP4; 45 source URLs and references; yt-dlp template and default lines; yt-dlp JSON of a
video, a music track, a flat playlist, SoundCloud, an episode), tool lookup on fake Windows / macOS / Linux file
systems, the queue, and the runner with a fake spawn. Where they exist, rendered scripts run in bash, as a `.bat` and
typed into cmd.exe with node standing in for the tools (received argv and auxiliary files compared with the job),
node plays ffmpeg for a real two-pass loudnorm and a process-tree kill, and ImageMagick runs real cover, collage,
thumbnail, conversion and identify jobs (also through the queue and through rendered scripts). ffmpeg / ffprobe jobs
run when the tools are found; yt-dlp is only asked for `--version`. Missing tools are reported as skipped.

## Limits

- A user string that literally contains `{work}` or `{var:…}` is substituted too.
- cmd.exe cannot pass a line break inside an argument (rendered as spaces with a note); delayed expansion (`!`) must
  be off (the default). In a cmd window `%name%` of an existing variable expands (use `batch: true` for files).
- Multi-value tags are written joined with `; `; ffmpeg's muxers decide how they land in each format.
- `embedMeta` with a cover on a video file assumes one video stream (the cover becomes the second); the output must
  differ from the input.
- No network access anywhere in the library; yt-dlp jobs run only through the runner.
