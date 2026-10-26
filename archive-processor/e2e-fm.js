// archive-processor/e2e-fm.js - end-to-end scenario of the commander in the built page:
//   node check.js e2e archive-processor/html@5_offline_singlefile/index.html archive-processor/e2e-fm.js --lang en
// Files dropped on a panel, Far keys (arrows, Insert, Ctrl+A, Tab, Enter, Backspace, Ctrl+PgDn / PgUp, F2 pack, F3 view,
// F5 copy, F7 folder, F8 delete, F9 properties, F10 compare, Shift+F9 test), a tar.gz created, opened as a folder and
// extracted into the other panel, the hex viewer (structure, search, go to, text mode), MIME types by signature, the
// command line.
// 
// Keys are dispatched as synthetic KeyboardEvents to the focused element (bubbling to the commander's single handler),
// so the test exercises the same delegation path as a real keyboard.
export default async function () {
  const steps = [];
  const ok = (name, cond, value) => steps.push([name, cond ? 'ok' : 'FAIL', value]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { let v; try { v = fn(); } catch { v = null; } if (v) return v; await sleep(40); } return null; };
  const te = new TextEncoder();
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const TEXT = 'The quick brown fox jumps over the lazy dog.\n'.repeat(200) + 'Съешь же ещё этих мягких французских булок.\n';
  const root = () => document.querySelector('.fm');
  const panel = (i) => document.querySelector(`.fm-panel[data-panel="${i}"]`);
  const list = (i) => panel(i).querySelector('.fm-list');
  const names = (i) => [...panel(i).querySelectorAll('.fm-item')].sort((a, b) => +a.dataset.i - +b.dataset.i).map((r) => r.dataset.name);
  const cur = (i) => { const r = panel(i).querySelector('.fm-item.fm-cur'); return r ? r.dataset.name : null; };
  const active = () => +document.querySelector('.fm-panel.fm-active').dataset.panel;
  const key = (k, o = {}) => (document.activeElement && root().contains(document.activeElement) ? document.activeElement : list(active())).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const dialog = () => [...document.querySelectorAll('.ed-backdrop:not(.ed-out) .ed-dialog')].pop();
  const primary = () => dialog().querySelector('.ed-dlg-foot .ed-primary').click();
  const closeDialog = async () => { const d = dialog(); if (d) d.querySelector('.ed-dlg-head .ed-iconbtn').click(); await until(() => !dialog(), 3000); };
  const cursorTo = async (i, name) => {
    key('Home');
    for (let k = 0; k < 50 && cur(i) !== name; k++) key('ArrowDown');
    return cur(i) === name;
  };
  const fm = () => window.__archproc.commander();
  const text = (b) => b.text();

  await until(() => document.documentElement.dataset.engine && document.documentElement.dataset.engine !== 'starting', 10000);
  ok('engine', document.documentElement.dataset.engine === 'worker', document.documentElement.dataset.engine);
  // 1. start screen -> commander
  const startBtn = await until(() => document.querySelector('.ax-start-actions .ed-btn'));
  startBtn.click();
  ok('commander opens', await until(() => panel(0) && panel(1)), !!root());
  // 2. files dropped on the left panel
  const dt = new DataTransfer();
  dt.items.add(new File([te.encode(TEXT)], 'notes.txt', { lastModified: 1700000000000 }));
  dt.items.add(new File([PNG], 'pixel.png'));
  dt.items.add(new File([PNG], 'picture.bin'));
  dt.items.add(new File([te.encode('{"a": [1, 2, 3]}')], 'data'));
  panel(0).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  ok('files dropped', await until(() => names(0).length === 4), names(0));
  // 3. MIME by signature in the type column (picture.bin is a PNG, "data" is JSON)
  const typeOf = (i, name) => { const r = panel(i).querySelector(`.fm-item[data-name="${name}"] .fm-c-type`); return r && r.textContent; };
  ok('type column by signature', await until(() => typeOf(0, 'picture.bin') === 'PNG image' && typeOf(0, 'data') === 'JSON'), [typeOf(0, 'picture.bin'), typeOf(0, 'data')]);
  // 4. keyboard: Home, Insert x2 selects two files, Ctrl+A selects all, * inverts
  list(0).focus();
  key('Home'); key('Insert'); key('Insert');
  ok('Insert selects', fm().state.panels[0].sel.size === 2 && /2/.test(panel(0).querySelector('.fm-info').textContent), [...fm().state.panels[0].sel]);
  key('*');
  ok('* inverts', fm().state.panels[0].sel.size === 2 && !fm().state.panels[0].sel.has(names(0)[0]), [...fm().state.panels[0].sel]);
  key('a', { ctrlKey: true });
  ok('Ctrl+A selects all', fm().state.panels[0].sel.size === 4);
  // 5. F2: pack the selection as tar.gz
  key('F2');
  await until(() => dialog() && dialog().querySelector('.fm-pack-fmt'));
  const fmtSel = dialog().querySelector('.fm-pack-fmt');
  fmtSel.value = 'tar.gz'; fmtSel.dispatchEvent(new Event('change'));
  dialog().querySelector('.fm-pack-name').value = 'bundle.tar.gz';
  primary();
  ok('tar.gz created', await until(() => names(0).includes('bundle.tar.gz')), names(0));
  ok('selection cleared after packing', fm().state.panels[0].sel.size === 0);
  ok('tar.gz type by signature', await until(() => /tar\.gz|gzip/.test(typeOf(0, 'bundle.tar.gz') || '')), typeOf(0, 'bundle.tar.gz'));
  // 6. Enter opens the archive as a folder
  ok('cursor to the archive', await cursorTo(0, 'bundle.tar.gz'), cur(0));
  key('Enter');
  ok('archive opens as a folder', await until(() => names(0).includes('notes.txt') && names(0)[0] === '..'), names(0));
  ok('path shows the archive', /bundle\.tar\.gz:\//.test(panel(0).querySelector('.fm-path-t').textContent), panel(0).querySelector('.fm-path-t').textContent);
  ok('badge shows the format', /tar\.gz/.test(panel(0).querySelector('.fm-badge').textContent), panel(0).querySelector('.fm-badge').textContent);
  // 7. Tab, F7 makes a folder in the right panel, Enter goes in, Tab back
  key('Tab');
  ok('Tab switches panels', active() === 1);
  key('F7');
  await until(() => dialog() && dialog().querySelector('input'));
  dialog().querySelector('input').value = 'out';
  primary();
  ok('F7 makes a folder', await until(() => names(1).includes('out')), names(1));
  await cursorTo(1, 'out');
  key('Enter');
  ok('Enter goes into the folder', await until(() => names(1)[0] === '..' && fm().api.locText(1) === '/out'), fm().api.locText(1));
  key('Tab');
  // 8. Ctrl+A, F5: extract everything from the archive into the other panel
  key('a', { ctrlKey: true });
  key('F5');
  await until(() => dialog() && dialog().querySelector('.fm-dest'));
  ok('copy dialog shows the destination', /\/out/.test(dialog().querySelector('.fm-dest').textContent), dialog().querySelector('.fm-dest').textContent);
  primary();
  ok('F5 extracts into the other panel', await until(() => ['notes.txt', 'pixel.png', 'picture.bin', 'data'].every((n) => names(1).includes(n))), names(1));
  const outDir = fm().state.ws.kids.get('out');
  const extracted = outDir && outDir.kids.get('notes.txt');
  ok('extracted data matches', extracted && (await text(extracted.blob)) === TEXT, extracted && extracted.size);
  // 9. a file copied into the archive (repacked), F8 deletes it again
  key('Tab');
  await cursorTo(1, 'data');
  key('F6', { shiftKey: true });
  await until(() => dialog() && dialog().querySelector('input'));
  dialog().querySelector('input').value = 'data.json';
  primary();
  ok('Shift+F6 renames', await until(() => names(1).includes('data.json')), names(1));
  await cursorTo(1, 'data.json');
  key('F5');
  await until(() => dialog() && dialog().querySelector('.fm-dest'));
  primary();
  ok('copy into the archive', await until(() => names(0).includes('data.json')), names(0));
  ok('archive rewritten', /bundle\.tar\.gz/.test(document.querySelector('.fm-out').textContent), document.querySelector('.fm-out').textContent.slice(-120));
  key('Tab');
  await cursorTo(0, 'data.json');
  key('F8');
  await until(() => dialog());
  primary();
  ok('F8 deletes inside the archive', await until(() => !names(0).includes('data.json') && names(0).includes('notes.txt')), names(0));
  // 10. Shift+F9 tests the archive under the cursor's panel
  key('F9', { shiftKey: true });
  const rep = await until(() => document.querySelector('.fm-test .ax-test-head'));
  ok('Shift+F9 tests the archive', rep && rep.classList.contains('ax-good'), rep && rep.textContent);
  await closeDialog();
  // 11. Backspace leaves the archive with the cursor on it; Ctrl+PgDn / Ctrl+PgUp
  list(0).focus();
  key('Backspace');
  ok('Backspace leaves the archive', await until(() => fm().api.locText(0) === '/' && cur(0) === 'bundle.tar.gz'), [fm().api.locText(0), cur(0)]);
  key('PageDown', { ctrlKey: true });
  ok('Ctrl+PgDn enters', await until(() => /bundle\.tar\.gz:/.test(fm().api.locText(0))), fm().api.locText(0));
  key('PageUp', { ctrlKey: true });
  ok('Ctrl+PgUp leaves', await until(() => fm().api.locText(0) === '/'), fm().api.locText(0));
  // 12. F3: hex viewer of the PNG with its chunks, search, go to, text mode
  await cursorTo(0, 'pixel.png');
  key('F3');
  const hv = await until(() => document.querySelector('.hx-dlg') && window.__hexview && document.querySelector('.hx-line .hx-b'));
  ok('F3 opens the hex viewer', !!hv && window.__hexview.st.mode === 'hex', window.__hexview && window.__hexview.st.mode);
  const firstBytes = [...document.querySelectorAll('.hx-line')[0].querySelectorAll('.hx-b')].slice(0, 4).map((b) => b.textContent).join(' ');
  ok('hex dump', firstBytes === '89 50 4e 47', firstBytes);
  ok('PNG structure listed', await until(() => /PNG/.test((document.querySelector('.hx-side-h') || {}).textContent || '') && document.querySelectorAll('.hx-field').length >= 8), document.querySelectorAll('.hx-field').length);
  ok('PNG CRCs checked', [...document.querySelectorAll('.hx-field')].filter((f) => /CRC/.test(f.textContent)).every((f) => /✓/.test(f.textContent)));
  await window.__hexview.find('IDAT');
  ok('text search', window.__hexview.st.cur === 37 && await until(() => document.querySelectorAll('.hx-b.hx-m').length === 4), window.__hexview.st.cur);
  await window.__hexview.find('49 45 4e 44', { hex: true });
  ok('hex search', window.__hexview.st.cur === PNG.length - 8, window.__hexview.st.cur);
  window.__hexview.goto('0x0c');
  ok('go to offset', window.__hexview.st.cur === 12 && await until(() => /Chunk type/.test(document.querySelector('.hx-status').textContent)), document.querySelector('.hx-status').textContent);
  document.querySelector('.hx-dlg').dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));
  ok('F4 switches to text', await until(() => window.__hexview.st.mode === 'text' && !document.querySelector('.hx-text').hidden), window.__hexview.st.mode);
  window.__hexview.setEncoding('windows-1251');
  window.__hexview.setMode('hex');
  await closeDialog();
  ok('viewer closes', await until(() => !document.querySelector('.hx-dlg')));
  // 13. F9: properties with the MIME type by signature and checksums
  list(0).focus();
  await cursorTo(0, 'picture.bin');
  key('F9');
  const sums = await until(() => { const d = dialog(); const dd = d && d.querySelector('.fm-sums dd[data-algo="sha256"] code'); return dd && d; });
  ok('F9 shows the MIME type', sums && /image\/png/.test(sums.textContent) && /magic number/.test(sums.textContent), sums && sums.querySelector('.ax-kv').textContent.slice(0, 200));
  ok('CRC-32 of the file', sums && sums.querySelector('.fm-sums dd[data-algo="crc32"]').textContent.trim().length === 8, sums && sums.querySelector('.fm-sums dd[data-algo="crc32"]').textContent);
  await closeDialog();
  // 14. F10: compare two files (identical PNG data)
  const p0 = fm().state.panels[0];
  p0.sel.clear(); p0.sel.add('pixel.png'); p0.sel.add('picture.bin');
  key('F10');
  const cmp = await until(() => document.querySelector('.fm-cmp .ax-test-head'));
  ok('F10 compares', cmp && cmp.classList.contains('ax-good'), cmp && cmp.textContent);
  await closeDialog();
  p0.sel.clear();
  // 15. the command line: typing goes there, Enter runs it
  list(0).focus();
  key('m');
  const cmdInput = document.querySelector('.fm-cmd-input');
  ok('typing goes to the command line', cmdInput.value === 'm' && document.activeElement === cmdInput, cmdInput.value);
  cmdInput.value += 'ime data'; // the rest typed into the focused field
  ok('arrows still move the panel cursor', (() => { const was = cur(0); key('ArrowDown'); return cur(0) !== was && document.activeElement === cmdInput; })(), cur(0));
  cmdInput.focus();
  key('Enter');
  ok('command runs', await until(() => /application\/json/.test(document.querySelector('.fm-out').textContent)), document.querySelector('.fm-out').textContent.slice(-160));
  // 16. Alt+F7 finds files by mask
  key('F7', { altKey: true });
  await until(() => dialog() && dialog().querySelector('.fm-find-mask'));
  dialog().querySelector('.fm-find-mask').value = '*.txt';
  primary();
  ok('Alt+F7 finds', await until(() => dialog().querySelectorAll('.fm-result').length === 2), [...dialog().querySelectorAll('.fm-result')].map((x) => x.textContent));
  await closeDialog();
  // 17. back to the classic view and again
  window.__archproc.leaveCommander();
  ok('classic view', await until(() => document.querySelector('.ax-start') && !root()), !!document.querySelector('.ax-start'));
  window.__archproc.renderCommander();
  ok('commander keeps its workspace', await until(() => names(0).includes('bundle.tar.gz')), names(0));
  return { steps };
}
