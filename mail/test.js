// mail/test.js - unit tests of the mail library: `node mail/test.js` (importing the module runs nothing).
// Address canonicalisation, blocklists, reserved names, masking, address lists and mailto (the source's cases plus
// groups, comments and IDN), encoded words (injection, word length, Q / B decoding), message building in every
// shape read back by the parser (headers, multiparts, attachments with RFC 2231 names, inline images, both body
// encodings), and SMTP replies, capabilities, AUTH payloads, dot-stuffing and the transaction script.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { b64decode } from '../codec/base64.js';
import { canonEmail, checkAddresses, formatAddress, formatAddressList, isEmail, isReservedLocal, maskEmail, mailtoLink, matchBlocklist, parseAddress, parseAddressList, parseMailto } from './address.js';
import { decodeWords, encodeHeaderText, encodeWords, utf8 } from './encoding.js';
import { buildMessage, contentTypeOf, emlFileName, envelopeOf, foldHeader, mailDate, messageId, parseHeaderParams, parseMailDate, parseMessage } from './mime.js';
import { authLogin, authPlain, dataPayload, dotStuff, dotUnstuff, enhancedStatus, parseSmtpReplies, parseSmtpReply, replyClass, smtpCapabilities, smtpScript } from './smtp.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond) => eq(name, !!cond, true);
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no throw`); } catch { pass++; } };
  const unb64 = (s) => new TextDecoder().decode(b64decode(s));

  // --- addresses (ported) -----------------------------------------------------------------------------------------
  const a = canonEmail('Example.User@Gmail.com'), c = canonEmail('example.user+123@gmail.com');
  eq('gmail canon', [a.canonical, canonEmail('exampleuser@gmail.com').canonical, c.canonical, c.plusTag, a.plusTag, a.isGmail, a.address],
    ['exampleuser@gmail.com', 'exampleuser@gmail.com', 'exampleuser@gmail.com', '123', '', true, 'example.user@gmail.com']);
  eq('googlemail', canonEmail('a.b@googlemail.com').canonical, 'ab@gmail.com');
  eq('other providers', [canonEmail('Ivan.Petrov@Yandex.ru').canonical, canonEmail('ivan+tag@yandex.ru').canonical, canonEmail('ivan+tag@yandex.ru').plusTag], ['ivan.petrov@yandex.ru', 'ivan+tag@yandex.ru', 'tag']);
  for (const bad of ['', '   ', 'no-at-sign', 'a@', '@b.com', 'a@b', 'a b@c.com', '+tag@gmail.com', 'a@-bad.com', 'x'.repeat(65) + '@gmail.com', 'a@b..com', '.a@b.com', 'a..b@c.com']) eq('reject ' + bad, canonEmail(bad).ok, false);
  eq('idn', [canonEmail('USER@Bücher.de').domain, isEmail('user@batume.li')], ['xn--bcher-kva.de', true]);
  ok('idn ascii', /^xn--/.test(canonEmail('user@მაგალითი.გე').domain));
  const pats = ['^spam', 'temp-?mail\\.'];
  eq('blocklist', [matchBlocklist('spammer@gmail.com', pats), matchBlocklist('s.p.a.m.mer@gmail.com', pats), matchBlocklist('user@temp-mail.org', pats), matchBlocklist('good@gmail.com', pats), matchBlocklist('good@gmail.com', ['[invalid(']), matchBlocklist('good@gmail.com', null)],
    ['^spam', '^spam', 'temp-?mail\\.', '', '', '']);
  eq('reserved', [isReservedLocal('admin'), isReservedLocal('ad-min'), isReservedLocal('a.d.m.i.n'), isReservedLocal('POSTMASTER'), isReservedLocal('мой-бренд', ['мойбренд']), isReservedLocal('kristina'), isReservedLocal(''), isReservedLocal('admin+x')],
    [true, true, true, true, true, false, true, true]);
  eq('mask', [maskEmail('vasya@gmail.com'), maskEmail('ab@x.ge'), maskEmail('bad')], ['va***a@gmail.com', 'ab***@x.ge', '']);

  // --- address lists ----------------------------------------------------------------------------------------------
  eq('list', parseAddressList('Ana <ana@x.ge>, "Doe, John" <j@x.com>, b@x.com (Bob), Team: c@x.com, d@x.com;, =?UTF-8?B?0JjQstCw0L0=?= <ivan@x.ru>'), [
    { name: 'Ana', address: 'ana@x.ge' }, { name: 'Doe, John', address: 'j@x.com' }, { name: 'Bob', address: 'b@x.com' },
    { name: '', address: 'c@x.com', group: 'Team' }, { name: '', address: 'd@x.com', group: 'Team' }, { name: 'Иван', address: 'ivan@x.ru' }]);
  eq('single', parseAddress('  <mailto:z@x.com> '), { name: '', address: 'z@x.com' });
  eq('check', checkAddresses('a@gmail.com, A.@x, A@Gmail.com, b@x.ge').valid.map((x) => x.address), ['a@gmail.com', 'b@x.ge']);
  eq('format', [formatAddress('a@b.com'), formatAddress('a@b.com', 'Doe, John'), formatAddress('a@b.com\r\nBcc: e@x.com', 'X')], ['a@b.com', '"Doe, John" <a@b.com>', 'X <a@b.comBcc:e@x.com>']);
  ok('format cyrillic', formatAddress('a@b.com', 'КристинаHouse').startsWith('=?UTF-8?B?'));
  eq('format list', formatAddressList(['Ana <a@x.ge>', { name: 'Bo', address: 'b@x.ge' }]), 'Ana <a@x.ge>, Bo <b@x.ge>');
  const mt = mailtoLink({ to: ['a@x.ge', 'Bo <b@x.ge>'], cc: 'c@x.ge', subject: 'Hi & bye?', body: 'Line 1\nLine 2' });
  eq('mailto', mt, 'mailto:a@x.ge,b@x.ge?cc=c@x.ge&subject=Hi%20%26%20bye%3F&body=Line%201%0D%0ALine%202');
  eq('mailto parse', parseMailto(mt), { to: ['a@x.ge', 'b@x.ge'], cc: ['c@x.ge'], bcc: [], subject: 'Hi & bye?', body: 'Line 1\nLine 2', headers: {} });

  // --- encoded words (ported + more) ------------------------------------------------------------------------------
  eq('ascii as is', encodeHeaderText('Hello world'), 'Hello world');
  const enc = encodeHeaderText('Подтверждение почты');
  ok('b word', enc.startsWith('=?UTF-8?B?') && enc.endsWith('?='));
  eq('b word decode', decodeWords(enc), 'Подтверждение почты');
  eq('injection', encodeHeaderText('a\r\nBcc: evil@x.com'), 'a Bcc: evil@x.com');
  const long = 'Очень длинная тема письма про подтверждение адреса электронной почты пользователя 🎉';
  const words = encodeHeaderText(long).split(' ');
  ok('word length', words.length > 1 && words.every((w) => w.length <= 75));
  eq('words rejoin', words.map((w) => unb64(w.slice(10, -2))).join(''), long);
  eq('decode adjacent', decodeWords(encodeHeaderText(long)), long);
  eq('q words', decodeWords(encodeWords('Grüße, Tbilisi!', { mode: 'Q' })), 'Grüße, Tbilisi!');
  eq('decode foreign', [decodeWords('=?iso-8859-1?Q?Andr=E9?= Pirard'), decodeWords('=?UTF-8?q?caf=C3=A9_au_lait?=')], ['André Pirard', 'café au lait']);
  ok('encode =?', encodeHeaderText('price =?x?=').startsWith('=?UTF-8?'));

  // --- headers --------------------------------------------------------------------------------------------------
  const folded = foldHeader('Subject', 'word '.repeat(40).trim()).split('\r\n');
  ok('fold', folded.length > 1 && folded[0].startsWith('Subject: ') && folded.every((l) => l.length <= 78) && folded.slice(1).every((l) => l.startsWith(' ')));
  eq('date', [mailDate(Date.UTC(2026, 9, 24, 10, 0, 5)), mailDate(Date.UTC(2026, 9, 24, 22, 30), 240), mailDate(Date.UTC(2026, 0, 1), -330)],
    ['Sat, 24 Oct 2026 10:00:05 +0000', 'Sun, 25 Oct 2026 02:30:00 +0400', 'Wed, 31 Dec 2025 18:30:00 -0530']);
  eq('date parse', [parseMailDate('Sun, 25 Oct 2026 02:30:00 +0400'), parseMailDate('25 Oct 26 02:30 PDT'), parseMailDate('nope')], [Date.UTC(2026, 9, 24, 22, 30), Date.UTC(2026, 9, 25, 9, 30), NaN]);
  eq('message id', [messageId('batume.li', new Uint8Array([1, 200, 35])), messageId('x.ge', 'a<b>c')], ['<015k0z@batume.li>', '<abc@x.ge>']);
  eq('params', parseHeaderParams('attachment; filename*0*=UTF-8\'\'%D0%BE%D1%82; filename*1="chet.pdf"; size=12'), { value: 'attachment', params: { size: '12', filename: 'отchet.pdf' } });
  eq('params quoted', parseHeaderParams('text/plain; charset="utf-8"; name="a;b.txt"').params, { charset: 'utf-8', name: 'a;b.txt' });
  eq('types', [contentTypeOf('a.PDF'), contentTypeOf('x.ics'), contentTypeOf('noext')], ['application/pdf', 'text/calendar', 'application/octet-stream']);
  eq('eml name', [emlFileName('Re: invoice <5>?'), emlFileName('')], ['Re invoice 5.eml', 'message.eml']);

  // --- building (ported) ------------------------------------------------------------------------------------------
  const plain = buildMessage({ from: { address: 'noreply@batume.li', name: 'КристинаHouse' }, to: 'user@gmail.com', subject: 'Код подтверждения', text: 'Ваш код: 123456', messageId: 'abc@batume.li', date: Date.UTC(2026, 7, 4, 12), auto: true });
  ok('plain headers', plain.includes('\r\nTo: user@gmail.com\r\n') && plain.includes('Message-ID: <abc@batume.li>') && plain.includes('Content-Type: text/plain; charset=utf-8') && plain.includes('Content-Transfer-Encoding: base64') && plain.includes('Auto-Submitted: auto-generated'));
  ok('only crlf', !/[^\r]\n/.test(plain));
  eq('plain body', unb64(plain.split('\r\n\r\n')[1]), 'Ваш код: 123456');
  const p1 = parseMessage(plain);
  eq('plain parse', [p1.subject, p1.from, p1.to, p1.text, p1.messageId, p1.date], ['Код подтверждения', [{ name: 'КристинаHouse', address: 'noreply@batume.li' }], [{ name: '', address: 'user@gmail.com' }], 'Ваш код: 123456', 'abc@batume.li', Date.UTC(2026, 7, 4, 12)]);
  const alt = buildMessage({ from: 'a@b.com', to: 'c@d.com', subject: 'S', text: 'plain', html: '<b>rich</b>', messageId: 'id@b.com', boundary: 'BND1' });
  ok('alt structure', alt.includes('Content-Type: multipart/alternative; boundary="BND1-a"') && alt.includes('--BND1-a--'));
  eq('alt parse', [parseMessage(alt).text, parseMessage(alt).html], ['plain', '<b>rich</b>']);
  const pdf = new Uint8Array(300).map((_, i) => (i * 37) & 255);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const full = buildMessage({
    from: 'Ana <ana@x.ge>', to: ['Bo <b@x.ge>'], cc: 'c@x.ge', bcc: 'hidden@x.ge', replyTo: 'r@x.ge', subject: 'Счёт №5', text: 'См. вложение.\nСпасибо!\n.точка', html: '<p>См. <img src="cid:logo"></p>',
    attachments: [{ filename: 'счёт октябрь.pdf', data: pdf }, { filename: 'logo.png', data: png, inline: true, cid: 'logo' }, { filename: 'event.ics', data: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }],
    encoding: 'quoted-printable', boundary: 'X', date: 0, messageId: 'm1@x.ge', inReplyTo: 'p@x.ge', references: ['o@x.ge', 'p@x.ge'], priority: 'high', headers: { 'X-Campaign': 'Осень', Bcc: 'sneaky@x', 'Content-Type': 'evil' },
  });
  ok('full no bcc', !/hidden@x\.ge|sneaky/.test(full) && !/Content-Type: evil/.test(full));
  ok('full structure', /multipart\/mixed; boundary="X-m"/.test(full) && /multipart\/alternative; boundary="X-a"/.test(full) && /multipart\/related; boundary="X-r"/.test(full));
  ok('full 2231', full.includes("filename*=UTF-8''%D1%81%D1%87%D1%91%D1%82%20%D0%BE%D0%BA%D1%82%D1%8F%D0%B1%D1%80%D1%8C.pdf"));
  ok('full qp', full.includes('Content-Transfer-Encoding: quoted-printable') && full.includes('=D0=A1=D0=BC.'));
  const fp = parseMessage(full);
  eq('full parse text', [fp.subject, fp.text, fp.html, fp.cc[0].address, fp.replyTo[0].address, fp.header('x-campaign'), fp.header('in-reply-to')], ['Счёт №5', 'См. вложение.\r\nСпасибо!\r\n.точка', '<p>См. <img src="cid:logo"></p>', 'c@x.ge', 'r@x.ge', 'Осень', '<p@x.ge>']);
  eq('full attachments', fp.attachments.map((x) => [x.filename, x.contentType, x.data.length, x.inline, x.cid]), [['logo.png', 'image/png', 8, true, 'logo'], ['счёт октябрь.pdf', 'application/pdf', 300, false, ''], ['event.ics', 'text/calendar', 32, false, '']]);
  eq('full bytes', Array.from(fp.attachments[1].data), Array.from(pdf));
  eq('bytes input', parseMessage(utf8(full)).subject, 'Счёт №5');
  eq('envelope', envelopeOf({ from: 'Ana <ana@x.ge>', to: ['B@x.ge'], cc: 'c@x.ge', bcc: ['hidden@x.ge', 'b@x.ge'] }), { from: 'ana@x.ge', to: ['b@x.ge', 'c@x.ge', 'hidden@x.ge'] });
  const att = buildMessage({ from: 'a@x', to: 'b@x', subject: 'f', text: 'see file', attachments: [{ filename: 'a.txt', data: 'hello' }], boundary: 'Q', encoding: 'auto' });
  ok('text + attachment', /multipart\/mixed; boundary="Q-m"/.test(att) && att.includes('Content-Transfer-Encoding: 7bit\r\n\r\nsee file'));
  eq('text + attachment parse', [parseMessage(att).text, new TextDecoder().decode(parseMessage(att).attachments[0].data)], ['see file', 'hello']);
  const foreign = 'From: =?ISO-8859-1?Q?Andr=E9?= <andre@x.fr>\nSubject: =?utf-8?B?0J/RgNC40LLQtdGC?=\n =?utf-8?B?INC80LjRgA==?=\nContent-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n\nCaf=E9 cr=\n=E8me\n';
  const fo = parseMessage(foreign);
  eq('foreign', [fo.from[0].name, fo.subject, fo.text], ['André', 'Привет мир', 'Café crème\r\n']);

  // --- smtp (ported + more) ---------------------------------------------------------------------------------------
  eq('reply single', parseSmtpReply('220 mx.example.com ESMTP\r\n'), { code: 220, text: 'mx.example.com ESMTP', lines: ['mx.example.com ESMTP'], enhanced: '', rest: '' });
  eq('reply partial', [parseSmtpReply('250-mx\r\n250-SIZE'), parseSmtpReply('nonsense\r\n')], [null, null]);
  const multi = parseSmtpReply('250-mx.example.com\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 35882577\r\n354 next');
  eq('reply multi', [multi.code, multi.lines.length, multi.rest], [250, 4, '354 next']);
  const caps = smtpCapabilities(multi.lines.concat(['AUTH=XOAUTH2', '8BITMIME', 'SMTPUTF8', 'PIPELINING']));
  eq('caps', [caps.domain, caps.starttls, caps.auth, caps.size, caps.eightBit, caps.smtputf8, caps.pipelining], ['mx.example.com', true, ['PLAIN', 'LOGIN', 'XOAUTH2'], 35882577, true, true, true]);
  eq('replies', parseSmtpReplies('250 ok\r\n550 5.1.1 no such user\r\n4').replies.map((r) => [r.code, r.enhanced]), [[250, ''], [550, '5.1.1']]);
  eq('classes', [replyClass(250), replyClass(354), replyClass(451), replyClass(550)], ['positive', 'intermediate', 'transient', 'permanent']);
  eq('enhanced', enhancedStatus('5.1.1'), { class: 'permanent', subject: 1, detail: 1, meaning: 'bad destination mailbox' });
  eq('auth plain', [authPlain('user', 'pass'), unb64(authPlain('юзер', 'пароль')).split('\0')], ['AHVzZXIAcGFzcw==', ['', 'юзер', 'пароль']]);
  eq('auth login', authLogin('u', 'p'), ['dQ==', 'cA==']);
  eq('dot stuff', [dotStuff('a\n.\nb'), dotStuff('.hidden'), dotStuff('a\r\nb'), dotUnstuff(dotStuff('.x\n..y'))], ['a\r\n..\r\nb', '..hidden', 'a\r\nb', '.x\r\n..y']);
  eq('data payload', [dataPayload('x'), dataPayload('x\r\n')], ['x\r\n.\r\n', 'x\r\n.\r\n']);
  const script = smtpScript({ helo: 'host.ge', from: 'a@x.ge', to: ['b@x.ge', 'c@x.ge'], message: plain, auth: { user: 'u', pass: 'p' }, starttls: true, size: plain.length });
  eq('script', script.map((s) => s.send.split(' ')[0] + (s.secret ? '*' : '')), ['EHLO', 'STARTTLS', 'EHLO', 'AUTH*', 'MAIL', 'RCPT', 'RCPT', 'DATA', script[8].send.split(' ')[0], 'QUIT']);
  ok('script size', script[4].send === `MAIL FROM:<a@x.ge> SIZE=${plain.length}`);
  throws('script injection', () => smtpScript({ from: 'a@x\r\nRCPT TO:<evil@x>', to: ['b@x'] }));

  console.log(`mail: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
