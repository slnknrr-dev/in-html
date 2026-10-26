// book/markup.js - forgiving markup reading for books found in the wild: a tolerant XML / HTML tree builder (the node
// shape of xml/xml.js, so its helpers work on the result), HTML named entities, and text decoding of files whose
// encoding is declared in an XML declaration, a <meta charset> or a BOM (UTF-8, UTF-16, windows-1251, KOI8-R, …).
// Strict well-formedness checks use xml/xml.js parseXML; this parser never throws on bad markup.
//
//   parseMarkup(text, { html = false }) -> { type: 'document', children }
//     element { type: 'element', name, attrs, children }, text { type: 'text', text }
//     html: lower-case names, void elements, raw-text script / style, implied end tags of p / li / td / tr / dt / dd
//     xml (default): names keep their case, <x/> is empty, a stray end tag is ignored, open elements close at the end
//   decodeEntities(s) -> s with character references and HTML named entities resolved (unknown ones kept)
//   decodeText(bytes, { html }) -> { text, encoding }
//   ln(node) -> lower-case local name ('l:href' -> 'href', 'FictionBook' -> 'fictionbook')
//   kids(node, name?) / kid(node, name?) / textContent(node) / getAttr(node, localName) — case-insensitive helpers

//
// Why not DOMParser: it does not exist in Node or Workers (where conversions run), its XML mode rejects the first
// error (most FB2 files in the wild have some), and its HTML mode executes nothing but still builds a heavyweight DOM.
// This parser is a small subset of the HTML5 tree-construction rules: enough recovery for real books, never throws,
// linear time (one forward scan, a stack of open elements).
// --- entities -------------------------------------------------------------------------------------

// Latin-1 names in code point order from U+00A0 to U+00FF.
// Entity table built from compact name lists (HTML 4 Latin-1 and Greek blocks are contiguous code point runs),
// instead of the full 2231-name HTML5 table: covers what books actually use at a fraction of the size.
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 '
  + 'acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig '
  + 'Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave '
  + 'Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave '
  + 'iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');
// '-' is a placeholder for U+03A2, an unassigned code point (there is no capital final sigma), keeping the run aligned.
const GREEK = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega'.split(' ');
const OTHER = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62, OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402,
  circ: 710, tilde: 732, thetasym: 977, upsih: 978, piv: 982, ensp: 8194, emsp: 8195, emsp13: 8196, emsp14: 8197,
  numsp: 8199, puncsp: 8200, thinsp: 8201, hairsp: 8202, ZeroWidthSpace: 8203, zwnj: 8204, zwj: 8205, lrm: 8206,
  rlm: 8207, hyphen: 8208, dash: 8208, ndash: 8211, mdash: 8212, horbar: 8213, lsquo: 8216, rsquo: 8217, sbquo: 8218,
  ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, bullet: 8226, hellip: 8230,
  permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, NoBreak: 8288,
  euro: 8364, image: 8465, weierp: 8472, real: 8476, numero: 8470, copysr: 8471, trade: 8482, TRADE: 8482,
  alefsym: 8501, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, crarr: 8629, lArr: 8656, uArr: 8657,
  rArr: 8658, dArr: 8659, hArr: 8660, forall: 8704, part: 8706, exist: 8707, empty: 8709, nabla: 8711, isin: 8712,
  notin: 8713, ni: 8715, prod: 8719, sum: 8721, minus: 8722, lowast: 8727, radic: 8730, prop: 8733, infin: 8734,
  ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747, there4: 8756, sim: 8764, cong: 8773, asymp: 8776,
  ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835, nsub: 8836, sube: 8838, supe: 8839, oplus: 8853,
  otimes: 8855, perp: 8869, sdot: 8901, lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971, lang: 10216, rang: 10217,
  loz: 9674, spades: 9824, clubs: 9827, hearts: 9829, diams: 9830, starf: 9733, star: 9734, phone: 9742, female: 9792,
  male: 9794, flat: 9837, natur: 9838, sharp: 9839, check: 10003, cross: 10007, sigmaf: 962, bsol: 92, sol: 47,
  lowbar: 95, excl: 33, quest: 63, num: 35, dollar: 36, percnt: 37, ast: 42, plus: 43, comma: 44, period: 46,
  colon: 58, semi: 59, equals: 61, lpar: 40, rpar: 41, lsqb: 91, rsqb: 93, lcub: 123, rcub: 125, verbar: 124,
  grave: 96, Hat: 94, COPY: 169, REG: 174, AMP: 38, LT: 60, GT: 62, QUOT: 34, Tab: 9, NewLine: 10, half: 189,
};
const ENTITIES = (() => {
  const m = new Map(Object.entries(OTHER));
  LATIN1.forEach((n, i) => m.set(n, 160 + i));
  GREEK.forEach((n, i) => { if (n !== '-') { m.set(n, 913 + i); m.set(n.toLowerCase(), 945 + i); } });
  return m;
})();

// Character references and named entities; unknown names and bare ampersands stay as they are.
// Fast path: no '&' means nothing to do (the common case for most text nodes).
// Invalid code points (0, > U+10FFFF, surrogates) become U+FFFD as in the HTML spec. Legacy rule: a named entity
// without ';' is decoded only in the Latin-1 range (&copy, &nbsp written sloppily), so "&notit" in prose is not
// turned into a not-sign followed by "it" for higher names. The C1 range 0x80..0x9F is remapped through cp1252.
export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
      // Windows-1252 code points written as references (&#151; for an em dash) are common in old HTML.
      if (cp >= 0x80 && cp <= 0x9f) return CP1252_C1[cp - 0x80] || '';
      return String.fromCodePoint(cp);
    }
    const cp = ENTITIES.get(e);
    if (cp == null || !m.endsWith(';') && cp > 255) return m;
    return String.fromCodePoint(cp);
  });
}
const CP1252_C1 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

// --- tree -------------------------------------------------------------------------------------------

// HTML tree rules in miniature: VOID elements never get children; RAW elements swallow text up to their end tag
// (a "<" inside a script must not open a tag); CLOSES_P lists blocks that implicitly end an open <p>; SIBLINGS +
// SCOPE implement implied end tags (a new <li> closes the previous <li>, but not across a nested list boundary).
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param', 'keygen', 'basefont', 'frame', 'isindex']);
const RAW = new Set(['script', 'style', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes']);
// Opening one of these closes an open <p> (HTML).
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol',
  'p', 'pre', 'section', 'table', 'ul', 'li', 'dd', 'dt']);
const SCOPE = { li: ['ul', 'ol', 'menu'], dt: ['dl'], dd: ['dl'], td: ['tr', 'table'], th: ['tr', 'table'], tr: ['table', 'tbody', 'thead', 'tfoot'], option: ['select'] };
const SIBLINGS = { li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], td: ['td', 'th'], th: ['td', 'th'], tr: ['tr'], option: ['option'] };

// Local names, lower-cased: FB2 uses prefixed attributes (l:href, xlink:href) and authoring tools vary the case,
// so all lookups compare local names case-insensitively.
export const ln = (nd) => {
  const n = nd && nd.name ? String(nd.name) : '';
  const i = n.indexOf(':');
  return (i < 0 ? n : n.slice(i + 1)).toLowerCase();
};
const lname = (name) => { const i = name.indexOf(':'); return (i < 0 ? name : name.slice(i + 1)).toLowerCase(); };

// Quoted, single-quoted or bare values; a bare name is a boolean attribute (value ''). The first occurrence wins on
// duplicates (HTML rule). Object.hasOwnProperty.call guards against attribute names like "hasOwnProperty".
function parseAttrs(s, html) {
  const attrs = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const name = html ? m[1].toLowerCase() : m[1];
    if (Object.prototype.hasOwnProperty.call(attrs, name)) continue;
    const v = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(v);
  }
  return attrs;
}

export function parseMarkup(src, { html = false } = {}) {
  src = String(src ?? '');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const doc = { type: 'document', children: [] };
  const stack = [doc];
  const n = src.length;
  let i = 0;
  const top = () => stack[stack.length - 1];
  const addText = (s) => {
    if (!s) return;
    const p = top();
    const last = p.children[p.children.length - 1];
    if (last && last.type === 'text') last.text += s;
    else p.children.push({ type: 'text', text: s });
  };
  const closeTo = (k) => { stack.length = k; };
  // Searches the open-element stack downwards; stopAt names scope boundaries (e.g. a </td> must not close a cell of an
  // outer table through an inner <table>).
  const findOpen = (name, stopAt) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const nm = lname(stack[k].name);
      if (nm === name) return k;
      if (stopAt && stopAt.includes(nm)) return -1;
    }
    return -1;
  };
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(decodeEntities(src.slice(i))); break; }
    if (lt > i) addText(decodeEntities(src.slice(i, lt)));
    i = lt;
    const c1 = src[i + 1];
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      addText(src.slice(i + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3;
      continue;
    }
    // Bracket depth tracking skips a DOCTYPE internal subset ([ <!ENTITY ...> ]) whose own '>' would otherwise end it.
    if (c1 === '!' || c1 === '?') {
      // Declarations, doctype (with an internal subset) and processing instructions are skipped.
      let depth = 0, j = i + 2;
      for (; j < n; j++) {
        const ch = src[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    if (c1 === '/') {
      const m = /^<\/([^\s/>]+)[^>]*>?/.exec(src.slice(i, i + 300));
      if (!m) { addText('<'); i++; continue; }
      i += m[0].length;
      const name = lname(m[1]);
      const k = findOpen(name, html && SCOPE[name] ? SCOPE[name] : null);
      // A stray </p> in HTML creates an empty <p>, per the HTML spec; other stray end tags are ignored.
      if (k > 0) closeTo(k);
      else if (html && name === 'p') top().children.push({ type: 'element', name: 'p', attrs: {}, children: [] });
      continue;
    }
    if (!/[A-Za-z_:]/.test(c1 || '')) { addText('<'); i++; continue; }
    // A quote opens a quoted value only after '=' or whitespace, so an apostrophe in a broken bare value (alt=don't)
    // does not swallow the rest of the document. A '<' before '>' marks an unterminated tag that ends right there.
    // Start tag: find its end, respecting quoted attribute values.
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(src[j])) j++;
    const rawName = src.slice(i + 1, j);
    let q = '', end = -1;
    for (let k = j; k < n; k++) {
      const ch = src[k];
      if (q) { if (ch === q) q = ''; continue; }
      if (ch === '"' || ch === "'") { if (/[=\s]/.test(src[k - 1]) || src[k - 1] === '=') q = ch; continue; }
      if (ch === '>') { end = k; break; }
      if (ch === '<' && k > j) { end = k - 1; break; } // unterminated tag
    }
    if (end < 0) end = n - 1;
    let inner = src.slice(j, end + (src[end] === '>' ? 0 : 1));
    const selfClose = /\/\s*$/.test(inner);
    if (selfClose) inner = inner.replace(/\/\s*$/, '');
    i = end + 1;
    const name = html ? rawName.toLowerCase() : rawName;
    const lnm = lname(name);
    const node = { type: 'element', name, attrs: parseAttrs(inner, html), children: [] };
    if (html) {
      // Implied end tags.
      if (CLOSES_P.has(lnm)) { const k = findOpen('p', ['button', 'table', 'td', 'th', 'li', 'blockquote', 'div', 'section', 'article', 'aside']); if (k > 0) closeTo(k); }
      if (SIBLINGS[lnm]) {
        for (let k = stack.length - 1; k > 0; k--) {
          const nm = lname(stack[k].name);
          if (SIBLINGS[lnm].includes(nm)) { closeTo(k); break; }
          if (SCOPE[lnm].includes(nm)) break;
        }
      }
    }
    top().children.push(node);
    if (selfClose || (html && VOID.has(lnm))) continue;
    // script/style content is dropped (books must not execute or style from foreign code); textarea/xmp text is kept.
    if (html && RAW.has(lnm)) {
      const re = new RegExp('</' + lnm + '\\s*>', 'i');
      const m = re.exec(src.slice(i));
      const stop = m ? i + m.index : n;
      if (lnm === 'textarea' || lnm === 'xmp') node.children.push({ type: 'text', text: src.slice(i, stop) });
      i = m ? stop + m[0].length : n;
      continue;
    }
    stack.push(node);
  }
  return doc;
}

// --- helpers ----------------------------------------------------------------------------------------

export const kids = (nd, name) => (nd && nd.children ? nd.children.filter((c) => c.type === 'element' && (name == null || ln(c) === name)) : []);
export const kid = (nd, name) => (nd && nd.children ? nd.children.find((c) => c.type === 'element' && (name == null || ln(c) === name)) || null : null);
// First descendant element with a local name (depth first).
export function find(nd, name) {
  for (const c of (nd && nd.children) || []) {
    if (c.type !== 'element') continue;
    if (ln(c) === name) return c;
    const r = find(c, name);
    if (r) return r;
  }
  return null;
}
export function findAll(nd, name, out = []) {
  for (const c of (nd && nd.children) || []) {
    if (c.type !== 'element') continue;
    if (ln(c) === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
export function textContent(nd) {
  if (!nd) return '';
  if (nd.type === 'text') return nd.text;
  let s = '';
  for (const c of nd.children || []) s += textContent(c);
  return s;
}
// Attribute by local name, any prefix ('href' finds l:href, xlink:href and href), case-insensitive.
export function getAttr(nd, name) {
  if (!nd || !nd.attrs) return null;
  if (Object.prototype.hasOwnProperty.call(nd.attrs, name)) return nd.attrs[name];
  for (const k of Object.keys(nd.attrs)) if (lname(k) === name) return nd.attrs[k];
  return null;
}
// The document's root element.
export const rootOf = (doc) => (doc && doc.children ? doc.children.find((c) => c.type === 'element') || null : null);

// --- text decoding ----------------------------------------------------------------------------------

// Common misspellings of encoding labels seen in old FB2 files, mapped to WHATWG labels TextDecoder accepts.
const ALIASES = { 'win-1251': 'windows-1251', cp1251: 'windows-1251', 'cp-1251': 'windows-1251', 'x-cp1251': 'windows-1251', cp1252: 'windows-1252', cp866: 'ibm866', 'utf8': 'utf-8' };

function tryDecoder(label, bytes, fatal = false) {
  try { return new TextDecoder(label, { fatal }).decode(bytes); } catch { return null; }
}

// Text of a file: BOM, then the declared encoding (<?xml encoding?>, <meta charset>), then strict UTF-8, then
// windows-1251 (the usual legacy encoding of FB2 / TXT books), then windows-1252.
// Order of evidence, strongest first: BOM, BOM-less UTF-16 pattern ('<' followed by 0), declared encoding, strict
// UTF-8 (fatal: true, so invalid sequences fail instead of producing U+FFFD), then Cyrillic legacy guesses.
// A declared UTF-8 that fails strict decoding falls through to the guesses: such files are usually cp1251 with a
// copy-pasted header. The declaration is read from a Latin-1 view of the first 1 KB, which is ASCII-safe.
export function decodeText(bytes, { html = false } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: tryDecoder('utf-8', b.subarray(3)) ?? '', encoding: 'utf-8' };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: tryDecoder('utf-16le', b.subarray(2)) ?? '', encoding: 'utf-16le' };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: tryDecoder('utf-16be', b.subarray(2)) ?? '', encoding: 'utf-16be' };
  // UTF-16 without a BOM: '<\0?\0' or '\0<\0?'.
  if (b.length > 3 && b[0] === 0x3c && b[1] === 0 && b[2] !== 0 && b[3] === 0) return { text: tryDecoder('utf-16le', b) ?? '', encoding: 'utf-16le' };
  if (b.length > 3 && b[0] === 0 && b[1] === 0x3c && b[2] === 0 && b[3] !== 0) return { text: tryDecoder('utf-16be', b) ?? '', encoding: 'utf-16be' };
  const head = String.fromCharCode(...b.subarray(0, 1024));
  let label = (/^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head) || [])[1];
  if (!label && html) label = (/<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9._:-]+)/i.exec(head) || [])[1];
  if (label) {
    const l = ALIASES[label.toLowerCase()] || label.toLowerCase();
    if (/^utf-?8$/.test(l)) {
      const s = tryDecoder('utf-8', b, true);
      if (s != null) return { text: s, encoding: 'utf-8' };
    } else {
      const s = tryDecoder(l, b);
      if (s != null) return { text: s, encoding: l };
    }
  }
  const u = tryDecoder('utf-8', b, true);
  if (u != null) return { text: u, encoding: 'utf-8' };
  // Cyrillic heuristic: windows-1251 maps 0xC0–0xFF to letters; KOI8-R puts lower-case letters at 0xC0–0xDF.
  const w = tryDecoder('windows-1251', b);
  if (w != null) {
    const koi = tryDecoder('koi8-r', b);
    if (koi != null && score(koi) > score(w) * 1.3) return { text: koi, encoding: 'koi8-r' };
    if (score(w) > 0) return { text: w, encoding: 'windows-1251' };
  }
  return { text: tryDecoder('windows-1252', b) ?? tryDecoder('utf-8', b) ?? '', encoding: 'windows-1252' };
}

// Rough plausibility of Cyrillic text: frequent lower-case letters minus capitals inside words.
// Plausibility: frequent Russian lower-case letters minus lower-upper pairs inside words. Text decoded with the wrong
// Cyrillic table swaps case (KOI8-R vs cp1251), producing many "aB"-shaped pairs, which the 3x penalty punishes.
function score(s) {
  const sample = s.slice(0, 20000);
  const good = (sample.match(/[оеаинтср]/g) || []).length;
  const bad = (sample.match(/[а-я][А-Я]/g) || []).length;
  return good - bad * 3;
}
