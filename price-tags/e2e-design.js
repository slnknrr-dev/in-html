// price-tags/e2e-design.js - in-page scenario of the designer (node check.js e2e price-tags/design.html
// price-tags/e2e-design.js): the demo tags with their promotions, the A4 sheet grid at 58 × 40 and 90 × 60 mm, cut
// marks, every template, GS1 DataMatrix, and "only changed prices" after marking the set as printed.
//
// Relies on the state the products scenario or first-run demo left in localStorage (24 demo products). Expected grid
// numbers follow from sheetGrid() with the default 8 mm margin and 0 gap: 58 x 40 -> floor(194/58)=3 x floor(281/40)=7
// = 21 per page (24 tags -> 2 pages); 90 x 60 -> 2 x 4 = 8 (-> 3 pages). Reads data-per / data-pages from #pt-stats
// instead of translated text. Restores 58 x 40 and 'all' at the end so a rerun starts from the same state.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  await sleep(200);

  const stats = () => $('#pt-stats').dataset;
  const pages = () => $$('#pt-sheets .pt-page');
  step('tags listed', $$('.pt-thumb').length === 24, $$('.pt-thumb').length);
  step('grid 58 × 40', stats().per === '21' && pages()[0]?.querySelectorAll('.pt-cell').length === 21, stats().per);
  step('all tags on sheets', $$('#pt-sheets .pt-cell').length === 24 && stats().pages === '2', [$$('#pt-sheets .pt-cell').length, stats().pages]);
  const wine = $('#pt-sheets .pt-cell[data-id="d4"] svg');
  step('promo tag price', wine?.querySelector('.pt-price')?.dataset.v === '1990', wine?.querySelector('.pt-price')?.textContent);
  step('promo tag struck old price', wine?.querySelector('.pt-old')?.dataset.v === '2490' && !!wine.querySelector('.pt-old line'), wine?.querySelector('.pt-old')?.textContent);
  step('true size cells', pages()[0]?.querySelector('.pt-cell svg')?.getAttribute('width') === '58mm', pages()[0]?.querySelector('.pt-cell svg')?.getAttribute('width'));
  step('cut marks', (pages()[0]?.querySelector('.pt-marks path')?.getAttribute('d') || '').length > 20, (pages()[0]?.querySelector('.pt-marks path')?.getAttribute('d') || '').length);

  // Templates.
  for (const k of ['promo', 'minimal', 'wobbler', 'strip', 'classic']) {
    $(`.pt-tpl[data-k="${k}"]`).click();
    await sleep(200);
    step('template ' + k, $('.pt-tpl.pt-on')?.dataset.k === k && !!$('#pt-stage svg.pt-tag .pt-price'), $('.pt-tpl.pt-on')?.dataset.k);
  }

  // Size 90 × 60: 2 × 4 per sheet.
  const size = $('#pt-size');
  size.value = '90x60'; size.dispatchEvent(new Event('change'));
  await sleep(250);
  step('grid 90 × 60', stats().per === '8' && pages()[0]?.querySelectorAll('.pt-cell').length === 8 && stats().pages === '3', [stats().per, stats().pages]);

  // GS1 DataMatrix.
  $$('button.ed-seg-btn[data-v="datamatrix"]')[0].click();
  await sleep(200);
  step('datamatrix', !!$('#pt-stage .pt-code rect') && ($('#pt-stage .pt-code')?.getAttribute('transform') || '').includes('scale'), $('#pt-stage .pt-code')?.getAttribute('transform'));
  $$('button.ed-seg-btn[data-v="ean"]')[0].click();
  await sleep(150);

  // Only changed prices: nothing after marking the set as printed; promo / markdown tags only.
  $('#pt-mark').click();
  await sleep(150);
  $('#pt-which button[data-v="changed"]').click();
  await sleep(150);
  step('only changed after print', !!$('#pt-sheets-empty') && $$('#pt-sheets .pt-cell').length === 0, $$('#pt-sheets .pt-cell').length);
  $('#pt-which button[data-v="promo"]').click();
  await sleep(150);
  step('promo tags only', $$('#pt-sheets .pt-cell').length === 6, $$('#pt-sheets .pt-cell').length);
  $('#pt-which button[data-v="all"]').click();
  await sleep(100);
  size.value = '58x40'; size.dispatchEvent(new Event('change'));
  await sleep(200);
  return { steps };
}
