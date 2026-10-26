// image-processor/worker.js - background side of the application: decodes, processes and encodes one image
// per job with progress messages, keeping the last decoded sources for fast live previews. The same runJob() serves
// the in-page fallback when no worker can be started. workerMain() binds the message protocol:
//   in:  { type: 'job', id, job: { key, file | bytes, name, type, settings, preview?, base?, draft? } } | { type: 'drop', key } | { type: 'clear' }
//   out: { type: 'ready' } | { type: 'progress', id, p, stage } | { type: 'done', id, result } | { type: 'error', id, message }

import { browserDecode, encodeWebP, watermarkLayer } from './canvas.js';
import { decodeInput } from './input.js';
import { encodeImage, normalizeSettings, outputName, processImage } from './pipeline.js';
import { encodePNG } from '../png/encode.js';
import { resize } from '../raster/resample.js';
import { runPhotoJob } from '../photo/jobs.js';

// Decoded sources are kept for the last 2 images (LRU by Map insertion order): live previews re-run the pipeline on
// every settings change, and re-decoding a 24 MP JPEG each time would dominate the latency. Two, not more: each
// decoded image is width x height x 4 bytes (~100 MB at 24 MP).
const cache = new Map(); // key -> decoded source (least recently used first)
const CACHE_MAX = 2;
// Yield to the event loop between stages so progress messages are flushed (and, in the in-page fallback, the UI can
// repaint) during long synchronous pixel work.
const tick = () => new Promise((r) => setTimeout(r, 0));

// Preview images are downscaled with 'area' averaging: the best quality for large reduction factors (no aliasing).
function fitPreview(img, max) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  return k >= 1 ? img : resize(img, img.width * k, img.height * k, 'area');
}

export function dropCached(key) { if (key == null) cache.clear(); else cache.delete(key); }

/**
 * One job: { key, file | bytes, name, type, settings, preview (max preview edge, 0 = none), base (pre-crop preview),
 * draft (max edge: process a downscaled copy for a quick look) }.
 * progress(p 0..1, stage). Returns { bytes, mime, ext, format, name, width, height, before, base, geometry, crop, warning }.
 */
// Draft mode processes a cached downscaled copy for instant feedback while dragging sliders; settings measured in
// pixels (blur, sharpen radius, absolute resize) are scaled by the same factor so the draft looks like the final.
// The final encode keeps EXIF/ICC/text from the source (encodeImage decides what to keep based on settings).
export async function runJob(job, progress = () => {}) {
  // the editor's heavy pixel work (filters, resampling) shares this worker
  if (job.photo) return runPhotoJob(job.photo);
  const s = normalizeSettings(job.settings);
  progress(0.02, 'decode');
  let src = cache.get(job.key);
  if (src) { cache.delete(job.key); cache.set(job.key, src); }
  else {
    const bytes = job.bytes ? new Uint8Array(job.bytes) : new Uint8Array(await job.file.arrayBuffer());
    src = await decodeInput(bytes, job.type, { browserDecode });
    if (job.key != null) { cache.set(job.key, src); while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }
  }
  progress(0.3, 'process');
  await tick();
  // Draft: the same settings on a cached downscaled source (pixel-sized settings scaled along) for a quick look.
  let img = src.img;
  if (job.draft && Math.max(img.width, img.height) > job.draft) {
    if (!src.draftImg || src.draftEdge !== job.draft) {
      const k = job.draft / Math.max(img.width, img.height);
      src.draftImg = resize(img, img.width * k, img.height * k, 'area');
      src.draftEdge = job.draft;
    }
    const k = src.draftImg.width / img.width;
    img = src.draftImg;
    s.filters.blur *= k;
    s.filters.sharpenRadius = Math.max(0.3, s.filters.sharpenRadius * k);
    if (s.resize.mode !== 'percent') { s.resize.width = Math.round(s.resize.width * k); s.resize.height = Math.round(s.resize.height * k); }
  }
  const at = { resize: 0.35, cutout: 0.42, adjust: 0.5, blur: 0.55, sharpen: 0.6 };
  const r = await processImage(img, s, {
    orientation: src.orientation, before: !!job.preview, base: !!job.base, preview: (x) => fitPreview(x, job.preview || 1600),
    env: { watermarkLayer }, step: async (name) => { progress(at[name] || 0.5, name); await tick(); },
  });
  // raw: the processed pixels themselves (the editor opens the Transform result)
  if (job.raw) { progress(1, 'done'); return { img: r.image, width: r.image.width, height: r.image.height, name: job.name }; }
  progress(0.7, 'encode');
  await tick();
  const enc = await encodeImage(r.image, s, { kind: src.kind, exif: src.exif, icc: src.icc, text: src.text, orientation: src.orientation }, { encodeWebP });
  progress(1, 'done');
  return {
    bytes: enc.bytes, mime: enc.mime, ext: enc.ext, format: enc.format, name: outputName(job.name, s, enc.ext),
    width: r.image.width, height: r.image.height, before: r.before || null, base: r.base || null, geometry: r.geometry, crop: r.crop,
    via: src.via, warning: enc.warning || r.warning || null, draft: img !== src.img,
    // an .ico holds square sizes: the page previews the processed pixels as a quick PNG instead
    preview: enc.format === 'ico' && job.preview ? encodePNG(r.image, { level: 1 }) : null,
  };
}

// Transfer (not copy) the result buffers to the page: zero-copy hand-off of potentially hundreds of MB. A Set removes
// duplicates, because transferring the same buffer twice throws a DataCloneError.
const transferables = (res) => [res.bytes && res.bytes.buffer, res.preview && res.preview.buffer, res.before && res.before.data.buffer, res.base && res.base.data.buffer, res.img && res.img.data.buffer].filter(Boolean);

/** Worker entry: message protocol (see the header). */
// Errors are reported per job id; the worker stays alive for the next job.
export function workerMain() {
  self.onmessage = async (e) => {
    const m = e.data || {};
    if (m.type === 'drop') { dropCached(m.key); return; }
    if (m.type === 'clear') { dropCached(null); return; }
    if (m.type !== 'job') return;
    try {
      const res = await runJob(m.job, (p, stage) => self.postMessage({ type: 'progress', id: m.id, p, stage }));
      self.postMessage({ type: 'done', id: m.id, result: res }, [...new Set(transferables(res))]);
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
    }
  };
  self.postMessage({ type: 'ready' });
}
