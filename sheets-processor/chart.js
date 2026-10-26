// sheets-processor/chart.js - SVG charts of a selection (bar, line, pie) and of column statistics (histogram): data
// extraction from a block of cells, "nice" axis ticks, a categorical palette with separate light and dark steps (CSS
// custom properties, or inline colours for exported files), thin marks, rounded bar ends, legends for two or more series
// and per-mark tooltips (data-tip). No DOM: returns SVG text.
// 
//   chartData(block, { display }) -> { labels, series: [{ name, values }], truncated } | null   block: rows of values
//   chartSVG(data, { type: 'bar' | 'line' | 'pie', width, height, inline, fmt }) -> SVG text
//   histogramSVG(bins, { width, height, fmt }) -> SVG text
// 
// Two colour modes: on screen the SVG uses var(--sp-*) and currentColor, so it follows the theme live; exported files
// (inline: true) get literal light colours and a white background, because a standalone SVG/PNG has no page CSS.
// Security: every text that reaches the SVG goes through esc(); the result is inserted with innerHTML.

export const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  other: { light: '#9a9993', dark: '#6f6e69' },
};
// Limits: more than 8 series exhaust the palette; more than 400 points make bars thinner than a pixel.
const MAX_SERIES = 8;
const MAX_POINTS = 400;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';

// Labels from the first column when it is text (display texts when given, e.g. formatted dates), series from the
// numeric columns, series names from a header row (a first row of text over numbers).
// Header detection: a first row of only text over rows with numbers names the series.
export function chartData(block, { display } = {}) {
  let idx = block.map((_, i) => i).filter((i) => block[i].some((v) => v != null && v !== ''));
  if (!idx.length) return null;
  const w = Math.max(...idx.map((i) => block[i].length));
  const first = block[idx[0]];
  const head = idx.length > 1 && first.every((v) => v == null || typeof v === 'string') && idx.slice(1).some((i) => block[i].some(isNum)) ? first : null;
  if (head) idx = idx.slice(1);
  // Column kind by majority: numbers win ties, so a numeric column with a few notes is still a series.
  const colKind = (c) => {
    let n = 0, t = 0;
    for (const i of idx) { const v = block[i][c]; if (isNum(v)) n++; else if (isText(v)) t++; }
    return n >= t && n ? 'num' : t ? 'text' : 'empty';
  };
  const kinds = Array.from({ length: w }, (_, c) => colKind(c));
  // a first numeric column shown as text (dates, years) labels the points when more numbers follow
  const firstIsLabel = kinds[0] === 'text' || (kinds[0] === 'num' && display && kinds.slice(1).includes('num') && idx.some((i) => display[i][0] !== String(block[i][0])));
  const labelCol = firstIsLabel ? 0 : -1;
  const seriesCols = kinds.map((k, c) => (k === 'num' && c !== labelCol ? c : -1)).filter((c) => c >= 0).slice(0, MAX_SERIES);
  if (!seriesCols.length) return null;
  const truncated = idx.length > MAX_POINTS;
  idx = idx.slice(0, MAX_POINTS);
  const labels = idx.map((i, n) => (labelCol >= 0 ? (display ? display[i][labelCol] : String(block[i][labelCol] ?? '')) : String(n + 1)));
  const series = seriesCols.map((c, k) => ({
    name: head && head[c] != null && String(head[c]).trim() ? String(head[c]) : 'Series ' + (k + 1),
    values: idx.map((i) => (isNum(block[i][c]) ? block[i][c] : null)),
  }));
  return { labels, series, truncated };
}

// A flat range is widened (to 0 or ±1) so the axis has a span; tiny float residue near zero is snapped to 0.
function niceTicks(lo, hi, count = 5) {
  if (lo === hi) { lo = lo > 0 ? 0 : lo - 1; hi = hi > 0 ? hi : hi + 1; }
  const span = hi - lo;
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e9 ? 0 : v);
  return ticks;
}

const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return +(v / 1e9).toPrecision(3) + 'B';
  if (a >= 1e6) return +(v / 1e6).toPrecision(3) + 'M';
  if (a >= 1e4) return +(v / 1e3).toPrecision(3) + 'k';
  return String(+v.toPrecision(4));
};

function colorFor(i, inline) {
  return inline ? PALETTE.light[i % MAX_SERIES] : `var(--sp-s${(i % MAX_SERIES) + 1})`;
}

function frame(width, height, inline, body, title) {
  const ink = inline ? '#1d2330' : 'currentColor';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title || 'Chart')}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="${ink}">` +
    (inline ? `<rect width="${width}" height="${height}" fill="#ffffff"/>` : '') + body + '</svg>';
}

// Legend only for 2+ series; text width estimated at 6.6px per character (no DOM to measure in).
function legend(series, x, y, maxW, inline) {
  if (series.length < 2) return { svg: '', h: 0 };
  let out = '', cx = x, cy = y;
  series.forEach((s, i) => {
    const name = s.name.length > 24 ? s.name.slice(0, 23) + '…' : s.name;
    const w = 22 + name.length * 6.6 + 14;
    if (cx + w > x + maxW && cx > x) { cx = x; cy += 18; }
    out += `<rect x="${cx}" y="${cy - 9}" width="12" height="12" rx="3" fill="${colorFor(i, inline)}"/><text x="${cx + 18}" y="${cy + 1}">${esc(name)}</text>`;
    cx += w;
  });
  return { svg: out, h: cy - y + 22 };
}

export function chartSVG(data, { type = 'bar', width = 720, height = 380, inline = false, title = '', fmt = compact } = {}) {
  if (!data || !data.series.length) return '';
  const muted = inline ? '#6b7280' : 'var(--sp-muted)';
  const grid = inline ? '#e5e7eb' : 'var(--sp-gridline)';
  const surf = inline ? '#ffffff' : 'var(--sp-surface)';
  if (type === 'pie') return pieSVG(data, { width, height, inline, title, fmt, muted, surf });
  const series = data.series;
  const n = data.labels.length;
  const lg = legend(series, 56, 18, width - 72, inline);
  const top = 16 + lg.h, left = 56, right = 16;
  const longest = Math.max(...data.labels.map((l) => l.length));
  // Labels rotate −45° when they would not fit horizontally; every n-th label is drawn so they never overlap.
  const rotate = n * Math.min(longest, 12) * 6.5 > width - left - right;
  const bottom = rotate ? 70 : 34;
  const pw = width - left - right, ph = height - top - bottom;
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.values) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === Infinity) return '';
  // Bars always include zero: a bar chart with a truncated axis exaggerates differences.
  if (type === 'bar') { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  const ticks = niceTicks(lo, hi);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const Y = (v) => top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  let body = lg.svg;
  for (const t of ticks) body += `<line x1="${left}" x2="${width - right}" y1="${Y(t)}" y2="${Y(t)}" stroke="${grid}" stroke-width="1"/><text x="${left - 8}" y="${Y(t) + 4}" text-anchor="end" fill="${muted}">${esc(fmt(t))}</text>`;
  const step = pw / Math.max(1, n);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / (rotate ? 16 : 70)))));
  data.labels.forEach((l, i) => {
    if (i % every) return;
    const x = left + step * (i + 0.5);
    const txt = esc(l.length > 14 ? l.slice(0, 13) + '…' : l);
    body += rotate ? `<text transform="translate(${x + 4},${top + ph + 10}) rotate(-45)" text-anchor="end" fill="${muted}">${txt}</text>`
      : `<text x="${x}" y="${top + ph + 20}" text-anchor="middle" fill="${muted}">${txt}</text>`;
  });
  // Baseline at zero when zero is in range, otherwise at the nearest axis end.
  const base = Y(Math.max(y0, Math.min(0, y1)));
  if (type === 'bar') {
    const groupW = step * 0.78;
    const bw = Math.max(1, (groupW - (series.length - 1) * 2) / series.length);
    series.forEach((s, k) => {
      s.values.forEach((v, i) => {
        if (v == null) return;
        const x = left + step * i + (step - groupW) / 2 + k * (bw + 2);
        const y = Math.min(Y(v), base), hgt = Math.max(1, Math.abs(Y(v) - base));
        const r = Math.min(4, bw / 2, hgt);
        const tip = esc(`${data.labels[i]} · ${s.name}: ${fmt(v)}`);
        // rounded at the data end, square at the baseline
        const d = v >= 0
          ? `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + hgt}Z`
          : `M${x},${y}V${y + hgt - r}Q${x},${y + hgt} ${x + r},${y + hgt}H${x + bw - r}Q${x + bw},${y + hgt} ${x + bw},${y + hgt - r}V${y}Z`;
        body += `<path d="${d}" fill="${colorFor(k, inline)}" data-tip="${tip}"><title>${tip}</title></path>`;
      });
    });
  } else {
    series.forEach((s, k) => {
      // Gaps (null values) lift the pen: a missing value breaks the line instead of drawing a false slope.
      let d = '', pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const x = left + step * (i + 0.5);
        d += (pen ? 'L' : 'M') + x.toFixed(1) + ',' + Y(v).toFixed(1);
        pen = true;
      });
      body += `<path d="${d}" fill="none" stroke="${colorFor(k, inline)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (n <= 60) {
        s.values.forEach((v, i) => {
          if (v == null) return;
          const tip = esc(`${data.labels[i]} · ${s.name}: ${fmt(v)}`);
          body += `<circle cx="${left + step * (i + 0.5)}" cy="${Y(v)}" r="4" fill="${colorFor(k, inline)}" stroke="${surf}" stroke-width="2" data-tip="${tip}"><title>${tip}</title></circle>`;
        });
      }
    });
  }
  body += `<line x1="${left}" x2="${width - right}" y1="${base}" y2="${base}" stroke="${muted}" stroke-width="1"/>`;
  return frame(width, height, inline, body, title);
}

// Pie: first series only, positive values, sorted, at most 6 slices plus "Other" — more slices are unreadable.
function pieSVG(data, { width, height, inline, title, fmt, muted, surf }) {
  const s = data.series[0];
  let items = data.labels.map((l, i) => ({ l, v: s.values[i] })).filter((x) => x.v != null && x.v > 0);
  if (!items.length) return '';
  items.sort((a, b) => b.v - a.v);
  if (items.length > 7) {
    const rest = items.slice(6).reduce((a, x) => a + x.v, 0);
    items = [...items.slice(0, 6), { l: 'Other', v: rest, other: true }];
  }
  const total = items.reduce((a, x) => a + x.v, 0);
  const cx = Math.min(width * 0.36, height / 2 + 10), cy = height / 2, r = Math.min(cx, cy) - 18;
  let a0 = -Math.PI / 2, body = '';
  items.forEach((x, i) => {
    const a1 = a0 + (x.v / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    const fill = x.other ? (inline ? PALETTE.other.light : 'var(--sp-other)') : colorFor(i, inline);
    const tip = esc(`${x.l}: ${fmt(x.v)} (${((x.v / total) * 100).toFixed(1)}%)`);
    // A single 100% slice cannot be drawn as an arc (start = end point): two half-circle arcs instead.
    const d = items.length === 1 ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z` : `M${cx},${cy}L${p(a0)}A${r},${r} 0 ${large},1 ${p(a1)}Z`;
    body += `<path d="${d}" fill="${fill}" stroke="${surf}" stroke-width="2" data-tip="${tip}"><title>${tip}</title></path>`;
    a0 = a1;
  });
  // legend with values beside the pie
  const lx = cx + r + 28;
  items.forEach((x, i) => {
    const y = cy - (items.length * 22) / 2 + i * 22 + 12;
    const fill = x.other ? (inline ? PALETTE.other.light : 'var(--sp-other)') : colorFor(i, inline);
    const name = x.l.length > 22 ? x.l.slice(0, 21) + '…' : x.l;
    body += `<rect x="${lx}" y="${y - 10}" width="12" height="12" rx="3" fill="${fill}"/><text x="${lx + 18}" y="${y}">${esc(name)}</text><text x="${width - 12}" y="${y}" text-anchor="end" fill="${muted}">${((x.v / total) * 100).toFixed(1)}%</text>`;
  });
  return frame(width, height, inline, body, title);
}

export function histogramSVG(bins, { width = 300, height = 120, fmt = compact } = {}) {
  if (!bins.length) return '';
  const max = Math.max(...bins.map((b) => b.n));
  const left = 4, right = 4, top = 6, bottom = 20;
  const pw = width - left - right, ph = height - top - bottom;
  const bw = pw / bins.length;
  let body = '';
  bins.forEach((b, i) => {
    const hgt = max ? (b.n / max) * ph : 0;
    const x = left + i * bw + 1, y = top + ph - hgt, w = Math.max(1, bw - 2);
    const r = Math.min(3, w / 2, hgt);
    const tip = esc(`${fmt(b.x0)} – ${fmt(b.x1)}: ${b.n}`);
    if (hgt > 0) body += `<path d="M${x},${top + ph}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${top + ph}Z" fill="var(--sp-s1)" data-tip="${tip}"><title>${tip}</title></path>`;
  });
  body += `<line x1="${left}" x2="${width - right}" y1="${top + ph}" y2="${top + ph}" stroke="var(--sp-muted)"/>`;
  body += `<text x="${left}" y="${height - 4}" fill="var(--sp-muted)" font-size="11">${esc(fmt(bins[0].x0))}</text><text x="${width - right}" y="${height - 4}" text-anchor="end" fill="var(--sp-muted)" font-size="11">${esc(fmt(bins[bins.length - 1].x1))}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" font-family="system-ui, sans-serif" font-size="12">${body}</svg>`;
}

export { compact };
