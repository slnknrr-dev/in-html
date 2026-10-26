// textile-studio/compute.js - everything derived from the project, memoised by what it depends on: the rig and the
// measurements of the body, the drafts of the outfit, the nearest size, the preview spec of the 3D view with two
// signatures (geometry: re-drape; textures: repaint the same drape), decoded artwork.
//
// Design rules of this module:
// - Pure functions of the project p (an immutable snapshot from state.js history): the same p always gives the same
//   result, so memoisation by a key built from the inputs is safe. Never mutate p or a cached result: callers share it.
// - Keys are JSON.stringify of exactly the inputs the computation reads. Too few inputs -> stale drafts after an edit
//   (the classic memo bug); too many -> needless recomputation (e.g. a colour change must not re-draft the pattern).
//   The cost of stringify (microseconds to a millisecond) is negligible next to drafting / nesting (tens of ms).
// - Why not a WeakMap keyed by p: every commit creates a new p (structured copy), so identity never repeats across
//   edits, while most derived values (the rig) depend on a small unchanged part of it. Content keys hit; identity misses.

import { buildRig } from '../body/body.js';
import { draftMeasurements, measureBody } from '../body/measure.js';
import { nearestSize } from '../body/sizes.js';
import { draftGarment } from '../garment/garments.js';
import { layerThickness, outfitLayers } from '../garment/layers.js';
import { outfitUsage } from '../garment/usage.js';
import { normalizeFabric } from '../fabric/fabric.js';
import { defaultFabric } from '../mockup/preview.js';

// One bounded cache for all derived values. Eviction is FIFO by insertion order (Map iterates in insertion order),
// not LRU: a hit does not refresh the entry. Good enough here because the working set per edit is small (rig,
// measurements, a few drafts); 60 entries bound memory when the user scrubs a slider through many values.
const memo = new Map();
const cached = (key, fn) => {
  if (memo.has(key)) return memo.get(key);
  const v = fn();
  memo.set(key, v);
  if (memo.size > 60) memo.delete(memo.keys().next().value);
  return v;
};

// The rig (skeleton + body shape) and both measurement sets depend only on p.body. Separate prefixes ('rig:', 'm:',
// 'dm:') keep the three values apart under the same body key. measureBody: what a tape on the body reads (shown in
// the panel); draftMeasurements: the set the drafting formulas consume (with ease conventions of garment/*).
export const rigOf = (p) => cached('rig:' + JSON.stringify(p.body), () => buildRig(p.body));
export const measurementsOf = (p) => cached('m:' + JSON.stringify(p.body), () => measureBody(rigOf(p)));
export const draftMOf = (p) => cached('dm:' + JSON.stringify(p.body), () => draftMeasurements(rigOf(p)));
// Not memoised: nearestSize is a cheap table lookup over already memoised measurements.
export const sizeOf = (p) => nearestSize(measurementsOf(p), p.body.sex, p.view.sizeSystem || 'EU', p.body.age);

// The layers of the outfit: what each garment is worn over (thickness from its fabrics, or the garment's override).
export function layersOf(p) {
  const specs = p.outfit.map((g) => ({ garment: g.garment, opts: g.opts, details: g.details }));
  // mm(i) curries the garment index so outfitLayers can ask for any material's thickness lazily; only the materials a
  // garment really has are looked up.
  const mm = (i) => (mat) => fabricOf(p, i, mat).props.thickness;
  return cached('L:' + JSON.stringify([specs, p.outfit.map((g) => [g.fabrics, g.thickness])]), () => outfitLayers(specs, mm, (i) => p.outfit[i].thickness ?? null));
}

// Thickness of a garment (cm): the override, or what its shell, lining and insulation make.
export function thicknessOf(p, i = p.active) {
  const g = p.outfit[i];
  return g.thickness ?? layerThickness({ garment: g.garment, opts: g.opts, details: g.details }, (mat) => fabricOf(p, i, mat).props.thickness);
}

export function draftOf(p, i = p.active) {
  const g = p.outfit[i];
  // A missing garment returns null instead of throwing: callers during a transient state (outfit just shortened, active
  // index not yet clamped by normalizeProject) must survive.
  // The key includes the layers UNDER this garment: a jacket over a thick sweater is drafted with more room, so editing
  // an inner garment must re-draft the outer ones.
  if (!g) return null;
  const under = layersOf(p)[i] || [];
  return cached('d:' + JSON.stringify([p.body, g.garment, g.opts, g.details, under, g.edits, g.imported]), () => draftGarment({ garment: g.garment, opts: g.opts, details: g.details, under, edits: g.edits, imported: g.imported }, draftMOf(p)));
}

// Material usage of the whole outfit on the project's fabric width (memoised: nesting takes a moment).
// Every draft goes in (index i labels the garment in the CSV). fabricWidth default 150 cm: the common bolt width.
export function usageOf(p) {
  const drafts = p.outfit.map((_, i) => draftOf(p, i));
  const key = 'U:' + JSON.stringify([p.body, p.outfit.map((g) => [g.garment, g.opts, g.details, g.thickness, g.edits, g.imported]), p.view.fabricWidth || 150]);
  return cached(key, () => outfitUsage(drafts, { width: p.view.fabricWidth || 150 }, (i) => String(i + 1)));
}

// Materials used by a garment's pieces and overlays, shell first.
// Set keeps first-insertion order, so 'shell' is always first: the fabric panel opens on the main fabric.
export function materialsOf(p, i = p.active) {
  const d = draftOf(p, i);
  const set = new Set(['shell']);
  for (const x of d.pieces) set.add(x.material);
  for (const o of d.overlays) set.add(o.material);
  return [...set];
}

// Fabric of a material slot: the user's choice, else a rib matching the shell colour (cuffs and hems of a knit
// garment should not default to a contrasting grey), else the template's default. normalizeFabric fills every
// physical property, so callers can read f.props.* without guards.
export function fabricOf(p, i, material) {
  const g = p.outfit[i];
  const raw = g.fabrics[material] || (material === 'rib' && g.fabrics.shell?.color ? { preset: 'rib', color: g.fabrics.shell.color } : defaultFabric(g.garment, material));
  return normalizeFabric(raw);
}

// Mesh spacing (cm) and solver substeps of the drape qualities: the draft is coarser and takes fewer substeps.
const QUALITY = { draft: 4, normal: 3, fine: 2.2 };
const SUBSTEPS = { draft: 8, normal: 12, fine: 12 };

// The preview spec of the project and its two signatures:
//   geo - everything that changes the SHAPE of the drape (body, cut, mesh spacing, the mechanical fabric props:
//         weight, bending, stretch, thickness, friction). A change here re-runs the cloth simulation (seconds).
//   tex - everything that changes only the LOOK (colours, prints, placements, image set, thread zoom). A change here
//         repaints textures on the existing drape (milliseconds).
// Splitting them is the main perf decision of the 3D view: recolouring a jacket must not re-drape it. A property
// wrongly placed only in tex would leave a stale drape; wrongly placed in geo costs a needless re-simulation.
// Two-garment outfits get more frames (200 vs 160): layered cloth needs longer to settle against the inner layer.
// The preview spec of the project and its signatures.
export function previewOf(p) {
  const spec = {
    body: p.body, showBody: true, bodyColor: '#d8c8b4',
    garments: p.outfit.map((g, i) => ({
      garment: g.garment, opts: g.opts, details: g.details, design: g.design, designOn: g.designOn, placements: g.placements, thickness: g.thickness ?? null, edits: g.edits, imported: g.imported,
      fabrics: Object.fromEntries(materialsOf(p, i).map((mat) => [mat, fabricOf(p, i, mat)])),
    })),
    sim: { frames: p.outfit.length > 1 ? 200 : 160, h: QUALITY[p.view.quality] || 3, substeps: SUBSTEPS[p.view.quality] || 12 },
  };
  const geo = JSON.stringify([p.body, p.outfit.map((g) => [g.garment, g.opts, g.details, g.thickness, g.edits, g.imported]), spec.sim.h, spec.garments.map((g) => Object.values(g.fabrics).map((f) => [f.props.gsm, f.props.bending, f.props.stretchWarp, f.props.stretchWeft, f.props.thickness, f.props.friction]))]);
  const tex = JSON.stringify([spec.garments.map((g) => [g.fabrics, g.design, g.designOn, g.placements]), Object.keys(p.images), p.view.threadZoom]);
  return { spec, geo, tex };
}

// Decoded artwork for the texture builder (RGBA), cached by image id.
// Decoded RGBA per image id, outside the memo: images are immutable once added (a new upload gets a new uid), so
// the id alone is a correct key and decoding (slow, async) happens once. Failures are cached as null so a broken
// image is not re-decoded on every render. Downscaled to at most 1024 px on the long side: the texture builder
// samples at cloth resolution, full-size photos would only cost memory (w*h*4 bytes).
const decoded = new Map();
export async function imagesOf(p) {
  const out = {};
  for (const [id, im] of Object.entries(p.images)) {
    if (!decoded.has(id)) {
      try {
        // img.decode() waits for the bitmap; drawing before decode would draw nothing (blank texture) on a slow decode.
        const img = new Image();
        img.src = im.src;
        await img.decode();
        const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height);
        decoded.set(id, { width: d.width, height: d.height, data: d.data });
      } catch { decoded.set(id, null); }
    }
    if (decoded.get(id)) out[id] = decoded.get(id);
  }
  return out;
}
