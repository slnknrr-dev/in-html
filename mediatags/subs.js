// mediatags/subs.js - subtitles: SubRip, WebVTT, ASS / SSA and MicroDVD to one cue model, WebVTT / SRT out.
//
//   Cue text is plain text with newlines; <i> <b> <u> are the only markup kept (as such tags).
//   parseSrt(text) -> { format: 'srt', cues: [{ start, end, text }] }
//     comma or dot milliseconds, numbering optional, BOM / CRLF, blank lines missing between cues; <font> tags and
//     {\an8}-style override codes removed
//   parseVtt(text) -> { format: 'vtt', cues: [{ id?, start, end, text, settings?, voice? }], styles: [css text] }
//     header and NOTE / STYLE / REGION blocks skipped (STYLE bodies kept in `styles`); entities decoded; <c>, <v>,
//     <ruby>, <lang> and timestamp tags removed (the first <v Name> becomes `voice`)
//   parseAss(text) -> { format: 'ass' | 'ssa', info: { [key]: value }, styles: [{ name, ...lowercased Format keys }],
//     cues: [{ start, end, text, style, layer, name, effect }] }
//     Format lines decide the columns; override blocks {...} removed (\i1 \b1 \u1 ... become <i> <b> <u>), \N \n ->
//     newline, \h -> space, drawings (\p1 ... \p0) dropped; cues sorted by start (stable)
//   parseMicroDvd(text, { fps = 23.976 }) -> { format: 'microdvd', cues }   ({1}{1}25 sets the frame rate)
//   parseSubs(text, name?) -> by extension (.srt .vtt .ass .ssa .sub), else by content
//   toVtt(cues) -> WebVTT text (& < > escaped outside <i> <b> <u>; '-->' and blank lines removed from text)
//   toSrt(cues) -> SubRip text
//   shiftCues(cues, seconds) -> new cues moved in time (cues ending before 0 dropped, starts clamped to 0)
//   formatTime(seconds, sep = '.', hours = true) -> 'hh:mm:ss.mmm'

// Design: every parser lowers to one cue model { start, end (seconds), text } with only <i> <b> <u> kept; that is
// the intersection all output formats and players render, so conversion never emits markup a target drops.
// Parsers are lenient (real-world files violate their specs constantly) and skip a malformed block instead of
// throwing, so the rest survive. Times are rounded to milliseconds (r3) to avoid float noise in output.
// The BOM is stripped and all three newline conventions are accepted before any line logic.
const lines = (text) => String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/);

// 'h:mm:ss,mmm' or 'mm:ss.mmm' (hours optional, as WebVTT allows). Fraction is right-padded: '5' means 500 ms.
function parseTime(s) {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?\s*$/.exec(s);
  if (!m) return null;
  const ms = m[4] ? +m[4].padEnd(3, '0') : 0;
  return +(m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + ms / 1000;
}

// Rounds once to integer ms, then splits: avoids 59.9996 s printing as '00:00:60.000'. Negative clamps to 0.
export function formatTime(t, sep = '.', hours = true) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, f = ms % 1000;
  const p2 = (x) => String(x).padStart(2, '0');
  return `${hours || h ? p2(h) + ':' : ''}${p2(m)}:${p2(s)}${sep}${String(f).padStart(3, '0')}`;
}

const r3 = (x) => Math.round(x * 1000) / 1000;

// SRT / generic markup -> plain text with <i> <b> <u>.
function cleanSrt(s) {
  return s
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<\s*(\/?)\s*([ibu])\s*>/gi, (m, c, t) => `<${c}${t.toLowerCase()}>`)
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/<\/?span[^>]*>/gi, '');
}

const TIMING = /^\s*(\S+)\s*-->\s*(\S+)(.*)$/;

export function parseSrt(text) {
  const cues = [];
  const ls = lines(text);
  let cur = null;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const m = TIMING.exec(l);
    if (m) {
      const start = parseTime(m[1]), end = parseTime(m[2]);
      if (start != null && end != null) {
        if (cur && cur.lines.length && /^\s*\d+\s*$/.test(cur.lines[cur.lines.length - 1])) cur.lines.pop(); // a number before a timing line
        cur = { start, end, lines: [] };
        cues.push(cur);
        continue;
      }
    }
    if (!cur) continue;
    if (!l.trim()) { cur.closed = true; continue; }
    if (cur.closed && /^\s*\d+\s*$/.test(l) && TIMING.test(ls[i + 1] || '')) continue;
    if (cur.closed) { cur.closed = false; }
    cur.lines.push(l);
  }
  return { format: 'srt', cues: cues.map((c) => ({ start: r3(c.start), end: r3(c.end), text: cleanSrt(c.lines.join('\n')).trim() })) };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '‎', rlm: '‏', quot: '"', apos: "'" };

function vttText(s, cue) {
  const v = /<v(?:\.[^\s>]*)?\s+([^>]+)>/.exec(s);
  if (v && cue) cue.voice = v[1].trim();
  return s
    .replace(/<(\/?)([ibu])(?:\.[^>\s]*)?(?:\s[^>]*)?>/g, '\u0001$1$2\u0002')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\u0001(\/?)([ibu])\u0002/g, '<$1$2>');
}

export function parseVtt(text) {
  const ls = lines(text);
  const cues = [], styles = [];
  let i = 0;
  // header block
  while (i < ls.length && ls[i].trim()) i++;
  while (i < ls.length) {
    while (i < ls.length && !ls[i].trim()) i++;
    if (i >= ls.length) break;
    const block = [];
    while (i < ls.length && ls[i].trim()) block.push(ls[i++]);
    const first = block[0];
    if (/^NOTE(\s|$)/.test(first) || /^REGION(\s|$)/.test(first)) continue;
    if (/^STYLE(\s|$)/.test(first)) { styles.push(block.slice(1).join('\n')); continue; }
    let k = 0, id = null;
    if (!first.includes('-->')) { id = first.trim(); k = 1; }
    const m = TIMING.exec(block[k] || '');
    if (!m) continue;
    const start = parseTime(m[1]), end = parseTime(m[2]);
    if (start == null || end == null) continue;
    const cue = { start: r3(start), end: r3(end), text: '' };
    if (id) cue.id = id;
    const settings = m[3].trim();
    if (settings) cue.settings = settings;
    cue.text = vttText(block.slice(k + 1).join('\n'), cue).trim();
    cues.push(cue);
  }
  return { format: 'vtt', cues, styles };
}

// ASS times are centiseconds ('0:00:01.50'): fraction divided by 10^digits, not padded like SRT.
function assTime(s) {
  const m = /^\s*(\d+):(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\s*$/.exec(s);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4] / 10 ** m[4].length : 0);
}

// Character scanner, not regex replace: override blocks carry state (italic on/off, drawing mode) across the line.
// The reset tag closes all styles; all open tags are closed at the end, so output is always balanced.
// ASS dialogue text -> plain text with <i> <b> <u>.
function assText(s) {
  let out = '', drawing = false;
  const open = { i: false, b: false, u: false };
  const toggle = (t, on) => {
    if (on && !open[t]) { out += `<${t}>`; open[t] = true; } else if (!on && open[t]) { out += `</${t}>`; open[t] = false; }
  };
  for (let i = 0; i < s.length;) {
    if (s[i] === '{') {
      const e = s.indexOf('}', i);
      if (e < 0) { if (!drawing) out += s.slice(i); break; }
      const block = s.slice(i + 1, e);
      for (const m of block.matchAll(/\\(?:([ibu])(\d+)(?![a-z])|p(\d+)|(r)(?![a-z]))/g)) {
        if (m[1]) toggle(m[1], +m[2] !== 0);
        else if (m[3] != null) drawing = +m[3] > 0;
        else if (m[4]) { toggle('i', false); toggle('b', false); toggle('u', false); }
      }
      i = e + 1;
      continue;
    }
    if (s[i] === '\\' && (s[i + 1] === 'N' || s[i + 1] === 'n' || s[i + 1] === 'h')) {
      if (!drawing) out += s[i + 1] === 'h' ? ' ' : '\n';
      i += 2;
      continue;
    }
    if (!drawing) out += s[i];
    i++;
  }
  for (const t of ['u', 'b', 'i']) toggle(t, false);
  return out.replace(/<([ibu])><\/\1>/g, '').trim();
}

// Column order comes from each section's Format line (SSA and ASS differ, scripts reorder). Text is the last
// column and may contain commas, so the split is limited to the Format length. Final sort is stable (index tiebreak).
export function parseAss(text) {
  const out = { format: 'ass', info: {}, styles: [], cues: [] };
  let section = '', styleFmt = null, eventFmt = null;
  for (const raw of lines(text)) {
    const l = raw.trim();
    if (!l || l.startsWith(';')) continue;
    const sec = /^\[(.+)\]$/.exec(l);
    if (sec) { section = sec[1].trim().toLowerCase(); continue; }
    const c = l.indexOf(':');
    if (c < 0) continue;
    const key = l.slice(0, c).trim(), val = l.slice(c + 1).trim();
    if (section === 'script info') {
      out.info[key] = val;
      if (/^scripttype$/i.test(key) && /^v4\.00$/i.test(val)) out.format = 'ssa';
    } else if (/styles$/.test(section)) {
      if (/^format$/i.test(key)) styleFmt = val.split(',').map((x) => x.trim().toLowerCase());
      else if (/^style$/i.test(key)) {
        const fmt = styleFmt || ['name', 'fontname', 'fontsize'];
        const parts = val.split(',');
        const st = {};
        fmt.forEach((f, i) => { st[f] = (parts[i] ?? '').trim(); });
        if (st.fontsize && !Number.isNaN(+st.fontsize)) st.fontsize = +st.fontsize;
        out.styles.push(st);
      }
    } else if (section === 'events') {
      if (/^format$/i.test(key)) eventFmt = val.split(',').map((x) => x.trim().toLowerCase());
      else if (/^dialogue$/i.test(key)) {
        const fmt = eventFmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
        const parts = [];
        let rest = val;
        for (let i = 0; i < fmt.length - 1; i++) {
          const k = rest.indexOf(',');
          if (k < 0) { parts.push(rest); rest = ''; continue; }
          parts.push(rest.slice(0, k));
          rest = rest.slice(k + 1);
        }
        parts.push(rest);
        const f = Object.fromEntries(fmt.map((k, i) => [k, parts[i] ?? '']));
        const start = assTime(f.start), end = assTime(f.end);
        if (start == null || end == null) continue;
        const txt = assText(f.text || '');
        if (!txt) continue;
        out.cues.push({
          start: r3(start), end: r3(end), text: txt, style: (f.style || '').trim() || 'Default',
          layer: Number.parseInt(f.layer, 10) || 0, name: (f.name || '').trim(), effect: (f.effect || '').trim(),
        });
      }
    }
  }
  out.cues = out.cues.map((c, i) => [c, i]).sort((a, b) => a[0].start - b[0].start || a[1] - b[1]).map((x) => x[0]);
  return out;
}

// Frame-based: times depend on fps; the de facto '{1}{1}25' first line overrides the default. Empty end frame means
// a zero-length cue. '{y:i}' is the only style mapped; '|' is the line break.
export function parseMicroDvd(text, { fps = 23.976 } = {}) {
  const cues = [];
  let rate = fps;
  for (const l of lines(text)) {
    const m = /^\{(\d+)\}\{(\d*)\}(.*)$/.exec(l.trim());
    if (!m) continue;
    const a = +m[1], b = m[2] === '' ? a : +m[2];
    if (a === 1 && b === 1 && /^\d+(\.\d+)?$/.test(m[3].trim())) { rate = +m[3]; continue; }
    let t = m[3];
    const italic = /\{y:i\}/i.test(t);
    t = t.replace(/\{[^}]*\}/g, '').split('|').join('\n').trim();
    if (italic) t = `<i>${t}</i>`;
    cues.push({ start: r3(a / rate), end: r3(b / rate), text: t });
  }
  return { format: 'microdvd', cues };
}

// Extension first (cheap, usually right), then content sniffing on the first 2000 chars; SRT is the fallback
// because it is the most common format and its parser is the most forgiving.
export function parseSubs(text, name = '') {
  const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1]?.toLowerCase();
  const t = String(text || '');
  if (ext === 'vtt') return parseVtt(t);
  if (ext === 'ass' || ext === 'ssa') return parseAss(t);
  if (ext === 'srt') return parseSrt(t);
  if (ext === 'sub' && /^\s*\{\d+\}\{\d*\}/m.test(t)) return parseMicroDvd(t);
  const head = t.replace(/^﻿/, '').slice(0, 2000);
  if (/^WEBVTT/.test(head)) return parseVtt(t);
  if (/^\s*\[Script Info\]/im.test(head) || /^\s*Dialogue:/m.test(t)) return parseAss(t);
  if (/^\s*\{\d+\}\{\d*\}/m.test(head)) return parseMicroDvd(t);
  return parseSrt(t);
}

// An arrow inside cue text would be misread as a timing line by a VTT parser; blank lines would end the cue block.
// Escapes text for WebVTT, keeping <i> <b> <u>.
function escVtt(s) {
  return String(s).split(/(<\/?[ibu]>)/).map((part, i) => (i % 2 ? part
    : part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))).join('')
    .replace(/--&gt;/g, '-&gt;').replace(/\n{2,}/g, '\n').trim();
}

export function toVtt(cues) {
  const body = (cues || []).map((c) => {
    const id = c.id && !c.id.includes('-->') ? c.id + '\n' : '';
    return `${id}${formatTime(c.start)} --> ${formatTime(c.end)}${c.settings ? ' ' + c.settings : ''}\n${escVtt(c.text || '')}`;
  });
  return 'WEBVTT\n\n' + body.join('\n\n') + (body.length ? '\n' : '');
}

// SRT has no escaping: a blank line inside text would split the cue, so runs of newlines collapse to one.
export function toSrt(cues) {
  return (cues || []).map((c, i) => `${i + 1}\n${formatTime(c.start, ',')} --> ${formatTime(c.end, ',')}\n${String(c.text || '').replace(/\n{2,}/g, '\n').trim()}\n`).join('\n');
}

// Immutable: returns new cue objects. Cues fully before 0 are dropped; partially negative ones are clipped at 0.
export function shiftCues(cues, seconds) {
  const d = Number(seconds) || 0;
  return (cues || []).filter((c) => c.end + d > 0).map((c) => ({ ...c, start: r3(Math.max(0, c.start + d)), end: r3(c.end + d) }));
}
