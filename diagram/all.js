// diagram/all.js - every diagram kind of this library registered at once (each module registers itself with
// index.js), for pages that render any Mermaid-style source: flowchart, sequence, class, state, er, pie, gantt,
// gitGraph, mindmap, timeline, journey, quadrantChart.
//
//   renderDiagram(src, opts) -> { kind, svg, error }   detectDiagram(src) -> kind | null   DIAGRAM_KINDS   errorSVG(msg)

//
// Why side-effect imports, not an explicit list passed to index.js: each kind stays tree-shakable. A page that needs
// only flowcharts imports index.js and never pays for the other parsers; this file is the opt-in "everything" bundle.
// Flowchart is absent here on purpose: index.js registers it itself (it is the default kind).
// Import order = registration order = detection priority (index.js tries detectors in order, first match wins).
import './sequence.js';
import './class.js';
import './state.js';
import './er.js';
import './pie.js';
import './gantt.js';
import './gitgraph.js';
import './mindmap.js';
import './timeline.js';
import './journey.js';
import './quadrant.js';

export { renderDiagram, detectDiagram, DIAGRAM_KINDS, errorSVG, registerDiagram } from './index.js';
