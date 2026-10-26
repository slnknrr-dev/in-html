// book-processor/lib.js - the book library functions the page exposes as window.__bk.lib (end-to-end
// scenarios generate, convert and check books in the page with exactly the code the application runs).
// Re-exports only: e2e scenarios must exercise the exact functions the UI runs, not test doubles.
export { readBook, writeBook, detectFormat, toJSON, fromJSON } from '../book/open.js';
export { sampleBook } from '../book/sample.js';
export { checkEpub, checkFB2, validateBook, checkText } from '../book/validate.js';
export { readingUnits, blockPlain, normalizeBook, bookStats } from '../book/model.js';
export { readFB2, writeFB2 } from '../book/fb2.js';
export { readEpub, writeEpub } from '../book/epub.js';
export { importFiles, saveToLibrary } from './io.js';
