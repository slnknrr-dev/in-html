// timeline/test.js - unit tests of the video project model: `node timeline/test.js` (importing the module runs
// nothing). Normalization of hostile input, layout with transitions, editing operations, history, colour maths, the
// audio mix (WSOLA keeps the pitch), the slideshow builder, project files, and the ffmpeg description: every
// generated filter graph is parsed back like ffmpeg reads it, its pads are checked (each produced and consumed
// once, inputs exist) and every filter / option name is checked against the ffmpeg documentation.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASPECTS, TRANSITIONS, activeAt, clipLength, frameSize, kenBurnsAt, layout, newProject, normalizeProject, sourceTime } from './model.js';
import * as E from './edit.js';
import { History } from './history.js';
import { ADJUST0, adjustOps, colorPlan, curveTable, kelvinRGB, vignetteFactor, applyPlan } from './color.js';
import { audioPieces, gainAt, mixdown, renderPiece, resample, timeStretch } from './audio.js';
import { buildSlideshow, slideDurations } from './slideshow.js';
import { packProject, parseProject, projectJSON, unpackProject } from './file.js';
import { animState, placement, textLayout } from './frame.js';
import { describe } from './ffmpeg.js';
import { plainArgv, renderScript } from '../ffcmd/command.js';
import { checkGraph, parseGraph } from '../ffcmd/parse.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Options of the filters the description uses (ffmpeg-filters documentation; positional values allowed where listed).
const FILTERS = {
  setpts: { pos: 1, opts: ['expr'] }, trim: { opts: ['start', 'end', 'duration', 'start_frame', 'end_frame', 'start_pts', 'end_pts'] },
  tpad: { opts: ['start', 'stop', 'start_mode', 'stop_mode', 'start_duration', 'stop_duration', 'color'] },
  transpose: { pos: 1, opts: ['dir', 'passthrough'] }, hflip: {}, vflip: {}, null: {},
  curves: { opts: ['preset', 'master', 'm', 'red', 'r', 'green', 'g', 'blue', 'b', 'all', 'psfile', 'plot', 'interp'] },
  colorchannelmixer: { opts: ['rr', 'rg', 'rb', 'ra', 'gr', 'gg', 'gb', 'ga', 'br', 'bg', 'bb', 'ba', 'ar', 'ag', 'ab', 'aa', 'pc', 'pa'] },
  eq: { opts: ['contrast', 'brightness', 'saturation', 'gamma', 'gamma_r', 'gamma_g', 'gamma_b', 'gamma_weight', 'eval'] },
  colortemperature: { opts: ['temperature', 'mix', 'pl'] }, hue: { opts: ['h', 's', 'H', 'b'] },
  vignette: { opts: ['angle', 'a', 'x0', 'y0', 'mode', 'eval', 'dither', 'aspect'] },
  scale: { pos: 2, opts: ['w', 'width', 'h', 'height', 'flags', 'force_original_aspect_ratio', 'force_divisible_by', 'eval'] },
  crop: { pos: 4, opts: ['w', 'out_w', 'h', 'out_h', 'x', 'y', 'keep_aspect', 'exact'] },
  pad: { pos: 5, opts: ['w', 'width', 'h', 'height', 'x', 'y', 'color', 'eval', 'aspect'] },
  split: { pos: 1, opts: ['outputs'] }, gblur: { opts: ['sigma', 'steps', 'planes', 'sigmaV'] },
  overlay: { pos: 2, opts: ['x', 'y', 'eof_action', 'eval', 'shortest', 'format', 'repeatlast', 'alpha', 'enable'] },
  setsar: { pos: 1, opts: ['r', 'ratio', 'sar', 'max'] }, fps: { pos: 1, opts: ['fps', 'start_time', 'round', 'eof_action'] },
  format: { pos: 1, opts: ['pix_fmts'] },
  fade: { opts: ['type', 't', 'start_frame', 's', 'nb_frames', 'n', 'start_time', 'st', 'duration', 'd', 'alpha', 'color', 'c'] },
  zoompan: { opts: ['zoom', 'z', 'x', 'y', 'd', 's', 'fps'] },
  atempo: { pos: 1, opts: ['tempo'] }, aresample: { pos: 1, opts: ['sample_rate'] }, asetrate: { pos: 1, opts: ['sample_rate', 'r'] },
  volume: { pos: 1, opts: ['volume', 'precision', 'eval'] },
  afade: { opts: ['type', 't', 'start_sample', 'ss', 'nb_samples', 'ns', 'start_time', 'st', 'duration', 'd', 'curve', 'c'] },
  aformat: { opts: ['sample_fmts', 'f', 'sample_rates', 'r', 'channel_layouts', 'cl'] },
  anullsrc: { opts: ['channel_layout', 'cl', 'sample_rate', 'r', 'nb_samples', 'n', 'duration', 'd'] },
  concat: { opts: ['n', 'v', 'a', 'unsafe'] }, xfade: { opts: ['transition', 'duration', 'offset', 'expr'] },
  acrossfade: { opts: ['nb_samples', 'ns', 'duration', 'd', 'overlap', 'o', 'curve1', 'c1', 'curve2', 'c2'] },
  color: { opts: ['color', 'c', 'size', 's', 'rate', 'r', 'duration', 'd', 'sar'] },
  drawtext: { opts: ['expansion', 'font', 'fontfile', 'text', 'textfile', 'fontsize', 'fontcolor', 'borderw', 'bordercolor', 'shadowx', 'shadowy', 'shadowcolor', 'box', 'boxcolor', 'boxborderw', 'line_spacing', 'x', 'y', 'alpha', 'enable', 'fix_bounds', 'text_align'] },
  rotate: { pos: 1, opts: ['angle', 'a', 'out_w', 'ow', 'out_h', 'oh', 'fillcolor', 'c', 'bilinear'] },
  adelay: { opts: ['delays', 'all'] }, amix: { opts: ['inputs', 'duration', 'dropout_transition', 'weights', 'normalize'] },
};
const XFADE = new Set(['fade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'circleopen', 'circleclose', 'zoomin']);

function filterProblems(chains) {
  const out = [];
  for (const c of chains) {
    for (const fl of c.filters) {
      const spec = FILTERS[fl.name];
      if (!spec) { out.push(`unknown filter ${fl.name}`); continue; }
      let positional = 0, named = false;
      for (const [k] of fl.opts) {
        if (k == null) { if (named) out.push(`${fl.name}: positional after named`); positional++; } else { named = true; if (!spec.opts.includes(k)) out.push(`${fl.name}: unknown option ${k}`); }
      }
      if (positional > (spec.pos || 0)) out.push(`${fl.name}: ${positional} positional values`);
      if (fl.name === 'xfade') { const tr = fl.opts.find((o) => o[0] === 'transition')?.[1]; if (!XFADE.has(tr)) out.push(`xfade transition ${tr}`); }
    }
  }
  return out;
}

/** Checks every graph argument of a description's steps; returns problems. */
function checkDescription(d) {
  const problems = [];
  for (const st of d.steps) {
    const argv = plainArgv(st.argv).flat();
    const inputs = argv.filter((a) => a === '-i').length;
    for (let i = 0; i < argv.length; i++) {
      const opt = argv[i];
      if (!['-filter_complex', '-vf', '-af'].includes(opt)) continue;
      let chains;
      try { chains = parseGraph(argv[i + 1]); } catch (e) { problems.push(`${opt}: ${e.message}`); continue; }
      problems.push(...filterProblems(chains));
      if (opt === '-filter_complex') {
        const outs = argv.filter((a, k) => argv[k - 1] === '-map').map((a) => a.replace(/^\[|\]$/g, ''));
        problems.push(...checkGraph(chains, { inputs, outputs: outs }));
      }
    }
  }
  return problems;
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, v, info) => { if (v) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + JSON.stringify(info) : ''}`); } };
  const near = (name, got, want, tol = 1e-3) => ok(name, Math.abs(got - want) <= tol, { got, want });

  // --- model ---------------------------------------------------------------------------------------------------------
  const junk = normalizeProject({ aspect: 'x', fps: 7, media: [{ id: 'm1', kind: 'video', duration: 'a' }, { id: '1bad', kind: 'video' }, { id: 'm1', kind: 'image' }, null, 5],
    main: [{ id: 'c1', media: 'm1', in: -5, out: 1e9, speed: 99, rotate: -90, adjust: { brightness: 500, preset: 'nope' } }, { id: 'c2', media: 'zz' }],
    overlays: [{ id: 'o1', type: 'text', text: 7, start: 5, end: 1, x: 'q' }, { id: 'o2', type: 'image', media: 'm1' }, { id: 'o3', type: 'drawing', strokes: [{ points: [0, 0, 'x', 1, 0.5, 0.5] }, { points: [] }] }],
    audio: [{ id: 'a1', media: 'm1' }] });
  eq('junk aspect / fps', [junk.aspect, junk.fps], ['9:16', 30]);
  eq('junk media', junk.media.map((m) => m.id), ['m1']);
  eq('junk clip', [junk.main.length, junk.main[0].in, junk.main[0].speed, junk.main[0].rotate, junk.main[0].adjust.brightness, junk.main[0].adjust.preset], [1, 0, 8, 270, 100, 'none']);
  eq('junk overlays', junk.overlays.map((o) => [o.id, o.type, o.start, o.end, o.text ?? null, o.x]), [['o1', 'text', 5, 5.1, 'Text', 0.5], ['o3', 'drawing', 0, 3, null, 0.5]]);
  eq('junk strokes', junk.overlays[1].strokes.map((s) => s.points), [[0, 0, 0.5, 0.5]]);
  eq('junk audio (video without sound)', junk.audio.length, 0);
  eq('seq ahead of ids', junk.seq >= 3, true);
  eq('frame sizes', Object.keys(ASPECTS).map((a) => frameSize(a, 1080)), [{ width: 1080, height: 1920 }, { width: 1080, height: 1080 }, { width: 1080, height: 1350 }, { width: 1920, height: 1080 }]);
  eq('frame size 720 odd', frameSize('4:5', 721), { width: 722, height: 902 });

  // A project: video (2x speed), still (Ken Burns), video; a 0.5 s transition between the first two.
  const p = newProject({ name: 'Trip', aspect: '9:16' });
  const v = E.addMedia(p, { kind: 'video', name: 'clip.mp4', duration: 10, width: 1920, height: 1080, fps: 30, hasAudio: true });
  const im = E.addMedia(p, { kind: 'image', name: 'photo.jpg', width: 3000, height: 2000 });
  const mu = E.addMedia(p, { kind: 'audio', name: 'song.mp3', duration: 30 });
  const c1 = E.addClip(p, v.id); c1.in = 1; c1.out = 5; c1.speed = 2;
  const c2 = E.addClip(p, im.id, { duration: 3 });
  const c3 = E.addClip(p, v.id); c3.in = 6; c3.out = 8;
  E.setTransition(p, c1.id, { type: 'fade', duration: 0.5 });
  let L = layout(p);
  eq('layout starts', L.main.map((e) => [e.start, e.end, e.xIn, e.xOut]), [[0, 2, 0, 0.5], [1.5, 4.5, 0.5, 0], [4.5, 6.5, 0, 0]]);
  eq('total', L.total, 6.5);
  eq('active in transition', activeAt(L, 1.7).main.map((e) => e.clip.id), [c1.id, c2.id]);
  eq('active at end', activeAt(L, 6.5).main.map((e) => e.clip.id), [c3.id]);
  near('source time (speed 2)', sourceTime(L.main[0], 1), 3);
  E.setTransition(p, c2.id, { type: 'wipeleft', duration: 5 });
  L = layout(p);
  eq('transition clamped to half a clip', L.main[1].xOut, 1);
  E.setTransition(p, c2.id, null);
  eq('clip length', clipLength(c1, v), 2);

  // Editing.
  L = layout(p);
  const parts = E.split(p, c1.id, 1);
  eq('split video', parts && [parts[0].in, parts[0].out, parts[1].in, parts[1].out, parts[0].transition, parts[1].transition?.type], [1, 3, 3, 5, null, 'fade']);
  c2.kenburns = { from: { z: 1, x: 0.5, y: 0.5 }, to: { z: 1.5, x: 0.5, y: 0.5 } };
  L = layout(p);
  const e2 = L.main.find((e) => e.clip.id === c2.id);
  const sp = E.split(p, c2.id, e2.start + 1);
  eq('split still', sp && [sp[0].out, sp[1].out], [1, 2]);
  near('split Ken Burns mid', sp[0].kenburns.to.z, kenBurnsAt({ from: { z: 1, x: 0.5, y: 0.5 }, to: { z: 1.5, x: 0.5, y: 0.5 } }, 1 / 3).z);
  eq('split outside', E.split(p, c3.id, 0), null);
  const before = layout(p).total;
  E.trimTo(p, c3.id, 'end', layout(p).main.at(-1).end - 1);
  near('trim end ripples', layout(p).total, before - 1);
  E.trimTo(p, c3.id, 'start', layout(p).main.at(-1).start + 0.5);
  eq('trim start (source)', c3.in, 6.5);
  E.moveMain(p, c3.id, 0);
  eq('move main', p.main[0].id, c3.id);
  const dup = E.duplicate(p, c3.id);
  eq('duplicate main', [p.main[1].id, dup.in, dup.out], [dup.id, c3.in, c3.out]);
  E.remove(p, dup.id);
  eq('remove', p.main.some((c) => c.id === dup.id), false);
  const t1 = E.addOverlay(p, { type: 'text', text: 'Hi', start: 1, end: 3 });
  const t2 = E.addOverlay(p, { type: 'text', text: 'There', start: 2, end: 4 });
  eq('overlay rows avoid overlap', [t1.row, t2.row], [0, 1]);
  E.moveItem(p, t2.id, 3, 0);
  eq('move item onto a free spot', [t2.start, t2.end, t2.row], [3, 5, 0]);
  E.moveItem(p, t2.id, 2, 0);
  eq('move item onto a busy row', t2.row, 1);
  const tsplit = E.split(p, t1.id, 2);
  eq('split overlay', [tsplit[0].end, tsplit[1].start, tsplit[0].animOut.type, tsplit[1].animIn.type], [2, 2, 'none', 'none']);
  const a1 = E.addAudio(p, mu.id, 1);
  E.trimTo(p, a1.id, 'start', 0);
  eq('audio trim start clamps at source start', [a1.start, a1.in], [1, 0]);
  E.trimTo(p, a1.id, 'start', 3);
  eq('audio trim start', [a1.start, a1.in], [3, 2]);
  E.trimTo(p, a1.id, 'end', 100);
  eq('audio trim end clamps to the media', a1.out, 30);
  const still = E.addMedia(p, { kind: 'image', name: 'freeze-1.png', width: 1920, height: 1080, origin: { kind: 'freeze', media: v.id, time: 2 } });
  const n0 = p.main.length;
  L = layout(p);
  const host = L.main[1];
  const ins = E.insertStill(p, host.clip.id, host.start + host.len / 2, still.id, 2);
  eq('insert still splits', [p.main.length, p.main.indexOf(ins), ins.out], [n0 + 2, 2, 2]);
  E.compactRows(p);
  const rows = newProject();
  rows.overlays = normalizeProject({ overlays: [{ id: 'o1', type: 'text', start: 0, end: 4, row: 0 }, { id: 'o2', type: 'emoji', start: 1, end: 6, row: 0 }, { id: 'o3', type: 'text', start: 5, end: 7, row: 3 }] }).overlays;
  E.fixRows(rows);
  eq('fixRows: overlaps move up, gaps close', rows.overlays.map((o) => [o.id, o.row]), [['o1', 0], ['o2', 1], ['o3', 2]]);
  eq('snap', E.snap(1.04, E.snapPoints(layout(p)), 0.05), 1);

  // History.
  const h = new History(10, 500);
  h.reset({ a: 1 });
  h.commit({ a: 2 }, 'two');
  h.commit({ a: 3 }, 'drag', 'k', 1000);
  h.commit({ a: 4 }, 'drag', 'k', 1200);
  eq('history merge', [h.stack.length, h.label], [3, 'drag']);
  eq('undo', h.undo(), { a: 2 });
  eq('redo', h.redo(), { a: 4 });
  h.undo();
  h.commit({ a: 9 });
  eq('commit drops redo', [h.canRedo, h.stack.length], [false, 3]);
  eq('equal state ignored', h.commit({ a: 9 }), false);

  // Colour.
  const k65 = kelvinRGB(6500);
  near('kelvin 6500 r', k65[0], 1); near('kelvin 6500 g', k65[1], 0.9965, 1e-3); near('kelvin 6500 b', k65[2], 0.9806, 1e-3);
  eq('kelvin warm < cool blue', kelvinRGB(3000)[2] < kelvinRGB(9000)[2], true);
  const vt = curveTable('0/0.11 0.42/0.51 1/0.95', 256);
  near('curve passes points', vt[Math.round(0.42 * 255)], 0.51, 0.01); near('curve start', vt[0], 0.11); near('curve end', vt[255], 0.95);
  eq('neutral adjust has no ops', adjustOps(ADJUST0), []);
  eq('ops order', adjustOps({ preset: 'noir', brightness: 10, temperature: -50, hue: 10, vignette: 50 }).map((o) => o.kind), ['curves', 'eq', 'temperature', 'hue', 'vignette']);
  const gray = colorPlan(adjustOps({ saturation: -100 })).matrix;
  const px = applyPlan(new Uint8ClampedArray([200, 50, 10, 255]), { curves: null, matrix: gray });
  eq('saturation 0 is gray', px[0] === px[1] && px[1] === px[2], true);
  const bright = applyPlan(new Uint8ClampedArray([100, 100, 100, 255]), colorPlan(adjustOps({ brightness: 40 })));
  eq('brightness adds', bright[0], Math.round(100 + 0.1 * 255));
  near('vignette factor', vignetteFactor(1, Math.PI / 4), Math.pow(Math.cos(Math.PI / 4), 4));

  // Frame geometry.
  const pl = placement(1920, 1080, { rotate: 0, zoom: 1 }, 'fit', 1080, 1920);
  eq('fit 16:9 in 9:16', [Math.round(pl.fg.w), Math.round(pl.fg.h), Math.round(pl.fg.y)], [1080, 608, 656]);
  const pr = placement(1920, 1080, { rotate: 90, zoom: 1 }, 'fill', 1080, 1920);
  eq('fill rotated', [Math.round(pr.fg.w), Math.round(pr.fg.h)], [1080, 1920]);
  const lay = textLayout({ text: 'a\nbb', size: 0.05, x: 0.5, y: 0.5, scale: 1, align: 'center', stroke: { width: 0.1 }, shadow: true }, 1000, 1000);
  eq('text layout', [lay.fs, lay.lines.length, Math.round(lay.lines[1].baseline - lay.lines[0].baseline), lay.border], [50, 2, 63, 5]);
  const it = { start: 1, end: 3, opacity: 1, animIn: { type: 'slideup', duration: 0.5 }, animOut: { type: 'fade', duration: 0.5 } };
  const s0 = animState(it, 1, 100, 100), s1 = animState(it, 2, 100, 100), s2 = animState(it, 2.75, 100, 100);
  eq('anim state', [s0.alpha, Math.round(s0.dy), s1.alpha, s1.dy, s2.alpha], [0, 12, 1, 0, 0.5]);

  // Audio.
  const rate = 8000;
  const sine = new Float32Array(rate * 2);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5;
  const crossings = (a) => { let n = 0; for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) n++; return n; };
  for (const s of [2, 0.5, 1.5]) {
    const out = timeStretch([sine], s, rate)[0];
    eq(`stretch ${s} length`, out.length, Math.round(sine.length / s));
    const hz = crossings(out.subarray(400, out.length - 400)) / ((out.length - 800) / rate);
    near(`stretch ${s} keeps 440 Hz`, hz, 440, 8);
  }
  const rs = resample([sine], 2)[0];
  near('resample raises pitch', crossings(rs) / (rs.length / rate), 880, 8);
  const pc = { srcIn: 0, srcOut: 2, speed: 1, keepPitch: true, start: 0, len: 2, volume: 0.5, fadeIn: 1, fadeOut: 0, xIn: 0, xOut: 0.5 };
  eq('gain', [gainAt(pc, 0), gainAt(pc, 0.5), gainAt(pc, 1.25), gainAt(pc, 1.75)], [0, 0.25, 0.5, 0.25]);
  const ones = new Float32Array(rate * 2).fill(1);
  const rp = renderPiece([ones], pc, rate, 2);
  eq('render piece', [rp.length, rp[0].length, rp[1][rate], rp[0][0]], [2, rate * 2, 0.5, 0]);
  const mp = newProject();
  const mm = E.addMedia(mp, { kind: 'audio', name: 'a.wav', duration: 2 });
  E.addAudio(mp, mm.id, 1);
  const mix = await mixdown(mp, layout(mp), async () => [ones], rate, 1);
  eq('mixdown places audio', [mix[0].length, mix[0][rate / 2], mix[0][rate + 10]], [rate * 3, 0, 1]);
  eq('pieces skip stills and muted', audioPieces(p, layout(p)).every((x) => x.media !== im.id), true);

  // Slideshow.
  const ds = slideDurations(4, [1, 1, 1, 1], 10, 0.6);
  near('fit: total = audio', ds.lens.reduce((a, b) => a + b, 0) - 3 * ds.transition, 10);
  const tight = slideDurations(5, null, 2, 1);
  ok('fit: transition shrinks', tight.transition <= Math.min(...tight.lens) / 2 + 1e-9, tight);
  const sp2 = newProject();
  const imgs = [1, 2, 3].map((i) => E.addMedia(sp2, { kind: 'image', name: `p${i}.jpg`, width: 800, height: 600 }));
  const au = E.addMedia(sp2, { kind: 'audio', name: 'music.mp3', duration: 12 });
  const show = buildSlideshow(sp2, { images: imgs.map((m, i) => ({ media: m.id, caption: i === 1 ? 'Hello' : '' })), audio: au.id, mode: 'fit', transition: 'random', kenburns: 'random', seed: 7 });
  near('slideshow ends with the audio', layout(sp2).mainEnd, 12, 0.01);
  eq('slideshow parts', [show.clips.length, show.captions.length, !!show.audio, show.clips.every((c) => c.kenburns), show.clips.slice(0, -1).every((c) => TRANSITIONS.includes(c.transition.type))], [3, 1, true, true, true]);
  const sp3 = newProject();
  const imgs3 = [1, 2].map((i) => E.addMedia(sp3, { kind: 'image', name: `q${i}.jpg`, width: 800, height: 600 }));
  const au3 = E.addMedia(sp3, { kind: 'audio', name: 'long.mp3', duration: 60 });
  buildSlideshow(sp3, { images: imgs3.map((m) => ({ media: m.id })), audio: au3.id, mode: 'fixed', seconds: 2, transition: 'none', kenburns: 'none' });
  eq('fixed: audio trimmed and faded', [sp3.audio[0].out, sp3.audio[0].fadeOut], [4, 1.5]);

  // Files.
  const json = projectJSON(p);
  eq('json round trip', JSON.stringify(parseProject(json)), JSON.stringify(normalizeProject(p)));
  let threw = false;
  try { parseProject('{"type":"other"}'); } catch { threw = true; }
  eq('rejects other json', threw, true);
  const zip = await packProject(p, new Map([[v.id, new Uint8Array([1, 2, 3])], [im.id, new Uint8Array([9])]]));
  const un = await unpackProject(zip);
  eq('zip round trip', [un.project.main.length, [...un.files.keys()].sort(), [...un.files.get(v.id).bytes]], [p.main.length, [im.id, v.id].sort(), [1, 2, 3]]);

  // ffmpeg description.
  const fp = newProject({ name: 'Demo: test/1', aspect: '9:16' });
  const fv = E.addMedia(fp, { kind: 'video', name: 'my clip.mp4', duration: 20, width: 1920, height: 1080, fps: 30, hasAudio: true });
  const fsil = E.addMedia(fp, { kind: 'video', name: 'silent.webm', duration: 5, width: 1280, height: 720, fps: 25, hasAudio: false });
  const fi = E.addMedia(fp, { kind: 'image', name: 'photo.jpg', width: 4000, height: 3000 });
  const fm = E.addMedia(fp, { kind: 'audio', name: 'song.mp3', duration: 8 });
  const logo = E.addMedia(fp, { kind: 'image', name: 'logo.png', width: 400, height: 200 });
  const ed = E.addMedia(fp, { kind: 'image', name: 'edited-1.png', width: 1080, height: 1920, origin: { kind: 'edited', media: fi.id } });
  const fz = E.addMedia(fp, { kind: 'image', name: 'freeze-1.png', width: 1920, height: 1080, origin: { kind: 'freeze', media: fv.id, time: 4.2 } });
  const k1 = E.addClip(fp, fv.id); k1.in = 2; k1.out = 6; k1.speed = 4; k1.adjust = { ...ADJUST0, preset: 'sepia', temperature: 30, vignette: 40 }; k1.fadeIn = 0.5; k1.volume = 1.5; k1.vfadeIn = 0.3;
  const k2 = E.addClip(fp, fi.id, { duration: 3 }); k2.kenburns = { from: { z: 1, x: 0.5, y: 0.5 }, to: { z: 1.3, x: 0.6, y: 0.5 } };
  const k3 = E.addClip(fp, fsil.id); k3.out = 2; k3.fit = 'fill'; k3.zoom = 1.4; k3.panX = 0.1; k3.rotate = 180; k3.flipH = true;
  const k4 = E.addClip(fp, fz.id, { duration: 1.5 });
  const k5 = E.addClip(fp, ed.id, { duration: 2 }); k5.fit = 'fit';
  const k6 = E.addClip(fp, fv.id); k6.in = 10; k6.out = 12; k6.speed = 0.3; k6.keepPitch = false; k6.muted = false;
  E.setTransition(fp, k1.id, { type: 'circleopen', duration: 0.4 });
  E.setTransition(fp, k4.id, { type: 'slideup', duration: 0.5 });
  const txt = E.addOverlay(fp, { type: 'text', text: "It's 10:30, ok?\n100% [fun]; a\\b", start: 0.2, end: 3, animIn: { type: 'slideleft', duration: 0.4 }, animOut: { type: 'typewriter', duration: 0.3 }, stroke: { color: '#ff0000', width: 0.1 }, box: { color: '#222222', opacity: 0.6 }, opacity: 0.9, align: 'left' });
  const rot = E.addOverlay(fp, { type: 'text', text: 'Tilted', start: 1, end: 2, rotation: -12 });
  const emo = E.addOverlay(fp, { type: 'emoji', emoji: '🎉', start: 0.5, end: 4, x: 0.8, animIn: { type: 'pop', duration: 0.3 } });
  const pic = E.addOverlay(fp, { type: 'image', media: logo.id, start: 0, end: 9, x: 0.85, y: 0.08, w: 0.2, opacity: 0.7 });
  const drw = E.addOverlay(fp, { type: 'drawing', start: 2, end: 5, strokes: [{ tool: 'pen', color: '#ff0000', width: 0.01, points: [0.1, 0.1, 0.5, 0.5] }] });
  const mus = E.addAudio(fp, fm.id, 1.25); mus.volume = 0.6; mus.fadeOut = 2;
  const FL = layout(fp);
  for (const mode of ['single', 'steps']) {
    for (const format of ['mp4-h264', 'webm-vp9']) {
      const d = describe(fp, { mode, format, short: 720 });
      eq(`${mode} ${format} graphs valid`, checkDescription(d), []);
      for (const shell of ['bash', 'cmd']) {
        const txt2 = renderScript(d.steps, shell, { width: 100 }).text;
        ok(`${mode} ${shell} output name`, txt2.includes(format === 'mp4-h264' ? 'Demo-test-1.mp4' : 'Demo-test-1.webm'));
      }
    }
  }
  const d1 = describe(fp, { mode: 'single', short: 720 });
  const all = renderScript(d1.steps, 'bash').text;
  const argv1 = plainArgv(d1.steps[0].argv).flat();
  const graph1 = parseGraph(argv1[argv1.indexOf('-filter_complex') + 1]);
  const fl = graph1.flatMap((c) => c.filters);
  const opt = (x, k) => x.opts.find((o) => o[0] === k)?.[1];
  eq('size', [d1.width, d1.height, d1.fps], [720, 1280, 30]);
  ok('video input trimmed', all.includes("-ss 2 -t 4 -i 'my clip.mp4'"));
  ok('still / Ken Burns input', all.includes('-i photo.jpg') && fl.some((x) => x.name === 'zoompan' && opt(x, 'd') === '90' && opt(x, 's') === '720x1280'));
  ok('Ken Burns pans x', fl.some((x) => x.name === 'zoompan' && opt(x, 'x') === 'iw*(0.5+0.1*on/89)-iw/zoom/2'));
  eq('speed 4: setpts + chained atempo', [fl.some((x) => x.name === 'setpts' && x.args === '(PTS-STARTPTS)/4'), fl.filter((x) => x.name === 'atempo').map((x) => x.args).slice(0, 2)], [true, ['2', '2']]);
  ok('pitch follows: asetrate', fl.some((x) => x.name === 'asetrate' && x.args === String(Math.round(48000 * 0.3))));
  ok('sepia mixer + temperature + vignette', ['colorchannelmixer', 'colortemperature', 'vignette'].every((n) => fl.some((x) => x.name === n)));
  ok('volume / fades', fl.some((x) => x.name === 'volume' && x.args === '1.5') && fl.some((x) => x.name === 'afade' && opt(x, 't') === 'in') && fl.some((x) => x.name === 'fade' && opt(x, 't') === 'in' && opt(x, 'd') === '0.3'));
  ok('silent clip gets anullsrc', fl.some((x) => x.name === 'anullsrc'));
  ok('rotate 180 + mirror', all.includes('hflip,vflip,hflip'));
  ok('zoomed fill: scale + crop', fl.some((x) => x.name === 'crop' && x.opts.length === 4));
  ok('freeze frame from the video', all.includes("-ss 4.2 -i 'my clip.mp4'") && fl.some((x) => x.name === 'tpad' && opt(x, 'stop_mode') === 'clone'));
  ok('edited still is an asset', d1.assets.some((a) => a.name === 'edited-1.png' && a.kind === 'media'));
  const xf = fl.filter((x) => x.name === 'xfade');
  eq('xfade offsets = layout', xf.map((x) => [opt(x, 'transition'), +opt(x, 'offset')]), [['circleopen', FL.main[1].start], ['slideup', FL.main[4].start]]);
  eq('acrossfade', fl.filter((x) => x.name === 'acrossfade').map((x) => opt(x, 'd')), ['0.4', '0.5']);
  const dts = fl.filter((x) => x.name === 'drawtext');
  eq('drawtext lines', dts.map((x) => opt(x, 'text')), ["It's 10:30, ok?", '100% [fun]; a\\b']);
  ok('drawtext style', dts.every((x) => opt(x, 'expansion') === 'none' && opt(x, 'font') === 'Arial:style=Bold' && opt(x, 'borderw') && opt(x, 'boxcolor') === '#222222@0.6'));
  ok('drawtext alpha / slide', /^0\.9\*min\(min\(1,\(t-0\.2\)\/0\.4\),\(3-t\)\/0\.3\)$/.test(opt(dts[0], 'alpha')) && /pow\(max\(0,1-\(t-0\.2\)\/0\.4\),3\)/.test(opt(dts[0], 'x')));
  ok('drawtext enable', opt(dts[0], 'enable') === 'between(t,0.2,3)');
  ok('rotated text, emoji, drawing are PNG overlays', ['text-1.png', 'sticker-1.png', 'drawing-1.png'].every((n) => all.includes(n)));
  ok('image overlay', all.includes('-loop 1 -t 9 -i logo.png') && fl.some((x) => x.name === 'colorchannelmixer' && opt(x, 'aa') === '0.7'));
  ok('rotate filter', fl.some((x) => x.name === 'rotate' && opt(x, 'c') === 'none'));
  ok('music: trim, delay, mix', all.includes('-ss 0 -t 8 -i song.mp3') && fl.some((x) => x.name === 'adelay' && opt(x, 'delays') === '1250') && fl.some((x) => x.name === 'amix' && opt(x, 'normalize') === '0'));
  eq('notes', d1.notes.map((n) => n.code).sort(), ['animApprox', 'animApprox', 'drawing', 'emoji', 'fonts', 'rotatedText']);
  eq('ops per element', [d1.ops.get(k1.id).map((o) => o.key), d1.ops.get(k1.id + ':t').map((o) => o.key)], [['trim', 'speed', 'look', 'blur', 'vignette', 'vfadeIn', 'volume', 'fadeIn'], ['transition']]);
  for (const r of [txt.id, rot.id, emo.id, pic.id, drw.id, mus.id, 'output']) ok(`ops for ${r}`, d1.ops.get(r)?.length > 0);
  const d2 = describe(fp, { mode: 'steps', short: 720 });
  eq('steps', d2.steps.map((s) => (s.comment || '').split(':')[0]), ['clip 1', 'clip 2', 'clip 3', 'freeze frame at 4.2 s', 'clip 4', 'clip 5', 'clip 6', 'join the clips (transitions)', 'text, stickers and music']);
  eq('empty project', describe(newProject()).steps, []);
  // Only audio + text: a colour source as the canvas.
  const op = newProject({ aspect: '1:1' });
  const om = E.addMedia(op, { kind: 'audio', name: 'voice.wav', duration: 3 });
  E.addAudio(op, om.id, 0);
  E.addOverlay(op, { type: 'text', text: 'Podcast', start: 0, end: 3 });
  const d3 = describe(op, { short: 480 });
  eq('audio-only graph valid', checkDescription(d3), []);
  ok('colour source', renderScript(d3.steps, 'bash').text.includes('color=c=black:s=480x480:r=30:d=3'));

  console.log(`timeline: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
