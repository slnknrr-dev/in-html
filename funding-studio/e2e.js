// funding-studio/e2e.js - in-page end-to-end scenario of the editor (a fresh browser profile), run by check.js:
//   node funding-studio/server.js 8471
//   node check.js e2e http://127.0.0.1:8471/funding-studio/index.html funding-studio/e2e.js
//   node check.js e2e http://127.0.0.1:8471/funding-studio/index.html funding-studio/e2e.js --size 390x844 --mobile
// (node funding-studio/e2e-run.js does all of it.) Picks the charity template in the gallery, fills the Payments tab
// (Stripe test-mode Payment Link, PayPal.Me, bank transfer IBAN, Bitcoin and Ethereum addresses) through its inputs,
// exports the single HTML file through the export dialog (the download is captured), checks the file (links,
// addresses, no secrets) and renders it at the window's width: donate panel, Stripe link, bank QR, no horizontal
// scrolling. Returns { steps }; serialized, so no imports.
export default async function scenario() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = await f(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 140));
      await sleep(60);
    }
  };
  const R = { steps: [] };
  const step = async (name, fn) => {
    try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 600)]); }
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // Helpers: until() polls an async predicate (exceptions count as "not yet") with a timeout that reports the predicate
  // source, so a hang names what was awaited; typeInto fires input and change, because the editor commits on input
  // (live) and some controls only on change.
  const typeInto = (el, value) => { el.focus(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); };
  // The input of a field in a Payments section, found by its label text.
  const fieldIn = (sec, labelKey) => {
    const box = $(`[data-sec="${sec}"]`);
    if (!box) throw new Error('no section ' + sec);
    box.open = true;
    const want = window.__ed.t(labelKey);
    const f = $$('.ed-field', box).find((x) => (x.querySelector('label, .ed-label')?.textContent || '').trim().startsWith(want));
    const inp = f && f.querySelector('input, textarea, select');
    if (!inp) throw new Error('no field ' + labelKey + ' in ' + sec);
    return inp;
  };

  const STRIPE = 'https://buy.stripe.com/test_e2eDonate00';
  const IBAN = 'DE89370400440532013000';
  const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const ETH = '0x52908400098527886E0F7030069857D2E4169EE7';
  let html = '';

  await step('editor boots and offers the templates', async () => {
    await until(() => window.__edReady);
    const cards = await until(() => { const c = $$('.ed-dlg-tpl .ed-tpl'); return c.length >= 6 ? c : null; });
    return { width: innerWidth, narrow: !!window.__ed.S.narrow, templates: cards.length, first: $('strong', cards[0]).textContent };
  });

  await step('charity template makes a project with campaigns and a thank-you page', async () => {
    $('.ed-dlg-tpl .ed-tpl').click();
    await until(() => !$('.ed-dlg-tpl') && window.__ed.S.doc.regions.main.length >= 3);
    const pages = window.__ed.S.doc.regions.main;
    return { pages: pages.map((p) => p.kind + ':' + p.slug), name: window.__ed.S.doc.name, methods: pages[0].methods };
  });

  await step('Payments tab: public details through the inputs', async () => {
    if (window.__ed.S.noRight) $('#ed-tog-right').click();
    await until(() => $('#ed-rtabs-document'));
    $('#ed-rtabs-document').click();
    await until(() => $('#ed-dtab-payments'));
    $('#ed-dtab-payments').click();
    await until(() => $('[data-sec="py-stripe"]'));
    typeInto(fieldIn('py-stripe', 'py.stripeAny'), STRIPE);
    const mode = fieldIn('py-paypal', 'py.ppMode');
    mode.value = 'me'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => { try { return fieldIn('py-paypal', 'py.ppMe'); } catch { return null; } });
    typeInto(fieldIn('py-paypal', 'py.ppMe'), 'paypal.me/LanternTableE2E');
    typeInto(fieldIn('py-bank', 'py.holder'), 'Lantern Table e.V.');
    typeInto(fieldIn('py-bank', 'py.iban'), IBAN);
    typeInto(fieldIn('py-btc', 'py.btcAddress'), BTC);
    typeInto(fieldIn('py-eth', 'py.ethAddress'), ETH);
    await sleep(300);
    const pay = window.__ed.S.doc.pay;
    if (pay.stripe.any !== STRIPE) throw new Error('stripe link not stored: ' + JSON.stringify(pay.stripe));
    if (pay.bank.iban.replace(/\s/g, '') !== IBAN) throw new Error('iban not stored: ' + pay.bank.iban);
    const ready = $$('.ed-fd-sum.ed-on strong').map((x) => x.textContent);
    const warnings = $$('[data-sec^="py-"] .ed-hint-warn:not([hidden]), [data-sec^="py-"] .ed-field-err').map((x) => x.textContent).filter(Boolean);
    if (warnings.length) throw new Error('field warnings: ' + warnings.join(' | '));
    return { stripe: pay.stripe.any, paypal: pay.paypal.me, iban: pay.bank.iban, btc: pay.btc.address, eth: pay.eth.address, ready, warnings };
  });

  await step('export dialog downloads the single HTML file', async () => {
    const caught = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { if (b instanceof Blob) caught.push(b); return orig.call(URL, b); };
    try {
      window.__ed.openExport();
      const dlg = await until(() => $('.ed-dlg-export'));
      const html1 = $$('.ed-target-cards button', dlg).find((b) => b.getAttribute('aria-checked') === 'true' || b.classList.contains('ed-on'));
      const first = $$('.ed-target-cards button', dlg)[0];
      if (first && first !== html1) first.click();
      await sleep(200);
      $('.ed-dlg-foot .ed-primary', dlg).click();
      const blob = await until(() => caught.find((b) => /html/.test(b.type)), 20000);
      html = await blob.text();
      if ($('.ed-dlg-export')) { const c = $$('.ed-dlg-foot .ed-btn', $('.ed-dlg-export'))[0]; if (c) c.click(); }
      return { bytes: html.length, checkDialog: false };
    } finally { URL.createObjectURL = orig; }
  });

  await step('the file carries the public details and no secrets', async () => {
    const has = (s) => html.includes(s);
    const out = { stripe: has(STRIPE), paypalMe: has('LanternTableE2E'), iban: has(IBAN) || has('DE89 3704 0044 0532 0130 00'), btc: has(BTC), eth: has(ETH) };
    const secrets = (html.match(/\b(sk|rk)_(test|live)_[A-Za-z0-9]{6,}|whsec_[A-Za-z0-9]{6,}/g) || []);
    if (!out.stripe || !out.paypalMe || !out.iban || !out.btc || !out.eth) throw new Error('missing: ' + JSON.stringify(out));
    if (secrets.length) throw new Error('secret-looking strings: ' + secrets.join(', '));
    const external = [...new Set((html.match(/<script[^>]+src=["'][^"']+/g) || []))];
    if (external.length) throw new Error('external scripts: ' + external.join(', '));
    return out;
  });

  await step('the exported page renders the donate panel at this width', async () => {
    const fr = document.createElement('iframe');
    fr.style.cssText = `position:fixed;left:0;top:0;width:${innerWidth}px;height:${innerHeight}px;border:0;z-index:99999;background:#fff`;
    document.body.append(fr);
    try {
      fr.srcdoc = html;
      const d = await until(() => { const x = fr.contentDocument; return x && x.readyState === 'complete' && x.querySelector('.fd-don') ? x : null; });
      await sleep(400);
      const donate = d.querySelector('.fd-don');
      donate.scrollIntoView();
      const links = [...d.querySelectorAll('a[href]')].map((a) => a.href);
      const methodBtns = [...donate.querySelectorAll('button, [role=tab]')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 12);
      const overflow = d.documentElement.scrollWidth - d.documentElement.clientWidth;
      if (overflow > 1) throw new Error('horizontal overflow ' + overflow + 'px');
      return { title: d.title, stripeLink: links.some((u) => u.startsWith(STRIPE)), methodBtns, qr: d.querySelectorAll('svg.fd-qr, .fd-qr svg, canvas').length, width: d.documentElement.clientWidth };
    } finally { fr.remove(); }
  });

  return R;
}
