// stitch/font.js - stitch fonts: bitmap alphabets for lettering on a chart (one stitch per dot). 'pixel' is a 5 × 8
// font (Latin, digits, punctuation, Russian and Ukrainian Cyrillic, with descenders); 'small' a 3 × 5 font (digits,
// capitals, a few marks) for dates and monograms. Text is laid out with spacing, line height, scale (each dot as
// n × n stitches) and an optional bold (dots widened by one stitch). Scripts without a stitch font are drawn by the
// applications from system fonts (canvas) instead.
//
//   FONTS { id: { name, w, h, base, glyphs } }
//   textBitmap(text, { font = 'pixel', scale = 1, bold = false, spacing = 1, lineGap = 2, align = 'left' })
//     -> { width, height, bits: Uint8Array (1 = stitch), missing: [characters without a glyph] }

// Glyph encoding: one hex byte per row, top to bottom, bit (w - 1) = leftmost column. 8 rows for 'pixel' (row 7 is
// the descender row: g, j, p, q, y), 5 rows of one hex digit for 'small'. Hand-tuned data; strings keep the tables
// compact and editable versus nested arrays.
const PIXEL = {
  ' ': '00 00 00 00 00 00 00 00', '!': '04 04 04 04 00 00 04 00', '"': '0A 0A 0A 00 00 00 00 00', '#': '0A 0A 1F 0A 1F 0A 0A 00',
  '$': '04 0F 14 0E 05 1E 04 00', '%': '18 19 02 04 08 13 03 00', '&': '0C 12 14 08 15 12 0D 00', "'": '0C 04 08 00 00 00 00 00',
  '(': '02 04 08 08 08 04 02 00', ')': '08 04 02 02 02 04 08 00', '*': '00 04 15 0E 15 04 00 00', '+': '00 04 04 1F 04 04 00 00',
  ',': '00 00 00 00 0C 04 08 00', '-': '00 00 00 1F 00 00 00 00', '.': '00 00 00 00 00 0C 0C 00', '/': '00 01 02 04 08 10 00 00',
  0: '0E 11 13 15 19 11 0E 00', 1: '04 0C 04 04 04 04 0E 00', 2: '0E 11 01 02 04 08 1F 00', 3: '1F 02 04 02 01 11 0E 00',
  4: '02 06 0A 12 1F 02 02 00', 5: '1F 10 1E 01 01 11 0E 00', 6: '06 08 10 1E 11 11 0E 00', 7: '1F 01 02 04 08 08 08 00',
  8: '0E 11 11 0E 11 11 0E 00', 9: '0E 11 11 0F 01 02 0C 00', ':': '00 0C 0C 00 0C 0C 00 00', ';': '00 0C 0C 00 0C 04 08 00',
  '<': '02 04 08 10 08 04 02 00', '=': '00 00 1F 00 1F 00 00 00', '>': '08 04 02 01 02 04 08 00', '?': '0E 11 01 02 04 00 04 00',
  '@': '0E 11 01 0D 15 15 0E 00', A: '0E 11 11 11 1F 11 11 00', B: '1E 11 11 1E 11 11 1E 00', C: '0E 11 10 10 10 11 0E 00',
  D: '1C 12 11 11 11 12 1C 00', E: '1F 10 10 1E 10 10 1F 00', F: '1F 10 10 1E 10 10 10 00', G: '0E 11 10 17 11 11 0F 00',
  H: '11 11 11 1F 11 11 11 00', I: '0E 04 04 04 04 04 0E 00', J: '07 02 02 02 02 12 0C 00', K: '11 12 14 18 14 12 11 00',
  L: '10 10 10 10 10 10 1F 00', M: '11 1B 15 15 11 11 11 00', N: '11 11 19 15 13 11 11 00', O: '0E 11 11 11 11 11 0E 00',
  P: '1E 11 11 1E 10 10 10 00', Q: '0E 11 11 11 15 12 0D 00', R: '1E 11 11 1E 14 12 11 00', S: '0F 10 10 0E 01 01 1E 00',
  T: '1F 04 04 04 04 04 04 00', U: '11 11 11 11 11 11 0E 00', V: '11 11 11 11 11 0A 04 00', W: '11 11 11 15 15 15 0A 00',
  X: '11 11 0A 04 0A 11 11 00', Y: '11 11 11 0A 04 04 04 00', Z: '1F 01 02 04 08 10 1F 00', '[': '0E 08 08 08 08 08 0E 00',
  '\\': '00 10 08 04 02 01 00 00', ']': '0E 02 02 02 02 02 0E 00', '^': '04 0A 11 00 00 00 00 00', _: '00 00 00 00 00 00 1F 00',
  '`': '08 04 02 00 00 00 00 00', a: '00 00 0E 01 0F 11 0F 00', b: '10 10 16 19 11 11 1E 00', c: '00 00 0E 10 10 11 0E 00',
  d: '01 01 0D 13 11 11 0F 00', e: '00 00 0E 11 1F 10 0E 00', f: '06 09 08 1C 08 08 08 00', g: '00 00 0F 11 11 0F 01 0E',
  h: '10 10 16 19 11 11 11 00', i: '04 00 0C 04 04 04 0E 00', j: '02 00 06 02 02 02 12 0C', k: '10 10 12 14 18 14 12 00',
  l: '0C 04 04 04 04 04 0E 00', m: '00 00 1A 15 15 11 11 00', n: '00 00 16 19 11 11 11 00', o: '00 00 0E 11 11 11 0E 00',
  p: '00 00 1E 11 11 1E 10 10', q: '00 00 0F 11 11 0F 01 01', r: '00 00 16 19 10 10 10 00', s: '00 00 0E 10 0E 01 1E 00',
  t: '08 08 1C 08 08 09 06 00', u: '00 00 11 11 11 13 0D 00', v: '00 00 11 11 11 0A 04 00', w: '00 00 11 11 15 15 0A 00',
  x: '00 00 11 0A 04 0A 11 00', y: '00 00 11 11 11 0F 01 0E', z: '00 00 1F 02 04 08 1F 00', '{': '02 04 04 08 04 04 02 00',
  '|': '04 04 04 04 04 04 04 00', '}': '08 04 04 02 04 04 08 00', '~': '00 00 08 15 02 00 00 00', '♥': '00 0A 1F 1F 0E 04 00 00',
  '♦': '04 0E 1F 1F 0E 04 00 00', '★': '04 04 1F 0E 0E 1B 00 00', '©': '0E 11 17 19 17 11 0E 00', '№': '12 1A 1A 16 17 12 12 00',
  // Cyrillic
  А: '0E 11 11 11 1F 11 11 00', Б: '1F 10 10 1E 11 11 1E 00', В: '1E 11 11 1E 11 11 1E 00', Г: '1F 10 10 10 10 10 10 00',
  Д: '0E 0A 0A 0A 0A 1F 11 00', Е: '1F 10 10 1E 10 10 1F 00', Ё: '0A 1F 10 1E 10 10 1F 00', Ж: '15 15 15 0E 15 15 15 00',
  З: '0E 11 01 06 01 11 0E 00', И: '11 11 13 15 19 11 11 00', Й: '0A 04 11 13 15 19 11 00', К: '11 12 14 18 14 12 11 00',
  Л: '07 09 09 09 09 09 11 00', М: '11 1B 15 15 11 11 11 00', Н: '11 11 11 1F 11 11 11 00', О: '0E 11 11 11 11 11 0E 00',
  П: '1F 11 11 11 11 11 11 00', Р: '1E 11 11 1E 10 10 10 00', С: '0E 11 10 10 10 11 0E 00', Т: '1F 04 04 04 04 04 04 00',
  У: '11 11 11 0F 01 11 0E 00', Ф: '04 0E 15 15 15 0E 04 00', Х: '11 11 0A 04 0A 11 11 00', Ц: '12 12 12 12 12 1F 01 00',
  Ч: '11 11 11 0F 01 01 01 00', Ш: '15 15 15 15 15 15 1F 00', Щ: '15 15 15 15 15 1F 01 00', Ъ: '18 08 08 0E 09 09 0E 00',
  Ы: '11 11 11 19 15 15 19 00', Ь: '10 10 10 1E 11 11 1E 00', Э: '0E 11 01 07 01 11 0E 00', Ю: '12 15 15 1D 15 15 12 00',
  Я: '0F 11 11 0F 05 09 11 00', Є: '0E 11 10 1C 10 11 0E 00', І: '0E 04 04 04 04 04 0E 00', Ї: '0A 00 0E 04 04 04 0E 00',
  Ґ: '01 1F 10 10 10 10 10 00',
  а: '00 00 0E 01 0F 11 0F 00', б: '0E 10 1E 11 11 11 0E 00', в: '00 00 1E 11 1E 11 1E 00', г: '00 00 1F 10 10 10 10 00',
  д: '00 00 0E 0A 0A 1F 11 00', е: '00 00 0E 11 1F 10 0E 00', ё: '0A 00 0E 11 1F 10 0E 00', ж: '00 00 15 15 0E 15 15 00',
  з: '00 00 0E 11 06 11 0E 00', и: '00 00 11 13 15 19 11 00', й: '0A 04 11 13 15 19 11 00', к: '00 00 11 12 1C 12 11 00',
  л: '00 00 07 09 09 09 11 00', м: '00 00 11 1B 15 11 11 00', н: '00 00 11 11 1F 11 11 00', о: '00 00 0E 11 11 11 0E 00',
  п: '00 00 1F 11 11 11 11 00', р: '00 00 1E 11 11 1E 10 10', с: '00 00 0E 10 10 11 0E 00', т: '00 00 1F 04 04 04 04 00',
  у: '00 00 11 11 11 0F 01 0E', ф: '00 04 0E 15 15 0E 04 00', х: '00 00 11 0A 04 0A 11 00', ц: '00 00 12 12 12 1F 01 00',
  ч: '00 00 11 11 0F 01 01 00', ш: '00 00 15 15 15 15 1F 00', щ: '00 00 15 15 15 1F 01 00', ъ: '00 00 18 08 0E 09 0E 00',
  ы: '00 00 11 11 19 15 19 00', ь: '00 00 10 10 1E 11 1E 00', э: '00 00 0E 01 07 01 0E 00', ю: '00 00 12 15 1D 15 12 00',
  я: '00 00 0F 11 0F 05 09 00', є: '00 00 0E 10 1C 10 0E 00', і: '04 00 0C 04 04 04 0E 00', ї: '0A 00 0C 04 04 04 0E 00',
  ґ: '00 01 1F 10 10 10 10 00',
};

// 3 x 5: digits, capitals and Cyrillic capitals only; lowercase input is upper-cased in textBitmap.
const SMALL = {
  ' ': '0 0 0 0 0', 0: '7 5 5 5 7', 1: '2 6 2 2 7', 2: '7 1 7 4 7', 3: '7 1 7 1 7', 4: '5 5 7 1 1', 5: '7 4 7 1 7', 6: '7 4 7 5 7',
  7: '7 1 2 2 2', 8: '7 5 7 5 7', 9: '7 5 7 1 7', A: '2 5 7 5 5', B: '6 5 6 5 6', C: '3 4 4 4 3', D: '6 5 5 5 6', E: '7 4 6 4 7',
  F: '7 4 6 4 4', G: '3 4 5 5 3', H: '5 5 7 5 5', I: '7 2 2 2 7', J: '1 1 1 5 2', K: '5 5 6 5 5', L: '4 4 4 4 7', M: '5 7 7 5 5',
  N: '6 5 5 5 5', O: '2 5 5 5 2', P: '6 5 6 4 4', Q: '2 5 5 6 3', R: '6 5 6 5 5', S: '3 4 2 1 6', T: '7 2 2 2 2', U: '5 5 5 5 7',
  V: '5 5 5 5 2', W: '5 5 7 7 5', X: '5 5 2 5 5', Y: '5 5 2 2 2', Z: '7 1 2 4 7', '.': '0 0 0 0 2', ',': '0 0 0 2 4', '-': '0 0 7 0 0',
  '+': '0 2 7 2 0', ':': '0 2 0 2 0', '!': '2 2 2 0 2', '?': '6 1 2 0 2', '/': '1 1 2 4 4', '&': '2 5 2 5 3', '♥': '5 7 7 2 0',
  "'": '2 2 0 0 0', '#': '5 7 5 7 5', '(': '1 2 2 2 1', ')': '4 2 2 2 4', '=': '0 7 0 7 0',
  А: '2 5 7 5 5', Б: '7 4 6 5 6', В: '6 5 6 5 6', Г: '7 4 4 4 4', Д: '3 5 5 7 5', Е: '7 4 6 4 7', Ж: '7 7 2 7 7', З: '6 1 2 1 6',
  И: '5 5 7 7 5', Й: '2 5 7 7 5', К: '5 5 6 5 5', Л: '3 5 5 5 5', М: '5 7 7 5 5', Н: '5 5 7 5 5', О: '2 5 5 5 2', П: '7 5 5 5 5',
  Р: '6 5 6 4 4', С: '3 4 4 4 3', Т: '7 2 2 2 2', У: '5 5 3 1 6', Ф: '2 7 7 2 2', Х: '5 5 2 5 5', Ц: '5 5 5 7 1', Ч: '5 5 3 1 1',
  Ш: '5 5 7 7 7', Щ: '5 7 7 7 1', Ъ: '6 2 3 3 3', Ы: '5 5 7 7 7', Ь: '4 4 6 5 6', Э: '6 1 3 1 6', Ю: '5 7 7 7 5', Я: '3 5 3 5 5',
  Є: '3 4 6 4 3', І: '7 2 2 2 7', Ї: '5 0 2 2 2', Ґ: '1 7 4 4 4',
};

function build(map, w) {
  const glyphs = {};
  for (const [ch, rows] of Object.entries(map)) glyphs[ch] = rows.split(' ').map((r) => parseInt(r, 16));
  return { w, glyphs };
}

export const FONTS = {
  pixel: { name: 'Pixel 5 × 8', h: 8, base: 7, ...build(PIXEL, 5) },
  small: { name: 'Small 3 × 5', h: 5, base: 5, ...build(SMALL, 3) },
};

// Width in dots of a glyph.
// Proportional spacing: trims empty columns on both sides. Returns a bare number for a blank glyph (space: no
// columns to trim, gets ~0.6 em = 3 dots in 'pixel', 2 in 'small') and { left, width } otherwise; textBitmap
// distinguishes the two by typeof. right counts from bit 0, which is the rightmost column.
function glyphWidth(font, rows) {
  let used = 0;
  for (const r of rows) used |= r;
  if (!used) return Math.max(2, Math.round(font.w * 0.6));
  let right = 0;
  while (right < font.w && !(used & (1 << right))) right++;
  let left = 0;
  while (left < font.w && !(used & (1 << (font.w - 1 - left)))) left++;
  return { left, width: font.w - left - right };
}

// Glyph lookup order: exact, upper-case (small font), the base letter after NFKD with combining marks stripped
// (é -> e for accented Latin), then '?' with the character reported in missing so the UI can warn.
// Layout: two passes, measure lines then paint, so center / right alignment knows the widest line. bold widens each
// dot to the right by one stitch (and the advance by one), which keeps glyph shapes legible at stitch resolution;
// thickening in both directions would merge counters in 5 x 8 letters. scale multiplies whole dots after layout.
export function textBitmap(text, { font = 'pixel', scale = 1, bold = false, spacing = 1, lineGap = 2, align = 'left', proportional = true } = {}) {
  const f = FONTS[font] || FONTS.pixel;
  const small = f === FONTS.small;
  const missing = new Set();
  const lines = String(text ?? '').split(/\r?\n/).map((line) => {
    const items = [];
    for (let ch of line) {
      let rows = f.glyphs[ch];
      if (!rows && small) rows = f.glyphs[ch.toUpperCase()];
      if (!rows) { const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, ''); rows = f.glyphs[base] || (small ? f.glyphs[base.toUpperCase()] : null); }
      if (!rows) { missing.add(ch); rows = f.glyphs['?']; }
      const gw = glyphWidth(f, rows);
      items.push(typeof gw === 'number' ? { rows: null, left: 0, width: gw } : proportional ? { rows, ...gw } : { rows, left: 0, width: f.w });
    }
    const width = items.reduce((a, it, i) => a + it.width + (i ? spacing : 0) + (bold && it.rows ? 1 : 0), 0);
    return { items, width };
  });
  const lw = Math.max(1, ...lines.map((l) => l.width));
  const lineH = f.h + lineGap;
  const W = lw * scale, H = Math.max(1, lines.length * lineH - lineGap) * scale;
  const bits = new Uint8Array(W * H);
  lines.forEach((line, li) => {
    let x = align === 'center' ? Math.floor((lw - line.width) / 2) : align === 'right' ? lw - line.width : 0;
    const y0 = li * lineH;
    line.items.forEach((it, i) => {
      if (i) x += spacing;
      if (it.rows) {
        for (let ry = 0; ry < f.h; ry++) {
          const row = it.rows[ry] || 0;
          for (let rx = 0; rx < it.width; rx++) {
            const on = row & (1 << (f.w - 1 - (rx + it.left)));
            if (!on) continue;
            for (let b = 0; b <= (bold ? 1 : 0); b++) {
              const gx = x + rx + b, gy = y0 + ry;
              for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
                const px = gx * scale + sx, py = gy * scale + sy;
                if (px < W && py < H) bits[py * W + px] = 1;
              }
            }
          }
        }
        x += it.width + (bold ? 1 : 0);
      } else x += it.width;
    });
  });
  return { width: W, height: H, bits, missing: [...missing] };
}
