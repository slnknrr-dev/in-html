// funding-studio/net.js - the one door of the funding studio (editor, admin console) to the network: httpFetch() is fetch(). The offline build
// (OFFLINE / DEMO artifacts) takes net.offline.js instead, so it carries no network code at all.
// A single import point makes "no network code in the offline build" checkable by construction: bundle.js swaps this
// module, so no other module may call fetch directly.
export const httpFetch = (url, init) => fetch(url, init);
export const ONLINE = true;
