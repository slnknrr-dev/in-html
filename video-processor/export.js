// video-processor/export.js - rendering a project to files: WebCodecs video export (frames of the clips
// decoded with VideoDecoder from the webm / mp4 demuxers, or read by seeking a video element, drawn by the
// compositor, encoded with VideoEncoder + AudioEncoder, muxed by webm/mux.js or mp4/mux.js), the real-time
// MediaRecorder fallback (the preview engine playing into a capture stream), and audio export to WAV / MP3 / Ogg Opus
// / WebM from the shared mixdown (timeline/audio.js).
//
// Two export paths, chosen by capability, not by browser name:
// - WebCodecs (preferred): frame-exact and faster than real time. For each output frame k the needed source frames
//   are decoded, the compositor draws frame k into a canvas, and VideoEncoder encodes it with timestamp k/fps.
//   Nothing depends on playback timing, so a slow machine produces the same file, only later.
// - MediaRecorder (fallback): plays the project in real time into canvas.captureStream(). Takes as long as the
//   video, can drop frames under load, and its WebM lacks duration / cues (fixed afterwards).
// All audio comes from one offline mixdown (timeline/audio.js) shared with the preview's gain maths.
import { WebmMuxer } from '../webm/mux.js';
import { fixWebm } from '../webm/fix.js';
import { Mp4Muxer } from '../mp4/mux.js';
import { encodeWav } from '../wav/wav.js';
import { encodeMp3Async } from '../mp3/encoder.js';
import { muxOggOpus } from '../ogg/opus.js';
import { muxOpus } from '../weba/weba.js';
import { activeAt, frameSize, isStill, sourceTime } from '../timeline/model.js';
import { audioPieces, mixdown } from '../timeline/audio.js';
import { videoBitrate } from './geometry.js';
import { Engine } from './engine.js';

const abortError = () => new DOMException('Aborted', 'AbortError');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 48 kHz: the native rate of Opus and the common rate of video audio; AAC supports it too.
const RATE = 48000;

// ---------------------------------------------------------------------------------------------
// Capabilities

// Order = preference in the export dialog: VP9/WebM and H.264/MP4 first (widest playback support).
const FORMAT_DEFS = [
  { id: 'webm-vp9', container: 'webm', video: 'vp9', audio: 'opus', ext: 'webm', mime: 'video/webm', label: '=WebM · VP9 + Opus' },
  { id: 'mp4-h264', container: 'mp4', video: 'h264', audio: 'aac', ext: 'mp4', mime: 'video/mp4', label: '=MP4 · H.264 + AAC' },
  { id: 'webm-av1', container: 'webm', video: 'av1', audio: 'opus', ext: 'webm', mime: 'video/webm', label: '=WebM · AV1 + Opus' },
  { id: 'mp4-av1', container: 'mp4', video: 'av1', audio: 'aac', ext: 'mp4', mime: 'video/mp4', label: '=MP4 · AV1 + AAC' },
  { id: 'webm-vp8', container: 'webm', video: 'vp8', audio: 'opus', ext: 'webm', mime: 'video/webm', label: '=WebM · VP8 + Opus' },
  { id: 'mp4-vp9', container: 'mp4', video: 'vp9', audio: 'opus', ext: 'mp4', mime: 'video/mp4', label: '=MP4 · VP9 + Opus' },
];

// isConfigSupported is the only reliable probe: codec availability differs by OS, GPU and build (H.264 is absent in
// some Linux builds, AV1 encoding often missing). It can throw on malformed configs, hence the try.
async function supported(kind, cfg) {
  try { return !!(await (kind === 'video' ? VideoEncoder : AudioEncoder).isConfigSupported(cfg)).supported; } catch { return false; }
}

/**
 * What this browser can export: { webcodecs, formats: [def], audioFormats: ['wav', 'mp3', 'opus'?, 'weba'?], realtime }.
 */
  // Audio codec fallback per container: MP4 can carry Opus as well as AAC, WebM only Opus. A format whose audio codec
  // is unavailable keeps its video and switches the audio (or drops it), with the label rewritten to match.
export async function capabilities() {
  const caps = { webcodecs: false, formats: [], audioFormats: ['wav', 'mp3'], realtime: false };
  const hasVE = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
  const hasAE = typeof AudioEncoder === 'function' && typeof AudioData === 'function';
  const opus = hasAE && await supported('audio', { codec: 'opus', sampleRate: RATE, numberOfChannels: 2, bitrate: 128000 });
  const aac = hasAE && await supported('audio', { codec: 'mp4a.40.2', sampleRate: RATE, numberOfChannels: 2, bitrate: 128000 });
  if (opus) caps.audioFormats.push('opus', 'weba');
  if (hasVE) {
    const base = { width: 1280, height: 720, bitrate: 2e6, framerate: 30 };
    const ok = {
      vp9: await supported('video', { ...base, codec: 'vp09.00.31.08' }),
      vp8: await supported('video', { ...base, codec: 'vp8' }),
      av1: await supported('video', { ...base, codec: 'av01.0.05M.08' }),
      h264: await supported('video', { ...base, codec: 'avc1.4d401f', avc: { format: 'avc' } }) || await supported('video', { ...base, codec: 'avc1.42e01f', avc: { format: 'avc' } }),
    };
    for (const d of FORMAT_DEFS) {
      if (!ok[d.video]) continue;
      let audio = d.audio;
      if (audio === 'aac' && !aac) audio = opus ? 'opus' : null;
      if (audio === 'opus' && !opus) audio = d.container === 'mp4' && aac ? 'aac' : null;
      caps.formats.push({ ...d, audio, label: audio === d.audio ? d.label : d.label.replace(/AAC|Opus/, audio === 'aac' ? 'AAC' : audio === 'opus' ? 'Opus' : '—') });
    }
    caps.webcodecs = caps.formats.length > 0;
  }
  if (!caps.webcodecs && typeof MediaRecorder === 'function') {
    for (const [mime, ext, label] of [['video/webm;codecs=vp9,opus', 'webm', '=WebM · VP9 (real time)'], ['video/webm;codecs=vp8,opus', 'webm', '=WebM · VP8 (real time)'], ['video/webm', 'webm', '=WebM (real time)'], ['video/mp4', 'mp4', '=MP4 (real time)']]) {
      if (MediaRecorder.isTypeSupported(mime) && !caps.formats.some((f) => f.ext === ext)) caps.formats.push({ id: 'rec-' + ext, container: ext, realtime: true, ext, mime, recMime: mime, label, video: ext === 'mp4' ? 'h264' : 'vp9' });
    }
    caps.realtime = caps.formats.length > 0;
  }
  caps.aac = aac;
  caps.opus = opus;
  return caps;
}

// Codec string with a level that fits the output.
// Codec strings carry a level: the decoder / encoder capability class (max picture size and samples per second).
// A too-low level is rejected by isConfigSupported for big outputs; a needlessly high one may be rejected by
// hardware encoders. Thresholds follow the VP9 / AV1 level tables and H.264 Annex A (macroblocks per frame and per
// second). The H.264 return value is only the level byte in hex; the profile is prefixed by videoEncoderConfig.
function codecString(kind, w, h, fps) {
  const px = w * h, rate = px * fps;
  if (kind === 'vp8') return 'vp8';
  if (kind === 'vp9') {
    const lv = px <= 36864 ? 10 : px <= 122880 ? 20 : px <= 245760 ? 21 : px <= 552960 ? 30 : px <= 983040 ? 31 : px <= 2228224 ? (rate <= 83558400 ? 40 : 41) : px <= 8912896 ? (rate <= 311951360 ? 50 : 51) : 60;
    return `vp09.00.${lv}.08`;
  }
  if (kind === 'av1') {
    const lv = px <= 147456 ? 0 : px <= 278784 ? 1 : px <= 665856 ? 4 : px <= 1065024 ? 5 : px <= 2359296 ? (rate <= 70778880 ? 8 : 9) : px <= 8912896 ? (rate <= 267386880 ? 12 : 13) : 16;
    return `av01.0.${String(lv).padStart(2, '0')}M.08`;
  }
  // H.264: level from macroblocks per frame / per second.
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = mbs * fps;
  const levels = [[30, 1620, 40500], [31, 3600, 108000], [32, 5120, 216000], [40, 8192, 245760], [42, 8704, 522240], [50, 22080, 589824], [51, 36864, 983040], [52, 36864, 2073600]];
  const lv = (levels.find(([, fs, ps]) => mbs <= fs && mbps <= ps) || levels[levels.length - 1])[0];
  return lv.toString(16).padStart(2, '0');
}

// H.264 profiles tried from best to most compatible: High (64), Main (4d), Baseline (42). avc.format 'avc' makes the
// encoder emit length-prefixed NAL units plus an avcC description, which MP4 needs (Annex B start codes would not
// mux correctly). latencyMode 'quality': offline export, so favour quality over encode latency.
async function videoEncoderConfig(kind, w, h, fps, bitrate) {
  const common = { width: w, height: h, framerate: fps, bitrate, latencyMode: 'quality' };
  if (kind !== 'h264') {
    const cfg = { ...common, codec: codecString(kind, w, h, fps) };
    if (await supported('video', cfg)) return cfg;
    throw new Error(`${kind.toUpperCase()} ${w}×${h} is not supported by this browser`);
  }
  const lv = codecString('h264', w, h, fps);
  for (const p of ['6400', '4d00', '4200']) {
    const cfg = { ...common, codec: `avc1.${p}${lv}`, avc: { format: 'avc' } };
    if (await supported('video', cfg)) return cfg;
  }
  throw new Error(`H.264 ${w}×${h} is not supported by this browser`);
}

/** Bits per second of a quality preset (or an explicit rate) for the output. */
export function targetBitrate(W, H, fps, quality, codec, explicit = 0) {
  return explicit > 0 ? Math.round(explicit) : videoBitrate(W, H, fps, quality, codec === 'vp9' ? 'vp09' : codec === 'av1' ? 'av01' : codec === 'vp8' ? 'vp8' : 'avc1');
}

// ---------------------------------------------------------------------------------------------
// Frame sources

/** Decodes the demuxed samples of a source with VideoDecoder and returns the frame shown at a time. */
// Decode path: start at the last keyframe at or before the clip's first frame (decoding must begin at a keyframe;
// +1000 us tolerates timestamp rounding), then feed chunks lazily, at most 6 queued in the decoder (bounded memory:
// decoded frames are large GPU / CPU surfaces).
class DecoderSource {
  constructor(demux, startUs) {
    this.samples = demux.samples;
    this.config = demux.config;
    let k = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      if (s.keyframe && s.timestamp <= startUs + 1000) k = i;
      if (s.timestamp > startUs && s.keyframe) break;
    }
    this.next = k;
    this.queue = [];
    this.flushed = false;
    this.error = null;
    this.wake = null;
  }

  async init() {
    try { if (!(await VideoDecoder.isConfigSupported(this.config)).supported) return false; } catch { return false; }
    this.dec = new VideoDecoder({
      output: (f) => { this.queue.push(f); this.poke(); },
      error: (e) => { this.error = e; this.poke(); },
    });
    this.dec.configure(this.config);
    return true;
  }

  poke() { const w = this.wake; this.wake = null; if (w) w(); }
  // Wait until the decoder outputs a frame, or 30 ms, whichever first (output callbacks are asynchronous).
  waitOutput() { return new Promise((r) => { this.wake = r; setTimeout(r, 30); }); }

  // Returns the frame shown at `us`: the last decoded frame with timestamp <= us (+0.5 ms tolerance). Older frames
  // are closed immediately: VideoFrames hold decoder buffers, and leaking them stalls the decoder.
  async frameAt(us) {
    for (;;) {
      if (this.error) throw this.error;
      const last = this.queue[this.queue.length - 1];
      if ((last && last.timestamp > us + 500) || this.flushed) break;
      if (this.next < this.samples.length) {
        while (this.next < this.samples.length && this.dec.decodeQueueSize < 6) {
          const s = this.samples[this.next++];
          this.dec.decode(new EncodedVideoChunk({ type: s.keyframe ? 'key' : 'delta', timestamp: s.timestamp, duration: s.duration ?? undefined, data: s.data }));
        }
        await this.waitOutput();
      } else {
        await this.dec.flush();
        this.flushed = true;
      }
    }
    this.queue.sort((a, b) => a.timestamp - b.timestamp);
    let idx = -1;
    for (let i = 0; i < this.queue.length; i++) if (this.queue[i].timestamp <= us + 500) idx = i;
    if (idx < 0) idx = 0;
    for (const f of this.queue.splice(0, idx)) f.close();
    return this.queue[0] || null;
  }

  close() {
    for (const f of this.queue) f.close();
    this.queue = [];
    try { if (this.dec && this.dec.state !== 'closed') this.dec.close(); } catch { /* closed */ }
  }
}

/** Seeks a (hidden) video element: works for everything the browser plays, slower than decoding. */
// Fallback frame source for anything the browser can play but we cannot demux (or rotated video, see frameSource):
// seek a hidden <video> to each frame time and draw the element. Slower (one seek per frame) but universal.
class SeekSource {
  constructor(url) { this.url = url; }
  async init() {
    const v = this.v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.append(v);
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('the browser cannot decode this video')); v.src = this.url; });
    return true;
  }
  async frameAt(us) {
    const t = us / 1e6;
    if (Math.abs(this.v.currentTime - t) > 1e-4 || this.v.readyState < 2) {
      await new Promise((res) => { const done = () => { clearTimeout(tm); res(); }; const tm = setTimeout(done, 4000); this.v.addEventListener('seeked', done, { once: true }); this.v.currentTime = t; });
    }
    return this.v;
  }
  close() { this.v?.removeAttribute('src'); this.v?.load(); this.v?.remove(); }
}

// Rotated sources (phone video with a rotation matrix) go through the <video> element: it applies the rotation,
// while raw VideoFrames from the decoder do not.
async function frameSource(m, startUs) {
  const d = m.probe?.demux?.video;
  if (d && typeof VideoDecoder === 'function' && !m.rotation) {
    const s = new DecoderSource(d, startUs);
    if (await s.init()) return s;
  }
  const s = new SeekSource(m.url);
  await s.init();
  return s;
}

// ---------------------------------------------------------------------------------------------
// Audio

// PCM to the encoder in 1 s AudioData blocks, planar float32. Timestamps derive from sample positions, not from
// accumulated durations, so no rounding drift builds up over long files.
function feedAudio(enc, chans, rate, startFrame) {
  const step = rate; // 1 s per AudioData
  const n = chans[0].length, nch = chans.length;
  for (let i = 0; i < n; i += step) {
    const len = Math.min(step, n - i);
    const d = new Float32Array(len * nch);
    for (let c = 0; c < nch; c++) d.set(chans[c].subarray(i, i + len), c * len);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: len, numberOfChannels: nch, timestamp: Math.round(((startFrame + i) * 1e6) / rate), data: d });
    enc.encode(ad);
    ad.close();
  }
}

/** The whole project's audio at 48 kHz stereo (null when nothing is audible). */
export async function projectAudio(project, L, store, onProgress) {
  if (!audioPieces(project, L).length) return null;
  return mixdown(project, L, (id) => store.audio(id, RATE), RATE, 2, onProgress);
}

// ---------------------------------------------------------------------------------------------
// Video export (WebCodecs)

/**
 * Renders the project to a video file.
 *   job { project, L, store, compositor, format (capabilities def), short (short side px), fps, quality,
 *         bitrate (bit/s, 0 = quality), audio (include), signal, onProgress(fraction, phase) }
 * Returns { blob, width, height, frames, fps }.
 */
// Audio is mixed and fully queued into the AudioEncoder up front; video frames follow. Muxers interleave by
// timestamp, so the order of encoding does not matter for the file.
export async function exportVideo(job) {
  const { project, L, store, compositor, format, signal } = job;
  const { width: W, height: H } = frameSize(project.aspect, job.short || 1080);
  const fps = +job.fps || project.fps || 30;
  if (format.realtime) return exportRealtime({ ...job, W, H, fps });
  const progress = job.onProgress || (() => {});
  const vcfg = await videoEncoderConfig(format.video, W, H, fps, targetBitrate(W, H, fps, job.quality, format.video, job.bitrate));
  let pcm = null;
  if (job.audio !== false && format.audio) {
    progress(0, 'audio');
    pcm = await projectAudio(project, L, store, (f) => progress(f * 0.1, 'audio'));
  }
  if (signal?.aborted) throw abortError();
  const acodec = format.audio === 'aac' ? 'mp4a.40.2' : 'opus';
  const muxCfg = { video: { codec: vcfg.codec, width: W, height: H, frameRate: fps }, audio: pcm ? { codec: acodec, sampleRate: RATE, channels: 2 } : null };
  const mux = format.container === 'webm' ? new WebmMuxer({ ...muxCfg, writingApp: 'in-html video processor', title: project.name }) : new Mp4Muxer({ ...muxCfg, metadata: { encoder: 'in-html video processor', title: project.name } });
  let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: (e) => { failure = e; } });
  venc.configure(vcfg);
  let aenc = null;
  if (pcm) {
    aenc = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: (e) => { failure = e; } });
    aenc.configure({ codec: acodec, sampleRate: RATE, numberOfChannels: 2, bitrate: 160000 });
    feedAudio(aenc, pcm, RATE, 0);
  }
  // A DOM canvas: its 2D filters may reference the SVG colour filters of the document.
  // alpha:false: video has no alpha; an opaque context lets the browser skip premultiplication work per frame.
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d', { alpha: false });
  const total = Math.max(1, Math.round(L.total * fps));
  // A keyframe every 2 s: seekable output with moderate size overhead.
  const gop = Math.max(1, Math.round(fps * 2));
  const sources = new Map(); // main entry index -> frame source
  const imageOf = (id) => store.get(id)?.bitmap || null;
  try {
    for (let k = 0; k < total; k++) {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;
      const t = k / fps;
      const act = activeAt(L, t).main;
      // Close the sources of clips that are over.
      for (const [i, s] of sources) { if (!act.some((e) => e.index === i)) { s.close(); sources.delete(i); } }
      const frames = new Map();
      for (const e of act) {
        const m = store.get(e.media?.id);
        if (!m) continue;
        if (isStill(e.media)) { frames.set(e, m.bitmap); continue; }
        const us = Math.round(sourceTime(e, t) * 1e6);
        let s = sources.get(e.index);
        if (!s) { s = await frameSource(m, us); sources.set(e.index, s); }
        frames.set(e, await s.frameAt(us));
      }
      compositor.render(ctx, W, H, project, L, t, (e) => frames.get(e) || null, imageOf);
      const vf = new VideoFrame(canvas, { timestamp: Math.round((k * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: k % gop === 0 });
      vf.close();
      // Back-pressure: without it, the loop would queue thousands of VideoFrames (canvas copies) and exhaust memory.
      while (venc.encodeQueueSize > 4) { await sleep(4); if (failure) throw failure; }
      if (k % 3 === 0) progress(0.1 + 0.88 * (k / total), 'video');
    }
    progress(0.99, 'mux');
    await venc.flush();
    if (aenc) await aenc.flush();
    if (failure) throw failure;
    const parts = mux.finalize({ parts: true });
    progress(1, 'mux');
    return { blob: new Blob(parts, { type: format.mime }), width: W, height: H, frames: total, fps };
  } finally {
    for (const s of sources.values()) s.close();
    for (const e of [venc, aenc]) { try { if (e && e.state !== 'closed') e.close(); } catch { /* closed */ } }
  }
}

// ---------------------------------------------------------------------------------------------
// Real-time fallback: the preview engine plays into a canvas capture stream, the mixdown into its audio track.

// Audio: the mixdown is played by an AudioBufferSourceNode into a MediaStreamDestination whose track joins the
// canvas stream. The AudioContext may refuse to start without a recent user gesture; after 500 ms the export
// continues without sound and reports audio:false so the dialog can warn.
async function exportRealtime(job) {
  const { project, L, store, compositor, format, signal, W, H, fps } = job;
  const progress = job.onProgress || (() => {});
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const stream = canvas.captureStream(fps);
  let ac = null;
  const pcm = job.audio !== false ? await projectAudio(project, L, store) : null;
  let node = null;
  if (pcm && typeof AudioContext === 'function') {
    ac = new AudioContext({ sampleRate: RATE });
    await Promise.race([ac.resume().catch(() => {}), sleep(500)]);
    if (ac.state === 'running') {
      const buf = ac.createBuffer(2, pcm[0].length, RATE);
      buf.copyToChannel(pcm[0], 0);
      buf.copyToChannel(pcm[1], 1);
      const dest = ac.createMediaStreamDestination();
      node = ac.createBufferSource();
      node.buffer = buf;
      node.connect(dest);
      stream.addTrack(dest.stream.getAudioTracks()[0]);
    }
  }
  const engine = new Engine({ canvas, store, compositor, silent: true });
  engine.setProject(project, L);
  const rec = new MediaRecorder(stream, { mimeType: format.recMime, videoBitsPerSecond: targetBitrate(W, H, fps, job.quality, format.video, job.bitrate) });
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
  try {
    engine.seek(0);
    await sleep(300);
    // 1 s timeslices: data arrives incrementally, so a crash late in a long recording does not lose everything.
    rec.start(1000);
    node?.start();
    const ended = new Promise((r) => { engine.o.onEnded = r; });
    engine.o.onTime = (t) => progress(Math.min(0.98, t / Math.max(0.001, L.total)), 'video');
    await engine.play();
    await Promise.race([ended, new Promise((_, rej) => signal?.addEventListener('abort', () => rej(abortError()), { once: true }))]);
    progress(1, 'mux');
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.stop();
    await stopped;
    let blob = new Blob(parts, { type: format.mime });
    if (format.container === 'webm') {
      const fixed = fixWebm(new Uint8Array(await blob.arrayBuffer()), { duration: L.total });
      blob = new Blob([fixed.bytes], { type: 'video/webm' });
    }
    return { blob, width: W, height: H, fps, realtime: true, audio: !!node };
  } finally {
    engine.destroy();
    if (rec.state !== 'inactive') { try { rec.stop(); } catch { /* stopped */ } }
    for (const t of stream.getTracks()) t.stop();
    if (ac) ac.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// Audio export

/**
 * Renders the project audio and encodes it.
 *   job { project, L, store, format: 'wav' | 'mp3' | 'opus' | 'weba', mp3Bitrate, signal, onProgress(fraction, phase) }
 * Returns { blob, ext, duration }.
 */
// WAV and MP3 are encoded by our own code (work everywhere); Opus needs WebCodecs. The Opus header (decoderConfig
// description) from the first output is required by both Ogg and WebM muxers.
export async function exportAudio(job) {
  const { project, L, store, format, signal } = job;
  const progress = job.onProgress || (() => {});
  const chans = await projectAudio(project, L, store, (f) => progress(f * 0.4, 'audio'));
  if (!chans) throw new Error('no audio in the project');
  if (signal?.aborted) throw abortError();
  const rate = RATE, nch = 2, total = chans[0].length;
  const duration = total / rate;
  const enc = (f) => progress(0.4 + f * 0.6, 'encode');
  if (format === 'wav') {
    enc(0.5);
    return { blob: new Blob([encodeWav(chans, { sampleRate: rate, bitDepth: 16, info: { software: 'in-html video processor', title: project.name } })], { type: 'audio/wav' }), ext: 'wav', duration };
  }
  if (format === 'mp3') {
    const bytes = await encodeMp3Async(chans, { sampleRate: rate, bitrate: job.mp3Bitrate || 192, channels: nch, onProgress: enc, signal });
    return { blob: new Blob([bytes], { type: 'audio/mpeg' }), ext: 'mp3', duration };
  }
  // Opus through WebCodecs, then Ogg or WebM.
  const packets = [];
  let head = null, failure = null;
  const ae = new AudioEncoder({
    output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); packets.push({ data: d, timestamp: c.timestamp, duration: c.duration }); if (m?.decoderConfig?.description && !head) head = new Uint8Array(m.decoderConfig.description); },
    error: (e) => { failure = e; },
  });
  ae.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: nch, bitrate: 160000 });
  const step = rate * 5;
  for (let i = 0; i < total; i += step) {
    if (signal?.aborted) { ae.close(); throw abortError(); }
    feedAudio(ae, chans.map((c) => c.subarray(i, Math.min(total, i + step))), rate, i);
    enc(i / total);
    while (ae.encodeQueueSize > 8) await sleep(4);
  }
  await ae.flush();
  ae.close();
  if (failure) throw failure;
  if (format === 'opus') {
    const bytes = muxOggOpus(packets.map((p) => p.data), { head, channels: nch, totalSamples: total, tags: { encoder: 'in-html video processor', title: project.name } });
    return { blob: new Blob([bytes], { type: 'audio/ogg' }), ext: 'opus', duration };
  }
  const bytes = muxOpus(packets, { head, channels: nch, sampleRate: rate });
  return { blob: new Blob([bytes], { type: 'audio/webm' }), ext: 'weba', duration };
}
