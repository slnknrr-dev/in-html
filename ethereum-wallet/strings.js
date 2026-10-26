// ethereum-wallet/strings.js - the UI strings of the Ethereum wallet, one dictionary file per language with the same
// keys (strings-en.js is the reference), plus the shared wallet UI strings.
// Side-effect module: addDicts merges into the global i18n table, so it must load before any t() call (main.js imports
// it first). Shared wallet strings register first; app keys may then override them.
import '../walletui/strings.js';
import { addDicts } from '../ui/i18n.js';
import en from './strings-en.js';
import ru from './strings-ru.js';
import uk from './strings-uk.js';
import de from './strings-de.js';
import fr from './strings-fr.js';
import es from './strings-es.js';
import ka from './strings-ka.js';

// All languages bundled eagerly: the offline artifact cannot fetch dictionaries later, and the total is small.
addDicts({ en, ru, uk, de, fr, es, ka });
