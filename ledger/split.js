// ledger/split.js - the split cascade: an ordered list of rules { party, article, method } that shares one base
// amount. Three methods and no expression language: `pct` (a percentage OF THE BASE, not of what is left), `fixed`
// (minor units) and `rest` (everything left, including the rounding unit - the lock that keeps the parts equal to the
// base). Percentages are integers in hundredths of a percent, for the same reason money is in minor units: 12.5 % must
// be 1250, not 12.499999999999998.
//
//   PCT_SCALE = 100, PCT_FULL = 10000           1 = 0.01 %, 10000 = 100 %
//   toPct(v) -> 0..10000                        human input: 12.5 / '12,5' -> 1250
//   fromPct(p) -> number                        1250 -> 12.5
//   SPLIT_METHODS, isSplitMethod
//   normalizeSplitRule(raw) -> rule | null      idempotent: `value` is canonical, `pct` / `amount` are form input
//   normalizeSplit(raw) -> rules                one `rest`, last; extra rests become pct 0 (visible, not dropped)
//   distribute(base, rules, { rounding, exact }) -> { rows, allocated, unallocated }
//   allocationOp(row) -> { partyId, article, kind, amount }   the sign of a share becomes the journal kind

import { MONEY_MAX, allocate, mulDiv, toMinor } from './minor.js';
import { cleanArticle, cleanArticleName, cleanId } from './parties.js';

export const PCT_SCALE = 100;
export const PCT_FULL = 100 * PCT_SCALE;

// Only the first ',' is replaced: '12,5' -> 12.5; grouped input like '1 000' is not a percentage and becomes 0.
export function toPct(v) {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(PCT_FULL, Math.round(n * PCT_SCALE)));
}
export const fromPct = (p) => (Math.trunc(Number(p)) || 0) / PCT_SCALE;
export const clampPct = (v) => Math.max(0, Math.min(PCT_FULL, Math.trunc(Number(v)) || 0));

export const SPLIT_METHODS = ['pct', 'fixed', 'rest'];
export const isSplitMethod = (v) => SPLIT_METHODS.includes(String(v ?? ''));
export const SPLIT_METHOD_I18N = {
  pct: { en: '% of base', ru: '% от базы', ka: '% ბაზიდან' },
  fixed: { en: 'fixed', ru: 'фиксировано', ka: 'ფიქსირებული' },
  rest: { en: 'remainder', ru: 'остаток', ka: 'ნაშთი' },
};

export const SPLIT_MAX_RULES = 24;

/**
 * A rule from anything, IDEMPOTENTLY: its own output fed back gives the same rule. One field has two spellings that
 * differ by NAME, not by size: `value` is canonical (hundredths of a percent or minor units, as stored), `pct` /
 * `amount` are what a form sends ('20', '35.00'). Telling 20 % from 0.2 % (= 20 hundredths) by the number is
 * impossible, and a form that reads the canonical 2000 and saves it again must not make it 100 %.
 * A fixed amount is kept as its absolute value: the direction comes from the journal kind, not from a sign.
 */
export function normalizeSplitRule(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const partyId = cleanId(o.partyId);
  if (partyId == null) return null;
  const method = isSplitMethod(o.method) ? o.method : 'pct';
  const value = method === 'pct'
    ? (o.pct !== undefined ? toPct(o.pct) : clampPct(o.value))
    : method === 'fixed'
      ? Math.min(MONEY_MAX, o.amount !== undefined ? Math.abs(toMinor(o.amount)) : Math.abs(Math.trunc(Number(o.value)) || 0))
      : 0;
  const rule = { partyId, article: cleanArticle(o.article), method, value };
  const name = cleanArticleName(o.name);
  if (Object.keys(name).length) rule.name = name;
  return rule;
}

// The whole cascade in application order with the one `rest` last. A second rest cannot be satisfied (two parties
// cannot both get everything that is left); it becomes `pct 0`, so a form shows it as zero instead of losing it.
export function normalizeSplit(raw) {
  const list = (Array.isArray(raw) ? raw : []).map(normalizeSplitRule).filter(Boolean).slice(0, SPLIT_MAX_RULES);
  const rest = list.filter((r) => r.method === 'rest');
  const others = list.filter((r) => r.method !== 'rest');
  for (const extra of rest.slice(1)) others.push({ ...extra, method: 'pct', value: 0 });
  return [...others, ...rest.slice(0, 1)];
}

/**
 * Shares a base (minor units) by the cascade. Percentages and fixed amounts are each taken FROM THE BASE; the rest rule
 * takes the difference, so with a rest the rows always sum to the base (`unallocated` 0). Without a rest the shortfall
 * stays visible in `unallocated`; it is negative when fixed amounts exceed the base (a month without bookings and a
 * paid cleaning) - the rest row then is negative too, a debt, not a zero.
 *
 * Rounding: every pct row is round(base * pct / 10000) with `rounding` (default half away from zero). With
 * `exact: true` the pct rows are computed together - their total is the rounded total percentage and it is split
 * among them by largest remainder - so 3 × 33.33 % of 100 never drifts by a unit even without a rest rule.
 * An empty cascade gives nobody anything: everything stays unallocated (no default owner by guesswork).
 */
export function distribute(baseMinor, rules, { rounding = 'half-up', exact = false } = {}) {
  const base = Math.trunc(Number(baseMinor)) || 0;
  const live = (rules || []).filter((r) => r && cleanId(r.partyId) != null);
  const rest = live.find((r) => r.method === 'rest') || null;
  const pctRules = live.filter((r) => r.method === 'pct');
  const pctAmounts = new Map();
  if (exact && pctRules.length) {
    const sum = pctRules.reduce((s, r) => s + clampPct(r.value), 0);
    const total = sum ? mulDiv(base, sum, PCT_FULL, rounding) : 0;
    allocate(total, pctRules.map((r) => clampPct(r.value))).forEach((a, i) => pctAmounts.set(pctRules[i], sum ? a : 0));
  } else {
    for (const r of pctRules) pctAmounts.set(r, mulDiv(base, clampPct(r.value), PCT_FULL, rounding));
  }
  // Rows keep the cascade's order (rest excluded, appended last) so the UI shows them as configured.
  const rows = [];
  let taken = 0;
  for (const r of live) {
    if (r.method === 'rest') continue;
    const amount = r.method === 'pct' ? pctAmounts.get(r) : Math.trunc(Number(r.value)) || 0;
    taken += amount;
    rows.push({ partyId: r.partyId, article: r.article || '', method: r.method, amount });
  }
  if (rest) {
    rows.push({ partyId: rest.partyId, article: rest.article || '', method: 'rest', amount: base - taken });
    return { rows, allocated: base, unallocated: 0 };
  }
  return { rows, allocated: taken, unallocated: base - taken };
}

/**
 * A share -> a journal operation: the SIGN becomes the KIND, exactly once and explicitly. A negative rest is a
 * deduction from that party, never an accrual of its absolute value (that would create money out of nothing and the
 * journal would still agree with itself).
 */
export function allocationOp(a) {
  const amount = Math.trunc(Number(a && a.amount)) || 0;
  return {
    partyId: cleanId(a && a.partyId),
    article: String((a && a.article) || ''),
    kind: amount < 0 ? 'deduction' : 'accrual',
    amount: Math.abs(amount),
  };
}
