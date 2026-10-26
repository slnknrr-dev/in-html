// player/timers.js - time-based playback rules as pure functions: the sleep timer with fade-out, A-B repeat, skip
// intro / outro / recap markers (from the catalogue or from chapter names), resume decisions, the next-episode
// countdown, the position of chapters.
//
//   sleepTimer(mode, { minutes, now }) -> timer   mode 'off' | 'minutes' | 'track' (end of the current item) |
//                                                 'chapter' | 'queue'
//   sleepState(timer, { now, ended, chapterEnded, queueEnded, fade = 20 }) -> { active, expired, volume (0..1), left (s) }
//   abState(ab, t) -> { seek: a | null }          ab: { a, b } (seconds) ; setAbPoint(ab, t) -> next ab (a, then b, then off)
//   markersFromChapters(chapters, duration) -> { intro, outro, recap, preview }   ('Opening', 'OP', 'Intro', 'Ending',
//                                                 'ED', 'Credits', 'Recap', 'Previously', 'Preview', 'Next episode' …)
//   markerAt(markers, t) -> { kind, end } | null  (the marker the position is inside: show "Skip intro")
//   resumeDecision({ position, duration, family }) -> { resume: boolean, at }
//   nextCountdown({ position, duration, markers, seconds = 10 }) -> { show, left }   (autoplay the next episode)
//   chapterAt(chapters, t) -> index ; chapterSkip(chapters, t, dir) -> seconds

export function sleepTimer(mode = 'off', { minutes = 30, now = Date.now() } = {}) {
  if (mode === 'off') return { mode: 'off' };
  if (mode === 'minutes') return { mode, until: now + Math.max(1, minutes) * 60000, minutes };
  return { mode };
}

// Pure state evaluation from (timer, now): the app polls it and applies volume, so timers survive tab throttling
// and are trivially testable. The last `fade` seconds ramp the volume linearly to 0 instead of a hard stop.
export function sleepState(timer, { now = Date.now(), ended = false, chapterEnded = false, queueEnded = false, fade = 20 } = {}) {
  if (!timer || timer.mode === 'off') return { active: false, expired: false, volume: 1, left: null };
  if (timer.mode === 'minutes') {
    const left = (timer.until - now) / 1000;
    if (left <= 0) return { active: true, expired: true, volume: 0, left: 0 };
    return { active: true, expired: false, volume: left < fade ? Math.max(0, left / fade) : 1, left };
  }
  const expired = timer.mode === 'track' ? ended : timer.mode === 'chapter' ? chapterEnded || ended : queueEnded;
  return { active: true, expired, volume: expired ? 0 : 1, left: null };
}

export function setAbPoint(ab, t) {
  if (!ab || ab.a == null) return { a: t, b: null };
  if (ab.b == null) return t > ab.a + 0.2 ? { a: ab.a, b: t } : { a: t, b: null };
  return { a: null, b: null };
}

// The 0.5 s tolerance before A avoids a seek loop when the player lands slightly before A after the jump.
export function abState(ab, t) {
  if (!ab || ab.a == null || ab.b == null) return { seek: null };
  return { seek: t >= ab.b || t < ab.a - 0.5 ? ab.a : null };
}

const NAMES = {
  intro: /^(op|opening|intro|introduction|title sequence|опенинг|заставка|вступление|オープニング)(\s*\d*|\s*\(.*\))?$/i,
  outro: /^(ed|ending|outro|credits|end credits|эндинг|титры|エンディング)(\s*\d*|\s*\(.*\))?$/i,
  recap: /^(recap|previously|previously on.*|ранее|в предыдущих сериях|前回のあらすじ)$/i,
  preview: /^(preview|next episode|next time|予告|анонс|превью)$/i,
};

export function markersFromChapters(chapters, duration = null) {
  const out = {};
  const list = (chapters || []).slice().sort((a, b) => a.start - b.start);
  list.forEach((c, i) => {
    const title = String(c.title || '').trim();
    const end = c.end ?? (list[i + 1] ? list[i + 1].start : duration);
    if (end == null || end <= c.start) return;
    for (const [kind, re] of Object.entries(NAMES)) if (!out[kind] && re.test(title)) out[kind] = [c.start, end];
  });
  return out;
}

export function markerAt(markers, t) {
  if (!markers) return null;
  for (const kind of ['recap', 'intro', 'outro', 'preview']) {
    const r = markers[kind];
    if (r && t >= r[0] && t < r[1] - 1) return { kind, start: r[0], end: r[1] };
  }
  return null;
}

// No resume for barely started items (thresholds 20 / 30 s) or nearly finished ones (last 3 %, at least 15 s):
// both cases mean the user wants to start over.
export function resumeDecision({ position = 0, duration = 0, family = 'music' } = {}) {
  if (!position || position < (family === 'music' ? 20 : 30)) return { resume: false, at: 0 };
  if (duration && position > duration - Math.max(15, duration * 0.03)) return { resume: false, at: 0 };
  // Step back a little so the listener hears where they were.
  return { resume: true, at: Math.max(0, position - (family === 'audiobook' || family === 'podcast' ? 5 : 2)) };
}

// With an outro marker the countdown starts at the outro and runs `seconds`; without one it covers the last `seconds`.
export function nextCountdown({ position = 0, duration = 0, markers = null, seconds = 10 } = {}) {
  if (!duration) return { show: false, left: null };
  const startAt = markers && markers.outro ? Math.min(markers.outro[0], duration - 1) : duration - seconds;
  if (position < startAt) return { show: false, left: null };
  const end = Math.min(duration, startAt + seconds);
  return { show: true, left: Math.max(0, Math.ceil(end - position)) };
}

export function chapterAt(chapters, t) {
  let idx = -1;
  (chapters || []).forEach((c, i) => { if (t >= c.start - 0.01) idx = i; });
  return idx;
}

export function chapterSkip(chapters, t, dir) {
  const list = chapters || [];
  if (!list.length) return null;
  const i = chapterAt(list, t);
  if (dir > 0) return i + 1 < list.length ? list[i + 1].start : null;
  if (i >= 0 && t - list[i].start > 3) return list[i].start;
  return i > 0 ? list[i - 1].start : 0;
}
