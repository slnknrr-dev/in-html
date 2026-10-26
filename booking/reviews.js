// booking/reviews.js - reputation of a face (a host, an agency, a guest, a worker): mutual reviews allowed only
// after a completed deal, hidden in a BLIND window until both sides reviewed or the window passed, stars with the
// vote count, the job count (deals, not reviews) and the median reply speed, folded into a short line.
//
// Why blind: mutual reviews invite revenge - a client gives one star, the host sees it and answers with one star; a
// month later everybody gives "safe" fours and the rating means nothing. Hidden until both are in, there is nothing
// to revenge. The window is REQUIRED: without it one side buries the other's review by never answering. Visibility
// is a function of `now` asked at display time, never a flag set by a nightly job (which lies until it runs).
//
//   FACE_NS, faceKey({ ns, id }) -> 'ns:id'   parseFaceKey(s)   sameFace(a, b)
//   REVIEW_SRC, REVIEW_ROLES, BLIND_DAYS = 14, cleanStars(v), reviewRevealed(r, now, blindDays?)
//   canReview({ face, by, hasDeal, already }) -> { ok, reason: '' | code }   REVIEW_REASON_TEXT
//   submitReview(list, review, now) -> list   (one review per deal and author; the second side reveals both)
//   averageStars(values)   replySpeedMinutes(gaps)   faceRep(reviews, { face, jobs, gaps, now }) -> FaceRep
//   EMPTY_REP, REP_WORDS, replySpeedText(min, lang)   repLine(rep, lang) -> string[]   plural(n, one, few, many)

// Two namespaces of faces: an organisation record ('seller') and a plain account ('user'). The namespace is part of
// the key: an organisation 'webmaster' and the user 'webmaster' are different faces, and without it reviews would
// leak between them.
export const FACE_NS = ['seller', 'user'];

export const faceKey = (f) => `${f.ns}:${f.id}`;

// Parses 'ns:id'; an unknown namespace is null (not "probably a user"). User ids are case-insensitive.
export function parseFaceKey(s) {
  const [ns, ...rest] = String(s ?? '').split(':');
  const id = rest.join(':').trim();
  if (!id || !FACE_NS.includes(ns)) return null;
  return { ns, id: ns === 'user' ? id.toLowerCase() : id };
}

export const sameFace = (a, b) => !!a && !!b && a.ns === b.ns && a.id === b.id;

// The deal trace that gives the right to review: a completed bid (a job) or a completed order.
export const REVIEW_SRC = ['bid', 'order'];
// The role the reviewer acted in: "reviewed as a client" and "as a worker" are different statements about one face.
export const REVIEW_ROLES = ['client', 'worker'];

export const BLIND_DAYS = 14;
const DAY_MS = 864e5;

// Stars 1..5; anything else is 0 = "no rating" (a refusal, not "let us say three").
export const cleanStars = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 0;
};

const ms = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(String(t || '')));

// Is a review visible at `now` (Date, ms or ISO): revealed by the other side, or the blind window has passed.
export function reviewRevealed(r, now, blindDays = BLIND_DAYS) {
  if (String(r.revealedAt || '')) return true;
  const t = ms(r.createdAt);
  return Number.isFinite(t) && ms(now) - t >= blindDays * DAY_MS;
}

export const REVIEW_REASON_TEXT = {
  no_account: 'Sign in to leave a review.',
  self: 'You cannot review yourself.',
  no_deal: 'Only a party to a completed deal (a finished job or order) can leave a review.',
  already: 'You already reviewed this deal - you can edit your review.',
};

/**
 * The right to review: { ok, reason } with a reason code for REVIEW_REASON_TEXT. "Not yourself" compares FACES, not
 * logins; an owner reviewing their own agency is stopped by the missing deal (nobody deals with oneself).
 */
export function canReview(ctx) {
  if (!ctx.face || !ctx.by) return { ok: false, reason: 'no_account' };
  if (sameFace(ctx.face, ctx.by)) return { ok: false, reason: 'self' };
  if (!ctx.hasDeal) return { ok: false, reason: 'no_deal' };
  if (ctx.already) return { ok: false, reason: 'already' };
  return { ok: true, reason: '' };
}

const sameDeal = (a, b) => a.src === b.src && String(a.srcId) === String(b.srcId);

/**
 * Stores a review in a list (a new list is returned): one review per deal (src, srcId) and author face, an edit
 * replaces the stars and text but keeps createdAt and revealedAt (an edit must not hide what was already seen). When
 * the counterpart's review of the same deal exists, BOTH are revealed at `now`.
 * review: { face, by (face keys as strings), src, srcId, role, stars, text }
 */
// An invalid star value returns an unchanged COPY rather than throwing: the caller always gets a list it may store,
// and a review without stars simply does not exist. Counterpart lookup swaps face/by: their review is BY my face.
export function submitReview(list, review, now) {
  const at = typeof now === 'number' ? new Date(now).toISOString() : now instanceof Date ? now.toISOString() : String(now);
  const stars = cleanStars(review.stars);
  if (!stars) return list.slice();
  const out = list.map((r) => ({ ...r }));
  let mine = out.find((r) => sameDeal(r, review) && r.by === review.by && r.face === review.face);
  if (mine) Object.assign(mine, { stars, text: String(review.text || ''), role: review.role, updatedAt: at });
  else {
    mine = { ...review, stars, text: String(review.text || ''), createdAt: at, revealedAt: '' };
    out.push(mine);
  }
  const other = out.find((r) => sameDeal(r, review) && r.by === review.face && r.face === review.by);
  if (other) {
    if (!other.revealedAt) other.revealedAt = at;
    if (!mine.revealedAt) mine.revealedAt = at;
  }
  return out;
}

// --- folding into a line ----------------------------------------------------------------------------------------

/**
 * What a card knows about a face: three independent numbers. `jobs` counts DEALS, not reviews (a silent happy client
 * is a job without a review, so "4.8 (3) - 63 jobs" is the usual truth). `replyMin` is null, not 0, for "unknown":
 * zero would mean "replies instantly" and a newcomer would look best.
 */
export const EMPTY_REP = { stars: 0, votes: 0, jobs: 0, replyMin: null };

// Mean with one decimal; 0 without votes (the reader must look at `votes`, not the star).
export function averageStars(values) {
  const ok = (values || []).map((v) => cleanStars(v)).filter(Boolean);
  if (!ok.length) return 0;
  return Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 10) / 10;
}

// MEDIAN reply time in minutes, not the mean: one two-week holiday turns a ten-minute mean into hours, the median
// survives the outlier. null for no data.
export function replySpeedMinutes(gaps) {
  const ok = (gaps || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!ok.length) return null;
  const mid = ok.length >> 1;
  return ok.length % 2 ? ok[mid] : Math.round((ok[mid - 1] + ok[mid]) / 2);
}

/**
 * The reputation of `face` (key string) from reviews [{ face, stars, createdAt, revealedAt }]: only reviews visible
 * at `now` count (otherwise the blind window would only be about display); jobs and reply gaps come from the caller.
 */
export function faceRep(reviews, { face, jobs = 0, gaps = [], now, blindDays = BLIND_DAYS } = {}) {
  const seen = (reviews || []).filter((r) => (face === undefined || r.face === face) && reviewRevealed(r, now, blindDays));
  const stars = seen.map((r) => cleanStars(r.stars)).filter(Boolean);
  return { stars: averageStars(stars), votes: stars.length, jobs: Math.max(0, Math.trunc(jobs) || 0), replyMin: replySpeedMinutes(gaps) };
}

// Words of the reputation line; {n} is the number's place (word order differs between languages).
export const REP_WORDS = {
  en: { now: 'replies instantly', min: 'replies in ~{n} min', h: 'replies in ~{n} h', d: 'replies in ~{n} d', novice: 'newcomer', jobs: { one: '{n} job done', other: '{n} jobs done' } },
  ru: { now: 'отвечает сразу', min: 'отвечает ~{n} мин', h: 'отвечает ~{n} ч', d: 'отвечает ~{n} дн', novice: 'новичок', jobs: { one: '{n} работа', few: '{n} работы', many: '{n} работ' } },
  ka: { now: 'პასუხობს მაშინვე', min: 'პასუხობს ~{n} წთ-ში', h: 'პასუხობს ~{n} სთ-ში', d: 'პასუხობს ~{n} დღეში', novice: 'ახალბედა', jobs: { other: '{n} სამუშაო' } },
};

const repWords = (lang) => {
  const code = String(lang || 'en').toLowerCase();
  return REP_WORDS[code] || REP_WORDS[code.split('-')[0]] || REP_WORDS.en;
};

// Russian plural form by number (1 работа, 2 работы, 5 работ, 11 работ, 21 работа).
export function plural(n, one, few, many) {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function jobsText(n, lang) {
  const w = repWords(lang).jobs;
  const form = w.few ? plural(n, w.one, w.few, w.many) : n === 1 && w.one ? w.one : w.other;
  return form.replace('{n}', String(n));
}

// '~20 min' / '~3 h' / '~2 d'; under a minute is "instantly" ('~0 min' reads as a bug); '' when unknown.
export function replySpeedText(min, lang = 'en') {
  if (min == null) return '';
  const w = repWords(lang);
  if (min < 1) return w.now;
  if (min < 90) return w.min.replace('{n}', String(Math.round(min)));
  if (min < 60 * 36) return w.h.replace('{n}', String(Math.round(min / 60)));
  return w.d.replace('{n}', String(Math.round(min / 1440)));
}

/**
 * The metric line: empty parts are OMITTED ("0.0 (0)" reads as bad work while it means "no work yet"), and a
 * newcomer gets its own word instead of an empty line (half of the cards without a line look broken).
 */
export function repLine(r, lang = 'en') {
  const out = [];
  if (r.votes) out.push(`★ ${r.stars.toFixed(1)} (${r.votes})`);
  if (r.jobs) out.push(jobsText(r.jobs, lang));
  const speed = replySpeedText(r.replyMin, lang);
  if (speed) out.push(speed);
  return out.length ? out : [repWords(lang).novice];
}
