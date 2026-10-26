// embroidery-studio/e2e.js - browser scenario through the interface: the catalogue (search, filters), a scheme page
// (key, PDF and OXS downloads checked byte by byte), the viewer (marking stitches by taps and drags, progress kept
// after a reload of the screen), the editor (pencil, undo, a new colour, text), the converter (a generated picture
// dropped on the page -> chart -> editor) and my schemes. Desktop and phone widths:
//   node check.js e2e http://127.0.0.1:8080/embroidery-studio/ embroidery-studio/e2e.js [--mobile --size 390x844]
//   node check.js e2e embroidery-studio/html@5_offline_singlefile/index.html embroidery-studio/e2e.js
// The scenario is serialized into the page (Function.prototype.toString): only browser globals.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(60); } return null; };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  // Downloads: capture the blobs the page saves.
  const downloads = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) { downloads.push({ name: this.download, href: this.href }); return; }
    return origClick.call(this);
  };
  const lastDownload = async (re) => { const d = await until(() => downloads.slice().reverse().find((x) => re.test(x.name)), 15000); if (!d) return null; return new Uint8Array(await (await fetch(d.href)).arrayBuffer()); };
  const go = async (hash, sel) => { location.hash = hash; return until(() => $(sel)); };
  const canvasPoint = (cv, fx, fy) => { const r = cv.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; };
  const pointer = (el, type, p, extra = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra }));
  const phone = innerWidth < 700;

  // --- catalogue ---
  await go('#/', '.es-card');
  const cards = await until(() => ($$('.es-card').length >= 14 ? $$('.es-card') : null));
  step('catalogue lists the demo schemes', cards && cards.length >= 14, cards && cards.length);
  const search = $('.es-search-in');
  search.value = 'owl';
  search.dispatchEvent(new Event('input'));
  await sleep(500);
  step('search finds the owl', $$('.es-card').length === 1 && /owl/.test($('.es-card').dataset.key), $$('.es-card').map((c) => c.dataset.key));
  search.value = '';
  search.dispatchEvent(new Event('input'));
  await sleep(400);
  const geo = $$('.es-cat').find((b) => /Geometric|Геометр|Геометр|Geometr|géométr|Geométr|გეომ/i.test(b.textContent));
  if (geo) geo.click();
  await sleep(200);
  step('category filter', $$('.es-card').length === 3, $$('.es-card').length);
  $('.es-reset').click();
  await sleep(200);
  const thumbs = await until(() => $$('.es-card img').filter((i) => i.src.startsWith('data:image/png')).length >= 4);
  step('thumbnails are drawn', !!thumbs, $$('.es-card img').filter((i) => i.src).length);

  // --- scheme page ---
  await go('#/s/demo%3Astrawberry', '.es-legend .es-table');
  const keyRows = $$('.es-legend tbody tr');
  step('scheme page shows the key', keyRows.length >= 7 && $$('.es-legend .es-sym svg').length >= 7, keyRows.length);
  step('facts show the finished size', /cm|см|სმ/.test($('.es-facts').textContent), $('.es-facts dd') && $('.es-facts dd').textContent);
  // OXS download.
  $$('.es-actions .ed-btn').find((b) => b.querySelector('.ed-ic') && /download|Download|Скач|Завант|Herunter|Télé|Descarg|ჩამო/i.test(b.textContent)).click();
  await until(() => $('.ed-menu'));
  $$('.ed-menu-item')[1].click();
  const oxs = await lastDownload(/\.oxs$/);
  const oxsText = oxs ? new TextDecoder().decode(oxs) : '';
  step('OXS download', /<chart>/.test(oxsText) && /<fullstitches>/.test(oxsText) && /palette_item index="1" number="DMC /.test(oxsText), oxs && oxs.length);
  // PDF download through its dialog.
  $$('.es-actions .ed-btn').find((b) => /download|Download|Скач|Завант|Herunter|Télé|Descarg|ჩამო/i.test(b.textContent)).click();
  await until(() => $('.ed-menu'));
  $$('.ed-menu-item')[0].click();
  await until(() => $('.es-pdfdlg'));
  $('.ed-dialog .ed-dlg-foot .ed-primary').click();
  const pdf = await lastDownload(/\.pdf$/);
  const pdfText = pdf ? new TextDecoder('latin1').decode(pdf) : '';
  const pages = (pdfText.match(/\/Type \/Page\b/g) || []).length;
  step('PDF download: header, pages, symbol font, cross-reference', pdfText.startsWith('%PDF-1.5') && pages >= 3 && /\/Subtype \/Type3/.test(pdfText) && /startxref/.test(pdfText) && /%%EOF\s*$/.test(pdfText), { bytes: pdf && pdf.length, pages });

  // --- viewer: mark stitches ---
  await go('#/view/demo%3Astrawberry', '.es-viewer .st-canvas');
  await sleep(600);
  const cv = $('.es-viewer .st-canvas');
  $$('.es-tb .ed-seg-btn').find((b) => b.dataset.v === 'mark').click();
  await sleep(100);
  const before = $('.es-tpct').textContent;
  // A drag across the middle of the berry marks stitches.
  pointer(cv, 'pointerdown', canvasPoint(cv, 0.35, 0.55));
  for (let k = 1; k <= 12; k++) { pointer(cv, 'pointermove', canvasPoint(cv, 0.35 + k * 0.02, 0.55)); await sleep(15); }
  pointer(cv, 'pointerup', canvasPoint(cv, 0.59, 0.55));
  await sleep(400);
  const after = $('.es-tpct').textContent;
  step('drag in the mark tool marks stitches', parseFloat(after) > parseFloat(before), [before, after]);
  // A highlighted colour and its progress row.
  $$('.es-crow')[0].click();
  await sleep(150);
  step('highlight a colour', $$('.es-crow.on').length === 1, null);
  const mode = $$('.es-modes .ed-seg-btn').find((b) => b.dataset.v === 'realistic');
  mode.click();
  await sleep(200);
  step('realistic mode', mode.getAttribute('aria-checked') === 'true', null);
  $$('.es-modes .ed-seg-btn').find((b) => b.dataset.v === 'colorSymbols').click();
  // Progress survives leaving and reopening.
  await go('#/s/demo%3Astrawberry', '.es-legend');
  await sleep(400);
  await go('#/view/demo%3Astrawberry', '.es-viewer .st-canvas');
  const kept = await until(() => parseFloat($('.es-tpct').textContent) > 0 && $('.es-tpct').textContent, 5000);
  step('progress is kept', !!kept && parseFloat(kept) === parseFloat(after), [kept, after]);

  // --- editor ---
  await go('#/edit/demo%3Akitten', '.es-editor .st-canvas');
  await until(() => /^#\/edit\/my/.test(location.hash));
  await sleep(700);
  const ecv = $('.es-editor .st-canvas');
  $$('.es-edside .es-crow')[1].click();
  await sleep(100);
  const count0 = +$$('.es-edside .es-crow-n')[1].textContent.replace(/\D/g, '');
  $$('.es-tool').find((b) => b.dataset.tool === 'full').click();
  pointer(ecv, 'pointerdown', canvasPoint(ecv, 0.4, 0.62));
  for (let k = 1; k <= 6; k++) { pointer(ecv, 'pointermove', canvasPoint(ecv, 0.4 + k * 0.02, 0.62)); await sleep(15); }
  pointer(ecv, 'pointerup', canvasPoint(ecv, 0.52, 0.62));
  await sleep(700);
  const count1 = +$$('.es-edside .es-crow-n')[1].textContent.replace(/\D/g, '');
  step('pencil adds stitches', count1 > count0, [count0, count1]);
  $$('.es-tb .es-ib').find((b) => b.title && /Undo|Отмен|Скас|Rückg|Annul|Deshac|გაუქ/i.test(b.title)).click();
  await sleep(700);
  const count2 = +$$('.es-edside .es-crow-n')[1].textContent.replace(/\D/g, '');
  step('undo removes them', count2 === count0, [count0, count2]);
  // Fill a new layer area with the eraser-free fill, then check the saved state.
  $$('.es-tool').find((b) => b.dataset.tool === 'fill').click();
  pointer(ecv, 'pointerdown', canvasPoint(ecv, 0.5, 0.05));
  pointer(ecv, 'pointerup', canvasPoint(ecv, 0.5, 0.05));
  await sleep(1600);
  step('fill and autosave', /Saved|Сохран|Збереж|Gespei|Enregis|Guardad|შენახ/.test($('.es-saved').textContent), $('.es-saved').textContent);
  // Layers and chart tabs render.
  $$('.es-tabs .ed-seg-btn')[1].click();
  await sleep(100);
  step('layers tab', $$('.es-lrow').length >= 2, $$('.es-lrow').length);
  $$('.es-tabs .ed-seg-btn')[2].click();
  await sleep(100);
  step('chart tab', $$('.es-props .ed-input').length >= 5, null);

  // --- converter ---
  await go('#/convert', '.es-conv .ap-drop');
  const c = document.createElement('canvas');
  c.width = 200; c.height = 150;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 150);
  grad.addColorStop(0, '#5b8cc9'); grad.addColorStop(1, '#f6c28b');
  g.fillStyle = grad; g.fillRect(0, 0, 200, 150);
  g.fillStyle = '#c0283c'; g.beginPath(); g.arc(70, 80, 40, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2f7a3a'; g.fillRect(120, 60, 50, 70);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'test-picture.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  $('.es-conv .ap-drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const conv = await until(() => $$('.es-conv-pal .es-pchip').length > 2, 15000);
  step('converter makes a chart from a picture', !!conv, $$('.es-conv-pal .es-pchip').length);
  $$('.es-conv .ed-seg-btn').find((b) => b.dataset.v === 'fs').click();
  await sleep(900);
  step('dithering re-converts', $$('.es-stat').length >= 4, $$('.es-stat b').map((b) => b.textContent));
  $('.es-conv-stage .ed-primary').click();
  await until(() => /^#\/edit\/my/.test(location.hash) && $('.es-editor .st-canvas'));
  step('converted chart opens in the editor', /^#\/edit\/my/.test(location.hash), location.hash);

  // --- my schemes ---
  await go('#/my', '.es-pagehead');
  await until(() => $$('.es-card').length >= 2);
  step('my schemes lists copies and conversions', $$('.es-card').length >= 2, $$('.es-card').length);
  step('in progress list', $$('.ap-card')[0] && $$('.ap-card')[0].querySelector('.es-pct') != null, null);

  HTMLAnchorElement.prototype.click = origClick;
  const missing = [...(window.__edMissingKeys || [])].filter((k) => !/^tag\./.test(k));
  step('every UI string has a dictionary entry', missing.length === 0, missing.slice(0, 12));
  step('no page errors', errors.length === 0, errors.slice(0, 3));
  return { steps, phone, downloads: downloads.map((d) => d.name) };
}
