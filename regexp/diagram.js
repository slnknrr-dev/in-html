// regexp/diagram.js - railroad diagram (SVG markup) of a parsed pattern: sequences, alternation, repetition loops
// with min / max captions, groups, lookarounds, classes, anchors and back-references.
//
// diagramSVG(parsed, options) → SVG string. The look comes from CSS custom properties (--rx-dg-*) with built-in
// fallbacks, so the same markup follows a page theme inline or stands alone as an exported file. Every node carries
// data-s / data-e (its source range) and a <title> (its source text) for hover and selection sync.
//
// Layout model: every diagram piece is { w, up, down, render(x, y) } - width plus extent above / below the track
// line, rendered at the left end of its track at height y. Combinators (seq, choice, loop, container) only add these
// numbers, so layout is one bottom-up pass with no DOM measuring. Text width comes from options.measure (a canvas in
// the page) or a deterministic estimate (Node, exports), so the same function works headless.
import { charDisplay, propertyNames, quantifierForm } from './explain.js';

const EN = {
  title: 'Railroad diagram of the regular expression', start: 'start', end: 'end',
  any: 'any character except line breaks', anyNl: 'any character',
  digit: 'digit', notDigit: 'not a digit', word: 'word character', notWord: 'not a word character', space: 'whitespace', notSpace: 'not whitespace',
  property: '{name}', notProperty: 'not {name}', oneOf: 'one of', noneOf: 'none of', intersection: 'in all of', subtraction: 'in the first, not the rest',
  group: 'group #{n}', namedGroup: '#{n} {name}', modifiers: 'flags {mods}', lookahead: 'followed by', negLookahead: 'not followed by',
  lookbehind: 'preceded by', negLookbehind: 'not preceded by', lineStart: 'start of line', inputStart: 'start of input', lineEnd: 'end of line',
  inputEnd: 'end of input', wordBoundary: 'word boundary', notWordBoundary: 'not a word boundary', backref: 'same as {ref}', empty: 'nothing',
  times: '{text}', lazy: 'lazy', strings: 'one of the strings',
};
const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] != null ? String(p[k]) : m));
// Escapes for both text nodes and double-quoted attributes; every user-derived string goes through it.
const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Width estimate without a DOM: monospace cells and a proportional average; wide characters count double.
function estimate(text, kind) {
  let w = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    const wide = cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f000);
    w += kind === 'mono' ? (wide ? 15 : 7.6) : wide ? 12 : cp >= 0x10a0 && cp <= 0x10ff ? 7.4 : 6.3;
  }
  return w;
}

// Embedded <style> rather than presentation attributes: the file stays themeable via --rx-dg-* custom properties and
// survives export (an external stylesheet would not travel with a downloaded .svg). Class names are rr- prefixed to
// avoid collisions when the SVG is inlined into the page.
const STYLE = `
.rr-line{fill:none;stroke:var(--rx-dg-line,#8a94a6);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.rr-arrow{fill:var(--rx-dg-line,#8a94a6)}
.rr-term{fill:var(--rx-dg-bg,#ffffff);stroke:var(--rx-dg-line,#8a94a6);stroke-width:1.6}
.rr-node rect{stroke-width:1.3}
.rr-node text{font:12.5px var(--rx-dg-mono,ui-monospace,"Cascadia Code",Menlo,Consolas,monospace);text-anchor:middle;dominant-baseline:central}
.rr-lit rect{fill:var(--rx-dg-lit,#e3f0ff);stroke:var(--rx-dg-lit-b,#3b82f6)}.rr-lit text{fill:var(--rx-dg-lit-t,#1e3a8a)}
.rr-set rect{fill:var(--rx-dg-set,#f1e8ff);stroke:var(--rx-dg-set-b,#8b5cf6)}.rr-set text{fill:var(--rx-dg-set-t,#4c1d95)}
.rr-anchor rect{fill:var(--rx-dg-anc,#fff4dc);stroke:var(--rx-dg-anc-b,#d97706)}.rr-anchor text{fill:var(--rx-dg-anc-t,#7c4a03)}
.rr-ref rect{fill:var(--rx-dg-ref,#ffe7ee);stroke:var(--rx-dg-ref-b,#e11d48)}.rr-ref text{fill:var(--rx-dg-ref-t,#881337)}
.rr-cls text.rr-row{text-anchor:start}
.rr-box{fill:var(--rx-dg-grp,rgba(59,130,246,.05));stroke:var(--rx-dg-grp-b,#94a3b8);stroke-width:1.2;stroke-dasharray:5 4}
.rr-look>.rr-box{fill:var(--rx-dg-look,rgba(16,185,129,.07));stroke:var(--rx-dg-look-b,#10b981);stroke-dasharray:none}
.rr-cap,.rr-node text.rr-cap{font:600 10.5px var(--rx-dg-font,system-ui,"Segoe UI",sans-serif);fill:var(--rx-dg-cap,#64748b);text-anchor:start;dominant-baseline:auto}
.rr-qcap{font:10.5px var(--rx-dg-font,system-ui,"Segoe UI",sans-serif);fill:var(--rx-dg-cap,#64748b);text-anchor:middle}
.rr-dim{opacity:.4}
.rr-node:hover>rect,.rr-hot>rect,.rr-hot>.rr-box{stroke:var(--rx-dg-hot,#f43f5e);stroke-width:2}
`;

/**
 * options: label(key, params) → text (localized captions; English by default), measure(text, 'mono' | 'sans') → px,
 * idPrefix (unique ids for title / desc), title, desc, vars ({ '--rx-dg-lit': '#…' } baked into the file),
 * background (a colour painted behind the diagram, for exports), scale (1).
 * → { svg, width, height }
 */
export function diagram(parsed, options = {}) {
  if (!parsed || !parsed.ok) return null;
  const src = parsed.source, f = parsed.flags;
  const L = (k, p) => (options.label ? options.label(k, p) : null) ?? fill(EN[k] ?? k, p);
  const M = options.measure || estimate;
  const raw = (n) => src.slice(n.start, n.end);
  // H: half box height, G: gap between sequence items, R: corner radius of loop / skip arcs.
  const H = 12, G = 12, R = 8;

  const tag = (n, cls, inner) => `<g class="rr-node ${cls}" data-s="${n.start}" data-e="${n.end}"><title>${xml(raw(n) || '∅')}</title>${inner}</g>`;
  function box(n, text, cls, round) {
    const w = Math.max(28, Math.ceil(M(text, 'mono')) + 20);
    return {
      w, up: H, down: H,
      render: (x, y) => tag(n, cls, `<rect x="${x}" y="${y - H}" width="${w}" height="${2 * H}" rx="${round ? H : 5}"/><text x="${x + w / 2}" y="${y}">${xml(text)}</text>`),
    };
  }
  function rows(n, caption, items, cls) {
    const rowH = 18;
    const capW = M(caption, 'sans');
    const w = Math.max(48, Math.ceil(Math.max(capW, ...items.map((t) => M(t, 'mono')))) + 22);
    const h = items.length * rowH + 10;
    const up = Math.ceil(h / 2) + 14, down = Math.ceil(h / 2);
    return {
      w, up, down,
      render: (x, y) => tag(n, cls + ' rr-cls',
        `<text class="rr-cap" x="${x + 2}" y="${y - up + 9}" style="text-anchor:start">${xml(caption)}</text>`
        + `<rect x="${x}" y="${y - h / 2}" width="${w}" height="${h}" rx="6"/>`
        + items.map((t, i) => `<text class="rr-row" x="${x + 11}" y="${y - h / 2 + 5 + rowH * i + rowH / 2}">${xml(t)}</text>`).join('')),
    };
  }
  const line = (x1, y1, x2, y2) => (x1 === x2 && y1 === y2 ? '' : `<path class="rr-line" d="M${x1} ${y1}H${x2}"/>`);
  const gap = (w = 20) => ({ w, up: 0, down: 0, render: (x, y) => line(x, y, x + w, y) });

  function seq(items) {
    if (!items.length) return gap(24);
    if (items.length === 1) return items[0];
    const w = items.reduce((a, it) => a + it.w, 0) + G * (items.length - 1);
    return {
      w, up: Math.max(...items.map((i) => i.up)), down: Math.max(...items.map((i) => i.down)),
      render: (x, y) => {
        let s = '', cx = x;
        items.forEach((it, i) => { if (i) { s += line(cx, y, cx + G, y); cx += G; } s += it.render(cx, y); cx += it.w; });
        return s;
      },
    };
  }

  // Alternatives stacked vertically, track centred between the first and last branch; branches are centred in the
  // widest width W and joined by cubic curves over B px on each side.
  function choice(items) {
    if (items.length === 1) return items[0];
    const B = 26, VG = 10;
    const W = Math.max(...items.map((i) => i.w));
    const base = [];
    let yy = 0;
    items.forEach((it, i) => { yy += i ? items[i - 1].down + VG + it.up : it.up; base.push(yy); });
    const mid = (base[0] + base[base.length - 1]) / 2;
    const up = mid - base[0] + items[0].up, down = base[base.length - 1] - mid + items[items.length - 1].down;
    return {
      w: W + 2 * B, up, down,
      render: (x, y) => {
        let s = '';
        items.forEach((it, i) => {
          const yi = y + base[i] - mid, xi = x + B + (W - it.w) / 2;
          const c = (x1, y1, x2, y2) => (y1 === y2 ? line(x1, y1, x2, y2) : `<path class="rr-line" d="M${x1} ${y1}C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}"/>`);
          s += c(x, y, x + B, yi) + line(x + B, yi, xi, yi) + it.render(xi, yi) + line(xi + it.w, yi, x + B + W, yi) + c(x + B + W, yi, x + W + 2 * B, y);
        });
        return s;
      },
    };
  }

  // Quantifier: a skip arc over the item when min = 0, a return loop under it when max > 1. {0} dims the item instead
  // of removing it so the source range stays hoverable.
  function loop(q, item) {
    const { min, max, greedy } = q;
    if (min === 1 && max === 1) return item;
    const skip = min === 0, rep = max > 1;
    const text = L('times', { min, max: max === Infinity ? '∞' : max, form: quantifierForm(min, max), text: timesText(min, max) }) + (greedy ? '' : ' · ' + L('lazy'));
    const capW = rep || !greedy ? M(text, 'sans') : 0;
    const P = 2 * R;
    const w = Math.max(item.w + 2 * P, capW + 8);
    const loopDrop = item.down + 10, skipRise = item.up + 10;
    const up = skip ? skipRise : item.up, down = rep ? loopDrop + (capW ? 15 : 0) : item.down + (capW ? 15 : 0);
    return {
      w, up, down,
      render: (x, y) => {
        const xi = x + (w - item.w) / 2, xl = xi, xr = xi + item.w;
        let s = line(x, y, xi, y) + `<g class="${max === 0 ? 'rr-dim' : ''}">${item.render(xi, y)}</g>` + line(xr, y, x + w, y);
        if (skip) {
          const sy = y - skipRise;
          s += `<path class="rr-line" d="M${x} ${y}A${R} ${R} 0 0 0 ${x + R} ${y - R}V${sy + R}A${R} ${R} 0 0 1 ${x + 2 * R} ${sy}H${x + w - 2 * R}A${R} ${R} 0 0 1 ${x + w - R} ${sy + R}V${y - R}A${R} ${R} 0 0 0 ${x + w} ${y}"/>`;
        }
        if (rep) {
          const ly = y + loopDrop, lx = xl - R, rx = xr + R;
          s += `<path class="rr-line" d="M${xr} ${y}A${R} ${R} 0 0 1 ${rx} ${y + R}V${ly - R}A${R} ${R} 0 0 1 ${xr} ${ly}H${xl}A${R} ${R} 0 0 1 ${lx} ${ly - R}V${y + R}A${R} ${R} 0 0 1 ${xl} ${y}"/>`;
          const ax = (xl + xr) / 2;
          s += `<path class="rr-arrow" d="M${ax - 4} ${ly}l7 -4.5v9z"/>`;
          if (capW) s += `<text class="rr-qcap" x="${x + w / 2}" y="${ly + 13}">${xml(text)}</text>`;
        } else if (capW) s += `<text class="rr-qcap" x="${x + w / 2}" y="${y + item.down + 13}">${xml(text)}</text>`;
        return s;
      },
    };
  }

  function timesText(min, max) {
    if (max === Infinity) return min + '+ ×';
    if (min === max) return min + ' ×';
    return min + '–' + max + ' ×';
  }

  function container(n, caption, item, cls) {
    const pad = 10, capH = 16;
    const capW = M(caption, 'sans') + 16;
    const w = Math.max(item.w + 2 * pad, capW);
    const up = item.up + pad + capH, down = item.down + pad;
    return {
      w, up, down,
      render: (x, y) => {
        const xi = x + (w - item.w) / 2;
        return `<g class="${cls}" data-s="${n.start}" data-e="${n.end}"><rect class="rr-box" x="${x}" y="${y - up}" width="${w}" height="${up + down}" rx="9"/>`
          + `<text class="rr-cap" x="${x + 8}" y="${y - up + 12}">${xml(caption)}</text>`
          + line(x, y, xi, y) + item.render(xi, y) + line(xi + item.w, y, x + w, y) + '</g>';
      },
    };
  }

  const setLabel = (e) => {
    if (e.kind === 'any') return L(f.dotAll ? 'anyNl' : 'any');
    if (e.kind === 'property') {
      const nm = propertyNames(e.key, e.value);
      const name = (nm.keyLong && nm.keyLong !== 'General_Category' ? nm.keyLong.replace(/_/g, ' ') + ': ' : '') + nm.valueLong.replace(/_/g, ' ');
      return L(e.negate ? 'notProperty' : 'property', { name, raw: raw(e) });
    }
    return L({ digit: 'digit', word: 'word', space: 'space' }[e.kind].replace(/^./, (c) => (e.negate ? 'not' + c.toUpperCase() : c)));
  };
  const classItem = (e) => {
    switch (e.type) {
      case 'Character': return charDisplay(e.value);
      case 'ClassRange': return charDisplay(e.min.value) + ' – ' + charDisplay(e.max.value);
      case 'CharacterSet': return setLabel(e);
      case 'ClassStringDisjunction': return e.alternatives.map((a) => (a.elements.length ? a.elements.map((c) => charDisplay(c.value)).join('') : '∅')).join(' | ');
      default: return raw(e);
    }
  };

  const disj = (alts) => choice(alts.map((a) => seq(elements(a.elements))));

  function elements(els) {
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      // Runs of literal characters become one box. The run must start above U+0020 (a leading space would render as
      // an odd lone glyph) but may continue through spaces (shown as U+2420). Lone surrogates cannot form a string.
      if (e.type === 'Character' && (e.escape === null || e.escape === 'identity') && e.value > 0x20 && !(e.value >= 0xd800 && e.value <= 0xdfff)) {
        let j = i, text = '';
        while (j < els.length && els[j].type === 'Character' && (els[j].escape === null || els[j].escape === 'identity') && els[j].value >= 0x20 && !(els[j].value >= 0xd800 && els[j].value <= 0xdfff)) text += String.fromCodePoint(els[j++].value);
        out.push(box({ start: e.start, end: els[j - 1].end }, '“' + text.replace(/ /g, '␠') + '”', 'rr-lit', true));
        i = j - 1;
      } else out.push(element(e));
    }
    return out;
  }

  function element(e) {
    switch (e.type) {
      case 'Character': return box(e, e.escape === null && e.value > 0x20 ? '“' + charDisplay(e.value) + '”' : charDisplay(e.value), 'rr-lit', true);
      case 'CharacterSet': return box(e, setLabel(e), 'rr-set', false);
      case 'CharacterClass': {
        const cap = e.kind === 'intersection' ? L('intersection') : e.kind === 'subtraction' ? L('subtraction') : L(e.negate ? 'noneOf' : 'oneOf');
        const items = e.elements.length ? e.elements.map(classItem) : ['∅'];
        return rows(e, (e.negate && e.kind !== 'union' ? L('noneOf') + ' · ' : '') + cap, items, 'rr-set');
      }
      case 'CapturingGroup': return container(e, e.name ? L('namedGroup', { n: e.index, name: e.name }) : L('group', { n: e.index }), disj(e.alternatives), 'rr-grp');
      case 'Group': return e.modifiers
        ? container(e, L('modifiers', { mods: e.modifiers.add + (e.modifiers.remove ? '-' + e.modifiers.remove : '') }), disj(e.alternatives), 'rr-grp')
        : disj(e.alternatives);
      case 'Lookaround': {
        const k = (e.negate ? 'neg' : '') + (e.kind === 'lookahead' ? 'Lookahead' : 'Lookbehind');
        return container(e, L(k.replace(/^L/, 'l')), disj(e.alternatives), 'rr-look');
      }
      case 'Assertion': {
        const k = e.kind === 'word' ? (e.negate ? 'notWordBoundary' : 'wordBoundary') : e.kind === 'start' ? (f.multiline ? 'lineStart' : 'inputStart') : (f.multiline ? 'lineEnd' : 'inputEnd');
        return box(e, L(k), 'rr-anchor', true);
      }
      case 'Backreference': return box(e, L('backref', { ref: e.named ? '“' + e.ref + '”' : '#' + e.ref }), 'rr-ref', false);
      case 'Quantifier': return loop(e, element(e.element));
      default: return gap();
    }
  }

  // Frame: padding, start / end terminal circles (radius cap) and lead-in / lead-out lines around the body.
  const body = disj(parsed.ast.alternatives);
  const pad = 14, cap = 6, lead = 18;
  const width = Math.ceil(body.w + 2 * (pad + cap + lead));
  const height = Math.ceil(body.up + body.down + 2 * pad);
  const y = pad + body.up, x0 = pad + cap;
  const id = options.idPrefix || 'rr';
  const vars = options.vars ? `svg{${Object.entries(options.vars).map(([k, v]) => `${k}:${v}`).join(';')}}` : '';
  const scale = options.scale || 1;
  // role=img + aria-labelledby title/desc: screen readers announce one image with a description instead of
  // wandering through hundreds of text nodes. idPrefix keeps ids unique when several diagrams share a page.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="rr" role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 0 ${width} ${height}" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}">`
    + `<title id="${id}-t">${xml(options.title || L('title'))}</title><desc id="${id}-d">${xml(options.desc || '/' + src + '/' + f.raw)}</desc>`
    + `<style>${vars}${STYLE.replace(/\n/g, '')}</style>`
    + (options.background ? `<rect width="100%" height="100%" fill="${xml(options.background)}"/>` : '')
    + `<circle class="rr-term" cx="${x0}" cy="${y}" r="${cap}"><title>${xml(L('start'))}</title></circle>`
    + line(x0 + cap, y, x0 + cap + lead, y)
    + body.render(x0 + cap + lead, y)
    + line(x0 + cap + lead + body.w, y, x0 + cap + 2 * lead + body.w, y)
    + `<circle class="rr-term" cx="${x0 + 2 * cap + 2 * lead + body.w}" cy="${y}" r="${cap}"><title>${xml(L('end'))}</title></circle>`
    + '</svg>';
  return { svg, width, height };
}

/** Shortcut: the SVG markup only. */
export function diagramSVG(parsed, options) {
  const d = diagram(parsed, options);
  return d ? d.svg : '';
}
