// book-processor/e2e-writer.js - end-to-end scenario for the built page:
//   node check.js e2e book-processor/html@5_offline_singlefile/index.html book-processor/e2e-writer.js
// The writer: a new book from the dialog, typing, bold, a footnote, chapters (add, context menu, move, nest, split,
// merge, delete + undo), details, a generated cover, styles, the check, exports re-read and validated, saving to the
// library and reading it, preview, the drafts menu, an EPUB opened for editing, autosave.
// Same contract as e2e-reader.js. Exports are re-read with the library's own readers and validated (checkEpub /
// checkFB2), closing the loop: what the writer produces must import back losslessly.
export default async function () {
  const steps = [];
  const ok = (name, cond, v) => steps.push([name, cond ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(50); } return null; };
  const ctx = (el, x, y) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x ?? r.left + 12, clientY: y ?? r.top + r.height / 2, button: 2 })); };
  const menuItem = (re) => [...document.querySelectorAll('.ed-menu-item')].find((b) => re.test(b.textContent));
  const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // Downloads are captured instead of saved.
  const downloads = [];
  const click0 = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, href: this.href }); else click0.call(this); };
  const fetchBytes = async (href) => new Uint8Array(await (await fetch(href)).arrayBuffer());
  try {
    await waitFor(() => window.__bk && window.__bk.ready);
    const B = window.__bk, L = B.lib;
    B.go('write');
    await waitFor(() => document.querySelector('.wr-drafts-main'));
    ok('drafts page (empty)', !!document.querySelector('.wr-drafts-main .bk-empty'), null);
    // New book through the dialog.
    [...document.querySelectorAll('.wr-drafts-main .ed-btn')].find((b) => /New book/.test(b.textContent)).click();
    await waitFor(() => document.querySelector('.ed-dialog .wr-tpls'));
    const dlg = document.querySelector('.ed-dialog');
    const [title, author] = dlg.querySelectorAll('input[type=text]');
    title.value = 'Letters from the Breakwater'; author.value = 'Mira Holt';
    dlg.querySelector('.wr-tpl[data-k="novel"]').click();
    [...dlg.querySelectorAll('.ed-dlg-foot .ed-btn')].find((b) => /Create/.test(b.textContent)).click();
    const W = await waitFor(() => B.S.writer && B.S.writer.ed && B.S.writer);
    ok('writer opened', !!W, W && { title: W.book.meta.title, authors: W.book.meta.authors, sections: W.book.sections.length });
    const nodes = () => [...document.querySelectorAll('.wr-node')];
    ok('template tree: part with 3 chapters', nodes().length === 4 && nodes()[1].getAttribute('aria-level') === '2', nodes().map((n) => n.textContent));
    // Typing into the open chapter.
    const doc = () => document.querySelector('.wr-doc');
    doc().focus();
    const r = document.createRange(); r.selectNodeContents(doc().querySelector('p')); r.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    document.execCommand('insertText', false, 'The harbour wall was older than the town.');
    document.execCommand('insertParagraph');
    document.execCommand('insertText', false, 'Every evening the keeper wrote a letter and left it in a bottle.');
    document.execCommand('insertParagraph');
    document.execCommand('insertText', false, 'Nobody ever answered, until the winter of the long tide.');
    await sleep(700);
    const sec0 = () => B.wr.writer().book.sections[0];
    const opened = W.sel.id;
    const openSec = () => { let f = null; const walk = (l) => l.forEach((s) => { if (s.id === opened) f = s; walk(s.sections); }); walk(W.book.sections); return f; };
    ok('typed text read back', openSec() && openSec().blocks.length === 3 && openSec().blocks[2].c[0].startsWith('Nobody'), openSec() && openSec().blocks.map((b) => b.c && b.c[0]));
    // Bold on a selection.
    const p0 = doc().querySelector('p');
    const r2 = document.createRange(); r2.setStart(p0.firstChild, 4); r2.setEnd(p0.firstChild, 11);
    getSelection().removeAllRanges(); getSelection().addRange(r2);
    document.querySelector('.wr-tb[aria-label="Bold"]').click();
    await sleep(700);
    ok('bold applied', JSON.stringify(openSec().blocks[0].c).includes('"t":"strong"'), openSec().blocks[0].c);
    // Footnote at the end of the second paragraph.
    const p1 = doc().querySelectorAll('p')[1];
    const r3 = document.createRange(); r3.selectNodeContents(p1); r3.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(r3);
    document.querySelector('.wr-tb[aria-label="Footnote"]').click();
    const ned = await waitFor(() => document.querySelector('.ed-dialog .wr-note-ed'));
    ned.focus();
    const r4 = document.createRange(); r4.selectNodeContents(ned.querySelector('p') || ned); r4.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(r4);
    document.execCommand('insertText', false, 'The bottles were green, from the old glassworks.');
    [...document.querySelectorAll('.ed-dialog .ed-dlg-foot .ed-btn')].find((b) => b.textContent === 'OK').click();
    await sleep(400);
    ok('footnote added', W.book.notes.length === 1 && JSON.stringify(W.book.notes[0].blocks).includes('glassworks') && !!doc().querySelector('a.noteref'), W.book.notes);
    await sleep(600);
    ok('footnote mark in the model', JSON.stringify(openSec().blocks[1].c).includes('"t":"note"'), openSec().blocks[1].c);
    // Editor context menu on the footnote mark.
    ctx(doc().querySelector('a.noteref'));
    await sleep(100);
    ok('editor context menu (note)', !!menuItem(/Edit the footnote/), [...document.querySelectorAll('.ed-ctx-menu .ed-menu-item')].map((b) => b.textContent));
    esc();
    await sleep(900);
    // Scene break and a table.
    document.querySelector('.wr-tb[aria-label="Scene break"]').click();
    await sleep(600);
    ok('scene break', openSec().blocks.some((b) => b.type === 'hr'), openSec().blocks.map((b) => b.type));
    // Chapters: add one, use the context menu to move it up, rename, split, merge, delete + undo.
    const before = nodes().length;
    document.querySelector('.wr-add').click();
    await waitFor(() => nodes().length === before + 1);
    ok('chapter added', nodes().length === before + 1, nodes().map((n) => n.textContent));
    await sleep(900);
    const last = nodes()[nodes().length - 1];
    const lastId = last.dataset.id;
    ctx(last);
    await sleep(120);
    const ctxItems = [...document.querySelectorAll('.ed-ctx-menu .ed-menu-item')].map((b) => b.textContent);
    ok('tree context menu', ctxItems.some((x) => /Rename/.test(x)) && ctxItems.some((x) => /Move up/.test(x)) && ctxItems.some((x) => /Merge/.test(x)), ctxItems);
    menuItem(/Move up/).click();
    await sleep(200);
    ok('moved up', W.book.sections.findIndex((s) => s.id === lastId) === 0, W.book.sections.map((s) => s.id === lastId));
    // Keyboard: Alt+ArrowRight nests it into the next one? (it is first now: nesting needs a previous sibling) -> Alt+Down then Alt+Right.
    const row = () => document.querySelector(`.wr-node[data-id="${lastId}"]`);
    row().focus();
    row().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    await sleep(150);
    row().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    await sleep(150);
    ok('nested with Alt+arrows', W.book.sections.length === 1 && W.book.sections[0].sections.some((s) => s.id === lastId), W.book.sections[0].sections.map((s) => s.id === lastId));
    // Split the first chapter at the third paragraph.
    const ch1 = W.book.sections[0].sections[0];
    document.querySelector(`.wr-node[data-id="${ch1.id}"]`).click();
    await waitFor(() => W.sel.id === ch1.id && doc());
    const p2 = doc().querySelectorAll('p')[2];
    doc().focus();
    const r5 = document.createRange(); r5.selectNodeContents(p2); r5.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r5);
    await sleep(150);
    const nBefore = W.book.sections[0].sections.length;
    ctx(document.querySelector(`.wr-node[data-id="${ch1.id}"]`));
    await sleep(120);
    const split = menuItem(/Split at the cursor/);
    ok('split enabled', split && !split.disabled, split && split.disabled);
    if (split) split.click();
    await sleep(300);
    ok('split', W.book.sections[0].sections.length === nBefore + 1 && ch1.blocks.length === 2, { n: W.book.sections[0].sections.length, first: ch1.blocks.length });
    await sleep(900);
    ctx(document.querySelector(`.wr-node[data-id="${ch1.id}"]`));
    await sleep(120);
    menuItem(/Merge with the next/).click();
    await sleep(300);
    ok('merge', W.book.sections[0].sections.length === nBefore && ch1.blocks.some((b) => b.type === 'subtitle'), ch1.blocks.map((b) => b.type));
    await sleep(900);
    const victim = W.book.sections[0].sections[W.book.sections[0].sections.length - 1];
    ctx(document.querySelector(`.wr-node[data-id="${victim.id}"]`));
    await sleep(120);
    menuItem(/^Delete/).click();
    await sleep(200);
    const dconf = document.querySelector('.ed-dialog .ed-btn.ed-danger');
    if (dconf) { dconf.click(); await sleep(200); }
    ok('deleted', !W.book.sections[0].sections.includes(victim), W.book.sections[0].sections.length);
    const undo = [...document.querySelectorAll('.ed-toast-act')].find((b) => /Undo/.test(b.textContent));
    if (undo) undo.click();
    await sleep(200);
    ok('undo delete', W.book.sections[0].sections.includes(victim), W.book.sections[0].sections.length);
    // Details pane.
    document.querySelectorAll('.wr-navi')[0].click();
    await waitFor(() => document.querySelector('.wr-meta, [data-pane="meta"] .wr-pane'));
    const sub = document.querySelector('[data-meta="subtitle"]');
    sub.value = 'A novel in letters'; sub.dispatchEvent(new Event('input'));
    const ann = document.querySelector('[data-meta="annotation"]');
    ann.value = 'A harbour keeper writes letters nobody answers.\n\nUntil one day somebody does.'; ann.dispatchEvent(new Event('input'));
    const gsel = document.querySelector('.wr-genres select');
    gsel.value = 'adventure'; gsel.dispatchEvent(new Event('change'));
    await sleep(100);
    ok('details edited', W.book.meta.subtitle === 'A novel in letters' && W.book.meta.annotation.length === 2 && W.book.meta.genres.includes('adventure'), { sub: W.book.meta.subtitle, ann: W.book.meta.annotation.length, genres: W.book.meta.genres });
    // Cover: generate and apply.
    B.wr.showWriterPane({ kind: 'cover' });
    await waitFor(() => document.querySelector('.wr-designs .wr-design'));
    document.querySelectorAll('.wr-design')[3].click();
    document.querySelectorAll('.wr-pal')[1].click();
    [...document.querySelectorAll('.wr-pane .ed-btn')].find((b) => /Use this cover/.test(b.textContent)).click();
    await waitFor(() => W.book.meta.cover, 5000);
    const cov = W.book.images[W.book.meta.cover];
    ok('generated cover', cov && cov.type === 'image/jpeg' && cov.data.length > 5000 && cov.data[0] === 0xff, cov && { type: cov.type, size: cov.data.length, design: W.book.meta.coverDesign });
    // Styles: a paragraph style through the dialog.
    [...document.querySelectorAll('.wr-navi')].find((b) => /Styles/.test(b.textContent)).click();
    await waitFor(() => document.querySelector('.wr-st'));
    [...document.querySelectorAll('.wr-st-add .ed-btn')][0].click();
    await sleep(100);
    const sname = document.querySelector('.wr-st-form input[type=text]');
    sname.value = 'Letter'; sname.dispatchEvent(new Event('input'));
    [...document.querySelectorAll('.wr-st-flags .ed-chip')][1].click();
    [...document.querySelectorAll('.ed-dlg-foot .ed-btn')].find((b) => /Apply/.test(b.textContent)).click();
    await sleep(200);
    ok('style created', W.book.styles.length === 1 && W.book.styles[0].name === 'Letter' && W.book.styles[0].props.italic, W.book.styles);
    // Apply it to a paragraph in chapter 1.
    document.querySelector(`.wr-node[data-id="${ch1.id}"]`).click();
    await waitFor(() => W.sel.id === ch1.id && doc());
    const pp = doc().querySelectorAll('p')[1];
    doc().focus();
    const r6 = document.createRange(); r6.selectNodeContents(pp); r6.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r6);
    await sleep(150);
    const ssel = document.querySelector('.wr-style');
    ssel.value = W.book.styles[0].id; ssel.dispatchEvent(new Event('change'));
    await sleep(600);
    ok('style applied', ch1.blocks[1].style === W.book.styles[0].id, ch1.blocks.map((b) => b.style || ''));
    // Check pane with format tests.
    B.wr.showWriterPane({ kind: 'check' });
    const files = await waitFor(() => document.querySelectorAll('.wr-file').length === 3 && [...document.querySelectorAll('.wr-file')], 8000);
    ok('format checks pass', files && files.every((f) => f.classList.contains('wr-lv-ok')), files && files.map((f) => f.textContent));
    ok('issues listed', document.querySelectorAll('.wr-issue').length > 0, [...document.querySelectorAll('.wr-issue')].map((x) => x.textContent.slice(0, 50)));
    // Exports: EPUB 3 and FB2 through the menu, read back, validated.
    for (const [label, fmt] of [['EPUB 3', 'epub'], ['FB2', 'fb2'], ['EPUB 2', 'epub2'], ['Markdown', 'markdown']]) {
      [...document.querySelectorAll('.wr-tbtn')].find((b) => /Export/.test(b.textContent)).click();
      await sleep(80);
      menuItem(new RegExp('^' + label + '$')).click();
      await waitFor(() => downloads.some((d) => d.fmt === undefined));
      const d = downloads[downloads.length - 1];
      d.fmt = fmt;
      const bytes = await fetchBytes(d.href);
      const back = await L.readBook(bytes, d.name);
      const chk = fmt === 'fb2' ? L.checkFB2(new TextDecoder().decode(bytes)) : /epub/.test(fmt) ? await L.checkEpub(bytes) : { ok: true };
      const bt = back.book;
      const notes = bt.notes.length;
      const text = JSON.stringify(bt.sections);
      ok('export ' + label, chk.ok && bt.meta.title === 'Letters from the Breakwater' && text.includes('long tide') && (fmt === 'markdown' || notes === 1) && (fmt === 'markdown' || !!bt.meta.cover), { name: d.name, size: bytes.length, notes, cover: !!bt.meta.cover, errors: chk.errors && chk.errors.length, styles: bt.styles.length });
    }
    // Save to the library and read it.
    [...document.querySelectorAll('.wr-tbtn')].find((b) => /Save to library/.test(b.textContent)).click();
    await waitFor(() => W.rec.libraryId);
    const libId = W.rec.libraryId;
    const shelf = await B.db.shelf();
    ok('saved to library', shelf.some((x) => x.id === libId && x.title === 'Letters from the Breakwater' && x.thumb), shelf.map((x) => x.title));
    // Preview from the writer, then back.
    [...document.querySelectorAll('.wr-tbtn')].find((b) => /Preview/.test(b.textContent)).click();
    const PR = await waitFor(() => B.S.reader && B.S.reader.preview && B.S.reader.el.flow.querySelector('[data-k]') && B.S.reader);
    ok('preview in reader', !!PR && PR.id === 'draft:' + W.id, PR && PR.units.length);
    PR.el.top.querySelector('.rd-btn').click();
    const W2 = await waitFor(() => B.S.writer && B.S.writer.el.root && B.S.writer);
    ok('back to the writer', !!W2 && W2.book.meta.title === 'Letters from the Breakwater' && W2.book.notes.length === 1, W2 && W2.sel);
    // The draft was autosaved.
    const rec = await B.db.getDraft(W2.id);
    ok('draft autosaved', rec && rec.book.meta.subtitle === 'A novel in letters' && rec.book.styles.length === 1 && !!rec.book.meta.cover, rec && rec.book.meta.modified);
    // Library book -> edit -> continues the same draft.
    B.go('library');
    await waitFor(() => document.querySelector('.bk-card'));
    const shelfRec = (await B.db.shelf()).find((x) => x.id === libId);
    B.go('read', libId);
    const RR = await waitFor(() => B.S.reader && !B.S.reader.preview && B.S.reader.el.flow.querySelector('[data-k]') && B.S.reader);
    ok('library copy reads', !!RR && RR.book.notes.length === 1, RR && RR.units.length);
    B.go('library');
    await sleep(300);
    // Drafts list with a context menu.
    B.go('write');
    await waitFor(() => document.querySelector('.wr-draft'));
    ctx(document.querySelector('.wr-draft'));
    await sleep(120);
    ok('drafts context menu', !!menuItem(/Duplicate the draft/), [...document.querySelectorAll('.ed-ctx-menu .ed-menu-item')].map((b) => b.textContent).slice(0, 5));
    esc();
    // Opening an existing EPUB in the writer keeps its structure.
    const sample = L.sampleBook();
    const epub = await L.writeBook(sample, 'epub');
    const back = (await L.readBook(epub.data, 's.epub')).book;
    const id = await B.wr.newDraftFrom(back);
    B.go('write', id);
    const W3 = await waitFor(() => B.S.writer && B.S.writer.id === id && B.S.writer.ed && B.S.writer);
    ok('sample opens in the writer', !!W3 && document.querySelectorAll('.wr-node').length >= 6 && W3.book.notes.length === sample.notes.length, W3 && { nodes: document.querySelectorAll('.wr-node').length, notes: W3.book.notes.length });
    // The editor round trip leaves a chapter unchanged: open every section, flush, compare.
    const sig = (b) => JSON.stringify(b.sections.map(function rec(s) { return [s.title, s.blocks.map((x) => x.type), s.sections.map(rec)]; }));
    const s0 = sig(W3.book);
    for (const n of [...document.querySelectorAll('.wr-node')].map((x) => x.dataset.id)) { B.wr.showWriterPane({ kind: 'section', id: n }); await sleep(30); W3.ed.flush(); }
    B.wr.showWriterPane({ kind: 'meta' });
    ok('editor round trip keeps structure', sig(W3.book) === s0, s0 === sig(W3.book) ? null : [s0.slice(0, 300), sig(W3.book).slice(0, 300)]);
    B.go('library');
    await sleep(400);
    ok('missing keys', !(window.__edMissingKeys && window.__edMissingKeys.size), window.__edMissingKeys ? [...window.__edMissingKeys] : []);
  } catch (e) {
    steps.push(['exception', 'FAIL', String(e && e.stack || e).slice(0, 900)]);
  } finally { HTMLAnchorElement.prototype.click = click0; }
  return { steps };
}
