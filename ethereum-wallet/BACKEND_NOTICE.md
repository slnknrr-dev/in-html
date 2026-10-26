# Backend build

`html@5_backend/` is the wallet with its own server: `node server.mjs [port] [--host 0.0.0.0] [--data <dir>]`
(Node >= 18, no dependencies) serves the pages from `public/` and `backend.mjs` (the bundled `backend.js`) answers at
`api/`: a JSON-RPC proxy (`api/rpc`) to the owner's node or to configured upstreams with failover, a method allowlist,
a cache of immutable answers (blocks by hash, mined transactions and receipts) and limits (body size, batch size,
`eth_getLogs` ranges), plus a watch index (`api/watch`) that records balance snapshots of ether and ERC-20 tokens
and indexes the transactions of watched addresses from the block where watching started, for the explorer, the
dashboard and the history. The page uses the proxy as its default endpoint.

It is watch-only: it never accepts a private key or a recovery phrase. Keys never leave the browser; the server only
relays transactions that were signed there.

Environment: `ETH_RPC_URL` (the owner's node: geth, reth, erigon, nethermind, anvil) or `ETH_UPSTREAMS`
(comma-separated URLs, tried in order), `ETH_CHAIN_ID` (checked against `eth_chainId`), `ETH_TOKEN` (bearer token
for watch-list changes; without it one is generated, stored and printed at start).
