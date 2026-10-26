# catalog

**Media catalogue.** The model behind the media player: works and their media in three presence levels, virtual
tags, a query language, smart and mood playlists, collections, workspaces, tracking like MyAnimeList / Shikimori with
a play history and statistics, index sources with rules, virtual covers, export / import with merge, and the formats
of other programs. Pure ES modules, no DOM, importable in Node (the backend and Electron use the same code and the same
schema as the browser).

| module | contents |
| --- | --- |
| `model.js` | node types and kinds, presence levels, location kinds, tracking statuses, `normNode` (bounded, typed copy of untrusted nodes), constructors, people, titles, sort and match keys |
| `db.js` | the in-memory store: indexes (type, children in play order, media of a work, match keys), batches, the revision log (`changesSince`) for sync, undo, `apply` of remote ops, snapshots, `memo` for derived data |
| `tags.js` | namespaced tags, hierarchy by path, aliases and implications (tag definitions), inheritance down containers and up from media, counts, suggestions, add / remove / rename / merge / delete |
| `facts.js` | the flattened record of a work (own fields + containers + media + tracking) shared by queries, sorting, browsing and statistics |
| `query.js` | the query language: words, `field:value`, tags `ns:value` / `#tag`, comparisons, ranges, lists, units (durations, sizes, dates and ages), `has:` / `is:` / `presence:` / `in:` / `source:`, AND / OR / NOT / parentheses (lenient parser), sorting, `explain` |
| `smart.js` | smart playlists (query, pick, sort, limits by count / minutes / size, artist spread, seeded shuffles), mood / time-of-day mixes, presets, expanding containers into what plays |
| `collections.js` | manual playlists, smart, mood, groups, libraries; item operations; durations; collage sources |
| `workspaces.js` | custom folder trees of references with virtual (query) folders, moves without cycles, normalization |
| `tracking.js` | statuses, progress, scores, dates, repeats; where an item's tracking lives (anime seasons are entries); scrobble rules; resume positions; history; next episode and the continue list; statistics (time per domain, days / hours / weekdays, statuses, score distribution, genres, artists, shows, years, streaks) |
| `presence.js` | file / source / nominal: attach a file, attach a link or yt-dlp reference, detach, missing files, nominal information (lyrics, cover, text), choosing what to play for an artifact's capabilities, upgrade options |
| `covers.js` | the cover chain, deterministic generated covers (8 styles, OKLCH palettes from a title hash), 2×2 collages |
| `browse.js` | library views: sections, artists, albums and editions, discs, genres, years, decades, shows / seasons with specials, authors, book series, people, recent, search across everything |
| `indexer.js` | index sources (folder, File System Access, remote file API, links, yt-dlp) and their rules: include / exclude globs, path templates, filename parsers, embedded tags, NFO / CUE / LRC / subtitle / cover sidecars, field precedence, locked fields as manual overrides, compilation detection, CUE splits, incremental re-scans with hashes for moved files, missing files downgraded; link lists and yt-dlp playlists |
| `exchange.js` | export of the descriptive tree (no files, no machine paths) and of the whole database (JSON, or ZIP with the blob store), import with merge by id and match keys, policies `newer` / `keep` / `theirs` / `copy`, reference remapping |
| `interop.js` | MyAnimeList XML and Shikimori JSON lists (import / export, "Title Season 2" entries become seasons), M3U8 / XSPF / PLS playlists (export, import with matching), Kodi NFO, CUE sheets of albums and chapters |
| `demo.js` | demo content without copyrighted media: synthesized WAV pieces (real files), public-domain works as nominal entries, every kind and presence level, playlists, a workspace |
| `test.js` | `node catalog/test.js` (also `node check.js tests catalog`) |

## The model in short

- A **work** is what you watch, hear or read (track, album, book, book series, show, season, episode, movie, music
  video, podcast, chapter); its **media** are its representations: one work, many files, sources, versions,
  qualities, languages, subtitle tracks. Containers (`parent`) give the hierarchy: album → tracks, show → seasons →
  episodes, series → books → chapters, podcast → episodes. A **domain** (music, audiobook, anime, series, movie,
  musicvideo, podcast) places a work in a library section; children inherit it.
- **Presence** of a work is the best presence of its media: `file` (a real file: backend / Electron path, File System
  Access handle, another server's file API, the blob store, a direct URL), `source` (a link or `extractor:id` that
  yt-dlp can stream or download), `nominal` (only a description — a card that cannot play). Works without media are
  nominal. Scans downgrade files that disappeared; attaching a link or a file upgrades.
- **Tags** are strings `namespace:path/sub` on any node. Effective tags add ancestors (`genre:rock/punk` → `genre:rock`),
  implications and aliases of tag definitions, the tags of containers (album → tracks) and of media (→ their work).
  Fields and tag namespaces share the query syntax: `energy:>6` is the number, `energy:low` the tag.
- **Tracking** sits where an entry is: a movie, album, book or podcast itself; an episode's season when the season is an
  entry (anime) or already tracked, else its show. Finished children raise the progress; the last one completes the
  entry; a replay of a completed entry is a repeat.
- **Merging** imports never duplicate what they can recognise: ids first, then keys (`src:` source references,
  `id:mal:…` external ids, `hash:`, `ix:` index keys, `t:<kind>:<title>` titles of top-level works including
  alternative titles).

## Limits

The store is in memory (tens of thousands of works are fine; queries scan the facts, which are cached per change).
Tempo, loudness and energy come from tags, manual tags or the player's in-browser analysis — nothing here listens to
audio. MyAnimeList / Shikimori exchange works with the files those services export; nothing talks to their servers.
