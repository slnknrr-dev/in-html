# raster

Pure pixel operations on RGBA images `{ width, height, data: Uint8ClampedArray }` (no DOM: pages, workers and Node).
Used by the image processor and the photo editor (`photo/`); any tool that edits pixels can use them.

## resample.js

`resize(img, width, height, filter = 'lanczos3' | 'area' | 'bilinear')` — separable resizing on premultiplied alpha
(transparent edges do not darken), filters widened for downscaling; horizontal passes stream through a small row
cache so memory stays near the output size.

## ops.js

- Geometry: `rotate90(img, deg)`, `flip(img, horizontal, vertical)`, `orient(img, exifOrientation)`,
  `straighten(img, deg)` with `straightenScale(w, h, deg)` (auto-crop factor), `cropImage(img, rect)`,
  `resolveCrop(W, H, crop)`, `resizeTarget(w, h, settings)`, `ASPECT_KEYS`, `aspectRatio(key, w, h)`.
- Tone and colour: `adjustColors(img, adjustments, filters)` (per-channel lookup tables plus one affine colour
  matrix), `isNeutral(adjustments, filters)`.
- Filters: `blur(img, sigma)` — the true gaussian with ImageMagick's `-blur` kernel (`gaussianKernel(sigma, rank)`,
  `gaussianBlur(img, sigma, rank)`: rank 3 = `-blur`, rank 1 = `-gaussian-blur`) up to 31 taps (sigma ≈ 3.7), three
  box passes (`boxBlur`) beyond, `blurIsExact(sigma)` tells which; `sharpen(img, amount, radius, threshold)` (unsharp
  mask with ImageMagick's threshold rule), `vignette(img, amount)`.
- Compositing: `composite(img, layer, x, y, opacity)` ("over"), `flatten(img, background)`.

## wand.js

Magic wand and background removal as in Krita / Paint.NET: `wandMask(img, x, y, { tolerance, contiguous, diagonal,
metric: 'max' | 'rgba' | 'perceptual', soft, antialias })` (full-size coverage mask), `growMask`, `featherMask`,
`clearMask(img, mask, { decontaminate })` (transparent, with the old background colour unmixed from the edge),
`seedPoints`, `removeBackground(img, opts)` (contiguous wands from the corners / edges). Used by the photo editor's magic
wand, the image processor's background removal and `icon-creator`.

## magick.js

The same operations as ImageMagick 7 arguments, for applications that show what they do as a command
(`cmdline/` turns the arguments into bash / cmd.exe text). Each builder returns a step
`{ id, args: [[option, value…], …], fidelity: 'exact' | 'approx' | 'none', note?, sized? }` or null:
`orientStep`, `rotateStep`, `flipStep`, `straightenStep(deg, size)`, `cropStep(crop, size)`,
`resizeStep(settings, size)`, `colorSteps(adjustments, filters)`, `blurStep`, `sharpenStep`, `vignetteStep`; helpers
`num`, `matrixText`, `brightnessContrastArg(slope, offset)`. With a size `{ w, h }` the arguments carry that image's
pixel numbers; without one (batch loops) they stay size-independent (geometry flags `> ^ !`, `%w`, aspect crops
`-crop 16:9`, `%[fx:…]` escapes).

| operation | ImageMagick | fidelity |
| --- | --- | --- |
| rotate 90 / 180 / 270, flips, auto-orient | `-rotate`, `-flop`, `-flip`, `-auto-orient` | exact |
| crop (pixels, aspect presets, relative rectangles) | `-crop WxH+X+Y +repage`, `-gravity center -crop 4:3`, fx escapes | exact (relative rectangle with a locked aspect in batch: approximate) |
| straighten | `-distort SRT` into a viewport of the inscribed size (bilinear, point filter) | exact; batch form approximate (half-pixel centring) |
| resize fit / fill / exact / percent | `-resize` with `> ^ !` (Lanczos, Triangle), `-scale` (area, shrinking) | exact (area with an unknown direction: approximate) |
| brightness / contrast, gamma, temperature | `-brightness-contrast` (7.1 formula), `-gamma`, `-color-matrix` | exact |
| saturation, hue, grayscale, sepia, invert | one `-color-matrix` / `-colorspace Gray`, `-negate`, `-clamp` between | exact |
| gaussian blur, unsharp mask | `-blur 0xσ`, `-unsharp 0xσ+amount+threshold` | exact up to σ ≈ 3.7, approximate beyond |
| vignette | `-channel RGB -fx …` (the same smoothstep) | exact (slow in ImageMagick) |

## test.js

`node raster/test.js`: unit tests, then — where ImageMagick 7 is installed (`magick` on the PATH, `MAGICK=<path>`, or
`C:\Program Files\ImageMagick-7*`) — every step above runs through `magick` on synthetic images (even and odd sizes,
with and without alpha, single-image and batch forms) and is compared with the JS result: exact steps must match up
to rounding (at most 0.1 % of the values off by more than 2 levels), approximate ones must stay close. `VERBOSE=1`
prints every comparison. Exports `findMagick`, `synthImage`, `pixelDiff`, `withinFidelity`, `magickRun` for other
tests.
