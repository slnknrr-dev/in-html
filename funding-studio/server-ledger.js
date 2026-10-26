// funding-studio/server-ledger.js - the donations ledger of the backend over the hosting storage (one key per
// record, an in-memory index built at start).
//
// Donation (key 'don:<id>'): { id, key (secret for the donor's links), site, campaign, method, interval, amount,
//   currency, value (in the campaign currency, null without a rate), campCur, status: created | pending | succeeded |
//   failed | expired | refunded | cancelled, renewal, sub (recurring id), donor: { name, email, message, anon, wall },
//   wall: pending | approved | hidden, refs: ['stripe:session:cs_…', …], data (provider facts), thanks, back, lang,
//   receiptNo, created, updated, paidAt, test, note }
// Recurring donor (key 'sub:<id>'): { id, provider, ref, customer, recId, amount, currency, site, campaign, donor,
//   status: active | cancelled, created, next (TBC charges), first (donation id), payments }
//
// Design: storage is a plain key/value store (files on disk or memory), so the ledger keeps everything in Maps and
// writes one key per record on change. Reads and stats are in-memory scans - O(donations) per call, fine for the
// thousands of records a campaign site holds and far simpler than a database. `refs` maps provider references
// (session id, order id, tx hash) to donation ids so webhooks find their donation in O(1) and duplicates are detected.
// `rev` increments on every write; the backend uses it to know when cached pages are stale.
// Single-process assumption: two backend processes over the same storage would each hold a stale index.
import { convert } from '../payments/money.js';
import { randomId } from './server-util.js';

export const FINAL = ['succeeded', 'failed', 'expired', 'refunded', 'cancelled'];

export function createLedger(storage, log = () => {}) {
  const dons = new Map();
  const subs = new Map();
  const refs = new Map();
  let rev = 0;
  for (const k of storage.list('don:')) { const r = storage.read(k); if (r && r.id) { dons.set(r.id, r); for (const x of r.refs || []) refs.set(x, r.id); } }
  for (const k of storage.list('sub:')) { const s = storage.read(k); if (s && s.id) subs.set(s.id, s); }
  const now = () => new Date().toISOString();

  function save(r) {
    r.updated = now();
    dons.set(r.id, r);
    for (const x of r.refs || []) refs.set(x, r.id);
    storage.write('don:' + r.id, r);
    rev++;
    return r;
  }
  function saveSub(s) { subs.set(s.id, s); storage.write('sub:' + s.id, s); rev++; return s; }

  // id: 'd' + 15 random chars (public, appears in URLs); key: 24 random chars (~124 bits, the donor's capability for
  // status/receipt/portal). Separate values so leaking an id in a log or referrer grants nothing.
  function create(f) {
    const r = {
      id: 'd' + randomId(15), key: randomId(24), site: f.site, campaign: f.campaign, method: f.method, interval: f.interval || 'once',
      amount: f.amount, currency: f.currency, campCur: f.campCur || f.currency, value: null, status: f.status || 'created',
      renewal: !!f.renewal, sub: f.sub || null, donor: f.donor || {}, wall: 'pending', refs: [], data: f.data || {},
      thanks: f.thanks || '', back: f.back || '', lang: f.lang || '', receiptNo: '', created: now(), updated: now(), paidAt: '',
      test: !!f.test, note: f.note || '',
    };
    return save(r);
  }

  function addRef(r, ref) { if (ref && !r.refs.includes(ref)) r.refs.push(ref); }
  const byRef = (ref) => { const id = refs.get(ref); return id ? dons.get(id) || null : null; };

  // Gapless per-year receipt numbers (PREFIX-YYYY-00001), as tax receipts usually require; the counter is persisted
  // before the number is used. Year in UTC, so the change of year is the same for every server timezone.
  function nextReceipt(prefix) {
    const y = new Date().getUTCFullYear();
    const seq = storage.read('receipt-seq') || {};
    const n = (seq[y] || 0) + 1;
    seq[y] = n;
    storage.write('receipt-seq', seq);
    return `${prefix || 'R'}-${y}-${String(n).padStart(5, '0')}`;
  }

  // Moves a donation to a status; a first success fixes paidAt, the value in the campaign currency and a receipt
  // number. o = { status, amount, currency, rates, receiptPrefix, wallAuto }.
  // The provider-reported amount/currency overwrite the requested ones (the donor may have changed the amount on the
  // provider's page, e.g. Stripe "customer chooses"). Side effects happen only on the transition into 'succeeded', so
  // a repeated settle (webhook retry plus polling) does not issue a second receipt number. value = amount converted
  // to the campaign currency with the owner's rates; null when no rate exists, and such donations then count 0 in
  // stats.raised (the goal bar under-reports rather than guesses).
  function settle(r, o) {
    if (!r) return null;
    const was = r.status;
    if (o.amount != null && Number.isFinite(Number(o.amount)) && Number(o.amount) > 0) r.amount = Number(o.amount);
    if (o.currency) r.currency = o.currency;
    if (o.status) r.status = o.status;
    if (r.status === 'succeeded' && was !== 'succeeded') {
      r.paidAt = r.paidAt || now();
      const v = convert(r.amount, r.currency, r.campCur, o.rates || {});
      r.value = v == null ? null : Math.round(v * 100) / 100;
      if (!r.receiptNo) r.receiptNo = nextReceipt(o.receiptPrefix);
      if (o.wallAuto && r.donor && r.donor.wall) r.wall = 'approved';
      log(`donation ${r.id} succeeded: ${r.amount} ${r.currency} via ${r.method}`);
    }
    return save(r);
  }

  function list(f = {}) {
    let a = [...dons.values()];
    if (f.site) a = a.filter((r) => r.site === f.site);
    if (f.campaign) a = a.filter((r) => r.campaign === f.campaign);
    if (f.status) a = a.filter((r) => r.status === f.status);
    if (f.method) a = a.filter((r) => r.method === f.method);
    if (f.wall) a = a.filter((r) => r.donor && r.donor.wall && r.wall === f.wall && r.status === 'succeeded');
    if (f.q) { const q = String(f.q).toLowerCase(); a = a.filter((r) => [r.id, r.receiptNo, r.donor.name, r.donor.email, r.donor.message].some((x) => String(x || '').toLowerCase().includes(q))); }
    return a.sort((x, y) => String(y.created).localeCompare(String(x.created)));
  }

  // Live figures of every campaign of a site: { [campaign]: { raised, donors, wall: [...] } } (succeeded donations;
  // donors count first payments, not monthly renewals).
  // Public data: the wall exposes only approved, opted-in entries; anonymous donors appear without a name; email never
  // leaves. Newest 100 entries per campaign keep the live response small.
  function stats(site, o = {}) {
    const out = {};
    for (const r of dons.values()) {
      if (r.site !== site || r.status !== 'succeeded') continue;
      const s = out[r.campaign] || (out[r.campaign] = { raised: 0, donors: 0, wall: [] });
      s.raised += r.value || 0;
      if (!r.renewal) s.donors++;
      if (r.donor && r.donor.wall && r.wall === 'approved' && !r.renewal) {
        s.wall.push({ n: r.donor.anon ? null : r.donor.name || null, a: o.amounts === false ? 0 : r.amount, c: r.currency, m: r.donor.message || '', t: r.paidAt });
      }
    }
    for (const s of Object.values(out)) {
      s.raised = Math.round(s.raised * 100) / 100;
      s.wall.sort((a, b) => String(b.t).localeCompare(String(a.t)));
      s.wall = s.wall.slice(0, 100);
    }
    return out;
  }

  return {
    get rev() { return rev; },
    get: (id) => dons.get(id) || null, all: () => [...dons.values()], create, save, settle, addRef, byRef, list, stats,
    sub: (id) => subs.get(id) || null, subs: () => [...subs.values()], saveSub,
    createSub(f) { return saveSub({ id: 's' + randomId(15), status: 'active', created: now(), payments: 0, ...f }); },
    subByRef: (provider, ref) => [...subs.values()].find((s) => s.provider === provider && s.ref === ref) || null,
  };
}
