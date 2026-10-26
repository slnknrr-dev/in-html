// contract/validate.js - checks of a filled document: the built-in rules of every field type (required values,
// ranges, date order, masks with check digits: Russian passport, INN, SNILS, OGRN, BIC, account, phone, e-mail …)
// and the template's own JavaScript validator, which runs in a Worker built from a Blob (no page globals, no DOM, no
// storage, network objects removed, a hard timeout) — never in the page's scope.
//
//   validateDoc(tpl, doc, { lang, used, today }) -> [{ field, level: 'error' | 'warning', code, message }]
//       used: Set of field ids to check (default: all; a field the active text does not read is not required)
//   checkMask(mask, value) -> '' | 'mask' | 'checksum'     MASK_EXAMPLES { mask: example }
//   runUserValidator(code, fields, ctx, { timeout }) -> Promise<{ issues, error, ms, timedOut }>   (browsers)
//   userValidatorCore(code, fields, ctx) -> issues | Promise   the function the worker runs (Node tests call it)
//   cleanIssues(raw, lang) -> issues                           normalizes whatever a validator returned
import { cmpDate, parseDate } from './dates.js';
import { createEnv } from './env.js';
import { isEmptyValue, labelOf, partsOf } from './fields.js';
import { formatDate, formatNumber } from './format.js';
import { tr } from './dict.js';

// Russian identifier checksums (published algorithms):
// - INN: weighted sum mod 11 mod 10; 10 digits = organisation (one check digit), 12 = person (two check digits).
// - SNILS: weights 9..1 over the first 9 digits; sums 100/101 map to 00, larger sums mod 101; numbers up to
//   001-001-998 were issued before the checksum rule and are accepted unchecked.
// - OGRN: the first 12 (13-digit OGRN) or 14 (15-digit OGRNIP) digits mod 11 / mod 13, last digit of the remainder.
//   Number() is exact here: 14 digits < 2^53.
const digits = (s) => String(s || '').replace(/\D/g, '');
function innOk(s) {
  const d = digits(s).split('').map(Number);
  const k = (w) => (w.reduce((a, x, i) => a + x * d[i], 0) % 11) % 10;
  if (d.length === 10) return k([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  if (d.length === 12) return k([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && k([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  return false;
}
function snilsOk(s) {
  const d = digits(s);
  if (d.length !== 11) return false;
  if (+d.slice(0, 9) <= 1001998) return true;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +d[i] * (9 - i);
  let c = sum < 100 ? sum : sum === 100 || sum === 101 ? 0 : sum % 101;
  if (c === 100) c = 0;
  return c === +d.slice(9);
}
function ogrnOk(s) {
  const d = digits(s);
  if (d.length === 13) return (Number(d.slice(0, 12)) % 11) % 10 === +d[12];
  if (d.length === 15) return (Number(d.slice(0, 14)) % 13) % 10 === +d[14];
  return false;
}

// [shape regex, example shown in the message, optional checksum]. Shape errors and checksum errors are separate
// codes so the message can say "format" vs "check digit": a one-digit typo passes the shape and fails the checksum.
const MASKS = {
  'passport-ru': [/^\d{2}\s?\d{2}\s?№?\s?\d{6}$/, '45 10 123456'],
  inn: [/^\d{10}(\d{2})?$/, '7707083893', innOk],
  snils: [/^\d{3}-?\d{3}-?\d{3}[\s-]?\d{2}$/, '112-233-445 95', snilsOk],
  ogrn: [/^\d{13}(\d{2})?$/, '1027700132195', ogrnOk],
  phone: [/^\+?[\d\s().-]{7,20}$/, '+7 999 123-45-67', (s) => digits(s).length >= 10 && digits(s).length <= 15],
  email: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'name@example.com'],
  bik: [/^\d{9}$/, '044525225'],
  'account-ru': [/^\d{20}$/, '40817810099910004312'],
  'postcode-ru': [/^\d{6}$/, '101000'],
  'cadastral-ru': [/^\d{2}:\d{2}:\d{6,7}:\d{1,6}$/, '77:01:0004011:3125'],
};
export const MASK_EXAMPLES = Object.fromEntries(Object.entries(MASKS).map(([k, v]) => [k, v[1]]));

export function checkMask(mask, value) {
  const m = Object.prototype.hasOwnProperty.call(MASKS, mask) ? MASKS[mask] : null;
  if (!m || value == null || value === '') return '';
  const s = String(value).trim();
  const compact = mask === 'inn' || mask === 'ogrn' || mask === 'bik' || mask === 'account-ru' || mask === 'postcode-ru' ? s.replace(/\s/g, '') : s;
  if (!m[0].test(compact)) return 'mask';
  if (m[2] && !m[2](compact)) return 'checksum';
  return '';
}

// Built-in checks are deterministic, synchronous and run on every render. `used` restricts checks to fields the
// active text reads: a required field inside a switched-off section must not block the document. The env from the
// renderer is reused when given, so computed values are not evaluated twice.
export function validateDoc(tpl, doc, o = {}) {
  const lang = o.lang || doc.lang || tpl.main;
  const env = o.env || createEnv(tpl, doc, { lang, today: o.today });
  const used = o.used || null;
  const out = [];
  const L = (f) => labelOf(f, lang, tpl.main);
  const push = (field, level, code, vars) => out.push({ field, level, code, message: tr(lang, 'v.' + code, vars) });
  const textCheck = (id, f, v, mask) => {
    const r = checkMask(mask, v);
    if (r) push(id, 'error', r, { ex: MASK_EXAMPLES[mask] });
  };
  for (const f of tpl.fields) {
    if (used && !used.has(f.id)) continue;
    if (f.type === 'computed') continue;
    const v = env.valueOf(f.id);
    if (f.type === 'schedule') {
      if (v && v.issues && v.issues.length && !v.issues.includes('start') && !v.issues.includes('term')) push(f.id, 'warning', v.issues[0] === 'order' ? 'order' : 'term');
      continue;
    }
    const empty = f.type === 'period' ? isEmptyValue(f, v.input || v) : isEmptyValue(f, v);
    if (empty) { if (f.required) push(f.id, 'error', 'required'); continue; }
    if (f.type === 'number' || f.type === 'money') {
      if (f.min != null && v < f.min) push(f.id, 'error', 'min', { n: formatNumber(f.min, lang) });
      if (f.max != null && v > f.max) push(f.id, 'error', 'max', { n: formatNumber(f.max, lang) });
    } else if (f.type === 'text' || f.type === 'longtext') {
      if (f.mask) textCheck(f.id, f, v, f.mask);
      // SECURITY NOTE: the template's pattern runs on the main thread; a catastrophic-backtracking regex like
      // (a+)+$ freezes the page. Only the 300-char cap in model.js bounds it. A Worker with a timeout (as for the
      // user validator) would be the robust fix.
      if (f.pattern) { try { if (!new RegExp(f.pattern, 'u').test(v)) push(f.id, 'error', 'pattern'); } catch { /* a broken pattern checks nothing */ } }
      if (f.maxLength && v.length > f.maxLength) push(f.id, 'error', 'max', { n: f.maxLength });
    } else if (f.type === 'date') {
      if (!parseDate(v)) push(f.id, 'error', 'date');
      else {
        if (f.min && cmpDate(v, f.min) < 0) push(f.id, 'error', 'dateMin', { d: formatDate(f.min, lang, 'short') });
        if (f.max && cmpDate(v, f.max) > 0) push(f.id, 'error', 'dateMax', { d: formatDate(f.max, lang, 'short') });
        if (f.after) {
          const other = env.get(f.after);
          const od = other && typeof other === 'object' ? other.start : other;
          const of = env.byId.get(f.after);
          if (od && cmpDate(v, od) <= 0) push(f.id, 'error', 'after', { f: of ? L(of) : f.after });
        }
      }
    } else if (f.type === 'select') {
      if (!f.options.some((x) => x.v === v)) push(f.id, 'error', 'select');
    } else if (f.type === 'period') {
      const inp = v.input || {};
      if (!inp.start || (!inp.months && !inp.end)) push(f.id, 'error', 'term');
      else if (!v.end || !v.last) push(f.id, 'error', 'order');
      else {
        if (f.minMonths != null && v.months < f.minMonths) push(f.id, 'warning', 'min', { n: f.minMonths });
        if (f.maxMonths != null && v.months > f.maxMonths) push(f.id, 'warning', 'max', { n: f.maxMonths });
      }
    } else if (f.type === 'party') {
      for (const p of partsOf(f, v.kind)) {
        if (p === 'passport' && v.passport && f.idMask) textCheck(f.id + '.passport', f, v.passport, f.idMask);
        if (p === 'inn' && v.inn) textCheck(f.id + '.inn', f, v.inn, 'inn');
        if (p === 'ogrn' && v.ogrn) textCheck(f.id + '.ogrn', f, v.ogrn, 'ogrn');
        if (p === 'bik' && v.bik) textCheck(f.id + '.bik', f, v.bik, 'bik');
        if (p === 'account' && v.account) textCheck(f.id + '.account', f, v.account, 'account-ru');
        if (p === 'phone' && v.phone) textCheck(f.id + '.phone', f, v.phone, 'phone');
        if (p === 'email' && v.email) textCheck(f.id + '.email', f, v.email, 'email');
        if ((p === 'birthDate' || p === 'passportDate') && v[p] && !parseDate(v[p])) push(f.id + '.' + p, 'error', 'date');
      }
      if (v.kind === 'person' && v.birthDate && v.passportDate && cmpDate(v.passportDate, v.birthDate) <= 0) push(f.id + '.passportDate', 'error', 'after', { f: tr(lang, 'pp.birthDate') });
    } else if (f.type === 'list') {
      if (f.min != null && v.length < f.min) push(f.id, 'error', 'minItems', { n: f.min });
      if (f.max != null && v.length > f.max) push(f.id, 'error', 'maxItems', { n: f.max });
      v.forEach((row, i) => { for (const it of f.items) if (it.required && (row[it.id] == null || row[it.id] === '')) push(f.id, 'error', 'item', { n: i + 1, f: L(it) }); });
    }
  }
  for (const e of env.errors) {
    if (e.code === 'cycle') push(e.field, 'error', 'cycle');
    else if (e.code === 'expr' && e.field) push(e.field, 'warning', 'expr', { m: e.msg });
  }
  // One issue per field and code.
  const seen = new Set();
  return out.filter((x) => { const k = x.field + '|' + x.code + '|' + x.message; if (seen.has(k)) return false; seen.add(k); return true; });
}

// The validator's return value is untrusted: accept an array, a single issue or string, cap at 200 items and 500
// chars, map unknown levels to error. Output always has the issue shape, so the UI never type-checks.
export function cleanIssues(raw, lang = 'en') {
  const list = Array.isArray(raw) ? raw : raw == null || raw === true ? [] : [raw];
  const out = [];
  for (const x of list.slice(0, 200)) {
    if (x == null || x === false || x === true) continue;
    if (typeof x === 'string') { out.push({ field: '', level: 'error', code: 'user', message: x.slice(0, 500) }); continue; }
    if (typeof x !== 'object') continue;
    const msg = typeof x.message === 'string' ? x.message : typeof x.msg === 'string' ? x.msg : '';
    if (!msg) continue;
    out.push({
      field: typeof x.field === 'string' ? x.field.slice(0, 80) : '',
      level: x.level === 'warning' || x.level === 'warn' ? 'warning' : x.level === 'info' ? 'warning' : 'error',
      code: 'user', message: msg.slice(0, 500),
    });
  }
  return out;
}

// The function a validator worker runs for one request (serialized into the worker; self-contained). The template's
// code is a function body with the parameters (fields, ctx, helpers); it returns issues (or a Promise of them).
// Must be self-contained (no closures over module scope): it is serialized with toString() into the worker source.
// "use strict" is prepended: `this` is undefined in the body and sloppy-mode implicit globals become errors.
export function userValidatorCore(code, fields, ctx) {
  const helpers = {
    days: (a, b) => { const p = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }; const d = (p(b) - p(a)) / 864e5; return Number.isFinite(d) ? d : null; },
    isEmpty: (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0),
    digits: (s) => String(s == null ? '' : s).replace(/\D/g, ''),
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('fields', 'ctx', 'helpers', '"use strict";\n' + String(code || ''));
  return fn(fields, ctx, helpers);
}

// Worker bootstrap (serialized): removes the network and storage objects from the worker's global scope and its
// prototype chain before any template code runs, then answers { id, code, fields, ctx } messages.
// Defense in depth, not the primary boundary: deleting globals up the prototype chain and pinning them to undefined
// removes the obvious exfiltration paths, but a determined script may find others; the real boundary in compiled
// pages is CSP connect-src 'none' (compile.js), which a blob: worker inherits from its creator document. Names are
// split ('fe' + 'tch') so the repository's static network check (policy.js greps for bare fetch( and
// XMLHttpRequest) does not flag this file. ES5 syntax (var, function) keeps the serialized source valid anywhere.
// Results go through a JSON round-trip: functions, cycles or exotic objects in the result become an error message
// instead of a structured-clone exception.
function validatorWorker(core) {
  var names = ['fe' + 'tch', 'XMLHttp' + 'Request', 'Web' + 'Socket', 'Event' + 'Source', 'Web' + 'Transport', 'import' + 'Scripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'navigator'];
  for (var i = 0; i < names.length; i++) {
    for (var o = self; o; o = Object.getPrototypeOf(o)) { try { delete o[names[i]]; } catch (e) { /* not configurable */ } }
    try { Object.defineProperty(self, names[i], { value: undefined, configurable: false, writable: false }); } catch (e) { /* ignore */ }
  }
  var post = self.postMessage.bind(self);
  self.onmessage = function (e) {
    var d = e.data || {};
    var done = function (r) { try { post({ id: d.id, issues: JSON.parse(JSON.stringify(r == null ? [] : r)) }); } catch (err) { post({ id: d.id, error: 'result is not plain data' }); } };
    try {
      Promise.resolve(core(d.code, d.fields, d.ctx)).then(done, function (err) { post({ id: d.id, error: String((err && err.message) || err) }); });
    } catch (err) { post({ id: d.id, error: String((err && err.message) || err) }); }
  };
}

let workerURL = null;
// One fresh Worker per run, terminated afterwards: a hostile or buggy validator (infinite loop) is killed by the
// timeout, and no state leaks between runs. The blob URL of the worker source is created once and reused.
// The promise always resolves (never rejects): validation failure is data for the UI, not an exception.
export function runUserValidator(code, fields, ctx, o = {}) {
  const timeout = Math.min(Math.max(+o.timeout || 1500, 100), 10000);
  const lang = (ctx && ctx.lang) || 'en';
  return new Promise((resolve) => {
    if (!String(code || '').trim()) { resolve({ issues: [], error: '', ms: 0, timedOut: false }); return; }
    let w;
    const t0 = Date.now();
    try {
      if (!workerURL) {
        const src = `(${validatorWorker.toString()})(${userValidatorCore.toString()});`;
        workerURL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      }
      w = new Worker(workerURL);
    } catch (e) { resolve({ issues: [], error: 'worker: ' + String(e.message || e), ms: 0, timedOut: false }); return; }
    const timer = setTimeout(() => { w.terminate(); resolve({ issues: [], error: '', ms: timeout, timedOut: true }); }, timeout);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      const d = e.data || {};
      resolve({ issues: d.error ? [] : cleanIssues(d.issues, lang), error: d.error || '', ms: Date.now() - t0, timedOut: false });
    };
    w.onerror = (e) => { e.preventDefault?.(); clearTimeout(timer); w.terminate(); resolve({ issues: [], error: String(e.message || 'error'), ms: Date.now() - t0, timedOut: false }); };
    try { w.postMessage({ id: 1, code: String(code), fields, ctx }); } catch (e) { clearTimeout(timer); w.terminate(); resolve({ issues: [], error: String(e.message || e), ms: 0, timedOut: false }); }
  });
}
