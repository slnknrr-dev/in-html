// catalog/query.js - the query language of search, smart playlists and virtual folders.
//
//   words              free text: every word must occur in the title, alternative titles, people, album / show /
//                      series, tags, file names (diacritics and case ignored); "quoted phrase" keeps the spaces
//   field:value        a field (FIELDS below) — text fields match substrings, `=` exactly, `*` as a wildcard,
//                      /regex/i as a regular expression; title:"two words"
//   ns:value  #tag     a tag: unknown fields are tag namespaces (genre:rock matches genre:rock and genre:rock/punk,
//                      mood:calm, lang:ja, people:…); #favourite is a tag without namespace; ns:* any tag of ns
//   field:>=8 :<5 :!=x comparisons; field:1990..1999 ranges (open ends: 2000.. ..5m); field:a,b any of
//   units              durations 90s 5m 1h30m 1:20:00 (a bare number is minutes); sizes 700mb 2gb (bare: MB);
//                      dates 2024 2024-03 2024-03-15, relative 30d 2w 6mo 1y (added:<30d = less than 30 days ago,
//                      played:>1y = more than a year ago), played:never
//   presence:file|source|nominal  has:cover|lyrics|synced|subs|chapters|tags|tracking|markers|description|missing|
//                      children|video|audio  is:favorite|played|unplayed|watched|nominal|playable|missing|current|…
//   in:<playlist name or id>  source:<index source name or id>  kind:… domain:… status:… format:…
//   A B  A AND B  A & B   all;   A OR B  A | B   any;   -A  !A  NOT A   negation;   ( … )   grouping
// The parser is lenient: unbalanced parentheses are closed, stray operators dropped (listed in `warnings`).
//
//   parseQuery(text) -> { ast, warnings }        ast: { t: 'and' | 'or', a: [] } | { t: 'not', a } | { t: 'term', … } |
//                                                 { t: 'text', v } | { t: 'all' }
//   compileQuery(text | ast, db, { now }) -> (work) => boolean
//   runQuery(db, text, { kinds, domains, sort, limit, now, seed }) -> works
//   sortWorks(db, works, sort, { seed }) -> works  sort: 'title' | '-added' | [{ field, dir }] | 'random'
//   FIELDS, STATUS_ALIASES, explain(ast) -> text, parseDuration(s), parseSize(s), parseDate(s, now)
//
// Architecture: text -> tokenize -> recursive-descent parse -> AST -> build() compiles the AST into a tree of
// closures once -> the closure runs per work against facts(). Compiling (instead of interpreting the AST per work)
// hoists all per-term work out of the hot loop: regexes are built once, dates and units parsed once, collection
// lookups memoised. A smart playlist over 50 000 tracks then costs one closure call chain per track.
// Leniency over errors: the input is typed live in a search box, so every prefix of a valid query must still run.
// The parser never throws; it repairs (closes parentheses, drops dangling operators) and reports `warnings`.
// Precedence, loosest first: OR, AND (explicit or juxtaposition), NOT, atoms / parentheses; i.e. the usual
// boolean convention, so "a b OR c" = "(a AND b) OR c".

import { matchKey, naturalCompare } from './model.js';
import { facts } from './facts.js';
import { tagKey } from './tags.js';

// Field table: type decides which matcher buildTerm compiles (text substring, enum equality, numeric comparison,
// date window, list membership, tag, has-set, predicates). Getters read facts (f) and occasionally the raw work (w)
// for fields facts does not flatten. Adding a searchable field = one line here.
const T = (type, get, extra = {}) => ({ type, get, ...extra });
export const STATUS_ALIASES = {
  current: 'current', watching: 'current', listening: 'current', reading: 'current', playing: 'current',
  completed: 'completed', done: 'completed', finished: 'completed',
  paused: 'paused', onhold: 'paused', 'on-hold': 'paused', hold: 'paused',
  dropped: 'dropped', planned: 'planned', plan: 'planned', plantowatch: 'planned', ptw: 'planned',
  repeating: 'repeating', rewatching: 'repeating', relistening: 'repeating',
};
const KIND_ALIASES = { song: 'track', tracks: 'track', songs: 'track', albums: 'album', audiobook: 'book', books: 'book', series: 'show', tv: 'show', film: 'movie', films: 'movie', movies: 'movie', video: 'musicvideo', clip: 'musicvideo', mv: 'musicvideo', episodes: 'episode', seasons: 'season', chapters: 'chapter', podcasts: 'podcast' };
const DOMAIN_KINDS = new Set(['anime', 'music', 'audiobook', 'series', 'movie', 'musicvideo', 'podcast']);

export const FIELDS = {
  title: T('text', (f) => f.titles), artist: T('text', (f) => [...f.artist, ...f.albumartist]), albumartist: T('text', (f) => f.albumartist),
  composer: T('text', (f) => f.composer), author: T('text', (f) => f.author), narrator: T('text', (f) => f.narrator),
  director: T('text', (f) => f.director), studio: T('text', (f) => f.studio), people: T('text', (f) => f.people),
  album: T('text', (f) => [f.album]), show: T('text', (f) => [f.show]), series: T('text', (f) => [f.series]), book: T('text', (f) => [f.book]),
  path: T('text', (f) => f.paths), note: T('text', (f, w) => [w.note || '']), description: T('text', (f, w) => [w.description || '']),
  kind: T('enum', (f) => f.kind), domain: T('enum', (f) => f.domain), format: T('enum', (f) => f.format), status: T('enum', (f) => f.status),
  presence: T('enum', (f) => f.presence), id: T('enum', (f) => f.id),
  year: T('number', (f) => f.year), decade: T('number', (f) => f.decade), season: T('number', (f) => f.season), episode: T('number', (f) => f.episode),
  absolute: T('number', (f) => f.absolute), track: T('number', (f) => f.track), disc: T('number', (f) => f.disc), plays: T('number', (f) => f.plays),
  score: T('number', (f) => f.score), rating: T('number', (f) => f.rating), progress: T('number', (f) => f.progress), total: T('number', (f) => f.total),
  repeats: T('number', (f) => f.repeats), energy: T('number', (f) => f.energy), bpm: T('number', (f) => f.bpm), loudness: T('number', (f) => f.loudness),
  height: T('number', (f) => f.height), media: T('number', (f) => f.media), part: T('number', (f) => f.seriesPart),
  duration: T('duration', (f) => f.duration || undefined), size: T('size', (f) => f.size || undefined),
  added: T('date', (f) => f.added), played: T('date', (f) => f.lastPlayed), updated: T('date', (f) => f.updated),
  date: T('date', (f) => (f.date ? Date.parse(f.date) : f.year ? Date.UTC(f.year, 0, 1) : undefined)),
  lang: T('list', (f) => f.lang), ext: T('list', (f) => f.exts), codec: T('list', (f) => f.codecs),
  tag: T('tag', (f) => f.tags), has: T('set', (f) => f.has), is: T('is', null), in: T('in', null), source: T('source', null),
};
const FIELD_ALIASES = { a: 'artist', t: 'title', y: 'year', g: 'genre', alb: 'album', dur: 'duration', len: 'duration', length: 'duration', lastplayed: 'played', type: 'kind', res: 'height', resolution: 'height', ep: 'episode', s: 'season', n: 'track', tags: 'tag', language: 'lang', rated: 'rating', stars: 'rating' };

// --- units ------------------------------------------------------------------------------------------------------------

// Seconds. Accepted: clock form (m:ss or h:mm:ss), bare number = minutes (the natural unit for "songs longer than
// 5"), and unit sequences "1h30m". Any unparsed text between or after units makes the whole value NaN, so a typo
// fails loudly (term becomes a tag lookup / false) instead of silently matching on a partial number.
export function parseDuration(s) {
  s = String(s).trim().toLowerCase();
  if (!s) return NaN;
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) return s.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 60;
  let total = 0, any = false;
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/g;
  let m, last = 0;
  while ((m = re.exec(s))) {
    if (s.slice(last, m.index).trim()) return NaN;
    any = true; last = re.lastIndex;
    const v = Number(m[1]);
    total += m[2].startsWith('h') ? v * 3600 : m[2].startsWith('m') ? v * 60 : v;
  }
  return any && !s.slice(last).trim() ? total : NaN;
}

// Bytes, binary multiples (1 MB = 2^20, as file managers on most systems display). Bare number = MB.
export function parseSize(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g|tb|t)?$/i.exec(String(s).trim());
  if (!m) return NaN;
  const u = (m[2] || 'mb').toLowerCase()[0];
  return Number(m[1]) * ({ b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[u]);
}

// Absolute dates -> { t (ms), span (ms) }; relative ages ('30d') -> { age (ms) }.
// A partial date is a *window*: '2024-03' spans the whole month, so year:2024 style equality, '<' (before the
// window) and '>' (after it) all have a natural meaning. Month and year ages use mean lengths (30.44 d, 365.25 d):
// calendar-exact arithmetic is not worth it for "added in the last 6 months". Note 'm' is not a date unit here
// (it means minutes in durations); months are 'mo'. Absolute dates are UTC, so a window may be off by the local
// UTC offset at its edges.
export function parseDate(s, nowMs = Date.now()) {
  s = String(s).trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?|mo|months?|y|years?|h|hours?)$/.exec(s);
  if (m) {
    const v = Number(m[1]);
    const unit = m[2].startsWith('mo') ? 30.44 * 864e5 : m[2][0] === 'd' ? 864e5 : m[2][0] === 'w' ? 7 * 864e5 : m[2][0] === 'y' ? 365.25 * 864e5 : 36e5;
    return { age: v * unit };
  }
  if (s === 'today') { const d = new Date(nowMs); return { t: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), span: 864e5 }; }
  m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s);
  if (m) {
    const y = +m[1], mo = m[2] ? +m[2] - 1 : 0, d = m[3] ? +m[3] : 1;
    const t = Date.UTC(y, mo, d);
    const end = m[3] ? t + 864e5 : m[2] ? Date.UTC(y, mo + 1, 1) : Date.UTC(y + 1, 0, 1);
    return { t, span: end - t };
  }
  return null;
}

// --- tokenizer and parser ---------------------------------------------------------------------------------------------

// Hand-written scanner (a single regex cannot handle field:"quoted value" and field:/regex with spaces/ together).
// Rules worth knowing:
// - '-' / '!' are negation only when followed by a non-space, non-digit, non-')' char: "-live" negates, "-5" and
//   "a - b" stay literal, so negative numbers and hyphenated text survive.
// - OR / AND / NOT are operators only in upper case and unquoted; "or" lower case is a search word (titles contain it).
// - Typographic quotes (“…”, «…») are accepted because users paste titles from the web and Russian keyboards.
// - A regex value runs to the next '/' (no escaping of '/' inside: a pattern containing '/' must use [/] or \x2f).
function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const readQuoted = () => {
    const q = src[i++];
    let v = '';
    while (i < n && src[i] !== q) { if (src[i] === '\\' && i + 1 < n) i++; v += src[i++]; }
    i++;
    return v;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (c === '(' || c === ')') { out.push({ t: c, pos: i++ }); continue; }
    if (c === '|') { out.push({ t: 'or', pos: i++ }); if (src[i] === '|') i++; continue; }
    if (c === '&') { out.push({ t: 'and', pos: i++ }); if (src[i] === '&') i++; continue; }
    if ((c === '-' || c === '!') && i + 1 < n && !/[\s)]/.test(src[i + 1]) && !/\d/.test(src[i + 1])) { out.push({ t: 'not', pos: i++ }); continue; }
    if (c === '"' || c === '“' || c === '«') {
      const close = c === '"' ? '"' : c === '“' ? '”' : '»';
      i++;
      let v = '';
      while (i < n && src[i] !== close) v += src[i++];
      i++;
      out.push({ t: 'word', v, quoted: true, pos: start });
      continue;
    }
    let v = '';
    let quotedValue = false;
    while (i < n && !/[\s()]/.test(src[i])) {
      if (src[i] === '"' && v.endsWith(':')) { v += readQuoted(); quotedValue = true; break; }
      if (src[i] === '/' && /:[<>=!]*$/.test(v)) {
        // a regex value: field:/…/flags (may contain spaces and parentheses)
        const j = src.indexOf('/', i + 1);
        if (j > i) { let k = j + 1; while (k < n && /[a-z]/i.test(src[k])) k++; v += src.slice(i, k); i = k; continue; }
      }
      v += src[i++];
    }
    if (!quotedValue && (v === 'OR' || v === 'AND' || v === 'NOT')) out.push({ t: v.toLowerCase(), pos: start });
    else out.push({ t: 'word', v, pos: start, quotedValue });
  }
  return out;
}

// Recursive descent, one function per precedence level. Every loop consumes at least one token per iteration, so
// parsing terminates on any input. A stray ')' at top level would stop parseOr early; the outer loop skips it with
// a warning and ANDs the remainder, so "a) b" still means "a b".
export function parseQuery(text) {
  const toks = tokenize(String(text || ''));
  const warnings = [];
  let p = 0;
  const peek = () => toks[p];
  function parseOr() {
    const a = [parseAnd()];
    while (peek() && peek().t === 'or') { p++; if (!peek() || peek().t === ')') { warnings.push('dangling OR'); break; } a.push(parseAnd()); }
    return a.length === 1 ? a[0] : { t: 'or', a };
  }
  function parseAnd() {
    const a = [];
    while (peek() && peek().t !== 'or' && peek().t !== ')') {
      if (peek().t === 'and') { p++; continue; }
      const x = parseNot();
      if (x) a.push(x);
    }
    if (!a.length) return { t: 'all' };
    return a.length === 1 ? a[0] : { t: 'and', a };
  }
  function parseNot() {
    const tk = peek();
    if (tk.t === 'not') { p++; if (!peek() || peek().t === ')' || peek().t === 'or') { warnings.push('dangling NOT'); return null; } const x = parseNot(); return x ? { t: 'not', a: x } : null; }
    if (tk.t === '(') {
      p++;
      const x = parseOr();
      if (peek() && peek().t === ')') p++; else warnings.push('missing )');
      return x;
    }
    p++;
    return termOf(tk);
  }
  let ast = { t: 'all' };
  while (p < toks.length) {
    const x = parseOr();
    ast = ast.t === 'all' ? x : { t: 'and', a: [ast, x] };
    if (peek() && peek().t === ')') { warnings.push('unbalanced )'); p++; }
  }
  return { ast, warnings };
}

// Classifies a word token. Field names must start with a letter / underscore, so "12:30" and "re:zero"-like text
// containing a colon after digits stays free text only when it does not look like a field; "http://..." is caught by
// the '//' check and stays text. Unknown field names are kept (not rejected): buildTerm treats them as tag
// namespaces. The ',' list form is disabled for text fields because titles legitimately contain commas.
function termOf(tk) {
  const v = tk.v;
  if (tk.quoted) return { t: 'text', v };
  if (v.startsWith('#') && v.length > 1) return { t: 'term', field: 'tag', op: '=', value: v.slice(1) };
  const m = /^([A-Za-z_][\w.-]*):(.*)$/s.exec(v);
  if (!m || m[2].startsWith('//')) return { t: 'text', v };
  let field = m[1].toLowerCase();
  field = FIELD_ALIASES[field] || field;
  let rest = m[2];
  const term = { t: 'term', field, raw: rest };
  if (tk.quotedValue) { term.op = ':'; term.value = rest; return term; }
  const op = /^(>=|<=|!=|>|<|=)/.exec(rest);
  if (op) { term.op = op[1]; rest = rest.slice(op[1].length); }
  else term.op = ':';
  const re = /^\/(.*)\/([a-z]*)$/s.exec(rest);
  if (re) { term.regex = [re[1], re[2]]; term.value = rest; return term; }
  if (term.op === ':' && rest.includes('..')) {
    const [a, b] = rest.split('..');
    term.op = 'range'; term.lo = a; term.hi = b;
    return term;
  }
  if (term.op === ':' && rest.includes(',') && !FIELDS[field]?.type?.startsWith('text')) { term.op = 'any'; term.list = rest.split(',').filter(Boolean); return term; }
  term.value = rest;
  return term;
}

// --- compile ----------------------------------------------------------------------------------------------------------

// A work lacking the value matches only '!=' ("bpm:!=120" includes untagged tracks; "bpm:>100" excludes them):
// absent data never satisfies a positive comparison, which matches SQL-like intuition minus NULL's three values.
function cmpNum(op, x, a, b) {
  if (x === undefined || x === null || Number.isNaN(x)) return op === '!=';
  switch (op) {
    case '>': return x > a; case '>=': return x >= a; case '<': return x < a; case '<=': return x <= a;
    case '!=': return x !== a; case 'range': return (a === null || x >= a) && (b === null || x <= b);
    default: return x === a;
  }
}

// Three matcher kinds, built once per term:
// - /regex/flags: user regex, flags whitelisted, default 'i'. An invalid pattern compiles to /$^/ (matches nothing)
//   instead of throwing mid-typing. User regexes can backtrack catastrophically; acceptable because the query author
//   is the local user and only hurts their own tab.
// - wildcards * and ?: each literal piece is matchKey-normalised and regex-escaped, then joined with .* / . and
//   anchored, so wildcards behave like shell globs on the normalised text.
// - plain: normalised substring; '=' requires whole-value equality; an empty value means "field is non-empty".
function textMatcher(term) {
  if (term.regex) {
    let re;
    try { re = new RegExp(term.regex[0], term.regex[1].replace(/[^gimsuy]/g, '') || 'i'); } catch { re = /$^/; }
    return (s) => re.test(String(s || ''));
  }
  const raw = String(term.value ?? '');
  if (raw.includes('*') || raw.includes('?')) {
    const re = new RegExp('^' + raw.split('*').map((p) => p.split('?').map((x) => matchKey(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.')).join('.*') + '$');
    return (s) => re.test(matchKey(s));
  }
  const v = matchKey(raw);
  if (term.op === '=') return (s) => matchKey(s) === v;
  return (s) => (v === '' ? !!String(s || '').trim() : matchKey(s).includes(v));
}

function numberOf(type, s, nowMs) {
  if (s === '' || s === undefined) return null;
  if (type === 'duration') return parseDuration(s);
  if (type === 'size') return parseSize(s);
  return Number(s);
}

// is:<word> predicates. Unknown words fall back to tracking-status aliases, then domains (is:anime), then match
// nothing: an unrecognised predicate yielding an empty list is a visible signal, matching everything would hide it.
function isPredicate(value) {
  const v = String(value).toLowerCase();
  switch (v) {
    case 'favorite': case 'favourite': case 'fav': case 'loved': return (f) => f.favorite;
    case 'played': case 'watched': case 'listened': case 'heard': return (f) => f.plays > 0 || f.status === 'completed';
    case 'unplayed': case 'unwatched': case 'new': return (f) => !f.plays && f.status !== 'completed';
    case 'playable': return (f) => f.presence !== 'nominal';
    case 'file': case 'source': case 'nominal': return (f) => f.presence === v;
    case 'missing': return (f) => f.has.has('missing');
    case 'compilation': return (f, w) => !!w.compilation;
    case 'special': return (f, w) => !!w.special;
    case 'airing': return (f, w) => w.airing === 'airing';
    case 'container': return (f) => f.has.has('children');
    case 'leaf': return (f) => !f.has.has('children');
    case 'rated': return (f) => f.score != null;
    default: {
      const st = STATUS_ALIASES[v];
      if (st) return (f) => f.status === st;
      if (DOMAIN_KINDS.has(v)) return (f) => f.domain === v;
      return () => false;
    }
  }
}

// `now` is captured at compile time, so relative dates ('30d') are stable for the whole run and tests can pin it.
// Accepts query text, a parseQuery result, or a bare AST.
export function compileQuery(q, db, { now: nowMs = Date.now() } = {}) {
  const ast = typeof q === 'string' ? parseQuery(q).ast : q && q.ast ? q.ast : q;
  const pred = build(ast, db, nowMs);
  return (w) => pred(facts(db, w), w);
}

function build(node, db, nowMs) {
  switch (node.t) {
    case 'all': return () => true;
    case 'and': { const ps = node.a.map((x) => build(x, db, nowMs)); return (f, w) => ps.every((p) => p(f, w)); }
    case 'or': { const ps = node.a.map((x) => build(x, db, nowMs)); return (f, w) => ps.some((p) => p(f, w)); }
    case 'not': { const p = build(node.a, db, nowMs); return (f, w) => !p(f, w); }
    case 'text': {
      // One word, or a quoted phrase kept together ('AC/DC' -> 'ac dc' matches as a phrase too).
      const phrase = matchKey(node.v);
      return (f) => !phrase || f.text.includes(phrase);
    }
    case 'term': return buildTerm(node, db, nowMs);
    default: return () => true;
  }
}

// field:a,b compiles into an OR of single-value terms (recursion with op ':'), so every type gets list support free.
function buildTerm(term, db, nowMs) {
  const def = FIELDS[term.field];
  const values = term.op === 'any' ? term.list : null;
  if (values) {
    const ps = values.map((v) => buildTerm({ ...term, op: ':', value: v, list: undefined }, db, nowMs));
    return (f, w) => ps.some((p) => p(f, w));
  }
  if (!def) {
    // A tag namespace: genre:rock -> the tag 'genre:rock' (descendants included through the effective set).
    const ns = term.field;
    const val = term.op === 'range' ? `${term.lo}..${term.hi}` : String(term.value ?? '');
    if (val === '' || val === '*') return (f) => [...f.tags].some((t) => t.startsWith(ns + ':'));
    if (val.includes('*')) {
      const m = textMatcher({ value: val, op: ':' });
      return (f) => [...f.tags].some((t) => t.startsWith(ns + ':') && m(t.slice(ns.length + 1)));
    }
    const key = tagKey(ns + ':' + val);
    return term.op === '!=' ? (f) => !f.tags.has(key) : (f) => f.tags.has(key);
  }
  switch (def.type) {
    case 'text': {
      const m = textMatcher(term);
      const neg = term.op === '!=';
      return (f, w) => { const r = (def.get(f, w) || []).some((s) => m(s)); return neg ? !r : r; };
    }
    case 'enum': {
      let v = String(term.value ?? '').toLowerCase();
      // kind:anime / kind:music etc. are domains, not kinds; redirected so users need not know the distinction.
      // movie / musicvideo / podcast are both a kind and a domain and stay kind matches.
      if (term.field === 'kind') {
        v = KIND_ALIASES[v] || v;
        if (DOMAIN_KINDS.has(v) && !['movie', 'musicvideo', 'podcast'].includes(v)) return (f) => f.domain === v;
      }
      if (term.field === 'status') v = STATUS_ALIASES[v] || v;
      if (term.field === 'domain' && v === 'tv') v = 'series';
      const neg = term.op === '!=';
      if (v.includes('*')) { const m = textMatcher({ value: v, op: ':' }); return (f, w) => m(def.get(f, w)) !== neg; }
      return (f, w) => (String(def.get(f, w) ?? '').toLowerCase() === v) !== neg;
    }
    case 'number': case 'duration': case 'size': {
      if (term.op === 'range') {
        const a = numberOf(def.type, term.lo, nowMs), b = numberOf(def.type, term.hi, nowMs);
        return (f, w) => cmpNum('range', def.get(f, w), a ?? null, b ?? null);
      }
      if (term.value === 'none' || term.value === '') return (f, w) => { const x = def.get(f, w); return (x === undefined || x === null || x === 0) !== (term.op === '!='); };
      const a = numberOf(def.type, term.value, nowMs);
      // energy:low, bpm:fast … are tags of the namespace of the same name; energy:>6 is the number.
      if (Number.isNaN(a)) {
        if (term.op === ':' || term.op === '=' || term.op === '!=') { const key = tagKey(term.field + ':' + term.value); return (f) => f.tags.has(key) !== (term.op === '!='); }
        return () => false;
      }
      return (f, w) => cmpNum(term.op, def.get(f, w), a);
    }
    case 'date': {
      // 0 / missing = "never" for every date field; a work with no date never matches a window or an age.
      const get = (f, w) => def.get(f, w) || 0;
      if (term.value === 'never') return (f, w) => (!get(f, w)) !== (term.op === '!=');
      if (term.op === 'range') {
        const a = term.lo ? parseDate(term.lo, nowMs) : null, b = term.hi ? parseDate(term.hi, nowMs) : null;
        const lo = a ? (a.age !== undefined ? nowMs - a.age : a.t) : -Infinity;
        const hi = b ? (b.age !== undefined ? nowMs - b.age : b.t + b.span) : Infinity;
        return (f, w) => { const x = get(f, w); return !!x && x >= Math.min(lo, hi) && x <= Math.max(lo, hi); };
      }
      const d = parseDate(term.value, nowMs);
      if (!d) return () => false;
      if (d.age !== undefined) {
        // ages: '<30d' = newer than 30 days, '>1y' = older than a year, ':30d' = within 30 days
        // (the operator compares the age, not the timestamp, hence the inverted x < cut for '>').
        // The `!x` branch returns false for every operator (the ternary is redundant), so played:>1y excludes
        // never-played works; use played:never for those.
        const cut = nowMs - d.age;
        return (f, w) => {
          const x = get(f, w);
          if (!x) return term.op === '>' || term.op === '>=' ? false : false;
          return term.op === '>' || term.op === '>=' ? x < cut : x >= cut;
        };
      }
      return (f, w) => {
        const x = get(f, w);
        if (!x) return term.op === '!=';
        switch (term.op) {
          case '>': return x >= d.t + d.span; case '>=': return x >= d.t; case '<': return x < d.t; case '<=': return x < d.t + d.span;
          case '!=': return x < d.t || x >= d.t + d.span; default: return x >= d.t && x < d.t + d.span;
        }
      };
    }
    case 'list': {
      const v = String(term.value ?? '').toLowerCase();
      const neg = term.op === '!=';
      // A two-letter language code also matches its regional variants (lang:pt finds 'pt-br').
      return (f, w) => (def.get(f, w) || []).some((x) => String(x).toLowerCase() === v || (v.length === 2 && String(x).toLowerCase().startsWith(v + '-'))) !== neg;
    }
    case 'tag': {
      const key = tagKey(term.value);
      const neg = term.op === '!=';
      if (key.endsWith('*')) { const p = key.slice(0, -1); return (f) => [...f.tags].some((t) => t.startsWith(p)) !== neg; }
      return (f) => f.tags.has(key) !== neg;
    }
    case 'set': {
      const v = String(term.value ?? '').toLowerCase();
      const neg = term.op === '!=';
      return (f) => f.has.has(v === 'lrc' ? 'synced' : v === 'subtitles' ? 'subs' : v) !== neg;
    }
    case 'is': {
      const p = isPredicate(term.value);
      return term.op === '!=' ? (f, w) => !p(f, w) : p;
    }
    // in:<playlist>: resolved by id, then by normalised name; the id set is memoised per catalogue version. A work
    // also matches when one of its ancestors is listed (a playlist containing an album contains its tracks).
    case 'in': {
      const v = String(term.value ?? '');
      const k = matchKey(v);
      const ids = db.memo('query:in:' + v, () => {
        const c = db.get(v) || db.all('collection').find((x) => matchKey(x.name) === k);
        return new Set(c && Array.isArray(c.items) ? c.items.map((i) => (typeof i === 'string' ? i : i.ref)) : []);
      });
      return (f, w) => {
        if (ids.has(w.id)) return true;
        let p = w.parent ? db.get(w.parent) : null;
        for (let g = 0; p && g < 6; g++) { if (ids.has(p.id)) return true; p = p.parent ? db.get(p.parent) : null; }
        return false;
      };
    }
    case 'source': {
      const v = String(term.value ?? '');
      const k = matchKey(v);
      const src = db.get(v) || db.all('source').find((x) => matchKey(x.name) === k);
      // Unknown source: a sentinel id no media can carry (ids are [A-Za-z0-9_.:-]), so the term matches nothing.
      const sid = src ? src.id : '\u0000';
      return (f, w) => db.mediaOf(w.id).some((m) => m.sourceId === sid);
    }
    default: return () => true;
  }
}

// --- run / sort --------------------------------------------------------------------------------------------------------

// Sort keys. Missing numbers map to -1 so they group at one end instead of making the comparator return NaN.
// Composite keys (track = disc * 1000 + track, episode = season * 100000 + episode) give one numeric compare for a
// two-level order; they assume < 1000 tracks per disc and < 100000 episodes per season.
const SORT_GET = {
  title: (f) => f.sort, artist: (f) => (f.artist[0] || '').toLowerCase(), album: (f) => f.album.toLowerCase(), show: (f) => f.show.toLowerCase(),
  year: (f) => f.year ?? -1, added: (f) => f.added, played: (f) => f.lastPlayed, plays: (f) => f.plays, score: (f) => f.score ?? -1,
  rating: (f) => f.rating ?? -1, duration: (f) => f.duration, size: (f) => f.size, energy: (f) => f.energy ?? -1, bpm: (f) => f.bpm ?? -1,
  track: (f) => (f.disc || 1) * 1000 + (f.track || 0), episode: (f) => (f.season || 0) * 100000 + (f.episode ?? f.absolute ?? 0), updated: (f) => f.updated,
  presence: (f) => ({ file: 2, source: 1, nominal: 0 }[f.presence]), kind: (f) => f.kind, progress: (f) => f.progress,
};

// Same FNV-1a + mulberry32-style generator as smart.js seededShuffle (duplicated rather than imported to avoid a
// query <-> smart import cycle; smart.js already imports this module).
function seeded(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6D2B79F5) | 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function sortWorks(db, works, sort, { seed = 'q' } = {}) {
  let spec = sort;
  if (!spec) return works;
  if (typeof spec === 'string') spec = spec.split(/[\s,]+/).filter(Boolean).map((s) => ({ field: s.replace(/^[-+]/, ''), dir: s.startsWith('-') ? -1 : 1 }));
  if (spec.some((s) => s.field === 'random')) {
    const rnd = seeded(seed);
    const out = works.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  // Decorate-sort-undecorate: facts looked up once per work, not twice per comparison. Numbers compare numerically,
  // everything else with the natural collator; sortKey is the final tie-break so the order is total and stable
  // across runs.
  const keyed = works.map((w) => ({ w, f: facts(db, w) }));
  keyed.sort((x, y) => {
    for (const { field, dir } of spec) {
      const g = SORT_GET[field] || ((f) => f[field]);
      const a = g(x.f), b = g(y.f);
      const c = typeof a === 'number' && typeof b === 'number' ? a - b : naturalCompare(a, b);
      if (c) return c * (dir || 1);
    }
    return naturalCompare(x.f.sort, y.f.sort);
  });
  return keyed.map((k) => k.w);
}

// Cheap filters (kind, domain) run before the compiled predicate. Note: `sort: null` still sorts by title
// (sort || 'title'); callers that re-sort afterwards (smart.js) pay an extra sort.
export function runQuery(db, text, { kinds = null, domains = null, sort = null, limit = 0, now: nowMs = Date.now(), seed } = {}) {
  const pred = compileQuery(text, db, { now: nowMs });
  const ks = kinds ? new Set(kinds) : null;
  const ds = domains ? new Set(domains) : null;
  let out = db.all('work').filter((w) => (!ks || ks.has(w.kind)) && (!ds || ds.has(facts(db, w).domain)) && pred(w));
  out = sortWorks(db, out, sort || 'title', { seed });
  return limit > 0 ? out.slice(0, limit) : out;
}

// Human-readable rendering of the parsed AST (shown under the search box), so users see how a lenient parse read
// their query. Parentheses are re-inserted only where precedence requires them.
export function explain(ast) {
  switch (ast.t) {
    case 'all': return 'everything';
    case 'and': return ast.a.map((x) => (x.t === 'or' ? `(${explain(x)})` : explain(x))).join(' AND ');
    case 'or': return ast.a.map(explain).join(' OR ');
    case 'not': return 'NOT ' + (ast.a.t === 'and' || ast.a.t === 'or' ? `(${explain(ast.a)})` : explain(ast.a));
    case 'text': return JSON.stringify(ast.v);
    case 'term': {
      const v = ast.op === 'range' ? `${ast.lo || '…'}..${ast.hi || '…'}` : ast.op === 'any' ? ast.list.join(' | ') : ast.value;
      return `${ast.field} ${ast.op === ':' ? 'has' : ast.op === 'any' ? 'in' : ast.op} ${v}`;
    }
    default: return '?';
  }
}
