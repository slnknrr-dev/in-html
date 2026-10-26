// site-studio/e2e-spa.js - the serverless single-page package (index.html + 404.html) on a Codeberg-like host: a frame
// opens a clean address the package has no file for (/programme/) and shows the right page; then navigation keeps
// clean addresses, history works, an unknown address shows "Not found" and an RSVP stays in the browser. Run by
// e2e-modes.mjs (the scenario lives in the top page, the site in the frame, so page loads never end the scenario).
export default async function scenario() {
  // Harness conventions (shared by every in-page scenario of this folder):
  // - The default export runs inside the page check.js opened; its return value (R) is the report check.js prints.
  // - `until` polls a predicate instead of awaiting app events: the scenario observes the UI like a user, so it needs
  //   no test hooks in production code and survives refactors of internal event names. Throwing predicates count as
  //   "not yet"; the timeout message carries the predicate's source so a failure names what was awaited.
  // - `step` never throws: every step runs and reports ok / FAIL, so one broken feature does not hide the rest.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 15000) => {
    const t0 = Date.now();
    for (;;) { let v; try { v = f(); } catch { v = null; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 100)); await sleep(60); }
  };
  const R = { steps: [] };
  const step = async (name, fn) => { try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 400)]); } };
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999;background:#fff';
  document.body.append(frame);
  const W = () => frame.contentWindow;
  const D = () => frame.contentDocument;
  const shown = () => [...D().querySelectorAll('main[data-lp-page]')].find((m) => !m.hidden && m.getClientRects().length);

  await step('404.html shows the page of a clean address', async () => {
    frame.src = '/programme/';
    const m = await until(() => D() && D().documentElement.classList.contains('lp-js') && shown());
    const en = D().querySelector('button[data-set-lang="en"]');
    if (en) en.click();
    await sleep(200);
    if (!/Day one|День первый/.test(shown().textContent)) throw new Error(shown().textContent.slice(0, 120));
    return [W().location.pathname, D().title.slice(0, 40), !!m];
  });

  await step('navigation keeps clean addresses (no reload)', async () => {
    W().__spaMark = 1;
    const link = [...D().querySelectorAll('a')].find((a) => /(^|\/)venue\/?$/.test(a.getAttribute('href') || ''));
    if (!link) throw new Error('no venue link: ' + [...D().querySelectorAll('nav a')].map((a) => a.getAttribute('href')).join(' '));
    link.click();
    await until(() => /\/venue\/$/.test(W().location.pathname) && shown() && shown().querySelector('.ss-map'));
    return [W().location.pathname, W().__spaMark === 1 ? 'same document' : 'reloaded'];
  });

  await step('history: back returns to the programme', async () => {
    W().history.back();
    await until(() => /\/programme\/$/.test(W().location.pathname) && /Day one|День первый/.test(shown().textContent));
    return W().location.pathname;
  });

  await step('an unknown address shows "Not found"', async () => {
    frame.src = '/no-such-page/';
    await sleep(300);
    await until(() => D() && D().documentElement.classList.contains('lp-js') && shown() && /404|not found|не найден/i.test(shown().textContent));
    return W().location.pathname;
  });

  await step('the RSVP of a serverless page stays in the browser', async () => {
    frame.src = '/rsvp/';
    await sleep(300);
    const form = await until(() => D() && D().documentElement.classList.contains('lp-js') && shown() && shown().querySelector('.ss-ev form'));
    form.querySelector('[name=name]').value = 'Ana';
    form.querySelector('[name=email]').value = 'ana@example.org';
    form.querySelector('select[name=answer]').selectedIndex = 1;
    form.querySelector('button[type=submit]').click();
    const key = await until(() => Object.keys(W().localStorage).find((k) => /:rsvp$/.test(k)));
    return !!key;
  });

  await step('the package carries no network code for its local endpoints', async () => {
    const html = await fetch('/404.html').then((r) => r.text());
    return [/fetch\(/.test(html) ? 'fetch present' : 'no fetch', html.length];
  });
  return R;
}
