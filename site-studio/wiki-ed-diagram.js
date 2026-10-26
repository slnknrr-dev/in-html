// site-studio/wiki-ed-diagram.js - the visual editor of annotated pictures and diagrams (block 'diagram'): regions
// (points, rectangles, circles, polygons, plain nodes) drawn on the picture or a plain background, labels dragged
// anywhere with a leader line ("stick") from the region, links and notes per region, arrows between regions for
// concept maps. Coordinates are percentages of the width (x) and height (y). The dialog edits a copy of the block and
// commits it with Apply (one undo step).
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { openDialog } from '../ui/overlays.js';
import { itemCenter } from './wiki-blocks.js';
import { S, commitTarget, target } from './wiki-state.js';
import { colorEl, input, lineMarkup, linkInput, row, selectEl } from './wiki-ed-fields.js';
import { chooseMedia, mediaURL } from './wiki-ed-media.js';
import { findBlock } from './wiki-ed-blocks.js';

// Design rules:
// - The dialog edits a deep copy of the block and commits once on Apply: dragging produces hundreds of pointer
// moves, which must not become hundreds of undo steps or re-seals of a secret payload.
// - Coordinates are stored rounded to 0.1 percent (r2): enough precision on any screen, and compact, diff-friendly JSON.
// - Pointer events with setPointerCapture: one code path for mouse, pen and touch, and drags keep tracking when the
// pointer leaves the stage.
const r2 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ratio() mirrors blocks.js diagram(): the picture's intrinsic aspect when known, else the chosen aspect; y values
// are percent of height and are scaled by it for the SVG viewBox. preserveAspectRatio none: the SVG stretches to the
// stage; the reader's SVG uses the default (meet) on a stage of the same aspect, which maps identically, so what is
// drawn here lands at the same place in the published page.
export function openDiagramEditor(blockId) {
  const tg = target();
  const f = tg && tg.obj ? findBlock(tg.obj, blockId) : null;
  if (!f) return;
  const b = JSON.parse(JSON.stringify(f.block));
  b.items = b.items || [];
  b.edges = b.edges || [];
  let sel = b.items.length ? 0 : -1;
  let tool = 'select';
  let poly = null; // points of the polygon being drawn

  const stage = h('div', { class: 'kp-dg-stage' });
  const side = h('div', { class: 'kp-dg-side' });
  const toolbar = h('div', { class: 'kp-dg-tools', role: 'toolbar' });
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

  const ratio = () => {
    const m = b.media ? S.kb.media[b.media] : null;
    if (m && m.w && m.h) return m.h / m.w;
    const [w, hh] = String(b.aspect || '16:9').split(':').map(Number);
    return (hh || 9) / (w || 16);
  };
  const newId = () => { let n = b.items.length + 1; while (b.items.some((it) => it.id === 'n' + n)) n++; return 'n' + n; };
  const pt = (e) => { const r = stage.getBoundingClientRect(); return [clamp(r2(((e.clientX - r.left) / r.width) * 100), 0, 100), clamp(r2(((e.clientY - r.top) / r.height) * 100), 0, 100)]; };

  function paintTools() {
    const tools = [['select', 'grip', 'kp.dg.select'], ['point', 'pin', 'kp.dg.point'], ['rect', 'section', 'kp.dg.rect'], ['circle', 'drop', 'kp.dg.circle'], ['poly', 'star', 'kp.dg.poly'], ['none', 'type', 'kp.dg.node']];
    toolbar.replaceChildren(...tools.map(([k, ic, l]) => h('button', { type: 'button', class: 'ed-btn ed-sm' + (tool === k ? ' ed-primary' : ''), 'aria-pressed': String(tool === k), onclick: () => { tool = k; poly = null; paintTools(); paint(); } }, iconEl(ic), t(l))),
      h('span', { class: 'ed-hint kp-dg-help' }, t('kp.dg.help.' + tool)));
  }

  function paint() {
    const ry = ratio();
    stage.style.aspectRatio = `1 / ${ry}`;
    const m = b.media ? S.kb.media[b.media] : null;
    const H = 100 * ry;
    const svg = svgEl('svg', { class: 'kp-dg-svg', viewBox: `0 0 100 ${H.toFixed(2)}`, preserveAspectRatio: 'none' });
    const y = (v) => (v * ry).toFixed(2);
    const byId = new Map(b.items.map((it, i) => [it.id || String(i + 1), it]));
    for (const e of b.edges) {
      const a = byId.get(e.from), z = byId.get(e.to);
      if (!a || !z) continue;
      const [x1, y1] = itemCenter(a), [x2, y2] = itemCenter(z);
      svg.append(svgEl('line', { x1, y1: y(y1), x2, y2: y(y2), class: 'kp-dg-edge' }));
    }
    b.items.forEach((it, i) => {
      const g = svgEl('g', { class: 'kp-dg-it' + (i === sel ? ' kp-on' : ''), 'data-i': i, style: it.color ? `--c:${it.color}` : '' });
      let shape;
      if (it.shape === 'rect') shape = svgEl('rect', { x: it.x, y: y(it.y), width: it.w, height: y(it.h) });
      else if (it.shape === 'circle') shape = svgEl('circle', { cx: it.x, cy: y(it.y), r: it.r });
      else if (it.shape === 'poly') shape = svgEl('polygon', { points: (it.pts || []).map((p) => p[0] + ',' + y(p[1])).join(' ') });
      else shape = svgEl('circle', { cx: it.x, cy: y(it.y), r: it.shape === 'none' ? 0.01 : 1.2, class: 'kp-dg-dot' });
      g.append(shape);
      const [cx, cy] = itemCenter(it);
      if (typeof it.lx === 'number' && it.lx >= 0 && typeof it.ly === 'number' && it.ly >= 0) g.append(svgEl('line', { x1: cx, y1: y(cy), x2: it.lx, y2: y(it.ly), class: 'kp-dg-lead' }));
      if (i === sel && it.shape === 'rect') g.append(svgEl('rect', { x: it.x + it.w - 1, y: y(it.y + it.h) - 1, width: 2, height: 2, class: 'kp-dg-handle', 'data-h': 'size' }));
      if (i === sel && it.shape === 'circle') g.append(svgEl('rect', { x: it.x + it.r - 1, y: y(it.y) - 1, width: 2, height: 2, class: 'kp-dg-handle', 'data-h': 'size' }));
      if (i === sel && it.shape === 'poly') (it.pts || []).forEach((p, k) => g.append(svgEl('rect', { x: p[0] - 0.8, y: y(p[1]) - 0.8, width: 1.6, height: 1.6, class: 'kp-dg-handle', 'data-h': 'pt' + k })));
      svg.append(g);
    });
    if (poly && poly.length) svg.append(svgEl('polyline', { points: poly.map((p) => p[0] + ',' + y(p[1])).join(' '), class: 'kp-dg-draft' }));
    const labels = b.items.map((it, i) => {
      const has = typeof it.lx === 'number' && it.lx >= 0;
      const [cx, cy] = itemCenter(it);
      const lx = has ? it.lx : cx, ly = has ? it.ly : cy;
      const l = h('div', { class: 'kp-dg-lbl' + (i === sel ? ' kp-on' : '') + (it.shape === 'none' ? ' kp-node' : ''), 'data-i': i, style: { left: lx + '%', top: ly + '%', ...(it.color ? { '--c': it.color } : {}) } },
        h('span', { class: 'kp-dg-n' }, String(i + 1)), h('span', {}, (it.label || '').replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2') || '…'));
      return l;
    });
    stage.replaceChildren(m && /^image\//.test(m.type) ? h('img', { class: 'kp-dg-img', src: mediaURL(b.media), alt: '', 'data-kp-media': b.media, draggable: 'false' }) : h('div', { class: 'kp-dg-bg', style: b.bg ? { background: b.bg } : {} }), svg, ...labels);
    paintSide();
  }

  function setItem(fn) { if (sel >= 0) { fn(b.items[sel]); paint(); } }

  function paintSide() {
    const it = b.items[sel];
    const ids = b.items.map((x, i) => ({ v: x.id || String(i + 1), l: `${i + 1}. ${(x.label || x.id || '').slice(0, 30)}` }));
    const general = h('details', { class: 'kp-dg-sec', open: !b.items.length },
      h('summary', {}, t('kp.dg.picture')),
      row(t('f.media'), h('div', { class: 'kp-row' }, h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async () => { const id = await chooseMedia('image'); if (id) { b.media = id; paint(); } } }, iconEl('image'), t('kp.choose')),
        b.media ? h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { b.media = ''; paint(); } }, t('kp.dg.noPicture')) : null)),
      row(t('f.aspect'), selectEl(['16:9', '4:3', '1:1', '3:4', '2:1', '3:2'].map((v) => ({ v, l: v })), b.aspect, (v) => { b.aspect = v; paint(); })),
      row(t('f.bg'), colorEl(b.bg, (v) => { b.bg = v; paint(); })),
      row(t('f.labels'), selectEl(['always', 'hover', 'numbers'].map((v) => ({ v, l: t('o.' + v) })), b.labels, (v) => { b.labels = v; })));
    const list = h('ol', { class: 'kp-dg-list' }, b.items.map((x, i) => h('li', { class: i === sel ? 'kp-on' : '' }, h('button', { type: 'button', onclick: () => { sel = i; paint(); } }, (x.label || x.id || t('kp.item')).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')))));
    const props = it ? h('div', { class: 'kp-dg-props' },
      h('h3', {}, t('kp.dg.region', { n: sel + 1 })),
      row(t('f.label'), lineMarkup(it.label, (v) => { it.label = v; const l = stage.querySelector(`.kp-dg-lbl[data-i="${sel}"] span:last-child`); if (l) l.textContent = v.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2') || '…'; })),
      row(t('f.link'), linkInput(it.link, (v) => { it.link = v; })),
      row(t('f.note'), input(it.note, (v) => { it.note = v; })),
      h('div', { class: 'kp-row' },
        row(t('f.shape'), selectEl(['point', 'rect', 'circle', 'poly', 'none'].map((v) => ({ v, l: t('o.' + v) })), it.shape, (v) => setItem((x) => {
          x.shape = v;
          if (v === 'poly' && !(x.pts || []).length) x.pts = [[x.x - 5, x.y - 5], [x.x + 5, x.y - 5], [x.x, x.y + 5]].map((p) => [clamp(p[0], 0, 100), clamp(p[1], 0, 100)]);
        }))),
        row(t('f.color'), colorEl(it.color, (v) => setItem((x) => { x.color = v; })))),
      row(t('f.id'), input(it.id, (v) => { const old = it.id; it.id = v.replace(/[^\w-]/g, ''); for (const e of b.edges) { if (e.from === old) e.from = it.id; if (e.to === old) e.to = it.id; } })),
      h('div', { class: 'kp-row' },
        h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => setItem((x) => { x.lx = -1; x.ly = -1; }) }, t('kp.dg.labelOnRegion')),
        h('button', { type: 'button', class: 'ed-btn ed-sm ed-danger', onclick: () => { const id = it.id; b.items.splice(sel, 1); b.edges = b.edges.filter((e) => e.from !== id && e.to !== id); sel = Math.min(sel, b.items.length - 1); paint(); } }, iconEl('trash'), t('kp.remove')))) : h('p', { class: 'ed-hint' }, t('kp.dg.empty'));
    const edges = h('details', { class: 'kp-dg-sec', open: b.edges.length > 0 },
      h('summary', {}, t('kp.dg.arrows', { n: b.edges.length })),
      ...b.edges.map((e, k) => h('div', { class: 'kp-dg-edge-row' },
        selectEl(ids, e.from, (v) => { e.from = v; paint(); }), h('span', {}, '→'), selectEl(ids, e.to, (v) => { e.to = v; paint(); }),
        selectEl(['arrow', 'line', 'dashed'].map((v) => ({ v, l: t('o.' + v) })), e.style, (v) => { e.style = v; }),
        input(e.label, (v) => { e.label = v; }, { placeholder: t('f.label') }),
        h('button', { type: 'button', class: 'ed-iconbtn ed-sm', 'aria-label': t('kp.remove'), onclick: () => { b.edges.splice(k, 1); paint(); } }, iconEl('trash')))),
      h('button', { type: 'button', class: 'ed-btn ed-sm', disabled: b.items.length < 2, onclick: () => { b.edges.push({ from: ids[0].v, to: ids[1].v, label: '', style: 'arrow' }); paint(); } }, iconEl('plus'), t('kp.dg.addArrow')));
    side.replaceChildren(general, list, props, edges);
  }

  // Pointer interaction on the stage.
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [px, py] = pt(e);
    const lbl = e.target.closest('.kp-dg-lbl');
    const handle = e.target.closest('.kp-dg-handle');
    const g = e.target.closest('.kp-dg-it');
    if (tool === 'select' || lbl || handle) {
      if (lbl) { sel = +lbl.dataset.i; drag = { kind: 'label', i: sel }; }
      else if (handle) drag = { kind: handle.dataset.h, i: sel };
      else if (g) { sel = +g.dataset.i; const it = b.items[sel]; drag = { kind: 'move', i: sel, x0: px, y0: py, orig: JSON.parse(JSON.stringify(it)) }; }
      else { sel = -1; paint(); return; }
      stage.setPointerCapture(e.pointerId);
      paint();
      e.preventDefault();
      return;
    }
    if (tool === 'poly') {
      poly = poly || [];
      poly.push([px, py]);
      paint();
      return;
    }
    const it = { id: newId(), shape: tool, x: px, y: py, w: 0, h: 0, r: 0, pts: [], lx: -1, ly: -1, label: '', link: '', note: '', color: '' };
    b.items.push(it);
    sel = b.items.length - 1;
    if (tool === 'rect' || tool === 'circle') { drag = { kind: 'create', i: sel, x0: px, y0: py }; stage.setPointerCapture(e.pointerId); }
    else { it.lx = clamp(px + 12, 0, 100); it.ly = clamp(py - 10, 0, 100); tool = 'select'; paintTools(); }
    paint();
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [px, py] = pt(e);
    const it = b.items[drag.i];
    if (!it) return;
    if (drag.kind === 'label') { it.lx = px; it.ly = py; }
    else if (drag.kind === 'move') {
      const dx = px - drag.x0, dy = py - drag.y0, o = drag.orig;
      it.x = clamp(r2(o.x + dx), 0, 100); it.y = clamp(r2(o.y + dy), 0, 100);
      if (o.pts) it.pts = o.pts.map((p) => [clamp(r2(p[0] + dx), 0, 100), clamp(r2(p[1] + dy), 0, 100)]);
      if (o.lx >= 0) { it.lx = clamp(r2(o.lx + dx), 0, 100); it.ly = clamp(r2(o.ly + dy), 0, 100); }
    } else if (drag.kind === 'create' || drag.kind === 'size') {
      if (it.shape === 'rect') {
        const x0 = drag.kind === 'create' ? drag.x0 : it.x, y0 = drag.kind === 'create' ? drag.y0 : it.y;
        it.x = Math.min(x0, px); it.y = Math.min(y0, py); it.w = r2(Math.abs(px - x0)); it.h = r2(Math.abs(py - y0));
        if (drag.kind === 'size') { it.x = x0; it.y = y0; it.w = r2(Math.max(1, px - x0)); it.h = r2(Math.max(1, py - y0)); }
      } else if (it.shape === 'circle') it.r = r2(Math.max(1, Math.hypot(px - it.x, (py - it.y) * ratio())));
    } else if (drag.kind.startsWith('pt')) { const k = +drag.kind.slice(2); if (it.pts[k]) it.pts[k] = [px, py]; }
    paint();
  });
  const end = () => {
    if (drag && drag.kind === 'create') {
      const it = b.items[drag.i];
      if (it.shape === 'rect' && (it.w < 1 || it.h < 1)) { it.w = 10; it.h = 8; }
      if (it.shape === 'circle' && it.r < 1) it.r = 5;
      const [cx, cy] = itemCenter(it);
      it.lx = clamp(cx + 15, 0, 100); it.ly = clamp(cy - 12, 0, 100);
      tool = 'select'; paintTools(); paint();
    }
    drag = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  const finishPoly = () => {
    if (!poly || poly.length < 3) return;
    const [cx, cy] = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
    b.items.push({ id: newId(), shape: 'poly', x: r2(cx), y: r2(cy), w: 0, h: 0, r: 0, pts: poly, lx: clamp(r2(cx + 15), 0, 100), ly: clamp(r2(cy - 12), 0, 100), label: '', link: '', note: '', color: '' });
    sel = b.items.length - 1;
    poly = null; tool = 'select'; paintTools(); paint();
  };
  stage.addEventListener('dblclick', finishPoly);
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'Enter' && poly) { e.preventDefault(); finishPoly(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && !poly) { const id = b.items[sel].id; b.items.splice(sel, 1); b.edges = b.edges.filter((x) => x.from !== id && x.to !== id); sel = Math.min(sel, b.items.length - 1); paint(); e.preventDefault(); }
    const step = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.5], ArrowDown: [0, 0.5] }[e.key];
    if (step && sel >= 0) {
      const it = b.items[sel];
      e.preventDefault();
      it.x = clamp(r2(it.x + step[0]), 0, 100); it.y = clamp(r2(it.y + step[1]), 0, 100);
      if (it.pts) it.pts = it.pts.map((p) => [clamp(r2(p[0] + step[0]), 0, 100), clamp(r2(p[1] + step[1]), 0, 100)]);
      paint();
    }
  };

  paintTools();
  paint();
  const body = h('div', { class: 'kp-dg', tabindex: '-1' }, toolbar, h('div', { class: 'kp-dg-main' }, h('div', { class: 'kp-dg-wrap' }, stage), side));
  body.addEventListener('keydown', onKey);
  openDialog({
    title: t('kp.editDiagram'), body, wide: true, className: 'kp-dg-dlg',
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('kp.apply'), value: 'ok', primary: true }],
  }).then((v) => {
    if (v !== 'ok') return;
    commitTarget((o) => {
      const x = findBlock(o, blockId);
      if (!x) return;
      for (const k of ['media', 'aspect', 'bg', 'labels', 'items', 'edges']) x.block[k] = b[k];
    }, { structure: true });
  });
}
