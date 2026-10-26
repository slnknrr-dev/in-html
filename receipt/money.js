// receipt/money.js - exact money arithmetic on integer minor units (tetri, cents): integer division with an
// explicit rounding mode, quantity × price for quantities with up to three decimals (weight goods), percentages
// with up to four decimals, largest-remainder allocation (a discount or a payment split across lines so that the
// parts always add up to the whole), parsing typed amounts and plain formatting for receipts.
//
// Rounding modes: 'half-up' (half away from zero, the usual cash register rule), 'half-even' (banker's),
// 'down' (towards zero), 'up' (away from zero).
//
// Why integers: binary floats cannot represent 0.10 exactly, so float money drifts (0.1 + 0.2 !== 0.3) and two
// systems summing the same receipt disagree by a tetri. All amounts are integer minor units, every operation that
// can produce a fraction (multiplication by a quantity or a percentage, division) rounds exactly once, explicitly,
// with a named mode, and BigInt takes over the rare products that leave the 2^53 safe range.

const SAFE = Number.MAX_SAFE_INTEGER;

/** a ÷ b for integers, rounded by `mode`. Exact: beyond 2^53 the division runs on BigInt. */
export function divRound(a, b, mode = 'half-up') {
  if (!Number.isInteger(a) || !Number.isInteger(b) || b === 0) throw new RangeError('integers expected, divisor non-zero');
  if (Math.abs(a) > SAFE) throw new RangeError('dividend beyond 2^53: pass the factors to mulDivRound');
  return mulDivRound(a, 1, b, mode);
}

/** a × m ÷ b for integers without overflow (BigInt when the product leaves the safe range), rounded by `mode`. */
export function mulDivRound(a, m, b, mode = 'half-up') {
  if (!Number.isInteger(a) || !Number.isInteger(m) || !Number.isInteger(b) || b === 0) throw new RangeError('integers expected, divisor non-zero');
  const p = a * m;
  if (Math.abs(p) <= SAFE) return roundQuotient(p, b, mode, Number);
  return Number(roundQuotient(BigInt(a) * BigInt(m), BigInt(b), mode, BigInt));
}

// Generic over Number and BigInt (T is the constructor) so both paths share one rounding implementation. Works on
// the absolute value and restores the sign at the end, which makes 'half-up' round half away from zero and 'down'
// truncate toward zero for negative amounts (returns), as cash registers do.
function roundQuotient(n, d, mode, T) {
  const zero = T(0), one = T(1), two = T(2);
  if (d < zero) { n = -n; d = -d; }
  const neg = n < zero;
  const an = neg ? -n : n;
  let q = T === Number ? Math.floor(an / d) : an / d;
  let r = an - q * d;
  // A float quotient near 2^53 may be one off: correct it so 0 <= r < d.
  while (r < zero) { q -= one; r += d; }
  while (r >= d) { q += one; r -= d; }
  if (r !== zero) {
    const twice = r * two;
    if (mode === 'up') q += one;
    else if (mode === 'half-up') { if (twice >= d) q += one; }
    else if (mode === 'half-even') { if (twice > d || (twice === d && q % two !== zero)) q += one; }
    else if (mode !== 'down') throw new RangeError(`unknown rounding mode: ${mode}`);
  }
  return neg ? -q : q;
}

// Quantity in thousandths (0.375 kg -> 375): the precision of retail scales.
// Quantities are converted to integer thousandths before multiplying, so 2.5 x 333 is 2500 x 333 / 1000 in integers;
// Math.round absorbs float noise in the typed quantity (0.1 + 0.2 kg).
export const qtyMilli = (qty) => Math.round(Number(qty) * 1000);

// Line amount: quantity × unit price, rounded once (2.5 × 333 -> 833 with half-up).
export const lineAmount = (qty, price, mode = 'half-up') => mulDivRound(qtyMilli(qty), price, 1000, mode);

// pct % of an amount (pct up to four decimals: 12.5 -> 12.5 %).
export const percentOf = (amount, pct, mode = 'half-up') => mulDivRound(amount, Math.round(Number(pct) * 10000), 1_000_000, mode);

/**
 * Splits `total` over integer `weights` (usually line amounts) proportionally so the parts add up to `total` exactly (largest remainder; ties go to
 * the earlier index). All-zero weights split evenly. A negative total gives negative parts.
 */
// Largest-remainder (Hamilton) apportionment: floor every proportional share, then hand the leftover units one by one
// to the largest remainders. Guarantees sum(parts) === total exactly, which proportional rounding of each part alone
// cannot (three lines of 1/3 each would round to 0.33 + 0.33 + 0.33).
export function allocate(total, weights) {
  const n = weights.length;
  if (!n) return [];
  const sign = total < 0 ? -1 : 1, t = Math.abs(total);
  const w = weights.map((x) => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0);
  const ws = sum > 0 ? w : w.map(() => 1);
  const S = sum > 0 ? sum : n;
  const parts = ws.map((x) => mulDivRound(t, x, S, 'down'));
  let rest = t - parts.reduce((a, b) => a + b, 0);
  // Remainders compared exactly as t·w mod S (BigInt keeps them exact for any size).
  const rem = ws.map((x, i) => ({ i, r: (BigInt(t) * BigInt(x)) % BigInt(S) }));
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) parts[rem[k].i]++;
  return parts.map((p) => p * sign);
}

/**
 * Amount typed by a person -> minor units, or null. '12,5' / '12.50' / '1 234,56' / '-3' (digits = 2).
 * The last '.' or ',' is the decimal separator, earlier ones group digits ('1.234,5'); more decimals than
 * `digits` are rounded half up ('0.005' -> 1).
 */
// The last separator is the decimal mark ('1.234,56' and '1,234.56' both work). Ambiguity: '1,234' is read as 1.234,
// not one thousand, because a typed amount with a group separator but no decimals is rare at a till.
// Numbers go through toPrecision(15) to drop float noise (1.005 * 100 = 100.49999...) before rounding.
export function parseMoney(text, digits = 2) {
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(Number((text * 10 ** digits).toPrecision(15))) : null;
  let s = String(text ?? '').trim().replace(/[\s  '_]/g, '');
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const sep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let int = s, frac = '';
  if (sep >= 0) {
    int = s.slice(0, sep).replace(/[.,]/g, '');
    frac = s.slice(sep + 1);
  }
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac) || !(int + frac)) return null;
  const padded = (frac + '0'.repeat(digits + 1)).slice(0, digits + 1);
  let v = Number(int || '0') * 10 ** digits + Number(padded.slice(0, digits) || '0');
  if (+padded[digits] >= 5) v++;
  return neg ? -v : v;
}

/**
 * Minor units -> text: formatMoney(123456) -> '1234.56'; options: digits (2), decimal ('.'), group ('' or ' '),
 * plus (true -> '+1.00' for positive amounts).
 */
export function formatMoney(minor, { digits = 2, decimal = '.', group = '', plus = false } = {}) {
  const neg = minor < 0;
  const s = String(Math.abs(Math.trunc(minor))).padStart(digits + 1, '0');
  let int = digits ? s.slice(0, -digits) : s;
  const frac = digits ? s.slice(-digits) : '';
  if (group) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return (neg ? '-' : plus && minor > 0 ? '+' : '') + int + (digits ? decimal + frac : '');
}

// Rounds a cash amount to the smallest coin in circulation (e.g. step 5 -> nearest 0.05), half up.
export const roundCash = (amount, step = 1) => (step > 1 ? mulDivRound(amount, 1, step, 'half-up') * step : amount);
