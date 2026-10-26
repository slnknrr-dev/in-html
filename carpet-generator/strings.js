// carpet-generator/strings.js - the UI strings of Carpet Generator in the seven languages of the repository (en, ru,
// uk, de, fr, es, ka), one dictionary file per language with the same keys (strings.en.js is the reference).
// Imported for its side effect by main.js (first import), so the keys exist before any t() call. All seven languages
// are bundled statically: the app works offline and switches language without a fetch, at the cost of shipping
// every dictionary.
import { addDicts } from '../ui/i18n.js';
import en from './strings.en.js';
import ru from './strings.ru.js';
import uk from './strings.uk.js';
import de from './strings.de.js';
import fr from './strings.fr.js';
import es from './strings.es.js';
import ka from './strings.ka.js';

addDicts({ en, ru, uk, de, fr, es, ka });
