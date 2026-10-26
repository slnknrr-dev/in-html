// timeline/slideshow.js - a slideshow from pictures and an audio track: still clips with durations (fixed, or
// stretched so that the pictures end with the audio), transitions, Ken Burns moves and captions.
//
//   buildSlideshow(p, opts) -> { clips, audio, captions }   appends to project p (usually a new one)
//     opts { images: [{ media, caption?, weight? }], audio: mediaId | null, mode: 'fit' | 'fixed', seconds = 3,
//            transition: 'none' | xfade name | 'random', transitionDuration = 0.6, kenburns: 'none' | preset name |
//            'alternate' | 'random', captionStyle: { size, color, box }, seed = 1, fadeOut = 1.5 }
//   slideDurations(n, weights, audioLen, transition) -> { lens, transition }   the durations of 'fit' mode
//   rng(seed)  deterministic random numbers in [0, 1)

import { KENBURNS, MIN_LEN, TRANSITIONS, mediaMap } from './model.js';
import { addAudio, addClip, addOverlay } from './edit.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
export const NICE_TRANSITIONS = ['fade', 'slideleft', 'slideup', 'circleopen', 'wipeleft', 'zoomin', 'fadeblack'];

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Durations that make n stills (relative weights) fill audioLen seconds when each of the n - 1 transitions overlaps
 * neighbours by d: sum(len) - (n - 1) d = audioLen. d shrinks when a still would be shorter than 2 d.
 */
// The bound on d comes from requiring the shortest still to be at least 2d long (a transition in and one out must
// fit): wmin * (audioLen + (n-1) d) >= 2d  =>  d <= wmin * audioLen / (2 - (n-1) wmin). 0.98 leaves a margin for the
// 3-decimal rounding below.
export function slideDurations(n, weights, audioLen, d) {
  if (n <= 0) return { lens: [], transition: d };
  const w = Array.from({ length: n }, (_, i) => Math.max(0.05, +weights?.[i] || 1));
  const W = w.reduce((a, b) => a + b, 0);
  const wmin = Math.min(...w) / W;
  let dd = n > 1 ? Math.max(0, d) : 0;
  if (dd > 0) {
    const den = 2 - (n - 1) * wmin;
    const bound = den > 0 ? (wmin * audioLen) / den : Infinity;
    if (dd > bound * 0.98) dd = Math.max(0, r3(bound * 0.98));
  }
  const sum = audioLen + (n - 1) * dd;
  const lens = w.map((x) => Math.max(MIN_LEN, r3((x / W) * sum)));
  // Rounding: the last still absorbs the difference so the total matches the audio.
  const total = lens.reduce((a, b) => a + b, 0) - (n - 1) * dd;
  lens[n - 1] = Math.max(MIN_LEN, r3(lens[n - 1] + (audioLen - total)));
  return { lens, transition: dd };
}

export function buildSlideshow(p, opts) {
  const o = { mode: 'fit', seconds: 3, transition: 'fade', transitionDuration: 0.6, kenburns: 'alternate', seed: 1, fadeOut: 1.5, ...opts };
  const media = mediaMap(p);
  const images = (o.images || []).filter((im) => media.get(im.media)?.kind === 'image');
  const n = images.length;
  const audio = o.audio && media.get(o.audio)?.hasAudio ? media.get(o.audio) : null;
  const rand = rng(o.seed);
  const trType = () => (o.transition === 'random' ? NICE_TRANSITIONS[Math.floor(rand() * NICE_TRANSITIONS.length)] : o.transition);
  let d = o.transition === 'none' || !TRANSITIONS.concat('random').includes(o.transition) ? 0 : Math.max(0.1, o.transitionDuration);
  let lens;
  if (o.mode === 'fit' && audio && audio.duration > 0) {
    const r = slideDurations(n, images.map((im) => im.weight), audio.duration, d);
    lens = r.lens;
    d = r.transition;
  } else {
    lens = images.map((im) => Math.max(MIN_LEN, r3((im.weight || 1) * o.seconds)));
    if (d > 0) d = Math.min(d, ...lens.map((x) => x / 2));
  }
  const kbNames = Object.keys(KENBURNS);
  const clips = [];
  images.forEach((im, i) => {
    const c = addClip(p, im.media, { duration: lens[i] });
    if (!c) return;
    let kb = null;
    if (o.kenburns === 'alternate') kb = i % 2 ? 'zoomOut' : 'zoomIn';
    else if (o.kenburns === 'random') kb = kbNames[Math.floor(rand() * kbNames.length)];
    else if (KENBURNS[o.kenburns]) kb = o.kenburns;
    if (kb) c.kenburns = JSON.parse(JSON.stringify(KENBURNS[kb]));
    if (d > 0 && i < n - 1) c.transition = { type: trType(), duration: r3(d) };
    clips.push(c);
  });
  // Timeline positions for the captions and the total length.
  const starts = [];
  let t = 0;
  for (let i = 0; i < clips.length; i++) { starts.push(t); t += lens[i] - (i < clips.length - 1 ? d : 0); }
  const videoLen = r3(t);
  let audioClip = null;
  if (audio) {
    audioClip = addAudio(p, audio.id, 0, 0);
    if (audioClip && audio.duration > videoLen + 0.05 && clips.length) {
      audioClip.out = r3(Math.min(audio.duration, videoLen));
      audioClip.fadeOut = r3(Math.min(o.fadeOut, audioClip.out / 2));
    }
  }
  const captions = [];
  const cs = { size: 0.045, color: '#ffffff', box: 0.45, ...o.captionStyle };
  images.forEach((im, i) => {
    const text = String(im.caption || '').trim();
    if (!text || !clips[i]) return;
    const s = starts[i] + (i > 0 ? d / 2 : 0), e = starts[i] + lens[i] - (i < clips.length - 1 ? d / 2 : 0);
    const it = addOverlay(p, {
      type: 'text', text, start: r3(s), end: r3(Math.max(s + MIN_LEN, e)), x: 0.5, y: 0.84, size: cs.size, color: cs.color, bold: true,
      box: { color: '#000000', opacity: cs.box }, shadow: false, animIn: { type: 'slideup', duration: 0.35 }, animOut: { type: 'fade', duration: 0.3 },
    });
    if (it) captions.push(it);
  });
  return { clips, audio: audioClip, captions, length: videoLen, transition: d };
}
