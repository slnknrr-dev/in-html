// ledger/web.js - the calculation web: a graph of money flow instead of one flat cascade. A flat cascade is a star
// (one source with arrows to parties, `starFromSplit`); a web nests stars, so a party that receives can share further
// ("the agency gives half of its 30 % to the manager and 10 % to tax"). Money in integer minor units, percentages in
// hundredths of a percent (split.js); no cycles - money that comes back where it came from has no answer to "how
// much to whom".
//
// Nodes:  source - money in: `booking` (the price without the surplus) and `surplus` (the extra above the usual price,
//                  routed on its own and hideable from the owner); one source of each kind;
//         pool   - collects and passes everything on, keeps nothing;
//         party  - a party of the property (`partyId`) or, in a template, a role (`role`, bound later by `bindWeb`):
//                  receives, may pass on, keeps what is left.
// Edges:  pct    - a percentage of the node's INFLOW (not of what is left after fixed amounts);
//         fixed  - an amount per booking / night / month (month = 30 nights). Without a guarantee it takes what is
//                  there and the shortfall is a DEBT on the edge; guaranteed (sublease) it is paid in full and the
//                  paying PARTY goes negative (a source or pool has no pocket: there it acts as a plain fixed amount);
//         rest   - everything left in the node; one per node (the rounding lock again).
// Order inside a node: fixed, then pct, then rest; within a method by `ord`.
//
//   normalizeWeb(raw) -> web            idempotent; drops junk, a second source of a kind, edges into a source, to
//                                       unknown nodes or to themselves; a second rest of a node becomes pct 0
//   webOrder(web) -> ids | null         topological order (Kahn); null on a cycle
//   validateWeb(web, { bound }) -> issues [{ level: 'error' | 'warn', code, node?, edge? }]
//   webErrors(issues)
//   evalWeb(web, { booking, surplus }, { nights, rounding }) -> { ok, error?, flows, into, left, stuck }
//   webOps(web, ev) -> [{ node, partyId, role, article, amount (signed) }]   one line per party x article
//   webJournal(web, ev, { day, currency, ref, note }) -> raw journal ops (accruals / deductions) for appendOps
//   starFromSplit(rules, { surplusTo }) -> web      a flat cascade as a star; same shares to the unit
//   bindWeb(web, parties) -> { web, missing }        template roles -> the first party with that role
//   webHash(web) -> 'a1b2c3d4'                       money-relevant fingerprint (canvas positions and labels excluded)
//   resolveWeb({ face, building, lot }) -> { web, level }   the nearest non-empty level wins (whole copies, no patches)
//   starterWeb() -> web                              owner 70 %, manager the rest, surplus to the manager

import { MONEY_MAX, mulDiv, toMinor } from './minor.js';
import { PCT_FULL, allocationOp, clampPct, toPct } from './split.js';
import { cleanArticle, cleanArticleName, cleanId, isPartyRole } from './parties.js';

export const WEB_NODE_KINDS = ['source', 'pool', 'party'];
export const WEB_SOURCES = ['booking', 'surplus'];
export const WEB_METHODS = ['pct', 'fixed', 'rest'];
export const WEB_UNITS = ['booking', 'night', 'month'];
// Hard caps bound every quadratic loop below (webOrder and validateWeb scan all edges per node) and keep a pasted or
// hostile web from freezing the editor.
export const WEB_LIMITS = { nodes: 40, edges: 80 };

export const emptyWeb = () => ({ v: 1, nodes: [], edges: [] });

// Short, letter-first ids: safe as DOM ids / CSS selectors / diagram node names without escaping.
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

function num(v, min, max, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

// A node name in any two-letter languages; empty languages are not kept.
function cleanName(v) {
  const out = {};
  if (typeof v === 'string') { const s = v.trim().slice(0, 60); if (s) out.en = s; return out; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    const s = String(val ?? '').trim().slice(0, 60);
    if (s && /^[a-z]{2}$/.test(k)) out[k] = s;
  }
  return out;
}

export function normalizeWebNode(raw, i = 0) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const kind = WEB_NODE_KINDS.includes(String(o.kind)) ? o.kind : null;
  if (!kind) return null;
  const id = ID_RE.test(String(o.id ?? '')) ? String(o.id) : 'n' + (i + 1);
  const node = { id, kind, x: Math.round(num(o.x, 0, 4000, 40 + i * 30)), y: Math.round(num(o.y, 0, 4000, 40 + i * 30)) };
  if (kind === 'source') node.source = WEB_SOURCES.includes(String(o.source)) ? o.source : 'booking';
  if (kind === 'party') {
    if (isPartyRole(o.role)) node.role = o.role;
    const pid = cleanId(o.partyId);
    if (pid != null) node.partyId = pid;
  }
  const name = cleanName(o.name);
  if (Object.keys(name).length) node.name = name;
  return node;
}

// An edge from anything, idempotently, with the two spellings of split.js: `value` canonical, `pct` / `amount` input.
export function normalizeWebEdge(raw, i = 0) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const from = String(o.from ?? ''), to = String(o.to ?? '');
  if (!ID_RE.test(from) || !ID_RE.test(to) || from === to) return null;
  const method = WEB_METHODS.includes(String(o.method)) ? o.method : 'pct';
  const value = method === 'pct'
    ? (o.pct !== undefined ? toPct(o.pct) : clampPct(o.value))
    : method === 'fixed'
      ? Math.min(MONEY_MAX, o.amount !== undefined ? Math.abs(toMinor(o.amount)) : Math.abs(Math.trunc(Number(o.value)) || 0))
      : 0;
  const edge = {
    id: ID_RE.test(String(o.id ?? '')) ? String(o.id) : 'e' + (i + 1),
    from, to, method, value,
    article: cleanArticle(o.article),
    ord: Math.trunc(num(o.ord, -9999, 9999, i)),
  };
  if (method === 'fixed') {
    edge.unit = WEB_UNITS.includes(String(o.unit)) ? o.unit : 'booking';
    if (o.guaranteed === true || o.guaranteed === 1 || o.guaranteed === '1') edge.guaranteed = true;
  }
  const name = cleanArticleName(o.name);
  if (Object.keys(name).length) edge.name = name;
  return edge;
}

const uniqueId = (id, seen) => {
  if (!seen.has(id)) return id;
  let k = 2;
  while (seen.has((id + '_' + k).slice(0, 24))) k++;
  return (id + '_' + k).slice(0, 24);
};

// Nodes first (ids de-duplicated with a numeric suffix), then edges validated against the surviving node ids.
// Note the order: an edge names a node by its ORIGINAL id, so after a duplicate node is renamed, edges written for
// it attach to the first node of that id - acceptable for junk input, and stable on re-normalisation.
export function normalizeWeb(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
  const nodes = [];
  const seen = new Set();
  const hasSource = new Set();
  for (let i = 0; i < rawNodes.length && nodes.length < WEB_LIMITS.nodes; i++) {
    const n = normalizeWebNode(rawNodes[i], i);
    if (!n) continue;
    if (n.kind === 'source') {
      if (hasSource.has(n.source)) continue;
      hasSource.add(n.source);
    }
    n.id = uniqueId(n.id, seen);
    seen.add(n.id);
    nodes.push(n);
  }
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const rawEdges = Array.isArray(o.edges) ? o.edges : [];
  const edges = [];
  const edgeIds = new Set();
  const restFrom = new Set();
  for (let i = 0; i < rawEdges.length && edges.length < WEB_LIMITS.edges; i++) {
    const e = normalizeWebEdge(rawEdges[i], i);
    if (!e || !kindOf.has(e.from) || !kindOf.has(e.to) || kindOf.get(e.to) === 'source') continue;
    if (e.method === 'rest') {
      if (restFrom.has(e.from)) { e.method = 'pct'; e.value = 0; } else restFrom.add(e.from);
    }
    e.id = uniqueId(e.id, edgeIds);
    edgeIds.add(e.id);
    edges.push(e);
  }
  return { v: 1, nodes, edges };
}

// Kahn's algorithm: repeatedly emit nodes with no unprocessed inflow. If some nodes never reach in-degree 0 they
// lie on (or behind) a cycle, and the output is short -> null. Doubles as the cycle detector and as the evaluation
// order (every node is evaluated after all its inflows are known).
export function webOrder(web) {
  const indeg = new Map(web.nodes.map((n) => [n.id, 0]));
  for (const e of web.edges) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  const queue = web.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const out = [];
  while (queue.length) {
    const id = queue.shift();
    out.push(id);
    for (const e of web.edges) {
      if (e.from !== id) continue;
      const d = indeg.get(e.to) - 1;
      indeg.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
  }
  return out.length === web.nodes.length ? out : null;
}

/**
 * What is wrong with a web. `error`: it cannot be evaluated / confirmed; `warn`: it can, but a person must see it
 * before confirming, not in a statement a quarter later. `bound: true` checks a web of a real property, where every
 * party node must point at a party (a template only needs roles).
 *   errors: no_booking_source, source_unused, cycle, pool_dead_end, party_unbound, party_not_assigned
 *   warnings: unreachable, may_stick (a source / pool without rest and under 100 %), pct_over_100, guarantee_needs_party
 */
export function validateWeb(web, { bound = false } = {}) {
  const out = [];
  const byId = new Map(web.nodes.map((n) => [n.id, n]));
  const outOf = (id) => web.edges.filter((e) => e.from === id);
  const into = (id) => web.edges.filter((e) => e.to === id);
  const booking = web.nodes.find((n) => n.kind === 'source' && n.source === 'booking');
  if (!booking) out.push({ level: 'error', code: 'no_booking_source' });
  else if (!outOf(booking.id).length) out.push({ level: 'error', code: 'source_unused', node: booking.id });
  if (!webOrder(web)) out.push({ level: 'error', code: 'cycle' });
  for (const n of web.nodes) {
    const outs = outOf(n.id);
    if (n.kind === 'pool' && into(n.id).length && !outs.length) out.push({ level: 'error', code: 'pool_dead_end', node: n.id });
    if (n.kind === 'party' && !n.role && n.partyId == null) out.push({ level: 'error', code: 'party_unbound', node: n.id });
    if (bound && n.kind === 'party' && n.partyId == null) out.push({ level: 'error', code: 'party_not_assigned', node: n.id });
    if (n.kind !== 'source' && !into(n.id).length) out.push({ level: 'warn', code: 'unreachable', node: n.id });
    const pctSum = outs.filter((e) => e.method === 'pct').reduce((s, e) => s + e.value, 0);
    // A source or pool must pass everything on; a party keeping a remainder is legal, a pool keeping one is nobody's money.
    if ((n.kind === 'source' || n.kind === 'pool') && outs.length && !outs.some((e) => e.method === 'rest') && pctSum < PCT_FULL) {
      out.push({ level: 'warn', code: 'may_stick', node: n.id });
    }
    if (pctSum > PCT_FULL) out.push({ level: 'warn', code: 'pct_over_100', node: n.id });
  }
  for (const e of web.edges) {
    if (e.guaranteed && byId.get(e.from)?.kind !== 'party') out.push({ level: 'warn', code: 'guarantee_needs_party', edge: e.id });
  }
  return out;
}

export const webErrors = (issues) => issues.filter((x) => x.level === 'error');

const METHOD_RANK = { fixed: 0, pct: 1, rest: 2 };

/**
 * Evaluates one booking. `inputs.booking` is the price without the surplus, `inputs.surplus` the surplus (minor
 * units); `ctx.nights` feeds the per-night and per-month fixed amounts. Money never appears from nothing except by a
 * guarantee, and only at a party (which then goes negative). Money left in a source or pool is reported in `stuck`.
 * flows: [{ edge, amount, requested, debt }]; into / left: node id -> minor units.
 */
// Per node: fixed first (contractual amounts have priority), then pct of the ORIGINAL inflow (so adding a fixed edge
// does not silently shrink every percentage), then rest. `take` is capped by what is available, except for a
// guaranteed fixed edge out of a party, where `avail` may go negative - that negative `left` is the party's debt.
// requested - take = debt is recorded per edge, so a shortfall is visible where it happened.
export function evalWeb(web, inputs = {}, { nights = 1, rounding = 'half-up' } = {}) {
  const res = { ok: false, flows: [], into: {}, left: {}, stuck: [] };
  const order = webOrder(web);
  if (!order) { res.error = 'cycle'; return res; }
  const n = Math.max(1, Math.trunc(Number(nights) || 1));
  const byId = new Map(web.nodes.map((x) => [x.id, x]));
  for (const x of web.nodes) res.into[x.id] = 0;
  for (const x of web.nodes) {
    if (x.kind !== 'source') continue;
    res.into[x.id] = Math.max(0, Math.trunc(Number(x.source === 'surplus' ? inputs.surplus : inputs.booking) || 0));
  }
  for (const id of order) {
    const node = byId.get(id);
    const inflow = res.into[id] || 0;
    let avail = inflow;
    const outs = web.edges.filter((e) => e.from === id).sort((a, b) => METHOD_RANK[a.method] - METHOD_RANK[b.method] || a.ord - b.ord);
    for (const e of outs) {
      let requested, take;
      if (e.method === 'fixed') {
        requested = e.unit === 'night' ? e.value * n : e.unit === 'month' ? mulDiv(e.value, n, 30, rounding) : e.value;
        take = e.guaranteed && node.kind === 'party' ? requested : Math.min(requested, Math.max(0, avail));
      } else if (e.method === 'pct') {
        requested = mulDiv(inflow, e.value, PCT_FULL, rounding);
        take = Math.min(requested, Math.max(0, avail));
      } else {
        take = Math.max(0, avail);
        requested = take;
      }
      avail -= take;
      res.into[e.to] = (res.into[e.to] || 0) + take;
      res.flows.push({ edge: e.id, amount: take, requested, debt: requested - take });
    }
    res.left[id] = avail;
    if ((node.kind === 'source' || node.kind === 'pool') && avail !== 0) res.stuck.push({ node: id, amount: avail });
  }
  res.ok = true;
  return res;
}

/**
 * Evaluation -> what each PARTY got (accruals by the articles of incoming edges) and gave on (deductions by the
 * articles of outgoing edges), ONE line per party x article: a party that received and passed on under the same
 * article gets the signed balance (a journal keyed by (booking, party, article) accepts one line per pair).
 * Default articles: incoming 'rent' ('surplus' from the surplus source), outgoing 'other'.
 */
export function webOps(web, ev) {
  if (!ev || !ev.ok) return [];
  const byId = new Map(web.nodes.map((n) => [n.id, n]));
  const flow = new Map(ev.flows.map((f) => [f.edge, f.amount]));
  const surplusSrc = new Set(web.nodes.filter((n) => n.kind === 'source' && n.source === 'surplus').map((n) => n.id));
  const acc = new Map();
  const add = (node, article, amount) => {
    if (!amount) return;
    const key = node.id + ' ' + article;
    const cur = acc.get(key) || { node: node.id, partyId: node.partyId ?? null, role: node.role, article, amount: 0 };
    cur.amount += amount;
    acc.set(key, cur);
  };
  for (const e of web.edges) {
    const amt = flow.get(e.id) || 0;
    if (!amt) continue;
    const to = byId.get(e.to), from = byId.get(e.from);
    if (to && to.kind === 'party') add(to, e.article || (surplusSrc.has(e.from) ? 'surplus' : 'rent'), amt);
    if (from && from.kind === 'party') add(from, e.article || 'other', -amt);
  }
  return [...acc.values()].filter((x) => x.amount !== 0);
}

// Journal lines of one evaluated booking (raw ops for journal.appendOps). Party nodes without a party id (an unbound
// template) are skipped and reported in `unbound`.
export function webJournal(web, ev, { day, currency, ref = '', note = '' } = {}) {
  const ops = [], unbound = [];
  for (const x of webOps(web, ev)) {
    if (x.partyId == null) { unbound.push(x.node); continue; }
    const a = allocationOp(x);
    ops.push({ ...a, day, currency, ref, note });
  }
  return { ops, unbound: [...new Set(unbound)] };
}

/**
 * A flat cascade as a star: the booking source in the centre, one edge per rule with the same method, article and
 * name; the rest stays the rest. The cascade had no surplus: the star gets a surplus source whose rest goes to
 * `surplusTo` (usually the manager), else to the party of the cascade's rest - money that appeared on a booking must
 * not stay nobody's.
 */
export function starFromSplit(rules, { surplusTo } = {}) {
  const nodes = [{ id: 'src', kind: 'source', source: 'booking', x: 60, y: 160 }];
  const edges = [];
  const partyNode = new Map();
  let row = 0;
  const nodeFor = (pid) => {
    const key = String(pid);
    if (!partyNode.has(key)) {
      const used = new Set(partyNode.values());
      const want = 'p' + key;
      const id = ID_RE.test(want) && !used.has(want) ? want : 'party' + (partyNode.size + 1);
      partyNode.set(key, id);
      nodes.push({ id, kind: 'party', partyId: pid, x: 420, y: 60 + row * 110 });
      row++;
    }
    return partyNode.get(key);
  };
  let restParty = null;
  (rules || []).forEach((r, i) => {
    if (!r || cleanId(r.partyId) == null) return;
    const e = { id: 'e' + (i + 1), from: 'src', to: nodeFor(r.partyId), method: r.method, value: r.method === 'rest' ? 0 : r.value, article: r.article || '', ord: i };
    if (r.method === 'fixed') e.unit = 'booking';
    if (r.name && Object.keys(r.name).length) e.name = { ...r.name };
    if (r.method === 'rest') restParty = r.partyId;
    edges.push(e);
  });
  const surTo = cleanId(surplusTo) ?? restParty;
  if (surTo != null) {
    nodes.push({ id: 'sur', kind: 'source', source: 'surplus', x: 60, y: 60 + (row + 1) * 110 });
    edges.push({ id: 'es', from: 'sur', to: nodeFor(surTo), method: 'rest', value: 0, article: 'surplus', ord: 0 });
  }
  return normalizeWeb({ v: 1, nodes, edges });
}

/**
 * Binds a template to the parties of a property: every party node with a role and no party gets the first party with
 * that role. A missing role is a refusal by name (`missing`), never "take any": money bound to the wrong party goes
 * to the wrong person.
 */
// JSON round-trip = deep copy, so binding never mutates the shared template object.
export function bindWeb(web, parties) {
  const copy = normalizeWeb(JSON.parse(JSON.stringify(web)));
  const missing = new Set();
  for (const n of copy.nodes) {
    if (n.kind !== 'party' || n.partyId != null || !n.role) continue;
    const p = (parties || []).find((x) => x && x.role === n.role);
    if (p && cleanId(p.id) != null) n.partyId = cleanId(p.id);
    else missing.add(n.role);
  }
  return { web: copy, missing: [...missing] };
}

/**
 * Fingerprint of what decides WHO GETS HOW MUCH: nodes (kind, source, role, party) and edges (ends, method, value,
 * unit, guarantee, article, order). Canvas positions and labels are left out: moving a node with the mouse changes no
 * money and must not ask forty flats for a new confirmation. FNV-1a, 32 bits: it answers "did it change", it hides
 * nothing.
 */
// Canonical form before hashing: normalise, project to money-relevant fields, sort nodes and edges, so array order
// in storage does not change the hash. Math.imul + >>> 0 keeps FNV's 32-bit multiply exact in JS.
export function webHash(web) {
  const w = normalizeWeb(web);
  const nodes = w.nodes.map((n) => [n.id, n.kind, n.source || '', n.role || '', n.partyId ?? 0]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const edges = w.edges.map((e) => [e.from, e.to, e.method, e.value, e.unit || '', e.guaranteed ? 1 : 0, e.article, e.ord])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const s = JSON.stringify([nodes, edges]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// Inheritance: the account's standard, edited as a whole copy for a building, then for a flat; the nearest non-empty
// level wins. Copies, not patches: a patch ("drop edge 3") breaks silently - with money - when the template renames.
export function resolveWeb(layers = {}) {
  for (const level of ['lot', 'building', 'face']) {
    const w = layers[level];
    if (w && w.nodes && w.nodes.length) return { web: w, level };
  }
  return { web: null, level: '' };
}

export function starterWeb() {
  return normalizeWeb({
    v: 1,
    nodes: [
      { id: 'src', kind: 'source', source: 'booking', x: 60, y: 120 },
      { id: 'sur', kind: 'source', source: 'surplus', x: 60, y: 300 },
      { id: 'own', kind: 'party', role: 'owner', x: 440, y: 60 },
      { id: 'agn', kind: 'party', role: 'agency', x: 440, y: 260 },
    ],
    edges: [
      { id: 'e1', from: 'src', to: 'own', method: 'pct', pct: 70, article: 'rent', ord: 0 },
      { id: 'e2', from: 'src', to: 'agn', method: 'rest', article: 'commission', ord: 1 },
      { id: 'e3', from: 'sur', to: 'agn', method: 'rest', article: 'surplus', ord: 0 },
    ],
  });
}
