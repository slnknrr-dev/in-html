// bitcoin/coinselect.js - coin selection after Bitcoin Core: effective values (value minus the fee of spending the
// coin at the current rate), branch and bound for a changeless selection with the least waste, a knapsack solver with
// change as the fallback (Core's ApproximateBestSubset), largest-first and the waste metric that ranks them.
//
//   selectCoins({ utxos: [{ value, weight | type | spendInfo, …any }], target, feeRate, baseWeight,
//     changeWeight = 124 (a P2WPKH output), changeSpendWeight = 272, longTermFeeRate = 10, minChange (dust, 294),
//     include = [] (utxos that must be spent, coin control), algorithm = 'auto' | 'bnb' | 'knapsack' | 'largest',
//     rng = Math.random, maxTries = 100000 })
//   -> { inputs, fee, change, weight, vsize, waste, algorithm, excess } | throws Error with code 'insufficient'
//   target: sum of the payments; baseWeight: transaction overhead + payment outputs (fees.js txWeight without inputs).
//   waste(inputs, excess, feeRate, longTermFeeRate)
//
// Concepts (Core's coin selection, src/wallet/coinselection.cpp):
// - Effective value (ev) = value - fee to spend the coin now. Selecting on ev instead of value makes every algorithm
//   fee-aware: a coin with ev <= 0 costs more to spend than it is worth and is never chosen voluntarily.
// - Waste = sum over inputs of (fee at current rate - fee at long-term rate) + (cost of change if change, else the
//   excess dropped to fees). Spending many inputs when fees are low is cheap consolidation (negative waste); when fees
//   are high it is waste. Candidates of all algorithms are ranked by it, as in Core's ChooseSelectionResult.
// - Changeless (BnB) is preferred for privacy too: no change output means no change-detection heuristic for chain
//   analysis to apply.
// - rng defaults to Math.random: selection randomness (knapsack, change position) needs unpredictability against
//   casual fingerprinting, not cryptographic strength; tests inject a seeded rng.
import { inputWeight } from './fees.js';

const vbytes = (w) => w / 4;
// Fees round up (a fee 1 sat short of the rate fails mempool acceptance); the 1e-9 epsilon stops float noise such as
// 68 * 1.1 = 74.80000000000001 from rounding an exact value up by a whole satoshi.
const fee = (w, rate) => Math.ceil(vbytes(w) * rate - 1e-9);

// Core's GetSelectionWaste: Σ (fee − long-term fee) of the inputs + (change ? cost of change : excess).
export function waste(inputs, excessOrChangeCost, feeRate, longTermFeeRate) {
  let w = excessOrChangeCost;
  for (const u of inputs) w += fee(u.weight, feeRate) - fee(u.weight, longTermFeeRate);
  return w;
}

function prepare(utxos, feeRate) {
  return utxos.map((u) => {
    const weight = u.weight ?? inputWeight(u.spendInfo || u.type || 'p2wpkh');
    return { utxo: u, value: u.value, weight, ev: u.value - fee(weight, feeRate) };
  });
}

// Depth-first branch and bound over coins sorted by effective value (descending): the selection whose effective value
// lies in [target, target + costOfChange] with the least waste.
// Pruning: suffix[i] (sum of remaining ev) cuts branches that can no longer reach the target; overshooting
// target + costOfChange cuts branches where creating change would have been cheaper. The window
// [target, target + costOfChange] is what makes "no change" rational: any excess within it costs less than a change
// output plus its later spend. maxTries bounds the exponential worst case (Core uses 100000 too); the best found so
// far is returned, so a timeout degrades quality, not correctness.
function bnb(pool, target, costOfChange, feeRate, longTermFeeRate, maxTries) {
  const coins = pool.filter((c) => c.ev > 0).sort((a, b) => b.ev - a.ev);
  const suffix = new Array(coins.length + 1).fill(0);
  for (let i = coins.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + coins[i].ev;
  if (suffix[0] < target) return null;
  let best = null, bestWaste = Infinity, tries = 0;
  const sel = [];
  const feeDiff = coins.map((c) => fee(c.weight, feeRate) - fee(c.weight, longTermFeeRate));
  const walk = (i, value, wst) => {
    if (++tries > maxTries) return;
    if (value + suffix[i] < target || value > target + costOfChange) return;
    // With rates above the long-term rate, adding inputs only increases waste.
    if (wst > bestWaste && feeRate > longTermFeeRate) return;
    if (value >= target) {
      const total = wst + (value - target);
      if (total <= bestWaste) { bestWaste = total; best = [...sel]; }
      return;
    }
    if (i >= coins.length) return;
    sel.push(coins[i]);
    walk(i + 1, value + coins[i].ev, wst + feeDiff[i]);
    sel.pop();
    // Skip equivalent coins (same effective value and fee) after excluding one of them.
    let j = i + 1;
    while (j < coins.length && coins[j].ev === coins[i].ev && coins[j].weight === coins[i].weight) j++;
    walk(j, value, wst);
  };
  walk(0, 0, 0);
  return best ? { coins: best, waste: bestWaste } : null;
}

// Core's ApproximateBestSubset: 1000 random passes for the smallest total >= target.
// Pass 0 includes each coin with probability 1/2, pass 1 adds the rest greedily; on reaching the target the last coin
// is removed again to keep searching for a tighter fit. A stochastic subset-sum heuristic: cheap, randomized (so
// repeated payments do not pick identical coin sets), no optimality guarantee.
function approximateBestSubset(coins, total, target, rng, iterations = 1000) {
  let best = coins.map(() => true), bestValue = total;
  const included = coins.map(() => false);
  for (let rep = 0; rep < iterations && bestValue !== target; rep++) {
    included.fill(false);
    let value = 0, reached = false;
    for (let pass = 0; pass < 2 && !reached; pass++) {
      for (let i = 0; i < coins.length; i++) {
        if (pass === 0 ? rng() < 0.5 : !included[i]) {
          value += coins[i].ev;
          included[i] = true;
          if (value >= target) {
            reached = true;
            if (value < bestValue) { bestValue = value; best = [...included]; }
            value -= coins[i].ev;
            included[i] = false;
          }
        }
      }
    }
  }
  return { picks: coins.filter((_, i) => best[i]), value: bestValue };
}

// Core's KnapsackSolver order: an exact single coin; all smaller coins if they sum exactly; the smallest larger coin
// if the smaller ones are not enough; else the random subset, replaced by the smallest larger coin when that is no
// worse.
function knapsack(pool, target, rng) {
  const coins = pool.filter((c) => c.ev > 0);
  const exact = coins.find((c) => c.ev === target);
  if (exact) return [exact];
  const smaller = coins.filter((c) => c.ev < target).sort((a, b) => b.ev - a.ev);
  const larger = coins.filter((c) => c.ev > target).sort((a, b) => a.ev - b.ev)[0] || null;
  const totalSmaller = smaller.reduce((s, c) => s + c.ev, 0);
  if (totalSmaller === target) return smaller;
  if (totalSmaller < target) return larger ? [larger] : null;
  const r = approximateBestSubset(smaller, totalSmaller, target, rng);
  if (larger && (r.value !== target && larger.ev <= r.value)) return [larger];
  return r.picks;
}

function largestFirst(pool, target) {
  const out = [];
  let v = 0;
  for (const c of pool.filter((x) => x.ev > 0).sort((a, b) => b.ev - a.ev)) { out.push(c); v += c.ev; if (v >= target) return out; }
  return null;
}

export function selectCoins({
  utxos, target, feeRate, baseWeight, changeWeight = 124, changeSpendWeight = 272, longTermFeeRate = 10, minChange = 294,
  include = [], algorithm = 'auto', rng = Math.random, maxTries = 100000,
}) {
  // `!(x > 0)` also rejects NaN / undefined, which `x <= 0` would let through.
  // include: coin control by object identity (the caller passes the same utxo objects it got from the wallet).
  // need: what the pool must still cover in effective value after the forced coins; costOfChange: creating the change
  // output now + spending it later at the long-term rate (Core's cost_of_change).
  if (!(feeRate > 0)) throw new Error('fee rate must be positive');
  const pool = prepare(utxos.filter((u) => !include.includes(u)), feeRate);
  const forced = prepare(include, feeRate);
  const forcedEv = forced.reduce((s, c) => s + c.ev, 0);
  const baseFee = fee(baseWeight, feeRate);
  const need = target + baseFee - forcedEv; // effective value still needed from the pool
  const costOfChange = fee(changeWeight, feeRate) + fee(changeSpendWeight, longTermFeeRate);
  const candidates = [];
  // Turns a coin set into a concrete result with real (not effective) values: change only when it reaches minChange
  // (dust: an output worth less than the cost of spending it is non-standard to relay); otherwise the remainder goes
  // to the fee. BnB results are changeless by construction.
  const finish = (coins, algo) => {
    const all = [...forced, ...coins];
    const inputWeightSum = all.reduce((s, c) => s + c.weight, 0);
    const total = all.reduce((s, c) => s + c.value, 0);
    const noChangeFee = fee(baseWeight + inputWeightSum, feeRate);
    if (total < target + noChangeFee) return;
    const withChangeFee = fee(baseWeight + inputWeightSum + changeWeight, feeRate);
    let change = total - target - withChangeFee;
    let f, weight, wst;
    if (change >= minChange && algo !== 'bnb') {
      f = withChangeFee; weight = baseWeight + inputWeightSum + changeWeight;
      wst = waste(all, costOfChange, feeRate, longTermFeeRate);
    } else {
      change = 0; f = total - target; weight = baseWeight + inputWeightSum;
      wst = waste(all, total - target - noChangeFee, feeRate, longTermFeeRate);
    }
    candidates.push({ inputs: all.map((c) => c.utxo), fee: f, change, weight, vsize: Math.ceil(weight / 4), waste: wst, algorithm: algo, excess: change ? 0 : total - target - noChangeFee });
  };
  if (need <= 0) finish([], 'include');
  else {
    if (algorithm === 'auto' || algorithm === 'bnb') { const r = bnb(pool, need, costOfChange, feeRate, longTermFeeRate, maxTries); if (r) finish(r.coins, 'bnb'); }
    // Knapsack aims at the target plus the change it will create.
    const changeTarget = need + fee(changeWeight, feeRate) + minChange;
    if (algorithm === 'auto' || algorithm === 'knapsack') {
      const k = knapsack(pool, changeTarget, rng) || knapsack(pool, need, rng);
      if (k) finish(k, 'knapsack');
    }
    if (algorithm === 'auto' || algorithm === 'largest') {
      const l = largestFirst(pool, changeTarget) || largestFirst(pool, need);
      if (l) finish(l, 'largest');
    }
  }
  if (!candidates.length) {
    const available = [...pool, ...forced].reduce((s, c) => s + c.value, 0);
    throw Object.assign(new Error('insufficient funds'), { code: 'insufficient', available, needed: target + baseFee });
  }
  // Least waste wins; ties go to fewer inputs (smaller tx, fewer addresses linked together on chain).
  candidates.sort((a, b) => a.waste - b.waste || a.inputs.length - b.inputs.length);
  return candidates[0];
}
