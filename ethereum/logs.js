// ethereum/logs.js - decoding of event logs for explorers and wallets: the well-known events of token standards,
// WETH and Uniswap, an application ABI on top, token transfers of a transaction receipt.
//
//   KNOWN_ABI: { erc20, erc721, erc1155, weth, uniswapV2, uniswapV3 } -> human-readable event lines
//   decodeLogs(logs, extraAbi = null) -> [{ log, fragment, name, args, standard } | { log, unknown: true }]
//       extraAbi (any ABI form of abi.js) is tried first; standard: 'erc20' | 'erc721' | 'erc1155' | 'weth' |
//       'uniswap-v2' | 'uniswap-v3' | null (extraAbi). ERC-20 and ERC-721 Transfer / Approval share a topic and are
//       told apart by the number of topics (ERC-721 indexes the token id).
//   tokenTransfersOf(receiptOrLogs) -> [{ standard: 'erc20' | 'erc721' | 'erc1155', token, from, to,
//       amount (erc20, erc1155) | tokenId (erc721, erc1155), operator? (erc1155), logIndex }]  (batches expanded)
import { parseAbi, decodeEventLog } from './abi.js';
import { getAddress } from './address.js';

export const KNOWN_ABI = Object.freeze({
  erc20: Object.freeze([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
  ]),
  erc721: Object.freeze([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
    'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
  ]),
  erc1155: Object.freeze([
    'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
    'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
    'event URI(string value, uint256 indexed id)',
  ]),
  weth: Object.freeze([
    'event Deposit(address indexed dst, uint256 wad)',
    'event Withdrawal(address indexed src, uint256 wad)',
  ]),
  uniswapV2: Object.freeze([
    'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
    'event Sync(uint112 reserve0, uint112 reserve1)',
    'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
    'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)',
  ]),
  uniswapV3: Object.freeze([
    'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  ]),
});

const STANDARD = { erc20: 'erc20', erc721: 'erc721', erc1155: 'erc1155', weth: 'weth', uniswapV2: 'uniswap-v2', uniswapV3: 'uniswap-v3' };

let KNOWN = null;
// [{ abi, standard }] parsed once, on first use.
const known = () => (KNOWN ||= Object.entries(KNOWN_ABI).map(([k, lines]) => ({ abi: parseAbi(lines), standard: STANDARD[k] })));

// Order matters: the application ABI wins over the built-in list, so a contract that reuses a well-known event
// signature with its own semantics is labelled by its own ABI. ERC-20 vs ERC-721 Transfer share topic0; the topic
// count check inside decodeEventLog (3 vs 4 topics) is what separates them.
function decodeOne(log, extra) {
  if (extra) {
    try {
      const r = decodeEventLog(extra, log);
      if (r) return { log, fragment: r.fragment, name: r.name, args: r.args, standard: null };
    } catch { /* not this ABI */ }
  }
  for (const { abi, standard } of known()) {
    try {
      const r = decodeEventLog(abi, log);
      if (r) return { log, fragment: r.fragment, name: r.name, args: r.args, standard };
    } catch { /* malformed for this event */ }
  }
  return { log, unknown: true };
}

export function decodeLogs(logs, extraAbi = null) {
  const extra = extraAbi ? parseAbi(extraAbi) : null;
  return (logs || []).map((log) => decodeOne(log, extra));
}

export function tokenTransfersOf(receipt) {
  const logs = Array.isArray(receipt) ? receipt : (receipt && receipt.logs) || [];
  const out = [];
  for (const d of decodeLogs(logs)) {
    if (d.unknown) continue;
    const token = d.log.address ? getAddress(d.log.address) : null;
    const logIndex = d.log.logIndex == null ? null : Number(d.log.logIndex);
    const a = d.args;
    if (d.name === 'Transfer' && (d.standard === 'erc20' || d.standard === 'erc721')) {
      out.push(d.standard === 'erc20'
        ? { standard: 'erc20', token, from: a.from, to: a.to, amount: a.value, logIndex }
        : { standard: 'erc721', token, from: a.from, to: a.to, tokenId: a.tokenId, logIndex });
    } else if (d.standard === 'erc1155' && d.name === 'TransferSingle') {
      out.push({ standard: 'erc1155', token, operator: a.operator, from: a.from, to: a.to, tokenId: a.id, amount: a.value, logIndex });
    } else if (d.standard === 'erc1155' && d.name === 'TransferBatch') {
      // By position: `values` is an Array method, so the name is not set on the decoded array.
      a[3].forEach((id, i) => out.push({ standard: 'erc1155', token, operator: a.operator, from: a.from, to: a.to, tokenId: id, amount: a[4][i], logIndex }));
    }
  }
  return out;
}
