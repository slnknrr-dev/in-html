// ethereum/uri.js - EIP-681 payment request URIs ("ethereum:0x…@1?value=2.014e18",
// "ethereum:<token>/transfer?address=<to>&uint256=<amount>") for QR codes and links.
//
//   parseEthereumURI(text, { strict = false }) -> { scheme: 'ethereum', prefix ('pay' | null), target (checksum address or ENS name),
//       chainId (number | null), functionName (string | null), parameters: { value, gas, gasLimit, gasPrice: bigint;
//       other keys: decoded strings }, args: [[key, value], ...] (all, in order), amount (bigint | null: `value`, or
//       the uint256 of an ERC-20 transfer), token (the ERC-20 contract of a transfer, else null), to (recipient) }
//       Numbers may use scientific notation (2.014e18) but must be integers; `gas` is an alias of `gasLimit`.
//       checksumOk: false when an address (target or `address` parameter) is mixed-case with a wrong EIP-55
//       checksum (the EIP's own first example is one); { strict: true } throws instead. Addresses come back checksummed.
//   formatEthereumURI({ target, chainId, functionName, value, parameters, prefix }) -> text
//       bigints are written in scientific notation when that is shorter (2.014e18)
//   erc20TransferURI(token, to, amount, chainId = null) -> text
//   parseNumber(text) -> bigint     formatNumber(bigint) -> text      (EIP-681 numbers)
import { getAddress, isAddress, toChecksumAddress } from './address.js';
import { toBigInt } from './units.js';

const NUMBER = /^([+-]?)(\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

// EIP-681 number -> bigint (exact; a fractional result throws).
// EIP-681 numbers allow scientific notation (value=2.014e18). Evaluated on the digit string, never via parseFloat:
// 2.014e18 as a double is fine but 1.000000000000000001e18 is not. Exponent capped at 1000 so '1e999999999' cannot
// allocate a gigabyte of zeros.
export function parseNumber(text) {
  const m = NUMBER.exec(String(text).trim());
  if (!m || (!m[2] && !m[3])) throw new Error(`invalid number "${text}"`);
  const frac = m[3] || '';
  const exp = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 1000) throw new Error(`exponent out of range in "${text}"`);
  let digits = (m[2] || '0') + frac;
  const shift = exp - frac.length;
  if (shift >= 0) digits += '0'.repeat(shift);
  else {
    const cut = digits.slice(digits.length + shift);
    if (/[^0]/.test(cut)) throw new Error(`"${text}" is not an integer`);
    digits = digits.slice(0, digits.length + shift) || '0';
  }
  const v = BigInt(digits);
  return m[1] === '-' ? -v : v;
}

// bigint -> shortest of plain digits and d.ddde<N>.
export function formatNumber(value) {
  const v = toBigInt(value, 'number');
  const neg = v < 0n;
  const s = (neg ? -v : v).toString();
  const m = s.replace(/0+$/, '');
  let out = s;
  if (m.length < s.length) {
    const sci = (m.length > 1 ? m[0] + '.' + m.slice(1) : m) + 'e' + (s.length - 1);
    if (sci.length < s.length) out = sci;
  }
  return (neg ? '-' : '') + out;
}

const NUMERIC = new Set(['value', 'gas', 'gasLimit', 'gasPrice']);

// Parse order is right-to-left of the grammar: query (?), function (/), chain (@), target. lastIndexOf('@') because
// ENS targets cannot contain '@' but the chain id always comes last in the path.
export function parseEthereumURI(text, { strict = false } = {}) {
  let checksumOk = true;
  const address = (a) => {
    if (!isAddress(a)) {
      if (strict) throw new Error(`bad address checksum ${a}`);
      checksumOk = false;
    }
    return toChecksumAddress(a);
  };
  const t = String(text).trim();
  const m = /^ethereum:/i.exec(t);
  if (!m) throw new Error('not an ethereum: URI');
  let rest = t.slice(m[0].length);
  let prefix = null;
  if (/^pay-/i.test(rest)) { prefix = 'pay'; rest = rest.slice(4); }
  const q = rest.indexOf('?');
  const query = q >= 0 ? rest.slice(q + 1) : '';
  let path = q >= 0 ? rest.slice(0, q) : rest;
  let functionName = null;
  const slash = path.indexOf('/');
  if (slash >= 0) {
    functionName = decodeURIComponent(path.slice(slash + 1));
    path = path.slice(0, slash);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(functionName)) throw new Error(`invalid function name "${functionName}"`);
  }
  let chainId = null;
  const at = path.lastIndexOf('@');
  if (at >= 0) {
    const c = path.slice(at + 1);
    if (!/^\d+$/.test(c)) throw new Error(`invalid chain id "${c}"`);
    chainId = Number(c);
    path = path.slice(0, at);
  }
  const target = decodeURIComponent(path);
  let addr;
  if (/^0x[0-9a-fA-F]{40}$/.test(target)) addr = address(target);
  else if (/^[^\s/?#@]+\.[^\s/?#@.]+$/.test(target) && !/^0x/i.test(target)) addr = target.toLowerCase();
  else throw new Error(`invalid target "${target}"`);
  const parameters = {}, args = [];
  for (const part of query ? query.split('&') : []) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
    // '+' as space is form-encoding, not RFC 3986; accepted because QR generators commonly emit it.
    const raw = decodeURIComponent((eq >= 0 ? part.slice(eq + 1) : '').replace(/\+/g, '%20'));
    const k = key === 'gas' ? 'gasLimit' : key;
    let value = raw;
    if (NUMERIC.has(key)) {
      value = parseNumber(raw);
      if (value < 0n) throw new Error(`${key} must not be negative`);
    }
    args.push([key, value]);
    // First occurrence wins in `parameters`; `args` keeps duplicates in order for callers that need the full list.
    if (!(k in parameters)) parameters[k] = value;
  }
  const out = { scheme: 'ethereum', prefix, target: addr, chainId, functionName, parameters, args, amount: null, token: null, to: null, checksumOk };
  if (!functionName) {
    out.to = addr;
    out.amount = parameters.value ?? null;
  } else if (functionName === 'transfer' && parameters.address != null) {
    out.token = addr;
    out.to = /^0x[0-9a-fA-F]{40}$/.test(parameters.address) ? address(parameters.address) : parameters.address;
    out.amount = parameters.uint256 != null ? parseNumber(parameters.uint256) : null;
  }
  out.checksumOk = checksumOk;
  return out;
}

// ':' and '@' are left unescaped because they are legal in query components and keep URIs readable in QR codes.
const enc = (s) => encodeURIComponent(s).replace(/%3A/gi, ':').replace(/%40/g, '@');

export function formatEthereumURI({ target, chainId = null, functionName = null, value = null, parameters = {}, prefix = null }) {
  const tgt = /^0x[0-9a-fA-F]{40}$/.test(target) ? getAddress(target) : String(target);
  let s = 'ethereum:' + (prefix ? prefix + '-' : '') + tgt;
  if (chainId != null) s += '@' + Number(chainId);
  if (functionName) s += '/' + functionName;
  const pairs = Array.isArray(parameters) ? [...parameters] : Object.entries(parameters || {});
  if (value != null) pairs.unshift(['value', value]);
  const qs = pairs.filter(([, v]) => v != null).map(([k, v]) => `${enc(k)}=${typeof v === 'bigint' || (typeof v === 'number' && Number.isInteger(v)) ? formatNumber(v) : enc(String(v))}`);
  return qs.length ? s + '?' + qs.join('&') : s;
}

export const erc20TransferURI = (token, to, amount, chainId = null) =>
  formatEthereumURI({ target: token, chainId, functionName: 'transfer', parameters: [['address', getAddress(to)], ['uint256', toBigInt(amount, 'amount')]] });
