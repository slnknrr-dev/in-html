// bitcoin/networks.js - parameters of the Bitcoin networks: mainnet, testnet (testnet3), testnet4, signet and regtest.
// Address versions and bech32 prefixes, WIF and SLIP-132 key prefixes, BIP-44 coin types, genesis hashes, default
// ports and presets of public Esplora instances (data only: nothing is contacted unless an application uses them).
//
//   NETWORKS.<name> -> { name, label, bech32, pubKeyHash, scriptHash, wif, xpub, xprv, coinType, genesis,
//                        p2pPort, rpcPort, electrumPorts, esplora: [{ name, url }], explorer, testnet }
//   network(nameOrObject) -> params (throws for unknown names)     NETWORK_NAMES
//   networksOfAddress(address) -> [names]   (testnet, testnet4 and signet share their prefixes)
//
// Key decisions:
// - Frozen objects: these constants select address versions and WIF prefixes; an accidental mutation (e.g. a UI
//   writing net.bech32 = 'tb') would make a mainnet wallet emit testnet addresses. Object.freeze makes that a throw in
//   strict mode (ES modules are strict) instead of a silent change.
// - All test networks share version bytes (0x6f / 0xc4 / 0xef, tpub / tprv, coin type 1): an address or key alone
//   cannot say which test chain it belongs to. Decoders therefore return a *list* of candidate networks; picking one
//   silently would mislabel signet coins as testnet3. Only the bech32 HRP 'bcrt' separates regtest.
// - Esplora presets are public third-party servers. Privacy: querying them reveals every wallet address together with
//   the client IP (address clustering); the app must make the choice explicit (own electrs / Tor) - nothing here
//   connects by itself.
// - regtest electrumPorts reuse mainnet's 50001 / 50002 (electrs' own regtest default is 60401): a preset to be
//   overridden, not a protocol fact.

const MAIN = Object.freeze({
  name: 'mainnet', label: 'Bitcoin', bech32: 'bc', pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80, xpub: 'xpub', xprv: 'xprv',
  coinType: 0, testnet: false, genesis: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  p2pPort: 8333, rpcPort: 8332, electrumPorts: { tcp: 50001, ssl: 50002 },
  esplora: [{ name: 'mempool.space', url: 'https://mempool.space/api' }, { name: 'blockstream.info', url: 'https://blockstream.info/api' }],
  explorer: 'https://mempool.space',
});

const TEST_KEYS = { pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef, xpub: 'tpub', xprv: 'tprv', coinType: 1, testnet: true };

export const NETWORKS = Object.freeze({
  mainnet: MAIN,
  testnet: Object.freeze({
    name: 'testnet', label: 'Testnet3', bech32: 'tb', ...TEST_KEYS, genesis: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
    p2pPort: 18333, rpcPort: 18332, electrumPorts: { tcp: 60001, ssl: 60002 },
    esplora: [{ name: 'mempool.space testnet', url: 'https://mempool.space/testnet/api' }, { name: 'blockstream.info testnet', url: 'https://blockstream.info/testnet/api' }],
    explorer: 'https://mempool.space/testnet',
  }),
  testnet4: Object.freeze({
    name: 'testnet4', label: 'Testnet4', bech32: 'tb', ...TEST_KEYS, genesis: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
    p2pPort: 48333, rpcPort: 48332, electrumPorts: { tcp: 40001, ssl: 40002 },
    esplora: [{ name: 'mempool.space testnet4', url: 'https://mempool.space/testnet4/api' }],
    explorer: 'https://mempool.space/testnet4',
  }),
  signet: Object.freeze({
    name: 'signet', label: 'Signet', bech32: 'tb', ...TEST_KEYS, genesis: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
    p2pPort: 38333, rpcPort: 38332, electrumPorts: { tcp: 60601, ssl: 60602 },
    esplora: [{ name: 'mempool.space signet', url: 'https://mempool.space/signet/api' }],
    explorer: 'https://mempool.space/signet',
  }),
  regtest: Object.freeze({
    name: 'regtest', label: 'Regtest', bech32: 'bcrt', ...TEST_KEYS, genesis: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
    p2pPort: 18444, rpcPort: 18443, electrumPorts: { tcp: 50001, ssl: 50002 },
    esplora: [{ name: 'local esplora (electrs)', url: 'http://127.0.0.1:3002' }],
    explorer: '',
  }),
});

export const NETWORK_NAMES = Object.keys(NETWORKS);

// Accepts a name or an already resolved params object, so every API can take either. Unknown names throw: falling
// back to mainnet on a typo ('testnet3') would derive real-money addresses for a test wallet.
export function network(n = 'mainnet') {
  if (n && typeof n === 'object') return n;
  const p = NETWORKS[n];
  if (!p) throw new Error(`unknown network "${n}"`);
  return p;
}

// Networks whose prefixes an address uses (by its form only; the checksum is not checked here). A UI hint (e.g. "this
// looks like a testnet address"), never validation - use address.js decodeAddress for that.
// Order matters: 'bcrt1' must be tested before 'bc1' (it is a prefix of it). Bech32 is case-insensitive (QR codes
// use upper case), hence toLowerCase; Base58 is case-sensitive, hence the raw string for [13] / [mn2].
export function networksOfAddress(address) {
  const a = String(address).trim();
  const low = a.toLowerCase();
  if (low.startsWith('bcrt1')) return ['regtest'];
  if (low.startsWith('bc1')) return ['mainnet'];
  if (low.startsWith('tb1')) return ['testnet', 'testnet4', 'signet'];
  if (/^[13]/.test(a)) return ['mainnet'];
  if (/^[mn2]/.test(a)) return ['testnet', 'testnet4', 'signet', 'regtest'];
  return [];
}
