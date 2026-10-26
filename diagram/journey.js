// diagram/journey.js - the Mermaid user journey: title, sections, "Task: score: Actor, Actor" lines (scores 1–5).
// Tasks are columns under their section; a face per task sits at the height of its score (5 at the top) with the
// task's actors as coloured dots; the actors are listed on the left.
//
//   parseJourney(src) -> { title, sections: [{ name, tasks: [{ name, score, actors }] }], actors: [name] }
//   journeySVG(src, opts) -> SVG text

import { registerDiagram } from './index.js';
import { nextId, esc } from './svg.js';
import { labelBox, textWidth } from './measure.js';
import { sourceLines, themeOf, textAt, svgDoc, fail, num, ink } from './kit.js';

//
// Scores are clamped to 0..5 rather than rejected: the face height is the only use of the score, and an out-of-range
// value should still draw. Actors are collected in first-appearance order, which fixes their legend order and colour.
export function parseJourney(src) {
  const { title, lines } = sourceLines(src);
  const out = { title, sections: [], actors: [] };
  let header = false, sec = null;
  for (const { text, line } of lines) {
    let m;
    if (!header) { if (/^journey\b/.test(text)) { header = true; continue; } fail(line, 'expected "journey"'); }
    if ((m = /^title\s+(.+)$/i.exec(text))) { out.title = m[1].trim(); continue; }
    if ((m = /^section\s+(.+)$/i.exec(text))) { sec = { name: m[1].trim(), tasks: [] }; out.sections.push(sec); continue; }
    if (/^(accTitle|accDescr)\b/.test(text)) continue;
    if ((m = /^(.+?)\s*:\s*(\d+(?:\.\d+)?)\s*(?::\s*(.*))?$/.exec(text))) {
      if (!sec) { sec = { name: '', tasks: [] }; out.sections.push(sec); }
      const actors = (m[3] || '').split(',').map((x) => x.trim()).filter(Boolean);
      for (const a of actors) if (!out.actors.includes(a)) out.actors.push(a);
      sec.tasks.push({ name: m[1].trim(), score: Math.max(0, Math.min(5, +m[2])), actors });
      continue;
    }
    fail(line, 'cannot read: ' + text.slice(0, 60));
  }
  if (!header) fail(0, 'expected "journey"');
  return out;
}

export function journeySVG(src, opts = {}) {
  const J = parseJourney(src);
  const t = themeOf(opts);
  const fs = opts.fontSize || 14, lh = fs * 1.3;
  const id = nextId(opts.idPrefix);
  // Actor colours start at palette index 3 so they rarely coincide with the first section colours (indices 0..2).
  const actorColor = (a) => t.palette[(J.actors.indexOf(a) + 3) % t.palette.length];
  const leftW = J.actors.length ? Math.max(...J.actors.map((a) => textWidth(a, fs * 0.9))) + 40 : 10;
  const titleH = J.title ? lh + 18 : 6;
  const secH = lh + 14;
  const tasks = [];
  J.sections.forEach((s, si) => s.tasks.forEach((k) => tasks.push({ k, si })));
  const colW = Math.max(110, ...tasks.map(({ k }) => Math.min(170, labelBox(k.name, { fontSize: fs * 0.9 }).w + 24)));
  const taskH = Math.max(lh + 16, ...tasks.map(({ k }) => labelBox(k.name, { fontSize: fs * 0.9 }).h + 16));
  const gap = 12, x0 = leftW + 10;
  const y0 = titleH, yTask = y0 + secH + 8, yScore = yTask + taskH + 36, step = 26;
  const body = [];
  tasks.forEach((c, i) => { c.x = x0 + i * (colW + gap); });
  const W = Math.max(x0 + tasks.length * (colW + gap) + 6, J.title ? textWidth(J.title, fs * 1.15, { bold: true }) + 30 : 0);
  if (J.title) body.push(textAt(J.title, W / 2, 10 + lh / 2, { size: fs * 1.15, fill: t.text, bold: true }));
  J.actors.forEach((a, i) => { const y = yTask + 10 + i * (lh + 4); body.push(`<circle cx="18" cy="${num(y)}" r="6" fill="${esc(actorColor(a))}"/>` + textAt(a, 30, y, { size: fs * 0.9, fill: t.text, anchor: 'start' })); });
  J.sections.forEach((s, si) => {
    const cs = tasks.filter((c) => c.si === si);
    if (!cs.length) return;
    const col = t.palette[si % t.palette.length];
    const l = cs[0].x, r = cs[cs.length - 1].x + colW;
    if (s.name) body.push(`<rect x="${num(l)}" y="${num(y0)}" width="${num(r - l)}" height="${num(secH)}" rx="5" fill="${esc(col)}"/>` + textAt(s.name, (l + r) / 2, y0 + secH / 2, { size: fs, fill: ink(col), bold: true }));
    for (const c of cs) {
      const cx = c.x + colW / 2;
      body.push(`<rect x="${num(c.x)}" y="${num(yTask)}" width="${colW}" height="${num(taskH)}" rx="5" fill="${esc(col)}" fill-opacity="${t.dark ? 0.3 : 0.22}" stroke="${esc(col)}"/>` + textAt(c.k.name, cx, yTask + taskH / 2, { size: fs * 0.9, fill: t.text }));
      // Face y: score 5 at the top, 26px per point. Mood (smile/flat/frown) and face colour are fixed, theme-independent
      // colours: they encode sentiment, which should read the same in every theme.
      const fy = yScore + (5 - c.k.score) * step;
      body.push(`<path d="M${num(cx)} ${num(yTask + taskH)}V${num(fy - 14)}" stroke="${esc(t.edge)}" stroke-dasharray="3 3" opacity="0.7"/>`);
      const mood = c.k.score >= 4 ? `M${num(cx - 6)} ${num(fy + 4)}q6 6 12 0` : c.k.score <= 2 ? `M${num(cx - 6)} ${num(fy + 7)}q6 -6 12 0` : `M${num(cx - 6)} ${num(fy + 5)}h12`;
      const face = c.k.score >= 4 ? '#ffd65c' : c.k.score <= 2 ? '#ff9a8a' : '#f2e3a0';
      body.push(`<g class="dg-face"><title>${esc(c.k.name)}: ${c.k.score}</title><circle cx="${num(cx)}" cy="${num(fy)}" r="14" fill="${face}" stroke="#6b5a1e" stroke-width="1.2"/><circle cx="${num(cx - 5)}" cy="${num(fy - 4)}" r="1.8" fill="#3b2f10"/><circle cx="${num(cx + 5)}" cy="${num(fy - 4)}" r="1.8" fill="#3b2f10"/><path d="${mood}" fill="none" stroke="#3b2f10" stroke-width="1.6" stroke-linecap="round"/></g>`);
      c.k.actors.forEach((a, i) => body.push(`<circle cx="${num(cx - ((c.k.actors.length - 1) * 14) / 2 + i * 14)}" cy="${num(yTask + taskH + 9)}" r="5" fill="${esc(actorColor(a))}" stroke="${esc(t.hollow || '#fff')}"><title>${esc(a)}</title></circle>`));
    }
  });
  const H = Math.max(yScore + 5 * step + 22, yTask + J.actors.length * (lh + 4) + 16);
  return svgDoc({ kind: 'journey', id, width: W, height: H, body: body.join(''), title: J.title, opts });
}

registerDiagram('journey', { detect: /^journey\b/, render: journeySVG });
