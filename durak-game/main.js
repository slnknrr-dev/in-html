// durak-game/main.js - Durak: the page. The home screen, the settings (look, sound, motion, bot speed, hints, turn
// timer, the rules engine with the way into the constructor), the screens (new game, table, online rooms, replays,
// profile, constructor), links that open something (#room=… invites, #rs=… shared rulesets, #dgn=… records) and the
// artifact mode (offline builds hide online play; standalone pages connect to servers over CORS).
//
// Architecture: a tiny screen router. go(name) clears <main> and calls the screen's render function with callbacks
// (onBack, onPlay...), so screens never import each other and never touch navigation. The game table is a "session"
// started by startLocal / startOnline over a room object (rooms/client.js): local play runs the same room protocol
// in-process (localRoom) as online play does over the network, so the table code has one code path for both.
// Deep links (#room=, #rs=, #dgn=) are consumed once and then removed from the URL with history.replaceState, so a
// reload does not re-join a room or re-import a ruleset.

// The page as it was loaded: the constructor exports a copy of it as a standalone page.
// Caveat: import declarations are hoisted, so every imported module evaluates before this line; the snapshot is taken
// before main.js's own DOM changes and stays clean only while no imported module mutates the DOM at import time.
// The typeof guard lets the module be imported in Node (tests) where there is no document.
const PAGE_HTML = typeof document !== 'undefined' ? '<!doctype html>\n' + document.documentElement.outerHTML : '';

import './strings.js';
import { startApp, seg, select } from '../ui/app.js';
import { h, lsGet } from '../ui/dom.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { openDialog, toast, confirmDialog } from '../ui/overlays.js';
import { localRoom, parseInvite } from '../rooms/client.js';
import { normalizeRuleset, playerRange, validateRuleset } from '../durak/ruleset.js';
import { PRESETS, presetById } from '../durak/presets.js';
import { game } from '../durak/game.js';
import { randomSeed } from '../prng/prng.js';
import { store, save, putRuleset } from './store.js';
import { startSession, localSettings } from './play.js';
import { renderSetup, rulesetChoices, botCard } from './setup.js';
import { renderReplays } from './replay.js';
import { renderProfile, AVATARS } from './profile.js';
import { renderOnline, onlineAvailable, joinInvite, artifactMode } from './online.js';
import { renderStudio, readShared } from './studio.js';
import { faceSVG, backSVG, FACES, BACKS } from './cardart.js';
import { TABLES, backColor, skinOf, applySkin } from './skins.js';
import { setSound, play } from './sound.js';
import { rulesetName, rulesBody, botName, levelName } from './names.js';

addIcons({
  cards: 'M4 7.5 13 4l4.5 12L8.5 19.5zM15 4.5l4 1.6-1 2.6M6.2 9.5l1.4 3.8',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  replay: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M10 9l5 3-5 3z',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  play: 'M7 4v16l13-8z',
});

const LOGO = 'M4 7.5 13 4l4.5 12L8.5 19.5zM15 4.5l4 1.6-1 2.6';
const main = document.getElementById('main');
const mode = artifactMode();
let screen = 'home';

// offline: true = offline build (no network code), false = backend build, 'serverless' = standalone page that may
// connect to configured servers. onLang re-renders the current screen so every t() label is rebuilt.
startApp({ key: 'durak', name: 'app.name', logo: LOGO, offline: mode === 'offline' ? true : mode === 'backend' ? false : 'serverless', onLang: () => go(screen) });
setSound(store.settings.sound, store.settings.volume);
// First visit: Russian-style faces (В Д К Т) for players of the countries where durak comes from.
if (lsGet('durak-settings', null) == null && ['ru', 'uk'].includes(UI_STATE.lang)) { store.settings.face = 'russian'; save('settings'); }

function clear() { main.textContent = ''; window.scrollTo(0, 0); }

// Router. Always removes body.dk-playing (a screen change ends any fullscreen table) and widens <main> for the two
// screens with side-by-side panels. arg: replay text for 'replays', ruleset payload for 'studio'.
function go(name, arg) {
  screen = name;
  document.body.classList.remove('dk-playing');
  clear();
  main.classList.toggle('ap-wide', name === 'studio' || name === 'replays');
  if (name === 'home') home();
  else if (name === 'setup') renderSetup(main, { onStart: startLocal, onBack: () => go('home'), rulesBody });
  else if (name === 'online') renderOnline(main, { onBack: () => go('home'), onPlay: (room, info) => startOnline(room, info) });
  else if (name === 'replays') renderReplays(main, { text: arg || '', onBack: () => go('home') });
  else if (name === 'profile') renderProfile(main, { onBack: () => go('home') });
  else if (name === 'studio') {
    const st = renderStudio(main, { onBack: () => go('home'), onTestPlay: (raw) => testPlay(raw), pageHTML: PAGE_HTML, openSettings });
    if (arg) st.importRuleset(arg);
  }
}

// --- home -------------------------------------------------------------------------------------------------------------

// Home: hero with a fanned hand drawn in the player's current card faces and table skin (applySkin on the hero sets
// the --dk-* variables, so the hero previews the chosen look), a quick-play button with the remembered ruleset and
// player count (clamped to the ruleset's range: a deleted or edited ruleset may no longer allow it), and tiles.
// The Online tile is omitted (null child, h() skips it) when the build has no network.
function home() {
  const S = store.settings;
  const choice = rulesetChoices().find((c) => c.raw.id === S.rulesetId) || rulesetChoices()[0];
  const rs = normalizeRuleset(choice.raw);
  const pr = playerRange(rs);
  const players = Math.max(pr.min, Math.min(pr.max, S.players || 3));
  const skin = skinOf(S);
  const fanDefs = ['As', 'Kh', 'Qd', 'Jc', '6s'].map((c) => normalizeRuleset(presetById('podkidnoy-36')).defs.find((d) => d.code === c));
  const fanRs = normalizeRuleset(presetById('podkidnoy-36'));
  const fan = h('div', { class: 'dk-herofan', 'aria-hidden': 'true' }, fanDefs.map((d, i) => h('div', { class: 'dk-card', style: { '--i': String(i - 2) }, html: faceSVG(fanRs, d, skin.face) })), h('div', { class: 'dk-card dk-back dk-heroback', html: backSVG(skin.back, backColor(skin), skin.backImage) }));
  const hero = h('section', { class: 'dk-hero' });
  applySkin(hero, skin);
  hero.append(fan, h('h2', { class: 'dk-hero-t' }, t('home.title')), h('p', { class: 'dk-hero-s' }, t('home.subtitle')),
    h('button', { type: 'button', class: 'dk-bigbtn dk-playbtn', onclick: quickPlay }, iconEl('play'), t('home.play')),
    h('p', { class: 'dk-hero-m' }, t('home.quick', { rules: rulesetName(rs), n: players })));
  const tile = (icon, title, sub, fn, extra = '') => h('button', { type: 'button', class: 'dk-tile ' + extra, dataset: { k: title.split('.')[1] }, onclick: fn }, h('span', { class: 'dk-tile-i' }, iconEl(icon)), h('b', {}, t(title)), h('span', {}, t(sub)));
  main.append(h('div', { class: 'dk-home dk-screen' }, hero,
    h('div', { class: 'dk-tiles' },
      tile('cards', 'home.new', 'home.newSub', () => go('setup')),
      onlineAvailable() ? tile('users', 'home.online', 'home.onlineSub', () => go('online')) : null,
      tile('replay', 'home.replays', 'home.replaysSub', () => go('replays')),
      tile('trophy', 'home.profile', 'home.profileSub', () => go('profile')),
      tile('settings', 'home.settings', 'home.settingsSub', () => openSettings(() => go('home'))),
      tile('wrench', 'home.studio', 'home.studioSub', () => go('studio'), 'dk-tile-studio')),
    h('section', { class: 'ap-card dk-howto' }, h('h2', { class: 'ap-card-h' }, t('home.how')), h('p', {}, t('home.howText')),
      h('details', {}, h('summary', {}, t('home.rulesOf', { name: rulesetName(rs) })), rulesBody(rs))),
    mode === 'offline' ? h('p', { class: 'ed-hint dk-modehint' }, t('home.offlineMode')) : null));
}

function quickPlay() {
  const S = store.settings;
  const choice = rulesetChoices().find((c) => c.raw.id === S.rulesetId) || rulesetChoices()[0];
  const pr = playerRange(normalizeRuleset(choice.raw));
  const players = Math.max(pr.min, Math.min(pr.max, S.players || 3));
  startLocal({ ruleset: choice.raw, builtin: choice.builtin, players, seats: S.seats.slice(0, players - 1), random: S.random, seed: S.random === 'seeded' ? (S.seed || randomSeed()) : null });
}

// --- games ------------------------------------------------------------------------------------------------------------

// Local game: settings/options for the room come from play.js localSettings (bots per seat, names, avatars). A
// ruleset may carry its own skin. localRoom throws on an invalid configuration (e.g. too many players for the deck);
// that is reported as a toast and the user stays on the current screen.
function startLocal(setup, back = 'home') {
  const { settings, options, kinds, avatars } = localSettings(setup);
  if (setup.ruleset.skin && typeof setup.ruleset.skin === 'object') settings.skin = setup.ruleset.skin;
  let room;
  try { room = localRoom(game, settings, options); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); return; }
  screen = 'table';
  clear();
  play('shuffle');
  startSession(main, {
    room, mySeat: 0, names: options.names, kinds, avatars, online: false,
    onExit: () => go(back), openSettings, openReplay: (txt) => go('replays', txt), rulesBody, botInfo,
  });
}

function testPlay(raw) {
  const S = store.settings;
  const pr = playerRange(normalizeRuleset(raw));
  const players = Math.max(pr.min, Math.min(pr.max, S.players || 3));
  startLocal({ ruleset: raw, builtin: false, players, seats: S.seats.slice(0, players - 1), random: 'seeded', seed: randomSeed() }, 'studio');
}

function startOnline(room, info) {
  screen = 'table';
  clear();
  startSession(main, {
    room, mySeat: info.mySeat, online: true, names: [], kinds: [], avatars: [],
    onExit: () => go('online'), openSettings, openReplay: (txt) => go('replays', txt), rulesBody, botInfo,
  });
}

// Seat info dialog. kind is 'type.level' for bots (e.g. 'hunter.2'), empty for humans.
function botInfo(kind, name) {
  if (!kind) { openDialog({ title: name || t('tb.player', { n: '' }), body: t('bot.human') }); return; }
  const [k, l] = String(kind).split('.');
  openDialog({ title: name || botName({ kind: k }), body: botCard(k, +l || 2) });
}

// --- settings -----------------------------------------------------------------------------------------------------------

// Settings dialog, usable from home, the table and the constructor (onChange lets the caller repaint). Every control
// writes store.settings immediately and saves: no OK/Cancel, the dialog is a live control panel. render() rebuilds the
// body after choices that change other controls' pressed state (swatches, avatars). Name and volume save on 'change'
// (commit), not 'input', to avoid a storage write and a test sound per keystroke/slider step. Image-based tables/backs
// are offered only once the user has uploaded an image. closeDlg is filled in by onMount because the dialog handle
// exists only after openDialog runs.
function openSettings(onChange) {
  const S = store.settings;
  const body = h('div', { class: 'dk-settings' });
  const changed = () => { save('settings'); setSound(S.sound, S.volume); onChange?.(); };
  const render = () => {
    body.textContent = '';
    const pick = (list, key, preview) => h('div', { class: 'dk-swatches dk-swatches-s' }, list.map((x) => h('button', { type: 'button', class: 'dk-swatch' + (S[key] === x.id ? ' dk-on' : ''), title: t(x.name), 'aria-label': t(x.name), 'aria-pressed': String(S[key] === x.id), onclick: () => { S[key] = x.id; changed(); render(); } }, preview(x))));
    const fanRs = normalizeRuleset(presetById('podkidnoy-36'));
    const q = fanRs.defs.find((d) => d.code === 'Qh');
    const nameIn = h('input', { class: 'ed-input', value: S.name || '', placeholder: t('you'), maxlength: '24' });
    nameIn.addEventListener('change', () => { S.name = nameIn.value.trim(); changed(); });
    const rsSel = h('select', { class: 'ed-input ed-select' }, rulesetChoices().map((c) => h('option', { value: c.raw.id, selected: c.raw.id === S.rulesetId }, rulesetName(normalizeRuleset(c.raw)))));
    rsSel.addEventListener('change', () => { S.rulesetId = rsSel.value; changed(); });
    const vol = h('input', { type: 'range', class: 'ed-range', min: '0', max: '100', value: String(Math.round(S.volume * 100)), 'aria-label': t('set.volume') });
    vol.addEventListener('change', () => { S.volume = +vol.value / 100; changed(); play('card'); });
    body.append(
      h('h3', {}, t('set.player')),
      h('div', { class: 'ap-row' }, h('span', { class: 'dk-me-ava' }, S.avatar), nameIn),
      h('div', { class: 'dk-avatars dk-avatars-s' }, AVATARS.map((a) => h('button', { type: 'button', class: 'dk-avatar' + (S.avatar === a ? ' dk-on' : ''), onclick: () => { S.avatar = a; changed(); render(); } }, a))),
      h('h3', {}, t('set.look')),
      h('div', { class: 'ed-label' }, t('lk.table')),
      pick(TABLES.filter((x) => x.id !== 'image' || S.tableImage), 'table', (x) => h('i', { class: 'dk-tablesw', style: { background: `radial-gradient(circle at 50% 40%, ${x.vars.felt}, ${x.vars.felt2})`, borderColor: x.vars.rim } })),
      h('div', { class: 'ed-label' }, t('lk.faces')),
      pick(FACES, 'face', (x) => h('i', { class: 'dk-card dk-tiny', html: faceSVG(fanRs, q, x.id) })),
      h('div', { class: 'ed-label' }, t('lk.backs')),
      pick(BACKS.filter((x) => x.id !== 'image' || S.backImage), 'back', (x) => h('i', { class: 'dk-card dk-tiny', html: backSVG(x.id, backColor(skinOf(S)), S.backImage) })),
      h('label', { class: 'ed-field ed-field-check' }, h('input', { type: 'checkbox', class: 'ed-switch', checked: S.useRoomSkin !== false, onchange: (e) => { S.useRoomSkin = e.target.checked; changed(); } }), h('span', { class: 'ed-label' }, t('set.roomSkin'))),
      h('p', { class: 'ed-hint' }, t('set.moreLook')),
      h('h3', {}, t('set.game')),
      h('div', { class: 'dk-setrow' }, h('span', {}, t('set.speed')), seg([{ v: 'slow', l: 'set.slow' }, { v: 'normal', l: 'set.normal' }, { v: 'fast', l: 'set.fast' }], S.speed, (v) => { S.speed = v; changed(); })),
      h('div', { class: 'dk-setrow' }, h('span', {}, t('set.timer')), seg([{ v: 0, l: 'set.off' }, { v: 15, l: '=15 s' }, { v: 30, l: '=30 s' }, { v: 60, l: '=60 s' }], S.timer || 0, (v) => { S.timer = +v; changed(); })),
      h('div', { class: 'dk-setrow' }, h('span', {}, t('set.motion')), seg([{ v: 'auto', l: 'set.auto' }, { v: 'full', l: 'set.full' }, { v: 'reduced', l: 'set.reduced' }], S.motion, (v) => { S.motion = v; changed(); })),
      h('label', { class: 'ed-field ed-field-check' }, h('input', { type: 'checkbox', class: 'ed-switch', checked: S.hints !== false, onchange: (e) => { S.hints = e.target.checked; changed(); } }), h('span', { class: 'ed-label' }, t('set.hints'))),
      h('label', { class: 'ed-field ed-field-check' }, h('input', { type: 'checkbox', class: 'ed-switch', checked: !!S.sound, onchange: (e) => { S.sound = e.target.checked; changed(); } }), h('span', { class: 'ed-label' }, t('set.sound'))),
      h('div', { class: 'dk-setrow' }, h('span', {}, t('set.volume')), vol),
      h('h3', {}, t('set.engine')),
      h('div', { class: 'dk-setrow' }, h('span', {}, t('set.rules')), rsSel),
      h('p', { class: 'ed-hint' }, t('set.engineHint')),
      h('button', { type: 'button', class: 'ed-btn', onclick: () => { closeDlg(); go('studio'); } }, iconEl('wrench'), t('set.openStudio')));
  };
  let closeDlg = () => {};
  render();
  return openDialog({ title: t('set.title'), body, className: 'dk-setdlg', onMount: (m) => { closeDlg = () => m.close(null); } });
}

// --- links: invites, shared rulesets, records ---------------------------------------------------------------------------

// Deep links. Returns whether something was opened. Order: invite (parsed from the whole location by rooms/client.js),
// then #rs= (shared ruleset: validated, confirmed by the user before being stored - a link is untrusted input), then
// #dgn= (game record). A shared ruleset's id is sanitised to [A-Za-z0-9_.-] and suffixed if it collides with a
// built-in preset, so a link can never shadow or overwrite a built-in ruleset.
async function openFromHash() {
  const hash = location.hash || '';
  const inv = parseInvite(location);
  if (inv) {
    history.replaceState(null, '', location.pathname + location.search);
    clear();
    screen = 'lobby';
    await joinInvite(inv, { main, onPlay: (room, info) => startOnline(room, info), onDone: () => go(onlineAvailable() ? 'online' : 'home') });
    return !!main.querySelector('.dk-lobby');
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
  if (q.get('dgn')) {
    const txt = q.get('dgn');
    history.replaceState(null, '', location.pathname + location.search);
    go('replays', txt);
    return true;
  }
  return false;
}

go('home');
openFromHash();
window.addEventListener('hashchange', () => { openFromHash(); });

// Bring the store's last setup in line with the player ranges (old settings, deleted rulesets).
if (!rulesetChoices().some((c) => c.raw.id === store.settings.rulesetId)) { store.settings.rulesetId = PRESETS[0].id; save('settings'); }
// `select` is imported but unused; `void` marks it as referenced (silences unused-import lint) without side effects.
void select;
