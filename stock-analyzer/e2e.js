// stock-analyzer/e2e.js - in-page scenario of the analysis page (node check.js e2e
// stock-analyzer/html@5_offline_singlefile/index.html stock-analyzer/e2e.js): the demo data loads, the 3×3 matrix
// adds up to the items, a matrix cell filters the table, the Pareto chart draws its bars, cut-off lines and the
// cumulative line and follows the A cut-off, and the reorder page (loaded in a frame) proposes orders by supplier.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  // Polling (50ms) with a deadline instead of fixed sleeps where rendering is asynchronous (frame load).
  const wait = async (fn, ms = 6000) => { for (let i = 0; i < ms / 50; i++) { const v = fn(); if (v) return v; await sleep(50); } return null; };

  // Demo data.
  // The demo button is found by its text in any of three UI languages, excluding the "demo CSV" download button.
  const demoBtn = [...document.querySelectorAll('#sa-data button')].find((b) => b.querySelector('.ed-ic') && /demo|демо|დემო/i.test(b.textContent) && !/csv/i.test(b.textContent));
  demoBtn?.click();
  await sleep(400);
  step('demo loaded', !!demoBtn && /123/.test(document.querySelector('.sa-dsum')?.textContent || ''), document.querySelector('.sa-dsum-meta')?.textContent);

  // Matrix: 9 cells + 3 "new" cells add up to all items.
  // Invariant: every item lands in exactly one of the 12 cells (9 ABC x XYZ + 3 "new"), so counts sum to the items.
  const cells = [...document.querySelectorAll('#sa-matrix .sa-mcell')];
  const total = cells.reduce((s, c) => s + Number(c.dataset.count), 0);
  const items = Number(document.querySelector('.sa-kpi-v')?.textContent.replace(/\D/g, ''));
  step('matrix has 12 cells', cells.length === 12, cells.length);
  step('matrix adds up to the items', total === items && items === 123, { total, items });
  const ax = Number(document.querySelector('.sa-mcell[data-cell="AX"]')?.dataset.count);
  step('AX is populated', ax > 0, ax);

  // A cell filters the table.
  const cz = document.querySelector('.sa-mcell[data-cell="CZ"]');
  cz.click();
  await sleep(150);
  const rows = document.querySelectorAll('#sa-table-card tbody tr').length;
  step('CZ filters the table', rows === Number(cz.dataset.count) && rows > 0, rows);
  step('CZ advice shown', /CZ/.test(document.querySelector('.sa-advice')?.textContent || ''), document.querySelector('.sa-advice')?.textContent.slice(0, 60));
  document.querySelector('.sa-mcell[data-cell="CZ"]').click();
  await sleep(150);

  // Pareto chart.
  const svg = document.querySelector('#sa-pareto-card svg.sa-pareto');
  const bars = svg ? svg.querySelectorAll('.sa-bar').length : 0;
  step('pareto bars', bars >= 100, bars);
  step('pareto cumulative line', !!svg?.querySelector('polyline.sa-cum'), svg?.querySelector('polyline.sa-cum')?.getAttribute('points').split(' ').length);
  step('pareto cut-off lines', svg?.querySelectorAll('.sa-cut').length === 2, svg?.querySelectorAll('.sa-cut').length);
  const aBars = () => document.querySelectorAll('#sa-pareto-card .sa-bar.sa-b-A').length;
  const before = aBars();
  // Moving the A cut-off from 80% to 60% must shrink class A; restoring it must restore the exact count (determinism).
  const range = document.querySelector('#sa-pareto-card .sa-cuts input[type=range]');
  range.value = '60'; range.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(400);
  const after = aBars();
  step('A cut-off moves the classes', after < before, { before, after });
  range.value = '80'; range.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(400);
  step('A cut-off restored', aBars() === before, aBars());

  // Reorder page in a frame (same origin under file:// with the checker's flags, or any http host).
  const href = document.getElementById('pg-plan')?.getAttribute('href');
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:1200px;height:800px;position:fixed;left:-3000px;top:0';
  frame.src = href;
  document.body.append(frame);
  // contentDocument may throw while the frame is cross-origin (about:blank -> file:// transition): treated as "not yet".
  const doc = await wait(() => { try { const d = frame.contentDocument; return d && d.querySelector('.sa-order') ? d : null; } catch { return null; } }, 10000);
  const orders = doc ? [...doc.querySelectorAll('.sa-order')] : [];
  step('plan proposes orders', orders.length >= 3, orders.length);
  const dairy = orders.find((o) => o.dataset.supplier === 'imereti');
  const lines = dairy ? [...dairy.querySelectorAll('tbody tr')] : [];
  const qtys = lines.map((tr) => Number(tr.querySelector('.sa-qty')?.textContent.replace(/[^\d.]/g, '')));
  // Demo supplier "imereti" sells in multiples of 6: every proposed quantity must be a positive multiple of 6.
  step('dairy order lines rounded to the multiple of 6', lines.length > 0 && qtys.every((q) => q >= 6 && q % 6 === 0), qtys.slice(0, 8));
  step('order has a delivery date', /\d/.test(dairy?.querySelector('.sa-order-m')?.textContent || ''), dairy?.querySelector('.sa-order-m span')?.textContent);
  const greens = orders.find((o) => o.dataset.supplier === 'greens');
  // The demo greens supplier has days off right after the demo's last sales day, so its order must be postponed with
  // a warning.
  step('supplier holiday moves the order day', !!greens?.querySelector('.sa-warnc') && !!greens.querySelector('.sa-warns'), greens?.querySelector('.sa-warnc')?.textContent);
  frame.remove();
  return { steps };
}
