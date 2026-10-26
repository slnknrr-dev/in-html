// durak/ruleset.js - data-driven rulesets of the card game Durak: deck definitions (suits, colours, ranks, generated
// card sets with copies, custom cards with their own codes, names, art and rules), card rules (trump behaviour,
// colour- or suit-bound wildcards, extra ranks, explicit beat / beaten-by relations and restrictions, play flags),
// global beat rules, rank equivalence groups and the game rules (hand size, trump, throw-in, limits, transfers,
// teams, ...). A ruleset is plain JSON so that players can create, export, import and share their own versions.
//
//   normalizeRuleset(raw) -> ruleset         defaults filled, card definitions expanded (defs), hash computed
//   validateRuleset(raw)  -> { ok, errors: [{ path, msg }], warnings: [...] }
//   compile(ruleset)      -> C               cached lookup tables: uid -> definition, beat / match matrices per
//                                            trump suit, trump tiers, play flags (the engine and bots use these)
//   rulesetHash(raw)      -> 'a1b2c3d4'      SHA-256 of the canonical game-relevant content (names and art excluded)
//   matchCard(matcher, def, self) -> bool    matcher semantics (README.md)
//   playerRange(ruleset)  -> { min, max }
//
// Card rules (per card definition, or applied to every card matching `rules.cardRules[i].match`):
//   trump: 'suit' | 'always' | 'never'   tier: n (trump tier of 'always' cards)   value: n (comparison value)
//   wild: null | 'color' | 'suit' | 'any'   counts as every rank of its colour / suit / of the deck for throw-ins,
//                                           transfers and multi-card leads; it never breaks the uniformity of a
//                                           transfer (wildcards are ignored when ranks are compared)
//   rankAs: [rank ids]                      extra ranks the card counts as
//   beats / beatenBy: [matcher]             extra relations (this card beats / is beaten by matching cards)
//   beatsOnly / beatenOnlyBy: matcher       restrictions ({ none: true } = never)
//   noLead, noThrow, noTransfer, noDefend   play flags      closesBout: after it beats a card nothing more is thrown in
// Matchers: { id, rank, suit, color, trump, wild, not, any: [m...] } where values are a string or a list; the value
// '=' means "the same as the card that owns the rule" (a joker's { color: '=' } is its own colour).

import { sha256 } from '../crypto/sha2.js';
import { utf8ToBytes } from '../crypto/encoding.js';

//
// Design: every Durak variant (podkidnoy, perevodnoy, jokers, eternal trumps, house rules) is data interpreted by
// one engine. The expensive interpretation (matchers, beat rules, card rules) happens once in compile() into dense
// D x D lookup tables per possible trump suit, so the engine's hot path (canBeat during bot search) is a single
// array read. normalizeRuleset clamps numbers and enums; matchers are kept as data and only ever compared, never
// evaluated as code, so a shared ruleset cannot execute anything.
export const FORMAT = 'durak-ruleset';
export const VERSION = 1;

export const STD_COLORS = [
  { id: 'red', name: 'Red', css: '#c62828' },
  { id: 'black', name: 'Black', css: '#1a1a1a' },
];
export const STD_SUITS = [
  { id: 'S', name: 'Spades', symbol: '♠', color: 'black' },
  { id: 'C', name: 'Clubs', symbol: '♣', color: 'black' },
  { id: 'D', name: 'Diamonds', symbol: '♦', color: 'red' },
  { id: 'H', name: 'Hearts', symbol: '♥', color: 'red' },
];
export const STD_RANKS = [
  { id: '2', name: 'Two', value: 2 },
  { id: '3', name: 'Three', value: 3 },
  { id: '4', name: 'Four', value: 4 },
  { id: '5', name: 'Five', value: 5 },
  { id: '6', name: 'Six', value: 6 },
  { id: '7', name: 'Seven', value: 7 },
  { id: '8', name: 'Eight', value: 8 },
  { id: '9', name: 'Nine', value: 9 },
  { id: 'T', name: 'Ten', value: 10, label: '10' },
  { id: 'J', name: 'Jack', value: 11 },
  { id: 'Q', name: 'Queen', value: 12 },
  { id: 'K', name: 'King', value: 13 },
  { id: 'A', name: 'Ace', value: 14 },
  { id: 'X', name: 'Joker', value: 15, label: '★' },
];
export const RANKS_36 = ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const RANKS_52 = ['2', '3', '4', '5', ...RANKS_36];
export const RANKS_24 = ['9', 'T', 'J', 'Q', 'K', 'A'];
export const SUIT_IDS = ['S', 'C', 'D', 'H'];

// Default game rules (classic podkidnoy durak, 36 cards).
// Defaults reproduce classic podkidnoy: lowest trump leads, everyone may throw in, 6-card bouts (5 in the first).
export const DEFAULT_RULES = {
  minPlayers: 2,
  maxPlayers: 6,
  handSize: 6,
  trump: 'bottom',          // 'bottom' (the bottom card of the stock is shown), 'random' (a random suit, no card),
                            // 'none', or a suit id (fixed trump suit)
  eternal: [],              // suits that are always trump ("eternal trump"), above the drawn trump (eternalTier)
  eternalTier: 2,
  trumpCross: true,         // trumps of the same tier but different suits compare by value
  trumpExchange: false,     // the holder of the lowest trump may swap it for the open trump card
  first: 'lowestTrump',     // 'lowestTrump' | 'random' | 'seat0' (who leads the first bout)
  throwIn: 'all',           // 'all' | 'neighbors' (the defender's two neighbours) | 'attacker' (only the attacker)
  boutLimit: 6,             // cards per bout (0 = unlimited)
  firstBoutLimit: 5,        // cards in the first bout (0 = same as boutLimit)
  limitByHand: true,        // unbeaten cards never exceed the defender's hand
  leadMulti: true,          // the attacker may lead several cards of one rank at once
  transfer: false,          // perevodnoy: the defender may pass the attack on with cards of the same rank
  transferShow: false,      // transfer by showing a trump of that rank (the card stays in hand)
  throwAfterTake: true,     // attackers may throw more cards in after the defender decided to take
  teams: 0,                 // 0, or the number of teams (seat i plays for team i % teams)
  direction: 1,             // 1 = clockwise (to the next seat), -1 = counter-clockwise
  pogony: false,            // "epaulettes": the durak gets pogony when the final bout was led with the lowest rank
  rankGroups: [],           // [[rank ids]] ranks that count as one rank for throw-ins and transfers (6 ~ 9)
  beatRules: [],            // [{ by: matcher, beats: matcher, same: null | 'suit' | 'color' | 'card', deny?: true }]
  cardRules: [],            // [{ match: matcher, set: { card rules } }] applied to every matching card definition
};

const CARD_RULE_KEYS = ['trump', 'tier', 'value', 'wild', 'rankAs', 'beats', 'beatenBy', 'beatsOnly', 'beatenOnlyBy',
  'noLead', 'noThrow', 'noTransfer', 'noDefend', 'closesBout'];
const FLAG_KEYS = ['noLead', 'noThrow', 'noTransfer', 'noDefend', 'closesBout'];

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v, d, lo = -Infinity, hi = Infinity) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const oneOf = (v, opts, d) => (opts.includes(v) ? v : d);
// Card codes are short and URL-safe because uids/codes appear in logs and notation.
const CODE_RE = /^[A-Za-z0-9_*]{1,6}$/;

// Text of a name field: a string or { en, ru, ... } (lang falls back to en, then any).
export function textOf(v, lang = 'en') {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (isObj(v)) return v[lang] ?? v[String(lang).split('-')[0]] ?? v.en ?? Object.values(v)[0] ?? '';
  return String(v);
}

// --- deck ------------------------------------------------------------------------------------------------------

// KNOWN DEFECT (robustness): the numbers of suits, ranks and custom cards are not capped, while compile() allocates
// D x D tables for each of (suits + 1) trump keys and matchers may nest any/not without depth limit. A crafted
// shared ruleset can therefore exhaust memory or the call stack. Fix: cap deck.suits/ranks/cards lengths (e.g.
// 16/32/64) and matcher nesting depth during normalisation.
function normDeck(raw) {
  const d = isObj(raw) ? raw : {};
  const colors = (Array.isArray(d.colors) && d.colors.length ? d.colors : STD_COLORS).filter(isObj)
    .map((c) => ({ id: String(c.id), name: c.name ?? String(c.id), css: typeof c.css === 'string' ? c.css : '' }));
  const suits = (Array.isArray(d.suits) && d.suits.length ? d.suits : STD_SUITS).filter(isObj)
    .map((s) => ({ id: String(s.id), name: s.name ?? String(s.id), symbol: String(s.symbol ?? s.id), color: s.color != null ? String(s.color) : null, art: s.art ?? null }));
  const ranks = (Array.isArray(d.ranks) && d.ranks.length ? d.ranks : STD_RANKS).filter(isObj)
    .map((r) => ({ id: String(r.id), name: r.name ?? String(r.id), label: r.label != null ? String(r.label) : String(r.id), value: num(r.value, 0) }));
  const sets = (Array.isArray(d.sets) ? d.sets : [{ ranks: RANKS_36, suits: SUIT_IDS, copies: 1 }]).filter(isObj).map((s) => ({
    ranks: s.ranks === 'all' ? ranks.filter((r) => r.id !== 'X').map((r) => r.id) : list(s.ranks).map(String),
    suits: s.suits === 'all' ? suits.map((x) => x.id) : list(s.suits).map(String),
    copies: num(s.copies, 1, 0, 8) | 0,
  }));
  const cards = (Array.isArray(d.cards) ? d.cards : []).filter(isObj).map((c) => ({
    id: String(c.id ?? ''),
    name: c.name ?? null,
    label: c.label != null ? String(c.label) : null,
    rank: c.rank != null && c.rank !== '' ? String(c.rank) : null,
    suit: c.suit != null && c.suit !== '' ? String(c.suit) : null,
    color: c.color != null && c.color !== '' ? String(c.color) : null,
    copies: num(c.copies, 1, 0, 16) | 0,
    art: c.art ?? null,
    rules: isObj(c.rules) ? clone(c.rules) : {},
    note: c.note ?? null,
  }));
  return { colors, suits, ranks, sets, cards };
}

function normCardRules(r) {
  const o = {};
  const src = isObj(r) ? r : {};
  o.trump = oneOf(src.trump, ['suit', 'always', 'never'], 'suit');
  if (src.tier != null) o.tier = num(src.tier, 2, 1, 9);
  if (src.value != null) o.value = num(src.value, 0);
  o.wild = oneOf(src.wild, ['color', 'suit', 'any'], null);
  o.rankAs = list(src.rankAs).map(String);
  o.beats = list(src.beats).filter(isObj).map(clone);
  o.beatenBy = list(src.beatenBy).filter(isObj).map(clone);
  o.beatsOnly = isObj(src.beatsOnly) ? clone(src.beatsOnly) : null;
  o.beatenOnlyBy = isObj(src.beatenOnlyBy) ? clone(src.beatenOnlyBy) : null;
  for (const k of FLAG_KEYS) o[k] = !!src[k];
  return o;
}

// Merges card rules: later keys override; list keys are concatenated.
// Relation lists (rankAs, beats, beatenBy) accumulate across global card rules and the card's own rules, because
// they are additive by nature; scalar rules (trump, value, flags) are overridden by the more specific source.
function mergeCardRules(base, add) {
  const o = { ...base };
  for (const k of CARD_RULE_KEYS) {
    if (add[k] === undefined) continue;
    if (k === 'rankAs' || k === 'beats' || k === 'beatenBy') o[k] = [...list(base[k]), ...list(add[k])];
    else o[k] = add[k];
  }
  return o;
}

// Card definitions of a deck: generated sets (rank × suit, copies summed) then the custom cards.
// Definitions, not physical cards: identical cards (multi-deck copies) share one definition with copies > 1, so the
// tables are D x D in distinct definitions, not N x N in cards (a 3-deck game has N = 108 but D = 36).
// A custom card with the code of a generated card adds copies instead of creating a conflicting definition.
function expandDefs(deck, rules) {
  const rankOf = new Map(deck.ranks.map((r) => [r.id, r]));
  const suitOf = new Map(deck.suits.map((s) => [s.id, s]));
  const defs = [];
  const byCode = new Map();
  for (const set of deck.sets) {
    for (const s of set.suits) {
      for (const r of set.ranks) {
        if (!rankOf.has(r) || !suitOf.has(s) || set.copies < 1) continue;
        const code = r + s.toLowerCase();
        const have = byCode.get(code);
        if (have) { have.copies += set.copies; continue; }
        const def = { code, name: null, label: null, rank: r, suit: s, color: suitOf.get(s).color, copies: set.copies, art: null, custom: false, rules: {} };
        byCode.set(code, def);
        defs.push(def);
      }
    }
  }
  for (const c of deck.cards) {
    if (c.copies < 1) continue;
    const suit = c.suit && suitOf.has(c.suit) ? c.suit : null;
    const def = {
      code: c.id, name: c.name, label: c.label, rank: c.rank && rankOf.has(c.rank) ? c.rank : null, suit,
      color: c.color ?? (suit ? suitOf.get(suit).color : null), copies: c.copies, art: c.art, custom: true, rules: c.rules, note: c.note,
    };
    if (byCode.has(def.code)) { byCode.get(def.code).copies += def.copies; continue; }
    byCode.set(def.code, def);
    defs.push(def);
  }
  // Card rules: global matchers first, then the card's own rules on top.
  for (const def of defs) {
    let r = {};
    for (const cr of rules.cardRules) if (matchCard(cr.match, def, def)) r = mergeCardRules(r, isObj(cr.set) ? cr.set : {});
    def.rules = normCardRules(mergeCardRules(r, def.rules || {}));
    const rk = def.rank ? rankOf.get(def.rank) : null;
    def.value = def.rules.value ?? (rk ? rk.value : 0);
  }
  return defs;
}

// --- rules -----------------------------------------------------------------------------------------------------

function normRules(raw, deck) {
  const r = isObj(raw) ? raw : {};
  const D = DEFAULT_RULES;
  const suitIds = deck.suits.map((s) => s.id);
  const o = {};
  o.minPlayers = num(r.minPlayers, D.minPlayers, 2, 12) | 0;
  o.maxPlayers = Math.max(o.minPlayers, num(r.maxPlayers, D.maxPlayers, 2, 12) | 0);
  o.handSize = num(r.handSize, D.handSize, 1, 20) | 0;
  o.trump = r.trump === 'bottom' || r.trump === 'random' || r.trump === 'none' || suitIds.includes(r.trump) ? r.trump : D.trump;
  o.eternal = list(r.eternal).map(String).filter((s) => suitIds.includes(s));
  o.eternalTier = num(r.eternalTier, D.eternalTier, 1, 9) | 0;
  o.trumpCross = r.trumpCross !== undefined ? !!r.trumpCross : D.trumpCross;
  o.trumpExchange = !!r.trumpExchange;
  o.first = oneOf(r.first, ['lowestTrump', 'random', 'seat0'], D.first);
  o.throwIn = oneOf(r.throwIn, ['all', 'neighbors', 'attacker'], D.throwIn);
  o.boutLimit = num(r.boutLimit, D.boutLimit, 0, 99) | 0;
  o.firstBoutLimit = num(r.firstBoutLimit, D.firstBoutLimit, 0, 99) | 0;
  o.limitByHand = r.limitByHand !== undefined ? !!r.limitByHand : D.limitByHand;
  o.leadMulti = r.leadMulti !== undefined ? !!r.leadMulti : D.leadMulti;
  o.transfer = !!r.transfer;
  o.transferShow = !!r.transferShow && o.transfer;
  o.throwAfterTake = r.throwAfterTake !== undefined ? !!r.throwAfterTake : D.throwAfterTake;
  o.teams = num(r.teams, 0, 0, 6) | 0;
  if (o.teams === 1) o.teams = 0;
  o.direction = r.direction === -1 ? -1 : 1;
  o.pogony = !!r.pogony;
  o.rankGroups = list(r.rankGroups).filter(Array.isArray).map((g) => g.map(String)).filter((g) => g.length > 1);
  o.beatRules = list(r.beatRules).filter(isObj).map((b) => ({
    by: isObj(b.by) ? clone(b.by) : {}, beats: isObj(b.beats) ? clone(b.beats) : {},
    same: oneOf(b.same, ['suit', 'color', 'card', 'rank'], null), deny: !!b.deny,
  }));
  o.cardRules = list(r.cardRules).filter((c) => isObj(c) && isObj(c.match)).map((c) => ({ match: clone(c.match), set: isObj(c.set) ? clone(c.set) : {} }));
  return o;
}

// Idempotence shortcut for already normalised objects (hot paths). KNOWN DEFECT (security), as in
// battleship/ruleset.js: the shortcut trusts the object's own format/defs/hash/normalized fields, so a crafted
// ruleset from room settings skips every clamp. Fix: recognise only objects this module produced (module-private
// WeakSet) or recompute and compare the hash.
export function normalizeRuleset(raw) {
  const src = isObj(raw) ? raw : {};
  if (src.format === FORMAT && src.defs && src.hash && src.normalized === VERSION) return src;
  const deck = normDeck(src.deck);
  const rules = normRules(src.rules, deck);
  const rs = {
    format: FORMAT, v: VERSION, normalized: VERSION,
    id: String(src.id || 'custom').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 64) || 'custom',
    name: src.name ?? 'Custom durak',
    description: src.description ?? '',
    author: src.author ?? '',
    tags: list(src.tags).map(String),
    exclusive: !!src.exclusive,
    deck, rules,
    skin: isObj(src.skin) ? src.skin : null,
  };
  rs.defs = expandDefs(deck, rules);
  rs.cardCount = rs.defs.reduce((n, d) => n + d.copies, 0);
  rs.hash = rulesetHash(rs);
  return rs;
}

// The game-relevant content (no names, descriptions, art): two rulesets with the same hash play the same game.
// cardRules are excluded from the hash because their effect is already materialised in each def's rules; including
// both would make two equivalent formulations (global rule vs per-card rule) hash differently.
export function canonicalContent(raw) {
  const deck = normDeck(raw.deck);
  const rules = normRules(raw.rules, deck);
  const defs = expandDefs(deck, rules);
  return {
    suits: deck.suits.map((s) => [s.id, s.color]),
    ranks: deck.ranks.map((r) => [r.id, r.value]),
    defs: defs.map((d) => [d.code, d.rank, d.suit, d.color, d.copies, d.value, sortKeys(d.rules)]),
    rules: sortKeys({ ...rules, cardRules: undefined }),
  };
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isObj(v)) return v;
  const o = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = sortKeys(v[k]);
  return o;
}

// 32-bit identifier (8 hex chars of SHA-256): for caching and matching records, not for authentication.
export function rulesetHash(raw) {
  const bytes = sha256(utf8ToBytes(JSON.stringify(canonicalContent(raw))));
  let s = '';
  for (let i = 0; i < 4; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// Smallest and largest player counts the deck allows.
// Max players is also bounded by the deck: every player needs a full first hand.
export function playerRange(rs) {
  const r = rs.rules;
  const byDeck = Math.floor(rs.cardCount / Math.max(1, r.handSize));
  let max = Math.min(r.maxPlayers, byDeck);
  let min = r.minPlayers;
  if (r.teams) {
    min = Math.max(min, r.teams * 2);
    while (max >= min && max % r.teams) max--;
  }
  return { min, max: Math.max(min, max) };
}

// --- validation ------------------------------------------------------------------------------------------------

export function validateRuleset(raw) {
  const errors = [], warnings = [];
  const err = (path, msg) => errors.push({ path, msg });
  const warn = (path, msg) => warnings.push({ path, msg });
  if (!isObj(raw)) return { ok: false, errors: [{ path: '', msg: 'not an object' }], warnings };
  let rs;
  try { rs = normalizeRuleset({ ...raw, normalized: undefined, defs: undefined }); } catch (e) { return { ok: false, errors: [{ path: '', msg: String(e.message || e) }], warnings }; }
  const { deck, rules, defs } = rs;
  const uniq = (arr, path, what) => {
    const seen = new Set();
    arr.forEach((x, i) => { if (seen.has(x)) err(`${path}[${i}]`, `duplicate ${what} "${x}"`); seen.add(x); });
  };
  uniq(deck.suits.map((s) => s.id), 'deck.suits', 'suit id');
  uniq(deck.ranks.map((r) => r.id), 'deck.ranks', 'rank id');
  uniq(deck.colors.map((c) => c.id), 'deck.colors', 'colour id');
  const colorIds = new Set(deck.colors.map((c) => c.id));
  const rankIds = new Set(deck.ranks.map((r) => r.id));
  const suitIds = new Set(deck.suits.map((s) => s.id));
  deck.suits.forEach((s, i) => { if (s.color && !colorIds.has(s.color)) warn(`deck.suits[${i}].color`, `unknown colour "${s.color}"`); });
  deck.sets.forEach((s, i) => {
    for (const r of s.ranks) if (!rankIds.has(r)) err(`deck.sets[${i}].ranks`, `unknown rank "${r}"`);
    for (const x of s.suits) if (!suitIds.has(x)) err(`deck.sets[${i}].suits`, `unknown suit "${x}"`);
  });
  const generated = new Set();
  for (const s of deck.sets) for (const x of s.suits) for (const r of s.ranks) generated.add(r + x.toLowerCase());
  const customIds = new Set();
  deck.cards.forEach((c, i) => {
    if (!CODE_RE.test(c.id)) err(`deck.cards[${i}].id`, 'card code must be 1-6 letters, digits, _ or *');
    if (generated.has(c.id)) warn(`deck.cards[${i}].id`, `code "${c.id}" is also a generated card: the copies are added to it`);
    if (customIds.has(c.id)) warn(`deck.cards[${i}].id`, `code "${c.id}" repeats: the copies are added`);
    customIds.add(c.id);
    if (c.rank && !rankIds.has(c.rank)) err(`deck.cards[${i}].rank`, `unknown rank "${c.rank}"`);
    if (c.suit && !suitIds.has(c.suit)) err(`deck.cards[${i}].suit`, `unknown suit "${c.suit}"`);
    if (c.color && !colorIds.has(c.color)) warn(`deck.cards[${i}].color`, `unknown colour "${c.color}"`);
    if (!c.rank && !c.suit && !(c.rules && (c.rules.wild || c.rules.beats || c.rules.trump === 'always'))) warn(`deck.cards[${i}]`, 'a card without rank and suit can only beat or be thrown in through its own rules');
  });
  if (rs.cardCount < 2) err('deck', 'the deck needs at least 2 cards');
  const pr = playerRange(rs);
  if (rs.cardCount < rules.minPlayers * rules.handSize) err('rules.handSize', `${rs.cardCount} cards are not enough for ${rules.minPlayers} players with ${rules.handSize} cards`);
  if (pr.max < pr.min) err('rules.maxPlayers', 'no valid number of players');
  if (rules.trump === 'bottom' && !defs.some((d) => d.suit)) err('rules.trump', 'the trump is drawn from the bottom card, but no card has a suit');
  if (rules.teams && rules.maxPlayers < rules.teams * 2) err('rules.teams', 'teams need at least two players each');
  if (rules.transferShow && !rules.transfer) warn('rules.transferShow', 'transfers are off');
  rules.rankGroups.forEach((g, i) => { for (const r of g) if (!rankIds.has(r)) warn(`rules.rankGroups[${i}]`, `unknown rank "${r}"`); });
  // A card no other card can beat (and that may be led) makes every lead of it unanswerable: a warning, because some
  // house rules intend exactly that for special cards.
  // Every card should be beatable by something (otherwise it can be led and never answered), and should beat something.
  const C = compile(rs);
  const T = C.trumpKeys.length;
  defs.forEach((d, i) => {
    let beatenByAny = false;
    for (let t = 0; t < T && !beatenByAny; t++) for (let j = 0; j < C.D; j++) if (C.beat[t][j * C.D + i]) { beatenByAny = true; break; }
    if (!beatenByAny && !d.rules.noLead) warn(`card ${d.code}`, 'no card can beat it');
  });
  return { ok: errors.length === 0, errors, warnings, ruleset: rs, players: pr };
}

// --- matchers --------------------------------------------------------------------------------------------------

// Does `def` match `m`? `self` is the card that owns the rule ('=' compares with it). `trumpTier` (optional)
// answers trump matching.
// Matcher semantics: all present fields must match (AND); list values mean OR within a field; any = OR of
// sub-matchers; not = negation; '=' compares with the rule owner's own field (lets one global rule express "beats
// any card of its own colour"). trumpTier is injected because trumpness depends on the deal (the trump suit).
export function matchCard(m, def, self, trumpTier) {
  if (!isObj(m)) return false;
  if (m.none) return false;
  if (m.any) { if (!list(m.any).some((x) => matchCard(x, def, self, trumpTier))) return false; }
  if (m.not && matchCard(m.not, def, self, trumpTier)) return false;
  const field = (key, val) => {
    const want = m[key];
    if (want === undefined) return true;
    const vals = list(want);
    return vals.some((w) => (w === '=' ? self != null && val === self[key === 'id' ? 'code' : key] && val != null : w === val));
  };
  if (!field('id', def.code)) return false;
  if (!field('rank', def.rank)) return false;
  if (!field('suit', def.suit)) return false;
  if (!field('color', def.color)) return false;
  if (m.wild !== undefined && !!def.rules?.wild !== !!m.wild) return false;
  if (m.custom !== undefined && !!def.custom !== !!m.custom) return false;
  if (m.trump !== undefined) {
    const tier = trumpTier ? trumpTier(def) : 0;
    if ((tier > 0) !== !!m.trump) return false;
  }
  if (m.minValue !== undefined && !(def.value >= m.minValue)) return false;
  if (m.maxValue !== undefined && !(def.value <= m.maxValue)) return false;
  return true;
}

// A null field never counts as "same": two suitless jokers do not share a suit.
function sameBy(kind, a, b) {
  if (!kind) return true;
  if (kind === 'card') return a.code === b.code;
  const v = a[kind];
  return v != null && v === b[kind];
}

// --- compiled tables -------------------------------------------------------------------------------------------

const CACHE = new Map();

/**
 * Lookup tables of a ruleset (cached by hash):
 *   defs, D (definitions), N (physical cards), uidDef (uid -> def index; uids are numbered in definition order),
 *   trumpKeys ([null, ...suit ids]; index t of the trump suit), trumpIndex(suit),
 *   beat[t] (Uint8Array D×D: beat[t][d * D + a] = d beats a), tier[t] (Int8Array per def),
 *   match (Uint8Array D×D throw-in relation), cls (rank classes per def), wild (Uint8Array),
 *   flags (noLead, noThrow, noTransfer, noDefend, closesBout as Uint8Arrays), value (Float64Array), lowValue
 */
// One beat table per possible trump suit (index 0 = no trump) is precomputed, because the trump is only known
// after the deal; at play time the engine selects beat[trumpIndex]. Memory: (suits + 1) x D^2 bytes, about 6.5 KB
// for a 36-card deck. Cached by hash (FIFO of 64) and shared by all games of the ruleset.
// match[] is the throw-in relation (same rank class, or a wildcard covering the other card): symmetric by
// construction, since both directions are tested.
export function compile(rsIn) {
  const rs = rsIn.defs ? rsIn : normalizeRuleset(rsIn);
  const hit = CACHE.get(rs.hash);
  if (hit) return hit;
  const defs = rs.defs, D = defs.length, R = rs.rules;
  const uidDef = [];
  defs.forEach((d, i) => { for (let k = 0; k < d.copies; k++) uidDef.push(i); });
  const N = uidDef.length;
  const trumpKeys = [null, ...rs.deck.suits.map((s) => s.id)];
  // Rank classes: a rank id plus its group mates (ranks in one group share the group's first id).
  const groupOf = new Map();
  for (const g of R.rankGroups) for (const r of g) if (!groupOf.has(r)) groupOf.set(r, g[0]);
  const classOf = (r) => groupOf.get(r) ?? r;
  const cls = defs.map((d) => {
    const s = new Set();
    if (d.rank) s.add(classOf(d.rank));
    for (const r of d.rules.rankAs) s.add(classOf(r));
    return [...s];
  });
  const wild = new Uint8Array(D);
  defs.forEach((d, i) => { wild[i] = d.rules.wild ? 1 : 0; });
  const wildMatches = (w, other) => {
    const k = w.rules.wild;
    if (k === 'any') return true;
    if (k === 'color') return w.color != null && w.color === other.color;
    if (k === 'suit') return w.suit != null && w.suit === other.suit;
    return false;
  };
  const match = new Uint8Array(D * D);
  for (let i = 0; i < D; i++) {
    for (let j = 0; j < D; j++) {
      const a = defs[i], b = defs[j];
      let m = cls[i].some((c) => cls[j].includes(c));
      if (!m && wild[i] && wildMatches(a, b)) m = true;
      if (!m && wild[j] && wildMatches(b, a)) m = true;
      match[i * D + j] = m ? 1 : 0;
    }
  }
  const eternal = new Set(R.eternal);
  // Trump tiers: 0 plain, 1 the drawn trump suit, eternalTier (default 2) for eternal suits and 'always' cards, so
  // eternal trumps beat ordinary trumps regardless of value.
  const tierFor = (d, trumpSuit) => {
    const r = d.rules;
    if (r.trump === 'never') return 0;
    if (r.trump === 'always') return r.tier ?? R.eternalTier;
    if (d.suit && eternal.has(d.suit)) return R.eternalTier;
    if (d.suit && d.suit === trumpSuit) return 1;
    return 0;
  };
  const beat = [], tier = [];
  for (let t = 0; t < trumpKeys.length; t++) {
    const ts = trumpKeys[t];
    const tr = new Int8Array(D);
    for (let i = 0; i < D; i++) tr[i] = tierFor(defs[i], ts);
    const tierFn = (def) => tierFor(def, ts);
    const b = new Uint8Array(D * D);
    for (let di = 0; di < D; di++) {
      for (let ai = 0; ai < D; ai++) b[di * D + ai] = canBeatDefs(defs[di], defs[ai], tr[di], tr[ai], tierFn, R) ? 1 : 0;
    }
    beat.push(b);
    tier.push(tr);
  }
  const flag = (k) => { const a = new Uint8Array(D); defs.forEach((d, i) => { a[i] = d.rules[k] ? 1 : 0; }); return a; };
  const value = new Float64Array(D);
  defs.forEach((d, i) => { value[i] = d.value; });
  const suited = defs.filter((d) => d.suit && d.rank);
  const lowValue = suited.length ? Math.min(...suited.map((d) => d.value)) : 0;
  // Lowest value of each suit (trump exchange: the holder of the lowest trump).
  const lowBySuit = {};
  for (const d of suited) lowBySuit[d.suit] = Math.min(lowBySuit[d.suit] ?? Infinity, d.value);
  const C = {
    rs, defs, D, N, uidDef, trumpKeys, trumpIndex: (s) => Math.max(0, trumpKeys.indexOf(s ?? null)),
    beat, tier, match, cls, wild, value, lowValue, lowBySuit,
    noLead: flag('noLead'), noThrow: flag('noThrow'), noTransfer: flag('noTransfer'), noDefend: flag('noDefend'), closesBout: flag('closesBout'),
    codeOf: defs.map((d) => d.code), defByCode: new Map(defs.map((d, i) => [d.code, i])),
    firstUid: (() => { const f = []; let u = 0; defs.forEach((d, i) => { f[i] = u; u += d.copies; }); return f; })(),
  };
  CACHE.set(rs.hash, C);
  if (CACHE.size > 64) CACHE.delete(CACHE.keys().next().value);
  return C;
}

// d (defending card) against a (attacking card): restrictions, deny rules, explicit relations, then the standard
// comparison (higher trump tier wins; same tier: same suit — or any suit for trumps with trumpCross — and higher value).
// Precedence (first decisive rule wins): hard restrictions (noDefend, beatenOnlyBy, beatsOnly), deny beat rules,
// explicit positive relations (card beats/beatenBy, global beat rules), then the standard comparison. Denials come
// before permissions so a house rule like "nothing beats the queen of spades" cannot be undone by a generic rule.
// Same non-zero tier with different suits: comparable only with trumpCross (or when a card has no suit), so
// eternal-trump variants can choose whether trumps of different suits beat each other.
function canBeatDefs(d, a, td, ta, tierFn, R) {
  if (d.rules.noDefend) return false;
  if (a.rules.beatenOnlyBy && !matchCard(a.rules.beatenOnlyBy, d, a, tierFn)) return false;
  if (d.rules.beatsOnly && !matchCard(d.rules.beatsOnly, a, d, tierFn)) return false;
  for (const br of R.beatRules) {
    if (br.deny && matchCard(br.by, d, d, tierFn) && matchCard(br.beats, a, a, tierFn) && sameBy(br.same, d, a)) return false;
  }
  for (const m of d.rules.beats) if (matchCard(m, a, d, tierFn)) return true;
  for (const m of a.rules.beatenBy) if (matchCard(m, d, a, tierFn)) return true;
  for (const br of R.beatRules) {
    if (!br.deny && matchCard(br.by, d, d, tierFn) && matchCard(br.beats, a, a, tierFn) && sameBy(br.same, d, a)) return true;
  }
  if (td > ta) return true;
  if (td < ta) return false;
  if (td === 0) {
    if (!d.suit || !a.suit || d.suit !== a.suit) return false;
    return d.value > a.value;
  }
  if (d.suit !== a.suit && !(R.trumpCross || !d.suit || !a.suit)) return false;
  return d.value > a.value;
}

// --- display helpers -------------------------------------------------------------------------------------------

export function suitInfo(rs, id) { return rs.deck.suits.find((s) => s.id === id) || null; }
export function rankInfo(rs, id) { return rs.deck.ranks.find((r) => r.id === id) || null; }
export function colorInfo(rs, id) { return rs.deck.colors.find((c) => c.id === id) || null; }

// Short human text of a card definition: "10♥", "A♠", "★" (custom cards use their label or code).
export function cardText(rs, def) {
  if (def.label) return def.label;
  const r = def.rank ? rankInfo(rs, def.rank) : null;
  const s = def.suit ? suitInfo(rs, def.suit) : null;
  if (def.custom && !r && !s) return def.code;
  return (r ? r.label : '') + (s ? s.symbol : '');
}
