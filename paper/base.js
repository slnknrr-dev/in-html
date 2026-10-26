// paper/base.js - physical paper sizes of paper documents, in millimetres.
//
// Single source of truth for three consumers that must agree to the 0.1 mm: the editor stage (paper/editor.js
// paperStage(PAGE_SIZES) draws the sheet), the screen preview (paper/css.js varsCSS emits --pw / --ph) and the
// normalizer (paper/model.js accepts only these keys as page.size). The print path does NOT read w/h: @page size uses
// the CSS keywords A4 / letter / legal (paper/css.js printCSS), so the printer driver gets an exact named size instead of
// a rounded mm box. Adding a size therefore needs a keyword mapping in printCSS too, else it prints as A4.
// Letter / Legal are US inch sizes (8.5x11, 8.5x14 in) converted at 25.4 mm/in, hence the non-integer values.

const PAGE_SIZES = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
  Legal: { w: 215.9, h: 355.6 },
};

export {
  PAGE_SIZES
};
