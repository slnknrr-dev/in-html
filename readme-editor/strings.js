// readme-editor/strings.js - the UI strings of README Editor in the seven languages of the repository (en, ru,
// uk, de, fr, es, ka), one dictionary file per language with the same keys (strings.en.js is the reference).
// One file per language (unlike the single-file strings.js of smaller apps): this app has ~350 keys, so a translator
// edits one file without scrolling past six others, and a diff touches one language at a time. All seven are still
// imported statically: the app must work offline from one built file, so lazy-loading per language is not an option.
// Keys are namespaced by area ('file.', 'fmt.', 'ins.', 'tpl.', 'lint.' ...); a key missing in a language falls back
// to English in ui/i18n.js; a key missing even in English is recorded in window.__edMissingKeys, which e2e.js
// asserts to be empty.
import { addDicts } from '../ui/i18n.js';
import en from './strings.en.js';
import ru from './strings.ru.js';
import uk from './strings.uk.js';
import de from './strings.de.js';
import fr from './strings.fr.js';
import es from './strings.es.js';
import ka from './strings.ka.js';

addDicts({ en, ru, uk, de, fr, es, ka });
