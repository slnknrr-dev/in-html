// agreement-constructor/bundles.offline.js - bundles.js for offline artifacts: the runtime bundle is always an inline
//
// Why a twin file instead of a runtime check: offline artifacts are audited to contain no network API at all
// (policy checks fail on fetch). Swapping the module at build time removes fetch from the code, which a runtime
// "if offline" branch would not.
// data: URL there, so no network code is needed (same exports).
import { decompress } from '../codec/deflate.js';
import { b64decode } from '../codec/base64.js';
import { minifyJS } from '../minify/js.js';

const PAGE_URL = new URL('../contract/page.js?bundle', import.meta.url);
let cached = null;

export function pageRuntime() {
  if (!cached) {
    cached = (async () => {
      const s = String(PAGE_URL);
      if (!s.startsWith('data:')) throw new Error('the runtime is not part of this build');
      const gz = b64decode(s.slice(s.indexOf(',') + 1));
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      return minifyJS(new TextDecoder().decode(await decompress(gz, 'gzip')));
    })();
    cached.catch(() => { cached = null; });
  }
  return cached;
}
