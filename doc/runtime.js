// doc/runtime.js - runtime of exported pages, assembled from feature functions serialized with
// Function.prototype.toString.
//
// A feature is `function rtX(R) { ... }` that references only its parameter R, its own locals and browser globals (no
// module scope survives serialization; the engine never runs them in Node). Features run in P.runtime.order inside
// one strict IIFE sharing R, each in its own try/catch; P.runtime.deps adds the features a feature needs. `__P__` in
// a feature's source is replaced by the product prefix.
//
// Why serialize functions rather than keep runtime sources as strings: the features stay real code (linted, minified,
// syntax-checked by the bundler) while the export still emits only the features a page uses. Price: closures are
// lost, so a feature that touches a module variable works in the editor but throws ReferenceError in the export.
// Per-feature try/catch: one broken feature (missing element, old browser API) must not kill the rest of the page.
import { P } from './product.js';

export const fnSource = (fn) => fn.toString().replace(/__P__/g, P.prefix);

// Features with their dependencies (P.runtime.deps: feature -> [features]), in emission order.
// Iterative DFS over the dependency graph (no recursion limit, cycles harmless thanks to the Set). The final order comes
// from P.runtime.order, not from discovery, so the emitted script is deterministic and dependencies precede users
// as long as order lists them first.
export function featureClosure(features) {
  const deps = P.runtime.deps || {};
  const out = new Set(features);
  const stack = [...out];
  while (stack.length) {
    for (const d of deps[stack.pop()] || []) if (!out.has(d)) { out.add(d); stack.push(d); }
  }
  return P.runtime.order.filter((f) => out.has(f));
}

// P.runtime.helpers: [{ fn, for: [features] }] - shared internals (not features) emitted right after 'core' when one of
// their features is used.
export function buildRuntime(features) {
  const fns = P.runtime.fns;
  const set = featureClosure(features);
  let s = "(function(){'use strict';var R={};";
  for (const f of set) {
    if (typeof fns[f] === 'function') s += `try{(${fnSource(fns[f])})(R)}catch(e){}\n`;
    if (f === 'core') {
      for (const h of P.runtime.helpers || []) if (h.for.some((x) => set.includes(x))) s += `try{(${fnSource(h.fn)})(R)}catch(e){}\n`;
    }
  }
  return s + '})();';
}

// Packed-mode bootstrap: inflate the clean document and replace the page with it.
// Runs in the exported page, so ES5-style var and no module references. DecompressionStream('deflate-raw') is the
// native inflater (no JS inflate shipped); browsers without it land in the catch and show the no-JS message.
// document.open/write after parsing replaces the whole document, including this script, with the clean page.
export function rtBoot() {
  (async function () {
    try {
      var s = document.getElementById('__P__-pack').textContent.replace(/\s+/g, '');
      var b = atob(s);
      var n = b.length;
      var u = new Uint8Array(n);
      for (var i = 0; i < n; i++) u[i] = b.charCodeAt(i);
      var st = new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      var html = await new Response(st).text();
      document.open();
      document.write(html);
      document.close();
    } catch (e) {
      var x = document.getElementById('__P__-nojs');
      if (x) x.hidden = false;
    }
  })();
}
