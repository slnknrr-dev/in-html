// newbuild-board/demo.js - the seeded demo project: a two-building complex in Batumi, 16 floors, two sections of three
// units per floor (six per floor), prices in US dollars as developers there quote them, a hand-entered GEL rate, six
// layout types with room trees, a deterministic sale history. Pure: no DOM, no clock (dates are fixed).
//
// Why generated, not a stored JSON: 192 units with consistent prices and histories are a few lines of rules here,
// versus a large literal that would drift from the model. Determinism (seeded RNG, fixed dates) keeps screenshots,
// e2e assertions and every user's first view identical.
import { unitPrice } from '../estate/chessboard.js';

// Layout types: rooms as estate/rooms.js trees (a zone has `parent`; a kitchen-living room is one room).
export const DEMO_LAYOUTS = {
  S: { key: 'S', area: 31.5, rooms: [
    { key: 'main', type: 'room', area: 21.8 }, { key: 'kitchen', type: 'kitchen', parent: 'main' },
    { key: 'bath', type: 'bath', area: 4.1 }, { key: 'hall', type: 'hallway', area: 3.4 }, { key: 'balcony', type: 'balcony', area: 2.2 }] },
  E2: { key: 'E2', area: 44.8, rooms: [
    { key: 'living', types: ['living', 'kitchen'], area: 18.0 }, { key: 'bed1', type: 'bedroom', area: 13.6 },
    { key: 'bath', type: 'bath', area: 4.6 }, { key: 'hall', type: 'hallway', area: 5.2 }, { key: 'balcony', type: 'balcony', area: 3.4 }] },
  E3: { key: 'E3', area: 62.4, rooms: [
    { key: 'living', types: ['living', 'kitchen'], area: 22.0 }, { key: 'bed1', type: 'bedroom', area: 13.2 }, { key: 'bed2', type: 'bedroom', area: 11.0 },
    { key: 'bath', type: 'bath', area: 4.8 }, { key: 'hall', type: 'hallway', area: 7.0 }, { key: 'balcony', type: 'balcony', area: 4.4 }] },
  R2: { key: 'R2', area: 54.6, rooms: [
    { key: 'kitchen', type: 'kitchen', area: 9.6 }, { key: 'living', type: 'living', area: 16.8 }, { key: 'bed1', type: 'bedroom', area: 12.6 },
    { key: 'bath', type: 'bath', area: 4.4 }, { key: 'hall', type: 'hallway', area: 7.0 }, { key: 'balcony', type: 'balcony', area: 4.2 }] },
  E3B: { key: 'E3B', area: 68.9, rooms: [
    { key: 'living', types: ['living', 'kitchen'], area: 24.5 }, { key: 'bed1', type: 'bedroom', area: 14.2 }, { key: 'bed2', type: 'bedroom', area: 11.6 },
    { key: 'bath', type: 'bath', area: 4.2 }, { key: 'bath2', type: 'bath', area: 3.1 }, { key: 'hall', type: 'hallway', area: 6.9 }, { key: 'balcony', type: 'balcony', area: 4.4 }] },
  E4: { key: 'E4', area: 94.2, rooms: [
    { key: 'living', types: ['living', 'kitchen'], area: 30.4 }, { key: 'bed1', type: 'bedroom', area: 16.0 }, { key: 'bed2', type: 'bedroom', area: 12.4 },
    { key: 'bed3', type: 'bedroom', area: 11.2 }, { key: 'bath', type: 'bath', area: 5.2 }, { key: 'bath2', type: 'bath', area: 3.4 },
    { key: 'hall', type: 'hallway', area: 9.0 }, { key: 'balcony', type: 'balcony', area: 6.6 }] },
};

// Positions 1..6 on a floor: section 1 holds 1-3, section 2 holds 4-6.
const RISERS = [
  { layout: 'S', rooms: 0, view: 'sea' }, { layout: 'E2', rooms: 2, view: 'sea' }, { layout: 'E3', rooms: 3, view: 'city' },
  { layout: 'R2', rooms: 2, view: 'mountain' }, { layout: 'E3B', rooms: 3, view: 'sea' }, { layout: 'E4', rooms: 4, view: 'sea' },
];
// Price multipliers by view (sea views command a premium); E4 gets a 2% large-unit discount below.
const VIEW_K = { sea: 1.08, mountain: 1.03, city: 1, yard: 0.97 };

// mulberry32: a small deterministic generator, so the demo is the same on every device.
// 32-bit state, Math.imul for exact 32-bit multiplication (plain * would lose bits past 2^53); returns [0, 1).
// Math.random cannot be seeded, which is the whole reason for this function.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const day = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function demoProject() {
  const rnd = rng(2026);
  const buildings = [
    // rate = price per m² in minor units (115000 = $1 150.00); ready = year * 10 + quarter; sold / reserved = shares.
    { id: 'A', name: 'Block A', ready: 20272, handover: '2027-06-30', rate: 115000, sold: 0.5, reserved: 0.12, listed: day(2025, 2, 1) },
    { id: 'B', name: 'Block B', ready: 20281, handover: '2028-03-31', rate: 104000, sold: 0.16, reserved: 0.08, listed: day(2025, 9, 15) },
  ];
  const units = [];
  for (const b of buildings) {
    for (let floor = 1; floor <= 16; floor++) {
      for (let pos = 1; pos <= 6; pos++) {
        const r = RISERS[pos - 1];
        const area = DEMO_LAYOUTS[r.layout].area;
        // +1.2% per floor (height premium), times the view factor; prices rounded to $100 (10000 minor units).
        const k = (1 + 0.012 * (floor - 1)) * VIEW_K[r.view] * (r.layout === 'E4' ? 0.98 : 1);
        const raised = unitPrice(area, Math.round(b.rate * k), 10000);
        const old = unitPrice(area, Math.round(b.rate * k * 0.94), 10000);
        // The number of rnd() calls per unit varies (sold units draw dates), yet the sequence stays deterministic.
        const x = rnd();
        let status = x < b.sold ? 'sold' : x < b.sold + b.reserved ? 'reserved' : 'free';
        // Developer's reserve: the two top corner units of A, the ground-floor units of B's first section (sales office).
        if ((b.id === 'A' && floor === 16 && pos >= 5) || (b.id === 'B' && floor === 1 && pos <= 3)) status = 'closed';
        let soldOn = '';
        if (status === 'sold') {
          // A month between the listing and September 2026 (month index = year * 12 + month - 1).
          const from = b.id === 'A' ? 2025 * 12 + 2 : 2025 * 12 + 9, to = 2026 * 12 + 8;
          const idx = from + Math.floor(rnd() * (to - from + 1));
          soldOn = day(Math.floor(idx / 12), (idx % 12) + 1, 1 + Math.floor(rnd() * 27));
        }
        // The price list of March 2026 raised prices; a unit sold before it keeps the price it was sold at.
        const raise = day(2026, 3, 1);
        const price = soldOn && soldOn < raise ? old : raised;
        const history = [{ d: b.listed, s: 'free', p: old, by: 'demo' }];
        if (price !== old) history.push({ d: raise, p: price, by: 'demo' });
        if (soldOn) history.push({ d: soldOn, s: 'sold', by: 'demo' });
        else if (status === 'reserved') history.push({ d: day(2026, 9, 2 + Math.floor(rnd() * 26)), s: 'reserved', by: 'demo' });
        else if (status === 'closed') history.push({ d: b.listed, s: 'closed', by: 'demo' });
        // ISO day strings sort chronologically as plain strings.
        history.sort((p, q) => (p.d < q.d ? -1 : p.d > q.d ? 1 : 0));
        units.push({
          id: `${b.id}-${floor * 100 + pos}`, building: b.id, section: pos <= 3 ? '1' : '2', floor, flat: String(floor * 100 + pos),
          position: pos, area, rooms: r.rooms, price, status, view: r.view, layout: r.layout, history,
        });
      }
    }
  }
  return {
    v: 1,
    complex: {
      slug: 'black-sea-terrace',
      name: { en: 'Black Sea Terrace', ru: 'Блэк Си Террас', ka: 'შავი ზღვის ტერასა' },
      address: 'Batumi, Adjara, Georgia (demo address)',
      developer: 'Demo Developer',
      currency: 'USD',
      gelRate: 2.7,
      note: '',
    },
    buildings: buildings.map(({ id, name, ready, handover }) => ({ id, name, ready, handover })),
    // Deep copy: the project must not share layout objects with the exported constant (edits would leak into it).
    layouts: JSON.parse(JSON.stringify(DEMO_LAYOUTS)),
    units,
  };
}
