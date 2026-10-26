// player/analysis.js - audio analysis on decoded samples (Float32Array channels, e.g. from WebAudio decodeAudioData
// or wav/decodeWav), for loudness normalization, mood / energy playlists and seek-bar waveforms. These are honest
// estimates: loudness follows ITU-R BS.1770-4 / EBU R128 (K-weighting, 400 ms blocks with 75 % overlap, absolute
// gate -70 LUFS, relative gate -10 LU), loudness range follows EBU Tech 3342 (3 s blocks, 10th–95th percentile);
// the tempo is the strongest periodicity of a spectral-flux onset envelope (60–200 BPM, octave errors possible, a
// confidence is reported); energy is a heuristic of loudness, onset density, tempo and brightness.
//
//   kWeighting(sampleRate) -> [{ b: [b0, b1, b2], a: [a1, a2] }, …] (two biquads)
//   loudness(channels, sampleRate, { weights }) -> { integrated (LUFS), range (LU), samplePeak (dBFS), momentaryMax, shortTermMax }
//   estimateTempo(samples, sampleRate) -> { bpm, confidence (0..1), onsetsPerSecond }
//   spectralCentroid(samples, sampleRate) -> Hz (average over frames)
//   energyScore({ lufs, bpm, onsetsPerSecond, centroid }) -> 0..10
//   analyze(channels, sampleRate, { maxSeconds = 120 }) -> { lufs, lra, peak, bpm, tempoConfidence, energy, centroid }
//   waveform(samples, buckets) -> { peaks: Float32Array, rms: Float32Array }
//   mixdown(channels) -> Float32Array ; fft(re, im) in place (radix 2)

// K-weighting = a high-shelf pre-filter (head acoustics, about +4 dB above 2 kHz) followed by the RLB high-pass;
// coefficients are derived for the actual sample rate instead of using the 48 kHz table of the spec.
export function kWeighting(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [s1, s2];
}

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// BS.1770: loudness = -0.691 + 10 log10(mean square), the constant calibrating a 997 Hz sine at 0 dBFS to -3.01 LKFS.
const lufsOf = (z) => (z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity);

// Two-stage gating removes silence (absolute gate) and quiet passages relative to the programme (relative gate),
// so a track with a long fade-out is not judged quieter than it sounds.
export function loudness(channels, sampleRate, { weights = null } = {}) {
  const chans = channels.length > 5 ? channels.slice(0, 5) : channels;
  const w = weights || chans.map((_, i) => (i >= 3 ? 1.41 : 1));
  const filtered = chans.map((c) => kWeighting(sampleRate).reduce((x, s) => biquad(x, s), c));
  const n = filtered[0] ? filtered[0].length : 0;
  let peak = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
  const blockPower = (len, step) => {
    const out = [];
    for (let start = 0; start + len <= n; start += step) {
      let z = 0;
      for (let ch = 0; ch < filtered.length; ch++) {
        let s = 0;
        const f = filtered[ch];
        for (let i = start; i < start + len; i++) s += f[i] * f[i];
        z += w[ch] * (s / len);
      }
      out.push(z);
    }
    return out;
  };
  const m = blockPower(Math.round(0.4 * sampleRate), Math.round(0.1 * sampleRate));
  const abs = m.filter((z) => lufsOf(z) > -70);
  let integrated = -Infinity;
  if (abs.length) {
    const ungated = abs.reduce((s, z) => s + z, 0) / abs.length;
    const rel = lufsOf(ungated) - 10;
    const gated = abs.filter((z) => lufsOf(z) > rel);
    if (gated.length) integrated = lufsOf(gated.reduce((s, z) => s + z, 0) / gated.length);
  }
  const st = blockPower(Math.round(3 * sampleRate), Math.round(0.1 * sampleRate));
  let range = 0;
  const stAbs = st.filter((z) => lufsOf(z) > -70);
  if (stAbs.length > 1) {
    const mean = stAbs.reduce((s, z) => s + z, 0) / stAbs.length;
    const rel = lufsOf(mean) - 20;
    const l = stAbs.map(lufsOf).filter((x) => x > rel).sort((a, b) => a - b);
    if (l.length > 1) range = l[Math.min(l.length - 1, Math.round(0.95 * (l.length - 1)))] - l[Math.round(0.1 * (l.length - 1))];
  }
  return {
    integrated: Number.isFinite(integrated) ? Math.round(integrated * 100) / 100 : null,
    range: Math.round(range * 100) / 100,
    samplePeak: peak > 0 ? Math.round(20 * Math.log10(peak) * 100) / 100 : null,
    momentaryMax: m.length ? Math.round(Math.max(...m.map(lufsOf)) * 100) / 100 : null,
    shortTermMax: st.length ? Math.round(Math.max(...st.map(lufsOf)) * 100) / 100 : null,
  };
}

// Iterative radix-2 Cooley-Tukey: bit-reversal permutation then butterflies; length must be a power of two.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export function mixdown(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i] / channels.length;
  return out;
}

// Downsampled mono (about 11 kHz) for the spectral analysis: cheap and enough for onsets and brightness.
function decimate(x, fs) {
  const f = Math.max(1, Math.floor(fs / 11025));
  if (f === 1) return { x, fs };
  const out = new Float32Array(Math.floor(x.length / f));
  for (let i = 0; i < out.length; i++) { let s = 0; for (let k = 0; k < f; k++) s += x[i * f + k]; out[i] = s / f; }
  return { x: out, fs: fs / f };
}

function frames(x, size, hop, fn) {
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float32Array(size), im = new Float32Array(size);
  for (let start = 0; start + size <= x.length; start += hop) {
    for (let i = 0; i < size; i++) { re[i] = x[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    fn(re, im, start);
  }
}

export function spectralCentroid(samples, sampleRate) {
  const { x, fs } = decimate(samples, sampleRate);
  const size = 1024;
  let sum = 0, n = 0;
  frames(x, size, size, (re, im) => {
    let num = 0, den = 0;
    for (let k = 1; k < size / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * (k * fs / size); den += m; }
    if (den > 1e-6) { sum += num / den; n++; }
  });
  return n ? sum / n : 0;
}

// Onset envelope (spectral flux) -> autocorrelation over lags of 60-200 BPM -> strongest lag. Half / double tempo
// confusion is inherent to the method, hence the confidence value.
export function estimateTempo(samples, sampleRate) {
  const { x, fs } = decimate(samples, sampleRate);
  const size = 1024, hop = 256;
  const env = [];
  let prev = null;
  frames(x, size, hop, (re, im) => {
    const mag = new Float32Array(size / 2);
    for (let k = 0; k < size / 2; k++) mag[k] = Math.log1p(1000 * Math.hypot(re[k], im[k]));
    let flux = 0;
    if (prev) for (let k = 1; k < size / 2; k++) { const d = mag[k] - prev[k]; if (d > 0) flux += d; }
    env.push(flux);
    prev = mag;
  });
  const rate = fs / hop;
  if (env.length < rate * 4) return { bpm: null, confidence: 0, onsetsPerSecond: 0 };
  // Normalize and remove the slow trend.
  const mean = env.reduce((s, v) => s + v, 0) / env.length;
  const o = env.map((v) => Math.max(0, v - mean));
  let onsets = 0;
  const thr = Math.max(...o) * 0.3;
  for (let i = 1; i < o.length - 1; i++) if (o[i] > thr && o[i] >= o[i - 1] && o[i] > o[i + 1]) onsets++;
  const lagOf = (bpm) => (60 / bpm) * rate;
  const ac = (lag) => {
    const L = Math.floor(lag), fr = lag - L;
    let s = 0;
    for (let i = 0; i + L + 1 < o.length; i++) s += o[i] * (o[i + L] * (1 - fr) + o[i + L + 1] * fr);
    return s / (o.length - L);
  };
  let best = null, bestScore = -Infinity;
  const scores = [];
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    // A comb over multiples of the beat period (1/k weights): a tempo and its half score alike when every beat is
    // also on the slow grid, and the prior below then prefers the one nearer 120 BPM.
    let v = 0;
    for (let k = 1; k <= 4; k++) v += ac(lagOf(bpm) * k) / k;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const s = v * (0.6 + 0.4 * prior);
    scores.push(s);
    if (s > bestScore) { bestScore = s; best = bpm; }
  }
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const confidence = avg > 0 ? Math.max(0, Math.min(1, (bestScore / avg - 1) / 3)) : 0;
  return { bpm: best, confidence: Math.round(confidence * 100) / 100, onsetsPerSecond: Math.round((onsets / (env.length / rate)) * 100) / 100 };
}

export function energyScore({ lufs = null, bpm = null, onsetsPerSecond = 0, centroid = 0 } = {}) {
  const loud = lufs == null ? 0.5 : Math.max(0, Math.min(1, (lufs + 30) / 22));
  const tempo = bpm == null ? 0.5 : Math.max(0, Math.min(1, (bpm - 60) / 120));
  const dens = Math.max(0, Math.min(1, onsetsPerSecond / 6));
  const bright = Math.max(0, Math.min(1, (centroid - 500) / 2500));
  return Math.round((loud * 0.4 + tempo * 0.2 + dens * 0.25 + bright * 0.15) * 100) / 10;
}

export function analyze(channels, sampleRate, { maxSeconds = 120 } = {}) {
  const limit = Math.min(channels[0].length, Math.round(maxSeconds * sampleRate));
  const part = channels.map((c) => c.subarray ? c.subarray(0, limit) : c.slice(0, limit));
  const L = loudness(part, sampleRate);
  const mono = mixdown(part);
  const t = estimateTempo(mono, sampleRate);
  const centroid = spectralCentroid(mono, sampleRate);
  return {
    lufs: L.integrated, lra: L.range, peak: L.samplePeak, bpm: t.bpm, tempoConfidence: t.confidence, onsetsPerSecond: t.onsetsPerSecond,
    centroid: Math.round(centroid), energy: energyScore({ lufs: L.integrated, bpm: t.confidence > 0.15 ? t.bpm : null, onsetsPerSecond: t.onsetsPerSecond, centroid }),
  };
}

// Peak and RMS per bucket: peaks give the familiar outline, RMS the denser inner body of a seek-bar waveform.
export function waveform(samples, buckets = 200) {
  const peaks = new Float32Array(buckets), rms = new Float32Array(buckets);
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * per), e = Math.min(samples.length, Math.floor((b + 1) * per));
    let p = 0, q = 0;
    for (let i = s; i < e; i++) { const v = Math.abs(samples[i]); if (v > p) p = v; q += v * v; }
    peaks[b] = p;
    rms[b] = e > s ? Math.sqrt(q / (e - s)) : 0;
  }
  return { peaks, rms };
}
