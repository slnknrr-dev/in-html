// funding-studio/blocks-b.js - the campaign blocks: hero, story, goal progress with milestones, tiers / rewards,
// impact lines, donor wall / leaderboard, updates, FAQ, matching campaign, countdown, transparency (spending report),
// share and the thank-you block. Registry (BT_B) and CSS (CSS_B).
//
// Block contract (shared with blocks-a.js and blocks-donate.js): a registry entry declares defaults, a schema (which
// also drives normalisation in doc/model.js: 'color' fields pass safeColor, numbers are clamped, i18n fields are
// normalised), and render(b, ctx) -> HTML string. Render rules: every user string goes through fld()/txt() (escaped,
// per-language spans) or escapeHTML/escapeAttr; edit mode (ctx.edit) renders editable fields and placeholders and
// never wires runtime features; view mode declares what it needs (feature(), needUi(), ctx.use.*) so the exporter
// ships only that runtime code and those strings. Live-updatable figures carry data-fd-* hooks and are always
// pre-rendered with the published values. CSS per block lives in CSS_B (one string per type, notes kept here because
// template strings cannot hold comments); CLASS_OWNERS_B maps class patterns to block types so theme-preset rules
// for unused blocks are shaken out.
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { uiText } from '../doc/dict.js';
import { optList } from '../doc/schema.js';
import { attOf } from '../doc/attach.js';
import { addItemBox, di, feature, fld, grp, has, hrefAttr, icon, needUi, txt, ui } from '../doc/render.js';
import { qrSVG } from '../qr/qr.js';
import { formatMoney } from '../payments/money.js';
import { uid } from '../util/id.js';
import { isObj, num, own, str } from '../util/value.js';
import { SHARE_NETS } from './base.js';
import { btnHTML, campOf, campStats, imgHTML, markCamp, money, pageHref, progressHTML } from './render.js';
import { homePage } from './model.js';

const items = (b) => (isObj(b) && Array.isArray(b.items) ? b.items : []);
const headOf = (ctx, b, lead = true) => {
  const s = fld(ctx, b, 'title', 'plain', 'h2', 'fd-h2', 'ph.title') + (lead ? fld(ctx, b, 'lead', 'plain', 'p', 'fd-lead', 'ph.lead') : '');
  return s ? `<div class="fd-blk-head">${s}</div>` : '';
};
const dayText = (ctx, day) => (day ? grp(ctx, (l) => {
  const [y, m, d] = day.split('-').map(Number);
  try { return escapeHTML(new Intl.DateTimeFormat(l, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d))); } catch { return escapeHTML(day); }
}) : '');

/* ---------- hero ---------- */

function renderHero(b, ctx) {
  const E = ctx.edit;
  const c = campOf(ctx, b);
  const img = imgHTML(ctx, b.image, { key: 'image', cls: 'fd-hero-img', placeholder: b.layout === 'split' });
  const eyebrow = fld(ctx, b, 'eyebrow', 'plain', 'p', 'fd-eyebrow', 'ph.eyebrow');
  const title = fld(ctx, b, 'title', 'plain', 'h1', 'fd-h1', 'ph.title');
  const lead = fld(ctx, b, 'lead', 'rich', 'div', 'fd-hero-lead fd-rich', 'ph.lead');
  const prog = b.progress && c ? progressHTML(ctx, c, { cls: 'fd-hero-prog' }) : '';
  let btns = '';
  if (E) btns = `<span class="fd-btn fd-btn-lg">${icon(ctx, 'heart', 'fd-btn-ic')}${fld(ctx, b, 'cta', 'plain', 'span', '', 'ph.donate')}</span>`
    + `<span class="fd-btn fd-btn-lg fd-btn-ghost">${fld(ctx, b, 'cta2', 'plain', 'span', '', 'ph.cta2')}</span>`;
  else {
    const h1 = has(ctx, b.cta) ? hrefAttr(ctx, b.ctaHref || '#donate') : '';
    if (h1) btns += `<a class="fd-btn fd-btn-lg"${h1}>${icon(ctx, 'heart', 'fd-btn-ic')}<span>${txt(ctx, b.cta)}</span></a>`;
    const h2 = has(ctx, b.cta2) ? hrefAttr(ctx, b.cta2Href) : '';
    if (h2) btns += `<a class="fd-btn fd-btn-lg fd-btn-ghost"${h2}><span>${txt(ctx, b.cta2)}</span></a>`;
  }
  const text = `<div class="fd-hero-text">${eyebrow}${title}${lead}${prog}${btns ? `<div class="fd-btns">${btns}</div>` : ''}</div>`;
  if (b.layout === 'cover') {
    return `<section class="fd-hero fd-hero-cover">${img ? `<div class="fd-hero-bg">${img}</div>` : ''}<div class="fd-wrap fd-hero-grid">${text}</div></section>`;
  }
  const media = b.layout === 'split' && img ? `<div class="fd-hero-media">${img}</div>` : '';
  return `<section class="fd-hero fd-hero-${b.layout}${media ? '' : ' fd-hero-nomedia'}"><div class="fd-wrap fd-hero-grid">${text}${media}</div></section>`;
}

/* ---------- story ---------- */

function renderStory(b, ctx) {
  const head = fld(ctx, b, 'title', 'plain', 'h2', 'fd-h2', 'ph.title');
  const body = fld(ctx, b, 'html', 'rich', 'div', 'fd-rich fd-story-body', 'ph.story');
  const img = b.side === 'none' ? '' : imgHTML(ctx, b.image, { key: 'image', cls: 'fd-story-img', placeholder: true });
  const cap = img ? fld(ctx, b, 'caption', 'plain', 'figcaption', 'fd-cap', 'ph.caption') : '';
  if (!ctx.edit && !head && !body) return '';
  return `<div class="fd-story fd-story-${img ? b.side : 'none'}"><div class="fd-story-text">${head}${body}</div>${img ? `<figure class="fd-story-fig">${img}${cap}</figure>` : ''}</div>`;
}

/* ---------- progress ---------- */

function renderProgress(b, ctx) {
  const c = campOf(ctx, b);
  if (!c) return ctx.edit ? `<div class="fd-empty">${ui(ctx, 'noCampaigns')}</div>` : '';
  const st = campStats(ctx, c);
  const prog = progressHTML(ctx, c, { size: b.style === 'big' ? 'lg' : '', donors: b.donors, days: b.days, cls: 'fd-prog-' + b.style });
  let ms = '';
  items(b).forEach((it, i) => {
    if (!isObj(it)) return;
    const done = st.raised >= num(it.amount, 0);
    const label = fld(ctx, b, `items.${i}.label`, 'plain', 'span', 'fd-ms-l', 'ph.milestone', { keep: true });
    ms += `<li class="fd-mile${done ? ' fd-done' : ''}"${di(ctx, i)}${ctx.edit ? '' : ` data-fd-mile="${num(it.amount, 0)}"`}>${icon(ctx, done ? 'check' : 'target', 'fd-mile-ic')}`
      + `<span class="fd-mile-a">${money(ctx, num(it.amount, 0), st.cur)}</span>${label}</li>`;
  });
  return `${headOf(ctx, b)}${prog}${ms ? `<ol class="fd-miles" role="list">${ms}</ol>` : ''}`;
}

/* ---------- tiers ---------- */

function renderTiers(b, ctx) {
  const c = campOf(ctx, b);
  if (c) markCamp(ctx, c);
  const cur = c ? c.currency : 'EUR';
  let s = '';
  items(b).forEach((it, i) => {
    if (!isObj(it)) return;
    const a = num(it.amount, 0);
    const left = it.limit > 0 ? Math.max(0, it.limit - num(it.claimed, 0)) : null;
    const sold = left === 0;
    const img = imgHTML(ctx, it.image, { cls: 'fd-tier-img', key: `items.${i}.image` });
    const badge = fld(ctx, b, `items.${i}.badge`, 'plain', 'span', 'fd-badge', 'ph.badge');
    const title = fld(ctx, b, `items.${i}.title`, 'plain', 'h3', 'fd-h3', 'ph.tierTitle');
    const text = fld(ctx, b, `items.${i}.text`, 'rich', 'div', 'fd-rich fd-tier-text', 'ph.tierText');
    const per = b.interval === 'month' ? ` <small>${ui(ctx, 'perMonth')}</small>` : '';
    const rest = left != null ? `<p class="fd-tier-left">${sold ? ui(ctx, 'soldOut') : grp(ctx, (l) => escapeHTML(uiText('leftN', l, ctx.doc, { n: left })))}</p>` : '';
    const label = ui(ctx, 'chooseTier');
    let btn;
    if (ctx.edit || sold) btn = `<span class="fd-btn fd-btn-secondary${sold ? ' fd-btn-off' : ''}">${label}</span>`;
    else {
      feature(ctx, 'donate');
      const href = c && ctx.camp && c.id !== ctx.camp.id ? pageHref(ctx, c) + (ctx.route.mode === 'hash' ? '' : '#donate') : '#donate';
      btn = `<a class="fd-btn fd-btn-secondary" href="${escapeAttr(href)}" data-fd-pick data-amt="${a}" data-int="${b.interval}"${c ? ` data-camp="${escapeAttr(c.id)}"` : ''}>${label}</a>`;
    }
    s += `<article class="fd-tier${sold ? ' fd-sold' : ''}"${di(ctx, i)}>${img}${badge}<p class="fd-tier-a">${money(ctx, a, cur)}${per}</p>${title}${text}${rest}${btn}</article>`;
  });
  if (!s) return ctx.edit ? headOf(ctx, b) + addItemBox(ctx) : '';
  return `${headOf(ctx, b)}<div class="fd-tiers">${s}</div>`;
}

/* ---------- impact ---------- */

function renderImpact(b, ctx) {
  const c = campOf(ctx, b);
  const cur = c ? c.currency : 'EUR';
  let s = '';
  const list = items(b).filter(isObj).slice().sort((x, y) => num(x.amount, 0) - num(y.amount, 0));
  for (const it of list) {
    const i = items(b).indexOf(it);
    const text = fld(ctx, b, `items.${i}.text`, 'plain', 'span', 'fd-imp-t', 'ph.impact');
    if (!text) continue;
    s += `<li class="fd-imp"${di(ctx, i)}${ctx.edit ? '' : ` data-fd-imp="${num(it.amount, 0)}"${c ? ` data-camp="${escapeAttr(c.id)}"` : ''}`}>`
      + `${icon(ctx, it.icon || 'heart', 'fd-imp-ic')}<strong class="fd-imp-a">${money(ctx, num(it.amount, 0), cur)}</strong>${text}</li>`;
  }
  if (!s) return ctx.edit ? headOf(ctx, b) + addItemBox(ctx) : '';
  return `${headOf(ctx, b)}<ul class="fd-imps" role="list">${s}</ul>`;
}

/* ---------- donor wall ---------- */

const initials = (name) => str(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '♥';

// Donor wall: the owner's manual entries (offline gifts, early backers) rendered statically, plus live entries merged
// in by the runtime when `live` is on. Anonymous entries never show a name; messages are capped at 280 and escaped.
// Without entries and without a live source, the block renders nothing in view mode (no empty heading).
function renderWall(b, ctx) {
  const c = campOf(ctx, b);
  const cur = c ? c.currency : 'EUR';
  let list = items(b).filter(isObj);
  if (b.sort === 'top') list = list.slice().sort((x, y) => num(y.amount, 0) - num(x.amount, 0));
  else list = list.slice().sort((x, y) => str(y.date).localeCompare(str(x.date)));
  list = list.slice(0, b.count);
  let s = '';
  list.forEach((it, n) => {
    const i = items(b).indexOf(it);
    const name = it.anon ? '' : str(it.name).trim();
    const who = name ? escapeHTML(name) : ui(ctx, 'anonDonor');
    const amt = b.amounts && num(it.amount, 0) > 0 ? `<span class="fd-wall-a">${money(ctx, num(it.amount, 0), cur)}</span>` : '';
    const msg = b.messages && it.message ? `<p class="fd-wall-m">${escapeHTML(str(it.message).slice(0, 280))}</p>` : '';
    const rank = b.sort === 'top' ? `<span class="fd-wall-rank">${n + 1}</span>` : '';
    s += `<li class="fd-wall-i"${di(ctx, i)}>${rank}<span class="fd-ava" aria-hidden="true">${escapeHTML(name ? initials(name) : '♥')}</span>`
      + `<div class="fd-wall-b"><div class="fd-wall-head"><strong>${who}</strong>${amt}</div>${msg}${it.date ? `<span class="fd-wall-d">${dayText(ctx, it.date)}</span>` : ''}</div></li>`;
  });
  if (!ctx.edit && b.live && c) {
    markCamp(ctx, c);
    feature(ctx, 'wall');
    needUi(ctx, 'anonDonor');
    ctx.use.walls.push(b.id);
  }
  if (!s && !ctx.edit && !(b.live && ctx.api)) return '';
  return `${headOf(ctx, b, false)}<ol class="fd-wall fd-wall-${b.sort}" role="list"${!ctx.edit && c ? ` data-fd-wall data-camp="${escapeAttr(c.id)}" data-sort="${b.sort}" data-count="${b.count}" data-amounts="${b.amounts ? 1 : 0}" data-messages="${b.messages ? 1 : 0}"` : ''}>${s || (ctx.edit ? `<li>${addItemBox(ctx)}</li>` : '')}</ol>`;
}

/* ---------- updates ---------- */

function renderUpdates(b, ctx) {
  const list = items(b).filter(isObj).slice().sort((x, y) => (b.order === 'old' ? 1 : -1) * str(x.date).localeCompare(str(y.date)));
  let s = '';
  for (const it of list) {
    const i = items(b).indexOf(it);
    const title = fld(ctx, b, `items.${i}.title`, 'plain', 'h3', 'fd-h3', 'ph.updateTitle');
    const body = fld(ctx, b, `items.${i}.html`, 'rich', 'div', 'fd-rich', 'ph.text');
    const img = imgHTML(ctx, it.image, { cls: 'fd-upd-img', key: `items.${i}.image` });
    if (!title && !body) continue;
    s += `<li class="fd-upd"${di(ctx, i)}><time class="fd-upd-d"${it.date ? ` datetime="${escapeAttr(it.date)}"` : ''}>${dayText(ctx, it.date)}</time><div class="fd-upd-b">${title}${img}${body}</div></li>`;
  }
  if (!s) return ctx.edit ? headOf(ctx, b, false) + addItemBox(ctx) : '';
  return `${headOf(ctx, b, false)}<ol class="fd-upds" role="list">${s}</ol>`;
}

/* ---------- FAQ ---------- */

function renderFaq(b, ctx) {
  let s = '';
  items(b).forEach((it, i) => {
    if (!isObj(it)) return;
    const q = fld(ctx, b, `items.${i}.q`, 'plain', 'span', '', 'ph.question');
    const a = fld(ctx, b, `items.${i}.a`, 'rich', 'div', 'fd-rich fd-faq-a', 'ph.answer');
    if (!q) return;
    s += ctx.edit ? `<div class="fd-faq-i fd-faq-open"${di(ctx, i)}><div class="fd-faq-q">${q}${icon(ctx, 'chevDown')}</div>${a}</div>`
      : `<details class="fd-faq-i"${b.single ? ' data-fd-faq' : ''}><summary class="fd-faq-q">${q}${icon(ctx, 'chevDown')}</summary>${a}</details>`;
  });
  if (b.single && !ctx.edit && s) feature(ctx, 'faq');
  if (!s) return ctx.edit ? headOf(ctx, b, false) + addItemBox(ctx) : '';
  return `${headOf(ctx, b, false)}<div class="fd-faq">${s}</div>`;
}

/* ---------- matching ---------- */

// Matching campaign: a sponsor adds `ratio` x every donation up to `cap`. matched = min(cap, raised x ratio), shown
// as "1 € becomes 1+ratio €". The runtime recomputes it as figures change (data-ratio / data-cap).
function renderMatching(b, ctx) {
  const c = campOf(ctx, b);
  if (!c) return '';
  markCamp(ctx, c);
  const st = campStats(ctx, c);
  const ratio = num(b.ratio, 1, 0.1, 10);
  const matched = Math.min(b.cap > 0 ? b.cap : Infinity, st.raised * ratio);
  const pct = b.cap > 0 ? Math.min(100, (matched / b.cap) * 100) : 0;
  const logo = imgHTML(ctx, b.logo, { cls: 'fd-match-logo', key: 'logo' });
  const sponsor = fld(ctx, b, 'sponsor', 'plain', 'strong', 'fd-match-who', 'ph.sponsor');
  const text = fld(ctx, b, 'text', 'rich', 'div', 'fd-rich', 'ph.text');
  const live = !ctx.edit;
  if (live) feature(ctx, 'progress');
  const ratioText = grp(ctx, (l) => escapeHTML(uiText('matchRatio', l, ctx.doc, { a: formatMoney(1, c.currency, l), b: formatMoney(1 + ratio, c.currency, l, { whole: false }) })));
  const capLine = b.cap > 0 ? `<div class="fd-bar fd-bar-sm" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span class="fd-bar-fill" style="--p:${pct}%"${live ? ' data-fd-mfill' : ''}></span></div>`
    + `<p class="fd-match-cap"><span${live ? ' data-fd-matched' : ''}>${money(ctx, matched, c.currency)}</span> / ${money(ctx, b.cap, c.currency)} ${ui(ctx, 'matchedSoFar')}</p>` : '';
  const until = b.until ? `<p class="fd-match-until">${icon(ctx, 'clock')}<span>${grp(ctx, (l) => escapeHTML(uiText('matchUntil', l, ctx.doc, { date: htmlToText(dayPlain(b.until, l)) })))}</span></p>` : '';
  return `<div class="fd-match"${live ? ` data-fd-match data-camp="${escapeAttr(c.id)}" data-ratio="${ratio}" data-cap="${b.cap}"` : ''}>`
    + `<div class="fd-match-head">${logo}<div>${headOf(ctx, b, false)}${sponsor}</div></div><p class="fd-match-ratio">${icon(ctx, 'bolt')}<span>${ratioText}</span></p>${text}${capLine}${until}</div>`;
}
function dayPlain(day, l) {
  const [y, m, d] = day.split('-').map(Number);
  try { return new Intl.DateTimeFormat(l, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d)); } catch { return day; }
}

/* ---------- countdown ---------- */

// Countdown to the block's own date/time/offset, else the campaign end. Pre-rendered with the time left at export,
// then ticked by the runtime from the absolute end timestamp (data-fd-cd), so a stale static value corrects itself.
// role=timer has implicit aria-live off: screen readers are not interrupted every second.
function renderCountdown(b, ctx) {
  const c = campOf(ctx, b);
  let end = null;
  if (b.date) {
    const [y, m, d] = b.date.split('-').map(Number);
    const [hh, mm] = (b.time || '23:59').split(':').map(Number);
    end = Date.UTC(y, m - 1, d, hh, mm) - num(b.tz, 0) * 3600000;
  } else if (c && c.end) end = campStats(ctx, c).end;
  if (end == null) return ctx.edit ? `${headOf(ctx, b, false)}<div class="fd-empty">${ui(ctx, 'noEnd')}</div>` : '';
  const left = Math.max(0, end - Date.now());
  const parts = [[Math.floor(left / 86400000), 'cdDays', 'd'], [Math.floor(left / 3600000) % 24, 'cdHours', 'h'], [Math.floor(left / 60000) % 60, 'cdMinutes', 'm'], [Math.floor(left / 1000) % 60, 'cdSeconds', 's']];
  const boxes = parts.map(([n, k, u]) => `<span class="fd-cd-u"><span class="fd-cd-n" data-u="${u}">${String(n).padStart(2, '0')}</span><span class="fd-cd-l">${ui(ctx, k)}</span></span>`).join('');
  const done = fld(ctx, b, 'done', 'plain', 'p', 'fd-cd-done', 'ph.cdDone', { keep: true });
  if (!ctx.edit) feature(ctx, 'countdown');
  return `${headOf(ctx, b, false)}<div class="fd-cd${left === 0 ? ' fd-cd-over' : ''}"${ctx.edit ? '' : ` data-fd-cd="${end}"`} role="timer"><div class="fd-cd-boxes">${boxes}</div>${done}</div>`;
}

/* ---------- transparency ---------- */

// Spending report: a stacked bar of planned shares (decorative, aria-hidden - the table carries the data) and a real
// <table> with planned/spent per category and totals in <tfoot>. Item colours are schema 'color' fields (safeColor
// on load) inserted as CSS custom properties; the attached report file is downloaded from the embedded blob.
function renderTransparency(b, ctx) {
  const c = campOf(ctx, b);
  const cur = b.currency || (c ? c.currency : 'EUR');
  const list = items(b).filter(isObj);
  const tp = list.reduce((s, x) => s + num(x.planned, 0), 0);
  const ts = list.reduce((s, x) => s + num(x.spent, 0), 0);
  const palette = ['var(--fd-accent)', 'var(--fd-accent2)', '#d97706', '#7c3aed', '#059669', '#dc2626', '#0891b2', '#64748b'];
  let rows = '';
  let seg = '';
  list.forEach((it, n) => {
    const i = items(b).indexOf(it);
    const col = it.color || palette[n % palette.length];
    const label = fld(ctx, b, `items.${i}.label`, 'plain', 'span', '', 'ph.spendLabel');
    const p = num(it.planned, 0);
    const s = num(it.spent, 0);
    const w = tp > 0 ? (p / tp) * 100 : 0;
    seg += `<span style="--w:${w}%;--c:${col}" title="${escapeAttr(htmlToText(pickText(it.label, ctx.lang, ctx.pd)))}"></span>`;
    rows += `<tr${di(ctx, i)}><th scope="row"><span class="fd-sw" style="--c:${col}"></span>${label}</th><td>${money(ctx, p, cur)}</td><td>${money(ctx, s, cur)}</td>`
      + `<td><span class="fd-mini" style="--p:${p > 0 ? Math.min(100, (s / p) * 100) : 0}%"></span></td></tr>`;
  });
  if (!rows) return ctx.edit ? headOf(ctx, b) + addItemBox(ctx) : '';
  const report = attOf(ctx, b.report);
  let rep = '';
  if (report && (report.data || ctx.edit)) {
    if (!ctx.edit) { ctx.use.blob.add(report.id); ctx.use.atts.add(report.id); feature(ctx, 'files'); }
    const rl = has(ctx, b.reportLabel) ? txt(ctx, b.reportLabel) : ui(ctx, 'report');
    rep = `<p class="fd-report"><button type="button" class="fd-btn fd-btn-secondary fd-btn-sm${ctx.edit ? '' : ' fd-js-only'}" data-att-dl data-att="${escapeAttr(report.id)}"${ctx.edit ? ' tabindex="-1"' : ''}>${icon(ctx, 'download', 'fd-btn-ic')}<span>${rl}</span></button> <small>${escapeHTML(report.name)}</small></p>`;
  }
  const upd = b.updated ? `<p class="fd-muted fd-small">${ui(ctx, 'updatedOn')} ${dayText(ctx, b.updated)}</p>` : '';
  return `${headOf(ctx, b)}<div class="fd-spend"><div class="fd-stack" aria-hidden="true">${seg}</div>`
    + `<div class="fd-tbl-wrap"><table class="fd-tbl"><thead><tr><th scope="col">${ui(ctx, 'category')}</th><th scope="col">${ui(ctx, 'planned')}</th><th scope="col">${ui(ctx, 'spent')}</th><th scope="col"><span class="fd-sr">${ui(ctx, 'progress')}</span></th></tr></thead>`
    + `<tbody>${rows}</tbody><tfoot><tr><th scope="row">${ui(ctx, 'total')}</th><td>${money(ctx, tp, cur)}</td><td>${money(ctx, ts, cur)}</td><td></td></tr></tfoot></table></div>${upd}${rep}</div>`;
}

/* ---------- share ---------- */

// Share intents as plain URLs (same list as rtShare in runtime.js, used when the owner fixed a URL so links work
// without JS). Every component is percent-encoded; no tracking parameters are added.
export function shareURL(net, url, text) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text || '');
  switch (net) {
    case 'x': return `https://x.com/intent/post?url=${u}${text ? '&text=' + t : ''}`;
    case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case 'telegram': return `https://t.me/share/url?url=${u}${text ? '&text=' + t : ''}`;
    case 'whatsapp': return `https://wa.me/?text=${encodeURIComponent((text ? text + ' ' : '') + url)}`;
    case 'linkedin': return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case 'email': return `mailto:?subject=${t}&body=${encodeURIComponent((text ? text + '\n\n' : '') + url)}`;
    default: return '';
  }
}
const NET_ICON = { native: 'share', copy: 'link', x: 'x', facebook: 'facebook', telegram: 'telegram', whatsapp: 'whatsapp', linkedin: 'linkedin', email: 'mail', qr: 'qr' };

// Without a fixed URL the share links must be built from the page address at runtime, so they are JS-only; with one,
// they are real links (and the QR is pre-rendered at export).
function renderShare(b, ctx) {
  const nets = b.nets.length ? b.nets : ['native', 'copy', 'x', 'facebook', 'telegram', 'whatsapp', 'email'];
  const url = str(b.url);
  const text = htmlToText(pickText(b.text, ctx.defaultLang, ctx.pd));
  let s = '';
  for (const n of nets) {
    const label = ui(ctx, 'net.' + n);
    const ic = icon(ctx, NET_ICON[n]);
    if (ctx.edit) { s += `<span class="fd-net">${ic}<span>${label}</span></span>`; continue; }
    if (n === 'native' || n === 'copy' || n === 'qr') {
      if (n === 'qr' && url) continue;
      s += `<button type="button" class="fd-net fd-js-only" data-net="${n}">${ic}<span>${label}</span></button>`;
      continue;
    }
    const href = url ? shareURL(n, url, text) : '#';
    s += `<a class="fd-net${url ? '' : ' fd-js-only'}" data-net="${n}" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${ic}<span>${label}</span></a>`;
  }
  let qr = '';
  if (nets.includes('qr')) {
    if (url) { try { qr = `<div class="fd-qr fd-share-qr">${qrSVG(url, { margin: 2, title: uiText('net.qr', ctx.defaultLang, ctx.doc) })}</div>`; } catch { qr = ''; } }
    else if (!ctx.edit) { qr = '<div class="fd-qr fd-share-qr" data-fd-shareqr hidden></div>'; ctx.use.shareQR = true; feature(ctx, 'qr'); }
  }
  if (!ctx.edit) { feature(ctx, 'share'); needUi(ctx, 'copied', 'copyFail'); }
  return `${headOf(ctx, b, false)}<div class="fd-share"${ctx.edit ? '' : ` data-fd-share data-text="${escapeAttr(text)}"${url ? ` data-url="${escapeAttr(url)}"` : ''}`}>`
    + `${fld(ctx, b, 'text', 'plain', 'p', 'fd-share-t', 'ph.shareText')}<div class="fd-nets">${s}</div>${qr}</div>`;
}

/* ---------- thank you ---------- */

// Thank-you block: static text plus an (initially hidden) summary filled by rtThanks with the donation status. The
// editor shows a sample success line instead, so the owner sees the final layout.
function renderThanks(b, ctx) {
  const title = fld(ctx, b, 'title', 'plain', 'h1', 'fd-h1', 'ph.thanksTitle');
  const text = fld(ctx, b, 'text', 'rich', 'div', 'fd-rich fd-thx-text', 'ph.thanksText');
  const home = homePage(ctx.doc);
  const back = home ? btnHTML(ctx, has(ctx, b.back) || ctx.edit ? fld(ctx, b, 'back', 'plain', 'span', '', 'ph.back') : ui(ctx, 'backToCampaign'), pageHref(ctx, home), { kind: 'secondary', icon: 'back' }) : '';
  if (!ctx.edit) {
    feature(ctx, 'thanks');
    ctx.use.thanksBlock = true;
    needUi(ctx, 'st.pending', 'st.succeeded', 'st.failed', 'st.refunded', 'st.expired', 'st.cancelled', 'thxSum', 'thxSumMonthly', 'thxLocal', 'receipt', 'manage', 'via', 'm.stripe', 'm.paypal', 'm.tbc', 'm.bank', 'm.btc', 'm.eth', 'monthly', 'manageOk');
  }
  const sum = ctx.edit ? `<div class="fd-thx-sum"><p class="fd-status fd-status-ok">${icon(ctx, 'check')}<span>${ui(ctx, 'thxSample')}</span></p></div>` : `<div class="fd-thx-sum" data-fd-sum aria-live="polite" hidden></div>`;
  return `<div class="fd-thx"${ctx.edit ? '' : ' data-fd-thanks'}>${icon(ctx, 'heart', 'fd-thx-ic')}${title}${text}${b.summary ? sum : ''}${back ? `<div class="fd-btns fd-btns-c">${back}</div>` : ''}</div>`;
}

/* ---------- registry ---------- */

const amountField = (key = 'amount', label = 'f.amount') => ({ key, type: 'number', label, min: 0, max: 1e9, step: 0.01 });
const campField = { key: 'camp', type: 'campaign', label: 'f.camp', hint: 'fh.camp' };

export const BT_B = {
  hero: {
    category: 'campaign', icon: 'star', full: true,
    i18nFields: ['eyebrow', 'title', 'cta', 'cta2'], richFields: { lead: 'rich' },
    defaults: () => ({ eyebrow: {}, title: {}, lead: {}, image: null, layout: 'split', progress: true, camp: '', cta: {}, ctaHref: '#donate', cta2: {}, cta2Href: '', tone: 'auto' }),
    schema: [
      { key: 'layout', type: 'select', label: 'f.layout', options: optList('split', 'cover', 'center') },
      { key: 'image', type: 'att', label: 'f.image', accept: 'image/' },
      { key: 'progress', type: 'checkbox', label: 'f.showProgress' },
      campField,
      { key: 'ctaHref', type: 'text', label: 'f.ctaHref', suggest: 'anchors', placeholder: 'pl.href' },
      { key: 'cta2Href', type: 'text', label: 'f.cta2Href', suggest: 'anchors', placeholder: 'pl.href' },
      { key: 'tone', type: 'select', label: 'f.tone', options: optList('auto', 'muted', 'accent', 'dark') },
    ],
    render: renderHero,
  },
  story: {
    category: 'campaign', icon: 'book', i18nFields: ['title', 'caption'], richFields: { html: 'rich' },
    defaults: () => ({ title: {}, html: {}, image: null, side: 'right', caption: {} }),
    schema: [
      { key: 'image', type: 'att', label: 'f.image', accept: 'image/' },
      { key: 'side', type: 'select', label: 'f.imageSide', options: optList('right', 'left', 'none') },
    ],
    render: renderStory,
  },
  progress: {
    category: 'campaign', icon: 'target', i18nFields: ['title', 'lead'], itemI18nFields: ['label'], itemLabel: 'label',
    defaults: () => ({ title: {}, lead: {}, camp: '', style: 'big', donors: true, days: true, items: [] }),
    schema: [
      campField,
      { key: 'style', type: 'select', label: 'f.style', options: optList('big', 'compact') },
      { key: 'donors', type: 'checkbox', label: 'f.showDonors' },
      { key: 'days', type: 'checkbox', label: 'f.showDays' },
    ],
    itemSchema: [amountField(), { key: 'label', type: 'i18n', label: 'f.label' }],
    itemDefaults: () => ({ id: uid(), amount: 0, label: {} }),
    render: renderProgress,
  },
  tiers: {
    category: 'campaign', icon: 'gift', i18nFields: ['title', 'lead'], itemI18nFields: ['title', 'badge'], itemRichFields: { text: 'rich' }, itemLabel: 'title',
    defaults: () => ({ title: {}, lead: {}, camp: '', interval: 'once', items: [] }),
    schema: [campField, { key: 'interval', type: 'select', label: 'f.interval', options: optList('once', 'month') }],
    itemSchema: [amountField(), { key: 'title', type: 'i18n', label: 'f.title' }, { key: 'badge', type: 'i18n', label: 'f.badge' },
      { key: 'limit', type: 'number', label: 'f.limit', min: 0, max: 1e6, step: 1, hint: 'fh.limit' }, { key: 'claimed', type: 'number', label: 'f.claimed', min: 0, max: 1e6, step: 1 },
      { key: 'image', type: 'att', label: 'f.image', accept: 'image/' }],
    itemDefaults: () => ({ id: uid(), amount: 25, title: {}, text: {}, badge: {}, limit: 0, claimed: 0, image: null }),
    render: renderTiers,
  },
  impact: {
    category: 'campaign', icon: 'sprout', i18nFields: ['title', 'lead'], itemI18nFields: ['text'], itemLabel: 'text',
    defaults: () => ({ title: {}, lead: {}, camp: '', items: [] }),
    schema: [campField],
    itemSchema: [amountField(), { key: 'text', type: 'i18n', label: 'f.impactText' }, { key: 'icon', type: 'icon', label: 'f.icon' }],
    itemDefaults: () => ({ id: uid(), amount: 10, text: {}, icon: 'heart' }),
    render: renderImpact,
  },
  wall: {
    category: 'campaign', icon: 'users', i18nFields: ['title'], itemLabel: 'name',
    defaults: () => ({ title: {}, camp: '', sort: 'recent', count: 12, amounts: true, messages: true, live: true, items: [] }),
    schema: [
      campField,
      { key: 'sort', type: 'select', label: 'f.wallSort', options: [{ v: 'recent', l: 'o.recent' }, { v: 'top', l: 'o.topGifts' }] },
      { key: 'count', type: 'number', label: 'f.count', min: 1, max: 100, step: 1 },
      { key: 'amounts', type: 'checkbox', label: 'f.showAmounts' },
      { key: 'messages', type: 'checkbox', label: 'f.showMessages' },
      { key: 'live', type: 'checkbox', label: 'f.wallLive', hint: 'fh.wallLive' },
    ],
    itemSchema: [{ key: 'name', type: 'text', label: 'f.name' }, amountField(), { key: 'message', type: 'textarea', label: 'f.message' }, { key: 'date', type: 'day', label: 'f.date' }, { key: 'anon', type: 'checkbox', label: 'f.anon' }],
    itemDefaults: () => ({ id: uid(), name: '', amount: 0, message: '', date: '', anon: false }),
    render: renderWall,
  },
  updates: {
    category: 'campaign', icon: 'calendar', i18nFields: ['title'], itemI18nFields: ['title'], itemRichFields: { html: 'rich' }, itemLabel: 'title',
    defaults: () => ({ title: {}, order: 'new', items: [] }),
    schema: [{ key: 'order', type: 'select', label: 'f.order', options: optList('new', 'old') }],
    itemSchema: [{ key: 'date', type: 'day', label: 'f.date' }, { key: 'title', type: 'i18n', label: 'f.title' }, { key: 'image', type: 'att', label: 'f.image', accept: 'image/' }],
    itemDefaults: () => ({ id: uid(), date: '', title: {}, html: {}, image: null }),
    render: renderUpdates,
  },
  faq: {
    category: 'content', icon: 'info', i18nFields: ['title'], itemI18nFields: ['q'], itemRichFields: { a: 'rich' }, itemLabel: 'q',
    defaults: () => ({ title: {}, single: false, items: [] }),
    schema: [{ key: 'single', type: 'checkbox', label: 'f.single' }],
    itemSchema: [{ key: 'q', type: 'i18n', label: 'f.question' }],
    itemDefaults: () => ({ id: uid(), q: {}, a: {} }),
    render: renderFaq,
  },
  matching: {
    category: 'campaign', icon: 'bolt', i18nFields: ['title', 'sponsor'], richFields: { text: 'rich' },
    defaults: () => ({ title: {}, sponsor: {}, logo: null, text: {}, camp: '', ratio: 1, cap: 5000, until: '' }),
    schema: [
      campField,
      { key: 'logo', type: 'att', label: 'f.logo', accept: 'image/' },
      { key: 'ratio', type: 'number', label: 'f.ratio', min: 0.1, max: 10, step: 0.1, hint: 'fh.ratio' },
      { key: 'cap', type: 'number', label: 'f.cap', min: 0, max: 1e9, step: 1, hint: 'fh.cap' },
      { key: 'until', type: 'day', label: 'f.until' },
    ],
    render: renderMatching,
  },
  countdown: {
    category: 'campaign', icon: 'clock', i18nFields: ['title', 'done'],
    defaults: () => ({ title: {}, done: {}, camp: '', date: '', time: '23:59', tz: 0 }),
    schema: [campField, { key: 'date', type: 'day', label: 'f.cdDate', hint: 'fh.cdDate' }, { key: 'time', type: 'time', label: 'f.endTime' },
      { key: 'tz', type: 'number', label: 'f.tzHours', min: -12, max: 14, step: 1 }],
    render: renderCountdown,
  },
  transparency: {
    category: 'campaign', icon: 'chart', i18nFields: ['title', 'lead', 'reportLabel'], itemI18nFields: ['label'], itemLabel: 'label',
    defaults: () => ({ title: {}, lead: {}, camp: '', currency: '', items: [], report: null, reportLabel: {}, updated: '' }),
    schema: [campField, { key: 'report', type: 'att', label: 'f.report', hint: 'fh.report' }, { key: 'reportLabel', type: 'i18n', label: 'f.reportLabel' }, { key: 'updated', type: 'day', label: 'f.updated' }],
    itemSchema: [{ key: 'label', type: 'i18n', label: 'f.label' }, amountField('planned', 'f.planned'), amountField('spent', 'f.spent'), { key: 'color', type: 'color', label: 'f.color' }],
    itemDefaults: () => ({ id: uid(), label: {}, planned: 0, spent: 0, color: '' }),
    normalize: (out) => { out.currency = /^[A-Z]{3}$/.test(str(out.currency)) ? out.currency : ''; },
    render: renderTransparency,
  },
  share: {
    category: 'campaign', icon: 'share', i18nFields: ['title', 'text'],
    defaults: () => ({ title: {}, text: {}, nets: [], url: '' }),
    schema: [{ key: 'nets', type: 'nets', label: 'f.nets' }, { key: 'url', type: 'text', inputType: 'url', label: 'f.shareUrl', hint: 'fh.shareUrl', placeholderText: 'https://' }],
    normalize: (out, b) => {
      out.nets = Array.isArray(b.nets) ? [...new Set(b.nets.filter((n) => SHARE_NETS.includes(n)))] : [];
      out.url = /^https?:\/\/[^\s"'<>]+$/.test(str(b.url).trim()) ? str(b.url).trim() : '';
    },
    render: renderShare,
  },
  thanks: {
    category: 'campaign', icon: 'heart', i18nFields: ['title', 'back'], richFields: { text: 'rich' },
    defaults: () => ({ title: {}, text: {}, back: {}, summary: true }),
    schema: [{ key: 'summary', type: 'checkbox', label: 'f.summary', hint: 'fh.summary' }],
    render: renderThanks,
  },
};

export const CSS_B = {
  hero: `
.fd-hero{position:relative;padding-block:clamp(36px,6cqi,88px)}
.fd-hero-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:clamp(24px,4cqi,56px);align-items:center}
.fd-hero-nomedia .fd-hero-grid,.fd-hero-center .fd-hero-grid{grid-template-columns:minmax(0,1fr)}
.fd-hero-center .fd-hero-text{max-width:760px;margin-inline:auto;text-align:center}
.fd-hero-center .fd-btns{justify-content:center}
.fd-hero-text{display:grid;gap:16px;align-content:center}
.fd-hero-lead{font-size:1.14em;color:var(--fd-muted)}
.fd-hero-lead>*{margin:0}
.fd-hero-img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:calc(var(--fd-radius) + 8px);box-shadow:var(--fd-shadow-lg)}
.fd-hero-prog{background:var(--fd-surface);border:1px solid var(--fd-border);border-radius:var(--fd-radius);padding:16px}
.fd-hero-cover{min-height:min(78vh,720px);display:grid;align-items:end;color:#fff;padding-block:clamp(48px,8cqi,120px) clamp(28px,4cqi,56px)}
.fd-root[data-mode=edit] .fd-hero-cover{min-height:520px}
.fd-hero-bg{position:absolute;inset:0;overflow:hidden}
.fd-hero-bg .fd-hero-img{height:100%;aspect-ratio:auto;border-radius:0;box-shadow:none}
.fd-hero-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.72))}
.fd-hero-cover .fd-hero-grid{position:relative;z-index:1}
.fd-hero-cover .fd-hero-text{max-width:720px}
.fd-hero-cover .fd-hero-lead{color:rgba(255,255,255,.9)}
.fd-hero-cover .fd-eyebrow{color:#fff}
.fd-hero-cover .fd-hero-prog{background:rgba(255,255,255,.94);color:#1f2937;border:0;--fd-text:#1f2937;--fd-muted:#4b5563}
.fd-hero-cover .fd-btn-ghost{color:#fff;border-color:rgba(255,255,255,.7)}
@container fd (max-width:900px){.fd-hero-grid{grid-template-columns:minmax(0,1fr)}.fd-hero-media{order:-1}}
`,
  story: `
.fd-story{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:clamp(24px,4cqi,56px);align-items:start}
.fd-story-left .fd-story-fig{order:-1}
.fd-story-left{grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr)}
.fd-story-none{grid-template-columns:minmax(0,1fr);max-width:760px;margin-inline:auto}
.fd-story-fig{margin:0;position:sticky;top:90px}
.fd-root[data-mode=edit] .fd-story-fig{position:static}
.fd-story-img{display:block;width:100%;height:auto;border-radius:var(--fd-radius)}
.fd-story-body{font-size:1.06em}
@container fd (max-width:900px){.fd-story,.fd-story-left{grid-template-columns:minmax(0,1fr)}.fd-story-fig{position:static;order:-1}}
`,
  progress: `
.fd-prog-big{padding:clamp(18px,3cqi,28px);background:var(--fd-surface);border:1px solid var(--fd-border);border-radius:var(--fd-radius)}
.fd-prog-big .fd-raised{font-size:clamp(1.8em,1.2em + 2.4cqi,2.6em)}
.fd-miles{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:8px}
.fd-mile{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--fd-radius-s);background:var(--fd-surface);border:1px solid var(--fd-border)}
.fd-mile-ic{width:20px;height:20px;color:var(--fd-muted);flex:none}
.fd-mile.fd-done .fd-mile-ic{color:var(--fd-ok)}
.fd-mile.fd-done{border-color:color-mix(in srgb,var(--fd-ok) 40%,var(--fd-border))}
.fd-mile-a{font-weight:700;min-width:6em}
`,
  tiers: `
.fd-tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:var(--fd-gap)}
.fd-tier{position:relative;display:flex;flex-direction:column;gap:10px;padding:22px;background:var(--fd-surface);border:1px solid var(--fd-border);border-radius:var(--fd-radius)}
.fd-tier-img{display:block;width:calc(100% + 44px);margin:-22px -22px 4px;aspect-ratio:16/9;object-fit:cover;border-radius:var(--fd-radius) var(--fd-radius) 0 0}
.fd-tier-a{margin:0;font-family:var(--fd-font-h);font-size:1.7em;font-weight:800;color:var(--fd-link)}
.fd-tier-a small{font-size:.5em;font-weight:600;color:var(--fd-muted)}
.fd-tier-text{color:var(--fd-muted);font-size:.95em}
.fd-tier-text>*{margin:0}
.fd-tier-left{margin:0;font-size:.88em;color:var(--fd-muted)}
.fd-tier .fd-btn{margin-top:auto;align-self:flex-start}
.fd-sold{opacity:.65}
.fd-badge{align-self:flex-start;padding:3px 10px;border-radius:999px;background:var(--fd-tint);color:var(--fd-link);font-size:.8em;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
`,
  impact: `
.fd-imps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
.fd-imp{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"i a" "i t";column-gap:14px;padding:16px;border-radius:var(--fd-radius);background:var(--fd-surface);border:1px solid var(--fd-border);transition:border-color .2s,box-shadow .2s}
.fd-imp-ic{grid-area:i;width:30px;height:30px;color:var(--fd-accent)}
.fd-imp-a{grid-area:a;font-size:1.15em}
.fd-imp-t{grid-area:t;color:var(--fd-muted)}
.fd-imp.fd-on{border-color:var(--fd-accent);box-shadow:0 0 0 3px var(--fd-tint)}
`,
  wall: `
.fd-wall{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.fd-wall-i{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:var(--fd-radius);background:var(--fd-surface);border:1px solid var(--fd-border)}
.fd-ava{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--fd-tint);color:var(--fd-link);font-weight:700;font-size:.9em}
.fd-wall-b{min-width:0;flex:1}
.fd-wall-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.fd-wall-a{color:var(--fd-link);font-weight:700;white-space:nowrap}
.fd-wall-m{margin:4px 0 0;font-size:.94em;overflow-wrap:anywhere}
.fd-wall-d{font-size:.8em;color:var(--fd-muted)}
.fd-wall-top{grid-template-columns:minmax(0,1fr)}
.fd-wall-rank{flex:none;width:26px;font-weight:800;color:var(--fd-muted);text-align:center;padding-top:9px}
.fd-wall-top .fd-wall-i:first-child .fd-wall-rank{color:var(--fd-accent)}
.fd-wall-new{animation:fd-in .6s ease}
@keyframes fd-in{from{opacity:0;transform:translateY(6px)}}
`,
  updates: `
.fd-upds{list-style:none;margin:0;padding:0;display:grid;gap:22px;border-inline-start:2px solid var(--fd-border);padding-inline-start:22px}
.fd-upd{position:relative}
.fd-upd::before{content:"";position:absolute;inset-inline-start:-29px;top:6px;width:12px;height:12px;border-radius:50%;background:var(--fd-accent);box-shadow:0 0 0 4px var(--fd-bg)}
.fd-upd-d{display:block;font-size:.85em;color:var(--fd-muted);margin-bottom:4px}
.fd-upd-b{display:grid;gap:8px}
.fd-upd-img{display:block;width:100%;max-width:520px;height:auto;border-radius:var(--fd-radius-s)}
`,
  faq: `
.fd-faq{display:grid;gap:10px}
.fd-faq-i{border:1px solid var(--fd-border);border-radius:var(--fd-radius-s);background:var(--fd-surface)}
.fd-faq-q{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;font-weight:600;cursor:pointer;list-style:none}
.fd-faq-q::-webkit-details-marker{display:none}
.fd-faq-q .fd-ic{width:20px;height:20px;flex:none;transition:transform .2s}
details[open]>.fd-faq-q .fd-ic{transform:rotate(180deg)}
.fd-faq-a{padding:0 16px 14px;color:var(--fd-muted)}
.fd-faq-a>:first-child{margin-top:0}
`,
  matching: `
.fd-match{display:grid;gap:12px;padding:clamp(18px,3cqi,28px);border-radius:var(--fd-radius);background:linear-gradient(135deg,var(--fd-tint),var(--fd-tint2));border:1px solid color-mix(in srgb,var(--fd-accent) 30%,var(--fd-border))}
.fd-match-head{display:flex;gap:14px;align-items:center}
.fd-match-head .fd-blk-head{margin:0}
.fd-match-logo{width:64px;height:64px;object-fit:contain;border-radius:var(--fd-radius-s);background:#fff;padding:6px}
.fd-match-ratio{display:flex;align-items:center;gap:8px;margin:0;font-size:1.2em;font-weight:800;color:var(--fd-link)}
.fd-match-ratio .fd-ic{width:26px;height:26px}
.fd-match-cap,.fd-match-until{margin:0;font-size:.92em;color:var(--fd-muted);display:flex;gap:6px;align-items:center}
`,
  countdown: `
.fd-cd{display:grid;gap:10px;justify-items:center;text-align:center}
.fd-cd-boxes{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.fd-cd-u{display:grid;min-width:76px;padding:12px 10px;border-radius:var(--fd-radius);background:var(--fd-surface);border:1px solid var(--fd-border)}
.fd-cd-n{font-family:var(--fd-font-h);font-size:2em;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1}
.fd-cd-l{font-size:.8em;color:var(--fd-muted);text-transform:uppercase;letter-spacing:.05em}
.fd-cd-done{margin:0;font-weight:700;color:var(--fd-link)}
.fd-cd:not(.fd-cd-over) .fd-cd-done{display:none}
.fd-root[data-mode=edit] .fd-cd-done{display:block;opacity:.6}
.fd-cd-over .fd-cd-boxes{display:none}
@container fd (max-width:600px){.fd-cd-u{min-width:64px}.fd-cd-n{font-size:1.6em}}
`,
  transparency: `
.fd-spend{display:grid;gap:14px}
.fd-stack{display:flex;height:14px;border-radius:999px;overflow:hidden;background:var(--fd-border)}
.fd-stack span{width:var(--w);background:var(--c)}
.fd-tbl-wrap{position:relative;overflow-x:auto}
.fd-tbl{width:100%;border-collapse:collapse;font-size:.95em}
.fd-tbl th,.fd-tbl td{padding:9px 10px;border-bottom:1px solid var(--fd-border);text-align:end;white-space:nowrap}
.fd-tbl th:first-child{text-align:start;white-space:normal}
.fd-tbl thead th{color:var(--fd-muted);font-weight:600;font-size:.9em}
.fd-tbl tfoot th,.fd-tbl tfoot td{font-weight:800;border-bottom:0}
.fd-sw{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--c);margin-inline-end:8px}
.fd-mini{display:inline-block;width:80px;height:6px;border-radius:999px;background:linear-gradient(90deg,var(--fd-accent) var(--p),var(--fd-border) var(--p))}
.fd-report{margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
`,
  share: `
.fd-share{display:grid;gap:12px}
.fd-share-t{margin:0;color:var(--fd-muted)}
.fd-nets{display:flex;flex-wrap:wrap;gap:8px}
.fd-net{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;border:1px solid var(--fd-border-s);background:var(--fd-surface);color:var(--fd-text);font:inherit;font-size:.92em;text-decoration:none;cursor:pointer}
.fd-net:hover{border-color:var(--fd-accent);color:var(--fd-link)}
.fd-net .fd-ic{width:18px;height:18px}
.fd-share-qr{width:160px}
`,
  thanks: `
.fd-thx{display:grid;gap:14px;justify-items:center;text-align:center;max-width:720px;margin-inline:auto;padding-block:clamp(24px,5cqi,64px)}
.fd-thx-ic{width:56px;height:56px;color:var(--fd-accent)}
.fd-thx-text{color:var(--fd-muted);font-size:1.08em}
.fd-thx-sum{width:100%;display:grid;gap:10px;padding:18px;border-radius:var(--fd-radius);background:var(--fd-surface);border:1px solid var(--fd-border)}
.fd-thx-sum .fd-btns{justify-content:center}
.fd-btns-c{justify-content:center}
`,
};

export const CLASS_OWNERS_B = [
  [/\.fd-hero/, 'hero'], [/\.fd-story/, 'story'], [/\.fd-miles?\b|\.fd-prog-big/, 'progress'], [/\.fd-tiers?\b|\.fd-tier-|\.fd-badge|\.fd-sold/, 'tiers'],
  [/\.fd-imps?\b|\.fd-imp-/, 'impact'], [/\.fd-wall|\.fd-ava/, 'wall'], [/\.fd-upds?\b|\.fd-upd-/, 'updates'], [/\.fd-faq/, 'faq'],
  [/\.fd-match/, 'matching'], [/\.fd-cd/, 'countdown'], [/\.fd-spend|\.fd-stack|\.fd-tbl|\.fd-sw|\.fd-mini|\.fd-report/, 'transparency'],
  [/\.fd-share|\.fd-nets?\b/, 'share'], [/\.fd-thx/, 'thanks'],
];

export { own };
