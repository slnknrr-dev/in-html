// site-studio/editor-requests.js - landing editor: Site → Requests (configured requests used by cart sync, checkout and forms),
// the 'req' field control and "Test request". Browser-local endpoints (local:<collection>[/<key>]) are tested with
// the exported page's own runtime code (rtReq), so the editor shows exactly what the page will do.
//
// Design rules of this module:
// - Requests are document data (S.doc.requests), referenced by id from the shop (loadReq / saveReq / checkout.req)
//   and from block fields of type 'req'. Ids, not inline configs, so one endpoint edited once serves every user of it,
//   and deleting one can find and null every reference (remapReqRefs) instead of leaving dangling configs.
// - Everything typed here ends up in a PUBLIC page: headers are visible to any visitor (hence the rq.public warning),
//   so the UI never suggests putting secrets in them. Validation mirrors what fetch() would reject anyway, so a bad
//   value fails here, in the editor, rather than silently in a visitor's browser.
// - The test runs the same code paths as the exported page where it can (rtReq for local endpoints), so "works in the
//   editor" means "works on the site". Remote tests still go through httpFetch (net.js) so the offline build has no
//   network code.
// - Edits commit with render: 'none' and patch the list row by hand: a full re-render would destroy the input the user
//   is typing into (focus and caret lost on every keystroke).
import { uid } from '../util/id.js';
import { $, $$, clamp, clone, h, htmlText } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog } from '../ui/overlays.js';
import { pad2 } from '../ui/lang.js';
import { S } from '../studio/state.js';
import { commit } from '../studio/history.js';
import { blockLabel, pickT, typeDef, walk } from '../studio/doc.js';
import { fid, renderFields, section } from '../studio/fields.js';
import { openDocTab, renderDocSettings, setRightTab } from '../studio/right.js';
import { togglePanel } from '../studio/shell.js';
import { REQ_METHODS } from './viewer.js';
import { rtReq } from './viewer-runtime.js';
import { hasSkuItems } from './editor-shop.js';
import { httpFetch } from './net.js';

// Header name: the RFC 9110 token alphabet, capped at 64 chars. Forbidden names: the browser refuses to set them from
// script (forbidden request headers in the Fetch spec), so accepting them would produce requests that silently differ
// from the configuration. REQ_VARS is the closed placeholder set; LOCAL_RE bounds collection / key length because they
// become localStorage keys.
const REQ_MAX = 50;
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const FORBIDDEN_HEADER_RE = /^(cookie|host|content-length|origin|referer|connection|transfer-encoding|proxy-.*|sec-.*)$/i;
const REQ_VARS = ['cartId', 'orderId', 'site', 'lang', 'currency', 'form'];
const LOCAL_RE = /^local:[a-z0-9][a-z0-9._-]{0,39}(?:\/[A-Za-z0-9._{}-]{1,80})?$/;

// Editor state kept while the panel re-renders: selected request, last test result per request.
// Not in the document: test results are transient and must not enter undo history or the saved project.
const RQ = { sel: null, tests: new Map() };

const reqName = (r, i = (S.doc?.requests || []).indexOf(r)) => (r && (String(r.name || '').trim() || r.url)) || t('rq.untitled', { n: i + 1 });
// Usable request URL: https://…, http://…, a path starting with /, ./ or ../ (not //host), or local:<collection>.
// Placeholders are replaced by 'x' before URL parsing, because '{cartId}' in a host or path would make new URL() throw
// on an otherwise valid template. '//host' is rejected as a "path": protocol-relative URLs change meaning between a
// file:// preview and https hosting. 'http' is accepted but warned (mixed content blocks it on https sites).
function reqUrlKind(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^local:/.test(u)) return LOCAL_RE.test(u) ? 'local' : 'bad';
  if (/^https?:\/\//i.test(u)) { try { const x = new URL(u.replace(/\{\w+\}/g, 'x')); return x.hostname ? x.protocol.slice(0, -1) : 'bad'; } catch { return 'bad'; } }
  if (/^(\/(?!\/)|\.\/|\.\.\/)/.test(u) && !/\s/.test(u)) return 'path';
  return 'bad';
}
function reqUrlProblem(u) {
  const k = reqUrlKind(u);
  if (k === 'bad') return t('rq.urlBad');
  if (k === 'http') return t('rq.urlHttp');
  return '';
}
// CR / LF in a value is header injection; fetch throws on it, but a 2000-char cap and the check here make the editor
// say so before the visitor's browser does. An entirely empty row is not a problem (it is a row being added).
function headerProblem(hd) {
  const k = String(hd?.k || '').trim();
  if (!k && !String(hd?.v || '')) return '';
  if (!HEADER_NAME_RE.test(k)) return t('rq.hBad', { name: k || '…' });
  if (FORBIDDEN_HEADER_RE.test(k)) return t('rq.hForbidden', { name: k });
  if (/[\r\n]/.test(String(hd.v || '')) || String(hd.v || '').length > 2000) return t('rq.hValueBad');
  return '';
}

// Where a request is used: [label, …] (cart load / save, checkout, form blocks with a 'req' field).
// KNOWN DEFECT: unlike remapReqRefs below, this does not scan itemSchema fields of block items, so the delete dialog
// can under-count uses (the references are still nulled on delete). Fix: mirror the items loop of remapReqRefs.
function reqUses(id, doc = S.doc) {
  const out = [];
  if (!id || !doc) return out;
  const shop = doc.shop || {};
  if (shop.sync === 'remote' && shop.loadReq === id) out.push(t('rq.useLoad'));
  if (shop.sync === 'remote' && shop.saveReq === id) out.push(t('rq.useSave'));
  if (shop.checkout && shop.checkout.method === 'request' && shop.checkout.req === id) out.push(t('rq.useCheckout'));
  walk((b) => {
    for (const f of typeDef(b.type).schema || []) {
      if (f && f.type === 'req' && b[f.key] === id) out.push(t('rq.useForm', { name: blockLabel(b) || t('b.' + b.type) }));
    }
  }, doc);
  return out;
}
// References to request `id` anywhere in the doc, set to `to` (null when deleting). Returns the count.
// Called inside commit on the committed draft `d`; null clears references so the runtime treats them as "no request".
function remapReqRefs(doc, id, to) {
  let n = 0;
  const shop = doc.shop || {};
  for (const k of ['loadReq', 'saveReq']) if (shop[k] === id) { shop[k] = to; n++; }
  if (shop.checkout && shop.checkout.req === id) { shop.checkout.req = to; n++; }
  walk((b) => {
    for (const f of typeDef(b.type).schema || []) if (f && f.type === 'req' && b[f.key] === id) { b[f.key] = to; n++; }
    if (Array.isArray(b.items)) for (const f of typeDef(b.type).itemSchema || []) {
      if (f && f.type === 'req') for (const it of b.items) if (it && it[f.key] === id) { it[f.key] = to; n++; }
    }
  }, doc);
  return n;
}

// A new request: a browser-local endpoint by default (works offline at once; point it at a server later).
const newRequest = (n) => ({ id: uid(), name: t('rq.untitled', { n }), method: 'POST', url: 'local:inbox', headers: [], credentials: 'omit', timeout: 8000, retries: 2, itemsPath: 'items' });

// Jump to Site → Requests (from a request select or the shop settings), optionally selecting one request.
// The right panel may be collapsed (S.noRight); the tab would render into nothing, so open the panel first.
function openRequestsTab(id = null) {
  if (id && S.doc.requests?.some((r) => r.id === id)) RQ.sel = id;
  if (S.noRight) togglePanel('right');
  openDocTab('requests');
}

// Lazily creates the array: documents from older versions have no `requests`. RQ.sel is re-validated on every render
// because undo can remove the selected request behind the panel's back.
function dsRequests(body) {
  if (!Array.isArray(S.doc.requests)) S.doc.requests = [];
  const reqs = S.doc.requests;
  if (!reqs.some((r) => r.id === RQ.sel)) RQ.sel = reqs[0]?.id || null;
  body.append(h('p', { class: 'ed-hint' }, t('rq.intro')));
  body.append(h('div', { class: 'ed-note', role: 'note' }, iconEl('shield'), h('span', {}, t('rq.localNote'))));
  body.append(h('div', { class: 'ed-note ed-note-warn', role: 'note' }, iconEl('warn'), h('span', {}, t('rq.public'))));
  const list = h('ul', { class: 'ed-req-list', role: 'list' });
  reqs.forEach((r, i) => {
    const on = r.id === RQ.sel;
    const kind = reqUrlKind(r.url);
    list.append(h('li', { class: 'ed-req' + (on ? ' ed-on' : '') },
      h('button', { type: 'button', class: 'ed-req-main', 'aria-pressed': String(on), onclick: () => { RQ.sel = r.id; renderDocSettings(); } },
        h('span', { class: 'ed-req-m ed-req-m-' + String(r.method || 'GET').toLowerCase() }, r.method || 'GET'),
        h('span', { class: 'ed-req-info' },
          h('strong', {}, reqName(r, i)),
          h('small', { class: 'ed-muted' + (kind === 'bad' || !r.url ? ' ed-req-bad' : '') }, kind === 'local' ? '⌂ ' + r.url : r.url || '—'))),
      h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('rq.dup'), 'aria-label': t('rq.dup'), disabled: reqs.length >= REQ_MAX, html: icon('copy'), onclick: () => dupRequest(r.id) }),
      h('button', { type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('rq.del'), 'aria-label': t('rq.del'), html: icon('trash'), onclick: () => deleteRequest(r.id) })));
  });
  const add = h('button', {
    type: 'button', class: 'ed-btn ed-block-btn', disabled: reqs.length >= REQ_MAX,
    title: reqs.length >= REQ_MAX ? t('rq.max', { n: REQ_MAX }) : null,
    onclick: () => {
      const r = newRequest(reqs.length + 1);
      // REQ_MAX is re-checked inside the commit: a double click can queue two clicks before the button re-renders disabled.
      commit('add request', (d) => { if (!Array.isArray(d.requests)) d.requests = []; if (d.requests.length < REQ_MAX) d.requests.push(r); }, { render: 'none' });
      RQ.sel = r.id;
      renderDocSettings();
      // After the next frame: renderDocSettings replaced the DOM synchronously, the new input exists but layout has not run.
      requestAnimationFrame(() => $('#ed-docset .ed-req-editor input')?.focus());
    },
  }, iconEl('plus'), t('rq.add'));
  body.append(section('ds-reqs', t('rq.title'), h('div', {}, reqs.length ? list : h('p', { class: 'ed-muted' }, t('rq.empty')), add)));
  const r = reqs.find((x) => x.id === RQ.sel);
  if (r) body.append(section('ds-req', reqName(r), requestEditor(r)));
}

function dupRequest(id) {
  const src = S.doc.requests.find((r) => r.id === id);
  if (!src || S.doc.requests.length >= REQ_MAX) return;
  const c = { ...clone(src), id: uid(), name: reqName(src) + t('pj.copySuffix') };
  commit('duplicate request', (d) => { const i = d.requests.findIndex((x) => x.id === id); d.requests.splice(i + 1, 0, c); }, { render: 'none' });
  RQ.sel = c.id;
  renderDocSettings();
}

async function deleteRequest(id) {
  const r = S.doc.requests.find((x) => x.id === id);
  if (!r) return;
  const uses = reqUses(id);
  const text = t('rq.delQ', { name: reqName(r) }) + (uses.length ? ' ' + t('rq.delUsed', { n: uses.length }) : '');
  if (!(await confirmDialog(t('rq.del'), text, t('dlg.delete'), true))) return;
  commit('delete request', (d) => {
    d.requests = d.requests.filter((x) => x.id !== id);
    remapReqRefs(d, id, null);
  }, { render: 'all' });
  RQ.tests.delete(id);
  if (RQ.sel === id) RQ.sel = S.doc.requests[0]?.id || null;
  renderDocSettings();
}

// `get` re-finds the request by id on every access: the object captured at render time is stale after any commit.
// `coalesce` merges keystrokes of one field into one undo step; trimming happens only on commit-on-change, so the
// user can type a space mid-value without it vanishing.
function requestEditor(r) {
  const rid = r.id;
  const get = () => S.doc.requests.find((x) => x.id === rid);
  const set = (k, v, typing) => {
    if (k === 'url' || k === 'itemsPath') v = typing ? v : String(v ?? '').trim();
    commit('request ' + k, () => { const x = get(); if (x) x[k] = v; }, { render: 'none', coalesce: typing ? `req:${rid}:${k}` : null });
    if (k === 'name' || k === 'url' || k === 'method') {
      // Keep the list row in step without re-rendering the field being typed into.
      const row = $$('#ed-docset .ed-req.ed-on')[0];
      const x = get();
      if (row && x) {
        const st = row.querySelector('strong'); if (st) st.textContent = reqName(x);
        const kind = reqUrlKind(x.url);
        const sm = row.querySelector('small'); if (sm) { sm.textContent = kind === 'local' ? '⌂ ' + x.url : x.url || '—'; sm.classList.toggle('ed-req-bad', !x.url || kind === 'bad'); }
        const mm = row.querySelector('.ed-req-m'); if (mm) { mm.textContent = x.method; mm.className = 'ed-req-m ed-req-m-' + String(x.method).toLowerCase(); }
      }
    }
    if (k === 'url' && !typing) renderDocSettings();
  };
  // Transport fields (credentials, timeout, retries, headers) mean nothing for local endpoints, so they are hidden.
  const remote = () => reqUrlKind(get()?.url) !== 'local';
  const wrap = h('div', { class: 'ed-req-editor' });
  const flds = h('div', { class: 'ed-fields' });
  renderFields(flds, [
    { key: 'name', type: 'text', label: 'rq.name' },
    { key: 'method', type: 'select', label: 'rq.method', noSeg: true, options: REQ_METHODS.map((v) => ({ v, text: v })) },
    { key: 'url', type: 'text', label: 'rq.url', placeholderText: 'local:orders  ·  https://api.example.com/cart/{cartId}', hint: 'rq.urlHint', check: (v) => reqUrlProblem(v), wide: true, suggestList: ['local:cart/{cartId}', 'local:orders', 'local:inbox'] },
    { key: 'credentials', type: 'select', label: 'rq.credentials', noSeg: true, options: ['omit', 'same-origin', 'include'].map((v) => ({ v, l: 'rq.cred.' + v })), show: remote },
    { key: 'timeout', type: 'number', label: 'rq.timeout', min: 1000, max: 60000, step: 500, unit: t('rq.ms'), show: remote },
    { key: 'retries', type: 'number', label: 'rq.retries', min: 0, max: 5, step: 1, show: remote },
    { key: 'itemsPath', type: 'text', label: 'rq.itemsPath', placeholderText: 'items', hint: 'rq.itemsHint' },
  ], get, set, { rerender: () => renderDocSettings() });
  wrap.append(flds);
  if (remote()) wrap.append(headersUI(rid));
  else wrap.append(localData(r));
  const uses = reqUses(rid);
  wrap.append(h('p', { class: 'ed-hint' }, uses.length ? t('rq.used', { list: uses.join(', ') }) : t('rq.unused')));
  // Test request
  const out = h('div', { class: 'ed-req-result', role: 'status', 'aria-live': 'polite' });
  const btn = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => testRequest(rid, out, btn) }, iconEl('zap'), h('span', {}, t('rq.test')));
  wrap.append(h('div', { class: 'ed-req-test' }, h('div', { class: 'ed-row' }, btn, h('span', { class: 'ed-hint' }, t(remote() ? 'rq.testNote' : 'rq.testLocal'))), out));
  const last = RQ.tests.get(rid);
  if (last) paintTestResult(out, last);
  return wrap;
}

// Header list editor (name / value rows). Invalid rows are kept while editing and flagged; normalizeDoc drops them.
// Rows are addressed by index; safe because every structural change (add / remove) re-renders the whole list.
function headersUI(rid) {
  const get = () => S.doc.requests.find((x) => x.id === rid);
  const hs = () => (Array.isArray(get()?.headers) ? get().headers : []);
  const box = h('div', { class: 'ed-field ed-headers', dataset: { key: 'headers' } });
  const lid = fid();
  box.append(h('span', { class: 'ed-label', id: lid }, iconEl('key'), t('rq.headers')));
  const rows = h('div', { class: 'ed-hdr-rows', role: 'group', 'aria-labelledby': lid });
  const setHdr = (i, k, v, typing) => {
    commit('request header', () => { const x = get(); if (x && Array.isArray(x.headers) && x.headers[i]) x.headers[i][k] = v; },
      { render: 'none', coalesce: typing ? `reqh:${rid}:${i}:${k}` : null });
  };
  const list = hs();
  if (!list.length) rows.append(h('p', { class: 'ed-muted ed-hdr-none' }, t('rq.noHeaders')));
  list.forEach((hd, i) => {
    const warn = h('div', { class: 'ed-hint ed-hint-warn', role: 'status', hidden: true });
    const kIn = h('input', { type: 'text', class: 'ed-input ed-mono', value: hd.k || '', placeholder: 'X-Shop', spellcheck: 'false', autocomplete: 'off', 'aria-label': t('rq.hName') });
    const vIn = h('input', { type: 'text', class: 'ed-input ed-mono', value: hd.v || '', placeholder: 'demo', spellcheck: 'false', autocomplete: 'off', 'aria-label': t('rq.hValue') });
    const paint = () => { const m = headerProblem(hs()[i]); warn.hidden = !m; warn.textContent = m; kIn.toggleAttribute('aria-invalid', !!m); };
    kIn.addEventListener('input', () => { setHdr(i, 'k', kIn.value, true); paint(); });
    kIn.addEventListener('change', () => { kIn.value = kIn.value.trim(); setHdr(i, 'k', kIn.value, false); paint(); });
    vIn.addEventListener('input', () => { setHdr(i, 'v', vIn.value, true); paint(); });
    vIn.addEventListener('change', () => { setHdr(i, 'v', vIn.value, false); paint(); });
    const del = h('button', {
      type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('rq.hDel'), 'aria-label': t('rq.hDel'), html: icon('trash'),
      onclick: () => { commit('remove header', () => { const x = get(); if (x && Array.isArray(x.headers)) x.headers.splice(i, 1); }, { render: 'none' }); renderDocSettings(); },
    });
    rows.append(h('div', { class: 'ed-hdr' }, h('div', { class: 'ed-hdr-row' }, kIn, vIn, del), warn));
    paint();
  });
  box.append(rows, h('button', {
    type: 'button', class: 'ed-btn ed-sm', disabled: list.length >= 20, onclick: () => {
      commit('add header', () => { const x = get(); if (!x) return; if (!Array.isArray(x.headers)) x.headers = []; x.headers.push({ k: '', v: '' }); }, { render: 'none' });
      renderDocSettings();
      requestAnimationFrame(() => { const ins = $$('#ed-docset .ed-hdr-row input'); ins[ins.length - 2]?.focus(); });
    },
  }, iconEl('plus'), t('rq.hAdd')));
  return box;
}

// Records a local endpoint holds in this browser (what tests and previews stored), with a clear button.
// Reads the same localStorage key layout the page runtime writes ('lp-local:<docId>:<collection>'); keep in sync with
// viewer-runtime.js. JSON.parse is wrapped: a corrupt or foreign value must not break the settings panel.
function localData(r) {
  const coll = /^local:([a-z0-9][a-z0-9._-]{0,39})/.exec(r.url || '');
  const box = h('div', { class: 'ed-field ed-local-data' });
  if (!coll) return box;
  const key = 'lp-local:' + (S.doc.id || '') + ':' + coll[1];
  let db = {};
  try { db = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { db = {}; }
  const recs = Object.values(db).filter((x) => x && typeof x === 'object').sort((a, b) => b.at - a.at);
  box.append(h('span', { class: 'ed-label' }, iconEl('layers'), t('rq.localData', { name: coll[1], n: recs.length })));
  if (recs.length) {
    box.append(h('pre', { class: 'ed-req-body' }, recs.slice(0, 5).map((x) => `${new Date(x.at).toLocaleString()}  ${x.id}\n${JSON.stringify(x.data).slice(0, 300)}`).join('\n\n')));
    box.append(h('button', {
      type: 'button', class: 'ed-btn ed-sm ed-danger', onclick: () => { try { localStorage.removeItem(key); } catch { /* blocked */ } renderDocSettings(); },
    }, iconEl('trash'), t('rq.localClear')));
  }
  return box;
}

// Placeholders {cartId} {orderId} {site} {lang} {currency} {form}: URL-encoded in URLs, raw in headers; unknown
// placeholders stay literal.
// Encoding differs by context: in URLs a value with '/' or '?' would change the route, so it is encoded; headers take
// raw text. Unknown placeholders stay literal so the problem is visible in the test output instead of becoming ''.
function expandPlaceholders(s, vars, encode) {
  return String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (REQ_VARS.includes(k) && vars[k] != null ? (encode ? encodeURIComponent(String(vars[k])) : String(vars[k])) : m));
}
// Sample cart lines for test bodies: the first priced catalog items of the page, else one demo item.
// Real SKUs from the page make the test body resemble production traffic; walk() stops early once a callback returns
// true (two items are enough to show the array shape).
function sampleCartItems() {
  const out = [];
  walk((b) => {
    if (!Array.isArray(b.items) || !hasSkuItems(b.type)) return;
    for (const it of b.items) {
      if (out.length >= 2) return true;
      const sku = typeof it?.sku === 'string' ? it.sku.trim() : '';
      if (!sku) continue;
      const price = typeof it.price === 'number' && Number.isFinite(it.price) ? it.price : null;
      out.push({ sku, qty: out.length ? 1 : 2, price, name: htmlText(pickT(it.name) || pickT(it.title)) || sku });
    }
    return out.length >= 2;
  });
  if (!out.length) out.push({ sku: 'demo-1', qty: 2, price: 10, name: 'Sample item' });
  return out;
}

// The exported page's request runtime (rtReq) on the editor's storage: local endpoints answer exactly as in the page.
// A minimal host object for rtReq: only what local endpoints need (config, language, storage). emit is a no-op because
// the editor has no page event bus. Storage accessors swallow SecurityError (blocked storage, private mode).
function localRuntime() {
  const R = {
    cfg: { id: S.doc.id, shop: { cur: S.doc.shop?.currency || '' } },
    lang: () => S.lang,
    emit: () => {},
    store: {
      get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
      del: (k) => { try { localStorage.removeItem(k); } catch { /* blocked */ } },
    },
  };
  rtReq(R);
  return R;
}

// "Test request": send it now from the editor with sample values, show status / time / the first 2 KB of the
// answer, or why it failed (CORS, timeout, unreachable). Local endpoints run through the page runtime. Never rejects.
// Sample variables are recognisable as test data (TESTCART..., -TEST01) so a real backend can filter them out; the
// body carries test: true for the same reason. `done` writes into RQ.tests first and paints only if the output node is
// still attached: the user may navigate away while the request is in flight.
async function testRequest(rid, out, btn) {
  const r = S.doc.requests.find((x) => x.id === rid);
  if (!r) return;
  const day = new Date();
  const ymd = `${day.getFullYear()}${pad2(day.getMonth() + 1)}${pad2(day.getDate())}`;
  let formId = 'form';
  walk((b) => { for (const f of typeDef(b.type).schema || []) if (f && f.type === 'req' && b[f.key] === rid) { formId = b.id; return true; } return false; });
  const vars = { cartId: 'TESTCART00000001', orderId: ymd + '-TEST01', site: S.doc.id, lang: S.lang, currency: S.doc.shop?.currency || 'USD', form: formId };
  const method = REQ_METHODS.includes(r.method) ? r.method : 'GET';
  const res = { at: Date.now(), method, url: '', vars };
  const done = (o) => { Object.assign(res, o); RQ.tests.set(rid, res); if (out.isConnected) paintTestResult(out, res); };
  const kind = reqUrlKind(r.url);
  if (!r.url || kind === 'bad') { done({ error: t('rq.urlBad') }); return; }
  let body;
  if (method !== 'GET') {
    const items = sampleCartItems();
    const total = items.reduce((s, it) => (it.price == null || s == null ? null : s + it.price * it.qty), 0);
    body = { cartId: vars.cartId, orderId: vars.orderId, site: vars.site, lang: vars.lang, currency: vars.currency, updatedAt: Date.now(), items, total, test: true };
    res.body = JSON.stringify(body);
  }
  const setBusy = (on) => { if (btn && btn.isConnected) { btn.disabled = on; btn.lastChild.textContent = t(on ? 'rq.testing' : 'rq.test'); } };
  setBusy(true);
  out.textContent = '';
  out.append(h('p', { class: 'ed-muted' }, t('rq.testing')));
  const t0 = performance.now();
  if (kind === 'local') {
    res.url = expandPlaceholders(r.url, vars, true);
    const rr = await localRuntime().req({ m: method, u: r.url }, vars, body);
    const text = rr.data == null ? '' : JSON.stringify(rr.data, null, 1);
    const o = { status: rr.status, statusText: rr.ok ? 'OK' : rr.error, ms: Math.round(performance.now() - t0), ok: rr.ok, type: 'local', text };
    if (rr.ok && method === 'GET') {
      const path = String(r.itemsPath || 'items').trim() || 'items';
      const v = path.split('.').reduce((a, k) => (a != null && typeof a === 'object' ? a[k] : undefined), rr.data);
      o.items = Array.isArray(v) ? v.length : -1;
      o.path = path;
    }
    done(o);
    setBusy(false);
    renderDocSettings();
    return;
  }
  let url;
  try {
    const raw = expandPlaceholders(r.url, vars, true);
    // A relative path against file:// resolves to a local file, never to the user's server: say so instead of a confusing
    // CORS error.
    if (kind === 'path' && location.protocol === 'file:') { done({ error: t('rq.relative') }); setBusy(false); return; }
    url = new URL(raw, location.href).href;
  } catch { done({ error: t('rq.urlBad') }); setBusy(false); return; }
  res.url = url;
  const headers = {};
  for (const hd of Array.isArray(r.headers) ? r.headers : []) {
    if (!hd || headerProblem(hd) || !String(hd.k || '').trim()) continue;
    headers[hd.k.trim()] = expandPlaceholders(hd.v, vars, false);
  }
  const has = (n) => Object.keys(headers).some((k) => k.toLowerCase() === n);
  // cache: 'no-store' so a test never shows a stale cached answer; mode: 'cors' makes cross-origin failures explicit.
  const init = { method, headers, credentials: ['omit', 'same-origin', 'include'].includes(r.credentials) ? r.credentials : 'omit', cache: 'no-store', redirect: 'follow', mode: 'cors' };
  if (body !== undefined) {
    init.body = res.body;
    if (!has('content-type')) headers['Content-Type'] = 'application/json';
    // Same convention as the page runtime: retried non-GET requests carry an Idempotency-Key so the server can deduplicate.
    if (method !== 'DELETE' && !has('idempotency-key')) headers['Idempotency-Key'] = 'test-' + uid();
  }
  // Fetch reports both CORS refusal and mixed-content blocking as an opaque TypeError; knowing the protocols lets the
  // error message name the likely cause.
  const mixed = location.protocol === 'https:' && /^http:/i.test(url);
  const ms = clamp(+r.timeout || 8000, 1000, 60000);
  // The abort timer enforces the configured timeout; fetch itself has none. Retries are not exercised by the test.
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  if (ctl) init.signal = ctl.signal;
  const timer = setTimeout(() => { try { ctl?.abort(); } catch { /* ignore */ } }, ms);
  try {
    const resp = await httpFetch(url, init);
    const text = await readLimited(resp, 256 * 1024);
    const o = { status: resp.status, statusText: resp.statusText || '', ms: Math.round(performance.now() - t0), ok: resp.ok, type: resp.headers.get('content-type') || '', text: text.text, cut: text.cut };
    if (resp.ok && method === 'GET' && !text.cut) {
      try {
        const j = JSON.parse(text.text);
        const path = String(r.itemsPath || 'items').trim() || 'items';
        const v = path.split('.').reduce((a, k) => (a != null && typeof a === 'object' ? a[k] : undefined), j);
        o.items = Array.isArray(v) ? v.length : -1;
        o.path = path;
      } catch { /* not JSON */ }
    }
    done(o);
  } catch (e) {
    const elapsed = Math.round(performance.now() - t0);
    if (e && e.name === 'AbortError') done({ error: t('rq.timeoutErr', { ms }), ms: elapsed });
    else if (e instanceof TypeError) done({ error: mixed ? t('rq.mixed') : t('rq.cors'), detail: e.message, ms: elapsed });
    else done({ error: t('rq.err', { msg: e && e.message ? e.message : String(e) }), ms: elapsed });
  } finally {
    clearTimeout(timer);
    setBusy(false);
  }
}
// Read at most `max` bytes of a response as text (a huge answer is cut, not buffered whole).
// Streams instead of resp.text(): a misconfigured endpoint returning megabytes must not freeze the editor. Cutting at a
// byte boundary can split a UTF-8 sequence; TextDecoder (non-fatal) renders it as U+FFFD, acceptable for a preview.
async function readLimited(resp, max) {
  if (!resp.body || !resp.body.getReader) { const s = await resp.text(); return { text: s.slice(0, max), cut: s.length > max }; }
  const rd = resp.body.getReader();
  const chunks = [];
  let n = 0, cut = false;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n >= max) { cut = true; try { await rd.cancel(); } catch { /* ignore */ } break; }
  }
  const all = new Uint8Array(Math.min(n, max));
  let o = 0;
  for (const c of chunks) { const part = c.subarray(0, Math.min(c.length, all.length - o)); all.set(part, o); o += part.length; if (o >= all.length) break; }
  return { text: new TextDecoder().decode(all), cut };
}
// textContent / h() only, never innerHTML: the response body is untrusted remote content.
function paintTestResult(out, res) {
  out.textContent = '';
  out.classList.toggle('ed-req-ok', !!res.ok);
  out.classList.toggle('ed-req-fail', !res.ok);
  if (res.url) out.append(h('div', { class: 'ed-req-line ed-mono' }, `${res.method} ${res.url}`));
  if (res.error) {
    out.append(h('p', { class: 'ed-error' }, res.error));
    if (res.detail) out.append(h('p', { class: 'ed-muted ed-mono' }, res.detail));
    return;
  }
  out.append(h('p', { class: 'ed-req-status' }, h('span', { class: 'ed-dot' }), t('rq.status', { code: res.status, text: res.statusText, ms: res.ms })));
  if (res.items != null && res.items >= 0) out.append(h('p', { class: 'ed-hint' }, t('rq.items', { n: res.items, path: res.path })));
  else if (res.items === -1) out.append(h('p', { class: 'ed-hint' }, t('rq.noItems', { path: res.path })));
  out.append(h('div', { class: 'ed-label' }, t('rq.resp') + (res.type ? ' · ' + res.type : '')));
  const shown = String(res.text || '');
  out.append(h('pre', { class: 'ed-req-body' }, shown ? shown.slice(0, 2048) + (shown.length > 2048 || res.cut ? '\n…' : '') : t('rq.respEmpty')));
}

// Field type 'req': a configured request by id (null = none), with a button to manage requests.
// A reference to a deleted request (e.g. pasted block from another project) stays visible as "missing" instead of
// silently showing "none", so the user notices the broken link.
function reqControl(f, v, onChange, id) {
  const reqs = Array.isArray(S.doc?.requests) ? S.doc.requests : [];
  const sel = h('select', { id, class: 'ed-input ed-select' }, h('option', { value: '' }, '— ' + t('fld.noReq') + ' —'),
    reqs.map((r, i) => h('option', { value: r.id }, reqName(r, i))));
  if (v && !reqs.some((r) => r.id === v)) sel.append(h('option', { value: v }, t('fld.reqMissing')));
  sel.value = v || '';
  sel.addEventListener('change', () => onChange(sel.value || null, false));
  const go = h('button', {
    type: 'button', class: 'ed-iconbtn', title: t('ins.reqManage'), 'aria-label': t('ins.reqManage'), html: icon('plug'),
    onclick: () => { if (S.rightTab !== 'document') setRightTab('document'); openRequestsTab(sel.value || null); },
  });
  return h('div', { class: 'ed-row ed-req-ctl' }, sel, go);
}

export {
  dsRequests,
  openRequestsTab,
  reqControl
};
