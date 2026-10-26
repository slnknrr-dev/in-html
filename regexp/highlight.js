// regexp/highlight.js - tolerant tokenizer of a pattern into highlight spans (syntax colouring, bracket pairs).
//
// tokenize(source, flags) works on any text, valid or not, so an editor can colour a pattern while it is typed:
//   { spans: [{ start, end, type, depth?, group? }], pairs: [[open, close], ...], groups }
// Span types: lit (literal), esc (character escape), set (\d, ., \p{…}), cls (class brackets), clsch (class member),
// range (the '-' of a range), op (&&, --), grp (group parens), name (<name>), look (lookaround parens), mod (modifiers),
// quant (quantifier), alt (|), anchor (^ $ \b \B), ref (back-reference), err (cannot be valid here).
// `depth` is the group nesting level of grp / look / name spans; `group` is the capture number of grp / name spans
// and of references.
//
// Why a separate tokenizer instead of the parser's AST: parse.js stops at the first error, an editor must keep
// colouring the rest of the line. This scanner never throws; it marks a token 'err' and moves on. It shares the
// parser's mode rules (u / v, Annex B named-group switch) but approximates the finer checks, which the parser reports.

const isDigit = (c) => c >= '0' && c <= '9';
const isHex = (c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');

export function tokenize(source, flags = '') {
  const src = String(source), n = src.length;
  const u = /[uv]/.test(flags), v = String(flags).includes('v');
  const spans = [], pairs = [], stack = [];
  // Capture numbers and names first (references may point forward). Pre-pass skips escapes and class contents, where
  // '(' is literal; with v, classes nest, hence a counter instead of a boolean.
  const names = new Map();
  let total = 0;
  for (let i = 0, cls = 0; i < n; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (cls) { if (c === '[' && v) cls++; else if (c === ']') cls--; continue; }
    if (c === '[') { cls = 1; continue; }
    if (c !== '(') continue;
    if (src[i + 1] !== '?') total++;
    else if (src[i + 2] === '<' && src[i + 3] !== '=' && src[i + 3] !== '!') {
      total++;
      const m = /^<([^>]*)>/.exec(src.slice(i + 2));
      if (m && !names.has(m[1])) names.set(m[1], total);
    }
  }
  // Annex B: \k is a named reference only with u / v or when the pattern defines a named group.
  const named = u || names.size > 0;
  let pos = 0, depth = 0, cap = 0;

  // Adjacent lit / clsch spans are merged so a long literal costs one DOM element, not one per character. Spans with
  // attributes (depth, group) are never merged: those attributes are per token.
  const push = (type, start, end, extra) => {
    if (end <= start) return;
    const last = spans[spans.length - 1];
    if (!extra && last && last.type === type && last.end === start && (type === 'lit' || type === 'clsch')) { last.end = end; return; }
    spans.push(extra ? { start, end, type, ...extra } : { start, end, type });
  };

  // An escape at i (outside or inside a class) → end offset; pushes its span.
  function escape(i, inClass) {
    const c = src[i + 1];
    if (c === undefined) { push('err', i, i + 1); return i + 1; }
    if ('dDsSwW'.includes(c)) { push('set', i, i + 2); return i + 2; }
    if ((c === 'p' || c === 'P') && u) {
      const close = src[i + 2] === '{' ? src.indexOf('}', i + 3) : -1;
      const end = close < 0 ? i + 2 : close + 1;
      push(close < 0 ? 'err' : 'set', i, end);
      return end;
    }
    if ((c === 'b' || c === 'B') && !inClass) { push('anchor', i, i + 2); return i + 2; }
    if (c >= '1' && c <= '9' && !inClass) {
      let j = i + 1;
      while (isDigit(src[j])) j++;
      const num = +src.slice(i + 1, j);
      if (u || num <= total) { push(num <= total ? 'ref' : 'err', i, j, { group: num }); return j; }
    }
    if (c === 'k' && named && !inClass) {
      const m = /^<([^>]*)>/.exec(src.slice(i + 2));
      if (m) { const g = names.get(m[1]); push(g ? 'ref' : 'err', i, i + 2 + m[0].length, { group: g || 0 }); return i + 2 + m[0].length; }
      push('err', i, i + 2);
      return i + 2;
    }
    if (c === 'q' && v && inClass && src[i + 2] === '{') {
      const close = src.indexOf('}', i + 3);
      const end = close < 0 ? n : close + 1;
      push('set', i, end);
      return end;
    }
    if (c === 'x' && isHex(src[i + 2]) && isHex(src[i + 3])) { push('esc', i, i + 4); return i + 4; }
    if (c === 'u') {
      if (u && src[i + 2] === '{') {
        const m = /^\{[0-9a-fA-F]+\}/.exec(src.slice(i + 2));
        if (m) { push('esc', i, i + 2 + m[0].length); return i + 2 + m[0].length; }
      }
      if (isHex(src[i + 2]) && isHex(src[i + 3]) && isHex(src[i + 4]) && isHex(src[i + 5])) { push('esc', i, i + 6); return i + 6; }
      push(u ? 'err' : 'esc', i, i + 2);
      return i + 2;
    }
    if (c === 'c' && /[A-Za-z]/.test(src[i + 2] || '')) { push('esc', i, i + 3); return i + 3; }
    if (c === '0' && !isDigit(src[i + 2])) { push('esc', i, i + 2); return i + 2; }
    if (isDigit(c) && !u) {
      let j = i + 2;
      while (j < i + 4 && src[j] >= '0' && src[j] <= '7') j++;
      push('esc', i, j);
      return j;
    }
    const cp = src.codePointAt(i + 1);
    const end = i + 1 + (u && cp > 0xffff ? 2 : 1);
    // u / v mode allows only the identity escapes of the spec (syntax characters, '/', '-' in a class, v-mode class
    // punctuators); without u any identity escape is legal Annex B.
    const ok = !u || '^$\\.*+?()[]{}|/'.includes(c) || 'fnrtv'.includes(c) || (inClass && (c === '-' || c === 'b' || (v && '&-!#%,:;<=>@`~'.includes(c))));
    push(ok ? 'esc' : 'err', i, end);
    return end;
  }

  // A class starting at i → end offset.
  function klass(i) {
    const open = i;
    const neg = src[i + 1] === '^';
    push('cls', i, i + (neg ? 2 : 1), { depth });
    i += neg ? 2 : 1;
    let first = true;
    while (i < n) {
      const c = src[i];
      if (c === ']') {
        push('cls', i, i + 1, { depth });
        pairs.push([open, i]);
        return i + 1;
      }
      if (c === '[' && v) { i = klass(i); first = false; continue; }
      if (c === '\\') { i = escape(i, true); first = false; continue; }
      if (v && (src.startsWith('&&', i) || src.startsWith('--', i))) { push('op', i, i + 2); i += 2; continue; }
      // '-' is a range only between two members; leading or trailing '-' stays a member.
      if (c === '-' && !first && src[i + 1] !== ']' && i + 1 < n) { push('range', i, i + 1); i++; continue; }
      const cp = src.codePointAt(i);
      const w = cp > 0xffff ? 2 : 1;
      push(v && '()[]{}/|'.includes(c) ? 'err' : 'clsch', i, i + w);
      i += w;
      first = false;
    }
    // Unterminated class: flag the opening bracket, the rest of the source is already coloured as members.
    spans.push({ start: open, end: open + 1, type: 'err' });
    return n;
  }

  while (pos < n) {
    const c = src[pos];
    if (c === '\\') { pos = escape(pos, false); continue; }
    if (c === '[') { pos = klass(pos); continue; }
    if (c === '(') {
      let end = pos + 1, type = 'grp', group = 0;
      if (src[pos + 1] === '?') {
        const k = src[pos + 2];
        if (k === ':') end = pos + 3;
        else if (k === '=' || k === '!') { end = pos + 3; type = 'look'; }
        else if (k === '<' && (src[pos + 3] === '=' || src[pos + 3] === '!')) { end = pos + 4; type = 'look'; }
        else if (k === '<') {
          group = ++cap;
          push('grp', pos, pos + 2, { depth, group });
          const close = src.indexOf('>', pos + 3);
          const ne = close < 0 ? pos + 3 : close + 1;
          push('name', pos + 2, ne, { depth, group });
          stack.push({ start: pos, type: 'grp', depth, group });
          depth++;
          pos = ne;
          continue;
        } else if (/[ims-]/.test(k || '')) {
          const m = /^[ims]*(?:-[ims]*)?:/.exec(src.slice(pos + 2));
          push('grp', pos, pos + 2, { depth });
          if (m) push('mod', pos + 2, pos + 2 + m[0].length);
          else push('err', pos + 2, pos + 3);
          stack.push({ start: pos, type: 'grp', depth, group: 0 });
          depth++;
          pos = m ? pos + 2 + m[0].length : pos + 3;
          continue;
        } else { push('err', pos, pos + 2); pos += 2; continue; }
      } else group = ++cap;
      push(type, pos, end, { depth, group });
      stack.push({ start: pos, type, depth, group });
      depth++;
      pos = end;
      continue;
    }
    if (c === ')') {
      const o = stack.pop();
      if (o) {
        depth--;
        pairs.push([o.start, pos]);
        push(o.type, pos, pos + 1, { depth, group: o.group });
      } else push('err', pos, pos + 1);
      pos++;
      continue;
    }
    if (c === '|') { push('alt', pos, pos + 1); pos++; continue; }
    if (c === '^' || c === '$') { push('anchor', pos, pos + 1); pos++; continue; }
    if (c === '.') { push('set', pos, pos + 1); pos++; continue; }
    if (c === '*' || c === '+' || c === '?') {
      const end = src[pos + 1] === '?' ? pos + 2 : pos + 1;
      push('quant', pos, end);
      pos = end;
      continue;
    }
    if (c === '{') {
      const m = /^\{\d+(?:,\d*)?\}\??/.exec(src.slice(pos));
      if (m) { push('quant', pos, pos + m[0].length); pos += m[0].length; continue; }
      push(u ? 'err' : 'lit', pos, pos + 1);
      pos++;
      continue;
    }
    if ((c === '}' || c === ']') && u) { push('err', pos, pos + 1); pos++; continue; }
    const cp = src.codePointAt(pos);
    const w = cp > 0xffff ? 2 : 1;
    push('lit', pos, pos + w);
    pos += w;
  }
  // Unclosed groups: mark their '(' as errors. Sort keeps spans in source order with outer (longer) spans first,
  // because the error spans above were appended out of order.
  for (const o of stack) spans.push({ start: o.start, end: o.start + 1, type: 'err' });
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  return { spans, pairs, groups: total };
}

/**
 * Splits the source into consecutive segments [{ start, end, type | null }] covering it completely; `marks` are extra
 * ranges [{ start, end, type }] layered over the tokens (an error, a selection) and win where they overlap.
 */
// Per-code-unit type array: O(n) memory but trivially correct overlap resolution (err beats anything, first span
// wins otherwise). Patterns are short, so this is cheaper than interval arithmetic in practice.
export function segments(source, spans, marks = []) {
  const n = String(source).length;
  const types = new Array(n).fill(null);
  for (const s of spans) for (let i = Math.max(0, s.start); i < Math.min(n, s.end); i++) if (types[i] === null || s.type === 'err') types[i] = s.type;
  const extra = new Array(n).fill(null);
  for (const m of marks) for (let i = Math.max(0, m.start); i < Math.min(n, m.end); i++) extra[i] = extra[i] ? extra[i] + ' ' + m.type : m.type;
  // Span attributes (depth, group) follow the span that starts a run.
  const attrs = new Map();
  for (const s of spans) if (s.depth != null || s.group) attrs.set(s.start, s);
  const out = [];
  for (let i = 0; i < n;) {
    let j = i + 1;
    while (j < n && types[j] === types[i] && extra[j] === extra[i] && !attrs.has(j)) j++;
    const a = attrs.get(i);
    out.push({ start: i, end: j, type: types[i], mark: extra[i], depth: a ? a.depth : null, group: a ? a.group : null });
    i = j;
  }
  return out;
}
