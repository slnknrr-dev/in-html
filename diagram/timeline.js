// diagram/timeline.js - the Mermaid timeline: title, sections, "period : event : event" lines and ": event"
// continuation lines. Periods are columns along an arrow; their events hang below; a section spans its periods and
// gives them one colour (without sections every period has its own).
//
//   parseTimeline(src) -> { title, sections: [{ name, periods: [{ label, events: [text] }] }] }
//   timelineSVG(src, opts) -> SVG text

import { registerDiagram } from './index.js';
import { nextId, esc } from './svg.js';
import { labelBox, textWidth } from './measure.js';
import { sourceLines, themeOf, textAt, svgDoc, fail, num, ink, markerSet } from './kit.js';

//
// No graph layout: periods are equal-role columns placed left to right in source order, each as wide as its widest
// text (capped by word wrapping), so the picture is a single linear pass.
export function parseTimeline(src) {
  const { title, lines } = sourceLines(src);
  const out = { title, sections: [] };
  let header = false, sec = null, period = null;
  for (const { text, line } of lines) {
    let m;
    if (!header) { if (/^timeline\b/.test(text)) { header = true; continue; } fail(line, 'expected "timeline"'); }
    if ((m = /^title\s+(.+)$/i.exec(text))) { out.title = m[1].trim(); continue; }
    if ((m = /^section\s+(.+)$/i.exec(text))) { sec = { name: m[1].trim(), periods: [] }; out.sections.push(sec); continue; }
    if (/^(accTitle|accDescr)\b/.test(text)) continue;
    if (text.startsWith(':')) {
      if (!period) fail(line, 'an event without a period');
      // Continuation ": a : b" splits on " : " (spaces required) so a colon inside an event text ("10:30") survives.
      // The period line itself splits on any colon: KNOWN DEFECT: "10:30 : Meeting" yields the period "10" and the events
      // "30", "Meeting". Fix: split period lines on /\s+:\s+/ like continuation lines.
      period.events.push(...text.slice(1).split(/\s+:\s+/).map((x) => x.trim()).filter(Boolean));
      continue;
    }
    if (!sec) { sec = { name: '', periods: [] }; out.sections.push(sec); }
    const parts = text.split(/\s*:\s*/);
    period = { label: parts[0].trim(), events: parts.slice(1).map((x) => x.trim()).filter(Boolean) };
    sec.periods.push(period);
  }
  if (!header) fail(0, 'expected "timeline"');
  return out;
}

export function timelineSVG(src, opts = {}) {
  const T = parseTimeline(src);
  const t = themeOf(opts);
  const fs = opts.fontSize || 14, lh = fs * 1.3;
  const id = nextId(opts.idPrefix);
  const mk = markerSet(id, t);
  const named = T.sections.some((s) => s.name);
  const cols = [];
  T.sections.forEach((s, si) => s.periods.forEach((p) => cols.push({ p, si })));
  const wrapW = 170;
  const boxOf = (s, size) => { const b = labelBox(s, { fontSize: size }); return { w: Math.min(wrapW, b.w) + 20, h: b.h + 14 }; };
  // Long texts wrap at the column width (by words).
  // Greedy word wrap at wrapW using the estimated text width. A single word wider than wrapW is not broken and
  // overflows its box (boxOf caps the box width at wrapW + 20).
  const wrap = (s, size) => {
    const out = [];
    for (const para of String(s).split(/\n|<br\s*\/?>/i)) {
      let cur = '';
      for (const w of para.split(/\s+/)) { const nx = cur ? cur + ' ' + w : w; if (cur && textWidth(nx, size) > wrapW) { out.push(cur); cur = w; } else cur = nx; }
      out.push(cur);
    }
    return out.join('\n');
  };
  for (const c of cols) { c.label = wrap(c.p.label, fs); c.events = c.p.events.map((e) => wrap(e, fs * 0.9)); c.w = Math.max(110, boxOf(c.label, fs).w, ...c.events.map((e) => boxOf(e, fs * 0.9).w)); }
  const gap = 18;
  const titleH = T.title ? lh + 18 : 6;
  const secH = named ? lh + 16 : 0;
  const periodH = Math.max(...cols.map((c) => boxOf(c.label, fs).h), lh + 14);
  const y0 = titleH + secH + 10, axisY = y0 + periodH + 22;
  const body = [];
  let x = 16;
  for (const c of cols) { c.x = x; x += c.w + gap; }
  const W = Math.max(x + 6, T.title ? textWidth(T.title, fs * 1.15, { bold: true }) + 30 : 0);
  let maxY = axisY + 20;
  // Colour by section when sections are named (a section reads as one group), else one colour per period.
  const colOf = (c) => t.palette[(named ? c.si : cols.indexOf(c)) % t.palette.length];
  if (named) {
    T.sections.forEach((s, si) => {
      const cs = cols.filter((c) => c.si === si);
      if (!cs.length || !s.name) return;
      const l = cs[0].x, r = cs[cs.length - 1].x + cs[cs.length - 1].w, col = t.palette[si % t.palette.length];
      body.push(`<rect x="${num(l)}" y="${num(titleH)}" width="${num(r - l)}" height="${num(secH - 6)}" rx="6" fill="${esc(col)}"/>` + textAt(s.name, (l + r) / 2, titleH + (secH - 6) / 2, { size: fs, fill: ink(col), bold: true }));
    });
  }
  const arrow = mk.use('arrow', t.edge);
  body.push(`<path d="M8 ${num(axisY)}H${num(W - 8)}" stroke="${esc(t.edge)}" stroke-width="2.4" marker-end="url(#${arrow})"/>`);
  for (const c of cols) {
    const col = colOf(c), cx = c.x + c.w / 2;
    body.push(`<rect x="${num(c.x)}" y="${num(y0)}" width="${num(c.w)}" height="${num(periodH)}" rx="6" fill="${esc(col)}"/>` + textAt(c.label, cx, y0 + periodH / 2, { size: fs, fill: ink(col), bold: true }));
    body.push(`<circle cx="${num(cx)}" cy="${num(axisY)}" r="5" fill="${esc(col)}" stroke="${esc(t.hollow || '#fff')}" stroke-width="1.5"/>`);
    let y = axisY + 20;
    if (c.events.length) body.push(`<path d="M${num(cx)} ${num(axisY + 6)}V${num(y)}" stroke="${esc(col)}" stroke-width="1.4" stroke-dasharray="3 3"/>`);
    for (const e of c.events) {
      const b = boxOf(e, fs * 0.9);
      body.push(`<rect x="${num(c.x)}" y="${num(y)}" width="${num(c.w)}" height="${num(b.h)}" rx="5" fill="${esc(col)}" fill-opacity="${t.dark ? 0.28 : 0.18}" stroke="${esc(col)}" stroke-width="1.2"/>` + textAt(e, cx, y + b.h / 2, { size: fs * 0.9, fill: t.text }));
      y += b.h + 10;
    }
    maxY = Math.max(maxY, y);
  }
  if (T.title) body.unshift(textAt(T.title, W / 2, 10 + lh / 2, { size: fs * 1.15, fill: t.text, bold: true }));
  return svgDoc({ kind: 'timeline', id, width: W, height: maxY + 6, body: body.join(''), defs: mk.defs(), title: T.title, opts });
}

registerDiagram('timeline', { detect: /^timeline\b/, render: timelineSVG });
