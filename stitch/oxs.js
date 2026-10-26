// stitch/oxs.js - OXS (Open Cross Stitch, the XML interchange format of Ursa Software's MacStitch / WinStitch, also
// read and written by KG-Chart, Embroiderly, Pattern Keeper workflows and many web generators) read and write.
//
//   writeOXS(scheme, { software }) -> XML text
//   readOXS(text) -> scheme
//
// Layout: <chart> with <format>, <properties chartwidth chartheight charttitle author copyright instructions
// stitchesperinch stitchesperinch_y palettecount>, <palette> (<palette_item index="0"> is the cloth; threads from 1:
// number "BRAND code", name, color RRGGBB, strands, bsstrands, symbol = decimal code point, fontname, blends as
// "[+]"-joined numbers / names with blendcolor and <blend number> children), <fullstitches> (<stitch x y palindex>),
// <partstitches> (<partstitch x y palindex1 palindex2 direction>: 1 = cell split on the "\" diagonal, palindex1 the
// bottom-left three-quarter stitch, palindex2 the top-right one; 2 = split on "/", palindex1 top-left, palindex2
// bottom-right; 3 = half stitch "/", 4 = half stitch "\"), <backstitches> (<backstitch x1 y1 x2 y2 palindex
// objecttype="backstitch" | "straightstitch">, cell units with halves), <ornaments_inc_knots_and_beads> (<object x1 y1
// palindex objecttype="knot" | "bead" | "quarter" (petit="true" for a petite) | "tent" (half, direction 1 = "\",
// 2 = "/")>), <commentboxes>. Layers are flattened (OXS has one layer).

// Interop rules: write the subset every known reader accepts (one layer, palette index 0 = cloth, decimal code
// points for symbols), read leniently (missing attributes default, unknown object types are skipped, out-of-range
// stitches are dropped by normScheme). Symbols round-trip exactly through our own symbolname attribute; foreign
// files map their symbol character back through CHAR_TO_SYMBOL or keep it as a letter symbol.
import { parseXML, root, child, children, attr, escapeXMLAttr } from '../xml/xml.js';
import { normScheme, flatten, newId } from './model.js';
import { SYMBOLS, SYMBOL_ORDER, symbolChar } from './symbols.js';
import { brandId, findThread, BRANDS } from './threads.js';

const FONT = 'in-html Stitch Symbols';
const hx = (h) => String(h || '#888888').replace('#', '').toUpperCase();
// Every attribute value goes through escapeXMLAttr (quotes, <, &, and tab / newline as character references, so
// multi-line instructions survive attribute-value normalisation). Numbers are rounded to 2 decimals.
const a = (k, v) => ` ${k}="${escapeXMLAttr(String(v ?? ''))}"`;
const fmt = (n) => String(Math.round(n * 100) / 100);

export function writeOXS(scheme, { software = 'in-html Embroidery Studio', version = '1' } = {}) {
  const s = scheme;
  const flat = flatten(s);
  const brandName = (e) => e.brand || (BRANDS.find((b) => b.id === e.catalog) || {}).brand || '';
  // "BRAND code" is how OXS identifies threads (e.g. "DMC 310"); custom colours have no code and write their hex.
  const num = (e) => (e.code ? (brandName(e) ? brandName(e) + ' ' : '') + e.code : e.hex.replace('#', ''));
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<chart>');
  out.push('<format' + a('comments01', 'Open Cross Stitch (OXS) interchange file: palette index 0 is the cloth, threads start at 1') +
    a('comments02', 'Coordinates are in stitches from the top-left corner; backstitches and ornaments may use halves') + a('comments03', 'Written by ' + software) + '/>');
  out.push('<properties' + a('oxsversion', '1.0') + a('software', software) + a('software_version', version) + a('chartheight', s.height) + a('chartwidth', s.width) +
    a('charttitle', s.meta.title) + a('author', s.meta.designer) + a('copyright', s.meta.license) + a('instructions', s.meta.description || s.meta.notes) +
    a('stitchesperinch', fmt(s.fabric.count)) + a('stitchesperinch_y', fmt(s.fabric.countY || s.fabric.count)) + a('palettecount', s.palette.length) + '/>');
  out.push('<palette>');
  out.push('<palette_item' + a('index', 0) + a('number', 'cloth') + a('name', s.fabric.name || 'cloth') + a('color', hx(s.fabric.color)) + a('printcolor', hx(s.fabric.color)) +
    a('blendcolor', 'nil') + a('comments', s.fabric.kind) + a('kind', s.fabric.kind) + a('strands', 2) + a('symbol', 0) + a('dashpattern', '') + a('bsstrands', 2) + a('bscolor', '000000') + '/>');
  s.palette.forEach((e, i) => {
    const sym = symbolChar(e.symbol);
    const cp = sym ? sym.codePointAt(0) : 0;
    let attrs = a('index', i + 1);
    if (e.blend && e.blend.length >= 2) {
      const bn = (b) => (b.brand ? b.brand + ' ' : brandName(e) ? brandName(e) + ' ' : '') + b.code;
      attrs += a('number', e.blend.map(bn).join('[+]')) + a('name', e.blend.map((b) => b.name).join('[+]')) + a('color', hx(e.hex)) + a('printcolor', hx(e.hex)) + a('blendcolor', hx(e.blend[1].hex));
    } else {
      attrs += a('number', num(e)) + a('name', e.name) + a('color', hx(e.hex)) + a('printcolor', hx(e.hex)) + a('blendcolor', 'nil');
    }
    attrs += a('comments', e.kind === 'bead' ? 'bead' : '') + a('strands', e.strands) + a('symbol', cp) + a('fontname', FONT) + a('symbolname', e.symbol) +
      a('dashpattern', '') + a('bsstrands', e.bsStrands) + a('bscolor', hx(e.hex));
    if (e.blend && e.blend.length >= 2) out.push('<palette_item' + attrs + '>' + e.blend.map((b) => '<blend' + a('number', (b.brand ? b.brand + ' ' : '') + b.code) + a('color', hx(b.hex)) + a('strands', b.strands || 1) + '/>').join('') + '</palette_item>');
    else out.push('<palette_item' + attrs + '/>');
  });
  out.push('</palette>');
  out.push('<fullstitches>');
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const v = flat.cells[y * s.width + x];
    if (v) out.push(`<stitch x="${x}" y="${y}" palindex="${v}"/>`);
  }
  out.push('</fullstitches>');
  // OXS encodes three-quarters as a diagonal split with two colours (direction 1 / 2), so the two threes of one cell
  // must be emitted as one element. Quarters and petites have no partstitch form and go to ornaments at the
  // quarter's corner position (x + 0.5 / y + 0.5 for the right / bottom corners).
  // Part stitches: threes paired per cell and diagonal, halves; quarters and petites become ornaments.
  const parts = [];
  const orn = [];
  const byCell = new Map();
  for (const p of flat.parts) { const k = p.y * s.width + p.x; if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(p); }
  for (const list of byCell.values()) {
    const { x, y } = list[0];
    const find = (k, c) => list.find((p) => p.k === k && p.c === c);
    for (const p of list.filter((q) => q.k === 'half')) parts.push(`<partstitch x="${x}" y="${y}" palindex1="${p.p + 1}" palindex2="0" direction="${p.c === '/' ? 3 : 4}"/>`);
    const bl = find('three', 'bl'), tr = find('three', 'tr'), tl = find('three', 'tl'), br = find('three', 'br');
    if (bl || tr) parts.push(`<partstitch x="${x}" y="${y}" palindex1="${bl ? bl.p + 1 : 0}" palindex2="${tr ? tr.p + 1 : 0}" direction="1"/>`);
    if (tl || br) parts.push(`<partstitch x="${x}" y="${y}" palindex1="${tl ? tl.p + 1 : 0}" palindex2="${br ? br.p + 1 : 0}" direction="2"/>`);
    for (const p of list.filter((q) => q.k === 'quarter' || q.k === 'petite')) {
      const ox = p.c.endsWith('r') ? 0.5 : 0, oy = p.c.startsWith('b') ? 0.5 : 0;
      orn.push(`<object x1="${fmt(x + ox)}" y1="${fmt(y + oy)}" palindex="${p.p + 1}" objecttype="quarter" petit="${p.k === 'petite'}"/>`);
    }
  }
  out.push('<partstitches>', ...parts, '</partstitches>');
  out.push('<backstitches>');
  flat.lines.forEach((l, i) => out.push(`<backstitch x1="${fmt(l.x1)}" y1="${fmt(l.y1)}" x2="${fmt(l.x2)}" y2="${fmt(l.y2)}" palindex="${l.p + 1}" objecttype="${l.k === 'straight' ? 'straightstitch' : 'backstitch'}" sequence="${i}"/>`));
  out.push('</backstitches>');
  out.push('<ornaments_inc_knots_and_beads>', ...orn);
  for (const k of flat.knots) out.push(`<object x1="${fmt(k.x)}" y1="${fmt(k.y)}" palindex="${k.p + 1}" objecttype="knot"/>`);
  for (const b of flat.beads) out.push(`<object x1="${fmt(b.x)}" y1="${fmt(b.y)}" palindex="${b.p + 1}" objecttype="bead"/>`);
  out.push('</ornaments_inc_knots_and_beads>');
  out.push('<commentboxes/>');
  out.push('</chart>');
  return out.join('\n') + '\n';
}

// "DMC 310" -> { catalog: 'dmc', brand: 'DMC', code: '310' }.
// The brand is everything before the last space (brands can contain spaces: "PNK Kirova"). An unknown brand keeps
// its text with catalog '' (a custom colour that still prints its original number).
function splitNumber(n) {
  const s = String(n || '').trim();
  const i = s.lastIndexOf(' ');
  const brand = i > 0 ? s.slice(0, i).trim() : '';
  const code = i > 0 ? s.slice(i + 1).trim() : s;
  const id = brand ? brandId(brand) : null;
  return { catalog: id || '', brand: id ? BRANDS.find((b) => b.id === id).brand : brand, code };
}

const CHAR_TO_SYMBOL = new Map(SYMBOL_ORDER.map((id) => [SYMBOLS[id].char, id]));

// Throws only for "not OXS" and "no size", so the import dispatcher can try other formats; everything else is
// lenient. The file's palette indices are arbitrary and may skip numbers, hence the map from file index to ours.
export function readOXS(text) {
  const doc = parseXML(text);
  const chart = root(doc);
  if (!chart || chart.name !== 'chart') throw new Error('not an OXS file');
  const props = child(chart, 'properties') || { attrs: {} };
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const W = Math.round(num(attr(props, 'chartwidth'), 0)), H = Math.round(num(attr(props, 'chartheight'), 0));
  if (!(W > 0 && H > 0)) throw new Error('OXS chart without a size');
  const items = children(child(chart, 'palette'), 'palette_item');
  let fabric = { kind: 'aida', count: num(attr(props, 'stitchesperinch'), 14), countY: num(attr(props, 'stitchesperinch_y'), num(attr(props, 'stitchesperinch'), 14)), color: '#ffffff' };
  const palette = [];
  const map = new Map(); // file index -> palette index
  items.forEach((it, k) => {
    const idx = Math.round(num(attr(it, 'index'), k));
    const color = '#' + String(attr(it, 'color') || 'FF00FF').replace('#', '').toLowerCase().padStart(6, '0').slice(0, 6);
    const number = attr(it, 'number') || '';
    if (idx === 0 || number === 'cloth') {
      const kind = String(attr(it, 'kind') || attr(it, 'comments') || 'aida').toLowerCase();
      fabric = { ...fabric, color, name: attr(it, 'name') === 'cloth' ? '' : attr(it, 'name') || '', kind: ['aida', 'evenweave', 'linen', 'canvas', 'rug'].includes(kind) ? kind : 'aida' };
      return;
    }
    const symName = attr(it, 'symbolname');
    const cp = Math.round(num(attr(it, 'symbol'), 0));
    const ch = cp > 32 ? String.fromCodePoint(cp) : '';
    const symbol = symName && (SYMBOLS[symName] || symName.length <= 2) ? symName : CHAR_TO_SYMBOL.get(ch) || (ch && ch.length <= 2 ? ch : '');
    const blendKids = children(it, 'blend');
    const name = attr(it, 'name') || '';
    const e = { id: newId('c'), hex: color, strands: Math.round(num(attr(it, 'strands'), 2)), bsStrands: Math.round(num(attr(it, 'bsstrands'), 1)), symbol, kind: /bead/i.test(attr(it, 'comments') || '') ? 'bead' : 'thread' };
    let blendNums = blendKids.length >= 2 ? blendKids.map((b) => ({ n: attr(b, 'number'), hex: attr(b, 'color') })) : null;
    if (!blendNums && number.includes('[+]')) blendNums = number.split('[+]').map((n) => ({ n }));
    if (blendNums) {
      const names = name.split('[+]');
      e.blend = blendNums.map((b, j) => {
        const p = splitNumber(b.n);
        const t = p.catalog ? findThread(p.catalog, p.code) : null;
        return { catalog: p.catalog, brand: p.brand, code: t ? t.code : p.code, name: names[j] || (t ? t.name : ''), hex: b.hex ? '#' + b.hex.toLowerCase() : t ? t.hex : color, strands: 1 };
      });
      Object.assign(e, { catalog: e.blend[0].catalog, brand: e.blend[0].brand, code: e.blend.map((b) => b.code).join('+'), name: e.blend.map((b) => b.name).join(' + ') });
    } else {
      const p = splitNumber(number);
      const t = p.catalog ? findThread(p.catalog, p.code) : null;
      Object.assign(e, { catalog: p.catalog, brand: p.brand, code: t ? t.code : p.code, name: name || (t ? t.name : '') });
    }
    map.set(idx, palette.length);
    palette.push(e);
  });
  const pi = (v) => { const k = map.get(Math.round(num(v, -1))); return k == null ? -1 : k; };
  const cells = new Uint16Array(W * H);
  for (const st of children(child(chart, 'fullstitches'), 'stitch')) {
    const x = Math.round(num(attr(st, 'x'), -1)), y = Math.round(num(attr(st, 'y'), -1)), p = pi(attr(st, 'palindex'));
    if (x >= 0 && y >= 0 && x < W && y < H && p >= 0) cells[y * W + x] = p + 1;
  }
  const parts = [];
  for (const st of children(child(chart, 'partstitches'), 'partstitch')) {
    const x = Math.round(num(attr(st, 'x'), -1)), y = Math.round(num(attr(st, 'y'), -1));
    const p1 = pi(attr(st, 'palindex1')), p2 = pi(attr(st, 'palindex2'));
    const dir = Math.round(num(attr(st, 'direction'), 0));
    if (dir === 3 && p1 >= 0) parts.push({ x, y, k: 'half', c: '/', p: p1 });
    else if (dir === 4 && p1 >= 0) parts.push({ x, y, k: 'half', c: '\\', p: p1 });
    else if (dir === 1) { if (p1 >= 0) parts.push({ x, y, k: 'three', c: 'bl', p: p1 }); if (p2 >= 0) parts.push({ x, y, k: 'three', c: 'tr', p: p2 }); }
    else if (dir === 2) { if (p1 >= 0) parts.push({ x, y, k: 'three', c: 'tl', p: p1 }); if (p2 >= 0) parts.push({ x, y, k: 'three', c: 'br', p: p2 }); }
  }
  const lines = [];
  for (const b of children(child(chart, 'backstitches'), 'backstitch')) {
    const t = attr(b, 'objecttype') || 'backstitch';
    if (t !== 'backstitch' && t !== 'straightstitch') continue;
    const p = pi(attr(b, 'palindex'));
    if (p < 0) continue;
    lines.push({ x1: num(attr(b, 'x1'), 0), y1: num(attr(b, 'y1'), 0), x2: num(attr(b, 'x2'), 0), y2: num(attr(b, 'y2'), 0), p, k: t === 'straightstitch' ? 'straight' : 'back' });
  }
  const knots = [], beads = [];
  // Quarter corner = which half of the cell the ornament position falls in on each axis.
  // KNOWN DEFECT: a quarter object without a petit attribute is read as a petite (only petit="false" yields a
  // quarter). Files from software that omits the attribute turn every quarter into a petite. Fix: test
  // attr(o, 'petit') === 'true' for petite, defaulting to quarter.
  for (const o of children(child(chart, 'ornaments_inc_knots_and_beads'), 'object')) {
    const t = String(attr(o, 'objecttype') || '');
    const p = pi(attr(o, 'palindex'));
    const x1 = num(attr(o, 'x1'), NaN), y1 = num(attr(o, 'y1'), NaN);
    if (p < 0 || !Number.isFinite(x1) || !Number.isFinite(y1)) continue;
    if (t === 'knot') knots.push({ x: x1, y: y1, p });
    else if (t.startsWith('bead')) beads.push({ x: x1, y: y1, p });
    else if (t === 'quarter') {
      const x = Math.floor(x1), y = Math.floor(y1);
      const c = (y1 - y >= 0.5 ? 'b' : 't') + (x1 - x >= 0.5 ? 'r' : 'l');
      parts.push({ x, y, k: attr(o, 'petit') === 'false' ? 'quarter' : 'petite', c, p });
    } else if (t === 'tent') {
      parts.push({ x: Math.floor(x1), y: Math.floor(y1), k: 'half', c: attr(o, 'direction') === '1' ? '\\' : '/', p });
    }
  }
  return normScheme({
    meta: { title: attr(props, 'charttitle') || '', designer: attr(props, 'author') || '', license: attr(props, 'copyright') || '', description: attr(props, 'instructions') || '', source: 'OXS' },
    width: W, height: H, fabric, palette,
    layers: [{ name: 'Layer 1', cells, parts, lines, knots, beads }],
  });
}
