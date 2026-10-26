// sudoku-game/common.js - small things the screens share: the artifact the page was built as (offline, serverless,
// backend, standalone or development), symbols chosen in the preferences, names and titles, time formats, share links,
// the daily puzzle and the colours of players.

//
// Design rule: everything here is a pure function of its inputs plus prefs(); no DOM. That keeps the module usable
// from tests and from the screens alike, and makes link encoding / daily puzzles deterministic.
import { t } from '../ui/i18n.js';
import { networked } from '../rooms/client.js';
import { ALPHABETS, needsLegend, parseCustom, symbolsFor } from '../sudoku/symbols.js';
import { variant as variantOf, VARIANTS, sizesFor, EXTRA_RULES } from '../sudoku/variants.js';
import { DIFFICULTIES, SYMMETRIES, normalize } from '../sudoku/generate.js';
import { prefs } from './store.js';

// --- the artifact ---------------------------------------------------------------------------------------------------

// IN_HTML_ARTIFACT is injected by the build; absent = raw sources on the dev server. typeof guards keep the module
// importable in Node (tests) where `location` does not exist.
const ART = (typeof globalThis !== 'undefined' && globalThis.IN_HTML_ARTIFACT) || null;
const httpPage = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);

// mode: 'offline' | 'serverless' | 'backend' | 'standalone' | 'dev'; online: rooms on a server are possible;
// ownServer: the page's own origin serves the rooms (backend builds, the development server).
export const ENV = {
  mode: ART ? ART.mode : 'dev',
  singlefile: ART ? !!ART.singlefile : false,
  servers: ART && Array.isArray(ART.servers) ? ART.servers.filter((s) => typeof s === 'string') : [],
  // `networked` is false in the offline bundle variant of rooms/client.js (no network code shipped at all).
  online: networked && !(ART && ART.mode === 'offline'),
  ownServer: (!ART && httpPage) || !!(ART && ART.mode === 'backend'),
};

// --- symbols ----------------------------------------------------------------------------------------------------------

// The symbols of the preferences for n values; alphabets that are too short (or a custom list of another length) fall
// back to digits.
// Never throws: a broken custom alphabet in storage must not make the board unplayable, digits always work.
export function symbolsOf(n, p = prefs()) {
  try {
    if (p.alphabet === 'custom') {
      if (parseCustom(p.custom, n).ok) return symbolsFor('custom', n, p.custom);
    } else if (ALPHABETS[p.alphabet] && ALPHABETS[p.alphabet].max >= n) return symbolsFor(p.alphabet, n);
  } catch { /* fall back */ }
  return symbolsFor('digits', n);
}

// Rules and clues whose meaning depends on numeric value (sums, differences, consecutiveness). With letters or
// colours as symbols the player needs a legend mapping symbol -> number. Quads and palindromes only compare
// equality, so any symbol set works without a legend.
const NUMERIC_RULES = new Set(['nonconsecutive', 'magic', 'kropki-neg', 'xv-neg', 'consec-neg']);
const SET_CLUES = new Set(['quad', 'palindrome']);
// The puzzle's clues use the numbers themselves (sums, order, differences…): other symbols need a legend.
export const numericPuzzle = (p) => (p.clues || []).some((c) => !SET_CLUES.has(c.t)) || (p.rules || []).some((r) => NUMERIC_RULES.has(r));
export const legendNeeded = (p, symbols) => numericPuzzle(p) && needsLegend(symbols);

// --- names --------------------------------------------------------------------------------------------------------------

export const variantName = (id) => t('sg.v.' + id);
export const difficultyName = (d) => t('sg.d.' + d);
export const sizeLabel = (p) => (p.layout ? `${p.n}×${p.n} ×${({ samurai: 5, twodoku: 2, butterfly: 4, sohei: 4, flower: 5 })[p.layout] || 1}` : `${p.n}×${p.n}`);
export function gameTitle(p) {
  return [variantName(p.variant || 'classic'), sizeLabel(p), p.difficulty ? difficultyName(p.difficulty) : ''].filter(Boolean).join(' · ');
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0');
}

// --- solutions as text (saved games) ----------------------------------------------------------------------------------

// 0..64; the first 26 characters are those of earlier saves
// One character per cell value, 0..64 (grids up to 64x64). The first 36 chars match base-36, the order of older
// saves, so saved games stay readable. Unknown characters decode to 0 (empty) instead of failing.
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_.';
export const solutionText = (sol) => Array.from(sol, (v) => DIGITS[v] || '0').join('');
export const solutionFrom = (s, size) => (typeof s === 'string' && s.length === size ? [...s].map((ch) => Math.max(0, DIGITS.indexOf(ch))) : null);

// --- links --------------------------------------------------------------------------------------------------------------

// A game as link parameters: seeded games by their options and seed (short), others by the puzzle code.
// Seeded games are shared as their generation recipe (options + seed): a few dozen characters regenerate the exact
// puzzle on the receiver's side, because the generator is deterministic for a seed. Non-seeded (crypto-random or
// imported) games must carry the whole puzzle code. Defaults are omitted (symmetry 'rotational') to keep links short.
export function shareParams(game) {
  const q = new URLSearchParams();
  if (game.random && game.random.kind === 'seeded' && game.options) {
    const o = game.options;
    q.set('v', o.variant);
    q.set('n', String(o.n));
    if (o.box) q.set('b', o.box.join('x'));
    else if (o.box === null && !variantOf(o.variant)?.layout && variantOf(o.variant)?.shape !== 'jigsaw') q.set('b', 'none');
    q.set('d', o.difficulty);
    if (o.symmetry && o.symmetry !== 'rotational') q.set('sym', o.symmetry);
    const extra = (o.rules || []).filter((r) => EXTRA_RULES.includes(r));
    if (extra.length) q.set('r', extra.join(','));
    q.set('seed', game.random.seed);
  } else q.set('p', game.code);
  return q;
}
// Parameters live in the fragment: never sent to a server, works from file:// and offline builds alike.
export const shareLink = (game) => location.href.split('#')[0] + '#' + shareParams(game).toString();

// Link parameters -> { options, random } | { code } | null (rooms: rooms/client.js parseInvite).
// Untrusted input (anyone can craft a link): normalize() validates options against the variant table and throws on
// nonsense, caught here into null; the seed is capped at 120 chars.
export function readLink(hash = typeof location !== 'undefined' ? location.hash : '') {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (q.get('p')) return { code: q.get('p') };
  if (!q.get('seed') || !q.get('v')) return null;
  const box = q.get('b');
  try {
    const options = normalize({
      variant: q.get('v'), n: +q.get('n') || 9,
      box: box === 'none' ? 'none' : box && /^\d+x\d+$/.test(box) ? box.split('x').map(Number) : null,
      difficulty: q.get('d') || 'medium', symmetry: q.get('sym') || 'rotational',
      rules: (q.get('r') || '').split(',').filter(Boolean),
    });
    return { options, random: { kind: 'seeded', seed: q.get('seed').slice(0, 120) } };
  } catch { return null; }
}

// --- daily puzzle ---------------------------------------------------------------------------------------------------------

// Daily rotation: variant by day index modulo the list, difficulty by weekday-like cycle of 7. Same date string =>
// same seed => the same puzzle for everybody on that (local) date, with no server.
const DAILY = ['classic', 'killer', 'jigsaw', 'thermo', 'diagonal', 'kropki', 'arrow', 'sandwich', 'windoku', 'xv', 'renban', 'whisper', 'littlekiller', 'antiknight', 'evenodd', 'consecutive', 'palindrome', 'skyscraper'];
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Day index from the date string parsed as UTC midnight: independent of the user's time zone offset, so the
  // mapping date -> variant is identical everywhere. The double modulo keeps negative indices (pre-1970) positive.
export function dailyGame(date = today()) {
  const day = Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
  const variant = DAILY[((day % DAILY.length) + DAILY.length) % DAILY.length];
  const difficulty = ['medium', 'hard', 'medium', 'easy', 'hard', 'medium', 'expert'][((day % 7) + 7) % 7];
  return { options: normalize({ variant, n: 9, difficulty }), random: { kind: 'seeded', seed: 'daily-' + date }, daily: date };
}

// --- players ----------------------------------------------------------------------------------------------------------------

// Eight distinguishable hues for seats; seat numbers wrap around. Raw colours: they identify players across skins.
export const PLAYER_COLORS = ['#2f7de1', '#e8590c', '#2f9e44', '#ae3ec9', '#d6336c', '#0c8599', '#f08c00', '#5f3dc4'];
export const playerColor = (seat) => PLAYER_COLORS[((seat % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];

// --- catalogue ---------------------------------------------------------------------------------------------------------------

export const GROUPS = ['classic', 'shape', 'rules', 'cells', 'lines', 'outside'];
export const variantsOf = (group) => VARIANTS.filter((v) => !group || group === 'all' || v.group === group);
export { DIFFICULTIES, SYMMETRIES, sizesFor };
