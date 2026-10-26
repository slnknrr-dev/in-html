// image-processor/canvas.js - the browser canvas parts of the pipeline, usable in a worker (OffscreenCanvas)
// and on the page (<canvas>): platform decoding of formats without an own decoder (WebP, GIF first frame, BMP, AVIF,
// ...), WebP encoding, and rendering of the watermark text layer. Nothing runs at import time.

// OffscreenCanvas first: available in workers, where there is no document. The page fallback is a detached <canvas>.
export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

export const canvasAvailable = () => typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';

/** Platform decoding (EXIF orientation applied by the browser) -> { width, height, data }. */
// createImageBitmap decodes off the main thread in most engines and applies EXIF orientation by default
// (imageOrientation "from-image"). willReadFrequently hints the engine to keep the bitmap in CPU memory, which makes
// the following getImageData cheap.
export async function browserDecode(blob) {
  const bmp = await createImageBitmap(blob);
  const c = makeCanvas(bmp.width, bmp.height);
  if (!c) throw new Error('no canvas available');
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: d.data };
}

async function canvasBlob(c, type, quality) {
  if (c.convertToBlob) return c.convertToBlob({ type, quality });
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

/** WebP bytes through the canvas encoder, or null where the browser cannot encode WebP. */
// Feature detection by result: browsers without a WebP encoder silently return PNG from convertToBlob/toBlob, so
// the blob type is checked rather than trusting the request. The ImageData view reuses the pixel buffer (no copy).
export async function encodeWebP(img, quality) {
  const c = makeCanvas(img.width, img.height);
  if (!c) return null;
  const g = c.getContext('2d');
  g.putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.width * img.height * 4), img.width, img.height), 0, 0);
  const blob = await canvasBlob(c, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') return null;
  return new Uint8Array(await blob.arrayBuffer());
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

/**
 * Watermark text layer for a W x H image: { layer: { width, height, data }, x, y } or null.
 * wm: { text, position: tl | t | tr | l | c | r | bl | b | br | tile, size (% of the shorter side), color, shadow }.
 */
// The text is rendered once into a small layer (or a full-size layer for "tile") which the pipeline composites with
// alpha; the size is relative to the shorter image side so the mark looks the same on any resolution. Tile mode
// rotates -30 degrees and covers the rotated bounding circle (radius = half diagonal + one step) so no corner is
// left bare; odd rows are offset by half a step (brick pattern).
export function watermarkLayer(W, H, wm) {
  const text = String(wm.text || '').trim();
  if (!text) return null;
  const short = Math.min(W, H);
  const px = Math.max(6, Math.round((short * wm.size) / 100));
  const probe = makeCanvas(8, 8);
  if (!probe) return null;
  const pg = probe.getContext('2d');
  const font = `600 ${px}px ${FONT}`;
  pg.font = font;
  const tw = Math.ceil(pg.measureText(text).width), th = Math.ceil(px * 1.3);
  const pad = Math.ceil(px * 0.3);
  const style = (g) => {
    g.font = font; g.fillStyle = wm.color || '#ffffff'; g.textBaseline = 'middle';
    if (wm.shadow) { g.shadowColor = 'rgba(0, 0, 0, 0.55)'; g.shadowBlur = Math.max(1, px * 0.12); g.shadowOffsetY = Math.max(1, px * 0.04); }
  };
  if (wm.position === 'tile') {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d', { willReadFrequently: true });
    style(g);
    g.translate(W / 2, H / 2);
    g.rotate(-Math.PI / 6);
    const stepX = tw + px * 3, stepY = th + px * 2.5, R = Math.hypot(W, H) / 2 + stepX;
    for (let y = -R, row = 0; y <= R; y += stepY, row++) {
      for (let x = -R + (row % 2 ? stepX / 2 : 0); x <= R; x += stepX) g.fillText(text, x - tw / 2, y);
    }
    return { layer: { width: W, height: H, data: g.getImageData(0, 0, W, H).data }, x: 0, y: 0 };
  }
  const lw = tw + pad * 2, lh = th + pad * 2;
  const c = makeCanvas(lw, lh);
  const g = c.getContext('2d', { willReadFrequently: true });
  style(g);
  g.fillText(text, pad, lh / 2);
  const margin = Math.round(short * 0.03);
  const p = wm.position;
  const x = p[p.length - 1] === 'l' ? margin - pad : p === 'c' || p === 't' || p === 'b' ? Math.round((W - lw) / 2) : W - margin - lw + pad;
  const y = p[0] === 't' ? margin - pad : p === 'c' || p === 'l' || p === 'r' ? Math.round((H - lh) / 2) : H - margin - lh + pad;
  return { layer: { width: lw, height: lh, data: g.getImageData(0, 0, lw, lh).data }, x, y };
}
