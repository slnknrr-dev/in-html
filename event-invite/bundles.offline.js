// event-invite/bundles.offline.js - bundles.js for offline artifacts: the runtime bundle is always an inline data:
// URL there, so no network code is needed (same exports);
// netCode() is empty: an offline page never talks to a server.
import { decompress } from '../codec/deflate.js';
import { b64decode } from '../codec/base64.js';
import { minifyJS } from '../minify/js.js';

const RUNTIME_URL = new URL('./invite-runtime.js?bundle', import.meta.url);
let cached = null;

// Fails fast when the bundle was not inlined: in an offline artifact there is nothing to fetch it from, and an
// attempted fetch would violate the build's no-network policy.
export function runtimeCode() {
  if (!cached) {
    cached = (async () => {
      const k = String(RUNTIME_URL);
      if (!k.startsWith('data:')) throw new Error('the bundle is not part of this build');
      const gz = b64decode(k.slice(k.indexOf(',') + 1));
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      return minifyJS(new TextDecoder().decode(await decompress(gz, 'gzip')));
    })();
    cached.catch(() => { cached = null; });
  }
  return cached;
}

// Empty string, not a rejection: exporters concatenate it unconditionally, so "no net code" must be a valid value.
export const netCode = () => Promise.resolve('');
