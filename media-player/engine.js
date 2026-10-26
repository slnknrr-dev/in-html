// media-player/engine.js - the playback engine of the page: two media elements (A / B) so the next item is preloaded
// for gapless playback or faded in for a crossfade, a WebAudio chain (per-element fade gain -> level gain (ReplayGain /
// loudness) -> ten peaking filters (EQ) -> volume -> analyser) for same-origin media, a third element without the
// graph for cross-origin URLs (their audio cannot pass through WebAudio), CUE segments of one file, speed with pitch
// kept, resume positions, scrobbles (catalog/tracking.js), the sleep timer, A-B repeat, skip markers, the Media
// Session (lock screen, media keys) and the play queue of player/queue.js.
//
//   createEngine({ db, resolve(media, work) -> Promise<{ url, crossOrigin }>, pick(workId) -> media | null,
//                  settings, onState(state), onEnded })
//   engine: playWorks(ids, { start, shuffle }), enqueue(ids, mode), toggle(), play(), pause(), stop(), next(), prev(),
//           seek(t), seekBy(dt), setVolume(v), setMuted(b), setSpeed(v), setEq(bands, on), setLevel(), setShuffle(mode),
//           setRepeat(mode), cycleRepeat(), abPoint(), sleep(mode, minutes), skipMarker(), jump(itemIndex),
//           removeAt(i), move(from, to), bookmark(title), element() (the playing element, for the video view),
//           analyser(), state (getter), restore(saved), save() -> JSON

// DESIGN RULES
// - Pure logic lives elsewhere (player/queue.js, gain.js, timers.js are DOM-free and unit-tested); this file only
//   wires it to HTMLMediaElement / WebAudio. Anything testable without a browser belongs in those modules.
// - One source of truth for "what plays": `active` selects the element, `cur` describes the item. Every element
//   event handler first checks `e === el()`, because the idle twin (preloading) and the direct element fire events
//   too; without that guard a preload's `ended` or `error` would skip the real track.
// - Positions exposed to the UI are segment-relative (segPos): a CUE track is a window [start, end) of one file, and
//   the seek bar must show 0..trackLength, not the offset inside the whole image.
// - The graph is created lazily (ensureGraph) on the first user-initiated play: an AudioContext made before a gesture
//   starts 'suspended' under autoplay policies, and createMediaElementSource is irreversible (see below).
import * as Q from '../player/queue.js';
import { levelFactor, EQ_BANDS, EQ_Q, crossfadeGains } from '../player/gain.js';
import { sleepTimer, sleepState, setAbPoint, abState, markerAt, markersFromChapters, resumeDecision, chapterAt } from '../player/timers.js';
import { recordPlay, savePosition } from '../catalog/tracking.js';
import { facts } from '../catalog/facts.js';

export function createEngine({ db, resolve, pick, settings, onState = () => {}, onEnded = () => {}, onError = () => {} }) {
  // <video> even for audio: one element type plays both, so a queue mixing songs and episodes never swaps elements
  // (swapping would detach the WebAudio source). playsinline (property + attribute for older iOS Safari) keeps iOS from
  // forcing fullscreen. preservesPitch: speed changes for audiobooks / podcasts without the "chipmunk" effect.
  const mk = () => { const v = document.createElement('video'); v.preload = 'auto'; v.playsInline = true; v.setAttribute('playsinline', ''); v.className = 'mp-media'; v.preservesPitch = true; return v; };
  const els = [mk(), mk()];
  // Cross-origin media without CORS headers would be muted by createMediaElementSource (the graph outputs silence for
  // opaque responses), so such URLs play on this third element that is never connected to the graph: no EQ, level or
  // visualizer, but audible. Hence `active = -1` and the guard `!cross` before every graph-only feature.
  const direct = mk();
  let ctx = null, chain = null;
  const nodes = new Map(); // element -> { src, fade }
  let active = 0;          // index into els, or -1 for the direct element
  let queue = Q.createQueue([], { seed: String(Date.now()) });
  let cur = null;          // { work, media, url, crossOrigin, segment, chapters, markers, listened, startedAt }
  let preloaded = null;    // { key, el, url, media }
  let ab = null, sleepT = null, lastTick = 0, saveTick = 0, crossing = false;
  let volume = settings.volume ?? 1, muted = false, speed = 1;
  const state = { playing: false, position: 0, duration: 0, buffered: 0, error: null, loading: false };

  const el = () => (active < 0 ? direct : els[active]);
  const other = () => els[active === 0 ? 1 : 0];

  // Graph: element -> MediaElementSource -> fade (per element, for crossfades) -> level -> EQ x10 -> vol -> analyser ->
  // destination. Volume is applied in the graph, not on element.volume, so the analyser sees the post-volume signal and
  // the level gain can exceed 1 (element.volume is clamped to [0, 1]). createMediaElementSource can be called once per
  // element for its whole life and reroutes its output exclusively into the graph: that is why sources are made once
  // here for both A / B, and why `direct` is never passed to it. On failure everything falls back to element.volume.
  function ensureGraph() {
    if (ctx || typeof AudioContext === 'undefined') return;
    try {
      ctx = new AudioContext();
      const level = ctx.createGain();
      // Shelves at the ends, peaking in between: a peaking filter at the lowest / highest band would leave everything
      // below / above it untouched, which is not what a "bass" / "treble" slider means.
      const eq = EQ_BANDS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = EQ_Q; b.gain.value = 0; return b; });
      const vol = ctx.createGain();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      level.connect(eq[0]);
      for (let i = 0; i < eq.length - 1; i++) eq[i].connect(eq[i + 1]);
      eq[eq.length - 1].connect(vol);
      vol.connect(an);
      an.connect(ctx.destination);
      chain = { level, eq, vol, an };
      for (const e of els) {
        const src = ctx.createMediaElementSource(e);
        const fade = ctx.createGain();
        src.connect(fade);
        fade.connect(level);
        nodes.set(e, { src, fade });
      }
      applyEq();
      applyVolume();
    } catch (e) { console.warn('WebAudio unavailable', e); ctx = null; chain = null; }
  }

  function applyVolume() {
    const v = muted ? 0 : volume;
    if (chain) { chain.vol.gain.value = v; for (const e of els) e.volume = 1; } else for (const e of els) e.volume = v;
    direct.volume = v;
  }
  function applyEq() {
    if (!chain) return;
    const on = settings.eqOn;
    chain.eq.forEach((b, i) => { b.gain.value = on ? Number(settings.eq[i]) || 0 : 0; });
  }
  function applyLevel() {
    if (!chain || !cur) return;
    const f = levelFactor(cur.media, { level: settings.level, preamp: settings.preamp, target: settings.target });
    // setTargetAtTime (exponential approach, tau 50 ms) instead of assigning .value: an instant gain jump between tracks is
    // an audible click. Capped at 4 (+12 dB): a quiet track with a wrong loudness tag must not blast the speakers.
    chain.level.gain.setTargetAtTime(Math.min(4, f), ctx.currentTime, 0.05);
  }

  const emit = () => onState(api.state);
  // Family decides per-kind settings (speed, resume): people listen to books at 1.5x but music at 1x.
  const familyOf = (w) => { const d = facts(db, w).domain; return d === 'music' || d === 'musicvideo' ? 'music' : d === 'audiobook' ? 'audiobook' : d === 'podcast' ? 'podcast' : 'video'; };

  function finishCurrent(completedHint) {
    if (!cur) return;
    const e = el();
    const pos = segPos(e.currentTime);
    const dur = cur.duration || state.duration;
    // "listened" counts real playing seconds (tick), not position: seeking to the end must not count as a full play.
    // Under 2 s is a skip, not a play, so it does not reach play counts or scrobbles.
    if (cur.listened > 2 || completedHint) {
      try { recordPlay(db, { media: cur.media && cur.media.id, work: cur.work.id, listened: cur.listened, position: completedHint ? dur : pos, duration: dur, completed: completedHint || undefined, threshold: settings.watched }); } catch (err) { console.error(err); }
    }
    cur.listened = 0;
  }

  // Resume positions are saved in their own batches (label 'position'), which the views ignore.
  const keepPosition = () => { if (cur && cur.media && db.get(cur.media.id)) db.batch(() => savePosition(db, cur.media.id, state.position, state.duration), { label: 'position' }); };

  const segPos = (t) => (cur && cur.segment ? Math.max(0, t - (cur.segment.start || 0)) : t);

  // load(): resolve a URL for the chosen presence, pick an element (the preloaded twin when it matches), restore the
  // position, autoplay. A work without a playable presence still becomes `cur` (url null) so the UI shows what failed;
  // 'nominal' = no file at all, 'unavailable' = a file that could not be resolved (offline mount, revoked permission).
  async function load(workId, { autoplay = true, startAt = null } = {}) {
    const work = db.get(workId);
    if (!work) return false;
    const media = pick(workId);
    state.error = null;
    state.loading = true;
    emit();
    let target;
    try { target = media ? await resolve(media, work) : null; } catch (err) { target = null; }
    if (!target || !target.url) {
      state.loading = false;
      state.error = media ? 'unavailable' : 'nominal';
      cur = { work, media, url: null, listened: 0 };
      emit();
      onError(state.error, work);
      // The delay lets the error toast be read; the re-check (same work, still failing) cancels the skip if the user
      // already moved on during those 1.5 s.
      if (settings.skipOnError && queue.order.length > 1) setTimeout(() => { if (cur && cur.work.id === workId && state.error) next({ auto: true }); }, 1500);
      return false;
    }
    const cross = !!target.crossOrigin;
    if (!cross) ensureGraph();
    let e;
    // The key includes the URL, not only the work: a blob: or token URL can change between preload and load.
    if (preloaded && preloaded.key === workId + ':' + target.url && !cross) {
      active = els.indexOf(preloaded.el);
      e = preloaded.el;
    } else {
      active = cross ? -1 : (active < 0 ? 0 : active);
      e = el();
      if (e.src !== target.url) { e.src = target.url; }
    }
    preloaded = null;
    // KNOWN DEFECT: crossfadeTo() calls load() for the incoming item while the outgoing element must keep playing for
    // `d` seconds, but this loop pauses it at once, so the "crossfade" is only a fade-in; and the next line assigns
    // fade.gain.value on a param that has a value curve running, which the Web Audio spec makes throw NotSupportedError
    // (load() rejects, the .then in crossfadeTo never runs, `crossing` stays true and blocks later crossfades).
    // Fix: skip this pause and the gain reset when called from crossfadeTo (an option such as { crossfade: true }).
    for (const x of [...els, direct]) if (x !== e && !x.paused) x.pause();
    if (nodes.get(e)) nodes.get(e).fade.gain.value = 1;
    const segment = media && media.segment ? media.segment : null;
    const chapters = (media && media.chapters) || [];
    cur = { work, media, url: target.url, crossOrigin: cross, segment, chapters, markers: work.markers || (media && media.markers) || markersFromChapters(chapters, media && media.duration), listened: 0, duration: segment && segment.end ? segment.end - segment.start : media && media.duration || 0 };
    e.playbackRate = speed = settings.speeds[familyOf(work)] || 1;
    e.preservesPitch = true;
    applyLevel();
    let at = startAt;
    if (at == null && settings.resume && media && media.position) {
      const d = resumeDecision({ position: media.position, duration: cur.duration, family: familyOf(work) });
      if (d.resume) at = d.at;
    }
    const seekTo = (segment ? segment.start || 0 : 0) + (at || 0);
    if (seekTo > 0) {
      const set = () => { try { e.currentTime = seekTo; } catch { /* not seekable yet */ } };
      // readyState >= HAVE_METADATA: before it, setting currentTime throws or is silently dropped by some browsers.
      if (e.readyState >= 1) set(); else e.addEventListener('loadedmetadata', set, { once: true });
    // Note: `preloaded` was cleared above, so `!preloaded` is always true here; a reused element is always rewound.
    } else if (e.currentTime > 0.5 && !preloaded) { try { e.currentTime = 0; } catch { /* ignore */ } }
    state.loading = false;
    updateMediaSession();
    if (autoplay) await playEl(e);
    emit();
    return true;
  }

  // play() returns a promise that rejects with NotAllowedError without a user gesture (autoplay policy) -> 'blocked',
  // and with AbortError when a new src / pause interrupts it, which is normal flow and must not show an error.
  async function playEl(e) {
    if (ctx && ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* gesture needed */ } }
    try { await e.play(); state.playing = true; } catch (err) { if (err && err.name !== 'AbortError') { state.playing = false; state.error = 'blocked'; } }
    emit();
  }

  // Preload only for plain files on the graph: a CUE segment shares the current file (seeking is enough), and a
  // cross-origin item would need `direct`, which has no twin. o.load() starts buffering without playing.
  async function preloadNext() {
    if (!settings.gapless && !settings.crossfade) return;
    const n = Q.upcoming(queue, 1)[0];
    if (!n || cur && cur.crossOrigin) return;
    const media = pick(n.ref);
    const work = db.get(n.ref);
    if (!media || !work || media.segment) return;
    const t = await resolve(media, work).catch(() => null);
    if (!t || !t.url || t.crossOrigin) return;
    const o = other();
    if (o.src !== t.url) { o.src = t.url; o.load(); }
    preloaded = { key: n.ref + ':' + t.url, el: o, url: t.url, media };
  }

  async function next({ auto = false } = {}) {
    finishCurrent(auto && !state.error);
    const q = Q.next(queue, { auto });
    if (!q) { state.playing = false; el().pause(); emit(); onEnded(); if (sleepT && sleepT.mode === 'queue') sleepT = null; return; }
    queue = q;
    await load(Q.currentRef(queue));
  }

  async function prev() {
    // Conventional "previous": after 4 s it restarts the current item, before that it goes back in the queue.
    if (segPos(el().currentTime) > 4) { seek(0); return; }
    finishCurrent(false);
    queue = Q.prev(queue);
    await load(Q.currentRef(queue));
  }

  function seek(t) {
    const e = el();
    const base = cur && cur.segment ? cur.segment.start || 0 : 0;
    try { e.currentTime = base + Math.max(0, Math.min(t, (cur && cur.duration) || e.duration || t)); } catch { /* not seekable */ }
    state.position = Math.max(0, t);
    emit();
  }

  // The curve (equal-power by default: cos/sin, so out^2 + in^2 = 1 keeps perceived loudness constant; linear would dip
  // by ~3 dB in the middle) is sampled into 32 points and handed to setValueCurveAtTime, which the audio thread
  // interpolates sample-accurately. Driving gains from the 200 ms tick instead would produce audible steps.
  function crossfadeTo() {
    const n = Q.upcoming(queue, 1)[0];
    if (!n || !preloaded || !chain || crossing) return false;
    const from = el(), to = preloaded.el;
    const d = Math.max(1, settings.crossfade);
    const fFrom = nodes.get(from).fade.gain, fTo = nodes.get(to).fade.gain;
    const steps = 32;
    const outC = new Float32Array(steps), inC = new Float32Array(steps);
    for (let i = 0; i < steps; i++) { const g = crossfadeGains(i / (steps - 1), 1); outC[i] = g.out; inC[i] = g.in; }
    crossing = true;
    const t0 = ctx.currentTime;
    fFrom.cancelScheduledValues(t0); fTo.cancelScheduledValues(t0);
    fFrom.setValueCurveAtTime(outC, t0, d); fTo.setValueCurveAtTime(inC, t0, d);
    finishCurrent(true);
    queue = Q.next(queue, { auto: true });
    const oldEl = from;
    load(Q.currentRef(queue)).then(() => { setTimeout(() => { oldEl.pause(); crossing = false; }, d * 1000 + 50); });
    return true;
  }

  // Ticks: position, listened time, segment ends, A-B, sleep, crossfade, preloading, saving the resume position.
  // One 200 ms poll instead of timeupdate handlers: timeupdate fires at 4-66 Hz depending on the browser and not at all
  // on a paused element, while A-B, sleep fades and segment ends need a steady clock. dt is capped at 1 s so a
  // throttled background tab (timers clamped to 1 Hz or slower) does not credit minutes of listening in one tick.
  function tick() {
    const e = el();
    const now = performance.now();
    const dt = lastTick ? (now - lastTick) / 1000 : 0;
    lastTick = now;
    if (!cur) return;
    const playing = !e.paused && !e.ended;
    if (playing) cur.listened += Math.min(dt, 1) * (e.playbackRate || 1);
    state.playing = playing;
    state.position = segPos(e.currentTime);
    state.duration = cur.duration || (Number.isFinite(e.duration) ? e.duration - (cur.segment ? cur.segment.start || 0 : 0) : 0);
    try { state.buffered = e.buffered.length ? segPos(e.buffered.end(e.buffered.length - 1)) : 0; } catch { state.buffered = 0; }
    // A segment has no `ended` event (the file goes on), so its end is detected here; 30 ms early, as a 200 ms poll would
    // otherwise let the first syllable of the next CUE track leak through more often.
    if (cur.segment && cur.segment.end && e.currentTime >= cur.segment.end - 0.03 && playing) { next({ auto: true }); return; }
    const a = abState(ab, state.position);
    if (a.seek != null) seek(a.seek);
    if (sleepT) {
      const s = sleepState(sleepT, { now: Date.now(), fade: 20 });
      if (sleepT.mode === 'minutes') { if (chain) chain.vol.gain.value = (muted ? 0 : volume) * s.volume; else e.volume = volume * s.volume; }
      if (s.expired) { pause(); sleepT = null; applyVolume(); }
    }
    const left = state.duration - state.position;
    // Crossfade only tracks longer than 3x the fade: on a short jingle the fade would eat most of it.
    if (playing && settings.crossfade > 0 && state.duration > settings.crossfade * 3 && left > 0 && left <= settings.crossfade && !crossing && preloaded) crossfadeTo();
    if (playing && left < 25 && !preloaded && state.duration > 0) preloadNext();
    // Resume positions every 5 s, but not for ordinary songs (< 10 min): resuming a song mid-way is unwanted, and writing
    // them would flood the database with batches.
    if (playing && cur.media && now - saveTick > 5000) { saveTick = now; if (familyOf(cur.work) !== 'music' || state.duration > 600) keepPosition(); }
    if (settings.autoSkip && cur.markers) { const m = markerAt(cur.markers, state.position); if (m && (m.kind === 'intro' || m.kind === 'recap')) seek(m.end); }
    // setPositionState throws when position > duration (rounding at the end), hence the min() and the try.
    if ('mediaSession' in navigator && state.duration > 0 && playing) { try { navigator.mediaSession.setPositionState({ duration: state.duration, position: Math.min(state.position, state.duration), playbackRate: e.playbackRate || 1 }); } catch { /* ignore */ } }
    emit();
  }
  setInterval(tick, 200);

  // Handlers on all three elements, each gated by `e === el()` (see DESIGN RULES). `!crossing` on ended: during a
  // crossfade the old element ends on its own and must not advance the queue a second time.
  for (const e of [...els, direct]) {
    e.addEventListener('ended', () => { if (e === el() && !crossing) { if (sleepT && sleepT.mode === 'track') { sleepT = null; finishCurrent(true); state.playing = false; emit(); return; } next({ auto: true }); } });
    e.addEventListener('error', () => { if (e === el() && cur && cur.url) { state.error = 'decode'; emit(); onError('decode', cur.work); if (settings.skipOnError && queue.order.length > 1) setTimeout(() => next({ auto: true }), 1500); } });
    e.addEventListener('play', () => { if (e === el()) { state.playing = true; emit(); } });
    e.addEventListener('pause', () => { if (e === el()) { state.playing = false; if (cur && cur.media && (familyOf(cur.work) !== 'music' || state.duration > 600)) keepPosition(); emit(); } });
    e.addEventListener('loadedmetadata', () => { if (e === el()) emit(); });
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !cur) return;
    const f = facts(db, cur.work);
    const art = api.artwork ? api.artwork(cur.work) : null;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: f.title, artist: (f.artist.length ? f.artist : f.author).join(', ') || f.show || '', album: f.album || f.show || f.book || '', artwork: art ? [{ src: art, sizes: '512x512' }] : [] });
    } catch { /* no MediaMetadata */ }
  }
  // Each setActionHandler in its own try: browsers throw TypeError for actions they do not know (e.g. 'seekto' on older
  // Safari), and one unsupported action must not prevent registering the rest.
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* unsupported */ } };
    set('play', () => play()); set('pause', () => pause()); set('stop', () => stop());
    set('previoustrack', () => prev()); set('nexttrack', () => next());
    set('seekbackward', (d) => seek(state.position - (d.seekOffset || settings.seekBack)));
    set('seekforward', (d) => seek(state.position + (d.seekOffset || settings.seekForward)));
    set('seekto', (d) => seek(d.seekTime));
  }

  const play = () => (cur && cur.url ? playEl(el()) : Q.currentRef(queue) ? load(Q.currentRef(queue)) : Promise.resolve());
  function pause() { el().pause(); state.playing = false; emit(); }
  function stop() { pause(); finishCurrent(false); seek(0); }

  // `state` is a getter that builds a fresh snapshot: consumers can compare or keep it without seeing later mutation.
  const api = {
    artwork: null,
    get state() {
      const c = cur;
      return {
        ...state, queue, current: c ? { work: c.work, media: c.media, crossOrigin: c.crossOrigin, chapters: c.chapters || [], chapter: c.chapters ? chapterAt(c.chapters, state.position) : -1, marker: c.markers ? markerAt(c.markers, state.position) : null, video: !!(c.media && (c.media.kind === 'video' || c.media.video)) } : null,
        volume, muted, speed, ab, sleep: sleepT, shuffle: queue.shuffle, repeat: queue.repeat, eqOn: settings.eqOn, graph: !!chain,
      };
    },
    element: () => el(),
    analyser: () => (chain ? chain.an : null),
    async playWorks(ids, { start = 0, shuffle = null } = {}) {
      if (!ids.length) return;
      finishCurrent(false);
      queue = Q.createQueue(ids, { start, repeat: queue.repeat, seed: String(Date.now()) });
      if (shuffle) queue = Q.setShuffle(queue, shuffle, shuffleOpts());
      ensureGraph();
      await load(Q.currentRef(queue));
    },
    enqueue(ids, mode = 'end') { const empty = !queue.order.length; queue = Q.enqueue(queue, ids, { mode }); if (empty) load(Q.currentRef(queue), { autoplay: false }); preloaded = null; emit(); },
    toggle() { if (state.playing) pause(); else { ensureGraph(); play(); } },
    play() { ensureGraph(); return play(); }, pause, stop, next: () => next(), prev,
    seek, seekBy: (dt) => seek(state.position + dt),
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); settings.volume = volume; applyVolume(); emit(); },
    setMuted(b) { muted = !!b; applyVolume(); emit(); },
    setSpeed(v) { speed = v; el().playbackRate = v; if (cur) settings.speeds[familyOf(cur.work)] = v; emit(); },
    setEq() { applyEq(); emit(); }, setLevel() { applyLevel(); },
    setShuffle(mode) { queue = Q.setShuffle(queue, mode, shuffleOpts()); preloaded = null; emit(); },
    setRepeat(mode) { queue = Q.setRepeat(queue, mode); emit(); },
    cycleRepeat() { queue = Q.setRepeat(queue, Q.cycleRepeat(queue.repeat)); emit(); },
    abPoint() { ab = setAbPoint(ab, state.position); if (ab.a == null) ab = null; emit(); },
    sleep(mode, minutes) { sleepT = mode === 'off' ? null : sleepTimer(mode, { minutes }); if (!sleepT) applyVolume(); emit(); },
    skipMarker() { const m = cur && cur.markers ? markerAt(cur.markers, state.position) : null; if (m) seek(m.end); },
    jump(i) { finishCurrent(false); queue = Q.jump(queue, i); load(Q.currentRef(queue)); },
    removeAt(i) { queue = Q.removeAt(queue, i); preloaded = null; emit(); },
    move(from, to) { queue = Q.move(queue, from, to); preloaded = null; emit(); },
    clearUpcoming() { queue = Q.clearUpcoming(queue); preloaded = null; emit(); },
    bookmark(title) {
      if (!cur || !cur.media) return null;
      const b = { at: Math.round(state.position * 10) / 10, title: title || '', created: Date.now() };
      db.patch(cur.media.id, { bookmarks: [...(db.get(cur.media.id).bookmarks || []), b] });
      return b;
    },
    save() { return { refs: queue.order.map((i) => queue.items[i].ref), pos: queue.pos, repeat: queue.repeat, shuffle: queue.shuffle, position: state.position }; },
    restore(s) {
      if (!s || !Array.isArray(s.refs) || !s.refs.length) return;
      const refs = s.refs.filter((r) => db.has(r));
      if (!refs.length) return;
      queue = Q.createQueue(refs, { start: Math.min(s.pos || 0, refs.length - 1), repeat: s.repeat || 'off' });
      load(Q.currentRef(queue), { autoplay: false, startAt: s.position || 0 });
    },
    current: () => cur,
  };
  // Smart shuffle inputs: keyOf lets queue.js spread the same artist / album apart; weightOf favours rated, favourite
  // and long-unplayed items (up to +3 after 90 days). Declared after `api` but only called later, so no TDZ issue.
  const shuffleOpts = () => ({
    keyOf: (ref) => { const w = db.get(ref); if (!w) return {}; const f = facts(db, w); return { artist: f.artist[0] || f.author[0] || f.show, album: f.album || f.show || f.book }; },
    weightOf: (ref) => { const w = db.get(ref); if (!w) return 1; const f = facts(db, w); return 1 + (f.score || f.rating || 5) / 5 + (f.favorite ? 2 : 0) + (f.lastPlayed ? Math.min(3, (Date.now() - f.lastPlayed) / (30 * 864e5)) : 3); },
  });
  return api;
}
