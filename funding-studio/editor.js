// funding-studio/editor.js - Funding Studio: registers the funding product (viewer.js) and its editor configuration
// (editor-config.js), then starts the document editor (studio/).
// Order matters: dictionaries first (side-effect registration, so the first rendered label is translated), then the
// product (viewer.js registers blocks/themes with doc/ on import), then the editor configuration and boot. The editor
// itself (studio/) is product-agnostic: everything funding-specific arrives through defineEditor.
import './i18n-en.js';
import './i18n-ru.js';
import './i18n-uk.js';
import './i18n-de.js';
import './i18n-fr.js';
import './i18n-es.js';
import './i18n-ka.js';
import * as V from './viewer.js';
import { TEMPLATES } from './templates.js';
import { FUNDING_EDITOR } from './editor-config.js';
import { addIcons } from '../ui/icons.js';
import { defineEditor } from '../studio/config.js';
import { startEditor } from '../studio/boot.js';

// Brand icon of the top bar: a heart over a rising bar.
addIcons({ logo: 'M12 13.5s-5-3-6.2-6.3C5 4.9 6.6 3 8.7 3c1.4 0 2.6.8 3.3 1.9C12.7 3.8 13.9 3 15.3 3c2.1 0 3.7 1.9 2.9 4.2C17 10.5 12 13.5 12 13.5zM4 21h16M6 21v-3M10 21v-5M14 21v-4M18 21v-6' });

defineEditor({ api: V, templates: TEMPLATES, ...FUNDING_EDITOR });

startEditor();
