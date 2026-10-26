// site-studio/wiki-e2e.js - in-page end-to-end scenario of the editor, run by check.js:
//   node check.js e2e site-studio/html@5_offline_singlefile/wiki.html site-studio/wiki-e2e.js
// First start (a base from the encyclopedia template), page tree and its context menu, editing a title with undo,
// adding blocks, a version, a secret variant (password dialog, sealing), the live preview (reader in the frame, page
// sync, versions, layers, 451 unlock inside the preview), media and base panels, theme change, the publishing dialog,
// UI language switch, autosave. Returns { steps: [[name, 'ok' | 'FAIL', value]] }.
// Runs inside the built single-file editor (check.js loads it in a real browser). Steps are independent: each is
// wrapped by step(), records ok/FAIL with a value or a trimmed stack, and the scenario continues, so one failure
// reports everything else instead of stopping at the first error. until() polls (50 ms) instead of fixed sleeps:
// fast on fast machines, tolerant on slow CI. The editor exposes window.__kp hooks (wiki-main.js) for state checks;
// UI interaction goes through real DOM events.
export default async function scenario() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = f(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 100));
      await sleep(50);
    }
  };
  const R = { steps: [] };
  const step = async (name, fn) => {
    try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 400)]); }
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const click = (el) => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const dialog = () => $('.ed-dialog');
  const frameDoc = () => { const f = $('.kp-pv-frame'); return f && f.contentDocument; };

  await until(() => window.__kpReady && window.__kp.S.kb, 30000);
  const K = window.__kp;

  await step('first start: template base', async () => {
    await until(() => $$('.kp-tr').length > 3);
    return [K.S.kb.title, K.S.kb.pages.length, $$('.kp-tr').length];
  });

  await step('page tree: filter and select a page', async () => {
    type($('.kp-ed-left .ed-search'), 'Earth');
    const row = await until(() => $$('.kp-tr').find((r) => /^Earth/.test(r.textContent.trim())));
    click(row.querySelector('.kp-tl'));
    await until(() => $('.kp-pe-title') && $('.kp-pe-title').value === 'Earth');
    return [$('.kp-pe-title').value, $$('.kp-bc').length];
  });

  await step('context menu of the tree', async () => {
    const row = $('.kp-tr.kp-on');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 200, button: 2 }));
    const items = await until(() => $$('.ed-menu-item').length > 5 && $$('.ed-menu-item'));
    const labels = items.map((b) => b.textContent.trim());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    return labels.slice(0, 6);
  });

  await step('edit title, undo', async () => {
    const tit = $('.kp-pe-title');
    type(tit, 'Earth (edited)');
    await sleep(50);
    const edited = K.S.kb.pages.find((p) => p.id === K.S.pageId).title;
    K.undo();
    await sleep(100);
    return [edited, K.S.kb.pages.find((p) => p.id === K.S.pageId).title];
  });

  await step('add a text block from the palette', async () => {
    const before = $$('.kp-ed-center .kp-bc').length;
    click($('.kp-add-block'));
    const btn = await until(() => $$('.kp-pal-b')[0]);
    click(btn);
    await until(() => $$('.kp-ed-center .kp-bc').length === before + 1);
    const ta = await until(() => $('.kp-bc.kp-sel textarea'));
    type(ta, 'A new paragraph with a [[Moon]] link.');
    await sleep(400);
    return [before, $$('.kp-ed-center .kp-bc').length];
  });

  await step('preview shows the page', async () => {
    const doc = await until(() => frameDoc() && frameDoc().querySelector('.kp-title'));
    await until(() => frameDoc().querySelector('.kp-title').textContent.includes('Earth'));
    await until(() => frameDoc().body.textContent.includes('A new paragraph with a'), 8000);
    return [frameDoc().title, !!doc];
  });

  await step('add a version', async () => {
    click($$('.kp-verbar .kp-vadd')[0]);
    await until(() => dialog());
    type($('.ed-dialog input.ed-input'), 'Kids');
    click($$('.ed-dialog .ed-btn.ed-primary').pop());
    await until(() => $$('.kp-verbar .kp-vtab').some((b) => b.textContent === 'Kids'));
    return $$('.kp-verbar .kp-vtab').map((b) => b.textContent);
  });

  await step('add a secret variant (451)', async () => {
    click($('.kp-varbar .kp-vadd'));
    await until(() => dialog());
    const pws = $$('.ed-dialog input[type="password"]');
    type(pws[0], 'e2e-secret');
    type(pws[1], 'e2e-secret');
    click($$('.ed-dialog .ed-btn.ed-primary').pop());
    await until(() => $('.kp-varbar .kp-vtab-s.kp-on'), 30000);
    const page = K.S.kb.pages.find((p) => p.id === K.S.pageId);
    const env = page.secrets[page.secrets.length - 1].env;
    return [page.secrets.length, env.kdf.a, env.ct.length > 100];
  });

  await step('write into the secret variant', async () => {
    const before = $$('.kp-ed-center .kp-bc').length;
    click($('.kp-add-block'));
    click(await until(() => $$('.kp-pal-b')[0]));
    await until(() => $$('.kp-ed-center .kp-bc').length === before + 1);
    type(await until(() => $('.kp-bc.kp-sel textarea')), 'The ZEBRASECRET answer is only in the variant.');
    await sleep(300);
    const page = K.S.kb.pages.find((p) => p.id === K.S.pageId);
    return [JSON.stringify(K.S.kb).includes('ZEBRASECRET'), page.secrets.length];
  });

  await step('one-file export: 451 sealed, the password opens it', async () => {
    const r = await K.buildExport('single');
    const clear = r.data.includes('ZEBRASECRET');
    const url = URL.createObjectURL(new Blob([r.data], { type: 'text/html' }));
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-3000px;top:0;width:900px;height:700px';
    f.src = url + '#/earth?451=e2e-secret';
    document.body.append(f);
    const ok = await until(() => f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent.includes('ZEBRASECRET') && f.contentDocument, 30000);
    const res = [r.data.length, clear, ok.title, ok.location.hash];
    f.remove();
    URL.revokeObjectURL(url);
    return res;
  });

  await step('preview shows the secret variant', async () => {
    await until(() => frameDoc().querySelector('.kp-451 .kp-vbtn.kp-on') && frameDoc().querySelector('.kp-451-badge'), 8000);
    return $$('.kp-451 .kp-vbtn', frameDoc()).map((b) => b.textContent);
  });

  await step('preview: follow a link selects the page', async () => {
    click($$('.kp-varbar .kp-vtab')[0]);
    await sleep(300);
    const a = await until(() => [...frameDoc().querySelectorAll('.kp-content a[data-kp-route="moon"]')][0]);
    a.click();
    await until(() => K.S.kb.pages.find((p) => p.id === K.S.pageId).slug === 'moon');
    return [$('.kp-pe-title').value, frameDoc().title];
  });

  await step('preview: layers toggle', async () => {
    const page = K.S.kb.pages.find((p) => /Earth/.test(p.title));
    await K.select({ pageId: page.id });
    const b = await until(() => frameDoc().querySelector('.kp-lbtn'), 8000);
    const before = b.getAttribute('aria-pressed');
    b.click();
    await sleep(100);
    return [b.textContent, before, frameDoc().querySelector('.kp-lbtn').getAttribute('aria-pressed')];
  });

  await step('media panel', async () => {
    click($$('.kp-ltab')[1]);
    await until(() => $$('.kp-media-it').length > 3);
    return $$('.kp-media-it').length;
  });

  await step('base panel: theme', async () => {
    click($$('.kp-ltab')[2]);
    const th = await until(() => $$('.kp-theme')[3]);
    click(th);
    await until(() => frameDoc().documentElement.getAttribute('data-kp-theme') === 'minimal', 8000);
    click($$('.kp-theme')[0]);
    click($$('.kp-ltab')[0]);
    return K.S.kb.theme;
  });

  await step('diagram editor opens and applies', async () => {
    const page = K.S.kb.pages.find((p) => p.versions.some((v) => v.blocks.some((b) => b.type === 'diagram')));
    await K.select({ pageId: page.id });
    const v = page.versions.find((x) => x.blocks.some((b) => b.type === 'diagram'));
    await K.select({ versionId: v.id, blockId: v.blocks.find((b) => b.type === 'diagram').id });
    const btn = await until(() => $$('.kp-bc.kp-sel .ed-btn.ed-primary')[0]);
    click(btn);
    await until(() => $('.kp-dg-stage .kp-dg-lbl'));
    const n = $$('.kp-dg-lbl').length;
    click($$('.ed-dialog .ed-btn.ed-primary').pop());
    await sleep(200);
    return [page.title, n];
  });

  await step('publishing dialog', async () => {
    click($('.kp-export-btn'));
    await until(() => $$('.kp-ex-card').length >= 4);
    const titles = $$('.kp-ex-card h3').map((x) => x.textContent);
    $('.ed-dialog .ed-dlg-head .ed-iconbtn').click();
    await sleep(200);
    return titles;
  });

  await step('UI language switch', async () => {
    const sel = $('.ap-lang');
    sel.value = 'ru';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    const label = $$('.kp-ltab')[0].textContent;
    sel.value = 'en';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    return label;
  });

  await step('saved to IndexedDB', async () => {
    await until(() => !K.S.dirty, 10000);
    return K.S.savedAt > 0;
  });

  return R;
}
