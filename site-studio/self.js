// site-studio/self.js - the editor's own page, captured before anything changes the document: in a single-file build
// it is the whole editor, which a "backend + constructor" export ships as studio/index.html. Imported first by
// editor.js (module evaluation order), so the DOM is still the parsed file.
//
// Why capture at import time: ES modules evaluate depth-first in import order, so this body runs before any editor
// module renders UI into <body>. Serializing later would ship the live, mutated DOM (open dialogs, the loaded
// document) as the "clean" editor. Why outerHTML and not fetch(location): a file:// page cannot fetch itself in most
// browsers, and the network copy may differ from what is running.
// Contract: selfHTML() returns '' when the page is not reusable; callers must treat '' as "feature unavailable".
let html = '';
// try: in Node (tests, CLI builds) document is absent, and a sandboxed/opaque frame may throw on DOM access;
// either way the module must still import cleanly.
try {
  const d = globalThis.document;
  // Only a self-contained page can be reused: no module or stylesheet loaded from next to it.
  if (d && d.documentElement && !d.querySelector('script[type="module"][src], link[rel="stylesheet"][href]:not([href^="data:"])')) {
    // outerHTML omits the doctype; without it the shipped copy would render in quirks mode.
    html = '<!doctype html>\n' + d.documentElement.outerHTML;
  }
} catch { html = ''; }

export const selfHTML = () => html;
