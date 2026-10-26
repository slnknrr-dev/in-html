// funding-studio/render.js - page skeleton and routing, block wrapper hooks, the campaign context of blocks and the
// shared pieces of markup (money, progress bars, buttons, pictures, page tools).
//
// Render modes (ctx.route.mode):
//   edit   the edited page only (studio: renderOpts { page })
//   hash   single file: every published page in one document (<main data-fd-page> each, routes '#/<slug>', feature
//          'pages'); a site with one page renders without a router
//   file   one page per HTML file (static archive, backend): export options { route: 'file', page, depth }; links
//          between pages are relative ('./thanks/', '../', '../thanks/')
// Export options also understood: api { base, site } (backend endpoints, feature 'api'), stats { <campaign id>:
// { raised, donors, matched } } (live figures baked in by the backend).
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { langName } from '../i18n/lang.js';
import { pickText, htmlToText } from '../i18n/text.js';
import { uiText } from '../doc/dict.js';
import { attOf, attSrc, imgAttr, isImage } from '../doc/attach.js';
import { altAttr, feature, grp, icon, renderList, renderRegion, ui } from '../doc/render.js';
import { formatMoney } from '../payments/money.js';
import { isObj, num, own, str } from '../util/value.js';
import { homePage, livePages, pageById, pagesOf, thanksPage } from './model.js';

/* ---------- context ---------- */

export function makeCtx(ctx, opts) {
  const mode = ctx.edit ? 'edit' : opts.route === 'file' ? 'file' : 'hash';
  const pages = livePages(ctx.doc);
  let page = null;
  if (ctx.edit) page = pageById(ctx.doc, opts.page) || pagesOf(ctx.doc)[0] || null;
  else if (mode === 'file') page = pageById(ctx.doc, opts.page) || homePage(ctx.doc);
  const home = homePage(ctx.doc);
  ctx.route = { mode, page, home, pages, depth: mode === 'file' ? (page && home && page.id === home.id ? 0 : 1) : 0 };
  ctx.api = !ctx.edit && isObj(opts.api) && typeof opts.api.base === 'string' ? { base: opts.api.base, site: str(opts.api.site) || ctx.doc.id } : null;
  ctx.stats = isObj(opts.stats) ? opts.stats : null;
  ctx.preview = !!opts.preview;
  ctx.camp = null;
  ctx.pageOf = new Map();
  Object.assign(ctx.use, { camps: new Set(), methods: new Set(), dons: [], tools: null, impact: new Map(), walls: [], shareQR: false, thanksBlock: false });
}

// Block id -> page id (link targets of other pages in file mode).
export function planDoc(ctx) {
  for (const p of pagesOf(ctx.doc)) {
    const visit = (list) => { for (const b of Array.isArray(list) ? list : []) { if (!isObj(b)) continue; ctx.pageOf.set(b.id, p.id); if (Array.isArray(b.blocks)) visit(b.blocks); if (Array.isArray(b.cols)) for (const c of b.cols) visit(c && c.blocks); } };
    visit(p.blocks);
  }
}

/* ---------- pages and links ---------- */

// URL of a page in the current render ('' in edit mode).
export function pageHref(ctx, page) {
  if (!page) return '';
  const r = ctx.route;
  const home = r.home && page.id === r.home.id;
  if (r.mode === 'edit') return '#/' + (home ? '' : page.slug);
  if (r.mode === 'hash') return home ? '#/' : '#/' + page.slug;
  const up = r.depth ? '../' : './';
  return home ? up : up + page.slug + '/';
}

// '#/<slug>[#anchor]' links of rich text and link fields -> URL of that page; null when there is no such page.
export function routeHref(ctx, path, anchor) {
  const p = path ? ctx.route.pages.find((x) => x.slug === path) : ctx.route.home;
  if (!p) return null;
  const href = pageHref(ctx, p);
  return anchor ? (ctx.route.mode === 'hash' ? '#' + anchor : href + '#' + anchor) : href;
}

// In-page targets on another page (file mode): that page's URL + the fragment.
export function placeHref(ctx, href, bid) {
  if (ctx.route.mode !== 'file' || !bid) return href;
  const pid = ctx.pageOf.get(bid);
  if (!pid || (ctx.route.page && pid === ctx.route.page.id)) return href;
  const p = pageById(ctx.doc, pid);
  return p && !p.hidden ? pageHref(ctx, p) + href : href;
}

/* ---------- the campaign of a block ---------- */

// b.camp names a campaign page; '' = the page the block is on (the home campaign for the header, footer and the
// thank-you page).
export function campOf(ctx, b) {
  const want = b && typeof b.camp === 'string' && b.camp ? pageById(ctx.doc, b.camp) : null;
  if (want && want.kind === 'campaign') return want;
  if (ctx.camp && ctx.camp.kind === 'campaign') return ctx.camp;
  return homePage(ctx.doc) && homePage(ctx.doc).kind === 'campaign' ? homePage(ctx.doc) : (pagesOf(ctx.doc).find((p) => p.kind === 'campaign') || null);
}

// Figures of a campaign: the owner's numbers plus live ones baked in by the backend.
export function campStats(ctx, c) {
  if (!c) return { raised: 0, donors: 0, goal: 0, cur: 'EUR', pct: 0, end: null, days: null, ended: false };
  const live = ctx.stats && isObj(ctx.stats[c.id]) ? ctx.stats[c.id] : {};
  const raised = num(c.raised, 0) + num(live.raised, 0);
  const donors = Math.round(num(c.donors, 0) + num(live.donors, 0));
  const goal = num(c.goal, 0);
  const end = endTime(c);
  const now = Date.now();
  const days = end != null ? Math.max(0, Math.ceil((end - now) / 86400000)) : null;
  return { raised, donors, goal, cur: c.currency, pct: goal > 0 ? Math.min(100, (raised / goal) * 100) : 0, end, days, ended: end != null && end <= now, matched: num(live.matched, 0) };
}

// End of a campaign as a UTC timestamp: its end day at endTime in its UTC offset; null without an end day.
// The campaign's own offset (tz, hours) - not the visitor's or the server's timezone - so "ends 31 Dec 23:59" means
// the same instant for everyone; countdowns then run on absolute time.
export function endTime(c) {
  if (!c || !c.end) return null;
  const [y, m, d] = c.end.split('-').map(Number);
  const [hh, mm] = (c.endTime || '23:59').split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - num(c.tz, 0) * 3600000;
}

export function markCamp(ctx, c) {
  if (c && !ctx.edit) ctx.use.camps.add(c.id);
}

/* ---------- shared markup ---------- */

export const money = (ctx, n, cur, o = {}) => grp(ctx, (l) => escapeHTML(formatMoney(n, cur, l, o)));
export const numText = (ctx, n) => grp(ctx, (l) => { try { return escapeHTML(new Intl.NumberFormat(l).format(n)); } catch { return escapeHTML(String(n)); } });

// The progress bar of a campaign: <div data-fd-prog data-camp> with the figures the runtime keeps up to date.
// Server-rendered first (correct figures without JS, and for crawlers), then hydrated by data-fd-* hooks. ARIA
// progressbar with min/max/now so the percentage is announced. grp() renders a span per language so the language
// switcher can swap number formats without re-rendering.
export function progressHTML(ctx, c, o = {}) {
  if (!c) return '';
  markCamp(ctx, c);
  const st = campStats(ctx, c);
  const live = !ctx.edit;
  if (live) feature(ctx, 'progress');
  const pct = Math.round(st.pct * 10) / 10;
  const bar = `<div class="fd-bar${o.size ? ' fd-bar-' + o.size : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"`
    + ` aria-label="${escapeAttr(uiText('progress', ctx.lang, ctx.doc))}"><span class="fd-bar-fill" style="--p:${pct}%"${live ? ' data-fd-fill' : ''}></span>`
    + (st.matched ? `<span class="fd-bar-match" style="--m:${Math.min(100, st.goal ? (st.matched / st.goal) * 100 : 0)}%"></span>` : '') + '</div>';
  const raised = `<span class="fd-raised"${live ? ' data-fd-raised' : ''}>${money(ctx, st.raised, st.cur)}</span>`;
  const goal = st.goal ? `<span class="fd-goal">${ui(ctx, 'ofGoal', {})} <span${live ? ' data-fd-goal' : ''}>${money(ctx, st.goal, st.cur)}</span></span>` : '';
  const facts = [];
  if (o.donors !== false) facts.push(`<span class="fd-fact">${icon(ctx, 'users')}<span${live ? ' data-fd-donors' : ''}>${grp(ctx, (l) => escapeHTML(uiText('donorsN', l, ctx.doc, { n: st.donors })))}</span></span>`);
  if (o.days !== false && st.end != null) {
    facts.push(`<span class="fd-fact">${icon(ctx, 'clock')}<span${live ? ' data-fd-days' : ''}>${grp(ctx, (l) => escapeHTML(st.ended ? uiText('ended', l, ctx.doc) : uiText('daysLeft', l, ctx.doc, { n: st.days })))}</span></span>`);
  }
  if (o.pct !== false && st.goal) facts.push(`<span class="fd-fact fd-pct"><span${live ? ' data-fd-pct' : ''}>${Math.floor(st.pct)}</span>%</span>`);
  return `<div class="fd-prog${o.cls ? ' ' + o.cls : ''}"${live ? ` data-fd-prog data-camp="${escapeAttr(c.id)}"` : ''}>`
    + `<div class="fd-prog-head">${raised}${goal}</div>${bar}${facts.length ? `<div class="fd-facts">${facts.join('')}</div>` : ''}</div>`;
}

// Link button. href '' -> a non-link span; edit mode never navigates.
// External links open in a new tab with rel="noopener noreferrer": the opened page gets no window.opener (no
// reverse tabnabbing of the donation page) and no Referer.
export function btnHTML(ctx, label, href, o = {}) {
  const cls = `fd-btn${o.kind && o.kind !== 'primary' ? ' fd-btn-' + o.kind : ''}${o.cls ? ' ' + o.cls : ''}`;
  const inner = (o.icon ? icon(ctx, o.icon, 'fd-btn-ic') : '') + `<span>${label}</span>`;
  if (ctx.edit || !href) return `<span class="${cls}">${inner}</span>`;
  return `<a class="${cls}" href="${escapeAttr(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`;
}

// Picture of an attachment (null when it is not an image with data). o = { cls, alt (i18n), ratio, edit placeholder }.
export function imgHTML(ctx, id, o = {}) {
  const a = attOf(ctx, id);
  if (!a || !isImage(a)) return ctx.edit && o.placeholder ? `<div class="fd-img-ph${o.cls ? ' ' + o.cls : ''}" data-att-key="${escapeAttr(o.key || 'image')}">${icon(ctx, 'image')}</div>` : '';
  const src = attSrc(ctx, a);
  if (!src) return '';
  const alt = o.alt ? altAttr(ctx, (l) => htmlToText(pickText(o.alt, l, ctx.pd))) : altAttr(ctx, (l) => htmlToText(pickText(a.title, l, ctx.pd)));
  return `<img class="${o.cls || 'fd-img'}" src="${escapeAttr(src)}"${alt}${imgAttr(ctx, a)} loading="lazy" decoding="async"${o.key && ctx.edit ? ` data-att-key="${escapeAttr(o.key)}"` : ''}>`;
}

// Language switcher and theme toggle (nav block or the floating toolbar). Records what was rendered.
export function toolsHTML(ctx) {
  const d = ctx.doc;
  const langs = ctx.edit ? d.langs : ctx.langs;
  const sw = d.output.switcher;
  const lang = langs.length > 1 && sw !== 'none';
  const theme = !!d.output.themeToggle;
  if (!lang && !theme) return '';
  if (!ctx.edit) { ctx.use.tools = { lang, theme }; if (lang) feature(ctx, 'i18n'); if (theme) feature(ctx, 'theme'); }
  const ti = ctx.edit ? ' tabindex="-1"' : '';
  const cur = ctx.edit ? ctx.lang : ctx.defaultLang;
  let s = '';
  if (lang && sw === 'select') {
    s += `<select class="fd-tool-sel" data-set-lang aria-label="${escapeAttr(uiText('language', cur, d))}"${ti}>`
      + langs.map((l) => `<option value="${escapeAttr(l)}" lang="${escapeAttr(l)}"${l === cur ? ' selected' : ''}>${escapeHTML(langName(l))}</option>`).join('') + '</select>';
  } else if (lang) {
    s += langs.map((l) => `<button type="button" class="fd-tool-lang" data-set-lang="${escapeAttr(l)}" lang="${escapeAttr(l)}" aria-pressed="${l === cur}" title="${escapeAttr(langName(l))}"${ti}>${escapeHTML(l.split('-')[0].toUpperCase())}</button>`).join('');
  }
  if (theme) s += `<button type="button" class="fd-tool-btn" data-fd-scheme aria-pressed="false"${ti}>${icon(ctx, 'moon', 'fd-i-moon')}${icon(ctx, 'sun', 'fd-i-sun')}<span class="fd-sr">${ui(ctx, 'theme')}</span></button>`;
  return `<div class="fd-tools${ctx.edit ? '' : ' fd-js-only'}">${s}</div>`;
}

/* ---------- page skeleton ---------- */

export function renderRoot(ctx) {
  const d = ctx.doc;
  const th = d.theme;
  const r = ctx.route;
  const cls = `fd-root fd-t-${th.preset} fd-btn-${th.buttons}`;
  let pages = [];
  if (r.mode === 'edit') pages = r.page ? [r.page] : [];
  else if (r.mode === 'file') pages = r.page ? [r.page] : [];
  else pages = r.pages;
  const header = renderRegion(ctx, 'header', 'header', 'fd-header', true);
  let main = '';
  const multi = r.mode === 'hash' && pages.length > 1;
  if (multi) feature(ctx, 'pages');
  for (const p of pages) {
    ctx.camp = p.kind === 'campaign' ? p : null;
    ctx.region = 'main';
    ctx.depth = -1;
    const on = !multi || (r.home ? p.id === r.home.id : p === pages[0]);
    const attrs = ctx.edit ? '' : ` id="p-${escapeAttr(p.slug)}" data-fd-page="${escapeAttr(p.slug)}"${multi ? ` data-camp="${escapeAttr(p.id)}"` : ''}`;
    main += renderList(ctx, p.blocks, p.id + ':blocks', 'main', `fd-main fd-k-${p.kind}${on ? ' fd-on' : ''}`, '', false, attrs);
    ctx.camp = null;
  }
  if (!pages.length) main = `<main class="fd-main fd-on"></main>`;
  const footer = renderRegion(ctx, 'footer', 'footer', 'fd-footer', true);
  return `<div class="${cls}" data-mode="${ctx.edit ? 'edit' : 'view'}" id="top">${header}${main}${footer}</div>`;
}

/* ---------- wrapper hooks ---------- */

// Top-level blocks: full-bleed types draw their own container, the others get one (.fd-wrap).
export function wrapInner(ctx, b, t, inner) {
  if (ctx.depth !== 0 || t.full || !inner) return inner;
  return `<div class="fd-wrap${t.narrow ? ' fd-narrow' : ''}">${inner}</div>`;
}

export function blockClasses(ctx, b, t, cls) {
  if (ctx.depth === 0) cls += ' fd-top';
  if (b.device === 'desktop' || b.device === 'mobile') cls += ' fd-dev-' + b.device;
  if (b.tone && b.tone !== 'auto') cls += ' fd-tone-' + b.tone;
  if (b.style && b.style.bg) cls += ' fd-cbg';
  return cls;
}

// Inline style from normalised props only (numbers clamped, colours through safeColor in model.js), so nothing a
// document contains can inject CSS beyond these declarations.
export function blockStyle(b) {
  const s = isObj(b.style) ? b.style : {};
  const css = [];
  if (s.mt != null) css.push(`margin-top:${s.mt}px`);
  if (s.mb != null) css.push(`margin-bottom:${s.mb}px`);
  if (s.pad != null) css.push(`padding:${s.pad}px`);
  if (s.bg) css.push(`background:${s.bg}`);
  if (s.color) css.push(`color:${s.color}`);
  if (s.align) css.push(`text-align:${s.align}`);
  return { css: css.join(';'), cls: '' };
}

// Special route targets for the link checker of doc/render.js: '#/thanks' is valid when the document has a published
// thank-you page; undefined means "not special, resolve normally". (The previous comment here described a '#donate'
// fallback that this function does not implement.)
export function hrefTarget(ctx, slug) {
  if (slug === 'thanks') return !!thanksPage(ctx.doc);
  return undefined;
}

// After a view render: the floating toolbar when no nav carried the tools; the core runtime when anything needs it.
export function finishUsage(ctx, use) {
  if (!use.tools) {
    const d = ctx.doc;
    const lang = ctx.langs.length > 1 && d.output.switcher !== 'none';
    if (lang || d.output.themeToggle) {
      use.toolbar = { lang, theme: !!d.output.themeToggle };
      if (lang) use.features.add('i18n');
      if (d.output.themeToggle) use.features.add('theme');
    }
  }
  if (ctx.langs.length > 1) use.features.add('i18n');
  if (ctx.api) use.features.add('api');
  if (use.features.size) use.features.add('core');
}

export const pagesList = (ctx) => ctx.route.pages;
export const pageTitleText = (ctx, p, l) => htmlToText(pickText(p.title, l, ctx.pd));
export { own };
