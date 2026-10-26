// pdf/pdf.js - the public surface of the PDF library in one import (the modules can also be imported one by one).
// Layering, bottom-up: standard.js (built-in font metrics) and ttf.js (TrueType parse / subset) -> font.js (shaping
// over a fallback stack) -> layout.js (wrapping, boxes, flow) and path.js (vector geometry) -> doc.js (objects,
// pages, serialisation). inspect.js is the reverse direction (reads PDFs, used by tests and debugging tools).
// Re-exports only: importing a single module avoids pulling the TrueType subsetter into a bundle that needs none.
export { PAGE_SIZES, PDFDocument, Page, cm, inch, mm, pageSize, parseColor, pdfText } from './doc.js';
export { StandardFont, TrueTypeFont, cleanText, lineMetrics, measureText, shapeText } from './font.js';
export { Flow, clipText, fitText, textBox, wrapText } from './layout.js';
export { arcPath, ellipsePath, parsePath, pathBounds, pathOps, polygonPath, rectPath } from './path.js';
export { imageKind, jpegInfo, prepareImage } from './image.js';
export { STANDARD_FONTS, standardWidth, winAnsiCode } from './standard.js';
export { buildTTF, glyphClosure, parseTTF, subsetTTF, tableChecksum, writeSFNT } from './ttf.js';
export { inspectPDF, parseCMap, tokenize } from './inspect.js';
