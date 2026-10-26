// battleship-game/main.js - Sea Battle: the page. The home screen, the settings (looks, sound, motion, bot speed, hints,
// the turn timer, take-backs, coordinates, the rules engine with the way into the constructor), the screens (new game,
// the battle, online rooms, replays, profile, constructor), links that open something (#room=… invites, #rs=… shared
// rulesets, #sbn=… records) and the artifact mode (the offline build hides online play).
//
// Design rules of this module:
// - A tiny screen router: go(name, arg) clears <main> and calls one screen renderer. No history entries per screen:
//   the app is a game, Back would be surprising mid-match; only links (#room, #rs, #sbn) arrive through the URL.
// - The game itself is always a "room" (rooms/client.js): a local game is a localRoom running the same game definition
//   as the server. One code path for local and online play (startSession), so every rule, bot and replay behaves the
//   same in both; the cost is a little ceremony for the local case.
// - Settings live in store.settings and are saved per change; screens read them at render time, never cache them.
// - Deployment modes (artifactMode()): 'offline' (single-file artifact, no network: online play hidden), 'backend'
//   (served with rooms/server.js), otherwise serverless. The mode decides the offline badge and the online tile.

// Side-effect import first: registers the i18n keys before any t() call below.
import './strings.js';
import { startApp, seg } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { openDialog, toast, confirmDialog } from '../ui/overlays.js';
import { localRoom, parseInvite } from '../rooms/client.js';
import { normalizeRuleset, playerRange } from '../battleship/ruleset.js';
import { validateRuleset } from '../battleship/placement.js';
import { PRESETS, presetById } from '../battleship/presets.js';
import { game } from '../battleship/game.js';
import { randomSeed } from '../prng/prng.js';
import { store, save, putRuleset } from './store.js';
import { startSession, localSettings } from './play.js';
import { renderSetup, rulesetChoices, botCard } from './setup.js';
import { renderReplays } from './replay.js';
import { renderProfile, AVATARS } from './profile.js';
import { renderOnline, onlineAvailable, joinInvite, artifactMode } from './online.js';
import { renderStudio, readShared, skinPic } from './studio.js';
import { createGrid } from './grid.js';
import { SKINS, applySkin, skinOf } from './skins.js';
import { setSound, play } from './sound.js';
import { rulesetName, rulesBody, botName } from './names.js';

addIcons({
  ship: 'M3 15h18l-2.5 4.5h-13zM6 15V9h8l2 6M9 9V5h3v4M4 21c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  replay: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M10 9l5 3-5 3z',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
});

const LOGO = 'M3 15h18l-2.5 4.5h-13zM6 15V9h8l2 6M9 9V5h3v4';
const main = document.getElementById('main');
const mode = artifactMode();
let screen = 'home';

startApp({ key: 'battleship', name: 'app.name', logo: LOGO, offline: mode === 'offline' ? true : mode === 'backend' ? false : 'serverless', onLang: () => go(screen) });
setSound(store.settings.sound, store.settings.volume);

// textContent = '' drops the whole previous screen in one operation; screens that hold timers check isConnected
// (see heroSea) instead of needing an explicit unmount hook.
function clear() { main.textContent = ''; window.scrollTo(0, 0); }

// The router. bs-playing is removed on every navigation, so leaving a game by any path restores the shell.
// onLang re-enters the current screen (go(screen)), re-rendering every label in the new language.
function go(name, arg) {
  screen = name;
  document.body.classList.remove('bs-playing');
  clear();
  main.classList.toggle('ap-wide', name === 'studio' || name === 'replays' || name === 'setup');
  if (name === 'home') home();
  else if (name === 'setup') renderSetup(main, { onStart: startLocal, onBack: () => go('home'), rulesBody });
  else if (name === 'online') renderOnline(main, { onBack: () => go('home'), onPlay: (room, info) => startOnline(room, info) });
  else if (name === 'replays') renderReplays(main, { text: arg || '', onBack: () => go('home') });
  else if (name === 'profile') renderProfile(main, { onBack: () => go('home') });
  else if (name === 'studio') {
    const st = renderStudio(main, { onBack: () => go('home'), onTestPlay: (raw) => testPlay(raw) });
    if (arg) st.importRuleset(arg);
  }
}

// --- home ---------------------------------------------------------------------------------------------------------------

// Decorative 8x8 sea on the home screen (aria-hidden: no information). Marks are hand-placed cell indices
// (row * 8 + col; codes as in grid.js: 1 miss, 2 hit, 3 sunk, 4 halo) showing a sunk ship and a wounded one.
// A slow interval drops misses on free cells and wipes them after a full cycle. The timer stops itself once the
// box leaves the DOM (isConnected), so navigation needs no cleanup call.
function heroSea(hero) {
  const rs = normalizeRuleset(presetById('quick-8'));
  const box = h('div', { class: 'bs-herosea', 'aria-hidden': 'true' });
  hero.append(box);
  const g = createGrid(box, { rs, small: true });
  const marks = new Array(64).fill(0);
  for (const c of [3, 12, 21, 30, 45, 54, 60, 7, 38]) marks[c] = 1;
  for (const c of [26, 27, 28]) marks[c] = 3;
  for (const c of [17, 18, 19, 20, 33, 34, 35, 36, 25, 29]) marks[c] = 4;
  marks[50] = 2;
  g.render({ rs, marks, ships: [{ t: 0, cells: [26, 27, 28], sunk: true }, { t: 1, cells: [42, 50] }], sunk: [{ t: 0, at: 28, cells: [26, 27, 28] }], motion: store.settings.motion });
  // now and then a shot lands somewhere (unless motion is reduced)
  let k = 0;
  const free = [0, 1, 2, 5, 9, 10, 14, 15, 23, 31, 39, 40, 46, 47, 55, 56, 57, 58, 62, 63];
  const timer = setInterval(() => {
    if (!box.isConnected) { clearInterval(timer); return; }
    const c = free[k++ % free.length];
    marks[c] = 1;
    g.render({ marks });
    if (k % free.length === 0) for (const x of free) marks[x] = 0;
  }, 1800);
}

// Home: hero with the one-tap "Play" (the last-used ruleset and seats), tiles for every screen, and the rules of the
// chosen ruleset in a <details> (native disclosure: keyboard and screen reader support for free). The player count is
// clamped into the ruleset's allowed range, because a saved count may come from a different ruleset.
function home() {
  const S = store.settings;
  const choice = rulesetChoices().find((c) => c.raw.id === S.rulesetId) || rulesetChoices()[0];
  const rs = normalizeRuleset(choice.raw);
  const pr = playerRange(rs);
  const players = Math.max(pr.min, Math.min(pr.max, S.players || 2));
  const hero = h('section', { class: 'bs-hero' });
  applySkin(hero, skinOf(S));
  heroSea(hero);
  hero.append(h('div', { class: 'bs-hero-text' },
    h('h2', { class: 'bs-hero-t' }, t('home.title')), h('p', { class: 'bs-hero-s' }, t('home.subtitle')),
    h('button', { type: 'button', class: 'bs-bigbtn bs-playbtn', dataset: { a: 'play' }, onclick: quickPlay }, iconEl('play'), t('home.play')),
    h('p', { class: 'bs-hero-m' }, t('home.quick', { rules: rulesetName(rs), n: players, bot: botName(S.seats[0]) }))));
  const tile = (icon, title, sub, fn, extra = '') => h('button', { type: 'button', class: 'bs-tile ' + extra, dataset: { k: title.split('.')[1] }, onclick: fn }, h('span', { class: 'bs-tile-i' }, iconEl(icon)), h('b', {}, t(title)), h('span', {}, t(sub)));
  main.append(h('div', { class: 'bs-home bs-screen' }, hero,
    h('div', { class: 'bs-tiles' },
      tile('ship', 'home.new', 'home.newSub', () => go('setup')),
      onlineAvailable() ? tile('users', 'home.online', 'home.onlineSub', () => go('online')) : null,
      tile('replay', 'home.replays', 'home.replaysSub', () => go('replays')),
      tile('trophy', 'home.profile', 'home.profileSub', () => go('profile')),
      tile('settings', 'home.settings', 'home.settingsSub', () => openSettings(() => go('home'))),
      tile('wrench', 'home.studio', 'home.studioSub', () => go('studio'), 'bs-tile-studio')),
    h('section', { class: 'ap-card bs-howto' }, h('h2', { class: 'ap-card-h' }, t('home.how')), h('p', {}, t('home.howText')),
      h('details', {}, h('summary', {}, t('home.rulesOf', { name: rulesetName(rs) })), rulesBody(rs))),
    mode === 'offline' ? h('p', { class: 'ed-hint bs-modehint' }, t('home.offlineMode')) : null));
}

function quickPlay() {
  const S = store.settings;
  const choice = rulesetChoices().find((c) => c.raw.id === S.rulesetId) || rulesetChoices()[0];
  const pr = playerRange(normalizeRuleset(choice.raw));
  const players = Math.max(pr.min, Math.min(pr.max, S.players || 2));
  startLocal({ ruleset: choice.raw, builtin: choice.builtin, players, seats: S.seats.slice(0, players - 1), random: S.random, seed: S.random === 'seeded' ? (S.seed || randomSeed()) : null });
}

// --- games --------------------------------------------------------------------------------------------------------------

// A local game: build the room in this tab. A ruleset may carry its own skin (constructor option), which then wins
// over the player's skin for this game. localRoom validates the settings and throws on an invalid ruleset; the error
// becomes a toast instead of a broken table.
function startLocal(setup, back = 'home') {
  const { settings, options, kinds, avatars } = localSettings(setup);
  if (setup.ruleset.skin && typeof setup.ruleset.skin === 'object') settings.skin = setup.ruleset.skin;
  let room;
  try { room = localRoom(game, settings, options); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); return; }
  screen = 'table';
  clear();
  startSession(main, {
    room, mySeat: 0, names: options.names, kinds, avatars, online: false,
    onExit: () => go(back), openSettings, openReplay: (txt) => go('replays', txt), rulesBody, botInfo,
  });
}

// Constructor "test play": always seeded with a fresh seed, so a surprising game can be replayed; returns to studio.
function testPlay(raw) {
  const S = store.settings;
  const pr = playerRange(normalizeRuleset(raw));
  const players = Math.max(pr.min, Math.min(pr.max, S.players || 2));
  startLocal({ ruleset: raw, builtin: false, players, seats: S.seats.slice(0, players - 1), random: 'seeded', seed: randomSeed() }, 'studio');
}

function startOnline(room, info) {
  screen = 'table';
  clear();
  startSession(main, {
    room, mySeat: info.mySeat, online: true, names: [], kinds: [], avatars: [],
    onExit: () => go(onlineAvailable() ? 'online' : 'home'), openSettings, openReplay: (txt) => go('replays', txt), rulesBody, botInfo,
  });
}

// Seat info dialog. kind is "template.level" (e.g. "hunter.3"); level defaults to 2 when missing or unparsable.
function botInfo(kind, name) {
  if (!kind) { openDialog({ title: name || t('tb.player', { n: '' }), body: t('bot.human') }); return; }
  const [k, l] = String(kind).split('.');
  openDialog({ title: name || botName({ kind: k }), body: botCard(k, +l || 2) });
}

// --- settings -------------------------------------------------------------------------------------------------------------

// Settings dialog. Each control writes store.settings and saves at once (no OK/Cancel): settings are preferences,
// instant feedback beats a transaction. render() rebuilds the body for controls whose selection state is drawn by
// classes (avatars, skins). The volume slider uses 'change' (release), not 'input', and plays a splash as a preview.
// closeDlg is wired in onMount because the dialog handle exists only after openDialog has built it.
function openSettings(onChange) {
  const S = store.settings;
  const body = h('div', { class: 'bs-settings' });
  const changed = () => { save('settings'); setSound(S.sound, S.volume); onChange?.(); };
  const check = (key, label) => h('label', { class: 'ed-field ed-field-check' }, h('input', { type: 'checkbox', class: 'ed-switch', checked: !!S[key], dataset: { k: key }, onchange: (e) => { S[key] = e.target.checked; changed(); } }), h('span', { class: 'ed-label' }, t(label)));
  const render = () => {
    body.textContent = '';
    const nameIn = h('input', { class: 'ed-input', value: S.name || '', placeholder: t('you'), maxlength: '24', 'aria-label': t('pf.name') });
    nameIn.addEventListener('change', () => { S.name = nameIn.value.trim(); changed(); });
    const rsSel = h('select', { class: 'ed-input ed-select', 'aria-label': t('set.rules') }, rulesetChoices().map((c) => h('option', { value: c.raw.id, selected: c.raw.id === S.rulesetId }, rulesetName(normalizeRuleset(c.raw)))));
    rsSel.addEventListener('change', () => { S.rulesetId = rsSel.value; changed(); });
    const vol = h('input', { type: 'range', class: 'ed-range', min: '0', max: '100', value: String(Math.round(S.volume * 100)), 'aria-label': t('set.volume') });
    vol.addEventListener('change', () => { S.volume = +vol.value / 100; changed(); play('splash'); });
    body.append(
      h('h3', {}, t('set.player')),
      h('div', { class: 'ap-row' }, h('span', { class: 'bs-me-ava' }, S.avatar), nameIn),
      h('div', { class: 'bs-avatars bs-avatars-s' }, AVATARS.map((a) => h('button', { type: 'button', class: 'bs-avatar' + (S.avatar === a ? ' bs-on' : ''), onclick: () => { S.avatar = a; changed(); render(); } }, a))),
      h('h3', {}, t('set.look')),
      h('div', { class: 'bs-swatches bs-swatches-s' }, SKINS.map((x) => h('button', { type: 'button', class: 'bs-swatch' + (S.skin === x.id ? ' bs-on' : ''), dataset: { skin: x.id }, title: t(x.name), 'aria-label': t(x.name), 'aria-pressed': String(S.skin === x.id), onclick: () => { S.skin = x.id; changed(); render(); } }, skinPic(x), h('span', {}, t(x.name))))),
      check('useRoomSkin', 'set.roomSkin'),
      h('div', { class: 'bs-setrow' }, h('span', {}, t('set.coords')), seg([{ v: 'latin', l: 'set.latin' }, { v: 'cyrillic', l: 'set.cyrillic' }], S.coords || 'latin', (v) => { S.coords = v; changed(); })),
      h('h3', {}, t('set.game')),
      h('div', { class: 'bs-setrow' }, h('span', {}, t('set.speed')), seg([{ v: 'slow', l: 'set.slow' }, { v: 'normal', l: 'set.normal' }, { v: 'fast', l: 'set.fast' }], S.speed, (v) => { S.speed = v; changed(); })),
      h('div', { class: 'bs-setrow' }, h('span', {}, t('set.timer')), seg([{ v: 0, l: 'set.off' }, { v: 10, l: '=10 s' }, { v: 20, l: '=20 s' }, { v: 45, l: '=45 s' }], S.timer || 0, (v) => { S.timer = +v; changed(); })),
      h('div', { class: 'bs-setrow' }, h('span', {}, t('set.motion')), seg([{ v: 'auto', l: 'set.auto' }, { v: 'full', l: 'set.full' }, { v: 'reduced', l: 'set.reduced' }], S.motion, (v) => { S.motion = v; changed(); })),
      check('hints', 'set.hints'),
      check('confirmFire', 'set.confirmFire'),
      check('practice', 'set.practice'),
      check('sound', 'set.sound'),
      h('div', { class: 'bs-setrow' }, h('span', {}, t('set.volume')), vol),
      h('h3', {}, t('set.engine')),
      h('div', { class: 'bs-setrow' }, h('span', {}, t('set.rules')), rsSel),
      h('p', { class: 'ed-hint' }, t('set.engineHint')),
      h('button', { type: 'button', class: 'ed-btn', onclick: () => { closeDlg(); go('studio'); } }, iconEl('wrench'), t('set.openStudio')));
  };
  let closeDlg = () => {};
  render();
  return openDialog({ title: t('set.title'), body, className: 'bs-setdlg', onMount: (m) => { closeDlg = () => m.close(null); } });
}

// --- links: invites, shared rulesets, records -------------------------------------------------------------------------------

// Links. Each recognised hash is consumed with replaceState (removed from the URL) before acting: a reload must not
// rejoin a room or re-import a ruleset, and a password-bearing invite should not linger in the address bar.
// Shared rulesets are untrusted input: validated (validateRuleset) before the confirm, the id sanitised to a safe
// character set, and suffixed when it would shadow a built-in preset.
async function openFromHash() {
  const hash = location.hash || '';
  const inv = parseInvite(location);
  if (inv) {
    history.replaceState(null, '', location.pathname + location.search);
    clear();
    screen = 'lobby';
    await joinInvite(inv, { main, onPlay: (room, info) => startOnline(room, info), onDone: () => go(onlineAvailable() ? 'online' : 'home') });
    return true;
  }
  const q = new URLSearchParams(hash.slice(1));
  if (q.get('rs')) {
    const raw = readShared(q.get('rs'));
    history.replaceState(null, '', location.pathname + location.search);
    if (!raw || !validateRuleset(raw).ok) { toast(t('st2.badImport'), 'error'); return false; }
    const name = raw.name && typeof raw.name === 'object' ? (raw.name.en || Object.values(raw.name)[0]) : raw.name || raw.id;
    if (await confirmDialog(t('link.rsTitle'), t('link.rsText', { name }), t('link.rsAdd'))) {
      raw.id = String(raw.id || 'shared').replace(/[^A-Za-z0-9_.-]/g, '-');
      if (PRESETS.some((p) => p.id === raw.id)) raw.id += '-shared';
      putRuleset(raw);
      store.settings.rulesetId = raw.id;
      save('settings');
      toast(t('link.rsAdded', { name }), 'ok');
      go('setup');
      return true;
    }
    return false;
  }
  if (q.get('sbn')) {
    const txt = q.get('sbn');
    history.replaceState(null, '', location.pathname + location.search);
    go('replays', txt);
    return true;
  }
  return false;
}

// Startup. A saved ruleset id may point to a deleted user ruleset: repair it before the home screen reads it.
// Home renders first, then the hash is handled on top, so a bad link still leaves a working page behind.
if (!rulesetChoices().some((c) => c.raw.id === store.settings.rulesetId)) { store.settings.rulesetId = PRESETS[0].id; save('settings'); }
go('home');
openFromHash();
window.addEventListener('hashchange', () => { openFromHash(); });
