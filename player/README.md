# player

**Media player logic.** What a player decides, as pure functions over plain data: the queue and its shuffle modes,
timers and markers, levels and the equalizer, honest audio analysis, keyboard shortcuts, D-pad navigation for the
10-foot mode, and the two models a user constructs — skins and player layouts. No DOM: the application turns these
into WebAudio graphs, media elements and markup. Importable in Node.

| module | contents |
| --- | --- |
| `queue.js` | the play queue: items, play order, position, repeat off / all / one, shuffle random / artist spread / album / smart (weighted), play next, add to queue, remove, move, history, seeded shuffles |
| `timers.js` | sleep timer (minutes with a fade-out, end of track / chapter / queue), A-B repeat, intro / outro / recap / preview markers from chapter names, the marker at a position ("Skip intro"), resume decisions, the next-episode countdown, chapter skips |
| `gain.js` | ReplayGain track / album with preamp and clipping prevention, loudness normalization to a target, the level of a media item, crossfade curves (equal power, linear, S), ten-band EQ presets, playback speeds |
| `analysis.js` | ITU-R BS.1770 / EBU R128 integrated loudness (K-weighting, gating), loudness range, sample peak, a spectral-flux tempo estimate with confidence, spectral centroid, an energy heuristic, waveforms for seek bars, a radix-2 FFT |
| `keys.js` | the default keyboard map (media keys, TV remote keys), key specs, event matching (fields keep their keys), user overrides, conflicts |
| `nav.js` | spatial navigation: the element an arrow / D-pad press moves focus to, from element rectangles |
| `skins.js` | design tokens, seven built-in skins (Symphony with dynamic colour, Classic, Minimal, OLED black, Home theatre, Paper, Neon), normalization of shared skins, Material-You-like tonal roles from a seed colour, the seed colour of a cover picture, CSS custom properties (also mapped onto ui/base.css tokens), WCAG contrast checks |
| `layouts.js` | the layout constructor's model: 40 control types with options, rows with alignment, panels, gestures, the mini player's controls, eight built-in layouts (Symphony, Classic, Minimal, Audiobook, Home theatre, Video, Karaoke), editing operations, warnings |
| `test.js` | `node player/test.js` (also `node check.js tests player`) |

## Honesty of the analysis

Loudness is the standard algorithm (the test checks the BS.1770 reference: a full-scale 997 Hz sine on one channel
reads −3.01 LUFS). Tempo is an estimate: the strongest periodicity of the onset envelope between 60 and 200 BPM with a
prior around 120, so half / double tempo errors happen; the confidence says how clear the peak was. Energy is a
documented heuristic (loudness, onset density, tempo, brightness), meant for mood playlists, not as a measurement.
