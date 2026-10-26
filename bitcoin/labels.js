// bitcoin/labels.js - BIP-329 wallet labels: JSON Lines export and import of labels of transactions, addresses,
// public keys, inputs, outputs (with "spendable"), extended public keys and silent payment scan keys, with the
// validation of every reference format and the BIP's import rules (unknown records skipped, long labels truncated).
//
//   exportLabels(records) -> text (one JSON object per line, "\n" separated)
//   importLabels(text, { maxLength = 255, network }) -> { records, errors: [{ line, error }], truncated }
//   validateLabel(record, { network }) -> null | error message
//   LABEL_TYPES
//   record: { type, ref, label?, origin?, spendable? (outputs only) }
import { isValidAddress } from './address.js';
import { extendedKeyPrefix } from '../hdkey/bip32.js';

//
// Import is lenient per line, strict per record: a bad line is reported and skipped (BIP-329: importers must not
// fail the whole file), but a record that passes is fully validated, because labels feed coin control - a label
// attached to a mistyped outpoint would mark the wrong coin "do not spend". Label text is untrusted user data:
// display as text only. Labels can reveal a wallet's whole history; the export is as sensitive as an xpub.
export const LABEL_TYPES =['tx', 'addr', 'pubkey', 'input', 'output', 'xpub', 'spscan'];

const TXID = /^[0-9a-fA-F]{64}$/;
const OUTPOINT = /^[0-9a-fA-F]{64}:\d{1,10}$/;

export function validateLabel(r, { network = null } = {}) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'not an object';
  if (!LABEL_TYPES.includes(r.type)) return `unknown type "${r.type}"`;
  if (typeof r.ref !== 'string' || !r.ref) return 'missing ref';
  if (r.label !== undefined && typeof r.label !== 'string') return 'label must be a string';
  if (r.origin !== undefined && typeof r.origin !== 'string') return 'origin must be a string';
  if (r.spendable !== undefined && (r.type !== 'output' || typeof r.spendable !== 'boolean')) return 'spendable is a boolean of outputs only';
  switch (r.type) {
    case 'tx': return TXID.test(r.ref) ? null : 'a tx ref is a transaction id';
    case 'input': case 'output': return OUTPOINT.test(r.ref) ? null : `an ${r.type} ref is txid:index`;
    case 'addr': return isValidAddress(r.ref, network) ? null : 'invalid address';
    case 'pubkey': return /^(?:[0-9a-fA-F]{64}|0[23][0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/.test(r.ref) ? null : 'a pubkey ref is a 32, 33 or 65 byte hex key';
    case 'xpub': return extendedKeyPrefix(r.ref) ? null : 'invalid extended public key';
    case 'spscan': return /^spscan1/i.test(r.ref) || /^tspscan1/i.test(r.ref) ? null : 'invalid silent payment scan key';
    default: return null;
  }
}

// Whitelist of known fields in a fixed order (unknown keys dropped), so exports are canonical and diffable.
const clean = (r) => {
  const o = { type: r.type, ref: r.ref };
  if (r.label !== undefined) o.label = r.label;
  if (r.origin !== undefined) o.origin = r.origin;
  if (r.type === 'output' && r.spendable !== undefined) o.spendable = r.spendable;
  return o;
};

export function exportLabels(records) {
  const lines = [];
  for (const r of records) {
    const e = validateLabel(r);
    if (e) throw new Error(`label ${r && r.ref}: ${e}`);
    lines.push(JSON.stringify(clean({ ...r, label: r.label !== undefined ? String(r.label).replace(/[\r\n]+/g, ' ') : undefined })));
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

// A leading BOM is stripped (Windows editors add it), lines split on '\n' and trimmed (so CRLF works). Length is
// counted in code points ([...s]), not UTF-16 units, so truncation never splits a surrogate pair.
export function importLabels(text, { maxLength = 255, network = null } = {}) {
  const records = [], errors = [];
  let truncated = 0;
  String(text).replace(/^﻿/, '').split('\n').forEach((line, i) => {
    const s = line.trim();
    if (!s) return;
    let r;
    try { r = JSON.parse(s); } catch { errors.push({ line: i + 1, error: 'invalid JSON' }); return; }
    const e = validateLabel(r, { network });
    if (e) { errors.push({ line: i + 1, error: e }); return; }
    const o = clean(r);
    if (o.label !== undefined && [...o.label].length > maxLength) { o.label = [...o.label].slice(0, maxLength).join(''); truncated++; }
    records.push(o);
  });
  return { records, errors, truncated };
}
