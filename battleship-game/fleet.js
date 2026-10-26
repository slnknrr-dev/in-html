// battleship-game/fleet.js - the placement screen: the sea and a dock of the ships still to place. Drag a ship from the
// dock (or a placed ship) onto the sea; tap a ship to select it and tap again to turn it (or press R, or touch the sea
// with a second finger while dragging); a selected ship moves with the arrow keys and goes back to the dock with
// Delete; tap a free cell to drop the selected dock ship there. Random places the whole fleet with a strategy (uniform,
// along the edges, in the open sea, spread out, anti-density), Clear empties the sea, layouts can be saved per ruleset
// and loaded again, and rulesets with mines get a mine mode. Ready sends the layout once it is complete and legal.
//
//   renderPlacement(host, { rs, title, onReady(layout), onMenu?, skin, motion }) -> { el, destroy, setWaiting(text | null) }

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { openMenu, promptDialog, toast } from '../ui/overlays.js';
import { geometry, placementCells, compatible } from '../battleship/board.js';
import { randomLayout, validateLayout } from '../battleship/placement.js';
import { cryptoRandom } from '../prng/prng.js';
import { createGrid } from './grid.js';
import { applySkin } from './skins.js';
import { shipName, cellLabel } from './names.js';
import { store, save, layoutsFor, putLayout, removeLayout } from './store.js';
import { play } from './sound.js';

// Design: the screen keeps a local model (placed ships, dock, selection) and validates every move against the ruleset
// geometry (battleship/placement.js), so an illegal drop is shown red (.bs-invalid) and refused instead of being
// discovered by the server. Placement strategies come from the same library the bots use; 'uniform' samples layouts
// uniformly (MCMC), the others bias it, which matters because bots exploit non-uniform human layouts.
const STRATS = ['uniform', 'edges', 'sea', 'spread', 'antiDensity', 'random'];

export function renderPlacement(host, o) {
  const rs = o.rs;
  const G = geometry(rs);
  const rng = cryptoRandom();
  const ships = rs.ships.map((tt, key) => ({ key, t: tt, o: 0, x: -1, y: -1, placed: false }));
  let mines = [];
  let sel = -1, mineMode = false, drag = null, waiting = null;
  const history = [];
  const snapshot = () => JSON.stringify({ ships: ships.map((s) => [s.o, s.x, s.y, s.placed]), mines });
  const pushHist = () => { history.push(snapshot()); if (history.length > 60) history.shift(); };
  const restore = (j) => { const d = JSON.parse(j); d.ships.forEach((v, i) => { [ships[i].o, ships[i].x, ships[i].y, ships[i].placed] = v; }); mines = d.mines; };

  const root = h('section', { class: 'bs-place bs-screen' });
  applySkin(root, o.skin);
  host.append(root);
  const status = h('p', { class: 'bs-place-status', 'aria-live': 'polite' });
  const gridBox = h('div', { class: 'bs-place-sea' });
  const dock = h('div', { class: 'bs-dock', role: 'listbox', 'aria-label': t('pl.dock') });
  const tools = h('div', { class: 'bs-place-tools' });
  const readyBtn = h('button', { type: 'button', class: 'bs-bigbtn bs-ready', onclick: ready }, iconEl('check'), t('pl.ready'));
  const head = h('div', { class: 'bs-screen-h' },
    o.onMenu ? h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('tb.menu'), dataset: { b: 'menu' }, onclick: (e) => o.onMenu(e.currentTarget) }, iconEl('menu')) : null,
    h('h2', {}, o.title || t('pl.title')));
  root.append(...[head, status].filter(Boolean), h('div', { class: 'bs-place-main' }, gridBox, h('div', { class: 'bs-place-side' }, dock, tools, readyBtn)));

  const grid = createGrid(gridBox, {
    rs, interactive: true, label: t('pl.sea'),
    onCell: (c, info) => onTap(c, info),
    menu: (c) => cellMenu(c),
  });

  // --- the model ---------------------------------------------------------------------------------------------------
  const pOf = (s, oo = s.o, x = s.x, y = s.y) => G.types[s.t].at(oo, x, y);
  const cellsOf = (s, oo = s.o, x = s.x, y = s.y) => { const p = pOf(s, oo, x, y); return p >= 0 ? Array.from(placementCells(G, s.t, p)) : null; };
  function fits(s, oo, x, y, except = s.key) {
    const p = pOf(s, oo, x, y);
    if (p < 0) return false;
    for (const q of ships) {
      if (!q.placed || q.key === except) continue;
      if (!compatible(G, s.t, p, q.t, pOf(q))) return false;
    }
    const cs = placementCells(G, s.t, p);
    for (const c of cs) if (mines.includes(c)) return false;
    return true;
  }
  const shipAt = (c) => ships.find((s) => s.placed && cellsOf(s).includes(c)) || null;
  const placedCount = () => ships.filter((s) => s.placed).length;
  const layout = () => ({ ships: ships.filter((s) => s.placed).map((s) => ({ t: s.t, o: s.o, x: s.x, y: s.y })), mines: mines.slice() });
  const invalidKeys = () => {
    const bad = new Set();
    for (const s of ships) if (s.placed && !fits(s, s.o, s.x, s.y)) bad.add(s.key);
    return bad;
  };

  // --- drawing -----------------------------------------------------------------------------------------------------
  function render() {
    const bad = invalidKeys();
    const list = [];
    for (const s of ships) {
      if (!s.placed || (drag && drag.key === s.key && drag.moved)) continue;
      list.push({ t: s.t, cells: cellsOf(s), key: s.key, selected: s.key === sel, invalid: bad.has(s.key) });
    }
    if (drag && drag.moved && drag.at) {
      const s = ships[drag.key];
      const cs = cellsOf(s, drag.o, drag.at[0], drag.at[1]);
      if (cs) list.push({ t: s.t, cells: cs, ghost: true, invalid: !fits(s, drag.o, drag.at[0], drag.at[1]), key: 'g' });
    }
    grid.render({ ships: list, mines, marks: null, motion: o.motion, active: true });
    renderDock();
    renderTools();
    const complete = placedCount() === ships.length && !bad.size && mines.length === rs.weapons.mines;
    readyBtn.disabled = !complete || !!waiting;
    if (waiting) status.textContent = waiting;
    else if (mineMode) status.textContent = t('pl.minesHint', { n: rs.weapons.mines - mines.length });
    else if (bad.size) status.textContent = t(rs.rules.touch === 'any' ? 'pl.overlap' : 'pl.touching');
    else if (placedCount() < ships.length) status.textContent = t('pl.left', { n: ships.length - placedCount() });
    else if (mines.length < rs.weapons.mines) status.textContent = t('pl.minesLeft', { n: rs.weapons.mines - mines.length });
    else status.textContent = t('pl.done');
    root.classList.toggle('bs-waiting', !!waiting);
  }

  function shapeSVG(s, oo) {
    const cl = G.types[s.t].orients[oo % G.types[s.t].orients.length];
    const w = Math.max(...cl.map((p) => p[0])) + 1, hh = Math.max(...cl.map((p) => p[1])) + 1;
    return `<svg viewBox="-0.1 -0.1 ${w + 0.2} ${hh + 0.2}" width="${w * 16}" height="${hh * 16}" aria-hidden="true">${cl.map(([x, y]) => `<rect class="bs-dockcell" x="${x + 0.08}" y="${y + 0.08}" width=".84" height=".84" rx=".18"/>`).join('')}</svg>`;
  }

  function renderDock() {
    dock.textContent = '';
    // group the unplaced ships by type (one button per type, with a count)
    const groups = new Map();
    for (const s of ships) if (!s.placed) { if (!groups.has(s.t)) groups.set(s.t, []); groups.get(s.t).push(s); }
    if (!groups.size) { dock.append(h('p', { class: 'ed-hint bs-dock-empty' }, t('pl.allPlaced'))); return; }
    for (const [tt, list] of groups) {
      const s = list.find((x) => x.key === sel) || list[0];
      const b = h('button', { type: 'button', class: 'bs-dockship' + (list.some((x) => x.key === sel) ? ' bs-on' : ''), role: 'option', 'aria-selected': String(list.some((x) => x.key === sel)), dataset: { key: String(s.key) }, title: shipName(rs, tt), 'aria-label': shipName(rs, tt) + ' × ' + list.length },
        h('span', { class: 'bs-dockpic', html: shapeSVG(s, s.o) }), h('span', { class: 'bs-docklabel' }, shipName(rs, tt)), list.length > 1 ? h('b', { class: 'bs-dockn' }, '×' + list.length) : null);
      b.addEventListener('click', () => { if (drag && drag.moved) return; sel = s.key; mineMode = false; play('rotate'); render(); });
      b.addEventListener('pointerdown', (e) => startDrag(e, s.key, true));
      dock.append(b);
    }
  }

  function renderTools() {
    tools.textContent = '';
    const tb = (icon, label, fn, extra = {}) => h('button', { type: 'button', class: 'ed-btn bs-tool', title: label, ...extra, onclick: fn }, iconEl(icon), h('span', {}, label));
    const s = sel >= 0 ? ships[sel] : null;
    tools.append(...[
      tb('replace', t('pl.rotate') + ' (R)', () => rotateSel(), { disabled: !s, dataset: { b: 'rotate' } }),
      tb('grid', t('pl.random'), (e) => randomMenu(e.currentTarget), { dataset: { b: 'random' } }),
      tb('trash', t('pl.clear'), () => { pushHist(); for (const x of ships) x.placed = false; mines = []; sel = 0; render(); }, { dataset: { b: 'clear' } }),
      tb('undo', t('pl.undo'), () => { if (history.length) { restore(history.pop()); render(); } }, { disabled: !history.length, dataset: { b: 'undo' } }),
      tb('save', t('pl.layouts'), (e) => layoutsMenu(e.currentTarget), { dataset: { b: 'layouts' } }),
      rs.weapons.mines ? tb('star', t('pl.mines', { n: rs.weapons.mines }), () => { mineMode = !mineMode; sel = -1; render(); }, { class: 'ed-btn bs-tool' + (mineMode ? ' ed-on' : ''), 'aria-pressed': String(mineMode), dataset: { b: 'mines' } }) : null].filter(Boolean));
  }

  // --- actions ------------------------------------------------------------------------------------------------------
  function placeAt(s, oo, x, y, record = true) {
    if (record) pushHist();
    s.o = oo; s.x = x; s.y = y; s.placed = true;
    play('place');
  }

  // Anchor of orientation oo that puts the shape's cell nearest to its middle onto cell c.
  function anchorFor(s, oo, c, offset = null) {
    const cl = G.types[s.t].orients[oo];
    const cx = c % G.W, cy = Math.floor(c / G.W);
    if (offset) return [cx - offset[0], cy - offset[1]];
    const mid = cl[Math.floor((cl.length - 1) / 2)];
    return [cx - mid[0], cy - mid[1]];
  }

  function onTap(c, info) {
    if (waiting || (drag && drag.moved)) return;
    if (mineMode) {
      if (mines.includes(c)) { pushHist(); mines = mines.filter((x) => x !== c); }
      else if (mines.length < rs.weapons.mines && !shipAt(c) && !G.obstacle[c]) { pushHist(); mines.push(c); play('place'); }
      else play('error');
      render();
      return;
    }
    const at = shipAt(c);
    if (at) {
      if (sel === at.key && info.via !== 'keyboard') rotate(at, c);
      else { sel = at.key; play('rotate'); }
      render();
      return;
    }
    if (sel >= 0 && !ships[sel].placed) {
      const s = ships[sel];
      const [x, y] = anchorFor(s, s.o, c);
      if (fits(s, s.o, x, y)) { placeAt(s, s.o, x, y); sel = nextUnplaced(); }
      else play('error');
      render();
      return;
    }
    sel = -1;
    render();
  }

  const nextUnplaced = () => { const n = ships.find((s) => !s.placed); return n ? n.key : -1; };

  function rotate(s, pivot = null) {
    const n = G.types[s.t].orients.length;
    if (n < 2) return;
    if (!s.placed) { s.o = (s.o + 1) % n; play('rotate'); return; }
    const cells = cellsOf(s);
    const pv = pivot != null && cells.includes(pivot) ? pivot : cells[0];
    pushHist();
    // the next orientation that fits with the pivot cell still under the ship; otherwise the next one anywhere near
    for (let k = 1; k <= n; k++) {
      const oo = (s.o + k) % n;
      const cl = G.types[s.t].orients[oo];
      const opts = cl.map(([dx, dy]) => [pv % G.W - dx, Math.floor(pv / G.W) - dy]);
      const ok = opts.find(([x, y]) => fits(s, oo, x, y));
      if (ok) { s.o = oo; [s.x, s.y] = ok; play('rotate'); return; }
    }
    history.pop();
    play('error');
    toast(t('pl.noRoom'), 'warn');
  }
  function rotateSel() { if (sel >= 0) { rotate(ships[sel]); render(); } }

  function moveSel(dx, dy) {
    const s = ships[sel];
    if (!s || !s.placed) return;
    if (pOf(s, s.o, s.x + dx, s.y + dy) < 0) return;
    pushHist();
    s.x += dx; s.y += dy;
    play('place');
    render();
  }

  function randomMenu(anchor) {
    openMenu(anchor, STRATS.map((st) => ({ label: t('strat.' + st), checked: store.settings.placeStrategy === st, action: () => randomize(st) })), { label: t('pl.random') });
  }
  function randomize(st = store.settings.placeStrategy || 'uniform') {
    store.settings.placeStrategy = st;
    save('settings');
    pushHist();
    const L = randomLayout(rs, rng, { strategy: st, strength: 0.8 });
    applyLayout(L);
    play('place');
    render();
  }
  function applyLayout(L) {
    const used = new Set();
    for (const s of ships) s.placed = false;
    for (const e of L.ships) {
      const s = ships.find((x) => x.t === e.t && !used.has(x.key));
      if (!s) continue;
      used.add(s.key);
      s.o = e.o; s.x = e.x; s.y = e.y; s.placed = true;
    }
    mines = (L.mines || []).slice(0, rs.weapons.mines);
    if (rs.weapons.mines && mines.length < rs.weapons.mines) mines = randomLayout(rs, rng).mines;
    sel = -1;
  }

  async function layoutsMenu(anchor) {
    const list = layoutsFor(rs.hash);
    const items = [
      { label: t('pl.saveLayout'), icon: 'save', disabled: placedCount() !== ships.length || invalidKeys().size > 0, action: async () => {
        const name = await promptDialog(t('pl.saveLayout'), t('pl.layoutName'), t('pl.layoutDefault', { n: list.length + 1 }));
        if (!name) return;
        putLayout(rs.hash, name, layout());
        toast(t('pl.saved', { name }), 'ok');
      } },
    ];
    if (list.length) items.push({ sep: true });
    for (const x of list) items.push({ label: x.name, icon: 'folder', action: () => { const v = validateLayout(rs, x.layout); if (!v.ok) { toast(t('pl.badLayout'), 'warn'); return; } pushHist(); applyLayout(x.layout); render(); } });
    if (list.length) items.push({ sep: true }, ...list.map((x) => ({ label: t('pl.deleteLayout', { name: x.name }), icon: 'trash', danger: true, action: () => { removeLayout(rs.hash, x.name); } })));
    openMenu(anchor, items, { label: t('pl.layouts') });
  }

  function cellMenu(c) {
    if (waiting) return null;
    const s = shipAt(c);
    const items = [{ header: true, label: s ? shipName(rs, s.t) : cellLabel(rs, c) }];
    if (s) {
      items.push({ label: t('pl.rotate'), icon: 'replace', action: () => { rotate(s, c); render(); } });
      items.push({ label: t('pl.toDock'), icon: 'undo', action: () => { pushHist(); s.placed = false; sel = s.key; render(); } });
    } else if (sel >= 0 && !ships[sel].placed) {
      items.push({ label: t('pl.dropHere', { ship: shipName(rs, ships[sel].t) }), icon: 'plus', action: () => onTap(c, { via: 'menu' }) });
    }
    if (rs.weapons.mines && !s) items.push({ label: mines.includes(c) ? t('pl.removeMine') : t('pl.addMine'), icon: 'star', disabled: !mines.includes(c) && mines.length >= rs.weapons.mines, action: () => { const was = mineMode; mineMode = true; onTap(c, { via: 'menu' }); mineMode = was; render(); } });
    items.push({ sep: true }, { label: t('pl.random'), icon: 'grid', action: () => randomize() });
    return items;
  }

  // --- drag and drop ----------------------------------------------------------------------------------------------------
  function startDrag(e, key, fromDock) {
    if (waiting || mineMode || (e.button !== 0 && e.pointerType === 'mouse')) return;
    const s = ships[key];
    let offset = null;
    if (!fromDock) {
      const c = grid.cellAt(e.clientX, e.clientY);
      offset = [c % G.W - s.x, Math.floor(c / G.W) - s.y];
    }
    drag = { key, fromDock, id: e.pointerId, x0: e.clientX, y0: e.clientY, o: s.o, offset, moved: false, at: null };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    window.addEventListener('pointerdown', onSecond, true);
  }
  function onSecond(e) {
    // a second finger turns the ship being dragged
    if (!drag || e.pointerId === drag.id) return;
    e.preventDefault();
    e.stopPropagation();
    const n = G.types[ships[drag.key].t].orients.length;
    drag.o = (drag.o + 1) % n;
    drag.offset = null;
    play('rotate');
    render();
  }
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
    drag.moved = true;
    e.preventDefault();
    const c = grid.cellAt(e.clientX, e.clientY);
    const s = ships[drag.key];
    drag.at = c >= 0 ? anchorFor(s, drag.o, c, drag.offset) : null;
    render();
  }
  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    window.removeEventListener('pointerdown', onSecond, true);
    const d = drag;
    if (d.moved) {
      const s = ships[d.key];
      if (d.at && fits(s, d.o, d.at[0], d.at[1])) { placeAt(s, d.o, d.at[0], d.at[1]); sel = s.key; }
      else if (d.at && d.fromDock) play('error');
      else if (!d.at && !d.fromDock) { pushHist(); s.placed = false; sel = s.key; } // dragged off the sea: back to the dock
      else play('error');
      // the click that follows a drag selects nothing
      setTimeout(() => { drag = null; render(); }, 0);
      drag = { ...d, moved: false };
      render();
      return;
    }
    drag = null;
  }
  grid.el.addEventListener('pointerdown', (e) => {
    const c = grid.cellAt(e.clientX, e.clientY);
    const s = c >= 0 ? shipAt(c) : null;
    if (s) startDrag(e, s.key, false);
  });

  // --- keys --------------------------------------------------------------------------------------------------------------
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, .ed-dialog')) return;
    if (!root.isConnected) return;
    const k = e.key;
    if (k === 'r' || k === 'R' || k === 'к' || k === 'К') { e.preventDefault(); rotateSel(); return; }
    if (sel >= 0 && ships[sel].placed && document.activeElement !== grid.el) {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (step) { e.preventDefault(); moveSel(step[0], step[1]); return; }
    }
    if ((k === 'Delete' || k === 'Backspace') && sel >= 0 && ships[sel].placed) { e.preventDefault(); pushHist(); ships[sel].placed = false; render(); return; }
    if (k === 'Enter' && !readyBtn.disabled && document.activeElement !== grid.el) { e.preventDefault(); ready(); return; }
    if ((k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey) && history.length) { e.preventDefault(); restore(history.pop()); render(); }
  };
  window.addEventListener('keydown', onKey);

  function ready() {
    const L = layout();
    const v = validateLayout(rs, L);
    if (!v.ok) { toast(t('pl.badLayout'), 'warn'); return; }
    o.onReady(L);
  }

  sel = 0;
  render();
  return {
    el: root,
    setWaiting(text) { waiting = text; render(); },
    randomize,
    destroy() { window.removeEventListener('keydown', onKey); grid.destroy(); root.remove(); },
  };
}
