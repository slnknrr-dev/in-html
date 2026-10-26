# schema/

Form and field schemas of catalogues, listings and inventories: typed fields with units, identifiers and conditions,
schemas inherited down a category tree with origin tracking, overlays by a second party, building → unit values,
rule-based titles and tags with per-language templates. Everything is data a person edits in a constructor (no code,
no expression engine) and plain functions that read it. Pure ES modules: no DOM at module evaluation, no platform APIs
(`Intl` is used at call time for number formatting). Ported from the KristinaHouse portal (market facts, tags, naming
rules) and the retail platform (category prototypes, showIf), generalised. Units, conversion and number-to-word scales
come from `../units/`, identifiers (MAC, IP, serial codes) from `../util/ident.js`, dates from `../contract/dates.js`.

## Files

| file | contents |
|---|---|
| `fields.js` | `FIELD_TYPES`, `IDENT_TYPES`, `TYPE_META`, `FIELD_ROLES`, `normalizeField`, `normalizeFieldDef`, `normalizeShowIf`, `fieldPatch`, `checkValue`, `validateValues`, `isEmptyValue`, `fieldVisible`, `valueText`, `fieldsFor`, `fieldsWithRole`, `fieldApplies`, `fieldGroups`, `sortFields`, `normalizeMac`, `normalizeIp`, `normalizeCode`, `normalizeIdent`, `compactIdent` |
| `inherit.js` | `resolveSchema(chain)` (inherit / override / hide, origin, definedAt, trail, values), `normalizeOverlay`, `applyOverlay`, `overlayRefused`, `inheritValues(levels)`, `mergeByKey` |
| `rules.js` | `COND_OPS`, `COND_OP_NAME`, `normalizeCond`, `condMatches`, `condsMatch`, `renderTemplate`, `templateVars`, `templateScales`, `normalizeRule(s)`, `ruleMatches`, `buildRuleTitle`, `traceRules`, `rulesVars`, `mainText` |
| `tags.js` | `normalizeTagDef`, `normalizeTagField`, `normalizeTagValues`, `tagFieldText`, `tagText`, `tagLinkUrl`, `inheritMarks`, `tagIndexTokens`, `parseTagTokens`, `tagTokenGroup`, `tagsCollide`, `tagCompare`, `migrateTagValues`, `SAFE_LINK` |
| `text.js` | `cleanKey`, `cleanFieldKey`, `i18n`, `pick`, `slugList` |
| `schema.js` | everything above in one import |
| `test.js` | unit tests: `node schema/test.js` (importing it runs nothing) |

## Fields (fields.js)

- Types: `text`, `longtext`, `number` (registry `unit` converted on input, or a free `unitText`; `min`, `max`,
  `decimals`, `scale`), `range` (`[from, to]`, either end may be empty), `select`, `multiselect`, `date` (ISO; `DD.MM.YYYY`
  input is accepted through `../contract/dates.js`), `bool`, and identifiers `mac` / `bssid` (→ `AA:BB:CC:DD:EE:FF`),
  `ip` (IPv4 without leading zeros, IPv6 in RFC 5952 form), `serial` / `inventory` (letters, digits, `- _ / . #`).
  `compactIdent` gives the search form (`aa-bb` finds `AA:BB:…`).
- `checkValue(field, v)` returns `{ value, error }`; errors are codes (`required`, `not_number`, `min`, `max`,
  `not_option`, `not_date`, `range_order`, `not_bool`, `too_long`, `mac`, `ip`, `serial`, `inventory`), never text.
  An empty value of an optional field is fine and stays `null`: "not set" differs from zero.
- `validateValues(fields, input, { inherited, scope })` skips fields hidden by `showIf`, never takes a `computed`
  field from input, and treats an inherited value or a default as satisfying `required`.
- `showIf` is a list of conditions of `rules.js` (all must hold) or the legacy `{ key, equals }` / `{ key, in }`.
- `roles` say where a field takes part (`form`, `filter`, `card`, `tile`, `room`, or a custom word); `applies` names the
  contexts (deal, intent, …) a field makes sense in, empty meaning everywhere; `group` + `groupLabel` build form
  sections (the first non-empty label of a group wins, ungrouped fields come last).
- `fieldPatch(raw, { locked, owner })` keeps only touched properties ("not touched" ≠ "cleared") and drops locked ones
  (`key`, `type`, `computed`) unless the editor owns the schema: keys are where stored values, filters and links live.
- Contract templates keep their own field kinds (party, docref, period, schedule) in `../contract/fields.js`.

## Inheritance (inherit.js)

`resolveSchema([{ id, name, fields, values }, …])` walks root → leaf. A level adds fields, overrides properties of an
inherited field (a property it does not set is inherited), or hides one (`{ key, hidden: true }`; redefining it lower
starts a new field). Every field records `origin` (where it was introduced), `definedAt` (last level that touched it),
`overridden` and a `trail` of `{ at, set: [properties] }` - the answer to "why does this router have this field".
Level values (model defaults) come back as `{ key: { value, from } }`; definition errors are reported per level instead
of throwing. `inheritValues` does the same for building → unit values: an absent key inherits, `null` clears.

An overlay (`{ own, over }`) is applied at display time: labels, hints and order of the schema's fields can be changed
and fields hidden - except required ones, which stay - and own fields added unless their key is taken.
`overlayRefused` lists what did not apply and why, for the settings screen.

## Rules and titles (rules.js)

- Six operators: `is` (one of; `''` in the list also means "not set"), `not`, `min`, `max` (exactly one number), `has`,
  `none`. Zero is a value, `false` and `''` are not; `'2'` equals `'2.0'`; a list value matches by any member.
- Templates: `{key}` and `{key:scale}` (the raw number through a scale: `{size:euro}` → "Euro-two"). The segment rule
  drops a segment between `·`, `,`, `—`, `|` whose substitution is empty, so a missing area removes "· m²" with it.
- `buildRuleTitle(rules, values, varsFor, { scales, fallback, srcLang })`: rules in order, a disabled rule never fires,
  the first rule whose conditions hold and that rendered in the source language wins (a rule without that language
  wins with any); then the fallback template; `rule` is the index, -1 for the fallback, -2 for nothing.
  `traceRules` returns every rule with each condition's result and the rendered texts - the data of a rule tester.

## Tags (tags.js)

A tag type has up to six fields and text variants per language; the first variant whose variables are all set is
shown, then the label. Links are built in one pass (a value containing `%p` stays text), and only `http(s):`, `tel:`,
`mailto:` come out. A unit inherits the marks of its building, can switch one off (`off`) and override field values one
by one. Search tokens: `t12` (has the tag), `t12.mall.metrocity` (select option), `t12.dist~0` (scale step); one group
is OR-ed, groups are AND-ed. Two types collide by key or by a label in any language; `migrateTagValues` moves values
to another type by key and kind, options by code or label, numbers through units, and names what it dropped.

## Units and scales

Number fields and tag fields name a unit of the `../units/` registry (`m2`, `m`, `kg`, `c`, …): input given as
`{ value, unit }` in another unit of the same kind is converted on entry (1000 ft → 304.8 m), values are stored at full
precision and formatted with `formatQuantity` only when shown. A unit label the registry does not know (`days`, `pcs`)
stays a free `unitText` and is never converted. `{key:scale}` in templates and `scale` on tag fields use the scales of
`../units/scales.js` (`exact` words per value or `upto` steps, with one optional "otherwise" step that may print `{n}`).
