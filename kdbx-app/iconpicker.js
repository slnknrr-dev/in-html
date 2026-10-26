// kdbx-app/iconpicker.js - icons of groups and entries and the icon picker.
//   itemIcon(item, size) / iconTile(item, size): the custom icon of the database (PNG) or the standard KeePass icon (IconID,
//   drawn in icons.js) of a group or an entry.
//   iconDialog({ kind, icon, customIcon, title }): the 69 standard icons (names as tooltips) and the custom icons of the
//   database in keyboard-navigable grids (arrows, Home / End, Enter); custom icons are added from image files (scaled to at
//   most 64 x 64 on a canvas, PNG, de-duplicated by content, named after the file; nothing is fetched) and unused ones
//   deleted; for groups the choice can also go to their entries or to the whole subtree.
//   applyIcon(item, choice): sets the icon (with history for entries) and the "apply to" option of groups.
//   entryIconFor(group): the icon of a new entry (the group's, unless it is a folder icon: then the key).
// Custom icons are rendered as data: URLs (cached per UUID and data), never blob: URLs that would need revoking.
import { t, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { ICON, ICON_NAMES, KdbxGroup } from '../kdbx/kdbx.js';
import { bytesToBase64 } from '../crypto/encoding.js';
import { ICON_COUNT, standardIconSvg } from './icons.js';
import { S, markDirty } from './state.js';

export const FOLDER_ICONS = [ICON.MarkedDirectory, ICON.Folder, ICON.FolderOpen, ICON.FolderPackage];
const MAX_ICON = 64;

export const iconName = (id) => (id >= 0 && id < ICON_COUNT ? t('icon.' + id) : `#${id}`);

// --- rendering ------------------------------------------------------------------------------------------------------

const urls = new Map(); // custom icon UUID -> data URL (keyed with the data so a replaced icon is redrawn)
export function customIconUrl(uuid, db = S.db) {
  const ic = uuid && db && db.meta.customIcons.get(uuid);
  if (!ic) return null;
  const hit = urls.get(uuid);
  if (hit && hit.data === ic.data) return hit.url;
  const url = 'data:image/png;base64,' + bytesToBase64(ic.data);
  urls.set(uuid, { data: ic.data, url });
  return url;
}
export const clearIconCache = () => urls.clear();

// The icon of a group or an entry ({ icon, customIcon }), `size` px.
export function itemIcon(item, size = 20, db = S.db) {
  const url = customIconUrl(item.customIcon, db);
  if (url) return h('img', { class: 'kx-ico kx-ico-img', src: url, alt: '', width: size, height: size, draggable: 'false' });
  return h('span', { class: 'kx-ico', 'aria-hidden': 'true', html: standardIconSvg(item.icon, size) });
}

// The icon on a rounded tile (entry list, details).
export function iconTile(item, size = 32) {
  return h('span', { class: 'kx-tile' + (item.customIcon && customIconUrl(item.customIcon) ? ' kx-tile-img' : ''), style: { '--kx-tile': size + 'px' } },
    itemIcon(item, Math.round(size * 0.62)));
}

export function entryIconFor(group) {
  const icon = group && !FOLDER_ICONS.includes(group.icon) && group.icon !== ICON.TrashBin ? group.icon : ICON.Key;
  return { icon, customIcon: group && group.customIcon && S.db.meta.customIcons.has(group.customIcon) ? group.customIcon : null };
}

// --- custom icons from image files ------------------------------------------------------------------------------------

// PNG bytes of an image file, at most 64 x 64 (aspect kept); small PNG files are kept as they are.
// Small PNGs (checked by signature, not extension) are stored as they are; anything else, SVG included, is rasterised through a canvas to PNG: the database only receives PNG bytes.
export async function imageToIcon(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth, hgt = img.naturalHeight;
    if (!w || !hgt) { w = hgt = MAX_ICON; } // an SVG without a size
    const raw = new Uint8Array(await file.arrayBuffer());
    const isPng = raw.length > 8 && raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47;
    if (isPng && w <= MAX_ICON && hgt <= MAX_ICON) return raw;
    const k = Math.min(1, MAX_ICON / Math.max(w, hgt));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(hgt * k));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}

const baseName = (name) => String(name || '').replace(/\.[^.]+$/, '').trim().slice(0, 100);

// --- keyboard grid -----------------------------------------------------------------------------------------------------

// Arrow keys, Home / End move a roving focus over the options of a grid (columns from the layout); Enter / Space pick.
// Roving focus over a CSS grid: the column count is measured from the rendered offsets, so arrow keys follow the visual layout at any width.
function gridKeys(grid, onPick) {
  grid.addEventListener('keydown', (e) => {
    const opts = [...grid.querySelectorAll('[role=option]')];
    const i = opts.indexOf(document.activeElement);
    if (i < 0) return;
    const top = opts[0].offsetTop;
    const cols = Math.max(1, opts.findIndex((o) => o.offsetTop !== top) < 0 ? opts.length : opts.findIndex((o) => o.offsetTop !== top));
    const rtl = getComputedStyle(grid).direction === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: cols, ArrowUp: -cols, Home: -Infinity, End: Infinity }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      const j = step === -Infinity ? 0 : step === Infinity ? opts.length - 1 : Math.max(0, Math.min(opts.length - 1, i + step));
      opts[i].tabIndex = -1;
      opts[j].tabIndex = 0;
      opts[j].focus();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onPick(opts[i], e.key === 'Enter');
    }
  });
}

// --- dialog ---------------------------------------------------------------------------------------------------------------

// kind: 'entry' | 'group'; count: several entries at once (title). Resolves with { icon, customIcon, apply } or null.
export async function iconDialog({ kind = 'entry', icon = 0, customIcon = null, title = '' } = {}) {
  const db = S.db;
  const sel = { icon, customIcon: customIcon && db.meta.customIcons.has(customIcon) ? customIcon : null, apply: 'self' };
  let close = null;
  const preview = h('div', { class: 'kx-ip-now' });
  const paintPreview = () => {
    const ic = sel.customIcon && db.meta.customIcons.get(sel.customIcon);
    preview.replaceChildren(iconTile(sel, 44), h('div', { class: 'kx-ip-now-t' },
      h('strong', {}, ic ? ic.name || t('kx.icon.custom') : iconName(sel.icon)),
      h('span', { class: 'ed-muted' }, ic ? t('kx.icon.customKind') : t('kx.icon.standardKind', { n: sel.icon }))));
  };
  const option = (attrs, content, picked) => h('button', { type: 'button', role: 'option', class: 'kx-ip-cell', tabindex: picked ? '0' : '-1', 'aria-selected': String(picked), ...attrs }, content);

  const std = h('div', { class: 'kx-ip-grid', role: 'listbox', 'aria-label': t('kx.icon.standard') });
  const paintStd = () => {
    std.textContent = '';
    for (let id = 0; id < ICON_COUNT; id++) {
      const on = !sel.customIcon && sel.icon === id;
      std.append(option({ title: `${iconName(id)} (${id})`, 'aria-label': iconName(id), dataset: { id: String(id) } }, h('span', { class: 'kx-ico', html: standardIconSvg(id, 22) }), on));
    }
    if (!std.querySelector('[tabindex="0"]')) std.firstElementChild.tabIndex = 0;
  };
  const pickStd = (el, confirm) => {
    sel.icon = +el.dataset.id;
    sel.customIcon = null;
    repaint('id', el.dataset.id);
    if (confirm) finish();
  };
  std.addEventListener('click', (e) => { const o = e.target.closest('[role=option]'); if (o) pickStd(o, false); });
  std.addEventListener('dblclick', (e) => { const o = e.target.closest('[role=option]'); if (o) pickStd(o, true); });
  gridKeys(std, pickStd);

  const cust = h('div', { class: 'kx-ip-grid kx-ip-custom', role: 'listbox', 'aria-label': t('kx.icon.customs') });
  const custInfo = h('div', { class: 'kx-ip-cinfo ed-muted' });
  const delBtn = h('button', { type: 'button', class: 'ed-btn ed-sm ed-danger' }, iconEl('trash'), t('kx.icon.delete'));
  const unusedBtn = h('button', { type: 'button', class: 'ed-btn ed-sm' }, iconEl('trash'), h('span'));
  const paintCust = () => {
    cust.textContent = '';
    for (const [uuid, ic] of db.meta.customIcons) {
      const on = sel.customIcon === uuid;
      cust.append(option({ title: ic.name || t('kx.icon.custom'), 'aria-label': ic.name || t('kx.icon.custom'), dataset: { uuid } },
        h('img', { src: customIconUrl(uuid, db), alt: '', width: 24, height: 24, draggable: 'false' }), on));
    }
    if (!db.meta.customIcons.size) cust.append(h('div', { class: 'kx-ip-empty ed-muted' }, t('kx.icon.noCustom')));
    else if (!cust.querySelector('[tabindex="0"]')) cust.querySelector('[role=option]').tabIndex = 0;
    const users = sel.customIcon ? db.customIconUsers(sel.customIcon) : [];
    custInfo.textContent = !sel.customIcon ? '' : users.length ? t('kx.icon.users', { n: users.length }) : t('kx.icon.unused');
    delBtn.hidden = !sel.customIcon;
    delBtn.disabled = users.length > 0;
    delBtn.title = users.length ? t('kx.icon.inUse') : '';
    const unused = db.unusedCustomIcons();
    unusedBtn.hidden = !unused.length;
    unusedBtn.lastChild.textContent = t('kx.icon.deleteUnused', { n: unused.length });
  };
  const pickCust = (el, confirm) => {
    sel.customIcon = el.dataset.uuid;
    repaint('uuid', el.dataset.uuid);
    if (confirm) finish();
  };
  cust.addEventListener('click', (e) => { const o = e.target.closest('[role=option]'); if (o) pickCust(o, false); });
  cust.addEventListener('dblclick', (e) => { const o = e.target.closest('[role=option]'); if (o) pickCust(o, true); });
  gridKeys(cust, pickCust);

  // Repaints both grids; the cell data-<k>="<v>" (the picked one) gets the focus.
  function repaint(k, v) {
    paintStd();
    paintCust();
    paintPreview();
    const el = k ? (k === 'uuid' ? cust : std).querySelector(`[data-${k}="${CSS.escape(v)}"]`) : null;
    if (el) {
      for (const o of el.parentNode.querySelectorAll('[role=option]')) o.tabIndex = -1;
      el.tabIndex = 0;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  const addBtn = h('button', { type: 'button', class: 'ed-btn ed-sm' }, iconEl('plus'), t('kx.icon.add'));
  addBtn.addEventListener('click', async () => {
    const files = await pickFiles({ accept: 'image/*,.ico,.svg', multiple: true });
    let last = null, added = 0, failed = 0;
    for (const f of files) {
      try {
        const data = await imageToIcon(f);
        const before = db.meta.customIcons.size;
        last = db.addCustomIcon(data, baseName(f.name));
        if (db.meta.customIcons.size > before) added++;
      } catch { failed++; }
    }
    if (failed) toast(t('kx.icon.bad', { n: failed }), 'warn');
    if (!last) return;
    if (added) markDirty();
    else toast(t('kx.icon.same'), 'info');
    sel.customIcon = last;
    repaint('uuid', last);
  });
  delBtn.addEventListener('click', () => {
    const uuid = sel.customIcon;
    if (!uuid || db.customIconUsers(uuid).length) return;
    db.removeCustomIcon(uuid);
    clearIconCache();
    markDirty();
    sel.customIcon = null;
    repaint('id', String(sel.icon));
  });
  unusedBtn.addEventListener('click', async () => {
    const unused = db.unusedCustomIcons();
    if (!unused.length || !await confirmDialog(t('kx.icon.deleteUnusedT'), t('kx.icon.deleteUnusedText', { n: unused.length }), t('dlg.delete'), true)) return;
    for (const u of unused) db.removeCustomIcon(u);
    clearIconCache();
    markDirty();
    if (sel.customIcon && !db.meta.customIcons.has(sel.customIcon)) sel.customIcon = null;
    repaint();
  });

  const apply = kind === 'group' ? h('label', { class: 'ed-field kx-ip-apply' }, h('span', { class: 'ed-label' }, t('kx.icon.applyTo')),
    (() => {
      const s = h('select', { class: 'ed-input ed-select' }, ['self', 'entries', 'tree'].map((v) => h('option', { value: v }, t('kx.icon.apply.' + v))));
      s.addEventListener('change', () => { sel.apply = s.value; });
      return s;
    })()) : null;

  paintStd();
  paintCust();
  paintPreview();
  const body = h('div', { class: 'kx-ip' },
    preview,
    h('h3', { class: 'kx-sec-h' }, t('kx.icon.standard')), std,
    h('div', { class: 'kx-ip-ch' }, h('h3', { class: 'kx-sec-h' }, t('kx.icon.customs')), h('span', { class: 'ed-spacer' }), addBtn),
    cust,
    h('div', { class: 'kx-ip-cbar' }, custInfo, h('span', { class: 'ed-spacer' }), delBtn, unusedBtn),
    h('div', { class: 'ed-hint' }, t('kx.icon.addHint')),
    apply);
  function finish() { if (close) close('ok'); }
  const r = await openDialog({
    title: title || t('kx.icon.title'), body, wide: false, className: 'kx-ip-dlg',
    onMount: ({ close: c }) => {
      close = c;
      // Focus the current icon (the dialog would focus the first field otherwise).
      setTimeout(() => { const f = (sel.customIcon ? cust : std).querySelector('[aria-selected="true"]') || std.querySelector('[role=option]'); f.focus(); f.scrollIntoView({ block: 'nearest' }); }, 40);
    },
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }],
  });
  return r === 'ok' ? { icon: sel.icon, customIcon: sel.customIcon, apply: sel.apply } : null;
}

// Sets the chosen icon on an entry (keeping its previous state in the history) or a group; for a group the choice can
// also go to its entries ('entries') or to every subgroup and entry below it ('tree'; the recycle bin is left alone).
// Returns the number of changed items.
export function applyIcon(item, choice) {
  const db = S.db;
  let n = 0;
  const setEntry = (e) => {
    if (e.icon === choice.icon && e.customIcon === choice.customIcon) return;
    e.pushHistory(db);
    e.icon = choice.icon;
    e.customIcon = choice.customIcon;
    e.times.touch();
    n++;
  };
  const setGroup = (g) => {
    if (g.icon === choice.icon && g.customIcon === choice.customIcon) return;
    g.icon = choice.icon;
    g.customIcon = choice.customIcon;
    g.times.touch();
    n++;
  };
  if (!(item instanceof KdbxGroup)) setEntry(item);
  else {
    setGroup(item);
    const bin = db.recycleBin(false);
    if (choice.apply === 'entries') item.entries.forEach(setEntry);
    else if (choice.apply === 'tree') {
      const walk = (g) => { g.entries.forEach(setEntry); for (const c of g.groups) if (c !== bin) { setGroup(c); walk(c); } };
      walk(item);
    }
  }
  if (n) markDirty();
  return n;
}

export { ICON_NAMES };
