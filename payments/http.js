// payments/http.js - one small HTTP client interface for the provider clients, over Node's http / https modules
// (backends bundled by the build cannot import node: modules, so they hand in the modules they got from hosting.js)
// or over fetch (browsers, tests).
//
//   request({ method, url, headers, body, timeout }) -> Promise<{ status, headers, text }>
//     body: string | Uint8Array | null; headers of the response with lower-case names; text: the body as UTF-8.
//     Rejects on network errors and timeouts (error.code 'ETIMEDOUT'), never on HTTP status codes.
//
//   nodeRequester({ http, https }, { timeout = 20000, maxBytes = 8 MiB }) -> request
//   fetchRequester(fetchFn = globalThis.fetch, { timeout = 20000 }) -> request
//   jsonOf(res) -> parsed body or null
//   formEncode(obj) -> 'a=1&b=x%20y'   (application/x-www-form-urlencoded; null / undefined values skipped)

//
// Design rules:
// - HTTP status is data, not an exception: providers return structured error bodies on 4xx, and each client decides
//   (retry on 401, providerError otherwise). Only transport failures reject.
// - The requester is injected, never imported: this file stays free of node: imports (it bundles for the browser) and
//   every provider client is testable against payments/mock.js without a network.

// '+' for spaces: the application/x-www-form-urlencoded serialisation of the WHATWG URL standard. encodeURIComponent
// emits %20, which servers accept too, but the canonical form keeps bodies byte-identical with URLSearchParams output.
export function formEncode(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null) continue;
    out.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&').replace(/%20/g, '+');
}

export function jsonOf(res) {
  try { return res && res.text ? JSON.parse(res.text) : null; } catch { return null; }
}

// Same error code as Node's socket errors use, so callers test one property regardless of the requester.
const timeoutError = () => Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' });

export function nodeRequester(node, { timeout = 20000, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (!node || !node.http || !node.https) throw new Error('nodeRequester needs { http, https }');
  return function request({ method = 'GET', url, headers = {}, body = null, timeout: t = timeout } = {}) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(url); } catch { reject(new Error('bad URL')); return; }
      // Allow-list the scheme: a configurable API base must not reach any other URL handler.
      if (u.protocol !== 'https:' && u.protocol !== 'http:') { reject(new Error('only http(s) URLs')); return; }
      const lib = u.protocol === 'https:' ? node.https : node.http;
      const data = body == null ? null : typeof body === 'string' ? new TextEncoder().encode(body) : body;
      const h = { ...headers };
      // Explicit Content-Length (byte length, after UTF-8 encoding) instead of chunked transfer encoding, which some
      // API gateways refuse on token endpoints. A caller-supplied value is respected in any letter case.
      if (data && !Object.keys(h).some((k) => k.toLowerCase() === 'content-length')) h['Content-Length'] = String(data.length);
      const req = lib.request(u, { method, headers: h }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          // Cap before buffering: a hostile or broken endpoint must not exhaust memory. destroy() emits 'error' on req,
          // which rejects below; the promise is settled before any later 'end' could resolve it.
          if (size > maxBytes) { req.destroy(new Error('response too large')); return; }
          chunks.push(c);
        });
        res.on('end', () => {
          const all = new Uint8Array(size);
          let o = 0;
          // Decode once after concatenation: decoding per chunk would split multi-byte UTF-8 sequences at boundaries.
          for (const c of chunks) { all.set(c, o); o += c.length; }
          const hs = {};
          for (const [k, v] of Object.entries(res.headers || {})) hs[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
          resolve({ status: res.statusCode || 0, headers: hs, text: new TextDecoder().decode(all) });
        });
        res.on('error', reject);
      });
      // Socket idle timeout (no activity for t ms), not a total deadline: a slow trickle can exceed t overall.
      req.setTimeout(t, () => req.destroy(timeoutError()));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  };
}

export function fetchRequester(fetchFn = globalThis.fetch, { timeout = 20000 } = {}) {
  return async function request({ method = 'GET', url, headers = {}, body = null, timeout: t = timeout } = {}) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), t) : null;
    try {
      // redirect 'manual': an API redirect must not be followed silently with credentials attached. In browsers the
      // result is an opaque-redirect response with status 0, which every client treats as a failure (non-2xx).
      // Unlike nodeRequester there is no maxBytes cap here: r.text() buffers whatever the server sends.
      const r = await fetchFn(url, { method, headers, body, signal: ctl ? ctl.signal : undefined, redirect: 'manual' });
      const hs = {};
      r.headers.forEach((v, k) => { hs[k.toLowerCase()] = v; });
      return { status: r.status, headers: hs, text: await r.text() };
    } catch (e) {
      if (ctl && ctl.signal.aborted) throw timeoutError();
      throw e;
    } finally { if (timer) clearTimeout(timer); }
  };
}

// Error of a provider call: message from the provider's error body when there is one, plus status and body.
// The field chain covers the providers' shapes: Stripe { error: { message, code } }, OAuth { error, error_description },
// PayPal REST { name, message, details: [{ issue }] }, problem+json { title, detail }, TBC developerMessage / userMessage.
export function providerError(provider, res, body) {
  let msg = '';
  if (body && typeof body === 'object') {
    const e = body.error;
    const issue = Array.isArray(body.details) && body.details[0] && body.details[0].issue;
    msg = (e && typeof e === 'object' ? e.message || e.code : '') || body.error_description || (typeof e === 'string' ? e : '')
      || body.message || body.detail || body.title || body.developerMessage || body.userMessage || '';
    if (body.name) msg = msg ? body.name + ': ' + msg : body.name;
    if (issue) msg += ' (' + issue + ')';
  }
  const err = new Error(`${provider}: ${msg || 'HTTP ' + res.status}`);
  err.status = res.status;
  err.body = body;
  err.provider = provider;
  return err;
}
