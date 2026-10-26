// ffcmd/graph.js - filter graphs as data: chains of filters between labelled pads, every filter tagged with a
// reference (e.g. the id of the timeline element it comes from), printed as ffmpeg text.
//
//   f(name, ...parts)          one filter. parts: numbers (num), strings (escaped, level 1), objects of named options
//                              ({ key: value }, null / undefined skipped) and raw(value) (no level-1 escaping, e.g. an
//                              expression that is already well-formed). The argument string gets level-2 escaping:
//                                f('scale', 1280, -2)                    scale=1280:-2
//                                f('xfade', { transition: 'fade', duration: 0.5, offset: 4.25 })
//                                f('overlay', { enable: raw('between(t,1,3)') })   overlay=enable=between(t\,1\,3)
//   raw(value)
//   new Graph()
//     .label(prefix)           a fresh pad label ('v1', 'v2', …; prefixes are counted separately)
//     .chain(ins, filters, outs, ref)   ins / outs: label arrays ('0:v' style stream specifiers too); filters:
//                              strings or { text, ref } (ref defaults to the chain's)
//     .relabel(from, to)       renames a pad everywhere (e.g. the last output becomes 'vout')
//     .text()                  'chain;chain;…' (one argument for -filter_complex)
//     .pieces()                [{ text, ref }]: one piece per filter with its labels, ',' and ';' attached
//     .empty

import { escapeGraph, escapeValue, num } from './escape.js';

// raw() opts out of level-1 escaping only; level 2 (graph syntax) is always applied in f(), so even a raw expression
// cannot break the graph structure with ',' or ';'.
const RAW = Symbol('raw');
export const raw = (v) => ({ [RAW]: String(v) });

function value(v) {
  if (v && typeof v === 'object' && RAW in v) return v[RAW];
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return escapeValue(v);
}

// Escaping order mirrors ffmpeg's parse order in reverse: values are escaped for the option level first, joined with
// ':', then the whole argument string is escaped for the graph level.
export function f(name, ...parts) {
  const args = [];
  for (const p of parts) {
    if (p == null) continue;
    if (typeof p === 'object' && !(RAW in p)) {
      for (const [k, v] of Object.entries(p)) if (v != null && v !== false) args.push(`${k}=${value(v)}`);
    } else args.push(value(p));
  }
  return args.length ? `${name}=${escapeGraph(args.join(':'))}` : name;
}

export class Graph {
  constructor() {
    this.chains = [];
    this.counters = {};
  }

  get empty() { return this.chains.length === 0; }

  label(prefix = 'v') {
    this.counters[prefix] = (this.counters[prefix] || 0) + 1;
    return prefix + this.counters[prefix];
  }

  // An empty chain still needs a filter to connect pads: 'null' (pass-through) for one input, 'concat' for several.
  chain(ins, filters, outs, ref = null) {
    const list = filters.filter(Boolean).map((x) => (typeof x === 'string' ? { text: x, ref } : { text: x.text, ref: x.ref ?? ref }));
    if (!list.length) list.push({ text: ins.length > 1 ? 'concat' : 'null', ref });
    const c = { ins: [...ins], filters: list, outs: [...outs], ref };
    this.chains.push(c);
    return c;
  }

  relabel(from, to) {
    for (const c of this.chains) {
      c.ins = c.ins.map((x) => (x === from ? to : x));
      c.outs = c.outs.map((x) => (x === from ? to : x));
    }
  }

  // Labels, ',' and ';' are attached to the filter they belong to, so a UI highlight of one piece covers the complete
  // syntax of that filter and concatenating all pieces yields exactly text().
  pieces() {
    const out = [];
    this.chains.forEach((c, ci) => {
      const last = ci === this.chains.length - 1;
      c.filters.forEach((fl, i) => {
        let text = fl.text;
        if (i === 0) text = c.ins.map((x) => `[${x}]`).join('') + text;
        if (i === c.filters.length - 1) text += c.outs.map((x) => `[${x}]`).join('') + (last ? '' : ';');
        else text += ',';
        out.push({ text, ref: fl.ref });
      });
    });
    return out;
  }

  text() { return this.pieces().map((p) => p.text).join(''); }
}
