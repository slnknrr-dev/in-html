// check-editor.js - in-page end-to-end scenario of the document editors (studio/), run by check.js:
//   node check.js e2e <editor page or artifact> check-editor.js
// Opens a template, selects, types, undoes, inserts every block type, exports (clean / packed / source), switches
// UI language, visits every settings tab, previews, adds a content language and saves. Returns { steps, blocks }.
//
// Constraint: check.js runs this via `(${fn.toString()})()` inside the page, so the function must be fully
// self-contained (no imports, no closure over module scope). It drives the editor through its debug handle
// window.__ed and through real DOM events where the event path itself is under test (clicks, execCommand typing).
// Each step catches its own error, so one failure does not hide the rest; sleeps give debounced saves/renders time.
export default async function scenario() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 10000) => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = f(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 80));
      await sleep(40);
    }
  };
  const R = { steps: [] };
  const step = async (name, fn) => {
    try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 400)]); }
  };
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await until(() => window.__edReady, 15000);
  const E = window.__ed;
  const nBlocks = () => document.querySelectorAll('#ed-canvas [data-bid]').length;

  await step('gallery', async () => (await until(() => document.querySelectorAll('.ed-tpl').length >= 2 && document.querySelectorAll('.ed-tpl'))).length);
  await step('template 0', async () => {
    document.querySelectorAll('.ed-tpl')[0].click();
    await until(() => nBlocks() > 4 && !document.querySelector('.ed-dlg-tpl'));
    return [E.S.doc.name, nBlocks(), E.S.doc.langs.join(',')];
  });
  await step('select block', async () => {
    const el = document.querySelectorAll('#ed-canvas [data-bid]')[1];
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);
    return [E.S.sel && E.S.sel.bid, !!document.querySelector('#ed-right [data-f], #ed-right input, #ed-right select')];
  });
  await step('type text', async () => {
    const f = document.querySelector('#ed-canvas [data-f][contenteditable]');
    f.focus();
    const r = document.createRange();
    r.selectNodeContents(f);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    // execCommand (deprecated but still the only API) fires real beforeinput/input events, unlike setting textContent;
    // 'QZX' is a marker unlikely to occur in templates, so includes() proves the edit reached the document model.
    document.execCommand('insertText', false, ' QZX');
    await sleep(700);
    return JSON.stringify(E.fullDoc()).includes('QZX');
  });
  await step('undo/redo', async () => {
    E.undo();
    await sleep(150);
    const a = JSON.stringify(E.fullDoc()).includes('QZX');
    E.redo();
    await sleep(150);
    return [a, JSON.stringify(E.fullDoc()).includes('QZX')];
  });
  await step('insert every type', async () => {
    const types = Object.keys(E.V.BLOCK_TYPES);
    for (const ty of types) E.insertBlock(ty);
    await sleep(400);
    return [types.length, nBlocks()];
  });
  await step('render all + inspector per type', async () => {
    const seen = new Set();
    for (const el of document.querySelectorAll('#ed-canvas [data-bid]')) {
      const b = E.findBlock(el.dataset.bid);
      if (!b || seen.has(b.block?.type || b.type)) continue;
      seen.add(b.block?.type || b.type);
      E.select(el.dataset.bid);
      await sleep(30);
    }
    return seen.size;
  });
  await step('export clean', async () => {
    const r = await E.V.exportHTML(E.fullDoc(), { mode: 'clean' });
    return [r.bytes > 1000, r.report.types.length, r.report.features.join(',')];
  });
  await step('export packed + source', async () => {
    const r = await E.V.exportHTML(E.fullDoc(), { mode: 'packed', embedSource: true });
    const back = await E.V.extractSource(r.html);
    return [r.bytes > 1000, !!back];
  });
  await step('export dialog', async () => {
    E.openExport();
    const rep = await until(() => {
      const x = document.querySelector('.ed-dlg-export .ed-export-report');
      return x && x.textContent.length > 20 && x.textContent;
    });
    esc();
    await sleep(200);
    return rep.replace(/\s+/g, ' ').slice(0, 60);
  });
  await step('ui language', async () => {
    E.setUILang('de');
    await sleep(250);
    const de = document.querySelector('#ed-top')?.textContent.slice(0, 40);
    E.setUILang('en');
    await sleep(250);
    return de;
  });
  await step('document settings tabs', async () => {
    const tabs = [...document.querySelectorAll('#ed-right [role=tab]')];
    let n = 0;
    for (const tb of tabs) { tb.click(); await sleep(60); n++; }
    const sub = [...document.querySelectorAll('#ed-right [role=tab]')];
    for (const tb of sub) { tb.click(); await sleep(60); }
    return [n, sub.length];
  });
  await step('left tabs', async () => {
    const tabs = [...document.querySelectorAll('#ed-left [role=tab]')];
    for (const tb of tabs) { tb.click(); await sleep(80); }
    return tabs.length;
  });
  await step('preview', async () => {
    const btn = [...document.querySelectorAll('#ed-top button')].find((b) => /preview|просмотр|vorschau/i.test(b.textContent + b.title + (b.getAttribute('aria-label') || '')));
    if (!btn) return 'no button';
    btn.click();
    const fr = await until(() => document.querySelector('iframe.ed-pv-frame, .ed-preview iframe, #ed-overlays iframe'));
    await sleep(500);
    esc();
    await sleep(200);
    return fr.srcdoc ? fr.srcdoc.length > 1000 : 'no srcdoc';
  });
  await step('content language add/remove', async () => {
    const before = E.S.doc.langs.join(',');
    E.commit('test', (d) => { if (!d.langs.includes('fr')) d.langs.push('fr'); });
    await sleep(200);
    const mid = E.S.doc.langs.join(',');
    E.undo();
    await sleep(200);
    return [before, mid, E.S.doc.langs.join(',')];
  });
  await step('save project', async () => {
    await E.flushSave();
    return E.S.dirty === false || E.S.saved || 'flushed';
  });
  R.blocks = nBlocks();
  return R;
}
