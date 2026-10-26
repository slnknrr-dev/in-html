// booking/auction.js - a timed auction on an offer (a sale, a long-term rent): terms { start, step, until, reserve },
// whether it is live (deadline not passed and, optionally, the paid period covers today), the minimum next bid, the
// bid ceiling, the leading bid, refusals as codes, the outcome with the reserve, withdrawing a bid, a lock against
// changing the terms while bids stand, and settling a round so a restarted auction is a new round. Amounts are
// integer minor units; days are 'YYYY-MM-DD' compared as strings; `today` is always an input.
//
// The reserve never leaves the model: it answers "met / not met", only the seller knows the number (knowing it, a
// buyer bargains against the seller instead of against other buyers).
//
//   normalizeAuction(raw) -> terms | null   auctionLive(a, paidUntil, today)   auctionState(a, paidUntil, today)
//   nextBid(a, top)   BID_CEIL_FACTOR = 10   bidCeiling(a, top)   bidRefusal(a, top, price) -> null | code
//   bidAlive(bid)   auctionTop(bids)   auctionOutcome(a, bids, today) -> { ended, top, winner, reserveMet }
//   bidWithdrawable(live, mine, top)   auctionTermsChanged(before, after, locked) -> key | null
//   publicTerms(a, bids) -> terms without the reserve   roundBids(bids, a)   settleBids(bids, a, today) -> { bids, settled, winner }
//   restartAuction(a, until, { step, reserve }) -> terms of a new round

const day = (s) => String(s || '').slice(0, 10);

/**
 * Terms from input; null when switched off (on: false), without a deadline or without a start price (an auction
 * without a deadline is not an auction). step 0 = any bid above the current one, reserve 0 = none.
 */
export function normalizeAuction(raw) {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r || r.on === false) return null;
  const until = String(r.until ?? '').trim().slice(0, 40);
  if (!until) return null;
  const num = (v) => {
    const n = Number(String(v ?? '').trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  const start = num(r.start);
  if (!start) return null;
  return { start, step: num(r.step), until, reserve: num(r.reserve) };
}

/**
 * Bidding is open: the deadline has not come (the closing day itself is closed) and the paid period covers today.
 * Pass paidUntil = null for an auction without a paywall; '' means unpaid. Expiry is passive: no job closes it.
 */
export function auctionLive(a, paidUntil, today) {
  const t = day(today);
  if (!t || !a) return false;
  if (day(a.until) <= t) return false;
  if (paidUntil !== null && day(paidUntil) <= t) return false;
  return true;
}

// 'live' | 'unpaid' | 'ended' | 'none'. An unpaid auction does not hide the listing: it shows its start as "from".
export function auctionState(a, paidUntil, today) {
  if (!a) return 'none';
  const t = day(today);
  if (day(a.until) <= t) return 'ended';
  return paidUntil === null || day(paidUntil) > t ? 'live' : 'unpaid';
}

// Minimum next bid: the start price before the first bid (it may be bid outright), then the top plus the step; a
// zero step adds 1, or a bid equal to the current one would pass.
export const nextBid = (a, top) => (top > 0 ? top + (a.step || 1) : a.start);

// A bid may exceed max(top, start) at most this many times. Without a ceiling one bid of 1e300 broke the auction for
// good: top + step lost precision, nextBid equalled the top, nobody could outbid and the leader cannot withdraw.
// The ceiling is relative to the top, not the reserve, so a refusal never reveals the reserve.
export const BID_CEIL_FACTOR = 10;

export function bidCeiling(a, top) {
  const base = Math.max(Number(top) || 0, Number(a.start) || 0, 1);
  return Math.min(Number.MAX_SAFE_INTEGER, base * BID_CEIL_FACTOR);
}

// Why a bid cannot be accepted: 'no_price' (not a positive integer), 'too_high', 'too_low'; null = accept.
// "Only upwards" follows from nextBid: there is no separate "above your own previous bid" rule.
export function bidRefusal(a, top, price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0 || Math.trunc(n) !== n) return 'no_price';
  if (!Number.isSafeInteger(n) || n > bidCeiling(a, top)) return 'too_high';
  const next = nextBid(a, top);
  if (!Number.isSafeInteger(next)) return 'too_high';
  return n < next ? 'too_low' : null;
}

// A bid holds the auction unless withdrawn or declined at a settlement.
export const bidAlive = (b) => b.status !== 'withdrawn' && b.status !== 'declined';

// The leading bid: the highest alive one; at an equal price the EARLIER one (smaller id), so "who leads" never depends
// on the order of a query. bids: [{ id, author, price, status }]
// Note: `b.id < top.id` compares ids with JS `<` - numerically for numeric ids, lexicographically for string ids
// ('10' < '9'). Storage must hand numeric ids (or zero-padded strings) for the earlier-wins tie-break to hold.
export function auctionTop(bids) {
  let top = null;
  for (const b of bids || []) {
    if (!bidAlive(b) || b.price == null || !(b.price > 0)) continue;
    if (!top || b.price > top.price || (b.price === top.price && b.id < top.id)) top = b;
  }
  return top;
}

/**
 * The outcome: after `until` the winner is the top bid when it meets the reserve (0 = any). Before `until` there is
 * no outcome (ended: false) even when the payment ran out: the auction is paused, not lost.
 */
export function auctionOutcome(a, bids, today) {
  const top = auctionTop(bids);
  const reserveMet = !!top && (!a.reserve || top.price >= a.reserve);
  const ended = day(a.until) <= day(today);
  return { ended, top, winner: ended && reserveMet ? top : null, reserveMet };
}

// A bid can be withdrawn while the auction is live and it does NOT lead: the leading bid is a promise others have
// answered (they stopped raising); withdrawn in the last hour it would end the auction on a bid it had beaten.
export const bidWithdrawable = (live, mine, top) => live && !!mine && bidAlive(mine) && (!top || top.id !== mine.id);

/**
 * The first locked offer key whose auction terms an edit changes (no auction after the edit, or another currency,
 * start, step, reserve or deadline); null when the edit keeps them. offers: [{ key, currency, mode?, auction }].
 * A bid is consent to the terms as they were: a seller must not move the deadline to today while "their" bid leads,
 * or raise the step to cut bidders off. Terms change after a round's outcome, as a new round.
 */
export function auctionTermsChanged(before, after, locked) {
  for (const key of locked || []) {
    const prev = (before || []).find((o) => o.key === key);
    const was = prev?.auction;
    if (!was) continue;
    const now = (after || []).find((o) => o.key === key);
    const na = now && (now.mode === undefined || now.mode === 'auction') ? now.auction : undefined;
    if (!na || String(now.currency || '') !== String(prev.currency || '') || na.start !== was.start
      || (na.step || 0) !== (was.step || 0) || (na.reserve || 0) !== (was.reserve || 0) || day(na.until) !== day(was.until)) return key;
  }
  return null;
}

// Terms for the public: start, step, until, the minimum next bid, the bid count and whether a reserve exists and is
// met - never the reserve itself.
export function publicTerms(a, bids) {
  const top = auctionTop(bids);
  return {
    start: a.start, step: a.step, until: a.until, top: top ? top.price : 0, next: nextBid(a, top ? top.price : 0),
    bids: (bids || []).filter((b) => bidAlive(b) && b.price > 0).length,
    hasReserve: !!a.reserve, reserveMet: !!top && (!a.reserve || top.price >= a.reserve),
  };
}

// Bids of the current round: those not settled yet or settled for this round's deadline (settledFor = until day).
export const roundBids = (bids, a) => (bids || []).filter((b) => !b.settledFor || b.settledFor === day(a.until));

/**
 * Settles the current round ONCE: the winner becomes 'chosen', the other bids still 'new' become 'declined', all get
 * settledFor = the until day. Returns { bids (a new list), settled: false } when the round has not ended or was
 * settled already (notifications must not go twice). A round without a winner (reserve not met) can be restarted
 * with a new deadline, and that round settles on its own.
 */
// Idempotency check: the round counts as settled when any of its bids already carries this round's settledFor with a
// final status - so a retried job (or two tabs) cannot settle twice. Bids are shallow-copied: the caller's array is
// never mutated, it persists the returned list.
export function settleBids(bids, a, today) {
  const r = day(a.until);
  const list = (bids || []).map((b) => ({ ...b }));
  const cur = roundBids(list, a);
  const out = auctionOutcome(a, cur, today);
  if (!out.ended || cur.some((b) => b.settledFor === r && (b.status === 'chosen' || b.status === 'declined'))) {
    return { bids: list, settled: false, winner: null };
  }
  const winId = out.winner ? out.winner.id : null;
  for (const b of cur) {
    if (b.status !== 'new' && b.status !== undefined) continue;
    b.status = b.id === winId ? 'chosen' : 'declined';
    b.settledFor = r;
  }
  return { bids: list, settled: true, winner: winId === null ? null : list.find((b) => b.id === winId) };
}

// Terms of a new round after an ended one (typically: the reserve was not met): the same start unless changed, a new
// deadline that must be later than the old one; null otherwise.
export function restartAuction(a, until, { start, step, reserve } = {}) {
  if (!a || !day(until) || day(until) <= day(a.until)) return null;
  return normalizeAuction({ start: start ?? a.start, step: step ?? a.step, reserve: reserve ?? a.reserve, until });
}
