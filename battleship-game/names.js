// battleship-game/names.js - localized names of rulesets, ships, bots and levels, cell names (Latin letters, or the
// Cyrillic letters of the Russian school game), the rules of a ruleset in plain words and the moves of the public log
// as sentences.
//
//   rulesetName(rs), rulesetDesc(rs)      built-in presets through the dictionaries, own rulesets by their texts
//   shipName(rs, t), fleetText(rs)        a ship type by its name, its shape or its size
//   botName({ kind, name? }), botLabel('kind.level'), levelName(level)
//   cellLabel(rs, cell), colLabel(rs, x), rowLabel(y)
//   rulesList(rs) -> [string];  rulesBody(rs) -> element;  moveText(rs, entry, names) -> string

import { h } from '../ui/dom.js';
import { t, pickUI, ED_I18N } from '../ui/i18n.js';
import { normalizeRuleset, LETTERS, SHIP_NAMES, playerRange } from '../battleship/ruleset.js';
import { PRESETS } from '../battleship/presets.js';
import { templateById } from '../battleship/bots.js';
import { store } from './store.js';

const BUILTIN = new Set(PRESETS.map((p) => p.id));
const has = (k) => ED_I18N.en[k] != null;
// The ten column letters of the Russian school game: the alphabet without й (too similar to и), so "к" is the 10th.
// Only boards of at most 10 columns can use them (colLabel), larger boards fall back to Latin.
const CYR = 'абвгдежзик';

export function rulesetName(rs) {
  if (rs && BUILTIN.has(rs.id) && has(`preset.${rs.id}.name`)) return t(`preset.${rs.id}.name`);
  return pickUI(rs && rs.name) || (rs && rs.id) || '?';
}
export function rulesetDesc(rs) {
  if (rs && BUILTIN.has(rs.id) && has(`preset.${rs.id}.desc`)) return t(`preset.${rs.id}.desc`);
  return pickUI(rs && rs.description) || '';
}

export function shipName(rs, ti) {
  const tp = rs.types[ti];
  if (!tp) return '?';
  if (typeof tp.name === 'string' && SHIP_NAMES.includes(tp.name)) return t('ship.' + tp.name);
  if (tp.name) return pickUI(tp.name);
  if (tp.shape.builtin && !/^I\d+$/.test(tp.shape.id) && has('shape.' + tp.shape.id)) return t('shape.' + tp.shape.id);
  if (tp.shape.name) return pickUI(tp.shape.name);
  return t('ship.size', { n: tp.size });
}

export function fleetText(rs) {
  return rs.types.map((tp) => `${tp.count} × ${shipName(rs, tp.index)} (${tp.size})`).join(', ');
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

// Cell names: Latin letters (a1 … t20), or the Cyrillic letters of the school game on boards of at most 10 columns.
export const colLabel = (rs, x) => (store.settings.coords === 'cyrillic' && rs.board.width <= 10 ? CYR[x] : LETTERS[x]);
export const rowLabel = (y) => String(y + 1);
export function cellLabel(rs, cell) {
  const w = rs.board.width;
  return colLabel(rs, cell % w) + rowLabel(Math.floor(cell / w));
}

// The rules in sentences.
export function rulesList(raw) {
  const rs = raw.types ? raw : normalizeRuleset(raw);
  const R = rs.rules, W = rs.weapons;
  const out = [];
  out.push(rs.board.obstacles.length ? t('rl.boardIslands', { w: rs.board.width, h: rs.board.height, n: rs.board.obstacles.length }) : t('rl.board', { w: rs.board.width, h: rs.board.height }));
  out.push(t('rl.fleet', { fleet: fleetText(rs), n: rs.ships.length, cells: rs.cellCount }));
  if (rs.types.some((tp) => !/^I\d+$/.test(tp.shape.id) || !tp.shape.builtin)) out.push(t(rs.types.some((tp) => tp.shape.mirror) ? 'rl.shapesMirror' : 'rl.shapes'));
  out.push(t('rl.touch.' + R.touch));
  out.push(R.shots === 'volley' ? t('rl.shots.volley', { n: R.volley }) : t('rl.shots.' + R.shots));
  out.push(t(R.afterHit === 'again' ? 'rl.again' : 'rl.pass'));
  out.push(t('rl.announce.' + R.announce));
  if (R.halo && R.announce === 'ship' && R.touch !== 'any') out.push(t('rl.halo'));
  const pr = playerRange(rs);
  if (R.teams) out.push(t('rl.teams', { n: R.teams, min: pr.min, max: pr.max }));
  else if (pr.max > 2) out.push(t('rl.players', { min: pr.min, max: pr.max }));
  out.push(t('rl.first.' + R.first));
  if (W.radar) out.push(t('rl.radar', { n: W.radar, size: W.radarSize }));
  if (W.airstrike) out.push(t('rl.airstrike', { n: W.airstrike, len: W.airstrikeLength }));
  if (W.cluster) out.push(t('rl.cluster', { n: W.cluster }));
  if (W.mines) out.push(t('rl.mines', { n: W.mines }));
  return out;
}

export function rulesBody(rs) {
  const desc = rulesetDesc(rs);
  return h('div', { class: 'bs-rules' },
    desc ? h('p', { class: 'bs-rules-desc' }, desc) : null,
    h('ul', {}, rulesList(rs).map((s) => h('li', {}, s))),
    h('p', { class: 'ed-muted bs-hash' }, `${rs.id} · #${rs.hash}`));
}

// One public log entry as a sentence ('' for entries that are not told).
export function moveText(rs, e, names, n = 2) {
  const nm = (i) => names[i] || t('tb.player', { n: i + 1 });
  const cell = (c) => cellLabel(rs, c);
  const ans = (a, ti) => (a === 0 ? t('mv.miss') : a === 1 ? t('mv.hit') : a === 2 ? t('mv.sunk', { ship: ti != null ? shipName(rs, ti) : t('ship.ship') }) : t('mv.mine'));
  const two = (by, tg) => (n > 2 ? t('mv.at', { a: nm(by), b: nm(tg) }) : nm(by));
  switch (e[0]) {
    case 'P': return t('mv.placed', { name: nm(e[1]) });
    case 'T': return t('mv.turn', { name: nm(e[1]) });
    case 'S': return t('mv.shot', { who: two(e[1], e[2]), cell: cell(e[3]), answer: ans(e[4], e[5]) });
    case 'K': return t('mv.mineBack', { owner: nm(e[1]), victim: nm(e[2]), cell: cell(e[3]), answer: ans(e[4], e[5]) });
    case 'R': return t('mv.radar', { who: two(e[1], e[2]), cell: cell(e[3]), n: e[4] });
    case 'A': return t('mv.airstrike', { who: two(e[1], e[2]), cell: cell(e[3]), dir: t(e[4] === 'v' ? 'mv.column' : 'mv.row') });
    case 'C': return t('mv.cluster', { who: two(e[1], e[2]), cell: cell(e[3]) });
    case 'O': return t('mv.lost', { name: nm(e[1]) });
    case 'Q': return t('mv.resign', { name: nm(e[1]) });
    case 'E': return t('mv.end');
    default: return '';
  }
}
