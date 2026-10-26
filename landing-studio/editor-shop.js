// landing-studio/editor-shop.js - landing editor: the catalog's SKUs (unique per page, fixed on insert / copy / paste) and the
// Site → Shop settings tab (currency, cart mode, cart storage, checkout and its form fields).
//
// Design rules of this module:
// - The SKU is the cart's primary key: the page runtime stores cart lines by SKU, so two items with one SKU would merge
//   in the cart. Uniqueness is therefore enforced at every entry point (insert, copy, paste, item add) rather than
//   only validated at export, where the user could no longer tell which copy is which.
// - "Selling" is derived from the schema (an item field named 'sku'), never from a hard-coded list of block types: a
//   new catalog-like block becomes shop-aware by declaring the field.
// - Settings are written through docSetter / fieldsBox with an explicit render level: 'all' when the value is printed
//   in the page markup (prices, currency), 'none' for behaviour-only settings, so typing does not rebuild the canvas.
import { uid } from '../util/id.js';
import { clone, h } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { S } from '../studio/state.js';
import { commit } from '../studio/history.js';
import { eachChildList, pickT, typeDef, walk } from '../studio/doc.js';
import { renderFields, section } from '../studio/fields.js';
import { docSetter, fieldsBox, renderDocSettings } from '../studio/right.js';
import { CURRENCIES } from './viewer.js';
import { openRequestsTab } from './editor-requests.js';

// --- SKUs --------------------------------------------------------------------------

// Safe in URLs, JSON keys and CSS/attribute selectors without escaping; 40 chars bounds storage keys.
const SKU_RE = /^[A-Za-z0-9._-]{1,40}$/;

// Does this block type sell items by SKU (an item field 'sku')?
const hasSkuItems = (type) => (typeDef(type).itemSchema || []).some((f) => f && f.key === 'sku');

// Every non-empty SKU of the document → number of items using it.
// Counts, not a Set: skuProblem needs "used more than once", fixSkus needs "used at all".
function skuCounts(doc = S.doc) {
  const m = new Map();
  if (doc) walk((b) => {
    if (!Array.isArray(b.items) || !hasSkuItems(b.type)) return;
    for (const it of b.items) { const s = it && typeof it.sku === 'string' ? it.sku.trim() : ''; if (s) m.set(s, (m.get(s) || 0) + 1); }
  }, doc);
  return m;
}

// A SKU not used yet: 'p-<n>' (new products) or '<base>-<n>' (copies).
// A trailing '-<n>' is stripped first, so copying 'tea-2' yields 'tea-3', not 'tea-2-2'. base is cut to 34 chars so
// base + '-' + up to 5 digits stays within SKU_RE's 40. The uid fallback guarantees termination on absurd inputs.
function freeSku(used, base = '') {
  base = String(base || '').replace(/-\d+$/, '');
  if (!base) { for (let n = 1; ; n++) if (!used.has('p-' + n)) return 'p-' + n; }
  base = base.slice(0, 34);
  for (let n = 2; n < 100000; n++) { const s = `${base}-${n}`; if (!used.has(s)) return s; }
  return 'p-' + uid().slice(0, 8);
}

// Give the items of `block` (and of blocks nested in it) SKUs that do not collide with the rest of `doc`
// (duplicated / pasted blocks). Fresh product items without a SKU get 'p-<n>' when fillEmpty.
// `doc` must not yet contain `block` (it is a pasted / duplicated copy being prepared), otherwise every SKU of the copy
// would count as taken by itself. The first holder of a SKU keeps it; only the newcomer is renamed. fillEmpty is
// limited to 'products': other selling blocks may legitimately have unpriced, non-cart items.
function fixSkus(block, doc = S.doc, fillEmpty = false) {
  const used = skuCounts(doc);
  const visit = (b) => {
    if (Array.isArray(b.items) && hasSkuItems(b.type)) {
      for (const it of b.items) {
        if (!it || typeof it !== 'object') continue;
        const s = typeof it.sku === 'string' ? it.sku.trim() : '';
        if (s && !used.has(s)) { used.set(s, 1); continue; }
        if (s) { it.sku = freeSku(used, s); used.set(it.sku, 1); }
        else if (fillEmpty && b.type === 'products') { it.sku = freeSku(used); used.set(it.sku, 1); }
      }
    }
    eachChildList(b, (l) => l.forEach((c) => c && visit(c)));
  };
  visit(block);
}

// A new / copied item of a selling block gets a SKU nobody else uses (products: 'p-<n>' even when empty).
// Mutates and returns `it`, so callers can wrap item creation inline.
function itemWithSku(block, it) {
  if (!hasSkuItems(block.type) || !it) return it;
  const used = skuCounts();
  const s = typeof it.sku === 'string' ? it.sku.trim() : '';
  if (s) { if (used.has(s)) it.sku = freeSku(used, s); }
  else if (block.type === 'products') it.sku = freeSku(used);
  return it;
}

// Inline warning for a SKU field: invalid characters, or another item uses the same SKU (the first one wins).
function skuProblem(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (!SKU_RE.test(s)) return t('ins.skuBad');
  return (skuCounts().get(s) || 0) > 1 ? t('ins.skuDup') : '';
}
// Normalizer for typed input: spaces become '-', everything outside SKU_RE's alphabet is dropped.
const cleanSku = (v) => String(v ?? '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);

// Does the page sell (a cart block or an item with a SKU)?
// Returning `any` from the walk callback stops the traversal at the first hit.
function docSells(doc = S.doc) {
  let any = false;
  if (doc) walk((b) => {
    if (b.type === 'cart') any = true;
    else if (Array.isArray(b.items) && hasSkuItems(b.type) && b.items.some((it) => it && typeof it.sku === 'string' && it.sku.trim())) any = true;
    return any;
  }, doc);
  return any;
}
const productCount = (doc = S.doc) => skuCounts(doc).size;
const hasType = (type) => { let any = false; walk((b) => { if (b.type === type) any = true; return any; }); return any; };

// --- Site → Shop --------------------------------------------------------------------

// FIELD_KEY_RE: checkout keys become JSON keys of the order payload and form field names, hence lowercase identifiers.
// httpsOK: an external checkout link must be https, a plain http payment page would be a downgrade for the buyer.
const CHECKOUT_TYPES = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox', 'number', 'date'];
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const httpsOK = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
// Checkout field selected in the editor (kept while the panel re-renders).
let coField = null;

function dsShop(body) {
  const shop = S.doc.shop;
  const reqHint = () => (S.doc.requests?.length ? null : h('div', { class: 'ed-row ed-hint-row' },
    h('p', { class: 'ed-hint' }, t('sh.noReqs')),
    h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => openRequestsTab() }, iconEl('plug'), t('ds.requests'))));
  // general: prices are part of the page markup → full render
  const setShop = docSetter('shop', (k, typing) => (typing ? 'none' : 'all'));
  const general = fieldsBox([
    {
      key: 'currency', type: 'text', label: 'sh.currency', inputType: 'text', suggestList: CURRENCIES,
      check: (v) => (/^[A-Z]{3}$/.test(String(v || '')) ? '' : t('sh.currencyBad')),
    },
    { key: 'mode', type: 'select', label: 'sh.mode', noSeg: true, options: ['cart', 'quote'].map((v) => ({ v, l: 'sh.mode.' + v })), hint: 'sh.modeHint' },
    { key: 'cartButton', type: 'select', label: 'sh.cartButton', noSeg: true, options: ['auto', 'nav', 'floating'].map((v) => ({ v, l: 'sh.cb.' + v })) },
  ], 'shop', 'all', '', (k, v, typing) => {
    if (k === 'currency') {
      v = String(v || '').trim().toUpperCase();
      // Invalid codes are not committed: writing 'US' into the document would make price formatting (Intl) throw at render.
      if (!/^[A-Z]{3}$/.test(v)) return; // shown as invalid; the stored code stays until a valid one is typed
    }
    setShop(k, v, typing);
  });
  body.append(section('ds-shop', t('ds.shopGeneral'), general));

  // cart storage: browser (always) → configured requests (remote / local endpoints) with local fallback
  const sync = h('div', {}, h('p', { class: 'ed-hint' }, t('sh.syncHint')), fieldsBox([
    { key: 'sync', type: 'select', label: 'sh.sync', noSeg: true, options: ['local', 'remote'].map((v) => ({ v, l: 'sh.sync.' + v })) },
    { key: 'loadReq', type: 'req', label: 'sh.loadReq', when: { sync: 'remote' } },
    { key: 'saveReq', type: 'req', label: 'sh.saveReq', when: { sync: 'remote' } },
    { key: 'policy', type: 'select', label: 'sh.policy', noSeg: true, when: { sync: 'remote' }, options: ['newest', 'remote', 'local', 'merge'].map((v) => ({ v, l: 'sh.pol.' + v })) },
    { key: 'ttlDays', type: 'number', label: 'sh.ttlDays', min: 1, max: 365, step: 1, unit: t('sh.days') },
  ], 'shop', 'none'), shop.sync === 'remote' ? reqHint() : null);
  body.append(section('ds-sync', t('ds.sync'), sync));

  // checkout
  const co = shop.checkout;
  const m = (o) => o.method;
  const via = (o, x) => o.method === x || (o.method === 'request' && o.fallback === x);
  // Checkout settings appear on the canvas only through a cart block; without one, re-rendering the canvas is wasted.
  const coRender = (k, typing) => (typing || !hasType('cart') ? 'none' : 'all');
  const checkout = h('div', {}, fieldsBox([
    { key: 'method', type: 'select', label: 'sh.method', noSeg: true, options: ['request', 'mailto', 'whatsapp', 'telegram', 'link', 'none'].map((v) => ({ v, l: 'sh.m.' + v })) },
    { key: 'req', type: 'req', label: 'sh.req', when: { method: 'request' } },
    { key: 'fallback', type: 'select', label: 'sh.fallback', noSeg: true, when: { method: 'request' }, options: ['mailto', 'whatsapp', 'telegram', 'none'].map((v) => ({ v, l: 'sh.m.' + v })) },
    { key: 'email', type: 'text', inputType: 'email', label: 'sh.email', placeholderText: 'orders@example.com', show: (o) => via(o, 'mailto'), deps: ['method', 'fallback'] },
    { key: 'phone', type: 'text', inputType: 'tel', label: 'sh.phone', placeholderText: '+995 555 12 34 56', show: (o) => via(o, 'whatsapp'), deps: ['method', 'fallback'] },
    { key: 'telegram', type: 'text', label: 'sh.telegram', placeholderText: 'shop_bot', show: (o) => via(o, 'telegram'), deps: ['method', 'fallback'] },
    { key: 'url', type: 'text', inputType: 'url', label: 'sh.url', placeholderText: 'https://', show: (o) => m(o) === 'link', deps: ['method'], check: (v) => (!v || httpsOK(v) ? '' : t('sh.urlBad')) },
    { key: 'note', type: 'i18n', label: 'sh.note', multiline: true, rows: 2, show: (o) => m(o) !== 'none', deps: ['method'] },
    { key: 'success', type: 'i18n', label: 'sh.success', multiline: true, rows: 2, show: (o) => m(o) !== 'none', deps: ['method'] },
    { key: 'minTotal', type: 'number', label: 'sh.minTotal', min: 0, max: 1e9, step: 1, unit: shop.currency, show: (o) => m(o) !== 'none', deps: ['method'] },
  ], 'shop.checkout', coRender), co.method === 'request' && !S.doc.requests?.length ? reqHint() : null);
  body.append(section('ds-checkout', t('ds.checkout'), checkout));
  if (co.method !== 'none') body.append(section('ds-co-fields', t('ds.coFields'), coFieldsUI()));
}

// Checkout fields: the same item shape as form block fields (key, type, label, ph, options, required, half).
// Fields are addressed by index (coField); safe because every structural op re-renders the list and re-sets coField
// to the moved / inserted position. `op` commits into the draft `d` and lazily creates the array for old documents.
function coFieldsUI() {
  const fields = () => (Array.isArray(S.doc.shop?.checkout?.fields) ? S.doc.shop.checkout.fields : []);
  const list = fields();
  const render = () => (hasType('cart') ? 'all' : 'none');
  const op = (label, fn, sel) => {
    commit(label, (d) => { const co = d.shop.checkout; if (!Array.isArray(co.fields)) co.fields = []; fn(co.fields); }, { render: render() });
    coField = sel;
    renderDocSettings();
  };
  // Same '_<n>' suffix scheme as freeSku; cut to 26 so key + '_' + digits fits FIELD_KEY_RE's 31-char limit.
  const freeKey = (base) => {
    const used = new Set(fields().map((f) => f.key));
    base = String(base || 'field').replace(/_\d+$/, '').slice(0, 26) || 'field';
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
  };
  const label = (f, i) => pickT(f.label) || f.key || t('sh.fieldN', { n: i + 1 });
  const wrap = h('div', {});
  if (!list.length) wrap.append(h('p', { class: 'ed-muted' }, t('sh.noFields')));
  else {
    const ol = h('ol', { class: 'ed-items', role: 'list' });
    list.forEach((f, i) => {
      const on = coField === i;
      ol.append(h('li', { class: 'ed-item-row' + (on ? ' ed-on' : '') },
        h('button', { type: 'button', class: 'ed-item-label', 'aria-pressed': String(on), onclick: () => { coField = on ? null : i; renderDocSettings(); } },
          label(f, i), f.required ? h('span', { class: 'ed-req-mark', 'aria-hidden': 'true' }, ' *') : null,
          h('small', { class: 'ed-muted' }, ' · ' + t('sh.ft.' + (CHECKOUT_TYPES.includes(f.type) ? f.type : 'text')))),
        h('span', { class: 'ed-item-acts' },
          h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('sh.fUp'), 'aria-label': t('sh.fUp'), disabled: i === 0, html: icon('up'), onclick: () => op('checkout field up', (a) => a.splice(i - 1, 0, a.splice(i, 1)[0]), i - 1) }),
          h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('sh.fDown'), 'aria-label': t('sh.fDown'), disabled: i === list.length - 1, html: icon('down'), onclick: () => op('checkout field down', (a) => a.splice(i + 1, 0, a.splice(i, 1)[0]), i + 1) }),
          h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('sh.fDup'), 'aria-label': t('sh.fDup'), html: icon('copy'), onclick: () => op('checkout field dup', (a) => { const c = clone(a[i]); c.key = freeKey(c.key); if ('id' in c) c.id = uid(); a.splice(i + 1, 0, c); }, i + 1) }),
          h('button', { type: 'button', class: 'ed-iconbtn ed-sm ed-danger', title: t('sh.fDel'), 'aria-label': t('sh.fDel'), html: icon('trash'), onclick: () => op('checkout field del', (a) => a.splice(i, 1), null) }))));
    });
    wrap.append(ol);
  }
  wrap.append(h('button', {
    type: 'button', class: 'ed-btn ed-block-btn', onclick: () => {
      const at = coField != null && coField < list.length ? coField + 1 : list.length;
      op('checkout field add', (a) => a.splice(at, 0, { id: uid(), key: freeKey('field'), type: 'text', label: {}, ph: {}, options: {}, required: false, half: false }), at);
    },
  }, iconEl('plus'), t('sh.fAdd')));
  const i = coField;
  const cur = i != null ? list[i] : null;
  if (cur) {
    const ed = h('div', { class: 'ed-item-editor' }, h('div', { class: 'ed-item-editor-h' }, h('strong', {}, label(cur, i)), h('span', { class: 'ed-spacer' }),
      h('button', { type: 'button', class: 'ed-iconbtn ed-sm', title: t('ins.itemClose'), 'aria-label': t('ins.itemClose'), html: icon('close'), onclick: () => { coField = null; renderDocSettings(); } })));
    const flds = h('div', { class: 'ed-fields' });
    const keyProblem = (v) => {
      const s = String(v ?? '').trim();
      if (!FIELD_KEY_RE.test(s)) return t('sh.fKeyBad');
      return fields().some((f, j) => j !== i && f.key === s) ? t('sh.fKeyDup') : '';
    };
    renderFields(flds, [
      { key: 'key', type: 'text', label: 'sh.fKey', check: keyProblem },
      { key: 'type', type: 'select', label: 'sh.fType', noSeg: true, options: CHECKOUT_TYPES.map((v) => ({ v, l: 'sh.ft.' + v })) },
      { key: 'label', type: 'i18n', label: 'sh.fLabel' },
      { key: 'ph', type: 'i18n', label: 'sh.fPh', show: (o) => o.type !== 'checkbox' && o.type !== 'select', deps: ['type'] },
      { key: 'options', type: 'i18n', label: 'sh.fOptions', multiline: true, rows: 4, when: { type: 'select' } },
      { key: 'required', type: 'checkbox', label: 'sh.fRequired' },
      { key: 'half', type: 'checkbox', label: 'sh.fHalf' },
    ], () => fields()[i], (k, v, typing) => {
      if (k === 'key') {
        v = String(v ?? '').trim();
        if (!FIELD_KEY_RE.test(v) || fields().some((f, j) => j !== i && f.key === v)) return; // shown as invalid
      }
      commit('checkout field ' + k, (d) => { const f = d.shop.checkout.fields?.[i]; if (f) f[k] = v; },
        { render: typing ? 'none' : render(), coalesce: typing ? `cofield:${i}:${k}` : null });
      // Patches the list row label in place (first text node) instead of re-rendering, which would steal focus from the
      // field being typed into.
      const lab = wrap.querySelector('.ed-items > li:nth-child(' + (i + 1) + ') .ed-item-label');
      if (lab && (k === 'label' || k === 'key') && lab.firstChild) lab.firstChild.textContent = label(fields()[i] || {}, i);
    }, { rerender: () => renderDocSettings() });
    ed.append(flds);
    wrap.append(ed);
  }
  return wrap;
}

export {
  cleanSku,
  docSells,
  dsShop,
  fixSkus,
  hasSkuItems,
  itemWithSku,
  productCount,
  skuProblem
};
