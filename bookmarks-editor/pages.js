// bookmarks-editor/pages.js - HTML the server renders itself: a user's public bookmarks, the bookmarklet window (save
// form and its sign-in form) and short messages. No scripts except one hashed line that closes the bookmarklet window;
// the stylesheet is hashed too, so these pages run under a strict Content-Security-Policy (cspFor).
//
//   pickLang(acceptLanguage, query) -> 'en' | 'ru' | …      tr(lang, key, vars)
//   renderPublic({ lang, user, items, tags, tag, page, pages, total, feed, base })
//   renderAdd({ lang, form, folders, tags, csrf, existing, error })     renderLogin({ lang, form, error })
//   renderMessage({ lang, title, text, close, link })
//   await cspFor('page' | 'closing') -> Content-Security-Policy header value

//
// Security model: every interpolated value goes through esc() (user names, titles, notes, URLs are all
// user-controlled). There is no template engine with auto-escaping, so the rule is mechanical: no `${x}` in markup
// without esc(), except numbers computed here (counts) and the two constants STYLE / CLOSE_SCRIPT.
// CSP with hashes instead of 'unsafe-inline': even if an escaping bug slipped through, an injected <script> or
// style would not run, because only the exact hashed bytes are allowed.
import { SERVER_STRINGS, SERVER_LANGS } from './server-strings.js';
import { hostOf, isLinkable, displayURL } from '../bookmarks/url.js';

// Escapes the five HTML-significant characters; ' too, so values are safe in single-quoted attributes as well.
// Escaping does not make a URL safe in href: javascript: links are excluded separately with isLinkable().
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Explicit ?lang= wins, then Accept-Language by q-weight (RFC 9110), primary subtag only ("de-AT" -> "de"), then
// English. q=0 means "not acceptable" and is filtered out.
export function pickLang(accept = '', query = '') {
  const q = String(query || '').toLowerCase().split('-')[0];
  if (SERVER_LANGS.includes(q)) return q;
  const prefs = String(accept || '').split(',').map((p) => {
    const [tag, ...params] = p.trim().split(';');
    const qv = params.map((x) => /^\s*q=([\d.]+)/.exec(x)).find(Boolean);
    return { lang: tag.trim().toLowerCase().split('-')[0], q: qv ? Number(qv[1]) : 1 };
  }).filter((x) => x.lang && x.q > 0).sort((a, b) => b.q - a.q);
  for (const p of prefs) if (SERVER_LANGS.includes(p.lang)) return p.lang;
  return 'en';
}

const plural = new Map();
// Plural forms are objects keyed by Intl.PluralRules categories (one / few / many / other); Russian needs four,
// English two. Missing category falls back to `other`, missing key to English, then to the key itself.
export function tr(lang, key, vars) {
  let s = (SERVER_STRINGS[lang] && SERVER_STRINGS[lang][key]) ?? SERVER_STRINGS.en[key] ?? key;
  if (s && typeof s === 'object') {
    let pr = plural.get(lang);
    if (!pr) { try { pr = new Intl.PluralRules(lang); } catch { pr = new Intl.PluralRules('en'); } plural.set(lang, pr); }
    s = s[pr.select(Number(vars && vars.n) || 0)] ?? s.other;
  }
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : String(s);
}

const fmtDate = (lang, ms) => { try { return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(ms)); } catch { return new Date(ms).toISOString().slice(0, 10); } };

// One inline stylesheet for every server page (no extra request, no static file route). Its own small token set
// (not ui/base.css) because the backend bundle carries no UI code. Dark mode via prefers-color-scheme only.
const STYLE = `:root{--bg:#f6f7f9;--panel:#fff;--text:#1d2330;--muted:#6b7280;--border:#e3e6eb;--accent:#2563eb;--accent-weak:#e8efff;--danger:#dc2626;--ok:#16a34a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--panel:#1b1f26;--text:#e6e9ef;--muted:#9aa3b2;--border:#2c323c;--accent:#7aa2ff;--accent-weak:#1f2c4d;--danger:#f87171;--ok:#4ade80;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Georgian",sans-serif}
a{color:var(--accent)}main,header.top,footer{max-width:820px;margin:0 auto;padding:0 16px}
header.top{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;padding-top:28px;padding-bottom:12px}
h1{margin:0;font-size:24px;letter-spacing:-.01em}.sub{color:var(--muted);margin:0}.feed{margin-left:auto;font-size:14px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 18px}.tag{display:inline-block;padding:2px 10px;border:1px solid var(--border);border-radius:999px;background:var(--panel);color:var(--muted);font-size:13px;text-decoration:none}
.tag.on,.tag:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-weak)}
ol.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.it{display:flex;gap:12px;padding:12px 14px;background:var(--panel);border:1px solid var(--border);border-radius:12px}
.av{flex:none;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;font-weight:700;color:#fff;text-transform:uppercase}
.av img{width:20px;height:20px}.av.img{background:var(--accent-weak)}
.h0{background:#e11d48}.h1{background:#ea580c}.h2{background:#d97706}.h3{background:#65a30d}.h4{background:#16a34a}.h5{background:#0d9488}
.h6{background:#0891b2}.h7{background:#2563eb}.h8{background:#4f46e5}.h9{background:#7c3aed}.h10{background:#c026d3}.h11{background:#db2777}
.body{min-width:0;flex:1}.t{font-weight:600;overflow-wrap:anywhere;text-decoration:none}.t:hover{text-decoration:underline}
.meta{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.notes{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.it .tags{margin:6px 0 0}.pager{display:flex;justify-content:space-between;margin:18px 0}.empty{color:var(--muted);padding:32px 0;text-align:center}
footer{color:var(--muted);font-size:13px;padding-top:24px;padding-bottom:32px}
form.card,.card{max-width:560px;margin:20px auto;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px}
.card h1{font-size:19px;margin-bottom:12px}label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin:10px 0 4px}
input[type=text],input[type=url],input[type=password],textarea,select{width:100%;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 10px}
textarea{min-height:84px;resize:vertical}input:focus,textarea:focus,select:focus{outline:2px solid var(--accent);outline-offset:-1px}
.check{display:flex;align-items:center;gap:8px;margin:10px 0 0;font-weight:500;color:var(--text)}.hint{font-size:12px;color:var(--muted);margin-top:3px}
.row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
button,.btn{font:inherit;font-weight:600;border-radius:8px;padding:7px 16px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer;text-decoration:none}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.note{padding:8px 12px;border-radius:8px;background:var(--accent-weak);margin:0 0 8px;font-size:14px}
.err{padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger);margin:0 0 8px;font-size:14px}
.done{font-size:18px;font-weight:700;color:var(--ok);margin:0 0 6px}`;

// The only script on server pages: closes the bookmarklet popup after a save. Constant text, so its hash is stable.
const CLOSE_SCRIPT = 'setTimeout(function(){window.close()},900)';

let hashes = null;
async function sha256b64(text) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(d).toString('base64');
}
// default-src 'none' then allow only what is used: the hashed style, data: images (inline favicons), the hashed
// script on closing pages. form-action 'self' stops a form from posting elsewhere; frame-ancestors 'none' blocks
// clickjacking of the save form; base-uri 'none' stops <base> injection from re-pointing relative URLs.
// Hashes computed once and cached (WebCrypto digest is async).
export async function cspFor(kind = 'page') {
  if (!hashes) hashes = { style: await sha256b64(STYLE), script: await sha256b64(CLOSE_SCRIPT) };
  return `default-src 'none'; style-src 'sha256-${hashes.style}'; img-src data:; ${kind === 'closing' ? `script-src 'sha256-${hashes.script}'; ` : ''}` +
    "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
}

// no-referrer: the public page links to arbitrary sites; leaking "/u/<name>" to them is unnecessary.
function shell(lang, title, body, { head = '', script = false } = {}) {
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title>${head}<style>${STYLE}</style></head>` +
    `<body>${body}${script ? `<script>${CLOSE_SCRIPT}</script>` : ''}</body></html>`;
}

// Same hash as the client avatar (common.js hueOf) but bucketed into 12 fixed classes (.h0..h11): CSP forbids inline
// style attributes, so the colour cannot be an inline hsl() here.
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h % 12; };

function avatar(b) {
  if (b.icon) return `<span class="av img"><img src="${esc(b.icon)}" alt="" width="20" height="20"></span>`;
  const host = hostOf(b.url) || b.title || '?';
  return `<span class="av h${hue(host)}" aria-hidden="true">${esc(Array.from(host)[0] || '?')}</span>`;
}

// Public listing. rel="nofollow ugc": user-generated links should not pass search ranking; noopener noreferrer as in
// the app. An Atom <link rel=alternate> lets feed readers discover the feed from the page.
export function renderPublic({ lang, user, items, tags, tag, page, pages, total, feed, base }) {
  const title = tr(lang, 'pub.title', { name: user });
  const q = (o) => { const p = new URLSearchParams(); if (o.tag) p.set('tag', o.tag); if (o.page > 1) p.set('page', o.page); const s = p.toString(); return s ? '?' + s : '?'; };
  const tagLinks = tags.length ? `<nav class="tags" aria-label="${esc(tr(lang, 'pub.tags'))}"><a class="tag${tag ? '' : ' on'}" href="${esc(base)}">${esc(tr(lang, 'pub.all'))}</a>` +
    tags.map((x) => `<a class="tag${tag && x.tag.toLowerCase() === tag.toLowerCase() ? ' on' : ''}" href="${esc(base + q({ tag: x.tag }))}">${esc(x.tag)} <span>${x.count}</span></a>`).join('') + '</nav>' : '';
  const list = items.map((b) => {
    const link = isLinkable(b.url) ? `<a class="t" href="${esc(b.url)}" rel="nofollow noopener noreferrer ugc">${esc(b.title || b.url)}</a>` : `<span class="t">${esc(b.title || b.url)}</span>`;
    const btags = b.tags.length ? `<div class="tags">${b.tags.map((x) => `<a class="tag" href="${esc(base + q({ tag: x }))}">${esc(x)}</a>`).join('')}</div>` : '';
    return `<li class="it">${avatar(b)}<div class="body">${link}<div class="meta">${esc(displayURL(b.url))} · ${esc(fmtDate(lang, b.created))}</div>` +
      `${b.notes ? `<p class="notes">${esc(b.notes)}</p>` : ''}${btags}</div></li>`;
  }).join('');
  const pager = pages > 1 ? `<nav class="pager"><span>${page > 1 ? `<a href="${esc(base + q({ tag, page: page - 1 }))}">← ${esc(tr(lang, 'pub.prev'))}</a>` : ''}</span>` +
    `<span>${esc(tr(lang, 'pub.page', { n: page }))}</span><span>${page < pages ? `<a href="${esc(base + q({ tag, page: page + 1 }))}">${esc(tr(lang, 'pub.next'))} →</a>` : ''}</span></nav>` : '';
  const body = `<header class="top"><h1>${esc(title)}</h1><p class="sub">${esc(tag ? tr(lang, 'pub.tagged', { tag }) + ' · ' : '')}${esc(tr(lang, 'pub.count', { n: total }))}</p>` +
    `<a class="feed" href="${esc(feed)}">${esc(tr(lang, 'pub.feed'))}</a></header><main>${tagLinks}` +
    (items.length ? `<ol class="list">${list}</ol>` : `<p class="empty">${esc(tr(lang, 'pub.empty'))}</p>`) + `${pager}</main><footer>in-html bookmarks</footer>`;
  return shell(lang, title, body, { head: `<link rel="alternate" type="application/atom+xml" title="${esc(title)}" href="${esc(feed)}">` });
}

const hidden = (name, value) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;

// Bookmarklet save form. The csrf hidden field ties the POST to this rendered form (checked in service.js): another
// site cannot make a signed-in browser post a bookmark. A <datalist> gives tag suggestions without any script.
export function renderAdd({ lang, form, folders, tags, csrf, existing, error }) {
  const opts = [`<option value="">${esc(tr(lang, 'add.root'))}</option>`, ...folders.map((f) => `<option value="${esc(f.id)}"${f.id === form.folder ? ' selected' : ''}>${esc(' '.repeat(f.depth) + f.name)}</option>`)].join('');
  const datalist = `<datalist id="tags">${tags.slice(0, 300).map((x) => `<option value="${esc(x.tag)}">`).join('')}</datalist>`;
  const check = (name, key, on) => `<label class="check"><input type="checkbox" name="${name}" value="1"${on ? ' checked' : ''}> ${esc(tr(lang, key))}</label>`;
  const body = `<form class="card" method="post" action="/add" autocomplete="off"><h1>${esc(tr(lang, 'add.title'))}</h1>` +
    (error ? `<p class="err" role="alert">${esc(error)}</p>` : '') +
    (existing ? `<p class="note">${esc(tr(lang, 'add.exists', { date: fmtDate(lang, existing.created) }))}</p>` : '') +
    hidden('csrf', csrf) + hidden('id', existing ? existing.id : '') + hidden('lang', lang) +
    `<label for="u">${esc(tr(lang, 'add.url'))}</label><input id="u" type="url" name="url" required value="${esc(form.url)}">` +
    `<label for="n">${esc(tr(lang, 'add.name'))}</label><input id="n" type="text" name="title" value="${esc(form.title)}">` +
    `<label for="d">${esc(tr(lang, 'add.notes'))}</label><textarea id="d" name="notes">${esc(form.notes)}</textarea>` +
    `<label for="g">${esc(tr(lang, 'add.tags'))}</label><input id="g" type="text" name="tags" list="tags" value="${esc(form.tags)}"><div class="hint">${esc(tr(lang, 'add.tagsHint'))}</div>${datalist}` +
    `<label for="f">${esc(tr(lang, 'add.folder'))}</label><select id="f" name="folder">${opts}</select>` +
    check('unread', 'add.unread', form.unread) + check('fav', 'add.fav', form.fav) + check('public', 'add.public', form.public) +
    `<div class="row"><button type="submit" class="primary">${esc(tr(lang, 'add.save'))}</button></div></form>`;
  return shell(lang, tr(lang, 'add.title'), body);
}

// Sign-in inside the popup; carries the page URL / title / selection through as hidden fields so the save form can
// be shown right after login without asking again.
export function renderLogin({ lang, form, error }) {
  const body = `<form class="card" method="post" action="/add/login"><h1>${esc(tr(lang, 'add.signin'))}</h1>` +
    (error ? `<p class="err" role="alert">${esc(error)}</p>` : '') +
    hidden('url', form.url) + hidden('title', form.title) + hidden('selection', form.selection) + hidden('lang', lang) +
    `<label for="un">${esc(tr(lang, 'add.user'))}</label><input id="un" type="text" name="name" autocomplete="username" autocapitalize="none" required>` +
    `<label for="pw">${esc(tr(lang, 'add.password'))}</label><input id="pw" type="password" name="password" autocomplete="current-password" required>` +
    `<div class="row"><button type="submit" class="primary">${esc(tr(lang, 'add.login'))}</button></div></form>`;
  return shell(lang, tr(lang, 'add.signin'), body);
}

// Small result page; with close=true it includes the hashed close script (CSP kind 'closing').
export function renderMessage({ lang, title, text = '', close = false, link = '' }) {
  const body = `<div class="card"><p class="${close ? 'done' : ''}">${esc(title)}</p>${text ? `<p>${esc(text)}</p>` : ''}` +
    (close ? `<p class="hint">${esc(tr(lang, 'add.closing'))}</p>` : '') + (link ? `<div class="row"><a class="btn" href="${esc(link)}">${esc(tr(lang, 'add.open'))}</a></div>` : '') + '</div>';
  return shell(lang, title, body, { script: close });
}
