# Single-file offline build

`html@5_offline_singlefile/index.html` is the wallet as one self-contained HTML file with no network code at all
(`ethereum/rpc.offline.js`, `walletui/net.offline.js`): a cold wallet and a signing and decoding tool. Create or
restore HD wallets, import private keys and keystore files, show addresses and EIP-681 QR codes, build and sign
transactions with a chain id, nonce, gas limit and fees you type, export the signed transaction as text, file or QR,
sign messages and EIP-712 typed data, write keystore files, and decode raw transactions, call data and payment links.
The explorer and the dashboard are hidden. Open it from disk (`file://`) on a device that stays offline; the vault
lives in that browser's local storage.
