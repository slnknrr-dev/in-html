// video-processor/media.js - the media of a project in memory: file bytes, a playback URL, the probe of the
// format libraries, decoded stills (ImageBitmap), timeline thumbnails, waveform peaks and decoded audio for exports.
// Entries are keyed by the project's media id.
//
// Memory model: the original bytes are kept (exports re-demux them, projects can be saved with media), plus one
// object URL for playback. Every derived resource (URL, ImageBitmaps) is released explicitly in release(): blobs
// and bitmaps are not reclaimed by GC while a URL or GPU handle references them.
import { fixWebm } from '../webm/fix.js';
import { probe } from './probe.js';

// Extension fallbacks: files dropped from some OSes / zip archives arrive with an empty MIME type.
const IMAGE_EXT = /\.(png|jpe?g|jfif|webp|gif|bmp|avif|svg|ico)$/i;
const MEDIA_EXT = /\.(mkv|webm|weba|mp4|m4v|m4a|mov|mp3|wav|ogg|oga|ogv|opus|flac|aac)$/i;
export const isImageFile = (f) => /^image\//.test(f.type) || IMAGE_EXT.test(f.name);
export const isMediaFile = (f) => /^(video|audio)\//.test(f.type) || MEDIA_EXT.test(f.name);
export const ACCEPT = 'video/*,audio/*,image/*,.mkv,.webm,.weba,.mp4,.m4v,.m4a,.mov,.mp3,.wav,.ogg,.oga,.ogv,.opus,.flac,.json,.zip,.vproj';

// Off-screen but rendered (not display:none) helper elements: see engine.js for why decoding needs that.
const hidden = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none';

// Ask the browser itself whether it can play the file: preload=metadata loads just the header. 10 s timeout for
// files the browser neither accepts nor rejects. The element is emptied afterwards to free the decoder.
function loadMeta(url) {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (ok) => { clearTimeout(tm); const r = { ok, duration: v.duration, width: v.videoWidth, height: v.videoHeight }; v.removeAttribute('src'); v.load(); res(r); };
    const tm = setTimeout(() => done(false), 10000);
    v.onloadedmetadata = () => done(true);
    v.onerror = () => done(false);
    v.src = url;
  });
}

// createImageBitmap is fast and off-main-thread but rejects SVG in most engines; the <img> + canvas path decodes
// anything the browser can display (SVG without intrinsic size falls back to 1024x1024).
async function decodeImage(blob) {
  try { return await createImageBitmap(blob); } catch { /* SVG and friends: through an <img> */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the browser cannot decode this image')); img.src = url; });
    const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return await createImageBitmap(c);
  } finally { URL.revokeObjectURL(url); }
}

export class MediaStore {
  constructor(onUpdate) {
    this.map = new Map();
    this.onUpdate = onUpdate || (() => {});
  }

  get(id) { return this.map.get(id) || null; }
  has(id) { return this.map.has(id); }

  /**
   * Reads a file: { info (for timeline addMedia: kind, name, size, mime, duration, width, height, fps, hasAudio),
   * entry }. Throws when the browser cannot use it.
   */
  async read(file, name = file.name) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return this.fromBytes(bytes, name, file.type);
  }

  // Two independent opinions: our own container parser (probe: exact tracks, codecs, metadata) and the browser
  // (loadMeta: can it actually play this?). Probe facts fill gaps where the browser reports nothing, the browser's
  // duration wins when available (it accounts for edit lists and VBR headers).
  async fromBytes(bytes, name, mime = '') {
    const asImage = /^image\//.test(mime) || IMAGE_EXT.test(name);
    if (asImage) {
      const type = mime || (/\.svg$/i.test(name) ? 'image/svg+xml' : /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg');
      const blob = new Blob([bytes], { type });
      const bitmap = await decodeImage(blob);
      return {
        info: { kind: 'image', name, size: bytes.length, mime: type, width: bitmap.width, height: bitmap.height },
        entry: { name, kind: 'image', bytes, mime: type, bitmap, url: URL.createObjectURL(blob) },
      };
    }
    const pr = probe(bytes, name);
    let url = URL.createObjectURL(new Blob([bytes], { type: mime || 'video/webm' }));
    let fixed = false;
    // MediaRecorder WebM has no duration or cues: play a fixed copy so that seeking works.
    // MediaRecorder output is a live stream: no duration and no Cues index, so the browser cannot seek in it. fixWebm
    // rewrites the header with both, and playback uses the fixed copy; the original bytes stay untouched.
    if (pr.container === 'webm' && pr.extra.some(([k, v]) => k === 'vp.i.seekable' && v === 'no')) {
      try {
        const fx = fixWebm(bytes);
        URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([fx.bytes], { type: 'video/webm' }));
        fixed = true;
      } catch { /* play the original */ }
    }
    const vt = pr.tracks.find((x) => x.type === 'video'), at = pr.tracks.find((x) => x.type === 'audio');
    const meta = await loadMeta(url);
    if (!meta.ok && pr.container === 'unknown') { URL.revokeObjectURL(url); throw new Error('unsupported file'); }
    let duration = meta.ok && Number.isFinite(meta.duration) && meta.duration > 0 ? meta.duration : pr.duration || 0;
    if (!duration) { URL.revokeObjectURL(url); throw new Error('the duration is unknown'); }
    const hasVideo = meta.ok ? meta.width > 0 : !!vt;
    const info = {
      kind: hasVideo ? 'video' : 'audio', name, size: bytes.length, mime,
      duration: Math.round(duration * 1000) / 1000,
      width: meta.width || vt?.width || 0, height: meta.height || vt?.height || 0,
      // Sanity cap: some containers report absurd frame rates (timebase artefacts); above 240 fall back to 30.
      fps: vt?.fps && vt.fps < 241 ? vt.fps : 30,
      hasAudio: !!at || (pr.container === 'unknown' && meta.ok),
    };
    const entry = {
      name, kind: info.kind, bytes, mime, url, probe: pr, fixed, playable: meta.ok, duration: info.duration, width: info.width, height: info.height,
      fps: info.fps, hasVideo, hasAudio: info.hasAudio, rotation: vt?.rotation || 0, sampleRate: at?.sampleRate || 48000, channels: at?.channels || 2,
      size: bytes.length, thumbs: null, peaks: null, audio: {},
    };
    return { info, entry };
  }

  /** A still made in the editor (freeze frame, painted picture): PNG bytes + bitmap from a canvas. */
  async fromCanvas(canvas, name) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return this.fromBytes(new Uint8Array(await blob.arrayBuffer()), name, 'image/png');
  }

  // Attaching starts background work: filmstrip thumbnails for videos and waveform peaks for anything with sound.
  attach(id, entry) {
    const old = this.map.get(id);
    if (old && old !== entry) this.release(old);
    entry.id = id;
    this.map.set(id, entry);
    if (entry.kind === 'video' && entry.playable) this.thumbs(entry);
    if (entry.hasAudio) this.peaks(entry);
  }

  release(e) {
    if (e.url) URL.revokeObjectURL(e.url);
    try { e.bitmap?.close?.(); } catch { /* closed */ }
    for (const t of e.thumbs?.list || []) { try { t.close?.(); } catch { /* closed */ } }
  }

  remove(id) {
    const e = this.map.get(id);
    if (e) this.release(e);
    this.map.delete(id);
  }

  clear() { for (const id of [...this.map.keys()]) this.remove(id); }

  /** Filmstrip thumbnails (ImageBitmap, 64 px high) at regular source times: { step, list }. */
  // Filmstrip: one hidden <video>, sought step by step, each frame drawn into a 64px-high canvas and kept as an
  // ImageBitmap (cheap to draw on the timeline repeatedly). 4..48 thumbnails, about one per 1.5 s. Each seek has a
  // 3 s timeout so one broken spot does not stall the strip. Progress is published every 6 thumbnails.
  async thumbs(e) {
    if (e.thumbs) return;
    e.thumbs = { step: 1, list: [] };
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.style.cssText = hidden;
    document.body.append(v);
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; v.src = e.url; });
      const n = Math.max(4, Math.min(48, Math.ceil(e.duration / 1.5)));
      const H = 64, W = Math.max(24, Math.round((H * (v.videoWidth || 16)) / Math.max(1, v.videoHeight || 9)));
      const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const ctx = c.getContext('2d');
      e.thumbs.step = e.duration / n;
      e.thumbs.aspect = W / H;
      for (let i = 0; i < n; i++) {
        await new Promise((res) => { const tm = setTimeout(res, 3000); v.addEventListener('seeked', () => { clearTimeout(tm); res(); }, { once: true }); v.currentTime = Math.min(e.duration - 0.01, (i + 0.5) * e.thumbs.step); });
        ctx.drawImage(v, 0, 0, W, H);
        e.thumbs.list.push(await createImageBitmap(c));
        if (i % 6 === 5) this.onUpdate(e.id, 'thumbs');
      }
      this.onUpdate(e.id, 'thumbs');
    } catch { /* no thumbnails */ } finally { v.removeAttribute('src'); v.load(); v.remove(); }
  }

  /** The thumbnail nearest to a source time (or null). */
  thumbAt(e, t) {
    const th = e?.thumbs;
    if (!th?.list.length) return null;
    return th.list[Math.max(0, Math.min(th.list.length - 1, Math.floor(t / th.step)))];
  }

  /** Waveform: min / max pairs over the whole duration. */
  // Waveform at 8 kHz (enough for a visual envelope, 6x less data than 48 kHz): min/max per bucket, 60 buckets per
  // second clamped to 200..6000, so drawing cost is independent of file length.
  async peaks(e) {
    if (e.peaks) return;
    e.peaks = new Float32Array(0);
    const ch = await this.audio(e.id, 8000);
    if (!ch) return;
    const d = ch[0], n = Math.max(200, Math.min(6000, Math.round(e.duration * 60))), per = Math.max(1, Math.floor(d.length / n));
    const p = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      let lo = 0, hi = 0;
      for (let j = i * per, k = Math.min(d.length, j + per); j < k; j++) { const v = d[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
      p[i * 2] = lo; p[i * 2 + 1] = hi;
    }
    e.peaks = p;
    this.onUpdate(e.id, 'peaks');
  }

  /** Decoded audio of a media at a sample rate: Float32Array per channel (cached), or null. */
  // decodeAudioData on an OfflineAudioContext of the wanted rate decodes AND resamples in one native call. The bytes
  // are sliced into a fresh ArrayBuffer because decodeAudioData detaches (takes ownership of) the buffer it gets.
  // Results (including failures as null) are cached per rate.
  async audio(id, rate) {
    const e = this.map.get(id);
    if (!e || !e.hasAudio) return null;
    if (e.audio[rate] !== undefined) return e.audio[rate];
    let out = null;
    try {
      const ctx = new OfflineAudioContext(1, 1, rate);
      const buf = await ctx.decodeAudioData(e.bytes.buffer.slice(e.bytes.byteOffset, e.bytes.byteOffset + e.bytes.byteLength));
      out = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    } catch { out = null; }
    e.audio[rate] = out;
    return out;
  }
}
