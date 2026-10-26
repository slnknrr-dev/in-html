# Unit Converter

A fast converter for everyday, shop and real-estate units that runs in the browser without a network. One input reads
quantities as people type them in English, Russian and Georgian ("42,5 м²", "5'11\"", "3 sq ft", "1 ч 30 мин",
"85 კვ. მ") and shows the value in every unit of its kind. Printable cheat sheets are built on a second page.
Built on `units/` and `estate/`.

```bash
node unit-converter/server.js        # development server
node singlefile.js unit-converter    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e unit-converter/html@5_offline_singlefile/index.html unit-converter/e2e.js
node check.js e2e unit-converter/html@5_offline_singlefile/tables.html unit-converter/e2e.js
```

## Pages

- **Convert** (`index.html`):
  - A smart input: numbers with decimal commas or points, fractions, compounds of one kind; a bare number takes the
    unit from the list (which follows the last typed unit). Examples as chips; Enter adds the value to the history.
  - The main result in the counterpart unit of the chosen system (metric / US / imperial), compound forms (5 ft 11 in,
    1 h 30 min), both formulas (affine for temperatures), copy, swap and pin buttons.
  - Every unit of the kind; units of the chosen system highlighted (or shown alone), click to make a unit the target,
    copy per unit. Rounding: auto (two decimals from 1, four significant digits below) or 0–6 decimals.
  - Nearby values: a table of round values around the input.
  - Favourite pairs and the history (last 20) in local storage.
  - Helpers: price per unit (per kg / 100 g / l / 100 ml / m² / m / piece, US units when a US system is chosen, best
    offer and the difference in %), the area of a flat from its rooms (m², sq ft or width × length; total, without
    balconies, reduced with the 0.3 / 0.5 coefficients, room counts, layout kind and the Euro word), and number → word
    scales (walking distance steps of `units/scales.js`, Euro layout words of `estate/scales.js`).
- **Tables** (`tables.html`): a cheat sheet of several tables. Presets (m² ↔ sq ft, °C ↔ °F, kg ↔ lb, clothing cm → in,
  height cm → feet and inches, km ↔ mi, km/h ↔ mph, l → gal, g → oz, ares → acres) and custom tables with range, step,
  decimals, the reverse direction on round numbers and compound values. Print CSS (A4, 1–3 columns, rows never split)
  and copy as tab-separated text.

## Files

| file | contents |
|---|---|
| `index.html`, `tables.html` | the pages (hidden anchors `#pg-convert`, `#pg-tables` give the build the links) |
| `common.js` | shell, icons, labels and names in the UI language, the rounding rule, formulas, compound forms, unit picker, table element |
| `names.js` | unit names in Ukrainian, German, French and Spanish (the registry has en / ru / ka) |
| `main.js` | the converter page and its helpers |
| `tables.js` | the tables page |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout of both pages and the print sheet |
| `e2e.js` | in-page scenario for both pages |
| `server.js` | development server |

## Limits

Unit symbols come from `units/registry.js` in English, Russian and Georgian; Ukrainian, German, French and Spanish
pages show the international (English) symbols. Currency is not converted (rates change). "10 градусов" without a
scale is not guessed.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`.
