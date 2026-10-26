// ethereum/units.js - amounts and JSON-RPC encodings: exact decimal text <-> bigint base units (wei, gwei, token
// decimals), JSON-RPC quantities ('0x…' without leading zeros) and data ('0x…' bytes). No floating point anywhere.
//
//   parseUnits(text, decimals = 18) -> bigint       '1.5' -> 1500000000000000000n; throws on garbage or on more
//                                                   significant decimals than `decimals` (trailing zeros are fine)
//   formatUnits(value, decimals = 18, { maxDecimals, group = false }) -> string
//                                                   trailing zeros trimmed ('1', '0.25'); maxDecimals cuts (never
//                                                   rounds up); group: true (',') or a separator for thousands
//   parseEther(text), formatEther(wei, opts), parseGwei(text), formatGwei(wei, opts)
//   UNITS: { wei: 0, kwei: 3, mwei: 6, gwei: 9, szabo: 12, finney: 15, ether: 18 }
//   toQuantity(bigint | number) -> '0x…' ('0x0' for zero)   fromQuantity('0x…' | bigint | number) -> bigint
//   toHex(bytes | '0x…') -> '0x…' (lower case)              fromHex(text) -> Uint8Array ('0x' prefix optional)
//   toBigInt(value, what) -> bigint (bigint, safe integer, decimal or '0x' text)
import { bytesToHex, hexToBytes } from '../crypto/encoding.js';

export const UNITS = Object.freeze({ wei: 0, kwei: 3, mwei: 6, gwei: 9, szabo: 12, finney: 15, ether: 18 });

// Decimal grammar: optional sign, integer digits, optional fraction. No exponent: '1e18' would invite float input.
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function checkDecimals(decimals) {
  const d = typeof decimals === 'string' && decimals in UNITS ? UNITS[decimals] : decimals;
  if (!Number.isInteger(d) || d < 0 || d > 255) throw new Error('decimals must be an integer 0..255');
  return d;
}

// Exact decimal text -> integer of base units.
// String arithmetic, never floats: 0.1 + 0.2 style rounding in a wei amount is a real loss of funds. A JS number is
// accepted only via String(), and its exponent form (1e21, 1e-7) is refused because it shows the value was already
// outside exact representation. Trailing zeros are stripped before the length check so '1.50' with 1 decimal works.
export function parseUnits(text, decimals = 18) {
  const d = checkDecimals(decimals);
  if (typeof text === 'bigint') return text * 10n ** BigInt(d);
  if (typeof text === 'number') {
    if (!Number.isFinite(text)) throw new Error('invalid amount');
    text = String(text);
    if (/e/i.test(text)) throw new Error('invalid amount: use a decimal string for very large or small numbers');
  }
  if (typeof text !== 'string') throw new TypeError('amount: string expected');
  const m = DECIMAL.exec(text.trim());
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) throw new Error(`invalid amount "${text}"`);
  const frac = (m[3] || '').replace(/0+$/, '');
  if (frac.length > d) throw new Error(`too many decimals (at most ${d})`);
  const v = BigInt((m[2] || '0') + frac.padEnd(d, '0'));
  return m[1] === '-' ? -v : v;
}

// Integer of base units -> decimal text.
// padStart(d + 1) guarantees at least one integer digit (0.000…). maxDecimals truncates (toward zero), never rounds up:
// showing a balance larger than the real one would let a user try to send money they do not have.
// The '-' is dropped when the displayed value is all zeros (no "-0").
export function formatUnits(value, decimals = 18, { maxDecimals, group = false } = {}) {
  const d = checkDecimals(decimals);
  let v = toBigInt(value, 'value');
  const neg = v < 0n;
  if (neg) v = -v;
  const s = v.toString().padStart(d + 1, '0');
  let int = s.slice(0, s.length - d), frac = d ? s.slice(s.length - d) : '';
  if (maxDecimals != null) frac = frac.slice(0, Math.max(0, maxDecimals));
  frac = frac.replace(/0+$/, '');
  if (group) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, group === true ? ',' : String(group));
  const out = int + (frac ? '.' + frac : '');
  return neg && /[1-9]/.test(out) ? '-' + out : out;
}

export const parseEther = (text) => parseUnits(text, 18);
export const formatEther = (wei, opts) => formatUnits(wei, 18, opts);
export const parseGwei = (text) => parseUnits(text, 9);
export const formatGwei = (wei, opts) => formatUnits(wei, 9, opts);

// bigint from a bigint, a safe integer number, or decimal / '0x' hexadecimal text.
// Numbers above 2^53 are refused, not converted: 2**60 + 1 as a double is already 2**60, the error is silent otherwise.
export function toBigInt(value, what = 'value') {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${what}: integer expected (use bigint above 2^53)`);
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^0x[0-9a-f]+$/i.test(t)) return BigInt(t);
    if (/^0x$/i.test(t)) return 0n;
    if (/^-?\d+$/.test(t)) return BigInt(t);
  }
  throw new Error(`${what}: integer expected, got ${typeof value === 'string' ? JSON.stringify(value) : typeof value}`);
}

// JSON-RPC quantity: '0x' + hex without leading zeros, '0x0' for zero.
// JSON-RPC distinguishes QUANTITY ('0x0', no leading zeros: nodes reject '0x00') from DATA (even-length bytes).
export function toQuantity(value) {
  const v = toBigInt(value, 'quantity');
  if (v < 0n) throw new Error('quantity: negative value');
  return '0x' + v.toString(16);
}

// Quantity text (leading zeros tolerated, '0x' = 0) -> bigint.
export function fromQuantity(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return toBigInt(value, 'quantity');
  if (typeof value !== 'string' || !/^0x[0-9a-f]*$/i.test(value)) throw new Error(`invalid quantity ${JSON.stringify(value)}`);
  return value.length === 2 ? 0n : BigInt(value);
}

// '0x' + lower-case hex of bytes ('0x…' text is validated and lower-cased).
export function toHex(bytes) {
  if (typeof bytes === 'string') return '0x' + bytesToHex(fromHex(bytes));
  return '0x' + bytesToHex(bytes);
}

// Bytes of '0x…' (or bare) hex text; Uint8Array passes through.
export function fromHex(text) {
  if (text instanceof Uint8Array) return text;
  if (typeof text !== 'string') throw new TypeError('hex string expected');
  const s = /^0x/i.test(text) ? text.slice(2) : text;
  if (s.length % 2 || !/^[0-9a-f]*$/i.test(s)) throw new Error('invalid hex data');
  return hexToBytes(s);
}
