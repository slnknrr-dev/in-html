// ethereum/chains.js - presets of EVM chains (data only: nothing here is ever contacted by this module). Names,
// EIP-3770 short names, currencies, explorers and public RPC endpoints follow the ethereum-lists/chains registry
// (chainid.network) as of 2026; public endpoints are rate-limited and may change, so applications should let the
// user replace them.
//
//   CHAINS: [{ id, name, short, currency: { name, symbol, decimals }, rpc: [urls], explorer (url | null),
//             testnet, l2, eip1559, deprecated? }]
//   chainById(id) -> chain | null        chainName(id) -> name ('Chain 12345' when unknown)
//   chainByShortName(short) -> chain | null
//   explorerUrl(chainId, kind = 'tx' | 'address' | 'block' | 'token', value) -> url | null
//
// 31337 is registered to GoChain Testnet but is the default of Anvil and Hardhat; it is listed here as the local
// development chain (short name 'anvil' is this library's, not the registry's).
const ETH = Object.freeze({ name: 'Ether', symbol: 'ETH', decimals: 18 });
const cur = (name, symbol) => Object.freeze({ name, symbol, decimals: 18 });

const chain = (id, name, short, currency, rpc, explorer, { testnet = false, l2 = false, eip1559 = true, deprecated = false } = {}) =>
  Object.freeze({ id, name, short, currency, rpc: Object.freeze(rpc), explorer, testnet, l2, eip1559, ...(deprecated ? { deprecated } : {}) });

export const CHAINS = Object.freeze([
  chain(1, 'Ethereum', 'eth', ETH, ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com', 'https://eth.drpc.org'], 'https://etherscan.io'),
  chain(11155111, 'Sepolia', 'sep', cur('Sepolia Ether', 'ETH'), ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org', 'https://sepolia.drpc.org'], 'https://sepolia.etherscan.io', { testnet: true }),
  chain(17000, 'Holesky', 'holesky', cur('Holesky Ether', 'ETH'), ['https://ethereum-holesky-rpc.publicnode.com', 'https://holesky.drpc.org'], 'https://holesky.etherscan.io', { testnet: true, deprecated: true }),
  chain(560048, 'Hoodi', 'hoe', cur('Hoodi Ether', 'ETH'), ['https://rpc.hoodi.ethpandaops.io', 'https://ethereum-hoodi-rpc.publicnode.com'], 'https://hoodi.etherscan.io', { testnet: true }),
  chain(10, 'OP Mainnet', 'oeth', ETH, ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'], 'https://optimistic.etherscan.io', { l2: true }),
  chain(42161, 'Arbitrum One', 'arb1', ETH, ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'], 'https://arbiscan.io', { l2: true }),
  chain(8453, 'Base', 'base', ETH, ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], 'https://basescan.org', { l2: true }),
  chain(137, 'Polygon PoS', 'pol', cur('POL', 'POL'), ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com'], 'https://polygonscan.com'),
  chain(324, 'zkSync Era', 'zksync', ETH, ['https://mainnet.era.zksync.io'], 'https://explorer.zksync.io', { l2: true }),
  chain(59144, 'Linea', 'linea', cur('Linea Ether', 'ETH'), ['https://rpc.linea.build', 'https://linea-rpc.publicnode.com'], 'https://lineascan.build', { l2: true }),
  chain(534352, 'Scroll', 'scr', ETH, ['https://rpc.scroll.io', 'https://scroll-rpc.publicnode.com'], 'https://scrollscan.com', { l2: true }),
  chain(100, 'Gnosis', 'gno', cur('xDAI', 'XDAI'), ['https://rpc.gnosischain.com', 'https://gnosis-rpc.publicnode.com'], 'https://gnosisscan.io'),
  chain(56, 'BNB Smart Chain', 'bnb', cur('BNB', 'BNB'), ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com'], 'https://bscscan.com', { eip1559: false }),
  chain(43114, 'Avalanche C-Chain', 'avax', cur('Avalanche', 'AVAX'), ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'], 'https://snowtrace.io'),
  chain(11155420, 'OP Sepolia', 'opsep', cur('Sepolia Ether', 'ETH'), ['https://sepolia.optimism.io'], 'https://sepolia-optimism.etherscan.io', { testnet: true, l2: true }),
  chain(421614, 'Arbitrum Sepolia', 'arb-sep', cur('Sepolia Ether', 'ETH'), ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia-rpc.publicnode.com'], 'https://sepolia.arbiscan.io', { testnet: true, l2: true }),
  chain(84532, 'Base Sepolia', 'basesep', cur('Sepolia Ether', 'ETH'), ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'], 'https://sepolia.basescan.org', { testnet: true, l2: true }),
  chain(31337, 'Anvil / Hardhat (local)', 'anvil', ETH, ['http://127.0.0.1:8545'], null, { testnet: true }),
  chain(1337, 'Geth --dev (local)', 'geth', ETH, ['http://127.0.0.1:8545'], null, { testnet: true }),
]);

// Map index: chainById runs on every explorer link and transaction display; Number() accepts bigint / '0x' ids.
const BY_ID = new Map(CHAINS.map((c) => [c.id, c]));

export const chainById = (id) => BY_ID.get(Number(id)) || null;
export const chainName = (id) => (chainById(id) || { name: `Chain ${id}` }).name;
export const chainByShortName = (short) => CHAINS.find((c) => c.short === String(short).toLowerCase()) || null;

// Whitelist of path kinds plus encodeURIComponent: `value` may come from untrusted data (a tx field) and must not be
// able to rewrite the URL path or inject a query.
export function explorerUrl(chainId, kind, value) {
  const c = chainById(chainId);
  if (!c || !c.explorer) return null;
  const path = { tx: 'tx', address: 'address', block: 'block', token: 'token' }[kind];
  if (!path) throw new Error(`explorerUrl: unknown kind ${kind}`);
  return `${c.explorer}/${path}/${encodeURIComponent(String(value))}`;
}
