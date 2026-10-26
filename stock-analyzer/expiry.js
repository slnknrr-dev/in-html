// stock-analyzer/expiry.js - the expiry (FEFO) page: batches with expiry dates per store × item (the demo's
// perishable stock or an imported CSV / XLSX file), the check day, the warning window and markdown rules
// ("N days left -> P % off"). Results: quantities by state (fresh, expiring, expired), the markdown list by the
// nearest-expiring batch with old and new prices, and the write-off list of expired batches with their value at
// cost (stock/batches.js). Both lists export as CSV.
//
// FEFO = first expired, first out: within one store x item the earliest-expiring batch is sold (or marked down)
// first, expired batches are written off. The markdown ladder ("N days left -> P %") turns the nearest expiry into a
// price cut; its cost is (price - new price) x qty, compared with the write-off value of doing nothing. Like plan.js
// this page only edits inputs (E, persisted per dataset) and paints buildExpiry() results.
import {
  dataSummary, exportCSV, fmtDay, fmtNum, freshExpiry, getData, kpi, loadExpiry, loadPlan, major, mappingCard, money,
  pageHref, readFileTable, saveExpiry, sortTable, startShell, storeLabel,
} from './common.js';
import { BATCH_FIELDS, MARKDOWN_RULES, batchesFromTable, buildExpiry, suggestColumns } from './data.js';
import { demoBatches } from './demo.js';
import { button, card, dropZone, field, range, select, t, textInput, toast } from '../ui/app.js';
import { $, debounce, h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { confirmDialog } from '../ui/overlays.js';
import { isDay } from '../stock/calendar.js';

const D = getData();
const E = loadExpiry(D);
const save = debounce(() => saveExpiry(E), 250);
// Default sorts: markdowns by fewest days left, write-offs by most days overdue.
const R = { res: null, table: null, map: null, fileName: '', sortM: { k: 'left', d: 1 }, sortW: { k: 'overdue', d: -1 }, q: '' };
const main = $('#main');
main.classList.add('sa-page', 'sa-expiry');
const els = {};
const b = (l, ic, fn, k) => { const x = button(l, ic, fn, k); x.classList.add('ed-sm'); return x; };

function render() {
  main.textContent = '';
  const dataCard = card('sa.d.title', dataSummary(D),
    h('div', { class: 'ap-actions' }, h('a', { class: 'ed-btn ed-sm', href: pageHref('pg-analysis') }, iconEl('pareto'), t('sa.p.toAnalysis'))));

  const day = h('input', { type: 'date', class: 'ed-input', value: E.today });
  day.addEventListener('change', () => { if (isDay(day.value)) { E.today = day.value; changed(); } });
  const stores = select([{ v: '*', l: 'sa.f.allStores' }, ...D.stores.map((s) => ({ v: s, l: '=' + storeLabel(s) }))], E.store || '*', (v) => { E.store = v; changed(); });
  const setup = card('sa.e.setup', h('div', { class: 'ed-fields' },
    field('sa.e.today', day),
    field('sa.e.warn', range({ min: 1, max: 14, step: 1, value: E.warnDays, unit: ' ' + t('sa.unit.d'), onInput: (v) => { E.warnDays = v; changed(); } }), 'sa.e.warnHint'),
    field('sa.f.store', stores)));

  els.rules = h('div', { class: 'sa-rules' });
  const rulesCard = card('sa.e.rules', els.rules, h('div', { class: 'ed-hint' }, t('sa.e.rulesHint')),
    h('div', { class: 'ap-actions' }, b('sa.e.addRule', 'plus', () => { E.rules.push({ days: 5, pct: 10 }); changed(); paintRules(); }), b('sa.e.resetRules', 'undo', () => { E.rules = structuredClone(MARKDOWN_RULES); changed(); paintRules(); })));

  els.binfo = h('div', { class: 'sa-stock-info' });
  const batchCard = card('sa.e.batches', els.binfo,
    dropZone({ onFiles: importBatches, accept: '.csv,.tsv,.txt,.xlsx,.xlsm,text/csv', label: 'sa.e.drop' }),
    h('div', { class: 'ap-actions' },
      // Demo batches are derived from the demo stock levels (plan state), so the two pages tell a consistent story.
      D.source === 'demo' ? b('sa.e.demo', 'demo', () => { E.batches = demoBatches(D, loadPlan(D).stock, E.today); E.batchSource = 'demo'; changed(); }) : null,
      b('sa.e.clear', 'trash', async () => { if (await confirmDialog(t('sa.e.clear'), t('sa.e.clearQ'), t('dlg.delete'), true)) { E.batches = []; E.batchSource = ''; changed(); } })),
    h('div', { class: 'ed-hint' }, t('sa.e.hint')));
  els.map = R.table ? mappingCard({ title: 'sa.e.map', table: R.table, fields: BATCH_FIELDS, required: ['sku', 'expires', 'qty'], map: R.map, fileName: R.fileName, onChange: () => applyBatches(false), onClose: () => { R.table = null; render(); } }) : null;

  els.kpis = h('div', { class: 'sa-kpis', role: 'group', 'aria-label': t('sa.k.title') });
  els.state = h('div', { class: 'sa-statebar' });
  const search = textInput(R.q, (v) => { R.q = v; paintLists(); }, { type: 'search', placeholder: t('sa.t.search'), 'aria-label': t('sa.t.search') });
  els.md = h('div', { class: 'sa-tbox', id: 'sa-markdowns' });
  els.wo = h('div', { class: 'sa-tbox', id: 'sa-writeoffs' });
  const mdCard = card('sa.e.markdowns', h('div', { class: 'sa-tbar' }, search, h('span', { class: 'ed-spacer' }), b('sa.x.csv', 'table', exportMarkdowns)), els.md);
  const woCard = card('sa.e.writeoffs', h('div', { class: 'sa-tbar' }, h('span', { class: 'ed-hint sa-grow' }, t('sa.e.woHint')), b('sa.x.csv', 'table', exportWriteOffs)), els.wo);

  const side = h('div', { class: 'ap-side sa-side' }, dataCard, setup, batchCard, els.map, rulesCard);
  const stage = h('div', { class: 'ap-stage' }, els.kpis, els.state, mdCard, woCard);
  main.append(h('div', { class: 'ap-work sa-work' }, side, stage));
  paintRules();
  update();
}

const changed = () => { save(); updateSoon(); };
const updateSoon = debounce(() => update(), 100);

function paintRules() {
  const box = els.rules;
  box.textContent = '';
  E.rules.forEach((r, i) => {
    const num = (k, min, max, label) => {
      const inp = h('input', { type: 'number', class: 'ed-input', min, max, step: 1, value: String(r[k]), 'aria-label': label });
      // Out-of-range rule values revert to the stored value instead of producing a nonsensical ladder.
      inp.addEventListener('change', () => { const v = Number(inp.value); if (Number.isFinite(v) && v >= min && v <= max) { r[k] = v; changed(); } else inp.value = String(r[k]); });
      return inp;
    };
    box.append(h('div', { class: 'sa-rule' },
      h('span', {}, t('sa.e.ruleLeft')), num('days', 0, 60, t('sa.e.ruleDays')), h('span', {}, t('sa.e.ruleDaysU')),
      h('span', { 'aria-hidden': 'true' }, '→'), num('pct', 1, 95, t('sa.e.rulePct')), h('span', {}, '%'),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('sa.e.ruleRemove'), 'aria-label': t('sa.e.ruleRemove'), onclick: () => { E.rules.splice(i, 1); changed(); paintRules(); } }, iconEl('trash'))));
  });
  if (!E.rules.length) box.append(h('div', { class: 'ed-hint' }, t('sa.e.noRules')));
}

function update() {
  if (!isDay(E.today)) E.today = freshExpiry(D).today;
  const list = E.store && E.store !== '*' ? E.batches.filter((x) => x.store === E.store) : E.batches;
  // Incomplete rules (negative days, 0 %) are ignored rather than rejected, so editing one rule never breaks the list.
  R.res = buildExpiry(D, list, { today: E.today, warnDays: E.warnDays, rules: E.rules.filter((r) => r.days >= 0 && r.pct > 0) });
  paintInfo();
  paintKpis();
  paintLists();
}

function paintInfo() {
  els.binfo.textContent = '';
  els.binfo.append(h('b', {}, t('sa.e.batchN', { n: E.batches.length })), ' · ', t('sa.p.stockSrc.' + (E.batchSource || (E.batches.length ? 'file' : 'none'))));
  if (!E.batches.length) els.binfo.append(h('div', { class: 'ed-hint ed-hint-warn' }, t('sa.e.none')));
}

function paintKpis() {
  const r = R.res, s = r.summary;
  els.kpis.textContent = '';
  els.kpis.append(
    kpi(t('sa.e.kBatches'), fmtNum(r.totals.batches), t('sa.e.kUnits', { n: fmtNum(s.ok + s.expiring + s.expired) })),
    kpi(t('sa.e.kExpiring'), fmtNum(s.expiring), t('sa.e.kWithin', { n: E.warnDays }), s.expiring ? 'sa-kpi-amber' : ''),
    kpi(t('sa.e.kExpired'), fmtNum(s.expired), t('sa.e.kExpiredSub'), s.expired ? 'sa-kpi-warn' : ''),
    kpi(t('sa.e.kMarkdown'), money(r.totals.loss, { whole: true }), t('sa.e.kMarkdownSub', { n: r.markdowns.length })),
    kpi(t('sa.e.kWriteOff'), money(r.totals.writeOff, { whole: true }), D.hasCost ? t('sa.e.kAtCost') : t('sa.e.kAtPrice')));
  // || 1 avoids division by zero when there are no batches (the bar is then empty anyway).
  const tot = s.ok + s.expiring + s.expired || 1;
  els.state.textContent = '';
  // The state bar is a picture of three numbers: role=img with an aria-label that states them.
  els.state.setAttribute('role', 'img');
  els.state.setAttribute('aria-label', `${t('sa.e.sOk')} ${fmtNum(s.ok)}, ${t('sa.e.sExpiring')} ${fmtNum(s.expiring)}, ${t('sa.e.sExpired')} ${fmtNum(s.expired)}`);
  for (const [k, v] of [['ok', s.ok], ['expiring', s.expiring], ['expired', s.expired]]) {
    // Segment width via flex-grow (share of units); labels only where the segment is wide enough (> 8%).
    if (v > 0) els.state.append(h('span', { class: 'sa-sb sa-sb-' + k, style: { flexGrow: String(v / tot) }, title: `${t('sa.e.s' + k[0].toUpperCase() + k.slice(1))}: ${fmtNum(v)}` }, v / tot > 0.08 ? `${t('sa.e.s' + k[0].toUpperCase() + k.slice(1))} ${fmtNum(v)}` : ''));
  }
}

const match = (x) => !R.q.trim() || `${x.item} ${x.name} ${x.cat} ${x.batch}`.toLowerCase().includes(R.q.trim().toLowerCase());
function paintLists() {
  const r = R.res;
  const md = r.markdowns.filter(match), wo = r.writeOffs.filter(match);
  const dayCell = (d) => h('span', { class: 'sa-nowrap' }, fmtDay(d, { day: 'numeric', month: 'short' }));
  els.md.textContent = '';
  if (!md.length) els.md.append(h('div', { class: 'ap-empty' }, t('sa.e.noMarkdowns')));
  else els.md.append(sortTable([
    { k: 'left', l: 'sa.c.daysLeft', num: true, sort: (x) => x.daysLeft, cell: (x) => h('span', { class: x.daysLeft <= 1 ? 'sa-bad' : '' }, fmtNum(x.daysLeft)) },
    { k: 'name', l: 'sa.c.name', sort: (x) => x.name.toLowerCase(), cell: (x) => h('span', { class: 'sa-name' }, x.name, h('small', {}, `${x.item} · ${storeLabel(x.store)}`)) },
    { k: 'batch', l: 'sa.c.batch', sort: (x) => x.batch, cell: (x) => h('span', { class: 'sa-mono' }, x.batch), cls: 'sa-hide-s' },
    { k: 'expires', l: 'sa.c.expires', sort: (x) => x.expires, cell: (x) => dayCell(x.expires) },
    { k: 'qty', l: 'sa.c.qty', num: true, sort: (x) => x.qty, cell: (x) => fmtNum(x.qty, 2) },
    { k: 'pct', l: 'sa.c.markdown', num: true, sort: (x) => x.pct, cell: (x) => h('b', { class: 'sa-pct' }, `−${fmtNum(x.pct, 1)} %`) },
    // Old price struck through (<s>, semantically "no longer accurate") next to the new price.
    { k: 'price', l: 'sa.c.price', num: true, sort: (x) => x.price, cell: (x) => h('span', {}, h('s', { class: 'sa-old' }, money(x.price)), ' ', h('b', {}, money(x.newPrice))) },
    { k: 'loss', l: 'sa.c.loss', num: true, sort: (x) => x.loss, cell: (x) => money(x.loss), cls: 'sa-hide-s' },
  ], md, R.sortM, (s) => { R.sortM = s; paintLists(); }, { caption: t('sa.e.markdowns') }));
  els.wo.textContent = '';
  if (!wo.length) els.wo.append(h('div', { class: 'ap-empty' }, t('sa.e.noWriteOffs')));
  else els.wo.append(sortTable([
    { k: 'overdue', l: 'sa.c.overdue', num: true, sort: (x) => x.overdue, cell: (x) => h('span', { class: 'sa-bad' }, fmtNum(x.overdue)) },
    { k: 'name', l: 'sa.c.name', sort: (x) => x.name.toLowerCase(), cell: (x) => h('span', { class: 'sa-name' }, x.name, h('small', {}, `${x.item} · ${storeLabel(x.store)}`)) },
    { k: 'batch', l: 'sa.c.batch', sort: (x) => x.batch, cell: (x) => h('span', { class: 'sa-mono' }, x.batch), cls: 'sa-hide-s' },
    { k: 'expires', l: 'sa.c.expires', sort: (x) => x.expires, cell: (x) => dayCell(x.expires) },
    { k: 'qty', l: 'sa.c.qty', num: true, sort: (x) => x.qty, cell: (x) => fmtNum(x.qty, 2) },
    { k: 'value', l: 'sa.c.value', num: true, sort: (x) => x.value, cell: (x) => money(x.value) },
  ], wo, R.sortW, (s) => { R.sortW = s; paintLists(); }, { caption: t('sa.e.writeoffs') }));
}

async function importBatches(files) {
  const f = files[0];
  if (!f) return;
  const table = await readFileTable(f);
  if (!table) return;
  R.table = table; R.fileName = f.name;
  // Batch files map "stock" / "остаток" to quantity (the 'batch' synonym set in data.js).
  R.map = suggestColumns(table.headers, BATCH_FIELDS, 'batch');
  applyBatches(true);
}
function applyBatches(first) {
  const set = (text, kind) => { if (els.map?.status) { els.map.status.textContent = text; els.map.status.className = 'sa-map-status sa-st-' + kind; } };
  const miss = ['sku', 'expires', 'qty'].filter((f) => R.map[f] < 0);
  if (miss.length) { if (first) render(); set(t('sa.map.missing', { f: miss.map((f) => t('sa.f.' + f)).join(', ') }), 'warn'); return; }
  const r = batchesFromTable(D, R.table, R.map);
  if (!r.batches.length) { if (first) render(); set(t('sa.p.stockNoMatch'), 'warn'); return; }
  E.batches = r.batches; E.batchSource = 'file';
  save();
  render();
  set(t('sa.e.loaded', { n: r.batches.length }) + (r.skipped ? ' ' + t('sa.map.skipped', { n: r.skipped }) : ''), r.skipped ? 'warn' : 'ok');
  if (first) toast(t('sa.e.loaded', { n: r.batches.length }), 'ok');
}

function exportMarkdowns() {
  const r = R.res;
  if (!r.markdowns.length) { toast(t('sa.e.noMarkdowns'), 'warn'); return; }
  exportCSV([['store', 'sku', 'name', 'batch', 'expires', 'days left', 'qty', 'markdown %', `price (${D.currency})`, `new price (${D.currency})`, `loss (${D.currency})`],
    ...r.markdowns.map((x) => [x.store, x.item, x.name, x.batch, x.expires, x.daysLeft, x.qty, x.pct, major(x.price), major(x.newPrice), major(x.loss)])], `markdowns-${E.today}`);
}
function exportWriteOffs() {
  const r = R.res;
  if (!r.writeOffs.length) { toast(t('sa.e.noWriteOffs'), 'warn'); return; }
  exportCSV([['store', 'sku', 'name', 'batch', 'expires', 'days overdue', 'qty', `value (${D.currency})`],
    ...r.writeOffs.map((x) => [x.store, x.item, x.name, x.batch, x.expires, x.overdue, x.qty, major(x.value)])], `write-offs-${E.today}`);
}

startShell('expiry', () => render());
render();
