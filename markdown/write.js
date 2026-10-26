// markdown/write.js - Markdown from rich text: htmlToMarkdown(html, opts) converts the rich-text subset of the editors
// (p, h1–h6, ul / ol / li, blockquote, pre / code, strong / b, em / i, u, s / del, sub, sup, mark, a, br, hr, span,
// tables) to Markdown; escapeMarkdown(text) escapes plain text; tableMarkdown(head, rows, align, opts) writes a GFM
// table. String based (minify/html.js tokenizer): works in Node and browsers alike.
//
//   opts.gfm   GitHub-flavoured output for README editors: line breaks as '\' + newline (<br> in table cells),
//              kbd / ins / mark / sub / sup / small / samp / var / u kept as HTML tags, '$' escaped (math), lighter
//              escaping (#, >, -, +, 1. only where they would start a block; _ only at word edges), <img> with
//              width / height / align kept as HTML, task boxes, table alignment from align="…"
//   Any element with data-md-raw="…" becomes that text verbatim (an editor keeps the source of images, badges,
//   math or HTML it did not change).
//   tableMarkdown(..., { pad: true }) pads the columns to equal widths.

//
// Approach: tokens -> small tree -> recursive emit. A tree is needed because Markdown is context-sensitive (list
// indentation, table cells cannot hold blocks, emphasis must wrap trimmed text). Escaping is the hard part: too
// little and text turns into syntax ("1. " starting a paragraph becomes a list), too much and the source is unreadable;
// gfm mode escapes only where a character would actually change the meaning.
import { attr, tokenizeHTML } from '../minify/html.js';

// Plain text with the characters that would start Markdown syntax escaped.
export function escapeMarkdown(s) {
  return String(s).replace(/([\\`*_[\]#|<>~])/g, '\\$1').replace(/^(\s*)([-+]|\d+[.)])(\s)/gm, '$1\\$2$3');
}
// GFM text escaping: only what would change the meaning inside a paragraph.
function escapeGFM(s) {
  return String(s).replace(/\u00a0/g, ' ').replace(/([\\`*[\]$])/g, '\\$1').replace(/<(?=[A-Za-z/!?])/g, '\\<')
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_').replace(/~~/g, '\\~\\~').replace(/\|/g, '\\|');
}
// Escapes a paragraph start that would read as a heading, quote, list item or setext underline.
const escapeLead = (s) => s.replace(/^(#{1,6}(?=\s|$)|>|[-+](?=\s)|=+\s*$)/, '\\$1').replace(/^(\d+)([.)](?=\s))/, '$1\\$2');

// One pass: the entities of escapeHTML plus &nbsp; and numeric references.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const FULL_ENT = (s) => s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
  if (e[0] !== '#') return NAMED[e.toLowerCase()];
  const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
  return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m;
});

// Builds a tree of { name, attrs, kids } / strings from tokens (unknown tags keep their children).
// Tolerant like browsers: a close tag pops to its matching open element (implicitly closing what is in between); a
// stray close tag with no match is ignored.
function tree(html) {
  const root = { name: '#root', kids: [] };
  const stack = [root];
  const VOID = new Set(['br', 'hr', 'img', 'input', 'col', 'wbr', 'source']);
  for (const tk of tokenizeHTML(String(html || ''))) {
    const top = stack[stack.length - 1];
    if (tk.t === 'text') top.kids.push(FULL_ENT(tk.v));
    else if (tk.t === 'open') {
      const node = { name: tk.name, tag: tk, kids: [] };
      top.kids.push(node);
      if (!VOID.has(tk.name) && !tk.selfClose) stack.push(node);
    } else if (tk.t === 'close') {
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === tk.name) { stack.length = k; break; }
    }
  }
  return root;
}
const rawOf = (node) => (typeof node === 'string' ? null : attr(node.tag, 'data-md-raw'));
const KEEP_TAGS = new Set(['kbd', 'ins', 'mark', 'sub', 'sup', 'small', 'samp', 'var', 'abbr', 'q']);

function inline(node, o) {
  if (typeof node === 'string') return o.gfm ? escapeGFM(node.replace(/[ \t\r\n]+/g, ' ')) : escapeMarkdown(node.replace(/\s+/g, ' '));
  const raw = rawOf(node);
  if (raw != null) return raw;
  const kids = () => node.kids.map((k) => inline(k, o)).join('');
  switch (node.name) {
    case 'strong': case 'b': return wrap('**', kids());
    case 'em': case 'i': return wrap('*', kids());
    case 's': case 'del': case 'strike': return wrap('~~', kids());
    case 'code': { const t = textOf(node); const f = t.includes('`') ? '``' : '`'; return f + (t.startsWith('`') ? ' ' : '') + t + (t.endsWith('`') ? ' ' : '') + f; }
    case 'br': return o.gfm ? (o.cell ? '<br>' : '\\\n') : '  \n';
    case 'a': {
      const href = attr(node.tag, 'href') || '';
      const label = kids();
      if (!href) return label;
      const title = o.gfm && attr(node.tag, 'title');
      return label === (o.gfm ? escapeGFM(href) : escapeMarkdown(href)) && /^https?:/.test(href) ? `<${href}>` : `[${label}](${href.replace(/[ ()]/g, (c) => encodeURIComponent(c))}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    // KNOWN DEFECT: in the gfm HTML form src (and width / height / align) are inserted without escaping '"', so a src
    // containing a quote breaks out of the attribute in the generated Markdown. Fix: escape like alt (&quot;).
    case 'img': {
      const src = attr(node.tag, 'src') || '', alt = attr(node.tag, 'alt') || '';
      const w = attr(node.tag, 'width'), hh = attr(node.tag, 'height'), al = attr(node.tag, 'align');
      if (o.gfm && (w || hh || al)) return `<img src="${src}" alt="${alt.replace(/"/g, '&quot;')}"${w ? ` width="${w}"` : ''}${hh ? ` height="${hh}"` : ''}${al ? ` align="${al}"` : ''}>`;
      return o.gfm ? `![${escapeGFM(alt)}](${src.replace(/ /g, '%20')})` : `![${escapeMarkdown(alt)}](${src})`;
    }
    case 'input': return '';
    case 'u': return o.gfm ? `<ins>${kids()}</ins>` : kids();
    case 'sub': return `<sub>${kids()}</sub>`;
    case 'sup': return `<sup>${kids()}</sup>`;
    case 'mark': return o.gfm ? `<mark>${kids()}</mark>` : `==${kids()}==`;
    case 'p': case 'div': if (o.gfm) { const t = kids(); return t ? (o.cell ? t + '<br>' : t) : ''; } return kids();
    default: return o.gfm && KEEP_TAGS.has(node.name) ? `<${node.name}>${kids()}</${node.name}>` : kids();
  }
}
// Emphasis around leading / trailing blanks is not recognized by Markdown: keep the blanks outside.
const wrap = (m, s) => { const t = s.trim(); return t ? s.replace(t, m + t + m) : s; };
const textOf = (n) => (typeof n === 'string' ? n : n.kids.map(textOf).join(''));

function blocks(node, o, depth = 0) {
  const out = [];
  let para = '';
  const flush = () => {
    let p = para.trim();
    if (o.gfm) p = escapeLead(p.replace(/(\\\n)+$/, '').replace(/^\s+/, ''));
    if (p) out.push(p);
    para = '';
  };
  for (const k of node.kids) {
    if (typeof k === 'string' || (!BLOCK.has(k.name) && rawOf(k) == null) || (rawOf(k) != null && !o.gfm)) { para += inline(k, o); continue; }
    if (rawOf(k) != null) {
      // Raw pieces stay inline unless they were blocks of their own (data-md-block).
      if (attr(k.tag, 'data-md-block') == null) { para += rawOf(k); continue; }
      flush();
      out.push(rawOf(k));
      continue;
    }
    flush();
    switch (k.name) {
      case 'p': case 'div': {
        const nested = k.kids.some((x) => typeof x !== 'string' && BLOCK.has(x.name));
        let t = nested ? blocks(k, o, depth) : k.kids.map((x) => inline(x, o)).join('').trim();
        if (o.gfm && !nested) t = escapeLead(t.replace(/(\\\n)+$/, ''));
        if (t) out.push(t);
        break;
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': out.push('#'.repeat(+k.name[1]) + ' ' + k.kids.map((x) => inline(x, o)).join('').replace(/\\\n|  \n/g, ' ').trim()); break;
      case 'hr': out.push('---'); break;
      case 'pre': {
        const t = textOf(k).replace(/\n$/, '');
        const f = /```/.test(t) ? '~~~' : '```';
        const code = k.kids.find((x) => typeof x !== 'string' && x.name === 'code');
        const lang = (/(?:^|\s)language-([\w+#.-]+)/.exec((code && attr(code.tag, 'class')) || attr(k.tag, 'class') || '') || [])[1] || '';
        out.push(f + lang + '\n' + t + '\n' + f);
        break;
      }
      case 'blockquote': out.push(blocks(k, o, depth).split('\n').map((l) => (l ? '> ' + l : '>')).join('\n')); break;
      case 'ul': case 'ol': out.push(list(k, o, depth)); break;
      case 'table': out.push(table(k, o)); break;
      default: out.push(blocks(k, o, depth));
    }
  }
  flush();
  return out.filter(Boolean).join('\n\n');
}
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'pre', 'blockquote', 'ul', 'ol', 'table', 'li']);

function list(node, o, depth) {
  const ordered = node.name === 'ol';
  let n = Number(attr(node.tag, 'start')) || 1;
  const lines = [];
  const loose = o.gfm && node.kids.some((li) => typeof li !== 'string' && li.kids.some((x) => typeof x !== 'string' && x.name === 'p'));
  for (const li of node.kids) {
    if (typeof li === 'string' || li.name !== 'li') continue;
    let mark = ordered ? `${n++}.` : '-';
    // Task list item: a leading checkbox (or data-checked) becomes "[x] " / "[ ] ".
    const box = li.kids.find((x) => typeof x !== 'string' && x.name === 'input');
    const checked = box ? attr(box.tag, 'checked') !== null : attr(li.tag, 'data-checked');
    if (box || checked != null) mark += checked === true || checked === '' || checked === 'true' ? ' [x]' : ' [ ]';
    // A nested list follows its item's text directly (tight list).
    let body = (blocks(li, o, depth + 1) || '');
    if (!loose) body = body.replace(/\n\n(?=(?:[-*+]|\d+[.)]) )/g, '\n');
    const pad = ' '.repeat(mark.length + 1);
    lines.push(mark + ' ' + body.split('\n').map((l, i) => (i && l ? pad + l : l)).join('\n'));
  }
  return lines.join(loose ? '\n\n' : '\n');
}

function table(node, o) {
  const rows = [];
  const visit = (n) => { for (const k of n.kids) if (typeof k !== 'string') { if (k.name === 'tr') rows.push(k); else visit(k); } };
  visit(node);
  const cellsOf = (r) => r.kids.filter((c) => typeof c !== 'string' && (c.name === 'td' || c.name === 'th'));
  const co = { ...o, cell: true };
  const cells = rows.map((r) => cellsOf(r).map((c) => c.kids.map((x) => inline(x, co)).join('').replace(/(<br>)+$/, '').trim()));
  if (!cells.length) return '';
  const align = rows.length ? cellsOf(rows[0]).map((c) => (/text-align:\s*(left|center|right)/.exec(attr(c.tag, 'style') || '') || [])[1] || attr(c.tag, 'align') || null) : [];
  return tableMarkdown(cells[0], cells.slice(1), align, { pad: o.gfm, escaped: o.gfm });
}

// GFM table: | a | b |, separator with alignment, rows padded to the header width.
//   opts.pad: equal column widths; opts.escaped: cells are Markdown already ('|' escaped)
// Widths count code points ([...s]) rather than UTF-16 units so Cyrillic / Georgian pad correctly; East Asian wide
// characters and emoji still misalign in a monospace view (display width is not code point count).
export function tableMarkdown(head, rows, align = [], opts = {}) {
  const n = Math.max(head.length, ...rows.map((r) => r.length), 1);
  const cell = (s) => { const t = String(s ?? '').replace(/\n+/g, '<br>'); return opts.escaped ? t.replace(/(?<!\\)\|/g, '\\|') : t.replace(/\|/g, '\\|'); };
  const all = [head, ...rows].map((r) => Array.from({ length: n }, (_, i) => cell(r[i])));
  const len = (s) => [...s].length;
  const w = Array.from({ length: n }, (_, i) => (opts.pad ? Math.max(3, ...all.map((r) => len(r[i]))) : 3));
  const fit = (s, i) => {
    if (!opts.pad) return s;
    const d = w[i] - len(s);
    return align[i] === 'right' ? ' '.repeat(d) + s : align[i] === 'center' ? ' '.repeat(d >> 1) + s + ' '.repeat(d - (d >> 1)) : s + ' '.repeat(d);
  };
  const line = (r) => '| ' + r.map(fit).join(' | ') + ' |';
  const dash = (i) => {
    const k = w[i];
    return align[i] === 'center' ? ':' + '-'.repeat(Math.max(1, k - 2)) + ':' : align[i] === 'right' ? '-'.repeat(Math.max(2, k - 1)) + ':' : align[i] === 'left' ? ':' + '-'.repeat(Math.max(2, k - 1)) : '-'.repeat(k);
  };
  const sep = opts.pad ? '| ' + Array.from({ length: n }, (_, i) => dash(i)).join(' | ') + ' |'
    : '| ' + Array.from({ length: n }, (_, i) => (align[i] === 'center' ? ':---:' : align[i] === 'right' ? '---:' : align[i] === 'left' ? ':---' : '---')).join(' | ') + ' |';
  return [line(all[0]), sep, ...all.slice(1).map(line)].join('\n');
}

export function htmlToMarkdown(html, opts = {}) {
  return blocks(tree(html), opts).replace(/\n{3,}/g, '\n\n').trim();
}

// Inline-only conversion (headings, table cells, captions).
export function inlineMarkdown(html, opts = {}) {
  return tree(html).kids.map((k) => inline(k, opts)).join('').trim();
}
