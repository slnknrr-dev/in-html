// diagram/index.js - diagrams from text: a registry of diagram kinds detected by their first keyword (after front
// matter and %%{init}%% directives), each turning source text into SVG. The flowchart kind is built in; other kinds
// register themselves (registerDiagram) from their own modules.
//
//   registerDiagram(kind, { detect: RegExp | (firstLine) -> boolean, render(src, opts) -> SVG text })
//   detectDiagram(src) -> kind | null          DIAGRAM_KINDS -> [kind]
//   renderDiagram(src, { theme, fontSize, fontFamily, measure, idPrefix }) -> { kind, svg, error }  never throws:
//                                               on an error svg is a small error picture and error the message
//   errorSVG(message) -> SVG text

import { flowchartSVG } from './flowchart.js';
import { esc } from './svg.js';

//
// Design: a plug-in registry rather than a switch over kinds. index.js knows no kind but flowchart, so adding a kind
// never edits this file and an unused kind is never bundled. Detection is by the first meaningful line only, the same
// rule Mermaid uses, so a source is classified in O(first line) without running any parser.
//
// REGISTRY keeps order: detectors are tried first-registered-first, so a broad regex registered early shadows a
// narrower later one. DIAGRAM_KINDS is exported live (same array), so UIs listing kinds see late registrations.
const REGISTRY = [];
export const DIAGRAM_KINDS = [];

// Re-registering a kind replaces it in place (keeps its priority slot): lets a page override a built-in renderer
// without the duplicate entry a plain push would leave, where the old detector would still win.
export function registerDiagram(kind, spec) {
  const i = REGISTRY.findIndex((r) => r.kind === kind);
  const entry = { kind, ...spec };
  if (i >= 0) REGISTRY[i] = entry; else { REGISTRY.push(entry); DIAGRAM_KINDS.push(kind); }
}
registerDiagram('flowchart', { detect: /^(flowchart|graph|flowchart-elk)\b/i, render: flowchartSVG });

// Strips, in order: CRLF/CR line ends, YAML front matter (--- … --- at the very start), %%{init}%% directives
// (may span lines, hence [\s\S]*? lazy), then %% line comments. The lazy quantifiers matter: a greedy one would
// swallow everything up to the LAST --- or }%% in the document.
const firstLine = (src) => {
  const s = String(src || '').replace(/\r\n?/g, '\n').replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '').replace(/%%\{[\s\S]*?\}%%/g, '');
  for (const l of s.split('\n')) { const t = l.replace(/%%.*$/, '').trim(); if (t) return t; }
  return '';
};

export function detectDiagram(src) {
  const l = firstLine(src);
  const r = REGISTRY.find((x) => (typeof x.detect === 'function' ? x.detect(l) : x.detect.test(l)));
  return r ? r.kind : null;
}

// Error picture instead of throwing: a live editor re-renders on every keystroke and most intermediate states are
// invalid; a visible message in place keeps the layout stable. Capped at 6 lines x 90 chars so a stack-trace-sized
// message cannot produce a giant SVG. Hard-coded colours: must be readable even if theming itself failed.
export function errorSVG(message) {
  const lines = String(message).split('\n').slice(0, 6).map((l) => l.slice(0, 90));
  const h = 30 + lines.length * 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="dg dg-error" viewBox="0 0 560 ${h}" width="560" height="${h}" font-family="ui-monospace, Menlo, Consolas, monospace"><rect x="0.5" y="0.5" width="559" height="${h - 1}" rx="6" fill="#fff4f2" stroke="#e0928a"/>` +
    lines.map((l, i) => `<text x="14" y="${24 + i * 18}" font-size="13" fill="#9b2c22">${esc(l)}</text>`).join('') + '</svg>';
}

// Never throws (contract): every renderer error becomes { svg: errorSVG, error }. Callers can therefore render
// many diagrams in a loop (a Markdown preview) without one bad block aborting the page.
export function renderDiagram(src, opts = {}) {
  const kind = detectDiagram(src);
  if (!kind) return { kind: null, svg: errorSVG('Unknown diagram type: ' + (firstLine(src).split(/\s/)[0] || '(empty)')), error: 'unknown diagram type' };
  try {
    return { kind, svg: REGISTRY.find((r) => r.kind === kind).render(src, opts), error: null };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { kind, svg: errorSVG(kind + ': ' + msg), error: msg };
  }
}
