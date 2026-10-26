// video-processor/tlview.js - the timeline: ruler, overlay rows (text, stickers, pictures, drawings), the
// magnetic main track (filmstrips, transition chips) and audio rows (waveforms), the playhead. Pointer: click to
// select, drag a clip to reorder it, drag an item / audio clip in time and between rows, drag the edges to trim,
// drag the ruler or an empty spot to scrub; Ctrl + wheel zooms, everything snaps to edges and the playhead.
//
// Model: time maps to x linearly (x = PAD + t * pps). The DOM is rebuilt from the layout (L) on each render; the
// heavy parts (filmstrips, waveforms, ruler) are canvases painted in the next animation frame, so a rebuild stays
// cheap. Drags mutate a live copy (app.live) and commit one undoable edit on release; every live step first resets
// the item to its original state, so the result depends only on the pointer position, never on accumulated deltas.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { isStill } from '../timeline/model.js';
import * as E from '../timeline/edit.js';
import { fmtTime } from './geometry.js';

// Left padding so a clip starting at 0 is not glued to the scroller edge; ROW = row heights per kind in px.
const PAD = 14;
const ROW = { ov: 30, main: 58, au: 42 };
const KIND_ICON = { text: 'type', emoji: 'star', image: 'image', drawing: 'edit' };

export class TimelineView {
  constructor(app) {
    this.app = app;
    this.pps = 60; // pixels per second
    this.snapOn = true;
    this.drag = null;
    this.el = h('div', { class: 'vp-tl' });
    this.scroll = h('div', { class: 'vp-tl-scroll', tabindex: '-1' });
    this.inner = h('div', { class: 'vp-tl-inner' });
    this.ruler = h('canvas', { class: 'vp-tl-ruler', 'aria-hidden': 'true' });
    // The ruler doubles as the playhead control: role=slider with aria-valuenow / valuetext (timecode), operable by
    // arrows (one frame), PageUp/Down (5 s), Home / End.
    this.rulerBox = h('div', { class: 'vp-tl-rulerbox', role: 'slider', tabindex: '0', 'aria-label': t('vp.tl.playhead'), 'aria-valuemin': '0' }, this.ruler);
    this.rows = h('div', { class: 'vp-tl-rows' });
    this.ph = h('div', { class: 'vp-tl-ph', 'aria-hidden': 'true' }, h('i'));
    this.marker = h('div', { class: 'vp-tl-ins', hidden: true });
    this.inner.append(this.rulerBox, this.rows, this.ph, this.marker);
    this.scroll.append(this.inner);
    this.el.append(this.scroll);
    this.rows.addEventListener('pointerdown', (e) => this.down(e));
    this.rulerBox.addEventListener('pointerdown', (e) => this.down(e, true));
    for (const n of [this.rows, this.rulerBox]) {
      n.addEventListener('pointermove', (e) => this.move(e));
      n.addEventListener('pointerup', (e) => this.up(e));
      n.addEventListener('pointercancel', (e) => this.up(e, true));
    }
    this.rows.addEventListener('dblclick', (e) => { const it = e.target.closest('[data-id]'); if (it) app.openItem?.(it.dataset.id); });
    this.rows.addEventListener('keydown', (e) => this.key(e));
    // Tabbing onto a clip selects it, so keyboard users get the inspector without a separate action.
    this.rows.addEventListener('focusin', (e) => {
      const it = e.target.closest('[data-id], [data-tr]');
      const id = it && (it.dataset.id || it.dataset.tr + ':t');
      if (id && !this.drag && app.sel() !== id) app.select(id, { from: 'timeline' });
    });
    // Ctrl+wheel zooms around the pointer (plain wheel keeps scrolling); passive:false to block page zoom.
    this.scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.zoomAt(Math.exp(-e.deltaY / 300), e.clientX);
    }, { passive: false });
    this.scroll.addEventListener('scroll', () => this.paintRuler());
    this.rulerBox.addEventListener('keydown', (e) => {
      const fps = app.p.fps || 30;
      const d = { ArrowLeft: -1 / fps, ArrowRight: 1 / fps, PageUp: 5, PageDown: -5 }[e.key];
      if (d != null) { e.preventDefault(); e.stopPropagation(); app.seek(app.time() + (e.shiftKey ? Math.sign(d) : d)); }
      else if (e.key === 'Home') { e.preventDefault(); app.seek(0); } else if (e.key === 'End') { e.preventDefault(); app.seek(app.L.total); }
    });
    new ResizeObserver(() => { this.paintRuler(); }).observe(this.scroll);
  }

  x(tt) { return PAD + tt * this.pps; }
  timeAt(clientX) {
    const r = this.inner.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - PAD) / this.pps);
  }

  // --- rendering -----------------------------------------------------------------------------------------------------

  // CSS.escape: ids go into attribute selectors; escaping keeps any id character from breaking the selector.
  render() {
    // The focused clip / chip keeps the keyboard focus across the rebuild.
    const act = document.activeElement;
    const keep = act && this.rows.contains(act) ? (act.dataset.id ? `[data-id="${CSS.escape(act.dataset.id)}"]` : act.dataset.tr ? `[data-tr="${CSS.escape(act.dataset.tr)}"]` : null) : null;
    this.build();
    if (keep) this.rows.querySelector(keep)?.focus({ preventScroll: true });
  }

  build() {
    const { p, L } = this.app;
    const sel = this.app.sel();
    const selId = sel?.replace(/:t$/, '');
    // Inner width = timeline length plus 240 px of room to drag clips past the current end.
    const W = Math.max(this.scroll.clientWidth || 600, this.x(L.total) + 240);
    this.inner.style.width = W + 'px';
    this.rows.textContent = '';
    const ovRows = Math.max(0, ...p.overlays.map((o) => o.row + 1));
    const auRows = Math.max(1, ...p.audio.map((a) => a.row + 1));
    const head = (icon, label) => h('span', { class: 'vp-tl-head', title: label, 'aria-hidden': 'true' }, iconEl(icon));
    // Overlay rows, the top one first.
    for (let r = ovRows - 1; r >= 0; r--) {
      const row = h('div', { class: 'vp-tl-row vp-tl-ov', dataset: { kind: 'ov', row: String(r) }, style: { height: ROW.ov + 'px' } }, head('layers', t('vp.tl.overlays')));
      for (const o of L.overlays.filter((x) => x.item.row === r)) row.append(this.itemEl(o.item, o.start, o.end, selId));
      this.rows.append(row);
    }
    // Main track.
    const main = h('div', { class: 'vp-tl-row vp-tl-main', dataset: { kind: 'main' }, style: { height: ROW.main + 'px' } }, head('film', t('vp.tl.main')));
    if (!L.main.length) {
      main.append(h('button', { type: 'button', class: 'vp-tl-hint', onclick: () => this.app.importMedia() }, iconEl('plus'), t('vp.tl.addMain')));
    }
    for (const e of L.main) main.append(this.clipEl(e, selId));
    for (const e of L.main) {
      if (e.index >= L.main.length - 1) continue;
      const on = sel === e.clip.id + ':t';
      // Transition chips sit on the cut, or in the middle of the overlap when a transition exists.
      const cx = e.xOut > 0 ? this.x(e.end - e.xOut / 2) : this.x(e.end);
      main.append(h('button', {
        type: 'button', class: 'vp-tl-tr' + (e.xOut > 0 ? ' vp-has' : '') + (on ? ' vp-on' : ''), dataset: { tr: e.clip.id }, style: { left: cx + 'px' },
        title: e.xOut > 0 ? t('vp.tr.' + e.tOut.type) + ` · ${e.xOut} s` : t('vp.tl.addTransition'),
        'aria-label': e.xOut > 0 ? t('vp.tl.transitionN', { name: t('vp.tr.' + e.tOut.type) }) : t('vp.tl.addTransition'),
      }, iconEl(e.xOut > 0 ? 'transition' : 'plus')));
    }
    this.rows.append(main);
    for (let r = 0; r < auRows; r++) {
      const row = h('div', { class: 'vp-tl-row vp-tl-au', dataset: { kind: 'au', row: String(r) }, style: { height: ROW.au + 'px' } }, head('music', t('vp.tl.audio')));
      const list = L.audio.filter((a) => a.clip.row === r);
      if (!list.length && r === 0) row.append(h('button', { type: 'button', class: 'vp-tl-hint vp-tl-hint-au', onclick: () => this.app.importMedia('audio') }, iconEl('plus'), t('vp.tl.addAudio')));
      for (const a of list) row.append(this.audioEl(a, selId));
      this.rows.append(row);
    }
    this.paintRuler();
    this.setTime(this.app.time());
  }

  grips(el) {
    el.append(h('i', { class: 'vp-tl-grip vp-tl-grip-l', dataset: { edge: 'start' } }), h('i', { class: 'vp-tl-grip vp-tl-grip-r', dataset: { edge: 'end' } }));
  }

  clipEl(e, selId) {
    const c = e.clip, m = e.media, still = isStill(m);
    const w = Math.max(6, e.len * this.pps);
    const label = `${t(still ? 'vp.tl.still' : 'vp.tl.video')} ${e.index + 1}: ${m.name}, ${fmtTime(e.start)}–${fmtTime(e.end)}`;
    const el = h('div', {
      class: 'vp-tl-clip' + (c.id === selId ? ' vp-on' : ''), role: 'button', tabindex: '0', 'aria-label': label, title: m.name,
      dataset: { id: c.id, k: 'main' }, style: { left: this.x(e.start) + 'px', width: w + 'px' },
    });
    const strip = h('canvas', { class: 'vp-tl-strip', 'aria-hidden': 'true' });
    el.append(strip);
    const badges = [];
    if (!still && c.speed !== 1) badges.push(h('b', {}, c.speed + '×'));
    if (still && c.kenburns) badges.push(h('b', { title: t('vp.kb') }, 'KB'));
    if (c.adjust.preset !== 'none') badges.push(h('b', {}, t('vp.look.' + c.adjust.preset)));
    if (!still && (c.muted || !m.hasAudio)) badges.push(iconEl('volumeOff'));
    el.append(h('span', { class: 'vp-tl-name' }, iconEl(still ? 'image' : 'film'), h('span', {}, still ? fmtTime(e.len, 1) : m.name)), badges.length ? h('span', { class: 'vp-tl-badges' }, badges) : null);
    if (this.app.missing(m.id)) el.classList.add('vp-missing');
    this.grips(el);
    requestAnimationFrame(() => this.paintStrip(strip, e, w));
    return el;
  }

  // Canvas width capped at 4000 device px: browsers refuse or blank very wide canvases (limits vary, ~32k), and a
  // zoomed-in hour-long clip would exceed them. Each thumbnail slot samples the source time under its centre.
  paintStrip(canvas, e, w) {
    const store = this.app.store, m = store.get(e.media.id);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const H = ROW.main - 4;
    const cw = Math.min(4000, Math.round(w * dpr)), ch = Math.round(H * dpr);
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, cw, ch);
    if (!m) return;
    if (isStill(e.media)) {
      const b = m.bitmap;
      if (!b) return;
      const tw = Math.max(8, (ch * b.width) / b.height);
      for (let x = 0; x < cw; x += tw) ctx.drawImage(b, x, 0, tw, ch);
      return;
    }
    if (!m.thumbs?.list.length) return;
    const tw = Math.max(8, ch * (m.thumbs.aspect || 16 / 9));
    const c = e.clip;
    for (let x = 0; x < cw; x += tw) {
      const src = c.in + ((x + tw / 2) / cw) * (c.out - c.in);
      const img = store.thumbAt(m, src);
      if (img) ctx.drawImage(img, x, 0, tw, ch);
    }
  }

  itemEl(item, s, e, selId) {
    const w = Math.max(6, (e - s) * this.pps);
    const name = item.type === 'text' ? item.text.split('\n')[0] : item.type === 'emoji' ? item.emoji : item.type === 'image' ? this.app.p.media.find((m) => m.id === item.media)?.name || '' : t('vp.tl.drawing');
    const el = h('div', {
      class: `vp-tl-it vp-k-${item.type}` + (item.id === selId ? ' vp-on' : ''), role: 'button', tabindex: '0',
      'aria-label': `${t('vp.kind.' + item.type)}: ${name}, ${fmtTime(s)}–${fmtTime(e)}`, title: name,
      dataset: { id: item.id, k: 'ov' }, style: { left: this.x(s) + 'px', width: w + 'px' },
    }, iconEl(KIND_ICON[item.type]), h('span', {}, name));
    this.grips(el);
    return el;
  }

  audioEl(a, selId) {
    const c = a.clip, w = Math.max(6, (a.end - a.start) * this.pps);
    const el = h('div', {
      class: 'vp-tl-au-clip' + (c.id === selId ? ' vp-on' : '') + (c.muted ? ' vp-muted' : ''), role: 'button', tabindex: '0',
      'aria-label': `${t('vp.kind.audio')}: ${a.media?.name || ''}, ${fmtTime(a.start)}–${fmtTime(a.end)}`, title: a.media?.name || '',
      dataset: { id: c.id, k: 'au' }, style: { left: this.x(a.start) + 'px', width: w + 'px' },
    });
    const wave = h('canvas', { class: 'vp-tl-wave', 'aria-hidden': 'true' });
    el.append(wave, h('span', { class: 'vp-tl-name' }, iconEl('music'), h('span', {}, a.media?.name || '')));
    if (this.app.missing(c.media)) el.classList.add('vp-missing');
    this.grips(el);
    requestAnimationFrame(() => this.paintWave(wave, a, w));
    return el;
  }

  // One column per device pixel from the precomputed min/max peaks, scaled by clip volume (visual gain capped at
  // 1.6x so loud clips do not overflow the row). The colour token is read from CSS so it follows the theme.
  paintWave(canvas, a, w) {
    const m = this.app.store.get(a.clip.media);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const H = ROW.au - 4;
    const cw = Math.min(4000, Math.round(w * dpr)), ch = Math.round(H * dpr);
    canvas.width = cw;
    canvas.height = ch;
    const p = m?.peaks;
    if (!p?.length) return;
    const ctx = canvas.getContext('2d');
    const n = p.length / 2, dur = m.duration || 1, c = a.clip, mid = ch / 2;
    ctx.fillStyle = getComputedStyle(this.el).getPropertyValue('--vp-wave').trim() || '#34d399';
    for (let x = 0; x < cw; x++) {
      const s = c.in + (x / cw) * (c.out - c.in);
      const i = Math.min(n - 1, Math.floor((s / dur) * n));
      const g = c.volume;
      ctx.fillRect(x, mid - p[i * 2 + 1] * mid * 0.95 * Math.min(1.6, g), 1, Math.max(1, (p[i * 2 + 1] - p[i * 2]) * mid * 0.95 * Math.min(1.6, g)));
    }
  }

  // The ruler canvas covers only the visible width and is repainted on scroll (a canvas as wide as an hour-long
  // timeline would hit size limits). Major tick spacing = the smallest "nice" step at least 70 px apart; minor
  // ticks divide it by 5 (by 4 below one second). +0.5 px aligns 1 px lines to the pixel grid (crisp, not blurred).
  paintRuler() {
    const c = this.ruler, box = this.rulerBox;
    const w = this.scroll.clientWidth || 600;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.style.width = w + 'px';
    c.width = Math.round(w * dpr);
    c.height = Math.round(22 * dpr);
    box.style.width = w + 'px';
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, 22);
    const cs = getComputedStyle(this.el);
    ctx.strokeStyle = cs.getPropertyValue('--vp-tick').trim() || '#888';
    ctx.fillStyle = cs.getPropertyValue('--vp-tick-text').trim() || '#888';
    ctx.font = '10px ' + (cs.getPropertyValue('--ed-mono').trim() || 'monospace');
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((s) => s * this.pps >= 70) || 600;
    const minor = major / (major >= 1 ? 5 : 4);
    const left = this.scroll.scrollLeft;
    const t0 = Math.max(0, (left - PAD) / this.pps), t1 = (left + w - PAD) / this.pps;
    ctx.beginPath();
    for (let k = Math.floor(t0 / minor); k * minor <= t1; k++) {
      const tt = k * minor, x = Math.round(this.x(tt) - left) + 0.5;
      const isMajor = Math.abs(tt / major - Math.round(tt / major)) < 1e-6;
      ctx.moveTo(x, isMajor ? 10 : 16);
      ctx.lineTo(x, 22);
      if (isMajor) ctx.fillText(major < 1 ? fmtTime(tt, 2).replace(/^0:/, '') : fmtTime(tt, 0).replace(/\.$/, ''), x + 3, 9);
    }
    ctx.stroke();
    box.setAttribute('aria-valuemax', String(Math.round((this.app.L?.total || 0) * 100) / 100));
  }

  // The playhead moves by transform (no layout). During playback the view pages when the playhead passes 85% of
  // the width, keeping 15% of context on the left.
  setTime(tt) {
    const x = this.x(tt);
    this.ph.style.transform = `translateX(${x}px)`;
    this.rulerBox.setAttribute('aria-valuenow', String(Math.round(tt * 100) / 100));
    this.rulerBox.setAttribute('aria-valuetext', fmtTime(tt));
    if (this.app.playing()) {
      const s = this.scroll, w = s.clientWidth;
      if (x > s.scrollLeft + w * 0.85 || x < s.scrollLeft) s.scrollLeft = Math.max(0, x - w * 0.15);
    }
  }

  /** Highlights the timeline element of a command reference (hover in the commands panel). */
  highlight(ref) {
    for (const el of this.rows.querySelectorAll('.vp-hl')) el.classList.remove('vp-hl');
    if (!ref) return;
    const id = ref.replace(/:t$/, '');
    const el = ref.endsWith(':t') ? this.rows.querySelector(`[data-tr="${CSS.escape(id)}"]`) : this.rows.querySelector(`[data-id="${CSS.escape(id)}"]`);
    el?.classList.add('vp-hl');
  }

  reveal(id) {
    const el = this.rows.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const s = this.scroll, x = el.offsetLeft;
    if (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - 40) s.scrollLeft = Math.max(0, x - 60);
  }

  // --- zoom ---------------------------------------------------------------------------------------------------------

  // Zoom keeps the time under the anchor (pointer or centre) fixed on screen: remember that time, re-render at the
  // new scale, then set scrollLeft so the same time lands under the same x.
  setPps(v, anchorClientX = null) {
    const old = this.pps;
    const nv = Math.min(600, Math.max(2, v));
    if (Math.abs(nv - old) < 1e-6) return;
    const s = this.scroll;
    const r = s.getBoundingClientRect();
    const ax = anchorClientX == null ? r.width / 2 : anchorClientX - r.left;
    const tAt = (s.scrollLeft + ax - PAD) / old;
    this.pps = nv;
    this.render();
    s.scrollLeft = Math.max(0, tAt * nv + PAD - ax);
    this.app.onZoom?.(nv);
  }

  zoomAt(f, clientX) { this.setPps(this.pps * f, clientX); }
  zoomIn() { this.setPps(this.pps * 1.5); }
  zoomOut() { this.setPps(this.pps / 1.5); }
  fit() {
    const total = this.app.L.total || 10;
    this.setPps((this.scroll.clientWidth - PAD * 2 - 40) / total);
    this.scroll.scrollLeft = 0;
  }

  // --- pointer -------------------------------------------------------------------------------------------------------

  // Empty area or ruler: scrub (pause, seek, follow the pointer). On an element: select it and prepare a drag; the
  // drag only starts after 4 px of movement (see move), so a click stays a click. Trim grips start at once.
  // Snap points (edges of every element + the playhead) are collected once per drag.
  down(e, ruler = false) {
    if (e.button > 0) return;
    const app = this.app;
    const tr = e.target.closest('[data-tr]');
    if (tr) { app.select(tr.dataset.tr + ':t', { from: 'timeline' }); return; }
    if (e.target.closest('.vp-tl-hint')) return;
    const itEl = ruler ? null : e.target.closest('[data-id]');
    const target = ruler ? this.rulerBox : this.rows;
    if (!itEl) {
      e.preventDefault();
      if (!ruler) app.select(null, { from: 'timeline' });
      this.drag = { mode: 'scrub', target };
      target.setPointerCapture(e.pointerId);
      app.pause();
      app.seek(this.timeAt(e.clientX));
      return;
    }
    const id = itEl.dataset.id, k = itEl.dataset.k;
    const grip = e.target.closest('.vp-tl-grip');
    const f = E.find(app.p, id);
    if (!f) return;
    app.select(id, { from: 'timeline' });
    this.drag = {
      mode: grip ? 'trim' : 'move', edge: grip?.dataset.edge, id, k, target, el: itEl, x0: e.clientX, y0: e.clientY, t0: this.timeAt(e.clientX),
      orig: JSON.parse(JSON.stringify(f.item)), started: !!grip, points: [...E.snapPoints(app.L, id), app.time()],
    };
    target.setPointerCapture(e.pointerId);
    if (grip) e.preventDefault();
  }

  // Snapping distance is 8 screen px converted to seconds, so it feels the same at every zoom level.
  snap(tt) {
    if (!this.snapOn || !this.drag?.points) return tt;
    return E.snap(tt, this.drag.points, 8 / this.pps);
  }

  // Dragging above the top overlay row (or below the last audio row) creates a new row: n is one past the last.
  rowAt(kind, clientY) {
    const rows = [...this.rows.querySelectorAll(`.vp-tl-row[data-kind="${kind}"]`)];
    if (!rows.length) return 0;
    const n = rows.length;
    for (const r of rows) { const b = r.getBoundingClientRect(); if (clientY >= b.top && clientY < b.bottom) return +r.dataset.row; }
    const top = rows[0].getBoundingClientRect().top, bottom = rows[n - 1].getBoundingClientRect().bottom;
    // Overlay rows are drawn top-down from the highest; audio rows bottom-up. Beyond the edge: a new row.
    if (kind === 'ov') return clientY < top ? n : 0;
    return clientY >= bottom ? n : 0;
  }

  move(e) {
    const d = this.drag, app = this.app;
    if (!d) return;
    if (d.mode === 'scrub') { app.seek(this.timeAt(e.clientX)); return; }
    if (!d.started) {
      if (Math.abs(e.clientX - d.x0) < 4 && Math.abs(e.clientY - d.y0) < 4) return;
      d.started = true;
    }
    const f = E.find(app.p, d.id);
    if (!f) return;
    const tt = this.timeAt(e.clientX);
    if (d.mode === 'trim') {
      app.live((p) => { Object.assign(E.find(p, d.id).item, JSON.parse(JSON.stringify(d.orig))); E.trimTo(p, d.id, d.edge, this.snap(tt)); });
      return;
    }
    if (d.k === 'main') {
      // The main track is magnetic (no gaps): moving a clip is a reorder, not a time change. Only a CSS transform
      // moves while dragging; the model changes once, on release (moveMain).
      // Reorder: the clip follows the pointer, a caret shows where it lands.
      d.el.classList.add('vp-dragging');
      d.el.style.transform = `translateX(${e.clientX - d.x0}px)`;
      const others = app.L.main.filter((x) => x.clip.id !== d.id);
      let idx = others.findIndex((x) => tt < (x.start + x.end) / 2);
      if (idx < 0) idx = others.length;
      d.index = idx;
      const at = idx < others.length ? others[idx].start : others.length ? others[others.length - 1].end : 0;
      this.marker.hidden = false;
      this.marker.style.left = this.x(at) + 'px';
      const mr = this.rows.querySelector('.vp-tl-main');
      this.marker.style.top = mr.offsetTop + this.rows.offsetTop + 'px';
      this.marker.style.height = ROW.main + 'px';
      return;
    }
    const len = (d.orig.end ?? d.orig.start + (d.orig.out - d.orig.in)) - d.orig.start;
    // Free items snap by whichever edge (start or end) is closer to a snap point.
    let s = d.orig.start + (tt - d.t0);
    const s1 = this.snap(s), s2 = this.snap(s + len) - len;
    s = Math.abs(s1 - s) <= Math.abs(s2 - s) ? s1 : s2;
    const row = this.rowAt(d.k, e.clientY);
    app.live((p) => { Object.assign(E.find(p, d.id).item, JSON.parse(JSON.stringify(d.orig))); E.moveItem(p, d.id, Math.max(0, s), row); });
  }

  // pointercancel restores the original item. After moving overlays / audio, compactRows removes rows left empty.
  up(e, cancel = false) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    try { d.target.releasePointerCapture(e.pointerId); } catch { /* released */ }
    this.marker.hidden = true;
    const app = this.app;
    if (d.mode === 'scrub' || !d.started) return;
    if (cancel) { app.live((p) => Object.assign(E.find(p, d.id).item, d.orig)); app.render(); return; }
    if (d.mode === 'trim') app.commit(t('vp.h.trim'));
    else if (d.k === 'main') {
      d.el.style.transform = '';
      d.el.classList.remove('vp-dragging');
      if (d.index != null) app.edit((p) => E.moveMain(p, d.id, d.index), t('vp.h.move'));
    } else app.edit((p) => E.compactRows(p), t('vp.h.move'));
  }

  key(e) {
    const it = e.target.closest('[data-id]');
    if (!it) return;
    if (e.key === 'Enter') { e.preventDefault(); this.app.openItem?.(it.dataset.id); }
  }
}
