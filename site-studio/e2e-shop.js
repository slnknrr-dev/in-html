// site-studio/e2e-shop.js - a backend shop (template "Online store"): the catalogue served by the site's server, the
// cart, checkout stored on the server and read in the admin console, the content collection the console edits (a new
// price is published at once). Run by e2e-modes.mjs, opened at /catalog/.
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
    for (;;) { let v; try { v = await f(); } catch { v = null; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 100)); await sleep(80); }
  };
  const R = { steps: [] };
  const step = async (name, fn) => { try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 400)]); } };
  const json = (url, method = 'GET', body) => fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

  await step('the server answers and the page knows it', async () => {
    const ping = await json('/api/_ping');
    await until(() => document.documentElement.classList.contains('lp-api-on'));
    return [ping.ok, ping.auth];
  });

  await step('an administrator account (the first one)', async () => {
    const r = await json('/api/_auth/register', 'POST', { email: 'shop@example.org', password: 'a long password', name: 'Shop owner' });
    return r.user.role;
  });

  await step('cart and checkout: the order reaches the server', async () => {
    const adds = await until(() => document.querySelectorAll('[data-lp-add]').length > 2 && [...document.querySelectorAll('[data-lp-add]')]);
    adds[0].click();
    adds[1].click();
    await until(() => Object.keys(localStorage).some((k) => /^lp-cart:/.test(k) && JSON.parse(localStorage.getItem(k)).items.length === 2));
    const goBtn = await until(() => [...document.querySelectorAll('[data-lp-checkout-go]')].find((b) => b.getClientRects().length));
    goBtn.click();
    const form = await until(() => [...document.querySelectorAll('form[data-lp-checkout]')].find((f) => f.getClientRects().length));
    for (const el of form.querySelectorAll('input,textarea,select')) {
      if (el.type === 'hidden' || el.type === 'submit' || el.disabled) continue;
      if (el.type === 'checkbox') { el.checked = true; continue; }
      if (el.tagName === 'SELECT') { if (el.options.length > 1) el.selectedIndex = 1; continue; }
      el.value = el.type === 'email' ? 'buyer@example.org' : el.type === 'tel' ? '+995555123456' : 'Test buyer';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    form.querySelector('[type=submit]').click();
    const recs = await until(async () => { const j = await json('/api/_admin/c/orders'); return j.records && j.records.length && j.records; });
    return [recs.length, (recs[0].data.items || []).length, !!recs[0].data.orderId];
  });

  await step('the admin console edits the catalogue; the site is rebuilt', async () => {
    const c = await json('/api/_admin/content/products');
    const items = c.items.map((it, i) => (i === 0 ? { ...it, price: 777 } : it));
    const r = await json('/api/_admin/content/products', 'PUT', { items });
    const html = await fetch('/catalog/', { cache: 'no-store' }).then((x) => x.text());
    return [r.ok, /777/.test(html), (await fetch('/data/products.json').then((x) => x.json())).items[0].price];
  });

  await step('wholesale prices stay closed for a buyer without the role', async () => {
    const me0 = (await json('/api/_auth/me')).user;
    const res = await fetch('/wholesale/', { cache: 'no-store', credentials: 'same-origin' });
    const html = await res.text();
    if (!/Price list|Прайс-лист/.test(html)) throw new Error(JSON.stringify([res.status, me0, html.slice(0, 300)]));
    // The administrator opens every section; a new buyer does not.
    await json('/api/_auth/logout', 'POST', {});
    await json('/api/_auth/register', 'POST', { email: 'buyer@example.org', password: 'another long one' });
    const closed = await fetch('/wholesale/', { cache: 'no-store', credentials: 'same-origin' }).then((x) => x.text());
    return [/Price list|Прайс-лист/.test(html), /Price list|Прайс-лист/.test(closed)];
  });
  return R;
}
