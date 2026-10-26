// stock-analyzer/demo.js - the built-in demo: a small Georgian grocery chain (two stores in Tbilisi, 123 items in
// ten categories, 26 weeks of weekly sales with stable, seasonal, erratic and new items, promotions and costs), its
// stock levels, seven suppliers with order weekdays, lots, multiples and holidays, and batches of perishable goods
// with expiry dates. Everything is drawn from a seeded generator (prng/), so the demo is the same on every device.
// Pure: no DOM.

//
// Design goal: every analysis outcome must appear in the demo. Profiles are chosen so the ABC / XYZ matrix fills all
// nine cells: stable staples (X), normal goods (Y), erratic items (Z), seasonal items whose trend inflates variation,
// and new items (too short a history, the "-" column). Separate seeds per purpose ('/stock', '/batches') keep the
// sales identical when the stock or batch generators change.
import { seededRandom } from '../prng/prng.js';
import { addDays } from '../stock/calendar.js';
import { stockKey } from './data.js';

export const DEMO_SEED = 'tbilisi-grocery-26';
export const DEMO_TODAY = '2026-10-18';        // last sales day (a Sunday); the plan starts the day after
export const DEMO_WEEKS = 26;
export const DEMO_STORES = ['Saburtalo', 'Vake'];

// [category, code, cost ratio, perishable shelf days (0 = not perishable), supplier, items: [name, price GEL, profile]]
// profiles: s stable, n normal, w winter season, u summer season, e erratic, x new (first sold in the last weeks)
const CATALOG = [
  // Cost ratios per category (e.g. 0.58 = 42% gross margin on fruit), shelf life in days drives the expiry demo.
  ['Dairy & eggs', 'DAI', 0.74, 9, 'imereti', [
    ['Matsoni 0.5 l', 2.4, 's'], ['Sulguni cheese 1 kg', 18.9, 'n'], ['Imeruli cheese 1 kg', 15.5, 'n'], ['Milk 3.2% 1 l', 3.6, 's'],
    ['Kefir 1 l', 3.2, 's'], ['Butter 200 g', 6.8, 'n'], ['Sour cream 20% 400 g', 4.5, 'n'], ['Nadughi 250 g', 4.2, 'e'],
    ['Strawberry yoghurt 125 g', 1.3, 'n'], ['Cottage cheese 5% 400 g', 5.2, 'n'], ['Eggs 10 pcs', 4.9, 's'], ['Smoked sulguni 300 g', 8.4, 'x']]],
  ['Bakery', 'BAK', 0.6, 3, 'bread', [
    ['Shoti bread', 1.2, 's'], ['Tonis puri', 1.0, 's'], ['Imeruli khachapuri', 5.5, 'n'], ['Adjaruli khachapuri', 7.9, 'n'],
    ['Lobiani', 4.5, 'n'], ['Penovani', 3.8, 'n'], ['Baguette', 1.8, 'n'], ['Rye bread', 2.4, 'e'], ['Nazuki', 2.9, 'w']]],
  ['Beverages', 'BEV', 0.69, 0, 'drinks', [
    ['Borjomi 0.5 l', 2.2, 's'], ['Borjomi 1 l', 3.4, 'n'], ['Nabeghlavi 0.5 l', 1.6, 's'], ['Sairme 0.5 l', 1.7, 'n'],
    ['Likani 0.5 l', 1.8, 'n'], ['Lagidze tarragon 0.5 l', 2.5, 'u'], ['Lagidze pear 0.5 l', 2.5, 'u'], ['Zedazeni lemonade 1 l', 2.9, 'u'],
    ['Natakhtari lemonade 2 l', 3.8, 'u'], ['Cola 1 l', 3.2, 'n'], ['Orange juice 1 l', 5.6, 'n'], ['Apple juice 1 l', 4.8, 'e'],
    ['Still water 1.5 l', 1.2, 's'], ['Iced tea 0.5 l', 2.3, 'u'], ['Energy drink 0.25 l', 3.9, 'e'], ['Gurieli black tea 100 g', 4.4, 'n'],
    ['Coffee beans 250 g', 14.9, 'n'], ['Instant coffee 95 g', 12.5, 'x']]],
  ['Wine & beer', 'WIN', 0.64, 0, 'wine', [
    ['Saperavi 0.75 l', 18, 'n'], ['Kindzmarauli 0.75 l', 24, 'n'], ['Mukuzani 0.75 l', 26, 'e'], ['Tsinandali 0.75 l', 19, 'n'],
    ['Rkatsiteli qvevri 0.75 l', 22, 'e'], ['Khvanchkara 0.75 l', 38, 'e'], ['Pirosmani 0.75 l', 16, 'n'], ['Natakhtari beer 0.5 l', 2.6, 'u'],
    ['Zedazeni beer 0.5 l', 2.8, 'u'], ['Argo beer 0.5 l', 2.4, 'n'], ['Chacha 0.5 l', 25, 'e'], ['Kakhetian brandy 0.5 l', 32, 'x']]],
  ['Meat & fish', 'MEA', 0.77, 6, 'meat', [
    ['Pork for mtsvadi 1 kg', 19.9, 'u'], ['Beef 1 kg', 24.5, 'n'], ['Whole chicken 1 kg', 9.8, 's'], ['Chicken breast 1 kg', 14.5, 'n'],
    ['Minced meat 1 kg', 17.9, 'n'], ['Kupati 1 kg', 16.5, 'e'], ['Trout 1 kg', 22, 'e'], ['Sausages 500 g', 9.6, 'n'],
    ['Ham 300 g', 8.9, 'n'], ['Basturma 200 g', 14, 'e']]],
  ['Fruit & vegetables', 'VEG', 0.58, 8, 'greens', [
    ['Tomatoes 1 kg', 4.5, 'n'], ['Cucumbers 1 kg', 3.8, 'n'], ['Potatoes 1 kg', 1.6, 's'], ['Onions 1 kg', 1.4, 's'],
    ['Garlic 1 kg', 9, 'n'], ['Coriander bunch', 0.8, 'n'], ['Parsley bunch', 0.7, 'n'], ['Tarragon bunch', 0.9, 'e'],
    ['Bananas 1 kg', 4.2, 's'], ['Apples 1 kg', 2.9, 'n'], ['Mandarins 1 kg', 3.2, 'w'], ['Grapes 1 kg', 5.5, 'u'],
    ['Persimmons 1 kg', 4.8, 'w'], ['Pomegranates 1 kg', 6.5, 'w'], ['Walnuts 1 kg', 22, 'e'], ['Bell peppers 1 kg', 6.2, 'u'], ['Eggplants 1 kg', 4.4, 'u']]],
  ['Grocery', 'GRO', 0.75, 0, 'wholesale', [
    ['Sunflower oil 1 l', 6.4, 's'], ['Olive oil 0.5 l', 18.5, 'e'], ['Rice 1 kg', 4.2, 'n'], ['Buckwheat 1 kg', 5.1, 'n'],
    ['Pasta 500 g', 2.6, 's'], ['Flour 2 kg', 4.3, 'n'], ['Sugar 1 kg', 2.9, 's'], ['Svanetian salt 200 g', 3.5, 'n'],
    ['Red beans 1 kg', 6.8, 'w'], ['Canned lobio 450 g', 4.2, 'n'], ['Canned corn 340 g', 3.1, 'e'], ['Mayonnaise 400 g', 4.6, 'n'],
    ['Ketchup 500 g', 3.9, 'u'], ['Oatmeal 500 g', 3.4, 'n'], ['Honey 500 g', 16, 'e'], ['Chickpeas 1 kg', 6.2, 'x']]],
  ['Sauces & spices', 'SAU', 0.6, 0, 'wholesale', [
    ['Red tkemali 0.5 l', 4.8, 'n'], ['Green tkemali 0.5 l', 4.8, 'u'], ['Adjika 200 g', 4.2, 'n'], ['Satsebeli 0.5 l', 4.5, 'n'],
    ['Khmeli suneli 50 g', 2.2, 'n'], ['Utskho suneli 50 g', 2.4, 'e'], ['Bazhe sauce 200 g', 6.9, 'w'], ['Black pepper 50 g', 2.8, 'e']]],
  ['Sweets', 'SWE', 0.58, 0, 'wholesale', [
    ['Churchkhela', 3.5, 'w'], ['Gozinaki 200 g', 6.5, 'w'], ['Pelamushi 300 g', 5.2, 'e'], ['Chocolate bar 90 g', 3.2, 'n'],
    ['Ice cream cone', 1.8, 'u'], ['Biscuits 200 g', 2.7, 'n'], ['Wafers 300 g', 3.6, 'n'], ['Fig jam 400 g', 7.4, 'e'],
    ['Candies 1 kg', 14, 'e'], ['Tklapi 100 g', 2.5, 'x']]],
  ['Household', 'HOU', 0.7, 0, 'household', [
    ['Dish soap 0.5 l', 4.9, 'n'], ['Laundry powder 3 kg', 21, 'n'], ['Toilet paper 8 rolls', 9.8, 's'], ['Paper towels 2 rolls', 5.4, 'n'],
    ['Bin bags 30 pcs', 4.2, 'n'], ['Shampoo 400 ml', 11.5, 'e'], ['Toothpaste 100 ml', 5.8, 'n'], ['Hand soap', 3.2, 'n'],
    ['Sponges 5 pcs', 2.9, 'e'], ['Matches 10 boxes', 1.5, 'e'], ['Charcoal 3 kg', 12, 'u']]],
];

export const DEMO_SUPPLIERS = [
  { id: 'imereti', name: 'Imereti Dairy', leadDays: 1, orderDays: [1, 3, 5], minQty: 6, multiple: 6, holidays: [] },
  { id: 'bread', name: 'Tbilisi Bread House', leadDays: 1, orderDays: [], minQty: 0, multiple: 1, holidays: [] },
  { id: 'drinks', name: 'Mtkvari Beverages', leadDays: 3, orderDays: [2, 4], minQty: 12, multiple: 6, holidays: [{ from: '2026-10-24', to: '2026-10-27', note: 'Inventory count' }] },
  { id: 'wine', name: 'Alazani Wine Cellar', leadDays: 5, orderDays: [4], minQty: 6, multiple: 6, holidays: [] },
  { id: 'meat', name: 'Kartli Farm Meat', leadDays: 2, orderDays: [1, 4], minQty: 2, multiple: 1, holidays: [] },
  { id: 'greens', name: 'Mtskheta Greens', leadDays: 1, orderDays: [1, 2, 3, 4, 5, 6], minQty: 0, multiple: 1, holidays: [{ from: '2026-10-19', to: '2026-10-20', note: 'Market days off' }] },
  { id: 'wholesale', name: 'Rustavi Wholesale', leadDays: 4, orderDays: [1], minQty: 10, multiple: 5, holidays: [] },
  { id: 'household', name: 'Kolkheti Home Supply', leadDays: 6, orderDays: [3], minQty: 6, multiple: 6, holidays: [] },
];

export const DEMO_CAT_SUPPLIER = Object.fromEntries(CATALOG.map(([cat, , , , sup]) => [cat, sup]));

// Normal deviate (Box–Muller) from the seeded source.
// Box-Muller transform; 1 - next() keeps the log argument in (0, 1], so log(0) = -Infinity cannot occur.
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());

/**
 * The demo sales as a table { headers, rows } in the import format (one line per store × item × week, dated on
 * the last day of the week), so the demo goes through the same mapping and aggregation as a user's file.
 */
export function demoTable(seed = DEMO_SEED) {
  const rng = seededRandom(seed);
  const headers = ['Date', 'SKU', 'Name', 'Category', 'Store', 'Qty', 'Revenue', 'Cost'];
  const rows = [];
  const W = DEMO_WEEKS;
  const storeK = [1, 0.82];
  for (const [cat, code, costK, , , list] of CATALOG) {
    list.forEach(([name, price, prof], i) => {
      const sku = `${code}-${String(i + 1).padStart(2, '0')}`;
      // Weekly base demand per store: a heavy-tailed popularity, cheaper goods sell more units.
      // Log-normal popularity (exp of a normal deviate) gives the heavy tail that makes Pareto / ABC meaningful: a few
      // items sell a lot, most sell little. Dividing by sqrt(price) makes cheap goods sell more units.
      const pop = Math.exp(gauss(rng) * 0.9);
      const base = Math.max(0.6, (pop * 46) / Math.sqrt(price));
      const noise = prof === 's' ? 0.07 : prof === 'e' ? 0.6 : 0.24;
      // New items start 3..7 weeks before the end.
      const start = prof === 'x' ? W - 3 - rng.int(5) : 0;
      const sk = storeK.map((k) => k * (0.65 + rng.next() * 0.7));
      const ck = costK * (0.92 + rng.next() * 0.16);
      for (let w = start; w < W; w++) {
        const day = addDays(DEMO_TODAY, -7 * (W - 1 - w));
        // Season: weeks run from late April to mid October.
        const t = w / (W - 1);
        // Summer items peak mid-period (sine), winter items rise towards October (quadratic).
        const season = prof === 'u' ? 0.55 + 0.9 * Math.sin(Math.PI * Math.min(1, t * 1.15)) : prof === 'w' ? 0.35 + 1.3 * t * t : 1;
        // Promotion: 6% of weeks at 15% off, with a 45% demand lift below.
        const promo = rng.chance(0.06) ? 0.85 : 1;
        for (let s = 0; s < DEMO_STORES.length; s++) {
          let mean = base * season * sk[s] * (promo < 1 ? 1.45 : 1);
          // Erratic items: most weeks almost nothing, occasional spikes, the pattern that lands in Z.
          if (prof === 'e' && !rng.chance(0.45)) mean *= 0.08;
          let qty = Math.round(Math.max(0, mean * (1 + gauss(rng) * noise)));
          if (prof === 'e' && rng.chance(0.08)) qty += Math.round(base * (1 + rng.next() * 3));
          if (!qty) continue;
          const revenue = Math.round(qty * price * promo * 100) / 100;
          rows.push([day, sku, name, cat, DEMO_STORES[s], qty, revenue, Math.round(qty * price * ck * 100) / 100]);
        }
      }
    });
  }
  return { headers, rows };
}

// Perishable categories and their shelf life in days.
export const PERISHABLE = Object.fromEntries(CATALOG.filter((c) => c[3] > 0).map((c) => [c[0], c[3]]));

/** Stock levels of the demo: { key: { stock, inTransit, onOrder } } drawn around the recent sales rate. */
export function demoStock(D, seed = DEMO_SEED) {
  const rng = seededRandom(seed + '/stock');
  const out = {};
  D.stores.forEach((store, s) => {
    for (const it of D.items) {
      const q = D.q[it.id][s];
      // Stock around the last 4 weeks' daily rate: 0..5 days for perishables, 0..16 for others, 8% out of stock, so the
      // planner shows urgent, normal and overstocked rows.
      const rate = q.slice(-4).reduce((t, x) => t + x, 0) / 28;
      if (!(rate > 0) && !D.first[it.id][s]) continue;
      const days = rng.chance(0.08) ? 0 : rng.next() * (PERISHABLE[it.cat] ? 5 : 16);
      const stock = Math.round(rate * days);
      const inTransit = rng.chance(0.1) ? Math.round(rate * (2 + rng.next() * 4)) : 0;
      out[stockKey(store, it.id)] = { stock, inTransit, onOrder: 0 };
    }
  });
  return out;
}

/** Batches of the perishable demo stock with expiry dates around `today`. */
export function demoBatches(D, stock, today, seed = DEMO_SEED) {
  const rng = seededRandom(seed + '/batches');
  const out = [];
  for (const store of D.stores) {
    for (const it of D.items) {
      const life = PERISHABLE[it.cat];
      const st = stock[stockKey(store, it.id)];
      if (!life || !st || !(st.stock > 0)) continue;
      const n = Math.min(st.stock, 1 + rng.int(3));
      let left = st.stock;
      for (let k = 0; k < n; k++) {
        const qty = k === n - 1 ? left : Math.max(1, Math.round(left * (0.3 + rng.next() * 0.4)));
        left -= qty;
        // Expiry spread from 2 days ago to beyond the shelf life, so fresh, expiring and expired batches all occur.
        const expires = addDays(today, -2 + rng.int(life + 3) + k * 2);
        out.push({ store, item: it.id, batch: `L${expires.slice(5).replace('-', '')}${String.fromCharCode(65 + k)}`, expires, qty });
        if (left <= 0) break;
      }
    }
  }
  return out;
}
