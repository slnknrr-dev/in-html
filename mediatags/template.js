// mediatags/template.js - path templates that both match library paths and build them.
//
//   compileTemplate(tpl) -> { source, fields: [names], anchored, regex, match(relPath) -> { field: value } | null,
//                             format(values) -> relPath }
//   Syntax:
//     {name}        a field: one or more characters, never '/', matched lazily (the leftmost separator wins)
//     {name:02}     zero-padded number on format; digits only on match
//     numeric fields: track, disc, season, episode, absolute, year (4 digits), part, chapter, volume, seriesPart,
//                   trackTotal, discTotal, index - matched as digits (episode, absolute, part, chapter, volume,
//                   seriesPart also as decimals like 12.5) and returned as numbers
//     {ext}         the extension: no '/' or '.'
//     {name?}       optional: the field and the separator text next to it (spaces and - _ . , ; on the side away
//                   from the template's literal text: ' - ' in '{album?} - {title}') may both be absent; on format a
//                   missing optional field drops that separator too
//     {_} {ignore}  matches like a field and is discarded (format writes nothing)
//     *             any characters within one segment            **   any number of whole segments ('**/' in a path)
//     {{ }}         literal braces
//   A template matches the END of a relative path at a segment boundary ('{artist}/{album}/{track:02} {title}.{ext}'
//   works under any prefix); a leading '/' anchors it at the root of the paths. Literal text matches case-
//   insensitively. A field used twice must have equal values (numbers compared as numbers). Values are trimmed.
//   format() replaces '/' and '\' in values with '-' and characters Windows forbids (< > : " | ? *) with '_'; a
//   missing required field throws.
//   safeSegment(s) -> the value as format() writes it

// Design rules:
// - One token list drives both directions (match and format), so a template can never parse a path it could not
//   rebuild. Two hand-written implementations would drift on edge cases (optional separators, padding).
// - Compile to ONE RegExp anchored at '$': the engine's backtracking does the search; a hand-rolled matcher would have
//   to reimplement lazy/greedy interplay. Fields are lazy '[^/]+?' so the leftmost literal separator splits
//   'A - B - C' at the first ' - ' (predictable for users; greedy would split at the last).
// - '/' is never inside a field: segment structure is the one invariant every library layout shares.
// NUMERIC: values returned as numbers and compared numerically ('01' equals '1' on a repeated field).
// DECIMAL: fractional episodes/parts (12.5 specials); a padded field ({episode:02}) stays integer-only on match.
const NUMERIC = new Set(['track', 'disc', 'season', 'episode', 'absolute', 'year', 'part', 'chapter', 'volume', 'seriesPart', 'trackTotal', 'discTotal', 'index']);
const DECIMAL = new Set(['episode', 'absolute', 'part', 'chapter', 'volume', 'seriesPart']);
// Escapes every RegExp metacharacter so literal template text cannot inject pattern syntax.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Value -> one safe path segment: path separators become '-' (a value must not create directories), Windows-reserved
// characters become '_' (portable across filesystems), C0 control characters are dropped. Reserved device names
// (CON, NUL, ...) and trailing dots/spaces, which Windows also rejects, are NOT handled here.
export const safeSegment = (v) => String(v).replace(/[\\/]/g, '-').replace(/[<>:"|?*]/g, '_').replace(/[\u0000-\u001f]/g, '').trim();

// Single left-to-right scan; '{{' and '}}' are checked before '{' so escapes win. The field body grammar accepts '?'
// before or after ':pad' ({n?:02} and {n:02?}); anything else throws at compile time (fail fast: a typo must not
// silently become a literal that never matches).
// Template text -> tokens: { lit } | { field, pad, optional, ignore } | { star } | { globstar }
function tokenize(tpl) {
  const out = [];
  let lit = '';
  const flush = () => { if (lit) { out.push({ lit }); lit = ''; } };
  for (let i = 0; i < tpl.length;) {
    const c = tpl[i];
    if (c === '{' && tpl[i + 1] === '{') { lit += '{'; i += 2; continue; }
    if (c === '}' && tpl[i + 1] === '}') { lit += '}'; i += 2; continue; }
    if (c === '{') {
      const e = tpl.indexOf('}', i);
      if (e < 0) throw new Error(`template: unclosed { at ${i}`);
      const body = tpl.slice(i + 1, e).trim();
      const m = /^([A-Za-z_][\w]*)(\?)?(?::(0*\d+))?(\?)?$/.exec(body);
      if (!m) throw new Error(`template: bad field {${body}}`);
      flush();
      const name = m[1];
      out.push({ field: name, pad: m[3] ? +m[3] : 0, optional: !!(m[2] || m[4]), ignore: name === '_' || name === 'ignore' });
      i = e + 1;
      continue;
    }
    if (c === '*') {
      flush();
      if (tpl[i + 1] === '*') { out.push({ globstar: true, slash: tpl[i + 2] === '/' }); i += tpl[i + 2] === '/' ? 3 : 2; }
      else { out.push({ star: true }); i++; }
      continue;
    }
    lit += c;
    i++;
  }
  flush();
  return out;
}

// Separator characters an optional field may own: whitespace, - _ . , ; and en/em dashes (common in titles).
const SEP = /[\s\-_.,;–—]+/;

// Splits the optional field's separator out of the neighbouring literals: { before, sep, after } per side.
function sepSplit(text, side) {
  if (side === 'prefix') { const m = new RegExp(`(${SEP.source})$`).exec(text); return m ? [text.slice(0, m.index), m[1]] : [text, '']; }
  const m = new RegExp(`^(${SEP.source})`).exec(text);
  return m ? [m[1], text.slice(m[1].length)] : ['', text];
}

/** Compiles a path template (see the header). */
export function compileTemplate(tpl) {
  const source = String(tpl);
  const anchored = source.startsWith('/');
  const tokens = tokenize(anchored ? source.slice(1) : source);
  // An optional field absorbs the separator next to it, so '{album?} - {title}' matches 'Title' alone and format()
  // writes no dangling ' - '. Following literal preferred: a leading optional field has no preceding literal.
  // attach separators to optional fields: prefer the literal that follows, else the one before
  const parts = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.field && t.optional) {
      const next = tokens[i + 1], prev = parts[parts.length - 1];
      if (next && next.lit != null) {
        const [sep, rest] = sepSplit(next.lit, 'suffix');
        if (sep && rest !== undefined) { parts.push({ ...t, sepAfter: sep }); tokens[i + 1] = { lit: rest }; continue; }
      }
      if (prev && prev.lit != null) {
        const [rest, sep] = sepSplit(prev.lit, 'prefix');
        if (sep) { prev.lit = rest; parts.push({ ...t, sepBefore: sep }); continue; }
      }
    }
    parts.push(t);
  }
  const fields = [];
  const groups = []; // group index -> field name
  // Unanchored: '(?:^|/)' forces a segment boundary, so 'Album' never matches inside 'MyAlbum'.
  let rx = anchored ? '^' : '(?:^|/)';
  const fieldRe = (t) => {
    if (t.field === 'ext') return '[^/.]+';
    if (t.field === 'year') return '\\d{4}';
    if (NUMERIC.has(t.field)) return DECIMAL.has(t.field) && !t.pad ? '\\d+(?:\\.\\d+)?' : '\\d+';
    return '[^/]+?';
  };
  for (const t of parts) {
    if (t.lit != null) { rx += escRe(t.lit); continue; }
    if (t.star) { rx += '[^/]*'; continue; }
    if (t.globstar) { rx += t.slash ? '(?:[^/]+/)*' : '.*'; continue; }
    let g;
    if (t.ignore) g = `(?:${fieldRe(t)})`;
    else {
      if (!fields.includes(t.field)) fields.push(t.field);
      groups.push(t.field);
      g = `(${fieldRe(t)})`;
    }
    if (t.optional) {
      const before = t.sepBefore ? escRe(t.sepBefore) : '', after = t.sepAfter ? escRe(t.sepAfter) : '';
      rx += `(?:${before}${g}${after})?`;
    } else rx += g;
  }
  rx += '$';
  // 'i': literal text is case-insensitive (case-insensitive filesystems, inconsistent user naming).
  const regex = new RegExp(rx, 'i');
  // Normalizes Windows separators and a leading './' or '/' before matching. A repeated field must agree
  // (case-insensitive for text), else the whole match is rejected rather than silently keeping the first value.
  function match(relPath) {
    const p = String(relPath || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
    const m = regex.exec(p);
    if (!m) return null;
    const out = {};
    for (let i = 0; i < groups.length; i++) {
      const raw = m[i + 1];
      if (raw == null) continue;
      const name = groups[i];
      const v = NUMERIC.has(name) ? Number(raw) : raw.trim();
      if (name in out) {
        const same = typeof v === 'number' ? out[name] === v : String(out[name]).toLowerCase() === String(v).toLowerCase();
        if (!same) return null;
      } else out[name] = v;
    }
    return out;
  }
  // Inverse of match: star, globstar and ignore write nothing (no information to restore). Padding keeps a fractional
  // tail (2.5 with :02 -> '02.5'). Values pass through safeSegment, literals do not (the template author owns the
  // literal '/'); collapsing repeated slashes covers an empty optional segment.
  function format(values = {}) {
    let s = '';
    for (const t of parts) {
      if (t.lit != null) { s += t.lit; continue; }
      if (t.star || t.ignore) continue;
      if (t.globstar) continue;
      const v = values[t.field];
      const missing = v == null || v === '';
      if (missing) { if (t.optional) continue; throw new Error(`template: missing value for {${t.field}}`); }
      let txt = typeof v === 'number' && t.pad ? String(Math.trunc(v)).padStart(t.pad, '0') + (Number.isInteger(v) ? '' : String(v).replace(/^\d+/, '')) : String(v);
      if (t.pad && typeof v !== 'number' && /^\d+$/.test(txt)) txt = txt.padStart(t.pad, '0');
      s += (t.sepBefore || '') + safeSegment(txt) + (t.sepAfter || '');
    }
    return s.replace(/\/{2,}/g, '/');
  }
  return { source, fields, anchored, regex, match, format };
}
