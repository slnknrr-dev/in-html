# timeline/

The video project of the video processor as plain data and pure functions (Node-importable, no DOM): the model and
its layout on the timeline, editing operations, undo history, colour adjustments, the audio mix, the slideshow
builder, project files and the description of a project as ffmpeg commands.

| file | contents |
| --- | --- |
| `model.js` | project schema and `normalizeProject` (hostile input → valid project), `layout` (clip positions with transitions), `activeAt`, `sourceTime`, `clipLength`, `frameSize`, constants (`ASPECTS`, `TRANSITIONS`, `ANIMS`, `FONTS`, `KENBURNS`) |
| `edit.js` | `addMedia`, `addClip`, `addAudio`, `addOverlay`, `split`, `trimTo` (main clips ripple), `moveMain`, `moveItem`, `duplicate`, `remove`, `setSpeed`, `setTransition`, `insertStill`, `replaceMedia`, `snapPoints` / `snap`, `freeRow` |
| `history.js` | `History`: snapshot undo / redo with merging of quick successive changes (slider drags) |
| `frame.js` | shared output geometry: `placement` (fit / fill / blurred background, zoom, pan, quarter turns), `coverCrop` + `kbWindow` (Ken Burns), `textLayout`, `animState` |
| `color.js` | adjustments → operations (`curves`, `mixer`, `eq`, `temperature`, `hue`, `vignette`), looks (`PRESETS`), `colorPlan` (curve tables + 3×4 matrix), `applyPlan`, `kelvinRGB` (ffmpeg colortemperature), `curveTable` (natural cubic spline like ffmpeg curves), `vignetteFactor` |
| `audio.js` | `audioPieces`, `gainAt` (volume × fades × cross-fades), `timeStretch` (WSOLA, pitch kept like atempo), `resample` (pitch follows), `renderPiece`, `mixInto`, `mixdown` |
| `slideshow.js` | `buildSlideshow` (stills, transitions, Ken Burns, captions, audio), `slideDurations` (fit to the audio length) |
| `file.js` | `projectJSON` / `parseProject`, `packProject` / `unpackProject` (ZIP with the media) |
| `ffmpeg.js` | `describe(project, { mode, format, short, quality, … })` → steps (argv for `ffcmd/command.js`), operations per element, notes, assets |
| `test.js` | `node timeline/test.js` |

## Model

A project has media, a magnetic **main track** (video clips and stills, back to back), **overlay rows** (text, emoji,
pictures, drawings with a time range) and **audio rows**. A transition of duration *d* after clip *i* makes clip *i+1*
start *d* earlier, exactly like ffmpeg's `xfade` / `acrossfade` (*d* is clamped to half of either clip). Stills keep
their duration in `out - in` ("frame time"); video clips play `in…out` at their speed. Project length = the end of
whatever ends last; the main track is padded with the background colour.

## Two renderers, one description

The browser renderer and the ffmpeg description read the same numbers: `frame.js` places clips and text, `color.js`
turns adjustments into the same operation list (the browser applies a colour matrix and curve tables, ffmpeg gets
`curves`, `colorchannelmixer`, `eq`, `colortemperature`, `hue`, `vignette`), `audio.js` mixes with the ramps of
`afade` / `acrossfade`. `ffmpeg.js` maps every operation it can (trim → `-ss/-t`, speed → `setpts` + `atempo`
or `asetrate`, quarter turns → `transpose`, framing → `scale` + `pad` / `crop` or a `gblur` background, Ken Burns
→ `zoompan`, joins → `concat` / `xfade` / `acrossfade`, text → `drawtext`, pictures → `overlay` with
`enable='between(t,a,b)'`, music → `adelay` + `amix`) and lists notes for what it approximates or cannot express
(drawings, emoji and rotated text become PNG overlays the editor saves; zoom / pop / typewriter animations become
fades).

## Tests

`test.js` checks normalization of junk, the layout with transitions, every editing operation, history merging,
colour maths (ffmpeg's kelvin table, spline curves), WSOLA (length and a 440 Hz tone keep their pitch), the slideshow
durations, ZIP round trips and the ffmpeg description: each generated graph is parsed like ffmpeg reads it
(`ffcmd/parse.js`), its pads are checked and every filter / option name is checked against the documentation.
