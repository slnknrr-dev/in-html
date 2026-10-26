// media-player/main.js - the page: boot (artifact mode, store, engine), the app context every view receives, hash
// routes, the shell (sidebar, top bar, player bar, mobile tabs, now-playing sheet, video stage), view modes (desktop,
// mobile, home theatre — automatic with a manual switch), skins with dynamic colour from the cover, keyboard shortcuts,
// the Electron bridge (media keys, tray, mini window, dropped files with real paths), the mini player (#mini) and the
// first-start demo. Views live in views.js (library), manage.js (playlists, tags, tracking, workspaces), tools.js
// (sources, converter, import / export, settings), studio.js (skins, layouts, covers), nowplaying.js and edit.js.

// DESIGN RULES
// - One `app` context object is passed to every view instead of module singletons: views stay plain functions
//   (app, el, params, query) that can be rendered in any order, tested from the e2e scenario (globalThis.__mp), and
//   reached by the mini window without importing the shell.
// - Routing is hash-based (#/name/param?query): works from file://, from the single-file build and inside Electron's
//   custom scheme, where a history-API router would need server rewrites that do not exist.
// - Rendering is "replace the view" on every catalogue change, debounced (scheduleRerender); views are cheap DOM
//   builders. Guards keep this from destroying user work: no re-render while a field has focus or a dialog is open.
// - './strings.js' is imported first for its side effect (registering dictionaries) so t() works at module scope.
import './strings.js';
import { h, $, lsGet, lsSet } from '../ui/dom.js';
import { t, UI_STATE, ED_I18N, detectUILang, applyStaticI18n } from '../ui/i18n.js';
import { langLabel } from '../ui/lang.js';
import { toast, openMenu, bindLayerKeys, layers, confirmDialog } from '../ui/overlays.js';
import { facts } from '../catalog/facts.js';
import { choosePlayable, createNominal, attachSource, attachFile } from '../catalog/presence.js';
import { exportTree, exportDB, importData, readExchange, exportZip } from '../catalog/exchange.js';
import { addTags } from '../catalog/tags.js';
import { createCollection, itemsOf } from '../catalog/collections.js';
import { expandForPlay } from '../catalog/smart.js';
import { normNode } from '../catalog/model.js';
import { buildDemo, DEMO_TAG } from '../catalog/demo.js';
import { skinById, resolveSkin, skinVars, seedFromPixels, normSkin } from '../player/skins.js';
import { keymap, commandFor } from '../player/keys.js';
import { nextFocus, dirOfKey } from '../player/nav.js';
import { MODE, bridge, settings, saveSettings, own, probeOwn, caps, ownNeedsToken, servers, serverById, setOwnToken } from './env.js';
import { openStore } from './store.js';
import { initAccess, mediaURL, coverURL, importFiles } from './access.js';
import { createEngine } from './engine.js';
import { iconEl, icon, iconBtn } from './ui.js';
import { VIEWS } from './views.js';
import { MANAGE_VIEWS } from './manage.js';
import { TOOL_VIEWS } from './tools.js';
import { STUDIO_VIEWS } from './studio.js';
import { renderBar, renderNowPlaying, renderMini, renderVideoStage, updatePlayerUI } from './nowplaying.js';
import { workMenu, editWork, addMediaDialog, attachDialog, handleDroppedFiles } from './edit.js';

const ROUTES = { ...VIEWS, ...MANAGE_VIEWS, ...TOOL_VIEWS, ...STUDIO_VIEWS };
const root = document.getElementById('mp-app');
// The mini player is the same page opened as #mini (popup or Electron mini window): it shares the bundle and the
// store but renders only the mini UI and drives the main window over a BroadcastChannel.
const isMini = /(^#|&)mini\b/.test(location.hash);

UI_STATE.storageKey = 'mp-ui';
UI_STATE.titleKey = 'app.name';
UI_STATE.lang = detectUILang();
document.documentElement.lang = UI_STATE.lang;
bindLayerKeys();

const app = {
  mode: MODE, settings, bridge, own, route: { name: 'home', params: [], query: {} }, caps: caps(),
  db: null, store: null, engine: null, skinTokens: null,
  t, toast,
  nav(route) { location.hash = '#/' + route.replace(/^#?\/?/, ''); },
  back() { history.length > 1 ? history.back() : app.nav(''); },
  refresh() { renderRoute(); },
  // Opening a leaf (track, chapter, episode) navigates to its container with ?focus=<id>: a track has no useful page of
  // its own, the album with the track highlighted does.
  open(w) {
    if (!w) return;
    const target = ['track', 'chapter'].includes(w.kind) && w.parent && app.db.get(w.parent) ? w.parent : w.kind === 'episode' && w.parent ? (app.db.get(w.parent).kind === 'season' && app.db.get(app.db.get(w.parent).parent) ? app.db.get(w.parent).parent : w.parent) : w.id;
    app.nav('work/' + target + (target !== w.id ? '?focus=' + w.id : ''));
  },
  // Queue construction: an explicit list wins; a container expands to its playable leaves; a single leaf plays with
  // its siblings so "next" continues the album. Nominal items (no file) are dropped from the queue, except the one the
  // user clicked, which opens the attach dialog instead of failing silently.
  async playWork(w, { list = null, shuffle = null } = {}) {
    w = typeof w === 'string' ? app.db.get(w) : w;
    if (!w) return;
    let ids;
    let start = 0;
    if (list) { ids = list.map((x) => (typeof x === 'string' ? x : x.id)); start = Math.max(0, ids.indexOf(w.id)); }
    else {
      const leaves = expandForPlay(app.db, [w], { playable: false });
      if (leaves.length > 1 || (leaves[0] && leaves[0].id !== w.id)) { ids = leaves.map((x) => x.id); start = 0; }
      else {
        const parent = w.parent && app.db.get(w.parent);
        const sibs = parent ? app.db.children(parent.id) : [w];
        ids = sibs.map((x) => x.id);
        start = Math.max(0, ids.indexOf(w.id));
      }
    }
    const playable = ids.filter((id) => facts(app.db, app.db.get(id)).presence !== 'nominal' || id === ids[start]);
    if (facts(app.db, app.db.get(ids[start])).presence === 'nominal') {
      const choice = await attachDialog(app, app.db.get(ids[start]), { reason: 'nominal' });
      if (!choice) return;
    }
    await app.engine.playWorks(playable, { start: Math.max(0, playable.indexOf(ids[start])), shuffle });
  },
  playList(ids, opts = {}) { if (ids.length) app.engine.playWorks(ids.map((x) => (typeof x === 'string' ? x : x.id)), opts); },
  workMenu: (w, anchor, extra) => workMenu(app, w, anchor, extra),
  edit: (w) => editWork(app, w),
  addMedia: (opts) => addMediaDialog(app, opts),
  pickMedia(workId) { return choosePlayable(app.db, workId, { can: app.caps, prefer: { lang: settings.prefLang } }).media; },
  async resolveMedia(m, w) {
    const video = !!(m.video || m.kind === 'video' || (w && ['episode', 'movie', 'musicvideo'].includes(w.kind) && !m.audio));
    const url = await mediaURL(m, { mode: video ? 'video' : 'audio', ytdlp: app.caps.ytdlp });
    if (!url) return null;
    // Media of another origin cannot pass through the WebAudio graph: the engine plays it on its plain element.
    let crossOrigin = false;
    try { const u = new URL(url, location.href); crossOrigin = /^https?:$/.test(u.protocol) && u.origin !== location.origin; } catch { crossOrigin = false; }
    return { url, crossOrigin };
  },
  async coverOf(w) { for (const ref of (await import('../catalog/covers.js')).coverChain(app.db, w)) { const u = await coverURL(ref, 512); if (u) return u; } return null; },
  setView(v) { settings.view = v; saveSettings(); applyView(); },
  applySkin: () => applySkin(),
};
globalThis.__mp = app;

// --- view modes, skin ---------------------------------------------------------------------------------------------------

// 'auto' picks by width only; theatre is never automatic (a big screen is not necessarily a TV with a remote).
function effectiveView() {
  if (settings.view !== 'auto') return settings.view;
  return innerWidth < 760 ? 'mobile' : 'desktop';
}
function applyView() {
  const v = isMini ? 'mini' : effectiveView();
  root.dataset.view = v;
  document.documentElement.dataset.mpView = v;
  if (v === 'theatre') setTimeout(() => focusFirst(), 50);
}
addEventListener('resize', () => { if (settings.view === 'auto') applyView(); });

let seed = null;
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function isDark() { return settings.theme === 'dark' || (settings.theme === 'auto' && darkMQ.matches); }
// Skin = token set resolved for light / dark and the optional cover seed, written as custom properties on <html>.
// Every rule in app.css / player.css reads tokens, so a skin switch is one style recalculation, no re-render.
function applySkin() {
  const custom = app.db ? app.db.all('skin').map(normSkin) : [];
  const skin = skinById(settings.skin, custom);
  const tokens = resolveSkin(skin, { dark: isDark(), seed: settings.dynamicColor ? seed : null });
  app.skinTokens = tokens;
  const vars = skinVars(tokens);
  const s = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) s.setProperty(k, v);
  document.documentElement.dataset.theme = tokens.scheme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.mpBackground = skin.background;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tokens.bg);
}
darkMQ.addEventListener('change', applySkin);

// Dynamic colour: the cover is downscaled to 48x48 (enough for a dominant hue, cheap to read back);
// willReadFrequently hints a CPU-backed canvas, avoiding a GPU readback stall. crossOrigin='anonymous' plus the try:
// a cover from a server without CORS taints the canvas and getImageData throws; the skin then stays as it is.
async function updateSeed(work) {
  if (!settings.dynamicColor || !work) return;
  const u = await app.coverOf(work);
  if (!u) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 48;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 48, 48);
      const s = seedFromPixels(g.getImageData(0, 0, 48, 48).data, { width: 48 });
      if (s && s !== seed) { seed = s; applySkin(); }
    } catch { /* a picture from another origin */ }
  };
  img.src = u;
}

// --- routes ------------------------------------------------------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  const parts = p.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const query = Object.fromEntries(new URLSearchParams(q));
  return { name: parts[0] || 'home', params: parts.slice(1), query };
}

let main = null;
function renderRoute() {
  if (!main || isMini) return;
  const r = parseHash();
  app.route = r;
  const view = ROUTES[r.name] || ROUTES.home;
  main.textContent = '';
  main.scrollTop = 0;
  try { view(app, main, r.params, r.query); } catch (e) { console.error(e); main.append(h('div', { class: 'mp-empty' }, h('p', {}, t('mp.err.view', { msg: e.message })))); }
  for (const a of document.querySelectorAll('[data-route]')) a.classList.toggle('mp-on', a.dataset.route === r.name || (a.dataset.route === 'home' && r.name === 'home'));
  if (root.dataset.view === 'theatre') setTimeout(focusFirst, 30);
}
addEventListener('hashchange', () => { if (!isMini) renderRoute(); });

let rerenderTimer = null;
// 120 ms debounce coalesces bursts (a scan or an import emits many batches). Scroll position is restored by hand
// because replacing main's children resets it.
function scheduleRerender() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    // Keep what the user is typing: views that hold inputs re-render only their results (data-live).
    const active = document.activeElement;
    if (active && main && main.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    if (document.querySelector('.ed-dialog')) return;
    const top = main ? main.scrollTop : 0;
    renderRoute();
    if (main) main.scrollTop = top;
    renderSidebarLists();
  }, 120);
}

// --- shell ---------------------------------------------------------------------------------------------------------------

const NAV = [
  ['home', 'home', 'mp.nav.home'], ['music', 'music', 'mp.nav.music'], ['audiobooks', 'book', 'mp.nav.audiobooks'], ['anime', 'anime', 'mp.nav.anime'],
  ['series', 'tv', 'mp.nav.series'], ['movies', 'film', 'mp.nav.movies'], ['videos', 'video', 'mp.nav.videos'], ['podcasts', 'mic', 'mp.nav.podcasts'],
];
const NAV2 = [
  ['search', 'search', 'mp.nav.search'], ['playlists', 'list', 'mp.nav.playlists'], ['tags', 'tag', 'mp.nav.tags'], ['tracking', 'chart', 'mp.nav.tracking'],
  ['workspaces', 'folderTree', 'mp.nav.workspaces'],
];
const NAV3 = [
  ['sources', 'source', 'mp.nav.sources'], ['convert', 'convert', 'mp.nav.convert'], ['studio', 'palette', 'mp.nav.studio'], ['settings', 'settings', 'mp.nav.settings'],
];

const navLink = ([route, ic, key]) => h('a', { href: '#/' + (route === 'home' ? '' : route), class: 'mp-nav-a', dataset: { route, focus: '1' } }, iconEl(ic), h('span', {}, t(key)));

function renderShell() {
  root.textContent = '';
  const side = h('aside', { class: 'mp-side', 'aria-label': t('mp.nav.label') },
    h('div', { class: 'mp-brand' }, h('span', { class: 'mp-logo', html: '<svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="9" fill="var(--mp-accent)"/><circle cx="16" cy="16" r="9.5" fill="var(--mp-bg)"/><circle cx="16" cy="16" r="3.2" fill="var(--mp-accent)"/></svg>' }), h('b', {}, t('app.name'))),
    h('nav', { class: 'mp-nav' }, NAV.map(navLink)), h('div', { class: 'mp-nav-sep' }), h('nav', { class: 'mp-nav' }, NAV2.map(navLink)),
    h('div', { class: 'mp-side-lists', id: 'mp-side-lists' }), h('div', { class: 'mp-nav-sep' }), h('nav', { class: 'mp-nav' }, NAV3.map(navLink)));
  const search = h('input', { type: 'search', class: 'ed-input mp-search', placeholder: t('mp.search.ph'), 'aria-label': t('mp.nav.search'), value: app.route.name === 'search' ? app.route.query.q || '' : '' });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.nav('search?q=' + encodeURIComponent(search.value)); });
  search.addEventListener('input', () => { if (app.route.name === 'search') history.replaceState(null, '', '#/search?q=' + encodeURIComponent(search.value)); clearTimeout(search._t); search._t = setTimeout(() => { if (app.route.name !== 'search') app.nav('search?q=' + encodeURIComponent(search.value)); else renderRoute(); search.focus(); }, 260); });
  const viewSel = h('div', { class: 'ed-seg mp-viewseg', role: 'radiogroup', 'aria-label': t('mp.view') }, ['auto', 'desktop', 'mobile', 'theatre'].map((v) => h('button', { type: 'button', class: 'ed-seg-btn' + (settings.view === v ? ' ed-on' : ''), role: 'radio', 'aria-checked': String(settings.view === v), title: t('mp.view.' + v), dataset: { v }, onclick: () => { app.setView(v); renderShell(); } }, iconEl({ auto: 'sync', desktop: 'grid', mobile: 'rows', theatre: 'theatre' }[v]))));
  const lang = h('select', { class: 'ed-input ed-select mp-lang', 'aria-label': t('ap.lang') }, Object.keys(ED_I18N).map((l) => h('option', { value: l, selected: l === UI_STATE.lang }, langLabel(l))));
  lang.addEventListener('change', () => { UI_STATE.lang = lang.value; lsSet(UI_STATE.storageKey, lang.value); document.documentElement.lang = lang.value; applyStaticI18n(); renderShell(); });
  const status = h('span', { class: 'mp-status', id: 'mp-status' });
  const top = h('header', { class: 'mp-top' },
    iconBtn('chevLeft', t('mp.back'), () => app.back(), 'mp-back'),
    search, h('span', { class: 'ed-spacer' }), status,
    iconBtn('plus', t('mp.add'), () => app.addMedia(), 'mp-add-btn'),
    viewSel, lang,
    iconBtn(isDark() ? 'sun' : 'moon', t('mp.theme'), () => { settings.theme = isDark() ? 'light' : 'dark'; saveSettings(); applySkin(); renderShell(); }));
  main = h('main', { class: 'mp-main', id: 'mp-main', tabindex: '-1' });
  const bar = h('section', { class: 'mp-bar', id: 'mp-bar', 'aria-label': t('mp.player') });
  const tabsNav = h('nav', { class: 'mp-mtabs', 'aria-label': t('mp.nav.label') }, [['home', 'home', 'mp.nav.home'], ['library', 'grid', 'mp.nav.library'], ['search', 'search', 'mp.nav.search'], ['playlists', 'list', 'mp.nav.playlists'], ['more', 'more', 'mp.nav.more']].map(navLink));
  const np = h('div', { class: 'mp-np', id: 'mp-np', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'mp-stage', id: 'mp-stage' });
  root.append(side, top, main, stage, bar, tabsNav, np);
  renderBar(app, bar);
  renderVideoStage(app, stage);
  renderNowPlaying(app, np);
  renderSidebarLists();
  updateStatus();
  renderRoute();
}

function renderSidebarLists() {
  const box = document.getElementById('mp-side-lists');
  if (!box || !app.db) return;
  box.textContent = '';
  const colls = app.db.all('collection').sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, 30);
  for (const c of colls) box.append(h('a', { href: '#/playlist/' + c.id, class: 'mp-nav-a mp-nav-sub', dataset: { focus: '1' } }, iconEl(c.kind === 'smart' ? 'wand' : c.kind === 'mood' ? 'moon' : 'list'), h('span', {}, c.name || t('mp.untitled'))));
  for (const w of app.db.all('workspace').slice(0, 10)) box.append(h('a', { href: '#/workspaces/' + w.id, class: 'mp-nav-a mp-nav-sub', dataset: { focus: '1' } }, iconEl('folderTree'), h('span', {}, w.name || t('mp.untitled'))));
}

function updateStatus() {
  const el = document.getElementById('mp-status');
  if (!el || !app.store) return;
  const s = app.store;
  el.textContent = '';
  const where = s.kind === 'remote' ? (MODE === 'electron' ? t('mp.status.desktop') : t('mp.status.server')) : s.persistent ? t('mp.status.local') : t('mp.status.memory');
  el.append(h('span', { class: 'mp-dot mp-dot-' + (s.status === 'ok' ? 'ok' : 'bad') }), h('span', {}, s.status === 'ok' ? where : t('mp.status.' + s.status)));
  el.title = t('mp.status.hint.' + (s.kind === 'remote' ? 'remote' : s.persistent ? 'local' : 'memory'));
}

// --- keyboard and D-pad --------------------------------------------------------------------------------------------------

// Theatre / D-pad navigation: candidates are collected per key press, and nextFocus (player/nav.js) picks the
// nearest element in the pressed direction by geometry, the approach TV UIs use, since DOM order does not match
// a grid's visual neighbours.
function focusables() { return [...document.querySelectorAll('.mp-main [data-focus], .mp-main .mp-card, .mp-main .mp-row, .mp-side a, .mp-bar button, .mp-np.mp-open button')].filter((e) => e.offsetParent !== null); }
function focusFirst() { const f = focusables().find((e) => main.contains(e)); if (f) f.focus({ preventScroll: false }); }

let keys = keymap(settings.keys);
app.reloadKeys = () => { keys = keymap(settings.keys); };
const COMMAND = {
  'play-pause': () => app.engine.toggle(), stop: () => app.engine.stop(), next: () => app.engine.next(), previous: () => app.engine.prev(),
  'seek-back': () => app.engine.seekBy(-5), 'seek-forward': () => app.engine.seekBy(5), 'seek-back-long': () => app.engine.seekBy(-settings.seekForward), 'seek-forward-long': () => app.engine.seekBy(settings.seekForward),
  'volume-up': () => app.engine.setVolume(app.engine.state.volume + 0.05), 'volume-down': () => app.engine.setVolume(app.engine.state.volume - 0.05), mute: () => app.engine.setMuted(!app.engine.state.muted),
  shuffle: () => app.engine.setShuffle(app.engine.state.shuffle === 'off' ? 'artist' : 'off'), repeat: () => app.engine.cycleRepeat(),
  like: () => { const c = app.engine.current(); if (c) app.db.patch(c.work.id, { favorite: !c.work.favorite }); },
  queue: () => app.openNowPlaying('queue'), lyrics: () => app.openNowPlaying('lyrics'), 'now-playing': () => app.openNowPlaying(),
  search: () => { const s = $('.mp-search'); if (s) s.focus(); }, fullscreen: () => toggleFullscreen(), theatre: () => app.setView(effectiveView() === 'theatre' ? 'auto' : 'theatre'),
  mini: () => openMini(), 'speed-up': () => app.engine.setSpeed(Math.min(4, Math.round((app.engine.state.speed + 0.1) * 10) / 10)), 'speed-down': () => app.engine.setSpeed(Math.max(0.25, Math.round((app.engine.state.speed - 0.1) * 10) / 10)),
  'speed-reset': () => app.engine.setSpeed(1), 'chapter-next': () => chapterSkip(1), 'chapter-previous': () => chapterSkip(-1),
  bookmark: () => { if (app.engine.bookmark()) toast(t('mp.bookmarked'), 'ok'); }, 'ab-repeat': () => app.engine.abPoint(), 'skip-marker': () => app.engine.skipMarker(),
  sleep: () => app.engine.sleep(app.engine.state.sleep ? 'off' : 'minutes', settings.sleepMinutes), eq: () => app.nav('settings/playback'), help: () => app.nav('settings/keys'),
  back: () => { if (layers.length) return; if (document.getElementById('mp-np').classList.contains('mp-open')) app.closeNowPlaying(); else if (root.dataset.view === 'theatre') app.back(); },
  'frame-next': () => { const e = app.engine.element(); e.pause(); e.currentTime += 1 / 25; }, 'frame-previous': () => { const e = app.engine.element(); e.pause(); e.currentTime -= 1 / 25; },
};
for (let i = 0; i < 10; i++) COMMAND['seek-' + i] = () => { const s = app.engine.state; if (s.duration) app.engine.seek((s.duration * i) / 10); };
function chapterSkip(dir) { import('../player/timers.js').then(({ chapterSkip: cs }) => { const s = app.engine.state; const to = cs(s.current ? s.current.chapters : [], s.position, dir); if (to != null) app.engine.seek(to); else if (dir > 0) app.engine.next(); else app.engine.prev(); }); }
app.command = (c) => { if (COMMAND[c]) COMMAND[c](); };

// Key handling order: D-pad navigation (theatre only), then open overlays swallow keys (they bind their own), then
// the configurable keymap. Seek / volume keys yield to a focused range input so arrows adjust the slider natively;
// digits do not seek in theatre mode, where remotes send digits for other purposes.
addEventListener('keydown', (e) => {
  if (!app.engine) return;
  const inField = !!(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'));
  if (root.dataset.view === 'theatre' && !inField && !layers.length) {
    const dir = dirOfKey(e.key);
    if (dir && !(document.getElementById('mp-np').classList.contains('mp-open') && (dir === 'left' || dir === 'right') && document.activeElement === document.body)) {
      const list = focusables();
      const rects = list.map((x) => { const r = x.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      const i = nextFocus(rects, list.indexOf(document.activeElement), dir);
      if (i >= 0) { e.preventDefault(); list[i].focus(); list[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
    }
  }
  if (layers.length && e.key !== 'MediaPlayPause') return;
  const cmd = commandFor(e, keys, { inField });
  if (!cmd) return;
  if (cmd === 'skip-marker' && (!app.engine.state.current || !app.engine.state.current.marker)) return;
  if (['seek-back', 'seek-forward', 'volume-up', 'volume-down'].includes(cmd) && document.activeElement && document.activeElement.matches('input[type=range]')) return;
  if (cmd.startsWith('seek-') && /^seek-\d$/.test(cmd) && root.dataset.view === 'theatre') return;
  e.preventDefault();
  app.command(cmd);
});

function toggleFullscreen() {
  if (bridge) { bridge.window.isFullScreen().then((f) => bridge.window.setFullScreen(!f)); return; }
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
}
app.toggleFullscreen = toggleFullscreen;

function openMini() {
  if (bridge) bridge.mini.toggle({});
  else window.open(location.pathname + '#mini', 'mp-mini', 'popup,width=380,height=150');
}
app.openMini = openMini;

// --- mini player channel (the mini window controls the main page) -------------------------------------------------------

// BroadcastChannel (same origin, any window) instead of window.opener messaging: works for the Electron mini window,
// which has no opener, and survives reloads of either side. State is throttled to 2 messages/s.
const remoteCh = typeof BroadcastChannel === 'function' ? new BroadcastChannel('mp-remote') : null;

function startMainChannel() {
  if (!remoteCh) return;
  remoteCh.onmessage = (m) => { const d = m.data || {}; if (d.type === 'cmd') { if (d.cmd === 'seek') app.engine.seek(d.value); else app.command(d.cmd); } if (d.type === 'hello') sendState(true); };
  let last = 0;
  const sendState = async (force) => {
    const now = Date.now();
    if (!force && now - last < 500) return;
    last = now;
    const s = app.engine.state;
    const w = s.current && s.current.work;
    const f = w ? facts(app.db, w) : null;
    remoteCh.postMessage({ type: 'state', title: f ? f.title : '', artist: f ? (f.artist.length ? f.artist : f.author).join(', ') || f.show : '', playing: s.playing, position: s.position, duration: s.duration, cover: w ? await app.coverOf(w) : null });
  };
  app.onPlayerState.push(() => sendState(false));
}

// --- boot -----------------------------------------------------------------------------------------------------------------

app.onPlayerState = [];

// Store selection: the page's own backend when it answers api/info, else a configured server, else local. A 401/403
// asks for a token once and retries; any other failure falls back to the local store with a toast, so the page
// always boots into something usable.
async function connectStore() {
  let server = null;
  if (own) {
    const info = await probeOwn();
    if (info) server = own;
    if (info && ownNeedsToken() && !own.token) {
      const tok = await askToken();
      if (tok) setOwnToken(tok);
    }
  } else if (settings.store !== 'local') server = serverById(settings.store);
  try {
    return await openStore({ server });
  } catch (e) {
    if (server && (e.status === 401 || e.status === 403)) {
      const tok = await askToken(true);
      if (tok) { if (server === own) setOwnToken(tok); else server.token = tok; return openStore({ server }); }
    }
    toast(t('mp.err.store', { msg: e.message }), 'error');
    return openStore({ server: null });
  }
}

async function askToken(wrong = false) {
  const { promptDialog } = await import('../ui/overlays.js');
  return promptDialog(t('mp.token.title'), wrong ? t('mp.token.wrong') : t('mp.token.label'), '');
}

// The demo is seeded once per browser (flag in localStorage), not "whenever the catalogue is empty": a user who
// deleted the demo must not get it back on the next visit. Demo nodes carry DEMO_TAG so removeDemo finds them.
async function seedDemo(force = false) {
  const db = app.db;
  if (!force && (db.count('work') || lsGet('mp-demo-seeded', false))) return;
  const { nodes, blobs } = buildDemo({});
  for (const b of blobs) await app.store.blobs.put(new Blob([b.bytes], { type: b.type }), b.type, b.id);
  db.batch(() => { for (const n of nodes) db.put(normNode(n), { keepTime: true }); }, { label: 'demo' });
  lsSet('mp-demo-seeded', true);
}
app.seedDemo = seedDemo;
app.removeDemo = () => { const db = app.db; db.batch(() => { for (const n of db.all()) if ((n.tags || []).includes(DEMO_TAG)) db.remove(n.id, { cascade: false }); }, { label: 'remove demo' }); };

async function boot() {
  applyView();
  app.store = await connectStore();
  app.db = app.store.db;
  initAccess(app.store);
  app.caps = caps();
  applySkin();
  app.engine = createEngine({
    db: app.db, settings, pick: (id) => app.pickMedia(id), resolve: (m, w) => app.resolveMedia(m, w),
    onState: (s) => { updatePlayerUI(app, s); for (const fn of app.onPlayerState) fn(s); },
    onError: (kind, w) => { if (kind !== 'blocked') toast(t('mp.err.play.' + kind, { title: w ? w.title : '' }), kind === 'nominal' ? 'info' : 'warn'); },
  });
  app.engine.artwork = null;
  let lastWork = null;
  app.onPlayerState.push((s) => {
    const w = s.current && s.current.work;
    if (w && w.id !== lastWork) {
      lastWork = w.id;
      updateSeed(w);
      app.coverOf(w).then((u) => { app.engine.artwork = () => u; });
      settings.lastQueue = app.engine.save();
      saveSettings();
      if (bridge && settings.tray) setTray(w);
    }
  });
  // pagehide, not beforeunload / unload: it fires on mobile tab discards and bfcache navigations, where unload does not.
  addEventListener('pagehide', () => { settings.lastQueue = app.engine.save(); saveSettings(); });
  app.store.on((e) => { if (e.type === 'status') updateStatus(); });
  // Resume positions (every 5 s) and analysis results are written in labelled batches that views do not display;
  // re-rendering on them would rebuild the page every few seconds while playing.
  app.db.on((e) => { if (!['position', 'analysis'].includes(e.label)) scheduleRerender(); });
  if (isMini) { renderMini(app, root, remoteCh); return; }
  await seedDemo();
  renderShell();
  startMainChannel();
  if (settings.lastQueue) app.engine.restore(settings.lastQueue);
  if (bridge) startBridge();
  setupDrop();
  globalThis.__mpReady = true;
}

function setTray(w) {
  const f = facts(app.db, w);
  bridge.tray.set({ tooltip: `${f.title}${f.artist[0] ? ' — ' + f.artist[0] : ''}`, quitLabel: t('mp.quit'), items: [
    { id: 'play-pause', label: t('mp.playPause') }, { id: 'next', label: t('mp.next') }, { id: 'previous', label: t('mp.previous') }, { type: 'separator' },
    { id: 'mini', label: t('mp.miniPlayer') }, { id: 'show', label: t('mp.showWindow') },
  ] }).catch(() => {});
}

function startBridge() {
  bridge.onCommand((c) => {
    if (c.type === 'media') app.command(c.action === 'previous' ? 'previous' : c.action);
    else if (c.type === 'shortcut') app.command(c.command);
    else if (c.type === 'tray') { if (c.id === 'mini') openMini(); else if (c.id === 'show' || c.id === 'click') bridge.window.showMain(); else app.command(c.id); }
    else if (c.type === 'open' && c.paths && c.paths.length) handleDroppedFiles(app, [], c.paths);
  });
  bridge.takeOpenRequests().then((paths) => { if (paths && paths.length) handleDroppedFiles(app, [], paths); });
  if (settings.mediaKeys) bridge.shortcuts.set({ media: true });
  app.onPlayerState.push((s) => { const v = s.current && s.current.video && s.playing; if (v !== app._awake) { app._awake = v; bridge.keepAwake(!!v); } });
}

function setupDrop() {
  addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('mp-dropping'); } });
  // dragleave fires when moving between child elements too; relatedTarget is null only when leaving the window.
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) root.classList.remove('mp-dropping'); });
  addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    root.classList.remove('mp-dropping');
    const files = [...e.dataTransfer.files];
    // In Electron, real filesystem paths let the backend reference files in place; in a browser only File objects
    // exist, which are imported as blobs.
    const paths = bridge ? files.map((f) => bridge.pathForFile(f)).filter(Boolean) : [];
    handleDroppedFiles(app, files, paths);
  });
}

// Libraries for the e2e scenario and the developer console.
app.lib = { exportTree, exportDB, importData, readExchange, exportZip, createNominal, attachSource, attachFile, addTags, createCollection, itemsOf };

app.openNowPlaying = (panel) => { const np = document.getElementById('mp-np'); if (np && np._open) np._open(panel); };
app.closeNowPlaying = () => { const np = document.getElementById('mp-np'); if (np && np._close) np._close(); };
app.renderShell = renderShell;
app.servers = servers;

boot().catch((e) => { console.error(e); root.textContent = ''; root.append(h('div', { class: 'mp-empty' }, h('p', {}, String(e && e.message || e)))); });
export { app, confirmDialog, importFiles, openMenu, icon };
