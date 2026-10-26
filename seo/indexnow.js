// seo/indexnow.js - IndexNow ("this URL changed, re-read it") without the network: key validation and the key file,
// URLs grouped by host and cut into batches the protocol accepts, the JSON bodies of the POST requests, per-host
// pacing (a host is pinged at most once per gap; the rest waits for the next window) and the meaning of the reply
// codes. The caller sends the requests with whatever transport it has.

// Why "without the network": the library is pure so it runs in a static-site build, a worker or a test with no
// fetch; the caller owns transport, retries and secrets. Any participating engine shares submissions with the others,
// so one endpoint is enough; the per-engine list exists for engines that want direct pings.
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_ENGINES = { indexnow: 'https://api.indexnow.org/indexnow', bing: 'https://www.bing.com/indexnow', yandex: 'https://yandex.com/indexnow', seznam: 'https://search.seznam.cz/indexnow', naver: 'https://searchadvisor.naver.com/indexnow' };
export const INDEXNOW_MAX_URLS = 10000;
export const INDEXNOW_BATCH = 1000;
export const INDEXNOW_HOST_GAP_MS = 10 * 60000;

const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;
export const isIndexNowKey = (k) => KEY_RE.test(String(k || ''));
// A key from 32 random bytes (hex); pass bytes from crypto.getRandomValues or a seeded source.
// The key proves site ownership (the engine fetches /<key>.txt), so it must be unguessable: callers pass CSPRNG bytes.
export const makeIndexNowKey = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 64);
// The key file: served at https://<host>/<key>.txt with the key as its whole body.
export const keyFile = (key) => ({ path: '/' + key + '.txt', body: key, type: 'text/plain; charset=utf-8' });

// URLs grouped by lower-case host; invalid URLs, non-http(s) URLs and hosts outside `allowHosts` (when given) are
// returned in `dropped`. Duplicates (after removing the fragment) collapse.
// One request per host because the protocol binds a request to one host + key file; URLs of other hosts in the
// same body are rejected (422). The fragment is dropped since engines index URLs without it.
export function groupByHost(urls, { allowHosts = null } = {}) {
  const hosts = new Map(), dropped = [];
  const allow = allowHosts ? new Set(allowHosts.map((h) => h.toLowerCase())) : null;
  for (const raw of urls || []) {
    let u;
    try { u = new URL(String(raw)); } catch { dropped.push(raw); continue; }
    if (!/^https?:$/.test(u.protocol) || (allow && !allow.has(u.host.toLowerCase()))) { dropped.push(raw); continue; }
    u.hash = '';
    const host = u.host.toLowerCase();
    if (!hosts.has(host)) hosts.set(host, new Set());
    hosts.get(host).add(u.href);
  }
  return { hosts: [...hosts].map(([host, set]) => ({ host, urls: [...set] })), dropped };
}

// Request bodies for a key: [{ endpoint, host, body (JSON text), urls }] with at most `batch` URLs each.
// `keyLocation` defaults to https://<host>/<key>.txt.
export function indexNowRequests(urls, key, { endpoint = INDEXNOW_ENDPOINT, batch = INDEXNOW_BATCH, keyLocation = null, allowHosts = null } = {}) {
  if (!isIndexNowKey(key)) throw new Error('IndexNow: the key must be 8-128 characters of A-Z a-z 0-9 -');
  const size = Math.max(1, Math.min(INDEXNOW_MAX_URLS, batch | 0));
  const { hosts, dropped } = groupByHost(urls, { allowHosts });
  const requests = [];
  for (const { host, urls: list } of hosts) {
    for (let i = 0; i < list.length; i += size) {
      const part = list.slice(i, i + size);
      const loc = keyLocation ? (typeof keyLocation === 'function' ? keyLocation(host) : keyLocation) : `https://${host}/${key}.txt`;
      requests.push({ endpoint, host, urls: part, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host, key, keyLocation: loc, urlList: part }) });
    }
  }
  return { requests, dropped };
}
// A single-URL ping as a GET URL.
export const indexNowGetUrl = (url, key, endpoint = INDEXNOW_ENDPOINT) => `${endpoint}?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}`;

// Pacing: given the last send time per host and `now`, which requests go now and which wait.
// Pure function of (state, now): returns the new lastSent map instead of mutating, so the caller persists it
// atomically. At most one request per host per call keeps bursts under engines' 429 thresholds.
export function paceRequests(requests, lastSent = {}, now = 0, gap = INDEXNOW_HOST_GAP_MS) {
  const due = [], wait = [], seen = new Set();
  for (const r of requests) {
    const last = lastSent[r.host] || 0;
    if (now - last < gap || seen.has(r.host)) wait.push(r); else { due.push(r); seen.add(r.host); }
  }
  return { due, wait, lastSent: { ...lastSent, ...Object.fromEntries(due.map((r) => [r.host, now])) } };
}

// Reply status -> { ok, retry, meaning }.
export function indexNowStatus(code) {
  const M = { 200: 'URLs submitted', 202: 'accepted, the key is being validated', 400: 'bad request', 403: 'the key is not valid (key file missing or different)',
    422: 'URLs do not belong to the host or the key does not match the schema', 429: 'too many requests' };
  return { ok: code === 200 || code === 202, retry: code === 429 || code >= 500 || code === 0, meaning: M[code] || (code >= 500 ? 'server error' : code ? 'unexpected status' : 'network error') };
}
