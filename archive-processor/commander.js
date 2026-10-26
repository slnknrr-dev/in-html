// archive-processor/commander.js - the two-panel file manager in the manner of Far Manager. A workspace of files in
// memory (dropped, pasted, picked, created) is shown in two panels; archives open as folders (Enter / Ctrl+PgDn), nested
// archives too, and files are copied and moved between panels: out of an archive, into an archive (the archive is
// repacked by the engine with ../pack/), between archives. Writable: ZIP, 7z, tar, tar.gz / bz2 / xz / zst and the
// single-file gz / bz2 / xz / zst / lzma; RAR, ISO, ARC and encrypted archives are read-only.
// 
// Keys: arrows, Home / End, Page Up / Down, Enter, Backspace (parent), Ctrl+PgUp / Ctrl+PgDn, Ctrl+\ (root), Tab (other
// panel), Insert / Space (select), Shift+arrows, Ctrl+A, * (invert), F1 help, F2 pack, F3 view, F4 edit, Shift+F4 new
// file, F5 copy, F6 move, Shift+F6 rename, F7 folder, F8 / Delete delete, F9 properties and checksums, Shift+F9 test,
// F10 compare, Alt+F7 find, Ctrl+U swap panels, Ctrl+Enter name to the command line, Ctrl+S save to the device. Typing
// goes to the command line (cd, mkdir, pack, test, hash, cmp, find, view, edit, touch, rm, save, help, classic).
// 
//   createCommander({ job, errText, onClassic, state }) -> { el, addFiles(files), focus(), state, … }
// 
// Model:
// - Workspace = an in-memory tree of { name, dir, kids: Map, blob }. Files are Blobs (File objects from the device are
//   Blobs too): nothing is read until needed.
// - Mount = an archive opened as a folder: { key (engine handle), parent mount, src path, blob, root tree, format }.
//   Location = { mount | null, path }. Nested archives form a chain of mounts; locText() renders it as "/a.zip:/x".
// - Writing into an archive = repack (engine) then propagate: the parent archive (or the workspace node) receives the new
//   Blob, recursively up the chain (commit). Each repack gets a fresh engine key; the old one is closed afterwards, so a
//   failed repack leaves the previous state usable.
// - Selection is kept by name per panel (Set), so it survives re-sorting and refreshes.

import { download, t, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { pickFiles } from '../ui/files.js';
import { icon, iconEl } from '../ui/icons.js';
import { confirmDialog, openDialog, openMenu, promptDialog } from '../ui/overlays.js';
import { detectType, mimeOfName } from '../magic/index.js';
import { PACK_FORMATS, packFormatOf } from '../pack/index.js';
import { decodePreview, fmtCount, fmtDate, fmtSize, kindOf } from './fmt.js';
import { ENCODINGS, encodeText, findIn, openViewer, parsePattern } from './hexview.js';

// Engine format id -> ../pack/ format id. Anything missing is read-only (RAR: proprietary compressor; ISO/ARC: not implemented).
const WRITABLE = { zip: 'zip', '7z': '7z', tar: 'tar', 'tar.gzip': 'tar.gz', 'tar.bzip2': 'tar.bz2', 'tar.xz': 'tar.xz', 'tar.zstd': 'tar.zst', gzip: 'gz', bzip2: 'bz2', xz: 'xz', zstd: 'zst', lzma: 'lzma' };
// Icons by the detected kind (../magic/) and, before detection, by the extension (fmt.js kindOf).
const TYPE_ICON = { image: 'image', audio: 'music', video: 'film', archive: 'archive', document: 'doc', text: 'doc', executable: 'terminal', font: 'type' };
const ICON = { image: 'image', text: 'doc', audio: 'music', video: 'film', archive: 'archive', sheet: 'sheet', doc: 'doc', exe: 'terminal', file: 'file' };
const join = (a, b) => (a ? a + '/' + b : b);
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

// --- trees: the workspace and the listings of open archives --------------------------------------------------

const newDir = (name, parent = null) => ({ name, dir: true, kids: new Map(), parent, mtime: Date.now() });
function child(dir, name) { return dir.kids.get(name) || null; }
function pathOf(n) { const p = []; for (let x = n; x && x.parent; x = x.parent) p.unshift(x.name); return p.join('/'); }
// Returns null for a missing or non-folder segment; callers fall back to the root rather than throw (a folder can vanish after a repack).
function resolve(root, path) {
  let n = root;
  for (const s of path ? path.split('/') : []) { const c = n.kids && n.kids.get(s); if (!c || !c.dir) return null; n = c; }
  return n;
}
function ensureDir(root, path) {
  let n = root;
  for (const s of path ? path.split('/') : []) {
    let c = n.kids.get(s);
    if (!c || !c.dir) { c = newDir(s, n); n.kids.set(s, c); }
    n = c;
  }
  return n;
}
// Archive listing -> the same node shape as the workspace, so panels render both with one code path.
function arcTree(entries) {
  const root = newDir('');
  for (const e of entries) {
    const dir = ensureDir(root, parentOf(e.path));
    const name = baseOf(e.path);
    if (e.dir) { const d = ensureDir(root, e.path); d.id = e.id; d.mtime = e.mtime; d.entry = e; continue; }
    dir.kids.set(name, { name, dir: false, parent: dir, id: e.id, size: e.size ?? 0, mtime: e.mtime, entry: e });
  }
  return root;
}
function walkFiles(n, base, out) {
  if (!n.dir) { out.push({ rel: base, node: n }); return out; }
  out.push({ rel: base, node: n, dir: true });
  for (const c of n.kids.values()) walkFiles(c, join(base, c.name), out);
  return out;
}
const dirStats = (n) => { let files = 0, dirs = 0, size = 0; const w = (x) => { for (const c of x.kids.values()) { if (c.dir) { dirs++; w(c); } else { files++; size += c.size || 0; } } }; w(n); return { files, dirs, size }; };

// --- wildcard masks ----------------------------------------------------------------------------------------------
// Far-style masks: several separated by ; or , ("*.txt;*.md"). Metacharacters escaped, so only * and ? are special.
export function maskRe(mask) {
  const parts = String(mask || '*').split(/[;,]/).map((m) => m.trim()).filter(Boolean);
  const res = parts.map((m) => new RegExp('^' + m.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
  return (name) => res.some((r) => r.test(name));
}

/** Command line words: spaces separate, quotes keep spaces. */
// Minimal shell word splitting: double or single quotes keep spaces; no escapes (paths with quotes are rare in a browser workspace).
export function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function createCommander({ job, errText, onClassic, state }) {
  // A previous instance's state (a language switch rebuilds the commander): the same workspace and archives.
  const ws = state ? state.ws : newDir('');
  const mounts = state ? state.mounts : [];
  let seq = state ? state.seq() : 0;
  const panels = [0, 1].map((i) => ({ i, loc: state ? state.panels[i].loc : { mount: null, path: '' }, cur: 0, sel: new Set(), rows: [], top: 0, el: null }));
  let active = state ? state.active : 0;
  const S = { ws, mounts, panels, get active() { return active; }, seq: () => seq };
  // Row height read live: a device can switch between mouse and touch (convertibles).
  const rowH = () => (matchMedia('(pointer: coarse)').matches ? 34 : 24);
  let mod = { alt: false, shift: false };

  // --- locations ---------------------------------------------------------------------------------------------
  const rootOf = (loc) => (loc.mount ? loc.mount.root : ws);
  const dirOf = (loc) => resolve(rootOf(loc), loc.path) || rootOf(loc);
  // "/docs", "/backup.tar.gz:/src", "/a.zip:inner/b.tar:/x" (archives in the chain end with ':').
  function locText(loc) {
    const parts = [];
    for (let m = loc.mount; m; m = m.parent) parts.unshift(m);
    return parts.map((m, i) => (i === 0 ? '/' : '') + m.src + ':').join('') + '/' + loc.path;
  }
  const rw = (m) => m && m.format && !m.readonly;

  function rowsOf(p) {
    const d = dirOf(p.loc);
    const kids = [...d.kids.values()].sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    const up = p.loc.path || p.loc.mount ? [{ up: true, name: '..', dir: true }] : [];
    return [...up, ...kids];
  }

  // --- archive mounts ------------------------------------------------------------------------------------------
  async function blobOf(loc, node) {
    if (!loc.mount) return node.blob;
    const res = await job({ op: 'extract', key: loc.mount.key, ids: [node.id], mode: 'files' }, { label: t('ax.extracting') });
    if (!res.files.length) throw Object.assign(new Error(res.errors[0] ? res.errors[0].message : 'no data'), { code: res.errors[0] ? res.errors[0].code : 'error' });
    return res.files[0].blob;
  }
  // Mounts are cached per (parent, src): re-entering an archive does not re-extract or re-list it.
  async function openMount(loc, node) {
    const src = join(loc.path, node.name);
    let m = mounts.find((x) => x.parent === loc.mount && x.src === src);
    if (m) return m;
    const blob = await blobOf(loc, node);
    m = { key: 'm' + ++seq, parent: loc.mount, src, name: node.name, blob };
    await loadMount(m);
    mounts.push(m);
    return m;
  }
  async function loadMount(m) {
    const file = new File([m.blob], m.name, { lastModified: Date.now() });
    const res = await job({ op: 'vopen', key: m.key, files: [file] }, { label: t('ax.opening', { name: m.name }), progress: 'open' });
    m.root = arcTree(res.entries);
    m.label = res.label.replace(/^tar\.gzip$/, 'tar.gz').replace(/^tar\.bzip2$/, 'tar.bz2');
    m.format = WRITABLE[res.format] || null;
    m.readonly = !m.format ? 'format' : res.stats.encrypted || res.info.headersEncrypted ? 'encrypted' : null;
    m.stats = res.stats;
  }
  /** Rewrites a mounted archive and every archive that holds it, up to the workspace. */
  // Recursive write-back: repacking an inner archive changes its bytes, so its container must be repacked too, up to the workspace.
  async function commit(m, change) {
    if (!rw(m)) throw Object.assign(new Error('read-only'), { code: 'readonly', reason: m.readonly || 'format' });
    const res = await job({ op: 'repack', key: m.key, format: m.format, ...change }, { label: t('fm.repacking', { name: m.name }) });
    m.blob = res.blob;
    if (m.parent) await commit(m.parent, { add: [{ path: m.src, blob: res.blob, mtime: Date.now() }] });
    else {
      const d = resolve(ws, parentOf(m.src));
      const n = d && child(d, baseOf(m.src));
      if (n) { n.blob = res.blob; n.size = res.blob.size; n.mtime = Date.now(); n.type = null; }
    }
    const old = m.key;
    m.key = 'm' + ++seq;
    await loadMount(m);
    job({ op: 'vclose', key: old }).catch(() => {});
  }
  // Overwriting, renaming or deleting a workspace archive invalidates its mounts (and their children); panels inside are moved to the folder that held it.
  function dropMounts(pred) {
    for (let i = mounts.length - 1; i >= 0; i--) {
      const m = mounts[i];
      let hit = false;
      for (let x = m; x && !hit; x = x.parent) hit = pred(x);
      if (!hit) continue;
      mounts.splice(i, 1);
      job({ op: 'vclose', key: m.key }).catch(() => {});
      for (const p of panels) if (p.loc.mount === m) p.loc = { mount: null, path: parentOf(rootSrc(m)) };
    }
  }
  const rootSrc = (m) => { let x = m; while (x.parent) x = x.parent; return x.src; };

  // --- writing --------------------------------------------------------------------------------------------------
  /** items: [{ rel, dir, blob, mtime }] written under loc (the workspace, or an archive by repacking). */
  // Workspace writes never replace a folder by a file (old.dir: skipped). Replacing an archive file drops its stale mounts first.
  async function writeItems(loc, items) {
    if (loc.mount) {
      await commit(loc.mount, { add: items.map((x) => ({ path: join(loc.path, x.rel), dir: !!x.dir, blob: x.blob, mtime: x.mtime ?? Date.now() })) });
      return;
    }
    const base = ensureDir(ws, loc.path);
    for (const x of items) {
      if (x.dir) { ensureDir(base, x.rel); continue; }
      const d = ensureDir(base, parentOf(x.rel));
      const old = child(d, baseOf(x.rel));
      if (old && old.dir) continue;
      if (old) dropMounts((m) => !m.parent && m.src === join(loc.path, x.rel));
      d.kids.set(baseOf(x.rel), { name: baseOf(x.rel), dir: false, parent: d, blob: x.blob, size: x.blob.size, mtime: x.mtime ?? Date.now() });
    }
  }
  async function removeNodes(loc, nodes) {
    if (loc.mount) { await commit(loc.mount, { remove: nodes.map((n) => join(loc.path, n.name)) }); return; }
    const d = dirOf(loc);
    for (const n of nodes) {
      const p = join(loc.path, n.name);
      dropMounts((m) => !m.parent && (m.src === p || m.src.startsWith(p + '/')));
      d.kids.delete(n.name);
    }
  }
  /** The data of nodes as items (archive entries are extracted by the engine in one job). */
  // Entries of an archive are extracted in one engine job (not one per file): one pass over a solid 7z block instead of N.
  async function gather(loc, nodes, rename) {
    const list = [];
    for (const n of nodes) walkFiles(n, nodes.length === 1 && rename ? rename : n.name, list);
    const items = list.map((x) => ({ rel: x.rel, dir: !!x.dir, mtime: x.node.mtime instanceof Date ? x.node.mtime.getTime() : x.node.mtime, node: x.node, blob: x.dir ? null : x.node.blob }));
    if (loc.mount) {
      const ids = items.filter((x) => !x.dir).map((x) => x.node.id);
      if (ids.length) {
        const res = await job({ op: 'extract', key: loc.mount.key, ids, mode: 'files' }, { label: t('ax.extracting') });
        if (res.errors.length) throw Object.assign(new Error(res.errors[0].message), { code: res.errors[0].code, path: res.errors[0].path });
        const byPath = new Map(res.files.map((f) => [f.path, f.blob]));
        for (const x of items) if (!x.dir) x.blob = byPath.get(x.node.entry.path) || new Blob([]);
      }
    }
    return items;
  }

  // --- rendering ----------------------------------------------------------------------------------------------
  const root = h('section', { class: 'fm', 'aria-label': t('fm.title') });
  const cmdPrompt = h('span', { class: 'fm-prompt' });
  const cmd = h('input', { type: 'text', class: 'fm-cmd-input', spellcheck: 'false', autocomplete: 'off', 'aria-label': t('fm.cmdline') });
  const out = h('div', { class: 'fm-out', 'aria-live': 'polite' });
  const keybar = h('div', { class: 'fm-keys', role: 'toolbar', 'aria-label': t('fm.keys') });
  const progress = h('div', { class: 'ax-prog-slot fm-prog' });
  const tabs = h('div', { class: 'fm-tabs', role: 'tablist' });
  const panelBox = h('div', { class: 'fm-panels' });
  const tool = (label, ic, fn) => h('button', { type: 'button', class: 'ed-btn fm-tool', title: t(label), onclick: fn }, iconEl(ic), h('span', { class: 'ax-btn-l' }, t(label)));
  const dirInput = h('input', { type: 'file', multiple: true, hidden: true, webkitdirectory: '' });
  dirInput.addEventListener('change', () => { addFiles([...dirInput.files], true); dirInput.value = ''; });
  const toolbar = h('div', { class: 'fm-toolbar' },
    h('span', { class: 'ax-bar-icon' }, iconEl('archive')),
    h('h2', { class: 'fm-h' }, t('fm.title')),
    h('span', { class: 'ed-spacer' }),
    tool('fm.addFiles', 'upload', async () => addFiles(await pickFiles({ multiple: true }))),
    tool('fm.addFolder', 'folder', () => dirInput.click()),
    tool('fm.save', 'download', () => saveSelection()),
    tool('fm.help', 'info', () => help()),
    tool('fm.classic', 'list', () => onClassic && onClassic()), dirInput);
  root.append(toolbar, progress, tabs, panelBox, out, h('div', { class: 'fm-cmd' }, cmdPrompt, cmd), keybar);

  for (const p of panels) {
    p.path = h('div', { class: 'fm-path' });
    p.spacer = h('div', { class: 'fm-spacer' });
    p.list = h('div', { class: 'fm-list', tabindex: '0', role: 'grid', 'aria-label': t(p.i ? 'fm.right' : 'fm.left'), 'aria-multiselectable': 'true' }, p.spacer);
    p.head = h('div', { class: 'fm-row fm-headrow', role: 'row' },
      h('span', { class: 'fm-c-name' }, t('ax.col.name')), h('span', { class: 'fm-c-size' }, t('ax.col.size')),
      h('span', { class: 'fm-c-date' }, t('ax.col.modified')), h('span', { class: 'fm-c-type' }, t('fm.col.type')));
    p.info = h('div', { class: 'fm-info' });
    p.el = h('div', { class: 'fm-panel', dataset: { panel: String(p.i) } }, p.path, p.head, p.list, p.info);
    p.list.addEventListener('focus', () => setActive(p.i, false));
    p.list.addEventListener('scroll', () => drawRows(p));
    p.list.addEventListener('click', (e) => {
      const r = e.target.closest('.fm-item');
      if (!r) return;
      const i = +r.dataset.i;
      setActive(p.i, false);
      if (e.ctrlKey || e.metaKey) toggleSel(p, i);
      else if (e.shiftKey) { const a = Math.min(p.cur, i), b = Math.max(p.cur, i); for (let k = a; k <= b; k++) if (!p.rows[k].up) p.sel.add(p.rows[k].name); }
      else if (lastTap.p === p && lastTap.i === i && Date.now() - lastTap.t < 450 && (e.pointerType === 'touch' || matchMedia('(pointer: coarse)').matches)) { p.cur = i; enter(p); return; }
      lastTap = { p, i, t: Date.now() };
      p.cur = i;
      paint(p);
      p.list.focus({ preventScroll: true });
    });
    p.list.addEventListener('dblclick', (e) => { const r = e.target.closest('.fm-item'); if (r) { p.cur = +r.dataset.i; enter(p); } });
    p.list.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.fm-item');
      if (!r) return;
      e.preventDefault();
      p.cur = +r.dataset.i;
      setActive(p.i, false);
      paint(p);
      openMenu({ x: e.clientX, y: e.clientY }, menuItems(p), { label: p.rows[p.cur].name });
    });
    panelBox.append(p.el);
  }
  let lastTap = {};

  function renderTabs() {
    tabs.replaceChildren(...panels.map((p) => h('button', {
      type: 'button', class: 'fm-tab' + (p.i === active ? ' fm-on' : ''), role: 'tab', 'aria-selected': String(p.i === active),
      onclick: () => setActive(p.i),
    }, t(p.i ? 'fm.right' : 'fm.left'), h('span', { class: 'fm-tab-path' }, locText(p.loc)))));
  }

  function setActive(i, focus = true) {
    if (active !== i) { active = i; for (const p of panels) p.el.classList.toggle('fm-active', p.i === active); renderTabs(); syncPrompt(); }
    for (const p of panels) p.el.classList.toggle('fm-active', p.i === active);
    if (focus) panels[i].list.focus({ preventScroll: true });
  }
  const A = () => panels[active];
  const B = () => panels[1 - active];
  const syncPrompt = () => { cmdPrompt.textContent = locText(A().loc) + '>'; };

  function refresh(p, keepName) {
    const name = keepName ?? (p.rows[p.cur] && p.rows[p.cur].name);
    if (!resolve(rootOf(p.loc), p.loc.path)) p.loc.path = '';
    p.rows = rowsOf(p);
    for (const n of [...p.sel]) if (!p.rows.some((r) => !r.up && r.name === n)) p.sel.delete(n);
    const i = name != null ? p.rows.findIndex((r) => r.name === name) : -1;
    p.cur = i >= 0 ? i : Math.min(p.cur, Math.max(0, p.rows.length - 1));
    const m = p.loc.mount;
    p.path.replaceChildren(h('span', { class: 'fm-path-t', title: locText(p.loc) }, locText(p.loc)),
      m ? h('span', { class: 'fm-badge' + (rw(m) ? '' : ' fm-ro'), title: rw(m) ? '' : t('fm.ro.' + (m.readonly || 'format')) }, m.label + (rw(m) ? '' : ' · ' + t('fm.readonly'))) : h('span', { class: 'fm-badge' }, t('fm.workspace')));
    p.spacer.style.height = p.rows.length * rowH() + 'px';
    paint(p);
    if (p.i === active) syncPrompt();
    renderTabs();
  }
  const refreshAll = () => { for (const p of panels) refresh(p); };

  // MIME detection by content is lazy: first render shows the extension-based type, the first 64 KiB are sniffed asynchronously and the rows redrawn.
  function typeLabel(n) {
    if (n.up) return '';
    if (n.dir) return t('fm.dir');
    if (n.type) return n.type.label;
    const byName = mimeOfName(n.name);
    if (!n.typing && n.blob) {
      n.typing = true;
      n.blob.slice(0, 65536).arrayBuffer().then((ab) => { n.type = detectType(new Uint8Array(ab), n.name); for (const p of panels) if (p.rows.includes(n)) drawRows(p); });
    }
    return byName ? byName.label : '';
  }

  function paint(p) {
    const H = rowH();
    const vis = Math.max(1, Math.floor(p.list.clientHeight / H));
    if (p.cur * H < p.list.scrollTop) p.list.scrollTop = p.cur * H;
    else if ((p.cur + 1) * H > p.list.scrollTop + p.list.clientHeight) p.list.scrollTop = (p.cur + 1) * H - vis * H;
    drawRows(p);
    info(p);
  }

  // Virtual rows as in list.js: 2 rows of overscan above, 5 below; positioned absolutely by index.
  function drawRows(p) {
    const H = rowH();
    const first = Math.max(0, Math.floor(p.list.scrollTop / H) - 2);
    const last = Math.min(p.rows.length, first + Math.ceil((p.list.clientHeight || 600) / H) + 5);
    const frag = [];
    for (let i = first; i < last; i++) {
      const n = p.rows[i];
      const sel = !n.up && p.sel.has(n.name);
      const kind = n.up ? 'parent' : n.dir ? 'folder' : (n.type && TYPE_ICON[n.type.kind]) || ICON[kindOf(n.name)] || 'file';
      const date = n.up ? '' : fmtDate(n.mtime instanceof Date ? n.mtime.getTime() : n.mtime);
      frag.push(h('div', {
        class: 'fm-row fm-item' + (i === p.cur ? ' fm-cur' : '') + (sel ? ' fm-sel' : '') + (n.dir ? ' fm-dirrow' : ''), role: 'row', dataset: { i: String(i), name: n.name },
        'aria-selected': String(sel), style: { top: i * H + 'px', height: H + 'px' },
      },
      h('span', { class: 'fm-c-name' }, h('span', { class: 'fm-ic', html: icon(kind) }), h('span', { class: 'fm-name' }, n.name)),
      h('span', { class: 'fm-c-size' }, n.up ? t('fm.up') : n.dir ? t('fm.dirTag') : fmtSize(n.size)),
      h('span', { class: 'fm-c-date' }, date),
      h('span', { class: 'fm-c-type' }, typeLabel(n))));
    }
    p.spacer.replaceChildren(...frag);
  }

  function info(p) {
    const n = p.rows[p.cur];
    if (p.sel.size) {
      let size = 0, files = 0;
      for (const r of p.rows) if (!r.up && p.sel.has(r.name)) { if (r.dir) { const s = dirStats(r); size += s.size; files += s.files; } else { size += r.size || 0; files++; } }
      p.info.textContent = t('fm.selInfo', { n: p.sel.size, files: fmtCount(files), size: fmtSize(size) });
      return;
    }
    if (!n) { p.info.textContent = t('fm.empty'); return; }
    if (n.up) { p.info.textContent = t('fm.upInfo'); return; }
    if (n.dir) { const s = dirStats(n); p.info.textContent = n.name + ' · ' + t('fm.dirInfo', { n: s.files, files: fmtCount(s.files), size: fmtSize(s.size) }); return; }
    p.info.textContent = [n.name, fmtSize(n.size), typeLabel(n), n.type ? n.type.mime : ''].filter(Boolean).join(' · ');
  }

  // --- key bar -------------------------------------------------------------------------------------------------
  // Key bar = three layers (plain / Shift / Alt) of ten F-keys, swapped while a modifier is held, as in Far. Empty slots render disabled.
  const KEYS = {
    plain: [['F1', 'fm.k.help', () => help()], ['F2', 'fm.k.pack', () => packDialog()], ['F3', 'fm.k.view', () => view()], ['F4', 'fm.k.edit', () => edit()], ['F5', 'fm.k.copy', () => transferDialog(false)],
      ['F6', 'fm.k.move', () => transferDialog(true)], ['F7', 'fm.k.mkdir', () => mkdir()], ['F8', 'fm.k.delete', () => del()], ['F9', 'fm.k.info', () => properties()], ['F10', 'fm.k.compare', () => compareFiles()]],
    shift: [['F1', '', null], ['F2', '', null], ['F3', '', null], ['F4', 'fm.k.new', () => edit(true)], ['F5', '', null], ['F6', 'fm.k.rename', () => rename()], ['F7', '', null], ['F8', 'fm.k.delete', () => del()], ['F9', 'fm.k.test', () => testCurrent()], ['F10', '', null]],
    alt: [['F1', '', null], ['F2', '', null], ['F3', '', null], ['F4', '', null], ['F5', '', null], ['F6', '', null], ['F7', 'fm.k.find', () => findDialog()], ['F8', '', null], ['F9', '', null], ['F10', '', null]],
  };
  function renderKeys() {
    const set = mod.alt ? KEYS.alt : mod.shift ? KEYS.shift : KEYS.plain;
    keybar.replaceChildren(...set.map(([k, label, fn]) => h('button', {
      type: 'button', class: 'fm-key', disabled: !fn, dataset: { key: k }, title: label ? (mod.alt ? 'Alt+' : mod.shift ? 'Shift+' : '') + k + ' ' + t(label) : null,
      onclick: () => { if (fn) fn(); },
    }, h('b', null, k.slice(1)), h('span', null, label ? t(label) : ''))));
  }

  // --- navigation ----------------------------------------------------------------------------------------------
  // Enter on a file: open as archive if it looks like one, else view. Ctrl+PgDn (force) tries to open anything as an archive and reports the error.
  async function enter(p, force = false) {
    const n = p.rows[p.cur];
    if (!n) return;
    if (n.up) { up(p); return; }
    if (n.dir) { p.loc = { mount: p.loc.mount, path: join(p.loc.path, n.name) }; p.sel.clear(); p.cur = 0; p.list.scrollTop = 0; refresh(p, '..'); return; }
    const isArc = (n.type && n.type.kind === 'archive') || kindOf(n.name) === 'archive' || packFormatOf(n.name);
    if (!isArc && !force) { view(); return; }
    try {
      const m = await openMount(p.loc, n);
      p.loc = { mount: m, path: '' };
      p.sel.clear(); p.cur = 0; p.list.scrollTop = 0;
      refresh(p, '..');
      log(t('fm.opened', { name: n.name, format: m.label }));
    } catch (e) {
      if (e.code === 'aborted') return;
      if (force || (e.code !== 'format' && e.code !== 'unsupported')) toast(errText(e), 'error');
      else view();
    }
  }
  function up(p) {
    if (p.loc.path) { const from = baseOf(p.loc.path); p.loc = { mount: p.loc.mount, path: parentOf(p.loc.path) }; p.sel.clear(); refresh(p, from); return; }
    if (p.loc.mount) { const m = p.loc.mount; p.loc = { mount: m.parent, path: parentOf(m.src) }; p.sel.clear(); refresh(p, baseOf(m.src)); }
  }
  function goRoot(p) { p.loc = { mount: null, path: '' }; p.sel.clear(); refresh(p); }
  const toggleSel = (p, i) => { const n = p.rows[i]; if (!n || n.up) return; if (p.sel.has(n.name)) p.sel.delete(n.name); else p.sel.add(n.name); };
  /** Selected nodes of a panel, or the node under the cursor. */
  function picked(p = A()) {
    const sel = p.rows.filter((r) => !r.up && p.sel.has(r.name));
    if (sel.length) return sel;
    const n = p.rows[p.cur];
    return n && !n.up ? [n] : [];
  }

  // --- operations -------------------------------------------------------------------------------------------------
  const fail = (e) => {
    if (!e || e.code === 'aborted') return;
    if (e.code === 'readonly') toast(t('fm.ro.' + (e.reason || 'format')), 'warn');
    else if (e.code === 'single') toast(t('fm.singleOnly'), 'warn');
    else toast(errText(e), 'error');
  };
  const log = (s) => { out.append(h('div', null, s)); while (out.children.length > 4) out.firstElementChild.remove(); };

  async function transferDialog(move) {
    const src = A(), dst = B();
    const nodes = picked(src);
    if (!nodes.length) return;
    const one = nodes.length === 1;
    const name = h('input', { type: 'text', class: 'ed-input fm-dest-name', value: one ? nodes[0].name : '', dir: 'auto', 'aria-label': t('fm.nameInDest') });
    const body = h('div', { class: 'fm-dlg' },
      h('p', { class: 'ed-dlg-text' }, t(move ? 'fm.moveText' : 'fm.copyText', { n: nodes.length, what: one ? nodes[0].name : t('fm.nItems', { n: nodes.length }) })),
      h('div', { class: 'fm-dest' }, iconEl('folder'), h('code', null, locText(dst.loc))),
      one ? h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('fm.nameInDest')), name) : null);
    const v = await openDialog({ title: t(move ? 'fm.k.move' : 'fm.k.copy'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t(move ? 'fm.k.move' : 'fm.k.copy'), value: 'ok', primary: true }] });
    if (v !== 'ok') return;
    await transfer(src, nodes, dst.loc, { move, rename: one ? name.value.trim() || nodes[0].name : null });
  }

  /** Copies (or moves) nodes of panel src into loc. */
  // Checks before any work: same folder, folder into itself (workspace only — archives cannot contain their own container
  // by construction), read-only target / source, name clashes (confirmed). Move = copy then delete: never loses data if
  // the copy fails half-way.
  async function transfer(src, nodes, loc, { move = false, rename = null } = {}) {
    const same = src.loc.mount === loc.mount && src.loc.path === loc.path;
    if (same && (!rename || rename === nodes[0].name || nodes.length > 1)) { toast(t('fm.sameFolder'), 'warn'); return false; }
    if (!src.loc.mount && !loc.mount) {
      // Into itself?
      for (const n of nodes) { const p = join(src.loc.path, n.name); if (n.dir && (loc.path === p || loc.path.startsWith(p + '/'))) { toast(t('fm.intoItself'), 'warn'); return false; } }
    }
    if (loc.mount && !rw(loc.mount)) { fail({ code: 'readonly', reason: loc.mount.readonly }); return false; }
    if (move && src.loc.mount && !rw(src.loc.mount)) { fail({ code: 'readonly', reason: src.loc.mount.readonly }); return false; }
    const target = dirOf(loc);
    const clash = nodes.filter((n) => target.kids.has(nodes.length === 1 && rename ? rename : n.name));
    if (clash.length && !same) {
      const ok = await confirmDialog(t('fm.overwriteTitle'), t('fm.overwriteText', { n: clash.length, name: clash[0].name }), t('fm.overwrite'), true);
      if (!ok) return false;
    }
    try {
      const items = await gather(src.loc, nodes, rename);
      await writeItems(loc, items);
      if (move) await removeNodes(src.loc, nodes);
      src.sel.clear();
      refreshAll();
      const files = items.filter((x) => !x.dir).length;
      log(t(move ? 'fm.moved' : 'fm.copied', { n: files, dest: locText(loc) }));
      toast(t(move ? 'fm.moved' : 'fm.copied', { n: files, dest: locText(loc) }), 'ok');
      return true;
    } catch (e) { fail(e); refreshAll(); return false; }
  }

  // Workspace rename is an in-place re-key of the Map; inside an archive it is a move within the same location (repack).
  async function rename() {
    const p = A(), n = picked(p)[0];
    if (!n) return;
    const v = await promptDialog(t('fm.k.rename'), t('fm.newName'), n.name, { selectEnd: n.dir ? null : Math.max(0, n.name.lastIndexOf('.')) || null });
    if (!v || v === n.name) return;
    if (/[/\\]/.test(v)) { toast(t('fm.badName'), 'warn'); return; }
    if (!p.loc.mount) {
      const d = dirOf(p.loc);
      if (d.kids.has(v)) { toast(t('fm.exists', { name: v }), 'warn'); return; }
      dropMounts((m) => !m.parent && (m.src === join(p.loc.path, n.name) || m.src.startsWith(join(p.loc.path, n.name) + '/')));
      d.kids.delete(n.name);
      n.name = v;
      d.kids.set(v, n);
      refresh(p, v);
      return;
    }
    if (await transfer(p, [n], p.loc, { move: true, rename: v })) refresh(p, v);
  }

  // Rejects absolute paths and ".." segments: nested folders ("a/b") are allowed, escaping the current location is not.
  async function mkdir(nameArg) {
    const p = A();
    const v = nameArg || await promptDialog(t('fm.k.mkdir'), t('fm.folderName'), '');
    if (!v) return;
    if (/^[/\\]|(^|[/\\])\.\.([/\\]|$)/.test(v)) { toast(t('fm.badName'), 'warn'); return; }
    try {
      await writeItems(p.loc, [{ rel: v.replace(/\\/g, '/').replace(/\/+$/, ''), dir: true }]);
      refresh(p, v.split(/[/\\]/)[0]);
      log(t('fm.made', { name: v }));
    } catch (e) { fail(e); }
  }

  async function del() {
    const p = A(), nodes = picked(p);
    if (!nodes.length) return;
    const ok = await confirmDialog(t('fm.k.delete'), t('fm.deleteText', { what: nodes.length === 1 ? nodes[0].name : t('fm.nItems', { n: nodes.length }) }), t('fm.k.delete'), true);
    if (!ok) return;
    try { await removeNodes(p.loc, nodes); p.sel.clear(); refreshAll(); log(t('fm.deleted', { n: nodes.length })); } catch (e) { fail(e); }
  }

  async function view(node, mode) {
    const p = A(), n = node || p.rows[p.cur];
    if (!n || n.up) return;
    if (n.dir) { const s = dirStats(n); toast(n.name + ': ' + t('fm.dirInfo', { n: s.files, files: fmtCount(s.files), size: fmtSize(s.size) }), 'info'); return; }
    try {
      const blob = await blobOf(p.loc, n);
      const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
      const ty = detectType(head, n.name);
      n.type = ty;
      await openViewer({ name: n.name, blob, type: ty.label + ' · ' + ty.mime, mode: mode || (ty.kind === 'text' ? 'text' : 'hex') });
      p.list.focus({ preventScroll: true });
    } catch (e) { fail(e); }
  }

  // Plain text editor up to 8 MiB. Encoding guess: valid UTF-8 stays UTF-8; otherwise Cyrillic letters in the decoded
  // preview suggest Windows-1251, else Latin-1. UTF-16 LE keeps its BOM on save.
  async function edit(create = false, nameArg) {
    const p = A();
    let n = create ? null : p.rows[p.cur];
    if (!create && (!n || n.up || n.dir)) return;
    if (p.loc.mount && !rw(p.loc.mount)) { fail({ code: 'readonly', reason: p.loc.mount.readonly }); return; }
    let name = n ? n.name : nameArg || await promptDialog(t('fm.k.new'), t('fm.fileName'), 'new.txt', { selectEnd: 3 });
    if (!name) return;
    if (create && dirOf(p.loc).kids.has(name)) n = dirOf(p.loc).kids.get(name);
    let bytes = new Uint8Array(0);
    try { if (n) bytes = new Uint8Array(await (await blobOf(p.loc, n)).arrayBuffer()); } catch (e) { fail(e); return; }
    if (bytes.length > 8 << 20) { toast(t('fm.tooBig'), 'warn'); return; }
    let enc = 'utf-8';
    const text = decodePreview(bytes);
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { enc = /[Ѐ-ӿ]/.test(text) ? 'windows-1251' : 'latin1'; }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) enc = 'utf-16le';
    const ta = h('textarea', { class: 'ed-input fm-editor', spellcheck: 'false', dir: 'auto', 'aria-label': name }, text);
    const encSel = h('select', { class: 'ed-input ed-select fm-enc', 'aria-label': t('hx.encoding') }, ENCODINGS.map(([v, l]) => h('option', { value: v, selected: v === enc }, l)));
    const body = h('div', { class: 'fm-edit' }, h('div', { class: 'fm-edit-bar' }, h('span', { class: 'ed-label' }, t('hx.encoding')), encSel, h('span', { class: 'ed-spacer' }), h('span', { class: 'ax-muted' }, t('fm.editHint'))), ta);
    const save = async () => {
      const e = encSel.value;
      let data = encodeText(ta.value, e);
      if (e === 'utf-16le') data = Uint8Array.from([0xff, 0xfe, ...data]);
      try {
        await writeItems(p.loc, [{ rel: name, blob: new Blob([data]), mtime: Date.now() }]);
        refresh(p, name);
        log(t('fm.saved', { name }));
        return true;
      } catch (err) { fail(err); return false; }
    };
    const v = await openDialog({
      title: t('fm.editing', { name }), body, wide: true, className: 'fm-edit-dlg',
      buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('fm.saveFile'), value: 'save', primary: true, onClick: save }],
      onMount: ({ el, close }) => el.addEventListener('keydown', (e) => {
        if ((e.key === 's' && (e.ctrlKey || e.metaKey)) || e.key === 'F2') { e.preventDefault(); save().then((ok) => ok && close('save')); }
      }),
    });
    void v;
    p.list.focus({ preventScroll: true });
  }

  // The dialog opens immediately; checksums arrive later from a hash job and fill the placeholders.
  async function properties(node) {
    const p = A(), n = node || p.rows[p.cur];
    if (!n || n.up) return;
    const rows = [[t('ax.path'), locText({ mount: p.loc.mount, path: join(p.loc.path, n.name) })]];
    if (n.dir) {
      const s = dirStats(n);
      rows.push([t('ax.files'), fmtCount(s.files)], [t('ax.folders'), fmtCount(s.dirs)], [t('ax.size'), fmtSize(s.size)]);
      openDialog({ title: n.name, body: kvList(rows), wide: true });
      return;
    }
    let blob;
    try { blob = await blobOf(p.loc, n); } catch (e) { fail(e); return; }
    const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
    const ty = detectType(head, n.name);
    n.type = ty;
    rows.push([t('ax.size'), fmtSize(blob.size) + ` (${fmtCount(blob.size)} ${t('ax.u.b')})`], [t('ax.modified'), fmtDate(n.mtime instanceof Date ? n.mtime.getTime() : n.mtime, true)],
      [t('fm.col.type'), ty.label + (ty.detail ? ' (' + ty.detail + ')' : '')], [t('fm.mime'), ty.mime], [t('fm.detectedBy'), t('fm.by.' + ty.by)]);
    if (n.entry) rows.push([t('ax.method'), n.entry.method || ''], [t('ax.packed'), n.entry.packed != null ? fmtSize(n.entry.packed) : '']);
    const sums = h('dl', { class: 'ap-kv ax-kv fm-sums' }, ['crc32', 'md5', 'sha1', 'sha256'].flatMap((a) => [h('dt', null, { crc32: 'CRC-32', md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256' }[a]), h('dd', { dataset: { algo: a } }, h('span', { class: 'ax-muted' }, '…'))]));
    const buttons = [];
    const isArc = ty.kind === 'archive';
    if (isArc) buttons.push({ label: t('fm.k.test'), icon: 'shield', onClick: () => { testNode(p, n); return true; } });
    buttons.push({ label: t('fm.k.view'), icon: 'eye', onClick: () => { view(n); return true; } }, { label: t('dlg.close'), value: null, primary: true });
    openDialog({ title: n.name, body: h('div', { class: 'fm-props' }, kvList(rows), h('h3', { class: 'ax-sub' }, t('fm.checksums')), sums), wide: true, buttons, className: 'fm-props-dlg' });
    try {
      const r = await job({ op: 'hash', blob, name: n.name }, { label: t('fm.hashing', { name: n.name }) });
      for (const dd of sums.querySelectorAll('dd')) {
        const v = r.sums[dd.dataset.algo];
        dd.replaceChildren(h('code', { class: 'fm-hash' }, v), h('button', { type: 'button', class: 'ed-iconbtn fm-copy', title: t('ax.ctx.copyName'), 'aria-label': t('fm.copyHash'), onclick: () => navigator.clipboard && navigator.clipboard.writeText(v).then(() => toast(t('ap.copied'), 'ok'), () => {}) }, iconEl('copy')));
      }
      n.sums = r.sums;
    } catch (e) { for (const dd of sums.querySelectorAll('dd')) dd.textContent = '—'; fail(e); }
  }
  const kvList = (rows) => h('dl', { class: 'ap-kv ax-kv' }, rows.filter((r) => r[1] !== '' && r[1] != null).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));

  async function testNode(p, n) {
    try {
      const m = n ? await openMount(p.loc, n) : p.loc.mount;
      if (!m) { toast(t('fm.notArchive'), 'warn'); return; }
      const res = await job({ op: 'test', key: m.key }, { label: t('ax.testing') });
      const bad = res.results.filter((r) => !r.ok);
      const msg = bad.length ? t('ax.testBad', { n: bad.length }) : t('ax.testOk', { n: res.results.length });
      log(m.name + ': ' + msg);
      openDialog({
        title: t('ax.testTitle'), wide: true,
        body: h('div', { class: 'ax-report fm-test' }, h('div', { class: 'ax-test-head ' + (bad.length ? 'ax-bad' : 'ax-good') }, iconEl(bad.length ? 'warn' : 'check'), h('b', null, m.name + ': ' + msg)),
          bad.length ? h('ul', { class: 'ax-errlist' }, bad.slice(0, 200).map((x) => h('li', null, h('b', null, x.path), h('span', null, errText(x))))) : null),
      });
    } catch (e) { fail(e); }
  }
  // The archive under the cursor, else the archive this panel is in.
  function testCurrent() {
    const p = A(), n = p.rows[p.cur];
    const arc = n && !n.up && !n.dir && ((n.type && n.type.kind === 'archive') || kindOf(n.name) === 'archive' || packFormatOf(n.name));
    if (arc) testNode(p, n); else if (p.loc.mount) testNode(p, null); else toast(t('fm.notArchive'), 'warn');
  }

  // Two selected files in the active panel, or the cursor files of both panels.
  async function compareFiles() {
    const a = A();
    let pa = a, pb = B(), na, nb;
    const sel = a.rows.filter((r) => !r.up && !r.dir && a.sel.has(r.name));
    if (sel.length === 2) { [na, nb] = sel; pb = a; } else { na = a.rows[a.cur]; nb = pb.rows[pb.cur]; }
    if (!na || !nb || na.up || nb.up || na.dir || nb.dir) { toast(t('fm.cmpPick'), 'warn'); return; }
    try {
      const ba = await blobOf(pa.loc, na), bb = await blobOf(pb.loc, nb);
      const r = await job({ op: 'compare', a: ba, b: bb }, { label: t('fm.comparing') });
      const head = h('div', { class: 'ax-test-head ' + (r.equal ? 'ax-good' : 'ax-bad') }, iconEl(r.equal ? 'check' : 'warn'),
        h('div', null, h('b', null, r.equal ? t('fm.identical') : t('fm.differ', { off: '0x' + r.first.toString(16).toUpperCase(), dec: fmtCount(r.first) })),
          h('div', { class: 'ax-muted' }, t('fm.cmpSizes', { a: fmtCount(r.sizeA), b: fmtCount(r.sizeB), n: fmtCount(r.count) }))));
      const table = r.diffs.length ? h('div', { class: 'ap-table-wrap fm-cmp-table' }, h('table', { class: 'ap-table' },
        h('thead', null, h('tr', null, h('th', null, t('hx.offset')), h('th', null, na.name), h('th', null, nb.name))),
        h('tbody', null, r.diffs.slice(0, 200).map(([o, x, y]) => h('tr', null, h('td', null, '0x' + o.toString(16).toUpperCase()), h('td', null, x.toString(16).padStart(2, '0')), h('td', null, y.toString(16).padStart(2, '0'))))))) : null;
      log(na.name + ' ↔ ' + nb.name + ': ' + (r.equal ? t('fm.identical') : t('fm.differAt', { off: '0x' + r.first.toString(16).toUpperCase() })));
      openDialog({
        title: t('fm.k.compare'), wide: true, body: h('div', { class: 'ax-report fm-cmp' }, h('p', { class: 'ed-dlg-text' }, na.name + ' ↔ ' + nb.name), head, table),
        buttons: r.equal ? undefined : [{ label: t('fm.showDiff'), icon: 'eye', onClick: () => { openViewer({ name: na.name, blob: ba, mode: 'hex', offset: r.first }); return true; } }, { label: t('dlg.close'), value: null, primary: true }],
      });
      return r;
    } catch (e) { fail(e); return null; }
  }

  // Single-file formats (gz, xz …) are disabled for several items or a folder: they compress one stream, not a tree.
  async function packDialog() {
    const p = A(), nodes = picked(p);
    if (!nodes.length) return;
    const base = nodes.length === 1 ? nodes[0].name.replace(/\.[^.]+$/, '') || nodes[0].name : baseOf(p.loc.path) || 'archive';
    const fmtSel = h('select', { class: 'ed-input ed-select fm-pack-fmt', 'aria-label': t('fm.format') }, PACK_FORMATS.map((f) => h('option', { value: f.id, disabled: f.single && (nodes.length > 1 || nodes[0].dir) }, f.label)));
    fmtSel.value = 'tar.gz';
    const nameInp = h('input', { type: 'text', class: 'ed-input fm-pack-name', value: base + '.tar.gz', dir: 'auto', 'aria-label': t('fm.archiveName') });
    const lvl = h('input', { type: 'range', class: 'ed-range fm-pack-level', min: 1, max: 9, value: 6 });
    const lvlOut = h('output', { class: 'ed-range-val' }, '6');
    const destSel = h('select', { class: 'ed-input ed-select fm-pack-dest', 'aria-label': t('fm.destination') }, [h('option', { value: 'here' }, t('fm.destHere', { path: locText(p.loc) })), h('option', { value: 'other' }, t('fm.destOther', { path: locText(B().loc) }))]);
    const syncFmt = () => {
      const f = PACK_FORMATS.find((x) => x.id === fmtSel.value);
      nameInp.value = nameInp.value.replace(/(\.tar)?\.[a-z0-9]+$/i, '') + f.ext;
      lvl.disabled = !f.levels;
      if (f.levels) { lvl.min = f.levels[0]; lvl.max = f.levels[1]; lvl.value = f.levels[2]; lvlOut.textContent = String(f.levels[2]); } else lvlOut.textContent = '—';
    };
    fmtSel.addEventListener('change', syncFmt);
    lvl.addEventListener('input', () => { lvlOut.textContent = lvl.value; });
    syncFmt();
    const body = h('div', { class: 'fm-dlg fm-pack' },
      h('p', { class: 'ed-dlg-text' }, t('fm.packText', { what: nodes.length === 1 ? nodes[0].name : t('fm.nItems', { n: nodes.length }) })),
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('fm.archiveName')), nameInp),
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('fm.format')), fmtSel),
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('fm.level')), h('div', { class: 'ed-range-wrap' }, lvl, lvlOut)),
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('fm.destination')), destSel),
      h('div', { class: 'ed-hint' }, t('fm.packHint')));
    const v = await openDialog({ title: t('fm.k.pack'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('fm.k.pack'), value: 'ok', primary: true }] });
    if (v !== 'ok') return;
    const f = PACK_FORMATS.find((x) => x.id === fmtSel.value);
    await pack(p, nodes, nameInp.value.trim() || base + f.ext, f.id, lvl.disabled ? undefined : +lvl.value, destSel.value === 'other' ? B().loc : p.loc);
  }

  async function pack(p, nodes, name, format, level, loc) {
    try {
      const items = await gather(p.loc, nodes);
      const res = await job({ op: 'pack', format, level, items: items.map((x) => ({ path: x.rel, dir: x.dir, blob: x.blob, mtime: x.mtime })) }, { label: t('fm.packing', { name }) });
      await writeItems(loc, [{ rel: name, blob: res.blob, mtime: Date.now() }]);
      p.sel.clear();
      refreshAll();
      const tp = panels.find((x) => x.loc.mount === loc.mount && x.loc.path === loc.path);
      if (tp) refresh(tp, name);
      log(t('fm.packed', { name, size: fmtSize(res.size) }));
      toast(t('fm.packed', { name, size: fmtSize(res.size) }), 'ok');
      return true;
    } catch (e) { fail(e); return false; }
  }

  // Content search tries UTF-8 and Windows-1251 encodings of the text. Files inside archives are matched by name only (no blob in the tree).
  async function findDialog(maskArg) {
    const p = A();
    const mask = h('input', { type: 'text', class: 'ed-input fm-find-mask', value: maskArg || '*', 'aria-label': t('fm.mask') });
    const text = h('input', { type: 'text', class: 'ed-input fm-find-text', 'aria-label': t('fm.containing') });
    const fold = h('input', { type: 'checkbox', checked: true });
    const results = h('ol', { class: 'fm-results' });
    const status = h('div', { class: 'ax-muted fm-find-status', 'aria-live': 'polite' });
    let close = () => {};
    const run = async () => {
      results.replaceChildren();
      const match = maskRe(mask.value);
      const pat = text.value ? parsePattern(text.value, { enc: 'utf-8', fold: fold.checked }) : null;
      const pat1251 = text.value ? parsePattern(text.value, { enc: 'windows-1251', fold: fold.checked }) : null;
      const found = [];
      const walk = async (d, base) => {
        for (const c of [...d.kids.values()].sort((a, b) => a.name.localeCompare(b.name))) {
          const rel = join(base, c.name);
          if (c.dir) { if (match(c.name) && !pat) found.push({ rel, node: c }); await walk(c, rel); continue; }
          if (!match(c.name)) continue;
          if (pat) {
            if (!c.blob) continue; // contents of archived files are not searched
            const b = new Uint8Array(await c.blob.arrayBuffer());
            if (findIn(b, pat) < 0 && findIn(b, pat1251) < 0) continue;
          }
          found.push({ rel, node: c });
          if (found.length >= 2000) return;
        }
      };
      status.textContent = t('hx.searching');
      await walk(dirOf(p.loc), p.loc.path);
      status.textContent = t('ax.found', { n: found.length }) + (p.loc.mount && pat ? ' · ' + t('fm.findNoContent') : '');
      results.replaceChildren(...found.map((x) => h('li', null, h('button', {
        type: 'button', class: 'fm-result', onclick: () => { close(); p.loc = { mount: p.loc.mount, path: parentOf(x.rel) }; p.sel.clear(); refresh(p, x.node.name); setActive(p.i); },
      }, h('span', { class: 'fm-ic', html: icon(x.node.dir ? 'folder' : 'file') }), x.rel))));
      return found;
    };
    const body = h('div', { class: 'fm-dlg fm-find' },
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('fm.mask')), mask),
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('fm.containing')), text),
      h('label', { class: 'hx-check' }, fold, h('span', null, t('hx.fold'))),
      h('div', { class: 'ed-hint' }, t('fm.findHint', { path: locText(p.loc) })), status, results);
    const pr = openDialog({
      title: t('fm.k.find'), body, wide: true, className: 'fm-find-dlg',
      buttons: [{ label: t('dlg.close'), value: null }, { label: t('fm.findGo'), icon: 'search', primary: true, onClick: () => { run(); return false; } }],
      onMount: ({ close: c }) => { close = c; },
    });
    if (maskArg) run();
    await pr;
  }

  function saveSelection() {
    const p = A(), nodes = picked(p);
    if (!nodes.length) return;
    (async () => {
      try {
        if (nodes.length === 1 && !nodes[0].dir) { download(await blobOf(p.loc, nodes[0]), nodes[0].name); return; }
        const items = await gather(p.loc, nodes);
        const res = await job({ op: 'pack', format: 'zip', items: items.map((x) => ({ path: x.rel, dir: x.dir, blob: x.blob, mtime: x.mtime })) }, { label: t('fm.packing', { name: 'zip' }) });
        download(res.blob, (nodes.length === 1 ? nodes[0].name : baseOf(p.loc.path) || 'files') + '.zip');
      } catch (e) { fail(e); }
    })();
  }

  function menuItems(p) {
    const n = p.rows[p.cur];
    if (!n || n.up) return [{ label: t('fm.k.mkdir'), icon: 'folder', action: () => mkdir() }, { label: t('fm.k.new'), icon: 'filePlus', action: () => edit(true) }];
    const sel = !n.up && p.sel.has(n.name);
    return [
      { label: t(n.dir ? 'fm.open' : 'fm.k.view'), icon: n.dir ? 'folder' : 'eye', kbd: n.dir ? 'Enter' : 'F3', action: () => (n.dir ? enter(p) : view()) },
      !n.dir ? { label: t('fm.openAsArchive'), icon: 'archive', kbd: 'Ctrl+PgDn', action: () => enter(p, true) } : null,
      !n.dir ? { label: t('fm.k.edit'), icon: 'edit', kbd: 'F4', action: () => edit() } : null,
      { sep: true },
      { label: t('fm.k.copy'), icon: 'copy', kbd: 'F5', action: () => transferDialog(false) },
      { label: t('fm.k.move'), icon: 'export', kbd: 'F6', action: () => transferDialog(true) },
      { label: t('fm.k.rename'), icon: 'edit', kbd: 'Shift+F6', action: () => rename() },
      { label: t('fm.k.pack'), icon: 'archive', kbd: 'F2', action: () => packDialog() },
      { label: t('fm.save'), icon: 'download', kbd: 'Ctrl+S', action: () => saveSelection() },
      { label: t('fm.k.delete'), icon: 'trash', kbd: 'F8', danger: true, action: () => del() },
      { sep: true },
      { label: t(sel ? 'ax.ctx.deselect' : 'ax.ctx.select'), icon: sel ? 'minus' : 'check', kbd: 'Ins', action: () => { toggleSel(p, p.cur); paint(p); } },
      { label: t('fm.k.info'), icon: 'info', kbd: 'F9', action: () => properties() },
    ].filter(Boolean);
  }

  function help() {
    const keys = [
      ['↑ ↓ Home End PgUp PgDn', 'fm.h.move'], ['Enter', 'fm.h.enter'], ['Backspace, Ctrl+PgUp', 'fm.h.up'], ['Ctrl+PgDn', 'fm.h.openArc'], ['Ctrl+\\', 'fm.h.root'],
      ['Tab', 'fm.h.tab'], ['Insert, Space, Shift+↑↓, Ctrl+A, *', 'fm.h.select'], ['F2', 'fm.k.pack'], ['F3', 'fm.h.view'], ['F4 / Shift+F4', 'fm.h.edit'],
      ['F5', 'fm.h.copy'], ['F6 / Shift+F6', 'fm.h.move6'], ['F7', 'fm.k.mkdir'], ['F8, Delete', 'fm.k.delete'], ['F9', 'fm.h.info'], ['Shift+F9', 'fm.k.test'],
      ['F10', 'fm.h.compare'], ['Alt+F7', 'fm.k.find'], ['Ctrl+U', 'fm.h.swap'], ['Ctrl+Enter', 'fm.h.name'], ['Ctrl+S', 'fm.save'],
      ['F4 · F7 · Shift+F7 · F8 · Ctrl+G', 'fm.h.viewer'],
    ];
    const cmds = ['cd <path>', 'mkdir <name>', 'touch <name>', 'rm <name>', 'pack <name.tar.gz> [level]', 'unpack', 'test', 'hash', 'cmp', 'find <mask>', 'view', 'hex', 'edit', 'save', 'mime', 'classic'];
    openDialog({
      title: t('fm.helpTitle'), wide: true, className: 'fm-help-dlg',
      body: h('div', { class: 'fm-help' },
        h('p', { class: 'ed-dlg-text' }, t('fm.helpLead')),
        h('table', { class: 'ap-table fm-help-keys' }, h('tbody', null, keys.map(([k, l]) => h('tr', null, h('td', null, h('kbd', { class: 'ed-kbd' }, k)), h('td', null, t(l)))))),
        h('h3', { class: 'ax-sub' }, t('fm.commands')),
        h('p', { class: 'ax-muted' }, t('fm.commandsLead')),
        h('div', { class: 'fm-cmds' }, cmds.map((c) => h('code', null, c)))),
    });
  }

  // --- command line ---------------------------------------------------------------------------------------------
  function findChild(p, name) { return name ? p.rows.find((r) => !r.up && r.name === name) || null : p.rows[p.cur] && !p.rows[p.cur].up ? p.rows[p.cur] : null; }
  // Command line verbs mirror the F-keys; aliases from DOS and Unix (md/mkdir, rm/del, cat/less) so either habit works.
  async function command(line) {
    const [c0, ...args] = splitArgs(line);
    const c = (c0 || '').toLowerCase();
    const p = A();
    log(locText(p.loc) + '> ' + line);
    switch (c) {
      case 'cd': {
        const to = args.join(' ');
        if (!to || to === '/' || to === '\\') { goRoot(p); return; }
        if (to === '..') { up(p); return; }
        for (const s of to.replace(/\\/g, '/').split('/').filter(Boolean)) {
          if (s === '..') { up(p); continue; }
          p.rows = rowsOf(p);
          const i = p.rows.findIndex((r) => r.name === s);
          if (i < 0) { log(t('fm.noSuch', { name: s })); return; }
          p.cur = i;
          await enter(p, true);
        }
        return;
      }
      case 'md': case 'mkdir': await mkdir(args.join(' ')); return;
      case 'touch': case 'new': await edit(true, args.join(' ')); return;
      case 'rm': case 'del': {
        const n = findChild(p, args.join(' '));
        if (!n) { log(t('fm.noSuch', { name: args.join(' ') })); return; }
        p.sel.clear(); p.cur = p.rows.indexOf(n); await del(); return;
      }
      case 'pack': case 'zip': {
        const name = args[0] || (picked(p)[0] ? picked(p)[0].name.replace(/\.[^.]+$/, '') + '.tar.gz' : 'archive.tar.gz');
        const format = packFormatOf(name) || 'zip';
        const nodes = picked(p);
        if (!nodes.length) { log(t('fm.nothing')); return; }
        await pack(p, nodes, packFormatOf(name) ? name : name + '.zip', format, args[1] ? +args[1] : undefined, p.loc);
        return;
      }
      case 'unpack': case 'extract': case 'x': {
        const n = findChild(p, args[0]);
        if (!n || n.dir) { log(t('fm.notArchive')); return; }
        try {
          const m = await openMount(p.loc, n);
          const nodes = [...m.root.kids.values()];
          const items = await gather({ mount: m, path: '' }, nodes);
          await writeItems(B().loc, items);
          refreshAll();
          log(t('fm.copied', { n: items.filter((x) => !x.dir).length, dest: locText(B().loc) }));
        } catch (e) { fail(e); }
        return;
      }
      case 'test': { const n = findChild(p, args[0]); if (n && !n.dir) await testNode(p, n); else testCurrent(); return; }
      case 'hash': case 'sum': case 'info': case 'props': { const n = findChild(p, args[0]); if (n) await properties(n); return; }
      case 'mime': case 'type': case 'file': {
        const n = findChild(p, args[0]);
        if (!n || n.dir) return;
        try { const b = await blobOf(p.loc, n); const ty = detectType(new Uint8Array(await b.slice(0, 65536).arrayBuffer()), n.name); n.type = ty; log(n.name + ': ' + ty.mime + ' — ' + ty.label + (ty.detail ? ' (' + ty.detail + ')' : '') + ' [' + t('fm.by.' + ty.by) + ']'); drawRows(p); } catch (e) { fail(e); }
        return;
      }
      case 'cmp': case 'fc': case 'diff': await compareFiles(); return;
      case 'find': case 'search': await findDialog(args.join(' ') || '*'); return;
      case 'view': case 'cat': case 'less': { const n = findChild(p, args[0]); if (n) await view(n); return; }
      case 'hex': { const n = findChild(p, args[0]); if (n) await view(n, 'hex'); return; }
      case 'edit': case 'nano': { const n = findChild(p, args[0]); if (n) { p.cur = p.rows.indexOf(n); await edit(); } return; }
      case 'save': case 'download': saveSelection(); return;
      case 'help': case '?': help(); return;
      case 'classic': case 'exit': if (onClassic) onClassic(); return;
      case 'cls': case 'clear': out.replaceChildren(); return;
      default: log(t('fm.unknownCmd', { cmd: c0 }));
    }
  }

  // --- keyboard ---------------------------------------------------------------------------------------------------
  // One key handler for the whole commander (event delegation): F-keys and navigation work whether focus is in a panel or in
  // the command line. Order matters: global keys first, then keys the command line keeps while it has text.
  root.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'Alt' || k === 'Shift') { const m = { alt: e.altKey, shift: e.shiftKey }; if (m.alt !== mod.alt || m.shift !== mod.shift) { mod = m; renderKeys(); } }
    const p = A();
    const inCmd = e.target === cmd;
    const fkey = /^F([1-9]|10)$/.test(k);
    if (fkey) {
      e.preventDefault();
      const set = e.altKey ? KEYS.alt : e.shiftKey ? KEYS.shift : KEYS.plain;
      const it = set[+k.slice(1) - 1];
      if (it && it[2]) it[2]();
      return;
    }
    // Tab switches panels (Far convention) instead of moving focus; the page Tab order is given up inside the commander.
    if (k === 'Tab') { e.preventDefault(); setActive(1 - active); return; }
    if (k === 'Enter') {
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && p.rows[p.cur] && !p.rows[p.cur].up) { const n = p.rows[p.cur].name; cmd.value += (cmd.value && !cmd.value.endsWith(' ') ? ' ' : '') + (/\s/.test(n) ? '"' + n + '"' : n); cmd.focus(); return; }
      if (cmd.value.trim()) { const v = cmd.value.trim(); cmd.value = ''; command(v); return; }
      enter(p);
      return;
    }
    if (k === 'Escape' && inCmd && cmd.value) { e.preventDefault(); cmd.value = ''; p.list.focus(); return; }
    if ((k === 'PageUp' || k === 'PageDown') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (k === 'PageUp') up(p); else enter(p, true); return; }
    if (k === '\\' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); goRoot(p); return; }
    if ((k === 'u' || k === 'U') && e.ctrlKey) { e.preventDefault(); const a = panels[0].loc; panels[0].loc = panels[1].loc; panels[1].loc = a; refreshAll(); return; }
    if ((k === 's' || k === 'S') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveSelection(); return; }
    // In the command line, editing keys stay there while it holds text.
    if (inCmd && cmd.value && /^(ArrowLeft|ArrowRight|Home|End|Backspace|Delete)$/.test(k)) return;
    const H = Math.max(1, Math.floor(p.list.clientHeight / rowH()) - 1);
    const move = { ArrowUp: -1, ArrowDown: 1, PageUp: -H, PageDown: H, Home: -1e9, End: 1e9 }[k];
    if (move != null && !e.altKey) {
      e.preventDefault();
      const was = p.cur;
      p.cur = Math.max(0, Math.min(p.rows.length - 1, p.cur + move));
      // Shift: the rows passed over are selected (as in Far, the row left behind joins the selection).
      if (e.shiftKey) { const a = Math.min(was, p.cur), b = Math.max(was, p.cur); for (let i = a; i <= b; i++) if (!p.rows[i].up && i !== p.cur) p.sel.add(p.rows[i].name); }
      paint(p);
      if (inCmd && !cmd.value) p.list.focus({ preventScroll: true });
      return;
    }
    if (inCmd) return;
    if (k === 'Insert' || k === ' ') { e.preventDefault(); toggleSel(p, p.cur); p.cur = Math.min(p.rows.length - 1, p.cur + 1); paint(p); return; }
    if (k === 'Backspace') { e.preventDefault(); up(p); return; }
    if (k === 'Delete') { e.preventDefault(); del(); return; }
    if ((k === 'a' || k === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); for (const r of p.rows) if (!r.up) p.sel.add(r.name); paint(p); return; }
    if (k === '*' && !e.ctrlKey) { e.preventDefault(); for (const r of p.rows) if (!r.up) toggleSel(p, p.rows.indexOf(r)); paint(p); return; }
    if (k === 'ArrowRight' && !e.ctrlKey) { e.preventDefault(); if (p.rows[p.cur] && p.rows[p.cur].dir) enter(p); return; }
    if (k === 'ArrowLeft' && !e.ctrlKey) { e.preventDefault(); up(p); return; }
    // Printable characters start the command line.
    // Type-to-command: any printable key while a panel has focus starts the command line, as in Far.
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); cmd.focus(); cmd.value += k; }
  });
  root.addEventListener('keyup', (e) => { const m = { alt: e.altKey, shift: e.shiftKey }; if (m.alt !== mod.alt || m.shift !== mod.shift) { mod = m; renderKeys(); } });
  // Modifier keyup is lost when the window loses focus mid-press; reset the key bar.
  // KNOWN DEFECT: this listener and the ResizeObserver below are never removed. relabel() in main.js creates a new
  // commander on every language switch, so old instances stay referenced. Fix: return a destroy() that removes them.
  window.addEventListener('blur', () => { if (mod.alt || mod.shift) { mod = { alt: false, shift: false }; renderKeys(); } });
  // Files dropped on a panel land in that panel's folder (or archive).
  for (const p of panels) {
    p.el.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); p.el.classList.add('fm-over'); } });
    // dragleave also fires when the pointer crosses into a child element, so the highlight may flicker; harmless.
    p.el.addEventListener('dragleave', () => p.el.classList.remove('fm-over'));
    p.el.addEventListener('drop', (e) => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); p.el.classList.remove('fm-over'); setActive(p.i); addFiles([...e.dataTransfer.files]); });
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { for (const p of panels) drawRows(p); }) : null;
  if (ro) for (const p of panels) ro.observe(p.list);

  /** Adds files (with webkitRelativePath folders when `tree`) to the active panel's folder or archive. */
  // webkitRelativePath (folder picker) keeps the folder structure; plain picks land flat in the current folder.
  async function addFiles(files, tree = false) {
    if (!files.length) return;
    const p = A();
    const items = files.map((f) => ({ rel: tree && f.webkitRelativePath ? f.webkitRelativePath : f.name, blob: f, mtime: f.lastModified || Date.now() }));
    try { await writeItems(p.loc, items); refreshAll(); refresh(p, baseOf(items[0].rel.split('/')[0])); log(t('fm.added', { n: items.length })); } catch (e) { fail(e); }
  }

  renderKeys();
  refreshAll();
  for (const p of panels) p.el.classList.toggle('fm-active', p.i === active);

  return {
    el: root, addFiles, state: S, progressEl: progress,
    focus: () => { requestAnimationFrame(() => { for (const p of panels) { p.spacer.style.height = p.rows.length * rowH() + 'px'; drawRows(p); } A().list.focus({ preventScroll: true }); }); },
    relabel: () => { renderKeys(); refreshAll(); },
    // Automation (e2e): operations without dialogs.
    api: { command, transfer: (move = false) => transfer(A(), picked(A()), B().loc, { move }), pack: (name, format, level) => pack(A(), picked(A()), name, format, level, A().loc), compareFiles, refreshAll, setActive, locText: (i) => locText(panels[i].loc) },
  };
}
