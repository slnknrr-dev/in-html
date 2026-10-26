// planogram-studio/common.js - shared parts of the planogram and store pages: the shell (pages resolved from the
// hidden anchors of the page HTML, so the build can rewrite them), app icons, fixture kinds (gondola, wall rack,
// fridge, pegboard) with their default shelves, the project model (products, fixtures, the store floor plan) with
// its normaliser and localStorage persistence, saved versions, number formatting, small widgets, SVG -> PNG and the
// print sheet at a scale.
//
// Units: the planogram model works in centimetres (fixtures, shelves, products), the store plan in metres; print
// sizes are millimetres. Every value crossing a boundary is converted by the library that owns it.
// The project is untrusted (localStorage, imported JSON): normalizeProject caps list sizes, deduplicates ids and
// clamps settings, so pages can assume a well-formed model.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { normalizeFixture, normalizeProduct, normalizeShelf, round } from '../planogram/model.js';
import { normalizePlan } from '../plan/model.js';

export const LOGO = 'M4 3v18M20 3v18M4 8.5h16M4 14.5h16M4 20.5h16M6.5 5h3v3.5h-3zM11 6h2.5v2.5H11zM6.5 11h2.5v3.5H6.5zM10.5 10.5h4v4h-4zM15.5 12h2.5v2.5h-2.5z';

addIcons({
  shelf: LOGO,
  fridge: 'M6 2h12v20H6zM6 10h12M9 5v2M9 13v3',
  peg: 'M4 4h16v16H4zM8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
  gondola: 'M3 20h18M5 20V6h14v14M5 10h14M5 15h14M12 6v14',
  wall: 'M3 3h18v18M3 3v18h18M3 9h18M3 15h18',
  facing: 'M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z',
  compare: 'M8 3v18M16 3v18M3 8h5M16 16h5M3 16h5M16 8h5',
  depth: 'M4 8l8-5 8 5v8l-8 5-8-5zM4 8l8 5 8-5M12 13v8',
  turn: 'M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5',
  move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4',
  ruler: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
});

// --- fixture kinds ---------------------------------------------------------------------------------------------

// Defaults of a new fixture of each kind (cm). Pegboards hang packs on hooks at a hole pitch.
export const FIXTURE_KINDS = {
  gondola: { icon: 'gondola', width: 125, height: 200, depth: 50, base: 10, shelves: 5, thickness: 3, stencil: 'gondola' },
  wall: { icon: 'wall', width: 100, height: 220, depth: 40, base: 12, shelves: 5, thickness: 3, stencil: 'wall-rack' },
  fridge: { icon: 'fridge', width: 70, height: 200, depth: 60, base: 15, shelves: 5, thickness: 2, stencil: 'fridge-upright' },
  peg: { icon: 'peg', width: 100, height: 180, depth: 30, base: 40, shelves: 3, thickness: 1, pitch: 2.5, stencil: 'wall-rack' },
};
export const KIND_KEYS = Object.keys(FIXTURE_KINDS);

// Plan ids allow only [A-Za-z0-9_-] (plan/model.js cleanId), so fixture ids follow the same rule.
const cleanId = (v, max = 40) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
// Ids: time base36 tail + per-session counter + random suffix. The counter makes ids unique within one session even
// when created in the same millisecond; the random part separates two tabs. Not a security token, only a key.
let idSeq = 0;
export const uid = (prefix) => prefix + Date.now().toString(36).slice(-5) + (++idSeq).toString(36) + Math.random().toString(36).slice(2, 5);

// Shelves of a kind spread evenly over the height above the plinth.
// Gap = free height / count, floored to whole cm and never below 10 cm (a shelf a product cannot stand on is useless).
export function kindShelves(kind, f, count) {
  const k = FIXTURE_KINDS[kind] || FIXTURE_KINDS.gondola;
  const n = Math.max(1, Math.min(30, count ?? k.shelves));
  const free = (f.height ?? k.height) - (f.base ?? k.base) - n * k.thickness;
  const gap = Math.max(10, Math.floor(free / n));
  return Array.from({ length: n }, () => normalizeShelf({
    id: uid('s'), kind: k.pitch ? 'peg' : 'shelf', pitch: k.pitch, width: f.width ?? k.width, depth: f.depth ?? k.depth,
    height: gap, thickness: k.thickness, positions: [],
  }));
}

export function newFixture(kind = 'gondola', name = '') {
  const k = FIXTURE_KINDS[kind] || FIXTURE_KINDS.gondola;
  const f = { id: uid('f'), kind, name, width: k.width, height: k.height, depth: k.depth, base: k.base };
  return normFixture({ ...f, shelves: kindShelves(kind, f) });
}

// normalizeFixture plus the kind (app-local field) and a plan-safe id.
// The kind is inferred from shelf types when missing (any pegboard shelf -> peg) so old projects still get icons.
export function normFixture(raw = {}) {
  const f = normalizeFixture(raw);
  f.id = cleanId(f.id) || uid('f');
  f.kind = KIND_KEYS.includes(raw.kind) ? raw.kind : f.shelves.some((s) => s.kind === 'peg') ? 'peg' : 'gondola';
  f.shelves.forEach((s) => { s.id = cleanId(s.id) || uid('s'); });
  return f;
}

// normalizeProduct; `ean` is accepted for `code` (the barcode), ids stay unique.
export function normProduct(raw = {}) {
  const p = normalizeProduct({ ...raw, code: raw.code ?? raw.ean ?? null });
  p.id = String(p.id).replace(/[\u0000-\u001f]/g, '').slice(0, 64) || uid('p');
  return p;
}

// --- project ---------------------------------------------------------------------------------------------------

export const PKEY = 'pgs-project';
export const VKEY = 'pgs-versions';

/** { v, name, products, fixtures, plan, settings: { minDays, maxDays } } from any JSON. */
// Duplicate ids are re-issued rather than dropped: a pasted duplicate product must not delete user data.
export function normalizeProject(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const products = [];
  for (const x of (Array.isArray(r.products) ? r.products : []).slice(0, 5000)) {
    if (!x || typeof x !== 'object') continue;
    const p = normProduct(x);
    if (seen.has(p.id)) p.id = uid('p');
    seen.add(p.id);
    products.push(p);
  }
  const fids = new Set();
  const fixtures = (Array.isArray(r.fixtures) ? r.fixtures : []).slice(0, 200).filter((x) => x && typeof x === 'object').map(normFixture);
  for (const f of fixtures) { if (fids.has(f.id)) f.id = uid('f'); fids.add(f.id); }
  const plan = normalizePlan({ kind: 'shop', ...(r.plan && typeof r.plan === 'object' ? r.plan : {}) });
  plan.kind = 'shop';
  const s = r.settings && typeof r.settings === 'object' ? r.settings : {};
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    v: 1, name: String(r.name ?? '').slice(0, 120), products, fixtures, plan,
    settings: { minDays: num(s.minDays, 0, 365, 2), maxDays: num(s.maxDays, 1, 3650, 30) },
  };
}

export const loadProject = () => { const raw = lsGet(PKEY, null); return raw ? normalizeProject(raw) : null; };
export const saveProject = (p) => lsSet(PKEY, p);

// Saved versions: [{ id, name, at, fixtureId, fixtureName, fixture, names: { productId: name } }], newest first.
// Versions live under a separate key: restoring or clearing the project does not touch history. Capped at 200 on save
// to stay well inside the localStorage quota.
export function versionsList() {
  const v = lsGet(VKEY, []);
  return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && x.fixture && Array.isArray(x.fixture.shelves)).map((x) => ({ ...x, fixture: normFixture(x.fixture) })) : [];
}
export const versionsSave = (list) => lsSet(VKEY, list.slice(0, 200));

// A version stores product names used by the fixture: a diff against an old version stays readable even after the
// products were renamed or deleted from the library. JSON round-trip = deep copy detached from the live fixture.
export function makeVersion(name, fixture, products) {
  const used = new Set(fixture.shelves.flatMap((s) => s.positions.map((p) => p.productId)));
  const names = {};
  for (const p of products) if (used.has(p.id)) names[p.id] = p.name;
  return { id: uid('v'), name: String(name || '').slice(0, 120), at: Date.now(), fixtureId: fixture.id, fixtureName: fixture.name, fixture: JSON.parse(JSON.stringify(fixture)), names };
}

// --- shell -----------------------------------------------------------------------------------------------------

export function pageHref(id) {
  const a = document.getElementById(id);
  return a ? a.getAttribute('href') : '#';
}

export function startShell(current, onLang) {
  startApp({
    key: 'pgs', name: 'pgs.name', logo: LOGO, offline: true, onLang,
    pages: [
      { href: pageHref('pg-plan'), label: 'pgs.page.plan', current: current === 'plan' },
      { href: pageHref('pg-store'), label: 'pgs.page.store', current: current === 'store' },
    ],
  });
}

// --- formatting ------------------------------------------------------------------------------------------------

// Number formatting follows the document language (set by the shell on language switch).
const lang = () => document.documentElement.lang || 'en';
export const fmt = (n, d = 1) => (n == null || !Number.isFinite(+n) ? '—' : Number(n).toLocaleString(lang(), { maximumFractionDigits: d }));
export const fmtPct = (share, d = 0) => (share == null ? '—' : Number(share * 100).toLocaleString(lang(), { maximumFractionDigits: d }) + ' %');
export const fmtMoney = (n) => (n == null ? '—' : Number(n).toLocaleString(lang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₾');
export const dims = (p) => (p && p.width != null && p.height != null && p.depth != null ? `${fmt(p.width)} × ${fmt(p.height)} × ${fmt(p.depth)}` : '—');
export const fmtDate = (ms) => new Date(ms).toLocaleString(lang(), { dateStyle: 'medium', timeStyle: 'short' });
export { round };

// --- small widgets ---------------------------------------------------------------------------------------------

let gid = 0;
// Labelled group for non-input controls: the label names the group through aria-labelledby.
export function group(label, control, hint) {
  const id = 'pgs-g' + (++gid);
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'ed-field' }, h('span', { class: 'ed-label', id }, t(label)), control, hint ? h('div', { class: 'ed-hint' }, t(hint)) : null);
}

// Number input that reports on change (Enter / blur), clamped; .set(v) updates it.
// Commits on change (Enter/blur), clamps to [min, max], accepts a decimal comma; an unparsable value reverts.
export function numInput(value, onSet, { min = 0, max = 10000, step = 1, label = '', cls = '' } = {}) {
  const i = h('input', { type: 'number', class: 'ed-input pgs-num' + (cls ? ' ' + cls : ''), value: value ?? '', min, max, step, inputmode: 'decimal', 'aria-label': label || null });
  i.addEventListener('change', () => {
    const n = Number(String(i.value).replace(',', '.'));
    if (!Number.isFinite(n)) { i.value = value ?? ''; return; }
    onSet(Math.min(max, Math.max(min, n)));
  });
  i.set = (v) => { i.value = v ?? ''; };
  return i;
}

// [−] value [+] stepper for facings.
// Stepper buttons carry data-fk ids so the page can restore focus to the same control after a re-render.
export function stepper(label, value, onSet, { min = 1, max = 100, cls = '', fk = '' } = {}) {
  const inp = numInput(value, onSet, { min, max, label: t(label) });
  if (fk) inp.dataset.fk = fk;
  const b = (d, ic, k) => h('button', { type: 'button', class: 'ed-iconbtn pgs-step', 'aria-label': `${t(label)} ${k}`, title: `${t(label)} ${k}`, dataset: fk ? { d: String(d), fk: fk + (d > 0 ? '+' : '-') } : { d: String(d) }, html: ic, onclick: () => onSet(Math.min(max, Math.max(min, (Number(inp.value) || 0) + d))) });
  const plus = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const minus = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
  const box = h('div', { class: 'pgs-stepper' + (cls ? ' ' + cls : '') }, b(-1, minus, '−1'), inp, b(1, plus, '+1'));
  const id = 'pgs-g' + (++gid);
  inp.id = id;
  return h('div', { class: 'ed-field pgs-stepf' }, h('label', { class: 'ed-label', for: id }, t(label)), box);
}

export function kvRows(rows) {
  const dl = h('dl', { class: 'ap-kv pgs-kv' });
  for (const [k, v] of rows) {
    if (v == null || v === '') continue;
    dl.append(h('dt', {}, t(k)), h('dd', {}, v));
  }
  return dl;
}

export const chip = (text, cls = '') => h('span', { class: 'pgs-chip' + (cls ? ' ' + cls : '') }, text);

// --- SVG -> PNG, print sheet -------------------------------------------------------------------------------------

// Rasterises SVG markup (with width / height attributes in px) at `k` times its size on white.
// SVG -> PNG via an <img> of a blob URL drawn onto a canvas at k x size on a white background (PNG would otherwise be
// transparent and look black in some viewers). The blob URL is revoked on both outcomes to avoid leaking memory.
// Same-origin blob: the canvas is not tainted, so toBlob works.
export function svgToPng(svg, k = 2) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg')); };
    img.src = url;
  });
}

export const PAPERS = { a4: [210, 297], a3: [297, 420] };

// Size of a sheet's printable area in mm (10 mm margins).
export function printable(paper, landscape) {
  const [w, hh] = PAPERS[paper] || PAPERS.a4;
  return landscape ? [hh - 20, w - 20] : [w - 20, hh - 20];
}

// Prints `content` (an element) alone on pages of `paper` (a4 / a3), portrait or landscape.
// Paper size and orientation need an @page rule, which cannot be set from a stylesheet per print; a temporary
// <style> is injected and removed after printing (afterprint, or a 1 s fallback where afterprint is unreliable).
export function printSheet(content, { paper = 'a4', landscape = false } = {}) {
  document.getElementById('pgs-print')?.remove();
  document.getElementById('pgs-page-css')?.remove();
  const sheet = h('div', { id: 'pgs-print', class: 'pgs-print' }, content);
  const css = h('style', { id: 'pgs-page-css' }, `@page { size: ${paper.toUpperCase()} ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`);
  document.head.append(css);
  document.body.append(sheet);
  document.body.classList.add('pgs-printing');
  const done = () => { document.body.classList.remove('pgs-printing'); sheet.remove(); css.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

// mm size of an SVG string with width="…mm" height="…mm".
export function svgMm(svg) {
  const w = /width="([\d.]+)mm"/.exec(svg), hh = /height="([\d.]+)mm"/.exec(svg);
  return [w ? +w[1] : 0, hh ? +hh[1] : 0];
}
