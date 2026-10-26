// barcode-studio/scan.js - the scan page: images (drop, paste, pick) and the camera (device choice, about 8 reads per
// second, pause on a result), the browser's BarcodeDetector when it has one (every format it reports, Data Matrix and
// QR included) or the built-in reader of linear codes (barcode/decode.js), and a "scanner input" box for USB / Bluetooth
// scanners that type like a keyboard. Results are explained (GTIN kind and prefix, GS1 elements with dates and
// measures, Digital Link), can be opened in the generator, and are kept in a local history.
//
// Decoder strategy: the platform BarcodeDetector (Chromium on Android/macOS/ChromeOS) is fast, reads 2D codes and
// tolerates perspective; the built-in reader (barcode/decode.js) is pure JS, linear codes only, but works in every
// browser and offline. Native first, built-in as fallback, plus a user switch to force the built-in reader (useful
// to test what the studio itself can read). Feature detection is asynchronous (getSupportedFormats), so the page
// renders immediately and re-renders when detectorReady settles.
// Long-lived media elements (canvas, video, overlay) are created once at module level and re-attached on every
// render(): rebuilding a <video> would drop its stream and restart the camera.
import { describeNumber, historyAdd, historyClear, historyList, kvRows, pageHref, showGS, snippet, startShell } from './common.js';
import { button, card, copyText, dropZone, field, seg, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { scanImage } from '../barcode/decode.js';
import { GS, parseGs1, toDigitalLink } from '../barcode/gs1.js';
import { inspectGtin } from '../barcode/gtin.js';

const S = {
  source: lsGet('bc-scan-source', 'image') === 'camera' ? 'camera' : 'image',
  builtin: !!lsGet('bc-scan-builtin', false),
  deviceId: lsGet('bc-scan-device', ''),
  result: null,          // { type, text, decoder, at }
  hasImage: false,
  status: null,
  devices: [],
  wedge: '',
};

const view = h('canvas', { class: 'bc-view-img' });
// muted + playsinline set both as attribute and property: iOS Safari only autoplays inline video when it is muted
// and playsinline, and the attribute must be present before the stream is attached.
const video = h('video', { class: 'bc-video', muted: true, playsinline: true, autoplay: true });
video.muted = true;
video.setAttribute('playsinline', '');
const overlay = h('canvas', { class: 'bc-overlay', 'aria-hidden': 'true' });
// Off-screen working canvas for camera frames, reused every tick (allocating a canvas per frame churns memory).
const frame = document.createElement('canvas');
let stream = null, scanning = false, timer = 0, busy = false;

// ---------------------------------------------------------------------------------------------------------------
// Decoders

// BarcodeDetector format names -> studio type keys.
// Only formats with a studio equivalent are requested from the detector; asking for fewer formats is faster.
const NATIVE = { ean_13: 'ean13', ean_8: 'ean8', upc_a: 'upca', upc_e: 'upce', code_128: 'code128', code_39: 'code39', code_93: 'code93', itf: 'itf', codabar: 'codabar', data_matrix: 'datamatrix', qr_code: 'qr', pdf417: 'pdf417', aztec: 'aztec' };
let detector = null, nativeFormats = [];
const detectorReady = (async () => {
  try {
    if (typeof window.BarcodeDetector !== 'function') return;
    nativeFormats = (await window.BarcodeDetector.getSupportedFormats()).filter((f) => NATIVE[f]);
    if (nativeFormats.length) detector = new window.BarcodeDetector({ formats: nativeFormats });
  } catch { detector = null; }
})();
const useNative = () => !!detector && !S.builtin;

// Normalises a decoded value: GS1 codes keep their separators as GS; ]C1 / ]d2 prefixes are not part of rawValue.
function classify(type, text) {
  // A leading GS in Code 128 / Data Matrix data is FNC1 in first position, i.e. GS1 data: reclassified, separator
  // removed. The detector already strips symbology identifiers (]C1, ]d2) from rawValue.
  if (type === 'code128' && text.startsWith(GS)) return { type: 'gs1-128', text: text.slice(1) };
  if (type === 'datamatrix' && text.startsWith(GS)) return { type: 'gs1-datamatrix', text: text.slice(1) };
  if (type === 'upca' && /^\d{12}$/.test(text)) return { type: 'upca', text };
  return { type, text };
}

async function detect(canvas, { fast = false } = {}) {
  // willReadFrequently: hints the browser to keep the canvas in CPU memory, making repeated getImageData cheap.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (useNative()) {
    try {
      const codes = await detector.detect(canvas);
      const c = codes.find((x) => x.rawValue != null);
      if (c) return { ...classify(NATIVE[c.format] || c.format, c.rawValue), points: c.cornerPoints || [], decoder: 'native' };
    } catch { /* fall back to the built-in reader */ }
    // fast mode (camera): when native detection finds nothing, skip the slow JS fallback; the next frame comes soon.
    if (fast) return null;
  }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = scanImage(img, { lines: fast ? 16 : 40 })[0];
  if (!r) return null;
  // The extent of the agreeing scan lines as an outline.
  // The built-in reader reports the span of agreeing scan lines; it is widened by 6 px to form a visible outline.
  const pts = r.orientation === 'h'
    ? [{ x: r.x0, y: r.p0 - 6 }, { x: r.x1, y: r.p0 - 6 }, { x: r.x1, y: r.p1 + 6 }, { x: r.x0, y: r.p1 + 6 }]
    : [{ x: r.p0 - 6, y: r.x0 }, { x: r.p1 + 6, y: r.x0 }, { x: r.p1 + 6, y: r.x1 }, { x: r.p0 - 6, y: r.x1 }];
  const type = r.type === 'ean13' && r.upca ? 'ean13' : r.type;
  return { type, text: r.text + (r.addon ? ' ' + r.addon : ''), points: pts, decoder: 'builtin', extra: r };
}

// ---------------------------------------------------------------------------------------------------------------
// Overlay

function drawQuad(points, w, h2, scale = 1) {
  overlay.width = w; overlay.height = h2;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, w, h2);
  if (!points || points.length < 4) return;
  // Outline colour from the --ed-ok token (theme-aware). The '2e' alpha suffix assumes a 6-digit hex token, which
  // ui/base.css defines; an rgb() token would make the fill colour invalid and silently skip the fill.
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--ed-ok').trim() || '#16a34a';
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale)));
  ctx.closePath();
  ctx.lineWidth = Math.max(3, w / 180);
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent + '2e';
  ctx.fill();
  ctx.stroke();
}
const clearOverlay = () => overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);

// ---------------------------------------------------------------------------------------------------------------
// Images

async function scanFile(file) {
  if (!file) return;
  stopCamera();
  setStatus('info', 'bc.st.reading');
  let src;
  // createImageBitmap decodes off the main thread where supported and rejects for non-images.
  try { src = await createImageBitmap(file); } catch { setStatus('error', 'bc.st.badImage'); return; }
  const W = src.width, H = src.height;
  // Downscale to at most 1800 px: decoding time grows with pixels and barcodes stay readable at this size. Drawn on
  // white first so transparent PNGs do not become black-on-black.
  const k = Math.min(1, 1800 / Math.max(W, H));
  view.width = Math.max(1, Math.round(W * k)); view.height = Math.max(1, Math.round(H * k));
  const vctx = view.getContext('2d', { willReadFrequently: true });
  vctx.fillStyle = '#ffffff';
  vctx.fillRect(0, 0, view.width, view.height);
  vctx.drawImage(src, 0, 0, view.width, view.height);
  S.hasImage = true;
  S.source = 'image';
  render();
  clearOverlay();
  setStatus('info', 'bc.st.scanning');
  // One macrotask so the "scanning" status and the image paint before the synchronous decode blocks the thread.
  await new Promise((r) => setTimeout(r, 30));
  let res = await detect(view);
  if (!res && Math.max(W, H) > 1800) {
    // Small codes in big photos: one more try at full resolution.
    const c = document.createElement('canvas');
    const kk = Math.min(1, 3200 / Math.max(W, H));
    c.width = Math.round(W * kk); c.height = Math.round(H * kk);
    c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, c.width, c.height);
    res = await detect(c);
    if (res) res.points = res.points.map((p) => ({ x: p.x * view.width / c.width, y: p.y * view.height / c.height }));
  }
  if (!res) { drawQuad(null, view.width, view.height); setStatus('warn', 'bc.st.nothing'); return; }
  drawQuad(res.points, view.width, view.height);
  found(res);
}

// ---------------------------------------------------------------------------------------------------------------
// Camera

async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') { setStatus('error', 'bc.cam.unsupported'); return; }
  setStatus('info', 'bc.cam.starting');
  // Remembered device first; otherwise ask for the rear camera at up to 1080p (ideal = preference, not requirement,
  // so laptops without a rear camera still get their webcam).
  const constraints = { audio: false, video: S.deviceId ? { deviceId: { exact: S.deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // A remembered camera that vanished (unplugged, new device ids after a browser reset) is forgotten and the default
    // is tried once.
    if (S.deviceId && /Overconstrained|NotFound/.test(e && e.name)) { S.deviceId = ''; lsSet('bc-scan-device', ''); return startCamera(); }
    const name = (e && e.name) || '';
    setStatus('error', /NotAllowed|Security|Permission/.test(name) ? 'bc.cam.denied' : /NotFound|Overconstrained/.test(name) ? 'bc.cam.none' : 'bc.cam.error');
    stream = null;
    render();
    return;
  }
  video.srcObject = stream;
  try { await video.play(); } catch { /* muted autoplay */ }
  // Device labels are only available after permission was granted, hence enumerate after getUserMedia.
  try { S.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { S.devices = []; }
  const track = stream.getVideoTracks()[0];
  const id = track && track.getSettings ? track.getSettings().deviceId : '';
  if (id) S.deviceId = id;
  render();
  resumeScan();
}

function stopCamera() {
  scanning = false;
  clearTimeout(timer);
  // Stopping every track turns the camera light off; leaving tracks alive would keep the camera busy for other apps.
  if (stream) for (const tr of stream.getTracks()) tr.stop();
  stream = null;
  video.srcObject = null;
}

function resumeScan() {
  if (!stream) return;
  clearOverlay();
  if (video.paused) video.play().catch(() => {});
  scanning = true;
  setStatus('info', 'bc.cam.looking');
  render();
  tick();
}

async function tick() {
  if (!scanning) return;
  // Frames are skipped while a decode is running, the tab is hidden, or the video has no frame yet (readyState < 2).
  if (busy || document.hidden || video.readyState < 2 || !video.videoWidth) { timer = setTimeout(tick, 200); return; }
  busy = true;
  const t0 = performance.now();
  // Frames are scaled to at most 1100 px for speed. The loop aims at ~8 reads per second (125 ms period minus the
  // decode time). The video pauses on a hit so the outline stays on the frame that was read.
  const vw = video.videoWidth, vh = video.videoHeight, k = Math.min(1, 1100 / Math.max(vw, vh));
  frame.width = Math.round(vw * k); frame.height = Math.round(vh * k);
  frame.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, frame.width, frame.height);
  let res = null;
  try { res = await detect(frame, { fast: true }); } catch { res = null; }
  busy = false;
  if (!scanning) return;
  if (res) {
    scanning = false;
    video.pause();
    drawQuad(res.points, vw, vh, 1 / k);
    found(res);
    return;
  }
  timer = setTimeout(tick, Math.max(20, 125 - (performance.now() - t0)));
}

// ---------------------------------------------------------------------------------------------------------------
// Results

function found(res) {
  S.result = { type: res.type, text: res.text, decoder: res.decoder, at: Date.now() };
  historyAdd({ type: res.type, text: res.text, decoder: res.decoder });
  setStatus('ok', 'bc.st.found');
  render();
  const rc = $('#bc-result');
  if (rc) { rc.classList.remove('bc-flash'); void rc.offsetWidth; rc.classList.add('bc-flash'); }
}

// What a scanner-typed line is: a GTIN, GS1 data (symbology identifier, GS, parentheses or a Digital Link) or text.
// Keyboard-wedge scanners type the code and Enter. GTIN lengths are recognised by digit count; GS1 data by a
// symbology identifier (]C1, ]d2, ]Q3, ]e0, ]J1), a GS character or its common textual stand-ins, parenthesised AIs,
// or a Digital Link URL path containing /01/<GTIN>.
function interpretTyped(line) {
  const s = line.trim();
  if (/^\d{8}$|^\d{12,14}$/.test(s)) {
    const g = inspectGtin(s);
    return { type: { 8: 'ean8', 12: 'upca', 13: 'ean13', 14: 'itf14' }[s.length], text: s, valid: g.valid };
  }
  if (/^\](C1|d2|Q3|e0|J1)/.test(s) || s.includes(GS) || /<GS>|\{GS\}|␝/.test(s) || /^\(\d{2,4}\)/.test(s) || /^https?:\/\/[^/]+\/(?:.+\/)?01\/\d{14}/.test(s)) {
    const sym = /^\]d2|^\]Q3/.test(s) ? 'gs1-datamatrix' : 'gs1-128';
    return { type: sym, text: s, gs1: true };
  }
  return { type: 'text', text: s };
}

function gs1Table(text) {
  const p = parseGs1(text);
  if (!p.elements.length) return null;
  const table = h('table', { class: 'bc-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'AI'), h('th', {}, t('bc.gs1.title')), h('th', {}, t('bc.gs1.value')))),
    h('tbody', {}, p.elements.map((e) => h('tr', { class: e.issues.length ? 'bc-bad' : '' }, h('td', { class: 'bc-mono' }, e.ai), h('td', {}, e.title || '—'),
      h('td', { class: 'bc-mono' }, e.value, e.date ? h('div', { class: 'ed-hint' }, e.date) : e.number != null ? h('div', { class: 'ed-hint' }, (e.currency ? e.currency + ' ' : '') + e.number) : null,
        e.issues.length ? h('div', { class: 'ed-hint ed-hint-warn' }, e.issues.map((x) => t('bc.gs1.issue.' + x.code)).join(', ')) : null)))));
  const link = toDigitalLink(p.elements);
  return h('div', {}, table, link ? h('div', { class: 'bc-dl' }, h('div', { class: 'ed-label' }, t('bc.i.link')), h('code', { class: 'bc-mono bc-wrap' }, link)) : null,
    p.rest ? h('div', { class: 'ed-hint ed-hint-warn' }, t('bc.err.gs1rest', { rest: p.rest })) : null);
}

const NAMES = { ean13: 'EAN-13', ean8: 'EAN-8', upca: 'UPC-A', upce: 'UPC-E', 'gs1-128': 'GS1-128', code128: 'Code 128', code39: 'Code 39', code93: 'Code 93', itf: 'ITF', itf14: 'ITF-14', codabar: 'Codabar', datamatrix: 'Data Matrix', 'gs1-datamatrix': 'GS1 DataMatrix', qr: 'QR', pdf417: 'PDF417', aztec: 'Aztec', text: 'Text' };
const STUDIO = new Set(['ean13', 'ean8', 'upca', 'upce', 'gs1-128', 'code128', 'code39', 'code93', 'itf', 'itf14', 'codabar', 'datamatrix', 'gs1-datamatrix']);

function explain(r) {
  const kids = [];
  const base = r.text.split(' ')[0];
  const num = describeNumber(r.type === 'itf' && base.length === 14 ? 'itf14' : r.type, base);
  if (num.length) kids.push(kvRows(num));
  if (r.type === 'gs1-128' || r.type === 'gs1-datamatrix') { const g = gs1Table(r.text); if (g) kids.push(g); }
  if (/^https?:\/\//i.test(r.text)) {
    const g = gs1Table(r.text);
    if (g) kids.push(g);
    // Arbitrary URLs from scanned codes open in a new tab with noopener noreferrer: the opened page gets neither
    // window.opener nor the referrer. It is never navigated to automatically (a malicious code cannot redirect the app).
    else kids.push(h('div', { class: 'ap-actions' }, h('a', { class: 'ed-btn ed-sm', href: r.text, target: '_blank', rel: 'noopener noreferrer' }, iconEl('external'), t('bc.r.open'))));
  }
  return kids;
}

function resultCard(r, id, titleKey) {
  const head = h('div', { class: 'bc-r-head' }, h('span', { class: 'bc-r-icon' }, iconEl(r.type === 'datamatrix' || r.type === 'gs1-datamatrix' || r.type === 'qr' ? 'matrix' : 'barcode')),
    h('div', {}, h('b', {}, NAMES[r.type] || r.type), h('div', { class: 'ed-hint' }, t(r.decoder === 'native' ? 'bc.dec.native' : r.decoder === 'typed' ? 'bc.dec.typed' : 'bc.dec.builtin'))));
  const copy = button('ap.copy', 'copy', () => copyText(r.text)); copy.classList.add('ed-sm');
  // Open in the generator: the content travels in the URL hash to the create page (main.js readHash); the symbology
  // identifier prefix is stripped. Only types the studio can generate get the button.
  const edit = STUDIO.has(r.type) ? h('a', { class: 'ed-btn ed-sm', href: pageHref('pg-create') + '#type=' + encodeURIComponent(r.type) + '&text=' + encodeURIComponent(r.text.replace(/^\][A-Za-z]\d/, '')) }, iconEl('edit'), t('bc.r.edit')) : null;
  const again = S.source === 'camera' && stream && !scanning && id === 'bc-result' ? button('bc.r.again', 'refresh', resumeScan, 'primary') : null;
  const c = card(titleKey, head,
    h('div', { class: 'bc-r-raw' }, h('div', { class: 'bc-r-raw-h' }, h('span', { class: 'ed-label' }, t('bc.r.raw')), copy), h('pre', { class: 'ap-pre bc-mono' }, showGS(r.text))),
    ...explain(r),
    h('div', { class: 'ap-actions' }, again, edit));
  c.id = id;
  return c;
}

function renderResult() {
  if (!S.result) return card('bc.r.title', h('div', { class: 'ap-empty' }, iconEl('scan'), h('p', {}, t('bc.r.empty'))));
  return resultCard(S.result, 'bc-result', 'bc.r.title');
}

// Scanner input (keyboard wedge): each Enter reads one line.
function renderWedge() {
  // The wedge input lives outside render(): render() reuses the same card, so typing is not interrupted when a camera
  // result re-renders the page.
  const out = h('div', { class: 'bc-wedge-out' });
  const inp = textInput(S.wedge, (v) => { S.wedge = v; }, { class: 'ed-input bc-mono', placeholder: t('bc.w.ph'), autocomplete: 'off', 'aria-label': t('bc.w.title') });
  const read = () => {
    const line = inp.value.trim();
    if (!line) return;
    const r = { ...interpretTyped(line), decoder: 'typed' };
    out.textContent = '';
    out.append(resultCard(r, 'bc-typed', 'bc.w.result'));
    historyAdd({ type: r.type, text: r.text, decoder: 'typed' });
    inp.value = ''; S.wedge = '';
    paintHistory();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); read(); } });
  const go = button('bc.w.read', 'keyboard', read); go.classList.add('ed-sm');
  return card('bc.w.title', h('div', { class: 'ed-row' }, inp, go), h('div', { class: 'ed-hint' }, t('bc.w.hint')), out);
}

const histBox = h('div', {});
function paintHistory() {
  histBox.textContent = '';
  const list = historyList();
  const ul = h('ul', { class: 'bc-hist' });
  for (const e of list) {
    ul.append(h('li', {}, h('button', {
      type: 'button', class: 'bc-hist-item', onclick: () => { S.result = { type: e.type, text: e.text, decoder: e.decoder || 'builtin', at: e.at }; render(); },
    }, h('span', { class: 'bc-hist-type' }, NAMES[e.type] || e.type), h('span', { class: 'bc-hist-t bc-mono' }, snippet(e.text, 56)))));
  }
  const clear = button('ap.clear', 'trash', () => {
    const prev = historyList();
    historyClear();
    paintHistory();
    // Clearing history offers Undo in the toast instead of a confirmation dialog: cheaper for the user, same safety.
    toast(t('bc.h.cleared'), 'info', { label: t('dlg.undo'), fn: () => { for (const e of prev.slice().reverse()) historyAdd(e); paintHistory(); } });
  });
  clear.classList.add('ed-sm');
  clear.disabled = !list.length;
  histBox.append(card('bc.h.title', list.length ? ul : h('div', { class: 'ap-empty' }, t('bc.h.empty')), list.length ? h('div', { class: 'ap-actions' }, clear) : null));
}

// ---------------------------------------------------------------------------------------------------------------
// Layout

function setStatus(kind, key, vars) {
  S.status = key ? { kind, key, vars } : null;
  const el = $('#bc-status');
  if (el) paintStatus(el);
}
function paintStatus(el) {
  el.textContent = '';
  const st = S.status;
  el.className = 'bc-status' + (st ? ' bc-st-' + st.kind : '');
  if (!st) return;
  el.append(iconEl({ info: 'info', warn: 'warn', error: 'warn', ok: 'ok' }[st.kind] || 'info'), h('span', {}, t(st.key, st.vars)));
}

const main = $('#main');
main.classList.add('bc-scan');

function renderSource() {
  const srcSeg = seg([{ v: 'image', l: 'bc.src.image', icon: 'image' }, { v: 'camera', l: 'bc.src.camera', icon: 'camera' }], S.source, (v) => {
    S.source = v; lsSet('bc-scan-source', v);
    if (v === 'camera') { S.status = null; render(); startCamera(); } else { stopCamera(); S.status = null; render(); }
  }, 'bc.src');
  const status = h('div', { id: 'bc-status', class: 'bc-status', role: 'status', 'aria-live': 'polite' });
  paintStatus(status);
  const kids = [srcSeg];
  if (S.source === 'image') {
    const dz = dropZone({ accept: 'image/*', label: S.hasImage ? 'bc.src.another' : 'bc.src.drop', onFiles: (fs) => scanFile(fs[0]) });
    if (S.hasImage) { dz.classList.add('bc-drop-compact'); kids.push(h('div', { class: 'bc-view' }, view, overlay), status, dz); }
    else { dz.classList.add('bc-drop-big'); kids.push(dz, status, h('div', { class: 'ed-hint' }, t('bc.src.hint'))); }
  } else {
    const ctrl = h('div', { class: 'ap-actions' });
    if (stream) {
      ctrl.append(button('bc.cam.stop', 'videoOff', () => { stopCamera(); S.status = null; render(); }));
      if (S.devices.length > 1) {
        const sel = select(S.devices.map((d, i) => ({ v: d.deviceId, l: '=' + (d.label || t('bc.cam.n', { n: i + 1 })) })), S.deviceId, (v) => { S.deviceId = v; lsSet('bc-scan-device', v); startCamera(); });
        sel.setAttribute('aria-label', t('bc.cam.choose'));
        ctrl.append(sel);
      }
      if (!scanning && S.result) ctrl.append(button('bc.r.again', 'refresh', resumeScan, 'primary'));
    } else ctrl.append(button('bc.cam.start', 'video', startCamera, 'primary'));
    const box = h('div', { class: 'bc-view bc-view-cam' + (stream ? '' : ' bc-cam-off') }, video, overlay,
      stream ? h('div', { class: 'bc-reticle', 'aria-hidden': 'true' }) : h('div', { class: 'bc-cam-empty' }, iconEl('camera'), h('p', {}, t('bc.cam.idle'))));
    // The camera box takes the stream's aspect ratio, so the overlay (stretched over the box) matches video pixels and
    // object-fit: cover never crops.
    if (video.videoWidth) box.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    kids.push(box, status, ctrl);
  }
  const note = detector ? (S.builtin ? 'bc.dec.usingBuiltin' : 'bc.dec.usingNative') : 'bc.dec.noNative';
  kids.push(h('div', { class: 'bc-dec' }, detector ? field('bc.dec.force', toggle(S.builtin, (v) => { S.builtin = v; lsSet('bc-scan-builtin', v); render(); })) : null,
    h('div', { class: 'ed-hint' }, t(note, { formats: nativeFormats.map((f) => NAMES[NATIVE[f]] || f).join(', ') }))));
  return h('section', { class: 'ap-card bc-source' }, ...kids);
}

let wedgeCard = null;
function render() {
  main.textContent = '';
  if (!wedgeCard) wedgeCard = renderWedge();
  paintHistory();
  main.append(h('div', { class: 'bc-scan-work' }, h('div', { class: 'bc-col' }, renderSource(), wedgeCard), h('div', { class: 'bc-col' }, renderResult(), histBox)));
}

video.addEventListener('loadedmetadata', () => { const b = video.closest('.bc-view'); if (b) b.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`; });
// KNOWN DEFECT: while hidden, tick() keeps rescheduling itself every 200 ms; on return this handler starts a second
// chain, and `timer` only remembers the latest, so two loops run (doubled decode rate, stopCamera cancels only one
// timeout; the orphan stops itself because scanning becomes false). Fix: clearTimeout(timer) before calling tick().
document.addEventListener('visibilitychange', () => { if (!document.hidden && scanning) tick(); });
// pagehide (not unload): fires on bfcache navigation too, so the camera is released when leaving the page.
window.addEventListener('pagehide', stopCamera);

if (S.source === 'camera') S.status = { kind: 'info', key: 'bc.cam.press' };
// Language switch rebuilds the wedge card too (its labels are translated).
startShell('scan', () => { wedgeCard = null; render(); });
render();
detectorReady.then(() => render());
