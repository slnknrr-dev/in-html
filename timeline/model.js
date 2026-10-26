// timeline/model.js - the video project: media, a magnetic main track of clips (video / still images) with
// transitions, overlay rows (text, stickers, images, drawings) and audio rows. Plain JSON data; normalizeProject()
// turns any input into a valid project (unknown fields dropped, numbers clamped, sizes bounded), layout() computes
// where everything sits on the timeline. No DOM.
//
// Project
//   { type: 'in-html-video-project', version: 1, name, aspect: '9:16' | '1:1' | '4:5' | '16:9', fps,
//     fit: 'fit' | 'fill' | 'blur' (default framing of clips), background: '#rrggbb', seq (id counter),
//     media: [Media], main: [Clip], overlays: [Item], audio: [AudioClip] }
// Media      { id, kind: 'video' | 'audio' | 'image', name, size, mime, duration, width, height, fps, hasAudio,
//              hasVideo, origin: null | { kind: 'freeze', media, time } | { kind: 'edited', media } }
// Clip       { id, media, in, out (source seconds; a still image: in 0, out = its duration), speed, keepPitch,
//              volume, muted, fadeIn, fadeOut (audio, s), vfadeIn, vfadeOut (from / to black, s),
//              fit: null | fit | fill | blur, zoom, panX, panY (fractions of the frame), rotate (0/90/180/270),
//              flipH, flipV, adjust (see color.js), kenburns: null | { from: {z, x, y}, to: {z, x, y} },
//              transition: null | { type, duration } (into the next clip) }
// Item       { id, type: 'text' | 'emoji' | 'image' | 'drawing', row, start, end, x, y (centre, fractions of the
//              frame), scale, rotation (deg), opacity, animIn / animOut: { type, duration },
//              text: text, font, size (fraction of the frame height), color, bold, italic, align, stroke
//              { color, width (fraction of the size) }, shadow, box { color, opacity }
//              emoji: emoji, size;  image: media, w (fraction of the frame width);
//              drawing: strokes [{ tool: pen | marker | neon, color, width (fraction of the height), points [x, y, …] }] }
// AudioClip  { id, media, row, start, in, out, volume, muted, fadeIn, fadeOut }

import { normalizeAdjust } from './color.js';

export const PROJECT_TYPE = 'in-html-video-project';
export const VERSION = 1;
export const MIN_LEN = 0.1;

export const ASPECTS = { '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '16:9': [16, 9] };
export const FITS = ['fit', 'fill', 'blur'];
export const FPS = [24, 25, 30, 50, 60];
// ffmpeg xfade transition names (the preview draws the same ones).
export const TRANSITIONS = ['fade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft',
  'slideright', 'slideup', 'slidedown', 'circleopen', 'circleclose', 'zoomin'];
export const ANIMS = ['none', 'fade', 'slideup', 'slidedown', 'slideleft', 'slideright', 'zoom', 'pop', 'typewriter'];
export const FONTS = {
  sans: { css: 'Arial, "Helvetica Neue", Helvetica, sans-serif', ffmpeg: 'Arial' },
  serif: { css: 'Georgia, "Times New Roman", serif', ffmpeg: 'Georgia' },
  mono: { css: '"Courier New", Courier, monospace', ffmpeg: 'Courier New' },
  impact: { css: 'Impact, "Arial Black", sans-serif', ffmpeg: 'Impact' },
  rounded: { css: '"Trebuchet MS", "Segoe UI", sans-serif', ffmpeg: 'Trebuchet MS' },
  script: { css: '"Comic Sans MS", "Segoe Print", cursive', ffmpeg: 'Comic Sans MS' },
};
export const TOOLS = ['pen', 'marker', 'neon'];

// Ken Burns presets: the visible window of the image at the start and the end: zoom z >= 1 and its centre (x, y) as
// fractions of the image filled into the frame.
const edge = (z) => 1 / (2 * z);
export const KENBURNS = {
  zoomIn: { from: { z: 1, x: 0.5, y: 0.5 }, to: { z: 1.3, x: 0.5, y: 0.5 } },
  zoomOut: { from: { z: 1.3, x: 0.5, y: 0.5 }, to: { z: 1, x: 0.5, y: 0.5 } },
  panRight: { from: { z: 1.25, x: edge(1.25), y: 0.5 }, to: { z: 1.25, x: 1 - edge(1.25), y: 0.5 } },
  panLeft: { from: { z: 1.25, x: 1 - edge(1.25), y: 0.5 }, to: { z: 1.25, x: edge(1.25), y: 0.5 } },
  panDown: { from: { z: 1.25, x: 0.5, y: edge(1.25) }, to: { z: 1.25, x: 0.5, y: 1 - edge(1.25) } },
  panUp: { from: { z: 1.25, x: 0.5, y: 1 - edge(1.25) }, to: { z: 1.25, x: 0.5, y: edge(1.25) } },
  zoomInTopLeft: { from: { z: 1, x: 0.5, y: 0.5 }, to: { z: 1.4, x: edge(1.4) + 0.05, y: edge(1.4) + 0.05 } },
  zoomInBottomRight: { from: { z: 1, x: 0.5, y: 0.5 }, to: { z: 1.4, x: 0.95 - edge(1.4), y: 0.95 - edge(1.4) } },
};

// --- value helpers ------------------------------------------------------------------------------------------------

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const r3 = (v) => Math.round(v * 1000) / 1000;
export function clampNum(v, lo, hi, def) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}
const time = (v, def = 0, hi = 86400) => r3(clampNum(v, 0, hi, def));
const str = (v, max, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const bool = (v, def = false) => (typeof v === 'boolean' ? v : def);
export const hexColor = (v, def = '#000000') => {
  if (typeof v !== 'string') return def;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return def;
};
const ID = /^[a-z][a-z0-9_-]{0,31}$/i;
// 0 / 90 / 180 / 270 (nearest quarter turn).
export const quarter = (v) => ((Math.round(clampNum(v, -3600, 3600, 0) / 90) * 90) % 360 + 360) % 360;
const anim = (a, def) => (isObj(a) ? { type: oneOf(a.type, ANIMS, def.type), duration: r3(clampNum(a.duration, 0.05, 5, def.duration)) } : { ...def });

// --- defaults ------------------------------------------------------------------------------------------------------

export function newProject(opts = {}) {
  return normalizeProject({ name: opts.name || 'Untitled', aspect: opts.aspect || '9:16', fps: opts.fps || 30, fit: opts.fit || 'blur' });
}

export function nextId(p, prefix) {
  const used = new Set([...p.media, ...p.main, ...p.overlays, ...p.audio].map((x) => x.id));
  let id;
  do { p.seq = (p.seq || 0) + 1; id = prefix + p.seq; } while (used.has(id));
  return id;
}

// --- normalization -------------------------------------------------------------------------------------------------

export function normalizeMedia(m) {
  if (!isObj(m) || typeof m.id !== 'string' || !ID.test(m.id)) return null;
  const kind = oneOf(m.kind, ['video', 'audio', 'image'], null);
  if (!kind) return null;
  const o = {
    id: m.id, kind, name: str(m.name, 200, 'media') || 'media', size: Math.round(clampNum(m.size, 0, 1e13, 0)), mime: str(m.mime, 100),
    duration: kind === 'image' ? 0 : r3(clampNum(m.duration, 0, 86400 * 2, 0)),
    width: Math.round(clampNum(m.width, 0, 16384, 0)), height: Math.round(clampNum(m.height, 0, 16384, 0)),
    fps: r3(clampNum(m.fps, 1, 240, 30)),
    hasAudio: kind === 'audio' ? true : kind === 'image' ? false : bool(m.hasAudio, false),
    hasVideo: kind === 'audio' ? false : true,
    origin: null,
  };
  if (isObj(m.origin)) {
    if (m.origin.kind === 'freeze' && typeof m.origin.media === 'string') o.origin = { kind: 'freeze', media: m.origin.media, time: time(m.origin.time) };
    else if (m.origin.kind === 'edited' && typeof m.origin.media === 'string') o.origin = { kind: 'edited', media: m.origin.media };
  }
  return o;
}

const point = (v, def) => ({
  z: r3(clampNum(v?.z, 1, 4, def.z)),
  x: r3(clampNum(v?.x, 0, 1, def.x)),
  y: r3(clampNum(v?.y, 0, 1, def.y)),
});

// Keeps the window centre inside the image for the zoom (the visible half-size is 1 / (2 z)).
export function clampView(v) {
  const e = edge(v.z);
  return { z: v.z, x: r3(Math.min(1 - e, Math.max(e, v.x))), y: r3(Math.min(1 - e, Math.max(e, v.y))) };
}

export function normalizeKenBurns(kb) {
  if (!isObj(kb)) return null;
  const C = { z: 1, x: 0.5, y: 0.5 };
  return { from: clampView(point(kb.from, C)), to: clampView(point(kb.to, C)) };
}

export function normalizeClip(c, media) {
  if (!isObj(c) || typeof c.id !== 'string' || !ID.test(c.id) || !media) return null;
  const image = media.kind === 'image';
  const dur = image ? 3600 : Math.max(MIN_LEN, media.duration || 0);
  let a = time(c.in, 0, dur), b = time(c.out, image ? 3 : dur, image ? 3600 : dur);
  if (image) { a = 0; b = Math.max(MIN_LEN, b); }
  if (b - a < MIN_LEN / 2) { if (a > 0) a = Math.max(0, b - MIN_LEN); else b = Math.min(dur, a + MIN_LEN); }
  const t = isObj(c.transition) && TRANSITIONS.includes(c.transition.type)
    ? { type: c.transition.type, duration: r3(clampNum(c.transition.duration, 0.1, 5, 0.5)) } : null;
  return {
    id: c.id, media: media.id, in: a, out: b,
    speed: image ? 1 : r3(clampNum(c.speed, 0.1, 8, 1)), keepPitch: bool(c.keepPitch, true),
    volume: r3(clampNum(c.volume, 0, 4, 1)), muted: bool(c.muted), fadeIn: time(c.fadeIn, 0, 60), fadeOut: time(c.fadeOut, 0, 60),
    vfadeIn: time(c.vfadeIn, 0, 60), vfadeOut: time(c.vfadeOut, 0, 60),
    fit: oneOf(c.fit, FITS, null), zoom: r3(clampNum(c.zoom, 0.2, 5, 1)), panX: r3(clampNum(c.panX, -2, 2, 0)), panY: r3(clampNum(c.panY, -2, 2, 0)),
    rotate: quarter(c.rotate),
    flipH: bool(c.flipH), flipV: bool(c.flipV),
    adjust: normalizeAdjust(c.adjust),
    kenburns: image ? normalizeKenBurns(c.kenburns) : null,
    transition: t,
  };
}

const MAX_POINTS = 20000;
function normalizeStroke(s) {
  if (!isObj(s) || !Array.isArray(s.points)) return null;
  const pts = [];
  for (let i = 0; i + 1 < s.points.length && pts.length < MAX_POINTS; i += 2) {
    const x = Number(s.points[i]), y = Number(s.points[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push(Math.round(clampNum(x, -1, 2, 0) * 10000) / 10000, Math.round(clampNum(y, -1, 2, 0) * 10000) / 10000);
  }
  if (!pts.length) return null;
  return { tool: oneOf(s.tool, TOOLS, 'pen'), color: hexColor(s.color, '#ff3b30'), width: Math.round(clampNum(s.width, 0.001, 0.2, 0.01) * 10000) / 10000, points: pts };
}

export function normalizeItem(it, mediaById) {
  if (!isObj(it) || typeof it.id !== 'string' || !ID.test(it.id)) return null;
  const type = oneOf(it.type, ['text', 'emoji', 'image', 'drawing'], null);
  if (!type) return null;
  const start = time(it.start);
  const end = Math.max(start + MIN_LEN, time(it.end, start + 3, 86400 * 2));
  const o = {
    id: it.id, type, row: Math.round(clampNum(it.row, 0, 31, 0)), start, end: r3(end),
    x: r3(clampNum(it.x, -1, 2, 0.5)), y: r3(clampNum(it.y, -1, 2, 0.5)), scale: r3(clampNum(it.scale, 0.05, 20, 1)),
    rotation: r3(clampNum(it.rotation, -360, 360, 0)), opacity: r3(clampNum(it.opacity, 0, 1, 1)),
    animIn: anim(it.animIn, { type: 'fade', duration: 0.3 }), animOut: anim(it.animOut, { type: 'fade', duration: 0.3 }),
  };
  if (type === 'text') {
    Object.assign(o, {
      text: str(it.text, 2000, 'Text').replace(/\r\n?/g, '\n'), font: oneOf(it.font, Object.keys(FONTS), 'sans'),
      size: r3(clampNum(it.size, 0.01, 0.5, 0.06)), color: hexColor(it.color, '#ffffff'), bold: bool(it.bold, true), italic: bool(it.italic),
      align: oneOf(it.align, ['left', 'center', 'right'], 'center'),
      stroke: { color: hexColor(it.stroke?.color, '#000000'), width: r3(clampNum(it.stroke?.width, 0, 0.5, 0)) },
      shadow: bool(it.shadow, true), box: { color: hexColor(it.box?.color, '#000000'), opacity: r3(clampNum(it.box?.opacity, 0, 1, 0)) },
    });
  } else if (type === 'emoji') {
    Object.assign(o, { emoji: str(it.emoji, 16, '⭐') || '⭐', size: r3(clampNum(it.size, 0.02, 1, 0.15)) });
  } else if (type === 'image') {
    if (typeof it.media !== 'string' || mediaById.get(it.media)?.kind !== 'image') return null;
    Object.assign(o, { media: it.media, w: r3(clampNum(it.w, 0.02, 2, 0.4)) });
  } else {
    const strokes = (Array.isArray(it.strokes) ? it.strokes : []).slice(0, 2000).map(normalizeStroke).filter(Boolean);
    Object.assign(o, { strokes });
  }
  return o;
}

export function normalizeAudioClip(c, media) {
  if (!isObj(c) || typeof c.id !== 'string' || !ID.test(c.id) || !media || !media.hasAudio) return null;
  const dur = Math.max(MIN_LEN, media.duration || 0);
  let a = time(c.in, 0, dur), b = time(c.out, dur, dur);
  if (b - a < MIN_LEN / 2) { a = Math.max(0, Math.min(a, dur - MIN_LEN)); b = Math.min(dur, a + MIN_LEN); }
  return {
    id: c.id, media: media.id, row: Math.round(clampNum(c.row, 0, 31, 0)), start: time(c.start), in: a, out: b,
    volume: r3(clampNum(c.volume, 0, 4, 1)), muted: bool(c.muted), fadeIn: time(c.fadeIn, 0, 60), fadeOut: time(c.fadeOut, 0, 60),
  };
}

// The trust boundary of the editor: every project (opened file, pasted JSON, undo snapshot) passes through here, so
// renderers can assume valid types and ranges and never re-check. Whitelisting builds a NEW object (unknown fields
// cannot ride along); list lengths are capped so a hostile file cannot make layout() quadratic in millions of
// items; references to missing media drop the clip; duplicate ids keep the first. Normalisation is idempotent.
export function normalizeProject(raw) {
  const p = isObj(raw) ? raw : {};
  const out = {
    type: PROJECT_TYPE, version: VERSION, name: str(p.name, 120, 'Untitled') || 'Untitled',
    aspect: oneOf(p.aspect, Object.keys(ASPECTS), '9:16'), fps: oneOf(Math.round(Number(p.fps)), FPS, 30),
    fit: oneOf(p.fit, FITS, 'blur'), background: hexColor(p.background, '#000000'),
    seq: Math.round(clampNum(p.seq, 0, 1e9, 0)), media: [], main: [], overlays: [], audio: [],
  };
  const ids = new Set();
  const fresh = (x) => { if (!x || ids.has(x.id)) return null; ids.add(x.id); return x; };
  for (const m of (Array.isArray(p.media) ? p.media : []).slice(0, 2000)) { const n = fresh(normalizeMedia(m)); if (n) out.media.push(n); }
  const byId = new Map(out.media.map((m) => [m.id, m]));
  for (const c of (Array.isArray(p.main) ? p.main : []).slice(0, 5000)) {
    const m = byId.get(c?.media);
    if (!m || m.kind === 'audio') continue;
    const n = fresh(normalizeClip(c, m));
    if (n) out.main.push(n);
  }
  for (const it of (Array.isArray(p.overlays) ? p.overlays : []).slice(0, 5000)) { const n = fresh(normalizeItem(it, byId)); if (n) out.overlays.push(n); }
  for (const c of (Array.isArray(p.audio) ? p.audio : []).slice(0, 5000)) { const n = fresh(normalizeAudioClip(c, byId.get(c?.media))); if (n) out.audio.push(n); }
  // Ids look like <letter><number>: keep the counter ahead of them.
  for (const id of ids) { const n = +(/(\d+)$/.exec(id)?.[1] || 0); if (n > out.seq && n < 1e9) out.seq = n; }
  return out;
}

// --- layout --------------------------------------------------------------------------------------------------------

export const mediaMap = (p) => new Map(p.media.map((m) => [m.id, m]));
export const isStill = (m) => m?.kind === 'image';

/** Timeline length of a main clip (a still lasts out - in; a video clip plays its range at its speed). */
export function clipLength(c, m) {
  return Math.max(MIN_LEN / 2, isStill(m) ? c.out - c.in : (c.out - c.in) / (c.speed || 1));
}

/**
 * Where everything sits: { total, mainEnd, main: [Entry], overlays: [{ item, start, end }], audio: [{ clip, media,
 * start, end }], media: Map }. Main entry { clip, media, index, start, end, len, xIn, xOut, tOut } — a transition
 * of duration d between clips i and i+1 makes clip i+1 start d before clip i ends (as ffmpeg's xfade does); d is
 * clamped to half of either clip.
 */
// Derived, never stored: start/end times are recomputed from the clip list on demand, which is what makes the main
// track "magnetic" - deleting or trimming a clip cannot leave gaps or overlaps because positions do not exist in the
// data. Times are rounded to milliseconds (r3) so the browser and ffmpeg paths compute identical cut points.
export function layout(p) {
  const media = mediaMap(p);
  const lens = p.main.map((c) => clipLength(c, media.get(c.media)));
  const main = [];
  let t = 0;
  for (let i = 0; i < p.main.length; i++) {
    const c = p.main[i];
    const len = lens[i];
    const xIn = i > 0 ? main[i - 1].xOut : 0;
    const start = i > 0 ? t - xIn : 0;
    let xOut = 0;
    if (c.transition && i < p.main.length - 1) xOut = r3(Math.min(c.transition.duration, len / 2, lens[i + 1] / 2));
    const e = { clip: c, media: media.get(c.media), index: i, start: r3(start), end: r3(start + len), len, xIn, xOut, tOut: xOut > 0 ? c.transition : null };
    main.push(e);
    t = e.end;
  }
  const mainEnd = main.length ? main[main.length - 1].end : 0;
  const overlays = p.overlays.map((item) => ({ item, start: item.start, end: item.end })).sort((a, b) => a.item.row - b.item.row || a.start - b.start);
  const audio = p.audio.map((clip) => ({ clip, media: media.get(clip.media), start: clip.start, end: r3(clip.start + (clip.out - clip.in)) }));
  const total = r3(Math.max(mainEnd, ...overlays.map((o) => o.end), ...audio.map((a) => a.end), 0));
  return { total, mainEnd, main, overlays, audio, media };
}

/** What plays at time t: { main: [Entry] (two during a transition), overlays: [item], audio: [entry] }. */
export function activeAt(L, t) {
  const main = L.main.filter((e) => t >= e.start && (t < e.end || (e.index === L.main.length - 1 && t <= e.end && t > e.start)));
  return {
    main,
    overlays: L.overlays.filter((o) => t >= o.start && t < o.end).map((o) => o.item),
    audio: L.audio.filter((a) => t >= a.start && t < a.end),
  };
}

/** Source time of a main entry at timeline time t (clamped into the clip's range). */
export function sourceTime(e, t) {
  const c = e.clip;
  const s = c.in + (t - e.start) * (isStill(e.media) ? 1 : c.speed);
  return Math.min(c.out, Math.max(c.in, s));
}

/** Output size of an aspect for a short side (even numbers): '9:16', 1080 -> 1080 x 1920. */
export function frameSize(aspect, short = 1080) {
  const [a, b] = ASPECTS[aspect] || ASPECTS['9:16'];
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return a <= b ? { width: even(short), height: even((short * b) / a) } : { width: even((short * a) / b), height: even(short) };
}

/** The Ken Burns window at progress k (0..1): linear between the two views. */
export function kenBurnsAt(kb, k) {
  const q = Math.min(1, Math.max(0, k));
  return { z: kb.from.z + (kb.to.z - kb.from.z) * q, x: kb.from.x + (kb.to.x - kb.from.x) * q, y: kb.from.y + (kb.to.y - kb.from.y) * q };
}
