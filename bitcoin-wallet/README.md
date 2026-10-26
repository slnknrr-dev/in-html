# Bitcoin Wallet

A Bitcoin wallet, block explorer and dashboard in one page, for desktop and phones, in seven languages (en, ru, uk,
de, fr, es, ka). Built on the `bitcoin/`, `hdkey/`, `crypto/` and `walletui/` libraries; no dependencies.

**Private keys and recovery phrases never leave the browser.** They are kept in an encrypted vault (password →
Argon2id, 64 MiB, 3 passes → AES-256-GCM) in this browser's storage, decrypted only in memory while unlocked, and the
vault locks itself after a few idle minutes. Servers — public Esplora instances, your node, this app's backend —
only ever receive public data: the addresses you look up and the transactions you broadcast. No telemetry, no
analytics, no server is contacted before you choose one.

## Features

- **Wallets**: create (12 or 24 words, the phrase hidden until revealed, a backup check that asks for random words,
  optional BIP-39 passphrase), restore (any official BIP-39 word list, completion, checksum feedback), several
  wallets and accounts (BIP-84 native SegWit, BIP-86 Taproot, BIP-49 nested SegWit, BIP-44 legacy), watch-only
  wallets from xpub / ypub / zpub / tpub / upub / vpub, output descriptors (receive + change or `<0;1>`) or plain
  addresses; mainnet, testnet3, testnet4, signet and regtest.
- **Receive**: fresh addresses after a gap-limit scan, BIP-21 payment requests (amount, label, message) as QR codes,
  address labels, the address list of every account.
- **Send**: several recipients, the address book, BIP-21 links and QR scanning (camera or picture), "send
  everything", fee rates from the server's estimates or typed in sat/vB, coin control (choose, freeze and label
  coins), replace-by-fee signalling, Bitcoin Core's coin selection (branch and bound, knapsack), a random change
  position, a review with every input and output; then sign in the browser and broadcast, sign and export the raw
  transaction, or export a PSBT (file, Base64, QR codes) for a hardware wallet or the offline build. Fee bumping of
  unconfirmed sends (RBF, BIP-125) and child-pays-for-parent for unconfirmed receipts, from the history's context menu.
- **PSBT tool**: load PSBTs from a file, text or QR codes; decode; sign with an unlocked wallet; combine; finalize;
  extract; broadcast or export. Signatures are byte-identical to Bitcoin Core's (low R).
- **Messages**: sign with the legacy format (Bitcoin Core, BIP-137 headers) or BIP-322; verify both, for any address
  type (BIP-322 signatures of multisig and timelocked scripts are checked by the script interpreter).
- **Labels and contacts**: BIP-329 import / export, labels of transactions, addresses and coins, an address book.
- **Explorer**: search by transaction id, block hash or height, address, or paste raw data; latest blocks and the
  mempool; blocks with their transactions; transactions decoded (scripts as ASM, witnesses, fee and fee rate, RBF,
  lock time, outspends) with every input verified by the interpreter; addresses with balance, history and coins;
  the decoder (raw transactions, PSBTs, scripts, block headers, descriptors and their addresses, BIP-21 links) works
  without a server.
- **Dashboard**: portfolio of the network's wallets, the combined balance history, every coin with a size histogram,
  the fee market (estimates by target) and the mempool by fee rate, network statistics (height, block interval,
  difficulty, mempool).
- Context menus on lists by right click or long press; light / dark themes; a bottom tab bar on phones.

## Files

| file | contents |
| --- | --- |
| `index.html`, `main.js` | page and shell: vault lock screen, tabs, routes, artifact modes |
| `state.js` | settings, vault data (wallets, address book, labels), master keys while unlocked, sync cache, the Esplora client of the chosen server |
| `common.js` | amounts, wallet synchronisation, the decoded transaction view |
| `wallet.js`, `send.js` | the wallet section; sending, PSBT export, RBF and CPFP |
| `explorer.js`, `dashboard.js`, `tools.js`, `settings.js` | the other sections |
| `strings.js`, `strings-*.js` | UI strings in seven languages |
| `backend.js`, `providers.js` | the backend of the BACKEND artifact (below) |
| `server.js` | development server: `node bitcoin-wallet/server.js [port]` (mounts `backend.js` at `/bitcoin-wallet/api/`) |
| `e2e.js` | browser scenario: `node check.js e2e <url or file> bitcoin-wallet/e2e.js --lang en [--mobile --size 390x844]` |
| `test.js` | backend tests against local mock servers (Esplora, Core RPC, Electrum); a bitcoind regtest test when installed |

## Artifacts

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | a cold wallet and signing tool in one file without any network code: keys, addresses, PSBT signing, messages, decoders ([notice](SINGLEFILE_OFFLINE_NOTICE.md)) |
| `html@5_serverless/` | the full wallet as a static site; it talks only to the Esplora servers you choose ([notice](SERVERLESS_NOTICE.md)) |
| `html@5_backend/` | `node server.mjs` serves the wallet and an Esplora-compatible API from your Bitcoin Core node, an Electrum server or an upstream Esplora ([notice](BACKEND_NOTICE.md)) |

### Backend configuration

| variable | meaning |
| --- | --- |
| `BTC_NETWORK` | `mainnet` (default), `testnet`, `testnet4`, `signet`, `regtest` |
| `BTC_RPC_URL`, `BTC_RPC_USER`, `BTC_RPC_PASSWORD`, `BTC_RPC_COOKIE`, `BTC_RPC_WALLET` | Bitcoin Core: blocks, transactions (`-txindex` for any transaction), fee estimates, mempool; address queries for watched wallets through a watch-only descriptor wallet (default `in-html-watch`) |
| `BTC_ELECTRUM` | `host:port` or `host:port:s` (TLS); `BTC_ELECTRUM_VERIFY=1` checks the certificate |
| `BTC_ESPLORA_URL` | an upstream Esplora API, proxied with a cache |
| `BTC_SOURCE` | `core`, `electrum` or `esplora` when several are set |
| `BTC_TOKEN` | the bearer token for watch-list changes (else generated and printed at start) |

API: `api/info`, `api/esplora/…` (Esplora's REST API, `POST api/esplora/tx` broadcasts), `api/watch` (the watch list
of xpubs, descriptors and addresses with balances, coins, history and balance series, refreshed every minute).

## Limits

- secp256k1 in JavaScript is not constant time; the wallet is meant for your own device, not a shared server.
- Browser storage can be cleared by the browser or the user: keep the recovery phrase on paper; the encrypted vault
  backup (Settings) is a convenience, not a replacement.
- With Electrum, block pages show headers only (Electrum has no block contents) and transaction status needs a server
  that answers verbose `blockchain.transaction.get`; with Bitcoin Core, address pages work for watched wallets only.
- No hardware-wallet USB connection (use PSBT files or QR codes), no MuSig2, no Lightning, no fiat prices (they would
  need a price server).
