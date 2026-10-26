// batumi-map/main.js - the map page: an SVG map of Batumi drawn from the embedded OpenStreetMap data with
// geo/render.js (roads by class, water, parks, rail, street labels without overlap), panned and zoomed with the
// mouse wheel, drag, pinch, buttons and the keyboard (CSS transform while moving, a fresh SVG when the view settles),
// a scale bar and the attribution always on screen; search of streets and addresses in Georgian, Latin and Russian
// with the result highlighted on the map, house-number lookup on a street, and a click on the map shows the
// coordinates (copy "lat, lng", a geo: link) and the nearest address.
//
// Rendering strategy (the central performance decision of this page):
// - A full SVG of the visible area is expensive (thousands of paths plus label collision). It is rendered only
//   when the view settles (debounced 150 ms), at 1.5x the stage size (25% margin each side), so short pans reveal
//   already-drawn map instead of blank space.
// - During a gesture the existing SVG is moved with a CSS transform (translate + scale) computed from the old and the
//   new view: compositor-only work, 60 fps even on phones. Alternatives fail: re-rendering per pointermove stalls;
//   a tile pyramid would need pre-rendered tiles, which an offline single-file app cannot ship at this size.
// - View state V = { lat, lng, z } (fractional zoom); R = the view the current SVG was drawn for. applyTransform()
//   maps R onto V. All gesture math happens in Web Mercator world units (mapdata.js toWorld/fromWorld).
// Accessibility: the stage is focusable (role=application with a roledescription and a described key help), arrow
// keys pan, +/- zoom, Enter selects the centre point; search is a combobox with aria-activedescendant.
import { DATA_DATE, OSM_COPYRIGHT, findHouse, fmtCount, nameLang, otherNames, search, startShell, streetName, streets, t } from './common.js';
import { BOX, CITY, DARK, LIGHT, fromWorld, mapData, streetBox, toWorld, worldScale } from './mapdata.js';
import { button, card, copyText, field, textInput } from '../ui/app.js';
import { $, clamp, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { renderMapSvg } from '../geo/render.js';
import { fitBBox, metersPerPixel, viewOf } from '../geo/mercator.js';
import { formatLatLng, geoUri } from '../geo/coords.js';
import { haversine } from '../geo/sphere.js';

// Zoom 11 shows all of Batumi; 19 is building level. Beyond the data the map would only show empty land.
const ZMIN = 11, ZMAX = 19;
const VKEY = 'bm-view';

// ---------------------------------------------------------------------------------------------------------------
// State

// The last view is restored only if every field is a finite number; otherwise goHome() fits the city on first paint.
const saved = lsGet(VKEY, null);
const V = { lat: 0, lng: 0, z: 13, ready: false };
if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng) && Number.isFinite(saved.z)) Object.assign(V, { lat: saved.lat, lng: saved.lng, z: clamp(saved.z, ZMIN, ZMAX), ready: true });

// Selection: { type: 'street', id } | { type: 'house', id, label } | { type: 'point', lat, lng } | null
let SEL = null;
let lastQuery = lsGet('bm-query', '');
// Rounded before saving (6 decimals is about 0.1 m): keeps the stored JSON short and stable.
const saveView = debounce(() => lsSet(VKEY, { lat: +V.lat.toFixed(6), lng: +V.lng.toFixed(6), z: +V.z.toFixed(2) }), 400);

const main = $('#main');
// ap-wide removes the shell's max-width: the map should use the whole window.
main.classList.add('bm-main', 'ap-wide');
const els = {};

// ---------------------------------------------------------------------------------------------------------------
// Layout

function render() {
  main.textContent = '';
  els.input = h('input', {
    type: 'search', class: 'ed-input bm-q', id: 'bm-q', value: lastQuery, placeholder: t('bm.search.ph'), autocomplete: 'off', spellcheck: 'false',
    // WAI-ARIA combobox pattern: the input owns the listbox (aria-controls), the highlighted option is announced through
    // aria-activedescendant while focus stays in the input, so typing and arrowing work together.
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'bm-results', 'aria-autocomplete': 'list', 'aria-label': t('bm.search'),
  });
  els.input.addEventListener('input', () => { lastQuery = els.input.value; lsSet('bm-query', lastQuery); searchSoon(); });
  els.input.addEventListener('keydown', onSearchKey);
  els.results = h('ul', { class: 'bm-results', id: 'bm-results', role: 'listbox', 'aria-label': t('bm.results') });
  els.status = h('div', { class: 'bm-status', role: 'status', 'aria-live': 'polite' });
  els.sel = h('div', { class: 'bm-sel' });

  const searchCard = card('bm.search', h('div', { class: 'bm-qwrap' }, iconEl('search'), els.input), h('div', { class: 'ed-hint' }, t('bm.search.hint')), els.status, els.results);
  searchCard.classList.add('bm-search');
  const selCard = card('bm.sel.title', els.sel);
  selCard.classList.add('bm-selcard');

  els.layer = h('div', { class: 'bm-layer' });
  els.scale = h('div', { class: 'bm-scale', 'aria-hidden': 'true' }, h('span', { class: 'bm-scale-bar' }), h('span', { class: 'bm-scale-t' }));
  const zbtn = (k, ic, fn) => h('button', { type: 'button', class: 'bm-zbtn', title: t(k), 'aria-label': t(k), html: icon(ic), onclick: fn });
  els.zoomIn = zbtn('bm.zoomIn', 'plus', () => zoomBy(1));
  els.zoomOut = zbtn('bm.zoomOut', 'minus', () => zoomBy(-1));
  const controls = h('div', { class: 'bm-ctrl' }, els.zoomIn, els.zoomOut, zbtn('bm.home', 'home', () => goHome(true)));
  const attr = h('div', { class: 'bm-attr' }, h('a', { href: OSM_COPYRIGHT, target: '_blank', rel: 'noopener noreferrer' }, t('bm.attr')), ' · ODbL 1.0 · ', DATA_DATE);
  els.stage = h('div', {
    // role=application: tells screen readers to pass arrow keys to the page instead of using them for reading, which the
    // keyboard pan needs. Used only on the map surface, not the whole page.
    class: 'bm-stage', id: 'bm-stage', tabindex: '0', role: 'application', 'aria-roledescription': t('bm.map.role'),
    'aria-label': t('bm.map.title'), 'aria-describedby': 'bm-keys',
  }, els.layer, h('p', { class: 'bm-sr', id: 'bm-keys' }, t('bm.map.keys')), controls, els.scale, attr);
  main.append(h('div', { class: 'bm-work' }, h('div', { class: 'bm-side' }, searchCard, selCard), h('div', { class: 'bm-mapcol' }, els.stage)));
  bindMap();
  doSearch();
  paintSel();
  // Deferred one frame: the stage has no size until it is in the layout, and every projection needs that size.
  requestAnimationFrame(() => { if (!V.ready) goHome(false); renderNow(); });
}

// ---------------------------------------------------------------------------------------------------------------
// Map: view, rendering and gestures

// Effective theme: explicit data-theme wins, else the OS preference (same rule as ui/base.css tokens).
const theme = () => {
  const a = document.documentElement.getAttribute('data-theme');
  return a === 'dark' || (a !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? DARK : LIGHT;
};
const stageSize = () => { const r = els.stage.getBoundingClientRect(); return [Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height))]; };
const curView = () => { const [W, H] = stageSize(); return viewOf({ lat: V.lat, lng: V.lng }, V.z, W, H); };

// The centre stays over the data box (the map does not drift into empty land or sea).
// Clamping the centre (not the edges) to the data box: simple and enough, the 25% render margin covers the rest.
function clampCentre() {
  V.lat = clamp(V.lat, BOX.south, BOX.north);
  V.lng = clamp(V.lng, BOX.west, BOX.east);
  V.z = clamp(V.z, ZMIN, ZMAX);
}

function goHome(animate) {
  const [W, H] = stageSize();
  // fractional: true keeps a non-integer zoom so the city exactly fits any window size.
  const f = fitBBox(CITY, W, H, { padding: 8, fractional: true, maxZoom: 16 });
  setView(f.center.lat, f.center.lng, f.zoom, !animate);
}

function fitTo(box, maxZoom = 17) {
  const [W, H] = stageSize();
  const f = fitBBox(box, W, H, { padding: Math.min(60, W / 8), fractional: true, maxZoom });
  setView(f.center.lat, f.center.lng, f.zoom, true);
}

function setView(lat, lng, z, now) {
  Object.assign(V, { lat, lng, z, ready: true });
  clampCentre();
  moved(now);
}

let R = null;          // the rendered view: { lat, lng, z, view, mx, my }
const renderSoon = debounce(() => renderNow(), 150);

// now = render immediately (selection, buttons); otherwise debounce (continuous gestures, wheel).
function moved(now) {
  applyTransform();
  paintScale();
  saveView();
  if (now) { renderSoon.cancel(); renderNow(); } else renderSoon();
}

// While moving: the last SVG is shifted and scaled so that its centre sits where the current view puts it.
// The SVG was drawn centred on R; project R's centre into the current view to get the translation, and scale by
// 2^(dz) because one zoom level doubles the map. Rounded to 0.1 px / 4 decimals to keep style strings short.
function applyTransform() {
  if (!R) return;
  const v = curView();
  const [W, H] = stageSize();
  const [px, py] = v.project(R.lat, R.lng);
  const s = 2 ** (V.z - R.z);
  els.layer.style.transform = `translate(${(px - W / 2).toFixed(1)}px, ${(py - H / 2).toFixed(1)}px) scale(${s.toFixed(4)})`;
}

// WeakMap shape -> "lang+sid": street names are assigned to shapes lazily and re-assigned only when the language
// changed; WeakMap so nothing leaks if the data were ever reloaded.
const SHAPE_NAME = new WeakMap();
function renderNow() {
  if (!els.stage?.isConnected) return;
  const [W, H] = stageSize();
  // 25% margin each side (render area 1.5x the stage): see the header.
  const mx = Math.round(W * 0.25), my = Math.round(H * 0.25);
  const RW = W + 2 * mx, RH = H + 2 * my;
  const view = viewOf({ lat: V.lat, lng: V.lng }, V.z, RW, RH);
  const b = view.bbox, pad = 0.0015;
  const { shapes, byStreet, places } = mapData();
  const list = streets();
  const lang = nameLang();
  const vis = [];
  // Viewport culling by precomputed bounding boxes (with a small pad for wide strokes and labels) before handing shapes
  // to the renderer: most of the city is off screen at street zoom.
  for (const s of shapes) {
    const [S, Wd, N, E] = s.box;
    if (S > b.north + pad || N < b.south - pad || Wd > b.east + pad || E < b.west - pad) continue;
    if (s.sid >= 0) {
      const key = lang + s.sid;
      if (SHAPE_NAME.get(s) !== key) { s.name = streetName(list[s.sid], lang); SHAPE_NAME.set(s, key); }
    }
    vis.push(s);
  }
  const markers = [];
  const sid = SEL && (SEL.type === 'street' || SEL.type === 'house') ? SEL.id : -1;
  // The selected street is drawn as an extra 'hl' layer on top (style in mapdata.js), from its own geometry.
  if (sid >= 0) for (const pts of byStreet.get(sid) || []) vis.push({ kind: 'hl', pts, name: '' });
  if (SEL?.type === 'house') {
    const hs = findHouse(list[SEL.id], SEL.label);
    if (hs) markers.push({ lat: hs.pt[0], lng: hs.pt[1], label: SEL.label, color: '#e11d48' });
  }
  if (SEL?.type === 'point') markers.push({ lat: SEL.lat, lng: SEL.lng, color: '#2563eb' });
  const th = theme();
  const out = renderMapSvg(vis, {
    width: RW, height: RH, center: { lat: V.lat, lng: V.lng }, zoom: V.z, style: th.style, land: th.land, attribution: false,
    places: places.map((p) => ({ name: p.names[lang] || p.names.ka, pt: p.pt, rank: p.rank })), markers, title: t('bm.map.title'),
  });
  // House points of the selected street on top (geo/render.js has no point layer).
  let dots = '';
  // House dots from zoom 15 (below that they merge into a smear), or always when the street has no line geometry
  // (then the dots are the only thing to show). Labels from zoom 17.5. Points beyond a 20px margin are skipped.
  if (sid >= 0 && (V.z >= 15 || !byStreet.has(sid))) {
    const hs = list[sid].houses();
    const big = V.z >= 17.5;
    dots = `<svg class="bm-dots" width="${RW}" height="${RH}" viewBox="0 0 ${RW} ${RH}" aria-hidden="true">` + hs.map((x) => {
      const [px, py] = out.view.project(x.pt[0], x.pt[1]);
      if (px < -20 || py < -20 || px > RW + 20 || py > RH + 20) return '';
      return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${big ? 4.5 : 3.5}"/>` + (big ? `<text x="${(px + 7).toFixed(1)}" y="${(py + 4).toFixed(1)}">${escText(x.label)}</text>` : '');
    }).join('') + '</svg>';
  }
  // innerHTML of generated SVG: geo/render.js escapes its own text and house labels go through escText, so no
  // untrusted markup reaches the DOM. One string assignment is far faster than building thousands of nodes.
  els.layer.innerHTML = out.svg + dots;
  els.layer.style.cssText = `left:${-mx}px;top:${-my}px;width:${RW}px;height:${RH}px;transform:none`;
  els.stage.classList.toggle('bm-dark', th === DARK);
  R = { lat: V.lat, lng: V.lng, z: V.z };
  // data-paths / data-z: test hooks (e2e.js) to assert that the map really drew something at the expected zoom.
  els.stage.dataset.paths = String(els.layer.querySelectorAll('path').length);
  els.stage.dataset.z = V.z.toFixed(2);
  els.zoomIn.disabled = V.z >= ZMAX - 1e-6;
  els.zoomOut.disabled = V.z <= ZMIN + 1e-6;
}
const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Scale bar: the longest 1 / 2 / 5 × 10^k metres that fit about 110 px.
// Classic 1-2-5 scale: largest nice length not longer than ~110 px; metres per pixel depend on latitude in Mercator.
function paintScale() {
  if (!els.scale) return;
  const mpp = metersPerPixel(V.lat, V.z);
  const max = mpp * 110;
  const p = 10 ** Math.floor(Math.log10(max));
  const m = [5, 2, 1].map((k) => k * p).find((x) => x <= max) || p;
  els.scale.firstChild.style.width = Math.round(m / mpp) + 'px';
  els.scale.lastChild.textContent = m >= 1000 ? t('bm.unit.km', { n: fmtCount(m / 1000) }) : t('bm.unit.m', { n: fmtCount(m) });
}

// Zoom about a stage point (px, py): the world point under it stays put.
// Zoom about a point: the world point under the cursor before and after must coincide, so the new centre is that
// point minus its screen offset divided by the new scale. This is what makes wheel and pinch feel anchored.
function zoomAt(z2, px, py) {
  const [W, H] = stageSize();
  z2 = clamp(z2, ZMIN, ZMAX);
  const [cx, cy] = toWorld(V.lat, V.lng);
  const s1 = worldScale(V.z), s2 = worldScale(z2);
  const wx = cx + (px - W / 2) / s1, wy = cy + (py - H / 2) / s1;
  const c = fromWorld(wx - (px - W / 2) / s2, wy - (py - H / 2) / s2);
  V.lat = c.lat; V.lng = c.lng; V.z = z2;
  clampCentre();
  moved(false);
}
// Button / keyboard zoom snaps to half levels, so repeated clicks land on predictable scales.
function zoomBy(dz) { const [W, H] = stageSize(); zoomAt(Math.round((V.z + dz) * 2) / 2, W / 2, H / 2); }
function panBy(dx, dy) {
  const [cx, cy] = toWorld(V.lat, V.lng);
  const s = worldScale(V.z);
  const c = fromWorld(cx + dx / s, cy + dy / s);
  V.lat = c.lat; V.lng = c.lng;
  clampCentre();
  moved(false);
}

function bindMap() {
  const st = els.stage;
  const local = (e) => { const r = st.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // passive: false is required to preventDefault the wheel (page scroll); deltaMode 1 = lines (Firefox), converted to
  // pixels. 240 px of wheel = one zoom level, clamped so a fast flick cannot jump several levels.
  st.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(V.z - clamp(dy, -240, 240) / 240, x, y);
  }, { passive: false });
  const ptrs = new Map();
  let gesture = null;
  // One pointer = pan, two = pinch. setPointerCapture keeps events coming when the finger leaves the stage. The gesture
  // remembers whether it ever had two pointers, so lifting one finger of a pinch is not taken for a tap.
  st.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.bm-ctrl, .bm-attr')) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try { st.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    ptrs.set(e.pointerId, local(e));
    gesture = { start: [...ptrs.values()].map((p) => p.slice()), moved: 0, t: performance.now(), multi: ptrs.size > 1 || !!gesture?.multi, z: V.z };
    st.classList.add('bm-grab');
  });
  st.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    const cur = local(e);
    if (ptrs.size === 1) {
      gesture.moved += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      ptrs.set(e.pointerId, cur);
      panBy(prev[0] - cur[0], prev[1] - cur[1]);
      return;
    }
    // Two fingers: zoom by the change of their distance about the midpoint, pan by the midpoint's movement.
    const [a0, b0] = [...ptrs.values()];
    ptrs.set(e.pointerId, cur);
    const [a1, b1] = [...ptrs.values()];
    const d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]), d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]);
    const m0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2], m1 = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
    gesture.moved += 10;
    gesture.multi = true;
    if (d0 > 0 && d1 > 0) zoomAt(V.z + Math.log2(d1 / d0), m1[0], m1[1]);
    panBy(m0[0] - m1[0], m0[1] - m1[1]);
  });
  // Tap = single pointer, under 6 px of movement and 600 ms, ending in pointerup (not cancel): selects the point.
  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!ptrs.size) {
      st.classList.remove('bm-grab');
      const g = gesture;
      gesture = null;
      if (g && !g.multi && g.moved < 6 && performance.now() - g.t < 600 && e.type === 'pointerup') {
        const [x, y] = local(e);
        const p = curView().unproject(x, y);
        selectPoint(p.lat, p.lng);
      }
    }
  };
  st.addEventListener('pointerup', end);
  st.addEventListener('pointercancel', end);
  st.addEventListener('dblclick', (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(V.z + 1, x, y); });
  // Only when the stage itself has focus: keys inside the zoom buttons keep their native behaviour.
  st.addEventListener('keydown', (e) => {
    if (e.target !== st) return;
    const [W, H] = stageSize();
    const step = e.shiftKey ? 0.5 : 0.15;
    const k = e.key;
    if (k === 'ArrowLeft') panBy(-W * step, 0);
    else if (k === 'ArrowRight') panBy(W * step, 0);
    else if (k === 'ArrowUp') panBy(0, -H * step);
    else if (k === 'ArrowDown') panBy(0, H * step);
    else if (k === '+' || k === '=' || k === 'PageUp') zoomBy(1);
    else if (k === '-' || k === '_' || k === 'PageDown') zoomBy(-1);
    else if (k === '0' || k === 'Home') goHome(true);
    else if (k === 'Enter' || k === ' ') { const p = curView().unproject(W / 2, H / 2); selectPoint(p.lat, p.lng); }
    else return;
    e.preventDefault();
  });
  // A resized stage keeps the old SVG in place (transform) and re-renders once the resizing settles.
  new ResizeObserver(() => { if (R) { applyTransform(); renderSoon(); } }).observe(st);
}

// The theme can change from the shell (data-theme) or the system.
new MutationObserver(() => renderSoon()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => renderSoon());

// ---------------------------------------------------------------------------------------------------------------
// Search

let RES = [];
let active = -1;
const searchSoon = debounce(() => doSearch(), 120);

// Search runs on every (debounced) keystroke; results are flattened into one list: coordinates, then for each street
// its matching house (if any) followed by the street itself.
function doSearch() {
  const q = els.input.value;
  const r = search(q);
  RES = [];
  if (r.coords) RES.push({ kind: 'coords', pt: r.coords });
  for (const x of r.results) {
    if (x.house) RES.push({ kind: 'house', street: x.street, house: x.house });
    RES.push({ kind: 'street', street: x.street, missing: r.house && !x.house ? r.house : null, near: x.near || [] });
  }
  // With a house number, a found address goes first; a street repeated after its address stays (its whole line).
  active = RES.length ? 0 : -1;
  paintResults(q);
}

function resultRow(x, i) {
  const lang = nameLang();
  let ic = 'street', main, sub = '', extra = null;
  if (x.kind === 'coords') { ic = 'target'; main = t('bm.search.coords'); sub = formatLatLng(x.pt, { digits: 6 }); }
  else if (x.kind === 'house') { ic = 'house'; main = `${streetName(x.street, lang)} ${x.house.label}`; sub = formatLatLng(x.house.pt, { digits: 6 }); }
  else {
    main = streetName(x.street, lang);
    sub = otherNames(x.street, lang).join(' · ');
    extra = h('span', { class: 'bm-count' }, t('bm.houses', { n: x.street.count }));
    if (x.missing) sub = (x.near.length ? t('bm.res.noHouse', { h: x.missing.house + (x.missing.korpus || ''), near: x.near.join(', ') }) : t('bm.res.noHouseAt', { h: x.missing.house })) + (sub ? ' · ' + sub : '');
  }
  return h('li', {
    class: 'bm-res' + (i === active ? ' bm-on' : ''), role: 'option', id: 'bm-r' + i, 'aria-selected': String(i === active), dataset: { i: String(i), kind: x.kind, sid: x.street ? String(x.street.id) : '' },
    // onmousemove (not mouseover) moves the highlight only on real pointer motion, so a list scrolled under a resting
    // mouse by the keyboard does not steal the highlight back.
    onclick: () => choose(i), onmousemove: () => { if (active !== i) { active = i; paintActive(); } },
  }, h('span', { class: 'bm-res-ic', html: icon(ic) }), h('span', { class: 'bm-res-t' }, h('span', { class: 'bm-res-main' }, main), sub ? h('span', { class: 'bm-res-sub' }, sub) : null), extra);
}

function paintResults(q) {
  els.results.textContent = '';
  RES.forEach((x, i) => els.results.append(resultRow(x, i)));
  const has = RES.length > 0;
  els.input.setAttribute('aria-expanded', String(has));
  els.status.textContent = !q.trim() ? '' : has ? t('bm.search.n', { n: RES.length }) : t('bm.search.none');
  els.status.classList.toggle('bm-none', !!q.trim() && !has);
  paintActive();
}
function paintActive() {
  for (const li of els.results.children) { const on = +li.dataset.i === active; li.classList.toggle('bm-on', on); li.setAttribute('aria-selected', String(on)); }
  if (active >= 0) { els.input.setAttribute('aria-activedescendant', 'bm-r' + active); els.results.children[active]?.scrollIntoView({ block: 'nearest' }); } else els.input.removeAttribute('aria-activedescendant');
}
function onSearchKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!RES.length) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + RES.length) % RES.length;
    paintActive();
  } else if (e.key === 'Enter') {
    // Enter runs the pending search synchronously first, so a fast "type + Enter" acts on the final text.
    e.preventDefault();
    searchSoon.cancel();
    doSearch();
    if (active >= 0) choose(active);
  } else if (e.key === 'Escape' && els.input.value) {
    e.preventDefault();
    els.input.value = ''; lastQuery = ''; lsSet('bm-query', ''); doSearch();
  }
}

function choose(i) {
  const x = RES[i];
  if (!x) return;
  active = i; paintActive();
  if (x.kind === 'coords') selectPoint(x.pt.lat, x.pt.lng, true);
  else if (x.kind === 'house') selectHouse(x.street.id, x.house.label);
  else selectStreet(x.street.id);
}

// ---------------------------------------------------------------------------------------------------------------
// Selection

function selectStreet(id, { fit = true } = {}) {
  SEL = { type: 'street', id };
  const s = streets()[id];
  const box = streetBox(mapData().byStreet.get(id), s.houses());
  if (fit && box) fitTo(box, 17); else moved(true);
  paintSel(); writeHash();
}
function selectHouse(id, label, { fit = true } = {}) {
  const hs = findHouse(streets()[id], label);
  if (!hs) return selectStreet(id, { fit });
  SEL = { type: 'house', id, label: hs.label };
  if (fit) setView(hs.pt[0], hs.pt[1], Math.max(V.z, 17.5), true); else moved(true);
  paintSel(); writeHash();
}
function selectPoint(lat, lng, centre = false) {
  SEL = { type: 'point', lat, lng };
  if (centre) setView(lat, lng, Math.max(V.z, 17), true); else moved(true);
  paintSel(); writeHash();
}
function clearSel() { SEL = null; moved(true); paintSel(); writeHash(); }

// The nearest address to a point (all houses, ~11 000; fast enough on a click).
// Brute force over all houses with a cheap prefilter (street centre within ~3 km): ~11 000 points is a few ms.
// Squared distance with longitude scaled by cos(41.6 deg), about 0.75, for ranking; haversine only for the winner.
// Beyond 250 m there is no meaningful "nearest address".
// KNOWN DEFECT: s.centre is null for every street with the current data (see common.js streets()), so the prefilter
// skips all streets and this always returns null. Fix in tools/build-data.js (emit the centre), or prefilter by the
// street's house points when centre is missing.
function nearestAddress(lat, lng) {
  let best = null, bd = Infinity;
  for (const s of streets()) {
    if (!s.count || !s.centre || Math.abs(s.centre[0] - lat) > 0.03 || Math.abs(s.centre[1] - lng) > 0.03) continue;
    for (const x of s.houses()) {
      const d = (x.pt[0] - lat) ** 2 + ((x.pt[1] - lng) * 0.75) ** 2;
      if (d < bd) { bd = d; best = { street: s, house: x }; }
    }
  }
  if (!best) return null;
  best.m = haversine([lat, lng], best.house.pt);
  return best.m < 250 ? best : null;
}

// Rows whose value is empty are dropped, so optional fields need no conditionals at the call sites.
const kv = (rows) => h('dl', { class: 'ap-kv bm-kv' }, rows.filter((r) => r && r[1]).map(([k, v]) => [h('dt', {}, t(k)), h('dd', {}, v)]));
const small = (b) => { b.classList.add('ed-sm'); return b; };

function paintSel() {
  const box = els.sel;
  if (!box) return;
  box.textContent = '';
  if (!SEL) { box.append(h('div', { class: 'ap-empty bm-empty' }, t('bm.sel.none'))); return; }
  const lang = nameLang();
  if (SEL.type === 'point') {
    const p = { lat: SEL.lat, lng: SEL.lng };
    const dd = formatLatLng(p, { digits: 6 });
    const near = nearestAddress(SEL.lat, SEL.lng);
    box.append(h('div', { class: 'bm-sel-h' }, iconEl('target'), h('strong', {}, t('bm.pt.title'))),
      kv([
        ['bm.pt.coords', h('span', { class: 'bm-mono', id: 'bm-coords' }, dd)],
        ['bm.pt.dms', h('span', { class: 'bm-mono' }, formatLatLng(p, { format: 'dms', lang: lang === 'ka' ? 'ka' : lang === 'ru' ? 'ru' : 'en' }))],
        ['bm.pt.geo', h('a', { href: geoUri(p), class: 'bm-mono' }, geoUri(p))],
        near ? ['bm.pt.near', h('button', { type: 'button', class: 'bm-link', onclick: () => selectHouse(near.street.id, near.house.label) }, t('bm.pt.nearV', { addr: `${streetName(near.street, lang)} ${near.house.label}`, d: fmtCount(Math.round(near.m)) }))] : null,
      ]),
      h('div', { class: 'ap-actions' },
        small(button('bm.pt.copy', 'copy', () => copyText(dd, t('bm.pt.copied')), 'primary')),
        small(button('bm.pt.copyGeo', 'link', () => copyText(geoUri(p), t('bm.pt.copiedGeo')))),
        small(button('bm.sel.clear', 'close', clearSel))));
    return;
  }
  const s = streets()[SEL.id];
  const hasLine = mapData().byStreet.has(s.id);
  const head = h('div', { class: 'bm-sel-h' }, iconEl(SEL.type === 'house' ? 'house' : 'street'), h('strong', { id: 'bm-sel-name' }, streetName(s, lang) + (SEL.type === 'house' ? ' ' + SEL.label : '')));
  box.append(head);
  if (SEL.type === 'house') {
    const x = findHouse(s, SEL.label);
    const dd = formatLatLng(x.pt, { digits: 6 });
    box.append(kv([['bm.pt.coords', h('span', { class: 'bm-mono', id: 'bm-coords' }, dd)], ['bm.pt.geo', h('a', { href: geoUri(x.pt), class: 'bm-mono' }, geoUri(x.pt))]]),
      h('div', { class: 'ap-actions' },
        small(button('bm.pt.copy', 'copy', () => copyText(dd, t('bm.pt.copied')), 'primary')),
        small(button('bm.pt.copyGeo', 'link', () => copyText(geoUri(x.pt), t('bm.pt.copiedGeo')))),
        small(button('bm.sel.street', 'street', () => selectStreet(s.id)))));
  }
  box.append(kv([['bm.l.ka', s.ka], ['bm.l.en', s.en || (s.ka ? h('span', {}, h('span', {}, streetName(s, 'en')), ' ', h('em', { class: 'bm-muted' }, t('bm.translit'))) : '')], ['bm.l.ru', s.ru], ['bm.sel.houses', fmtCount(s.count)]]));
  if (!hasLine) box.append(h('div', { class: 'ed-hint' }, t('bm.sel.noGeom')));
  if (s.count) box.append(houseList(s));
  if (SEL.type === 'street') box.append(h('div', { class: 'ap-actions' }, small(button('bm.sel.clear', 'close', clearSel))));
}

// House-number lookup on the selected street: a filter field and the numbers as buttons.
function houseList(s) {
  const hs = s.houses();
  const wrap = h('div', { class: 'bm-houses' });
  const list = h('div', { class: 'bm-hchips', role: 'list' });
  const MAX = 160;
  // At most 160 chips: long streets have hundreds of numbers; the rest are reachable through the filter.
  const paint = (q) => {
    list.textContent = '';
    const f = String(q || '').trim().toLowerCase();
    const shown = f ? hs.filter((x) => x.label.toLowerCase().startsWith(f) || x.n.house === f) : hs;
    for (const x of shown.slice(0, MAX)) {
      list.append(h('button', { type: 'button', role: 'listitem', class: 'bm-hchip' + (SEL?.type === 'house' && SEL.label === x.label ? ' bm-on' : ''), dataset: { label: x.label }, onclick: () => selectHouse(s.id, x.label) }, x.label));
    }
    if (shown.length > MAX) list.append(h('span', { class: 'bm-muted' }, t('bm.sel.more', { n: shown.length - MAX })));
    if (!shown.length) list.append(h('span', { class: 'bm-muted' }, t('bm.sel.noHouse')));
  };
  const input = textInput('', paint, { class: 'ed-input bm-hq', inputmode: 'text', placeholder: t('bm.sel.housePh'), autocomplete: 'off' });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const x = findHouse(s, input.value.trim());
    if (x) selectHouse(s.id, x.label);
  });
  paint('');
  wrap.append(field('bm.sel.houseNo', input), list);
  return wrap;
}

// ---------------------------------------------------------------------------------------------------------------
// Links: #street=<id>, #house=<id>:<number>, #at=<lat>,<lng>[,<zoom>]

// replaceState: the URL always reflects the selection (shareable link) without adding history entries per click.
// KNOWN DEFECT: street ids are indices into the generated gazetteer, so a link made before a data rebuild may point
// at another street afterwards. Fix: link by a stable key (OSM way id or the Georgian name) instead of the index.
function writeHash() {
  let hsh = '';
  if (SEL?.type === 'street') hsh = '#street=' + SEL.id;
  else if (SEL?.type === 'house') hsh = '#house=' + SEL.id + ':' + encodeURIComponent(SEL.label);
  else if (SEL?.type === 'point') hsh = '#at=' + SEL.lat.toFixed(6) + ',' + SEL.lng.toFixed(6);
  history.replaceState(null, '', location.pathname + location.search + hsh);
}

function readHash() {
  const m = (location.hash || '').match(/^#(street|house|at)=(.+)$/);
  if (!m) return false;
  const list = streets();
  if (m[1] === 'street' && list[+m[2]]) { selectStreet(+m[2]); return true; }
  if (m[1] === 'house') {
    const [id, label] = m[2].split(':');
    if (list[+id]) { selectHouse(+id, decodeURIComponent(label || '')); return true; }
  }
  if (m[1] === 'at') {
    const [lat, lng, z] = m[2].split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) { SEL = { type: 'point', lat, lng }; setView(lat, lng, Number.isFinite(z) ? z : 17, true); paintSel(); return true; }
  }
  return false;
}

startShell('map', () => { render(); });
render();
// Two frames: the first lays out the shell, the second has the stage size, which selection with fit needs.
requestAnimationFrame(() => requestAnimationFrame(() => readHash()));
window.addEventListener('hashchange', () => readHash());
