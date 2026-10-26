// ledger/rates.js - exchange rates against one base currency and cross conversion through it. A table says how many
// units of X one unit of the base buys: { base: 'GEL', rates: { USD: 0.37, EUR: 0.34 } } (the shape of most rate
// feeds). The table is data the caller brings (fetched, typed, saved): nothing here goes to the network or the clock.
// Conversion of minor units respects both exponents (GEL 2 -> JPY 0) and rounds explicitly.
//
//   normalizeRates(raw) -> { base, rates, day? }       positive finite rates only; the base itself is 1
//   crossRate(from, to, table) -> number | null        from -> base -> to
//   convert(amount, from, to, table) -> number | null  major units, no rounding
//   convertMinor(minor, from, to, table, { rounding }) -> integer | null
//   rebase(table, base) -> table                       the same rates against another base
//   toPairs(table) -> { 'GEL:USD': 0.37, ... }         the pair form of ../payments/money.js convert / rateOf
//   sumIn(amounts, to, table, { rounding }) -> { total, missing }   [{ amount, currency }] in minor units -> one total

//
// Why a single base: N currencies need N rates instead of N^2 pairs, and cross rates are consistent by construction
// (GEL->USD->EUR equals GEL->EUR), which independently quoted pairs are not. Every function accepts a raw table and
// normalises it when it lacks `rates`, so callers can pass feed JSON directly; hot loops (sumIn) should pass a
// normalised table to avoid re-normalising per line.
// Missing rates return null, never 0 or 1: a silent 1:1 conversion would be a plausible-looking wrong number.

import { cleanCurrency, minorUnits, roundNumber } from './minor.js';

export function normalizeRates(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const base = cleanCurrency(o.base) || 'GEL';
  const rates = {};
  const src = o.rates && typeof o.rates === 'object' ? o.rates : {};
  for (const [k, v] of Object.entries(src)) {
    const c = cleanCurrency(k);
    const n = Number(v);
    if (c.length === 3 && Number.isFinite(n) && n > 0) rates[c] = n;
  }
  rates[base] = 1;
  const out = { base, rates };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(o.day || ''))) out.day = o.day;
  return out;
}

const perBase = (cur, t) => (cur === t.base ? 1 : t.rates[cur] > 0 ? t.rates[cur] : null);

export function crossRate(from, to, table) {
  const t = table && table.rates ? table : normalizeRates(table);
  const f = cleanCurrency(from) || t.base, g = cleanCurrency(to) || t.base;
  if (f === g) return 1;
  const a = perBase(f, t), b = perBase(g, t);
  return a == null || b == null ? null : b / a;
}

export function convert(amount, from, to, table) {
  const k = crossRate(from, to, table);
  return k == null ? null : Number(amount) * k;
}

// Minor units of `from` -> minor units of `to`: 1000 GEL (10.00) at 0.37 USD -> 370 USD minor; JPY has no minor unit.
// One multiplication chain then ONE rounding (roundNumber absorbs float noise at 6 decimals) - rounding the major
// amount first and then shifting the exponent would round twice.
export function convertMinor(minor, from, to, table, { rounding = 'half-up' } = {}) {
  const k = crossRate(from, to, table);
  if (k == null) return null;
  const shift = minorUnits(cleanCurrency(to) || 'XXX') - minorUnits(cleanCurrency(from) || 'XXX');
  return roundNumber((Math.trunc(Number(minor)) || 0) * k * 10 ** shift, rounding);
}

export function rebase(table, base) {
  const t = table && table.rates ? table : normalizeRates(table);
  const b = cleanCurrency(base);
  const k = perBase(b, t);
  if (k == null) return null;
  const rates = {};
  for (const [c, v] of Object.entries(t.rates)) rates[c] = c === b ? 1 : v / k;
  return { ...t, base: b, rates };
}

export function toPairs(table) {
  const t = table && table.rates ? table : normalizeRates(table);
  const out = {};
  for (const [c, v] of Object.entries(t.rates)) if (c !== t.base) out[t.base + ':' + c] = v;
  return out;
}

// One total of amounts in several currencies; each amount is converted and rounded on its own, then summed (the
// rounding is per line, as a statement would show it). Currencies without a rate are listed in `missing`.
export function sumIn(amounts, to, table, { rounding = 'half-up' } = {}) {
  let total = 0;
  const missing = new Set();
  for (const a of amounts || []) {
    if (!a) continue;
    const v = convertMinor(a.amount, a.currency, to, table, { rounding });
    if (v == null) missing.add(cleanCurrency(a.currency));
    else total += v;
  }
  return { total, missing: [...missing] };
}
