// media-player/net.js - the one door of the media player (servers, remote libraries) to the network: httpFetch() is fetch(). The offline build
// (OFFLINE / DEMO artifacts) takes net.offline.js instead, so it carries no network code at all.
export const httpFetch = (url, init) => fetch(url, init);
export const ONLINE = true;
