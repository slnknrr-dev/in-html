// markdown/parse.js - Markdown (CommonMark core + GitHub tables, task lists, strikethrough, autolinks) to a neutral
// block tree with inline content rendered as safe HTML. No raw HTML passes through (it is shown as text).
//
//   parseMarkdown(text) -> [block]
//     { type: 'heading', level, html }          { type: 'paragraph', html }
//     { type: 'code', lang, text }              { type: 'quote', blocks }
//     { type: 'list', ordered, start, items: [{ blocks, checked: null | true | false }] }
//     { type: 'table', align: ['left'|'center'|'right'|null], head: [html], rows: [[html]] }
//     { type: 'hr' }
//   inlineHTML(text) -> safe inline HTML of one Markdown span
//   renderHTML(blocks) -> HTML of a block tree (previews, tests)

//
// Security model: the output is inserted as innerHTML by callers, so every text path ends in esc() and every URL in
// safeHref / safeSrc. Raw HTML in the source is escaped, never passed through (README previews of untrusted files).
// Scope: a pragmatic subset of CommonMark (no link reference definitions, no HTML blocks, simplified delimiter
// rules); markdown/gfm.js is the fuller GitHub renderer. This module stays small for editors and previews.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
// Link targets kept: web, mail, phone, in-page anchors and relative paths (never javascript: / data: …).
// Allowlist, not blocklist: the scheme must be one of the listed ones or the URL must look relative. The extra
// blocklist test is belt and braces for odd spacing. Note '/' admits protocol-relative '//host' links (another
// site, but not script execution).
const safeHref = (u) => {
  const s = String(u || '').trim();
  return /^(https?:|mailto:|tel:|#|\/|\.\.?\/|[\w-][\w./-]*$)/i.test(s) && !/^(javascript|vbscript|data):/i.test(s) ? s : '';
};
// Image sources: the link targets above plus embedded raster images (data:image/…;base64, never SVG).
// SVG is excluded from data: images because an SVG document can carry script when opened directly.
const safeSrc = (u) => {
  const s = String(u || '').trim();
  return /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(s) ? s.replace(/\s+/g, '') : safeHref(s);
};
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»' };
const decodeEnt = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; }
  return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
});

// --- inline ------------------------------------------------------------------------

// Single left-to-right scan producing a token list; emphasis openers are placeholders (text tokens) that a later
// closer rewrites into tags. Unmatched openers simply stay as literal '*' / '_' text, so malformed input never
// produces unbalanced HTML. Entities are decoded and re-escaped at the end: '&lt;' in the source shows as '<'.
export function inlineHTML(src) {
  let s = String(src);
  const out = [];
  let i = 0;
  // Delimiter runs are resolved with a simple stack: ** / __ strong, * / _ em, ~~ strike.
  const stack = [];
  const text = (t) => out.push({ t: 'text', v: t });
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && /[!-\/:-@[-`{-~]/.test(s[i + 1])) { text(s[i + 1]); i += 2; continue; }
    if (c === '\\' && s[i + 1] === '\n') { out.push({ t: 'html', v: '<br>' }); i += 2; continue; }
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      const end = s.indexOf(fence, i + n);
      if (end > 0) {
        let code = s.slice(i + n, end).replace(/\n/g, ' ');
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        out.push({ t: 'html', v: '<code>' + esc(code) + '</code>' });
        i = end + n;
        continue;
      }
      text(fence);
      i += n;
      continue;
    }
    if (c === '<') {
      const m = /^<((?:https?|mailto):[^\s<>]+)>/i.exec(s.slice(i)) || /^<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>/.exec(s.slice(i));
      if (m) {
        const href = /^(https?|mailto):/i.test(m[1]) ? m[1] : 'mailto:' + m[1];
        out.push({ t: 'html', v: `<a href="${esc(href)}">${esc(m[1])}</a>` });
        i += m[0].length;
        continue;
      }
    }
    if (c === '!' && s[i + 1] === '[' || c === '[') {
      const img = c === '!';
      const r = linkAt(s, img ? i + 1 : i);
      if (r) {
        const label = img ? esc(decodeEnt(r.text)) : inlineHTML(r.text);
        const href = img ? safeSrc(r.url) : safeHref(r.url);
        if (img) out.push({ t: 'html', v: href ? `<img src="${esc(href)}" alt="${label}"${r.title ? ` title="${esc(r.title)}"` : ''}>` : label });
        else out.push({ t: 'html', v: href ? `<a href="${esc(href)}"${r.title ? ` title="${esc(r.title)}"` : ''}>${label}</a>` : label });
        i = r.end;
        continue;
      }
    }
    if (c === '*' || c === '_' || c === '~') {
      let n = 1;
      while (s[i + n] === c) n++;
      if (c === '~' && n !== 2) { text(c.repeat(n)); i += n; continue; }
      const prev = i > 0 ? s[i - 1] : ' ';
      const next = s[i + n] || ' ';
      const leftFlank = !/\s/.test(next) && (!/[\p{P}]/u.test(next) || /[\s\p{P}]/u.test(prev));
      const rightFlank = !/\s/.test(prev) && (!/[\p{P}]/u.test(prev) || /[\s\p{P}]/u.test(next));
      // Intraword underscores are literal (snake_case).
      const canOpen = leftFlank && (c !== '_' || !rightFlank || /[\p{P}]/u.test(prev));
      const canClose = rightFlank && (c !== '_' || !leftFlank || /[\p{P}]/u.test(next));
      let left = n;
      while (left > 0) {
        const want = c === '~' ? 2 : left >= 2 ? 2 : 1;
        const k = canClose ? findOpen(stack, c, want) : -1;
        if (k >= 0) {
          const o = stack[k];
          stack.length = k;
          const tag = c === '~' ? 's' : want === 2 ? 'strong' : 'em';
          out[o.at] = { t: 'html', v: `<${tag}>` };
          out.push({ t: 'html', v: `</${tag}>` });
          left -= want;
          continue;
        }
        if (canOpen) {
          for (; left > 0;) {
            const w = c === '~' ? 2 : left >= 2 ? 2 : 1;
            stack.push({ ch: c, n: w, at: out.length });
            out.push({ t: 'text', v: c.repeat(w) });
            left -= w;
          }
        } else { text(c.repeat(left)); left = 0; }
      }
      i += n;
      continue;
    }
    if (c === '\n') {
      // Hard break: two trailing spaces; otherwise a soft break (space).
      const last = out[out.length - 1];
      if (last && last.t === 'text' && / {2,}$/.test(last.v)) { last.v = last.v.replace(/ +$/, ''); out.push({ t: 'html', v: '<br>' }); }
      else text(' ');
      i++;
      continue;
    }
    // Bare URLs (GFM autolink extension).
    const um = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/i.exec(s.slice(i));
    if (um && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      out.push({ t: 'html', v: `<a href="${esc(um[0])}">${esc(um[0])}</a>` });
      i += um[0].length;
      continue;
    }
    // Plain run: stop at any character that may start a construct ('h' for bare http URLs), so the loop above only
    // runs at candidate positions instead of per character.
    let j = i + 1;
    while (j < s.length && !/[\\`<!\[*_~\nh]/.test(s[j])) j++;
    text(s.slice(i, j));
    i = j;
  }
  return out.map((x) => (x.t === 'text' ? esc(decodeEnt(x.v)) : x.v)).join('');
}

function findOpen(stack, ch, n) {
  for (let k = stack.length - 1; k >= 0; k--) if (stack[k].ch === ch && stack[k].n === n) return k;
  return -1;
}

// [text](url "title") starting at s[i] === '[' → { text, url, title, end } or null.
// Bracket matching honours nesting and backslash escapes; the destination allows one level of balanced parentheses
// (Wikipedia-style URLs) or an <angle-bracketed> form with spaces.
function linkAt(s, i) {
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '[') depth++;
    else if (s[j] === ']') { depth--; if (!depth) break; }
  }
  if (depth || s[j + 1] !== '(') return null;
  const m = /^\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/.exec(s.slice(j + 1));
  if (!m) return null;
  return { text: s.slice(i + 1, j), url: m[1].replace(/^<|>$/g, ''), title: m[2] ? m[2].slice(1, -1) : '', end: j + 1 + m[0].length };
}

// --- blocks ------------------------------------------------------------------------

const RE = {
  blank: /^\s*$/,
  atx: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  fence: /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/,
  hr: /^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/,
  quote: /^ {0,3}> ?(.*)$/,
  bullet: /^( {0,3})([-+*])([ \t]+|$)(.*)$/,
  ordered: /^( {0,3})(\d{1,9})([.)])([ \t]+|$)(.*)$/,
  setext: /^ {0,3}(=+|-+)[ \t]*$/,
  tableSep: /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
  indent: /^(?: {4}|\t)(.*)$/,
};

const splitRow = (line) => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
};

// Tabs become 4 spaces up front so indentation rules are pure column arithmetic (a simplification: CommonMark tab
// stops depend on position, and tabs inside code blocks are expanded too).
export function parseMarkdown(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return parseLines(lines);
}

// Line-oriented block parser: each branch consumes the lines of one block and continues. Container blocks (quote,
// list items) strip their markers and recurse on the inner lines, which handles nesting of any depth.
function parseLines(lines) {
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) out.push({ type: 'paragraph', html: inlineHTML(para.join('\n').trim()) });
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (RE.blank.test(line)) { flush(); i++; continue; }
    if ((m = RE.fence.exec(line))) {
      flush();
      const [, ind, fence, lang] = m;
      const body = [];
      i++;
      // The closing fence must use the same character and be at least as long as the opening one; an unclosed fence
      // runs to the end of the document (CommonMark behaviour).
      while (i < lines.length && !new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[i])) {
        body.push(lines[i].replace(new RegExp('^ {0,' + ind.length + '}'), ''));
        i++;
      }
      i++;
      out.push({ type: 'code', lang: lang.toLowerCase(), text: body.join('\n') });
      continue;
    }
    if (!para.length && (m = RE.indent.exec(line))) {
      const body = [];
      while (i < lines.length && (RE.indent.test(lines[i]) || RE.blank.test(lines[i]))) { body.push(lines[i].replace(/^ {4}/, '')); i++; }
      while (body.length && RE.blank.test(body[body.length - 1])) body.pop();
      out.push({ type: 'code', lang: '', text: body.join('\n') });
      continue;
    }
    if ((m = RE.atx.exec(line))) { flush(); out.push({ type: 'heading', level: m[1].length, html: inlineHTML((m[2] || '').trim()) }); i++; continue; }
    if (para.length && (m = RE.setext.exec(line))) {
      out.push({ type: 'heading', level: m[1][0] === '=' ? 1 : 2, html: inlineHTML(para.join('\n').trim()) });
      para = [];
      i++;
      continue;
    }
    if (RE.hr.test(line)) { flush(); out.push({ type: 'hr' }); i++; continue; }
    if (RE.quote.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && (m = RE.quote.exec(lines[i]))) { body.push(m[1]); i++; }
      out.push({ type: 'quote', blocks: parseLines(body) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : null));
      i += 2;
      const rows = [];
      while (i < lines.length && !RE.blank.test(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, k) => inlineHTML(cells[k] || '')));
        i++;
      }
      out.push({ type: 'table', align: head.map((_, k) => align[k] || null), head: head.map(inlineHTML), rows });
      continue;
    }
    if ((m = RE.bullet.exec(line) || RE.ordered.exec(line))) {
      flush();
      const ordered = /\d/.test(m[2]);
      const start = ordered ? parseInt(m[2], 10) : 1;
      const items = [];
      while (i < lines.length) {
        const lm = ordered ? RE.ordered.exec(lines[i]) : RE.bullet.exec(lines[i]);
        if (!lm) break;
        const content = ordered ? lm[5] : lm[4];
        const pad = lm[0].length - content.length;
        const body = [content];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (RE.blank.test(l)) {
            // A blank line continues the item only when the next line is indented under it.
            if (i + 1 < lines.length && /^\s+/.test(lines[i + 1]) && lines[i + 1].search(/\S/) >= Math.min(pad, 4)) { body.push(''); i++; continue; }
            break;
          }
          if ((ordered ? RE.ordered : RE.bullet).test(l) && l.search(/\S/) < pad) break;
          if (l.search(/\S/) >= Math.min(pad, 4)) { body.push(l.slice(Math.min(pad, l.search(/\S/)))); i++; continue; }
          if (RE.hr.test(l) || RE.atx.test(l) || RE.fence.test(l) || RE.quote.test(l) || RE.bullet.test(l) || RE.ordered.test(l)) break;
          body.push(l); // lazy continuation
          i++;
        }
        let checked = null;
        const tm = /^\[([ xX])\][ \t]+/.exec(body[0]);
        if (tm) { checked = tm[1] !== ' '; body[0] = body[0].slice(tm[0].length); }
        items.push({ blocks: parseLines(body), checked, loose: body.some((l) => RE.blank.test(l)) });
        if (i < lines.length && RE.blank.test(lines[i])) {
          const nxt = lines[i + 1] || '';
          if (!(ordered ? RE.ordered : RE.bullet).test(nxt)) break;
          i++;
        }
      }
      out.push({ type: 'list', ordered, start, items });
      continue;
    }
    para.push(line.replace(/^ {0,3}/, ''));
    i++;
  }
  flush();
  return out;
}

// --- HTML ----------------------------------------------------------------------------

export function renderHTML(blocks) {
  return blocks.map((b) => {
    switch (b.type) {
      case 'heading': return `<h${b.level}>${b.html}</h${b.level}>`;
      case 'paragraph': return `<p>${b.html}</p>`;
      case 'code': return `<pre><code${b.lang ? ` class="language-${esc(b.lang)}"` : ''}>${esc(b.text)}</code></pre>`;
      case 'quote': return `<blockquote>${renderHTML(b.blocks)}</blockquote>`;
      case 'hr': return '<hr>';
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = b.items.map((it) => {
          // Tight items: their leading paragraph is inline text (a nested list may follow).
          const lead = !it.loose && it.blocks[0] && it.blocks[0].type === 'paragraph';
          const box = it.checked == null ? '' : `<input type="checkbox" disabled${it.checked ? ' checked' : ''}> `;
          return `<li>${box}${lead ? it.blocks[0].html + renderHTML(it.blocks.slice(1)) : renderHTML(it.blocks)}</li>`;
        }).join('');
        return `<${tag}${b.ordered && b.start !== 1 ? ` start="${b.start}"` : ''}>${items}</${tag}>`;
      }
      case 'table': {
        const al = (k) => (b.align[k] ? ` style="text-align:${b.align[k]}"` : '');
        return '<table><thead><tr>' + b.head.map((c, k) => `<th${al(k)}>${c}</th>`).join('') + '</tr></thead><tbody>'
          + b.rows.map((r) => '<tr>' + r.map((c, k) => `<td${al(k)}>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      }
      default: return '';
    }
  }).join('\n');
}
