// unit-converter/e2e.js - in-page scenario (node check.js e2e unit-converter/html@5_offline_singlefile/index.html
// unit-converter/e2e.js; the same file runs on tables.html): typed quantities are read in three languages and
// converted to every unit, affine temperatures are right away from zero, compound inputs, swap, pins, the nearby
// table, the price and room helpers; on the tables page the cheat sheet renders its rows, presets and errors.
//
// How it works: check.js imports this module in Node, takes mod.default.toString() and evaluates that source inside
// the loaded page. Consequence: the function must be self-contained (no imports, no module-level helpers; a closure
// over module scope would be a ReferenceError in the page). Each step() records [name, 'ok' | 'FAIL', observed value]; the observed value is what
// makes a failure diagnosable from the log alone. The scenario drives the real UI (sets .value, dispatches 'input',
// clicks buttons) rather than calling app functions: it must also pass on the single-file build, where modules are
// inlined and nothing is importable.
// Timing: fixed sleeps (100-200 ms) cover the debounced handlers; they are not waiting for the network (the app is
// offline), only for the event loop and debounce timers.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const lang = document.documentElement.lang || 'en';
  // The decimal mark of the page language, derived from the browser's own formatter, so assertions do not hardcode
  // '.' or ','.
  const dec = (0.5).toLocaleString(lang).replace(/\d/g, '')[0] || '.';
  // A number shown by the page back to a JS number (grouping removed, the language's decimal mark).
  const num = (s) => {
    if (s == null) return NaN;
    // Removes ordinary, no-break and narrow no-break spaces (grouping) and maps Unicode minus and dashes to '-'.
    let x = String(s).replace(/[\s  ]/g, '').replace(/[−‒–]/g, '-');
    x = dec === ',' ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    const m = x.match(/-?\d+(?:\.\d+)?/);
    return m ? +m[0] : NaN;
  };
  // 0.011 default tolerance: the UI rounds to two decimals, so expected values given to 2 decimals match within half
  // a unit of the last digit plus float slack.
  const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

  // ------------------------------------------------------------------------------------------- tables page
  // One file for both pages: the presence of the sheet decides which scenario runs.
  if (document.querySelector('.uc-sheet')) {
    const cards = () => [...document.querySelectorAll('.uc-tcard')];
    step('default sheet tables', cards().length >= 4, cards().length);
    const first = cards()[0];
    const rows = first ? first.querySelectorAll('table')[0].querySelectorAll('tbody tr').length : 0;
    step('m² table rows 10…200', rows === 20, rows);
    const r100 = first?.querySelector('tr[data-v="100"] td:last-child')?.textContent;
    step('100 m² = 1076.4 sq ft', near(num(r100), 1076.4, 0.06), r100);
    step('reverse table rendered', (first?.querySelectorAll('table').length || 0) === 2, first?.querySelectorAll('table').length);
    const temp = cards()[1];
    const t0 = temp?.querySelector('tr[data-v="0"] td:last-child')?.textContent, tm30 = temp?.querySelector('tr[data-v="-30"] td:last-child')?.textContent;
    step('0 °C = 32 °F in table', num(t0) === 32, t0);
    step('-30 °C = -22 °F in table', num(tm30) === -22, tm30);
    document.querySelector('.uc-chip[data-p="height"]').click();
    await sleep(200);
    const h = cards().at(-1);
    const h180 = h?.querySelector('tr[data-v="180"] td:last-child')?.textContent;
    step('height preset in feet and inches', /5\D+11/.test(h180 || ''), h180);
    step('preset selected for editing', h?.classList.contains('uc-on'), h?.className);
    const stepIn = [...document.querySelectorAll('.uc-grid3 input')][2];
    // Programmatic .value does not fire input; the event is dispatched by hand, exactly what a keystroke would cause.
    stepIn.value = 'abc'; stepIn.dispatchEvent(new Event('input'));
    await sleep(150);
    step('bad step reported', !!cards().at(-1).querySelector('.uc-bad'), cards().at(-1).querySelector('.uc-bad')?.textContent);
    // Remove the added preset again.
    cards().at(-1).querySelectorAll('.uc-tcard-h button')[1].click();
    await sleep(150);
    step('table removed', cards().length >= 4, cards().length);
    return { steps };
  }

  // ------------------------------------------------------------------------------------------- converter page
  const input = document.querySelector('#uc-in');
  // type(): replace the whole value and fire one input event, then wait for the synchronous repaint to settle.
  const type = async (s) => { input.value = s; input.dispatchEvent(new Event('input')); await sleep(120); };
  const val = (code) => document.querySelector(`.uc-row[data-u="${code}"] .uc-val`)?.textContent;
  const sys = async (v) => { document.querySelector(`.ed-seg-btn[data-v="${v}"]`).click(); await sleep(100); };

  await sys('metric');
  await type('42,5 м²');
  step('42,5 м² read as area', /42[.,]5/.test(document.querySelector('#uc-read').textContent) && !document.querySelector('#uc-read').classList.contains('uc-bad'), document.querySelector('#uc-read').textContent);
  step('42,5 м² → sq ft', near(num(val('sqft')), 457.47), val('sqft'));
  step('main result is sq ft', /457[.,]47/.test(document.querySelector('#uc-result')?.textContent || ''), document.querySelector('#uc-result')?.textContent);
  step('formula shown', /10[.,]76391042/.test(document.querySelector('.uc-formula')?.textContent || ''), document.querySelector('.uc-formula')?.textContent);
  const nearRows = document.querySelectorAll('.uc-near tbody tr').length;
  step('nearby table rows', nearRows >= 6 && !!document.querySelector('.uc-near tr.uc-cur'), nearRows);

  // Temperature is affine (offset, not just a factor): -40 is the fixed point, 0 and 100 check the offset, 37 checks
  // a non-round value. A purely multiplicative implementation fails all but -40.
  for (const [c, f] of [[-40, -40], [0, 32], [37, 98.6], [100, 212]]) {
    await type(`${c} °C`);
    step(`${c} °C → ${f} °F`, near(num(val('f')), f), val('f'));
    if (c === 37) step('37 °C → 310.15 K', near(num(val('k')), 310.15), val('k'));
  }
  await type('-40 °F');
  step('-40 °F → -40 °C', near(num(val('c')), -40), val('c'));

  await type("5'11\"");
  step("5'11\" → 180.34 cm", near(num(val('cm')), 180.34), val('cm'));
  await type('1 ч 30 мин');
  step('1 ч 30 мин → 90 min', near(num(val('min')), 90), val('min'));
  await type('85 კვ. მ');
  step('85 კვ. მ → 914.93 sq ft', near(num(val('sqft')), 914.93), val('sqft'));
  await type('2.5 kg');
  step('2.5 kg → 5.51 lb', near(num(val('lb')), 5.51), val('lb'));
  await type('abc');
  step('unreadable input reported', document.querySelector('#uc-read').classList.contains('uc-bad'), document.querySelector('#uc-read').textContent);

  // A bare number takes the unit of the list (the last typed unit).
  await type('42,5 м²');
  await type('10');
  step('bare number keeps m²', near(num(val('sqft')), 107.64), val('sqft'));

  // System highlight.
  await type('42,5 м²');
  await sys('us');
  const home = [...document.querySelectorAll('.uc-row.uc-home')].map((r) => r.dataset.u);
  step('US units highlighted', home.includes('sqft') && !home.includes('m2'), home.join(' '));
  await sys('metric');

  // Swap: 42.5 m² -> 457.47… sq ft, and back to 42.5 m².
  // Action buttons by position (copy, copy equation, swap, pin): labels are translated, positions are not.
  const actions = () => [...document.querySelectorAll('.uc-main .ap-actions button')];
  actions()[2].click();
  await sleep(150);
  step('swap puts sq ft in the input', /^457[.,]466/.test(input.value) && /sq ft|кв\. фут|კვ\. ფუტი/.test(input.value), input.value);
  step('swap converts back to m²', near(num(val('m2')), 42.5), val('m2'));
  await type('42,5 м²');

  // Pin / unpin a pair.
  await type('3 km');
  const pins0 = document.querySelectorAll('.uc-pin').length;
  actions()[3].click();
  await sleep(120);
  const pins1 = document.querySelectorAll('.uc-pin').length;
  step('pair pinned', pins1 === pins0 + 1 && !!document.querySelector('.uc-pin.uc-on'), [pins0, pins1]);
  actions()[3].click();
  await sleep(120);
  step('pair unpinned', document.querySelectorAll('.uc-pin').length === pins0, document.querySelectorAll('.uc-pin').length);
  step('walking distance word', !!document.querySelector('.uc-word'), document.querySelector('.uc-word')?.textContent);

  // Choosing another target from the list.
  document.querySelector('.uc-row[data-u="yd"] .uc-pick').click();
  await sleep(120);
  step('target picked from the list', /3[ ,.  ]?280[.,]84/.test(document.querySelector('#uc-result')?.textContent || ''), document.querySelector('#uc-result')?.textContent);

  // History (Enter adds the value).
  await type('2.5 kg');
  // bubbles: true because the app listens on the input itself, but a delegated handler would need bubbling too.
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(120);
  step('history entry', [...document.querySelectorAll('.uc-hist-item')].some((b) => b.textContent === '2.5 kg'), document.querySelectorAll('.uc-hist-item').length);

  // Price per unit: 250 g for 3,49 / 1 kg for 11,90 / 500 g for 5,20 -> the 500 g pack is best.
  const outs = [...document.querySelectorAll('.uc-pout')];
  step('price per kg', outs.length >= 3 && /13[.,]96/.test(outs[0].textContent), outs[0]?.textContent);
  step('best offer marked', outs[2]?.classList.contains('uc-best'), outs.map((o) => o.className).join(' | '));

  // Rooms: 24 + 12,5 + 3,2 × 3,6 + 4,2 + 6 + 3,1 = 61,32 m², two bedrooms + kitchen-living -> Euro 2+1.
  const sum = document.querySelector('.uc-rsum')?.textContent || '';
  step('flat total area', /61[.,]32/.test(sum), sum.slice(0, 80));
  step('Euro layout word', /Euro 2\+1|Евротрёшка/.test(sum), sum.slice(-60));

  // Distance words.
  const ladder = document.querySelector('.uc-ladder .uc-step.uc-on .uc-step-w')?.textContent;
  step('650 m is the "nearby" step', !!ladder && document.querySelectorAll('.uc-ladder .uc-step')[1].classList.contains('uc-on'), ladder);

  await type('42,5 м²');
  return { steps };
}
