// mediatags/lrc.js - LRC lyrics: timed lines (several timestamps per line), metadata tags, enhanced word timing.
//
//   parseLrc(text) -> { meta: { ar, ti, al, au, by, length, offset (ms, number), re, ve, ...other keys },
//                       lines: [{ time (s, offset applied) | null, text, words: [{ time, text }] | null }], synced }
//     timestamps [mm:ss] [mm:ss.x] [mm:ss.xx] [mm:ss.xxx] [mm:ss:xx] (and [h:mm:ss.xx]); several per line
//     ([00:12.00][01:15.30]chorus) give one line each; enhanced word timing <mm:ss.xx>word (text before the first
//     marker is a word at the line time; words keep their trailing spaces); a positive offset makes lyrics appear
//     sooner (time = stamp - offset / 1000); lines are sorted by time (stable). Lines with several timestamps get
//     words: null. Untimed text lines in a synced file are dropped; text without any timestamp gives synced: false and
//     one line per text line with time: null.
//   serializeLrc(lrc, { enhanced = true }) -> text (meta first; parseLrc(serializeLrc(x)) equals x)
//   lineAt(lrc, t) -> index of the current line (last line with time <= t) or -1
//   wordAt(line, t) -> index of the current word or -1
//   plainLyrics(lrc) -> the text without timestamps (one line per line)
//   isLrc(text) -> true when most text lines carry timestamps (lyrics tags that are really LRC)

//
// Design: LRC has no formal spec, only conventions. The parser is a per-line scanner of leading [..] groups: each group
// is a timestamp, a metadata tag (only before any timestamp) or ordinary text. Lines are expanded per timestamp and
// sorted, because '[00:12][01:15]chorus' (one line, two times) is the classic space-saving form.
// Times are kept in seconds with the offset already applied, so lineAt() needs no knowledge of [offset:].

// Known tag keys. Unknown keys are accepted only when lowercase: '[Chorus: x]' or '[Verse 2]' in a lyric is text, not
// metadata, and taggers write keys in lowercase.
const META_KEYS = ['ti', 'ar', 'al', 'au', 'lr', 'by', 'length', 'offset', 're', 've', 'la', 'id', 'tool', '#'];
const WORD = /<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>/;

// Millisecond rounding: offsets and fractions accumulate binary-float noise (12.3 - 0.1); 3 decimals is the format's
// finest precision, so round-trips compare equal.
const r3 = (x) => Math.round(x * 1000) / 1000;

// Body of a time tag -> seconds or null.
// mm:ss[.x|.xx|.xxx|:xx]. The fraction scale comes from its digit count, so .5, .50 and .500 agree. Minutes allow 3
// digits (long mixes) instead of an hour field; the h:mm:ss form is the rarer second pattern.
function parseStamp(s) {
  let m = /^(\d{1,3}):(\d{1,2})(?:([.:])(\d{1,3}))?$/.exec(s.trim());
  if (m) {
    const frac = m[4] ? +m[4] / 10 ** m[4].length : 0;
    return +m[1] * 60 + +m[2] + frac;
  }
  m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(s.trim());
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 10 ** m[4].length;
  return null;
}

function metaOf(body) {
  const m = /^\s*([A-Za-z#]{1,8})\s*:(.*)$/.exec(body);
  if (!m) return null;
  const key = m[1];
  if (!META_KEYS.includes(key.toLowerCase()) && key !== key.toLowerCase()) return null;
  return [key.toLowerCase(), m[2].trim()];
}

/** Parses LRC text (see the header). */
export function parseLrc(text) {
  const src = String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const meta = {};
  const timed = [];
  const plain = [];
  let seq = 0;
  for (const raw of src) {
    let rest = raw;
    const times = [];
    let isMeta = false;
    // Consume leading bracket groups. A non-time bracket after a timestamp ends the scan and stays in the text
    // ('[00:10][x] text' keeps '[x] text').
    for (;;) {
      const m = /^\s*\[([^\]]*)\]/.exec(rest);
      if (!m) break;
      const t = parseStamp(m[1]);
      if (t != null) { times.push(t); rest = rest.slice(m[0].length); continue; }
      if (!times.length) {
        const kv = metaOf(m[1]);
        if (kv) { meta[kv[0]] = kv[0] === 'offset' ? Number(kv[1]) || 0 : kv[1]; isMeta = true; rest = rest.slice(m[0].length); continue; }
      }
      break;
    }
    // Text with no timestamp is collected separately: in a synced file it is dropped, in an unsynced file it IS the
    // lyrics (decided after the loop, once we know whether any timestamp exists).
    if (isMeta && !times.length) continue;
    rest = rest.replace(/\s+$/, '');
    if (!times.length) { plain.push(rest.trim()); continue; }
    // enhanced word timing
    let words = null, textOut = rest.trim();
    if (WORD.test(rest)) {
      const parts = rest.split(new RegExp(WORD.source, 'g'));
      words = [];
      const pre = parts[0].replace(/^\s+/, '');
      if (pre) words.push({ time: null, text: pre });
      for (let i = 1; i < parts.length; i += 2) words.push({ time: parseStamp(parts[i]), text: parts[i + 1] });
      textOut = words.map((w) => w.text).join('').trim();
    }
    // seq keeps the source order for equal stamps (Array.prototype.sort is stable since ES2019, but the explicit
    // tie-break documents intent). Word timing only makes sense for a single occurrence of the line.
    for (const t of times) timed.push({ stamp: t, text: textOut, words: times.length === 1 ? words : null, seq: seq++ });
  }
  // [offset:+ms] shifts lyrics EARLIER (time = stamp - offset): the de-facto convention of most players.
  const off = (meta.offset || 0) / 1000;
  if (!timed.length) {
    while (plain.length && !plain[plain.length - 1]) plain.pop();
    while (plain.length && !plain[0]) plain.shift();
    return { meta, lines: plain.map((t) => ({ time: null, text: t, words: null })), synced: false };
  }
  timed.sort((a, b) => a.stamp - b.stamp || a.seq - b.seq);
  const lines = timed.map((x) => {
    const time = r3(x.stamp - off);
    const words = x.words ? x.words.map((w) => ({ time: w.time == null ? time : r3(w.time - off), text: w.text })) : null;
    return { time, text: x.text, words };
  });
  return { meta, lines, synced: true };
}

// Two decimals when exact to 10 ms (the classic [mm:ss.xx]), else three: the shortest form that loses nothing.
function stamp(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const mm = Math.floor(ms / 60000), ss = Math.floor(ms / 1000) % 60, f = ms % 1000;
  const frac = f % 10 === 0 ? String(f / 10).padStart(2, '0') : String(f).padStart(3, '0');
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${frac}`;
}

/** LRC text of a parsed (or built) lyrics object. */
export function serializeLrc(lrc, { enhanced = true } = {}) {
  const meta = lrc.meta || {};
  const out = [];
  const keys = [...META_KEYS.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !META_KEYS.includes(k))];
  for (const k of keys) {
    const v = meta[k];
    if (v == null || v === '') continue;
    out.push(`[${k}:${v}]`);
  }
  // Re-add the offset on write: stored times are offset-applied, the file must carry raw stamps plus [offset:].
  const off = (Number(meta.offset) || 0) / 1000;
  for (const line of lrc.lines || []) {
    if (line.time == null || !lrc.synced) { out.push(line.text || ''); continue; }
    const body = enhanced && line.words && line.words.length
      ? line.words.map((w) => `<${stamp((w.time ?? line.time) + off)}>${w.text}`).join('')
      : line.text || '';
    out.push(`[${stamp(line.time + off)}]${body}`);
  }
  return out.join('\n') + '\n';
}

// Binary search over sorted times (called every animation frame by players; O(log n) matters for long files).
/** Index of the line shown at time t (last line with time <= t), -1 before the first line or for unsynced lyrics. */
export function lineAt(lrc, t) {
  const lines = lrc.lines || [];
  if (!lrc.synced || !lines.length) return -1;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time != null && lines[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// Linear scan: a line has a few words, and early break keeps it cheap.
/** Index of the word sung at time t in a line with word timing, -1 before the first word or without words. */
export function wordAt(line, t) {
  const words = line && line.words;
  if (!words || !words.length) return -1;
  let ans = -1;
  for (let i = 0; i < words.length; i++) { if (words[i].time <= t) ans = i; else break; }
  return ans;
}

/** Lyrics text without timestamps. */
export function plainLyrics(lrc) {
  return (lrc.lines || []).map((l) => l.text).join('\n');
}

// Heuristic for lyrics fields that hold LRC text: timed lines must be present and at least match untimed text lines.
// Metadata lines are neutral, so a header-heavy short LRC still qualifies; prose with one '[00:01]' line does not.
/** True when the text is LRC: most non-empty lines carry timestamps. */
export function isLrc(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/).map((s) => s.trim()).filter(Boolean);
  let timed = 0, other = 0;
  for (const l of lines) {
    const m = /^\[([^\]]*)\]/.exec(l);
    if (m && parseStamp(m[1]) != null) timed++;
    else if (!(m && metaOf(m[1]))) other++;
  }
  return timed > 0 && timed >= other;
}
