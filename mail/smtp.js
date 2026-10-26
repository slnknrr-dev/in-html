// mail/smtp.js - the SMTP protocol (RFC 5321) without sockets: reply parsing from a growing buffer (multi-line
// 250-… / 250 …), EHLO capabilities, reply classes and enhanced status codes (RFC 3463), AUTH PLAIN / LOGIN payloads,
// dot-stuffing of DATA and its reverse, and the command script of one transaction for a transport to play.
//
// Sans-I/O design: no sockets here, only pure functions over strings. The same code drives a Node socket, a
// WebSocket relay or a test harness, and protocol logic is unit-testable without a server.
import { b64encode } from '../codec/base64.js';
import { utf8 } from './encoding.js';

// The first complete reply in `buf`: { code, text, lines, enhanced, rest } or null while it is incomplete (a
// buffer that does not look like SMTP also gives null; the caller decides).
// Multi-line replies use 'NNN-text' for every line but the last ('NNN text'). Returns null until the final line has
// arrived, so the caller can feed a growing buffer and retry; `rest` holds bytes of the next reply (pipelining).
export function parseSmtpReply(buf) {
  const s = String(buf == null ? '' : buf);
  const lines = [];
  let pos = 0;
  for (;;) {
    const nl = s.indexOf('\n', pos);
    if (nl < 0) return null;
    const line = s.slice(pos, nl).replace(/\r$/, '');
    pos = nl + 1;
    const m = /^(\d{3})([ -]?)(.*)$/.exec(line);
    if (!m) return null;
    lines.push(m[3]);
    if (m[2] !== '-') {
      const en = /^([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(lines[0]);
      return { code: +m[1], text: lines.join('\n'), lines, enhanced: en ? en[0] : '', rest: s.slice(pos) };
    }
  }
}
// Every complete reply in a buffer, and what remains.
export function parseSmtpReplies(buf) {
  const out = [];
  let rest = String(buf || ''), r;
  while ((r = parseSmtpReply(rest))) { out.push(r); rest = r.rest; }
  return { replies: out, rest };
}

// 2xx positive, 3xx intermediate (send more), 4xx transient (retry later), 5xx permanent.
export const replyClass = (code) => ({ 2: 'positive', 3: 'intermediate', 4: 'transient', 5: 'permanent' }[String(code)[0]] || 'invalid');
export const isRetryable = (code) => replyClass(code) === 'transient';

const ENHANCED = {
  '1.1': 'bad destination mailbox', '1.2': 'bad destination system', '1.3': 'bad destination mailbox address syntax', '1.10': 'recipient address has null MX',
  '2.1': 'mailbox disabled', '2.2': 'mailbox full', '2.3': 'message length exceeds administrative limit', '3.4': 'message too big for system',
  '4.1': 'no answer from host', '4.7': 'delivery time expired', '5.3': 'too many recipients', '7.1': 'delivery not authorized, message refused',
  '7.8': 'authentication credentials invalid', '7.26': 'multiple authentication checks failed', '0.0': 'other undefined status',
};
// '5.1.1' -> { class: 'permanent', subject: 1, detail: 1, meaning }.
export function enhancedStatus(code) {
  const r = /^([245])\.(\d{1,3})\.(\d{1,3})$/.exec(String(code || ''));
  if (!r) return null;
  return { class: { 2: 'success', 4: 'transient', 5: 'permanent' }[r[1]], subject: +r[2], detail: +r[3], meaning: ENHANCED[`${r[2]}.${r[3]}`] || '' };
}

// EHLO reply lines -> { domain, starttls, auth: ['PLAIN', 'LOGIN', …], size, pipelining, smtputf8, eightBit, dsn, chunking, extensions }.
export function smtpCapabilities(ehlo) {
  const lines = Array.isArray(ehlo) ? ehlo : String(ehlo || '').split('\n');
  const out = { domain: '', starttls: false, auth: [], size: 0, pipelining: false, smtputf8: false, eightBit: false, dsn: false, chunking: false, extensions: {} };
  lines.forEach((raw, i) => {
    const line = raw.replace(/^\d{3}[ -]/, '').trim();
    if (i === 0) { out.domain = line.split(/\s/)[0]; return; }
    const [kw, ...args] = line.split(/[\s=]+/);
    const k = (kw || '').toUpperCase();
    if (!k) return;
    out.extensions[k] = args.join(' ');
    if (k === 'STARTTLS') out.starttls = true;
    else if (k === 'AUTH') for (const a of args) { const m = a.toUpperCase(); if (m && !out.auth.includes(m)) out.auth.push(m); }
    else if (k === 'SIZE') out.size = +args[0] || 0;
    else if (k === 'PIPELINING') out.pipelining = true;
    else if (k === 'SMTPUTF8') out.smtputf8 = true;
    else if (k === '8BITMIME') out.eightBit = true;
    else if (k === 'DSN') out.dsn = true;
    else if (k === 'CHUNKING') out.chunking = true;
  });
  return out;
}

// AUTH PLAIN: base64("authzid\0user\0pass") (UTF-8); AUTH LOGIN: the two base64 answers.
export const authPlain = (user, pass, authzid = '') => b64encode(utf8(authzid + '\0' + String(user == null ? '' : user) + '\0' + String(pass == null ? '' : pass)));
export const authLogin = (user, pass) => [b64encode(utf8(user)), b64encode(utf8(pass))];
// XOAUTH2 initial response.
// Google / Microsoft SASL XOAUTH2 format: fields separated by ^A, terminated by two ^A.
export const authXOAuth2 = (user, token) => b64encode(utf8(`user=${user}\u0001auth=Bearer ${token}\u0001\u0001`));

// DATA payload: CRLF line ends, a leading '.' doubled (RFC 5321 §4.5.2), and the terminating line.
// A line consisting of '.' ends DATA, so every line starting with '.' gets an extra one (the receiver strips it).
// Line ends are normalised to CRLF first; bare LF is rejected by strict servers.
export const dotStuff = (data) => String(data == null ? '' : data).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
export const dotUnstuff = (data) => String(data == null ? '' : data).replace(/^\.\./gm, '.');
export const dataPayload = (message) => { const s = dotStuff(message); return s + (s.endsWith('\r\n') ? '' : '\r\n') + '.\r\n'; };

// Commands of one transaction: EHLO, (STARTTLS), (AUTH), MAIL FROM, RCPT TO per recipient, DATA, payload, QUIT,
// each with the reply codes that let it continue. Addresses with CR / LF / '<' '>' are refused.
// Declarative steps ({ send, expect, tls, secret, raw }) for a transport to play: `secret` marks lines to hide from
// logs, `tls` marks where to upgrade the socket. After STARTTLS the EHLO is repeated, since the server may advertise
// different capabilities (AUTH typically appears only under TLS). Addresses are validated here, not escaped:
// there is no safe escaping for a CR inside an SMTP command line.
export function smtpScript({ helo = 'localhost', from, to = [], message, auth = null, starttls = false, size = 0, smtputf8 = false } = {}) {
  const clean = (a) => { const s = String(a || ''); if (/[\r\n<>\s]/.test(s)) throw new Error('SMTP: bad address ' + JSON.stringify(s)); return s; };
  const steps = [{ send: `EHLO ${String(helo).replace(/[^A-Za-z0-9.[\]:-]/g, '')}`, expect: [250] }];
  if (starttls) steps.push({ send: 'STARTTLS', expect: [220], tls: true }, { send: steps[0].send, expect: [250] });
  if (auth) {
    if ((auth.method || 'PLAIN').toUpperCase() === 'LOGIN') { const [u, p] = authLogin(auth.user, auth.pass); steps.push({ send: 'AUTH LOGIN', expect: [334] }, { send: u, expect: [334], secret: true }, { send: p, expect: [235], secret: true }); }
    else steps.push({ send: 'AUTH PLAIN ' + authPlain(auth.user, auth.pass), expect: [235], secret: true });
  }
  const params = (size ? ` SIZE=${size | 0}` : '') + (smtputf8 ? ' SMTPUTF8' : '');
  steps.push({ send: `MAIL FROM:<${clean(from)}>${params}`, expect: [250] });
  for (const r of to) steps.push({ send: `RCPT TO:<${clean(r)}>`, expect: [250, 251] });
  steps.push({ send: 'DATA', expect: [354] }, { send: dataPayload(message || ''), expect: [250], raw: true }, { send: 'QUIT', expect: [221] });
  return steps;
}
