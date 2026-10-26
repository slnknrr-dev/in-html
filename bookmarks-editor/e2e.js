// bookmarks-editor/e2e.js - in-page end-to-end scenario of Bookmarks, run by check.js:
//   node check.js e2e bookmarks-editor/html@5_offline_singlefile/index.html bookmarks-editor/e2e.js
// Adds (typed and pasted links), edits from the context menu (right click) and selects with a long press by touch,
// imports a Netscape bookmark file, searches with the query language and suggestions, finds and merges duplicates,
// works on a selection (keys, bulk bar, tags, delete and undo), drags bookmarks onto a folder, exports a bookmark file
// and checks what reached IndexedDB. Returns { steps }. The function is serialized: it must not use imports.
//
// Technique: drive the real UI through DOM events (input, keydown, contextmenu, pointer events for long press) and
// poll with until() instead of fixed sleeps: assertions wait for the state, so the test is fast when the UI is fast
// and tolerant when it is slow. Each step records ok / FAIL and the scenario continues, so one failure does not hide
// the rest of the report.
export default async function scenario() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = f(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 120));
      await sleep(30);
    }
  };
  const R = { steps: [] };
  const step = async (name, fn) => {
    try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 500)]); }
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // The dialog on top (a closing one fades out for a moment).
  const dialog = () => $$('.ed-backdrop:not(.ed-out) .ed-dialog').pop() || null;
  const closeDialogs = async () => { for (let i = 0; i < 4 && $('.ed-backdrop:not(.ed-out)'); i++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(250); } };
  const typeInto = (el, value) => { el.focus(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (el, k, opts = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const button = (root, text) => $$('button', root).find((b) => b.textContent.trim() === text || b.textContent.includes(text));
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(20, r.height / 2) }; };

  await until(() => window.__bmReady, 15000);
  const { S, UI } = window.__bm;
  const L = () => S.lib;
  const byUrl = (u) => L().bookmarks().find((b) => b.url === u);

  await step('empty library: welcome', async () => (await until(() => $('.bm-welcome'))) && L().stats().total);

  await step('add: typed address, title from the address, tag chip', async () => {
    $('.bm-add').click();
    const d = await until(dialog);
    const url = $('input[inputmode="url"]', d);
    typeInto(url, 'example.com/my-great-article');
    const tag = $('.bm-chip-in', d);
    typeInto(tag, 'news');
    key(tag, 'Enter');
    await sleep(50);
    button(d, 'Add').click();
    await until(() => !$('.ed-backdrop:not(.ed-out)'));
    const b = byUrl('https://example.com/my-great-article');
    if (!b) throw new Error('not added');
    return [b.title, b.tags];
  });

  await step('add: pasted text with a link and a title', async () => {
    UI.edit(null);
    const d = await until(dialog);
    const url = $('input[inputmode="url"]', d);
    url.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', 'The Rust book – https://doc.rust-lang.org/book/?utm_source=x');
    url.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(50);
    const title = $$('input.ed-input', d)[1];
    const got = [url.value, title.value];
    button(d, 'Add').click();
    await until(() => !$('.ed-backdrop:not(.ed-out)'));
    return [got, !!byUrl('https://doc.rust-lang.org/book/')];
  });

  await step('add: duplicate warning in the editor', async () => {
    UI.edit(null);
    const d = await until(dialog);
    typeInto($('input[inputmode="url"]', d), 'http://www.example.com/my-great-article/?utm_medium=feed');
    const warn = await until(() => $('.bm-dup', d).textContent);
    await closeDialogs();
    return warn.slice(0, 60);
  });

  await step('context menu by right click: edit', async () => {
    const row = await until(() => $$('.bm-item').find((r) => r.textContent.includes('My great article')));
    const c = center(row);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, button: 2 }));
    const menu = await until(() => $('.ed-ctx-menu .ed-menu'));
    const labels = $$('.ed-menu-item', menu).map((b) => b.textContent.trim());
    button(menu, 'Edit').click();
    const d = await until(dialog);
    const title = $$('input.ed-input', d)[1];
    typeInto(title, 'My great article (edited)');
    button(d, 'Save').click();
    await until(() => !$('.ed-backdrop:not(.ed-out)'));
    return [labels.length, byUrl('https://example.com/my-great-article').title];
  });

  await step('long press by touch: menu with Select, selection mode', async () => {
    await sleep(900); // a menu opened less than 0.8 s ago blocks the next long press (ui/contextmenu.js)
    const row = $$('.bm-item').find((r) => r.textContent.includes('Rust book'));
    const c = center(row);
    const target = $('.bm-main', row);
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: c.x, clientY: c.y }));
    const menu = await until(() => $('.ed-ctx-menu .ed-menu'), 2000);
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: c.x, clientY: c.y }));
    // The click that ends the long press must not open the link or change the selection.
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y }));
    const sel = button(menu, 'Select');
    if (!sel) throw new Error('no Select item: ' + menu.textContent);
    sel.click();
    await sleep(80);
    const r = [S.selectMode, S.selection.size, !!$('.bm-selecting'), !$('.bm-bulk').hidden];
    UI.render();
    $('.bm-bulk button').click(); // leave selection mode
    await sleep(50);
    return r.concat([S.selectMode, S.selection.size]);
  });

  const NETSCAPE = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' +
    '<DT><H3 ADD_DATE="1700000000">Dev</H3>\n<DL><p>\n<DT><A HREF="https://github.com/" ADD_DATE="1700000001" TAGS="dev,code">GitHub</A>\n<DD>Code hosting\n' +
    '<DT><A HREF="https://gist.github.com/x" ADD_DATE="1700000002" TAGS="dev" TOREAD="1">A gist</A>\n<DT><A HREF="https://developer.mozilla.org/" ADD_DATE="1700000003" TAGS="dev,docs">MDN</A>\n</DL><p>\n' +
    '<DT><A HREF="https://example.com/my-great-article" ADD_DATE="1600000000" TAGS="old">Old copy</A>\n<DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1700000004">Hacker News</A>\n</DL><p>\n';

  await step('import a Netscape file: preview, duplicates report, import', async () => {
    const file = new File([NETSCAPE], 'bookmarks_10_14_26.html', { type: 'text/html' });
    UI.transfer('import', { file });
    const d = await until(() => $('.bm-dlg-transfer'));
    const stats = await until(() => $('.bm-stats', d) && $('.bm-stats', d).textContent);
    const report = $('.bm-dupreport summary', d) ? $('.bm-dupreport summary', d).textContent : '';
    $('.bm-imp-go button', d).click();
    await until(() => !$('.ed-backdrop:not(.ed-out)'));
    const imported = L().folders().find((f) => /^Imported/.test(f.name));
    const dev = L().folders().find((f) => f.name === 'Dev');
    return [stats, report, L().stats().total, !!imported, dev && L().tree().parentOf(dev.id) === imported.id, byUrl('https://github.com/').notes];
  });

  const search = async (q) => {
    const inp = $('#bm-q');
    typeInto(inp, q);
    await sleep(250);
    return S.visible.map((b) => b.title);
  };
  await step('search language', async () => {
    const out = {
      tag: await search('tag:dev'), site: await search('site:github.com'), unread: await search('is:unread'),
      exclude: await search('#dev -site:github.com'), phrase: await search('"rust book"'), folder: await search('folder:dev'),
      words: await search('code hosting'),
    };
    await search('');
    return out;
  });

  await step('search suggestions', async () => {
    const inp = $('#bm-q');
    inp.focus();
    inp.value = 'tag:do';
    inp.setSelectionRange(6, 6);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const items = await until(() => $$('#bm-qs .bm-sugg-i').map((li) => li.textContent));
    key(inp, 'ArrowDown');
    key(inp, 'Enter');
    await sleep(250);
    const r = [items, inp.value, S.visible.map((b) => b.title)];
    key(inp, 'Escape');
    await sleep(150);
    inp.blur();
    return r;
  });

  await step('duplicates: found and merged', async () => {
    UI.setView({ kind: 'all' });
    L().add({ url: 'http://www.example.com/my-great-article/?utm_medium=feed', title: 'Copy over http', tags: ['copy'], created: 1500000000000 });
    await sleep(80);
    $$('.bm-toolbar .ed-iconbtn').pop().click();
    const menu = await until(() => $('.ed-menu'));
    button(menu, 'Find duplicates').click();
    const d = await until(() => $('.bm-dlg-dupes'));
    const summary = await until(() => $('.ed-hint[role="status"]', d).textContent);
    const groups = $$('.bm-dupe', d).length;
    button(d, 'Merge all').click();
    await until(() => !$('.ed-backdrop:not(.ed-out)'));
    const b = byUrl('https://example.com/my-great-article');
    return [summary, groups, L().duplicates({ ignoreScheme: true, ignoreWww: true }).length, b && b.tags, b && new Date(b.created).getUTCFullYear()];
  });

  await step('keys and bulk bar: select all, tag, read state, delete and undo', async () => {
    UI.setView({ kind: 'all' });
    const list = $('#bm-list');
    const first = $('.bm-item', list);
    first.focus();
    key(first, 'a', { ctrlKey: true });
    await sleep(50);
    const n = S.selection.size;
    const bulkText = $('.bm-bulk').textContent;
    UI.tags([...S.selection]);
    const d = await until(dialog);
    const inp = $('.bm-chip-in', d);
    typeInto(inp, 'bulk');
    key(inp, 'Enter');
    button(d, 'Apply').click();
    await until(() => !$('.ed-backdrop:not(.ed-out)'));
    const tagged = L().bookmarks().every((b) => b.tags.includes('bulk'));
    button($('.bm-bulk'), 'Read later').click();
    const unread = L().bookmarks().every((b) => b.unread);
    const total = L().stats().total;
    button($('.bm-bulk'), 'Delete').click();
    await sleep(50);
    const after = L().stats().total;
    const undoBtn = await until(() => $$('.ed-toast-act').find((b) => b.textContent.includes('Undo')));
    undoBtn.click();
    await sleep(50);
    return [n, bulkText.slice(0, 20), tagged, unread, total, after, L().stats().total];
  });

  await step('keys on the focused bookmark: favourite, delete, Ctrl+Z', async () => {
    S.selection.clear();
    UI.render();
    const row = $('.bm-item');
    const id = row.dataset.id;
    row.focus();
    key(row, 'f');
    const fav = L().get(id).fav;
    key($('.bm-item[tabindex="0"]'), 'Delete');
    await sleep(50);
    const gone = !L().get(id);
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(50);
    return [fav, gone, !!L().get(id)];
  });

  await step('drag a bookmark onto a folder', async () => {
    const f = L().addFolder({ name: 'Drop target' });
    await sleep(80);
    const row = $$('.bm-item').find((r) => r.textContent.includes('Hacker News'));
    const id = row.dataset.id;
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const target = $(`.bm-tree-row[data-folder="${f.id}"] .bm-tree-b`);
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await sleep(50);
    return [L().get(id).folder === f.id, L().folderCount(f.id)];
  });

  await step('export a bookmark file', async () => {
    let blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { blob = b; return orig.call(URL, b); };
    try {
      UI.transfer('export');
      const d = await until(() => $('.bm-dlg-transfer'));
      $('input[name="bm-fmt"][value="html"]', d).click();
      button(d, 'Download').click();
      await until(() => blob);
    } finally { URL.createObjectURL = orig; }
    const text = await blob.text();
    await closeDialogs();
    return [text.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'), (text.match(/<DT><A /g) || []).length, L().stats().total, /TAGS="[^"]*bulk/.test(text)];
  });

  await step('stored in IndexedDB', async () => {
    await S.flush();
    const recs = await S.store.load();
    return [S.storage, recs.length, L().allRecords().length];
  });

  await step('layouts render', async () => {
    const out = [];
    for (const k of ['cards', 'compact', 'list']) { S.layout = k; UI.render(); out.push($('#bm-list').className.includes('bm-l-' + k) && $$('.bm-item').length); }
    return out;
  });

  await step('no missing strings', async () => [...(window.__edMissingKeys || [])]);
  return R;
}
