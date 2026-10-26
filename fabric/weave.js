// fabric/weave.js - weave structures and weaving drafts. A weave is a binary matrix over one repeat: cell (end, pick)
// is 1 where the warp end lies over the weft pick. Structures: plain, twills (any up / down, S or Z), herringbone,
// broken twill, satins (any shaft count with a valid move), basket, warp / weft rib, hopsack, waffle-like diamond, and
// jacquard from a bitmap (a figure weave where the bitmap is dark, a ground weave elsewhere). A weaving draft is the
// threading (shaft per end), tie-up (shaft x treadle) and treadling (treadle per pick); its drawdown is the weave, and
// any weave has a minimal draft (one shaft per distinct end, one treadle per distinct pick). Knits are stitch charts.
//
//   weave(kind, params) -> { w, h, cells: Uint8Array, kind }       WEAVES (kinds with parameter schemas)
//   jacquard(bitmap { w, h, data }, { figure, ground, threshold }) -> weave
//   drawdown({ threading, tieup, treadling, shafts, treadles }) -> weave
//   weaveToDraft(weave) -> draft                                     floats(weave) -> { warp, weft } longest floats
//   cell(weave, end, pick), tileWeave(weave, w, h), weaveEquals(a, b)
//   KNITS, knit(kind) -> { w, h, stitches: ['k' | 'p' | 't' | 'm' | 'x'] }
//
// Convention: cells[p * w + e] with e = warp end (column) and p = weft pick (row); 1 = warp up. All accessors wrap
// modulo the repeat, so a weave is an infinite periodic pattern and any window can be read without bounds checks.

export const WEAVES = {
  plain: [],
  twill: [{ key: 'up', min: 1, max: 6, def: 2 }, { key: 'down', min: 1, max: 6, def: 2 }, { key: 'dir', values: ['Z', 'S'], def: 'Z' }],
  herringbone: [{ key: 'up', min: 1, max: 4, def: 2 }, { key: 'down', min: 1, max: 4, def: 2 }, { key: 'period', min: 4, max: 24, def: 8 }],
  brokenTwill: [{ key: 'up', min: 1, max: 4, def: 2 }, { key: 'down', min: 1, max: 4, def: 2 }],
  satin: [{ key: 'shafts', min: 5, max: 12, def: 5 }, { key: 'move', min: 2, max: 7, def: 2 }, { key: 'face', values: ['warp', 'weft'], def: 'warp' }],
  basket: [{ key: 'n', min: 2, max: 4, def: 2 }],
  rib: [{ key: 'n', min: 2, max: 4, def: 2 }, { key: 'dir', values: ['warp', 'weft'], def: 'warp' }],
  hopsack: [{ key: 'n', min: 2, max: 4, def: 2 }],
  diamond: [{ key: 'size', min: 4, max: 12, def: 6 }],
};

const mk = (w, h, fn) => {
  const cells = new Uint8Array(w * h);
  for (let p = 0; p < h; p++) for (let e = 0; e < w; e++) cells[p * w + e] = fn(e, p) ? 1 : 0;
  return { w, h, cells };
};
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export function weave(kind = 'plain', o = {}) {
  // Parameters are not clamped here (WEAVES carries min / max for UIs); callers pass validated values.
  const P = (k, d) => (o[k] ?? d);
  let wv;
  switch (kind) {
    case 'twill': {
      const up = P('up', 2), down = P('down', 2), n = up + down, s = P('dir', 'Z') === 'S' ? -1 : 1;
      wv = mk(n, n, (e, p) => (((e - s * p) % n) + n) % n < up);
      break;
    }
    case 'herringbone': {
      const up = P('up', 2), down = P('down', 2), n = up + down, per = Math.max(n, P('period', 8));
      // Twill direction reverses every `per` ends, with a break of one step (a true herringbone).
      wv = mk(per * 2, n, (e, p) => {
        const z = e < per;
        const ee = z ? e : per * 2 - 1 - e + up; // mirrored, broken by `up` ends
        return (((ee - p) % n) + n) % n < up;
      });
      break;
    }
    case 'brokenTwill': {
      const up = P('up', 2), down = P('down', 2), n = up + down;
      wv = mk(n * 2, n, (e, p) => ((((e < n ? e - p : e + p + 1) % n) + n) % n) < up);
      break;
    }
      // A satin needs move m coprime to n and not +-1 (that would be a twill): then each end and each pick has exactly
      // one interlacing and no two are adjacent. Invalid moves are replaced by the first valid one.
    case 'satin': {
      const n = P('shafts', 5);
      let mv = P('move', 2);
      if (gcd(n, mv) !== 1 || mv === 1 || mv === n - 1) mv = [2, 3, 4, 5].find((m) => m < n - 1 && gcd(n, m) === 1) || 2;
      const warpFace = P('face', 'warp') === 'warp';
      wv = mk(n, n, (e, p) => ((e === (p * mv) % n) ? !warpFace : warpFace));
      break;
    }
    case 'basket': { const n = P('n', 2); wv = mk(2 * n, 2 * n, (e, p) => (Math.floor(e / n) + Math.floor(p / n)) % 2 === 0); break; }
    case 'rib': { const n = P('n', 2); wv = P('dir', 'warp') === 'warp' ? mk(2, 2 * n, (e, p) => (e + Math.floor(p / n)) % 2 === 0) : mk(2 * n, 2, (e, p) => (Math.floor(e / n) + p) % 2 === 0); break; }
      // Same matrix as basket: hopsack is the trade name of a basket weave, kept as a separate kind for presets.
    case 'hopsack': { const n = P('n', 2); wv = mk(2 * n, 2 * n, (e, p) => (Math.floor(e / n) + Math.floor(p / n)) % 2 === 0); break; }
    case 'diamond': {
      const s = P('size', 6), n = 2 * s;
      wv = mk(n, n, (e, p) => { const a = Math.abs(e - s + 0.5), b = Math.abs(p - s + 0.5); return (Math.floor(a + b) % 4) < 2; });
      break;
    }
    default: wv = mk(2, 2, (e, p) => (e + p) % 2 === 0); kind = 'plain';
  }
  wv.kind = kind;
  return wv;
}

export const cell = (wv, e, p) => wv.cells[(((p % wv.h) + wv.h) % wv.h) * wv.w + (((e % wv.w) + wv.w) % wv.w)];

export function tileWeave(wv, w, h) { return { ...mk(w, h, (e, p) => cell(wv, e, p)), kind: wv.kind }; }

// Compares over lcm(w) x lcm(h): two weaves with different repeat sizes can describe the same infinite pattern.
export function weaveEquals(a, b) {
  const w = a.w * b.w / gcd(a.w, b.w), h = a.h * b.h / gcd(a.h, b.h);
  for (let p = 0; p < h; p++) for (let e = 0; e < w; e++) if (cell(a, e, p) !== cell(b, e, p)) return false;
  return true;
}

// Jacquard: every bitmap pixel is a cell; dark pixels take the figure weave, light ones the ground weave (both
// tiled), so a picture appears by the contrast of warp-faced and weft-faced areas.
export function jacquard(bmp, o = {}) {
  const fig = o.figure || weave('satin', { shafts: 5, face: 'warp' });
  const gr = o.ground || weave('satin', { shafts: 5, face: 'weft' });
  const th = o.threshold ?? 128;
  const lum = (i) => { const d = bmp.data; return bmp.channels === 1 ? d[i] : 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; };
  const wv = mk(bmp.w, bmp.h, (e, p) => (lum(p * bmp.w + e) < th ? cell(fig, e, p) : cell(gr, e, p)));
  wv.kind = 'jacquard';
  return wv;
}

// Drawdown of a draft: warp end e is up on pick p when the shaft of e is tied to the treadle of p.
export function drawdown(d) {
  const w = d.threading.length, h = d.treadling.length;
  const wv = mk(w, h, (e, p) => {
    const sh = d.threading[e], tr = d.treadling[p];
    return sh >= 0 && tr >= 0 && d.tieup[sh][tr] === 1;
  });
  wv.kind = 'draft';
  return wv;
}

// Minimal draft of a weave: identical warp columns share a shaft, identical picks share a treadle.
// Minimal draft: dedupe identical columns (shafts) and rows (treadles) by string key. The tie-up is read from the
// first end / pick of each class. drawdown(weaveToDraft(w)) reproduces w exactly; the tests assert it for every kind.
export function weaveToDraft(wv) {
  const colKey = (e) => { let s = ''; for (let p = 0; p < wv.h; p++) s += wv.cells[p * wv.w + e]; return s; };
  const rowKey = (p) => { let s = ''; for (let e = 0; e < wv.w; e++) s += wv.cells[p * wv.w + e]; return s; };
  const shafts = new Map(), treadles = new Map();
  const threading = [], treadling = [];
  for (let e = 0; e < wv.w; e++) { const k = colKey(e); if (!shafts.has(k)) shafts.set(k, shafts.size); threading.push(shafts.get(k)); }
  for (let p = 0; p < wv.h; p++) { const k = rowKey(p); if (!treadles.has(k)) treadles.set(k, treadles.size); treadling.push(treadles.get(k)); }
  const shaftEnd = [...shafts.values()].map((s) => threading.indexOf(s));
  const treadlePick = [...treadles.values()].map((t) => treadling.indexOf(t));
  const tieup = shaftEnd.map((e) => treadlePick.map((p) => wv.cells[p * wv.w + e]));
  return { threading, tieup, treadling, shafts: shafts.size, treadles: treadles.size };
}

// Longest floats (a thread passing over consecutive crossings) of warp and weft over a repeat.
// Scans two repeats so a float that wraps across the repeat edge is measured whole; capped at the repeat length
// (an always-up end would otherwise count to 2h).
export function floats(wv) {
  let warp = 0, weft = 0;
  for (let e = 0; e < wv.w; e++) { let run = 0; for (let p = 0; p < wv.h * 2; p++) { run = cell(wv, e, p) ? run + 1 : 0; warp = Math.max(warp, Math.min(run, wv.h)); } }
  for (let p = 0; p < wv.h; p++) { let run = 0; for (let e = 0; e < wv.w * 2; e++) { run = cell(wv, e, p) ? 0 : run + 1; weft = Math.max(weft, Math.min(run, wv.w)); } }
  return { warp, weft };
}

// Share of warp on the face (0.5 plain, 1 warp-faced).
export const warpFace = (wv) => wv.cells.reduce((s, v) => s + v, 0) / wv.cells.length;

// --- knits -------------------------------------------------------------------------------------------------------

// Stitch charts (rows bottom to top): k knit, p purl, t tuck, m miss (float), x loop pile (terry / fleece back).
export const KNITS = {
  jersey: { w: 1, h: 1, rows: ['k'] },
  rib1x1: { w: 2, h: 1, rows: ['kp'] },
  rib2x2: { w: 4, h: 1, rows: ['kkpp'] },
  interlock: { w: 2, h: 2, rows: ['kp', 'pk'] },
  purl: { w: 1, h: 2, rows: ['k', 'p'] },
  pique: { w: 2, h: 4, rows: ['kk', 'tk', 'kk', 'kt'] },
  frenchTerry: { w: 4, h: 2, rows: ['kkkk', 'kxkx'] },
  fleece: { w: 2, h: 2, rows: ['kk', 'xx'] },
};
export function knit(kind = 'jersey') {
  const k = KNITS[kind] || KNITS.jersey;
  return { kind: KNITS[kind] ? kind : 'jersey', w: k.w, h: k.h, stitches: k.rows.flatMap((r) => [...r]) };
}
