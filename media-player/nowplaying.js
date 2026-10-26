// media-player/nowplaying.js - what plays: the player bar, the now-playing sheet drawn from the chosen layout
// (player/layouts.js: cover, texts, seek bar styles incl. a waveform, transport and tool buttons, lyrics karaoke,
// queue, visualizer, spacers), tabs or side panels for lyrics and the queue, gestures (swipes, double taps, long
// press), the video stage (the engine's element; SRT / ASS / VTT subtitles converted to WebVTT tracks; "Skip intro";
// the next-episode countdown), honest in-browser analysis of the playing file (loudness, tempo, energy, waveform),
// and the mini player (#mini: in Electron's mini window or a popup, it remote-controls the main page).

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { openMenu, toast } from '../ui/overlays.js';
import { facts } from '../catalog/facts.js';
import { parseLrc, lineAt, wordAt } from '../mediatags/lrc.js';
import { parseSubs, toVtt } from '../mediatags/subs.js';
import { layoutById, normLayout } from '../player/layouts.js';
import { nextCountdown } from '../player/timers.js';
import { SPEEDS } from '../player/gain.js';
import { analyze, waveform } from '../player/analysis.js';
import { settings, saveSettings, bridge } from './env.js';
import { locURL, readLoc } from './access.js';
import { coverEl, fmtTime, icon, iconEl, iconBtn, presenceBadge, tagChip, subtitleOf } from './ui.js';

const SIZE = { s: 32, m: 40, l: 52, xl: 72 };
const live = { bar: null, np: null, stage: null, workId: null, waves: new Map(), lrc: null, analysing: new Set() };

// DESIGN RULES
// - Build once, update in place: renderBar / renderNowPlaying build DOM when the item or layout changes; the 5 Hz
//   engine state only flows through updatePlayerUI, which finds live nodes by data-mp="..." hooks and touches only
//   what changed (setText compares first). Rebuilding the sheet five times a second would kill text selection,
//   focus and running CSS animations.
// - data-mp hooks instead of stored references: the same control can appear in the bar, the sheet and a preview at
//   once; querySelectorAll updates all of them without registration or cleanup.
function layoutFor(app, video) {
  const custom = app.db.all('layout').map((l) => ({ ...normLayout(l), id: l.id }));
  const ws = settings.workspace && app.db.get(settings.workspace);
  const id = video ? settings.videoLayout : (ws && ws.layout) || settings.layout;
  return layoutById(id, custom);
}

// --- controls ---------------------------------------------------------------------------------------------------------

function ctlButton(app, ic, label, onClick, size = 'm', extra = {}) {
  const b = h('button', { type: 'button', class: 'mp-cbtn mp-cbtn-' + size + (extra.cls ? ' ' + extra.cls : ''), 'aria-label': label, title: label, html: icon(ic), onclick: (e) => { e.stopPropagation(); onClick(e); }, dataset: { focus: '1', ...(extra.bind ? { mp: extra.bind } : {}) } });
  return b;
}

function seekBar(app, style = 'line', times = 'below', preview = false) {
  const wrap = h('div', { class: `mp-seek mp-seek-${style} mp-times-${times}` });
  const range = h('input', { type: 'range', class: 'mp-seek-r', min: 0, max: 1000, step: 1, value: 0, 'aria-label': t('mp.seek'), dataset: { mp: 'seek' } });
  let dragging = false;
  range.addEventListener('pointerdown', () => { dragging = true; });
  range.addEventListener('input', () => { const s = app.engine.state; wrap.querySelector('[data-mp="cur"]').textContent = fmtTime((range.value / 1000) * s.duration); });
  range.addEventListener('change', () => { dragging = false; const s = app.engine.state; if (s.duration) app.engine.seek((range.value / 1000) * s.duration); });
  range._dragging = () => dragging;
  const cur = h('span', { class: 'mp-time', dataset: { mp: 'cur' } }, '0:00');
  const tot = h('span', { class: 'mp-time', dataset: { mp: 'tot' } }, '0:00');
  const track = h('div', { class: 'mp-seek-track' }, h('i', { class: 'mp-seek-buf', dataset: { mp: 'buf' } }), h('i', { class: 'mp-seek-fill', dataset: { mp: 'fill' } }));
  if (style === 'wave') track.append(h('canvas', { class: 'mp-wave', width: 600, height: 48, dataset: { mp: 'wave' } }));
  if (style === 'ring') {
    track.append(h('svg', { class: 'mp-ring', viewBox: '0 0 100 100', html: '<circle cx="50" cy="50" r="44" class="mp-ring-bg"/><circle cx="50" cy="50" r="44" class="mp-ring-fg" data-mp="ring" pathLength="1000"/>' }));
  }
  track.append(range);
  if (times === 'sides') wrap.append(cur, track, tot);
  else if (times === 'below') wrap.append(track, h('div', { class: 'mp-times' }, cur, tot));
  else wrap.append(track);
  if (preview) { range.disabled = true; range.value = 360; }
  return wrap;
}

function speedMenu(app, anchor) {
  openMenu(anchor, SPEEDS.map((s) => ({ label: s + '×', checked: Math.abs(app.engine.state.speed - s) < 0.01, action: () => app.engine.setSpeed(s) })), { label: t('mp.speed') });
}
function sleepMenu(app, anchor) {
  const cur = app.engine.state.sleep;
  openMenu(anchor, [
    { label: t('mp.sleep.off'), checked: !cur, action: () => app.engine.sleep('off') },
    ...[15, 30, 45, 60, 90].map((m) => ({ label: t('mp.sleep.min', { n: m }), checked: !!cur && cur.mode === 'minutes' && cur.minutes === m, action: () => app.engine.sleep('minutes', m) })),
    { label: t('mp.sleep.track'), checked: !!cur && cur.mode === 'track', action: () => app.engine.sleep('track') },
    { label: t('mp.sleep.chapter'), checked: !!cur && cur.mode === 'chapter', action: () => app.engine.sleep('chapter') },
    { label: t('mp.sleep.queue'), checked: !!cur && cur.mode === 'queue', action: () => app.engine.sleep('queue') },
  ], { label: t('mp.sleep') });
}
function subsMenu(app, anchor) {
  const e = app.engine.element();
  const tracks = [...e.textTracks];
  openMenu(anchor, [{ label: t('mp.subs.off'), checked: tracks.every((x) => x.mode !== 'showing'), action: () => { for (const x of tracks) x.mode = 'disabled'; } },
    ...tracks.map((x, i) => ({ label: x.label || x.language || t('mp.subs.track', { n: i + 1 }), checked: x.mode === 'showing', action: () => { tracks.forEach((y, j) => { y.mode = j === i ? 'showing' : 'disabled'; }); } }))], { label: t('mp.subtitles') });
}

function control(app, c, { preview }) {
  const e = app.engine;
  const size = c.size || 'm';
  const s = e.state;
  const w = s.current && s.current.work;
  const f = w ? facts(app.db, w) : null;
  switch (c.type) {
    case 'cover': {
      const box = h('div', { class: `mp-np-cover mp-cs-${c.size} mp-shape-${c.shape}${c.spin ? ' mp-spin' : ''}${c.glow ? ' mp-glow' : ''}`, dataset: { mp: 'coverbox' } });
      box.append(w ? coverEl(app.db, w, { size: 640, eager: true }) : h('div', { class: 'mp-cover mp-cover-empty', html: icon('music') }));
      return box;
    }
    case 'title': return h('div', { class: `mp-np-title mp-ts-${c.size} mp-al-${c.align}${c.marquee ? ' mp-marquee' : ''}`, dataset: { mp: 'title' } }, h('span', {}, f ? f.title : preview ? t('mp.st.sampleTitle') : t('mp.nothing')));
    case 'artist': return h('div', { class: `mp-np-artist mp-ts-${c.size} mp-al-${c.align}`, dataset: { mp: 'artist' } }, f ? (f.artist.length ? f.artist : f.author).join(', ') || f.show : preview ? t('mp.st.sampleArtist') : '');
    case 'album': return h('div', { class: `mp-np-album mp-ts-${c.size} mp-al-${c.align}`, dataset: { mp: 'album' } }, f ? f.album || f.book || (w && w.kind === 'episode' ? subtitleOf(app.db, w) : '') : '');
    case 'chapter': return h('div', { class: `mp-np-chapter mp-ts-${c.size}`, dataset: { mp: 'chapter' } });
    case 'next-up': return h('div', { class: 'mp-np-next', dataset: { mp: 'nextup' } });
    case 'presence': return f ? presenceBadge(f.presence) : h('span');
    case 'tags': return h('div', { class: 'mp-chips mp-np-tags' }, f ? [...(w.tags || [])].slice(0, c.max).map((k) => tagChip(app.db, k)) : []);
    case 'seek': return seekBar(app, c.style, c.times, preview);
    case 'time-current': return h('span', { class: 'mp-time', dataset: { mp: 'cur' } }, '0:00');
    case 'time-total': return h('span', { class: 'mp-time', dataset: { mp: c.remaining ? 'left' : 'tot' } }, '0:00');
    case 'play': return ctlButton(app, s.playing ? 'pause' : 'play', s.playing ? t('mp.pause') : t('mp.play'), () => e.toggle(), size, { cls: 'mp-play mp-play-' + c.style, bind: 'play' });
    case 'previous': return ctlButton(app, 'prev', t('mp.previous'), () => e.prev(), size);
    case 'next': return ctlButton(app, 'next', t('mp.next'), () => e.next(), size);
    case 'stop': return ctlButton(app, 'stop', t('mp.stop'), () => e.stop(), size);
    case 'seek-back': return ctlButton(app, 'back10', t('mp.seekBack', { n: c.seconds }), () => e.seekBy(-c.seconds), size, { cls: 'mp-skipn' });
    case 'seek-forward': return ctlButton(app, 'fwd10', t('mp.seekFwd', { n: c.seconds }), () => e.seekBy(c.seconds), size, { cls: 'mp-skipn' });
    case 'shuffle': return ctlButton(app, 'shuffle', t('mp.shuffle'), (ev) => openMenu(ev.currentTarget, ['off', 'random', 'artist', 'album', 'smart'].map((m) => ({ label: t('mp.shuffle.' + m), checked: e.state.shuffle === m, action: () => e.setShuffle(m) }))), size, { cls: s.shuffle !== 'off' ? 'mp-active' : '', bind: 'shuffle' });
    case 'repeat': return ctlButton(app, s.repeat === 'one' ? 'repeatOne' : 'repeat', t('mp.repeat.' + s.repeat), () => e.cycleRepeat(), size, { cls: s.repeat !== 'off' ? 'mp-active' : '', bind: 'repeat' });
    case 'like': return ctlButton(app, 'heart', t('mp.like'), () => { if (w) app.db.patch(w.id, { favorite: !w.favorite }); }, size, { cls: w && w.favorite ? 'mp-liked' : '', bind: 'like' });
    case 'rating': {
      const box = h('div', { class: 'mp-stars', role: 'radiogroup', 'aria-label': t('mp.rating') });
      const val = w && w.rating ? w.rating : 0;
      for (let i = 1; i <= c.stars; i++) box.append(h('button', { type: 'button', class: 'mp-star' + (val >= (i * 10) / c.stars ? ' mp-on' : ''), 'aria-label': String(i), html: icon('star'), onclick: () => { if (w) app.db.patch(w.id, { rating: Math.round(((i * 10) / c.stars) * 10) / 10 }); } }));
      return box;
    }
    case 'speed': return ctlButton(app, 'speed', t('mp.speed'), (ev) => speedMenu(app, ev.currentTarget), size, { bind: 'speed' });
    case 'sleep': return ctlButton(app, 'moon', t('mp.sleep'), (ev) => sleepMenu(app, ev.currentTarget), size, { cls: s.sleep ? 'mp-active' : '', bind: 'sleep' });
    case 'eq': return ctlButton(app, 'eq', t('mp.eq'), () => { app.closeNowPlaying(); app.nav('settings/playback'); }, size, { cls: settings.eqOn ? 'mp-active' : '' });
    case 'ab': return ctlButton(app, 'ab', t('mp.ab'), () => e.abPoint(), size, { cls: s.ab ? 'mp-active' : '', bind: 'ab' });
    case 'bookmark': return ctlButton(app, 'bookmark', t('mp.bookmark'), () => { if (e.bookmark()) toast(t('mp.bookmarked'), 'ok'); }, size);
    case 'skip-marker': return h('button', { type: 'button', class: 'ed-btn mp-skipmarker', hidden: true, dataset: { mp: 'skipmarker', focus: '1' }, onclick: () => e.skipMarker() }, iconEl('skip'), h('span', {}, t('mp.skip')));
    case 'subtitles': return ctlButton(app, 'subtitles', t('mp.subtitles'), (ev) => subsMenu(app, ev.currentTarget), size);
    case 'audio-track': return ctlButton(app, 'audio', t('mp.audioTrack'), (ev) => { const at = app.engine.element().audioTracks; if (!at || at.length < 2) { toast(t('mp.audioTrack.none')); return; } openMenu(ev.currentTarget, [...at].map((x, i) => ({ label: x.label || x.language || String(i + 1), checked: x.enabled, action: () => { [...at].forEach((y, j) => { y.enabled = j === i; }); } }))); }, size);
    case 'volume': {
      if (c.style === 'button') return ctlButton(app, s.muted ? 'mute' : 'volume', t('mp.volume'), () => e.setMuted(!e.state.muted), 'm', { bind: 'mute' });
      const r = h('input', { type: 'range', class: 'mp-vol', min: 0, max: 1, step: 0.01, value: s.volume, 'aria-label': t('mp.volume'), dataset: { mp: 'vol' } });
      r.addEventListener('input', () => e.setVolume(+r.value));
      return h('div', { class: 'mp-volbox' }, ctlButton(app, s.muted ? 'mute' : 'volume', t('mp.mute'), () => e.setMuted(!e.state.muted), 's', { bind: 'mute' }), r);
    }
    case 'lyrics': return ctlButton(app, 'lyrics', t('mp.lyrics'), () => app.openNowPlaying('lyrics'), size);
    case 'queue': return ctlButton(app, 'queue', t('mp.queue'), () => app.openNowPlaying('queue'), size);
    case 'mini': return ctlButton(app, 'mini', t('mp.miniPlayer'), () => app.openMini(), size);
    case 'theatre': return ctlButton(app, 'theatre', t('mp.view.theatre'), () => app.setView('theatre'), size);
    case 'fullscreen': return ctlButton(app, 'fullscreen', t('mp.fullscreen'), () => app.toggleFullscreen(), size);
    case 'more': return ctlButton(app, 'more', t('mp.more'), (ev) => { if (w) app.workMenu(w, ev.currentTarget); }, size);
    case 'lyrics-panel': return lyricsPanel(app, c);
    case 'queue-panel': return queuePanel(app, c.items);
    case 'visualizer': return h('canvas', { class: 'mp-viz mp-viz-' + c.style, width: 600, height: c.height, style: { height: c.height + 'px' }, dataset: { mp: 'viz', vstyle: c.style } });
    case 'spacer': return h('span', { class: 'mp-spacer' + (c.grow ? ' mp-grow' : ''), style: c.width ? { width: c.width + 'px' } : null });
    default: return h('span');
  }
}

export function renderLayout(app, layout, { preview = false } = {}) {
  const box = h('div', { class: 'mp-layout mp-bg-' + layout.background, dataset: { layout: layout.id } });
  for (const r of layout.rows) box.append(h('div', { class: `mp-lrow mp-align-${r.align} mp-gap-${r.gap}${r.wrap ? ' mp-wrap' : ''}` }, r.controls.map((c) => control(app, c, { preview }))));
  return box;
}

// --- lyrics ------------------------------------------------------------------------------------------------------------

function lyricsOf(app) {
  const c = app.engine.state.current;
  if (!c) return null;
  const w = c.work;
  if (live.lrc && live.lrc.id === w.id) return live.lrc;
  const l = w.lyrics || {};
  live.lrc = { id: w.id, lrc: l.lrc ? parseLrc(l.lrc) : l.text ? parseLrc(l.text) : null };
  return live.lrc;
}

function lyricsPanel(app, c = { mode: settings.karaoke, lines: 7 }) {
  const box = h('div', { class: 'mp-lyrics mp-lyrics-' + c.mode, dataset: { mp: 'lyrics', lines: String(c.lines || 7) } });
  fillLyrics(app, box);
  return box;
}

function fillLyrics(app, box) {
  box.textContent = '';
  const L = lyricsOf(app);
  if (!L || !L.lrc || !L.lrc.lines.length) {
    box.append(h('p', { class: 'mp-muted' }, t('mp.lyrics.none')), h('button', { type: 'button', class: 'ed-btn', onclick: () => { const c = app.engine.state.current; if (c) app.edit(c.work); } }, t('mp.lyrics.add')));
    return;
  }
  for (const [i, line] of L.lrc.lines.entries()) {
    const p = h('p', { class: 'mp-lline', dataset: { i: String(i) } });
    if (line.words && line.words.length) for (const [j, wd] of line.words.entries()) p.append(h('span', { class: 'mp-lw', dataset: { j: String(j) } }, wd.text));
    else p.textContent = line.text || ' ';
    if (line.time != null) p.addEventListener('click', () => app.engine.seek(line.time));
    box.append(p);
  }
}

function updateLyrics(app, box, pos) {
  const L = lyricsOf(app);
  if (!L || !L.lrc || !L.lrc.synced) return;
  const i = lineAt(L.lrc, pos);
  if (box._i !== i) {
    box._i = i;
    for (const p of box.querySelectorAll('.mp-lline')) p.classList.toggle('mp-on', Number(p.dataset.i) === i);
    const on = box.querySelector('.mp-lline.mp-on');
    if (on && box.classList.contains('mp-lyrics-karaoke')) on.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const line = L.lrc.lines[i];
  if (line && line.words) {
    const j = wordAt(line, pos);
    const p = box.querySelector(`.mp-lline[data-i="${i}"]`);
    if (p) for (const s of p.querySelectorAll('.mp-lw')) s.classList.toggle('mp-sung', Number(s.dataset.j) <= j);
  }
}

// --- queue ---------------------------------------------------------------------------------------------------------------

function queuePanel(app, limit = 50) {
  const box = h('div', { class: 'mp-queue', dataset: { mp: 'queue' } });
  fillQueue(app, box, limit);
  return box;
}

function fillQueue(app, box, limit = 200) {
  box.textContent = '';
  const q = app.engine.state.queue;
  const db = app.db;
  const rows = q.order.map((itemIndex, p) => {
    const it = q.items[itemIndex];
    const w = db.get(it.ref);
    if (!w) return null;
    const row = h('div', { class: 'mp-qrow' + (p === q.pos ? ' mp-on' : p < q.pos ? ' mp-past' : ''), tabindex: '0', draggable: 'true', dataset: { focus: '1' } }, coverEl(db, w, { size: 64, cls: 'mp-qcover' }), h('div', { class: 'mp-row-main' }, h('div', { class: 'mp-row-t' }, facts(db, w).title), h('div', { class: 'mp-row-s' }, subtitleOf(db, w))),
      iconBtn('close', t('mp.remove'), (e) => { e.stopPropagation(); app.engine.removeAt(itemIndex); }));
    row.addEventListener('click', () => app.engine.jump(itemIndex));
    row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/x-mp-q', String(p)));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/x-mp-q')); if (Number.isFinite(from)) app.engine.move(from, p); });
    return row;
  }).filter(Boolean).slice(Math.max(0, q.pos - 3), Math.max(0, q.pos - 3) + limit);
  box.append(h('div', { class: 'mp-qhead' }, h('b', {}, t('mp.queue') + ` (${q.order.length})`), h('button', { type: 'button', class: 'ed-btn', onclick: () => app.engine.clearUpcoming() }, t('mp.queue.clear'))), ...rows);
  if (!rows.length) box.append(h('p', { class: 'mp-muted' }, t('mp.queue.empty')));
}

// --- bar --------------------------------------------------------------------------------------------------------------

export function renderBar(app, bar) {
  live.bar = bar;
  bar.textContent = '';
  const s = app.engine ? app.engine.state : null;
  const w = s && s.current && s.current.work;
  const info = h('div', { class: 'mp-bar-info', role: 'button', tabindex: '0', onclick: () => app.openNowPlaying(), dataset: { focus: '1' } },
    w ? coverEl(app.db, w, { size: 96, cls: 'mp-bar-cover' }) : h('div', { class: 'mp-bar-cover mp-cover-empty', html: icon('music') }),
    h('div', { class: 'mp-bar-text' }, h('div', { class: 'mp-bar-t', dataset: { mp: 'title' } }, w ? facts(app.db, w).title : t('mp.nothing')), h('div', { class: 'mp-bar-s', dataset: { mp: 'artist' } }, w ? subtitleOf(app.db, w) : '')));
  const ctrls = h('div', { class: 'mp-bar-ctrls' },
    control(app, { type: 'shuffle', size: 's' }, {}), control(app, { type: 'previous', size: 'm' }, {}), control(app, { type: 'play', size: 'l', style: 'filled' }, {}), control(app, { type: 'next', size: 'm' }, {}), control(app, { type: 'repeat', size: 's' }, {}));
  const seek = seekBar(app, 'line', 'sides');
  const tools = h('div', { class: 'mp-bar-tools' }, control(app, { type: 'skip-marker' }, {}), control(app, { type: 'lyrics', size: 's' }, {}), control(app, { type: 'queue', size: 's' }, {}), control(app, { type: 'volume', style: 'slider' }, {}), control(app, { type: 'mini', size: 's' }, {}), ctlButton(app, 'up', t('mp.nowPlaying'), () => app.openNowPlaying(), 's'));
  bar.append(h('div', { class: 'mp-bar-progress' }, h('i', { dataset: { mp: 'fill' } })), info, h('div', { class: 'mp-bar-center' }, ctrls, seek), tools);
}

// --- now playing ---------------------------------------------------------------------------------------------------------

export function renderNowPlaying(app, np) {
  live.np = np;
  let panel = null;
  const open = (p) => { panel = p || panel; np.classList.add('mp-open'); np.setAttribute('aria-hidden', 'false'); draw(); document.body.classList.add('mp-np-on'); };
  const close = () => { np.classList.remove('mp-open'); np.setAttribute('aria-hidden', 'true'); document.body.classList.remove('mp-np-on'); placeVideo(app); };
  np._open = open;
  np._close = close;
  np._redraw = () => { if (np.classList.contains('mp-open')) draw(); };
  function draw() {
    np.textContent = '';
    const s = app.engine.state;
    const video = !!(s.current && s.current.video);
    const L = layoutFor(app, video);
    const head = h('div', { class: 'mp-np-head' }, iconBtn('chevDown', t('mp.close'), close), h('b', {}, t('mp.nowPlaying')), h('span', { class: 'ed-spacer' }),
      iconBtn('palette', t('mp.st.layouts'), () => { close(); app.nav('studio/layouts'); }), s.current ? iconBtn('more', t('mp.more'), (e) => app.workMenu(s.current.work, e.currentTarget)) : null);
    const body = h('div', { class: 'mp-np-body' + (video ? ' mp-np-video' : '') });
    if (video) body.append(h('div', { class: 'mp-np-videoslot', dataset: { mp: 'videoslot' } }));
    body.append(renderLayout(app, L));
    const tabsList = [];
    if (L.panels.lyrics === 'tab' || panel === 'lyrics') tabsList.push(['lyrics', t('mp.lyrics')]);
    if (L.panels.queue === 'tab' || panel === 'queue') tabsList.push(['queue', t('mp.queue')]);
    const side = [];
    if (L.panels.lyrics === 'side' || L.panels.lyrics === 'below') side.push(lyricsPanel(app));
    if (L.panels.queue === 'side') side.push(queuePanel(app));
    const panelBox = h('div', { class: 'mp-np-panel' });
    if (panel && tabsList.some(([k]) => k === panel)) panelBox.append(panel === 'lyrics' ? lyricsPanel(app) : queuePanel(app));
    const tabsBar = tabsList.length ? h('div', { class: 'mp-np-tabs' }, tabsList.map(([k, l]) => h('button', { type: 'button', class: 'mp-tab' + (panel === k ? ' mp-on' : ''), onclick: () => { panel = panel === k ? null : k; draw(); } }, l))) : null;
    np.append(head, h('div', { class: 'mp-np-main' + (side.length ? ' mp-with-side' : '') }, body, side.length ? h('div', { class: 'mp-np-side' }, ...side) : null), tabsBar, panelBox);
    gestures(app, body, L, close);
    placeVideo(app);
    updatePlayerUI(app, app.engine.state);
    if (np.querySelector('[data-mp="viz"]')) startViz(app);
  }
}

function gestures(app, el, L, close) {
  let x0 = 0, y0 = 0, t0 = 0, lastTap = 0, timer = null;
  const act = (a) => {
    const m = { next: () => app.engine.next(), previous: () => app.engine.prev(), 'play-pause': () => app.engine.toggle(), 'seek-back': () => app.engine.seekBy(-settings.seekBack), 'seek-forward': () => app.engine.seekBy(settings.seekForward), queue: () => app.openNowPlaying('queue'), lyrics: () => app.openNowPlaying('lyrics'), close, like: () => app.command('like'), mini: () => app.openMini(), theatre: () => app.setView('theatre') };
    if (m[a]) m[a]();
  };
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('button, input')) return; x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); clearTimeout(timer); timer = setTimeout(() => act(L.gestures.longPress), 650); });
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 12) clearTimeout(timer); });
  el.addEventListener('pointerup', (e) => {
    clearTimeout(timer);
    if (e.target.closest('button, input') || !t0) return;
    const dx = e.clientX - x0, dy = e.clientY - y0, dt = Date.now() - t0;
    t0 = 0;
    // Swipe classification: fast (< 600 ms), long enough (60 / 70 px) and dominant on one axis by 1.5x, so a diagonal
    // scroll attempt does not skip a track. A tap is movement < 10 px; two taps within 300 ms form a double tap, split
    // into thirds (left / centre / right) like video apps' seek gestures.
    if (dt < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { act(dx < 0 ? L.gestures.swipeLeft : L.gestures.swipeRight); return; }
    if (dt < 600 && Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.5) { act(dy < 0 ? L.gestures.swipeUp : L.gestures.swipeDown); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = Date.now();
      if (now - lastTap < 300) { const r = el.getBoundingClientRect(); const side = e.clientX < r.left + r.width / 3 ? 'doubleTapLeft' : e.clientX > r.right - r.width / 3 ? 'doubleTapRight' : 'doubleTap'; act(L.gestures[side]); lastTap = 0; } else lastTap = now;
    }
  });
}

// --- visualizer ----------------------------------------------------------------------------------------------------------

let vizRaf = 0;
// One rAF loop for every visualizer canvas; it stops itself when no canvas is left (the sheet closed), so a hidden
// visualizer costs nothing. Typed arrays are allocated once outside the loop: no garbage per frame.
function startViz(app) {
  cancelAnimationFrame(vizRaf);
  const an = app.engine.analyser();
  const data = an ? new Uint8Array(an.frequencyBinCount) : null;
  const wave = an ? new Uint8Array(an.fftSize) : null;
  const loop = () => {
    const canvases = document.querySelectorAll('[data-mp="viz"]');
    if (!canvases.length) return;
    for (const cv of canvases) {
      const g = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      g.clearRect(0, 0, W, H);
      const accent = getComputedStyle(cv).getPropertyValue('--mp-accent') || '#888';
      g.fillStyle = accent; g.strokeStyle = accent; g.lineWidth = 2;
      if (!an || !app.engine.state.playing) { g.globalAlpha = 0.25; g.fillRect(0, H - 2, W, 2); g.globalAlpha = 1; continue; }
      if (cv.dataset.vstyle === 'wave') {
        an.getByteTimeDomainData(wave);
        g.beginPath();
        for (let i = 0; i < wave.length; i += 4) { const x = (i / wave.length) * W, y = (wave[i] / 255) * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      } else if (cv.dataset.vstyle === 'circle') {
        an.getByteFrequencyData(data);
        const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.25;
        g.beginPath();
        for (let i = 0; i < 96; i++) { const v = data[i * 2] / 255; const a = (i / 96) * Math.PI * 2; const rr = r + v * r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        g.closePath(); g.globalAlpha = 0.7; g.fill(); g.globalAlpha = 1;
      } else {
        an.getByteFrequencyData(data);
        const n = 48, bw = W / n;
        // FFT bins are linear in frequency but hearing is logarithmic: the power-1.7 index mapping gives low frequencies more
        // bars; the top 30% of bins (above ~15 kHz) are dropped as visually empty.
        for (let i = 0; i < n; i++) { const v = data[Math.floor(Math.pow(i / n, 1.7) * data.length * 0.7)] / 255; g.fillRect(i * bw + 1, H - v * H, bw - 2, v * H); }
      }
    }
    vizRaf = requestAnimationFrame(loop);
  };
  vizRaf = requestAnimationFrame(loop);
}

// --- video stage ----------------------------------------------------------------------------------------------------------

export function renderVideoStage(app, stage) {
  live.stage = stage;
  stage.textContent = '';
  stage.append(h('div', { class: 'mp-stage-ctl' }, iconBtn('fullscreen', t('mp.fullscreen'), () => app.openNowPlaying()), iconBtn('close', t('mp.stop'), () => app.engine.stop())),
    h('div', { class: 'mp-next-count', hidden: true, dataset: { mp: 'countdown' } }));
  stage.addEventListener('click', (e) => { if (!e.target.closest('button')) app.openNowPlaying(); });
}

// The engine owns one <video> element; it is moved (not cloned) between the sheet's slot and the floating stage.
// Moving keeps playback, buffer and the WebAudio connection; a second element would restart the stream.
function placeVideo(app) {
  const el = app.engine.element();
  const s = app.engine.state;
  const video = !!(s.current && s.current.video);
  const slot = document.querySelector('.mp-np.mp-open [data-mp="videoslot"]');
  const stage = live.stage;
  if (!stage) return;
  if (video && slot) { if (el.parentElement !== slot) slot.append(el); stage.classList.remove('mp-show'); }
  else if (video) { if (el.parentElement !== stage) stage.prepend(el); stage.classList.add('mp-show'); }
  else { stage.classList.remove('mp-show'); if (el.parentElement) el.remove(); }
  el.controls = false;
}

// <track> accepts only WebVTT, so SRT / ASS are parsed and re-serialised to VTT and served from a blob: URL.
// KNOWN DEFECT: the blob URLs are never revoked when tracks are replaced, so each item played leaks its subtitle text
// until the page closes. Fix: remember the URLs on the element and URL.revokeObjectURL them in the removal loop.
async function attachSubtitles(app, media, el) {
  for (const tr of [...el.querySelectorAll('track')]) tr.remove();
  for (const [i, s] of (media.subs || []).entries()) {
    if (!s.loc) continue;
    try {
      const url = await locURL(s.loc);
      if (!url) continue;
      const text = await (await readLoc(s.loc, url)).text();
      const parsed = parseSubs(text, s.format ? 'x.' + s.format : 'x.srt');
      const vtt = toVtt(parsed.cues);
      el.append(h('track', { kind: 'subtitles', label: s.title || s.lang || t('mp.subs.track', { n: i + 1 }), srclang: s.lang || 'und', src: URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })), default: i === 0 && !!settings.prefLang && s.lang === settings.prefLang }));
    } catch { /* unreadable subtitle file */ }
  }
}

// --- analysis (loudness, tempo, energy, waveform) --------------------------------------------------------------------------

// "Honest" analysis: computed from the actual decoded samples, not guessed from tags. Limits: same-origin only
// (bytes must be readable), files <= 80 MB (decodeAudioData holds the whole PCM in memory, ~10x the compressed
// size), loudness over at most 120 s. Started 1.5 s after the item starts so decoding does not compete with the
// start of playback. Results go into an 'analysis' batch, which views ignore (no re-render).
async function analyseCurrent(app, media, work) {
  if (!settings.analyze || !media || live.analysing.has(media.id) || app.engine.state.current.crossOrigin) return;
  if (media.loudness != null && live.waves.has(media.id)) return;
  if (media.size && media.size > 80 * 1024 * 1024) return;
  live.analysing.add(media.id);
  try {
    const url = await locURL(media.loc);
    if (!url) return;
    const buf = await (await readLoc(media.loc, url)).arrayBuffer();
    if (buf.byteLength > 80 * 1024 * 1024) return;
    // An OfflineAudioContext is used only for decodeAudioData: unlike AudioContext it needs no user gesture and opens
    // no audio device.
    const ac = new OfflineAudioContext(1, 44100, 44100);
    const audio = await ac.decodeAudioData(buf);
    const chans = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, i) => audio.getChannelData(i));
    const seg = media.segment;
    const cut = (c) => (seg ? c.subarray(Math.floor((seg.start || 0) * audio.sampleRate), seg.end ? Math.floor(seg.end * audio.sampleRate) : c.length) : c);
    const parts = chans.map(cut);
    live.waves.set(media.id, waveform(parts[0], 300).peaks);
    drawWave(app);
    if (media.loudness == null) {
      await new Promise((r) => setTimeout(r, 50));
      const a = analyze(parts, audio.sampleRate, { maxSeconds: 120 });
      const m = app.db.get(media.id);
      if (!m) return;
      app.db.batch(() => {
        app.db.patch(media.id, { loudness: a.lufs ?? undefined, peak: a.peak ?? undefined, bpm: m.bpm || (a.tempoConfidence > 0.2 ? a.bpm : undefined), ext: { ...(m.ext || {}), analysis: { lra: a.lra, tempoConfidence: a.tempoConfidence, centroid: a.centroid, energy: a.energy, at: Date.now() } } });
        const w = app.db.get(work.id);
        if (w && w.energy == null && !(w.locked || []).includes('energy')) app.db.patch(w.id, { energy: a.energy });
      }, { label: 'analysis' });
      app.engine.setLevel();
    }
  } catch { /* undecodable here */ } finally { live.analysing.delete(media.id); }
}

function drawWave(app) {
  const s = app.engine.state;
  const m = s.current && s.current.media;
  const peaks = m && live.waves.get(m.id);
  for (const cv of document.querySelectorAll('[data-mp="wave"]')) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (!peaks) continue;
    const frac = s.duration ? s.position / s.duration : 0;
    const css = getComputedStyle(cv);
    const n = peaks.length, bw = cv.width / n;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.04, peaks[i]);
      g.fillStyle = i / n <= frac ? css.getPropertyValue('--mp-accent') : css.getPropertyValue('--mp-muted');
      g.globalAlpha = i / n <= frac ? 1 : 0.45;
      g.fillRect(i * bw, (cv.height * (1 - v)) / 2, Math.max(1, bw - 1), cv.height * v);
    }
    g.globalAlpha = 1;
  }
}

// --- updates ------------------------------------------------------------------------------------------------------------

const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };

// Called on every engine state (5 Hz). Item change triggers the expensive work once (rebuild bar, subtitles, video
// placement, analysis, document title); everything below is cheap per-tick updates. The seek range is skipped while
// the user drags it, and the volume range while focused, or the tick would yank the thumb from under the finger.
export function updatePlayerUI(app, s) {
  const w = s.current && s.current.work;
  if ((w ? w.id : null) !== live.workId) {
    live.workId = w ? w.id : null;
    live.lrc = null;
    if (live.bar) renderBar(app, live.bar);
    if (live.np && live.np._redraw) live.np._redraw();
    if (s.current && s.current.video && s.current.media) attachSubtitles(app, s.current.media, app.engine.element());
    placeVideo(app);
    if (w && s.current.media && !s.current.video) setTimeout(() => analyseCurrent(app, s.current.media, w), 1500);
    document.title = w ? `${facts(app.db, w).title} · ${t('app.name')}` : t('app.name');
  }
  const frac = s.duration ? Math.min(1, s.position / s.duration) : 0;
  for (const r of document.querySelectorAll('[data-mp="seek"]')) if (!r._dragging || !r._dragging()) r.value = String(Math.round(frac * 1000));
  for (const f of document.querySelectorAll('[data-mp="fill"]')) f.style.width = (frac * 100).toFixed(2) + '%';
  for (const b of document.querySelectorAll('[data-mp="buf"]')) b.style.width = (s.duration ? Math.min(100, (s.buffered / s.duration) * 100) : 0).toFixed(1) + '%';
  for (const r of document.querySelectorAll('[data-mp="ring"]')) r.style.strokeDashoffset = String(1000 - frac * 1000);
  for (const c of document.querySelectorAll('[data-mp="cur"]')) setText(c, fmtTime(s.position));
  for (const c of document.querySelectorAll('[data-mp="tot"]')) setText(c, fmtTime(s.duration));
  for (const c of document.querySelectorAll('[data-mp="left"]')) setText(c, '-' + fmtTime(Math.max(0, s.duration - s.position)));
  for (const b of document.querySelectorAll('[data-mp="play"]')) { const want = s.playing ? 'pause' : 'play'; if (b.dataset.icon !== want) { b.dataset.icon = want; b.innerHTML = icon(want); b.setAttribute('aria-label', s.playing ? t('mp.pause') : t('mp.play')); } }
  for (const b of document.querySelectorAll('[data-mp="shuffle"]')) b.classList.toggle('mp-active', s.shuffle !== 'off');
  for (const b of document.querySelectorAll('[data-mp="repeat"]')) { b.classList.toggle('mp-active', s.repeat !== 'off'); const want = s.repeat === 'one' ? 'repeatOne' : 'repeat'; if (b.dataset.icon !== want) { b.dataset.icon = want; b.innerHTML = icon(want); } }
  for (const b of document.querySelectorAll('[data-mp="sleep"]')) b.classList.toggle('mp-active', !!s.sleep);
  for (const b of document.querySelectorAll('[data-mp="ab"]')) b.classList.toggle('mp-active', !!s.ab);
  for (const b of document.querySelectorAll('[data-mp="mute"]')) { const want = s.muted ? 'mute' : 'volume'; if (b.dataset.icon !== want) { b.dataset.icon = want; b.innerHTML = icon(want); } }
  for (const v of document.querySelectorAll('[data-mp="vol"]')) if (document.activeElement !== v) v.value = String(s.volume);
  for (const b of document.querySelectorAll('[data-mp="speed"]')) b.dataset.label = s.speed !== 1 ? s.speed + '×' : '';
  for (const c of document.querySelectorAll('[data-mp="coverbox"]')) c.classList.toggle('mp-playing', s.playing);
  const marker = s.current && s.current.marker;
  for (const b of document.querySelectorAll('[data-mp="skipmarker"]')) { b.hidden = !marker; if (marker) setText(b.querySelector('span'), t('mp.skip.' + marker.kind)); }
  if (s.current && s.current.chapter >= 0) { const ch = s.current.chapters[s.current.chapter]; for (const c of document.querySelectorAll('[data-mp="chapter"]')) setText(c, ch ? ch.title || t('mp.chapterN', { n: s.current.chapter + 1 }) : ''); }
  const nx = s.queue && s.queue.order[s.queue.pos + 1] != null ? app.db.get(s.queue.items[s.queue.order[s.queue.pos + 1]].ref) : null;
  for (const c of document.querySelectorAll('[data-mp="nextup"]')) setText(c, nx ? t('mp.upNext', { title: facts(app.db, nx).title }) : '');
  for (const box of document.querySelectorAll('[data-mp="lyrics"]')) updateLyrics(app, box, s.position);
  for (const box of document.querySelectorAll('[data-mp="queue"]')) if (box._pos !== s.queue.pos || box._len !== s.queue.order.length) { box._pos = s.queue.pos; box._len = s.queue.order.length; fillQueue(app, box); }
  if (document.querySelector('[data-mp="wave"]')) drawWave(app);
  const cd = document.querySelector('[data-mp="countdown"]');
  if (cd) {
    const video = s.current && s.current.video;
    const nc = video && nx && settings.autoNext ? nextCountdown({ position: s.position, duration: s.duration, markers: s.current.work.markers, seconds: 10 }) : { show: false };
    cd.hidden = !nc.show;
    // _fired latches the auto-advance so a tick arriving before the next item has loaded cannot call next() twice.
    if (nc.show) { setText(cd, t('mp.nextIn', { title: facts(app.db, nx).title, s: nc.left })); if (nc.left <= 0 && !cd._fired) { cd._fired = true; app.engine.next(); } }
    else cd._fired = false;
  }
}

// --- mini player ----------------------------------------------------------------------------------------------------

// The mini player holds no engine: it renders the state the main page broadcasts and sends commands back, so audio
// never plays twice. 'hello' asks the main page for an immediate state instead of waiting for the next tick.
export function renderMini(app, root, channel) {
  root.dataset.view = 'mini';
  root.textContent = '';
  const cover = h('img', { class: 'mp-mini-cover', alt: '' });
  const title = h('div', { class: 'mp-mini-t' }, t('mp.mini.waiting'));
  const artist = h('div', { class: 'mp-mini-s' });
  const fill = h('i');
  const play = h('button', { type: 'button', class: 'mp-cbtn mp-cbtn-l mp-play mp-play-filled', html: icon('play'), 'aria-label': t('mp.play'), onclick: () => send('play-pause') });
  const send = (cmd, value) => { if (channel) channel.postMessage({ type: 'cmd', cmd, value }); };
  const bar = h('div', { class: 'mp-mini-prog', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); if (last.duration) send('seek', ((e.clientX - r.left) / r.width) * last.duration); } }, fill);
  let last = {};
  root.append(h('div', { class: 'mp-mini' }, cover, h('div', { class: 'mp-mini-body' }, title, artist, bar),
    h('div', { class: 'mp-mini-ctrls' }, h('button', { type: 'button', class: 'mp-cbtn mp-cbtn-m', html: icon('prev'), 'aria-label': t('mp.previous'), onclick: () => send('previous') }), play, h('button', { type: 'button', class: 'mp-cbtn mp-cbtn-m', html: icon('next'), 'aria-label': t('mp.next'), onclick: () => send('next') }),
      h('button', { type: 'button', class: 'mp-cbtn mp-cbtn-s', html: icon('up'), 'aria-label': t('mp.showWindow'), onclick: () => (bridge ? bridge.window.showMain() : window.opener && window.opener.focus()) }))));
  if (!channel) { title.textContent = t('mp.mini.noChannel'); return; }
  channel.onmessage = (m) => {
    const d = m.data || {};
    if (d.type !== 'state') return;
    last = d;
    title.textContent = d.title || t('mp.nothing');
    artist.textContent = d.artist || '';
    fill.style.width = (d.duration ? (d.position / d.duration) * 100 : 0) + '%';
    play.innerHTML = icon(d.playing ? 'pause' : 'play');
    if (d.cover && cover.src !== d.cover) cover.src = d.cover;
  };
  channel.postMessage({ type: 'hello' });
  document.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); send('play-pause'); } });
  if (bridge) document.body.classList.add('mp-draggable');
  saveSettings();
}
