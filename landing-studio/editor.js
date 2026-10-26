// landing-studio/editor.js - Landing Builder: registers the landing product (viewer.js) and its editor configuration
// (editor-config.js), then starts the document editor (studio/).
//
// Import order is semantic here: the i18n-*.js side-effect imports register dictionaries in order and later ones
// override earlier keys (addDicts merges with Object.assign), so product-specific dictionaries come after the generic
// language files. All dictionaries load before defineEditor / startEditor so the first render is already translated.
import './i18n-en.js';
import './i18n-ru.js';
import './i18n-uk.js';
import './i18n-de.js';
import './i18n-fr.js';
import './i18n-es.js';
import './i18n-ka.js';
import './i18n-blocks.js';
import './i18n-backend.js';
import './i18n-collection.js';
import './i18n-pages.js';
import './i18n-blocks-d.js';
import './i18n-portal.js';
import * as V from './viewer.js';
import { TEMPLATES } from './templates.js';
import { LANDING_EDITOR } from './editor-config.js';
import { addIcons } from '../ui/icons.js';
import { defineEditor } from '../studio/config.js';
import { startEditor } from '../studio/boot.js';

// The brand icon of the top bar: a browser window with a hero and a call to action.
addIcons({ logo: 'M3 4h18v16H3zM3 9h18M6.5 6.5h.01M9 6.5h.01M7 13h6M7 16h4M15.5 12.5h2.5v4h-2.5z' });

// Configuration first, then boot: startEditor reads ED (studio/config.js), so defineEditor must run before it.
defineEditor({ api: V, templates: TEMPLATES, ...LANDING_EDITOR });

startEditor();
