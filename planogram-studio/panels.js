// planogram-studio/panels.js - the analytics and versions panels of the planogram page. Analytics: key figures of
// the current fixture or of all fixtures (shelf and used metres, fill, SKUs, facings, capacity, sales and gross
// profit per metre), the macro-space table (each category's / brand's share of shelf space against its share of
// sales with the metres the sales share would give it, planogram/space.js macroSpace) and days of supply per
// product with low / high / below-case verdicts. Versions: named snapshots of a fixture kept in localStorage,
// restore, delete, and the comparison of two versions (planogram/diff.js) as a readable list.
import { button, field, seg, t } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { macroSpace, productCapacity, shelfMetrics, spaceBy, supplyReport } from '../planogram/space.js';
import { diffPlanogram, isEmptyDiff } from '../planogram/diff.js';
import { fmt, fmtDate, fmtMoney, fmtPct, group, numInput, versionsList } from './common.js';

// Group keys go through String(), so a missing category arrives as "null"; all spellings of "none" are one group.
const isNone = (k) => k == null || k === 'null' || k === '';

// --- analytics ---------------------------------------------------------------------------------------------------

// Scope: the current fixture or all fixtures. Sales figures exist only for placed products with dailySales > 0;
// revenue = daily units x price, profit only where cost is known (profitPartial flags incomplete data). Days of
// supply = shelf capacity units / daily units: how long a full shelf lasts between refills.
export function renderAnalytics(box, ctx) {
  const { P, fixture, map, ui } = ctx;
  box.textContent = '';
  const fixtures = ui.scope === 'all' ? P.fixtures : [fixture];
  const by = ui.groupBy === 'brand' ? 'brand' : 'category';
  const placed = productCapacity(fixtures);
  const salesById = {}, salesByKey = {};
  for (const id of placed.keys()) {
    const p = map.get(id);
    if (!p || !(p.dailySales > 0)) continue;
    const rev = p.dailySales * (p.price ?? 0);
    salesById[id] = { qty: p.dailySales, revenue: rev };
    const k = String(p[by] ?? null);
    const s = (salesByKey[k] ??= { revenue: 0, profit: 0 });
    s.revenue += rev;
    if (p.cost != null) s.profit += p.dailySales * ((p.price ?? 0) - p.cost);
  }
  const space = spaceBy(fixtures, map, by);
  const metrics = shelfMetrics(fixtures, map, salesById);
  const units = [...placed.values()].reduce((x, r) => x + r.units, 0);
  const facings = [...placed.values()].reduce((x, r) => x + r.facings, 0);
  const daily = Object.values(salesById).reduce((x, s) => x + s.qty, 0);

  box.append(h('div', { class: 'pgs-ana-tools' },
    group('pgs.ana.scope', seg([{ v: 'fixture', l: 'pgs.ana.fixture' }, { v: 'all', l: 'pgs.ana.all' }], ui.scope, (v) => ctx.onUi({ scope: v }), 'pgs.ana.scope')),
    group('pgs.ana.by', seg([{ v: 'category', l: 'pgs.by.category' }, { v: 'brand', l: 'pgs.by.brand' }], by, (v) => ctx.onUi({ groupBy: v }), 'pgs.ana.by'))));

  const tile = (label, value, sub) => h('div', { class: 'pgs-tile' }, h('div', { class: 'pgs-tile-l' }, t(label)), h('div', { class: 'pgs-tile-v' }, value), sub ? h('div', { class: 'pgs-tile-s' }, sub) : null);
  box.append(h('div', { class: 'pgs-tiles', dataset: { metres: String(space.total.shelfMetres) } },
    tile('pgs.ana.shelfM', fmt(space.total.shelfMetres, 2) + ' m', t('pgs.ana.usedM', { m: fmt(space.total.usedMetres, 2) })),
    tile('pgs.ana.fill', fmt(space.total.fill, 0) + ' %'),
    tile('pgs.ana.skus', String(metrics.skus), t('pgs.chip.facings', { n: facings })),
    tile('pgs.ana.capacity', fmt(units, 0), t('pgs.ana.units')),
    tile('pgs.ana.revenue', fmtMoney(metrics.revenue), t('pgs.ana.perDay')),
    tile('pgs.ana.revM', fmtMoney(metrics.revenuePerMetre), t('pgs.ana.perMetreDay')),
    tile('pgs.ana.profitM', metrics.profitPerMetre == null ? '—' : fmtMoney(metrics.profitPerMetre), metrics.profitPartial ? t('pgs.ana.partial') : t('pgs.ana.perMetreDay')),
    tile('pgs.ana.dos', daily > 0 ? t('pgs.days', { n: fmt(units / daily) }) : '—', t('pgs.ana.dosSub'))));

  // Macro space: the classic category-management check - a group whose share of space far exceeds its share of sales
  // wastes shelf; the reverse risks out-of-stocks. recommendedMetres = sales share x total metres.
  // Macro space: share of shelf space against share of sales.
  const rows = macroSpace(space, salesByKey);
  const macro = h('div', { class: 'pgs-macro' });
  macro.append(h('h3', { class: 'pgs-h3' }, t('pgs.ana.macro')),
    h('div', { class: 'pgs-mlegend' },
      h('span', {}, h('i', { class: 'pgs-mbar-k pgs-s1' }), t('pgs.ana.spaceShare')),
      h('span', {}, h('i', { class: 'pgs-mbar-k pgs-s2' }), t('pgs.ana.salesShare'))));
  if (!rows.length) macro.append(h('div', { class: 'ap-empty' }, t('pgs.ana.empty')));
  else {
    const body = h('tbody');
    for (const r of rows) {
      const name = isNone(r.key) ? t('pgs.other') : String(r.key);
      const sp = r.spaceShare ?? 0, sl = r.salesShare ?? 0;
      const verdict = r.verdict;
      body.append(h('tr', { dataset: { verdict } },
        h('th', { scope: 'row' }, h('span', { class: 'pgs-sw', style: { background: ctx.colorOf(isNone(r.key) ? null : r.key) } }), ' ', name),
        h('td', { class: 'pgs-numc' }, fmt(r.metres, 2)),
        h('td', { class: 'pgs-bars', title: `${t('pgs.ana.spaceShare')} ${fmtPct(r.spaceShare, 1)} · ${t('pgs.ana.salesShare')} ${fmtPct(r.salesShare, 1)}` },
          h('div', { class: 'pgs-mbar' }, h('i', { class: 'pgs-s1', style: { width: Math.max(0.5, sp * 100) + '%' } }), h('span', {}, fmtPct(r.spaceShare))),
          h('div', { class: 'pgs-mbar' }, h('i', { class: 'pgs-s2', style: { width: Math.max(0.5, sl * 100) + '%' } }), h('span', {}, fmtPct(r.salesShare)))),
        h('td', { class: 'pgs-numc' }, r.gap == null ? '—' : (r.gap > 0 ? '+' : '') + fmt(r.gap * 100, 1)),
        h('td', { class: 'pgs-numc' }, r.recommendedMetres == null ? '—' : fmt(r.recommendedMetres, 2)),
        h('td', {}, h('span', { class: 'pgs-verdict pgs-v-' + verdict }, iconEl(verdict === 'ok' ? 'check' : verdict === 'none' ? 'info' : 'warn'), t('pgs.ana.v.' + verdict)))));
    }
    macro.append(h('div', { class: 'pgs-table-wrap' }, h('table', { class: 'pgs-table pgs-macro-t' },
      h('thead', {}, h('tr', {}, ['pgs.ana.group', 'pgs.ana.metres', 'pgs.ana.shares', 'pgs.ana.gap', 'pgs.ana.rec', 'pgs.ana.verdict'].map((k) => h('th', { scope: 'col' }, t(k))))),
      body)), h('p', { class: 'ed-hint' }, t('pgs.ana.macroHint')));
  }

  // Verdicts: low (< minDays), high (> maxDays), below_case (capacity smaller than one delivery case - the case cannot
  // be shelved at once), no_sales. Capped at 300 rows for DOM size.
  // Days of supply.
  const sup = supplyReport(fixtures, map, { minDays: P.settings.minDays, maxDays: P.settings.maxDays });
  const list = ui.onlyIssues ? sup.filter((r) => r.status !== 'ok') : sup;
  const dos = h('div', { class: 'pgs-dos' });
  const counts = {};
  for (const r of sup) counts[r.status] = (counts[r.status] || 0) + 1;
  const only = h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', checked: !!ui.onlyIssues, dataset: { fk: 'only-issues' } });
  only.addEventListener('change', () => ctx.onUi({ onlyIssues: only.checked }));
  const minI = numInput(P.settings.minDays, (v) => ctx.onSettings({ minDays: v }), { min: 0, max: 365, step: 0.5, cls: 'pgs-num-sm' });
  minI.dataset.fk = 'min-days';
  const maxI = numInput(P.settings.maxDays, (v) => ctx.onSettings({ maxDays: v }), { min: 1, max: 3650, step: 1, cls: 'pgs-num-sm' });
  maxI.dataset.fk = 'max-days';
  dos.append(h('h3', { class: 'pgs-h3' }, t('pgs.ana.supply')),
    h('div', { class: 'pgs-dos-tools' }, field('pgs.ana.minDays', minI), field('pgs.ana.maxDays', maxI), field('pgs.ana.onlyIssues', only)),
    h('div', { class: 'pgs-chips' }, ['low', 'below_case', 'high', 'no_sales', 'ok'].filter((k) => counts[k]).map((k) => h('span', { class: 'pgs-verdict pgs-st-' + k }, `${t('pgs.sup.' + k)}: ${counts[k]}`))));
  if (!list.length) dos.append(h('div', { class: 'ap-empty' }, t(sup.length ? 'pgs.ana.noIssues' : 'pgs.ana.empty')));
  else {
    const body = h('tbody');
    for (const r of list.slice(0, 300)) {
      const p = map.get(r.productId);
      body.append(h('tr', { dataset: { status: r.status } },
        h('th', { scope: 'row' }, h('button', { type: 'button', class: 'pgs-link', onclick: () => ctx.selectProduct(r.productId) }, p?.name ?? r.productId)),
        h('td', { class: 'pgs-numc' }, String(r.facings)),
        h('td', { class: 'pgs-numc' }, String(r.units)),
        h('td', { class: 'pgs-numc' }, r.dailySales == null ? '—' : fmt(r.dailySales)),
        h('td', { class: 'pgs-numc' }, r.days == null ? '—' : fmt(r.days)),
        h('td', {}, h('span', { class: 'pgs-verdict pgs-st-' + r.status }, t('pgs.sup.' + r.status)))));
    }
    dos.append(h('div', { class: 'pgs-table-wrap pgs-dos-wrap' }, h('table', { class: 'pgs-table' },
      h('thead', {}, h('tr', {}, ['pgs.ana.product', 'pgs.ana.facings', 'pgs.ana.unitsH', 'pgs.ana.sales', 'pgs.ana.days', 'pgs.ana.status'].map((k) => h('th', { scope: 'col' }, t(k))))),
      body)));
  }
  if (metrics.noStock.length) dos.append(h('p', { class: 'ed-hint ed-hint-warn pgs-nostock' }, t('pgs.ana.noStock', { n: metrics.noStock.length }) + ': ' + metrics.noStock.map((id) => map.get(id)?.name ?? id).join(', ')));
  box.append(h('div', { class: 'pgs-ana-grid' }, macro, dos));
}

// --- versions ----------------------------------------------------------------------------------------------------

function geoText(g) {
  return `${t('pgs.sh.k.' + (g.kind || 'shelf'))} ${fmt(g.width)} × ${fmt(g.height)} × ${fmt(g.depth)} cm`;
}

// Readable lines of a diff: [{ kind: 'added' | 'removed' | 'changed' | 'shelf', text }].
// Turns the structural diff into sentences; the dataset counts on the result element are used by e2e checks.
export function diffLines(d) {
  const out = [];
  const sh = (list) => list.join(', ');
  for (const a of d.added) out.push({ kind: 'added', text: t('pgs.diff.added', { name: a.name ?? a.productId, s: sh(a.shelves), f: a.facings, u: a.units }) });
  for (const r of d.removed) out.push({ kind: 'removed', text: t('pgs.diff.removed', { name: r.name ?? r.productId, s: sh(r.shelves), f: r.facings, u: r.units }) });
  for (const c of d.changed) {
    const parts = c.fields.map((k) => t('pgs.diff.' + k, { a: k === 'shelves' ? sh(c.from.shelves) : c.from[k], b: k === 'shelves' ? sh(c.to.shelves) : c.to[k] }));
    out.push({ kind: 'changed', text: `${c.name ?? c.productId}: ${parts.join('; ')}` });
  }
  for (const s of d.shelves) {
    if (s.change === 'added') out.push({ kind: 'shelf', text: t('pgs.diff.shelfAdded', { n: s.shelf, g: geoText(s.to) }) });
    else if (s.change === 'removed') out.push({ kind: 'shelf', text: t('pgs.diff.shelfRemoved', { n: s.shelf, g: geoText(s.from) }) });
    else {
      const parts = ['kind', 'width', 'height', 'depth'].filter((k) => s.from[k] !== s.to[k])
        .map((k) => t('pgs.diff.geo.' + k, { a: k === 'kind' ? t('pgs.sh.k.' + s.from.kind) : fmt(s.from[k]), b: k === 'kind' ? t('pgs.sh.k.' + s.to.kind) : fmt(s.to[k]) }));
      out.push({ kind: 'shelf', text: t('pgs.diff.shelfResized', { n: s.shelf, what: parts.join('; ') }) });
    }
  }
  return out;
}

// Versions of the current fixture first. Compare picks two snapshots (or the live fixture) and diffs them with names
// resolved from the library first, then from the version's stored names.
export function renderVersions(box, ctx) {
  const { P, fixture, ui } = ctx;
  box.textContent = '';
  const list = versionsList();
  const name = h('input', { class: 'ed-input', placeholder: t('pgs.ver.namePh'), 'aria-label': t('pgs.ver.name'), id: 'pgs-ver-name', dataset: { fk: 'ver-name' } });
  const saveB = button('pgs.ver.save', 'save', () => ctx.save(name.value.trim()), 'primary');
  saveB.dataset.act = 'save-version';
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveB.click(); } });
  box.append(h('div', { class: 'ed-row pgs-ver-save' }, name, saveB));

  // Saved versions: those of the current fixture first.
  const mine = list.filter((v) => v.fixtureId === fixture.id), others = list.filter((v) => v.fixtureId !== fixture.id);
  const ul = h('ul', { class: 'pgs-vlist' });
  for (const v of [...mine, ...others].slice(0, 60)) {
    const n = v.fixture.shelves.reduce((x, s) => x + s.positions.length, 0);
    const rb = button('pgs.ver.restore', 'undo', () => ctx.restore(v)); rb.classList.add('ed-sm');
    const db = h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('dlg.delete'), 'aria-label': `${t('dlg.delete')} · ${v.name}`, html: '', onclick: () => ctx.remove(v) }, iconEl('trash'));
    ul.append(h('li', { class: 'pgs-vitem' + (v.fixtureId === fixture.id ? '' : ' pgs-other'), dataset: { id: v.id } },
      h('div', { class: 'pgs-vitem-t' }, h('b', {}, v.name || '—'), h('span', { class: 'ed-hint' }, `${v.fixtureName || ''} · ${fmtDate(v.at)} · ${t('pgs.ver.positions', { n })}`)),
      h('div', { class: 'ap-row' }, rb, db)));
  }
  box.append(list.length ? ul : h('div', { class: 'ap-empty' }, t('pgs.ver.none')));

  // Compare two versions (or a version and the current state).
  const opts = [{ v: 'current', l: t('pgs.ver.current', { name: fixture.name }) }, ...list.map((v) => ({ v: v.id, l: `${v.name} · ${v.fixtureName || ''} · ${fmtDate(v.at)}` }))];
  const pick = (id) => (id === 'current' ? { fixture, names: {} } : list.find((v) => v.id === id));
  let a = ui.cmpA && pick(ui.cmpA) ? ui.cmpA : (mine[0] || list[0])?.id || 'current';
  let b = ui.cmpB && pick(ui.cmpB) ? ui.cmpB : 'current';
  const sel = (val, key, fk) => {
    const s = h('select', { class: 'ed-input ed-select', id: 'pgs-cmp-' + key, dataset: { fk } }, opts.map((o) => h('option', { value: o.v, selected: o.v === val }, o.l)));
    s.addEventListener('change', () => ctx.onUi({ [key === 'a' ? 'cmpA' : 'cmpB']: s.value }));
    return s;
  };
  const cmp = h('div', { class: 'pgs-cmp' }, h('h3', { class: 'pgs-h3' }, t('pgs.ver.compare')),
    h('div', { class: 'ed-grid2' }, field('pgs.ver.from', sel(a, 'a', 'cmp-a')), field('pgs.ver.to', sel(b, 'b', 'cmp-b'))));
  const A = pick(a), B = pick(b);
  if (A && B) {
    const names = { ...(A.names || {}), ...(B.names || {}) };
    const nameOf = (id) => P.products.find((p) => p.id === id)?.name ?? names[id] ?? id;
    const d = diffPlanogram(A.fixture, B.fixture, nameOf);
    const out = h('div', { class: 'pgs-diff', role: 'region', 'aria-live': 'polite', 'aria-label': t('pgs.ver.result'), dataset: { added: String(d.added.length), removed: String(d.removed.length), changed: String(d.changed.length), shelves: String(d.shelves.length) } });
    if (a === b || isEmptyDiff(d)) out.append(h('div', { class: 'ap-empty' }, t('pgs.diff.same')));
    else {
      out.append(h('div', { class: 'pgs-chips' },
        h('span', { class: 'pgs-verdict pgs-d-added' }, t('pgs.diff.nAdded', { n: d.added.length })),
        h('span', { class: 'pgs-verdict pgs-d-removed' }, t('pgs.diff.nRemoved', { n: d.removed.length })),
        h('span', { class: 'pgs-verdict pgs-d-changed' }, t('pgs.diff.nChanged', { n: d.changed.length })),
        h('span', { class: 'pgs-verdict pgs-d-shelf' }, t('pgs.diff.nShelves', { n: d.shelves.length }))));
      const sym = { added: '+', removed: '−', changed: '~', shelf: '▭' };
      out.append(h('ul', { class: 'pgs-dlist' }, diffLines(d).map((l) => h('li', { class: 'pgs-dl-' + l.kind, dataset: { kind: l.kind } }, h('span', { class: 'pgs-dsym', 'aria-hidden': 'true' }, sym[l.kind]), h('span', { class: 'pgs-sr' }, t('pgs.diff.k.' + l.kind) + ': '), l.text))));
    }
    cmp.append(out);
  }
  box.append(cmp);
}
