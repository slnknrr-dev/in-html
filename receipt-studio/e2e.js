// receipt-studio/e2e.js - in-page scenario of the POS page (node check.js e2e
// receipt-studio/html@5_offline_singlefile/index.html receipt-studio/e2e.js): items added by a scanned "2*EAN", by
// clicks and by an in-store weight code, a promotion price, a 10 % check discount, a mixed card + cash payment with
// change, the totals and VAT by rate, the paid receipt (text, Code 128, QR) and the Z report of the shift.
//
// How it runs: check.js imports this module in Node, serialises the default export with toString() and evaluates
// it inside the loaded page, so the function must be self-contained (browser globals only, helpers defined inside).
// Assertions read amounts through data-k hooks and the receipt text, never module state, so the same scenario
// passes on the dev sources and on the single-file build. Every expected number is worked out in the comments:
// the scenario is also an executable specification of rounding, discount allocation and VAT.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const $ = (s, r = document) => r.querySelector(s);
  const kv = (k) => $(`[data-k="${k}"]`)?.textContent.trim() ?? null;
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const enter = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  // Builds valid EAN-13s inside the test (weights 1,3,1,3...; check = (10 - sum mod 10) mod 10), so the scan path
  // with check-digit validation is exercised with real codes.
  const ean13 = (b) => { let s = 0; for (let i = 0; i < 12; i++) s += +b[i] * (i % 2 ? 3 : 1); return b + ((10 - (s % 10)) % 10); };
  const tile = (id) => $(`.rs-tile[data-item="${id}"]`);
  const lineTotal = (id) => $(`.rs-line[data-item="${id}"] .rs-line-total`)?.firstChild?.textContent ?? null;
  const dialogOk = async () => { await sleep(150); $('.ed-dialog .ed-dlg-foot .ed-primary').click(); await sleep(250); };

  // Forced English: the Z report lines are matched by their printed labels.
  // English labels whatever the browser language is (the Z report lines are matched by label).
  const lang = $('.ap-lang');
  if (lang && lang.value !== 'en') { lang.value = 'en'; lang.dispatchEvent(new Event('change')); await sleep(200); }

  step('catalogue tiles', document.querySelectorAll('.rs-tile').length === 13, document.querySelectorAll('.rs-tile').length);
  step('tile EAN drawn', !!$('.rs-tile[data-item="borjomi"] .rs-tile-ean svg'), null);

  // A keyboard-wedge scan with a quantity prefix.
  const scan = $('#rs-scan');
  type(scan, '2*' + ean13('486000123405'));
  enter(scan);
  await sleep(150);
  step('scan 2*EAN', $('.rs-line[data-item="borjomi"] .rs-qty')?.value === '2' && lineTotal('borjomi') === '4.80', [$('.rs-line[data-item="borjomi"] .rs-qty')?.value, lineTotal('borjomi')]);

  for (const id of ['khachapuri', 'book', 'paracetamol']) { tile(id).click(); await sleep(60); }
  step('clicked items', document.querySelectorAll('.rs-line').length === 4, document.querySelectorAll('.rs-line').length);

  // In-store weight code 20 00101 01250 C: tomatoes, 1.250 kg × 4.80 = 6.00; then removed.
  type(scan, ean13('200010101250'));
  enter(scan);
  await sleep(150);
  step('weight code', lineTotal('tomatoes') === '6.00' && $('.rs-line[data-item="tomatoes"] .rs-qty')?.value === '1.25', lineTotal('tomatoes'));
  $('.rs-line[data-item="tomatoes"] .ed-iconbtn[aria-label*="Remove"], .rs-line[data-item="tomatoes"] > .ed-iconbtn').click();
  await sleep(100);

  // Promotion: milk 3.45 − 10 % (dairy week): 0.345 rounds half up to 0.35, so 3.10.
  tile('milk').click();
  await sleep(100);
  step('promotion price', lineTotal('milk') === '3.10', lineTotal('milk'));
  $('.rs-line[data-item="milk"] > .ed-iconbtn').click();
  await sleep(100);
  step('lines after removals', document.querySelectorAll('.rs-line').length === 4, document.querySelectorAll('.rs-line').length);

  // 10 % off the check: 3.31 allocated as 0.48 / 0.65 / 1.90 / 0.28.
  type($('.rs-disc-in'), '10');
  // 450 ms: covers the 250 ms debounce of the discount field plus the repaint.
  await sleep(450);
  step('subtotal', kv('subtotal') === '33.10', kv('subtotal'));
  step('check discount', kv('checkDiscount') === '−3.31', kv('checkDiscount'));
  step('total', /^29\.79\b/.test(kv('total') || ''), kv('total'));
  step('line shares', lineTotal('borjomi') === '4.32' && lineTotal('khachapuri') === '5.85' && lineTotal('book') === '17.10' && lineTotal('paracetamol') === '2.52',
    ['borjomi', 'khachapuri', 'book', 'paracetamol'].map(lineTotal));
  // VAT 18 %: 4.32 → 0.66, 5.85 → 0.89; book at 0 %; paracetamol without VAT.
  step('VAT 18 %', kv('vat-18') === '1.55', kv('vat-18'));
  step('VAT 0 %', kv('vat-0') === '0.00', kv('vat-0'));
  step('without VAT', kv('exempt') === '2.52', kv('exempt'));

  // Mixed payment: 20.00 by card, 20.00 cash received -> 9.79 cash due, 10.21 change.
  $('#rs-method [data-v="mixed"]').click();
  await sleep(100);
  type($('#rs-cardpay'), '20');
  type($('#rs-tendered'), '20');
  await sleep(150);
  step('cash due', kv('cashDue') === '9.79', kv('cashDue'));
  step('change', /^10\.21\b/.test(kv('change') || ''), kv('change'));

  // Pay: the first payment opens the shift with 100.00 opening cash.
  $('#rs-pay').click();
  await sleep(200);
  const open = $('#rs-open-cash');
  step('shift dialog', !!open, null);
  type(open, '100');
  await dialogOk();
  await sleep(200);
  const text = $('.rs-paper-text')?.textContent || '';
  step('receipt paid', /#1\b/.test(text) && text.includes('29.79') && text.includes('10.21') && text.includes('20.00'), text.split('\n').slice(0, 8).join(' | '));
  step('receipt VAT line', /18%\s+1\.55/.test(text), null);
  step('receipt codes', !!$('.rs-paper-codes .rs-r-bar svg') && !!$('.rs-paper-codes .rs-r-qr svg'), $('.rs-r-bar svg')?.getAttribute('aria-label'));
  step('check cleared', document.querySelectorAll('.rs-line').length === 0, document.querySelectorAll('.rs-line').length);
  step('X expected cash', /109\.79/.test(kv('expected') || ''), kv('expected'));

  // Close the shift with 110.00 counted -> Z report: expected 109.79, difference +0.21.
  $('#rs-close-shift').click();
  await sleep(200);
  type($('#rs-counted'), '110');
  await dialogOk();
  await sleep(250);
  const z = [...document.querySelectorAll('.ed-dialog .rs-paper-text')].at(-1)?.textContent || '';
  const zl = (label) => z.split('\n').find((l) => l.startsWith(label))?.replace(label, '').trim() ?? null;
  step('Z report', z.includes('Z REPORT'), z.split('\n')[0]);
  step('Z sales', zl('Sales (1)') === '29.79', zl('Sales (1)'));
  step('Z cash / card', zl('  Cash') === '9.79' && zl('  Card') === '20.00' && zl('  Mixed') === '29.79', [zl('  Cash'), zl('  Card'), zl('  Mixed')]);
  step('Z VAT', zl('VAT 18%') === '1.55', zl('VAT 18%'));
  step('Z expected', zl('Expected cash') === '109.79', zl('Expected cash'));
  step('Z counted / difference', zl('Counted cash') === '110.00' && zl('Difference') === '+0.21', [zl('Counted cash'), zl('Difference')]);
  $('.ed-dialog .ed-dlg-head .ed-iconbtn')?.click();
  await sleep(200);
  step('shift closed', !$('#rs-close-shift') && !!$('#rs-open-shift'), null);
  return { steps };
}
