// durak-game/sound.js - small synthesized sounds (WebAudio, no files): a card on the cloth, a beat, a pick-up, a
// shuffle, your turn, a chat pop, a win and a loss. Silent until the first user gesture (browsers require it) and
// when sound is off.
//
//   setSound(on, volume);  play(name)   name: 'card' | 'beat' | 'take' | 'shuffle' | 'turn' | 'chat' | 'win' | 'lose' | 'tick'

//
// Approach: procedural synthesis - card sounds are short band-passed noise bursts (paper friction), signals are sine/
// triangle tones with exponential envelopes. No audio files: zero bytes in the single-file build, no decoding latency.
// One AudioContext (lazily created, browsers cap their number) and one master gain node for the volume.

let ctx = null, master = null, enabled = true, vol = 0.6;

export function setSound(on, volume = vol) {
  enabled = !!on;
  vol = Math.max(0, Math.min(1, +volume || 0));
  if (master) master.gain.value = vol * 0.8;
}

// Autoplay policy: a context created before a user gesture starts 'suspended'; resume() on each play succeeds once
// a gesture has happened (sounds are triggered by clicks), so no explicit unlock handler is needed.
function audio() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = vol * 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// 0.4 s of white noise generated once and shared by every burst (a buffer source is single-use, the buffer is not).
let noiseBuf = null;
function noise(a) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.4, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = a.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function burst(a, t, { dur = 0.07, freq = 2400, q = 0.8, gain = 0.5, type = 'bandpass' } = {}) {
  const src = noise(a), f = a.createBiquadFilter(), g = a.createGain();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

// Envelopes use exponentialRamp from 0.0001, never 0: an exponential ramp to or from exactly 0 is undefined (throws).
// The 12 ms attack avoids the click of an instant onset. stop() slightly after the envelope ends frees the node.
function tone(a, t, { freq = 660, dur = 0.12, gain = 0.2, type = 'sine', to = null } = {}) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export function play(name) {
  const a = audio();
  if (!a) return;
  // Schedule 10 ms ahead: setting events at exactly currentTime can land in the past by the time they are processed.
  // win = C major arpeggio (C5 E5 G5 C6) rising; lose = falling G4 E4 C4 G3 on a harsher sawtooth.
  const t = a.currentTime + 0.01;
  switch (name) {
    case 'card': burst(a, t, { dur: 0.06, freq: 2600, gain: 0.45 }); burst(a, t + 0.015, { dur: 0.05, freq: 900, q: 0.6, gain: 0.25 }); break;
    case 'beat': burst(a, t, { dur: 0.05, freq: 3200, gain: 0.5 }); tone(a, t, { freq: 220, dur: 0.08, gain: 0.12, type: 'triangle' }); break;
    case 'take': for (let i = 0; i < 4; i++) burst(a, t + i * 0.035, { dur: 0.05, freq: 1400 - i * 150, gain: 0.3 }); tone(a, t, { freq: 180, to: 110, dur: 0.25, gain: 0.12, type: 'triangle' }); break;
    case 'shuffle': for (let i = 0; i < 10; i++) burst(a, t + i * 0.028, { dur: 0.04, freq: 2000 + (i % 3) * 500, gain: 0.22 }); break;
    case 'turn': tone(a, t, { freq: 880, dur: 0.14, gain: 0.08 }); tone(a, t + 0.08, { freq: 1320, dur: 0.18, gain: 0.06 }); break;
    case 'tick': tone(a, t, { freq: 1600, dur: 0.05, gain: 0.05, type: 'square' }); break;
    case 'chat': tone(a, t, { freq: 520, to: 780, dur: 0.1, gain: 0.08 }); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * 0.11, { freq: f, dur: 0.3, gain: 0.11, type: 'triangle' })); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(a, t + i * 0.16, { freq: f, dur: 0.34, gain: 0.1, type: 'sawtooth' })); break;
    default: break;
  }
}
