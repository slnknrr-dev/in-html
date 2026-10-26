// embroidery-studio/progress.js - stitching progress of a scheme: stitched cells and part stitches, parking marks
// (thread parked in a cell for the next run of its colour), a daily log, totals per colour; kept in IndexedDB and,
// with a reader key on a server of the site, synchronised between devices.
//
//   openProgress(key, scheme) -> P   P = { done: Uint8Array, parts: Set('x:y:k:c'), parked: Map(cell -> palette),
//                                          started, updated, log, total, doneCount, rev }
//   markCells(P, scheme, layer, cells: [i], on) -> changed count     markPart(P, part, on)
//   perColor(scheme, layer, P) -> [{ done, total }]
//   persist(key, scheme, P) (debounced writes; sync to the server when a reader key is set)
//   progressSummary(scheme, progress) -> element (bar, numbers, dates, pace, estimate)

//
// Representation: full stitches as one byte per cell (Uint8Array, O(1) toggle while dragging over thousands of
// cells), part stitches (quarter / half / three-quarter) as a Set of string keys "x:y:k:c". Stored run-length
// encoded (encodeCells): progress is mostly long runs of done / not done, which compress to a few hundred bytes.
// Sync conflict rule: last writer wins by the `updated` ISO timestamp (lexicographic order = time order). Simple and
// predictable for one person stitching on two devices; concurrent edits on both would lose the older one.
import { h } from '../ui/dom.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { encodeCells, decodeCells, flatten } from '../stitch/model.js';
import { getProgress, putProgress, settings } from './store.js';
import { progressGet, progressPut } from './remote.js';
import { backendInfo } from './catalog.js';

// x, y = cell, k = part kind, c = corner: uniquely identifies one part stitch.
const partKey = (p) => `${p.x}:${p.y}:${p.k}:${p.c}`;
// Day key in UTC (toISOString). Late-evening stitching in a western time zone is logged on the next UTC day; fine
// for a pace estimate.
const today = () => new Date().toISOString().slice(0, 10);

function totals(scheme, layer) {
  let n = 0;
  for (const v of layer.cells) if (v) n++;
  return n + layer.parts.length;
}

// Saved progress applies only if the chart size is unchanged; otherwise cell indices would point at other stitches.
// Done flags are kept only where the chart still has a stitch, and parked marks are range-checked: the scheme may
// have been edited since.
export async function openProgress(key, scheme, layer = flatten(scheme)) {
  const size = scheme.width * scheme.height;
  let rec = await getProgress(key).catch(() => null);
  const st = settings();
  const info = st.readerKey ? await backendInfo() : null;
  if (info && st.readerKey) {
    try {
      const remote = await progressGet(st.readerKey, key);
      if (remote && (!rec || String(remote.updated) > String(rec.updated))) rec = { ...remote, key };
    } catch { /* offline: local progress */ }
  }
  const P = {
    done: new Uint8Array(size), parts: new Set(), parked: new Map(), started: '', updated: '', log: {}, total: totals(scheme, layer), doneCount: 0, rev: 0,
  };
  if (rec && rec.w === scheme.width && rec.h === scheme.height) {
    const d = decodeCells(rec.done, size);
    for (let i = 0; i < size; i++) if (d[i] && layer.cells[i]) P.done[i] = 1;
    for (const k of rec.parts || []) P.parts.add(k);
    for (const [i, p] of rec.parked || []) if (i >= 0 && i < size && p >= 0 && p < scheme.palette.length) P.parked.set(i, p);
    P.started = rec.started || '';
    P.updated = rec.updated || '';
    P.log = rec.log && typeof rec.log === 'object' ? rec.log : {};
  }
  recount(P, scheme, layer);
  return P;
}

// Counts only part stitches that still exist in the chart (stale keys from an earlier version are ignored).
function recount(P, scheme, layer) {
  let n = 0;
  for (let i = 0; i < P.done.length; i++) if (P.done[i] && layer.cells[i]) n++;
  const valid = new Set(layer.parts.map(partKey));
  for (const k of P.parts) if (valid.has(k)) n++;
  P.doneCount = n;
  P.total = totals(scheme, layer);
}

export function markCells(P, scheme, layer, cells, on) {
  let changed = 0;
  for (const i of cells) {
    if (!layer.cells[i]) continue;
    const v = on ? 1 : 0;
    if (P.done[i] !== v) { P.done[i] = v; changed++; }
  }
  if (changed) bump(P, on ? changed : -changed);
  return changed;
}

export function markPart(P, part, on) {
  const k = partKey(part);
  if (on === P.parts.has(k)) return 0;
  if (on) P.parts.add(k); else P.parts.delete(k);
  bump(P, on ? 1 : -1);
  return 1;
}
export const partDone = (P, part) => P.parts.has(partKey(part));

// One bookkeeping point for every change: count, daily log, start / update times. P.done.rev is stamped on the
// typed array itself so the renderer can cheaply tell that the done-layer changed since its last draw.
function bump(P, delta) {
  P.doneCount = Math.max(0, P.doneCount + delta);
  const d = today();
  P.log[d] = Math.max(0, (P.log[d] || 0) + delta);
  if (!P.started && delta > 0) P.started = new Date().toISOString();
  P.updated = new Date().toISOString();
  P.rev++;
  P.done.rev = P.rev;
}

export function perColor(scheme, layer, P) {
  const out = scheme.palette.map(() => ({ done: 0, total: 0 }));
  for (let i = 0; i < layer.cells.length; i++) { const v = layer.cells[i]; if (!v) continue; out[v - 1].total++; if (P.done[i]) out[v - 1].done++; }
  for (const p of layer.parts) { out[p.p].total++; if (P.parts.has(partKey(p))) out[p.p].done++; }
  return out;
}

const timers = new Map();
// Debounced 700 ms per scheme: marking a row of stitches is one write. The server copy is best-effort (errors
// ignored: IndexedDB holds the truth locally and the next save retries).
export function persist(key, scheme, P, { now = false } = {}) {
  const write = async () => {
    timers.delete(key);
    const rec = {
      key, w: scheme.width, h: scheme.height, done: encodeCells(Uint16Array.from(P.done)), parts: [...P.parts], parked: [...P.parked],
      started: P.started, updated: P.updated || new Date().toISOString(), log: P.log, total: P.total, doneCount: P.doneCount,
    };
    await putProgress(rec).catch(() => {});
    const st = settings();
    if (st.readerKey && (await backendInfo())) progressPut(st.readerKey, key, rec).catch(() => {});
  };
  clearTimeout(timers.get(key));
  if (now) return write();
  timers.set(key, setTimeout(write, 700));
  return null;
}

// Pace = average stitches per day over days with any stitching (idle days do not dilute it); estimate = remaining /
// pace, in days.
export function progressSummary(scheme, p) {
  const pct = p.total ? (100 * p.doneCount) / p.total : 0;
  const days = Object.entries(p.log || {}).filter(([, n]) => n > 0);
  const perDay = days.length ? days.reduce((a, [, n]) => a + n, 0) / days.length : 0;
  const left = Math.max(0, p.total - p.doneCount);
  const etaDays = perDay > 0 ? Math.ceil(left / perDay) : null;
  const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(UI_STATE.lang, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return s; } };
  return h('div', { class: 'es-progress' },
    h('div', { class: 'es-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, h('i', { style: { width: pct.toFixed(1) + '%' } })),
    h('div', { class: 'es-prog-t' },
      h('b', {}, t('prog.done', { pct: pct < 10 ? pct.toFixed(1) : Math.round(pct) })),
      h('span', {}, t('prog.count', { a: p.doneCount.toLocaleString(UI_STATE.lang), b: p.total.toLocaleString(UI_STATE.lang) })),
      p.started ? h('span', {}, t('prog.since', { date: fmtDate(p.started) })) : null,
      perDay ? h('span', {}, t('prog.pace', { n: Math.round(perDay) })) : null,
      etaDays != null && left ? h('span', {}, t('prog.eta', { n: etaDays })) : null));
}
