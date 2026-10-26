// ledger/export.js - CSV of statements, journals and period KPIs for a spreadsheet: amounts as plain decimals of the
// currency's own exponent ('1234.56'), dates as ISO days, labels in the reader's language, formula injection guarded
// (a cell starting with = + - @ that is not a number gets a leading apostrophe), and a UTF-8 BOM so Excel reads
// Cyrillic and Georgian (../csv/csv.js writes the rows).
//
//   csvText(rows, { bom = true, delimiter = ',' }) -> text
//   statementCsv(st, { lang, names }) -> text      rows of statement() / ownerReport() + a totals block
//   journalCsv(ops, { lang, names, partyNames }) -> text
//   kpiCsv(kpis, { lang }) -> text                 one line per currency

import { serializeCSV } from '../csv/csv.js';
import { decimalText } from './minor.js';
import { articleLabel, kindLabel } from './parties.js';
import { reversedIds } from './journal.js';

// Amounts go out via decimalText (string built from the integer), never via Number formatting: '0.1 + 0.2' noise or
// locale separators would make spreadsheets misread values. Labels are localised, the KPI header is not - it is a
// machine-readable export with stable column ids.
const HEAD = {
  en: { day: 'Date', kind: 'Operation', article: 'Article', amount: 'Amount', currency: 'Currency', ref: 'Reference', voided: 'Cancelled', note: 'Note', balance: 'Balance', party: 'Party', id: 'Id', reverses: 'Reverses', opening: 'Opening balance', closing: 'Closing balance', yes: 'yes' },
  ru: { day: 'Дата', kind: 'Операция', article: 'Статья', amount: 'Сумма', currency: 'Валюта', ref: 'Основание', voided: 'Отменено', note: 'Заметка', balance: 'Остаток', party: 'Сторона', id: 'Номер', reverses: 'Сторно к', opening: 'Входящий остаток', closing: 'Исходящий остаток', yes: 'да' },
  ka: { day: 'თარიღი', kind: 'ოპერაცია', article: 'მუხლი', amount: 'თანხა', currency: 'ვალუტა', ref: 'საფუძველი', voided: 'გაუქმებული', note: 'შენიშვნა', balance: 'ნაშთი', party: 'მხარე', id: 'ნომერი', reverses: 'სტორნო', opening: 'საწყისი ნაშთი', closing: 'საბოლოო ნაშთი', yes: 'კი' },
};
const head = (lang) => HEAD[String(lang || 'en').slice(0, 2)] || HEAD.en;

// guard: true enables formula-injection protection in the serializer (an amount like '-12.50' is numeric and left
// alone; a note '=HYPERLINK(...)' gets an apostrophe). The BOM is U+FEFF.
export function csvText(rows, { bom = true, delimiter = ',' } = {}) {
  return (bom ? '﻿' : '') + serializeCSV(rows, { delimiter, guard: true });
}

export function statementCsv(st, { lang = 'en', names, bom = true } = {}) {
  const h = head(lang);
  const cur = st.currency || '';
  const rows = [[h.day, h.kind, h.article, h.amount, h.currency, h.ref, h.voided, h.balance, h.note]];
  for (const r of st.rows || []) {
    rows.push([r.day, kindLabel(r.kind, lang), articleLabel(r.article, names, lang), decimalText(r.amount, r.currency || cur), r.currency || cur,
      r.ref ?? '', r.voided ? h.yes : '', r.balance == null ? '' : decimalText(r.balance, r.currency || cur), r.note || '']);
  }
  rows.push([]);
  rows.push([h.opening, '', '', decimalText(st.opening || 0, cur), cur]);
  for (const k of ['accrual', 'deduction', 'payout']) {
    rows.push([kindLabel(k, lang), '', '', decimalText(k === 'accrual' ? st.accrued : k === 'deduction' ? st.deducted : st.paid, cur), cur]);
  }
  rows.push([h.closing, '', '', decimalText(st.closing || 0, cur), cur]);
  return csvText(rows, { bom });
}

// Reversed operations stay in the export, flagged 'Cancelled' - an audit trail must show what was undone, not hide it.
export function journalCsv(ops, { lang = 'en', names, partyNames, bom = true } = {}) {
  const h = head(lang);
  const dead = reversedIds(ops);
  const rows = [[h.id, h.day, h.kind, h.party, h.article, h.amount, h.currency, h.ref, h.reverses, h.voided, h.note]];
  for (const o of ops || []) {
    rows.push([o.id, o.day, kindLabel(o.kind, lang), (partyNames && partyNames[o.partyId]) || o.partyId, articleLabel(o.article, names, lang),
      decimalText(o.amount, o.currency), o.currency, o.ref ?? '', o.reverses || '', dead.has(String(o.id)) ? h.yes : '', o.note || '']);
  }
  return csvText(rows, { bom });
}

export function kpiCsv(k, { bom = true } = {}) {
  const rows = [['from', 'to', 'currency', 'bookings', 'nights', 'occupancy_pct', 'gross', 'night_revenue', 'adr', 'revpar', 'owner_accrued', 'owner_deducted', 'owner_paid', 'owner_net', 'agency', 'expenses']];
  // occupancy arrives in per-mille (integer) from kpi.js; printed as a percentage with one decimal.
  const occ = k.occupancy >= 0 ? (k.occupancy / 10).toFixed(1) : '';
  for (const c of k.currencies || []) {
    const d = (v) => decimalText(v, c.currency);
    rows.push([k.period.from, k.period.to, c.currency, k.bookings, c.nights, occ, d(c.gross), d(c.nightRevenue), d(c.adr), d(c.revpar),
      d(c.ownerAccrued), d(c.ownerDeducted), d(c.ownerPaid), d(c.ownerNet), d(c.agency), d(c.expenses)]);
  }
  return csvText(rows, { bom });
}
