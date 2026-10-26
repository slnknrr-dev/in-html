// bookmarks-editor/fetcher.js - server-side page metadata and favicons with SSRF protection. Only http / https; the
// host is resolved and every address it resolves to must be public (bookmarks/address.js: no loopback, private,
// link-local, CGNAT, multicast, reserved, IPv4-mapped forms of those); the check runs inside the connection's DNS
// lookup, so the address that is checked is the address that is connected to (no DNS rebinding window), and again
// for every redirect (at most 5). 5 s for the whole fetch, 1 MB of HTML (only the head is needed), 100 KB per favicon,
// no cookies or credentials, only text/html (pages) and image/* (icons). Node's http / https / dns / zlib come from
// the hosting context (bundled backends cannot import node: modules).
//
//   const f = createFetcher({ node, allow, timeout, maxBytes, maxIconBytes, maxRedirects })
//     allow: ['127.0.0.1:8080', '[::1]:9000'] - addresses that are allowed although not public (tests only)
//   await f.page(url) -> { url (final), title, description, siteName, canonical, icons, lang }
//   await f.icon(pageURL, icons) -> data: URL | ''     (cached per host for a week)
//   f.check(url) -> throws FetchError when the URL itself is refused (scheme, credentials, literal address)
//   FetchError.code: scheme, credentials, blocked, dns, timeout, status, type, too_large, redirects, network

//
// Threat model: any signed-in user can make the server fetch a URL. Without these checks that is an SSRF primitive
// against the server's own network (cloud metadata at 169.254.169.254, admin panels on 127.0.0.1, intranet hosts).
// Checking the hostname string is not enough: "evil.example" may resolve to 10.0.0.1, or resolve publicly at check
// time and privately at connect time (DNS rebinding). Hence the check lives in the socket's `lookup` hook.
import { classifyIP, parseIPv4, parseIPv6 } from '../bookmarks/address.js';
import { charsetOf, extractMeta, pickIcon } from '../bookmarks/meta.js';
import { ICON_MAX } from '../bookmarks/record.js';

export class FetchError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// Raster formats plus SVG. SVG is safe here because icons are only ever shown through <img>, where SVG scripts and
// external loads are disabled by the browser.
const ICON_TYPES = /^image\/(png|gif|jpeg|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon|bmp)$/;
const isIP = (h) => !!(parseIPv4(h) || parseIPv6(h));

export function createFetcher({ node, allow = [], timeout = 5000, maxBytes = 1 << 20, maxIconBytes = 100 * 1024, maxRedirects = 5,
  userAgent = 'Mozilla/5.0 (compatible; in-html-bookmarks/1.0; +metadata)', now = () => Date.now() } = {}) {
  if (!node || !node.http || !node.https || !node.dns) throw new Error('the fetcher needs node http, https and dns modules');
  const { http, https, dns, zlib } = node;
  const allowed = new Set(allow.map((a) => String(a).trim().toLowerCase()).filter(Boolean));
  const iconCache = new Map();

  // The allow list is address:port exact (both IPv6 spellings), so tests can open one loopback port and nothing else.
  function permitted(address, port) {
    const c = classifyIP(address);
    if (c.kind === 'public') return true;
    const a = address.toLowerCase();
    return allowed.has(`${a}:${port}`) || allowed.has(`[${a}]:${port}`);
  }

  // Literal-address and localhost checks happen before any network activity: a refused URL costs nothing.
  // Credentials in the URL are refused so the server never forwards user:password@ to a third party.
  function parse(raw) {
    let u;
    try { u = new URL(String(raw)); } catch { throw new FetchError('scheme', 'not a URL'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchError('scheme', `${u.protocol} is not fetched`);
    if (u.username || u.password) throw new FetchError('credentials', 'URLs with credentials are not fetched');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    if (isIP(host) && !permitted(host, port)) throw new FetchError('blocked', `address ${host} is not public (${classifyIP(host).kind})`);
    if (/^localhost$|\.localhost$/i.test(host) && !permitted('127.0.0.1', port)) throw new FetchError('blocked', 'localhost is not fetched');
    return { u, host, port };
  }

  // DNS lookup that refuses non-public answers (all of them are checked: a mixed answer is refused).
  // Signature-compatible replacement for dns.lookup (http.request `lookup` option). all:true gets every address so
  // a round-robin answer with one private entry cannot slip through on a later connection attempt.
  // verbatim:true keeps the resolver's order instead of reordering IPv4 first.
  const lookupFor = (port) => (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) { cb(new FetchError('dns', err.code || 'lookup failed')); return; }
      const list = (addrs || []).filter((a) => !options.family || a.family === options.family);
      if (!list.length) { cb(new FetchError('dns', 'no address')); return; }
      const bad = list.find((a) => !permitted(a.address, port));
      if (bad) { cb(new FetchError('blocked', `${hostname} resolves to ${bad.address} (${classifyIP(bad.address).kind})`)); return; }
      if (options.all) cb(null, list);
      else cb(null, list[0].address, list[0].family);
    });
  };

  // One HTTP exchange. agent:false = no keep-alive pool: a pooled socket would bypass the lookup check on reuse.
  // servername sets TLS SNI to the hostname (not to the resolved IP), so certificate validation still checks the
  // name the user asked for. The timer uses the remaining overall budget, not a fresh 5 s per hop.
  function once(target, { accept, deadline }) {
    const { u, host, port } = target;
    return new Promise((resolve, reject) => {
      const left = deadline - now();
      if (left <= 0) { reject(new FetchError('timeout', 'timed out')); return; }
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        protocol: u.protocol, hostname: host, port, path: u.pathname + u.search, method: 'GET', agent: false,
        lookup: lookupFor(port), servername: isIP(host) ? undefined : host,
        headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Encoding': zlib ? 'gzip, deflate' : 'identity', 'Accept-Language': 'en;q=0.8, *;q=0.5' },
      });
      const timer = setTimeout(() => { req.destroy(new FetchError('timeout', 'timed out')); }, left);
      req.on('response', (res) => { clearTimeout(timer); resolve({ res, req, deadline }); });
      req.on('error', (e) => { clearTimeout(timer); reject(e instanceof FetchError ? e : new FetchError(e && e.code === 'ETIMEDOUT' ? 'timeout' : 'network', e && e.message)); });
      req.end();
    });
  }

  // Reads a response body: up to `limit` bytes after decompression; `strict` refuses larger bodies instead of cutting.
  // The limit counts decompressed bytes: a 1 KB gzip bomb can expand to gigabytes, so limiting the wire size alone
  // would not protect memory. Pages are cut (non-strict: the head with <title> comes first), icons are refused.
  function readBody(res, { limit, strict, deadline }) {
    return new Promise((resolve, reject) => {
      let stream = res;
      const ce = String(res.headers['content-encoding'] || '').toLowerCase();
      if (zlib && (ce === 'gzip' || ce === 'x-gzip')) stream = res.pipe(zlib.createGunzip());
      else if (zlib && ce === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (ce && ce !== 'identity') { res.destroy(); reject(new FetchError('type', `content encoding ${ce}`)); return; }
      const declared = Number(res.headers['content-length']);
      // Early refusal on a declared length; the streaming count below still guards against a lying header.
      if (strict && declared > limit) { res.destroy(); reject(new FetchError('too_large', `${declared} bytes`)); return; }
      const chunks = [];
      let size = 0, done = false;
      const timer = setTimeout(() => finish(new FetchError('timeout', 'timed out')), Math.max(0, deadline - now()));
      // Single exit guarded by `done`: data, end, error, abort and the timer can all race to finish.
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        res.destroy();
        if (err) reject(err);
        else resolve(Buffer.concat(chunks).subarray(0, limit));
      };
      stream.on('data', (c) => {
        size += c.length;
        chunks.push(c);
        if (size > limit) finish(strict ? new FetchError('too_large', `more than ${limit} bytes`) : null);
      });
      stream.on('end', () => finish(null));
      stream.on('error', (e) => finish(new FetchError('network', e.message)));
      res.on('aborted', () => finish(new FetchError('network', 'aborted')));
    });
  }

  // Redirects followed manually so every hop goes through parse() + the guarded lookup again; Node's http would
  // not follow them at all, and a library that does would skip our checks.
  async function get(raw, { accept, types, limit, strict }) {
    const deadline = now() + timeout;
    let target = parse(raw);
    for (let hop = 0; ; hop++) {
      const { res } = await once(target, { accept, deadline });
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        if (hop >= maxRedirects) throw new FetchError('redirects', 'too many redirects');
        let next;
        // Location may be relative; resolved against the current URL, as browsers do.
        try { next = new URL(res.headers.location, target.u).href; } catch { throw new FetchError('status', 'bad redirect'); }
        target = parse(next);
        continue;
      }
      if (res.statusCode !== 200) { res.destroy(); throw new FetchError('status', `HTTP ${res.statusCode}`); }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!types.test(type)) { res.destroy(); throw new FetchError('type', `content type ${type || 'unknown'}`); }
      const body = await readBody(res, { limit, strict, deadline });
      return { url: target.u.href, type, contentType: String(res.headers['content-type'] || ''), body };
    }
  }

  // Charset from the Content-Type header or the <meta charset> sniffed in the body; unknown labels fall back to
  // UTF-8 (TextDecoder throws RangeError on an unsupported label).
  async function page(raw) {
    const r = await get(raw, { accept: 'text/html,application/xhtml+xml;q=0.9', types: /^(text\/html|application\/xhtml\+xml)$/, limit: maxBytes, strict: false });
    let label = charsetOf(r.contentType, r.body) || 'utf-8';
    let html;
    try { html = new TextDecoder(label).decode(r.body); } catch { label = 'utf-8'; html = new TextDecoder('utf-8').decode(r.body); }
    return { url: r.url, ...extractMeta(html, r.url) };
  }

  // Cache keyed by the icon URL (not the host as the header loosely says), a week TTL, at most 1000 entries with
  // FIFO eviction (Map keeps insertion order, so keys().next() is the oldest). Failures are cached as '' too, so a
  // dead icon is not re-fetched on every bookmark of that site.
  async function icon(pageURL, icons) {
    const href = pickIcon(icons || [], pageURL);
    const cached = iconCache.get(href);
    if (cached && now() - cached.t < 7 * 864e5) return cached.data;
    let data = '';
    // Inline data: icons are accepted only as strict base64 image data within ICON_MAX; anything else (e.g. a
    // data:text/html smuggled as an icon) is dropped.
    if (/^data:image\//i.test(href)) data = href.length <= ICON_MAX && /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/]+=*$/.test(href) ? href : '';
    else if (href) {
      try {
        const r = await get(href, { accept: 'image/*', types: /^image\//, limit: maxIconBytes, strict: true });
        // Normalise the IANA ICO type to the widely supported image/x-icon spelling.
        const type = r.type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : r.type;
        if (ICON_TYPES.test(type) && r.body.length) data = `data:${type};base64,${r.body.toString('base64')}`;
      } catch { data = ''; }
    }
    if (data.length > ICON_MAX) data = '';
    if (href && !href.startsWith('data:')) iconCache.set(href, { data, t: now() });
    if (iconCache.size > 1000) iconCache.delete(iconCache.keys().next().value);
    return data;
  }

  return { page, icon, check: (u) => { parse(u); }, permitted };
}
