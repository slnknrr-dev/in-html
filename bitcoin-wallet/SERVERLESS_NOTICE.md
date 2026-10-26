# Serverless artifact

`html@5_serverless/` is the Bitcoin wallet, explorer and dashboard as a static site for any static host (GitHub
Pages, Codeberg Pages, a folder on your own web server). There is no server of ours: the page talks only to the
Esplora server **you** choose per network in the settings — mempool.space and blockstream.info are listed as presets,
your own electrs / esplora works too — and nothing is contacted before you pick one. Keys and recovery phrases stay
encrypted in your browser and never leave it; servers only see the addresses you look up and the transactions you
broadcast.
