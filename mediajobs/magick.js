// mediajobs/magick.js - ImageMagick jobs for covers and thumbnails (magick, IM7 argument order: input, operators,
// output; parentheses as separate arguments, which cmdline/quote.js writes as \( \) for bash). The same argv works
// with ImageMagick 6's `convert` (tools.js falls back to it outside Windows). Inputs are read as their first frame
// ([0]: animated GIFs, PDFs, multi-page TIFFs give one picture).
//
//   coverJob({ input, output, size = 600, format: 'jpg'|'png'|'webp', quality = 90, fit: 'crop'|'pad'|'none',
//              background = '#000' })   crop: fill the square and cut the overflow (centre); pad: fit inside and
//                                       fill the rest with background; none: only shrink to fit inside size x size.
//                                       JPEG output flattens transparency onto background; metadata is stripped.
//   thumbJob({ input, output, size = 256, quality = 85, background = '#fff' })   fit inside, never enlarged
//   collageJob({ inputs: [1..4], output, size = 600, gap = 0, background = '#000', quality = 90 })
//              1: the picture; 2: two halves side by side; 3: one half on the left, two quarters on the right;
//              4: a 2x2 grid (more than 4: the first 4). Every cell is filled (crop to the cell).
//   convertJob({ input, output, resize, quality, firstFrame = true })   resize: ImageMagick geometry ('800x800>')
//   identifyJob(input) -> one step: <input>[0] -format "%m %w %h\n" info:  (capture 'text', parse 'identify')
//   parseIdentify(text) -> { format, width, height } | null (the format above, or identify's default line)
//   cells(n, size, gap) -> [{ x, y, w, h }]   the collage layout

import { Args, argPath, baseName, extOf, makeJob } from './job.js';

// first(): '[0]' selects the first frame/page at READ time; without it ImageMagick loads every frame of a GIF or PDF
// (slow, memory-heavy) and writes numbered outputs (out-0.jpg, out-1.jpg ...) instead of one file.
// argPath() runs before appending '[0]', so a file named "-x.gif" stays a file.
const FORMATS = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' };
const need = (v, name, fn) => { if (v == null || v === '') throw new Error(`${fn}: ${name} is required`); };
const first = (p) => argPath(p) + '[0]';
const px = (n) => Math.max(1, Math.round(+n || 0));

// Output name with an explicit format prefix when the extension does not say it.
// ImageMagick picks the encoder from the extension; "jpg:out.bin" forces it when the extension disagrees.
function outName(output, format) {
  const ext = FORMATS[extOf(output)];
  return !format || ext === format ? argPath(output) : `${format}:${output}`;
}

function quality(a, format, q) {
  if (format === 'jpg' || format === 'webp') a.add('-quality', String(Math.round(q)));
}

// -auto-orient applies the EXIF rotation before resizing (phone photos would otherwise come out sideways after
// -strip removes the orientation tag). JPEG has no alpha: -alpha remove composites onto -background first, else
// transparent pixels turn black (or garbage) unpredictably. Geometry suffixes: '^' = fill (cover) then -extent
// crops to the box around -gravity center; '>' = only shrink, never enlarge.
export function coverJob({ input, output, size = 600, format = null, quality: q = 90, fit = 'crop', background = '#000' } = {}) {
  need(input, 'input', 'coverJob'); need(output, 'output', 'coverJob');
  const fmt = FORMATS[format] || FORMATS[extOf(output)] || 'jpg';
  const s = px(size);
  const box = `${s}x${s}`;
  const a = new Args().add(first(input)).add('-auto-orient');
  if (fmt === 'jpg') a.add('-background', background).add('-alpha', 'remove').add('-alpha', 'off');
  if (fit === 'pad') a.add('-resize', box).add('-background', background).add('-gravity', 'center').add('-extent', box);
  else if (fit === 'none') a.add('-resize', box + '>');
  else a.add('-resize', box + '^').add('-gravity', 'center').add('-extent', box);
  a.add('-strip');
  quality(a, fmt, q);
  a.add(outName(output, fmt));
  const how = fit === 'pad' ? 'fitted and padded' : fit === 'none' ? 'fitted' : 'cropped';
  return makeJob('magick.cover', `Cover ${s}x${s} from ${baseName(input)}`, [a.step({ tool: 'magick', comment: `Square cover ${box} (${how}), ${fmt.toUpperCase()}` })], [output]);
}

// -thumbnail = -resize plus stripping of profiles, optimized for small outputs.
export function thumbJob({ input, output, size = 256, quality: q = 85, background = '#fff' } = {}) {
  need(input, 'input', 'thumbJob'); need(output, 'output', 'thumbJob');
  const fmt = FORMATS[extOf(output)] || 'jpg';
  const s = px(size);
  const a = new Args().add(first(input)).add('-auto-orient');
  if (fmt === 'jpg') a.add('-background', background).add('-alpha', 'remove').add('-alpha', 'off');
  a.add('-thumbnail', `${s}x${s}>`).add('-strip');
  quality(a, fmt, q);
  a.add(argPath(output));
  return makeJob('magick.thumb', `Thumbnail of ${baseName(input)}`, [a.step({ tool: 'magick', comment: `Thumbnail at most ${s}x${s}` })], [output]);
}

// Halves are floor/remainder of (S - gap) so cells plus gaps tile the canvas exactly with odd sizes (no 1px seam).
export function cells(n, size, gap = 0) {
  const S = px(size), g = Math.max(0, Math.round(+gap || 0));
  const h1 = Math.floor((S - g) / 2), h2 = S - g - h1;
  if (n <= 1) return [{ x: 0, y: 0, w: S, h: S }];
  if (n === 2) return [{ x: 0, y: 0, w: h1, h: S }, { x: h1 + g, y: 0, w: h2, h: S }];
  if (n === 3) return [{ x: 0, y: 0, w: h1, h: S }, { x: h1 + g, y: 0, w: h2, h: h1 }, { x: h1 + g, y: h1 + g, w: h2, h: h2 }];
  return [{ x: 0, y: 0, w: h1, h: h1 }, { x: h1 + g, y: 0, w: h2, h: h1 }, { x: 0, y: h1 + g, w: h1, h: h2 }, { x: h1 + g, y: h1 + g, w: h2, h: h2 }];
}

// One magick invocation: a solid canvas (xc:color), then per cell a parenthesized sub-pipeline (read, orient, fill,
// crop) composited at its offset. Parentheses isolate operator settings per image; -gravity northwest before
// -geometry makes offsets absolute from the top-left corner (gravity center from the cell resize would leak).
export function collageJob({ inputs = [], output, size = 600, gap = 0, background = '#000', quality: q = 90 } = {}) {
  need(output, 'output', 'collageJob');
  const list = inputs.filter(Boolean).slice(0, 4);
  if (!list.length) throw new Error('collageJob: no inputs');
  const fmt = FORMATS[extOf(output)] || 'jpg';
  const s = px(size);
  const a = new Args().add('-size', `${s}x${s}`, `xc:${background}`);
  cells(list.length, s, gap).forEach((c, i) => {
    const box = `${c.w}x${c.h}`;
    a.add('(', first(list[i]), '-auto-orient', '-resize', box + '^', '-gravity', 'center', '-extent', box, ')');
    a.add('-gravity', 'northwest', '-geometry', `+${c.x}+${c.y}`, '-composite');
  });
  if (fmt === 'jpg') a.add('-alpha', 'off');
  a.add('-strip');
  quality(a, fmt, q);
  a.add(argPath(output));
  const layout = ['', 'one picture', 'two halves', 'one half and two quarters', '2x2 grid'][list.length];
  return makeJob('magick.collage', `Collage of ${list.length} pictures`, [a.step({ tool: 'magick', comment: `Collage ${s}x${s}: ${layout}${gap ? `, ${gap} px gap` : ''}` })], [output]);
}

export function convertJob({ input, output, resize = null, quality: q = null, firstFrame = true } = {}) {
  need(input, 'input', 'convertJob'); need(output, 'output', 'convertJob');
  const a = new Args().add(firstFrame ? first(input) : argPath(input)).add('-auto-orient');
  a.opt('-resize', resize).opt('-quality', q != null ? String(Math.round(q)) : null);
  a.add(argPath(output));
  return makeJob('magick.convert', `Convert ${baseName(input)} to .${extOf(output) || '?'}`, [a.step({ tool: 'magick', comment: `Convert${resize ? ` and resize (${resize})` : ''}` })], [output]);
}

export function identifyJob(input) {
  need(input, 'input', 'identifyJob');
  const a = new Args().add(first(input)).add('-format', '%m %w %h\\n').add('info:');
  return makeJob('magick.identify', `Identify ${baseName(input)}`, [a.step({ tool: 'magick', comment: 'Format and size of the first picture', capture: 'text', parse: 'identify' })], []);
}

// Accepts the custom -format line ("JPEG 800 600") and, as a fallback, identify's default verbose line
// ("x.jpg JPEG 800x600 ..."), so the parser also works with output from other invocations.
export function parseIdentify(text) {
  const s = String(text ?? '');
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let m = /^([A-Z0-9][A-Z0-9-]*)\s+(\d+)\s+(\d+)$/i.exec(t);
    if (m) return { format: m[1].toUpperCase(), width: +m[2], height: +m[3] };
    m = /\s([A-Z0-9][A-Z0-9-]*)\s+(\d+)x(\d+)(?:\s|$)/.exec(t);
    if (m) return { format: m[1].toUpperCase(), width: +m[2], height: +m[3] };
  }
  return null;
}
