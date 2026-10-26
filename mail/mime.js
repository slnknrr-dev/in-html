// mail/mime.js - RFC 5322 / MIME messages (.eml): building (headers folded at 78, every value through encoded words
// or address formatting so no field can inject a header; text/plain, multipart/alternative with HTML,
// multipart/related for inline images by Content-ID, multipart/mixed with attachments named by RFC 2231 and
// encoded words; base64 or quoted-printable bodies; deterministic boundaries and dates when given) and reading
// (unfolding, encoded words, parameters with RFC 2231 continuations, nested multiparts, transfer encodings,
// charsets) into { headers, subject, from, to, text, html, attachments }.
//
// Structure produced by buildMessage (each layer only when needed):
//   multipart/mixed [ multipart/alternative [ text/plain, multipart/related [ text/html, inline images ] ], files ]
// That nesting is what every mail client renders correctly: alternative picks the best body, related binds cid:
// images to the HTML, mixed carries attachments. Determinism (given boundary and date) makes the output testable.
import { addressesOf, formatAddressList, parseAddressList } from './address.js';
import { base64Body, bytesLatin1, decodeBody, decodeBytes, decodeWords, encodeHeaderText, headerSafe, is7bit, qpBody, rfc2231, toBytes, utf8 } from './encoding.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');

// RFC 5322 date of an instant shown at a UTC offset in minutes ('Sat, 24 Oct 2026 14:00:00 +0400').
// Shift the instant by the offset and read UTC fields: prints wall-clock time at that offset without depending on
// the host's time zone (Date's local getters would).
export function mailDate(date, offsetMinutes = 0) {
  const ms = date instanceof Date ? date.getTime() : +date;
  const d = new Date(ms + offsetMinutes * 60000);
  const abs = Math.abs(offsetMinutes);
  return `${DAYS[d.getUTCDay()]}, ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${offsetMinutes < 0 ? '-' : '+'}${p2(Math.floor(abs / 60))}${p2(abs % 60)}`;
}
// RFC 5322 date text -> epoch ms (NaN when unreadable); obsolete zone names are understood.
// Tolerant regex (day name optional, 2-digit years, obsolete zone names); RFC 5322 4.3 maps unknown military zones
// to +0000, which the `|| 0` reproduces. Two-digit years pivot at 50, as 4.3 prescribes.
export function parseMailDate(text) {
  const r = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,5})?/.exec(String(text || ''));
  if (!r) return NaN;
  const mo = MONTHS.indexOf(r[2][0].toUpperCase() + r[2].slice(1).toLowerCase());
  if (mo < 0) return NaN;
  let y = +r[3]; if (y < 100) y += y < 50 ? 2000 : 1900;
  const zones = { UT: 0, GMT: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
  const z = r[7] || '+0000';
  const off = /^[+-]\d{4}$/.test(z) ? (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3)) : zones[z.toUpperCase()] || 0;
  return Date.UTC(y, mo, +r[1], +r[4], +r[5], +(r[6] || 0)) - off * 60000;
}

// 'Name: value' folded at whitespace to lines of at most `max` characters (continuations start with a space).
// Folding inserts CRLF before existing whitespace only, so unfolding restores the value. Runs of spaces collapse to
// one (split(' ') + filter): harmless for structured headers and encoded words, lossy for deliberate spacing.
// A single word longer than max stays on its own line (legal up to 998 characters).
export function foldHeader(name, value, max = 78) {
  const words = String(value == null ? '' : value).split(' ').filter((w) => w !== '');
  if (!words.length) return name + ':';
  const out = [];
  let line = name + ': ' + words[0];
  for (let i = 1; i < words.length; i++) {
    if (line.length + 1 + words[i].length > max) { out.push(line); line = ' ' + words[i]; } else line += ' ' + words[i];
  }
  out.push(line);
  return out.join('\r\n');
}

// '<random@domain>' from caller-supplied random bytes (crypto.getRandomValues) or a string id.
export function messageId(domain, random) {
  const id = typeof random === 'string' ? random : Array.from(random || [], (b) => b.toString(36).padStart(2, '0')).join('');
  return '<' + (id || 'm').replace(/[^A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]/g, '') + '@' + String(domain || 'localhost').replace(/[^A-Za-z0-9.-]/g, '') + '>';
}

const TYPES = { txt: 'text/plain', html: 'text/html', htm: 'text/html', csv: 'text/csv', ics: 'text/calendar', vcf: 'text/vcard', json: 'application/json', xml: 'application/xml',
  pdf: 'application/pdf', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', eml: 'message/rfc822' };
export const contentTypeOf = (filename) => TYPES[String(filename || '').toLowerCase().split('.').pop()] || 'application/octet-stream';

// A parameter: plain token, quoted string, or for non-ASCII values both RFC 2231 (name*=) and an encoded word.
// RFC 2045 token if possible, quoted string if printable ASCII, else RFC 2231 extended syntax (name*=UTF-8''...),
// which modern clients read; encoded words inside parameters are a non-standard fallback some old clients need.
function param(key, value) {
  const v = headerSafe(value);
  if (/^[\x20-\x7E]*$/.test(v)) return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(v) ? `${key}=${v}` : `${key}="${v.replace(/(["\\])/g, '\\$1')}"`;
  return `${key}*=${rfc2231(v)}`;
}

// One leaf part: headers + encoded body.
// Non-text parts are always base64. Text: 'auto' picks 7bit when legal, else quoted-printable (readable for mostly
// ASCII text); base64 is the safe default for any text because it survives every relay unchanged.
function leaf(type, body, { encoding = 'base64', charset = 'utf-8', disposition = '', filename = '', cid = '' } = {}) {
  const isText = /^text\//.test(type);
  const textBody = isText && typeof body === 'string' ? body.replace(/\r?\n/g, '\r\n') : body;
  let cte = encoding;
  if (isText && encoding === 'auto') cte = is7bit(String(textBody)) ? '7bit' : 'quoted-printable';
  else if (!isText) cte = 'base64';
  const h = [`Content-Type: ${type}${isText ? '; charset=' + charset : ''}${filename ? '; ' + param('name', filename) : ''}`, `Content-Transfer-Encoding: ${cte}`];
  if (disposition) h.push(`Content-Disposition: ${disposition}${filename ? '; ' + param('filename', filename) : ''}`);
  if (cid) h.push(`Content-ID: <${String(cid).replace(/[<>\s]/g, '')}>`);
  const data = cte === 'base64' ? base64Body(textBody) : cte === 'quoted-printable' ? qpBody(textBody) : String(textBody);
  return h.map((l) => foldHeader(l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2))).join('\r\n') + '\r\n\r\n' + data;
}
const multipart = (sub, boundary, parts) => ({ head: `Content-Type: multipart/${sub}; boundary="${boundary}"`, body: parts.map((p) => `--${boundary}\r\n${p}\r\n`).join('') + `--${boundary}--` });

// Message model: { from, to, cc, bcc (envelope only unless keepBcc), replyTo, sender, subject, text, html,
// attachments: [{ filename, data (bytes or text), contentType?, inline? + cid? }], messageId ('<id@host>' or 'id@host'),
// date (Date / ms; omitted when absent), dateOffset (minutes), inReplyTo, references, headers ({ name: value }),
// priority ('high' | 'low'), auto (Auto-Submitted: auto-generated), encoding ('base64' | 'quoted-printable' |
// 'auto' for the text parts), boundary (base string; parts get '-a', '-r', '-m' suffixes), preamble }
// -> the message as CRLF text (an .eml file).
export function buildMessage(m) {
  const h = [];
  const add = (k, v) => { if (v) h.push(foldHeader(k, v)); };
  add('From', formatAddressList(m.from));
  if (m.sender) add('Sender', formatAddressList(m.sender));
  add('To', formatAddressList(m.to || []));
  add('Cc', formatAddressList(m.cc || []));
  if (m.keepBcc) add('Bcc', formatAddressList(m.bcc || []));
  add('Reply-To', formatAddressList(m.replyTo || []));
  add('Subject', encodeHeaderText(m.subject));
  if (m.date != null) add('Date', mailDate(m.date, m.dateOffset || 0));
  const id = (v) => (v ? '<' + String(v).replace(/[<>\s]/g, '') + '>' : '');
  add('Message-ID', id(m.messageId));
  add('In-Reply-To', id(m.inReplyTo));
  add('References', [].concat(m.references || []).map(id).join(' '));
  if (m.priority === 'high') { add('X-Priority', '1 (Highest)'); add('Importance', 'high'); }
  else if (m.priority === 'low') { add('X-Priority', '5 (Lowest)'); add('Importance', 'low'); }
  if (m.auto) add('Auto-Submitted', 'auto-generated');
  for (const [k, v] of Object.entries(m.headers || {})) {
    const name = k.replace(/[^A-Za-z0-9-]/g, '');
    // Custom headers cannot override the structural ones built above; a duplicate From or Content-Type would make the
    // message ambiguous (and is a classic spoofing vector).
    if (!name || /^(from|to|cc|bcc|subject|date|message-id|mime-version|content-.*|sender|reply-to)$/i.test(name)) continue;
    add(name, encodeHeaderText(v));
  }
  add('MIME-Version', '1.0');

  // Default boundary = hash of the content, not random: same message -> same bytes (tests, caching). A boundary must
  // not occur in any part: base64 bodies cannot contain '-' so they are safe by alphabet, but a 7bit or QP text body
  // is not checked. Residual risk: text that contains the exact boundary line would split the part; pass a random
  // m.boundary when bodies are arbitrary user text in 'auto' / 'quoted-printable' mode.
  const b = String(m.boundary || 'b' + simpleHash(JSON.stringify([m.subject, m.text, m.html, m.messageId, (m.attachments || []).length]))).replace(/[^A-Za-z0-9'()+_,./:=?-]/g, '').slice(0, 60);
  const enc = { encoding: m.encoding || 'base64' };
  const atts = (m.attachments || []).map((a) => ({ ...a, contentType: a.contentType || contentTypeOf(a.filename) }));
  const inline = atts.filter((a) => a.inline && m.html);
  const files = atts.filter((a) => !(a.inline && m.html));
  const textPart = leaf('text/plain', String(m.text == null ? '' : m.text), enc);
  let body;
  if (m.html) {
    let htmlPart = leaf('text/html', String(m.html), enc);
    if (inline.length) {
      const rel = multipart('related', b + '-r', [htmlPart, ...inline.map((a) => leaf(a.contentType, toBytes(a.data), { disposition: 'inline', filename: a.filename, cid: a.cid || a.filename }))]);
      htmlPart = rel.head + '\r\n\r\n' + rel.body;
    }
    const alt = multipart('alternative', b + '-a', [textPart, htmlPart]);
    body = { head: alt.head, body: alt.body };
  } else body = null;
  if (files.length) {
    const first = body ? body.head + '\r\n\r\n' + body.body : textPart;
    const mixed = multipart('mixed', b + '-m', [first, ...files.map((a) => leaf(a.contentType, /^text\//.test(a.contentType) && typeof a.data === 'string' ? a.data : toBytes(a.data), { encoding: 'base64', disposition: a.inline ? 'inline' : 'attachment', filename: a.filename || 'file', cid: a.cid }))]);
    body = mixed;
  }
  const preamble = m.preamble === undefined ? 'This is a multi-part message in MIME format.\r\n\r\n' : m.preamble ? m.preamble + '\r\n\r\n' : '';
  if (!body) return h.join('\r\n') + '\r\n' + textPart + '\r\n';
  return h.join('\r\n') + '\r\n' + foldHeader('Content-Type', body.head.slice(14)) + '\r\n\r\n' + preamble + body.body + '\r\n';
}
// FNV-1a 32-bit plus the length: tiny, deterministic, good enough to make boundaries unique per message.
function simpleHash(s) { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(36) + s.length.toString(36); }

// SMTP envelope of a message model: { from, to: [every To, Cc and Bcc address, unique] }.
// Bcc recipients are in the envelope (RCPT TO) but not in the headers: that is what makes them blind.
export function envelopeOf(m) {
  const from = (addressesOf(m.sender || m.from)[0] || {}).address || '';
  const to = [...new Set([...addressesOf(m.to), ...addressesOf(m.cc), ...addressesOf(m.bcc)].map((a) => a.address.toLowerCase()))];
  return { from, to };
}
// A file name for the .eml of a subject.
export const emlFileName = (subject, fallback = 'message') => (String(subject || '').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback) + '.eml';

// --- reading -----------------------------------------------------------------------------------------------------

// Header block -> [{ name, value }] (unfolded; values raw).
// Unfolding: a line starting with whitespace continues the previous header (RFC 5322 2.2.3).
export function parseHeaders(block) {
  const out = [];
  for (const line of String(block).replace(/\r\n?/g, '\n').split('\n')) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1].value += ' ' + line.trim();
    else { const i = line.indexOf(':'); if (i > 0) out.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }); }
  }
  return out;
}
// 'text/plain; charset="utf-8"; name*0*=UTF-8''a%20; name*1=b' -> { value: 'text/plain', params: { charset, name } }.
// Split on ';' outside quotes, then reassemble RFC 2231 continuations (name*0*, name*1, ...): segments are sorted by
// index, '*' segments are percent-decoded to bytes, and the charset from the first segment decodes the whole value.
export function parseHeaderParams(v) {
  const parts = [];
  let cur = '', q = false;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '"') q = !q;
    if (c === '\\' && q) { cur += c + (v[++i] || ''); continue; }
    if (c === ';' && !q) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  const params = {}, cont = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i).trim().toLowerCase();
    let val = p.slice(i + 1).trim();
    if (val.startsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, '$1');
    const r = /^([^*]+)\*(\d+)?(\*)?$/.exec(k);
    if (r) (cont[r[1]] = cont[r[1]] || []).push({ n: r[2] == null ? 0 : +r[2], val, enc: !!r[3] || r[2] == null });
    else params[k] = decodeWords(val);
  }
  // RFC 2231: segments name*0*, name*1, … joined; '*' segments are percent-encoded, the first one carries charset'lang'.
  for (const [k, list] of Object.entries(cont)) {
    list.sort((a, b) => a.n - b.n);
    let charset = 'utf-8';
    const bytes = [];
    list.forEach((x, i) => {
      let v = x.val;
      if (x.enc && i === 0) { const m = /^([^']*)'[^']*'(.*)$/.exec(v); if (m) { charset = m[1] || charset; v = m[2]; } }
      for (let j = 0; j < v.length; j++) {
        if (x.enc && v[j] === '%' && /^[0-9A-Fa-f]{2}$/.test(v.slice(j + 1, j + 3))) { bytes.push(parseInt(v.slice(j + 1, j + 3), 16)); j += 2; }
        else bytes.push(...utf8(v[j]));
      }
    });
    params[k] = decodeBytes(new Uint8Array(bytes), charset);
  }
  return { value: parts[0].trim().toLowerCase(), params };
}

// Recursive MIME walk. `binary` means the message was read as bytes (one char per byte), so 8bit bodies are decoded
// in their declared charset instead of being treated as already-decoded text.
function parsePart(raw, binary) {
  const sep = /\r?\n\r?\n/.exec(raw);
  const head = sep ? raw.slice(0, sep.index) : raw;
  const body = sep ? raw.slice(sep.index + sep[0].length) : '';
  const headers = parseHeaders(head);
  const get = (n) => { const x = headers.find((y) => y.name.toLowerCase() === n); return x ? x.value : ''; };
  const ct = parseHeaderParams(get('content-type') || 'text/plain; charset=us-ascii');
  const cd = parseHeaderParams(get('content-disposition') || '');
  const part = { headers, type: ct.value, params: ct.params, disposition: cd.value, filename: cd.params.filename || ct.params.name || '', cid: get('content-id').replace(/[<>]/g, '') };
  if (ct.value.startsWith('multipart/') && ct.params.boundary) {
    const bd = '--' + ct.params.boundary;
    const chunks = body.split(new RegExp('(?:^|\\r?\\n)' + bd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(--)?[ \\t]*(?=\\r?\\n|$)'));
    part.parts = [];
    // split() interleaves the captured '--' group: [preamble, cap, part1, cap, part2, '--', epilogue]
    for (let i = 2; i < chunks.length; i += 2) { if (chunks[i - 1] === '--') break; part.parts.push(parsePart(chunks[i].replace(/^\r?\n/, ''), binary)); }
  } else {
    part.data = decodeBody(body, get('content-transfer-encoding'), binary);
    if (part.type.startsWith('text/') && !part.disposition.startsWith('attachment')) part.text = decodeBytes(part.data, ct.params.charset || 'utf-8');
  }
  return part;
}

// .eml text (or bytes) -> { headers, header(name), subject, from, to, cc, replyTo, date, messageId, text, html,
// attachments: [{ filename, contentType, data, cid, inline }], tree }.
export function parseMessage(input) {
  const binary = input instanceof Uint8Array;
  const raw = binary ? bytesLatin1(input) : String(input);
  // First text/plain and first text/html outside attachments become the bodies; every other leaf is an attachment,
  // marked inline when it sits in multipart/related with a Content-ID (a cid: image).
  const tree = parsePart(raw, binary);
  const hv = (n) => { const x = tree.headers.find((y) => y.name.toLowerCase() === n.toLowerCase()); return x ? x.value : ''; };
  const dec = (v) => decodeWords(binary && /[\x80-\xff]/.test(v) ? decodeBytes(Uint8Array.from(v, (c) => c.charCodeAt(0) & 0xff)) : v);
  const out = { headers: tree.headers.map((x) => ({ name: x.name, value: dec(x.value) })), subject: dec(hv('subject')), from: parseAddressList(dec(hv('from'))), to: parseAddressList(dec(hv('to'))),
    cc: parseAddressList(dec(hv('cc'))), replyTo: parseAddressList(dec(hv('reply-to'))), date: parseMailDate(hv('date')), messageId: hv('message-id').replace(/[<>]/g, ''), text: '', html: '', attachments: [], tree };
  out.header = (n) => dec(hv(n));
  const walk = (p, parentType) => {
    if (p.parts) { for (const c of p.parts) walk(c, p.type); return; }
    const isAttachment = p.disposition === 'attachment' || !p.type.startsWith('text/');
    if (!isAttachment && p.type === 'text/plain' && !out.text) out.text = p.text;
    else if (!isAttachment && p.type === 'text/html' && !out.html) out.html = p.text;
    else out.attachments.push({ filename: p.filename, contentType: p.type, data: p.data, cid: p.cid, inline: p.disposition === 'inline' || (parentType === 'multipart/related' && !!p.cid) });
  };
  walk(tree, '');
  return out;
}
