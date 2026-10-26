// digitalrain-effect/exporter.js - exports of the configured rain: standalone HTML page, embeddable snippet,
// WebM recording (MediaRecorder, local), PNG snapshot and wallpaper-size PNG.
// Everything is produced in the browser: pages and snippets by rain/export.js (which inlines the same engine the
// preview runs), videos by recording a dedicated off-screen engine, images from canvases. Nothing is uploaded.
// Recordings and wallpapers use their OWN engine instance at the target resolution: capturing the on-screen canvas
// would tie the output size to the window and let UI interactions disturb the recording.
import { button, copyText, download, field, seg, select, t, textInput, toast, toggle } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { fmtBytes } from '../ui/files.js';
import { UI_STATE } from '../ui/i18n.js';
import { openDialog } from '../ui/overlays.js';
import { rainEngine } from '../rain/engine.js';
import { effectHTML, embedSnippet } from '../rain/export.js';
import { engineParams } from '../rain/params.js';

const baseName = (S) => 'digital-rain' + (S.preset ? '-' + S.preset : '');
// toBlob may call back with null (canvas too large, out of memory): turned into a rejection so callers report it.
const canvasBlob = (c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));

export async function snapshotPNG(S) {
  try {
    const blob = await canvasBlob(S.engine.canvas);
    download(blob, baseName(S) + '.png');
    toast(t('dr.ex.saved', { name: baseName(S) + '.png' }), 'ok');
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}

export function openExport(kind, S, ctl) {
  if (kind === 'html') return htmlDialog(S);
  if (kind === 'embed') return embedDialog(S);
  if (kind === 'video') return videoDialog(S, ctl);
  if (kind === 'wallpaper') return wallpaperDialog(S);
  if (kind === 'png') return snapshotPNG(S);
}

// ---- standalone HTML ------------------------------------------------------------------------------------------------
// Standalone page options. The size readout is recomputed on every toggle (minify and the embedded image dominate
// it), so the user sees the cost of each choice before downloading. The title is applied at build time only (no
// refresh on typing: it barely changes the size). File name from the title with characters invalid on Windows
// and control characters replaced.
function htmlDialog(S) {
  const o = { title: t('app.rainTitle'), button: true, saver: false, hint: true, withImage: true, minify: true };
  const size = h('span', { class: 'dr-size' });
  const build = () => effectHTML(S.p, {
    title: o.title.trim() || t('app.rainTitle'), lang: UI_STATE.lang, label: t('dr.ex.label'),
    hint: o.hint ? t('dr.ex.hintText') : '', button: o.button, buttonLabel: t('dr.fullscreen'), saver: o.saver,
    withImage: o.withImage, minify: o.minify,
  });
  const refresh = () => { size.textContent = t('dr.ex.size', { size: fmtBytes(build().bytes) }); };
  const hasImg = S.p.bgMode === 'image' && !!S.p.bgImage;
  const body = h('div', { class: 'ed-fields' },
    h('p', { class: 'ed-hint dr-dlg-lead' }, t('dr.ex.htmlHint')),
    field('dr.ex.title', textInput(o.title, (v) => { o.title = v; }, { maxlength: 80 })),
    field('dr.ex.button', toggle(o.button, (v) => { o.button = v; refresh(); })),
    field('dr.ex.saver', toggle(o.saver, (v) => { o.saver = v; refresh(); }), 'dr.ex.saverHint'),
    field('dr.ex.hint', toggle(o.hint, (v) => { o.hint = v; refresh(); }), '=' + t('dr.ex.hintText')),
    hasImg ? field('dr.ex.image', toggle(o.withImage, (v) => { o.withImage = v; refresh(); })) : null,
    field('dr.ex.minify', toggle(o.minify, (v) => { o.minify = v; refresh(); })),
    h('div', { class: 'dr-dlg-meta' }, size, h('span', { class: 'dr-badge-ok' }, t('dr.ex.offline'))));
  refresh();
  const name = () => (o.title.trim() || baseName(S)).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 60) + '.html';
  return openDialog({
    title: t('dr.ex.html'), body,
    buttons: [
      { label: t('dr.ex.open'), icon: 'external', onClick: () => { openBlobPage(build().html); return false; } },
      { label: t('dlg.cancel'), value: null },
      { label: t('ap.download'), icon: 'download', primary: true, onClick: () => { download(build().html, name(), 'text/html'); toast(t('dr.ex.saved', { name: name() }), 'ok'); } },
    ],
  });
}

// Preview of an export in a new tab (a blob: URL; the page is the downloaded file, nothing is uploaded).
// The URL is revoked after a minute: the new tab has loaded it by then, and an unrevoked blob URL pins the page's
// memory until the creator tab closes.
// KNOWN DEFECT: per the HTML spec, window.open() with the 'noopener' feature always returns null, so the
// "popup blocked" toast appears even when the tab opened. Fix: open without the feature and set w.opener = null,
// or skip the null check when noopener is used.
function openBlobPage(html) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank', 'noopener');
  if (!w) toast(t('dr.ex.popup'), 'warn');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---- embed snippet ------------------------------------------------------------------------------------------------
// Snippet with a random id suffix: several snippets on one page must not collide on element ids. Size shown in
// UTF-8 bytes (TextEncoder), what it will weigh in the host page.
function embedDialog(S) {
  const o = { height: 360, id: 'digital-rain-' + Math.random().toString(36).slice(2, 7) };
  const area = h('textarea', { class: 'ap-mono dr-snippet', readonly: true, rows: 7, spellcheck: 'false', 'aria-label': t('dr.ex.embed') });
  const size = h('span', { class: 'dr-size' });
  const build = () => embedSnippet(S.p, { id: o.id, height: o.height, label: t('dr.ex.label') });
  const refresh = () => { const s = build(); area.value = s; size.textContent = t('dr.ex.size', { size: fmtBytes(new TextEncoder().encode(s).length) }); };
  const hInput = h('input', { type: 'number', class: 'ed-input', min: 40, max: 4000, step: 10, value: o.height });
  hInput.addEventListener('input', () => { o.height = +hInput.value || 360; refresh(); });
  refresh();
  const body = h('div', { class: 'ed-fields' },
    h('p', { class: 'ed-hint dr-dlg-lead' }, t('dr.ex.embedHint')),
    field('dr.ex.height', hInput),
    area,
    h('div', { class: 'dr-dlg-meta' }, size, h('span', { class: 'dr-badge-ok' }, t('dr.ex.offline'))));
  return openDialog({
    title: t('dr.ex.embed'), body, wide: true,
    buttons: [
      { label: t('ap.download'), icon: 'download', onClick: () => { download(build(), baseName(S) + '-snippet.html', 'text/html'); return false; } },
      { label: t('dlg.close'), value: null },
      { label: t('dr.ex.copy'), icon: 'copy', primary: true, onClick: () => { copyText(build()); return false; } },
    ],
  });
}

// ---- video ------------------------------------------------------------------------------------------------------------
// Best supported WebM codec: VP9 (smaller files at equal quality) before VP8 before the container default.
// isTypeSupported can throw on malformed strings in some engines, hence the try per candidate. Safari without WebM
// recording returns null and the dialog explains instead of failing mid-recording.
function recMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* keep looking */ }
  }
  return null;
}

// [id, width, height]; 'view' = the current stage size at device pixel ratio.
const RES = [['view', 0, 0], ['720p', 1280, 720], ['1080p', 1920, 1080], ['vertical', 1080, 1920], ['square', 1080, 1080]];

// Recording pipeline: engine on a fresh canvas -> canvas.captureStream(fps) -> MediaRecorder -> Blob chunks every
// 250 ms (bounded memory per chunk, and data survives if the tab is under pressure) -> one WebM at stop.
// Rendering scale: fixed resolutions render the scene at a logical size around 1080 px tall (scale = shorter side /
// 1080), so glyphs keep their on-screen proportions at 4K instead of becoming tiny.
// Bitrate ~0.12 bit per pixel per frame, capped at 16 Mbps: enough for sharp glyph edges in VP9 without huge files.
// Transparent backgrounds are recorded on the colour background: WebM alpha support in browsers is inconsistent.
// Closing the dialog mid-recording sets `stopped`, so onstop discards the partial file instead of downloading it.
function videoDialog(S, ctl) {
  const mime = recMime();
  if (!mime || !HTMLCanvasElement.prototype.captureStream) { toast(t('dr.ex.noRec'), 'error'); return; }
  const o = { sec: 10, res: '1080p', fps: 30 };
  const status = h('div', { class: 'dr-rec-status', role: 'status' });
  const bar = h('div', { class: 'ap-progress' }, h('i', {}));
  const stageBox = h('div', { class: 'dr-rec-stage' });
  const form = h('div', { class: 'ed-fields' },
    h('p', { class: 'ed-hint dr-dlg-lead' }, t('dr.ex.videoHint')),
    field('dr.ex.duration', seg([5, 10, 15, 30].map((v) => ({ v, l: '=' + v + ' s' })), o.sec, (v) => { o.sec = +v; }, 'dr.ex.duration')),
    field('dr.ex.res', select(RES.map(([k, w, hh]) => ({ v: k, l: k === 'view' ? 'dr.ex.resView' : '=' + w + ' × ' + hh })), o.res, (v) => { o.res = v; })),
    field('dr.ex.fps', seg([30, 60].map((v) => ({ v, l: '=' + v + ' fps' })), o.fps, (v) => { o.fps = +v; }, 'dr.ex.fps')),
    S.p.bgMode === 'transparent' ? h('p', { class: 'ed-hint ed-hint-warn' }, t('dr.ex.transparentNote')) : null);
  const body = h('div', {}, form, stageBox, h('div', { class: 'dr-rec-prog', hidden: true }, bar, status));
  let rec = null, eng = null, timer = 0, startT = 0, stopped = false;
  const cleanup = () => { clearInterval(timer); if (rec && rec.state !== 'inactive') { stopped = true; rec.stop(); } if (eng) eng.destroy(); eng = null; };
  const start = () => {
    if (rec && rec.state === 'recording') return false;
    if (eng) { eng.destroy(); eng = null; }
    stopped = false;
    const [, rw, rh] = RES.find((r) => r[0] === o.res);
    const view = ctl.stageSize();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = rw || Math.round(view.w * dpr), H = rh || Math.round(view.h * dpr);
    const scale = rw ? Math.max(1, Math.min(W, H) / 1080) : dpr;
    const canvas = h('canvas', { class: 'dr-rec-canvas', role: 'img', 'aria-label': t('dr.ex.label') });
    const p = engineParams(S.p);
    if (p.bgMode === 'transparent') p.bgMode = 'color';
    eng = rainEngine(canvas, p, { width: W / scale, height: H / scale, dpr: scale, ignoreReducedMotion: true });
    stageBox.textContent = '';
    stageBox.append(canvas);
    stageBox.style.aspectRatio = W + ' / ' + H;
    form.hidden = true;
    body.querySelector('.dr-rec-prog').hidden = false;
    eng.start();
    const stream = canvas.captureStream(o.fps);
    const chunks = [];
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(16e6, Math.round(W * H * o.fps * 0.12)) });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((tr) => tr.stop());
      if (eng) eng.stop();
      rec = null;
      if (stopped) return;   // closed while recording: discard
      const blob = new Blob(chunks, { type: 'video/webm' });
      const name = baseName(S) + '-' + W + 'x' + H + '.webm';
      download(blob, name);
      status.textContent = t('dr.ex.recDone', { size: fmtBytes(blob.size) });
      bar.firstChild.style.width = '100%';
      toast(t('dr.ex.saved', { name }), 'ok');
    };
    rec.start(250);
    startT = performance.now();
    const tick = () => {
      const s = (performance.now() - startT) / 1000;
      bar.firstChild.style.width = Math.min(100, (s / o.sec) * 100) + '%';
      if (rec.state === 'recording') status.textContent = t('dr.ex.recording', { s: Math.min(o.sec, s).toFixed(1), t: o.sec });
      if (s >= o.sec && rec.state === 'recording') rec.stop();
    };
    tick();
    timer = setInterval(tick, 100);
    return false;
  };
  return openDialog({
    title: t('dr.ex.video'), body, className: 'dr-rec-dlg',
    buttons: [
      { label: t('dlg.close'), value: null, onClick: () => { cleanup(); } },
      { label: t('dr.ex.record'), icon: 'record', primary: true, onClick: start },
    ],
  }).then(() => cleanup());
}

// ---- wallpaper ---------------------------------------------------------------------------------------------------------
// Common screen sizes: FHD, QHD, 4K, ultrawide, 5K, then phone/tablet portraits (iPhone, Android, iPad Pro).
const WALL = [[1920, 1080], [2560, 1440], [3840, 2160], [3440, 1440], [5120, 2880], [1170, 2532], [1080, 2400], [1290, 2796], [2048, 2732]];

// Wallpaper: one frame rendered off-screen. 'auto' scale keeps glyph size relative to a 1080 px tall (or 400 px
// wide for portrait) reference, like the video. The 30 ms pause lets the "rendering" toast paint before the
// synchronous render blocks the thread. eng.ready() waits until the background image is decoded, otherwise the
// frame would be rendered without it. finally destroys the engine and shrinks the canvas to free a possibly 100+ MB backing store at once.
function wallpaperDialog(S) {
  const o = { size: '3840x2160', w: 3840, h: 2160, scale: 'auto' };
  const custom = h('div', { class: 'ed-grid2' });
  const wIn = h('input', { type: 'number', class: 'ed-input', min: 320, max: 8192, step: 1, value: o.w });
  const hIn = h('input', { type: 'number', class: 'ed-input', min: 320, max: 8192, step: 1, value: o.h });
  wIn.addEventListener('input', () => { o.w = +wIn.value; });
  hIn.addEventListener('input', () => { o.h = +hIn.value; });
  custom.append(field('dr.ex.width', wIn), field('dr.ex.heightW', hIn));
  custom.hidden = true;
  const sizes = WALL.map(([w, hh]) => ({ v: w + 'x' + hh, l: '=' + w + ' × ' + hh + (hh > w ? ' · ' + t('dr.ex.portrait') : '') }));
  sizes.push({ v: 'custom', l: 'dr.ex.custom' });
  const body = h('div', { class: 'ed-fields' },
    h('p', { class: 'ed-hint dr-dlg-lead' }, t('dr.ex.wallHint')),
    field('dr.ex.wallSize', select(sizes, o.size, (v) => {
      o.size = v;
      custom.hidden = v !== 'custom';
      if (v !== 'custom') { [o.w, o.h] = v.split('x').map(Number); wIn.value = o.w; hIn.value = o.h; }
    })),
    custom,
    field('dr.ex.scale', seg([{ v: 'auto', l: 'dr.ex.auto' }, ...[1, 1.5, 2, 3, 4].map((v) => ({ v, l: '=' + v + '×' }))], o.scale, (v) => { o.scale = v; }, 'dr.ex.scale'), 'dr.ex.scaleHint'));
  const render = async () => {
    const W = Math.max(320, Math.min(8192, Math.round(o.w) || 1920)), H = Math.max(320, Math.min(8192, Math.round(o.h) || 1080));
    const scale = o.scale === 'auto' ? Math.max(1, H > W ? W / 400 : H / 1080) : +o.scale;
    toast(t('dr.ex.render'), 'info');
    await new Promise((r) => setTimeout(r, 30));
    const canvas = document.createElement('canvas');
    const eng = rainEngine(canvas, engineParams(S.p), { width: W / scale, height: H / scale, dpr: scale, ignoreReducedMotion: true });
    try {
      await eng.ready();
      eng.advance(S.p.msg ? 10 : 6).render();
      const blob = await canvasBlob(canvas);
      const name = baseName(S) + '-' + W + 'x' + H + '.png';
      download(blob, name);
      toast(t('dr.ex.saved', { name }), 'ok');
    } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
    finally { eng.destroy(); canvas.width = canvas.height = 1; }
  };
  return openDialog({
    title: t('dr.ex.wall'), body,
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ap.download'), icon: 'download', primary: true, onClick: render }],
  });
}
