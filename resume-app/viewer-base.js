// resume-app/viewer-base.js - resume constants: version, UI languages, contact kinds, language levels.

// Kept in a dependency-free module so the editor, the exported runtime and the dictionaries can import the
// constants without pulling in the renderer.
const VERSION = '1.0.0';
const UI_LANGS = ['en', 'ru', 'de', 'fr', 'es', 'uk', 'ka'];
const CONTACT_KINDS = ['email', 'phone', 'web', 'location', 'linkedin', 'github', 'codeberg', 'gitlab',
  'telegram', 'whatsapp', 'x', 'mastodon', 'skype', 'birth', 'other'];
// CEFR levels, most fluent first: the order used in pickers.
const LANG_LEVELS = ['native', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1'];
// 6-segment scale for bars/dots: A1=1 ... C2=6, native=6 (full). Native is not "above" C2 on the CEFR scale;
// drawing it as a seventh step would suggest a level that does not exist.
const LEVEL_STEPS = { native: 6, C2: 6, C1: 5, B2: 4, B1: 3, A2: 2, A1: 1 };

export {
  CONTACT_KINDS,
  LANG_LEVELS,
  LEVEL_STEPS,
  UI_LANGS,
  VERSION
};
