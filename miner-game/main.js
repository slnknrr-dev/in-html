// miner-game/main.js - Sapper: the game page. Settings and their storage, the game flow (new game, layout
// at the first click, no-guess generation with progress, reveal / flag / chord, win and loss, undo, hints), the
// heads-up display (mine counter, face, timer), the toolbar, result card, replays, share links, statistics and the
// resumed game after a reload.

//
// Architecture: game rules live in ../mines/ (Game, layout generation, solver, codes, stats) and are UI-free; this
// file is the controller that wires them to the view modules (board.js canvas, input.js gestures, panel.js
// settings, hud.js graphics, sound.js). Two module-level objects hold all state:
//   S - persisted settings (localStorage, debounced writes);
//   G - runtime: the current game, clock, generation job, replay, last result.
// Every user action goes through a do* function that checks playable(), mutates the Game and calls after(), the
// single place that animates, plays sounds, detects win/loss and persists the resumable state.
import './strings.js';
import { copyText, startApp, t, toast } from '../ui/app.js';
import { $, debounce, h, isEditable, lsGet, lsSet } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { layers, openMenu } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { FLAG, Game, HIDDEN, MARK, OPEN } from '../mines/game.js';
import { DEFAULT_CONFIG, PRESETS, configKey, normalizeConfig, presetOf } from '../mines/config.js';
import { runStepsAsync } from '../mines/layout.js';
import { analyzeView } from '../mines/solver.js';
import { bitsToMines, decodeGame, encodeGame } from '../mines/code.js';
import { normalizeStats, recordGame } from '../mines/stats.js';
import { randomSeed } from '../prng/prng.js';
import { createBoard } from './board.js';
import { bindInput, previewCells } from './input.js';
import { isDarkSkin, SKINS, symbolFn } from './skins.js';
import { play, setVolume } from './sound.js';
import { renderPanel, syncPanel, openPanelSheet, closePanelSheet } from './panel.js';
import { faceSVG, lcdSVG } from './hud.js';

addIcons({
  mine: 'M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22M4.9 4.9l2.5 2.5M16.6 16.6l2.5 2.5M4.9 19.1l2.5-2.5M16.6 7.4l2.5-2.5',
  flag: 'M6 21V4M6 4h11l-2.5 4L17 12H6',
  tap: 'M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 10.5V9a1.5 1.5 0 0 1 3 0v2M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5.1-2.9L4 14.2a1.5 1.5 0 0 1 2.4-1.8L9 15',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  fit: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8.5 8.5h7v7h-7zM12 8.5v7M8.5 12h7',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  minimize: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM16 7.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM8 15.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM16 15.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z',
  replay: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M10 9l5 3-5 3z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  sound: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  mute: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  calendar: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01',
  clock: 'M12 22a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 9.5v4l2.5 1.6M9.5 2h5M12 2v3',
  back: 'M19 5v14M15 5 6 12l9 7z',
});

const KEY = 'miner';
const LOGO = 'M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8';

// ---- settings -------------------------------------------------------------------------------------------------------
// Defaults favour the classic experience: seeded PRNG (so every board is shareable by seed), classic skin, sound off
// (autoplaying sound is hostile), chord-by-click on, undo off (undo changes what a record means).
const DEFAULTS = {
  cfg: { ...DEFAULT_CONFIG },
  random: 'seeded', // 'seeded' (PRNG, shareable) | 'crypto' (CSPRNG)
  skin: 'classic', symbols: 'digits', custom: '', mineGlyph: '', flagGlyph: '',
  motion: 'auto', sound: false, volume: 0.6, upright: true, vibrate: true, longPress: 380, chordClick: true, allowUndo: false,
  tapFlags: false, // a tap / left click flags and a long press / right click opens (the Open / Flag switch)
  open: { new: true, rules: true, controls: false, seed: false, look: true, records: false, help: false },
};

// Stored settings are merged over defaults (new keys appear after updates) and validated: normalizeConfig clamps
// sizes/mines to legal ranges and an unknown skin falls back - corrupt or old storage never breaks boot.
function loadSettings() {
  const s = lsGet(KEY + '-settings', null);
  const out = { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  out.cfg = normalizeConfig(out.cfg);
  out.open = { ...DEFAULTS.open, ...(out.open || {}) };
  if (!SKINS[out.skin]) out.skin = 'classic';
  return out;
}
const S = loadSettings();
// Debounced 200 ms: sliders and typing would otherwise write localStorage on every event (synchronous I/O).
const saveSettings = debounce(() => lsSet(KEY + '-settings', S), 200);

let stats = normalizeStats(lsGet(KEY + '-stats', null));
const saveStats = () => lsSet(KEY + '-stats', stats);

// ---- runtime --------------------------------------------------------------------------------------------------------
const G = {
  game: null,
  startAt: 0, // performance.now() of the first reveal (moved back by the time of a resumed game)
  timer: 0,
  flagMode: S.tapFlags,
  generating: null, // { aborted }
  replay: null,
  daily: '',
  retry: false,
  result: null,
  pending: false, // settings changed during a game: they apply to the next one
  face: 'idle',
};

let board, input, stage, field, hudMines, hudTime, faceBtn, tools, overlay, chip, live, panel;

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const motionOn = () => S.motion === 'on' || (S.motion === 'auto' && !reduceMotion());
const coarse = () => matchMedia('(pointer: coarse)').matches;
// Explicit page theme ([data-theme] from the header switch) wins over the OS preference.
function scheme() {
  const th = document.documentElement.getAttribute('data-theme');
  if (th === 'dark' || th === 'light') return th;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyLook() {
  const sch = scheme();
  stage.dataset.skin = S.skin;
  stage.dataset.dark = isDarkSkin(S.skin, sch) ? '1' : '0';
  board.setSkin(S.skin, sch);
  board.setLook({ symbol: symbolFn(S.symbols, S.custom), mineGlyph: S.mineGlyph.trim(), flagGlyph: S.flagGlyph.trim() });
  board.setMotion(motionOn());
  board.setUpright(S.upright);
  setVolume(S.volume);
  updateHud();
}

// ---- clock and HUD ------------------------------------------------------------------------------------------------------
// performance.now(), not Date.now(): monotonic, immune to system clock changes mid-game. A resumed game moves startAt
// back by the saved elapsed time, so the timer continues where it stopped.
const elapsed = () => (G.startAt ? performance.now() - G.startAt : 0);
function shownMs() {
  if (G.replay) return G.replay.t;
  const g = G.game;
  if (!g) return 0;
  if (g.over) return g.time;
  return g.status === 'playing' ? elapsed() : 0;
}
// The interval only repaints the time display (100 ms for a responsive tenth-second feel); the authoritative time is
// always computed from startAt, so throttled background timers cannot make the clock drift.
function startClock(offset = 0) {
  G.startAt = performance.now() - offset;
  clearInterval(G.timer);
  G.timer = setInterval(updateTime, 100);
}
function stopClock() { clearInterval(G.timer); G.timer = 0; }

const LCD_SKINS = new Set(['classic', 'neon', 'terminal']);
// Three-digit LCD like the original: clamped at 999 / -99; negative when more flags than mines are placed.
function lcdText(n, digits = 3) {
  if (n < 0) return '-' + String(Math.min(10 ** (digits - 1) - 1, -n)).padStart(digits - 1, '0');
  return String(Math.min(10 ** digits - 1, n)).padStart(digits, '0');
}
function timeText(ms) {
  const s = Math.floor(ms / 1000);
  return s < 1000 ? lcdText(s) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// Skips DOM writes when text and skin are unchanged (called every 100 ms by the clock). LCD skins get the
// seven-segment SVG, others plain text styled by CSS.
function setLcd(el, text, label) {
  if (el.dataset.v === text + S.skin) return;
  el.dataset.v = text + S.skin;
  el.setAttribute('aria-label', label);
  const v = el.querySelector('.mn-lcd-v');
  if (LCD_SKINS.has(S.skin)) v.innerHTML = lcdSVG(text);
  else v.textContent = text;
}
function updateTime() {
  const ms = shownMs();
  setLcd(hudTime, timeText(ms), t('mn.hud.time', { n: Math.floor(ms / 1000) }));
}
function setFace(f) {
  G.face = f;
  faceBtn.innerHTML = faceSVG(f);
  faceBtn.dataset.face = f;
}
function updateHud() {
  const g = G.replay ? G.replay.game : G.game;
  if (!g || !hudMines) return;
  setLcd(hudMines, lcdText(g.remaining, Math.max(3, String(g.cfg.mines).length)), t('mn.hud.mines', { n: g.remaining }));
  updateTime();
  setFace(g.status === 'won' ? 'won' : g.status === 'lost' ? 'lost' : G.face === 'press' ? 'press' : 'idle');
  updateChip();
  syncTools();
}

function cfgLabel(cfg) {
  const p = presetOf(cfg);
  const parts = [p ? t('mn.preset.' + p) : `${cfg.w} × ${cfg.h} · ${cfg.mines}`];
  if (cfg.grid === 'hex') parts.push(t('mn.grid.hex'));
  if (cfg.nb !== 'king') parts.push(t(`mn.nb.${cfg.grid === 'hex' ? 'hex.' : ''}${cfg.nb}`));
  if (cfg.wrap) parts.push(t('mn.wrap.short'));
  if (cfg.noGuess) parts.push(t('mn.ng.short'));
  return parts.join(' · ');
}

function updateChip() {
  const g = G.replay ? G.replay.game : G.game;
  if (!g) return;
  chip.textContent = '';
  if (G.replay) chip.append(h('span', { class: 'mn-chip-tag' }, t('mn.replay')));
  else if (G.daily) chip.append(h('span', { class: 'mn-chip-tag' }, t('mn.daily.tag', { date: G.daily })));
  chip.append(h('span', null, cfgLabel(g.cfg)));
  let tip = '';
  if (!G.replay && g.status === 'ready' && !G.generating) {
    tip = g.cfg.first === 'marked' || g.start >= 0 ? t('mn.tip.marked') : coarse() ? t('mn.tip.tap') : t('mn.tip.click');
  }
  if (tip) chip.append(h('span', { class: 'mn-chip-tip' }, tip));
}

// ---- game flow ----------------------------------------------------------------------------------------------------------
// The single gate for every game-changing input: no game, a replay, a running generation, or a finished game.
const playable = () => !!G.game && !G.replay && !G.generating && !G.game.over;

// Seeded: reproducible from the seed string (shareable, daily challenge). Crypto: CSPRNG layout that nobody can
// reproduce or predict - for players who distrust seeds; such boards are shared as an explicit layout instead.
function sourceFor(random, seed) {
  return random === 'crypto' ? { kind: 'crypto' } : { kind: 'seeded', seed: seed || randomSeed() };
}

// Starts a game. Aborts a running no-guess generation first (the job object's aborted flag is polled by the async
// generator). Layout is normally created at the first click (so the first click can be guaranteed safe); modes
// "marked"/"off" lay out immediately because they need no click position.
async function newGame({ cfg = S.cfg, source = null, start = -1, daily = '', retry = false, resume = null } = {}) {
  if (G.generating) G.generating.aborted = true;
  G.generating = null;
  if (G.replay) exitReplay(false);
  stopClock();
  G.startAt = 0;
  G.pending = false;
  G.result = null;
  G.daily = daily;
  G.retry = retry;
  const g = new Game(cfg, source || sourceFor(S.random));
  if (start >= 0 && start < g.n && g.start < 0) g.start = start;
  G.game = g;
  hideOverlay();
  input?.reset();
  board.setGame(g, { focus: g.start });
  setFace('idle');
  updateHud();
  syncPanel(panel, S, G);
  if (resume) applyResume(resume);
  else if (g.needsLayout() && (g.cfg.first === 'marked' || g.cfg.first === 'off')) await makeLayout(g.layoutFirst(-1));
  saveResume();
}

// Creates the layout: a plain one at once (milliseconds even for 500 × 500), a no-guess one in time slices with a
// progress card.
// No-guess generation can take seconds on large boards: runStepsAsync runs the generator in time slices (yielding to
// the event loop) so the page stays responsive and the progress card can show progress and offer Cancel.
// G.game !== g after the await means the player started another game meanwhile: the result is discarded.
async function makeLayout(first) {
  const g = G.game;
  if (!g.needsLayout()) return true;
  if (!g.cfg.noGuess) { g.prepare(first); board.redraw(); return true; }
  const job = { aborted: false };
  G.generating = job;
  showGenerating(0);
  const res = await runStepsAsync(g.layoutSteps(first), { onProgress: (p) => showGenerating(p), signal: job });
  if (G.game !== g) return false; // a new game started meanwhile
  G.generating = null;
  hideOverlay();
  if (!res) {
    // cancelled: a plain board instead
    g.cfg.noGuess = false;
    g.prepare(first);
    toast(t('mn.ng.cancelled'), 'warn');
  } else if (res.ok === false) toast(t('mn.ng.failed'), 'warn');
  board.redraw();
  updateHud();
  return true;
}

function vibrate(ms) { if (S.vibrate && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* not allowed */ } } }
function sound(name) { if (S.sound) play(name); }

// The first reveal triggers layout around the clicked cell, then starts the clock: thinking before the first click
// is free, as in the original game.
async function doReveal(i) {
  const g = G.game;
  if (!playable() || g.st[i] === OPEN || g.st[i] === FLAG) return;
  if (g.needsLayout()) {
    const ok = await makeLayout(g.layoutFirst(i));
    if (!ok || G.game !== g) return;
  }
  if (g.status === 'ready') startClock();
  after(g.reveal(i, elapsed()), i, 'reveal');
}
function doFlag(i) {
  const g = G.game;
  if (!playable()) return;
  const before = g.st[i];
  const r = g.flag(i, elapsed());
  if (r) { sound(before === 0 ? 'flag' : 'unflag'); if (g.st[i] === FLAG) board.animateFlag(i); }
  after(r, i, 'flag');
}
function doChord(i) {
  const g = G.game;
  if (!playable()) return;
  const r = g.chord(i, elapsed());
  if (r && !r.lost) sound('chord');
  after(r, i, 'chord');
}

// Post-move pipeline shared by reveal/flag/chord (and therefore by every input path). r is the Game's move result:
// null (no-op), { lost, boom } or { opened, won }.
function after(r, origin, kind) {
  const g = G.game;
  board.clearHint();
  if (!r) { updateHud(); return; }
  if (r.lost) {
    stopClock();
    board.animateLoss(r.boom);
    sound('boom');
    vibrate([60, 40, 120]);
    finish(false);
  } else {
    if (r.opened.length) { board.animateReveal(r.opened, origin); if (kind !== 'chord') sound(r.opened.length > 6 ? 'cascade' : 'reveal'); }
    else board.redraw();
    if (r.won) { stopClock(); board.animateWin(); sound('win'); vibrate([30, 40, 30, 40, 60]); finish(true); }
  }
  updateHud();
  saveResume();
  if (g.over) announce(g.status === 'won' ? t('mn.res.won.live', { time: secText(g.time) }) : t('mn.res.lost.live'));
}

const secText = (ms) => (ms / 1000).toFixed(ms < 100000 ? 2 : 1) + ' ' + t('mn.unit.s');

// Records the result. Assisted games (hints used, undo, retry of a known layout) are counted but never ranked, so
// records stay comparable. Replays above ~24 kB are not stored with the record (localStorage quota is ~5 MB per
// origin and shared with every other app of the site). The result card waits for the loss/win animation.
function finish(won) {
  const g = G.game;
  const assisted = g.assisted || G.retry;
  const key = configKey(g.cfg);
  const replay = replayCode(g);
  const rank = recordGame(stats, key, {
    won, ms: g.time, date: Date.now(), assisted, bbbv: g.bbbv, clicks: g.clicks,
    seed: g.seed, replay: replay.length < 24000 ? replay : undefined,
  });
  saveStats();
  lsSet(KEY + '-last', replay.length < 200000 ? replay : '');
  G.result = { won, ms: g.time, rank, assisted, bbbv: g.bbbv, clicks: g.clicks, progress: g.progress(), key };
  lsSet(KEY + '-resume', null);
  syncPanel(panel, S, G, stats);
  setTimeout(() => { if (G.game === g && g.over && !G.replay) showResult(); }, motionOn() ? (won ? 900 : 1300) : 0);
}

// A replay = config + exact mine layout bits + start cell + timestamped moves. Storing the layout (not the seed) makes
// crypto-random games replayable too.
function replayCode(g) {
  return encodeGame({ cfg: g.cfg, bits: g.layoutBits(), start: g.first >= 0 ? g.first : g.start, moves: g.moves });
}

// Undo after a loss revives the game and continues the clock from the moment of the loss (no free time).
function undo() {
  const g = G.game;
  if (!S.allowUndo || !g || G.replay || G.generating || !g.canUndo()) return;
  const wasLost = g.status === 'lost', lossTime = g.time;
  const r = g.undo(wasLost ? lossTime : elapsed());
  if (!r) return;
  if (wasLost) {
    // the clock goes on from the time of the loss
    startClock(lossTime);
    hideOverlay();
    G.result = null;
  }
  board.setGame(g, { keep: true });
  board.redraw();
  sound('click');
  updateHud();
  saveResume();
}

// ---- hints -----------------------------------------------------------------------------------------------------------
const RULE_KEYS = { single: 'mn.hint.why.single', pair: 'mn.hint.why.pair', count: 'mn.hint.why.count', enum: 'mn.hint.why.enum' };
// Hints come from the solver run on the player-visible state only (g.view()), never on the hidden layout: a hint is
// what a perfect player could deduce now. Priority: point out a wrong flag, then a provably safe cell, then a
// provable mine, else the guess with the lowest mine probability. Every hint marks the game as assisted (g.hints).
function hint() {
  const g = G.game;
  if (!g || G.replay || G.generating || g.over) return;
  if (g.status === 'ready') {
    if (g.start >= 0) { board.hint(g.start, 'safe'); toast(t('mn.hint.start')); }
    else toast(t(g.cfg.first === 'off' ? 'mn.hint.firstOff' : 'mn.hint.first'));
    return;
  }
  const a = analyzeView(g.topo, g.view());
  g.hints++;
  sound('hint');
  if (a.wrongFlags.length) { board.hint(a.wrongFlags[0], 'wrong'); toast(t('mn.hint.wrong'), 'warn'); updateHud(); return; }
  const safe = a.safe.find((d) => g.st[d.cell] !== OPEN && g.st[d.cell] !== FLAG);
  if (safe) { board.hint(safe.cell, 'safe'); toast(t('mn.hint.safe') + ' ' + t(RULE_KEYS[safe.rule] || RULE_KEYS.single)); updateHud(); return; }
  const mine = a.mines.find((d) => g.st[d.cell] !== FLAG);
  if (mine) { board.hint(mine.cell, 'mine'); toast(t('mn.hint.mine') + ' ' + t(RULE_KEYS[mine.rule] || RULE_KEYS.single)); updateHud(); return; }
  if (a.best >= 0) { board.hint(a.best, 'guess'); toast(t('mn.hint.guess', { p: Math.round(a.bestP * 100) }), 'warn'); }
  else toast(t('mn.hint.none'));
  updateHud();
}

// ---- overlays: generating, result --------------------------------------------------------------------------------------
function hideOverlay() { overlay.hidden = true; overlay.textContent = ''; overlay.className = 'mn-overlay'; }

function showGenerating(p) {
  if (!overlay.classList.contains('mn-gen')) {
    overlay.textContent = '';
    overlay.className = 'mn-overlay mn-gen';
    overlay.hidden = false;
    const bar = h('div', { class: 'ap-progress' }, h('i'));
    overlay.append(h('div', { class: 'mn-card', role: 'status' },
      h('div', { class: 'mn-card-h' }, t('mn.ng.building')),
      h('p', { class: 'mn-card-p' }, t('mn.ng.explain')),
      bar,
      h('div', { class: 'mn-card-actions' }, h('button', { type: 'button', class: 'ed-btn', onclick: () => { if (G.generating) G.generating.aborted = true; } }, t('dlg.cancel')))));
  }
  const i = overlay.querySelector('.ap-progress > i');
  if (i) i.style.width = Math.round(Math.max(0.03, p) * 100) + '%';
}

// 3BV (minimum clicks to clear the board without flags) and 3BV/s measure skill independent of board luck;
// efficiency = 3BV / clicks actually used. Focus goes to the primary button for keyboard players.
function showResult() {
  const r = G.result, g = G.game;
  if (!r) return;
  overlay.textContent = '';
  overlay.className = 'mn-overlay mn-result ' + (r.won ? 'mn-won' : 'mn-lost');
  overlay.hidden = false;
  const close = h('button', { type: 'button', class: 'ed-iconbtn mn-card-x', 'aria-label': t('dlg.close'), title: t('dlg.close'), onclick: hideOverlay }, iconEl('close'));
  const lines = [];
  if (r.won) {
    const sec = Math.max(0.001, r.ms / 1000);
    lines.push(h('div', { class: 'mn-big' }, secText(r.ms)));
    lines.push(h('dl', { class: 'mn-facts' },
      h('dt', null, '3BV'), h('dd', null, String(r.bbbv)),
      h('dt', null, '3BV/s'), h('dd', null, (r.bbbv / sec).toFixed(2)),
      h('dt', null, t('mn.res.eff')), h('dd', null, Math.round((r.bbbv / Math.max(1, r.clicks)) * 100) + '%')));
    if (r.rank) lines.push(h('div', { class: 'mn-badge-best' }, iconEl('trophy'), t(r.rank === 1 ? 'mn.res.best' : 'mn.res.rank', { n: r.rank })));
    else if (r.assisted) lines.push(h('p', { class: 'mn-card-p' }, t(G.retry ? 'mn.res.retryNote' : 'mn.res.assisted')));
  } else {
    lines.push(h('p', { class: 'mn-card-p' }, t('mn.res.cleared', { p: Math.floor(r.progress * 100) })));
    lines.push(h('div', { class: 'mn-progress' }, h('i', { style: { width: Math.floor(r.progress * 100) + '%' } })));
  }
  const btn = (label, ic, fn, kind = '') => h('button', { type: 'button', class: 'ed-btn' + (kind ? ' ed-' + kind : ''), onclick: fn }, iconEl(ic), t(label));
  const actions = h('div', { class: 'mn-card-actions' },
    btn('mn.newGame', 'refresh', () => newGame(), 'primary'),
    r.won ? null : btn('mn.res.retry', 'rotate', retryBoard),
    !r.won && S.allowUndo && g.canUndo() ? btn('mn.undo', 'undo', undo) : null,
    btn('mn.replay.watch', 'replay', () => startReplay(replayCode(g))),
    btn('mn.share.board', 'link', copyBoardLink));
  const card = h('div', { class: 'mn-card', role: 'dialog', 'aria-label': t(r.won ? 'mn.res.won' : 'mn.res.lost') },
    close,
    h('div', { class: 'mn-card-h' }, h('span', { class: 'mn-card-face', html: faceSVG(r.won ? 'won' : 'lost') }), t(r.won ? 'mn.res.won' : 'mn.res.lost')),
    ...lines, actions);
  overlay.append(card);
  requestAnimationFrame(() => card.querySelector('.ed-primary')?.focus({ preventScroll: true }));
}

// Same layout again (source kind "layout"): a learning tool, hence G.retry marks the game as assisted.
function retryBoard() {
  const g = G.game;
  if (!g || !g.mine) return;
  newGame({ cfg: g.cfg, source: { kind: 'layout', mine: g.mine, start: g.first }, retry: true, daily: G.daily });
}

// ---- share ------------------------------------------------------------------------------------------------------------
// Share links carry the game code in the hash: hashes are never sent to a server, and the page works from file://.
function shareURL(code) { return location.href.split('#')[0] + '#' + code; }
// Seeded boards share the seed (short); otherwise the layout bits (longer). Before the first click a non-seeded game
// has no layout yet, so there is nothing to share.
function boardCode(g = G.game) {
  if (!g) return '';
  const start = g.first >= 0 ? g.first : g.start;
  if (g.kind === 'seeded') return encodeGame({ cfg: g.cfg, seed: g.seed, start });
  if (g.mine) return encodeGame({ cfg: g.cfg, bits: g.layoutBits(), start });
  return '';
}
function copyBoardLink() {
  const code = boardCode();
  if (!code) { toast(t('mn.share.notYet'), 'warn'); return; }
  copyText(shareURL(code), t('mn.share.copied'));
}
function copySeed() {
  const g = G.game;
  if (!g || g.kind !== 'seeded') { toast(t('mn.seed.none'), 'warn'); return; }
  copyText(g.seed, t('mn.seed.copied'));
}

// Opens a game code or link: a board (seed or layout), or a replay when it carries moves.
function openCode(text, { quiet = false } = {}) {
  const d = decodeGame(text);
  if (!d) { if (!quiet) toast(t('mn.code.bad'), 'warn'); return false; }
  if (d.moves && d.moves.length && (d.bits || d.seed != null)) {
    if (!G.game) newGame();
    startReplay(text);
    return true;
  }
  const source = d.seed != null ? { kind: 'seeded', seed: d.seed } : d.bits ? { kind: 'layout', mine: bitsToMines(d.bits, d.cfg.w * d.cfg.h), start: d.start } : null;
  if (!source) { if (!quiet) toast(t('mn.code.bad'), 'warn'); return false; }
  newGame({ cfg: d.cfg, source, start: d.start });
  if (!quiet) toast(t('mn.code.loaded'), 'ok');
  return true;
}

// Daily challenge: local date -> seed "daily-YYYY-MM-DD", fixed intermediate no-guess rules. Everyone gets the same
// board on the same calendar day without any server.
function daily() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cfg = normalizeConfig({ ...PRESETS.intermediate, grid: 'square', nb: 'king', wrap: false, first: 'marked', noGuess: true, marks: S.cfg.marks });
  newGame({ cfg, source: { kind: 'seeded', seed: 'daily-' + date }, daily: date });
}

// ---- replays ------------------------------------------------------------------------------------------------------------
// Seeded replays may lack layout bits: replaying the moves on a fresh seeded game reproduces the layout (layout
// depends only on seed and first click), which is then used for the real playback.
function startReplay(code) {
  const d = decodeGame(code);
  if (!d || !d.moves) { toast(t('mn.code.bad'), 'warn'); return; }
  let mine = d.bits ? bitsToMines(d.bits, d.cfg.w * d.cfg.h) : null;
  if (!mine && d.seed != null) {
    // seeded replays without a layout: play the moves on the seeded game to recover it
    const probe = new Game(d.cfg, { kind: 'seeded', seed: d.seed });
    for (const m of d.moves) probe.apply(m);
    mine = probe.mine;
  }
  if (!mine) { toast(t('mn.code.bad'), 'warn'); return; }
  hideOverlay();
  const total = d.moves.length ? d.moves[d.moves.length - 1][0] : 0;
  G.replay = { cfg: d.cfg, mine, start: d.start, moves: d.moves, total, t: 0, idx: 0, game: null, playing: true, speed: 1, last: 0, raf: 0 };
  seekReplay(0);
  renderReplayBar();
  board.setInset(replayBar ? replayBar.getBoundingClientRect().height + 16 : 0);
  replayLoop();
}
function replayGame() { const r = G.replay; return new Game(r.cfg, { kind: 'layout', mine: r.mine, start: r.start }); }
// Seeking rebuilds the game from scratch and re-applies moves up to the target time: Game has no reverse moves, and
// re-simulation is fast (moves are few compared with cells).
function seekReplay(ms) {
  const r = G.replay;
  r.game = replayGame();
  r.idx = 0;
  r.t = Math.max(0, Math.min(r.total, ms));
  while (r.idx < r.moves.length && r.moves[r.idx][0] <= r.t) r.game.apply(r.moves[r.idx++]);
  board.setGame(r.game, { keep: true });
  updateHud();
}
// rAF-driven playback with real frame deltas scaled by speed; moves are applied when their timestamp is reached.
function replayLoop() {
  const r = G.replay;
  if (!r) return;
  cancelAnimationFrame(r.raf);
  r.last = performance.now();
  const tick = (now) => {
    if (G.replay !== r) return;
    const dt = now - r.last;
    r.last = now;
    if (r.playing) {
      r.t = Math.min(r.total, r.t + dt * r.speed);
      while (r.idx < r.moves.length && r.moves[r.idx][0] <= r.t) {
        const m = r.moves[r.idx++];
        const res = r.game.apply(m);
        if (res) {
          if (res.lost) board.animateLoss(res.boom);
          else if (res.opened.length) board.animateReveal(res.opened, m[2]);
          else if (m[1] === 1 && r.game.st[m[2]] === FLAG) board.animateFlag(m[2]);
          else board.redraw();
          if (res.won) board.animateWin();
          if (m[2] >= 0) board.mark(m[2]);
        }
      }
      if (r.t >= r.total && r.idx >= r.moves.length) { r.playing = false; renderReplayBar(); }
      updateHud();
      syncReplayBar();
    }
    r.raf = requestAnimationFrame(tick);
  };
  r.raf = requestAnimationFrame(tick);
}
function exitReplay(restore = true) {
  const r = G.replay;
  if (!r) return;
  cancelAnimationFrame(r.raf);
  G.replay = null;
  overlay.hidden = true;
  overlay.textContent = '';
  overlay.className = 'mn-overlay';
  board.clearHint();
  board.setInset(0);
  if (restore && G.game) board.setGame(G.game, { keep: true });
  updateHud();
  if (restore && G.game && G.game.over && G.result) showResult();
}
let replayBar = null;
function renderReplayBar() {
  const r = G.replay;
  if (!r) return;
  overlay.textContent = '';
  overlay.className = 'mn-overlay mn-replaybar';
  overlay.hidden = false;
  const range = h('input', { type: 'range', class: 'ed-range', min: 0, max: Math.max(1, r.total), step: 1, value: r.t, 'aria-label': t('mn.replay.seek') });
  range.addEventListener('input', () => { seekReplay(+range.value); syncReplayBar(); });
  const speed = h('select', { class: 'ed-input ed-select mn-speed', 'aria-label': t('mn.replay.speed') },
    [0.5, 1, 2, 4, 8].map((v) => h('option', { value: v, selected: v === r.speed }, v + '×')));
  speed.addEventListener('change', () => { r.speed = +speed.value; });
  const playBtn = h('button', { type: 'button', class: 'mn-tool', title: t(r.playing ? 'mn.replay.pause' : 'mn.replay.play'), 'aria-label': t(r.playing ? 'mn.replay.pause' : 'mn.replay.play'), onclick: () => {
    if (!r.playing && r.t >= r.total) seekReplay(0);
    r.playing = !r.playing;
    r.last = performance.now();
    renderReplayBar();
  } }, iconEl(r.playing ? 'pause' : 'play'));
  replayBar = h('div', { class: 'mn-rbar', role: 'toolbar', 'aria-label': t('mn.replay') },
    h('button', { type: 'button', class: 'mn-tool', title: t('mn.replay.restart'), 'aria-label': t('mn.replay.restart'), onclick: () => { seekReplay(0); r.playing = true; renderReplayBar(); } }, iconEl('back')),
    playBtn, range, h('span', { class: 'mn-rtime' }), speed,
    h('button', { type: 'button', class: 'mn-tool', title: t('mn.replay.exit'), 'aria-label': t('mn.replay.exit'), onclick: () => exitReplay() }, iconEl('close')));
  overlay.append(replayBar);
  syncReplayBar();
}
function syncReplayBar() {
  const r = G.replay;
  if (!r || !replayBar) return;
  const range = replayBar.querySelector('input[type=range]');
  if (range && document.activeElement !== range) range.value = r.t;
  const tm = replayBar.querySelector('.mn-rtime');
  if (tm) tm.textContent = `${(r.t / 1000).toFixed(1)} / ${(r.total / 1000).toFixed(1)} ${t('mn.unit.s')}`;
}

// ---- resume after a reload -----------------------------------------------------------------------------------------------
// Resumable state saved after moves (debounced), on tab hide and every 5 s while playing. Codes above 400 kB are
// skipped rather than risking a QuotaExceededError that would also block other saves.
const saveResume = debounce(() => {
  const g = G.game;
  if (!g || g.over || g.status !== 'playing' || G.replay) { if (g && g.status === 'ready') lsSet(KEY + '-resume', null); return; }
  const code = encodeGame({ cfg: g.cfg, bits: g.layoutBits(), start: g.start, moves: g.moves });
  if (code.length > 400000) return;
  lsSet(KEY + '-resume', { code, ms: elapsed(), seed: g.seed, kind: g.kind, hints: g.hints, undos: g.undos, daily: G.daily, retry: G.retry });
}, 300);

function applyResume(rs) {
  const g = G.game;
  const d = decodeGame(rs.code);
  if (!d || !d.moves) return;
  for (const m of d.moves) g.apply(m);
  g.hints = rs.hints || 0;
  g.undos = Math.max(g.undos, rs.undos || 0);
  if (rs.seed != null) { g.seed = rs.seed; g.kind = rs.kind || g.kind; }
  if (g.status === 'playing') startClock(rs.ms || 0);
  board.setGame(g, { keep: false, focus: g.first });
  updateHud();
}

function tryResume() {
  const rs = lsGet(KEY + '-resume', null);
  if (!rs || !rs.code) return false;
  const d = decodeGame(rs.code);
  if (!d || !d.bits) return false;
  newGame({ cfg: d.cfg, source: { kind: 'layout', mine: bitsToMines(d.bits, d.cfg.w * d.cfg.h), start: d.start }, resume: rs, daily: rs.daily || '', retry: !!rs.retry });
  return true;
}

// ---- toolbar ----------------------------------------------------------------------------------------------------------
function toolBtn(ic, label, onclick, extra = {}) {
  return h('button', { type: 'button', class: 'mn-tool', title: t(label), 'aria-label': t(label), dataset: { k: label }, onclick, ...extra }, iconEl(ic));
}
// Flag mode swaps primary and secondary actions (tap flags, long press opens): essential on touch screens without a
// right button.
function setFlagMode(on) {
  G.flagMode = S.tapFlags = !!on;
  saveSettings();
  syncTools();
  syncPanel(panel, S, G);
}
function renderTools() {
  tools.textContent = '';
  tools.setAttribute('aria-label', t('mn.tools'));
  const mode = h('div', { class: 'mn-mode', role: 'radiogroup', 'aria-label': t('mn.mode') },
    h('button', { type: 'button', role: 'radio', class: 'mn-mode-btn', dataset: { m: 'dig' }, title: t('mn.mode.dig'), onclick: () => setFlagMode(false) }, iconEl('tap'), h('span', null, t('mn.mode.dig'))),
    h('button', { type: 'button', role: 'radio', class: 'mn-mode-btn', dataset: { m: 'flag' }, title: t('mn.mode.flag') + ' (M)', onclick: () => setFlagMode(true) }, iconEl('flag'), h('span', null, t('mn.mode.flag'))));
  tools.append(
    mode,
    h('span', { class: 'mn-sep' }),
    toolBtn('bulb', 'mn.hint', hint),
    toolBtn('undo', 'mn.undo', undo, { class: 'mn-tool mn-undo' }),
    h('span', { class: 'mn-sep' }),
    toolBtn('zoomOut', 'mn.zoomOut', () => board.zoomBy(1 / 1.25), { class: 'mn-tool mn-wide-only' }),
    toolBtn('fit', 'mn.fit', () => board.fit(G.game && G.game.status === 'ready' ? G.game.start : -1, true)),
    toolBtn('zoomIn', 'mn.zoomIn', () => board.zoomBy(1.25), { class: 'mn-tool mn-wide-only' }),
    h('span', { class: 'mn-sep mn-wide-only' }),
    toolBtn(S.sound ? 'sound' : 'mute', S.sound ? 'mn.sound.off' : 'mn.sound.on', () => { S.sound = !S.sound; saveSettings(); if (S.sound) play('click'); renderTools(); syncPanel(panel, S, G); }, { class: 'mn-tool mn-wide-only' }),
    toolBtn(document.fullscreenElement ? 'minimize' : 'maximize', document.fullscreenElement ? 'mn.fullscreen.exit' : 'mn.fullscreen', toggleFull, { class: 'mn-tool mn-full' }),
    toolBtn('settings', 'mn.settings', () => openPanelSheet(panel), { class: 'mn-tool mn-sheet-btn' }),
  );
  syncTools();
}
function syncTools() {
  if (!tools) return;
  for (const b of tools.querySelectorAll('.mn-mode-btn')) {
    const on = (b.dataset.m === 'flag') === G.flagMode;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('mn-on', on);
  }
  const g = G.game;
  const u = tools.querySelector('.mn-undo');
  if (u) { u.hidden = !S.allowUndo; u.disabled = !g || !g.canUndo() || !!G.replay; }
  const hb = tools.querySelector('[data-k="mn.hint"]');
  if (hb) hb.disabled = !g || g.over || !!G.replay;
  stage.classList.toggle('mn-flagmode', G.flagMode);
}
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else (stage.requestFullscreen ? stage.requestFullscreen() : Promise.reject()).catch(() => toast(t('mn.fullscreen.no'), 'warn'));
}

// ---- announcements -----------------------------------------------------------------------------------------------------
// Clear then set after 30 ms: screen readers announce a live region only on change, so repeating the same text
// (moving over two identical cells) needs the empty intermediate state.
function announce(text) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); }
function describe(i) {
  const g = G.replay ? G.replay.game : G.game;
  const { col, row } = board.screenPos(i);
  const s = g.st[i];
  let what;
  if (s === OPEN) what = g.mine && g.mine[i] ? t('mn.cell.mine') : g.num[i] ? t('mn.cell.num', { n: g.num[i] }) : t('mn.cell.empty');
  else if (s === FLAG) what = t('mn.cell.flag');
  else if (s === MARK) what = t('mn.cell.mark');
  else what = t('mn.cell.hidden');
  return t('mn.cell.pos', { col, row }) + ': ' + what;
}

// ---- menus ------------------------------------------------------------------------------------------------------------
// The board has no context menu (the right button and the long press flag at once); the Menu key and Shift+F10 open
// the actions of the keyboard cursor's cell, and the face button has a menu of its own (ui/contextmenu.js).
// Keyboard-accessible cell menu; focus returns to the canvas afterwards so the virtual cursor keeps working.
function cellMenu(i, x, y) {
  const g = G.game;
  if (!g || G.replay || G.generating) return;
  const canvas = board.canvas;
  const back = () => { try { canvas.focus({ preventScroll: true }); } catch { /* ignore */ } };
  const run = (fn) => () => { back(); fn(); };
  const s = g.st[i], can = playable();
  const flagLabel = s === HIDDEN ? 'mn.menu.flag' : s === FLAG ? (g.cfg.marks ? 'mn.menu.mark' : 'mn.menu.unflag') : 'mn.menu.unmark';
  const items = [
    { header: true, label: describe(i) },
    s !== OPEN ? { label: t('mn.menu.open'), icon: 'tap', kbd: 'Enter', disabled: !can || s === FLAG, action: run(() => doReveal(i)) } : null,
    s !== OPEN ? { label: t(flagLabel), icon: 'flag', kbd: 'F', disabled: !can, action: run(() => doFlag(i)) } : null,
    s === OPEN && g.num && g.num[i] ? { label: t('mn.menu.chord'), icon: 'grid', kbd: 'C', disabled: !can || !g.chordable(i), action: run(() => doChord(i)) } : null,
    { sep: true },
    { label: t('mn.hint').replace(/\s*\(.\)$/, ''), icon: 'bulb', kbd: 'H', disabled: g.over, action: run(hint) },
    S.allowUndo ? { label: t('mn.undo'), icon: 'undo', kbd: 'Z', disabled: !g.canUndo(), action: run(undo) } : null,
  ];
  const pop = openMenu({ x, y }, items, { className: 'ed-ctx-menu mn-menu' });
  pop.el.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Tab') setTimeout(back, 0); });
}

function faceMenu() {
  const cur = presetOf(S.cfg);
  const g = G.game;
  const quick = (k) => () => { S.cfg = normalizeConfig({ ...S.cfg, ...PRESETS[k] }); saveSettings(); newGame(); };
  return [
    { label: t('mn.newGame'), icon: 'refresh', kbd: 'N', action: () => newGame() },
    { sep: true },
    { header: true, label: t('mn.difficulty') },
    ...Object.keys(PRESETS).map((k) => ({ label: t('mn.preset.' + k), checked: cur === k, action: quick(k) })),
    { sep: true },
    { label: t('mn.daily'), icon: 'calendar', action: daily },
    g && g.mine && !G.replay ? { label: t('mn.res.retry'), icon: 'rotate', action: retryBoard } : null,
    { label: t('mn.share.board'), icon: 'link', disabled: !boardCode(), action: copyBoardLink },
    coarse() || matchMedia('(max-width: 960px)').matches ? { label: t('mn.settings'), icon: 'settings', action: () => openPanelSheet(panel) } : null,
  ];
}

// ---- keyboard (page) ----------------------------------------------------------------------------------------------------
// Page-level shortcuts, ignored while a dialog is open (layers) or a text field has focus. Returns true when handled.
function onKey(e) {
  if (e.defaultPrevented || layers.length) return false;
  const el = e.target;
  if (isEditable(el)) return false;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { if (S.allowUndo) { undo(); return true; } return false; }
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (k === 'f2' || k === 'n') { newGame(); return true; }
  if (k === 'h') { hint(); return true; }
  if (k === 'z' || k === 'u') { undo(); return true; }
  if (k === 'm') { setFlagMode(!G.flagMode); return true; }
  if (k === '+' || k === '=') { board.zoomBy(1.25); return true; }
  if (k === '-' || k === '_') { board.zoomBy(1 / 1.25); return true; }
  if (k === '0') { board.fit(-1, true); return true; }
  if (k === 'escape') { if (G.replay) { exitReplay(); return true; } if (!overlay.hidden && G.result) { hideOverlay(); return true; } }
  return false;
}

// ---- panel controller ---------------------------------------------------------------------------------------------------
// The controller interface panel.js talks to. Config changes apply immediately only to an untouched game (status
// "ready"); otherwise they are pending until the next game - changing rules mid-game would invalidate the record.
const panelCtl = {
  // A rules / size change: applies at once while the current game has not started.
  setCfg(partial) {
    S.cfg = normalizeConfig({ ...S.cfg, ...partial });
    saveSettings();
    const g = G.game;
    if (g && g.status === 'ready' && !G.replay && !G.daily && g.kind !== 'layout') newGame();
    else G.pending = true;
    syncPanel(panel, S, G, stats);
  },
  newGame: () => { closePanelSheet(panel); newGame(); },
  daily: () => { closePanelSheet(panel); daily(); },
  playSeed(text) {
    const s = String(text || '').trim();
    if (!s) return;
    closePanelSheet(panel);
    if (decodeGame(s)) { openCode(s); return; }
    newGame({ source: { kind: 'seeded', seed: s } });
  },
  setRandom(mode) { S.random = mode === 'crypto' ? 'crypto' : 'seeded'; saveSettings(); syncPanel(panel, S, G, stats); },
  setTap: (flags) => setFlagMode(flags),
  copySeed,
  copyLink: copyBoardLink,
  set(k, v) {
    S[k] = v;
    saveSettings();
    if (k === 'allowUndo') syncTools();
    if (k === 'sound' && v) play('click');
    if (k === 'sound') renderTools();
    applyLook();
    syncPanel(panel, S, G, stats);
  },
  setOpen(sec, on) { S.open[sec] = on; saveSettings(); },
  stats: () => stats,
  resetStats() { stats = normalizeStats(null); saveStats(); syncPanel(panel, S, G, stats); toast(t('mn.stats.cleared'), 'ok'); },
  replay(code) { closePanelSheet(panel); startReplay(code); },
  lastReplay: () => lsGet(KEY + '-last', ''),
  scheme,
  game: () => G.game,
};

// ---- boot -----------------------------------------------------------------------------------------------------------------
// The canvas is the single focusable game widget: role="application" tells screen readers to pass keys through to
// it (arrow keys move the game cursor, not the reading cursor).
function buildStage() {
  const canvas = h('canvas', { class: 'mn-canvas', tabindex: '0', role: 'application', 'aria-roledescription': t('mn.board.role'), 'aria-label': t('mn.board.label') });
  hudMines = h('div', { class: 'mn-lcd mn-lcd-mines', role: 'status' }, h('span', { class: 'mn-lcd-i' }, iconEl('mine')), h('span', { class: 'mn-lcd-v' }));
  hudTime = h('div', { class: 'mn-lcd mn-lcd-time', role: 'timer' }, h('span', { class: 'mn-lcd-v' }), h('span', { class: 'mn-lcd-i' }, iconEl('clock')));
  faceBtn = h('button', { type: 'button', class: 'mn-face', title: t('mn.newGame') + ' (N)', 'aria-label': t('mn.newGame'), onclick: () => newGame() });
  const hud = h('div', { class: 'mn-hud' }, hudMines, faceBtn, hudTime);
  chip = h('div', { class: 'mn-chip', 'aria-live': 'off' });
  overlay = h('div', { class: 'mn-overlay', hidden: true });
  field = h('div', { class: 'mn-field' }, canvas, chip, overlay);
  tools = h('div', { class: 'mn-tools', role: 'toolbar' });
  stage = h('section', { class: 'mn-stage', 'aria-label': t('mn.stage') }, hud, field, tools);
  board = createBoard(canvas, {});
  board.setCoarse(coarse());
  input = bindInput(canvas, board, {
    playable,
    isOpen: (i) => !!G.game && G.game.st[i] === OPEN,
    primary(i) {
      const g = G.game;
      if (G.flagMode) { if (g.st[i] === OPEN) doChord(i); else doFlag(i); return; }
      if (g.st[i] === OPEN) { if (S.chordClick) doChord(i); return; }
      doReveal(i);
    },
    secondary(i) {
      const g = G.game;
      if (G.flagMode) { if (g.st[i] === OPEN) doChord(i); else doReveal(i); return; }
      if (g.st[i] === OPEN) doChord(i); else doFlag(i);
    },
    chord: doChord,
    preview: (i, chord) => previewCells(G.game, i, chord || (G.game && G.game.st[i] === OPEN && (S.chordClick || G.flagMode))),
    pressing(on) { if (G.game && !G.game.over) setFace(on ? 'press' : 'idle'); },
    longPress: () => S.longPress,
    vibrate: () => vibrate(14),
    announce: (i) => announce(describe(i)),
    menu: cellMenu,
    key: onKey,
  });
  new ResizeObserver(() => board.resize()).observe(canvas);
  // Right click / long press on the face: difficulty and board actions.
  contextMenu(faceBtn, faceMenu);
  // The game area is not a document: no browser menu, callout or text selection anywhere on it (fields excepted).
  const field_ = (el) => el instanceof Element && !!el.closest('input, select, textarea');
  stage.addEventListener('contextmenu', (e) => { if (!field_(e.target)) e.preventDefault(); });
  stage.addEventListener('selectstart', (e) => { if (!field_(e.target)) e.preventDefault(); });
}

// Boot order: shell, stage, panel, then the game - a shared link in the hash wins, then a resumable game, then a
// fresh one. The theme observers recolour skins that follow the page scheme.
function boot() {
  const main = $('#main');
  main.classList.add('ap-wide', 'mn-main');
  document.body.classList.add('mn-page');
  startApp({ key: KEY, name: 'app.name', logo: LOGO, offline: true, onLang: relabel });
  buildStage();
  live = h('div', { class: 'mn-live', 'aria-live': 'polite', role: 'status' });
  panel = h('aside', { class: 'mn-panel', 'aria-label': t('mn.panel') });
  main.append(h('div', { class: 'mn-game' }, stage, panel), live);
  renderTools();
  applyLook();
  renderPanel(panel, S, G, panelCtl, stats);
  board.resize();
  // The colour scheme of the page (header switch or the system) recolours skins that have a dark palette.
  new MutationObserver(() => applyLook()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyLook);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyLook);
  matchMedia('(pointer: coarse)').addEventListener?.('change', () => board.setCoarse(coarse()));
  document.addEventListener('keydown', (e) => { if (onKey(e)) e.preventDefault(); });
  document.addEventListener('fullscreenchange', () => { renderTools(); setTimeout(() => board.resize(), 50); });
  window.addEventListener('hashchange', () => { if (location.hash.length > 3 && openCode(location.hash)) clearHash(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveResume(); });
  setInterval(() => { if (G.game && G.game.status === 'playing' && !G.replay) saveResume(); }, 5000);
  // Start: a shared link, the interrupted game, or a new one.
  if (location.hash.length > 3 && openCode(location.hash, { quiet: true })) clearHash();
  else if (!tryResume()) newGame();
  if (!G.game) newGame();
  // Test and debugging handle (the page works without it).
  window.__miner = { G, S, board, newGame, reveal: doReveal, flag: doFlag, chord: doChord, openCode, hint, undo, startReplay, exitReplay, daily, boardCode, replayCode, panelCtl, stats: () => stats };
}

function clearHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sandboxed */ } }

// Language switch: re-render every text-bearing part; LCD caches are invalidated so aria-labels are retranslated.
function relabel() {
  const canvas = board.canvas;
  canvas.setAttribute('aria-roledescription', t('mn.board.role'));
  canvas.setAttribute('aria-label', t('mn.board.label'));
  stage.setAttribute('aria-label', t('mn.stage'));
  panel.setAttribute('aria-label', t('mn.panel'));
  faceBtn.title = t('mn.newGame') + ' (N)';
  faceBtn.setAttribute('aria-label', t('mn.newGame'));
  hudMines.dataset.v = '';
  hudTime.dataset.v = '';
  renderTools();
  renderPanel(panel, S, G, panelCtl, stats);
  updateHud();
  if (G.replay) renderReplayBar();
  else if (G.result && !overlay.hidden && overlay.classList.contains('mn-result')) showResult();
}

boot();
