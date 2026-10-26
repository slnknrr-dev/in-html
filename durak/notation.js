// durak/notation.js - DGN (Durak Game Notation): a game as one line of text, like PGN for chess, that can be copied,
// pasted, parsed and replayed move by move. It records only what everybody saw at the table (the public course):
// the ruleset, the players, the open trump card, the first attacker and every move with the cards it showed. A seed
// (or the deal) may be added to replay the hands too.
//
//   DGN1;r=<id>@<hash>;n=<players>;p=<names>;t=<trump>;f=<first>;m=<moves>[;s=seed:<seed>][;d=<deal>][;R=<ruleset>][;x=<result>]
//
//   r  ruleset id and hash (ruleset.js rulesetHash); R the ruleset itself (deflate + base64url JSON) for own rulesets
//   p  names separated by ',' (URI-encoded); a bot is name~kind.level
//   t  the open trump card code, ':S' for a trump suit without a card, '-' for no trump
//   f  seat of the first attacker
//   m  moves separated by spaces: <seat><op><cards> with seat in base 36 and cards as card codes joined by '.':
//      L lead · + throw in · B<card>><attacked card>[@slot] beat · T transfer · V transfer by showing a trump ·
//      X take · P pass · S<card> swap the lowest trump for the open trump card · '/' bout beaten off · '//' cards taken
//   s  seed:<seed> (prng seeded shuffle) — replays the hands;  d  the deal (uid bytes, base64url) — the same for crypto
//   x  result: D<seat> (the durak) or '=' (a draw), then P<n> for pogony
//
//   encode(game, { seed, deal, names, embed }) -> text      game: an engine state (or { rs, n, log, firstSeat, ... })
//   parse(text) -> { ok, error?, rulesetRef, rs?, n, names, trump, first, seed, deal, moves: [token], result }
//   replay(parsed, { ruleset }) -> { ok, error?, at?, frames: [{ token, state, tracker, hidden, bits, seat }], entropy }
//
// Entropy (public information only, never what is in somebody's hand):
//   course entropy  Σ log2(b) over the recorded decisions, where b is the number of different public moves the
//                   player could have made at that moment judging only by public knowledge (the player's known
//                   cards plus every card whose place nobody has seen, by distinct card type; +1 for taking or
//                   passing). It measures how specific the observed course of the game was: the number of bits a
//                   record of this game needs when every publicly possible move is equally likely.
//   hidden entropy  H(t) = log2 of the number of ways the unseen cards can lie in the hands and the stock given the
//                   public hand sizes (public.js) — how much is still hidden after each move.

import { compile, normalizeRuleset } from './ruleset.js';
import { PRESETS } from './presets.js';
import {
  applyInPlace, beatOptions, cloneState, endBoutNow, leadOk, newGame, throwOptions, transferTarget, unbeaten,
} from './engine.js';
import { hiddenEntropy, track } from './public.js';
import { deflateRawSync, inflateRawSync } from '../codec/zlib.js';
import { base64ToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from '../crypto/encoding.js';
import { seededRandom } from '../prng/prng.js';

//
// Format: ';'-separated key=value fields (unknown keys ignored, so the format can grow), a version tag for breaking
// changes, card codes from the ruleset (human-readable: 'Th', 'R*'). Only public information is required, so a record
// can be published during or after a game without leaking hands; a seed or deal makes it a full replay.
export const TAG = 'DGN1';
const b36 = (n) => n.toString(36);
const encName = (s) => encodeURIComponent(String(s ?? '')).replace(/~/g, '%7E');

// --- encoding --------------------------------------------------------------------------------------------------

// Beats name the attacked card by code; the slot index is appended only when the first unbeaten card with that code
// is not the one beaten (multi-deck copies), keeping typical records short and unambiguous.
export function moveTokens(rs, log) {
  const C = compile(rs);
  const code = (u) => C.codeOf[C.uidDef[u]];
  const out = [];
  const table = [];
  for (const e of log) {
    const [k, seat] = e;
    const S = typeof seat === 'number' ? b36(seat) : '';
    switch (k) {
      case 'L': case '+':
        out.push(S + k + e[2].map(code).join('.'));
        for (const u of e[2]) table.push({ a: u, d: -1 });
        break;
      case 'B': {
        const slot = e[3], a = table[slot].a;
        const first = table.findIndex((p) => p.d < 0 && C.uidDef[p.a] === C.uidDef[a]);
        out.push(`${S}B${code(e[2])}>${code(a)}${first !== slot ? '@' + slot : ''}`);
        table[slot].d = e[2];
        break;
      }
      case 'T':
        if (e[3]) out.push(S + 'V' + code(e[2][0]));
        else { out.push(S + 'T' + e[2].map(code).join('.')); for (const u of e[2]) table.push({ a: u, d: -1 }); }
        break;
      case 'X': out.push(S + 'X'); break;
      case 'P': out.push(S + 'P'); break;
      case 'S': out.push(S + 'S' + code(e[2])); break;
      case '/': out.push(e[1] ? '//' : '/'); table.length = 0; break;
      default: break;
    }
  }
  return out;
}

function trumpField(C, g) {
  if (g.trumpCard0 != null && g.trumpCard0 >= 0) return C.codeOf[C.uidDef[g.trumpCard0]];
  if (g.trumpSuit) return ':' + g.trumpSuit;
  return '-';
}

// The open trump card at the start of a state (swaps in the log undone).
function startTrump(g) {
  let t = g.trumpCard;
  if (t == null || t < 0) return -1;
  for (let i = g.log.length - 1; i >= 0; i--) if (g.log[i][0] === 'S') t = g.log[i][3];
  return t;
}

const BUILTIN = new Set(PRESETS.map((p) => p.id));

// The ruleset as embeddable JSON (art data URLs dropped: they can be megabytes).
// data: URL art is stripped from embedded rulesets: a single custom card image could make share links megabytes long.
export function rulesetSource(rs) {
  const strip = (art) => (art && typeof art === 'object' && typeof art.src === 'string' && art.src.startsWith('data:') ? { ...art, src: undefined } : art);
  return {
    id: rs.id, name: rs.name, description: rs.description, author: rs.author, tags: rs.tags, exclusive: rs.exclusive,
    deck: { ...rs.deck, suits: rs.deck.suits.map((s) => ({ ...s, art: strip(s.art) })), cards: rs.deck.cards.map((c) => ({ ...c, art: strip(c.art) })) },
    rules: rs.rules,
  };
}

export function packRuleset(rs) {
  return bytesToBase64Url(deflateRawSync(utf8ToBytes(JSON.stringify(rulesetSource(rs))), { level: 9 }));
}
export function unpackRuleset(text) {
  return JSON.parse(bytesToUtf8(inflateRawSync(base64ToBytes(text))));
}

/**
 * One line of DGN. g: an engine state, or { rs, n, log, firstSeat, trumpCard, trumpSuit, result }.
 * opts: { names: [string], bots: [null | 'kind.level'], seed, deal: true (adds the deal), embed: true | false
 * (the ruleset; default: when it is not a built-in preset), date }
 */
export function encode(g, opts = {}) {
  const rs = g.rs;
  const C = compile(rs);
  const f = [TAG, `r=${rs.id}@${rs.hash}`, `n=${g.n}`];
  const names = opts.names || g.names || [];
  const bots = opts.bots || [];
  f.push('p=' + Array.from({ length: g.n }, (_, i) => encName(names[i] || `P${i + 1}`) + (bots[i] ? '~' + String(bots[i]).replace(/[^a-z0-9.-]/gi, '') : '')).join(','));
  f.push('t=' + trumpField(C, { trumpCard0: startTrump(g), trumpSuit: g.trumpSuit }));
  f.push('f=' + b36(g.firstSeat ?? 0));
  f.push('m=' + moveTokens(rs, g.log).join(' '));
  const seed = opts.seed !== undefined ? opts.seed : g.seed;
  if (seed) f.push('s=seed:' + encodeURIComponent(seed));
  // The deal as bytes: one byte per uid for decks up to 255 cards, two (big-endian) beyond; parse infers the width from
  // the length (N or 2N bytes).
  if (opts.deal && g.deal) {
    const wide = C.N > 255;
    const bytes = new Uint8Array(g.deal.length * (wide ? 2 : 1));
    g.deal.forEach((u, i) => { if (wide) { bytes[2 * i] = u >> 8; bytes[2 * i + 1] = u & 255; } else bytes[i] = u; });
    f.push('d=' + bytesToBase64Url(bytes));
  }
  const embed = opts.embed ?? !BUILTIN.has(rs.id);
  if (embed) f.push('R=' + packRuleset(rs));
  if (opts.date) f.push('g=' + encodeURIComponent(opts.date));
  const res = g.result || null;
  if (res) f.push('x=' + (res.draw ? '=' : 'D' + b36(res.durak)) + (res.pogony ? 'P' + res.pogony : ''));
  return f.join(';');
}

// --- parsing ---------------------------------------------------------------------------------------------------

// <seat in base 36><op><payload> or the bout markers '/' and '//'. Payload syntax is validated during replay.
const TOKEN = /^(?:([0-9a-z])([L+BTVXPS])(.*)|(\/\/?))$/;

export function parse(text) {
  const src = String(text || '').trim().replace(/\s*\n\s*/g, ' ');
  const fail = (error) => ({ ok: false, error });
  if (!src.startsWith(TAG + ';') && src !== TAG) return fail('not a DGN1 record');
  const fields = {};
  for (const part of src.split(';').slice(1)) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    fields[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  if (!fields.r) return fail('no ruleset (r=)');
  const at = fields.r.lastIndexOf('@');
  const ref = { id: at > 0 ? fields.r.slice(0, at) : fields.r, hash: at > 0 ? fields.r.slice(at + 1) : '' };
  const n = parseInt(fields.n, 10);
  if (!(n >= 2 && n <= 36)) return fail('bad number of players (n=)');
  const names = [], bots = [];
  (fields.p ? fields.p.split(',') : []).forEach((x, i) => {
    const [nm, bot] = x.split('~');
    try { names[i] = decodeURIComponent(nm); } catch { names[i] = nm; }
    bots[i] = bot || null;
  });
  let rs = null;
  // Embedded rulesets go through normalizeRuleset (see the KNOWN DEFECT on its trust shortcut in ruleset.js).
  if (fields.R) {
    try { rs = normalizeRuleset(unpackRuleset(fields.R)); } catch { return fail('the embedded ruleset (R=) is damaged'); }
  }
  const moves = (fields.m || '').split(/\s+/).filter(Boolean);
  for (const m of moves) if (!TOKEN.test(m)) return fail(`bad move "${m}"`);
  let seed = null;
  if (fields.s && fields.s.startsWith('seed:')) { try { seed = decodeURIComponent(fields.s.slice(5)); } catch { seed = fields.s.slice(5); } }
  let deal = null;
  if (fields.d) { try { deal = base64ToBytes(fields.d); } catch { return fail('bad deal (d=)'); } }
  let result = null;
  if (fields.x) {
    const m = /^(=|D([0-9a-z]))(?:P(\d))?$/.exec(fields.x);
    if (m) result = { draw: m[1] === '=', durak: m[2] ? parseInt(m[2], 36) : -1, pogony: m[3] ? +m[3] : 0 };
  }
  let date = null;
  if (fields.g) { try { date = decodeURIComponent(fields.g); } catch { date = fields.g; } }
  return {
    ok: true, ref, rs, n, names, bots, trump: fields.t || '-', first: fields.f ? parseInt(fields.f, 36) : 0,
    seed, deal, moves, result, date,
  };
}

// The ruleset of a parsed record: the embedded one, else a built-in preset with that id (and hash), else one of
// `extra` (the user's rulesets).
// Prefers an id match with the same hash (or no hash recorded), then any of the user's rulesets with that hash.
export function resolveRuleset(parsed, extra = []) {
  if (parsed.rs) return parsed.rs;
  for (const raw of [...PRESETS, ...extra]) {
    if (!raw || raw.id !== parsed.ref.id) continue;
    const rs = normalizeRuleset(raw);
    if (!parsed.ref.hash || rs.hash === parsed.ref.hash) return rs;
  }
  for (const raw of extra) {
    const rs = normalizeRuleset(raw);
    if (rs.hash === parsed.ref.hash) return rs;
  }
  return null;
}

// --- replay ----------------------------------------------------------------------------------------------------

/**
 * Replays a parsed record. With a seed or a deal the real hands are replayed and every move is checked; without one
 * a deal consistent with the public record is built on the fly (unseen cards are swapped into the hand that shows
 * them), so the table, counts and public knowledge are exact while the hidden hands are placeholders (`public`).
 * frames[0] is the position after the deal; frames[i] the position after moves[i - 1].
 */
// Public replay technique: start from an arbitrary deterministic deal (fixed seed) and, whenever the record shows a
// card the placeholder hand does not hold, swap it in for an unseen card (swapIn). Since both cards were unseen by
// everyone, the public course stays exactly the same; manual mode stops the engine from ending bouts on its own,
// because placeholder hands may contain throwable cards the real players did not have.
export function replay(parsed, { ruleset = null, extra = [], maxFrames = 4000 } = {}) {
  const rs = ruleset ? normalizeRuleset(ruleset) : resolveRuleset(parsed, extra);
  if (!rs) return { ok: false, error: `unknown ruleset ${parsed.ref.id}@${parsed.ref.hash}`, frames: [] };
  const C = compile(rs);
  const codeDef = C.defByCode;
  let s, isPublic = false;
  try {
    if (parsed.seed) s = newGame(rs, { players: parsed.n, rng: seededRandom(parsed.seed), first: parsed.first });
    else if (parsed.deal) {
      const d = parsed.deal, wide = d.length === C.N * 2;
      const deal = Array.from({ length: C.N }, (_, i) => (wide ? (d[2 * i] << 8) | d[2 * i + 1] : d[i]));
      s = newGame(rs, { players: parsed.n, deal, first: parsed.first, trumpSuit: parsed.trump.startsWith(':') ? parsed.trump.slice(1) : null });
    } else {
      isPublic = true;
      const order = Array.from({ length: C.N }, (_, i) => i);
      seededRandom('dgn-public').shuffle(order);
      if (parsed.trump && parsed.trump !== '-' && !parsed.trump.startsWith(':')) {
        const di = codeDef.get(parsed.trump);
        if (di == null) return { ok: false, error: `unknown trump card ${parsed.trump}`, frames: [] };
        const u = C.firstUid[di];
        const k = order.indexOf(u);
        order[k] = order[0]; order[0] = u;
      }
      s = newGame(rs, { players: parsed.n, deal: order, first: parsed.first, trumpSuit: parsed.trump.startsWith(':') ? parsed.trump.slice(1) : null });
      s.manual = true;
    }
  } catch (e) { return { ok: false, error: e.message, frames: [] }; }
  // The trump card must agree with the record.
  if (!isPublic && parsed.trump && parsed.trump !== '-' && !parsed.trump.startsWith(':') && (s.trumpCard < 0 || C.codeOf[C.uidDef[s.trumpCard]] !== parsed.trump)) {
    return { ok: false, error: 'the seed or deal does not match the trump card', frames: [] };
  }
  const T = track({ rs, n: s.n, trumpCard: s.trumpCard, trumpSuit: s.trumpSuit });
  T.run(s.log);
  let fed = s.log.length;
  const feed = () => { while (fed < s.log.length) T.step(s.log[fed++]); };
  const frames = [{ token: null, state: cloneState(s), hidden: hiddenEntropy(T), bits: 0, seat: -1, known: snapshotKnown(T) }];
  const perSeat = new Array(s.n).fill(0);
  let total = 0, decisions = 0;

  for (let i = 0; i < parsed.moves.length; i++) {
    const tok = parsed.moves[i];
    const m = TOKEN.exec(tok);
    const fail = (error) => ({ ok: false, error: `move ${i + 1} (${tok}): ${error}`, at: i, frames, rs, public: isPublic, entropy: summary() });
    let bits = 0, seat = -1;
    if (m[4]) {
      const took = m[4] === '//';
      if (isPublic) {
        const err = endBoutNow(s, took);
        if (err) return fail(err);
      } else if (s.phase === 'bout') return fail('the bout is not over yet');
    } else {
      seat = parseInt(m[1], 36);
      if (!(seat >= 0 && seat < s.n)) return fail('bad seat');
      const op = m[2];
      const parts = m[3] ? m[3].split('>') : [];
      const cardsOf = (txt) => (txt ? txt.split('.') : []);
      // Decision size before the move (public knowledge only).
      const b = options(s, T, seat, op, cardsOf(parts[0]));
      bits = Math.log2(Math.max(1, b));
      let action;
      const pick = (codes, { keep = false } = {}) => {
        const got = [];
        for (const c of codes) {
          const di = codeDef.get(c);
          if (di == null) throw new Error(`unknown card ${c}`);
          let u = s.hands[seat].find((x) => C.uidDef[x] === di && !got.includes(x));
          if (u == null && isPublic) u = swapIn(s, T, seat, di, got);
          if (u == null) throw new Error(`card ${c} is not in the hand of seat ${seat}`);
          got.push(u);
        }
        return got;
      };
      try {
        if (op === 'L') action = { type: 'lead', cards: pick(cardsOf(parts[0])) };
        else if (op === '+') action = { type: 'throw', cards: pick(cardsOf(parts[0])) };
        else if (op === 'T') action = { type: 'transfer', cards: pick(cardsOf(parts[0])) };
        else if (op === 'V') action = { type: 'transfer', cards: pick(cardsOf(parts[0])), show: true };
        else if (op === 'X') action = { type: 'take' };
        else if (op === 'P') action = { type: 'pass' };
        else if (op === 'S') action = { type: 'swap', card: pick(cardsOf(parts[0]))[0] };
        else if (op === 'B') {
          const [card] = pick(cardsOf(parts[0]));
          const tgt = parts[1] || '';
          const [tcode, slotTxt] = tgt.split('@');
          const tdi = codeDef.get(tcode);
          let slot = slotTxt != null ? +slotTxt : s.table.findIndex((p) => p.d < 0 && C.uidDef[p.a] === tdi);
          if (!(slot >= 0) || !s.table[slot] || C.uidDef[s.table[slot].a] !== tdi) throw new Error(`no ${tcode} to beat`);
          action = { type: 'beat', card, slot };
        }
      } catch (e) { return fail(e.message); }
      // Passes the record does not show: in a public replay, placeholder hands may hold cards the real players did
      // not have, which must not keep a bout open.
      const err = applyInPlace(s, seat, action);
      if (err) return fail(err);
      total += bits;
      perSeat[seat] += bits;
      decisions++;
    }
    feed();
    if (frames.length < maxFrames) frames.push({ token: tok, state: cloneState(s), hidden: hiddenEntropy(T), bits, seat, known: snapshotKnown(T) });
  }
  function summary() {
    return {
      course: total, perSeat, decisions, perDecision: decisions ? total / decisions : 0,
      hiddenStart: frames[0].hidden, hiddenEnd: frames[frames.length - 1].hidden,
      revealed: Math.max(0, frames[0].hidden - frames[frames.length - 1].hidden),
      openness: frames[0].hidden > 0 ? Math.max(0, frames[0].hidden - frames[frames.length - 1].hidden) / frames[0].hidden : 0,
      series: frames.map((f) => f.hidden), bitsSeries: frames.map((f) => f.bits),
    };
  }
  return { ok: true, frames, rs, public: isPublic, entropy: summary(), finished: s.phase === 'over', result: s.result };
}

function snapshotKnown(T) {
  return T.known.map((k) => [...k]);
}

// Public replay: brings a card of definition `di` whose place is unknown into `seat`'s hand, in exchange for a card
// of that hand whose identity is unknown too. Both are invisible to everybody, so the public record stays the same.
// The victim must be unseen too and of another definition; the incoming copy must be unseen and not already in this
// hand. The swap is applied to every place a uid may live (hands, stock, deal copy) to keep the state consistent.
function swapIn(s, T, seat, di, taken) {
  const C = compile(s.rs);
  const hand = s.hands[seat];
  const victim = hand.find((x) => !T.located.has(x) && !taken.includes(x) && C.uidDef[x] !== di);
  if (victim == null) return null;
  let u = -1;
  for (let x = C.firstUid[di]; x < C.firstUid[di] + C.defs[di].copies; x++) if (!T.located.has(x) && !hand.includes(x)) { u = x; break; }
  if (u < 0) return null;
  const swap = (arr) => { const i = arr.indexOf(u), j = arr.indexOf(victim); if (i >= 0) arr[i] = victim; if (j >= 0) arr[j] = u; };
  for (const h of s.hands) { const i = h.indexOf(u); if (i >= 0) h[i] = victim; }
  const vi = hand.indexOf(victim);
  hand[vi] = u;
  const si = s.stock.indexOf(u);
  if (si >= 0) s.stock[si] = victim;
  swap(s.deal = s.deal.slice());
  return u;
}

// The number of publicly possible moves of `seat` at this point (see the header).
// Counts distinct public alternatives by card type (copies are indistinguishable to an observer) using a probe state
// whose hand is "known cards + one representative of each unseen type". The log2 of the count is the information a
// record spends on this decision under a uniform model.
function options(s, T, seat, op, codes) {
  const C = compile(s.rs);
  // Pool: the seat's known cards and one card of each type whose place is unknown (when the hand has unknown cards).
  const known = [...T.known[seat]];
  const pool = known.slice();
  if (T.counts[seat] > known.length) {
    const seenDef = new Set(known.map((u) => C.uidDef[u]));
    for (let u = 0; u < C.N; u++) {
      if (T.located.has(u)) continue;
      const d = C.uidDef[u];
      if (seenDef.has(d)) continue;
      seenDef.add(d);
      pool.push(u);
    }
  }
  const distinct = (uids) => new Set(uids.map((u) => C.uidDef[u])).size;
  const probe = { ...s, hands: s.hands.slice() };
  probe.hands[seat] = pool;
  if (op === 'L') {
    let b = distinct(pool.filter((u) => leadOk(probe, seat, [u])));
    // extra cards of a multi-card lead: one more choice each (stop, or a matching type)
    for (let k = 1; k < codes.length; k++) b *= 1 + Math.max(1, distinct(pool.filter((u) => C.match[C.uidDef[u] * C.D + C.defByCode.get(codes[0])])));
    return b;
  }
  if (op === '+' || op === 'P') {
    const b = 1 + distinct(throwOptions(probe, seat));
    return op === '+' ? Math.pow(b, Math.max(1, codes.length)) : b;
  }
  if (op === 'B' || op === 'T' || op === 'V' || op === 'X') {
    let b = unbeaten(s) > 0 ? 1 : 0;
    s.table.forEach((p, i) => { if (p.d < 0) b += distinct(beatOptions(probe, seat, i)); });
    if (s.rs.rules.transfer) {
      const tr = new Set();
      for (const u of pool) {
        if (transferTarget(probe, seat, [u]) >= 0) tr.add('T' + C.uidDef[u]);
        if (s.rs.rules.transferShow && transferTarget(probe, seat, [u], true) >= 0) tr.add('V' + C.uidDef[u]);
      }
      b += tr.size;
    }
    return Math.max(1, b);
  }
  if (op === 'S') return 2;
  return 1;
}
