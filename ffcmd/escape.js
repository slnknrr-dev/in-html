// ffcmd/escape.js - ffmpeg's own quoting inside filter graphs, numbers and colours as ffmpeg reads them.
//
// A filter graph is parsed in two levels (ffmpeg-filters, "Notes on filtergraph escaping"):
//   level 1  the value of one filter option: ':' separates options, '\' and ''' are escaping characters
//   level 2  the filter description inside the graph: '[' ']' ',' ';' are graph syntax, '\' and ''' escape
// Both levels read a backslash as "take the next character literally". Single-quote quoting is never used here, so
// the same graph text works unchanged inside bash '…' quotes (no ' to break out of) and cmd.exe "…" quotes
// (where ' would be an ordinary character anyway): text "It's 10:30" in drawtext becomes
//   level 1  It\'s 10\:30          level 2  It\\\'s 10\\:30
// The shell quoting around the whole argument is cmdline/quote.js's job.
//
//   escapeValue(v)        level 1
//   escapeGraph(s)        level 2 (applied to the argument string of a filter)
//   num(x, digits = 3)    compact decimal: 2, 0.5, 1.333 (no exponent, no -0)
//   color(hex, alpha)     '#rrggbb' -> 'white' | 'black' | '#rrggbb' ['@0.5']
//   seconds(x)            num with millisecond precision

export function escapeValue(v) {
  return String(v).replace(/[\\':]/g, (c) => '\\' + c);
}

export function escapeGraph(s) {
  return String(s).replace(/[\\'[\],;]/g, (c) => '\\' + c);
}

// Fixed-point, never exponent notation: ffmpeg's option parser does read '1e-05', but expressions and some filters
// do not, and '-0' would look like a flag in places. Trailing zeros are trimmed for short, stable output.
export function num(x, digits = 3) {
  const v = Number(x);
  if (!Number.isFinite(v)) return '0';
  const k = 10 ** digits;
  let r = Math.round(v * k) / k;
  if (Object.is(r, -0) || r === 0) r = 0;
  let s = r.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

export const seconds = (x) => num(x, 3);

const NAMED = { '#ffffff': 'white', '#000000': 'black' };

// ffmpeg colour syntax: name or #RRGGBB with '@alpha'. Invalid input becomes black rather than an ffmpeg error at
// run time, far from where the value was entered.
export function color(hex, alpha = 1) {
  let c = String(hex || '#000000').toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  if (!/^#[0-9a-f]{6}$/.test(c)) c = '#000000';
  const base = NAMED[c] || c;
  return alpha >= 0.999 ? base : `${base}@${num(Math.max(0, alpha), 2)}`;
}
