// landing-studio/viewer-blocks-b.js - landing blocks: timeline, team, testimonials, logos, faq, cta, contact, table, form.
import { uid } from '../util/id.js';
import { pickText } from '../i18n/text.js';
import { safeColor } from '../color/color.js';
import { attOf, attSrc, isImage } from '../doc/attach.js';
import { buttonsHTML, mediaBox } from './viewer-render.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { uiText } from '../doc/dict.js';
import { isObj, num, oneOf, own, str } from '../util/value.js';
import { addItemBox, altAttr, breakable, di, editField, feature, fld, grp, has, hrefAttr, icon, needUi, noItems, plainIn, txt, ui } from '../doc/render.js';
import { carouselHTML } from './viewer-blocks-d.js';
import { emptyCell } from '../doc/table.js';
import { numOpts, optList } from '../doc/schema.js';
import { TONES } from './viewer-base.js';

// Also the shared field renderer formFieldsHTML() (form block + the runtime's checkout form in the cart drawer).
//
// Rules shared by every viewer-blocks-* part:
// - render(b, ctx) is pure: HTML string out, usage recorded on ctx.use (features, UI keys, attachments, requests); no
//   DOM, no globals, so the same code renders in the editor, in Node builds and in tests.
// - ctx.edit = canvas (every item shown, fields editable, no runtime hooks); otherwise export (empty parts dropped,
//   runtime hooks added only when a control is emitted, so unused features never ship).
// - User text reaches markup only through escapeHTML / escapeAttr / fld / txt; links through hrefAttr / normURL.
// - CSS lives in template strings (no comments inside them: they would ship in every export); its rationale sits in
//   comments above each table.

/* ---------- small local helpers ---------- */

const bbArr = (v) => (Array.isArray(v) ? v : []);
const BB_MAX_FIELDS = 40;
const BB_MAX_OPTS = 100;

// Variant chunk usage for CSS tree shaking (`type:prop=value`, CONTRACT.md §6). The core may record registry variants
// on its own as well; ctx.use.variants is a Set, so recording twice is harmless. Only blocks that render output call it.
function bbVariant(ctx, type, value) {
  if (!ctx.edit && ctx.use && ctx.use.variants instanceof Set) ctx.use.variants.add(`${type}:variant=${value}`);
}

// Edit-mode hint (editor UI language); `phb.*` keys live in UI_B.
const bbPh = (ctx, key) => uiText(key, ctx.uiLang, ctx.doc);

/* ---------- timeline ---------- */

function bbTlRender(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  const variant = oneOf(b.variant, ['line', 'alternate'], 'line');
  let s = '';
  bbArr(b.items).forEach((it, i) => {
    if (!isObj(it)) return;
    const p = `items.${i}.`;
    const title = fld(ctx, b, p + 'title', 'plain', 'h3', 'lp-tl-title', 'phb.title');
    const text = fld(ctx, b, p + 'html', 'rich', 'div', 'lp-tl-text lp-rich', 'phb.text', { ecls: 'lp-opt' });
    const d = str(it.date).trim();
    // The date is a plain text prop (edited in the inspector); edit mode shows a faded hint where it will appear.
    const date = d ? `<span class="lp-tl-date">${escapeHTML(d)}</span>`
      : ctx.edit ? `<span class="lp-tl-date lp-tl-nodate" aria-hidden="true">${escapeHTML(bbPh(ctx, 'phb.date'))}</span>` : '';
    const media = it.image
      ? mediaBox(ctx, it.image, { ratio: '16/9', fit: 'cover', cls: 'lp-tl-media', path: p + 'image', alt: (l) => plainIn(ctx, it.title, l) })
      : '';
    if (!ctx.edit && !title && !text && !d && !media) return;
    s += `<li class="lp-tl-item"${di(ctx, i)}><span class="lp-tl-dot" aria-hidden="true"></span>`
      + `<div class="lp-tl-card">${date}${title}${text}${media}</div></li>`;
  });
  if (!s) return '';
  bbVariant(ctx, 'timeline', variant);
  return `<ol class="lp-tl lp-tl-${variant}">${s}</ol>`;
}

/* ---------- team ---------- */

function bbTmRender(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  const variant = oneOf(b.variant, ['cards', 'round', 'list'], 'cards');
  const cols = oneOf(b.columns, [2, 3, 4], 3);
  let s = '';
  bbArr(b.items).forEach((it, i) => {
    if (!isObj(it)) return;
    const p = `items.${i}.`;
    let name = fld(ctx, b, p + 'name', 'plain', 'span', 'lp-tm-n', 'phb.name');
    if (name && !ctx.edit) {
      const h = hrefAttr(ctx, it.href);
      if (h) name = `<a class="lp-tm-a"${h}>${name}</a>`;
    }
    const role = fld(ctx, b, p + 'role', 'plain', 'p', 'lp-tm-role', 'phb.role', { ecls: 'lp-opt' });
    const bio = fld(ctx, b, p + 'html', 'rich', 'div', 'lp-tm-bio lp-rich', 'phb.bio', { ecls: 'lp-opt' });
    // The name is printed right next to the photo: the image is decorative (alt="") to avoid a double announcement.
    const photo = mediaBox(ctx, it.photo, { ratio: '1/1', fit: 'cover', round: variant !== 'cards', cls: 'lp-tm-photo', path: p + 'photo', alt: () => '' });
    if (!ctx.edit && !name && !role && !bio && !photo) return;
    const head = name ? `<h3 class="lp-tm-name">${name}</h3>` : '';
    s += `<li class="lp-tm-item${variant === 'cards' ? ' lp-card lp-card-hover' : ''}"${di(ctx, i)}>${photo}`
      + `<div class="lp-tm-body">${head}${role}${bio}</div></li>`;
  });
  if (!s) return '';
  bbVariant(ctx, 'team', variant);
  return `<ul class="lp-tm lp-tm-${variant} lp-tm-c${cols}">${s}</ul>`;
}

/* ---------- testimonials ---------- */

function bbTsStars(ctx, rating) {
  const n = Math.round(num(rating, 0, 0, 5));
  if (!n) return '';
  let s = '';
  for (let k = 1; k <= 5; k++) s += icon(ctx, 'star', 'lp-star' + (k <= n ? ' lp-on' : ''));
  return `<div class="lp-stars"><span class="lp-stars-i" aria-hidden="true">${s}</span><span class="lp-sr">${ui(ctx, 'ratingOf', { n })}</span></div>`;
}

// A number in a language with at most one decimal ('4.8', '4,8').
function bbNum1(v, l) {
  try { return new Intl.NumberFormat(l, { maximumFractionDigits: 1 }).format(v); } catch (e) { return String(Math.round(v * 10) / 10); }
}

function bbTsRender(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  const variant = oneOf(b.variant, ['cards', 'large', 'slider', 'quote'], 'cards');
  const cols = oneOf(b.columns, [2, 3, 4], 3);
  const card = variant !== 'large' && variant !== 'quote';
  let s = '';
  let n = 0;
  const figs = [];
  let sum = 0;
  let rated = 0;
  bbArr(b.items).forEach((it, i) => {
    if (!isObj(it)) return;
    const p = `items.${i}.`;
    const q = fld(ctx, b, p + 'html', 'rich', 'blockquote', 'lp-ts-q lp-rich', 'phb.quote');
    const name = fld(ctx, b, p + 'name', 'plain', 'span', 'lp-ts-name', 'phb.name');
    const role = fld(ctx, b, p + 'role', 'plain', 'span', 'lp-ts-role', 'phb.role', { ecls: 'lp-opt' });
    if (!ctx.edit && !q) return; // a testimonial without its text says nothing
    // Where the review comes from (a platform, a publication), linked when it has an address.
    let src = '';
    if (ctx.edit) src = fld(ctx, b, p + 'source', 'plain', 'span', 'lp-ts-src', 'phd.source', { ecls: 'lp-opt' });
    else if (has(ctx, it.source)) {
      const h = hrefAttr(ctx, it.href);
      src = `<span class="lp-ts-src">${h ? `<a${h}>${txt(ctx, it.source)}</a>` : txt(ctx, it.source)}</span>`;
    }
    const photo = mediaBox(ctx, it.photo, { ratio: '1/1', fit: 'cover', round: true, cls: 'lp-ts-photo', path: p + 'photo', alt: () => '' });
    const who = name || role || src ? `<span class="lp-ts-who">${name}${role}${src}</span>` : '';
    const by = photo || who ? `<figcaption class="lp-ts-by">${photo}${who}</figcaption>` : '';
    const fig = `<figure class="lp-ts-fig${card ? ' lp-card' : ''}">${bbTsStars(ctx, it.rating)}${q}${by}</figure>`;
    s += `<li class="lp-ts-item"${di(ctx, i)}>${fig}</li>`;
    figs.push({ i, html: fig });
    const r = Math.round(num(it.rating, 0, 0, 5));
    if (r) { sum += r; rated++; }
    n++;
  });
  if (!s) return '';
  bbVariant(ctx, 'testimonials', variant);
  // Summary: the average rating of the reviews shown (stars + "4.8 out of 5 · 12 reviews").
  let head = '';
  if (b.summary && rated) {
    const avg = sum / rated;
    let st = '';
    for (let k = 1; k <= 5; k++) st += icon(ctx, 'star', 'lp-star' + (k <= Math.round(avg) ? ' lp-on' : ''));
    head = `<p class="lp-ts-sum"><span class="lp-stars-i" aria-hidden="true">${st}</span>`
      + `<span class="lp-ts-cnt">${grp(ctx, (l) => escapeHTML(uiText('tsAvg', l, ctx.doc, { avg: bbNum1(avg, l), n: rated })))}</span></p>`;
  }
  const cls = `lp-ts lp-ts-${variant}${card ? ' lp-ts-c' + cols : ''}`;
  // Quote slider: one large testimonial at a time in the shared carousel (dots, optional autoplay, swipe).
  if (variant === 'quote') {
    return `<div class="${cls}">${head}${carouselHTML(ctx, b.id, figs, {
      cls: 'lp-ts-car', d: 1, t: 1, p: 1, gap: 24, auto: Math.round(num(b.autoplay, 0, 0, 30)), loop: true, arrows: true, dots: true, label: ui(ctx, 'tsLabel'),
    })}</div>`;
  }
  if (variant !== 'slider') return `<div class="${cls}">${head}<ul class="lp-ts-list">${s}</ul></div>`;
  if (ctx.edit) return `<div class="${cls}">${head}<ul class="lp-ts-list lp-track">${s}</ul></div>`;
  // Slider: a CSS scroll-snap track that works by swiping/scrolling without JS; prev/next buttons are JS-only
  // (feature slider). The visually hidden labels are per-language groups, so names follow the language switch.
  const tid = 'lp-tr-' + escapeAttr(b.id);
  const btn = (dir, ic) => `<button type="button" class="lp-slide-btn lp-slide-${dir}" data-lp-slide="${dir}" aria-controls="${tid}">`
    + `${icon(ctx, ic)}<span class="lp-sr">${ui(ctx, dir)}</span></button>`;
  const nav = n > 1 ? `<div class="lp-slide-nav lp-js-only">${btn('prev', 'chevronLeft')}${btn('next', 'chevronRight')}</div>` : '';
  if (nav) feature(ctx, 'slider');
  return `<div class="${cls}" data-lp-slider>${head}<span class="lp-sr" id="${tid}-l">${ui(ctx, 'tsLabel')}</span>`
    + `<ul class="lp-ts-list lp-track" id="${tid}" data-lp-track tabindex="0" aria-labelledby="${tid}-l">${s}</ul>${nav}</div>`;
}

/* ---------- logos ---------- */

function bbLgRender(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  const variant = oneOf(b.variant, ['grid', 'strip', 'marquee'], 'grid');
  let s = '';
  bbArr(b.items).forEach((it, i) => {
    if (!isObj(it)) return;
    const p = `items.${i}.`;
    const a = attOf(ctx, it.att);
    let img = '';
    if (a && isImage(a)) {
      const src = attSrc(ctx, a);
      if (src) {
        // Alt text names the brand (often the only content of a link): name → attachment title → file name.
        const alt = altAttr(ctx, (l) => plainIn(ctx, it.name, l) || plainIn(ctx, a.title, l) || str(a.name).replace(/\.[a-z0-9]{1,6}$/i, ''));
        const hook = ctx.edit ? ` data-att-key="${escapeAttr(p + 'att')}"` : ` data-att-img="${escapeAttr(a.id)}"`;
        img = `<img class="lp-logo-img" src="${escapeAttr(src)}"${alt}${hook} loading="lazy" decoding="async">`;
      }
    }
    let inner;
    if (ctx.edit) {
      // Without an image the name is the wordmark; with one it is the alt text (shown small below the logo).
      inner = (img || mediaBox(ctx, null, { ratio: '16/9', cls: 'lp-logo-ph', path: p + 'att' }))
        + fld(ctx, b, p + 'name', 'plain', 'span', img ? 'lp-logo-cap' : 'lp-logo-name', 'phb.logo', { ecls: img ? 'lp-opt' : '' });
    } else {
      inner = img || (has(ctx, it.name) ? `<span class="lp-logo-name">${txt(ctx, it.name)}</span>` : '');
      if (!inner) return;
      const h = hrefAttr(ctx, it.href);
      if (h) inner = `<a class="lp-logo-a"${h}>${inner}</a>`;
    }
    s += `<li class="lp-logo"${di(ctx, i)}>${inner}</li>`;
  });
  if (!s) return '';
  bbVariant(ctx, 'logos', variant);
  const cls = `lp-logos lp-logos-${variant}${b.mono ? ' lp-logos-mono' : ''}`;
  if (variant !== 'marquee' || ctx.edit) return `<ul class="${cls}">${s}</ul>`;
  // Moving strip: the list twice (the copy is hidden from assistive technology and the tab order) in a CSS loop that
  // stops on hover / focus and with prefers-reduced-motion; a pause button (feature marquee) stops it for good.
  const dup = s.replace(/<a /g, '<a tabindex="-1" ');
  feature(ctx, 'marquee');
  return `<div class="lp-mqw" data-lp-mq><div class="lp-mq" style="--lp-mq-t:${Math.round(num(b.speed, 40, 10, 180))}s"><div class="lp-mq-track">`
    + `<ul class="${cls}">${s}</ul><ul class="${cls} lp-mq-dup" aria-hidden="true">${dup}</ul></div></div>`
    + `<button type="button" class="lp-mq-btn lp-js-only" data-lp-mq-pause aria-pressed="false">${icon(ctx, 'pause', 'lp-i-pause')}${icon(ctx, 'play', 'lp-i-play')}`
    + `<span class="lp-sr">${ui(ctx, 'mqPause')}</span></button></div>`;
}

/* ---------- faq ---------- */

function bbFaqRender(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  const variant = oneOf(b.variant, ['details', 'cards'], 'details');
  // One answer open at a time: <details name> groups (native exclusive accordion, no script).
  const group = b.single ? ` name="lp-faq-${escapeAttr(b.id)}"` : '';
  let s = '';
  let first = true;
  bbArr(b.items).forEach((it, i) => {
    if (!isObj(it)) return;
    const p = `items.${i}.`;
    const q = fld(ctx, b, p + 'q', 'plain', 'span', 'lp-faq-qt', 'phb.q');
    const a = fld(ctx, b, p + 'html', 'rich', 'div', 'lp-faq-a lp-rich', 'phb.a');
    if (!ctx.edit && (!q || !a)) return; // half an entry (question without answer or vice versa) is not shown
    if (variant === 'cards') {
      s += `<div class="lp-faq-item lp-card"${di(ctx, i)}><h3 class="lp-faq-q">${q}</h3>${a}</div>`;
    } else if (ctx.edit) {
      // Edit mode: no <details>/<summary> — a click into the question must not collapse the answer being edited.
      s += `<div class="lp-faq-item lp-faq-open"${di(ctx, i)}><div class="lp-faq-q">${q}${icon(ctx, 'chevronDown', 'lp-faq-ic')}</div>${a}</div>`;
    } else {
      s += `<details class="lp-faq-item"${group}${b.openFirst && first ? ' open' : ''}><summary class="lp-faq-q">${q}`
        + `${icon(ctx, 'chevronDown', 'lp-faq-ic')}</summary>${a}</details>`;
    }
    first = false;
  });
  if (!s) return '';
  bbVariant(ctx, 'faq', variant);
  return `<div class="lp-faq lp-faq-${variant}">${s}</div>`;
}

/* ---------- cta ---------- */

function bbCtaRender(b, ctx) {
  const variant = oneOf(b.variant, ['banner', 'split', 'card', 'strip'], 'banner');
  const tone = oneOf(b.tone, TONES, 'accent');
  // Optional logo (a partner, a product, an award) in front of the text: the logo + call-to-action banner.
  let logo = '';
  const la = attOf(ctx, b.logo);
  if (la && isImage(la)) {
    const src = attSrc(ctx, la);
    if (src) logo = `<img class="lp-cta-logo" src="${escapeAttr(src)}"${altAttr(ctx, (l) => plainIn(ctx, la.title, l) || str(la.name).replace(/\.[a-z0-9]{1,6}$/i, ''))}${ctx.edit ? ' data-att-key="logo"' : ` data-att-img="${escapeAttr(la.id)}"`} loading="lazy" decoding="async">`;
  }
  const title = fld(ctx, b, 'title', 'plain', 'h2', 'lp-h lp-h2 lp-cta-t', 'phb.ctaTitle');
  const text = fld(ctx, b, 'html', 'rich', 'div', 'lp-cta-x lp-rich', 'phb.ctaText', { ecls: 'lp-opt' });
  const btns = buttonsHTML(ctx, b, 'items', { cls: 'lp-cta-btns' }) || '';
  if (!ctx.edit && !title && !text && !btns) return '';
  // Optional background photo under a scrim in the tone's background colour (keeps the tone's text readable).
  let bg = '';
  const a = attOf(ctx, b.bg);
  if (a && isImage(a)) {
    const src = attSrc(ctx, a);
    if (src) {
      const hook = ctx.edit ? ' data-att-key="bg"' : ` data-att-img="${escapeAttr(a.id)}"`;
      const ov = Math.round(num(b.overlay, 55, 0, 90)) / 100;
      bg = `<img class="lp-cta-bg" src="${escapeAttr(src)}" alt=""${hook} loading="lazy" decoding="async">`
        + `<span class="lp-cta-ov" style="--lp-ov:${ov}" aria-hidden="true"></span>`;
    }
  }
  const toned = (tone !== 'auto' ? ' lp-tone-' + tone : '') + (bg ? ' lp-cta-hasbg' : '');
  const card = variant === 'card';
  const act = btns ? `<div class="lp-cta-act">${btns}</div>` : '';
  const box = `<div class="lp-cta-box${card ? toned : ''}${logo ? ' lp-cta-haslogo' : ''}">${card ? bg : ''}${logo}<div class="lp-cta-text">${title}${text}</div>${act}</div>`;
  bbVariant(ctx, 'cta', variant);
  // Full-bleed band with its own container (top level); nested inside a section the inner .lp-wrap is neutralized by CSS.
  return `<div class="lp-cta lp-cta-${variant}${card ? '' : toned}">${card ? '' : bg}<div class="lp-wrap lp-cta-wrap">${box}</div></div>`;
}

/* ---------- contact ---------- */

const BB_CT_KINDS = ['email', 'phone', 'whatsapp', 'telegram', 'viber', 'web', 'address', 'location', 'hours',
  'instagram', 'facebook', 'youtube', 'tiktok', 'vk', 'linkedin', 'x', 'github', 'codeberg', 'gitlab', 'mastodon',
  'skype', 'other'];
const BB_CT_ICON = { address: 'location', hours: 'clock' };
// Kinds whose value is free text that may span several lines (address, hours…) vs. handles/URLs (line breaks at . / @).
const BB_CT_MULTI = ['address', 'location', 'hours', 'other'];
const BB_HANDLE = /^[A-Za-z0-9._-]{1,100}$/;
const BB_SOCIAL = {
  instagram: 'https://www.instagram.com/', facebook: 'https://www.facebook.com/', youtube: 'https://www.youtube.com/@',
  tiktok: 'https://www.tiktok.com/@', vk: 'https://vk.com/', linkedin: 'https://www.linkedin.com/in/', x: 'https://x.com/',
  github: 'https://github.com/', codeberg: 'https://codeberg.org/', gitlab: 'https://gitlab.com/', telegram: 'https://t.me/',
};

// Raw link target for a contact item (validated afterwards by hrefAttr's allowlist). An explicit href wins; bare
// domains / e-mails typed into href are completed. address/location/hours/skype/other/viber get no automatic link
// (viber: has no http(s) deep link inside the allowlist).
function bbCtHref(it) {
  const href = str(it.href).trim();
  if (href) {
    if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(href)) return 'https://' + href;
    if (/^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(href)) return 'mailto:' + href;
    return href;
  }
  const v = str(it.value).trim();
  if (!v) return '';
  const isURL = /^https?:\/\//i.test(v);
  const handle = v.replace(/^@/, '');
  switch (it.kind) {
    case 'email': {
      const e = v.replace(/^mailto:/i, '').replace(/\s+/g, '');
      return /^[^\s@<>"']+@[^\s@<>"']+$/.test(e) ? 'mailto:' + e : '';
    }
    case 'phone': {
      const t = v.replace(/[^\d+]/g, '');
      return t.replace(/\D/g, '').length >= 3 ? 'tel:' + t : '';
    }
    case 'whatsapp': {
      if (isURL) return v;
      const d = v.replace(/\D/g, '');
      return d.length >= 7 ? 'https://wa.me/' + d : '';
    }
    case 'web':
      if (isURL) return v;
      return /^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(v) ? 'https://' + v : '';
    case 'mastodon': {
      if (isURL) return v;
      const m = /^@?([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(v);
      return m && BB_HANDLE.test(m[1]) ? 'https://' + m[2] + '/@' + m[1] : '';
    }
    default: {
      const base = own(BB_SOCIAL, it.kind);
      if (!base) return '';
      if (isURL) return v;
      return BB_HANDLE.test(handle) ? base + handle : '';
    }
  }
}

// Display text: URLs without scheme / www / trailing slash, mailto: stripped.
function bbCtText(it) {
  const v = str(it.value).trim();
  if (BB_CT_MULTI.includes(it.kind)) return v;
  if (/^https?:\/\//i.test(v)) return v.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  return v.replace(/^mailto:/i, '');
}

function bbCtValue(kind, v) {
  if (BB_CT_MULTI.includes(kind)) return v.split(/\r?\n/).map((x) => escapeHTML(x.trim())).filter(Boolean).join('<br>');
  return breakable(v);
}

function bbCtRender(b, ctx) {
  const variant = oneOf(b.variant, ['cards', 'list', 'split'], 'cards');
  let list = '';
  if (noItems(ctx, b)) list = addItemBox(ctx);
  else {
    let s = '';
    bbArr(b.items).forEach((it, i) => {
      if (!isObj(it)) return;
      const p = `items.${i}.`;
      const kind = BB_CT_KINDS.includes(it.kind) ? it.kind : 'other';
      const val = bbCtText(it);
      const kindKey = 'ct.' + kind;
      let k;
      let v;
      if (ctx.edit) {
        // The label is editable on the page; when empty it shows the automatic kind label it will export with.
        k = fld(ctx, b, p + 'label', 'plain', 'span', 'lp-ct-k', null,
          { ph: uiText(kindKey, ctx.lang, ctx.doc), ecls: b.labels ? 'lp-bb-auto' : 'lp-opt' });
        v = val ? `<span class="lp-ct-v">${bbCtValue(kind, val)}</span>`
          : `<span class="lp-ct-v lp-ct-novalue">${escapeHTML(bbPh(ctx, 'phb.value'))}</span>`;
      } else {
        if (!val) return; // a label without a value is not a contact
        k = has(ctx, it.label) ? `<span class="lp-ct-k">${txt(ctx, it.label)}</span>`
          : b.labels ? `<span class="lp-ct-k">${ui(ctx, kindKey)}</span>` : '';
        const h = hrefAttr(ctx, bbCtHref(it));
        v = h ? `<a class="lp-ct-v"${h}>${bbCtValue(kind, val)}</a>` : `<span class="lp-ct-v">${bbCtValue(kind, val)}</span>`;
      }
      const ic = icon(ctx, own(BB_CT_ICON, kind) || kind);
      s += `<li class="lp-ct-item lp-ct-${kind}${variant === 'cards' ? ' lp-card' : ''}"${di(ctx, i)}>`
        + `<span class="lp-icbox lp-ct-ic">${ic}</span><span class="lp-ct-t">${k}${v}</span></li>`;
    });
    if (s) list = `<ul class="lp-ct-items">${s}</ul>`;
  }
  // Map: an image (e.g. an exported map screenshot) optionally linked to mapHref; a link alone becomes a button.
  let map = '';
  const mh = ctx.edit ? '' : hrefAttr(ctx, b.mapHref);
  if (b.map || (ctx.edit && variant === 'split')) {
    const m = mediaBox(ctx, b.map, { ratio: '4/3', fit: 'cover', cls: 'lp-ct-mapimg', path: 'map', alt: (l) => uiText('mapAlt', l, ctx.doc) });
    if (m) map = `<div class="lp-ct-map">${mh ? `<a class="lp-ct-mapa"${mh}>${m}</a>` : m}</div>`;
  }
  if (!map && mh) {
    map = `<div class="lp-ct-map lp-ct-maponly"><a class="lp-btn lp-btn-secondary"${mh}>${icon(ctx, 'location')}<span>${ui(ctx, 'openMap')}</span></a></div>`;
  }
  if (!list && !map) return '';
  bbVariant(ctx, 'contact', variant);
  return `<div class="lp-ct lp-ct-${variant}${map ? ' lp-ct-hasmap' : ''}">${list}${map}</div>`;
}

/* ---------- table (doc/table.js model; the richtext/ table editing contract) ---------- */

function bbTbRender(b, ctx) {
  const rows = bbArr(b.rows);
  const cols = bbArr(b.cols);
  const h = b.header;
  const hRow = h === 'row' || h === 'both';
  const hCol = h === 'col' || h === 'both';
  let body = '';
  let filled = false;
  rows.forEach((row, r) => {
    let tr = '';
    bbArr(row).forEach((cell, c) => {
      if (!isObj(cell) || cell.m) return; // covered by a merged cell
      const th = !!cell.th || (r === 0 && hRow) || (c === 0 && hCol);
      const tag = th ? 'th' : 'td';
      let a = '';
      if (cell.cs > 1) a += ` colspan="${cell.cs | 0}"`;
      if (cell.rs > 1) a += ` rowspan="${cell.rs | 0}"`;
      if (th && !ctx.edit) a += ` scope="${r === 0 && hRow ? 'col' : 'row'}"`;
      const st = [];
      const bg = safeColor(cell.bg);
      if (bg) st.push('background:' + bg);
      if (['left', 'center', 'right', 'justify'].includes(cell.align)) st.push('text-align:' + cell.align);
      if (['top', 'middle', 'bottom'].includes(cell.va)) st.push('vertical-align:' + cell.va);
      if (st.length) a += ` style="${st.join(';')}"`;
      // Edit cells: td/th[data-r][data-c] (origin position) — the richtext/ table UI locates cells by these.
      if (ctx.edit) tr += editField(ctx, cell.html, `rows.${r}.${c}.html`, 'rich', tag, '', 'phb.cell', { attrs: ` data-r="${r}" data-c="${c}"${a}` });
      else {
        const v = txt(ctx, cell.html, 'rich');
        if (v) filled = true;
        tr += `<${tag}${a}>${v}</${tag}>`;
      }
    });
    body += `<tr>${tr}</tr>`;
  });
  let cap = '';
  if (ctx.edit) cap = `<caption>${fld(ctx, b, 'caption', 'plain', 'span', 'lp-tbl-cap', 'phb.caption', { ecls: 'lp-opt' })}</caption>`;
  else if (has(ctx, b.caption)) cap = `<caption>${txt(ctx, b.caption)}</caption>`;
  // View mode: a table without any cell text (and no caption) renders nothing.
  if (!ctx.edit && !filled && !cap) return '';
  // Fixed layout only while editing (column resizing); in view mode widths are hints so words never break mid-word.
  const fixed = ctx.edit && cols.some((c) => c && c.w);
  const cg = `<colgroup>${cols.map((c) => (c && c.w ? `<col style="width:${num(c.w, 0, 0, 100)}%">` : '<col>')).join('')}</colgroup>`;
  const variant = oneOf(b.variant, ['grid', 'lines', 'minimal', 'striped', 'none'], 'grid');
  const cls = `lp-tbl-t lp-tbs-${variant}` + (b.compact ? ' lp-tbl-compact' : '') + (fixed ? ' lp-tbl-fixed' : '');
  bbVariant(ctx, 'table', variant);
  return `<div class="lp-tbl"><table class="${cls}" style="width:${num(b.width, 100, 30, 100)}%">${cap}${cg}<tbody>${body}</tbody></table></div>`;
}

/* ---------- form fields (shared: form block + checkout form) ---------- */

const BB_FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox', 'number', 'date'];
const BB_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
// HTML autocomplete tokens by field key (browsers fill name / e-mail / phone / address correctly).
const BB_AUTOCOMPLETE = {
  name: 'name', fullname: 'name', full_name: 'name', first_name: 'given-name', firstname: 'given-name',
  last_name: 'family-name', lastname: 'family-name', surname: 'family-name', email: 'email', e_mail: 'email',
  phone: 'tel', tel: 'tel', mobile: 'tel', telephone: 'tel', company: 'organization', organization: 'organization',
  organisation: 'organization', org: 'organization', position: 'organization-title', job_title: 'organization-title',
  address: 'street-address', street: 'street-address', street_address: 'street-address', city: 'address-level2',
  town: 'address-level2', region: 'address-level1', state: 'address-level1', zip: 'postal-code', postcode: 'postal-code',
  postal_code: 'postal-code', country: 'country-name', website: 'url', url: 'url',
};
// Automatic (translated) labels for well-known keys, so a field without a label still reads well in every language.
const BB_AUTO_LABEL = {
  name: 'fl.name', fullname: 'fl.name', full_name: 'fl.name', first_name: 'fl.firstName', firstname: 'fl.firstName',
  last_name: 'fl.lastName', lastname: 'fl.lastName', surname: 'fl.lastName', email: 'fl.email', e_mail: 'fl.email',
  phone: 'fl.phone', tel: 'fl.phone', mobile: 'fl.phone', telephone: 'fl.phone', company: 'fl.company',
  organization: 'fl.company', organisation: 'fl.company', org: 'fl.company', message: 'fl.message', comment: 'fl.message',
  comments: 'fl.message', subject: 'fl.subject', address: 'fl.address', street: 'fl.address', city: 'fl.city',
  town: 'fl.city', country: 'fl.country', zip: 'fl.zip', postcode: 'fl.zip', postal_code: 'fl.zip', website: 'fl.website',
  url: 'fl.website', date: 'fl.date', quantity: 'fl.quantity', qty: 'fl.quantity', guests: 'fl.guests',
  persons: 'fl.guests', people: 'fl.guests',
};
const BB_TYPE_LABEL = { email: 'fl.email', tel: 'fl.phone', date: 'fl.date', textarea: 'fl.message' };

// Valid, unique field name: invalid keys become field_<n>, duplicates get a _<n> suffix (max 31 chars).
function bbFieldKey(raw, i, seen) {
  let k = str(raw).trim().toLowerCase();
  if (!BB_KEY_RE.test(k)) k = 'field_' + (i + 1);
  const base = k;
  for (let n = 2; seen.has(k); n++) k = base.slice(0, 27) + '_' + n;
  seen.add(k);
  return k;
}

const bbAutoKey = (key, type) => own(BB_AUTO_LABEL, key) || own(BB_TYPE_LABEL, type) || '';
const bbHuman = (key) => { const s = key.replace(/_+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

// Select options: one per line of the option text in a language (trimmed, empty lines dropped, capped).
const bbOptLines = (ctx, i18n, l) => str(pickText(i18n, l, ctx.pd)).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  .slice(0, BB_MAX_OPTS).map((x) => x.slice(0, 200));

// Per-language attribute values that CSS cannot switch (placeholder, <option> text): the default language goes into
// the markup; when other output languages differ, a data-* JSON {lang: value} lets the runtime relabel on `lp:lang`.
function bbLangJSON(ctx, fn) {
  if (ctx.edit || ctx.langs.length < 2) return '';
  const v0 = JSON.stringify(fn(ctx.lang));
  const m = {};
  let diff = false;
  for (const l of ctx.langs) { m[l] = fn(l); if (JSON.stringify(m[l]) !== v0) diff = true; }
  return diff ? JSON.stringify(m) : '';
}

/**
 * Form controls for a list of field items ({key, type, label, ph, options, required, half}: form block items and
 * doc.shop.checkout.fields share this shape). Returns a flat run of `.lp-field` elements meant to sit directly in
 * a `.lp-form` (the form element, submit button and result box belong to the caller).
 *   o.scope  id prefix → ids `f-<scope>-<key>`, error slots `#f-<scope>-<key>-err[data-lp-err=key]`
 *   o.edit   static look-alike controls without names (default: ctx.edit) — editor canvas / previews
 *   o.path   edit mode: item path prefix ('items') → labels editable as `<path>.<i>.label`, fields carry data-item
 * View markup: label[for] + control with name=key, required + aria-required, autocomplete/inputmode hints,
 * aria-describedby → error slot; `.lp-field-half` for half-width fields; `.lp-field-check` for checkboxes.
 */
function formFieldsHTML(ctx, fields, o = {}) {
  const edit = o.edit != null ? !!o.edit : !!ctx.edit;
  const scope = str(o.scope).replace(/[^A-Za-z0-9_-]/g, '') || 'f';
  const path = ctx.edit && typeof o.path === 'string' && o.path ? o.path : '';
  const seen = new Set();
  const mark = '<span class="lp-req" aria-hidden="true">*</span>';
  let s = '';
  bbArr(fields).slice(0, BB_MAX_FIELDS).forEach((f, i) => {
    if (!isObj(f)) return;
    const type = oneOf(f.type, BB_FIELD_TYPES, 'text');
    const key = bbFieldKey(f.key, i, seen);
    const req = !!f.required;
    const auto = bbAutoKey(key, type);
    const cls = 'lp-field' + (f.half ? ' lp-field-half' : '') + (type === 'checkbox' ? ' lp-field-check' : '');
    const rm = req ? mark : '';
    if (edit) {
      // Static look-alike: nothing focusable or submittable on the editor canvas.
      const auto0 = auto ? uiText(auto, ctx.lang, ctx.doc) : bbHuman(key);
      const lbl = path
        ? editField(ctx, f.label, `${path}.${i}.label`, 'plain', 'span', 'lp-label-t', null, { ph: auto0, ecls: 'lp-bb-auto' })
        : has(ctx, f.label) ? txt(ctx, f.label) : escapeHTML(auto0);
      const ph = plainIn(ctx, f.ph, ctx.lang);
      const dItem = path ? di(ctx, i) : '';
      let ctl;
      if (type === 'checkbox') {
        s += `<div class="${cls}"${dItem}><span class="lp-check"><span class="lp-check-box" aria-hidden="true"></span>`
          + `<span class="lp-check-t">${lbl}${rm}</span></span></div>`;
        return;
      }
      if (type === 'select') {
        const first = ph || bbOptLines(ctx, f.options, ctx.lang)[0] || uiText('formChoose', ctx.lang, ctx.doc);
        ctl = `<span class="lp-input lp-input-ed lp-select" aria-hidden="true"><span class="lp-input-ph">${escapeHTML(first)}</span>${icon(ctx, 'chevronDown', 'lp-input-ic')}</span>`;
      } else {
        const ic = type === 'date' ? icon(ctx, 'calendar', 'lp-input-ic') : '';
        ctl = `<span class="lp-input lp-input-ed${type === 'textarea' ? ' lp-textarea' : ''}" aria-hidden="true"><span class="lp-input-ph">${escapeHTML(ph)}</span>${ic}</span>`;
      }
      s += `<div class="${cls}"${dItem}><span class="lp-label">${lbl}${rm}</span>${ctl}</div>`;
      return;
    }
    const id = `f-${scope}-${key}`;
    const lbl = has(ctx, f.label) ? txt(ctx, f.label) : auto ? ui(ctx, auto) : escapeHTML(bbHuman(key));
    const err = `<span class="lp-err" id="${id}-err" data-lp-err="${key}"></span>`;
    const base = ` id="${id}" name="${key}"${req ? ' required aria-required="true"' : ''} aria-describedby="${id}-err"`;
    if (type === 'checkbox') {
      s += `<div class="${cls}" data-lp-field="${key}"><label class="lp-check" for="${id}"><input class="lp-check-in" type="checkbox"${base} value="yes">`
        + `<span class="lp-check-t">${lbl}${rm}</span></label>${err}</div>`;
      return;
    }
    const label = `<label class="lp-label" for="${id}">${lbl}${rm}</label>`;
    let ctl;
    if (type === 'select') {
      const opts0 = bbOptLines(ctx, f.options, ctx.lang);
      const empty = (l) => plainIn(ctx, f.ph, l) || uiText('formChoose', l, ctx.doc);
      // Values are the default-language texts (what the recipient reads); other languages relabel by index.
      const lj = bbLangJSON(ctx, (l) => { const x = bbOptLines(ctx, f.options, l); return [empty(l), ...opts0.map((v, k) => x[k] || v)]; });
      ctl = `<select class="lp-input lp-select"${base}${lj ? ` data-lp-opts="${escapeAttr(lj)}"` : ''}>`
        + `<option value="">${escapeHTML(empty(ctx.lang))}</option>`
        + opts0.map((v) => `<option value="${escapeAttr(v)}">${escapeHTML(v)}</option>`).join('') + '</select>';
    } else {
      const ph0 = plainIn(ctx, f.ph, ctx.lang);
      const pj = bbLangJSON(ctx, (l) => plainIn(ctx, f.ph, l));
      const ph = (ph0 ? ` placeholder="${escapeAttr(ph0)}"` : '') + (pj ? ` data-lp-ph="${escapeAttr(pj)}"` : '');
      const ac = own(BB_AUTOCOMPLETE, key) || (type === 'email' ? 'email' : type === 'tel' ? 'tel' : '');
      const acA = ac ? ` autocomplete="${ac}"` : '';
      if (type === 'textarea') ctl = `<textarea class="lp-input lp-textarea"${base}${ph} rows="5" dir="auto"></textarea>`;
      else {
        let extra = '';
        if (type === 'email') extra = ' inputmode="email" spellcheck="false" autocapitalize="off"';
        else if (type === 'tel') extra = ' inputmode="tel"';
        else if (type === 'number') extra = ' inputmode="decimal" step="any"';
        else if (type === 'text') extra = ' dir="auto"';
        ctl = `<input class="lp-input" type="${type}"${base}${acA}${extra}${ph}>`;
      }
    }
    s += `<div class="${cls}" data-lp-field="${key}">${label}${ctl}${err}</div>`;
  });
  return s;
}

/* ---------- form block ---------- */

// Runtime strings of the form feature (cfg.ui, CONTRACT.md §8/§9); recorded with needUi() for every rendered form.
const BB_FORM_UI = ['fieldRequired', 'fieldEmail', 'fieldTel', 'fieldNumber', 'fieldCheck', 'fieldChoose', 'formSending',
  'formSent', 'formFailed', 'formQueued', 'formFallback', 'formViaMail', 'formViaWhatsapp', 'formViaTelegram', 'formCopy',
  'formCopied', 'formSubject'];

// Fallback destination normalized per channel: e-mail address | phone digits (WhatsApp) | username (Telegram) | ''.
function bbFmTo(fb, raw) {
  const v = str(raw).trim();
  if (fb === 'mailto') {
    const e = v.replace(/^mailto:/i, '').split('?')[0];
    return /^[^\s@<>"',;:?&#/]+@[^\s@<>"',;:?&#/]+\.[^\s@<>"',;:?&#/]{2,}$/.test(e) ? e : '';
  }
  if (fb === 'whatsapp') {
    const d = v.replace(/\D/g, '');
    return d.length >= 7 && d.length <= 15 ? d : '';
  }
  if (fb === 'telegram') {
    const m = /^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z0-9_]{4,32})\/?$/.exec(v);
    return m ? m[1] : '';
  }
  return '';
}

// URL usable as a request target / no-JS form action (CONTRACT.md §2: http(s) or a path starting with /, ./, ../).
const BB_REQ_URL = /^(https?:\/\/[^\s"'<>\\]+|\.{0,2}\/[^\s"'<>\\]*)$/i;

// Where a form block sends to: usable request, fallback channel + target, and the no-JS action (CONTRACT.md §6):
// mailto when the fallback is mailto (with a valid address), else the request URL when that request is a POST,
// else none (the submit button becomes JS-only).
function bbFmDest(ctx, b) {
  const d = ctx.doc;
  const r = b.req ? bbArr(d.requests).find((x) => isObj(x) && x.id === b.req) : null;
  const url = r ? str(r.url).trim() : '';
  // A server URL or a browser-local endpoint (local:…, served by the runtime; never a plain form action).
  const req = r && (BB_REQ_URL.test(url) || /^local:/.test(url)) ? r : null;
  const fb = oneOf(b.fallback, ['mailto', 'whatsapp', 'telegram', 'outbox', 'none'], 'mailto');
  const to = bbFmTo(fb, b.to);
  let action = '';
  let mailto = false;
  if (fb === 'mailto' && to) {
    const subj = plainIn(ctx, b.title, ctx.lang) || uiText('formSubject', ctx.lang, d);
    action = 'mailto:' + to + '?subject=' + encodeURIComponent(subj);
    mailto = true;
  } else if (req && str(req.method).toUpperCase() === 'POST') {
    const vars = { form: str(b.id), site: str(d.id), lang: ctx.lang, currency: str(d.shop && d.shop.currency) };
    const u = url.replace(/\{(form|site|lang|currency)\}/g, (m, k) => encodeURIComponent(vars[k]));
    // {cartId}/{orderId} have no value without the runtime: such a URL cannot be a plain form action.
    if (!/\{(cartId|orderId)\}/.test(u) && BB_REQ_URL.test(u)) action = u;
  }
  return { req, fb, to, action, mailto };
}

function bbFmRender(b, ctx) {
  const variant = oneOf(b.variant, ['card', 'plain'], 'card');
  const bid = escapeAttr(b.id);
  const fields = bbArr(b.items).filter(isObj);
  const dest = bbFmDest(ctx, b);
  let title;
  let tid = '';
  if (ctx.edit) title = fld(ctx, b, 'title', 'plain', 'h3', 'lp-h lp-h3 lp-formb-t', 'phb.formTitle', { ecls: 'lp-opt' });
  else {
    const t = txt(ctx, b.title);
    if (t) tid = `lp-fh-${bid}`;
    title = t ? `<h3 class="lp-h lp-h3 lp-formb-t" id="${tid}">${t}</h3>` : '';
  }
  const body = noItems(ctx, b) ? addItemBox(ctx) : formFieldsHTML(ctx, fields, { scope: b.id, path: 'items' });
  let consent = '';
  if (ctx.edit) {
    consent = `<div class="lp-field lp-field-check lp-consent"><span class="lp-check"><span class="lp-check-box" aria-hidden="true"></span>`
      + `${fld(ctx, b, 'consent', 'inline', 'span', 'lp-check-t', 'phb.consent', { ecls: 'lp-opt' })}</span></div>`;
  } else {
    const ct = txt(ctx, b.consent, 'inline');
    if (ct) {
      const id = `f-${bid}-_consent`;
      consent = `<div class="lp-field lp-field-check lp-consent" data-lp-field="_consent"><label class="lp-check" for="${id}">`
        + `<input class="lp-check-in" type="checkbox" id="${id}" name="_consent" value="yes" required aria-required="true" aria-describedby="${id}-err">`
        + `<span class="lp-check-t">${ct}<span class="lp-req" aria-hidden="true">*</span></span></label>`
        + `<span class="lp-err" id="${id}-err" data-lp-err="_consent"></span></div>`;
    }
  }
  if (!ctx.edit && !body && !consent) return ''; // nothing to fill in
  if (ctx.edit) {
    const lab = fld(ctx, b, 'submit', 'plain', 'span', '', null, { ph: uiText('formSubmit', ctx.lang, ctx.doc), ecls: 'lp-bb-auto' });
    // A form nobody receives: no usable request and no valid fallback address.
    const lost = !dest.req && !(['mailto', 'whatsapp', 'telegram'].includes(dest.fb) && dest.to);
    const warn = lost ? `<p class="lp-formb-warn" role="note">${icon(ctx, 'warning')}<span>${escapeHTML(bbPh(ctx, 'phb.noDest'))}</span></p>` : '';
    bbVariant(ctx, 'form', variant);
    return `<div class="lp-formb lp-formb-${variant}">${title}<div class="lp-form" data-lp-form="${bid}">${body}${consent}`
      + `<div class="lp-field lp-form-actions"><span class="lp-btn lp-btn-primary lp-fm-submit">${lab}</span></div></div>${warn}</div>`;
  }
  // View: usage for the exporter/runtime (feature form, runtime strings, request, cfg.forms entry).
  feature(ctx, 'form');
  needUi(ctx, ...BB_FORM_UI);
  if (dest.req && ctx.use.reqs instanceof Set) ctx.use.reqs.add(dest.req.id);
  if (!(ctx.use.forms instanceof Map)) ctx.use.forms = new Map();
  ctx.use.forms.set(str(b.id), { req: dest.req ? dest.req.id : null, fb: dest.fb, to: dest.to });
  let fa = ` class="lp-form" data-lp-form="${bid}" novalidate`;
  if (dest.action) fa += ` action="${escapeAttr(dest.action)}" method="post"${dest.mailto ? ' enctype="text/plain"' : ''}`;
  if (tid) fa += ` aria-labelledby="${tid}"`;
  const jsOnly = !dest.action;
  const label = has(ctx, b.submit) ? txt(ctx, b.submit) : ui(ctx, 'formSubmit');
  const btn = `<button type="submit" class="lp-btn lp-btn-primary lp-fm-submit${jsOnly ? ' lp-js-only' : ''}">${label}</button>`;
  const nojs = jsOnly ? `<p class="lp-field lp-form-nojs">${ui(ctx, 'formNoJs')}</p>` : '';
  // Custom success text, pre-rendered per language for the runtime (default: cfg.ui.formSent).
  const ok = has(ctx, b.success) ? `<div class="lp-form-ok" data-lp-form-ok hidden>${txt(ctx, b.success)}</div>` : '';
  const result = '<div class="lp-form-result" data-lp-form-result role="status" aria-live="polite" tabindex="-1" hidden></div>';
  bbVariant(ctx, 'form', variant);
  return `<div class="lp-formb lp-formb-${variant}">${title}<form${fa}>${body}${consent}`
    + `<div class="lp-field lp-form-actions">${btn}</div>${nojs}${ok}${result}</form></div>`;
}

/* ---------- registry ---------- */

const bbBtnItemSchema = () => [
  { key: 'label', type: 'i18n', label: 'f.label' },
  { key: 'href', type: 'text', label: 'f.href', suggest: 'anchors' },
  { key: 'kind', type: 'select', label: 'f.btnKind', options: optList('primary', 'secondary', 'ghost') },
  { key: 'icon', type: 'icon', label: 'f.icon' },
];
const bbField = (key, type, required, half) => ({ id: uid(), key, type, label: {}, ph: {}, options: {}, required, half });

const BT_B = {
  timeline: {
    category: 'content', icon: 'timeline', container: false, variants: ['variant'],
    i18nFields: [], itemI18nFields: ['title', 'html'], itemRichFields: { html: 'rich' }, itemLabel: 'title',
    defaults: () => ({ variant: 'line', items: [] }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('line', 'alternate') },
    ],
    itemSchema: [
      { key: 'date', type: 'text', label: 'f.date', hint: 'fh.tlDate' },
      { key: 'title', type: 'i18n', label: 'f.title' },
      { key: 'image', type: 'att', label: 'f.image', accept: 'image/' },
    ],
    itemDefaults: () => ({ id: uid(), date: '', title: {}, html: {}, image: null }),
    render: bbTlRender,
  },
  team: {
    category: 'content', icon: 'user', container: false, variants: ['variant'],
    i18nFields: [], itemI18nFields: ['name', 'role', 'html'], itemRichFields: { html: 'rich' }, itemLabel: 'name',
    defaults: () => ({ variant: 'cards', columns: 3, items: [] }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('cards', 'round', 'list') },
      { key: 'columns', type: 'select', label: 'f.columns', options: numOpts(2, 3, 4) },
    ],
    itemSchema: [
      { key: 'photo', type: 'att', label: 'f.photo', accept: 'image/' },
      { key: 'name', type: 'i18n', label: 'f.name' },
      { key: 'role', type: 'i18n', label: 'f.role' },
      { key: 'href', type: 'text', label: 'f.href', suggest: 'anchors' },
    ],
    itemDefaults: () => ({ id: uid(), photo: null, name: {}, role: {}, html: {}, href: '' }),
    render: bbTmRender,
  },
  testimonials: {
    category: 'content', icon: 'quote', container: false, variants: ['variant'],
    i18nFields: [], itemI18nFields: ['html', 'name', 'role', 'source'], itemRichFields: { html: 'rich' }, itemLabel: 'name',
    defaults: () => ({ variant: 'cards', columns: 3, summary: false, autoplay: 0, items: [] }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('cards', 'large', 'slider', 'quote') },
      { key: 'columns', type: 'select', label: 'f.columns', options: numOpts(2, 3, 4), when: { variant: ['cards', 'slider'] } },
      { key: 'autoplay', type: 'range', label: 'f.autoplay', hint: 'fh.autoplay', min: 0, max: 15, step: 1, unit: ' s', when: { variant: 'quote' } },
      { key: 'summary', type: 'checkbox', label: 'f.tsSummary', hint: 'fh.tsSummary' },
    ],
    itemSchema: [
      { key: 'name', type: 'i18n', label: 'f.name' },
      { key: 'role', type: 'i18n', label: 'f.role' },
      { key: 'photo', type: 'att', label: 'f.photo', accept: 'image/' },
      { key: 'rating', type: 'range', label: 'f.rating', min: 0, max: 5, step: 1 },
      { key: 'source', type: 'i18n', label: 'f.tsSource', hint: 'fh.tsSource' },
      { key: 'href', type: 'text', label: 'f.tsLink', suggest: 'anchors', placeholder: 'pl.href' },
    ],
    itemDefaults: () => ({ id: uid(), html: {}, name: {}, role: {}, photo: null, rating: 5, source: {}, href: '' }),
    render: bbTsRender,
  },
  logos: {
    category: 'content', icon: 'award', container: false, variants: ['variant'],
    i18nFields: [], itemI18nFields: ['name'], itemLabel: 'name',
    defaults: () => ({ variant: 'grid', mono: true, speed: 40, items: [] }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('grid', 'strip', 'marquee') },
      { key: 'speed', type: 'range', label: 'f.mqSpeed', hint: 'fh.mqSpeed', min: 10, max: 180, step: 5, unit: ' s', when: { variant: 'marquee' } },
      { key: 'mono', type: 'checkbox', label: 'f.mono' },
    ],
    itemSchema: [
      { key: 'att', type: 'att', label: 'f.logo', accept: 'image/' },
      { key: 'name', type: 'i18n', label: 'f.name' },
      { key: 'href', type: 'text', label: 'f.href', suggest: 'anchors' },
    ],
    itemDefaults: () => ({ id: uid(), att: null, name: {}, href: '' }),
    render: bbLgRender,
  },
  faq: {
    category: 'content', icon: 'info', container: false, variants: ['variant'],
    i18nFields: [], itemI18nFields: ['q', 'html'], itemRichFields: { html: 'rich' }, itemLabel: 'q',
    defaults: () => ({ variant: 'details', openFirst: true, single: false, items: [] }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('details', 'cards') },
      { key: 'openFirst', type: 'checkbox', label: 'f.openFirst', when: { variant: 'details' } },
      { key: 'single', type: 'checkbox', label: 'f.single', hint: 'fh.single', when: { variant: 'details' } },
    ],
    itemSchema: [
      { key: 'q', type: 'i18n', label: 'f.question' },
    ],
    itemDefaults: () => ({ id: uid(), q: {}, html: {} }),
    render: bbFaqRender,
  },
  cta: {
    category: 'content', icon: 'rocket', container: false, full: true, variants: ['variant'],
    i18nFields: ['title', 'html'], itemI18nFields: ['label'], richFields: { html: 'rich' }, itemLabel: 'label',
    defaults: () => ({ title: {}, html: {}, items: [], variant: 'banner', tone: 'accent', bg: null, overlay: 55, logo: null }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('banner', 'split', 'card', 'strip') },
      { key: 'logo', type: 'att', label: 'f.logo', accept: 'image/' },
      { key: 'tone', type: 'select', label: 'f.tone', options: TONES.map((v) => ({ v, l: v === 'auto' ? 'o.toneAuto' : 'o.' + v })) },
      { key: 'bg', type: 'att', label: 'f.bg', accept: 'image/' },
      { key: 'overlay', type: 'range', label: 'f.overlay', min: 0, max: 90, step: 5, unit: '%' },
    ],
    itemSchema: bbBtnItemSchema(),
    itemDefaults: () => ({ id: uid(), label: {}, href: '', kind: 'primary', icon: '' }),
    render: bbCtaRender,
  },
  contact: {
    category: 'content', icon: 'location', container: false, variants: ['variant'],
    i18nFields: [], itemI18nFields: ['label'], itemLabel: 'value',
    defaults: () => ({ variant: 'cards', labels: true, map: null, mapHref: '', items: [] }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('cards', 'list', 'split') },
      { key: 'labels', type: 'checkbox', label: 'f.showLabels' },
      { key: 'map', type: 'att', label: 'f.map', accept: 'image/' },
      { key: 'mapHref', type: 'text', label: 'f.mapHref', hint: 'fh.mapHref', placeholder: 'fh.mapHrefPh' },
    ],
    itemSchema: [
      { key: 'kind', type: 'select', label: 'f.ctKind', options: BB_CT_KINDS.map((k) => ({ v: k, l: 'ct.' + k })) },
      { key: 'value', type: 'textarea', label: 'f.value', rows: 2, hint: 'fh.ctValue' },
      { key: 'label', type: 'i18n', label: 'f.label' },
      { key: 'href', type: 'text', label: 'f.href', hint: 'fh.ctHref', suggest: 'anchors' },
    ],
    itemDefaults: () => ({ id: uid(), kind: 'email', value: '', label: {}, href: '' }),
    render: bbCtRender,
  },
  table: {
    category: 'content', icon: 'table', container: false, variants: ['variant'],
    i18nFields: ['caption'], richFields: { 'rows.*.*.html': 'rich' },
    defaults: () => ({
      rows: [0, 1, 2].map(() => [emptyCell(), emptyCell(), emptyCell()]),
      cols: [{ w: null }, { w: null }, { w: null }],
      header: 'row', variant: 'grid', compact: false, caption: {}, width: 100,
    }),
    schema: [
      { key: 'header', type: 'select', label: 'f.header', options: optList('row', 'col', 'both', 'none') },
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('grid', 'lines', 'minimal', 'striped', 'none') },
      { key: 'compact', type: 'checkbox', label: 'f.compact' },
      { key: 'width', type: 'range', label: 'f.width', min: 30, max: 100, step: 1, unit: '%' },
    ],
    render: bbTbRender,
  },
  form: {
    category: 'content', icon: 'note', container: false, variants: ['variant'],
    i18nFields: ['title', 'submit', 'success', 'consent'], itemI18nFields: ['label', 'ph', 'options'],
    richFields: { consent: 'inline' }, itemLabel: 'key',
    defaults: () => ({
      title: {}, submit: {}, req: null, fallback: 'mailto', to: '', success: {}, consent: {}, variant: 'card',
      items: [bbField('name', 'text', true, true), bbField('email', 'email', true, true), bbField('message', 'textarea', false, false)],
    }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('card', 'plain') },
      { key: 'req', type: 'req', label: 'f.req', hint: 'fh.formReq' },
      { key: 'fallback', type: 'select', label: 'f.fallback', hint: 'fh.formFallback',
        options: [...optList('mailto', 'whatsapp', 'telegram', 'outbox'), { v: 'none', l: 'o.fbNone' }] },
      { key: 'to', type: 'text', label: 'f.to', hint: 'fh.formTo', when: { fallback: ['mailto', 'whatsapp', 'telegram'] } },
      { key: 'success', type: 'i18n', label: 'f.success', multiline: true, rows: 2 },
    ],
    itemSchema: [
      { key: 'key', type: 'text', label: 'f.fieldKey', hint: 'fh.fieldKey' },
      { key: 'type', type: 'select', label: 'f.fieldType', options: optList(...BB_FIELD_TYPES) },
      { key: 'label', type: 'i18n', label: 'f.label' },
      { key: 'ph', type: 'i18n', label: 'f.ph', when: { type: ['text', 'email', 'tel', 'textarea', 'select', 'number'] } },
      { key: 'options', type: 'i18n', label: 'f.options', multiline: true, rows: 4, hint: 'fh.fieldOptions', when: { type: 'select' } },
      { key: 'required', type: 'checkbox', label: 'f.required' },
      { key: 'half', type: 'checkbox', label: 'f.half' },
    ],
    itemDefaults: () => ({ id: uid(), key: 'field_' + uid().slice(0, 4), type: 'text', label: {}, ph: {}, options: {}, required: false, half: false }),
    render: bbFmRender,
  },
};

/* ---------- CSS (tree-shaken per used type / variant; tokens of CONTRACT.md §13 only) ----------
   Every block is its own size container (`lp-<abbr>`), so a block inside a narrow column adapts like on a phone;
   thresholds follow the page model: 900px (tablet) and 600px (phone). No uppercase transforms (Georgian). */

const CSS_BLOCKS_B = {
  timeline: `
.lp-b-timeline{container:lp-tl/inline-size}
.lp-tl{--lp-tl-x:12px;list-style:none;margin:0;padding:0;position:relative;display:flex;flex-direction:column;gap:clamp(22px,3.4cqi,38px)}
.lp-tl::before{content:"";position:absolute;top:12px;bottom:12px;inset-inline-start:var(--lp-tl-x);width:2px;margin-inline-start:-1px;border-radius:2px;background:linear-gradient(to bottom,var(--lp-accent),color-mix(in srgb,var(--lp-accent) 14%,transparent))}
.lp-tl-item{position:relative;min-width:0;padding-inline-start:calc(var(--lp-tl-x) * 2 + 20px)}
.lp-tl-dot{position:absolute;top:5px;inset-inline-start:calc(var(--lp-tl-x) - 9px);width:18px;height:18px;border-radius:50%;background:var(--lp-bg);border:3px solid var(--lp-accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--lp-accent) 13%,transparent)}
.lp-tl-card{min-width:0}
.lp-tl-date{display:inline-block;margin:0 0 .5em;padding:.2em .75em;border-radius:99px;background:var(--lp-tint);color:var(--lp-accent);font-size:.82em;font-weight:700;line-height:1.45;letter-spacing:.02em;font-variant-numeric:tabular-nums}
.lp-tl-title{margin:0 0 .35em;font-family:var(--lp-font-h);font-size:clamp(1.08em,1em + .45cqi,1.32em);line-height:1.25;overflow-wrap:break-word}
.lp-tl-text{color:var(--lp-muted)}
.lp-tl-media{margin-top:16px;max-width:min(100%,560px);border-radius:var(--lp-radius);overflow:hidden}
.lp-root[data-mode=edit] .lp-tl-nodate{opacity:.55;font-style:italic;font-weight:500}
`,
  team: `
.lp-b-team{container:lp-tm/inline-size}
.lp-tm{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(18px,2.6cqi,32px)}
.lp-tm-c2{grid-template-columns:repeat(2,minmax(0,1fr))}
.lp-tm-c4{grid-template-columns:repeat(4,minmax(0,1fr))}
.lp-tm-item{min-width:0;margin:0}
.lp-tm-body{min-width:0}
.lp-tm-name{margin:0;font-family:var(--lp-font-h);font-size:1.14em;line-height:1.3;overflow-wrap:break-word}
.lp-tm-a{color:inherit;text-decoration:none}
.lp-tm-a:hover{color:var(--lp-accent);text-decoration:underline;text-underline-offset:.18em}
.lp-tm-role{margin:.3em 0 0;color:var(--lp-accent);font-size:.92em;font-weight:600;line-height:1.4}
.lp-tm-bio{margin-top:.75em;color:var(--lp-muted);font-size:.95em}
@container lp-tm (max-width:900px){.lp-tm-c3,.lp-tm-c4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container lp-tm (max-width:600px){.lp-tm{grid-template-columns:minmax(0,1fr)}}
`,
  testimonials: `
.lp-b-testimonials{container:lp-ts/inline-size}
.lp-ts{--lp-ts-gap:clamp(16px,2.6cqi,30px)}
.lp-ts-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--lp-ts-gap)}
.lp-ts-c2 .lp-ts-list{grid-template-columns:repeat(2,minmax(0,1fr))}
.lp-ts-c4 .lp-ts-list{grid-template-columns:repeat(4,minmax(0,1fr))}
.lp-ts-item{min-width:0;display:flex}
.lp-ts-fig{position:relative;flex:1;display:flex;flex-direction:column;gap:16px;margin:0;min-width:0}
.lp-ts-fig.lp-card::after{content:"“";position:absolute;top:6px;inset-inline-end:18px;font-family:Georgia,"Times New Roman",serif;font-size:4.6em;line-height:1;color:var(--lp-accent);opacity:.14;pointer-events:none}
.lp-ts-q{margin:0;flex:1;font-size:1.02em;line-height:1.65}
.lp-ts-by{display:flex;align-items:center;gap:12px;min-width:0}
.lp-ts-photo{flex:none;width:48px;margin:0}
.lp-ts-who{display:flex;flex-direction:column;min-width:0;line-height:1.35}
.lp-ts-name{font-weight:700;overflow-wrap:break-word}
.lp-ts-role{color:var(--lp-muted);font-size:.88em;overflow-wrap:break-word}
.lp-ts-src{margin-top:2px;color:var(--lp-muted);font-size:.82em;font-weight:600;letter-spacing:.01em}
.lp-ts-src a{color:inherit;text-decoration:underline;text-decoration-color:color-mix(in srgb,currentColor 40%,transparent);text-underline-offset:.16em}
.lp-ts-src a:hover{color:var(--lp-accent)}
.lp-ts-sum{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 12px;margin:0 0 clamp(20px,3cqi,32px);text-align:center}
.lp-ts-sum .lp-stars-i .lp-star{width:1.3em;height:1.3em}
.lp-ts-cnt{font-family:var(--lp-font-h);font-size:1.12em;font-weight:600}
.lp-stars{display:flex;line-height:0}
.lp-stars-i{display:inline-flex;gap:3px;color:var(--lp-accent2,var(--lp-accent))}
.lp-star{width:1.05em;height:1.05em;stroke-width:1.6;opacity:.35}
.lp-star.lp-on{fill:currentColor;opacity:1}
@container lp-ts (max-width:900px){.lp-ts-c3 .lp-ts-list,.lp-ts-c4 .lp-ts-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container lp-ts (max-width:600px){.lp-ts-list,:is(.lp-ts-c2,.lp-ts-c3,.lp-ts-c4) .lp-ts-list{grid-template-columns:minmax(0,1fr)}}
`,
  logos: `
.lp-b-logos{container:lp-lg/inline-size}
.lp-logos{list-style:none;margin:0;padding:0}
.lp-logo{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center}
.lp-logo-a{display:flex;align-items:center;justify-content:center;max-width:100%;color:inherit;text-decoration:none;border-radius:var(--lp-radius-s)}
.lp-logo-img{display:block;max-width:100%;width:auto;height:auto;max-height:var(--lp-logo-h,56px);object-fit:contain}
.lp-logo-name{font-family:var(--lp-font-h);font-size:1.18em;font-weight:700;line-height:1.2;letter-spacing:-.01em;color:var(--lp-muted);overflow-wrap:anywhere}
.lp-logo-a:hover .lp-logo-name{color:var(--lp-text)}
.lp-logos-mono .lp-logo-img{filter:var(--lp-mono,grayscale(1));opacity:.7;transition:filter .3s var(--lp-ease,ease),opacity .3s var(--lp-ease,ease)}
.lp-logos-mono .lp-logo:hover .lp-logo-img,.lp-logos-mono .lp-logo-a:focus-visible .lp-logo-img{filter:none;opacity:1}
.lp-logo-cap{font-size:.78em;color:var(--lp-muted)}
.lp-logo-ph{width:min(100%,160px)}
@media (prefers-reduced-motion:reduce){.lp-logos-mono .lp-logo-img{transition:none}}
`,
  faq: `
.lp-b-faq{container:lp-faq/inline-size}
.lp-faq{display:grid;gap:12px}
.lp-faq-q{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0;font-family:var(--lp-font-h);font-size:1.06em;font-weight:650;line-height:1.38}
.lp-faq-qt{min-width:0;overflow-wrap:break-word}
.lp-faq-a{color:var(--lp-muted)}
.lp-faq-ic{flex:none;width:30px;height:30px;padding:6px;border-radius:50%;background:var(--lp-tint);color:var(--lp-accent);stroke-width:2.2;transition:transform .25s var(--lp-ease,ease)}
@media (prefers-reduced-motion:reduce){.lp-faq-ic{transition:none}}
`,
  cta: `
.lp-b-cta{container:lp-cta/inline-size}
.lp-cta{position:relative;isolation:isolate;overflow:hidden;color:var(--lp-text)}
.lp-cta-bg{position:absolute;inset:0;z-index:-2;display:block;width:100%;height:100%;object-fit:cover}
.lp-cta-ov{position:absolute;inset:0;z-index:-1;background:var(--lp-bg);opacity:var(--lp-ov,.55)}
.lp-cta-box{position:relative;display:flex;flex-direction:column;align-items:center;gap:clamp(18px,2.6cqi,30px);text-align:center;min-width:0}
.lp-cta-text{display:flex;flex-direction:column;align-items:inherit;gap:14px;min-width:0;max-width:52em}
.lp-cta-t{margin:0;font-size:clamp(1.6em,1.05em + 2.4cqi,2.7em);line-height:1.12;letter-spacing:-.015em;text-wrap:balance;overflow-wrap:break-word}
.lp-cta-x{color:color-mix(in srgb,var(--lp-text) 92%,transparent);font-size:clamp(1em,.95em + .35cqi,1.16em)}
.lp-cta-act{min-width:0}
.lp-cta-act .lp-btns{justify-content:center}
.lp-cta-hasbg .lp-cta-t{text-shadow:0 1px 22px color-mix(in srgb,var(--lp-bg) 55%,transparent)}
.lp-wrap .lp-cta>.lp-wrap{max-width:none;padding-inline:clamp(20px,5cqi,56px)}
.lp-cta-logo{display:block;flex:none;width:auto;height:auto;max-height:clamp(44px,7cqi,72px);max-width:min(220px,40cqi);object-fit:contain}
.lp-root[data-mode=edit] .lp-cta-logo{cursor:pointer}
:is(.lp-cta,.lp-cta-box):is(.lp-tone-accent,.lp-tone-dark) .lp-cta-logo{padding:8px 12px;border-radius:var(--lp-radius-s,8px);background:#fff}
`,
  contact: `
.lp-b-contact{container:lp-ct/inline-size}
.lp-ct{display:grid;gap:clamp(20px,3cqi,40px);align-items:start}
.lp-ct-items{list-style:none;margin:0;padding:0;display:grid;gap:14px;min-width:0}
.lp-ct-item{display:flex;align-items:flex-start;gap:14px;min-width:0;margin:0}
.lp-ct-ic{flex:none}
.lp-ct-t{display:flex;flex-direction:column;gap:3px;min-width:0;padding-top:3px}
.lp-ct-k{font-size:.84em;font-weight:600;line-height:1.35;color:var(--lp-muted)}
.lp-ct-v{color:inherit;font-weight:600;line-height:1.45;text-decoration:none;overflow-wrap:anywhere}
.lp-root a.lp-ct-v{color:inherit;text-decoration:none}
.lp-root a.lp-ct-v:hover{color:var(--lp-accent);text-decoration:underline;text-underline-offset:.18em}
.lp-ct-map{min-width:0;border-radius:var(--lp-radius);overflow:hidden}
.lp-ct-mapa{display:block;color:inherit}
.lp-ct-maponly{overflow:visible}
.lp-root[data-mode=edit] .lp-ct-novalue{opacity:.5;font-style:italic;font-weight:500}
`,
  table: `
.lp-b-table{container:lp-tbl/inline-size}
.lp-tbl{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
.lp-tbl-t{border-collapse:collapse;border-spacing:0;font-size:.95em;line-height:1.45;color:inherit}
.lp-tbl-fixed{table-layout:fixed}
.lp-tbl-t th,.lp-tbl-t td{padding:.62em .85em;vertical-align:top;text-align:start;min-width:2em;overflow-wrap:normal;word-break:normal;-webkit-hyphens:auto;hyphens:auto}
.lp-tbl-t th{font-weight:700}
.lp-tbl-t p{margin:0 0 .35em}
.lp-tbl-t td>:last-child,.lp-tbl-t th>:last-child,.lp-tbl-t [data-l]>:last-child{margin-bottom:0}
.lp-tbl-t ul,.lp-tbl-t ol{margin:0 0 .35em;padding-inline-start:1.2em}
.lp-tbl-t caption{caption-side:bottom;text-align:start;font-size:.84em;color:var(--lp-muted);padding-top:.6em}
.lp-tbl-compact th,.lp-tbl-compact td{padding:.32em .55em}
.lp-tbl-fixed th,.lp-tbl-fixed td{overflow-wrap:break-word}
@container lp-tbl (max-width:600px){.lp-tbl-t{width:100%!important;font-size:.9em}.lp-tbl-t th,.lp-tbl-t td{padding:.48em .62em}}
`,
  form: `
.lp-b-form{container:lp-fm/inline-size}
.lp-formb{max-width:760px;margin-inline:auto;min-width:0}
.lp-formb-t{margin:0 0 18px}
.lp-formb .lp-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 18px;align-items:start}
.lp-formb .lp-form>*{grid-column:1/-1;min-width:0}
.lp-formb .lp-form>.lp-field-half{grid-column:auto}
.lp-formb .lp-err:empty{display:none}
.lp-req{margin-inline-start:.2em;color:var(--lp-link);font-weight:700}
.lp-consent .lp-check-t{font-size:.92em;color:var(--lp-muted)}
.lp-form-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:4px}
.lp-fm-submit{min-width:min(100%,200px);justify-content:center}
.lp-form-nojs{margin:0;font-size:.9em;color:var(--lp-muted)}
html.lp-js .lp-form-nojs{display:none}
.lp-form-ok{margin-top:14px;padding:.85em 1.05em;border:1px solid color-mix(in srgb,var(--lp-ok) 35%,transparent);border-radius:var(--lp-radius-s);background:color-mix(in srgb,var(--lp-ok) 10%,transparent);font-size:.95em;line-height:1.5}
.lp-form-ok[hidden]{display:none}
.lp-formb-warn{display:flex;align-items:flex-start;gap:8px;margin:14px 0 0;padding:10px 12px;border:1px dashed color-mix(in srgb,var(--lp-accent) 55%,var(--lp-border));border-radius:var(--lp-radius-s);color:var(--lp-muted);font-size:.86em;line-height:1.4}
.lp-input-ed{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:2.85em;color:var(--lp-muted);pointer-events:none;-webkit-user-select:none;user-select:none}
.lp-input-ed.lp-textarea{min-height:7em;align-items:flex-start}
.lp-input-ph{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.75}
.lp-input-ic{flex:none;opacity:.6}
.lp-check-box{display:inline-block;flex:none;width:1.15em;height:1.15em;margin-top:.15em;border:1.5px solid color-mix(in srgb,var(--lp-text) 35%,transparent);border-radius:4px;background:var(--lp-bg)}
.lp-root[data-mode=edit] .lp-bb-auto:empty::before{font-style:normal;color:inherit;opacity:.9}
@container lp-fm (max-width:600px){.lp-formb .lp-form>.lp-field-half{grid-column:1/-1}.lp-fm-submit{width:100%}}
`,
};

const CSS_VARIANTS_B = {
  timeline: {
    'variant=line': '',
    'variant=alternate': `
.lp-tl-alternate{--lp-tl-x:50%}
.lp-tl-alternate .lp-tl-item{width:50%;padding-inline:0 40px}
.lp-tl-alternate .lp-tl-item:nth-child(even){margin-inline-start:50%;padding-inline:40px 0}
.lp-tl-alternate .lp-tl-dot{inset-inline-start:auto;inset-inline-end:-9px;top:22px}
.lp-tl-alternate .lp-tl-item:nth-child(even) .lp-tl-dot{inset-inline-start:-9px;inset-inline-end:auto}
.lp-tl-alternate .lp-tl-card{padding:18px 22px;border:1px solid var(--lp-border);border-radius:var(--lp-radius);background:var(--lp-surface);box-shadow:var(--lp-shadow)}
@container lp-tl (max-width:600px){.lp-tl-alternate{--lp-tl-x:12px}.lp-tl-alternate .lp-tl-item,.lp-tl-alternate .lp-tl-item:nth-child(even){width:auto;margin-inline-start:0;padding-inline:44px 0}.lp-tl-alternate .lp-tl-dot,.lp-tl-alternate .lp-tl-item:nth-child(even) .lp-tl-dot{inset-inline-start:3px;inset-inline-end:auto}}
`,
  },
  team: {
    'variant=cards': `
.lp-tm-cards .lp-tm-item{display:flex;flex-direction:column;padding:0;overflow:hidden}
.lp-tm-cards .lp-tm-photo{border-radius:0}
.lp-tm-cards .lp-tm-body{padding:18px 22px 22px}
`,
    'variant=round': `
.lp-tm-round .lp-tm-item{text-align:center}
.lp-tm-round .lp-tm-photo{width:min(160px,62%);margin:0 auto 16px;box-shadow:0 0 0 6px var(--lp-tint)}
@container lp-tm (max-width:600px){.lp-tm-round{grid-template-columns:repeat(2,minmax(0,1fr))}.lp-tm-round .lp-tm-photo{width:min(120px,80%)}}
`,
    'variant=list': `
.lp-tm-list .lp-tm-item{display:flex;align-items:flex-start;gap:18px;padding:16px 0;border-top:1px solid var(--lp-border)}
.lp-tm-list .lp-tm-photo{flex:none;width:88px}
.lp-tm-list .lp-tm-body{flex:1;padding-top:4px}
@container lp-tm (max-width:600px){.lp-tm-list .lp-tm-photo{width:64px}}
`,
  },
  testimonials: {
    'variant=cards': '',
    'variant=large': `
.lp-ts-large .lp-ts-list{grid-template-columns:minmax(0,1fr);gap:clamp(32px,5cqi,64px);max-width:860px;margin-inline:auto}
.lp-ts-large .lp-ts-item+.lp-ts-item{padding-top:clamp(32px,5cqi,64px);border-top:1px solid var(--lp-border)}
.lp-ts-large .lp-ts-fig{align-items:center;text-align:center;gap:22px}
.lp-ts-large .lp-ts-q{font-family:var(--lp-font-h);font-size:clamp(1.22em,1em + 1.1cqi,1.7em);line-height:1.45;letter-spacing:-.01em;text-wrap:balance}
.lp-ts-large .lp-ts-q::before{content:"“";display:block;height:.62em;font-family:Georgia,"Times New Roman",serif;font-size:2.6em;line-height:1;color:var(--lp-accent)}
.lp-ts-large .lp-ts-by{justify-content:center;text-align:start}
.lp-ts-large .lp-ts-photo{width:56px}
`,
    'variant=slider': `
.lp-ts-slider{position:relative}
.lp-ts-slider .lp-track{display:grid;grid-auto-flow:column;grid-template-columns:none;grid-auto-columns:calc((100% - 2 * var(--lp-ts-gap)) / 3);overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;padding:6px 2px 18px;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--lp-text) 25%,transparent) transparent}
.lp-ts-slider.lp-ts-c2 .lp-track{grid-auto-columns:calc((100% - var(--lp-ts-gap)) / 2)}
.lp-ts-slider.lp-ts-c4 .lp-track{grid-auto-columns:calc((100% - 3 * var(--lp-ts-gap)) / 4)}
.lp-ts-slider .lp-ts-item{scroll-snap-align:start}
.lp-ts-slider .lp-track:focus-visible{outline:2px solid var(--lp-accent);outline-offset:4px;border-radius:var(--lp-radius)}
.lp-slide-nav{display:flex;justify-content:flex-end;gap:10px;margin-top:4px}
.lp-slide-btn{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;padding:0;border:1px solid var(--lp-border);border-radius:50%;background:var(--lp-surface);color:var(--lp-text);font:inherit;cursor:pointer;box-shadow:var(--lp-shadow);transition:background-color .2s,color .2s,border-color .2s}
.lp-slide-btn:hover{background:var(--lp-accent);border-color:var(--lp-accent);color:var(--lp-on-accent)}
.lp-slide-btn:focus-visible{outline:2px solid var(--lp-accent);outline-offset:2px}
.lp-slide-btn:disabled{opacity:.4;cursor:default;background:var(--lp-surface);color:var(--lp-text);border-color:var(--lp-border)}
.lp-slide-btn .lp-ic{width:20px;height:20px}
[dir=rtl] .lp-slide-btn .lp-ic{transform:scaleX(-1)}
@container lp-ts (max-width:900px){.lp-ts-slider.lp-ts-c3 .lp-track,.lp-ts-slider.lp-ts-c4 .lp-track{grid-auto-columns:calc((100% - var(--lp-ts-gap)) / 2)}}
@container lp-ts (max-width:600px){.lp-ts-slider .lp-track,.lp-ts-slider.lp-ts-c2 .lp-track,.lp-ts-slider.lp-ts-c3 .lp-track,.lp-ts-slider.lp-ts-c4 .lp-track{grid-auto-columns:86%}}
@media (prefers-reduced-motion:no-preference){.lp-ts-slider .lp-track{scroll-behavior:smooth}}
.lp-root[data-mode=edit] .lp-ts-slider .lp-track{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:repeat(3,minmax(0,1fr));overflow:visible;padding:0}
.lp-root[data-mode=edit] .lp-ts-slider.lp-ts-c2 .lp-track{grid-template-columns:repeat(2,minmax(0,1fr))}
.lp-root[data-mode=edit] .lp-ts-slider.lp-ts-c4 .lp-track{grid-template-columns:repeat(4,minmax(0,1fr))}
`,
  },
  logos: {
    'variant=grid': `
.lp-logos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,160px),1fr));gap:14px}
.lp-logos-grid .lp-logo{min-height:108px;padding:20px 22px;border:1px solid var(--lp-border);border-radius:var(--lp-radius);background:var(--lp-surface)}
@container lp-lg (max-width:600px){.lp-logos-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.lp-logos-grid .lp-logo{min-height:84px;padding:14px}}
`,
    'variant=marquee': `
.lp-mqw{position:relative;display:flex;align-items:center;gap:8px}
.lp-mq{flex:1;min-width:0;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
.lp-mq-track{display:flex;width:max-content;animation:lp-mq var(--lp-mq-t,40s) linear infinite}
[dir=rtl] .lp-mq-track{animation-name:lp-mq-rtl}
.lp-logos-marquee{display:flex;flex-wrap:nowrap;align-items:center;gap:clamp(28px,5cqi,64px);padding-inline-end:clamp(28px,5cqi,64px)}
.lp-logos-marquee .lp-logo{flex:none;min-height:56px}
.lp-logos-marquee .lp-logo-img{width:auto;height:var(--lp-logo-h,40px);max-width:180px;max-height:none;object-fit:contain}
.lp-mq:hover .lp-mq-track,.lp-mq:focus-within .lp-mq-track,.lp-mq-paused .lp-mq-track{animation-play-state:paused}
@keyframes lp-mq{to{transform:translateX(-50%)}}
@keyframes lp-mq-rtl{to{transform:translateX(50%)}}
.lp-mq-btn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;padding:0;border:1px solid var(--lp-border);border-radius:50%;background:var(--lp-surface);color:var(--lp-muted);cursor:pointer}
.lp-mq-btn:hover{color:var(--lp-text)}
.lp-mq-btn:focus-visible{outline:2px solid var(--lp-accent);outline-offset:2px}
.lp-mq-btn .lp-ic{width:16px;height:16px}
.lp-mq-btn .lp-i-play,.lp-mq-btn[aria-pressed=true] .lp-i-pause{display:none}
.lp-mq-btn[aria-pressed=true] .lp-i-play{display:inline}
@media (prefers-reduced-motion:reduce){.lp-mq{-webkit-mask-image:none;mask-image:none}.lp-mq-track{animation:none;width:auto}.lp-mq-dup,.lp-mq-btn{display:none}.lp-logos-marquee{flex-wrap:wrap;justify-content:center;padding:0}}
@media print{.lp-mq-track{animation:none;width:auto}.lp-mq-dup,.lp-mq-btn{display:none}.lp-logos-marquee{flex-wrap:wrap}}
.lp-root[data-mode=edit] .lp-logos-marquee{flex-wrap:wrap;justify-content:center;padding:0}
`,
    'variant=strip': `
.lp-logos-strip{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:clamp(18px,3.4cqi,44px) clamp(28px,5.6cqi,72px)}
.lp-logos-strip .lp-logo{flex:0 1 auto;max-width:200px}
.lp-logos-strip .lp-logo-img{max-height:var(--lp-logo-h,44px)}
`,
  },
  faq: {
    'variant=details': `
.lp-faq-details{max-width:880px;margin-inline:auto}
.lp-faq-details .lp-faq-item{border:1px solid var(--lp-border);border-radius:var(--lp-radius);background:var(--lp-surface);transition:border-color .2s,box-shadow .2s}
.lp-faq-details .lp-faq-item[open],.lp-faq-details .lp-faq-open{border-color:color-mix(in srgb,var(--lp-accent) 42%,var(--lp-border));box-shadow:var(--lp-shadow)}
.lp-faq-details .lp-faq-q{padding:18px 20px 18px 22px;border-radius:inherit}
.lp-faq-details summary{list-style:none;cursor:pointer}
.lp-faq-details summary::-webkit-details-marker{display:none}
.lp-faq-details summary:hover .lp-faq-qt{color:var(--lp-accent)}
.lp-faq-details summary:focus-visible{outline:2px solid var(--lp-accent);outline-offset:2px}
.lp-faq-details .lp-faq-item[open] .lp-faq-ic,.lp-faq-details .lp-faq-open .lp-faq-ic{transform:rotate(180deg)}
.lp-faq-details .lp-faq-a{padding:0 22px 20px}
@media (prefers-reduced-motion:no-preference){.lp-faq-details .lp-faq-item[open] .lp-faq-a{animation:lp-faq-in .28s var(--lp-ease,ease)}}
@keyframes lp-faq-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
`,
    'variant=cards': `
.lp-faq-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(16px,2.4cqi,28px)}
.lp-faq-cards .lp-faq-q{display:block;margin-bottom:.55em}
@container lp-faq (max-width:600px){.lp-faq-cards{grid-template-columns:minmax(0,1fr)}}
`,
  },
  cta: {
    'variant=strip': `
.lp-cta-strip{padding-block:clamp(20px,3cqi,32px)}
.lp-cta-strip .lp-cta-box{display:flex;flex-direction:row;align-items:center;gap:clamp(16px,3cqi,36px);text-align:start}
.lp-cta-strip .lp-cta-text{flex:1;align-items:flex-start;min-width:0}
.lp-cta-strip .lp-cta-act .lp-btns{justify-content:flex-end}
.lp-cta-strip .lp-cta-t{font-size:clamp(1.2em,1em + 1cqi,1.6em);margin:0}
.lp-cta-strip .lp-cta-x{margin-top:4px}
.lp-cta-strip .lp-cta-act{flex:none;margin:0}
@container lp-cta (max-width:700px){.lp-cta-strip .lp-cta-box{flex-wrap:wrap}.lp-cta-strip .lp-cta-act{flex-basis:100%}}
`,
    'variant=banner': `
.lp-cta-banner{background:var(--lp-bg);padding-block:clamp(56px,8cqi,112px)}
.lp-cta-banner::before{content:"";position:absolute;z-index:-1;top:-40%;inset-inline-end:-12%;width:min(62%,720px);aspect-ratio:1;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--lp-accent2,var(--lp-accent)) 32%,transparent),transparent);pointer-events:none}
.lp-cta-banner.lp-cta-hasbg::before{display:none}
.lp-wrap .lp-cta-banner{border-radius:calc(var(--lp-radius) * 2)}
`,
    'variant=split': `
.lp-cta-split{background:var(--lp-bg);padding-block:clamp(44px,6cqi,84px)}
.lp-cta-split .lp-cta-box{flex-direction:row;align-items:center;justify-content:space-between;text-align:start}
.lp-cta-split .lp-cta-text{align-items:flex-start}
.lp-cta-split .lp-cta-act{flex:none;max-width:50%}
.lp-cta-split .lp-cta-act .lp-btns{justify-content:flex-end}
.lp-wrap .lp-cta-split{border-radius:calc(var(--lp-radius) * 2)}
@container lp-cta (max-width:900px){.lp-cta-split .lp-cta-box{flex-direction:column;align-items:flex-start}.lp-cta-split .lp-cta-act{max-width:none}.lp-cta-split .lp-cta-act .lp-btns{justify-content:flex-start}}
`,
    'variant=card': `
.lp-cta-card{padding-block:clamp(28px,4cqi,56px)}
.lp-cta-card .lp-cta-box{isolation:isolate;overflow:hidden;padding:clamp(32px,5.5cqi,72px) clamp(22px,5.5cqi,80px);border-radius:calc(var(--lp-radius) * 2);background:var(--lp-bg);color:var(--lp-text);box-shadow:var(--lp-shadow-lg)}
.lp-cta-card .lp-cta-box::before{content:"";position:absolute;z-index:-1;inset:auto -20% -60% auto;width:70%;aspect-ratio:1;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--lp-accent2,var(--lp-accent)) 28%,transparent),transparent);pointer-events:none}
.lp-cta-card .lp-cta-hasbg::before{display:none}
.lp-wrap .lp-cta-card{padding-block:0}
.lp-wrap .lp-cta-card>.lp-wrap{padding-inline:0}
`,
  },
  contact: {
    'variant=cards': `
.lp-ct-cards .lp-ct-items{grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:16px}
.lp-ct-cards .lp-ct-item{height:100%;padding:20px}
`,
    'variant=list': `
.lp-ct-list .lp-ct-items{gap:0;max-width:720px}
.lp-ct-list .lp-ct-item{padding:14px 0;border-bottom:1px solid var(--lp-border)}
.lp-ct-list .lp-ct-item:first-child{border-top:1px solid var(--lp-border)}
`,
    'variant=split': `
.lp-ct-split.lp-ct-hasmap{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)}
.lp-ct-split .lp-ct-items{gap:18px}
@container lp-ct (max-width:600px){.lp-ct-split.lp-ct-hasmap{grid-template-columns:minmax(0,1fr)}}
`,
  },
  table: {
    'variant=grid': `
.lp-tbs-grid th,.lp-tbs-grid td{border:1px solid var(--lp-border)}
.lp-tbs-grid th{background:var(--lp-tint)}
`,
    'variant=lines': `
.lp-tbs-lines tr{border-bottom:1px solid var(--lp-border)}
.lp-tbs-lines tr:first-child{border-top:1px solid var(--lp-border)}
.lp-tbs-lines th{color:var(--lp-accent)}
`,
    'variant=minimal': `
.lp-tbs-minimal th{border-bottom:2px solid var(--lp-accent)}
.lp-tbs-minimal td{border-bottom:1px solid var(--lp-border)}
`,
    'variant=striped': `
.lp-tbs-striped tr:nth-child(even)>td{background:color-mix(in srgb,var(--lp-text) 4.5%,transparent)}
.lp-tbs-striped th{background:var(--lp-accent);color:var(--lp-on-accent,#fff)}
`,
    'variant=none': '',
  },
  form: {
    'variant=card': `
.lp-formb-card{padding:clamp(22px,4.2cqi,44px);border:1px solid var(--lp-border);border-radius:calc(var(--lp-radius) * 1.5);background:var(--lp-surface);box-shadow:var(--lp-shadow-lg)}
`,
    'variant=plain': '',
  },
};

// Shared CSS chunks (design part, CONTRACT.md §13) used by these block types.
const BLOCK_DEPS_B = {
  timeline: ['media'], team: ['card', 'media'], testimonials: ['card', 'media'], logos: ['media'], faq: ['card'],
  cta: [], contact: ['card', 'icbox', 'media'], table: [], form: ['form'],
};

// Class prefix → owning block type (theme rule shaking). Regexes never match another block's prefix
// (.lp-ct does not match .lp-cta / .lp-cart; .lp-formb does not match the shared .lp-form).
const OWN_B = [
  [/\.lp-tl\b|\.lp-tl-/, 'timeline'], [/\.lp-tm\b|\.lp-tm-/, 'team'], [/\.lp-ts\b|\.lp-ts-|\.lp-stars?\b|\.lp-stars-/, 'testimonials'],
  [/\.lp-logos?\b|\.lp-logos?-/, 'logos'], [/\.lp-faq/, 'faq'], [/\.lp-cta/, 'cta'], [/\.lp-ct\b|\.lp-ct-/, 'contact'],
  [/\.lp-tbl|\.lp-tbs-/, 'table'], [/\.lp-formb|\.lp-fm-/, 'form'],
];

/* ---------- viewer UI strings introduced by this part ----------
   ct.*  contact kind labels · fl.*  automatic form-field labels · phb.*  edit-mode hints (editor UI language)
   BB_FORM_UI keys: runtime strings of the form feature (cfg.ui). */

const UI_B = {
  en: {
    ratingOf: 'Rated {n} out of 5', prev: 'Previous', next: 'Next', tsLabel: 'Testimonials',
    mapAlt: 'Map', openMap: 'Open the map',
    formSubmit: 'Send', formChoose: 'Choose…',
    formNoJs: 'Sending this form needs JavaScript. Please enable it or contact us directly.',
    fieldRequired: 'Please fill in this field.', fieldEmail: 'Please enter a valid e-mail address.',
    fieldTel: 'Please enter a valid phone number.', fieldNumber: 'Please enter a number.',
    fieldCheck: 'Please tick this box to continue.', fieldChoose: 'Please choose an option.',
    formSending: 'Sending…', formSent: 'Thank you! Your message has been sent.', formFailed: 'The message could not be sent.',
    formQueued: 'No connection right now: your message is saved on this device and will be sent automatically.',
    formFallback: 'You can send it another way:', formViaMail: 'Send by e-mail', formViaWhatsapp: 'Send via WhatsApp',
    formViaTelegram: 'Send via Telegram', formCopy: 'Copy the message', formCopied: 'Copied to the clipboard',
    formSubject: 'Message from the website',
    'fl.name': 'Name', 'fl.firstName': 'First name', 'fl.lastName': 'Last name', 'fl.email': 'E-mail', 'fl.phone': 'Phone',
    'fl.company': 'Company', 'fl.message': 'Message', 'fl.subject': 'Subject', 'fl.address': 'Address', 'fl.city': 'City',
    'fl.country': 'Country', 'fl.zip': 'Postal code', 'fl.website': 'Website', 'fl.date': 'Date', 'fl.quantity': 'Quantity',
    'fl.guests': 'Number of guests',
    'ct.email': 'Email', 'ct.phone': 'Phone', 'ct.whatsapp': 'WhatsApp', 'ct.telegram': 'Telegram', 'ct.viber': 'Viber',
    'ct.web': 'Website', 'ct.address': 'Address', 'ct.location': 'Location', 'ct.hours': 'Opening hours',
    'ct.instagram': 'Instagram', 'ct.facebook': 'Facebook', 'ct.youtube': 'YouTube', 'ct.tiktok': 'TikTok', 'ct.vk': 'VK',
    'ct.linkedin': 'LinkedIn', 'ct.x': 'X', 'ct.github': 'GitHub', 'ct.codeberg': 'Codeberg', 'ct.gitlab': 'GitLab',
    'ct.mastodon': 'Mastodon', 'ct.skype': 'Skype', 'ct.other': 'Other',
    'phb.date': 'Date or year', 'phb.title': 'Title', 'phb.text': 'Description…', 'phb.name': 'Name',
    'phb.role': 'Role or position', 'phb.bio': 'A short bio…', 'phb.quote': 'What the client says…', 'phb.q': 'Question',
    'phb.a': 'Answer…', 'phb.ctaTitle': 'A clear call to action', 'phb.ctaText': 'One or two supporting sentences…',
    'phb.value': 'Value (set in the panel)', 'phb.cell': '', 'phb.caption': 'Table caption', 'phb.formTitle': 'Form title',
    'phb.consent': 'Consent text (optional), e.g. I agree to the privacy policy',
    'phb.noDest': 'Nobody receives this form yet: choose a request or enter a fallback address.',
    'phb.logo': 'Brand name',
  },
  ru: {
    ratingOf: 'Оценка: {n} из 5', prev: 'Назад', next: 'Вперёд', tsLabel: 'Отзывы',
    mapAlt: 'Карта', openMap: 'Открыть карту',
    formSubmit: 'Отправить', formChoose: 'Выберите…',
    formNoJs: 'Для отправки формы нужен JavaScript. Включите его или свяжитесь с нами напрямую.',
    fieldRequired: 'Заполните это поле.', fieldEmail: 'Введите корректный адрес эл. почты.',
    fieldTel: 'Введите корректный номер телефона.', fieldNumber: 'Введите число.',
    fieldCheck: 'Отметьте этот пункт, чтобы продолжить.', fieldChoose: 'Выберите один из вариантов.',
    formSending: 'Отправка…', formSent: 'Спасибо! Ваше сообщение отправлено.', formFailed: 'Не удалось отправить сообщение.',
    formQueued: 'Сейчас нет связи: сообщение сохранено на этом устройстве и будет отправлено автоматически.',
    formFallback: 'Можно отправить другим способом:', formViaMail: 'Отправить по эл. почте', formViaWhatsapp: 'Отправить в WhatsApp',
    formViaTelegram: 'Отправить в Telegram', formCopy: 'Скопировать сообщение', formCopied: 'Скопировано в буфер обмена',
    formSubject: 'Сообщение с сайта',
    'fl.name': 'Имя', 'fl.firstName': 'Имя', 'fl.lastName': 'Фамилия', 'fl.email': 'Эл. почта', 'fl.phone': 'Телефон',
    'fl.company': 'Компания', 'fl.message': 'Сообщение', 'fl.subject': 'Тема', 'fl.address': 'Адрес', 'fl.city': 'Город',
    'fl.country': 'Страна', 'fl.zip': 'Почтовый индекс', 'fl.website': 'Сайт', 'fl.date': 'Дата', 'fl.quantity': 'Количество',
    'fl.guests': 'Количество гостей',
    'ct.email': 'Эл. почта', 'ct.phone': 'Телефон', 'ct.whatsapp': 'WhatsApp', 'ct.telegram': 'Telegram', 'ct.viber': 'Viber',
    'ct.web': 'Сайт', 'ct.address': 'Адрес', 'ct.location': 'Местоположение', 'ct.hours': 'Часы работы',
    'ct.instagram': 'Instagram', 'ct.facebook': 'Facebook', 'ct.youtube': 'YouTube', 'ct.tiktok': 'TikTok', 'ct.vk': 'ВКонтакте',
    'ct.linkedin': 'LinkedIn', 'ct.x': 'X', 'ct.github': 'GitHub', 'ct.codeberg': 'Codeberg', 'ct.gitlab': 'GitLab',
    'ct.mastodon': 'Mastodon', 'ct.skype': 'Skype', 'ct.other': 'Другое',
    'phb.date': 'Дата или год', 'phb.title': 'Заголовок', 'phb.text': 'Описание…', 'phb.name': 'Имя',
    'phb.role': 'Роль или должность', 'phb.bio': 'Пара слов о человеке…', 'phb.quote': 'Что говорит клиент…', 'phb.q': 'Вопрос',
    'phb.a': 'Ответ…', 'phb.ctaTitle': 'Понятный призыв к действию', 'phb.ctaText': 'Одно-два поясняющих предложения…',
    'phb.value': 'Значение (задаётся в панели)', 'phb.cell': '', 'phb.caption': 'Подпись к таблице', 'phb.formTitle': 'Заголовок формы',
    'phb.consent': 'Текст согласия (необязательно), например: Я согласен с политикой конфиденциальности',
    'phb.noDest': 'Эту форму пока никто не получает: выберите запрос или укажите резервный адрес.',
    'phb.logo': 'Название бренда',
  },
  uk: {
    ratingOf: 'Оцінка: {n} з 5', prev: 'Назад', next: 'Далі', tsLabel: 'Відгуки',
    mapAlt: 'Мапа', openMap: 'Відкрити мапу',
    formSubmit: 'Надіслати', formChoose: 'Виберіть…',
    formNoJs: 'Для надсилання форми потрібен JavaScript. Увімкніть його або зв’яжіться з нами напряму.',
    fieldRequired: 'Заповніть це поле.', fieldEmail: 'Введіть коректну адресу ел. пошти.',
    fieldTel: 'Введіть коректний номер телефону.', fieldNumber: 'Введіть число.',
    fieldCheck: 'Позначте цей пункт, щоб продовжити.', fieldChoose: 'Виберіть один із варіантів.',
    formSending: 'Надсилання…', formSent: 'Дякуємо! Ваше повідомлення надіслано.', formFailed: 'Не вдалося надіслати повідомлення.',
    formQueued: 'Зараз немає зв’язку: повідомлення збережено на цьому пристрої й буде надіслано автоматично.',
    formFallback: 'Можна надіслати іншим способом:', formViaMail: 'Надіслати ел. поштою', formViaWhatsapp: 'Надіслати у WhatsApp',
    formViaTelegram: 'Надіслати в Telegram', formCopy: 'Скопіювати повідомлення', formCopied: 'Скопійовано в буфер обміну',
    formSubject: 'Повідомлення із сайту',
    'fl.name': 'Ім’я', 'fl.firstName': 'Ім’я', 'fl.lastName': 'Прізвище', 'fl.email': 'Ел. пошта', 'fl.phone': 'Телефон',
    'fl.company': 'Компанія', 'fl.message': 'Повідомлення', 'fl.subject': 'Тема', 'fl.address': 'Адреса', 'fl.city': 'Місто',
    'fl.country': 'Країна', 'fl.zip': 'Поштовий індекс', 'fl.website': 'Сайт', 'fl.date': 'Дата', 'fl.quantity': 'Кількість',
    'fl.guests': 'Кількість гостей',
    'ct.email': 'Ел. пошта', 'ct.phone': 'Телефон', 'ct.whatsapp': 'WhatsApp', 'ct.telegram': 'Telegram', 'ct.viber': 'Viber',
    'ct.web': 'Сайт', 'ct.address': 'Адреса', 'ct.location': 'Місцезнаходження', 'ct.hours': 'Години роботи',
    'ct.instagram': 'Instagram', 'ct.facebook': 'Facebook', 'ct.youtube': 'YouTube', 'ct.tiktok': 'TikTok', 'ct.vk': 'VK',
    'ct.linkedin': 'LinkedIn', 'ct.x': 'X', 'ct.github': 'GitHub', 'ct.codeberg': 'Codeberg', 'ct.gitlab': 'GitLab',
    'ct.mastodon': 'Mastodon', 'ct.skype': 'Skype', 'ct.other': 'Інше',
    'phb.date': 'Дата або рік', 'phb.title': 'Заголовок', 'phb.text': 'Опис…', 'phb.name': 'Ім’я',
    'phb.role': 'Роль або посада', 'phb.bio': 'Кілька слів про людину…', 'phb.quote': 'Що каже клієнт…', 'phb.q': 'Питання',
    'phb.a': 'Відповідь…', 'phb.ctaTitle': 'Зрозумілий заклик до дії', 'phb.ctaText': 'Одне-два пояснювальні речення…',
    'phb.value': 'Значення (задається в панелі)', 'phb.cell': '', 'phb.caption': 'Підпис до таблиці', 'phb.formTitle': 'Заголовок форми',
    'phb.consent': 'Текст згоди (необов’язково), наприклад: Я погоджуюся з політикою конфіденційності',
    'phb.noDest': 'Цю форму поки ніхто не отримує: виберіть запит або вкажіть резервну адресу.',
    'phb.logo': 'Назва бренду',
  },
  de: {
    ratingOf: 'Bewertet mit {n} von 5', prev: 'Zurück', next: 'Weiter', tsLabel: 'Kundenstimmen',
    mapAlt: 'Karte', openMap: 'Karte öffnen',
    formSubmit: 'Senden', formChoose: 'Bitte wählen…',
    formNoJs: 'Zum Senden dieses Formulars wird JavaScript benötigt. Bitte aktivieren Sie es oder kontaktieren Sie uns direkt.',
    fieldRequired: 'Bitte füllen Sie dieses Feld aus.', fieldEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
    fieldTel: 'Bitte geben Sie eine gültige Telefonnummer ein.', fieldNumber: 'Bitte geben Sie eine Zahl ein.',
    fieldCheck: 'Bitte setzen Sie das Häkchen, um fortzufahren.', fieldChoose: 'Bitte wählen Sie eine Option.',
    formSending: 'Wird gesendet…', formSent: 'Vielen Dank! Ihre Nachricht wurde gesendet.', formFailed: 'Die Nachricht konnte nicht gesendet werden.',
    formQueued: 'Gerade keine Verbindung: Ihre Nachricht ist auf diesem Gerät gespeichert und wird automatisch gesendet.',
    formFallback: 'Sie können sie auch anders senden:', formViaMail: 'Per E-Mail senden', formViaWhatsapp: 'Per WhatsApp senden',
    formViaTelegram: 'Per Telegram senden', formCopy: 'Nachricht kopieren', formCopied: 'In die Zwischenablage kopiert',
    formSubject: 'Nachricht von der Website',
    'fl.name': 'Name', 'fl.firstName': 'Vorname', 'fl.lastName': 'Nachname', 'fl.email': 'E-Mail', 'fl.phone': 'Telefon',
    'fl.company': 'Unternehmen', 'fl.message': 'Nachricht', 'fl.subject': 'Betreff', 'fl.address': 'Adresse', 'fl.city': 'Ort',
    'fl.country': 'Land', 'fl.zip': 'Postleitzahl', 'fl.website': 'Website', 'fl.date': 'Datum', 'fl.quantity': 'Menge',
    'fl.guests': 'Anzahl der Gäste',
    'ct.email': 'E-Mail', 'ct.phone': 'Telefon', 'ct.whatsapp': 'WhatsApp', 'ct.telegram': 'Telegram', 'ct.viber': 'Viber',
    'ct.web': 'Website', 'ct.address': 'Adresse', 'ct.location': 'Standort', 'ct.hours': 'Öffnungszeiten',
    'ct.instagram': 'Instagram', 'ct.facebook': 'Facebook', 'ct.youtube': 'YouTube', 'ct.tiktok': 'TikTok', 'ct.vk': 'VK',
    'ct.linkedin': 'LinkedIn', 'ct.x': 'X', 'ct.github': 'GitHub', 'ct.codeberg': 'Codeberg', 'ct.gitlab': 'GitLab',
    'ct.mastodon': 'Mastodon', 'ct.skype': 'Skype', 'ct.other': 'Sonstiges',
    'phb.date': 'Datum oder Jahr', 'phb.title': 'Titel', 'phb.text': 'Beschreibung…', 'phb.name': 'Name',
    'phb.role': 'Rolle oder Position', 'phb.bio': 'Ein paar Worte zur Person…', 'phb.quote': 'Was der Kunde sagt…', 'phb.q': 'Frage',
    'phb.a': 'Antwort…', 'phb.ctaTitle': 'Ein klarer Handlungsaufruf', 'phb.ctaText': 'Ein, zwei erklärende Sätze…',
    'phb.value': 'Wert (im Panel festlegen)', 'phb.cell': '', 'phb.caption': 'Tabellenbeschriftung', 'phb.formTitle': 'Formulartitel',
    'phb.consent': 'Einwilligungstext (optional), z. B. Ich stimme der Datenschutzerklärung zu',
    'phb.noDest': 'Dieses Formular empfängt noch niemand: Wählen Sie eine Anfrage oder geben Sie eine Ersatzadresse an.',
    'phb.logo': 'Markenname',
  },
  fr: {
    ratingOf: 'Note : {n} sur 5', prev: 'Précédent', next: 'Suivant', tsLabel: 'Témoignages',
    mapAlt: 'Carte', openMap: 'Ouvrir la carte',
    formSubmit: 'Envoyer', formChoose: 'Choisissez…',
    formNoJs: 'L’envoi de ce formulaire nécessite JavaScript. Activez-le ou contactez-nous directement.',
    fieldRequired: 'Veuillez remplir ce champ.', fieldEmail: 'Veuillez saisir une adresse e-mail valide.',
    fieldTel: 'Veuillez saisir un numéro de téléphone valide.', fieldNumber: 'Veuillez saisir un nombre.',
    fieldCheck: 'Veuillez cocher cette case pour continuer.', fieldChoose: 'Veuillez choisir une option.',
    formSending: 'Envoi…', formSent: 'Merci ! Votre message a été envoyé.', formFailed: 'Le message n’a pas pu être envoyé.',
    formQueued: 'Pas de connexion pour le moment : votre message est enregistré sur cet appareil et sera envoyé automatiquement.',
    formFallback: 'Vous pouvez l’envoyer autrement :', formViaMail: 'Envoyer par e-mail', formViaWhatsapp: 'Envoyer via WhatsApp',
    formViaTelegram: 'Envoyer via Telegram', formCopy: 'Copier le message', formCopied: 'Copié dans le presse-papiers',
    formSubject: 'Message depuis le site',
    'fl.name': 'Nom', 'fl.firstName': 'Prénom', 'fl.lastName': 'Nom de famille', 'fl.email': 'E-mail', 'fl.phone': 'Téléphone',
    'fl.company': 'Entreprise', 'fl.message': 'Message', 'fl.subject': 'Objet', 'fl.address': 'Adresse', 'fl.city': 'Ville',
    'fl.country': 'Pays', 'fl.zip': 'Code postal', 'fl.website': 'Site web', 'fl.date': 'Date', 'fl.quantity': 'Quantité',
    'fl.guests': 'Nombre d’invités',
    'ct.email': 'E-mail', 'ct.phone': 'Téléphone', 'ct.whatsapp': 'WhatsApp', 'ct.telegram': 'Telegram', 'ct.viber': 'Viber',
    'ct.web': 'Site web', 'ct.address': 'Adresse', 'ct.location': 'Localisation', 'ct.hours': 'Horaires d’ouverture',
    'ct.instagram': 'Instagram', 'ct.facebook': 'Facebook', 'ct.youtube': 'YouTube', 'ct.tiktok': 'TikTok', 'ct.vk': 'VK',
    'ct.linkedin': 'LinkedIn', 'ct.x': 'X', 'ct.github': 'GitHub', 'ct.codeberg': 'Codeberg', 'ct.gitlab': 'GitLab',
    'ct.mastodon': 'Mastodon', 'ct.skype': 'Skype', 'ct.other': 'Autre',
    'phb.date': 'Date ou année', 'phb.title': 'Titre', 'phb.text': 'Description…', 'phb.name': 'Nom',
    'phb.role': 'Rôle ou poste', 'phb.bio': 'Quelques mots sur la personne…', 'phb.quote': 'Ce que dit le client…', 'phb.q': 'Question',
    'phb.a': 'Réponse…', 'phb.ctaTitle': 'Un appel à l’action clair', 'phb.ctaText': 'Une ou deux phrases d’appui…',
    'phb.value': 'Valeur (à définir dans le panneau)', 'phb.cell': '', 'phb.caption': 'Légende du tableau', 'phb.formTitle': 'Titre du formulaire',
    'phb.consent': 'Texte de consentement (facultatif), p. ex. J’accepte la politique de confidentialité',
    'phb.noDest': 'Personne ne reçoit encore ce formulaire : choisissez une requête ou saisissez une adresse de secours.',
    'phb.logo': 'Nom de la marque',
  },
  es: {
    ratingOf: 'Valoración: {n} de 5', prev: 'Anterior', next: 'Siguiente', tsLabel: 'Testimonios',
    mapAlt: 'Mapa', openMap: 'Abrir el mapa',
    formSubmit: 'Enviar', formChoose: 'Elige…',
    formNoJs: 'Para enviar este formulario se necesita JavaScript. Actívalo o contáctanos directamente.',
    fieldRequired: 'Rellena este campo.', fieldEmail: 'Introduce una dirección de correo válida.',
    fieldTel: 'Introduce un número de teléfono válido.', fieldNumber: 'Introduce un número.',
    fieldCheck: 'Marca esta casilla para continuar.', fieldChoose: 'Elige una opción.',
    formSending: 'Enviando…', formSent: '¡Gracias! Tu mensaje se ha enviado.', formFailed: 'No se pudo enviar el mensaje.',
    formQueued: 'Ahora no hay conexión: tu mensaje se ha guardado en este dispositivo y se enviará automáticamente.',
    formFallback: 'Puedes enviarlo de otra forma:', formViaMail: 'Enviar por correo', formViaWhatsapp: 'Enviar por WhatsApp',
    formViaTelegram: 'Enviar por Telegram', formCopy: 'Copiar el mensaje', formCopied: 'Copiado al portapapeles',
    formSubject: 'Mensaje desde el sitio web',
    'fl.name': 'Nombre', 'fl.firstName': 'Nombre', 'fl.lastName': 'Apellidos', 'fl.email': 'Correo electrónico', 'fl.phone': 'Teléfono',
    'fl.company': 'Empresa', 'fl.message': 'Mensaje', 'fl.subject': 'Asunto', 'fl.address': 'Dirección', 'fl.city': 'Ciudad',
    'fl.country': 'País', 'fl.zip': 'Código postal', 'fl.website': 'Sitio web', 'fl.date': 'Fecha', 'fl.quantity': 'Cantidad',
    'fl.guests': 'Número de invitados',
    'ct.email': 'Correo electrónico', 'ct.phone': 'Teléfono', 'ct.whatsapp': 'WhatsApp', 'ct.telegram': 'Telegram', 'ct.viber': 'Viber',
    'ct.web': 'Sitio web', 'ct.address': 'Dirección', 'ct.location': 'Ubicación', 'ct.hours': 'Horario',
    'ct.instagram': 'Instagram', 'ct.facebook': 'Facebook', 'ct.youtube': 'YouTube', 'ct.tiktok': 'TikTok', 'ct.vk': 'VK',
    'ct.linkedin': 'LinkedIn', 'ct.x': 'X', 'ct.github': 'GitHub', 'ct.codeberg': 'Codeberg', 'ct.gitlab': 'GitLab',
    'ct.mastodon': 'Mastodon', 'ct.skype': 'Skype', 'ct.other': 'Otro',
    'phb.date': 'Fecha o año', 'phb.title': 'Título', 'phb.text': 'Descripción…', 'phb.name': 'Nombre',
    'phb.role': 'Cargo o función', 'phb.bio': 'Unas palabras sobre la persona…', 'phb.quote': 'Lo que dice el cliente…', 'phb.q': 'Pregunta',
    'phb.a': 'Respuesta…', 'phb.ctaTitle': 'Una llamada a la acción clara', 'phb.ctaText': 'Una o dos frases de apoyo…',
    'phb.value': 'Valor (se define en el panel)', 'phb.cell': '', 'phb.caption': 'Leyenda de la tabla', 'phb.formTitle': 'Título del formulario',
    'phb.consent': 'Texto de consentimiento (opcional), p. ej. Acepto la política de privacidad',
    'phb.noDest': 'Nadie recibe aún este formulario: elige una solicitud o indica una dirección de respaldo.',
    'phb.logo': 'Nombre de la marca',
  },
  ka: {
    ratingOf: 'შეფასება: {n} 5-დან', prev: 'წინა', next: 'შემდეგი', tsLabel: 'შეფასებები',
    mapAlt: 'რუკა', openMap: 'რუკის გახსნა',
    formSubmit: 'გაგზავნა', formChoose: 'აირჩიეთ…',
    formNoJs: 'ფორმის გასაგზავნად საჭიროა JavaScript. ჩართეთ ის ან დაგვიკავშირდით პირდაპირ.',
    fieldRequired: 'შეავსეთ ეს ველი.', fieldEmail: 'შეიყვანეთ სწორი ელფოსტის მისამართი.',
    fieldTel: 'შეიყვანეთ სწორი ტელეფონის ნომერი.', fieldNumber: 'შეიყვანეთ რიცხვი.',
    fieldCheck: 'გასაგრძელებლად მონიშნეთ ეს ველი.', fieldChoose: 'აირჩიეთ ერთ-ერთი ვარიანტი.',
    formSending: 'იგზავნება…', formSent: 'გმადლობთ! თქვენი შეტყობინება გაიგზავნა.', formFailed: 'შეტყობინების გაგზავნა ვერ მოხერხდა.',
    formQueued: 'ახლა კავშირი არ არის: შეტყობინება შენახულია ამ მოწყობილობაზე და ავტომატურად გაიგზავნება.',
    formFallback: 'შეგიძლიათ გაგზავნოთ სხვა გზით:', formViaMail: 'ელფოსტით გაგზავნა', formViaWhatsapp: 'WhatsApp-ით გაგზავნა',
    formViaTelegram: 'Telegram-ით გაგზავნა', formCopy: 'შეტყობინების კოპირება', formCopied: 'დაკოპირდა ბუფერში',
    formSubject: 'შეტყობინება ვებგვერდიდან',
    'fl.name': 'სახელი', 'fl.firstName': 'სახელი', 'fl.lastName': 'გვარი', 'fl.email': 'ელფოსტა', 'fl.phone': 'ტელეფონი',
    'fl.company': 'კომპანია', 'fl.message': 'შეტყობინება', 'fl.subject': 'თემა', 'fl.address': 'მისამართი', 'fl.city': 'ქალაქი',
    'fl.country': 'ქვეყანა', 'fl.zip': 'საფოსტო ინდექსი', 'fl.website': 'ვებგვერდი', 'fl.date': 'თარიღი', 'fl.quantity': 'რაოდენობა',
    'fl.guests': 'სტუმრების რაოდენობა',
    'ct.email': 'ელფოსტა', 'ct.phone': 'ტელეფონი', 'ct.whatsapp': 'WhatsApp', 'ct.telegram': 'Telegram', 'ct.viber': 'Viber',
    'ct.web': 'ვებგვერდი', 'ct.address': 'მისამართი', 'ct.location': 'მდებარეობა', 'ct.hours': 'სამუშაო საათები',
    'ct.instagram': 'Instagram', 'ct.facebook': 'Facebook', 'ct.youtube': 'YouTube', 'ct.tiktok': 'TikTok', 'ct.vk': 'VK',
    'ct.linkedin': 'LinkedIn', 'ct.x': 'X', 'ct.github': 'GitHub', 'ct.codeberg': 'Codeberg', 'ct.gitlab': 'GitLab',
    'ct.mastodon': 'Mastodon', 'ct.skype': 'Skype', 'ct.other': 'სხვა',
    'phb.date': 'თარიღი ან წელი', 'phb.title': 'სათაური', 'phb.text': 'აღწერა…', 'phb.name': 'სახელი',
    'phb.role': 'როლი ან თანამდებობა', 'phb.bio': 'რამდენიმე სიტყვა ადამიანზე…', 'phb.quote': 'რას ამბობს კლიენტი…', 'phb.q': 'კითხვა',
    'phb.a': 'პასუხი…', 'phb.ctaTitle': 'მკაფიო მოწოდება მოქმედებისკენ', 'phb.ctaText': 'ერთი-ორი დამხმარე წინადადება…',
    'phb.value': 'მნიშვნელობა (მიეთითება პანელში)', 'phb.cell': '', 'phb.caption': 'ცხრილის წარწერა', 'phb.formTitle': 'ფორმის სათაური',
    'phb.consent': 'თანხმობის ტექსტი (არასავალდებულო), მაგ. ვეთანხმები კონფიდენციალურობის პოლიტიკას',
    'phb.noDest': 'ამ ფორმას ჯერ არავინ იღებს: აირჩიეთ მოთხოვნა ან მიუთითეთ სარეზერვო მისამართი.',
    'phb.logo': 'ბრენდის სახელი',
  },
};

export {
  BB_AUTOCOMPLETE,
  BB_AUTO_LABEL,
  BB_CT_ICON,
  BB_CT_KINDS,
  BB_CT_MULTI,
  BB_FIELD_TYPES,
  BB_FORM_UI,
  BB_HANDLE,
  BB_KEY_RE,
  BB_MAX_FIELDS,
  BB_MAX_OPTS,
  BB_REQ_URL,
  BB_SOCIAL,
  BB_TYPE_LABEL,
  BLOCK_DEPS_B,
  BT_B,
  CSS_BLOCKS_B,
  CSS_VARIANTS_B,
  OWN_B,
  UI_B,
  bbArr,
  bbAutoKey,
  bbBtnItemSchema,
  bbCtHref,
  bbCtRender,
  bbCtText,
  bbCtValue,
  bbCtaRender,
  bbFaqRender,
  bbField,
  bbFieldKey,
  bbFmDest,
  bbFmRender,
  bbFmTo,
  bbHuman,
  bbLangJSON,
  bbLgRender,
  bbOptLines,
  bbPh,
  bbTbRender,
  bbTlRender,
  bbTmRender,
  bbTsRender,
  bbTsStars,
  bbVariant,
  formFieldsHTML
};
