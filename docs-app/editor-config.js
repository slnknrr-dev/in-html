// docs-app/editor-config.js - the docs editor: the paper-document editor (paper/editor.js) with the docs file extension,
// palette categories, block icons, Markdown / ZIP import and Markdown / ZIP / plain-text export.
//
// Importers are tried by file name; the ZIP importer needs the raw File (binary), the Markdown one the decoded text.
// Exporters return a string or a Blob; the shared editor handles the download.
import { PAPER_EDITOR } from '../paper/editor.js';
import { docToMarkdown, docToText, docToZip, markdownToDoc, zipToDoc } from './markdown-doc.js';

// File base name without the given extension (used as the document name of an imported file).
const baseName = (name, re) => String(name || '').replace(re, '');

export const DOCS_EDITOR = {
  ...PAPER_EDITOR,
  fileExt: 'doc',
  categories: ['text', 'layout', 'media'],
  typeIcons: { ...PAPER_EDITOR.typeIcons, code: 'terminal', toc: 'list', checklist: 'check' },
  importers: [
    {
      accept: '.md,.markdown',
      test: (name) => /\.(md|markdown)$/i.test(name),
      load: (text, name) => markdownToDoc(text, { name: baseName(name, /\.(md|markdown)$/i) }),
    },
    {
      // "Markdown with files" archives (this editor's own export or any folder of .md + images, zipped).
      accept: '.zip',
      test: (name) => /\.zip$/i.test(name),
      load: async (text, name, file) => (file ? zipToDoc(new Uint8Array(await file.arrayBuffer()), name) : null),
    },
  ],
  exporters: [
    { label: 'dx.md', icon: 'doc', ext: 'md', mime: 'text/markdown;charset=utf-8', build: (doc, o) => docToMarkdown(doc, o).md },
    { label: 'dx.zip', icon: 'layers', ext: 'zip', mime: 'application/zip', build: async (doc, o) => new Blob([await docToZip(doc, o)], { type: 'application/zip' }) },
    { label: 'dx.txt', icon: 'type', ext: 'txt', mime: 'text/plain;charset=utf-8', build: (doc, o) => docToText(doc, o) },
  ],
};
