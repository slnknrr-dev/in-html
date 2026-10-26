// carpet/regional.js - fields of the Indian, Arab and Moroccan, Ottoman Turkish, Armenian and Georgian traditions as
// seeded recipes of composition layers (compose.js): every field is a stack of ornaments, motifs and frames whose
// sizes, counts and colours come from the rug's PRNG, so one recipe gives many related rugs.
//
//   REGIONAL { field: (rng, { aspect, motifIds }) -> { base?: classic field to draw first, layers: [layer] } }
//
// India: millefleur (rows of small flowers in shifting colours), gardenPanels (a chahar bagh: water channels
// between panels with cypresses and flowering trees), mughalNiche (a prayer niche with a lamp over a ground of flowers).
// Arab and Moroccan: mamluk (a central octagon of stars and umbrella leaves amid small octagons and papyrus),
// girih (Islamic star tilings, lines outlined like interlace), berber (Beni Ourain lozenges with scattered marks),
// boucherouite (a rag-rug patchwork of colour cells). Turkish: usakStar (eight-pointed stars and small diamonds),
// usakMedallion (an endless repeat of lobed medallions), lotto (the yellow arabesque lattice), holbein (rows of
// octagons with stars between), cintamani (three balls and wavy stripes). Armenian: dragon (vishapagorg lozenges
// with dragons and palmettes), eagle (stacked Chelaberd sunbursts), eternity (arevakhach wheels). Georgian:
// borjgali (seven-armed sun whirls), tushetian (banded pardagi), bolnisi (Bolnisi crosses on a lattice), khevsur
// (crosses and stars in rows on a dark ground).

// Data-like module: each entry is a recipe function (rng, { aspect, motifIds }) -> layers. Only counts, motif
// choices and variants are drawn from rng, never structure, so every rug of a recipe is recognisably that field.
// ID: the full role order for motif layers (motif letters map to roles directly, so no rotation is wanted).
// rowsFor: rows that keep grid cells roughly square for the field's aspect ratio, scaled by k.
const ID = ['accent1', 'accent2', 'accent3', 'accent4', 'outline', 'light', 'ground', 'field', 'border'];
const rowsFor = (aspect, cols, k = 1) => Math.max(1, Math.round((cols / Math.max(0.2, aspect)) * k));

export const REGIONAL = {
  // --- India ---
  millefleur(r, { aspect }) {
    const cols = r.pick([5, 6, 7, 8]);
    const fl = ['flowerA', 'flowerB', 'flowerC'];
    return { layers: [
      { type: 'lattice', params: { kind: r.pick(['diamond', 'ogee']), cells: cols + 2, width: 0.025, nodes: 0 }, roles: ['light'], opacity: 0.6 },
      { type: 'motif', params: { motif: r.pick(fl), scale: 0.62 }, map: 'grid', cols, rows: rowsFor(aspect, cols, 1.15), stagger: 0.5, vary: 'random' },
      { type: 'motif', params: { motif: r.pick(fl), scale: 0.3 }, map: 'grid', cols, rows: rowsFor(aspect, cols, 1.15), stagger: 0.5, sym: 'mirrorXY', x: 1, y: 1, vary: 'shift', blend: 'under' },
    ] };
  },
  gardenPanels(r, { aspect }) {
    const cols = r.pick([2, 3]), rows = rowsFor(aspect, cols);
    const water = { type: 'frame', params: { shape: 'square', size: 1, thickness: 0.16 }, roles: ['accent4'], map: 'grid', cols, rows };
    return { layers: [
      { type: 'motif', params: { motif: 'flowerA', mode: 'halfdrop', scale: 0.05, gap: 1.6 }, blend: 'under', vary: 'none' },
      water,
      { ...water, blend: 'halo', roles: ['light'] },
      { type: 'rings', params: { shape: 'octagon', count: 2, fill: 0.7, size: 0.28 }, roles: ['accent2', 'accent4'], map: 'grid', cols, rows, sym: 'mirrorXY', x: 1, y: 1 },
      { type: 'motif', params: { motif: r.pick(['cypress', 'tulip', 'carnation', 'palmette']), scale: 0.66 }, map: 'grid', cols, rows, vary: 'checker' },
    ] };
  },
  mughalNiche(r) {
    return { base: 'prayer', layers: [
      { type: 'motif', params: { motif: r.pick(['flowerA', 'flowerB']), mode: 'brick', scale: 0.06, gap: 1.2 }, blend: 'under' },
      { type: 'motif', params: { motif: 'mihrabLamp', scale: 0.16 }, y: -0.55 },
    ] };
  },

  // --- Arab and Moroccan ---
  mamluk(r, { aspect }) {
    const cols = 3, rows = rowsFor(aspect, cols, 1.1);
    return { layers: [
      { type: 'motif', params: { motif: 'papyrus', alt: 'umbrellaLeaf', mode: 'halfdrop', scale: 0.09, gap: 1 }, roles: ID },
      { type: 'rings', params: { shape: 'octagon', count: 3, fill: 0.72, size: 0.42 }, roles: ['accent2', 'accent3', 'accent1'], map: 'grid', cols, rows, vary: 'checker' },
      { type: 'frame', params: { shape: 'octagon', size: 0.98, thickness: 1, fill: 0 }, roles: ['field'], blend: 'erase' },
      { type: 'rings', params: { shape: 'octagon', count: 6, fill: 0.86, size: 0.96 }, roles: ['accent1', 'field', 'accent2', 'field', 'accent3', 'field'] },
      { type: 'star', params: { points: 8, inner: r.pick([0.5, 0.58, 0.66]), nest: 3, size: 0.66, twist: r.pick([0, 0.5]) }, roles: ['accent3', 'accent2', 'accent1', 'accent4'] },
      { type: 'motif', params: { motif: 'umbrellaLeaf', scale: 0.12 }, roles: ID, sym: 'kaleido', fold: 8, y: -0.8 },
      { type: 'rosette', params: { petals: 16, width: 0.5, rings: 2, center: 0.3, size: 0.24 }, roles: ['accent4', 'accent2', 'accent3', 'outline'] },
    ] };
  },
  girih(r) {
    const tiling = r.pick(['square', 'square', 'hex', 'octagon']);
    const angle = tiling === 'hex' ? r.pick([30, 35, 40]) : tiling === 'octagon' ? r.pick([22.5, 30]) : r.pick([22.5, 30, 15]);
    const g = { type: 'girih', params: { tiling, size: 0.16 + r.next() * 0.16, angle, width: 0.045, rosette: 0.32 }, roles: ['light', 'accent1', 'accent2', 'accent3'], sym: 'mirrorXY' };
    const layers = [g, { ...g, blend: 'outline', roles: ['outline'] }];
    if (r.chance(0.6)) layers.push({ type: 'star', params: { points: r.pick([8, 10, 12, 16]), inner: 0.6, nest: 1, size: 0.62 }, blend: 'invert' });
    return { layers };
  },
  berber(r, { aspect }) {
    const cols = r.pick([2, 3, 4]);
    return { layers: [
      { type: 'lattice', params: { kind: 'diamond', cells: cols * 2, width: 0.055, jitter: 0.05 + r.next() * 0.05, nodes: 0 }, roles: ['outline'] },
      { type: 'motif', params: { motif: r.pick(['berberCross', 'berberDiamond']), scale: 0.36 }, roles: ['outline', 'field', 'field', 'field', 'outline'], map: 'grid', cols, rows: rowsFor(aspect, cols), vary: 'random' },
      { type: 'stripes', params: { count: 40, fill: 0.5, random: 1 }, roles: ['accent3'], opacity: 0.07 },
    ] };
  },
  boucherouite(r) {
    return { layers: [
      { type: 'voronoi', params: { points: 14 + r.int(26), border: 0.014, relax: 1, spread: 1.7 }, roles: ['outline', 'accent1', 'accent2', 'accent3', 'accent4', 'light'] },
      { type: 'noise', params: { scale: 14, octaves: 2, bands: 3 }, roles: ['light', 'accent4', 'accent3'], opacity: 0.16 },
      { type: 'motif', params: { motif: 'berberDiamond', mode: 'halfdrop', scale: 0.12, gap: 2 }, roles: ['ground', 'ground', 'ground', 'ground', 'outline'], opacity: 0.9 },
    ] };
  },

  // --- Ottoman Turkish ---
  usakStar(r, { aspect }) {
    const cols = 2, rows = rowsFor(aspect, cols, 1);
    return { layers: [
      { type: 'lattice', params: { kind: 'ogee', cells: 9, width: 0.025, nodes: 0.05 }, roles: ['accent2', 'accent4'], opacity: 0.85 },
      { type: 'star', params: { points: 8, inner: 0.62, nest: 3, size: 0.92 }, roles: ['accent1', 'accent2', 'accent3', 'accent4'], map: 'grid', cols, rows },
      { type: 'star', params: { points: 8, inner: 0.62, nest: 1, size: 0.92 }, roles: ['outline'], blend: 'outline', map: 'grid', cols, rows },
      { type: 'rings', params: { shape: 'diamond', count: 3, fill: 0.78, size: 0.42 }, roles: ['accent1', 'accent3', 'accent2'], map: 'grid', cols, rows, sym: 'mirrorXY', x: 1, y: 1 },
    ] };
  },
  usakMedallion(r, { aspect }) {
    const rows = aspect > 0.9 ? 1 : 2;
    return { layers: [
      { type: 'motif', params: { motif: r.pick(['tulip', 'carnation', 'flowerC']), mode: 'halfdrop', scale: 0.07, gap: 1.5 }, roles: ID, blend: 'under' },
      { type: 'medallion', params: { size: 0.82, aspect: 1.15, shape: 1.2, lobes: 12, lobeDepth: 0.12, bands: 4, rim: 1, pendants: 1 }, roles: ['outline', 'accent1', 'accent3', 'accent2', 'accent4'], map: 'grid', cols: 1, rows, sym: 'mirrorY', y: 1 },
      { type: 'medallion', params: { size: 0.5, aspect: 1, shape: 1.6, lobes: 8, lobeDepth: 0.1, bands: 3, rim: 1, pendants: 0 }, roles: ['outline', 'accent2', 'accent4', 'accent3'], map: 'grid', cols: 1, rows, sym: 'mirrorXY', x: 1.15, y: 1 },
    ] };
  },
  lotto(r) {
    return { layers: [
      { type: 'motif', params: { motif: 'lottoUnit', mode: 'grid', scale: 0.16 + r.next() * 0.1, gap: 0 }, roles: ID },
    ] };
  },
  holbein(r, { aspect }) {
    const cols = r.pick([2, 3]), rows = rowsFor(aspect, cols);
    return { layers: [
      { type: 'motif', params: { motif: r.pick(['holbeinGul', 'elephantFoot', 'memling']), scale: 0.7 }, roles: ID, map: 'grid', cols, rows, vary: 'checker' },
      { type: 'star', params: { points: 8, inner: 0.45, nest: 2, size: 0.34 }, roles: ['accent4', 'accent3', 'outline'], map: 'grid', cols, rows, sym: 'mirrorXY', x: 1, y: 1 },
      { type: 'lattice', params: { kind: 'square', cells: 2, width: 0.02, nodes: 0 }, roles: ['outline'], map: 'grid', cols, rows, opacity: 0.6 },
    ] };
  },
  cintamani(r) {
    return { layers: [
      { type: 'cintamani', params: { size: 0.2 + r.next() * 0.14, stripes: 1, ball: 0.2 }, roles: ['accent3', 'accent2', 'accent1'] },
    ] };
  },

  // --- Armenian ---
  dragon(r, { aspect }) {
    const cols = r.pick([2, 3]), rows = rowsFor(aspect, cols, 0.8);
    const cell = { map: 'grid', cols, rows };
    const loz = { type: 'rings', params: { shape: 'diamond', count: 1, fill: 1, size: 0.98 }, ...cell };
    return { layers: [
      { ...loz, roles: ['accent2', 'light', 'accent4'], vary: 'checker' },
      { ...loz, roles: ['accent3'], blend: 'outline' },
      { ...loz, roles: ['outline'], blend: 'halo' },
      { type: 'motif', params: { motif: 'dragon', scale: 0.56, flip: 1 }, roles: ID, ...cell },
      { type: 'motif', params: { motif: 'palmette', scale: 0.42 }, roles: ID, ...cell, sym: 'mirrorXY', x: 1, y: 1 },
    ] };
  },
  eagle(r, { aspect }) {
    const rows = Math.max(1, Math.round(1.1 / Math.max(0.3, aspect)));
    return { layers: [
      { type: 'motif', params: { motif: r.pick(['bird', 'star8', 'flowerC']), mode: 'halfdrop', scale: 0.06, gap: 1.8 }, roles: ID, blend: 'under' },
      { type: 'sunburst', params: { rays: r.pick([20, 24, 28, 32]), size: 0.92, serration: 0.2, core: 0.42, cross: 1 }, roles: ['accent1', 'accent2', 'accent3', 'outline'], map: 'grid', cols: 1, rows, vary: 'shift' },
      { type: 'star', params: { points: 8, inner: 0.5, nest: 2, size: 0.3 }, roles: ['accent3', 'accent4', 'outline'], map: 'grid', cols: 1, rows, sym: 'mirrorXY', x: 1.25, y: 1 },
    ] };
  },
  eternity(r, { aspect }) {
    const cols = r.pick([1, 2]), rows = rowsFor(aspect, cols);
    return { layers: [
      { type: 'rings', params: { shape: 'octagon', count: 2, fill: 0.25, size: 1 }, roles: ['accent3', 'outline'], map: 'grid', cols, rows },
      { type: 'whirl', params: { arms: 8, curl: 0.7 + r.next() * 0.5, width: 0.6, size: 0.82, core: 0.14, rim: 1 }, roles: ['accent1', 'accent2', 'accent3', 'outline'], map: 'grid', cols, rows, vary: 'checker' },
      { type: 'motif', params: { motif: 'star8', scale: 0.3 }, roles: ID, map: 'grid', cols, rows, sym: 'mirrorXY', x: 1, y: 1 },
    ] };
  },

  // --- Georgian ---
  borjgali(r, { aspect }) {
    const cols = r.pick([1, 2]), rows = rowsFor(aspect, cols);
    const cell = { map: 'grid', cols, rows };
    return { layers: [
      { type: 'motif', params: { motif: 'bolnisi', mode: 'halfdrop', scale: 0.07, gap: 1.6 }, roles: ['accent3', 'accent2', 'accent4', 'accent1', 'light'], blend: 'under' },
      { type: 'rings', params: { shape: 'circle', count: 3, fill: 0.4, size: 0.98 }, roles: ['accent3', 'accent2', 'outline'], ...cell },
      { type: 'whirl', params: { arms: 7, curl: 0.9 + r.next() * 0.5, width: 0.62, size: 0.8, core: 0.14, rim: 0 }, roles: ['accent1', 'accent2', 'accent3', 'outline'], ...cell },
    ] };
  },
  tushetian(r) {
    return { layers: [
      { type: 'bands', params: { count: 9 + r.int(8), spacer: 0.1 + r.next() * 0.08, motifs: 1 }, roles: ['ground', 'accent1', 'accent2', 'accent3', 'accent4'], sym: 'mirrorY' },
    ] };
  },
  bolnisi(r, { aspect }) {
    const cols = r.pick([2, 3]), rows = rowsFor(aspect, cols);
    return { layers: [
      { type: 'lattice', params: { kind: 'diamond', cells: cols * 2, width: 0.035, nodes: 0.09 }, roles: ['accent3', 'accent1'] },
      { type: 'motif', params: { motif: 'bolnisi', scale: 0.62 }, roles: ['accent1', 'accent2', 'accent3', 'accent4', 'outline', 'light'], map: 'grid', cols, rows, vary: 'checker' },
    ] };
  },
  khevsur(r, { aspect }) {
    const cols = r.pick([3, 4, 5]), rows = rowsFor(aspect, cols, 1.2);
    return { layers: [
      { type: 'stripes', params: { count: rows * 2, fill: 0.06 }, roles: ['accent2'] },
      { type: 'motif', params: { motif: 'khevsurCross', scale: 0.6 }, roles: ID, map: 'grid', cols, rows, stagger: 0.5, vary: 'shift' },
      { type: 'motif', params: { motif: 'star8', scale: 0.26 }, roles: ID, map: 'grid', cols, rows, stagger: 0.5, sym: 'mirrorX', x: 1 },
    ] };
  },
};

export const REGIONAL_FIELDS = Object.keys(REGIONAL);
