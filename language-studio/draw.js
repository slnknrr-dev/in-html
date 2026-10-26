// language-studio/draw.js - drawing letters by hand and measuring the deviation from the model: a pointer-driven pad
// (mouse, pen, finger), the model rendered from a system font or from stroke data, and the evaluation (lingua/strokes.js:
// ink distance for every glyph, stroke count / order / direction / shape where stroke data exist) with a heat map of
// the drawn ink coloured by its distance from the model.
//
//   const pad = drawPad({ size, guide })   pad.el   pad.strokes() -> [[[x, y] 0…1]]   pad.clear()   pad.undo()
//   pad.setGuide({ ch, font, strokes, faint }) | null      pad.showResult(result)   pad.onChange = fn
//   evaluate(strokes, { ch, font, strokes? }) -> { score, raster, strokes: compareStrokes result | null, heat }
//   FONTS: { script code: CSS font stack }
import { h } from '../ui/dom.js';
import { compareMasks, compareStrokes, distanceField, fit, pathStrokes } from '../lingua/strokes.js';

export const FONTS = {
  Geor: '"Noto Sans Georgian", "Sylfaen", "BPG Arial", "DejaVu Sans", sans-serif',
  Deva: '"Noto Sans Devanagari", "Nirmala UI", "Mangal", "Kohinoor Devanagari", sans-serif',
  Kore: '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
  Jpan: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", "MS Gothic", sans-serif',
  Hans: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "SimHei", sans-serif',
  Cyrl: 'system-ui, "Segoe UI", Roboto, sans-serif',
  Latn: '"Segoe UI", "Doulos SIL", "Charis SIL", system-ui, sans-serif',
};

// Evaluation pipeline: the learner's strokes and the model are both rasterised into N x N binary masks, normalised
// (fit) to the same box, and compared by distance fields (each ink pixel's distance to the other mask's nearest ink),
// so the score measures shape, not position or size. Where stroke data exist, stroke count, order and direction are
// compared too. N = 96: fine enough for Devanagari and kanji details, small enough to evaluate instantly on a phone.
const N = 96; // evaluation raster

function canvas(w, hgt) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  return c;
}

// Binary mask from the canvas alpha channel; threshold 110/255 keeps the anti-aliased core of a line and drops the
// faint fringe, so line width does not depend on the browser's smoothing.
function maskOf(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const m = new Uint8Array(c.width * c.height);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 110 ? 1 : 0;
  return m;
}

function maskBox(m, n) {
  let x0 = n, y0 = n, x1 = -1, y1 = -1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y * n + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function modelStrokes(model) {
  return model.strokes ? (typeof model.strokes === 'string' ? pathStrokes(model.strokes) : model.strokes) : null;
}

// The model as a mask of N × N: stroke data drawn as lines, otherwise the font glyph.
function modelMask(model) {
  const c = canvas(N, N);
  const g = c.getContext('2d');
  const st = modelStrokes(model);
  if (st) {
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = N * 0.075; g.strokeStyle = '#000';
    for (const s of st) { g.beginPath(); s.forEach(([x, y], i) => (i ? g.lineTo(x / 100 * N, y / 100 * N) : g.moveTo(x / 100 * N, y / 100 * N))); g.stroke(); }
  } else {
    g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${Math.round(N * 0.72)}px ${model.font || 'sans-serif'}`;
    g.fillText(model.ch, N / 2, N * 0.53);
  }
  return maskOf(c);
}

function strokesMask(strokes, width) {
  const c = canvas(N, N);
  const g = c.getContext('2d');
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = width; g.strokeStyle = '#000'; g.fillStyle = '#000';
  for (const s of strokes) {
    if (s.length === 1) { g.beginPath(); g.arc(s[0][0], s[0][1], width / 2, 0, Math.PI * 2); g.fill(); continue; }
    g.beginPath(); s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  }
  return maskOf(c);
}

// Mean stroke width of a mask: the mean distance from ink to background is a quarter of the width of a bar.
// (Across a bar of width w, the distance to the nearest edge runs 0..w/2 and back, averaging w/4.) Used to redraw the
// learner's strokes at the model's thickness, so a thin pen is not penalised for missing "ink".
function inkWidth(m) {
  const inv = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
  const d = distanceField(inv, N, N);
  let s = 0, k = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) { s += d[i]; k++; }
  return k ? Math.max(2, Math.min(N * 0.14, (s / k) * 4)) : N * 0.07;
}

export function evaluate(user, model) {
  const strokes = user.filter((s) => s.length);
  if (!strokes.length) return null;
  const mm = modelMask(model);
  const box = maskBox(mm, N) || { x0: 8, y0: 8, w: N - 16, h: N - 16 };
  const fitted = fit(strokes.map((s) => s.map(([x, y]) => [x * N, y * N])), { x0: box.x0, y0: box.y0, w: box.w, h: box.h });
  const um = strokesMask(fitted, inkWidth(mm));
  const raster = compareMasks(um, mm, N, N);
  const st = modelStrokes(model);
  const sr = st ? compareStrokes(strokes, st) : null;
  const score = sr ? Math.round(sr.score * 0.6 + raster.score * 0.4) : raster.score;
  // heat map: the model in grey, drawn ink green → red by distance to the model
  const dm = distanceField(mm, N, N);
  const heat = canvas(N, N);
  const g = heat.getContext('2d');
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    let r = 0, gg = 0, b = 0, a = 0;
    if (mm[i]) { r = gg = b = 150; a = 70; }
    if (um[i]) {
      const t = Math.min(1, dm[i] / (N * 0.08));
      r = Math.round(40 + 215 * t); gg = Math.round(170 - 120 * t); b = 60; a = 230;
    }
    img.data.set([r, gg, b, a], i * 4);
  }
  g.putImageData(img, 0, 0);
  return { score, raster, strokes: sr, heat };
}

export function drawPad({ size = 280, guide = null } = {}) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const c = h('canvas', { class: 'ls-pad', width: Math.round(size * dpr), height: Math.round(size * dpr), style: { width: size + 'px', height: size + 'px' }, 'aria-label': 'drawing pad', role: 'img' });
  const S = { strokes: [], cur: null, guide, result: null };
  const pad = { el: c, onChange: null };
  const g = c.getContext('2d');

  function paint() {
    const W = c.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    // grid: the centre cross and the frame (as on calligraphy paper)
    g.strokeStyle = 'rgba(127,127,127,.28)'; g.lineWidth = 1 * dpr; g.setLineDash([4 * dpr, 4 * dpr]);
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, W); g.moveTo(0, W / 2); g.lineTo(W, W / 2); g.stroke(); g.setLineDash([]);
    if (S.result && S.result.heat) {
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.9; g.drawImage(S.result.heat, 0, 0, W, W); g.globalAlpha = 1;
    } else if (S.guide) {
      const st = modelStrokes(S.guide);
      g.save();
      g.globalAlpha = S.guide.faint ? 0.16 : 0.32;
      if (st) {
        g.strokeStyle = '#888'; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = W * 0.075;
        for (const s of st) { g.beginPath(); s.forEach(([x, y], i) => (i ? g.lineTo(x / 100 * W, y / 100 * W) : g.moveTo(x / 100 * W, y / 100 * W))); g.stroke(); }
        if (!S.guide.faint) {
          g.globalAlpha = 0.9; g.fillStyle = '#e11d48'; g.font = `${Math.round(W * 0.05)}px sans-serif`;
          st.forEach((s, i) => g.fillText(String(i + 1), s[0][0] / 100 * W - W * 0.04, s[0][1] / 100 * W - W * 0.01));
        }
      } else {
        g.fillStyle = '#888'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `${Math.round(W * 0.72)}px ${S.guide.font || 'sans-serif'}`;
        g.fillText(S.guide.ch, W / 2, W * 0.53);
      }
      g.restore();
    }
    g.strokeStyle = getComputedStyle(c).color || '#111';
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = W * 0.035;
    if (S.result) g.globalAlpha = 0.25;
    for (const s of [...S.strokes, S.cur].filter(Boolean)) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * W) : g.moveTo(x * W, y * W)));
      if (s.length === 1) g.lineTo(s[0][0] * W + 0.5, s[0][1] * W);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  const pos = (e) => { const r = c.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  c.addEventListener('pointerdown', (e) => {
    if (S.result) { S.result = null; }
    e.preventDefault();
    c.setPointerCapture(e.pointerId);
    S.cur = [pos(e)];
    paint();
  });
  c.addEventListener('pointermove', (e) => {
    if (!S.cur) return;
    const p = pos(e), q = S.cur[S.cur.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.004) { S.cur.push(p); paint(); }
  });
  const end = () => { if (!S.cur) return; S.strokes.push(S.cur); S.cur = null; paint(); if (pad.onChange) pad.onChange(); };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  c.style.touchAction = 'none';

  pad.strokes = () => S.strokes.map((s) => s.map((p) => [...p]));
  pad.clear = () => { S.strokes = []; S.result = null; paint(); if (pad.onChange) pad.onChange(); };
  pad.undo = () => { S.strokes.pop(); S.result = null; paint(); if (pad.onChange) pad.onChange(); };
  pad.setGuide = (gd) => { S.guide = gd; paint(); };
  pad.showResult = (r) => { S.result = r; paint(); };
  // test hook: strokes in 0…1 coordinates
  pad.setStrokes = (st) => { S.strokes = st.map((s) => s.map((p) => [...p])); S.result = null; paint(); if (pad.onChange) pad.onChange(); };
  requestAnimationFrame(paint);
  return pad;
}
