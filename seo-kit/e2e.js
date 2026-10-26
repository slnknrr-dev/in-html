// seo-kit/e2e.js - in-page scenario of the site page (node check.js e2e seo-kit/html@5_offline_singlefile/index.html
// seo-kit/e2e.js): the demo sitemap carries hreflang alternates, the robots tester answers, and the card and checker
// pages (loaded in an iframe from the hidden page anchors) render the OG SVG and find a missing og:image.
//
// Contract with check.js: the default export runs inside the built page and returns { steps: [[name, 'ok'|'FAIL', value]] };
// a step never throws on a failed expectation, so one run reports every broken behaviour at once (the value column
// carries evidence for the report). Selectors use data-* hooks and ids, never visible text: the scenario must pass in
// any UI language. Fixed sleeps instead of waiting on events: the app exposes no "rendered" signal, and the delays
// (80..600ms) cover the 60..250ms debounces of the pages with margin.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const tab = async (k) => { document.querySelector(`.sk-tab[data-tab="${k}"]`).click(); await sleep(250); };
  const pane = (name) => document.querySelector(`.sk-file[data-file="${name}"] pre`)?.textContent || '';

  await tab('sitemap');
  const map = pane('sitemap.xml');
  step('sitemap has hreflang ru', map.includes('hreflang="ru" href="https://teahouse.example/ru/"'), map.length);
  step('sitemap has x-default', map.includes('hreflang="x-default"'), (map.match(/<url>/g) || []).length);
  step('noindex page left out', !map.includes('/drafts/'), '');

  await tab('robots');
  // Setting .value does not fire events; dispatching 'input' runs the same handler a keystroke would.
  const set = async (id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input')); await sleep(80); };
  const verdict = () => document.getElementById('sk-verdict');
  await set('sk-test-agent', 'Googlebot'); await set('sk-test-path', '/admin/login');
  step('robots blocks /admin/', verdict().dataset.state === 'blocked', verdict().textContent);
  await set('sk-test-path', '/menu/');
  step('robots allows /menu/', verdict().dataset.state === 'allowed', verdict().textContent);
  await set('sk-test-agent', 'GPTBot');
  step('robots blocks GPTBot', verdict().dataset.state === 'blocked', verdict().textContent);

  await tab('jsonld');
  step('json-ld built', pane('jsonld/website.html').includes('"@type": "WebSite"'), '');
  await tab('meta');
  step('meta tags built', pane('head.html').includes('og:title'), '');
  await tab('sitemap');

  // Sibling pages load in an off-screen iframe at desktop size (1200x900, so the two-column layout is used). The src comes
  // from the hidden page anchors, so the test follows the build's renamed files. Same origin: contentDocument is readable.
  const frame = async (id) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'width:1200px;height:900px;position:fixed;left:-3000px';
    f.src = document.getElementById(id).getAttribute('href');
    document.body.append(f);
    await new Promise((r) => f.addEventListener('load', r, { once: true }));
    await sleep(600);
    return f;
  };
  // The card page reads the saved card; on a fresh profile that is DEMO_CARD, whose title mentions Guria.
  const og = await frame('pg-og');
  const svg = og.contentDocument.querySelector('#sk-card svg');
  step('og svg renders', !!svg && svg.getAttribute('viewBox') === '0 0 1200 630' && svg.textContent.includes('Guria'), svg && svg.textContent.slice(0, 60));
  og.remove();

  // The checker's example page deliberately lacks og:image and carries a BlogPosting JSON-LD node.
  const ck = await frame('pg-check');
  ck.contentDocument.querySelector('[data-act="example"]').click();
  await sleep(300);
  const miss = ck.contentDocument.querySelector('#sk-c-issues [data-field="image"][data-issue="missing"]');
  step('checker finds missing og:image', !!miss, miss && miss.textContent);
  step('checker reads JSON-LD', !!ck.contentDocument.querySelector('.sk-ld-node[data-type="BlogPosting"]'), '');
  ck.remove();
  return { steps };
}
