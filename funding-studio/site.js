// funding-studio/site.js - one HTML file per published page (static archives of the editor, pages served by the
// backend): the home campaign at index.html, every other page at <slug>/index.html, relative links between them.
//
//   buildSite(doc, opts) -> Promise<{ files: [{ name, data }], pages: [{ id, slug, kind, path }], report }>
//     opts: exportHTML options (mode, minify, langs, defaultLang, embedSource, source) + api { base, site } and stats.
//     With api.base relative ('../../' style) it is resolved per page depth: root page base, sub page base + '../'.
import { exportHTML, homePage, livePages, normalizeDoc } from './viewer.js';

// Directory-per-page ('<slug>/index.html') gives clean URLs on any static host without rewrite rules. A relative API
// base is shifted by one '../' for sub pages, so the same site works under any mount path; absolute or root-relative
// bases are kept. Only the home page embeds the editable source (embedSource), so a static archive carries the
// project once, not once per page. Pages render sequentially (exportHTML is async but CPU-bound).
export async function buildSite(doc, opts = {}) {
  const d = normalizeDoc(doc);
  const home = homePage(d);
  const files = [];
  const pages = [];
  let report = null;
  for (const p of livePages(d)) {
    const isHome = home && p.id === home.id;
    let api = null;
    if (opts.api && typeof opts.api.base === 'string') {
      const b = opts.api.base;
      api = { ...opts.api, base: /^(https?:)?\/\//.test(b) || b.startsWith('/') ? b : (isHome ? '' : '../') + b };
    }
    const r = await exportHTML(d, { ...opts, route: 'file', page: p.id, api, embedSource: isHome ? !!opts.embedSource : false });
    const name = isHome ? 'index.html' : p.slug + '/index.html';
    files.push({ name, data: r.html });
    pages.push({ id: p.id, slug: p.slug, kind: p.kind, path: isHome ? '' : p.slug + '/' });
    if (isHome) report = r.report;
  }
  return { files, pages, report: report || {}, doc: d };
}
