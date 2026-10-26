// rental-studio/e2e.js - in-page scenario (node check.js e2e rental-studio/html@5_offline_singlefile/index.html
// rental-studio/e2e.js): the demo loads, a booking added over the nights of a confirmed booking is reported as a
// conflict, the prices page (an iframe of the sibling page) quotes a free stay, and the payouts page posts the month's
// accruals so that an owner's statement equals the sum of that owner's splits.
// The function is serialized into the page: it may use only browser globals.
// The other pages are opened in a same-origin iframe (pg-* anchors give the built hrefs) so one scenario can cover the
// cross-page flow through the shared localStorage project. Test-only edits are removed again before the money checks.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const until = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 100) { const v = fn(); if (v) return v; await sleep(100); } return null; };
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };

  step('demo loaded', document.querySelectorAll('.rs-tl-row[data-unit]').length === 3 && document.querySelectorAll('.rs-bar').length > 3, document.querySelectorAll('.rs-bar').length);
  const project = JSON.parse(localStorage.getItem('rs-project') || '{}');
  step('demo has ~40 bookings', project.bookings && project.bookings.length >= 30 && project.bookings.length <= 55, project.bookings && project.bookings.length);
  step('no conflicts in the demo', document.querySelector('#rs-conflicts')?.dataset.count === '0', document.querySelector('#rs-conflicts')?.dataset.count);

  // A conflicting booking: the same flat and nights as a confirmed one of this month.
  const bar = document.querySelector('.rs-tl-row[data-unit] .rs-bar.rs-b-confirmed');
  const target = project.bookings.find((b) => b.id === bar.dataset.id);
  document.querySelector('#rs-add-booking').click();
  const dlg = await until(() => document.querySelector('.rs-bdlg'));
  const unitSel = dlg.querySelector('select');
  unitSel.value = target.unitId; unitSel.dispatchEvent(new Event('change'));
  set(dlg.querySelector('#rs-b-guest'), 'E2E Overbooking');
  set(dlg.querySelector('#rs-b-from'), target.from);
  set(dlg.querySelector('#rs-b-to'), target.to);
  await sleep(150);
  step('dialog warns before saving', !!dlg.querySelector('.rs-dlg-warn .rs-w-error'), dlg.querySelector('.rs-dlg-warn')?.textContent);
  dlg.querySelector('.rs-dlg-save').click();
  await sleep(500);
  const cf = document.querySelector('#rs-conflicts');
  step('conflict listed after saving', cf && cf.dataset.count === '1' && cf.textContent.includes('E2E Overbooking'), cf && cf.dataset.count);
  step('conflicting bar marked', document.querySelectorAll('.rs-bar.rs-b-conflict').length >= 2, document.querySelectorAll('.rs-bar.rs-b-conflict').length);
  // Remove it again so the money checks below run on the demo.
  const p2 = JSON.parse(localStorage.getItem('rs-project'));
  p2.bookings = p2.bookings.filter((b) => b.guest !== 'E2E Overbooking');
  localStorage.setItem('rs-project', JSON.stringify(p2));

  const frame = async (id) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:0;top:0;width:1300px;height:900px;border:0;z-index:99999;background:#fff';
    f.src = document.getElementById(id).href;
    document.body.append(f);
    const d = await until(() => { try { return f.contentDocument && f.contentDocument.querySelector('.ap-card') && f.contentDocument; } catch { return null; } }, 8000);
    return { f, d };
  };

  // Quote a stay far enough ahead to be free.
  {
    const { f, d } = await frame('pg-prices');
    step('prices page opened', !!d, d ? 'ok' : 'no access');
    if (d) {
      // toISOString is UTC: near midnight in far-off zones the day may shift by one, harmless here (200 days ahead).
      const day = (k) => { const x = new Date(); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10); };
      set(d.querySelector('#rs-q-from'), day(200));
      set(d.querySelector('#rs-q-to'), day(205));
      await sleep(200);
      const q = d.querySelector('.rs-quote');
      step('quote ok', q.dataset.ok === 'true' && Number(q.dataset.total) > 0, q.dataset.total + ' ' + d.querySelector('#rs-q-total')?.textContent);
      set(d.querySelector('#rs-q-to'), day(200));
      await sleep(200);
      step('bad range explained', q.dataset.error === 'bad_range' && !!q.querySelector('.rs-qerr .rs-code'), q.dataset.error);
      set(d.querySelector('#rs-q-from'), day(-30)); set(d.querySelector('#rs-q-to'), day(-25));
      await sleep(200);
      step('past dates explained', q.dataset.error === 'past', q.dataset.error);
    }
    f.remove();
  }

  // Post the month's accruals and compare an owner's statement with the split table.
  {
    const { f, d } = await frame('pg-payouts');
    step('payouts page opened', !!d, d ? 'ok' : 'no access');
    if (d) {
      const btn = d.querySelector('#rs-post-all');
      step('unposted bookings this month', btn && !btn.disabled, btn && btn.textContent);
      btn.click();
      await sleep(500);
      const posted = [...d.querySelectorAll('#rs-split tbody tr')].filter((tr) => tr.dataset.posted === 'true').length;
      step('bookings posted', posted > 0, posted);
      // Every owner column: split sum = statement accrued - deducted (no expenses or payouts in the current month).
      const proj = JSON.parse(localStorage.getItem('rs-project'));
      for (const o of proj.parties.filter((p) => p.kind === 'owner')) {
        const sumCell = d.querySelector(`#rs-split tfoot td[data-party="${o.id}"]`);
        const split = sumCell ? Number(sumCell.dataset.sum) : 0;
        const sel = d.querySelector('#rs-st-party');
        sel.value = o.id; sel.dispatchEvent(new Event('change'));
        await sleep(150);
        const s = d.querySelector('#rs-st-sum').dataset;
        const net = Number(s.accrued) - Number(s.deducted);
        step('statement = splits · ' + o.name, net === split && Number(s.closing) === Number(s.opening) + net - Number(s.paid), { split, accrued: +s.accrued, deducted: +s.deducted, opening: +s.opening, closing: +s.closing });
      }
      step('web valid', d.querySelector('#rs-web .rs-warns')?.dataset.errors === '0' && !!d.querySelector('.rs-diagram svg'), d.querySelector('#rs-web .rs-warns')?.dataset.errors);
    }
    f.remove();
  }

  // Leave a clean demo behind.
  for (const k of ['rs-project', 'rs-cal', 'rs-prices', 'rs-pay']) localStorage.removeItem(k);
  return { steps };
}
