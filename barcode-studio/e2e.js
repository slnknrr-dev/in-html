// barcode-studio/e2e.js - in-page scenario of the create page (node check.js e2e barcode-studio/index.html
// barcode-studio/e2e.js): every type renders its example and reads back, check digits are completed, errors are
// shown, the GS1 builder reads a pasted element string and the batch page builds its preview.
//
// How it runs: check.js imports this module in Node, serialises the default export with toString() and evaluates it
// in the page, so the function is self-contained (browser globals only). The core assertion is the page's own scan
// check: every symbology is rendered and must read back through the decoder ('ok'), except EAN-2/5 add-ons, which
// cannot be decoded alone ('na'). badge() polls the badge state rather than sleeping for the worst case.
// NOTE: the summary above mentions the batch page, but this scenario only drives the create page.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const badge = async () => { for (let i = 0; i < 40; i++) { const s = document.querySelector('.bc-badge')?.dataset.state; if (s && s !== 'checking') return s; await sleep(60); } return 'timeout'; };

  for (const chip of [...document.querySelectorAll('.bc-tchip')]) {
    chip.click();
    await sleep(120);
    const state = await badge();
    const svg = !!document.querySelector('#bc-preview svg');
    const k = chip.dataset.k;
    step('type ' + k, svg && (state === 'ok' || (state === 'na' && /^ean[25]$/.test(k))), state);
  }

  // Check digit completion and a wrong check digit.
  document.querySelector('.bc-tchip[data-k="ean13"]').click();
  await sleep(100);
  const num = document.querySelector('.bc-form input');
  // 12 digits: the page must complete the GTIN check digit (4006381333931 is a valid EAN-13).
  num.value = '400638133393'; num.dispatchEvent(new Event('input'));
  await sleep(250);
  step('completed check digit', document.querySelector('.bc-info').textContent.includes('4006381333931'), document.querySelector('.bc-info .bc-val')?.textContent);
  num.value = '4006381333932'; num.dispatchEvent(new Event('input'));
  await sleep(250);
  step('wrong check digit reported', /\b1\b/.test(document.querySelector('.bc-error').textContent), document.querySelector('.bc-error').textContent);
  num.value = '4006381333931'; num.dispatchEvent(new Event('input'));
  await sleep(200);

  // GS1 builder: paste a raw scan.
  document.querySelector('.bc-tchip[data-k="gs1-128"]').click();
  await sleep(150);
  const paste = [...document.querySelectorAll('.bc-gs1 input')].at(-1);
  // A raw scanner string with the ]C1 symbology identifier and a variable-length AI at the end (10 = batch/lot), the
  // hardest case for the paste parser.
  paste.value = ']C1010950600013435217201225' + '10ABC123';
  paste.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(300);
  const rows = document.querySelectorAll('.bc-gs1-row').length;
  step('gs1 paste rows', rows === 3, rows);
  step('gs1 reads back', (await badge()) === 'ok', document.querySelector('.bc-badge')?.dataset.state);
  step('digital link shown', document.querySelector('.bc-dl code')?.textContent.startsWith('https://id.gs1.org/01/09506000134352/10/ABC123'), document.querySelector('.bc-dl code')?.textContent);

  // Back to EAN-13 so later visits start from the default.
  document.querySelector('.bc-tchip[data-k="ean13"]').click();
  await sleep(100);
  return { steps };
}
