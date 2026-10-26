// contract/render.js - a template filled by a document as HTML (a string; Node and browsers): the title, numbered
// sections and clauses (1., 1.1.), plain sections, appendices on their own pages, signature columns; conditions of
// sections / clauses (`when`), level variants (`by` + `variants`), placeholders with type-aware formatting and
// filters, payment schedules and item lists as tables, references to clause numbers, per-language texts with fallback
// to the main language (flagged), and a bilingual side-by-side layout.
//
//   renderContract(tpl, doc, { lang, second, showHidden, chips, marks, today }) ->
//     { html, used: Set of field ids, outline, fallbacks: [clause ids], errors: [{ code, msg, clause? }], env }
//   lang        the contract language (default: doc.lang, else the main language); second: a second language shown
//               side by side; showHidden: inactive sections / clauses are rendered dimmed (editing) instead of left
//               out; chips: placeholders carry data-f="field id" (the preview links them to the fields panel);
//               marks: { fieldId: 'error' | 'warning' } highlights placeholders of fields with issues
//   outline     [{ id, num, title, kind, active, clauses: [{ id, num, title, active, fallback }] }]
//   formatValue(value, ctx) / FILTERS: the formatting of values (also used by the fields panel summaries)
//   pickClauseText(tpl, clause, lang, env) -> [text, fromLang]
//
// Class names (styled by contract/css.js): ct-doc, ct-title, ct-sec (ct-app, ct-sigs, ct-plain), ct-h, ct-cl, ct-n,
// ct-v (ct-empty, ct-bad-error, ct-bad-warning), ct-vb, ct-tab, ct-sig, ct-bi, ct-fb (fallback text), ct-off, ct-err.
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { createEnv } from './env.js';
import { evaluate, parseExpr, refsOf, truthy } from './expr.js';
import { labelOf, resolvePath } from './fields.js';
import { capitalize, formatDate, formatNumber, initials, moneyText, plural } from './format.js';
import { tr } from './dict.js';
import { parseText } from './syntax.js';
import { numberWords, currencyOf } from './words.js';
import { pickFrom } from '../i18n/text.js';

// Rendering is string concatenation with deferred slots, marked by C0 control characters that never occur in
// escaped HTML or in template text (the parser keeps them, but nobody types them):
//   B0 n B1  a block value (table) produced inside a text; paragraphs() later lifts it OUT of the <p>, because a
//            <table> inside <p> is invalid HTML (the parser would auto-close the <p> and scramble the layout).
//   R0 id R1 a clause/section number reference ({{#id}}); resolved after all clauses are known and numbered,
//            which makes forward references ("see clause {{#termination}}") work in a single render.
// KNOWN LIMIT: a field value containing U+0001..U+0004 would be read as a slot marker. Impact is bounded to wrong
// text (a wrong number or a misplaced renderer-generated table), never markup injection; stripping C0 controls in
// coerceValue would close it.
// esc additionally encodes '*': a user value like "**x**" must not become bold when paragraphs() applies the
// **bold** markup to the rendered string. Template text is NOT escaped for '*', so authors keep the markup.
const B0 = '\u0001', B1 = '\u0002', R0 = '\u0003', R1 = '\u0004';
const esc = (s) => escapeHTML(s).replace(/\*/g, '&#42;');
const escLines = (s) => esc(s).replace(/\r?\n/g, '<br>');
const optLabel = (opts, v, lang, main) => { const o = (opts || []).find((x) => x.v === v); return o ? (o.label[lang] || o.label[main] || Object.values(o.label)[0] || o.v) : String(v ?? ''); };
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

// Variant choice first (the level's option, when that variant has any text), then the language fallback of
// pickFrom; returns [text, fromLang] so the caller can flag clauses shown in the main language (.ct-fb).
export function pickClauseText(tpl, c, lang, env) {
  let src = c.text;
  if (c.by && c.variants) {
    const opt = env.level(c.by);
    if (opt != null && c.variants[opt] && Object.keys(c.variants[opt]).length) src = c.variants[opt];
  }
  return pickFrom(src, lang, { defaultLang: tpl.main, langs: tpl.langs });
}

// --- values ------------------------------------------------------------------------------------------------------

// The legal "requisites" sentence of a party, assembled from dictionary phrases in contract-language order.
// detail=false: the preamble form (name, ids, registration, representative). detail=true: the signature-block form,
// one fact per line, adding bank details and contacts but omitting the representative (signed separately).
// Gendered phrase (p.reg.m / p.reg.f) because Russian participles agree with the person ("зарегистрирован(а)").
function partyText(v, f, lang, detail) {
  if (!v || !v.name) return '';
  const D = (k, x) => tr(lang, k, x);
  const date = (d) => formatDate(d, lang, 'long');
  const out = [v.name];
  if (v.kind === 'org') {
    if (v.inn) out.push(D('p.inn', { v: v.inn }));
    if (v.ogrn) out.push(D('p.ogrn', { v: v.ogrn }));
    if (v.kpp) out.push(D('p.kpp', { v: v.kpp }));
    if (v.address) out.push(D('p.orgAddr', { v: v.address }));
    if (!detail && v.rep) out.push(D('p.rep', { title: v.repTitle || '', v: v.rep }).replace(/\s+/g, ' ') + (v.repBasis ? ', ' + D('p.basis', { v: v.repBasis }) : ''));
  } else {
    if (v.birthDate) out.push(v.birthPlace ? D('p.bornAt', { d: date(v.birthDate), v: v.birthPlace }) : D('p.born', { d: date(v.birthDate) }));
    if (v.passport) {
      let p = D('p.passport', { v: v.passport });
      if (v.passportIssuer) p += ' ' + D('p.issued', { v: v.passportIssuer });
      if (v.passportDate) p += ' ' + D('p.issuedOn', { d: date(v.passportDate) });
      out.push(p);
    }
    if (v.passportCode) out.push(D('p.code', { v: v.passportCode }));
    if (v.address) out.push(D(v.gender === 'f' ? 'p.reg.f' : 'p.reg.m', { v: v.address }));
    if (v.inn) out.push(D('p.inn', { v: v.inn }));
  }
  if (detail) {
    if (v.kind === 'org') {
      if (v.bank) out.push(D('p.bank', { v: v.bank }));
      if (v.account) out.push(D('p.account', { v: v.account }));
      if (v.bik) out.push(D('p.bik', { v: v.bik }));
    }
    if (v.phone) out.push(D('p.phone', { v: v.phone }));
    if (v.email) out.push(D('p.email', { v: v.email }));
  }
  return out.join(detail ? '\n' : ', ');
}

function docText(v, f, lang, main) {
  if (!v || (!v.number && !v.date && !v.issuer)) return '';
  const kind = (f.kinds || []).find((k) => k.v === v.kind);
  const out = [];
  if (kind) out.push(kind.label[lang] || kind.label[main] || kind.v);
  if (v.number) out.push(tr(lang, 'd.number', { v: v.number }));
  if (v.date) out.push(tr(lang, 'd.date', { d: formatDate(v.date, lang, 'long') }));
  let s = out.join(' ');
  if (v.issuer) {
    const phrase = kind && (kind.issuer[lang] || kind.issuer[main]);
    s += ', ' + (phrase ? phrase + ' ' + v.issuer : tr(lang, 'p.issued', { v: v.issuer }));
  }
  if (v.until) s += ', ' + tr(lang, 'd.until', { d: formatDate(v.until, lang, 'long') });
  return s;
}

// All cells pass through esc(); numbers are formatted per language with exactly 2 decimals so the column aligns
// (.ct-r right-aligned, nowrap). Partial periods get .ct-part (italic) plus an explicit note: italics alone are
// not accessible and may not survive photocopying.
function scheduleTable(s, lang, cur) {
  if (!s || !s.periods || !s.periods.length) return '';
  const c = currencyOf(cur);
  const unit = c ? c.symbol : cur;
  const n2 = (x) => formatNumber(x, lang, { decimals: 2 });
  const d = (x) => formatDate(x, lang, 'short');
  let h = `<table class="ct-tab ct-sched"><thead><tr><th class="ct-c">${esc(tr(lang, 'sch.n'))}</th><th>${esc(tr(lang, 'sch.period'))}</th><th class="ct-r">${esc(tr(lang, 'sch.days'))}</th><th>${esc(tr(lang, 'sch.due'))}</th><th class="ct-r">${esc(tr(lang, 'sch.amount'))}, ${esc(unit)}</th></tr></thead><tbody>`;
  for (const p of s.periods) {
    h += `<tr${p.partial ? ' class="ct-part"' : ''}><td class="ct-c">${p.n}</td><td>${esc(d(p.from))} – ${esc(d(p.to))}${p.partial ? ` <span class="ct-note">(${esc(tr(lang, 'sch.partial'))})</span>` : ''}</td><td class="ct-r">${p.days}</td><td>${esc(d(p.due))}</td><td class="ct-r">${esc(n2(p.amount))}</td></tr>`;
  }
  return h + `</tbody><tfoot><tr><td colspan="4">${esc(tr(lang, 'sch.total'))}</td><td class="ct-r">${esc(n2(s.total))}</td></tr></tfoot></table>`;
}

// Totals row only when the list has money columns: the label spans the columns before the first money column,
// then every column from there gets a sum (money) or an empty cell, keeping the grid rectangular.
// `+r[it.id] || 0` treats unparsable cells as 0 in the total: a total must still render while a row is half-typed.
function listTable(rows, f, lang, main) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const items = f.items || [];
  const money = items.filter((it) => it.type === 'money');
  let h = `<table class="ct-tab ct-list"><thead><tr><th class="ct-c">${esc(tr(lang, 'list.n'))}</th>`;
  for (const it of items) {
    const cur = it.type === 'money' ? currencyOf(it.currency) : null;
    h += `<th${it.type === 'money' || it.type === 'number' ? ' class="ct-r"' : ''}>${esc(labelOf(it, lang, main))}${cur ? ', ' + esc(cur.symbol) : ''}</th>`;
  }
  h += '</tr></thead><tbody>';
  rows.forEach((r, i) => {
    h += `<tr><td class="ct-c">${i + 1}</td>`;
    for (const it of items) {
      const v = r[it.id];
      let s = '';
      if (it.type === 'money') s = v == null ? '' : formatNumber(v, lang, { decimals: 2 });
      else if (it.type === 'number') s = v == null ? '' : formatNumber(v, lang);
      else if (it.type === 'date') s = formatDate(v, lang, 'short');
      else if (it.type === 'select') s = optLabel(it.options, v, lang, main);
      else if (it.type === 'bool') s = tr(lang, v ? 'yes' : 'no');
      else s = String(v ?? '');
      h += `<td${it.type === 'money' || it.type === 'number' ? ' class="ct-r"' : ''}>${escLines(s)}</td>`;
    }
    h += '</tr>';
  });
  h += '</tbody>';
  if (money.length) {
    h += `<tfoot><tr><td colspan="${1 + items.indexOf(money[0])}">${esc(tr(lang, 'list.total'))}</td>`;
    for (let k = items.indexOf(money[0]); k < items.length; k++) {
      const it = items[k];
      h += `<td class="ct-r">${it.type === 'money' ? esc(formatNumber(rows.reduce((a, r) => a + (+r[it.id] || 0), 0), lang, { decimals: 2 })) : ''}</td>`;
    }
    h += '</tr></tfoot>';
  }
  return h + '</table>';
}

// The default text of a value: by the type of its field (and the part of a composite value), else by its JS type.
// -> { text } | { html, block: true }
// Dispatch order: composite types by sub-path (schedule.total, tenant.birthDate, term.end, services.0.price), then
// scalar types (computed fields use their declared `format`), then the JS type of the value as a last resort, so an
// expression result with no field still prints sensibly. Sub-path matching uses suffix regexes because schedule
// values nest (schedule.first.amount, schedule.periods.0.due).
export function formatValue(v, ctx) {
  const { field: f, sub = '', lang, main } = ctx;
  if (isEmpty(v)) return { text: '' };
  if (f) {
    const t = f.type === 'computed' ? f.format : f.type;
    if (f.type === 'schedule') {
      if (!sub) return { html: scheduleTable(v, lang, f.currency), block: true };
      if (/(^|\.)(amount|total)$/.test(sub)) return { text: moneyText(v, { lang, currency: f.currency }) };
      if (/(^|\.)(from|to|due|start|end|last)$/.test(sub)) return { text: formatDate(v, lang, 'long') };
    }
    if (f.type === 'list' && !sub) return { html: listTable(v, f, lang, main), block: true };
    if (f.type === 'list' && /^\d+\.\w+$/.test(sub)) {
      const it = (f.items || []).find((x) => x.id === sub.split('.')[1]);
      if (it) return formatValue(v, { ...ctx, field: { ...it }, sub: '' });
    }
    if (f.type === 'party') {
      if (!sub) return { text: partyText(v, f, lang, false) };
      if (/Date$/.test(sub)) return { text: formatDate(v, lang, 'long') };
      if (sub === 'gender') return { text: tr(lang, v === 'f' ? 'pp.f' : 'pp.m') };
      if (sub === 'kind') return { text: tr(lang, v === 'org' ? 'pp.org' : 'pp.person') };
    }
    if (f.type === 'docref') {
      if (!sub) return { text: docText(v, f, lang, main) };
      if (sub === 'kind') { const k = (f.kinds || []).find((x) => x.v === v); return { text: k ? (k.label[lang] || k.label[main] || k.v) : String(v) }; }
      if (sub === 'date' || sub === 'until') return { text: formatDate(v, lang, 'long') };
    }
    if (f.type === 'period') {
      // The term as its first and last days ("с «23» января 2027 г. по «22» декабря 2027 г."; the move-out date is end).
      if (!sub) return v.start && v.last ? { text: tr(lang, 'period', { a: formatDate(v.start, lang, 'long'), b: formatDate(v.last, lang, 'long') }) } : { text: '' };
      if (sub === 'start' || sub === 'end' || sub === 'last') return { text: formatDate(v, lang, 'long') };
      if (sub === 'months' || sub === 'days' || sub === 'restDays') return { text: formatNumber(v, lang) };
    }
    if (!sub || f.type === 'computed') {
      if (t === 'money') return { text: moneyText(v, { lang, currency: f.currency }) };
      if (t === 'number') return { text: formatNumber(v, lang) + (f.unit && (f.unit[lang] || f.unit[main]) ? ' ' + (f.unit[lang] || f.unit[main]) : '') };
      if (t === 'date') return { text: formatDate(v, lang, 'long') };
      if (t === 'select') return { text: optLabel(f.options, v, lang, main) };
      if (t === 'bool') return { text: tr(lang, v ? 'yes' : 'no') };
    }
  }
  if (typeof v === 'number') return { text: formatNumber(v, lang) };
  if (typeof v === 'boolean') return { text: tr(lang, v ? 'yes' : 'no') };
  if (Array.isArray(v)) return { text: v.map((x) => (x && typeof x === 'object' ? Object.values(x)[0] : x)).filter((x) => x != null && x !== '').join(', ') };
  if (typeof v === 'object') return { text: v.name || '' };
  return { text: String(v) };
}

const ARG = (a, i, d) => (a[i] == null ? d : a[i]);
// Filters: (value, args, ctx) -> { text } | { html, block } | null (the value itself, unformatted).
// Filters receive (value, evaluated args, ctx with field/sub) and return a formatted result or null (= keep the
// value). Several filters chain: after the first produced text, later ones see ctx.field = null (the value is now
// text, not the field's typed value). Lookup in renderPlaceholder uses hasOwnProperty, so 'constructor' is not a
// filter.
export const FILTERS = {
  words: (v, a, c) => ({ text: numberWords(v, c.lang, ARG(a, 0, 'm')) }),
  money: (v, a, c) => ({ text: moneyText(v, { lang: c.lang, currency: ARG(a, 0, c.currency), words: false, cents: 'auto' }) }),
  moneyWords: (v, a, c) => ({ text: moneyText(v, { lang: c.lang, currency: a[0] && a[0] !== 'cap' ? a[0] : c.currency, capital: a.includes('cap') }) }),
  full: (v, a, c) => (c.field && c.field.type === 'party' && !c.sub ? { text: partyText(v, c.field, c.lang, false) } : FILTERS.moneyWords(v, a, c)),
  details: (v, a, c) => (c.field && c.field.type === 'party' ? { text: partyText(v, c.field, c.lang, true) } : null),
  num: (v, a, c) => ({ text: formatNumber(v, c.lang, { decimals: Number.isInteger(a[0]) ? a[0] : undefined }) }),
  date: (v, a, c) => ({ text: formatDate(v, c.lang, ARG(a, 0, 'long')) }),
  upper: (v, a, c) => ({ text: String(formatValue(v, c).text || '').toLocaleUpperCase() }),
  lower: (v, a, c) => ({ text: String(formatValue(v, c).text || '').toLocaleLowerCase() }),
  cap: (v, a, c) => ({ text: capitalize(formatValue(v, c).text || '') }),
  // An organisation signs by its name; a person by surname and initials.
  initials: (v, a, c) => ({ text: v && typeof v === 'object' ? (v.kind === 'org' ? v.name || '' : initials(v.name, c.lang)) : initials(v, c.lang) }),
  plural: (v, a, c) => ({ text: plural(c.lang, v, a) }),
  // Gender agreement with a party (or a 'm' / 'f' value): g:'именуемый','именуемая','именуемое' (the third for
  // organisations, default: the first).
  g: (v, a) => {
    const g = v && typeof v === 'object' ? (v.kind === 'org' ? 'org' : v.gender) : v;
    return { text: String(g === 'f' ? ARG(a, 1, ARG(a, 0, '')) : g === 'org' ? ARG(a, 2, ARG(a, 0, '')) : ARG(a, 0, '')) };
  },
  table: (v, a, c) => (c.field && c.field.type === 'list' ? { html: listTable(v, c.field, c.lang, c.main), block: true } : c.field && c.field.type === 'schedule' ? { html: scheduleTable(v, c.lang, c.field.currency), block: true } : null),
  inline: (v, a, c) => (Array.isArray(v) ? { text: v.map((r) => (r && typeof r === 'object' ? r[ARG(a, 0, (c.field?.items?.[0]?.id) || 'name')] : r)).filter((x) => x != null && x !== '').join(', ') } : null),
  default: (v, a, c) => (isEmpty(v) ? { text: String(ARG(a, 0, '')) } : formatValue(v, c)),
  yesno: (v, a) => ({ text: String(truthy(v) ? ARG(a, 0, '') : ARG(a, 1, '')) }),
  raw: (v) => ({ text: v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v) }),
};
// Filters that turn an empty value into text (the others leave an empty placeholder).
// For every other filter an empty value short-circuits to the empty-placeholder chip; formatting nothing would
// print "0 рублей" or an empty table where the contract should show a blank to fill.
const EMPTY_OK = new Set(['default', 'yesno', 'g', 'plural']);

// --- texts -------------------------------------------------------------------------------------------------------

// Text nodes are escaped here (template text is untrusted too); only renderer-generated tags enter `out.s`.
// [[each]] is capped at 500 items (same bound as coerceValue) and binds `index` 1-based, as legal lists count.
function renderNodes(nodes, ctx, vars, out) {
  for (const n of nodes) {
    if (n.t === 'text') out.s += escapeHTML(n.v);
    else if (n.t === 'err') { out.s += `<span class="ct-err" title="${escapeAttr(n.msg)}">${escapeHTML(n.src)}</span>`; ctx.errors.push({ code: 'syntax', msg: n.msg, clause: ctx.clause }); }
    else if (n.t === 'num') out.s += R0 + (n.id || ctx.clause) + R1;
    else if (n.t === 'if') {
      let body = n.els;
      for (const b of n.branches) if (truthy(ctx.eval(b.cond, vars))) { body = b.body; break; }
      if (body) renderNodes(body, ctx, vars, out);
    } else if (n.t === 'each') {
      const list = ctx.eval(n.ast, vars);
      if (Array.isArray(list)) list.slice(0, 500).forEach((item, i) => renderNodes(n.body, ctx, { ...vars, [n.as]: item, index: i + 1 }, out));
    } else if (n.t === 'ph') out.s += renderPlaceholder(n, ctx, vars, out);
  }
}

// A placeholder resolves to: its value, the field it belongs to (for type-aware formatting, chips and marks), and
// a currency (own field, else any field the expression reads, else RUB), so `{{rent * 2 | money}}` prints in the
// rent's currency. An empty value renders as a chip showing the field label: on screen it says what to fill, in
// print it becomes a blank line (css.js .ct-empty).
function renderPlaceholder(n, ctx, vars, out) {
  const { env, lang } = ctx;
  const value = ctx.eval(n.ast, vars);
  // The field the placeholder shows: the path of a plain reference, else the first field the expression reads.
  let field = null, sub = '', fid = '';
  const refs = [...refsOf(n.ast)];
  const local = (p) => vars && Object.prototype.hasOwnProperty.call(vars, p.split('.')[0]);
  if (n.ast.t === 'ref' && !local(n.ast.path)) {
    const r = resolvePath(env.byId, n.ast.path);
    if (r) { field = r.field; sub = r.sub; fid = r.id; }
  } else if (n.ast.t === 'ref' && local(n.ast.path) && ctx.listItem) {
    // {{s.price}} inside [[each services as s]]: format by the item field of the list.
    const p = n.ast.path.split('.');
    const lf = ctx.listItem(p[0]);
    const it = lf && p[1] && (lf.items || []).find((x) => x.id === p[1]);
    if (it) { field = it; fid = lf.id; }
  }
  if (!fid) for (const p of refs) { if (local(p)) continue; const r = resolvePath(env.byId, p); if (r) { fid = r.id; break; } }
  const currency = (field && (field.currency)) || refs.map((p) => resolvePath(env.byId, p)).find((r) => r && r.field.currency)?.field.currency || 'RUB';
  const fctx = { field, sub, lang, main: env.main, currency };
  let res;
  const empty = isEmpty(value) || (value && typeof value === 'object' && !Array.isArray(value) && field && field.type === 'party' && !value.name && !sub);
  if (empty && !n.filters.some((f) => EMPTY_OK.has(f.name))) res = null;
  else if (!n.filters.length) res = formatValue(value, fctx);
  else {
    let v = value;
    res = null;
    for (const f of n.filters) {
      const fn = Object.prototype.hasOwnProperty.call(FILTERS, f.name) ? FILTERS[f.name] : null;
      if (!fn) { ctx.errors.push({ code: 'filter', msg: f.name, clause: ctx.clause }); continue; }
      const args = f.args.map((a) => ctx.eval(a, vars));
      const r = fn(v, args, res ? { ...fctx, field: null, sub: '' } : fctx);
      if (r) { res = r; v = r.text ?? v; }
    }
    if (!res) res = formatValue(value, fctx);
  }
  const mark = fid && ctx.marks && ctx.marks[fid] ? ' ct-bad-' + ctx.marks[fid] : '';
  const data = ctx.chips && fid ? ` data-f="${escapeAttr(fid)}"` : '';
  if (!res || (res.text === '' && !res.html)) {
    const label = field && field.label ? labelOf(field, lang, env.main) : (fid || n.src);
    return `<span class="ct-v ct-empty${mark}"${data} title="${escapeAttr(n.src)}">${esc(label)}</span>`;
  }
  if (res.block) {
    out.blocks.push(`<div class="ct-vb${mark}"${data}>${res.html}</div>`);
    return B0 + (out.blocks.length - 1) + B1;
  }
  const html = res.html || escLines(res.text);
  return ctx.chips || mark ? `<span class="ct-v${mark}"${data}>${html}</span>` : html;
}

// Paragraphs of a rendered text: an empty line separates paragraphs, a line break is <br>, **bold** is <b>; block
// values (tables) stand between paragraphs. `num` goes before the first paragraph.
// Paragraph split on blank lines works on the RENDERED string safely: value newlines were already turned into <br>
// by escLines, so a user's multi-line value cannot split a template paragraph.
function paragraphs(s, blocks, num) {
  const out = [];
  let first = true;
  for (const para of s.split(/\n[ \t]*\n+/)) {
    const pieces = para.split(new RegExp(`${B0}(\\d+)${B1}`));
    for (let i = 0; i < pieces.length; i++) {
      if (i % 2) { if (first && num) { out.push(`<p class="ct-np">${num}</p>`); first = false; } out.push(blocks[+pieces[i]]); continue; }
      const t = pieces[i].replace(/^\n+|\n+$/g, '');
      if (!t.trim()) continue;
      const fmt = (x) => x.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
      const lead = first && num ? num + ' ' : '';
      // A tab splits a line into a left and a right part ("Moscow → 23 January 2027", two signatures).
      const tab = t.indexOf('\t');
      out.push(tab >= 0 ? `<p class="ct-split"><span>${lead}${fmt(t.slice(0, tab))}</span><span>${fmt(t.slice(tab + 1).replace(/\t/g, ' '))}</span></p>` : `<p>${lead}${fmt(t)}</p>`);
      first = false;
    }
  }
  if (first && num) out.push(`<p class="ct-np">${num}</p>`);
  return out.join('');
}
// plain: crude tag strip + entity decode for outline titles and emptiness tests only (never for output HTML).
const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(new RegExp(`[${B0}${B1}${R0}${R1}]`, 'g'), '').replace(/&nbsp;/g, ' ').replace(/&#42;/g, '*').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// --- the document ------------------------------------------------------------------------------------------------

// One context (and one env) per language: computed values and words depend on the language; field values do not,
// so both envs read the same doc. Errors are collected only from the primary language (the second gets []), so the
// same broken expression is not reported twice in bilingual mode.
function makeCtx(tpl, doc, lang, o, errors) {
  const env = createEnv(tpl, doc, { lang, today: o.today });
  const exprErr = (m) => errors.push({ code: 'expr', msg: m });
  const ctx = {
    env, lang, errors, marks: o.marks || null, chips: o.chips !== false, clause: '',
    eval: (ast, vars) => evaluate(ast, { get: env.get, lang, today: env.today, call: env.call, vars, onError: exprErr }),
    listItem: (name) => ctx.loops && ctx.loops[name],
  };
  return ctx;
}

// Pre-scan maps loop variable names to their list fields so placeholders inside the loop can format item values by
// item type. The map is per body; nested loops with the same variable name share one entry (last wins).
function renderBody(src, ctx) {
  const parsed = parseText(src);
  const out = { s: '', blocks: [] };
  // Loop variables of [[each list as x]] know their list field (so {{x.price}} formats as money).
  ctx.loops = {};
  const scan = (nodes) => {
    for (const n of nodes) {
      if (n.t === 'each' && n.ast && n.ast.t === 'ref') { const r = resolvePath(ctx.env.byId, n.ast.path); if (r && r.field.type === 'list') ctx.loops[n.as] = r.field; }
      if (n.t === 'each') scan(n.body);
      if (n.t === 'if') { for (const b of n.branches) scan(b.body); if (n.els) scan(n.els); }
    }
  };
  scan(parsed.nodes);
  renderNodes(parsed.nodes, ctx, null, out);
  return out;
}

// Conditions are memoized per render by source text: the same `when` on many clauses evaluates once, and the
// result is stable within one render (one env, one document snapshot). A broken condition counts as TRUE: hiding
// text because of an authoring typo would silently drop contract clauses, which is the worse failure.
const condOf = (src, ctx, cache) => {
  if (!src) return true;
  if (cache.has(src)) return cache.get(src);
  const p = parseExpr(src);
  if (p.error) ctx.errors.push({ code: 'expr', msg: p.error });
  const v = p.ast ? truthy(ctx.eval(p.ast, null)) : true;
  cache.set(src, v);
  return v;
};

// Contract: the template must already be normalized (normalizeTemplate); this function trusts its shape.
// Pipeline: pass 1 decides visibility and renders bodies with open number slots; numbering assigns numbers only to
// ACTIVE sections/clauses (hidden ones would leave gaps: 1.1, 1.3); pass 2 assembles HTML and resolves slots.
export function renderContract(tplIn, doc = {}, o = {}) {
  const tpl = tplIn;
  const lang = o.lang || doc.lang || tpl.main;
  const second = o.second && o.second !== lang ? o.second : '';
  const errors = [];
  const A = makeCtx(tpl, doc, lang, o, errors);
  const Bc = second ? makeCtx(tpl, doc, second, { ...o, marks: o.marks }, []) : null;
  const conds = new Map();
  const fallbacks = [];
  const langs = second ? [[A, lang], [Bc, second]] : [[A, lang]];

  // Pass 1: which sections and clauses are active and not empty; the bodies with clause references left open.
  const secs = [];
  for (const s of tpl.sections) {
    const sActive = condOf(s.when, A, conds);
    if (!sActive && !o.showHidden) continue;
    const sec = { s, active: sActive, clauses: [] };
    for (const c of s.clauses) {
      const cActive = sActive && condOf(c.when, A, conds);
      if (!cActive && !o.showHidden) continue;
      const bodies = [];
      let fb = false;
      for (const [ctx, l] of langs) {
        ctx.clause = c.id;
        const [text, from] = pickClauseText(tpl, c, l, ctx.env);
        if (from !== l && text) fb = true;
        const title = c.title ? pickFrom(c.title, l, { defaultLang: tpl.main, langs: tpl.langs })[0] : '';
        bodies.push({ body: renderBody(text, ctx), from, title: title ? renderBody(title, ctx).s : '' });
      }
      if (fb) fallbacks.push(c.id);
      const empty = !plain(bodies[0].body.s).trim() && !bodies[0].body.blocks.length;
      if (empty && cActive && !o.showHidden) continue;
      sec.clauses.push({ c, active: cActive && !empty, bodies, fallback: fb });
    }
    if (!sec.clauses.some((x) => x.active) && sActive && s.kind !== 'signatures' && !o.showHidden && s.clauses.length) continue;
    secs.push(sec);
  }

  // Numbers: numbered sections 1., 2.; their clauses 1.1., 1.2.; appendices 1, 2 (their own counter).
  const nums = new Map();
  let sn = 0, an = 0;
  for (const sec of secs) {
    if (!sec.active) continue;
    if (sec.s.kind === 'numbered') {
      sec.num = String(++sn);
      nums.set(sec.s.id, sec.num);
      let cn = 0;
      for (const cl of sec.clauses) if (cl.active) { cl.num = sec.num + '.' + (++cn); nums.set(cl.c.id, cl.num); }
    } else if (sec.s.kind === 'appendix') {
      sec.num = String(++an);
      nums.set(sec.s.id, sec.num);
      for (const cl of sec.clauses) if (cl.active) nums.set(cl.c.id, sec.num);
    }
  }
  // Slot resolution: explicit id -> its number; empty id ({{#}}) -> the enclosing clause; unknown or hidden target
  // -> '?' (visible in the document, so a dangling reference is caught at proofreading rather than printed blank).
  const refs = (h, own) => h.replace(new RegExp(`${R0}([^${R1}]*)${R1}`, 'g'), (m, id) => (nums.get(id) || (id === '' ? own : '') || nums.get(own) || '?'));

  const fbAttr = (from, l) => (from !== l ? ` class="ct-fb" title="${escapeAttr(tr(l, 'fallback', { lang: from }))}"` : '');
  const pair = (parts) => (parts.length === 1 ? parts[0].html : `<div class="ct-bi">${parts.map((p) => `<div class="ct-bi-x" lang="${escapeAttr(p.lang)}">${p.html}</div>`).join('')}</div>`);
  const outline = [];
  let html = '';
  // Title
  const titleParts = langs.map(([ctx, l]) => {
    ctx.clause = '';
    const [t] = pickFrom(tpl.title, l, { defaultLang: tpl.main, langs: tpl.langs });
    return { lang: l, html: t ? `<h1 class="ct-title">${refs(renderBody(t, ctx).s, '')}</h1>` : '' };
  });
  html += titleParts.some((p) => p.html) ? pair(titleParts) : '';
  for (const sec of secs) {
    const { s } = sec;
    const cls = 'ct-sec' + (s.kind === 'appendix' ? ' ct-app' : s.kind === 'signatures' ? ' ct-sigs' : s.kind === 'plain' ? ' ct-plain' : '') + (sec.active ? '' : ' ct-off');
    const off = sec.active ? '' : ` data-when="${escapeAttr(s.when || '')}"`;
    html += `<section class="${cls}" data-s="${escapeAttr(s.id)}" id="ct-s-${escapeAttr(s.id)}"${off}>`;
    const heads = langs.map(([ctx, l]) => {
      ctx.clause = s.id;
      let [t] = pickFrom(s.title, l, { defaultLang: tpl.main, langs: tpl.langs });
      if (!t && s.kind === 'appendix') t = tr(l, 'appendix', { n: '{{#}}' });
      const text = t ? refs(renderBody(t, ctx).s, s.id) : '';
      const num = sec.num && s.kind === 'numbered' ? `<span class="ct-n">${sec.num}.</span> ` : '';
      const fmt = (x) => x.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
      // An appendix title "Appendix 1\nto the agreement …\n\nTITLE": the reference block on the right, the title centred.
      const parts = s.kind === 'appendix' ? text.split(/\n[ \t]*\n+/) : [text];
      const ref = parts.length > 1 ? `<div class="ct-h-ref">${fmt(parts[0])}</div>` : '';
      const main = parts.length > 1 ? parts.slice(1).join('\n') : parts[0];
      return { lang: l, html: text || num ? `${ref}<h2 class="ct-h">${num}${fmt(main)}</h2>` : '' };
    });
    if (heads.some((x) => x.html)) html += pair(heads);
    const entry = { id: s.id, num: sec.num || '', kind: s.kind, active: sec.active, title: plain(heads[0].html), clauses: [] };
    outline.push(entry);
    if (s.kind === 'signatures') html += '<div class="ct-sig-grid">';
    for (const cl of sec.clauses) {
      const num = cl.num && s.kind === 'numbered' ? `<span class="ct-n">${cl.num}.</span>` : '';
      const parts = cl.bodies.map((b, i) => {
        const l = langs[i][1];
        const t = b.title ? `<b class="ct-ct">${b.title}.</b> ` : '';
        const body = paragraphs(t + b.body.s, b.body.blocks, num);
        return { lang: l, html: `<div${fbAttr(b.from, l)}>${refs(body, cl.c.id)}</div>` };
      });
      const ccls = (s.kind === 'signatures' ? 'ct-sig' : 'ct-cl') + (cl.active ? '' : ' ct-off');
      const when = cl.active ? '' : ` data-when="${escapeAttr(cl.c.when || s.when || '')}"`;
      html += `<div class="${ccls}" data-cl="${escapeAttr(cl.c.id)}" id="ct-c-${escapeAttr(cl.c.id)}"${when}>${pair(parts)}</div>`;
      entry.clauses.push({ id: cl.c.id, num: cl.num || '', active: cl.active, fallback: cl.fallback, title: plain(cl.bodies[0].title || '') || plain(refs(cl.bodies[0].body.s, cl.c.id)).slice(0, 70) });
    }
    if (s.kind === 'signatures') html += '</div>';
    html += '</section>';
  }
  for (const e of A.env.errors) errors.push(e);
  const used = new Set(A.env.used);
  if (Bc) for (const id of Bc.env.used) used.add(id);
  const p = tpl.page || {};
  // lang on <article> enables correct hyphenation (css hyphens:auto) and screen reader pronunciation; the second
  // language's columns carry their own lang attribute (pair()).
  const docAttrs = `class="ct-doc ct-font-${p.font === 'sans' ? 'sans' : 'serif'}${second ? ' ct-bilingual' : ''}" lang="${escapeAttr(lang)}" style="--ct-fs:${+p.fontSize || 12}pt"`;
  return { html: `<article ${docAttrs}>${html}</article>`, used, outline, fallbacks, errors, env: A.env };
}
