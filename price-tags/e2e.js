// price-tags/e2e.js - in-page scenario of the products page (node check.js e2e price-tags/index.html price-tags/e2e.js):
// the demo shop loads, a 20 % promotion is added for one product, its tag shows the best price and the struck old
// price with the badge, and the category promotion, the item promo price and the expiry markdown of the demo apply.
// The designer page has its own scenario (e2e-design.js): sheet grid, sizes, templates, "only changed".
//
// Harness contract: check.js loads the page, runs the default export and reads { steps: [name, 'ok'|'FAIL', value] }.
// Every step records the observed value, so a FAIL report shows what was there instead of just "false".
// Approach: drive the real UI (clicks, input events) rather than calling module functions, so wiring bugs are caught.
// Waiting: until() polls every 50ms up to a timeout instead of fixed sleeps where an observable condition exists;
// fixed sleeps remain only after actions whose effect is a debounced repaint with no distinct marker.
// Assertions read data-v (minor units) on tag SVG nodes where possible: locale-independent. Table checks match
// '1,87'-style text, which relies on the demo's default decimal mark ',' (DESIGN_DEF.decimal).
// Expected values follow from the demo data in common.js: water 220 - 15 % = 187, Tkemali 380 - 20 % = 304, butter
// 640 at 1 day to expiry -> 50 % markdown (MARKDOWN_DEFAULTS of stock/batches.js) = 320.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const $ = (s, r = document) => r.querySelector(s);
  const until = async (fn, ms = 3000) => { for (let i = 0; i < ms / 50; i++) { const v = fn(); if (v) return v; await sleep(50); } return null; };
  const row = (id) => $(`.pt-row[data-id="${id}"]`);
  const best = (id) => row(id)?.querySelector('.pt-best')?.textContent || '';

  // Demo shop (confirm dialog).
  $('#pt-demo').click();
  const ok = await until(() => $('.ed-dialog .ed-primary'));
  ok.click();
  await until(() => document.querySelectorAll('.pt-row').length === 24);
  step('demo products', document.querySelectorAll('.pt-row').length === 24, document.querySelectorAll('.pt-row').length);
  step('names in three languages', /Tkemali|Ткемали|ტყემალი/.test(row('d16')?.textContent || ''), row('d16')?.querySelector('.pt-namecell')?.textContent);

  // Promotions of the demo: category (water -15 %), fixed price (wine), item promo price (gozinaki), markdown (butter -50 %).
  step('category promo on water', best('d1').includes('1,87'), best('d1'));
  step('fixed promo on wine', best('d4').includes('19,90'), best('d4'));
  step('item promo price', best('d14').includes('5,50'), best('d14'));
  step('expiry markdown', best('d10').includes('3,20') && /50/.test(row('d10').querySelector('.pt-chip-md')?.textContent || ''), best('d10'));
  step('planned promo not applied', !best('d7') && !row('d7').querySelector('.pt-was'), row('d7')?.querySelector('.pt-nowcell')?.textContent);

  // Add a 20 % promotion for Tkemali.
  step('no promo yet', !best('d16'), row('d16')?.querySelector('.pt-nowcell')?.textContent);
  $('#pt-add-promo').click();
  const dlg = await until(() => $('.pt-promo-dlg'));
  const set = (sel, v) => { const i = $(sel, dlg); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
  set('input[name="name"]', 'Sauce week');
  set('input[name="value"]', '20');
  $('.pt-pick-items input[data-id="d16"]', dlg).click();
  dlg.closest('.ed-dialog').querySelector('.ed-primary').click();
  await until(() => [...document.querySelectorAll('.pt-promo b')].some((b) => b.textContent === 'Sauce week'));
  step('promotion listed', [...document.querySelectorAll('.pt-promo')].some((li) => li.textContent.includes('Sauce week') && /20/.test(li.textContent)), [...document.querySelectorAll('.pt-promo b')].map((b) => b.textContent));
  step('table best price', best('d16').includes('3,04') && row('d16').querySelector('.pt-was')?.textContent.includes('3,80'), row('d16')?.querySelector('.pt-nowcell')?.textContent);

  // The tag of the selected product.
  row('d16').click();
  await sleep(150);
  const tag = $('#pt-preview svg.pt-tag');
  step('tag of the product', tag?.dataset.id === 'd16', tag?.dataset.id);
  step('tag best price', tag?.querySelector('.pt-price')?.dataset.v === '304', tag?.querySelector('.pt-price')?.textContent);
  const old = tag?.querySelector('.pt-old');
  step('tag struck old price', old?.dataset.v === '380' && !!old.querySelector('line') && old.textContent.includes('3,80'), old?.textContent);
  step('tag badge', /20/.test(tag?.querySelector('.pt-badge')?.textContent || ''), tag?.querySelector('.pt-badge')?.textContent);
  step('tag unit price', /1\s*(კგ|kg|кг)/.test(tag?.querySelector('.pt-unit')?.textContent || ''), tag?.querySelector('.pt-unit')?.textContent);
  step('tag barcode', !!tag?.querySelector('.pt-code path'), !!tag?.querySelector('.pt-code'));

  // Keyboard: arrow down moves the selection and the preview.
  row('d16').focus();
  row('d16').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await sleep(100);
  step('arrow key selection', $('#pt-preview svg.pt-tag')?.dataset.id === 'd17', $('#pt-preview svg.pt-tag')?.dataset.id);

  // Stored for the designer page.
  const saved = JSON.parse(localStorage.getItem('pt-data') || '{}');
  step('saved', !!saved.promotions?.some((p) => p.name === 'Sauce week' && p.items.includes('d16')), saved.promotions?.length);
  return { steps };
}
