// floor-planner/e2e.js - in-page scenario of the editor (node check.js e2e floor-planner/html@5_offline_singlefile/index.html
// floor-planner/e2e.js): load the wedding hall template, check seats, add a round table, undo / redo, load the studio
// flat and check its area against the room list, export SVG and look for the scale bar.
// Assertions read data-stat / data-v attributes (raw numbers) rather than formatted text, so they hold in any UI
// language; templates give known totals (120 seats, 13 tables, 29.4 m² studio, 3 sleeping places).
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const stat = (k) => Number(document.querySelector(`[data-stat="${k}"]`)?.dataset.v);
  const tpl = async (id) => {
    document.querySelector('.fp-toolbar .ed-primary').click();
    await sleep(200);
    document.querySelector(`.fp-tpl[data-tpl="${id}"]`).click();
    await sleep(400);
  };

  await tpl('wedding');
  step('wedding seats', stat('seats') === 120, stat('seats'));
  step('wedding tables', stat('tables') === 13, stat('tables'));
  step('no checks', document.querySelector('.fp-count')?.dataset.n === '0', document.querySelector('.fp-count')?.dataset.n);

  // First palette tab, then a click on a palette item: keyboard-style activation adds the stencil at the view centre.
  [...document.querySelectorAll('.fp-ptabs button')][0].click();
  await sleep(100);
  document.querySelector('.fp-pitem[data-k="table-round"]').click();
  await sleep(300);
  step('table added', stat('seats') === 128 && stat('tables') === 14, stat('seats'));
  const undoBtn = [...document.querySelectorAll('.fp-toolbar .fp-ib')].find((b) => b.title.includes('Ctrl+Z'));
  const redoBtn = [...document.querySelectorAll('.fp-toolbar .fp-ib')].find((b) => b.title.includes('Ctrl+Y'));
  undoBtn.click(); await sleep(300);
  step('undo', stat('seats') === 120, stat('seats'));
  redoBtn.click(); await sleep(300);
  step('redo', stat('seats') === 128, stat('seats'));

  await tpl('studio');
  const rooms = [...document.querySelectorAll('.fp-table tbody tr td.fp-r')].map((td) => parseFloat(td.textContent.replace(',', '.')));
  const sum = Math.round(rooms.reduce((a, b) => a + b, 0) * 10) / 10;
  step('studio area', Math.abs(stat('area') - 29.4) < 0.15 && Math.abs(sum - stat('area')) < 0.15, [stat('area'), sum]);
  step('sleeping places', stat('sleep') === 3, stat('sleep'));

  let svg = '';
  // The SVG download is intercepted at URL.createObjectURL: the Blob passing through is read before it becomes a URL.
  const orig = URL.createObjectURL;
  URL.createObjectURL = (b) => { b.text().then((s) => { svg = s; }); return orig.call(URL, b); };
  [...document.querySelectorAll('.fp-xbtn')][0].click();
  await sleep(300);
  URL.createObjectURL = orig;
  step('svg scale bar', svg.includes('plan-scale') && /width="[\d.]+mm"/.test(svg) && svg.includes('1:100'), svg.length);

  // Seating page link exists.
  step('seating link', !!document.querySelector('.ap-pages a[href*="seating"]'), document.querySelector('.ap-pages a:last-child')?.getAttribute('href'));
  return { steps };
}
