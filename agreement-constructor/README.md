# Agreement Constructor (`agreement-constructor`)

Contract templates and filled documents in the browser: a bar of modifier buttons (power of attorney, additional
services, special terms, act of acceptance), levels (strictness: soft / standard / strict) and the contract language
above three panes — the library and the outline on the left, the live A4 contract in the middle (editable in place),
the fields extracted from the template text and the JavaScript validator on the right. The logic is the
[`contract/`](../contract/) library; the UI kit is [`ui/`](../ui/).

## Artifacts

Built from the NOTICE files (`node singlefile.js agreement-constructor`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | everything in one file with no network code: from disk, a phone, a USB stick |
| `html@5_serverless/` | the same editor as a static site; data stays in the visitor's browser |

There is no backend build: templates and documents live in IndexedDB (localStorage where it is missing), files leave
as downloads. Development: `node agreement-constructor/server.js [port]`.

## The page

- **Bar**: the name of the document or template and its template version; New (a document from any template, a blank
  template, a copy), Import, Edit text, Compile to HTML, Print, More (export template / document JSON, an HTML copy of
  the contract, Languages…, Template settings…). Below: the modifiers as toggle buttons, the levels as segmented
  choices, the contract language (★ main) and a second language side by side.
- **Left**: recent documents and templates with search (open, new document, rename, duplicate, delete, restore the
  built-in templates); the outline of the active contract with clause numbers, untranslated clauses marked; a click
  jumps to the clause.
- **Centre**: the contract on an A4 sheet scaled to the pane; placeholders are chips (empty ones show their label,
  fields with issues are underlined) and lead to their field. **Edit text** turns every clause into its template text
  with its condition (`when`), level variants, field insertion, reordering and its rendered preview; inactive clauses
  are shown dimmed; sections get their title, kind and condition.
- **Right**: the fields the active text reads, grouped (all of them with a switch): text, money, dates, the term,
  parties (person / organisation), document references (the power of attorney: notarial, simple written, agency
  agreement…), lists (additional services, occupants, inventory, meters), schedule settings, computed values. A
  placeholder typed into a clause becomes a field with a type guessed from its name; fields no text reads are listed.
  Every field's definition (id, type, labels and help per language, group, required, default, mask, ranges,
  currency, options, columns, document kinds, expression, schedule) opens from its id. Below: the checks — built-in
  ones and the template's JS validator (code edited here, run in a sandboxed worker with a time limit).
- **Versions**: a document refers to the version of its template; editing a template that other documents use moves
  it to a new version, and old documents keep theirs (an "Update" banner offers the latest).
- **Languages**: add a language (empty or from the main text), mark the main one, translation status per language;
  missing translations fall back to the main text and are marked.
- **Compile to HTML**: the template as one offline HTML fill-in page (its modifiers, levels, form, checks and JS
  validator, live contract, print CSS, language switch, local autosave, data as JSON), starting empty, with the
  example values or with the open document's values.
- **Print**: only the sheet, A4 with the template's margins, appendices on new pages, blank lines for empty fields.
- **Phones**: the panes become three tabs.

## Built-in templates

Residential lease (ru, en): parties, the flat and the title to it, term, rent with billing periods from the 23rd to
the 22nd and the last one ending the day before the move-out date, the payment schedule appendix, deposit,
utilities, obligations, special terms (pets, smoking, subletting, early termination, repairs), strictness variants of
the deposit, late fees, inspections and termination, a realtor acting under a power of attorney, additional services
with their appendix, the act of acceptance with inventory and meter readings, signatures, and a JS validator (state
registration of leases of a year, the authority expiring before the lease, the same person on both sides…). Also: a
services agreement, a receipt for a deposit (and the first month's rent), a simple power of attorney.

## Checks

```
node check.js tests contract
node check.js modules contract agreement-constructor
node check.js e2e http://127.0.0.1:8737/agreement-constructor/ agreement-constructor/e2e.js [--mobile --size 390x844]
node check.js e2e agreement-constructor/html@5_offline_singlefile/index.html agreement-constructor/e2e.js
```

## Limits

- Amounts in words: Russian, Ukrainian and English; other contract languages print digits.
- The built-in texts follow Russian practice and are examples, not legal advice.
- Clause texts are plain text with `**bold**`; there is no rich formatting inside clauses.
