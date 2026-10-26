// site-studio/e2e.js - in-page end-to-end scenario of Site Studio (the editor and the offline one-file package), run
// by check.js on desktop and phone widths:
//   node check.js e2e site-studio/html@5_offline_singlefile/index.html site-studio/e2e.js
//   node check.js e2e site-studio/html@5_offline_singlefile/index.html site-studio/e2e.js --size 375x812 --mobile
// The gallery (three groups, mode labels, module tags), the four export packages, Site → Map / SEO / README, then
// sites exported as one file and run in a frame: a shop (cart in the browser, checkout to a local endpoint), an
// apartment (price calendar: arrival, departure, nights and total), an event (countdown, RSVP stored locally, .ics),
// a fund (data table sorting and filter) and a portal whose closed sections show a note instead of their content.
// The serverless (404.html), backend (accounts) and constructor packages are covered by e2e-modes.mjs.
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
    for (;;) {
      let v;
      try { v = f(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 100));
      await sleep(50);
    }
  };
  const R = { steps: [] };
  const step = async (name, fn) => {
    try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 400)]); }
  };
  await until(() => window.__edReady, 20000);
  const E = window.__ed;
  const SS = window.__ss;
  const width = /Mobi|Android/.test(navigator.userAgent) ? Math.min(375, window.innerWidth) : window.innerWidth;
  const tplOf = (id) => SS.TEMPLATES.find((x) => x.id === id);

  await step('gallery: three groups, mode labels, module tags', async () => {
    await until(() => document.querySelector('.ed-dlg-tpl'));
    const groups = [...document.querySelectorAll('.ed-tpl-gh')].map((x) => x.textContent.trim());
    const modes = ['offline', 'serverless', 'backend'].map((m) => document.querySelectorAll('.ed-tpl-mode-' + m).length);
    const tags = document.querySelectorAll('.ed-tpl-tag').length;
    if (groups.length !== 3 || modes.some((n) => n < 2) || tags < 30) throw new Error(JSON.stringify({ groups, modes, tags }));
    return [groups.length, modes, document.querySelectorAll('.ed-tpl').length];
  });

  await step('the editor knows its own page (constructor packages)', async () => {
    const html = SS.selfHTML();
    if (!/^<!doctype html>/i.test(html) || html.length < 100000 || !/ed-shell/.test(html)) throw new Error('selfHTML ' + html.length);
    return Math.round(html.length / 1024) + ' KB';
  });

  const open = async (id) => {
    const tpl = tplOf(id);
    const card = await until(() => [...document.querySelectorAll('.ed-tpl')].find((x) => x.textContent.includes((tpl.name.en || '').slice(0, 14)) || x.textContent.includes((tpl.name.ru || '').slice(0, 14))));
    card.click();
    await until(() => E.S.doc && E.S.doc.name && !document.querySelector('.ed-dlg-tpl') && document.querySelectorAll('#ed-canvas [data-bid]').length > 2);
    return E.S.doc;
  };

  await step('template "Holiday apartment" opens with its blocks', async () => {
    const d = await open('apartments');
    const types = new Set();
    const walk = (l) => { for (const b of l || []) { types.add(b.type); walk(b.blocks); for (const c of b.cols || []) walk(c.blocks); } };
    walk(d.regions.main);
    return ['booking', 'map', 'contract'].filter((t) => types.has(t));
  });

  await step('export packages: offline, serverless, backend, backend + constructor', async () => {
    E.openExport();
    const names = await until(() => { const x = [...document.querySelectorAll('.ed-dialog [role=radio]')].map((e) => e.textContent); return x.length >= 4 && x; });
    document.querySelector('.ed-dialog .ed-dlg-close, .ed-dialog [data-close], .ed-dialog button[aria-label]')?.click();
    await sleep(200);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    return names.length;
  });

  await step('Site → Map, SEO and README render', async () => {
    const box = document.createElement('div');
    document.body.append(box);
    SS.dsMap(box);
    const map = box.querySelectorAll('.ss-map-pic svg').length;
    SS.dsSeo(box);
    SS.dsReadme(box);
    await sleep(100);
    const readme = box.querySelector('.ss-rd-src').value;
    const prev = box.querySelectorAll('.ss-rd-prev h1, .ss-rd-prev table').length;
    box.remove();
    if (!map || !/## Pages/.test(readme) || prev < 2) throw new Error(JSON.stringify({ map, prev }));
    return [map, readme.split('\n')[0], prev];
  });

  let frame = null;
  const fdoc = () => frame.contentDocument;
  const $ = (s) => fdoc().querySelector(s);
  const $$ = (s) => [...fdoc().querySelectorAll(s)];
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const show = async (doc) => {
    const r = await E.V.exportHTML(doc, { mode: 'clean' });
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.style.cssText = `position:fixed;inset:0;width:${width}px;height:${window.innerHeight}px;border:0;z-index:99999;background:#fff`;
    document.body.append(frame);
    frame.srcdoc = r.html;
    await until(() => fdoc() && fdoc().documentElement.classList.contains('lp-js'));
    const en = $('button[data-set-lang="en"]');
    if (en) en.click();
    await sleep(150);
    return r;
  };
  const go = async (hash) => { frame.contentWindow.location.hash = hash; await sleep(400); };
  const build = (id) => E.V.normalizeDoc(tplOf(id).build(E.V));

  await step('apartment: calendar, dates, nights and total', async () => {
    await show(build('apartments'));
    await go('#/book');
    const days = await until(() => $$('.ss-bk-d:not(:disabled)').length > 10 && $$('.ss-bk-d:not(:disabled)'));
    days[3].click();
    await sleep(100);
    const after = $$('.ss-bk-d:not(:disabled)');
    const i = after.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
    after[i + 3].click();
    await sleep(100);
    const text = $('[data-ss-bk-text]').textContent;
    const nights = $('[data-ss-bk-n]').value;
    if (!/\d/.test(nights) || !$('[data-ss-bk-sum]').value) throw new Error(text);
    return [nights, text.slice(0, 60)];
  });

  await step('apartment: the booking request goes to the local endpoint', async () => {
    const f = $('.ss-bk form');
    type(f.querySelector('[name=name]'), 'Test Guest');
    type(f.querySelector('[name=email]'), 'guest@example.org');
    f.querySelector('button[type=submit]').click();
    const stored = await until(() => Object.keys(frame.contentWindow.localStorage).find((k) => /:bookings$/.test(k)));
    const rec = JSON.parse(frame.contentWindow.localStorage.getItem(stored));
    const one = Object.values(rec)[0].data;
    return [one.fields.checkin, one.fields.nights, one.fields.name];
  });

  await step('shop: add to cart and check out', async () => {
    await show(build('shop-lite'));
    const adds = await until(() => $$('[data-lp-add]').length > 2 && $$('[data-lp-add]'));
    adds[0].click();
    adds[3].click();
    const ls = frame.contentWindow.localStorage;
    const cartKey = await until(() => Object.keys(ls).find((k) => /^lp-cart:/.test(k) && JSON.parse(ls.getItem(k)).items.length === 2));
    // The inline cart of the page: "Check out", the order form, the order sent to local:orders.
    const goBtn = await until(() => $$('[data-lp-checkout-go]').find((b) => b.getClientRects().length));
    goBtn.click();
    const form = await until(() => $$('form[data-lp-checkout]').find((f) => f.getClientRects().length));
    for (const el of form.querySelectorAll('input,textarea,select')) {
      if (el.type === 'hidden' || el.type === 'submit' || el.disabled) continue;
      if (el.type === 'checkbox') { el.checked = true; continue; }
      if (el.tagName === 'SELECT') { if (el.options.length > 1) el.selectedIndex = 1; continue; }
      el.value = el.type === 'email' ? 'buyer@example.org' : el.type === 'tel' ? '+995555123456' : 'Test buyer';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    form.querySelector('button[type=submit], [type=submit]').click();
    const ordKey = await until(() => Object.keys(ls).find((k) => /:orders$/.test(k)));
    const order = Object.values(JSON.parse(ls.getItem(ordKey)))[0].data;
    return [JSON.parse(ls.getItem(cartKey)).items.length, (order.items || []).length, !!order.orderId];
  });

  await step('event: countdown, RSVP stored locally, .ics link', async () => {
    await show(build('event'));
    const cd = await until(() => $('[data-lp-cd]'));
    await go('#/rsvp');
    const ics = $('a[download="event.ics"]');
    const f = $('.ss-ev form');
    type(f.querySelector('[name=name]'), 'Ana');
    type(f.querySelector('[name=email]'), 'ana@example.org');
    const sel = f.querySelector('select[name=answer]');
    sel.selectedIndex = 1;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    f.querySelector('button[type=submit]').click();
    const key = await until(() => Object.keys(frame.contentWindow.localStorage).find((k) => /:rsvp$/.test(k)));
    return [!!cd, !!ics && /^data:text\/calendar/.test(ics.href), !!key];
  });

  await step('fund: data table sorts and filters', async () => {
    await show(build('fund'));
    await go('#/report');
    const q = await until(() => $('[data-ss-dt-q]'));
    const col = $$('[data-ss-dt-col]')[3];
    col.click();
    await sleep(100);
    const first = $('.ss-dt-tb tbody tr td:nth-child(4)').textContent;
    type(q, 'Omalo');
    await sleep(100);
    const shown = $$('.ss-dt-tb tbody tr').filter((r) => !r.hidden).length;
    return [first, shown, $('[data-ss-dt-count]').textContent];
  });

  // Knowledge bases in the main editor: wiki blocks, layers, versions, contents, a 451 section.
  const kbDoc = () => {
    const d = build('kb-wiki');
    let pw = '';
    E.V.walkBlocks(d, (b) => { if (b.type === 'wk-secret' && !pw) pw = b.password; });
    return [d, pw];
  };
  let kbPw = '';
  await step('knowledge base: the encyclopedia template is a site of wiki blocks', async () => {
    const [d, pw] = kbDoc();
    kbPw = pw;
    const r = await show(d);
    // A sentence of the 451 section must not be in the page.
    let probe = '';
    E.V.walkBlocks(d, (b) => { if (b.type === 'wk-secret') E.V.walkBlocks({ regions: { main: b.blocks } }, (x) => { if (!probe && typeof x.text === 'string' && x.text.length > 60) probe = x.text.replace(/[[]{}|'*]/g, ' ').split(/s+/).slice(2, 7).join(' '); }); });
    if (probe && r.html.replace(/<[^>]+>/g, ' ').replace(/s+/g, ' ').includes(probe)) throw new Error('secret in clear: ' + probe);
    return [d.regions.main.length, $$('.wk').length, r.report.features.includes('wiki'), !!pw];
  });

  await step('knowledge base: an article with infobox, contents and references', async () => {
    await go('#/solar-system/planet/mars');
    const page = await until(() => $$('main[data-lp-page]').find((m) => !m.hidden && m.querySelector('.kp-infobox')));
    const toc = page.querySelectorAll('.kp-toc li').length;
    const refs = page.querySelectorAll('.kp-refs li').length;
    return [!!page.querySelector('.kp-infobox img'), toc, refs];
  });

  await step('knowledge base: layers switch inline text on and off', async () => {
    const btn = await until(() => $$('main[data-lp-page]:not([hidden]) [data-wk-layer]')[0]);
    const id = btn.getAttribute('data-wk-layer');
    const before = btn.getAttribute('aria-pressed');
    btn.click();
    await sleep(100);
    const el = $(`main[data-lp-page]:not([hidden]) [data-layer="${id}"]`);
    const shown = el ? getComputedStyle(el).display !== 'none' : null;
    btn.click();
    return [id, before, btn.getAttribute('aria-pressed'), shown];
  });

  await step('knowledge base: versions of a page', async () => {
    const pages = $$('main[data-lp-page]');
    const host = pages.find((m) => m.querySelector('[data-wk-vers] [data-wk-v]'));
    if (!host) return 'no versions in this base';
    await go('#/' + (host.getAttribute('data-lp-page') || ''));
    const w = host.querySelector('[data-wk-vers]');
    const b = w.querySelectorAll('[data-wk-v]')[1];
    b.click();
    await sleep(100);
    const shown = [...w.querySelectorAll(':scope > [data-wk-ver]')].map((s) => !s.hidden);
    return shown;
  });

  await step('knowledge base: a 451 section opens with its password only', async () => {
    const sec = await until(() => $('[data-wk-seal]'));
    const pg = sec.closest('main[data-lp-page]');
    if (pg && pg.hidden) await go('#/' + (pg.getAttribute('data-lp-page') || ''));
    const f = sec.querySelector('form');
    f.querySelector('input').value = 'wrong password';
    f.querySelector('button').click();
    await until(() => f.querySelector('.wk-451-msg').textContent.length > 1 && !/…/.test(f.querySelector('.wk-451-msg').textContent), 30000);
    const wrong = sec.classList.contains('wk-open');
    f.querySelector('input').value = kbPw;
    f.querySelector('button').click();
    await until(() => sec.classList.contains('wk-open'), 30000);
    return [wrong, sec.querySelector('[data-wk-seal-out]').textContent.trim().slice(0, 40)];
  });

  await step('portal in one file: closed sections show a note, not their content', async () => {
    const d = build('region');
    const before = SS.closedPages(d).length;
    const r = await show(E.V.normalizeDoc(SS.publicView(d, { signin: false })));
    if (/Moderators check requests every morning/.test(r.html)) throw new Error('closed content leaked');
    await go('#/editors');
    return [before, !!fdoc().querySelector('main:not([hidden]) .lp-b-text, main:not([hidden]) .lp-b-section')];
  });

  if (frame) frame.remove();
  return R;
}
