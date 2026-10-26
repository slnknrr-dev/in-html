// agreement-constructor/side.js - the right pane: the fields of the template that the active text reads (grouped;
// a toggle shows all of them), the fields just extracted from the edited text and the ones no text reads any more,
// the form itself (contract/form.js), every field's definition behind its id, and below it the checks: the issues of
// the built-in rules and of the template's JavaScript validator, whose code is edited here in a monospaced editor and
// runs in a sandboxed worker.
//
//   const side = mountSide(root)   side.render()   side.renderValidator()   side.focusField(id)   side.renderSaved(iso)
//
// The form is mounted once (mountForm) and then updated in place (form.update): rebuilding it on every keystroke
// would destroy the focused input. Everything else in the pane is cheap and re-rendered from S. By default only the
// fields the active text actually reads are shown (S.result.used), so modifiers that switch clauses off also hide
// their fields; "all fields" is a toggle for template authors.
import { h, debounce } from '../ui/dom.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { openMenu } from '../ui/overlays.js';
import { mountForm } from '../contract/form.js';
import { labelOf } from '../contract/fields.js';
import { A, S } from './state.js';
import { fieldDialog } from './dialogs.js';

export function mountSide(root) {
  const head = h('div', { class: 'ac-pane-h' });
  const extract = h('div', { class: 'ac-extract' });
  const formHost = h('div', { class: 'ac-form' });
  const vHead = h('div', { class: 'ac-pane-h ac-vhead' });
  // aria-live on the issue list: new validation results are announced when they change.
  const issues = h('ul', { class: 'ac-issues', 'aria-live': 'polite' });
  const code = h('textarea', { class: 'ap-mono ac-code', spellcheck: 'false', autocomplete: 'off', wrap: 'off', 'aria-label': t('ac.validatorCode') });
  const status = h('div', { class: 'ac-vstatus' });
  const runBtn = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => A.runValidator() }, iconEl('play'), h('span', {}, t('ac.run')));
  const details = h('details', { class: 'ac-vcode' }, h('summary', {}, t('ac.validatorCode')), h('p', { class: 'ed-hint' }, t('ac.validatorHelp')), code, h('div', { class: 'ap-row' }, runBtn, status));
  const saved = h('div', { class: 'ac-saved' });
  root.append(head, extract, formHost, h('section', { class: 'ac-validator' }, vHead, issues, details), saved);
  let form = null;

  // Tab inserts two spaces in the validator editor. KNOWN DEFECT (accessibility): no way to Tab out of the textarea
  // with the keyboard. Fix: let Escape release the trap (then Tab moves focus), as code editors commonly do.
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); }
  });
  // The user validator runs 700 ms after typing stops (it executes in a worker and may be slow); the template change
  // itself is saved quietly (no bar re-render) on every keystroke.
  const runSoon = debounce(() => A.runValidator(), 700);
  code.addEventListener('input', () => {
    const v = code.value;
    A.changeTemplate((tpl) => { tpl.validator = v; }, { quiet: true, bar: false });
    runSoon();
  });

  function fieldMenu(id, anchor) {
    const f = S.tpl.fields.find((x) => x.id === id);
    const used = S.result && S.result.used.has(id);
    openMenu(anchor, [
      { label: t('ac.editField'), icon: 'edit', action: () => fieldDialog(id) },
      used ? { label: t('ac.showInText'), icon: 'search', action: () => showInText(id) } : null,
      { sep: true },
      // A field can be deleted only when no active text reads it, or when it is listed as unused: deleting a field that is
      // still referenced would leave {{placeholders}} without a definition.
      { label: t('ac.deleteField'), icon: 'trash', danger: true, disabled: !!used && !S.unused.includes(id), action: () => A.changeTemplate((tpl) => { tpl.fields = tpl.fields.filter((x) => x.id !== id); }, { now: true }) },
    ], { label: f ? labelOf(f, S.lang, S.tpl.main) : id });
  }

  function showInText(id) {
    // CSS.escape: field ids are user-defined and may contain characters that would break the attribute selector.
    const chip = document.querySelector(`#ac-doc [data-f="${CSS.escape(id)}"]`);
    if (!chip) return;
    // On phones the paper is in another tab; switch to it first so the scroll target is visible.
    if (matchMedia('(max-width: 900px)').matches) document.querySelector('.ac-tab[data-k="doc"]')?.click();
    chip.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Restart the highlight animation on every chip that shows the field (remove, reflow, add).
    for (const c of document.querySelectorAll(`#ac-doc [data-f="${CSS.escape(id)}"]`)) { c.classList.remove('ct-hot'); void c.offsetWidth; c.classList.add('ct-hot'); setTimeout(() => c.classList.remove('ct-hot'), 1600); }
  }

  function renderHead() {
    const all = S.tpl.fields.length;
    const shown = S.showAll ? all : S.tpl.fields.filter((f) => S.result.used.has(f.id)).length;
    const tog = h('label', { class: 'ac-allf', title: t('ac.allFieldsHint') }, h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', checked: S.showAll, onchange: (e) => { S.showAll = e.target.checked; render(); } }), t('ac.allFields'));
    head.replaceChildren(h('h2', {}, t('ac.fields')), h('small', { class: 'ac-muted', title: t('ac.fieldsCount') }, `${shown} / ${all}`), h('span', { class: 'ed-spacer' }), tog,
      h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ac.addField'), 'aria-label': t('ac.addField'), onclick: () => fieldDialog(null) }, iconEl('plus')));
  }

  function renderExtract() {
    extract.replaceChildren();
    const added = S.added.filter((id) => S.tpl.fields.some((f) => f.id === id));
    if (added.length) {
      extract.append(h('div', { class: 'ac-note ac-note-ok' }, iconEl('sparkle'), h('div', {}, h('b', {}, t('ac.extracted')), ' ',
        added.map((id) => h('button', { type: 'button', class: 'ed-chip', title: t('ac.editField'), onclick: () => fieldDialog(id) }, '{{' + id + '}}')),
        h('button', { type: 'button', class: 'ac-linkbtn', onclick: () => { S.added = []; renderExtract(); } }, t('ac.dismiss')))));
    }
    if (S.unused.length) {
      extract.append(h('div', { class: 'ac-note' }, iconEl('info'), h('div', {}, h('b', {}, t('ac.unused')), ' ',
        S.unused.map((id) => h('span', { class: 'ed-chip ac-unused' }, id, h('button', { type: 'button', class: 'ac-x', title: t('ac.deleteField'), 'aria-label': t('ac.deleteField') + ' ' + id,
          onclick: () => A.changeTemplate((tpl) => { tpl.fields = tpl.fields.filter((x) => x.id !== id); }, { now: true }) }, '×'))))));
    }
    // Only template-level errors (syntax, expressions, filters) are surfaced here; field issues appear in the checks list.
    const errs = (S.result.errors || []).filter((e) => e.code === 'syntax' || e.code === 'expr' || e.code === 'filter');
    if (errs.length) extract.append(h('div', { class: 'ac-note ac-note-err' }, iconEl('warn'), h('div', {}, h('b', {}, t('ac.templateErrors')), h('ul', {}, errs.slice(0, 6).map((e) => h('li', {}, (e.clause ? '#' + e.clause + ': ' : '') + (e.code === 'filter' ? t('ac.unknownFilter', { f: e.msg }) : e.msg)))))));
  }

  function renderValidator() {
    // The code area is not overwritten while being edited (the template copy may lag behind by the debounce).
    if (document.activeElement !== code && code.value !== S.tpl.validator) code.value = S.tpl.validator;
    const n = S.issues.length;
    vHead.replaceChildren(h('h2', {}, t('ac.checks')), h('span', { class: 'ac-badge ' + (S.issues.some((x) => x.level === 'error') ? 'ac-b-err' : n ? 'ac-b-warn' : 'ac-b-ok') }, n ? t('ac.issuesN', { n }) : t('ac.noIssues')));
    issues.replaceChildren(...S.issues.map((x) => {
      // Issues can target a nested field ("parties.0.name"); the definition is found by the leading id.
      const f = x.field ? S.tpl.fields.find((y) => y.id === x.field || x.field.startsWith(y.id + '.')) : null;
      return h('li', { class: x.level === 'warning' ? 'ac-w' : 'ac-e' },
        h('button', { type: 'button', class: 'ac-issue', onclick: () => { if (x.field) { A.focusField(x.field); showInText(x.field.split('.')[0]); } } },
          iconEl(x.level === 'warning' ? 'info' : 'warn'), h('span', {}, f ? h('b', {}, labelOf(f, S.lang, S.tpl.main) + ': ') : null, x.message), x.code === 'user' ? h('small', { class: 'ac-src' }, 'JS') : null));
    }));
    const u = S.userRun;
    status.textContent = !S.tpl.validator.trim() ? t('ac.noValidator') : u.running ? t('ac.running') : u.timedOut ? t('ac.timedOut') : u.error ? t('ac.validatorError', { m: u.error }) : u.at ? t('ac.validatorOk', { ms: u.ms }) : '';
    status.className = 'ac-vstatus' + (u.error || u.timedOut ? ' ac-err' : '');
  }

  function render() {
    if (!S.tpl || !S.result) return;
    renderHead();
    renderExtract();
    const opts = {
      tpl: S.tpl, doc: S.doc, lang: S.lang, used: S.showAll ? null : S.result.used, issues: S.issues, env: S.result.env,
      onChange: (id, v) => A.setValue(id, v), onFieldMenu: fieldMenu, empty: h('p', { class: 'ac-empty' }, t('ac.noFields')),
    };
    if (!form) form = mountForm(formHost, opts); else form.update(opts);
    renderValidator();
  }

  function renderSaved(iso) {
    const d = new Date(iso);
    saved.textContent = t('ac.saved', { time: d.toLocaleTimeString(UI_STATE.lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' }), where: S.store.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage' });
  }

  // focusField shows all fields first if the target is currently hidden by the "used fields only" filter.
  return { render, renderValidator, renderSaved, focusField: (id) => { if (!form) return; if (!form.focusField(id)) { S.showAll = true; render(); form.focusField(id); } } };
}
