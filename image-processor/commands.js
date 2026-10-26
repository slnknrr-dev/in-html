// image-processor/commands.js - the Transform pipeline as ImageMagick 7 commands: one step per pipeline
// operation (raster/magick.js for pixels, watermark and output here), the single-image command and the batch loops
// (bash, cmd.exe window, .bat file) that mirror the ZIP export's file names. Plain data and strings: no DOM.
//
//   transformSteps(settings, info | null)  steps for one image (info: { name, kind, width, height, orientation }) or
//                                          for a batch (null: size-independent arguments)
//   singleCommand(steps, { input, output, prefix }, shell, { wrap })          -> segments
//   batchScript(groups, shell, { wrap, bat, folder })                          -> segments
//   segments: [{ text, step? }] - `step` is the index of the step the text belongs to; text = segments joined
//
// The strings are descriptions to read and copy; the application never runs them.

import { quote } from '../cmdline/quote.js';
import { APPROX, EXACT, NONE, blurStep, colorSteps, cropStep, flipStep, num, orientStep, resizeStep, rotateStep, sharpenStep, straightenStep, vignetteStep } from '../raster/magick.js';
import { isNeutral, resizeTarget, resolveCrop, straightenScale } from '../raster/ops.js';
import { outputFormat } from './pipeline.js';

export { APPROX, EXACT, NONE };
export const SHELLS = ['bash', 'cmd'];

// Panel section of each step (highlighting between the command and the settings column).
// Why commands at all: the app is a front end to a pipeline that ImageMagick can reproduce, so a user can batch the
// same edit on a server. Each step carries a fidelity mark (exact / approx / none) because encoders and some filters
// differ in detail; the UI shows that honestly instead of promising identical output.
const SECTION = {
  autoOrient: 'geometry', rotate: 'geometry', flip: 'geometry', straighten: 'geometry', crop: 'geometry', resize: 'resize', cutout: 'cutout',
  temperature: 'adjust', brightnessContrast: 'adjust', gamma: 'adjust', saturation: 'adjust', hue: 'adjust', colorMatrix: 'adjust',
  grayscale: 'filters', sepia: 'filters', invert: 'filters', blur: 'filters', sharpen: 'filters', vignette: 'filters', watermark: 'watermark',
};

const GRAVITY = { tl: 'NorthWest', t: 'North', tr: 'NorthEast', l: 'West', c: 'Center', r: 'East', bl: 'SouthWest', b: 'South', br: 'SouthEast' };
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', ico: 'ico' };

/**
 * Background removal: ImageMagick flood-fills transparency from the border (a 1-px frame in the colour of the top-left
 * pixel joins every border region, then is shaved off) with -fuzz as the tolerance. The app's soft edge, grow,
 * feather and colour decontamination have no single-option equivalent.
 */
function cutoutStep(cu) {
  if (!cu.enabled) return null;
  return {
    id: 'cutout', fidelity: APPROX, note: 'cutout',
    args: [['-alpha', 'set', '-bordercolor', '%[pixel:p{0,0}]', '-border', '1'], ['-fuzz', num((cu.tolerance / 255) * 100, 1) + '%', '-fill', 'none', '-draw', 'color 0,0 floodfill'], ['-shave', '1x1', '+fuzz']],
  };
}

/** Text for ImageMagick's -annotate / label: (backslashes, percent escapes and a leading @ file reference escaped). */
// ImageMagick treats % as an escape and a leading @ as "read text from file": unescaped user text could read local
// files when the command is run. Shell quoting (cmdline/quote.js) is applied on top of this.
export const imText = (s) => String(s).replace(/\\/g, '\\\\').replace(/%/g, '%%').replace(/^@/, '\\@');

const rgba = (hex, a) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return a >= 1 ? hex.toLowerCase() : `rgba(${r},${g},${b},${num(a, 3)})`;
};

/** Watermark (canvas text in the app): -annotate at the gravity of the position, or a tiled label pattern. */
function watermarkStep(wm, size) {
  const text = String(wm.text || '').trim();
  if (!text) return null;
  const a = wm.opacity / 100;
  const short = size ? Math.min(size.w, size.h) : null;
  const px = short ? String(Math.max(6, Math.round((short * wm.size) / 100))) : `%[fx:max(6,round(min(w,h)*${num(wm.size / 100, 4)}))]`;
  const margin = short ? String(Math.round(short * 0.03)) : '%[fx:round(min(w,h)*0.03)]';
  if (wm.position === 'tile') {
    return {
      id: 'watermark', fidelity: APPROX, note: 'watermarkTile', sized: !!size,
      args: [['(', '-background', 'none', '-fill', rgba(wm.color, a), '-pointsize', short ? px : '%[fx:max(6,round(min(w,h)*' + num(wm.size / 100, 4) + '))]', `label:${imText(text)}`],
        ['-bordercolor', 'none', '-border', '30x20', '-rotate', '-30', '-write', 'mpr:wm', '+delete', ')'],
        ['(', '+clone', '-fill', 'mpr:wm', '-draw', 'color 0,0 reset', ')', '-composite']],
    };
  }
  const off = wm.position === 'c' ? '+0+0' : `+${margin}+${margin}`;
  const shadow = wm.shadow ? [['-fill', `rgba(0,0,0,${num(0.55 * a, 3)})`, '-annotate', wm.position === 'c' ? '+1+1' : off, imText(text)]] : [];
  return {
    id: 'watermark', fidelity: APPROX, note: 'watermarkFont', sized: !!size,
    args: [['-gravity', GRAVITY[wm.position] || 'SouthEast', '-pointsize', px], ...shadow, ['-fill', rgba(wm.color, a), '-annotate', off, imText(text), '+gravity']],
  };
}

/** Output encoding and metadata steps for an output format; `alpha`: the input may be transparent. */
function outputSteps(s, format, alpha) {
  const o = s.output, steps = [];
  if (format === 'jpeg') {
    if (alpha) steps.push({ id: 'background', args: [['-background', o.background, '-alpha', 'remove', '-alpha', 'off']], fidelity: EXACT });
    steps.push({ id: 'jpeg', args: [['-quality', String(o.quality), '-sampling-factor', o.subsampling], o.progressive ? ['-interlace', 'JPEG'] : null].filter(Boolean), fidelity: APPROX, note: 'jpegEncoder' });
  } else if (format === 'ico') {
    steps.push({ id: 'ico', args: [['-background', 'none', '-define', `icon:auto-resize=${[...o.icoSizes].reverse().join(',')}`]], fidelity: APPROX, note: 'icoEncoder' });
  } else if (format === 'webp') {
    steps.push({ id: 'webp', args: [['-quality', String(o.quality)]], fidelity: APPROX, note: 'webpEncoder' });
  } else {
    if (o.pngColors) steps.push({ id: 'png8', args: [o.dither ? ['-dither', 'FloydSteinberg', '-colors', String(o.pngColors)] : ['+dither', '-colors', String(o.pngColors)]], fidelity: APPROX, note: 'pngQuantize' });
    steps.push({ id: 'pngLevel', args: [['-define', `png:compression-level=${o.effort === 'fast' ? 2 : o.effort === 'max' ? 9 : 6}`]], fidelity: EXACT, note: 'pngSize' });
  }
  // metadata: what the app's encoders keep (EXIF / text / comments with "keep", the ICC profile separately)
  if (format === 'webp' || format === 'ico') steps.push({ id: 'meta', args: [['-strip']], fidelity: EXACT, note: format === 'webp' ? 'webpMeta' : undefined });
  else if (o.strip && !o.keepIcc) steps.push({ id: 'meta', args: [['-strip']], fidelity: EXACT });
  // (PNG: text chunks and dates are left out; zTXt must stay, ImageMagick's PNG writer drops iCCP with it, and it
  // still carries EXIF fields copied into text)
  else if (o.strip) {
    const png = format === 'png';
    steps.push({ id: 'meta', args: [['+profile', '!icc,*', '+set', 'comment'], png ? ['-define', 'png:exclude-chunk=tEXt,iTXt,date'] : null].filter(Boolean), fidelity: png ? APPROX : EXACT, note: png ? 'pngText' : undefined });
  }
  else steps.push({ id: 'meta', args: o.keepIcc ? [] : [['+profile', 'icc']], fidelity: APPROX, note: format === 'png' ? 'pngText' : 'exifThumb' });
  for (const st of steps) st.section = 'output';
  return steps;
}

const swap = (z) => ({ w: z.h, h: z.w });

// Operation of a step (the app stores 8-bit pixels after each operation; ImageMagick's HDRI keeps out-of-range values
// between operators, so an operation that can overshoot gets -clamp before the next one).
const OP = { temperature: 'color', brightnessContrast: 'color', gamma: 'color', saturation: 'color', hue: 'color', colorMatrix: 'color', grayscale: 'color', sepia: 'color', invert: 'color' };
// Steps that can push values out of 0..255 (Lanczos ringing, saturation, sharpen...); the app clamps after every
// stage because it stores 8-bit pixels, so the command inserts -clamp at operation boundaries to match.
const OVERSHOOT = new Set(['temperature', 'brightnessContrast', 'saturation', 'hue', 'colorMatrix', 'sepia', 'sharpen']);
const overshoots = (st) => OVERSHOOT.has(st.id) || (st.id === 'resize' && st.args.some((g) => g.includes('Lanczos')));
function clampBetween(steps) {
  for (let i = 0; i < steps.length - 1; i++) {
    const op = OP[steps[i].id] || steps[i].id, next = OP[steps[i + 1].id] || steps[i + 1].id;
    if (op === next) continue;
    // the operation that ends here: its steps from the last boundary
    let j = i;
    while (j > 0 && (OP[steps[j - 1].id] || steps[j - 1].id) === op) j--;
    if (steps.slice(j, i + 1).some(overshoots)) steps[i] = { ...steps[i], args: [...steps[i].args, ['-clamp']] };
  }
}

/**
 * Steps of the pipeline for settings `s`. info: { name, kind, width, height, orientation } of one image (the decoded,
 * stored size before orientation), or null for a batch (size-independent forms; `kinds` lists the input kinds).
 * Every step: { id, section, args, fidelity, note?, sized?, label: [key, vars] }.
 */
// The size is tracked through the steps when known (single image), so size-dependent arguments (crop box, watermark
// size) are concrete numbers; for a batch, %[fx:...] expressions compute them per image inside ImageMagick.
export function transformSteps(s, info = null, { kinds = null } = {}) {
  const steps = [];
  let size = info && info.width > 0 && info.height > 0 ? { w: info.width, h: info.height } : null;
  const add = (st, label) => {
    for (const x of [].concat(st || [])) steps.push({ section: SECTION[x.id] || 'output', ...x, label: label ? label(x) : ['ip.step.' + x.id, {}] });
  };
  const o = s.orient;
  const orientation = info ? info.orientation || 1 : 0;
  if (o.auto && (!info || orientation !== 1)) add(orientStep(true));
  if (size && o.auto && orientation >= 5) size = swap(size);
  add(rotateStep(o.rotate), () => ['ip.step.rotate', { deg: o.rotate }]);
  if (size && o.rotate % 180) size = swap(size);
  add(flipStep(o.flipH, o.flipV), () => [o.flipH && o.flipV ? 'ip.step.flipBoth' : o.flipH ? 'ip.step.flipH' : 'ip.step.flipV', {}]);
  add(straightenStep(o.angle, size), () => ['ip.step.straighten', { deg: o.angle }]);
  if (size && o.angle) { const k = straightenScale(size.w, size.h, o.angle); size = { w: Math.max(1, Math.floor(size.w * k)), h: Math.max(1, Math.floor(size.h * k)) }; }
  const cropBefore = size;
  add(cropStep(s.crop, size), () => {
    if (cropBefore) { const c = resolveCrop(cropBefore.w, cropBefore.h, s.crop); return ['ip.step.crop', { w: c.w, h: c.h }]; }
    return s.crop.rect ? ['ip.step.cropRel', { w: Math.round(s.crop.rect.w * 100), h: Math.round(s.crop.rect.h * 100) }] : ['ip.step.cropAspect', { aspect: s.crop.aspect }];
  });
  if (size) { const c = resolveCrop(size.w, size.h, s.crop); size = { w: c.w, h: c.h }; }
  const r = s.resize;
  add(resizeStep(r, size), () => [r.mode === 'percent' ? 'ip.step.resizePercent' : 'ip.step.resize_' + r.mode, { w: r.width || '–', h: r.height || '–', p: r.percent }]);
  if (size) { const t = resizeTarget(size.w, size.h, r); if (t) size = t.cropTo ? { w: t.cropTo.w, h: t.cropTo.h } : { w: t.width, h: t.height }; }
  add(cutoutStep(s.cutout), () => ['ip.step.cutout', { v: s.cutout.tolerance }]);
  const kindList = info ? [info.kind] : kinds || ['jpeg'];
  const alpha = s.cutout.enabled || kindList.some((k) => k !== 'jpeg');
  if (!isNeutral(s.adjust, s.filters)) {
    const a = s.adjust, f = s.filters;
    const signed = (v) => (v > 0 ? '+' : '') + v;
    const first = steps.length;
    add(colorSteps(a, f), (x) => {
      if (x.id === 'brightnessContrast') return ['ip.step.brightnessContrast', { b: signed(a.brightness), c: signed(a.contrast) }];
      if (x.id === 'colorMatrix') return ['ip.step.colorMatrix', { parts: x.parts.map((p) => '{' + p + '}').join(', ') }];
      return ['ip.step.' + x.id, { v: x.id === 'gamma' ? a.gamma : x.id === 'hue' ? signed(a.hue) : x.id === 'temperature' ? signed(a.temperature) : signed(a.saturation) }];
    });
    // -brightness-contrast, -gamma, -negate also change the alpha channel: the colour work is limited to RGB
    if (alpha && steps.length > first) {
      steps[first] = { ...steps[first], args: [['-channel', 'RGB'], ...steps[first].args] };
      steps[steps.length - 1] = { ...steps[steps.length - 1], args: [...steps[steps.length - 1].args, ['+channel']] };
    }
    add(blurStep(f.blur), () => ['ip.step.blur', { v: f.blur }]);
    add(sharpenStep(f.sharpen / 100, f.sharpenRadius), () => ['ip.step.sharpen', { v: f.sharpen, r: f.sharpenRadius }]);
    add(vignetteStep(f.vignette / 100), () => ['ip.step.vignette', { v: f.vignette }]);
  }
  add(watermarkStep(s.watermark, size), () => ['ip.step.watermark', { text: s.watermark.text.trim() }]);
  clampBetween(steps);
  const format = outputFormat(s, kindList[0]);
  const o2 = s.output;
  add(outputSteps(s, format, alpha), (x) => {
    if (x.id === 'jpeg') return ['ip.step.jpeg', { q: o2.quality, ss: o2.subsampling }];
    if (x.id === 'webp') return ['ip.step.webp', { q: o2.quality }];
    if (x.id === 'ico') return ['ip.step.ico', { sizes: o2.icoSizes.join(', ') }];
    if (x.id === 'png8') return ['ip.step.png8', { n: o2.pngColors }];
    if (x.id === 'background') return ['ip.step.background', { c: o2.background }];
    if (x.id === 'meta') return [format === 'webp' || format === 'ico' || (o2.strip && !o2.keepIcc) ? 'ip.step.metaNone' : o2.strip ? 'ip.step.metaIcc' : 'ip.step.metaKeep', {}];
    return ['ip.step.' + x.id, {}];
  });
  return { steps, format, size };
}

/** Worst fidelity of a list of steps: 'exact' | 'approx' | 'none'. */
export function fidelityOf(steps) {
  if (steps.some((s) => s.fidelity === NONE)) return NONE;
  return steps.some((s) => s.fidelity === APPROX) ? APPROX : EXACT;
}

const argText = (step, shell, bat) => step.args.map((g) => g.map((a) => quote(a, shell, { batch: bat })).join(' ')).join(' ');
const CONT = { bash: ' \\', cmd: ' ^' };

// The command body as lines: [{ text, step? }] - program + input, one line per step, output.
function bodyLines(steps, input, output, shell, bat) {
  const lines = [{ text: 'magick ' + input }];
  steps.forEach((st, i) => { const t = argText(st, shell, bat); if (t) lines.push({ text: t, step: i }); });
  lines.push({ text: output });
  return lines;
}

// Lines -> segments: wrapped (one step per line after a continuation mark, indented by `cont`) or on one line.
function joinLines(lines, shell, wrap, { first = '', cont = '  ' } = {}) {
  const out = [];
  lines.forEach((l, i) => {
    if (i) out.push({ text: wrap ? CONT[shell] + '\n' + cont : ' ' });
    else if (first) out.push({ text: first });
    out.push(l.step == null ? { text: l.text } : { text: l.text, step: l.step });
  });
  return out;
}

/** Command for one image: io { input (file name), output (file name), prefix ('PNG8:' or '') }. */
export function singleCommand(steps, io, shell, { wrap = true } = {}) {
  return joinLines(bodyLines(steps, quote(io.input, shell), quote((io.prefix || '') + io.output, shell), shell, false), shell, wrap);
}

// Quoted pieces of the loop: the input variable and the output name built from it.
// Per-shell loop syntax: bash ${f%.*} strips the extension; cmd uses %~nf (name without extension) and needs %% inside
// .bat files, where single % starts a batch variable.
function loopTokens(shell, bat, folder, suffix, ext, prefix) {
  if (shell === 'bash') {
    const tail = quote(`${suffix}.${ext}`, 'bash');
    return { input: '"$f"', output: `${prefix || ''}"${folder}/\${f%.*}"${tail}`, head: (pats) => `for f in ${pats.join(' ')}; do`, foot: 'done' };
  }
  const v = bat ? '%%' : '%';
  const tail = bat ? suffix.replace(/%/g, '%%') : suffix;
  return { input: `"${v}f"`, output: `"${prefix || ''}${folder}\\${v}~nf${tail}.${ext}"`, head: (pats) => `for ${v}f in (${pats.join(' ')}) do`, foot: null };
}

/**
 * Batch loops. groups: [{ patterns: ['*.jpg', …], steps, ext, prefix }] (one loop per output format); options
 * { wrap, bat (cmd: .bat file, %% variables), folder (output folder, as the ZIP), suffix }.
 */
export function batchScript(groups, shell, { wrap = true, bat = false, folder = 'images', suffix = '' } = {}) {
  const segs = [];
  const nl = () => segs.push({ text: wrap ? '\n' : shell === 'bash' ? '; ' : ' & ' });
  if (shell === 'cmd' && bat) { segs.push({ text: '@echo off' }); segs.push({ text: '\n' }); }
  if (shell === 'bash' && groups.length > 1) { segs.push({ text: 'shopt -s nullglob' }); nl(); }
  segs.push({ text: shell === 'bash' ? `mkdir -p ${quote(folder, 'bash')}` : `mkdir ${quote(folder, 'cmd', { batch: bat })} 2>NUL` });
  for (const g of groups) {
    nl();
    const tk = loopTokens(shell, bat, folder, suffix, g.ext, g.prefix);
    const lines = bodyLines(g.steps, tk.input, tk.output, shell, bat);
    if (shell === 'bash') {
      segs.push({ text: tk.head(g.patterns) + (wrap ? '\n' : ' ') });
      segs.push(...joinLines(lines, shell, wrap, { first: wrap ? '  ' : '', cont: '    ' }));
      segs.push({ text: (wrap ? '\n' : '; ') + tk.foot });
    } else if (wrap) {
      // one command per line: the loop body continues with ^ (a new line ends the loop)
      segs.push({ text: tk.head(g.patterns) + ' ' });
      segs.push(...joinLines(lines, shell, true, { cont: '    ' }));
    } else {
      // one line: the body in parentheses, or a following '&' would run inside the loop
      segs.push({ text: tk.head(g.patterns) + ' (' });
      segs.push(...joinLines(lines, shell, false));
      segs.push({ text: ')' });
    }
  }
  return segs;
}

/** Plain text of segments. */
export const segmentsText = (segs) => segs.map((s) => s.text).join('');

/** Input file patterns for a list of file names (bash globs are case-sensitive: every spelling is listed). */
// bash globs are case-sensitive (*.JPG does not match *.jpg), so every spelling seen is listed; cmd is not, so one
// pattern per extension.
export function patternsOf(names, shell) {
  const seen = new Map();
  for (const n of names) {
    const m = /\.([^.\\/]+)$/.exec(n);
    const ext = m ? m[1] : '';
    const key = shell === 'cmd' ? ext.toLowerCase() : ext;
    if (!seen.has(key)) seen.set(key, ext ? '*.' + ext : '*');
  }
  return [...seen.values()];
}

/** Output extension and file-name prefix of a format ('PNG8:' forces a palette PNG). */
export const outputExt = (format, s) => ({ ext: EXT[format] || 'png', prefix: format === 'png' && s.output.pngColors ? 'PNG8:' : '' });
