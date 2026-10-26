// receipt/vat.js - VAT in integer minor units. Retail prices include VAT, so the VAT of an amount is
// amount × r ÷ (100 + r) (18 % of 11.80 is 1.80); rates may have up to three decimals (5.5, 2.1). Breakdowns by rate
// either sum the rounded VAT of every line (method 'line', what a per-line fiscal document shows) or round once per
// rate on the rate's total (method 'rate', what many fiscal printers print); the two can differ by a few minor units.
// A rate of null means "without VAT" (exempt) and is reported apart from a 0 % rate.

import { mulDivRound } from './money.js';

const scaled = (rate) => Math.round(Number(rate) * 1000);

// VAT contained in a VAT-inclusive amount.
// Rates are scaled to thousandths of a percent (18 -> 18000), so amount * r / (100000 + r) stays an integer
// mul-div with one rounding, exact for rates such as 5.5 or 2.125.
export function vatIncluded(amount, rate, mode = 'half-up') {
  if (!rate) return 0;
  const r = scaled(rate);
  return mulDivRound(amount, r, 100_000 + r, mode);
}

// VAT to add on top of a net amount (invoices to businesses quote net prices).
export function vatOnTop(net, rate, mode = 'half-up') {
  if (!rate) return 0;
  return mulDivRound(net, scaled(rate), 100_000, mode);
}

// Net amount (without VAT) of a VAT-inclusive amount: the remainder after the rounded VAT, so net + vat = amount.
export const netOf = (amount, rate, mode) => amount - vatIncluded(amount, rate, mode);

const key = (rate) => String(Number(rate));

/**
 * VAT by rate of lines [{ total, vatRate }] (total VAT-inclusive, negative for returns).
 * -> { rates: { '18': { gross, vat, net } }, exempt: gross without VAT, vat: total VAT, gross: total }
 */
// The two methods exist because fiscal rules differ by country and device: summing rounded line VAT matches the
// lines printed on the receipt, rounding per rate total matches what many fiscal printers report. Callers choose to
// match their fiscal device; mixing them produces off-by-a-few-units discrepancies in shift totals.
export function vatBreakdown(lines, { method = 'line', mode = 'half-up' } = {}) {
  const rates = {};
  let exempt = 0, gross = 0;
  for (const l of lines) {
    gross += l.total;
    if (l.vatRate == null) { exempt += l.total; continue; }
    const k = key(l.vatRate);
    const x = (rates[k] ??= { rate: Number(l.vatRate), gross: 0, vat: 0, net: 0 });
    x.gross += l.total;
    if (method === 'line') x.vat += l.vat ?? vatIncluded(l.total, l.vatRate, mode);
  }
  let vat = 0;
  for (const x of Object.values(rates)) {
    if (method === 'rate') x.vat = vatIncluded(x.gross, x.rate, mode);
    x.net = x.gross - x.vat;
    vat += x.vat;
  }
  const out = {};
  for (const k of Object.keys(rates).sort((a, b) => Number(b) - Number(a))) {
    const { rate, ...rest } = rates[k];
    out[k] = rest;
  }
  return { rates: out, exempt, vat, gross };
}

// Adds two breakdowns (a shift total of receipts; pass a negative `sign` to subtract a return).
export function addBreakdown(a, b, sign = 1) {
  const rates = Object.fromEntries(Object.entries(a.rates).map(([k, x]) => [k, { ...x }]));
  for (const [k, x] of Object.entries(b.rates)) {
    const y = (rates[k] ??= { gross: 0, vat: 0, net: 0 });
    y.gross += sign * x.gross; y.vat += sign * x.vat; y.net += sign * x.net;
  }
  return { rates, exempt: a.exempt + sign * b.exempt, vat: a.vat + sign * b.vat, gross: a.gross + sign * b.gross };
}

export const emptyBreakdown = () => ({ rates: {}, exempt: 0, vat: 0, gross: 0 });
