// knowledge-processor/remote.offline.js - remote.js for offline artifacts: the same exports, no network at all.
// Contract: export the exact same names as remote.js, so the build can swap the module by file name without any
// importer noticing. Callers branch on REMOTE (UI hides server features) instead of catching errors.
export const REMOTE = false;
// Mutating calls reject (never resolve undefined): a caller that forgot to check REMOTE gets a loud, catchable
// failure instead of silently "succeeding" at a save that went nowhere.
const off = () => Promise.reject(new Error('offline build'));
export const appAPI = () => '';
// Read-style probes resolve null ("no backend", "no media"): that is a normal answer offline, not an error.
export const probeBackend = () => Promise.resolve(null);
export const listServerKBs = off;
export const getServerKB = off;
export const putServerKB = off;
export const deleteServerKB = off;
export const getServerMedia = () => Promise.resolve(null);
export const putServerMedia = off;
export const publishToKBServer = off;
