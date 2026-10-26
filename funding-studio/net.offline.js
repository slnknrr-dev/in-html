// funding-studio/net.offline.js - net.js of the offline build (bundle.js picks x.offline.js for ./x.js): no network; every
// request fails as a connection error would, so the features that need a server report themselves unavailable.
// Rejects with TypeError, the same error type fetch uses for network failures, so callers' catch paths are identical.
export const httpFetch = () => Promise.reject(new TypeError('offline build: no network'));
export const ONLINE = false;
