// media-player/env.js - where the page runs and what it can do: the artifact mode (serverless, backend, electron,
// dev), the Electron bridge, the backend of the page's own origin and other servers the user configured (address +
// token, used over CORS), settings kept in this browser.
//
//   MODE, bridge, isTouch
//   settings (live object, saved with saveSettings()) ; DEFAULT_SETTINGS
//   servers() -> [{ id, name, base, token }] ; saveServers(list) ; serverById(id)
//   own -> { base: 'api/', token } | null   the page's own backend (backend / electron / dev artifacts)
//   probeOwn() -> Promise<info | null>        GET api/info of the own backend (features: ffmpeg, ytdlp, magick …)
//   api(server, path, { method, body, raw, signal }) -> JSON (throws ApiError with .status)
//   withToken(server, url) -> url with ?t= for media elements
//   caps() -> { fs, fsa, remote, blob, url, session, ytdlp, ffmpeg, magick, jobs, server }

import { lsGet, lsSet } from '../ui/dom.js';
import { httpFetch } from './net.js';

// IN_HTML_ARTIFACT is injected by singlefile.js per build; its absence means the unbundled sources (dev server).
const ART = globalThis.IN_HTML_ARTIFACT || null;
export const MODE = ART && ART.mode ? ART.mode : 'dev';
export const bridge = typeof globalThis.inHtmlElectron === 'object' && globalThis.inHtmlElectron ? globalThis.inHtmlElectron : null;
export const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const DEFAULT_SETTINGS = {
  view: 'auto', theme: 'auto', skin: 'symphony', layout: 'symphony', videoLayout: 'video', workspace: null,
  crossfade: 0, gapless: true, level: 'replaygain', target: -14, preamp: 0, eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], eqPreset: 'flat', eqOn: false,
  speeds: { music: 1, audiobook: 1, podcast: 1, video: 1 }, watched: 0.9, autoSkip: false, autoNext: true, skipOnError: true, resume: true,
  remoteImages: false, dynamicColor: true, analyze: true, store: 'local', mediaKeys: false, tray: true, keys: [], sections: null,
  karaoke: 'karaoke', sleepMinutes: 30, seekBack: 10, seekForward: 30, volume: 1, lastQueue: null, prefLang: '', titleLang: 'romaji',
};

// Defaults spread first: settings saved by an older version gain new keys automatically, no migration step.
export const settings = { ...DEFAULT_SETTINGS, ...lsGet('mp-settings', {}) };
export function saveSettings() { lsSet('mp-settings', settings); }

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

// Token of the own backend: #token=… in the address (printed by the server) is taken once and remembered.
// The token arrives in the fragment (#token=...), never the query: fragments are not sent to servers or logged in
// access logs / Referer. It is stripped from the address bar at once (replaceState) so it is not bookmarked or
// shared with a screenshot.
function ownToken() {
  try {
    const m = /(?:^#|[&#])token=([A-Za-z0-9_-]{8,200})/.exec(location.hash);
    if (m) {
      lsSet('mp-token', m[1]);
      history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/[#&]?token=[^&#]*/, '').replace(/^#$/, ''));
      return m[1];
    }
  } catch { /* file:// */ }
  return lsGet('mp-token', '');
}

const httpPage = typeof location !== 'undefined' && /^(https?|in-html):$/.test(location.protocol);
// Relative base 'api/' resolves against the page URL, so the backend works under any mount path or reverse-proxy
// prefix without configuration.
export const own = MODE === 'backend' || MODE === 'electron' || (MODE === 'dev' && httpPage) ? { id: 'own', name: '', base: 'api/', token: ownToken() } : null;
export function setOwnToken(t) { if (own) { own.token = t; lsSet('mp-token', t); } }

export const servers = () => lsGet('mp-servers', []).filter((s) => s && s.id && s.base);
export const saveServers = (list) => lsSet('mp-servers', list);
export const serverById = (id) => (id === 'own' ? own : servers().find((s) => s.id === id) || null);

const join = (base, p) => (base.endsWith('/') ? base : base + '/') + p.replace(/^\/+/, '');

// Single HTTP helper: bearer token, JSON encoding unless the body is binary, cache: 'no-store' (catalogue state must
// never come from the HTTP cache), errors as ApiError with .status so callers can tell 401 (ask token) from offline.
// AbortError is rethrown untouched so cancellations are not reported as network failures.
export async function api(server, p, { method = 'GET', body = undefined, raw = false, signal, headers = {} } = {}) {
  if (!server) throw new ApiError(0, 'no server');
  const h = { ...headers };
  if (server.token) h.Authorization = 'Bearer ' + server.token;
  let payload = body;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  let r;
  try { r = await httpFetch(join(server.base, p), { method, headers: h, body: payload, signal, cache: 'no-store' }); } catch (e) { if (e && e.name === 'AbortError') throw e; throw new ApiError(0, 'offline'); }
  if (raw) { if (!r.ok) throw new ApiError(r.status, r.statusText); return r; }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) throw new ApiError(r.status, (j && j.error) || r.statusText, j);
  return j;
}

// Media elements and <img> cannot send headers, so their URLs carry ?t=; the backend accepts it for 'raw' ops only.
export function withToken(server, url) {
  if (!server || !server.token) return url;
  return url + (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(server.token);
}
export const apiURL = (server, p) => withToken(server, join(server.base, p));

let ownInfo = null;
export async function probeOwn() {
  if (!own) return null;
  try { ownInfo = await api(own, 'info'); } catch { ownInfo = null; }
  return ownInfo;
}
export const ownFeatures = () => (ownInfo && ownInfo.features) || {};
export const ownNeedsToken = () => !!(ownInfo && ownInfo.auth);

export function caps() {
  const f = ownFeatures();
  return {
    server: !!own && !!ownInfo, fs: !!own && !!ownInfo, fsa: typeof globalThis.showDirectoryPicker === 'function', remote: servers().length > 0,
    blob: true, url: true, session: true, ytdlp: !!f.ytdlp, ffmpeg: !!f.ffmpeg, magick: !!f.magick, jobs: !!f.jobs, electron: !!bridge,
  };
}
