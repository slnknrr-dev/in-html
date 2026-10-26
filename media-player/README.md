# Media Player

A media player in the general sense: music, audiobooks, series, anime, movies, music videos and podcasts in one
catalogue; real files, links that yt-dlp can stream or download, and **cards** known only by their description; virtual
tags, smart and mood playlists, tracking like MyAnimeList / Shikimori, a converter around yt-dlp / ffmpeg /
ImageMagick, and a look and player you construct yourself (Symphony-like Material You by default). It ships as a
desktop application (Electron), a home media server (Node) and a browser-only static site.

## Artifacts

| NOTICE | artifact | what it can do |
| --- | --- | --- |
| `ELECTRON_NOTICE.md` | `html@5_electron/` — `npx electron .` | files directly (native dialogs, drops with real paths), the server in-process (scans, jobs, yt-dlp / ffmpeg / ImageMagick from PATH), media keys, tray, mini window |
| `BACKEND_NOTICE.md` | `html@5_backend/` — `node server.mjs` | a home media server: owner / guest tokens, several roots, the same API for any page, other devices and the serverless build |
| `SERVERLESS_NOTICE.md` | `html@5_serverless/` — any static host | IndexedDB catalogue, picked / dropped files, File System Access folders, servers you configure; commands to run yourself; in-browser conversion |
| `SINGLEFILE_OFFLINE_NOTICE.md` | `html@5_offline_singlefile/index.html` — open from disk | one self-contained file with no network code: IndexedDB catalogue, picked / dropped files and folders, tags, playlists, tracking; no links, servers or converter jobs |

The three use the same pages and the same catalogue schema; the backend and the Electron build run the same
`backend.js` (the hosting.js contract: in Electron through the private `in-html://media-player/` scheme, no port).
Development: `node media-player/server.js` (set `MP_ROOTS` to index real folders; the backend runs trusted).

## Features

- **Kinds and hierarchy** (catalog/): tracks in albums (discs, compilations, editions / release groups), audiobooks in
  series with chapters (files, m4b chapters or CUE), shows with seasons, episodes and specials (anime: TV / movie /
  OVA / ONA / special, absolute and per-season numbers, romaji / native / English titles), movies, music videos,
  podcasts. A work is separate from its media: versions, qualities, languages, subtitle tracks.
- **Three presence levels** everywhere (badges, filters `presence:`, "Make playable"): *file* (backend / Electron path,
  File System Access, another server, the blob store, a direct URL), *source* (a link or `extractor:id`: streamed by
  the server's yt-dlp proxy or downloaded into a file), *card* (cover, lyrics, metadata only). Upgrades and downgrades:
  attach a link or a file, download, a missing file falls back to its link or to a card.
- **Library views**: home (continue, the mix of the hour, recent, shelves), artists / albums / tracks / genres / years,
  authors / series, shows with seasons and next episode, artist / author / tag pages, search with the query language
  (`artist:… year:1990..1999 -mood:sad presence:file duration:<5m added:<30d has:lyrics`).
- **Tags**: namespaces, hierarchy, aliases, implications, colours; on works, files, playlists, workspace folders;
  rename / merge / delete across the catalogue.
- **Playlists**: manual (reorder, drag), smart (query, kinds, pick, sort, limits by count / minutes, artist spread),
  mood / time of day, groups; collage covers; M3U8 / XSPF / PLS import and export.
- **Tracking**: statuses, 10-point scores, progress, dates, rewatches, history, statistics (time, sections, scores,
  genres, artists, shows, hours, days, streaks); MyAnimeList XML and Shikimori JSON import / export from files.
- **Workspaces**: folder trees of references with virtual (query) folders, their own skin, layout and view.
- **Sources and rules**: server / Electron folders, File System Access folders, another server's folders, link lists,
  yt-dlp playlists; include / exclude globs, path templates, filename parsers (scene, fansub, audiobook), tags,
  sidecars (NFO, CUE, LRC, subtitles, covers), precedence, locked fields (manual overrides), moves by hash, a preview
  of what the rules make of real paths.
- **Playback**: gapless preloading, crossfade, ReplayGain / measured loudness, ten-band EQ with presets, speed with
  pitch kept (per section), sleep timer with fade, A-B repeat, bookmarks, resume positions, CUE segments, subtitles
  (SRT / ASS / VTT → WebVTT), intro / outro markers and "Skip intro", next-episode countdown, watched threshold,
  shuffle modes (random, artists apart, albums, favourites more often), Media Session, keyboard shortcuts, mini player,
  home-theatre mode with D-pad navigation, mobile mode with bottom tabs and a now-playing sheet with gestures.
- **Analysis in the browser** (player/): integrated loudness (EBU R128), a tempo estimate with confidence, an energy
  heuristic and the waveform of the seek bar — stored on the file, used by levels and mood playlists.
- **Converter**: audio / video conversion, remux, extract, two-pass loudness normalisation, split by CUE / chapters,
  join chapters into m4b, tags / covers / chapters, ffprobe, frames and collages as covers, yt-dlp information and
  downloads (format, audio only, subtitles); progress, logs, cancel, retry; every job's command for bash and cmd.exe.
  Without a server: the same commands to copy, and WAV / MP3 / Opus-WebM conversion in the browser.
- **Studio**: skins (every token, light and dark, dynamic colour from the cover, contrast report, JSON), player
  layouts (rows of 40 control types with options, panels, gestures, mini-player buttons, live preview, JSON), covers
  (8 generated designs with hues, texts and patterns, uploads, video frames, collages).
- **Export / import**: the descriptive tree (no files or machine paths), the database as JSON or ZIP with the blobs;
  merge by ids and keys with the policies newer / keep / theirs / copy.
- **Demo**: synthesized pieces (real WAV files), public-domain works as cards, an anime with tracking, an audiobook,
  a podcast, playlists and a workspace — nothing copyrighted.

## Files

`index.html`, `main.js` (boot, shell, routes, keys, Electron), `env.js` (artifact, servers, tokens), `store.js`
(IndexedDB / server catalogue, blobs), `access.js` (locations → URLs, folders, scans), `engine.js` (playback),
`ui.js`, `views.js` (library), `manage.js` (playlists, tags, tracking, workspaces), `tools.js` (sources, converter,
settings), `studio.js`, `nowplaying.js`, `edit.js`, `jobs.js` (job parameters → mediajobs specs), `backend.js`,
`server.js`, `strings*.js` (7 languages), `app.css`, `player.css`, `electron.json`, `e2e.js`, `test.js`.
Libraries: `catalog/`, `player/`, `mediatags/`, `mediajobs/`, `fileapi/`.

## Checks

```bash
node check.js tests media-player catalog player mediatags mediajobs fileapi
node singlefile.js media-player
node check.js electron media-player
node check.js e2e media-player/html@5_serverless/index.html media-player/e2e.js
node check.js e2e media-player/html@5_serverless/index.html media-player/e2e.js --mobile --size 390x844
```

## Limits

- Browsers decode what they decode: MKV / AVI / HEVC / AC-3 depend on the browser (Electron is Chromium); embedded
  subtitle streams of MKV are not shown (sidecar files are), and a choice of audio tracks needs the browser's
  `audioTracks`.
- Media of another origin (a remote server, a direct URL) plays without the WebAudio chain (no EQ / level there).
- yt-dlp streaming proxies one progressive format (≤ 720p for many sites); higher qualities need a download.
- Tracking imports read exported files only; nothing talks to MyAnimeList or Shikimori.
- The serverless build reads folders only in Chromium browsers (File System Access).
