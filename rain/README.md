# rain/

The "digital rain" effect: a canvas 2D renderer, its parameters (defaults, schema, presets, random sets, share code)
and the exports of a configured effect (standalone HTML page, embeddable snippet). Pure ES modules: importing them
in Node touches no DOM; only `rainEngine()` itself needs a browser (canvas).

| file | contents |
|---|---|
| `engine.js` | `rainEngine(canvas, params, options)` — the renderer, self-contained so that exports embed it with `Function.prototype.toString` |
| `params.js` | `DEFAULTS`, `SCHEMA`, `normalizeParams`, `engineParams`, `encodeParams` / `decodeParams` (share code), `PRESETS`, `presetParams`, `matchPreset`, `randomParams`, `paramSpec` |
| `glyphs.js` | `GLYPH_SETS` (half-width katakana, latin, digits, binary, hex, symbols, cyrillic, emoji, custom), `SET_KEYS`, `glyphChars(params)`, `graphemes`, `stripEmoji` |
| `export.js` | `effectHTML(params, options)` → `{ html, bytes }`, `embedSnippet(params, options)` → HTML string |

## Renderer

```js
import { rainEngine } from '../rain/engine.js';
import { engineParams, presetParams } from '../rain/params.js';

const fx = rainEngine(canvas, engineParams(presetParams('classic')), { auto: true });
fx.set(engineParams({ ...params, speed: 20 }));   // live update (only what changed is rebuilt)
fx.stop(); fx.start(); fx.toggle(); fx.fps; fx.running;
```

Options: `auto` (start the loop), `width` / `height` / `dpr` (fixed-size rendering, e.g. an offscreen wallpaper or a
recording canvas, instead of following the canvas' CSS box), `ignoreReducedMotion` (the creator's preview). Methods:
`set`, `start`, `stop`, `toggle`, `step(dt)`, `advance(seconds)` (simulate without drawing), `render()`, `resize()`,
`destroy()`, `ready()` (resolves when the background image is decoded).

How it draws: every depth layer is a grid of columns with a glyph buffer per column; falling streams write fresh
glyphs as their head enters a row, and random cells mutate. A frame redraws each visible trail cell from a glyph
atlas (one row per colour tone — head, 8 gradient steps or 12 rainbow hues — with the glow baked in), so trails fade
the same at any frame rate and the background can be a colour, an image or transparent. Bloom adds a blurred,
downscaled copy of the rain layer (`'lighter'`). Far layers are smaller, dimmer and slower; the pointer shifts the
layers by depth (parallax). A message is either rasterised at one pixel per cell (big letters formed by lit glyphs)
or written into the columns; stream heads reveal its cells, it holds, fades and repeats. The loop honours a frame
rate cap, pauses in hidden tabs and shows a still frame when the system asks for reduced motion (unless `motion` is
`'ignore'`).

## Parameters

`SCHEMA` lists every parameter as `[key, share code, type, …range]`. Main ones: `sets`, `custom`, `font`
(`gothic` / `mono` / `sans` / `serif`, system fonts only), `size`, `mirror`, `bold`, `spacing`, `drops`, `speed`,
`variance`, `trail`, `fade`, `mutate`, `flicker`, `direction` (`down` / `up`), `colorMode` (`gradient` / `rainbow`),
`color1`, `color2`, `head`, `rainbowSpeed`, `glow`, `headGlow`, `bloom`, `bgMode` (`color` / `transparent` / `image`),
`bg`, `bgImage` (data: URL), `bgDim`, `layers` (1–3), `depth`, `parallax`, `msg`, `msgStyle` (`big` / `inline`),
`msgHold` (0 = forever), `fps` (0 = display rate), `motion` (`respect` / `ignore`), `seed`.
`normalizeParams` never throws: unknown keys are dropped, numbers clamped and stepped, enums and colours checked.

Share code: `'r1.' + base64url(UTF-8 JSON of the non-default values keyed by their short codes)`. The background
image is never part of a code. `decodeParams` accepts a bare code, `#code` or a whole URL and returns `null` for
anything that is not a valid code.

## Exports

`effectHTML(params, { title, lang, label, hint, button, buttonLabel, saver, withImage, minify })` builds one offline
HTML file: the engine and a small boot function serialized with `toString`, the parameters as JSON (`<` escaped),
everything minified with `minify/` (whitespace only, no renaming). The page goes full screen on double-click / F,
pauses with Space; screensaver mode hides the idle pointer, enters full screen on click and holds a screen wake lock.
`embedSnippet(params, { id, height, label })` returns a `<canvas>` plus a classic script that animates only while
visible (IntersectionObserver). Neither contains a network API, a remote resource or a font file (`policy.js`).

## Limits

- Glyphs come from system fonts: half-width katakana need a CJK-capable font (present on Windows, macOS, most
  Linux desktops); elsewhere the browser falls back.
- At most 160 distinct glyphs; very large sizes shrink the glyph set to keep the atlas within 4096 × 4096 px.
- Emoji render in their own colours (gradient tones do not apply) and are therefore opt-in.
- `ctx.filter` blur for bloom is used where supported; elsewhere the downscale alone softens the glow.
