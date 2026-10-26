// mail/address.js - email addresses: a conservative validator, Gmail canonicalisation (case, dots and +tags of one
// mailbox; googlemail.com = gmail.com) as a uniqueness key, blocklists by pattern, reserved local parts that must
// not be registered (ad-min and a.d.m.i.n included), masking for logs, RFC 5322 address lists ("Name" <a@b>,
// groups, comments, encoded words) and their safe formatting, IDN domains to ASCII, and mailto: links (RFC 6068).
//
// Two deliberately different strictness levels: canonEmail (account sign-up) accepts only the boring subset of
// RFC 5321 that every provider delivers to, while parseAddressList (reading headers) is tolerant, because rejecting a
// received message for an odd but legal header loses data. Formatting always goes through headerSafe, so an address
// or display name can never smuggle a CR / LF into a header (header injection).
import { domainToASCII, domainToUnicode } from '../codec/punycode.js';
import { decodeWords, encodeHeaderText, headerSafe } from './encoding.js';

export const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com'];
export const RESERVED_LOCALS = [
  'admin', 'administrator', 'root', 'postmaster', 'hostmaster', 'webmaster', 'abuse', 'security', 'noreply', 'no-reply',
  'donotreply', 'mailer-daemon', 'daemon', 'bounce', 'bounces', 'support', 'help', 'info', 'contact', 'sales', 'billing',
  'office', 'team', 'staff', 'mail', 'smtp', 'imap', 'pop', 'dns', 'ns', 'mx', 'www', 'ftp', 'api', 'dev', 'test',
  'moderator', 'manager', 'developer', 'system', 'privacy', 'legal', 'marketing', 'newsletter', 'list', 'owner',
];

// Dot-atom local part and an LDH domain with at least two labels (quoted local parts and IP literals are refused on
// purpose: an address that confirms an account should be ordinary).
const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const EMPTY = Object.freeze({ ok: false, address: '', local: '', domain: '', canonical: '', isGmail: false, plusTag: '' });

// -> { ok, address (lower case), local, domain (ASCII; an IDN is converted), canonical, isGmail, plusTag }.
// Gmail: dots and +tag removed from the canonical form; other providers keep both (dots are significant there).
// The canonical form is a uniqueness key (one account per mailbox), never the address mail is sent to: `address`
// keeps dots and +tags, `canonical` folds them only where the provider is known to ignore them (Gmail). Applying the
// Gmail rule to other domains would merge distinct mailboxes.
// lastIndexOf('@'): the domain never contains '@', the local part (quoted) may; quoted forms are refused below anyway.
// The whole local part is lower-cased: technically case-sensitive per RFC 5321, case-insensitive at every major
// provider, and case variants of one address must not register twice.
export function canonEmail(input) {
  const raw = String(input == null ? '' : input).trim().replace(/^<|>$/g, '').trim();
  if (!raw || raw.length > 254) return EMPTY;
  const at = raw.lastIndexOf('@');
  if (at < 1 || at === raw.length - 1) return EMPTY;
  const local = raw.slice(0, at);
  let domain = raw.slice(at + 1).toLowerCase().replace(/\.$/, '');
  if (/[^\x00-\x7f]/.test(domain)) { try { domain = domainToASCII(domain); } catch { return EMPTY; } }
  if (local.length > 64 || !LOCAL_RE.test(local) || !DOMAIN_RE.test(domain)) return EMPTY;
  const low = local.toLowerCase();
  const plus = low.indexOf('+');
  const plusTag = plus >= 0 ? low.slice(plus + 1) : '';
  const isGmail = GMAIL_DOMAINS.includes(domain);
  let canonLocal = isGmail ? (plus >= 0 ? low.slice(0, plus) : low).replace(/\./g, '') : low;
  // '+tag@gmail.com' (empty mailbox) and a Gmail local made only of dots are not deliverable addresses.
  if (!canonLocal || (plus === 0)) return EMPTY;
  return { ok: true, address: low + '@' + domain, local: low, domain, canonical: canonLocal + '@' + (isGmail ? 'gmail.com' : domain), isGmail, plusTag };
}
export const isEmail = (s) => canonEmail(s).ok;
// The domain in Unicode for display (xn-- labels decoded).
export const displayDomain = (domain) => { try { return domainToUnicode(domain); } catch { return domain; } };

// The first blocklist pattern (regular expression source, case-insensitive) matching the address or its canonical
// form, or ''. Broken patterns are skipped.
// Patterns are admin-supplied regex sources. Testing both forms catches a blocked mailbox hidden behind dots or a
// +tag. A malicious pattern could backtrack catastrophically (ReDoS); acceptable because only admins write them.
export function matchBlocklist(email, patterns) {
  const info = canonEmail(email);
  if (!info.ok) return '';
  for (const p of Array.isArray(patterns) ? patterns : []) {
    const src = String(p || '').trim();
    if (!src) continue;
    try { const re = new RegExp(src, 'i'); if (re.test(info.address) || re.test(info.canonical)) return src; } catch { /* skip */ }
  }
  return '';
}

// Is a local part reserved? Compared without dots, hyphens and underscores, so 'ad-min' and 'a.d.m.i.n' are caught.
// An empty local part counts as reserved.
export function isReservedLocal(local, extra = []) {
  const flat = (s) => String(s || '').toLowerCase().replace(/[.\-_]/g, '');
  const needle = flat(String(local || '').split('+')[0]);
  if (!needle) return true;
  return RESERVED_LOCALS.concat(Array.isArray(extra) ? extra.map(String) : []).some((w) => flat(w) === needle);
}

// 'va***a@gmail.com' for logs and screens.
export function maskEmail(email) {
  const info = canonEmail(email);
  if (!info.ok) return '';
  const l = info.local;
  return l.slice(0, Math.min(2, l.length)) + '***' + (l.length > 3 ? l.slice(-1) : '') + '@' + info.domain;
}

// --- address lists -----------------------------------------------------------------------------------------------

// Tokens of an address list: quoted strings, comments, angle addresses, specials.
// RFC 5322 lexer subset: quoted strings (with backslash escapes), nested comments, angle addresses, the specials
// that structure lists (',' ';' ':'), and bare words. An unterminated quote or bracket runs to the end of input
// instead of throwing: tolerant reading.
function tokens(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let v = '';
      for (i++; i < s.length && s[i] !== '"'; i++) v += s[i] === '\\' && i + 1 < s.length ? s[++i] : s[i];
      i++; out.push({ t: 'q', v });
    } else if (c === '(') {
      let depth = 1, v = '';
      for (i++; i < s.length && depth; i++) { if (s[i] === '\\') { v += s[++i] || ''; continue; } if (s[i] === '(') depth++; else if (s[i] === ')' && !--depth) break; v += s[i]; }
      i++; out.push({ t: 'c', v });
    } else if (c === '<') {
      const e = s.indexOf('>', i);
      out.push({ t: 'a', v: s.slice(i + 1, e < 0 ? s.length : e).trim() }); i = e < 0 ? s.length : e + 1;
    } else if (c === ',' || c === ';' || c === ':') { out.push({ t: c }); i++; }
    else if (/\s/.test(c)) i++;
    else { let v = ''; while (i < s.length && !/[\s"(<,;:]/.test(s[i])) v += s[i++]; out.push({ t: 'w', v }); }
  }
  return out;
}

// 'Ana <ana@x.ge>, "Doe, John" <j@x>, b@x (Bob), Team: c@x, d@x;' -> [{ name, address, group? }] (names decoded
// from encoded words; the comment serves as the name when there is no other).
// Grammar: list of mailbox | group ("Name: a, b;"). A mailbox is display words + <addr>, or a bare word containing
// '@' (with an optional trailing comment as name, the old 'a@b (Name)' form). Entries without an address are dropped.
export function parseAddressList(text) {
  const out = [];
  let group = '', words = [], addr = '', comment = '';
  const flush = () => {
    let name = words.join(' ').trim();
    let address = addr;
    if (!address && words.length) { const last = words[words.length - 1]; if (last.includes('@')) { address = last; name = words.slice(0, -1).join(' ').trim(); } }
    if (address || name) out.push({ name: decodeWords(name || comment).trim(), address: address.replace(/^mailto:/i, '').trim(), ...(group ? { group } : {}) });
    words = []; addr = ''; comment = '';
  };
  for (const tk of tokens(String(text == null ? '' : text))) {
    if (tk.t === 'w' || tk.t === 'q') words.push(tk.v);
    else if (tk.t === 'c') comment = comment || tk.v.trim();
    else if (tk.t === 'a') addr = tk.v;
    else if (tk.t === ':') { group = decodeWords(words.join(' ').trim()); words = []; }
    else if (tk.t === ',') flush();
    else if (tk.t === ';') { flush(); group = ''; }
  }
  flush();
  return out.filter((a) => a.address);
}
export const parseAddress = (text) => parseAddressList(text)[0] || null;

// Valid and invalid entries of a list, deduplicated by canonical address.
export function checkAddresses(list) {
  const seen = new Set(), valid = [], invalid = [];
  for (const a of typeof list === 'string' ? parseAddressList(list) : list) {
    const info = canonEmail(a.address);
    if (!info.ok) { invalid.push(a); continue; }
    if (seen.has(info.canonical)) continue;
    seen.add(info.canonical); valid.push({ ...a, address: info.address });
  }
  return { valid, invalid };
}

// 'Name <address>' for a header: the name as encoded words when it is not ASCII, quoted when it has specials;
// CR / LF and angle brackets cannot get into the address.
// Name rules: non-ASCII -> encoded words (never quoted: RFC 2047 forbids encoded words inside quotes); ASCII with
// specials -> quoted string with \ escapes; plain ASCII as is. Whitespace and angle brackets are stripped from the
// address so it cannot close the <...> early.
export function formatAddress(address, name = '') {
  const a = headerSafe(address).replace(/[<>\s]/g, '');
  const n = headerSafe(name).trim();
  if (!n) return a;
  const enc = encodeHeaderText(n);
  const quoted = enc === n && /[",;:<>@[\]\\().]/.test(n) ? '"' + n.replace(/(["\\])/g, '\\$1') + '"' : enc;
  return quoted + ' <' + a + '>';
}
// Address model (string 'Name <a@b>', { name, address } or a list of them) -> header value.
export function formatAddressList(v) {
  const list = (Array.isArray(v) ? v : [v]).flatMap((x) => (typeof x === 'string' ? parseAddressList(x) : x ? [{ name: x.name || '', address: x.address || x.email || '' }] : []));
  return list.filter((x) => x.address).map((x) => formatAddress(x.address, x.name)).join(', ');
}
export const addressesOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => (typeof x === 'string' ? parseAddressList(x) : [{ name: x.name || '', address: x.address || x.email || '' }])).filter((x) => x.address);

// --- mailto ------------------------------------------------------------------------------------------------------

const mailtoEnc = (s) => encodeURIComponent(String(s));
// { to, cc, bcc, subject, body } -> 'mailto:a@x,b@x?cc=…&subject=…&body=…' (line breaks as %0D%0A).
// RFC 6068: percent-encode each component (encodeURIComponent never emits '&' or '=' raw, so values cannot inject
// parameters) and use CRLF line breaks in the body. '@' is kept literal between encoded local part and domain.
export function mailtoLink({ to = [], cc = [], bcc = [], subject = '', body = '', inReplyTo = '' } = {}) {
  const addrs = (v) => addressesOf(v).map((a) => a.address).map((a) => a.split('@').map(encodeURIComponent).join('@')).join(',');
  const q = [];
  if (addrs(cc)) q.push('cc=' + addrs(cc));
  if (addrs(bcc)) q.push('bcc=' + addrs(bcc));
  if (subject) q.push('subject=' + mailtoEnc(headerSafe(subject)));
  if (body) q.push('body=' + mailtoEnc(String(body).replace(/\r?\n/g, '\r\n')));
  if (inReplyTo) q.push('in-reply-to=' + mailtoEnc('<' + String(inReplyTo).replace(/[<>]/g, '') + '>'));
  return 'mailto:' + addrs(to) + (q.length ? '?' + q.join('&') : '');
}
// 'mailto:…' -> { to: [], cc: [], bcc: [], subject, body, headers: {} }.
// '+' is a literal plus in mailto (not a space as in form encoding), hence the %2B substitution before decoding.
// KNOWN DEFECT: split('?') and split('=') keep only the first two pieces, so a raw (unencoded) '?' or '=' inside a
// value truncates it. Fix: split at the first '?' / '=' only (indexOf + slice).
export function parseMailto(uri) {
  const s = String(uri || '').replace(/^mailto:/i, '');
  const [path, query = ''] = s.split('?');
  const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, '%2B')); } catch { return x; } };
  const out = { to: path ? path.split(',').map(dec).filter(Boolean) : [], cc: [], bcc: [], subject: '', body: '', headers: {} };
  for (const kv of query.split('&').filter(Boolean)) {
    const [k0, v0 = ''] = kv.split('=');
    const k = dec(k0).toLowerCase(), v = dec(v0);
    if (k === 'to' || k === 'cc' || k === 'bcc') out[k].push(...v.split(',').map((x) => x.trim()).filter(Boolean));
    else if (k === 'subject' || k === 'body') out[k] = v.replace(/\r\n/g, '\n');
    else out.headers[k] = v;
  }
  return out;
}
