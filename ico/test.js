// ico/test.js - unit tests of the icon encoder / decoder and of raster/wand.js (the magic wand the icon tools use):
// `node ico/test.js` (importing the module runs nothing).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeICO, encodeBMPEntry, encodeICO, icoInfo } from './ico.js';
import { clearMask, growMask, removeBackground, wandMask } from '../raster/wand.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// A test image: a disc of `fg` on `bg` (alpha 255), w x h, with a 1-px anti-aliased-ish ring.
function disc(w, h, fg = [200, 30, 40, 255], bg = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  const r = Math.min(w, h) * 0.35;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2);
      const k = Math.max(0, Math.min(1, r + 0.5 - d));
      for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = Math.round(bg[c] * (1 - k) + fg[c] * k);
    }
  }
  return { width: w, height: h, data };
}

export async function run() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('x ico: ' + msg); } };

  // --- round trips: BMP entries, PNG entries, every standard size, alpha preserved
  const sizes = [16, 32, 48, 64, 128, 256];
  const imgs = sizes.map((n) => disc(n, n, [10, 120, 250, 255], [0, 0, 0, 0]));
  for (const png of ['auto', 'all', 'none']) {
    const bytes = encodeICO(imgs, { png });
    const info = icoInfo(bytes);
    ok(info.length === sizes.length, `${png}: ${info.length} entries`);
    ok(info[0].width === 256 && info[0].height === 256, `${png}: 256 is written as 0 and read back`);
    ok(info.every((e) => e.png === (png === 'all' || (png === 'auto' && e.width === 256))), `${png}: entry formats`);
    const back = decodeICO(bytes);
    for (const img of imgs) {
      const b = back.find((x) => x.width === img.width);
      ok(b && b.data.length === img.data.length && b.data.every((v, i) => v === img.data[i]), `${png}: ${img.width} px pixels`);
    }
  }
  // header bytes: reserved 0, type 1, count
  const one = encodeICO([disc(16, 16)]);
  ok(one[0] === 0 && one[1] === 0 && one[2] === 1 && one[3] === 0 && one[4] === 1, 'ICONDIR header');
  ok(one[6] === 16 && one[7] === 16 && one[10] === 1 && one[12] === 32, 'ICONDIRENTRY fields');
  // AND mask: bit set where alpha is 0
  const bmp = encodeBMPEntry({ width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 0, 4, 5, 6, 255]) });
  ok(bmp[40] === 3 && bmp[41] === 2 && bmp[42] === 1 && bmp[43] === 0, 'BGRA order');
  ok(bmp[48] === 0x80, 'AND mask bit of the transparent pixel');
  // legacy 32-bit icon with no alpha at all: transparency comes from the AND mask
  const legacy = encodeICO([{ width: 2, height: 1, data: new Uint8ClampedArray([9, 9, 9, 0, 8, 8, 8, 0]) }], { png: 'none' });
  legacy[6 + 16 + 48] = 0x80;   // mask: first pixel transparent, second opaque
  const lb = decodeICO(legacy)[0];
  ok(lb.data[3] === 0 && lb.data[7] === 255, 'AND mask used when alpha is empty');
  let threw = false;
  try { encodeICO([disc(300, 300)]); } catch { threw = true; }
  ok(threw, 'sizes above 256 are refused');
  threw = false;
  try { icoInfo(new Uint8Array([1, 2, 3, 4, 5, 6])); } catch { threw = true; }
  ok(threw, 'not an icon file');

  // --- magic wand
  const img = disc(40, 30);
  const m = wandMask(img, 0, 0, { tolerance: 10 });
  ok(m && m.mask[0] === 255 && m.mask[15 * 40 + 20] === 0, 'contiguous wand takes the background, not the disc');
  const g = wandMask(img, 20, 15, { tolerance: 10, contiguous: false });
  ok(g && g.mask[15 * 40 + 20] === 255 && g.mask[0] === 0, 'global wand takes the disc colour');
  const soft = wandMask(img, 0, 0, { tolerance: 200, soft: 1, metric: 'rgba' });
  ok(soft.mask[0] === 255 && [...soft.mask].some((v) => v > 0 && v < 255), 'soft edge gives partial coverage');
  // diagonal connectivity: two pixels touching only at a corner
  const diag = { width: 3, height: 3, data: new Uint8ClampedArray(36).fill(255) };
  for (const i of [0, 4]) diag.data.set([0, 0, 0, 255], i * 4);
  ok(wandMask(diag, 0, 0, { tolerance: 0 }).mask[4] === 0, '4-connected stops at a corner');
  ok(wandMask(diag, 0, 0, { tolerance: 0, diagonal: true }).mask[4] === 255, '8-connected crosses a corner');
  const grown = growMask(new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0]), 3, 3, 1);
  ok(grown.every((v) => v === 255), 'grow by 1');
  const shrunk = growMask(grown, 3, 3, -1);
  ok(shrunk[4] === 255 && shrunk[0] === 0 && shrunk[1] === 0, 'shrink: outside the image counts as unselected');
  const cleared = clearMask(disc(4, 4), new Uint8Array(16).fill(255));
  ok(cleared.data.every((v, i) => i % 4 !== 3 || v === 0), 'clearMask makes everything transparent');
  const cut = removeBackground(disc(40, 30), { tolerance: 120, soft: 0.8 });
  ok(cut.data[3] === 0 && cut.data[(15 * 40 + 20) * 4 + 3] === 255, 'removeBackground: corners clear, subject kept');
  // decontamination: an edge pixel half white, half red keeps a red colour after the white is removed
  const edge = (() => { for (let i = 0; i < 40 * 30; i++) { const a = cut.data[i * 4 + 3]; if (a > 20 && a < 235) return i; } return -1; })();
  ok(edge >= 0 && cut.data[edge * 4] - cut.data[edge * 4 + 1] > 80, 'decontaminated edge keeps the subject colour');

  console.log(`ico: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
