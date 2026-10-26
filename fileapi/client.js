// fileapi/client.js - client of the file API (handler.js) for browsers and Node: plain fetch, no dependencies.
//
//   createFileClient({ base, token = '', fetch = globalThis.fetch }) -> client
//     base   URL of the API prefix ('https://host/app/api/fs/' or a relative 'api/fs/' in pages); a missing trailing
//            slash is added
//     token  sent as `Authorization: Bearer <token>`; rawURL / thumbURL put it in the query (`t=`) instead, because
//            media elements and <img> cannot send headers
//   client = {
//     info()                                   -> { api, version, mounts, features, scopes, limits }
//     mounts()                                 -> [{ id, name, path?, writable, kind, fixed, temporary, available }]
//     addMount(path, { name, writable, persist }) -> mount   (owner)
//     removeMount(id)                          -> { ok: true }   (owner)
//     grant(paths, { writable, persist })      -> [{ mount, path, dir }]   (owner)
//     list(mount, rel = '', { recursive, depth, glob, exclude, hidden, dirs, limit }) -> { mount, path, entries, truncated }
//                                                 (glob / exclude: a string or an array of globs)
//     stat(mount, rel)                         -> entry
//     rawURL(mount, rel, { download })         -> URL string of the bytes
//     thumbURL(mount, rel, size)               -> URL string of the thumbnail
//     read(mount, rel, start?, end?)           -> Uint8Array of bytes [start, end) (end exclusive like slice; omitted
//                                                 = to the end of the file; past the end -> shorter / empty)
//     source(mount, rel, size?, { blockSize = 65536, blocks = 32 }) -> { size, read(offset, length) -> Promise<Uint8Array> }
//                                                 a random-access source for tag readers: reads go through a small LRU
//                                                 cache of aligned blocks (one Range request per block); when `size` is
//                                                 unknown the file is stat()ed first and a Promise is returned (always
//                                                 safe to await)
//     upload(mount, rel, body, { overwrite })  -> entry of the written file (body: Blob | Uint8Array | ArrayBuffer | string)
//     watch(since?, { timeout, signal })       -> { seq, events } | { reset: true, seq, events: [] }
//   }
//   FileApiError: thrown for every answer that is not 2xx: .status, .code (from the JSON body, else 'http-<status>'),
//   .body (the parsed JSON body or null)
//   encodePath(rel) -> the relative path with every segment percent-encoded

export class FileApiError extends Error {
  constructor(message, { status = 0, code = '', body = null } = {}) {
    super(message);
    this.name = 'FileApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// Per-segment encodeURIComponent: '/' stays a separator, everything else (including '#', '?', '%') is escaped, so a
// file named "a#b?.mp3" reaches the server intact. Empty segments are dropped, mirroring normRel on the server.
export const encodePath = (rel) => String(rel ?? '').split('/').filter((s) => s !== '').map(encodeURIComponent).join('/');

export function createFileClient({ base, token = '', fetch: fetchFn = globalThis.fetch } = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('fileapi client: no fetch function');
  let prefix = String(base ?? '');
  if (!prefix.endsWith('/')) prefix += '/';

  const urlOf = (p, params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === false || v === '') continue;
      for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined && x !== null && x !== '') q.append(k, x === true ? '1' : String(x));
    }
    const s = q.toString();
    return prefix + p + (s ? '?' + s : '');
  };
  const at = (op, mount, rel) => `${op}/${encodeURIComponent(String(mount ?? ''))}/${encodePath(rel)}`;

  async function request(method, p, { params, json, body, headers, signal } = {}) {
    const h = { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers };
    const init = { method, headers: h };
    if (signal) init.signal = signal;
    if (json !== undefined) { init.body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    else if (body !== undefined) init.body = body;
    return fetchFn(urlOf(p, params), init);
  }

  async function check(res) {
    if (res.ok) return res;
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    const msg = (body && body.error) || res.statusText || 'HTTP ' + res.status;
    throw new FileApiError(msg, { status: res.status, code: (body && body.code) || 'http-' + res.status, body });
  }

  const getJSON = async (method, p, o) => (await check(await request(method, p, o))).json();

  // [start, end) on the JS side, inclusive end on the wire (HTTP Range 'bytes=s-(e-1)'). 416 means "start past the
  // end" and is answered with empty bytes (body drained so the connection can be reused). A 200 to a ranged request
  // means the range was ignored somewhere on the path; the client then slices locally - correct, if wasteful.
  async function read(mount, rel, start, end) {
    const s = start === undefined || start === null ? 0 : Math.max(0, Math.floor(start));
    const e = end === undefined || end === null ? null : Math.floor(end);
    if (e !== null && e <= s) return new Uint8Array(0);
    const headers = {};
    if (s > 0 || e !== null) headers.Range = `bytes=${s}-${e !== null ? e - 1 : ''}`;
    const res = await request('GET', at('raw', mount, rel), { headers });
    if (res.status === 416) { try { await res.arrayBuffer(); } catch { /* drained */ } return new Uint8Array(0); }
    await check(res);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A server (or proxy) that ignored the range sent everything.
    if (res.status === 200 && headers.Range) return bytes.slice(s, e === null ? undefined : e);
    return bytes;
  }

  // Tag readers issue many small reads (headers, frames, footers). Aligned 64 KiB blocks turn them into few Range
  // requests; the cache stores PROMISES, so two concurrent reads of one block share a single request. A Map's
  // insertion order is the LRU order (touch = delete + set). A failed block is evicted so a retry can succeed.
  // Memory bound: blocks x blockSize = 2 MiB by default.
  function rangeSource(mount, rel, size, { blockSize = 65536, blocks = 32 } = {}) {
    const cache = new Map(); // block index -> Promise<Uint8Array> (insertion order = LRU order)
    const block = (i) => {
      let p = cache.get(i);
      if (p) { cache.delete(i); cache.set(i, p); return p; }
      const start = i * blockSize;
      p = read(mount, rel, start, Math.min(size, start + blockSize));
      p.catch(() => { if (cache.get(i) === p) cache.delete(i); });
      cache.set(i, p);
      while (cache.size > blocks) cache.delete(cache.keys().next().value);
      return p;
    };
    return {
      size,
      async read(offset, length) {
        const from = Math.max(0, Math.floor(offset || 0));
        const to = Math.min(size, from + Math.max(0, Math.floor(length || 0)));
        if (to <= from) return new Uint8Array(0);
        if (to - from > blockSize * 4) return read(mount, rel, from, to); // large reads bypass the cache
        const first = Math.floor(from / blockSize), last = Math.floor((to - 1) / blockSize);
        const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => block(first + k)));
        const out = new Uint8Array(to - from);
        let o = 0;
        parts.forEach((part, k) => {
          const b0 = (first + k) * blockSize;
          const s = Math.max(from, b0) - b0, e = Math.min(to, b0 + part.length) - b0;
          if (e > s) { out.set(part.subarray(s, e), o); o += e - s; }
        });
        return o === out.length ? out : out.slice(0, o);
      },
    };
  }

  return {
    base: prefix,
    info: () => getJSON('GET', 'info'),
    mounts: () => getJSON('GET', 'mounts'),
    addMount: (path, { name, writable, persist } = {}) => getJSON('POST', 'mounts', { json: { path, name, writable, persist } }),
    removeMount: (id) => getJSON('DELETE', 'mounts/' + encodeURIComponent(id)),
    grant: (paths, { writable, persist } = {}) => getJSON('POST', 'grant', { json: { paths, writable, persist } }),
    list: (mount, rel = '', { recursive, depth, glob, exclude, hidden, dirs, limit } = {}) => getJSON('GET', at('list', mount, rel), {
      params: { recursive: recursive ? 1 : undefined, depth, glob, exclude, hidden: hidden ? 1 : undefined, dirs: dirs === false ? 0 : undefined, limit },
    }),
    stat: (mount, rel = '') => getJSON('GET', at('stat', mount, rel)),
    rawURL: (mount, rel, { download } = {}) => urlOf(at('raw', mount, rel), { download: download ? 1 : undefined, t: token || undefined }),
    thumbURL: (mount, rel, size) => urlOf(at('thumb', mount, rel), { size, t: token || undefined }),
    read,
    source(mount, rel, size, opts) {
      if (typeof size === 'number' && Number.isFinite(size)) return rangeSource(mount, rel, size, opts);
      return getJSON('GET', at('stat', mount, rel)).then((st) => {
        if (st.dir) throw new FileApiError('is a folder', { status: 400, code: 'is-directory', body: null });
        return rangeSource(mount, rel, st.size, opts);
      });
    },
    upload: (mount, rel, body, { overwrite } = {}) => getJSON('PUT', at('raw', mount, rel), {
      params: { overwrite: overwrite ? 1 : undefined }, body, headers: { 'Content-Type': 'application/octet-stream' },
    }),
    watch: (since, { timeout, signal } = {}) => getJSON('GET', 'watch', { params: { since, timeout }, signal }),
  };
}
