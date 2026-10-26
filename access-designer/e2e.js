// access-designer/e2e.js - in-page scenario of the roles page (node check.js e2e access-designer/index.html
// access-designer/e2e.js). On the retail system demo: an inherited grant names its source role, a revoke wins and is
// explained along the chain, lapsed personal grants show; the modules page (in a frame) cascades a disabled module to
// its dependants and the sessions page narrows rights with the session scope. Then a new empty project: a module with a
// dependency (a cycle is refused) and its cascade, a new entity resolved by the policy, a new config key layered by
// the site; the presets are switched; a project of format 1 still loads.
// Serialized into the page: only browser globals. Elements are found by data-* attributes (state, from, col) that the
// pages expose for exactly this purpose, so checks verify semantics (who granted a cell) rather than colours/text.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const until = async (fn, n = 60) => { for (let i = 0; i < n; i++) { const v = fn(); if (v) return v; await sleep(60); } return null; };
  const cell = (doc, col, sec, act) => doc.querySelector(`.acd-matrix .acd-c[data-col="${col}"][data-sec="${sec}"][data-act="${act}"]`);
  const name = (id) => document.querySelector('.acd-roleitem[data-id="' + id + '"] .acd-roleitem-n')?.textContent;
  const confirm = async (doc = document) => { const b = await until(() => [...doc.querySelectorAll('.ed-dialog .ed-primary')].find((x) => !x.dataset.done)); if (b) { b.dataset.done = '1'; b.click(); } await sleep(300); };
  const input = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const frame = async (id) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:900px;opacity:0;pointer-events:none';
    fr.src = document.getElementById(id).getAttribute('href');
    document.body.append(fr);
    const d = await until(() => { try { const x = fr.contentDocument; return x && x.readyState === 'complete' && x.querySelector('.acd-work') ? x : null; } catch { return null; } }, 100);
    await sleep(100);
    return { fr, d };
  };

  // --- the retail system demo (the default project) ---------------------------------------------------------------
  let c = cell(document, 'senior', 'catalog', 'view');
  step('inherited cell state', c && c.dataset.state === 'inh' && c.dataset.from === 'staff', c && { ...c.dataset });
  c.click();
  await sleep(80);
  const ex = document.getElementById('acd-explain');
  step('inherited explanation names the source', ex.dataset.verdict === 'allowed' && ex.dataset.source === 'staff' && ex.querySelector('.acd-ex-v').textContent.includes(name('staff')), ex.querySelector('.acd-ex-v')?.textContent);

  c = cell(document, 'trainee', 'pos', 'create');
  step('revoked cell state', c && c.dataset.state === 'rev' && c.dataset.revoked === 'trainee', c && { ...c.dataset });
  c.click();
  await sleep(80);
  const decisive = [...ex.querySelectorAll('.acd-tr-dec')].map((li) => li.dataset.role);
  const v = ex.querySelector('.acd-ex-v').textContent;
  step('revoke explained along the chain', ex.dataset.verdict === 'denied' && decisive.join(',') === 'cashier,trainee' && v.includes(name('cashier')) && v.includes(name('trainee')), { decisive, v });
  step('parent keeps it', cell(document, 'cashier', 'pos', 'create')?.dataset.state === 'own', cell(document, 'cashier', 'pos', 'create')?.dataset.state);

  document.querySelector('.acd-roleitem[data-id="staff"]').click();
  await sleep(60);
  document.querySelector('.acd-editor .acd-g[data-sec="analytics"][data-act="view"]').click();
  await sleep(80);
  step('new grant is inherited by children', cell(document, 'cashier', 'analytics', 'view')?.dataset.from === 'staff', cell(document, 'cashier', 'analytics', 'view')?.dataset.state);

  [...document.querySelectorAll('.acd-tools .ed-seg-btn')].find((b) => b.dataset.v === 'members').click();
  await sleep(80);
  step('lapsed personal grant', cell(document, 'm5', 'prices', 'edit')?.dataset.state === 'lapsed', cell(document, 'm5', 'prices', 'edit')?.dataset.state);
  [...document.querySelectorAll('.acd-tools .ed-seg-btn')].find((b) => b.dataset.v === 'roles').click();
  await sleep(40);

  let f = await frame('pg-modules');
  if (!f.d) step('modules page loads', false, 'no frame');
  else {
    const sw = f.d.querySelector('input[data-mod="pos"]');
    sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    const removed = (f.d.getElementById('acd-cascade')?.dataset.removed || '').split(',');
    step('disabling POS cascades to dependants', ['pos', 'cash', 'online'].every((x) => removed.includes(x)), removed);
    const sw2 = f.d.querySelector('input[data-mod="online"]');
    sw2.checked = true; sw2.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    step('enabling Online brings POS back', f.d.querySelector('input[data-mod="pos"]').checked, f.d.getElementById('acd-cascade')?.textContent);
    f.fr.remove();
  }

  f = await frame('pg-sessions');
  if (!f.d) step('sessions page loads', false, 'no frame');
  else {
    const eff = f.d.getElementById('acd-effective');
    const all = +eff.dataset.rights, n = +eff.dataset.effective;
    step('scope narrows rights', n > 0 && n < all, { all, n });
    step('dropped right is shown', f.d.querySelector('[data-right="prices.approve"]')?.dataset.why === 'drop', f.d.querySelector('[data-right="prices.approve"]')?.textContent);
    const ro = [...f.d.querySelectorAll('.acd-scope[data-scope="scope"] input.ed-switch')].at(-1);
    ro.checked = true; ro.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    const n2 = +f.d.getElementById('acd-effective').dataset.effective;
    step('read-only narrows further', n2 < n && n2 > 0, { before: n, after: n2 });
    f.fr.remove();
  }

  // --- a new empty project ---------------------------------------------------------------------------------------
  document.getElementById('acd-new-empty').click();
  await confirm();
  const items = document.querySelectorAll('.acd-roleitem');
  step('empty project: one owner role', items.length === 1 && items[0].dataset.id === 'owner' && document.querySelectorAll('.acd-matrix tbody tr').length === 0, items.length);

  // A section, so modules have something to bring.
  const sec = document.querySelector('.acd-model .acd-addrow input');
  input(sec, 'Orders');
  document.querySelector('.acd-model .acd-addrow button').click();
  await sleep(80);
  step('section added', !!cell(document, 'owner', 'orders', 'view'), document.querySelectorAll('.acd-matrix tbody tr').length);

  f = await frame('pg-modules');
  if (f.d) {
    const add = (n) => { input(f.d.getElementById('acd-new-module'), n); f.d.getElementById('acd-add-module').click(); };
    add('Core'); await sleep(100); add('Reports'); await sleep(100);
    // Reports is selected: depend on Core.
    let dep = f.d.querySelector('#acd-mod-detail .acd-checks input[value="core"]');
    dep.checked = true; dep.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    step('module with a dependency', f.d.querySelector('.acd-mod[data-mod="reports"]')?.textContent.includes('Core'), f.d.querySelector('.acd-mod[data-mod="reports"]')?.textContent);
    // Core cannot depend on Reports (a cycle).
    f.d.querySelector('.acd-mod[data-mod="core"] .acd-mod-b').click();
    await sleep(80);
    dep = f.d.querySelector('#acd-mod-detail .acd-checks input[value="reports"]');
    dep.checked = true; dep.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    step('dependency cycle refused', !f.d.querySelector('#acd-mod-detail .acd-checks input[value="reports"]').checked, f.d.querySelector('.ed-toast-msg')?.textContent);
    const sw = f.d.querySelector('input[data-mod="core"]');
    sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    const removed = (f.d.getElementById('acd-cascade')?.dataset.removed || '').split(',');
    step('new module cascades', removed.includes('core') && removed.includes('reports'), removed);
    f.fr.remove();
  } else step('modules page loads', false, 'no frame');

  f = await frame('pg-policies');
  if (f.d) {
    input(f.d.getElementById('acd-new-entity'), 'Tickets');
    f.d.getElementById('acd-add-entity').click();
    await sleep(120);
    const row = f.d.querySelector('#acd-resolved tr[data-rule="tickets.view"]');
    const rowE = f.d.querySelector('#acd-resolved tr[data-rule="tickets.edit"]');
    step('new entity resolved by the policy', !!row && !!rowE && !!row.querySelector('.acd-chip') && f.d.querySelectorAll('#acd-ptrail li').length >= 2, row?.textContent);
    f.fr.remove();
  } else step('policies page loads', false, 'no frame');

  f = await frame('pg-config');
  if (f.d) {
    input(f.d.getElementById('acd-new-key'), 'accent');
    f.d.getElementById('acd-add-key').click();
    await sleep(120);
    let tas = f.d.querySelectorAll('.acd-layer textarea');
    input(tas[0], JSON.stringify({ title: 'App', accent: 'blue' }));
    await sleep(80);
    tas = f.d.querySelectorAll('.acd-layer textarea');
    input(tas[1], JSON.stringify({ accent: 'teal', api_token: 'x' }));
    await sleep(150);
    const r = f.d.querySelector('#acd-snapshot tr[data-key="accent"]');
    step('new config key layered by the site', r?.dataset.source === 'site' && r.textContent.includes('teal') && r.textContent.includes('default'), r?.textContent);
    step('secret key stripped from the layer', !!f.d.querySelector('[data-lost="api_token"]'), f.d.querySelector('[data-lost="api_token"]')?.textContent);
    f.fr.remove();
  } else step('config page loads', false, 'no frame');

  // --- presets ---------------------------------------------------------------------------------------------------
  for (const [id, role] of [['portal', 'agency'], ['clinic', 'intern'], ['saas', 'junior'], ['retail', 'trainee']]) {
    const sel = document.getElementById('acd-preset');
    sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('acd-load-preset').click();
    await confirm();
    const it = document.querySelector(`.acd-roleitem[data-id="${role}"]`);
    step('preset ' + id, !!it && it.textContent.trim() !== role && document.querySelectorAll('.acd-matrix tbody tr').length > 4, it?.textContent);
  }

  // --- a project of format 1 still loads -------------------------------------------------------------------------
  localStorage.setItem('ad-project', JSON.stringify({
    format: 'access-designer', version: 1, now: '2026-11-01', actions: ['view', 'edit'], sections: [{ id: 'catalog', name: '' }, { id: 'pos', name: 'Tills' }],
    roles: [{ id: 'staff', name: '', parent: null, grants: { catalog: ['view'] } }, { id: 'cashier', name: '', parent: 'staff', grants: { pos: ['view'] } }],
    members: [], policy: { entities: { sales: { own: ['created_by'] } }, permissions: {}, org: { mode: 'medium' }, roles: {}, members: {}, records: [] },
    modules: { catalog: { pos: { sections: ['pos'], deps: [] } }, enabled: ['pos'], org: {}, roles: {}, members: {} },
  }));
  f = await frame('pg-roles');
  if (f.d) {
    const head = [...f.d.querySelectorAll('.acd-matrix tbody th')].map((x) => x.textContent);
    const cashier = f.d.querySelector('.acd-roleitem[data-id="cashier"] .acd-roleitem-n')?.textContent;
    step('format 1 project migrated', head.includes('Tills') && cashier && cashier !== 'cashier' && f.d.querySelector('.acd-matrix .acd-c[data-col="cashier"][data-sec="catalog"][data-act="view"]')?.dataset.from === 'staff', { head, cashier });
    f.fr.remove();
  } else step('format 1 loads', false, 'no frame');

  localStorage.removeItem('ad-project');
  return { steps };
}
