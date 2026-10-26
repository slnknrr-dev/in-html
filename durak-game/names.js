// durak-game/names.js - localized names of rulesets, bots and levels, and the rules of a ruleset in plain words (the
// rules dialog, the setup screen and the constructor's preview).
//
//   rulesetName(rs), rulesetDesc(rs)       built-in presets through the dictionaries, own rulesets by their texts
//   botName({ kind, level, name? }), botLabel(kind.level), levelName(level)
//   rulesList(rs) -> [string]              the rules in sentences;  rulesBody(rs) -> element

import { h } from '../ui/dom.js';
import { t, pickUI, ED_I18N, UI_STATE } from '../ui/i18n.js';
import { normalizeRuleset, cardText } from '../durak/ruleset.js';
import { PRESETS } from '../durak/presets.js';
import { templateById } from '../durak/bots.js';

// Built-in presets are named through the dictionaries (translated); user rulesets carry their own multilingual texts
// (pickUI picks the UI language). The `has` check on the English reference dictionary lets a new preset without
// translation keys fall back to its own name instead of showing a raw key.
const BUILTIN = new Set(PRESETS.map((p) => p.id));
const has = (k) => ED_I18N.en[k] != null;

export function rulesetName(rs) {
  if (rs && BUILTIN.has(rs.id) && has(`preset.${rs.id}.name`)) return t(`preset.${rs.id}.name`);
  return pickUI(rs && rs.name) || (rs && rs.id) || '?';
}
export function rulesetDesc(rs) {
  if (rs && BUILTIN.has(rs.id) && has(`preset.${rs.id}.desc`)) return t(`preset.${rs.id}.desc`);
  return pickUI(rs && rs.description) || '';
}

export const levelName = (l) => t('lvl.' + (l | 0 || 2));

export function botName(b) {
  if (b && b.name) return b.name;
  const tpl = templateById(b && b.kind);
  return tpl ? t(`bot.${tpl.id}.name`) : t('bot.custom.name');
}
export function botLabel(k) {
  if (!k) return '';
  const [kind, level] = String(k).split('.');
  return botName({ kind }) + ' · ' + levelName(+level);
}

// The rules of a ruleset in sentences. Generated from the normalized rules, never hand-written, so the description
// can not drift from what the engine enforces. Accepts raw or normalized (presence of defs). Order: deck, trump,
// who leads, throw-in, limits, variants, rank groups, beat rules, then special cards - deduplicated by (rules +
// label), so 4 identical jokers yield one sentence.
export function rulesList(raw) {
  const rs = raw.defs ? raw : normalizeRuleset(raw);
  const R = rs.rules;
  const out = [];
  const suit = (id) => { const s = rs.deck.suits.find((x) => x.id === id); return s ? s.symbol : id; };
  out.push(t('rl.deck', { n: rs.cardCount, hand: R.handSize }));
  const copies = rs.defs.some((d) => d.copies > 1);
  if (copies) out.push(t('rl.copies'));
  const custom = rs.defs.filter((d) => d.custom);
  if (custom.length) out.push(t('rl.custom', { cards: [...new Set(custom.map((d) => (d.name ? pickUI(d.name) : cardText(rs, d))))].join(', ') }));
  out.push(R.trump === 'bottom' ? t('rl.trumpBottom') : R.trump === 'random' ? t('rl.trumpRandom') : R.trump === 'none' ? t('rl.trumpNone') : t('rl.trumpFixed', { suit: suit(R.trump) }));
  if (R.eternal.length) out.push(t('rl.eternal', { suits: R.eternal.map(suit).join(' ') }));
  if (R.trumpExchange) out.push(t('rl.exchange'));
  out.push(t('rl.first.' + R.first));
  out.push(t('rl.throw.' + R.throwIn));
  out.push(R.boutLimit ? (R.firstBoutLimit && R.firstBoutLimit !== R.boutLimit ? t('rl.limits', { first: R.firstBoutLimit, n: R.boutLimit }) : t('rl.limit', { n: R.boutLimit })) : t('rl.noLimit'));
  if (R.limitByHand) out.push(t('rl.byHand'));
  if (R.leadMulti) out.push(t('rl.multi'));
  if (R.transfer) out.push(R.transferShow ? t('rl.transferShow') : t('rl.transfer'));
  if (!R.throwAfterTake) out.push(t('rl.noThrowAfterTake'));
  if (R.teams) out.push(t('rl.teams', { n: R.teams }));
  if (R.direction === -1) out.push(t('rl.ccw'));
  if (R.pogony) out.push(t('rl.pogony'));
  for (const g of R.rankGroups) out.push(t('rl.group', { ranks: g.map((r) => (rs.deck.ranks.find((x) => x.id === r) || { label: r }).label).join(' = ') }));
  for (const b of R.beatRules) out.push(beatRuleText(rs, b));
  // Special cards (joker-like rules), grouped by their rules.
  const seen = new Set();
  for (const d of rs.defs) {
    const r = d.rules;
    const bits = [];
    if (r.trump === 'always') bits.push(t('rl.c.always'));
    if (r.trump === 'never' && d.suit) bits.push(t('rl.c.never'));
    if (r.wild) bits.push(t('rl.c.wild.' + r.wild));
    if (r.rankAs.length) bits.push(t('rl.c.rankAs', { ranks: r.rankAs.join(', ') }));
    if (r.beatsOnly && r.beatsOnly.color === '=') bits.push(t('rl.c.beatsOwnColor'));
    else if (r.beats.length) bits.push(t('rl.c.beats'));
    if (r.beatenOnlyBy && r.beatenOnlyBy.color === '=') bits.push(t('rl.c.beatenOwnColor'));
    for (const k of ['noLead', 'noThrow', 'noTransfer', 'noDefend', 'closesBout']) if (r[k]) bits.push(t('ci.' + k));
    if (!bits.length) continue;
    const key = bits.join('|');
    const label = d.name ? pickUI(d.name) : cardText(rs, d);
    if (seen.has(key + label)) continue;
    seen.add(key + label);
    out.push(label + ': ' + bits.join('; '));
  }
  return out;
}

// A beat rule is { by: matcher, beats: matcher, deny?, same? }; a matcher has optional rank/suit/color/id (scalar or
// list, normalised with [].concat). Empty matcher = any card. deny turns "X beats Y" into "X may not beat Y".
function beatRuleText(rs, b) {
  const m = (x) => {
    if (!x || !Object.keys(x).length) return t('rl.anyCard');
    const parts = [];
    if (x.rank) parts.push([].concat(x.rank).map((r) => (rs.deck.ranks.find((y) => y.id === r) || { label: r }).label).join('/'));
    if (x.suit) parts.push([].concat(x.suit).map((s) => (rs.deck.suits.find((y) => y.id === s) || { symbol: s }).symbol).join('/'));
    if (x.color) parts.push([].concat(x.color).join('/'));
    if (x.id) parts.push([].concat(x.id).join('/'));
    return parts.join(' ') || t('rl.anyCard');
  };
  const same = b.same ? ' ' + t('rl.same.' + b.same) : '';
  return (b.deny ? t('rl.deny', { a: m(b.by), b: m(b.beats) }) : t('rl.beatRule', { a: m(b.by), b: m(b.beats) })) + same;
}

// The id and content hash are shown so two players can confirm they play the identical ruleset (same hash).
export function rulesBody(rs) {
  const desc = rulesetDesc(rs);
  return h('div', { class: 'dk-rules' },
    desc ? h('p', { class: 'dk-rules-desc' }, desc) : null,
    h('ul', {}, rulesList(rs).map((s) => h('li', {}, s))),
    h('p', { class: 'ed-muted dk-hash' }, `${rs.id} · #${rs.hash}`));
}

export const uiLang = () => UI_STATE.lang;
