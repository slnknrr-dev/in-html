// route-planner/e2e.js - in-page scenario of the plan page (node check.js e2e route-planner/html@5_offline_singlefile/index.html
// route-planner/e2e.js): the demo loads, the optimised route is shorter than the entered one, every pickup comes before
// its delivery, the GPX export has a waypoint per stop, manual reordering recomputes totals, pasted lines are read.
//
// How it works: check.js loads the BUILT single-file page in a headless browser and runs this function inside it; the
// returned { steps: [name, 'ok'|'FAIL', observed value] } is the report. It drives the real UI (clicks, key events)
// and reads results from ids and data-* attributes (data-km, data-kind, data-pair) rather than visible text, so the
// test is independent of the UI language and of number formatting. The observed value is reported even on success,
// so a FAIL line shows what was seen instead of just "false".
// Fixed sleeps instead of waiting for conditions: every update path is debounced by a known small delay (replan
// 90 ms), so 100-500 ms is ample; the cost is a slower test, the benefit no polling helpers.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // Demo over existing data asks for confirmation; ?. because on an empty state no dialog appears.
  $('#rp-demo').click();
  await sleep(200);
  $('.ed-dialog .ed-primary')?.click();
  await sleep(500);
  const stops = $$('#rp-table tbody tr').length;
  step('demo stops', stops === 12, stops);
  const entered = +$('#rp-km-entered').dataset.km, opt = +$('#rp-km-opt').dataset.km;
  step('optimised < entered', opt > 0 && opt < entered, `${opt} < ${entered}`);
  // The return row repeats the depot; excluding it keeps findIndex positions equal to visiting order.
  const items = $$('#rp-pl .rp-pl-item').filter((li) => !li.classList.contains('rp-pl-ret'));
  const pos = (kind, pair) => items.findIndex((li) => li.dataset.kind === kind && li.dataset.pair === pair);
  for (const p of ['A', 'B']) step('pickup before delivery ' + p, pos('pickup', p) >= 0 && pos('pickup', p) < pos('delivery', p), `${pos('pickup', p)} < ${pos('delivery', p)}`);
  step('map drawn', $$('#rp-map .rp-m-mk').length === 12, $$('#rp-map .rp-m-mk').length);

  [...$$('#rp-fmt button')].find((b) => b.dataset.v === 'gpx').click();
  await sleep(150);
  const gpx = $('#rp-out').value;
  const wpts = (gpx.match(/<wpt /g) || []).length;
  step('gpx waypoints', wpts === 12 && gpx.includes('<gpx version="1.1"'), wpts);
  // Each table latitude must appear in the GPX, either as written or re-formatted to the 6 decimals exportGPX uses.
  const lats = $$('#rp-table .rp-in-coord').map((i) => i.value.split(',')[0].trim());
  step('gpx has all points', lats.every((l) => gpx.includes(`lat="${(+l).toFixed(6)}`) || gpx.includes(`lat="${l}`)), lats.length);
  [...$$('#rp-fmt button')].find((b) => b.dataset.v === 'polyline').click();
  await sleep(100);
  // Encoded polyline alphabet is ASCII 63..126 ('?'..'~'): each 5-bit chunk + 63. Anything else means a broken encoder.
  step('polyline', /^[\x3f-\x7e]{20,}$/.test($('#rp-out').value), $('#rp-out').value.length);

  // Manual reorder with the keyboard. Moving a stop away from the optimum can only lengthen the route, hence >= opt.
  const h = $$('#rp-pl button.rp-handle')[0];
  h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await sleep(300);
  const man = $('#rp-km-manual');
  step('manual order recomputed', !!man && +man.dataset.km >= opt, man?.dataset.km);

  // Paste lines: decimal-comma coordinates after ';', and DMS with prime/double-prime signs, both must parse.
  $('#rp-paste-box').open = true;
  $('#rp-paste').value = 'Test A; 41,6500 41,6400\nTest B 41°39′00″N 41°38′00″E';
  $('#rp-paste-add').click();
  await sleep(400);
  step('paste adds stops', $$('#rp-table tbody tr').length === 14, $$('#rp-table tbody tr').length);
  step('sheet link', !!$('#rp-sheet-link')?.getAttribute('href'), $('#rp-sheet-link')?.getAttribute('href'));
  return { steps };
}
