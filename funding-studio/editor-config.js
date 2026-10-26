// funding-studio/editor-config.js - the funding editor configuration (studio/config.js): device-width stage with the
// page switcher, settings tabs (campaigns, payments, server, theme, organisation, languages, output, SEO), field
// controls of the campaign and block schemas (currency, extra currencies, payment methods, campaign picker, amount
// list, share targets, page address), block style fields, link targets and the export packages.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { langLabel } from '../ui/lang.js';
import { setBlockProp } from '../studio/inspector.js';
import { deviceStage } from '../studio/stage.js';
import { section } from '../studio/fields.js';
import { fieldsBox, fontOptions, langsTab, metaTab, presetCards, resetThemeButton, themeRender, uploadFontButton } from '../studio/right.js';
import { walk } from '../studio/doc.js';
import { COMMON_CURRENCIES } from '../payments/money.js';
import { DEVICES, FONT_STACKS, METHODS, SHARE_NETS, normAmounts } from './viewer.js';
import { CAMPAIGN_EDITOR, dsCampaigns, pageStage, pagesOf, slugControl, syncBar } from './editor-campaigns.js';
import { dsPayments } from './editor-pay.js';
import { dsServer } from './editor-server.js';
import { EXPORT_MODES, exportCheck } from './editor-export.js';

// Document settings tabs: thin declarative field lists over shared studio widgets (fieldsBox binds each key to a
// path in the document and commits changes); themeRender re-renders the canvas CSS only, not the blocks.
function dsTheme(body) {
  body.append(presetCards((v) => [v.accent, v.accent2, v.surface, v.text], (v) => v.bg));
  const colors = fieldsBox(['accent', 'accent2', 'bg', 'surface', 'text', 'muted', 'border'].map((key) => ({ key, type: 'color', noClear: true, label: 'th.' + key })), 'theme', themeRender, 'ed-grid2');
  body.append(section('ds-colors', t('ds.colors'), h('div', {}, colors, resetThemeButton())));
  const fo = fontOptions();
  const typo = fieldsBox([
    { key: 'fontBody', type: 'select', options: fo, noSeg: true, label: 'th.fontBody' },
    { key: 'fontHead', type: 'select', options: fo, noSeg: true, label: 'th.fontHead' },
    { key: 'baseSize', type: 'range', min: 14, max: 22, step: 0.5, unit: ' px', label: 'th.baseSize' },
  ], 'theme', themeRender);
  typo.append(uploadFontButton());
  body.append(section('ds-typo', t('ds.typography'), typo));
  body.append(section('ds-look', t('ds.look'), fieldsBox([
    { key: 'radius', type: 'range', min: 0, max: 28, step: 1, unit: ' px', label: 'th.radius' },
    { key: 'buttons', type: 'select', label: 'th.buttons', options: ['solid', 'pill', 'square'].map((v) => ({ v, l: 'th.btn.' + v })) },
    { key: 'width', type: 'range', min: 880, max: 1440, step: 10, unit: ' px', label: 'th.width' },
    { key: 'scheme', type: 'select', label: 'th.scheme', options: ['light', 'auto', 'dark'].map((v) => ({ v, l: 'th.sc.' + v })) },
  ], 'theme', themeRender)));
}

function dsOrg(body) {
  body.append(h('p', { class: 'ed-hint' }, t('og.intro')));
  body.append(section('ds-org', t('og.title'), fieldsBox([
    { key: 'name', type: 'i18n', label: 'og.name' },
    { key: 'address', type: 'i18n', label: 'og.address' },
    { key: 'regNo', type: 'text', label: 'og.regNo' },
    { key: 'email', type: 'text', inputType: 'email', label: 'og.email' },
    { key: 'website', type: 'text', inputType: 'url', label: 'og.website', placeholderText: 'https://' },
    { key: 'note', type: 'i18n', label: 'og.note', hint: 'og.noteH', multiline: true, rows: 3 },
  ], 'org', 'all')));
}

function dsOutput(body) {
  body.append(section('ds-out', t('ds.output'), fieldsBox([
    { key: 'autodetect', type: 'checkbox', label: 'op.autodetect' },
    { key: 'switcher', type: 'select', label: 'op.switcher', options: ['buttons', 'select', 'none'].map((v) => ({ v, l: 'op.sw.' + v })) },
    { key: 'themeToggle', type: 'checkbox', label: 'op.themeToggle' },
    { key: 'uiFallback', type: 'select', label: 'op.uiFallback', noSeg: true, options: ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka'].map((v) => ({ v, text: langLabel(v) })) },
  ], 'output')));
}

const dsMeta = metaTab([
  { key: 'title', type: 'i18n', label: 'seo.title' },
  { key: 'description', type: 'i18n', label: 'seo.description', multiline: true, rows: 3 },
  { key: 'author', type: 'text', label: 'seo.author' },
  { key: 'keywords', type: 'text', label: 'seo.keywords' },
  { key: 'favicon', type: 'att', label: 'seo.favicon', accept: 'image/' },
]);

/* ---------- field controls ---------- */

// Field controls plug custom widgets into the generic inspector. Currency: free text with a datalist of common codes;
// valid codes apply while typing (onChange(c, true) = coalesced), an invalid value reverts on blur.
function currencyControl(f, v, onChange, id) {
  const inp = h('input', { type: 'text', id, class: 'ed-input ed-mono', maxlength: '3', list: id + '-l', value: v || 'EUR', autocomplete: 'off',
    oninput: (e) => { const c = e.target.value.toUpperCase(); if (/^[A-Z]{3}$/.test(c)) onChange(c, true); },
    onchange: (e) => { const c = e.target.value.toUpperCase(); if (/^[A-Z]{3}$/.test(c)) onChange(c); else e.target.value = v || 'EUR'; } });
  return h('div', {}, inp, h('datalist', { id: id + '-l' }, COMMON_CURRENCIES.map((c) => h('option', { value: c }))));
}

function currenciesControl(f, v, onChange, id) {
  return h('input', { type: 'text', id, class: 'ed-input ed-mono', value: (v || []).join(', '), placeholder: 'USD, GEL',
    onchange: (e) => onChange([...new Set(e.target.value.toUpperCase().split(/[\s,;]+/).filter((x) => /^[A-Z]{3}$/.test(x)))]) });
}

// Checkbox list in a fixed order; at least one stays on.
// Re-adding keeps the canonical order (filter over `all`), so the stored list order never depends on click order.
// KNOWN DEFECT: the "at least one stays on" promise is not enforced - clicking the last selected chip yields [] (and
// normCampaign keeps an empty methods array). Fix: ignore the click when `on && sel.length === 1`, as the ETH chips
// in editor-pay.js do.
function multiControl(all, labelOf) {
  return (f, v, onChange, id) => {
    const sel = Array.isArray(v) ? v.slice() : [];
    const wrap = h('div', { class: 'ed-chips', id, role: 'group' });
    for (const m of all) {
      const on = sel.includes(m);
      wrap.append(h('button', { type: 'button', class: 'ed-chip' + (on ? ' ed-on' : ''), 'aria-pressed': String(on), onclick: () => {
        const next = on ? sel.filter((x) => x !== m) : all.filter((x) => sel.includes(x) || x === m);
        onChange(next);
      } }, labelOf(m)));
    }
    return wrap;
  };
}

function campaignControl(f, v, onChange, id) {
  const sel = h('select', { id, class: 'ed-input ed-select', onchange: (e) => onChange(e.target.value) },
    h('option', { value: '' }, t('fld.thisCampaign')),
    pagesOf().filter((p) => p.kind === 'campaign').map((p) => h('option', { value: p.id, selected: p.id === v }, (Object.values(p.title || {})[0] || p.slug))));
  return sel;
}

function amountsControl(f, v, onChange, id) {
  return h('input', { type: 'text', id, class: 'ed-input ed-mono', value: (v || []).join(', '), placeholder: '10, 25, 50, 100',
    onchange: (e) => { const a = normAmounts(e.target.value); if (a.length) onChange(a); } });
}

const DEVICE_ICONS = { desktop: 'monitor', tablet: 'tablet', phone: 'phone' };

export const FUNDING_EDITOR = {
  fileExt: 'funding',
  categories: ['campaign', 'content', 'layout', 'structure'],
  fontStacks: FONT_STACKS,
  stage: pageStage(deviceStage(Object.entries(DEVICES).map(([k, w]) => [k, w, DEVICE_ICONS[k] || 'monitor']))),
  typeIcons: {
    nav: 'menu', footer: 'footer', section: 'section', columns: 'columns', text: 'type', image: 'image', quote: 'quote', divider: 'divider',
    campaigns: 'grid', hero: 'hero', story: 'doc', progress: 'chart', donate: 'tag', tiers: 'award', impact: 'sparkle', wall: 'users',
    updates: 'timeline', faq: 'help', matching: 'zap', countdown: 'refresh', transparency: 'sheet', share: 'link', thanks: 'star', campaign: 'file',
  },
  docTabs: [['campaigns', 'ds.campaigns', dsCampaigns], ['payments', 'ds.payments', dsPayments], ['server', 'ds.server', dsServer], ['theme', 'ds.theme', dsTheme],
    ['org', 'ds.org', dsOrg], ['langs', 'ds.langs', langsTab], ['output', 'ds.output', dsOutput], ['meta', 'ds.seo', dsMeta]],
  themeMarkupKeys: ['preset', 'buttons'],
  commonFields: [
    { key: 'hidden', type: 'checkbox', label: 'f.hidden', show: (b) => b.type !== 'campaign' },
    { key: 'hidden', type: 'checkbox', label: 'cp.toggleDraft', show: (b) => b.type === 'campaign' },
    { key: 'langs', type: 'langs', show: (b) => b.type !== 'campaign' },
    { key: 'device', type: 'select', options: [{ v: 'all' }, { v: 'desktop' }, { v: 'mobile' }], show: (b) => b.type !== 'campaign' },
  ],
  styleFields: [
    { key: 'mt', type: 'number', min: 0, max: 240, step: 4, unit: 'px', nullable: true },
    { key: 'mb', type: 'number', min: 0, max: 240, step: 4, unit: 'px', nullable: true },
    { key: 'pad', type: 'number', min: 0, max: 160, step: 4, unit: 'px', nullable: true, wide: true },
    { key: 'bg', type: 'color' },
    { key: 'color', type: 'color' },
    { key: 'align', type: 'select', options: [{ v: '', l: 'fld.default' }, { v: 'left' }, { v: 'center' }, { v: 'right' }], wide: true },
  ],
  fieldControls: {
    pageslug: slugControl, currency: currencyControl, currencies: currenciesControl, campaign: campaignControl, amounts: amountsControl,
    methods: multiControl(METHODS, (m) => t('m.' + m)), nets: multiControl(SHARE_NETS, (n) => t('net.' + n)),
  },
  blockMenu: (b) => {
    const dev = b.device || 'all';
    if (b.type === 'campaign') return [];
    return ['all', 'desktop', 'mobile'].map((d) => ({ label: t('blk.dev.' + d), checked: dev === d, action: () => setBlockProp(b.id, 'device', d) }));
  },
  statusItems: (doc) => {
    let n = 0;
    walk((b) => { if (b.type === 'donate') n++; }, doc);
    queueMicrotask(syncBar);
    const camps = pagesOf(doc).filter((p) => p.kind === 'campaign').length;
    return [h('span', { class: 'ed-st-item' }, iconEl('file'), t('st.camps', { n: camps })), n ? null : h('span', { class: 'ed-st-item ed-warn' }, iconEl('warn'), t('st.noDonate'))].filter(Boolean);
  },
  ...CAMPAIGN_EDITOR,
  i18nRoots: (doc) => [doc.org, doc.pay && doc.pay.bank],
  metaAttKeys: ['favicon'],
  exportModes: EXPORT_MODES,
  exportCheck,
};
