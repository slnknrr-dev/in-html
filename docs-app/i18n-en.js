// docs-app/i18n-en.js - docs editor UI strings: docs blocks, Markdown import / export and the app identity
// (English).
import { addDicts } from '../ui/i18n.js';

addDicts({
  en: {
    // app shell
    'app.name': 'Docs',
    'app.tagline': 'Offline documents with Markdown import and export',
    // files
    'files.empty': 'No files yet. Add images, PDFs or any file to attach to the document.',
    // block schema fields
    'f.lang': 'Language',
    'f.code': 'Code',
    'f.lineNumbers': 'Line numbers',
    'f.wrap': 'Wrap long lines',
    'f.depth': 'Heading levels',
    'f.numbered': 'Numbered',
    'f.look': 'Completed items',
    'f.done': 'Done',
    // options
    'o.boxes': 'Checked box',
    'o.strike': 'Checked box, struck through',
    // block types
    'b.code': 'Code', 'b.toc': 'Table of contents', 'b.checklist': 'Checklist',
    'bd.code': 'Source code with syntax highlighting and optional line numbers.',
    'bd.toc': 'Linked list of the document’s headings, updated automatically.',
    'bd.checklist': 'Tasks with check boxes.',
    // projects
    'pj.untitled': 'Untitled document',
    // open / save
    'io.badFile': 'This file is not a document project.',
    'io.typeOpen': 'Document, Markdown or exported page',
    'io.typeProject': 'Document project (.json)',
    // other formats
    'dx.md': 'Export Markdown (.md)',
    'dx.zip': 'Export Markdown with files (.zip)',
    'dx.txt': 'Export plain text (.txt)',
  },
});
