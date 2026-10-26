// regexp/codegen.js - code snippets that use a pattern: JavaScript, Python, Go, Java, C#, PHP and Rust, with the
// pattern translated to each flavour where the syntax differs (named groups, escapes, anchors, shorthand classes)
// and notes (codes + params) about what cannot be translated or behaves differently.
//
// Design rules of this module:
// - Translate from the AST, never by text substitution on the source: the same characters mean different things in
//   and out of a class, with and without u, so only the parser knows what '\d' or '$' or '-' is at a given offset.
// - Best effort + notes instead of refusal: an unsupported construct is emitted verbatim (raw) and a note code tells
//   the UI why the snippet may fail or differ. Notes are deduplicated by code (first params win) to keep the list short.
// - Notes are codes, not prose, so the application localises them (same contract as parse.js error codes).
// - Each snippet picks the target language's own literal form (raw strings, verbatim strings, delimiters) so the
//   translated pattern needs no second layer of escaping where the language allows it.
import { propertyNames, GENERAL_CATEGORY, SCRIPTS } from './explain.js';

export const LANGUAGES = [
  { id: 'js', name: 'JavaScript' }, { id: 'python', name: 'Python' }, { id: 'go', name: 'Go' }, { id: 'java', name: 'Java' },
  { id: 'csharp', name: 'C#' }, { id: 'php', name: 'PHP' }, { id: 'rust', name: 'Rust' },
];

const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');
const GC_SHORT = Object.fromEntries(Object.entries(GENERAL_CATEGORY).map(([k, v]) => [v, k]));
const JAVA_BINARY = new Set(['Alphabetic', 'Ideographic', 'Letter', 'Lowercase', 'Uppercase', 'Titlecase', 'Punctuation', 'Control', 'White_Space',
  'Digit', 'Hex_Digit', 'Join_Control', 'Noncharacter_Code_Point', 'Assigned', 'Emoji', 'Emoji_Presentation', 'Emoji_Modifier', 'Emoji_Modifier_Base', 'Emoji_Component', 'Extended_Pictographic']);
// Group-name syntax each engine accepts; a JS name outside it (e.g. non-ASCII in Go / Java) produces groupNameChars.
const NAME_OK = {
  python: /^[\p{L}_][\p{L}\p{N}_]*$/u, go: /^[A-Za-z0-9_]+$/, java: /^[A-Za-z][A-Za-z0-9]*$/, csharp: /^[\p{L}\p{N}_]+$/u,
  php: /^[A-Za-z_][A-Za-z0-9_]{0,31}$/, rust: /^[A-Za-z_][A-Za-z0-9_.[\]]*$/,
};

// Used to predict lookbehind restrictions (Python: fixed width, Java: bounded, PCRE: fixed per alternative).
// KNOWN DEFECT: a zero-width element under an unbounded quantifier ((?:)* or (?=a)+) gives 0 * Infinity = NaN as max;
// NaN then fails every equality, so e.g. Python gets a spurious lookbehindFixed note. Fix: n.max === 0 || b === 0 ? 0 : b * n.max.
// Length range [min, max] of a subtree (Infinity when unbounded; back-references count as unbounded).
function widths(n) {
  switch (n.type) {
    case 'Character': case 'CharacterSet': case 'ClassRange': return [1, 1];
    case 'CharacterClass': return n.unicodeSets && n.elements.some((e) => e.type === 'ClassStringDisjunction' || (e.type === 'CharacterSet' && e.strings)) ? [0, Infinity] : [1, 1];
    case 'Quantifier': { const [a, b] = widths(n.element); return [a * n.min, n.max === 0 ? 0 : b * n.max]; }
    case 'Alternative': return n.elements.reduce((acc, e) => { const [a, b] = widths(e); return [acc[0] + a, acc[1] + b]; }, [0, 0]);
    case 'Pattern': case 'Group': case 'CapturingGroup': {
      const w = n.alternatives.map(widths);
      return [Math.min(...w.map((x) => x[0])), Math.max(...w.map((x) => x[1]))];
    }
    case 'Backreference': return [0, Infinity];
    default: return [0, 0];
  }
}

/**
 * Translates a parsed JavaScript pattern to a flavour ('python', 'go', 'java', 'csharp', 'php', 'rust').
 * → { pattern, notes: [{ code, params }] }
 */
export function translate(parsed, flavour) {
  const src = parsed.source, f = parsed.flags;
  const notes = new Map();
  const note = (code, params = {}) => { if (!notes.has(code)) notes.set(code, { code, params }); };
  const raw = (n) => src.slice(n.start, n.end);
  const fl = flavour;
  // A code point as an escape in the flavour's syntax. Python \u / \U, .NET and Java \uXXXX (UTF-16 based engines:
  // astral code points become a surrogate pair, which .NET matches as two units), the rest use PCRE-style \x{...}.
  const uni = (v) => {
    if (v <= 0xff) return '\\x' + hex2(v);
    if (fl === 'python') return v > 0xffff ? '\\U' + v.toString(16).toUpperCase().padStart(8, '0') : '\\u' + hex4(v);
    if (fl === 'csharp' || (fl === 'java' && v <= 0xffff)) {
      if (v <= 0xffff) return '\\u' + hex4(v);
      const h = 0xd800 + ((v - 0x10000) >> 10), l = 0xdc00 + ((v - 0x10000) & 0x3ff);
      note('astralUtf16');
      return '\\u' + hex4(h) + '\\u' + hex4(l);
    }
    return '\\x{' + v.toString(16).toUpperCase() + '}';
  };
  // Engines whose \d \w \b are Unicode-aware by default (JS ones are ASCII-only): shorthands must be spelled out.
  const unicodeShort = fl === 'python' || fl === 'csharp' || fl === 'rust';

  function character(c, inClass) {
    const v = c.value, ch = String.fromCodePoint(v);
    switch (c.escape) {
      case null:
        if (v === 10) return '\\n';
        if (v === 13) return '\\r';
        if (v === 9) return '\\t';
        if (v < 0x20 || v === 0x7f || (v >= 0x2028 && v <= 0x2029)) return uni(v);
        if (v > 0xffff && fl === 'csharp') note('astralUtf16');
        if (inClass) {
          if (ch === '[' || ch === '-' || (ch === '/' && fl === 'php')) return '\\' + ch;
          // Doubled && ~~ || are set operators in Java / Rust classes; escaping one of the pair breaks the token.
          if ('&~|'.includes(ch) && src[c.end] === ch) return '\\' + ch;
          return raw(c);
        }
        // JS (Annex B) allows lone { } ] as literals; other engines may read them as syntax, so escape defensively.
        if ('{}]'.includes(ch)) return '\\' + ch;
        if (ch === '/' && fl === 'php') return '\\/';
        return raw(c);
      // Identity escapes: other engines reject unknown escapes of letters (\a, \e mean something else), so letters and
      // digits are emitted bare; punctuation keeps its backslash, which every flavour accepts.
      case 'identity':
        if (/[A-Za-z0-9]/.test(ch)) return ch;
        if (ch === '/') return fl === 'php' ? '\\/' : '/';
        if (ch === '-' && !inClass) return '-';
        return raw(c);
      case 'control':
        if (raw(c) === '\\v' && (fl === 'java' || fl === 'php')) return '\\x0B';
        return raw(c);
      case 'controlLetter':
        if ((fl === 'java' || fl === 'csharp' || fl === 'php') && /^\\c[A-Za-z]$/.test(raw(c))) return raw(c);
        return '\\x' + hex2(v);
      case 'hex': return raw(c);
      case 'unicode': case 'unicodeBrace': return v <= 0xffff && (fl === 'python' || fl === 'java' || fl === 'csharp') ? '\\u' + hex4(v) : uni(v);
      case 'backslash': return '\\\\';
      default: return uni(v); // null, octal, backspace
    }
  }

  function property(n) {
    const nm = propertyNames(n.key, n.value);
    const p = n.negate ? '\\P' : '\\p';
    if (n.strings) { note('noStringProperty', { prop: raw(n) }); return raw(n); }
    if (fl === 'python') { note('noUnicodeProperty'); return raw(n); }
    if (fl === 'rust') return raw(n);
    // Short GC names (Lu, L) are the most portable spelling across Java / .NET / Go / PCRE.
    if (nm.keyLong === 'General_Category' || (!n.key && !nm.binary)) {
      const short = GC_SHORT[nm.valueLong] || n.value;
      return p + '{' + short + '}';
    }
    if (nm.keyLong === 'Script' || nm.keyLong === 'Script_Extensions') {
      if (nm.keyLong === 'Script_Extensions') note('propertyPartial', { prop: raw(n) });
      const long = SCRIPTS[n.value] || n.value;
      if (fl === 'go' || fl === 'php') return p + '{' + long + '}';
      if (fl === 'java') return p + '{Is' + long + '}';
      note('propertyPartial', { prop: raw(n) });
      return raw(n);
    }
    // Binary properties.
    if (fl === 'java' && JAVA_BINARY.has(n.value)) return p + '{Is' + n.value + '}';
    note('propertyPartial', { prop: raw(n) });
    return raw(n);
  }

  function set(n, inClass) {
    if (n.kind === 'any') return '.';
    if (n.kind === 'property') return property(n);
    if (n.kind === 'space') { if (fl === 'go' || fl === 'java' || fl === 'php') note('asciiSpace'); return raw(n); }
    if (unicodeShort) {
      const body = n.kind === 'digit' ? '0-9' : 'A-Za-z0-9_';
      if (!inClass) return (n.negate ? '[^' : '[') + body + ']';
      if (!n.negate) return body;
      note('unicodeShorthands');
    }
    return raw(n);
  }

  function klass(n) {
    // [] never matches and [^] matches anything in JS; most engines reject the empty class, so spell the meaning.
    // Go (RE2) has no lookaround, hence an impossible class instead of (?!).
    if (!n.elements.length) {
      if (n.negate) return '[\\s\\S]';
      return fl === 'go' ? '[^\\x00-\\x{10FFFF}]' : '(?!)';
    }
    const neg = n.negate ? '^' : '';
    if (n.kind === 'union') {
      let body = '';
      for (const e of n.elements) {
        if (e.type === 'CharacterClass') {
          if (fl === 'java' || fl === 'rust') body += klass(e);
          // A nested plain union flattens losslessly: [a[bc]] == [abc]. Negated / operator classes cannot.
          else if (!e.negate && e.kind === 'union') body += klass(e).replace(/^\[/, '').replace(/\]$/, '');
          else { note('noSetOperations'); body += raw(e); }
        } else body += emit(e, true);
      }
      return '[' + neg + body + ']';
    }
    const ops = n.elements.map((e) => (e.type === 'CharacterClass' ? klass(e) : emit(e, true)));
    if (fl === 'rust') return '[' + neg + ops.join(n.kind === 'intersection' ? '&&' : '--') + ']';
    if (fl === 'java') {
      if (n.kind === 'intersection') return '[' + neg + ops.join('&&') + ']';
      // Java has no subtraction operator; A -- B is rewritten as A && [^B].
      return '[' + neg + ops[0] + ops.slice(1).map((o) => '&&[^' + o + ']').join('') + ']';
    }
    note('noSetOperations');
    return raw(n);
  }

  const alts = (n) => n.alternatives.map((a) => emit(a, false)).join('|');

  function emit(n, inClass) {
    switch (n.type) {
      case 'Pattern': return alts(n);
      case 'Alternative': return n.elements.map((e) => emit(e, false)).join('');
      case 'Group':
        if (n.modifiers) return '(?' + n.modifiers.add + (n.modifiers.remove ? '-' + n.modifiers.remove : '') + ':' + alts(n) + ')';
        return '(?:' + alts(n) + ')';
      case 'CapturingGroup':
        if (n.name == null) return '(' + alts(n) + ')';
        if (!NAME_OK[fl].test(n.name)) note('groupNameChars', { name: n.name });
        return (fl === 'python' || fl === 'go' ? '(?P<' : '(?<') + n.name + '>' + alts(n) + ')';
      case 'Lookaround': {
        if (fl === 'go' || fl === 'rust') note('noLookaround');
        if (n.kind === 'lookbehind') {
          const w = widths({ type: 'Group', alternatives: n.alternatives });
          const each = n.alternatives.every((a) => { const x = widths(a); return x[0] === x[1]; });
          if (fl === 'python' && w[0] !== w[1]) note('lookbehindFixed');
          if (fl === 'java' && w[1] === Infinity) note('lookbehindBounded');
          if (fl === 'php' && !each) note('lookbehindBounded');
        }
        return '(?' + (n.kind === 'lookbehind' ? '<' : '') + (n.negate ? '!' : '=') + alts(n) + ')';
      }
      case 'Quantifier': {
        if ((fl === 'go' || fl === 'rust') && n.max !== Infinity && n.max > 1000) note('repeatLimit');
        let el = emit(n.element, false);
        // .NET counts UTF-16 units: an astral character is two of them, so it needs a group to be repeated.
        if (fl === 'csharp' && n.element.type === 'Character' && n.element.value > 0xffff) el = '(?:' + el + ')';
        return el + src.slice(n.qStart, n.end);
      }
      case 'Assertion':
        if (n.kind === 'word') { if (unicodeShort) note('unicodeBoundary'); return n.negate ? '\\B' : '\\b'; }
        // JS $ without m is end of input only; in Python / Java / .NET $ also matches before a final \n. \Z (Python)
        // and \z (Java, .NET) are the exact equivalents. Go / Rust $ already means end of text.
        if (n.kind === 'end' && !f.multiline) return fl === 'python' ? '\\Z' : fl === 'java' || fl === 'csharp' ? '\\z' : '$';
        return n.kind === 'start' ? '^' : '$';
      case 'Backreference':
        if (fl === 'go' || fl === 'rust') note('noBackrefs');
        if (n.named) return fl === 'python' ? '(?P=' + n.ref + ')' : '\\k<' + n.ref + '>';
        return '\\' + n.ref;
      case 'Character': return character(n, inClass);
      case 'CharacterSet': return set(n, inClass);
      case 'CharacterClass': return klass(n);
      case 'ClassRange': return character(n.min, true) + '-' + character(n.max, true);
      case 'ClassStringDisjunction': note('noStringProperty', { prop: raw(n) }); return raw(n);
      default: return raw(n);
    }
  }

  let pattern = emit(parsed.ast, false);
  if (parsed.names.length < parsed.groups.filter((g) => g.name != null).length && fl !== 'csharp') note('duplicateNames');
  if (f.sticky) note('sticky');
  // Go / Rust take flags only inline; the other snippets pass them as API options.
  if (fl === 'go' || fl === 'rust') {
    const inline = (f.ignoreCase ? 'i' : '') + (f.multiline ? 'm' : '') + (f.dotAll ? 's' : '');
    if (inline) pattern = '(?' + inline + ')' + pattern;
  }
  if (fl === 'go' || fl === 'rust' || fl === 'php') note('byteOffsets');
  return { pattern, notes: [...notes.values()] };
}

/** Replacement template ($&, $1, $<name>, $$, $`, $') in a flavour's syntax → { text, notes }. */
// Mirrors String.prototype.replace GetSubstitution: $nn takes two digits only if that group exists, otherwise one;
// an unknown $<name> becomes empty (when the pattern has named groups), any other '$' stays literal.
export function translateReplacement(tpl, parsed, flavour) {
  const notes = [];
  const byName = new Map(parsed.groups.filter((g) => g.name != null).map((g) => [g.name, g.index]));
  const caps = parsed.groupCount;
  let out = '';
  // Engines whose replacement syntax treats backslash as an escape need literal backslashes doubled.
  const lit = (s) => (flavour === 'python' || flavour === 'java' || flavour === 'php' ? s.replace(/\\/g, '\\\\') : s);
  // A literal dollar sign in the flavour's replacement syntax.
  const dollar = flavour === 'go' || flavour === 'rust' || flavour === 'csharp' ? '$$' : flavour === 'java' || flavour === 'php' ? '\\$' : '$';
  const ref = (n) => ({ python: '\\g<' + n + '>', go: '${' + n + '}', java: '$' + (n === 0 ? '0' : n), csharp: n === 0 ? '$&' : '${' + n + '}', php: '${' + n + '}', rust: '${' + n + '}', js: '$' + n })[flavour];
  const named = (name) => ({ python: '\\g<' + name + '>', go: '${' + name + '}', java: '${' + name + '}', csharp: '${' + name + '}', php: '${' + (byName.get(name) ?? 0) + '}', rust: '${' + name + '}', js: '$<' + name + '>' })[flavour];
  for (let i = 0; i < tpl.length; i++) {
    const c = tpl[i];
    if (c !== '$' || i + 1 >= tpl.length) { out += c === '$' ? dollar : lit(c); continue; }
    const d = tpl[i + 1];
    if (d === '$') { out += dollar; i++; }
    else if (d === '&') { out += ref(0); i++; }
    else if (d === '`' || d === '\'') {
      if (flavour === 'csharp') out += '$' + d;
      else { notes.push({ code: 'replaceContext', params: { token: '$' + d } }); out += dollar + lit(d); }
      i++;
    } else if (d >= '0' && d <= '9') {
      let digits = 1, idx = +d;
      const d2 = tpl[i + 2];
      if (d2 >= '0' && d2 <= '9') { digits = 2; idx = idx * 10 + +d2; if (idx > caps) { digits = 1; idx = +d; } }
      if (idx >= 1 && idx <= caps) out += ref(idx);
      else out += dollar + lit(tpl.slice(i + 1, i + 1 + digits));
      i += digits;
    } else if (d === '<' && parsed.names.length) {
      const close = tpl.indexOf('>', i + 2);
      if (close < 0) { out += dollar + lit('<'); i++; }
      else { out += byName.has(tpl.slice(i + 2, close)) ? named(tpl.slice(i + 2, close)) : ''; i = close; }
    } else out += dollar;
  }
  return { text: out, notes };
}

// --- string literals --------------------------------------------------------------------------------------

function jsonish(s) { return JSON.stringify(s); }
function rustStr(s) {
  return '"' + [...s].map((ch) => {
    const v = ch.codePointAt(0);
    if (ch === '"') return '\\"';
    if (ch === '\\') return '\\\\';
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    if (ch === '\t') return '\\t';
    if (v < 0x20 || v === 0x7f) return '\\u{' + v.toString(16) + '}';
    return ch;
  }).join('') + '"';
}
const phpSingle = (s) => '\'' + s.replace(/\\/g, '\\\\').replace(/'/g, '\\\'') + '\'';
// Python raw strings cannot end in an odd number of backslashes and cannot contain the quote or a newline; fall back
// to a JSON string (valid Python syntax for these characters) when a raw form is impossible.
function pyRaw(s) {
  const oddTail = /(^|[^\\])(\\\\)*\\$/.test(s);
  if (!/[\n\r]/.test(s) && !oddTail) {
    if (!s.includes('\'')) return 'r\'' + s + '\'';
    if (!s.includes('"')) return 'r"' + s + '"';
  }
  return jsonish(s);
}
const goRaw = (s) => (!s.includes('`') && !/\r/.test(s) ? '`' + s + '`' : jsonish(s));
// r#"..."#: add hashes until the closing delimiter cannot occur inside the text.
function rustRaw(s) {
  let hashes = '';
  while (s.includes('"' + hashes)) hashes += '#';
  return 'r' + hashes + '"' + s + '"' + hashes;
}
const csVerbatim = (s) => '@"' + s.replace(/"/g, '""') + '"';
// Source → /literal/: escape '/' outside classes and line terminators (a literal cannot span lines). An empty source
// becomes (?:), because // would start a comment; that is what RegExp.prototype.source does too.
function jsLiteral(source, flags) {
  let out = '', inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { out += c + (source[i + 1] ?? ''); i++; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    if (c === '/' && !inClass) out += '\\/';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\u2028') out += '\\u2028';
    else if (c === '\u2029') out += '\\u2029';
    else out += c;
  }
  return '/' + (out || '(?:)') + '/' + flags;
}

/**
 * Code snippets for every language: [{ id, name, code, notes: [{ code, params }] }].
 *   options: { text: sample subject (first line is used), replacement: template or null }
 */
export function snippets(parsed, options = {}) {
  if (!parsed || !parsed.ok) return [];
  const f = parsed.flags;
  // First line only, capped: the sample is embedded as a string literal and must stay readable in a code box.
  const sample = String(options.text ?? '').split(/\r?\n/)[0].slice(0, 120);
  const rep = options.replacement != null && options.replacement !== '' ? String(options.replacement) : null;
  const all = f.global;
  const out = [];

  // JavaScript: the pattern as written.
  {
    const lit = jsLiteral(parsed.source, f.raw);
    let code = `const re = ${lit};\nconst text = ${jsonish(sample)};\n\n`;
    code += all
      ? 'for (const m of text.matchAll(re)) {\n  console.log(m.index, m[0], m.groups);\n}\n'
      : 'const m = re.exec(text);\nif (m) console.log(m.index, m[0], m.groups);\n';
    if (rep != null) code += `\nconst result = text.replace(re, ${jsonish(rep)});\nconsole.log(result);\n`;
    out.push({ id: 'js', name: 'JavaScript', code, notes: [] });
  }

  // Python.
  {
    const t = translate(parsed, 'python');
    const fl = [f.ignoreCase && 're.IGNORECASE', f.multiline && 're.MULTILINE', f.dotAll && 're.DOTALL'].filter(Boolean);
    let code = `import re\n\npattern = re.compile(${pyRaw(t.pattern)}${fl.length ? ', ' + fl.join(' | ') : ''})\ntext = ${jsonish(sample)}\n\n`;
    code += all
      ? 'for m in pattern.finditer(text):\n    print(m.start(), m.group(0), m.groupdict())\n'
      : `m = pattern.${f.sticky ? 'match' : 'search'}(text)\nif m:\n    print(m.start(), m.group(0), m.groupdict())\n`;
    const notes = [...t.notes];
    if (rep != null) {
      const r = translateReplacement(rep, parsed, 'python');
      notes.push(...r.notes);
      code += `\nresult = pattern.sub(${pyRaw(r.text)}, text${all ? '' : ', count=1'})\nprint(result)\n`;
    }
    out.push({ id: 'python', name: 'Python', code, notes });
  }

  // Go (RE2).
  {
    const t = translate(parsed, 'go');
    let body = `\tre := regexp.MustCompile(${goRaw(t.pattern)})\n\ttext := ${jsonish(sample)}\n\n`;
    body += all
      ? '\tfor _, m := range re.FindAllStringSubmatchIndex(text, -1) {\n\t\tfmt.Println(m[0], text[m[0]:m[1]])\n\t}\n'
      : '\tif m := re.FindStringSubmatchIndex(text); m != nil {\n\t\tfmt.Println(m[0], text[m[0]:m[1]])\n\t}\n';
    const notes = [...t.notes];
    if (rep != null) {
      const r = translateReplacement(rep, parsed, 'go');
      notes.push(...r.notes);
      if (!all) notes.push({ code: 'replaceFirst', params: {} });
      body += `\n\tresult := re.ReplaceAllString(text, ${jsonish(r.text)})\n\tfmt.Println(result)\n`;
    }
    out.push({ id: 'go', name: 'Go', code: `package main\n\nimport (\n\t"fmt"\n\t"regexp"\n)\n\nfunc main() {\n${body}}\n`, notes });
  }

  // Java.
  {
    const t = translate(parsed, 'java');
    // Java's CASE_INSENSITIVE is ASCII-only unless UNICODE_CASE is added; add it whenever non-ASCII may be involved.
    const fl = [f.ignoreCase && 'Pattern.CASE_INSENSITIVE', f.ignoreCase && (f.unicode || f.unicodeSets || /[^\x00-\x7f]/.test(parsed.source)) && 'Pattern.UNICODE_CASE',
      f.multiline && 'Pattern.MULTILINE', f.dotAll && 'Pattern.DOTALL'].filter(Boolean);
    let body = `        Pattern pattern = Pattern.compile(${jsonish(t.pattern)}${fl.length ? ', ' + fl.join(' | ') : ''});\n        String text = ${jsonish(sample)};\n        Matcher m = pattern.matcher(text);\n`;
    body += all
      ? '        while (m.find()) {\n            System.out.println(m.start() + " " + m.group());\n        }\n'
      : '        if (m.find()) {\n            System.out.println(m.start() + " " + m.group());\n        }\n';
    const notes = [...t.notes];
    if (rep != null) {
      const r = translateReplacement(rep, parsed, 'java');
      notes.push(...r.notes);
      body += `        String result = pattern.matcher(text).${all ? 'replaceAll' : 'replaceFirst'}(${jsonish(r.text)});\n        System.out.println(result);\n`;
    }
    out.push({ id: 'java', name: 'Java', code: `import java.util.regex.Matcher;\nimport java.util.regex.Pattern;\n\npublic class Main {\n    public static void main(String[] args) {\n${body}    }\n}\n`, notes });
  }

  // C# (.NET).
  {
    const t = translate(parsed, 'csharp');
    const fl = [f.ignoreCase && 'RegexOptions.IgnoreCase', f.multiline && 'RegexOptions.Multiline', f.dotAll && 'RegexOptions.Singleline'].filter(Boolean);
    let code = `using System;\nusing System.Text.RegularExpressions;\n\nvar regex = new Regex(${csVerbatim(t.pattern)}${fl.length ? ', ' + fl.join(' | ') : ''});\nvar text = ${jsonish(sample)};\n\n`;
    code += all
      ? 'foreach (Match m in regex.Matches(text))\n    Console.WriteLine($"{m.Index}: {m.Value}");\n'
      : 'var m = regex.Match(text);\nif (m.Success) Console.WriteLine($"{m.Index}: {m.Value}");\n';
    const notes = [...t.notes];
    if (rep != null) {
      const r = translateReplacement(rep, parsed, 'csharp');
      notes.push(...r.notes);
      code += `\nvar result = regex.Replace(text, ${jsonish(r.text)}${all ? '' : ', 1'});\nConsole.WriteLine(result);\n`;
    }
    out.push({ id: 'csharp', name: 'C#', code, notes });
  }

  // PHP (PCRE2).
  {
    const t = translate(parsed, 'php');
    const nonAscii = /[^\x00-\x7f]/.test(parsed.source) || /[^\x00-\x7f]/.test(sample);
    // /u makes PCRE treat the subject as UTF-8 (needed for non-ASCII). /D (DOLLAR_ENDONLY) gives $ the JS meaning
    // when m is off; otherwise PCRE $ also matches before a trailing newline.
    const mods = (f.ignoreCase ? 'i' : '') + (f.multiline ? 'm' : '') + (f.dotAll ? 's' : '') + (f.unicode || f.unicodeSets || nonAscii ? 'u' : '')
      + (!f.multiline && /\$/.test(t.pattern) ? 'D' : '');
    let code = `<?php\n$pattern = ${phpSingle('/' + t.pattern + '/' + mods)};\n$text = ${phpSingle(sample)};\n\n`;
    code += all
      ? 'preg_match_all($pattern, $text, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);\nforeach ($matches as $m) {\n    echo $m[0][1], \': \', $m[0][0], PHP_EOL;\n}\n'
      : 'if (preg_match($pattern, $text, $m, PREG_OFFSET_CAPTURE)) {\n    echo $m[0][1], \': \', $m[0][0], PHP_EOL;\n}\n';
    const notes = [...t.notes];
    if (rep != null) {
      const r = translateReplacement(rep, parsed, 'php');
      notes.push(...r.notes);
      code += `\n$result = preg_replace($pattern, ${phpSingle(r.text)}, $text${all ? '' : ', 1'});\necho $result, PHP_EOL;\n`;
    }
    out.push({ id: 'php', name: 'PHP', code, notes });
  }

  // Rust (regex crate).
  {
    const t = translate(parsed, 'rust');
    let body = `    let re = Regex::new(${rustRaw(t.pattern)}).unwrap();\n    let text = ${rustStr(sample)};\n\n`;
    body += all
      ? '    for caps in re.captures_iter(text) {\n        let m = caps.get(0).unwrap();\n        println!("{}: {}", m.start(), m.as_str());\n    }\n'
      : '    if let Some(m) = re.find(text) {\n        println!("{}: {}", m.start(), m.as_str());\n    }\n';
    const notes = [...t.notes];
    if (rep != null) {
      const r = translateReplacement(rep, parsed, 'rust');
      notes.push(...r.notes);
      body += `\n    let result = re.${all ? 'replace_all' : 'replace'}(text, ${rustRaw(r.text)});\n    println!("{}", result);\n`;
    }
    out.push({ id: 'rust', name: 'Rust', code: `use regex::Regex;\n\nfn main() {\n${body}}\n`, notes });
  }
  return out;
}

// Every code translate() / translateReplacement() / snippets() can emit; the UI keeps a message per code.
export const NOTE_CODES = ['noLookaround', 'noBackrefs', 'lookbehindFixed', 'lookbehindBounded', 'noUnicodeProperty', 'propertyPartial', 'noStringProperty',
  'noSetOperations', 'duplicateNames', 'groupNameChars', 'sticky', 'asciiSpace', 'unicodeShorthands', 'unicodeBoundary', 'byteOffsets', 'replaceContext',
  'replaceFirst', 'repeatLimit', 'astralUtf16'];
