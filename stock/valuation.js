// stock/valuation.js - stock valuation in integer minor units: line amounts (quantity × unit cost, rounded half
// away from zero), the cumulative average cost of receipts, the perpetual moving average (issues at the current
// average), and FIFO layers with the cost of goods sold. Quantities may be fractional (weight goods).

const EPS = 1e-9;
const q6 = (x) => Math.round(x * 1e6) / 1e6;

// Half away from zero after trimming float noise (0.1 × 3 × 100 must round as 30, not 30.000000000000004).
// toPrecision(15) discards the binary noise beyond double's reliable decimal digits before rounding, so values that
// are exact in decimal (0.1 x 3 x 100) round the way an accountant expects.
export function roundMinor(x) {
  const v = Number(x.toPrecision(15));
  return Math.sign(v) * Math.round(Math.abs(v));
}

export const lineAmount = (qty, unitCost) => roundMinor(qty * unitCost);

/**
 * Average purchase cost over receipts with a known cost (the "cost now" summary: receipts only, issues do not move
 * it). receipts: [{ qty, cost } | { qty, amount }] -> { qty, amount, unit } (unit null when nothing was received).
 */
export function averageCost(receipts) {
  let qty = 0, amount = 0;
  for (const r of receipts) {
    if (r.amount == null && r.cost == null) continue;
    qty = q6(qty + r.qty);
    amount += r.amount ?? lineAmount(r.qty, r.cost);
  }
  return { qty, amount, unit: qty > EPS ? amount / qty : null };
}

// Value of `stock` units at the average cost of the receipts.
export function averageValue(stock, receipts) {
  const { unit } = averageCost(receipts);
  return unit == null ? 0 : lineAmount(Math.max(0, stock), unit);
}

/**
 * Perpetual moving average. moves in time order: { qty > 0, cost } receipts, { qty < 0 } issues (sales, write-offs).
 * The value is carried in minor units; an issue takes value × issued ÷ on hand, so the last unit takes exactly what
 * is left (no rounding residue stays in an empty stock). -> { qty, value, unit, cogs, short }
 */
// Value is tracked as a running total in minor units rather than as a unit cost, so no rounding residue accumulates:
// the last issue takes exactly the remaining value and an empty stock always has value 0. Issues beyond the stock
// are not costed (reported in `short`), because their cost is unknown until the stock is received.
export function movingAverage(moves) {
  let qty = 0, value = 0, cogs = 0, short = 0;
  for (const m of moves) {
    if (m.qty > 0) {
      qty = q6(qty + m.qty);
      value += m.amount ?? lineAmount(m.qty, m.cost ?? 0);
    } else if (m.qty < 0) {
      const out = Math.min(-m.qty, qty);
      const v = out >= qty - EPS ? value : roundMinor((value * out) / qty);
      cogs += v;
      value -= v;
      qty = q6(qty - out);
      short = q6(short + (-m.qty - out));
    }
  }
  return { qty, value, unit: qty > EPS ? value / qty : null, cogs, short };
}

/**
 * FIFO layers. Same moves as movingAverage; issues take the oldest layers first.
 * -> { layers: [{ qty, cost }], qty, value, cogs, short } (short: issued beyond the stock, not costed)
 */
// FIFO layers carry a unit cost; each issue is costed per layer with its own rounding, so the total COGS can differ
// from a single-rounding computation by up to one minor unit per layer touched.
export function fifoValuation(moves) {
  const layers = [];
  let cogs = 0, short = 0;
  for (const m of moves) {
    if (m.qty > 0) layers.push({ qty: m.qty, cost: m.cost ?? (m.amount != null ? m.amount / m.qty : 0) });
    else if (m.qty < 0) {
      let left = -m.qty;
      while (left > EPS && layers.length) {
        const l = layers[0];
        const take = Math.min(left, l.qty);
        cogs += lineAmount(take, l.cost);
        l.qty = q6(l.qty - take);
        left = q6(left - take);
        if (l.qty <= EPS) layers.shift();
      }
      short = q6(short + left);
    }
  }
  const qty = q6(layers.reduce((t, l) => t + l.qty, 0));
  return { layers: layers.map((l) => ({ ...l })), qty, value: layers.reduce((t, l) => t + lineAmount(l.qty, l.cost), 0), cogs, short };
}

// Gross margin of a sale in minor units and percent of revenue (null percent for zero revenue).
export function margin(revenue, cogs) {
  const profit = revenue - cogs;
  return { profit, pct: revenue ? Math.round((profit / revenue) * 1000) / 10 : null };
}
