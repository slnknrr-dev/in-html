// video-processor/inspector.js - the editing panel of the selection: the project (format, framing, frame
// rate), a main clip (trim, speed, still duration, framing, Ken Burns, colour looks and adjustments, audio, fades),
// a transition, an overlay (text, sticker, picture, drawing: content, style, motion, placement) or an audio clip.
// Every change is one undoable edit; slider drags merge into one.
//
// Rendering model: the panel is rebuilt from the project on every relevant change (it holds no state of its own
// besides the remembered tab per element kind). Edits go through app.edit(mutator, label, mergeKey): the mutator
// receives a draft project, and a merge key (e.g. 'speed:<id>') folds a whole slider drag into one undo step.
// Values are rounded to 3 decimals (r3) before storing: slider float noise would otherwise bloat saved projects and
// show up in the ffmpeg command as 0.30000000000000004.
import { field, range, select, seg, textInput, toggle } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { ANIMS, ASPECTS, FONTS, FPS, KENBURNS, TRANSITIONS, frameSize, isStill } from '../timeline/model.js';
import { ADJUST0, PRESETS } from '../timeline/color.js';
import * as E from '../timeline/edit.js';
import { fmtTime } from './geometry.js';
import { SWATCHES } from './stage.js';
import { sizeOf } from './compose.js';

// Sticker palette. Some entries include U+FE0F (emoji presentation selector) so they render as colour emoji, not
// text glyphs.
export const EMOJI = ['😀', '😂', '😍', '🥳', '😎', '🤩', '😮', '😢', '😡', '👍', '👏', '🙌', '🙏', '💪', '👀', '❤️', '🔥', '✨', '⭐', '🎉', '🎂', '🎁', '🎵', '📍', '✈️', '🌴', '🌊', '☀️', '🌙', '🌈', '🍕', '☕', '🐶', '🐱', '⚽', '🏆', '💯', '✅', '❗', '➡️'];
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Used to restore focus by position after a rebuild (see render()).
const FOCUSABLE = 'button:not([disabled]), input, select, textarea, [tabindex="0"]';
const secs = (v, d) => `${(+v).toFixed(d)} ${t('vp.sec')}`;

export class Inspector {
  constructor(app) {
    this.app = app;
    this.el = h('div', { class: 'vp-insp' });
    this.tabs = {};
  }

  // An edit of the selected element (or the project) from this panel. Continuous controls (sliders, text: a merge
  // key) keep the panel as it is; discrete ones (buttons, choices) repaint it.
  upd(id, fn, label, merge = null) {
    return this.app.edit((p) => { const x = id ? E.find(p, id)?.item : p; if (x) fn(x, p); }, label, merge, merge ? { from: 'inspector' } : {});
  }

  // A rebuild replaces every control; without restoring focus, a keyboard user adjusting a slider would be thrown
  // back to <body> after each step. Index-based restore works because the panel layout is stable between rebuilds.
  render() {
    // Keyboard focus survives the rebuild: the control at the same position gets it back.
    const act = document.activeElement;
    const before = act && this.el.contains(act) ? [...this.el.querySelectorAll(FOCUSABLE)].indexOf(act) : -1;
    this.build();
    if (before >= 0) [...this.el.querySelectorAll(FOCUSABLE)][before]?.focus({ preventScroll: true });
  }

  build() {
    const app = this.app;
    const sel = app.sel();
    this.el.textContent = '';
    if (!sel) { this.project(); return; }
    if (sel.endsWith(':t')) { this.transition(sel.slice(0, -2)); return; }
    const f = E.find(app.p, sel);
    if (!f) { this.project(); return; }
    if (f.list === 'main') this.clip(f.item);
    else if (f.list === 'overlays') this.overlay(f.item);
    else this.audioClip(f.item);
  }

  // --- building blocks ---------------------------------------------------------------------------------------------

  head(icon, title, sub, actions = []) {
    this.el.append(h('div', { class: 'vp-insp-head' }, iconEl(icon), h('div', { class: 'vp-insp-title' }, h('b', {}, title), sub ? h('small', {}, sub) : null),
      h('span', { class: 'ed-spacer' }), ...actions));
  }

  act(icon, label, fn, danger = false) {
    return h('button', { type: 'button', class: 'ed-iconbtn' + (danger ? ' ed-danger' : ''), title: t(label), 'aria-label': t(label), onclick: fn }, iconEl(icon));
  }

  // The chosen tab is remembered per element kind (clip / overlay), so selecting another clip keeps the same tab.
  tabbar(kind, list) {
    const cur = list.some((x) => x.v === this.tabs[kind]) ? this.tabs[kind] : list[0].v;
    this.tabs[kind] = cur;
    const s = seg(list.map((x) => ({ ...x, l: x.l })), cur, (v) => { this.tabs[kind] = v; this.render(); }, 'vp.insp.tabs');
    s.classList.add('vp-tabs');
    this.el.append(s);
    return cur;
  }

  sec(...kids) { const s = h('div', { class: 'vp-insp-sec' }, ...kids); this.el.append(s); return s; }

  slider(label, value, o, onInput) {
    const r = range({ min: o.min, max: o.max, step: o.step || 1, value, unit: o.unit || '', onInput });
    if (o.fmt) { const out = r.querySelector('output'); const paint = (v) => { out.textContent = o.fmt(v); }; paint(value); r.querySelector('input').addEventListener('input', (e) => paint(+e.target.value)); }
    return field(label, r);
  }

  // Commits on 'change' (blur / Enter), not 'input': typing "1.5" must not apply "1" then "1." on the way.
  numInput(value, onChange, { min = 0, max = 86400, step = 0.01 } = {}) {
    const i = h('input', { type: 'number', class: 'ed-input vp-num', min, max, step, value: r3(value) });
    i.addEventListener('change', () => { const v = +i.value; if (Number.isFinite(v)) onChange(clamp(v, min, max)); });
    return i;
  }

  // Preset chips compare with an epsilon: values come from float maths and sliders.
  chips(list, cur, onPick, fmt = (v) => String(v)) {
    return h('div', { class: 'ed-chips vp-chips' }, list.map((v) => h('button', { type: 'button', class: 'ed-chip' + (Math.abs(v - cur) < 1e-6 ? ' ed-on' : ''), 'aria-pressed': String(Math.abs(v - cur) < 1e-6), onclick: () => onPick(v) }, fmt(v))));
  }

  // Swatches commit a discrete edit; the native colour input streams 'input' events, flagged live so the caller
  // merges them into one undo step.
  colorRow(value, onPick) {
    const inp = h('input', { type: 'color', class: 'ap-color', value, 'aria-label': t('vp.color') });
    inp.addEventListener('input', () => onPick(inp.value, true));
    return h('div', { class: 'vp-colors' }, SWATCHES.map((c) => h('button', { type: 'button', class: 'vp-swatch' + (c === value ? ' vp-on' : ''), style: { background: c }, title: c, 'aria-label': c, onclick: () => onPick(c, false) })), inp);
  }

  // --- project -----------------------------------------------------------------------------------------------------

  project() {
    const app = this.app, p = app.p;
    this.head('settings', t('vp.insp.project'), `${fmtTime(app.L.total)} · ${t('vp.insp.counts', { c: p.main.length, o: p.overlays.length, a: p.audio.length })}`);
    const name = textInput(p.name, (v) => this.upd(null, (x) => { x.name = v.slice(0, 120) || 'Untitled'; }, t('vp.h.rename'), 'name'), { 'aria-label': t('vp.insp.name') });
    const fmt = seg(Object.keys(ASPECTS).map((a) => ({ v: a, l: '=' + a })), p.aspect, (v) => this.upd(null, (x) => { x.aspect = v; }, t('vp.h.format')), 'vp.insp.format');
    const size = frameSize(p.aspect, 1080);
    const fit = seg(['fit', 'fill', 'blur'].map((v) => ({ v, l: 'vp.fit.' + v })), p.fit, (v) => this.upd(null, (x) => { x.fit = v; }, t('vp.h.framing')), 'vp.insp.framing');
    const fps = select(FPS.map((v) => ({ v, l: `=${v} fps` })), p.fps, (v) => this.upd(null, (x) => { x.fps = +v; }, t('vp.h.fps')));
    this.sec(field('vp.insp.name', name), field('vp.insp.format', fmt, `=${size.width} × ${size.height}`), field('vp.insp.framing', fit, 'vp.insp.framingHint'),
      field('vp.insp.background', this.colorRow(p.background, (c, live) => this.upd(null, (x) => { x.background = c; }, t('vp.h.background'), live ? 'bg' : null))), field('vp.insp.fps', fps));
    this.sec(h('h3', { class: 'vp-insp-h' }, t('vp.insp.add')), h('div', { class: 'vp-insp-grid' },
      this.bigBtn('filePlus', 'vp.add.media', () => app.importMedia()), this.bigBtn('type', 'vp.add.text', () => app.addText()),
      this.bigBtn('star', 'vp.add.sticker', () => app.addSticker()), this.bigBtn('edit', 'vp.add.draw', () => app.setDrawMode(true)),
      this.bigBtn('music', 'vp.add.music', () => app.importMedia('audio')), this.bigBtn('gallery', 'vp.add.slideshow', () => app.slideshow())));
    this.sec(h('p', { class: 'ed-hint' }, t('vp.insp.projectHint')));
  }

  bigBtn(icon, label, fn) { return h('button', { type: 'button', class: 'vp-big', onclick: fn }, iconEl(icon), h('span', {}, t(label))); }

  // --- main clips --------------------------------------------------------------------------------------------------

  clip(c) {
    const app = this.app;
    const e = app.L.main.find((x) => x.clip.id === c.id);
    const m = e.media, still = isStill(m);
    this.head(still ? 'image' : 'film', `${t(still ? 'vp.tl.still' : 'vp.tl.video')} ${e.index + 1}`, `${m.name} · ${fmtTime(e.len)}`, [
      this.act('copy', 'vp.duplicate', () => app.duplicate()), this.act('trash', 'vp.delete', () => app.remove(), true), this.act('close', 'vp.deselect', () => app.select(null))]);
    const tabs = [{ v: 'clip', l: 'vp.tab.clip', icon: 'scissors' }, { v: 'frame', l: 'vp.tab.frame', icon: 'crop' }, { v: 'color', l: 'vp.tab.color', icon: 'palette' }];
    if (!still && m.hasAudio) tabs.push({ v: 'audio', l: 'vp.tab.audio', icon: 'volume' });
    tabs.push({ v: 'fade', l: 'vp.tab.fade', icon: 'transition' });
    const tab = this.tabbar('clip', tabs);
    if (tab === 'clip') this.clipTab(c, e, still);
    else if (tab === 'frame') this.frameTab(c, e, still);
    else if (tab === 'color') this.colorTab(c, e);
    else if (tab === 'audio') this.audioTab(c, e);
    else this.fadeTab(c, e);
  }

  // Stills have a duration (out - in with in = 0); videos have source in/out points, kept at least 0.1 s apart so a
  // clip never collapses to zero length.
  clipTab(c, e, still) {
    const app = this.app;
    if (still) {
      const d = c.out - c.in;
      this.sec(this.slider('vp.insp.duration', Math.min(30, d), { min: 0.1, max: 30, step: 0.1, fmt: (v) => secs(v, 1) }, (v) => this.upd(c.id, (x) => { x.in = 0; x.out = r3(v); }, t('vp.h.duration'), 'dur:' + c.id)),
        this.chips([1, 2, 3, 5, 8, 10], d, (v) => this.upd(c.id, (x) => { x.in = 0; x.out = v; }, t('vp.h.duration')), (v) => secs(v, 0)),
        field('vp.insp.durationExact', this.numInput(d, (v) => this.upd(c.id, (x) => { x.in = 0; x.out = Math.max(0.1, v); }, t('vp.h.duration')), { min: 0.1, max: 3600, step: 0.1 })),
        h('p', { class: 'ed-hint' }, t('vp.insp.stillHint')));
      const origin = e.media.origin;
      this.sec(h('div', { class: 'ap-row' },
        h('button', { type: 'button', class: 'ed-btn', onclick: () => app.editPicture(c.id) }, iconEl('edit'), t('vp.insp.paint')),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => app.splitSelected() }, iconEl('split'), t('vp.split'))),
      origin ? h('p', { class: 'ed-hint' }, t(origin.kind === 'freeze' ? 'vp.insp.isFreeze' : 'vp.insp.isEdited', { t: fmtTime(origin.time || 0) })) : null);
      return;
    }
    const dur = e.media.duration;
    this.sec(h('div', { class: 'vp-range2' },
      field('vp.insp.srcIn', this.numInput(c.in, (v) => this.upd(c.id, (x) => { x.in = r3(Math.min(v, x.out - 0.1)); }, t('vp.h.trim')), { max: dur })),
      field('vp.insp.srcOut', this.numInput(c.out, (v) => this.upd(c.id, (x) => { x.out = r3(Math.max(v, x.in + 0.1)); }, t('vp.h.trim')), { max: dur }))),
    h('div', { class: 'ap-row' },
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => app.trimToPlayhead('start') }, iconEl('markIn'), t('vp.setIn')),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => app.trimToPlayhead('end') }, iconEl('markOut'), t('vp.setOut')),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => app.splitSelected() }, iconEl('split'), t('vp.split'))));
    this.sec(field('vp.speed', h('div', {}, this.chips([0.25, 0.5, 1, 1.5, 2, 3, 4], c.speed, (v) => this.upd(c.id, (x) => { x.speed = v; }, t('vp.h.speed')), (v) => v + '×'),
      range({ min: 0.1, max: 8, step: 0.05, value: c.speed, unit: '×', onInput: (v) => this.upd(c.id, (x) => { x.speed = v; }, t('vp.h.speed'), 'speed:' + c.id) }))),
    field('vp.keepPitch', toggle(c.keepPitch, (v) => this.upd(c.id, (x) => { x.keepPitch = v; }, t('vp.h.pitch'))), 'vp.keepPitchHint'));
    this.sec(h('h3', { class: 'vp-insp-h' }, t('vp.insp.frames')), h('div', { class: 'ap-row' },
      h('button', { type: 'button', class: 'ed-btn', onclick: () => app.freezeFrame(false) }, iconEl('camera'), t('vp.insp.freeze')),
      h('button', { type: 'button', class: 'ed-btn', onclick: () => app.freezeFrame(true) }, iconEl('edit'), t('vp.insp.paintFrame'))),
    h('p', { class: 'ed-hint' }, t('vp.insp.freezeHint')));
  }

  // Zoom / pan are hidden while Ken Burns is on: the Ken Burns windows define the framing of a still over time.
  // Quarter turns only (0/90/180/270): they are lossless in ffmpeg (transpose) and keep the frame rectangular.
  frameTab(c, e, still) {
    const fit = seg([{ v: '', l: 'vp.fit.project' }, ...['fit', 'fill', 'blur'].map((v) => ({ v, l: 'vp.fit.' + v }))], c.fit || '', (v) => this.upd(c.id, (x) => { x.fit = v || null; }, t('vp.h.framing')), 'vp.insp.framing');
    if (!(still && c.kenburns)) {
      this.sec(field('vp.insp.framing', fit),
        this.slider('vp.insp.zoom', Math.round(c.zoom * 100), { min: 20, max: 500, unit: '%' }, (v) => this.upd(c.id, (x) => { x.zoom = v / 100; }, t('vp.h.zoom'), 'zoom:' + c.id)),
        this.slider('vp.insp.panX', Math.round(c.panX * 100), { min: -100, max: 100, unit: '%' }, (v) => this.upd(c.id, (x) => { x.panX = v / 100; }, t('vp.h.pan'), 'panx:' + c.id)),
        this.slider('vp.insp.panY', Math.round(c.panY * 100), { min: -100, max: 100, unit: '%' }, (v) => this.upd(c.id, (x) => { x.panY = v / 100; }, t('vp.h.pan'), 'pany:' + c.id)),
        h('p', { class: 'ed-hint' }, t('vp.insp.panHint')));
    }
    this.sec(field('vp.rotate', h('div', { class: 'ap-row' },
      this.act('rotL', 'vp.rotL', () => this.upd(c.id, (x) => { x.rotate = (x.rotate + 270) % 360; }, t('vp.h.rotate'))),
      this.act('rotR', 'vp.rotR', () => this.upd(c.id, (x) => { x.rotate = (x.rotate + 90) % 360; }, t('vp.h.rotate'))),
      h('span', { class: 'vp-deg' }, c.rotate + '°'), h('span', { class: 'ed-spacer' }),
      this.toggleBtn('flip', 'vp.flipH', c.flipH, (v) => this.upd(c.id, (x) => { x.flipH = v; }, t('vp.h.flip'))),
      this.toggleBtn('flipV', 'vp.flipV', c.flipV, (v) => this.upd(c.id, (x) => { x.flipV = v; }, t('vp.h.flip'))))),
    h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => this.upd(c.id, (x) => { Object.assign(x, { fit: null, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false }); }, t('vp.h.framing')) }, iconEl('refresh'), t('vp.insp.resetFrame')));
    if (!still) return;
    // Identify the preset by structural equality; a modified move shows as "custom". Presets are deep-copied into the
    // clip so later slider edits do not mutate the shared KENBURNS table.
    const kbKey = c.kenburns ? Object.keys(KENBURNS).find((k) => JSON.stringify(KENBURNS[k]) === JSON.stringify(c.kenburns)) || 'custom' : 'none';
    const kb = select([{ v: 'none', l: 'vp.kb.none' }, ...Object.keys(KENBURNS).map((k) => ({ v: k, l: 'vp.kb.' + k })), ...(kbKey === 'custom' ? [{ v: 'custom', l: 'vp.kb.custom' }] : [])], kbKey,
      (v) => this.upd(c.id, (x) => { x.kenburns = v === 'none' ? null : v === 'custom' ? x.kenburns : JSON.parse(JSON.stringify(KENBURNS[v])); }, t('vp.h.kb')));
    const s = this.sec(field('vp.kb', kb, 'vp.kbHint'));
    if (c.kenburns) {
      s.append(this.slider('vp.kb.from', Math.round(c.kenburns.from.z * 100), { min: 100, max: 250, unit: '%' }, (v) => this.upd(c.id, (x) => { x.kenburns.from.z = v / 100; }, t('vp.h.kb'), 'kbf:' + c.id)),
        this.slider('vp.kb.to', Math.round(c.kenburns.to.z * 100), { min: 100, max: 250, unit: '%' }, (v) => this.upd(c.id, (x) => { x.kenburns.to.z = v / 100; }, t('vp.h.kb'), 'kbt:' + c.id)));
    }
  }

  toggleBtn(icon, label, on, fn) {
    return h('button', { type: 'button', class: 'ed-iconbtn' + (on ? ' ed-on' : ''), 'aria-pressed': String(on), title: t(label), 'aria-label': t(label), onclick: () => fn(!on) }, iconEl(icon));
  }

  // Look thumbnails render the current frame through each preset's colour plan; drawn in the next animation frame so
  // the panel appears first and the thumbnails fill in.
  colorTab(c, e) {
    const app = this.app;
    const a = c.adjust;
    const grid = h('div', { class: 'vp-looks', role: 'radiogroup', 'aria-label': t('vp.insp.looks') });
    const frame = app.engine.frameOf(e);
    for (const k of PRESETS) {
      const cv = h('canvas', { width: 64, height: 64, 'aria-hidden': 'true' });
      grid.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(a.preset === k), class: 'vp-look' + (a.preset === k ? ' vp-on' : ''), onclick: () => this.upd(c.id, (x) => { x.adjust.preset = k; }, t('vp.h.look')) }, cv, h('span', {}, t('vp.look.' + k))));
      if (frame) requestAnimationFrame(() => this.lookThumb(cv, frame, { ...ADJUST0, preset: k }));
    }
    this.sec(h('h3', { class: 'vp-insp-h' }, t('vp.insp.looks')), grid);
    const sl = (k, min = -100) => this.slider('vp.adj.' + k, a[k], { min, max: 100 }, (v) => this.upd(c.id, (x) => { x.adjust[k] = v; }, t('vp.h.adjust'), `adj:${k}:${c.id}`));
    this.sec(h('h3', { class: 'vp-insp-h' }, t('vp.insp.adjust')), sl('brightness'), sl('contrast'), sl('saturation'), sl('temperature'), sl('hue'), sl('vignette', 0),
      h('div', { class: 'ap-row' },
        h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => this.upd(c.id, (x) => { x.adjust = { ...ADJUST0 }; }, t('vp.h.adjust')) }, iconEl('refresh'), t('ap.reset')),
        h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => app.edit((p) => { for (const x of p.main) x.adjust = { ...c.adjust }; }, t('vp.h.adjustAll'), null, { from: 'inspector' }) }, iconEl('copy'), t('vp.insp.applyAll'))));
  }

  lookThumb(cv, frame, adjust) {
    const [w, h0] = sizeOf(frame);
    if (!w) return;
    const ctx = cv.getContext('2d');
    const plan = this.app.comp.plan(adjust);
    const k = Math.max(64 / w, 64 / h0);
    ctx.filter = plan?.filter || 'none';
    try { ctx.drawImage(frame, (64 - w * k) / 2, (64 - h0 * k) / 2, w * k, h0 * k); } catch { /* not drawable yet */ }
    ctx.filter = 'none';
  }

  // Volume up to 400%: quiet phone recordings often need more than unity gain (the export clips at full scale).
  audioTab(c) {
    this.sec(this.slider('vp.volume', Math.round(c.volume * 100), { min: 0, max: 400, step: 5, unit: '%' }, (v) => this.upd(c.id, (x) => { x.volume = v / 100; }, t('vp.h.volume'), 'vol:' + c.id)),
      field('vp.mute', toggle(c.muted, (v) => this.upd(c.id, (x) => { x.muted = v; }, t('vp.h.mute')))),
      this.slider('vp.fadeIn', c.fadeIn, { min: 0, max: 10, step: 0.1, fmt: (v) => secs(v, 1) }, (v) => this.upd(c.id, (x) => { x.fadeIn = v; }, t('vp.h.fade'), 'fi:' + c.id)),
      this.slider('vp.fadeOut', c.fadeOut, { min: 0, max: 10, step: 0.1, fmt: (v) => secs(v, 1) }, (v) => this.upd(c.id, (x) => { x.fadeOut = v; }, t('vp.h.fade'), 'fo:' + c.id)));
  }

  fadeTab(c, e) {
    const app = this.app;
    this.sec(h('h3', { class: 'vp-insp-h' }, t('vp.insp.videoFades')),
      this.slider('vp.vfadeIn', c.vfadeIn, { min: 0, max: 5, step: 0.1, fmt: (v) => secs(v, 1) }, (v) => this.upd(c.id, (x) => { x.vfadeIn = v; }, t('vp.h.fade'), 'vfi:' + c.id)),
      this.slider('vp.vfadeOut', c.vfadeOut, { min: 0, max: 5, step: 0.1, fmt: (v) => secs(v, 1) }, (v) => this.upd(c.id, (x) => { x.vfadeOut = v; }, t('vp.h.fade'), 'vfo:' + c.id)));
    if (e.index < app.L.main.length - 1) {
      this.sec(h('h3', { class: 'vp-insp-h' }, t('vp.insp.toNext')), h('button', { type: 'button', class: 'ed-btn', onclick: () => app.select(c.id + ':t') }, iconEl('transition'),
        e.tOut ? `${t('vp.tr.' + e.tOut.type)} · ${e.xOut} s` : t('vp.tl.addTransition')));
    }
  }

  // --- transitions -------------------------------------------------------------------------------------------------

  transition(id) {
    const app = this.app;
    const e = app.L.main.find((x) => x.clip.id === id);
    if (!e) { this.project(); return; }
    const c = e.clip, cur = c.transition?.type || 'none';
    this.head('transition', t('vp.insp.transition'), t('vp.insp.between', { a: e.index + 1, b: e.index + 2 }), [this.act('close', 'vp.deselect', () => app.select(null))]);
    const grid = h('div', { class: 'vp-trs', role: 'radiogroup', 'aria-label': t('vp.insp.transition') });
    for (const k of ['none', ...TRANSITIONS]) {
      grid.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(cur === k), class: 'vp-tr' + (cur === k ? ' vp-on' : ''),
        onclick: () => this.upd(id, (x) => { x.transition = k === 'none' ? null : { type: k, duration: x.transition?.duration || 0.5 }; }, t('vp.h.transition')) },
      h('span', { class: 'vp-tr-ic', html: trIcon(k) }), h('span', {}, t('vp.tr.' + k))));
    }
    this.sec(grid);
    if (c.transition) {
      this.sec(this.slider('vp.insp.trDuration', c.transition.duration, { min: 0.1, max: 3, step: 0.1, fmt: (v) => secs(v, 1) }, (v) => this.upd(id, (x) => { x.transition.duration = v; }, t('vp.h.transition'), 'tr:' + id)),
        e.xOut < c.transition.duration ? h('p', { class: 'ed-hint ed-hint-warn' }, t('vp.insp.trClamped', { d: e.xOut })) : null,
        h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => app.edit((p) => { p.main.slice(0, -1).forEach((x) => { x.transition = { ...c.transition }; }); }, t('vp.h.transitionAll'), null, { from: 'inspector' }) }, iconEl('copy'), t('vp.insp.applyAllCuts')));
    }
    this.sec(h('p', { class: 'ed-hint' }, t('vp.insp.trHint')));
  }

  // --- overlays ----------------------------------------------------------------------------------------------------

  overlay(it) {
    const app = this.app;
    const icon = { text: 'type', emoji: 'star', image: 'image', drawing: 'edit' }[it.type];
    this.head(icon, t('vp.kind.' + it.type), `${fmtTime(it.start)}–${fmtTime(it.end)}`, [
      this.act('copy', 'vp.duplicate', () => app.duplicate()), this.act('trash', 'vp.delete', () => app.remove(), true), this.act('close', 'vp.deselect', () => app.select(null))]);
    const first = { text: { v: 'content', l: 'vp.tab.text', icon: 'type' }, emoji: { v: 'content', l: 'vp.tab.sticker', icon: 'star' }, image: { v: 'content', l: 'vp.tab.picture', icon: 'image' }, drawing: { v: 'content', l: 'vp.tab.brush', icon: 'edit' } }[it.type];
    const tabs = [first];
    if (it.type === 'text') tabs.push({ v: 'style', l: 'vp.tab.style', icon: 'palette' });
    tabs.push({ v: 'motion', l: 'vp.tab.motion', icon: 'zap' }, { v: 'place', l: 'vp.tab.place', icon: 'move' });
    const tab = this.tabbar('ov-' + it.type, tabs);
    if (tab === 'content') this[it.type + 'Tab'](it);
    else if (tab === 'style') this.styleTab(it);
    else if (tab === 'motion') this.motionTab(it);
    else this.placeTab(it);
  }

  textTab(it) {
    const ta = textInput(it.text, (v) => this.upd(it.id, (x) => { x.text = v || ' '; }, t('vp.h.text'), 'text:' + it.id), { multiline: true, dir: 'auto', rows: 3, 'aria-label': t('vp.tab.text'), class: 'ed-input ed-textarea vp-text-in' });
    ta.dataset.focus = 'text';
    const font = h('select', { class: 'ed-input ed-select', 'aria-label': t('vp.insp.font') }, Object.entries(FONTS).map(([k, f]) => h('option', { value: k, selected: it.font === k, style: { fontFamily: f.css } }, t('vp.font.' + k))));
    font.addEventListener('change', () => this.upd(it.id, (x) => { x.font = font.value; }, t('vp.h.font')));
    const style = h('div', { class: 'ap-row' },
      this.toggleBtn('bold', 'vp.insp.bold', it.bold, (v) => this.upd(it.id, (x) => { x.bold = v; }, t('vp.h.font'))),
      this.toggleBtn('italic', 'vp.insp.italic', it.italic, (v) => this.upd(it.id, (x) => { x.italic = v; }, t('vp.h.font'))),
      h('span', { class: 'ed-spacer' }),
      seg(['left', 'center', 'right'].map((v) => ({ v, l: 'vp.align.' + v, icon: 'align' + v[0].toUpperCase() + v.slice(1), iconOnly: true })), it.align, (v) => this.upd(it.id, (x) => { x.align = v; }, t('vp.h.align')), 'vp.insp.align'));
    this.sec(field('vp.tab.text', ta), field('vp.insp.font', font), style,
      this.slider('vp.insp.size', Math.round(it.size * 1000) / 10, { min: 1, max: 30, step: 0.5, unit: '%' }, (v) => this.upd(it.id, (x) => { x.size = v / 100; }, t('vp.h.size'), 'size:' + it.id)),
      field('vp.color', this.colorRow(it.color, (c, live) => this.upd(it.id, (x) => { x.color = c; }, t('vp.h.color'), live ? 'col:' + it.id : null))));
    this.sec(h('div', { class: 'vp-presets' }, TEXT_STYLES.map((s) => h('button', { type: 'button', class: 'vp-tstyle', style: s.css, onclick: () => this.upd(it.id, (x) => { Object.assign(x, JSON.parse(JSON.stringify(s.set))); }, t('vp.h.style')) }, 'Aa'))));
  }

  styleTab(it) {
    this.sec(h('h3', { class: 'vp-insp-h' }, t('vp.insp.outline')),
      field('vp.color', this.colorRow(it.stroke.color, (c, live) => this.upd(it.id, (x) => { x.stroke.color = c; if (!x.stroke.width) x.stroke.width = 0.08; }, t('vp.h.style'), live ? 'sc:' + it.id : null))),
      this.slider('vp.insp.outlineW', Math.round(it.stroke.width * 100), { min: 0, max: 30, unit: '%' }, (v) => this.upd(it.id, (x) => { x.stroke.width = v / 100; }, t('vp.h.style'), 'sw:' + it.id)),
      field('vp.insp.shadow', toggle(it.shadow, (v) => this.upd(it.id, (x) => { x.shadow = v; }, t('vp.h.style')))));
    this.sec(h('h3', { class: 'vp-insp-h' }, t('vp.insp.box')),
      field('vp.color', this.colorRow(it.box.color, (c, live) => this.upd(it.id, (x) => { x.box.color = c; if (!x.box.opacity) x.box.opacity = 0.6; }, t('vp.h.style'), live ? 'bc:' + it.id : null))),
      this.slider('vp.insp.boxOpacity', Math.round(it.box.opacity * 100), { min: 0, max: 100, unit: '%' }, (v) => this.upd(it.id, (x) => { x.box.opacity = v / 100; }, t('vp.h.style'), 'bo:' + it.id)));
    this.sec(this.slider('vp.insp.opacity', Math.round(it.opacity * 100), { min: 0, max: 100, unit: '%' }, (v) => this.upd(it.id, (x) => { x.opacity = v / 100; }, t('vp.h.style'), 'op:' + it.id)));
  }

  emojiTab(it) {
    const grid = h('div', { class: 'vp-emoji', role: 'radiogroup', 'aria-label': t('vp.tab.sticker') }, EMOJI.map((e) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(it.emoji === e), class: it.emoji === e ? 'vp-on' : '', onclick: () => this.upd(it.id, (x) => { x.emoji = e; }, t('vp.h.sticker')) }, e)));
    this.sec(grid, this.slider('vp.insp.size', Math.round(it.size * 100), { min: 3, max: 80, unit: '%' }, (v) => this.upd(it.id, (x) => { x.size = v / 100; }, t('vp.h.size'), 'size:' + it.id)),
      this.slider('vp.insp.opacity', Math.round(it.opacity * 100), { min: 0, max: 100, unit: '%' }, (v) => this.upd(it.id, (x) => { x.opacity = v / 100; }, t('vp.h.style'), 'op:' + it.id)));
  }

  imageTab(it) {
    const app = this.app;
    const m = app.p.media.find((x) => x.id === it.media);
    this.sec(h('div', { class: 'vp-insp-file' }, iconEl('image'), h('span', {}, m?.name || '')),
      this.slider('vp.insp.width', Math.round(it.w * 100), { min: 5, max: 150, unit: '%' }, (v) => this.upd(it.id, (x) => { x.w = v / 100; }, t('vp.h.size'), 'w:' + it.id)),
      this.slider('vp.insp.opacity', Math.round(it.opacity * 100), { min: 0, max: 100, unit: '%' }, (v) => this.upd(it.id, (x) => { x.opacity = v / 100; }, t('vp.h.style'), 'op:' + it.id)),
      h('button', { type: 'button', class: 'ed-btn', onclick: () => app.editPicture(it.id) }, iconEl('edit'), t('vp.insp.paint')));
  }

  drawingTab(it) {
    const app = this.app, b = app.brush();
    const on = app.drawMode();
    this.sec(h('button', { type: 'button', class: 'ed-btn' + (on ? ' ed-primary' : ''), 'aria-pressed': String(on), onclick: () => app.setDrawMode(!on) }, iconEl('edit'), t(on ? 'vp.insp.drawing' : 'vp.insp.drawMore')),
      field('vp.brush.tool', seg(['pen', 'marker', 'neon'].map((v) => ({ v, l: 'vp.brush.' + v })), b.tool, (v) => app.setBrush({ tool: v }))),
      field('vp.color', this.colorRow(b.color, (c) => app.setBrush({ color: c }))),
      this.slider('vp.brush.size', Math.round(b.width * 1000), { min: 2, max: 40 }, (v) => app.setBrush({ width: v / 1000 }, true)),
      h('p', { class: 'ed-hint' }, t('vp.insp.strokes', { n: it.strokes.length })),
      h('div', { class: 'ap-row' },
        h('button', { type: 'button', class: 'ed-btn ed-sm', disabled: !it.strokes.length, onclick: () => this.upd(it.id, (x) => { x.strokes.pop(); }, t('vp.h.draw')) }, iconEl('undo'), t('vp.insp.lastStroke')),
        h('button', { type: 'button', class: 'ed-btn ed-sm ed-danger', disabled: !it.strokes.length, onclick: () => this.upd(it.id, (x) => { x.strokes = []; }, t('vp.h.draw')) }, iconEl('trash'), t('ap.clear'))));
    this.sec(this.slider('vp.insp.opacity', Math.round(it.opacity * 100), { min: 0, max: 100, unit: '%' }, (v) => this.upd(it.id, (x) => { x.opacity = v / 100; }, t('vp.h.style'), 'op:' + it.id)));
  }

  motionTab(it) {
    const app = this.app;
    const animSel = (k) => {
      const list = ANIMS.filter((a) => a !== 'typewriter' || (it.type === 'text' && k === 'animIn'));
      return select(list.map((a) => ({ v: a, l: 'vp.anim.' + a })), it[k].type, (v) => this.upd(it.id, (x) => { x[k].type = v; }, t('vp.h.anim')));
    };
    const dur = (k) => this.slider('vp.insp.animDur', it[k].duration, { min: 0.1, max: 2, step: 0.05, fmt: (v) => secs(v, 2) }, (v) => this.upd(it.id, (x) => { x[k].duration = v; }, t('vp.h.anim'), k + it.id));
    this.sec(field('vp.insp.animIn', animSel('animIn')), dur('animIn'), field('vp.insp.animOut', animSel('animOut')), dur('animOut'));
    this.sec(h('div', { class: 'vp-range2' },
      field('vp.insp.start', this.numInput(it.start, (v) => this.upd(it.id, (x) => { x.start = r3(Math.min(v, x.end - 0.1)); }, t('vp.h.trim')))),
      field('vp.insp.end', this.numInput(it.end, (v) => this.upd(it.id, (x) => { x.end = r3(Math.max(v, x.start + 0.1)); }, t('vp.h.trim'))))),
    h('div', { class: 'ap-row' },
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => app.trimToPlayhead('start') }, iconEl('markIn'), t('vp.insp.startHere')),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => app.trimToPlayhead('end') }, iconEl('markOut'), t('vp.insp.endHere'))));
  }

  placeTab(it) {
    this.sec(this.slider('vp.insp.x', Math.round(it.x * 100), { min: 0, max: 100, unit: '%' }, (v) => this.upd(it.id, (x) => { x.x = v / 100; }, t('vp.h.move'), 'x:' + it.id)),
      this.slider('vp.insp.y', Math.round(it.y * 100), { min: 0, max: 100, unit: '%' }, (v) => this.upd(it.id, (x) => { x.y = v / 100; }, t('vp.h.move'), 'y:' + it.id)),
      this.slider('vp.insp.scale', Math.round(it.scale * 100), { min: 10, max: 500, unit: '%' }, (v) => this.upd(it.id, (x) => { x.scale = v / 100; }, t('vp.h.scale'), 'sc:' + it.id)),
      this.slider('vp.insp.rotation', Math.round(it.rotation), { min: -180, max: 180, unit: '°' }, (v) => this.upd(it.id, (x) => { x.rotation = v; }, t('vp.h.rotate'), 'rot:' + it.id)),
      h('div', { class: 'ap-row' },
        h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => this.upd(it.id, (x) => { x.x = 0.5; x.y = 0.5; }, t('vp.h.move')) }, iconEl('target'), t('vp.insp.center')),
        h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => this.upd(it.id, (x) => { x.scale = 1; x.rotation = 0; }, t('vp.h.scale')) }, iconEl('refresh'), t('ap.reset'))),
      h('p', { class: 'ed-hint' }, t('vp.insp.placeHint')));
  }

  // --- audio clips -------------------------------------------------------------------------------------------------

  audioClip(c) {
    const app = this.app;
    const m = app.p.media.find((x) => x.id === c.media);
    this.head('music', t('vp.kind.audio'), `${m?.name || ''} · ${fmtTime(c.out - c.in)}`, [
      this.act('split', 'vp.split', () => app.splitSelected()), this.act('copy', 'vp.duplicate', () => app.duplicate()), this.act('trash', 'vp.delete', () => app.remove(), true), this.act('close', 'vp.deselect', () => app.select(null))]);
    this.audioTab(c);
    const dur = m?.duration || c.out;
    this.sec(field('vp.insp.start', this.numInput(c.start, (v) => this.upd(c.id, (x) => { x.start = r3(v); }, t('vp.h.move')))),
      h('div', { class: 'vp-range2' },
        field('vp.insp.srcIn', this.numInput(c.in, (v) => this.upd(c.id, (x) => { x.in = r3(Math.min(v, x.out - 0.1)); }, t('vp.h.trim')), { max: dur })),
        field('vp.insp.srcOut', this.numInput(c.out, (v) => this.upd(c.id, (x) => { x.out = r3(Math.max(v, x.in + 0.1)); }, t('vp.h.trim')), { max: dur }))),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => this.upd(c.id, (x) => { x.start = r3(app.time()); }, t('vp.h.move')) }, iconEl('markIn'), t('vp.insp.startHere')));
  }
}

const TEXT_STYLES = [
  { css: { color: '#fff', textShadow: '1px 1px 0 #000' }, set: { color: '#ffffff', stroke: { color: '#000000', width: 0 }, shadow: true, box: { color: '#000000', opacity: 0 }, font: 'sans', bold: true } },
  { css: { color: '#fff', WebkitTextStroke: '1px #000' }, set: { color: '#ffffff', stroke: { color: '#000000', width: 0.12 }, shadow: false, box: { color: '#000000', opacity: 0 }, font: 'impact', bold: false } },
  { css: { color: '#000', background: '#fff' }, set: { color: '#111111', stroke: { color: '#000000', width: 0 }, shadow: false, box: { color: '#ffffff', opacity: 1 }, font: 'sans', bold: true } },
  { css: { color: '#fff', background: '#000c' }, set: { color: '#ffffff', stroke: { color: '#000000', width: 0 }, shadow: false, box: { color: '#000000', opacity: 0.7 }, font: 'sans', bold: true } },
  { css: { color: '#ffcc00', textShadow: '1px 1px 0 #000' }, set: { color: '#ffcc00', stroke: { color: '#000000', width: 0.08 }, shadow: true, box: { color: '#000000', opacity: 0 }, font: 'rounded', bold: true } },
  { css: { color: '#ff2d92', fontFamily: 'Georgia, serif', fontStyle: 'italic' }, set: { color: '#ff2d92', stroke: { color: '#ffffff', width: 0.06 }, shadow: false, box: { color: '#000000', opacity: 0 }, font: 'serif', bold: true, italic: true } },
];

// Small pictograms of the transitions (24 x 16, two frames A / B).
function trIcon(k) {
  const A = 'currentColor', B = 'var(--ed-accent)';
  const r = (x, y, w, hh, f, o = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${f}" opacity="${o}" rx="1"/>`;
  const box = (inner) => `<svg viewBox="0 0 24 16" width="36" height="24" aria-hidden="true"><rect x=".5" y=".5" width="23" height="15" rx="2" fill="none" stroke="currentColor" opacity=".35"/>${inner}</svg>`;
  switch (k) {
    case 'none': return box(`${r(2, 2, 9, 12, A, 0.5)}${r(13, 2, 9, 12, B)}`);
    case 'fade': return box(`${r(2, 2, 20, 12, A, 0.35)}${r(2, 2, 20, 12, B, 0.55)}`);
    case 'fadeblack': return box(`${r(2, 2, 7, 12, A, 0.5)}${r(9, 2, 6, 12, '#000')}${r(15, 2, 7, 12, B)}`);
    case 'fadewhite': return box(`${r(2, 2, 7, 12, A, 0.5)}${r(9, 2, 6, 12, '#fff')}${r(15, 2, 7, 12, B)}`);
    case 'wipeleft': return box(`${r(2, 2, 12, 12, A, 0.5)}${r(14, 2, 8, 12, B)}<path d="M13 8h-6M9 6l-2 2 2 2" stroke="#fff" fill="none"/>`);
    case 'wiperight': return box(`${r(2, 2, 8, 12, B)}${r(10, 2, 12, 12, A, 0.5)}<path d="M11 8h6M15 6l2 2-2 2" stroke="#fff" fill="none"/>`);
    case 'wipeup': return box(`${r(2, 2, 20, 7, A, 0.5)}${r(2, 9, 20, 5, B)}<path d="M12 12V5M10 7l2-2 2 2" stroke="#fff" fill="none"/>`);
    case 'wipedown': return box(`${r(2, 2, 20, 5, B)}${r(2, 7, 20, 7, A, 0.5)}<path d="M12 4v7M10 9l2 2 2-2" stroke="#fff" fill="none"/>`);
    case 'slideleft': return box(`${r(-4, 2, 12, 12, A, 0.5)}${r(10, 2, 12, 12, B)}<path d="M18 8h-5M15 6l-2 2 2 2" stroke="#fff" fill="none"/>`);
    case 'slideright': return box(`${r(2, 2, 12, 12, B)}${r(16, 2, 12, 12, A, 0.5)}<path d="M6 8h5M9 6l2 2-2 2" stroke="#fff" fill="none"/>`);
    case 'slideup': return box(`${r(2, -2, 20, 6, A, 0.5)}${r(2, 6, 20, 8, B)}<path d="M12 12V8M10 10l2-2 2 2" stroke="#fff" fill="none"/>`);
    case 'slidedown': return box(`${r(2, 2, 20, 8, B)}${r(2, 12, 20, 6, A, 0.5)}<path d="M12 4v4M10 6l2 2 2-2" stroke="#fff" fill="none"/>`);
    case 'circleopen': return box(`${r(2, 2, 20, 12, A, 0.5)}<circle cx="12" cy="8" r="4.5" fill="${B}"/>`);
    case 'circleclose': return box(`${r(2, 2, 20, 12, B)}<circle cx="12" cy="8" r="4.5" fill="${A}" opacity=".5"/>`);
    case 'zoomin': return box(`${r(2, 2, 20, 12, A, 0.3)}${r(7, 5, 10, 6, B)}<path d="M5 4l3 2M19 4l-3 2M5 12l3-2M19 12l-3-2" stroke="currentColor"/>`);
    default: return box('');
  }
}
