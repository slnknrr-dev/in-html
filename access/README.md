# access/

Permissions as data: roles with inheritance, grants of actions on sections with expiry, a data policy cascade
(open / medium / closed, "own" records) that explains which level decided, session scopes intersected with user rights,
need tokens for constructor-made UI, a module catalogue with dependencies and views, and layered configuration with
value sources and secret stripping. Pure functions over plain objects: storage, sessions and HTTP stay in the
application. Pure ES modules: no DOM at module evaluation, no platform APIs (`URLSearchParams` at call time only).
Ported from the KristinaHouse portal (session scope, right sets, host config) and the retail platform (roles,
member grants, data policy, modules), generalised.

## Files

| file | contents |
|---|---|
| `roles.js` | `normalizeGrants`, `roleChain`, `roleGrants`, `explainGrant`, `can`, `memberGrant`, `isLive`, `grantsWithin`, `canViewAs`, `objectAllowed`, `modulesOf`, `grantMatrix` |
| `policy.js` | `MODES`, `MODE_RULES`, `DEFAULT_MODE`, `definePolicy`, `resolvePolicy`, `explainRule`, `policyAccess`, `isOwn`, `canView`, `canEdit`, `allowed`, `filterVisible` |
| `scope.js` | `createScopeModel`, `FULL_SCOPE`, `normalizeScope`, `parseScope`, `scopeText`, `isFullScope`, `scopeWithin`, `scopeIntersect`, `scopeAllowsGroup`, `scopeDrops`, `scopeAllowsWrite`, `applyScope`, `effectiveRights`, `cleanTtlDays`, `cleanIdleSec`, `sessionAlive`, `shouldTouchSeen`, `isIdleSilent` |
| `tokens.js` | `tokenSet`, `hasToken`, `parseNeed`, `needMet`, `needAllMet`, `filterByNeed` |
| `modules.js` | `VIEWS`, `checkCatalog`, `withDeps`, `dependents`, `enableModule`, `disableModule`, `viewsFor`, `applyModules`, `moduleVisible`, `embedPoints` |
| `config.js` | `SECRETISH`, `stripSecrets`, `CLEANERS`, `defineConfig`, `normalizeLayer`, `mergeLayers`, `snapshotConfig`, `validateConfig`, `langInLocales`, `httpUrl`, `cleanLocales`, `normalizeHost`, `resolveHost` |
| `access.js` | everything above in one import |
| `test.js` | unit tests: `node access/test.js` (importing it runs nothing) |

## Roles and grants (roles.js)

- A role grants actions on sections: `{ catalog: ['view', 'edit'], pos: '*' }` (`'*'` / `true` = every action; an
  array of section names grants them whole). It inherits its parent's grants and may `revoke` some for itself and its
  children. Chains are cycle-safe and stop at a missing parent.
- `explainGrant(roles, id, section, action)` returns the levels where the answer changed; `grantMatrix(roles, sections,
  actions)` gives every cell with the role that granted or revoked it - the model of a permissions matrix designer.
- `memberGrant(member, { roles, extra, now })`: the membership, the role and the object list each have their own expiry
  (an expired role gives no sections, expired objects give no objects, an expired membership gives no access), extra
  grants add sections and objects; `lapsed` names what expired so the UI can say "ask to renew". Objects are the union
  of the lists, `null` anywhere meaning all objects.
- `canViewAs(viewer, target)`: owners may view as anyone; admins only as members whose grants and objects they cover.

## Data policy (policy.js)

`definePolicy({ entities: { receipts: { own: ['created_by', 'responsible'] } }, permissions: { 'sidebar.edit':
{ open: 'allow', medium: 'allow', closed: 'deny' } } })`. Modes: `open` sees and edits all, `medium` (default) sees all
and edits own, `closed` sees and edits own; "own" = the user's ref is in one of the entity's own-fields.
`resolvePolicy(model, [org, …roles root → leaf, member])`: the nearest level with a mode wins; action overrides
(`receipts.edit: 'own'`, `sidebar.edit: 'deny'`) apply from that level down - a mode set lower resets overrides above
it. Each rule keeps `from` (the deciding level or `'mode'`); `explainRule` lists every level with its mode, override,
whether that override was ignored, and which one decided.

## Session scopes (scope.js)

    effective rights = user rights ∩ session scope

A scope only removes: `panel` (groups the session may open; `null` = all, the `always` group is always added, choosing
every group stores `null` so new groups are not locked out), `drop` (named rights switched off - a drop list rather
than an allow list, so a right added later is visible and droppable), `readonly` (writes refused except
`readonlyAllow`, so signing out and narrowing still work). Stored as `''` when full (legacy rows and broken JSON read
as full). `scopeWithin(inner, outer)` is the ratchet: narrowing is one-way on every axis (note `drop` grows when
narrowing); `scopeIntersect` issues tickets that are never wider than the session issuing them. Lifetime: an absolute
expiry and an idle timeout; `shouldTouchSeen` limits activity writes to about once a minute, and `isIdleSilent` keeps
polling (paths, or a path + query parameter when the same path is also a user action) from extending a session.

## Need tokens (tokens.js)

A right set is a frozen list of tokens from a closed vocabulary, computed once per viewer and object. Blocks and
buttons made in a constructor carry `need: 'booking, lot:*'` - any one token shows them, `prefix:*` matches a family,
an unknown token matches nobody (a typo hides, never shows). `need` only narrows: `filterByNeed(items, set, needOf,
extra)` also checks the need of the door a button leads to. A null set means "not checked" (preview).

## Modules (modules.js)

A catalogue `{ id: { sections, deps, carriers, views, default, embeds } }`. `enableModule` adds dependencies,
`disableModule` removes the module and everything that depends on it (transitively; data stays). `viewsFor(catalog,
enabled, levels, preview)` cascades organisation → roles → member → a draft preview, accepting only views the module
supports, and records where each view came from; an embedded module with no visible carrier is reported `stranded`.
`applyModules` removes the sections of off and hidden modules (a hidden module gives no rights). `checkCatalog` finds
unknown dependencies or carriers, bad defaults and dependency cycles.

## Layered configuration (config.js)

`defaults → site → host` (any number of named layers). A layer is sparse: an absent key inherits, a present key
overrides even when empty (`''`, `false`, `{}`), `undefined` means untouched, unknown keys are dropped, values are
replaced whole (no deep merge, so "switch all modules back on" works). `snapshotConfig` says where each effective value
comes from and which layers it shadows - the "why is this the title on this domain" column. `defineConfig` refuses keys
that look like secrets, and `normalizeLayer` strips secret-looking keys at any depth (a token placed inside `seo` does
not survive): override layers are sent to the browser. Checks run on the merged values (`langInLocales`, `httpUrl`).
`resolveHost` answers an unknown or disabled host with the primary row and `matched: false`, so nothing is written on
behalf of a forged `Host`; `www.` is an alias unless a row of its own exists.

Password policy is not here: `../crypto/strength.js` covers it.
