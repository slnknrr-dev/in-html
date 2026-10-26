// diagram/sequence.js - the Mermaid sequence diagram: participants and actors (stick figures) with aliases, implicit
// participants in order of appearance, participant boxes (box <colour> <label> … end), messages of every arrow type
// (->, -->, ->>, -->>, -x, --x, -), --), <<->>, <<-->>), activations (+ / - on a message, activate / deactivate),
// notes (left of / right of / over A[,B]), nested loop / alt / else / opt / par / and / critical / option / break /
// rect <colour> blocks, autonumber [start [step]] / autonumber off, title, <br> line breaks, create / destroy (accepted).
// Laid out in columns: gaps grow so that every label, note and self message fits.
//
//   parseSequence(src) -> { title, participants: [{ id, label, kind, box }], boxes, events, errors }
//   sequenceSVG(src, opts) -> SVG text (opts: theme, fontSize, fontFamily, idPrefix)

import { registerDiagram } from './index.js';
import { nextId, esc } from './svg.js';
import { textWidth, labelLines } from './measure.js';
import { sourceLines, themeOf, textAt, markerSet, svgDoc, fail, num, ink, safeColor, unquote } from './kit.js';

//
// Two phases. parseSequence turns lines into a flat event list (messages, notes, block start/else/end, activations);
// sequenceSVG lays it out in one top-to-bottom pass with a running y. Unlike flowcharts there is no graph layout:
// participants are columns in order of appearance, time is the vertical axis, so a single sweep is exact.
// ARROWS: token -> [line style, head marker, tail marker?] (markers are svg.js MARKERS names).
const ARROWS = {
  '->': ['solid', 'none'], '-->': ['dotted', 'none'], '->>': ['solid', 'arrow'], '-->>': ['dotted', 'arrow'],
  '-x': ['solid', 'cross'], '--x': ['dotted', 'cross'], '-)': ['solid', 'open'], '--)': ['dotted', 'open'],
  '<<->>': ['solid', 'arrow', 'arrow'], '<<-->>': ['dotted', 'arrow', 'arrow'],
};
// Alternation order is longest-first ('<<-->>' before '-->>' before '->>' before '->'): regex alternation takes the
// first alternative that matches, so '->' first would cut '-->>' into '-' + '->' + '>B'. The from-id is lazy so the
// arrow is found at its first position; [+-]? after the arrow is the activation shorthand.
const MSG = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*(.+?)\s*(?::(.*))?$/;
const BLOCKS = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i;

export function parseSequence(src) {
  const { title: fmTitle, lines } = sourceLines(src);
  const out = { title: fmTitle, participants: [], boxes: [], events: [], errors: [] };
  const byId = new Map();
  const part = (id, props = {}) => {
    const key = id.trim();
    let p = byId.get(key);
    if (!p) { p = { id: key, label: key, kind: 'participant', box: null }; byId.set(key, p); out.participants.push(p); }
    Object.assign(p, props);
    return p;
  };
  // The stack tracks both participant boxes and control blocks so a stray "end" closes the right thing; boxes produce
  // no events (they are a header-row decoration), blocks do.
  // Note: the local `num` (autonumber state) shadows kit.js num() inside this function only; num() is not needed here.
  const stack = []; // 'box' | block kind
  let header = false, box = null, num = null;
  for (const { text, line } of lines) {
    let m;
    if (!header) { if (/^sequenceDiagram\b/.test(text)) { header = true; continue; } fail(line, 'expected "sequenceDiagram"'); }
    const s = text.replace(/;\s*$/, '');
    if ((m = /^title\s*:?\s*(.+)$/i.exec(s))) { out.title = m[1].trim(); continue; }
    if ((m = /^autonumber\b\s*(off|\d+)?\s*(\d+)?/i.exec(s))) { num = m[1] && /off/i.test(m[1]) ? null : { n: m[1] ? +m[1] : 1, step: m[2] ? +m[2] : 1 }; continue; }
    if ((m = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(s))) {
      const p = part(m[2], { kind: m[1].toLowerCase() });
      if (m[3]) p.label = unquote(m[3]);
      if (box && !p.box) { p.box = box.index; box.ids.push(p.id); }
      continue;
    }
    if (/^destroy\s+/i.test(s) || /^(accTitle|accDescr|links?|properties|details)\b/i.test(s)) continue;
    // "box Aqua Group" vs "box Group A": the first word is a colour only if it parses as rgb()/hsl()/#hex or is a known
    // colour name; otherwise the whole text is the label. A bare [a-z]+ test would eat the first word of every label.
    if ((m = /^box\b\s*(.*)$/i.exec(s))) {
      const words = m[1].trim();
      const cm = /^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\s*(.*)$/i.exec(words);
      const isColor = cm && (/^(rgb|hsl|#)/i.test(cm[1]) || KNOWN_COLORS.has(cm[1].toLowerCase()));
      box = { index: out.boxes.length, color: isColor && cm[1].toLowerCase() !== 'transparent' ? safeColor(cm[1]) : '', label: isColor ? cm[2] : words, ids: [] };
      out.boxes.push(box);
      stack.push('box');
      continue;
    }
    if ((m = BLOCKS.exec(s))) {
      const kind = m[1].toLowerCase();
      out.events.push({ type: 'start', kind, label: kind === 'rect' ? '' : m[2].trim(), color: kind === 'rect' ? safeColor(m[2]) : '', line });
      stack.push(kind);
      continue;
    }
    if ((m = /^(else|and|option)\b\s*(.*)$/i.exec(s))) {
      if (!stack.length || stack[stack.length - 1] === 'box') fail(line, `"${m[1]}" outside a block`);
      out.events.push({ type: 'else', label: m[2].trim() });
      continue;
    }
    if (/^end$/i.test(s)) {
      if (!stack.length) fail(line, '"end" without a block');
      const k = stack.pop();
      if (k === 'box') box = null; else out.events.push({ type: 'end' });
      continue;
    }
    if ((m = /^(activate|deactivate)\s+(.+)$/i.exec(s))) { out.events.push({ type: m[1].toLowerCase(), id: part(m[2]).id }); continue; }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(s))) {
      const ids = m[2].split(',').map((x) => part(x).id);
      out.events.push({ type: 'note', pos: m[1].toLowerCase().split(' ')[0], ids, text: m[3].trim() });
      continue;
    }
    if ((m = MSG.exec(s))) {
      const line0 = ARROWS[m[2]];
      const from = part(m[1]).id, to = part(m[4]).id;
      const ev = { type: 'msg', from, to, text: (m[5] || '').trim(), line: line0[0], head: line0[1], tail: line0[2] || 'none', act: m[3] || '' };
      if (num) { ev.number = num.n; num.n += num.step; }
      out.events.push(ev);
      continue;
    }
    out.errors.push({ line, message: 'cannot read: ' + s.slice(0, 60) });
  }
  if (!header) fail(0, 'expected "sequenceDiagram"');
  if (stack.length) fail(0, 'a block without "end"');
  return out;
}
const KNOWN_COLORS = new Set(['aqua', 'black', 'blue', 'fuchsia', 'gray', 'grey', 'green', 'lime', 'maroon', 'navy', 'olive', 'orange', 'purple', 'red', 'silver', 'teal', 'white', 'yellow', 'pink', 'brown', 'gold', 'lightblue', 'lightgreen', 'lightgrey', 'lightgray', 'lightyellow', 'beige', 'coral', 'khaki', 'lavender', 'salmon', 'tan', 'violet', 'wheat', 'transparent']);

// Column spacing as a constraint problem: every message/note needs a minimum horizontal distance between two
// columns (need = [from, to, width]). Constraints are applied narrowest-span first, each spreading its deficit evenly
// over the gaps it spans; applying wide spans first would over-widen gaps that a later narrow constraint widens again.
// Greedy, not optimal (an LP would be), but monotone and visually even.
export function sequenceSVG(src, opts = {}) {
  const P = parseSequence(src);
  if (!P.participants.length) fail(0, 'no participants');
  const t = themeOf(opts);
  const fs = opts.fontSize || 14, lh = fs * 1.3;
  const tw = (s, size = fs) => Math.max(0, ...labelLines(s).map((l) => textWidth(l, size)));
  const tl = (s) => (s ? labelLines(s).length : 0);
  const n = P.participants.length;
  const idx = new Map(P.participants.map((p, i) => [p.id, i]));
  const boxW = P.participants.map((p) => Math.max(tw(p.label) + 24, p.kind === 'actor' ? 60 : 80));
  const gaps = Array.from({ length: Math.max(0, n - 1) }, (_, k) => (boxW[k] + boxW[k + 1]) / 2 + 30);
  let leftM = 16, rightM = 16;
  const need = [];
  const noteW = (s) => Math.max(tw(s, fs * 0.92) + 20, 70);
  for (const e of P.events) {
    if (e.type === 'msg') {
      const a = idx.get(e.from), b = idx.get(e.to);
      const w = tw(e.text, fs * 0.92) + (e.number != null ? 34 : 24);
      if (a === b) { if (a < n - 1) need.push([a, a + 1, w + 46]); else rightM = Math.max(rightM, w + 50 - boxW[a] / 2); }
      else need.push([Math.min(a, b), Math.max(a, b), w]);
    } else if (e.type === 'note') {
      const is = e.ids.map((x) => idx.get(x)).sort((x, y) => x - y);
      const w = noteW(e.text);
      if (e.pos === 'left') { const i = is[0]; if (i > 0) need.push([i - 1, i, w + 16 + boxW[i - 1] / 2]); else leftM = Math.max(leftM, w + 16 - boxW[0] / 2); }
      else if (e.pos === 'right') { const i = is[is.length - 1]; if (i < n - 1) need.push([i, i + 1, w + 16 + boxW[i + 1] / 2]); else rightM = Math.max(rightM, w + 16 - boxW[i] / 2); }
      else if (is.length > 1) need.push([is[0], is[is.length - 1], w - 30]);
      else { leftM = Math.max(leftM, is[0] === 0 ? w / 2 - boxW[0] / 2 + 8 : 0); rightM = Math.max(rightM, is[0] === n - 1 ? w / 2 - boxW[n - 1] / 2 + 8 : 0); }
    }
  }
  need.sort((x, y) => (x[1] - x[0]) - (y[1] - y[0]));
  for (const [a, b, d] of need) {
    let cur = 0;
    for (let k = a; k < b; k++) cur += gaps[k];
    if (cur < d) for (let k = a; k < b; k++) gaps[k] += (d - cur) / (b - a);
  }
  // Nested frames are inset 10px per level, so margins grow with the maximum nesting depth.
  // Blocks need room on both sides for their frames.
  let depth = 0, maxDepth = 0;
  for (const e of P.events) { if (e.type === 'start') maxDepth = Math.max(maxDepth, ++depth); else if (e.type === 'end') depth--; }
  leftM += maxDepth * 10 + (maxDepth ? 6 : 0);
  rightM += maxDepth * 10 + (maxDepth ? 6 : 0);
  const cx = [];
  { let x = leftM + boxW[0] / 2; for (let i = 0; i < n; i++) { if (i) x += gaps[i - 1]; cx.push(x); } }
  const id = nextId(opts.idPrefix);
  const mk = markerSet(id, t);
  const titleH = P.title ? lh + 14 : 0;
  const boxLabelH = P.boxes.some((b) => b.label) ? lh + 6 : P.boxes.length ? 8 : 0;
  const headH = Math.max(...P.participants.map((p) => (p.kind === 'actor' ? 44 + tl(p.label) * lh : Math.max(38, tl(p.label) * lh + 16))));
  const top = 10 + titleH + boxLabelH;
  let y = top + headH + 22;

  const back = [], frames = [], acts = [], msgs = [], notes = [];
  // widen(): every open block grows to cover what is drawn inside it; frames are emitted at "end" when their extent is
  // finally known. That is why frames are collected in arrays and painted later in a fixed order.
  const open = []; // blocks: { kind, label, color, y0, l, r, elses: [{ y, label }] }
  const widen = (l, r) => { for (const b of open) { b.l = Math.min(b.l, l); b.r = Math.max(b.r, r); } };
  const active = P.participants.map(() => []);
  // Messages start/end at the edge of the active activation bar (stacked bars offset 5px per level), not at the
  // lifeline, as in UML.
  const edgeX = (i, toward) => { const L = active[i].length; return L ? cx[i] + (toward > cx[i] ? 1 : -1) * (5 + (L - 1) * 5) : cx[i]; };
  let lastLine = null;
  const startAct = (i, at) => active[i].push(at);
  const endAct = (i, at) => { const y0 = active[i].pop(); if (y0 != null) acts.push([i, y0, at, active[i].length]); };
  const boxSpan = (i) => [cx[i] - boxW[i] / 2, cx[i] + boxW[i] / 2];
  const fsS = fs * 0.92;
  for (const e of P.events) {
    if (e.type === 'msg') {
      const a = idx.get(e.from), b = idx.get(e.to);
      const nl = Math.max(1, tl(e.text));
      const ly = y + nl * fsS * 1.3 + 4;
      const color = t.edge;
      const head = mk.use(e.head, color), tail = mk.use(e.tail, color);
      const dash = e.line === 'dotted' ? ' stroke-dasharray="4 3"' : '';
      if (e.act === '+') startAct(b, ly);
      if (a === b) {
        const x0 = edgeX(a, cx[a] + 1), x1 = x0 + 34;
        msgs.push(`<path d="M${num(x0)} ${num(ly)}H${num(x1)}V${num(ly + 20)}H${num(x0 + 2)}" fill="none" stroke="${esc(color)}" stroke-width="1.4"${dash}${head ? ` marker-end="url(#${head})"` : ''}/>`);
        if (e.text) msgs.push(textAt(e.text, x0 + 6, y + (nl * fsS * 1.3) / 2, { size: fsS, fill: t.text, anchor: 'start' }));
        widen(boxSpan(a)[0], Math.max(boxSpan(a)[1], x0 + 10 + tw(e.text, fsS)));
        y = ly + 34;
      } else {
        const x0 = edgeX(a, cx[b]), x1 = edgeX(b, cx[a]);
        msgs.push(`<path d="M${num(x0)} ${num(ly)}H${num(x1)}" fill="none" stroke="${esc(color)}" stroke-width="1.4"${dash}${head ? ` marker-end="url(#${head})"` : ''}${tail ? ` marker-start="url(#${tail})"` : ''}/>`);
        if (e.text) msgs.push(textAt(e.text, (x0 + x1) / 2 + (e.number != null ? 8 : 0), y + (nl * fsS * 1.3) / 2, { size: fsS, fill: t.text }));
        const [l0, r0] = boxSpan(Math.min(a, b)), [l1, r1] = boxSpan(Math.max(a, b));
        widen(Math.min(l0, l1), Math.max(r0, r1));
        y = ly + 16;
      }
      if (e.number != null) {
        const x0 = edgeX(a, a === b ? cx[a] + 1 : cx[b]);
        msgs.push(`<circle cx="${num(x0)}" cy="${num(ly)}" r="9" fill="${esc(t.stroke)}"/>` + textAt(String(e.number), x0, ly, { size: fs * 0.72, fill: ink(t.stroke), bold: true }));
      }
      if (e.act === '-') endAct(a, ly);
      lastLine = ly;
    } else if (e.type === 'activate') {
      startAct(idx.get(e.id), lastLine != null ? lastLine : y);
    } else if (e.type === 'deactivate') {
      endAct(idx.get(e.id), lastLine != null ? lastLine : y);
    } else if (e.type === 'note') {
      const is = e.ids.map((x) => idx.get(x)).sort((p, q) => p - q);
      const w0 = noteW(e.text), h = Math.max(1, tl(e.text)) * fsS * 1.3 + 14;
      let l, r;
      if (e.pos === 'left') { r = cx[is[0]] - 8; l = r - w0; }
      else if (e.pos === 'right') { l = cx[is[is.length - 1]] + 8; r = l + w0; }
      else if (is.length > 1) { l = cx[is[0]] - 24; r = cx[is[is.length - 1]] + 24; if (r - l < w0) { const c = (l + r) / 2; l = c - w0 / 2; r = c + w0 / 2; } }
      else { l = cx[is[0]] - w0 / 2; r = l + w0; }
      notes.push(`<path d="M${num(l)} ${num(y)}h${num(r - l - 8)}l8 8v${num(h - 8)}h${num(l - r)}z" fill="${esc(t.note)}" stroke="${esc(t.noteStroke)}" stroke-width="1.2"/>` + textAt(e.text, (l + r) / 2, y + h / 2, { size: fsS, fill: t.text }));
      widen(l, r);
      y += h + 12;
      lastLine = null;
    } else if (e.type === 'start') {
      open.push({ kind: e.kind, label: e.label, color: e.color, y0: y, l: Infinity, r: -Infinity, elses: [] });
      y += e.kind === 'rect' ? 10 : lh + 14;
      lastLine = null;
    } else if (e.type === 'else') {
      const b = open[open.length - 1];
      b.elses.push({ y: y + 2, label: e.label });
      y += lh + 12;
    } else if (e.type === 'end') {
      const b = open.pop();
      if (!isFinite(b.l)) { b.l = cx[0] - boxW[0] / 2; b.r = cx[n - 1] + boxW[n - 1] / 2; }
      const pad = 10;
      b.l -= pad; b.r += pad;
      y += 4;
      const fy0 = b.y0 - 4, fh = y - fy0;
      if (b.kind === 'rect') {
        back.push(`<rect x="${num(b.l)}" y="${num(fy0)}" width="${num(b.r - b.l)}" height="${num(fh)}" fill="${esc(b.color || t.group)}"${t.dark && b.color ? ' opacity="0.35"' : ''}/>`);
      } else {
        const kw = textWidth(b.kind, fs * 0.82, { bold: true }) + 16;
        let s = `<rect x="${num(b.l)}" y="${num(fy0)}" width="${num(b.r - b.l)}" height="${num(fh)}" fill="none" stroke="${esc(t.groupStroke)}" stroke-width="1.3"/>` +
          `<path d="M${num(b.l)} ${num(fy0)}h${num(kw)}v${num(lh - 6)}l-6 6h${num(6 - kw)}z" fill="${esc(t.group)}" stroke="${esc(t.groupStroke)}" stroke-width="1.3"/>` +
          textAt(b.kind, b.l + kw / 2 - 2, fy0 + lh / 2, { size: fs * 0.82, fill: t.groupText, bold: true });
        if (b.label) s += textAt('[' + b.label + ']', b.l + kw + 8, fy0 + lh / 2, { size: fs * 0.86, fill: t.text, anchor: 'start', bold: true });
        for (const el of b.elses) {
          s += `<path d="M${num(b.l)} ${num(el.y)}H${num(b.r)}" stroke="${esc(t.groupStroke)}" stroke-width="1.2" stroke-dasharray="5 4"/>`;
          if (el.label) s += textAt('[' + el.label + ']', (b.l + b.r) / 2, el.y + lh / 2 + 2, { size: fs * 0.86, fill: t.text, bold: true });
        }
        frames.push(s);
      }
      widen(b.l - 2, b.r + 2);
      y += 10;
      lastLine = null;
    }
  }
  // Unbalanced activations are closed at the bottom instead of being dropped, so a missing "deactivate" still shows.
  for (let i = 0; i < n; i++) while (active[i].length) endAct(i, y);
  y += 6;
  const bottom = y;
  const H = bottom + headH + 12;
  let maxX = cx[n - 1] + boxW[n - 1] / 2 + rightM;
  // Frame extents are recovered by re-parsing the generated markup (x, width): works because this module writes
  // those attributes in this exact order. Fragile by construction; tracking the max extent in widen() would avoid it.
  for (const f of frames.concat(back)) { const m = /x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)"/.exec(f); if (m) maxX = Math.max(maxX, +m[1] + +m[2] + 8); }
  const W = Math.max(maxX, P.title ? textWidth(P.title, fs * 1.1, { bold: true }) + 24 : 0);

  const head = (p, i, y0) => {
    if (p.kind === 'actor') {
      const x = cx[i], c = t.stroke;
      return `<g class="dg-actor"><circle cx="${num(x)}" cy="${num(y0 + 9)}" r="8" fill="${esc(t.fill)}" stroke="${esc(c)}" stroke-width="1.6"/><path d="M${num(x)} ${num(y0 + 17)}v14M${num(x - 12)} ${num(y0 + 22)}h24M${num(x)} ${num(y0 + 31)}l-10 11M${num(x)} ${num(y0 + 31)}l10 11" fill="none" stroke="${esc(c)}" stroke-width="1.6"/>` +
        textAt(p.label, x, y0 + 44 + (tl(p.label) * lh) / 2, { size: fs, fill: t.text }) + '</g>';
    }
    return `<g class="dg-participant"><rect x="${num(cx[i] - boxW[i] / 2)}" y="${num(y0)}" width="${num(boxW[i])}" height="${num(headH)}" rx="3" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="1.4"/>` +
      textAt(p.label, cx[i], y0 + headH / 2, { size: fs, fill: t.text }) + '</g>';
  };
  // Paint order: title, boxes, rect backgrounds, lifelines, activation bars, block frames, messages, notes, then the
  // participant heads (top and mirrored at the bottom, as Mermaid does) above everything.
  const body = [];
  if (P.title) body.push(textAt(P.title, W / 2, 10 + lh / 2, { size: fs * 1.1, fill: t.text, bold: true }));
  for (const b of P.boxes) {
    const is = b.ids.map((x) => idx.get(x));
    if (!is.length) continue;
    const l = Math.min(...is.map((i) => cx[i] - boxW[i] / 2)) - 8, r = Math.max(...is.map((i) => cx[i] + boxW[i] / 2)) + 8;
    const y0 = top - boxLabelH;
    body.push(`<rect x="${num(l)}" y="${num(y0)}" width="${num(r - l)}" height="${num(H - y0 - 4)}" rx="4" fill="${esc(b.color || 'none')}"${b.color ? ` fill-opacity="${t.dark ? 0.25 : 0.35}"` : ''} stroke="${esc(t.groupStroke)}" stroke-width="1"/>` +
      (b.label ? textAt(b.label, (l + r) / 2, y0 + lh / 2 + 2, { size: fs * 0.9, fill: t.text, bold: true }) : ''));
  }
  body.push(...back);
  for (let i = 0; i < n; i++) body.push(`<path class="dg-lifeline" d="M${num(cx[i])} ${num(top + headH)}V${num(bottom)}" stroke="${esc(t.edge)}" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>`);
  for (const [i, y0, y1, level] of acts) body.push(`<rect class="dg-activation" x="${num(cx[i] - 5 + level * 5)}" y="${num(y0)}" width="10" height="${num(Math.max(6, y1 - y0))}" fill="${esc(t.accents[0])}" stroke="${esc(t.stroke)}" stroke-width="1.2"/>`);
  body.push(...frames, ...msgs, ...notes);
  P.participants.forEach((p, i) => { body.push(head(p, i, top)); body.push(head(p, i, bottom)); });
  return svgDoc({ kind: 'sequence', id, width: W, height: H, body: body.join(''), defs: mk.defs(), title: P.title, opts });
}

registerDiagram('sequence', { detect: /^sequenceDiagram\b/, render: sequenceSVG });
