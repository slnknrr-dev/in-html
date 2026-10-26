// access/modules.js - a module catalogue: a module brings sections (rights) and may depend on other modules; enabling
// one enables its dependencies, disabling one disables everything that depends on it (their data stays, only the
// switch changes). Each enabled module has a view - standalone (own navigation), embedded (shown inside its carrier
// modules at named embed points) or hidden (gives no rights) - chosen by a cascade organisation -> roles root to leaf
// -> member -> a draft preview, every level allowed only the views the module supports. An embedded module whose
// carriers are all off or hidden has nowhere to appear; it is reported as stranded.
//
//   VIEWS   checkCatalog(catalog) -> [{ module, problem: 'dep' | 'carrier' | 'cycle' | 'default', ref }]
//   withDeps(list, catalog) -> ids (catalog order)      dependents(m, catalog, { transitive }) -> ids
//   enableModule(enabled, m, catalog) -> { enabled, added }   disableModule(enabled, m, catalog) -> { enabled, removed }
//   viewsFor(catalog, enabled, levels: [{ scope, id, views: { m: view } }], overrides) -> { views, from, stranded }
//   applyModules(sections, views, catalog) -> Set (sections of off / hidden modules removed)   moduleVisible(views, m)
//   embedPoints(views, catalog) -> { point: [modules] }
// catalog: { id: { sections: [], deps: [], carriers: [], views: [...VIEWS], default, embeds: [], nav: [] } }

export const VIEWS = ['standalone', 'embedded', 'hidden'];
const ids = (catalog) => Object.keys(catalog);

// Cycle detection is the classic three-colour DFS: 1 = on the current path (a back edge to it is a cycle),
// 2 = finished. Reported, not thrown, so an admin UI can show every problem at once.
export function checkCatalog(catalog) {
  const out = [];
  for (const [m, spec] of Object.entries(catalog)) {
    for (const d of spec.deps || []) if (!catalog[d]) out.push({ module: m, problem: 'dep', ref: d });
    for (const c of spec.carriers || []) if (!catalog[c]) out.push({ module: m, problem: 'carrier', ref: c });
    if (spec.default && !(spec.views || VIEWS).includes(spec.default)) out.push({ module: m, problem: 'default', ref: spec.default });
  }
  // dependency cycles (depth-first with colours)
  const state = new Map();
  const visit = (m, path) => {
    if (state.get(m) === 2) return;
    if (state.get(m) === 1) { out.push({ module: m, problem: 'cycle', ref: [...path.slice(path.indexOf(m)), m].join(' -> ') }); return; }
    state.set(m, 1);
    for (const d of catalog[m]?.deps || []) if (catalog[d]) visit(d, [...path, m]);
    state.set(m, 2);
  };
  for (const m of ids(catalog)) visit(m, []);
  return out;
}

// Transitive closure with an explicit stack; the result keeps catalog order so the UI and diffs are stable.
export function withDeps(list, catalog) {
  const out = new Set(list.filter((m) => catalog[m]));
  const stack = [...out];
  while (stack.length) for (const d of catalog[stack.pop()]?.deps || []) if (catalog[d] && !out.has(d)) { out.add(d); stack.push(d); }
  return ids(catalog).filter((m) => out.has(m));
}

export function dependents(m, catalog, { transitive = true } = {}) {
  const out = new Set();
  const stack = [m];
  while (stack.length) {
    const x = stack.pop();
    for (const y of ids(catalog)) if ((catalog[y].deps || []).includes(x) && !out.has(y)) { out.add(y); if (transitive) stack.push(y); }
  }
  out.delete(m);
  return ids(catalog).filter((y) => out.has(y));
}

export function enableModule(enabled, m, catalog) {
  const before = new Set(enabled);
  const next = withDeps([...enabled, m], catalog);
  return { enabled: next, added: next.filter((x) => !before.has(x)) };
}

// Disabling cascades to transitive dependents (a module cannot run without its dependency). Only the switches change;
// the dependents' data is kept so re-enabling restores them.
export function disableModule(enabled, m, catalog) {
  const drop = new Set([m, ...dependents(m, catalog)]);
  const next = ids(catalog).filter((x) => enabled.includes(x) && !drop.has(x));
  return { enabled: next, removed: ids(catalog).filter((x) => enabled.includes(x) && drop.has(x)) };
}

// Cascade: default -> each level in order (organisation, roles root to leaf, member) -> preview overrides; a level
// may only pick a view the module supports, invalid values are ignored rather than rejected. `from` records the
// deciding level for explanations in the UI.
export function viewsFor(catalog, enabled, levels = [], overrides = null) {
  const on = new Set(withDeps(enabled, catalog));
  const views = {}, from = {};
  for (const m of ids(catalog)) { views[m] = on.has(m) ? catalog[m].default || 'standalone' : 'off'; from[m] = on.has(m) ? 'default' : 'off'; }
  const apply = (rows, level) => {
    for (const [m, v] of Object.entries(rows || {})) if (on.has(m) && (catalog[m].views || VIEWS).includes(v)) { views[m] = v; from[m] = level; }
  };
  for (const l of levels) apply(l.views, l.label || `${l.scope}${l.id != null ? ':' + l.id : ''}`);
  if (overrides) apply(overrides, 'preview');
  const stranded = ids(catalog).filter((m) => views[m] === 'embedded' && (catalog[m].carriers || []).length && !catalog[m].carriers.some((c) => moduleVisible(views, c)));
  return { views, from, stranded };
}

export const moduleVisible = (views, m) => views?.[m] === 'standalone' || views?.[m] === 'embedded';

/** Sections of switched-off and hidden modules are removed (a hidden module gives no rights); core sections stay. */
export function applyModules(sections, views, catalog) {
  const out = new Set(sections);
  for (const [m, spec] of Object.entries(catalog)) if (views[m] === 'off' || views[m] === 'hidden') for (const s of spec.sections || []) out.delete(s);
  return out;
}

export function embedPoints(views, catalog) {
  const out = {};
  for (const [m, spec] of Object.entries(catalog)) if (views[m] === 'embedded') for (const p of spec.embeds || []) (out[p] ||= []).push(m);
  return out;
}
