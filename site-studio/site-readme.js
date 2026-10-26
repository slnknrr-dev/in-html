// site-studio/site-readme.js - README.md of a site's repository (serverless and backend packages; Site → README) and
// the import of Markdown files as pages. The README tells how to publish the package, lists the pages, draws the site
// as a Mermaid diagram (Codeberg and GitHub render it) and carries shields.io badges (badge/shields.js); the owner may
// replace it with their own text (doc.meta.readme). Pure functions (Node and browsers).
import { buildShields } from '../badge/shields.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { str } from '../util/value.js';
import { siteRoutes } from './viewer-pages.js';
import { closedPages } from './viewer-access.js';
import { siteMapSource } from './site-map.js';
//
// Why the README is generated, not templated by hand: it must agree with the package (page list, access, run
// instructions per target). The owner's own text (doc.meta.readme) wins outright; no merge, so a hand-written README
// is never silently rewritten.

const plain = (doc, v) => htmlToText(str(pickText(v, doc.defaultLang, doc))).replace(/\s+/g, ' ').trim();
// Static shields.io badge as Markdown image; built by badge/shields.js so escaping rules live in one place.
const badge = (label, message, color) => `![${label}: ${message}](${buildShields({ kind: 'static', label, message, color })})`;

// Publishing instructions per package target. 404.html as catch-all is the trick that gives a client-routed site
// clean addresses on static hosts without rewrite rules: the host serves it for any unknown path, the router reads
// location and renders the right page.
const PUBLISH = {
  html: ['## Publish', '', 'The site is one file, `index.html`: open it from disk, send it by e-mail or upload it anywhere.', 'Uploaded also as `404.html`, every page gets a clean address on Codeberg Pages, GitHub Pages and GitLab Pages.'],
  static: ['## Publish', '', 'Upload the folder to any static host:', '', '- **Codeberg Pages**: push to a repository named `pages` (or the `pages` branch) — `404.html` answers every other address.',
    '- **GitHub Pages**: Settings → Pages → deploy from the branch.', '- **nginx**: `error_page 404 /404.html;` · **Apache**: `ErrorDocument 404 /404.html`.', '',
    'Forms, orders and RSVP go to the endpoints set in Site Studio (Site → Requests) or wait in the visitor’s browser.'],
  backend: ['## Run', '', '```sh', 'node server.mjs --port 8080', '```', '', 'Node ≥ 20, Bun or Deno; nothing to install. The admin console is at `/admin/` (the token is printed on the first start).',
    '', '| variable | meaning |', '| --- | --- |', '| `PORT`, `HOST` | where the server listens |', '| `ADMIN_TOKEN` | admin token (≥ 16 characters) |', '| `ADMIN_EMAIL` | this account is always an administrator |',
    '| `SMTP_URL`, `MAIL_FROM` | sign-in links by e-mail (`smtp://user:pass@host:587`) |', '| `DATA_DIR` | where data is kept (default `data/`) |', '| `TRUST_PROXY=1` | behind a reverse proxy |'],
};

/** README.md text of a package: target 'html' | 'static' | 'backend' | 'hybrid' | 'studio'. */
export function siteReadme(doc, target = 'static') {
  if (str(doc.meta && doc.meta.readme).trim()) return str(doc.meta.readme).trim() + '\n';
  const title = plain(doc, doc.meta.title) || doc.name;
  const desc = plain(doc, doc.meta.description);
  const R = siteRoutes(doc);
  const byId = new Map((doc.regions.main || []).map((p) => [p.id, p]));
  const closed = new Set(closedPages(doc).map((p) => p.id));
  const backend = target === 'backend' || target === 'hybrid' || target === 'studio';
  const mode = backend ? 'backend' : target === 'html' ? 'offline' : 'serverless';
  const out = [`# ${title}`, ''];
  out.push([badge('package', mode, mode === 'backend' ? 'red' : mode === 'offline' ? 'green' : 'yellow'), badge('pages', String(R.legacy ? 1 : R.list.length), 'blue'),
    badge('languages', doc.langs.join(' · '), 'informational'), badge('made with', 'Site Studio', 'teal')].join(' '), '');
  if (desc) out.push(desc, '');
  if (doc.meta.siteUrl) out.push(`**Site:** ${doc.meta.siteUrl}`, '');
  out.push('## Pages', '', '| page | address | access |', '| --- | --- | --- |');
  for (const e of R.legacy ? [] : R.list) {
    const p = byId.get(e.id);
    if (!p) continue;
    // '|' escaped: a pipe in a page title would split the Markdown table cell.
    out.push(`| ${(plain(doc, p.title) || e.slug || 'Home').replace(/\|/g, '\\|')} | \`/${e.home ? '' : e.slug + '/'}\` | ${closed.has(p.id) ? (p.access === 'roles' ? 'roles: ' + p.roles : 'members') : 'everybody'} |`);
  }
  out.push('', '## Site map', '', '```mermaid', siteMapSource(doc, 'pages', { lang: doc.defaultLang }), '```', '');
  // Access diagram only where access is enforced (backend) and relevant; a static export cannot close pages.
  if (backend && closed.size) out.push('## Who sees what', '', '```mermaid', siteMapSource(doc, 'access', { lang: doc.defaultLang }), '```', '');
  out.push(...(backend ? PUBLISH.backend : PUBLISH[target] || PUBLISH.static), '');
  if (target === 'studio') out.push('The constructor (this site in the Site Studio editor) is at `/_studio/`: sign in as an administrator, change the site and press **Publish**.', '');
  out.push('---', '', '_Generated by Site Studio. Replace this file in Site → README._', '');
  return out.join('\n');
}

/**
 * Markdown files → a site document: one page per file, or (one file) one page per top-level heading; each page holds
 * the Markdown as a Markdown block, links between the files become page links. files = [{ name, text }].
 */
export function markdownSite(V, files, { lang = 'en' } = {}) {
  const pages = [];
  // V (the viewer API) is injected rather than imported, keeping this module free of the block registry.
  // README.md maps to the home page (empty slug), as on repository hosts.
  const slugOf = (s) => V.normSlug(String(s).replace(/\.md$/i, '').replace(/^readme$/i, '')) || '';
  const parts = [];
  if (files.length === 1) {
    // Lookahead split keeps each '# ' heading at the start of its chunk; only level-1 headings split pages.
    const chunks = String(files[0].text).split(/^(?=# )/m).filter((x) => x.trim());
    chunks.forEach((c, i) => {
      const h = /^#\s+(.+)$/m.exec(c);
      parts.push({ title: h ? h[1].trim() : files[0].name, slug: i === 0 ? '' : slugOf(h ? h[1] : 'part-' + i), text: c });
    });
  } else {
    for (const f of files) {
      const h = /^#\s+(.+)$/m.exec(f.text);
      parts.push({ title: h ? h[1].trim() : f.name.replace(/\.md$/i, ''), slug: /^readme\.md$/i.test(f.name) ? '' : slugOf(f.name), file: f.name, text: f.text });
    }
    // Home first (route tables treat the first page as home); stable sort keeps the rest in file order.
    parts.sort((a, b) => (a.slug === '' ? -1 : b.slug === '' ? 1 : 0));
  }
  const files2slug = new Map(parts.filter((p) => p.file).map((p) => [p.file.toLowerCase(), p.slug]));
  for (const p of parts) {
    // Rewrite relative links to sibling .md files into in-site hash routes; unknown targets stay as written.
    // Matched by basename only, so 'docs/a.md' and 'a.md' collide: acceptable for flat Markdown folders.
    const text = p.text.replace(/\]\((\.\/)?([^)#\s]+\.md)(#[^)]*)?\)/gi, (m, dot, f, hash) => {
      const s = files2slug.get(f.toLowerCase().split('/').pop());
      return s == null ? m : `](#/${s}${hash || ''})`;
    });
    const md = V.newBlock('markdown', { text: { [lang]: text } });
    const sec = V.newBlock('section', { width: 'narrow', blocks: [md] });
    pages.push(V.newBlock('page', { slug: p.slug, title: { [lang]: p.title }, navLabel: { [lang]: p.title }, nav: true, blocks: [sec] }));
  }
  const d = V.newDoc({ langs: [lang], defaultLang: lang });
  d.name = parts[0] ? parts[0].title : 'README';
  d.meta.title = { [lang]: d.name };
  d.regions.header = [V.newBlock('nav', { brand: { [lang]: d.name }, pages: true, items: [] })];
  d.regions.main = pages;
  d.regions.footer = [V.newBlock('footer', { variant: 'simple', brand: { [lang]: d.name } })];
  return d;
}
