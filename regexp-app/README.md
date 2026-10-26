# Regex Studio (`regexp-app`)

A regular expression workbench that runs entirely in the browser and never touches the network. Built into one file:
`html@5_offline_singlefile/index.html` (`node singlefile.js regexp-app`). Development:
`node regexp-app/server.js`.

## Features

- **Pattern editor** with live syntax colours (a mirror layer under a transparent textarea, so the caret, selection,
  undo and IME stay native): escapes, classes, quantifiers, anchors, lookarounds, group parentheses and names in the
  colour of their group, matching bracket pairs at the caret, the error range underlined. Pasting a `/literal/flags`
  splits it into the pattern and the flags.
- **Flags** `d g i m s u v y` as toggles with explanations (u and v exclude each other).
- **Status and warnings**: the parser's error with its position (and a button that selects it), or the group count
  and names; static warnings (catastrophic backtracking risks, needless or misleading escapes, empty alternatives,
  unused flags…) that highlight their range on hover and select it on click.
- **Test text** with alternating match marks, the innermost capture group underlined in its colour, zero-length
  matches as thin bars, a tooltip with the groups of the match under the pointer and a details line for the match
  at the caret. Marks follow edits instantly and are refreshed by the next run.
- **Safe evaluation**: patterns run in a Worker created from a Blob URL with a 1 s limit; a runaway pattern is
  stopped, the page stays responsive and a banner explains the timeout (pointing at the risk warning when there is
  one). A run collects up to 5 000 matches; the table shows the first 500.
- **Views**: Matches (table with one column per group, click to select in the text, copy as JSON); Replace
  (template field with token buttons, highlighted result, copy, use as the new test text); Split (limit, captured
  parts marked); Explain (a tree of what every part does, synced both ways with the pattern); Diagram (railroad
  SVG, hover / click to find a part in the pattern, fit to width, download SVG or PNG); Code (JavaScript, Python, Go,
  Java, C#, PHP, Rust with flavour notes); Cheat sheet (tokens insert at the caret).
- **Library** in three tabs with search and categories. **Validators**: 62 strict validators of standard formats
  (RFC / ISO / IEEE: IPv4 / IPv6 forms, MAC variants, URI, email, dates with leap years, UUIDs, SemVer, IBAN, Base64…;
  anchored, no wildcards, named groups) that load with valid and invalid example lines. **Generators**: numbers
  (any digit alphabet with variant characters — bin, oct, dec, hex, scripts of many languages, your own — exact
  ranges such as uint8 … int64, signs, leading zeros, digit grouping, decimals, exponents, prefixes, find-in-text
  boundaries; live pattern, warnings and accepted / rejected examples) and word lists (prefix tree). **Examples**:
  30 patterns in 9 categories; each loads with a sample text (and a replacement or the
  Split view where that tells more).
- **Share** copies a link whose hash holds the pattern, flags, text (up to 4 000 characters) and replacement — nothing
  is uploaded; opening the link restores them. **Save** keeps named patterns; recently used valid patterns are
  remembered (localStorage: `regex-state`, `regex-saved`, `regex-history`; the shell uses `regex-ui`,
  `regex-theme`).
- 7 UI languages (en, ru, uk, de, fr, es, ka), light and dark, down to 380 px wide, keyboard accessible (tabs with
  arrow keys, focusable explanation rows and table rows, Enter to select).

## Files

| file | purpose |
|---|---|
| `index.html` | page skeleton, favicon |
| `main.js` | shell, layout, editors, flags, warnings, evaluation scheduling, tooltip, share / save / library actions |
| `editor.js` | highlighted editors (textarea + mirror), pattern and test-text markup, shifting marks across edits |
| `panels.js` | the seven views |
| `library.js` | library (validators, generators, examples) and saved-patterns dialogs |
| `generators.js` | number and word-list generator forms |
| `describe.js` | texts for errors, warnings, explanation nodes, flavour notes and diagram captions |
| `state.js` | state, persistence, share codes (`rx1.` + base64url JSON), saved patterns and history |
| `strings.js` | UI strings (`rx.*`) in 7 languages |
| `strings-library.js` | strings of the library tabs, validators and generators in 7 languages |
| `app.css` | styles |
| `server.js` | development server instance |

Parsing, explanations, diagrams, warnings, highlighting, evaluation, the library and code generation live in the
`regexp/` library.

## Limits

- The time limit is fixed at 1 s per run; very long texts (megabytes) are handled but the mirror redraw grows with
  the text.
- Replacement templates are strings (no replacement functions).
- Share links carry at most 4 000 characters of test text.
