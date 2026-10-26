// video-processor/main.js - the video processor: a TikTok / Instagram-style editor of a project (timeline/)
// with two modes. Edit: the timeline (main track of clips and stills with transitions, overlay rows of text,
// stickers, pictures and drawings, audio rows), the preview with direct manipulation and drawing, the inspector.
// Transform: the same project described as ffmpeg commands for bash or cmd.exe. Media import, slideshow from music
// and pictures, undo / redo, project files (JSON or ZIP with media), export to WebM / MP4, audio and frames.
// Everything stays local.
//
// Architecture: one plain-JSON project (timeline/model.js) is the single source of truth. Every change goes through
// edit(): mutate -> normalizeProject (repair invariants) -> history snapshot -> changed() (recompute the layout L and
// re-render the views). Views (stage, timeline, inspector, commands) never talk to each other; they call `app`, the
// narrow interface below, which keeps the dependency graph a star around this module.
// Media bytes live outside the project (MediaStore keyed by media id): the project stays small enough to snapshot
// for undo on every edit and to save as JSON; media are re-linked by name when a project is opened without them.
// The strings import comes after the UI imports on purpose: ES modules evaluate in import order, and nothing below
// calls t() before strings.js has registered its keys at the end of the import phase.
import { button, card, dropZone, seg, startApp, t, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { downloadBlob, fmtBytes, pickFiles, safeFileName } from '../ui/files.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import './strings.js';
import { activeAt, frameSize, isStill, layout, newProject, normalizeProject } from '../timeline/model.js';
import * as E from '../timeline/edit.js';
import { History } from '../timeline/history.js';
import { isZip, packProject, parseProject, unpackProject } from '../timeline/file.js';
import { ACCEPT, MediaStore } from './media.js';
import { Compositor } from './compose.js';
import { Engine } from './engine.js';
import { Stage } from './stage.js';
import { TimelineView } from './tlview.js';
import { Inspector } from './inspector.js';
import { CommandsPanel } from './commands.js';
import { editImage } from './painter.js';
import { openSlideshow } from './slides.js';
import { openExport } from './exportdlg.js';
import { capabilities } from './export.js';
import { renderInfo } from './info.js';
import { fmtTime } from './geometry.js';

const LOGO = 'M3 6h18v12H3zM3 9.5h18M7 6l2 3.5M12 6l2 3.5M17 6l2 3.5M10.5 12v4l3.5-2z';
addIcons({
  skipBack: 'M19 20 9 12l10-8zM5 19V5', skipFwd: 'M5 4l10 8-10 8zM19 5v14',
  frameBack: 'M15 6l-6 6 6 6M6 6v12', frameFwd: 'M9 6l6 6-6 6M18 6v12',
  volume: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  volumeOff: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  rotL: 'M2.5 2v6h6M2.66 15.57a10 10 0 1 0 .57-8.38', rotR: 'M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38',
  flipV: 'M3 12h18M7 8l5-4 5 4zM7 16l5 4 5-4z',
  split: 'M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4',
  markIn: 'M7 4v16M7 12h11M14 8l4 4-4 4', markOut: 'M17 4v16M17 12H6M10 8l-4 4 4 4',
  transition: 'M3 5l9 7-9 7zM21 5l-9 7 9 7z',
  highlight: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  eraser: 'M7 21h10M5.5 15.5l7-7 6 6-5 5H8.5zM12.5 8.5l3-3a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8l-3 3',
  arrowRight: 'M5 12h14M13 6l6 6-6 6', square: 'M4 4h16v16H4z', circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z', italic: 'M19 4h-9M14 20H5M15 4 9 20',
  alignLeft: 'M3 6h18M3 12h12M3 18h16', alignCenter: 'M3 6h18M6 12h12M4 18h16', alignRight: 'M3 6h18M9 12h12M5 18h16',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3M6 3h4v8a2 2 0 0 0 4 0V3h4M6 7h4M14 7h4',
  fit: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
});

// Default command shell follows the OS (cmd.exe on Windows, bash elsewhere); the user can switch.
const IS_WIN = /Win/i.test(navigator.platform || navigator.userAgent || '');
const S = {
  project: newProject({ name: 'Untitled', aspect: '9:16' }),
  L: null,
  // Up to 200 undo steps; edits with the same merge key within 900 ms collapse into one step (slider drags, typing).
  history: new History(200, 900),
  sel: null,
  mode: 'edit',
  draw: false,
  brush: { tool: 'pen', color: '#ff3b30', width: 0.008 },
  cmd: { shell: IS_WIN ? 'cmd' : 'bash', mode: 'single' },
  out: { format: null, short: 1080, fps: 0, quality: 'med', bitrate: 0, audio: 'mp3', mp3: 192, withAudio: true },
  caps: { formats: [], audioFormats: ['wav', 'mp3'] },
  playing: false,
  saved: null,
  hover: null,
};
S.L = layout(S.project);
S.history.reset(S.project);
S.saved = JSON.stringify(S.project);

// Background media work (thumbnails, waveforms) reports progress; the timeline and the bin repaint to show it.
const store = new MediaStore((id, what) => {
  if (what === 'thumbs' || what === 'peaks') { tl?.render(); refreshBin(); }
});
const comp = new Compositor();
const U = {};
let tl, inspector, commands, stage, engine;

// --- the application interface the views use ---------------------------------------------------------------------

const app = {
  get p() { return S.project; },
  get L() { return S.L; },
  store, comp,
  get engine() { return engine; },
  sel: () => S.sel,
  time: () => engine?.time || 0,
  playing: () => S.playing,
  seek: (tt) => engine.seek(tt),
  pause: () => engine.pause(),
  missing: (id) => !store.has(id),
  drawMode: () => S.draw,
  brush: () => S.brush,
  caps: () => S.caps,
  out: () => S.out,
  hasAudio: () => S.project.audio.length > 0 || S.L.main.some((e) => e.media?.hasAudio && !isStill(e.media)),
  cmdOpts: () => ({ ...S.cmd, format: cmdFormat(), short: S.out.short, quality: S.out.quality, bitrate: S.out.bitrate }),
  select, edit, live, commit, render: changed, undo, redo,
  importMedia, addText, addSticker, slideshow: () => openSlideshow(app),
  duplicate, remove, splitSelected, trimToPlayhead, freezeFrame, editPicture, openItem, replaceProject,
  setDrawMode, setBrush, setMode, grabFrame,
  setCmdOpts(patch) { Object.assign(S.cmd, patch); if (patch.format) S.out.format = mapFormatBack(patch.format); commands.render(); },
  outChanged() { commands.schedule(); },
  hoverRef(ref) { if (S.hover !== ref) { S.hover = ref; tl.highlight(ref); } },
  exported(blob, name) { app.lastExport = { blob, name }; },
  onZoom() { if (U.zoom) U.zoom.value = String(Math.round(Math.log(tl.pps) * 100)); },
};
// Exposed for automated end-to-end checks; holds no secrets (everything is local anyway).
window.vpApp = app; // a handle for automated checks (state of the open project)

// The ffmpeg description follows the export format (a real-time fallback maps to its codec).
// The real-time fallback formats have no ffmpeg equivalent id; the description maps them to the matching codec.
function cmdFormat() {
  const f = S.out.format || '';
  if (/^(mp4|webm)-(h264|vp9|vp8|av1)$/.test(f)) return f;
  return f === 'rec-mp4' ? 'mp4-h264' : S.cmd.format || 'mp4-h264';
}
function mapFormatBack(f) { return S.caps.formats.some((x) => x.id === f) ? f : S.out.format; }

// --- edits and history -------------------------------------------------------------------------------------------

// Central refresh. A selection pointing at a deleted element is dropped here (single place, so no view can show a
// stale selection). During live drags (opts.live) the expensive parts (inspector, ffmpeg description) are skipped;
// the inspector is also skipped when the change came from the inspector itself, so its focused control survives.
function changed(opts = {}) {
  S.L = layout(S.project);
  if (S.sel && !S.sel.endsWith(':t') && !E.find(S.project, S.sel)) S.sel = null;
  if (S.sel?.endsWith(':t') && !S.project.main.some((c) => c.id === S.sel.slice(0, -2))) S.sel = null;
  engine.setProject(S.project, S.L);
  tl.render();
  if (opts.from !== 'inspector' && !opts.live) inspector.render();
  if (!opts.live) commands.schedule();
  refreshBar();
  document.querySelector('main.vp-main')?.classList.toggle('vp-has', S.L.total > 0);
  if (opts.media) refreshBin();
  if (opts.aspect) stage.layout();
}

/** One undoable change: fn(project) mutates it; merge: successive edits with the same key within a moment merge. */
// fn may return a value (e.g. the id of a created element), passed through to the caller.
function edit(fn, label = '', merge = null, opts = {}) {
  const aspect = S.project.aspect;
  const r = fn(S.project);
  S.project = normalizeProject(S.project);
  E.fixRows(S.project);
  S.history.commit(S.project, label, merge);
  changed({ ...opts, aspect: aspect !== S.project.aspect, media: true });
  return r;
}

/** A change while dragging (no history entry until commit). */
// Drag frames mutate the project directly without history; commit() records the final state as one step.
function live(fn) {
  fn(S.project);
  changed({ live: true });
}

function commit(label) {
  S.project = normalizeProject(S.project);
  E.fixRows(S.project);
  S.history.commit(S.project, label);
  changed({});
}

function restore(p) {
  if (!p) return;
  const aspect = S.project.aspect;
  S.project = normalizeProject(p);
  changed({ media: true, aspect: aspect !== S.project.aspect });
}
function undo() { restore(S.history.undo()); }
function redo() { restore(S.history.redo()); }

// Opening a file resets history and the "saved" baseline; a generated project (slideshow) is an undoable edit.
function replaceProject(p, entries = [], label = '', resetHistory = false) {
  for (const [id, entry] of entries) store.attach(id, entry);
  S.project = normalizeProject(p);
  S.sel = null;
  if (resetHistory) { S.history.reset(S.project); S.saved = JSON.stringify(S.project); } else S.history.commit(S.project, label);
  changed({ media: true, aspect: true });
  engine.seek(0);
  requestAnimationFrame(() => tl.fit());
}

// --- selection ---------------------------------------------------------------------------------------------------

// Selecting something off-screen in time moves the playhead into it (unless playing or explicitly kept), so the
// preview always shows what the inspector edits. Leaving a drawing ends draw mode.
function select(id, opts = {}) {
  if (S.draw && !opts.keepDraw) {
    const f = id && E.find(S.project, id);
    if (!(f?.list === 'overlays' && f.item.type === 'drawing')) setDrawMode(false, true);
  }
  S.sel = id || null;
  // Show what was picked: the playhead moves into an element that is off screen.
  if (id && (opts.from === 'timeline' || opts.from === 'commands' || !opts.from) && !opts.keepTime) {
    const tt = engine.time;
    const f = !id.endsWith(':t') ? E.find(S.project, id) : null;
    let range = null;
    if (id.endsWith(':t')) { const e = S.L.main.find((x) => x.clip.id === id.slice(0, -2)); if (e) range = [e.end - Math.max(e.xOut, 0.001), e.end]; }
    else if (f?.list === 'main') { const e = S.L.main[f.index]; range = [e.start, e.end]; }
    else if (f) range = [f.item.start, f.item.end ?? f.item.start + (f.item.out - f.item.in)];
    if (range && (tt < range[0] || tt >= range[1]) && !S.playing) engine.seek(id.endsWith(':t') ? (range[0] + range[1]) / 2 : range[0] + 0.001);
  }
  tl.render();
  inspector.render();
  commands.render();
  stage.updateSel();
  engine.requestDraw();
  refreshBar();
}

function openItem(id) {
  select(id, { keepTime: true });
  if (S.mode !== 'edit') setMode('edit');
  const f = E.find(S.project, id);
  if (f?.list === 'overlays') {
    inspector.tabs['ov-' + f.item.type] = 'content';
    inspector.render();
    const ta = inspector.el.querySelector('[data-focus="text"]');
    if (ta) { ta.focus(); ta.select(); }
  }
}

// --- adding things -----------------------------------------------------------------------------------------------

function importMedia(kind) {
  pickFiles({ accept: kind === 'audio' ? 'audio/*,video/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.flac,.weba' : ACCEPT, multiple: true }).then((files) => openFiles(files, { kind }));
}

// Media are decoded first (outside the edit), then added in one edit = one undo step for the whole import. A file
// whose name and kind match a missing media of the project relinks it instead of adding a duplicate.
async function openFiles(files, opts = {}) {
  files = [...files];
  const proj = files.find((f) => /\.(json|zip|vproj)$/i.test(f.name));
  if (proj) { await openProjectFile(proj); files = files.filter((f) => f !== proj); }
  if (!files.length) return;
  U.status && (U.status.textContent = t('vp.loading'));
  const read = [];
  for (const f of files) {
    try { read.push(await store.read(f)); } catch (e) { toast(t('vp.openErr', { name: f.name, msg: e.message || e }), 'error'); }
  }
  if (U.status) U.status.textContent = '';
  if (!read.length) return;
  const at = engine.time;
  let lastId = null;
  edit((p) => {
    for (const { info, entry } of read) {
      // A file with the name of a missing media of the project relinks it.
      const miss = p.media.find((m) => m.name === info.name && m.kind === info.kind && !store.has(m.id));
      if (miss) { store.attach(miss.id, entry); continue; }
      const m = E.addMedia(p, info);
      store.attach(m.id, entry);
      if (opts.bin) continue;
      if (m.kind === 'audio') {
        const c = E.addAudio(p, m.id, p.audio.length ? Math.round(at * 1000) / 1000 : 0, 0);
        lastId = c?.id || lastId;
      } else {
        const c = E.addClip(p, m.id, { duration: 3 });
        lastId = c?.id || lastId;
      }
    }
  }, t('vp.h.import'));
  toast(t('vp.added', { n: read.length }), 'ok');
  if (lastId) select(lastId, { keepTime: true });
  requestAnimationFrame(() => tl.fit());
}

function addText() {
  const tt = engine.time;
  const id = edit((p) => E.addOverlay(p, { type: 'text', text: t('vp.newText'), start: Math.round(tt * 1000) / 1000, end: Math.round((tt + 3) * 1000) / 1000, y: 0.5, stroke: { color: '#000000', width: 0.06 } })?.id, t('vp.h.addText'));
  if (id) openItem(id);
}

function addSticker() {
  const tt = engine.time;
  const id = edit((p) => E.addOverlay(p, { type: 'emoji', emoji: '🔥', start: Math.round(tt * 1000) / 1000, end: Math.round((tt + 3) * 1000) / 1000, x: 0.5, y: 0.35, animIn: { type: 'pop', duration: 0.35 } })?.id, t('vp.h.addSticker'));
  if (id) openItem(id);
}

// --- element actions ---------------------------------------------------------------------------------------------

// The selected element, else the main clip under the playhead.
// Actions like split / trim apply to the selection, or to the clip under the playhead when nothing is selected.
function target() {
  if (S.sel && !S.sel.endsWith(':t')) return S.sel;
  const e = activeAt(S.L, engine.time).main[0];
  return e?.clip.id || null;
}

function splitSelected() {
  const id = target();
  if (!id) return;
  const tt = engine.time;
  const parts = edit((p) => E.split(p, id, tt), t('vp.h.split'));
  if (!parts) { toast(t('vp.splitHint'), 'warn'); return; }
  select(parts[1].id, { keepTime: true });
}

function duplicate() {
  if (!S.sel || S.sel.endsWith(':t')) return;
  const id = S.sel;
  const c = edit((p) => E.duplicate(p, id), t('vp.h.duplicate'));
  if (c) select(c.id);
}

function remove() {
  if (!S.sel) return;
  const id = S.sel;
  if (id.endsWith(':t')) { edit((p) => E.setTransition(p, id.slice(0, -2), null), t('vp.h.transition')); select(null); return; }
  edit((p) => E.remove(p, id), t('vp.h.delete'));
  select(null);
}

function trimToPlayhead(edge) {
  const id = target();
  if (!id) return;
  const tt = engine.time;
  edit((p) => E.trimTo(p, id, edge, tt), t('vp.h.trim'));
}

// Generated stills get unique file names: the ffmpeg description refers to media by name.
const uniqueName = (base) => {
  let n = 1;
  while (S.project.media.some((m) => m.name === `${base}-${n}.png`)) n++;
  return `${base}-${n}.png`;
};

// Freeze frame: wait for a pending seek so the captured frame is the one at the playhead, copy it at the source's
// full resolution, optionally edit it, and insert it as a 2 s still that inherits the clip's framing and colour.
// The origin (source media + time) is stored so the ffmpeg description can extract the same frame itself.
async function freezeFrame(paint) {
  engine.pause();
  const tt = engine.time;
  const act = activeAt(S.L, tt).main;
  const e = act.find((x) => x.clip.id === S.sel) || act[0];
  if (!e || isStill(e.media)) { toast(t('vp.freezeHint'), 'warn'); return; }
  const el = engine.frameOf(e);
  if (el?.seeking) await new Promise((r) => el.addEventListener('seeked', r, { once: true }));
  const src = engine.frameOf(e);
  if (!src) { toast(t('vp.freezeHint'), 'warn'); return; }
  const c = Object.assign(document.createElement('canvas'), { width: src.videoWidth, height: src.videoHeight });
  c.getContext('2d').drawImage(src, 0, 0);
  let out = c;
  if (paint) {
    const bmp = await createImageBitmap(c);
    const r = await editImage(bmp, { title: t('vp.paint.frameTitle', { t: fmtTime(tt) }) });
    if (!r) return;
    out = Object.assign(document.createElement('canvas'), { width: r.width, height: r.height });
    out.getContext('2d').drawImage(r, 0, 0);
  }
  const time = Math.round(e.clip.in * 1000 + (tt - e.start) * e.clip.speed * 1000) / 1000;
  const { info, entry } = await store.fromCanvas(out, uniqueName(paint ? 'edited' : 'freeze'));
  info.origin = paint ? { kind: 'edited', media: e.media.id } : { kind: 'freeze', media: e.media.id, time };
  const id = edit((p) => {
    const m = E.addMedia(p, info);
    store.attach(m.id, entry);
    const still = E.insertStill(p, e.clip.id, tt, m.id, 2);
    if (still) Object.assign(still, { fit: e.clip.fit, zoom: e.clip.zoom, panX: e.clip.panX, panY: e.clip.panY, rotate: e.clip.rotate, flipH: e.clip.flipH, flipV: e.clip.flipV, adjust: { ...e.clip.adjust } });
    return still?.id;
  }, t(paint ? 'vp.h.paintFrame' : 'vp.h.freeze'));
  if (id) select(id);
}

async function editPicture(id) {
  const f = E.find(S.project, id);
  if (!f) return;
  const mid = f.item.media;
  const m = store.get(mid);
  if (!m?.bitmap) { toast(t('vp.missingMedia'), 'warn'); return; }
  const r = await editImage(m.bitmap, { title: t('vp.paint.title') });
  if (!r) return;
  const c = Object.assign(document.createElement('canvas'), { width: r.width, height: r.height });
  c.getContext('2d').drawImage(r, 0, 0);
  const { info, entry } = await store.fromCanvas(c, uniqueName('edited'));
  info.origin = { kind: 'edited', media: mid };
  edit((p) => { const nm = E.addMedia(p, info); store.attach(nm.id, entry); E.replaceMedia(p, id, nm.id); }, t('vp.h.paint'));
}

function setDrawMode(on, quiet = false) {
  S.draw = !!on;
  if (on) { engine.pause(); if (S.mode !== 'edit') setMode('edit'); }
  stage.renderDrawbar();
  stage.updateSel();
  U.drawBtn?.classList.toggle('ed-on', S.draw);
  U.drawBtn?.setAttribute('aria-pressed', String(S.draw));
  if (!quiet) inspector.render();
  if (on) toast(t('vp.drawHint'), 'info');
}

function setBrush(patch, quiet = false) {
  Object.assign(S.brush, patch);
  stage.renderDrawbar();
  if (!quiet) inspector.render();
}

function setMode(m) {
  S.mode = m;
  U.modeSeg?.set(m);
  U.side.textContent = '';
  U.sideTitle.textContent = t(m === 'cmd' ? 'vp.side.cmd' : 'vp.side.edit');
  U.side.append(m === 'cmd' ? commands.el : inspector.el);
  document.body.classList.toggle('vp-mode-cmd', m === 'cmd');
  if (m === 'cmd') { if (S.draw) setDrawMode(false, true); commands.render(); } else inspector.render();
}

// --- project files -----------------------------------------------------------------------------------------------

const isEmpty = () => !S.project.media.length && !S.project.overlays.length;
// Unsaved = differs from the JSON at the last save / open. String comparison of the whole project is cheap at this
// size and needs no change tracking.
const dirty = () => !isEmpty() && JSON.stringify(S.project) !== S.saved;

async function newFile() {
  if (dirty() && !(await confirmDialog(t('vp.new'), t('vp.discard'), t('vp.new'), true))) return;
  engine.pause();
  store.clear();
  replaceProject(newProject({ name: 'Untitled', aspect: S.project.aspect, fps: S.project.fps }), [], '', true);
}

async function openProjectFile(file) {
  if (dirty() && !(await confirmDialog(t('vp.open'), t('vp.discard'), t('vp.open'), true))) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let project, entries = [];
    if (isZip(bytes)) {
      const r = await unpackProject(bytes);
      project = r.project;
      for (const m of project.media) {
        const fl = r.files.get(m.id);
        if (!fl) continue;
        try { const x = await store.fromBytes(fl.bytes, m.name, m.mime); entries.push([m.id, x.entry]); } catch (e) { toast(t('vp.openErr', { name: m.name, msg: e.message || e }), 'error'); }
      }
    } else project = parseProject(new TextDecoder().decode(bytes));
    engine.pause();
    store.clear();
    replaceProject(project, entries, '', true);
    const missing = project.media.filter((m) => !store.has(m.id));
    if (missing.length) toast(t('vp.relink', { n: missing.length, names: missing.slice(0, 3).map((m) => m.name).join(', ') }), 'warn', null, { sticky: false });
    else toast(t('vp.opened', { name: project.name }), 'ok');
  } catch (e) { toast(t('vp.openErr', { name: file.name, msg: e.message || e }), 'error'); }
}

// Two formats: ZIP with media (self-contained, large) or JSON only (small, media relinked by name on open).
async function saveProject() {
  const withMedia = h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', checked: true });
  const size = S.project.media.reduce((a, m) => a + (store.get(m.id)?.bytes?.length || 0), 0);
  const body = h('div', { class: 'ed-fields' },
    h('label', { class: 'ed-field ed-field-check' }, withMedia, h('span', { class: 'ed-label' }, t('vp.save.withMedia', { size: fmtBytes(size) }))),
    h('p', { class: 'ed-hint' }, t('vp.save.hint')));
  const ok = await openDialog({ title: t('vp.save.title'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ap.save'), value: 'ok', primary: true }] });
  if (ok !== 'ok') return;
  const base = safeFileName(S.project.name || 'project', 'project');
  if (withMedia.checked) {
    const files = new Map();
    for (const m of S.project.media) { const e = store.get(m.id); if (e?.bytes) files.set(m.id, e.bytes); }
    const zip = await packProject(S.project, files);
    downloadBlob(new Blob([zip], { type: 'application/zip' }), `${base}.vproject.zip`);
  } else downloadBlob(new Blob([JSON.stringify(S.project, null, 1)], { type: 'application/json' }), `${base}.vproject.json`);
  S.saved = JSON.stringify(S.project);
  toast(t('vp.saved'), 'ok');
}

// Frame grabs render at export resolution through the compositor, not by copying the smaller preview canvas.
function grabFrame(type, short = 1080) {
  const { width: W, height: H } = frameSize(S.project.aspect, short);
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  comp.render(c.getContext('2d'), W, H, S.project, S.L, engine.time, engine.frameOf, engine.imageOf);
  const ext = type === 'image/png' ? 'png' : 'jpg';
  c.toBlob((b) => {
    if (!b) return;
    downloadBlob(b, `${safeFileName(S.project.name, 'frame')}-${fmtTime(engine.time).replace(/[:.]/g, '-')}.${ext}`);
    toast(t('vp.frameSaved', { w: W, h: H }), 'ok');
  }, type, 0.92);
}

function mediaInfo(id) {
  const m = S.project.media.find((x) => x.id === id);
  const e = store.get(id);
  const body = e?.probe ? renderInfo({ name: m.name, size: e.size, duration: e.duration, probe: e.probe, fixed: e.fixed })
    : h('div', { class: 'ap-kv' }, h('p', {}, `${m.name} · ${m.width} × ${m.height}${e ? ' · ' + fmtBytes(e.bytes.length) : ''}`));
  openDialog({ title: t('vp.info'), body });
}

// --- UI ----------------------------------------------------------------------------------------------------------

function iconBtn(icon, label, fn, cls = '') {
  return h('button', { type: 'button', class: 'ed-iconbtn ' + cls, title: t(label), 'aria-label': t(label), onclick: fn }, iconEl(icon));
}
function toolBtn(icon, label, fn, cls = '') {
  return h('button', { type: 'button', class: 'ed-btn vp-tb ' + cls, title: t(label), onclick: fn }, iconEl(icon), h('span', { class: 'vp-tb-l' }, t(label)));
}

// Builds the whole UI; also the language-change callback (onLang), so every label is re-translated. The engine and
// stage survive rebuilds (created once) so playback state and media elements are not lost.
function build() {
  const main = document.querySelector('main.ap-main');
  main.textContent = '';
  main.classList.add('vp-main');
  if (!stage) {
    stage = new Stage(app);
    engine = new Engine({
      canvas: stage.canvas, store, compositor: comp,
      onTime: (tt) => { tl?.setTime(tt); paintTime(tt); },
      onPlay: (pl) => { S.playing = pl; paintPlay(); },
      onDraw: () => stage.updateSel(),
      hide: () => null,
    });
  }
  tl = new TimelineView(app);
  inspector = new Inspector(app);
  commands = new CommandsPanel(app);
  // Toolbar.
  U.undoBtn = iconBtn('undo', 'vp.undo', undo);
  U.redoBtn = iconBtn('redo', 'vp.redo', redo);
  U.modeSeg = seg([{ v: 'edit', l: 'vp.mode.edit', icon: 'edit' }, { v: 'cmd', l: 'vp.mode.cmd', icon: 'terminal' }], S.mode, setMode, 'vp.mode');
  U.modeSeg.classList.add('vp-modes');
  const bar = h('div', { class: 'vp-bar', role: 'toolbar', 'aria-label': t('vp.toolbar') },
    toolBtn('file', 'vp.new', newFile), toolBtn('folder', 'vp.open', () => pickFiles({ accept: '.json,.zip,.vproj,application/json,application/zip' }).then((f) => f[0] && openProjectFile(f[0]))),
    toolBtn('save', 'ap.save', saveProject), h('span', { class: 'vp-bar-sep' }), U.undoBtn, U.redoBtn, h('span', { class: 'vp-bar-sep' }),
    toolBtn('filePlus', 'vp.add.media', () => importMedia()), toolBtn('gallery', 'vp.add.slideshow', () => openSlideshow(app)),
    h('span', { class: 'ed-spacer' }), U.modeSeg,
    h('button', { type: 'button', class: 'ed-btn ed-primary vp-tb', onclick: () => openExport(app) }, iconEl('export'), h('span', { class: 'vp-tb-l' }, t('vp.export'))));
  // Media bin.
  U.status = h('p', { class: 'ed-hint', 'aria-live': 'polite' });
  U.bin = h('ul', { class: 'vp-bin', 'aria-label': t('vp.media') });
  const binCard = card('vp.media', dropZone({ onFiles: (f) => openFiles(f), multiple: true, label: 'vp.drop', accept: ACCEPT }), U.status, U.bin);
  binCard.classList.add('vp-bin-card');
  // Stage + transport.
  U.playBtn = h('button', { type: 'button', class: 'ed-btn ed-primary vp-play', onclick: () => engine.toggle() });
  U.time = h('span', { class: 'vp-time', 'aria-live': 'off' });
  U.scrub = h('input', { type: 'range', class: 'ed-range vp-scrub', min: 0, max: 1000, step: 1, value: 0, 'aria-label': t('vp.tl.playhead') });
  U.scrub.addEventListener('input', () => { engine.pause(); engine.seek((+U.scrub.value / 1000) * S.L.total); });
  const transport = h('div', { class: 'vp-transport' },
    iconBtn('skipBack', 'vp.toStart', () => engine.seek(0)), iconBtn('frameBack', 'vp.prevFrame', () => engine.step(-1)), U.playBtn,
    iconBtn('frameFwd', 'vp.nextFrame', () => engine.step(1)), iconBtn('skipFwd', 'vp.toEnd', () => engine.seek(S.L.total)), U.time);
  U.empty = h('div', { class: 'vp-empty' }, iconEl('film'), h('p', { class: 'vp-empty-h' }, t('vp.empty')), h('p', { class: 'ed-hint' }, t('vp.emptyHint')),
    h('div', { class: 'ap-row' }, button('vp.add.media', 'filePlus', () => importMedia(), 'primary'), button('vp.add.slideshow', 'gallery', () => openSlideshow(app))));
  stage.canvas.setAttribute('aria-label', t('vp.preview'));
  const stageCard = card(null, stage.el, U.empty, U.scrub, transport);
  stageCard.classList.add('vp-stage-card');
  // Side: inspector or commands.
  U.sideTitle = h('h2', { class: 'ap-card-h' });
  U.side = h('div', { class: 'vp-side-body' });
  const sideCard = h('section', { class: 'ap-card vp-side-card' }, U.sideTitle, U.side);
  // Timeline.
  U.drawBtn = toolBtn('edit', 'vp.add.draw', () => setDrawMode(!S.draw));
  U.drawBtn.setAttribute('aria-pressed', String(S.draw));
  U.snapBtn = iconBtn('magnet', 'vp.tl.snap', () => { tl.snapOn = !tl.snapOn; U.snapBtn.classList.toggle('ed-on', tl.snapOn); U.snapBtn.setAttribute('aria-pressed', String(tl.snapOn)); }, 'ed-on');
  U.snapBtn.setAttribute('aria-pressed', 'true');
  // Logarithmic zoom slider (value = 100 * ln(pps)): equal slider steps feel like equal zoom factors.
  U.zoom = h('input', { type: 'range', class: 'ed-range vp-zoom', min: Math.round(Math.log(2) * 100), max: Math.round(Math.log(600) * 100), value: Math.round(Math.log(tl.pps) * 100), 'aria-label': t('vp.tl.zoom') });
  U.zoom.addEventListener('input', () => tl.setPps(Math.exp(+U.zoom.value / 100)));
  const tlBar = h('div', { class: 'vp-tl-bar', role: 'toolbar', 'aria-label': t('vp.timeline') },
    toolBtn('split', 'vp.split', splitSelected), iconBtn('copy', 'vp.duplicate', duplicate), iconBtn('trash', 'vp.delete', remove, 'ed-danger'),
    h('span', { class: 'vp-bar-sep' }),
    toolBtn('type', 'vp.add.text', addText), toolBtn('star', 'vp.add.sticker', addSticker), U.drawBtn, toolBtn('music', 'vp.add.music', () => importMedia('audio')),
    h('span', { class: 'ed-spacer' }), U.snapBtn, iconBtn('zoomOut', 'vp.tl.zoomOut', () => tl.zoomOut()), U.zoom, iconBtn('zoomIn', 'vp.tl.zoomIn', () => tl.zoomIn()), iconBtn('fit', 'vp.tl.fit', () => tl.fit()));
  const tlCard = h('section', { class: 'ap-card vp-tl-card' }, tlBar, tl.el, h('p', { class: 'ed-hint vp-keys' }, t('vp.keys')));
  main.append(h('p', { class: 'ap-lead' }, t('vp.lead')), bar,
    h('div', { class: 'vp-grid' }, h('div', { class: 'vp-col-media' }, binCard), h('div', { class: 'vp-col-stage' }, stageCard), h('aside', { class: 'vp-col-side', 'aria-label': t('vp.side') }, sideCard), h('div', { class: 'vp-col-tl' }, tlCard)));
  setMode(S.mode);
  stage.layout();
  changed({ media: true });
  stage.renderDrawbar();
  paintPlay();
  paintTime(engine.time);
}

function refreshBar() {
  if (!U.undoBtn) return;
  U.undoBtn.disabled = !S.history.canUndo;
  U.redoBtn.disabled = !S.history.canRedo;
  U.undoBtn.title = S.history.canUndo ? `${t('vp.undo')}: ${S.history.label}` : t('vp.undo');
  U.redoBtn.title = S.history.canRedo ? `${t('vp.redo')}: ${S.history.redoLabel}` : t('vp.redo');
  const empty = S.L.total <= 0;
  U.empty.hidden = !empty;
  stage.el.hidden = empty;
  U.scrub.hidden = empty;
  U.playBtn.closest('.vp-transport').hidden = empty;
  paintTime(engine.time);
}

function paintPlay() {
  if (!U.playBtn) return;
  U.playBtn.textContent = '';
  U.playBtn.append(iconEl(S.playing ? 'pause' : 'play'));
  U.playBtn.title = t(S.playing ? 'vp.pause' : 'vp.play');
  U.playBtn.setAttribute('aria-label', U.playBtn.title);
}

function paintTime(tt) {
  if (!U.time) return;
  U.time.textContent = `${fmtTime(tt)} / ${fmtTime(S.L.total)}`;
  U.scrub.value = String(S.L.total > 0 ? Math.round((tt / S.L.total) * 1000) : 0);
}

function refreshBin() {
  if (!U.bin) return;
  U.bin.textContent = '';
  for (const m of S.project.media) {
    const e = store.get(m.id);
    const thumb = h('canvas', { class: 'vp-bin-th', width: 64, height: 40, 'aria-hidden': 'true' });
    const img = e?.bitmap || e?.thumbs?.list[0];
    if (img) {
      const x = thumb.getContext('2d'), k = Math.max(64 / img.width, 40 / img.height);
      x.drawImage(img, (64 - img.width * k) / 2, (40 - img.height * k) / 2, img.width * k, img.height * k);
    }
    const sub = [m.kind === 'image' ? `${m.width} × ${m.height}` : fmtTime(m.duration, 1), m.kind === 'video' ? `${m.width} × ${m.height}` : null, m.origin ? t('vp.origin.' + m.origin.kind) : null].filter(Boolean).join(' · ');
    const used = S.project.main.some((c) => c.media === m.id) || S.project.audio.some((c) => c.media === m.id) || S.project.overlays.some((o) => o.media === m.id);
    const add = () => edit((p) => {
      if (m.kind === 'audio') E.addAudio(p, m.id, Math.round(engine.time * 1000) / 1000, 0);
      else E.addClip(p, m.id, { duration: 3 });
    }, t('vp.h.import'));
    const addOv = m.kind === 'image' ? iconBtn('layers', 'vp.bin.overlay', () => { const tt = engine.time; const id = edit((p) => E.addOverlay(p, { type: 'image', media: m.id, start: tt, end: tt + 3, w: 0.35 })?.id, t('vp.h.addPicture')); if (id) select(id, { keepTime: true }); }, 'ed-sm') : null;
    U.bin.append(h('li', { class: 'vp-bin-it' + (!e ? ' vp-missing' : '') + (used ? '' : ' vp-unused') },
      thumb, h('div', { class: 'vp-bin-txt' }, h('b', { title: m.name }, m.name), h('small', {}, e ? sub : t('vp.missing'))),
      h('span', { class: 'vp-bin-acts' }, iconBtn('plus', m.kind === 'audio' ? 'vp.bin.addAudio' : 'vp.bin.add', add, 'ed-sm'), addOv,
        iconBtn('info', 'vp.info', () => mediaInfo(m.id), 'ed-sm'),
        iconBtn('trash', 'vp.bin.remove', () => { edit((p) => E.removeMedia(p, m.id), t('vp.h.delete')); }, 'ed-sm ed-danger'))));
  }
  if (!S.project.media.length) U.bin.append(h('li', { class: 'ap-empty vp-bin-empty' }, t('vp.bin.empty')));
}

// --- keyboard ----------------------------------------------------------------------------------------------------

// Editor shortcuts in NLE tradition: J/K/L transport, , and . frame step, S split, [ ] or Q/W trim to playhead,
// arrows by frame (Shift: 1 s), Up/Down jump between edit points. Disabled while a dialog is open and inside fields;
// Space and arrows defer to focused buttons / sliders so keyboard users can still operate those controls.
function onKey(e) {
  if (document.querySelector('.ed-backdrop')) return;
  const tg = e.target;
  if (tg.closest?.('input, select, textarea, [contenteditable]')) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  const onBtn = tg.closest?.('button, a, [role=slider], [role=radio]');
  if (mod) {
    const lk = k.toLowerCase();
    if (lk === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (lk === 'y') { e.preventDefault(); redo(); }
    else if (lk === 'd') { e.preventDefault(); duplicate(); }
    else if (lk === 's') { e.preventDefault(); saveProject(); }
    else if (lk === 'o') { e.preventDefault(); pickFiles({ accept: '.json,.zip,.vproj' }).then((f) => f[0] && openProjectFile(f[0])); }
    else if (lk === 'e') { e.preventDefault(); openExport(app); }
    return;
  }
  if (e.altKey) return;
  const fps = S.project.fps || 30;
  if (k === ' ' && !onBtn) { e.preventDefault(); engine.toggle(); }
  else if (k === 'k' || k === 'K') engine.pause();
  else if (k === 'l' || k === 'L') engine.play();
  else if (k === 'j' || k === 'J') { engine.pause(); engine.seek(engine.time - (e.shiftKey ? 5 : 1)); }
  else if (k === 'ArrowLeft' && !onBtn) { e.preventDefault(); engine.pause(); engine.seek(engine.time - (e.shiftKey ? 1 : 1 / fps)); }
  else if (k === 'ArrowRight' && !onBtn) { e.preventDefault(); engine.pause(); engine.seek(engine.time + (e.shiftKey ? 1 : 1 / fps)); }
  else if (k === ',') engine.step(-1);
  else if (k === '.') engine.step(1);
  else if (k === 'Home') { e.preventDefault(); engine.seek(0); }
  else if (k === 'End') { e.preventDefault(); engine.seek(S.L.total); }
  else if (k === 'ArrowUp' || k === 'ArrowDown') {
    if (onBtn) return;
    e.preventDefault();
    const pts = E.snapPoints(S.L).concat(S.L.total);
    const tt = engine.time;
    const n = k === 'ArrowUp' ? [...pts].reverse().find((x) => x < tt - 1e-3) : pts.find((x) => x > tt + 1e-3);
    if (n != null) engine.seek(n);
  }
  else if (k === 's' || k === 'S') splitSelected();
  else if (k === 'Delete' || k === 'Backspace') { if (S.sel) { e.preventDefault(); remove(); } }
  else if (k === '[' || k === 'q' || k === 'Q') trimToPlayhead('start');
  else if (k === ']' || k === 'w' || k === 'W') trimToPlayhead('end');
  else if (k === 't' || k === 'T') addText();
  else if (k === 'd' || k === 'D') setDrawMode(!S.draw);
  else if (k === '+' || k === '=') tl.zoomIn();
  else if (k === '-') tl.zoomOut();
  else if (k === '0' || k === '\\') tl.fit();
  else if (k === 'Escape') { if (S.draw) setDrawMode(false); else if (S.sel) select(null); }
}

startApp({ key: 'vp', name: 'app.name', logo: LOGO, offline: true, onLang: build });
build();
document.addEventListener('keydown', onKey);
// Unsaved work prompt. Both preventDefault and returnValue: older engines need the latter.
window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
// Files dropped anywhere on the page.
// Page-wide file drop; areas with their own drop handling (drop zones, slideshow dialog, dialogs) are excluded so a
// file is never imported twice.
document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files') && !e.target.closest?.('.ap-drop, .vp-ss-drop')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (e.defaultPrevented || e.target.closest?.('.ap-drop, .vp-ss-drop, .ed-dialog')) return;
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  openFiles(files);
});
// Encoder probing is async (isConfigSupported); the UI starts immediately and the default export format (MP4 / H.264
// when available) is filled in when the answer arrives.
capabilities().then((c) => { S.caps = c; if (!S.out.format && c.formats.length) S.out.format = (c.formats.find((f) => f.id === 'mp4-h264') || c.formats[0]).id; commands.schedule(); });
