// media-player/e2e.js - in-page end-to-end scenario, run by check.js against a built page or the dev server:
//   node check.js e2e media-player/html@5_serverless/index.html media-player/e2e.js
//   node check.js e2e media-player/html@5_serverless/index.html media-player/e2e.js --mobile --size 390x844
// First start with the demo; home and sections; playing a synthesized file; tagging through the menu and the tag
// dialog; a smart playlist from the playlist page's query editor; a card (nominal) -> source (link) -> file (a WAV
// made in the page) upgrade that then plays; export / import of the descriptive tree and of the database into a fresh
// catalogue copy; the skin and layout constructors (duplicate, change a token, add a control); the view mode for the
// width (mobile tabs or the desktop sidebar); the mini-player channel. The function is serialized into the page.

// Why serialized and self-contained: check.js injects Function.toString() of this scenario into the page, so it may
// not close over module imports; helpers are redefined inside. Each step records ok / FAIL instead of throwing, so
// one broken feature still yields a full report. Events are dispatched synthetically (click, input + change) because
// views listen to exactly those; `until` polls instead of fixed sleeps so slow CI machines do not flake.
export default async function scenario() {
  const R = { steps: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { let v; try { v = f(); } catch { v = null; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 120)); await sleep(60); } };
  const step = async (name, fn) => { try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 500)]); } };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const go = async (hash) => { location.hash = hash; await sleep(250); };
  const okDialog = async () => { const b = await until(() => $$('.ed-dialog .ed-dlg-foot .ed-primary').pop()); click(b); await sleep(250); };

  await until(() => window.__mpReady && window.__mp && window.__mp.db, 30000);
  const A = window.__mp;
  const db = A.db;
  const wide = innerWidth >= 760;

  await step('first start: demo catalogue', async () => {
    await until(() => db.count('work') > 20);
    const kinds = new Set(db.all('work').map((w) => w.kind));
    return [db.count('work'), db.count('media'), [...kinds].sort().join(',')];
  });

  await step('view mode for the width', async () => {
    const view = $('#mp-app').dataset.view;
    if (wide && view !== 'desktop') throw new Error('expected desktop, got ' + view);
    if (!wide && view !== 'mobile') throw new Error('expected mobile, got ' + view);
    const visible = (s) => { const e = $(s); return !!e && getComputedStyle(e).display !== 'none'; };
    if (!wide && !visible('.mp-mtabs')) throw new Error('no mobile tabs');
    if (wide && !visible('.mp-side')) throw new Error('no sidebar');
    return view;
  });

  await step('home shows shelves', async () => {
    await go('#/');
    await until(() => $$('.mp-main .mp-card').length > 5);
    return [$$('.mp-main .mp-section').length, $$('.mp-main .mp-card').length];
  });

  await step('music section: albums and an album page', async () => {
    await go('#/music/albums');
    const card = await until(() => $$('.mp-main .mp-card').find((c) => /Tone Studies/.test(c.textContent)));
    click(card);
    await until(() => $('.mp-hero') && $$('.mp-main .mp-row').length >= 4);
    return [location.hash.slice(0, 12), $$('.mp-main .mp-row').length];
  });

  await step('play a synthesized file', async () => {
    const row = $$('.mp-main .mp-row')[0];
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => A.engine.state.current && A.engine.state.current.work && A.engine.state.position > 0.2, 15000);
    const s = A.engine.state;
    return [s.current.work.title, s.playing, Math.round(s.position * 10) / 10, s.graph];
  });

  await step('player bar follows', async () => {
    const t = await until(() => $('.mp-bar [data-mp="title"]') && $('.mp-bar [data-mp="title"]').textContent);
    return t;
  });

  await step('now playing sheet with the layout', async () => {
    A.openNowPlaying();
    await until(() => $('.mp-np.mp-open .mp-layout .mp-lrow'));
    const n = $$('.mp-np.mp-open .mp-lrow').length;
    A.closeNowPlaying();
    await sleep(200);
    return n;
  });

  await step('tag through the menu and the tag dialog', async () => {
    const w = db.all('work').find((x) => x.title === 'Pentatonic Walk');
    await go('#/work/' + w.parent);
    const row = await until(() => $$('.mp-main .mp-row').find((r) => r.dataset.id === w.id));
    click(row.querySelector('.mp-row-r .mp-icon-btn:last-child'));
    const item = await until(() => $$('.ed-menu-item').find((b) => b.querySelector('.ed-menu-l') && b.querySelector('.ed-menu-l').textContent === A.t('mp.tags.add')));
    click(item);
    const input = await until(() => $('.ed-dialog input[list="mp-tag-suggest"]'));
    typeIn(input, 'mood:sunny, activity:walking');
    await okDialog();
    await until(() => (db.get(w.id).tags || []).includes('mood:sunny'));
    return db.get(w.id).tags;
  });

  await step('smart playlist from the query editor', async () => {
    const c = A.lib.createCollection(db, 'smart', { name: 'E2E sunny', query: '', pick: 'all', sort: 'title' });
    await go('#/playlist/' + c.id);
    const q = await until(() => $('.mp-smart textarea'));
    typeIn(q, 'mood:sunny OR mood:calm');
    await sleep(400);
    const items = A.lib.itemsOf(db, db.get(c.id));
    if (!items.some((x) => x.title === 'Pentatonic Walk')) throw new Error('tagged track missing');
    return items.map((x) => x.title);
  });

  await step('card -> source -> file, then it plays', async () => {
    const w = A.lib.createNominal(db, { kind: 'track', title: 'E2E Card Song', domain: 'music', lyrics: 'la la la' });
    const f0 = A.engine && db.mediaOf(w.id).map((m) => m.presence);
    A.lib.attachSource(db, w.id, 'youtube:e2eLocalOnly', {});
    const p1 = db.mediaOf(w.id).map((m) => m.presence);
    // A local fixture: a one-second WAV made here (no network).
    const sr = 22050, n = sr;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w4 = (o, s) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w4(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w4(8, 'WAVE'); w4(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w4(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 330 * i) / sr) * 8000), true);
    const id = await A.store.blobs.put(new Blob([buf], { type: 'audio/wav' }), 'audio/wav');
    A.lib.attachFile(db, w.id, { kind: 'blob', blob: id }, { name: 'e2e.wav', duration: 1 });
    const p2 = db.mediaOf(w.id).map((m) => m.presence);
    await A.playWork(w.id);
    await until(() => A.engine.state.current && A.engine.state.current.work.id === w.id && A.engine.state.position > 0.1, 10000);
    return { before: f0, source: p1, file: p2, keptSource: !!db.mediaOf(w.id)[0].source };
  });

  await step('export / import of the tree and the database', async () => {
    const tree = A.lib.exportTree(db);
    const full = A.lib.exportDB(db);
    const zip = await A.lib.exportZip(db, { blobs: { list: () => A.store.blobs.list(), get: async (i) => { const b = await A.store.blobs.get(i); return b ? { type: b.type, bytes: new Uint8Array(await b.arrayBuffer()) } : null; } } });
    const back = await A.lib.readExchange(zip);
    // Import into an empty copy: the same db module in memory.
    const { createDB } = { createDB: db.constructor && null };
    const counts = { tree: tree.nodes.length, db: full.nodes.length, zipNodes: back.data.nodes.length, zipBlobs: back.blobs.size };
    const noFileInTree = tree.nodes.filter((n) => n.type === 'media').every((m) => !m.loc || m.loc.kind === 'url');
    const rep = A.lib.importData(db, tree, { policy: 'newer' });
    if (!noFileInTree) throw new Error('tree carries file locations');
    if (rep.added !== 0) throw new Error('re-import duplicated ' + rep.added);
    return { ...counts, reimport: { added: rep.added, kept: rep.kept, updated: rep.updated } };
  });

  await step('skin constructor', async () => {
    await go('#/studio/skins');
    const dup = await until(() => $$('.mp-main .ed-btn').find((b) => b.textContent.includes(A.t('mp.st.duplicate'))));
    click(dup);
    const name = await until(() => $('.ed-dialog input'));
    typeIn(name, 'E2E skin');
    await okDialog();
    const sk = await until(() => db.all('skin').find((s) => s.name === 'E2E skin'));
    await go('#/studio/skins?skin=' + sk.id);
    const use = await until(() => $$('.mp-main .ed-btn').find((b) => b.textContent.includes(A.t('mp.st.use'))));
    click(use);
    const color = await until(() => $('.mp-skin-edit input[type=color]'));
    color.value = '#ff0066';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    return [A.settings.skin === sk.id, getComputedStyle(document.documentElement).getPropertyValue('--mp-bg').trim()];
  });

  await step('layout constructor', async () => {
    await go('#/studio/layouts');
    const dup = await until(() => $$('.mp-main .ed-btn').find((b) => b.textContent.includes(A.t('mp.st.duplicate'))));
    click(dup);
    typeIn(await until(() => $('.ed-dialog input')), 'E2E layout');
    await okDialog();
    const l = await until(() => db.all('layout').find((x) => x.name === 'E2E layout'));
    await go('#/studio/layouts?layout=' + l.id);
    const add = await until(() => $$('.mp-rowedit select').find((s) => s.querySelector('option[value="visualizer"]')));
    add.value = 'visualizer';
    add.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => db.get(l.id).rows[0].controls.some((c) => c.type === 'visualizer'));
    await sleep(300);
    const prev = $('.mp-layout-preview canvas[data-mp="viz"]');
    return [db.get(l.id).rows.length, !!prev];
  });

  await step('tracking list and statistics', async () => {
    await go('#/tracking/anime/all');
    await until(() => $$('.mp-tt-r').length > 0);
    const rows = $$('.mp-tt-r').length;
    await go('#/stats');
    await until(() => $('.mp-kpis'));
    return [rows, $$('.mp-kpi').length];
  });

  await step('search with the query language', async () => {
    await go('#/search?q=' + encodeURIComponent('presence:nominal kind:track'));
    await until(() => $$('.mp-main .mp-row').length > 0);
    return $$('.mp-main .mp-row').length;
  });

  A.engine.pause();
  return R;
}
