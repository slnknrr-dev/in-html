// fileapi/glob.js - glob patterns over relative paths with '/' separators (the paths of fileapi listings).
//
//   globToRegExp(glob, { nocase = true, dot = false }) -> RegExp matching a whole relative path
//   matchGlob(relPath, glob, opts)       -> boolean
//   matchAny(relPath, globs, opts)       -> boolean (false for an empty list)
//   filterPaths(paths, { include = [], exclude = [] }, opts) -> the paths kept: an empty include keeps everything;
//                                           a path is excluded when it or one of its ancestor folders matches an
//                                           exclude glob (excluding a folder excludes its contents)
//
// Syntax:
//   *        any characters except '/'          ?        one character except '/'
//   **       a whole segment: any number of segments, including none ('a/**/b' matches 'a/b' and 'a/x/y/b',
//            'a/**' matches 'a' and everything below it, '**' alone matches everything); inside a segment it is '*'
//   [abc] [a-z] [!a-z] [^a-z]   character classes (never match '/'); an unclosed '[' is literal
//   {a,b,c}  alternatives, nested braces allowed, alternatives may contain '/' and wildcards; '{a}' and an unclosed
//            '{' are literal (as in bash)
//   \x       the character x literally
// Anchoring (gitignore-like): a glob without '/' matches the base name at any depth ('*.mp3' matches 'a.mp3' and
// 'x/y/a.mp3'); a glob with '/' matches the whole path from the root; a leading '/' only anchors ('/*.mp3' matches
// top-level files only); a leading './' and a trailing '/' are ignored.
// dot = false: '*', '?', classes and '**' do not match a leading '.' of a segment (hidden names); a literal '.x' does.
// nocase = true: case-insensitive (music libraries mix 'MP3' and 'mp3').

// Implementation: a recursive-descent translator from glob to a JS RegExp source (seq handles a sequence, braces
// recurse into seq with inBrace). Compiling to RegExp, rather than writing a matcher, gets the engine's speed and
// lets listings filter thousands of paths cheaply; compiled patterns are memoised.
// `atStart` tracks "at the beginning of a path segment" - needed both for '**' (only special as a whole segment) and
// for the dot rule (the (?!\.) lookahead is inserted only where a segment begins).
// Every literal goes through esc(), so no glob character can inject regex syntax. Patterns are linear except for
// '**' expansions, which nest a bounded quantifier per '**'; globs come from the authenticated user, not strangers.
const ESC = /[.*+?^${}()|[\]\\]/g;
const esc = (s) => s.replace(ESC, '\\$&');

function compile(src, dot) {
  let i = 0;
  const lead = dot ? '' : '(?!\\.)';
  const SEG = lead + '[^/]+';

  // A ']' right after '[' (or '[!') is a literal member, as in POSIX. Negated classes add '/' to the excluded set,
  // positive ones are guarded by (?!/), so no class can ever cross a segment boundary. Returns null when unclosed so
  // the caller can fall back to a literal '['.
  function charClass() {
    // src[i] === '['
    let j = i + 1;
    let neg = false;
    if (src[j] === '!' || src[j] === '^') { neg = true; j++; }
    let body = '';
    let first = true;
    while (j < src.length) {
      const c = src[j];
      if (c === ']' && !first) {
        i = j + 1;
        return neg ? `[^/${body}]` : `(?!/)[${body}]`;
      }
      if (c === '\\' && j + 1 < src.length) { const n = src[j + 1]; body += /\w/.test(n) ? n : '\\' + n; j += 2; first = false; continue; }
      body += c === '\\' || c === ']' || c === '[' || c === '^' ? '\\' + c : c;
      j++;
      first = false;
    }
    return null;
  }

  function seq(inBrace, atStart) {
    let out = '';
    while (i < src.length) {
      const c = src[i];
      if (inBrace && (c === ',' || c === '}')) break;
      if (c === '\\') {
        if (i + 1 < src.length) { out += esc(src[i + 1]); i += 2; } else { out += '\\\\'; i++; }
        atStart = false;
        continue;
      }
      if (c === '/') { out += '/'; i++; atStart = true; continue; }
      // '**' as a whole segment has three placements: 'x/**/y' -> zero or more "seg/" groups; trailing 'x/**' -> the
      // preceding '/' is folded into an optional "(/seg)*" so 'x' itself matches; a lone '**' -> optional
      // "seg(/seg)*". Anywhere else '**' degrades to '*'.
      if (c === '*') {
        let j = i;
        while (src[j] === '*') j++;
        const after = src[j];
        const endsSeg = after === undefined || after === '/' || (inBrace && (after === ',' || after === '}'));
        if (j - i >= 2 && atStart && endsSeg) {
          if (after === '/') { out += `(?:${SEG}/)*`; i = j + 1; atStart = true; continue; }
          if (out.endsWith('/')) out = out.slice(0, -1) + `(?:/${SEG})*`;
          else out += `(?:${SEG}(?:/${SEG})*)?`;
          i = j;
          atStart = false;
          continue;
        }
        out += (atStart ? lead : '') + '[^/]*';
        i = j;
        atStart = false;
        continue;
      }
      if (c === '?') { out += (atStart ? lead : '') + '[^/]'; i++; atStart = false; continue; }
      if (c === '[') {
        const save = i;
        const cls = charClass();
        if (cls) { out += (atStart ? lead : '') + cls; atStart = false; continue; }
        i = save + 1;
        out += '\\[';
        atStart = false;
        continue;
      }
      if (c === '{') {
        const save = i;
        i++;
        const alts = [];
        let closed = false;
        for (;;) {
          alts.push(seq(true, atStart));
          if (src[i] === ',') { i++; continue; }
          if (src[i] === '}') { i++; closed = true; }
          break;
        }
        if (closed && alts.length > 1) { out += '(?:' + alts.join('|') + ')'; atStart = false; continue; }
        i = save + 1;
        out += '\\{';
        atStart = false;
        continue;
      }
      out += esc(c);
      i++;
      atStart = false;
    }
    return out;
  }

  return seq(false, true);
}

const cache = new Map();

// Unanchored globs (no '/') get a prefix of "any number of (non-hidden) folders", which is what makes '*.mp3' match
// at any depth. If compilation still produced an invalid regex (a path not foreseen above), the glob falls back to a
// fully literal match instead of throwing in the middle of a listing. The cache is simply cleared when it grows past
// 500 entries - crude, but bounded and never wrong.
export function globToRegExp(glob, { nocase = true, dot = false } = {}) {
  const key = `${nocase ? 1 : 0}${dot ? 1 : 0}${glob}`;
  let re = cache.get(key);
  if (re) return re;
  let g = String(glob ?? '');
  let anchored = false;
  if (g.startsWith('./')) g = g.slice(2);
  if (g.startsWith('/')) { anchored = true; g = g.replace(/^\/+/, ''); }
  if (g.length > 1) g = g.replace(/\/+$/, '');
  const hasSlash = /(^|[^\\])\//.test(g);
  const prefix = anchored || hasSlash ? '' : `(?:${dot ? '' : '(?!\\.)'}[^/]+/)*`;
  const flags = nocase ? 'i' : '';
  try { re = new RegExp('^' + prefix + compile(g, dot) + '$', flags); } catch { re = new RegExp('^' + prefix + esc(g) + '$', flags); }
  if (cache.size > 500) cache.clear();
  cache.set(key, re);
  return re;
}

export const matchGlob = (relPath, glob, opts) => globToRegExp(glob, opts).test(String(relPath));

export function matchAny(relPath, globs, opts) {
  if (!globs) return false;
  for (const g of Array.isArray(globs) ? globs : [globs]) if (g !== '' && g != null && matchGlob(relPath, g, opts)) return true;
  return false;
}

// True when the path or one of its ancestor folders matches.
function excludedPath(p, exclude, opts) {
  const segs = String(p).split('/');
  for (let k = 1; k <= segs.length; k++) if (matchAny(segs.slice(0, k).join('/'), exclude, opts)) return true;
  return false;
}

export function filterPaths(paths, { include = [], exclude = [] } = {}, opts) {
  const inc = (Array.isArray(include) ? include : [include]).filter((g) => g !== '' && g != null);
  const exc = (Array.isArray(exclude) ? exclude : [exclude]).filter((g) => g !== '' && g != null);
  return paths.filter((p) => (!inc.length || matchAny(p, inc, opts)) && !(exc.length && excludedPath(p, exc, opts)));
}
