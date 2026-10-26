// walletui/strings.js - registers the strings of the shared wallet UI in the seven languages of the repository.
// Side-effect module: importing it registers the keys, so UI modules import it once before calling t().
import { addDicts } from '../ui/i18n.js';
import en from './strings-en.js';
import ru from './strings-ru.js';
import uk from './strings-uk.js';
import de from './strings-de.js';
import fr from './strings-fr.js';
import es from './strings-es.js';
import ka from './strings-ka.js';

addDicts({ en, ru, uk, de, fr, es, ka });
