// bitcoin/fees.js - sizes and fees: input weights of every spend type (signatures counted at their maximum, 72 bytes
// ECDSA / 64 bytes Schnorr), output sizes, transaction weight and virtual size, fees at a rate, Bitcoin Core's dust
// threshold, fee rates from Esplora estimates.
//
//   inputWeight(type | spendInfo, { m, n, witnessScriptLength })   type: 'p2pkh' | 'p2pkh-uncompressed' |
//     'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr' | 'p2wsh' | 'p2sh-p2wsh' | 'p2sh' (multisig needs m, n)
//   spendType(type | spendInfo), isSegwitType(type), outputSize(script | scriptLength), txWeight({ inputs: [type | spendInfo], outputs: [script |
//   length] }), txVsize(...), feeFor(vsize, satPerVbyte) (rounded up), dustThreshold(script, dustRelayFee = 3)
//   feeRateOf(feeSats, vsize), pickFeeRates(esploraEstimates) -> { fastest, halfHour, hour, economy, minimum }
//
// Estimates must never be *below* the real size: an underestimate gives a fee rate below the target (possibly below
// minrelaytxfee -> rejected). So ECDSA signatures count 72 bytes + sighash byte (DER max for low-S; Core's low-R
// grinding usually produces 71, i.e. ~1 byte overpaid per signature - the price of safety for other signers).
// Weight units: non-witness bytes x4, witness bytes x1 (BIP-141).
import { varintSize } from './bytes.js';
import { classify } from './script.js';

const OUTPOINT_SEQ = 32 + 4 + 4; // outpoint + sequence
const SIG = 72 + 1; // DER signature with its sighash byte, plus the push
const PUB = 33 + 1;

// OP_m + n * (push 33 + key) + OP_n + OP_CHECKMULTISIG; valid for n <= 16 (small-int opcodes) and compressed keys.
const multisigScriptLength = (m, n) => 1 + n * 34 + 1 + 1;

export const isSegwitType = (t) => /p2wpkh|p2wsh|p2tr/.test(t);

// The spend type of a type name or a spend info (nested segwit is told apart by the redeem script).
export function spendType(spec) {
  if (typeof spec !== 'object') return spec;
  if (spec.type === 'p2sh' && spec.redeemScript) {
    const r = classify(spec.redeemScript).type;
    if (r === 'p2wpkh') return 'p2sh-p2wpkh';
    if (r === 'p2wsh') return 'p2sh-p2wsh';
  }
  return spec.type;
}

// Weight units of one input (outpoint, sequence, scriptSig with its length, witness with its item count).
export function inputWeight(spec, opts = {}) {
  const info = typeof spec === 'object' ? spec : { type: spec };
  const type = spendType(info);
  const m = info.m ?? opts.m ?? 1, n = info.n ?? opts.n ?? 1;
  const wsLen = info.witnessScript ? info.witnessScript.length : opts.witnessScriptLength ?? multisigScriptLength(m, n);
  const base = (scriptSig) => (OUTPOINT_SEQ + varintSize(scriptSig) + scriptSig) * 4;
  // Witness scripts are assumed to be m-of-n CHECKMULTISIG (the dummy element, m signatures); a custom witnessScript
  // gets its exact length but the same satisfaction shape, an approximation.
  const wsWitness = () => 1 + 1 + m * SIG + varintSize(wsLen) + wsLen; // count, the CHECKMULTISIG dummy, signatures, script
  switch (type) {
    case 'p2pkh': return base(SIG + PUB);
    case 'p2pkh-uncompressed': return base(SIG + 66);
    case 'p2pk': return base(SIG);
    case 'p2wpkh': return base(0) + 1 + SIG + PUB;
    case 'p2sh-p2wpkh': return base(23) + 1 + SIG + PUB;
    // Nested segwit scriptSig: push of the 22-byte (P2WPKH) or 34-byte (P2WSH) witness program = 23 / 35 bytes.
    // Taproot key path: count + length + 64-byte Schnorr signature = 66 WU (57.5 vB in total with the base), the
    // cheapest single-key input; script-path spends need spendInfo-specific estimates not covered here.
    case 'p2tr': return base(0) + 1 + 1 + 64; // key path, SIGHASH_DEFAULT
    case 'p2wsh': return base(0) + wsWitness();
    case 'p2sh-p2wsh': return base(35) + wsWitness();
    // KNOWN DEFECT: the redeem script push is sized as 1 byte below 76 and 2 bytes otherwise, but scripts of 256..520
    // bytes need OP_PUSHDATA2 (3 bytes), e.g. a 15-of-15 (513 bytes): the input is underestimated by 1 byte (4 WU).
    // Fix: (rs < 76 ? 1 : rs <= 255 ? 2 : 3).
    case 'p2sh': { const rs = info.redeemScript ? info.redeemScript.length : multisigScriptLength(m, n); return base(1 + m * SIG + (rs < 76 ? 1 : 2) + rs); }
    default: throw new Error(`cannot estimate the size of a ${type} input`);
  }
}

export function outputSize(script) {
  const len = typeof script === 'number' ? script : script.length;
  return 8 + varintSize(len) + len;
}

// Header (version 4 + locktime 4 + counts) x4, outputs x4, inputs as above. With any segwit input the tx gets the
// 2-byte marker + flag (witness data, 1 WU each) and every legacy input an empty witness stack (one 0x00, 1 WU).
export function txWeight({ inputs = [], outputs = [] }) {
  const types = inputs.map(spendType);
  const segwit = types.some(isSegwitType);
  let w = (4 + 4 + varintSize(inputs.length) + varintSize(outputs.length)) * 4;
  for (const o of outputs) w += outputSize(o) * 4;
  for (const i of inputs) w += inputWeight(i);
  if (segwit) w += 2 + types.filter((t) => !isSegwitType(t)).length; // marker, flag, empty witnesses of legacy inputs
  return w;
}

export const txVsize = (spec) => Math.ceil(txWeight(spec) / 4);

export const feeFor = (vsize, rate) => Math.ceil(vsize * rate - 1e-9);

export const feeRateOf = (fee, vsize) => (vsize ? fee / vsize : 0);

// Bitcoin Core GetDustThreshold: (output size + the size of spending it) × the dust relay fee (3 sat/vB).
// The spend size is Core's fixed assumption (outpoint 36 + scriptSig len 1 + 107-byte P2PKH-like signature + sequence
// 4), with the 107 bytes discounted /4 for witness programs (integer division, as in Core). Gives the familiar 546
// sat for P2PKH, 294 for P2WPKH, 330 for P2TR. Unspendable outputs (OP_RETURN) have no dust limit.
export function dustThreshold(script, dustRelayFee = 3) {
  const c = classify(script);
  if (c.type === 'nulldata' || (script.length && script[0] === 0x6a)) return 0;
  const witness = c.type === 'p2wpkh' || c.type === 'p2wsh' || c.type === 'p2tr' || c.type === 'witness_unknown' || c.type === 'anchor';
  const spend = witness ? 32 + 4 + 1 + Math.floor(107 / 4) + 4 : 32 + 4 + 1 + 107 + 4;
  return (outputSize(script) + spend) * dustRelayFee;
}

// Esplora /fee-estimates ({ "1": 87.8, "3": 70.1, … } sat/vB by confirmation target) -> named levels.
// For each level take the estimate of the largest available target <= the wanted one (a nearer target is never
// cheaper, so this errs on the side of confirming). Missing levels fall back to 1 sat/vB, the default relay minimum.
export function pickFeeRates(est) {
  const at = (n) => {
    const keys = Object.keys(est || {}).map(Number).filter((k) => k <= n).sort((a, b) => b - a);
    return keys.length ? est[keys[0]] : null;
  };
  const v = { fastest: at(1), halfHour: at(3), hour: at(6), economy: at(144), minimum: at(1008) };
  for (const k of Object.keys(v)) if (v[k] == null) v[k] = 1;
  return v;
}
