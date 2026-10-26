// event-invite/net.offline.js - net.js of the offline builds: no network; every request fails as a connection error
// would, and ONLINE hides the server settings.
// Same exports as net.js so callers need no build-specific branches. Rejecting (not throwing synchronously) keeps
// the contract "api() returns a Promise": every caller's .catch / try-await path handles it identically.
export const ONLINE = false;
export const api = () => Promise.reject(new Error('offline build: no network'));
