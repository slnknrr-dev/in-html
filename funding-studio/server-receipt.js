// funding-studio/server-receipt.js - the donation receipt the backend issues: a small standalone, printable HTML page in
// the donor's language (organisation from the published document, receipt number, date, amount, method, campaign).
import { escapeHTML } from '../html/escape.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { formatMoney } from '../payments/money.js';
import { UI_FD } from './dict.js';

// Design: a self-contained document (inline CSS, one inline onclick for printing, no external resources) so it can be
// downloaded, archived and opened years later, and so the strict CSP set in backend.js can forbid every fetch.
// Every interpolated value passes escapeHTML - donor name, email and organisation texts are user input.
// Language: the donor's language (primary subtag of don.lang) if supported, else the site default, else English;
// strings fall back key-wise to English. Dates are formatted in UTC so the receipt date never depends on server TZ.
// @media print hides the button and the card frame, giving a clean A4 printout.
const LANGS = Object.keys(UI_FD);

export function receiptHTML(don, doc, camp) {
  const lang = LANGS.includes(String(don.lang).split('-')[0]) ? String(don.lang).split('-')[0] : (doc && LANGS.includes(doc.defaultLang) ? doc.defaultLang : 'en');
  const T = (k) => (UI_FD[lang] && UI_FD[lang][k]) || UI_FD.en[k] || k;
  const pick = (i18n) => (doc ? htmlToText(pickText(i18n, lang, doc)) : '');
  const org = doc ? doc.org : {};
  const date = (() => { try { return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(don.paidAt || don.created)); } catch { return String(don.paidAt || don.created).slice(0, 10); } })();
  const donor = don.donor && !don.donor.anon && don.donor.name ? don.donor.name : T('rc.anon');
  const rows = [
    [T('rc.no'), don.receiptNo || '—'], [T('rc.date'), date], [T('rc.donor'), donor + (don.donor && don.donor.email ? ' · ' + don.donor.email : '')],
    [T('rc.amount'), formatMoney(don.amount, don.currency, lang, { whole: false }) + (don.interval === 'month' ? ' · ' + T('rc.monthly') : '')],
    [T('rc.method'), T('m.' + don.method) || don.method], [T('rc.campaign'), camp ? pick(camp.title) || camp.slug : ''], [T('rc.ref'), don.id],
  ];
  const orgLines = [pick(org.name), pick(org.address), org.regNo ? T('regNo') + ' ' + org.regNo : '', org.email, org.website].filter(Boolean);
  return `<!doctype html><html lang="${escapeHTML(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHTML(T('rc.title') + ' ' + (don.receiptNo || ''))}</title><meta name="robots" content="noindex">`
    + '<style>body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Georgian",sans-serif;color:#1f2937;background:#f3f4f6;margin:0;padding:24px}'
    + 'main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px}h1{margin:0 0 4px;font-size:1.5em}'
    + '.org{color:#4b5563;margin:0 0 24px}table{width:100%;border-collapse:collapse}th,td{text-align:start;padding:8px 0;border-bottom:1px solid #e5e7eb;vertical-align:top}'
    + 'th{color:#6b7280;font-weight:500;width:40%}.note{margin-top:20px;color:#4b5563;font-size:.92em}.thanks{margin-top:24px;font-weight:600}'
    + 'button{margin-top:20px;font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer}@media print{body{background:#fff;padding:0}main{border:0}button{display:none}}</style></head>'
    + `<body><main><h1>${escapeHTML(T('rc.title'))}</h1><p class="org">${orgLines.map(escapeHTML).join('<br>')}</p><table>`
    + rows.map(([k, v]) => `<tr><th scope="row">${escapeHTML(k)}</th><td>${escapeHTML(v)}</td></tr>`).join('')
    + `</table>${pick(org.note) ? `<p class="note">${escapeHTML(pick(org.note))}</p>` : ''}<p class="thanks">${escapeHTML(T('rc.thanks'))}</p>`
    + `<button type="button" onclick="print()">${escapeHTML(T('rc.print'))}</button></main></body></html>`;
}
