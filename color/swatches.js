// color/swatches.js - palette file formats: CSS custom properties, SCSS, W3C design tokens (DTCG JSON), Tailwind
// config, GIMP .gpl, Adobe .ase (binary), SVG swatch sheet (+ the layout shared with canvas renderers); importers
// for free text colour lists, .gpl and .ase.
//
// A palette is a list of items { name, hex: '#rrggbb', scale?: [{ step, hex }] } (scale = optional 50..950 ramp).
//
// Design: exporters are pure string/byte builders over one neutral item shape, so adding a format never touches the
// palette logic. Every user-supplied name passes through slug() before it lands in code-like output (CSS, SCSS,
// Tailwind JS), which is what makes these outputs injection-safe: a name like "x; } body { ..." becomes "x-body".
// Free-text names only appear in formats that quote/escape them (GPL line tail, ASE UTF-16, SVG via xmlEsc).
// Importers are deliberately forgiving (paste anything, get colours) - the opposite trade-off from css.js.
import { convertCoords } from './space.js';
import { labelOn } from './metrics.js';
import { NAMED, formatCSS, parseCSS, parseHex, toHex } from './css.js';

const IDENT = /^[A-Za-z_][\w-]*$/;
// Safe identifier for variable names: lowercase words joined by '-'.
// NFKD + removal of U+0300..U+036F strips accents ("Café" -> "cafe") instead of dropping the letter; other scripts
// reduce to '-' and fall back to `fallback`. A leading digit is prefixed because CSS custom-property names may start
// with digits but SCSS variables and JS identifiers may not. Distinct names can collide after slugging ("Blue" and
// "blue!" both -> "blue"); callers that need unique keys should run tokenNames() first.
function slug(s, fallback = 'color') {
  const v = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!v) return fallback;
  return /^[0-9]/.test(v) ? fallback + '-' + v : v;
}
const lower = (hex) => String(hex).toLowerCase();
const rgbOf = (hex) => parseHex(hex).rgb;

// --- text formats -------------------------------------------------------------------------------

// :root { --name: #hex; --name-50: … } (opts.prefix is prepended to every variable name).
function toCSSVars(items, opts = {}) {
  const p = opts.prefix ? slug(opts.prefix) + '-' : '';
  const lines = [':root {'];
  for (const it of items) lines.push(`  --${p}${slug(it.name)}: ${lower(it.hex)};`);
  for (const it of items) {
    if (!it.scale) continue;
    lines.push('', `  /* ${slug(it.name)} */`);
    for (const s of it.scale) lines.push(`  --${p}${slug(it.name)}-${s.step}: ${lower(s.hex)};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

// SCSS variables plus a $palette map (and one map per scale).
function toSCSS(items, opts = {}) {
  const p = opts.prefix ? slug(opts.prefix) + '-' : '';
  const out = items.map((it) => `$${p}${slug(it.name)}: ${lower(it.hex)};`);
  for (const it of items) {
    if (!it.scale) continue;
    out.push('');
    for (const s of it.scale) out.push(`$${p}${slug(it.name)}-${s.step}: ${lower(s.hex)};`);
  }
  out.push('', `$${p}palette: (`);
  for (const it of items) out.push(`  '${slug(it.name)}': $${p}${slug(it.name)},`);
  out.push(');');
  for (const it of items) {
    if (!it.scale) continue;
    out.push('', `$${p}${slug(it.name)}-scale: (`);
    for (const s of it.scale) out.push(`  ${s.step}: $${p}${slug(it.name)}-${s.step},`);
    out.push(');');
  }
  return out.join('\n') + '\n';
}

// W3C Design Tokens Community Group format: { color: { name: { $type, $value } }, scale: { name: { 50: … } } }.
function toTokens(items, opts = {}) {
  const tok = (hex) => ({ $type: 'color', $value: lower(hex) });
  const color = {};
  for (const it of items) color[slug(it.name)] = tok(it.hex);
  const doc = { [opts.group || 'color']: color };
  if (items.some((it) => it.scale)) {
    const sc = {};
    for (const it of items) {
      if (!it.scale) continue;
      const g = {};
      for (const s of it.scale) g[String(s.step)] = tok(s.hex);
      sc[slug(it.name)] = g;
    }
    doc.scale = sc;
  }
  return JSON.stringify(doc, null, 2) + '\n';
}

// tailwind.config.js: theme.extend.colors with DEFAULT + 50..950 for colours that carry a scale.
// Keys with '-' must be quoted in a JS object literal; plain identifiers stay bare for readability. DEFAULT makes the
// bare class (bg-brand) work alongside the stepped ones (bg-brand-500), per Tailwind convention.
function toTailwind(items) {
  const key = (k) => (IDENT.test(k) && !k.includes('-') ? k : `'${k}'`);
  const lines = ['module.exports = {', '  theme: {', '    extend: {', '      colors: {'];
  for (const it of items) {
    const n = key(slug(it.name));
    if (!it.scale) { lines.push(`        ${n}: '${lower(it.hex)}',`); continue; }
    lines.push(`        ${n}: {`, `          DEFAULT: '${lower(it.hex)}',`);
    for (const s of it.scale) lines.push(`          ${s.step}: '${lower(s.hex)}',`);
    lines.push('        },');
  }
  lines.push('      },', '    },', '  },', '};');
  return lines.join('\n') + '\n';
}

// GIMP palette (.gpl): "R G B<TAB>name" lines.
function toGPL(items, opts = {}) {
  const all = flatten(items);
  const lines = ['GIMP Palette', `Name: ${String(opts.name || 'Palette').replace(/[\r\n]+/g, ' ')}`, `Columns: ${Math.min(16, Math.max(1, opts.columns || items.length))}`, '#'];
  for (const c of all) {
    const v = rgbOf(c.hex).map((x) => String(Math.round(x * 255)).padStart(3, ' '));
    lines.push(`${v.join(' ')}\t${c.name}`);
  }
  return lines.join('\n') + '\n';
}

// Items followed by their scale steps, as flat { name, hex } entries.
function flatten(items) {
  const out = items.map((it) => ({ name: slug(it.name), hex: lower(it.hex) }));
  for (const it of items) for (const s of it.scale || []) out.push({ name: `${slug(it.name)}-${s.step}`, hex: lower(s.hex), group: slug(it.name) });
  return out;
}

// --- Adobe Swatch Exchange (.ase) ---------------------------------------------------------------------

/**
 * ASE 1.0 file (big-endian): 'ASEF', version 1.0, block count, then blocks (0x0001 colour, 0xC001 group start,
 * 0xC002 group end). Colours are RGB float32 global swatches with UTF-16 names; each scale becomes a group.
 * Returns a Uint8Array.
 */
// DataView for every multi-byte field because ASE is big-endian and typed-array views use platform (little) endian.
// Names: u16 length in UTF-16 units INCLUDING the terminating NUL, then the units, then 0x0000 (the zero-filled
// tail of the buffer). Truncation at 200 units can split a surrogate pair; acceptable for swatch names.
function toASE(items, opts = {}) {
  const blocks = [];
  const nameBytes = (s) => {
    const str = String(s).slice(0, 200);
    const b = new Uint8Array(2 + (str.length + 1) * 2);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, str.length + 1);
    for (let i = 0; i < str.length; i++) dv.setUint16(2 + i * 2, str.charCodeAt(i));
    return b;
  };
  const colour = (name, hex) => {
    const nb = nameBytes(name);
    const b = new Uint8Array(nb.length + 4 + 12 + 2);
    b.set(nb, 0);
    const dv = new DataView(b.buffer);
    'RGB '.split('').forEach((ch, i) => dv.setUint8(nb.length + i, ch.charCodeAt(0)));
    rgbOf(hex).forEach((v, i) => dv.setFloat32(nb.length + 4 + i * 4, v));
    dv.setUint16(nb.length + 16, 0); // 0 = global swatch
    blocks.push([0x0001, b]);
  };
  const flat = flatten(items);
  for (const c of flat.filter((c) => !c.group)) colour(c.name, c.hex);
  for (const it of items) {
    if (!it.scale) continue;
    blocks.push([0xC001, nameBytes(slug(it.name))]);
    for (const s of it.scale) colour(`${slug(it.name)}-${s.step}`, s.hex);
    blocks.push([0xC002, new Uint8Array(0)]);
  }
  void opts;
  const size = 12 + blocks.reduce((n, [, b]) => n + 6 + b.length, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x41, 0x53, 0x45, 0x46], 0); // 'ASEF'
  dv.setUint16(4, 1);
  dv.setUint16(6, 0);
  dv.setUint32(8, blocks.length);
  let o = 12;
  for (const [type, b] of blocks) {
    dv.setUint16(o, type);
    dv.setUint32(o + 2, b.length);
    out.set(b, o + 6);
    o += 6 + b.length;
  }
  return out;
}

// Reads an .ase file (ArrayBuffer / typed array): { colors: [{ name, hex, rgb, model, group }] }. RGB, CMYK (naive),
// LAB (D50, L stored 0..1) and Gray swatches are converted to sRGB. Throws on a malformed file.
// Robustness: every block is bounds-checked against the buffer before reading; unknown block types and colour
// models are skipped (by jumping to `end`, not by parsing), so newer Adobe files still yield their RGB swatches.
// CMYK is converted naively (no ICC profile), so printed and on-screen values will differ - labelled "naive" above.
// KNOWN DEFECT: a typed array other than Uint8Array (or a DataView) is re-wrapped from its whole `.buffer`, ignoring
// byteOffset/byteLength, so a view into a larger buffer parses the wrong bytes. Fix: new Uint8Array(input.buffer,
// input.byteOffset, input.byteLength) when ArrayBuffer.isView(input).
function parseASE(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input.buffer ? input.buffer : input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 12 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'ASEF') throw new Error('not an ASE file');
  const count = dv.getUint32(8);
  const colors = [];
  let group = '';
  let o = 12;
  for (let i = 0; i < count && o + 6 <= u8.length; i++) {
    const type = dv.getUint16(o);
    const len = dv.getUint32(o + 2);
    const start = o + 6;
    const end = start + len;
    if (end > u8.length) throw new Error('truncated ASE block');
    let p = start;
    const readName = () => {
      const n = dv.getUint16(p);
      p += 2;
      let s = '';
      for (let j = 0; j < n; j++) { const c = dv.getUint16(p + j * 2); if (c) s += String.fromCharCode(c); }
      p += n * 2;
      return s;
    };
    if (type === 0xC001) group = len ? readName() : '';
    else if (type === 0xC002) group = '';
    else if (type === 0x0001) {
      const name = readName();
      const model = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]).trim().toUpperCase();
      p += 4;
      const f = (j) => dv.getFloat32(p + j * 4);
      let rgb;
      if (model === 'RGB') rgb = [f(0), f(1), f(2)];
      else if (model === 'CMYK') { const k = f(3); rgb = [0, 1, 2].map((j) => (1 - f(j)) * (1 - k)); }
      else if (model === 'LAB') rgb = convertCoords([f(0) * 100, f(1), f(2)], 'lab', 'srgb');
      else if (model === 'GRAY') rgb = [f(0), f(0), f(0)];
      if (rgb) {
        rgb = rgb.map((v) => Math.min(1, Math.max(0, v)));
        colors.push({ name, hex: toHex(rgb), rgb, model, group });
      }
    }
    o = end;
  }
  return { colors };
}

// --- importing text ---------------------------------------------------------------------------------

// [^()]* stops at nested parentheses, so calc()/var() inside a function are not matched (parseCSS rejects them).
const FN_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/gi;
// Longest names first in the alternation: otherwise 'blue' would match inside 'blueviolet' before the longer name.
// Lookbehind/lookahead exclude identifier characters, so "$blue", "--blue-50", ".blue" are not read as colours.
// Named colours as whole words (not inside identifiers such as $blue, --blue-50 or .blue).
const NAME_RE = new RegExp('(?<![\\w$#.-])(' + Object.keys(NAMED).sort((a, b) => b.length - a.length).join('|') + ')(?![\\w-])', 'gi');

/**
 * Colours in free text: hex (#rgb, #rrggbb, #rrggbbaa, bare 6-digit hex), any CSS colour function, CSS named
 * colours, GIMP .gpl lines ("R G B name"), and design-token JSON ($value). Names are taken from .gpl entries,
 * token paths and "name: value" / "--name: value" / "$name: value" lines. Returns [{ hex, name? }] in order
 * (alpha is dropped).
 */
function parseColorList(text) {
  const src = String(text ?? '');
  const t = src.trim();
  if (!t) return [];
  if (t[0] === '{' || t[0] === '[') {
    try { const out = fromJSON(JSON.parse(t)); if (out.length) return out; } catch { /* not JSON */ }
  }
  const gpl = /^GIMP Palette/i.test(t);
  const out = [];
  // Comments would leak words such as 'blue' into the list.
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (gpl && (/^(name|columns)\s*:/i.test(line) || line[0] === '#' && !/^#[0-9a-f]{3,8}\b/i.test(line) || /^GIMP Palette/i.test(line))) continue;
    const g = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/.exec(line);
    if (g && [g[1], g[2], g[3]].every((v) => +v <= 255)) {
      out.push({ hex: toHex([+g[1] / 255, +g[2] / 255, +g[3] / 255]), name: (g[4] || '').trim() || undefined });
      continue;
    }
    // "name: value", "--name: value", "$name: value", "name = value", "'name': 'value'"
    const nv = /^['"]?(?:--|\$)?([\w-]+)['"]?\s*[:=]\s*(.+)$/.exec(line);
    const found = scanColors(nv ? nv[2] : line);
    if (nv && found.length === 1 && !/^(\d+|default)$/i.test(nv[1])) found[0].name = nv[1];
    out.push(...found);
  }
  return out;
}

// Every colour mentioned in a string, in order of appearance.
// Each pattern runs independently over the whole string, then hits are merged by position and overlaps dropped
// (first-starting wins). Simpler and more robust than one giant alternation, whose match priority would depend on
// branch order. Bare 6-digit hex is accepted only as a standalone token, so hex runs inside words or ids are not
// misread; a standalone number such as "123456" still is - an accepted false positive for paste convenience.
function scanColors(s) {
  const hits = [];
  const take = (re, fn) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const hex = fn(m[0]);
      if (hex) hits.push({ at: m.index, end: m.index + m[0].length, hex });
    }
  };
  const viaCSS = (x) => { const c = parseCSS(x); return c ? formatCSS({ ...c, alpha: 1 }, 'hex') : null; };
  take(FN_RE, viaCSS);
  take(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi, viaCSS);
  take(/(?<![\w#-])[0-9a-f]{6}(?![\w-])/gi, (x) => viaCSS('#' + x));
  take(NAME_RE, viaCSS);
  hits.sort((a, b) => a.at - b.at);
  const out = [];
  let last = -1;
  for (const h of hits) {
    if (h.at < last) continue; // inside an earlier match (e.g. a name inside a function)
    out.push({ hex: h.hex });
    last = h.end;
  }
  return out;
}

// Design-token JSON: every { $value } leaf (or a plain string value) that parses as a colour; the name is its path.
// Stops after ~2000 colours (bounded work on a huge paste). Keys starting with '$' ($type, $description) are
// metadata in DTCG and are skipped; array indices are not added to the name path.
function fromJSON(doc) {
  const out = [];
  const walk = (node, path) => {
    if (out.length > 2000) return;
    if (typeof node === 'string') {
      const c = parseCSS(node);
      if (c) out.push({ hex: formatCSS({ ...c, alpha: 1 }, 'hex'), name: path.join('-') || undefined });
      return;
    }
    if (!node || typeof node !== 'object') return;
    if ('$value' in node) {
      const v = node.$value;
      const c = typeof v === 'string' ? parseCSS(v) : v && typeof v.hex === 'string' ? parseCSS(v.hex) : null;
      if (c) out.push({ hex: formatCSS({ ...c, alpha: 1 }, 'hex'), name: path.join('-') || undefined });
      return;
    }
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) walk(v, Array.isArray(node) ? path : [...path, k]);
  };
  walk(doc, []);
  return out;
}

// --- swatch sheet (SVG, and the layout for canvas renderers) ---------------------------------------------

/**
 * Geometry of a swatch sheet: { width, height, shapes }. shapes: { t: 'rect', x, y, w, h, r, fill } and
 * { t: 'text', x, y, text, fill, size, weight, mono, anchor ('start' | 'end') }. Without scales the colours are big
 * cards in a grid; with scales each colour is a row of 11 steps. Label colours are black or white, whichever
 * contrasts more with the swatch (APCA |Lc| by default). opts: { title, columns, background, label: 'apca' | 'wcag' }.
 */
// Layout is separated from rendering: the same shape list drives the SVG export and a canvas PNG export, so both
// look identical without duplicating coordinates. The background rect is unshifted last because the height is
// known only after placing all rows. Column headers in scale mode come from the first item that has a scale.
function sheetLayout(items, opts = {}) {
  const shapes = [];
  const bg = opts.background || '#ffffff';
  const ink = '#111827';
  const muted = '#6b7280';
  const pad = 32;
  const label = (hex) => toHex(labelOn(rgbOf(hex), opts.label || 'apca'));
  let y = pad;
  const head = opts.title ? 44 : 0;
  const withScales = items.some((it) => it.scale);
  let width;
  if (!withScales) {
    // Balanced rows: up to 6 per row (7 -> 4 + 3, 10 -> 5 + 5).
    const cols = Math.max(1, Math.min(items.length, opts.columns || Math.ceil(items.length / Math.ceil(items.length / 6))));
    const cw = 180;
    const ch = 220;
    const gap = 16;
    width = pad * 2 + cols * cw + (cols - 1) * gap;
    if (opts.title) shapes.push({ t: 'text', x: pad, y: y + 22, text: opts.title, fill: ink, size: 22, weight: 700 });
    y += head;
    items.forEach((it, i) => {
      const x = pad + (i % cols) * (cw + gap);
      const yy = y + Math.floor(i / cols) * (ch + gap);
      const fg = label(it.hex);
      const rgb = rgbOf(it.hex).map((v) => Math.round(v * 255)).join(' ');
      shapes.push({ t: 'rect', x, y: yy, w: cw, h: ch, r: 14, fill: lower(it.hex) });
      shapes.push({ t: 'text', x: x + 16, y: yy + ch - 58, text: it.name, fill: fg, size: 15, weight: 650 });
      shapes.push({ t: 'text', x: x + 16, y: yy + ch - 36, text: lower(it.hex).toUpperCase(), fill: fg, size: 14, weight: 500, mono: true });
      shapes.push({ t: 'text', x: x + 16, y: yy + ch - 17, text: 'RGB ' + rgb, fill: fg, size: 11, weight: 400, mono: true });
    });
    y += Math.ceil(items.length / cols) * (ch + gap) - gap;
  } else {
    const lw = 150;
    const cw = 76;
    const ch = 76;
    const gap = 6;
    width = pad * 2 + lw + 11 * cw + 10 * gap;
    if (opts.title) shapes.push({ t: 'text', x: pad, y: y + 22, text: opts.title, fill: ink, size: 22, weight: 700 });
    y += head;
    const steps = items.find((it) => it.scale).scale.map((s) => s.step);
    steps.forEach((st, j) => shapes.push({ t: 'text', x: pad + lw + j * (cw + gap) + cw / 2, y: y + 12, text: String(st), fill: muted, size: 11, weight: 600, anchor: 'middle' }));
    y += 22;
    items.forEach((it) => {
      shapes.push({ t: 'rect', x: pad, y, w: 22, h: 22, r: 6, fill: lower(it.hex) });
      shapes.push({ t: 'text', x: pad + 32, y: y + 16, text: it.name, fill: ink, size: 14, weight: 650 });
      shapes.push({ t: 'text', x: pad, y: y + 44, text: lower(it.hex).toUpperCase(), fill: muted, size: 12, weight: 500, mono: true });
      (it.scale || []).forEach((s, j) => {
        const x = pad + lw + j * (cw + gap);
        const fg = label(s.hex);
        shapes.push({ t: 'rect', x, y, w: cw, h: ch, r: 10, fill: lower(s.hex) });
        shapes.push({ t: 'text', x: x + 8, y: y + 18, text: String(s.step), fill: fg, size: 11, weight: 650 });
        shapes.push({ t: 'text', x: x + 8, y: y + ch - 10, text: lower(s.hex).slice(1).toUpperCase(), fill: fg, size: 10.5, weight: 500, mono: true });
      });
      y += ch + 14;
    });
    y -= 14;
  }
  const height = y + pad;
  shapes.unshift({ t: 'rect', x: 0, y: 0, w: width, h: height, r: 0, fill: bg });
  return { width, height, shapes };
}

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SANS = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Self-contained SVG swatch sheet (names, hex values, contrast-safe labels).
// Every interpolated string goes through xmlEsc (names are user text); system font stacks instead of embedded fonts
// keep the file small and render natively everywhere.
function toSVG(items, opts = {}) {
  const L = sheetLayout(items, opts);
  const body = L.shapes.map((s) => {
    if (s.t === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${s.r ? ` rx="${s.r}"` : ''} fill="${xmlEsc(s.fill)}"/>`;
    const anchor = s.anchor === 'middle' ? ' text-anchor="middle"' : s.anchor === 'end' ? ' text-anchor="end"' : '';
    return `<text x="${s.x}" y="${s.y}" fill="${xmlEsc(s.fill)}" font-size="${s.size}" font-weight="${s.weight}" font-family="${s.mono ? MONO : SANS}"${anchor}>${xmlEsc(s.text)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">\n${body.join('\n')}\n</svg>\n`;
}

export {
  flatten,
  parseASE,
  parseColorList,
  scanColors,
  sheetLayout,
  slug,
  toASE,
  toCSSVars,
  toGPL,
  toSCSS,
  toSVG,
  toTailwind,
  toTokens
};
