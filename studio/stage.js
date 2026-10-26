// studio/stage.js - canvas stage modes chosen by the product (ED.stage): a paper page (print documents: page size
// from document settings, page count estimate) or device widths (web pages: the canvas is exactly as wide as the
// chosen device, the page lays out through container queries).
//
// A stage: { baseWidth() → unscaled canvas px, maxZoom, apply(canvas), measure?(), statusItems() → elements,
//   bar?() → stage bar controls, previewWidths() → [[key, icon, css width, label key], ...], init?() }
import { own } from '../util/value.js';
import { P } from '../doc/product.js';
import { $$, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { S, canvas, edKey } from './state.js';
import { walk } from './doc.js';

// CSS px per mm: CSS defines 1in = 96px = 25.4mm regardless of the screen, so this is exact for layout and print.
export const MM_PX = 96 / 25.4;

// Paper: canvas = page width + 64 px gutter (#ed-canvas in studio/editor.css); pages estimated from the height.
export function paperStage(pageSizes) {
  const size = () => own(pageSizes, S.doc?.page?.size) || { w: 210, h: 297 };
  const stage = {
    maxZoom: 2,
    baseWidth: () => size().w * MM_PX + 64,
    apply(cv) { cv.style.setProperty('--ed-page-w', size().w + 'mm'); },
    // Page count estimate: content height (unzoomed: divided by S.zoom since the canvas is scaled) over the printable
    // height. An estimate only, the browser paginates at print time. At least breaks + 1 because each forced break
    // starts a page even when the content is short; the -4 px tolerance keeps rounding from adding a phantom page.
    measure() {
      const page = canvas.querySelector('.' + P.prefix + '-page');
      if (!page || !S.doc) return;
      const ps = size();
      const m = S.doc.page.margin || { top: 14, bottom: 14 };
      const contentH = Math.max(50, ps.h - (+m.top || 0) - (+m.bottom || 0)) * MM_PX;
      const cs = getComputedStyle(page);
      const hgt = page.getBoundingClientRect().height / (S.zoom || 1) - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      let breaks = 0;
      walk((b) => { if (b.type === 'pagebreak' || b.breakBefore) breaks++; });
      S.pages = Math.max(1, Math.ceil((hgt - 4) / contentH), breaks + 1);
    },
    statusItems: () => [h('span', { class: 'ed-st-item' }, iconEl('paper'), t('st.pages', { n: S.pages || 1 }))],
    previewWidths: () => [['desktop', 'monitor', '100%', 'pv.desktop'], ['mobile', 'phone', '390px', 'pv.mobile'],
      ['paper', 'paper', Math.round(size().w * MM_PX + 48) + 'px', 'pv.paper']],
  };
  return stage;
}

// Device widths: devices = [[key, width px, icon], ...] (the first one is the default).
export function deviceStage(devices) {
  const width = (k = S.device) => (devices.find((d) => d[0] === k) || devices[0])[1];
  const sync = () => {
    for (const b of $$('#ed-device [data-k]')) {
      const on = b.dataset.k === S.device;
      b.classList.toggle('ed-on', on);
      b.setAttribute('aria-checked', String(on));
    }
  };
  const stage = {
    maxZoom: 1,
    // Persisted device validated against the current list: a product may drop a device between versions.
    init() { S.device = lsGet(edKey('device'), devices[0][0]); if (!devices.some((d) => d[0] === S.device)) S.device = devices[0][0]; },
    baseWidth: () => width(),
    apply(cv) { cv.style.setProperty('--ed-canvas-w', width() + 'px'); cv.style.setProperty('--ed-vw', width() + 'px'); cv.dataset.device = S.device; },
    statusItems: () => [h('span', { class: 'ed-st-item' }, iconEl((devices.find((d) => d[0] === S.device) || devices[0])[2]), t('dev.px', { w: width() }))],
    // Stage bar: one radio per device (setDevice re-sizes the canvas; the caller wires it to applyCanvasSize).
    bar(onPick) {
      const seg = h('div', { id: 'ed-device', class: 'ed-seg ed-seg-ic', role: 'radiogroup', 'aria-label': t('dev.group') });
      for (const [k, w, ic] of devices) {
        seg.append(h('button', {
          type: 'button', class: 'ed-seg-btn', role: 'radio', dataset: { k }, title: `${t('dev.' + k)} · ${t('dev.px', { w })}`,
          'aria-label': t('dev.' + k), onclick: () => { stage.set(k); onPick(); },
        }, iconEl(ic)));
      }
      queueMicrotask(sync);
      return seg;
    },
    set(k) {
      S.device = devices.some((d) => d[0] === k) ? k : devices[0][0];
      lsSet(edKey('device'), S.device);
      sync();
    },
    // The default device previews at 100%: the preview frame fills the overlay instead of a fixed width.
    previewWidths: () => devices.map(([k, w, ic]) => [k, ic, k === devices[0][0] ? '100%' : w + 'px', 'dev.' + k]),
  };
  return stage;
}
