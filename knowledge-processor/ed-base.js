// knowledge-processor/ed-base.js - settings of the whole knowledge base (left column, "Base" tab): title, tagline,
// languages, home page, theme (five designs) and accent, logo, top navigation, footer and license, toggle layers and the
// furigana / ruby layer, categories, reader features, and the key derivation of 451 content.
//
// Design rules:
// - Every edit goes through commit() from state.js, so it is undoable, marks the base dirty and schedules a save.
//   `key` coalesces keystrokes in one field into one undo step (state.js merges commits with the same key within
//   1.2 s); `structure: true` asks main.js for a full repaint (needed when other panels show the changed value,
//   e.g. theme, reader language, home page).
// - The panel is rebuilt from S.kb on structural changes only; text fields keep their own DOM state while typing.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { langLabel } from '../ui/lang.js';
import { S, commit } from './state.js';
import { THEMES, UI_LANGS, cleanLayerId, cleanSlug, DEFAULT_SETTINGS } from './model.js';
import { check, colorEl, input, linkInput, markupArea, numInput, row, selectEl } from './ed-fields.js';
import { mediaPicker } from './ed-media.js';
import { pageLabel } from './ed-pages.js';

// Collapsible section on native <details>: keyboard and screen-reader support for free, open state kept by
// main.js paintLeft across rebuilds.
const sec = (title, open, ...kids) => h('details', { class: 'ed-sec', open }, h('summary', { class: 'ed-sec-h' }, iconEl('chevRight'), title), h('div', { class: 'ed-sec-b' }, ...kids));
// Field setter factory: commit with a per-field coalescing key ('kb.title'), so typing a title is one undo step.
const set = (k, key) => (v) => commit((kb) => { kb[k] = v; }, { key: key || 'kb.' + k });
// Swatch colours per theme: [background, accent, text]. A hand-kept copy of key colours, so the editor need
// not load the reader stylesheet for five thumbnails. Must list every id in model.js THEMES, or the destructuring
// below throws on an unknown theme.
const THEME_SWATCH = { encyclopedia: ['#fff', '#3366cc', '#202122'], 'fandom-dark': ['#0d1117', '#f59e0b', '#e6e9ef'], magazine: ['#fff', '#be123c', '#1a1a1a'], minimal: ['#fff', '#2563eb', '#18181b'], scholarly: ['#fbf8f1', '#8a3b12', '#2b2620'] };

// Generic repeatable-row editor (nav links, layers, categories). Keeps a private working copy `data` so a row that is
// still empty survives (the commit callbacks filter empty rows out of the base, the editor must not).
// fields: [key, kind, placeholder]; kind 'link' | 'bool' | 'text' (markup) | anything else = one-line input.
function listRows(items, fields, onChange, addLabel) {
  const box = h('div', { class: 'kp-rows' });
  let data = items.map((x) => ({ ...x }));
  const paint = () => {
    box.replaceChildren(...data.map((it, i) => h('div', { class: 'kp-rowitem' },
      ...fields.map(([k, kind, ph]) => {
        // Copies passed to onChange: the base must never share objects with this working copy.
        const upd = (v) => { data[i][k] = v; onChange(data.map((x) => ({ ...x }))); };
        if (kind === 'link') return linkInput(it[k], upd);
        if (kind === 'bool') return h('label', { class: 'kp-row kp-tiny' }, check(it[k], upd), ph);
        if (kind === 'text') return markupArea(it[k], upd, { rows: 2, toolbar: false });
        return input(it[k], upd, { placeholder: ph });
      }),
      h('span', { class: 'kp-row-a' },
        // KNOWN DEFECT: move-up and remove pass `data` itself (not copies, unlike upd above). Callbacks that keep the row
        // objects (nav: v.filter(...)) then store the same objects in S.kb, and a later keystroke mutates S.kb through
        // data[i][k] = v before commit() takes its undo snapshot: that edit bypasses undo and the dirty flag.
        // Fix: onChange(data.map((x) => ({ ...x }))) in both handlers.
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', 'aria-label': t('kp.moveUp'), disabled: i === 0, onclick: () => { [data[i - 1], data[i]] = [data[i], data[i - 1]]; onChange(data); paint(); } }, iconEl('up')),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', 'aria-label': t('kp.remove'), onclick: () => { data.splice(i, 1); onChange(data); paint(); } }, iconEl('trash'))))),
    h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { const o = {}; for (const [k, kind] of fields) o[k] = kind === 'bool' ? true : ''; data.push(o); onChange(data); paint(); } }, iconEl('plus'), addLabel));
  };
  paint();
  return box;
}

// Content languages: a fixed list of common codes; an imported base with another code keeps it as an extra option
// (concat below), so opening such a base never silently rewrites its language.
export function renderBasePanel(box) {
  const kb = S.kb;
  const langs = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka', 'ja', 'zh', 'it', 'pl', 'pt', 'tr', 'ar', 'he', 'hi', 'sa', 'el', 'la', 'hy', 'az', 'be', 'kk'];
  // Theme picker as an ARIA radiogroup of buttons: one choice of five, announced with checked state.
  const themes = h('div', { class: 'kp-themes', role: 'radiogroup', 'aria-label': t('kp.theme') }, THEMES.map((th) => {
    const [bg, ac, fg] = THEME_SWATCH[th];
    const b = h('button', { type: 'button', role: 'radio', class: 'kp-theme' + (kb.theme === th ? ' kp-on' : ''), 'aria-checked': String(kb.theme === th),
      onclick: () => { commit((k) => { k.theme = th; }, { structure: true }); } },
    h('span', { class: 'kp-theme-sw', style: { background: bg, color: fg, borderColor: ac } }, h('i', { style: { background: ac } }), h('b', {}, 'Aa')), h('span', {}, t('theme.' + th)));
    return b;
  }));
  // Boolean reader features are generated from DEFAULT_SETTINGS: adding a flag in model.js adds its checkbox here
  // (label key 'set.<flag>'), no second list to keep in sync. Non-boolean settings (toc, tocMin) get explicit rows.
  const settingsBox = h('div', { class: 'kp-feats' }, Object.keys(DEFAULT_SETTINGS).filter((k) => typeof DEFAULT_SETTINGS[k] === 'boolean').map((k) =>
    h('label', { class: 'kp-row kp-tiny' }, check(kb.settings[k], (v) => commit((x) => { x.settings[k] = v; }, { structure: false })), t('set.' + k))));
  const kdf = kb.kdf;
  box.replaceChildren(
    h('div', { class: 'kp-panel-h' }, h('h2', {}, t('kp.base'))),
    sec(t('kp.general'), true,
      row(t('kp.baseTitle'), input(kb.title, set('title'))),
      row(t('kp.tagline'), input(kb.tagline, set('tagline'))),
      row(t('kp.contentLang'), selectEl(langs.map((l) => ({ v: l, l: langLabel(l) + ' (' + l + ')' })).concat(langs.includes(kb.lang) ? [] : [{ v: kb.lang, l: kb.lang }]), kb.lang, set('lang')), t('kp.contentLangHint')),
      row(t('kp.readerLang'), selectEl(UI_LANGS.map((l) => ({ v: l, l: langLabel(l) })), kb.uiLang, (v) => commit((k) => { k.uiLang = v; }, { structure: true })), t('kp.readerLangHint')),
      // Home page choices: only public pages. A 451 page as home would show a locked screen to every visitor.
      row(t('kp.homePage'), selectEl(kb.pages.filter((p) => p.access === 'public').map((p) => ({ v: p.id, l: pageLabel(p) })), kb.home, (v) => commit((k) => { k.home = v; }, { structure: true })))),
    sec(t('kp.look'), true,
      themes,
      row(t('kp.accent'), colorEl(kb.accent, set('accent')), t('kp.accentHint')),
      row(t('kp.logo'), mediaPicker(kb.logo, (v) => commit((k) => { k.logo = v; }), { accept: 'image' }))),
    sec(t('kp.navigation'), false,
      h('p', { class: 'ed-hint' }, t('kp.navHint')),
      listRows(kb.nav, [['label', 'line', t('kp.label')], ['link', 'link']], (v) => commit((k) => { k.nav = v.filter((n) => n.label || n.link); }, { key: 'nav' }), t('kp.addLink'))),
    sec(t('kp.footer'), false,
      row(t('kp.footerText'), markupArea(kb.footer, set('footer'), { rows: 3 })),
      row(t('kp.license'), markupArea(kb.license, set('license'), { rows: 2, multiline: false }))),
    // Layers: ids are derived from labels once and then kept (l.id wins), so renaming a layer does not orphan
    // the content marked with the old id. Collisions get a '2' suffix until unique.
    sec(t('kp.layers'), false,
      h('p', { class: 'ed-hint' }, t('kp.layersHint')),
      listRows(kb.layers, [['label', 'line', t('kp.layerName')], ['on', 'bool', t('kp.onByDefault')]], (v) => commit((k) => {
        const taken = new Set();
        k.layers = v.filter((l) => l.label || l.id).map((l) => {
          let id = l.id || cleanLayerId(l.label) || 'layer';
          while (taken.has(id)) id += '2';
          taken.add(id);
          return { id, label: l.label || id, on: l.on !== false };
        });
      }, { key: 'layers' }), t('kp.newLayer')),
      h('p', { class: 'ed-hint' }, kb.layers.map((l) => `${l.label}: ${l.id}`).join(' · ')),
      row(t('kp.rubyLayer'), selectEl([{ v: '', l: t('kp.noLayer') }, ...kb.layers.map((l) => ({ v: l.id, l: l.label }))], kb.ruby, set('ruby')), t('kp.rubyHint'))),
    // Categories: slug is the identity (pages reference it); a duplicate slug row is dropped rather than merged.
    sec(t('kp.categories'), false,
      listRows(kb.cats, [['name', 'line', t('kp.categoryName')], ['desc', 'text']], (v) => commit((k) => {
        const seen = new Set();
        k.cats = v.filter((c) => c.name || c.slug).map((c) => {
          const slug = c.slug || cleanSlug(c.name);
          if (seen.has(slug)) return null;
          seen.add(slug);
          return { slug, name: c.name || slug, desc: c.desc || '' };
        }).filter(Boolean);
      }, { key: 'cats' }), t('kp.newCategory'))),
    sec(t('kp.features'), false, settingsBox,
      row(t('set.toc'), selectEl(['auto', 'on', 'off'].map((v) => ({ v, l: t('o.toc.' + v) })), kb.settings.toc, (v) => commit((k) => { k.settings.toc = v; }))),
      // Clamped on write: the field may hold any typed number, the stored value stays in range.
      row(t('set.tocMin'), numInput(kb.settings.tocMin, (v) => commit((k) => { k.settings.tocMin = Math.max(1, Math.min(20, v || 3)); }, { key: 'tocMin' }), { min: 1, max: 20 }))),
    // Key derivation for 451 content. Switching algorithm resets parameters to defaults: Argon2id t=2, m=19456 KiB,
    // p=1 (OWASP minimum recommendation), PBKDF2-SHA256 600000 iterations (OWASP 2023). Only newly sealed content uses
    // the new setting; existing envelopes carry their own parameters. Clamps keep the reader usable (memory cost
    // <= 256 MiB on phones) and refuse trivially weak values.
    sec(t('kp.security'), false,
      h('p', { class: 'ed-hint' }, t('kp.kdfHint')),
      row(t('kp.kdf'), selectEl([{ v: 'argon2id', l: 'Argon2id' }, { v: 'pbkdf2-sha256', l: 'PBKDF2-SHA256' }], kdf.a, (v) => commit((k) => { k.kdf = v === 'argon2id' ? { a: v, t: 2, m: 19456, p: 1 } : { a: v, i: 600000 }; }, { structure: true }))),
      kdf.a === 'argon2id' ? h('div', { class: 'kp-pset-row' },
        row(t('kp.kdfT'), numInput(kdf.t, (v) => commit((k) => { k.kdf.t = Math.max(1, Math.min(10, v || 2)); }, { key: 'kt' }), { min: 1, max: 10 })),
        row(t('kp.kdfM'), numInput(kdf.m, (v) => commit((k) => { k.kdf.m = Math.max(1024, Math.min(262144, v || 19456)); }, { key: 'km' }), { min: 1024, max: 262144, step: 1024 })))
        : row(t('kp.kdfI'), numInput(kdf.i, (v) => commit((k) => { k.kdf.i = Math.max(10000, Math.min(5000000, v || 600000)); }, { key: 'ki' }), { min: 10000, max: 5000000, step: 10000 }))));
}
