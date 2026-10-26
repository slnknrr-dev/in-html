# ethereum-wallet

An Ethereum wallet, block explorer and dashboard for Ethereum and every EVM chain, as one page. Keys are created and
kept in the browser, encrypted; signing happens there. The network is only the JSON-RPC endpoint the user chooses
(their own node, a public endpoint, or this application's backend), and the offline build has no network code at all.

Built on `ethereum/` (transactions, ABI, ERC-20 / 721 / 1155, EIP-191 / EIP-712, keystores, EIP-681, ENS, JSON-RPC,
fees, HD accounts), `hdkey/` (BIP-39 / BIP-32), `walletui/` (vault, lock screens, recovery phrases, QR codes, address
book, endpoint picker, charts) and `ui/`.

## Features

- **Wallets** (shared by every chain: an account has the same address on all EVM chains): new HD wallets (12 or 24
  words, the backup check asks for random words), restore from a recovery phrase (every BIP-39 word list; BIP-44
  `m/44'/60'/0'/0/i` as MetaMask / Trezor, or Ledger Live `m/44'/60'/i'/0/0`; optional passphrase; several accounts),
  import of a private key or a keystore v3 file (scrypt / PBKDF2, with progress), watch-only addresses and ENS names
  (resolved over the Ethereum mainnet endpoint).
- **Overview**: ether balance of each account, ERC-20 tokens added by contract address (symbol, decimals and name
  read with `eth_call`, or typed when offline) with their balances (`balanceOf`), accounts added on demand, labels,
  context menus (right click or long press) on accounts and tokens.
- **Receive**: the address and an EIP-681 QR code (`ethereum:<address>@<chainId>?value=…`, or an ERC-20
  `transfer` link with an amount).
- **Send** ether or a token: recipient as an address (EIP-55 checked), ENS name, address book entry, scanned QR or
  pasted `ethereum:` link; amount with "max" for ether; EIP-1559 fees from `eth_feeHistory` (slow / normal / fast
  from the 10th / 50th / 90th reward percentiles, `ethereum/fees.js`) or custom max fee and priority fee, a gas price
  on chains without EIP-1559 (legacy type 0 with EIP-155); the gas limit from `eth_estimateGas` with a 20 % margin
  (reverts are decoded), the nonce from `eth_getTransactionCount('pending')` — all editable. The review shows the
  decoded transaction and the maximum cost; it is signed in the browser and broadcast with `eth_sendRawTransaction`,
  or exported signed (text, file, QR) for broadcasting elsewhere.
- **Offline signing**: the same form works without an endpoint: chain id, nonce, gas limit and fees are typed, the
  signed raw transaction is exported.
- **Pending transactions** are remembered in the vault: status from the receipts, "speed up" (same nonce, fees raised
  by at least 12.5 % and not below the current fast suggestion) and "cancel" (a 0-value transfer to yourself with the
  same nonce).
- **History**: the transactions this app sent, with their receipts. A JSON-RPC node has no index of an address's
  transactions: the full history needs an explorer API, or the watch index of this application's backend (shown
  when the page is served by it; "Index on this server" registers the public addresses).
- **Messages**: EIP-191 `personal_sign` and EIP-712 typed data (JSON) signing; verification recovers the signer.
- **Keystore** export of an account (scrypt, the password chosen there) and the **backup** page (the recovery phrase
  or the private key after re-entering the vault password; rename, delete).
- **Address book** in the vault (addresses or ENS names; context menu with "send").
- **Explorer** (connected): search by transaction hash, block number or hash, address or ENS name; a raw signed
  transaction opens the decoder. Latest blocks, the pending block when the node offers it, block pages (time, gas
  used / limit, base fee, burnt fees, transactions), transaction pages (status from the receipt, fees paid, gas
  used, call data decoded with the standard ABIs (ERC-20, ERC-721, ERC-1155, WETH) and the user's saved ABIs, logs
  decoded with `ethereum/logs.js`, token transfers), address pages (balance, nonce, contract or account, EIP-7702
  delegation, balances of the added tokens), and a **contract tool**: an ABI (JSON or human-readable) and an address
  -> the view / pure functions -> inputs -> `eth_call` -> decoded outputs; ABIs are saved in the vault and used by
  the decoders.
- **Dashboard** (connected): portfolio of all accounts on the chain (ether, tokens, the share of each account), the
  balance history from the snapshots this app records (below), the server's snapshot series when served by the
  backend, the gas tracker (base fee of the last 50 blocks, average priority fee at the 10th / 50th / 90th
  percentile, suggested slow / normal / fast fees), network statistics (chain id, latest block, average block time
  over the last 20 blocks, gas used ratio, client version).
- **Tools** (no endpoint needed): raw transaction decoder (type, chain, nonce, fees, recipient, value, decoded call
  data, the sender recovered from the signature, the hash, consensus checks; broadcast when connected), ABI encoder /
  decoder, EIP-681 URI decoder, exact unit converter (wei / gwei / ether), keystore decrypt / encrypt.
- **Settings**: the chain (`ethereum/chains.js`: Ethereum, Sepolia, Hoodi, OP, Arbitrum, Base, Polygon, … and a local
  Anvil / Hardhat 31337), the JSON-RPC endpoint of each chain (`walletui/endpoints.js`: the public endpoints are only
  listed, nothing is contacted before the user picks one; the connection test checks the chain id), the vault
  (auto-lock, lock now, change password, encrypted backup download), the build mode and the privacy statement.
- Desktop and phone layouts (a bottom tab bar under 720 px), light and dark themes, English strings
  (`strings-en.js`, the reference for the other languages).

### Balance snapshots

Each refresh of the balances (overview, wallet list, dashboard) records the ether balance of each account on the
current chain in the vault: at most one point per 10 minutes per account (a change inside the window updates that
window's point), 2000 points per account and chain. They are local to the browser and drawn on the dashboard; they
are not a full history (no indexer) — the backend's watch index records its own (checked every minute, a point per 10 minutes).

## Artifacts

| NOTICE | artifact | run |
| --- | --- | --- |
| `SINGLEFILE_OFFLINE_NOTICE.md` | `html@5_offline_singlefile/index.html`: cold wallet, no network code (`rpc.offline.js`, `net.offline.js`); the explorer and dashboard are hidden | open the file |
| `SERVERLESS_NOTICE.md` | `html@5_serverless/`: static site, talks only to endpoints the user chooses | any static host |
| `BACKEND_NOTICE.md` | `html@5_backend/`: `server.mjs` + `backend.mjs` + `public/` | `node server.mjs [port] [--host 0.0.0.0] [--data <dir>]` |

Build: `node singlefile.js ethereum-wallet`. Development: `node ethereum-wallet/server.js [port]` serves the sources
and mounts `backend.js` at `/ethereum-wallet/api/` (data in `ethereum-wallet/.data/`).

## Backend

`backend.js` (default export `(ctx) => ({ handle(req, res, url) })`, mounted by `hosting.js` and by the development
server; it uses the global `fetch` of Node >= 18). Configuration by environment variables:

| variable | meaning |
| --- | --- |
| `ETH_RPC_URL` | the owner's node (geth, reth, erigon, nethermind, anvil), e.g. `http://127.0.0.1:8545` |
| `ETH_UPSTREAMS` | comma-separated JSON-RPC URLs, tried in order (failover on transport errors, HTTP 5xx and 429) |
| `ETH_CHAIN_ID` | the expected chain id; on a mismatch with `eth_chainId` the proxy refuses to serve |
| `ETH_TOKEN` | bearer token for watch-list changes; without it one is generated, kept in the storage and printed at start |

API under `<base>api/` (works at `/` and below a prefix such as `/ethereum-wallet/`; CORS for GET / POST):

- `GET api/info` -> `{ app: 'ethereum-wallet', version, chainId, head, upstream (host only), watchOnly: true }`.
- `POST api/rpc` -> JSON-RPC 2.0, single or batch (up to 100), methods: `eth_chainId`, `eth_blockNumber`,
  `eth_getBalance`, `eth_getTransactionCount`, `eth_getCode`, `eth_getStorageAt`, `eth_call`, `eth_estimateGas`,
  `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_getBlockByNumber`, `eth_getBlockByHash`,
  `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getLogs` (at most 5000 blocks per request),
  `net_version`, `web3_clientVersion`, and `eth_sendRawTransaction` (relays signed transactions). Bodies are limited
  to 1 MiB. Immutable answers (blocks by hash, blocks, transactions and receipts at least 64 blocks deep, the chain
  id) are kept in an in-memory LRU cache.
- `GET api/watch` (the list), `POST api/watch` `{ label, addresses, tokens }` (token), `GET api/watch/<id>` ->
  `{ balances, series, transactions, scanned }`, `DELETE api/watch/<id>` (token). A background job (every 60 s)
  records balance snapshots (ether and the listed ERC-20 tokens; a point per 10 minutes) and scans new blocks from
  the block where watching started (up to 200 blocks per run): full transactions from or to the watched addresses,
  and ERC-20 `Transfer` logs (`eth_getLogs` with the padded addresses as topics). Everything is stored in
  `ctx.storage`. Requests that contain anything that looks like a private key are refused.

## Security model

- Private keys and recovery phrases exist only inside the vault (`walletui/vault.js`): one JSON object encrypted with
  AES-256-GCM under a key derived from the password with Argon2id (64 MiB, 3 passes), stored in `localStorage`
  (`ethw-vault`), decrypted in memory only while unlocked, locked automatically after inactivity (5 minutes by
  default). Keys are derived or decoded for one signature and the copy is overwritten afterwards; JavaScript cannot
  erase copies made by the engine, so this limits exposure rather than guaranteeing erasure.
- Nothing secret is ever sent: endpoints and the backend see only public data (addresses looked up, signed
  transactions broadcast). The backend is watch-only and refuses keys. Settings (`ethw-settings`: chain, endpoints,
  auto-lock) are not secret.
- Showing the recovery phrase or the private key asks for the vault password again.
- The offline build contains no network API at all (checked by `node check.js audit`).

## Files

| file | contents |
| --- | --- |
| `index.html`, `app.css` | the page (inline SVG favicon) and the Ethereum accent on `walletui/wallet.css` |
| `main.js` | shell, lock screen, section routing, the backend probe (`walletui/net.js`) |
| `state.js` | settings, vault data, wallets and accounts, keys while unlocked, endpoints and JSON-RPC clients, tokens, ABIs, sent transactions, snapshots |
| `common.js` | amounts, balances, recipients (ENS), call / log decoding, the decoded transaction view |
| `wallet.js`, `send.js` | the wallet section; sending, offline signing, speed up / cancel |
| `explorer.js`, `dashboard.js`, `tools.js`, `settings.js` | the other sections |
| `strings.js`, `strings-en.js` | UI strings (`eth.*`; the shared `wu.*` come from `walletui/`) |
| `backend.js`, `server.js` | the backend and the development server |
| `e2e.js` | browser scenario with a mocked JSON-RPC endpoint (Anvil 31337) |
| `test.js` | backend tests against a local mock JSON-RPC node (allowlist, batches, failover, relay, watch list); an Anvil test when `anvil` is installed: `node ethereum-wallet/test.js` |

Checks: `node check.js modules ethereum-wallet ethereum`, `node ethereum/test.js`,
`node check.js e2e http://127.0.0.1:<port>/ethereum-wallet/ ethereum-wallet/e2e.js --lang en` (also with
`--mobile --size 390x844`, and on the offline single file).

## Limits

- No transaction index: the history lists what this browser sent (plus the backend's watch index). Incoming
  transfers show up in balances only.
- ENS resolution uses the mainnet endpoint; names are normalised with a subset of ENSIP-15 — check the resolved
  address shown before sending. Offchain (CCIP-read) resolvers are not followed.
- Tokens: ERC-20 only for balances and sending (ERC-721 / 1155 transfers are decoded in the explorer, not sent).
- Blob (type 3) and set-code (type 4) transactions are decoded but not created. Hardware wallets are not supported.
- Fee suggestions come from the last 20 blocks of fee history; on L2s the L1 data fee is not shown.
- Balance snapshots are taken only when the app refreshes balances; the chart is not a complete history.
- The JSON-RPC endpoint sees the addresses you look up and your IP address; use your own node for privacy.
