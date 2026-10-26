// miner-game/skins.js - the looks of the board (skins) with light and dark palettes, the symbol sets that
// replace the numbers 1…24 (digits, Roman numerals, alphabets, pips, bars, emoji, any custom list) and the painter
// that draws one cell sprite (hidden, open with a number, flag, question mark, mine, explosion, wrong flag) for the
// sprite atlas of board.js. Square and hexagonal cells.

// Painting model: every cell kind is drawn once per skin/size into a sprite atlas (board.js) and then blitted, so
// this code may be "slow" (paths, gradients, shadows, text measuring) - it runs per sprite, not per cell per frame.
// All sizes are fractions of the cell pitch s (device pixels), so one painter serves 8 px and 80 px cells.
// Font stacks end with Georgian and emoji fonts: symbol sets include Georgian letters and emoji, which the skin's
// primary font usually lacks; listing them explicitly avoids tofu boxes on systems whose fallback is poor.
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"';
const GEO_FONT = '"Noto Sans Georgian", Sylfaen, "DejaVu Sans"';

// The classic Windows number colours 1..8 (blue, green, red, navy, maroon, teal, black, grey): instantly familiar.
const WIN_NUMS = ['#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];

// style: how cells are drawn; schemes: palettes (light / dark); dark: the skin is always dark.
// A skin flagged dark:true is dark in both schemes and stores its only palette under "light" (see palette()).
// Optional palette keys: hidden2/open2 (checkerboard), mines (per-mine colours), glow (shadow intensity 0..1).
export const SKINS = {
  classic: {
    style: 'bevel', font: (px) => `bold ${px}px Tahoma, Verdana, "Segoe UI", ${GEO_FONT}, ${EMOJI_FONT}, sans-serif`,
    light: {
      bg: '#c0c0c0', hidden: '#c0c0c0', hiddenHi: '#ffffff', hiddenLo: '#808080', open: '#c0c0c0', openLine: '#808080',
      nums: WIN_NUMS, mine: '#000000', mineHi: '#ffffff', boomBg: '#ff0000', flag: '#ff0000', pole: '#000000', wrong: '#ff0000',
      mark: '#000000', frameHi: '#ffffff', frameLo: '#808080', frame: '#c0c0c0', cursor: '#000080', hint: '#0050ff', start: '#008000',
    },
    dark: {
      bg: '#3c4048', hidden: '#5a606b', hiddenHi: '#8b93a1', hiddenLo: '#2a2e35', open: '#3c4048', openLine: '#2a2e35',
      nums: ['#7aa2ff', '#5fd36a', '#ff6b6b', '#c39bff', '#ffb35c', '#4fd6d6', '#e6e9ef', '#a0a7b4'],
      mine: '#0e1013', mineHi: '#cfd6e2', boomBg: '#c62828', flag: '#ff5252', pole: '#e6e9ef', wrong: '#ff5252',
      mark: '#e6e9ef', frameHi: '#8b93a1', frameLo: '#1d2025', frame: '#4a4f58', cursor: '#ffd54f', hint: '#7aa2ff', start: '#5fd36a',
    },
  },
  meadow: {
    style: 'grass', font: (px) => `bold ${px}px Roboto, "Segoe UI", system-ui, ${GEO_FONT}, ${EMOJI_FONT}, sans-serif`,
    light: {
      bg: '#4a752c', hidden: '#aad751', hidden2: '#a2d149', open: '#e5c29f', open2: '#d7b899', openLine: 'rgba(0,0,0,.06)',
      nums: ['#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#ff8f00', '#0097a7', '#424242', '#9e9e9e'],
      mines: ['#db3236', '#f4840d', '#f4c20d', '#008744', '#48e6f1', '#4885ed', '#b648f2', '#ed44b5'],
      mine: '#000000', mineHi: 'rgba(0,0,0,.35)', boomBg: '#db3236', flag: '#f23607', pole: '#3e2723', wrong: '#b71c1c',
      mark: '#3e2723', frame: '#4a752c', cursor: '#1a237e', hint: '#1565c0', start: '#ffffff',
    },
    dark: {
      bg: '#1e3314', hidden: '#3f6b2a', hidden2: '#386226', open: '#4b3a2c', open2: '#433326', openLine: 'rgba(0,0,0,.15)',
      nums: ['#64b5f6', '#81c784', '#ff8a80', '#ce93d8', '#ffcc80', '#80deea', '#eeeeee', '#bdbdbd'],
      mines: ['#ff5f62', '#ffa04d', '#ffd84d', '#3fcf88', '#7eeef6', '#7fa9ff', '#cf8cff', '#ff7fd0'],
      mine: '#000000', mineHi: 'rgba(0,0,0,.4)', boomBg: '#a3191d', flag: '#ff6e40', pole: '#d7ccc8', wrong: '#ff8a80',
      mark: '#f5f5f5', frame: '#1e3314', cursor: '#fff59d', hint: '#90caf9', start: '#fff59d',
    },
  },
  flat: {
    style: 'flat', font: (px) => `650 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, ${GEO_FONT}, ${EMOJI_FONT}, sans-serif`,
    light: {
      bg: '#e2e8f0', hidden: '#94a3b8', hiddenHi: 'rgba(255,255,255,.35)', hiddenLo: 'rgba(15,23,42,.10)', open: '#f8fafc', openLine: '#e2e8f0',
      nums: ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#0f172a', '#64748b'],
      mine: '#0f172a', mineHi: '#ffffff', boomBg: '#ef4444', flag: '#e11d48', pole: '#334155', wrong: '#dc2626',
      mark: '#ffffff', frame: '#e2e8f0', cursor: '#2563eb', hint: '#2563eb', start: '#16a34a',
    },
    dark: {
      bg: '#0b1120', hidden: '#334155', hiddenHi: 'rgba(255,255,255,.10)', hiddenLo: 'rgba(0,0,0,.25)', open: '#1e293b', openLine: '#0b1120',
      nums: ['#60a5fa', '#4ade80', '#f87171', '#c084fc', '#fb923c', '#22d3ee', '#f1f5f9', '#94a3b8'],
      mine: '#f8fafc', mineHi: '#0f172a', boomBg: '#b91c1c', flag: '#fb7185', pole: '#cbd5e1', wrong: '#f87171',
      mark: '#e2e8f0', frame: '#0b1120', cursor: '#60a5fa', hint: '#60a5fa', start: '#4ade80',
    },
  },
  neon: {
    style: 'neon', dark: true, font: (px) => `700 ${px}px ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, ${GEO_FONT}, ${EMOJI_FONT}, monospace`,
    light: {
      bg: '#05050d', hidden: '#141433', hiddenHi: '#22e3ff', hiddenLo: '#0a0a1f', open: '#07071a', openLine: 'rgba(120,90,255,.18)',
      nums: ['#22e3ff', '#39ff88', '#ff3f81', '#b26bff', '#ffd23f', '#00ffd5', '#ffffff', '#8a8aff'],
      mine: '#ff2bd6', mineHi: '#ffffff', boomBg: '#4a0035', flag: '#ffe14d', pole: '#ffe14d', wrong: '#ff3f81',
      mark: '#22e3ff', frame: '#05050d', cursor: '#ffe14d', hint: '#39ff88', start: '#39ff88', glow: 1,
    },
  },
  paper: {
    style: 'paper', font: (px) => `italic 600 ${px}px "Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", ${GEO_FONT}, ${EMOJI_FONT}, cursive`,
    light: {
      bg: '#f6f1e3', hidden: '#e9e2cf', hiddenHi: '#fffaf0', hiddenLo: 'rgba(70,60,40,.32)', open: '#fbf8ef', openLine: 'rgba(80,120,190,.28)',
      nums: ['#1d4ed8', '#15803d', '#b91c1c', '#1e3a8a', '#7c2d12', '#0f766e', '#111827', '#57534e'],
      mine: '#1f2937', mineHi: '#fbf8ef', boomBg: '#fca5a5', flag: '#c2410c', pole: '#1f2937', wrong: '#b91c1c',
      mark: '#1d4ed8', frame: '#f6f1e3', cursor: '#b91c1c', hint: '#1d4ed8', start: '#15803d',
    },
    // Dark paper: a blueprint.
    dark: {
      bg: '#0f3a6b', hidden: '#174a82', hiddenHi: 'rgba(255,255,255,.18)', hiddenLo: 'rgba(220,235,255,.35)', open: '#0f3a6b', openLine: 'rgba(200,225,255,.22)',
      nums: ['#ffffff', '#bff0ff', '#ffd1d1', '#d9e8ff', '#ffe7b0', '#c6fff2', '#ffffff', '#b8c7dc'],
      mine: '#ffffff', mineHi: '#0f3a6b', boomBg: '#8b1e3f', flag: '#ffb4a2', pole: '#ffffff', wrong: '#ff8a8a',
      mark: '#ffffff', frame: '#0f3a6b', cursor: '#ffe082', hint: '#ffe082', start: '#bff0ff',
    },
  },
  terminal: {
    style: 'term', dark: true, font: (px) => `700 ${px}px ui-monospace, "Cascadia Mono", Consolas, "Courier New", ${GEO_FONT}, ${EMOJI_FONT}, monospace`,
    light: {
      bg: '#020a04', hidden: '#06200d', hiddenHi: '#1f7a3a', hiddenLo: '#031207', open: '#020a04', openLine: 'rgba(51,255,102,.10)',
      nums: ['#33ff66', '#7dff9f', '#ffd166', '#ff9f43', '#ff6b6b', '#4dd0e1', '#e0ffe8', '#9be7b0'],
      mine: '#ff5c5c', mineHi: '#ffe0e0', boomBg: '#3d0a0a', flag: '#ffd166', pole: '#33ff66', wrong: '#ff5c5c',
      mark: '#33ff66', frame: '#020a04', cursor: '#e0ffe8', hint: '#e0ffe8', start: '#e0ffe8', glow: 0.6,
    },
  },
};

export const SKIN_IDS = Object.keys(SKINS);

// The palette of a skin for a colour scheme ('light' | 'dark').
// Dark palette only if the scheme is dark and the skin has a real dark palette object (dark !== true).
export function palette(id, scheme) {
  const s = SKINS[id] || SKINS.classic;
  return (scheme === 'dark' && s.dark !== true && s.dark) || s.light;
}
export const isDarkSkin = (id, scheme) => SKINS[id]?.dark === true || (scheme === 'dark' && !!SKINS[id]?.dark);

// ---------------------------------------------------------------------------------------------------------------------
// Symbol sets: the glyph of a count 1 … 24 (falls back to digits when a set is shorter).

// Subtractive Roman numerals up to 24 (XXIV) need only X, IX, V, IV, I; a greedy pass over descending values is exact.
const ROMAN = [['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]];
const roman = (k) => { let s = ''; for (const [r, v] of ROMAN) while (k >= v) { s += r; k -= v; } return s; };
const HAN = '一二三四五六七八九';
// Chinese numerals: 1-9 direct, 10-19 "十" + unit, 20+ tens digit + "十" + unit (二十四 = 24).
const han = (k) => (k < 10 ? HAN[k - 1] : (k >= 20 ? HAN[Math.floor(k / 10) - 1] : '') + '十' + (k % 10 ? HAN[(k % 10) - 1] : ''));
const mapDigits = (digits) => (k) => String(k).replace(/\d/g, (d) => digits[+d]);
const list = (s) => (k) => s[k - 1];

export const SYMBOL_SETS = {
  digits: (k) => String(k),
  roman,
  latin: list('ABCDEFGHIJKLMNOPQRSTUVWX'.split('')),
  greek: list('αβγδεζηθικλμνξοπρστυφχψω'.split('')),
  cyrillic: list('АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШ'.split('')),
  georgian: list('აბგდევზთიკლმნოპჟრსტუფქღყ'.split('')),
  han,
  arabic: mapDigits('٠١٢٣٤٥٦٧٨٩'),
  devanagari: mapDigits('०१२३४५६७८९'),
  hex: (k) => k.toString(16).toUpperCase(),
  binary: (k) => k.toString(2),
  bars: list('▁▂▃▄▅▆▇█'.split('')),
  moods: list(['🙂', '😐', '😕', '😟', '😨', '😰', '😱', '🤯']),
  pips: (k) => (k <= 9 ? { pips: k } : String(k)),
  custom: null,
};
export const SYMBOL_IDS = Object.keys(SYMBOL_SETS);

// Graphemes of a text (emoji with modifiers stay whole).
// Intl.Segmenter splits by user-perceived characters: "👍🏽" or a flag emoji is one symbol, while Array.from would
// split surrogate-pair code points and leave modifiers as separate "symbols".
export function graphemes(s) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  } catch { /* old engine */ }
  return Array.from(s);
}

// A custom list: tokens separated by spaces or commas ("one two three", "I, II, III"), otherwise one symbol per
// character ("abc", "🍎🍐🍊").
// Each token is clamped to 4 graphemes and the list to 24: longer labels would not fit a cell (text() shrinks the
// font to fit, but 10-character labels become unreadable).
export function parseCustom(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const parts = /[\s,;]/.test(s) ? s.split(/[\s,;]+/) : graphemes(s);
  return parts.filter(Boolean).slice(0, 24).map((x) => graphemes(x).slice(0, 4).join(''));
}

// symbolFn(set, custom) -> (k) => string | { pips }
export function symbolFn(set, custom) {
  if (set === 'custom') {
    const l = parseCustom(custom);
    return (k) => l[k - 1] ?? String(k);
  }
  const f = SYMBOL_SETS[set] || SYMBOL_SETS.digits;
  return (k) => f(k) ?? String(k);
}

// ---------------------------------------------------------------------------------------------------------------------
// Cell geometry and painting

// Pointy-top hexagon: width = sqrt(3) * R, height = 2R. With the pitch s as the width, R = s / sqrt(3).
const SQ3 = Math.sqrt(3);

// Sprite geometry for a cell pitch of s device pixels: square cells are s × s, hexagons s wide (pointy top).
export function cellGeometry(s, hex) {
  if (!hex) return { s, hex: false, w: s, h: s, cx: s / 2, cy: s / 2, r: s / 2 };
  const R = s / SQ3;
  return { s, hex: true, w: s, h: Math.ceil(2 * R), cx: s / 2, cy: R, r: R };
}

// inset * 1.1547 (= 2/sqrt(3)): converts a perpendicular inset from the edges into a reduction of the vertex radius,
// so a hex border is as thick as the square one at the same inset.
function hexPoints(g, inset) {
  const R = g.r - inset * 1.1547;
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 90);
    pts.push([g.cx + R * Math.cos(a), g.cy + R * Math.sin(a)]);
  }
  return pts;
}

// The cell outline, inset by `inset` px, rounded by `rad` px (squares).
// roundRect is recent (2023 in all engines); without it squares fall back to sharp corners - a cosmetic difference.
function shape(ctx, g, inset = 0, rad = 0) {
  ctx.beginPath();
  if (g.hex) {
    const p = hexPoints(g, inset);
    ctx.moveTo(p[0][0], p[0][1]);
    for (let k = 1; k < 6; k++) ctx.lineTo(p[k][0], p[k][1]);
    ctx.closePath();
  } else if (rad > 0 && ctx.roundRect) ctx.roundRect(inset, inset, g.s - 2 * inset, g.s - 2 * inset, rad);
  else ctx.rect(inset, inset, g.s - 2 * inset, g.s - 2 * inset);
}

// Raised (or sunken) bevel: light on the top-left edges, dark on the bottom-right ones.
// Bevel = two polygons (light top-left, dark bottom-right) rather than strokes: strokes on fractional pixels blur,
// filled polygons with integer thickness b stay sharp. Hexagons use per-edge quads between outer and inset outlines.
function bevel(ctx, g, b, hi, lo) {
  if (b <= 0) return;
  if (g.hex) {
    const o = hexPoints(g, 0), i = hexPoints(g, b);
    const quad = (k, col) => {
      const k2 = (k + 1) % 6;
      ctx.beginPath();
      ctx.moveTo(o[k][0], o[k][1]); ctx.lineTo(o[k2][0], o[k2][1]); ctx.lineTo(i[k2][0], i[k2][1]); ctx.lineTo(i[k][0], i[k][1]);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    };
    // vertices: 0 top, 1 upper right, 2 lower right, 3 bottom, 4 lower left, 5 upper left
    [5, 4, 0].forEach((k) => quad(k, hi));
    [1, 2, 3].forEach((k) => quad(k, lo));
    return;
  }
  const s = g.s;
  ctx.fillStyle = hi;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, 0); ctx.lineTo(s - b, b); ctx.lineTo(b, b); ctx.lineTo(b, s - b); ctx.lineTo(0, s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = lo;
  ctx.beginPath(); ctx.moveTo(s, s); ctx.lineTo(0, s); ctx.lineTo(b, s - b); ctx.lineTo(s - b, s - b); ctx.lineTo(s - b, b); ctx.lineTo(s, 0); ctx.closePath(); ctx.fill();
}

// Diagonal pencil hatching for paper cells, clipped to the cell outline. dir alternates by checker parity so adjacent
// cells do not merge into a continuous pattern.
function hatch(ctx, g, col, step, dir) {
  ctx.save();
  shape(ctx, g, 0);
  ctx.clip();
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, g.s / 28);
  ctx.beginPath();
  for (let x = -g.h; x < g.w + g.h; x += step) {
    if (dir) { ctx.moveTo(x, g.h); ctx.lineTo(x + g.h * 0.9, 0); } else { ctx.moveTo(x, 0); ctx.lineTo(x + g.h * 0.9, g.h); }
  }
  ctx.stroke();
  ctx.restore();
}

// Cell background per skin style. "open" covers every revealed kind (open, mine, boom, wrong); press draws a hidden
// cell in its pushed state (classic: flat like an open cell; other skins: a translucent overlay).
function base(ctx, kind, g, skin, pal, v) {
  const s = g.s, style = skin.style;
  const open = kind !== 'hidden' && kind !== 'flag' && kind !== 'mark' && kind !== 'press';
  const press = kind === 'press';
  if (style === 'bevel') {
    shape(ctx, g);
    ctx.fillStyle = kind === 'boom' ? pal.boomBg : open || press ? pal.open : pal.hidden;
    ctx.fill();
    if (open || press) {
      ctx.strokeStyle = pal.openLine;
      ctx.lineWidth = Math.max(1, Math.round(s / 24));
      if (g.hex) { shape(ctx, g, ctx.lineWidth / 2); ctx.stroke(); } else {
        ctx.beginPath();
        ctx.moveTo(ctx.lineWidth / 2, s); ctx.lineTo(ctx.lineWidth / 2, ctx.lineWidth / 2); ctx.lineTo(s, ctx.lineWidth / 2);
        ctx.stroke();
      }
    } else bevel(ctx, g, Math.max(1, Math.round(s * 0.12)), pal.hiddenHi, pal.hiddenLo);
    return;
  }
  if (style === 'grass') {
    shape(ctx, g);
    ctx.fillStyle = kind === 'boom' ? pal.boomBg : open ? (v & 1 ? pal.open2 : pal.open) : (v & 1 ? pal.hidden2 : pal.hidden);
    ctx.fill();
    if (press) { shape(ctx, g); ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill(); }
    if (open) { ctx.strokeStyle = pal.openLine; ctx.lineWidth = 1; shape(ctx, g, 0.5); ctx.stroke(); }
    return;
  }
  if (style === 'flat') {
    const gap = Math.max(1, s * 0.06), rad = s * 0.2;
    shape(ctx, g, gap, rad);
    ctx.fillStyle = kind === 'boom' ? pal.boomBg : open ? pal.open : pal.hidden;
    ctx.fill();
    if (!open) {
      const gr = ctx.createLinearGradient(0, 0, 0, g.h);
      gr.addColorStop(0, pal.hiddenHi);
      gr.addColorStop(0.55, 'rgba(255,255,255,0)');
      gr.addColorStop(1, pal.hiddenLo);
      shape(ctx, g, gap, rad);
      ctx.fillStyle = gr;
      ctx.fill();
      if (press) { shape(ctx, g, gap, rad); ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fill(); }
    }
    return;
  }
  if (style === 'neon') {
    shape(ctx, g);
    ctx.fillStyle = kind === 'boom' ? pal.boomBg : pal.open;
    ctx.fill();
    ctx.strokeStyle = pal.openLine;
    ctx.lineWidth = 1;
    shape(ctx, g, 0.5);
    ctx.stroke();
    if (!open) {
      const ins = Math.max(1.5, s * 0.12);
      shape(ctx, g, ins, s * 0.16);
      ctx.fillStyle = press ? '#1f1f4d' : pal.hidden;
      ctx.fill();
      ctx.save();
      ctx.shadowColor = pal.hiddenHi;
      ctx.shadowBlur = s * 0.22;
      ctx.strokeStyle = pal.hiddenHi;
      ctx.globalAlpha = press ? 1 : 0.75;
      ctx.lineWidth = Math.max(1, s * 0.05);
      shape(ctx, g, ins, s * 0.16);
      ctx.stroke();
      ctx.restore();
    }
    return;
  }
  if (style === 'paper') {
    shape(ctx, g);
    ctx.fillStyle = kind === 'boom' ? pal.boomBg : open ? pal.open : pal.hidden;
    ctx.fill();
    if (!open) {
      hatch(ctx, g, pal.hiddenLo, Math.max(3, s / 5), v & 1);
      if (press) { shape(ctx, g); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); }
    }
    ctx.strokeStyle = pal.openLine;
    ctx.lineWidth = Math.max(1, s / 40);
    shape(ctx, g, ctx.lineWidth / 2);
    ctx.stroke();
    return;
  }
  // terminal
  shape(ctx, g);
  ctx.fillStyle = kind === 'boom' ? pal.boomBg : open ? pal.open : pal.hidden;
  ctx.fill();
  ctx.strokeStyle = pal.openLine;
  ctx.lineWidth = 1;
  shape(ctx, g, 0.5);
  ctx.stroke();
  if (!open) {
    // a dim block of dots, like a shaded character cell
    ctx.fillStyle = press ? pal.hiddenHi : pal.hiddenLo;
    const st = Math.max(2, Math.round(s / 6));
    ctx.save();
    shape(ctx, g, Math.max(1, s * 0.1));
    ctx.clip();
    ctx.fillStyle = pal.hiddenHi;
    ctx.globalAlpha = press ? 0.75 : 0.38;
    const dot = Math.max(1, s / 16);
    for (let y = st / 2; y < g.h; y += st) for (let x = (y / st) % 2 ? st / 2 : 0; x < g.w; x += st) ctx.fillRect(x, y, dot, dot);
    ctx.restore();
  }
}

// Fits the label into 86% of the cell width (shrinking the font if needed) and centres the actual ink box using
// actualBoundingBoxAscent/Descent: textBaseline 'middle' is font-dependent and visibly off for digits in many fonts.
// Glow is a second pass with shadowBlur, which is expensive - acceptable because sprites are cached.
function text(ctx, g, str, color, skin, scale = 0.64, glow = 0) {
  const s = g.s;
  let px = Math.max(6, Math.round(s * scale));
  ctx.font = skin.font(px);
  const wMax = s * 0.86;
  const w = ctx.measureText(str).width;
  if (w > wMax) { px = Math.max(5, Math.floor(px * wMax / w)); ctx.font = skin.font(px); }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Centre the glyph box itself (fonts differ in where 'middle' falls); 'middle' where the engine has no metrics.
  const m = ctx.measureText(str);
  let y = g.cy;
  if (m.actualBoundingBoxAscent != null && m.actualBoundingBoxAscent + m.actualBoundingBoxDescent > 0) y = g.cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  else ctx.textBaseline = 'middle';
  if (glow) { ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = s * 0.28 * glow; ctx.fillText(str, g.cx, y); ctx.restore(); }
  ctx.fillText(str, g.cx, y);
}

// Dice-style pips for counts 1..9 on a 3 x 3 lattice (offsets -1/0/1 times d).
function pips(ctx, g, k, color) {
  const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    7: [[-1, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [1, 1]], 8: [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
    9: [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] }[k] || [];
  const d = g.s * 0.24, r = Math.max(1, g.s * 0.075);
  ctx.fillStyle = color;
  for (const [x, y] of P) { ctx.beginPath(); ctx.arc(g.cx + x * d, g.cy + y * d, r, 0, Math.PI * 2); ctx.fill(); }
}

// Classic mine: eight spikes (alternating lengths), body disc, specular dot. Meadow draws coloured round mines.
function mine(ctx, g, pal, skin, color) {
  const s = g.s, cx = g.cx, cy = g.cy, r = s * 0.26;
  if (skin.style === 'grass') {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.mineHi;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.17, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.save();
  if (pal.glow) { ctx.shadowColor = pal.mine; ctx.shadowBlur = s * 0.3 * pal.glow; }
  ctx.strokeStyle = pal.mine;
  ctx.fillStyle = pal.mine;
  ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI / 4) * k, l = k % 2 ? r * 1.25 : r * 1.55;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
  }
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = pal.mineHi;
  ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.35, Math.max(1, r * 0.28), 0, Math.PI * 2); ctx.fill();
}

function flag(ctx, g, pal, skin) {
  const s = g.s, cx = g.cx, cy = g.cy;
  ctx.save();
  if (pal.glow) { ctx.shadowColor = pal.flag; ctx.shadowBlur = s * 0.25 * pal.glow; }
  const lw = Math.max(1, s * 0.07);
  // base
  ctx.fillStyle = pal.pole;
  if (skin.style === 'bevel') {
    ctx.fillRect(cx - s * 0.25, cy + s * 0.2, s * 0.5, Math.max(1, s * 0.08));
    ctx.fillRect(cx - s * 0.14, cy + s * 0.13, s * 0.28, Math.max(1, s * 0.08));
  } else if (skin.style !== 'neon' && skin.style !== 'term') {
    ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.26, s * 0.2, s * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  }
  // pole
  ctx.fillRect(cx - lw / 2 + s * 0.04, cy - s * 0.3, lw, s * 0.56);
  // cloth
  ctx.fillStyle = pal.flag;
  ctx.beginPath();
  if (skin.style === 'paper') {
    ctx.moveTo(cx + s * 0.04, cy - s * 0.3);
    ctx.quadraticCurveTo(cx - s * 0.12, cy - s * 0.26, cx - s * 0.28, cy - s * 0.15);
    ctx.quadraticCurveTo(cx - s * 0.1, cy - s * 0.1, cx + s * 0.04, cy - s * 0.02);
  } else {
    ctx.moveTo(cx + s * 0.04, cy - s * 0.31);
    ctx.lineTo(cx - s * 0.28, cy - s * 0.15);
    ctx.lineTo(cx + s * 0.04, cy + s * 0.0);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function cross(ctx, g, color) {
  const s = g.s, d = s * 0.3;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(g.cx - d, g.cy - d); ctx.lineTo(g.cx + d, g.cy + d);
  ctx.moveTo(g.cx + d, g.cy - d); ctx.lineTo(g.cx - d, g.cy + d);
  ctx.stroke();
}

/**
 * Paints one sprite.
 *   kind     'hidden' | 'press' | 'open' (count k) | 'flag' | 'mark' | 'mine' | 'boom' | 'wrong'
 *   k        count of an open cell (0 = empty)
 *   v        variant (bit 0: checker parity; bits 1+: mine colour of the meadow skin)
 *   look     { symbol(k), mineGlyph, flagGlyph, zero }
 */
export function paintCell(ctx, g, skinId, scheme, kind, k, v, look) {
  const skin = SKINS[skinId] || SKINS.classic;
  const pal = palette(skinId, scheme);
  base(ctx, kind, g, skin, pal, v);
  const glow = pal.glow || 0;
  if (kind === 'open' && k > 0) {
    const sym = look.symbol(k);
    const color = pal.nums[(k - 1) % pal.nums.length];
    if (sym && typeof sym === 'object') pips(ctx, g, sym.pips, color);
    else text(ctx, g, String(sym), color, skin, String(sym).length > 2 ? 0.5 : 0.64, glow);
  } else if (kind === 'open' && skin.style === 'term') text(ctx, g, '·', pal.hiddenHi, skin, 0.5);
  else if (kind === 'flag' || kind === 'wrong') {
    if (look.flagGlyph) text(ctx, g, look.flagGlyph, pal.flag, skin, 0.62, glow);
    else flag(ctx, g, pal, skin);
    if (kind === 'wrong') cross(ctx, g, pal.wrong);
  } else if (kind === 'mark') text(ctx, g, '?', pal.mark, skin, 0.62, glow);
  else if (kind === 'mine' || kind === 'boom') {
    if (look.mineGlyph) text(ctx, g, look.mineGlyph, pal.mine, skin, 0.62, glow);
    else mine(ctx, g, pal, skin, pal.mines ? pal.mines[(v >> 1) % pal.mines.length] : pal.mine);
  }
}
