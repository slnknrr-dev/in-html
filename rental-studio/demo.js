// rental-studio/demo.js - the seeded demo project: a family agency in Batumi managing three short-let flats for two
// owners. Four months of bookings around `today` (two months back, the current one and the next), seasons, weekday
// rates, length-of-stay discounts, fees, a closed period, a calculation web (cleaning and the agency from a service
// pool, the owner's rest, the owner's tax, the surplus to the agency), accruals and an owner payout already posted for
// the first months, a building expense split by area, and leads with viewings (one clash on purpose). Deterministic
// for a given `today`: the same day gives the same demo.

import { dayAdd, monthAdd, monthStart, nightsBetween } from '../booking/days.js';
import { appendOps, dueByCurrency } from '../ledger/journal.js';
import { payoutOps, payoutPlan } from '../ledger/kpi.js';
import { expenseOps, normalizeProject, postBookings, unitQuote } from './calc.js';

// Small seeded generator (mulberry32): the demo must not change between two loads of the same day.
// mulberry32: 32-bit state, good statistical quality for its size, a few integer ops per number. Math.random cannot
// be seeded, and a demo that changed on every reload would confuse a first-time user comparing pages.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GUESTS = ['Anna Kowalska', 'Levan Gelashvili', 'Olga Smirnova', 'Mehmet Yilmaz', 'Sophie Martin', 'Dmitry Volkov', 'Tamar Kapanadze',
  'Lukas Schneider', 'Maria Garcia', 'Irakli Lomidze', 'Elena Petrova', 'Ahmed Hassan', 'Nata Chikovani', 'Jan Novak', 'Oksana Bondar',
  'Giorgi Mchedlishvili', 'Laura Rossi', 'Ali Aliyev', 'Ekaterina Orlova', 'Tom Baker', 'Salome Japaridze', 'Yusuf Demir',
  'Ivan Kozlov', 'Chloé Bernard', 'David Kiknadze', 'Pablo Ruiz', 'Natalia Lysenko', 'Ketevan Tsereteli', 'Max Weber', 'Aysel Mammadova'];
const CHANNELS = ['direct', 'airbnb', 'booking', 'airbnb', 'booking', 'phone', 'direct', 'booking'];

// Seed = a simple polynomial hash of the date string, so the demo changes daily (dates stay "around today") but is
// stable within a day across pages and reloads. Prices are in minor units (11000 = 110.00 GEL). The demo goes
// through the same calc.js functions as user actions (unitQuote, postBookings, expenseOps), so it doubles as an
// integration exercise of the money pipeline.
export function makeDemo(today) {
  const r = rng([...today].reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const start = monthAdd(monthStart(today), -2);
  const end = monthAdd(start, 4);
  const y0 = +start.slice(0, 4), y1 = +end.slice(0, 4);

  const seasons = (k, idBase) => {
    const out = [];
    for (let y = y0 - 1; y <= y1; y++) {
      out.push({ kind: 'price', from: `${y}-06-15`, to: `${y}-09-01`, price: Math.round(k * 1.45 / 100) * 100, minNights: 3, note: 'High season', id: idBase + out.length });
      out.push({ kind: 'price', from: `${y}-12-28`, to: `${y + 1}-01-08`, price: Math.round(k * 1.7 / 100) * 100, minNights: 4, note: 'New Year', id: idBase + out.length });
    }
    return out;
  };
  const closeFrom = dayAdd(monthAdd(start, 3), 9);

  const p = {
    v: 1, name: 'Kristina House · Batumi', currency: 'GEL', rates: { USD: 2.71, EUR: 2.93 }, ratesDay: today,
    parties: [
      { id: 'p1', kind: 'owner', name: 'Nino Beridze', note: 'Owner of two flats' },
      { id: 'p2', kind: 'owner', name: 'Giorgi Abashidze', note: '' },
      { id: 'p3', kind: 'agency', name: 'Kristina House', note: 'Family agency, Batumi' },
      { id: 'p4', kind: 'cleaner', name: 'Manana (cleaning)', note: '' },
      { id: 'p5', kind: 'tax', name: 'Revenue Service', note: '5 % of rental income' },
    ],
    units: [
      {
        id: 'u1', name: 'Sea-view studio · Gogebashvili 12', area: 34, guestsMax: 2, ownerId: 'p1', color: '#0f766e',
        price: {
          base: 11000, per: 'day', weekdayRates: { 4: 13000, 5: 13000 }, minNights: 2, maxNights: 60,
          rules: seasons(11000, 1), discounts: [{ nights: 7, pct: 10 }, { nights: 28, pct: 25 }],
          cleaning: 3500, fees: [{ name: 'Tourist tax', amount: 300, per: 'guest_night', after: 0 }], deposit: 20000,
        },
      },
      {
        id: 'u2', name: 'Two rooms · Old Batumi, Mazniashvili 7', area: 58, guestsMax: 4, ownerId: 'p1', color: '#7c3aed',
        price: {
          base: 15500, per: 'day', weekdayRates: { 4: 17500, 5: 17500 }, minNights: 2, maxNights: 60,
          rules: seasons(15500, 10), discounts: [{ nights: 7, pct: 8 }, { nights: 28, pct: 22 }],
          cleaning: 4500, fees: [{ name: 'Extra guest', amount: 2000, per: 'guest_night', after: 2 }], deposit: 30000,
        },
      },
      {
        id: 'u3', name: 'Family flat · New Boulevard, Sherif Khimshiashvili 3', area: 76, guestsMax: 5, ownerId: 'p2', color: '#c2410c',
        price: {
          base: 21000, per: 'day', weekdayRates: { 5: 24000 }, minNights: 3, maxNights: 90,
          rules: [...seasons(21000, 20), { kind: 'block', from: closeFrom, to: dayAdd(closeFrom, 4), note: 'Owner stays', id: 40 }],
          discounts: [{ nights: 7, pct: 10 }, { nights: 21, pct: 18 }],
          cleaning: 6000, fees: [], deposit: 40000,
        },
      },
    ],
    bookings: [],
    web: {
      v: 1,
      nodes: [
        { id: 'src', kind: 'source', source: 'booking', x: 60, y: 120 },
        { id: 'sur', kind: 'source', source: 'surplus', x: 60, y: 320 },
        { id: 'svc', kind: 'pool', name: { en: 'Service', ru: 'Сервис', ka: 'სერვისი' }, x: 260, y: 60 },
        { id: 'own', kind: 'party', role: 'owner', x: 460, y: 160 },
        { id: 'agn', kind: 'party', partyId: 'p3', x: 460, y: 300 },
        { id: 'cln', kind: 'party', partyId: 'p4', x: 460, y: 40 },
        { id: 'tax', kind: 'party', partyId: 'p5', x: 660, y: 160 },
      ],
      edges: [
        { id: 'e1', from: 'src', to: 'svc', method: 'pct', pct: 25, article: '', ord: 0 },
        { id: 'e2', from: 'src', to: 'own', method: 'rest', article: 'rent', ord: 1 },
        { id: 'e3', from: 'svc', to: 'cln', method: 'fixed', amount: 40, unit: 'booking', article: 'cleaning', ord: 0 },
        { id: 'e4', from: 'svc', to: 'agn', method: 'rest', article: 'commission', ord: 1 },
        { id: 'e5', from: 'own', to: 'tax', method: 'pct', pct: 5, article: 'tax', ord: 0 },
        { id: 'e6', from: 'sur', to: 'agn', method: 'rest', article: 'surplus', ord: 0 },
      ],
    },
    journal: [],
    expenses: 0,
    leads: [],
  };

  let proj = normalizeProject(p);

  // Bookings are generated through the real quote so they respect minimum stays, seasons and closed dates; a refused
  // quote just moves the cursor one day.
  // Bookings: each flat walks from the start with short gaps and stays of 2-8 nights (about 13 per flat).
  let n = 0;
  for (const u of proj.units) {
    let day = dayAdd(start, Math.floor(r() * 3));
    while (nightsBetween(day, end) > 2) {
      let nights = 2 + Math.floor(r() * (r() < 0.25 ? 10 : 5));
      const guests = 1 + Math.floor(r() * u.guestsMax);
      let q = unitQuote(proj, u, { from: day, to: dayAdd(day, nights), guests });
      if (!q.ok && q.error === 'too_short') { nights = q.minNights; q = unitQuote(proj, u, { from: day, to: dayAdd(day, nights), guests }); }
      if (!q.ok) { day = dayAdd(day, 1); continue; }
      n++;
      const to = dayAdd(day, nights);
      const future = day > today;
      const roll = r();
      const status = future && roll < 0.18 ? 'pending' : roll > 0.95 ? 'cancelled' : 'confirmed';
      const surplus = r() < 0.15 ? 2000 + Math.floor(r() * 4) * 1000 : 0;
      proj.bookings.push({
        id: 'b' + n, unitId: u.id, guest: GUESTS[(n * 7 + Math.floor(r() * 5)) % GUESTS.length], contact: '+995 5' + String(10000000 + Math.floor(r() * 89999999)).slice(0, 8),
        guests, from: day, to, channel: CHANNELS[Math.floor(r() * CHANNELS.length)], status,
        total: q.total + surplus, surplus, note: surplus ? 'Late booking, sea-view premium' : '',
      });
      day = dayAdd(to, r() < 0.2 ? 0 : 2 + Math.floor(r() * 7));
    }
  }

  // Journal history: accruals of the first two months, the owners paid out for the first month, a building expense.
  const m1 = monthAdd(start, 1), m2 = monthAdd(start, 2);
  const early = proj.bookings.filter((b) => b.from < m2).map((b) => b.id);
  proj.journal = postBookings(proj, early).journal;
  for (const o of proj.parties.filter((x) => x.kind === 'owner')) {
    const before = proj.journal.filter((x) => x.day < m1);
    const plan = payoutPlan(dueByCurrency(before, o.id), proj.currency);
    const r2 = appendOps(proj.journal, payoutOps(plan, { partyId: o.id, day: dayAdd(m1, 4), note: 'Bank transfer' }));
    if (r2.ok) proj.journal = r2.journal;
  }
  const ex = expenseOps(proj, { total: 27000, article: 'utilities', by: 'area', day: dayAdd(m2, -1), note: 'Building service, lift and water' });
  const r3 = appendOps(proj.journal, ex.ops);
  if (r3.ok) { proj.journal = r3.journal; proj.expenses++; }

  // Leads: long-term rent, a sale and management offers, with viewings by two agents (one clash on purpose).
  const d = (k) => dayAdd(today, k);
  proj.leads = [
    { id: 'l1', name: 'Irina Sokolova', contact: '+995 555 120 330', unitId: 'u2', kind: 'rent', budget: 180000, status: 'show', note: 'Long-term from next month, one cat', created: d(-6), shows: [{ at: d(1) + 'T11:00', minutes: 45, agent: 'kristina' }] },
    { id: 'l2', name: 'Thomas Müller', contact: 'thomas.m@example.com', unitId: 'u3', kind: 'rent', budget: 250000, status: 'show', note: 'Winter months, remote work', created: d(-4), shows: [{ at: d(1) + 'T11:30', minutes: 30, agent: 'kristina' }] },
    { id: 'l3', name: 'Zurab Kvaratskhelia', contact: '+995 599 44 12 01', unitId: '', kind: 'manage', budget: 0, status: 'new', note: 'Has a flat in Gonio, wants it managed', created: d(-1), shows: [] },
    { id: 'l4', name: 'Aylin Kaya', contact: '+90 532 000 11 22', unitId: 'u1', kind: 'stay', budget: 90000, status: 'thinking', note: 'Asked for a monthly price', created: d(-12), shows: [{ at: d(-8) + 'T16:00', minutes: 30, agent: 'nino' }] },
    { id: 'l5', name: 'Pavel Orlov', contact: '+7 916 000 00 00', unitId: 'u3', kind: 'sale', budget: 14500000, status: 'shown', note: 'Buyer, compares with new builds', created: d(-20), shows: [{ at: d(-15) + 'T12:00', minutes: 60, agent: 'nino' }] },
    { id: 'l6', name: 'Mariam Gogitidze', contact: '+995 577 31 31 31', unitId: 'u2', kind: 'rent', budget: 160000, status: 'deal', note: 'Signed for six months', created: d(-30), shows: [{ at: d(-26) + 'T10:00', minutes: 30, agent: 'kristina' }] },
    { id: 'l7', name: 'John Carter', contact: 'jc@example.org', unitId: 'u1', kind: 'stay', budget: 0, status: 'refused', note: 'Found a hotel', created: d(-9), shows: [] },
    { id: 'l8', name: 'Elene Abuladze', contact: '+995 551 77 00 99', unitId: 'u3', kind: 'rent', budget: 230000, status: 'new', note: 'Family of four, from December', created: d(0), shows: [{ at: d(2) + 'T15:00', minutes: 30, agent: 'nino' }] },
  ];
  return normalizeProject(proj);
}
