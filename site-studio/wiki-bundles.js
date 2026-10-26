// site-studio/wiki-bundles.js - code that the editor writes into exports: the reader (reader-boot.js and what it
// imports) and the server of backend exports (kb-server.js). The build inlines `new URL('./x.js?bundle',
// import.meta.url)` as a gzip-compressed data: URL of the module bundle; the development server answers the same URL.
// bundles.offline.js is the twin without network code (offline artifacts carry only the data: URLs).
//
//   readerCode() -> Promise<string> (minified)      serverCode() -> Promise<string>
import { decompress } from '../codec/deflate.js';
import { b64decode } from '../codec/base64.js';
import { minifyJS } from '../minify/js.js';

const READER_URL = new URL('./wiki-reader-boot.js?bundle', import.meta.url);
const SERVER_URL = new URL('./wiki-kb-server.js?bundle', import.meta.url);
// Promise cache keyed by URL string: concurrent exports share one in-flight decode.
const cache = new Map();

// data: URL (built artifact) is decoded in place: no network stack copy, and file:// contexts may block fetch().
// http(s) (development server) is fetched normally.
async function bytesOf(url) {
  const s = String(url);
  if (s.startsWith('data:')) return b64decode(s.slice(s.indexOf(',') + 1));
  const r = await fetch(url);
  if (!r.ok) throw new Error('bundle ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

function load(url, min) {
  const k = String(url);
  if (!cache.has(k)) {
    const p = (async () => {
      const gz = await bytesOf(url);
      // gzip magic (RFC 1952). Fail fast with a clear message when a dev server answered with an HTML 404 page or the
      // build did not inline the bundle, instead of a cryptic inflate error.
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      const text = new TextDecoder().decode(await decompress(gz, 'gzip'));
      return min ? minifyJS(text) : text;
    })();
    // Evict on failure so a later export retries (a transient error must not stick). This catch also marks the
    // rejection handled; callers still receive it through the cached promise.
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return cache.get(k);
}

// Minified at export time, not build time: one readable bundle serves both the dev server and exports; the cost is
// one minify per session thanks to the cache.
export const readerCode = () => load(READER_URL, true);
export const serverCode = () => load(SERVER_URL, true);
