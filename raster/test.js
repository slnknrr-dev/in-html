// raster/test.js - unit tests of the pixel operations and their ImageMagick descriptions: `node raster/test.js`
// (importing the module runs nothing). Where ImageMagick 7 is installed (`magick` on the PATH, MAGICK=<path>, or the
// usual Windows install folder), every step of magick.js runs on synthetic images (even / odd sizes, with and
// without alpha) and the result is compared with the JS operation: steps marked exact must match up to rounding,
// approximate ones must stay close. Without ImageMagick those comparisons are skipped.
//
// Synthetic images (gradients, noise, odd sizes, alpha) are generated in code: no binary fixtures in the repository,
// and odd dimensions catch off-by-one centring bugs that even sizes hide.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePNG } from '../png/decode.js';
import { encodePNG } from '../png/encode.js';
import { EXACT, blurStep, colorSteps, cropStep, flipStep, num, orientStep, resizeStep, rotateStep, sharpenStep, straightenStep, vignetteStep } from './magick.js';
import { adjustColors, blur, blurIsExact, boxBlur, cropImage, flip, gaussianBlur, gaussianKernel, resizeTarget, resolveCrop, rotate90, sharpen, straighten, vignette } from './ops.js';
import { resize } from './resample.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/** ImageMagick 7 executable (MAGICK=<path>, `magick` on the PATH, or a standard Windows install), or null. */
export function findMagick() {
  const works = (exe) => { try { return spawnSync(exe, ['-version'], { encoding: 'utf8', timeout: 20000 }).stdout.includes('ImageMagick 7'); } catch { return false; } };
  const list = [process.env.MAGICK, 'magick'].filter(Boolean);
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      try { for (const d of fs.readdirSync(base).filter((n) => /^ImageMagick-7/i.test(n)).sort().reverse()) list.push(path.join(base, d, 'magick.exe')); } catch { /* none */ }
    }
  }
  return list.find(works) || null;
}

// A bash that can run the Windows / host magick: BASH=<path>, Git Bash on Windows (WSL's bash.exe sees another file
// system), or `bash` on the PATH elsewhere. Null when none works.
export function findBash() {
  const list = [process.env.BASH];
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
      list.push(path.join(base, 'Git', 'bin', 'bash.exe'), path.join(base, 'Git', 'usr', 'bin', 'bash.exe'));
    }
  }
  list.push('bash');
  for (const b of list.filter(Boolean)) {
    try {
      const r = spawnSync(b, ['-c', 'command -v mkdir >/dev/null && uname -s'], { encoding: 'utf8', timeout: 20000 });
      if (r.status !== 0) continue;
      if (process.platform === 'win32' && !/MINGW|MSYS|CYGWIN/i.test(r.stdout)) continue;
      return b;
    } catch { /* next */ }
  }
  return null;
}

/** Environment and a bash prelude that make `magick` (an absolute path) callable by name from the shells. */
export function magickShellEnv(exe) {
  const env = { ...process.env };
  const full = path.isAbsolute(exe);
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  if (full) env[pathKey] = path.dirname(exe) + path.delimiter + (env[pathKey] || '');
  return { env, bashPrelude: full ? `magick() { "${exe.replace(/\\/g, '/')}" "$@"; }\n` : '' };
}

/** Deterministic test picture: gradients, a disc, a box, noise; `alpha` adds a horizontal alpha ramp. */
export function synthImage(w, h, alpha = false, seed = 12345) {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      let r = (x / w) * 255, g = (y / h) * 255, b = 128 + 100 * Math.sin(x / 9) * Math.cos(y / 13);
      if ((x - w * 0.6) ** 2 + (y - h * 0.4) ** 2 < (h * 0.2) ** 2) { r = 230; g = 40; b = 60; }
      if (x > w * 0.1 && x < w * 0.3 && y > h * 0.55 && y < h * 0.85) { r = 20; g = 30; b = 200; }
      d[p] = r + (rnd() - 0.5) * 30; d[p + 1] = g + (rnd() - 0.5) * 30; d[p + 2] = b + (rnd() - 0.5) * 30;
      d[p + 3] = alpha ? Math.round(255 * Math.min(1, Math.max(0, 1.3 - x / w))) : 255;
    }
  }
  return { width: w, height: h, data: d };
}

/** Pixel difference of two RGBA images on premultiplied values: { max, mean, over2 (share of values off by > 2) }. */
export function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { size: `${a.width}x${a.height} vs ${b.width}x${b.height}` };
  let max = 0, sum = 0, over = 0;
  const A = a.data, B = b.data, n = A.length;
  for (let p = 0; p < n; p += 4) {
    const fa = A[p + 3] / 255, fb = B[p + 3] / 255;
    for (let c = 0; c < 4; c++) {
      const d = c === 3 ? Math.abs(A[p + 3] - B[p + 3]) : Math.abs(A[p + c] * fa - B[p + c] * fb);
      if (d > max) max = d;
      if (d > 2) over++;
      sum += d;
    }
  }
  return { max: Math.round(max), mean: +(sum / n).toFixed(3), over2: over / n };
}

/** Whether a difference satisfies a fidelity: exact = rounding only (rare boundary pixels aside), approx = close. */
export const withinFidelity = (d, fidelity) => !d.size && (fidelity === EXACT ? d.over2 <= 0.001 && d.mean <= 0.5 : d.mean <= 8);

/** Runs `magick in.png <args> out.png` on an image and returns the decoded output. */
export function magickRun(exe, dir, img, args, name = 'x') {
  const inp = path.join(dir, name + '-in.png'), out = path.join(dir, name + '-out.png');
  fs.writeFileSync(inp, encodePNG(img, { level: 1 }));
  const r = spawnSync(exe, [inp, ...args, out], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(`magick ${args.join(' ')}: ${(r.stderr || '').trim()}`);
  const d = decodePNG(new Uint8Array(fs.readFileSync(out)));
  return { width: d.width, height: d.height, data: d.data };
}

const flat = (step) => [].concat(...[].concat(step || []).flatMap((s) => s.args));
const copy = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });

export async function run() {
  let pass = 0, fail = 0;
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${info}`); } };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);

  // --- units
  eq('kernel widths', [0.6, 1, 2.5, 5].map((s) => gaussianKernel(s).length), [5, 9, 21, 41]);
  ok('kernel normalized', Math.abs(gaussianKernel(1.7).reduce((a, b) => a + b, 0) - 1) < 1e-5);
  eq('blur exact range', [1, 3.5, 3.9, 8].map(blurIsExact), [true, true, false, false]);
  eq('num', [num(1.23456), num(-0.00001), num(2), num(0.5, 0)], ['1.2346', '0', '2', '1']);
  eq('crop args', flat(cropStep({ aspect: 'free', rect: { x: 0.125, y: 0.25, w: 0.5, h: 0.5 } }, { w: 240, h: 160 })), ['-crop', '120x80+30+40', '+repage']);
  eq('crop aspect batch', flat(cropStep({ aspect: '16:9', rect: null }, null)), ['-gravity', 'center', '-crop', '16:9', '+repage', '+gravity']);
  eq('fit args', flat(resizeStep({ mode: 'fit', width: 800, height: 600, filter: 'lanczos3' }, null)), ['-filter', 'Lanczos', '-resize', '800x600>']);
  eq('fit width only', flat(resizeStep({ mode: 'fit', width: 800, height: 0, filter: 'area' }, null)), ['-scale', '800>']);
  eq('exact one side', flat(resizeStep({ mode: 'exact', width: 0, height: 300, filter: 'bilinear' }, null)), ['-filter', 'Triangle', '-resize', '%wx300!']);
  eq('percent no enlarge', resizeStep({ mode: 'percent', percent: 150, enlarge: false }, null), null);
  eq('brightness only', flat(colorSteps({ brightness: 20 })), ['-brightness-contrast', '10.039x0']);
  eq('gray only', flat(colorSteps({}, { grayscale: true })), ['-color-matrix', '0.2126 0.7152 0.0722 0.2126 0.7152 0.0722 0.2126 0.7152 0.0722']);
  eq('clamp before matrix', flat(colorSteps({ gamma: 1.2 }, { invert: true })), ['-gamma', '1.2', '-clamp', '-negate']);
  eq('neutral', colorSteps({}, {}), []);
  eq('orient', flat(orientStep(true)), ['-auto-orient']);
  eq('rotate', flat(rotateStep(-90)), ['-rotate', '270']);
  eq('flip', flat(flipStep(true, true)), ['-flop', '-flip']);
  eq('unsharp', flat(sharpenStep(1.5, 1.2)), ['-unsharp', '0x1.2+1.5+0']);
  {
    // the gaussian is close to the old three-box approximation for mid-size sigma (a sanity check of the convolution)
    const img = synthImage(64, 48);
    const d = pixelDiff(blur(img, 2), boxBlur(img, 2));
    ok('gaussian ~ box', d.mean < 1.5, JSON.stringify(d));
  }

  // --- comparisons with ImageMagick
  const exe = findMagick();
  if (!exe) {
    console.log('raster: ImageMagick 7 not found, magick comparisons skipped');
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raster-magick-'));
    const stats = { exact: 0, approx: 0 };
    const cmp = (name, img, step, ours) => {
      const steps = [].concat(step).filter(Boolean);
      // no step: the operation must have left the image as it was
      if (!steps.length) { ok(name + ' (no step)', ours === img || JSON.stringify(pixelDiff(ours, img)) === '{"max":0,"mean":0,"over2":0}'); return; }
      const fidelity = steps.some((s) => s.fidelity !== EXACT) ? 'approx' : EXACT;
      let im;
      try { im = magickRun(exe, dir, img, flat(steps), name.replace(/\W+/g, '_')); } catch (e) { ok(name, false, e.message); return; }
      const d = pixelDiff(ours, im);
      stats[fidelity]++;
      ok(`${name} [${fidelity}]`, withinFidelity(d, fidelity), `${JSON.stringify(d)}  ${flat(steps).join(' ')}`);
      if (process.env.VERBOSE) console.log(`  ${fidelity.padEnd(6)} ${JSON.stringify(d).padEnd(48)} ${name}`);
    };
    const sizes = [[240, 160, false], [241, 157, true], [97, 203, false]];
    for (const [w, h, alpha] of sizes) {
      const img = synthImage(w, h, alpha);
      const tag = `${w}x${h}${alpha ? 'a' : ''}`;
      const size = { w, h };
      cmp(`rotate90 ${tag}`, img, rotateStep(90), rotate90(img, 90));
      cmp(`rotate180 ${tag}`, img, rotateStep(180), rotate90(img, 180));
      cmp(`flip ${tag}`, img, flipStep(true, true), flip(img, true, true));
      for (const deg of [5, -7.5, 12.25]) {
        cmp(`straighten ${deg} ${tag}`, img, straightenStep(deg, size), straighten(img, deg));
        cmp(`straighten batch ${deg} ${tag}`, img, straightenStep(deg, null), straighten(img, deg));
      }
      for (const crop of [{ aspect: 'free', rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.45 } }, { aspect: '4:3', rect: null }, { aspect: '1:1', rect: null }, { aspect: '9:16', rect: null }, { aspect: 'free', rect: { x: 0.33, y: 0.07, w: 0.67, h: 0.93 } }]) {
        const ours = cropImage(img, resolveCrop(w, h, crop));
        cmp(`crop ${JSON.stringify(crop)} ${tag}`, img, cropStep(crop, size), ours);
        cmp(`crop batch ${JSON.stringify(crop)} ${tag}`, img, cropStep(crop, null), ours);
      }
      const rsList = [
        { mode: 'fit', width: 100, height: 100 }, { mode: 'fit', width: 150, height: 0 }, { mode: 'fit', width: 400, height: 400, enlarge: true },
        { mode: 'fill', width: 100, height: 100 }, { mode: 'fill', width: 300, height: 100 }, { mode: 'fill', width: 400, height: 250, enlarge: true },
        { mode: 'exact', width: 130, height: 90 }, { mode: 'exact', width: 0, height: 77 }, { mode: 'percent', percent: 37 }, { mode: 'percent', percent: 160, enlarge: true },
      ];
      for (const filter of ['lanczos3', 'bilinear', 'area']) {
        for (const r of rsList) {
          const rs = { ...r, filter };
          const t = resizeTarget(w, h, rs);
          let ours = t ? resize(img, t.width, t.height, filter) : img;
          if (t && t.cropTo) ours = cropImage(ours, { x: Math.floor((ours.width - t.cropTo.w) / 2), y: Math.floor((ours.height - t.cropTo.h) / 2), w: t.cropTo.w, h: t.cropTo.h });
          const label = `resize ${filter} ${r.mode} ${r.mode === 'percent' ? r.percent + '%' : `${r.width}x${r.height}`}${r.enlarge ? '+' : ''} ${tag}`;
          cmp(label, img, resizeStep(rs, size), ours);
          if (filter !== 'area') cmp(label + ' batch', img, resizeStep(rs, null), ours);
        }
      }
      if (alpha) continue; // colour work and filters: opaque pictures (IM leaves transparent colours alone differently)
      const adjList = [
        [{ brightness: 20 }, {}], [{ contrast: 40 }, {}], [{ contrast: -50 }, {}], [{ brightness: -25, contrast: 30 }, {}], [{ gamma: 1.6 }, {}],
        [{ temperature: 45 }, {}], [{ saturation: 50 }, {}], [{ saturation: -70, hue: 40 }, {}], [{ hue: -120 }, {}], [{}, { grayscale: true }],
        [{}, { sepia: true }], [{}, { invert: true }], [{ brightness: 60, saturation: 50 }, { invert: true }],
        [{ brightness: 10, contrast: 20, gamma: 0.8, temperature: -30, saturation: 20, hue: 15 }, { sepia: true, invert: true }],
      ];
      for (const [adj, fl] of adjList) cmp(`color ${JSON.stringify(adj)} ${JSON.stringify(fl)} ${tag}`, img, colorSteps(adj, fl), adjustColors(copy(img), adj, fl));
      for (const s of [0.6, 1, 2.5, 3.5, 6]) cmp(`blur ${s} ${tag}`, img, blurStep(s), blur(img, s));
      for (const s of [0.6, 1.5]) cmp(`gaussian-blur ${s} ${tag}`, img, { args: [['-gaussian-blur', `0x${s}`]], fidelity: EXACT }, gaussianBlur(img, s, 1));
      for (const [a, r, th] of [[1.2, 1.5, 0], [0.8, 0.6, 0], [2, 1, 0.05]]) cmp(`sharpen ${a} ${r} ${th} ${tag}`, img, sharpenStep(a, r, th), sharpen(copy(img), a, r, th));
      for (const a of [0.4, 1]) cmp(`vignette ${a} ${tag}`, img, vignetteStep(a), vignette(copy(img), a));
    }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`raster: compared with ${exe}: ${stats.exact} exact and ${stats.approx} approximate steps`);
  }
  console.log(`raster: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
