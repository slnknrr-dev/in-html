// cloth/assemble.js - from drafted garments to a cloth simulation around a body. Every simulated piece becomes one or
// two instances (mirrored pairs: right as drafted, left mirrored; cut-on-fold pieces opened out; folded bands at half
// height), is meshed, and is placed around the body part it belongs to by its arrangement mode: torso pieces wrap the
// torso by the shared torso frame (x from the centre back to the centre front = 270 deg to 90 deg), sleeves the arms,
// trouser pieces the legs and hips, collars the neck, hoods the head, bands the waist, wrists and hems. Seams are
// sewn instance to instance (vertex to the matching point of the other side, ease spread evenly), overlays (folded
// lapels, pocket flaps, jets, stripes) are attached to the surface of their parent, closures pin the fronts together,
// and every particle gets the clearance of its layer: lining under shell, bands, then lapels, collars and pockets, and
// whole garments stacked in outfit order.
//
//   assemble(drafts, rig, { h, fabricFor(garmentIndex, material) -> fabric, collider }) ->
//     { cloth, collider, instances: [{ id, garment, pieceId, side, start, count, tris, uv, xy, material, layer, overlay }],
//       buttons: [{ vertex, d, garment }], stats: { particles, seams, overlays } }

import { createCloth } from './sim.js';
import { pieceMesh, meshEdges, bendPairs } from './mesh.js';
import { bodyCollider } from '../body/collide.js';
import { partById, ringAt } from '../body/body.js';
import { edgeChain, mirrorPiece, transformPiece, unfoldPiece, splitPiece, edgeById } from '../garment/piece.js';
import { stackIndex } from '../garment/details.js';
import { simParams, normalizeFabric, MATERIAL_DEFAULTS } from '../fabric/fabric.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

// Radius of a body part's ring at axis position t towards angle phi (and the ring centre).
function ringR(part, t, phi) {
  const rg = ringAt(part, clamp(t, 0, part.length));
  const M = part.M, j = (((phi / TAU) * M) % M + M) % M, j0 = Math.floor(j), f = j - j0;
  return { r: rg.r[j0 % M] * (1 - f) + rg.r[(j0 + 1) % M] * f, cx: rg.cx, cz: rg.cz };
}

// --- arrangement: 2D instance coordinates -> 3D start positions ---------------------------------------------------

function arranger(rig, piece, side, offset, drafts, gi) {
  const a = piece.arrange || {};
  const lm = rig.lm;
  const torso = partById(rig, 'torso');
  const s = side === 'L' ? -1 : 1; // the left instance has mirrored x
  const torsoPoint = (Y, phi, extraR, garmentR) => {
    const t = Y - torso.origin[1];
    const { r, cx, cz } = ringR(torso, t, phi);
    const R = Math.max(r + extraR, garmentR || 0);
    return [cx + R * Math.cos(phi), Y, cz + R * Math.sin(phi)];
  };
  const d = drafts[gi];
  switch (a.mode) {
    case 'torso': {
      const W = a.W;
      const gR = (W / Math.PI) * 0.92;
      return ([x, y]) => torsoPoint(lm.cervicale - y, (270 - (180 * x) / W) * DEG, offset + 1.2, gR);
    }
    case 'hip': {
      const W = a.W;
      return ([x, y]) => torsoPoint(lm.waist - y, (270 - (180 * x) / W) * DEG, offset + 1, (W / Math.PI) * 0.9);
    }
    case 'band': {
      // Cummerbund: from the centre front (fold) round the wearer's right side.
      const half = a.girth / 2;
      return ([x, y]) => torsoPoint(lm.waist + a.centerY - y + (a.dy || 0), (90 + (180 * s * x) / half) * DEG, offset + 0.8);
    }
    case 'strap': {
      // Round the back from the wearer's right side (180 deg) to the left side (360 deg), at the cummerbund's height.
      return ([x, y]) => torsoPoint(lm.waist + 4 - Math.abs(y) - 2, (180 + (180 * x) / Math.max(10, a.L)) * DEG, offset + 1.0);
    }
    case 'waistband': {
      const L = (edgeById(piece, 'attach') ? Math.abs(edgeById(piece, 'attach').pts[1][0] - edgeById(piece, 'attach').pts[0][0]) : 40) - 4;
      return ([x, y]) => torsoPoint(lm.waist + Math.abs(y), (270 - (180 * x) / Math.max(10, L)) * DEG, offset + 1.0);
    }
    case 'hemband': {
      const I = d.info.torso;
      const L = Math.max(10, Math.abs((edgeById(piece, 'attach')?.pts[1][0] ?? 40) - (edgeById(piece, 'attach')?.pts[0][0] ?? 0)));
      return ([x, y]) => torsoPoint(lm.cervicale - I.yHem - Math.abs(y), (270 - (180 * x) / L) * DEG, offset + 1.5, (I.W / Math.PI) * 0.9);
    }
    case 'collar': {
      const neck = partById(rig, 'neck');
      const L = Math.max(5, a.neckLen);
      return ([x, y]) => {
        const phi = (270 - (180 * x) / L) * DEG;
        const t = clamp(3 + y * 0.6, 0, neck.length - 1);
        const { r, cx, cz } = ringR(neck, t, phi);
        const R = r + offset + 0.6 + Math.max(0, y) * 0.3;
        return madd(madd(madd(neck.origin, neck.axis, t), neck.e1, cx + R * Math.cos(phi)), neck.e2, cz + R * Math.sin(phi));
      };
    }
    case 'hood': {
      const head = partById(rig, 'head');
      const c = madd(head.origin, head.axis, head.length * 0.45);
      const R = (rig.targets.girth.head / TAU) * 1.25 + 2 + offset;
      const L = Math.max(5, a.neckLen), H = Math.max(10, a.H);
      return ([x, y]) => {
        const phi = (270 - (180 * x) / L) * DEG;
        const up = clamp(-y / H, 0, 1);
        const el = (-25 + 115 * up) * DEG; // from below the ears over the crown
        return [c[0] + R * Math.cos(el) * Math.cos(phi), c[1] + R * Math.sin(el), c[2] + R * Math.cos(el) * Math.sin(phi) - 1.5];
      };
    }
    case 'arm':
    case 'cuff': {
      const ua = partById(rig, 'upperArm' + (side === 'L' ? 'L' : 'R')), fa = partById(rig, 'forearm' + (side === 'L' ? 'L' : 'R'));
      const up = [0, 1, 0];
      let top = sub(up, ua.axis.map((v) => v * dot(up, ua.axis)));
      if (Math.hypot(...top) < 0.2) top = [side === 'L' ? 1 : -1, 0, 0];
      top = norm(top);
      const fwd = norm(sub([0, 0, 1], ua.axis.map((v) => v * dot([0, 0, 1], ua.axis))));
      const sleeveInfo = d.info.sleeve || { bicep: 34, capHeight: 14, length: 55 };
      const R = Math.max(sleeveInfo.bicep / TAU, (rig.targets.girth.upperArm / TAU) + 1.5) + offset;
      const xTop = (a.xTop ?? 0) * s;
      const along = (t) => (t <= ua.length ? madd(ua.origin, ua.axis, t) : madd(fa.origin, fa.axis, Math.min(fa.length + 6, t - ua.length)));
      if (a.mode === 'cuff') {
        const tEnd = sleeveInfo.capHeight * 0.7 + sleeveInfo.length - 1;
        const att = edgeById(piece, 'attach');
        const L = Math.max(10, att ? Math.abs(att.pts[att.pts.length - 1][0] - att.pts[0][0]) : 24);
        return ([x, y]) => {
          const th = (s * (x - L / 2)) / (L / TAU);
          const c = along(tEnd + Math.abs(y));
          const r = (rig.targets.girth.wrist / TAU) + 1.2 + offset;
          return madd(madd(c, top, r * Math.cos(th)), fwd, r * Math.sin(th));
        };
      }
      return ([x, y]) => {
        const th = (s * (xTop - x)) / R * 0.98;
        const c = along(y - sleeveInfo.capHeight * 0.3);
        const r = R * (1 + 0.15 * Math.max(0, 1 - y / Math.max(1, sleeveInfo.capHeight)));
        return madd(madd(c, top, r * Math.cos(th)), fwd, r * Math.sin(th));
      };
    }
    case 'leg': {
      // Front pieces wrap the front half of the leg (crease facing forwards), back pieces the back half; above the
      // crotch the axis moves to the centre of the hips.
      const leg = partById(rig, 'leg' + (side === 'L' ? 'L' : 'R'));
      const T = d.info.trousers;
      const out = side === 'L' ? 1 : -1; // world x of the outside of this leg
      const fwd = a.side === 'front' ? 1 : -1;
      return ([x, y]) => {
        const xr = x * s; // back to the drafted (right) coordinates
        const Y = lm.waist - y;
        const tLeg = (leg.origin[1] - Y) / -leg.axis[1];
        const onLeg = madd(leg.origin, leg.axis, Math.max(0, tLeg));
        const k = clamp((y - T.yHip) / Math.max(1, T.yCr - T.yHip), 0, 1);
        const cx = onLeg[0] * k, cz = onLeg[2] * k + (1 - k) * torso.origin[2];
        const legR = Math.max((T.hemWidth / TAU) * 1.4, ringR(leg, Math.max(0, tLeg), 0).r + 1.5) + offset;
        const R = k < 1 ? (a.hipW / Math.PI) * (1 - k) * 0.95 + k * legR : legR;
        const th = (xr - a.crease) / Math.max(4, R);
        return [cx + out * R * Math.sin(th), Y, cz + fwd * R * Math.cos(th)];
      };
    }
    case 'bag':
    case 'handle': {
      // The tote hangs in front of the body from its handles; the left instance (mirrored) is the back panel.
      const W = a.W, top = lm.waist + 12, z0 = 28, g = a.gusset || 0;
      if (a.mode === 'handle') {
        const x0 = W * 0.28, x1 = W * 0.72, cxm = (x0 + x1) / 2, rx = (x1 - x0) / 2;
        return ([x, y]) => {
          const ang = clamp(y / 62, 0, 1) * Math.PI;
          return [cxm - rx * Math.cos(ang) - W / 2, top + 24 * Math.sin(ang), z0 + (side === 'L' ? -g / 2 : g / 2) + (x * s - 2) * 0.1];
        };
      }
      return ([x, y]) => (side === 'L' ? [-x - W / 2, top - y, z0 - g / 2 - 0.3] : [x - W / 2, top - y, z0 + g / 2 + 0.3]);
    }
    case 'wrap': {
      // A piece of an imported pattern placed by its place on the body: its bounding box wraps the part, its top at
      // the part's top line, its width over the angle of that place (a pair's right half from the side to the centre
      // front or back; a single piece the whole front, back or round); the radius follows the width the piece has.
      const [bx0, by0, bx1] = a.box;
      const w = Math.max(1, bx1 - bx0);
      const u = (x) => { const xr = x * s; const t = (xr - bx0) / w; return a.flip ? 1 - t : t; };
      const pair = a.pair;
      const span = (a0, a1) => [a0 * DEG, a1 * DEG];
      const P = a.place;
      if (P === 'sleeve') {
        const ua = partById(rig, 'upperArm' + (side === 'L' ? 'L' : 'R')), fa = partById(rig, 'forearm' + (side === 'L' ? 'L' : 'R'));
        const up = norm(sub([0, 1, 0], ua.axis.map((v) => v * ua.axis[1])));
        const fwd = norm(sub([0, 0, 1], ua.axis.map((v) => v * ua.axis[2])));
        const R = Math.max(w / TAU, rig.targets.girth.upperArm / TAU + 1.5) + offset;
        const along = (t) => (t <= ua.length ? madd(ua.origin, ua.axis, t) : madd(fa.origin, fa.axis, Math.min(fa.length + 6, t - ua.length)));
        return ([x, y]) => { const th = (u(x) - 0.5) * TAU; const c = along(Math.max(0, y - by0 - 4)); return madd(madd(c, up, R * Math.cos(th)), fwd, R * Math.sin(th)); };
      }
      if (P === 'collar') {
        const neck = partById(rig, 'neck');
        return ([x, y]) => {
          const phi = (270 - 360 * u(x) * (pair ? 0.5 : 1)) * DEG;
          const t = clamp(3 + (y - by0) * 0.4, 0, neck.length - 1);
          const { r, cx, cz } = ringR(neck, t, phi);
          return madd(madd(madd(neck.origin, neck.axis, t), neck.e1, cx + (r + offset + 0.6) * Math.cos(phi)), neck.e2, cz + (r + offset + 0.6) * Math.sin(phi));
        };
      }
      if (P === 'legFront' || P === 'legBack') {
        const leg = partById(rig, 'leg' + (side === 'L' ? 'L' : 'R'));
        const fwdSign = P === 'legFront' ? 1 : -1, out = side === 'L' ? 1 : -1;
        return ([x, y]) => {
          const Y = lm.waist - (y - by0);
          const tLeg = (leg.origin[1] - Y) / -leg.axis[1];
          const on = madd(leg.origin, leg.axis, Math.max(0, tLeg));
          const k = clamp((lm.waist - Y) / Math.max(1, lm.waist - lm.crotch), 0, 1);
          const R = Math.max(w / Math.PI, ringR(leg, Math.max(0, tLeg), 0).r + 2) + offset;
          const th = (u(x) - 0.5) * Math.PI;
          return [on[0] * k + out * R * Math.sin(th) * 0.9, Y, on[2] * k + (1 - k) * torso.origin[2] + fwdSign * R * Math.cos(th)];
        };
      }
      // torso and skirt places: angles in the torso frame (90 = centre front, 270 = centre back)
      const skirt = P === 'skirtFront' || P === 'skirtBack';
      const front = P === 'torsoFront' || P === 'skirtFront';
      const sideP = P === 'torsoSide';
      const [a0, a1] = sideP ? span(220, 140) : pair ? (front ? span(180, 90) : span(180, 270)) : front ? span(180, 0) : span(180, 360);
      const top = (skirt ? lm.waist : sideP ? lm.armpit : lm.snp) - (a.drop || 0);
      const gR = (w / Math.abs(a1 - a0)) * 0.95;
      return ([x, y]) => {
        const t = u(x);
        // the right half of a pair: the far side of its box is the side seam (s mirrors the left half)
        const phi = s > 0 ? a0 + (a1 - a0) * t : Math.PI - (a0 + (a1 - a0) * t);
        return torsoPoint(top - (y - by0), phi, offset + 1.2, gR);
      };
    }
    default:
      return ([x, y]) => torsoPoint(lm.cervicale - y, (270 - 180 * (x / 50)) * DEG, offset + 2);
  }
}

// --- instances ---------------------------------------------------------------------------------------------------------

const simulated = (p) => p.sim !== false && p.arrange && !/Interfacing$/.test(p.id);

function instancesOf(d, gi) {
  const out = [];
  for (let p of d.pieces) {
    if (!simulated(p)) continue;
    // The jacket front ends at the roll line in 3D; the folded lapel is an overlay.
    if (d.info.rollCut && (p.id === 'front')) {
      try {
        const neckL = edgeById(p, 'neck');
        const cf = edgeById(p, 'cf');
        if (neckL && cf) p = { ...splitPiece(p, { from: { edge: 'cf', at: 0 }, to: { edge: 'neck', at: Infinity }, ids: ['roll', 'roll'] })[0], arrange: p.arrange };
      } catch { /* keep the full front */ }
    }
    if (p.meta?.folded) p = { ...transformPiece(p, [1, 0, 0, 0.5, 0, 0]), arrange: p.arrange, meta: p.meta };
    if (p.cut.fold) { const u = unfoldPiece(p); out.push({ piece: { ...u, arrange: p.arrange }, side: 'C', base: p }); continue; }
    if (p.cut.mirror || p.cut.n >= 2) {
      out.push({ piece: p, side: 'R', base: p });
      out.push({ piece: { ...mirrorPiece(p, 0), arrange: p.arrange }, side: 'L', base: p });
    } else out.push({ piece: p, side: 'R', base: p });
  }
  return out.map((x) => ({ ...x, garment: gi }));
}

// Edge ids of an instance for a seam end: opened fold pieces name their left half 'x:L'.
function chainIds(inst, base, side) {
  const p = inst.piece;
  if (inst.side === 'C' && side === 'L') {
    const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.\\d+)?:L$');
    const list = p.edges.filter((e) => e.kind !== 'dart' && re.test(e.id)).map((e) => e.id);
    const dartL = p.edges.find((e) => e.id === base + ':L');
    return list.length ? list : dartL ? [dartL.id] : [];
  }
  const ids = edgeChain(p, base);
  if (ids.length) return ids;
  const e = edgeById(p, base);
  return e ? [e.id] : [];
}

export function assemble(drafts, rig, o = {}) {
  const h = o.h || 2.5;
  const collider = o.collider || bodyCollider(rig);
  const fabricFor = o.fabricFor || ((gi, mat) => normalizeFabric({ preset: MATERIAL_DEFAULTS[mat] || 'poplin' }));
  const insts = [];
  drafts.forEach((d, gi) => { for (const x of instancesOf(d, gi)) insts.push(x); });
  // Meshes; vertex offsets in the global particle arrays.
  let n = 0;
  for (const it of insts) {
    it.mesh = pieceMesh(it.piece, { h: it.piece.meta?.band ? Math.min(h, 1.6) : h });
    it.start = n;
    n += it.mesh.count;
  }
  // Overlays: meshed in their parent's frame.
  const ovs = [];
  drafts.forEach((d, gi) => {
    for (const ov of d.overlays || []) {
      for (const parent of insts.filter((it) => it.garment === gi && it.base.id === ov.on && (ov.side === 'both' || ov.side === it.side || it.side === 'C'))) {
        let piece = ov.piece;
        if (parent.side === 'L') piece = mirrorPiece(piece, 0);
        else if (parent.side === 'C' && ov.side === 'L' && parent.piece.meta?.fold) {
          const [fa, fb] = parent.piece.meta.fold;
          void fa; void fb;
        }
        const it = { piece, side: parent.side, base: { id: ov.id }, garment: gi, overlay: ov, parent, material: ov.material };
        it.mesh = pieceMesh(piece, { h: Math.min(h, 1.5) });
        it.start = n;
        n += it.mesh.count;
        ovs.push(it);
      }
    }
  });
  // Imported patterns: the orientation of every placed piece (which side of its box faces the centre) is chosen so
  // that the most edges meet edges of other pieces where they are wrapped.
  drafts.forEach((d, gi) => { if (d.info?.autoSew) orientImported(rig, drafts, gi, insts.filter((it) => it.garment === gi)); });
  const cloth = createCloth(n);
  cloth.collider = collider;
  const p = cloth.pos;
  // Layers: rank of the stacking layer within the outfit; offsets grow outwards.
  const layerRank = (gi, layer) => gi * 4 + (layer === 'lining' ? 0 : layer === 'shell' || layer === 'band' || layer === 'placket' ? 1 : 2);
  const offsetOf = (gi, layer) => 0.35 + gi * 0.2 + (layer === 'lining' ? 0 : 0.25);
  for (const it of insts) {
    const layer = it.piece.layer || 'shell';
    const off = offsetOf(it.garment, layer);
    it.offset = off;
    const map = arranger(rig, it.piece, it.side, off, drafts, it.garment);
    it.map = map;
    const fab = fabricFor(it.garment, it.piece.material);
    const sp = simParams(fab);
    it.fabric = fab;
    const stiff = drafts[it.garment].stiffen?.[it.base.id] || 1;
    const m = it.mesh;
    // Lumped masses from the triangle areas.
    const mass = new Float64Array(m.count);
    for (let k = 0; k < m.tris.length; k += 3) {
      const [a, b, c] = [m.tris[k], m.tris[k + 1], m.tris[k + 2]];
      const ar = Math.abs((m.xy[b * 2] - m.xy[a * 2]) * (m.xy[c * 2 + 1] - m.xy[a * 2 + 1]) - (m.xy[b * 2 + 1] - m.xy[a * 2 + 1]) * (m.xy[c * 2] - m.xy[a * 2])) / 2;
      for (const v of [a, b, c]) mass[v] += (ar * sp.density) / 3;
    }
    for (let v = 0; v < m.count; v++) {
      const q = map([m.xy[v * 2], m.xy[v * 2 + 1]]);
      const g = it.start + v;
      p[g * 3] = q[0]; p[g * 3 + 1] = q[1]; p[g * 3 + 2] = q[2];
      cloth.invMass[g] = mass[v] > 0 ? 1 / mass[v] : 0;
      cloth.offset[g] = off + sp.thickness;
      cloth.layer[g] = layerRank(it.garment, layer);
      cloth.friction[g] = clamp(sp.friction * 0.8, 0.1, 0.9);
    }
    addMeshConstraints(cloth, it, sp, stiff);
  }
  // Linings are sewn to their shell all round (hems, armholes, the facing): every boundary vertex of a lining is held
  // to the shell at the same pattern coordinates (linings are drafted in their shell's frame), a layer apart.
  for (const it of insts) {
    const of = it.piece.meta?.liningOf;
    if (!of) continue;
    const shell = insts.find((x) => x.garment === it.garment && x.base.id === of && x.side === it.side);
    if (!shell) continue;
    for (let v = 0; v < it.mesh.boundary; v++) {
      const hit = locate(shell.mesh, it.mesh.xy[v * 2], it.mesh.xy[v * 2 + 1]);
      if (hit) cloth.addTriAttach(it.start + v, shell.start + hit.t[0], shell.start + hit.t[1], shell.start + hit.t[2], hit.w[0], hit.w[1], hit.w[2], 1e-6, Math.max(0.15, shell.offset - it.offset));
    }
  }
  for (const it of ovs) {
    const par = it.parent;
    const lift = it.overlay.lift ?? 0.3;
    const fab = fabricFor(it.garment, it.material);
    const sp = simParams(fab);
    it.fabric = fab;
    it.offset = par.offset + lift;
    const map = arranger(rig, par.piece, par.side, par.offset + lift, drafts, it.garment);
    it.map = map;
    const m = it.mesh;
    for (let v = 0; v < m.count; v++) {
      const q = map([m.xy[v * 2], m.xy[v * 2 + 1]]);
      const g = it.start + v;
      p[g * 3] = q[0]; p[g * 3 + 1] = q[1]; p[g * 3 + 2] = q[2];
      cloth.invMass[g] = 1 / Math.max(1e-4, (h * h * 0.5) * sp.density);
      cloth.offset[g] = par.offset + lift + sp.thickness;
      cloth.layer[g] = layerRank(it.garment, 'collar');
      cloth.friction[g] = 0.6;
    }
    addMeshConstraints(cloth, it, sp, 1.5);
    // Attach: vertices on the attached edges (all vertices when no list) to the parent's surface under them.
    const attachIds = it.overlay.attach;
    const verts = new Set();
    if (!attachIds) for (let v = 0; v < m.count; v++) verts.add(v);
    else for (const id of attachIds) for (const v of m.edges[id] || []) verts.add(v);
    for (const v of verts) {
      const hit = locate(par.mesh, m.xy[v * 2], m.xy[v * 2 + 1]);
      if (!hit) continue;
      cloth.addTriAttach(it.start + v, par.start + hit.t[0], par.start + hit.t[1], par.start + hit.t[2], hit.w[0], hit.w[1], hit.w[2], 2e-7, lift);
      // Attached vertices follow their parent: they take its layer, so the layering does not push them off it.
      cloth.layer[it.start + v] = cloth.layer[par.start + hit.t[0]];
    }
  }
  // Seams.
  let seamCount = 0;
  drafts.forEach((d, gi) => { if (d.info?.autoSew) seamCount += autoSew(cloth, insts.filter((it) => it.garment === gi)); });
  drafts.forEach((d, gi) => {
    for (const s of d.seams) {
      const pairs = s.sides === 'center' ? [['R', 'L']] : s.sides === 'single' ? [['R', 'R']] : [['R', 'R'], ['L', 'L']];
      for (const [sa, sb] of pairs) {
        const A = sidePath(insts, gi, s.a, sa), B = sidePath(insts, gi, s.b, sb);
        if (!A || !B || A.len < 0.5 || B.len < 0.5) continue;
        // Skip a duplicate centre pass on a single opened piece (the same edge on both sides).
        if (A.verts[0] === B.verts[0] && A.verts.length === B.verts.length && A.verts.every((v, i) => v === B.verts[i])) continue;
        sew(cloth, A, B, s.openEnd || 0, s.openStart || 0);
        sew(cloth, B, A, s.openEnd || 0, s.openStart || 0);
        seamCount++;
      }
    }
    // Closures: the right and left fronts pinned together at the button positions.
    for (const cl of d.closures || []) {
      const R = insts.find((it) => it.garment === gi && it.base.id === cl.piece && it.side === 'R'), L = insts.find((it) => it.garment === gi && it.base.id === cl.piece && it.side === 'L');
      if (!R || !L) continue;
      const vr = nearest(R.mesh, cl.p[0], cl.p[1]), vl = nearest(L.mesh, -cl.p[0], cl.p[1]);
      if (vr >= 0 && vl >= 0) cloth.addDistance(R.start + vr, L.start + vl, 0.4, 0);
    }
    for (const pin of d.pins || []) {
      for (const it of insts.filter((x) => x.garment === gi && x.base.id === pin.piece)) {
        const v = nearest(it.mesh, it.side === 'L' ? -pin.p[0] : pin.p[0], pin.p[1]);
        if (v >= 0) cloth.pin(it.start + v, [p[(it.start + v) * 3], p[(it.start + v) * 3 + 1], p[(it.start + v) * 3 + 2]]);
      }
    }
  });
  // Buttons follow a vertex of their piece.
  const buttons = [];
  drafts.forEach((d, gi) => {
    for (const b of d.buttons || []) {
      for (const it of insts.filter((x) => x.garment === gi && x.base.id === b.piece && (b.side === 'both' || x.side === b.side || x.side === 'C'))) {
        const v = nearest(it.mesh, it.side === 'L' ? -b.p[0] : b.p[0], b.p[1]);
        if (v >= 0) buttons.push({ vertex: it.start + v, d: b.d || 1.5, garment: gi, offset: 0.25 });
      }
    }
  });
  // Outward faces: triangles wind so that their normals point away from the body (mirrored halves wind the other way
  // round in 3D). Decided per instance by sampling which side of its triangles is farther from the body; pieces away
  // from the body (a tote) keep the right half's winding and flip the mirrored half.
  for (const it of [...insts, ...ovs]) {
    const T = it.mesh.tris;
    let vote = 0;
    const step = Math.max(3, Math.floor(T.length / 3 / 40) * 3);
    for (let k = 0; k + 2 < T.length; k += step) {
      const a = (it.start + T[k]) * 3, b = (it.start + T[k + 1]) * 3, c = (it.start + T[k + 2]) * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      const dOut = collider.signedDistance(cx + nx, cy + ny, cz + nz), dIn = collider.signedDistance(cx - nx, cy - ny, cz - nz);
      if (Number.isFinite(dOut) && Number.isFinite(dIn)) vote += dOut > dIn ? 1 : -1;
    }
    const flip = vote < 0 || (vote === 0 && it.side === 'L');
    if (it.overlay) it.flip = it.parent.flip ?? flip; else it.flip = flip;
    if (it.flip) for (let k = 0; k + 2 < T.length; k += 3) { const t = T[k + 1]; T[k + 1] = T[k + 2]; T[k + 2] = t; }
  }
  const instances = [...insts, ...ovs].map((it) => ({
    id: `${it.garment}:${it.base.id}:${it.side}`, garment: it.garment, pieceId: it.base.id, side: it.side, start: it.start, count: it.mesh.count,
    tris: Uint32Array.from(it.mesh.tris, (v) => v + it.start), xy: it.mesh.xy, material: it.overlay ? it.material : it.piece.material, layer: it.overlay ? it.overlay.layer : it.piece.layer,
    overlay: !!it.overlay, fabric: it.fabric, piece: it.piece,
  }));
  return { cloth, collider, instances, buttons, stats: { particles: n, seams: seamCount, overlays: ovs.length, instances: insts.length } };
}

// Rest lengths come from the flat 2D pattern, so the simulated garment tends to its cut shape; fabric parameters map
// to compliances (softer fabric = larger compliance). Bending compliance scales with 1 / stiff^2 for stiffened parts.
function addMeshConstraints(cloth, it, sp, stiff) {
  const m = it.mesh, xy = m.xy;
  const len = (a, b) => Math.hypot(xy[b * 2] - xy[a * 2], xy[b * 2 + 1] - xy[a * 2 + 1]);
  const sc = sp.stretchCompliance * 0.3;
  for (const [a, b] of meshEdges(m.tris)) cloth.addDistance(it.start + a, it.start + b, len(a, b), sc);
  const bc = (sp.bendCompliance * 0.004) / (stiff * stiff);
  for (const [c, d] of bendPairs(m.tris)) cloth.addDistance(it.start + c, it.start + d, len(c, d), bc);
}

// Triangle of a mesh containing a 2D point (or the nearest one), with barycentric weights.
// Barycentric point location by brute force; a point slightly outside every triangle (rounding at the outline) is
// accepted up to a total negative weight of 0.6 and clamped back into the nearest triangle.
function locate(mesh, x, y) {
  let best = null, bd = Infinity;
  for (let k = 0; k < mesh.tris.length; k += 3) {
    const a = mesh.tris[k], b = mesh.tris[k + 1], c = mesh.tris[k + 2];
    const ax = mesh.xy[a * 2], ay = mesh.xy[a * 2 + 1], bx = mesh.xy[b * 2], by = mesh.xy[b * 2 + 1], cx = mesh.xy[c * 2], cy = mesh.xy[c * 2 + 1];
    const D = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(D) < 1e-12) continue;
    const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / D, w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / D, w2 = 1 - w0 - w1;
    const out = Math.max(0, -w0) + Math.max(0, -w1) + Math.max(0, -w2);
    if (out < bd) { bd = out; best = { t: [a, b, c], w: [w0, w1, w2] }; if (out === 0) break; }
  }
  if (!best || bd > 0.6) return null;
  const w = best.w.map((v) => Math.max(0, v));
  const s = w[0] + w[1] + w[2] || 1;
  return { t: best.t, w: w.map((v) => v / s) };
}

function nearest(mesh, x, y) {
  let best = -1, bd = Infinity;
  for (let v = 0; v < mesh.count; v++) { const d = (mesh.xy[v * 2] - x) ** 2 + (mesh.xy[v * 2 + 1] - y) ** 2; if (d < bd) { bd = d; best = v; } }
  return bd < 16 ? best : -1;
}

// One side of a seam on instances: the boundary vertex sequence (global indices) with its cumulative 2D arc length.
function sidePath(insts, gi, path, side) {
  const verts = [], arc = [];
  let L = 0;
  for (const [pid, base, rev, s0, s1] of path) {
    const inst = insts.find((it) => it.garment === gi && it.base.id === pid && (it.side === side || it.side === 'C'));
    if (!inst) return null;
    const ids = chainIds(inst, base, side);
    if (!ids.length) return null;
    let run = [];
    for (const id of ids) run.push(inst.mesh.edges[id] || []);
    // Left halves are mirror images: their outlines run the other way round. Read them in the right half's direction
    // so that both sides of every seam (and the two halves of a centre seam) correspond point by point.
    if (side === 'L') run = run.reverse().map((vs) => vs.slice().reverse());
    // Positions along the item (gaps between the parts of a chain - dart mouths - have no length).
    let item = [];
    let acc = 0;
    for (const vs of run) {
      vs.forEach((v, k) => {
        if (k > 0) acc += Math.hypot(inst.mesh.xy[v * 2] - inst.mesh.xy[vs[k - 1] * 2], inst.mesh.xy[v * 2 + 1] - inst.mesh.xy[vs[k - 1] * 2 + 1]);
        item.push([inst.start + v, acc]);
      });
    }
    if (s0 != null || s1 != null) item = item.filter(([, a]) => a >= (s0 ?? 0) - 1e-6 && a <= (s1 ?? Infinity) + 1e-6).map(([v, a]) => [v, a - (s0 ?? 0)]);
    if (!item.length) continue;
    const total = item[item.length - 1][1];
    if (rev) item = item.reverse().map(([v, a]) => [v, total - a]);
    for (const [v, a] of item) { verts.push(v); arc.push(L + a); }
    L += total;
  }
  return verts.length ? { verts, arc, len: L } : null;
}

// Ends of the sewable edges of instances where an arrangement puts them (no meshes needed).
function edgeEnds(rig, drafts, gi, insts) {
  const out = [];
  for (const it of insts) {
    const map = arranger(rig, it.piece, it.side, 0.5, drafts, gi);
    for (const e of it.piece.edges) {
      if (e.kind === 'hem' || e.kind === 'dart' || e.kind === 'fold') continue;
      const L = e.pts.reduce((s, q, k) => (k ? s + Math.hypot(q[0] - e.pts[k - 1][0], q[1] - e.pts[k - 1][1]) : 0), 0);
      if (L < 3) continue;
      out.push({ it, len: L, a: map(e.pts[0]), b: map(e.pts[e.pts.length - 1]), top: atTop(it.piece, e) });
    }
  }
  return out;
}
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Does an edge lie along the top of its piece (within 8 cm of the top of its box)? Shoulders do.
const atTop = (piece, e) => { const b = piece.arrange?.box; return !!b && Math.max(...e.pts.map((q) => q[1])) - b[1] < 8; };

// Which edges of an imported pattern are sewn together: candidate pairs of edges { a, b (3D ends), len, it } -
// near ones (ends within 6 cm, lengths within 25 %), far ones of nearly the same length (within 30 cm and 8 %: a
// shoulder of the front meets the back's over the top of the body; only between torso pieces), an edge with another
// edge of its own piece where they lie together (a sleeve's underarm seam) or share an apex (a dart) - then picked greedily, best first. Returns [[i, j, reversed]].
function matchEdges(sides) {
  const cand = [];
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const A = sides[i], B = sides[j];
      const dl = Math.abs(A.len - B.len) / Math.max(A.len, B.len);
      if (dl > 0.25 || Math.min(A.len, B.len) < 3) continue;
      const same = Math.max(d3(A.a, B.a), d3(A.b, B.b)), cross = Math.max(d3(A.a, B.b), d3(A.b, B.a));
      const d = Math.min(same, cross);
      const own = A.it === B.it;
      // a dart: two edges of one piece that share their apex end
      const apex = Math.min(d3(A.a, B.a), d3(A.b, B.b), d3(A.a, B.b), d3(A.b, B.a)) < 0.6;
      // far pairs only over the top of the torso (shoulders); the top of skirts and trousers is their waist
      const torso = /^torso/.test(A.it.piece.arrange?.place || '') && /^torso/.test(B.it.piece.arrange?.place || '');
      if (own ? !(d < 2 || (apex && d < 8)) : !(d < 6 || (torso && A.top && B.top && d < 30 && dl < 0.08))) continue;
      cand.push({ i, j, rev: cross < same, score: d + 60 * dl });
    }
  }
  cand.sort((x, y) => x.score - y.score);
  const used = new Set(), out = [];
  for (const c of cand) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i); used.add(c.j);
    out.push([c.i, c.j, c.rev, c.score]);
  }
  return { pairs: out, used };
}
// How well the edges of an arrangement meet: matched pairs, the closer the better.
function meetScore(ends) {
  return matchEdges(ends).pairs.reduce((s, [, , , sc]) => s + Math.max(0.5, 40 - sc), 0);
}
function orientImported(rig, drafts, gi, insts) {
  const arr = [...new Set(insts.filter((it) => it.piece.arrange?.mode === 'wrap').map((it) => it.piece.arrange))].slice(0, 8);
  if (!arr.length) return;
  const start = arr.map((a) => !!a.flip);
  let best = -1, bestMask = 0;
  for (let mask = 0; mask < 1 << arr.length; mask++) {
    arr.forEach((a, k) => { a.flip = start[k] !== !!((mask >> k) & 1); });
    const sc = meetScore(edgeEnds(rig, drafts, gi, insts));
    if (sc > best + 1e-6) { best = sc; bestMask = mask; }
  }
  arr.forEach((a, k) => { a.flip = start[k] !== !!((bestMask >> k) & 1); });
}

// Imported patterns have no seam list: the edges paired by matchEdges are sewn (side seams, shoulders, sleeve seams,
// centre seams of pairs), then every edge left over against two that continue each other (a sleeve cap against the
// front and back armholes). Returns the number of seams.
function autoSew(cloth, insts) {
  const p = cloth.pos;
  const at = (v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];
  const sides = [];
  for (const it of insts) {
    for (const e of it.piece.edges) {
      if (e.kind === 'hem' || e.kind === 'dart' || e.kind === 'fold') continue;
      const vs = it.mesh.edges[e.id];
      if (!vs || vs.length < 2) continue;
      const verts = vs.map((v) => it.start + v), arc = [0];
      for (let k = 1; k < vs.length; k++) arc.push(arc[k - 1] + Math.hypot(it.mesh.xy[vs[k] * 2] - it.mesh.xy[vs[k - 1] * 2], it.mesh.xy[vs[k] * 2 + 1] - it.mesh.xy[vs[k - 1] * 2 + 1]));
      sides.push({ it, verts, arc, len: arc[arc.length - 1], a: at(verts[0]), b: at(verts[verts.length - 1]), top: atTop(it.piece, e) });
    }
  }
  const part = (S, r) => (r ? { verts: S.verts.slice().reverse(), arc: S.arc.map((x) => S.len - x).reverse(), len: S.len } : S);
  const { pairs, used } = matchEdges(sides);
  let n = 0;
  for (const [i, j, rev] of pairs) {
    const A = sides[i], B = part(sides[j], rev);
    sew(cloth, A, B, 0, 0);
    sew(cloth, B, A, 0, 0);
    n++;
  }
  for (let i = 0; i < sides.length; i++) {
    if (used.has(i)) continue;
    const A = sides[i];
    let pick = null, pd = 10;
    for (let j = 0; j < sides.length; j++) {
      if (j === i || used.has(j) || sides[j].it === A.it) continue;
      for (let k = 0; k < sides.length; k++) {
        if (k === i || k === j || used.has(k) || sides[k].it === A.it) continue;
        const B1 = sides[j], B2 = sides[k];
        if (Math.abs(A.len - (B1.len + B2.len)) > 0.25 * A.len) continue;
        for (const r1 of [false, true]) for (const r2 of [false, true]) {
          const s1 = r1 ? B1.b : B1.a, e1 = r1 ? B1.a : B1.b, s2 = r2 ? B2.b : B2.a, e2 = r2 ? B2.a : B2.b;
          const dd = Math.max(d3(A.a, s1), d3(e1, s2), d3(e2, A.b));
          if (dd < pd) { pd = dd; pick = [j, k, r1, r2]; }
        }
      }
    }
    if (!pick) continue;
    const [j, k, r1, r2] = pick;
    used.add(i); used.add(j); used.add(k);
    const P1 = part(sides[j], r1), P2 = part(sides[k], r2);
    const B = { verts: [...P1.verts, ...P2.verts], arc: [...P1.arc, ...P2.arc.map((x) => x + P1.len)], len: P1.len + P2.len };
    sew(cloth, A, B, 0, 0);
    sew(cloth, B, A, 0, 0);
    n++;
  }
  return n;
}

// Every vertex of A to the point of B at the same fraction of the length.
// Arc-length parametrisation: each vertex of A is tied to the point at the same fraction of B's length, so edges of
// different lengths (eased seams) spread the extra fabric evenly and different mesh resolutions still match.
function sew(cloth, A, B, openEnd, openStart = 0) {
  for (let k = 0; k < A.verts.length; k++) {
    const f = A.arc[k] / A.len;
    if ((openEnd && A.arc[k] > A.len - openEnd) || (openStart && A.arc[k] < openStart)) continue;
    const s = f * B.len;
    let j = 1;
    while (j < B.arc.length - 1 && B.arc[j] < s) j++;
    const seg = B.arc[j] - B.arc[j - 1];
    const t = seg > 1e-9 ? clamp((s - B.arc[j - 1]) / seg, 0, 1) : 0;
    if (A.verts[k] === B.verts[j - 1] || A.verts[k] === B.verts[j]) continue;
    cloth.addSew(A.verts[k], B.verts[j - 1], B.verts[j], t, 0, 0);
  }
}

export { stackIndex };
