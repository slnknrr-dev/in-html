// carpet/designs.js - the gallery of exclusive designs: named option sets for generateRug, from tradition classics to
// curated mash-ups where fractals and abstractions are layered into rug structures. A design is an ordinary set of
// options, so it opens, changes and shares like any rug.
//
//   DESIGNS [{ id, group: 'classic' | 'regional' | 'fractal', opts }]      designOpts(id) -> opts | null

// Data file. K() builds one composition layer: a generator type, its parameters, and layer options (roles = palette
// roles to paint with, blend = over | mask | outline | halo, sym, map/grid repetition, scale/opacity). Layers apply
// in order, so a 'mask' layer clips the layers that follow it.
const K = (type, params, rest = {}) => ({ type, params, ...rest });

export const DESIGNS = [
  { id: 'isfahanGarden', group: 'classic', opts: { tradition: 'persian', seed: 'isfahan-garden-7', field: 'medallion', palette: 'persian', widthCm: 170, lengthCm: 240, kpsi: 160 } },
  { id: 'shirvanNight', group: 'classic', opts: { tradition: 'caucasian', seed: 'shirvan-night-3', field: 'stacked', palette: 'persianNight', widthCm: 120, lengthCm: 200, kpsi: 81 } },
  { id: 'tekkeGuls', group: 'classic', opts: { tradition: 'turkmen', seed: 'tekke-12', widthCm: 200, lengthCm: 280, kpsi: 196 } },
  { id: 'mughalMillefleur', group: 'regional', opts: { tradition: 'indian', seed: 'agra-flowers-5', field: 'millefleur', palette: 'mughal', widthCm: 140, lengthCm: 210, kpsi: 225 } },
  { id: 'chaharBagh', group: 'regional', opts: { tradition: 'indian', seed: 'chahar-bagh-2', field: 'gardenPanels', palette: 'mughalIvory', widthCm: 160, lengthCm: 230, kpsi: 196 } },
  { id: 'cairoOctagon', group: 'regional', opts: { tradition: 'arabic', seed: 'cairo-octagon-15', field: 'mamluk', widthCm: 180, lengthCm: 270, kpsi: 100 } },
  { id: 'alhambraStars', group: 'regional', opts: { tradition: 'arabic', seed: 'alhambra-8', field: 'girih', palette: 'persianNight', widthCm: 160, lengthCm: 230, kpsi: 121 } },
  { id: 'atlasLozenges', group: 'regional', opts: { tradition: 'arabic', seed: 'atlas-snow-4', field: 'berber', widthCm: 200, lengthCm: 300, kpsi: 16, pileMm: 30 } },
  { id: 'medinaRags', group: 'regional', opts: { tradition: 'arabic', seed: 'medina-rags-9', field: 'boucherouite', widthCm: 120, lengthCm: 180, kpsi: 25, pileMm: 18 } },
  { id: 'usakStars', group: 'regional', opts: { tradition: 'turkish', seed: 'usak-stars-1', field: 'usakStar', widthCm: 170, lengthCm: 260, kpsi: 100 } },
  { id: 'lottoGold', group: 'regional', opts: { tradition: 'turkish', seed: 'lotto-gold-6', field: 'lotto', widthCm: 140, lengthCm: 200, kpsi: 121 } },
  { id: 'cintamaniPalace', group: 'regional', opts: { tradition: 'turkish', seed: 'topkapi-3', field: 'cintamani', palette: 'ottoman', widthCm: 150, lengthCm: 220, kpsi: 144 } },
  { id: 'vishapDragons', group: 'regional', opts: { tradition: 'armenian', seed: 'vishap-21', field: 'dragon', widthCm: 160, lengthCm: 260, kpsi: 81 } },
  { id: 'chelaberdEagles', group: 'regional', opts: { tradition: 'armenian', seed: 'chelaberd-1', field: 'eagle', widthCm: 140, lengthCm: 230, kpsi: 64 } },
  { id: 'arevakhach', group: 'regional', opts: { tradition: 'armenian', seed: 'arevakhach-8', field: 'eternity', palette: 'armenian', widthCm: 130, lengthCm: 190, kpsi: 81 } },
  { id: 'borjgaliSun', group: 'regional', opts: { tradition: 'georgian', seed: 'mzis-borjgali-7', field: 'borjgali', widthCm: 130, lengthCm: 200, kpsi: 64 } },
  { id: 'tushetiPardagi', group: 'regional', opts: { tradition: 'georgian', seed: 'omalo-5', field: 'tushetian', widthCm: 110, lengthCm: 190, kpsi: 36 } },
  { id: 'bolnisiCrosses', group: 'regional', opts: { tradition: 'georgian', seed: 'bolnisi-sioni-2', field: 'bolnisi', widthCm: 140, lengthCm: 210, kpsi: 81 } },
  { id: 'mandelbrotMedallion', group: 'fractal', opts: { tradition: 'mashup', seed: 'mandelbrot-medallion', field: 'plain', palette: 'saffronNight', widthCm: 150, lengthCm: 220, kpsi: 121, borderMotif: 'braid', layers: [
    K('girih', { tiling: 'octagon', size: 0.22, angle: 22.5, width: 0.035, rosette: 0.25 }, { roles: ['accent4', 'ground', 'border', 'accent2'], sym: 'mirrorXY' }),
    K('medallion', { size: 0.86, aspect: 1.25, shape: 1.3, lobes: 12, lobeDepth: 0.1, bands: 1, rim: 0, pendants: 1 }, { blend: 'mask' }),
    K('mandelbrot', { cx: -0.7, cy: 0, zoom: 1.35, iter: 90, bands: 6, cut: 2 }, { roles: ['border', 'accent1', 'accent2', 'accent3', 'light', 'accent4', 'outline'], sym: 'mirrorY' }),
    K('medallion', { size: 0.86, aspect: 1.25, shape: 1.3, lobes: 12, lobeDepth: 0.1, bands: 1, rim: 0, pendants: 1 }, { blend: 'outline', roles: ['accent1'] }),
  ] } },
  { id: 'sierpinskiKilim', group: 'fractal', opts: { tradition: 'anatolian', seed: 'sierpinski-kilim', field: 'kilim', widthCm: 120, lengthCm: 180, kpsi: 64, layers: [
    K('sierpinski', { depth: 4 }, { roles: ['accent1', 'ground', 'accent2', 'accent3', 'accent4'], map: 'grid', cols: 1, rows: 2, scale: 0.9, blend: 'over' }),
    K('sierpinski', { depth: 4 }, { roles: ['outline'], map: 'grid', cols: 1, rows: 2, scale: 0.9, blend: 'outline' }),
  ] } },
  { id: 'hilbertLabyrinth', group: 'fractal', opts: { tradition: 'mashup', seed: 'hilbert-labyrinth', field: 'plain', palette: 'jadeTemple', widthCm: 160, lengthCm: 160, kpsi: 100, borderMotif: 'meander', layers: [
    K('maze', { cells: 22, wall: 0.36, solution: 1 }, { roles: ['outline', 'ground', 'accent2'], scale: 0.98 }),
    K('rings', { shape: 'circle', count: 1, fill: 1, size: 0.62 }, { blend: 'mask' }),
    K('hilbert', { order: 4, width: 0.62, cycles: 2, closed: 1 }, { roles: ['accent1', 'accent3', 'light', 'accent4'], warp: 'polar', repeat: 1, scale: 0.62 }),
  ] } },
  { id: 'juliaRosette', group: 'fractal', opts: { tradition: 'mashup', seed: 'julia-rosette', field: 'plain', palette: 'cobaltIce', widthCm: 140, lengthCm: 200, kpsi: 121, borderMotif: 'diamondChain', layers: [
    K('quasicrystal', { waves: 7, freq: 16, bands: 3 }, { roles: ['field', 'light', 'ground'] }),
    K('rings', { shape: 'flower', count: 1, fill: 1, size: 0.9 }, { blend: 'mask' }),
    K('julia', { cr: -0.745, ci: 0.113, zoom: 1.2, iter: 110, bands: 5, cut: 3 }, { roles: ['light', 'accent1', 'accent2', 'accent4', 'accent1', 'accent2'], sym: 'kaleido', fold: 12 }),
    K('rings', { shape: 'flower', count: 1, fill: 1, size: 0.9 }, { blend: 'outline', roles: ['accent3'] }),
    K('rosette', { petals: 12, width: 0.6, rings: 2, center: 0.3, size: 0.18 }, { roles: ['accent4', 'accent1', 'accent2', 'outline'] }),
  ] } },
  { id: 'newtonStar', group: 'fractal', opts: { tradition: 'mashup', seed: 'newton-star', field: 'plain', palette: 'ember', widthCm: 150, lengthCm: 150, kpsi: 100, borderMotif: 'stepsBand', layers: [
    K('truchet', { kind: 'arcs', scale: 0.12, width: 0.2 }, { roles: ['outline', 'ground', 'field'] }),
    K('star', { points: 8, inner: 0.6, nest: 1, size: 0.95 }, { blend: 'mask' }),
    K('newton', { degree: 8, zoom: 0.8, iter: 60, edges: 1 }, { roles: ['accent1', 'accent2', 'accent3', 'accent4', 'light', 'accent1', 'accent2', 'accent3', 'outline'] }),
    K('star', { points: 8, inner: 0.6, nest: 1, size: 0.95 }, { blend: 'outline', roles: ['accent3'] }),
  ] } },
  { id: 'dragonCurveKazak', group: 'fractal', opts: { tradition: 'caucasian', seed: 'dragon-curve-kazak', field: 'stacked', widthCm: 120, lengthCm: 200, kpsi: 81, layers: [
    K('dragon', { iterations: 10, width: 0.03, cycles: 2, kind: 'twin' }, { roles: ['light', 'accent3', 'light', 'accent4'], sym: 'rot4', scale: 0.9, map: 'grid', cols: 1, rows: 2, blend: 'over' }),
  ] } },
  { id: 'penroseMihrab', group: 'fractal', opts: { tradition: 'mashup', seed: 'penrose-mihrab', field: 'plain', palette: 'mamluk', widthCm: 120, lengthCm: 180, kpsi: 100, borderMotif: 'kufic', layers: [
    K('motif', { motif: 'flowerA', mode: 'halfdrop', scale: 0.05, gap: 1.5 }, { blend: 'over' }),
    K('frame', { shape: 'arch', size: 1.35, thickness: 1.35, fill: 0 }, { blend: 'mask' }),
    K('quasicrystal', { waves: 5, freq: 18, bands: 4 }, { roles: ['accent2', 'light', 'accent1', 'accent4'] }),
    K('frame', { shape: 'arch', size: 1.35, thickness: 0.07 }, { roles: ['accent4'], blend: 'over', area: 'field' }),
  ] } },
  { id: 'truchetGarden', group: 'fractal', opts: { tradition: 'mashup', seed: 'truchet-garden', field: 'plain', palette: 'boucherouite', widthCm: 160, lengthCm: 230, kpsi: 49, borders: 1, borderMotif: 'crossBand', layers: [
    K('truchet', { kind: 'weave', scale: 0.16, width: 0.26 }, { roles: ['outline', 'accent2', 'accent1'] }),
    K('voronoi', { points: 9, border: 0.02, relax: 2, spread: 1.4 }, { roles: ['outline', 'accent3', 'accent4', 'light', 'accent1', 'accent2'], opacity: 0.35 }),
  ] } },
  { id: 'lifeMeadow', group: 'fractal', opts: { tradition: 'mashup', seed: 'life-meadow', field: 'plain', palette: 'jadeTemple', widthCm: 150, lengthCm: 220, kpsi: 64, borderMotif: 'tulipVine', layers: [
    K('life', { cells: 48, steps: 70, density: 0.35, trail: 1 }, { roles: ['accent3', 'light', 'field'], sym: 'mirrorXY' }),
    K('motif', { motif: 'tulip', scale: 0.55 }, { map: 'grid', cols: 2, rows: 3, vary: 'shift' }),
  ] } },
  { id: 'reactionRya', group: 'fractal', opts: { tradition: 'rya', seed: 'reaction-rya', widthCm: 140, lengthCm: 200, kpsi: 9, layers: [
    K('reaction', { preset: 'coral', grid: 96, steps: 3000 }, { roles: ['accent1', 'light', 'field'], opacity: 0.85, scale: 1.4 }),
  ] } },
  { id: 'kochSnowKilim', group: 'fractal', opts: { tradition: 'georgian', seed: 'koch-snow', field: 'tushetian', widthCm: 120, lengthCm: 180, kpsi: 49, layers: [
    K('koch', { depth: 4, nest: 3 }, { roles: ['accent1', 'accent2', 'accent3'], map: 'grid', cols: 1, rows: 3, scale: 0.85 }),
    K('koch', { depth: 4, nest: 1 }, { roles: ['outline'], map: 'grid', cols: 1, rows: 3, scale: 0.85, blend: 'halo' }),
  ] } },
  { id: 'lsystemTree', group: 'fractal', opts: { tradition: 'turkish', seed: 'tree-of-life', field: 'usakMedallion', widthCm: 130, lengthCm: 200, kpsi: 121, layers: [
    K('medallion', { size: 0.7, aspect: 1.5, shape: 1.6, lobes: 0, bands: 1, rim: 0, pendants: 0 }, { blend: 'mask' }),
    K('medallion', { size: 0.7, aspect: 1.5, shape: 1.6, lobes: 0, bands: 1, rim: 0, pendants: 0 }, { roles: ['accent3'], blend: 'over' }),
    K('lsystem', { preset: 'tree', width: 0.02, cycles: 0 }, { roles: ['accent2'], sym: 'mirrorX', scale: 0.95, y: 0.15 }),
  ] } },
];

// Deep copy: callers mutate the options (UI edits), and the gallery entries must stay pristine.
export function designOpts(id) {
  const d = DESIGNS.find((x) => x.id === id);
  return d ? JSON.parse(JSON.stringify(d.opts)) : null;
}
