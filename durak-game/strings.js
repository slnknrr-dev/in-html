// durak-game/strings.js - the UI strings of Durak in the seven languages of the repository (en, ru, uk, de, fr, es,
// ka), one dictionary file per language with the same keys (strings.en.js is the reference).
// One file per language (unlike smaller apps that keep all languages in one strings.js): ~800 keys each, so per-file
// diffs stay reviewable and a translator edits one file. Static imports, not dynamic: the single-file build must
// inline every language, and switching language must work offline without a fetch.
import { addDicts } from '../ui/i18n.js';
import en from './strings.en.js';
import ru from './strings.ru.js';
import uk from './strings.uk.js';
import de from './strings.de.js';
import fr from './strings.fr.js';
import es from './strings.es.js';
import ka from './strings.ka.js';

addDicts({ en, ru, uk, de, fr, es, ka });
