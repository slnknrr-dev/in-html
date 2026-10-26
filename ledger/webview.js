// ledger/webview.js - a calculation web as a picture: the web (web.js) becomes the neutral graph of ../diagram/
// (graph.js), so an editor or a statement can draw it with `graphSVG` - sources as stadiums, pools as hexagons,
// parties as rounded boxes, edges labelled with their rule ("70 %", "35.00 / night, guaranteed", "rest") and, with
// an evaluation, the amount that flowed.
//
//   webGraph(web, { ev, lang, currency, partyNames, direction }) -> diagram graph (graphSVG(graph) draws it)
//   edgeRuleText(edge, { lang, currency }) -> '70 %' | '35.00 GEL / night' | 'rest'

import { createGraph } from '../diagram/graph.js';
import { moneyText } from './minor.js';
import { fromPct } from './split.js';
import { articleLabel, roleLabel } from './parties.js';

// Design: a pure model-to-graph adapter. Layout and SVG belong to ../diagram/, so the ledger never knows about
// coordinates and the diagram code never knows about money. Shape and line style encode meaning redundantly with the
// text (stadium = source, hexagon = pool, thick = guaranteed, dotted = rest), so the picture reads without colour.

const UNIT_TEXT = {
  booking: { en: 'booking', ru: 'бронь', ka: 'ჯავშანი' },
  night: { en: 'night', ru: 'ночь', ka: 'ღამე' },
  month: { en: 'month', ru: 'месяц', ka: 'თვე' },
};
const WORDS = {
  rest: { en: 'rest', ru: 'остаток', ka: 'ნაშთი' },
  guaranteed: { en: 'guaranteed', ru: 'гарантия', ka: 'გარანტია' },
  booking: { en: 'Booking', ru: 'Бронь', ka: 'ჯავშანი' },
  surplus: { en: 'Surplus', ru: 'Сверхприбыль', ka: 'ზედმეტი მოგება' },
  pool: { en: 'Pool', ru: 'Котёл', ka: 'ქვაბი' },
};
const word = (t, lang) => t[String(lang || 'en').slice(0, 2)] || t.en;

export function edgeRuleText(e, { lang = 'en', currency = '' } = {}) {
  if (e.method === 'rest') return word(WORDS.rest, lang);
  if (e.method === 'pct') return fromPct(e.value).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US') + ' %';
  const unit = word(UNIT_TEXT[e.unit || 'booking'], lang);
  return `${moneyText(e.value, currency, lang)} / ${unit}${e.guaranteed ? ', ' + word(WORDS.guaranteed, lang) : ''}`;
}

function nodeLabel(n, lang, partyNames) {
  const own = n.name && (n.name[lang] || n.name.en || Object.values(n.name)[0]);
  if (own) return own;
  if (n.kind === 'source') return word(WORDS[n.source] || WORDS.booking, lang);
  if (n.kind === 'pool') return word(WORDS.pool, lang);
  const named = n.partyId != null && partyNames ? partyNames[n.partyId] : '';
  return named || roleLabel(n.role, lang);
}

export function webGraph(web, { ev = null, lang = 'en', currency = '', partyNames = null, direction = 'LR' } = {}) {
  const g = createGraph({ direction, kind: 'graph' });
  const flow = new Map(ev && ev.ok ? ev.flows.map((f) => [f.edge, f]) : []);
  for (const n of web.nodes) {
    let label = nodeLabel(n, lang, partyNames);
    if (ev && ev.ok && n.kind === 'party') label += '\n' + moneyText(ev.left[n.id] || 0, currency, lang);
    g.node(n.id, label, { shape: n.kind === 'source' ? 'stadium' : n.kind === 'pool' ? 'hexagon' : 'round', accent: n.kind === 'source' ? 0 : n.kind === 'pool' ? 1 : 2 });
  }
  for (const e of web.edges) {
    const parts = [edgeRuleText(e, { lang, currency })];
    if (e.article) parts.push(articleLabel(e.article, e.name ? { [e.article]: e.name } : null, lang));
    const f = flow.get(e.id);
    if (f) parts.push('= ' + moneyText(f.amount, currency, lang) + (f.debt ? ` (-${moneyText(f.debt, currency, lang)})` : ''));
    g.edge(e.from, e.to, { label: parts.join(' · '), line: e.guaranteed ? 'thick' : e.method === 'rest' ? 'dotted' : 'solid' });
  }
  return g.graph;
}
