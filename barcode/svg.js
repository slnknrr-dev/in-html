// barcode/svg.js - drawing of linear symbols (linear.js models): one layout in modules (bars with EAN guard
// extensions, add-on bars below their digits, bearer bars of ITF-14, the human-readable text in the EAN digit
// positions or centred), rendered as SVG markup or onto any canvas 2D context. The viewBox is in modules and the
// outer size is modules × `xdim` in px or mm, so prints keep the exact X-dimension.

//
// Why layout in modules: the module (narrowest bar) is the unit every barcode spec is written in; one layout then
// serves SVG (vector, any print size) and canvas (raster) without rounding twice. Rasterisation snaps bar EDGES to
// whole pixels (not widths), so neighbouring bars never overlap or leave hairline gaps - a scanner reads edges.

// Defaults per symbol family, in modules.
export const NOMINAL = {
  ean: { height: 69.24, guardExtra: 5, font: 8, gap: 0.5 },      // EAN-13 at 100 % : X 0.33 mm, bars 22.85 mm
  linear: { height: 50, font: 10, gap: 2 },
};

export const DEFAULT_FONT = "'OCR-B', 'OCR B', 'OCR-B 10 BT', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

/**
 * Layout of a symbol: { width, height, rects: [{ x, y, w, h }], texts: [{ x, y, text, size, anchor }] } in modules.
 *   height     bar height (modules; default per family)    guards   extend EAN guard bars (default true)
 *   text       show the human-readable text (default true) font     text size in modules
 *   textGap    gap between bars and text                   quiet    true | false | [left, right] (modules)
 *   bearer     'frame' | 'bars' | 'none' (ITF-14 default 'frame')     bearerWidth (modules, default 4)
 *   hri        override of the centred text                textAbove put centred text above the bars
 *   margin     extra space around everything (modules, default 0)
 */
export function barcodeLayout(sym, opts = {}) {
  const ean = sym.text === 'ean';
  const fam = ean ? NOMINAL.ean : NOMINAL.linear;
  const showText = opts.text !== false;
  const font = opts.font ?? fam.font;
  const gap = opts.textGap ?? fam.gap;
  const barH = opts.height ?? fam.height;
  const guardExtra = ean && opts.guards !== false ? (opts.guardExtra ?? fam.guardExtra) : 0;
  const margin = opts.margin ?? 0;
  const q = opts.quiet === false ? [0, 0] : Array.isArray(opts.quiet) ? opts.quiet : sym.quiet;
  const bearer = opts.bearer ?? sym.bearer ?? 'none';
  const bw = bearer === 'none' ? 0 : (opts.bearerWidth ?? 4);
  const rects = [], texts = [];

  // EAN: room above for add-on digits, the left / right digits outside the quiet zone are inside it.
  const addonTop = sym.addon && showText ? font + gap : 0;
  const centredAbove = !ean && showText && opts.textAbove;
  const top = margin + bw + Math.max(0, centredAbove ? font + gap : 0);
  const x0 = margin + bw + q[0];

  for (const b of sym.bars) {
    const inAddon = sym.addon && b.x >= sym.addon.x;
    if (inAddon) rects.push({ x: x0 + b.x, y: top + addonTop, w: b.w, h: barH + guardExtra - addonTop });
    else rects.push({ x: x0 + b.x, y: top, w: b.w, h: barH + (b.guard ? guardExtra : 0) });
  }

  let bottom = top + barH + guardExtra;
  if (showText) {
    if (ean) {
      const ty = top + barH + gap + font * 0.82;
      for (const l of sym.labels) {
        const size = l.small ? font * 0.72 : font;
        if (l.pos === 'above') texts.push({ x: x0 + l.x, y: top + font * 0.82, text: l.text, size, anchor: 'middle' });
        else texts.push({ x: x0 + l.x, y: l.small ? ty - (font - size) * 0.1 : ty, text: l.text, size, anchor: l.anchor });
      }
      bottom = Math.max(bottom, ty + font * 0.2);
    } else {
      const text = opts.hri ?? sym.hri;
      if (text) {
        const cx = x0 + sym.width / 2;
        if (centredAbove) texts.push({ x: cx, y: margin + font * 0.82, text, size: font, anchor: 'middle' });
        else { texts.push({ x: cx, y: top + barH + bw + gap + font * 0.82, text, size: font, anchor: 'middle' }); bottom = top + barH + bw + gap + font; }
      }
    }
  }
  const innerW = q[0] + sym.width + q[1];
  if (bw) {
    const y1 = top - bw, h = barH + 2 * bw;
    rects.push({ x: margin, y: y1, w: innerW + 2 * bw, h: bw, bearer: true });
    rects.push({ x: margin, y: y1 + h - bw, w: innerW + 2 * bw, h: bw, bearer: true });
    if (bearer === 'frame') {
      rects.push({ x: margin, y: y1, w: bw, h, bearer: true });
      rects.push({ x: margin + bw + innerW, y: y1, w: bw, h, bearer: true });
    }
    if (!showText || ean) bottom = Math.max(bottom, y1 + h);
  }
  // The EAN digit left of the start guard may stick out of a quiet zone that was turned off.
  // Text width is estimated as 0.62 em per character (OCR-B / monospace advance) - the layout cannot measure fonts,
  // so it reserves a monospace-sized box; proportional fallbacks only get narrower.
  let minX = margin;
  for (const t of texts) if (t.anchor === 'end') minX = Math.min(minX, t.x - t.size * 0.62 * t.text.length);
  const shift = minX < margin ? margin - minX : 0;
  if (shift) { for (const r of rects) r.x += shift; for (const t of texts) t.x += shift; }
  let maxX = margin + 2 * bw + innerW + shift;
  for (const t of texts) if (t.anchor === 'start') maxX = Math.max(maxX, t.x + t.size * 0.62 * t.text.length);
  return { width: maxX + margin, height: bottom + margin, rects, texts, x0: x0 + shift, top };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * SVG markup of a symbol.
 *   xdim   size of one module in `unit` (default 2 px; 0.33 for mm)   unit  'px' | 'mm' | 'in' | ''
 *   fg, bg colours (bg null = transparent)   fontFamily   title (accessible name)   plus barcodeLayout options
 *   widthReduction  bar width reduction in modules (print gain compensation, e.g. 0.05)
 */
// All bars go into ONE <path> (smaller than hundreds of <rect>s, one fill) with shape-rendering="crispEdges" so
// browsers do not anti-alias bar edges into grey. Bar width reduction shaves each bar symmetrically to compensate ink
// spread in print; bearer bars are exempt (they are not read). role="img" + <title> give the symbol an accessible
// name; every interpolated value is XML-escaped.
export function barcodeSVG(sym, opts = {}) {
  const L = barcodeLayout(sym, opts);
  const unit = opts.unit ?? 'px';
  const xdim = opts.xdim ?? (unit === 'mm' ? 0.33 : unit === 'in' ? 0.013 : 2);
  const fg = opts.fg ?? '#000000', bg = opts.bg === undefined ? '#ffffff' : opts.bg;
  const red = opts.widthReduction ?? 0;
  let d = '';
  for (const r of L.rects) {
    const w = Math.max(0.01, r.w - (r.bearer ? 0 : red));
    const x = r.x + (r.w - w) / 2;
    d += `M${r4(x)} ${r4(r.y)}h${r4(w)}v${r4(r.h)}h${r4(-w)}z`;
  }
  const font = esc(opts.fontFamily ?? DEFAULT_FONT);
  const texts = L.texts.map((t) => `<text x="${r4(t.x)}" y="${r4(t.y)}" font-size="${r4(t.size)}" text-anchor="${t.anchor}">${esc(t.text)}</text>`).join('');
  const W = r4(L.width * xdim), H = r4(L.height * xdim);
  const title = opts.title ?? `${sym.type}: ${sym.hri}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}${unit}" height="${H}${unit}" viewBox="0 0 ${r4(L.width)} ${r4(L.height)}" role="img" aria-label="${esc(title)}">`
    + `<title>${esc(title)}</title>`
    + (bg ? `<rect width="100%" height="100%" fill="${esc(bg)}"/>` : '')
    + `<path fill="${esc(fg)}" shape-rendering="crispEdges" d="${d}"/>`
    + (texts ? `<g fill="${esc(fg)}" font-family="${font}" letter-spacing="0">${texts}</g>` : '')
    + '</svg>';
}

/**
 * Draws a symbol onto a canvas 2D context at a whole number of pixels per module (sharp bars):
 *   ppm  pixels per module (default 3)   fg, bg, fontFamily, plus barcodeLayout options.
 * -> { width, height } in pixels (size the canvas with barcodeCanvasSize first).
 */
export function drawBarcode(ctx, sym, opts = {}) {
  const L = barcodeLayout(sym, opts);
  const ppm = opts.ppm ?? 3;
  const W = Math.ceil(L.width * ppm), H = Math.ceil(L.height * ppm);
  const bg = opts.bg === undefined ? '#ffffff' : opts.bg;
  ctx.save();
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = opts.fg ?? '#000000';
  for (const r of L.rects) ctx.fillRect(Math.round(r.x * ppm), Math.round(r.y * ppm), Math.round((r.x + r.w) * ppm) - Math.round(r.x * ppm), Math.round(r.h * ppm));
  for (const t of L.texts) {
    ctx.font = `${t.size * ppm}px ${opts.fontFamily ?? DEFAULT_FONT}`;
    ctx.textAlign = t.anchor === 'middle' ? 'center' : t.anchor === 'end' ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t.text, t.x * ppm, t.y * ppm);
  }
  ctx.restore();
  return { width: W, height: H };
}

export function barcodeCanvasSize(sym, opts = {}) {
  const L = barcodeLayout(sym, opts);
  const ppm = opts.ppm ?? 3;
  return { width: Math.ceil(L.width * ppm), height: Math.ceil(L.height * ppm) };
}

/** Physical size of a symbol in mm for an X-dimension (mm), with its quiet zones: { width, height, xdim }. */
export function physicalSize(sym, xdim = 0.33, opts = {}) {
  const L = barcodeLayout(sym, opts);
  return { width: L.width * xdim, height: L.height * xdim, xdim };
}

// EAN / UPC magnification: 80 % … 200 % of the nominal X-dimension 0.330 mm.
export const eanXdim = (magnification = 1) => 0.33 * magnification;
