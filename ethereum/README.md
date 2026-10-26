# ethereum

Ethereum for wallets and explorers in the browser and in Node: units, RLP, addresses and checksums, transactions of
every type (legacy / EIP-155, EIP-2930, EIP-1559 signed; EIP-4844 and EIP-7702 parsed), EIP-191 / EIP-712 signed
messages, the Solidity ABI, token standards, Web3 Secret Storage keystores, EIP-681 payment URIs, ENS, a JSON-RPC
client with an offline twin, chain presets, event logs, HD accounts and fee suggestions. Vanilla ES modules, no
dependencies, no DOM; 256-bit quantities are `BigInt`. Built on `crypto/` (keccak256, secp256k1, scrypt, PBKDF2,
AES-CTR, randomness) and `hdkey/` (BIP-32, BIP-39).

**Private keys never leave the caller.** Functions that sign or encrypt take the key as an argument and return
signatures, transactions or keystore objects; nothing is stored, logged or sent anywhere. The only module with
network code is `rpc.js`, and it only sends what the caller asks it to (offline builds swap it for
`rpc.offline.js`, which has no network API at all).

## Modules

| module | API |
| --- | --- |
| `units.js` | `parseUnits(text, decimals = 18)` -> bigint (exact; too many decimals / garbage throw), `formatUnits(value, decimals = 18, { maxDecimals, group })` (trailing zeros trimmed; `maxDecimals` cuts, never rounds up), `parseEther`, `formatEther`, `parseGwei`, `formatGwei`, `UNITS`, `toQuantity(bigint \| number)` -> `'0x…'` (`'0x0'`), `fromQuantity(hex)` -> bigint, `toHex(bytes)`, `fromHex(text)`, `toBigInt(value)` |
| `rlp.js` | `rlpEncode(item)` (bytes, arrays, bigint / number minimal big-endian, `'0x…'` hex or UTF-8 strings), `rlpDecode(bytes \| hex, { stream })` (canonical only: non-minimal lengths, single bytes < 0x80 as strings, overruns and trailing bytes throw), `rlpToHex(tree)`, `bytesToInt(bytes)` (canonical integer field) |
| `address.js` | `ZERO_ADDRESS`, `publicKeyToAddress(pub33or65)`, `privateKeyToAddress(priv)`, `toChecksumAddress(addr, chainId = null)` (EIP-55; EIP-1191 for `EIP1191_CHAINS` = RSK 30 / 31), `isAddress(text, { strict, chainId })`, `isChecksumAddress(text, chainId)`, `getAddress(text)` (EIP-55 or throws on a bad mixed-case checksum), `addressToBytes`, `equalAddress`, `contractAddress(from, nonce)` (CREATE), `create2Address(from, salt32, initCodeHash32)`, `shortAddress(addr)` -> `'0x1234…abcd'` |
| `tx.js` | `normalizeTransaction(tx)`, `serializeTransaction(tx, signature = null)`, `parseTransaction(raw)` (recovers `from` and EIP-7702 authorities; errors carry ethereum/tests-style `code`s), `signingHash(tx)` -> Uint8Array, `signTransaction(tx, privateKey)` -> `{ raw, hash, tx }` (types 0-2, low-S, EIP-155 `v`), `transactionHash(raw)`, `recoverSender(tx)`, `intrinsicGas(tx)` (Prague rules incl. EIP-3860 initcode words and 7702 authorizations), `floorDataGas(tx)` (EIP-7623), `validateTransaction(tx, { chainId })` -> `[codes]`, `maxTransactionCost(tx)`, `effectiveGasPrice(tx, baseFee)`, `txTypeName(type)`, `authorizationHash(auth)`, `TX_TYPES`, `GAS_PER_BLOB` |
| `message.js` | EIP-191: `hashMessage(message)`, `signMessage(message, privateKey)` -> 65-byte `0x r s v` (v 27 / 28), `recoverMessageAddress`, `verifyMessage(message, signature, address)`, `hashValidatorData` (version 0x00); signatures: `splitSignature(sig)` -> `{ r, s, v, yParity, compact }` (65 bytes or EIP-2098 64 bytes), `joinSignature`, `recoverAddress(hash, sig)`; EIP-712: `encodeType`, `typeHash`, `encodeData`, `hashStruct(types, primaryType, data)`, `hashDomain(domain, types?)`, `hashTypedData({ types, primaryType, domain, message })`, `signTypedData`, `recoverTypedDataAddress` (nested structs, fixed / dynamic arrays, bytes, string, bool, address, intN / uintN, bytesN) |
| `abi.js` | `parseAbi(abi)` (JSON or human-readable lines) -> `{ fragments, functions, events, errors, constructor, fallback, receive, byName, bySelector, byTopic, eventsByTopic }`, `parseFragment`, `formatFragment(f, 'human' \| 'json' \| 'signature')`, `parseParam`, `encodeParameters(types, values)`, `decodeParameters(types, data)`, `functionSelector(sig)`, `eventTopic(f)`, `encodeFunctionData(f, args)`, `decodeFunctionData(abi, data)` -> `{ fragment, args }`, `encodeFunctionResult`, `decodeFunctionResult(f, data)`, `encodeDeployData(abi, bytecode, args)`, `encodeEventTopics(f, values)`, `decodeEventLog(abi, { topics, data })`, `encodeErrorResult`, `decodeErrorResult(abi, data)` (built-in `Error(string)`, `Panic(uint256)` with `PANIC_CODES`), `encodePacked(types, values)`, `formatAbiValue(value, type)` |
| `erc.js` | `ERC20_ABI`, `ERC721_ABI`, `ERC1155_ABI`, `WETH_ABI`, `ERC165_ABI`; `erc20TransferData`, `erc20ApproveData`, `erc20TransferFromData`, `erc20BalanceOfData`, `erc20AllowanceData`, `erc721SafeTransferData(from, to, tokenId, data?)`, `erc721TransferFromData`, `erc721OwnerOfData`, `erc1155SafeTransferData(from, to, id, amount, data)`, `erc1155SafeBatchTransferData`, `erc1155BalanceOfData`, `setApprovalForAllData`, `supportsInterfaceData`; `interfaceId(signatures)`, `INTERFACE_IDS`; `decodeTokenTransfer(data)` |
| `keystore.js` | `decryptKeystore(json, password)` (sync), `decryptKeystoreAsync(json, password, { onProgress, signal })`, `encryptKeystore(privateKey, password, { kdf = 'scrypt', n = 131072, r = 8, p = 1, c = 262144, salt, iv, uuid })`, `encryptKeystoreAsync`, `keystoreAddress(json)`; errors: code `'password'` (MAC mismatch, constant-time compare), `'address'`, `'format'` |
| `uri.js` | `parseEthereumURI(text, { strict })` -> `{ scheme, prefix, target, chainId, functionName, parameters, args, amount, token, to, checksumOk }`, `formatEthereumURI({ target, chainId, functionName, value, parameters, prefix })`, `erc20TransferURI(token, to, amount, chainId)`, `parseNumber`, `formatNumber` (EIP-681 scientific notation) |
| `ens.js` | `normalizeName`, `namehash`, `labelhash`, `dnsEncode`, `isEnsName`, `ENS_REGISTRY`, `getResolver(rpc, name)`, `resolveName(rpc, name)` (with ENSIP-10 wildcards), `lookupAddress(rpc, address)` (reverse record checked by forward resolution) |
| `rpc.js` / `rpc.offline.js` | `ONLINE`, `createRpcClient({ url, fetch, headers, timeout = 20000 })` -> `{ url, request, batch, chainId, blockNumber, getBalance, getTransactionCount, getCode, getStorageAt, call, estimateGas, gasPrice, maxPriorityFeePerGas, feeHistory, getBlock, getTransaction, getTransactionReceipt, getLogs, sendRawTransaction, clientVersion }`; errors keep JSON-RPC `code` / `data`, transport errors `'TIMEOUT'`, `'NETWORK'`, `'HTTP'`, `'BAD_RESPONSE'`; the offline twin rejects every call with `Error('offline build')` (code `'OFFLINE'`) |
| `rpc-format.js` | shared by both (no network code): `blockTag`, `toRpcTransaction`, `formatBlock`, `formatTransaction`, `formatReceipt`, `formatLog`, `formatFeeHistory`, `rpcError`, `jsonReplacer` |
| `chains.js` | `CHAINS` (Ethereum, Sepolia, Holesky (deprecated), Hoodi, OP Mainnet, Arbitrum One, Base, Polygon PoS, zkSync Era, Linea, Scroll, Gnosis, BNB Smart Chain, Avalanche C-Chain, OP / Arbitrum / Base Sepolia, Anvil / Hardhat 31337, geth --dev 1337: `{ id, name, short, currency, rpc, explorer, testnet, l2, eip1559 }`), `chainById`, `chainName`, `chainByShortName`, `explorerUrl(chainId, kind, value)` |
| `logs.js` | `KNOWN_ABI` (ERC-20, ERC-721, ERC-1155, WETH, Uniswap V2 Swap / Sync / Mint / Burn, V3 Swap), `decodeLogs(logs, extraAbi)` -> `[{ log, fragment, name, args, standard } \| { log, unknown: true }]`, `tokenTransfersOf(receipt)` |
| `hd.js` | `ETH_PATH`, `PATH_SCHEMES`, `ethPath(index, 'bip44' \| 'ledger-live' \| 'ledger-legacy')`, `deriveAccount(root, index, scheme)` -> `{ path, index, privateKey, publicKey (65 bytes), address }`, `accountFromMnemonic(mnemonic, passphrase, index, scheme)`, `deriveAddressFromXpub(xpub, index, { path })` (watch-only: donation pages, invoices) |
| `fees.js` | `suggestFees(feeHistory, { baseFeeMultiplier = 2, fallbackPriorityFee })` -> `{ baseFee, slow, normal, fast }`, `legacyGasPrice(gasPrice)`, `nextBaseFee(parent, { elasticity = 2, denominator = 8 })` (exact EIP-1559), `feeCost(gasLimit, level)` |
| `test.js`, `test-vectors.json` | unit tests: `node ethereum/test.js` or `node check.js tests ethereum` |

Decoded ABI arrays carry parameter names as extra properties (`args.to`); a name that is also an `Array` member
(`values`, `length`, `keys` …) is available by position only.

## Vectors

`node ethereum/test.js` checks (all pass, about 650 checks, a few seconds: the official keystore vectors run with
their full KDF costs in worker threads):

| source | vectors |
| --- | --- |
| ethereum/tests RLPTests `rlptest.json`, `invalidRLPTest.json` | 28 encodings (+ round trips), 26 rejections |
| ethereum/tests TransactionTests (all 14 groups, Prague results) | 48 valid (hash, sender, intrinsic gas), 160 invalid rejected |
| ethereum/tests BasicTests `txtest.json`, `keyaddrtest.json` | 2 signed Frontier transactions, 2 key -> address pairs |
| ethereum/tests ABITests `basic_abi_tests.json` | 3 |
| ethereum/tests KeyStoreTests `basic_tests.json` (incl. both Web3 Secret Storage vectors) | 5 (PBKDF2 and scrypt, unmodified parameters) |
| EIP-155 example | signing data, signing hash, v r s, signed transaction |
| EIP-55, EIP-1191 test cases | 8, 39 (chains 1, 30, 31) |
| EIP-1014 CREATE2 examples | 7 |
| EIP-712 Mail example (eip-712.md, Example.js) | encodeType, typeHash, encodeData, hashStruct, domain separator, hash, signature, recovery |
| ERC-2098 test cases | 2 (65-byte and compact signatures) |
| Solidity ABI specification | baz, bar, sam, f(uint,uint32[],bytes10,bytes), g(uint[][],string[]), encodePacked, error selector, tuple JSON |
| ERC-137 namehash, EIP-681 examples, ERC-165 / 721 / 1155 / 2981 interface ids | 3, 2, 9 |

Plus round trips of typed transactions (types 1-4, the EIP-4844 network form), EIP-1559 base fee rules, mocked
JSON-RPC and ENS resolution, the Hardhat / Anvil development accounts of "test test … junk" (public test keys).
The `sig_of_emptystring` fields of `keyaddrtest.json` use a hashing convention of the 2014 tooling that is not
documented, so only its key / address pairs are checked.

## Limits

- ENS: `normalizeName` is a basic subset of ENSIP-15 (NFC, lower case, allowed character classes, no empty labels);
  confusables, mixed scripts and exact emoji sequences are not checked. Offchain resolution (EIP-3668 CCIP-read) is
  not followed (`code: 'OFFCHAIN'`). Show resolved addresses to the user.
- Blob transactions are parsed (also the network form with the sidecar) but blobs, KZG commitments and proofs are not
  verified, and type 3 / 4 transactions are not signed by `signTransaction`.
- `validateTransaction` checks the static rules of a transaction (signature ranges and low S, chain id, nonce / gas
  limit / fee bounds, intrinsic gas and the EIP-7623 floor, initcode size, type 3 / 4 rules) with the current fork's
  numbers; state (balance, nonce) is the node's business.
- The ABI has no fixed-point types (`fixedMxN`); decoding is strict (zero padding, sign extension, offsets inside the
  data, bounded work) and will reject sloppy encoders that Solidity's own decoder would accept.
- secp256k1 is BigInt arithmetic and not constant time (see `crypto/README.md`): sign on a device you control, where
  the attacker cannot time the code. MACs are compared in constant time.
- Keystore passwords are UTF-8 as given (geth behaviour, no NFKC); scrypt `n` is capped at 2^22.
- Chain presets are data (public RPC endpoints rate-limit and change); `CHAINS` is never contacted by the library.
- EIP-1191 checksums apply only to chains listed in `EIP1191_CHAINS` (the reference implementation's rule), so
  `toChecksumAddress(addr, 1)` is plain EIP-55.
