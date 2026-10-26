// planogram-studio/demo.js - the demo project: about sixty products of a Georgian grocery (mineral waters, lemonades,
// juices, wines, dairy, cheese, spices, sweets, sauces, snacks) with real-looking pack sizes, prices in lari, daily
// sales and stock; five fixtures (a drinks gondola, a dairy fridge with a shelf that fits only thanks to squeeze, a
// wine wall rack with one overfull shelf, a spice pegboard and a grocery gondola); two saved versions of the drinks
// gondola to compare; and the floor plan of the shop with the fixtures linked to their planograms. Category and
// fixture names follow the UI language at the time the demo is loaded.
import { t } from '../ui/app.js';
import { autoDepth } from '../planogram/fit.js';
import { completeCheck } from '../barcode/gtin.js';
import { makeVersion, normalizeProject } from './common.js';

// key, name, category, brand, width, height, depth (cm), price (GEL), daily sales, squeeze % [x, y, z], case units
// Compact tuple table (header + structure comment only): one row per product, expanded into product objects below.
// Squeeze is a single % or [x, y, z] per axis; soft packs (cheese, spices, snacks) compress, glass does not.
const P = [
  ['bj033', 'Borjomi 0.33 L glass', 'water', 'Borjomi', 6, 17.5, 6, 1.9, 18, 0, 20],
  ['bj05', 'Borjomi 0.5 L glass', 'water', 'Borjomi', 6.8, 21.5, 6.8, 2.4, 25, 0, 20],
  ['bj05p', 'Borjomi 0.5 L PET', 'water', 'Borjomi', 6.5, 21, 6.5, 2.1, 20, 0, 12],
  ['bj1', 'Borjomi 1 L PET', 'water', 'Borjomi', 8, 28, 8, 3.2, 14, 0, 6],
  ['nb05', 'Nabeghlavi 0.5 L glass', 'water', 'Nabeghlavi', 6.8, 21.5, 6.8, 1.8, 22, 0, 20],
  ['nb1', 'Nabeghlavi 1 L PET', 'water', 'Nabeghlavi', 8, 28, 8, 2.5, 16, 0, 6],
  ['nb15', 'Nabeghlavi 1.5 L PET', 'water', 'Nabeghlavi', 9, 32, 9, 3, 12, 0, 6],
  ['lk05', 'Likani 0.5 L glass', 'water', 'Likani', 6.8, 22, 6.8, 1.7, 12, 0, 20],
  ['sr05', 'Sairme 0.5 L glass', 'water', 'Sairme', 6.8, 22, 6.8, 1.7, 9, 0, 20],
  ['bk15', 'Bakhmaro 1.5 L still', 'water', 'Bakhmaro', 9, 31, 9, 1.5, 10, 0, 6],
  ['lgt', 'Lagidze Tarragon 0.5 L', 'lemonade', 'Lagidze Waters', 6.8, 24, 6.8, 2.2, 8, 0, 20],
  ['lgp', 'Lagidze Pear 0.5 L', 'lemonade', 'Lagidze Waters', 6.8, 24, 6.8, 2.2, 6, 0, 20],
  ['lgc', 'Lagidze Cream soda 0.5 L', 'lemonade', 'Lagidze Waters', 6.8, 24, 6.8, 2.2, 5, 0, 20],
  ['zdt', 'Zedazeni Tarragon 0.5 L', 'lemonade', 'Zedazeni', 6.5, 22, 6.5, 1.6, 10, 0, 12],
  ['zdp', 'Zedazeni Pear 1 L', 'lemonade', 'Zedazeni', 8, 28, 8, 2.4, 7, 0, 6],
  ['ntt', 'Natakhtari Tarragon 1 L', 'lemonade', 'Natakhtari', 8, 28, 8, 2.3, 11, 0, 6],
  ['ntl', 'Natakhtari Lemon 2 L', 'lemonade', 'Natakhtari', 10, 33, 10, 3.5, 6, 0, 6],
  ['nto', 'Natakhtari Orange 0.5 L', 'lemonade', 'Natakhtari', 6.5, 22, 6.5, 1.5, 9, 0, 12],
  ['kla', 'Kula Apple juice 1 L', 'juice', 'Kula', 9.5, 20, 6, 3.9, 7, 0, 12],
  ['klp', 'Kula Peach nectar 1 L', 'juice', 'Kula', 9.5, 20, 6, 3.9, 5, 0, 12],
  ['klm', 'Kula Multifruit 1 L', 'juice', 'Kula', 9.5, 20, 6, 3.9, 6, 0, 12],
  ['tvs', 'Teliani Valley Saperavi 0.75 L', 'wine', 'Teliani Valley', 7.5, 31, 7.5, 18, 4, 0, 6],
  ['tvt', 'Teliani Valley Tsinandali 0.75 L', 'wine', 'Teliani Valley', 7.5, 31, 7.5, 16, 4, 0, 6],
  ['tvm', 'Teliani Valley Mukuzani 0.75 L', 'wine', 'Teliani Valley', 7.5, 31, 7.5, 22, 3, 0, 6],
  ['tbk', 'Tbilvino Kindzmarauli 0.75 L', 'wine', 'Tbilvino', 7.5, 31, 7.5, 20, 5, 0, 6],
  ['tbs', 'Tbilvino Saperavi 0.75 L', 'wine', 'Tbilvino', 7.5, 31, 7.5, 13, 6, 0, 6],
  ['tbr', 'Tbilvino Rkatsiteli 0.75 L', 'wine', 'Tbilvino', 7.5, 31, 7.5, 12, 4, 0, 6],
  ['kmk', 'Kindzmarauli Marani Kindzmarauli 0.75 L', 'wine', 'Kindzmarauli Marani', 7.5, 31, 7.5, 24, 3, 0, 6],
  ['khx', 'Khareba Khvanchkara 0.75 L', 'wine', 'Khareba', 7.5, 31, 7.5, 35, 2, 0, 6],
  ['khk', 'Khareba Kisi 0.75 L', 'wine', 'Khareba', 7.5, 31, 7.5, 25, 2, 0, 6],
  ['khc', 'Khareba Chacha 0.5 L', 'wine', 'Khareba', 7, 27, 7, 30, 1.5, 0, 6],
  ['skf', 'Sante Kefir 1 L', 'dairy', 'Sante', 7, 24, 7, 3.1, 14, 0, 10],
  ['smt', 'Sante Matsoni 500 g', 'dairy', 'Sante', 9, 8, 9, 2.6, 18, 0, 12],
  ['sml', 'Sante Milk 3.2 % 1 L', 'dairy', 'Sante', 7, 24, 7, 3.4, 20, 0, 10],
  ['sbt', 'Sante Butter 200 g', 'dairy', 'Sante', 10, 3.5, 6, 7.9, 6, 0, 20],
  ['emt', 'Ecofood Matsoni 450 g glass', 'dairy', 'Ecofood', 8, 10, 8, 3.2, 9, 0, 12],
  ['end', 'Ecofood Nadughi 200 g', 'dairy', 'Ecofood', 8, 6, 8, 4.5, 5, 0, 12],
  ['syg', 'Sante Yogurt Strawberry 125 g', 'dairy', 'Sante', 6.5, 6, 6.5, 1.3, 15, 0, 24],
  ['say', 'Sante Ayran 0.5 L', 'dairy', 'Sante', 6.5, 20, 6.5, 1.9, 8, 0, 12],
  ['csg', 'Sulguni 400 g', 'cheese', 'Soplis Kveli', 12, 4, 15, 11.5, 8, [10, 0, 10], 10],
  ['cim', 'Imeruli cheese 400 g', 'cheese', 'Soplis Kveli', 13, 4, 13, 10, 9, [10, 0, 10], 10],
  ['css', 'Smoked sulguni 300 g', 'cheese', 'Soplis Kveli', 10, 4, 14, 12, 4, [10, 0, 10], 10],
  ['cgd', 'Guda cheese 300 g', 'cheese', 'Tushuri', 10, 5, 10, 14, 2, 0, 10],
  ['sks', 'Khmeli-suneli 20 g', 'spices', 'Samegrelo', 8, 12, 1.5, 1.2, 6, [0, 0, 20], 50],
  ['sut', 'Utskho-suneli 20 g', 'spices', 'Samegrelo', 8, 12, 1.5, 1.2, 4, [0, 0, 20], 50],
  ['skd', 'Kondari 20 g', 'spices', 'Samegrelo', 8, 12, 1.5, 1.1, 3, [0, 0, 20], 50],
  ['sad', 'Dry adjika 50 g', 'spices', 'Samegrelo', 9, 14, 2, 2.5, 4, [0, 0, 20], 40],
  ['ssv', 'Svan salt 200 g', 'spices', 'Svaneti', 10, 16, 4, 4.5, 5, [0, 0, 25], 20],
  ['wcw', 'Churchkhela walnut', 'sweets', 'Kakheti', 4, 30, 4, 4, 12, 0, 20],
  ['wch', 'Churchkhela hazelnut', 'sweets', 'Kakheti', 4, 30, 4, 3.5, 8, 0, 20],
  ['wgz', 'Gozinaki 150 g', 'sweets', 'Kakheti', 12, 18, 3, 6.5, 4, [0, 0, 15], 20],
  ['wtk', 'Tklapi plum 100 g', 'sweets', 'Kakheti', 10, 20, 1, 2.8, 3, 0, 30],
  ['tkg', 'Kula Tkemali green 0.5 L', 'sauces', 'Kula', 7, 22, 7, 4.2, 6, 0, 12],
  ['tkr', 'Kula Tkemali red 0.5 L', 'sauces', 'Kula', 7, 22, 7, 4.2, 5, 0, 12],
  ['tst', 'Kula Satsebeli 0.5 L', 'sauces', 'Kula', 7, 22, 7, 3.9, 4, 0, 12],
  ['adj', 'Adjika red 200 g', 'sauces', 'Kakhuri', 7, 9, 7, 3.5, 6, 0, 12],
  ['jnj', 'Pickled jonjoli 300 g', 'sauces', 'Kakhuri', 8, 11, 8, 5.9, 3, 0, 12],
  ['bdr', 'Eggplant with walnuts 300 g', 'sauces', 'Kakhuri', 8, 11, 8, 7.5, 2, 0, 12],
  ['nsf', 'Sunflower seeds 100 g', 'snacks', 'Mzesumzira', 12, 18, 4, 1.6, 14, [25, 0, 40], 30],
  ['ncs', 'Corn sticks 80 g', 'snacks', 'Mzesumzira', 15, 25, 7, 1.9, 9, [20, 0, 30], 20],
  ['nwk', 'Walnut kernels 200 g', 'snacks', 'Kakheti', 12, 18, 5, 9.5, 3, [15, 0, 30], 20],
];

export const DEMO_CATEGORIES = ['water', 'lemonade', 'juice', 'wine', 'dairy', 'cheese', 'spices', 'sweets', 'sauces', 'snacks'];

// Shelves (top to bottom): clearance and positions [productKey, fx, fy].
// Fixture specs: per shelf the clearance height (cm) and positions [productKey, facings across, facings up]. The
// dairy fridge and wine rack deliberately include a squeeze-dependent and an overfull shelf to demonstrate warnings.
const FIXTURES = [
  { id: 'fx-drinks', kind: 'gondola', name: 'drinks', width: 125, height: 200, depth: 50, base: 10, thickness: 3, shelves: [
    [30, [['bj033', 3], ['bj05', 4], ['nb05', 4], ['lk05', 3], ['sr05', 3]]],
    [30, [['lgt', 4], ['lgp', 3], ['lgc', 3], ['zdt', 4], ['nto', 4]]],
    [33, [['bj1', 4], ['nb1', 4], ['zdp', 3], ['ntt', 4]]],
    [30, [['kla', 4], ['klp', 3], ['klm', 3], ['bj05p', 4]]],
    [36, [['nb15', 5], ['bk15', 4], ['ntl', 4]]],
  ] },
  { id: 'fx-dairy', kind: 'fridge', name: 'dairy', width: 100, height: 200, depth: 60, base: 15, thickness: 2, shelves: [
    [28, [['skf', 4], ['sml', 5], ['say', 4]]],
    [28, [['smt', 4, 2], ['emt', 3, 2], ['end', 3, 3]]],
    [28, [['syg', 6, 4], ['sbt', 3, 6]]],
    [28, [['csg', 3], ['cim', 3], ['css', 2], ['cgd', 1]]],
    [30, [['sml', 6], ['skf', 5]]],
  ] },
  { id: 'fx-wine', kind: 'wall', name: 'wine', width: 100, height: 220, depth: 40, base: 12, thickness: 3, shelves: [
    [34, [['khx', 3], ['khk', 3], ['kmk', 3], ['khc', 3]]],
    [34, [['tvs', 4], ['tvt', 4], ['tvm', 4]]],
    [34, [['tbk', 5], ['tbs', 4], ['tbr', 4]]],
    [34, [['tbs', 6], ['tvs', 5], ['tbr', 3]]],
    [34, [['tbk', 4], ['tvt', 4]]],
  ] },
  { id: 'fx-spices', kind: 'peg', name: 'spices', width: 100, height: 180, depth: 30, base: 40, thickness: 1, pitch: 2.5, shelves: [
    [38, [['sks', 3, 2], ['sut', 3, 2], ['skd', 2, 2], ['sad', 2, 2]]],
    [36, [['ssv', 4, 2], ['wgz', 3], ['wtk', 2]]],
    [40, [['wcw', 8], ['wch', 8]]],
  ] },
  { id: 'fx-grocery', kind: 'gondola', name: 'grocery', width: 125, height: 200, depth: 45, base: 10, thickness: 3, shelves: [
    [30, [['tkg', 5], ['tkr', 5], ['tst', 4]]],
    [30, [['adj', 6, 2], ['jnj', 4, 2], ['bdr', 4, 2]]],
    [30, [['nsf', 4], ['nwk', 3]]],
    [40, [['ncs', 5]]],
  ] },
];

// Deterministic pseudo-random numbers (the demo is the same on every load).
// Numerical Recipes LCG (a = 1664525, c = 1013904223, mod 2^32): weak statistically but enough for stable demo
// stock levels and EAN digits; determinism is the only requirement.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// EANs: GS1 prefix 486 (Georgia) + item digits + a computed check digit, so the barcodes are valid EAN-13 and scan
// in the preview. Category and fixture names are translated now, at load time, and then stored as data.
export function buildDemo() {
  const rnd = rng(42);
  const products = P.map(([key, name, cat, brand, w, hh, d, price, sales, sq, caseUnits], i) => {
    const q = Array.isArray(sq) ? sq : [0, 0, 0];
    const stock = key === 'nwk' ? 0 : Math.round(sales * (4 + rnd() * 20));
    return {
      id: 'p-' + key, name, code: completeCheck('4860' + String(1000 + i * 37).padStart(8, '0')),
      category: t('pgs.cat.' + cat), brand, width: w, height: hh, depth: d, squeeze: { x: q[0], y: q[1], z: q[2] },
      price, cost: Math.round(price * (0.62 + rnd() * 0.12) * 100) / 100, dailySales: sales, stock, caseUnits,
    };
  });
  const byKey = new Map(products.map((p) => [p.id, p]));
  const fixtures = FIXTURES.map((f) => ({
    id: f.id, kind: f.kind, name: t('pgs.demo.fx.' + f.name), width: f.width, height: f.height, depth: f.depth, base: f.base,
    shelves: f.shelves.map(([clear, list], si) => {
      const shelf = { id: `${f.id}-s${si + 1}`, kind: f.kind === 'peg' ? 'peg' : 'shelf', pitch: f.pitch, width: f.width, depth: f.kind === 'peg' ? 20 : f.depth, height: clear, thickness: f.thickness };
      shelf.positions = list.map(([k, fx, fy = 1]) => {
        const pr = byKey.get('p-' + k);
        return { productId: pr.id, fx, fy, fz: Math.min(f.kind === 'peg' ? 12 : 50, autoDepth(pr, shelf)), rot: 0, turn: 0 };
      });
      return shelf;
    }),
  }));
  const plan = {
    kind: 'shop', grid: 0.1, name: t('pgs.demo.store'),
    pages: [{
      id: 'hall', name: t('pgs.demo.hall'), w: 18, h: 12,
      outline: [[0, 0], [18, 0], [18, 12], [6, 12], [6, 10], [0, 10]],
      shapes: [
        { id: 'z-fresh', kind: 'zone', x: 13, y: 0.6, w: 4.6, h: 4.2, label: t('pgs.demo.zoneFresh') },
        { id: 'z-promo', kind: 'zone', x: 6.8, y: 9.1, w: 4.2, h: 2.5, label: t('pgs.demo.zonePromo') },
        { id: 'sh-wine', kind: 'wall-rack', x: 1, y: 0.1, w: 1, h: 0.4, ref: 'fx-wine', label: t('pgs.demo.fx.wine') },
        { id: 'sh-wine2', kind: 'wall-rack', x: 2, y: 0.1, w: 3, h: 0.4 },
        { id: 'sh-drinks', kind: 'gondola', x: 2, y: 2.4, w: 1.25, h: 1, ref: 'fx-drinks', label: t('pgs.demo.fx.drinks') },
        { id: 'sh-g2', kind: 'gondola', x: 3.25, y: 2.4, w: 3, h: 1 },
        { id: 'sh-grocery', kind: 'gondola', x: 2, y: 5, w: 1.25, h: 0.9, ref: 'fx-grocery', label: t('pgs.demo.fx.grocery') },
        { id: 'sh-g3', kind: 'gondola', x: 3.25, y: 5, w: 3, h: 0.9 },
        { id: 'sh-endcap', kind: 'end-cap', x: 6.25, y: 5.2, w: 0.9, h: 0.5 },
        { id: 'sh-spices', kind: 'wall-rack', x: 0.1, y: 3, w: 1, h: 0.3, rot: 90, ref: 'fx-spices', label: t('pgs.demo.fx.spices') },
        { id: 'sh-dairy', kind: 'fridge-upright', x: 17.1, y: 1.4, w: 1, h: 0.6, rot: 90, ref: 'fx-dairy', label: t('pgs.demo.fx.dairy') },
        { id: 'sh-fr2', kind: 'fridge-upright', x: 16.975, y: 2.525, w: 1.25, h: 0.6, rot: 90 },
        { id: 'sh-freezer', kind: 'freezer-chest', x: 13.6, y: 3.2, w: 2, h: 0.85 },
        { id: 'sh-counter', kind: 'counter', x: 13.5, y: 0.6, w: 2.5, h: 0.8, label: t('pgs.demo.counter') },
        { id: 'sh-pallet', kind: 'pallet', x: 9, y: 6, w: 1.2, h: 0.8 },
        { id: 'sh-promo', kind: 'promo-table', x: 7.3, y: 9.6, w: 1.2, h: 0.8 },
        { id: 'sh-co1', kind: 'checkout', x: 12.2, y: 9.8, w: 1.8, h: 0.9 },
        { id: 'sh-co2', kind: 'checkout', x: 15, y: 9.8, w: 1.8, h: 0.9 },
        { id: 'sh-baskets', kind: 'basket-stand', x: 10.6, y: 11.3, w: 0.5, h: 0.4 },
        { id: 'sh-col', kind: 'column', x: 9, y: 3, w: 0.4, h: 0.4 },
        { id: 'sh-door', kind: 'door', x: 17, y: 11.1, w: 0.9, h: 0.9 },
      ],
    }],
  };
  const project = normalizeProject({ name: t('pgs.demo.store'), products, fixtures, plan });
  // Two saved layouts of the drinks gondola: spring (fewer large bottles, older shelf heights) and the current one.
  const drinks = project.fixtures[0];
  const spring = JSON.parse(JSON.stringify(drinks));
  spring.shelves[4].positions = spring.shelves[4].positions.filter((p) => p.productId !== 'p-ntl');
  spring.shelves[4].positions[0].fx = 7;
  spring.shelves[2].height = 30;
  spring.shelves[0].positions[3].fx = 4;
  const day = 86400000, now = Date.now();
  const v1 = { ...makeVersion(t('pgs.demo.vSpring'), spring, project.products), at: now - 60 * day };
  const v2 = { ...makeVersion(t('pgs.demo.vSummer'), drinks, project.products), at: now - 2 * day };
  return { project, versions: [v2, v1] };
}
