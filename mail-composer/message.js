// mail-composer/message.js - the message logic of Mail Composer, pure (no DOM, Node-importable): address fields
// (lists separated by commas, semicolons or line breaks; invalid entries kept so they can be reported; exact and Gmail
// canonical duplicates across From / To / Cc / Bcc / Reply-To), mail-merge templates ({{column}} and
// {{column|fallback}}), the body (Markdown through markdown/gfm.js, rich HTML through html/sanitize.js, plain text) with
// cid: references of inline images kept through the sanitizers, the plain-text alternative, the message model for
// mail/mime.js buildMessage, mailto: eligibility, SMTP transcripts (server replies, client commands, the DATA section,
// AUTH payloads masked) and the checks of a received message.
//
// Pure functions only: the same code runs in the page and in Node tests. MIME assembly itself is mail/mime.js; this
// module decides WHAT goes into the message (validated addresses, sanitised HTML, a plain-text alternative, safe
// custom headers) and reports every problem as a finding instead of throwing, so the UI can show all of them at once.
import { canonEmail, displayDomain, mailtoLink, parseAddressList } from '../mail/address.js';
import { decodeBytes, headerSafe } from '../mail/encoding.js';
import { buildMessage, contentTypeOf, messageId } from '../mail/mime.js';
import { enhancedStatus, parseSmtpReplies, replyClass, smtpCapabilities } from '../mail/smtp.js';
import { b64decode } from '../codec/base64.js';
import { renderGFM } from '../markdown/gfm.js';
import { escapeMarkdown } from '../markdown/write.js';
import { sanitizeDoc } from '../html/sanitize.js';

export const FIELDS = ['from', 'to', 'cc', 'bcc', 'replyTo'];
// Headers the composer builds itself; user-defined headers with these names are refused (they would duplicate or
// contradict the generated ones, and Bcc / Content-* tampering can break delivery or leak recipients).
export const RESERVED_HEADER = /^(from|to|cc|bcc|subject|date|message-id|mime-version|content-.*|sender|reply-to)$/i;

// --- address fields ------------------------------------------------------------------------------------------------

// Top-level pieces of an address list split at commas (quotes, comments and angle brackets respected). Line breaks
// and semicolons separate entries too (lists pasted from spreadsheets and Outlook), unless the text uses RFC 5322
// groups ('Team: a@x, b@x;').
export function splitAddressText(text) {
  let s = String(text == null ? '' : text);
  // Group syntax is detected by a colon before any quote / angle / comment ("Team: a@x, b@x;"); in that case the text
  // is handed to the RFC 5322 parser unsplit, since ';' then ends the group rather than separating entries.
  // Caveat: an IPv6 literal (user@[IPv6:...]) also contains ':' and switches to group mode.
  const groups = /^[^"<(]*:/.test(s.replace(/mailto:/gi, ''));
  s = s.replace(/\r?\n/g, ',');
  if (!groups) s = s.replace(/;/g, ',');
  if (groups) return [s];
  const out = [];
  // A small state machine instead of split(','): commas inside "quoted names", <angle addresses> or (comments) must not
  // split an entry. Backslash escapes inside quotes are copied verbatim.
  let cur = '', q = false, angle = 0, paren = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && q) { cur += c + (s[++i] || ''); continue; }
    if (c === '"') q = !q;
    else if (!q && c === '<') angle++;
    else if (!q && c === '>') angle = Math.max(0, angle - 1);
    else if (!q && c === '(') paren++;
    else if (!q && c === ')') paren = Math.max(0, paren - 1);
    if (c === ',' && !q && !angle && !paren) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// Entries of one field: [{ name, address, raw }] - pieces without any address are kept with address = the piece.
export function parseField(text) {
  const out = [];
  for (const piece of splitAddressText(text)) {
    const list = parseAddressList(piece);
    if (list.length) for (const a of list) out.push({ name: a.name, address: a.address, raw: piece, group: a.group || '' });
    // Unparsable pieces are kept as entries (address = the raw text), so the user sees exactly which piece is wrong.
    else out.push({ name: '', address: piece.replace(/^mailto:/i, ''), raw: piece, group: '' });
  }
  return out;
}

/**
 * Analysis of the address fields { from, to, cc, bcc, replyTo } (strings):
 *   entries: { field: [{ name, address, status: 'ok' | 'invalid' | 'dup' | 'canon', canonical, domain, unicodeDomain,
 *              plusTag, isGmail, dupOf }] }
 *   issues: [{ key, vars }]   (fromCount, noRcpt, invalid, dup, canon)
 *   valid: { field: [{ name, address }] } - entries usable in headers (duplicates of the recipient fields dropped)
 */
export function analyzeAddresses(fields) {
  const entries = {}, valid = {}, issues = [];
  const seenAddr = new Map(), seenCanon = new Map();
  for (const f of FIELDS) {
    entries[f] = [];
    valid[f] = [];
    for (const e of parseField(fields[f] || '')) {
      // canonEmail (mail/address.js) lowercases the domain, IDNA-encodes it and for Gmail strips dots and +tags, giving
      // a canonical form under which "J.Doe+news@gmail.com" and "jdoe@gmail.com" are the same mailbox.
      const info = canonEmail(e.address);
      const x = { field: f, name: e.name, address: e.address, status: 'ok', canonical: info.canonical, domain: info.domain, unicodeDomain: info.ok ? displayDomain(info.domain) : '', plusTag: info.plusTag, isGmail: info.isGmail, dupOf: '' };
      // Reply-To and From may repeat a recipient on purpose; duplicates count among the recipient fields only.
      const rcpt = f === 'to' || f === 'cc' || f === 'bcc';
      if (!info.ok) x.status = 'invalid';
      else if (rcpt && seenAddr.has(info.address)) { x.status = 'dup'; x.dupOf = seenAddr.get(info.address); }
      else if (rcpt && seenCanon.has(info.canonical)) { x.status = 'canon'; x.dupOf = seenCanon.get(info.canonical); }
      // The first occurrence wins; later exact duplicates are "dup", later canonical twins "canon" (both dropped from
      // the valid lists, so nobody gets the message twice).
      if (info.ok && rcpt && x.status === 'ok') { seenAddr.set(info.address, f); seenCanon.set(info.canonical, info.address); }
      entries[f].push(x);
      if (x.status === 'ok') valid[f].push({ name: e.name, address: info.address });
    }
  }
  const all = FIELDS.flatMap((f) => entries[f]);
  if (entries.from.filter((x) => x.status === 'ok').length !== 1) issues.push({ key: 'fromCount', level: 'error', vars: { n: entries.from.length } });
  if (!valid.to.length && !valid.cc.length && !valid.bcc.length) issues.push({ key: 'noRcpt', level: 'error' });
  const bad = all.filter((x) => x.status === 'invalid');
  if (bad.length) issues.push({ key: 'invalid', level: 'error', vars: { n: bad.length, list: bad.map((x) => x.address).join(', ') } });
  const dup = all.filter((x) => x.status === 'dup');
  if (dup.length) issues.push({ key: 'dup', level: 'warn', vars: { n: dup.length, list: dup.map((x) => x.address).join(', ') } });
  const canon = all.filter((x) => x.status === 'canon');
  if (canon.length) issues.push({ key: 'canon', level: 'warn', vars: { n: canon.length, list: canon.map((x) => `${x.address} = ${x.dupOf}`).join(', ') } });
  return { entries, valid, issues };
}

// --- templates -----------------------------------------------------------------------------------------------------

// {{ name }} or {{ name | fallback }}: lazy name match so spaces around the pipe are trimmed; no nested braces.
const PH = /\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g;
export const placeholdersOf = (s) => [...String(s || '').matchAll(PH)].map((m) => m[1]);

// '{{name|friend}}' -> the row value (by column name, case-insensitive), the fallback when empty; unknown names are
// left as they are and reported in `missing`. `escape` transforms inserted values (HTML / Markdown bodies).
export function fillTemplate(str, row, missing, escape = (v) => v) {
  if (!row) return String(str || '');
  const keys = new Map(Object.keys(row).map((k) => [k.trim().toLowerCase(), k]));
  // Column names are matched case-insensitively and trimmed: spreadsheet headers are rarely typed consistently.
  return String(str || '').replace(PH, (m, name, fb) => {
    const k = keys.get(name.trim().toLowerCase());
    if (k == null) { if (missing) missing.add(name.trim()); return m; }
    const v = String(row[k] ?? '').trim();
    // Values are escaped for the body format (HTML entities / Markdown escapes) so merge data cannot inject markup.
    return escape(v || (fb ?? ''));
  });
}

const escHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Rows of a CSV table (first row = column names) -> [{ column: value }].
export function rowsOf(table) {
  if (!Array.isArray(table) || table.length < 2) return { columns: [], rows: [] };
  const columns = table[0].map((c, i) => String(c || '').trim() || 'col' + (i + 1));
  const rows = table.slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => Object.fromEntries(columns.map((c, i) => [c, String(r[i] ?? '')])));
  return { columns, rows };
}
// The column whose values are mostly e-mail addresses, and a name-like column.
// The e-mail column = the column with the most valid addresses in the first 50 rows; the name column by header text
// in the seven UI languages.
export function guessColumns(columns, rows) {
  const sample = rows.slice(0, 50);
  let email = '', best = 0;
  for (const c of columns) {
    const n = sample.filter((r) => canonEmail(r[c]).ok).length;
    if (n > best) { best = n; email = c; }
  }
  const name = columns.find((c) => /^(name|full.?name|first.?name|имя|ім'?я|სახელი|nombre|nom|vorname|prénom)$/i.test(c.trim())) || '';
  return { email, name };
}

// --- body ----------------------------------------------------------------------------------------------------------

// cid: references survive the sanitizers as a relative placeholder path (sanitizeDoc keeps http(s) and relative URLs
// only), and come back afterwards.
// restoreCid matches the placeholder after a double quote: it relies on the sanitizer / renderer writing attributes
// with double quotes, which both do.
const CID_TMP = 'mc-cid/';
export const prepCid = (s) => String(s || '').replace(/(\bsrc\s*=\s*["']?)cid:/gi, '$1' + CID_TMP).replace(/\]\(\s*<?cid:/gi, '](' + CID_TMP);
export const restoreCid = (s) => String(s || '').split('"' + CID_TMP).join('"cid:');
// cid values referenced by an HTML text.
export const cidsOf = (html) => [...String(html || '').matchAll(/\bsrc\s*=\s*["']?cid:([^"'\s>]+)/gi)].map((m) => decodeURIComponentSafe(m[1]));
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

export const sanitizeBody = (html) => restoreCid(sanitizeDoc(prepCid(html), { idPrefix: '' }));
export const markdownHTML = (md) => restoreCid(renderGFM(prepCid(md), { idPrefix: '', dataImages: false, alerts: false }).html);

// Inline CSS for mail: clients strip <link> and often <head> styles, so a compact stylesheet with web-safe font
// stacks (Georgian included) and light colours is embedded; body background is white as most clients assume.
const EMAIL_CSS = 'body{margin:0;padding:16px;font:15px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,"Noto Sans Georgian",sans-serif;color:#1f2937;background:#fff}'
  + 'img{max-width:100%;height:auto}a{color:#2563eb}h1,h2,h3{line-height:1.25;margin:1.1em 0 .5em}p{margin:0 0 .9em}'
  + 'blockquote{margin:0 0 .9em;padding:0 0 0 12px;border-left:3px solid #d1d5db;color:#4b5563}'
  + 'table{border-collapse:collapse;margin:0 0 .9em}th,td{border:1px solid #d1d5db;padding:5px 9px;text-align:left}'
  + 'code,pre{font-family:Consolas,"Courier New",monospace;font-size:13px;background:#f3f4f6;border-radius:4px}code{padding:1px 4px}pre{padding:10px;overflow:auto}hr{border:0;border-top:1px solid #e5e7eb;margin:1.2em 0}';
// A complete HTML document for the text/html part.
export const emailDocument = (body, lang = 'en') => `<!DOCTYPE html>\n<html lang="${escHTML(lang)}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<style>${EMAIL_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

// A small entity table for the plain-text conversion; numeric entities are decoded generically (valid code points).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', euro: '€', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export const decodeEntities = (s) => String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

// Plain-text alternative of an HTML body: paragraphs and line breaks, list markers and numbers, quotes as '> ',
// links as 'text (url)', images as [alt], table cells separated by ' | '.
// Tokenizer approach: a regex walks tags and text runs; a few state counters (quote depth, pre, list stack, table
// cell) are enough for a readable text/plain part. A full HTML parser is unnecessary because the input is our own
// sanitised HTML. Whitespace is collapsed except inside <pre>.
export function htmlToText(html) {
  const src = String(html || '').replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  let out = '', atStart = true, quote = 0, pre = 0, cell = 0;
  const lists = [], links = [];
  // nl(n): ensure the output ends with at least n line breaks (paragraph = 2, line = 1), never more.
  const nl = (n) => {
    if (!out) return;
    const have = /\n*$/.exec(out)[0].length;
    for (let i = have; i < n; i++) out += '\n';
    atStart = true;
  };
  const write = (s) => {
    if (!s) return;
    if (atStart) { out += '> '.repeat(quote); atStart = false; }
    out += s;
  };
  const attr = (a, name) => { const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(a); return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : ''; };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[4] != null) {
      let s = decodeEntities(m[4]);
      if (pre) { s.split('\n').forEach((line, i) => { if (i) { out += '\n'; atStart = true; } write(line); }); continue; }
      s = s.replace(/\s+/g, ' ');
      if (atStart) s = s.replace(/^ /, '');
      write(s);
      continue;
    }
    const close = !!m[1], tag = m[2].toLowerCase(), a = m[3];
    switch (tag) {
      case 'br': out += '\n'; atStart = true; break;
      case 'p': case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': case 'table': nl(lists.length ? 1 : 2); break;
      case 'div': case 'section': case 'article': case 'header': case 'footer': case 'tr': nl(1); cell = 0; break;
      case 'ul': case 'ol':
        if (close) { lists.pop(); nl(lists.length ? 1 : 2); } else { nl(lists.length ? 1 : 2); lists.push({ ol: tag === 'ol', n: +attr(a, 'start') || 1 }); }
        break;
      case 'li':
        if (!close) { nl(1); const l = lists[lists.length - 1]; write('  '.repeat(Math.max(0, lists.length - 1)) + (l && l.ol ? `${l.n++}. ` : '• ')); }
        break;
      case 'blockquote': nl(2); quote = Math.max(0, quote + (close ? -1 : 1)); break;
      case 'pre': nl(2); pre = Math.max(0, pre + (close ? -1 : 1)); break;
      case 'hr': nl(1); write('———'); nl(2); break;
      case 'td': case 'th': if (!close) { if (cell++) write(' | '); } break;
      case 'img': { const alt = attr(a, 'alt'); if (alt) write(`[${alt}]`); break; }
      case 'a':
        // Links remember the output position; on </a> the URL is appended only if the visible text is not the URL itself.
        if (!close) links.push({ href: attr(a, 'href'), at: out.length });
        else {
          const l = links.pop();
          if (l && l.href && !/^#/.test(l.href)) {
            const txt = out.slice(l.at).trim(), href = l.href.replace(/^mailto:/i, '');
            if (txt !== href && txt !== l.href) write(` (${href})`);
          }
        }
        break;
      default: break;
    }
  }
  return out.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Plain text of a Markdown body: the source itself reads well; images become [alt], links 'text (url)'.
export function markdownText(md) {
  return String(md || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => (alt ? `[${alt}]` : ''))
    // Negative lookbehind (?<!!) keeps image syntax ![...](...) out of the link rule (handled by the line above).
    .replace(/(?<!!)\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m, txt, url) => (txt === url || 'mailto:' + txt === url ? txt : `${txt} (${url.replace(/^mailto:/i, '')})`))
    .replace(/\r\n?/g, '\n').trim() + '\n';
}

// --- the message ---------------------------------------------------------------------------------------------------

/**
 * The message of the composer state (one merge row or none):
 *   S      state { from, to, cc, bcc, replyTo, subject, mode: 'markdown' | 'rich' | 'plain', md, rich, plain, ownText,
 *          text, headers: [{ name, value }], draft, priority, date, msgId, encoding, keepBcc, merge }
 *   files  [{ name, type, data: Uint8Array, inline, cid }]
 *   env    { now (ms), offset (minutes east of UTC), random(n) -> Uint8Array, boundary, row, lang }
 * -> { model, eml, html, text, addr, warnings: [{ key, level, vars }], missing: [names], inline, attachments }
 */
export function composeMessage(S, files, env = {}) {
  const row = env.row || null;
  const missing = new Set();
  const fill = (s, esc) => fillTemplate(s, row, missing, esc);
  const fields = {};
  for (const f of FIELDS) fields[f] = fill(S[f] || '');
  // Mail merge: the To field is replaced by the row's address (and name); quotes and backslashes are stripped from the
  // name, the simplest way to keep the quoted-string syntax valid.
  if (row && S.merge && S.merge.emailCol) {
    const email = String(row[S.merge.emailCol] ?? '').trim();
    const name = S.merge.nameCol ? String(row[S.merge.nameCol] ?? '').trim() : '';
    fields.to = email ? (name ? `"${name.replace(/["\\]/g, '')}" <${email}>` : email) : '';
  }
  const addr = analyzeAddresses(fields);
  const warnings = [...addr.issues];
  const subject = fill(S.subject || '');

  let html = '', text = '';
  if (S.mode === 'markdown') {
    // Markdown: values escaped for the HTML rendering; the text part uses the unescaped fill (it is read as text).
    const md = fill(S.md || '', escapeMarkdown);
    html = markdownHTML(md);
    text = markdownText(fill(S.md || ''));
  } else if (S.mode === 'rich') {
    html = sanitizeBody(fill(S.rich || '', escHTML));
    text = htmlToText(html);
  } else text = fill(S.plain || '').replace(/\r\n?/g, '\n');
  if (S.ownText && S.mode !== 'plain') text = fill(S.text || '');

  // Inline images: only the referenced ones go into multipart/related; the others become attachments.
  // An inline file that the HTML no longer references is demoted to an attachment (and reported), never silently lost.
  const refs = new Set(cidsOf(html));
  const inline = [], attachments = [];
  for (const f of files) {
    const isImg = /^image\//.test(f.type || contentTypeOf(f.name));
    if (html && f.inline && isImg && refs.has(f.cid)) inline.push(f);
    else attachments.push(f);
    if (f.inline && isImg && !refs.has(f.cid) && html) warnings.push({ key: 'unusedInline', level: 'info', vars: { name: f.name } });
  }
  for (const c of refs) if (!files.some((f) => f.cid === c)) warnings.push({ key: 'missingCid', level: 'warn', vars: { cid: c } });

  const headers = {};
  for (const h of S.headers || []) {
    const name = String(h.name || '').trim();
    if (!name) continue;
    // Header names restricted to letters, digits and '-' (RFC 5322 field-name subset); values pass headerSafe(), which
    // turns CR / LF / tabs into spaces (header injection) and drops other control characters; non-ASCII is left to
    // mail/mime.js, which encodes header values when it builds the message.
    const clean = name.replace(/[^A-Za-z0-9-]/g, '');
    if (clean !== name) warnings.push({ key: 'headerName', level: 'warn', vars: { name } });
    if (!clean) continue;
    if (RESERVED_HEADER.test(clean)) { warnings.push({ key: 'headerReserved', level: 'warn', vars: { name: clean } }); continue; }
    const v = fill(h.value || '');
    if (/[\r\n]/.test(v)) warnings.push({ key: 'headerBreak', level: 'warn', vars: { name: clean } });
    headers[clean] = headerSafe(v);
  }
  if (S.draft) headers['X-Unsent'] = '1';
  if (!subject.trim()) warnings.push({ key: 'noSubject', level: 'info' });
  if (/[\r\n]/.test(subject)) warnings.push({ key: 'subjectBreak', level: 'warn' });
  if (!text.trim() && !html.trim()) warnings.push({ key: 'noBody', level: 'info' });
  if (missing.size) warnings.push({ key: 'missing', level: 'warn', vars: { list: [...missing].map((x) => `{{${x}}}`).join(', ') } });

  const fromInfo = addr.valid.from[0];
  // The Message-ID domain is taken from the sender; "localhost" when there is no valid From.
  const domain = fromInfo ? fromInfo.address.split('@')[1] : 'localhost';
  const model = {
    from: addr.valid.from.slice(0, 1), to: addr.valid.to, cc: addr.valid.cc, bcc: addr.valid.bcc, replyTo: addr.valid.replyTo,
    subject, text, html: html ? emailDocument(html, env.lang) : '', attachments: [...inline, ...attachments].map((f) => ({ filename: f.name, data: f.data, contentType: f.type || contentTypeOf(f.name), inline: inline.includes(f), cid: inline.includes(f) ? f.cid : undefined })),
    headers, priority: S.priority === 'normal' ? '' : S.priority, encoding: S.encoding || 'base64', keepBcc: !!S.keepBcc,
    boundary: env.boundary,
  };
  if (S.date) { model.date = env.now ?? Date.now(); model.dateOffset = env.offset || 0; }
  if (S.msgId && env.random) model.messageId = messageId(domain, env.random(12));
  const eml = buildMessage(model);
  const size = eml.length;
  // 20 MB: below the common provider limits (25 MB for Gmail) once base64 overhead and headers are added.
  if (size > 20 * 1024 * 1024) warnings.push({ key: 'big', level: 'warn', vars: { mb: (size / 1048576).toFixed(1) } });
  return { model, eml, html: model.html, body: html, text, subject, addr, fields, warnings, missing: [...missing], inline, attachments };
}

// Can the message be handed to the mail application as a mailto: link? -> { ok, href, reasons: [keys], notes: [keys] }
export function mailtoFor(S, built, files) {
  const reasons = [], notes = [];
  // mailto: cannot carry files, a From, HTML or custom headers; those are reasons or notes. URLs above about 2000
  // characters are cut by some browsers and mail apps, hence the 1900 limit.
  if (files.length) reasons.push('files');
  if (built.addr.issues.some((i) => i.level === 'error' && i.key !== 'fromCount')) reasons.push('addresses');
  const href = mailtoLink({ to: built.addr.valid.to, cc: built.addr.valid.cc, bcc: built.addr.valid.bcc, subject: built.subject, body: built.text.trimEnd() });
  if (href.length > 1900) reasons.push('long');
  if (S.mode !== 'plain' && built.body) notes.push('format');
  if ((S.headers || []).some((h) => h.name && h.name.trim()) || S.draft || S.priority !== 'normal') notes.push('headers');
  if (built.addr.valid.from.length) notes.push('from');
  return { ok: !reasons.length, href, reasons, notes };
}

// --- SMTP transcripts ----------------------------------------------------------------------------------------------

/**
 * A pasted SMTP dialogue -> [{ kind: 'c', text, secret?, auth? } | { kind: 's', reply, caps? } | { kind: 'data', lines, stuffed }
 * | { kind: 'bad', text }]. Lines may carry 'S:' / 'C:' / '<<<' / '>>>' / '<-' / '->' prefixes; without them, lines
 * starting with three digits are server replies.
 */
export function parseTranscript(text) {
  const items = [];
  let sbuf = [], lastCmd = '', inData = false, data = null, authStep = '';
  // Parsing state: buffered server lines (multi-line replies end with "code SP"), the last client command (to read
  // EHLO capabilities), the DATA section (after 354 until a lone "."), and the AUTH exchange step (for masking).
  const flush = () => {
    if (!sbuf.length) return;
    const { replies, rest } = parseSmtpReplies(sbuf.join('\r\n') + '\r\n');
    for (const r of replies) {
      const it = { kind: 's', reply: r };
      if (/^EHLO\b/i.test(lastCmd) && r.code === 250) it.caps = smtpCapabilities(r.lines);
      items.push(it);
      if (r.code === 354) inData = true;
      // Any reply other than 334 (AUTH continuation) ends an AUTH exchange.
      if (r.code !== 334) authStep = '';
    }
    if (rest.trim()) items.push({ kind: 'bad', text: rest.trim() });
    sbuf = [];
  };
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw, side = '';
    const p = /^\s*(?:([SC])\s*:\s?|(<<<|>>>|<-|->)\s?)/i.exec(line);
    if (p) { side = p[1] ? (p[1].toUpperCase() === 'S' ? 's' : 'c') : (p[2] === '<<<' || p[2] === '<-' ? 's' : 'c'); line = line.slice(p[0].length); }
    if (side === 'c' || (!side && !/^\d{3}(?:[ -]|$)/.test(line))) flush();
    if (inData && side !== 's') {
      if (!data) { data = { kind: 'data', lines: [], stuffed: 0 }; items.push(data); }
      if (line === '.') { inData = false; data.end = true; data = null; continue; }
      // RFC 5321 dot-stuffing: a data line starting with "." is sent with an extra "."; counted to show it in the tool.
      if (line.startsWith('..')) data.stuffed++;
      data.lines.push(line);
      continue;
    }
    if (!side) side = /^\d{3}(?:[ -]|$)/.test(line) ? 's' : line.trim() ? 'c' : '';
    if (!side) continue;
    // A bare "250" line gets a trailing space so the reply parser sees a complete final line.
    if (side === 's') { sbuf.push(/^\d{3}$/.test(line) ? line + ' ' : line); continue; }
    flush();
    const it = { kind: 'c', text: line };
    // Credentials are masked in the displayed transcript; only the user name is extracted (base64-decoded) so the tool can
    // show who authenticated without ever displaying the password.
    const auth = /^AUTH\s+(PLAIN|LOGIN|XOAUTH2|CRAM-MD5)(?:\s+(\S+))?/i.exec(line);
    if (auth) {
      it.auth = auth[1].toUpperCase();
      if (auth[2]) { it.secret = true; it.text = `AUTH ${it.auth} ••••`; it.user = authUser(it.auth, auth[2]); }
      else authStep = it.auth;
    } else if (authStep) { it.secret = true; it.text = '••••'; if (authStep === 'LOGIN' && !items.some((x) => x.loginUser)) { it.loginUser = true; it.user = b64text(line); } else if (authStep === 'PLAIN') it.user = authUser('PLAIN', line); }
    items.push(it);
    lastCmd = line;
  }
  flush();
  return items;
}
function b64text(s) { try { return decodeBytes(b64decode(String(s).trim())); } catch { return ''; } }
function authUser(mech, payload) {
  const s = b64text(payload);
  // AUTH PLAIN payload = authzid NUL authcid NUL password: the second field is the user.
  if (mech === 'PLAIN') return s.split('\0')[1] || '';
  if (mech === 'XOAUTH2') return (/user=([^\u0001]*)/.exec(s) || [])[1] || '';
  return '';
}

// Reply code -> { cls, enhanced: { class, subject, detail, meaning } | null }.
export const replyInfo = (r) => ({ cls: replyClass(r.code), enhanced: r.enhanced ? enhancedStatus(r.enhanced) : null });

// --- checks of a received message ----------------------------------------------------------------------------------

/** Findings about a parsed message and its source text: [{ key, level: 'error' | 'warn' | 'info', vars }]. */
export function messageChecks(msg, raw) {
  const out = [];
  const add = (key, level, vars) => out.push({ key, level, vars });
  // Checks look at the raw header block too: some problems (raw 8-bit headers, long lines, bare LF) are invisible after
  // parsing.
  const head = String(raw).split(/\r?\n\r?\n/)[0] || '';
  const has = (n) => msg.tree.headers.some((x) => x.name.toLowerCase() === n);
  if (!msg.from.length) add('noFrom', 'warn');
  if (!has('date')) add('noDate', 'info');
  if (!has('message-id')) add('noMsgId', 'info');
  // MIME-Version is needed as soon as there are parts or non-ASCII content.
  if (!has('mime-version') && (msg.tree.parts || /[^\x00-\x7f]/.test(msg.text + msg.html))) add('noMime', 'warn');
  if (has('bcc')) add('bccVisible', 'warn');
  if (/^1$/.test(msg.header('x-unsent').trim())) add('unsent', 'info');
  const fromDom = (msg.from[0]?.address || '').split('@')[1] || '';
  const rtDom = (msg.replyTo[0]?.address || '').split('@')[1] || '';
  // Reply-To on another domain than From is a common phishing pattern; flagged, not judged.
  if (fromDom && rtDom && fromDom.toLowerCase() !== rtDom.toLowerCase()) add('replyDomain', 'warn', { from: fromDom, reply: rtDom });
  if (/[^\x00-\x7f]/.test(head)) add('rawHeaders', 'warn');
  // RFC 5322 limit: lines must not exceed 998 characters (excluding CRLF).
  if (String(raw).split(/\r?\n/).some((l) => l.length > 998)) add('longLines', 'warn');
  if (/[^\r]\n/.test(String(raw).slice(0, 65536))) add('bareLf', 'info');
  // An encoded-word left in the decoded subject means it was malformed (the decoder could not decode it).
  if (/=\?[^?\s]+\?[BbQq]\?/.test(msg.subject)) add('badWord', 'warn');
  if (msg.html && !msg.text) add('noText', 'info');
  if (!msg.subject.trim()) add('noSubject', 'info');
  if (msg.html && /\bsrc\s*=\s*["']?\s*(https?:)?\/\//i.test(msg.html)) add('remote', 'info');
  const bad = [...msg.from, ...msg.to, ...msg.cc, ...msg.replyTo].filter((a) => !canonEmail(a.address).ok);
  if (bad.length) add('badAddr', 'warn', { list: bad.map((a) => a.address).join(', ') });
  return out;
}

// A composer draft from a parsed message ("edit as new"): state fields and files.
export function draftFromMessage(msg) {
  // Display names with specials are re-quoted; quotes and backslashes inside are dropped (see the merge note above).
  const list = (l) => l.map((a) => (a.name ? `${/[",;:<>@()]/.test(a.name) ? '"' + a.name.replace(/["\\]/g, '') + '"' : a.name} <${a.address}>` : a.address)).join(', ');
  const files = msg.attachments.map((a, i) => ({ name: a.filename || `part-${i + 1}${a.contentType === 'message/rfc822' ? '.eml' : ''}`, type: a.contentType || 'application/octet-stream', data: a.data, inline: !!(a.inline && a.cid), cid: a.cid || '' }));
  const state = { from: list(msg.from), to: list(msg.to), cc: list(msg.cc), bcc: '', replyTo: list(msg.replyTo), subject: msg.subject };
  if (msg.html) {
    // Only the <body> content goes into the rich editor (the editor is not a document), sanitised like any pasted HTML.
    const bodyMatch = /<body\b[^>]*>([\s\S]*?)(<\/body>|$)/i.exec(msg.html);
    Object.assign(state, { mode: 'rich', rich: sanitizeBody(bodyMatch ? bodyMatch[1] : msg.html), ownText: false });
  } else Object.assign(state, { mode: 'plain', plain: msg.text || '' });
  return { state, files };
}
