// newbuild-board/info.js - the complex page: name in three languages (estate/complex.js), slug, address, developer,
// currency and the hand-entered GEL rate; buildings with the ready-by quarter (a promise of a quarter, not a day) and
// the handover date; a new building generated as floors × units per floor per section (estate/chessboard.js
// unitGrid); the printable price list of a building; a JSON backup, its restore, the demo and an empty project.
//
// Edits mutate P in place and save through a 250ms debounce (typing in a name field must not serialise the whole
// project per keystroke); structural changes (add / remove building, restore, demo) save immediately and re-render.
import {
  UNIT_MAX, buildingOf, cleanBuildingId, complexTitle, fileSlug, hasGel, loadProject, money, normalizeProject,
  numOf, onProjectChange, printElement, readyLabel, resetDemo, roomsText, saveProject, sortUnits, startShell, statusText,
  toGel, todayISO, num,
} from './common.js';
import { button, card, download, dropZone, field, select, t, textInput, toast, toggle } from '../ui/app.js';
import { $, debounce, h, lsGet, lsSet } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import { cleanComplexSlug, cleanReady, readyQuarter, readyYear } from '../estate/complex.js';
import { pricePerM2, unitGrid } from '../estate/chessboard.js';
import { COMMON_CURRENCIES } from '../payments/money.js';
import { toMinor } from '../ledger/minor.js';

let P = loadProject();
const commit = debounce(() => saveProject(P), 250);
const LKEY = 'nb-pricelist';
// Price-list options are view state of this page ('nb-pricelist'), separate from the project.
const L = (() => { const v = lsGet(LKEY, null) || {}; return { building: typeof v.building === 'string' ? v.building : '', freeOnly: v.freeOnly !== false, gel: v.gel !== false }; })();
const saveL = () => lsSet(LKEY, L);

const main = $('#main');
main.classList.add('nb-info');
let els = {};

// Ready-by integer (year * 10 + quarter) shown as "2027-Q2", the format the input accepts back.
const readyInput = (n) => (readyYear(n) ? `${readyYear(n)}-Q${readyQuarter(n)}` : '');

function render() {
  main.textContent = '';
  els = {};
  const c = P.complex;
  const txt = (val, fn, attrs = {}) => textInput(val, (v) => { fn(v); commit(); }, attrs);
  // Empty name = the language is removed from the map (complexTitle then falls back to another language).
  const names = h('div', { class: 'ed-fields' }, ['en', 'ru', 'ka'].map((l) => field('nb.cx.name.' + l, txt(c.name[l] || '', (v) => { if (v.trim()) c.name[l] = v.trim().slice(0, 120); else delete c.name[l]; }, { dir: 'auto' }))));
  const slug = txt(c.slug, () => {}, { class: 'ed-input nb-mono', spellcheck: 'false' });
  // The slug is cleaned on change (not on every keystroke) so the user can type freely; it is used in file names.
  slug.addEventListener('change', () => { c.slug = cleanComplexSlug(slug.value); slug.value = c.slug; commit(); if (!c.slug) toast(t('nb.cx.badSlug'), 'warn'); });
  // Changing the currency does NOT convert prices (they stay the same numbers in the new currency); the toast says so.
  const curSel = select([...new Set([c.currency, 'USD', 'GEL', 'EUR', ...COMMON_CURRENCIES])].map((x) => ({ v: x, l: '=' + x })), c.currency, (v) => { c.currency = v; commit(); toast(t('nb.cx.curNote'), 'info'); render(); });
  const rate = txt(c.gelRate ? String(c.gelRate) : '', (v) => { const n = numOf(v); c.gelRate = n > 0 && n < 100000 ? n : 0; paintPriceList(); }, { inputmode: 'decimal', class: 'ed-input nb-num' });
  const cx = card('nb.cx.title', names,
    h('div', { class: 'ed-fields nb-mt' },
      field('nb.cx.slug', slug, 'nb.cx.slugHint'),
      field('nb.cx.address', txt(c.address, (v) => { c.address = v.slice(0, 200); }, { dir: 'auto' })),
      field('nb.cx.developer', txt(c.developer, (v) => { c.developer = v.slice(0, 120); }, { dir: 'auto' })),
      h('div', { class: 'ed-grid2' }, field('nb.cx.currency', curSel),
        c.currency === 'GEL' ? null : field('=' + t('nb.cx.rate', { c: c.currency }), rate)),
      c.currency === 'GEL' ? null : h('div', { class: 'ed-hint' }, t('nb.cx.rateHint')),
      field('nb.cx.note', txt(c.note, (v) => { c.note = v.slice(0, 400); }, { multiline: true, rows: 2, dir: 'auto' }))));

  els.buildings = h('div', { class: 'nb-blist' });
  const add = button('nb.cx.addBuilding', 'plus', addBuildingDialog);
  const bcard = card('nb.cx.buildings', els.buildings, h('div', { class: 'ap-actions' }, add));

  els.plSel = h('div');
  els.pricelist = h('div', { class: 'nb-pricelist', id: 'nb-pricelist' });
  const pl = card('nb.pl.title', els.plSel, h('div', { class: 'ap-actions' }, button('nb.pl.print', 'print', () => printElement(priceListSheet()), 'primary')), els.pricelist);

  const drop = dropZone({ accept: '.json,application/json', label: 'nb.dt.drop', paste: false, onFiles: (f) => restore(f[0]) });
  const data = card('nb.dt.title', h('p', { class: 'ed-hint' }, t('nb.dt.hint')),
    h('div', { class: 'ap-actions' }, button('nb.dt.backup', 'download', backup, 'primary')), h('div', { class: 'nb-mt' }, drop),
    h('div', { class: 'ap-actions' }, button('nb.dt.demo', 'refresh', async () => { if (await confirmDialog(t('nb.dt.demo'), t('nb.dt.demoQ'), t('nb.dt.demo'), true)) { P = resetDemo(); saveProject(P); render(); toast(t('nb.dt.demoDone'), 'ok'); } }),
      button('nb.dt.empty', 'trash', async () => { if (await confirmDialog(t('nb.dt.empty'), t('nb.dt.emptyQ'), t('nb.dt.empty'), true)) { P = normalizeProject({ complex: { currency: P.complex.currency, gelRate: P.complex.gelRate }, buildings: [{ id: 'A', name: 'A' }], units: [] }); saveProject(P); render(); } }, 'danger')));

  main.append(h('div', { class: 'nb-info-grid' }, h('div', { class: 'nb-col' }, cx, data), h('div', { class: 'nb-col' }, bcard, pl)));
  paintBuildings();
  paintPriceList();
}

function paintBuildings() {
  const box = els.buildings;
  box.textContent = '';
  if (!P.buildings.length) { box.append(h('div', { class: 'ap-empty' }, t('nb.cx.noBuildings'))); return; }
  for (const b of P.buildings) {
    const units = P.units.filter((u) => u.building === b.id);
    const floors = new Set(units.map((u) => u.floor).filter((f) => f != null));
    const label = h('span', { class: 'nb-ready' }, readyLabel(b.ready) || t('nb.cx.noReady'));
    const ready = textInput(readyInput(b.ready), () => {}, { class: 'ed-input nb-mono', placeholder: '2027-Q2', spellcheck: 'false' });
    ready.addEventListener('change', () => {
      const n = cleanReady(ready.value);
      // Invalid input reverts to the stored value with a warning instead of silently clearing the date.
      if (ready.value.trim() && !n) { toast(t('nb.cx.badReady'), 'warn'); ready.value = readyInput(b.ready); return; }
      b.ready = n; ready.value = readyInput(n); label.textContent = readyLabel(n) || t('nb.cx.noReady'); commit(); paintPriceList();
    });
    const hand = h('input', { type: 'date', class: 'ed-input', value: b.handover, onchange: (e) => { b.handover = /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : ''; commit(); paintPriceList(); } });
    const del = h('button', { type: 'button', class: 'ed-iconbtn', title: t('nb.cx.delBuilding'), 'aria-label': t('nb.cx.delBuildingN', { b: b.name }), html: icon('trash'), onclick: () => removeBuilding(b) });
    box.append(h('div', { class: 'nb-bitem' },
      h('div', { class: 'nb-bitem-h' }, h('span', { class: 'nb-bid' }, b.id),
        field('nb.cx.bname', textInput(b.name, (v) => { b.name = v.trim().slice(0, 60) || b.id; commit(); }, { dir: 'auto' })), del),
      h('div', { class: 'ed-grid2' }, field('nb.cx.ready', ready, 'nb.cx.readyHint'), field('nb.cx.handover', hand)),
      h('div', { class: 'nb-bitem-f' }, label, h('span', { class: 'ed-hint' }, t('nb.cx.bstats', { n: units.length, f: floors.size, s: new Set(units.map((u) => u.section)).size })))));
  }
}

async function removeBuilding(b) {
  const n = P.units.filter((u) => u.building === b.id).length;
  // Deleting a building deletes its units: confirmed with the unit count, since there is no undo here.
  if (!(await confirmDialog(t('nb.cx.delBuilding'), t('nb.cx.delQ', { b: b.name, n }), t('dlg.delete'), true))) return;
  P.buildings = P.buildings.filter((x) => x.id !== b.id);
  P.units = P.units.filter((u) => u.building !== b.id);
  saveProject(P);
  render();
}

async function addBuildingDialog() {
  const c = P.complex.currency;
  // Next free single-letter id (A..Z), then a number.
  const nextId = (() => { for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!buildingOf(P, ch)) return ch; return String(P.buildings.length + 1); })();
  const v = { id: nextId, name: 'Block ' + nextId, sections: '1', floors: '12', per: '4', first: '1', areas: '32; 45; 63; 52', rooms: '0; 2; 3; 2', rate: '1100', ready: '' };
  const inp = (k, attrs = {}) => textInput(v[k], (x) => { v[k] = x; }, attrs);
  const body = h('div', { class: 'ed-fields' },
    h('div', { class: 'ed-grid2' }, field('nb.ab.id', inp('id', { class: 'ed-input nb-mono' })), field('nb.cx.bname', inp('name'))),
    h('div', { class: 'ed-grid2' }, field('nb.ab.sections', inp('sections', { inputmode: 'numeric' })), field('nb.ab.floors', inp('floors', { inputmode: 'numeric' }))),
    h('div', { class: 'ed-grid2' }, field('nb.ab.per', inp('per', { inputmode: 'numeric' })), field('nb.ab.first', inp('first', { inputmode: 'numeric' }))),
    field('nb.ab.areas', inp('areas', { class: 'ed-input nb-mono' }), 'nb.ab.areasHint'),
    field('nb.ab.rooms', inp('rooms', { class: 'ed-input nb-mono' }), 'nb.ab.roomsHint'),
    h('div', { class: 'ed-grid2' }, field('=' + t('nb.ab.rate', { c }), inp('rate', { inputmode: 'decimal' })), field('nb.cx.ready', inp('ready', { placeholder: '2028-Q4' }))));
  const go = await openDialog({ title: t('nb.cx.addBuilding'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('nb.ab.create'), value: 'go', primary: true }] });
  if (go !== 'go') return;
  const id = cleanBuildingId(v.id);
  if (!id || buildingOf(P, id)) { toast(t('nb.ab.badId'), 'warn'); return; }
  // Area / room lists accept ';' or spaces; they repeat per position on each floor (unitGrid cycles them).
  const list = (s) => String(s).split(/[;\s]+/).map((x) => numOf(x)).filter((x) => x != null);
  // Generator bounds: 9 sections, 80 floors, 20 units per floor; the UNIT_MAX check runs before anything is created.
  const sections = Math.max(1, Math.min(9, Math.trunc(numOf(v.sections) || 1)));
  const per = Math.max(1, Math.min(20, Math.trunc(numOf(v.per) || 1)));
  const floors = Math.max(1, Math.min(80, Math.trunc(numOf(v.floors) || 1)));
  const rate = toMinor(v.rate, c);
  if (P.units.length + sections * per * floors > UNIT_MAX) { toast(t('nb.ab.tooMany', { n: UNIT_MAX }), 'warn'); return; }
  const units = [];
  // Flat numbers: floor * 100 + position ("1203") like most developers; when positions exceed 99 that would collide
  // (floor 12 position 103 = floor 13 position 3), so a "12-103" form is used instead.
  const wide = sections * per > 99;
  for (let s = 1; s <= sections; s++) {
    const grid = unitGrid({ floors, perFloor: per, firstFloor: Math.trunc(numOf(v.first) ?? 1) || 1, areas: list(v.areas), rooms: list(v.rooms).map(Math.trunc), pricePerM2: rate, step: toMinor(100, c) });
    for (const g of grid) {
      // Positions run through the floor across sections (section 2 continues after section 1), matching board.js.
      const pos = (s - 1) * per + g.position;
      const flat = wide ? `${g.floor}-${pos}` : String(g.floor * 100 + pos);
      units.push({ id: `${id}-${flat}`, building: id, section: String(s), floor: g.floor, flat, position: pos, area: g.area, rooms: g.rooms, price: g.price, status: 'free', view: '', layout: '', history: [{ d: todayISO(), s: 'free', p: g.price, by: 'manual' }] });
    }
  }
  P.buildings.push({ id, name: v.name.trim().slice(0, 60) || id, ready: cleanReady(v.ready), handover: '' });
  P.units.push(...units);
  sortUnits(P.units);
  // Normalise after generating: same validation as any loaded project (no special trust for our own generator).
  P = normalizeProject(P);
  saveProject(P);
  render();
  toast(t('nb.ab.done', { n: units.length, b: id }), 'ok');
}

// --- price list ----------------------------------------------------------------------------------------------------

function paintPriceList() {
  if (!els.plSel) return;
  const b = buildingOf(P, L.building) || P.buildings[0];
  els.plSel.textContent = '';
  els.pricelist.textContent = '';
  if (!b) return;
  L.building = b.id;
  els.plSel.append(h('div', { class: 'ed-fields' },
    field('nb.pl.building', select(P.buildings.map((x) => ({ v: x.id, l: '=' + x.name })), b.id, (v) => { L.building = v; saveL(); paintPriceList(); })),
    h('div', { class: 'ed-grid2' },
      field('nb.pl.freeOnly', toggle(L.freeOnly, (v) => { L.freeOnly = v; saveL(); paintPriceList(); })),
      hasGel(P) ? field('nb.pl.gel', toggle(L.gel, (v) => { L.gel = v; saveL(); paintPriceList(); })) : null)));
  els.pricelist.append(priceListSheet());
}

function priceListSheet() {
  const b = buildingOf(P, L.building) || P.buildings[0];
  const c = P.complex.currency, gel = hasGel(P) && L.gel;
  const units = P.units.filter((u) => u.building === b.id && (!L.freeOnly || u.status === 'free'));
  const th = (k, cls) => h('th', { scope: 'col', class: cls || null }, t(k));
  const tbody = h('tbody');
  let lastFloor;
  // Floor number printed once per floor group (first row of the floor) with a separator line: easier to scan on paper.
  for (const u of units) {
    const fl = u.floor !== lastFloor;
    lastFloor = u.floor;
    tbody.append(h('tr', { class: fl ? 'nb-pl-fl' : null },
      h('td', { class: 'nb-r' }, fl ? (u.floor ?? '—') : ''), h('th', { scope: 'row' }, u.flat), h('td', {}, u.section), h('td', {}, roomsText(u.rooms)),
      h('td', { class: 'nb-r' }, u.area ? num(u.area, 2) : '—'), h('td', { class: 'nb-r' }, u.price ? money(u.price, c) : '—'),
      h('td', { class: 'nb-r' }, pricePerM2(u) ? money(pricePerM2(u), c) : '—'),
      gel ? h('td', { class: 'nb-r' }, u.price ? money(toGel(P, u.price), 'GEL') : '—') : null,
      L.freeOnly ? null : h('td', {}, statusText(u.status))));
  }
  const head = h('div', { class: 'nb-pl-head' },
    h('div', {}, h('h2', {}, complexTitle(P)), h('div', { class: 'nb-pl-b' }, b.name), h('div', {}, P.complex.address)),
    h('div', { class: 'nb-pl-meta' }, h('div', {}, readyLabel(b.ready)), b.handover ? h('div', {}, t('nb.pl.handover', { d: b.handover })) : null,
      h('div', {}, t('nb.pl.asOf', { d: todayISO() })), gel ? h('div', {}, t('nb.pl.rate', { r: num(P.complex.gelRate, 4), c })) : null));
  const table = h('table', { class: 'ap-table nb-table nb-pl-table' },
    h('thead', {}, h('tr', {}, th('nb.fld.floor', 'nb-r'), th('nb.fld.flat'), th('nb.fld.section'), th('nb.fld.rooms'), th('nb.pl.area', 'nb-r'), th('nb.fld.price', 'nb-r'), th('nb.pl.ppm', 'nb-r'),
      gel ? h('th', { scope: 'col', class: 'nb-r' }, 'GEL') : null, L.freeOnly ? null : th('nb.fld.status'))), tbody);
  const foot = h('div', { class: 'nb-pl-foot' }, t(L.freeOnly ? 'nb.pl.countFree' : 'nb.pl.count', { n: units.length }), P.complex.developer ? ' · ' + P.complex.developer : '', ' · ', t('nb.pl.note'));
  return h('div', { class: 'nb-sheet' }, head, units.length ? table : h('div', { class: 'ap-empty' }, t('nb.pl.none')), foot);
}

// --- backup --------------------------------------------------------------------------------------------------------

function backup() {
  // `app` marker and save date in the backup; the restore accepts any object that normalises to at least one
  // building (older backups had no marker).
  download(JSON.stringify({ app: 'newbuild-board', saved: todayISO(), ...P }, null, 1), `${fileSlug(P.complex.slug || complexTitle(P))}-${todayISO()}.json`, 'application/json');
}

async function restore(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const p = normalizeProject(raw);
    if (!p.buildings.length) { toast(t('nb.dt.bad'), 'warn'); return; }
    if (!(await confirmDialog(t('nb.dt.restore'), t('nb.dt.restoreQ', { n: p.units.length, b: p.buildings.length }), t('nb.dt.restore'), true))) return;
    P = p;
    saveProject(P);
    render();
    toast(t('nb.dt.restored'), 'ok');
  } catch (e) {
    toast(t('ap.fileErr', { name: file.name, msg: e && e.message ? e.message : String(e) }), 'error');
  }
}

onProjectChange((p) => { P = p; render(); });
startShell('complex', () => render());
render();
