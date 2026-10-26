# Access Designer

Design and explain the access model of a multi-tenant business system without a network: roles with inheritance and
revokes, a permission matrix where every cell names the role that granted or revoked it, members with personal grants
and expiry dates, "view as", a data visibility policy (open / medium / closed, own records) with an explanation trail,
a module catalogue with dependencies and cascading views, session scopes with lifetime checks, and layered site
configuration with value sources and secret stripping. Everything is project data: sections, actions, roles, entities,
modules and config keys are edited in the UI. Start from an empty project (one owner role) or a demo preset: a retail
system demo (a software system for retail businesses; its sample organisation is a shop chain), a regional portal and
marketplace (Batumi: sellers, agencies, listings, bookings, moderation, blog, forum), a clinic, a multi-tenant SaaS admin. Built on `access/`, `diagram/`, `csv/` and `ui/`.

```bash
node access-designer/server.js        # development server
node singlefile.js access-designer    # builds html@5_offline/ and html@5_offline_singlefile/
node check.js e2e access-designer/html@5_offline_singlefile/index.html access-designer/e2e.js
```

## Pages

- **Roles** (`index.html`):
  - The role tree (keyboard: arrows), adding top and child roles, deleting (children and members move to the parent).
  - The grant editor of a role: every section × action cycles grant → revoke → left to the parent; "all" per section;
    dots show what the parent already gives; revokes that change nothing (a parent grants "all") are warned about.
  - Sections and actions of the model (add, rename, remove).
  - The permission matrix of roles or members (`grantMatrix`): granted here, inherited, revoked, expired, not granted.
    It scrolls inside its card and is one roving-focus grid. A selected cell is explained (`explainGrant`): the verdict,
    the source role, and every level of the chain with what it grants or revokes.
  - The inheritance diagram (`diagram/`): the chain of the selected role is highlighted; nodes select roles.
  - Members (`memberGrant` at a simulated date): role, membership, role and object expiries, objects (all or a list),
    personal grants with sections, actions, objects and expiry; lapsed parts are named ("ask to renew").
  - View as (`canViewAs`): allowed or not and why (owner, missing admin view, wider rights or objects), and a
    preview of the target's rights after the modules of their views.
- **Policies** (`policies.html`): modes, entities with own-fields, permissions per mode; the cascade organisation →
  roles → member with a mode and overrides per level; the resolved rules with the deciding level (`resolvePolicy`),
  the trail of one rule (`explainRule`: modes, overrides, ignored overrides) and sample records seen / editable.
- **Modules** (`modules.html`): switches with cascades (`enableModule` / `disableModule`, reported), dependencies,
  carriers, sections and default view per module, catalogue problems (`checkCatalog`), the dependency diagram, and the
  views of a member through organisation → roles → member → draft preview (`viewsFor`) with stranded embedded
  modules, embed points and the sections hidden modules take away (`applyModules`).
- **Sessions** (`sessions.html`): effective rights = member rights ∩ scope (panel groups, dropped rights, read-only),
  the stored scope text, a ticket from the session (`scopeIntersect`, `scopeWithin`), the read-only write check with
  its allowlist, and the lifetime (TTL, idle timeout, activity writes, polls that are not activity) on a simulated
  clock.
- **Config** (`config.html`): default → site → host layers as JSON with dropped and stripped keys, host rows and the
  row a `Host` header resolves to (`resolveHost`), the snapshot of every key with its source and shadowed layers
  (`snapshotConfig`), and checks on the merged values.

Every page has the project card: JSON export / import (format version 2; format 1 projects are migrated on load and
import), the matrix as CSV (formula-injection safe), printable documentation, a new empty project and the presets.
Modules are added, renamed and deleted (dependants are warned about; dependency cycles are refused), entities are
added and renamed with their own-fields, config keys are added with a type and a secret flag.

## Files

| file | contents |
|---|---|
| `index.html`, `policies.html`, `modules.html`, `sessions.html`, `config.html` | the pages (hidden anchors `#pg-*` give the build the links between them) |
| `common.js` | the shell, icons, the project in localStorage, labels, bridges to `access/` (member access, policy and view levels, scope model), widgets |
| `presets.js` | the project format (version 2) and the presets as data: empty, retail system, portal, clinic, SaaS admin |
| `doc.js` | the project card, the matrix CSV and the printable documentation |
| `configmodel.js` | the configuration schema from the project (types, secret keys), layer losses and the snapshot |
| `main.js`, `policies.js`, `modules.js`, `sessions.js`, `config.js` | the pages |
| `strings.js`, `strings-more.js`, `strings-presets.js` | UI strings and seeded preset names in the 7 UI languages |
| `app.css` | layout, matrix, trails, print |
| `e2e.js` | in-page scenario: inherited grant source, revoke explained, lapsed personal grant, view as, module cascade, session scope narrowing |
| `server.js` | development server |

## Limits

- A revoke of one action under a parent that grants "all" of a section does nothing (`access/roles.js`); the editor
  and the explanation mark such revokes as ignored.
- `effectiveRights` applies only the drop list; panel groups and read-only are applied by the page (a right's group
  is its section, writes are every action but "view").
- `canViewAs` and the policy library use the fixed verbs `view` / `edit`; the project's read action is used everywhere else.

## Targets

`OFFLINE_NOTICE.md` and `SINGLEFILE_OFFLINE_NOTICE.md` select `html@5_offline/` and `html@5_offline_singlefile/`.
Both are audited for zero network use: the pages work from `file://`. The project stays in the browser's local
storage.
