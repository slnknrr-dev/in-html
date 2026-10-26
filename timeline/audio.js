// timeline/audio.js - the audio mix of a project as plain sample arithmetic (the browser export and the tests use it;
// the ffmpeg description builds the same mix with atempo / volume / afade / acrossfade / adelay / amix).
//
//   audioPieces(p, L) -> [Piece]   every audible part: the sound of main clips and the audio clips
//      Piece { ref, media, srcIn, srcOut (source s), speed, keepPitch, start, len (timeline s), volume, fadeIn,
//              fadeOut, xIn, xOut (transition cross-fades, s) }
//   gainAt(piece, t)               the gain at time t of the piece (0..len): volume x fades x cross-fades (linear
//                                  ramps, like afade / acrossfade with their default 'tri' curve)
//   timeStretch(chans, speed, rate)  WSOLA: duration / speed, pitch kept (atempo)
//   resample(chans, speed)         duration / speed, pitch follows (asetrate)
//   renderPiece(src, piece, rate, channels = 2) -> Float32Array[] of round(len * rate) samples
//   mixInto(out, pcm, at)          adds pcm into out from sample `at`
//   mixdown(p, L, getSource(mediaId) -> Float32Array[] | null, rate = 48000, channels = 2, onProgress)
//                                  -> Float32Array[] of the whole project (silence where nothing plays)

import { isStill } from './model.js';

export function audioPieces(p, L) {
  const out = [];
  for (const e of L.main) {
    const c = e.clip, m = e.media;
    if (!m || isStill(m) || !m.hasAudio || c.muted || c.volume <= 0) continue;
    out.push({ ref: c.id, media: m.id, srcIn: c.in, srcOut: c.out, speed: c.speed, keepPitch: c.keepPitch, start: e.start, len: e.len,
      volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, xIn: e.xIn, xOut: e.xOut });
  }
  for (const a of L.audio) {
    const c = a.clip;
    if (!a.media || c.muted || c.volume <= 0) continue;
    out.push({ ref: c.id, media: c.media, srcIn: c.in, srcOut: c.out, speed: 1, keepPitch: true, start: a.start, len: c.out - c.in,
      volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, xIn: 0, xOut: 0 });
  }
  return out;
}

export function gainAt(pc, t) {
  let g = pc.volume;
  const L = pc.len;
  if (pc.fadeIn > 0 && t < pc.fadeIn) g *= Math.max(0, t) / pc.fadeIn;
  if (pc.fadeOut > 0 && t > L - pc.fadeOut) g *= Math.max(0, L - t) / pc.fadeOut;
  if (pc.xIn > 0 && t < pc.xIn) g *= Math.max(0, t) / pc.xIn;
  if (pc.xOut > 0 && t > L - pc.xOut) g *= Math.max(0, L - t) / pc.xOut;
  return g;
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Waveform-similarity overlap-add: frames of ~30 ms are taken from the input every hop * speed samples, each shifted
 * by up to ±8 ms to the position that best continues the previous frame, and overlapped every hop samples.
 */
// Why WSOLA: plain resampling changes pitch with speed (chipmunk voices); phase vocoders keep pitch but smear
// transients. WSOLA keeps pitch and is simple. Hann windows at 50 % overlap sum to a constant, and `norm` divides
// out the actual window sum anyway, so edges and frame-skips do not change loudness. The similarity search uses a
// 4x decimated mono mix taken without a low-pass filter - aliasing is tolerable for a correlation peak search and
// it makes the inner loop 16x cheaper (4x shorter vectors, 4x fewer candidates).
export function timeStretch(chans, speed, rate) {
  const n = chans[0]?.length || 0;
  if (Math.abs(speed - 1) < 1e-4 || n === 0) return chans.map((c) => c.slice());
  const N = Math.max(128, Math.round(rate * 0.03) & ~1);
  const Hs = N >> 1;
  const Ha = Hs * speed;
  const D = Math.max(8, Math.round(rate * 0.008));
  const outLen = Math.max(1, Math.round(n / speed));
  const out = chans.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const win = hann(N);
  // Correlation runs on a mono, 4x decimated copy (fast enough for minutes of audio).
  const DEC = 4;
  const mn = Math.ceil(n / DEC);
  const mono = new Float32Array(mn);
  for (let i = 0; i < mn; i++) {
    let s = 0;
    for (const c of chans) s += c[Math.min(n - 1, i * DEC)];
    mono[i] = s;
  }
  const M = Math.max(4, Math.floor(Hs / DEC));
  let prev = 0;
  for (let k = 0; k * Hs < outLen; k++) {
    const outPos = k * Hs;
    let pos = Math.min(n - 1, Math.round(k * Ha));
    if (k > 0) {
      const target = Math.floor((prev + Hs) / DEC);
      const lo = Math.max(0, Math.floor((pos - D) / DEC)), hi = Math.min(mn - 1, Math.floor((pos + D) / DEC));
      let best = Math.floor(pos / DEC), bestV = -Infinity;
      for (let c = lo; c <= hi; c++) {
        let v = 0;
        const m = Math.min(M, mn - c, mn - target);
        for (let j = 0; j < m; j++) v += mono[target + j] * mono[c + j];
        if (v > bestV) { bestV = v; best = c; }
      }
      pos = Math.min(n - 1, best * DEC);
    }
    for (let i = 0; i < N; i++) {
      const s = pos + i;
      if (s >= n) break;
      const w = win[i];
      for (let ch = 0; ch < chans.length; ch++) out[ch][outPos + i] += chans[ch][s] * w;
      norm[outPos + i] += w;
    }
    prev = pos;
  }
  return out.map((o) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? o[i] / norm[i] : 0;
    return r;
  });
}

// Linear interpolation resampling (speed without pitch preservation, like a tape). No anti-alias filter: at speeds
// > 1 high frequencies fold back slightly - acceptable for a preview/export mix, and it matches the ffmpeg path's
// asetrate trick in spirit.
export function resample(chans, speed) {
  const n = chans[0]?.length || 0;
  const outLen = Math.max(1, Math.round(n / speed));
  return chans.map((c) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const x = i * speed, j = Math.floor(x), f = x - j;
      const a = c[Math.min(n - 1, j)] || 0, b = c[Math.min(n - 1, j + 1)] || 0;
      r[i] = a + (b - a) * f;
    }
    return r;
  });
}

export function renderPiece(src, pc, rate, channels = 2) {
  const len = Math.max(1, Math.round(pc.len * rate));
  const out = Array.from({ length: channels }, () => new Float32Array(len));
  if (!src || !src.length) return out;
  const a = Math.max(0, Math.round(pc.srcIn * rate)), b = Math.min(src[0].length, Math.round(pc.srcOut * rate));
  if (b <= a) return out;
  let part = src.map((c) => c.subarray(a, b));
  if (Math.abs(pc.speed - 1) > 1e-4) part = pc.keepPitch ? timeStretch(part, pc.speed, rate) : resample(part, pc.speed);
  for (let ch = 0; ch < channels; ch++) {
    const s = part[Math.min(ch, part.length - 1)], o = out[ch];
    const n = Math.min(len, s.length);
    for (let i = 0; i < n; i++) o[i] = s[i] * gainAt(pc, i / rate);
  }
  return out;
}

export function mixInto(out, pcm, at) {
  for (let ch = 0; ch < out.length; ch++) {
    const o = out[ch], s = pcm[Math.min(ch, pcm.length - 1)];
    const n = Math.min(s.length, o.length - at);
    for (let i = Math.max(0, -at); i < n; i++) o[at + i] += s[i];
  }
}

export async function mixdown(p, L, getSource, rate = 48000, channels = 2, onProgress = null) {
  const total = Math.max(1, Math.round(L.total * rate));
  const out = Array.from({ length: channels }, () => new Float32Array(total));
  const pieces = audioPieces(p, L);
  for (let i = 0; i < pieces.length; i++) {
    const pc = pieces[i];
    const src = await getSource(pc.media);
    if (src) mixInto(out, renderPiece(src, pc, rate, channels), Math.round(pc.start * rate));
    onProgress?.((i + 1) / pieces.length);
  }
  return out;
}
