// readme-editor/e2e.js - browser scenario through the interface: the sample renders (alert, table, math as MathML,
// a diagram as SVG, badges drawn locally, no remote image loaded), editing a paragraph in place writes Markdown back,
// task boxes toggle, a table gets a row from its bar, the insert menu adds a table of contents, a badge opens the
// builder, undo / redo, views, flavour, the outline with a broken-anchor hint, remote images held back. Desktop and phone:
//   node check.js e2e http://127.0.0.1:8080/readme-editor/ readme-editor/e2e.js [--mobile --size 390x844]
//   node check.js e2e readme-editor/html@5_offline_singlefile/index.html readme-editor/e2e.js
// The scenario is serialized into the page (Function.prototype.toString): only browser globals.
//
// Strategy: drive the real UI with synthetic events and assert on two observables only, the Markdown source
// (ta.value) and the rendered DOM, never on module internals. until() polls instead of fixed sleeps where the
// work is async (diagram rendering, dialogs), so the test is fast on a fast machine and still passes on a slow one.
// The privacy promise is tested, not assumed: performance resource entries must show no cross-origin request.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); } return null; };
  const errors = [];
  // Any uncaught page error is collected and fails the last step, even if every functional step passed.
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const ta = () => $('.re-ta');
  const src = () => ta().value;
  const type = (text) => { ta().value = text; ta().dispatchEvent(new Event('input', { bubbles: true })); };
  // Synthetic mousedown with coordinates: in-place editing starts on mousedown (preview.js), and caret placement
  // reads the point, so a bare .click() would not start a session.
  const down = (el) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.left + 4, clientY: r.top + 4 })); };
  // Resource Timing lists every fetched URL; filtering out the page's own origin leaves only third-party requests.
  const fetched = () => performance.getEntriesByType('resource').filter((e) => /^https?:/.test(e.name) && !e.name.startsWith(location.origin)).map((e) => e.name);

  // A fresh sample (the scenario may run twice in one browser profile).
  localStorage.removeItem('re-doc');
  localStorage.removeItem('re-remote');
  await until(() => $('.re-blk'));
  const btnNew = $$('.re-row1 .ed-btn')[0];
  btnNew.click();
  await sleep(300);
  // "New" may ask to discard: confirm.
  const ok = $('.ed-dialog .ed-primary');
  if (ok) ok.click();
  await sleep(200);
  step('new document is empty', src() === '' && $('.re-preview.re-empty'), src().length);
  // A README typed into the source pane.
  // One document covering every renderer path: centred HTML badge, bold, broken anchor, alert, tasks, aligned table,
  // display math, a Mermaid diagram and a remote image (which must be held back).
  type('# Demo\n\n<p align="center">\n  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">\n</p>\n\nSome **bold** text with a [bad link](#nowhere).\n\n> [!NOTE]\n> Note body\n\n- [ ] first\n- [x] second\n\n| a | b |\n| - | -: |\n| 1 | 2 |\n\n$$\n\\frac{a}{b}\n$$\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n\n![remote](https://example.com/x.png)\n');
  await until(() => $('.md-diagram svg'));
  await sleep(300);
  step('blocks render', $$('.re-blk').length >= 9, $$('.re-blk').length);
  step('alert', !!$('.markdown-alert-note .markdown-alert-title svg'), null);
  step('math as MathML', !!$('.md-math-block math mfrac'), $('.md-math-block')?.innerHTML.slice(0, 80));
  step('sequence diagram as SVG', !!$('.md-diagram svg.dg-sequence'), $('.md-diagram svg')?.getAttribute('class'));
  step('static badge drawn locally', $('img[alt="License"]')?.src.startsWith('data:image/svg+xml'), $('img[alt="License"]')?.src.slice(0, 40));
  step('remote image held back with a notice', $('img.re-held') && !$('.re-notice').hidden, $('.re-notice span')?.textContent);
  step('nothing fetched from the network', fetched().length === 0, fetched());

  // In-place editing of a paragraph.
  const para = $$('.re-blk').find((b) => /Some/.test(b.textContent));
  down(para);
  await until(() => $('.re-blk.re-editing'));
  const ed = $('.re-blk.re-editing');
  const sel = getSelection();
  const r = document.createRange();
  r.selectNodeContents(ed.querySelector('p'));
  r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  // execCommand('insertText') simulates typing inside the contenteditable, including its native input events.
  document.execCommand('insertText', false, ' Added.');
  $('.re-ctx .ed-primary').click();
  await until(() => /Added\./.test(src()));
  // The exact expected source proves the round trip kept the untouched Markdown (bold, link) byte for byte.
  step('in-place edit writes Markdown back', /Some \*\*bold\*\* text with a \[bad link\]\(#nowhere\)\. Added\./.test(src()), src().split('\n').find((l) => /Some/.test(l)));

  // Task box.
  $$('input.md-task')[0].click();
  await sleep(150);
  step('task box toggles the source', /- \[x\] first/.test(src()), null);

  // Table: a row below from the context bar.
  down($$('.re-preview td')[0]);
  await until(() => $('.re-blk.re-editing table'));
  $('.re-ctx [data-k="tbl.rowBelow"]').click();
  await sleep(250);
  const rows = src().split('\n').filter((l) => /^\|/.test(l)).length;
  step('table row added', rows === 4, src().split('\n').filter((l) => /^\|/.test(l)));
  $('.re-ctx .ed-primary')?.click();
  await sleep(150);

  // Insert menu: table of contents at the end.
  $('.re-insbtn').click();
  const tocBtn = await until(() => $('.re-insmenu [data-id="toc"]'));
  tocBtn.click();
  await sleep(250);
  step('table of contents inserted', src().includes('- [Demo](#demo)'), src().slice(-60));

  // Undo / redo.
  const before = src();
  // Undo and redo are the last two icon buttons of the format row (labels are translated, positions are not).
  $$('.re-row2 .ed-iconbtn').slice(-2)[0].click();
  await sleep(150);
  const undone = src();
  $$('.re-row2 .ed-iconbtn').slice(-1)[0].click();
  await sleep(150);
  step('undo and redo', undone !== before && src() === before, [undone.length, before.length]);

  // Badge builder.
  $('img[alt="License"]').click();
  const dlg = await until(() => $('.ed-dialog .re-badge'));
  step('badge builder opens with a local preview', dlg && $('.re-badge-prev img')?.src.startsWith('data:image/svg+xml') && /license-MIT-blue/.test($$('.ed-dialog input').find((i) => /shields/.test(i.value))?.value || ''), null);
  $$('.ed-dialog .ed-dlg-foot .ed-btn').find((b) => !b.classList.contains('ed-primary') && !b.classList.contains('ed-danger')).click();
  await sleep(250);

  // Outline and hints.
  $$('.re-row1 .ed-iconbtn').find((b) => b.querySelector('svg') && b.title && !/\?|F1/.test(b.title) && b !== $$('.re-row1 .ed-iconbtn')[0]).click();
  await sleep(200);
  step('outline lists headings', $$('.re-toc-i').some((b) => b.textContent === 'Demo'), $$('.re-toc-i').map((b) => b.textContent));
  step('broken anchor hint', $$('.re-hint').some((b) => /#nowhere/.test(b.textContent)), $$('.re-hint').map((b) => b.textContent));

  // Views and flavour.
  $$('.re-row1 .ed-seg')[0].querySelector('[data-v="visual"]').click();
  await sleep(100);
  step('visual view hides the source', getComputedStyle($('.re-srcpane')).display === 'none', null);
  $$('.re-row1 .ed-seg')[0].querySelector('[data-v="split"]').click();
  $$('.re-row1 .ed-seg')[1].querySelector('[data-v="codeberg"]').click();
  await sleep(100);
  step('Codeberg flavour', $('.re-preview').classList.contains('md-codeberg'), null);
  $$('.re-row1 .ed-seg')[1].querySelector('[data-v="github"]').click();

  step('autosave in the browser', /Added\./.test(JSON.parse(localStorage.getItem('re-doc') || '{}').text || ''), null);
  step('still nothing fetched', fetched().length === 0, fetched());
  // __edMissingKeys is filled by ui/i18n.js when t() finds a key in no dictionary, not even English: catches UI
  // strings that were never added (a key missing only in one translation falls back to English silently).
  const missing = [...(window.__edMissingKeys || [])];
  step('every UI string has a dictionary entry', missing.length === 0, missing.slice(0, 12));
  step('no page errors', errors.length === 0, errors.slice(0, 3));
  return { steps };
}
