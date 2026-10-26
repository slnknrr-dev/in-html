// site-studio/wiki-blocks.js - the block types of a knowledge base page: schema (the editor builds its forms from
// it, model.js normalizes with it) and string renderers (reader, prerendered pages, backend; Node and browsers).
//
//   BLOCKS[type] = { cat, icon, fields: { key: { k, o?, d?, item?, min?, max? } }, defaults?(), render(b, c) -> html }
//   Field kinds: see model.js (normField). Every block may also carry `layer` (shown with that layer only) and `off`.
//   CATEGORIES: palette order.
// Render context `c` (render.js): inline(src), blocks(src), media(id), link(target, frag), resolve(link), href(route),
// t(key, vars), heading(text, level, anchor), renderList(blocks), pageList(b), layerLabel(id), useLayer(id),
// marker(kind, b), uid(prefix).
import { escapeAttr as attr, escapeHTML as esc } from '../html/escape.js';
import { PORTAL_BLOCKS } from './wiki-blocks-portal.js';

// Design rules:
// - Schema and renderer live together per type: adding a block is one entry here; the editor form (ed-blocks.js),
// normalisation (model.js) and every output (reader, prerender, servers) follow automatically.
// - Renderers are pure string functions (no DOM): the same code runs in Node servers, the static exporter and the
// browser. Interactivity (zoom, flashcards, sorting, audio seeking) is wired later by the reader through data-* and
// class hooks, so the HTML is complete and readable without JS.
// - HTML safety contract for every renderer: user text goes through c.inline / c.blocks (markup renderer, escapes) or
// esc(); attribute values through attr(). Raw interpolation is allowed only for values the schema has already
// constrained: 'select' options (class suffixes such as kp-al-${b.align}), LAYER_RE ids (data-layer), numbers
// clamped by normField. Colours are re-checked with SAFE_COLOR at render time anyway: style="" is an injection sink
// and a renderer may be handed an un-normalised block (editor preview of a block mid-edit).
// - Layer-bound content carries data-layer and calls c.useLayer(id), so the reader shows a toggle only for layers a
// page actually uses.
export const CATEGORIES = ['text', 'wiki', 'media', 'language', 'nav', 'portal', 'layout'];

const SAFE_COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const fmtTime = (t) => { const s = Math.max(0, Math.floor(t || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B');

// <img> of a media item (lazy, with its intrinsic size so the page does not jump).
// width/height attributes reserve the box (aspect-ratio from attributes in modern browsers), so lazy images do not
// shift the layout. loading="lazy" is skipped for blob: and data: sources: they are already in memory, and lazy
// loading would only delay their decode.
export function imgHTML(m, { alt = '', cls = '', sizes = '' } = {}) {
  const a = alt || m.alt || '';
  const dim = m.w && m.h ? ` width="${m.w}" height="${m.h}"` : '';
  return `<img${cls ? ` class="${cls}"` : ''} src="${attr(m.src)}" alt="${attr(a)}"${dim}${/^(blob|data):/.test(m.src) ? '' : ' loading="lazy"'} decoding="async"${sizes}>`;
}

// Element by top-level MIME type. preload="metadata": duration and first frame without downloading the whole file.
// A looping video is forced muted (+autoplay): browsers block autoplay with sound, and an unmuted loop would just
// sit still. Unknown types become a download link with name, type and size, never an <object>/<embed>.
function mediaElement(m, b, c) {
  if (!m) return `<div class="kp-missing">${esc(c.t('r.noMedia'))}</div>`;
  const kind = m.type.split('/')[0];
  if (kind === 'image') return imgHTML(m, { alt: b.alt });
  if (kind === 'audio') return `<audio controls preload="metadata" src="${attr(m.src)}"></audio>`;
  if (kind === 'video') return `<video controls preload="metadata" playsinline src="${attr(m.src)}"${b.loop ? ' loop muted autoplay' : ''}></video>`;
  return `<a class="kp-file" href="${attr(m.src)}" download="${attr(m.name)}"><span class="kp-file-i" aria-hidden="true"></span><span>${esc(m.name)}</span><small>${esc(m.type)} · ${fmtSize(m.size)}</small></a>`;
}

// A figure: the media (zoomable image or a drill-down link) and its caption.
// An image is either a drill-down link (b.link: the picture is a navigation target, e.g. a map to the region page) or
// a zoom button: never both, because one click target cannot mean two things. <button> rather than a clickable
// <img>: keyboard focus and activation for free. The width goes through a custom property (--w), so the CSS keeps
// control of max-width on narrow screens instead of an inline width that would overflow. Credit renders with or
// without a caption: attribution is a licence obligation, not decoration.
function figure(b, c, cls) {
  const m = c.media(b.media);
  const kind = m ? m.type.split('/')[0] : '';
  let inner = mediaElement(m, b, c);
  if (m && kind === 'image') {
    const L = b.link ? c.resolve(b.link) : null;
    if (L) inner = `<a class="kp-drill" href="${attr(L.href)}"${L.route != null ? ` data-kp-route="${attr(L.route)}"` : ''}${L.ext ? ' rel="noopener" target="_blank"' : ''}>${inner}<span class="kp-drill-i" aria-hidden="true"></span></a>`;
    else inner = `<button type="button" class="kp-zoom" data-kp-zoom aria-label="${attr(c.t('r.enlarge'))}">${inner}</button>`;
  }
  const w = b.width > 0 && kind !== 'audio' ? ` style="--w:${Math.round(b.width)}px"` : '';
  const cap = b.caption ? `<figcaption>${c.inline(b.caption)}${m && m.credit ? ` <span class="kp-credit">${c.inline(m.credit)}</span>` : ''}</figcaption>` : m && m.credit ? `<figcaption><span class="kp-credit">${c.inline(m.credit)}</span></figcaption>` : '';
  return `<figure class="kp-fig kp-fig-${kind || 'none'} ${cls}"${w}>${inner}${cap}</figure>`;
}

const listItems = (items) => (Array.isArray(items) ? items : []);

// Shape of a diagram item in viewBox units (x 0..100, y 0..100 * h/w).
// Coordinate system of diagrams: x in 0..100 (percent of width), y stored in 0..100 percent of HEIGHT and scaled by
// ry = h/w into a viewBox of 100 x 100*ry. Percent storage keeps regions valid when the picture is replaced by one
// of another resolution with the same aspect; the viewBox scaling keeps circles round on non-square pictures.
function shapeSVG(it, ry) {
  const y = (v) => (v * ry).toFixed(2);
  switch (it.shape) {
    case 'rect': return `<rect x="${it.x}" y="${y(it.y)}" width="${it.w}" height="${y(it.h)}" rx="0.6"/>`;
    case 'circle': return `<circle cx="${it.x}" cy="${y(it.y)}" r="${it.r}"/>`;
    case 'poly': return it.pts.length > 2 ? `<polygon points="${it.pts.map((p) => p[0] + ',' + y(p[1])).join(' ')}"/>` : '';
    case 'none': return '';
    default: return `<circle class="kp-dot" cx="${it.x}" cy="${y(it.y)}" r="1.1"/>`;
  }
}
// Anchor point of an item (centre of its shape), percent units.
export function itemCenter(it) {
  if (it.shape === 'rect') return [it.x + it.w / 2, it.y + it.h / 2];
  if (it.shape === 'poly' && it.pts.length) return [it.pts.reduce((s, p) => s + p[0], 0) / it.pts.length, it.pts.reduce((s, p) => s + p[1], 0) / it.pts.length];
  return [it.x, it.y];
}
// Point on the border of a shape towards (tx, ty): where a leader line starts.
// Leader lines and edges start at the shape border, not the centre, so arrows do not run under the shape. Math is
// done in isotropic units (dy scaled by ry), then converted back. Rect: scale the direction vector by the smaller of
// the half-extent ratios (ray/box intersection); s >= 1 means the target is inside the box, so start at the centre.
function edgePoint(it, tx, ty, ry) {
  const [cx, cy] = itemCenter(it);
  const dx = tx - cx, dy = (ty - cy) * ry, len = Math.hypot(dx, dy) || 1;
  if (it.shape === 'circle') return [cx + (dx / len) * it.r, cy + ((dy / len) * it.r) / ry];
  if (it.shape === 'rect') {
    const hw = it.w / 2, hh = (it.h / 2) * ry;
    const s = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
    return s < 1 ? [cx + dx * s, cy + (dy * s) / ry] : [cx, cy];
  }
  if (it.shape === 'point' || !it.shape) return [cx + (dx / len) * 1.1, cy + ((dy / len) * 1.1) / ry];
  return [cx, cy];
}

// Layering: background image (or colour) < SVG shapes (aria-hidden, decorative geometry) < HTML labels positioned in
// percent. Labels are HTML, not SVG <text>: they wrap, inherit fonts, take markup and links, and stay accessible.
// The <ol> legend duplicates every label as a plain list: the accessible and print equivalent of the picture, also
// what CSS shows when labels are set to 'numbers'. The SVG <a> regions take tabindex="-1" because the HTML label
// is the keyboard stop for the same link (one tab stop per item).
// The marker id kp-arrow is global: with several diagrams on a page the ids repeat; harmless because every copy
// is identical and the first one wins.
function diagram(b, c) {
  const m = b.media ? c.media(b.media) : null;
  const img = m && m.type.startsWith('image/') ? m : null;
  const [aw, ah] = img && img.w && img.h ? [img.w, img.h] : (b.aspect || '16:9').split(':').map(Number);
  const ry = (ah || 9) / (aw || 16);
  const H = (100 * ry).toFixed(2);
  const items = listItems(b.items);
  const byId = new Map(items.map((it, i) => [it.id || String(i + 1), { it, i }]));
  let svg = '', labels = '', legend = '';
  // Edges (concept maps) under the shapes.
  for (const e of listItems(b.edges)) {
    const a = byId.get(e.from), z = byId.get(e.to);
    if (!a || !z) continue;
    const [x1, y1] = itemCenter(a.it), [x2, y2] = itemCenter(z.it);
    const p1 = edgePoint(a.it, x2, y2, ry), p2 = edgePoint(z.it, x1, y1, ry);
    svg += `<line class="kp-dia-edge${e.style === 'dashed' ? ' kp-dashed' : ''}" x1="${p1[0].toFixed(2)}" y1="${(p1[1] * ry).toFixed(2)}" x2="${p2[0].toFixed(2)}" y2="${(p2[1] * ry).toFixed(2)}"${e.style !== 'line' ? ' marker-end="url(#kp-arrow)"' : ''}/>`;
    if (e.label) labels += `<span class="kp-dia-elbl" style="left:${((p1[0] + p2[0]) / 2).toFixed(2)}%;top:${(((p1[1] + p2[1]) / 2) / 1).toFixed(2)}%">${c.inline(e.label)}</span>`;
  }
  items.forEach((it, i) => {
    const n = i + 1;
    const L = it.link ? c.resolve(it.link) : null;
    const [cx, cy] = itemCenter(it);
    const hasLabelPos = typeof it.lx === 'number' && typeof it.ly === 'number' && it.lx >= 0 && it.ly >= 0;
    const lx = hasLabelPos ? it.lx : cx, ly = hasLabelPos ? it.ly : cy;
    let lead = '';
    if (hasLabelPos && (Math.abs(lx - cx) > 0.5 || Math.abs(ly - cy) > 0.5)) {
      const [sx, sy] = edgePoint(it, lx, ly, ry);
      lead = `<line class="kp-dia-lead" x1="${sx.toFixed(2)}" y1="${(sy * ry).toFixed(2)}" x2="${lx}" y2="${(ly * ry).toFixed(2)}"/><circle class="kp-dia-end" cx="${lx}" cy="${(ly * ry).toFixed(2)}" r="0.45"/>`;
    }
    const color = it.color && SAFE_COLOR.test(it.color) ? ` style="--c:${it.color}"` : '';
    const linkAttrs = L ? ` href="${attr(L.href)}"${L.route != null ? ` data-kp-route="${attr(L.route)}"` : ''}${L.ext ? ' rel="noopener" target="_blank"' : ''}` : '';
    const label = it.label ? c.inline(it.label) : String(n);
    const note = it.note ? `<span class="kp-dia-note" role="tooltip">${c.inline(it.note)}</span>` : '';
    const shape = shapeSVG(it, ry);
    // The shape is a link (clickable region); without a link it reveals the note.
    svg += `<g class="kp-dia-it" data-i="${n}"${color}>${L ? `<a${linkAttrs} aria-label="${attr(c.plainOf(it.label) || String(n))}" tabindex="-1">${shape}</a>` : shape}${lead}</g>`;
    const side = hasLabelPos ? (lx < cx - 0.5 ? ' kp-l' : lx > cx + 0.5 ? ' kp-r' : ly < cy ? ' kp-t' : ' kp-b') : ' kp-c';
    const tag = L ? 'a' : 'span';
    labels += `<${tag} class="kp-dia-lbl${side}${it.shape === 'none' ? ' kp-node' : ''}" data-i="${n}" style="left:${lx}%;top:${(ly / 1).toFixed(2)}%"${color}${L ? linkAttrs : ' tabindex="0"'}><span class="kp-dia-n">${n}</span><span class="kp-dia-t">${label}</span>${note}</${tag}>`;
    legend += `<li data-i="${n}"${color}>${L ? `<a${linkAttrs}>${label}</a>` : `<span>${label}</span>`}${it.note ? ` — ${c.inline(it.note)}` : ''}</li>`;
  });
  const bg = img ? imgHTML(img, { alt: b.alt || img.alt, cls: 'kp-dia-img' }) : `<div class="kp-dia-bg"${b.bg && SAFE_COLOR.test(b.bg) ? ` style="background:${b.bg}"` : ''}></div>`;
  const w = b.width > 0 ? ` style="--w:${Math.round(b.width)}px"` : '';
  return `<figure class="kp-dia kp-dia-${b.labels} kp-al-${b.align}"${w}><div class="kp-dia-stage" style="aspect-ratio:${aw || 16}/${ah || 9}">${bg}` +
    `<svg class="kp-dia-svg" viewBox="0 0 100 ${H}" aria-hidden="true" focusable="false"><defs><marker id="kp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>${svg}</svg>` +
    `${labels}</div><ol class="kp-dia-legend">${legend}</ol>${b.caption ? `<figcaption>${c.inline(b.caption)}</figcaption>` : ''}</figure>`;
}

// Stanzas split on blank lines, lines on single newlines. Numbering is by data-n (CSS ::before), so copied text
// does not carry line numbers. n is reset before the translation so both columns number the same lines alike.
// '&nbsp;' keeps an empty line's height.
function verse(b, c) {
  let n = 0;
  const lines = (txt, numbered) => txt.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((st) => '<div class="kp-stanza">' + st.split('\n').map((l) => {
    n++;
    const show = numbered === 'all' || (numbered === 'five' && n % 5 === 0);
    return `<span class="kp-vl"${show ? ` data-n="${n}"` : ''}>${c.inline(l) || '&nbsp;'}</span>`;
  }).join('') + '</div>').join('');
  const main = lines(b.text, b.numbers);
  n = 0;
  const tr = b.translation ? `<div class="kp-verse-tr"${b.trLayer ? ` data-layer="${b.trLayer}"` : ''}>${lines(b.translation, b.numbers)}</div>` : '';
  if (b.trLayer) c.useLayer(b.trLayer);
  return `<figure class="kp-verse${tr ? ' kp-verse-2' : ''}">${b.title ? `<figcaption class="kp-verse-title">${c.inline(b.title)}</figcaption>` : ''}<div class="kp-verse-cols"><div class="kp-verse-src"${b.lang ? ` lang="${attr(b.lang)}"` : ''}>${main}</div>${tr}</div>${b.source ? `<div class="kp-verse-src-note">${c.inline(b.source)}</div>` : ''}</figure>`;
}

// Each line has the source text plus one cell per tier (layer). A time code turns into a play button only when the
// block has audio; data-t on the line lets the reader highlight the current line during playback. --cols feeds a CSS
// grid for the 'columns' and 'table' styles; 'stacked' uses data-label so each tier is labelled inline instead.
function interlinear(b, c) {
  const tiers = (b.tiers || []).filter(Boolean);
  for (const t of tiers) c.useLayer(t);
  const m = b.audio ? c.media(b.audio) : null;
  const audio = m && /^(audio|video)\//.test(m.type) ? `<audio class="kp-il-audio" controls preload="metadata" src="${attr(m.src)}"></audio>` : '';
  const head = b.style === 'table' ? `<li class="kp-il-line kp-il-head" aria-hidden="true"><div class="kp-il-src">${esc(c.t('r.original'))}</div>${tiers.map((t) => `<div class="kp-il-tier" data-layer="${t}">${esc(c.layerLabel(t))}</div>`).join('')}</li>` : '';
  const lines = listItems(b.items).map((it, i) => {
    const t = typeof it.t === 'number' && it.t >= 0 && audio ? it.t : null;
    const play = t != null ? `<button type="button" class="kp-il-play" data-t="${t}" aria-label="${attr(c.t('r.playFrom', { t: fmtTime(t) }))}">${fmtTime(t)}</button>` : '';
    const cells = tiers.map((tid) => `<div class="kp-il-tier" data-layer="${tid}"${b.style === 'stacked' ? ` data-label="${attr(c.layerLabel(tid))}"` : ''}>${c.inline((it.tiers || {})[tid] || '')}</div>`).join('');
    return `<li class="kp-il-line"${t != null ? ` data-t="${t}"` : ''}${b.numbered ? ` data-n="${i + 1}"` : ''}>${play}<div class="kp-il-src"${b.lang ? ` lang="${attr(b.lang)}"` : ''}>${c.inline(it.text)}</div>${cells}</li>`;
  }).join('');
  const cols = b.style !== 'stacked' ? ` style="--cols:${tiers.length + 1}"` : '';
  return `<section class="kp-il kp-il-${b.style}"${cols}>${b.title ? `<div class="kp-il-title">${c.inline(b.title)}</div>` : ''}${audio}<ol class="kp-il-lines">${head}${lines}</ol></section>`;
}

// Columns appear only if at least one item fills them: an empty "note" column would waste width on every row.
function glossary(b, c) {
  const cols = [['term', 'r.term', ''], ['reading', 'r.reading', b.readingLayer], ['meaning', 'r.meaning', b.meaningLayer], ['note', 'r.note', b.noteLayer]];
  const items = listItems(b.items);
  const used = cols.filter(([k]) => k === 'term' || items.some((it) => it[k]));
  for (const [, , l] of used) if (l) c.useLayer(l);
  const cell = (it, k) => {
    if (k !== 'term') return c.inline(it[k]);
    let t = c.inline(it.term);
    if (it.link) { const L = c.resolve(it.link); if (L) t = `<a class="kp-link" href="${attr(L.href)}"${L.route != null ? ` data-kp-route="${attr(L.route)}"` : ''}>${t}</a>`; }
    const m = it.audio ? c.media(it.audio) : null;
    if (m && m.type.startsWith('audio/')) t += ` <button type="button" class="kp-say" data-kp-audio="${attr(m.src)}" aria-label="${attr(c.t('r.play'))}"><span class="kp-say-i" aria-hidden="true"></span></button>`;
    return t;
  };
  if (b.layout === 'cards') {
    return `<div class="kp-gloss-cards">${b.title ? `<div class="kp-gloss-title">${c.inline(b.title)}</div>` : ''}${items.map((it) => `<div class="kp-gcard">${used.map(([k, , l]) => `<div class="kp-g-${k}"${l ? ` data-layer="${l}"` : ''}${k === 'term' && b.lang ? ` lang="${attr(b.lang)}"` : ''}>${cell(it, k)}</div>`).join('')}</div>`).join('')}</div>`;
  }
  return `<div class="kp-table-wrap"><table class="kp-table kp-gloss">${b.title ? `<caption>${c.inline(b.title)}</caption>` : ''}<thead><tr>${used.map(([k, key, l]) => `<th scope="col"${l ? ` data-layer="${l}"` : ''}>${esc(c.t(key))}</th>`).join('')}</tr></thead><tbody>${items.map((it) => `<tr>${used.map(([k, , l]) => `<td class="kp-g-${k}"${l ? ` data-layer="${l}"` : ''}${k === 'term' && b.lang ? ` lang="${attr(b.lang)}"` : ''}>${cell(it, k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// scope on header cells (col for the header row, row for the header column) lets screen readers announce headers.
// Numeric cells (digits, separators, optional sign or %) get kp-num for right alignment and tabular figures; the
// minus sign U+2212 is accepted too.
function table(b, c) {
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const headRow = b.head === 'row' || b.head === 'both';
  const headCol = b.head === 'col' || b.head === 'both';
  const cellHTML = (txt, r, ci) => {
    const isTh = (headRow && r === 0) || (headCol && ci === 0);
    const tag = isTh ? 'th' : 'td';
    const scope = isTh ? ` scope="${headRow && r === 0 ? 'col' : 'row'}"` : '';
    const num = !isTh && /^[-+−]?[\d\s.,]+%?$/.test(txt.trim()) && txt.trim() ? ' class="kp-num"' : '';
    return `<${tag}${scope}${num}>${c.inline(txt)}</${tag}>`;
  };
  const body = rows.map((row, r) => `<tr>${row.map((txt, ci) => cellHTML(txt, r, ci)).join('')}</tr>`);
  const thead = headRow && body.length ? `<thead>${body.shift()}</thead>` : '';
  return `<div class="kp-table-wrap"><table class="kp-table${b.sortable ? ' kp-sortable' : ''}${b.striped ? ' kp-striped' : ''}${b.compact ? ' kp-compact' : ''}">${b.caption ? `<caption>${c.inline(b.caption)}</caption>` : ''}${thead}<tbody>${body.join('')}</tbody></table></div>`;
}

// External links open in a new tab with rel=noopener (the opened page gets no window.opener handle). A link that
// does not resolve renders its label as text: a broken target must not silently disappear the label.
const linkHTML = (c, link, label) => {
  const L = c.resolve(link);
  if (!L) return label ? c.inline(label) : '';
  const text = label ? c.inline(label) : esc(L.title || link);
  return `<a class="${L.cls || 'kp-link'}" href="${attr(L.href)}"${L.route != null ? ` data-kp-route="${attr(L.route)}"` : ''}${L.ext ? ' rel="noopener" target="_blank"' : ''}>${text}</a>`;
};

// Field descriptors: k = kind (model.js normField), o = options of a select (the first is the default), d = default,
// min/max = clamps. defaults() supplies initial values that differ from the per-kind default (a new table starts
// 2x2, a new pagelist with summaries on).
export const BLOCKS = {
  // ---- text
  text: {
    cat: 'text', icon: 'type',
    fields: { text: { k: 'text' } },
    render: (b, c) => `<div class="kp-text">${c.blocks(b.text)}</div>`,
  },
  heading: {
    cat: 'text', icon: 'heading',
    fields: { text: { k: 'line' }, level: { k: 'select', o: ['2', '3', '4'] }, anchor: { k: 'plain' } },
    render: (b, c) => c.heading(b.text, +b.level, b.anchor).html,
  },
  quote: {
    cat: 'text', icon: 'quote',
    fields: { text: { k: 'text' }, author: { k: 'line' }, source: { k: 'line' }, style: { k: 'select', o: ['block', 'pull', 'epigraph'] } },
    render: (b, c) => `<blockquote class="kp-quote kp-q-${b.style}">${c.blocks(b.text)}${b.author || b.source ? `<footer>— ${c.inline(b.author)}${b.author && b.source ? ', ' : ''}${b.source ? `<cite>${c.inline(b.source)}</cite>` : ''}</footer>` : ''}</blockquote>`,
  },
  verse: {
    cat: 'text', icon: 'list',
    fields: { title: { k: 'line' }, text: { k: 'text' }, translation: { k: 'text' }, trLayer: { k: 'layer' }, numbers: { k: 'select', o: ['none', 'five', 'all'] }, lang: { k: 'plain' }, source: { k: 'line' } },
    render: verse,
  },
  callout: {
    cat: 'text', icon: 'info',
    fields: { kind: { k: 'select', o: ['note', 'info', 'tip', 'warning', 'stub', 'spoiler', 'important'] }, title: { k: 'line' }, text: { k: 'text' }, collapsible: { k: 'bool' } },
    render: (b, c) => {
      const title = b.title ? c.inline(b.title) : esc(c.t('r.callout.' + b.kind));
      if (b.collapsible || b.kind === 'spoiler') return `<details class="kp-callout kp-co-${b.kind}"><summary class="kp-co-t">${title}</summary><div class="kp-co-b">${c.blocks(b.text)}</div></details>`;
      return `<aside class="kp-callout kp-co-${b.kind}" role="note"><div class="kp-co-t">${title}</div><div class="kp-co-b">${c.blocks(b.text)}</div></aside>`;
    },
  },
  details: {
    cat: 'text', icon: 'chevDown',
    fields: { summary: { k: 'line' }, text: { k: 'text' }, open: { k: 'bool' } },
    render: (b, c) => `<details class="kp-details"${b.open ? ' open' : ''}><summary>${c.inline(b.summary) || esc(c.t('r.more'))}</summary><div>${c.blocks(b.text)}</div></details>`,
  },
  code: {
    cat: 'text', icon: 'terminal',
    fields: { code: { k: 'plain', max: 100000 }, lang: { k: 'plain' }, caption: { k: 'line' } },
    render: (b, c) => `<figure class="kp-codefig"><pre class="kp-code"${b.lang ? ` data-lang="${attr(b.lang)}"` : ''}><code>${esc(b.code)}</code></pre>${b.caption ? `<figcaption>${c.inline(b.caption)}</figcaption>` : ''}</figure>`,
  },
  divider: {
    cat: 'text', icon: 'divider',
    fields: { style: { k: 'select', o: ['line', 'stars', 'space'] } },
    render: (b) => (b.style === 'stars' ? '<div class="kp-stars" role="separator">* * *</div>' : b.style === 'space' ? '<div class="kp-space"></div>' : '<hr class="kp-hr">'),
  },

  // ---- wiki invariants
  infobox: {
    cat: 'wiki', icon: 'keyvalue',
    fields: {
      title: { k: 'line' }, subtitle: { k: 'line' }, image: { k: 'media' }, caption: { k: 'line' },
      rows: { k: 'list', item: { label: { k: 'line' }, value: { k: 'text' }, header: { k: 'bool' }, layer: { k: 'layer' } } },
      align: { k: 'select', o: ['right', 'left', 'center'] }, color: { k: 'color' }, width: { k: 'num', d: 0, min: 0, max: 600 },
    },
    render: (b, c) => {
      const m = b.image ? c.media(b.image) : null;
      const rows = listItems(b.rows).map((r) => {
        const ly = r.layer ? ` data-layer="${r.layer}"` : '';
        if (r.layer) c.useLayer(r.layer);
        if (r.header) return `<tr class="kp-ib-h"${ly}><th colspan="2" scope="colgroup">${c.inline(r.label || r.value)}</th></tr>`;
        if (!r.label) return `<tr${ly}><td colspan="2" class="kp-ib-full">${c.inline(r.value)}</td></tr>`;
        return `<tr${ly}><th scope="row">${c.inline(r.label)}</th><td>${c.inline(r.value)}</td></tr>`;
      }).join('');
      const style = (b.color && SAFE_COLOR.test(b.color) ? `--ib:${b.color};` : '') + (b.width ? `--ibw:${b.width}px;` : '');
      const img = m ? `<figure class="kp-ib-img">${m.type.startsWith('image/') ? `<button type="button" class="kp-zoom" data-kp-zoom aria-label="${attr(c.t('r.enlarge'))}">${imgHTML(m)}</button>` : mediaElement(m, b, c)}${b.caption ? `<figcaption>${c.inline(b.caption)}</figcaption>` : ''}</figure>` : '';
      return `<aside class="kp-infobox kp-al-${b.align}"${style ? ` style="${style}"` : ''}>${b.title ? `<div class="kp-ib-title">${c.inline(b.title)}</div>` : ''}${b.subtitle ? `<div class="kp-ib-sub">${c.inline(b.subtitle)}</div>` : ''}${img}${rows ? `<table><tbody>${rows}</tbody></table>` : ''}</aside>`;
    },
  },
  hatnote: {
    cat: 'wiki', icon: 'info',
    fields: { kind: { k: 'select', o: ['about', 'main', 'see', 'further', 'custom'] }, text: { k: 'line' } },
    render: (b, c) => `<div class="kp-hatnote" role="note">${b.kind === 'about' || b.kind === 'custom' ? '' : esc(c.t('r.hat.' + b.kind)) + ' '}${c.inline(b.text)}</div>`,
  },
  toc: {
    cat: 'wiki', icon: 'list',
    fields: { title: { k: 'line' }, depth: { k: 'select', o: ['3', '2', '4'] }, float: { k: 'select', o: ['none', 'right'] } },
    render: (b, c) => c.marker('toc', b),
  },
  references: {
    cat: 'wiki', icon: 'hash',
    fields: { title: { k: 'line' }, group: { k: 'plain' }, cols: { k: 'select', o: ['1', '2'] }, heading: { k: 'bool', d: true } },
    defaults: () => ({ heading: true }),
    render: (b, c) => c.marker('refs', b),
  },
  seealso: {
    cat: 'wiki', icon: 'link',
    fields: { title: { k: 'line' }, items: { k: 'list', item: { link: { k: 'link' }, label: { k: 'line' }, note: { k: 'line' } } } },
    render: (b, c) => `${c.heading(b.title || c.t('r.seeAlso'), 2).html}<ul class="kp-seealso">${listItems(b.items).map((it) => `<li>${linkHTML(c, it.link, it.label)}${it.note ? ` — ${c.inline(it.note)}` : ''}</li>`).join('')}</ul>`,
  },
  navbox: {
    cat: 'wiki', icon: 'grid',
    fields: { title: { k: 'line' }, groups: { k: 'list', item: { label: { k: 'line' }, links: { k: 'text' } } }, collapsed: { k: 'bool' }, color: { k: 'color' } },
    render: (b, c) => `<nav class="kp-navbox" aria-label="${attr(c.plainOf(b.title) || c.t('r.navbox'))}"${b.color && SAFE_COLOR.test(b.color) ? ` style="--nb:${b.color}"` : ''}><details${b.collapsed ? '' : ' open'}><summary class="kp-nb-title">${c.inline(b.title) || esc(c.t('r.navbox'))}</summary><table><tbody>${listItems(b.groups).map((g) => `<tr>${g.label ? `<th scope="row">${c.inline(g.label)}</th>` : ''}<td${g.label ? '' : ' colspan="2"'}>${c.inline(g.links.replace(/\s*\n\s*/g, ' · '))}</td></tr>`).join('')}</tbody></table></details></nav>`,
  },
  disambig: {
    cat: 'wiki', icon: 'list',
    fields: { intro: { k: 'line' }, items: { k: 'list', item: { link: { k: 'link' }, label: { k: 'line' }, desc: { k: 'line' } } } },
    render: (b, c) => `<div class="kp-disambig">${b.intro ? `<p>${c.inline(b.intro)}</p>` : ''}<ul>${listItems(b.items).map((it) => `<li>${linkHTML(c, it.link, it.label)}${it.desc ? `, ${c.inline(it.desc)}` : ''}</li>`).join('')}</ul></div>`,
  },
  table: {
    cat: 'wiki', icon: 'table',
    fields: { caption: { k: 'line' }, rows: { k: 'grid' }, head: { k: 'select', o: ['row', 'none', 'col', 'both'] }, sortable: { k: 'bool' }, striped: { k: 'bool' }, compact: { k: 'bool' } },
    defaults: () => ({ rows: [['', ''], ['', '']] }),
    render: table,
  },
  timeline: {
    cat: 'wiki', icon: 'timeline',
    fields: { title: { k: 'line' }, items: { k: 'list', item: { date: { k: 'line' }, title: { k: 'line' }, text: { k: 'text' }, link: { k: 'link' } } }, style: { k: 'select', o: ['line', 'compact'] } },
    render: (b, c) => `<section class="kp-timeline kp-tl-${b.style}">${b.title ? `<div class="kp-tl-title">${c.inline(b.title)}</div>` : ''}<ol>${listItems(b.items).map((it) => `<li><div class="kp-tl-date">${c.inline(it.date)}</div><div class="kp-tl-body">${it.title ? `<div class="kp-tl-t">${it.link ? linkHTML(c, it.link, it.title) : c.inline(it.title)}</div>` : ''}${it.text ? c.blocks(it.text) : ''}</div></li>`).join('')}</ol></section>`,
  },
  pagelist: {
    cat: 'nav', icon: 'stack',
    fields: {
      title: { k: 'line' }, source: { k: 'select', o: ['children', 'category', 'links', 'recent', 'all'] }, category: { k: 'plain' },
      links: { k: 'list', item: { link: { k: 'link' } } }, style: { k: 'select', o: ['list', 'cards', 'columns', 'hero', 'compact'] },
      limit: { k: 'num', d: 12, min: 1, max: 200 }, summary: { k: 'bool', d: true }, sort: { k: 'select', o: ['title', 'date', 'order'] },
    },
    defaults: () => ({ summary: true, limit: 12 }),
    render: (b, c) => c.pageList(b),
  },

  // ---- media
  media: {
    cat: 'media', icon: 'image',
    fields: {
      media: { k: 'media' }, caption: { k: 'line' }, alt: { k: 'plain' }, link: { k: 'link' },
      align: { k: 'select', o: ['right', 'left', 'center', 'full'] }, width: { k: 'num', d: 0, min: 0, max: 2000 },
      text: { k: 'text' }, layout: { k: 'select', o: ['float', 'split'] }, frame: { k: 'select', o: ['thumb', 'plain', 'border'] }, loop: { k: 'bool' },
    },
    render: (b, c) => {
      const fig = figure(b, c, `kp-al-${b.align} kp-fr-${b.frame}`);
      if (!b.text) return fig;
      if (b.layout === 'split') return `<div class="kp-split kp-split-${b.align === 'left' ? 'left' : 'right'}">${fig}<div class="kp-split-text">${c.blocks(b.text)}</div></div>`;
      return `<div class="kp-flow">${fig}${c.blocks(b.text)}</div>`;
    },
  },
  gallery: {
    cat: 'media', icon: 'gallery',
    fields: { title: { k: 'line' }, items: { k: 'list', item: { media: { k: 'media' }, caption: { k: 'line' }, link: { k: 'link' } } }, style: { k: 'select', o: ['grid', 'packed', 'slider'] }, size: { k: 'select', o: ['m', 's', 'l'] } },
    render: (b, c) => `<section class="kp-gallery kp-g-${b.style} kp-g-${b.size}">${b.title ? `<div class="kp-g-title">${c.inline(b.title)}</div>` : ''}<div class="kp-g-items">${listItems(b.items).map((it) => figure({ media: it.media, caption: it.caption, link: it.link, width: 0 }, c, 'kp-g-item')).join('')}</div></section>`,
  },
  diagram: {
    cat: 'media', icon: 'pin',
    fields: {
      media: { k: 'media' }, alt: { k: 'plain' }, caption: { k: 'line' }, aspect: { k: 'select', o: ['16:9', '4:3', '1:1', '3:4', '2:1', '3:2'] }, bg: { k: 'color' },
      labels: { k: 'select', o: ['always', 'hover', 'numbers'] }, align: { k: 'select', o: ['center', 'right', 'left', 'full'] }, width: { k: 'num', d: 0, min: 0, max: 2000 },
      items: { k: 'list', item: {
        id: { k: 'plain' }, shape: { k: 'select', o: ['point', 'rect', 'circle', 'poly', 'none'] }, x: { k: 'num', d: 50, min: 0, max: 100 }, y: { k: 'num', d: 50, min: 0, max: 100 },
        w: { k: 'num', d: 10, min: 0, max: 100 }, h: { k: 'num', d: 10, min: 0, max: 100 }, r: { k: 'num', d: 5, min: 0, max: 100 }, pts: { k: 'pts' },
        lx: { k: 'num', d: null, min: -1, max: 100 }, ly: { k: 'num', d: null, min: -1, max: 100 }, label: { k: 'line' }, link: { k: 'link' }, note: { k: 'line' }, color: { k: 'color' },
      } },
      edges: { k: 'list', item: { from: { k: 'plain' }, to: { k: 'plain' }, label: { k: 'line' }, style: { k: 'select', o: ['arrow', 'line', 'dashed'] } } },
    },
    render: diagram,
  },
  banner: {
    cat: 'media', icon: 'hero',
    fields: { title: { k: 'line' }, text: { k: 'text' }, media: { k: 'media' }, link: { k: 'link' }, button: { k: 'line' }, style: { k: 'select', o: ['overlay', 'split', 'plain'] }, color: { k: 'color' } },
    render: (b, c) => {
      const m = b.media ? c.media(b.media) : null;
      const L = b.link ? c.resolve(b.link) : null;
      const img = m && m.type.startsWith('image/') ? imgHTML(m, { cls: 'kp-ban-img' }) : '';
      const btn = L ? `<a class="kp-btn" href="${attr(L.href)}"${L.route != null ? ` data-kp-route="${attr(L.route)}"` : ''}>${c.inline(b.button) || esc(c.t('r.readMore'))}</a>` : '';
      return `<section class="kp-banner kp-ban-${b.style}${img ? '' : ' kp-ban-noimg'}"${b.color && SAFE_COLOR.test(b.color) ? ` style="--ban:${b.color}"` : ''}>${img}<div class="kp-ban-body">${b.title ? `<div class="kp-ban-title">${c.inline(b.title)}</div>` : ''}${b.text ? `<div class="kp-ban-text">${c.blocks(b.text)}</div>` : ''}${btn}</div></section>`;
    },
  },

  // ---- language study / parallel texts
  interlinear: {
    cat: 'language', icon: 'languages',
    fields: {
      title: { k: 'line' }, lang: { k: 'plain' }, tiers: { k: 'layers' }, style: { k: 'select', o: ['stacked', 'columns', 'table'] }, audio: { k: 'media' }, numbered: { k: 'bool' },
      items: { k: 'list', item: { text: { k: 'line' }, tiers: { k: 'tiers' }, t: { k: 'num', d: null, min: 0, max: 360000 } } },
    },
    render: interlinear,
  },
  glossary: {
    cat: 'language', icon: 'book',
    fields: {
      title: { k: 'line' }, lang: { k: 'plain' }, layout: { k: 'select', o: ['table', 'cards'] }, readingLayer: { k: 'layer' }, meaningLayer: { k: 'layer' }, noteLayer: { k: 'layer' },
      items: { k: 'list', item: { term: { k: 'line' }, reading: { k: 'line' }, meaning: { k: 'line' }, note: { k: 'line' }, link: { k: 'link' }, audio: { k: 'media' } } },
    },
    render: glossary,
  },
  flashcards: {
    cat: 'language', icon: 'copy',
    fields: { title: { k: 'line' }, lang: { k: 'plain' }, items: { k: 'list', item: { front: { k: 'line' }, back: { k: 'text' } } } },
    render: (b, c) => `<section class="kp-cards">${b.title ? `<div class="kp-cards-title">${c.inline(b.title)}</div>` : ''}<div class="kp-cards-grid">${listItems(b.items).map((it) => `<button type="button" class="kp-card" aria-pressed="false"><span class="kp-card-f"${b.lang ? ` lang="${attr(b.lang)}"` : ''}>${c.inline(it.front)}</span><span class="kp-card-b">${c.blocks(it.back)}</span></button>`).join('')}</div></section>`,
  },

  // ---- layout
  columns: {
    cat: 'layout', icon: 'columns',
    fields: { cols: { k: 'cols', min: 2 }, ratio: { k: 'select', o: ['1:1', '2:1', '1:2', '1:1:1', '1:1:1:1'] } },
    render: (b, c) => `<div class="kp-cols kp-cols-${b.ratio.replace(/:/g, '-')}">${(b.cols || []).map((col) => `<div class="kp-col">${c.renderList(col.blocks)}</div>`).join('')}</div>`,
  },

  // ---- portal (blocks-portal.js: the shared ../portal/ library)
  ...PORTAL_BLOCKS,
};

// Number of columns a ratio asks for.
// Used by the editor when a ratio change needs more or fewer column slots.
export const ratioCols = (r) => String(r || '1:1').split(':').length;

// Block types in palette order.
// Palette order: by CATEGORIES first, then declaration order inside a category (object key order is insertion order for string keys).
export const BLOCK_ORDER = CATEGORIES.flatMap((cat) => Object.keys(BLOCKS).filter((k) => BLOCKS[k].cat === cat));
