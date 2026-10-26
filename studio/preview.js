// studio/preview.js - the preview overlay: the clean export in a sandboxed frame at the stage's preview widths.
//
// Why the real exporter and not the canvas: the canvas is edit-mode markup (chrome, contenteditable, blob URLs);
// only exportHTML shows what the reader will get, including scripts. Clean mode, no minify, no embedded source:
// the fastest export that is still behaviourally identical.
// Security: srcdoc iframe, sandbox WITHOUT allow-same-origin. srcdoc would otherwise inherit the editor's origin and
// the previewed page (user-authored HTML/JS) could read IndexedDB projects and window.parent. allow-scripts keeps the
// page interactive; allow-popups-to-escape-sandbox lets external links open as normal pages; allow-downloads lets
// attachment buttons work. Combining allow-scripts with allow-same-origin would void the sandbox entirely.
import { ED } from './config.js';
import { exportHTML } from '../doc/export.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { downloadBlob } from '../ui/files.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { overlays, popLayer, pushLayer, toast } from '../ui/overlays.js';
import { S, edKey } from './state.js';
import { fullDoc } from './doc.js';
import { flushRT } from './history.js';
import { radioRoving } from './fields.js';
import { exportFileName, exportOptsFor, openExport, runExport } from './export.js';
import { P } from '../doc/product.js';

// ===========================================================================
// 25. Preview overlay (iframe srcdoc of the clean export)
// ===========================================================================

// pv.fromExport: opened from the Export dialog, which stays open underneath — the bar's Export button only
// closes the preview (never a second Export dialog).
async function openPreview(expOpts, pv = {}) {
  flushRT();
  const ov = h('div', { class: 'ed-preview', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('pv.title') });
  const frame = h('iframe', { class: 'ed-preview-frame', title: t('pv.title'), sandbox: 'allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads' });
  const stage = h('div', { class: 'ed-preview-stage' }, frame);
  const widths = ED.stage.previewWidths();
  let cur = lsGet(edKey('pvw'), widths[0][0]);
  const seg = h('div', { class: 'ed-seg', role: 'radiogroup', 'aria-label': t('pv.width') });
  // Width is an inline style on the frame (not a class per width): widths come from the product at run time.
  // ed-framed draws the device frame only for non-default widths.
  const applyW = () => {
    const w = (widths.find((x) => x[0] === cur) || widths[0])[2];
    frame.style.width = w;
    stage.classList.toggle('ed-framed', cur !== widths[0][0]);
    for (const b of seg.children) { const on = b.dataset.k === cur; b.classList.toggle('ed-on', on); b.setAttribute('aria-checked', String(on)); }
  };
  for (const [k, ic, , lk] of widths) {
    seg.append(h('button', { type: 'button', class: 'ed-seg-btn', role: 'radio', dataset: { k }, onclick: () => { cur = k; lsSet(edKey('pvw'), k); applyW(); } }, iconEl(ic), t(lk)));
  }
  const layer = { el: ov, onEsc: () => close() };
  const close = () => { popLayer(layer); ov.remove(); };
  // The frame is sandboxed without allow-same-origin (the page must not reach the editor), so browsers do not run
  // their PDF viewer inside it: when the document embeds such previews, say so and offer the real file.
  let built = null;
  const pdfNote = h('span', { class: 'ed-preview-note', hidden: true },
    h('span', { class: 'ed-muted ed-hide-sm' }, t('pv.pdfHint')),
    h('button', {
      type: 'button', class: 'ed-btn ed-sm', title: t('pv.pdfHint'),
      onclick: async () => {
        try {
          // From the Export dialog: the file with the chosen options; otherwise the previewed page itself.
          const html = expOpts ? (await runExport(expOpts)).html : built;
          if (!html) return;
          const name = exportFileName(expOpts?.file);
          downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), name);
          toast(t('io.downloaded', { name }), 'ok');
        } catch (e) { toast(t('ex.err', { msg: e.message }), 'error'); }
      },
    }, iconEl('download'), t('pv.download')));
  ov.append(
    h('div', { class: 'ed-preview-bar' },
      h('strong', {}, t('pv.title')),
      h('span', { class: 'ed-muted ed-hide-sm ed-pv-hint' }, t('pv.hint')),
      pdfNote,
      h('span', { class: 'ed-spacer' }),
      seg,
      h('button', { type: 'button', class: 'ed-btn', onclick: () => { close(); if (!pv.fromExport) openExport(); } }, iconEl('export'), t('top.export')),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('pv.close'), 'aria-label': t('pv.close'), html: icon('close'), onclick: close })),
    stage);
  overlays().append(ov);
  pushLayer(layer);
  applyW();
  radioRoving(seg);
  try {
    // Opened from the Export dialog: its options (languages, product switches), but forced to clean / unminified /
    // no source, the parts that only change bytes, not behaviour. Otherwise all document languages.
    const o = expOpts ? { ...expOpts, mode: 'clean', minify: false, embedSource: false } : { mode: 'clean', minify: false, embedSource: false, langs: S.doc.langs.slice(), defaultLang: S.doc.defaultLang };
    const doc = fullDoc();
    const res = await exportHTML(doc, { ...exportOptsFor(o), source: doc });
    frame.srcdoc = res.html;
    built = res.html;
    // Detect embedded PDF <object>s by their product class in the generated HTML (cheaper than parsing a DOM).
    if (new RegExp('<object\\b[^>]*\\b' + P.prefix + '-att-obj\\b').test(res.html)) {
      pdfNote.hidden = false;
      ov.querySelector('.ed-pv-hint')?.setAttribute('hidden', '');
    }
  } catch (e) {
    console.error(e);
    stage.textContent = '';
    stage.append(h('p', { class: 'ed-error' }, t('ex.err', { msg: e.message })));
  }
  // Focus the close button after layout so keyboard users land inside the modal (aria-modal promise).
  requestAnimationFrame(() => { try { ov.querySelector('.ed-iconbtn')?.focus(); } catch { /* ignore */ } });
}

export {
  openPreview
};
