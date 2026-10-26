# video-processor

A TikTok / Instagram-style video editor in one HTML file (standalone class: zero network, works from `file://`), with
a second mode that shows every edit as the equivalent **ffmpeg** command for **bash** or **cmd.exe**. Files are opened
from the device and leave it only as downloads.

## Two modes

- **Edit** — free editing: the timeline, the preview with direct manipulation (move / scale / rotate overlays, pan and
  zoom a clip in the frame, draw on the video), the picture editor for frames and pictures, the inspector.
- **Transform · ffmpeg** — the same project as ffmpeg commands: one command with `-filter_complex`, or a short
  script of steps (one command per clip → `part01.mp4`…, one join with the transitions, one for text, stickers and
  music). The operations of the selected element are listed with their filters; the command text is split into
  pieces that know their element: pointing at a piece highlights it on the timeline, clicking selects it, and the
  selected element's pieces are highlighted. Notes explain what ffmpeg cannot express exactly (free-hand drawings,
  emoji and rotated text become PNG overlays the page can save; zoom / pop / typewriter animations become fades;
  drawtext uses fontconfig font names). Copy, save as `.sh` (with `set -e`) or `.bat` (`%` doubled), download the PNG
  files the command reads. The commands are text only: nothing runs them. The codec options follow the export
  settings (format, resolution, quality / bit rate).

## Features

- **Media**: video, audio and pictures (drop anywhere on the page, paste, pick): WebM / Matroska, MP4 / MOV / M4A, Ogg,
  WAV, MP3, FLAC, PNG / JPEG / WebP / GIF / SVG — whatever the browser decodes. MediaRecorder WebM without duration /
  cues is fixed on open (`webm/fix.js`). Media info of every file (container, tracks, codecs, tags, cover).
- **Timeline**: a magnetic main track (clips and stills back to back, filmstrip thumbnails), overlay rows (text,
  stickers, pictures, drawings) and audio rows (waveforms). Click to select, drag clips to reorder, drag overlays and
  audio clips in time and between rows, drag edges to trim (the main track ripples), split, duplicate, delete, freeze
  frame, transition chips between clips; ruler and playhead scrubbing, zoom (buttons, slider, Ctrl + wheel, fit),
  snapping to edges and the playhead.
- **Clips**: trim (in / out), speed 0.1×–8× with pitch-preserving sound (or tape-like pitch), volume up to 400 %, mute,
  sound fades, picture fades from / to black; framing per clip or project (fit with bars, fill, fit over a blurred
  copy), zoom and pan in the frame, quarter turns, mirrors; looks (Vivid, Warm, Cool, Mono, Noir, Sepia, Vintage,
  Cross, Matte, Drama) with thumbnails and brightness, contrast, saturation, warmth, hue, vignette.
- **Pictures**: a still lasts its *frame time* (seconds, presets, or drag its edges); Ken Burns pan / zoom presets with
  start / end zoom; edit a picture or paint on a frame in the picture editor.
- **Transitions** between clips (ffmpeg xfade names): crossfade, through black / white, wipes, slides, circle open /
  close, zoom in; duration, apply to every cut. The next clip starts while the previous ends (sound cross-fades too).
- **Overlays** with a time range: text (6 font families, size, colour, bold / italic, alignment, outline, shadow,
  background box, style presets), emoji stickers, pictures, free-hand drawings (pen, marker, neon); opacity, position,
  scale, rotation; animations in / out (fade, slides, zoom, pop, typewriter).
- **Slideshow from music and pictures**: pick a song and pictures (drop), reorder, caption, durations fitted to the
  song or seconds per picture, transitions (or random), Ken Burns (alternating, random, a preset), format; the result
  opens in the timeline.
- **Formats** 9:16, 1:1, 4:5, 16:9; background colour; 24–60 fps.
- **Preview** player: play / pause, frame steps, start / end, scrubber, time; selection frame with handles.
- **Undo / redo** of every change (slider drags merge into one step).
- **Project files**: save as ZIP with the media (`.vproject.zip`) or as JSON without them (`.vproject.json`; drop the
  media files to relink). Opening a file replaces the project.
- **Export**: WebM (VP9 / VP8 / AV1 + Opus) or MP4 (H.264 / AV1 / VP9 + AAC or Opus) through WebCodecs and the repo's
  muxers, 360p–2160p, project or chosen frame rate, quality preset or bit rate, with or without sound, progress and
  cancel. Without WebCodecs: real-time recording of the preview engine with MediaRecorder. Audio only: WAV, MP3, Ogg
  Opus, WebM. Current frame: PNG / JPEG at the export size.
- Keyboard: Space play · J K L back 1 s / pause / play · ← → frame (Shift 1 s) · ↑ ↓ previous / next cut · S split ·
  Q W or `[` `]` trim to the playhead · Delete · Ctrl+D duplicate · Ctrl+Z / Ctrl+Y · T text · D draw · + − 0 zoom ·
  Ctrl+S save · Ctrl+O open · Ctrl+E export · Esc.

## The picture editor hook

`painter.js` holds a built-in markup editor (brush, marker, eraser of the paint, line, arrow, rectangle, ellipse,
text, colours, size, undo / redo, brightness / contrast / saturation). Another editor (e.g. the image processor's
Photoshop-like core) can replace it:

```js
import { setImageEditor } from './painter.js';
setImageEditor(async (bitmap, { title }) => {
  // show an editor for the ImageBitmap; resolve with an ImageBitmap or a canvas, or null when cancelled
});
```

The result becomes a new picture (`edited-N.png`, origin "edited") that replaces the still or overlay; the ffmpeg
description lists it as a picture file to save.

## Files

| file | contents |
|---|---|
| `index.html` | the page |
| `main.js` | state, layout, toolbar, import / open / save, selection, undo / redo, keyboard |
| `media.js` | media store: bytes, playback URLs, probe, stills, filmstrip thumbnails, waveform peaks, decoded audio |
| `compose.js` | frame renderer shared by preview, export and frame grabs (framing, colour filters, transitions, overlays), PNG assets of the commands |
| `engine.js` | preview player: clock, hidden media elements in sync, Web Audio gains (volume, fades, cross-fades) |
| `tlview.js` | timeline view: ruler, rows, clips, transition chips, drags, snapping, zoom |
| `stage.js` | preview canvas, selection frame, clip pan / zoom, draw mode |
| `inspector.js` | editing panel of the project, clips, transitions, overlays, audio clips |
| `commands.js` | Transform panel: commands, operations, notes, highlighting, script and asset downloads |
| `painter.js` | `editImage` / `setImageEditor` and the built-in picture editor |
| `slides.js` | slideshow dialog |
| `exportdlg.js` | export dialog |
| `export.js` | encoder capabilities, WebCodecs export, real-time fallback, audio export |
| `probe.js`, `info.js` | container probing and the media info panel |
| `geometry.js` | time format, bit rate presets |
| `strings.js` | UI strings (en, ru, uk, de, fr, es, ka) |
| `app.css` | styles on top of `ui/base.css` + `ui/app.css` |
| `server.js` | development server |

Libraries: `timeline/` (project model, editing, history, colour, audio mix, slideshow, files, ffmpeg description),
`ffcmd/` (filter graphs, escaping, encoder options, shell text with references), `cmdline/` (bash / cmd.exe
quoting), `webm/`, `mp4/`, `weba/`, `ogg/`, `mp3/`, `wav/`, `zip/`, `ui/`.

## How the commands mirror the edit

Both the browser renderer and the description read the same numbers (`timeline/frame.js`, `timeline/color.js`,
`timeline/audio.js`): trim → input `-ss` / `-t`; speed → `setpts=(PTS-STARTPTS)/s` + `atempo` (chained for big
changes) or `asetrate`; quarter turns → `transpose` / `hflip,vflip`; framing → `scale…force_original_aspect_ratio` +
`pad` / `crop`, or `split` + `gblur` + `overlay` for the blurred background; looks → `curves`, `colorchannelmixer`,
`eq`, `colortemperature`, `hue`, `vignette`; stills → `-loop 1 -t`; Ken Burns → `zoompan` with linear expressions;
freeze frames → `-ss` + `trim=end_frame=1,tpad` (steps: `-frames:v 1`); joins → `concat`, transitions → `xfade` +
`acrossfade` at the clip offsets; fades → `fade` / `afade`; text → `drawtext` (`expansion=none`, alpha and slide
expressions, `enable=between(t,a,b)`); pictures → `overlay` (+ `rotate`, `colorchannelmixer=aa`, alpha fades); music
→ `adelay` + `amix=normalize=0`; padding → `tpad`; output → `-c:v libx264 -crf … -pix_fmt yuv420p -movflags
+faststart` etc. Filter values use ffmpeg's own backslash escaping (`\:` `\'` `\,` …, never `'…'`), so the graph is
the same for both shells; only the shell quoting around it differs (bash `'…'`, cmd.exe `"…"`, `^` continuations).
The library tests parse every generated graph back like ffmpeg does and check pads and option names; ffmpeg itself
is not run.

## Limits

- Files are held in memory; long, high-resolution projects need RAM (the export decodes clips one by one).
- The preview plays media elements kept in sync with a clock: on slow machines it may skip frames; the export is
  frame-exact. Colour looks use SVG colour-matrix filters on the canvas (a slower pixel fallback where canvas filters
  are missing); they approximate ffmpeg's YUV `eq` / `curves` closely, not bit-exactly. Transitions follow ffmpeg's
  xfade formulas (zoom in and the soft circle edges approximately).
- Text is drawn with the browser's fonts; ffmpeg's drawtext uses fontconfig names (Arial, Georgia, Courier New,
  Impact, Trebuchet MS, Comic Sans MS) and may look different. drawtext places lines by baseline per line.
- No picture-in-picture video overlays, keyframe animation curves, or reverse playback; overlays of a row may not
  overlap (a busy row moves the item to the next one).
- The real-time fallback (no WebCodecs) records at playback speed. HEVC and Vorbis / FLAC / Theora decoding depend on
  the browser. EXIF rotation of photos follows the browser; ffmpeg versions differ in applying it.
- ffmpeg features used need a recent build (colortemperature, amix normalize, anullsrc duration: FFmpeg ≥ 5.1).
