// photo/cmdpanel.js - the editor's "Transform · ImageMagick" panel: the whole document as one ImageMagick command (or a
// script of steps) for bash or cmd.exe (photo/magick.js). The operations of the selected layer are listed with their
// arguments; the command text is cut into pieces that know their layer or history step, so pointing at a piece
// highlights the layer (layers panel, outline on the picture), clicking selects it, and the selected layer's pieces are
// highlighted. Notes explain approximations. Copy, line wrapping, save as .sh (set -e) / .bat (% doubled), download the
// files the command reads (ZIP: the PNG files of painted layers and masks plus both scripts). Text only: the page never
// runs these commands.
//
//   const p = createMagickPanel(ed)    p.el   p.render()   p.highlight()   p.state -> { shell, form, wrap }
//   p.model -> the last docCommand result (or null)      p.words(ref) -> the plain words of a piece

// Design rules:
// - The panel is a projection of ed.command() (magick.js docCommand): it holds no document state of its own, only the
//   view options (shell, single command vs steps, wrap) persisted in localStorage.
// - Pieces carry refs; selection and hover marking toggle classes on existing spans (highlight()), so pointer
//   movement never rebuilds the long command text.
// - Command generation errors are shown in the panel instead of thrown: a bug in one exotic layer must not break the
//   whole editor.
import './magick-strings.js';
import { copyText, download, seg, t, toast } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { writeZip } from '../zip/zip.js';
import { quote } from '../cmdline/quote.js';
import { ADJUSTMENTS } from './adjust.js';
import { commandText, refWords, scriptFile } from './magick.js';

const FORMATS = [{ v: 'png', l: '=PNG' }, { v: 'jpeg', l: '=JPEG' }, { v: 'webp', l: '=WebP' }];
const isWin = () => /win/i.test((typeof navigator !== 'undefined' && navigator.platform) || '');

/** Plain words of an argv piece as one line in a shell. */
export const quoteWords = (words, shell) => (words || []).map((w) => quote(w, shell)).join(' ');

export function createMagickPanel(ed) {
  const st = ed.st;
  const K = 'photo-cmd';
  const state = { shell: lsGet(K + '-shell', isWin() ? 'cmd' : 'bash'), form: lsGet(K + '-form', 'single'), wrap: lsGet(K + '-wrap', true) };
  if (!['bash', 'cmd'].includes(state.shell)) state.shell = 'bash';
  if (!['single', 'steps'].includes(state.form)) state.form = 'single';
  const el = h('div', { class: 'pm' });
  let model = null, words = new Map(), text = '', pre = null;

  const set = (k, v) => { state[k] = v; lsSet(K + '-' + k, v); render(); ed.refresh('history', 'props', 'layers'); };

  /** Localized label of an operation of photo/magick.js. */
  function opLabel(op) {
    const v = op.vars || {};
    switch (op.key) {
      case 'step': return Array.isArray(v.label) ? t(v.label[0], v.label[1]) : String(v.label || t('pm.op.stepAny'));
      case 'shape': return t('pm.op.shape', { type: t('ph.shape.' + v.type) });
      case 'adjust': case 'noChange': return t('pm.op.' + op.key, { type: t('ph.adj.' + v.type) });
      case 'blend': return t(v.kind === 'fx' || v.kind === 'fxAlpha' ? 'pm.op.blendFx' : 'pm.op.blend', { mode: t('ph.blend.' + v.mode) });
      case 'mix': return t(v.kind === 'fx' ? 'pm.op.mixFx' : 'pm.op.mix');
      case 'output': return t(v.format === 'PNG' ? 'pm.op.outputPng' : 'pm.op.output', v);
      default: return t('pm.op.' + op.key, v);
    }
  }
  const noteText = (n) => {
    const v = { ...(n.vars || {}) };
    if (n.code.startsWith('step:')) return t('cmd.note.' + n.code.slice(5));
    if (v.mode) v.mode = t('ph.blend.' + v.mode);
    if (n.code === 'painted') {
      v.list = Object.entries(v.counts || {}).map(([k, c]) => `${t('ph.paint.' + k)} × ${c}`).join(', ');
      return t(v.source ? 'pm.note.painted' : 'pm.note.paintedBlank', v);
    }
    return t('pm.note.' + n.code, v);
  };
  const refName = (ref) => {
    if (!ref || ref === 'doc') return t('pm.canvas');
    if (ref === 'out') return t('pm.output');
    const L = ed.layerOfRef(ref);
    return L ? L.name : ref;
  };
  /** Comment line of a script step. */
  const comment = (s) => {
    if (s.ref === 'doc') return t('pm.sc.canvas', { w: s.w, h: s.h });
    const L = ed.layerOfRef(s.ref);
    const what = L ? (L.kind === 'adjust' ? t('ph.adj.' + L.adjust.type) : t('ph.kind.' + L.kind)) : '';
    const extra = L && L.kind !== 'adjust' && L.blend !== 'normal' ? ', ' + t('ph.blend.' + L.blend) : '';
    const op = L && L.opacity < 1 ? `, ${Math.round(L.opacity * 100)} %` : '';
    return `${s.name || refName(s.ref)} (${what}${extra}${op})`;
  };
  const head = () => t('pm.scriptHead', { name: st.name });

  function render() {
    // Not mounted yet (mode switch pending): skip the work, the first show renders. The scroll position is kept across
    // re-renders so live edits do not jump the command back to the top.
    if (!el.isConnected && !el.parentNode) return;
    const scroll = pre ? pre.scrollTop : 0;
    if (!st.doc) { model = null; words = new Map(); el.replaceChildren(h('p', { class: 'ed-hint ph-pane-empty' }, t('pm.empty'))); return; }
    try { model = ed.command(); } catch (e) { model = null; el.replaceChildren(h('p', { class: 'ed-hint' }, t('pm.error', { msg: String((e && e.message) || e) }))); return; }
    words = refWords(model);
    const r = commandText(model, state.shell, { form: state.form, wrap: state.wrap, comment });
    text = r.text;
    const L = ed.active();
    const selRef = L ? 'L' + L.id : null;

    // intro and controls
    const intro = h('div', { class: 'pm-intro' }, iconEl('terminal'), h('p', {}, t('pm.intro')));
    const ctl = h('div', { class: 'pm-ctl' },
      seg([{ v: 'bash', l: '=bash' }, { v: 'cmd', l: '=cmd.exe' }], state.shell, (v) => set('shell', v), 'pm.shell'),
      seg([{ v: 'single', l: 'pm.single' }, { v: 'steps', l: 'pm.steps' }], state.form, (v) => set('form', v), 'pm.form'),
      h('button', { type: 'button', class: 'ed-iconbtn pm-wrap' + (state.wrap ? ' ed-on' : ''), 'aria-pressed': String(!!state.wrap), title: t('pm.wrap'), 'aria-label': t('pm.wrap'), onclick: () => set('wrap', !state.wrap) }, iconEl('wrapLines')),
      seg(FORMATS, st.export.format, (v) => { ed.setExport({ format: v }); }, 'pm.format'));

    // the selected layer's operations
    const ops = selRef ? model.ops.get(selRef) || [] : [];
    // KNOWN DEFECT (dead code): `recipe` is computed and discarded (`void`), costing a scan of all op keys per render.
    // Fix: delete both lines, or list the recipe steps' operations as intended.
    const recipe = selRef ? [...model.ops.keys()].filter((k) => k.startsWith(selRef + ':')) : [];
    void recipe;
    const fid = ops.some((o) => o.fidelity === 'approx') ? 'approx' : 'exact';
    const opsBox = h('section', { class: 'pm-ops', 'aria-label': t('pm.opsOf', { name: L ? L.name : '' }) },
      h('div', { class: 'pm-ops-h' }, iconEl(L ? (L.kind === 'adjust' ? ADJUSTMENTS[L.adjust.type].icon : L.kind === 'text' ? 'type' : L.kind === 'shape' ? 'shapes' : 'image') : 'image'),
        h('b', {}, L ? L.name : t('pm.whole')), L && ops.length ? h('span', { class: 'ph-badge ph-fid-' + fid }, t('pm.fid.' + fid)) : null));
    if (!L) opsBox.append(h('p', { class: 'ed-hint' }, t('pm.pickHint')));
    else if (!L.visible) opsBox.append(h('p', { class: 'ed-hint' }, t('pm.hidden')));
    else if (!ops.length) opsBox.append(h('p', { class: 'ed-hint' }, t('pm.noOps')));
    for (const o of ops) {
      opsBox.append(h('div', { class: 'pm-op' + (o.fidelity === 'approx' ? ' pm-op-approx' : '') },
        h('span', { class: 'pm-op-l' }, opLabel(o)), o.args.length ? h('code', {}, quoteWords(o.args, state.shell)) : null));
    }

    // notes
    const notes = model.notes;
    let noteBox = null;
    if (notes.length) {
      const list = h('ul', { class: 'pm-notes' });
      for (const n of notes) {
        const li = h('li', { class: n.ref === selRef ? 'pm-on' : '' }, iconEl(n.code === 'painted' || n.code === 'fonts' ? 'info' : 'approx'), h('span', {}, noteText(n)));
        const target = ed.layerOfRef(n.ref);
        if (target) {
          li.tabIndex = 0; li.setAttribute('role', 'button');
          li.addEventListener('click', () => ed.selectRef(n.ref));
          li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ed.selectRef(n.ref); } });
          li.addEventListener('mouseenter', () => ed.hoverRef(n.ref));
          li.addEventListener('mouseleave', () => ed.hoverRef(null));
        }
        list.append(li);
      }
      noteBox = h('details', { class: 'pm-notebox', open: notes.length <= 3 || notes.some((n) => n.ref === selRef) || lsGet(K + '-notes', false) || null },
        h('summary', {}, iconEl('info'), t('pm.notes', { n: notes.length })), list);
      noteBox.addEventListener('toggle', () => lsSet(K + '-notes', noteBox.open));
    }

    // tools and the command
    const nFiles = model.assets.length;
    const tools = h('div', { class: 'pm-tools' },
      h('button', { type: 'button', class: 'ed-btn ed-primary ed-sm', onclick: () => copyText(text, t('cmd.copied')) }, iconEl('copy'), t('cmd.copy')),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: saveScript }, iconEl('download'), t(state.shell === 'cmd' ? 'pm.saveBat' : 'pm.saveSh')),
      h('button', { type: 'button', class: 'ed-btn ed-sm', title: t('pm.zipHint'), onclick: saveFiles }, iconEl('archive'), t('pm.zip', { n: nFiles })),
      h('span', { class: 'ed-spacer' }),
      h('span', { class: 'pm-meta' }, `${model.width} × ${model.height} · ${model.output}`));
    pre = h('pre', { class: 'pm-pre' + (state.wrap ? '' : ' pm-nowrap'), tabindex: '0', 'aria-label': t('pm.command') });
    const code = h('code', {});
    for (const p of r.pieces) {
      if (!p.ref) { code.append(p.text); continue; }
      code.append(h('span', { class: 'pm-p' + (match(p.ref, selRef) ? ' pm-hl' : ''), dataset: { ref: p.ref } }, p.text));
    }
    pre.append(code);
    // Event delegation on the <pre>: one listener instead of one per piece. A click that ends a text selection (the
    // user is copying part of the command) must not also select a layer, hence the getSelection check.
    pre.addEventListener('click', (e) => { const s = e.target.closest('[data-ref]'); if (s && !String(window.getSelection && window.getSelection()).length) ed.selectRef(s.dataset.ref); });
    pre.addEventListener('mouseover', (e) => { const s = e.target.closest('[data-ref]'); ed.hoverRef(s ? s.dataset.ref : null); });
    pre.addEventListener('mouseleave', () => ed.hoverRef(null));
    const files = nFiles ? h('p', { class: 'pm-files' }, iconEl('image'), h('span', {}, t('pm.filesList', { n: nFiles })), ...model.assets.map((a) => h('code', { class: 'pm-file', dataset: { ref: a.ref }, onmouseenter: () => ed.hoverRef(a.ref), onmouseleave: () => ed.hoverRef(null), onclick: () => ed.selectRef(a.ref) }, a.name))) : null;
    const src = st.doc.recipe && st.doc.recipe.source;
    const footer = h('p', { class: 'ed-hint pm-foot' }, t('pm.footer', { src: src && src.name && !src.blank && words.has('L' + st.doc.bgId) && (words.get('L' + st.doc.bgId) || []).includes(src.name) ? src.name : t('pm.theFiles') }));
    el.replaceChildren(...[intro, ctl, opsBox, noteBox, tools, pre, files, footer].filter(Boolean));
    pre.scrollTop = scroll;
    highlight();
  }

  // the selected layer's pieces (a layer owns its recipe steps 'L<id>:…')
  const match = (ref, selRef) => !!selRef && (ref === selRef || ref.startsWith(selRef + ':'));

  /** Re-marks the selected and hovered pieces without rebuilding. */
  function highlight() {
    if (!pre) return;
    const L = ed.active(), selRef = L ? 'L' + L.id : null, hov = st.hoverRef;
    let first = null;
    for (const s of el.querySelectorAll('[data-ref]')) {
      const on = match(s.dataset.ref, selRef);
      s.classList.toggle('pm-hl', on);
      s.classList.toggle('pm-hover', !!hov && (s.dataset.ref === hov || s.dataset.ref.startsWith(hov + ':')));
      if (on && !first && s.classList.contains('pm-p')) first = s;
    }
    if (first) {
      const pr = pre.getBoundingClientRect(), sr = first.getBoundingClientRect();
      // Scroll inside the <pre> only (never scrollIntoView, which would also scroll the page or the side panel), with
      // 24 px of context above the first marked piece; pr.height 0 means hidden, where rects are meaningless.
      if (pr.height && (sr.top < pr.top || sr.bottom > pr.bottom)) pre.scrollTop += sr.top - pr.top - 24;
    }
  }

  function saveScript() {
    if (!model) return;
    const ext = state.shell === 'cmd' ? 'bat' : 'sh';
    const body = scriptFile(model, state.shell, { form: state.form, wrap: state.wrap, comment, head: head() });
    download(new Blob([body], { type: 'text/plain' }), `${st.name}-magick.${ext}`);
  }

  /** The PNG files the command reads and both scripts, as one ZIP. */
  // Both scripts go into the ZIP regardless of the chosen shell: the archive may be run on another machine. PNGs are
  // stored uncompressed in the ZIP (already deflated).
  async function saveFiles() {
    if (!model) return;
    const c = model;
    const zip = await ed.busy(t('pm.zipping'), async () => {
      const files = [];
      for (const a of c.assets) files.push({ name: a.name, data: await ed.assetPNG(a), store: true });
      const o = { form: state.form, wrap: state.wrap, comment, head: head() };
      files.push({ name: `${st.name}-magick.sh`, data: scriptFile(c, 'bash', o) }, { name: `${st.name}-magick.bat`, data: scriptFile(c, 'cmd', o) });
      return writeZip(files);
    });
    download(new Blob([zip], { type: 'application/zip' }), `${st.name}-magick.zip`);
    toast(t('pm.zipSaved', { n: c.assets.length }), 'ok');
  }

  return {
    el,
    render,
    highlight,
    get state() { return { ...state }; },
    get model() { return model; },
    get text() { return text; },
    words: (ref) => words.get(ref) || null,
    opLabel,
  };
}
