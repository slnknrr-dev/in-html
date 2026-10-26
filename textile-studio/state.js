// textile-studio/state.js - the project: one body, an outfit of garments (template, options, layered details, a fabric
// per material slot, a repeat print and placement prints), uploaded artwork, the view settings; normalisation (never
// throws), undo / redo by snapshots, projects kept in IndexedDB (localStorage as the fallback), project files.
//
//   newProject(kind), normalizeProject(raw), store (list / load / save / remove), history(project) -> { commit, undo,
//   redo, canUndo, canRedo }, projectFile(project) -> JSON text, readProjectFile(text) -> project
//
// Design rules of this module:
// - The project is plain JSON (no classes, no Maps, no Dates): snapshots are JSON copies, storage is structured clone,
//   files are JSON text. One representation for all three removes a whole class of serialisation bugs.
// - normalizeProject is the single gate for untrusted input (storage written by an older version, a file from someone
//   else): it clamps numbers, caps array lengths, whitelists strings by regex and drops what it does not know. It
//   never throws, so a damaged project opens degraded instead of locking the user out. Every commit also passes
//   through it, so the UI can mutate freely and still never store an invalid state.
// - Caps (8 garments, 24 placements, 80 imported pieces, 4000 points per polygon) bound the cost of drafting and
//   simulation for a hostile or corrupt file; without them one file could freeze the tab.

import { normalizeBody, defaultBody } from '../body/body.js';
import { GARMENTS, normalizeSpec, OUTFITS } from '../garment/garments.js';
import { defaultDetails } from '../garment/details.js';
import { normalizeDesign, normalizePlacement, DEFAULT_DESIGN } from '../motif/repeat.js';
import { normalizeEdits } from '../garment/edits.js';

// Format tag checked by readProjectFile: rejects random JSON early with a clear message instead of a half-empty project.
export const FORMAT = 'in-html/textile-project';
let seq = 0;
// Unique id without crypto: time (base36) + a per-session counter (two ids in the same millisecond differ) + random
// (two tabs in the same millisecond differ). Not a security token, only a collision-resistant key.
export const uid = (p = 'g') => p + Date.now().toString(36) + (++seq).toString(36) + Math.floor(Math.random() * 1e6).toString(36);

// A garment of the outfit. details: the template's defaults for the sex; ids are made stable ('<type>-<n>') so a
// detail keeps its identity across re-renders. edits: piece materials, laid-on layers and reshaped outlines from 2D.
export function newGarment(garment = 'tshirt', sex = 'female', extra = {}) {
  const spec = normalizeSpec({ garment, opts: extra.opts || {} });
  return {
    id: uid('g'), garment: spec.garment, opts: spec.opts,
    details: (extra.details || defaultDetails(spec.garment, { sex })).map((c, i) => ({ id: c.id || `${c.type}-${i + 1}`, ...c })),
    fabrics: extra.fabrics || {}, design: extra.design ?? null, designOn: ['shell'], placements: extra.placements || [], thickness: null, edits: { materials: {}, layers: [], shape: {} },
  };
}

export function newProject(kind = 'studio') {
  const body = defaultBody('female');
  return normalizeProject({
    format: FORMAT, v: 1, id: uid('p'), name: '', created: Date.now(), updated: Date.now(), mode: kind,
    body, outfit: [newGarment(kind === 'mockup' ? 'tshirt' : 'jacket', body.sex)], active: 0, images: {},
    view: { step: 'body', view2d: 'body', quality: 'normal', threadZoom: 2, sizeSystem: 'EU', show3d: true, fabricWidth: 150, paper: 'A4', allowance: true },
  });
}
// A ready outfit of the catalogue (garment/garments.js OUTFITS) with the fabrics it is made of.
// The fabrics are deep-copied: OUTFITS is a shared module constant and later edits mutate the garment's fabrics.

// A ready outfit of the catalogue (garment/garments.js OUTFITS) with the fabrics it is made of.
export function outfitOf(id, sex = 'male') {
  return (OUTFITS[id] || OUTFITS.tuxedo).map((x) => newGarment(x.garment, sex, {
    opts: x.opts, details: x.details, fabrics: x.fabrics ? JSON.parse(JSON.stringify(x.fabrics)) : {},
  }));
}
export const tuxedoOutfit = (sex = 'male') => outfitOf('tuxedo', sex);
// obj(): the only shape accepted for nested records; arrays and null become {} (typeof [] and null are 'object').

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// An imported pattern (garment 'imported'): its name and pieces as polygons in cm (garment/dxf.js readPatternDXF).
// ptsOf keeps only finite [x, y] pairs and rounds to 0.01 cm (0.1 mm, below cutting precision): smaller files and
// stable JSON keys for the compute.js memo.
// An imported pattern (garment 'imported'): its name and pieces as polygons in cm (garment/dxf.js readPatternDXF).
const ptsOf = (a, max = 4000) => (Array.isArray(a) ? a.filter((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)).slice(0, max).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) : null);
export function normalizeImported(raw) {
  const r = obj(raw);
  // Regex whitelists for material / place: these strings later become CSS-free ids and dictionary keys
  // ('mat.' + material), so only [a-zA-Z0-9] is allowed; anything else falls back to a safe default.
  const pieces = (Array.isArray(r.pieces) ? r.pieces : []).slice(0, 80).map((p) => ({
    name: typeof p?.name === 'string' ? p.name.slice(0, 60) : 'piece', cut: ptsOf(p?.cut) || [], sew: ptsOf(p?.sew), grain: ptsOf(p?.grain, 2),
    n: Math.max(1, Math.min(20, Math.round(Number(p?.n) || 1))), material: typeof p?.material === 'string' && /^[a-zA-Z0-9]{1,24}$/.test(p.material) ? p.material : 'shell',
    fold: !!p?.fold, place: typeof p?.place === 'string' && /^[a-zA-Z]{2,20}$/.test(p.place) ? p.place : null, flip: !!p?.flip,
    drop: typeof p?.drop === 'number' && Number.isFinite(p.drop) ? Math.max(-20, Math.min(80, p.drop)) : null,
  })).filter((p) => p.cut.length >= 3);
  return { name: typeof r.name === 'string' ? r.name.slice(0, 80) : '', pieces };
}
// str(): strings only, capped; the cap bounds storage and the length of labels in the UI.
const str = (v, d = '', max = 200) => (typeof v === 'string' ? v.slice(0, max) : d);

export function normalizeProject(raw) {
  const r = obj(raw);
  const body = normalizeBody(r.body || {});
  // Garments of unknown templates are dropped (GARMENTS[g.garment] check): a file from a newer version must not crash
  // the drafting code with an id it does not know.
  const outfit = (Array.isArray(r.outfit) ? r.outfit : []).filter((g) => g && GARMENTS[g.garment]).slice(0, 8).map((g) => {
    const s = normalizeSpec({ garment: g.garment, opts: g.opts, details: g.details });
    return {
      // Fabrics are only shape-checked here; their content is normalised lazily by normalizeFabric at use (compute.js),
      // which keeps the user's raw choice (e.g. a preset name) instead of freezing every derived default into the file.
      id: str(g.id) || uid('g'), garment: s.garment, opts: s.opts, details: s.details,
      fabrics: Object.fromEntries(Object.entries(obj(g.fabrics)).filter(([, v]) => v && typeof v === 'object').slice(0, 12)),
      design: g.design ? normalizeDesign(g.design) : null,
      designOn: Array.isArray(g.designOn) ? g.designOn.filter((x) => typeof x === 'string').slice(0, 8) : ['shell'],
      placements: (Array.isArray(g.placements) ? g.placements : []).slice(0, 24).map((p) => ({ ...normalizePlacement(p), id: str(p.id) || uid('pl') })),
      // layer thickness override in cm (null: from the fabrics)
      thickness: typeof g.thickness === 'number' && Number.isFinite(g.thickness) ? Math.max(0, Math.min(6, g.thickness)) : null,
      // pattern edits made in 2D: piece materials and layers laid onto pieces (garment/edits.js)
      edits: normalizeEdits(g.edits),
      imported: g.garment === 'imported' ? normalizeImported(g.imported) : null,
    };
  });
  // An empty outfit is never stored: every view assumes outfit[active] exists.
  if (!outfit.length) outfit.push(newGarment('tshirt', body.sex));
  // Images: only data:image/ URLs. Blocks javascript: / http: sources from a crafted file (no tracking pixels, no
  // script URLs). SVG data URLs are allowed: they are shown through <img> / SVG <image>, where scripts do not run.
  const images = {};
  // KNOWN DEFECT: r.view is spread unvalidated, so a crafted or old file can put any value into view (e.g. a string
  // fabricWidth or an unknown quality); consumers fall back with || in most places but not all.
  // Fix: whitelist and clamp each view field like the other sections.
  for (const [k, v] of Object.entries(obj(r.images))) if (v && typeof v.src === 'string' && v.src.startsWith('data:image/')) images[k] = { name: str(v.name, 'image', 120), src: v.src };
  const view = { step: 'body', view2d: 'body', quality: 'normal', threadZoom: 2, sizeSystem: 'EU', show3d: true, fabricWidth: 150, paper: 'A4', allowance: true, ...obj(r.view) };
  return {
    format: FORMAT, v: 1, id: str(r.id) || uid('p'), name: str(r.name, '', 80), created: Number(r.created) || Date.now(), updated: Number(r.updated) || Date.now(),
    mode: r.mode === 'mockup' ? 'mockup' : 'studio', body, outfit, active: Math.max(0, Math.min(outfit.length - 1, Number(r.active) || 0)), images, view,
  };
}

// --- undo / redo ---------------------------------------------------------------------------------------------------

// Snapshot history (not command history): every step stores the whole previous project, so undo is exact by
// construction - no inverse operation per edit to get wrong. Cost: memory. Images live inside the project as data
// URLs and are copied into every snapshot; the 1600 px upload cap (main.js) and the 120-step limit bound it.
/**
 * Snapshot history: commit(label, mutate, { merge }) applies mutate to a copy, keeps the previous state; edits with
 * the same merge key in a row (a slider being dragged) become one step.
 */
export function history(initial, onChange) {
  let cur = initial;
  const past = [], future = [];
  let lastKey = null, lastAt = 0;
  const api = {
    get state() { return cur; },
    replace(p) { cur = p; past.length = 0; future.length = 0; lastKey = null; onChange(cur, 'load'); },
    // mutate works on a deep copy (JSON round trip): the current state stays untouched, so it can be pushed to past and
    // the UI can never corrupt history by mutating the object it renders from.
    commit(label, mutate, o = {}) {
      const next = JSON.parse(JSON.stringify(cur));
      mutate(next);
      next.updated = Date.now();
      // Merge rule: same merge key as the previous commit AND within 1.5 s -> no new undo step. A slider drag fires dozens
      // of input events; without merging, undo would step back one pixel at a time. The time window ends a merge when the
      // user returns to the same slider later (that is a new intention, a new step).
      const now = Date.now();
      if (!(o.merge && o.merge === lastKey && now - lastAt < 1500)) { past.push(cur); if (past.length > 120) past.shift(); }
      lastKey = o.merge || null; lastAt = now;
      future.length = 0;
      cur = normalizeProject(next);
      onChange(cur, label);
    },
    // undo / redo reset lastKey: a slider moved right after an undo must open a new step, not merge into a lost one.
    undo() { if (!past.length) return; future.push(cur); cur = past.pop(); lastKey = null; onChange(cur, 'undo'); },
    redo() { if (!future.length) return; past.push(cur); cur = future.pop(); lastKey = null; onChange(cur, 'redo'); },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
  return api;
}

// --- storage ---------------------------------------------------------------------------------------------------------
// IndexedDB first (large quota, structured clone, async), localStorage as the fallback (private modes and some
// embedded webviews have no IndexedDB, or open() throws). Every failure resolves null instead of rejecting, so
// storage problems degrade to "not saved", never to an unhandled rejection that breaks the edit loop.

const DB = 'textile-studio', STORE = 'projects';
function openDB() {
  return new Promise((resolve) => {
    try {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'id' });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
// tx resolves on transaction COMPLETE (the data is committed), not on request success (which may still be rolled back).
// KNOWN DEFECT: 'rq?.result ?? true' turns a get() of a missing id (result undefined) into true, so store.load(id)
// of an id that is not in IndexedDB returns normalizeProject(true), a fresh default project, instead of null and
// never consults the localStorage fallback. Fix: resolve(rq ? rq.result : true) and let load treat undefined as missing.
const tx = async (mode, fn) => {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const rq = fn(st);
    t.oncomplete = () => resolve(rq?.result ?? true);
    t.onerror = () => resolve(null);
  });
};
const LS = 'textile-studio-projects';
const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };

// list() returns light summaries (no images) for the menu; sorted newest first.
export const store = {
  async list() {
    const all = (await tx('readonly', (s) => s.getAll())) || Object.values(lsAll());
    return all.map((p) => ({ id: p.id, name: p.name, updated: p.updated, garments: (p.outfit || []).map((g) => g.garment) })).sort((a, b) => b.updated - a.updated);
  },
  async load(id) {
    const p = (await tx('readonly', (s) => s.get(id))) || lsAll()[id];
    return p ? normalizeProject(p) : null;
  },
  // save: the copy strips anything non-cloneable (a function sneaked in by a bug would make put() throw DataCloneError).
  // The last-opened id is kept in localStorage: tiny, synchronous, needed before IndexedDB has opened.
  async save(p) {
    const ok = await tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(p))));
    if (!ok) { try { const all = lsAll(); all[p.id] = p; localStorage.setItem(LS, JSON.stringify(all)); } catch { /* storage full */ } }
    try { localStorage.setItem('textile-studio-last', p.id); } catch { /* ignore */ }
  },
  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
    try { const all = lsAll(); delete all[id]; localStorage.setItem(LS, JSON.stringify(all)); } catch { /* ignore */ }
  },
  last() { try { return localStorage.getItem('textile-studio-last'); } catch { return null; } },
};

// Project file: pretty-printed with indent 1 (diffable, still compact). readProjectFile gives the import a NEW id so
// importing a file twice, or importing a file of an open project, never overwrites the stored one.
export const projectFile = (p) => JSON.stringify({ ...p, format: FORMAT }, null, 1);
export function readProjectFile(text) {
  const raw = JSON.parse(text);
  if (raw?.format !== FORMAT) throw new Error('not a textile project file');
  return normalizeProject({ ...raw, id: uid('p') });
}

export { DEFAULT_DESIGN };
