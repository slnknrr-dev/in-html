// site-studio/wiki-e2e-portal.js - in-page end-to-end scenario of the portal blocks in the knowledge editor, run by
// check.js on desktop and phone widths:
//   node check.js e2e site-studio/html@5_offline_singlefile/wiki.html site-studio/wiki-e2e-portal.js
//   node check.js e2e site-studio/html@5_offline_singlefile/wiki.html site-studio/wiki-e2e-portal.js --size 390x844 --mobile
// Creates a base from the "Legal knowledge base" template, checks the block form of a portal block (shared labels,
// date fields), the live preview, then publishes the base as one HTML file and runs it in a frame of the window's
// width: act search, contents scroll-spy, term tooltip, links in an ordinary text page, glossary, directory filters,
// requests board, checklist ticks kept in storage, the search page with type tabs, layouts at the width.
// Same harness as wiki-e2e.js (step / until). Run twice, at desktop and at phone width (--size 390x844 --mobile), because
// portal layouts (directory facets, act contents) switch at breakpoints. The published one-file export is opened in
// a frame of the window's width, so the reader is tested as a visitor gets it, not as the editor preview.
export default async function scenario() {
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
  await until(() => window.__kpReady && window.__kp.S.kb, 30000);
  const K = window.__kp;
  const width = /Mobi|Android/.test(navigator.userAgent) ? Math.min(390, window.innerWidth) : window.innerWidth;

  await step('base from the "Legal knowledge base" template', async () => {
    await K.newFromTemplate(K.TEMPLATES.find((x) => x.id === 'portal'));
    await until(() => K.S.kb && K.S.kb.title === 'Kanoni Commons');
    return [K.S.kb.pages.length, K.S.kb.pages.map((p) => p.slug).slice(0, 4)];
  });

  await step('block form of a portal block', async () => {
    const page = K.S.kb.pages.find((p) => p.slug === 'requests');
    const b = page.versions[0].blocks[0];
    await K.select({ pageId: page.id, blockId: b.id });
    const form = await until(() => document.querySelector('.kp-bf'));
    const labels = [...form.querySelectorAll('.ed-label')].map((x) => x.textContent.trim()).filter(Boolean);
    const dates = form.querySelectorAll('input[type="date"]').length;
    return [labels.slice(0, 3), labels.length, dates];
  });

  await step('preview renders the act', async () => {
    const page = K.S.kb.pages.find((p) => p.slug === 'tax-code');
    await K.select({ pageId: page.id });
    const f = await until(() => { const fr = document.querySelector('.kp-pv-frame'); return fr && fr.contentDocument && fr.contentDocument.querySelector('.kp-pt-act') && fr; }, 15000);
    return [f.contentDocument.querySelectorAll('.kp-pt-art').length, !!f.contentDocument.querySelector('[data-pt-js]')];
  });

  let frame = null;
  const fdoc = () => frame.contentDocument;
  const $ = (s) => fdoc().querySelector(s);
  const $$ = (s) => [...fdoc().querySelectorAll(s)];
  const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const go = async (route, sel) => { frame.contentWindow.location.hash = '#/' + route; await until(() => fdoc().querySelector(sel), 8000); await sleep(150); };

  await step('publish as one file and open it', async () => {
    const r = await K.buildExport('single');
    const html = typeof r.data === 'string' ? r.data : await new Response(r.data).text();
    frame = document.createElement('iframe');
    frame.style.cssText = `position:fixed;inset:0;width:${width}px;height:${window.innerHeight}px;border:0;z-index:99999;background:#fff`;
    document.body.append(frame);
    frame.srcdoc = html;
    await until(() => fdoc() && fdoc().querySelector('#kp-main [data-pt-js]'), 20000);
    return [width, html.length > 10000, !/__P__/.test(html)];
  });

  await step('act: search, contents, cross-references, tooltip', async () => {
    await go('tax-code', '.kp-pt-act');
    const q = $('.kp-pt-act [data-pt-q]');
    type(q, 'online');
    await sleep(300);
    const shown = $$('.kp-pt-act [data-pt-i]').filter(visible).map((x) => x.id);
    type(q, '');
    await sleep(200);
    const target = $('#tax-a3');
    const cur = await until(() => { target.scrollIntoView({ behavior: 'instant' }); const a = $('.kp-pt-toc a[aria-current]'); return a && /tax-a3$/.test(a.getAttribute('href')) && a; }, 5000).catch(() => $('.kp-pt-toc a[aria-current]'));
    if (!cur || !/tax-a3$/.test(cur.getAttribute('href'))) throw new Error('current: ' + (cur && cur.getAttribute('href')));
    const det = $('.kp-pt-tocd');
    if (width < 600 && det.open) throw new Error('phone: contents not folded');
    const x = $('#tax-a4 .kp-pt-xref');
    const tip = $('#tax-a4 a[data-pt-tip]');
    tip.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await sleep(100);
    const pop = $('[data-pt-pop]');
    const text = pop && !pop.hidden ? pop.textContent.slice(0, 30) : '';
    tip.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    if (!text) throw new Error('no tooltip');
    return [shown, cur.getAttribute('href'), det.open, x.getAttribute('href'), text];
  });

  await step('ordinary page: terms and article references linked', async () => {
    await go('how-small-business-taxation-works', '.kp-text');
    return [$$('.kp-text .kp-pt-xref').map((a) => a.textContent), $$('.kp-text a[data-pt-tip]').length];
  });

  await step('glossary: search and alphabet', async () => {
    await go('glossary', '.kp-pt-terms');
    const q = $('.kp-pt-terms [data-pt-q]');
    type(q, 'penal');
    await sleep(300);
    const n = $$('.kp-pt-terms [data-pt-i]').filter(visible).length;
    type(q, '');
    return [n, $$('.kp-pt-az a[data-pt-azl]').length];
  });

  await step('directory: tabs, facets, layout', async () => {
    await go('specialists', '.kp-pt-dir');
    const root = $('.kp-pt-dir');
    const vis = () => [...root.querySelectorAll('[data-pt-i]')].filter(visible).length;
    root.querySelector('[data-pt-tab="kind:org"]').click();
    await sleep(100);
    const orgs = vis();
    root.querySelector('[data-pt-tab=""]').click();
    const city = root.querySelector('select[data-pt-facet="city"]');
    city.value = 'batumi';
    city.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    const batumi = vis();
    const card = [...root.querySelectorAll('[data-pt-i]')].find(visible).getBoundingClientRect();
    if (width < 600 && card.width < root.getBoundingClientRect().width * 0.9) throw new Error('phone: cards not in one column');
    return [orgs, batumi, Math.round(card.width), Math.round(root.getBoundingClientRect().width)];
  });

  await step('requests: dates and matching specialists', async () => {
    await go('requests', '.kp-pt-board');
    return [$$('.kp-pt-board time[data-pt-rel]').map((x) => x.textContent).slice(0, 2), $$('.kp-pt-board .kp-pt-match a').length];
  });

  await step('checklist: ticks kept, hub of the topic', async () => {
    await go('compliance', '.kp-pt-ck');
    const box = $('.kp-pt-ck input[data-pt-ck]');
    box.click();
    await sleep(100);
    const text = $('.kp-pt-ck [data-pt-progt]').textContent;
    const stored = Object.keys(frame.contentWindow.localStorage).filter((k) => /^pt-ck:/.test(k)).length;
    box.click();
    const groups = $$('.kp-pt-hub .kp-pt-hs').length;
    return [text, stored, groups, !!$('.kp-pt-hs-page')];
  });

  await step('search page with type tabs', async () => {
    await go('', '.kp-pt-find');
    const input = $('.kp-pt-find input[name="q"]');
    input.value = 'turnover';
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => fdoc().querySelector('.kp-pt-ftabs'), 8000);
    const tabs = $$('.kp-pt-ftabs a').map((a) => a.textContent.replace(/\s+/g, ' ').trim());
    const term = $$('.kp-pt-ftabs a').find((a) => /Terms/.test(a.textContent));
    term.click();
    await until(() => /type=term/.test(fdoc().location.hash) || /type=term/.test(frame.contentWindow.location.href), 5000);
    await sleep(300);
    return [tabs, $$('.kp-pt-fres li').map((li) => li.getAttribute('data-pt-type')).filter((x, i, a) => a.indexOf(x) === i)];
  });

  frame.remove();
  return R;
}
