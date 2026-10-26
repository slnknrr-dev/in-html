// catalog/tracking.js - tracking like MyAnimeList / Shikimori and the play history (scrobbles).
//
// Tracking lives on a work's `track` field { status, progress, score (0..10), started, finished, repeats, notes,
// updated }. Where it lives: a movie, album, book or podcast tracks itself; an episode is tracked by its season when the
// season is an entry of its own (anime: every season / cour is a separate entry, as on MyAnimeList) or already has
// tracking, else by its show; a chapter by its book; a track by its album (tracks themselves keep plays and a rating).
// Progress counts the distinct finished children (episodes / chapters / tracks) of the tracked node.
//
//   trackTarget(db, work) -> the node that carries the tracking of a work (maybe the work itself)
//   setStatus(db, id, status) / setScore(db, id, score | null) / setProgress(db, id, n) / setTrack(db, id, fields)
//   clearTrack(db, id)
//   countsAsPlay({ listened, duration, family, position, markers }) -> boolean   (music: half the track or 4 minutes like
//                                                   Last.fm; video: the watched threshold or the outro marker;
//                                                   audiobook chapters: the end)
//   recordPlay(db, { media, work, listened, position, duration, at, completed, threshold }) -> { play, counted }
//                                                   history entry + plays / lastPlayed / resume position / progress /
//                                                   automatic status (current -> completed, repeats)
//   savePosition(db, mediaId, seconds, duration)   resume position (cleared near the end)
//   resumeOf(db, mediaId) -> seconds | 0
//   history(db, { from, to, limit, work }) -> play nodes, newest first
//   nextEpisode(db, containerId) -> the first unfinished child (episode / chapter / track) in play order
//   continueList(db, { limit }) -> [{ work, media, reason: 'resume' | 'next' | 'current', position }]
//   stats(db, { from, to, now, tz }) -> totals by domain, by day / hour / weekday, statuses per domain, the score
//                                     distribution and mean, top tags (genre namespace), artists, shows, years,
//                                     streaks, completed entries, time per domain
//   WATCHED_THRESHOLD (0.9)
//
// Key decisions:
// - Plays are separate 'play' nodes (an append-only log), while plays / lastPlayed on the work are denormalised
//   counters. The log enables history and stats by time window; the counters keep sorting by plays O(1) per work
//   instead of a scan of the whole history.
// - Status transitions are automatic but conservative: playing something planned makes it current, finishing the
//   last episode completes it, replaying a completed entry starts a repeat. Manual edits always win (setStatus etc.).
// - Time is local-day based for streaks / by-day stats via an explicit tz offset (minutes) rather than the runtime's
//   zone: the backend may run in UTC while the user lives elsewhere.

import { now, uid } from './model.js';
import { facts, domainOf, containers } from './facts.js';
import { tagKey } from './tags.js';

export const WATCHED_THRESHOLD = 0.9;
const TRACKED_SELF = new Set(['movie', 'album', 'book', 'podcast', 'show', 'season', 'bookseries', 'musicvideo']);

// Resolution order for a leaf: an ancestor that already tracks wins (respects where the user put it); then the
// season for anime or for seasons with external ids (separate MAL entries); then the nearest container; else the
// leaf itself. The final `TRACKED_SELF.has(w.kind) ? w : w` returns w either way: TRACKED_SELF is documentation
// here, not a filter.
export function trackTarget(db, w) {
  if (!w) return null;
  if (w.track) return w;
  if (w.kind === 'episode' || w.kind === 'chapter' || w.kind === 'track') {
    const chain = containers(db, w);
    const tracked = chain.find((c) => c.track);
    if (tracked) return tracked;
    const season = chain.find((c) => c.kind === 'season');
    if (season && (domainOf(db, w) === 'anime' || season.ids)) return season;
    return chain.find((c) => ['show', 'podcast', 'book', 'album', 'season'].includes(c.kind)) || w;
  }
  return TRACKED_SELF.has(w.kind) ? w : w;
}

const today = () => now();

// Merge-and-clean: undefined / null in `fields` deletes that key, so callers clear a score by passing null.
export function setTrack(db, id, fields) {
  const w = db.get(id);
  if (!w) return null;
  const t = { status: 'planned', ...(w.track || {}), ...fields, updated: today() };
  for (const k of Object.keys(t)) if (t[k] === undefined || t[k] === null) delete t[k];
  return db.patch(id, { track: t });
}

// MAL semantics: entering current / repeating stamps `started` once; completing stamps `finished`, fills progress
// to the total, and counts a repeat when leaving 'repeating'.
export function setStatus(db, id, status) {
  const w = db.get(id);
  if (!w) return null;
  const t = { ...(w.track || {}) };
  const prev = t.status;
  t.status = status;
  if (status === 'current' && !t.started) t.started = today();
  if (status === 'repeating' && !t.started) t.started = today();
  if (status === 'completed') {
    if (!t.finished || prev !== 'completed') t.finished = today();
    if (prev === 'repeating') t.repeats = (t.repeats || 0) + 1;
    const total = totalOf(db, w);
    if (total) t.progress = total;
  }
  return setTrack(db, id, t);
}

export const setScore = (db, id, score) => setTrack(db, id, { score: score == null ? undefined : Math.max(0, Math.min(10, Math.round(score * 10) / 10)) });

// Progress is clamped to [0, total] when the total is known (unknown total: unbounded, airing shows). Any progress
// implies current; reaching the total completes the entry.
export function setProgress(db, id, n) {
  const w = db.get(id);
  if (!w) return null;
  const t = { ...(w.track || {}) };
  const total = totalOf(db, w);
  t.progress = Math.max(0, total ? Math.min(total, n) : n);
  if (!t.status || t.status === 'planned') { t.status = 'current'; t.started = t.started || today(); }
  if (total && t.progress >= total && t.status !== 'completed') {
    if (t.status === 'repeating') t.repeats = (t.repeats || 0) + 1;
    t.status = 'completed';
    t.finished = today();
  }
  return setTrack(db, id, t);
}

export function clearTrack(db, id) { return db.patch(id, { track: undefined }); }

// Planned number of children of a tracked node (episodes, chapters, tracks): `total` when known, else the children.
// leafChildren descends at most 3 levels (show > season > episode) and excludes the root itself. Specials are
// excluded from totals, as MAL counts them as separate entries.
function leafChildren(db, w) {
  const out = [];
  const walk = (x, d) => { const k = db.children(x.id); if (!k.length || d > 2) { if (x !== w) out.push(x); return; } for (const c of k) walk(c, d + 1); };
  walk(w, 0);
  return out;
}
function totalOf(db, w) {
  if (w.total) return w.total;
  if (['movie', 'musicvideo'].includes(w.kind)) return 1;
  const leaves = leafChildren(db, w).filter((x) => !x.special);
  return leaves.length || 0;
}

// When a session counts as a play, per family:
// - unknown duration: 30 s listened (better a rough rule than never counting streams);
// - music: Last.fm's scrobble rule, half the track or 4 minutes, whichever first, and tracks under 15 s never count;
// - audiobook / podcast: reaching the last 10 s or listening to `threshold` of it;
// - video: entering the outro (credits skipped still counts as watched), else position past `threshold`.
// Video uses position, music uses listened time: seeking to the end of a song should not scrobble it, while for
// an episode the user may legitimately have watched part of it in an earlier session.
export function countsAsPlay({ listened = 0, duration = 0, family = 'music', position = 0, markers = null, threshold = WATCHED_THRESHOLD } = {}) {
  if (!duration) return listened >= 30;
  if (family === 'music') return listened >= Math.min(duration / 2, 240) && duration >= 15;
  if (family === 'audiobook' || family === 'podcast') return position >= duration - 10 || listened >= duration * threshold;
  if (markers && markers.outro && position >= markers.outro[0] - 1) return true;
  return position >= duration * threshold;
}

export function resumeOf(db, mediaId) {
  const m = db.get(mediaId);
  return m && m.position ? m.position : 0;
}

// Resume point. Not saved in the first 5 s (an accidental click) or in the last max(15 s, 2 %) (credits: resuming
// there is useless); those clear it instead. Writes are throttled to changes of >= 2 s, because the player calls
// this on every timeupdate and each patch is a db change event, an undo step and a persistence write.
export function savePosition(db, mediaId, seconds, duration) {
  const m = db.get(mediaId);
  if (!m) return;
  const near = duration && (seconds > duration - Math.max(15, duration * 0.02) || seconds < 5);
  if (near) { if (m.position) db.patch(mediaId, { position: undefined, positionAt: undefined }); return; }
  if (!m.position || Math.abs(m.position - seconds) >= 2) db.patch(mediaId, { position: Math.round(seconds * 10) / 10, positionAt: now() });
}

// End-of-session hook, all in one batch (one undo step reverts the whole play):
// 1. history entry if >= 5 s were listened or it counted (skips are not history); `at` defaults to the session
//    start (now - listened);
// 2. resume position cleared if counted, else saved;
// 3. if counted: counters on the work, then tracking on the target. For a container target, progress = number of
//    finished leaves, taking the max with stored progress (never decreases from replays of earlier episodes) except
//    when (re)starting a repeat; a completed container replayed becomes 'repeating' (not for music: replaying a
//    song is not re-listening to the album). Music only updates progress where tracking already exists.
// 4. a long enough non-music session that did not count still promotes planned -> current.
// `completed` lets the caller override the heuristic (an explicit "mark as watched").
export function recordPlay(db, { media: mediaId, work: workId, listened = 0, position = 0, duration = 0, at, completed, threshold = WATCHED_THRESHOLD } = {}) {
  const m = mediaId ? db.get(mediaId) : null;
  const w = db.get(workId || (m && m.work));
  if (!w) return { play: null, counted: false };
  const f = facts(db, w);
  const family = f.domain === 'music' || f.domain === 'musicvideo' ? 'music' : f.domain === 'audiobook' ? 'audiobook' : f.domain === 'podcast' ? 'podcast' : 'video';
  const dur = duration || (m && m.duration) || w.duration || 0;
  const counted = completed !== undefined ? !!completed : countsAsPlay({ listened, duration: dur, family, position, markers: w.markers || (m && m.markers), threshold });
  let play = null;
  db.batch(() => {
    if (listened >= 5 || counted) {
      play = db.put({ id: uid(), type: 'play', ref: m ? m.id : undefined, work: w.id, at: at || now() - listened * 1000, dur: Math.round(listened), pos: Math.round(position), done: counted, domain: f.domain, tags: [], created: now() });
    }
    if (m) {
      if (counted) { if (m.position) db.patch(m.id, { position: undefined, positionAt: undefined }); } else if (dur) savePosition(db, m.id, position, dur);
    }
    if (counted) {
      db.patch(w.id, { plays: (w.plays || 0) + 1, lastPlayed: now() });
      const target = trackTarget(db, w);
      if (target && target.id !== w.id) {
        const leaves = leafChildren(db, target).filter((x) => !x.special);
        const done = leaves.filter((x) => (x.id === w.id ? true : (db.get(x.id).plays || 0) > 0)).length;
        const t = target.track || {};
        if (t.status === 'completed' && w.kind !== 'track') setStatus(db, target.id, 'repeating');
        if (family !== 'music' || target.track) setProgress(db, target.id, Math.max(t.status === 'repeating' || t.status === 'completed' ? 0 : t.progress || 0, done));
      } else if (target && target.id === w.id && family !== 'music') {
        const t = w.track || {};
        if (t.status === 'repeating') setStatus(db, w.id, 'completed');
        else if (t.status !== 'completed') setStatus(db, w.id, 'completed');
      }
    } else if (listened >= 30 && family !== 'music') {
      const target = trackTarget(db, w);
      if (target && (!target.track || target.track.status === 'planned')) setStatus(db, target.id, 'current');
    }
  }, { label: 'play' });
  return { play, counted };
}

export function history(db, { from = 0, to = Infinity, limit = 0, work = null } = {}) {
  let list = db.all('play').filter((p) => p.at >= from && p.at <= to && (!work || p.work === work));
  list.sort((a, b) => b.at - a.at);
  return limit ? list.slice(0, limit) : list;
}

export function nextEpisode(db, containerId) {
  const c = db.get(containerId);
  if (!c) return null;
  const leaves = leafChildren(db, c);
  return leaves.find((x) => !(x.plays > 0)) || null;
}

// "Continue watching" row: unfinished media first (resume), then the next unplayed child of every current /
// repeating container, then current standalone works; merged, newest activity first. `seen` holds work ids so a
// resumable episode is not listed again as "next". Full scans of media and works: fine at catalogue sizes, and the
// row is rendered on demand, not per frame.
export function continueList(db, { limit = 30 } = {}) {
  const out = [];
  const seen = new Set();
  for (const m of db.all('media')) {
    if (!m.position || !m.work) continue;
    const w = db.get(m.work);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({ work: w, media: m, reason: 'resume', position: m.position, at: m.positionAt || m.updated });
  }
  for (const w of db.all('work')) {
    const t = w.track;
    if (!t || (t.status !== 'current' && t.status !== 'repeating')) continue;
    if (['show', 'season', 'book', 'podcast', 'album', 'bookseries'].includes(w.kind)) {
      const next = nextEpisode(db, w.id);
      if (next && !seen.has(next.id)) { seen.add(next.id); out.push({ work: next, media: db.mediaOf(next.id)[0] || null, reason: 'next', container: w, at: t.updated || w.updated }); }
    } else if (!seen.has(w.id)) { seen.add(w.id); out.push({ work: w, media: db.mediaOf(w.id)[0] || null, reason: 'current', at: t.updated || w.updated }); }
  }
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  return limit ? out.slice(0, limit) : out;
}

// Local calendar day as 'YYYY-MM-DD': shift the instant by the offset, then read it as UTC. Same trick below for
// hour and weekday (getUTCHours on the shifted date), which keeps results independent of the runtime's zone.
const dayKey = (t, tz = 0) => new Date(t + tz * 60000).toISOString().slice(0, 10);

// One pass over the plays in the window for time-based aggregates, one pass over works for tracking aggregates.
// Time is weighted by listened seconds (a skipped track adds little), artist ranking by counted plays only.
// Scores of 0 are treated as "unscored" (MAL convention), and the histogram rounds to whole points (11 buckets 0..10).
export function stats(db, { from = 0, to = Infinity, now: nowMs = now(), tz = 0 } = {}) {
  const plays = history(db, { from, to });
  const byDomain = {};
  const byDay = new Map(), byHour = new Array(24).fill(0), byWeekday = new Array(7).fill(0);
  const tagTime = new Map(), artistPlays = new Map(), showTime = new Map(), yearCount = new Map();
  let seconds = 0;
  for (const p of plays) {
    const s = p.dur || 0;
    seconds += s;
    const d = byDomain[p.domain || 'other'] ||= { plays: 0, seconds: 0, done: 0 };
    d.plays++; d.seconds += s; if (p.done) d.done++;
    const k = dayKey(p.at, tz);
    byDay.set(k, (byDay.get(k) || 0) + s);
    const dt = new Date(p.at + tz * 60000);
    byHour[dt.getUTCHours()] += s;
    byWeekday[dt.getUTCDay()] += s;
    const w = db.get(p.work);
    if (!w) continue;
    const f = facts(db, w);
    for (const t of f.tags) if (t.startsWith('genre:')) tagTime.set(t, (tagTime.get(t) || 0) + s);
    if (p.done) for (const a of (f.artist.length ? f.artist : f.author)) artistPlays.set(a, (artistPlays.get(a) || 0) + 1);
    if (f.show) showTime.set(f.show, (showTime.get(f.show) || 0) + s);
    if (f.year) yearCount.set(f.year, (yearCount.get(f.year) || 0) + (p.done ? 1 : 0));
  }
  const statuses = {};
  const scores = new Array(11).fill(0);
  let scoreSum = 0, scored = 0, completed = 0;
  for (const w of db.all('work')) {
    if (!w.track) continue;
    const dom = domainOf(db, w);
    const s = statuses[dom] ||= { current: 0, completed: 0, paused: 0, dropped: 0, planned: 0, repeating: 0 };
    if (s[w.track.status] !== undefined) s[w.track.status]++;
    if (w.track.status === 'completed') completed++;
    if (w.track.score != null && w.track.score > 0) { scores[Math.round(w.track.score)]++; scoreSum += w.track.score; scored++; }
  }
  // Streaks of days with any play (current: ending today or yesterday).
  // Day keys parse as UTC midnights, so consecutive days differ by exactly 864e5 (no DST in UTC). "Yesterday" still
  // counts as current so the streak does not show 0 in the morning before the first play of the day.
  const days = [...byDay.keys()].sort();
  let longest = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev && Date.parse(d) - Date.parse(prev) === 864e5 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  const todayKey = dayKey(nowMs, tz), yesterday = dayKey(nowMs - 864e5, tz);
  if (prev === todayKey || prev === yesterday) current = run;
  const top = (m, n = 10) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    plays: plays.length, seconds, byDomain, byDay: [...byDay].sort((a, b) => a[0].localeCompare(b[0])), byHour, byWeekday,
    statuses, scores, meanScore: scored ? Math.round((scoreSum / scored) * 100) / 100 : null, scored, completed,
    genres: top(tagTime).map(([k, s]) => [tagKey(k).slice(6), s]), artists: top(artistPlays), shows: top(showTime),
    years: [...yearCount].sort((a, b) => a[0] - b[0]), streak: { current, longest },
  };
}
