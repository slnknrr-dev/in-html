// bitcoin/spend.js - building wallet transactions as PSBTs: coin selection with coin control, change, send-max,
// replace-by-fee signalling, PSBT inputs and outputs filled with everything a signer needs (UTXOs, scripts, BIP-32 /
// taproot derivations, tap leaves), fee bumping by RBF (BIP-125 rules 3 and 4) and child-pays-for-parent.
//
// A wallet coin (utxo): { txid, vout, value, script, spendInfo (account.js spendInfo), prevTx? (Transaction or hex:
//   needed to spend legacy outputs), confirmations? }
//
//   createSpend({ utxos, recipients: [{ address | script, value } | { address, max: true }], feeRate, change
//     (spendInfo of the change address), network, rbf = true, locktime = 0, include = [], onlyInclude = false,
//     algorithm = 'auto', rng, txVersion = 2 }) -> { psbt, fee, vsize, feeRate, change: { value, index } | null,
//     inputs, outputs, algorithm }
//   psbtInputFields(utxo) / psbtOutputFields(spendInfo)
//   bumpFee({ psbt | tx, spent: [utxo per input], newFeeRate, changeIndex, change (spendInfo), extraUtxos = [],
//     incrementalRelayFee = 1, network }) -> { psbt, fee, vsize, feeRate, added: [utxos] }
//   cpfp({ parent: { txid, vsize, fee }, utxos: [our outputs of the parent], feeRate (target for the package),
//     destination (spendInfo or { script }), network }) -> { psbt, fee, vsize, packageFeeRate }
//   minimumBumpFee(oldFee, newVsize, newFeeRate, incrementalRelayFee) -> sats
//
// Design: this module never touches private keys. It produces an unsigned PSBT with every field a signer needs, so the
// same output can go to a hardware wallet, an air-gapped signer or psbt.js. Fees are computed from size *estimates*
// (fees.js, worst-case signature sizes), so the final rate is at or slightly above the target, never below.
// Privacy choices: change at a random output position; RBF signalled by default (0xfffffffd, also what Core does);
// locktime 0 by default - KNOWN DEFECT (privacy, not funds): Core sets nLockTime to the current height (anti fee
// sniping), so locktime 0 fingerprints transactions as made by this wallet. Fix: pass the tip height as
// `locktime` from callers that know it (and keep sequences < 0xffffffff so it is enforced).
import { hexToBytes } from '../crypto/encoding.js';
import { Psbt } from './psbt.js';
import { Transaction, RBF_SEQUENCE, MAX_SEQUENCE } from './tx.js';
import { toOutputScript } from './address.js';
import { selectCoins } from './coinselect.js';
import { inputWeight, outputSize, txWeight, feeFor, dustThreshold } from './fees.js';
import { classify } from './script.js';

const asTx = (t) => (t instanceof Transaction ? t : typeof t === 'string' ? Transaction.fromHex(t) : t);
const scriptOfRecipient = (r, network) => (r.script ? (typeof r.script === 'string' ? hexToBytes(r.script) : r.script) : toOutputScript(r.address, network));

// PSBT input fields for a coin. nonWitnessUtxo (the full previous tx) is included whenever known, also for segwit v0:
// BIP-143 commits only to the input's own amount, so a signer that sees only witnessUtxo can be tricked across two
// signing sessions into paying a huge fee (CVE-2020-14199); hardware wallets therefore demand the full tx. For legacy
// inputs it is mandatory (the amount is otherwise unauthenticated). witnessUtxo is added for segwit (cheaper to check).
export function psbtInputFields(u) {
  const info = u.spendInfo || {};
  const f = {};
  const t = classify(u.script).type;
  const segwit = t === 'p2wpkh' || t === 'p2wsh' || t === 'p2tr' || (t === 'p2sh' && info.redeemScript && /^p2w/.test(classify(info.redeemScript).type));
  if (u.prevTx) f.nonWitnessUtxo = asTx(u.prevTx);
  if (segwit) f.witnessUtxo = { value: u.value, script: u.script };
  if (info.redeemScript) f.redeemScript = info.redeemScript;
  if (info.witnessScript) f.witnessScript = info.witnessScript;
  if (info.bip32Derivation && info.bip32Derivation.length) f.bip32Derivation = info.bip32Derivation.map((d) => ({ ...d }));
  if (info.tapInternalKey) f.tapInternalKey = info.tapInternalKey;
  if (info.tapMerkleRoot) f.tapMerkleRoot = info.tapMerkleRoot;
  if (info.tapBip32Derivation && info.tapBip32Derivation.length) f.tapBip32Derivation = info.tapBip32Derivation.map((d) => ({ ...d }));
  if (info.leaves && info.leaves.length) f.tapLeafScripts = info.leaves.map((l) => ({ controlBlock: l.controlBlock, script: l.script, leafVersion: l.leafVersion }));
  return f;
}

// Output fields mark our change: a signer that can derive the output's key from these derivations shows it as change
// instead of as a payment, which is how users see "you send X" rather than X + change.
export function psbtOutputFields(info) {
  if (!info) return {};
  const f = {};
  if (info.redeemScript) f.redeemScript = info.redeemScript;
  if (info.witnessScript) f.witnessScript = info.witnessScript;
  if (info.bip32Derivation && info.bip32Derivation.length) f.bip32Derivation = info.bip32Derivation.map((d) => ({ ...d }));
  if (info.tapInternalKey) f.tapInternalKey = info.tapInternalKey;
  if (info.tapBip32Derivation && info.tapBip32Derivation.length) f.tapBip32Derivation = info.tapBip32Derivation.map((d) => ({ ...d }));
  return f;
}

// nSequence: 0xfffffffd signals RBF (< 0xfffffffe) and enables nLockTime; its bit 31 (disable flag) is set, so BIP-68
// relative locktime does not apply. 0xfffffffe enables nLockTime without RBF; 0xffffffff on every input disables
// nLockTime entirely (IsFinalTx ignores the locktime when all inputs are final).
function assemble({ inputs, outputs, rbf, locktime, txVersion }) {
  const seq = rbf ? RBF_SEQUENCE : locktime ? 0xfffffffe : MAX_SEQUENCE;
  const p = Psbt.create({ version: txVersion, locktime, inputs: inputs.map((u) => ({ txid: u.txid, vout: u.vout, sequence: u.sequence ?? seq })), outputs: outputs.map((o) => ({ script: o.script, value: o.value })) });
  inputs.forEach((u, i) => Object.assign(p.inputs[i], psbtInputFields(u)));
  outputs.forEach((o, i) => Object.assign(p.outputs[i], psbtOutputFields(o.info)));
  return p;
}

export function createSpend({
  utxos, recipients, feeRate, change, network = 'mainnet', rbf = true, locktime = 0, include = [], onlyInclude = false,
  algorithm = 'auto', rng = Math.random, txVersion = 2, longTermFeeRate = 10,
}) {
  // Validation first (fail fast, before any selection work): positive safe-integer amounts, at most one send-max
  // recipient, nothing below the dust threshold (a dust output makes the whole tx non-standard: it would not relay).
  if (!recipients || !recipients.length) throw new Error('no recipients');
  const pays = recipients.map((r) => ({ script: scriptOfRecipient(r, network), value: r.value, max: !!r.max }));
  const maxCount = pays.filter((p) => p.max).length;
  if (maxCount > 1) throw new Error('only one recipient can receive the maximum');
  for (const p of pays) if (!p.max && (!Number.isSafeInteger(p.value) || p.value <= 0)) throw new Error('every amount must be a positive number of satoshis');
  for (const p of pays) if (!p.max && p.value < dustThreshold(p.script)) throw Object.assign(new Error('amount below the dust limit'), { code: 'dust', dust: dustThreshold(p.script) });
  const pool = onlyInclude ? include : utxos;
  if (maxCount) {
    // Send max: every allowed coin, no change. All coins are spent, including ones with negative effective value
    // (that is what "empty the wallet" means; use coin control to leave uneconomic dust behind).
    const coins = pool.length ? pool : utxos;
    const others = pays.filter((p) => !p.max).reduce((s, p) => s + p.value, 0);
    const weight = txWeight({ inputs: coins.map((u) => u.spendInfo || u.type || 'p2wpkh'), outputs: pays.map((p) => p.script) });
    const fee = feeFor(Math.ceil(weight / 4), feeRate);
    const total = coins.reduce((s, u) => s + u.value, 0);
    const maxValue = total - others - fee;
    const mp = pays.find((p) => p.max);
    if (maxValue < dustThreshold(mp.script)) throw Object.assign(new Error('insufficient funds'), { code: 'insufficient', available: total, needed: others + fee + dustThreshold(mp.script) });
    mp.value = maxValue;
    const outputs = pays.map((p) => ({ script: p.script, value: p.value }));
    const psbt = assemble({ inputs: coins, outputs, rbf, locktime, txVersion });
    return { psbt, fee, vsize: Math.ceil(weight / 4), feeRate: fee / Math.ceil(weight / 4), change: null, inputs: coins, outputs, algorithm: 'max' };
  }
  if (!change || !change.script) throw new Error('a change address is needed');
  const target = pays.reduce((s, p) => s + p.value, 0);
  // + 2 WU assumes a segwit transaction (marker + flag); for an all-legacy selection that overpays half a vbyte -
  // the safe direction for an estimate.
  const baseWeight = txWeight({ inputs: [], outputs: pays.map((p) => p.script) }) + 2; // + segwit marker and flag
  const sel = selectCoins({
    utxos: onlyInclude ? [] : pool, include, target, feeRate, baseWeight, changeWeight: outputSize(change.script) * 4,
    changeSpendWeight: inputWeight(change), longTermFeeRate, minChange: dustThreshold(change.script), algorithm, rng,
  });
  const outputs = pays.map((p) => ({ script: p.script, value: p.value }));
  let changeOut = null;
  if (sel.change > 0) {
    // The change goes to a random position (no fingerprint "change is last").
    const index = Math.floor(rng() * (outputs.length + 1));
    outputs.splice(index, 0, { script: change.script, value: sel.change, info: change });
    changeOut = { value: sel.change, index };
  }
  const psbt = assemble({ inputs: sel.inputs, outputs, rbf, locktime, txVersion });
  return { psbt, fee: sel.fee, vsize: sel.vsize, feeRate: sel.fee / sel.vsize, change: changeOut, inputs: sel.inputs, outputs, algorithm: sel.algorithm };
}

// BIP-125 rule 4: the replacement pays for its own bandwidth at the incremental relay fee on top of the old fee.
// (Rule 3, absolute fee >= the replaced fee, follows from it.) Not covered: the fees of descendants the replacement
// would evict also count toward rule 3 - a bump of a tx with unconfirmed children may need more than this minimum.
export const minimumBumpFee = (oldFee, newVsize, newFeeRate, incrementalRelayFee = 1) =>
  Math.max(feeFor(newVsize, newFeeRate), oldFee + feeFor(newVsize, incrementalRelayFee));

// RBF fee bump keeping every original input (a replacement must conflict with the original; keeping all inputs also
// invalidates every version of it). The fee comes out of the change output; when change would fall below dust it is
// dropped (remainder to fees); when even that is not enough, extra coins are added one at a time and a change output
// is created for them. Each loop iteration recomputes the size, since adding an input or dropping change changes it.
export function bumpFee({ psbt = null, tx = null, spent, newFeeRate, changeIndex = null, change = null, extraUtxos = [], incrementalRelayFee = 1, network = 'mainnet' }) {
  const t = psbt ? psbt.tx() : asTx(tx);
  if (!t.signalsRbf()) throw new Error('the transaction does not signal replace-by-fee (BIP-125)');
  if (spent.length !== t.inputs.length) throw new Error('the spent output of every input is needed');
  const oldFee = spent.reduce((s, u) => s + u.value, 0) - t.outputs.reduce((s, o) => s + o.value, 0);
  const inputs = t.inputs.map((inp, k) => ({ ...spent[k], txid: inp.txid, vout: inp.vout, sequence: Math.min(inp.sequence, RBF_SEQUENCE) }));
  const outputs = t.outputs.map((o, k) => ({ script: o.script, value: o.value, info: k === changeIndex ? change : null }));
  const added = [];
  const vsizeOf = () => Math.ceil(txWeight({ inputs: inputs.map((u) => u.spendInfo || u.type || 'p2wpkh'), outputs: outputs.map((o) => o.script) }) / 4);
  for (;;) {
    const vsize = vsizeOf();
    const needFee = minimumBumpFee(oldFee, vsize, newFeeRate, incrementalRelayFee);
    const total = inputs.reduce((s, u) => s + u.value, 0);
    const pay = outputs.reduce((s, o, k) => s + (k === changeIndex ? 0 : o.value), 0);
    if (changeIndex !== null && changeIndex < outputs.length) {
      const left = total - pay - needFee;
      if (left >= dustThreshold(outputs[changeIndex].script)) {
        outputs[changeIndex].value = left;
        const p = assemble({ inputs, outputs, rbf: true, locktime: t.locktime, txVersion: t.version });
        return { psbt: p, fee: needFee, vsize, feeRate: needFee / vsize, added };
      }
      if (left >= 0 && !extraUtxos.length) {
        // The change would be dust: drop it, the rest goes to the fee.
        outputs.splice(changeIndex, 1);
        changeIndex = null;
        continue;
      }
    } else if (total - pay >= needFee) {
      const p = assemble({ inputs, outputs, rbf: true, locktime: t.locktime, txVersion: t.version });
      return { psbt: p, fee: total - pay, vsize, feeRate: (total - pay) / vsize, added };
    }
    const next = extraUtxos.shift();
    if (!next) throw Object.assign(new Error('insufficient funds to bump the fee'), { code: 'insufficient' });
    inputs.push({ ...next, sequence: RBF_SEQUENCE });
    added.push(next);
    if (changeIndex === null && change) { outputs.push({ script: change.script, value: 0, info: change }); changeIndex = outputs.length - 1; }
  }
}

// Child pays for parent: miners select by package (ancestor) fee rate, so the child pays
// rate * (parent vsize + child vsize) - parent fee, but at least 1 sat/vB for its own size so it relays on its own.
// Only accounts for one unconfirmed parent; further unconfirmed ancestors would lower the real package rate.
export function cpfp({ parent, utxos, feeRate, destination, network = 'mainnet', rbf = true }) {
  if (!utxos.length) throw new Error('an output of the parent transaction is needed');
  const script = destination.script || toOutputScript(destination.address, network);
  const vsize = Math.ceil(txWeight({ inputs: utxos.map((u) => u.spendInfo || u.type || 'p2wpkh'), outputs: [script] }) / 4);
  const fee = Math.max(feeFor(parent.vsize + vsize, feeRate) - parent.fee, vsize);
  const total = utxos.reduce((s, u) => s + u.value, 0);
  const value = total - fee;
  if (value < dustThreshold(script)) throw Object.assign(new Error('the output is too small to pay for its parent'), { code: 'insufficient' });
  const psbt = assemble({ inputs: utxos, outputs: [{ script, value, info: destination.script ? destination : null }], rbf, locktime: 0, txVersion: 2 });
  return { psbt, fee, vsize, packageFeeRate: (parent.fee + fee) / (parent.vsize + vsize) };
}
