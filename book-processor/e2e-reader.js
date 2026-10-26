// book-processor/e2e-reader.js - end-to-end scenario for the built page:
//   node check.js e2e book-processor/html@5_offline_singlefile/index.html book-processor/e2e-reader.js
// Formats written and validated in the page, import into the library (EPUB, FB2.ZIP, windows-1251 FB2, Markdown,
// duplicates), the library context menu, the reader (pages, contents and its menu, search, footnotes, highlights,
// the text context menu with Select text, marks, layouts, position memory, keyboard).
// Contract with check.js: this function is serialized and run inside the page, so it is self-contained and uses
// the app's own code through window.__bk (lib, rd, panels) instead of imports. Books are generated and written in
// the page (sampleBook -> writeBook), so the test needs no fixture files, and each step records ok / FAIL instead
// of throwing so one regression does not hide the rest of the report.
export default async function () {
  const steps = [];
  const ok = (name, cond, v) => steps.push([name, cond ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(50); } return null; };
  try {
    await waitFor(() => window.__bk && window.__bk.ready);
    const B = window.__bk, L = B.lib;
    // Formats written and checked in the page.
    const sample = L.sampleBook();
    const epub = await L.writeBook(sample, 'epub');
    const epub2 = await L.writeBook(sample, 'epub2');
    const fb2 = await L.writeBook(sample, 'fb2');
    const fz = await L.writeBook(sample, 'fb2.zip');
    const ce = await L.checkEpub(epub.data), ce2 = await L.checkEpub(epub2.data), cf = L.checkFB2(fb2.data);
    ok('epub3 valid', ce.ok, { errors: ce.errors.length, warnings: ce.warnings.length, size: epub.data.length });
    ok('epub2 valid', ce2.ok, { errors: ce2.errors.length, version: ce2.version });
    ok('fb2 valid', cf.ok, { errors: cf.errors.length, size: fb2.data.length });
    // A Windows-1251 FB2 (the encoding comes from the XML declaration).
    const ru = '<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>prose_contemporary</genre><author><first-name>Иван</first-name><last-name>Морев</last-name></author><book-title>Тихая гавань</book-title><lang>ru</lang></title-info></description><body><section><title><p>Глава первая</p></title><p>Прилив пришёл в четверть пятого.</p></section></body></FictionBook>';
    const enc = new Uint8Array([...ru].map((ch) => { const c = ch.charCodeAt(0); if (c < 128) return c; if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0; if (c === 0x451) return 0xb8; if (c === 0x401) return 0xa8; return 63; }));
    const files = [
      new File([epub.data], 'saltmarsh.epub', { type: 'application/epub+zip' }),
      new File([fz.data], 'saltmarsh.fb2.zip', { type: 'application/zip' }),
      new File([enc], 'harbour.fb2'),
      new File(['# Notes on Tides\n\n## The first tide\n\nWater *rises* twice a day.\n\n## The second tide\n\nAnd **falls** again.\n'], 'tides.md', { type: 'text/markdown' }),
    ];
    const res = await L.importFiles(files);
    ok('import 4 files', res.length === 4 && res.every((r) => !r.duplicate), res.map((r) => r.title));
    const again = await L.importFiles([new File([epub.data], 'copy.epub')]);
    ok('duplicate detected', again.length === 1 && again[0].duplicate, again);
    B.go('library');
    await waitFor(() => document.querySelectorAll('.bk-card').length === 4);
    ok('shelf shows 4 books', document.querySelectorAll('.bk-card').length === 4, [...document.querySelectorAll('.bk-card-title')].map((x) => x.textContent));
    const cyr = [...document.querySelectorAll('.bk-card-title')].some((x) => x.textContent === 'Тихая гавань');
    ok('windows-1251 title decoded', cyr, null);
    // Library context menu (right click on a card).
    const card = document.querySelector('.bk-card');
    const r0 = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r0.left + 20, clientY: r0.top + 20, button: 2 }));
    await sleep(100);
    const menuItems = [...document.querySelectorAll('.ed-ctx-menu .ed-menu-item')].map((b) => b.textContent);
    ok('library context menu', menuItems.length > 8 && menuItems.some((x) => /Read/.test(x)), menuItems.slice(0, 4));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(50);
    // Reader.
    const id = res[0].id;
    B.go('read', id);
    const R = await waitFor(() => B.S.reader && B.S.reader.el.flow.querySelector('[data-k]') && B.S.reader);
    ok('reader opened', !!R, R && { pages: R.pages, chunks: R.chunks.length, units: R.units.length, layout: R.geo && R.geo.mode });
    const p0 = R.page, c0 = R.chunk;
    B.rd.next();
    await sleep(400);
    ok('next page', R.page !== p0 || R.chunk !== c0, { page: R.page, chunk: R.chunk });
    // Contents panel, go to the second top-level chapter.
    B.panels.openPanel('toc');
    await sleep(100);
    const tocItems = [...R.el.panel.querySelectorAll('.rd-toc-item')];
    ok('toc entries', tocItems.length >= 4, tocItems.map((b) => b.querySelector('.rd-toc-t').textContent));
    const target = tocItems.find((b) => /Chapter|Part|II/i.test(b.textContent) && b.dataset.k !== '0') || tocItems[2];
    target.click();
    await sleep(500);
    ok('toc navigation', R.pos.k >= +target.dataset.k - 1, { k: R.pos.k, want: target.dataset.k });
    // TOC context menu.
    B.panels.closePanel();
    B.panels.openPanel('toc');
    await sleep(100);
    const ti = R.el.panel.querySelectorAll('.rd-toc-item')[2];
    const tr = ti.getBoundingClientRect();
    ti.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: tr.left + 10, clientY: tr.top + 5, button: 2 }));
    await sleep(100);
    const tocMenu = [...document.querySelectorAll('.ed-ctx-menu .ed-menu-item')].map((b) => b.textContent);
    ok('toc context menu', tocMenu.some((x) => /writer/i.test(x)), tocMenu);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    B.panels.closePanel();
    // Search.
    B.panels.openPanel('search');
    await sleep(80);
    const input = R.el.panel.querySelector('input[type=search]');
    input.value = 'tide';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(150);
    const hits = R.el.panel.querySelectorAll('.rd-res');
    ok('search finds', hits.length > 0, hits.length);
    if (hits[0]) { hits[0].click(); await sleep(500); }
    ok('search jump flashes', !!R.el.flow.querySelector('mark.rd-flash'), R.pos);
    B.panels.closePanel();
    // Footnote popup.
    await B.rd.goTo(0);
    let note = null;
    for (let i = 0; i < 60 && !note; i++) {
      note = [...R.el.flow.querySelectorAll('a.noteref')].find((a) => { const r = a.getBoundingClientRect(); const c = R.el.clip.getBoundingClientRect(); return r.width && r.left >= c.left && r.right <= c.right + 1; });
      if (!note) { B.rd.next(); await sleep(120); }
    }
    if (note) { note.click(); await sleep(150); }
    const pop = document.querySelector('.rd-pop .rd-note');
    ok('footnote popover', !!pop && pop.textContent.length > 5, pop && pop.textContent.slice(0, 60));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(50);
    // Highlight from a selection.
    const unit = [...R.el.flow.querySelectorAll('p[data-k]')].find((p) => { const r = p.getBoundingClientRect(); const c = R.el.clip.getBoundingClientRect(); return p.textContent.length > 40 && r.left >= c.left - 1 && r.right <= c.right + 1; });
    const tn = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT).nextNode();
    const rg = document.createRange();
    rg.setStart(tn, 0); rg.setEnd(tn, Math.min(18, tn.length));
    getSelection().removeAllRanges(); getSelection().addRange(rg);
    const span = B.rd.selectionSpan();
    ok('selection span', !!span && span.k1 === +unit.dataset.k, span);
    await sleep(350);
    ok('selection bar shown', !!document.querySelector('.rd-selbar'), null);
    await B.rd.addHighlight(span, 'green', 'A note on the tide');
    ok('highlight painted', !!R.el.flow.querySelector('mark.rd-hl.rd-hl-green.rd-hl-note'), R.marks.highlights.length);
    // Context menu on the text (right click): bookmark here.
    const ur = unit.getBoundingClientRect();
    const bmBefore = R.marks.bookmarks.length;
    unit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ur.left + ur.width / 2, clientY: ur.top + 8, button: 2 }));
    await sleep(120);
    const txtMenu = [...document.querySelectorAll('.ed-ctx-menu .ed-menu-item')];
    ok('text context menu', txtMenu.length >= 5, txtMenu.map((b) => b.textContent));
    const bmItem = txtMenu.find((b) => /Bookmark here/.test(b.textContent));
    if (bmItem) bmItem.click();
    await sleep(200);
    ok('bookmark from the menu', R.marks.bookmarks.length === bmBefore + 1, R.marks.bookmarks.map((b) => [b.k, b.o]));
    // "Select text" from the menu hands selection to the system (ui/contextmenu.js ignores a second menu within 800 ms).
    await sleep(900);
    unit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ur.left + ur.width / 2, clientY: ur.top + 8, button: 2 }));
    await sleep(120);
    const sel = [...document.querySelectorAll('.ed-ctx-menu .ed-menu-item')].find((b) => /Select text/.test(b.textContent));
    if (sel) sel.click();
    await sleep(300);
    ok('select text mode', R.el.root.classList.contains('rd-selecting') && !getSelection().isCollapsed, getSelection().toString());
    getSelection().removeAllRanges();
    await sleep(350);
    ok('select mode ends', !R.el.root.classList.contains('rd-selecting'), null);
    // Marks panel.
    B.panels.openPanel('marks');
    await sleep(80);
    ok('marks panel lists', R.el.panel.querySelectorAll('.rd-mark').length === R.marks.bookmarks.length + R.marks.highlights.length, R.el.panel.querySelectorAll('.rd-mark').length);
    B.panels.closePanel();
    // Settings: scroll layout, sepia, bigger text; position kept.
    const posBefore = B.rd.currentPos();
    B.rd.setPrefs({ layout: 'scroll', theme: 'sepia', size: 22 });
    await sleep(400);
    const posScroll = B.rd.currentPos();
    ok('scroll layout keeps position', R.geo.mode === 'scroll' && Math.abs(posScroll.k - posBefore.k) <= 2, { before: posBefore, after: posScroll });
    B.rd.setPrefs({ layout: 'auto', theme: 'light', size: 19 });
    await sleep(400);
    ok('paged again', R.geo.mode !== 'scroll', R.geo.mode);
    // Position memory: leave and come back.
    for (let i = 0; i < 3; i++) { B.rd.next(); await sleep(150); }
    await sleep(450);
    const saved = B.rd.currentPos();
    B.go('library');
    await waitFor(() => !B.S.reader && document.querySelector('.bk-continue'));
    const rec = await B.db.getShelf(id);
    ok('position saved', rec.pos && rec.pos.k === saved.k && rec.progress > 0, { pos: rec.pos, progress: rec.progress });
    ok('continue reading card', !!document.querySelector('.bk-continue'), document.querySelector('.bk-continue strong')?.textContent);
    B.go('read', id);
    const R2 = await waitFor(() => B.S.reader && B.S.reader.el.flow.querySelector('[data-k]') && B.S.reader);
    await sleep(300);
    const back = B.rd.currentPos();
    ok('position restored', Math.abs(back.k - saved.k) <= 1, { saved, back });
    ok('highlight restored', R2.marks.highlights.length === 1 && R2.marks.bookmarks.length >= 1, { h: R2.marks.highlights.length, b: R2.marks.bookmarks.length });
    // Keyboard turns pages.
    const before = [R2.chunk, R2.page];
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(300);
    ok('arrow key turns', R2.chunk !== before[0] || R2.page !== before[1], [R2.chunk, R2.page]);
    // The Markdown and FB2 books open too.
    for (const r of res.slice(1)) {
      B.go('read', r.id);
      const Rx = await waitFor(() => B.S.reader && B.S.reader.id === r.id && B.S.reader.el.flow.querySelector('[data-k]') && B.S.reader);
      ok('open ' + r.title, !!Rx && Rx.units.length > 1, Rx && Rx.units.length);
    }
    B.go('library');
    await sleep(300);
    ok('missing keys', !(window.__edMissingKeys && window.__edMissingKeys.size), window.__edMissingKeys ? [...window.__edMissingKeys] : []);
  } catch (e) {
    steps.push(['exception', 'FAIL', String(e && e.stack || e).slice(0, 800)]);
  }
  return { steps };
}
