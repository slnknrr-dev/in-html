// agreement-constructor/e2e.js - browser scenario through the interface: the built-in lease opens, a document is
// created from it and filled in through the fields pane (party, rent, term), the payment schedule follows the 23rd
// rule, the modifiers (power of attorney, additional services) and the strictness level change the text, the contract
// language switches, edit mode turns a new placeholder into a field, the JS validator reports from its worker, the
// document is kept in IndexedDB, and the template compiles into one HTML file without network code. Desktop and phone:
//   node check.js e2e http://127.0.0.1:8737/agreement-constructor/ agreement-constructor/e2e.js [--mobile --size 390x844]
//   node check.js e2e agreement-constructor/html@5_offline_singlefile/index.html agreement-constructor/e2e.js
// The scenario is serialized into the page (Function.prototype.toString): only browser globals.
//
// Observables: the rendered sheet text, the fields pane (data-k / data-field hooks) and the app state through the
// window.__ac hook. Downloads are intercepted by patching HTMLAnchorElement.prototype.click for blob: links, so the
// compiled HTML and the JSON export can be read back and inspected instead of being saved to disk; the original
// method is restored at the end. The checks are business rules, not markup: the 23rd-to-22nd billing periods, rent
// in words, the deposit under the strict level, the registration rule from the template's own validator.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(60); } return null; };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const downloads = [];
  const origClick = HTMLAnchorElement.prototype.click;
  // Only programmatic blob downloads are captured; any other anchor click behaves normally.
  HTMLAnchorElement.prototype.click = function () { if (this.download && this.href.startsWith('blob:')) { downloads.push({ name: this.download, href: this.href }); return; } return origClick.call(this); };
  const lastText = async (re) => { const d = await until(() => downloads.slice().reverse().find((x) => re.test(x.name)), 15000); return d ? (await fetch(d.href)).text() : ''; };
  const sheet = () => ($('#ac-doc .ct-sheet') || {}).textContent || '';
  // Date inputs react to 'change', text inputs to 'input': the event matches what a real user interaction fires.
  const type = (k, v) => { const i = $(`#ac-side [data-k="${k}"]`); if (!i) return false; i.value = v; i.dispatchEvent(new Event(i.type === 'date' ? 'change' : 'input', { bubbles: true })); return true; };
  const S = () => window.__ac.S;
  const mobile = matchMedia('(max-width: 900px)').matches;

  await until(() => window.__ac && S().result && sheet().length > 1000);
  step('the lease template opens with its example', /ДОГОВОР НАЙМА|RESIDENTIAL LEASE/.test(sheet()) && S().templates.length >= 4, S().templates.length);

  // A document from the template.
  $('.ac-docbanner .ed-primary').click();
  await until(() => S().docId);
  await sleep(300);
  step('a new document is created and empty', !!S().docId && /ct-empty/.test($('#ac-doc .ct-sheet').innerHTML) && S().issues.some((x) => x.code === 'required'), S().issues.length);
  if (mobile) { $('.ac-tab[data-k="fields"]').click(); await sleep(100); }
  type('tenant|name', 'Петров Пётр Петрович');
  type('rent', '50000');
  type('term|start', '2027-01-23');
  type('term|months', '11');
  await sleep(500);
  const txt = sheet();
  // No-break spaces (grouping in Russian number formatting) are normalised before matching.
  step('fields fill the text', txt.includes('Петров Пётр Петрович') && /50\s000 \(пятьдесят тысяч\) рублей/.test(txt.replace(/ /g, ' ')), null);
  const rows = $$('#ac-doc .ct-sched tbody tr').map((r) => r.children[1].textContent);
  step('billing periods run from the 23rd to the 22nd', rows.length === 11 && rows[0] === '23.01.2027 – 22.02.2027' && rows[10] === '23.11.2027 – 22.12.2027', rows);

  // Modifiers and levels.
  const mod = (id) => $(`.ac-mod[data-mod="${id}"]`);
  const poaOn = mod('poa').getAttribute('aria-pressed') === 'true';
  if (!poaOn) { mod('poa').click(); await sleep(300); }
  step('power of attorney adds the representative and its fields', !!$('#ac-side [data-field="agent"]') && !!$('#ac-side [data-field="agentDoc"]') && /от имени и в интересах/.test(sheet()), null);
  mod('poa').click();
  await sleep(300);
  step('without it they are gone', !$('#ac-side [data-field="agentDoc"]') && !/от имени и в интересах/.test(sheet()), null);
  mod('extraServices').click();
  await sleep(300);
  step('additional services add a list and an appendix', !!$('#ac-side [data-field="services"]') && /ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ/.test(sheet()), null);
  $('#ac-side [data-k="services|add"]').click();
  await sleep(200);
  type('services|0|name', 'Уборка');
  type('services|0|price', '5000');
  await sleep(400);
  step('a service in the appendix table', /Уборка/.test(sheet()) && /5\s000 \(пять тысяч\) рублей в месяц/.test(sheet().replace(/ /g, ' ')), null);
  $('.ac-level[data-level="strictness"] [data-v="strict"]').click();
  await sleep(300);
  step('strictness: a deposit of two months', /100\s000 \(сто тысяч\) рублей/.test(sheet().replace(/ /g, ' ')) && /неустойку 1 %/.test(sheet().replace(/ /g, ' ')), null);

  // The JS validator (a worker): twelve months need registration.
  type('term|months', '12');
  await until(() => S().userIssues.some((x) => x.field === 'term'), 6000);
  step('the JS validator reports from its worker', S().userIssues.some((x) => x.field === 'term' && /674/.test(x.message)), S().userRun);

  // Language of the contract.
  const langSel = $('.ac-bar .ac-lang');
  langSel.value = 'en'; langSel.dispatchEvent(new Event('change'));
  await sleep(300);
  step('the contract in English', /RESIDENTIAL LEASE AGREEMENT/.test(sheet()) && /fifty thousand/.test(sheet()), null);
  langSel.value = 'ru'; langSel.dispatchEvent(new Event('change'));
  await sleep(300);

  // Edit mode: a new placeholder becomes a field.
  if (mobile) { $('.ac-tab[data-k="doc"]').click(); await sleep(100); }
  $('#ac-edit').click();
  await until(() => $('.ac-ce[data-cl="rentCl"] textarea'));
  const ta = $('.ac-ce[data-cl="rentCl"] textarea');
  ta.value += ' Срок оплаты коммунальных услуг — до {{keysCount}} комплектов.';
  ta.dispatchEvent(new Event('input'));
  await until(() => S().tpl.fields.some((f) => f.id === 'keysCount'), 5000);
  const nf = S().tpl.fields.find((f) => f.id === 'keysCount');
  step('a placeholder typed into a clause becomes a typed field', nf && nf.type === 'number', nf);
  $('#ac-edit').click();
  await sleep(300);

  // Persistence.
  await sleep(900);
  const saved = await S().store.docs.get(S().docId);
  step('the document is kept in IndexedDB with its template version', saved && saved.values.rent === '50000' && saved.templateVersion === S().tpl.version && S().store.kind === 'indexeddb', saved && [saved.templateVersion, S().store.kind]);

  // Compile the template into one HTML file.
  window.__ac.A.compile();
  await until(() => $('.ed-dialog'));
  $('.ed-dialog .ed-dlg-foot .ed-primary').click();
  const html = await lastText(/\.html$/);
  // The compiled contract must carry a CSP forbidding connections and the embedded runtime, and contain no network
  // API at all: it is meant to be emailed and opened offline.
  step('the template compiles into one HTML file', html.startsWith('<!doctype html>') && html.includes("connect-src 'none'") && html.includes('Symbol.for("bundle:page.js")') && html.length > 100000, html.length);
  step('the compiled file has no network code', !/(?<![\w$.])fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(html), null);
  window.__ac.A.exportJSON('doc');
  const json = await lastText(/\.agreement\.json$/);
  let bundle = null;
  try { bundle = JSON.parse(json); } catch { bundle = null; }
  step('document export with its template', bundle && bundle.format === 'in-html-contract-doc-bundle' && bundle.template.fields.length > 30, null);

  if (mobile) step('phones get pane tabs', $$('.ac-tab').length === 3 && getComputedStyle($('.ac-tabs')).display !== 'none', null);
  HTMLAnchorElement.prototype.click = origClick;
  const missing = [...(window.__edMissingKeys || [])];
  step('every UI string has a dictionary entry', missing.length === 0, missing.slice(0, 12));
  step('no page errors', errors.length === 0, errors.slice(0, 3));
  return { steps, downloads: downloads.map((d) => d.name) };
}
