# Serverless build

`html@5_serverless/` is the wallet, explorer and dashboard as a static site for any static host. It needs no server
of ours: keys stay encrypted in the visitor's browser, and the only requests go to the JSON-RPC endpoints the user
chooses per chain in the settings (their own node or a public one). The public endpoints of `ethereum/chains.js` are
only listed — nothing is contacted before the user picks one and accepts the privacy note.
