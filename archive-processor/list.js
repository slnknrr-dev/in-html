// archive-processor/list.js - the file list: a virtualized tree grid (only the visible rows exist in the DOM, so
// archives with hundreds of thousands of entries stay fast) with sortable column headers, check boxes, folders that open
// and close, and keyboard control (arrows, Home / End, Page keys, Space selects, Enter opens, Left / Right close / open
// folders, Ctrl+A selects everything).
// 
// Virtualization: rows have a fixed height (rowH), so the visible range is pure arithmetic from scrollTop; 8 extra rows
// above and below avoid blank flashes during fast scrolling. Each render rebuilds the visible rows (replaceChildren):
// ~40 rows is cheaper to recreate than to diff. Focus is restored to the active row after a rebuild.
// A11y: role=treegrid with aria-level/aria-expanded in tree mode, role=grid for flat/search results; aria-rowcount and
// aria-rowindex tell assistive tech the full size although most rows do not exist in the DOM. Roving tabindex: only the
// active row is tabbable.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { checkState } from './tree.js';
import { fmtDate, fmtSize, kindOf } from './fmt.js';

const ICON = { image: 'image', text: 'doc', audio: 'music', video: 'film', archive: 'archive', sheet: 'sheet', doc: 'doc', exe: 'terminal', file: 'file' };
export const COLUMNS = [
  { key: 'name', label: 'ax.col.name' },
  { key: 'size', label: 'ax.col.size', num: true },
  { key: 'packed', label: 'ax.col.packed', num: true },
  { key: 'mtime', label: 'ax.col.modified' },
  { key: 'method', label: 'ax.col.method' },
];

/**
 * createList({ onOpen(node), onToggle(node), onCheck(node, on), onSelectAll(on), onSort(key) })
 *   .el, .body (the scrolling grid), .setRows(rows, { flat, sort: { key, dir } }), .refresh(), .focus(),
 *   .nodeOf(element) -> the node of a row element, .activate(node) (makes it the active row)
 */
export function createList(cb) {
  let rows = [], flat = false, sort = { key: 'name', dir: 1 }, active = 0, rowH = 38, frame = 0;
  const head = h('div', { class: 'ax-head', role: 'row' });
  const spacer = h('div', { class: 'ax-spacer' });
  const body = h('div', { class: 'ax-body', role: 'treegrid', tabindex: '0', 'aria-multiselectable': 'true' }, spacer);
  const allBox = h('input', { type: 'checkbox', class: 'ax-check', 'aria-label': t('ax.selectAll') });
  allBox.addEventListener('change', () => cb.onSelectAll(allBox.checked));
  const el = h('div', { class: 'ax-grid' }, head, body);

  // Sort state exposed with aria-sort on the column header, the arrow icon is decorative.
  function renderHead() {
    allBox.setAttribute('aria-label', t('ax.selectAll'));
    head.replaceChildren(
      h('span', { class: 'ax-hc ax-c-check', role: 'columnheader' }, allBox),
      ...COLUMNS.map((c) => {
        const on = sort.key === c.key;
        return h('span', { class: `ax-hc ax-c-${c.key}`, role: 'columnheader', 'aria-sort': on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
          h('button', { type: 'button', class: 'ax-sort' + (on ? ' ax-on' : ''), onclick: () => cb.onSort(c.key) },
            t(c.label), on ? h('span', { class: 'ax-arrow', html: icon(sort.dir > 0 ? 'up' : 'down') }) : null));
      }));
  }

  function cells(n) {
    const e = n.entry;
    const st = checkState(n);
    const box = h('input', { type: 'checkbox', class: 'ax-check', tabindex: '-1', checked: st === 'all', 'aria-label': t('ax.selectItem', { name: n.name }) });
    // indeterminate exists only as a DOM property (no HTML attribute), hence set after creation.
    box.indeterminate = st === 'some';
    // stopPropagation: a click on the check box must not also trigger the row click (open / preview).
    box.addEventListener('click', (ev) => { ev.stopPropagation(); cb.onCheck(n, box.checked); });
    const kind = n.dir ? 'folder' : e && e.kind === 'symlink' ? 'link' : ICON[kindOf(n.name)] || 'file';
    const twist = n.dir && !flat
      ? h('button', { type: 'button', class: 'ax-twist', tabindex: '-1', 'aria-label': t(n.open ? 'ax.collapse' : 'ax.expand'), html: icon(n.open ? 'chevDown' : 'chevRight'),
        onclick: (ev) => { ev.stopPropagation(); cb.onToggle(n); } })
      : h('span', { class: 'ax-twist' });
    const badges = [];
    if (e && e.encrypted) badges.push(h('span', { class: 'ax-badge', title: t('ax.encrypted'), html: icon('lock') }));
    if (e && e.unsupported) badges.push(h('span', { class: 'ax-badge ax-warn', title: t('ax.unsupportedItem', { what: e.unsupported }), html: icon('warn') }));
    if (e && e.link) badges.push(h('span', { class: 'ax-link', title: e.link }, '→ ' + e.link));
    const parent = flat && n.parent && n.parent.path ? h('span', { class: 'ax-parent' }, n.parent.path + '/') : null;
    const size = n.dir ? (n.files ? fmtSize(n.size) : '') : e && e.size == null ? '—' : fmtSize(n.size);
    return [
      h('span', { class: 'ax-c ax-c-check', role: 'gridcell' }, box),
      h('span', { class: 'ax-c ax-c-name', role: 'gridcell', style: flat ? null : { '--lvl': n.depth } },
        twist, h('span', { class: 'ax-ico ax-k-' + kind, html: icon(kind) }),
        h('span', { class: 'ax-name' }, parent, h('span', { class: 'ax-base' }, n.name)), ...badges,
        n.dir ? h('span', { class: 'ax-count' }, n.files ? String(n.files) : '') : null),
      h('span', { class: 'ax-c ax-c-size', role: 'gridcell' }, size),
      h('span', { class: 'ax-c ax-c-packed', role: 'gridcell' }, n.dir ? '' : e && e.packed != null && (e.packed || !e.solid) ? fmtSize(e.packed) : ''),
      h('span', { class: 'ax-c ax-c-mtime', role: 'gridcell' }, fmtDate(n.mtime)),
      h('span', { class: 'ax-c ax-c-method', role: 'gridcell' }, n.dir ? '' : (e && e.method) || ''),
    ];
  }

  // aria-rowindex starts at 2: row 1 is the header row.
  function rowEl(i) {
    const n = rows[i];
    const st = checkState(n);
    const r = h('div', {
      class: 'ax-row' + (i === active ? ' ax-active' : '') + (st !== 'none' ? ' ax-sel' : '') + (n.dir ? ' ax-dir' : ''),
      role: 'row', 'aria-rowindex': String(i + 2), 'aria-selected': String(st === 'all'), tabindex: i === active ? '0' : '-1',
      'aria-level': flat ? null : String(n.depth + 1), 'aria-expanded': n.dir && !flat ? String(n.open) : null,
      style: { top: i * rowH + 'px', height: rowH + 'px' }, dataset: { i: String(i) },
    }, cells(n));
    r.addEventListener('click', () => { setActive(i, false); cb.onOpen(n); });
    return r;
  }

  // rAF-coalesced via schedule(): scroll and resize can fire many times per frame; one render per frame suffices.
  function render() {
    frame = 0;
    spacer.style.height = rows.length * rowH + 'px';
    const top = body.scrollTop, hgt = body.clientHeight || 600;
    const from = Math.max(0, Math.floor(top / rowH) - 8), to = Math.min(rows.length, Math.ceil((top + hgt) / rowH) + 8);
    const keepFocus = body.contains(document.activeElement) && document.activeElement !== body;
    const frag = [];
    for (let i = from; i < to; i++) frag.push(rowEl(i));
    spacer.replaceChildren(...frag);
    body.setAttribute('aria-rowcount', String(rows.length + 1));
    if (keepFocus) { const a = spacer.querySelector('.ax-active'); if (a) a.focus({ preventScroll: true }); else body.focus({ preventScroll: true }); }
    // The header check box reflects the whole selection.
    // Header box state from top-level rows only (depth 0) in tree mode: their states already aggregate everything below.
    const states = { all: 0, some: 0, none: 0 };
    for (const n of rows) if (n.depth === 0 || flat) states[checkState(n)]++;
    allBox.checked = rows.length > 0 && states.all > 0 && !states.some && !states.none;
    allBox.indeterminate = !allBox.checked && (states.all > 0 || states.some > 0);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  body.addEventListener('scroll', schedule, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(body);

  // Minimal scrolling: only when the active row leaves the viewport, aligned to the nearest edge.
  function setActive(i, scroll = true) {
    if (!rows.length) return;
    active = Math.max(0, Math.min(rows.length - 1, i));
    if (scroll) {
      const y = active * rowH;
      if (y < body.scrollTop) body.scrollTop = y;
      else if (y + rowH > body.scrollTop + body.clientHeight) body.scrollTop = y + rowH - body.clientHeight;
    }
    render();
    const a = spacer.querySelector('.ax-active');
    if (a) a.focus({ preventScroll: true });
  }

  body.addEventListener('keydown', (ev) => {
    if (!rows.length) return;
    const n = rows[active];
    const page = Math.max(1, Math.floor(body.clientHeight / rowH) - 1);
    const go = (i) => { ev.preventDefault(); setActive(i); };
    switch (ev.key) {
      case 'ArrowDown': return go(active + 1);
      case 'ArrowUp': return go(active - 1);
      case 'PageDown': return go(active + page);
      case 'PageUp': return go(active - page);
      case 'Home': return go(0);
      case 'End': return go(rows.length - 1);
      case ' ': ev.preventDefault(); cb.onCheck(n, checkState(n) !== 'all'); return;
      case 'Enter': ev.preventDefault(); cb.onOpen(n); return;
      // Tree keyboard pattern (WAI-ARIA treegrid): Right opens a closed folder or moves into an open one; Left closes or jumps to the parent.
      case 'ArrowRight':
        if (n.dir && !flat && !n.open) { ev.preventDefault(); cb.onToggle(n); } else if (n.dir && !flat) go(active + 1);
        return;
      case 'ArrowLeft':
        if (n.dir && !flat && n.open) { ev.preventDefault(); cb.onToggle(n); return; }
        if (!flat && n.parent && n.parent.depth >= 0) { const p = rows.indexOf(n.parent); if (p >= 0) go(p); }
        return;
      default:
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') { ev.preventDefault(); cb.onSelectAll(true); }
    }
  });
  body.addEventListener('focus', () => { if (rows.length && document.activeElement === body) setActive(active, false); });

  return {
    el,
    body,
    nodeOf(elm) { const r = elm && elm.closest && elm.closest('.ax-row'); return r && body.contains(r) ? rows[+r.dataset.i] || null : null; },
    activate(n) { const i = rows.indexOf(n); if (i >= 0 && i !== active) setActive(i, false); },
    // The active row is kept by identity across re-sorts and filter changes, so the cursor does not jump.
    setRows(next, opts = {}) {
      const keep = rows[active];
      rows = next;
      flat = !!opts.flat;
      if (opts.sort) sort = opts.sort;
      body.setAttribute('role', flat ? 'grid' : 'treegrid');
      const i = keep ? rows.indexOf(keep) : -1;
      active = i >= 0 ? i : Math.min(active, Math.max(0, rows.length - 1));
      if (opts.top) body.scrollTop = 0;
      renderHead();
      render();
    },
    refresh: render,
    relabel: () => { renderHead(); render(); },
    focus: () => { if (rows.length) setActive(active, false); else body.focus(); }, // the active row itself (no focus event needed)
    setRowHeight(px) { rowH = px; render(); },
  };
}
