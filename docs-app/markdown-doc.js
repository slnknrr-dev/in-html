// docs-app/markdown-doc.js - Markdown ↔ docs documents (no DOM: works in Node and browsers).
//   markdownToDoc(text, { name, lang, files }) -> raw document (headings, text, code, quotes with GitHub alerts,
//                                               checklists, tables, dividers, images and attached files)
//   zipToDoc(bytes, name)                      -> raw document from a "Markdown + files" archive (first .md inside)
//   docToMarkdown(doc, { lang, zip })          -> { md, files: [{ name, data }] } (zip: files/… links, else images
//                                               embedded as data: URIs)
//   docToZip(doc, opts) -> Uint8Array          docToText(doc, opts) -> plain text
//
// Design rules:
// - Pure functions over plain objects (no DOM): importable by templates.js at module load, by tests in Node, and by the
//   editor. Parsing is markdown/parse.js, writing is markdown/write.js; this file maps between Markdown nodes and the
//   docs block model.
// - Lossy by necessity, in a predictable direction: the block model is richer than Markdown in some ways (themes,
//   columns, QR) and poorer in others (no nested block structures inside text blocks). Import folds unsupported
//   structures into the closest rich-text equivalent; export drops what Markdown cannot express rather than emitting
//   HTML, so the output stays plain Markdown readable on any platform.
// - Files: an archive import resolves relative image/link paths against the archive; data: images become attachments.
//   Export either embeds images as data: URIs (single .md) or writes them into files/ (zip).
import { parseMarkdown } from '../markdown/parse.js';
import { escapeMarkdown, htmlToMarkdown, inlineMarkdown, tableMarkdown } from '../markdown/write.js';
import { readZip, writeZip } from '../zip/zip.js';
import { b64decode, b64encode } from '../codec/base64.js';
import { decodeEnt } from '../html/escape.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { emptyCell } from '../doc/table.js';
import { newDoc } from '../doc/model.js';
import { P } from '../doc/product.js';
import { guessLang, langOf } from '../highlight/highlight.js';
import { uid } from '../util/id.js';
import { isObj, own } from '../util/value.js';

const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', zip: 'application/zip', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', webm: 'video/webm',
};
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'text/plain': 'txt', 'text/markdown': 'md' };
// own() reads only own properties, so a name like "constructor.png" cannot hit Object.prototype.
const mimeOfName = (n) => own(EXT_MIME, String(n).split('.').pop().toLowerCase()) || 'application/octet-stream';
const extOfMime = (m) => own(MIME_EXT, m) || (/^[\w-]+\/([\w-]+)/.exec(m) || [])[1] || 'bin';

// CAUTION has no tone of its own and maps to warning; on export warning becomes WARNING (the round trip is lossy here).
// GitHub alerts ⟷ quote tones.
const TONE_OF = { NOTE: 'info', TIP: 'success', IMPORTANT: 'accent', WARNING: 'warning', CAUTION: 'warning' };
const ALERT_OF = { info: 'NOTE', success: 'TIP', accent: 'IMPORTANT', warning: 'WARNING' };

// Document language of imported text by script / frequent words (the user can change it afterwards).
// Heuristic language guess on the first 20 000 characters: script counts decide Georgian / Cyrillic (Ukrainian by its
// letters і ї є ґ), then a few diacritics plus frequent function words for de / fr / es; English otherwise.
function guessDocLang(text) {
  const s = String(text).slice(0, 20000);
  const n = (re) => (s.match(re) || []).length;
  const cyr = n(/[Ѐ-ӿ]/g), geo = n(/[Ⴀ-ჿ]/g), lat = n(/[a-z]/gi);
  if (geo > lat && geo > cyr) return 'ka';
  if (cyr > lat) return /[іїєґ]/i.test(s) ? 'uk' : 'ru';
  const w = (re) => n(re) > 3;
  if (/[äöüß]/i.test(s) && w(/\b(und|der|die|das|nicht|ist)\b/gi)) return 'de';
  if (/[éèàçê]/i.test(s) && w(/\b(le|la|les|des|est|une|et)\b/gi)) return 'fr';
  if (/[ñáéíóú¿¡]/i.test(s) && w(/\b(el|los|las|una|que|está|y)\b/gi)) return 'es';
  return 'en';
}

/* ---------- import ---------- */

// Rich text of the text / quote blocks: the subset the paper text fields keep (h3 / h4, <s>, no images, no inputs).
// Paper text fields keep a small HTML subset: headings collapse to h3/h4, del becomes s, task inputs become ballot box
// characters, remote images become links (local ones only keep their alt text; the http(s) check prevents
// javascript: or data: URLs from becoming links), tables become one paragraph per row.
function richOf(html) {
  return String(html)
    .replace(/<(\/?)del>/g, '<$1s>')
    .replace(/<(\/?)h[1-3]>/g, '<$1h3>').replace(/<(\/?)h[4-6]>/g, '<$1h4>')
    .replace(/<input type="checkbox" disabled( checked)?> ?/g, (m, c) => (c ? '☑ ' : '☐ '))
    .replace(/<img src="([^"]*)" alt="([^"]*)"[^>]*>/g, (m, src, alt) => (/^https?:/i.test(decodeEnt(src)) ? `<a href="${src}">${alt || src}</a>` : alt))
    .replace(/<pre><code class="language-[^"]*">/g, '<pre><code>')
    .replace(/<(\/?)(table|thead|tbody)>/g, '').replace(/<tr>/g, '<p>').replace(/<\/tr>/g, '</p>')
    .replace(/<t[hd][^>]*>/g, '').replace(/<\/t[hd]>/g, ' ');
}

// Block-level Markdown nodes back to HTML for rich fields (the parser's renderer, minus what rich text drops).
function nodesHTML(nodes) {
  return nodes.map((b) => {
    switch (b.type) {
      case 'heading': return `<h${b.level}>${b.html}</h${b.level}>`;
      case 'paragraph': return `<p>${b.html}</p>`;
      // Code text is escaped here because it is raw text in the node, unlike html fields, which the parser already escaped.
      case 'code': return `<pre><code>${b.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</code></pre>`;
      case 'quote': return `<blockquote>${nodesHTML(b.blocks)}</blockquote>`;
      case 'hr': return '<hr>';
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = b.items.map((it) => {
          const box = it.checked == null ? '' : it.checked ? '☑ ' : '☐ ';
          const lead = !it.loose && it.blocks[0] && it.blocks[0].type === 'paragraph';
          return `<li>${box}${lead ? it.blocks[0].html + nodesHTML(it.blocks.slice(1)) : nodesHTML(it.blocks)}</li>`;
        }).join('');
        return `<${tag}${b.ordered && b.start !== 1 ? ` start="${b.start}"` : ''}>${items}</${tag}>`;
      }
      case 'table': return [b.head, ...b.rows].map((r) => `<p>${r.join(' · ')}</p>`).join('');
      default: return '';
    }
  }).join('');
}

// Attachment registry of an import: data: images and files of an archive (path -> bytes).
function fileSink(doc, files) {
  const byPath = new Map();
  const add = (name, mime, bytes, title) => {
    const id = uid();
    // Every imported file is shown by its own image / attachment block: not repeated in the appendix.
    doc.attachments[id] = { id, name, mime, size: bytes.length, data: b64encode(bytes), title, desc: {}, appendix: false };
    return id;
  };
  let n = 0;
  return {
    // src of an image / link -> attachment id (null when it is not a local file).
    file(src, isImage, title = {}) {
      const s = decodeEnt(String(src || ''));
      // Only base64 data: images are accepted inline; anything with a scheme, an absolute path or a fragment is not a local
      // file. Paths are percent-decoded and "./" is stripped so "./img/a.png" and "img/a.png" are the same file.
      const m = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(s);
      if (m && isImage) return add(`image-${++n}.${extOfMime(m[1])}`, m[1], b64decode(m[2]), title);
      if (!files || /^[a-z][\w+.-]*:|^#|^\//i.test(s)) return null;
      let path;
      try { path = decodeURIComponent(s.split(/[?#]/)[0]); } catch { path = s; }
      path = path.replace(/^\.\//, '');
      if (byPath.has(path)) return byPath.get(path);
      const bytes = files.get(path);
      if (!bytes) return null;
      const name = path.split('/').pop();
      const mime = mimeOfName(name);
      // Only raster formats become image blocks; SVG is rejected as an image (it can carry scripts) and stays a link.
      if (isImage && !/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime)) return null;
      const id = add(name, mime, bytes, title);
      byPath.set(path, id);
      return id;
    },
  };
}

function toBlocks(nodes, L, sink) {
  const out = [];
  let rich = '';
  const i18n = (v) => ({ [L]: v });
  // Consecutive paragraphs and lists accumulate into one rich text block (flush on the next structural block): one
  // editable block per prose run is how the editor models text.
  const flush = () => { if (rich) out.push({ type: 'text', id: uid(), html: i18n(rich) }); rich = ''; };
  const push = (b) => { flush(); out.push({ id: uid(), ...b }); };
  for (const b of nodes) {
    switch (b.type) {
      case 'heading':
        push({ type: 'heading', level: Math.min(b.level, 4), text: i18n(htmlToText(b.html)) });
        break;
      case 'paragraph': {
        // A paragraph that is only an image / a link to a local file becomes an image / attachment block.
        const img = /^<img src="([^"]*)" alt="([^"]*)"(?: title="([^"]*)")?>$/.exec(b.html.trim());
        const att = img && sink.file(img[1], true, img[2] ? i18n(decodeEnt(img[2])) : {});
        if (att) { push({ type: 'image', att, caption: img[3] ? i18n(decodeEnt(img[3])) : {}, width: 100, align: 'center' }); break; }
        // [TOC] / [[_TOC_]] markers (Markdown editors, GitLab) become a table of contents.
        if (/^\[\[?_?TOC_?\]\]?$/i.test(b.html.trim())) { push({ type: 'toc', depth: 3, numbered: false }); break; }
        const a = /^<a href="([^"]*)"[^>]*>([\s\S]*)<\/a>$/.exec(b.html.trim());
        const file = a && sink.file(a[1], false, i18n(htmlToText(a[2])));
        if (file) { push({ type: 'attachment', att: file, display: 'card' }); break; }
        rich += `<p>${richOf(b.html)}</p>`;
        break;
      }
      case 'code':
        // Fence language normalised; an unlabelled fence gets a guessed language, an unknown label gets none.
        push({ type: 'code', code: b.text, lang: langOf(b.lang) || (b.lang ? '' : guessLang(b.text)), caption: {} });
        break;
      case 'quote': {
        let inner = b.blocks;
        let tone = 'note';
        const first = inner[0];
        const m = first && first.type === 'paragraph' && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>)?\s*/i.exec(first.html);
        if (m) {
          tone = TONE_OF[m[1].toUpperCase()];
          const rest = first.html.slice(m[0].length);
          inner = rest ? [{ ...first, html: rest }, ...inner.slice(1)] : inner.slice(1);
        }
        push({ type: 'quote', tone, html: i18n(richOf(nodesHTML(inner))) });
        break;
      }
      case 'list':
        // A list where every item is a task becomes a checklist block; mixed lists stay rich text.
        if (b.items.length && b.items.every((it) => it.checked != null)) {
          push({
            type: 'checklist', look: 'boxes',
            items: b.items.map((it) => ({
              id: uid(), done: !!it.checked,
              text: i18n(richOf(it.blocks.filter((x) => x.type === 'paragraph').map((x) => x.html).join('<br>'))),
            })),
          });
        } else rich += richOf(nodesHTML([b]));
        break;
      case 'table': {
        const n = Math.max(b.head.length, ...b.rows.map((r) => r.length));
        const row = (r, th) => Array.from({ length: n }, (_, k) => ({ ...emptyCell(), html: i18n(richOf(r[k] || '')), align: b.align[k] || '', th }));
        // An empty header row (| | |, the Markdown way to write a table without one) is dropped.
        const head = b.head.some((c) => htmlToText(c)) ? [row(b.head, false)] : [];
        push({
          type: 'table', header: head.length ? 'row' : 'none', style: 'grid',
          rows: [...head, ...b.rows.map((r) => row(r, false))], cols: Array.from({ length: n }, () => ({ w: null })),
        });
        break;
      }
      case 'hr':
        push({ type: 'divider', variant: 'solid', thickness: 1 });
        break;
      default:
    }
  }
  flush();
  return out;
}

export function markdownToDoc(text, opts = {}) {
  const src = String(text || '').replace(/^﻿/, '');
  // YAML front matter: only `title` is read (everything else would need a YAML parser and has no block equivalent).
  // Front matter (--- title: … ---) gives the title; the rest is ignored.
  let body = src;
  let fmTitle = '';
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(src.replace(/\r\n?/g, '\n'));
  if (fm) {
    body = src.replace(/\r\n?/g, '\n').slice(fm[0].length);
    fmTitle = (/^title:\s*["']?(.*?)["']?\s*$/m.exec(fm[1]) || [])[1] || '';
  }
  const L = opts.lang || guessDocLang(body);
  const doc = newDoc({ langs: [L], name: opts.name || P.name });
  doc.attachments = {};
  const nodes = parseMarkdown(body);
  doc.regions = { header: [], main: toBlocks(nodes, L, fileSink(doc, opts.files)), side: [] };
  const h1 = doc.regions.main.find((b) => b.type === 'heading' && b.level === 1);
  const title = fmTitle || (h1 && h1.text[L]) || '';
  if (title) doc.meta.title = { [L]: title };
  // Project name: the document title, else the file name.
  if (title) doc.name = title.slice(0, 120);
  return doc;
}

export async function zipToDoc(bytes, name = '') {
  // macOS resource forks (__MACOSX) and dot files are skipped; the shallowest .md wins, index/readme first at equal depth.
  const entries = readZip(bytes).filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
  const mds = entries.filter((e) => /\.(md|markdown)$/i.test(e.name));
  if (!mds.length) return null;
  // The Markdown file closest to the root (README / index first).
  const depth = (e) => e.name.split('/').length * 10 + (/(^|\/)(index|readme)\.md$/i.test(e.name) ? 0 : 1);
  const md = mds.sort((a, b) => depth(a) - depth(b))[0];
  const dir = md.name.includes('/') ? md.name.slice(0, md.name.lastIndexOf('/') + 1) : '';
  const files = new Map();
  for (const e of entries) if (e !== md && e.name.startsWith(dir)) files.set(e.name.slice(dir.length), await e.data());
  const title = md.name.slice(dir.length).replace(/\.(md|markdown)$/i, '');
  const base = String(name).replace(/\.zip$/i, '').replace(/\.md$/i, '');
  return markdownToDoc(await md.text(), { files, name: /^(index|readme)$/i.test(title) ? base || title : title });
}

/* ---------- export ---------- */

// Blocks hidden or restricted to other languages are not exported.
const visible = (b, lang) => !b.hidden && !(Array.isArray(b.langs) && b.langs.length && !b.langs.some((l) => l === lang || l.split('-')[0] === lang.split('-')[0]));

// GitHub heading slugs (lowercase, punctuation dropped, spaces → '-', duplicates numbered).
// Slugs follow GitHub's algorithm so the exported table of contents links work when the file is viewed on GitHub.
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = String(text).toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

function eachBlock(doc, lang, fn) {
  const walk = (list) => {
    for (const b of Array.isArray(list) ? list : []) {
      if (!isObj(b) || !visible(b, lang)) continue;
      fn(b, walk);
    }
  };
  for (const k of ['header', 'main', 'side']) walk(doc.regions && doc.regions[k]);
}

export function docToMarkdown(doc, opts = {}) {
  const lang = opts.lang || doc.defaultLang;
  const tx = (i18n) => pickText(i18n, lang, doc);
  const plain = (i18n) => htmlToText(tx(i18n));
  const files = [];
  const used = new Map();
  // Attachment -> link target (archive path, or a data: URI for embedded images).
  // Archive names: characters illegal on Windows are replaced; collisions get a numeric suffix. Links use encodeURI so
  // spaces in file names survive in Markdown.
  const fileRef = (id, inline) => {
    const a = own(doc.attachments || {}, id);
    if (!a || typeof a.data !== 'string') return null;
    if (!opts.zip) return inline ? `data:${a.mime};base64,${a.data}` : null;
    if (!used.has(id)) {
      let name = a.name.replace(/[\\/:*?"<>|]+/g, '_') || 'file';
      while (files.some((f) => f.name === 'files/' + name)) name = name.replace(/(\.[^.]*)?$/, (e) => '-' + used.size + (e || ''));
      files.push({ name: 'files/' + name, data: b64decode(a.data) });
      used.set(id, 'files/' + encodeURI(name));
    }
    return used.get(id);
  };
  // Two passes: slugs for every heading first (the TOC may come before the headings it links to), then the blocks.
  // Heading slugs first: the table of contents links to them.
  const slug = slugger();
  const slugs = new Map();
  eachBlock(doc, lang, (b, walk) => {
    if (b.type === 'heading') slugs.set(b.id, slug(plain(b.text)));
    if (b.type === 'section' && plain(b.title)) slugs.set(b.id, slug(plain(b.title)));
    walkChildren(b, walk);
  });
  const out = [];
  eachBlock(doc, lang, (b, walk) => {
    const md = blockMarkdown(b, { lang, tx, plain, fileRef, slugs, doc });
    if (md) out.push(md);
    if (b.type === 'section' || b.type === 'columns') walkChildren(b, walk);
  });
  return { md: out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', files };
}

function walkChildren(b, walk) {
  if (b.type === 'section') walk(b.blocks);
  else if (b.type === 'columns') for (const c of b.cols || []) walk(c.blocks);
}

function blockMarkdown(b, x) {
  const { tx, plain, fileRef } = x;
  switch (b.type) {
    case 'heading': { const t = plain(b.text); return t ? '#'.repeat(b.level || 2) + ' ' + escapeMarkdown(t) : ''; }
    case 'section': { const t = plain(b.title); return t ? '## ' + escapeMarkdown(t) : ''; }
    case 'text': return htmlToMarkdown(tx(b.html));
    case 'quote': {
      const body = htmlToMarkdown(tx(b.html));
      if (!body) return '';
      const alert = own(ALERT_OF, b.tone);
      return [...(alert ? [`[!${alert}]`] : []), ...body.split('\n')].map((l) => (l ? '> ' + l : '>')).join('\n');
    }
    case 'code': {
      const code = String(b.code || '').replace(/\n+$/, '');
      if (!code) return '';
      // A fence that cannot collide with the code: ~~~ when the code contains ``` lines.
      // KNOWN DEFECT: code containing both ``` and ~~~ fences still breaks out. Fix: use a backtick fence longer than the
      // longest backtick run in the code (CommonMark allows fences of any length >= 3).
      const fence = /^\s*```/m.test(code) ? '~~~' : '```';
      const cap = plain(b.caption);
      return `${fence}${b.lang || ''}\n${code}\n${fence}` + (cap ? `\n\n*${escapeMarkdown(cap)}*` : '');
    }
    case 'checklist':
      return (b.items || []).map((it) => `- [${it.done ? 'x' : ' '}] ${inlineMarkdown(tx(it.text))}`).join('\n');
    case 'toc': {
      const lines = [];
      let levels = [];
      let from = -1;
      eachBlock(x.doc, x.lang, (h, walk) => {
        if (h.id === b.id) from = levels.length;
        const lv = h.type === 'heading' ? h.level : h.type === 'section' ? 1 : 0;
        if (lv && x.slugs.has(h.id) && lv <= (b.depth || 3)) levels.push([lv, h]);
        walkChildren(h, walk);
      });
      // As in the page: the headings after the table of contents (all of them when it comes last).
      if (from >= 0 && from < levels.length) levels = levels.slice(from);
      const min = Math.min(...levels.map(([lv]) => lv), 4);
      const counters = [0, 0, 0, 0, 0];
      for (const [lv, h] of levels) {
        const d = lv - min;
        counters[d]++;
        const t = plain(h.type === 'heading' ? h.text : h.title);
        lines.push('   '.repeat(d) + (b.numbered ? `${counters[d]}.` : '-') + ` [${escapeMarkdown(t)}](#${x.slugs.get(h.id)})`);
        for (let k = d + 1; k < counters.length; k++) counters[k] = 0;
      }
      const title = plain(b.title);
      return lines.length ? (title ? `**${escapeMarkdown(title)}**\n\n` : '') + lines.join('\n') : '';
    }
    case 'table': {
      const rows = (b.rows || []).map((r) => (r || []).map((c) => (c && !c.m ? inlineMarkdown(tx(c.html)).replace(/\n/g, ' ') : '')));
      if (!rows.length) return '';
      const align = (b.rows[0] || []).map((c) => (c && ['left', 'center', 'right'].includes(c.align) ? c.align : null));
      // Markdown tables need a header row; a table without one gets an empty header.
      const head = b.header === 'row' || b.header === 'both' ? rows.shift() : rows[0].map(() => '');
      const cap = plain(b.caption);
      return tableMarkdown(head, rows, align) + (cap ? `\n\n*${escapeMarkdown(cap)}*` : '');
    }
    case 'divider': return '---';
    case 'image': {
      const a = own(x.doc.attachments || {}, b.att);
      const src = a && fileRef(b.att, true);
      if (!src) return '';
      const cap = plain(b.caption);
      const alt = cap || plain(a.title) || a.name;
      return `![${escapeMarkdown(alt)}](${src})` + (cap ? `\n\n*${escapeMarkdown(cap)}*` : '');
    }
    case 'attachment': {
      const a = own(x.doc.attachments || {}, b.att);
      if (!a) return '';
      const label = plain(b.caption) || plain(a.title) || a.name;
      const href = fileRef(b.att, false);
      return href ? `[${escapeMarkdown(label)}](${href})` : `📎 ${escapeMarkdown(label)}`;
    }
    case 'qr': {
      const u = String(b.url || '');
      // QR blocks become plain links, but only for safe schemes; spaces and parentheses are encoded so the URL cannot end
      // the Markdown link early.
      return /^(https?:|mailto:|tel:)/i.test(u) ? `[${escapeMarkdown(plain(b.label) || u)}](${u.replace(/[ ()]/g, encodeURIComponent)})` : '';
    }
    default: return '';
  }
}

export async function docToZip(doc, opts = {}) {
  const { md, files } = docToMarkdown(doc, { ...opts, zip: true });
  const name = (String(doc.name || 'document').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document') + '.md';
  // Already-compressed images are stored, not deflated again (no size gain, wasted time).
  return writeZip([{ name, data: md }, ...files.map((f) => ({ ...f, store: /^image\/(png|jpeg|gif|webp|avif)$/.test(mimeOfName(f.name)) }))]);
}

// Plain text: Markdown structure without markup (setext-style underlined top headings, bullets kept).
export function docToText(doc, opts = {}) {
  const lang = opts.lang || doc.defaultLang;
  const tx = (i18n) => pickText(i18n, lang, doc);
  const plain = (i18n) => htmlToText(tx(i18n));
  // Minimal HTML-to-text for rich fields: list nesting by depth with bullets, block ends as blank lines, entities
  // decoded last (so "&lt;b&gt;" stays the text "<b>" instead of being treated as a tag).
  const richText = (html) => {
    let depth = 0;
    const s = String(html || '').replace(/<(\/?)(\w+)[^>]*>/g, (m, close, tag) => {
      tag = tag.toLowerCase();
      if (tag === 'ul' || tag === 'ol') { depth = Math.max(0, depth + (close ? -1 : 1)); return close && !depth ? '\n\n' : ''; }
      if (tag === 'li') return close ? '' : '\n' + '  '.repeat(Math.max(0, depth - 1)) + '• ';
      if (tag === 'br') return '\n';
      return close && /^(p|h3|h4|blockquote|pre)$/.test(tag) ? '\n\n' : '';
    });
    return decodeEnt(s.replace(/&nbsp;/g, ' ')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const out = [];
  eachBlock(doc, lang, (b, walk) => {
    let s = '';
    switch (b.type) {
      case 'heading': case 'section': {
        const t = plain(b.type === 'heading' ? b.text : b.title);
        const lv = b.type === 'heading' ? b.level : 2;
        s = t && lv <= 2 ? t + '\n' + (lv === 1 ? '=' : '-').repeat(Math.min(t.length, 72)) : t;
        break;
      }
      case 'text': case 'quote': s = richText(tx(b.html)); break;
      case 'code': s = String(b.code || '').replace(/\n+$/, '').split('\n').map((l) => '    ' + l).join('\n'); break;
      case 'checklist': s = (b.items || []).map((it) => `[${it.done ? 'x' : ' '}] ${htmlToText(tx(it.text))}`).join('\n'); break;
      case 'table': s = (b.rows || []).map((r) => (r || []).filter((c) => c && !c.m).map((c) => htmlToText(tx(c.html))).join('\t')).join('\n'); break;
      case 'divider': s = '* * *'; break;
      case 'image': case 'attachment': { const a = own(doc.attachments || {}, b.att); s = a ? `[${plain(b.caption) || a.name}]` : ''; break; }
      default:
    }
    if (s) out.push(s);
    walkChildren(b, walk);
  });
  return out.join('\n\n').trim() + '\n';
}
