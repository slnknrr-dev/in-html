// site-studio/e2e-backend.js - a backend site with accounts (template "Site with accounts"): sign-up through the
// page's form, the profile, closed pages by role, the admin console's accounts, sign-in by an e-mail link (the link
// read from the outbox) and sign-out. Run by e2e-modes.mjs on the generated server.
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
  const page = (url) => fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(async (r) => ({ status: r.status, text: await r.text() }));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999;background:#fff';
  document.body.append(frame);
  const load = (url) => new Promise((r) => { frame.onload = () => r(frame.contentDocument); frame.src = url; });

  await step('a closed page shows the sign-in block to a visitor', async () => {
    const r = await page('/lessons/');
    if (/Exposure triangle|Треугольник экспозиции/.test(r.text)) throw new Error('content leaked');
    return [r.status, /data-ss-acc/.test(r.text)];
  });

  await step('sign-up through the form of the site', async () => {
    const d = await load('/sign-up/');
    const f = await until(() => d.querySelector('form[data-ss-acc="signup"]'));
    f.querySelector('[name=name]').value = 'Owner';
    f.querySelector('[name=email]').value = 'owner@example.org';
    f.querySelector('[name=password]').value = 'a long password';
    f.querySelector('button[type=submit]').click();
    await until(() => /\/account\/$/.test(frame.contentWindow.location.pathname));
    const hello = await until(() => { const x = frame.contentDocument.querySelector('[data-ss-acc-hello]'); return x && /owner@example\.org|Owner/.test(x.textContent) && x.textContent; });
    return hello;
  });

  await step('the first account administers the site and opens every section', async () => {
    const r = await fetch('/api/_admin/users', { credentials: 'same-origin' }).then((x) => x.json());
    const m = await page('/mentors/');
    if (!/Before a critique session|Перед разбором/.test(m.text)) throw new Error('admin cannot open a role page');
    // The console refuses to be framed (frame-ancestors 'none'): its page and its API with the session.
    const con = await page('/admin/');
    const info = await fetch('/api/_admin/info').then((x) => x.json());
    return [r.users.length, r.users[0].role, /Site admin|adminApp/.test(con.text), info.accounts.users];
  });

  let link = '';
  await step('a new member signs in by a link from the e-mail (outbox without SMTP)', async () => {
    const d = await load('/sign-in/');
    const f = await until(() => d.querySelector('form[data-ss-acc="signin"]'));
    f.querySelector('[name=email]').value = 'ann@example.org';
    f.querySelector('[data-ss-acc-link]').click();
    await until(() => /check your e-mail|проверьте почту/i.test((d.querySelector('[data-ss-acc-msg]') || {}).textContent || ''));
    const box = await fetch('/api/_admin/outbox').then((x) => x.json());
    link = (/\/_auth\/link\?t=[A-Za-z0-9_-]+/.exec(box.outbox[0].text) || [''])[0];
    await fetch('/api/_auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await load(link);
    const me = await until(async () => { const j = await fetch('/api/_auth/me').then((x) => x.json()); return j.user && j.user; });
    return [!!link, me.email, me.role, box.smtp];
  });

  await step('a member sees the closed page; a role page stays closed', async () => {
    const a = await page('/lessons/');
    const b = await page('/mentors/');
    if (!/Exposure triangle|Треугольник экспозиции/.test(a.text)) throw new Error('members page not opened');
    if (/Before a critique session|Перед разбором/.test(b.text)) throw new Error('role page opened');
    return [a.status, b.status];
  });

  await step('sign-out from the profile ends the session', async () => {
    const d = await load('/account/');
    const out = await until(() => { const x = d.querySelector('[data-ss-acc-out]'); return x && x.closest('form') && !x.closest('form').hidden && x; });
    out.click();
    await until(async () => !(await fetch('/api/_auth/me').then((x) => x.json())).user);
    const a = await page('/lessons/');
    return /Exposure triangle|Треугольник экспозиции/.test(a.text) ? 'still open' : 'closed';
  });
  frame.remove();
  return R;
}
