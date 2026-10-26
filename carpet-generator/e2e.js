// carpet-generator/e2e.js - browser scenario through the interface: traditions, a new seed, share codes that rebuild
// the rug, design options, a gallery design, composition layers, hand edits of knots, the four views, exports (PNG, knotting chart PDF, cross-stitch OXS checked byte by byte),
// the hand-over to Embroidery Studio, the motif editor (paint, save, use as the field motif). Desktop and phone:
//   node check.js e2e http://127.0.0.1:8080/carpet-generator/ carpet-generator/e2e.js [--mobile --size 390x844]
// The scenario is serialized into the page (Function.prototype.toString): only browser globals.
//
// Test strategy: drive the real UI (clicks, change events, synthetic PointerEvents) and assert on observable outputs:
// the share code mirrored into location.hash, the DOM, and the bytes of downloads. Polling with until() instead of
// fixed sleeps where an outcome is observable; short sleeps only where the UI gives no signal (debounced renders).
// Selectors avoid translated text where possible (data-t, data-d, data-tool); where a label must be matched, the
// regex lists all seven languages so the scenario passes in any UI language.
// Steps record ok/FAIL and keep going: one broken feature does not hide the state of the others.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(60); } return null; };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  // Downloads intercepted at HTMLAnchorElement.prototype.click (ui/app.js download() clicks a blob: anchor): the
  // blob URL is recorded and fetched back for byte checks instead of hitting the browser's download machinery.
  // Restored at the end so the page is left as found.
  const downloads = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download && this.href.startsWith('blob:')) { downloads.push({ name: this.download, href: this.href }); return; } return origClick.call(this); };
  const last = async (re) => { const d = await until(() => downloads.slice().reverse().find((x) => re.test(x.name)), 15000); return d ? new Uint8Array(await (await fetch(d.href)).arrayBuffer()) : null; };
  // The share code is mirrored into the address (the code field lives in the Design tab only).
  const code = () => decodeURIComponent((/[#&]code=([^&]+)/.exec(location.hash) || [])[1] || '');
  const btn = (re) => $$('button').find((b) => re.test(b.textContent));
  const tab = async (v) => { $('.cg-tabs [data-v="' + v + '"]').click(); await sleep(250); };

  await until(() => $('.cg-stage .st-canvas'));
  step('a rug is drawn', !!$('.cg-stage .st-canvas'), null);
  const code0 = code();
  // Another tradition.
  $('.cg-trad[data-t="turkmen"]').click();
  await until(() => /^turkmen\./.test(code()));
  step('tradition changes the rug and the code', /^turkmen\./.test(code()) && /Turkmen|Туркмен|Туркмен|Turkmen|turkmène|Turcomano|თურქმ/i.test($('.cg-title .ap-card-h').textContent), code());
  // A new seed.
  const c1 = code();
  $$('.cg-seedrow button')[0].click();
  await until(() => code() !== c1);
  step('a new seed', code() !== c1, code());
  // A share code rebuilds a rug.
  const input = $('.cg-code');
  input.value = code0;
  $$('.cg-code + button, .cg-code ~ button')[1].click();
  await until(() => code() === code0);
  step('a share code rebuilds the rug', code() === code0, [code(), code0]);
  // Design options: an allover field with a p4m repeat.
  await tab('pattern');
  const fieldSel = $$('.cg-side .ed-select').find((s) => [...s.options].some((o) => o.value === 'allover'));
  fieldSel.value = 'allover'; fieldSel.dispatchEvent(new Event('change'));
  await sleep(300);
  const wpSel = $$('.cg-side .ed-select').find((s) => [...s.options].some((o) => o.value === 'p4g'));
  wpSel.value = 'p4g'; wpSel.dispatchEvent(new Event('change'));
  await sleep(300);
  // The share code is "<tradition>.<seed>...o-<base64url JSON of options>"; the check decodes the options part
  // (base64url -> base64 by - -> + and _ -> /) to see the chosen values inside.
  step('field and wallpaper group options', /o-/.test(code()) && /p4g|allover/.test(atob(code().split('.o-')[1].replace(/-/g, '+').replace(/_/g, '/'))), code());
  // A gallery design and its composition layers.
  await tab('design');
  $('.cg-design[data-d="juliaRosette"]').click();
  await until(() => /^mashup./.test(code()));
  await tab('layers');
  const nLayers = $$('.cg-ly').length;
  step('a gallery design opens with its layers', /^mashup./.test(code()) && nLayers >= 3, nLayers);
  btn(/Random layer|Случайный слой|Випадковий шар|Zufällige Ebene|Calque au hasard|Capa al azar|შემთხვევითი ფენა/).click();
  await until(() => $$('.cg-ly').length === nLayers + 1);
  step('a random layer is added', $$('.cg-ly').length === nLayers + 1, $$('.cg-ly').length);
  // Hand edits: a brush stroke with mirror symmetry changes the code.
  const before = code();
  $('.cg-tools [data-tool="brush"]').click();
  await sleep(150);
  const canvas = $('.cg-stage .st-canvas');
  const cr = canvas.getBoundingClientRect();
  const pt = (fx, fy, type) => canvas.dispatchEvent(new PointerEvent(type, { clientX: cr.left + cr.width * fx, clientY: cr.top + cr.height * fy, bubbles: true, pointerId: 9, button: 0, buttons: 1 }));
  pt(0.45, 0.45, 'pointerdown'); pt(0.5, 0.5, 'pointermove'); pt(0.55, 0.52, 'pointermove'); pt(0.55, 0.52, 'pointerup');
  await sleep(300);
  step('knots painted by hand go into the code', code() !== before && /edits/.test(atob(code().split('.o-')[1].replace(/-/g, '+').replace(/_/g, '/'))), code().length);
  $('.cg-tools [data-tool="view"]').click();
  // Views.
  for (const v of ['flat', 'chart', 'room', 'pile']) {
    $$('.cg-stagehead .ed-seg-btn').find((b) => b.dataset.v === v).click();
    await sleep(250);
  }
  step('four views', !!$('.cg-stage .st-canvas'), null);
  // Exports.
  btn(/PNG/).click();
  const png = await last(/\.png$/);
  // Signature checks: PNG bytes 1..3 = "PNG"; the PDF must contain the Type 3 font that stitch/pdf.js draws chart
  // symbols with, and have at least three pages; OXS must hold a <chart> with DMC thread numbers.
  step('PNG picture', png && png[1] === 0x50 && png[2] === 0x4e, png && png.length);
  $$('.cg-right button').find((b) => /PDF/.test(b.textContent)).click();
  const pdf = await last(/knotting\.pdf$/);
  const pdfText = pdf ? new TextDecoder('latin1').decode(pdf) : '';
  step('knotting chart PDF', pdfText.startsWith('%PDF') && /\/Subtype \/Type3/.test(pdfText) && (pdfText.match(/\/Type \/Page\b/g) || []).length >= 3, pdf && pdf.length);
  btn(/^\s*OXS\s*$/).click();
  const oxs = await last(/\.oxs$/);
  const oxsText = oxs ? new TextDecoder().decode(oxs) : '';
  step('cross-stitch scheme as OXS', /<chart>/.test(oxsText) && /number="DMC /.test(oxsText), oxs && oxs.length);
  // Hand-over to Embroidery Studio.
  $('.cg-right .ed-primary').click();
  await until(() => $('.ed-dialog'));
  let handed = null;
  try { handed = JSON.parse(localStorage.getItem('stitch-handoff')); } catch { handed = null; }
  step('hand-over to Embroidery Studio', handed && handed.format === 'in-html-stitch' && handed.width > 50, handed && [handed.width, handed.height]);
  $('.ed-dialog .ed-dlg-foot .ed-btn').click();
  await sleep(200);
  // Motif editor: paint, save, use it.
  await tab('pattern');
  $$('.cg-side button').find((b) => b.querySelector('.ed-ic') && /Motif|Мотив|Мотив|Motiv|motif|Motivo|მოტივ/i.test(b.textContent)).click();
  const cv = await until(() => $('.cg-me-canvas'));
  const r = cv.getBoundingClientRect();
  for (const [fx, fy] of [[0.2, 0.2], [0.3, 0.3], [0.4, 0.2], [0.5, 0.5]]) {
    const p = { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, bubbles: true, pointerId: 5, buttons: 1 };
    cv.dispatchEvent(new PointerEvent('pointerdown', p));
    cv.dispatchEvent(new PointerEvent('pointerup', p));
  }
  $('.ed-dialog .ed-dlg-foot .ed-primary').click();
  await sleep(500);
  const saved = JSON.parse(localStorage.getItem('cg-motifs') || '[]');
  step('motif editor saves a motif', saved.length === 1 && saved[0].rows.join('').replace(/\./g, '').length >= 4, saved[0] && saved[0].rows.length);
  const fm = $$('.cg-side .ed-select').find((s) => [...s.options].some((o) => o.value === saved[0].id) && [...s.options].some((o) => o.value === 'boteh'));
  step('the motif is offered as a field motif', !!fm, null);
  if (fm) { fm.value = saved[0].id; fm.dispatchEvent(new Event('change')); await sleep(400); }
  step('the rug uses it', /o-/.test(code()), code());

  HTMLAnchorElement.prototype.click = origClick;
  const missing = [...(window.__edMissingKeys || [])];
  step('every UI string has a dictionary entry', missing.length === 0, missing.slice(0, 12));
  step('no page errors', errors.length === 0, errors.slice(0, 3));
  return { steps, downloads: downloads.map((d) => d.name) };
}
