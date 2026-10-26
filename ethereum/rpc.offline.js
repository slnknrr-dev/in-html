// ethereum/rpc.offline.js - ethereum/rpc.js for offline artifacts (bundle.js variant 'offline'): the same exports,
// no network code at all. createRpcClient() returns a client whose every call rejects with Error('offline build')
// (code 'OFFLINE'), and ONLINE is false so the interface can hide online features.

export * from './rpc-format.js';
export const ONLINE = false;

// Same method names as the online client so UI code runs unchanged; each rejects (async) rather than throws so
// callers' existing promise error handling covers the offline case.
const METHODS = [
  'request', 'batch', 'chainId', 'blockNumber', 'gasPrice', 'maxPriorityFeePerGas', 'getBalance', 'getTransactionCount',
  'getCode', 'getStorageAt', 'call', 'estimateGas', 'feeHistory', 'getBlock', 'getTransaction', 'getTransactionReceipt',
  'getLogs', 'sendRawTransaction', 'clientVersion',
];

const unavailable = () => Promise.reject(Object.assign(new Error('offline build'), { code: 'OFFLINE' }));

export function createRpcClient({ url = '' } = {}) {
  const client = { url };
  for (const m of METHODS) client[m] = unavailable;
  return client;
}
