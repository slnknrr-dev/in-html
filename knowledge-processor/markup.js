// knowledge-processor/markup.js - KP markup: a small wiki-flavoured markup -> safe HTML (Node and browsers). Every
// character of the source is escaped; only the constructs below produce tags, links pass an allowlist.
//
// Blocks (renderBlocks): paragraphs separated by blank lines (a single line break is a <br>), '## Heading' (#, ## ->
// h2, ### -> h3, #### -> h4; part of the table of contents), '- item' / '* item' / '1. item' lists (nested by
// indentation, '- [ ]' / '- [x]' task items), '> quote' lines, '---' rule, ': indented line'.
// Inline (renderInline):
//   **bold**  *italic*  _italic_  ~~strike~~  ==mark==  ^sup^  ,,sub,,  `code`  \x (escape)  <br>
//   [[page]]  [[page|label]]  [[page#Section|label]]  [[#Section]]  [[category:slug]]  [[special:random]]
//   [[media:id|label]]   ([[page]]s blends trailing letters into the label)
//   [label](https://…)   [label](page-slug)   bare https://… links
//   {漢字|かんじ}  ruby (furigana); {漢字|かん|じ} one reading per character; the ruby text joins the base's ruby layer
//   {{ref|note}}  {{ref|name=x|note}}  {{ref|name=x}}  {{ref|group=note|…}}   footnotes / references
//   {{cite|author=…|title=…|work=…|year=…|publisher=…|pages=…|url=…|isbn=…|access=…}}   citation
//   {{layer|id|text}}  text of a toggleable layer       {{spoiler|text}}  click to reveal
//   {{tip|text|tooltip markup}}  {{abbr|IPA|long}}  {{lang|ka|text}}  {{ipa|…}}  {{kbd|…}}  {{small|…}}  {{nowrap|…}}
//   {{placeholder|text}} (also {{todo|…}}): a visible slot to fill in   {{audio|mediaId|label}}: a play button
//   {{br}}
// Context `c` (render.js builds it): link(target, frag) -> { href, cls, title, route, exists }, ext(url) -> safe URL | '',
// media(id) -> { src, type, name } | null, ref(html, name, group) -> marker HTML, heading(text, level) -> { id, html },
// useLayer(id), rubyLayer, t(key), plain (plain-text rendering: refs, layers and tooltips are dropped).
//
//   renderInline(src, c) / renderBlocks(src, c) -> HTML
//   plainText(src, c) -> text (summaries, search)
//   scanLinks(src) -> ['target', …] link targets of [[…]] and [label](slug) (backlinks)
//   parseTemplate(inner) -> { name, args: [positional], named: { key: value } }
//
// Safety model (the reason for the two-phase design): user text is never trusted as HTML.
//   Phase 1 scans the source left to right; every construct that produces markup (links, templates, code, ruby) is
//   rendered immediately to final HTML and replaced in the raw text by an opaque placeholder PH<n>PH.
//   Phase 2 escapes the remaining raw text as a whole, applies the emphasis regexes on the ESCAPED text (they can only
//   wrap text, never open an attribute), then swaps placeholders back. Raw '<', '"' and '&' from the user therefore
//   cannot form a tag, and emphasis cannot reach inside stored HTML because placeholders are opaque to it.
//   The PH character (U+0001) is dropped from the input, so a user cannot forge a placeholder.
// URLs pass an allowlist (http, https, mailto, tel); javascript:, data: and the like never become href values.
// Alternative rejected: markdown-to-HTML then sanitise. Sanitisers are large, and every miss is an XSS; generating only
// known-safe output is smaller and auditable.
import { escapeAttr, escapeHTML } from '../html/escape.js';

const PH = '\u0001';
// Characters a backslash can escape (the markup's own syntax characters); before anything else, a backslash is literal.
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~=^,<>:'"$%&@/]/;
// BCP 47 shape (language + subtags): the value lands raw in a lang attribute, so only this shape is accepted.
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

// Index just after the closer that balances the opener at `i` (`[[`…`]]` or `{{`…`}}`), nested pairs of both kinds
// and backslash escapes respected; -1 when unbalanced.
function findClose(s, i, open) {
  const stack = [open];
  let j = i + 2;
  while (j < s.length) {
    const ch = s[j], two = s.slice(j, j + 2);
    if (ch === '\\') { j += 2; continue; }
    if (two === '[[' || two === '{{') { stack.push(two); j += 2; continue; }
    if (two === ']]' || two === '}}') {
      const want = two === ']]' ? '[[' : '{{';
      if (stack[stack.length - 1] === want) {
        stack.pop();
        j += 2;
        if (!stack.length) return j;
        continue;
      }
    }
    j++;
  }
  return -1;
}

// Splits at top-level '|' (outside nested [[…]] / {{…}} and ruby {…}).
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = '';
  for (let j = 0; j < s.length; j++) {
    const ch = s[j], two = s.slice(j, j + 2);
    if (ch === '\\' && j + 1 < s.length) { cur += ch + s[j + 1]; j++; continue; }
    if (two === '[[' || two === '{{') { depth++; cur += two; j++; continue; }
    if ((two === ']]' || two === '}}') && depth > 0) { depth--; cur += two; j++; continue; }
    if (ch === '{') { depth++; cur += ch; continue; }
    if (ch === '}' && depth > 0) { depth--; cur += ch; continue; }
    if (ch === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// Named arguments are key=value with an identifier key; anything else (including "a = b" with a non-identifier key or
// a URL with '=') stays positional, so text containing '=' is not misread as a named argument.
export function parseTemplate(inner) {
  const parts = splitArgs(inner);
  const name = parts.shift().trim().toLowerCase();
  const args = [], named = {};
  for (const p of parts) {
    const m = /^\s*([a-z][a-z0-9_-]*)\s*=([\s\S]*)$/.exec(p);
    if (m) named[m[1]] = m[2].trim();
    else args.push(p.trim());
  }
  return { name, args, named };
}

// Scheme allowlist plus no whitespace, '<', '>' or '"': the URL is attribute-escaped anyway; this keeps odd URLs
// from producing confusing links.
const isSafeExt = (u) => /^(https?:\/\/|mailto:|tel:)/i.test(u) && !/[\s<>"]/.test(u);

// Citation assembled in a fixed, simplified author-date order. Every field goes through renderInline or escapeHTML.
function citeHTML(n, c) {
  const parts = [];
  const inl = (x) => renderInline(x, c);
  const who = n.author || n.authors || n.editor ? inl(n.author || n.authors || n.editor + ' (ed.)') : '';
  const when = n.year || n.date || '';
  if (who) parts.push(who + (when ? ' (' + escapeHTML(when) + ')' : '') + '.');
  else if (when) parts.push('(' + escapeHTML(when) + ').');
  if (n.title) {
    const url = n.url && isSafeExt(n.url) ? n.url : '';
    const t = n.work || n.journal || n.website || n.publisher ? '“' + inl(n.title) + '”' : '<i>' + inl(n.title) + '</i>';
    parts.push((url && !c.plain ? `<a class="kp-ext" href="${escapeAttr(url)}" rel="noopener" target="_blank">${t}</a>` : t) + '.');
  }
  const work = n.work || n.journal || n.website;
  if (work) parts.push('<i>' + inl(work) + '</i>' + (n.volume ? ' ' + escapeHTML(n.volume) : '') + (n.issue ? ' (' + escapeHTML(n.issue) + ')' : '') + '.');
  const pub = [n.place, n.publisher].filter(Boolean).map(inl).join(': ');
  if (pub) parts.push(pub + '.');
  if (n.pages || n.page) parts.push((n.pages ? 'pp. ' : 'p. ') + escapeHTML(n.pages || n.page) + '.');
  if (n.isbn) parts.push('ISBN ' + escapeHTML(n.isbn) + '.');
  if (n.url && isSafeExt(n.url) && !n.title && !c.plain) parts.push(`<a class="kp-ext" href="${escapeAttr(n.url)}" rel="noopener" target="_blank">${escapeHTML(n.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>.`);
  if (n.access) parts.push('<span class="kp-access">' + escapeHTML((c.t ? c.t('r.accessed') : 'Accessed') + ' ' + n.access) + '.</span>');
  if (n.note || n.quote) parts.push(inl(n.note || n.quote));
  return '<cite class="kp-cite">' + parts.join(' ') + '</cite>';
}

function template(inner, c) {
  const { name, args, named } = parseTemplate(inner);
  const inl = (x) => renderInline(x || '', c);
  switch (name) {
    case 'ref': {
      if (c.plain) return '';
      const content = args.join('|');
      return c.ref ? c.ref(content ? renderInline(content, c) : '', named.name || '', named.group || '') : '';
    }
    case 'cite': return citeHTML(named, c);
    // Layer ids restricted to the id shape before landing raw in data-layer; an invalid id renders the text unlayered
    // rather than dropping it.
    case 'layer': {
      const id = (args[0] || '').trim();
      if (c.plain || !/^[a-z][a-z0-9-]{0,31}$/.test(id)) return c.plain ? '' : inl(args.slice(1).join('|'));
      if (c.useLayer) c.useLayer(id);
      return `<span class="kp-ly" data-layer="${id}">${inl(args.slice(1).join('|'))}</span>`;
    }
    // tabindex + role=button + aria-pressed: the reveal works from the keyboard and is announced as a toggle.
    case 'spoiler': return c.plain ? inl(args.join('|')) : `<span class="kp-spoiler" tabindex="0" role="button" aria-pressed="false">${inl(args.join('|'))}</span>`;
    case 'tip': case 'gloss':
      if (c.plain) return inl(args[0]);
      return `<span class="kp-tip" tabindex="0">${inl(args[0])}<span class="kp-tipb" role="tooltip">${inl(args.slice(1).join('|'))}</span></span>`;
    case 'abbr': return c.plain ? inl(args[0]) : `<abbr title="${escapeAttr(plainText(args.slice(1).join('|'), c))}">${inl(args[0])}</abbr>`;
    case 'lang': {
      const code = (args[0] || '').trim();
      const txt = inl(args.slice(1).join('|'));
      return c.plain || !LANG_RE.test(code) ? txt : `<span lang="${code}">${txt}</span>`;
    }
    case 'ipa': return c.plain ? inl(args.join('|')) : `<span class="kp-ipa">${inl(args.join('|'))}</span>`;
    case 'kbd': return c.plain ? inl(args.join('|')) : `<kbd>${inl(args.join('|'))}</kbd>`;
    case 'small': return c.plain ? inl(args.join('|')) : `<small>${inl(args.join('|'))}</small>`;
    case 'nowrap': return c.plain ? inl(args.join('|')) : `<span class="kp-nowrap">${inl(args.join('|'))}</span>`;
    case 'placeholder': case 'todo': return c.plain ? inl(args.join('|')) : `<span class="kp-ph" title="${escapeAttr(c.t ? c.t('r.placeholder') : 'To fill in')}">${inl(args.join('|'))}</span>`;
    case 'br': return c.plain ? ' ' : '<br>';
    case 'audio': {
      const m = c.media ? c.media((args[0] || '').trim()) : null;
      const label = args[1] ? inl(args.slice(1).join('|')) : '';
      if (c.plain) return label;
      if (!m || !/^audio\//.test(m.type)) return `<span class="kp-say kp-missing">${label || '♪'}</span>`;
      return `<button type="button" class="kp-say" data-kp-audio="${escapeAttr(m.src)}" aria-label="${escapeAttr((c.t ? c.t('r.play') : 'Play') + (label ? '' : ' ' + m.name))}"><span class="kp-say-i" aria-hidden="true"></span>${label}</button>`;
    }
    // Unknown templates are shown as typed (escaped): visible to the author as a mistake, never silently dropped.
    default:
      return escapeHTML('{{' + inner + '}}');
  }
}

// [[page]]s "blends" trailing letters into the label (wiki convention: [[cat]]s shows "cats" linking to cat).
// In plain mode only the text survives. The renderer context decides href, class (existing vs missing page) and route.
function wikiLink(inner, blend, c) {
  const parts = splitArgs(inner);
  let target = parts[0].trim();
  const label = parts.length > 1 ? parts.slice(1).join('|') : '';
  let frag = '';
  const h = target.indexOf('#');
  if (h >= 0) { frag = target.slice(h + 1).trim(); target = target.slice(0, h).trim(); }
  const L = c.link ? c.link(target, frag) : { href: '#', cls: 'kp-link', title: target };
  let text = label ? renderInline(label, c) : escapeHTML(L.label || L.title || target || frag) + (frag && target && !L.label ? ' § ' + escapeHTML(frag) : '');
  if (blend) text += escapeHTML(blend);
  if (c.plain) return text;
  const data = L.route != null ? ` data-kp-route="${escapeAttr(L.route)}"` : '';
  const title = L.hint ? ` title="${escapeAttr(L.hint)}"` : '';
  return `<a class="${L.cls || 'kp-link'}" href="${escapeAttr(L.href)}"${data}${title}${L.download ? ` download="${escapeAttr(L.download)}"` : ''}>${text}</a>`;
}

// Per-character readings only when the count matches the characters exactly; otherwise one reading for the whole
// base. <rp> parentheses show only in browsers without ruby support.
function rubyHTML(base, rt, c) {
  if (c.plain) return escapeHTML(base);
  const layer = c.rubyLayer ? ` data-layer="${c.rubyLayer}"` : '';
  if (c.rubyLayer && c.useLayer) c.useLayer(c.rubyLayer);
  const chars = [...base];
  const rts = rt.split('|');
  if (rts.length > 1 && rts.length === chars.length) {
    return '<ruby>' + chars.map((ch, i) => `${escapeHTML(ch)}<rp>(</rp><rt${layer}>${escapeHTML(rts[i])}</rt><rp>)</rp>`).join('') + '</ruby>';
  }
  return `<ruby>${escapeHTML(base)}<rp>(</rp><rt${layer}>${escapeHTML(rts.join(''))}</rt><rp>)</rp></ruby>`;
}

// keep(html) stores finished HTML and returns its placeholder (see the safety model above).
export function renderInline(src, c = {}) {
  const s = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
  const store = [];
  const keep = (html) => PH + (store.push(html) - 1) + PH;
  let raw = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === PH) { i++; continue; }
    if (ch === '\\' && i + 1 < s.length) {
      const nx = s[i + 1];
      if (nx === '\n') { raw += keep(c.plain ? ' ' : '<br>'); i += 2; continue; }
      if (ESCAPABLE.test(nx)) { raw += keep(escapeHTML(nx)); i += 2; continue; }
    }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) { raw += keep(c.plain ? escapeHTML(s.slice(i + 1, end)) : '<code>' + escapeHTML(s.slice(i + 1, end)) + '</code>'); i = end + 1; continue; }
    }
    // Blend: letters (with combining marks) right after ]] are absorbed into the link label.
    if (ch === '[' && s[i + 1] === '[') {
      const end = findClose(s, i, '[[');
      if (end > 0) {
        const m = /^[\p{L}\p{M}]+/u.exec(s.slice(end));
        const blend = m ? m[0] : '';
        raw += keep(wikiLink(s.slice(i + 2, end - 2), blend, c));
        i = end + blend.length;
        continue;
      }
    }
    if (ch === '{' && s[i + 1] === '{') {
      const end = findClose(s, i, '{{');
      if (end > 0) { raw += keep(template(s.slice(i + 2, end - 2), c)); i = end; continue; }
    }
    // Ruby {base|reading}: single braces, no nesting, one line.
    if (ch === '{') {
      const m = /^\{([^{}|\n]+)\|([^{}\n]+)\}/.exec(s.slice(i));
      if (m) { raw += keep(rubyHTML(m[1], m[2], c)); i += m[0].length; continue; }
    }
    if (ch === '[' && s[i + 1] !== '[') {
      // [label](url): the label may hold nested [[…]] / {{…}}.
      let j = i + 1, depth = 0;
      while (j < s.length) {
        const two = s.slice(j, j + 2);
        if (s[j] === '\\') { j += 2; continue; }
        if (two === '[[' || two === '{{') { depth++; j += 2; continue; }
        if ((two === ']]' || two === '}}') && depth) { depth--; j += 2; continue; }
        if (s[j] === ']' && !depth) break;
        if (s[j] === '\n' && s[j + 1] === '\n') { j = s.length; break; }
        j++;
      }
      if (j < s.length && s[j + 1] === '(') {
        let k = j + 2, par = 1;
        while (k < s.length && par && s[k] !== '\n') { if (s[k] === '(') par++; else if (s[k] === ')') par--; if (par) k++; }
        if (!par) {
          const label = s.slice(i + 1, j), url = s.slice(j + 2, k).trim();
          // [label](url): an allowed external URL -> external link; a scheme-less target -> internal page link; any other
          // scheme (javascript:, data:...) -> the label alone, as plain text.
          if (isSafeExt(url)) {
            raw += keep(c.plain ? renderInline(label, c) : `<a class="kp-ext" href="${escapeAttr(url)}" rel="noopener" target="_blank">${renderInline(label, c) || escapeHTML(url)}</a>`);
          } else if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
            raw += keep(wikiLink(url + '|' + label, '', c));
          } else raw += keep(renderInline(label, c));
          i = k + 1;
          continue;
        }
      }
    }
    if (ch === '<') {
      const m = /^<br\s*\/?>/i.exec(s.slice(i, i + 6));
      if (m) { raw += keep(c.plain ? ' ' : '<br>'); i += m[0].length; continue; }
    }
    raw += ch;
    i++;
  }
  // Emphasis rules: delimiters must hug non-space text (no "a * b * c" accidents); _ must not sit inside a word
  // (snake_case stays literal); single * runs before ** and skips matches starting with *, so **bold** is left for the
  // next rule. Bare URLs are linked last; \u0001 is excluded so a URL never swallows a placeholder.
  let out = escapeHTML(raw);
  if (!c.plain) {
    out = out.replace(/(^|[^\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])/g, (m, a, x) => (x.startsWith('*') ? m : a + '<em>' + x + '</em>'));
    out = out.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>');
    out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>');
    out = out.replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
    out = out.replace(/\^([^\s^]+)\^/g, '<sup>$1</sup>');
    out = out.replace(/,,([^\s,](?:[^,\n]*?[^\s,])?),,/g, '<sub>$1</sub>');
    out = out.replace(/(^|[\s(>])(https?:\/\/[^\s<>"'\u0001]+[^\s<>"'.,;:!?)\]\u0001])/g, (m, a, u) => `${a}<a class="kp-ext" href="${u}" rel="noopener" target="_blank">${u.replace(/^https?:\/\//, '')}</a>`);
    out = out.replace(/\n/g, '<br>');
  } else {
    // Plain mode: the same delimiters are removed so summaries and search text read naturally.
    out = out.replace(/\*\*|~~|==|,,/g, '').replace(/(^|[^\w*])\*(?=\S)([\s\S]*?\S)\*(?!\w)/g, '$1$2').replace(/\^([^\s^]+)\^/g, '$1')
      .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}_])/gu, '$1$2').replace(/\n/g, ' ');
  }
  // Placeholders may nest (labels hold placeholders of their own store), so restore until none is left.
  const re = new RegExp(PH + '(\\d+)' + PH, 'g');
  for (let n = 0; n < 4 && out.includes(PH); n++) out = out.replace(re, (m, k) => store[+k] ?? '');
  return out;
}

// List item: indentation, a bullet (- * +) or a number with . or ), at least one space, the text.
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

// One level per call: items at the first item's indentation (one extra space tolerated); deeper lines belong to the
// current item and are rendered recursively (list or blocks), dedented by their own minimum indentation.
function renderList(lines, c) {
  const first = LIST_RE.exec(lines[0]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  for (const line of lines) {
    const m = LIST_RE.exec(line);
    if (m && m[1].length <= indent + 1 && /\d/.test(m[2]) === ordered) items.push({ text: [m[3]], sub: [] });
    else if (items.length) {
      const cur = items[items.length - 1];
      if (cur.sub.length || (m && m[1].length > indent + 1)) cur.sub.push(line);
      else cur.text.push(line.trim());
    }
  }
  let html = ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>` : '<ul>';
  for (const it of items) {
    let text = it.text.join('\n');
    let pre = '';
    const task = /^\[( |x|X)\]\s+/.exec(text);
    if (task) { text = text.slice(task[0].length); pre = c.plain ? '' : `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> `; }
    let sub = '';
    if (it.sub.length) {
      const subIndent = Math.min(...it.sub.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
      const ded = it.sub.map((l) => l.slice(Math.min(subIndent, /^\s*/.exec(l)[0].length)));
      sub = LIST_RE.test(ded[0]) ? renderList(ded.filter((l) => l.trim()), c) : renderBlocks(ded.join('\n'), c);
    }
    html += `<li${task ? ' class="kp-task"' : ''}>${pre}${renderInline(text, c)}${sub}</li>`;
  }
  return html + (ordered ? '</ol>' : '</ul>');
}

// Line-oriented block parser. '#' maps to h2 at least: h1 is the page title, one per page.
export function renderBlocks(src, c = {}) {
  const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let para = [];
  const flush = () => {
    if (para.length) { html += c.plain ? renderInline(para.join('\n'), c) + '\n' : '<p>' + renderInline(para.join('\n'), c) + '</p>'; para = []; }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { flush(); i++; continue; }
    if ((m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line))) {
      flush();
      const level = Math.max(2, m[1].length);
      if (c.plain) html += renderInline(m[2], c) + '\n';
      else if (c.heading) html += c.heading(m[2], level).html;
      else html += `<h${level}>${renderInline(m[2], c)}</h${level}>`;
      i++;
      continue;
    }
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); if (!c.plain) html += '<hr>'; i++; continue; }
    if (/^>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      html += c.plain ? renderBlocks(q.join('\n'), c) : '<blockquote>' + renderBlocks(q.join('\n'), c) + '</blockquote>';
      continue;
    }
    if (/^:\s?/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^:/.test(lines[i])) q.push(lines[i++].replace(/^:\s?/, ''));
      html += c.plain ? renderInline(q.join('\n'), c) + '\n' : '<div class="kp-indent">' + renderInline(q.join('\n'), c) + '</div>';
      continue;
    }
    // A list may interrupt a paragraph (bullets, or an ordered list that starts at 1).
    if (LIST_RE.test(line) && (!para.length || /^\s*([-*+]|1[.)])\s/.test(line))) {
      const block = [];
      const ordered = /\d/.test(LIST_RE.exec(line)[2]);
      const sameKind = (x) => { const m = LIST_RE.exec(x); return !!m && (m[1].length > 0 || /\d/.test(m[2]) === ordered); };
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line continues the list only when the next line is an item of the same kind or indented.
          const nx = lines[i + 1];
          if (nx !== undefined && (sameKind(nx) || /^\s{2,}\S/.test(nx))) { i++; continue; }
          break;
        }
        if (block.length && LIST_RE.test(l) && !sameKind(l)) break;
        if (block.length && !LIST_RE.test(l) && !/^\s+\S/.test(l) && /^(#{1,4}\s|>|---)/.test(l)) break;
        block.push(l);
        i++;
      }
      flush();
      html += renderList(block, c);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return html;
}

// Not an HTML parser: valid only for the markup this module generates (known tags, escaped text). Block ends become
// spaces so words of adjacent blocks do not fuse.
export function htmlToText(html) {
  return String(html)
    .replace(/<(?:br|\/p|\/li|\/h\d|\/blockquote|\/div|hr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function plainText(src, c = {}) {
  return htmlToText(renderBlocks(src, { ...c, plain: true }).replace(/\n/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Regex scan, not a full render: backlinks are computed for every page on every build, and only the target matters.
// Targets with a scheme (':' excluded in the second pattern) and in-page anchors (#) are not page links.
export function scanLinks(src) {
  const s = String(src == null ? '' : src);
  const out = [];
  for (const m of s.matchAll(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) if (m[1].trim()) out.push(m[1].trim());
  for (const m of s.matchAll(/\]\(([^)\s:]+)\)/g)) if (!/^#/.test(m[1])) out.push(m[1].trim());
  return out;
}
