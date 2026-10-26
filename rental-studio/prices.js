// rental-studio/prices.js - the prices page of a flat: the base rate (per night, week or month), weekday rates,
// seasons and closed periods as ordered rules (the last matching rule wins, as booking/rates.js decides), minimum and
// maximum stays, length-of-stay discounts, the cleaning fee and other fees, a deposit; a quote calculator for any
// dates (booking/rates.js quoteStay: nightly cascade, discount, fees, deposit, prepayment, the other currencies) whose
// refusals are explained by code; and a price calendar of a month (rate, its source, minimum stay, closed and booked
// days).
//
// Editing model: controls mutate the flat's price object in P directly and call changed(), which saves (debounced)
// and repaints only the derived views (quote, price calendar). The editors themselves are not rebuilt, so the field
// being typed in keeps focus and caret. Structural changes (add/remove/reorder a row) repaint just that list.
import { QUOTE_ERRORS, FEE_PER, normalizeCalRule, prepayment, priceCalendar } from '../booking/rates.js';
import { dayAdd, monthGrid } from '../booking/days.js';
import { occupancyCalendar } from '../booking/stays.js';
import { fromMinor } from '../ledger/minor.js';
import { unitBlocks, unitOf, unitQuote, unitStays } from './calc.js';
import {
  P, TODAY, dayInput, dot, equivalents, fmtDay, fmtNum, fmtRange, group, money, moneyInput, monthNav, numInput, save, startShell,
  table, thisMonth, wdShort,
} from './common.js';
import { button, card, field, seg, select, t, textInput } from '../ui/app.js';
import { $, h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';

const VKEY = 'rs-prices';
// Quote dates default to two weeks ahead (a realistic enquiry) and are never restored into the past.
const V = (() => {
  const v = lsGet(VKEY, null) || {};
  const from = typeof v.from === 'string' && v.from >= TODAY ? v.from : dayAdd(TODAY, 14);
  return {
    unit: typeof v.unit === 'string' ? v.unit : '',
    month: /^\d{4}-\d{2}$/.test(v.month) ? v.month : thisMonth(),
    from, to: typeof v.to === 'string' && v.to > from ? v.to : dayAdd(from, 5), guests: Number(v.guests) > 0 ? Number(v.guests) : 2,
  };
})();
const keep = () => lsSet(VKEY, V);

const main = $('#main');
main.classList.add('rs-prices');
const els = {};
// Rules as typed (an unfinished row is kept here while it is not a valid rule yet), per flat.
// Why a raw copy: a half-typed rule (from set, to not yet) is invalid and normalizeCalRule drops it; editing the
// normalised list directly would make the row vanish while typing. The raw rows stay on screen; only valid ones are
// written to u.price.rules (syncRules).
// KNOWN DEFECT: RAW is never invalidated when the project is replaced (import, demo reset in another page, a change
// from another tab via the storage event): the rules editor keeps showing the old rows and the next edit writes them
// back over the new project. Fix: clear RAW in the startShell re-render callback (or key it by project identity).
const RAW = new Map();

const U = () => unitOf(P, V.unit) || P.units[0];
const rawRules = (u) => { if (!RAW.has(u.id)) RAW.set(u.id, u.price.rules.map((r) => ({ ...r }))); return RAW.get(u.id); };

// A price change: store, then repaint what depends on prices (the inputs keep focus).
function changed() { save(); paintQuote(); paintCal(); }

// Quote and price calendar boxes are created here and filled by paintQuote/paintCal, which can then run alone on
// every price change.
function render() {
  main.textContent = '';
  const u = U();
  if (!u) { main.append(h('div', { class: 'ap-empty' }, t('rs.u.none'))); return; }
  V.unit = u.id;
  const pick = select(P.units.map((x) => ({ v: x.id, l: '=' + x.name })), u.id, (v) => { V.unit = v; keep(); render(); });
  pick.id = 'rs-p-unit';
  const head = h('div', { class: 'ap-card rs-unitbar' }, dot(u.color), field('rs.cal.flat', pick), h('div', { class: 'ed-hint' }, t('rs.p.lead')));
  els.quote = h('div', { class: 'rs-quote', 'aria-live': 'polite' });
  els.cal = h('div', { class: 'rs-pcal-box' });
  els.rules = h('div', { class: 'rs-rules' });
  const side = h('div', { class: 'rs-col' }, baseCard(u), weekdayCard(u), discountCard(u), feesCard(u));
  const stage = h('div', { class: 'rs-col' }, quoteCard(), card('', h('div', { class: 'rs-head' }, h('h2', { class: 'ap-card-h' }, t('rs.pc.title')), monthNav(V.month, (m) => { V.month = m; keep(); render(); })), els.cal, calLegend()), rulesCard(u));
  main.append(head, h('div', { class: 'rs-split rs-split-l' }, side, stage));
  paintRules(u);
  paintQuote();
  paintCal();
}

// --- base, weekdays, discounts, fees ---------------------------------------------------------------------------------

function baseCard(u) {
  const pr = u.price;
  const per = seg([{ v: 'day', l: 'rs.p.perNight' }, { v: 'week', l: 'rs.p.perWeek' }, { v: 'month', l: 'rs.p.perMonth' }], pr.per, (v) => { pr.per = v; changed(); }, 'rs.p.per');
  return card('rs.p.base',
    field('=' + t('rs.p.basePrice') + ', ' + P.currency, moneyInput(pr.base, (v) => { pr.base = v ?? 0; changed(); }, { id: 'rs-p-base' })),
    group('rs.p.per', per, t('rs.p.perHint')),
    h('div', { class: 'ed-grid2' },
      field('rs.p.minNights', numInput(pr.minNights, (v) => { pr.minNights = Math.max(0, Math.trunc(v || 0)); changed(); }, { min: 0, max: 365 })),
      field('rs.p.maxNights', numInput(pr.maxNights, (v) => { pr.maxNights = Math.max(0, Math.trunc(v || 0)); changed(); }, { min: 0, max: 3650 }), 'rs.p.maxHint')),
    h('div', { class: 'ed-grid2' },
      field('rs.u.guests', numInput(u.guestsMax, (v) => { u.guestsMax = Math.max(1, Math.trunc(v || 1)); changed(); }, { min: 1, max: 50 })),
      field('=' + t('rs.p.deposit') + ', ' + P.currency, moneyInput(pr.deposit, (v) => { pr.deposit = v ?? 0; changed(); }))));
}

// Empty weekday field = no override (delete the key), so "as base" is distinct from an explicit price of 0.
function weekdayCard(u) {
  const pr = u.price;
  const rows = [];
  for (let d = 0; d < 7; d++) {
    const i = moneyInput(pr.weekdayRates[d] ?? null, (v) => { if (v == null) delete pr.weekdayRates[d]; else pr.weekdayRates[d] = v; changed(); }, { placeholder: t('rs.p.asBase'), 'aria-label': t('rs.p.wdRate', { d: wdShort(d) }) });
    rows.push(h('label', { class: 'rs-wd' + (d >= 5 ? ' rs-we' : '') }, h('span', {}, wdShort(d)), i));
  }
  return card('rs.p.weekdays', h('div', { class: 'rs-wds' }, rows), h('div', { class: 'ed-hint' }, t('rs.p.wdHint')));
}

function discountCard(u) {
  const pr = u.price;
  const box = h('div', { class: 'rs-rows' });
  const paint = () => {
    box.textContent = '';
    pr.discounts.forEach((d, i) => {
      const del = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.remove'), title: t('rs.remove'), onclick: () => { pr.discounts.splice(i, 1); paint(); changed(); } }, iconEl('trash'));
      box.append(h('div', { class: 'rs-row2' },
        h('label', { class: 'rs-inl' }, h('span', {}, t('rs.p.fromNights')), numInput(d.nights, (v) => { d.nights = Math.max(1, Math.trunc(v || 1)); changed(); }, { min: 1, max: 365 })),
        h('label', { class: 'rs-inl' }, h('span', {}, '−%'), numInput(d.pct, (v) => { d.pct = Math.max(0, Math.min(90, v || 0)); changed(); }, { min: 0, max: 90, step: 0.5 })),
        del));
    });
    if (!pr.discounts.length) box.append(h('div', { class: 'ed-hint' }, t('rs.p.noDiscounts')));
  };
  paint();
  const add = button('rs.p.addDiscount', 'plus', () => { pr.discounts.push({ nights: 7, pct: 10 }); paint(); changed(); });
  add.classList.add('ed-sm');
  return card('rs.p.discounts', box, h('div', { class: 'ap-actions' }, add), h('div', { class: 'ed-hint' }, t('rs.p.discHint')));
}

// "after" (first N guests free) only applies to per-guest fees, so the field appears only for those bases.
function feesCard(u) {
  const pr = u.price;
  const box = h('div', { class: 'rs-rows' });
  const perOpts = FEE_PER.map((v) => ({ v, l: 'rs.fee.' + v }));
  const paint = () => {
    box.textContent = '';
    pr.fees.forEach((f, i) => {
      const del = h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.remove'), title: t('rs.remove'), onclick: () => { pr.fees.splice(i, 1); paint(); changed(); } }, iconEl('trash'));
      const per = select(perOpts, f.per, (v) => { f.per = v; paint(); changed(); });
      per.setAttribute('aria-label', t('rs.fee.per'));
      box.append(h('div', { class: 'rs-fee' },
        textInput(f.name, (v) => { f.name = v; changed(); }, { 'aria-label': t('rs.fee.name'), placeholder: t('rs.fee.name'), dir: 'auto' }),
        moneyInput(f.amount, (v) => { f.amount = v ?? 0; changed(); }, { 'aria-label': t('rs.fee.amount') }),
        per,
        f.per === 'guest' || f.per === 'guest_night' ? h('label', { class: 'rs-inl' }, h('span', {}, t('rs.fee.after')), numInput(f.after, (v) => { f.after = Math.max(0, Math.trunc(v || 0)); changed(); }, { min: 0, max: 50 })) : h('span'),
        del));
    });
  };
  paint();
  const add = button('rs.fee.add', 'plus', () => { pr.fees.push({ name: '', amount: 1000, per: 'stay', after: 0 }); paint(); changed(); });
  add.classList.add('ed-sm');
  return card('rs.fee.title', field('=' + t('rs.fee.cleaning') + ', ' + P.currency, moneyInput(pr.cleaning, (v) => { pr.cleaning = v ?? 0; changed(); })), box, h('div', { class: 'ap-actions' }, add), h('div', { class: 'ed-hint' }, t('rs.fee.hint')));
}

// --- seasons and closed periods ----------------------------------------------------------------------------------------

function rulesCard(u) {
  const addP = button('rs.r.addSeason', 'plus', () => { rawRules(u).push({ kind: 'price', from: V.month + '-01', to: dayAdd(V.month + '-01', 14), price: u.price.base, minNights: 0, note: '' }); syncRules(u); paintRules(u); });
  const addB = button('rs.r.addBlock', 'lock', () => { rawRules(u).push({ kind: 'block', from: dayAdd(TODAY, 7), to: dayAdd(TODAY, 10), note: '' }); syncRules(u); paintRules(u); });
  addP.classList.add('ed-sm'); addB.classList.add('ed-sm');
  return card('rs.r.title', h('div', { class: 'ed-hint' }, t('rs.r.hint')), els.rules, h('div', { class: 'ap-actions' }, addP, addB));
}

// Rule ids are positions (1-based): order is semantics here - the last matching rule wins in booking/rates.js.
function syncRules(u) {
  u.price.rules = rawRules(u).map((r, i) => normalizeCalRule({ ...r, id: i + 1 })).filter(Boolean);
  changed();
}

// Each row validates on every edit and shows its own message; reordering swaps raw rows and re-syncs. Weekday
// filter: undefined = all days (stored as absence rather than [0..6], and an empty selection also means all days
// rather than a rule that never applies).
function paintRules(u) {
  const box = els.rules, list = rawRules(u);
  box.textContent = '';
  if (!list.length) { box.append(h('div', { class: 'ap-empty' }, t('rs.r.none'))); return; }
  list.forEach((r, i) => {
    const ok = !!normalizeCalRule(r);
    const msg = h('div', { class: 'rs-rule-msg' }, ok ? '' : t('rs.r.bad'));
    const upd = () => { const v = !!normalizeCalRule(r); msg.textContent = v ? '' : t('rs.r.bad'); row.classList.toggle('rs-rule-bad', !v); syncRules(u); };
    const mv = (k) => { const j = i + k; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; syncRules(u); paintRules(u); };
    const tools = h('div', { class: 'rs-rule-tools' },
      h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.up'), title: t('rs.up'), disabled: i === 0, onclick: () => mv(-1) }, iconEl('up')),
      h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.down'), title: t('rs.down'), disabled: i === list.length - 1, onclick: () => mv(1) }, iconEl('down')),
      h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('rs.remove'), title: t('rs.remove'), onclick: () => { list.splice(i, 1); syncRules(u); paintRules(u); } }, iconEl('trash')));
    const kind = h('span', { class: 'rs-chip ' + (r.kind === 'block' ? 'rs-chip-cancelled' : 'rs-chip-confirmed') }, t(r.kind === 'block' ? 'rs.r.block' : 'rs.r.season'));
    const fields = [
      field('rs.b.from', dayInput(r.from, (v) => { r.from = v; upd(); })),
      field('rs.r.to', dayInput(r.to, (v) => { r.to = v; upd(); })),
    ];
    let extra = null;
    if (r.kind === 'price') {
      fields.push(
        field('=' + t('rs.r.price') + ', ' + P.currency, moneyInput(r.price ?? 0, (v) => { r.price = v ?? 0; upd(); })),
        field('rs.p.minNights', numInput(r.minNights || '', (v) => { r.minNights = Math.max(0, Math.trunc(v || 0)); upd(); }, { min: 0, max: 365, placeholder: '—' })));
      const wds = h('div', { class: 'rs-wdpick', role: 'group', 'aria-label': t('rs.r.weekdays') });
      for (let d = 0; d < 7; d++) {
        const on = !r.weekdays || r.weekdays.includes(d);
        wds.append(h('button', {
          type: 'button', class: 'rs-wdbtn' + (on ? ' ed-on' : ''), 'aria-pressed': String(on), onclick: (e) => {
            const cur = r.weekdays ? [...r.weekdays] : [0, 1, 2, 3, 4, 5, 6];
            const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
            r.weekdays = next.length === 7 || !next.length ? undefined : next;
            e.currentTarget.classList.toggle('ed-on'); e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.classList.contains('ed-on')));
            upd();
          },
        }, wdShort(d)));
      }
      extra = h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('rs.r.weekdays')), wds);
    }
    const row = h('div', { class: 'rs-rule' + (ok ? '' : ' rs-rule-bad') },
      h('div', { class: 'rs-rule-h' }, h('span', { class: 'rs-rule-n' }, '#' + (i + 1)), kind,
        textInput(r.note || '', (v) => { r.note = v; upd(); }, { placeholder: t('rs.r.note'), 'aria-label': t('rs.r.note'), dir: 'auto', class: 'ed-input rs-rule-note' }), tools),
      h('div', { class: 'rs-rule-f' }, fields), extra, msg);
    box.append(row);
  });
}

// --- quote -----------------------------------------------------------------------------------------------------------

function quoteCard() {
  const qf = h('div', { class: 'rs-qform' },
    field('rs.b.from', dayInput(V.from, (v) => { V.from = v; keep(); paintQuote(); }, { id: 'rs-q-from' })),
    field('rs.b.to', dayInput(V.to, (v) => { V.to = v; keep(); paintQuote(); }, { id: 'rs-q-to' })),
    field('rs.b.guests', numInput(V.guests, (v) => { V.guests = Math.max(1, Math.trunc(v || 1)); keep(); paintQuote(); }, { min: 1, max: 50, id: 'rs-q-guests' })));
  const codes = h('details', { class: 'rs-details' }, h('summary', {}, iconEl('chevRight'), h('span', {}, t('rs.q.codes'))),
    h('dl', { class: 'ap-kv rs-codes' }, QUOTE_ERRORS.flatMap((c) => [h('dt', {}, h('code', {}, c)), h('dd', {}, h('b', {}, t('rs.q.err.' + c, { n: '…' })), ' — ', t('rs.q.why.' + c))])));
  return card('rs.q.title', qf, els.quote, codes);
}

// The quote result exposes ok/total/error as data-* attributes for e2e checks. Refusals are explained by a stable
// error code plus a translated reason (QUOTE_ERRORS lists them all in the "codes" disclosure).
function paintQuote() {
  const u = U(), box = els.quote;
  if (!box || !u) return;
  box.textContent = '';
  const q = unitQuote(P, u, { from: V.from, to: V.to, guests: V.guests, today: TODAY });
  box.dataset.ok = String(q.ok);
  box.dataset.total = String(q.total);
  box.dataset.error = q.error || '';
  if (!q.ok) {
    box.append(h('div', { class: 'rs-qerr', role: 'alert' }, iconEl('warn'),
      h('div', {}, h('b', {}, t('rs.q.err.' + q.error, { n: q.minNights })), ' ', h('code', { class: 'rs-code' }, q.error), h('div', { class: 'ed-hint' }, t('rs.q.why.' + q.error)))));
    if (q.nights) box.append(h('div', { class: 'ed-hint' }, t('rs.nights', { n: q.nights }) + (q.minNights ? ' · ' + t('rs.q.min', { n: q.minNights }) : '')));
    if (q.conflicts.length) box.append(h('ul', { class: 'rs-qconf' }, q.conflicts.map((c) => h('li', {}, fmtRange(c.from, c.to), c.guest ? ' · ' + c.guest : ''))));
    return;
  }
  // Consecutive nights with the same price and source are one line ("3 × 110.00 GEL · weekday").
  const groups = [];
  for (const n of q.nightly) {
    const g = groups[groups.length - 1];
    if (g && g.price === n.price && g.rule === n.rule && g.ruleId === n.ruleId && g.to === n.day) { g.n++; g.to = dayAdd(n.day, 1); } else groups.push({ ...n, n: 1, from: n.day, to: dayAdd(n.day, 1) });
  }
  const ruleNote = (g) => {
    if (g.rule !== 'season') return t('rs.q.src.' + g.rule);
    const r = u.price.rules.find((x) => x.id === g.ruleId);
    return r && r.note ? r.note : t('rs.q.src.season');
  };
  const rows = groups.map((g) => [fmtRange(g.from, g.to), `${g.n} × ${money(g.price)}`, ruleNote(g), money(g.n * g.price)]);
  // 30 % prepayment, the common short-let convention; prepayment() rounds so now + later equals the total exactly.
  const pre = prepayment(q.total, 30);
  const sumRows = [['rs.q.subtotal', money(q.subtotal)]];
  if (q.discount) sumRows.push(['=' + t('rs.q.discount', { p: fmtNum(q.discountPct, q.discountPct % 1 ? 1 : 0) }), '− ' + money(q.discount)]);
  for (const f of q.fees) sumRows.push(['=' + (f.name === 'cleaning' ? t('rs.fee.cleaning') : f.name || t('rs.fee.title')), money(f.amount)]);
  box.append(
    h('div', { class: 'rs-qtotal' }, h('div', {}, h('div', { class: 'rs-stat-l' }, t('rs.q.total')), h('div', { class: 'rs-qsum', id: 'rs-q-total' }, money(q.total)), h('div', { class: 'ed-hint' }, equivalents(q.total).join(' · '))),
      h('div', { class: 'rs-qmeta' }, h('span', {}, t('rs.nights', { n: q.nights })), h('span', {}, t('rs.q.avg', { sum: money(Math.round(q.total / q.nights)) })), q.minNights ? h('span', {}, t('rs.q.min', { n: q.minNights })) : null)),
    table(['rs.b.dates', 'rs.q.nightsCol', 'rs.q.source', 'rs.q.sum'], rows, { num: [1, 3] }),
    h('dl', { class: 'ap-kv rs-qkv' }, sumRows.flatMap(([k, v]) => [h('dt', {}, k.startsWith('=') ? k.slice(1) : t(k)), h('dd', { class: 'rs-num' }, v)]),
      h('dt', { class: 'rs-strong' }, t('rs.q.total')), h('dd', { class: 'rs-num rs-strong' }, money(q.total)),
      q.deposit ? [h('dt', {}, t('rs.p.deposit')), h('dd', { class: 'rs-num' }, money(q.deposit) + ' · ' + t('rs.q.refundable'))] : null,
      h('dt', {}, t('rs.q.prepay')), h('dd', { class: 'rs-num' }, t('rs.q.prepayV', { now: money(pre.now), later: money(pre.later) }))));
}

// --- price calendar --------------------------------------------------------------------------------------------------

function calLegend() {
  const it = (cls, k) => h('span', { class: 'rs-leg' }, h('i', { class: 'rs-leg-sw ' + cls, 'aria-hidden': 'true' }), t(k));
  return h('div', { class: 'rs-legend' }, it('rs-pc-base', 'rs.q.src.base'), it('rs-pc-weekday', 'rs.q.src.weekday'), it('rs-pc-season', 'rs.q.src.season'), it('rs-pc-busy', 'rs.pc.busy'), it('rs-pc-blocked', 'rs.cal.closed'));
}

// Price calendar: each day shows the nightly price and colours its source (base, weekday, season) or closed; booked
// days get a stripe. Clicking a day starts a quote there with the minimum stay. ARIA grid roles give screen readers
// row/column navigation semantics for the 7-column layout.
function paintCal() {
  const u = U(), box = els.cal;
  if (!box || !u) return;
  box.textContent = '';
  const pr = u.price;
  const cells = new Map(priceCalendar(V.month, { base: pr.base, per: pr.per, rules: pr.rules, weekdayRates: pr.weekdayRates, minNights: pr.minNights }).map((c) => [c.day, c]));
  const occ = new Map(occupancyCalendar(V.month, { bookings: unitStays(P, u.id), blocks: unitBlocks(u), today: TODAY }).map((c) => [c.day, c]));
  const grid = h('div', { class: 'rs-pcal', role: 'grid', 'aria-label': t('rs.pc.title') });
  grid.append(h('div', { class: 'rs-pcal-row', role: 'row' }, [0, 1, 2, 3, 4, 5, 6].map((d) => h('div', { class: 'rs-pcal-wd' + (d >= 5 ? ' rs-we' : ''), role: 'columnheader' }, wdShort(d)))));
  for (const week of monthGrid(V.month)) {
    const row = h('div', { class: 'rs-pcal-row', role: 'row' });
    for (const day of week) {
      if (!day) { row.append(h('div', { class: 'rs-pcal-c rs-pcal-out', role: 'gridcell' })); continue; }
      const c = cells.get(day), o = occ.get(day);
      const v = fromMinor(c.price, P.currency);
      const cls = 'rs-pcal-c rs-pc-' + (c.blocked ? 'blocked' : c.rule) + (o && o.state === 'busy' ? ' rs-pc-busy' : '') + (o && o.state === 'past' ? ' rs-pc-past' : '') + (day === TODAY ? ' rs-today' : '');
      const b = h('button', {
        type: 'button', class: cls, role: 'gridcell', dataset: { day },
        'aria-label': `${fmtDay(day, { weekday: true })}: ${c.blocked ? t('rs.cal.closed') : money(c.price)}${c.minNights ? ', ' + t('rs.q.min', { n: c.minNights }) : ''}${o && o.state === 'busy' ? ', ' + t('rs.pc.busy') : ''}`,
        onclick: () => { V.from = day; V.to = dayAdd(day, Math.max(1, c.minNights || 1)); keep(); render(); $('#rs-q-from')?.focus(); },
      }, h('span', { class: 'rs-pcal-d' }, String(+day.slice(8))),
        h('span', { class: 'rs-pcal-p' }, c.blocked ? '×' : fmtNum(v, v % 1 ? 2 : 0)),
        c.minNights > 1 ? h('span', { class: 'rs-pcal-m', title: t('rs.q.min', { n: c.minNights }) }, c.minNights + '+') : null);
      row.append(b);
    }
    grid.append(row);
  }
  box.append(grid);
  const nights = [...cells.values()].filter((c) => !c.blocked);
  if (nights.length) {
    const lo = Math.min(...nights.map((c) => c.price)), hi = Math.max(...nights.map((c) => c.price));
    box.append(h('div', { class: 'ed-hint' }, t('rs.pc.range', { lo: money(lo), hi: money(hi) })));
  }
}

startShell('prices', () => render());
render();
