// mediajobs/job.js - the job model shared by the builders, the shell renderer and the runner: plain JSON-able job
// specs, argument groups, placeholders, times and file names.
//
//   job spec  { kind, title, steps: [step], outputs: [path], notes?: [text] }
//   step      { tool: 'ffmpeg' | 'ffprobe' | 'yt-dlp' | 'magick', argv: [string | number] (without the program),
//               groups: [n] | null (sizes of the argument groups a renderer keeps on one line; optional),
//               comment, files: { name: text } (auxiliary files written into the job's work folder),
//               capture: 'json' | 'text' | null, parse: 'loudnorm' | 'ffprobe' | 'ytdlp-info' | 'identify' | null,
//               progress: 'ffmpeg' | 'ytdlp' | null, duration: seconds | null }
//   placeholders in argv strings (and auxiliary file texts):
//               {work}            the job's private work folder ({work}/chapters.txt)
//               {var:ns.key}      a value an earlier step parsed (vars.loudnorm.input_i after parse 'loudnorm')
//
//   makeStep(fields) -> step with every key        makeJob(kind, title, steps, outputs, extra) -> spec
//   new Args().add(...words) / .opt(flag, value) / .addIf(cond, ...words); .argv, .groups, .step(fields)
//   substitute(s, { work, vars, join }) -> s with the placeholders replaced (throws on a variable without value)
//   placeholders(s) -> [{ type: 'work' } | { type: 'var', name }]    getVar(vars, 'ns.key')
//   varStep(spec, name) -> index of the step whose parse produces the variable's namespace, or -1
//   usesWork(spec) -> whether a step has auxiliary files or {work} references
//   parseTime(x) -> seconds | null (75, '75', '1:15', '01:02:03.5')
//   fileSafe(name, { maxBytes = 200, replacement = '_' }) -> a file name valid on Windows, macOS and Linux
//   joinPath(dir, name) (keeps the separator style of dir)   baseName(path)   extOf(path) -> 'mp3' | ''
//   argPath(p) -> './-x.mp3' for a path that starts with '-' (tools would read it as an option)
//   plainText(s, max = 120) -> one line without characters that shells treat specially in comments
//   hashId(value) -> 8 hex digits (FNV-1a of the JSON), for stable work folder names
//
// Limit: a user string that literally contains "{work}" or "{var:…}" is substituted too.

// Design rule: a job is DATA (JSON-able), never closures. The same spec is rendered to bash, rendered to cmd,
// executed by the runner, stored in the queue and hashed for a work folder name; any function in it would break
// at least two of those.
export const TOOL_BINS = ['ffmpeg', 'ffprobe', 'yt-dlp', 'magick'];

// Normalizes builder output: null/false args are dropped (lets builders write `cond && '-flag'` inline), numbers stay
// numbers (the runner stringifies), groups are kept only if they still partition argv exactly. Every key is always
// present, so consumers never test for undefined.
export function makeStep({ tool, argv = [], groups = null, comment = '', files = null, capture = null, parse = null, progress = null, duration = null } = {}) {
  const list = argv.filter((a) => a != null && a !== false).map((a) => (typeof a === 'number' ? a : String(a)));
  const ok = Array.isArray(groups) && groups.every((n) => Number.isInteger(n) && n > 0) && groups.reduce((a, b) => a + b, 0) === list.length;
  return {
    tool, argv: list, groups: ok ? groups : null, comment: String(comment || ''),
    files: files && Object.keys(files).length ? { ...files } : {},
    capture: capture || null, parse: parse || null, progress: progress || null,
    duration: Number.isFinite(+duration) && +duration > 0 ? +duration : null,
  };
}

export function makeJob(kind, title, steps, outputs = [], extra = {}) {
  const spec = { kind, title: String(title || kind), steps, outputs: outputs.filter(Boolean).map(String) };
  for (const [k, v] of Object.entries(extra)) if (v != null && !(Array.isArray(v) && !v.length)) spec[k] = v;
  return spec;
}

/** Argument groups: each add() is one group (kept on one line when rendered). */
export class Args {
  constructor() { this.list = []; }
  add(...words) {
    const g = words.flat().filter((w) => w != null && w !== false).map(String);
    if (g.length) this.list.push(g);
    return this;
  }
  addIf(cond, ...words) { return cond ? this.add(...words) : this; }
  /** A flag with a value; skipped when the value is null / undefined / ''. */
  opt(flag, value) { return value == null || value === '' ? this : this.add(flag, value); }
  get argv() { return this.list.flat(); }
  get groups() { return this.list.map((g) => g.length); }
  step(fields = {}) { return makeStep({ ...fields, argv: this.argv, groups: this.groups }); }
}

// --- placeholders -----------------------------------------------------------------------------------------------

// Placeholder grammar is intentionally tiny: two forms, ASCII names. Substitution happens at run time (runner) or
// render time (shell), never at build time, so a spec stays portable between machines and work folders.
const PH = /\{(work|var:([A-Za-z0-9_.-]+))\}/g;

export function placeholders(s) {
  const out = [];
  for (const m of String(s).matchAll(PH)) out.push(m[2] ? { type: 'var', name: m[2] } : { type: 'work' });
  return out;
}

// NOTE: uses the `in` operator, which also sees inherited properties: {var:x.constructor} resolves to a function
// and is then stringified by substitute(). Harmless for trusted specs (variables are named by builders, values come
// from parsed tool output), but an own-property check (Object.hasOwn) would be stricter.
export function getVar(vars, name) {
  let v = vars;
  for (const k of String(name).split('.')) {
    if (v == null || typeof v !== 'object' || !(k in v)) return undefined;
    v = v[k];
  }
  return v;
}

// Non-finite numbers become ±99: ffmpeg's loudnorm reports "-inf" for digital silence, and passing "-Infinity" as a
// filter option fails the second pass; ±99 are the bounds of the ranges the second pass accepts (ffmpeg.js RANGES,
// where parseLoudnorm also clamps), so this is a last-resort fallback for unclamped values.
const varText = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : (v > 0 ? '99' : '-99')) : String(v));

/**
 * Replaces {work} and {var:…}. join(work, 'a', 'b') builds the path for {work}/a/b (default: work + '/' + rest).
 * A variable without value throws (the message names it).
 */
// Fail fast: a missing variable throws with its name instead of running a tool with a literal "{var:...}" argument,
// which would fail later with an unrelated message (or worse, succeed with a wrong value).
export function substitute(s, { work = null, vars = {}, join = null } = {}) {
  return String(s).replace(/\{work\}((?:\/[^/\s'":;,[\]=]+)*)|\{var:([A-Za-z0-9_.-]+)\}/g, (m, rest, name) => {
    if (name) {
      const v = getVar(vars, name);
      if (v === undefined || v === null || typeof v === 'object') throw new Error(`{var:${name}} has no value (no earlier step produced it)`);
      return varText(v);
    }
    if (work == null) throw new Error('{work} is used but the job has no work folder');
    const parts = rest ? rest.split('/').filter(Boolean) : [];
    return join ? join(work, ...parts) : [work, ...parts].join('/');
  });
}

export function varStep(spec, name) {
  const ns = String(name).split('.')[0];
  return (spec?.steps || []).findIndex((s) => s.parse === ns);
}

export function usesWork(spec) {
  return (spec?.steps || []).some((s) => (s.files && Object.keys(s.files).length) || (s.argv || []).some((a) => String(a).includes('{work}')));
}

// --- times ------------------------------------------------------------------------------------------------------

// Accepts plain seconds and [h:]mm:ss[.frac]; minutes/seconds limited to two digits so "1:2:3" parses but "1:234"
// is rejected. Range of minutes/seconds (<60) is not checked: "0:75" is 75 s, tolerant of hand input.
export function parseTime(x) {
  if (x == null || x === '') return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
}

// --- names and paths --------------------------------------------------------------------------------------------

// Windows device names are reserved with ANY extension (nul.txt opens the null device); superscript digits ¹²³ are
// also reserved (documented Win32 quirk). Prefixing the replacement character is the minimal change that frees them.
// Byte length (UTF-8) rather than string length: file systems limit name BYTES (255 on ext4/APFS); 200 leaves room
// for suffixes tools append (.part, .f137, .temp).
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;
const utf8Len = (s) => { let n = 0; for (const c of s) { const k = c.codePointAt(0); n += k < 0x80 ? 1 : k < 0x800 ? 2 : k < 0x10000 ? 3 : 4; } return n; };
function cutBytes(s, max) {
  let out = '', n = 0;
  for (const c of s) {
    const k = c.codePointAt(0);
    const b = k < 0x80 ? 1 : k < 0x800 ? 2 : k < 0x10000 ? 3 : 4;
    if (n + b > max) break;
    out += c; n += b;
  }
  return out;
}

// Order of steps matters: NFC first (macOS returns NFD names; normalizing avoids two visually equal names), control
// chars to spaces, forbidden chars <>:"/\|?* replaced, whitespace collapsed, trailing dots/spaces removed (Windows
// silently strips them, so "a." and "a" would collide). When cutting to the byte limit the extension is preserved
// and the cut never splits a code point.
export function fileSafe(name, { maxBytes = 200, replacement = '_' } = {}) {
  let s = String(name ?? '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[<>:"/\\|?*]/g, replacement)
    .replace(/\s+/g, ' ').trim()
    .replace(/[. ]+$/, '');
  if (RESERVED.test(s)) s = replacement + s;
  if (!s || /^\.+$/.test(s)) s = replacement;
  if (utf8Len(s) > maxBytes) {
    const m = /(\.[A-Za-z0-9]{1,8})$/.exec(s);
    const ext = m ? m[1] : '';
    s = cutBytes(s.slice(0, s.length - ext.length), maxBytes - ext.length).replace(/[. ]+$/, '') + ext;
  }
  return s;
}

// Keeps the caller's separator style: a pure-backslash dir is a Windows path; anything with '/' (including mixed)
// gets '/', which Windows APIs accept too.
export function joinPath(dir, name) {
  if (dir == null || dir === '') return String(name);
  const d = String(dir);
  if (/[\\/]$/.test(d)) return d + name;
  const sep = d.includes('\\') && !d.includes('/') ? '\\' : '/';
  return d + sep + name;
}

export const baseName = (p) => String(p ?? '').split(/[\\/]/).pop();

export function extOf(p) {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

// A file named "-x.mp3" would be parsed as an option by every tool here; "./-x.mp3" is the same file and cannot be.
export const argPath = (p) => (/^-/.test(String(p)) ? './' + p : String(p));

/** One comment line: no line breaks and none of & | < > ^ % ! " \ (cmd.exe may still parse them after REM). */
export function plainText(s, max = 120) {
  const t = String(s ?? '').replace(/[&|<>^%!"\\\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// FNV-1a 32-bit over the UTF-16 code units of the JSON (not UTF-8 bytes: stable within this codebase, which is all
// a folder name needs). Math.imul keeps the multiply in 32-bit integer arithmetic; >>> 0 makes it unsigned.
// Not a security hash: collisions only mean two jobs share a work folder name.
export function hashId(value) {
  let s;
  try { s = JSON.stringify(value) ?? ''; } catch { s = String(value); }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
