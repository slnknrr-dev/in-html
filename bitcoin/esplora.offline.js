// bitcoin/esplora.offline.js - esplora.js for offline builds: the same exports without any network code; every call
// of a client rejects with Error('offline build').
//
// Same export surface as esplora.js so importing code needs no build-time branches; the offline build audit (no
// fetch / network APIs anywhere) can then pass. Keep METHODS in sync with esplora.js when adding a method, or an
// offline app calling it gets "not a function" instead of the clean 'offline build' rejection.
import { sha256 } from '../crypto/sha2.js';
import { bytesToHex } from '../crypto/encoding.js';

export const ONLINE = false;

export const scriptHashOf = (script) => bytesToHex(sha256(script));

export class EsploraError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

const off = () => Promise.reject(new EsploraError('offline build', 0, null));
const METHODS = ['request', 'tipHeight', 'tipHash', 'blockHash', 'block', 'blockHeader', 'blockStatus', 'blockTxids', 'blockTxs',
  'blockRaw', 'blocks', 'tx', 'txHex', 'txStatus', 'txOutspends', 'txMerkleProof', 'broadcast', 'address', 'addressTxs',
  'addressMempoolTxs', 'addressUtxos', 'scripthash', 'scripthashTxs', 'scripthashUtxos', 'mempool', 'mempoolRecent',
  'mempoolTxids', 'feeEstimates', 'recommendedFees', 'mempoolBlocks'];

export function createEsploraClient({ url = '' } = {}) {
  const c = { url };
  for (const m of METHODS) c[m] = off;
  return c;
}
