# Single-file offline artifact

`html@5_offline_singlefile/index.html` is the Bitcoin wallet as one self-contained HTML file with no network code at
all (`bitcoin/esplora.offline.js`, `walletui/net.offline.js`): a cold wallet and signing tool for a computer that
never goes online. Create or restore HD wallets (BIP-39 phrases, BIP-44 / 49 / 84 / 86 accounts), show receive
addresses and their QR codes, export xpubs and output descriptors for a watch-only wallet, load PSBTs from a file, text
or the camera, check and sign them, and give the result back as a file, text or QR codes; sign and verify messages
(Bitcoin Core / BIP-137, BIP-322); decode raw transactions, PSBTs, scripts, block headers and descriptors. Keys stay in
the vault of this browser (Argon2id + AES-256-GCM). The explorer and the dashboard are not part of this build.
