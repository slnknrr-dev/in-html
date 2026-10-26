// site-studio/viewer-blocks-chat.js - the chat block (content, CONTRACT.md §5, §17): an inline panel or a
// floating bubble with title, operator name and picture, welcome text, offline note, optional visitor name / contact,
// message list and send box. Three transports chosen at export: an external chat API through two configured requests
// (send / poll), the built-in `api/chat` of a backend export, or "leave a message" (fallback channel / outbox). Runtime:
// feature chat (viewer-runtime-chat.js). CSS, variants and viewer strings (7 languages) of the block.
import { optList } from '../doc/schema.js';
import { attOf, attSrc, isImage } from '../doc/attach.js';
import { uiText } from '../doc/dict.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { feature, fld, has, icon, needUi, plainIn, txt, ui } from '../doc/render.js';
import { isObj, oneOf, str } from '../util/value.js';
//
// Key decisions:
// - Transport is chosen at export (chatMode) and baked into cfg.chats, so the runtime never guesses; the page carries
//   only the request configs it can use (ctx.use.reqs), never unused endpoints.
// - Degradation ladder: external API -> built-in backend -> leave a message. A message is never silently lost: the
//   last rung always has a channel (outbox in the browser, mail, messenger) unless the author picks 'none'.
// - The composer is .lp-js-only (a chat cannot work without script); the inline panel shows a no-script note.

/* ---------- helpers ---------- */

const CH_FIELDS = ['off', 'optional', 'required'];
const CH_FALLBACKS = ['outbox', 'mailto', 'whatsapp', 'telegram', 'none'];
// A request usable as an external chat API: http(s) or a path on the same site (never a browser-local endpoint).
const CH_EXT_URL = /^(https?:\/\/[^\s"'<>\\]+|\.{0,2}\/[^\s"'<>\\]*)$/i;

// Request lookup by id; non-string ids and missing request lists return null rather than throwing.
const chReq = (doc, id) => (typeof id === 'string' && id ? (Array.isArray(doc.requests) ? doc.requests : []).find((r) => isObj(r) && r.id === id) || null : null);

// Runtime request configuration { m, u, h, c, t, r } of a request id, or null.
function chReqCfg(doc, id) {
  const r = chReq(doc, id);
  if (!r || !CH_EXT_URL.test(str(r.url).trim())) return null;
  const h = {};
  for (const x of Array.isArray(r.headers) ? r.headers : []) if (isObj(x) && x.k) h[x.k] = x.v;
  return { m: r.method, u: r.url, h, c: r.credentials, t: r.timeout, r: r.retries };
}

// Fallback destination per channel (same rules as the form block): e-mail | phone digits | username | ''.
// Validation here (not only in the editor) because documents can be imported or hand-edited: an invalid address
// must yield '' (no channel button) rather than a broken mailto/wa.me link. Phone length 7..15 follows E.164.
function chTo(fb, raw) {
  const v = str(raw).trim();
  if (fb === 'mailto') {
    const e = v.replace(/^mailto:/i, '').split('?')[0];
    return /^[^\s@<>"',;:?&#/]+@[^\s@<>"',;:?&#/]+\.[^\s@<>"',;:?&#/]{2,}$/.test(e) ? e : '';
  }
  if (fb === 'whatsapp') { const d = v.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 ? d : ''; }
  if (fb === 'telegram') { const m = /^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z0-9_]{4,32})\/?$/.exec(v); return m ? m[1] : ''; }
  return '';
}

// How a chat block talks at runtime: 'ext' (send request with a server URL), 'api' (backend export: the built-in
// api/chat; static hosting degrades to 'msg' at runtime) or 'msg' (leave a message through the fallback).
function chatMode(b, ctx) {
  if (chReqCfg(ctx.doc, b.sendReq)) return 'ext';
  return ctx.api ? 'api' : 'msg';
}

// Runtime strings of the chat feature (cfg.ui).
const CH_UI = ['chatOpen', 'chatClose', 'chatUnread', 'chatYou', 'chatSending', 'chatFailed', 'chatRetry', 'chatLeft', 'chatQueued',
  'chatDirect', 'chatNew', 'chatOffline', 'fieldRequired', 'fieldInvalid', 'formErrors', 'sendByEmail', 'sendWhatsApp',
  'sendTelegram', 'coPaste', 'coCopyFail'];

/* ---------- rendering ---------- */

function chAvatar(ctx, b, cls) {
  const a = attOf(ctx, b.avatar);
  const src = a && isImage(a) ? attSrc(ctx, a) : '';
  if (src) return `<span class="${cls}"><img src="${escapeAttr(src)}" alt="" loading="lazy" decoding="async"></span>`;
  return `<span class="${cls} lp-chat-av-ic">${icon(ctx, 'chat')}</span>`;
}

// Visitor fields (name / contact) shown before the first message; ids are unique per block.
// Each input owns an error span referenced by aria-describedby, so validation messages are read with the field.
function chWho(ctx, b, bid) {
  const row = (key, mode, type, ac, labelKey) => {
    if (mode === 'off') return '';
    const id = `lp-chat-${key}-${bid}`;
    const req = mode === 'required';
    return `<div class="lp-chat-f"><label class="lp-chat-l" for="${id}">${ui(ctx, labelKey)}${req ? '<span class="lp-req" aria-hidden="true">*</span>' : ''}</label>`
      + `<input class="lp-chat-i" id="${id}" name="${key}" type="${type}" autocomplete="${ac}" maxlength="200"${req ? ' required aria-required="true"' : ''}`
      + ` aria-describedby="${id}-err"><span class="lp-chat-err" id="${id}-err" data-lp-err="${key}" hidden></span></div>`;
  };
  const s = row('name', oneOf(b.nameField, CH_FIELDS, 'optional'), 'text', 'name', 'chatName')
    + row('contact', oneOf(b.contactField, CH_FIELDS, 'optional'), 'text', 'email', 'chatContact');
  return s ? `<div class="lp-chat-who" data-lp-chat-who>${s}</div>` : '';
}

// The panel (inline block or floating popup). pop: popup inside the floating widget (close button, dialog role).
function chPanel(ctx, b, mode, pop) {
  const bid = escapeAttr(b.id);
  const hid = `lp-chat-h-${bid}`;
  const title = has(ctx, b.title) ? txt(ctx, b.title) : ui(ctx, 'chatTitle');
  const op = has(ctx, b.operator) ? `<p class="lp-chat-op">${txt(ctx, b.operator)}</p>` : '';
  const close = pop ? `<button type="button" class="lp-chat-x" data-lp-chat-close>${icon(ctx, 'close')}<span class="lp-sr">${ui(ctx, 'chatClose')}</span></button>` : '';
  const head = `<div class="lp-chat-head">${chAvatar(ctx, b, 'lp-chat-av')}<div class="lp-chat-hd"><h3 class="lp-chat-t" id="${hid}">${title}</h3>${op}</div>`
    + `<span class="lp-chat-dot" data-lp-chat-dot aria-hidden="true"></span>${close}</div>`;
  const welcome = has(ctx, b.welcome) ? `<div class="lp-chat-msg lp-chat-them lp-chat-welcome"><div class="lp-chat-bub">${txt(ctx, b.welcome)}</div></div>` : '';
  // The offline note: always shown for 'leave a message'; the runtime shows it when a backend chat runs static.
  const offTxt = has(ctx, b.offline) ? txt(ctx, b.offline) : ui(ctx, 'chatOffline');
  const off = `<p class="lp-chat-off" data-lp-chat-off${mode === 'msg' ? '' : ' hidden'}>${offTxt}</p>`;
  // role=log + aria-live=polite + aria-relevant=additions: screen readers announce new messages only, never the
  // whole history; tabindex=0 makes the scrollable log reachable by keyboard.
  const log = `<div class="lp-chat-log" data-lp-chat-log role="log" aria-live="polite" aria-relevant="additions" tabindex="0" aria-label="${escapeAttr(plainIn(ctx, b.title, ctx.defaultLang) || uiText('chatMessages', ctx.defaultLang, ctx.doc))}">${welcome}</div>`;
  // Placeholder of the default language; the i18n runtime switches it (data-lp-i18n) with the page language.
  const ph = (l) => uiText('chatPlaceholder', l, ctx.doc);
  const phs = ctx.langs.map((l) => [l, ph(l)]);
  const phAttr = ` placeholder="${escapeAttr(ph(ctx.defaultLang))}"` + (new Set(phs.map((x) => x[1])).size > 1
    ? ` data-lp-i18n="${escapeAttr(JSON.stringify({ placeholder: Object.fromEntries(phs) }))}"` : '');
  const send = `<button type="submit" class="lp-chat-send" data-lp-chat-submit>${icon(ctx, 'send')}<span class="lp-sr">${ui(ctx, 'chatSend')}</span></button>`;
  const form = `<form class="lp-chat-form lp-js-only" data-lp-chat-form novalidate>${chWho(ctx, b, bid)}`
    + `<div class="lp-chat-box"><label class="lp-sr" for="lp-chat-in-${bid}">${ui(ctx, 'chatInput')}</label>`
    + `<textarea class="lp-chat-in" id="lp-chat-in-${bid}" name="text" rows="1" maxlength="4000" required${phAttr} data-lp-chat-in></textarea>${send}</div>`
    + `<p class="lp-chat-st" data-lp-chat-st role="status" hidden></p><div class="lp-chat-fb" data-lp-chat-fb hidden></div></form>`;
  const nojs = pop ? '' : `<p class="lp-chat-nojs">${ui(ctx, 'chatNoJs')}</p>`;
  // Non-modal dialog: the floating chat must not block the page (visitors read while chatting), so no focus trap
  // and aria-modal=false.
  const role = pop ? ` role="dialog" aria-modal="false" id="lp-chat-p-${bid}" hidden` : '';
  return `<section class="lp-chat${pop ? ' lp-chat-pop' : ' lp-chat-inline'}" data-lp-chat="${bid}" data-lp-chat-mode="${mode}" aria-labelledby="${hid}"${role}>`
    + `${head}${log}${off}${form}${nojs}</section>`;
}

// Edit mode: a static look-alike with editable title, operator, welcome text and offline note.
// The canvas never runs the chat: a live widget would send real messages while the author edits.
function chEdit(ctx, b) {
  const bubble = b.display === 'bubble';
  const head = `<div class="lp-chat-head">${chAvatar(ctx, b, 'lp-chat-av')}<div class="lp-chat-hd">`
    + `${fld(ctx, b, 'title', 'plain', 'h3', 'lp-chat-t', 'chatTitle', { ph: uiText('chatTitle', ctx.lang, ctx.doc) })}`
    + `${fld(ctx, b, 'operator', 'plain', 'p', 'lp-chat-op', 'phc.operator', { ecls: 'lp-opt' })}</div><span class="lp-chat-dot" aria-hidden="true"></span></div>`;
  const log = `<div class="lp-chat-log"><div class="lp-chat-msg lp-chat-them lp-chat-welcome">`
    + `${fld(ctx, b, 'welcome', 'plain', 'div', 'lp-chat-bub', 'phc.welcome')}</div>`
    + `<div class="lp-chat-msg lp-chat-me"><div class="lp-chat-bub lp-chat-sample">${escapeHTML(uiText('chatEdit', ctx.uiLang, ctx.doc))}</div></div></div>`;
  const off = fld(ctx, b, 'offline', 'plain', 'p', 'lp-chat-off', 'phc.offline', { ph: uiText('chatOffline', ctx.lang, ctx.doc), ecls: 'lp-opt' });
  const box = `<div class="lp-chat-form"><div class="lp-chat-box"><span class="lp-chat-in lp-chat-in-ed">${escapeHTML(uiText('chatPlaceholder', ctx.lang, ctx.doc))}</span>`
    + `<span class="lp-chat-send">${icon(ctx, 'send')}</span></div></div>`;
  const note = bubble ? `<p class="lp-chat-note">${icon(ctx, 'chat')}<span>${escapeHTML(uiText('chatBubbleNote', ctx.uiLang, ctx.doc))}</span></p>` : '';
  return `${note}<section class="lp-chat lp-chat-inline${bubble ? ' lp-chat-edbubble' : ''}">${head}${log}${off}${box}</section>`;
}

function chRender(b, ctx) {
  if (ctx.edit) return chEdit(ctx, b);
  const mode = chatMode(b, ctx);
  const bid = str(b.id);
  feature(ctx, 'chat');
  needUi(ctx, ...CH_UI);
  if (!(ctx.use.chats instanceof Map)) ctx.use.chats = new Map();
  const fb = oneOf(b.fallback, CH_FALLBACKS, 'outbox');
  // Compact keys (m, s, p, fb, to, n, c): this object is serialized into every exported page's config.
  ctx.use.chats.set(bid, {
    m: mode,
    s: mode === 'ext' ? chReqCfg(ctx.doc, b.sendReq) : null,
    p: mode === 'ext' ? chReqCfg(ctx.doc, b.pollReq) : null,
    fb, to: chTo(fb, b.to),
    n: oneOf(b.nameField, CH_FIELDS, 'optional'), c: oneOf(b.contactField, CH_FIELDS, 'optional'),
  });
  if (mode === 'ext') {
    for (const k of ['sendReq', 'pollReq']) if (chReq(ctx.doc, b[k]) && ctx.use.reqs instanceof Set) ctx.use.reqs.add(b[k]);
  }
  if (b.display !== 'bubble') return chPanel(ctx, b, mode, false);
  // Floating bubble: the widget sits at the end of <body> (outside .lp-root, whose container query would otherwise be
  // its containing block); the block itself keeps an empty slot.
  const side = b.side === 'left' ? 'left' : 'right';
  const pops = Array.isArray(ctx.use.chatPops) ? ctx.use.chatPops : (ctx.use.chatPops = []);
  pops.push(`<div class="lp-chatw lp-ovl lp-chatw-${side} lp-js-only" data-lp-chat-w="${escapeAttr(bid)}">`
    + `<button type="button" class="lp-chat-fab" data-lp-chat-open="${escapeAttr(bid)}" aria-expanded="false" aria-controls="lp-chat-p-${escapeAttr(bid)}">`
    + `${icon(ctx, 'chat')}<span class="lp-sr">${ui(ctx, 'chatOpen')}</span><span class="lp-chat-badge" data-lp-chat-badge hidden>0</span></button>`
    + `${chPanel(ctx, b, mode, true)}</div>\n`);
  return `<div class="lp-chat-slot" data-lp-chat-slot="${escapeAttr(bid)}" hidden></div>`;
}

// Floating chat widgets of the page (exporter: end of <body>).
function renderChatPops(ctx) {
  return !ctx.edit && Array.isArray(ctx.use.chatPops) ? ctx.use.chatPops.join('') : '';
}

/* ---------- registry ---------- */

const BT_CHAT = {
  chat: {
    category: 'content', icon: 'chat', container: false, variants: ['display'],
    i18nFields: ['title', 'welcome', 'operator', 'offline'],
    // Without an external API the chat needs a backend export (validation before a serverless export).
    live: true,
    defaults: () => ({
      display: 'inline', side: 'right', title: {}, welcome: {}, operator: {}, avatar: null, offline: {},
      nameField: 'optional', contactField: 'optional', sendReq: null, pollReq: null, fallback: 'outbox', to: '',
    }),
    schema: [
      { key: 'display', type: 'select', label: 'f.chatDisplay', options: optList('inline', 'bubble') },
      { key: 'side', type: 'select', label: 'f.chatSide', options: optList('right', 'left'), when: { display: 'bubble' } },
      { key: 'avatar', type: 'att', label: 'f.chatAvatar', accept: 'image/' },
      { key: 'welcome', type: 'i18n', label: 'f.chatWelcome', multiline: true, rows: 2 },
      { key: 'offline', type: 'i18n', label: 'f.chatOffline', multiline: true, rows: 2, hint: 'fh.chatOffline' },
      { key: 'nameField', type: 'select', label: 'f.chatName', options: CH_FIELDS.map((v) => ({ v, l: 'o.chf.' + v })) },
      { key: 'contactField', type: 'select', label: 'f.chatContact', options: CH_FIELDS.map((v) => ({ v, l: 'o.chf.' + v })) },
      { key: 'sendReq', type: 'req', label: 'f.chatSend', hint: 'fh.chatSend' },
      { key: 'pollReq', type: 'req', label: 'f.chatPoll', hint: 'fh.chatPoll' },
      { key: 'fallback', type: 'select', label: 'f.chatFallback', hint: 'fh.chatFallback',
        options: [...optList('outbox', 'mailto', 'whatsapp', 'telegram'), { v: 'none', l: 'o.fbNone' }] },
      { key: 'to', type: 'text', label: 'f.to', hint: 'fh.formTo', when: { fallback: ['mailto', 'whatsapp', 'telegram'] } },
    ],
    render: chRender,
  },
};

/* ---------- CSS (block chunk; the floating widget lives outside .lp-root: every token has a fallback) ---------- */

// Every token read with a literal fallback: the floating widget is appended to <body> outside .lp-root, where the
// theme's --lp-* custom properties may not be defined.
const CH_V = (n, d) => `var(--lp-${n},${d})`;
const CSS_BLOCKS_CHAT = {
  chat: `
.lp-b-chat:has(.lp-chat-slot){display:none}
.lp-chat{--lp-chat-r:${CH_V('radius', '10px')};display:flex;flex-direction:column;min-width:0;overflow:hidden;background:${CH_V('bg', '#fff')};color:${CH_V('text', '#16191e')};border:1px solid ${CH_V('border', '#e3e6ea')};border-radius:calc(var(--lp-chat-r)*1.3);box-shadow:${CH_V('shadow', '0 6px 18px -8px rgba(0,0,0,.18)')};font-family:${CH_V('font', 'system-ui,sans-serif')};line-height:1.45;text-align:start}
.lp-chat *,.lp-chat *::before,.lp-chat *::after{box-sizing:border-box}
.lp-chat [hidden]{display:none!important}
.lp-chat-inline{max-width:640px;margin-inline:auto;height:min(560px,calc(var(--lp-vh,1vh)*78))}
.lp-chat-head{display:flex;align-items:center;gap:12px;padding:14px 16px;background:${CH_V('accent', '#2453d8')};color:${CH_V('on-accent', '#fff')}}
.lp-chat-av{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;overflow:hidden;border-radius:50%;background:color-mix(in srgb,currentColor 18%,transparent)}
.lp-chat-av img{width:100%;height:100%;object-fit:cover}
.lp-chat-av .lp-ic{width:22px;height:22px}
.lp-chat-hd{flex:1;min-width:0}
.lp-chat-t{margin:0;font:600 1.05em/1.25 ${CH_V('font-h', 'inherit')};color:inherit;overflow-wrap:anywhere}
.lp-chat-op{margin:2px 0 0;font-size:.86em;overflow-wrap:anywhere}
.lp-chat-dot{flex:none;width:10px;height:10px;border-radius:50%;background:color-mix(in srgb,currentColor 45%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,currentColor 15%,transparent)}
.lp-chat[data-lp-chat-state=on] .lp-chat-dot{background:#22c55e}
.lp-chat-x{flex:none;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;margin:-6px -8px -6px 0;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}
.lp-chat-x:hover{background:color-mix(in srgb,currentColor 16%,transparent)}
.lp-chat-x .lp-ic{width:20px;height:20px}
.lp-chat-log{flex:1 1 auto;min-height:120px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px;padding:16px;background:${CH_V('surface', '#f5f7fa')};scroll-behavior:smooth}
.lp-chat-log:focus-visible{outline:2px solid ${CH_V('accent', '#2453d8')};outline-offset:-2px}
.lp-chat-msg{display:flex;flex-direction:column;align-items:flex-start;max-width:85%;min-width:0}
.lp-chat-me{align-self:flex-end;align-items:flex-end}
.lp-chat-sys{align-self:center;align-items:center;max-width:100%}
.lp-chat-bub{padding:9px 13px;border-radius:16px 16px 16px 4px;background:${CH_V('bg', '#fff')};color:${CH_V('text', '#16191e')};border:1px solid ${CH_V('border', '#e3e6ea')};white-space:pre-wrap;overflow-wrap:anywhere;font-size:.95em}
.lp-chat-bub p{margin:0}
.lp-chat-me .lp-chat-bub{border-radius:16px 16px 4px 16px;border-color:transparent;background:${CH_V('accent', '#2453d8')};color:${CH_V('on-accent', '#fff')}}
.lp-chat-sys .lp-chat-bub{border-radius:10px;border-style:dashed;background:transparent;color:${CH_V('muted', '#5b6472')};font-size:.88em;text-align:center}
.lp-chat-meta{margin-top:3px;padding:0 4px;color:${CH_V('muted', '#5b6472')};font-size:.74em;font-variant-numeric:tabular-nums}
.lp-chat-fail .lp-chat-bub{opacity:.75}
.lp-chat-retry{margin-top:3px;padding:2px 8px;border:0;border-radius:99px;background:color-mix(in srgb,${CH_V('danger', '#dc2626')} 12%,transparent);color:${CH_V('danger', '#dc2626')};font:inherit;font-size:.78em;font-weight:600;cursor:pointer}
.lp-chat-off{margin:0;padding:10px 16px;border-top:1px solid ${CH_V('border', '#e3e6ea')};background:color-mix(in srgb,${CH_V('accent', '#2453d8')} 7%,${CH_V('bg', '#fff')});color:${CH_V('muted', '#5b6472')};font-size:.88em}
.lp-chat-form{flex:none;display:flex;flex-direction:column;gap:8px;margin:0;padding:12px;border-top:1px solid ${CH_V('border', '#e3e6ea')};background:${CH_V('bg', '#fff')}}
.lp-chat-who{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.lp-chat-f{display:flex;flex-direction:column;gap:4px;min-width:0}
.lp-chat-l{font-size:.8em;font-weight:600;color:${CH_V('muted', '#5b6472')}}
.lp-chat-l .lp-req{color:${CH_V('danger', '#dc2626')};margin-inline-start:2px}
.lp-chat-i,.lp-chat-in{display:block;width:100%;min-width:0;margin:0;border:1px solid ${CH_V('border-s', '#cfd5dd')};border-radius:calc(var(--lp-chat-r)*.8);background:${CH_V('bg', '#fff')};color:inherit;font:inherit;font-size:max(16px,.95em)}
.lp-chat-i{min-height:40px;padding:7px 10px}
.lp-chat-i:focus,.lp-chat-in:focus{outline:none;border-color:${CH_V('link', '#2453d8')};box-shadow:0 0 0 3px ${CH_V('tint', 'rgba(36,83,216,.12)')}}
.lp-chat-i[aria-invalid=true]{border-color:${CH_V('danger', '#dc2626')}}
.lp-chat-err{color:${CH_V('danger', '#dc2626')};font-size:.78em}
.lp-chat-box{display:flex;align-items:flex-end;gap:8px}
.lp-chat-in{flex:1;min-height:44px;max-height:9em;padding:10px 12px;resize:none;line-height:1.4;overflow-y:auto}
.lp-chat-in-ed{display:flex;align-items:center;color:${CH_V('muted', '#5b6472')}}
.lp-chat-send{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:${CH_V('accent', '#2453d8')};color:${CH_V('on-accent', '#fff')};cursor:pointer;transition:transform .15s,opacity .15s}
.lp-chat-send:hover{transform:scale(1.05)}
.lp-chat-send:disabled{opacity:.55;cursor:progress;transform:none}
.lp-chat-send:focus-visible,.lp-chat-fab:focus-visible,.lp-chat-x:focus-visible,.lp-chat-retry:focus-visible{outline:2px solid ${CH_V('accent', '#2453d8')};outline-offset:2px}
.lp-chat-send .lp-ic{width:20px;height:20px}
.lp-chat-st{margin:0;color:${CH_V('muted', '#5b6472')};font-size:.82em}
.lp-chat-st[data-state=err]{color:${CH_V('danger', '#dc2626')}}
.lp-chat-fb{display:flex;flex-wrap:wrap;gap:8px}
.lp-chat-fb .lp-btn{min-height:36px}
.lp-chat-nojs{margin:0;padding:12px 16px;color:${CH_V('muted', '#5b6472')};font-size:.9em}
html.lp-js .lp-chat-nojs{display:none}
.lp-chat-note{display:flex;align-items:center;gap:8px;margin:0 0 10px;color:${CH_V('muted', '#5b6472')};font-size:.85em}
.lp-chat-note .lp-ic{width:18px;height:18px}
.lp-chat-sample{opacity:.8;font-style:italic}
.lp-chatw{position:fixed;z-index:1300;bottom:calc(18px + env(safe-area-inset-bottom,0px));inset-inline-end:18px;display:flex;flex-direction:column;align-items:flex-end;gap:12px;font-size:${CH_V('fs', '16px')};pointer-events:none}
.lp-chatw-left{inset-inline-end:auto;inset-inline-start:18px;align-items:flex-start}
.lp-chatw>*{pointer-events:auto}
.lp-chat-fab{position:relative;order:2;display:inline-flex;align-items:center;justify-content:center;width:58px;height:58px;padding:0;border:0;border-radius:50%;background:${CH_V('accent', '#2453d8')};color:${CH_V('on-accent', '#fff')};box-shadow:${CH_V('shadow-lg', '0 14px 40px rgba(15,23,42,.25)')};cursor:pointer;transition:transform .18s}
.lp-chat-fab:hover{transform:translateY(-2px)}
.lp-chat-fab .lp-ic{width:26px;height:26px}
.lp-chat-badge{position:absolute;top:-3px;inset-inline-end:-3px;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:99px;background:${CH_V('danger', '#dc2626')};color:#fff;font-size:12px;font-weight:700;box-shadow:0 0 0 2px ${CH_V('bg', '#fff')};font-variant-numeric:tabular-nums}
.lp-chat-pop{order:1;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 110px));height:min(560px,calc(100dvh - 110px));box-shadow:${CH_V('shadow-lg', '0 24px 70px rgba(0,0,0,.3)')};animation:lp-chat-in .2s var(--lp-ease,ease-out)}
@keyframes lp-chat-in{from{opacity:0;transform:translateY(12px) scale(.98)}}
@media (max-width:480px){.lp-chatw{inset-inline-end:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px))}.lp-chatw-left{inset-inline-start:12px}.lp-chat-pop{width:calc(100vw - 24px);height:calc(100dvh - 96px)}}
@media (prefers-reduced-motion:reduce){.lp-chat-pop{animation:none}.lp-chat-fab,.lp-chat-send{transition:none}.lp-chat-log{scroll-behavior:auto}}
@media print{.lp-chatw,.lp-b-chat{display:none!important}}
`,
};

const CSS_VARIANTS_CHAT = { chat: { 'display=inline': '', 'display=bubble': '' } };

const BLOCK_DEPS_CHAT = { chat: [] };

const OWN_CHAT = [[/\.lp-chat/, 'chat']];

/* ---------- viewer strings (7 languages) ---------- */

const UI_CHAT = {
  en: {
    chatTitle: 'Chat with us', chatMessages: 'Messages', chatOpen: 'Open the chat', chatClose: 'Close the chat',
    chatUnread: { one: '{n} new message', other: '{n} new messages' }, chatInput: 'Your message', chatPlaceholder: 'Write a message…',
    chatSend: 'Send', chatName: 'Your name', chatContact: 'E-mail or phone', chatYou: 'You',
    chatSending: 'Sending…', chatFailed: 'Not sent. Check your connection and try again.', chatRetry: 'Retry',
    chatOffline: 'We are not online right now. Leave a message and we will get back to you.',
    chatLeft: 'Thank you! Your message has been sent. We will get back to you soon.',
    chatQueued: 'No connection — your message is saved and will be sent automatically.',
    chatDirect: 'Your message is ready in the app that just opened — send it from there.',
    chatNew: 'New message from {name}', chatNoJs: 'The chat needs JavaScript. Please contact us another way.',
    chatEdit: 'Visitors’ messages appear here.', chatBubbleNote: 'On the page this chat opens from a floating button in the corner.',
    'phc.operator': 'Operator name or role', 'phc.welcome': 'Welcome message…', 'phc.offline': 'Offline note',
  },
  ru: {
    chatTitle: 'Напишите нам', chatMessages: 'Сообщения', chatOpen: 'Открыть чат', chatClose: 'Закрыть чат',
    chatUnread: { one: '{n} новое сообщение', few: '{n} новых сообщения', many: '{n} новых сообщений', other: '{n} новых сообщения' },
    chatInput: 'Ваше сообщение', chatPlaceholder: 'Напишите сообщение…',
    chatSend: 'Отправить', chatName: 'Ваше имя', chatContact: 'Email или телефон', chatYou: 'Вы',
    chatSending: 'Отправка…', chatFailed: 'Не отправлено. Проверьте подключение и попробуйте ещё раз.', chatRetry: 'Повторить',
    chatOffline: 'Сейчас мы не в сети. Оставьте сообщение — мы обязательно ответим.',
    chatLeft: 'Спасибо! Сообщение отправлено. Мы скоро ответим.',
    chatQueued: 'Нет связи — сообщение сохранено и будет отправлено автоматически.',
    chatDirect: 'Сообщение подготовлено в открывшемся приложении — отправьте его оттуда.',
    chatNew: 'Новое сообщение: {name}', chatNoJs: 'Для чата нужен JavaScript. Свяжитесь с нами другим способом.',
    chatEdit: 'Здесь появятся сообщения посетителей.', chatBubbleNote: 'На странице этот чат открывается плавающей кнопкой в углу.',
    'phc.operator': 'Имя или роль оператора', 'phc.welcome': 'Приветствие…', 'phc.offline': 'Текст «не в сети»',
  },
  uk: {
    chatTitle: 'Напишіть нам', chatMessages: 'Повідомлення', chatOpen: 'Відкрити чат', chatClose: 'Закрити чат',
    chatUnread: { one: '{n} нове повідомлення', few: '{n} нові повідомлення', many: '{n} нових повідомлень', other: '{n} нового повідомлення' },
    chatInput: 'Ваше повідомлення', chatPlaceholder: 'Напишіть повідомлення…',
    chatSend: 'Надіслати', chatName: 'Ваше ім’я', chatContact: 'Email або телефон', chatYou: 'Ви',
    chatSending: 'Надсилання…', chatFailed: 'Не надіслано. Перевірте з’єднання й спробуйте ще раз.', chatRetry: 'Повторити',
    chatOffline: 'Зараз ми не в мережі. Залиште повідомлення — ми обов’язково відповімо.',
    chatLeft: 'Дякуємо! Повідомлення надіслано. Ми скоро відповімо.',
    chatQueued: 'Немає зв’язку — повідомлення збережено й буде надіслано автоматично.',
    chatDirect: 'Повідомлення підготовлено в застосунку, що відкрився, — надішліть його звідти.',
    chatNew: 'Нове повідомлення: {name}', chatNoJs: 'Для чату потрібен JavaScript. Зв’яжіться з нами іншим способом.',
    chatEdit: 'Тут з’являться повідомлення відвідувачів.', chatBubbleNote: 'На сторінці цей чат відкривається плаваючою кнопкою в кутку.',
    'phc.operator': 'Ім’я або роль оператора', 'phc.welcome': 'Привітання…', 'phc.offline': 'Текст «не в мережі»',
  },
  de: {
    chatTitle: 'Schreiben Sie uns', chatMessages: 'Nachrichten', chatOpen: 'Chat öffnen', chatClose: 'Chat schließen',
    chatUnread: { one: '{n} neue Nachricht', other: '{n} neue Nachrichten' }, chatInput: 'Ihre Nachricht', chatPlaceholder: 'Nachricht schreiben …',
    chatSend: 'Senden', chatName: 'Ihr Name', chatContact: 'E-Mail oder Telefon', chatYou: 'Sie',
    chatSending: 'Wird gesendet …', chatFailed: 'Nicht gesendet. Prüfen Sie die Verbindung und versuchen Sie es erneut.', chatRetry: 'Erneut senden',
    chatOffline: 'Wir sind gerade nicht online. Hinterlassen Sie eine Nachricht – wir melden uns.',
    chatLeft: 'Vielen Dank! Ihre Nachricht wurde gesendet. Wir melden uns bald.',
    chatQueued: 'Keine Verbindung – die Nachricht ist gespeichert und wird automatisch gesendet.',
    chatDirect: 'Ihre Nachricht ist in der geöffneten App vorbereitet – senden Sie sie von dort.',
    chatNew: 'Neue Nachricht von {name}', chatNoJs: 'Der Chat benötigt JavaScript. Bitte kontaktieren Sie uns auf anderem Weg.',
    chatEdit: 'Hier erscheinen die Nachrichten der Besucher.', chatBubbleNote: 'Auf der Seite öffnet sich dieser Chat über eine schwebende Schaltfläche in der Ecke.',
    'phc.operator': 'Name oder Rolle', 'phc.welcome': 'Begrüßung …', 'phc.offline': 'Hinweis „nicht online“',
  },
  fr: {
    chatTitle: 'Écrivez-nous', chatMessages: 'Messages', chatOpen: 'Ouvrir le chat', chatClose: 'Fermer le chat',
    chatUnread: { one: '{n} nouveau message', other: '{n} nouveaux messages' }, chatInput: 'Votre message', chatPlaceholder: 'Écrivez un message…',
    chatSend: 'Envoyer', chatName: 'Votre nom', chatContact: 'E-mail ou téléphone', chatYou: 'Vous',
    chatSending: 'Envoi…', chatFailed: 'Non envoyé. Vérifiez la connexion et réessayez.', chatRetry: 'Réessayer',
    chatOffline: 'Nous ne sommes pas en ligne pour le moment. Laissez un message, nous vous répondrons.',
    chatLeft: 'Merci ! Votre message a été envoyé. Nous vous répondrons bientôt.',
    chatQueued: 'Pas de connexion — le message est enregistré et sera envoyé automatiquement.',
    chatDirect: 'Votre message est prêt dans l’application qui vient de s’ouvrir — envoyez-le depuis celle-ci.',
    chatNew: 'Nouveau message de {name}', chatNoJs: 'Le chat nécessite JavaScript. Contactez-nous autrement.',
    chatEdit: 'Les messages des visiteurs apparaissent ici.', chatBubbleNote: 'Sur la page, ce chat s’ouvre depuis un bouton flottant dans le coin.',
    'phc.operator': 'Nom ou rôle de l’opérateur', 'phc.welcome': 'Message d’accueil…', 'phc.offline': 'Note « hors ligne »',
  },
  es: {
    chatTitle: 'Escríbenos', chatMessages: 'Mensajes', chatOpen: 'Abrir el chat', chatClose: 'Cerrar el chat',
    chatUnread: { one: '{n} mensaje nuevo', other: '{n} mensajes nuevos' }, chatInput: 'Tu mensaje', chatPlaceholder: 'Escribe un mensaje…',
    chatSend: 'Enviar', chatName: 'Tu nombre', chatContact: 'Correo o teléfono', chatYou: 'Tú',
    chatSending: 'Enviando…', chatFailed: 'No enviado. Revisa la conexión e inténtalo de nuevo.', chatRetry: 'Reintentar',
    chatOffline: 'Ahora no estamos en línea. Deja un mensaje y te responderemos.',
    chatLeft: '¡Gracias! Tu mensaje se ha enviado. Te responderemos pronto.',
    chatQueued: 'Sin conexión: el mensaje se ha guardado y se enviará automáticamente.',
    chatDirect: 'Tu mensaje está listo en la aplicación que se ha abierto: envíalo desde allí.',
    chatNew: 'Nuevo mensaje de {name}', chatNoJs: 'El chat necesita JavaScript. Contáctanos de otra forma.',
    chatEdit: 'Aquí aparecen los mensajes de los visitantes.', chatBubbleNote: 'En la página, este chat se abre con un botón flotante en la esquina.',
    'phc.operator': 'Nombre o función del operador', 'phc.welcome': 'Mensaje de bienvenida…', 'phc.offline': 'Nota «sin conexión»',
  },
  ka: {
    chatTitle: 'მოგვწერეთ', chatMessages: 'შეტყობინებები', chatOpen: 'ჩატის გახსნა', chatClose: 'ჩატის დახურვა',
    chatUnread: { one: '{n} ახალი შეტყობინება', other: '{n} ახალი შეტყობინება' }, chatInput: 'თქვენი შეტყობინება', chatPlaceholder: 'დაწერეთ შეტყობინება…',
    chatSend: 'გაგზავნა', chatName: 'თქვენი სახელი', chatContact: 'ელფოსტა ან ტელეფონი', chatYou: 'თქვენ',
    chatSending: 'იგზავნება…', chatFailed: 'ვერ გაიგზავნა. შეამოწმეთ კავშირი და სცადეთ ხელახლა.', chatRetry: 'ხელახლა',
    chatOffline: 'ახლა ხაზზე არ ვართ. დაგვიტოვეთ შეტყობინება და გიპასუხებთ.',
    chatLeft: 'გმადლობთ! შეტყობინება გაიგზავნა. მალე გიპასუხებთ.',
    chatQueued: 'კავშირი არ არის — შეტყობინება შენახულია და ავტომატურად გაიგზავნება.',
    chatDirect: 'შეტყობინება მომზადებულია გახსნილ აპლიკაციაში — გაგზავნეთ იქიდან.',
    chatNew: 'ახალი შეტყობინება: {name}', chatNoJs: 'ჩატს სჭირდება JavaScript. დაგვიკავშირდით სხვა გზით.',
    chatEdit: 'აქ გამოჩნდება ვიზიტორების შეტყობინებები.', chatBubbleNote: 'გვერდზე ეს ჩატი იხსნება კუთხეში მცურავი ღილაკით.',
    'phc.operator': 'ოპერატორის სახელი ან როლი', 'phc.welcome': 'მისალმება…', 'phc.offline': 'ტექსტი „ხაზზე არ ვართ“',
  },
};

export {
  BLOCK_DEPS_CHAT,
  BT_CHAT,
  CH_EXT_URL,
  CSS_BLOCKS_CHAT,
  CSS_VARIANTS_CHAT,
  OWN_CHAT,
  UI_CHAT,
  chReqCfg,
  chTo,
  chatMode,
  renderChatPops
};
