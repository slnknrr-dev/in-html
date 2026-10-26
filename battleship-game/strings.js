// battleship-game/strings.js - the UI strings of Sea Battle in the seven languages of the repository (en, ru, uk, de,
// fr, es, ka), one dictionary file per language with the same keys (strings.en.js is the reference).
// Imported first by main.js for its side effect, so the keys exist before any t() call. All languages are bundled
// statically: offline play and instant language switches, at the cost of shipping every dictionary.
import { addDicts } from '../ui/i18n.js';
import en from './strings.en.js';
import ru from './strings.ru.js';
import uk from './strings.uk.js';
import de from './strings.de.js';
import fr from './strings.fr.js';
import es from './strings.es.js';
import ka from './strings.ka.js';

addDicts({ en, ru, uk, de, fr, es, ka });
