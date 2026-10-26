// video-processor/engine.js - the preview player of a project: a clock drives the timeline time, hidden
// <video> / <audio> elements play the active clips (two during a transition) and are kept in sync with it, Web Audio
// gains apply volume, fades and cross-fades (gainAt of timeline/audio.js, the same ramps as the export), and the
// compositor draws every frame into the preview canvas. Paused, the elements seek to the scrubbed time.
//
// Clock model: the timeline clock is performance.now() based (t0 = wall time at timeline 0), and media elements
// FOLLOW it, corrected only when they drift beyond a tolerance. The alternative (clock = video.currentTime) breaks
// on gaps, stills, transitions with two sources and clips at different speeds; a single master clock keeps all of
// them consistent. Cost: elements are re-sought when they drift, which is rare at normal playback.
// Audio: every element is routed through Web Audio (MediaElementSource -> Gain -> master) so volume envelopes use
// the same gainAt() as the export: what you hear is what you export.
import { audioPieces, gainAt } from '../timeline/audio.js';
import { isStill, sourceTime } from '../timeline/model.js';

// Preloading window: an element for a clip that starts within 0.8 s is created and sought ahead, so the cut plays
// without a decode stall.
const LOOKAHEAD = 0.8; // s: elements of clips that start soon are prepared (loaded and sought)

export class Engine {
  /**
   * opts { canvas, store (MediaStore), compositor, onTime(t), onPlay(playing), onEnded(), silent, maxSide, hide }
   */
  constructor(opts) {
    this.o = opts;
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.store = opts.store;
    this.comp = opts.compositor;
    this.p = null;
    this.L = null;
    this.t = 0;
    this.playing = false;
    this.pool = new Map(); // key -> element
    this.gains = new Map(); // element -> GainNode
    this.box = document.createElement('div');
    // Media elements must be in the document to decode reliably in every engine, but invisible: a 4px fixed box
    // off-screen, opacity 0, no pointer events, aria-hidden. display:none is avoided: some engines stop decoding
    // frames of undisplayed video.
    this.box.style.cssText = 'position:fixed;left:-20px;top:-20px;width:4px;height:4px;overflow:hidden;opacity:0;pointer-events:none';
    this.box.setAttribute('aria-hidden', 'true');
    document.body.append(this.box);
    this.boxes = [];
    this.drawQueued = false;
    this.ac = null;
  }

  setProject(p, L) {
    this.p = p;
    this.L = L;
    this.pieces = new Map(audioPieces(p, L).map((x) => [x.ref, x]));
    if (this.t > L.total) this.t = L.total;
    this.sync(true);
    this.requestDraw();
  }

  get duration() { return this.L?.total || 0; }
  get time() { return this.t; }

  // --- transport ---------------------------------------------------------------------------------------------------

  // The AudioContext is created on the first play: it must start from a user gesture (autoplay policy).
  async play() {
    if (!this.L || this.L.total <= 0 || this.playing) return;
    if (this.t >= this.L.total - 0.02) this.t = 0;
    this.audioContext();
    this.playing = true;
    this.t0 = performance.now() - this.t * 1000;
    this.o.onPlay?.(true);
    this.sync(true);
    this.loop();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    for (const el of this.pool.values()) el.pause();
    this.o.onPlay?.(false);
    this.sync(true);
    this.requestDraw();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  seek(t) {
    const v = Math.min(this.duration, Math.max(0, +t || 0));
    this.t = v;
    if (this.playing) this.t0 = performance.now() - v * 1000;
    this.sync(true);
    this.o.onTime?.(v);
    this.requestDraw();
  }

  // Frame stepping snaps to the frame grid (round(t * fps) / fps), so repeated steps never accumulate float drift.
  step(frames) {
    this.pause();
    const fps = this.p?.fps || 30;
    this.seek(Math.round((this.t + frames / fps) * fps) / fps);
  }

  // One rAF loop per play; loopId invalidates an older loop if play() is called again before it noticed the stop.
  loop() {
    const id = (this.loopId = (this.loopId || 0) + 1);
    const tick = () => {
      if (!this.playing || id !== this.loopId) return;
      let t = (performance.now() - this.t0) / 1000;
      if (t >= this.duration) {
        t = this.duration;
        this.t = t;
        this.playing = false;
        for (const el of this.pool.values()) el.pause();
        this.o.onPlay?.(false);
        this.o.onEnded?.();
        this.draw();
        this.o.onTime?.(t);
        return;
      }
      this.t = t;
      this.sync(false);
      this.draw();
      this.o.onTime?.(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // --- media elements ----------------------------------------------------------------------------------------------

  audioContext() {
    if (this.o.silent || this.ac || typeof AudioContext !== 'function') return this.ac;
    try {
      this.ac = new AudioContext();
      this.master = this.ac.createGain();
      this.master.connect(this.ac.destination);
      for (const el of this.pool.values()) this.route(el);
    } catch { this.ac = null; }
    this.ac?.resume?.().catch(() => {});
    return this.ac;
  }

  // createMediaElementSource can be called only once per element (it throws on the second call), hence the map and
  // try/catch. Start at gain 0; sync() ramps it to the computed value.
  route(el) {
    if (!this.ac || this.gains.has(el)) return;
    try {
      const src = this.ac.createMediaElementSource(el);
      const g = this.ac.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.master);
      this.gains.set(el, g);
    } catch { /* already routed elsewhere */ }
  }

  // Element pool keyed per media and slot. Video keys use index % 2: consecutive clips from the same file get two
  // different elements, so a transition between them (both visible at once) has two independent decoders.
  // `seeked` replays a seek requested while the element was busy (see seekEl).
  element(key, mediaId, kind) {
    let el = this.pool.get(key);
    const e = this.store.get(mediaId);
    if (!e?.url) return null;
    if (!el) {
      el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      el.preload = 'auto';
      el.playsInline = true;
      el.muted = !!this.o.silent;
      el.addEventListener('seeked', () => { if (el._pending != null) { const p = el._pending; el._pending = null; if (Math.abs(el.currentTime - p) > 0.01) el.currentTime = p; } this.requestDraw(); });
      el.addEventListener('loadeddata', () => this.requestDraw());
      this.box.append(el);
      this.pool.set(key, el);
      this.route(el);
    }
    if (el._media !== mediaId) {
      el._media = mediaId;
      el.src = e.url;
      el._pending = null;
    }
    return el;
  }

  // Seeks without piling up requests while the element is still seeking.
  // Seeks are asynchronous; issuing one per frame while scrubbing would queue dozens. Only the latest target is
  // kept (_pending) and applied when the current seek finishes.
  seekEl(el, t) {
    if (el.seeking) { el._pending = t; return; }
    if (Math.abs(el.currentTime - t) > 0.004) el.currentTime = t;
  }

  /** Brings every element to where it should be at the current time. */
  // Every call computes the wanted state of each element from the timeline (active or about to be, expected source
  // time, rate, gain) and corrects the elements. Tolerances: while playing, re-seek only beyond 0.18 s of drift
  // (scaled by speed; seeking is expensive and causes a stutter); paused, keep within half a frame so the preview
  // shows the exact frame.
  sync(force) {
    if (!this.L) return;
    const t = this.t, L = this.L;
    const wanted = new Map();
    const fps = this.p.fps || 30;
    for (const e of L.main) {
      if (isStill(e.media) || !e.media) continue;
      const active = t >= e.start && t < e.end;
      const soon = !active && e.start > t && e.start - t < LOOKAHEAD;
      if (!active && !soon && !(t === L.total && e.end === L.total)) continue;
      const key = `${e.media.id}:${e.index % 2}`;
      const el = this.element(key, e.media.id, 'video');
      if (!el) continue;
      wanted.set(el, { expected: active ? sourceTime(e, t) : e.clip.in, active, rate: e.clip.speed, pitch: e.clip.keepPitch, ref: e.clip.id, start: e.start });
    }
    for (const a of L.audio) {
      const active = t >= a.start && t < a.end;
      const soon = !active && a.start > t && a.start - t < LOOKAHEAD;
      if (!active && !soon) continue;
      const el = this.element('a:' + a.clip.id, a.clip.media, 'audio');
      if (!el) continue;
      wanted.set(el, { expected: active ? a.clip.in + (t - a.start) : a.clip.in, active, rate: 1, pitch: true, ref: a.clip.id, start: a.start });
    }
    for (const [el, w] of wanted) {
      const play = this.playing && w.active;
      if (el.playbackRate !== w.rate) el.playbackRate = w.rate;
      if ('preservesPitch' in el && el.preservesPitch !== w.pitch) el.preservesPitch = w.pitch;
      if (play) {
        const drift = Math.abs(el.currentTime - w.expected);
        if (force || drift > 0.18 * Math.max(1, w.rate)) this.seekEl(el, w.expected);
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (force || Math.abs(el.currentTime - w.expected) > 0.5 / fps) this.seekEl(el, w.expected);
      }
      // Gain: volume x fades x transition cross-fades.
      const pc = this.pieces.get(w.ref);
      const g = play && pc ? gainAt(pc, t - w.start) : 0;
      const node = this.gains.get(el);
      // setTargetAtTime with a 15 ms time constant smooths gain steps between frames (no zipper noise). Without Web
      // Audio, element.volume is the fallback (clamped: volume > 1 throws).
      if (node) node.gain.setTargetAtTime(g, this.ac.currentTime, 0.015);
      else if (!this.o.silent) el.volume = Math.min(1, Math.max(0, g));
    }
    for (const el of this.pool.values()) {
      if (!wanted.has(el) && !el.paused) el.pause();
      if (!wanted.has(el)) { const n = this.gains.get(el); if (n) n.gain.value = 0; }
    }
    this.wanted = wanted;
  }

  /** The drawable of a main entry at the current time. */
  // readyState >= 2 (HAVE_CURRENT_DATA) and a non-zero videoWidth: drawing an element before that paints nothing or
  // throws in some engines.
  frameOf = (e) => {
    if (!e.media) return null;
    const m = this.store.get(e.media.id);
    if (!m) return null;
    if (isStill(e.media)) return m.bitmap || null;
    const el = this.pool.get(`${e.media.id}:${e.index % 2}`);
    return el && el.readyState >= 2 && el.videoWidth ? el : null;
  };

  imageOf = (id) => this.store.get(id)?.bitmap || null;

  // --- drawing -----------------------------------------------------------------------------------------------------

  // While playing the loop draws every frame anyway; when paused, coalesce draw requests into one per frame.
  requestDraw() {
    if (this.drawQueued || this.playing) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; if (!this.playing) this.draw(); });
  }

  draw() {
    if (!this.L || !this.p) return;
    const c = this.canvas;
    const r = this.comp.render(this.ctx, c.width, c.height, this.p, this.L, this.t, this.frameOf, this.imageOf, { hide: this.o.hide?.() });
    this.boxes = r.boxes;
    this.o.onDraw?.(r);
  }

  // removeAttribute('src') + load() releases the decoder and the network/blob reference; pause() alone keeps them.
  destroy() {
    this.playing = false;
    for (const el of this.pool.values()) { el.pause(); el.removeAttribute('src'); el.load(); }
    this.pool.clear();
    this.box.remove();
    this.ac?.close?.().catch(() => {});
  }
}
