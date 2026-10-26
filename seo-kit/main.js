// seo-kit/main.js - the site page: the site (name, base URL, languages), the organisation or person behind it and the
// pages (pasted lists or one by one: path, title, description, lastmod, priority, language versions, image, posts),
// and the generated files in tabs, each with a live preview, copy and download: sitemap.xml with hreflang
// alternates (split into an index when large), robots.txt with a rule tester, llms.txt / llms-full.txt, JSON Feed /
// RSS / Atom of the posts, JSON-LD built from forms, and the head tags of every page with a lint. Everything also
// leaves as one ZIP (with the Open Graph card of the card page as SVG and PNG).
//
// Architecture: one mutable site object S (schema owned by seo/site.js via kit.js), edited in place by bound inputs.
// Two render levels, kept apart on purpose:
// - render() / paintX(): rebuild FORM DOM. Only on structural change (add/remove page, switch kind, reset); rebuilding
//   on every keystroke would destroy focus and caret position in the field being typed in.
// - repaint() -> els.paint(): regenerate OUTPUTS of the visible tab only. Generators (sitemap, feeds) are pure
//   functions of S; running the five hidden tabs too would be wasted work on large sites.
// Debounces: save 300ms (localStorage is synchronous and serialises the whole site), repaint 120ms (outputs regenerate
// whole files; coalescing a burst of keystrokes keeps typing smooth). Pure generators + debounce = no caching layer.
import { cardSvg, counter, demoSite, filePane, group, hostOf, issueList, ldIssueText, loadCard, loadSite, metaIssueText, saveSite, sharePreview, startShell, svgToPng, tabs, cardUri } from './common.js';
import {
  AI_BOTS, COMMON_BOTS, LD_FIELDS, LD_TYPES, abs, allFiles, baseOk, blockedInSitemap, feedFiles, headHtml, hreflangHead, indexed, ldBuild, ldIssues, lines,
  llmsFiles, metaModel, newPage, normPath, pageIssues, pageLocales, pageUrl, posts, prettyLd, robotsTest, robotsText, rootLang, siteLocales, sitemapEntries, sitemapFiles,
} from './kit.js';
import { button, card, colorInput, download, field, seg, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { confirmDialog } from '../ui/overlays.js';
import { writeZip } from '../zip/zip.js';

let S = loadSite();
const save = debounce(() => saveSite(S), 300);
const changed = () => { save(); repaintSoon(); };
const repaintSoon = debounce(() => repaint(), 120);

const TABS = [
  { k: 'sitemap', label: 'sk.tab.sitemap', icon: 'sitemap' },
  { k: 'robots', label: 'sk.tab.robots', icon: 'robot' },
  { k: 'llms', label: 'sk.tab.llms', icon: 'ai' },
  { k: 'feeds', label: 'sk.tab.feeds', icon: 'feed' },
  { k: 'jsonld', label: 'sk.tab.jsonld', icon: 'code' },
  { k: 'meta', label: 'sk.tab.meta', icon: 'card' },
];
const TAB_KEY = 'sk-tab';
// Stored tab validated against TABS: a renamed or removed tab in a newer version falls back instead of crashing.
let tab = TABS.some((x) => x.k === lsGet(TAB_KEY, '')) ? lsGet(TAB_KEY, '') : 'sitemap';

const main = $('#main');
main.classList.add('sk-site');
let els = {};

// Text field bound to an object property (changes repaint the outputs, never the form).
// ?? '' (not ||): a stored 0 stays 0. `after` lets a field refresh a dependent widget (page summary, root language)
// without a full render.
const bind = (obj, k, attrs = {}, after) => textInput(obj[k] ?? '', (v) => { obj[k] = v; changed(); if (after) after(v); }, attrs);
const fld = (label, control, hint) => field(label, control, hint);

// ---------------------------------------------------------------------------------------------------------------
// Layout

function render() {
  main.textContent = '';
  els = {};
  els.stats = h('div', { class: 'sk-stats', 'aria-live': 'polite' });
  // One shared tabpanel re-filled per tab; aria-labelledby is re-pointed in renderPanel. tabindex=-1: focusable by script.
  els.panel = h('div', { class: 'sk-panel', id: 'sk-panel', role: 'tabpanel', tabindex: '-1' });
  const zip = button('sk.zip', 'zip', downloadZip, 'primary');
  zip.id = 'sk-zip';
  const reset = button('sk.demo', 'refresh', resetDemo);
  reset.classList.add('ed-sm');
  const left = h('div', { class: 'sk-col sk-left' }, siteCard(), orgCard(), pagesCard(), h('div', { class: 'ap-actions' }, reset));
  const right = h('div', { class: 'sk-col sk-right' },
    h('div', { class: 'sk-out-h' }, els.stats, h('span', { class: 'ed-spacer' }), zip),
    tabs(TABS, tab, (k) => { tab = k; lsSet(TAB_KEY, k); renderPanel(); }, 'sk.outputs'),
    els.panel);
  main.append(h('div', { class: 'sk-work' }, left, right));
  renderPanel();
  repaintStats();
}

// Destructive (replaces the whole site), so a confirmation dialog; the save is immediate, not debounced.
async function resetDemo() {
  if (!(await confirmDialog(t('sk.demo'), t('sk.demoAsk'), t('sk.demoGo')))) return;
  S = demoSite();
  saveSite(S);
  render();
}

// --- site ------------------------------------------------------------------------------------------------------

// role=status on the base URL warning: announced politely when it appears; the URL drives every absolute link.
function siteCard() {
  const baseWarn = h('div', { class: 'ed-hint sk-warn-hint', role: 'status' });
  const paintBase = () => { baseWarn.textContent = baseOk(S) ? '' : t('sk.w.base'); };
  const desc = bind(S, 'description', { multiline: true, rows: 3, id: 'sk-desc' });
  const rootSel = h('div');
  // Root language options derive from the languages field, so the select is rebuilt when that field changes (paintRoot
  // passed as `after`), not on every repaint.
  const paintRoot = () => {
    rootSel.textContent = '';
    const s = select(siteLocales(S).map((l) => ({ v: l, l: '=' + l })), rootLang(S), (v) => { S.root = v; changed(); });
    s.setAttribute('aria-label', t('sk.f.root'));
    rootSel.append(s);
  };
  paintRoot();
  paintBase();
  const box = card('sk.site',
    h('div', { class: 'ed-fields' },
      fld('sk.f.siteName', bind(S, 'name')),
      fld('sk.f.base', bind(S, 'base', { type: 'url', inputmode: 'url', placeholder: 'https://example.com', class: 'ed-input sk-mono', dir: 'ltr' }, paintBase)),
      baseWarn,
      // 50..160 chars: the range search engines typically show for a description without cutting it.
      h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'sk-desc' }, t('sk.f.siteDesc')), desc, h('div', { class: 'ed-hint' }, counter(desc, 160, 50))),
      h('div', { class: 'sk-grid2' },
        fld('sk.f.langs', bind(S, 'langs', { class: 'ed-input sk-mono', placeholder: 'en, ru, ka' }, paintRoot)),
        group('sk.f.root', rootSel)),
      h('div', { class: 'ed-hint' }, t('sk.h.langs'))));
  return box;
}

const ORG_KINDS = ['Organization', 'LocalBusiness', 'Person'];
// The form changes shape with the kind (Person has a job title and no address), so kind switches call paint().
// Collapsed <details>: optional data, secondary to the pages.
function orgCard() {
  const body = h('div', { class: 'ed-fields' });
  const o = S.org;
  const paint = () => {
    body.textContent = '';
    body.append(group('sk.f.kind', seg(ORG_KINDS.map((v) => ({ v, l: 'sk.kind.' + v })), o.kind, (v) => { o.kind = v; changed(); paint(); }, 'sk.f.kind')));
    body.append(fld(o.kind === 'Person' ? 'sk.f.personName' : 'sk.f.orgName', bind(o, 'name', { placeholder: S.name })));
    if (o.kind === 'Person') body.append(fld('sk.f.jobTitle', bind(o, 'jobTitle')));
    body.append(h('div', { class: 'sk-grid2' },
      fld('sk.f.orgUrl', bind(o, 'url', { placeholder: '/', class: 'ed-input sk-mono', dir: 'ltr' })),
      fld(o.kind === 'Person' ? 'sk.f.photo' : 'sk.f.logo', bind(o, 'logo', { placeholder: '/img/logo.png', class: 'ed-input sk-mono', dir: 'ltr' }))));
    if (o.kind !== 'Person') {
      body.append(h('div', { class: 'sk-grid2' }, fld('sk.f.email', bind(o, 'email', { type: 'email', dir: 'ltr' })), fld('sk.f.phone', bind(o, 'phone', { type: 'tel', dir: 'ltr' }))));
      body.append(fld('sk.f.street', bind(o, 'street')),
        h('div', { class: 'sk-grid2' }, fld('sk.f.locality', bind(o, 'locality')), fld('sk.f.region', bind(o, 'region'))),
        h('div', { class: 'sk-grid2' }, fld('sk.f.postalCode', bind(o, 'postalCode')), fld('sk.f.country', bind(o, 'country', { placeholder: 'GE', maxlength: 60 }))),
        h('div', { class: 'sk-grid2' }, fld('sk.f.lat', bind(o, 'lat', { inputmode: 'decimal' })), fld('sk.f.lon', bind(o, 'lon', { inputmode: 'decimal' }))));
    }
    body.append(fld('sk.f.sameAs', bind(o, 'sameAs', { multiline: true, rows: 2, dir: 'ltr', placeholder: 'https://…' }), 'sk.h.sameAs'));
  };
  paint();
  return h('details', { class: 'ap-card sk-details' }, h('summary', {}, iconEl('chevRight'), h('span', { class: 'ap-card-h' }, t('sk.org'))), body);
}

// --- pages -----------------------------------------------------------------------------------------------------

// Sitemap protocol values; '' = omit the tag (search engines mostly ignore priority/changefreq, so blank is the default).
const PRIORITIES = ['', '1', '0.9', '0.8', '0.7', '0.6', '0.5', '0.4', '0.3', '0.2', '0.1', '0'];
const FREQS = ['', 'always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];

function pagesCard() {
  els.pages = h('div', { class: 'sk-pages' });
  els.pagesH = h('span', { class: 'sk-count-h' });
  const paste = h('textarea', { class: 'ed-input ed-textarea sk-mono', rows: 4, spellcheck: 'false', dir: 'ltr', placeholder: '/blog/new-post/\thow we…\nhttps://example.com/about/', 'aria-label': t('sk.paste') });
  const add = button('sk.pasteAdd', 'plus', () => {
    const n = addPasted(paste.value);
    if (n) { paste.value = ''; toast(t('sk.pasted', { n }), 'ok'); } else toast(t('sk.pastedNone'), 'warn');
  });
  add.classList.add('ed-sm');
  const one = button('sk.addPage', 'plus', () => {
    S.pages.push(newPage('/new-page/'));
    changed(); paintPages(S.pages.length - 1);
  });
  one.classList.add('ed-sm');
  const pasteBox = h('details', { class: 'sk-details sk-paste' }, h('summary', {}, iconEl('chevRight'), h('span', {}, t('sk.paste'))),
    h('div', { class: 'ed-fields' }, paste, h('div', { class: 'ed-hint' }, t('sk.h.paste')), h('div', { class: 'ap-actions' }, add)));
  paintPages();
  return h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('sk.pages'), ' ', els.pagesH), pasteBox, els.pages, h('div', { class: 'ap-actions' }, one));
}

// Lines 'path-or-url [TAB or |] title [TAB or |] description' -> new pages (existing paths are skipped).
// Split on TAB (spreadsheet paste) or " | " with spaces (hand typed); a bare | is kept, it can be part of a title.
// Lines starting with # are comments. Paths are normalised before the duplicate check, so /a and https://site/a match.
function addPasted(text) {
  const have = new Set(S.pages.map((p) => normPath(S, p.path)));
  let n = 0;
  for (const raw of lines(text)) {
    const [u, title = '', description = ''] = raw.split(/\t|\s+\|\s+/).map((x) => x.trim());
    if (!u || /^#/.test(u)) continue;
    const path = normPath(S, u);
    if (have.has(path)) continue;
    have.add(path);
    S.pages.push({ ...newPage(path), title, description });
    n++;
  }
  if (n) { changed(); paintPages(); }
  return n;
}

function pageSummary(p) {
  const kids = [h('span', { class: 'sk-page-path' }, normPath(S, p.path)), h('span', { class: 'sk-page-title' }, p.title || '—')];
  if (p.post) kids.push(h('span', { class: 'sk-tag' }, t('sk.post')));
  if (p.noindex) kids.push(h('span', { class: 'sk-tag sk-tag-off' }, 'noindex'));
  const locs = pageLocales(S, p);
  if (siteLocales(S).length > 1) kids.push(h('span', { class: 'sk-tag sk-tag-l' }, locs.join(' · ')));
  return kids;
}

// KNOWN DEFECT: det.open = true queues the 'toggle' event as a task, so pageBody() is appended after this function
// returns; d.querySelector('input') below still sees only the summary and focus() never happens for a new page.
// Fix: append pageBody(p, i, refresh) synchronously when i === open (the toggle listener's length check then skips it).
function paintPages(open = -1) {
  const box = els.pages;
  box.textContent = '';
  els.pagesH.textContent = '(' + S.pages.length + ')';
  S.pages.forEach((p, i) => {
    const sum = h('summary', {}, iconEl('chevRight'), h('span', { class: 'sk-page-sum' }, pageSummary(p)));
    const det = h('details', { class: 'sk-page', dataset: { i } }, sum);
    const refresh = () => { sum.lastChild.replaceChildren(...pageSummary(p)); };
    // The body is built when the page is opened (long lists stay light).
    det.addEventListener('toggle', () => { if (det.open && det.children.length === 1) det.append(pageBody(p, i, refresh)); });
    if (i === open) { det.open = true; }
    box.append(det);
  });
  if (open >= 0) { const d = box.children[open]; d.scrollIntoView({ block: 'nearest' }); d.querySelector('input')?.focus(); }
}

// `i` is captured per render; safe because every removal calls paintPages(), rebuilding all bodies with fresh indexes.
function pageBody(p, i, refresh) {
  const up = () => { refresh(); };
  const desc = bind(p, 'description', { multiline: true, rows: 2 }, up);
  desc.id = 'sk-pd' + i;
  const pr = select(PRIORITIES.map((v) => ({ v, l: v ? '=' + v : 'sk.none' })), p.priority, (v) => { p.priority = v; changed(); });
  const fr = select(FREQS.map((v) => ({ v, l: v ? 'sk.freq.' + v : 'sk.none' })), p.changefreq, (v) => { p.changefreq = v; changed(); });
  const date = h('input', { type: 'date', class: 'ed-input', value: p.lastmod });
  date.addEventListener('input', () => { p.lastmod = date.value; changed(); });
  const postFields = h('div', { class: 'ed-fields' });
  const paintPost = () => {
    postFields.textContent = '';
    if (p.post) postFields.append(h('div', { class: 'sk-grid2' }, fld('sk.f.author', bind(p, 'author')), fld('sk.f.tags', bind(p, 'tags', { placeholder: 'tea, harvest' }))));
  };
  paintPost();
  const del = button('sk.removePage', 'trash', async () => {
    if (!(await confirmDialog(t('sk.removePage'), t('sk.removeAsk', { path: normPath(S, p.path) }), t('dlg.delete'), true))) return;
    S.pages.splice(i, 1);
    changed(); paintPages();
  }, 'danger');
  del.classList.add('ed-sm');
  return h('div', { class: 'ed-fields sk-page-body' },
    h('div', { class: 'sk-grid2' },
      fld('sk.f.path', bind(p, 'path', { class: 'ed-input sk-mono', dir: 'ltr' }, up)),
      fld('sk.f.title', bind(p, 'title', {}, up))),
    h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: desc.id }, t('sk.f.description')), desc, h('div', { class: 'ed-hint' }, counter(desc, 160, 50))),
    h('div', { class: 'sk-grid3' }, fld('sk.f.lastmod', date), fld('sk.f.priority', pr), fld('sk.f.changefreq', fr)),
    h('div', { class: 'sk-grid2' },
      fld('sk.f.pageLangs', bind(p, 'langs', { class: 'ed-input sk-mono', placeholder: siteLocales(S).join(', ') }, up), 'sk.h.pageLangs'),
      fld('sk.f.image', bind(p, 'image', { class: 'ed-input sk-mono', dir: 'ltr', placeholder: '/img/…' }))),
    h('div', { class: 'sk-grid2' },
      // post/noindex change the summary tags (up) and the post fields (paintPost) besides the outputs.
      fld('sk.f.post', toggle(p.post, (v) => { p.post = v; changed(); up(); paintPost(); })),
      fld('sk.f.noindex', toggle(p.noindex, (v) => { p.noindex = v; changed(); up(); }))),
    postFields,
    fld('sk.f.text', bind(p, 'text', { multiline: true, rows: 3 }), 'sk.h.text'),
    h('div', { class: 'ap-actions' }, del));
}

// ---------------------------------------------------------------------------------------------------------------
// Outputs

function repaint() {
  repaintStats();
  if (els.paint) els.paint();
}

function repaintStats() {
  const box = els.stats;
  if (!box) return;
  const chip = (k, n) => h('span', { class: 'sk-chip' }, t(k, { n }));
  box.replaceChildren(chip('sk.st.pages', indexed(S).length), chip('sk.st.urls', sitemapEntries(S).length), chip('sk.st.langs', siteLocales(S).length), chip('sk.st.posts', posts(S).length));
}

// Dispatch table instead of a switch: each panel builds its controls and sets els.paint; then one paint fills outputs.
function renderPanel() {
  const p = els.panel;
  p.textContent = '';
  p.setAttribute('aria-labelledby', 'sk-tab-' + tab);
  els.paint = null;
  ({ sitemap: sitemapPanel, robots: robotsPanel, llms: llmsPanel, feeds: feedsPanel, jsonld: ldPanel, meta: metaPanel })[tab](p);
  if (els.paint) els.paint();
}

const panes = () => h('div', { class: 'sk-files' });
const warnings = () => h('div', { class: 'sk-warns' });
// Empty list renders nothing (the .sk-warns:empty rule then hides the box).
const warnList = (box, items) => { box.replaceChildren(...(items.length ? [issueList(items)] : [])); };

// --- sitemap ---------------------------------------------------------------------------------------------------

function sitemapPanel(p) {
  const out = panes(), warn = warnings();
  const split = h('input', { type: 'number', class: 'ed-input', min: 1, max: 50000, step: 1, value: S.split });
  // 50,000 URLs is the sitemap protocol limit per file; above the split size the generator writes an index + parts.
  // Invalid input (empty, NaN) maps to the protocol maximum, not to 1, so a cleared field cannot spawn thousands of files.
  split.addEventListener('input', () => { S.split = Math.max(1, Math.min(50000, Math.round(+split.value) || 50000)); changed(); });
  p.append(card('sk.tab.sitemap', h('div', { class: 'sk-grid2' }, fld('sk.f.split', split, 'sk.h.split')), h('div', { class: 'ed-hint' }, t('sk.h.sitemap'))), warn, out);
  els.paint = () => {
    const files = sitemapFiles(S);
    const w = [];
    if (!baseOk(S)) w.push({ level: 'error', text: t('sk.w.base') });
    // Cross-check: a URL listed in the sitemap but disallowed by robots.txt sends search engines conflicting signals.
    const blocked = blockedInSitemap(S);
    if (blocked.length) w.push({ level: 'warn', text: t('sk.w.blocked', { n: blocked.length, list: blocked.slice(0, 3).join(', ') }) });
    const skipped = S.pages.filter((x) => x.noindex).length;
    if (skipped) w.push({ level: 'info', text: t('sk.w.noindexSkipped', { n: skipped }) });
    warnList(warn, w);
    out.replaceChildren(...files.map((f) => filePane(f, f.index ? t('sk.n.index', { n: f.count }) : t('sk.n.urls', { n: f.count }))));
  };
}

// --- robots ----------------------------------------------------------------------------------------------------

// Groups are rebuilt on add/remove; field edits only regenerate the file.
function robotsPanel(p) {
  const out = panes(), warn = warnings();
  const groupsBox = h('div', { class: 'sk-groups' });
  const paintGroups = () => {
    groupsBox.textContent = '';
    S.robots.groups.forEach((g, i) => {
      const del = h('button', { type: 'button', class: 'ed-iconbtn', title: t('sk.r.remove'), 'aria-label': t('sk.r.remove'), onclick: () => { S.robots.groups.splice(i, 1); changed(); paintGroups(); } }, iconEl('trash'));
      groupsBox.append(h('fieldset', { class: 'sk-group' }, h('legend', {}, t('sk.r.group', { n: i + 1 })), del,
        h('div', { class: 'sk-grid2' },
          fld('sk.r.agents', bind(g, 'agents', { multiline: true, rows: 2, class: 'ed-input ed-textarea sk-mono', dir: 'ltr' })),
          fld('sk.r.delay', bind(g, 'delay', { inputmode: 'numeric', placeholder: '—' }))),
        h('div', { class: 'sk-grid2' },
          fld('sk.r.disallow', bind(g, 'disallow', { multiline: true, rows: 3, class: 'ed-input ed-textarea sk-mono', dir: 'ltr', placeholder: '/admin/' })),
          fld('sk.r.allow', bind(g, 'allow', { multiline: true, rows: 3, class: 'ed-input ed-textarea sk-mono', dir: 'ltr' })))));
    });
  };
  paintGroups();
  const addG = button('sk.r.add', 'plus', () => { S.robots.groups.push({ agents: '*', allow: '', disallow: '', delay: '' }); changed(); paintGroups(); });
  // One group for all known AI crawlers with Disallow: / : opt out of training crawls while search bots stay allowed.
  const addAi = button('sk.r.addAi', 'ai', () => { S.robots.groups.push({ agents: AI_BOTS.join('\n'), allow: '', disallow: '/', delay: '' }); changed(); paintGroups(); });
  addG.classList.add('ed-sm'); addAi.classList.add('ed-sm');

  // Tests the GENERATED robots.txt, not the form, through the same matcher a crawler would use (robotsTest), so the
  // answer is exactly what the downloaded file means. <datalist>: suggestions without restricting free text.
  // Tester
  const path = h('input', { class: 'ed-input sk-mono', id: 'sk-test-path', value: lsGet('sk-test-path', '/admin/login'), dir: 'ltr', spellcheck: 'false' });
  const agent = h('input', { class: 'ed-input sk-mono', id: 'sk-test-agent', value: lsGet('sk-test-agent', 'Googlebot'), list: 'sk-bots', dir: 'ltr', spellcheck: 'false' });
  const verdict = h('div', { class: 'sk-verdict', id: 'sk-verdict', role: 'status', 'aria-live': 'polite' });
  const test = () => {
    lsSet('sk-test-path', path.value); lsSet('sk-test-agent', agent.value);
    const ok = robotsTest(robotsText(S), path.value, agent.value);
    verdict.dataset.state = ok ? 'allowed' : 'blocked';
    verdict.className = 'sk-verdict sk-verdict-' + (ok ? 'ok' : 'no');
    verdict.replaceChildren(iconEl(ok ? 'check' : 'lock'), h('span', {}, t(ok ? 'sk.r.allowed' : 'sk.r.blocked', { path: path.value.trim() || '/', agent: agent.value.trim() || '*' })));
  };
  path.addEventListener('input', test);
  agent.addEventListener('input', test);
  const tester = card('sk.r.tester', h('datalist', { id: 'sk-bots' }, COMMON_BOTS.map((b) => h('option', { value: b }))),
    h('div', { class: 'sk-grid2' }, fld('sk.r.path', path), fld('sk.r.agent', agent)), verdict, h('div', { class: 'ed-hint' }, t('sk.h.tester')));

  p.append(card('sk.tab.robots', groupsBox, h('div', { class: 'ap-actions' }, addG, addAi),
    h('div', { class: 'sk-grid2 sk-mt' }, fld('sk.r.host', bind(S.robots, 'host', { placeholder: 'example.com', dir: 'ltr' }), 'sk.h.host'))), tester, warn, out);
  els.paint = () => {
    const text = robotsText(S);
    const blocked = blockedInSitemap(S, text);
    warnList(warn, blocked.length ? [{ level: 'warn', text: t('sk.w.blocked', { n: blocked.length, list: blocked.slice(0, 3).join(', ') }) }] : []);
    out.replaceChildren(filePane({ name: 'robots.txt', text, mime: 'text/plain' }));
    test();
  };
}

// --- llms.txt --------------------------------------------------------------------------------------------------

// llms.txt (index for language models) and llms-full.txt (page texts inlined, truncated past a size budget).
function llmsPanel(p) {
  const out = panes();
  const L = S.llms;
  p.append(card('sk.tab.llms', h('div', { class: 'ed-fields' },
    fld('sk.l.summary', bind(L, 'summary', { multiline: true, rows: 2, placeholder: S.description }), 'sk.h.summary'),
    fld('sk.l.intro', bind(L, 'intro', { multiline: true, rows: 3 })),
    h('div', { class: 'sk-grid2' }, fld('sk.l.pagesTitle', bind(L, 'pagesTitle')), fld('sk.l.postsTitle', bind(L, 'postsTitle'))),
    fld('sk.l.optional', toggle(L.postsOptional, (v) => { L.postsOptional = v; changed(); }), 'sk.h.optional'),
    h('div', { class: 'ed-hint' }, t('sk.h.llms')))), out);
  els.paint = () => {
    const [a, b] = llmsFiles(S);
    out.replaceChildren(filePane(a), filePane(b, t(b.truncated ? 'sk.n.truncated' : 'sk.n.docs', { n: b.included })));
  };
}

// --- feeds -----------------------------------------------------------------------------------------------------

// Feeds only make sense for posts; with none an empty state replaces three empty files.
function feedsPanel(p) {
  const out = panes();
  const F = S.feed;
  p.append(card('sk.tab.feeds', h('div', { class: 'ed-fields' },
    h('div', { class: 'sk-grid2' }, fld('sk.fe.title', bind(F, 'title', { placeholder: S.name })), fld('sk.fe.author', bind(F, 'author'))),
    fld('sk.fe.description', bind(F, 'description', { multiline: true, rows: 2, placeholder: S.description })),
    h('div', { class: 'ed-hint' }, t('sk.h.feeds')))), out);
  els.paint = () => {
    const n = posts(S).length;
    if (!n) { out.replaceChildren(h('div', { class: 'ap-empty' }, t('sk.fe.none'))); return; }
    out.replaceChildren(...feedFiles(S).map((f) => filePane(f, t('sk.n.items', { n }))));
  };
}

// --- JSON-LD ---------------------------------------------------------------------------------------------------

// Type picker = radio group (roving tabindex, arrows select). The form is data driven by LD_FIELDS[type]: adding a
// schema.org type means adding a field list in seo/site.js, not UI code here.
function ldPanel(p) {
  const out = panes(), form = h('div', { class: 'ed-fields' }), warn = warnings();
  const picker = h('div', { class: 'sk-chips', role: 'radiogroup', 'aria-label': t('sk.ld.type') });
  const paintPicker = () => { for (const b of picker.children) { const on = b.dataset.k === S.ld.type; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('sk-on', on); } };
  for (const k of LD_TYPES) picker.append(h('button', { type: 'button', role: 'radio', class: 'sk-chipbtn', dataset: { k }, onclick: () => { S.ld.type = k; changed(); paintPicker(); paintForm(); } }, t('sk.ld.t.' + k)));
  picker.addEventListener('keydown', (e) => {
    const btns = [...picker.children], i = btns.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const b = btns[(i + step + btns.length) % btns.length]; b.focus(); b.click();
  });
  const paintForm = () => {
    const type = S.ld.type, d = S.ld[type];
    form.textContent = '';
    form.append(h('div', { class: 'ed-hint' }, t('sk.ld.h.' + type)));
    for (const f of LD_FIELDS[type]) {
      let c;
      if (f.kind === 'page') {
        c = select(S.pages.map((x, i) => ({ v: i, l: '=' + normPath(S, x.path) + (x.title ? ' — ' + x.title : '') })), d[f.k], (v) => { d[f.k] = +v; changed(); });
      } else if (f.kind === 'select') {
        c = select(f.opts.map((v) => ({ v, l: 'sk.o.' + v })), d[f.k], (v) => { d[f.k] = v; changed(); });
      } else if (f.kind === 'datetime') {
        c = h('input', { type: 'datetime-local', class: 'ed-input', value: d[f.k] });
        c.addEventListener('input', () => { d[f.k] = c.value; changed(); });
      } else {
        c = bind(d, f.k, f.kind === 'long' ? { multiline: true, rows: f.rows || 2 } : f.kind === 'num' ? { inputmode: 'decimal' } : {});
      }
      // Hints exist only for fields with a non-obvious input format; the list mirrors the sk.h.* keys in strings.js.
      form.append(fld('sk.f.' + f.k, c, ['faq', 'openingHours', 'ingredients', 'steps', 'searchUrl', 'ready'].includes(f.k) ? 'sk.h.' + f.k : null));
    }
    repaint();
  };
  paintPicker();
  p.append(card('sk.tab.jsonld', picker, form), warn, out);
  paintForm();
  els.paint = () => {
    const type = S.ld.type, x = ldBuild(S, type);
    if (!x) { warnList(warn, [{ level: 'error', text: t('sk.ld.noPage') }]); out.replaceChildren(); return; }
    warnList(warn, ldIssues(x).map((i) => ({ level: i.level, text: ldIssueText(i), code: i.code })));
    out.replaceChildren(filePane({ name: `jsonld/${type}.html`, text: prettyLd(x), mime: 'text/html' }, t('sk.n.ld')));
  };
}

// --- head tags -------------------------------------------------------------------------------------------------

// `lang` is local, not saved: it is a preview choice, not site data. Out-of-range M.page (pages deleted) resets to 0.
function metaPanel(p) {
  const out = panes(), warn = warnings(), preview = h('div', { class: 'sk-share-box' });
  const M = S.meta;
  if (!S.pages[M.page]) M.page = 0;
  const langBox = h('div');
  let lang = '';
  const paintLang = () => {
    const pg = S.pages[M.page];
    langBox.textContent = '';
    if (!pg) return;
    const locs = pageLocales(S, pg);
    if (!locs.includes(lang)) lang = locs[0];
    const s = select(locs.map((l) => ({ v: l, l: '=' + l })), lang, (v) => { lang = v; repaint(); });
    s.setAttribute('aria-label', t('sk.m.lang'));
    langBox.append(s);
  };
  const pageSel = select(S.pages.map((x, i) => ({ v: i, l: '=' + normPath(S, x.path) + (x.title ? ' — ' + x.title : '') })), M.page, (v) => { M.page = +v; changed(); paintLang(); });
  paintLang();
  p.append(card('sk.tab.meta', h('div', { class: 'ed-fields' },
    h('div', { class: 'sk-grid2' }, fld('sk.m.page', pageSel), group('sk.m.lang', langBox)),
    h('div', { class: 'sk-grid2' },
      fld('sk.m.image', bind(M, 'image', { class: 'ed-input sk-mono', dir: 'ltr', placeholder: '/og.png' }), 'sk.h.mimage'),
      fld('sk.m.twitter', bind(M, 'twitter', { placeholder: '@name', dir: 'ltr' }))),
    fld('sk.m.theme', colorInput(M.theme || '#0f766e', (v) => { M.theme = v; changed(); })))),
  preview, warn, out);
  els.paint = () => {
    const pg = S.pages[M.page];
    if (!pg) { out.replaceChildren(h('div', { class: 'ap-empty' }, t('sk.m.noPages'))); preview.replaceChildren(); warnList(warn, []); return; }
    const m = metaModel(S, pg, lang);
    // The default card path shows the card designed on the card page.
    // Only data URIs are shown in the preview: the card page's card when the page falls back to the site-wide image.
    const isCard = !pg.image && m.image && m.image.url === abs(S, M.image);
    preview.replaceChildren(h('div', { class: 'ed-label' }, t('sk.share.title')),
      sharePreview({ image: isCard ? cardUri(loadCard()) : null, imageNote: m.image ? m.image.url : '', domain: hostOf(m.url), title: m.ogTitle, description: m.description }));
    // 'missing' is an error (the tag is absent), every other issue (too long, too short) a warning.
    warnList(warn, pageIssues(S, pg).map((x) => ({ level: x.issue === 'missing' ? 'error' : 'warn', text: metaIssueText(x), field: x.field, issue: x.issue })));
    const files = [{ name: 'head.html', text: headHtml(S, pg, lang), mime: 'text/html' }];
    if (siteLocales(S).length > 1) files.push({ name: 'hreflang.html', text: hreflangHead(S, pg) + '\n', mime: 'text/html' });
    out.replaceChildren(...files.map((f, i) => filePane(f, i ? t('sk.n.hreflang') : t('sk.n.head', { url: pageUrl(S, pg, lang) }))));
  };
}

// --- ZIP -------------------------------------------------------------------------------------------------------

// Button disabled during the async build: double clicks would build two archives. finally re-enables on error too.
// PNG failure is swallowed on purpose: the SVG is already in the archive and canvas may be unavailable.
async function downloadZip() {
  const btn = $('#sk-zip');
  btn.disabled = true;
  try {
    const files = allFiles(S).map((f) => ({ name: f.name, data: f.text }));
    const c = loadCard(), svg = cardSvg(c);
    files.push({ name: 'og.svg', data: svg });
    try { files.push({ name: 'og.png', data: new Uint8Array(await (await svgToPng(svg)).arrayBuffer()) }); } catch { /* PNG needs a canvas; the SVG is enough */ }
    const zip = await writeZip(files);
    // File name from the host: scheme stripped, unsafe characters -> _, trimmed, capped at 60; 'site' when empty.
    const host = (S.base.replace(/^https?:\/\//i, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'site').slice(0, 60);
    download(zip, `seo-kit-${host}.zip`, 'application/zip');
    toast(t('sk.zipDone', { n: files.length }), 'ok');
  } catch (e) {
    toast(t('err.generic', { msg: e.message }), 'error');
  } finally { btn.disabled = false; }
}

startShell('site', () => render());
render();
// Other tabs of the same browser may change the card: the meta preview follows.
// The storage event fires only in OTHER tabs of the same origin, which is exactly the case to follow.
window.addEventListener('storage', (e) => { if (e.key === 'sk-card' && tab === 'meta') repaint(); });
