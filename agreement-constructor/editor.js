// agreement-constructor/editor.js - the centre pane: the contract on an A4 sheet (scaled to the pane), placeholders
// as chips that lead to their fields; in edit mode every clause becomes its template text in a textarea (the contract
// language; a level variant when the clause has variants) with its condition, level binding, field insertion,
// reordering and its rendered preview right below, sections get their title, kind and condition, and inactive parts
// are shown dimmed so they can be edited too.
//
//   const editor = mountEditor(root)   editor.render()   editor.fit()   editor.jump(elementId)   editor.scrollTop()
//
// Two modes over one rendering: read mode shows S.result.html (rendered by main.js), edit mode renders the contract
// with hidden parts visible and then replaces each clause element with an editor whose live preview is the clause's
// own rendering. Edits go through A.changeTemplate(mutator, opts), which applies the mutator to the template and
// persists it; `quiet` edits (typing) skip the global re-render so the textarea keeps focus, while structural edits
// (`now`: move, add, delete, condition) re-render everything.
// Security: the HTML comes from contract/render.js, which escapes every field value (html/escape.js, plus '*' so a
// value cannot trigger **bold** markup); template text is the author's own content.
import { h, debounce } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { openMenu, toast } from '../ui/overlays.js';
import { langLabel } from '../ui/lang.js';
import { renderContract } from '../contract/render.js';
import { parseText } from '../contract/syntax.js';
import { parseExpr } from '../contract/expr.js';
import { labelOf } from '../contract/fields.js';
import { SECTION_KINDS } from '../contract/model.js';
import { PAGE_SIZES } from '../paper/base.js';
import { uid } from '../util/id.js';
import { A, S, pick } from './state.js';

// The syntax cheat sheet shown above the sheet in edit mode (fields, filters, conditions, loops, clause references).
const SYNTAX = '{{field}}  ·  {{rent | words}}  ·  {{rent | money}}  ·  {{date | date:\'short\'}}  ·  [[if poa]] … [[else]] … [[end]]  ·  [[each services as s]] {{s.name}} [[end]]  ·  {{#clauseId}}  ·  **bold**  ·  Tab = right column';

export function mountEditor(root) {
  const banner = h('div', { class: 'ac-docbanner' });
  const help = h('div', { class: 'ac-syntax', hidden: true });
  const sheet = h('div', { class: 'ct-sheet ct-chips' });
  const wrap = h('div', { class: 'ac-paper' }, sheet);
  root.append(banner, help, wrap);
  // Per clause: which level option's variant is open in the editor (defaults to the document's current level).
  const variantPick = new Map(); // clause id -> the level option whose variant is being edited

  // Read mode: clicking a placeholder chip focuses its field in the right pane (event delegation on the sheet).
  sheet.addEventListener('click', (e) => {
    if (S.edit) return;
    const chip = e.target.closest('[data-f]');
    if (chip) A.focusField(chip.dataset.f);
  });

  function fit() {
    // Fit the sheet to the pane width: page width in CSS px (mm x 96 / 25.4), scaled down only, never below 35 %.
    // CSS zoom (not transform) so the layout box shrinks too and the pane's scrollbars match the visible sheet.
    const size = (S.tpl && PAGE_SIZES[S.tpl.page.size]) || PAGE_SIZES.A4;
    const px = (size.w * 96) / 25.4;
    const avail = wrap.clientWidth - 24;
    const z = avail > 0 && avail < px ? Math.max(0.35, avail / px) : 1;
    sheet.style.zoom = String(z);
  }
  new ResizeObserver(() => fit()).observe(wrap);

  function renderBanner() {
    banner.replaceChildren();
    if (!S.docId) {
      banner.append(h('div', { class: 'ac-note' }, iconEl('info'), h('span', {}, t('ac.sampleNote')),
        h('button', { type: 'button', class: 'ed-btn ed-sm ed-primary', onclick: () => A.newDoc(S.tpl.id) }, iconEl('filePlus'), t('ac.newDocFromThis'))));
    }
    help.hidden = !S.edit;
    help.replaceChildren(h('b', {}, t('ac.syntax')), ' ', h('code', {}, SYNTAX));
  }

  function render() {
    renderBanner();
    root.classList.toggle('ac-editing', S.edit);
    if (!S.edit) {
      sheet.innerHTML = S.result.html;
      fit();
      return;
    }
    const r = renderContract(S.tpl, S.doc, { lang: S.lang, today: S.result.env.today, showHidden: true, chips: true });
    sheet.innerHTML = r.html;
    mountEditors();
    fit();
  }

  // --- edit mode ---------------------------------------------------------------------------------------------------
  // Clauses are looked up in the template copy the mutator receives, never through captured objects: the template is
  // replaced on each change, so stale references would edit a detached copy.
  const findClause = (tpl, id) => { for (const s of tpl.sections) { const i = s.clauses.findIndex((c) => c.id === id); if (i >= 0) return { s, c: s.clauses[i], i }; } return null; };
  const variantKey = (c) => { if (!c.by) return null; const l = S.tpl.levels.find((x) => x.id === c.by); if (!l) return null; const v = variantPick.get(c.id) || S.doc.levels[c.by] || l.default; return l.options.some((o) => o.v === v) ? v : l.default; };
  const srcOf = (c) => { const k = variantKey(c); const o = k ? (c.variants && c.variants[k]) || {} : c.text; return o || {}; };

  // Auto-grow textarea: reset to auto, then size to content (capped at 900 px, beyond that it scrolls).
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 900) + 'px'; }

  // Inserts text, or wraps the selection in an opening/closing pair ([[if x]] ... [[end]]); with an empty selection the
  // caret lands between the pair. A synthetic input event routes the change through the normal save path.
  function insertAt(ta, text, wrapSel) {
    const a = ta.selectionStart, b = ta.selectionEnd;
    const sel = ta.value.slice(a, b);
    const ins = wrapSel ? wrapSel[0] + sel + wrapSel[1] : text;
    ta.setRangeText(ins, a, b, 'end');
    if (wrapSel && !sel) ta.selectionStart = ta.selectionEnd = a + wrapSel[0].length;
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }

  function fieldMenu(anchor, ta) {
    const items = [];
    items.push({ header: true, label: t('ac.insertField') });
    for (const f of S.tpl.fields.slice(0, 80)) items.push({ label: `${labelOf(f, S.lang, S.tpl.main)}  {{${f.id}}}`, action: () => insertAt(ta, `{{${f.id}}}`) });
    if (S.tpl.modifiers.length || S.tpl.levels.length) items.push({ sep: true }, { header: true, label: t('ac.insertCondition') });
    for (const m of S.tpl.modifiers) items.push({ label: `[[if ${m.id}]] … [[end]] — ${pick(m.label)}`, action: () => insertAt(ta, '', [`[[if ${m.id}]]`, '[[end]]']) });
    for (const l of S.tpl.levels) for (const o of l.options) items.push({ label: `[[if ${l.id} == '${o.v}']] … [[end]]`, action: () => insertAt(ta, '', [`[[if ${l.id} == '${o.v}']]`, '[[end]]']) });
    openMenu(anchor, items, { label: t('ac.insertField'), className: 'ac-fieldmenu' });
  }

  // Previews re-render the whole contract off-DOM (in an inert <template>) and copy each clause's fresh HTML into its
  // preview box, because a clause's text can depend on other clauses (numbering, references) and on the whole document.
  const previewSoon = debounce(() => {
    const r = renderContract(S.tpl, S.doc, { lang: S.lang, today: S.result ? S.result.env.today : '', showHidden: true, chips: true });
    const tpl = document.createElement('template');
    tpl.innerHTML = r.html;
    for (const box of sheet.querySelectorAll('.ac-ce[data-cl]')) {
      const fresh = tpl.content.querySelector(`[data-cl="${CSS.escape(box.dataset.cl)}"]`);
      const prev = box.querySelector('.ac-ce-prev');
      if (fresh && prev) prev.innerHTML = fresh.innerHTML;
    }
  }, 250);

  function clauseEditor(el, s, c) {
    const lang = S.lang;
    const key = variantKey(c);
    const src = srcOf(c);
    const ta = h('textarea', { class: 'ac-ce-src', spellcheck: 'true', lang, dir: 'auto', 'aria-label': t('ac.clauseText') + ' ' + c.id, 'data-cl': c.id, placeholder: src[lang] ? '' : (src[S.tpl.main] || t('ac.clauseEmpty')) });
    ta.value = src[lang] || '';
    const msg = h('div', { class: 'ac-ce-msg' });
    // Syntax errors are shown live (first three); an empty translation offers to copy the main-language text.
    const check = () => {
      const errs = parseText(ta.value).errors;
      msg.replaceChildren(...errs.slice(0, 3).map((e) => h('div', { class: 'ac-err' }, t('ac.syntaxError', { m: e.msg }))));
      if (!ta.value && lang !== S.tpl.main && src[S.tpl.main]) {
        msg.append(h('div', { class: 'ac-warn' }, t('ac.noTranslation', { lang: langLabel(S.tpl.main) }), ' ',
          h('button', { type: 'button', class: 'ac-linkbtn', onclick: () => { ta.value = src[S.tpl.main]; ta.dispatchEvent(new Event('input')); } }, t('ac.copyMain'))));
      }
    };
    ta.addEventListener('keydown', (e) => {
      // Tab inserts a tab character (clause text may use tabs for alignment). Same keyboard-trap caveat as the validator
      // editor in side.js.
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    });
    ta.addEventListener('input', () => {
      grow(ta);
      check();
      const v = ta.value;
      A.changeTemplate((tpl) => {
        const f = findClause(tpl, c.id);
        if (!f) return;
        if (key) { f.c.variants = f.c.variants || {}; f.c.variants[key] = { ...(f.c.variants[key] || {}), [lang]: v }; }
        else f.c.text = { ...f.c.text, [lang]: v };
      }, { quiet: true, bar: false });
      previewSoon();
    });
    const when = h('input', { class: 'ed-input ac-ce-when', value: c.when || '', placeholder: t('ac.whenPh'), title: t('ac.whenHint'), 'aria-label': t('ac.when'), spellcheck: 'false' });
    // Conditions are validated on commit (change), not per keystroke: half-typed expressions are always invalid.
    when.addEventListener('change', () => {
      const v = when.value.trim();
      const p = v ? parseExpr(v) : { error: null };
      if (p.error) { when.classList.add('ac-bad'); toast(t('ac.exprError', { m: p.error }), 'error'); return; }
      when.classList.remove('ac-bad');
      A.changeTemplate((tpl) => { const f = findClause(tpl, c.id); if (f) { if (v) f.c.when = v; else delete f.c.when; } }, { now: true });
    });
    const by = S.tpl.levels.length ? h('select', { class: 'ed-input ed-select ac-ce-by', title: t('ac.byLevel'), 'aria-label': t('ac.byLevel') },
      h('option', { value: '' }, t('ac.noVariants')), S.tpl.levels.map((l) => h('option', { value: l.id }, t('ac.variantsBy', { l: pick(l.label) || l.id })))) : null;
    if (by) {
      by.value = c.by || '';
      // Binding a clause to a level creates one variant per option, each seeded with the current text, so switching the
      // binding on never loses text; unbinding keeps the variant currently shown as the clause text.
      by.addEventListener('change', () => A.changeTemplate((tpl) => {
        const f = findClause(tpl, c.id);
        if (!f) return;
        if (by.value) {
          const l = tpl.levels.find((x) => x.id === by.value);
          f.c.by = by.value;
          f.c.variants = f.c.variants || {};
          for (const o of l.options) if (!f.c.variants[o.v] || !Object.keys(f.c.variants[o.v]).length) f.c.variants[o.v] = { ...f.c.text };
        } else {
          const k = variantKey(f.c);
          if (k && f.c.variants && f.c.variants[k]) f.c.text = { ...f.c.variants[k] };
          delete f.c.by; delete f.c.variants;
        }
      }, { now: true }));
    }
    const lvl = key ? S.tpl.levels.find((x) => x.id === c.by) : null;
    const variantSeg = lvl ? h('div', { class: 'ed-seg ac-ce-var', role: 'radiogroup', 'aria-label': t('ac.editVariant') }, lvl.options.map((o) => h('button', {
      type: 'button', class: 'ed-seg-btn' + (o.v === key ? ' ed-on' : ''), role: 'radio', 'aria-checked': String(o.v === key),
      onclick: () => { variantPick.set(c.id, o.v); render(); },
    }, pick(o.label) || o.v))) : null;
    const insBtn = h('button', { type: 'button', class: 'ed-btn ed-sm', title: t('ac.insertField'), 'aria-haspopup': 'menu' }, iconEl('plus'), '{{ }}');
    insBtn.addEventListener('click', () => fieldMenu(insBtn, ta));
    const move = (d) => A.changeTemplate((tpl) => { const f = findClause(tpl, c.id); if (!f) return; const j = f.i + d; if (j < 0 || j >= f.s.clauses.length) return; const arr = f.s.clauses; [arr[f.i], arr[j]] = [arr[j], arr[f.i]]; }, { now: true });
    const add = () => A.changeTemplate((tpl) => { const f = findClause(tpl, c.id); if (f) f.s.clauses.splice(f.i + 1, 0, { id: 'c' + uid().slice(0, 6), text: { [S.lang]: '' } }); }, { now: true });
    const del = () => A.changeTemplate((tpl) => { const f = findClause(tpl, c.id); if (f) f.s.clauses.splice(f.i, 1); }, { now: true });
    const ib = (ic, key2, fn, cls = '') => h('button', { type: 'button', class: 'ed-iconbtn ed-sm ' + cls, title: t(key2), 'aria-label': t(key2), onclick: fn }, iconEl(ic));
    const prev = h('div', { class: 'ac-ce-prev' });
    // The editor starts with the clause's current rendering as its preview, so nothing jumps before the first edit.
    prev.innerHTML = el.innerHTML;
    const box = h('div', { class: 'ac-ce' + (el.classList.contains('ct-off') ? ' ac-ce-off' : ''), 'data-cl': c.id },
      h('div', { class: 'ac-ce-bar' }, h('code', { class: 'ac-ce-id', title: t('ac.clauseId') }, '#' + c.id), when, by, variantSeg, h('span', { class: 'ed-spacer' }), insBtn,
        ib('up', 'ac.moveUp', () => move(-1)), ib('down', 'ac.moveDown', () => move(1)), ib('plus', 'ac.addClause', add), ib('trash', 'ac.deleteClause', del, 'ed-danger')),
      ta, msg, prev);
    el.replaceChildren(box);
    // Inactive parts are made fully visible while edited (ct-off removed), the dimming is carried by the editor frame.
    el.classList.remove('ct-off');
    el.removeAttribute('data-when');
    requestAnimationFrame(() => grow(ta));
    check();
  }

  function sectionEditor(secEl, s, index) {
    const title = h('textarea', { class: 'ac-se-title', rows: s.kind === 'appendix' ? 3 : 1, 'aria-label': t('ac.sectionTitle'), placeholder: s.title[S.tpl.main] || t('ac.sectionTitle'), spellcheck: 'true' });
    title.value = s.title[S.lang] || '';
    title.addEventListener('input', () => { grow(title); const v = title.value; A.changeTemplate((tpl) => { const x = tpl.sections.find((y) => y.id === s.id); if (x) x.title = { ...x.title, [S.lang]: v }; }, { quiet: true, bar: false }); });
    const kind = h('select', { class: 'ed-input ed-select', title: t('ac.sectionKind'), 'aria-label': t('ac.sectionKind') }, SECTION_KINDS.map((k) => h('option', { value: k }, t('ac.kind.' + k))));
    kind.value = s.kind;
    kind.addEventListener('change', () => A.changeTemplate((tpl) => { const x = tpl.sections.find((y) => y.id === s.id); if (x) x.kind = kind.value; }, { now: true }));
    const when = h('input', { class: 'ed-input ac-ce-when', value: s.when || '', placeholder: t('ac.whenPh'), title: t('ac.whenHint'), 'aria-label': t('ac.when'), spellcheck: 'false' });
    when.addEventListener('change', () => {
      const v = when.value.trim();
      const p = v ? parseExpr(v) : { error: null };
      if (p.error) { when.classList.add('ac-bad'); toast(t('ac.exprError', { m: p.error }), 'error'); return; }
      A.changeTemplate((tpl) => { const x = tpl.sections.find((y) => y.id === s.id); if (x) { if (v) x.when = v; else delete x.when; } }, { now: true });
    });
    const move = (d) => A.changeTemplate((tpl) => { const i = tpl.sections.findIndex((y) => y.id === s.id); const j = i + d; if (i < 0 || j < 0 || j >= tpl.sections.length) return; [tpl.sections[i], tpl.sections[j]] = [tpl.sections[j], tpl.sections[i]]; }, { now: true });
    const addSec = () => A.changeTemplate((tpl) => { const i = tpl.sections.findIndex((y) => y.id === s.id); tpl.sections.splice(i + 1, 0, { id: 's' + uid().slice(0, 6), title: { [S.lang]: t('ac.newSection') }, clauses: [{ id: 'c' + uid().slice(0, 6), text: { [S.lang]: '' } }] }); }, { now: true });
    const addCl = () => A.changeTemplate((tpl) => { const x = tpl.sections.find((y) => y.id === s.id); if (x) x.clauses.push({ id: 'c' + uid().slice(0, 6), text: { [S.lang]: '' } }); }, { now: true });
    const del = () => A.changeTemplate((tpl) => { tpl.sections = tpl.sections.filter((y) => y.id !== s.id); }, { now: true });
    const ib = (ic, key, fn, cls = '') => h('button', { type: 'button', class: 'ed-iconbtn ed-sm ' + cls, title: t(key), 'aria-label': t(key), onclick: fn }, iconEl(ic));
    const bar = h('div', { class: 'ac-se' + (secEl.classList.contains('ct-off') ? ' ac-ce-off' : '') },
      h('div', { class: 'ac-ce-bar' }, h('code', { class: 'ac-ce-id' }, '§' + s.id), kind, when, h('span', { class: 'ed-spacer' }),
        ib('up', 'ac.moveUp', () => move(-1)), ib('down', 'ac.moveDown', () => move(1)), ib('plus', 'ac.addClause', addCl), ib('section', 'ac.addSection', addSec), ib('trash', 'ac.deleteSection', del, 'ed-danger')),
      title);
    secEl.prepend(bar);
    secEl.classList.remove('ct-off');
    secEl.removeAttribute('data-when');
    requestAnimationFrame(() => grow(title));
    // `index` is unused; the void keeps linters quiet while the signature stays uniform with clauseEditor.
    void index;
  }

  function mountEditors() {
    // The document title.
    const tt = h('textarea', { class: 'ac-se-title ac-doc-title', rows: 1, 'aria-label': t('ac.docTitle'), placeholder: S.tpl.title[S.tpl.main] || t('ac.docTitle') });
    tt.value = S.tpl.title[S.lang] || '';
    tt.addEventListener('input', () => { grow(tt); const v = tt.value; A.changeTemplate((tpl) => { tpl.title = { ...tpl.title, [S.lang]: v }; }, { quiet: true, bar: false }); });
    const doc = sheet.querySelector('.ct-doc');
    doc.prepend(h('div', { class: 'ac-se' }, h('div', { class: 'ac-ce-bar' }, h('b', {}, t('ac.docTitle'))), tt));
    requestAnimationFrame(() => grow(tt));
    S.tpl.sections.forEach((s, i) => {
      const secEl = sheet.querySelector(`.ct-sec[data-s="${CSS.escape(s.id)}"]`);
      if (!secEl) return;
      for (const c of s.clauses) {
        const el = secEl.querySelector(`[data-cl="${CSS.escape(c.id)}"]`);
        if (el) clauseEditor(el, s, c);
      }
      sectionEditor(secEl, s, i);
      if (!s.clauses.length) secEl.append(h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => A.changeTemplate((tpl) => { const x = tpl.sections.find((y) => y.id === s.id); if (x) x.clauses.push({ id: 'c' + uid().slice(0, 6), text: { [S.lang]: '' } }); }, { now: true }) }, iconEl('plus'), t('ac.addClause')));
    });
    if (!S.tpl.sections.length) doc.append(h('button', { type: 'button', class: 'ed-btn', onclick: () => A.changeTemplate((tpl) => { tpl.sections.push({ id: 's' + uid().slice(0, 6), title: { [S.lang]: t('ac.newSection') }, clauses: [{ id: 'c' + uid().slice(0, 6), text: { [S.lang]: '' } }] }); }, { now: true }) }, iconEl('plus'), t('ac.addSection')));
  }

  function jump(id) {
    // Jump target ids are built by contract/render.js (ct-s-<id>, ct-c-<id>) and escaped for the selector.
    const el = sheet.querySelector('#' + CSS.escape(id));
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.remove('ac-flash'); void el.offsetWidth; el.classList.add('ac-flash');
  }

  return { render, fit, jump, scrollTop: () => { wrap.scrollTop = 0; root.scrollTop = 0; } };
}
