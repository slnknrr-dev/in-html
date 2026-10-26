// funding-studio/chains.js - the crypto side of donations behind one small interface, used by the editor (checks of
// the owner's addresses), the exporter (static QR codes) and the backend (per-donation addresses, payment detection).
// The work is done by the repository's wallet libraries: bitcoin/ (address rules, BIP-21, Esplora, watch-only
// derivation), ethereum/ (EIP-55, EIP-681, ERC-20 calls, JSON-RPC) on crypto/ and hdkey/. This module keeps the
// funding product's own vocabulary: networks 'main' | 'test' | 'regtest', amounts in decimal text, URIs with plain
// integers (every wallet reads them), and clients over the injected request function of payments/http.js.
//
// Derivation (xpub / ypub / zpub / tpub / vpub at account level, or an output descriptor) is wired with
// wireCrypto({ bitcoin }) by the code that hands out addresses (backend.js), so the editor's bundle does not carry
// BIP-32 / secp256k1 point arithmetic it never uses; without it canDerive() is false and deriveBtcAddress() throws
// an error with code CRYPTO_GAP (the backend then uses the owner's address pool).
//
//   EVM_CHAINS, TOKENS, tokensOf(chain), tokenInfo(chain, symbol)
//   ethChecksum(addr) -> EIP-55 address | ''          isEthAddress(addr) -> bool (mixed case must match EIP-55)
//   toUnits(amount, decimals) -> bigint                fromUnits(units, decimals) -> '1.5'
//   erc20TransferData(to, units) -> '0xa9059cbb…'      TRANSFER_TOPIC
//   eip681({ address, chain, value }) / eip681Token({ token, chain, to, units }) -> 'ethereum:…'
//   parseEip681(uri) -> { address, chain, fn, value, to, units } | null
//   btcAddressInfo(addr) -> { ok, network: 'main' | 'test' | 'regtest', type, error? }
//   btcAmount(n) -> '0.00012345'                       bip21({ address, amount, label, message }) / parseBip21(uri)
//   esploraClient(request, base) -> { address, addressTxs, tipHeight }
//   evmRpc(request, url) -> { call, blockNumber, receipt, tx, logs, balance }
//   CRYPTO_GAP, canDerive(), derivationSpecProblem(spec, network), deriveBtcAddress(spec, index, network), wireCrypto(libs)
import { decodeAddress } from '../bitcoin/address.js';
import { formatBitcoinURI, parseBitcoinURI } from '../bitcoin/uri.js';
import { createEsploraClient } from '../bitcoin/esplora.js';
import { isAddress, toChecksumAddress } from '../ethereum/address.js';
import { formatEthereumURI, parseEthereumURI } from '../ethereum/uri.js';
import { erc20TransferData as erc20Call } from '../ethereum/erc.js';
import { createRpcClient } from '../ethereum/rpc.js';

/* ---------- EVM chains and tokens ---------- */

// id -> { name, symbol (native coin), explorer, test }. Wallets know these chains; the page never calls an RPC itself.
export const EVM_CHAINS = {
  1: { name: 'Ethereum', symbol: 'ETH', explorer: 'https://etherscan.io' },
  10: { name: 'OP Mainnet', symbol: 'ETH', explorer: 'https://optimistic.etherscan.io' },
  137: { name: 'Polygon', symbol: 'POL', explorer: 'https://polygonscan.com' },
  8453: { name: 'Base', symbol: 'ETH', explorer: 'https://basescan.org' },
  42161: { name: 'Arbitrum One', symbol: 'ETH', explorer: 'https://arbiscan.io' },
  11155111: { name: 'Sepolia', symbol: 'ETH', explorer: 'https://sepolia.etherscan.io', test: true },
  84532: { name: 'Base Sepolia', symbol: 'ETH', explorer: 'https://sepolia.basescan.org', test: true },
};

// Common stablecoins: symbol -> { decimals, usd (pegged to 1 USD), at: { chainId: contract } }.
export const TOKENS = {
  USDC: {
    decimals: 6, usd: true, at: {
      1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    },
  },
  USDT: {
    decimals: 6, usd: true, at: {
      1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', 10: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
  },
  DAI: {
    decimals: 18, usd: true, at: {
      1: '0x6B175474E89094C44Da98b954EedeAC495271d0F', 10: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      137: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', 8453: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      42161: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    },
  },
};

// Tokens available on a chain: [{ symbol, address, decimals, usd }] (the native coin first, as { symbol, native: true }).
export function tokensOf(chain, custom = []) {
  const c = EVM_CHAINS[chain];
  const out = c ? [{ symbol: c.symbol, native: true, decimals: 18, usd: false }] : [];
  for (const [symbol, t] of Object.entries(TOKENS)) if (t.at[chain]) out.push({ symbol, address: t.at[chain], decimals: t.decimals, usd: t.usd });
  for (const t of Array.isArray(custom) ? custom : []) {
    if (t && Number(t.chain) === Number(chain) && isEthAddress(t.address) && !out.some((x) => x.symbol === t.symbol)) {
      out.push({ symbol: t.symbol, address: ethChecksum(t.address), decimals: t.decimals, usd: !!t.usd });
    }
  }
  return out;
}
export const tokenInfo = (chain, symbol, custom) => tokensOf(chain, custom).find((t) => t.symbol === symbol) || null;

/* ---------- EIP-55 (ethereum/address.js) ---------- */

export function ethChecksum(addr) {
  const s = String(addr || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return '';
  return toChecksumAddress(s);
}

// Mixed-case input must be a correct checksum; all-lower / all-upper hex carries no checksum and is accepted.
export const isEthAddress = (addr) => isAddress(String(addr || '').trim());

/* ---------- decimal units ---------- */

// Plain decimal text of a number or a decimal string ('1e-7' -> '0.0000001'); '' when not a finite non-negative number.
export function decimalText(v) {
  if (typeof v === 'bigint') return v >= 0n ? v.toString() : '';
  let s = typeof v === 'number' ? (Number.isFinite(v) && v >= 0 ? String(v) : '') : String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!m) return '';
  let int = m[1];
  let frac = m[2] || '';
  let exp = Number(m[3] || 0);
  // Exponent bound: '1e999999' would otherwise build a million-digit string (cheap DoS from a form field).
  if (Math.abs(exp) > 400) return '';
  if (exp > 0) { const take = frac.slice(0, exp).padEnd(exp, '0'); int += take; frac = frac.slice(exp); exp = 0; }
  if (exp < 0) { const n = -exp; const pad = int.padStart(n + 1, '0'); frac = pad.slice(pad.length - n) + frac; int = pad.slice(0, pad.length - n); }
  int = int.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  return frac ? int + '.' + frac : int;
}

// Amount in base units (rounded half up to `decimals` places).
export function toUnits(amount, decimals) {
  const s = decimalText(amount);
  if (!s) throw new Error('not an amount: ' + amount);
  const d = Math.max(0, decimals | 0);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(d + 1)).slice(0, d + 1);
  let u = BigInt(i + frac.slice(0, d));
  if (Number(frac[d]) >= 5) u += 1n;
  return u;
}

export function fromUnits(units, decimals) {
  const d = Math.max(0, decimals | 0);
  const s = BigInt(units).toString().padStart(d + 1, '0');
  const i = s.slice(0, s.length - d);
  const f = d ? s.slice(s.length - d).replace(/0+$/, '') : '';
  return f ? i + '.' + f : i;
}

/* ---------- ERC-20 and EIP-681 (ethereum/erc.js, ethereum/uri.js) ---------- */

// keccak256('Transfer(address,address,uint256)') - topics[0] of every ERC-20 Transfer event; topics[1]/[2] are the
// indexed from/to addresses (32-byte padded), data is the amount.
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// transfer(address,uint256): selector 0xa9059cbb, the recipient and the amount as 32-byte words.
export function erc20TransferData(to, units) {
  if (!isEthAddress(to)) throw new Error('bad recipient');
  return erc20Call(ethChecksum(to), BigInt(units));
}

// Chain 1 is left out (the EIP's default); amounts are written as plain integers (strings for formatEthereumURI),
// not in the scientific notation the EIP also allows, because some wallets read only digits.
const chainOf = (chain) => (chain && Number(chain) !== 1 ? Number(chain) : null);
const positive = (v) => (v != null && v !== '' && BigInt(v) > 0n ? BigInt(v).toString() : null);

// ETH: ethereum:<address>[@<chainId>][?value=<wei>].
export function eip681({ address, chain = 1, value = null }) {
  const a = ethChecksum(address);
  if (!a || !isEthAddress(address)) throw new Error('bad address');
  return formatEthereumURI({ target: a, chainId: chainOf(chain), value: positive(value) });
}

// ERC-20: ethereum:<token>[@<chainId>]/transfer?address=<recipient>&uint256=<units>.
export function eip681Token({ token, chain = 1, to, units = null }) {
  const tk = ethChecksum(token);
  const rc = ethChecksum(to);
  if (!tk || !rc || !isEthAddress(token) || !isEthAddress(to)) throw new Error('bad address');
  const parameters = [['address', rc]];
  const u = positive(units);
  if (u) parameters.push(['uint256', u]);
  return formatEthereumURI({ target: tk, chainId: chainOf(chain), functionName: 'transfer', parameters });
}

export function parseEip681(uri) {
  let p;
  try { p = parseEthereumURI(String(uri || '').trim()); } catch { return null; }
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.target)) return null; // ENS names are not used by donation pages
  const out = { address: p.target, chain: p.chainId || 1, fn: p.functionName || '' };
  if ('value' in p.parameters) out.value = p.parameters.value;
  if (out.fn === 'transfer') {
    out.to = typeof p.to === 'string' ? p.to : '';
    out.units = p.amount;
  }
  return out;
}

/* ---------- Bitcoin (bitcoin/address.js, bitcoin/uri.js) ---------- */

// The library's network names -> the product's ('testnet', 'testnet4' and 'signet' share their address forms).
const NET_OF = { mainnet: 'main', testnet: 'test', testnet4: 'test', signet: 'test', regtest: 'regtest' };
const LIB_NET = { main: 'mainnet', test: 'testnet', regtest: 'regtest' };

export function btcAddressInfo(addr) {
  const s = String(addr || '').trim();
  if (!s) return { ok: false, error: 'empty' };
  let d;
  try { d = decodeAddress(s); } catch (e) { return { ok: false, error: String(e.message || e).replace(/^invalid address: /, '') }; }
  const nets = [...new Set((Array.isArray(d.network) ? d.network : [d.network]).map((n) => NET_OF[n]).filter(Boolean))];
  // Base58 test addresses are valid on every test network and on regtest: report them as 'test'.
  const network = nets.length === 1 ? nets[0] : nets.includes('test') ? 'test' : nets[0];
  if (!network) return { ok: false, error: 'unknown network' };
  return { ok: true, network, type: d.type === 'witness_unknown' ? 'witness' : d.type };
}

// BTC amount with at most 8 decimals, no exponent, no trailing zeros.
export function btcAmount(n) {
  return fromUnits(toUnits(n, 8), 8);
}

// BIP-21: bitcoin:<address>[?amount=<BTC>][&label=…][&message=…] (percent-encoded; amount in decimal BTC).
export function bip21({ address, amount = null, label = '', message = '' }) {
  const a = String(address || '').trim();
  if (!btcAddressInfo(a).ok) throw new Error('bad address');
  const sats = amount != null && amount !== '' ? toUnits(amount, 8) : 0n;
  // Number(sats) is exact: the whole BTC supply (2.1e15 sats) is below 2^53.
  return formatBitcoinURI({ address: a, amount: sats > 0n ? Number(sats) : null, label, message });
}

// -> { address, amount (decimal BTC text), label, message, params } | null. Unknown required parameters (req-*) make
// the URI invalid, as BIP-21 says. The address is returned as written (checked with btcAddressInfo by the caller).
export function parseBip21(uri) {
  let p;
  try { p = parseBitcoinURI(String(uri || '').trim(), { validateAddress: false }); } catch { return null; }
  return { address: p.address, amount: p.amount == null ? null : fromUnits(BigInt(p.amount), 8), label: p.label, message: p.message, params: p.params };
}

/* ---------- payment detection clients (bitcoin/esplora.js, ethereum/rpc.js) ---------- */

// A fetch() over the injected request function ({ method, url, headers, body } -> { status, headers, text }), so the
// backend keeps using the Node HTTP modules hosting.js hands it (and tests their mock servers).
function fetchOver(request) {
  return async (url, init = {}) => {
    const r = await request({ method: init.method || 'GET', url: String(url), headers: init.headers || {}, body: init.body });
    const text = typeof r.text === 'string' ? r.text : '';
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      headers: { get: (k) => (r.headers ? r.headers[String(k).toLowerCase()] ?? null : null) },
      text: async () => text,
      json: async () => JSON.parse(text),
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    };
  };
}

// Esplora (Blockstream / mempool.space API shape): GET /address/:a, /address/:a/txs, /blocks/tip/height.
export function esploraClient(request, base) {
  const b = String(base || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(b)) throw new Error('Esplora: no API URL configured');
  const es = createEsploraClient({ url: b, fetch: fetchOver(request) });
  const named = (f) => async (...a) => { try { return await f(...a); } catch (e) { throw Object.assign(new Error('Esplora: ' + e.message), { status: e.status }); } };
  return {
    address: named((a) => es.address(a)),
    addressTxs: named((a) => es.addressTxs(a)),
    tipHeight: named(async () => {
      const n = await es.tipHeight();
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('bad tip height');
      return n;
    }),
  };
}

// Ethereum JSON-RPC 2.0 over HTTP POST; results are the raw JSON-RPC values (hex quantities), as before.
export function evmRpc(request, url) {
  if (!/^https?:\/\//.test(String(url || ''))) throw new Error('JSON-RPC: no endpoint configured');
  const rpc = createRpcClient({ url, fetch: fetchOver(request) });
  async function call(method, params = []) {
    try { return await rpc.request(method, params); } catch (e) {
      throw Object.assign(new Error('JSON-RPC: ' + e.message), e.code !== undefined ? { rpc: { code: e.code, message: e.message, data: e.data } } : {});
    }
  }
  return {
    call,
    blockNumber: async () => Number(BigInt(await call('eth_blockNumber'))),
    receipt: (hash) => call('eth_getTransactionReceipt', [hash]),
    tx: (hash) => call('eth_getTransactionByHash', [hash]),
    logs: (filter) => call('eth_getLogs', [filter]),
    balance: async (addr) => BigInt(await call('eth_getBalance', [addr, 'latest'])),
  };
}

/* ---------- xpub / descriptor derivation (bitcoin/account.js, wired by backend.js) ---------- */

export const CRYPTO_GAP = 'CRYPTO_GAP';
const LIBS = { bitcoin: null };

// libs.bitcoin: an object with deriveAddress(spec, index, network) -> address, network in the bitcoin/ library's
// names ('mainnet', 'testnet', 'regtest') - the bitcoin/account.js module itself fits.
export function wireCrypto(libs = {}) {
  if (libs.bitcoin && typeof libs.bitcoin.deriveAddress === 'function') LIBS.bitcoin = libs.bitcoin;
}

export const canDerive = () => !!LIBS.bitcoin;

// '' when spec is an extended public key or an output descriptor without private keys; else 'empty' | 'private' |
// 'format' (by form), or - when derivation is wired - 'invalid' (a bad checksum, a key of another network…).
export function derivationSpecProblem(spec, network = 'main') {
  const s = String(spec || '').trim();
  if (!s) return 'empty';
  // Refuse private extended keys anywhere in the text (also inside a descriptor): a watch-only server must never
  // store spending keys, and owners do paste the wrong key.
  if (/[xyztuv]prv|[XYZTUV]prv/.test(s)) return 'private';
  const xpub = /^(xpub|ypub|zpub|tpub|upub|vpub|Ypub|Zpub|Upub|Vpub)[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(s);
  const desc = /^(wpkh|pkh|sh|tr|wsh)\(.*(xpub|tpub)[1-9A-HJ-NP-Za-km-z]+.*\)(#[a-z0-9]{8})?$/.test(s);
  if (!xpub && !desc) return 'format';
  if (LIBS.bitcoin) { try { deriveBtcAddress(s, 0, network); } catch { return 'invalid'; } }
  return '';
}

// The receive address `index` of an account (chain 0), checked with the product's own address rules.
export function deriveBtcAddress(spec, index, network = 'main') {
  if (!LIBS.bitcoin) throw Object.assign(new Error('Address derivation needs the bitcoin/ library (not wired in this build)'), { code: CRYPTO_GAP });
  const a = LIBS.bitcoin.deriveAddress(String(spec || '').trim(), index, LIB_NET[network] || 'mainnet');
  const info = btcAddressInfo(a);
  if (!info.ok || info.network !== (network === 'regtest' ? 'regtest' : network === 'test' ? 'test' : 'main')) throw new Error('derived address is invalid for this network');
  return a;
}
