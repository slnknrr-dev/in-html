// mockup/preview.js - "this garment with this print on this body" from one serialisable spec: the body, the outfit
// (garment templates, their options and details, a fabric per material slot, a repeat print and placement prints),
// the view and the simulation settings. The pipeline is body -> measurements -> drafts -> assembled cloth -> drape ->
// textures -> scene, and the scene renders with the software renderer (Node, no WebGL) or the WebGL renderer
// (mockup/embed.js). A drape can be baked into the spec, so a page that embeds a preview shows it at once.
//
//   DEFAULT_SPEC, normalizePreviewSpec(spec), defaultFabric(garment, material)
//   prepare(spec) -> prep { spec, rig, drafts, sim, fabricFor }   simulate(prep, frames)   coolDown(prep, frames)
//   buildScene(prep, { images }) -> { meshes, shadow }           cameraFor(prep, view)
//   renderPreview(spec, { images, views: [yaw, ...], width, height, ss }) -> [{ width, height, data }]
//   bakeDrape(prep) -> { n, positions (base64 of Float32 LE) }    applyDrape(prep, baked)
//
// Determinism contract: prepare(spec) is a pure function of the spec (no randomness, no time), so a drape baked on
// one machine applies to the same spec elsewhere; applyDrape checks the vertex count and refuses mismatches instead
// of producing a torn mesh.

import { bodyFromPreset, buildRig, normalizeBody, BODY_PRESETS } from '../body/body.js';
import { bodyMesh } from '../body/mesh.js';
import { draftMeasurements } from '../body/measure.js';
import { draftGarment, GARMENTS, OUTFITS } from '../garment/garments.js';
import { outfitLayers } from '../garment/layers.js';
import { normalizeFabric, MATERIAL_DEFAULTS } from '../fabric/fabric.js';
import { normalizeDesign, normalizePlacement } from '../motif/repeat.js';
import { assemble } from '../cloth/assemble.js';
import { computeNormals, orbitCamera } from '../view3d/math.js';
import { renderSoft } from '../view3d/soft.js';
import { pieceTexture } from './texture.js';

export const DEFAULT_SPEC = {
  v: 1,
  body: { preset: 'female-m' },
  garments: [{ garment: 'tshirt', opts: {}, fabrics: { shell: { preset: 'jersey', color: '#f4f4f2' } }, design: null, placements: [] }],
  view: { yaw: 0, pitch: 0.06, zoom: 1, width: 480, height: 640, background: ['#eef0f4', '#cdd2da'] },
  sim: { frames: 150, h: 3 },
  showBody: true, bodyColor: '#d8c8b4',
};

const KNIT = ['tshirt', 'longsleeve', 'tank'];
export function defaultFabric(garment, material) {
  if (material === 'shell') {
    if (KNIT.includes(garment)) return { preset: 'jersey' };
    if (garment === 'sweatshirt' || garment === 'hoodie') return { preset: 'frenchTerry' };
    if (garment === 'shirt') return { preset: 'poplin' };
    if (garment === 'tote') return { preset: 'cottonCanvas' };
    if (garment === 'dress' || garment === 'skirt') return { preset: 'linen', color: '#4a6a8a' };
    if (garment === 'cummerbund') return { preset: 'satin' };
    return { preset: 'suiting' };
  }
  return { preset: MATERIAL_DEFAULTS[material] || 'poplin' };
}

const hexRe = /^#[0-9a-f]{6}$/i;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Starts from a deep copy of DEFAULT_SPEC and copies only validated fields: garment ids must exist, counts and
// sizes are clamped (6 garments, 2048 px, 600 frames), so an embedded spec cannot stall the page.
export function normalizePreviewSpec(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = JSON.parse(JSON.stringify(DEFAULT_SPEC));
  if (r.body) s.body = typeof r.body === 'string' ? { preset: r.body } : r.body;
  let list = Array.isArray(r.garments) ? r.garments : r.outfit && OUTFITS[r.outfit] ? OUTFITS[r.outfit].map((x) => ({ garment: x.garment, opts: x.opts, details: x.details })) : s.garments;
  list = list.filter((g) => g && GARMENTS[g.garment]).slice(0, 6);
  if (!list.length) list = s.garments;
  s.garments = list.map((g) => ({
    garment: g.garment, opts: g.opts || {}, details: Array.isArray(g.details) ? g.details : null,
    fabrics: g.fabrics && typeof g.fabrics === 'object' ? g.fabrics : {},
    design: g.design ? normalizeDesign(g.design) : null, designOn: Array.isArray(g.designOn) ? g.designOn : null,
    placements: (Array.isArray(g.placements) ? g.placements : []).map(normalizePlacement),
    thickness: typeof g.thickness === 'number' && Number.isFinite(g.thickness) ? Math.max(0, Math.min(6, g.thickness)) : null,
    edits: g.edits && typeof g.edits === 'object' ? g.edits : null,
    imported: g.garment === 'imported' && g.imported && typeof g.imported === 'object' ? g.imported : null,
  }));
  s.view = { ...s.view, ...(r.view || {}) };
  s.view.width = Math.max(64, Math.min(2048, Math.round(num(s.view.width, 480))));
  s.view.height = Math.max(64, Math.min(2048, Math.round(num(s.view.height, 640))));
  s.sim = { frames: Math.max(0, Math.min(600, Math.round(num(r.sim?.frames, 150)))), h: Math.max(1.5, Math.min(6, num(r.sim?.h, 3))), substeps: Math.max(4, Math.min(20, Math.round(num(r.sim?.substeps, 12)))) };
  s.showBody = r.showBody !== false;
  if (hexRe.test(r.bodyColor)) s.bodyColor = r.bodyColor;
  s.drape = r.drape && typeof r.drape.positions === 'string' ? r.drape : null;
  return s;
}

function bodyOf(spec) {
  const b = spec.body || {};
  if (b.preset && BODY_PRESETS[b.preset]) return bodyFromPreset(b.preset, b);
  return normalizeBody(b);
}

export function prepare(rawSpec) {
  const spec = normalizePreviewSpec(rawSpec);
  const body = bodyOf(spec);
  const rig = buildRig(body);
  const m = draftMeasurements(rig);
  const fabricCache = new Map();
  // Memoised per garment index and material slot: the simulator and the texture builder ask repeatedly.
  const fabricFor = (gi, material) => {
    const key = gi + ':' + material;
    if (!fabricCache.has(key)) {
      const g = spec.garments[gi];
      // Rib trims of a knit take the colour of its shell unless they have their own fabric.
      const shellColor = g.fabrics.shell?.color;
      const spec2 = g.fabrics[material] || (material === 'rib' && shellColor ? { preset: 'rib', color: shellColor } : defaultFabric(g.garment, material));
      fabricCache.set(key, normalizeFabric(spec2));
    }
    return fabricCache.get(key);
  };
  // Layers: each garment is drafted with the room for the ones under it (their fabrics' thickness, or an override).
  const specs = spec.garments.map((g) => ({ garment: g.garment, opts: g.opts, details: g.details || undefined, edits: g.edits || undefined, imported: g.imported || undefined }));
  // Each garment is drafted with ease for the layers beneath it (their fabric thickness), so a jacket over a shirt
  // starts outside it rather than intersecting and relying on collisions to push it out.
  const under = outfitLayers(specs, (gi) => (mat) => fabricFor(gi, mat).props.thickness, (gi) => spec.garments[gi].thickness);
  const drafts = specs.map((g, gi) => draftGarment({ ...g, under: under[gi] }, m));
  // Placements on print areas: resolved to the area's piece and centre (offsets in x / y).
  spec.garments.forEach((g, gi) => { g.placements = g.placements.map((pl) => resolvePlacement(pl, drafts[gi])); });
  const sim = assemble(drafts, rig, { h: spec.sim.h, fabricFor });
  sim.cloth.substeps = spec.sim.substeps || 12;
  const prep = { spec, body, rig, m, drafts, sim, fabricFor };
  if (spec.drape) applyDrape(prep, spec.drape);
  return prep;
}

export function resolvePlacement(pl, draft) {
  const a = pl.area && draft.printAreas?.[pl.area];
  if (!a) return { ...pl, w: pl.w ?? 20 };
  return { ...pl, piece: a.piece, side: pl.side === 'C' && a.piece !== 'front' && a.piece !== 'back' ? 'C' : pl.side, x: a.center[0] + pl.x, y: a.center[1] + pl.y, w: pl.w ?? a.w * 0.8, area: pl.area };
}

export function simulate(prep, frames = prep.spec.sim.frames) {
  for (let f = 0; f < frames; f++) prep.sim.cloth.step(1 / 60);
  return prep.sim.cloth.stats();
}

// Settles the last motion: damping rises to stop the remaining vibration (used before screenshots).
// Ramping damping to 0.5 over a few frames removes residual jitter without visibly changing the drape; damping
// is restored afterwards so a later resume behaves normally.
export function coolDown(prep, frames = 30) {
  const c = prep.sim.cloth, d0 = c.damping;
  for (let f = 0; f < frames; f++) { c.damping = d0 + (0.5 - d0) * ((f + 1) / frames); c.step(1 / 60); }
  c.damping = d0;
}

// The scene of the renderers: the body, every garment piece (textured), buttons.
// One shared position / normal / uv buffer for all cloth pieces, one mesh per piece for its own texture. Textures
// are cached per piece by a JSON key of everything that affects them, so refresh() regenerates only what changed.
export function buildScene(prep, o = {}) {
  const { spec, sim, rig } = prep;
  const meshes = [];
  if (spec.showBody) {
    const bm = prep.bodyMesh || (prep.bodyMesh = bodyMesh(rig));
    meshes.push({ key: 'body', positions: bm.positions, normals: bm.normals, indices: bm.indices, color: hexRgb(spec.bodyColor), roughness: 0.75, sheen: 0.05, doubleSided: false });
  }
  const pos = sim.cloth.pos;
  const allTris = [];
  for (const it of sim.instances) allTris.push(it.tris);
  const idx = new Uint32Array(allTris.reduce((s, t) => s + t.length, 0));
  { let k = 0; for (const t of allTris) { idx.set(t, k); k += t.length; } }
  const normals = computeNormals(pos, idx, prep.normals);
  prep.normals = normals;
  const uvs = prep.uvs || (prep.uvs = new Float32Array((pos.length / 3) * 2));
  const texCache = prep.texCache || (prep.texCache = new Map());
  for (const it of sim.instances) {
    const g = spec.garments[it.garment];
    const fabric = it.fabric || prep.fabricFor(it.garment, it.material);
    const placements = g.placements.filter((pl) => pl.piece === it.pieceId && (pl.side === 'C' || pl.side === it.side || it.side === 'C'));
    const design = g.design && (!g.designOn || g.designOn.includes(it.material)) && it.material !== 'lining' ? g.design : null;
    const key = JSON.stringify([it.id, fabric, design, placements, o.threadZoom || 1, Object.keys(o.images || {})]);
    let tx = texCache.get(it.id);
    if (!tx || tx.key !== key) {
      tx = { key, ...pieceTexture(it, { fabric, design, placements, images: o.images, pxPerCm: o.pxPerCm || 6, threadZoom: o.threadZoom }) };
      texCache.set(it.id, tx);
    }
    uvs.set(tx.uv, it.start * 2);
    meshes.push({ key: it.id, positions: pos, normals, uvs, indices: it.tris, texture: tx.texture, color: [1, 1, 1], sheen: fabric.props.sheen, roughness: fabric.props.roughness, cull: it.layer === 'lining' ? 'front' : null, bias: it.garment * 0.8 });
  }
  // Buttons: small discs on their vertex, facing out.
  if (sim.buttons.length) {
    const bp = [], bi = [];
    for (const b of sim.buttons) {
      const i = b.vertex * 3, c = [pos[i], pos[i + 1], pos[i + 2]], nn = [normals[i], normals[i + 1], normals[i + 2]];
      // Orthonormal basis around the normal: cross with a reference axis that is not near-parallel to it (avoids a
      // degenerate cross product), then a second cross for the third axis. The disc is lifted off the cloth to avoid
      // z-fighting.
      const ref = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let u = [nn[1] * ref[2] - nn[2] * ref[1], nn[2] * ref[0] - nn[0] * ref[2], nn[0] * ref[1] - nn[1] * ref[0]];
      const ul = Math.hypot(...u) || 1; u = u.map((v) => v / ul);
      const w = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
      const base = bp.length / 3, r = b.d / 2, lift = 0.35;
      bp.push(c[0] + nn[0] * (lift + 0.15), c[1] + nn[1] * (lift + 0.15), c[2] + nn[2] * (lift + 0.15));
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        bp.push(c[0] + nn[0] * lift + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * r, c[1] + nn[1] * lift + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * r, c[2] + nn[2] * lift + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * r);
        bi.push(base, base + 1 + k, base + 1 + ((k + 1) % 12));
      }
    }
    const bpos = new Float32Array(bp), bidx = new Uint32Array(bi);
    meshes.push({ key: 'buttons', positions: bpos, normals: computeNormals(bpos, bidx), indices: bidx, color: hexRgb(o.buttonColor || '#2a2c31'), sheen: 0.6, roughness: 0.3 });
  }
  return { meshes, shadow: { center: [0, 0], radius: 34 } };
}

// Colours in the specs are sRGB hex; the renderers take sRGB triplets 0..1 (they linearize).
// Sharing one conversion keeps both renderers fed identical colours.
function hexRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); }

export function cameraFor(prep, view = prep.spec.view) {
  const H = prep.rig.H;
  const onlyBag = prep.spec.garments.every((g) => g.garment === 'tote') && !prep.spec.showBody;
  return orbitCamera({ target: onlyBag ? [0, H * 0.55, 26] : [0, H * 0.53, 0], distance: (H * 1.75) / (view.zoom || 1), yaw: view.yaw ?? 0, pitch: view.pitch ?? 0.06, fov: 0.6 });
}

/**
 * Renders a spec with the software renderer (works in Node): simulates when the spec has no baked drape, then one
 * image per requested yaw angle. opts: { images: { id: { width, height, data } }, views: [yaw], width, height, ss }
 */
export async function renderPreview(rawSpec, o = {}) {
  const prep = prepare(rawSpec);
  if (!prep.spec.drape) { simulate(prep); coolDown(prep); }
  const scene = buildScene(prep, o);
  const bg = (prep.spec.view.background || DEFAULT_SPEC.view.background).map(hexRgb);
  return (o.views || [prep.spec.view.yaw || 0]).map((yaw) => renderSoft(scene, cameraFor(prep, { ...prep.spec.view, yaw }), { width: o.width || prep.spec.view.width, height: o.height || prep.spec.view.height, ss: o.ss || 1, background: bg }));
}

// --- baked drapes ----------------------------------------------------------------------------------------------------

// Buffer in Node, chunked btoa in browsers (spreading a large array as arguments would overflow the stack).
const toB64 = (u8) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b, 'base64'));
  const s = atob(b), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
};

// Bytes of the Float32Array in platform order: little-endian on every current browser / Node platform, which the
// "LE" in the format relies on; a big-endian host would produce an unportable bake.
export function bakeDrape(prep) {
  const p = prep.sim.cloth.pos;
  return { n: prep.sim.cloth.n, positions: toB64(new Uint8Array(p.buffer, p.byteOffset, p.byteLength)) };
}

export function applyDrape(prep, baked) {
  const u = fromB64(baked.positions);
  if (baked.n !== prep.sim.cloth.n || u.byteLength !== baked.n * 12) return false;
  // slice() copies into a fresh, 4-byte aligned buffer: the decoded Uint8Array may sit at an unaligned offset of a
  // pooled Node Buffer, and Float32Array views require alignment.
  const f = new Float32Array(u.slice().buffer, 0, baked.n * 3);
  prep.sim.cloth.pos.set(f);
  prep.sim.cloth.prev.set(f);
  prep.sim.cloth.vel.fill(0);
  return true;
}
