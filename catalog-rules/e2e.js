// catalog-rules/e2e.js - in-page scenario of the schema page (node check.js e2e catalog-rules/index.html
// catalog-rules/e2e.js): the Batumi demo loads, an overridden field shows its origin, a required field error appears
// in the live form and goes away, and the rules page (in a frame, same project) gives a sample the expected title with
// the winning rule marked in the tracer.
//
// How it runs: check.js imports this module in Node, serialises the default export with toString() and evaluates
// it in the page, so the function is self-contained (browser globals only). The second page is tested inside an
// iframe of the same origin: it proves the cross-page contract (one project in localStorage) end to end, which two
// separate runs could not. Expected titles and tokens are the demo's own `expect` values.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const until = async (fn, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { const v = fn(); if (v) return v; await sleep(50); } return null; };

  // Load the real-estate demo (confirm dialog).
  document.querySelector('#cr-demo').value = 'realty';
  document.querySelector('#cr-demo-load').click();
  const ok = await until(() => document.querySelector('.ed-dialog .ed-primary'));
  ok.click();
  await sleep(300);
  step('demo loaded', document.querySelectorAll('.cr-tnode').length === 6, document.querySelectorAll('.cr-tnode').length);

  // Overridden field: "area" of Apartments comes from Real estate, overridden at Apartments.
  document.querySelector('.cr-tnode[data-id="apartments"]').click();
  await sleep(200);
  const area = document.querySelector('.cr-rfield[data-key="area"]');
  const origin = area?.querySelector('.cr-origin')?.textContent || '';
  step('overridden field shows its origin', !!area && area.classList.contains('cr-ovr') && /Real estate|Недвижимость|უძრავი/.test(origin) && area.querySelectorAll('.cr-trail li').length === 2, origin);
  document.querySelector('.cr-tnode[data-id="newbuild"]').click();
  await sleep(200);
  step('address hidden in new builds', !document.querySelector('.cr-rfield[data-key="address"]') && /address/.test(document.querySelector('.cr-resolved').textContent), '');

  // Required field: "complex" is empty in the live form of New builds.
  const err = document.querySelector('.cr-ferr[data-key="complex"]');
  step('required error appears', !!err && err.textContent.length > 0, err?.textContent);
  const input = document.querySelector('.cr-ffield[data-key="complex"] input');
  input.value = 'Orbi City'; input.dispatchEvent(new Event('input'));
  await sleep(100);
  step('required error goes away', err.textContent === '', err.textContent);
  // showIf: bedrooms appear only for the apartments layout.
  const layout = document.querySelector('.cr-ffield[data-key="layout"] select');
  const bed = document.querySelector('.cr-ffield[data-key="bedrooms"]');
  const before = bed.hidden;
  layout.value = 'apartments'; layout.dispatchEvent(new Event('change'));
  await sleep(100);
  step('showIf reveals a field', before === true && bed.hidden === false, [before, bed.hidden]);
  // Unit conversion: 1000 sq ft into m².
  const areaIn = document.querySelector('.cr-ffield[data-key="area"] input');
  const unitSel = document.querySelector('.cr-ffield[data-key="area"] select');
  areaIn.value = '1000'; areaIn.dispatchEvent(new Event('input'));
  unitSel.value = 'sqft'; unitSel.dispatchEvent(new Event('change'));
  await sleep(100);
  step('unit converted on input', /"area": 92\.9/.test(document.querySelector('.cr-stored').textContent), document.querySelector('.cr-stored').textContent.match(/"area": [\d.]+/)?.[0]);
  document.querySelector('.cr-form .ap-actions .ed-btn').click(); // clear the form
  // 500 ms > the 250 ms debounce of the project write: the frame must read the saved project, not an older one.
  await sleep(500); // the project is written to localStorage (debounced)

  // Rules page in a frame: sample s1 gets the expected title and the tracer marks rule 5.
  const href = document.getElementById('pg-rules').getAttribute('href');
  const frame = document.createElement('iframe');
  // Off-screen but laid out at desktop size (1400 px), so the rules page uses its two-column layout.
  frame.style.cssText = 'width:1400px;height:900px;position:fixed;left:-2000px;top:0';
  frame.src = href;
  document.body.append(frame);
  // contentDocument throws for a cross-origin frame; caught so the step reports "no access" instead of crashing.
  const doc = await until(() => { try { const d = frame.contentDocument; return d && d.querySelector('.cr-srow[data-id="s1"] .cr-stitle')?.textContent ? d : null; } catch { return null; } }, 8000);
  if (!doc) { step('rules page opens', false, 'no access'); return { steps }; }
  const title = doc.querySelector('.cr-srow[data-id="s1"] .cr-stitle');
  step('sample gets the expected title', title.textContent === '2-ოთახიანი ბინა Orbi City-ში · 54 მ²' && title.classList.contains('cr-good'), title.textContent);
  doc.querySelector('.cr-srow[data-id="s1"] .cr-link').click();
  await sleep(150);
  const won = doc.querySelectorAll('#cr-tracer .cr-won');
  step('tracer marks the winning rule', won.length === 1 && won[0].dataset.index === '4', [...won].map((x) => x.dataset.index));
  const earlier = [...doc.querySelectorAll('#cr-tracer .cr-tr-rule')].slice(0, 4).map((x) => x.dataset.state);
  step('earlier rules did not match', earlier.every((s) => s === 'nomatch'), earlier);
  step('tag tokens', doc.getElementById('cr-tokens')?.textContent === 't1 t1.dist~0 t2 t2.name.metro_city', doc.getElementById('cr-tokens')?.textContent);
  const summary = doc.getElementById('cr-ssum').textContent;
  step('all expected titles match', /7\D+7/.test(summary), summary);
  // Fallback sample.
  doc.querySelector('.cr-srow[data-id="s5"] .cr-link').click();
  await sleep(150);
  step('fallback marked', doc.querySelector('#cr-tracer .cr-won')?.dataset.index === 'fallback', doc.querySelector('#cr-tracer .cr-won')?.dataset.index);
  frame.remove();
  return { steps };
}
