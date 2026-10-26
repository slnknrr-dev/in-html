// readme-editor/badge-dialog.js - the shields.io badge builder: kind (static or a preset of GitHub, Codeberg / Gitea,
// npm, PyPI, crates.io, Docker, Codecov, Discord, website, dynamic JSON, own path) with its variables, colours with
// swatches and pickers, label colour, style, logo, link, alt text, Markdown / HTML; the URL is editable both ways. The
// preview is drawn locally (badge/svg.js); the live picture from shields.io only when remote images are allowed.
//
// Model: one mutable object m (the parsed shields.io URL: kind, label, message, vars, params, colours, style, logo).
// Every control writes into m and calls upd(), which derives URL, code and previews from m. The URL field is the
// one inverse path: typing a URL re-parses it into m and pushes m back into every control. Two-way binding
// without a loop: upd() does not overwrite the URL field while it has focus.
// Privacy: the local preview is an SVG data URI drawn by badge/svg.js; the real shields.io image is requested only
// when remote images are allowed (S.remote), because loading it reveals the user's IP and README to a third party.

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { seg, select } from '../ui/app.js';
import { openDialog } from '../ui/overlays.js';
import { PRESETS, STYLES, COLORS, colorHex, parseShields, buildShields, presetVars, localLabel } from '../badge/shields.js';
import { badgeDataURI } from '../badge/svg.js';
import { S } from './doc.js';
import { buildMedia } from './dialogs.js';

// Shields.io named colours (the subset with distinct hues); COLORS maps them to hex for the swatch backgrounds.
// LOGOS: simple-icons slugs suggested through a <datalist>; any other slug can still be typed.
const SWATCHES = ['brightgreen', 'green', 'yellowgreen', 'yellow', 'orange', 'red', 'blue', 'blueviolet', 'pink', 'lightgrey', 'grey', 'black', 'teal'];
const LOGOS = 'github gitea forgejo codeberg gitlab git markdown python javascript typescript rust go cplusplus c csharp java kotlin swift php ruby lua dart elixir haskell zig nodedotjs deno bun react vuedotjs angular svelte vite tailwindcss html5 css3 docker kubernetes linux ubuntu debian archlinux windows apple android npm pypi githubactions gnubash powershell neovim vim postgresql sqlite mongodb redis nginx telegram discord matrix mastodon youtube liberapay kofi patreon opensourceinitiative creativecommons'.split(' ');

// A wrapping <label> names its control without ids. Caveat: around a composite control (colorRow: text + colour
// picker + swatches) the label is associated with its first labelable descendant only.
// '=' prefix = literal text (variable names), otherwise an i18n key: same convention as seg()/select() in ui/app.js.
const field = (key, control) => h('label', { class: 'ed-field ed-field-col re-f' }, h('span', { class: 'ed-label' }, key[0] === '=' ? key.slice(1) : t(key)), control);
const input = (value = '', attrs = {}) => h('input', { class: 'ed-input', value, spellcheck: 'false', ...attrs });

// Text, native colour picker and swatches stay in sync through sync(). <input type=color> only accepts #rrggbb,
// so named colours are converted with colorHex(..., fallback) and sliced to 7 chars (drops an alpha suffix).
// The picker writes hex without '#', which is the shields.io URL form.
// row.set(): external update without firing onChange (used when a pasted URL replaces the whole model).
function colorRow(value, onChange) {
  const txt = input(value, { placeholder: 'brightgreen / ff69b4' });
  const pick = h('input', { type: 'color', class: 'ap-color', value: colorHex(value, '#007ec6').slice(0, 7) });
  const sw = h('div', { class: 're-swatches' }, SWATCHES.map((c) => h('button', { type: 'button', title: c, dataset: { c }, style: { background: COLORS[c] }, onclick: () => { txt.value = c; sync(); } })));
  const sync = () => { for (const b of sw.children) b.classList.toggle('re-on', b.dataset.c === txt.value); pick.value = colorHex(txt.value, '#007ec6').slice(0, 7); onChange(txt.value.trim()); };
  txt.addEventListener('input', sync);
  pick.addEventListener('input', () => { txt.value = pick.value.slice(1); sync(); });
  const row = h('div', { class: 're-col' }, h('div', { class: 're-row' }, txt, pick), sw);
  row.set = (v) => { txt.value = v || ''; for (const b of sw.children) b.classList.toggle('re-on', b.dataset.c === txt.value); };
  row.set(value);
  return row;
}

// media: parsed image (dialogs.js parseMedia) of an existing badge, or null for a new one.
export async function badgeDialog(media, { existing = false } = {}) {
  // New badge: start from a static "build | passing" so the preview is never empty.
  let m = (media && parseShields(media.src)) || { ...parseShields(buildShields({ kind: 'static', label: 'build', message: 'passing', color: 'brightgreen' })) };
  let fmt = media ? media.fmt : 'md';
  const kind = select(PRESETS.map((p) => ({ v: p.id, l: 'badge.' + p.id })), m.kind, (v) => { m.kind = v; kindUI(); upd(); });
  const label = input(m.label, { placeholder: 'build' }), message = input(m.message, { placeholder: 'passing' });
  const path = input(m.path, { placeholder: '/github/stars/user/repo' });
  const labelOv = input(m.labelOverride);
  const vars = h('div', { class: 're-grid2' });
  const color = colorRow(m.color, (v) => { m.color = v; upd(); });
  const labelColor = colorRow(m.labelColor, (v) => { m.labelColor = v; upd(); });
  const style = seg(STYLES.map((s) => ({ v: s, l: '=' + (s || 'flat') })), m.style, (v) => { m.style = v; upd(); });
  const logo = input(m.logo, { list: 're-logos', placeholder: 'github, rust…' });
  const logoColor = input(m.logoColor, { placeholder: 'white' });
  const link = input(media ? media.link : '', { placeholder: 'https://…' }), alt = input(media ? media.alt : '');
  const url = input('', { class: 'ed-input re-mono' });
  const code = h('textarea', { class: 'ed-input ed-textarea re-mono', rows: 3, readonly: true });
  const prev = h('div', { class: 're-badge-prev' });
  const note = h('div', { class: 'ed-hint' });
  const staticBox = h('div', { class: 're-grid2' }, field('badge.label', label), field('badge.message', message));
  const customBox = field('badge.path', path), ovBox = field('badge.labelOverride', labelOv);

  function kindUI() {
    // Field visibility by kind: static badges need label/message; custom needs a raw path; every non-static badge may
    // override the label. Preset variables (user, repo, package) and optional params are rebuilt per kind.
    staticBox.hidden = m.kind !== 'static'; customBox.hidden = m.kind !== 'custom'; ovBox.hidden = m.kind === 'static';
    const pr = PRESETS.find((p) => p.id === m.kind) || {};
    vars.replaceChildren(...presetVars(m.kind).map((n) => field('=' + n, input(m.vars[n] || '', { placeholder: n, dataset: { v: n }, oninput: (e) => { m.vars[n] = e.target.value.trim(); upd(); } }))),
      ...Object.keys(pr.params || {}).map((n) => field('=' + n, input(m.params[n] ?? pr.params[n], { oninput: (e) => { m.params[n] = e.target.value.trim(); upd(); } }))));
  }
  // Alt text fallback "label: message": a badge image without alt is announced as "image" by screen readers and is
  // flagged by the outline lint.
  const result = () => {
    const u = buildShields(m);
    const ll = localLabel(m);
    return { url: u, code: buildMedia({ fmt, src: u, alt: alt.value || [ll.label, m.kind === 'static' ? ll.message : ''].filter(Boolean).join(': ') || 'badge', link: link.value.trim(), title: '', width: media?.width || '', height: media?.height || '', align: media?.align || '' }) };
  };
  function upd() {
    m.label = label.value; m.message = message.value; m.path = path.value.trim(); m.labelOverride = labelOv.value;
    m.logo = logo.value.trim(); m.logoColor = logoColor.value.trim();
    const r = result();
    if (document.activeElement !== url) url.value = r.url;
    code.value = r.code;
    const ll = localLabel(m);
    // The local preview is rebuilt on every change (data URI, no network). The note explains which preview is shown
    // and that logos are not drawn locally.
    const local = h('img', { alt: 'badge', src: badgeDataURI({ label: ll.label, message: ll.message, color: m.color, labelColor: m.labelColor, style: m.style }) });
    const live = S.remote ? h('img', { alt: 'badge', src: r.url }) : null;
    prev.replaceChildren(local, live || '');
    note.textContent = S.remote ? t('badge.both') : ll.live ? t('badge.localLive') : t('badge.local') + (m.logo ? ' ' + t('badge.noLogo') : '');
  }
  for (const x of [label, message, path, labelOv, logo, logoColor, link, alt]) x.addEventListener('input', upd);
  // Unparseable URL text (mid-typing) is ignored instead of resetting the form; the last valid state stays.
  url.addEventListener('input', () => {
    const p = parseShields(url.value.trim());
    if (!p) return;
    m = p;
    kind.set(m.kind); label.value = m.label; message.value = m.message; path.value = m.path; labelOv.value = m.labelOverride;
    color.set(m.color); labelColor.set(m.labelColor); style.set(m.style); logo.value = m.logo; logoColor.value = m.logoColor;
    kindUI(); upd();
  });
  const body = h('div', { class: 're-badge' },
    h('div', { class: 're-col' }, field('badge.kind', kind), staticBox, vars, customBox, field('badge.color', color), field('badge.labelColor', labelColor), ovBox),
    h('div', { class: 're-col' }, field('badge.style', style), h('div', { class: 're-grid2' }, field('badge.logo', logo), field('badge.logoColor', logoColor)),
      h('datalist', { id: 're-logos' }, LOGOS.map((l) => h('option', { value: l }))),
      h('div', { class: 're-grid2' }, field('img.link', link), field('img.alt', alt)),
      field('dlg.format', seg([{ v: 'md', l: '=Markdown' }, { v: 'html', l: '=HTML' }], fmt, (v) => { fmt = v; upd(); })),
      h('div', { class: 're-prevbox' }, prev, note), field('badge.url', url), field('dlg.code', code)));
  kindUI();
  upd();
  // Delete only for an existing badge, pushed left (re-left) away from Cancel/Done to prevent misclicks.
  const buttons = [...(existing ? [{ label: t('dlg.delete'), value: 'delete', danger: true, className: 're-left' }] : []), { label: t('dlg.cancel'), value: null }, { label: t('dlg.done'), value: 'ok', primary: true }];
  const v = await openDialog({ title: t('dlg.badge'), wide: true, body, buttons });
  if (v === 'delete') return { delete: true };
  return v === 'ok' ? { code: result().code } : null;
}
