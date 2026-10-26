// ethereum/fees.js - fee suggestions: EIP-1559 levels from eth_feeHistory, legacy gas prices, the exact next base fee.
//
//   suggestFees(feeHistory, { baseFeeMultiplier = 2, fallbackPriorityFee = 10^9 }) -> { baseFee, slow, normal, fast }
//       feeHistory: the result of eth_feeHistory with reward percentiles [10, 50, 90] (raw '0x…' JSON or
//       rpc.js feeHistory()); baseFee is the base fee of the next block (the last baseFeePerGas entry); each level
//       is { maxPriorityFeePerGas, maxFeePerGas = baseFee x baseFeeMultiplier + maxPriorityFeePerGas } with the
//       priority fee the median over the non-empty blocks of that percentile (fallbackPriorityFee when every
//       block was empty); levels never decrease from slow to fast.
//   legacyGasPrice(gasPrice) -> { slow, normal, fast }: { gasPrice } at 100 %, 110 %, 125 % of eth_gasPrice
//   nextBaseFee({ baseFeePerGas, gasUsed, gasLimit }, { elasticity = 2, denominator = 8 }) -> bigint
//       EIP-1559: base fee x (1 ± (gasUsed - target) / target / denominator), the increase at least 1 wei;
//       OP-stack chains use other parameters (e.g. elasticity 6, denominator 250).
//   feeCost(gasLimit, { maxFeePerGas | gasPrice }) -> bigint (the most the transaction can pay for gas)
import { fromQuantity, toBigInt } from './units.js';

// Accepts raw JSON-RPC ('0x…' quantities) and already-formatted bigints, so one code path serves both rpc.js outputs.
const asBig = (v) => (typeof v === 'string' && /^0x/i.test(v) ? fromQuantity(v) : toBigInt(v, 'fee'));

// Fractional multipliers (1.25) in fixed point with 3 decimals: bigint has no fractions and converting the fee to a
// double would lose wei above 2^53. Math.round on m * 1000 keeps 1.125 exact; finer precision is not meaningful here.
function scale(value, multiplier) {
  if (typeof multiplier === 'bigint') return value * multiplier;
  const m = Number(multiplier);
  if (!(m >= 0) || !Number.isFinite(m)) throw new Error('multiplier must be a non-negative number');
  return (value * BigInt(Math.round(m * 1000))) / 1000n;
}

// Explicit comparator: Array.prototype.sort compares as strings by default ("10" < "9"), and a - b fails on bigint
// because the comparator must return a number. Even-length median floors (bigint division).
function median(values) {
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2n;
}

// Median, not mean: a single block with a huge MEV tip would drag a mean far above what normal inclusion needs.
// Empty blocks (gasUsedRatio 0) report reward 0 and are excluded, otherwise idle periods suggest a zero tip that never
// gets included once traffic returns. maxFeePerGas = 2 x baseFee + tip survives six consecutive full blocks (+12.5 %
// each, 1.125^6 ~ 2.03) before the transaction becomes unincludable; the unused part is refunded, so overshoot is free.
// The running max (prev) keeps slow <= normal <= fast even when percentile columns are noisy.
export function suggestFees(feeHistory, { baseFeeMultiplier = 2, fallbackPriorityFee = 1000000000n } = {}) {
  const bases = (feeHistory.baseFeePerGas || []).map(asBig);
  if (!bases.length) throw new Error('feeHistory without baseFeePerGas');
  const baseFee = bases[bases.length - 1];
  const ratios = feeHistory.gasUsedRatio || [];
  const rewards = (feeHistory.reward || []).map((row) => row.map(asBig));
  const levels = ['slow', 'normal', 'fast'];
  const out = { baseFee };
  let prev = 0n;
  levels.forEach((level, i) => {
    const column = rewards.filter((row, b) => row.length > i && Number(ratios[b] ?? 1) > 0).map((row) => row[i]);
    let tip = median(column);
    if (tip == null) tip = toBigInt(fallbackPriorityFee, 'fallbackPriorityFee');
    if (tip < prev) tip = prev;
    prev = tip;
    out[level] = { maxPriorityFeePerGas: tip, maxFeePerGas: scale(baseFee, baseFeeMultiplier) + tip };
  });
  return out;
}

export function legacyGasPrice(gasPrice) {
  const p = asBig(gasPrice);
  return { slow: { gasPrice: p }, normal: { gasPrice: (p * 110n) / 100n }, fast: { gasPrice: (p * 125n) / 100n } };
}

// EIP-1559 base fee update, in integer arithmetic exactly as clients do it (order of the divisions matters for rounding):
//   target = gasLimit / elasticity
//   above target: base + max(1, base * (used - target) / target / denominator)   -- the 1 wei floor guarantees growth
//   below target: base - base * (target - used) / target / denominator            -- no floor: it may reach 0
// With denominator 8 one block moves the fee by at most 12.5 %.
export function nextBaseFee(parent, { elasticity = 2, denominator = 8 } = {}) {
  const base = asBig(parent.baseFeePerGas);
  const used = asBig(parent.gasUsed);
  const target = asBig(parent.gasLimit) / BigInt(elasticity);
  const d = BigInt(denominator);
  if (target === 0n) return base;
  if (used === target) return base;
  if (used > target) {
    const delta = (base * (used - target)) / target / d;
    return base + (delta > 1n ? delta : 1n);
  }
  return base - (base * (target - used)) / target / d;
}

export function feeCost(gasLimit, level) {
  return toBigInt(gasLimit, 'gasLimit') * asBig(level.maxFeePerGas ?? level.gasPrice);
}
