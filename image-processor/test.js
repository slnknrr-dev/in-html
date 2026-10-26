// image-processor/test.js - the Transform pipeline against its ImageMagick commands: `node
// image-processor/test.js` (importing the module runs nothing). Unit checks of the command text; where
// ImageMagick 7 is installed, the app's own pipeline (pipeline.js in Node: decode, process, encode) and `magick` with
// the generated arguments run on sample PNG / JPEG files (EXIF orientation, ICC profile, comment, transparency) and the
// outputs are compared: sizes exactly, pixels by the steps' fidelity, metadata by what the settings keep. The command
// TEXT then runs through the real shells - bash (single command and batch loop), cmd.exe (the loop as typed in a
// console window, and as a .bat file) - and the files it writes must carry the ZIP export's names and the same pixels.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeJPEG } from '../jpg/decode.js';
import { encodeJPEG } from '../jpg/encode.js';
import { buildTiff } from '../jpg/exif.js';
import { jpegInfo } from '../jpg/segments.js';
import { decodePNG, pngInfo } from '../png/decode.js';
import { encodePNG } from '../png/encode.js';
import { findBash, findMagick, magickShellEnv, pixelDiff, synthImage, withinFidelity } from '../raster/test.js';
import { EXACT, batchScript, fidelityOf, outputExt, patternsOf, segmentsText, singleCommand, transformSteps } from './commands.js';
import { readMeta, decodeInput } from './input.js';
import { encodeImage, normalizeSettings, outputName, processImage } from './pipeline.js';

// Standalone run only when executed directly; check.js imports and calls the exported runner.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const decodeAny = (bytes) => {
  const r = bytes[0] === 0x89 ? decodePNG(bytes) : decodeJPEG(bytes);
  return { width: r.width, height: r.height, data: r.data };
};
const metaOf = (bytes) => {
  // ImageMagick also writes a "Raw profile type icc" text copy of the profile: it counts as the ICC profile
  if (bytes[0] === 0x89) { const i = pngInfo(bytes); return { exif: !!i.exif, icc: !!i.iccp, text: i.text.some((t) => !/^Raw profile type/i.test(t.keyword)) }; }
  const i = jpegInfo(bytes);
  return { exif: !!i.exif, icc: !!i.icc, text: i.comments.length > 0 };
};

// Sample files: an opaque PNG, a transparent PNG, a JPEG with EXIF orientation 6, an ICC profile and a comment.
// File names deliberately contain a space and an upper-case extension ("plain image.png", "Alpha.PNG"): they exercise
// shell quoting and the case-sensitive bash glob patterns. The ICC stub is a minimal valid header (size, "mntr RGB ",
// "acsp" signature) - enough for encoders to carry it through.
function samples() {
  const icc = new Uint8Array(132);
  new DataView(icc.buffer).setUint32(0, 132);
  icc.set([0x6d, 0x6e, 0x74, 0x72, 0x52, 0x47, 0x42, 0x20], 12);
  icc.set([0x61, 0x63, 0x73, 0x70], 36);
  return {
    'photo.jpg': encodeJPEG(synthImage(180, 120, false, 7), { quality: 92, exif: buildTiff({ Orientation: 6, Make: 'TestCam', Model: 'T1' }), icc, comments: ['sample comment'] }),
    'plain image.png': encodePNG(synthImage(161, 107, false, 9), { level: 1 }),
    'Alpha.PNG': encodePNG(synthImage(150, 110, true, 11), { level: 1 }),
  };
}

// The app's export of one file (pipeline.js as the worker runs it, without canvas: no watermark, no WebP).
// Node has no canvas: the app pipeline runs without env hooks, so watermark and WebP are out of scope here.
async function appExport(bytes, name, settings) {
  const s = normalizeSettings(settings);
  const src = await decodeInput(bytes, '', {});
  const r = await processImage(src.img, s, { orientation: src.orientation });
  const enc = await encodeImage(r.image, s, { kind: src.kind, exif: src.exif, icc: src.icc, text: src.text, orientation: src.orientation });
  return { bytes: enc.bytes, name: outputName(name, s, enc.ext), format: enc.format };
}

const CASES = [
  { label: 'defaults', s: {} },
  { label: 'geometry', s: { orient: { rotate: 90, flipH: true }, crop: { aspect: 'free', rect: { x: 0.1, y: 0.15, w: 0.7, h: 0.6 } } } },
  { label: 'straighten + fit', s: { orient: { angle: -6 }, resize: { mode: 'fit', width: 90, height: 90, filter: 'lanczos3' } } },
  { label: 'fill + colour', s: { resize: { mode: 'fill', width: 80, height: 60, filter: 'bilinear' }, adjust: { brightness: 15, contrast: 25, saturation: -30, hue: 20, gamma: 1.2, temperature: 30 } } },
  { label: 'filters', s: { resize: { mode: 'percent', percent: 60, filter: 'area' }, filters: { sepia: true, blur: 1.2, sharpen: 120, sharpenRadius: 1, vignette: 50 } } },
  { label: 'aspect crop + invert', s: { crop: { aspect: '1:1', rect: null }, filters: { invert: true, grayscale: true } } },
];

export async function run() {
  let pass = 0, fail = 0;
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${info}`); } };

  // --- command text
  {
    const s = normalizeSettings({ resize: { mode: 'fit', width: 800, height: 600 }, output: { format: 'jpeg', quality: 80, suffix: '-web' } });
    const { steps } = transformSteps(s, { name: 'My photo.jpg', kind: 'jpeg', width: 1600, height: 1200, orientation: 1 });
    const io = { input: 'My photo.jpg', output: 'My photo-web.jpg' };
    ok('bash single', segmentsText(singleCommand(steps, io, 'bash', { wrap: false })) === "magick 'My photo.jpg' -filter Lanczos -resize '800x600>' -quality 80 -sampling-factor 4:2:0 +profile '!icc,*' +set comment 'My photo-web.jpg'", segmentsText(singleCommand(steps, io, 'bash', { wrap: false })));
    ok('cmd single', segmentsText(singleCommand(steps, io, 'cmd', { wrap: false })) === 'magick "My photo.jpg" -filter Lanczos -resize "800x600>" -quality 80 -sampling-factor 4:2:0 +profile "!icc,*" +set comment "My photo-web.jpg"', segmentsText(singleCommand(steps, io, 'cmd', { wrap: false })));
    const wrapped = segmentsText(singleCommand(steps, io, 'bash', { wrap: true }));
    ok('wrapped one step per line', wrapped.split('\n').length === steps.length + 2 && wrapped.split('\n').slice(0, -1).every((l) => l.endsWith(' \\')), wrapped);
    const g = [{ patterns: ['*.jpg'], steps, ext: 'jpg', prefix: '' }];
    ok('bat doubles %', segmentsText(batchScript(g, 'cmd', { bat: true, suffix: '-web' })).includes('for %%f in (*.jpg) do magick "%%f"'));
    ok('bat output', segmentsText(batchScript(g, 'cmd', { bat: true, suffix: '-web' })).includes('"images\\%%~nf-web.jpg"'));
    ok('bash loop', segmentsText(batchScript(g, 'bash', { wrap: false, suffix: '-web' })).startsWith('mkdir -p images; for f in *.jpg; do magick "$f" '));
    ok('patterns', JSON.stringify(patternsOf(['a.JPG', 'b.jpg', 'c.jpg'], 'bash')) === '["*.JPG","*.jpg"]' && JSON.stringify(patternsOf(['a.JPG', 'b.jpg'], 'cmd')) === '["*.JPG"]');
    ok('segments carry steps', singleCommand(steps, io, 'bash').filter((x) => x.step != null).length === steps.length);
  }

  const exe = findMagick();
  if (!exe) {
    console.log('image-processor: ImageMagick 7 not found, magick comparisons skipped');
    console.log(`image-processor: ${pass} passed, ${fail} failed`);
    return fail;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgproc-magick-'));
  const files = samples();
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);

  // --- single images: app output vs magick with the argv (no shell)
  for (const c of CASES) {
    for (const fmt of ['png', 'jpeg']) {
      for (const [name, bytes] of Object.entries(files)) {
        const settings = { ...c.s, output: { ...(c.s.output || {}), format: fmt } };
        const s = normalizeSettings(settings);
        const meta = readMeta(bytes);
        const { steps, format } = transformSteps(s, { name, kind: meta.kind, width: meta.width, height: meta.height, orientation: meta.orientation });
        const app = await appExport(bytes, name, settings);
        const { prefix } = outputExt(format, s);
        const out = path.join(dir, 'out-' + app.name);
        const argv = [path.join(dir, name), ...steps.flatMap((st) => st.args.flat()), prefix + out];
        const r = spawnSync(exe, argv, { encoding: 'utf8' });
        const label = `${c.label} ${fmt} ${name}`;
        if (r.status !== 0) { ok(label, false, r.stderr); continue; }
        const im = new Uint8Array(fs.readFileSync(out));
        const d = pixelDiff(decodeAny(app.bytes), decodeAny(im));
        // pixels: PNG output is lossless, so the processing steps' fidelity decides; JPEG adds the encoder difference
        const pixelSteps = steps.filter((st) => st.section !== 'output');
        const fid = fmt === 'png' ? fidelityOf(pixelSteps) : 'approx';
        ok(`${label} [${fid}]`, withinFidelity(d, fid), JSON.stringify(d) + '\n  ' + argv.slice(1, -1).join(' '));
        // metadata: the same kinds of metadata survive
        const ma = metaOf(app.bytes), mi = metaOf(im);
        const metaExact = steps.find((st) => st.id === 'meta')?.fidelity === EXACT;
        if (metaExact) ok(`${label} metadata`, JSON.stringify(ma) === JSON.stringify(mi), `app ${JSON.stringify(ma)} magick ${JSON.stringify(mi)} ${im[0] === 0x89 ? JSON.stringify(pngInfo(im).text.map((x) => x.keyword)) : ''}`);
      }
    }
  }

  // --- the command text through the real shells
  const bash = findBash();
  // magick for the shells: found on the PATH already, or its folder put first (Windows spells the variable Path) and,
  // for bash, a function calling the full path
  const { env, bashPrelude: bashMagick } = magickShellEnv(exe);
  const runBash = (label, script, cwd) => {
    const r = spawnSync(bash, ['-s'], { input: bashMagick + script + '\n', cwd, env, encoding: 'utf8' });
    if (r.status !== 0) ok(label, false, `status ${r.status} ${r.error ? r.error.message : ''}\n${r.stdout}\n${r.stderr}\n${script}`);
  };
  const settings = { orient: { rotate: 180 }, resize: { mode: 'fit', width: 100, height: 100 }, adjust: { contrast: 20 }, output: { suffix: '-edited (1)' } };
  const s = normalizeSettings(settings);
  const names = Object.keys(files);
  const expected = {};
  for (const n of names) expected[n] = await appExport(files[n], n, settings);
  // batch groups as the UI builds them: one loop per output format
  const groupsFor = (shell) => {
    const byFmt = new Map();
    for (const n of names) {
      const kind = readMeta(files[n]).kind;
      const { steps, format } = transformSteps(s, null, { kinds: [kind] });
      if (!byFmt.has(format)) byFmt.set(format, { names: [], kinds: new Set(), format });
      byFmt.get(format).names.push(n); byFmt.get(format).kinds.add(kind);
      void steps;
    }
    return [...byFmt.values()].map((g) => {
      const { steps, format } = transformSteps(s, null, { kinds: [...g.kinds] });
      return { patterns: patternsOf(g.names, shell), steps, ...outputExt(format, s) };
    });
  };
  const checkFolder = (label, folder) => {
    for (const n of names) {
      const want = expected[n];
      const p = path.join(folder, want.name);
      if (!fs.existsSync(p)) { ok(`${label} ${want.name}`, false, 'missing; folder has ' + JSON.stringify(fs.existsSync(folder) ? fs.readdirSync(folder) : [])); continue; }
      const d = pixelDiff(decodeAny(want.bytes), decodeAny(new Uint8Array(fs.readFileSync(p))));
      ok(`${label} ${want.name}`, withinFidelity(d, want.format === 'png' ? EXACT : 'approx'), JSON.stringify(d));
    }
  };
  const fresh = (sub) => { const d = path.join(dir, sub); fs.mkdirSync(d); for (const n of names) fs.writeFileSync(path.join(d, n), files[n]); return d; };
  if (bash) {
    for (const wrap of [true, false]) {
      const cwd = fresh('bash-' + wrap);
      runBash('bash batch runs', segmentsText(batchScript(groupsFor('bash'), 'bash', { wrap, suffix: s.output.suffix })), cwd);
      checkFolder(`bash batch (wrap ${wrap})`, path.join(cwd, 'images'));
    }
    // one image, the copied single command
    const cwd = fresh('bash-single');
    const n = 'plain image.png', meta = readMeta(files[n]);
    const { steps } = transformSteps(s, { name: n, kind: meta.kind, width: meta.width, height: meta.height, orientation: meta.orientation });
    runBash('bash single runs', segmentsText(singleCommand(steps, { input: n, output: expected[n].name }, 'bash')), cwd);
    ok('bash single output', fs.existsSync(path.join(cwd, expected[n].name)));
  } else console.log('image-processor: bash not available, shell runs skipped');
  if (process.platform === 'win32') {
    // a console window: the script typed line by line (stdin of an interactive cmd.exe keeps command-line rules)
    for (const wrap of [true, false]) {
      const cwd = fresh('cmd-' + wrap);
      const text = segmentsText(batchScript(groupsFor('cmd'), 'cmd', { wrap, suffix: s.output.suffix }));
      const r = spawnSync('cmd.exe', ['/d', '/q', '/k'], { input: text.replace(/\n/g, '\r\n') + '\r\nexit\r\n', cwd, env, encoding: 'utf8' });
      if (r.status !== 0) ok('cmd window runs', false, r.stderr);
      checkFolder(`cmd window (wrap ${wrap})`, path.join(cwd, 'images'));
    }
    for (const wrap of [true, false]) {
      const cwd = fresh('bat-' + wrap);
      fs.writeFileSync(path.join(cwd, 'convert.bat'), segmentsText(batchScript(groupsFor('cmd'), 'cmd', { wrap, bat: true, suffix: s.output.suffix })).replace(/\n/g, '\r\n') + '\r\n');
      const r = spawnSync('cmd.exe', ['/d', '/c', path.join(cwd, 'convert.bat')], { cwd, env, encoding: 'utf8' });
      if (r.status !== 0) ok('bat runs', false, r.stderr);
      checkFolder(`.bat file (wrap ${wrap})`, path.join(cwd, 'images'));
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`image-processor: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
