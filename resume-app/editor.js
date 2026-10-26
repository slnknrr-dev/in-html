// resume-app/editor.js - Resume Builder: registers the resume product (viewer.js) and its editor configuration
// (editor-config.js), then starts the document editor (studio/).
//
// Order matters: dictionaries first (side-effect imports registering strings), then the product (viewer.js
// registers its blocks with doc/ at import time), then defineEditor + startEditor. Static imports evaluate in order,
// so no async coordination is needed.
import './i18n-en.js';
import './i18n-ru.js';
import './i18n-uk.js';
import './i18n-de.js';
import './i18n-fr.js';
import './i18n-es.js';
import './i18n-ka.js';
import * as V from './viewer.js';
import { TEMPLATES } from './templates.js';
import { RESUME_EDITOR } from './editor-config.js';
import { defineEditor } from '../studio/config.js';
import { startEditor } from '../studio/boot.js';

defineEditor({ api: V, templates: TEMPLATES, ...RESUME_EDITOR });

startEditor();
