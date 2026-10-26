# mail/

Email without sockets: address validation and canonicalisation, RFC 5322 address lists and `mailto:` links,
RFC 2047 / 2231 header encodings, MIME message building and reading (.eml), and the SMTP protocol as pure data
(reply parsing, capabilities, AUTH payloads, dot-stuffing, the command script of a transaction). Pure ES modules:
no DOM, no Node APIs, no clock or randomness (dates, message ids and boundaries come from the caller or are derived
from the content). Byte codecs come from `codec/` (base64, quoted-printable, punycode).

## Files

| file | contents |
|---|---|
| `address.js` | `canonEmail(s)` → `{ ok, address, local, domain, canonical, isGmail, plusTag }`, `isEmail`, `GMAIL_DOMAINS`, `RESERVED_LOCALS`, `isReservedLocal(local, extra)`, `matchBlocklist(email, patterns)`, `maskEmail`, `displayDomain`, `parseAddressList(text)` → `[{ name, address, group? }]`, `parseAddress`, `checkAddresses`, `formatAddress(address, name)`, `formatAddressList`, `addressesOf`, `mailtoLink({ to, cc, bcc, subject, body })`, `parseMailto` |
| `encoding.js` | `encodeHeaderText`, `encodeWords(text, { mode: 'B' \| 'Q' })`, `decodeWords`, `headerSafe`, `rfc2231`, `decode2231`, `base64Body`, `qpBody`, `is7bit`, `decodeBody(text, cte, binary)`, `decodeBytes(bytes, charset)`, `utf8`, `latin1Bytes`, `bytesLatin1` |
| `mime.js` | `buildMessage(model)` → .eml text, `envelopeOf(model)`, `parseMessage(text \| bytes)` → `{ headers, header(), subject, from, to, cc, replyTo, date, messageId, text, html, attachments, tree }`, `parseHeaders`, `parseHeaderParams`, `foldHeader`, `mailDate(date, offset)`, `parseMailDate`, `messageId(domain, random)`, `contentTypeOf(filename)`, `emlFileName(subject)` |
| `smtp.js` | `parseSmtpReply(buf)` → `{ code, text, lines, enhanced, rest } \| null`, `parseSmtpReplies`, `replyClass`, `isRetryable`, `enhancedStatus('5.1.1')`, `smtpCapabilities(ehlo)`, `authPlain`, `authLogin`, `authXOAuth2`, `dotStuff`, `dotUnstuff`, `dataPayload`, `smtpScript({ helo, from, to, message, auth, starttls, size })` |
| `test.js` | unit tests: `node mail/test.js` (importing it runs nothing) |

## Addresses (address.js)

- `canonEmail` is deliberately conservative: a dot-atom local part (≤ 64), an LDH domain of two or more labels
  (IDN domains are converted to `xn--`), no quoted local parts or IP literals — an address that confirms an
  account should be ordinary.
- The canonical form is a uniqueness key: Gmail drops dots and `+tag` and maps `googlemail.com` to `gmail.com`
  (all three spellings are one mailbox); other providers keep dots, and their `+tag` is reported, not removed.
- `isReservedLocal` compares without `.`, `-`, `_` and `+tag`, so `ad-min`, `a.d.m.i.n` and `admin+x` are
  caught; `matchBlocklist` tests the address and its canonical form (`^spam` catches `s.p.a.m@gmail.com`).
- `parseAddressList` understands quoted names, comments as names, groups (`Team: a@x, b@x;`), `mailto:` and
  encoded words. `formatAddress` encodes non-ASCII names, quotes names with specials and strips CR / LF, angle
  brackets and whitespace from the address.

## Messages (encoding.js, mime.js)

- Every header value goes through `encodeHeaderText` or `formatAddress`: CR / LF become spaces, so a subject or a
  name can never start a header line (header injection); custom headers cannot override From / To / Subject /
  Content-* / Bcc. Encoded words carry at most 45 UTF-8 bytes (≤ 75 characters) and never split a character;
  ASCII text containing `=?` is encoded too, so a reader cannot misinterpret it.
- Shapes: text only; text + HTML (`multipart/alternative`); HTML with inline images (`multipart/related`, referenced
  as `cid:`); any of these with attachments (`multipart/mixed`). Text parts use base64 (default), quoted-printable,
  or `'auto'` (7bit when possible). Attachment names get RFC 2231 (`filename*=UTF-8''…`); content types come from
  the extension. Bcc stays in the envelope (`envelopeOf`) unless `keepBcc`.
- Determinism: no `Date.now()` or random — `date`, `messageId` and `boundary` are inputs; without a boundary one
  is derived from the content (a part's content never contains its boundary in practice since base64 / QP lines
  cannot start with `--` + that text).
- `parseMessage` reads text or bytes: unfolding, encoded words in any charset `TextDecoder` knows, RFC 2231
  continuations, nested multiparts, base64 / QP / 7bit / 8bit bodies, raw UTF-8 headers when given bytes. The
  first text/plain and text/html parts become `text` / `html`; everything else is an attachment (inline ones
  marked).

## SMTP (smtp.js)

`parseSmtpReply` works on a growing buffer and returns `null` until a complete reply (the line with a space after the
code) has arrived; `rest` is what follows. `smtpCapabilities` returns STARTTLS, AUTH mechanisms (both `AUTH x y`
and `AUTH=x`), SIZE, PIPELINING, SMTPUTF8, 8BITMIME, DSN, CHUNKING. `smtpScript` lists the commands of one
transaction with the reply codes that let it continue (secrets marked, the DATA payload dot-stuffed and terminated);
addresses with CR / LF / angle brackets are refused. A transport (Node `net`/`tls`, a WebSocket relay) plays it.
