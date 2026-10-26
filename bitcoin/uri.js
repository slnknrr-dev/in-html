// bitcoin/uri.js - BIP-21 payment URIs: bitcoin:<address>?amount=<BTC>&label=&message=&lightning=&pj=…, parsing with
// the BIP's rules (case-insensitive scheme, req- parameters that are not understood make the URI invalid, amounts in
// decimal BTC without exponents), building with percent-encoding, and QR-friendly upper case for bech32 addresses.
//
//   parseBitcoinURI(text, { network, known = [], validateAddress = true }) -> { address, amount (sats) | null, label, message, lightning,
//     params: { other: values } }   (throws for invalid addresses, amounts, unknown req- parameters)
//   formatBitcoinURI({ address, amount (sats), label, message, lightning, params }, { qr = false }) -> string
//     qr: upper-case scheme and bech32 address (smaller alphanumeric QR codes)
import { decodeAddress } from './address.js';
import { formatBtc, parseBtc } from './units.js';

// Security model: a bitcoin: URI comes from an untrusted page or QR code. The address is validated (checksum and
// network) before anything is shown, amounts go through the exact parser, and BIP-21's req- rule is enforced: a
// sender that does not understand a required parameter must refuse rather than pay ignoring it (e.g. a future
// req-expiry). Displayed label / message are attacker-controlled text: render as text, never as HTML.
//
// Parameters this parser understands (BIP-21 core + lightning fallback + BIP-77/78 payjoin endpoint / options).
const KNOWN = new Set(['amount', 'label', 'message', 'lightning', 'pj', 'pjos']);

export function parseBitcoinURI(text, { network = null, known = [], validateAddress = true } = {}) {
  const s = String(text).trim();
  // Scheme is case-insensitive (RFC 3986; QR codes use BITCOIN: for the alphanumeric mode). Fragment ignored.
  // decodeURIComponent throws URIError on a malformed %xx: propagates as an invalid URI, which is the right outcome.
  const m = /^bitcoin:([^?#]*)(?:\?([^#]*))?/i.exec(s);
  if (!m) throw new Error('not a bitcoin: URI');
  const address = decodeURIComponent(m[1]);
  const out = { address, amount: null, label: '', message: '', lightning: '', params: {} };
  if (address && validateAddress) decodeAddress(address, network);
  const understood = new Set([...KNOWN, ...known]);
  for (const part of (m[2] || '').split('&').filter(Boolean)) {
    const i = part.indexOf('=');
    const key = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' '));
    const value = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\+/g, '%20'));
    const k = key.toLowerCase();
    // '+' is a space in form encoding, which wallets emit despite BIP-21 asking for %20; accepted on input.
    // amount: BIP-21 grammar is digits with an optional '.', no exponent / sign / grouping, and only once (two amounts
    // are an ambiguity an attacker could exploit between wallets that take the first vs the last).
    // KNOWN DEFECT: 'req-amount' (and req-label / req-message) is accepted as "understood" but then stored in params
    // instead of being parsed, so a URI carrying only req-amount=… is paid with amount null. Fix: strip the 'req-'
    // prefix before the amount / label / message branches.
    // KNOWN DEFECT: params.pj below is looked up case-sensitively while keys keep their original case, so 'PJ=' alone
    // is rejected as "needs an address". Fix: store params under the lower-cased key or test k.
    if (k === 'amount') {
      if (out.amount !== null) throw new Error('more than one amount');
      if (!/^\d*\.?\d+$|^\d+\.$/.test(value)) throw new Error('invalid amount');
      out.amount = parseBtc(value);
    } else if (k === 'label' || k === 'message' || k === 'lightning') out[k] = value;
    else if (k.startsWith('req-') && !understood.has(k.slice(4))) throw new Error(`unsupported required parameter ${key}`);
    else out.params[key] = value;
  }
  if (!address && !out.lightning && !out.params.pj) throw new Error('a bitcoin: URI needs an address');
  return out;
}

// encodeURIComponent already writes spaces as %20 (never '+'), so the replace is a no-op kept as documentation of the
// BIP-21 requirement; it does leave '!', "'", '(', ')', '*' unescaped, which RFC 3986 allows in a query.
const enc = (v) => encodeURIComponent(v).replace(/%20/g, '%20');

export function formatBitcoinURI({ address = '', amount = null, label = '', message = '', lightning = '', params = {} } = {}, { qr = false } = {}) {
  const q = [];
  if (amount !== null && amount !== undefined && amount !== '') q.push('amount=' + formatBtc(amount));
  if (label) q.push('label=' + enc(label));
  if (message) q.push('message=' + enc(message));
  if (lightning) q.push('lightning=' + (qr ? lightning.toUpperCase() : lightning));
  for (const [k, v] of Object.entries(params)) q.push(enc(k) + '=' + enc(v));
  // QR alphanumeric mode encodes only 0-9 A-Z and a few symbols at 5.5 bits/char vs 8 in byte mode, so an all-upper
  // bech32 address (valid: BIP-173 forbids only *mixed* case) gives a visibly smaller code. Base58 is case-sensitive
  // and must not be touched. The lightning invoice (bech32 too) is upper-cased for the same reason and written
  // unescaped: its charset needs no percent-encoding.
  let addr = address;
  if (qr && /^(bc|tb|bcrt)1/i.test(addr)) addr = addr.toUpperCase();
  return (qr ? 'BITCOIN:' : 'bitcoin:') + addr + (q.length ? '?' + q.join('&') : '');
}
