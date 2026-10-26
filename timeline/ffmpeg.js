// timeline/ffmpeg.js - the project as ffmpeg commands: what each timeline operation would be on the command line.
// Text to read and copy; nothing runs it. Everything ffmpeg can express maps to a filter or an option; what it cannot
// (freehand drawing, emoji, rotated text, pictures painted in the editor) becomes a PNG overlay with a note, and
// animations drawtext / overlay cannot do (zoom, pop, typewriter) are approximated by a fade with a note.
//
//   describe(project, options) -> {
//     steps: [{ comment, argv, ref }]        argv for ffcmd/command.js (renderCommand / renderScript)
//     ops: Map(ref -> [{ key, vars, code }]) per timeline element: the operations and their filters / options
//     notes: [{ ref, code, vars }]           approximations and things to know
//     assets: [{ name, ref, kind, media? }]  files the commands read that only the editor can make (PNG overlays)
//     output, width, height, fps, total }
//   options { mode: 'single' | 'steps', format: 'mp4-h264' (ffcmd/codecs.js ids), short: 1080 (short side),
//             quality: 'low' | 'med' | 'high', videoBitrate: 0, output: file name, measure(text, fs, item) }
//
// Refs: element ids (clips c…, overlays o…, audio clips a…), '<clip id>:t' for the transition after a clip,
// 'project' (canvas, padding, mix) and 'output' (encoding).
//
// Single command: every main clip is an input (-ss / -t, or -loop 1 -t for a still) with its own chain (setpts,
// transpose / flips, colour filters, scale + pad / crop or a blurred background, setsar, fps, format, fades); runs of
// clips are joined with concat, transitions with xfade / acrossfade at the clip's offset; text is drawtext,
// pictures are overlay with enable='between(t,a,b)'; audio clips are delayed (adelay) and mixed (amix).
// Steps: one command per clip writes part01.mp4 …, a second joins them, a third adds overlays and music.

import { Graph, f } from '../ffcmd/graph.js';
import { color as ffcolor, num } from '../ffcmd/escape.js';
import { FORMATS, INTERMEDIATE, encodeArgs } from '../ffcmd/codecs.js';
import { ref } from '../ffcmd/command.js';
import { FONTS, frameSize, isStill, layout, mediaMap } from './model.js';
import { adjustOps } from './color.js';
import { SLIDE, animDurations, blurSigma, placement, textLayout } from './frame.js';

const n3 = (v) => num(v, 3);
const n4 = (v) => num(v, 4);
const pad2 = (i) => String(i).padStart(2, '0');
const RATE = 48000;
const AFORMAT = () => f('aformat', { sample_rates: RATE, channel_layouts: 'stereo' });
const APPROX = new Set(['zoom', 'pop', 'typewriter']);
// Comment text stays plain in both shells (cmd.exe would still parse & | < > ^ % after REM in some contexts).
const plainText = (s) => String(s).replace(/[&|<>^%!"\\\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

class Ctx {
  constructor(p, o) {
    this.p = p;
    this.o = o;
    this.L = layout(p);
    this.media = mediaMap(p);
    const s = frameSize(p.aspect, o.short);
    this.W = s.width;
    this.H = s.height;
    this.fps = p.fps;
    this.bg = ffcolor(p.background);
    this.ops = new Map();
    this.notes = [];
    this.assets = [];
    this.counts = {};
    this.assetOf = new Map();
  }

  op(r, key, vars, code) {
    if (!this.ops.has(r)) this.ops.set(r, []);
    this.ops.get(r).push({ key, vars: vars || {}, code: Array.isArray(code) ? code.join(', ') : code || '' });
  }

  note(r, code, vars = {}) {
    if (!this.notes.some((n) => n.ref === r && n.code === code)) this.notes.push({ ref: r, code, vars });
  }

  // A PNG that the editor renders for the commands (one per element).
  asset(r, kind, extra = {}) {
    if (this.assetOf.has(r)) return this.assetOf.get(r);
    this.counts[kind] = (this.counts[kind] || 0) + 1;
    const name = extra.name || `${kind}-${this.counts[kind]}.png`;
    this.assets.push({ name, ref: r, kind, ...extra });
    this.assetOf.set(r, name);
    return name;
  }

  file(m) {
    const name = String(m?.name || 'input').replace(/[\u0000-\u001f]/g, '_');
    if (m?.origin?.kind === 'edited') return this.asset(m.id, 'media', { name, media: m.id });
    return name;
  }
}

// --- clips -----------------------------------------------------------------------------------------------------------

/** How a main clip enters ffmpeg: { kind, args (input options), file }. */
function clipInput(ctx, e, extracted = null) {
  const c = e.clip, m = e.media;
  if (isStill(m)) {
    const src = m.origin?.kind === 'freeze' ? ctx.media.get(m.origin.media) : null;
    if (src && !extracted) return { kind: 'freeze', args: ['-ss', n3(m.origin.time)], file: ctx.file(src), time: m.origin.time };
    const file = extracted || ctx.file(m);
    if (c.kenburns) return { kind: 'kb', args: [], file };
    return { kind: 'still', args: ['-loop', '1', '-t', n3(e.len)], file };
  }
  return { kind: 'video', args: ['-ss', n3(c.in), '-t', n3(c.out - c.in)], file: ctx.file(m) };
}

function colorFilters(ctx, c, id) {
  const out = [];
  const ops = adjustOps(c.adjust);
  const pre = [];
  for (const op of ops) {
    if (op.kind === 'curves') pre.push(f('curves', { preset: op.preset }));
    else if (op.kind === 'mixer') {
      const k = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'];
      pre.push(f('colorchannelmixer', Object.fromEntries(k.map((x, i) => [x, n4(op.m[i])]))));
    } else if (op.kind === 'eq') {
      pre.push(f('eq', { brightness: op.brightness ? n4(op.brightness) : null, contrast: op.contrast !== 1 ? n4(op.contrast) : null, saturation: op.saturation !== 1 ? n4(op.saturation) : null }));
    } else if (op.kind === 'temperature') pre.push(f('colortemperature', { temperature: op.kelvin }));
    else if (op.kind === 'hue') pre.push(f('hue', { h: n3(op.degrees) }));
  }
  if (pre.length) {
    out.push(...pre);
    const a = c.adjust;
    if (a.preset !== 'none') ctx.op(id, 'look', { preset: a.preset }, pre);
    else ctx.op(id, 'adjust', { ...a }, pre);
  }
  const vig = ops.find((op) => op.kind === 'vignette');
  return { pre: out, vignette: vig ? f('vignette', { angle: n4(vig.angle) }) : null };
}

/** The video chain(s) of a main clip into graph g, from pad `inp` to pad `out` (null: the implicit -vf ends). */
function clipVideo(ctx, g, e, src, inp, out) {
  const { W, H, fps } = ctx;
  const c = e.clip, m = e.media, id = c.id;
  const filters = [];
  if (src.kind === 'video') {
    if (c.speed !== 1) {
      const sp = f('setpts', `(PTS-STARTPTS)/${n4(c.speed)}`);
      filters.push(sp);
      ctx.op(id, 'speed', { v: c.speed }, [sp, ...atempo(c.speed, c.keepPitch)]);
    } else filters.push(f('setpts', 'PTS-STARTPTS'));
  } else if (src.kind === 'freeze') {
    const fr = [f('trim', { end_frame: 1 }), f('setpts', 'PTS-STARTPTS'), f('tpad', { stop_mode: 'clone', stop_duration: n3(e.len) }), f('trim', { duration: n3(e.len) })];
    filters.push(...fr);
    ctx.op(id, 'freeze', { t: src.time }, [`-ss ${n3(src.time)}`, ...fr]);
  }
  // Quarter turns and mirrors (in the output orientation, after the turn).
  const turn = { 90: [f('transpose', 1)], 180: [f('hflip'), f('vflip')], 270: [f('transpose', 2)] }[c.rotate] || [];
  if (turn.length) { filters.push(...turn); ctx.op(id, 'rotate', { deg: c.rotate }, turn); }
  const flips = [c.flipH ? f('hflip') : null, c.flipV ? f('vflip') : null].filter(Boolean);
  if (flips.length) { filters.push(...flips); ctx.op(id, 'flip', { h: c.flipH, v: c.flipV }, flips); }
  const col = colorFilters(ctx, c, id);
  filters.push(...col.pre);
  const q = c.rotate === 90 || c.rotate === 270;
  const sw = q ? m.height : m.width, sh = q ? m.width : m.height;
  // After the framing: vignette, uniform pixels / rate for joining, fades. Their operations are listed after the
  // framing's (frame()).
  const tail = [];
  const later = [];
  if (col.vignette) { tail.push(col.vignette); later.push(['vignette', { v: c.adjust.vignette }, col.vignette]); }
  tail.push(f('setsar', 1), f('fps', fps), f('format', 'yuv420p'));
  if (c.vfadeIn > 0) { const x = f('fade', { t: 'in', st: 0, d: n3(c.vfadeIn) }); tail.push(x); later.push(['vfadeIn', { s: c.vfadeIn }, x]); }
  if (c.vfadeOut > 0) { const x = f('fade', { t: 'out', st: n3(Math.max(0, e.len - c.vfadeOut)), d: n3(c.vfadeOut) }); tail.push(x); later.push(['vfadeOut', { s: c.vfadeOut }, x]); }
  const ins = inp ? [inp] : [], outs = out ? [out] : [];
  const frame = (key, vars, code) => { ctx.op(id, key, vars, code); for (const l of later) ctx.op(id, ...l); };

  if (src.kind === 'kb') {
    const N = Math.max(1, Math.round(e.len * fps));
    const { from: a, to: b } = c.kenburns;
    const k = N > 1 ? `on/${N - 1}` : '0';
    const lin = (u, v) => (Math.abs(u - v) < 1e-4 ? n4(u) : `(${n4(u)}+${n4(v - u)}*${k})`);
    const kb = [
      f('scale', W * 2, H * 2, { force_original_aspect_ratio: 'increase' }), f('crop', W * 2, H * 2),
      f('zoompan', { z: lin(a.z, b.z), x: `iw*${lin(a.x, b.x)}-iw/zoom/2`, y: `ih*${lin(a.y, b.y)}-ih/zoom/2`, d: N, s: `${W}x${H}`, fps }),
    ];
    g.chain(ins, [...filters, ...kb, ...tail], outs, id);
    frame('kenburns', { from: a, to: b }, kb[2]);
    return;
  }
  const fit = c.fit || ctx.p.fit;
  const pl = placement(sw || W, sh || H, c, fit, W, H);
  const R = Math.round;
  if (fit === 'blur') {
    const bgL = g.label('bg'), fgL = g.label('fg'), sa = g.label('s'), sb = g.label('s');
    const sigma = blurSigma(W, H);
    g.chain(ins, [...filters, f('split', 2)], [sa, sb], id);
    const bg = [f('scale', W, H, { force_original_aspect_ratio: 'increase' }), f('crop', W, H), f('gblur', { sigma })];
    g.chain([sa], bg, [bgL], id);
    const fg = pl.simple ? f('scale', W, H, { force_original_aspect_ratio: 'decrease' }) : f('scale', R(pl.fg.w / 2) * 2, R(pl.fg.h / 2) * 2);
    g.chain([sb], [fg], [fgL], id);
    const ov = pl.simple ? f('overlay', '(W-w)/2', '(H-h)/2') : f('overlay', R(pl.fg.x), R(pl.fg.y));
    g.chain([bgL, fgL], [ov, ...tail], outs, id);
    frame('blur', { zoom: c.zoom, panX: c.panX, panY: c.panY }, [`split=2`, ...bg, fg, ov]);
    return;
  }
  let geo;
  if (pl.simple && fit === 'fit') geo = [f('scale', W, H, { force_original_aspect_ratio: 'decrease' }), f('pad', W, H, '(ow-iw)/2', '(oh-ih)/2', { color: ctx.bg })];
  else if (pl.simple) geo = [f('scale', W, H, { force_original_aspect_ratio: 'increase' }), f('crop', W, H)];
  else {
    // Zoomed / moved: scale, keep the part inside the frame, pad the rest.
    const w = R(pl.fg.w / 2) * 2, h = R(pl.fg.h / 2) * 2, x = R(pl.fg.x), y = R(pl.fg.y);
    const fx0 = Math.max(0, x), fy0 = Math.max(0, y), fx1 = Math.min(W, x + w), fy1 = Math.min(H, y + h);
    geo = [f('scale', w, h)];
    if (fx1 > fx0 && fy1 > fy0) {
      const cw = fx1 - fx0, ch = fy1 - fy0;
      if (cw !== w || ch !== h) geo.push(f('crop', cw, ch, fx0 - x, fy0 - y));
      if (cw !== W || ch !== H) geo.push(f('pad', W, H, fx0, fy0, { color: ctx.bg }));
    } else geo.push(f('crop', 2, 2, 0, 0), f('pad', W, H, 0, 0, { color: ctx.bg }));
  }
  g.chain(ins, [...filters, ...geo, ...tail], outs, id);
  frame(pl.simple ? fit : 'frame', { zoom: c.zoom, panX: c.panX, panY: c.panY }, geo);
}

/** atempo keeps the pitch (each instance takes 0.5…2 in older ffmpeg, so big changes are chained). */
// Without pitch keeping: asetrate relabels the sample rate (playing faster AND higher, like a tape) and the
// surrounding aresample filters bring the stream back to the project rate so later filters see one format.
function atempo(speed, keepPitch) {
  if (!keepPitch) return [f('aresample', RATE), f('asetrate', Math.round(RATE * speed)), f('aresample', RATE)];
  const out = [];
  let s = speed;
  while (s > 2 + 1e-9) { out.push(f('atempo', 2)); s /= 2; }
  while (s < 0.5 - 1e-9) { out.push(f('atempo', 0.5)); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) out.push(f('atempo', n4(s)));
  return out;
}

/** The audio chain of a main clip, or null when it is silent (a still, no audio track, muted). */
function clipAudio(ctx, e, src) {
  const c = e.clip, m = e.media, id = c.id;
  if (src.kind !== 'video' || !m.hasAudio) return null;
  if (c.muted || c.volume <= 0) { ctx.op(id, 'mute', {}, 'anullsrc'); return null; }
  const out = [];
  if (c.speed !== 1) out.push(...atempo(c.speed, c.keepPitch));
  if (c.volume !== 1) { const v = f('volume', n3(c.volume)); out.push(v); ctx.op(id, 'volume', { v: Math.round(c.volume * 100) }, v); }
  out.push(...audioFades(ctx, id, c, e.len));
  out.push(AFORMAT());
  return out;
}

function audioFades(ctx, id, c, len) {
  const out = [];
  if (c.fadeIn > 0) { const x = f('afade', { t: 'in', st: 0, d: n3(Math.min(c.fadeIn, len)) }); out.push(x); ctx.op(id, 'fadeIn', { s: c.fadeIn }, x); }
  if (c.fadeOut > 0) { const x = f('afade', { t: 'out', st: n3(Math.max(0, len - c.fadeOut)), d: n3(Math.min(c.fadeOut, len)) }); out.push(x); ctx.op(id, 'fadeOut', { s: c.fadeOut }, x); }
  return out;
}

const silence = (len) => f('anullsrc', { r: RATE, cl: 'stereo', d: n3(len) });

// --- joining the main track ---------------------------------------------------------------------------------------

/** Runs of clips without transitions are concatenated, runs are joined with xfade / acrossfade. */
function joinMain(ctx, g, vl, al) {
  const L = ctx.L;
  const runs = [];
  let cur = [0];
  for (let i = 1; i < L.main.length; i++) {
    if (L.main[i - 1].xOut > 0) { runs.push(cur); cur = [i]; } else cur.push(i);
  }
  runs.push(cur);
  const runOut = (run, labels, kind) => {
    if (run.length === 1) return labels[run[0]];
    const o = g.label(kind === 'v' ? 'r' : 'ra');
    const cc = f('concat', { n: run.length, v: kind === 'v' ? 1 : 0, a: kind === 'v' ? 0 : 1 });
    g.chain(run.map((i) => labels[i]), [cc], [o], 'project');
    return o;
  };
  if (runs.some((r) => r.length > 1)) ctx.op('project', 'concat', { n: L.main.length }, 'concat');
  let v = runOut(runs[0], vl, 'v'), a = runOut(runs[0], al, 'a');
  for (let k = 1; k < runs.length; k++) {
    const prev = L.main[runs[k][0] - 1], next = L.main[runs[k][0]];
    const d = prev.xOut, tr = prev.tOut;
    const rv = runOut(runs[k], vl, 'v'), ra = runOut(runs[k], al, 'a');
    const xv = f('xfade', { transition: tr.type, duration: n3(d), offset: n3(next.start) });
    const xa = f('acrossfade', { d: n3(d) });
    const tref = prev.clip.id + ':t';
    const ov = g.label('x'), oa = g.label('xa');
    g.chain([v, rv], [xv], [ov], tref);
    g.chain([a, ra], [xa], [oa], tref);
    ctx.op(tref, 'transition', { type: tr.type, d, at: next.start }, [xv, xa]);
    v = ov; a = oa;
  }
  return { v, a };
}

// --- overlays and the audio mix ------------------------------------------------------------------------------------

function alphaExpr(item, din, dout) {
  const parts = [];
  if (din > 0) parts.push(`(t-${n3(item.start)})/${n3(din)}`);
  if (dout > 0) parts.push(`(${n3(item.end)}-t)/${n3(dout)}`);
  let e = null;
  for (const p of parts) e = e ? `min(${e},${p})` : `min(1,${p})`;
  if (item.opacity < 1) e = e ? `${n3(item.opacity)}*${e}` : n3(item.opacity);
  return e;
}

/** Slide offsets as expressions of t: { dx, dy } ('' when still). */
function slideExpr(ctx, item, din, dout) {
  const { W, H } = ctx;
  let dx = '', dy = '';
  const add = (type, dir, k) => {
    const ov = SLIDE.v * H, oh = SLIDE.h * W;
    const m = { slideup: ['y', dir * ov], slidedown: ['y', -dir * ov], slideleft: ['x', dir * oh], slideright: ['x', -dir * oh] }[type];
    if (!m) return;
    const term = `${n3(m[1])}*pow(max(0,1-${k}),3)`;
    if (m[0] === 'x') dx += (term.startsWith('-') ? '' : '+') + term; else dy += (term.startsWith('-') ? '' : '+') + term;
  };
  if (din > 0) add(item.animIn.type, 1, `(t-${n3(item.start)})/${n3(din)}`);
  if (dout > 0) add(item.animOut.type, -1, `(${n3(item.end)}-t)/${n3(dout)}`);
  return { dx, dy };
}

function animNotes(ctx, item) {
  for (const a of [item.animIn, item.animOut]) if (APPROX.has(a.type)) ctx.note(item.id, 'animApprox', { anim: a.type });
}

function drawtext(ctx, item) {
  const { W, H } = ctx;
  const lay = textLayout(item, W, H, ctx.o.measure);
  const fnt = FONTS[item.font] || FONTS.sans;
  const style = [item.bold ? 'Bold' : '', item.italic ? 'Italic' : ''].filter(Boolean).join(' ');
  const { din, dout } = animDurations(item);
  const alpha = alphaExpr(item, din, dout);
  const { dx, dy } = slideExpr(ctx, item, din, dout);
  const enable = `between(t,${n3(item.start)},${n3(item.end)})`;
  const out = [];
  for (const line of lay.lines) {
    if (!line.text.trim()) continue;
    const x = item.align === 'left' ? n3(line.x) : item.align === 'right' ? `${n3(line.x + line.w)}-text_w` : `${n3(item.x * W)}-text_w/2`;
    out.push({
      ref: item.id,
      text: f('drawtext', {
        expansion: 'none', font: fnt.ffmpeg + (style ? ':style=' + style : ''), text: line.text, fontsize: Math.round(lay.fs),
        fontcolor: ffcolor(item.color), borderw: lay.border || null, bordercolor: lay.border ? ffcolor(item.stroke.color) : null,
        shadowx: lay.shadow || null, shadowy: lay.shadow || null, shadowcolor: lay.shadow ? 'black@0.6' : null,
        box: item.box.opacity > 0 ? 1 : null, boxcolor: item.box.opacity > 0 ? ffcolor(item.box.color, item.box.opacity) : null,
        boxborderw: item.box.opacity > 0 ? lay.pad : null,
        x: x + dx, y: `${n3(line.baseline)}-max_glyph_a` + dy, alpha, enable,
      }),
    });
  }
  ctx.op(item.id, 'text', { text: item.text.slice(0, 40) }, out.map((o) => o.text));
  ctx.note('project', 'fonts', {});
  animNotes(ctx, item);
  return out;
}

/** A picture overlay (image file, or a PNG the editor renders) on top of pad `cur`; returns the new pad. */
function pictureOverlay(ctx, g, inputs, cur, item) {
  const { W, H } = ctx;
  let file, sizeF = null, rot = item.rotation;
  if (item.type === 'image') {
    const m = ctx.media.get(item.media);
    file = ctx.file(m);
    sizeF = f('scale', Math.max(2, Math.round((item.w * W * item.scale) / 2) * 2), -2);
  } else if (item.type === 'drawing') {
    file = ctx.asset(item.id, 'drawing', { w: W, h: H });
    rot = 0;
    ctx.note(item.id, 'drawing', { file });
  } else if (item.type === 'emoji') {
    file = ctx.asset(item.id, 'sticker');
    ctx.note(item.id, 'emoji', { file });
  } else {
    file = ctx.asset(item.id, 'text');
    ctx.note(item.id, 'rotatedText', { file });
  }
  inputs.push(ref(item.id, '-loop', '1', '-t', n3(item.end), '-i', file));
  const idx = inputs.length - 1;
  const { din, dout } = animDurations(item);
  const chain = [];
  if (sizeF) chain.push(sizeF);
  chain.push(f('format', 'rgba'));
  if (rot) { const a = n4((rot * Math.PI) / 180); chain.push(f('rotate', { a, c: 'none', ow: `rotw(${a})`, oh: `roth(${a})` })); }
  if (item.opacity < 1) chain.push(f('colorchannelmixer', { aa: n3(item.opacity) }));
  if (din > 0) chain.push(f('fade', { t: 'in', st: n3(item.start), d: n3(din), alpha: 1 }));
  if (dout > 0) chain.push(f('fade', { t: 'out', st: n3(item.end - dout), d: n3(dout), alpha: 1 }));
  const ol = g.label('o');
  g.chain([`${idx}:v`], chain, [ol], item.id);
  const { dx, dy } = slideExpr(ctx, item, din, dout);
  const x = (item.type === 'drawing' ? '0' : `${n3(item.x * W)}-w/2`) + dx;
  const y = (item.type === 'drawing' ? '0' : `${n3(item.y * H)}-h/2`) + dy;
  const ov = f('overlay', { x, y, enable: `between(t,${n3(item.start)},${n3(item.end)})` });
  const out = g.label('v');
  g.chain([cur, ol], [ov], [out], item.id);
  ctx.op(item.id, item.type === 'image' ? 'image' : item.type, { file }, [...chain, ov]);
  animNotes(ctx, item);
  return out;
}

/**
 * Padding to the project length, overlays and the audio mix on top of the joined main track (pads vIn / aIn, aIn may
 * be null). Returns { v, a } pads (a null without audio).
 */
function finish(ctx, g, inputs, vIn, aIn) {
  const { W, H, fps, L } = ctx;
  let cur = vIn;
  if (!cur) {
    cur = g.label('v');
    const src = f('color', { c: ctx.bg, s: `${W}x${H}`, r: fps, d: n3(L.total) });
    g.chain([], [src], [cur], 'project');
    ctx.op('project', 'canvas', { w: W, h: H }, src);
  } else if (L.total > L.mainEnd + 1e-3) {
    const o = g.label('v');
    const tp = f('tpad', { stop_mode: 'add', stop_duration: n3(L.total - L.mainEnd), color: ctx.bg });
    g.chain([cur], [tp], [o], 'project');
    ctx.op('project', 'pad', { s: L.total - L.mainEnd }, tp);
    cur = o;
  }
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const o = g.label('v');
    g.chain([cur], pending, [o]);
    cur = o;
    pending = [];
  };
  for (const { item } of L.overlays) {
    if (item.type === 'text' && !item.rotation) pending.push(...drawtext(ctx, item));
    else { flush(); cur = pictureOverlay(ctx, g, inputs, cur, item); }
  }
  flush();
  // Audio clips: trimmed at the input, faded, delayed to their start, mixed with the main track.
  const mixIn = aIn ? [aIn] : [];
  for (const a of L.audio) {
    const c = a.clip;
    if (!a.media || c.muted || c.volume <= 0) { if (c.muted) ctx.op(c.id, 'mute', {}, ''); continue; }
    inputs.push(ref(c.id, '-ss', n3(c.in), '-t', n3(c.out - c.in), '-i', ctx.file(a.media)));
    ctx.op(c.id, 'trim', { a: c.in, b: c.out }, `-ss ${n3(c.in)} -t ${n3(c.out - c.in)}`);
    const chain = [];
    if (c.volume !== 1) { const v = f('volume', n3(c.volume)); chain.push(v); ctx.op(c.id, 'volume', { v: Math.round(c.volume * 100) }, v); }
    chain.push(...audioFades(ctx, c.id, c, c.out - c.in));
    if (a.start > 0) { const d = f('adelay', { delays: Math.round(a.start * 1000), all: 1 }); chain.push(d); ctx.op(c.id, 'delay', { s: a.start }, d); }
    chain.push(AFORMAT());
    const o = g.label('m');
    g.chain([`${inputs.length - 1}:a`], chain, [o], c.id);
    mixIn.push(o);
  }
  let aOut = null;
  if (mixIn.length > 1) {
    aOut = g.label('mix');
    const mx = f('amix', { inputs: mixIn.length, duration: 'longest', dropout_transition: 0, normalize: 0 });
    g.chain(mixIn, [mx], [aOut], 'project');
    ctx.op('project', 'mix', { n: mixIn.length }, mx);
  } else if (mixIn.length === 1) aOut = mixIn[0];
  return { v: cur, a: aOut };
}

// --- commands ------------------------------------------------------------------------------------------------------

function outputArgs(ctx, hasAudio) {
  const o = ctx.o;
  const args = encodeArgs(o.format, { quality: o.quality, videoBitrate: o.videoBitrate, audio: hasAudio });
  ctx.op('output', 'encode', { format: o.format, w: ctx.W, h: ctx.H, fps: ctx.fps }, args.map((a) => [].concat(a).join(' ')));
  return args;
}

function outName(ctx) {
  const ext = (FORMATS[ctx.o.format] || FORMATS['mp4-h264']).ext;
  if (ctx.o.output) return ctx.o.output;
  const base = String(ctx.p.name || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 60) || 'video';
  return `${base}.${ext}`;
}

// Labels used as -map arguments stay visible in the graph: the last pads are renamed vout / aout.
function finalLabels(g, v, a) {
  if (v && v !== 'vout') g.relabel(v, 'vout');
  if (a && a !== 'aout') g.relabel(a, 'aout');
}

function single(ctx) {
  const g = new Graph();
  const inputs = [];
  const vl = [], al = [];
  for (const e of ctx.L.main) {
    const src = clipInput(ctx, e);
    inputs.push(ref(e.clip.id, ...src.args, '-i', src.file));
    const idx = inputs.length - 1;
    if (src.kind === 'video') ctx.op(e.clip.id, 'trim', { a: e.clip.in, b: e.clip.out }, src.args.join(' '));
    else if (src.kind === 'still') ctx.op(e.clip.id, 'still', { s: e.len }, src.args.join(' '));
    const v = g.label('v'), a = g.label('a');
    clipVideo(ctx, g, e, src, `${idx}:v`, v);
    const ac = clipAudio(ctx, e, src);
    if (ac) g.chain([`${idx}:a`], ac, [a], e.clip.id);
    else g.chain([], [silence(e.len)], [a], e.clip.id);
    vl.push(v); al.push(a);
  }
  const main = ctx.L.main.length ? joinMain(ctx, g, vl, al) : { v: null, a: null };
  const fin = finish(ctx, g, inputs, main.v, main.a);
  finalLabels(g, fin.v, fin.a);
  const argv = ['ffmpeg', ...inputs, ref('project', '-filter_complex', g), ref('output', '-map', '[vout]'), fin.a ? ref('output', '-map', '[aout]') : null,
    ...outputArgs(ctx, !!fin.a).map((a) => ref('output', ...[].concat(a))), ref('output', outName(ctx))];
  return [{ comment: null, argv, ref: null }];
}

function steps(ctx) {
  const out = [];
  const L = ctx.L;
  const parts = [];
  let freezeN = 0;
  L.main.forEach((e, i) => {
    let src = clipInput(ctx, e);
    const pre = [];
    if (src.kind === 'freeze') {
      const name = `freeze-${++freezeN}.png`;
      pre.push({ comment: `freeze frame at ${n3(src.time)} s`, ref: e.clip.id, argv: ['ffmpeg', ref(e.clip.id, '-ss', n3(src.time), '-i', src.file), ref(e.clip.id, '-frames:v', '1'), ref(e.clip.id, name)] });
      ctx.op(e.clip.id, 'freeze', { t: src.time }, `-ss ${n3(src.time)} -frames:v 1`);
      src = clipInput(ctx, e, name);
    }
    if (src.kind === 'video') ctx.op(e.clip.id, 'trim', { a: e.clip.in, b: e.clip.out }, src.args.join(' '));
    else if (src.kind === 'still') ctx.op(e.clip.id, 'still', { s: e.len }, src.args.join(' '));
    const gv = new Graph();
    clipVideo(ctx, gv, e, src, null, null);
    const ac = clipAudio(ctx, e, src);
    const name = `part${pad2(i + 1)}.mp4`;
    const argv = ['ffmpeg', ref(e.clip.id, ...src.args, '-i', src.file)];
    if (!ac) argv.push(ref(e.clip.id, '-f', 'lavfi', '-t', n3(e.len), '-i', `anullsrc=r=${RATE}:cl=stereo`));
    argv.push(ref(e.clip.id, '-vf', gv));
    if (ac) { const ga = new Graph(); ga.chain([], ac, [], e.clip.id); argv.push(ref(e.clip.id, '-af', ga)); }
    else argv.push(ref(e.clip.id, '-map', '0:v', '-map', '1:a', '-shortest'));
    parts.push({ name, argv, ref: e.clip.id, e, pre });
  });
  const hasExtra = L.overlays.length > 0 || L.audio.some((a) => a.media && !a.clip.muted && a.clip.volume > 0) || L.total > L.mainEnd + 1e-3 || !L.main.length;
  // Parts.
  parts.forEach((pt, i) => {
    const last = parts.length === 1 && !hasExtra;
    const argv = [...pt.argv, ...(last ? outputArgs(ctx, true) : INTERMEDIATE).map((a) => ref(last ? 'output' : pt.ref, ...[].concat(a))), ref(last ? 'output' : pt.ref, last ? outName(ctx) : pt.name)];
    out.push(...pt.pre, { comment: `clip ${i + 1}: ${plainText(pt.e.media.name)}`, argv, ref: pt.ref });
  });
  let joined = parts.length === 1 ? parts[0].name : null;
  if (parts.length > 1) {
    const g = new Graph();
    const vl = parts.map((_, i) => `${i}:v`), al = parts.map((_, i) => `${i}:a`);
    const j = joinMain(ctx, g, vl, al);
    const last = !hasExtra;
    finalLabels(g, j.v, j.a);
    joined = last ? outName(ctx) : 'joined.mp4';
    const argv = ['ffmpeg', ...parts.map((pt) => ref(pt.ref, '-i', pt.name)), ref('project', '-filter_complex', g), ref('output', '-map', '[vout]', '-map', '[aout]'),
      ...(last ? outputArgs(ctx, true) : INTERMEDIATE).map((a) => ref(last ? 'output' : 'project', ...[].concat(a))), ref(last ? 'output' : 'project', joined)];
    out.push({ comment: 'join the clips (transitions)', argv, ref: 'project' });
  }
  if (hasExtra) {
    const g = new Graph();
    const inputs = joined ? [ref('project', '-i', joined)] : [];
    const fin = finish(ctx, g, inputs, joined ? '0:v' : null, joined ? '0:a' : null);
    finalLabels(g, fin.v, fin.a);
    const argv = ['ffmpeg', ...inputs, ref('project', '-filter_complex', g), ref('output', '-map', '[vout]'), fin.a ? ref('output', '-map', '[aout]') : null,
      ...outputArgs(ctx, !!fin.a).map((a) => ref('output', ...[].concat(a))), ref('output', outName(ctx))];
    out.push({ comment: 'text, stickers and music', argv, ref: 'project' });
  }
  return out;
}

export function describe(p, options = {}) {
  const o = { mode: 'single', format: 'mp4-h264', short: 1080, quality: 'med', videoBitrate: 0, output: null, measure: null, ...options };
  const ctx = new Ctx(p, o);
  const list = ctx.L.total <= 0 ? [] : o.mode === 'steps' ? steps(ctx) : single(ctx);
  return { steps: list, ops: ctx.ops, notes: ctx.notes, assets: ctx.assets, output: outName(ctx), width: ctx.W, height: ctx.H, fps: ctx.fps, total: ctx.L.total };
}
