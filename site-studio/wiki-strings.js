// site-studio/wiki-strings.js - registers the editor's UI strings in the 7 UI languages (strings-<lang>.js, the same
// keys as strings-en.js). The reader's strings are in strings-reader.js.
import { addDicts } from '../ui/i18n.js';
import en from './wiki-strings-en.js';
import ru from './wiki-strings-ru.js';
import uk from './wiki-strings-uk.js';
import de from './wiki-strings-de.js';
import fr from './wiki-strings-fr.js';
import es from './wiki-strings-es.js';
import ka from './wiki-strings-ka.js';
import { PT_EDITOR } from '../portal/strings-editor.js';

// Side-effect module: imported for registration before any t() call. en is the fallback in ui/i18n.js, so a key
// missing in another language shows English rather than the raw key.
addDicts({ en, ru, uk, de, fr, es, ka });
// Labels of the portal blocks (shared with the landing editor).
addDicts(PT_EDITOR);
