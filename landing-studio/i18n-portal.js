// landing-studio/i18n-portal.js - editor labels of the portal blocks: the shared dictionary of ../portal/ (block
// names and descriptions, fields, hints, options, the palette category 'c.portal'; 7 languages).
//
// Contract: addDicts({ <lang>: { key: text } }) merges into ED_I18N with Object.assign, so a dictionary imported later
// overrides keys of earlier ones (the import order in editor.js is the precedence order). t(key) resolves UI language,
// then its primary subtag, then English, then humanize(key) (recorded in window.__edMissingKeys): English is the
// completeness reference, other languages may be partial. {name} placeholders are filled by t(key, vars).
// Data file: keys are grouped by the prefix before the first dot (the UI area or registry family they label); there
// is no logic here, so comments only mark groups.
import { addDicts } from '../ui/i18n.js';
import { PT_EDITOR } from '../portal/strings-editor.js';

addDicts(PT_EDITOR);
