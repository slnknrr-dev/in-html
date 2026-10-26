// garment/flats.js - technical flat drawings generated from the pattern: the garment as it lies flat, front and back.
// Torso pieces are drawn in their shared frame, cut at the side line (the fold of a garment laid flat) and mirrored for
// the other half; the bust dart is closed (the part below it moves up by its intake); the lapel shows its folded shape
// over the chest; sleeves hang from the shoulder points with the drafted sleeve length, bicep and hem widths; trouser
// legs are placed by their creases; collars, bands, pockets (the 3D overlays), buttons and button holes, dart stitching
// and topstitching follow. Coordinates: X across (0 = centre front / back), Y down from the nape, centimetres.
//
//   flatShapes(draft, view = 'front') -> [{ kind: 'fill' | 'line' | 'stitch' | 'button' | 'hole', pts | p, material,
//                                           z (stacking), closed }]
//   flatSVG(drafts, { view, fills: { material: colour }, stroke, width, height, background }) -> SVG

import { outline } from './piece.js';
import { bbox, curve, plLength, pointAt } from './geom.js';
import { stackIndex } from './details.js';

// Sutherland-Hodgman clip of a polygon to the half-plane where f(p) >= 0 (f linear).
//
// Technical flats (fashion sketches) derived from the drafted pieces themselves, so the sketch always matches the
// pattern. clipHalf is one Sutherland-Hodgman step: keeps the part of a polygon where f(p) >= 0, inserting the
// crossing points on edges that change sign (f is a signed distance to a clip line).
function clipHalf(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
const clipPolyline = (pts, f) => pts.filter((p) => f(p) >= -1e-6);

// The waist level of the nape frame: trousers and skirts are drafted from the waist.
const waistY = (d) => d.m.napeToWaist ?? 40;

// Pieces are placed in a common body frame (nape at the origin, waist at napeToWaist) so tops and bottoms of an
// outfit line up in one drawing.
export function flatShapes(d, view = 'front') {
  const front = view === 'front';
  const out = [];
  const z0 = stackIndex('shell');
  const I = d.info.torso;
  const push = (s) => out.push(s);
  const both = (fn) => { for (const side of ['R', 'L']) fn(side); };

  if (I) {
    const W = I.W, wB = I.wB;
    // Map frame -> view. Front: X = x - W (R half on the viewer's left); back: X = x (R half on the right).
    const mapX = (x, side) => {
      const X = front ? x - W : x;
      return side === 'R' ? X : -X;
    };
    const intake = I.intake || 0;
    const frontPiece = d.pieces.find((p) => p.id === 'front');
    const dartY = frontPiece?.meta?.bustPoint ? frontPiece.meta.bustPoint[1] : Infinity;
    const close = (p, q) => (p.meta?.side === 'front' || p.id === 'front' || p.id === 'frontLining') && intake && q[1] > dartY ? [q[0], q[1] - intake] : q;
    const keep = front ? (q) => q[0] - wB : (q) => wB - q[0];
    const torsoPieces = d.pieces.filter((p) => p.arrange?.mode === 'torso' && p.sim !== false && p.layer === 'shell' && !p.id.endsWith('Lining'));
    // Overlap at the front: the buttonhole side lies on top.
    const over = d.m.sex === 'male' ? 'L' : 'R';
    const sides = front ? (over === 'L' ? ['R', 'L'] : ['L', 'R']) : ['R', 'L'];
    for (const side of sides) {
      for (const p of torsoPieces) {
        let poly = outline(p).map((q) => close(p, q));
        if (p.id === 'front' && d.info.rollCut) {
          const [a, b] = [d.info.rollCut.from, d.info.rollCut.to];
          const sgn = Math.sign((b[0] - a[0]) * (I.yC - a[1]) - (b[1] - a[1]) * (wB - a[0])) || 1;
          poly = clipHalf(poly, (q) => sgn * ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])));
        }
        poly = clipHalf(poly, keep);
        if (poly.length < 3) continue;
        const pts = poly.map((q) => [mapX(q[0], side), q[1]]);
        push({ kind: 'fill', pts, closed: true, material: p.material, z: z0 + (side === over ? 0.5 : 0) });
        // Darts as stitching from the mouth to the apex.
        for (const m of p.marks.filter((mk) => mk.type === 'dart')) {
          const s = clipPolyline(m.pts.map((q) => close(p, q)), keep);
          if (s.length === 2) push({ kind: 'stitch', pts: s.map((q) => [mapX(q[0], side), q[1]]), z: z0 + 0.6 });
        }
        for (const m of p.marks.filter((mk) => mk.type === 'line' && (mk.role === 'pocket' || mk.role === 'zip') && (!mk.side || mk.side === 'both' || mk.side === side))) {
          const s = clipPolyline(m.pts.map((q) => close(p, q)), keep);
          if (s.length >= 2) push({ kind: 'line', pts: s.map((q) => [mapX(q[0], side), q[1]]), z: z0 + 0.7 });
        }
        // Topstitched hem.
        for (const e of p.edges.filter((ed) => ed.kind === 'hem')) {
          const s = clipPolyline(e.pts.map((q) => close(p, [q[0], q[1] - 1.6])), keep);
          if (s.length >= 2) push({ kind: 'stitch', pts: s.map((q) => [mapX(q[0], side), q[1]]), z: z0 + 0.6 });
        }
      }
      // Overlays on torso pieces (lapel, pockets, flaps) in this view.
      for (const o of d.overlays.filter((ov) => torsoPieces.some((p) => p.id === ov.on) && (ov.side === 'both' || ov.side === side))) {
        const poly = clipHalf(outline(o.piece).map((q) => close(d.pieces.find((p) => p.id === o.on) || {}, q)), keep);
        if (poly.length >= 3) push({ kind: 'fill', pts: poly.map((q) => [mapX(q[0], side), q[1]]), closed: true, material: o.material, z: stackIndex(o.layer) + (side === over ? 0.5 : 0) });
      }
      // Buttons and holes on the front.
      if (front) {
        for (const b of d.buttons.filter((x) => x.piece === 'front' && (x.side === side || x.side === 'both'))) push({ kind: 'button', p: [mapX(b.p[0], side), close(frontPiece, b.p)[1]], d: b.d, z: stackIndex('button') + 1 });
        for (const m of (frontPiece?.marks || []).filter((mk) => mk.type === 'buttonhole' && mk.side === side)) push({ kind: 'hole', p: [mapX(m.p[0], side), close(frontPiece, m.p)[1]], w: m.w, z: stackIndex('button') + 1 });
      }
    }
    // Sleeves hanging from the shoulder points.
    const sl = d.info.sleeve;
    const sp = front ? d.info.torso.points.SPf : d.info.torso.points.SPb;
    if (sl && sp) {
      const cuff = d.pieces.find((p) => p.id === 'cuff');
      const L = sl.capHeight + sl.length;
      const ua = [wB, I.yC];
      // The armhole curve of the bodice in this view (the sleeve fills it).
      const armPts = [];
      for (const p of d.pieces.filter((q) => q.arrange?.mode === 'torso' && q.layer === 'shell')) {
        for (const e of p.edges.filter((ed) => /^armhole/.test(ed.id))) for (const q of e.pts) if (keep(q) >= -0.01) armPts.push(q);
      }
      armPts.sort((a, b) => b[1] - a[1]);
      both((side) => {
        const SPv = [mapX(sp[0], side), sp[1]], UAv = [mapX(ua[0], side), ua[1]];
        const s = Math.sign(SPv[0]) || 1; // outwards
        // Hanging slightly out, folded along the top of the arm: the fold has the sleeve length, the hem half the hem
        // width; the sleeve lies over the side of the bodice up to the armhole seam (drawn above the bodice).
        const ang = (14 * Math.PI) / 180;
        const dir = [s * Math.sin(ang), Math.cos(ang)];
        const out1 = [SPv[0] + dir[0] * L, SPv[1] + dir[1] * L];
        const in1 = [out1[0] - s * Math.cos(ang) * (sl.hemWidth / 2), out1[1] + Math.sin(ang) * (sl.hemWidth / 2)];
        push({ kind: 'fill', pts: [SPv, out1, in1, UAv, ...armPts.map((q) => [mapX(q[0], side), q[1]])], closed: true, material: d.pieces.find((p) => p.id === 'sleeve' || p.id === 'topSleeve')?.material || 'shell', z: z0 + 0.8 });
        if (cuff) {
          const dep = cuff.arrange?.depth || 6;
          const down = [Math.sin(ang) * s, Math.cos(ang)];
          push({ kind: 'fill', pts: [out1, [out1[0] + down[0] * dep, out1[1] + down[1] * dep], [in1[0] + down[0] * dep, in1[1] + down[1] * dep], in1], closed: true, material: cuff.material, z: stackIndex('band') });
        }
        push({ kind: 'stitch', pts: [[out1[0] - down0(ang, s)[0] * 1.8, out1[1] - 1.8], [in1[0] - down0(ang, s)[0] * 1.8, in1[1] - 1.8]], z: z0 });
      });
    }
    // Collars and hoods at the neck.
    const neckFront = frontPiece?.edges.find((e) => e.id === 'neck');
    const snp = I.points.SNPf, fnp = I.points.FNP;
    const col = d.components.find((c) => c.type === 'collar');
    if (col && col.variant !== 'none' && snp) {
      both((side) => {
        const S = [mapX(snp[0], side), snp[1]];
        const C = [mapX(fnp[0], side), fnp[1]];
        if (col.variant === 'band') {
          const nk = (neckFront?.pts || [snp, fnp]).map((q) => [mapX(q[0], side), q[1]]);
          if (front) push({ kind: 'fill', pts: [...nk, ...nk.slice().reverse().map((q) => [q[0], q[1] + 2])], closed: true, material: 'rib', z: stackIndex('band') });
        } else if (col.variant === 'hood') {
          if (side === 'R') {
            // One shape round the head: from one side neck point over the crown to the other.
            const H = (d.pieces.find((p) => p.id === 'hood')?.arrange?.H || 34) * 0.8, R0 = Math.abs(S[0]) + 9;
            const right = curve(S, [-0.4, -1], [0, S[1] - H], [1, 0], 0.6, 0.55);
            const pts = [...right, ...right.slice(0, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x * (1 + 0.5 * Math.max(0, (S[1] - y) / H)) * (R0 / Math.max(1, Math.abs(S[0]) + 9)), y]);
            push({ kind: 'fill', pts, closed: true, material: 'shell', z: z0 - 0.5 });
            if (front) push({ kind: 'line', pts: curve([S[0] * 0.6, S[1] - 1], [0, -1], [-S[0] * 0.6, S[1] - 1], [0, 1], 1.2, 1.2), z: z0 - 0.4 });
          }
        } else {
          const stand = 3.2;
          push({ kind: 'fill', pts: [S, [S[0], S[1] - stand], [0, S[1] - stand + 0.5], [0, C[1] - 1]], closed: true, material: 'shell', z: stackIndex('collar') - 0.3 });
          if (col.variant === 'shirt' && front) push({ kind: 'fill', pts: [[S[0], S[1] - stand], [S[0] * 1.25, S[1] + 2.5], [S[0] * 0.25, C[1] + 1.5], [0, C[1] - 1]], closed: true, material: 'shell', z: stackIndex('collar') });
        }
      });
    }
    if (d.info.lapel && d.info.collar && front) {
      both((side) => {
        const S = [mapX(snp[0], side), snp[1]];
        const g = d.info.lapel.look[d.info.lapel.look.length - 1];
        const G = [mapX(g[0], side), g[1]];
        push({ kind: 'fill', pts: [[S[0] * 1.05, S[1] - 2.6], [S[0] * 1.6, S[1] + 4], [G[0] + (G[0] - S[0]) * 0.35, G[1] + 0.5], G, S], closed: true, material: 'shell', z: stackIndex('collar') });
      });
    }
    const hb = d.pieces.find((p) => p.id === 'hemband');
    if (hb) {
      const dep = hb.arrange?.depth || 7;
      const y = I.yHem;
      const xs = front ? [wB - W, W - wB] : [-wB, wB];
      push({ kind: 'fill', pts: [[xs[0], y], [xs[1], y], [xs[1] * 0.97, y + dep], [xs[0] * 0.97, y + dep]], closed: true, material: 'rib', z: stackIndex('band') });
    }
  }

  // Skirts (and the skirt of a dress) from the waist.
  for (const id of ['skirtFront', 'skirtBack']) {
    const p = d.pieces.find((q) => q.id === id);
    if (!p || (front ? id !== 'skirtFront' : id !== 'skirtBack')) continue;
    const W = d.info.skirt.W, y0 = waistY(d);
    both((side) => {
      const base = p.cut.fold ? outline(p) : outline(p);
      const pts = base.map(([x, y]) => [(side === 'R' ? 1 : -1) * (front ? x - W : x), y + y0]);
      push({ kind: 'fill', pts, closed: true, material: p.material, z: z0 - 0.1 });
      for (const m of p.marks.filter((mk) => mk.type === 'dart')) push({ kind: 'stitch', pts: m.pts.map(([x, y]) => [(side === 'R' ? 1 : -1) * (front ? x - W : x), y + y0]), z: z0 });
    });
  }

  // Trousers: legs placed by their creases, the fork at the centre.
  const tp = d.pieces.find((q) => q.id === (front ? 'trouserFront' : 'trouserBack'));
  if (tp) {
    const T = d.info.trousers, y0 = waistY(d);
    // Shift that brings the fork to the centre below the crotch and keeps the centre front there above the hip.
    const fork = Math.min(...outline(tp).map((q) => q[0]));
    const shiftAt = (y) => -fork * Math.max(0, Math.min(1, (y - T.yHip) / Math.max(1, T.yCr - T.yHip)));
    both((side) => {
      const s = side === 'R' ? (front ? -1 : 1) : (front ? 1 : -1);
      const map = ([x, y]) => [s * Math.max(0, x + shiftAt(y)), y + y0];
      push({ kind: 'fill', pts: outline(tp).map(map), closed: true, material: tp.material, z: z0 - 0.3 });
      for (const m of tp.marks.filter((mk) => mk.type === 'line' && mk.role === 'crease')) push({ kind: 'stitch', pts: m.pts.map(map), z: z0 - 0.2 });
      for (const o of d.overlays.filter((ov) => ov.on === tp.id)) push({ kind: 'fill', pts: outline(o.piece).map(map), closed: true, material: o.material, z: stackIndex(o.layer) });
    });
    const wbp = d.pieces.find((q) => q.id === 'waistband');
    if (wbp) {
      const dep = wbp.arrange?.depth || 4;
      const half = (d.m.waist + 3) / 4;
      push({ kind: 'fill', pts: [[-half - 1, y0 - dep], [half + 1, y0 - dep], [half + 1, y0], [-half - 1, y0]], closed: true, material: wbp.material, z: stackIndex('band') });
    }
  }

  // Cummerbund at the waist (front only), tote panels.
  const cb = d.pieces.find((q) => q.id === 'cummerbund');
  if (cb && front) {
    const y0 = waistY(d) - cb.edges.find((e) => e.id === 'end').pts[1][1] / 2;
    both((side) => push({ kind: 'fill', pts: outline(cb).map(([x, y]) => [(side === 'R' ? -1 : 1) * x, y + y0 - 3]), closed: true, material: cb.material, z: stackIndex('band') + 1 }));
    for (const m of cb.marks.filter((mk) => mk.role === 'pleat')) both((side) => push({ kind: 'line', pts: m.pts.map(([x, y]) => [(side === 'R' ? -1 : 1) * x, y + y0 - 3]), z: stackIndex('band') + 1.1 }));
  }
  const panel = d.pieces.find((q) => q.id === 'panel');
  if (panel) {
    const { W, H } = d.info.tote;
    push({ kind: 'fill', pts: outline(panel).map(([x, y]) => [x - W / 2, y]), closed: true, material: panel.material, z: z0 });
    for (const x of [W * 0.28, W * 0.72]) void x;
    push({ kind: 'line', pts: curve([-W * 0.22, 0], [0, -1], [W * 0.22, 0], [0, 1], 1.1, 1.1, 0.5), z: z0 - 1 });
    push({ kind: 'stitch', pts: [[-W / 2, 2.2], [W / 2, 2.2]], z: z0 + 0.1 });
    for (const o of d.overlays.filter((ov) => ov.on === 'panel' && (ov.side === 'R' || ov.side === 'both'))) if (front) push({ kind: 'fill', pts: outline(o.piece).map(([x, y]) => [x - W / 2, y]), closed: true, material: o.material, z: stackIndex(o.layer) });
    void H;
  }
  return out.sort((a, b) => a.z - b.z);
}
const down0 = (ang, s) => [Math.sin(ang) * s, Math.cos(ang)];

// Default fills per material slot when the outfit gives no fabric colour.
const COLORS = { shell: '#dfe5ee', lining: '#c9b8e8', satin: '#2b2d33', contrast: '#e8c07a', rib: '#cfd6e2', interfacing: '#ffffff', canvas: '#efe6d2', pocketing: '#eeeeee' };

export function flatSVG(drafts, o = {}) {
  const view = o.view || 'front';
  const fills = { ...COLORS, ...(o.fills || {}) };
  const shapes = (Array.isArray(drafts) ? drafts : [drafts]).flatMap((d, gi) => flatShapes(d, view).map((s) => ({ ...s, z: s.z + gi * 100 })));
  shapes.sort((a, b) => a.z - b.z);
  const all = shapes.flatMap((s) => s.pts || [s.p]);
  const b = all.length ? bbox(all) : { x0: -30, y0: 0, x1: 30, y1: 60, w: 60, h: 60 };
  const pad = 4;
  const stroke = o.stroke || '#1d2330';
  const f = (v) => (Math.round(v * 100) / 100).toString();
  const path = (pts, closed) => 'M' + pts.map((q) => f(q[0]) + ' ' + f(q[1])).join('L') + (closed ? 'Z' : '');
  const body = shapes.map((s) => {
    if (s.kind === 'fill') return `<path d="${path(s.pts, true)}" fill="${fills[s.material] || fills.shell}" stroke="${stroke}" stroke-width="0.22" stroke-linejoin="round"/>`;
    if (s.kind === 'line') return `<path d="${path(s.pts)}" fill="none" stroke="${stroke}" stroke-width="0.2"/>`;
    if (s.kind === 'stitch') return `<path d="${path(s.pts)}" fill="none" stroke="${stroke}" stroke-width="0.1" stroke-dasharray="0.5 0.35"/>`;
    if (s.kind === 'button') return `<circle cx="${f(s.p[0])}" cy="${f(s.p[1])}" r="${f(s.d / 2)}" fill="${o.buttonColor || '#3b3f47'}" stroke="${stroke}" stroke-width="0.1"/>`;
    if (s.kind === 'hole') return `<path d="M${f(s.p[0] - s.w / 2)} ${f(s.p[1])}h${f(s.w)}" stroke="${stroke}" stroke-width="0.25"/>`;
    return '';
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(b.x0 - pad)} ${f(b.y0 - pad)} ${f(b.w + 2 * pad)} ${f(b.h + 2 * pad)}" width="${o.width || 420}" height="${o.height || Math.round(((b.h + 2 * pad) / (b.w + 2 * pad)) * (o.width || 420))}">${o.background ? `<rect x="${f(b.x0 - pad)}" y="${f(b.y0 - pad)}" width="${f(b.w + 2 * pad)}" height="${f(b.h + 2 * pad)}" fill="${o.background}"/>` : ''}${body}</svg>`;
}

export { plLength, pointAt };
