// funding-studio/e2e-backend.js - in-page end-to-end scenario of the backend artifact, run by e2e-run.js (which starts
// the backend with in-memory storage, the mock providers of payments/mock.js and a published charity site, then calls
//   node check.js e2e <base>admin.html#e2e=<{token, site, siteId}> funding-studio/e2e-backend.js [--size 390x844 --mobile]).
// Signs in to the admin console through its form, opens the published campaign page in a frame, gives 60 € by card:
// the page asks the backend for a Stripe Checkout Session (mock), the mock's hosted page completes it, sends the signed
// webhook and returns to the thank-you page, which shows the confirmed donation. Then the goal's live figure has grown
// by 60 €, the console lists the donation, and approving the donor on the wall puts the name on the live wall.
// Returns { steps }; serialized, so no imports.
export default async function scenario() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = await f(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 160));
      await sleep(80);
    }
  };
  const R = { steps: [] };
  // Steps here depend on each other (pay -> webhook -> ledger -> wall), so after the first failure later steps are
  // reported as skipped instead of producing a cascade of misleading failures.
  let stop = false;
  const step = async (name, fn) => {
    if (stop) { R.steps.push([name, 'FAIL', 'skipped after an earlier failure']); return; }
    try { R.steps.push([name, 'ok', await fn()]); } catch (e) { stop = true; R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 600)]); }
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const typeInto = (el, value) => { el.focus(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const cfg = JSON.parse(decodeURIComponent((location.hash.match(/e2e=([^&]+)/) || [])[1] || '{}'));
  const apiBase = new URL('api/', location.href).href;
  const live = async () => (await fetch(apiBase + 'sites/' + cfg.siteId + '/live', { cache: 'no-store' })).json();
  const donor = 'E2E Donor ' + Math.random().toString(36).slice(2, 7);
  const AMOUNT = 60;
  let camp = '';
  let before = null;
  let shownBefore = 0;
  const num = (x) => Number(String(x).replace(/[^\d]/g, ''));

  await step('console: sign in with the admin token', async () => {
    if (!cfg.token || !cfg.site) throw new Error('no e2e config in the hash');
    const pw = await until(() => $('#main input[type=password]'));
    typeInto(pw, cfg.token);
    $$('#main .ap-card button.ed-btn').pop().click();
    await until(() => $('.fa-tabs') && $('.fa-camp'));
    return { sites: $$('.fa-camp strong').map((x) => x.textContent), stats: $$('.fa-stat strong').map((x) => x.textContent), width: innerWidth };
  });

  const fr = document.createElement('iframe');
  fr.style.cssText = `position:fixed;left:0;top:0;width:${innerWidth}px;height:${innerHeight}px;border:0;z-index:99999;background:#fff`;
  document.body.append(fr);
  const doc = () => { try { return fr.contentDocument; } catch { return null; } };
  const openPage = async (url) => {
    const old = doc();
    if (old) old.__fdOld = true; // wait for the new document, not the one being replaced
    fr.src = url;
    return until(() => { const d = doc(); return d && !d.__fdOld && d.readyState === 'complete' && d.location.href.startsWith(url.split('?')[0]) && d.querySelector('.fd-don') ? d : null; });
  };

  await step('published page: live figures from the backend', async () => {
    const d = await openPage(cfg.site);
    camp = d.querySelector('.fd-don').getAttribute('data-camp');
    before = (await live()).camps[camp];
    const raised = d.querySelector('[data-fd-raised]');
    await until(() => raised && /\d/.test(raised.textContent));
    // The buttons that need the server are enabled once the live figures arrived (they also update the goal).
    await until(() => { const b = d.querySelector('.fd-m[data-m=stripe]'); return b && !b.disabled; });
    shownBefore = num(raised.textContent);
    const overflow = d.documentElement.scrollWidth - d.documentElement.clientWidth;
    if (overflow > 1) throw new Error('horizontal overflow ' + overflow + 'px');
    const ready = $$('.fd-m', d).map((b) => b.getAttribute('data-m') + (b.disabled ? ':off' : ''));
    return { camp, raised: raised.textContent, before, methods: ready };
  });

  await step('donate 60 € by card: Checkout Session, mock hosted page, signed webhook, thank-you page', async () => {
    const d = doc();
    d.querySelector(`.fd-amt[data-amt="${AMOUNT}"]`).click();
    typeInto(d.querySelector('[data-fd-f=name]'), donor);
    typeInto(d.querySelector('[data-fd-f=email]'), 'e2e@example.test');
    typeInto(d.querySelector('[data-fd-f=message]'), 'Sent by the end-to-end scenario');
    const sum = d.querySelector('[data-fd-sum]').textContent;
    d.querySelector('.fd-m[data-m=stripe]').click();
    // Leaves for the mock provider's origin, comes back to the thank-you page of this site.
    const t = await until(() => { const x = doc(); return x && /\/thanks\//.test(x.location.pathname) && x.readyState === 'complete' ? x : null; }, 20000);
    const ok = await until(() => t.querySelector('.fd-status-ok'), 15000);
    return { sum, thanks: t.location.pathname, query: t.location.search.replace(/k=[^&]+/, 'k=…'), status: ok.textContent, receipt: !!$$('a', t).find((a) => /api\/receipts\//.test(a.href)) };
  });

  await step('the goal grew by the donation (live API and the page)', async () => {
    const after = await until(async () => { const x = (await live()).camps[camp]; return x.raised >= before.raised + AMOUNT ? x : null; });
    if (Math.abs(after.raised - before.raised - AMOUNT) > 0.001) throw new Error(`raised ${before.raised} -> ${after.raised}`);
    if (after.donors !== before.donors + 1) throw new Error(`donors ${before.donors} -> ${after.donors}`);
    const d = await openPage(cfg.site);
    const raised = d.querySelector('[data-fd-raised]');
    // The page shows the figure entered in the editor plus the ledger.
    await until(() => num(raised.textContent) === shownBefore + AMOUNT);
    const bar = d.querySelector('[data-fd-prog][data-camp="' + camp + '"] [role=progressbar]');
    return { ledger: [before.raised, after.raised], page: [shownBefore, num(raised.textContent)], donors: [before.donors, after.donors], shown: raised.textContent, bar: bar && bar.getAttribute('aria-valuenow') };
  });

  await step('console: the donation is in the ledger', async () => {
    fr.style.display = 'none';
    $$('.fa-tab')[1].click();
    const row = await until(() => $$('.fa-table tbody tr').find((tr) => tr.textContent.includes(donor)));
    const st = row.querySelector('.fa-tag[class*="fa-st-"]');
    if (!st || !st.className.includes('fa-st-succeeded')) throw new Error('status: ' + (st && st.className));
    return { row: row.textContent.replace(/\s+/g, ' ').slice(0, 160), receipt: !!row.querySelector('a[href*="api/receipts/"]') };
  });

  await step('console: approving the donor puts the name on the live wall', async () => {
    const w0 = (await live()).camps[camp].wall || [];
    if (w0.some((x) => x.n === donor)) throw new Error('on the wall before approval');
    $$('.fa-tab')[2].click();
    const row = await until(() => $$('.fa-table tbody tr').find((tr) => tr.textContent.includes(donor)));
    row.querySelector('.fa-acts button.ed-primary').click();
    const w1 = await until(async () => { const w = (await live()).camps[camp].wall || []; return w.some((x) => x.n === donor) ? w : null; });
    fr.style.display = '';
    const d = await openPage(cfg.site);
    await until(() => [...d.querySelectorAll('.fd-wall-live')].some((li) => li.textContent.includes(donor)), 10000);
    return { wall: w1.length, onPage: true };
  });

  fr.remove();
  return R;
}
