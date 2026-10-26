# Mail Composer

Compose, inspect and fix e-mail messages as `.eml` files in the browser without a network: nothing is ever sent.
Addresses are checked as you type, subjects and names in any script are encoded (RFC 2047), the body is written as
Markdown, rich text or plain text with a generated plain-text alternative, inline images travel in
`multipart/related` and attachments with RFC 2231 names; a mail merge turns a CSV table into a ZIP of messages.
Built on `mail/`, `markdown/`, `html/`, `csv/`, `zip/` and `ui/`.

```bash
node mail-composer/server.js        # development server
node singlefile.js mail-composer    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e mail-composer/html@5_offline_singlefile/index.html mail-composer/e2e.js
```

## Pages

- **Compose** (`index.html`):
  - From / To / Cc / Bcc / Reply-To accept commas, semicolons and new lines; every entry becomes a chip: invalid,
    duplicate across the recipient fields, the same Gmail mailbox written differently (dots, `+tag`, googlemail.com),
    IDN domains and their ASCII form. A toggle masks the addresses on screen.
  - The subject shows its encoded header. Body: Markdown (toolbar, `![x](cid:…)` images), rich text (contenteditable,
    pasted HTML sanitised) or plain text; the plain-text alternative is generated or written by hand.
  - Files: drop / paste / pick; images can be marked inline (cid) and inserted into the body; names are editable.
  - Options: X-Unsent: 1 (Outlook opens the file as a draft), Date, Message-ID, priority, transfer encoding, Bcc kept
    or not, custom headers (reserved names refused, line breaks neutralised).
  - Mail merge: CSV (pasted or dropped, delimiter sniffed), address and name columns guessed, `{{column}}` and
    `{{column|fallback}}` placeholders everywhere, a preview row, a ZIP of one `.eml` per valid row.
  - Stage: preview (sandboxed frame), source, structure (the built message parsed back by the inspector), findings.
    Exports: `.eml`, ZIP, `mailto:` (only without files, with the reasons shown), copy source, open in the inspector.
- **Inspect** (`inspect.html`): an `.eml` dropped, picked, pasted or handed over: decoded subject and addresses,
  findings (missing Date / Message-ID / MIME-Version, visible Bcc, Reply-To on another domain, raw 8-bit headers,
  long lines, bare LF, remote images…), the HTML body in a `sandbox` srcdoc frame with a CSP that allows only data:
  images (cid: parts inlined, links inert), the text body, attachments to download, the MIME tree with every part
  savable, headers decoded next to their raw form, the source. "Edit as new" copies the message into the composer.
- **Tools** (`tools.html`): header injection demo (naive vs sanitised), encoded words both ways (B / Q),
  base64 / quoted-printable with charsets, an SMTP transcript reader (reply classes, enhanced status codes,
  EHLO capabilities, AUTH payloads masked, the DATA section), a dot-stuffing preview, an address checker with
  canonical and masked forms.

## Files

| file | contents |
|---|---|
| `index.html`, `inspect.html`, `tools.html` | the pages (hidden anchors `#pg-compose`, `#pg-inspect`, `#pg-tools` give the build the links) |
| `message.js` | pure logic: address fields and analysis, merge templates, body rendering with cid: kept through the sanitizers, HTML → text, the message model, mailto eligibility, SMTP transcripts, checks of a received message, drafts from messages |
| `common.js` | shell, icons, IndexedDB store, tabs, findings, the sandboxed preview, the inspector |
| `main.js`, `inspect.js`, `tools.js` | the three pages |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout of the three pages |
| `e2e.js` | in-page scenario: Georgian subject + attachment → encoded subject, multipart/mixed, RFC 2231 name, subject read back |
| `server.js` | development server |

## Targets and limits

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`,
both audited for zero network use. The draft stays in local storage, its files and the page hand-over in IndexedDB.
Outlook `.msg` files are not read. The rich editor is a small app-local contenteditable (execCommand), not the
`richtext/` editor, which needs the document engine.
