// knowledge-processor/strings.js - registers the editor's UI strings in the 7 UI languages (strings-<lang>.js, the same
// keys as strings-en.js). The reader's strings are in strings-reader.js.
//
// Why separate files per language: each dictionary is a plain data module, diffable and reviewable by a translator
// without touching code. All seven are imported eagerly: the editor is offline-first (no lazy fetch of a language),
// and the total is small. Registration is a side effect on import, so the entry module imports this file first.
import { addDicts } from '../ui/i18n.js';
import en from './strings-en.js';
import ru from './strings-ru.js';
import uk from './strings-uk.js';
import de from './strings-de.js';
import fr from './strings-fr.js';
import es from './strings-es.js';
import ka from './strings-ka.js';
import { PT_EDITOR } from '../portal/strings-editor.js';

addDicts({ en, ru, uk, de, fr, es, ka });
// Labels of the portal blocks (shared with the landing editor).
addDicts(PT_EDITOR);
