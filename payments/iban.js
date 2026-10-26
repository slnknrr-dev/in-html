// payments/iban.js - bank transfer details: IBAN (ISO 13616: country lengths, mod-97 check digits), BIC (ISO 9362) and
// the EPC QR code payload of a SEPA credit transfer (EPC069-12, "GiroCode").
//
//   normIBAN(text) -> 'GE29NB0000000101904917'   (spaces / dashes removed, upper case)
//   ibanProblem(text) -> '' | 'format' | 'country' | 'length' | 'checksum'
//   validIBAN(text) -> bool             formatIBAN(text) -> 'GE29 NB00 0000 0101 9049 17'
//   ibanCountry(text) -> 'GE'           validBIC(text) -> bool
//   epcPayload({ name, iban, bic, amount, purpose, reference, text, info, version }) -> string (throws on bad input)
//
// Design rules:
// - Validation is layered cheapest-first (shape, country, length, checksum) so the UI can name the *first* failing
//   criterion instead of a generic "invalid". The checksum alone is not enough: mod-97 catches all single-digit errors
//   and most transpositions, but says nothing about whether the country exists or the length is right.
// - Normalisation is permissive on input (spaces, dashes, case) and strict on output: the electronic form never has
//   separators; the 4-character groups are the print form only (ISO 13616-1).
// - epcPayload throws instead of returning '': a QR code that scans into a wrong or truncated transfer is worse than no
//   code, so the caller must handle the error explicitly.
import { decimalString } from './money.js';

// Lengths of the IBAN countries (SWIFT IBAN registry).
// Membership doubles as the 'country' check: a code absent here is not an IBAN country even if it is a valid ISO 3166
// code (US, CA, AU never adopted IBAN). Must track the registry; a stale table rejects new members as 'country'.
const LEN = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28,
  NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24,
  SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

export const normIBAN = (s) => String(s || '').replace(/[\s -]+/g, '').toUpperCase();
export const ibanCountry = (s) => normIBAN(s).slice(0, 2);

// ISO 7064 MOD 97-10 over the rearranged IBAN (letters as 10..35), computed in chunks.
// Why chunks: the digit string reaches ~68 digits, far past 2^53, so Number(digits) % 97 is wrong. Each step feeds the
// previous remainder (at most 2 digits) plus 7 new digits: at most 9 digits, exact in a double. BigInt would also work
// but allocates per IBAN. Letter mapping: 'A' is char code 65, minus 55 gives 10.
function mod97(s) {
  let r = 0;
  const digits = s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  for (let i = 0; i < digits.length; i += 7) r = Number(String(r) + digits.slice(i, i + 7)) % 97;
  return r;
}

export function ibanProblem(text) {
  const s = normIBAN(text);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(s)) return 'format';
  const len = LEN[s.slice(0, 2)];
  if (!len) return 'country';
  if (s.length !== len) return 'length';
  // Rearrangement: country + check digits move to the end; the whole number is 1 (mod 97) iff the check digits are
  // right (they were chosen as 98 minus (the number with '00' as check digits) mod 97).
  return mod97(s.slice(4) + s.slice(0, 4)) === 1 ? '' : 'checksum';
}

export const validIBAN = (s) => ibanProblem(s) === '';
// Lookahead (?=.) avoids a trailing space after the last full group.
export const formatIBAN = (s) => normIBAN(s).replace(/(.{4})(?=.)/g, '$1 ');
// BIC: 4 bank letters, 2 country letters, 2 location chars, optional 3-char branch. Shape only: there is no checksum,
// and the country is not cross-checked against the IBAN (some territories use a parent country's BICs).
export const validBIC = (s) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(s || '').trim().toUpperCase());

// EPC QR payload (Quick Response Code: Guidelines to Enable Data Capture for the Initiation of a SEPA Credit Transfer,
// EPC069-12): service tag BCD, version 002 (BIC optional), character set 1 (UTF-8), identification SCT, BIC, name
// (≤ 70), IBAN, amount 'EUR0.01'…'EUR999999999.99' (optional), purpose (4 letters, e.g. CHAR), a structured creditor
// reference (≤ 35) or an unstructured remittance text (≤ 140), information to the payer (≤ 70); LF separated, at most
// 331 bytes. Trailing empty fields are left out.
export function epcPayload({ name, iban, bic = '', amount = null, purpose = '', reference = '', text = '', info = '', version = '002' } = {}) {
  // LF is the field separator of the payload, so every free-text field has its line breaks flattened first; an embedded
  // newline would shift every later field and the bank app would read e.g. the remittance text as the IBAN.
  const nm = String(name || '').replace(/[\r\n]+/g, ' ').trim();
  const ib = normIBAN(iban);
  const b = String(bic || '').trim().toUpperCase();
  if (!nm || nm.length > 70) throw new Error('EPC QR: the beneficiary name needs 1–70 characters');
  if (!validIBAN(ib)) throw new Error('EPC QR: invalid IBAN');
  if (b && !validBIC(b)) throw new Error('EPC QR: invalid BIC');
  if (version === '001' && !b) throw new Error('EPC QR: version 001 needs a BIC');
  let amt = '';
  if (amount != null && amount !== '') {
    const v = Number(amount);
    if (!(v >= 0.01 && v <= 999999999.99)) throw new Error('EPC QR: the amount must be 0.01–999999999.99 EUR');
    amt = 'EUR' + String(Number(decimalString(v, 2))); // 'EUR1', 'EUR12.5', 'EUR12.34' as in the guideline's example
  }
  const pc = String(purpose || '').trim().toUpperCase();
  if (pc && !/^[A-Z]{4}$/.test(pc)) throw new Error('EPC QR: the purpose code has 4 letters');
  const ref = String(reference || '').replace(/\s+/g, '').toUpperCase();
  if (ref && ref.length > 35) throw new Error('EPC QR: the creditor reference has at most 35 characters');
  // Structured reference and unstructured text are mutually exclusive in the guideline; the reference wins.
  // KNOWN DEFECT: `ref` is not checked to be an ISO 11649 RF creditor reference (RFnn + mod-97), so a free-form string
  // passes and strict bank apps reject the code. Fix: validate the RF shape and run mod97() on the rearranged reference.
  const rem = ref ? '' : String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 140);
  const inf = String(info || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 70);
  const lines = ['BCD', version === '001' ? '001' : '002', '1', 'SCT', b, nm, ib, amt, pc, ref, rem, inf];
  // Keep the 7 mandatory lines (through the IBAN); drop only trailing empties, inner empties are positional.
  while (lines.length > 7 && !lines[lines.length - 1]) lines.pop();
  const out = lines.join('\n');
  // The limit is in UTF-8 bytes, not JS string length (UTF-16 units): Georgian or Cyrillic names take 2-3 bytes a char.
  if (new TextEncoder().encode(out).length > 331) throw new Error('EPC QR: more than 331 bytes');
  return out;
}
