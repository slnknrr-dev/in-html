// site-studio/viewer-render.js - landing page skeleton, block wrapper hooks, page tools, buttons, media and attachments.
import { FEATURE_ORDER } from './viewer-runtime.js';
import { TH_BUTTONS, TH_HEADINGS, TH_SPACES, defaultPreset } from './viewer-model.js';
import { THEMES } from '../doc/product.js';
import { onAccent, safeColor } from '../color/color.js';
import { attOf, attSrc, fileTypeLabel, formatSize, imgAttr, isImage, kindIcon, mimeBase, previewData, previewKind } from '../doc/attach.js';
import { isB64 } from '../codec/base64.js';
import { uiText } from '../doc/dict.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { addItemBox, altAttr, breakable, di, feature, fld, grp, has, hrefAttr, icon, plainIn, plainOf, renderList, txt, ui } from '../doc/render.js';
import { getPath, isObj, num, oneOf, own, round, str } from '../util/value.js';
import { langDir, langName, primary } from '../i18n/lang.js';
import { renderMain } from './viewer-pages.js';

// Exported language matching a #lang=<code> link (exact, case-insensitive, then by primary subtag), or ''.
function matchLang(langs, code) {
  const c = String(code || '').toLowerCase();
  return langs.find((l) => l.toLowerCase() === c) || langs.find((l) => primary(l) === primary(c)) || '';
}

const BTN_KINDS = ['primary', 'secondary', 'ghost'];

// Row of link buttons from b[key] = [{label i18n, href, kind primary|secondary|ghost, icon}]. o = {align, size
// ('sm'|'lg'), cls, addBox (edit mode: show the add-item box for an empty list)}. Edit mode: non-navigating
// <span class="lp-btn"> with the editable label `<key>.<i>.label`.
function buttonsHTML(ctx, b, key = 'items', o = {}) {
  const items = isObj(b) && Array.isArray(b[key]) ? b[key] : [];
  if (ctx.edit && !items.length) return o.addBox ? addItemBox(ctx) : '';
  const al = oneOf(o.align, ['left', 'center', 'right'], 'left');
  const size = o.size === 'sm' || o.size === 'lg' ? ' lp-btn-' + o.size : '';
  let s = '';
  items.forEach((it, i) => {
    if (!isObj(it)) return;
    const bc = `lp-btn lp-btn-${oneOf(it.kind, BTN_KINDS, 'primary')}${size}`;
    const ic = it.icon ? icon(ctx, it.icon, 'lp-btn-ic') : '';
    if (ctx.edit) {
      s += `<span class="${bc}"${di(ctx, i)}>${ic}${fld(ctx, b, `${key}.${i}.label`, 'plain', 'span', 'lp-btn-t', 'ph.btn')}</span>`;
      return;
    }
    const label = txt(ctx, it.label);
    if (!label) return; // an icon alone has no accessible name
    const href = hrefAttr(ctx, it.href);
    const inner = `${ic}<span class="lp-btn-t">${label}</span>`;
    s += href ? `<a class="${bc}"${href}>${inner}</a>` : `<span class="${bc}">${inner}</span>`;
  });
  if (!s) return '';
  return `<div class="lp-btns${al !== 'left' ? ' lp-btns-' + al : ''}${o.cls ? ' ' + escapeAttr(o.cls) : ''}">${s}</div>`;
}

function langSwitchHTML(ctx, kind) {
  const d = ctx.doc;
  const o = d.output;
  const langs = ctx.edit ? d.langs : ctx.langs;
  const cur = ctx.edit ? ctx.lang : ctx.defaultLang;
  const js = ctx.edit ? '' : ' lp-js-only';
  const ti = ctx.edit ? ' tabindex="-1"' : '';
  if (kind === 'select') {
    return `<select class="lp-tb-sel${js}" data-set-lang aria-label="${escapeAttr(uiText('language', cur, d))}"${ti}>`
      + langs.map((l) => `<option value="${escapeAttr(l)}" lang="${escapeAttr(l)}"${l === cur ? ' selected' : ''}>`
        + `${escapeHTML(langName(l, o.langLabels))}</option>`).join('') + '</select>';
  }
  // Native labels also carry the code: narrow layouts show codes to keep the tools small (CSS_TOOLS).
  const label = (l) => (o.langLabels === 'code' ? escapeHTML(langName(l, 'code'))
    : `<span class="lp-tb-ln">${escapeHTML(langName(l))}</span><span class="lp-tb-lc" aria-hidden="true">${escapeHTML(langName(l, 'code'))}</span>`);
  return langs.map((l) => `<button type="button" class="lp-tb-lang${js}" data-set-lang="${escapeAttr(l)}" lang="${escapeAttr(l)}"`
    + ` aria-pressed="${l === cur}" title="${escapeAttr(langName(l))}"${ti}>${label(l)}</button>`).join('');
}

function themeBtnHTML(ctx) {
  const js = ctx.edit ? '' : ' lp-js-only';
  return `<button type="button" class="lp-tb-btn${js}" data-lp-scheme aria-pressed="false"${ctx.edit ? ' tabindex="-1"' : ''}>`
    + `${icon(ctx, 'moon', 'lp-i-moon')}${icon(ctx, 'sun', 'lp-i-sun')}<span class="lp-sr">${ui(ctx, 'theme')}</span></button>`;
}

// Cart button (DOM contract §9): opens #lp-cart; the runtime fills the count badge.
function cartBtnHTML(ctx) {
  const q = ctx.doc.shop.mode === 'quote';
  const a = ctx.edit ? ' tabindex="-1"' : ' data-lp-cart-open aria-haspopup="dialog" aria-controls="lp-cart"';
  return `<button type="button" class="lp-cartbtn${ctx.edit ? '' : ' lp-js-only'}"${a}>${icon(ctx, q ? 'note' : 'cart', 'lp-cartbtn-ic')}`
    + `<span class="lp-cartbtn-t">${ui(ctx, q ? 'cartQuote' : 'cart')}</span>`
    + '<span class="lp-cartbtn-n" data-lp-cart-count hidden>0</span></button>';
}

// Tools slot of the nav block: language switcher + theme toggle (when output.toolbarPos === 'nav') and the cart button
// (when the page sells something and shop.cartButton is 'auto' or 'nav'). Records ctx.use.tools so the floating
// toolbar only carries the rest. Edit mode: static look-alike (no JS-only class, not focusable).
function navTools(ctx) {
  const d = ctx.doc;
  const o = d.output;
  const n = ctx.edit ? d.langs.length : ctx.langs.length;
  const inNav = o.toolbarPos === 'nav';
  const lang = inNav && n > 1 && o.switcher !== 'none';
  const theme = inNav && !!o.themeToggle;
  const shop = ctx.siteShop || (!ctx.edit && ctx.prev ? ctx.prev.shop : ctx.shopGuess);
  const cart = !!shop && d.shop.cartButton !== 'floating';
  if (!lang && !theme && !cart) return '';
  if (!ctx.edit) {
    const t = ctx.use.tools || (ctx.use.tools = { lang: false, theme: false, cart: false });
    t.lang = t.lang || lang;
    t.theme = t.theme || theme;
    t.cart = t.cart || cart;
  }
  const parts = [];
  if (lang) parts.push(langSwitchHTML(ctx, o.switcher));
  if (theme) parts.push(themeBtnHTML(ctx));
  if (cart) parts.push(cartBtnHTML(ctx));
  return `<div class="lp-tools${ctx.edit ? '' : ' lp-js-only'}">${parts.join('')}</div>`;
}

// Floating toolbar (exporter): the tools no nav rendered (use.toolbar from finishUsage). View mode only.
function renderToolbar(ctx, use) {
  const tb = use && use.toolbar;
  if (!tb || ctx.edit) return '';
  const o = ctx.doc.output;
  const pos = o.toolbarPos === 'nav' ? 'top-right' : o.toolbarPos;
  const parts = [];
  if (tb.switcher) parts.push(langSwitchHTML(ctx, tb.switcher));
  if (tb.theme) parts.push(themeBtnHTML(ctx));
  if (tb.cart) parts.push(cartBtnHTML(ctx));
  if (!parts.length) return '';
  return `<div class="lp-toolbar lp-tb-${pos} lp-js-only" role="toolbar" aria-label="${escapeAttr(uiText('toolbar', ctx.defaultLang, ctx.doc))}">`
    + `${parts.join('<span class="lp-tb-sep" aria-hidden="true"></span>')}</div>\n`;
}

// Formats a native <video>/<audio controls> player can show (player 'native').
const MEDIA_MIME = /^(video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm))$/;

function missingBox(ctx, ic) {
  return `<div class="lp-att-missing">${icon(ctx, ic || 'image')}<span>${escapeHTML(uiText('edit.noAtt', ctx.uiLang, ctx.doc))}</span></div>`;
}

// Download / open buttons ([data-att-dl] / [data-att-op] with data-att=<id>, feature embed). View mode only when the
// file data is in the document.
function attButtons(ctx, a, o = {}) {
  if (!a || (!ctx.edit && !isB64(a.data))) return '';
  const js = ctx.edit ? '' : ' lp-js-only';
  const ti = ctx.edit ? ' tabindex="-1"' : '';
  const btn = (k, ic, key) => `<button type="button" class="lp-btn lp-btn-sm lp-btn-secondary lp-att-btn${js}" data-att-${k}`
    + ` data-att="${escapeAttr(a.id)}"${ti}>${icon(ctx, ic)}<span>${ui(ctx, key)}</span></button>`;
  let s = '';
  if (o.dl) s += btn('dl', 'download', 'download');
  if (o.op) s += btn('op', 'open', 'open');
  if (!s) return '';
  if (!ctx.edit) { ctx.use.blob.add(a.id); ctx.use.atts.add(a.id); feature(ctx, 'embed'); }
  return `<div class="lp-att-btns">${s}</div>`;
}

// Fallback content of a preview (inside <object>/<video>/<audio>, or alone when there is no inline preview).
function attFallback(ctx, a) {
  return `<div class="lp-att-fb">${icon(ctx, kindIcon(a))}<span>${ui(ctx, 'noPreview')}</span>${attButtons(ctx, a, { dl: true })}</div>`;
}

// Attachment header card: icon, title (block caption at o.path, else the attachment title, else the file name),
// optional description, file info, download/open buttons. o = {blk, path:'caption', desc, dl, op}.
function attCardHTML(ctx, a, o = {}) {
  if (!a) return '';
  const blk = isObj(o.blk) ? o.blk : null;
  const path = o.path || 'caption';
  let title;
  if (blk && ctx.edit) {
    title = fld(ctx, blk, path, 'plain', 'div', 'lp-att-title', null, { ph: plainOf(ctx, a.title) || a.name });
  } else {
    const cap = blk ? getPath(blk, path) : null;
    const src = cap && has(ctx, cap) ? cap : has(ctx, a.title) ? a.title : null;
    title = `<div class="lp-att-title">${src ? txt(ctx, src) : breakable(a.name)}</div>`;
  }
  const desc = o.desc && has(ctx, a.desc) ? `<div class="lp-att-desc">${txt(ctx, a.desc)}</div>` : '';
  const info = `<div class="lp-att-info">${breakable(a.name)} · ${escapeHTML(fileTypeLabel(a))} · `
    + `${grp(ctx, (l) => escapeHTML(formatSize(a.size, l)))}</div>`;
  const btns = attButtons(ctx, a, { dl: !!o.dl, op: !!o.op });
  return `<div class="lp-att-head">${icon(ctx, kindIcon(a), 'lp-att-ic')}<div class="lp-att-meta">${title}${desc}${info}</div>${btns}</div>`;
}

// Inline preview of an attachment (resume attInner policy): images → <img>; player 'native' + audio/video → native
// controls (feature media); active formats → <iframe sandbox=""> (opaque origin, no scripts); the passive allowlist
// → <object type> with the fallback card inside (feature embed); anything else → fallback card. View mode carries
// only data-att=<id> (hydrated lazily from the store with blob URLs); edit mode uses the editor's blob URL.
// o = {height px 120..1200 (520), ratio '16/9'|'4/3' (video), player 'object'|'native', title, poster (image att id)}.
function objectHTML(ctx, a, o = {}) {
  if (!a) return '';
  const type = mimeBase(a.mime);
  const title = str(o.title) || a.name;
  if (isImage(a)) {
    const src = attSrc(ctx, a);
    if (!src) return ctx.edit ? missingBox(ctx, 'image') : '';
    return `<div class="lp-att-prev lp-att-img"><img src="${escapeAttr(src)}"${altAttr(ctx, () => title)}${imgAttr(ctx, a)} loading="lazy" decoding="async"></div>`;
  }
  const h = Math.round(num(o.height, 520, 120, 1200));
  const video = /^video\//.test(type);
  const ratio = video ? oneOf(o.ratio, ['16/9', '4/3'], '') : '';
  const box = ratio ? ` style="aspect-ratio:${ratio};height:auto"` : ` style="height:${h}px"`;
  const native = o.player === 'native' && MEDIA_MIME.test(type);
  const kind = previewKind(type);
  const id = escapeAttr(a.id);
  const ttl = escapeAttr(title);
  const fb = attFallback(ctx, a);
  let el;
  if (ctx.edit) {
    const u = ctx.attURL ? str(ctx.attURL(a.id)) : '';
    if (!u || (!native && !kind)) el = fb;
    else if (native) {
      el = video
        ? `<video class="lp-att-obj lp-att-video" src="${escapeAttr(u)}" controls preload="metadata" playsinline tabindex="-1" title="${ttl}"${box}></video>`
        : `<audio class="lp-att-audio" src="${escapeAttr(u)}" controls preload="metadata" tabindex="-1" aria-label="${ttl}"></audio>`;
    } else {
      el = kind === 'frame'
        ? `<iframe class="lp-att-obj" sandbox="" src="${escapeAttr(u)}" title="${ttl}" tabindex="-1"${box}></iframe>`
        : `<object class="lp-att-obj" data="${escapeAttr(previewData(u, type))}" type="${escapeAttr(type)}" tabindex="-1"${box}>${fb}</object>`;
    }
  } else if (!isB64(a.data) || (!native && !kind)) {
    el = fb; // metadata-only attachment (no data) or a format without inline preview
  } else {
    ctx.use.blob.add(a.id);
    ctx.use.atts.add(a.id);
    if (native) {
      feature(ctx, 'media');
      const pa = attOf(ctx, o.poster);
      const ps = pa && isImage(pa) && video ? attSrc(ctx, pa) : '';
      el = video
        ? `<video class="lp-att-obj lp-att-video" data-att="${id}" controls preload="none" playsinline title="${ttl}"${ps ? ` poster="${escapeAttr(ps)}"` : ''}${box}>${fb}</video>`
        : `<audio class="lp-att-audio" data-att="${id}" controls preload="none" aria-label="${ttl}">${fb}</audio>`;
    } else {
      feature(ctx, 'embed');
      el = kind === 'frame'
        ? `<iframe class="lp-att-obj" sandbox="" data-att="${id}" title="${ttl}"${box}></iframe>`
        : `<object class="lp-att-obj" data-att="${id}" type="${escapeAttr(type)}"${box} aria-label="${ttl}">${fb}</object>`;
    }
  }
  return `<div class="lp-att-prev${native ? ' lp-att-native' : ''}">${el}</div>`;
}

// Resume-style card + preview in one call: o = attCardHTML options + {embed, height, ratio, player, poster}.
function attInner(ctx, a, o = {}) {
  return attCardHTML(ctx, a, o) + (o.embed ? objectHTML(ctx, a, o) : '');
}

const RATIO_RE = /^(\d{1,3}(?:\.\d{1,3})?)\s*\/\s*(\d{1,3}(?:\.\d{1,3})?)$/;

function cssRatio(r) {
  if (typeof r === 'number') return r > 0 && r < 100 ? String(round(r, 4)) : '';
  const m = RATIO_RE.exec(str(r).trim());
  return m && +m[1] > 0 && +m[2] > 0 ? m[1] + '/' + m[2] : '';
}

// Image in a ratio box: <div class="lp-media…" style="--lp-ratio;--lp-fit"><img…></div>.
// o = {ratio ('auto' | 'w/h' | number), fit ('cover'|'contain'), cls, alt: (lang) => text (default: attachment
// title), zoom (lightbox), round, eager (no lazy loading: hero images), path (edit: data-att-key for the file picker),
// icon (edit placeholder icon)}. Edit mode without an image → .lp-ph placeholder; view mode without an image → ''.
function mediaBox(ctx, attId, o = {}) {
  const a = attOf(ctx, attId);
  const auto = o.ratio === 'auto';
  const r = auto ? 'auto' : cssRatio(o.ratio);
  const st = [];
  if (r) st.push('--lp-ratio:' + r);
  if (o.fit === 'cover' || o.fit === 'contain') st.push('--lp-fit:' + o.fit);
  const cls = 'lp-media' + (auto ? ' lp-media-auto' : '') + (o.round ? ' lp-media-round' : '') + (o.cls ? ' ' + escapeAttr(o.cls) : '');
  const style = st.length ? ` style="${st.join(';')}"` : '';
  const key = ctx.edit && o.path ? ` data-att-key="${escapeAttr(o.path)}"` : '';
  const src = a && isImage(a) ? attSrc(ctx, a) : '';
  if (!src) return ctx.edit ? `<div class="${cls} lp-ph"${style}${key}>${icon(ctx, o.icon || 'image')}</div>` : '';
  const alt = altAttr(ctx, (l) => (typeof o.alt === 'function' ? str(o.alt(l)) : plainIn(ctx, a.title, l)));
  let zoom = '';
  if (o.zoom && !ctx.edit) {
    feature(ctx, 'lightbox');
    ctx.use.zoom = true;
    zoom = ' data-lp-zoom tabindex="0" role="button" aria-haspopup="dialog"';
  }
  const load = o.eager ? ' decoding="async"' : ' loading="lazy" decoding="async"';
  return `<div class="${cls}"${style}${key}><img src="${escapeAttr(src)}"${alt}${imgAttr(ctx, a)}${zoom}${load}></div>`;
}

const URL_KINDS = ['web', 'github', 'codeberg', 'gitlab', 'linkedin', 'telegram', 'x', 'mastodon', 'whatsapp'];

const BREAK_KINDS = ['email', 'skype', ...URL_KINDS];

function contactText(it) {
  const v = str(it.value).trim();
  if (URL_KINDS.includes(it.kind) && /^https?:\/\//i.test(v)) return v.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  return v;
}

// Attachment link targets (#att-<id>) live on the first image/embed block showing the attachment.
const ATT_ANCHOR_TYPES = ['image', 'embed', 'attachment'];

const SHOP_TYPES = ['products', 'pricing', 'events', 'cart', 'collection'];

// Common style → inline CSS. px spacing as --lp-mt/--lp-mb (theme rhythm otherwise) and padding; a custom background
// (lp-cbg + --lp-cbg) gets auto-contrasted text (onAccent) unless style.color is set, and the local palette (muted,
// border, surface) follows that text colour so cards and secondary text stay readable on it.
function blockStyle(b) {
  const s = isObj(b.style) ? b.style : {};
  const out = [];
  const px = (v, min, max) => round(num(v, 0, min, max), 1) + 'px';
  if (s.mt != null && s.mt !== '') out.push('--lp-mt:' + px(s.mt, -200, 400));
  if (s.mb != null && s.mb !== '') out.push('--lp-mb:' + px(s.mb, -200, 400));
  if (s.pad != null && s.pad !== '') out.push('padding:' + px(s.pad, 0, 240));
  const bg = safeColor(s.bg);
  const co = safeColor(s.color);
  if (bg) out.push('--lp-cbg:' + bg, 'background:' + bg);
  const fg = co || (bg ? onAccent(bg) : '');
  if (fg) out.push('color:' + fg, '--lp-text:' + fg, '--lp-cfg:' + fg);
  if (bg && fg) {
    out.push('--lp-bg:' + bg, `--lp-muted:color-mix(in srgb,${fg} 72%,${bg})`, `--lp-border:color-mix(in srgb,${fg} 20%,transparent)`,
      `--lp-surface:color-mix(in srgb,${fg} 7%,${bg})`);
  }
  if (['left', 'center', 'right', 'justify'].includes(s.align)) out.push('text-align:' + s.align);
  return { css: out.join(';'), cls: bg ? 'lp-cbg' : '' };
}

// Page skeleton (CONTRACT.md §3): .lp-root with the theme classes, then <header>, <main id="lp-main"> (one per page
// in multi-page renders, viewer-pages.js renderMain), <footer>.
function renderRoot(ctx) {
  const d = ctx.doc;
  const th = d.theme;
  const region = (k, tag, omit, attrs) => {
    ctx.region = k;
    ctx.depth = -1;
    const s = renderList(ctx, d.regions[k], 'regions.' + k, tag, 'lp-' + k, '', omit, attrs);
    ctx.region = '';
    return s;
  };
  const header = region('header', 'header', !ctx.edit, '');
  const main = renderMain(ctx);
  const footer = region('footer', 'footer', !ctx.edit, '');
  const preset = own(THEMES, th.preset) ? th.preset : defaultPreset();
  const cls = ['lp-root', 'lp-t-' + preset, 'lp-btn-' + oneOf(th.buttons, TH_BUTTONS, 'solid'),
    'lp-hd-' + oneOf(th.headings, TH_HEADINGS, 'normal'), 'lp-sp-' + oneOf(th.space, TH_SPACES, 'normal')];
  // Edit mode: the canvas carries the edited language's direction (view mode inherits <html dir>, switched by rtI18n).
  const attrs = ctx.edit ? ` dir="${langDir(ctx.lang)}"` : ' id="top"';
  return `<div class="${escapeAttr(cls.join(' '))}" data-mode="${ctx.edit ? 'edit' : 'view'}"${attrs}>${header}${main}${footer}</div>`;
}

const reqById = (doc, id) => (typeof id === 'string' && id ? (doc.requests || []).find((r) => isObj(r) && r.id === id) || null : null);

const reqUsable = (doc, id) => { const r = reqById(doc, id); return !!(r && r.url); };

// Completes ctx.use after rendering (idempotent: the exporter calls it again after rendering the page chrome).
// Renderers record their own features (media, embed, lightbox, player, slider, events, form, cart via use.shop);
// derived here: i18n, theme, reveal, links, agegate, sync, checkout, req, blob and core.
function finishUsage(ctx) {
  const d = ctx.doc;
  const u = ctx.use;
  const o = d.output;
  const F = u.features;
  const multi = ctx.langs.length > 1;
  if (u.shop) F.add('cart');
  if (multi) F.add('i18n');
  if (o.themeToggle) F.add('theme');
  if (u.reveal && o.motion !== 'none') F.add('reveal');
  if (u.xrefs.size || u.types.has('nav')) F.add('links');
  if (o.ageGate && o.ageGate.enabled) F.add('agegate');
  // Several pages in one document (single file, 404.html): the router.
  if (ctx.route && ctx.route.multi && !ctx.edit) F.add('pages');
  if (F.has('cart')) {
    const s = d.shop;
    if (s.sync === 'remote' && (reqUsable(d, s.loadReq) || reqUsable(d, s.saveReq))) F.add('sync');
    if (s.checkout && s.checkout.method !== 'none') F.add('checkout');
  }
  if (F.has('sync') || F.has('checkout') || F.has('form')) F.add('req');
  // The HTTP transport only when a used request reaches a server (all 'local:' endpoints = zero network code).
  if (F.has('req')) {
    const used = new Set(u.reqs);
    const s = d.shop;
    if (F.has('sync')) { used.add(s.loadReq); used.add(s.saveReq); }
    if (F.has('checkout') && s.checkout.method === 'request') used.add(s.checkout.req);
    if ([...used].some((id) => { const r = reqById(d, id); return !!(r && r.url && !/^local:/.test(r.url)); })) F.add('net');
  }
  // Backend exports (ctx.api, viewer-backend.js): local endpoints and the chat reach the same-origin server.
  if (ctx.api && (F.has('req') || F.has('chat'))) { F.add('req'); F.add('net'); F.add('api'); }
  if (u.blob.size) F.add('blob');
  if (u.blob.size && ctx.assetURL) F.add('assets'); // attachments kept as files next to the page (archives)
  const known = new Set(FEATURE_ORDER);
  if ([...F].some((f) => f !== 'core' && known.has(f))) F.add('core');
  // Floating toolbar: whatever page tools no nav rendered.
  const sw = multi && o.switcher !== 'none';
  const nav = u.tools || {};
  const fl = { switcher: sw && !nav.lang ? o.switcher : null, theme: !!o.themeToggle && !nav.theme, cart: F.has('cart') && !nav.cart };
  u.toolbar = fl.switcher || fl.theme || fl.cart ? fl : null;
  u.store = [...u.blob].filter((id) => !u.imgInline.has(id) && isObj(own(d.attachments, id)) && isB64(d.attachments[id].data));
  for (const k of [d.theme.fontBody, d.theme.fontHead]) if (/^asset:/.test(k || '')) u.fonts.add(k.slice(6));
  u.langs = [...ctx.langs];
  u.defaultLang = ctx.defaultLang;
  return u;
}

// Wrapper classes: device visibility; reveal-on-scroll for content blocks of the main region.
function blockClasses(ctx, b, t, cls) {
  const dev = b.device === 'desktop' || b.device === 'mobile' ? b.device : '';
  if (dev) cls += ' lp-dev-' + dev;
  if (!ctx.edit && ctx.doc.output.motion !== 'none' && ctx.region === 'main' && !t.container) {
    cls += ' lp-rv';
    ctx.use.reveal = true;
  }
  return cls;
}

// Shown on one device class only: images inside are not the page's unconditional first copy.
const blockConditional = (b) => b.device === 'desktop' || b.device === 'mobile';

// A non-full top-level block is centred in the page container.
function wrapInner(ctx, b, t, inner) {
  return ctx.depth === 0 && !t.full && inner ? `<div class="lp-wrap lp-solo">${inner}</div>` : inner;
}

// Pre-pass guess whether the page sells something (the nav cart button renders before the catalog).
function planBlock(ctx, b) {
  if (!ctx.shopGuess && SHOP_TYPES.includes(b.type)) {
    ctx.shopGuess = b.type === 'cart' || (Array.isArray(b.items) && b.items.some((it) => isObj(it) && typeof it.sku === 'string' && it.sku !== ''));
  }
}

// #cart exists when the page (or, in multi-page exports, any page of the site) sells something.
function hrefTarget(ctx, slug, rendered) {
  if (slug !== 'cart') return undefined;
  if (ctx.siteShop) return true;
  return rendered ? !!ctx.use.shop : !!(ctx.prev ? ctx.prev.shop : ctx.shopGuess);
}

export {
  ATT_ANCHOR_TYPES,
  BREAK_KINDS,
  BTN_KINDS,
  MEDIA_MIME,
  RATIO_RE,
  SHOP_TYPES,
  URL_KINDS,
  attButtons,
  attCardHTML,
  attFallback,
  attInner,
  blockClasses,
  blockConditional,
  blockStyle,
  buttonsHTML,
  cartBtnHTML,
  contactText,
  cssRatio,
  finishUsage,
  hrefTarget,
  langSwitchHTML,
  matchLang,
  mediaBox,
  missingBox,
  navTools,
  objectHTML,
  planBlock,
  renderRoot,
  renderToolbar,
  reqById,
  reqUsable,
  themeBtnHTML,
  wrapInner
};
