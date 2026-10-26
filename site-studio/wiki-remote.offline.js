// site-studio/wiki-remote.offline.js - remote.js for offline artifacts: the same exports, no network at all.
// Why a twin module instead of `if (offline)` checks: the build swaps the import, so offline artifacts contain no
// fetch code at all (smaller, provably no network). Exports must match remote.js exactly or the swap fails at link
// time. Failure semantics mirror the online file: probes resolve null ("no backend"), writes reject.
export const REMOTE = false;
const off = () => Promise.reject(new Error('offline build'));
export const appAPI = () => '';
export const probeBackend = () => Promise.resolve(null);
export const listServerKBs = off;
export const getServerKB = off;
export const putServerKB = off;
export const deleteServerKB = off;
export const getServerMedia = () => Promise.resolve(null);
export const putServerMedia = off;
export const publishToKBServer = off;
