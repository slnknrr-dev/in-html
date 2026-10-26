// bitcoin/units.js - amounts: exact decimal strings <-> satoshis (no floating point), units BTC / mBTC / bits / sat,
// grouping, fee rates.
//
//   parseBtc(text, unit = 'BTC') -> satoshis (Number; throws on more decimals than the unit has, garbage, > 21 M BTC)
//   formatBtc(sats, { unit = 'BTC', trim = true, group = false, sign = false }) -> string
//   formatSats(sats, { group = true }), formatFeeRate(satPerVb) ('12.3 sat/vB'), UNITS, MAX_MONEY, SATS_PER_BTC
//   btcToSats(number) (rounds a JSON-RPC float), satsToBtc(sats) -> number (for JSON-RPC parameters)
//
// Why no floating point: 0.1 + 0.2 !== 0.3, and parseFloat('0.29') * 1e8 = 28999999.999999996. Amounts are parsed as
// decimal strings into BigInt satoshis and only then converted to Number (exact below 2^53 > MAX_MONEY = 2.1e15).
// MAX_MONEY is Core's consensus bound on any single amount (CheckTransaction: "bad-txns-vout-toolarge"), so a parsed
// amount above it is an input error, not a large payment.

export const SATS_PER_BTC = 100000000;
export const MAX_MONEY = 21000000 * SATS_PER_BTC;
export const UNITS = { BTC: 8, mBTC: 5, bits: 2, sat: 0 };

// Strict decimal parser. Accepted grouping characters: whitespace plus U+00A0 / U+202F (no-break and narrow no-break spaces that locale formatters such as
// Intl.NumberFormat fr-FR emit, and that \s already covers - listed for explicitness), '_' and the apostrophe
// (Swiss grouping); one ',' is read as the decimal separator (European input). A second comma therefore fails
// ('1,000.5' -> '1.000.5'), which is intended: '1,000' is ambiguous (one thousand or one) and must not guess.
// Excess precision throws instead of rounding (0.123456789 BTC is a typo, not 0.12345679); trailing zeros are
// stripped first so '1.500000000' is still fine. No sign, no exponent: an amount field never needs either.
export function parseBtc(text, unit = 'BTC') {
  const dec = UNITS[unit];
  if (dec === undefined) throw new Error(`unknown unit ${unit}`);
  const s = String(text).trim().replace(/[\s_  ']/g, '').replace(',', '.');
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) throw new Error('invalid amount');
  const frac = (m[2] || '').replace(/0+$/, '');
  if (frac.length > dec) throw new Error(`at most ${dec} decimals in ${unit}`);
  const whole = m[1] || '0';
  const sats = BigInt(whole) * 10n ** BigInt(dec) + BigInt((frac || '0').padEnd(dec, '0').slice(0, dec) || '0');
  if (sats > BigInt(MAX_MONEY)) throw new Error('amount above 21 million BTC');
  return Number(sats);
}

// Thousands grouping with a lookahead: insert a space at every non-boundary position followed by whole triples of
// digits up to the end. Applied to the integer part only (grouping decimals would misplace the satoshi digits).
const groupInt = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Integer division of BigInt satoshis into whole and fraction: exact for every amount, unlike (sats / 1e8).toFixed(8)
// which rounds through binary floating point. Math.round guards callers that pass a computed float (fee * rate).
// minDecimals pads after trimming (e.g. always show "0.10" in a price column) but never beyond the unit's decimals.
export function formatBtc(sats, { unit = 'BTC', trim = true, group = false, sign = false, minDecimals = 0 } = {}) {
  const dec = UNITS[unit];
  if (dec === undefined) throw new Error(`unknown unit ${unit}`);
  const neg = sats < 0;
  const v = BigInt(Math.abs(Math.round(sats)));
  const base = 10n ** BigInt(dec);
  let whole = (v / base).toString();
  let frac = dec ? (v % base).toString().padStart(dec, '0') : '';
  if (trim) frac = frac.replace(/0+$/, '');
  if (frac.length < minDecimals) frac = frac.padEnd(Math.min(minDecimals, dec), '0');
  if (group) whole = groupInt(whole);
  return (neg ? '-' : sign && sats > 0 ? '+' : '') + whole + (frac ? '.' + frac : '');
}

export const formatSats = (sats, { group = true } = {}) => (group ? groupInt(String(Math.round(sats))) : String(Math.round(sats)));

// Fee rates: one decimal from 10 sat/vB up, two below, where fractional rates (and sub-1 sat/vB rates on nodes with a
// lowered minrelaytxfee) are meaningful.
export const formatFeeRate = (r) => `${r >= 10 ? Math.round(r * 10) / 10 : Math.round(r * 100) / 100} sat/vB`;

// JSON-RPC boundary: Core sends and expects BTC as JSON numbers (doubles). Rounding n * 1e8 is exact for any value
// with at most 8 decimals within MAX_MONEY (the double error is far below 0.5 sat). satsToBtc goes through the exact
// decimal string, so Number() returns the double nearest to it - the same value Core's ParseFixedPoint reads back.
export const btcToSats = (n) => Math.round(Number(n) * SATS_PER_BTC);
export const satsToBtc = (s) => Number(formatBtc(s));
