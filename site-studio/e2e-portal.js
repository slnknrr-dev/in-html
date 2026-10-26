// site-studio/e2e-portal.js - in-page end-to-end scenario of the portal blocks in the landing editor, run by
// check.js on desktop and phone widths:
//   node check.js e2e site-studio/html@5_offline_singlefile/index.html site-studio/e2e-portal.js
//   node check.js e2e site-studio/html@5_offline_singlefile/index.html site-studio/e2e-portal.js --size 390x844 --mobile
// Opens the "Legal portal" template, checks the canvas and the inspector of a portal block, exports the site and runs
// it in a frame of the window's width: act search, table of contents scroll-spy, term tooltip, glossary search and
// alphabet, directory tabs / facets / sorting, requests board dates and matching, checklist ticks kept in storage,
// unified search with tabs, copy link, language switch of facet labels, layouts at the width.
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
  // Phone runs (--mobile) show the site at a phone width whatever the editor's own layout viewport is.
  const width = /Mobi|Android/.test(navigator.userAgent) ? Math.min(390, window.innerWidth) : window.innerWidth;
  const types = ['act', 'terms', 'directory', 'board', 'hub', 'checklist', 'finder'];

  await step('template "Legal portal"', async () => {
    const tpl = await until(() => [...document.querySelectorAll('.ed-tpl')].find((x) => /Legal portal|Правовой портал/.test(x.textContent)));
    tpl.click();
    await until(() => document.querySelectorAll('#ed-canvas [data-bid]').length > 3 && !document.querySelector('.ed-dlg-tpl'));
    const found = new Set();
    const walk = (list) => { for (const b of list || []) { found.add(b.type); if (b.blocks) walk(b.blocks); } };
    walk(E.S.doc.regions.main);
    return [E.S.doc.langs.join(','), types.filter((t) => found.has(t)).length];
  });

  await step('canvas: portal blocks render in edit mode', async () => {
    const pts = await until(() => document.querySelectorAll('#ed-canvas .lp-pt').length && document.querySelectorAll('#ed-canvas .lp-pt'));
    return [pts.length, !!document.querySelector('#ed-canvas .lp-pt-find')];
  });

  await step('inspector of a portal block (palette category, fields)', async () => {
    const el = document.querySelector('#ed-canvas .lp-b-finder, #ed-canvas .lp-b-hub');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(200);
    const labels = [...document.querySelectorAll('#ed-right .ed-label')].map((x) => x.textContent.trim()).filter(Boolean);
    return labels.slice(0, 4);
  });

  let frame = null;
  const fdoc = () => frame.contentDocument;
  const $ = (s) => fdoc().querySelector(s);
  const $$ = (s) => [...fdoc().querySelectorAll(s)];
  const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const go = async (hash) => { frame.contentWindow.location.hash = hash; await sleep(500); };

  await step('export and open the site', async () => {
    const r = await E.V.exportHTML(E.fullDoc(), { mode: 'clean' });
    frame = document.createElement('iframe');
    frame.style.cssText = `position:fixed;inset:0;width:${width}px;height:${window.innerHeight}px;border:0;z-index:99999;background:#fff`;
    document.body.append(frame);
    frame.srcdoc = r.html;
    await until(() => fdoc() && fdoc().querySelector('[data-pt-js]'));
    // The scenario reads English texts: switch the site to English (the browser language may differ).
    const en = fdoc().querySelector('button[data-set-lang="en"]');
    if (en) en.click();
    await sleep(200);
    return [fdoc().documentElement.lang,r.report.features.filter((f) => /^pt/.test(f)).join(','), $$('[data-pt-js]').length];
  });

  await step('act: search in the act', async () => {
    await go('#/law');
    const q = $('.lp-pt-act [data-pt-q]');
    type(q, 'online');
    await sleep(300);
    const shown = $$('.lp-pt-act [data-pt-i]').filter(visible).map((x) => x.id);
    const toc = $$('.lp-pt-toc [data-pt-for]').filter((x) => !x.hidden).length;
    const count = $('.lp-pt-act [data-pt-count]').textContent;
    type(q, '');
    await sleep(300);
    return [shown, toc, count];
  });

  await step('act: contents follow the reading position', async () => {
    const target = $('#tax-a3');
    // The router may still settle the page: scroll again until the reading position is stable.
    const cur = await until(() => {
      target.scrollIntoView({ behavior: 'instant' });
      const a = $('.lp-pt-toc a[aria-current]');
      return a && a.getAttribute('href') === '#tax-a3' && a;
    }, 5000).catch(() => $('.lp-pt-toc a[aria-current]'));
    const det = $('.lp-pt-tocd');
    if (!cur || cur.getAttribute('href') !== '#tax-a3') throw new Error('current: ' + (cur && cur.getAttribute('href')) + ' top ' + Math.round(target.getBoundingClientRect().top));
    if (width < 600 && det.open) throw new Error('phone: contents not folded');
    return [cur.getAttribute('href'), det.open, width];
  });

  await step('act: cross-references and term tooltip', async () => {
    const x = $('#tax-a4 .lp-pt-xref');
    const tip = $('#tax-a4 a[data-pt-tip]');
    tip.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await sleep(100);
    const pop = $('[data-pt-pop]');
    const text = pop && !pop.hidden ? pop.textContent.slice(0, 40) : '';
    tip.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    if (!text) throw new Error('no tooltip for ' + tip.getAttribute('data-pt-tip') + ' ' + $$('[data-pt-pop]').length + ' ' + $$('[data-pt-tipd]').length + ' ' + (pop && pop.outerHTML.slice(0, 120)));
    return [x && x.getAttribute('href'), text];
  });

  await step('act: copy link button', async () => {
    const b = $('#tax-a2 [data-pt-copy]');
    return b.getAttribute('data-pt-copy');
  });

  await step('glossary: search and alphabet', async () => {
    await go('#/glossary');
    const q = $('.lp-pt-terms [data-pt-q]');
    type(q, 'penal');
    await sleep(300);
    const shown = $$('.lp-pt-terms [data-pt-i]').filter(visible).length;
    const enabled = $$('.lp-pt-az a[data-pt-azl]:not([aria-disabled])').map((a) => a.textContent);
    type(q, '');
    await sleep(300);
    return [shown, enabled];
  });

  await step('directory: tabs, facets, sorting, paging', async () => {
    await go('#/specialists');
    const root = $('.lp-pt-dir');
    const vis = () => [...root.querySelectorAll('[data-pt-i]')].filter(visible).length;
    const first = vis();
    root.querySelector('[data-pt-tab="kind:firm"]').click();
    await sleep(100);
    const firms = vis();
    root.querySelector('[data-pt-tab=""]').click();
    const city = root.querySelector('select[data-pt-facet="city"]');
    city.value = 'tbilisi';
    city.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    const tbilisi = vis();
    root.querySelector('[data-pt-reset]').click();
    const sort = root.querySelector('[data-pt-sort]');
    sort.value = 'name:a';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    const firstName = [...root.querySelectorAll('[data-pt-i]')].find(visible).querySelector('.lp-pt-cn').textContent.trim();
    const card = root.querySelector('[data-pt-i]').getBoundingClientRect();
    if (width < 600 && card.width < root.getBoundingClientRect().width * 0.9) throw new Error('phone: cards not in one column');
    return [first, firms, tbilisi, firstName.slice(0, 16), Math.round(card.width), Math.round(root.getBoundingClientRect().width)];
  });

  await step('directory: masked phone revealed', async () => {
    const m = $('.lp-pt-dir [data-pt-mask]');
    const before = visible(m.querySelector('a'));
    m.querySelector('[data-pt-reveal]').click();
    return [before, visible(m.querySelector('a'))];
  });

  await step('requests: relative dates and matching specialists', async () => {
    await go('#/requests');
    const rel = $$('.lp-pt-board time[data-pt-rel]').map((x) => x.textContent).slice(0, 3);
    const match = $$('.lp-pt-board .lp-pt-match a').length;
    const st = $('.lp-pt-board select[data-pt-facet="status"]');
    st.value = 'open';
    st.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    return [rel, match, $$('.lp-pt-board [data-pt-i]').filter(visible).length];
  });

  await step('checklist: ticks and progress kept in the browser', async () => {
    await go('#/compliance');
    const box = $('.lp-pt-ck input[data-pt-ck]');
    box.click();
    await sleep(100);
    const text = $('.lp-pt-ck [data-pt-progt]').textContent;
    const stored = Object.keys(frame.contentWindow.localStorage).filter((k) => /^pt-ck:/.test(k));
    box.click();
    return [text, stored.length];
  });

  await step('hub: topic stats and sections', async () => {
    const hub = $('.lp-pt-hub.lp-pt-topic');
    return [$$('.lp-pt-hub.lp-pt-topic .lp-pt-stats > div').length, hub.querySelectorAll('.lp-pt-hs').length];
  });

  await step('unified search: results and type tabs', async () => {
    await go('#/');
    const input = $('[data-pt-fq]');
    type(input, 'turnover');
    await sleep(500);
    const tabs = $$('[data-pt-ftabs] button').map((b) => b.getAttribute('data-pt-ft'));
    const n = $$('[data-pt-fres] li').length;
    $('[data-pt-ftabs] button[data-pt-ft="term"]').click();
    await sleep(100);
    const terms = $$('[data-pt-fres] li').length;
    const mark = !!$('[data-pt-fres] mark');
    return [n, tabs, terms, mark];
  });

  await step('language switch relabels filters', async () => {
    await go('#/specialists');
    const b = $('button[data-set-lang="ka"]');
    b.click();
    await sleep(300);
    const opt = $('.lp-pt-dir select[data-pt-facet="city"] option[value="tbilisi"]');
    const count = $('.lp-pt-dir [data-pt-count]').textContent;
    if (fdoc().documentElement.lang !== 'ka' || !/თბილისი/.test(opt.textContent)) throw new Error('not relabelled: ' + fdoc().documentElement.lang + ' ' + opt.textContent);
    $('button[data-set-lang="en"]').click();
    await sleep(200);
    return [opt.textContent, count];
  });

  frame.remove();
  return R;
}
