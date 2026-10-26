// planogram/svg.js - the front view of a fixture: posts, boards, the clearance of every shelf, product blocks of
// fx x fy facing cells standing on the board (or hanging from the top on a pegboard, with its holes), coloured by
// category / brand / product, names fitted into the block, x fz for rows into the depth, a dot for no stock, "?" for
// missing dimensions, the overflow beyond the shelf end (red, or amber when squeezing makes it fit), shelf numbers
// and an optional legend. One layout in centimetres, rendered as an SVG string (viewBox in cm, outer size in px or
// in mm at a print ratio 1:N).
//
// Layout and rendering are separate (frontLayout returns geometry, frontSVG serialises it), so a canvas renderer or
// hit testing can reuse the geometry. The viewBox is in centimetres, so the same SVG prints at an exact scale when
// width / height are given in mm. All text is escaped (product names are user data).

import { checkFixture } from './fit.js';
import { effectiveDims, hasDims, productLookup } from './model.js';

const POST = 4;
const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pid = (p) => p.productId ?? p.modelId;

// Stable pastel colour of a key (category name, brand, id).
// Polynomial string hash mapped to a hue; fixed saturation and lightness keep every key a legible pastel behind
// dark text.
export function keyColor(key, { s = 55, l = 72 } = {}) {
  if (key == null || key === '') return 'hsl(220 10% 80%)';
  const h = [...String(key)].reduce((x, c) => (x * 31 + c.charCodeAt(0)) % 360, 7);
  return `hsl(${h} ${s}% ${l}%)`;
}

/**
 * Layout in cm: { width, height, inner, fs, posts, boards, spaces, overflow, blocks, legend, check }.
 *   colorBy  'category' (default) | 'brand' | 'product' | (product, id) => key
 */
export function frontLayout(fixture, products, opts = {}) {
  const get = productLookup(products);
  const check = opts.check ?? checkFixture(fixture, products);
  const by = opts.colorBy ?? 'category';
  const keyOf = typeof by === 'function' ? by : by === 'product' ? (pr, id) => id : (pr) => pr?.[by] ?? null;
  const shelves = fixture.shelves;
  const inner = Math.max(60, ...shelves.map((s) => s.width));
  const wide = Math.max(inner, ...shelves.map((s, i) => check.shelves[i]?.usedWidth ?? 0));
  const fs = Math.max(2, Math.min(4, inner / 40));
  const boards = [], spaces = [], overflow = [], blocks = [], legend = new Map();
  const board0 = shelves[0]?.thickness ?? 3;
  boards.push({ x: 0, y: 0, w: inner + 2 * POST, h: board0 });
  let y = board0;
  shelves.forEach((s, si) => {
    const x0 = POST, cs = check.shelves[si];
    spaces.push({ shelf: si, kind: s.kind, pitch: s.pitch, x: x0, y, w: s.width, h: s.height });
    if (cs.usedWidth > s.width) overflow.push({ shelf: si, x: x0 + s.width, y, w: r2(cs.usedWidth - s.width), h: s.height, squeezed: cs.squeezed });
    let x = x0;
    s.positions.forEach((p, pi) => {
      const pr = get(pid(p));
      const known = hasDims(pr);
      const e = known ? effectiveDims(pr, p.rot, p.turn) : { width: 10, height: 10, depth: 10 };
      const colW = s.kind === 'peg' && s.pitch ? Math.ceil(e.width / s.pitch - 1e-9) * s.pitch : e.width;
      const bw = colW * p.fx, bh = e.height * p.fy;
      // Shelves: packs stand on the board (bottom-aligned); pegboards: packs hang from the top of the space.
      const by0 = s.kind === 'peg' ? y + Math.min(2, s.height * 0.05) : y + s.height - bh;
      const key = keyOf(pr, pid(p));
      const color = pr?.color ?? keyColor(key);
      if (!legend.has(key)) legend.set(key, color);
      const cells = [];
      // On a pegboard each pack is centred in its pitch-rounded column, so the drawing shows the hook spacing.
      for (let c = 0; c < p.fx; c++) for (let r = 0; r < p.fy; r++) cells.push({ x: r2(c * colW + (colW - e.width) / 2), y: r2((p.fy - 1 - r) * e.height), w: e.width, h: e.height });
      blocks.push({
        shelf: si, pos: pi, productId: pid(p), name: pr?.name ?? '?', x: r2(x), y: r2(by0), w: r2(bw), h: r2(bh), cells, fx: p.fx, fy: p.fy, fz: p.fz,
        color, key, known, noStock: pr?.stock != null && pr.stock <= 0,
        bad: check.warnings.some((w) => w.shelf === si && w.pos === pi && w.code !== 'no_dimensions'),
      });
      x += bw;
    });
    y += s.height;
    const t = s.thickness ?? 3;
    boards.push({ x: 0, y, w: inner + 2 * POST, h: t });
    y += t;
  });
  const height = Math.max(y + (fixture.base ?? 0), 1);
  if (fixture.base) boards.push({ x: 0, y, w: inner + 2 * POST, h: fixture.base, plinth: true });
  const posts = [{ x: 0, y: 0, w: POST, h: height }, { x: POST + inner, y: 0, w: POST, h: height }];
  return {
    width: r2(Math.max(wide, inner) + 2 * POST), height: r2(height), inner, fs, posts, boards, spaces, overflow, blocks, check,
    legend: [...legend].map(([key, color]) => ({ key, color })),
  };
}

/**
 * SVG markup of the front view.
 *   unit 'px' (default; scale = px per cm, default 3) | 'mm' (ratio = print scale 1:N, default 10)
 *   labels (default true), legend (default false), title, colorBy, idPrefix (pattern ids, default 'pg')
 *   legendName(key) -> text of a legend entry (default the key itself, 'other' for none)
 */
export function frontSVG(fixture, products, opts = {}) {
  const L = frontLayout(fixture, products, opts);
  const fs = L.fs, id = esc(opts.idPrefix ?? 'pg');
  const out = [];
  const pegs = L.spaces.filter((s) => s.kind === 'peg');
  if (pegs.length) {
    out.push('<defs>' + [...new Set(pegs.map((s) => s.pitch))].map((p) =>
      `<pattern id="${id}-peg-${String(p).replace('.', '_')}" width="${p}" height="${p}" patternUnits="userSpaceOnUse"><circle cx="${r2(p / 2)}" cy="${r2(p / 2)}" r="${r2(Math.min(0.35, p / 5))}" fill="#94a3b8"/></pattern>`).join('') + '</defs>');
  }
  for (const s of L.spaces) {
    out.push(`<rect class="pg-space" data-shelf="${s.shelf}" x="${s.x}" y="${r2(s.y)}" width="${s.w}" height="${s.h}" fill="#f8fafc"/>`);
    if (s.kind === 'peg') out.push(`<rect x="${s.x}" y="${r2(s.y)}" width="${s.w}" height="${s.h}" fill="url(#${id}-peg-${String(s.pitch).replace('.', '_')})"/>`);
  }
  for (const o of L.overflow) {
    out.push(`<rect class="${o.squeezed ? 'pg-squeeze' : 'pg-over'}" x="${r2(o.x)}" y="${r2(o.y)}" width="${o.w}" height="${o.h}" fill="${o.squeezed ? 'rgba(245,158,11,.25)' : 'rgba(220,38,38,.25)'}" stroke="${o.squeezed ? '#d97706' : '#dc2626'}" stroke-width="0.3" stroke-dasharray="1 0.6"/>`);
  }
  for (const r of [...L.posts, ...L.boards]) out.push(`<rect x="${r2(r.x)}" y="${r2(r.y)}" width="${r2(r.w)}" height="${r2(r.h)}" fill="#64748b"/>`);
  for (const b of L.blocks) {
    const g = [`<g class="pg-pos${b.bad ? ' bad' : ''}${b.known ? '' : ' unknown'}" data-pos="${b.shelf}:${b.pos}" transform="translate(${b.x} ${b.y})">`];
    for (const c of b.cells) g.push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${esc(b.color)}" stroke="rgba(15,23,42,.35)" stroke-width="0.15"/>`);
    g.push(`<rect width="${b.w}" height="${b.h}" fill="none" stroke="${b.bad ? '#dc2626' : '#334155'}" stroke-width="${b.bad ? 0.6 : 0.3}"/>`);
    // 0.55 em is an average glyph width for system-ui; names are truncated with an ellipsis rather than overflowing
    // into neighbouring blocks.
    const chars = Math.floor(b.w / (fs * 0.55));
    if (opts.labels !== false && chars >= 3 && b.h >= fs * 1.4) {
      const name = b.name.length > chars ? b.name.slice(0, chars - 1) + '…' : b.name;
      g.push(`<rect y="${r2(b.h - fs * 1.4)}" width="${b.w}" height="${r2(fs * 1.4)}" fill="rgba(255,255,255,.8)"/>`);
      g.push(`<text x="${r2(b.w / 2)}" y="${r2(b.h - fs * 0.4)}" font-size="${r2(fs)}" text-anchor="middle" fill="#0f172a">${esc(name)}</text>`);
    }
    if (b.fz > 1 && b.w > fs * 3) g.push(`<text x="${r2(b.w - fs * 0.3)}" y="${r2(fs * 1.1)}" font-size="${r2(fs * 0.9)}" text-anchor="end" fill="#0f172a">×${b.fz}</text>`);
    if (b.noStock) g.push(`<circle cx="${r2(fs * 0.9)}" cy="${r2(fs * 0.9)}" r="${r2(fs * 0.6)}" fill="#dc2626"/>`);
    if (!b.known) g.push(`<text x="${r2(b.w / 2)}" y="${r2(b.h / 2 + fs * 0.5)}" font-size="${r2(fs * 1.5)}" text-anchor="middle" fill="#0f172a">?</text>`);
    g.push(`<title>${esc(b.name)} — ${b.fx}×${b.fy}×${b.fz}</title></g>`);
    out.push(g.join(''));
  }
  L.spaces.forEach((s) => out.push(`<text x="${s.x + 1}" y="${r2(s.y + fs * 1.2)}" font-size="${r2(fs)}" fill="#475569">${s.shelf + 1}</text>`));

  let H = L.height;
  if (opts.legend && L.legend.length) {
    const name = opts.legendName ?? ((k) => (k == null ? 'other' : String(k)));
    let lx = 0, ly = H + fs * 1.5;
    for (const it of L.legend) {
      const text = name(it.key), w = fs * 1.6 + text.length * fs * 0.55 + fs;
      if (lx && lx + w > L.width) { lx = 0; ly += fs * 1.6; }
      out.push(`<rect x="${r2(lx)}" y="${r2(ly - fs * 0.85)}" width="${r2(fs)}" height="${r2(fs)}" fill="${esc(it.color)}" stroke="#334155" stroke-width="0.15"/>`);
      out.push(`<text x="${r2(lx + fs * 1.4)}" y="${r2(ly)}" font-size="${r2(fs)}" fill="#0f172a">${esc(text)}</text>`);
      lx += w;
    }
    H = ly + fs * 0.6;
  }
  let top = -2;
  if (opts.title) { top = -2 - fs * 1.8; out.unshift(`<text x="0" y="${r2(-2 - fs * 0.5)}" font-size="${r2(fs * 1.2)}" font-weight="700" fill="#0f172a">${esc(opts.title)}</text>`); }
  const vbW = L.width + 4, vbH = H - top + 2;
  const mmUnit = opts.unit === 'mm';
  // mm output: 1 cm of fixture = 10 / ratio mm on paper (1:10 -> 1 mm per cm).
  const k = mmUnit ? 10 / (opts.ratio ?? 10) : opts.scale ?? 3;
  const u = mmUnit ? 'mm' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(vbW * k)}${u}" height="${r2(vbH * k)}${u}" viewBox="-2 ${r2(top)} ${r2(vbW)} ${r2(vbH)}" font-family="system-ui, sans-serif" role="img" aria-label="${esc(opts.title ?? fixture.name ?? 'planogram')}">`
    + out.join('') + '</svg>';
}
