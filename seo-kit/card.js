// seo-kit/card.js - the Open Graph card designer: title, subtitle, badge, brand line, colour themes or own brand
// colours, an accent stripe and a logo (an image file kept as a data: URI), drawn as the 1200 × 630 SVG of
// seo/og.js; a live preview at full proportions and as it would appear in a large and a compact share card;
// exports as SVG, PNG (canvas) and the matching meta tags. Lint: text cut by the layout, low contrast of the
// white text on the chosen colours.
//
// State model: one mutable card object C, loaded once and persisted with a 250ms debounce (localStorage writes are
// synchronous and serialise the logo data URI, so writing per keystroke would jank). Repaint is debounced at 60ms:
// short enough to feel live, long enough to coalesce bursts from a dragged slider or colour picker.
// Controls mutate C and call changed(); paint() is the single place that derives the SVG, lint and previews from C.
// Structural changes (pick from page, reset) call render() to rebuild controls with the new values.
import { CARD_THEMES, DEMO_CARD, cardSvg, cardUri, counter, group, hostOf, issueList, loadCard, loadSite, saveCard, sharePreview, startShell, svgToPng } from './common.js';
import { abs, normPath, pageUrl } from './kit.js';
import { button, card, colorInput, copyText, download, dropZone, field, range, seg, select, t, textInput, toast } from '../ui/app.js';
import { $, debounce, h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { OG_HEIGHT, OG_THEMES, OG_WIDTH, ogCacheName, wrapText } from '../seo/og.js';
import { contrastRatio } from '../color/color.js';
import { escapeAttr } from '../html/escape.js';

const C = loadCard();
const site = loadSite();
const save = debounce(() => saveCard(C), 250);
const changed = () => { save(); paintSoon(); };
const paintSoon = debounce(() => paint(), 60);

const main = $('#main');
main.classList.add('sk-og');
let els = {};

// 2 MB cap: the logo is stored base64 (about +33%) in localStorage (typically 5 MB per origin) and embedded into every
// exported SVG; bigger files would overflow storage silently.
const MAX_LOGO = 2 * 1024 * 1024;

function render() {
  main.textContent = '';
  els = {};
  els.stage = h('div', { class: 'sk-og-stage', id: 'sk-card', role: 'img', 'aria-label': t('sk.og.previewAlt') });
  els.meta = h('div', { class: 'sk-og-meta' });
  els.warn = h('div', { class: 'sk-warns' });
  els.shares = h('div', { class: 'sk-og-shares' });
  els.name = h('code', { class: 'sk-mono sk-og-name' });
  const exp = h('div', { class: 'ap-actions' },
    button('sk.og.svg', 'download', exportSvg, 'primary'), button('sk.og.png', 'image', exportPng),
    button('sk.og.copySvg', 'copy', () => copyText(cardSvg(C))), button('sk.og.copyMeta', 'copy', () => copyText(metaSnippet(), t('sk.og.metaCopied'))));
  const right = h('div', { class: 'sk-col sk-og-right' },
    h('div', { class: 'sk-og-frame ap-surface ap-plain' }, els.stage),
    h('div', { class: 'sk-og-foot' }, els.meta, h('span', { class: 'ed-spacer' }), els.name),
    els.warn,
    card('sk.og.export', exp, h('div', { class: 'ed-hint' }, t('sk.og.h.export'))),
    card('sk.og.shares', els.shares));
  main.append(h('div', { class: 'sk-og-work' }, h('div', { class: 'sk-col sk-og-left' }, textCard(), styleCard(), logoCard()), right));
  paint();
}

// --- controls ------------------------------------------------------------------------------------------------

// "From page": fills the card from a page of the site saved on the site page, so card and meta tags agree.
// wrapText(..., 44, 1)[0]: the subtitle line holds about 44 characters on the card; the first wrapped line is taken.
// The badge keeps the user's text on posts and is cleared on non-posts. saveCard immediately (not debounced) because
// render() follows and rebuilds inputs from C.
function textCard() {
  const title = textInput(C.title, (v) => { C.title = v; changed(); }, { multiline: true, rows: 2, id: 'sk-og-title' });
  const fromPage = select([{ v: '', l: 'sk.og.fromPagePick' }, ...site.pages.map((p, i) => ({ v: String(i), l: '=' + normPath(site, p.path) + (p.title ? ' — ' + p.title : '') }))], '', (v) => {
    const p = site.pages[+v];
    if (v === '' || !p) return;
    C.title = p.title || site.name;
    C.subtitle = p.description ? wrapText(p.description, 44, 1)[0] : '';
    C.brand = hostOf(pageUrl(site, p)) || site.name;
    C.badge = p.post ? C.badge || 'Blog' : '';
    saveCard(C); render();
  });
  return card('sk.og.text', h('div', { class: 'ed-fields' },
    field('sk.og.fromPage', fromPage, 'sk.og.h.fromPage'),
    // Hand-built field instead of field(): the counter must sit in the hint under the textarea. 60 chars: about what
    // platforms show of og:title before cutting.
    h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'sk-og-title' }, t('sk.og.title')), title, h('div', { class: 'ed-hint' }, counter(title, 60))),
    field('sk.og.subtitle', textInput(C.subtitle, (v) => { C.subtitle = v; changed(); })),
    h('div', { class: 'sk-grid2' },
      field('sk.og.badge', textInput(C.badge, (v) => { C.badge = v; changed(); }, { maxlength: 60 })),
      field('sk.og.brand', textInput(C.brand, (v) => { C.brand = v; changed(); }, { maxlength: 80 })))));
}

// Custom colour inputs exist only for the 'custom' theme; the accent picker is always shown.
function styleCard() {
  const custom = h('div', { class: 'sk-grid3' });
  const paintCustom = () => {
    custom.textContent = '';
    if (C.theme === 'custom') custom.append(field('sk.og.from', colorInput(C.from, (v) => { C.from = v; changed(); })), field('sk.og.to', colorInput(C.to, (v) => { C.to = v; changed(); })));
    custom.append(field('sk.og.accent', colorInput(C.accent, (v) => { C.accent = v; changed(); })));
  };
  paintCustom();
  // Radio group pattern: one tab stop (roving tabindex), arrows move AND select (b.click()), as native radios do.
  // Up/Down are accepted too because the swatches wrap onto several rows.
  const themes = h('div', { class: 'sk-swatches', role: 'radiogroup', 'aria-label': t('sk.og.theme') });
  const paintThemes = () => { for (const b of themes.children) { const on = b.dataset.k === C.theme; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('sk-on', on); } };
  for (const k of CARD_THEMES) {
    const [a, b] = k === 'custom' ? [C.from, C.to] : OG_THEMES[k];
    themes.append(h('button', {
      type: 'button', role: 'radio', class: 'sk-swatch', dataset: { k }, title: t('sk.og.th.' + k), 'aria-label': t('sk.og.th.' + k),
      style: { background: `linear-gradient(135deg, ${a}, ${b})` }, onclick: () => { C.theme = k; changed(); paintThemes(); paintCustom(); },
    }, k === 'custom' ? iconEl('palette') : null));
  }
  themes.addEventListener('keydown', (e) => {
    const btns = [...themes.children], i = btns.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const b = btns[(i + step + btns.length) % btns.length]; b.focus(); b.click();
  });
  paintThemes();
  // Reset keeps the logo: re-uploading a file is the costly part, the text and colours are cheap to redo.
  const reset = button('sk.og.reset', 'undo', () => { Object.assign(C, structuredClone(DEMO_CARD), { logo: C.logo }); saveCard(C); render(); });
  reset.classList.add('ed-sm');
  return card('sk.og.style', h('div', { class: 'ed-fields' }, group('sk.og.theme', themes), custom, h('div', { class: 'ap-actions' }, reset)));
}

function logoCard() {
  const box = h('div', { class: 'ed-fields' });
  const paintLogo = () => {
    box.textContent = '';
    if (C.logo) {
      const del = button('sk.og.logoRemove', 'trash', () => { C.logo = ''; changed(); paintLogo(); });
      del.classList.add('ed-sm');
      box.append(h('div', { class: 'sk-logo-row' }, h('img', { class: 'sk-logo-thumb', src: C.logo, alt: t('sk.og.logo') }), del));
      box.append(group('sk.og.logoPos', seg([{ v: 'tr', l: 'sk.og.pos.tr' }, { v: 'br', l: 'sk.og.pos.br' }, { v: 'none', l: 'sk.og.pos.none' }], C.logoPos, (v) => { C.logoPos = v; changed(); }, 'sk.og.logoPos')));
      box.append(field('sk.og.logoSize', range({ min: 48, max: 220, step: 4, value: C.logoSize, unit: ' px', onInput: (v) => { C.logoSize = v; changed(); } })));
    }
    box.append(dropZone({ accept: 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif', label: 'sk.og.logoDrop', onFiles: ([f]) => readLogo(f, paintLogo) }));
  };
  paintLogo();
  return card('sk.og.logo', box);
}

// MIME check rejects non-images early (the accept attribute of the drop zone is only a hint, drag-drop bypasses it).
// readAsDataURL: the logo must be a data: URI to live inside the SVG (see common.js cardSvg/svgToPng).
// A newly added logo with position 'none' would be invisible, so position falls back to top right.
function readLogo(f, done) {
  if (!f || !/^image\//.test(f.type)) { toast(t('sk.og.logoBad'), 'warn'); return; }
  if (f.size > MAX_LOGO) { toast(t('sk.og.logoBig'), 'warn'); return; }
  const r = new FileReader();
  r.onload = () => { C.logo = String(r.result); if (C.logoPos === 'none') C.logoPos = 'tr'; changed(); done(); };
  r.onerror = () => toast(t('ap.fileErr', { name: f.name, msg: String(r.error && r.error.message) }), 'error');
  r.readAsDataURL(f);
}

// --- preview and lint ----------------------------------------------------------------------------------------

// The two gradient stops actually painted: the user's pair or the theme's pair from seo/og.js.
function colours() { return C.theme === 'custom' ? [C.from, C.to] : OG_THEMES[C.theme]; }

// innerHTML of SVG we generated ourselves: text fields are escaped inside seo/og.js and the logo URI by common.js attr.
// width/height attributes are removed so CSS (.sk-og-stage svg) scales it; aria-hidden because the stage itself
// carries role=img plus a label, and SVG text read out word by word would be noise.
function paint() {
  const svg = cardSvg(C);
  els.stage.innerHTML = svg;
  const s = els.stage.querySelector('svg');
  if (s) { s.removeAttribute('width'); s.removeAttribute('height'); s.setAttribute('aria-hidden', 'true'); }
  els.name.textContent = ogCacheName({ ...C, theme: C.theme === 'custom' ? [C.from, C.to] : C.theme });
  els.meta.replaceChildren(h('span', { class: 'sk-chip' }, `${OG_WIDTH} × ${OG_HEIGHT}`), h('span', { class: 'sk-chip' }, '1.91 : 1'));
  // Lint
  const w = [];
  // Lint mirrors the renderer: the title is wrapped at the same 26 characters x 3 lines as seo/og.js draws it, so a
  // trailing ellipsis that the user did not type means the layout cut the text.
  const lines = wrapText(C.title, 26, 3);
  if (!C.title.trim()) w.push({ level: 'error', text: t('sk.og.w.noTitle') });
  else if (lines.length && lines[lines.length - 1].endsWith('…') && !C.title.trim().endsWith('…')) w.push({ level: 'warn', text: t('sk.og.w.cut') });
  if (C.subtitle && wrapText(C.subtitle, 44, 1)[0].endsWith('…') && !C.subtitle.trim().endsWith('…')) w.push({ level: 'info', text: t('sk.og.w.subCut') });
  // Contrast of the white card text against both gradient stops; the worse end decides. Threshold 3:1 = WCAG AA for
  // large text, which the card title is. isFinite guards an unparsable custom colour.
  const r = Math.min(...colours().map((c) => contrastRatio('#ffffff', c)));
  if (Number.isFinite(r) && r < 3) w.push({ level: 'warn', text: t('sk.og.w.contrast', { r: r.toFixed(1) }) });
  if (!C.brand.trim()) w.push({ level: 'info', text: t('sk.og.w.noBrand') });
  els.warn.replaceChildren(issueList(w, t('sk.og.ok')));
  // Share cards
  const uri = cardUri(C);
  // Share previews prefer the matching page's real title/description (what a platform would read from the tags);
  // the domain is the brand when it looks like a host, else the site base host.
  const p = site.pages.find((x) => x.title && x.title.trim() === C.title.trim());
  const domain = (C.brand.includes('.') ? C.brand : hostOf(site.base)) || '';
  els.shares.replaceChildren(
    h('div', { class: 'ed-label' }, t('sk.og.large')),
    sharePreview({ image: uri, domain, title: (p && p.title) || C.title, description: (p && p.description) || C.subtitle }),
    h('div', { class: 'ed-label sk-mt' }, t('sk.og.compact')),
    sharePreview({ image: uri, domain, title: (p && p.title) || C.title, description: (p && p.description) || C.subtitle, compact: true }));
}

// --- export --------------------------------------------------------------------------------------------------

// File name = ogCacheName (theme + hash of the text): a changed card gets a new name, so CDNs and platform caches,
// which key og:image by URL, cannot serve the stale image.
const fileBase = () => ogCacheName({ ...C, theme: C.theme === 'custom' ? [C.from, C.to] : C.theme }).replace(/\.png$/, '');
function exportSvg() { download(cardSvg(C), fileBase() + '.svg', 'image/svg+xml'); }
async function exportPng() {
  try { download(await svgToPng(cardSvg(C)), fileBase() + '.png', 'image/png'); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
// og:image tags for the card stored as /og.png (the path set on the site page).
// Absolute URL via abs(site, ...): og:image must be absolute, platforms do not resolve relative paths. Dimensions are
// declared so crawlers can lay out the card before fetching the image. All interpolations go through escapeAttr.
function metaSnippet() {
  const url = abs(site, site.meta.image || '/og.png');
  return [`<meta property="og:image" content="${escapeAttr(url)}">`, `<meta property="og:image:width" content="${OG_WIDTH}">`, `<meta property="og:image:height" content="${OG_HEIGHT}">`,
    `<meta property="og:image:alt" content="${escapeAttr(C.title)}">`, '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:image" content="${escapeAttr(url)}">`].join('\n') + '\n';
}

startShell('og', () => render());
render();
