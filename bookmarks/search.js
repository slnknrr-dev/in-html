// bookmarks/search.js - the search language of the bookmark list, ranked matching, suggestions and tag cloud data.
//
//   words              every word must occur (title, tags, host, URL, notes, folder); case and accents ignored
//   "a phrase"         the exact sequence
//   -word  -"phrase"   must not occur (any term can be negated: -tag:x, -is:unread, -site:example.com)
//   tag:x  #x  tag:"two words"     tagged x (case-insensitive);  tag:x* any tag starting with x
//   site:example.com   the host or one of its subdomains
//   folder:Dev/JS      folders with that path of names (anywhere in their path) and their subfolders, case-insensitive;
//                      folder:/ = not in a folder
//   is:unread / is:read / is:fav / is:public / is:private / is:archived / is:untagged / is:tagged / has:notes / has:icon
//   before:2024-05  after:2023  after:7d  before:yesterday    created before / on-or-after the start of that period
//                                                            (YYYY, YYYY-MM, YYYY-MM-DD, today, yesterday, Nd Nw Nm Ny)
//   title:x  url:x  notes:x       the word in that field only
//
//   parseQuery(text) -> { terms: [{ op, value, neg }], text }       ops: word, phrase, tag, site, folder, is, has,
//                                                                     before, after, title, url, notes
//   compileQuery(text | parsed, { now }) -> (item, ctx) -> score | 0   ctx: { path(item) -> 'A/B', host(item) }
//   searchItems(items, text, { path, host, now }) -> [{ item, score }] best first (no free text: input order)
//   suggest(text, caret, { tags, hosts, folders }) -> { from, to, items: [{ insert, label, kind, count }] }
//   tagCloud(items, { max }) -> [{ tag, count, weight 1..5 }]   (alphabetical)
//   fold(text) -> lower case without accents (search key)

// Search key: NFKD splits accented letters into base + combining mark, marks are removed (é -> e, also full-width
// and ligature forms via compatibility decomposition), then lower case; ё/е and ß/ss are folded explicitly because
// users type them interchangeably. Both the query and the items are folded, so matching is a plain includes().
export function fold(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss');
}

const OPS = ['tag', 'site', 'folder', 'is', 'has', 'before', 'after', 'title', 'url', 'notes'];
export const IS_VALUES = ['unread', 'read', 'fav', 'public', 'private', 'archived', 'untagged', 'tagged'];
export const HAS_VALUES = ['notes', 'icon', 'tags'];

// Tokens: optional '-', optional 'op:', then a quoted string or a run of non-space characters.
// One sticky regex per token at the current position. An unclosed quote runs to the end ("abc without the closing
// quote still searches the phrase), so typing never produces a parse error. Unknown "op:" prefixes (c++:, http:)
// are treated as plain words, not errors.
const TOKEN = /(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/giy;

export function parseQuery(text) {
  const src = String(text ?? '');
  const terms = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) { i++; continue; }
    const start = i;
    i = TOKEN.lastIndex;
    let [, neg, op, quoted, bare] = m;
    op = op ? op.toLowerCase() : '';
    if (op === 'is' && quoted === undefined && /^(favou?rite|starred)$/i.test(bare || '')) bare = 'fav';
    if (op && !OPS.includes(op)) {
      // Not an operator ("c++:", "http://…"): the whole token is a word.
      const raw = src.slice(start + neg.length, i);
      terms.push({ op: 'word', value: raw, neg: !!neg });
      continue;
    }
    if (!op && bare && bare.startsWith('#') && bare.length > 1) { terms.push({ op: 'tag', value: bare.slice(1), neg: !!neg }); continue; }
    if (!op && neg && !quoted && !bare) continue;
    const value = quoted !== undefined ? quoted : bare || '';
    if (!op) {
      if (!value) continue;
      terms.push({ op: quoted !== undefined ? 'phrase' : 'word', value, neg: !!neg });
    } else terms.push({ op, value, neg: !!neg });
  }
  return { terms, text: src };
}

// Start of a period named by a date term (local time) or null: { start, end }.
// Periods in LOCAL time (new Date(y, m, d)): "2024-05" means May as the user's calendar shows it. Date components
// are not range-checked beyond month/day bounds; Date normalizes 2024-02-31 into March, accepted leniency.
// Relative terms (7d, 2w) are a point in time (start === end): "after:7d" = created within the last 7 days.
export function parseDateTerm(s, now = Date.now()) {
  const v = String(s || '').trim().toLowerCase();
  let m;
  if ((m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/.exec(v))) {
    const y = +m[1], mo = m[2] ? +m[2] - 1 : 0, d = m[3] ? +m[3] : 1;
    if (mo > 11 || d < 1 || d > 31) return null;
    const start = new Date(y, mo, d).getTime();
    const end = m[3] ? new Date(y, mo, d + 1).getTime() : m[2] ? new Date(y, mo + 1, 1).getTime() : new Date(y + 1, 0, 1).getTime();
    return { start, end };
  }
  const today = new Date(now);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (v === 'today') return { start: t0, end: t0 + 864e5 };
  if (v === 'yesterday') { const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime(); return { start: y, end: t0 }; }
  if ((m = /^(\d{1,4})([dwmy])$/.exec(v))) {
    const n = +m[1];
    const d = new Date(now);
    if (m[2] === 'd') d.setDate(d.getDate() - n);
    else if (m[2] === 'w') d.setDate(d.getDate() - 7 * n);
    else if (m[2] === 'm') d.setMonth(d.getMonth() - n);
    else d.setFullYear(d.getFullYear() - n);
    return { start: d.getTime(), end: d.getTime() };
  }
  return null;
}

// Folded search keys cached per view object in a WeakMap: views are replaced when a record changes (library.js),
// so the cache invalidates itself and is garbage-collected with old views.
const KEYS = new WeakMap();
function keysOf(item, ctx) {
  let k = KEYS.get(item);
  if (k) return k;
  const host = ctx.host ? ctx.host(item) : '';
  k = {
    title: fold(item.title), url: fold(item.url), host: fold(host), notes: fold(item.notes),
    tags: (item.tags || []).map(fold), path: fold(ctx.path ? ctx.path(item) : ''),
  };
  KEYS.set(item, k);
  return k;
}

const wordStart = (hay, needle) => {
  let i = hay.indexOf(needle);
  while (i >= 0) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1])) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
};

// Score of a free-text term in an item (0 = absent).
// Field weights for ranking: title (more at a word start) > exact tag > host > partial tag > URL > notes > folder
// path. Simple additive scoring, cheap enough to run on every keystroke over thousands of bookmarks.
function textScore(k, needle) {
  let s = 0;
  if (k.title.includes(needle)) s += wordStart(k.title, needle) ? 6 : 3;
  if (k.tags.some((t) => t === needle)) s += 5;
  else if (k.tags.some((t) => t.includes(needle))) s += 2;
  if (k.host.includes(needle)) s += 3;
  else if (k.url.includes(needle)) s += 1.5;
  if (k.notes.includes(needle)) s += 1;
  if (k.path.includes(needle)) s += 0.5;
  return s;
}

// site:example.com matches the host and any subdomain (suffix after a dot), never "notexample.com".
function hostMatches(host, site) {
  const h = fold(host).replace(/^www\./, '');
  const s = fold(site).replace(/^(?:https?:\/\/)?(?:www\.)?/, '').replace(/\/.*$/, '');
  return !!s && (h === s || h.endsWith('.' + s));
}

export function compileQuery(q, { now = Date.now() } = {}) {
  const parsed = typeof q === 'string' ? parseQuery(q) : q;
  const preds = [];
  for (const t of parsed.terms) {
    const v = fold(t.value);
    let p = null;
    switch (t.op) {
      case 'word': case 'phrase': {
        if (!v) break;
        p = (it, k) => textScore(k, v);
        break;
      }
      case 'tag': {
        if (!v) { p = (it) => (it.tags && it.tags.length ? 1 : 0); break; }
        const prefix = v.endsWith('*') ? v.slice(0, -1) : null;
        p = prefix !== null ? (it, k) => (k.tags.some((x) => x.startsWith(prefix)) ? 1 : 0) : (it, k) => (k.tags.includes(v) ? 1 : 0);
        break;
      }
      case 'site': p = (it, k, ctx) => (hostMatches(ctx.host ? ctx.host(it) : '', t.value) ? 1 : 0); break;
      case 'folder': {
        const path = v.replace(/^\/+|\/+$/g, '');
        // A path of whole folder names anywhere in the folder's path ("Dev" finds "Imported/Dev/JS" too).
        p = path ? (it, k) => (('/' + k.path + '/').includes('/' + path + '/') ? 1 : 0) : (it, k) => (k.path === '' ? 1 : 0);
        break;
      }
      case 'is': {
        const f = {
          unread: (it) => it.unread, read: (it) => !it.unread, fav: (it) => it.fav, public: (it) => it.public,
          private: (it) => !it.public, archived: (it) => it.archived, untagged: (it) => !(it.tags && it.tags.length),
          tagged: (it) => !!(it.tags && it.tags.length),
        }[v];
        p = f ? (it) => (f(it) ? 1 : 0) : () => 0;
        break;
      }
      case 'has': {
        const f = { notes: (it) => !!(it.notes && it.notes.trim()), icon: (it) => !!it.icon, tags: (it) => !!(it.tags && it.tags.length) }[v];
        p = f ? (it) => (f(it) ? 1 : 0) : () => 0;
        break;
      }
      case 'before': case 'after': {
        const d = parseDateTerm(t.value, now);
        if (!d) { p = () => 0; break; }
        p = t.op === 'before' ? (it) => (it.created && it.created < d.start ? 1 : 0) : (it) => (it.created >= d.start ? 1 : 0);
        break;
      }
      case 'title': p = v ? (it, k) => (k.title.includes(v) ? 4 : 0) : null; break;
      case 'url': p = v ? (it, k) => (k.url.includes(v) || k.host.includes(v) ? 2 : 0) : null; break;
      case 'notes': p = v ? (it, k) => (k.notes.includes(v) ? 1 : 0) : null; break;
      default: break;
    }
    if (p) preds.push({ p, neg: t.neg, text: t.op === 'word' || t.op === 'phrase' || t.op === 'title' });
  }
  const fn = (item, ctx = {}) => {
    const k = keysOf(item, ctx);
    let score = 0;
    for (const { p, neg } of preds) {
      const s = p(item, k, ctx);
      if (neg ? s > 0 : s <= 0) return 0;
      if (!neg) score += s;
    }
    return score || 1;
  };
  fn.ranked = preds.some((x) => x.text && !x.neg);
  fn.empty = preds.length === 0;
  return fn;
}

export function searchItems(items, text, { path, host, now } = {}) {
  const fn = compileQuery(text, { now });
  const ctx = { path, host };
  const out = [];
  for (const item of items) {
    const score = fn(item, ctx);
    if (score > 0) out.push({ item, score });
  }
  if (fn.ranked) {
    out.sort((a, b) => b.score - a.score || (b.item.created || 0) - (a.item.created || 0));
  }
  return out;
}

// Completion of the token under the caret.
export function suggest(text, caret = String(text ?? '').length, { tags = [], hosts = [], folders = [], limit = 8 } = {}) {
  const src = String(text ?? '');
  let from = caret;
  while (from > 0 && !/\s/.test(src[from - 1])) from--;
  let to = caret;
  while (to < src.length && !/\s/.test(src[to])) to++;
  const token = src.slice(from, caret);
  const neg = token.startsWith('-') ? '-' : '';
  const body = token.slice(neg.length);
  const items = [];
  const quote = (s) => (/\s/.test(s) ? `"${s}"` : s);
  const add = (insert, label, kind, count) => { if (items.length < limit) items.push({ insert: neg + insert, label, kind, count }); };
  let m;
  if ((m = /^(tag:|#)(.*)$/i.exec(body))) {
    const pre = fold(m[2].replace(/^"/, ''));
    const list = tags.filter((x) => fold(x.tag).startsWith(pre)).concat(tags.filter((x) => !fold(x.tag).startsWith(pre) && fold(x.tag).includes(pre)));
    for (const x of list) add((m[1] === '#' && !/\s/.test(x.tag) ? '#' : 'tag:') + quote(x.tag), x.tag, 'tag', x.count);
  } else if ((m = /^site:(.*)$/i.exec(body))) {
    const pre = fold(m[1]);
    for (const x of hosts.filter((h) => fold(h.host).includes(pre))) add('site:' + x.host, x.host, 'site', x.count);
  } else if ((m = /^folder:(.*)$/i.exec(body))) {
    const pre = fold(m[1].replace(/^"/, ''));
    for (const x of folders.filter((f) => fold(f.path).includes(pre))) add('folder:' + quote(x.path), x.path, 'folder', x.count);
  } else if ((m = /^is:(.*)$/i.exec(body))) {
    for (const v of IS_VALUES.filter((x) => x.startsWith(m[1].toLowerCase()))) add('is:' + v, 'is:' + v, 'is');
  } else if ((m = /^has:(.*)$/i.exec(body))) {
    for (const v of HAS_VALUES.filter((x) => x.startsWith(m[1].toLowerCase()))) add('has:' + v, 'has:' + v, 'has');
  } else if ((m = /^(before|after):(.*)$/i.exec(body))) {
    for (const v of ['today', 'yesterday', '7d', '30d', '1y']) if (v.startsWith(m[2].toLowerCase())) add(`${m[1].toLowerCase()}:${v}`, `${m[1].toLowerCase()}:${v}`, 'date');
  } else if (body && /^[a-z]+$/i.test(body)) {
    for (const op of OPS) if (op.startsWith(body.toLowerCase()) && op !== body.toLowerCase()) add(op + ':', op + ':', 'op');
    const pre = fold(body);
    for (const x of tags) if (fold(x.tag).startsWith(pre)) add('tag:' + quote(x.tag), x.tag, 'tag', x.count);
  }
  return { from, to, items };
}

export function tagCloud(items, { max = 200 } = {}) {
  const counts = new Map();
  for (const it of items) {
    for (const t of it.tags || []) {
      const k = t.toLowerCase();
      const e = counts.get(k);
      if (e) e.count++; else counts.set(k, { tag: t, count: 1 });
    }
  }
  const list = [...counts.values()].sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1)).slice(0, max);
  if (!list.length) return [];
  const hi = Math.log(list[0].count + 1), lo = Math.log(list[list.length - 1].count + 1);
  for (const x of list) x.weight = hi === lo ? 3 : 1 + Math.round(4 * (Math.log(x.count + 1) - lo) / (hi - lo));
  return list.sort((a, b) => a.tag.localeCompare(b.tag));
}
