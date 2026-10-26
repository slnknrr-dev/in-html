// miner-game/sound.js - small synthesized sound effects (WebAudio oscillators and noise, no sound files):
// reveal tick, cascade swish, flag pluck, chord, explosion, win fanfare, hint chime. Off until the player turns
// sound on; the audio context starts on the first sound after a user gesture.

//
// Why synthesis: zero asset bytes (the game ships as one offline HTML file) and every effect is a few envelope
// parameters. Browsers block audio until a user gesture; the context is created lazily on the first play() (which is
// always triggered by a click/tap) and resumed if it starts suspended.
let ac = null, master = null, noiseBuf = null;
let volume = 0.6;

// One second of white noise generated once and reused by every noise burst (random start offset in noise()).
function ctx() {
  if (ac) return ac;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = volume;
  master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ac;
}

export function setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; }

// Exponential ramps for pitch and gain: perceived pitch and loudness are logarithmic, so exponential curves sound
// smooth. exponentialRamp cannot reach 0, hence 0.0001 as "silence"; a 12 ms attack avoids the click of an instant
// gain jump. stop() a little after the envelope ends to free the node.
function tone(type, f0, f1, dur, gain, at = 0) {
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Filtered noise sweep (lowpass from f0 to f1): swish for a cascade, rumble for the explosion.
function noise(dur, gain, f0, f1, at = 0, q = 0.8) {
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + at;
  const src = a.createBufferSource(), flt = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noiseBuf;
  flt.type = 'lowpass';
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

export const SOUNDS = {
  reveal: () => tone('sine', 880, 620, 0.06, 0.12),
  cascade: () => { noise(0.22, 0.12, 5200, 700); tone('sine', 660, 990, 0.12, 0.05); },
  flag: () => { tone('triangle', 740, 520, 0.09, 0.18); tone('sine', 1480, 1100, 0.05, 0.04); },
  unflag: () => tone('triangle', 520, 380, 0.08, 0.12),
  chord: () => { tone('sine', 700, 560, 0.05, 0.1); tone('sine', 940, 760, 0.05, 0.08, 0.04); },
  boom: () => { noise(0.9, 0.5, 2400, 60, 0, 1.2); tone('sine', 140, 38, 0.6, 0.5); tone('square', 90, 30, 0.25, 0.12); },
  win: () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, k) => { tone('triangle', f, f, 0.32, 0.16, k * 0.09); tone('sine', f * 2, f * 2, 0.2, 0.03, k * 0.09); }),
  hint: () => { tone('sine', 1318.5, 1318.5, 0.35, 0.08); tone('sine', 1975.5, 1975.5, 0.3, 0.04, 0.06); },
  click: () => tone('sine', 1200, 900, 0.03, 0.06),
};

// Never throws: audio is decoration, a failing AudioContext must not break a move.
export function play(name) {
  try {
    const a = ctx();
    if (!a) return;
    if (a.state === 'suspended') a.resume();
    SOUNDS[name]?.();
  } catch { /* audio unavailable */ }
}
