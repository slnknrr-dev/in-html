// embroidery-studio/remote.offline.js - remote.js for offline artifacts: the same exports, no network at all.
// Reads that are optional resolve to null ("nothing there"); operations that need a server reject, so a caller that
// reaches them by mistake gets an error instead of silent success.
export const REMOTE = false;
const off = () => Promise.reject(new Error('offline build'));
export const probeBackend = () => Promise.resolve(null);
export const siteIndex = () => Promise.resolve(null);
export const siteScheme = off;
export const serverList = off;
export const serverScheme = off;
export const serverHit = () => Promise.resolve(null);
export const upload = off;
export const modList = off;
export const modScheme = off;
export const modAction = off;
export const progressGet = () => Promise.resolve(null);
export const progressPut = () => Promise.resolve(null);
