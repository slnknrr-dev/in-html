# Catalog Rules

A designer and tester of catalogue schemas, listing titles and tags, working in the browser without a network. A
category tree defines fields that are inherited, overridden and hidden down the tree; title rules turn field values
into listing titles in Georgian, Russian and English; tag templates give tag texts, links and search tokens; sample
objects show which rule wins and why. Built on `schema/` (fields, inheritance, rules, tags), `units/` (units and
scales) and `csv/`. The demos come from the Batumi portal's title rules and tags and the retail platform's category
prototypes.

```bash
node catalog-rules/server.js        # development server
node singlefile.js catalog-rules    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e catalog-rules/html@5_offline_singlefile/index.html catalog-rules/e2e.js
```

## Pages

- **Schema** (`index.html`):
  - A category tree of any depth (Real estate → Apartments → New builds; Goods → Dairy → Milk): add a child or a top
    level node, reorder, delete with descendants, rename the identifier (conditions and samples follow).
  - Field definitions of the selected node: new fields, overrides of inherited fields (an empty property keeps the
    inherited value) and hidden fields. Type, trilingual label, unit (a registry unit is converted on input, any other
    label is shown only), min / max / decimals, options (`code = English | Русский | ქართული`), required, default,
    group and group title, order, and `showIf` conditions with the six operators.
  - Default values of the node (`key = value`), inherited by subcategories and samples.
  - The resolved schema: every field with its origin, the node that last overrode it and the trail of levels with the
    properties each one set; hidden fields, inherited defaults and definition errors.
  - A live form generated from the resolved schema: groups, `showIf` visibility, unit choice with conversion,
    validation messages per field, the stored (normalised) values, and "add as a sample".
- **Rules** (`rules.html`):
  - Title rules in order (first match wins): note, on / off, conditions, templates `ka` / `ru` / `en` with unknown
    variable warnings; the source language; a fallback template.
  - Scales for `{key:scale}` (a word per number, or steps "up to N" with an "otherwise" step) with a tester.
  - Tag templates: key, label, icon, colour, up to six fields (number with unit and scale, text, select), text variants
    and a link template.
  - Samples: an editable table (category, every field key, tags as `sea dist=150 walk=2; mall name=metro_city`,
    expected title) with the computed title and winning rule; CSV import (columns by key or by field label in any
    language) and export.
  - Tracer of the selected sample: titles in three languages, the expected-title check, invalid values, every rule
    with each condition's result and actual value, rendered texts and its state (winner, matched too late, empty in the
    source language, no match, off), the fallback, tags with texts, links and search tokens, and the values with their
    origin (sample or category default) and template variables.
- Both pages: a project card with the two demos (Batumi real estate, grocery catalogue), JSON export / import and a new
  project. The project is kept in local storage and shared by the pages (and other tabs).

## Variables

Templates see every field (option labels for selects, numbers without their unit), `{category}` (the node name) and
`{path}` (names root → leaf). Conditions see raw values: option codes, numbers, `category` (the node id) and `path`
(the ids of the chain, so `path is dairy` holds for milk and cheese).

## Files

| file | contents |
|---|---|
| `index.html`, `rules.html` | the pages (hidden anchors `#pg-schema`, `#pg-rules` give the build the links between them) |
| `engine.js` | the project model and its evaluation without DOM: normalisation, tree, resolved schemas, rule sets, samples (values, titles, trace, tags), CSV |
| `demos.js` | the two seeded projects |
| `common.js` | the shell, icons, the stored project, the project card, the condition editor, trilingual inputs |
| `main.js` | the schema page |
| `rules.js` | the rules page |
| `strings.js` | UI strings in the 7 UI languages |
| `app.css` | layout of both pages |
| `e2e.js` | in-page scenario: demo, overridden field origin, required error, showIf, unit conversion, expected title, winning rule, tokens, fallback |
| `server.js` | development server |

## Library gaps worked around here

- `schema/normalizeFieldDef` does not carry `decimals` and `groupLabel` of a level, so `resolveSchema` drops them;
  `engine.js` `resolveNode` re-applies them from the raw definitions (nearest level wins).
- `buildRuleTitle` renders the fallback template in the source language only; the other languages are rendered with
  `renderTemplate`.
- `normalizeRules` drops rules without templates and `normalizeCond` drops invalid conditions, which shifts indices;
  rules are normalised one by one and mapped back to the editor's order.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`.
