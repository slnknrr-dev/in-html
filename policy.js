// policy.js - network classes of applications (README.md) and the zero-network check of standalone artifacts.
//
// The suffix of an application directory names its class:
//   -offline, -effect        standalone   zero fetch / zero server: works from file://, the build fails on any
//                                         network API or remote resource in the artifact
//   -serverless              unhosted     runs in the browser, keeps data with the user; it may call endpoints the
//                                         user configures, but never needs a server of ours (uses are reported)
//   -pwa, -isomorphic        pwa / isomorphic (reported)
//   anything else            client       may depend on a backend
// Used by singlefile.js (build) and check.js (audit).
//
// Approach: a textual audit of the FINAL artifact, not of the sources. Sources lie by omission: a dependency, a bundled
// helper or an inlined stylesheet can introduce network code the app author never wrote. Text matching over the
// built bytes sees exactly what ships. Cost: false positives (a word "WebSocket" in a UI string fails a standalone
// build); accepted, because the failure is loud and the fix (rename / offline variant) is cheap, while a false
// negative silently breaks the "works offline" promise. Order of CLASSES matters: the first match wins.

export const CLASSES = [
  ['standalone', /-(offline|effect)$/],
  ['unhosted', /-serverless$/],
  ['pwa', /-pwa$/],
  ['isomorphic', /-isomorphic$/],
];

export function appClass(app) {
  for (const [k, re] of CLASSES) if (re.test(app)) return k;
  return 'client';
}

// Network APIs and remote resources: [name, regexp] (matched on the final artifact text).
// Regex notes: fetch uses a lookbehind (?<![\w$.]) so `prefetch(` or `obj.fetch(` do not match but bare `fetch(` does
// (a method named fetch on our own objects is not network). The 'remote resource' pattern only flags absolute or
// protocol-relative (//host) URLs in resource-loading attributes; relative and data: URIs are local by construction.
// <a href> is intentionally not listed: a link the user clicks is navigation, not a dependency of the page.
const NETWORK = [
  ['fetch()', /(?<![\w$.])fetch\s*\(/g],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/g],
  ['WebSocket', /\bWebSocket\b/g],
  ['EventSource', /\bEventSource\b/g],
  ['WebTransport', /\bWebTransport\b/g],
  ['navigator.sendBeacon', /\bsendBeacon\b/g],
  ['RTCPeerConnection', /\bRTCPeerConnection\b/g],
  ['importScripts()', /\bimportScripts\s*\(/g],
  ['service worker', /\bserviceWorker\s*\.\s*register\b/g],
  ['remote resource', /<(?:script|link|img|iframe|video|audio|source|track|object|embed|image)\b[^>]*?\s(?:src|href|data|srcset|poster)\s*=\s*["']?\s*(?:https?:)?\/\/[^\s"'>]+/gi],
  ['remote CSS', /url\(\s*["']?\s*(?:https?:)?\/\/[^)]+\)|@import\s+["']?(?:https?:)?\/\//gi],
];

// Every network use in `text`: [{ what, at (offset), snippet }].
export function networkUses(text) {
  const out = [];
  for (const [what, re] of NETWORK) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      out.push({ what, at: m.index, snippet: text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ') });
      // Cap: a pathological artifact must not produce a megabyte report; 200 hits already prove the verdict.
      if (out.length > 200) return out;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Policy verdict of an artifact: { cls, uses, ok } (ok is false only for standalone apps with network uses).
export function auditArtifact(app, html) {
  const cls = appClass(app);
  const uses = networkUses(html);
  return { cls, uses, ok: cls !== 'standalone' || uses.length === 0 };
}
