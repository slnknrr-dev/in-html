// event-invite/bundles.js - the script of exported invitations: invite-runtime.js and what it imports, bundled as one
// ES module. The build inlines `new URL('./invite-runtime.js?bundle', import.meta.url)` as a gzip-compressed data:
// URL; the development server answers the same URL. bundles.offline.js is the twin without network code (offline
// artifacts carry only the data: URL).
//
//   runtimeCode() -> Promise<string> (minified)      netCode() -> Promise<string> (invite-net.js, for pages with an RSVP server)
import { decompress } from '../codec/deflate.js';
import { b64decode } from '../codec/base64.js';
import { minifyJS } from '../minify/js.js';

const RUNTIME_URL = new URL('./invite-runtime.js?bundle', import.meta.url);
const NET_URL = new URL('./invite-net.js?bundle', import.meta.url);
// Memoised promises (one fetch + decompress per page). Reset to null on failure so a transient error (dev server not
// ready, network blip) can be retried; caching the rejected promise would make the failure permanent.
let cached = null, netCached = null;

// data: URL (build) or http URL (dev server) -> raw bytes. Only base64 data: URLs are expected: the build writes
// `data:...;base64,`; a percent-encoded data: URL would be decoded wrongly here.
async function bytesOf(url) {
  const s = String(url);
  if (s.startsWith('data:')) return b64decode(s.slice(s.indexOf(',') + 1));
  const r = await fetch(url);
  if (!r.ok) throw new Error('bundle ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// Magic check 1f 8b = gzip header. Fail fast with a clear message: decompressing an HTML 404 page served with
// status 200 would otherwise throw an opaque inflate error. Minified at use time because the runtime is pasted into
// every exported invitation; smaller exports outweigh one minify pass per session.
export function runtimeCode() {
  if (!cached) {
    cached = (async () => {
      const gz = await bytesOf(RUNTIME_URL);
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      return minifyJS(new TextDecoder().decode(await decompress(gz, 'gzip')));
    })();
    cached.catch(() => { cached = null; });
  }
  return cached;
}

// Same shape as runtimeCode(); kept as a twin rather than a generic helper so the build can drop this whole
// function (and NET_URL) in bundles.offline.js without touching the runtime path.
export function netCode() {
  if (!netCached) {
    netCached = (async () => {
      const gz = await bytesOf(NET_URL);
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      return minifyJS(new TextDecoder().decode(await decompress(gz, 'gzip')));
    })();
    netCached.catch(() => { netCached = null; });
  }
  return netCached;
}
