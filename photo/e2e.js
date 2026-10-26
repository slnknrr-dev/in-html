// photo/e2e.js - in-page end-to-end scenario of the photo editor, run by check.js in a page that hosts it:
//   node check.js e2e image-processor/html@5_offline_singlefile/index.html photo/e2e.js --lang en
// Tools by pointer events (brush, marquee, shape), layers, fill, layer via copy, undo / redo, context menus (right
// click on a layer row, a long press with the brush - no menu, the dab is painted - and with the marquee - the menu,
// the selection kept), crop and image size, Transform · ImageMagick mode (pieces select and mark layers, bash / cmd.exe
// and the script form, history fragments, the PNG files the command reads), Esc back to editing.
// Design: every step runs in its own try/catch and records ok / FAIL with detail, so one broken feature does not hide
// the results of the rest. Real pointer events are dispatched on the overlay canvas (not ed.* calls) to exercise the
// same input path as a user; fixed sleeps give rAF rendering and long-press timers time to fire.
export default async function scenario() {
  const R = { steps: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = async (name, fn) => { try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 500)]); } };
  const must = (c, msg) => { if (!c) throw new Error(msg); };
  location.hash = '#editor';
  await sleep(700);
  const ed = document.querySelector('.ph-ed').photoEditor;
  if (ed.st.mode === 'cmd') ed.setMode('edit');
  const over = document.querySelector('.ph-over');
  const at = (x, y) => { const p = ed.toScreen(x, y), r = over.getBoundingClientRect(); return { clientX: r.left + p.x, clientY: r.top + p.y }; };
  let pid = 10;
  const ptr = (type, x, y, o = {}) => over.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: o.id || 1, pointerType: o.type || 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5, ...at(x, y), ...o }));
  const drag = async (pts, o = {}) => { const id = ++pid; ptr('pointerdown', ...pts[0], { ...o, id }); for (const p of pts.slice(1)) { ptr('pointermove', ...p, { ...o, id }); await sleep(8); } ptr('pointerup', ...pts[pts.length - 1], { ...o, id }); await sleep(60); };
  const menuItems = () => [...document.querySelectorAll('.ed-menu-item')].map((b) => b.querySelector('.ed-menu-l')?.textContent);
  const closeMenus = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(120); for (const m of document.querySelectorAll('.ed-menu-pop, .ed-popover')) m.remove(); };

  await step('new canvas', async () => { ed.newDocument(400, 300, '#ffffff'); await sleep(300); ed.fit(); await sleep(100); return [ed.doc.width, ed.doc.height]; });
  await step('brush stroke on the background', async () => {
    ed.setTool('brush');
    await drag([[50, 50], [120, 80], [200, 150], [260, 160]]);
    must(ed.history.entries.length === 1, 'no history entry');
    const px = ed.R.pixelAt(ed.doc, 120, 80);
    must(px[0] < 200, 'not painted ' + px);
    return [ed.history.entries[0].label, px.slice(0, 3), ed.doc.recipe.painted];
  });
  await step('marquee + fill + layer via copy', async () => {
    ed.setTool('marquee');
    await drag([[100, 100], [180, 160], [220, 200]]);
    must(ed.doc.selection, 'no selection');
    ed.setColor('fg', '#e11d48');
    ed.newPixelLayer();
    ed.fillSelection();
    ed.layerViaCopy(false);
    return [ed.doc.layers.length, ed.doc.layers.map((L) => L.name)];
  });
  await step('undo / redo', async () => {
    const n = ed.history.index;
    ed.history.undo(); ed.history.undo();
    const back = ed.doc.layers.length;
    ed.history.redo(); ed.history.redo();
    must(ed.history.index === n, 'index ' + ed.history.index);
    return [back, ed.doc.layers.length];
  });
  await step('long press with the brush keeps painting (no menu)', async () => {
    ed.deselect();
    ed.setActiveLayer(ed.doc.layers[1].id);
    ed.setTool('brush');
    const before = ed.history.entries.length;
    const id = ++pid;
    ptr('pointerdown', 300, 60, { type: 'touch', id });
    await sleep(800);
    const items = menuItems();
    ptr('pointerup', 300, 60, { type: 'touch', id });
    await sleep(100);
    must(!items.length, 'a menu opened: ' + items.join());
    must(ed.history.entries.length === before + 1, 'the dab was not painted');
    return 'no menu, dab painted';
  });
  await step('long press with the marquee opens the menu', async () => {
    ed.setTool('marquee');
    const sel = ed.doc.selection;
    const id = ++pid;
    ptr('pointerdown', 300, 200, { type: 'touch', id });
    await sleep(800);
    const items = menuItems();
    ptr('pointerup', 300, 200, { type: 'touch', id });
    await sleep(100);
    await closeMenus();
    must(items.length > 3, 'no menu');
    must(ed.doc.selection === sel, 'the selection changed');
    return items.slice(0, 6);
  });
  await step('right click on a layer row', async () => {
    const row = document.querySelector('.ph-lrow');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 900, clientY: 300, button: 2 }));
    await sleep(200);
    const items = menuItems();
    await closeMenus();
    must(items.includes('Duplicate layer') && items.some((x) => /Opacity 50/.test(x)), items.join());
    return items;
  });
  await step('text, shape and adjustment layers', async () => {
    ed.setTool('shape');
    await drag([[40, 200], [120, 260], [160, 280]]);
    ed.newAdjustment('hueSaturation');
    const L = ed.active(); L.adjust.params.hue = 40; ed.changed();
    const blend = document.querySelector('.ph-blend');
    ed.setActiveLayer(ed.doc.layers[2].id);
    await sleep(50);
    const sel = document.querySelector('.ph-blend'); sel.value = 'multiply'; sel.dispatchEvent(new Event('change'));
    ed.addMask(false);
    void blend;
    return ed.doc.layers.map((x) => `${x.name}:${x.kind}:${x.blend}`);
  });
  await step('crop and image size', async () => {
    ed.cropTo({ x: 20, y: 10, w: 360, h: 270 });
    await ed.imageSize(300, 225);
    return [ed.doc.width, ed.doc.height, ed.doc.recipe.steps.map((s) => s.id)];
  });
  await step('Transform · ImageMagick mode', async () => {
    document.querySelector('.ph-modes [data-v="cmd"]').click();
    await sleep(400);
    const pre = document.querySelector('.pm-pre');
    must(pre && /^magick /.test(pre.textContent), 'no command');
    return [ed.st.mode, pre.textContent.split('\n').length, document.querySelectorAll('.pm-p').length];
  });
  await step('pieces select and mark layers', async () => {
    const piece = [...document.querySelectorAll('.pm-p')].find((p) => /^L\d+$/.test(p.dataset.ref) && +p.dataset.ref.slice(1) !== ed.doc.activeId);
    piece.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(60);
    const marked = document.querySelector('.ph-lrow.ph-ref-hover')?.dataset.id;
    piece.click();
    await sleep(200);
    must(String(ed.doc.activeId) === piece.dataset.ref.slice(1), 'not selected');
    must(marked === piece.dataset.ref.slice(1), 'row not marked');
    return [piece.dataset.ref, document.querySelectorAll('.pm-p.pm-hl').length];
  });
  await step('shells and forms', async () => {
    const segBtn = (txt) => [...document.querySelectorAll('.pm-ctl .ed-seg-btn')].find((b) => b.textContent === txt);
    segBtn('bash').click(); await sleep(150);
    const bash = document.querySelector('.pm-pre').textContent;
    segBtn('cmd.exe').click(); await sleep(150);
    const cmd = document.querySelector('.pm-pre').textContent;
    segBtn('Step by step').click(); await sleep(150);
    const steps = document.querySelector('.pm-pre').textContent;
    segBtn('One command').click(); await sleep(150);
    must(bash.includes('\\(') && bash.includes(' \\\n'), 'bash form');
    must(cmd.includes('"("') && cmd.includes(' ^\n'), 'cmd form');
    must(steps.includes('step-01.miff') && /\ndel step-01\.miff/.test(steps), 'steps form');
    return [bash.split('\n')[0], cmd.split('\n')[0], steps.split('\n').length];
  });
  await step('history fragments', async () => {
    const frags = [...document.querySelectorAll('.ph-hcmd')].map((x) => x.textContent.slice(0, 40));
    must(frags.some((f) => f.includes('-compose Multiply')) && frags.some((f) => f.includes('-draw') || f.includes('-strokewidt')), frags.join(' / '));
    return frags;
  });
  await step('files the command reads', async () => {
    const c = ed.command();
    const sizes = [];
    for (const a of c.assets) { const b = await ed.assetPNG(a); sizes.push(`${a.name}:${b.length}`); }
    must(c.assets.some((a) => a.name === 'background.png'), 'painted background is no file');
    return sizes;
  });
  await step('back to editing (Esc)', async () => {
    over.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    return ed.st.mode;
  });
  return R;
}
