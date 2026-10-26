// textile-studio/strings.js - registers the UI strings of Textile Studio in the seven languages of the repository
// (en, ru, uk, de, fr, es, ka), one dictionary file per language with the same keys (strings.en.js is the reference).
//
// Imported for its side effect FIRST by main.js: addDicts must run before any t() call, otherwise the first render
// shows humanized fallback labels. addDicts merges (Object.assign) into ED_I18N, so the shared ui/strings.js keys and
// these app keys coexist; a key defined in both would be overwritten by whichever registers later.
// Static imports of all seven files (not lazy import() per language): the single-file build inlines every module,
// and a language switch must work offline without a fetch.
import { addDicts } from '../ui/i18n.js';
import en from './strings.en.js';
import ru from './strings.ru.js';
import uk from './strings.uk.js';
import de from './strings.de.js';
import fr from './strings.fr.js';
import es from './strings.es.js';
import ka from './strings.ka.js';

addDicts({ en, ru, uk, de, fr, es, ka });
