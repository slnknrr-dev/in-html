# Backend artifact

`html@5_backend/`: `server.mjs` (hosting.js) + `backend.mjs` (the bundled `backend.js`) + `public/` (the wallet).
Run `node server.mjs [port] [--host 0.0.0.0] [--data <dir>]` with your data source in the environment:
`BTC_RPC_URL` (+ `BTC_RPC_USER` / `BTC_RPC_PASSWORD` or `BTC_RPC_COOKIE`) for your Bitcoin Core node,
`BTC_ELECTRUM=host:port[:s]` for an Electrum server, or `BTC_ESPLORA_URL` for an upstream Esplora; `BTC_NETWORK`
selects the network. The server answers the explorer and the dashboard with an Esplora-compatible API at
`api/esplora/`, caches immutable data, and indexes the wallets you put on its watch list (`api/watch`: xpubs,
descriptors, addresses; changes need the token printed at start or `BTC_TOKEN`). It is watch-only: private keys and
recovery phrases never leave the browser, and the server refuses anything that looks like a private key.
