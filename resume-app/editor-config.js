// resume-app/editor-config.js - the resume editor: the paper-document editor (paper/editor.js) with the resume's file extension,
// palette categories and block icons.
//
// Configuration by spread, not subclassing: PAPER_EDITOR is a plain object; the resume overrides a few fields and
// extends typeIcons. Any field the paper editor adds later is inherited automatically.
import { PAPER_EDITOR } from '../paper/editor.js';

export const RESUME_EDITOR = {
  ...PAPER_EDITOR,
  fileExt: 'resume',
  categories: ['resume', 'text', 'layout', 'media'],
  typeIcons: {
    ...PAPER_EDITOR.typeIcons,
    profile: 'user', contacts: 'mail', timeline: 'timeline', skills: 'skills', languages: 'languages', keyvalue: 'keyvalue',
  },
};
