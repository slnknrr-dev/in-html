// route-planner/sheet.js - the trip sheet: the plan of the saved state (the order chosen on the plan page) as a
// printable A4 sheet with the trip details (title, date, driver, vehicle), totals, a small schematic map and one row per
// stop with arrival / departure times, time windows, tasks, kilometres and empty columns for the actual time and a
// signature. `sheet.html#print` opens the print dialog right away.
//
// Design: a read-mostly view. It owns only the trip details (S.meta); stops, order and settings are edited on the plan
// page and arrive through the shared localStorage state. The sheet is plain HTML styled for paper (A4, fixed light
// colours, @media print in app.css), not a generated PDF: the browser's print engine gives vector text, page breaks,
// the user's paper size and "Save as PDF" for free, with zero dependencies.
// The plan is recomputed here (computePlan) rather than stored by the plan page, so the sheet can never show
// distances that disagree with the stops it lists.
import { computePlan, fitView, fmtClock, fmtCoord, fmtDur, fmtKm, lang, loadState, mapSvg, pageHref, saveState, startShell, windowText } from './common.js';
import { button, field, t } from '../ui/app.js';
import { $, debounce, h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { parseDay } from '../calendar/date.js';

let S = null;
const save = debounce(() => saveState(S), 250);
const main = $('#main');
main.classList.add('rp-sheet-page');
let paper = null;

// Full render: reload state (the source of truth may have changed in another tab), build the detail fields (screen
// only: .rp-noprint) and the paper. Editing a detail saves (debounced) and repaints only the paper, so the focused
// input survives. The date input stores only a valid ISO day (parseDay) or ''.
function render() {
  S = loadState();
  main.textContent = '';
  const m = S.meta;
  const inp = (k, attrs = {}) => {
    const x = h('input', { class: 'ed-input', value: m[k], ...attrs });
    x.addEventListener('input', () => { m[k] = k === 'date' ? parseDay(x.value) || '' : x.value; save(); paintSheet(); });
    return x;
  };
  const back = h('a', { class: 'ed-btn', href: pageHref('pg-plan') }, iconEl('chevLeft'), t('rp.sh.back'));
  const print = button('rp.sh.print', 'print', () => window.print(), 'primary');
  print.id = 'rp-print';
  const bar = h('section', { class: 'ap-card rp-noprint rp-sh-bar' },
    h('div', { class: 'rp-sh-fields' },
      field('rp.sh.title', inp('title', { placeholder: t('rp.sh.titlePh'), id: 'rp-sh-title' })),
      field('rp.sh.date', inp('date', { type: 'date' })),
      field('rp.sh.driver', inp('driver')),
      field('rp.sh.vehicle', inp('vehicle'))),
    h('div', { class: 'ap-actions' }, back, print));
  paper = h('article', { class: 'rp-paper', id: 'rp-paper' });
  main.append(bar, paper);
  paintSheet();
}

// 'YYYY-MM-DD' -> long localised date ("Monday, 26 October 2026"). Parsed and formatted both in UTC: the string is
// built as UTC midnight, and formatting it in a western time zone would otherwise print the previous day. try/catch:
// Intl throws RangeError on an invalid locale tag; the raw ISO day is a correct, if plain, fallback.
function dateText(day) {
  if (!day) return '';
  try { return new Intl.DateTimeFormat(lang(), { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z')); } catch { return day; }
}

// The paper. Fixed map size 760x300 (viewBox units): the SVG scales to the paper column width, so a fixed geometry
// gives the same framing and label placement on screen and in print. ghost:false: on paper only the route to drive
// matters. The "actual time" and "signature" columns are deliberately empty: they are filled in by hand on the road.
// The ODbL attribution is printed whenever OSM data appears on the map. The notes state the speed and road factor the
// times rest on, so a reader can judge the estimate. Stop count = order length - 1 (the depot is not a stop).
function paintSheet() {
  const P = computePlan(S);
  paper.textContent = '';
  const m = S.meta;
  if (!P.depot) {
    paper.append(h('div', { class: 'ap-empty' }, t('rp.plan.empty'), ' ', h('a', { href: pageHref('pg-plan') }, t('rp.sh.back'))));
    return;
  }
  const mode = t('rp.mode.' + S.plan.mode);
  paper.append(h('header', { class: 'rp-sh-head' },
    h('div', {}, h('h2', { class: 'rp-sh-title' }, m.title || t('rp.sh.untitled')), h('div', { class: 'rp-sh-sub' }, [dateText(m.date), m.driver && t('rp.sh.driverIs', { v: m.driver }), m.vehicle && t('rp.sh.vehicleIs', { v: m.vehicle })].filter(Boolean).join(' · '))),
    h('dl', { class: 'rp-sh-totals' },
      h('dt', {}, t('rp.sum.stops')), h('dd', {}, t('rp.stops.n', { n: P.order.length - 1 })),
      h('dt', {}, t('rp.sh.distance')), h('dd', { id: 'rp-sh-km' }, fmtKm(P.km.current)),
      h('dt', {}, t('rp.sum.time')), h('dd', {}, `${fmtDur(P.totalMin)} · ${S.cfg.start}–${fmtClock(P.endMin)}`),
      h('dt', {}, t('rp.sh.order')), h('dd', {}, mode))));
  const W = 760, H = 300;
  const map = mapSvg({ width: W, height: H, view: fitView(P.located, W, H), plan: P, ghost: false, title: t('rp.map.aria') });
  paper.append(h('figure', { class: 'rp-sh-map', html: map.svg }));
  if (map.fixture) paper.append(h('div', { class: 'rp-sh-attr' }, '© OpenStreetMap contributors (ODbL)'));
  const head = ['rp.sh.n', 'rp.sh.arrive', 'rp.sh.depart', 'rp.col.window', 'rp.sh.stop', 'rp.sh.task', 'rp.sh.km', 'rp.sh.actual', 'rp.sh.sign'];
  const tbody = h('tbody', {});
  for (const r of P.rows) {
    const s = r.stop;
    const task = r.ret ? t('rp.sh.return') : r.n === 0 ? t('rp.sh.start') : s.kind ? t('rp.kind.' + s.kind) + (s.pair ? ' · ' + s.pair : '') : t('rp.sh.visit');
    tbody.append(h('tr', { class: (r.late ? 'rp-sh-late ' : '') + (r.n === 0 || r.ret ? 'rp-sh-depot' : '') },
      h('td', { class: 'rp-sh-num' }, r.n === 0 || r.ret ? 'S' : String(r.n)),
      h('td', { class: 'rp-sh-time' }, r.n === 0 ? '' : fmtClock(r.arrive), r.wait >= 1 ? h('div', { class: 'rp-sh-small' }, t('rp.pl.wait', { d: fmtDur(r.wait) })) : null),
      h('td', { class: 'rp-sh-time' }, r.ret ? '' : fmtClock(r.depart)),
      h('td', { class: 'rp-sh-time' }, r.ret ? '' : windowText(s), r.late ? h('div', { class: 'rp-sh-small rp-bad' }, t('rp.late')) : null),
      h('td', {}, h('div', { class: 'rp-sh-name' }, s.name || s.address), s.name && s.address ? h('div', { class: 'rp-sh-small' }, s.address) : null,
        h('div', { class: 'rp-sh-small rp-mono' }, fmtCoord(s)), s.note ? h('div', { class: 'rp-sh-small' }, s.note) : null),
      h('td', {}, task, !r.ret && r.service ? h('div', { class: 'rp-sh-small' }, t('rp.min', { m: r.service })) : null),
      h('td', { class: 'rp-sh-km' }, r.n ? fmtKm(r.legKm) : '', r.n ? h('div', { class: 'rp-sh-small' }, '∑ ' + fmtKm(r.totalKm)) : null),
      h('td', { class: 'rp-sh-blank' }), h('td', { class: 'rp-sh-blank rp-sh-signc' })));
  }
  paper.append(h('table', { class: 'rp-sh-table', id: 'rp-sh-table' }, h('thead', {}, h('tr', {}, head.map((k) => h('th', { scope: 'col' }, t(k))))), tbody));
  const notes = [];
  if (P.violations.length) notes.push(t('rp.sh.violations', { n: P.violations.length }));
  if (P.missing.length) notes.push(t('rp.sh.missing', { names: P.missing.map((s) => s.name || s.address).join(', ') }));
  notes.push(t('rp.sh.basis', { speed: S.cfg.speed, rf: S.cfg.rf }));
  paper.append(h('div', { class: 'rp-sh-notes' }, notes.map((x) => h('p', {}, x))));
  paper.append(h('footer', { class: 'rp-sh-signs' },
    h('div', {}, h('span', {}, t('rp.sh.dispatcher')), h('span', { class: 'rp-sh-line' })),
    h('div', {}, h('span', {}, t('rp.sh.driverSign')), h('span', { class: 'rp-sh-line' }))));
}

// The plan page may change the state in another tab. 'storage' fires only in OTHER tabs of the same origin, never in
// the tab that wrote, so this cannot loop with this page's own save().
// KNOWN DEFECT: the reverse direction is not handled. The plan page keeps S in memory and has no 'storage'
// listener, so its next save (any edit there) writes back its stale S.meta and silently discards a title, date,
// driver or vehicle typed on this sheet in another tab. Fix: listen to 'storage' on the plan page too and merge
// S.meta from the stored value (or keep meta under its own key).
window.addEventListener('storage', (e) => { if (e.key === 'rp-state') render(); });

startShell('sheet', () => render());
render();
// '#print' (the "Print" link of the plan page): drop the hash first, so a reload does not open the dialog again;
// replaceState, not location.hash = '', which would add a history entry and leave a bare '#'. The 300 ms delay lets
// layout and the SVG settle; print() called synchronously during load can capture a half-styled page.
if (location.hash === '#print') {
  history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => window.print(), 300);
}
