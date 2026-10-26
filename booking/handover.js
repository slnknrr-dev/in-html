// booking/handover.js - handing a listing over to an intermediary (an agent or a managing company): the creator A
// ('from') offers the listing to B ('to'), B accepts or declines, A withdraws, an active handover is ended by either
// side. While a handover is active the listing is publicly B's: B's contacts, leads, bookings and accounts; A only
// watches. The rights B gets are chosen at handover time and checked at every editing door.
//
// Kinds: 'offer' (A offers, B answers), 'proposal' (a listing submitted to a closed section for its pinned manager;
// hidden from guests until accepted), 'binding' (a standing "A's listings here are always managed by B": B agreed
// once, so the handover is born active).
//
//   HANDOVER_KINDS, HANDOVER_STATUSES, HANDOVER_OPEN, HANDOVER_ACTIONS, HANDOVER_RIGHTS, *_I18N
//   isHandoverKind / isHandoverStatus / isHandoverAction / isHandoverRight, handoverIsOpen(status)
//   createHandover({ kind, from, to, rights, now }) -> record   handoverNext(status, action, side) -> status | null
//   handoverActions(status, side) -> actions   applyHandover(h, action, side, now) -> record | null
//   canReclaim({ sectionClosed, toIsPinned })   normalizeRights(raw, known?)   handoverManager(h)
//   handoverAllows(h, who, right) -> bool   rightOfKey(key, table) -> right | 'always' | 'never' | null
//   stateRight(to) -> 'sold' | 'archive' | null

export const HANDOVER_KINDS = ['offer', 'proposal', 'binding'];
export const isHandoverKind = (v) => HANDOVER_KINDS.includes(String(v ?? ''));

// 'offered' and 'active' are OPEN; a listing has at most one open handover at a time (enforce it with a unique
// index in storage, not a check before writing: two tabs pressing "hand over" at once would both pass a check).
export const HANDOVER_STATUSES = ['offered', 'active', 'declined', 'withdrawn', 'ended'];
export const isHandoverStatus = (v) => HANDOVER_STATUSES.includes(String(v ?? ''));
export const HANDOVER_OPEN = ['offered', 'active'];
export const handoverIsOpen = (s) => HANDOVER_OPEN.includes(String(s ?? ''));

export const HANDOVER_STATUS_I18N = {
  offered: { en: 'offered', ru: 'предложена', ka: 'შეთავაზებულია' },
  active: { en: 'active', ru: 'действует', ka: 'მოქმედებს' },
  declined: { en: 'declined', ru: 'отклонена', ka: 'უარყოფილია' },
  withdrawn: { en: 'withdrawn', ru: 'отозвана', ka: 'გამოთხოვილია' },
  ended: { en: 'ended', ru: 'закончена', ka: 'დასრულებულია' },
};
export const HANDOVER_KIND_I18N = {
  offer: { en: 'handover', ru: 'передача', ka: 'გადაცემა' },
  proposal: { en: 'listing proposal', ru: 'предложение-лот', ka: 'შეთავაზება-ლოტი' },
  binding: { en: 'by binding', ru: 'по привязке', ka: 'მიბმით' },
};

export const HANDOVER_ACTIONS = ['accept', 'decline', 'withdraw', 'end'];
export const isHandoverAction = (v) => HANDOVER_ACTIONS.includes(String(v ?? ''));

/**
 * Where an action of a side leads; null when that side has no such action.
 *   offered: B accepts or declines, A withdraws the offer;
 *   active:  either side ends it (B "gives back", A "takes back" - whether A may do it NOW is canReclaim).
 * Closed states go nowhere: "hand over again" is a new handover, the old one stays as a trace with its dates.
 */
export function handoverNext(status, action, side) {
  if (status === 'offered') {
    if (side === 'to' && action === 'accept') return 'active';
    if (side === 'to' && action === 'decline') return 'declined';
    if (side === 'from' && action === 'withdraw') return 'withdrawn';
    return null;
  }
  if (status === 'active' && action === 'end') return 'ended';
  return null;
}

// The actions a side has in a status (buttons).
export const handoverActions = (status, side) => HANDOVER_ACTIONS.filter((a) => handoverNext(status, a, side) !== null);

/**
 * A creator may NOT take the listing back while its section is closed and B is pinned there (the closed section
 * keeps the listing with its manager). B can always give it back - then the listing is hidden at A's, who may not
 * publish in a closed section.
 */
export const canReclaim = (o) => !(o.sectionClosed && o.toIsPinned);

// --- rights -----------------------------------------------------------------------------------------------------

/**
 * Rights given at handover time, in display order. 'listing' is the whole listing form (fields, features, address,
 * prices, photos, rooms): the form is saved by ONE request, and "features without the title" would be a form that
 * cannot be saved. Deleting a listing is never a right: only the creator does it, after the handover ended.
 */
export const HANDOVER_RIGHTS = ['listing', 'contacts', 'bump', 'sold', 'archive'];
export const isHandoverRight = (v) => HANDOVER_RIGHTS.includes(String(v ?? ''));
export const HANDOVER_RIGHT_I18N = {
  listing: { en: 'The whole listing: fields, features, address, prices, photos, rooms', ru: 'Объявление целиком: поля, характеристики, адрес, цены, фото, помещения', ka: 'განცხადება მთლიანად: ველები, მახასიათებლები, მისამართი, ფასები, ფოტოები, ოთახები' },
  contacts: { en: 'Listing contacts', ru: 'Контакты объявления', ka: 'განცხადების კონტაქტები' },
  bump: { en: 'Bump in results', ru: 'Поднимать в выдаче', ka: 'ძიებაში აწევა' },
  sold: { en: 'Mark as sold', ru: 'Отмечать «продано»', ka: '«გაყიდულის» მონიშვნა' },
  archive: { en: 'Archive and restore', ru: 'Снимать в архив и возвращать', ka: 'არქივში გადატანა და აღდგენა' },
};

// Rights from input: known ones only, no repeats, in canonical order (two equal lists must read as equal).
export function normalizeRights(raw, known = HANDOVER_RIGHTS) {
  const got = new Set((Array.isArray(raw) ? raw : []).map((x) => String(x ?? '')));
  return known.filter((r) => got.has(r));
}

/**
 * The right an editing key (a door, a form block, a card binding) requires, from an application table
 * { key: right | 'always' | 'never' }: 'always' = shown to anybody who edits the listing at all (status, history,
 * the handover itself, bookings - their own doors decide), 'never' = never for an intermediary. Unknown keys are
 * 'never': an unknown block is not shown, an unknown door is not opened. A '@lang' suffix (title@en) is ignored.
 */
// hasOwnProperty, not `key in table` / table[key]: keys like 'constructor' or '__proto__' must not resolve to
// Object.prototype members and grant something by accident (deny-by-default holds for every string).
export function rightOfKey(key, table) {
  const k = String(key ?? '').trim().replace(/@[a-z]{2,3}$/, '');
  const v = table && Object.prototype.hasOwnProperty.call(table, k) ? table[k] : 'never';
  return v === 'always' || v === 'never' || isHandoverRight(v) ? v : 'never';
}

// The right a listing state change requires: to 'sold' -> 'sold', to 'archived' / 'active' -> 'archive', anything
// else (hiding is moderation) -> null.
export function stateRight(to) {
  const t = String(to ?? '');
  if (t === 'sold') return 'sold';
  if (t === 'archived' || t === 'active') return 'archive';
  return null;
}

// --- records ----------------------------------------------------------------------------------------------------

const iso = (now) => (typeof now === 'number' ? new Date(now).toISOString() : String(now || ''));

/**
 * A new handover record { kind, from, to, rights, status, createdAt, decidedAt, decidedBy }; null for an invalid kind
 * or a handover to oneself. A binding is born 'active' (B agreed when the binding was made).
 */
export function createHandover({ kind = 'offer', from, to, rights = [], now } = {}) {
  const a = String(from ?? '').trim(), b = String(to ?? '').trim();
  if (!isHandoverKind(kind) || !a || !b || a === b) return null;
  const at = iso(now);
  const active = kind === 'binding';
  return {
    kind, from: a, to: b, rights: normalizeRights(rights), status: active ? 'active' : 'offered',
    createdAt: at, decidedAt: active ? at : '', decidedBy: active ? b : '',
  };
}

// The record after `side` performed `action`, or null when not allowed; the record is not modified.
export function applyHandover(h, action, side, now) {
  const next = h && handoverNext(h.status, action, side);
  if (!next) return null;
  return { ...h, status: next, decidedAt: iso(now), decidedBy: side === 'to' ? h.to : h.from };
}

// Who manages the listing now: B while the handover is active, else A.
export const handoverManager = (h) => (h && h.status === 'active' ? h.to : h ? h.from : '');

/**
 * May `who` use `right` on the listing: the creator always while no handover is active (and only watches while it
 * is); the intermediary only while it is active and the right was given. 'always' / 'never' answer the same way for
 * both sides as their names say (for the creator during an active handover 'always' means "may look").
 */
// Pure decision function: identities are compared as plain strings, so the caller must pass the AUTHENTICATED user
// id, never a value from the request body - this function cannot tell the difference.
export function handoverAllows(h, who, right) {
  if (!h || !who) return false;
  if (right === 'never') return who === h.from && h.status !== 'active';
  const active = h.status === 'active';
  if (who === h.from) return !active || right === 'always';
  if (who === h.to) return active && (right === 'always' || (h.rights || []).includes(right));
  return false;
}
