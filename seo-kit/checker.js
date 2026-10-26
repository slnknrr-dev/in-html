// seo-kit/checker.js - the checker page: paste or drop the HTML of a page; its head tags are read (seo/meta.js
// readMeta) and linted (metaIssues plus Open Graph / Twitter / canonical / hreflang / robots / lang checks), its
// JSON-LD nodes are read (seo/jsonld.js ldNodes, broken JSON reported) and checked against the properties rich
// results need. Shows the share card the page would get; nothing is fetched (remote images are named, not loaded).
//
// Security posture: the pasted HTML is parsed as data by kit.js checkPage (never inserted into this document) and
// every value is displayed through h() text nodes, so a hostile page cannot run script here. Remote og:image URLs are
// only named: loading them would leak the user's activity to that host and break the offline promise.
import { filePane, hostOf, issueList, ldIssueText, metaIssueText, sharePreview, startShell } from './common.js';
import { checkPage, samplePage } from './kit.js';
import { button, card, dropZone, t, toast } from '../ui/app.js';
import { $, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';

const KEY = 'sk-check';
// 5 MB file cap: parsing is synchronous on the main thread; bigger inputs would freeze the page.
const MAX = 5 * 1024 * 1024;
const main = $('#main');
main.classList.add('sk-check');
let els = {};
// String(... || ''): storage may hold null or a non-string from an older version.
let src = String(lsGet(KEY, '') || '');

function render() {
  main.textContent = '';
  els = {};
  // spellcheck off and dir=ltr: source code is not prose, and in RTL UI languages markup must still read left to right.
  els.input = h('textarea', { class: 'ed-input ed-textarea sk-mono sk-src', id: 'sk-src', rows: 16, spellcheck: 'false', dir: 'ltr', placeholder: '<!doctype html>\n<html lang="en">\n<head>…</head>', 'aria-label': t('sk.c.source') });
  els.input.value = src;
  els.input.addEventListener('input', () => { src = els.input.value; checkSoon(); });
  // aria-live=polite: screen readers hear the updated result after edits without losing their place.
  els.out = h('div', { class: 'sk-col sk-c-out', 'aria-live': 'polite' });
  const ex = button('sk.c.example', 'file', () => { setSource(samplePage()); });
  ex.dataset.act = 'example';
  const clear = button('ap.clear', 'trash', () => setSource(''));
  ex.classList.add('ed-sm'); clear.classList.add('ed-sm');
  const left = h('div', { class: 'sk-col' }, card('sk.c.source',
    h('label', { class: 'ed-label', for: 'sk-src' }, t('sk.c.paste')), els.input,
    h('div', { class: 'ap-actions' }, ex, clear),
    h('div', { class: 'sk-mt' }, dropZone({ accept: '.html,.htm,.xhtml,text/html', label: 'sk.c.drop', onFiles: ([f]) => readFile(f) })),
    h('div', { class: 'ed-hint' }, t('sk.c.h'))));
  main.append(h('div', { class: 'sk-c-work' }, left, els.out));
  check();
}

function setSource(v) { src = v; els.input.value = v; check(); }
function readFile(f) {
  if (!f) return;
  if (f.size > MAX) { toast(t('sk.c.big'), 'warn'); return; }
  f.text().then((x) => setSource(x), (e) => toast(t('ap.fileErr', { name: f.name, msg: e.message }), 'error'));
}

// 200ms debounce on typing: checkPage parses the whole document each run.
const checkSoon = debounce(() => check(), 200);

// Saved only under 400k chars: localStorage quota is shared per origin and a write that throws must not stop checking.
function check() {
  try { lsSet(KEY, src.length < 400000 ? src : ''); } catch { /* storage full */ }
  const out = els.out;
  if (!src.trim()) { out.replaceChildren(card('sk.c.result', h('div', { class: 'ap-empty' }, t('sk.c.empty')))); return; }
  const r = checkPage(src);
  const m = r.meta, og = m.og;
  const issues = r.issues.map((x) => ({ ...x, text: metaIssueText(x) }));
  // Error and warning totals combine head-tag issues with per-node JSON-LD issues; a broken JSON-LD block counts as one error.
  const ldCount = r.nodes.reduce((n, x) => n + x.issues.filter((i) => i.level === 'error').length, 0) + (r.ldError ? 1 : 0);
  const errs = issues.filter((x) => x.level === 'error').length + ldCount;
  const warns = issues.filter((x) => x.level === 'warn').length + r.nodes.reduce((n, x) => n + x.issues.filter((i) => i.level === 'warn').length, 0);
  const sum = h('div', { class: 'sk-stats', id: 'sk-c-sum', dataset: { errors: errs, warnings: warns } },
    h('span', { class: 'sk-chip' + (errs ? ' sk-chip-bad' : ' sk-chip-ok') }, t('sk.c.errors', { n: errs })),
    h('span', { class: 'sk-chip' + (warns ? ' sk-chip-warn' : '') }, t('sk.c.warnings', { n: warns })),
    h('span', { class: 'sk-chip' }, t('sk.c.nodes', { n: r.nodes.length })));
  // Twitter falls back to og:image on real platforms, and the reverse here is the same idea: show whichever exists.
  // Only data:image URIs are rendered; the domain prefers canonical over og:url, as crawlers do.
  const img = og['og:image'] || m.twitter['twitter:image'] || '';
  const share = sharePreview({
    image: /^data:image\//i.test(img) ? img : null, imageNote: img ? t('sk.c.remoteImg', { url: img }) : t('sk.share.noImage'),
    domain: hostOf(m.canonical || og['og:url']), title: og['og:title'] || m.title, description: og['og:description'] || m.description,
  });
  out.replaceChildren(
    card('sk.c.result', sum, h('div', { class: 'ed-label sk-mt' }, t('sk.share.title')), share),
    card('sk.c.issues', h('div', { id: 'sk-c-issues' }, issueList(issues))),
    card('sk.c.tags', tagsTable(m)),
    card('sk.c.ld', ldBlock(r)));
}

// Only non-empty tags are listed, so the table answers "what does this page declare" without noise.
function tagsTable(m) {
  const rows = [['title', m.title], ['description', m.description], ['canonical', m.canonical], ['robots', m.robots],
    ...Object.entries(m.og), ...Object.entries(m.twitter), ...m.alternates.map((a) => ['hreflang ' + a.hreflang, a.href])].filter(([, v]) => v);
  if (!rows.length) return h('div', { class: 'ap-empty' }, t('sk.c.noTags'));
  return h('div', { class: 'ap-table-wrap sk-c-table' }, h('table', { class: 'ap-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('sk.c.tag')), h('th', { scope: 'col' }, t('sk.c.value')))),
    h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('td', { class: 'sk-mono' }, k), h('td', { class: 'sk-wrap' }, v))))));
}

// role=alert on broken JSON: it invalidates every node of that block, the most important finding on the page.
// [].concat(@type): JSON-LD allows a string or an array of types. data-type is the hook e2e.js asserts on.
function ldBlock(r) {
  if (r.ldError) return h('div', { class: 'sk-ld-err', role: 'alert' }, iconEl('warn'), h('span', {}, t('sk.c.ldBroken', { msg: r.ldError })));
  if (!r.nodes.length) return h('div', { class: 'ap-empty' }, t('sk.c.noLd'));
  return h('div', { class: 'sk-col' }, r.nodes.map(({ node, issues }, i) => {
    const type = [].concat(node['@type'] || '—').join(', ');
    return h('section', { class: 'sk-ld-node', dataset: { type } },
      h('div', { class: 'sk-ld-h' }, h('strong', {}, type), node['@id'] ? h('code', { class: 'sk-mono sk-wrap' }, node['@id']) : null),
      issueList(issues.map((x) => ({ ...x, text: ldIssueText(x) })), t('sk.c.ldOk')),
      h('details', { class: 'sk-details' }, h('summary', {}, iconEl('chevRight'), h('span', {}, t('sk.c.json'))),
        filePane({ name: `node-${i + 1}.json`, text: JSON.stringify(node, null, 2) + '\n', mime: 'application/ld+json' })));
  }));
}

// Language switch re-renders everything (strings are read at render time).
startShell('check', () => render());
render();
