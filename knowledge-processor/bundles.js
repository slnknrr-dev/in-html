// knowledge-processor/bundles.js - code that the editor writes into exports: the reader (reader-boot.js and what it
// imports) and the server of backend exports (kb-server.js). The build inlines `new URL('./x.js?bundle',
// import.meta.url)` as a gzip-compressed data: URL of the module bundle; the development server answers the same URL.
// bundles.offline.js is the twin without network code (offline artifacts carry only the data: URLs).
//
//   readerCode() -> Promise<string> (minified)      serverCode() -> Promise<string>
import { decompress } from '../codec/deflate.js';
import { b64decode } from '../codec/base64.js';
import { minifyJS } from '../minify/js.js';

// Literal `new URL('./x.js?bundle', import.meta.url)`: the build pattern-matches this exact expression and
// inlines the bundle; the dev server answers `?bundle` by bundling on demand. Refactoring it into a helper
// call would silently break the build rewrite (the URL would stay a network path in artifacts).
const READER_URL = new URL('./reader-boot.js?bundle', import.meta.url);
const SERVER_URL = new URL('./kb-server.js?bundle', import.meta.url);
// Promise cache keyed by URL string: one decode per session, concurrent callers share the in-flight promise.
const cache = new Map();

// data: URL (built artifact) decodes locally; anything else (dev server) is fetched. Only base64 data: URLs
// are expected here, so the part after the first comma is decoded without parsing the media type.
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
      // gzip magic bytes (RFC 1952): catches an HTML error page or an unbundled module served with 200.
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      const text = new TextDecoder().decode(await decompress(gz, 'gzip'));
      return min ? minifyJS(text) : text;
    })();
    // Failed loads are evicted so the next export retries (a transient network error must not stick).
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return cache.get(k);
}

export const readerCode = () => load(READER_URL, true);
export const serverCode = () => load(SERVER_URL, true);
