// portal/segments.js - rewriting the text of safe HTML (pure): the text between tags, outside links, code, headings and
// buttons, is handed to a function as plain text and may come back with markup (cross-references and glossary terms
// become links). Entities are decoded before and the plain parts escaped again, so a match never splits an entity.
//
//   mapText(html, fn(plainText) -> html | null, { skip }) -> html     (null: the text stays as it was)
//   wrapSpans(text, spans: [{ start, end, open, close }]) -> html     spans sorted, non-overlapping (overlaps dropped)
import { escapeHTML } from '../html/escape.js';

// Tokenizer, not a parser: comments, tags (attribute values may contain '>' inside quotes), text runs, and a lone '<'.
// The input is SAFE HTML (already sanitized by the host); this function never has to defend against hostile markup,
// only preserve it. Shared /g regex reset per call: mapText must not be reentered from fn (it would reset lastIndex).
const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g;
// No links inside links (a), code, headings, form controls, or abbreviations / definitions that already explain themselves.
export const SKIP_TAGS = ['a', 'code', 'pre', 'kbd', 'script', 'style', 'textarea', 'button', 'select', 'option', 'label', 'summary',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'svg', 'math', 'template', 'sup', 'dfn', 'abbr'];
const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr', 'meta', 'link', 'source', 'track', 'col', 'area', 'base', 'embed', 'param']);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Entities are decoded so a term or reference spanning "&nbsp;" or "&amp;" still matches; fn returns HTML, and
// wrapSpans re-escapes every plain part, so decoding cannot inject markup. Unknown named entities are kept as is.
export function decodeText(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const k = e.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
  });
}

// Tag stack with tolerant closing: a closing tag pops up to its last matching open tag (unclosed <p> / <li> inside
// it are implied closed), and the skip depth is decremented for every skipped tag popped, so a stray close tag cannot
// leave the walker stuck in "skipping". Runs without letters / digits are passed through untouched (cheap fast path).
export function mapText(html, fn, { skip = SKIP_TAGS } = {}) {
  const skipSet = new Set(skip);
  const stack = [];
  let skipping = 0;
  let out = '';
  TOKEN.lastIndex = 0;
  let m;
  const src = String(html == null ? '' : html);
  while ((m = TOKEN.exec(src))) {
    const tok = m[0];
    if (tok[0] === '<' && m[1]) {
      const name = m[1].toLowerCase();
      if (tok[1] === '/') {
        const i = stack.lastIndexOf(name);
        if (i >= 0) {
          for (let k = stack.length - 1; k >= i; k--) if (skipSet.has(stack[k])) skipping--;
          stack.length = i;
        }
      } else if (!VOID.has(name) && !/\/>$/.test(tok)) {
        stack.push(name);
        if (skipSet.has(name)) skipping++;
      }
      out += tok;
      continue;
    }
    if (tok[0] === '<') { out += tok === '<' ? '&lt;' : tok; continue; }
    if (skipping > 0 || !/[\p{L}\p{N}]/u.test(tok)) { out += tok; continue; }
    const r = fn(decodeText(tok));
    out += r == null ? tok : r;
  }
  return out;
}

// Sorted by start, longest first at a tie; overlapping spans are dropped (first wins), so nested <a> cannot be produced.
export function wrapSpans(text, spans) {
  const s = String(text);
  const list = (spans || []).filter((x) => x && x.end > x.start).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let pos = 0;
  for (const sp of list) {
    if (sp.start < pos) continue;
    out += escapeHTML(s.slice(pos, sp.start)) + sp.open + escapeHTML(s.slice(sp.start, sp.end)) + sp.close;
    pos = sp.end;
  }
  return out + escapeHTML(s.slice(pos));
}
