// docs-app/editor.js - Docs: registers the docs product (viewer.js) and its editor configuration (editor-config.js), then
// starts the document editor (studio/).
//
// Order matters: dictionaries first (side-effect imports register strings), then the product (viewer.js registers
// the document format), then the editor configuration; startEditor() runs last, when everything it reads exists.
import './i18n-en.js';
import './i18n-ru.js';
import './i18n-uk.js';
import './i18n-de.js';
import './i18n-fr.js';
import './i18n-es.js';
import './i18n-ka.js';
import * as V from './viewer.js';
import { TEMPLATES } from './templates.js';
import { DOCS_EDITOR } from './editor-config.js';
import { defineEditor } from '../studio/config.js';
import { startEditor } from '../studio/boot.js';

defineEditor({ api: V, templates: TEMPLATES, ...DOCS_EDITOR });

startEditor();
