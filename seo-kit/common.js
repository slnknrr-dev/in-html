// seo-kit/common.js - shared parts of the site, card and checker pages: the shell (pages resolved from the hidden
// anchors of the page HTML, so the build can rewrite them), app icons, the saved site and card (localStorage), the
// Open Graph card with a logo (seo/og.js draws the card, the logo is added here) and its PNG through a canvas, and
// widgets: file panes with copy / download, issue lists, the share-card preview and tabs.
//
// Design rules of this module:
// - View helpers return DOM or strings; pages own state. The only state touched here is localStorage under two keys.
// - Everything read back from storage is untrusted (old versions, hand edits, another app's bug): loadCard() copies
//   only known keys of the same type onto the demo card, so a corrupt entry degrades to defaults instead of crashing.
// - Strings are read through t() at call time; pages re-render on language switch, so no translated text is cached.
// - Side-effect import first: strings.js registers the sk.* keys before any t() below can run.
import './strings.js';
import { copyText, download, startApp, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { fmtBytes } from '../ui/files.js';
import { OG_HEIGHT, OG_THEMES, OG_WIDTH, ogCardSvg, svgDataUri } from '../seo/og.js';
import { DEMO_SITE, normalizeSite } from './kit.js';

// SVG path data for 24x24 stroke icons: strings, not files, so zero requests and the bundler inlines them.
export const LOGO = 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM21 21l-5.6-5.6M8.6 8.4 6.8 10.5l1.8 2.1M12.4 8.4l1.8 2.1-1.8 2.1';

addIcons({
  seokit: LOGO,
  sitemap: 'M10 3h4v4h-4zM3 17h4v4H3zM10 17h4v4h-4zM17 17h4v4h-4zM12 7v5M5 17v-3h14v3M12 12v5',
  robot: 'M5 9h14v10H5zM12 5v4M9 13h.01M15 13h.01M9 16h6M3 13v3M21 13v3M12 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  feed: 'M5 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  card: 'M3 5h18v14H3zM7 9h6M7 12h10M7 15h4',
  checkup: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
  ai: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  zip: 'M6 3h9l4 4v14H6zM11 3v2M11 7v2M11 11v2M10 15h2v3h-2z',
});

// Resolved hrefs of the pages (hidden anchors in the page HTML; the build rewrites their href).
// getAttribute, not a.href: .href resolves to an absolute URL (file:///...), which breaks relative links once the
// build publishes the pages elsewhere. '#' fallback: a missing anchor gives a dead link, not a startup crash.
export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

// One shell config for all three pages: identical header and nav; `current` marks the active tab (aria-current).
// offline:true shows the "works offline" badge, a claim the build audits (no network API allowed in the bundle).
export function startShell(current, onLang) {
  startApp({
    key: 'sk', name: 'sk.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-site'), label: 'sk.page.site', current: current === 'site' },
      { href: pageHref('pg-og'), label: 'sk.page.og', current: current === 'og' },
      { href: pageHref('pg-check'), label: 'sk.page.check', current: current === 'check' },
    ],
  });
}

// --- saved site and card ------------------------------------------------------------------------------------------

// The site is normalised by kit.js (seo/site.js normalizeSite), which owns the schema; null from an empty store gives
// the empty site. demoSite clones so the caller can mutate freely without corrupting the shared DEMO_SITE constant.
const SITE_KEY = 'sk-site', CARD_KEY = 'sk-card';
export const loadSite = () => normalizeSite(lsGet(SITE_KEY, null));
export const saveSite = (s) => lsSet(SITE_KEY, s);
export const demoSite = () => structuredClone(DEMO_SITE);

export const DEMO_CARD = {
  title: 'Five autumn teas from Guria', subtitle: 'Smoky, honeyed and malty: the autumn harvest', badge: 'Blog', brand: 'teahouse.example',
  theme: 'teal', from: '#0f766e', to: '#134e4a', accent: '#fbbf24', logo: '', logoPos: 'tr', logoSize: 120,
};
export const CARD_THEMES = [...Object.keys(OG_THEMES), 'custom'];
// Merge by whitelist: keys and types come from DEMO_CARD, so unknown keys are dropped and a string where a number is
// expected keeps the default. The logo must be a data:image URI: anything else (http URL, javascript:) is discarded,
// which keeps the card self-contained (exportable SVG, no remote fetch) and closes an injection path into <image href>.
export function loadCard() {
  const v = lsGet(CARD_KEY, null), c = structuredClone(DEMO_CARD);
  if (v && typeof v === 'object') for (const k of Object.keys(c)) if (v[k] != null && typeof v[k] === typeof c[k]) c[k] = v[k];
  if (!CARD_THEMES.includes(c.theme)) c.theme = 'teal';
  if (c.logo && !/^data:image\//.test(c.logo)) c.logo = '';
  return c;
}
export const saveCard = (c) => lsSet(CARD_KEY, c);

// Attribute escaping for the logo URI inside a double-quoted SVG attribute: & first (else the other entities would be
// double-escaped), then " (closes the attribute) and < (illegal in XML attributes). ' and > are harmless inside "...".
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// The card of seo/og.js plus the logo (an <image> with a data: URI, top right or bottom right).
// String splice before the last </svg> instead of DOM parsing: the card is generated text with exactly one root, so
// lastIndexOf is exact and avoids a parse/serialise round trip that could reformat the SVG. Size is clamped to the
// same 48..220 range as the slider, so a stored out-of-range value cannot push the logo off the 1200x630 canvas;
// margins 72/48/56 mirror the paddings of seo/og.js so the logo sits on the card grid.
export function cardSvg(c) {
  let svg = ogCardSvg({ title: c.title, subtitle: c.subtitle, badge: c.badge, brand: c.brand, theme: c.theme === 'custom' ? [c.from, c.to] : c.theme, accent: c.accent });
  if (c.logo && c.logoPos !== 'none') {
    const s = Math.max(48, Math.min(220, Math.round(c.logoSize) || 120));
    const x = OG_WIDTH - 72 - s, y = c.logoPos === 'br' ? OG_HEIGHT - 48 - s : 56;
    const img = `<image href="${attr(c.logo)}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet"/>`;
    const at = svg.lastIndexOf('</svg>');
    svg = svg.slice(0, at) + img + '\n' + svg.slice(at);
  }
  return svg;
}
export const cardUri = (c) => svgDataUri(cardSvg(c));

// PNG of an SVG string through a canvas (1200 × 630 by default).
// Rasterise through <img> + canvas. img.decode() waits for the SVG to load and rejects on a broken image, so errors
// surface as exceptions rather than a blank PNG. A data: URI SVG does not taint the canvas, so toBlob is allowed.
// Caveat: an SVG drawn into an image cannot load external resources; that is why the logo is embedded as data:.
// toBlob is callback-based and may yield null (e.g. canvas too large): wrapped in a Promise that rejects then.
export async function svgToPng(svg, w = OG_WIDTH, hgt = OG_HEIGHT) {
  const img = new Image();
  img.src = svgDataUri(svg);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(img, 0, 0, w, hgt);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'));
}

// --- widgets ------------------------------------------------------------------------------------------------------

// Module counter for unique ids: the ids only need to be unique per document, and pages re-render often, so a counter
// beats random ids (deterministic, no collision chance).
let gid = 0;
// Labelled group for non-input controls: the label names the group through aria-labelledby.
export function group(label, control, hint) {
  const id = 'sk-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, t(hint)) : null);
}

// Display cap of 200k chars: a <pre> with megabytes of text freezes layout. Copy and download always use the full text.
const MAX_SHOWN = 200000;
// A generated file: name, size, copy and download, the text in a scrollable block.
// Size measured as UTF-8 bytes via Blob, not text.length (UTF-16 code units): what the server will actually serve.
// The download keeps only the last path segment (jsonld/website.html -> website.html): browsers reject '/' in names.
// tabindex=0 on the <pre>: a scrollable region must be keyboard-focusable to be scrollable without a mouse.
export function filePane(f, note) {
  const size = new Blob([f.text]).size;
  const shown = f.text.length > MAX_SHOWN ? f.text.slice(0, MAX_SHOWN) + '\n…' : f.text;
  const copy = h('button', { type: 'button', class: 'ed-iconbtn', title: t('ap.copy'), 'aria-label': t('sk.copyFile', { name: f.name }), onclick: () => copyText(f.text) }, iconEl('copy'));
  const dl = h('button', { type: 'button', class: 'ed-iconbtn', title: t('ap.download'), 'aria-label': t('sk.downloadFile', { name: f.name }), onclick: () => download(f.text, f.name.split('/').pop(), f.mime + ';charset=utf-8') }, iconEl('download'));
  return h('section', { class: 'sk-file', dataset: { file: f.name } },
    h('div', { class: 'sk-file-h' }, iconEl('file'), h('span', { class: 'sk-file-name' }, f.name), h('span', { class: 'sk-file-size' }, fmtBytes(size)), h('span', { class: 'ed-spacer' }), copy, dl),
    note ? h('div', { class: 'ed-hint sk-file-note' }, note) : null,
    h('pre', { class: 'ap-pre sk-pre', tabindex: '0', 'aria-label': f.name }, shown));
}

// Issues [{ level: 'error' | 'warn' | 'info', text, field?, issue? }] as a list; `okText` when there are none.
// Sorted copy ([...items]) so the caller's array is not reordered. data-field / data-issue are stable hooks for e2e.js
// tests and never shown; x.code covers JSON-LD issues, x.issue meta issues.
export function issueList(items, okText) {
  if (!items.length) return h('div', { class: 'sk-ok' }, iconEl('check'), h('span', {}, okText || t('sk.noIssues')));
  const order = { error: 0, warn: 1, info: 2 };
  return h('ul', { class: 'sk-issues' }, [...items].sort((a, b) => order[a.level] - order[b.level]).map((x) => h('li', {
    class: 'sk-iss sk-iss-' + x.level, dataset: { field: x.field || '', issue: x.issue || x.code || '' },
  }, iconEl(x.level === 'info' ? 'info' : 'warn'), h('span', {}, x.text))));
}

// Text of a seo/meta.js metaIssues entry or of a checker issue.
// Message keys are built from issue codes (sk.iss.<field>.<issue>): the linters return codes, never prose, so the same
// result renders in every UI language.
export const metaIssueText = (x) => t(`sk.iss.${x.field}.${x.issue}`);
export const ldIssueText = (x) => t('sk.ld.' + x.code, { prop: x.prop || '' });

// How a link to the page looks in a chat or a social network: image, domain, title, description.
// alt="" on the image: it repeats the caption (decorative for assistive tech). <figure>/<figcaption> ties caption to
// image semantically. The image is only a data: URI or null (callers check), so nothing is fetched from the network.
export function sharePreview({ image, imageNote = '', domain = '', title = '', description = '', compact = false }) {
  const pic = image
    ? h('div', { class: 'sk-share-img' }, h('img', { src: image, alt: '', loading: 'lazy' }))
    : h('div', { class: 'sk-share-img sk-share-none' }, iconEl('image'), h('span', {}, imageNote || t('sk.share.noImage')));
  return h('figure', { class: 'sk-share' + (compact ? ' sk-share-compact' : '') }, pic,
    h('figcaption', { class: 'sk-share-txt' },
      h('span', { class: 'sk-share-domain' }, domain),
      h('strong', { class: 'sk-share-title' }, title || '—'),
      description ? h('span', { class: 'sk-share-desc' }, description) : null));
}
// Regex, not new URL(): tolerates partial input while the user types and never throws. Lowercased: hosts are
// case-insensitive, and the share card displays them that way.
export const hostOf = (u) => { const m = /^https?:\/\/([^/?#]+)/i.exec(String(u || '')); return m ? m[1].toLowerCase() : ''; };

// Tabs: [{ k, label, icon }]; arrow keys / Home / End move between them; onPick(k).
// WAI-ARIA tabs pattern with roving tabindex: only the selected tab is in the Tab order (tabIndex 0, others -1), arrows
// move between tabs. Selection follows focus (b.click() on arrow) - acceptable because panels render instantly.
// Modulo wrap makes ArrowRight on the last tab go to the first. All tabs control one shared #sk-panel.
export function tabs(list, current, onPick, label) {
  const bar = h('div', { class: 'sk-tabs', role: 'tablist', 'aria-label': t(label) });
  const paint = (k) => { for (const b of bar.children) { const on = b.dataset.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('sk-on', on); } };
  for (const x of list) {
    bar.append(h('button', { type: 'button', role: 'tab', id: 'sk-tab-' + x.k, class: 'sk-tab', dataset: { tab: x.k }, 'aria-controls': 'sk-panel', onclick: () => { paint(x.k); onPick(x.k); } },
      x.icon ? iconEl(x.icon) : null, h('span', {}, t(x.label))));
  }
  bar.addEventListener('keydown', (e) => {
    const btns = [...bar.children];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: btns.length - 1 }[e.key];
    if (j == null) return;
    e.preventDefault();
    const b = btns[(j + btns.length) % btns.length];
    b.focus(); b.click();
  });
  paint(current);
  return bar;
}

// Character counter hint for a text field (ok / long against a limit).
// Live length hint. trim(): leading/trailing spaces do not count toward what search engines show. aria-live=polite
// announces the count after typing pauses, without interrupting. `min` flags too-short non-empty values only.
export function counter(input, max, min = 0) {
  const out = h('span', { class: 'sk-count', 'aria-live': 'polite' });
  const paint = () => {
    const n = input.value.trim().length;
    out.textContent = t('sk.chars', { n, max });
    out.classList.toggle('sk-count-bad', n > max || (n > 0 && n < min));
  };
  input.addEventListener('input', paint);
  paint();
  return out;
}
