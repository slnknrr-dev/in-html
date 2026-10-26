// textile-studio/view2d.js - the 2D pane: one pan / zoom stage (drag, wheel, pinch, buttons) showing, by mode, the body
// silhouettes with landmark lines, the pattern of the active garment (placement prints drawn on their pieces and
// dragged with the pointer), the technical flats of the outfit, the cutting layout, the graded nest, the fabric swatch
// with its weaving draft (the drawdown cells toggle into a custom weave) and the print repeat with its separations.
// The pattern is edited in place: a click selects a piece (its material, colour and dye, the layers laid on it are
// edited in the Details step), layers are dragged like prints, and a shape is drawn point by point onto the selected
// piece (double click or Enter closes it, Escape cancels).
//
// Design decisions:
// - Pan / zoom is a CSS transform on one inner wrapper (translate + scale, transform-origin 0 0), not a viewBox edit:
//   it works for every kind of content (SVG, <img>, divs) and costs no re-render, only a compositor update.
// - Content is built as SVG TEXT and parsed once (innerHTML) rather than with createElementNS per node: thousands of
//   drawdown cells and pattern points are far faster as one string. Every user-provided string inside goes through
//   esc() (garment/svg.js) - piece names, ids, image URLs - so a crafted project cannot inject markup.
// - The pattern SVG uses CENTIMETRES as user units (viewBox in cm) and SCALE px per cm for its width / height, so
//   pointer deltas convert back to cm as dx / zoom / SCALE.
// - Edits are reported through ctx callbacks (commit happens in main.js): this module owns no project state, only
//   view state (mode, zoom, pan, the shape being drawn).

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { seg } from '../ui/app.js';
import { silhouette, silhouettePath, landmarkLines } from '../body/silhouette.js';
import { bodyMesh } from '../body/mesh.js';
import { cutOutline, outline, pieceBBox, unfoldPiece } from '../garment/piece.js';
import { pieceSVG, cutText, esc } from '../garment/svg.js';
import { seamNotches } from '../garment/seams.js';
import { flatSVG } from '../garment/flats.js';
import { nest, cutInstances, layoutSVG } from '../garment/nest.js';
import { gradeGarment } from '../garment/grade.js';
import { gradedSVG } from '../garment/svg.js';
import { fabricWeave, averageColor, colorOrder } from '../fabric/fabric.js';
import { weaveToDraft } from '../fabric/weave.js';
import { fabricTexture } from '../fabric/texture.js';
import { renderUnit, separations, repeatUnit, normalizeDesign } from '../motif/repeat.js';
import { motifPath } from '../motif/motifs.js';
import { draftOf, rigOf, measurementsOf, fabricOf } from './compute.js';
import { layerOutline } from '../garment/edits.js';
import { plLength, pointAt } from '../garment/geom.js';
import { dyeSVG } from '../fabric/dye.js';
import { pieceName, materialName } from './names.js';

export const MODES = ['body', 'pattern', 'flats', 'layout', 'grade', 'fabric', 'print'];
// f2: 2-decimal numbers for SVG attributes; shorter markup, and 0.01 px / cm is below any visible difference.
const f2 = (v) => (Math.round(v * 100) / 100).toString();

// RGBA buffer -> PNG data URL for <img> / CSS backgrounds. Copies into Uint8ClampedArray when needed: ImageData
// rejects plain arrays and Uint8Array.
const toDataURL = (img) => {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c.toDataURL('image/png');
};

export function createView2d(host, ctx) {
  const wrap = h('div', { class: 'tx-2d' });
  const bar = h('div', { class: 'tx-2d-bar' });
  const stage = h('div', { class: 'tx-2d-stage', tabindex: '0', 'aria-label': t('v2.stage') });
  const inner = h('div', { class: 'tx-2d-inner' });
  stage.append(inner);
  wrap.append(bar, stage);
  host.append(wrap);
  // fitted: whether the current content has been fitted once; a mode switch resets it so the new drawing is centred,
  // while ordinary re-renders (an edit) keep the user's zoom and pan.
  let mode = 'body', zoom = 1, pan = [0, 0], fitted = false;
  const apply = () => { inner.style.transform = `translate(${pan[0]}px, ${pan[1]}px) scale(${zoom})`; };
  const fit = () => {
    const svg = inner.firstElementChild;
    if (!svg) return;
    const sr = stage.getBoundingClientRect();
    // a hidden pane has no size: fit when it is shown
    if (sr.width < 20 || sr.height < 20) { fitted = false; return; }
    // Content size: SVG width / height attributes first (exact, independent of layout), then layout size, then <img>
    // natural size; 400 as a last resort. 0.94: a 3 % margin on each side so outlines do not touch the pane edge.
    const w = svg.width?.baseVal?.value || svg.clientWidth || svg.naturalWidth || 400, hh = svg.height?.baseVal?.value || svg.clientHeight || svg.naturalHeight || 400;
    zoom = Math.max(0.05, Math.min(sr.width / w, sr.height / hh) * 0.94);
    pan = [(sr.width - w * zoom) / 2, (sr.height - hh * zoom) / 2];
    apply();
  };
  // Pan / zoom.
  // Pointer state. ptrs: active pointers for pinch; last: previous position for pan; dragPl: a print / layer / handle
  // drag in progress; down: a press that may turn out to be a click (selection) or a pan.
  const ptrs = new Map();
  let last = null, pinch = 0, dragPl = null, down = null;
  // Pointer -> centimetres of a piece group of the pattern SVG (its viewBox, then the group's translation).
  // Parses the transform attribute written by patternView ('translate(x y)') instead of getCTM(): the attribute is
  // the exact value used to place the piece, getCTM would include the CSS zoom and need inverting.
  // Pointer -> centimetres of a piece group of the pattern SVG (its viewBox, then the group's translation).
  const pieceXY = (e, g) => {
    const svg = g.ownerSVGElement, r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
    const x = vb.x + ((e.clientX - r.left) / r.width) * vb.width - (m ? +m[1] : 0);
    const y = vb.y + ((e.clientY - r.top) / r.height) * vb.height - (m ? +m[2] : 0);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };
  // Hit-testing by closest('[data-...]') on the event target: one listener for the whole stage (event delegation),
  // no per-node listeners to rebuild after each render. Priority: outline handle > drawing point > print / layer >
  // pan / click. setPointerCapture keeps move / up events coming when the pointer leaves the stage mid-drag.
  // The handlers use draw and SCALE declared further down: they run only after createView2d returns, past the TDZ.
  stage.addEventListener('pointerdown', (e) => {
    const pl = e.target.closest?.('[data-pl]');
    const ly = e.target.closest?.('[data-layer]');
    const hd = e.target.closest?.('[data-hedge]');
    if (hd && mode === 'pattern') { dragPl = { handle: { piece: hd.dataset.piece, edge: hd.dataset.hedge, at: Number(hd.dataset.hat) }, start: [e.clientX, e.clientY], moved: false }; stage.setPointerCapture(e.pointerId); return; }
    if (mode === 'pattern' && draw && e.target.closest?.('[data-piece="' + draw.piece + '"]')) {
      draw.pts.push(pieceXY(e, e.target.closest('[data-piece]')));
      render(ctx.project());
      return;
    }
    if ((pl || ly) && mode === 'pattern') { dragPl = { id: (pl || ly).dataset.pl || ly.dataset.layer, layer: !pl, piece: (pl || ly).dataset.piece, start: [e.clientX, e.clientY], moved: false }; stage.setPointerCapture(e.pointerId); return; }
    down = { x: e.clientX, y: e.clientY, piece: e.target.closest?.('[data-piece]')?.dataset.piece || null };
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    last = [e.clientX, e.clientY];
  });
  stage.addEventListener('pointermove', (e) => {
    // Drags send INCREMENTAL deltas in cm (start is reset each move); main.js accumulates them through merged commits.
    if (dragPl) {
      const dx = (e.clientX - dragPl.start[0]) / zoom / SCALE, dy = (e.clientY - dragPl.start[1]) / zoom / SCALE;
      dragPl.start = [e.clientX, e.clientY];
      dragPl.moved = true;
      if (dragPl.handle) ctx.moveHandle(dragPl.handle, dx, dy);
      else if (dragPl.layer) ctx.moveLayer(dragPl.id, dx, dy); else ctx.movePlacement(dragPl.id, dx, dy);
      return;
    }
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    // Two pointers: pinch zoom around the midpoint by the ratio of the new to the previous finger distance.
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch);
      pinch = d;
    } else if (last) { pan[0] += e.clientX - last[0]; pan[1] += e.clientY - last[1]; last = [e.clientX, e.clientY]; apply(); }
  });
  // Release: a press on a layer without movement selects it; after a real drag the panel is refreshed once (live
  // commits during the drag did not rebuild it). A press that moved less than 5 px counts as a click: fingers and
  // mice jitter, a zero threshold would turn most taps into tiny pans.
  const up = (e) => {
    if (dragPl) { if (!dragPl.moved && dragPl.layer) ctx.selectPiece(dragPl.piece, dragPl.id); else if (dragPl.moved && (dragPl.handle || dragPl.layer)) ctx.endDrag?.(); dragPl = null; return; }
    // Dead branch: down never carries a handle (handle presses go to dragPl above). Harmless, kept as a guard.
    if (down && down.handle) { down = null; return; }
    // a click (no drag) on a piece of the pattern selects it; on the background clears the selection
    if (down && mode === 'pattern' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && ptrs.size <= 1) ctx.selectPiece(down.piece);
    down = null;
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; last = ptrs.size ? [...ptrs.values()][0] : null;
  };
  stage.addEventListener('dblclick', () => { if (draw) finishDraw(); });
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  // Zoom keeping the point under the cursor fixed: the content point (x - pan) / zoom must map to the same screen x
  // after the change, hence pan' = x - (x - pan) * nz / zoom. Clamped to 0.05..40x.
  const zoomAt = (cx, cy, k) => {
    const r = stage.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    const nz = Math.max(0.05, Math.min(40, zoom * k));
    pan = [x - ((x - pan[0]) * nz) / zoom, y - ((y - pan[1]) * nz) / zoom];
    zoom = nz;
    apply();
  };
  // passive: false is required to call preventDefault (browsers default wheel listeners to passive and would scroll
  // the page). exp(-deltaY * k) makes zoom steps multiplicative: equal wheel ticks give equal zoom ratios.
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  // Keyboard: the stage is focusable (tabindex 0), so zoom and drawing work without a pointer.
  stage.addEventListener('keydown', (e) => {
    const r = stage.getBoundingClientRect();
    if (e.key === '+' || e.key === '=') zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
    else if (e.key === '-') zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
    else if (e.key === '0') fit();
    else if (draw && e.key === 'Enter') { e.preventDefault(); finishDraw(); }
    else if (draw && e.key === 'Escape') { e.preventDefault(); draw = null; ctx.status2d(''); render(ctx.project()); }
    else if (draw && e.key === 'Backspace') { e.preventDefault(); draw.pts.pop(); render(ctx.project()); }
  });
  // Drawing a layer: points in the selected piece's centimetres; closes into a polygon layer.
  let draw = null;
  const finishDraw = () => {
    const d = draw;
    draw = null;
    ctx.status2d('');
    if (d && d.pts.length >= 3) ctx.addPolyLayer(d.piece, d.pts);
    else render(ctx.project());
  };

  const modeSeg = seg(MODES.map((m) => ({ v: m, l: 'v2.' + m })), mode, (v) => { mode = v; fitted = false; ctx.setMode2d(v); render(ctx.project()); }, 'v2.modes');
  modeSeg.classList.add('tx-2d-modes');
  const tools = h('div', { class: 'tx-2d-tools' },
    h('button', { type: 'button', class: 'ed-iconbtn', title: t('v2.zoomIn'), 'aria-label': t('v2.zoomIn'), onclick: () => { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); } }, iconEl('zoomIn')),
    h('button', { type: 'button', class: 'ed-iconbtn', title: t('v2.zoomOut'), 'aria-label': t('v2.zoomOut'), onclick: () => { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); } }, iconEl('zoomOut')),
    h('button', { type: 'button', class: 'ed-iconbtn', title: t('v2.fit'), 'aria-label': t('v2.fit'), onclick: fit }, iconEl('fitWidth')));
  bar.append(modeSeg, h('span', { class: 'ed-spacer' }), tools);

  // Pixels per cm of the SVG documents built here (zoom on top of it).
  // put(): replaces the content and schedules a fit on the next frame, after layout has given the new SVG a size.
  // Pixels per cm of the SVG documents built here (zoom on top of it).
  const SCALE = 4;
  const put = (node) => { inner.textContent = ''; inner.append(node); if (!fitted) { fitted = true; requestAnimationFrame(fit); } };
  // Parse SVG text through a div's innerHTML: the HTML parser creates proper SVG-namespace nodes for <svg> subtrees.
  const svgNode = (text) => { const d = h('div', { html: text }); return d.firstElementChild; };

  // Body view: front, side and back silhouettes side by side with landmark lines on the front one. Silhouettes are
  // computed in body cm with y up; H - y flips to SVG's y-down. Landmark ids map to measurement ids where they differ
  // (shoulder -> shoulderWidth, crotch -> insideLeg).
  function bodyView(p) {
    const rig = rigOf(p), mesh = bodyMesh(rig, { step: 2 }), m = measurementsOf(p);
    const views = ['front', 'side', 'back'].map((v) => ({ v, s: silhouette(rig, v, { res: 0.6, mesh }) }));
    const H = rig.H + 8;
    let x = 0, out = '';
    for (const { v, s } of views) {
      const w = s.bbox.maxX - s.bbox.minX + 16;
      const dx = x - s.bbox.minX + 8;
      out += `<g transform="translate(${f2(dx * SCALE)} 0)"><path d="${silhouettePath(s.contours, { scale: SCALE, height: H })}" fill="var(--tx-body)" stroke="var(--tx-ink)" stroke-width="1"/>`;
      if (v === 'front') {
        for (const l of landmarkLines(rig, s)) {
          const y = (H - l.y) * SCALE, val = m[l.id === 'shoulder' ? 'shoulderWidth' : l.id === 'crotch' ? 'insideLeg' : l.id === 'knee' ? 'knee' : l.id];
          out += `<line x1="${f2(l.x0 * SCALE)}" x2="${f2(l.x1 * SCALE)}" y1="${f2(y)}" y2="${f2(y)}" stroke="var(--tx-accent)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
          if (val) out += `<text x="${f2(l.x1 * SCALE + 6)}" y="${f2(y + 4)}" font-size="11" fill="var(--tx-ink)">${esc(t('m.' + (l.id === 'shoulder' ? 'shoulderWidth' : l.id === 'crotch' ? 'insideLeg' : l.id)))} ${val.toFixed(1)}</text>`;
        }
      }
      out += `<text x="${f2((s.bbox.minX + (s.bbox.maxX - s.bbox.minX) / 2) * SCALE)}" y="${f2((H + 4) * SCALE)}" text-anchor="middle" font-size="13" fill="var(--tx-muted)">${esc(t('v2.view.' + v))}</text></g>`;
      x += w;
    }
    return svgNode(`<svg xmlns="http://www.w3.org/2000/svg" class="tx-svg" width="${f2(x * SCALE)}" height="${f2((H + 10) * SCALE)}" viewBox="0 0 ${f2(x * SCALE)} ${f2((H + 10) * SCALE)}">${out}</svg>`);
  }

  // Pattern view: the pieces of the active garment in rows 150 cm wide (the same shelf layout the exports use),
  // tallest first so rows pack tighter. A folded piece that carries a print is shown UNFOLDED: a print on the fold
  // line would otherwise be drawn on half a piece.
  function patternView(p) {
    const d = draftOf(p);
    const g = p.outfit[p.active];
    const withPrint = new Set(g.placements.map((pl) => pl.piece));
    const pieces = d.pieces.map((pc) => (pc.cut.fold && withPrint.has(pc.id) ? { ...unfoldPiece(pc), id: pc.id, name: pc.name } : pc));
    const notches = seamNotches(d);
    // Rows of pieces (cm), the same layout as the exports.
    const items = pieces.map((pc) => ({ pc, box: p.view.allowance ? boxOf(cutOutline(pc)) : pieceBBox(pc) })).sort((a, b) => b.box.h - a.box.h);
    let x = 0, y = 0, rowH = 0;
    const width = 150;
    let out = '', defs = '';
    const sel = ctx.selected?.() || null;
    for (const it of items) {
      if (x > 0 && x + it.box.w > width) { x = 0; y += rowH + 3; rowH = 0; }
      const dx = x - it.box.x0, dy = y - it.box.y0;
      const fab = fabricOf(p, p.active, it.pc.material);
      const label = { title: pieceName(it.pc.name || it.pc.id), lines: [cutText(it.pc, (k, v) => t(k, v)), materialName(it.pc.material)] };
      const prints = g.placements.filter((pl) => pl.piece === it.pc.id).map((pl) => placementSVG(pl, p));
      // The selected layer is drawn thicker; the dye gradient id is sanitised ([^\w-] removed) because it becomes a
      // url(#id) reference, where spaces or quotes would break the reference.
      const layers = (g.edits?.layers || []).filter((l) => l.piece === it.pc.id).map((l) => layerSVG(l, p, sel && sel.layer === l.id));
      // dyed fabrics fill the piece with the dye's gradient (in the piece's frame)
      const dye = dyeSVG(fab.dye, averageColor(fab), 'dye-' + it.pc.id.replace(/[^\w-]/g, ''), it.box, 0.35);
      if (dye) defs += dye.defs;
      const selected = sel && sel.piece === it.pc.id;
      const drawing = draw && draw.piece === it.pc.id ? drawSVG(draw.pts) : '';
      // Handles only on the original (not unfolded) piece: handle coordinates must match the stored edge parameters.
      const handles = selected && !draw && it.pc === d.pieces.find((q) => q.id === it.pc.id) ? handlesSVG(it.pc, g.edits?.shape?.[it.pc.id] || []) : '';
      out += `<g transform="translate(${f2(dx)} ${f2(dy)})" data-piece="${esc(it.pc.id)}" class="tx-pc${selected ? ' tx-sel' : ''}" style="cursor:pointer">${pieceSVG(it.pc, { allowance: p.view.allowance, label, notches: notches.filter((n) => n.piece === it.pc.id), fill: dye ? dye.fill : averageColor(fab) + '33' })}${layers.join('')}${prints.join('')}${drawing}${handles}</g>`;
      x += it.box.w + 3;
      rowH = Math.max(rowH, it.box.h);
    }
    const W = Math.max(width, x) + 4, H = y + rowH + 4;
    return svgNode(`<svg xmlns="http://www.w3.org/2000/svg" class="tx-svg tx-pattern" width="${f2(W * SCALE)}" height="${f2(H * SCALE)}" viewBox="-2 -2 ${f2(W)} ${f2(H)}"><defs>${defs}</defs>${out}</svg>`);
  }

  // A layer laid on a piece: its outline filled with its material's colour; dragged to move.
  // fill-opacity 0.78: the piece outline and notches underneath stay visible through the layer.
  // A layer laid on a piece: its outline filled with its material's colour; dragged to move.
  function layerSVG(l, p, on) {
    const pts = layerOutline(l);
    const fab = fabricOf(p, p.active, l.material);
    const d = 'M' + pts.map((q) => f2(q[0]) + ' ' + f2(q[1])).join('L') + 'Z';
    return `<path class="tx-layer${on ? ' tx-sel' : ''}" data-layer="${esc(l.id)}" data-piece="${esc(l.piece)}" d="${d}" fill="${averageColor(fab)}" fill-opacity="0.78" stroke="var(--tx-accent)" stroke-width="${on ? 0.35 : 0.18}" style="cursor:move"/>`;
  }

  // Handles of the selected piece: its corners (round) and the middles of its edges (square); moved ones are filled.
  // Darts are skipped (moving a dart leg would break the dart), and edges under 3 cm get no mid handle (two handles
  // overlapping at normal zoom are unclickable).
  // Handles of the selected piece: its corners (round) and the middles of its edges (square); moved ones are filled.
  function handlesSVG(pc, done) {
    const moved = (edge, at) => done.some((x) => x.edge === edge && Math.abs(x.at - at) < 0.02);
    let out = '';
    for (const e of pc.edges) {
      if (e.kind === 'dart' || e.pts.length < 2) continue;
      const c = e.pts[0], L = plLength(e.pts);
      out += `<circle class="tx-handle" data-piece="${esc(pc.id)}" data-hedge="${esc(e.id)}" data-hat="0" cx="${f2(c[0])}" cy="${f2(c[1])}" r="0.9" fill="${moved(e.id, 0) ? 'var(--tx-accent)' : '#fff'}" stroke="var(--tx-accent)" stroke-width="0.25" style="cursor:grab"/>`;
      if (L > 3) {
        const m = pointAt(e.pts, L / 2).p;
        out += `<rect class="tx-handle" data-piece="${esc(pc.id)}" data-hedge="${esc(e.id)}" data-hat="0.5" x="${f2(m[0] - 0.7)}" y="${f2(m[1] - 0.7)}" width="1.4" height="1.4" fill="${moved(e.id, 0.5) ? 'var(--tx-accent)' : '#fff'}" stroke="var(--tx-accent)" stroke-width="0.25" style="cursor:grab"/>`;
      }
    }
    return out;
  }

  // The shape being drawn: its points and the closing edge.
  function drawSVG(pts) {
    if (!pts.length) return '';
    const d = 'M' + pts.map((q) => f2(q[0]) + ' ' + f2(q[1])).join('L') + (pts.length > 2 ? 'Z' : '');
    return `<path d="${d}" fill="var(--tx-accent)" fill-opacity="0.18" stroke="var(--tx-accent)" stroke-width="0.25" stroke-dasharray="0.8 0.5"/>` + pts.map((q) => `<circle cx="${f2(q[0])}" cy="${f2(q[1])}" r="0.5" fill="var(--tx-accent)"/>`).join('');
  }

  // A placement print: an image (when the artwork still exists) or a motif path scaled from its unit size; the dashed
  // square marks the print box for dragging, also over transparent parts of the artwork.
  function placementSVG(pl, p) {
    const tr = `translate(${f2(pl.x)} ${f2(pl.y)}) rotate(${f2(pl.rot || 0)})`;
    const w = pl.w ?? 20;
    let body;
    if (pl.art.kind === 'image' && p.images[pl.art.id]) {
      const hgt = pl.h ?? w;
      body = `<image href="${esc(p.images[pl.art.id].src)}" x="${f2(-w / 2)}" y="${f2(-hgt / 2)}" width="${f2(w)}" height="${f2(hgt)}" preserveAspectRatio="xMidYMid meet"/>`;
    } else body = `<path d="${motifPath(pl.art.motif)}" transform="scale(${f2(w / 2)})" fill="${esc(pl.art.color)}"/>`;
    return `<g class="tx-pl" data-pl="${esc(pl.id)}" data-piece="${esc(pl.piece)}" transform="${tr}" style="cursor:move">${body}<rect x="${f2(-w / 2)}" y="${f2(-w / 2)}" width="${f2(w)}" height="${f2(w)}" fill="none" stroke="var(--tx-accent)" stroke-width="0.15" stroke-dasharray="0.6 0.4"/></g>`;
  }

  // Flats: coloured with the fabrics of the outermost garment (the visible one), as in export.js.
  function flatsView(p) {
    const drafts = p.outfit.map((_, i) => draftOf(p, i));
    const fills = {};
    const g = p.outfit.length - 1;
    for (const mat of ['shell', 'lining', 'satin', 'rib', 'contrast']) fills[mat] = averageColor(fabricOf(p, g, mat));
    const front = flatSVG(drafts, { view: 'front', width: 360, fills }), back = flatSVG(drafts, { view: 'back', width: 360, fills });
    return h('div', { class: 'tx-flats' }, h('figure', {}, h('div', { html: front }), h('figcaption', {}, t('v2.view.front'))), h('figure', {}, h('div', { html: back }), h('figcaption', {}, t('v2.view.back'))));
  }

  // Layout: the nest helpers emit width / height in cm (print size); the regex rewrites them to px at SCALE so the
  // on-screen size matches the other modes and fit() can read a pixel size.
  function layoutView(p) {
    const d = draftOf(p);
    const r = nest(cutInstances(d, { material: 'shell' }), { width: p.view.fabricWidth || 150 });
    const svg = layoutSVG(r, { fabric: averageColor(fabricOf(p, p.active, 'shell')) + '55', label: (pl) => pieceName(pl.label) });
    const node = svgNode(svg.replace(/width="([\d.]+)cm" height="([\d.]+)cm"/, (m0, w, hh) => `width="${f2(w * SCALE)}" height="${f2(hh * SCALE)}"`));
    ctx.status2d(t('v2.layoutInfo', { len: (r.length / 100).toFixed(2), width: r.width, eff: Math.round(r.efficiency * 100) }));
    return node;
  }

  // Graded nest: the same size list as export.js (and the same EU-only KNOWN DEFECT noted there).
  function gradeView(p) {
    const g = p.outfit[p.active];
    const sizes = p.body.age < 15 ? null : p.body.sex === 'male' ? [46, 48, 50, 52, 54] : [34, 36, 38, 40, 42];
    const graded = gradeGarment({ garment: g.garment, opts: g.opts, details: g.details }, p.body.sex, sizes, { system: p.view.sizeSystem, age: p.body.age, height: p.body.height });
    const svg = gradedSVG(graded, { width: 150 });
    return svgNode(svg.replace(/width="([\d.]+)cm" height="([\d.]+)cm"/, (m0, w, hh) => `width="${f2(w * SCALE)}" height="${f2(hh * SCALE)}"`));
  }

  // Fabric view: a tiled swatch (CSS background-repeat of one texture tile shown at half size: 2x pixels, crisp on
  // HiDPI) and, for structures with a cell grid, the weaving draft.
  function fabricView(p) {
    const mat = ctx.fabricSlot();
    const f = fabricOf(p, p.active, mat);
    const tex = fabricTexture(f, { px: 8, maxSize: 320 });
    const sw = h('div', { class: 'tx-swatch', style: { backgroundImage: `url(${toDataURL(tex)})`, backgroundSize: `${tex.width / 2}px ${tex.height / 2}px` } });
    const parts = [h('figure', {}, sw, h('figcaption', {}, `${materialName(mat)} · ${t('fab.' + f.preset)} · ${f.props.gsm} g/m²`))];
    const st = fabricWeave(f);
    if (st.cells) parts.push(draftGrid(f, st));
    return h('div', { class: 'tx-fabric-view' }, parts);
  }

  // Weaving draft: threading over the drawdown, tie-up at the top right, treadling at the right; drawdown cells toggle.
  // Standard handweaving layout: threading rows = shafts, treadling columns = treadles, drawdown = threading x tie-up x
  // treadling. The repeat is shown up to 3 times (max ~24 cells across) so the pattern reads as cloth, not as one tile.
  // Cells are 14 px with a 1 px gap (width c - 1): a grid without stroke cost. Drawdown cells use the warp colour where
  // the warp is up and the weft colour elsewhere, like the real cloth face.
  // Weaving draft: threading over the drawdown, tie-up at the top right, treadling at the right; drawdown cells toggle.
  function draftGrid(f, st) {
    const d = weaveToDraft(st);
    const reps = Math.max(1, Math.min(3, Math.floor(24 / Math.max(st.w, st.h))));
    const W = st.w * reps, Hh = st.h * reps, c = 14, gap = 10;
    const warp = colorOrder(f, 'warp'), weft = colorOrder(f, 'weft');
    const top = d.shafts * c + gap, left = 0, right = W * c + gap;
    let s = '';
    for (let e = 0; e < W; e++) for (let k = 0; k < d.shafts; k++) {
      const on = d.threading[e % st.w] === k;
      s += `<rect x="${e * c}" y="${(d.shafts - 1 - k) * c}" width="${c - 1}" height="${c - 1}" fill="${on ? 'var(--tx-ink)' : 'var(--tx-cell)'}"/>`;
    }
    for (let k = 0; k < d.shafts; k++) for (let tr = 0; tr < d.treadles; tr++) {
      s += `<rect x="${right + tr * c}" y="${(d.shafts - 1 - k) * c}" width="${c - 1}" height="${c - 1}" fill="${d.tieup[k][tr] ? 'var(--tx-accent)' : 'var(--tx-cell)'}"/>`;
    }
    for (let pk = 0; pk < Hh; pk++) for (let tr = 0; tr < d.treadles; tr++) {
      s += `<rect x="${right + tr * c}" y="${top + pk * c}" width="${c - 1}" height="${c - 1}" fill="${d.treadling[pk % st.h] === tr ? 'var(--tx-ink)' : 'var(--tx-cell)'}"/>`;
    }
    for (let pk = 0; pk < Hh; pk++) for (let e = 0; e < W; e++) {
      const up = st.cells[(pk % st.h) * st.w + (e % st.w)];
      s += `<rect class="tx-dd" data-e="${e % st.w}" data-p="${pk % st.h}" x="${left + e * c}" y="${top + pk * c}" width="${c - 1}" height="${c - 1}" fill="${up ? warp[e % warp.length] : weft[pk % weft.length]}" stroke="var(--tx-line)" stroke-width="0.5"/>`;
    }
    const total = right + d.treadles * c;
    const node = svgNode(`<svg xmlns="http://www.w3.org/2000/svg" class="tx-svg tx-draft" width="${total}" height="${top + Hh * c}" viewBox="0 0 ${total} ${top + Hh * c}" role="img" aria-label="${esc(t('v2.draft'))}">${s}</svg>`);
    // One delegated click listener on the SVG; data-e / data-p carry the cell's end and pick within ONE repeat.
    node.addEventListener('click', (e) => {
      const r = e.target.closest('.tx-dd');
      if (r) ctx.toggleCell(st, Number(r.dataset.e), Number(r.dataset.p));
    });
    return h('figure', {}, node, h('figcaption', {}, t('v2.draftInfo', { shafts: d.shafts, treadles: d.treadles })));
  }

  // Print view: the repeat tile as a CSS tiled background (shows seams if the repeat is not seamless) and one
  // black-on-white separation per colour, as a screen printer would expose them, with coverage in percent.
  function printView(p) {
    const g = p.outfit[p.active];
    const design = normalizeDesign(g.design || {});
    const u = repeatUnit(design);
    const tile = renderUnit(design, { pxPerCm: Math.max(4, Math.min(16, 220 / Math.max(u.w, u.h))) });
    const url = toDataURL(tile);
    const box = h('div', { class: 'tx-repeat', style: { backgroundImage: `url(${url})`, backgroundSize: `${tile.width}px ${tile.height}px` }, 'aria-label': t('v2.repeat') });
    const seps = separations(design, { pxPerCm: 4 });
    const sepEls = seps.layers.map((l) => {
      const img = { width: seps.width, height: seps.height, data: new Uint8ClampedArray(seps.width * seps.height * 4) };
      for (let i = 0; i < l.mask.length; i++) { const v = l.mask[i] ? 0 : 255; img.data.set([v, v, v, 255], i * 4); }
      return h('figure', { class: 'tx-sep' }, h('img', { src: toDataURL(img), alt: '' }), h('figcaption', {}, h('span', { class: 'tx-chip', style: { background: l.color } }), ` ${Math.round(l.coverage * 100)} %`));
    });
    return h('div', { class: 'tx-print-view' }, h('figure', {}, box, h('figcaption', {}, t('v2.unit', { w: f2(u.w), h: f2(u.h) }))), h('div', { class: 'tx-seps' }, sepEls));
  }

  // render never throws: a failing drawing shows its error in the pane, the rest of the app keeps working.
  function render(p) {
    modeSeg.set(mode);
    ctx.status2d('');
    try {
      const node = mode === 'body' ? bodyView(p) : mode === 'pattern' ? patternView(p) : mode === 'flats' ? flatsView(p) : mode === 'layout' ? layoutView(p) : mode === 'grade' ? gradeView(p) : mode === 'fabric' ? fabricView(p) : printView(p);
      put(node);
    } catch (e) {
      console.error(e);
      put(h('div', { class: 'ap-empty' }, t('err.generic', { msg: e.message })));
    }
  }

  return {
    render,
    setMode(m, p) { if (MODES.includes(m) && m !== mode) { mode = m; fitted = false; } if (p) render(p); },
    get mode() { return mode; },
    // starts drawing a shape on a piece (the pattern mode is shown)
    startDraw(piece) { draw = { piece, pts: [] }; if (mode !== 'pattern') { mode = 'pattern'; fitted = false; } ctx.status2d(t('v2.drawHint')); render(ctx.project()); stage.focus(); },
    get drawing() { return !!draw; },
    fit,
    svg: () => inner.querySelector('svg')?.outerHTML || '',
  };
}

// Bounding box of a point list (cut outline with allowance), same shape as pieceBBox for the layout loop.
const boxOf = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
export { outline };
