// xml/xml.js - a small, strict XML 1.0 parser and serializer for data formats (KDBX, OOXML, SVG, feeds). No DTDs,
// no external entities (never fetched or expanded); the five predefined entities and character references only.
//
//   parseXML(text, { trim = true }) -> document { type: 'document', children: [...] }
//     element { type: 'element', name, attrs: { name: value }, children: [...] }   (names keep their prefixes)
//     text    { type: 'text', text, cdata? }       comment { type: 'comment', text }   pi { type: 'pi', target, data }
//     trim: drop whitespace-only text between elements (xml:space="preserve" keeps it)
//   serializeXML(node, { declaration = true, indent = '' }) -> string
//   el(name, attrs, ...children) builds elements; root / child / children / textOf / attr / local query helpers.
//
// Design decisions:
// - Hand-written scanner, not DOMParser: runs in workers and Node (tests, build), reports line numbers, and yields a
//   plain-object tree that JSON-serializes and diffs. DOMParser also signals failure by returning a <parsererror>
//   document instead of throwing, which callers routinely forget to check.
// - Security by omission: DOCTYPE is skipped, never interpreted, so XXE (external entity fetch) and billion-laughs
//   (recursive entity expansion) are impossible by construction, not prevented by a limit that could be mis-set.
// - Strict where it protects data (unterminated entities, duplicate attributes, mismatched tags, '<' in attribute
//   values, a second root all throw); lenient where producers deviate harmlessly (unknown PIs kept, DOCTYPE ignored).
// - Namespaces are not resolved: names keep their prefix and queries also match by local part. Enough for formats
//   with fixed prefixes; wrong for documents that bind one prefix to two URIs (not seen in the target formats).

// XML 1.0 (5th ed.) NameStartChar / NameChar productions, BMP part only. The astral range #x10000-#xEFFFF is omitted
// because the test runs per UTF-16 code unit; a surrogate pair would need a two-unit check. Names with astral
// letters therefore throw 'name expected'; acceptable for machine-generated formats.
const NAME_START = /[A-Za-z_:À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;
const NAME_CHAR = /[-.0-9·̀-ͯ‿-⁀A-Za-z_:À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;
// The five predefined entities. Anything else must be a character reference or it is an error (no DTD lookup).
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

// The error carries the offset (`at`) for programs and a 1-based line in the message for humans. The line is computed
// only on failure: tracking it on the happy path would cost work per token for a value almost never read.
class XMLError extends Error {
  constructor(msg, text, at) {
    const line = text.slice(0, at).split('\n').length;
    super(`${msg} (line ${line})`);
    this.at = at;
  }
}

// Expands entity and character references in one regex pass. The `;?` deliberately matches an unterminated reference
// so it is reported (fail fast) instead of left as literal text, as HTML parsers do, which hides corrupt input.
// indexOf fast path: most text runs contain no '&', and replace() with a callback is comparatively costly.
// KNOWN DEFECT: references to U+0000 or to a surrogate (&#xD800;) are accepted although XML forbids them;
// String.fromCodePoint then yields NUL / a lone surrogate. Fix: reject cp === 0 and 0xD800 <= cp <= 0xDFFF.
function decodeEntities(s, text, at) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);?/g, (m, e) => {
    if (!m.endsWith(';')) throw new XMLError(`unterminated entity "${m}"`, text, at);
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp > 0x10ffff || cp < 0) throw new XMLError(`bad character reference "${m}"`, text, at);
      return String.fromCodePoint(cp);
    }
    if (Object.prototype.hasOwnProperty.call(ENT, e)) return ENT[e];
    throw new XMLError(`unknown entity "${m}"`, text, at);
  });
}

// Single forward pass with an explicit stack (no recursion, so deep documents cannot overflow the call stack).
// `keepWs` runs parallel to `stack`: the effective xml:space of each open element, inherited unless overridden.
export function parseXML(text, { trim = true } = {}) {
  text = String(text);
  // A BOM survives decoding when the caller used ignoreBOM or a manual decoder; it is not document text.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const doc = { type: 'document', children: [] };
  const stack = [doc];
  const keepWs = [false];
  let i = 0;
  const n = text.length;
  const top = () => stack[stack.length - 1];
  const name = () => {
    const s = i;
    if (!NAME_START.test(text[i] || '')) throw new XMLError('name expected', text, i);
    i++;
    while (i < n && NAME_CHAR.test(text[i])) i++;
    return text.slice(s, i);
  };
  const ws = () => { while (i < n && /[ \t\r\n]/.test(text[i])) i++; };
  // Adjacent plain text runs merge (entity references and comments split them while scanning); CDATA stays a separate
  // node so the serializer can round-trip it. Whitespace outside the root is legal and dropped; other text is an error.
  const pushText = (s, cdata) => {
    const parent = top();
    if (!cdata && trim && !keepWs[keepWs.length - 1] && !/\S/.test(s)) return;
    if (parent === doc) { if (/\S/.test(s)) throw new XMLError('text outside the root element', text, i); return; }
    const last = parent.children[parent.children.length - 1];
    if (last && last.type === 'text' && !last.cdata && !cdata) last.text += s;
    else parent.children.push(cdata ? { type: 'text', text: s, cdata: true } : { type: 'text', text: s });
  };
  // Each iteration consumes one text run and then one markup construct starting at the next '<'.
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { pushText(decodeEntities(text.slice(i), text, i)); break; }
    if (lt > i) pushText(decodeEntities(text.slice(i, lt), text, i));
    i = lt;
    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) throw new XMLError('unterminated comment', text, i);
      top().children.push({ type: 'comment', text: text.slice(i + 4, e) });
      i = e + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const e = text.indexOf(']]>', i + 9);
      if (e < 0) throw new XMLError('unterminated CDATA section', text, i);
      pushText(text.slice(i + 9, e), true);
      i = e + 3;
    } else if (text.startsWith('<?', i)) {
      const e = text.indexOf('?>', i + 2);
      if (e < 0) throw new XMLError('unterminated processing instruction', text, i);
      const body = text.slice(i + 2, e);
      const m = /^([^\s?]+)\s*([\s\S]*)$/.exec(body) || [, body, ''];
      // The XML declaration is consumed, not stored: serializeXML writes its own, keeping it would duplicate it.
      if (m[1].toLowerCase() !== 'xml') top().children.push({ type: 'pi', target: m[1], data: m[2] });
      i = e + 2;
    } else if (text.startsWith('<!DOCTYPE', i) || text.startsWith('<!doctype', i)) {
      // Skipped, internal subset included; entities declared there are never expanded.
      // Bracket counting skips the internal subset. Not quote-aware: a ']' or '>' inside a quoted entity value would
      // end the skip early and the rest would be parsed as content. Tolerable for the target formats, which carry no subset.
      let depth = 0, j = i + 9;
      for (; j < n; j++) {
        if (text[j] === '[') depth++;
        else if (text[j] === ']') depth--;
        else if (text[j] === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (text[i + 1] === '/') {
      i += 2;
      const nm = name();
      ws();
      if (text[i] !== '>') throw new XMLError(`">" expected after </${nm}`, text, i);
      i++;
      const open = top();
      if (open.type !== 'element' || open.name !== nm) throw new XMLError(`unexpected </${nm}>`, text, i);
      stack.pop();
      keepWs.pop();
    } else {
      i++;
      const nm = name();
      const attrs = {};
      for (;;) {
        const before = i;
        ws();
        if (text[i] === '>' || text[i] === '/') break;
        // XML requires whitespace between attributes (a="1"b="2" is malformed); detected by position, not regex.
        if (i === before) throw new XMLError('whitespace expected between attributes', text, i);
        const an = name();
        ws();
        if (text[i] !== '=') throw new XMLError(`"=" expected after ${an}`, text, i);
        i++;
        ws();
        const q = text[i];
        if (q !== '"' && q !== "'") throw new XMLError('quoted attribute value expected', text, i);
        const e = text.indexOf(q, i + 1);
        if (e < 0) throw new XMLError('unterminated attribute value', text, i);
        const raw = text.slice(i + 1, e);
        if (raw.indexOf('<') >= 0) throw new XMLError('"<" in attribute value', text, i);
        if (Object.prototype.hasOwnProperty.call(attrs, an)) throw new XMLError(`duplicate attribute ${an}`, text, i);
        // Attribute value normalization (XML 1.0 3.3.3): literal tab/CR/LF become spaces BEFORE entity decoding, so an
        // encoded &#10; survives as a real newline. Reversing the order would flatten encoded newlines as well.
        attrs[an] = decodeEntities(raw.replace(/[\t\n\r]/g, ' '), text, i);
        i = e + 1;
      }
      const node = { type: 'element', name: nm, attrs, children: [] };
      const parent = top();
      // Scans top-level nodes only (declaration PIs, comments, the root), so this stays cheap.
      if (parent === doc && doc.children.some((c) => c.type === 'element')) throw new XMLError('a second root element', text, i);
      parent.children.push(node);
      if (text[i] === '/') {
        if (text[i + 1] !== '>') throw new XMLError('">" expected', text, i);
        i += 2;
      } else {
        i++;
        stack.push(node);
        keepWs.push(attrs['xml:space'] === 'preserve' ? true : attrs['xml:space'] === 'default' ? false : keepWs[keepWs.length - 1]);
      }
    }
  }
  if (stack.length > 1) throw new XMLError(`<${top().name}> is not closed`, text, n);
  if (!doc.children.some((c) => c.type === 'element')) throw new XMLError('no root element', text, n);
  return doc;
}

// Text escaping: only & and < are required in content; '>' is escaped too so a literal ']]>' can never appear.
// Characters illegal in XML 1.0 (C0 controls other than tab/LF/CR, U+FFFE, U+FFFF) are dropped rather than escaped,
// because even &#1; is not well-formed XML 1.0. Silent loss beats emitting a file no conforming parser accepts.
// Attribute escaping also encodes quote and tab/LF/CR as references; otherwise attribute normalization on re-parse
// would turn them into spaces and the round trip would lose data.
export const escapeXML = (s) => String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
export const escapeXMLAttr = (s) => escapeXML(s).replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

// Pretty-printing rule: indentation is whitespace text, so it goes only where it cannot change meaning: never inside
// xml:space="preserve" subtrees and never inside text-only elements (<a>x</a> stays on one line; indenting would add
// whitespace to the value). Mixed content with an indent does gain whitespace; pass indent '' where that matters.
export function serializeXML(node, { declaration = true, indent = '' } = {}) {
  const out = [];
  if (declaration) out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + (indent ? '\n' : ''));
  const rec = (nd, depth, preserve) => {
    if (nd.type === 'document') { for (const c of nd.children) rec(c, depth, preserve); return; }
    const pad = indent && !preserve ? '\n' + indent.repeat(depth) : '';
    // ']]>' cannot occur inside CDATA: split it across two sections (the standard trick).
    if (nd.type === 'text') { out.push(nd.cdata ? '<![CDATA[' + String(nd.text).split(']]>').join(']]]]><![CDATA[>') + ']]>' : escapeXML(nd.text)); return; }
    // '--' is illegal inside a comment; spacing it out keeps the output well-formed at the cost of altering the text.
    if (nd.type === 'comment') { out.push(pad + '<!--' + String(nd.text).replace(/--/g, '- -') + '-->'); return; }
    if (nd.type === 'pi') { out.push(pad + `<?${nd.target}${nd.data ? ' ' + nd.data : ''}?>`); return; }
    const attrs = Object.entries(nd.attrs || {}).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${escapeXMLAttr(v)}"`).join('');
    const kids = nd.children || [];
    // No newline before the very first element, so a declaration-less file does not start with whitespace.
    if (depth || out.length > (declaration ? 1 : 0)) out.push(pad);
    if (!kids.length) { out.push(`<${nd.name}${attrs}/>`); return; }
    out.push(`<${nd.name}${attrs}>`);
    const keep = nd.attrs && nd.attrs['xml:space'] === 'preserve' ? true : preserve;
    const textOnly = kids.every((c) => c.type === 'text');
    for (const c of kids) rec(c, depth + 1, keep || textOnly);
    if (indent && !keep && !textOnly) out.push('\n' + indent.repeat(depth));
    out.push(`</${nd.name}>`);
  };
  rec(node, 0, false);
  return out.join('');
}

// --- building and querying -----------------------------------------------------------

// el('Entry', { id: 1 }, el('String'), 'text') -> element (strings become text nodes; null / false are skipped).
export function el(name, attrs = {}, ...kids) {
  const children = [];
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    children.push(typeof k === 'object' ? k : { type: 'text', text: String(k) });
  }
  const a = {};
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) a[k] = String(v);
  return { type: 'element', name, attrs: a, children };
}

// Local part of a prefixed name ('x:row' -> 'row').
export const local = (name) => { const i = String(name).indexOf(':'); return i < 0 ? name : name.slice(i + 1); };
// Matches the full prefixed name or the local part: child(nd, 'row') finds both <row> and <x:row>. name == null
// matches any element.
const match = (nd, name) => nd.type === 'element' && (name == null || nd.name === name || local(nd.name) === name);

export const root = (doc) => doc.children.find((c) => c.type === 'element') || null;
export const child = (nd, name) => (nd && nd.children ? nd.children.find((c) => match(c, name)) || null : null);
export const children = (nd, name) => (nd && nd.children ? nd.children.filter((c) => match(c, name)) : []);
// Text content (descendant text nodes joined).
export function textOf(nd) {
  if (!nd) return '';
  if (nd.type === 'text') return nd.text;
  let s = '';
  for (const c of nd.children || []) if (c.type === 'text' || c.type === 'element') s += textOf(c);
  return s;
}
// hasOwnProperty, not truthiness or `in`: '' is a valid value and 'constructor' must not resolve to Object.prototype.
export const attr = (nd, name) => (nd && nd.attrs && Object.prototype.hasOwnProperty.call(nd.attrs, name) ? nd.attrs[name] : null);
// Child element by path of names: path(nd, 'Meta', 'MemoryProtection').
export function path(nd, ...names) {
  let cur = nd;
  for (const nm of names) { cur = child(cur, nm); if (!cur) return null; }
  return cur;
}
// Depth-first visit of elements: fn(element, parent) -> false skips the subtree.
export function walkXML(nd, fn, parent = null) {
  for (const c of nd.children || []) {
    if (c.type !== 'element') continue;
    if (fn(c, nd) !== false) walkXML(c, fn, c);
  }
}
