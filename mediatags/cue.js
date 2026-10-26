// mediatags/cue.js - CUE sheets: parsing (tolerant of a BOM, CRLF, missing quotes, lowercase keywords), the flat track
// list of a sheet, writing, MSF times (mm:ss:ff, 75 frames per second).
//
//   parseCue(text) -> { performer?, title?, songwriter?, catalog?, cdTextFile?, rem: { genre, date, discid, comment,
//                       ...lowercased REM keys }, files: [{ name, type, tracks: [{ number, type, title?, performer?,
//                       songwriter?, isrc?, flags: [], pregap? (s), postgap? (s), rem: {}, indexes: [{ number, time (s) }],
//                       start (INDEX 01, else the first index; s) | null }] }] }
//     Absent strings are omitted. A TRACK before any FILE goes into a file with name null.
//   cueTracks(cue, { durations: { [fileName]: seconds } }) -> [{ file, number, title, performer, songwriter, isrc,
//                       start, end }]  (performer / songwriter fall back to the sheet's; end = the next track's start in
//                       the same file, else the file's duration, else null; missing values are null)
//   serializeCue(cue) -> text (parseCue(serializeCue(x)) equals x)
//   buildCue({ performer, title, file, type = 'WAVE', tracks: [{ title, performer, start }], rem }) -> cue object
//   msf(seconds) -> 'mm:ss:ff'        parseMsf('mm:ss:ff') -> seconds ('mm:ss' and 'mm:ss.xxx' accepted too)

//
// Design: a line-oriented state machine (current FILE, current TRACK), not a grammar. Real-world sheets come from EAC,
// foobar2000, hand edits and Windows-1251 / UTF-8 mixups; a strict grammar rejects half of them. Unknown commands are
// skipped, commands in the wrong place (INDEX before TRACK) are dropped individually, never the whole sheet.
// Times are stored in seconds (floats), not frames: consumers (players, chapter lists) think in seconds; frames are
// a serialization detail recovered by msf().

// Rounds to the nearest CD frame (1/75 s): the format cannot express finer time, so rounding here makes
// serialize(parse(x)) stable. 4500 = 60 * 75 frames per minute. Minutes are not wrapped to hours (CUE has no hour
// field; 'mm' may exceed 99).
export function msf(seconds) {
  const f = Math.max(0, Math.round((Number(seconds) || 0) * 75));
  const mm = Math.floor(f / 4500), ss = Math.floor(f / 75) % 60, ff = f % 75;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

// Strict mm:ss:ff first (the spec form), then the 'mm:ss[.fraction]' forms some tools write. A fraction's digit count
// sets its scale ('.5' = 0.5 s, '.500' = 0.5 s), unlike ff which is always 1/75.
export function parseMsf(s) {
  const t = String(s || '').trim();
  let m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(t);
  if (m) return +m[1] * 60 + +m[2] + +m[3] / 75;
  m = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(t);
  if (m) return +m[1] * 60 + +m[2] + (m[3] ? +m[3] / 10 ** m[3].length : 0);
  return null;
}

// Value of a string command: between the first and the last quote when quoted, else the rest of the line.
// First/last quote, not a regex pair: titles containing quotes ('TITLE "12\" Mix"') survive. An unterminated quote
// keeps the rest of the line rather than losing the value.
function unquote(s) {
  const t = s.trim();
  if (t.startsWith('"')) {
    const e = t.lastIndexOf('"');
    return e > 0 ? t.slice(1, e) : t.slice(1);
  }
  return t;
}

/** Parses a CUE sheet (see the header). */
export function parseCue(text) {
  const cue = { rem: {}, files: [] };
  let file = null, track = null;
  // BOM stripped (Windows tools write UTF-8 with BOM, and it would glue onto the first command name). All three line
  // endings accepted.
  const lines = String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\S+)\s*(.*)$/.exec(line);
    const cmd = m[1].toUpperCase(), rest = m[2];
    // PERFORMER / TITLE / SONGWRITER apply to the track once one is open, else to the disc: CUE scoping is positional.
    const target = track || cue;
    switch (cmd) {
      case 'REM': {
        const r = /^(\S+)\s*(.*)$/.exec(rest);
        if (r) (track ? track.rem : cue.rem)[r[1].toLowerCase()] = unquote(r[2]);
        break;
      }
      case 'PERFORMER': target.performer = unquote(rest); break;
      case 'TITLE': target.title = unquote(rest); break;
      case 'SONGWRITER': target.songwriter = unquote(rest); break;
      case 'CATALOG': cue.catalog = unquote(rest); break;
      case 'CDTEXTFILE': cue.cdTextFile = unquote(rest); break;
      // FILE "name with spaces" TYPE, or unquoted: the type is then the last word. A new FILE closes the current track
      // (tracks belong to the file they follow).
      case 'FILE': {
        let name = rest.trim(), type = '';
        const q = /^"(.*)"\s*(\S*)$/.exec(name);
        if (q) { name = q[1]; type = q[2]; } else {
          const sp = name.lastIndexOf(' ');
          if (sp > 0) { type = name.slice(sp + 1); name = name.slice(0, sp).trim(); }
        }
        file = { name, type: type.toUpperCase(), tracks: [] };
        cue.files.push(file);
        track = null;
        break;
      }
      // A TRACK before any FILE is malformed but common in hand-made sheets: kept under an anonymous file (name null)
      // rather than dropped.
      case 'TRACK': {
        const t = /^(\d+)\s*(\S*)/.exec(rest);
        if (!t) break;
        if (!file) { file = { name: null, type: '', tracks: [] }; cue.files.push(file); }
        track = { number: +t[1], type: (t[2] || 'AUDIO').toUpperCase(), flags: [], rem: {}, indexes: [], start: null };
        file.tracks.push(track);
        break;
      }
      case 'INDEX': {
        const t = /^(\d+)\s+(\S+)/.exec(rest);
        if (!t || !track) break;
        const time = parseMsf(t[2]);
        if (time == null) break;
        track.indexes.push({ number: +t[1], time });
        break;
      }
      case 'PREGAP': if (track) { const v = parseMsf(rest); if (v != null) track.pregap = v; } break;
      case 'POSTGAP': if (track) { const v = parseMsf(rest); if (v != null) track.postgap = v; } break;
      case 'ISRC': if (track) track.isrc = unquote(rest); break;
      case 'FLAGS': if (track) track.flags = rest.trim().split(/\s+/).filter(Boolean).map((x) => x.toUpperCase()); break;
      default:
    }
  }
  // start = INDEX 01 (where the track audibly begins; INDEX 00 marks the pregap), falling back to the first index.
  for (const f of cue.files) {
    for (const t of f.tracks) {
      const i1 = t.indexes.find((x) => x.number === 1) || t.indexes[0];
      t.start = i1 ? i1.time : null;
    }
  }
  return cue;
}

// end is the next track WITH a start in the same file (tracks without an index are skipped), then the caller-supplied
// file duration (the sheet itself never knows the length of the last track), else null. Never spans files.
/** Flat track list with start / end times (see the header). */
export function cueTracks(cue, { durations = {} } = {}) {
  const out = [];
  for (const f of cue.files || []) {
    const tracks = f.tracks || [];
    tracks.forEach((t, i) => {
      let end = null;
      for (let k = i + 1; k < tracks.length; k++) if (tracks[k].start != null) { end = tracks[k].start; break; }
      if (end == null && durations && f.name != null && durations[f.name] != null) end = durations[f.name];
      out.push({
        file: f.name, number: t.number, title: t.title ?? null, performer: t.performer ?? cue.performer ?? null,
        songwriter: t.songwriter ?? cue.songwriter ?? null, isrc: t.isrc ?? null, start: t.start, end,
      });
    });
  }
  return out;
}

// q() does not escape inner quotes; it does not need to: unquote() and the greedy FILE regex read to the LAST quote.
// REM values are quoted only when needed: 'REM DATE 1999' stays bare, as EAC writes it.
const q = (s) => `"${String(s)}"`;
const remValue = (v) => (/\s/.test(String(v)) || v === '' ? q(v) : String(v));

// Canonical order (REM, CATALOG, CDTEXTFILE, PERFORMER, SONGWRITER, TITLE; per track PREGAP before INDEX, POSTGAP
// after) as the CDRWIN spec expects. A track without indexes but with a start gets INDEX 01, so built cues are valid.
// Track numbers zero-padded to 2 digits: some burners reject 'TRACK 1'.
/** CUE sheet text. */
export function serializeCue(cue) {
  const out = [];
  for (const [k, v] of Object.entries(cue.rem || {})) out.push(`REM ${k.toUpperCase()} ${remValue(v)}`);
  if (cue.catalog != null) out.push(`CATALOG ${cue.catalog}`);
  if (cue.cdTextFile != null) out.push(`CDTEXTFILE ${q(cue.cdTextFile)}`);
  if (cue.performer != null) out.push(`PERFORMER ${q(cue.performer)}`);
  if (cue.songwriter != null) out.push(`SONGWRITER ${q(cue.songwriter)}`);
  if (cue.title != null) out.push(`TITLE ${q(cue.title)}`);
  for (const f of cue.files || []) {
    if (f.name != null) out.push(`FILE ${q(f.name)} ${f.type || 'WAVE'}`);
    for (const t of f.tracks || []) {
      out.push(`  TRACK ${String(t.number).padStart(2, '0')} ${t.type || 'AUDIO'}`);
      for (const [k, v] of Object.entries(t.rem || {})) out.push(`    REM ${k.toUpperCase()} ${remValue(v)}`);
      if (t.title != null) out.push(`    TITLE ${q(t.title)}`);
      if (t.performer != null) out.push(`    PERFORMER ${q(t.performer)}`);
      if (t.songwriter != null) out.push(`    SONGWRITER ${q(t.songwriter)}`);
      if (t.isrc != null) out.push(`    ISRC ${t.isrc}`);
      if (t.flags && t.flags.length) out.push(`    FLAGS ${t.flags.join(' ')}`);
      if (t.pregap != null) out.push(`    PREGAP ${msf(t.pregap)}`);
      const idx = t.indexes && t.indexes.length ? t.indexes : t.start != null ? [{ number: 1, time: t.start }] : [];
      for (const x of idx) out.push(`    INDEX ${String(x.number).padStart(2, '0')} ${msf(x.time)}`);
      if (t.postgap != null) out.push(`    POSTGAP ${msf(t.postgap)}`);
    }
  }
  return out.join('\n') + '\n';
}

// Starts go through msf -> parseMsf so the object equals what parsing its own serialization would produce.
/** A one-file cue object for exporting an album or chapters (times in seconds, rounded to CD frames). */
export function buildCue({ performer, title, file, type = 'WAVE', tracks = [], rem } = {}) {
  const cue = { rem: { ...(rem || {}) }, files: [] };
  if (performer != null) cue.performer = performer;
  if (title != null) cue.title = title;
  cue.files.push({
    name: file ?? null,
    type,
    tracks: tracks.map((t, i) => {
      const start = parseMsf(msf(t.start || 0));
      const tr = { number: i + 1, type: 'AUDIO', flags: [], rem: {}, indexes: [{ number: 1, time: start }], start };
      if (t.title != null) tr.title = t.title;
      if (t.performer != null) tr.performer = t.performer;
      return tr;
    }),
  });
  return cue;
}
