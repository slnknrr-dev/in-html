// funding-studio/blocks-a.js - page structure and content blocks: the page container (`campaign`: a campaign or the
// thank-you page), navigation, footer, section, columns, text, picture, quote, divider and the list of campaigns.
// Each block: registry entry (BT_A) and its CSS (CSS_A, shaken per used type).
// Block contract and rendering rules: see the header of blocks-b.js (same conventions here).
// The `campaign` block is special: it is the page itself (container, topLevel, transparent - it draws no wrapper of
// its own), holds the campaign's money settings, and appears only in the main region.
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { optList } from '../doc/schema.js';
import { normDay, normTime } from '../doc/model.js';
import { uiText } from '../doc/dict.js';
import { addItemBox, di, feature, fld, has, hrefAttr, icon, renderList, txt, ui } from '../doc/render.js';
import { uid } from '../util/id.js';
import { isObj, num, oneOf, round, str } from '../util/value.js';
import { METHODS, ISO_RE } from './base.js';
import { httpURL } from './model.js';
import { btnHTML, imgHTML, pageHref, progressHTML, toolsHTML } from './render.js';

const items = (b) => (isObj(b) && Array.isArray(b.items) ? b.items : []);

/* ---------- campaign (page container) ---------- */

// Page normalisation: pages never take block-level visibility props (anchor, device, langs) - hiding a page is done
// with `hidden` (draft). Currency must be ISO 4217-shaped, extra currencies deduplicated and capped at 8; methods
// limited to known ones; the live figures URL must be http(s) and its JSON paths are property paths only.
function normCampaign(out, b) {
  out.kind = oneOf(out.kind, ['campaign', 'thanks'], 'campaign');
  out.anchor = '';
  out.device = 'all';
  out.langs = null;
  const c = str(b.currency).trim().toUpperCase();
  out.currency = ISO_RE.test(c) ? c : 'EUR';
  const extra = Array.isArray(b.currencies) ? b.currencies : str(b.currencies).split(/[\s,;]+/);
  out.currencies = [...new Set(extra.map((x) => str(x).trim().toUpperCase()).filter((x) => ISO_RE.test(x) && x !== out.currency))].slice(0, 8);
  const m = Array.isArray(b.methods) ? b.methods.filter((x) => METHODS.includes(x)) : METHODS.slice();
  out.methods = [...new Set(m)];
  out.end = normDay(b.end);
  out.endTime = normTime(b.endTime) || '23:59';
  out.live = httpURL(b.live);
  out.livePath = /^[A-Za-z0-9_$.-]{0,120}$/.test(str(b.livePath)) ? str(b.livePath) : '';
  out.liveDonors = /^[A-Za-z0-9_$.-]{0,120}$/.test(str(b.liveDonors)) ? str(b.liveDonors) : '';
}

// Whole-hour UTC offsets for the campaign end (-12..+14 covers every zone's standard offset; half-hour zones round).
// U+2212 minus in labels for typographic consistency.
const TZ = [];
for (let h = -12; h <= 14; h++) TZ.push({ v: h, l: 'UTC' + (h >= 0 ? '+' : '−') + Math.abs(h) });

/* ---------- navigation ---------- */

function renderNav(b, ctx) {
  const E = ctx.edit;
  const logo = imgHTML(ctx, b.logo, { cls: 'fd-nav-logo', key: 'logo' });
  const name = fld(ctx, b, 'brand', 'plain', 'span', 'fd-nav-name', 'ph.brand');
  const home = ctx.route.home;
  const brandIn = logo + name;
  const brand = E ? `<span class="fd-nav-brand">${brandIn}</span>` : brandIn ? `<a class="fd-nav-brand" href="${escapeAttr(home ? pageHref(ctx, home) : '#top')}">${brandIn}</a>` : '';
  let lis = '';
  items(b).forEach((it, i) => {
    if (!isObj(it)) return;
    if (E) { lis += `<li${di(ctx, i)}>${fld(ctx, b, `items.${i}.label`, 'plain', 'span', 'fd-nav-a', 'ph.link')}</li>`; return; }
    const l = txt(ctx, it.label);
    if (!l) return;
    const h = hrefAttr(ctx, it.href);
    lis += `<li>${h ? `<a class="fd-nav-a"${h}>${l}</a>` : `<span class="fd-nav-a">${l}</span>`}</li>`;
  });
  const list = lis || E ? `<ul class="fd-nav-ul" role="list">${lis}${E && !items(b).length ? `<li>${addItemBox(ctx)}</li>` : ''}</ul>` : '';
  let cta = '';
  if (E) cta = `<span class="fd-btn fd-btn-sm fd-nav-cta">${icon(ctx, 'heart', 'fd-btn-ic')}${fld(ctx, b, 'cta', 'plain', 'span', '', 'ph.cta')}</span>`;
  else if (has(ctx, b.cta)) {
    const h = hrefAttr(ctx, b.ctaHref || '#donate');
    if (h) cta = `<a class="fd-btn fd-btn-sm fd-nav-cta"${h}>${icon(ctx, 'heart', 'fd-btn-ic')}<span>${txt(ctx, b.cta)}</span></a>`;
  }
  const tools = toolsHTML(ctx);
  return `<nav class="fd-nav${b.sticky ? ' fd-nav-sticky' : ''}" aria-label="${escapeAttr(uiText('navMain', ctx.edit ? ctx.uiLang : ctx.defaultLang, ctx.doc))}"><div class="fd-nav-in">${brand}${list}<div class="fd-nav-end">${tools}${cta}</div></div></nav>`;
}

/* ---------- footer ---------- */

function renderFooter(b, ctx) {
  const E = ctx.edit;
  const o = ctx.doc.org;
  let org = '';
  if (b.showOrg) {
    const parts = [];
    if (has(ctx, o.name)) parts.push(`<strong class="fd-foot-org">${txt(ctx, o.name)}</strong>`);
    if (has(ctx, o.address)) parts.push(`<span>${txt(ctx, o.address)}</span>`);
    if (o.regNo) parts.push(`<span>${ui(ctx, 'regNo')} ${escapeHTML(o.regNo)}</span>`);
    if (o.email) parts.push(E ? `<span>${escapeHTML(o.email)}</span>` : `<a href="mailto:${escapeAttr(o.email)}">${escapeHTML(o.email)}</a>`);
    if (o.website) parts.push(E ? `<span>${escapeHTML(o.website.replace(/^https?:\/\//, ''))}</span>` : `<a href="${escapeAttr(o.website)}" rel="noopener">${escapeHTML(o.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`);
    if (parts.length) org = `<div class="fd-foot-orgbox">${parts.join('')}</div>`;
  }
  const text = fld(ctx, b, 'text', 'rich', 'div', 'fd-foot-text fd-rich', 'ph.text');
  let lis = '';
  items(b).forEach((it, i) => {
    if (!isObj(it)) return;
    if (E) { lis += `<li${di(ctx, i)}>${fld(ctx, b, `items.${i}.label`, 'plain', 'span', '', 'ph.link')}</li>`; return; }
    const l = txt(ctx, it.label);
    const h = l ? hrefAttr(ctx, it.href) : '';
    if (l) lis += `<li>${h ? `<a${h}>${l}</a>` : `<span>${l}</span>`}</li>`;
  });
  const links = lis || E ? `<ul class="fd-foot-links" role="list">${lis}${E && !items(b).length ? `<li>${addItemBox(ctx)}</li>` : ''}</ul>` : '';
  const copy = fld(ctx, b, 'copy', 'plain', 'p', 'fd-foot-copy', 'ph.copy');
  if (!E && !org && !text && !links && !copy) return '';
  return `<div class="fd-foot-in fd-wrap"><div class="fd-foot-main">${org}${text}</div>${links}${copy}</div>`;
}

/* ---------- section and columns ---------- */

function renderSection(b, ctx) {
  const head = fld(ctx, b, 'eyebrow', 'plain', 'p', 'fd-eyebrow', 'ph.eyebrow') + fld(ctx, b, 'title', 'plain', 'h2', 'fd-h2', 'ph.title')
    + fld(ctx, b, 'lead', 'plain', 'p', 'fd-lead', 'ph.lead');
  const list = renderList(ctx, b.blocks, b.id + ':blocks', 'div', 'fd-sec-list', '', !ctx.edit);
  if (!ctx.edit && !list && !head) return '';
  return `<section class="fd-sec fd-sec-${b.width} fd-al-${b.align}"><div class="fd-wrap${b.width === 'narrow' ? ' fd-narrow' : b.width === 'wide' ? ' fd-wide' : ''}">${head ? `<div class="fd-sec-head">${head}</div>` : ''}${list}</div></section>`;
}

function renderColumns(b, ctx) {
  const cols = Array.isArray(b.cols) ? b.cols : [];
  let s = '';
  cols.forEach((c, i) => {
    const list = renderList(ctx, c.blocks, `${b.id}:cols.${i}.blocks`, 'div', 'fd-col', `--w:${num(c.w, 50, 5, 100)}`, false);
    s += list;
  });
  return `<div class="fd-cols fd-cols-${b.valign} fd-gap-${b.gap}">${s}</div>`;
}

/* ---------- text, picture, quote, divider ---------- */

const renderText = (b, ctx) => {
  const t = fld(ctx, b, 'html', 'rich', 'div', `fd-rich fd-text-${b.size}`, 'ph.text');
  return t;
};

function renderImage(b, ctx) {
  const img = imgHTML(ctx, b.att, { key: 'att', placeholder: true, alt: b.alt, cls: 'fd-img' });
  if (!img) return '';
  const cap = fld(ctx, b, 'caption', 'plain', 'figcaption', 'fd-cap', 'ph.caption');
  return `<figure class="fd-figure fd-ratio-${b.ratio.replace('/', '-')}${b.round ? ' fd-round' : ''}">${img}${cap}</figure>`;
}

function renderQuote(b, ctx) {
  const q = fld(ctx, b, 'text', 'plain', 'p', 'fd-quote-q', 'ph.quote');
  if (!q) return '';
  const photo = imgHTML(ctx, b.photo, { cls: 'fd-quote-photo', key: 'photo' });
  const who = fld(ctx, b, 'author', 'plain', 'strong', '', 'ph.author') + fld(ctx, b, 'role', 'plain', 'span', '', 'ph.role');
  return `<figure class="fd-quote">${icon(ctx, 'quote', 'fd-quote-ic')}<blockquote>${q}</blockquote>${who || photo ? `<figcaption>${photo}<span class="fd-quote-who">${who}</span></figcaption>` : ''}</figure>`;
}

const renderDivider = (b) => `<hr class="fd-hr fd-hr-${b.kind}">`;

/* ---------- campaigns list ---------- */

function renderCampaigns(b, ctx) {
  const head = fld(ctx, b, 'title', 'plain', 'h2', 'fd-h2', 'ph.title') + fld(ctx, b, 'lead', 'plain', 'p', 'fd-lead', 'ph.lead');
  const list = (ctx.edit ? ctx.doc.regions.main.filter((p) => p.type === 'campaign') : ctx.route.pages)
    .filter((p) => p.kind === 'campaign' && !(b.show === 'others' && ctx.camp && p.id === ctx.camp.id) && !(ctx.edit && p.hidden));
  let cards = '';
  for (const p of list) {
    const img = imgHTML(ctx, p.image, { cls: 'fd-card-img' });
    const title = txt(ctx, p.title) || escapeHTML(p.slug);
    const desc = has(ctx, p.metaDesc) ? `<p class="fd-card-desc">${txt(ctx, p.metaDesc)}</p>` : '';
    const href = pageHref(ctx, p);
    const label = has(ctx, b.cta) ? txt(ctx, b.cta) : ui(ctx, 'open');
    cards += `<article class="fd-card">${img ? `<div class="fd-card-media">${img}</div>` : ''}<div class="fd-card-body"><h3 class="fd-h3">${title}</h3>${desc}`
      + `${progressHTML(ctx, p, { size: 'sm', pct: false })}${btnHTML(ctx, label, href, { kind: 'secondary', cls: 'fd-btn-sm', icon: 'arrowRight' })}</div></article>`;
  }
  if (!cards && !ctx.edit) return '';
  return `${head ? `<div class="fd-sec-head">${head}</div>` : ''}<div class="fd-cards">${cards || `<div class="fd-empty">${ui(ctx, 'noCampaigns')}</div>`}</div>`;
}

/* ---------- registry ---------- */

export const BT_A = {
  campaign: {
    category: 'structure', icon: 'file', container: true, lists: ['blocks'], transparent: true, topLevel: true, region: 'main', palette: false,
    i18nFields: ['title', 'metaTitle', 'metaDesc'],
    defaults: () => ({
      kind: 'campaign', slug: '', title: {}, metaTitle: {}, metaDesc: {}, image: null,
      currency: 'EUR', currencies: [], goal: 10000, raised: 0, donors: 0, end: '', endTime: '23:59', tz: 0,
      methods: METHODS.slice(), live: '', livePath: '', liveDonors: '', blocks: [],
    }),
    schema: [
      { key: 'title', type: 'i18n', label: 'f.pageTitle' },
      { key: 'slug', type: 'pageslug', label: 'f.slug', hint: 'fh.slug' },
      { key: 'currency', type: 'currency', label: 'f.currency', when: { kind: 'campaign' } },
      { key: 'currencies', type: 'currencies', label: 'f.currencies', hint: 'fh.currencies', when: { kind: 'campaign' } },
      { key: 'goal', type: 'number', label: 'f.goal', min: 0, max: 1e9, step: 1, when: { kind: 'campaign' } },
      { key: 'raised', type: 'number', label: 'f.raised', min: 0, max: 1e9, step: 0.01, hint: 'fh.raised', when: { kind: 'campaign' } },
      { key: 'donors', type: 'number', label: 'f.donors', min: 0, max: 1e8, step: 1, when: { kind: 'campaign' } },
      { key: 'end', type: 'day', label: 'f.end', when: { kind: 'campaign' } },
      { key: 'endTime', type: 'time', label: 'f.endTime', when: { kind: 'campaign' } },
      { key: 'tz', type: 'select', label: 'f.tz', options: TZ, noSeg: true, when: { kind: 'campaign' } },
      { key: 'methods', type: 'methods', label: 'f.methods', hint: 'fh.methods', when: { kind: 'campaign' } },
      { key: 'image', type: 'att', label: 'f.pageImage', accept: 'image/', hint: 'fh.pageImage' },
      { key: 'metaTitle', type: 'i18n', label: 'f.metaTitle' },
      { key: 'metaDesc', type: 'i18n', label: 'f.metaDesc', multiline: true, rows: 3 },
      { key: 'live', type: 'text', inputType: 'url', label: 'f.live', hint: 'fh.live', placeholderText: 'https://', when: { kind: 'campaign' } },
      { key: 'livePath', type: 'text', label: 'f.livePath', placeholderText: 'raised', when: { kind: 'campaign' } },
      { key: 'liveDonors', type: 'text', label: 'f.liveDonors', placeholderText: 'donors', when: { kind: 'campaign' } },
    ],
    normalize: normCampaign,
    render: (b, ctx) => renderList(ctx, b.blocks, b.id + ':blocks', 'div', 'fd-page-in', '', !ctx.edit),
  },
  nav: {
    category: 'structure', icon: 'menu', full: true, region: 'header', regionStart: true,
    i18nFields: ['brand', 'cta'], itemI18nFields: ['label'], itemLabel: 'label',
    defaults: () => ({ brand: {}, logo: null, items: [], cta: {}, ctaHref: '#donate', sticky: true }),
    schema: [
      { key: 'logo', type: 'att', label: 'f.logo', accept: 'image/' },
      { key: 'ctaHref', type: 'text', label: 'f.ctaHref', suggest: 'anchors', placeholder: 'pl.href' },
      { key: 'sticky', type: 'checkbox', label: 'f.sticky' },
    ],
    itemSchema: [{ key: 'label', type: 'i18n', label: 'f.label' }, { key: 'href', type: 'text', label: 'f.href', suggest: 'anchors', placeholder: 'pl.href' }],
    itemDefaults: () => ({ id: uid(), label: {}, href: '' }),
    render: renderNav,
  },
  footer: {
    category: 'structure', icon: 'home', full: true, region: 'footer',
    i18nFields: ['copy'], richFields: { text: 'rich' }, itemI18nFields: ['label'], itemLabel: 'label',
    defaults: () => ({ text: {}, copy: {}, showOrg: true, items: [] }),
    schema: [{ key: 'showOrg', type: 'checkbox', label: 'f.showOrg', hint: 'fh.showOrg' }],
    itemSchema: [{ key: 'label', type: 'i18n', label: 'f.label' }, { key: 'href', type: 'text', label: 'f.href', suggest: 'anchors', placeholder: 'pl.href' }],
    itemDefaults: () => ({ id: uid(), label: {}, href: '' }),
    render: renderFooter,
  },
  section: {
    category: 'layout', icon: 'file', container: true, lists: ['blocks'], full: true, dropEmpty: true,
    i18nFields: ['eyebrow', 'title', 'lead'],
    defaults: () => ({ eyebrow: {}, title: {}, lead: {}, tone: 'auto', width: 'normal', align: 'left', blocks: [] }),
    schema: [
      { key: 'tone', type: 'select', label: 'f.tone', options: optList('auto', 'muted', 'accent', 'dark') },
      { key: 'width', type: 'select', label: 'f.width', options: optList('narrow', 'normal', 'wide') },
      { key: 'align', type: 'select', label: 'f.align', options: optList('left', 'center') },
    ],
    render: renderSection,
  },
  columns: {
    category: 'layout', icon: 'chart', container: true, lists: ['cols.*.blocks'], listMax: 3, dropEmpty: true,
    defaults: () => ({ cols: [{ id: uid(), w: 50, blocks: [] }, { id: uid(), w: 50, blocks: [] }], gap: 'normal', valign: 'top' }),
    schema: [
      { key: 'gap', type: 'select', label: 'f.gap', options: optList('normal', 'wide') },
      { key: 'valign', type: 'select', label: 'f.valign', options: optList('top', 'center') },
    ],
    normalize: (out) => { for (const c of out.cols) c.w = round(num(c.w, 50, 5, 100), 1); },
    render: renderColumns,
  },
  text: {
    category: 'content', icon: 'file', richFields: { html: 'rich' },
    defaults: () => ({ html: {}, size: 'normal' }),
    schema: [{ key: 'size', type: 'select', label: 'f.size', options: optList('normal', 'large') }],
    render: renderText,
  },
  image: {
    category: 'content', icon: 'image', i18nFields: ['caption', 'alt'],
    defaults: () => ({ att: null, caption: {}, alt: {}, ratio: 'auto', round: false }),
    schema: [
      { key: 'att', type: 'att', label: 'f.image', accept: 'image/' },
      { key: 'alt', type: 'i18n', label: 'f.alt', hint: 'fh.alt' },
      { key: 'ratio', type: 'select', label: 'f.ratio', options: optList('auto', '16/9', '4/3', '1/1', '3/1'), noSeg: true },
      { key: 'round', type: 'checkbox', label: 'f.round' },
    ],
    render: renderImage,
  },
  quote: {
    category: 'content', icon: 'quote', i18nFields: ['text', 'author', 'role'],
    defaults: () => ({ text: {}, author: {}, role: {}, photo: null }),
    schema: [{ key: 'photo', type: 'att', label: 'f.photo', accept: 'image/' }],
    render: renderQuote,
  },
  divider: {
    category: 'layout', icon: 'menu', keepEmpty: true,
    defaults: () => ({ kind: 'line' }),
    schema: [{ key: 'kind', type: 'select', label: 'f.kind', options: optList('line', 'space', 'dots') }],
    render: renderDivider,
  },
  campaigns: {
    category: 'campaign', icon: 'target', i18nFields: ['title', 'lead', 'cta'],
    defaults: () => ({ title: {}, lead: {}, cta: {}, show: 'others' }),
    schema: [{ key: 'show', type: 'select', label: 'f.showCamps', options: optList('others', 'all') }],
    render: renderCampaigns,
  },
};

export const CSS_A = {
  campaign: '',
  nav: `
.fd-nav{background:var(--fd-bg);border-bottom:1px solid var(--fd-border)}
.fd-nav-sticky{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--fd-bg) 92%,transparent);backdrop-filter:saturate(1.4) blur(10px)}
.fd-root[data-mode=edit] .fd-nav-sticky{position:relative}
.fd-nav-in{display:flex;align-items:center;gap:12px 28px;max-width:var(--fd-w);margin-inline:auto;padding:12px var(--fd-gut);min-height:60px}
.fd-nav-brand{display:inline-flex;align-items:center;gap:10px;font-family:var(--fd-font-h);font-weight:700;font-size:1.15em;color:var(--fd-text);text-decoration:none;min-width:0}
.fd-nav-logo{height:34px;width:auto;display:block}
.fd-nav-ul{display:flex;flex-wrap:wrap;gap:4px 18px;list-style:none;margin:0 0 0 auto;padding:0}
.fd-nav-a{color:var(--fd-text);text-decoration:none;font-size:.95em;padding:6px 2px;display:inline-block}
.fd-nav-a:hover{color:var(--fd-link)}
.fd-nav-end{display:flex;align-items:center;gap:10px;margin-inline-start:auto}
.fd-nav-ul+.fd-nav-end{margin-inline-start:0}
@container fd (max-width:700px){.fd-nav-in{flex-wrap:wrap;padding-block:10px}.fd-nav-ul{order:3;flex-basis:100%;margin:0;gap:2px 14px;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none}.fd-nav-ul::-webkit-scrollbar{display:none}.fd-nav-a{white-space:nowrap}.fd-nav-cta span{display:none}.fd-nav-cta{padding-inline:12px}}
`,
  footer: `
.fd-footer>.fd-b-footer{background:var(--fd-surface);border-top:1px solid var(--fd-border);color:var(--fd-muted);font-size:.93em}
.fd-foot-in{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px 40px;padding-block:clamp(28px,4cqi,48px)}
.fd-foot-orgbox{display:flex;flex-direction:column;gap:3px;margin-bottom:10px}
.fd-foot-org{color:var(--fd-text);font-family:var(--fd-font-h);font-size:1.08em}
.fd-foot-text>:first-child{margin-top:0}
.fd-foot-links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.fd-footer a{color:var(--fd-text)}
.fd-foot-copy{grid-column:1/-1;margin:0;padding-top:14px;border-top:1px solid var(--fd-border);font-size:.92em}
@container fd (max-width:600px){.fd-foot-in{grid-template-columns:minmax(0,1fr)}}
`,
  section: `
.fd-sec{padding-block:var(--fd-sec)}
.fd-sec-head{margin-bottom:clamp(18px,2.6cqi,32px);max-width:46em}
.fd-al-center .fd-sec-head{margin-inline:auto;text-align:center}
.fd-sec-list>.fd-b+.fd-b{margin-top:var(--fd-bs)}
`,
  columns: `
.fd-cols{display:flex;gap:var(--fd-gap)}
.fd-cols>.fd-col{flex:var(--w,50) 1 0%;min-width:0}
.fd-col>.fd-b+.fd-b{margin-top:var(--fd-bs)}
.fd-cols-center{align-items:center}
.fd-gap-wide{gap:calc(var(--fd-gap) * 2)}
@container fd (max-width:900px){.fd-cols{flex-direction:column}.fd-cols>.fd-col{flex:none}}
`,
  text: `
.fd-text-large{font-size:1.16em}
`,
  image: `
.fd-figure{margin:0}
.fd-figure .fd-img{display:block;width:100%;height:auto;border-radius:var(--fd-radius)}
.fd-ratio-16-9 .fd-img{aspect-ratio:16/9;object-fit:cover}
.fd-ratio-4-3 .fd-img{aspect-ratio:4/3;object-fit:cover}
.fd-ratio-1-1 .fd-img{aspect-ratio:1/1;object-fit:cover}
.fd-ratio-3-1 .fd-img{aspect-ratio:3/1;object-fit:cover}
.fd-round .fd-img{border-radius:50%;aspect-ratio:1/1;object-fit:cover;max-width:320px;margin-inline:auto}
.fd-cap{margin-top:8px;color:var(--fd-muted);font-size:.9em}
`,
  quote: `
.fd-quote{margin:0;padding:clamp(18px,3cqi,32px);background:var(--fd-surface);border-radius:var(--fd-radius);border-inline-start:4px solid var(--fd-accent)}
.fd-quote-ic{width:28px;height:28px;color:var(--fd-accent)}
.fd-quote blockquote{margin:6px 0 0}
.fd-quote-q{font-family:var(--fd-font-h);font-size:1.22em;line-height:1.45;margin:0}
.fd-quote figcaption{display:flex;align-items:center;gap:12px;margin-top:14px}
.fd-quote-photo{width:48px;height:48px;border-radius:50%;object-fit:cover}
.fd-quote-who{display:flex;flex-direction:column;font-size:.95em}
.fd-quote-who span{color:var(--fd-muted)}
`,
  divider: `
.fd-hr{border:0;margin:0}
.fd-hr-line{border-top:1px solid var(--fd-border)}
.fd-hr-space{height:clamp(16px,3cqi,40px)}
.fd-hr-dots{height:12px;background:radial-gradient(circle,var(--fd-muted) 1.5px,transparent 2px) center/18px 12px repeat-x;max-width:120px;margin-inline:auto;opacity:.7}
`,
  campaigns: `
.fd-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--fd-gap)}
.fd-card{display:flex;flex-direction:column;background:var(--fd-surface);border:1px solid var(--fd-border);border-radius:var(--fd-radius);overflow:hidden}
.fd-card-media .fd-card-img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.fd-card-body{display:flex;flex-direction:column;gap:12px;padding:18px;flex:1}
.fd-card-body .fd-btn{align-self:flex-start;margin-top:auto}
.fd-card-desc{margin:0;color:var(--fd-muted);font-size:.95em}
.fd-h3{font-family:var(--fd-font-h);font-size:1.18em;line-height:1.3;margin:0}
`,
};

export const CLASS_OWNERS_A = [
  [/\.fd-nav/, 'nav'], [/\.fd-foot/, 'footer'], [/\.fd-sec/, 'section'], [/\.fd-cols?\b/, 'columns'], [/\.fd-figure|\.fd-ratio|\.fd-round|\.fd-cap/, 'image'],
  [/\.fd-quote/, 'quote'], [/\.fd-hr/, 'divider'], [/\.fd-cards?\b|\.fd-card-/, 'campaigns'],
];

export { feature };
