// site-studio/wiki-bundles.offline.js - bundles.js for offline artifacts: the bundles are always inline data: URLs
// there, so no network code is needed (same exports).
import { decompress } from '../codec/deflate.js';
import { b64decode } from '../codec/base64.js';
import { minifyJS } from '../minify/js.js';

const READER_URL = new URL('./wiki-reader-boot.js?bundle', import.meta.url);
const SERVER_URL = new URL('./wiki-kb-server.js?bundle', import.meta.url);
// Same cache and eviction logic as bundles.js (see there); only the network path is gone.
const cache = new Map();

function load(url, min) {
  const k = String(url);
  if (!cache.has(k)) {
    const p = (async () => {
      // An http URL here means the build failed to inline the bundle: fail loudly, never fetch.
      if (!k.startsWith('data:')) throw new Error('the bundle is not part of this build');
      const gz = b64decode(k.slice(k.indexOf(',') + 1));
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      const text = new TextDecoder().decode(await decompress(gz, 'gzip'));
      return min ? minifyJS(text) : text;
    })();
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return cache.get(k);
}

export const readerCode = () => load(READER_URL, true);
export const serverCode = () => load(SERVER_URL, true);
