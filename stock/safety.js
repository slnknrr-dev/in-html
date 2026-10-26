// stock/safety.js - service levels and safety stock: the inverse normal distribution (Acklam's rational
// approximation, relative error < 1.2e-9), the normal CDF, safety stock z · σ(daily demand) · √(lead days) from the
// weekly standard deviation of an ABC/XYZ class, and the reorder point.
//
// Model assumptions, stated so they can be challenged: daily demand is normal and independent between days (so
// sigma scales with the square root of time), lead time is fixed (no lead-time variance term), and the service level
// is a cycle service level (probability of no stockout per replenishment cycle), not a fill rate.

const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155211639];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
const LOW = 0.02425;

// Service level (probability) -> z. 0 and 1 give -Infinity / Infinity, anything outside [0, 1] NaN.
// Acklam's algorithm: a rational approximation in the central region and a different one in each tail (below
// p = 0.02425 and symmetric above), switching at the point where each is most accurate.
export function zOf(p) {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p < LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  if (p > 1 - LOW) return -zOf(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}

// Standard normal CDF (z -> service level), Abramowitz & Stegun 26.2.17 (absolute error < 7.5e-8).
export function normCdf(z) {
  if (Number.isNaN(z)) return NaN;
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * poly;
  return z >= 0 ? 1 - tail : tail;
}

// Safety units for a z, a daily standard deviation and a lead time: always whole units, rounded up, never negative.
// A lead time under one day counts as one day (an order never arrives "instantly").
// Rounded up: a fractional safety unit cannot be stocked, and rounding down would undershoot the service level.
// The 1e-9 guard stops a float like 3.0000000001 from becoming 4.
export function safetyUnits(z, sdDaily, leadDays) {
  if (!(z > 0) || !(sdDaily > 0)) return 0;
  return Math.ceil(z * sdDaily * Math.sqrt(Math.max(1, leadDays || 0)) - 1e-9);
}

/**
 * Safety stock of an ABC/XYZ class: { serviceLevel, z, safety }.
 * cls: { cell, sdWeekly } (from abc.js classify); service: { AX: 0.98, … }. A class without a cell (a new item,
 * XYZ undefined) or without demand variation gets no safety stock; the service level is still reported when known.
 */
export function safetyStock(cls, leadDays, service) {
  const level = cls?.cell ? service?.[cls.cell] ?? null : null;
  if (level == null || !cls.sdWeekly) return { serviceLevel: level, z: level == null ? null : zOf(level), safety: 0 };
  const z = zOf(level);
  // Weekly σ -> daily σ assuming independent days: σ_week = σ_day · √7.
  return { serviceLevel: level, z, safety: safetyUnits(z, cls.sdWeekly / Math.sqrt(7), leadDays) };
}

// Reorder point: expected demand over the lead time plus the safety stock (whole units, rounded up).
export const reorderPoint = (ratePerDay, leadDays, safety = 0) => Math.ceil(Math.max(0, ratePerDay) * Math.max(0, leadDays) - 1e-9) + safety;
