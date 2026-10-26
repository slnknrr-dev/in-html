// player/gain.js - levels and tone: ReplayGain (track / album, preamp, clipping prevention), loudness normalization to
// a target (from measured LUFS), crossfade curves, the equalizer bands and presets, playback speeds.
//
//   dbToGain(db) / gainToDb(g)
//   replayGainFactor(rg, { mode: 'track' | 'album' | 'off', preamp = 0, fallback = 0, preventClip = true }) -> linear
//   normalizeFactor(lufs, { target = -14, maxBoost = 9, peak }) -> linear (null lufs -> 1)
//   levelFactor(media, settings) -> linear   (ReplayGain when tagged, else measured loudness, else 1)
//   crossfadeGains(t, duration, curve = 'equal-power' | 'linear' | 's') -> { out, in }
//   EQ_BANDS [Hz]  EQ_PRESETS { id: [dB per band] }  normEq(values) ; EQ_Q
//   SPEEDS ; clampSpeed(v)

// Decibels are amplitude ratios here: gain = 10^(dB/20) (20, not 10, because power goes with amplitude squared).
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

// Clipping prevention: if gain * peak would exceed full scale (1.0), the gain is lowered to exactly 1/peak, the
// ReplayGain spec's recommendation; album mode falls back to track values (and vice versa) when one is missing.
export function replayGainFactor(rg, { mode = 'track', preamp = 0, fallback = 0, preventClip = true } = {}) {
  if (mode === 'off') return 1;
  const gain = rg ? (mode === 'album' ? rg.albumGain ?? rg.trackGain : rg.trackGain ?? rg.albumGain) : null;
  const peak = rg ? (mode === 'album' ? rg.albumPeak ?? rg.trackPeak : rg.trackPeak ?? rg.albumPeak) : null;
  let f = dbToGain((gain ?? fallback) + preamp);
  if (preventClip && peak > 0 && f * peak > 1) f = 1 / peak;
  return f;
}

// -14 LUFS is the streaming-platform reference; boosts are capped (quiet recordings would otherwise amplify noise)
// and limited to keep the true peak under -1 dBFS.
export function normalizeFactor(lufs, { target = -14, maxBoost = 9, peak = null } = {}) {
  if (lufs == null || !Number.isFinite(lufs)) return 1;
  let db = Math.min(maxBoost, target - lufs);
  if (peak != null && Number.isFinite(peak)) db = Math.min(db, -1 - peak);
  return dbToGain(db);
}

export function levelFactor(media, { level = 'replaygain', preamp = 0, target = -14 } = {}) {
  if (!media || level === 'off') return 1;
  if (level !== 'loudness' && media.replaygain && (media.replaygain.trackGain != null || media.replaygain.albumGain != null)) return replayGainFactor(media.replaygain, { mode: level === 'album' ? 'album' : 'track', preamp });
  if (media.loudness != null) return normalizeFactor(media.loudness, { target, peak: media.peak ?? null });
  return 1;
}

// Equal-power (cos / sin) keeps out^2 + in^2 = 1, so perceived loudness does not dip mid-fade as it does with a
// linear fade of uncorrelated tracks.
export function crossfadeGains(t, duration, curve = 'equal-power') {
  const x = duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 1;
  if (curve === 'linear') return { out: 1 - x, in: x };
  if (curve === 's') { const s = x * x * (3 - 2 * x); return { out: 1 - s, in: s }; }
  return { out: Math.cos((x * Math.PI) / 2), in: Math.sin((x * Math.PI) / 2) };
}

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
// Octave-spaced bands; Q = sqrt(2) gives roughly one-octave bandwidth so adjacent peaking filters overlap smoothly.
export const EQ_Q = 1.41;
// Gains in dB for the ten bands.
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  rock: [4, 3, 1, -1, -1, 1, 3, 4, 4, 4],
  pop: [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1],
  jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  loudness: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5],
  spoken: [-4, -3, -1, 1, 3, 4, 4, 2, 0, -2],
  night: [-3, -2, -1, 0, 1, 1, 0, -1, -2, -3],
};

export const normEq = (v) => EQ_BANDS.map((_, i) => { const x = Array.isArray(v) ? Number(v[i]) : 0; return Number.isFinite(x) ? Math.max(-12, Math.min(12, x)) : 0; });

export const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const clampSpeed = (v) => (Number.isFinite(+v) ? Math.max(0.25, Math.min(4, +v)) : 1);
