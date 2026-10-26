// site-studio/site-map.js - the site drawn as diagrams (Mermaid syntax, rendered by diagram/): the pages and nested
// sections, the navigation, who may open what (roles and closed pages), where the data of forms, orders and the
// chat goes in a package (browser / your endpoint / channel / the site's server) and the content collections the admin
// console edits. Pure functions: the editor's Site → Map, the README of an export and the diagram block use them.
import { pickText } from '../i18n/text.js';
import { isObj, str } from '../util/value.js';
import { siteRoutes } from './viewer-pages.js';
import { roleList } from './viewer-access.js';
import { planBackend } from './backend-site.js';
import { contentCollections } from './viewer-backend.js';
//
// Why emit Mermaid text and not SVG: the same source serves three consumers (the editor renders it with diagram/,
// Codeberg/GitHub render it inside README.md, the diagram block embeds it), and text diffs cleanly in a repository.
// Injection rule: every user string reaches the source only through q(), because Mermaid has no escaping for
// labels; a stray quote, bracket or newline would end the label and turn the rest into graph syntax.

export const MAP_VIEWS = ['pages', 'nav', 'access', 'data', 'types'];

// Quoted, sanitized label: quotes and newlines become spaces (they terminate a label), <> are removed (Mermaid
// renders labels as HTML, so markup would be interpreted), 48 characters keep nodes legible in narrow READMEs.
const q = (s) => '"' + String(s).replace(/["\n\r]/g, ' ').replace(/[<>]/g, '').slice(0, 48) + '"';
const label = (doc, p, lang) => str(pickText(p.navLabel, lang, doc)) || str(pickText(p.title, lang, doc)) || p.slug || '/';

// Node ids are positional (p0, p1, ...) rather than derived from slugs: slugs contain '/', '-' and non-ASCII that
// are not valid Mermaid ids, and positional ids are stable within one render, which is all a diagram needs.
function pageNodes(doc, lang) {
  const R = siteRoutes(doc);
  const byId = new Map((doc.regions.main || []).map((p) => [p.id, p]));
  return (R.legacy ? [] : R.list).map((e, i) => ({ e, p: byId.get(e.id), n: 'p' + i })).filter((x) => x.p);
}

// Parent of a page by address: the longest address that is a prefix of it, else the home page.
// Hierarchy is inferred from slugs ('docs/api' under 'docs'), not stored: one source of truth, no stale tree.
// O(n^2) over pages, fine for sites of tens to hundreds of pages.
function parentOf(nodes, x) {
  if (x.e.home) return null;
  const segs = x.e.slug.split('/');
  for (let k = segs.length - 1; k > 0; k--) {
    const up = segs.slice(0, k).join('/');
    const hit = nodes.find((y) => !y.e.home && y.e.slug === up);
    if (hit) return hit;
  }
  return nodes.find((y) => y.e.home) || null;
}

function pagesMap(doc, lang) {
  const nodes = pageNodes(doc, lang);
  const L = ['flowchart TB'];
  for (const x of nodes) {
    const t = q(label(doc, x.p, lang) + (x.e.home ? '' : '  /' + x.e.slug));
    // Shapes carry meaning: stadium = home, parallelogram = restricted, rectangle = public.
    L.push(`  ${x.n}${x.e.home ? `([${t}])` : x.p.access && x.p.access !== 'public' ? `[/${t}/]` : `[${t}]`}`);
  }
  for (const x of nodes) { const up = parentOf(nodes, x); if (up) L.push(`  ${up.n} --> ${x.n}`); }
  const nf = (doc.regions.main || []).find((p) => isObj(p) && p.kind === 'notfound');
  if (nf) L.push(`  nf{{${q(label(doc, nf, lang) + ' · 404')}}}`);
  L.push('  classDef closed fill:#fde2e2,stroke:#dc2626');
  const closed = nodes.filter((x) => x.p.access && x.p.access !== 'public').map((x) => x.n);
  if (closed.length) L.push('  class ' + closed.join(',') + ' closed');
  return L.join('\n');
}

function navMap(doc, lang) {
  const nodes = pageNodes(doc, lang).filter((x) => x.p.nav !== false && !x.p.hidden);
  const L = ['flowchart LR', '  H[["' + (str(pickText(doc.meta.title, lang, doc)) || doc.name).replace(/["\n]/g, ' ').slice(0, 40) + '"]]'];
  for (const x of nodes) L.push(`  H --> ${x.n}[${q(label(doc, x.p, lang))}]`);
  return L.join('\n');
}

function accessMap(doc, lang) {
  const roles = (doc.auth && doc.auth.roles) || [];
  // Bottom-to-top: privileges grow upward; dotted edges are role inheritance, solid edges are "may open".
  // Role ids are user data: '-' is replaced because Mermaid ids do not allow it.
  const L = ['flowchart BT', '  guest((' + q(lang.startsWith('ru') ? 'Гость' : 'Visitor') + '))'];
  for (const r of roles) L.push(`  r_${r.id.replace(/-/g, '_')}((${q(r.id)}))`);
  for (const r of roles) if (r.parent) L.push(`  r_${r.parent.replace(/-/g, '_')} -.-> r_${r.id.replace(/-/g, '_')}`);
  for (const r of roles) if (!r.parent && r.id !== 'admin') L.push(`  guest -.-> r_${r.id.replace(/-/g, '_')}`);
  for (const x of pageNodes(doc, lang)) {
    const nm = `${x.n}[${q(label(doc, x.p, lang))}]`;
    if (!x.p.access || x.p.access === 'public') L.push(`  guest --> ${nm}`);
    // 'members' maps to the built-in member role id; Mermaid creates the node implicitly if no role declared it.
    else if (x.p.access === 'members') L.push(`  r_member --> ${nm}`);
    else for (const r of roleList(x.p.roles)) L.push(`  r_${r.replace(/-/g, '_')} --> ${nm}`);
  }
  L.push('  r_admin --> adm[/' + q('/admin/ · /_studio/') + '/]');
  return L.join('\n');
}

function dataMap(doc, lang, target = 'static') {
  // Reuse the backend planner instead of re-deriving destinations: the map then shows exactly what the export does.
  const plan = planBackend(doc, target, {});
  const L = ['flowchart LR'];
  const dest = { browser: 'B[(' + q(lang.startsWith('ru') ? 'Браузер посетителя' : 'Visitor’s browser') + ')]', backend: 'S[(' + q(lang.startsWith('ru') ? 'Сервер сайта' : 'Site server') + ')]',
    external: 'E[(' + q(lang.startsWith('ru') ? 'Ваш адрес' : 'Your endpoint') + ')]', channel: 'C>' + q(lang.startsWith('ru') ? 'Почта / мессенджер' : 'E-mail / messenger') + ']',
    need: 'N{' + q(lang.startsWith('ru') ? 'Нужна настройка' : 'Needs set-up') + '}', lost: 'X{' + q(lang.startsWith('ru') ? 'Никуда' : 'Nowhere') + '}' };
  const used = new Set();
  plan.items.forEach((it, i) => {
    const name = it.kind === 'checkout' ? (lang.startsWith('ru') ? 'Заказ' : 'Checkout') : it.kind === 'sync' ? (lang.startsWith('ru') ? 'Корзина' : 'Cart sync') : (it.label || it.type);
    const d = dest[it.status] ? it.status : 'lost';
    used.add(d);
    L.push(`  i${i}[${q(name)}] --> ${d === 'browser' ? 'B' : d === 'backend' ? 'S' : d === 'external' ? 'E' : d === 'channel' ? 'C' : d === 'need' ? 'N' : 'X'}`);
  });
  // Declare only destinations actually used, inserted after the header line, so unused sinks do not clutter.
  for (const d of used) L.splice(1, 0, '  ' + dest[d]);
  if (!plan.items.length) L.push('  none[' + q(lang.startsWith('ru') ? 'Сайт не собирает данные' : 'The site collects no data') + ']');
  return L.join('\n');
}

function typesMap(doc) {
  const { collections } = contentCollections(doc);
  const L = ['erDiagram'];
  if (!collections.size) return 'erDiagram\n  SITE {\n    string pages\n  }';
  for (const [name, c] of collections) {
    const ent = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    // Schema inferred from the first item only (collections are schemaless JSON); capped at 10 fields for legibility.
    const it = c.items[0] || {};
    L.push(`  ${ent} {`);
    for (const k of Object.keys(it).filter((k) => k !== 'id').slice(0, 10)) L.push(`    ${typeof it[k] === 'number' ? 'number' : isObj(it[k]) ? 'text' : 'string'} ${k.replace(/[^A-Za-z0-9_]/g, '_')}`);
    L.push('  }');
    L.push(`  SITE ||--o{ ${ent} : ${c.type}`);
  }
  return L.join('\n');
}

/** Mermaid source of one view of the site. */
export function siteMapSource(doc, view = 'pages', o = {}) {
  const lang = o.lang || doc.defaultLang || 'en';
  if (view === 'nav') return navMap(doc, lang);
  if (view === 'access') return accessMap(doc, lang);
  if (view === 'data') return dataMap(doc, lang, o.target || 'static');
  if (view === 'types') return typesMap(doc);
  return pagesMap(doc, lang);
}
