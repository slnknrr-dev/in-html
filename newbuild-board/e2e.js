// newbuild-board/e2e.js - in-page scenario of the board (node check.js e2e
// newbuild-board/html@5_offline_singlefile/index.html newbuild-board/e2e.js): the demo loads (two buildings, 192
// units), a filter dims what does not match, the unit card opens with its sketch, a bulk +3 % for floors >= 10 changes
// exactly the available units it should (rounded to $100) and is undone, and the mortgage page (in a frame) gives
// schedules whose principal parts sum to the loan, annuity and differentiated.
// Assertions rely on the deterministic demo (demo.js: seeded RNG, fixed dates), so exact counts (192 units, 32
// studios, 14 studios on floors >= 10) are stable. Cells expose data-* (id, price in minor units, floor, match flag)
// precisely so the test reads raw values instead of parsing formatted, language-dependent text.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  // Only `input` is dispatched: the app's textInput listens to it (change is not needed here).
  const input = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const cells = () => $$('.nb-cell');
  const matching = () => cells().filter((c) => c.dataset.m === '1');

  // 1. The demo.
  step('demo units', cells().length === 192, cells().length);
  step('demo buildings', $$('.nb-building').length === 2, $$('.nb-bhead h3').map((x) => x.textContent));
  step('statistics', /\d/.test($('.nb-tiles .nb-tile-v')?.textContent || '') && $$('.nb-stats tbody tr').length >= 6, $('.nb-tiles')?.textContent.slice(0, 80));

  // 2. Filters: studios only, then studios on floors 10 and up.
  $('.nb-chip[data-v="0"]').click();
  await sleep(300);
  const studios = matching();
  // Studios: 2 buildings x 16 floors x 1 studio riser = 32.
  step('filter rooms = studio', studios.length === 32 && studios.every((c) => c.querySelector('.nb-c-r').textContent === studios[0].querySelector('.nb-c-r').textContent), studios.length);
  const floorMin = $('#nb-f-floorMin');
  input(floorMin, '10');
  await sleep(400);
  step('filter floor >= 10', matching().length === 14 && matching().every((c) => +c.dataset.floor >= 10), matching().length);
  $('.nb-chip[data-v="0"]').click();
  await sleep(300);
  step('filter count text', /of 192/.test($('.nb-count').textContent) || /192/.test($('.nb-count').textContent), $('.nb-count').textContent);

  // 3. The unit card.
  $('.nb-cell[data-id="A-1203"]').click();
  await sleep(500);
  const dlg = $('.nb-unit-dlg');
  step('unit card', !!dlg && !!dlg.querySelector('.nb-sketch svg') && /62/.test(dlg.textContent), dlg ? dlg.querySelector('.ed-dlg-title').textContent : null);
  if (dlg) dlg.querySelector('.ed-dlg-foot .ed-btn').click();
  await sleep(300);

  // 4. Bulk +3 % for the available units on floors >= 10 (the floor filter is still on).
  const before = new Map(cells().map((c) => [c.dataset.id, { price: +c.dataset.price, floor: +c.dataset.floor, free: c.classList.contains('nb-s-free') }]));
  const targets = [...before].filter(([, v]) => v.floor >= 10 && v.free);
  const pct = $('#nb-bulk-pct');
  if (pct) input(pct, '3');
  await sleep(100);
  step('bulk targets', +$('.nb-bulk-info').dataset.n === targets.length, [$('.nb-bulk-info').dataset.n, targets.length]);
  $('#nb-bulk-apply').click();
  await sleep(400);
  const ok = $$('.ed-dialog .ed-dlg-foot .ed-primary').at(-1);
  if (ok) ok.click();
  await sleep(500);
  const after = new Map(cells().map((c) => [c.dataset.id, +c.dataset.price]));
  // The expected price is recomputed independently (x1.03, rounded to $100 = 10000 minor units, minimum one step)
  // and compared per unit; every unit outside the targets must be unchanged.
  const want = (p) => Math.max(10000, Math.round(Math.round(p * 1.03) / 10000) * 10000);
  const wrong = [...before].filter(([id, v]) => (v.floor >= 10 && v.free ? after.get(id) !== want(v.price) : after.get(id) !== v.price));
  step('bulk +3 % applied', targets.length > 0 && !wrong.length, wrong.slice(0, 3).map(([id, v]) => [id, v.price, after.get(id)]));
  const changed = [...before].filter(([id, v]) => after.get(id) !== v.price).length;
  step('bulk only floors >= 10', changed > 0 && changed <= targets.length, changed);
  $('#nb-bulk-undo').click();
  await sleep(400);
  const back = cells().filter((c) => +c.dataset.price !== before.get(c.dataset.id).price);
  step('bulk undone', back.length === 0, back.length);
  input(floorMin, '');
  await sleep(300);

  // 5. The mortgage page in a frame: the principal parts sum to the loan.
  const href = document.getElementById('pg-mortgage').getAttribute('href');
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none';
  frame.src = href + '#unit=A-1203';
  document.body.append(frame);
  // onload or a 4 s timeout, whichever first: a file:// frame may not fire load reliably in every runner.
  await new Promise((r) => { frame.onload = r; setTimeout(r, 4000); });
  await sleep(800);
  const fd = frame.contentDocument;
  const check = (kind) => {
    const tbl = fd && fd.querySelector('.nb-sched');
    if (!tbl) return { ok: false, why: 'no schedule' };
    const body = +tbl.dataset.body;
    const sum = [...tbl.querySelectorAll('tbody td[data-principal]')].reduce((s, td) => s + +td.dataset.principal, 0);
    const rows = tbl.querySelectorAll('tbody tr').length;
    // The decisive invariant of estate/mortgage.js: the principal column sums to the loan exactly, in both the body and
    // the footer total.
    return { ok: tbl.dataset.kind === kind && body > 0 && sum === body && +tbl.querySelector('tfoot td[data-sum]').dataset.sum === body, body, sum, rows, kind: tbl.dataset.kind };
  };
  const unitSel = fd && fd.getElementById('nb-ln-unit');
  step('mortgage unit from the board', unitSel && unitSel.value === 'A-1203', unitSel && unitSel.value);
  const a = check('annuity');
  step('annuity principal = loan', a.ok, a);
  const diff = fd && [...fd.querySelectorAll('.ed-seg-btn')].find((b) => b.dataset.v === 'differentiated');
  if (diff) diff.click();
  await sleep(400);
  const d = check('differentiated');
  step('differentiated principal = loan', d.ok, d);
  const ann = fd && [...fd.querySelectorAll('.ed-seg-btn')].find((b) => b.dataset.v === 'annuity');
  if (ann) ann.click();
  await sleep(200);
  frame.remove();
  return { steps };
}
