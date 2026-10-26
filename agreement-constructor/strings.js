// agreement-constructor/strings.js - the UI strings of Agreement Constructor in the seven languages of the repository
// (en, ru, uk, de, fr, es, ka), one dictionary file per language with the same keys (strings.en.js is the reference).
// The words of contracts and of their forms (party phrases, schedule tables, validation messages) are the contract
// language's, in contract/dict.js.
// One file per language (~220 keys each): a translator edits one file, and a diff touches one language. All are
// imported statically because the offline single-file build cannot lazy-load. A key missing in a language falls back
// to English in ui/i18n.js; a key missing even in English is recorded in window.__edMissingKeys (asserted by e2e.js).
import { addDicts } from '../ui/i18n.js';
import en from './strings.en.js';
import ru from './strings.ru.js';
import uk from './strings.uk.js';
import de from './strings.de.js';
import fr from './strings.fr.js';
import es from './strings.es.js';
import ka from './strings.ka.js';

addDicts({ en, ru, uk, de, fr, es, ka });
