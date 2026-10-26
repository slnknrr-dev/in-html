# ui

**UI kit.** Shared UI of the editors and the single-page tools: DOM helpers, icons, UI dictionaries (`t`, `addDicts`, 7 languages), overlays (toasts, dialogs, menus, popovers), files, and the shell of single-page tools (`app.js` + `app.css`: header, pages, UI language, colour scheme, drop zones, downloads, form controls). Stylesheets: `base.css` (tokens, light / dark, controls, overlays), `app.css`.

| module | contents |
| --- | --- |
| `app.js` | the shell of a single-page tool built on ui/base.css + ui/app.css: header (brand, the pages of the application, UI language, colour scheme), offline badge, file drop zones, downloads, clipboard and a few form controls … |
| `contextmenu.js` | context menus of an area: right click, long press by touch / pen (instead of the text selection / callout), the Menu key and Shift+F10 open the same menu (overlays.js openMenu items); fields keep the browser menu unless asked. The lift after a long press activates nothing (neither the pressed element nor the menu item under the finger); only touch / pen echoes of a long press are suppressed (mouse menus may follow each other at once); keyboard-opened menus return focus to their target; `opts.label` names the menu; `detach.open(target, info)` opens it from code ("more" buttons). |
| `dom.js` | DOM helpers: $, $$, h (element builder), esc, clamp, debounce, caret helpers, localStorage helpers (lsGet / lsSet). |
| `files.js` | files: pickFiles, readFileB64, downloadBlob, MIME guessing, size formatting, safe file names. |
| `i18n.js` | UI string dictionaries of an application (editor chrome), t() lookup with plurals and {var} interpolation, UI language detection and static markup labels (data-i18n*). |
| `icons.js` | UI icons (24×24 stroke paths, currentColor) of the editors and tools. |
| `lang.js` | language helpers of the editor UI: tag validation, suggested languages, labels, month names, dates. |
| `overlays.js` | overlays: toasts, dialogs (open / confirm / prompt), menus and popovers on one layer stack (Escape, focus return). `openMenu(anchor, items, { className, focus, restoreFocus, onClose, label })`; `openPopover` `restoreFocus` is `true` (the anchor) or an element and takes focus back only from inside the popover. |
| `strings.js` | UI strings of the shared UI library (dialogs, errors) and of the application shell (ui/app.js), in the 7 UI languages of the repository. Applications add their own keys with addDicts. |
| `app.css` | layout of the single-page tools (ui/app.js): header, workspace (controls + stage), cards, drop zone, output panes and footer badge. |
| `base.css` | shared UI stylesheet of every application: design tokens (light / dark), base elements, controls, fields, collapsible sections, overlays (toasts, dialogs, menus, popovers), loading state. |

The header comment of each module documents its API.
