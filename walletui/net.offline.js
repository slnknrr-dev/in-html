// walletui/net.offline.js - net.js for offline artifacts: the same exports without network code.
export const ONLINE = false;
export const apiBase = () => '';
export const backendCall = () => Promise.reject(new Error('offline build'));
export const probeBackend = () => Promise.resolve(null);
