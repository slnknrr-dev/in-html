// video-processor/compose.js - the frame renderer shared by the preview, the export and frame grabs: draws
// the project at a time into a 2D canvas with the same geometry and colour operations the ffmpeg description uses
// (timeline/frame.js, timeline/color.js): clips framed by fit / fill / blurred background, quarter turns, mirrors,
// zoom and pan, Ken Burns windows, colour looks (SVG colour-matrix filters, or a pixel fallback), vignette, fades,
// xfade-style transitions, and the overlays (text, emoji, pictures, drawings) with their animations. Also renders the
// PNG assets the ffmpeg commands read (drawings, emoji, rotated text).
//
// Single source of pixels: preview, export and frame grab all call Compositor.render, and the geometry / colour
// maths live in timeline/frame.js and timeline/color.js, which ffmpeg.js also uses to build filter graphs. Any
// visual feature is therefore implemented once for both worlds, and the "what you see is what ffmpeg makes"
// promise is a consequence of the module layout, not of discipline.
import { FONTS, activeAt, isStill, kenBurnsAt, sourceTime } from '../timeline/model.js';
import { adjustOps, applyPlan, colorPlan, isNeutral, vignetteFactor } from '../timeline/color.js';
import { animState, blurSigma, coverCrop, kbWindow, placement, textLayout } from '../timeline/frame.js';

// Platform colour-emoji fonts in order (Apple, Windows, Android/Linux, Firefox's bundled Twemoji).
export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// smoothstep(a, b, x) = t^2 (3 - 2t): the same easing ffmpeg's xfade uses, so transition edges match.
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hexA = (hex, a) => {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function fontOf(item, px) {
  return `${item.italic ? 'italic ' : ''}${item.bold ? '700' : '400'} ${Math.max(1, px)}px ${(FONTS[item.font] || FONTS.sans).css}`;
}

let measureCtx = null;
/** Text width with the item's font (also passed to the ffmpeg description for left / right aligned text). */
// One shared off-screen 2D context for measurements (creating a canvas per call would be wasteful).
export function measureText(s, fs, item) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = fontOf(item, fs);
  return measureCtx.measureText(s).width;
}

// --- colour filters ------------------------------------------------------------------------------------------------

const SVGNS = 'http://www.w3.org/2000/svg';
let svgRoot = null;
const filterIds = new Map();
let fxState = null; // null: untested, true / false

// Hidden <svg> container for colour filters referenced by ctx.filter = 'url(#id)'. Recreated if something removed
// it from the document (the filter references would dangle otherwise).
function svg() {
  if (svgRoot?.isConnected) return svgRoot;
  svgRoot = document.createElementNS(SVGNS, 'svg');
  svgRoot.setAttribute('width', '0');
  svgRoot.setAttribute('height', '0');
  svgRoot.setAttribute('aria-hidden', 'true');
  svgRoot.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.append(svgRoot);
  filterIds.clear();
  return svgRoot;
}

// 256-entry curve -> 33 samples for feFuncX type=table (linear interpolation between them inside the filter).
const table = (t) => Array.from({ length: 33 }, (_, i) => t[Math.round((i * 255) / 32)].toFixed(4)).join(' ');

/** An SVG filter (feComponentTransfer for curves, feColorMatrix) for a colour plan; returns its CSS filter value. */
// Filters are cached by content (key = matrix + sampled curves): identical looks share one <filter>.
// color-interpolation-filters=sRGB: the default linearRGB would apply the matrix in linear light and the result
// would not match ffmpeg's colorchannelmixer / curves, which work on gamma-encoded values.
function filterFor(plan) {
  if (!plan.curves && !plan.matrix) return '';
  const key = JSON.stringify([plan.matrix, plan.curves && [table(plan.curves.r), table(plan.curves.g), table(plan.curves.b)]]);
  let id = filterIds.get(key);
  if (!id) {
    id = 'vpfx' + (filterIds.size + 1);
    const fl = document.createElementNS(SVGNS, 'filter');
    fl.setAttribute('id', id);
    fl.setAttribute('color-interpolation-filters', 'sRGB');
    if (plan.curves) {
      const ct = document.createElementNS(SVGNS, 'feComponentTransfer');
      for (const [ch, tb] of [['R', plan.curves.r], ['G', plan.curves.g], ['B', plan.curves.b]]) {
        const fn = document.createElementNS(SVGNS, 'feFunc' + ch);
        fn.setAttribute('type', 'table');
        fn.setAttribute('tableValues', table(tb));
        ct.append(fn);
      }
      fl.append(ct);
    }
    if (plan.matrix) {
      const m = plan.matrix, cm = document.createElementNS(SVGNS, 'feColorMatrix');
      cm.setAttribute('type', 'matrix');
      cm.setAttribute('values', [m[0], m[1], m[2], 0, m[3], m[4], m[5], m[6], 0, m[7], m[8], m[9], m[10], 0, m[11], 0, 0, 0, 1, 0].map((v) => +v.toFixed(5)).join(' '));
      fl.append(cm);
    }
    svg().append(fl);
    filterIds.set(key, id);
  }
  return `url(#${id})`;
}

/** Whether canvas 2D filters with url() references work here (else colours are applied to the pixels). */
// Feature test by effect, not by API presence: some engines accept ctx.filter = 'url(...)' and silently ignore
// it. Draw red through a red->green matrix and read the pixel back; only a real green proves support.
export function fxSupported() {
  if (fxState !== null) return fxState;
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
    const x = c.getContext('2d', { willReadFrequently: true });
    const src = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
    const sx = src.getContext('2d');
    sx.fillStyle = '#ff0000';
    sx.fillRect(0, 0, 4, 4);
    // Red -> green through a matrix.
    x.filter = filterFor({ curves: null, matrix: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] });
    x.drawImage(src, 0, 0);
    const d = x.getImageData(1, 1, 1, 1).data;
    fxState = d[1] > 200 && d[0] < 50;
  } catch { fxState = false; }
  return fxState;
}

let blurState = null;
// Engines without canvas filters keep ctx.filter at its default instead of the assigned string.
function blurSupported() {
  if (blurState !== null) return blurState;
  try { const x = document.createElement('canvas').getContext('2d'); x.filter = 'blur(2px)'; blurState = x.filter === 'blur(2px)'; } catch { blurState = false; }
  return blurState;
}

// --- sources -------------------------------------------------------------------------------------------------------

/** Natural size of a drawable (video element, VideoFrame, ImageBitmap, canvas, image). */
// Each drawable type names its intrinsic size differently: VideoFrame displayWidth, <video> videoWidth, images
// naturalWidth, canvas / ImageBitmap width.
export function sizeOf(src) {
  if (!src) return [0, 0];
  if ('displayWidth' in src) return [src.displayWidth, src.displayHeight];
  if ('videoWidth' in src) return [src.videoWidth, src.videoHeight];
  return [src.naturalWidth || src.width || 0, src.naturalHeight || src.height || 0];
}

// Rotate and mirror about the destination centre; for quarter turns the source is drawn with swapped width and
// height so that after rotation it fills the rect exactly.
function drawPlaced(ctx, src, rect, clip) {
  const q = clip.rotate === 90 || clip.rotate === 270;
  ctx.save();
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
  if (clip.rotate) ctx.rotate((clip.rotate * Math.PI) / 180);
  const dw = q ? rect.h : rect.w, dh = q ? rect.w : rect.h;
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

// A still with its quarter turn and mirrors applied (Ken Burns windows are cut from it), cached per bitmap.
// WeakMap keyed by the bitmap: the cache entry disappears with the bitmap, no manual invalidation.
const turned = new WeakMap();
function turnedImage(bmp, clip) {
  if (!clip.rotate && !clip.flipH && !clip.flipV) return bmp;
  const key = `${clip.rotate}|${clip.flipH}|${clip.flipV}`;
  let m = turned.get(bmp);
  if (!m) { m = new Map(); turned.set(bmp, m); }
  if (m.has(key)) return m.get(key);
  const [w, h] = sizeOf(bmp);
  const q = clip.rotate === 90 || clip.rotate === 270;
  const c = Object.assign(document.createElement('canvas'), { width: q ? h : w, height: q ? w : h });
  drawPlaced(c.getContext('2d'), bmp, { x: 0, y: 0, w: c.width, h: c.height }, clip);
  m.set(key, c);
  return c;
}

// Radial gradient of grey levels multiplied onto the frame ('multiply' darkens only), 11 stops sampled from the same
// vignetteFactor curve ffmpeg's vignette filter is configured with.
function vignette(ctx, W, H, angle) {
  const R = Math.hypot(W / 2, H / 2);
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R);
  for (let i = 0; i <= 10; i++) { const v = Math.round(vignetteFactor(i / 10, angle) * 255); g.addColorStop(i / 10, `rgb(${v},${v},${v})`); }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// --- the renderer --------------------------------------------------------------------------------------------------

export class Compositor {
  constructor() {
    this.layers = [null, null, null];
    this.plans = new Map();
  }

  // Reusable scratch canvases (A, B and a mask) for transitions: allocating canvases per frame causes GC stutter.
  layer(i, W, H) {
    let c = this.layers[i];
    if (!c) c = this.layers[i] = document.createElement('canvas');
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }

  // Colour plans cached by adjustment values (LRU-ish: oldest dropped beyond 200).
  plan(adjust) {
    if (isNeutral(adjust)) return null;
    const key = JSON.stringify(adjust);
    let p = this.plans.get(key);
    if (!p) {
      p = colorPlan(adjustOps(adjust));
      p.filter = fxSupported() ? filterFor(p) : '';
      this.plans.set(key, p);
      if (this.plans.size > 200) this.plans.delete(this.plans.keys().next().value);
    }
    return p;
  }

  /**
   * Draws the project at time t into ctx (W x H).
   *   frameOf(entry) -> drawable of a main entry at t (video element / VideoFrame / bitmap) or null
   *   imageOf(mediaId) -> bitmap of a picture overlay
   *   opts { hide: Set of item ids not drawn (being edited), background }
   * Returns { boxes: [{ id, x, y, w, h, rot }] } of the overlays drawn (frame pixels, unanimated) for hit tests.
   */
  // t is clamped just below the end: at exactly L.total no clip is active and the last frame would be black.
  // During a transition both clips are rendered to scratch layers, then mixed; overlays are drawn on top.
  render(ctx, W, H, p, L, t, frameOf, imageOf, opts = {}) {
    const tt = Math.min(Math.max(0, t), Math.max(0, L.total - 1e-4));
    const act = activeAt(L, tt);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = p.background || '#000';
    ctx.fillRect(0, 0, W, H);
    const main = act.main;
    if (main.length === 1) this.clip(ctx, main[0], frameOf(main[0]), tt, W, H, p);
    else if (main.length >= 2) {
      const [A, B] = main;
      const la = this.layer(0, W, H), lb = this.layer(1, W, H);
      const ca = la.getContext('2d'), cb = lb.getContext('2d');
      ca.fillStyle = cb.fillStyle = p.background || '#000';
      ca.fillRect(0, 0, W, H);
      cb.fillRect(0, 0, W, H);
      this.clip(ca, A, frameOf(A), tt, W, H, p);
      this.clip(cb, B, frameOf(B), tt, W, H, p);
      const d = A.xOut || B.xIn || 0.001;
      this.transition(ctx, A.tOut?.type || 'fade', la, lb, clamp01((tt - B.start) / d), W, H);
    }
    const boxes = [];
    for (const item of act.overlays) {
      if (opts.hide?.has(item.id)) continue;
      const b = this.item(ctx, item, tt, W, H, imageOf);
      if (b) boxes.push(b);
    }
    ctx.restore();
    return { boxes };
  }

  /** One main clip into ctx (already filled with the background). */
  // Ken Burns on stills: the window is computed per FRAME index (not continuous time) so the preview and the
  // frame-by-frame export / ffmpeg zoompan produce the same window for the same frame.
  // Fit 'blur': the same picture, cover-scaled and blurred, fills the bars behind the fitted foreground; without
  // canvas blur, a 45% black veil stands in for it.
  clip(ctx, e, src, t, W, H, p) {
    const c = e.clip;
    if (!src) return;
    const [sw, sh] = sizeOf(src);
    if (!sw || !sh) return;
    const plan = this.plan(c.adjust);
    const fx = plan?.filter || '';
    const still = isStill(e.media);
    let region = { x: 0, y: 0, w: W, h: H };
    if (still && c.kenburns) {
      const img = turnedImage(src, c);
      const [iw, ih] = sizeOf(img);
      const n = Math.max(1, Math.round(e.len * (p.fps || 30)));
      const k = n > 1 ? Math.min(1, ((t - e.start) * (p.fps || 30)) / (n - 1)) : 0;
      const win = kbWindow(coverCrop(iw, ih, W, H), kenBurnsAt(c.kenburns, k));
      ctx.filter = fx || 'none';
      ctx.drawImage(img, win.x, win.y, win.w, win.h, 0, 0, W, H);
      ctx.filter = 'none';
    } else {
      const fit = c.fit || p.fit;
      const pl = placement(sw, sh, c, fit, W, H);
      if (fit === 'blur') {
        const blur = blurSupported() ? ` blur(${blurSigma(W, H)}px)` : '';
        ctx.filter = (fx + blur).trim() || 'none';
        drawPlaced(ctx, src, pl.cover, c);
        if (!blur) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H); }
      } else region = pl.fg;
      ctx.filter = fx || 'none';
      drawPlaced(ctx, src, pl.fg, c);
      ctx.filter = 'none';
    }
    // Pixel fallback where canvas filters are missing.
    // Pixel fallback: getImageData / putImageData over the foreground region only (cost proportional to area).
    if (plan && !fx && (plan.matrix || plan.curves)) {
      const x = Math.max(0, Math.floor(region.x)), y = Math.max(0, Math.floor(region.y));
      const w = Math.min(W, Math.ceil(region.x + region.w)) - x, h = Math.min(H, Math.ceil(region.y + region.h)) - y;
      if (w > 0 && h > 0) {
        const img = ctx.getImageData(x, y, w, h);
        applyPlan(img.data, plan);
        ctx.putImageData(img, x, y);
      }
    }
    if (plan?.vignette) vignette(ctx, W, H, plan.vignette);
    const u = t - e.start;
    let black = 0;
    if (c.vfadeIn > 0 && u < c.vfadeIn) black = Math.max(black, 1 - u / c.vfadeIn);
    if (c.vfadeOut > 0 && u > e.len - c.vfadeOut) black = Math.max(black, 1 - (e.len - u) / c.vfadeOut);
    if (black > 0) { ctx.fillStyle = `rgba(0,0,0,${clamp01(black)})`; ctx.fillRect(0, 0, W, H); }
  }

  /** xfade transitions (q: 0 = all A, 1 = all B), drawn after ffmpeg's vf_xfade formulas. */
  // Formulas follow ffmpeg's vf_xfade so the ffmpeg export and the preview agree.
  transition(ctx, type, A, B, q, W, H) {
    const draw = (img, x = 0, y = 0, a = 1) => { ctx.globalAlpha = a; ctx.drawImage(img, x, y); ctx.globalAlpha = 1; };
    const clipRect = (img, x, y, w, h) => { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, 0, 0); ctx.restore(); };
    switch (type) {
      case 'fadeblack':
      case 'fadewhite': {
        const col = type === 'fadeblack' ? '#000' : '#fff';
        if (q < 0.5) { draw(A); ctx.globalAlpha = q * 2; } else { draw(B); ctx.globalAlpha = (1 - q) * 2; }
        ctx.fillStyle = col;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        break;
      }
      case 'wipeleft': draw(A); clipRect(B, W * (1 - q), 0, W * q, H); break;
      case 'wiperight': draw(A); clipRect(B, 0, 0, W * q, H); break;
      case 'wipeup': draw(A); clipRect(B, 0, H * (1 - q), W, H * q); break;
      case 'wipedown': draw(A); clipRect(B, 0, 0, W, H * q); break;
      case 'slideleft': draw(A, -q * W); draw(B, W - q * W); break;
      case 'slideright': draw(A, q * W); draw(B, -W + q * W); break;
      case 'slideup': draw(A, 0, -q * H); draw(B, 0, H - q * H); break;
      case 'slidedown': draw(A, 0, q * H); draw(B, 0, -H + q * H); break;
      case 'circleopen':
      case 'circleclose': {
        // xfade: smooth = r / z + p, mixed with smoothstep(0, 1, smooth).
        const z = Math.hypot(W / 2, H / 2);
        const open = type === 'circleopen';
        const p = open ? (0.5 - q) * 3 : (q - 0.5) * 3;
        const top = open ? B : A, bottom = open ? A : B;
        draw(bottom);
        // Circle transition as a soft mask: copy the top clip, then 'destination-in' with a radial alpha gradient
        // keeps it only inside the (smoothstepped) circle; the masked layer is drawn over the bottom clip.
        const m = this.layer(2, W, H), mc = m.getContext('2d');
        mc.globalCompositeOperation = 'copy';
        mc.drawImage(top, 0, 0);
        mc.globalCompositeOperation = 'destination-in';
        const R = Math.max(1, (1 - p) * z);
        const g = mc.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R);
        for (let i = 0; i <= 12; i++) {
          const r = (i / 12) * R;
          g.addColorStop(i / 12, `rgba(0,0,0,${1 - smooth(0, 1, r / z + p)})`);
        }
        mc.fillStyle = g;
        mc.fillRect(0, 0, W, H);
        mc.globalCompositeOperation = 'source-over';
        draw(m);
        break;
      }
      case 'zoomin': {
        // First half: A zooms towards its centre; second half: it fades into B.
        const zf = smooth(0.5, 1, 1 - q);
        const s = 1 / Math.max(0.04, zf);
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(s, s);
        ctx.drawImage(A, -W / 2, -H / 2);
        ctx.restore();
        const mix = smooth(0, 0.5, 1 - q);
        if (mix < 1) draw(B, 0, 0, 1 - mix);
        break;
      }
      default: draw(A); draw(B, 0, 0, q);
    }
  }

  /** An overlay item; returns its hit box (frame pixels, without the animation offsets). */
  // Overlay transform order: translate to the centre (plus animation offset), rotate, scale. The returned hit box
  // ignores animation offsets: the selection frame should stay put while an entrance animation plays.
  item(ctx, item, t, W, H, imageOf, still = false) {
    const st = still ? { alpha: item.opacity, dx: 0, dy: 0, scale: 1, reveal: 1 } : animState(item, t, W, H);
    const cx = item.x * W, cy = item.y * H;
    const rot = (item.rotation * Math.PI) / 180;
    let box = null;
    ctx.save();
    ctx.globalAlpha = clamp01(st.alpha);
    ctx.translate(cx + st.dx, cy + st.dy);
    if (rot) ctx.rotate(rot);
    if (st.scale !== 1) ctx.scale(st.scale, st.scale);
    if (item.type === 'text') {
      const lay = textLayout(item, W, H, measureText);
      ctx.translate(-cx, -cy);
      this.text(ctx, item, lay, st.reveal);
      box = { w: lay.box.w, h: lay.box.h };
    } else if (item.type === 'emoji') {
      const px = item.size * H * item.scale;
      ctx.font = `${px}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.emoji, 0, px * 0.06);
      box = { w: px * 1.2, h: px * 1.2 };
    } else if (item.type === 'image') {
      const bmp = imageOf?.(item.media);
      const [bw, bh] = sizeOf(bmp);
      const w = item.w * W * item.scale, h = bw ? (w * bh) / bw : w;
      if (bmp && bw) ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
      else { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([6, 6]); ctx.strokeRect(-w / 2, -h / 2, w, h); }
      box = { w, h };
    } else if (item.type === 'drawing') {
      ctx.scale(item.scale, item.scale);
      ctx.translate(-W / 2, -H / 2);
      const b = drawStrokes(ctx, item.strokes, W, H);
      if (b) {
        const s = item.scale;
        box = { w: (b.x1 - b.x0) * s, h: (b.y1 - b.y0) * s, ox: ((b.x0 + b.x1) / 2 - W / 2) * s, oy: ((b.y0 + b.y1) / 2 - H / 2) * s };
      }
    }
    ctx.restore();
    if (!box) return null;
    // Box centre: the item centre, shifted by the drawing's own offset (rotated).
    let bx = cx, by = cy;
    if (box.ox || box.oy) { bx += box.ox * Math.cos(rot) - box.oy * Math.sin(rot); by += box.ox * Math.sin(rot) + box.oy * Math.cos(rot); }
    return { id: item.id, x: bx, y: by, w: Math.max(8, box.w), h: Math.max(8, box.h), rot: item.rotation };
  }

  // Typewriter reveal counts code points ([...s]), so emoji and astral characters are revealed whole. Ascent and
  // descent from fontBoundingBox (consistent box height for any text) with ratio fallbacks for older engines.
  // The outline is stroked under the fill with the shadow off, so the shadow is cast once, not twice.
  text(ctx, item, lay, reveal = 1) {
    ctx.font = fontOf(item, lay.fs);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const m = ctx.measureText('Hg');
    const asc = m.fontBoundingBoxAscent || lay.fs * 0.9, desc = m.fontBoundingBoxDescent || lay.fs * 0.25;
    let budget = reveal >= 1 ? Infinity : Math.floor(reveal * lay.lines.reduce((a, l) => a + [...l.text].length, 0));
    for (const line of lay.lines) {
      let s = line.text;
      if (budget !== Infinity) { const ch = [...s]; s = ch.slice(0, Math.max(0, budget)).join(''); budget -= ch.length; }
      if (!s) continue;
      if (item.box.opacity > 0 && line.text.trim()) {
        ctx.fillStyle = hexA(item.box.color, item.box.opacity);
        const w = budget === Infinity ? line.w : ctx.measureText(s).width;
        ctx.fillRect(line.x - lay.pad, line.baseline - asc - lay.pad, w + lay.pad * 2, asc + desc + lay.pad * 2);
      }
      if (lay.shadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowOffsetX = ctx.shadowOffsetY = lay.shadow; ctx.shadowBlur = 0; }
      if (lay.border) { ctx.lineWidth = lay.border * 2; ctx.strokeStyle = item.stroke.color; ctx.strokeText(s, line.x, line.baseline); }
      ctx.fillStyle = item.color;
      if (lay.border) ctx.shadowColor = 'transparent';
      ctx.fillText(s, line.x, line.baseline);
      ctx.shadowColor = 'transparent';
    }
  }
}

/** Strokes of a drawing (normalized points) into ctx at W x H; returns their bounds. */
// Smooth freehand: quadratic curves through the midpoints of successive samples (control point = the sample) give a
// C1-continuous line from jittery input at no extra cost. Neon = blurred coloured stroke (shadowBlur) plus a thin
// white core. Bounds include the brush padding so the hit box covers the visible ink.
export function drawStrokes(ctx, strokes, W, H) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const pts = s.points;
    if (!pts.length) continue;
    const lw = Math.max(1, s.width * H);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0] * W, pts[1] * H);
      if (pts.length === 2) ctx.lineTo(pts[0] * W + 0.01, pts[1] * H);
      for (let i = 2; i + 3 < pts.length; i += 2) {
        const mx = ((pts[i] + pts[i + 2]) / 2) * W, my = ((pts[i + 1] + pts[i + 3]) / 2) * H;
        ctx.quadraticCurveTo(pts[i] * W, pts[i + 1] * H, mx, my);
      }
      if (pts.length >= 4) ctx.lineTo(pts[pts.length - 2] * W, pts[pts.length - 1] * H);
    };
    if (s.tool === 'marker') {
      ctx.globalAlpha *= 0.45;
      ctx.lineCap = 'square';
      ctx.lineWidth = lw * 2.4;
      ctx.strokeStyle = s.color;
      path();
      ctx.stroke();
    } else if (s.tool === 'neon') {
      ctx.shadowColor = s.color;
      ctx.shadowBlur = lw * 2.5;
      ctx.lineWidth = lw * 1.4;
      ctx.strokeStyle = s.color;
      path();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1, lw * 0.45);
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      path();
      ctx.stroke();
    } else {
      ctx.lineWidth = lw;
      ctx.strokeStyle = s.color;
      path();
      ctx.stroke();
    }
    ctx.restore();
    const pad = lw * (s.tool === 'marker' ? 1.2 : s.tool === 'neon' ? 2 : 0.5);
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i] * W - pad); x1 = Math.max(x1, pts[i] * W + pad);
      y0 = Math.min(y0, pts[i + 1] * H - pad); y1 = Math.max(y1, pts[i + 1] * H + pad);
    }
  }
  return x0 < x1 ? { x0, y0, x1, y1 } : null;
}

/**
 * The PNG of an ffmpeg asset (ffmpeg.js describe().assets): a drawing as a transparent full frame, an emoji or a
 * rotated text unrotated at its size (ffmpeg rotates and places it). Returns a canvas.
 */
// ffmpeg's drawtext cannot rotate and has no emoji fonts by default, so such overlays become PNG inputs: drawings as
// full transparent frames, stickers and rotated text cropped to their box (ffmpeg rotates and places them).
export function renderAsset(comp, asset, item, W, H) {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  if (asset.kind === 'drawing') {
    c.width = W; c.height = H;
    comp.item(x, { ...item, opacity: 1, rotation: item.rotation }, item.start, W, H, null, true);
    return c;
  }
  if (asset.kind === 'sticker') {
    const px = item.size * H * item.scale;
    const s = Math.ceil(px * 1.25);
    c.width = c.height = s;
    x.font = `${px}px ${EMOJI_FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(item.emoji, s / 2, s / 2 + px * 0.06);
    return c;
  }
  // Rotated text: the block without rotation, centred.
  const lay = textLayout(item, W, H, measureText);
  const m = lay.border + lay.shadow + 4;
  c.width = Math.ceil(lay.box.w + m * 2);
  c.height = Math.ceil(lay.box.h + m * 2);
  x.translate(m - lay.box.x, m - lay.box.y);
  comp.text(x, item, lay, 1);
  return c;
}

/** Hit test of the overlay boxes (topmost first): the id under the point (frame pixels) or null. */
// Rotated-rectangle hit test: rotate the point into the box's frame, then an axis-aligned check with a 6px slack.
// Iterates from the last drawn box, so the topmost overlay wins.
export function hitBox(boxes, px, py) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    const a = (-b.rot * Math.PI) / 180;
    const dx = px - b.x, dy = py - b.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 + 6 && Math.abs(ly) <= b.h / 2 + 6) return b.id;
  }
  return null;
}

export { sourceTime };
