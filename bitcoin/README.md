# bitcoin

Bitcoin for wallets, explorers and signing tools in the browser and in Node: networks, scripts and a script
interpreter, addresses, transactions with every signature hash, taproot trees, PSBT v0 / v2 with every role, output
descriptors, HD accounts, coin selection, fees, RBF / CPFP, message signing (BIP-137, BIP-322), BIP-21 URIs, BIP-329
labels, blocks, wallet synchronisation and three clients (Esplora REST, Bitcoin Core JSON-RPC, Electrum). Vanilla ES
modules, no dependencies, no DOM. Built on `crypto/` (secp256k1, SHA-2, RIPEMD-160, Base58Check), `codec/bech32.js`
and `hdkey/` (BIP-32, BIP-39).

**Private keys never leave the caller.** Signing functions take keys (or an HD master key) as arguments and return
signatures / PSBTs; nothing is stored or sent. Only `esplora.js`, `rpc.js` and `electrum.js` talk to a network, only to
the URL / host the caller gives, and only when a method is called; offline builds replace `esplora.js` by
`esplora.offline.js` (same exports, no network code). Amounts are Numbers of satoshis (exact: 21 million BTC < 2^53).

## Modules

| module | API |
| --- | --- |
| `networks.js` | `NETWORKS` (mainnet, testnet, testnet4, signet, regtest: bech32 prefix, address / WIF versions, SLIP-132 prefixes, BIP-44 coin type, genesis, ports, Esplora presets), `network(name)`, `networksOfAddress(address)`, `NETWORK_NAMES` |
| `bytes.js` | `Reader` / `Writer` (little endian, CompactSize), `reverseHex`, `hexToBytesLE`, `bytesToHexLE`, `varintSize` |
| `script.js` | `OPS`, `OP_NAMES`, `decompile`, `compile`, `getOp` (Core's GetScriptOp), `toAsm`, `fromAsm`, `pushData`, `scriptNumEncode` / `scriptNumDecode`, `classify(script)` (p2pkh, p2sh, p2wpkh, p2wsh, p2tr, p2pk, multisig, nulldata, anchor, witness_unknown), builders `p2pkh`, `p2sh`, `p2wpkh`, `p2wsh`, `p2tr`, `p2pk`, `witnessProgram`, `multisig(m, keys, { sorted })`, `multiA` (BIP-387), `nulldata`, `parseMultisig`, `parseWitnessProgram` |
| `address.js` | `toOutputScript(address, net)`, `fromOutputScript(script, net)`, `decodeAddress`, `isValidAddress`, `addressOf(pubkey, type, net)`, `scriptOf(pubkey, type)`, `p2pkhAddress`, `p2shP2wpkhAddress`, `p2wpkhAddress`, `p2trAddress(internalKey, net, merkleRoot)`, `p2shAddress`, `p2wshAddress`, `p2shP2wshAddress`, `encodeWIF` / `decodeWIF`, `hash160`, `hash256`, `xOnly`, `ADDRESS_TYPES` |
| `tx.js` | `Transaction` (`fromHex` / `fromBytes`, `toBytes({ witness })`, `txid`, `wtxid`, `size`, `weight`, `vsize`, `signalsRbf`, `addInput`, `addOutput`), `sighashLegacy` (Core's SignatureHash incl. the SIGHASH_SINGLE bug and OP_CODESEPARATOR removal), `sighashV0` (BIP-143), `sighashTaproot` / `sigMsgTaproot` (BIP-341, key and script paths, annex), `SIGHASH`, `RBF_SEQUENCE` |
| `taproot.js` | `tapLeafHash`, `tapBranchHash`, `tapTree(tree)`, `taprootCommit(internalKey, tree)` → output key, parity, merkle root, control blocks; `parseControlBlock`, `rootFromControlBlock`, `tapTreeToList` / `tapTreeFromList` (BIP-371) |
| `interpreter.js` | `verifyScript(scriptSig, scriptPubKey, witness, flags, checker)` → `{ ok, error }` with Core's error names, `verifyInput(tx, index, prevouts, flags)`, `txChecker`, `FLAGS`, `parseFlags`, `STANDARD_FLAGS`, `MANDATORY_FLAGS`, `evalScript`: legacy, P2SH, segwit v0, taproot key path and tapscript (OP_CHECKSIGADD, OP_SUCCESSx, validation weight), CLTV / CSV, every policy flag |
| `psbt.js` | `Psbt` — `parse` / `fromBase64` / `fromHex`, `create`, `fromTransaction`, `toBase64` / `toHex`, `tx()`, `txid()`, `toVersion(0 \| 2)`, `addInput`, `addOutput`, `updateInput`, `updateOutput`, `spentOutput`, `fee`, `signInput(i, signer)` / `signAll` (single keys or an HD master key matched by fingerprint; Core's low-R ECDSA, BIP-340 key path with the BIP-341 tweak, tapscript leaves), `validateSignatures`, `combine`, `finalizeInput` / `finalizeAll` (P2PKH, P2WPKH, P2SH-P2WPKH, bare / P2SH / P2WSH / P2SH-P2WSH multisig, pk / pkh scripts, taproot key path, pk() and multi_a leaves), `extract`; BIP-174, BIP-370 (v2), BIP-371 taproot fields, BIP-373 MuSig2 field checks; Core's field order |
| `descriptor.js` | `parseDescriptor(text, { network, requireChecksum })` → `Descriptor` (`expand(index, { multipath })` → scripts, keys with origins, redeem / witness scripts, taproot data; `script`, `address`, `toString({ public })`, `split()`, `isRange`, `multipath`, `hasPrivateKeys`), `descriptorChecksum`, `addChecksum`, `deriveAddresses`; pk, pkh, sh, wpkh, wsh, multi, sortedmulti, combo, raw, addr, tr with trees, multi_a, sortedmulti_a, key origins, xpub / xprv / WIF / hex / x-only keys, ranges, BIP-389 `<a;b>` |
| `account.js` | `deriveAccount(master, { type, account, network })` (BIP-44 / 49 / 84 / 86), `Account.fromExtendedKey(xpub \| ypub \| zpub …)`, `Account.fromDescriptors(receive, change)`; `account.address(chain, index)`, `script`, `spendInfo` (everything a PSBT needs), `descriptor()` (multipath `<0;1>` with checksum), `xpub`, `slip132`, `fingerprint`, `path`; `accountPath`, `PURPOSE_TYPE`, `TYPE_PURPOSE` |
| `fees.js` | `inputWeight(type \| spendInfo)`, `spendType`, `outputSize`, `txWeight`, `txVsize`, `feeFor`, `feeRateOf`, `dustThreshold(script, dustRelayFee = 3)` (Core's GetDustThreshold), `pickFeeRates(esploraEstimates)` |
| `coinselect.js` | `selectCoins({ utxos, target, feeRate, baseWeight, … })`: Core's branch and bound (changeless, least waste), knapsack (ApproximateBestSubset) and largest-first, ranked by Core's waste metric; coin control (`include`); `waste` |
| `spend.js` | `createSpend({ utxos, recipients, feeRate, change, … })` → a PSBT ready for signers (UTXOs, scripts, BIP-32 / taproot derivations, change marked, change position random, send-max), `bumpFee` (RBF, BIP-125 rules 3 and 4), `cpfp`, `psbtInputFields`, `psbtOutputFields`, `minimumBumpFee` |
| `message.js` | `signMessage` / `verifyMessage` (Core's format and BIP-137 headers), `bip322Sign` (simple for P2WPKH / P2TR, full for P2PKH / P2SH-P2WPKH), `bip322Verify` (simple, full and proof-of-funds, any script through the interpreter: multisig, timelocks), `messageHash`, `bip322MessageHash`, `bip322ToSpend`, `bip322ToSign` |
| `uri.js` | `parseBitcoinURI(text, { network, known, validateAddress })`, `formatBitcoinURI(fields, { qr })` (BIP-21) |
| `labels.js` | `exportLabels(records)`, `importLabels(text, { maxLength = 255 })`, `validateLabel`, `LABEL_TYPES` (BIP-329) |
| `units.js` | `parseBtc(text, unit)`, `formatBtc(sats, { unit, trim, group, sign })`, `formatSats`, `formatFeeRate`, `btcToSats`, `satsToBtc`, `UNITS`, `MAX_MONEY` |
| `block.js` | `parseHeader`, `serializeHeader`, `blockHash`, `bitsToTarget`, `targetToBits`, `difficulty`, `checkProofOfWork`, `merkleRoot`, `merkleProof`, `verifyMerkleProof`, `parseBlock`, `coinbaseHeight` (BIP-34), `blockSubsidy` |
| `sync.js` | `scanAccount(account, source, { gapLimit = 20 })` (used addresses, transactions, UTXOs, balances), `walletHistory(txs, ownScripts)`, `balanceSeries(history)`, `utxoFromEsplora` |
| `esplora.js` / `esplora.offline.js` | `createEsploraClient({ url, fetch, timeout })` → blocks, transactions, addresses / scripthashes, mempool, fee estimates, broadcast, mempool.space extras when present; `scriptHashOf`, `EsploraError`, `ONLINE` |
| `rpc.js` | `createCoreRpc({ url, user, password, cookie, wallet, fetch })` → Bitcoin Core JSON-RPC (blockchain, mempool, raw transactions, fee estimates, descriptors, watch-only descriptor wallets), `RpcError`, `btcKvbToSatVb` |
| `electrum.js` | `createElectrumClient({ host, port, tls, net, tlsModule })` → Electrum protocol 1.4 over TCP / TLS (headers, fee estimates, scripthash balance / history / unspent / subscribe, transactions, broadcast), `electrumScriptHash` |
| `test.js`, `test-wallet.js`, `test-vectors.json`, `script-tests.json` | unit tests: `node bitcoin/test.js` or `node check.js tests bitcoin` |

## For other applications (watch-only payment pages)

The pieces a donation page or an invoice needs, without any private key:

```js
import { deriveAddress } from '../bitcoin/account.js';
import { isValidAddress, decodeAddress } from '../bitcoin/address.js';
import { formatBitcoinURI, parseBitcoinURI } from '../bitcoin/uri.js';
import { createEsploraClient } from '../bitcoin/esplora.js';   // esplora.offline.js in offline builds

deriveAddress('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs', 0);
// -> 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' (xpub / ypub / zpub / tpub … at account level; { type: 'p2tr' } for BIP-86)
deriveAddress('wpkh([73c5da0a/84h/0h/0h]xpub6CatWdiZ…/<0;1>/*)#…', 3, 'mainnet', { chain: 0 });   // descriptors
isValidAddress('tb1q…', 'testnet4');                                 // checksum, network, witness version rules
formatBitcoinURI({ address, amount: 50000, label: 'Donation' }, { qr: true });   // BIP-21, upper-case for QR
const esplora = createEsploraClient({ url: 'https://mempool.space/api' });       // only the URL the user chose
(await esplora.address(address)).chain_stats.funded_txo_sum;          // received so far
```

`deriveAddress(spec, index = 0, network = 'mainnet', { chain = 0, type })` accepts an account-level extended public
key (the SLIP-132 prefix gives the script type), a ranged descriptor (BIP-389 `<0;1>` picks `chain`), or a plain
address (returned for every index); it refuses descriptors with private keys and keys of another network.

## Tests and vectors

`node bitcoin/test.js` (about 1,100 checks, no network) runs:

- Bitcoin Core `key_io_valid.json` / `key_io_invalid.json` (every address type, WIF keys, mainnet / testnet4 / signet /
  regtest), the BIP-350 valid and invalid segwit addresses;
- 100 of Core's 500 `sighash.json` legacy signature hashes, the BIP-143 examples (every hash type, OP_CODESEPARATOR,
  FindAndDelete; the RFC 6979 signature of the P2WPKH example), the BIP-341 wallet vectors (script trees, leaf hashes,
  control blocks, output keys, addresses, every key-path SigMsg / sighash / signature);
- Core's `script_tests.json`: all 1,258 cases of the interpreter with Core's exact error names (taproot cases with the
  generated control blocks);
- Core's `rpc_psbt.json`: 87 invalid PSBTs rejected (BIP-174, 370, 371, 373), 48 valid ones parsed, and the creator,
  signer (6), combiner (2), finalizer and extractor vectors reproduced byte for byte;
- the descriptor vectors of BIP-380 (checksums, key expressions), 381, 382, 383, 384, 385, 386, 387 and 389;
- the account vectors of BIP-49, BIP-84 and BIP-86 (and the usual BIP-44 address of the "abandon … about" phrase);
- message signatures: Core's `util_tests.cpp` / `rpc_signmessagewithprivkey.py` vectors, BIP-322 basic and generated
  vectors (simple, full, proof of funds, timelocks, multisig, every error case; our P2WPKH signatures equal the BIP's
  low-R ones);
- BIP-21 and BIP-329 examples, the genesis block header, coin selection, fee estimates, an end-to-end spend on regtest
  (P2WPKH, P2SH-P2WPKH, P2TR and P2PKH inputs: create, sign with the HD master, finalize, extract, every input verified
  by the interpreter), RBF and CPFP, and the three clients against mocked transports.

## Limits

- secp256k1 is not constant time (see `crypto/README.md`); signing is meant for the user's own device.
- The interpreter checks scripts, not transactions: no UTXO set, no coinbase maturity, no block-level rules.
- No MuSig2 signing (its PSBT fields are only validated), no silent payments, no BC-UR / animated QR encoding (the
  wallet shows PSBTs as Base64 text, files and plain QR codes).
- Esplora endpoints differ slightly between implementations; `recommendedFees` and `mempoolBlocks` exist only on
  mempool.space and return `null` elsewhere.
- Bitcoin Core does not answer browsers (no CORS): `rpc.js` is for Node (the wallet's backend).
