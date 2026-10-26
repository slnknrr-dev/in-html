// media-player/strings.js - the UI strings of the media player in the seven languages of the repository (en, ru, uk,
// de, fr, es, ka), one dictionary file per language with the same keys (strings.en.js is the reference).
import '../ui/strings.js';
import { addDicts } from '../ui/i18n.js';
import en from './strings.en.js';
import ru from './strings.ru.js';
import uk from './strings.uk.js';
import de from './strings.de.js';
import fr from './strings.fr.js';
import es from './strings.es.js';
import ka from './strings.ka.js';

addDicts({ en, ru, uk, de, fr, es, ka });
