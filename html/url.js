// html/url.js - link allowlists. Always allowed: http(s):, mailto:, tel:, in-document references #att-<id> and
// #b-<id>. With `anchors`: also #<slug> anchors, #lang=<code> language links and #/<path>[#<slug>] page routes
// (multi-page documents: the product maps them to the URL of the page in each export).
import { str } from '../util/value.js';

// Scheme allowlist, never a blocklist: javascript:, data:, vbscript: and any scheme invented later fail by default.
// Callers must strip control characters before testing (sanitize.js does), since browsers ignore them in schemes.
export const SAFE_URL = /^(https?:|mailto:|tel:)/i;
export const XREF = /^#(att|b)-([a-z0-9]{1,32})$/i;
// Slugs limited to lower-case ASCII so the anchor is also a valid id selector and survives every export format.
export const ANCHOR_HREF = /^#([a-z][a-z0-9-]{0,40})$/;
export const LANG_HREF = /^#lang=([A-Za-z0-9-]{1,35})$/;
// '#/' (home), '#/about', '#/docs/setup/', '#/about#team': [1] = path without slashes at the ends, [2] = anchor.
export const ROUTE_HREF = /^#\/((?:[A-Za-z0-9._~-]+\/){0,7}[A-Za-z0-9._~-]+)?\/?(?:#([a-z][a-z0-9-]{0,40}))?$/;

export const isSafeHref = (u, anchors = false) => SAFE_URL.test(u) || XREF.test(u)
  || (!!anchors && (ANCHOR_HREF.test(u) || LANG_HREF.test(u) || ROUTE_HREF.test(u)));

// Allowlisted URL or ''.
export function safeURL(u, anchors = false) {
  u = str(u).trim();
  if (!u) return '';
  return isSafeHref(u, anchors) ? u : '';
}

// User-typed link: also bare domains ("example.com/x" -> https://example.com/x) and bare e-mail addresses.
// Upgrades only unambiguous shapes (host.tld[/path], user@host.tld), defaulting to https. Anything else yields ''
// rather than a guess, so 'javascript:alert(1)' can never be normalised into a link.
export function normURL(u, anchors = false) {
  u = str(u).trim();
  if (!u) return '';
  if (isSafeHref(u, anchors)) return u;
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(u)) return 'https://' + u;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(u)) return 'mailto:' + u;
  return '';
}
