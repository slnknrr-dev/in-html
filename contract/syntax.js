// contract/syntax.js - the text language of clauses: plain text with placeholders and blocks.
//
//   {{tenant.name}}                 the value of a field (formatted by its type)
//   {{rent | words}}                filters (contract/render.js FILTERS): {{rent | money}}, {{start | date:'short'}}
//   {{rent * depositMonths | moneyWords}}   any expression of contract/expr.js
//   {{#deposit}}  {{#}}             the number of the clause / section with that id, or of the clause itself
//   [[if poa]] … [[elif x > 2]] … [[else]] … [[end]]       conditional text ([[/if]] closes too)
//   [[each services as s]] {{index}}. {{s.name}} [[end]]  repeat for every item of a list ([[/each]] closes too)
//   **bold**                        bold text; a line break is a line break, an empty line starts a new paragraph
//
//   parseText(src) -> { nodes, errors: [{ msg, at }] }    (cached; never throws; broken pieces become 'err' nodes
//                                                          that render as their source)
//   textRefs(nodes, out?) -> Set of the field paths read (loop variables excluded)   clauseRefs(nodes) -> Set of ids
//   placeholders(src) -> [{ src, at, len }]   the {{…}} placeholders of a text (editor helpers)
//
// Nodes: { t: 'text', v } | { t: 'ph', src, ast, filters } | { t: 'num', id } | { t: 'if', branches: [{ cond, src,
// body }], els } | { t: 'each', src, ast, as, body } | { t: 'err', src, msg }
import { parseExpr, parsePipe, refsOf } from './expr.js';

// One global regex for both token kinds; lazy [\s\S]*? stops at the first closing }} / ]], so a placeholder cannot
// contain '}}' (not even inside a string literal). Block keywords require \b so '[[iffy]]' is plain text.
// Everything between tokens is literal text: no escaping syntax is needed for a lone '{'.
// The parse cache is keyed by source text and returns the SAME object to every caller: results must be treated as
// immutable. Cleared wholesale at 2000 entries (see env.js on why not LRU).
const TOKEN = /\{\{([\s\S]*?)\}\}|\[\[\s*(if|elif|else\s+if|else|end|\/if|\/each|each)\b([\s\S]*?)\]\]/g;
const cache = new Map();
const MAX_TEXT = 40000;

// Error recovery policy: never throw; a broken piece becomes an 'err' node that renders its source, mismatched
// closers are reported and ignored, unclosed blocks are reported but their content is kept (the text stays visible
// while the author is mid-typing "[[if x]] ..." without the [[end]] yet).
// A failed condition expression still creates the block (cond null -> false), so branch structure stays intact.
export function parseText(src) {
  const s = typeof src === 'string' ? src.slice(0, MAX_TEXT) : '';
  const hit = cache.get(s);
  if (hit) return hit;
  const errors = [];
  const root = { body: [] };
  // Stack of open blocks: { node, body (the list being filled), kind, at, open (source of the opening tag) }.
  const stack = [{ kind: 'root', body: root.body }];
  const top = () => stack[stack.length - 1];
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(s))) {
    if (m.index > last) top().body.push({ t: 'text', v: s.slice(last, m.index) });
    last = TOKEN.lastIndex;
    const raw = m[0];
    if (m[1] !== undefined) {
      const inner = m[1].trim();
      if (inner.startsWith('#')) {
        const id = inner.slice(1).trim();
        if (id === '' || /^[A-Za-z_][\w-]*$/.test(id)) top().body.push({ t: 'num', id });
        else { errors.push({ msg: 'bad reference', at: m.index }); top().body.push({ t: 'err', src: raw, msg: 'bad reference' }); }
        continue;
      }
      const p = parsePipe(inner);
      if (p.error) { errors.push({ msg: p.error, at: m.index }); top().body.push({ t: 'err', src: raw, msg: p.error }); }
      else top().body.push({ t: 'ph', src: inner, ast: p.ast, filters: p.filters });
      continue;
    }
    const kw = m[2].replace(/\s+/g, ' ');
    const arg = (m[3] || '').trim();
    if (kw === 'if' || kw === 'each') {
      let node;
      if (kw === 'if') {
        const p = parseExpr(arg);
        if (p.error) { errors.push({ msg: p.error, at: m.index }); }
        node = { t: 'if', branches: [{ cond: p.ast, src: arg, body: [] }], els: null };
        top().body.push(node);
        stack.push({ kind: 'if', node, body: node.branches[0].body, at: m.index, open: raw });
      } else {
        const em = /^([\s\S]*?)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/.exec(arg);
        const p = parseExpr(em[1]);
        if (p.error) errors.push({ msg: p.error, at: m.index });
        node = { t: 'each', src: em[1], ast: p.ast, as: em[2] || 'item', body: [] };
        top().body.push(node);
        stack.push({ kind: 'each', node, body: node.body, at: m.index, open: raw });
      }
      continue;
    }
    const cur = top();
    // elif/else switch `cur.body` (the list being filled) of the open if-frame; the frame stays on the stack until
    // [[end]]. An elif after else is an error: branch order is if, elif*, else?.
    if (kw === 'elif' || kw === 'else if') {
      if (cur.kind !== 'if' || cur.node.els) { errors.push({ msg: 'elif without if', at: m.index }); cur.body.push({ t: 'err', src: raw, msg: 'elif without if' }); continue; }
      const p = parseExpr(arg);
      if (p.error) errors.push({ msg: p.error, at: m.index });
      const br = { cond: p.ast, src: arg, body: [] };
      cur.node.branches.push(br);
      cur.body = br.body;
      continue;
    }
    if (kw === 'else') {
      if (cur.kind !== 'if' || cur.node.els) { errors.push({ msg: 'else without if', at: m.index }); cur.body.push({ t: 'err', src: raw, msg: 'else without if' }); continue; }
      cur.node.els = [];
      cur.body = cur.node.els;
      continue;
    }
    // end, /if, /each
    const want = kw === '/if' ? 'if' : kw === '/each' ? 'each' : null;
    if (cur.kind === 'root' || (want && cur.kind !== want)) { errors.push({ msg: 'unexpected ' + raw, at: m.index }); cur.body.push({ t: 'err', src: raw, msg: 'unexpected end' }); continue; }
    stack.pop();
  }
  if (last < s.length) top().body.push({ t: 'text', v: s.slice(last) });
  while (stack.length > 1) {
    const b = stack.pop();
    errors.push({ msg: 'unclosed ' + b.kind, at: b.at });
  }
  const res = { nodes: root.body, errors };
  if (cache.size > 2000) cache.clear();
  cache.set(s, res);
  return res;
}

// Loop variables (and `index`) are lexically scoped: a fresh `locals` array per [[each]] level, so a variable is
// excluded only inside its loop body.
export function textRefs(nodes, out = new Set(), locals = []) {
  const add = (ast) => {
    for (const p of refsOf(ast)) {
      const head = p.split('.')[0];
      if (!locals.includes(head)) out.add(p);
    }
  };
  for (const n of nodes || []) {
    if (n.t === 'ph') {
      add(n.ast);
      for (const f of n.filters) for (const a of f.args) add(a);
    } else if (n.t === 'if') {
      for (const b of n.branches) { add(b.cond); textRefs(b.body, out, locals); }
      if (n.els) textRefs(n.els, out, locals);
    } else if (n.t === 'each') {
      add(n.ast);
      textRefs(n.body, out, [...locals, n.as, 'index']);
    }
  }
  return out;
}

export function clauseRefs(nodes, out = new Set()) {
  for (const n of nodes || []) {
    if (n.t === 'num' && n.id) out.add(n.id);
    else if (n.t === 'if') { for (const b of n.branches) clauseRefs(b.body, out); if (n.els) clauseRefs(n.els, out); }
    else if (n.t === 'each') clauseRefs(n.body, out);
  }
  return out;
}

export function placeholders(src) {
  const out = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  while ((m = re.exec(String(src || '')))) out.push({ src: m[1].trim(), at: m.index, len: m[0].length });
  return out;
}
