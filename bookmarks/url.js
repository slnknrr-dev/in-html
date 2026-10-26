// bookmarks/url.js - URLs of bookmarks: cleaning what the user typed or pasted, the normal form used to find
// duplicates, display forms with Unicode host names, safe link schemes and titles guessed from a URL.
//
//   parseUserURL(text) -> string | null        "example.com/a" -> "https://example.com/a"; keeps any absolute URL
//   cleanURL(url, { stripTracking = true }) -> string    the URL as stored: WHATWG-normalized, tracking parameters
//                                              (utm_*, fbclid, gclid, …) removed
//   urlKey(url, opts) -> string                 duplicate key: lower-case scheme and host, IDN as Punycode, default
//                                              ports and trailing slashes dropped, query sorted, tracking parameters
//                                              and the fragment removed (opts: stripTracking, keepFragment,
//                                              ignoreScheme (http = https), ignoreWww)
//   hostOf(url) -> 'bücher.example'             host for display (Unicode, without "www.")
//   displayURL(url) -> string                   Unicode host + decoded path, no scheme
//   isLinkable(url) -> boolean                  schemes that may be a link target (never javascript:, data:, …)
//   titleFromURL(url) -> string                 "My great article" from …/my-great-article.html
//   findURLs(text) -> [url]                     absolute http(s) / ftp URLs and www.… addresses in free text
//   TRACKING_PARAMS, isTrackingParam(name)

import { domainToUnicode } from '../codec/punycode.js';

// Known click-id / campaign parameters. Removing them makes the stored URL shorter, less identifying when shared,
// and lets duplicates collapse (the same article shared with different utm_ tags is one bookmark).
export const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'ysclid', 'twclid', 'ttclid', 'li_fat_id',
  'igshid', 'igsh', 'mc_cid', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', '__hstc', '__hssc', '__hsfp', 'hsctatracking',
  '_ga', '_gl', '_ke', 'oly_anon_id', 'oly_enc_id', 'vero_conv', 'vero_id', 'wickedid', 'rb_clickid', 's_cid', 'scid',
  'spm', 'scm', 'pvid', 'sc_channel', 'sc_campaign', 'sc_content', 'sc_medium', 'sc_outcome', 'sc_geo', 'sc_country',
  'ref_src', 'ref_url', 'cmpid', 'icid', 'ncid', 'ocid', 'srsltid', 'trk', 'trkcampaign', 'zanpid', 'campaignid', 'adgroupid',
  'epik', 'si',
]);
const TRACKING_PREFIX = /^(utm_|pk_|mtm_|matomo_|piwik_|hmb_|ga_|vgo_ee)/i;
export const isTrackingParam = (name) => TRACKING_PARAMS.has(String(name).toLowerCase()) || TRACKING_PREFIX.test(name);

// Allowlist of schemes that may become an <a href>: javascript:, data:, vbscript:, file: and blob: are absent on
// purpose (XSS and local-file access through stored bookmarks).
const LINKABLE = /^(https?|ftp|ftps|sftp|mailto|tel|sms|magnet|gemini|gopher|irc|ircs|news|nntp|ssh|xmpp|matrix|geo|ipfs|ipns):/i;
export const isLinkable = (url) => typeof url === 'string' && LINKABLE.test(url.trim());

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOSTLIKE = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}[\p{L}\p{N}])?\.)+\p{L}{2,63}(?::\d{1,5})?(?:[/?#]|$)/u;
const IPV4LIKE = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#]|$)/;

function tryURL(s) {
  try { return new URL(s); } catch { return null; }
}

// "example.com:8080/x" parses in WHATWG URL as scheme "example.com"; the HAS_SCHEME branch therefore excludes
// host:port shapes and localhost:port so they are treated as hosts. Bare hosts must look like a real domain
// (letters TLD, Unicode labels allowed) or an IPv4, otherwise arbitrary words would become URLs. localhost and IPs
// get http:// (local servers rarely have TLS), everything else https://.
export function parseUserURL(text) {
  let s = String(text ?? '').trim();
  if (!s) return null;
  s = s.replace(/^<(.+)>$/, '$1').replace(/^URL:\s*/i, '').trim();
  if (/\s/.test(s) && !HAS_SCHEME.test(s)) return null;
  if (s.startsWith('//')) s = 'https:' + s;
  if (HAS_SCHEME.test(s) && !/^localhost:\d/i.test(s) && !/^[^:/]+\.[^:/]+:\d/.test(s)) {
    const u = tryURL(s);
    return u ? u.href : null;
  }
  if (HOSTLIKE.test(s) || IPV4LIKE.test(s) || /^localhost(?::\d{1,5})?(?:[/?#]|$)/i.test(s)) {
    const u = tryURL((/^(localhost|\d)/i.test(s) ? 'http://' : 'https://') + s);
    return u ? u.href : null;
  }
  return null;
}

function stripParams(u, stripTracking) {
  if (!stripTracking || !u.search) return;
  const keep = [...u.searchParams].filter(([k]) => !isTrackingParam(k));
  if (keep.length === [...u.searchParams].length) return;
  u.search = keep.length ? '?' + new URLSearchParams(keep).toString() : '';
}

export function cleanURL(url, { stripTracking = true } = {}) {
  const u = tryURL(String(url ?? '').trim());
  if (!u) return String(url ?? '').trim();
  if (!/^https?:$/.test(u.protocol)) return u.href;
  stripParams(u, stripTracking);
  return u.href;
}

// Route-like fragments of single-page applications are part of the address: "#!/x", "#/x".
const ROUTE_HASH = /^#!?\//;

// Duplicate detection key, intentionally more aggressive than cleanURL (it is never shown or opened): WHATWG URL
// already lower-cases scheme/host, converts IDN to Punycode and drops default ports; on top of that duplicate
// slashes collapse, percent-encoded unreserved characters are decoded (RFC 3986 says they are equivalent), trailing
// slashes go, query parameters are sorted, and the fragment is dropped unless it is an SPA route (#/ or #!/).
export function urlKey(url, { stripTracking = true, keepFragment = false, ignoreScheme = false, ignoreWww = false } = {}) {
  const raw = String(url ?? '').trim();
  const u = tryURL(raw);
  if (!u) return raw.toLowerCase();
  if (!/^(https?|ftp):$/.test(u.protocol)) return u.href;
  stripParams(u, stripTracking);
  let host = u.hostname.replace(/\.$/, '');
  if (ignoreWww) host = host.replace(/^www\d{0,3}\./, '');
  const port = u.port ? ':' + u.port : '';
  let pathname = u.pathname.replace(/\/{2,}/g, '/');
  // Unreserved characters that were percent-encoded mean the same: decode them (%7E -> ~).
  pathname = pathname.replace(/%(2[DdEe]|5[Ff]|7[Ee]|[46][1-9A-Fa-f]|[57][0-9Aa]|3[0-9])/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  if (pathname === '/') pathname = '';
  const params = [...u.searchParams].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
  const hash = u.hash && (keepFragment || ROUTE_HASH.test(u.hash)) ? u.hash : '';
  const scheme = ignoreScheme && u.protocol === 'http:' ? 'https:' : u.protocol;
  return `${scheme}//${host}${port}${pathname}${query}${hash}`;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function hostOf(url) {
  const u = tryURL(String(url ?? '').trim());
  if (!u || !u.hostname) return '';
  let host = u.hostname.replace(/\.$/, '').replace(/^www\./, '');
  if (/(^|\.)xn--/i.test(host)) { try { host = domainToUnicode(host); } catch { /* keep */ } }
  return host;
}

export function displayURL(url) {
  const raw = String(url ?? '').trim();
  const u = tryURL(raw);
  if (!u) return raw;
  if (!u.hostname) return raw;
  const host = hostOf(raw) + (u.port ? ':' + u.port : '');
  const rest = (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
  return host + safeDecode(rest).replace(/\s/g, (c) => encodeURIComponent(c));
}

// A readable title for a URL: the last meaningful path segment (slugs become words), else the host.
export function titleFromURL(url) {
  const u = tryURL(String(url ?? '').trim());
  if (!u) return String(url ?? '').trim();
  const host = hostOf(u.href) || u.href;
  const segs = u.pathname.split('/').map(safeDecode).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    let s = segs[i].replace(/\.(html?|php|aspx?|jsp|cgi|shtml)$/i, '');
    if (/^(index|default|home)$/i.test(s) || /^\d+$/.test(s) || /^[0-9a-f]{12,}$/i.test(s) || s.length < 3) continue;
    s = s.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/\p{L}/u.test(s)) continue;
    if (s === s.toLowerCase()) s = s.charAt(0).toUpperCase() + s.slice(1);
    return `${s} – ${host}`;
  }
  return host;
}

const URL_IN_TEXT = /\b(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'`]+/gi;

// URLs in prose: trailing punctuation is the sentence's, and a closing bracket is trimmed only when unbalanced, so
// Wikipedia-style ".../Foo_(bar)" keeps its parenthesis while "(see http://x.y)" loses it.
export function findURLs(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(URL_IN_TEXT)) {
    let s = m[0];
    // Trailing punctuation belongs to the sentence; a closing bracket only when its pair is not inside the URL.
    for (;;) {
      const last = s.slice(-1);
      if (/[.,;:!?'"]/.test(last)) { s = s.slice(0, -1); continue; }
      if (last === ')' && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) { s = s.slice(0, -1); continue; }
      if (last === ']' && (s.match(/\[/g) || []).length < (s.match(/\]/g) || []).length) { s = s.slice(0, -1); continue; }
      break;
    }
    const u = parseUserURL(s);
    if (u) out.push(u);
  }
  return out;
}
