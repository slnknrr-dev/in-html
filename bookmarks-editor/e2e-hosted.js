// bookmarks-editor/e2e-hosted.js - in-page end-to-end scenario of the hosted page (a generated backend server with an
// empty data folder), run by check.js:
//   node html@5_backend_singlefile/bookmarks-editor.mjs 8090 --data <empty folder>
//   node check.js e2e http://127.0.0.1:8090/ bookmarks-editor/e2e-hosted.js
// Creates the owner on the set-up screen, adds a public bookmark and waits for the sync, reads it back from the API and
// the public page, opens Settings (account, bookmarklet, users, invitation link), and receives an edit made by another
// device through the sync API. Returns { steps }; serialized, so no imports.
//
// Same polling technique as e2e.js; the remote edit uses the sync API with its own client id, as a second device
// would, to prove that pulls reach the open page.
export default async function scenario() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 10000) => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = await f(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 120));
      await sleep(50);
    }
  };
  const R = { steps: [] };
  const step = async (name, fn) => {
    try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 500)]); }
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const typeInto = (el, value) => { el.focus(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };

  await step('set-up screen creates the owner', async () => {
    const form = await until(() => $('.bm-auth-form'));
    const title = $('h2', form).textContent;
    const inputs = $$('input', form);
    typeInto(inputs[0], 'owner');
    typeInto(inputs[1], 'owner password 1');
    typeInto(inputs[2], 'owner password 1');
    $('button[type="submit"]', form).click();
    await until(() => window.__bmReady);
    return [title, window.__bm.S.account.user, window.__bm.S.account.role, !!$('.bm-chip-sync')];
  });
  const { S, UI } = window.__bm || {};
  if (!S) return R;

  let id = '';
  await step('add a public bookmark, synced', async () => {
    const b = S.lib.add({ url: 'https://public.example/page', title: 'A public page', public: true, tags: ['shared'] });
    id = b.id;
    S.lib.add({ url: 'https://private.example/', title: 'A private page' });
    await until(() => S.account.status === 'ok' && S.account.pending === 0 && S.account.last);
    const res = await (await fetch('/api/sync?since=0', { credentials: 'same-origin' })).json();
    return [S.account.status, res.changes.length, res.changes.some((r) => r.id === id)];
  });

  await step('public page and feed', async () => {
    const html = await (await fetch('/u/owner')).text();
    const feed = await (await fetch('/u/owner/feed')).text();
    return [html.includes('A public page'), !html.includes('A private page'), (feed.match(/<entry>/g) || []).length];
  });

  await step('settings: account, bookmarklet, users, invitation link', async () => {
    UI.settings();
    const d = await until(() => $('.bm-dlg-settings'));
    const bm = await until(() => $('.bm-bookmarklet', d));
    const users = await until(() => $('.bm-owner .bm-rows', d) && $('.bm-owner .bm-rows', d).textContent);
    const inviteBtn = $$('.bm-owner button', d).find((b) => b.textContent.includes('New invitation link'));
    inviteBtn.click();
    const link = await until(() => $$('.bm-owner .bm-secret code', d).map((c) => c.textContent).find((x) => x.includes('#invite=')));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
    return [bm.getAttribute('href').startsWith('javascript:'), users.includes('owner'), link.startsWith(location.origin)];
  });

  await step('an edit from another device arrives', async () => {
    const login = await (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'owner', password: 'owner password 1', token: true }) })).json();
    const rec = JSON.parse(JSON.stringify(S.lib.record(id)));
    const stamp = (Date.now() + 1000).toString(36).padStart(9, '0') + '.0000.otherdev';
    rec.v.title = 'Renamed elsewhere';
    rec.s.title = stamp;
    const res = await fetch('/api/sync', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token }, body: JSON.stringify({ since: 0, changes: [rec] }) });
    S.account.syncNow();
    await until(() => S.lib.get(id).title === 'Renamed elsewhere');
    return [res.status, S.lib.get(id).title, $('.bm-list').textContent.includes('Renamed elsewhere')];
  });

  await step('editor shows the public switch, no metadata button while the server does not fetch pages', async () => {
    UI.edit(null);
    const d = await until(() => $$('.ed-backdrop:not(.ed-out) .ed-dialog').pop());
    const r = [d.textContent.includes('Public'), !d.textContent.includes('Fetch')];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
    return r;
  });

  await step('no missing strings', async () => [...(window.__edMissingKeys || [])]);
  return R;
}
