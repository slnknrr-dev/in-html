// agreement-constructor/bundles.js - the runtime that compiled templates carry: contract/page.js and what it imports,
// bundled for another host. The build inlines `new URL('../contract/page.js?bundle', import.meta.url)` as a
// gzip-compressed data: URL of the module bundle; the development server answers the same URL. bundles.offline.js is
// the twin without network code (offline artifacts carry only the data: URL).
//
//   pageRuntime() -> Promise<string> (minified ES module code; the bundle sets globalThis[Symbol.for('bundle:page.js')])
import { decompress } from '../codec/deflate.js';
import { b64decode } from '../codec/base64.js';
import { minifyJS } from '../minify/js.js';

const PAGE_URL = new URL('../contract/page.js?bundle', import.meta.url);
let cached = null;

async function bytesOf(url) {
  const s = String(url);
  if (s.startsWith('data:')) return b64decode(s.slice(s.indexOf(',') + 1));
  const r = await fetch(url);
  if (!r.ok) throw new Error('bundle ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

export function pageRuntime() {
  if (!cached) {
    cached = (async () => {
      const gz = await bytesOf(PAGE_URL);
      if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('not a bundle');
      return minifyJS(new TextDecoder().decode(await decompress(gz, 'gzip')));
    })();
    cached.catch(() => { cached = null; });
  }
  return cached;
}

//
// Why a runtime bundle at all: "compile" produces a standalone HTML contract that must work without this app, so the
// page script (contract/page.js and its imports) is embedded into it. The bundle is fetched/decoded once and cached
// as a Promise (concurrent callers share one load); a failed load clears the cache so the next call retries.
// Gzip magic bytes (1f 8b) are checked before decompressing, so a wrong response (e.g. an HTML 404 page) fails with
// a clear error instead of garbage. The code is minified once more for the smallest embedded payload.