// knowledge-processor/bundles.offline.js - bundles.js for offline artifacts: the bundles are always inline data: URLs
// there, so no network code is needed (same exports).
import { decompress } from '../codec/deflate.js';
import { b64decode } from '../codec/base64.js';
import { minifyJS } from '../minify/js.js';

// Same `new URL('./x.js?bundle', import.meta.url)` shape as bundles.js: the build recognises exactly this
// pattern and replaces it with a data: URL, so the expression must stay literal (no variables, no helpers).
const READER_URL = new URL('./reader-boot.js?bundle', import.meta.url);
const SERVER_URL = new URL('./kb-server.js?bundle', import.meta.url);
// Cache of promises, not results: concurrent callers share one in-flight decode instead of racing duplicates.
const cache = new Map();

function load(url, min) {
  const k = String(url);
  if (!cache.has(k)) {
    const p = (async () => {
      // Fail fast: in an offline artifact an unreplaced URL means the build did not inline this bundle; fetching
      // would violate the offline policy, so report it as a build problem.
      if (!k.startsWith('data:')) throw new Error('the bundle is not part of this build');
      const gz = b64decode(k.slice(k.indexOf(',') + 1));
      // 0x1f 0x8b = gzip magic (RFC 1952). Cheap sanity check before inflating arbitrary bytes.
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      const text = new TextDecoder().decode(await decompress(gz, 'gzip'));
      return min ? minifyJS(text) : text;
    })();
    // Evict on failure so a later call retries; a cached rejection would poison the key forever. The catch handler
    // also marks the promise handled, avoiding an unhandledrejection when nobody awaits it yet.
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return cache.get(k);
}

export const readerCode = () => load(READER_URL, true);
export const serverCode = () => load(SERVER_URL, true);
