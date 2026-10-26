// carpet/symmetry.js - symmetry on a knot grid: whole-field symmetries (mirrors, rotations, the dihedral groups)
// and the 12 wallpaper groups that fit a rectangular or square lattice (p1, p2, pm, pg, cm, pmm, pmg, pgg, cmm, p4,
// p4m, p4g). The hexagonal groups (p3, p3m1, p31m, p6, p6m) need a 60° lattice, which a grid of knots does not have.
//
//   FIELD_SYMMETRIES ['none', 'mirrorX', 'mirrorY', 'mirrorXY', 'rot2', 'rot4', 'd4']
//   fieldFold(sym, x, y, w, h) -> [x, y]   a cell of a w × h field -> its representative in the fundamental region
//   WALLPAPER ['p1', 'p2', 'pm', 'pg', 'cm', 'pmm', 'pmg', 'pgg', 'cmm', 'p4', 'p4m', 'p4g']
//   wallpaperFold(group, x, y, tw, th) -> [u, v]   a cell of the plane -> coordinates in the fundamental region of a
//                                                  tw × th tile (u in [0, tw), v in [0, th); square groups use tw)
//   wallpaperFoldF(group, x, y, tw, th) -> [u, v]  the same for any point of the plane, continuous (compositions)
//   isSymmetric(get, w, h, sym) -> boolean  (tests)

export const FIELD_SYMMETRIES = ['none', 'mirrorX', 'mirrorY', 'mirrorXY', 'rot2', 'rot4', 'd4'];
export const WALLPAPER = ['p1', 'p2', 'pm', 'pg', 'cm', 'pmm', 'pmg', 'pgg', 'cmm', 'p4', 'p4m', 'p4g'];

// The orbit of a cell under a field symmetry (cell indices: mirror x maps x -> w - 1 - x, so even and odd sizes both
// work); rot4 and d4 need a square field and fall back to mirrorXY otherwise.
// Discrete maps on cell indices (w - 1 - x), not on coordinates: exact for both odd and even sizes with no
// rounding. rot4/d4 are only defined on a square, since a quarter turn maps a w x h rectangle onto h x w.
export function orbit(sym, x, y, w, h) {
  const fx = (p) => [w - 1 - p[0], p[1]], fy = (p) => [p[0], h - 1 - p[1]], r2 = (p) => [w - 1 - p[0], h - 1 - p[1]];
  const r4 = (p) => [w - 1 - p[1], p[0]], tr = (p) => [p[1], p[0]];
  const p = [x, y];
  const square = w === h;
  switch (sym) {
    case 'mirrorX': return [p, fx(p)];
    case 'mirrorY': return [p, fy(p)];
    case 'rot2': return [p, r2(p)];
    case 'mirrorXY': return [p, fx(p), fy(p), r2(p)];
    case 'rot4': return square ? [p, r4(p), r4(r4(p)), r4(r4(r4(p)))] : [p, fx(p), fy(p), r2(p)];
    case 'd4': return square ? [p, r4(p), r4(r4(p)), r4(r4(r4(p))), tr(p), fx(p), fy(p), tr(r2(p))] : [p, fx(p), fy(p), r2(p)];
    default: return [p];
  }
}

// The representative of a cell's orbit (the first cell in reading order): drawing only representatives and copying
// them makes any field exactly symmetric.
export function fieldFold(sym, x, y, w, h) {
  let best = null;
  for (const q of orbit(sym, x, y, w, h)) if (!best || q[1] < best[1] || (q[1] === best[1] && q[0] < best[0])) best = q;
  return best;
}

const mod = (a, n) => ((a % n) + n) % n;

// Folding of a cell centre into the fundamental region, returned as integer cell coordinates.
// Sampling at the cell CENTRE (+0.5) avoids boundary ambiguity: a cell edge lying exactly on a mirror axis would
// fold to two different cells depending on rounding. The result is clamped into the tile for float safety.
export function wallpaperFold(group, x, y, tw, th) {
  const [fu, fv] = wallpaperFoldF(group, x + 0.5, y + 0.5, tw, th);
  const W = tw, H = group.startsWith('p4') ? tw : th;
  return [Math.max(0, Math.min(W - 1, Math.floor(fu))), Math.max(0, Math.min(H - 1, Math.floor(fv)))];
}

// Continuous folding of a point of the plane into the fundamental region of a tw × th tile (square groups use tw).
// Each group = translation to one tile, then the group's point operations folding the tile onto its fundamental
// region: m(a, n) = min(a, n - a) is a mirror at n/2; glide reflections (pg, pmg, pgg) mirror AND shift by half a
// tile; centred groups (cm, cmm) shift every other row by half a tile width; p4 groups rotate by 90 degrees around
// the tile centre until the point lies in one quadrant, then p4m mirrors on the diagonal and p4g on the
// anti-diagonal of that quadrant.
export function wallpaperFoldF(group, x, y, tw, th) {
  const W = tw, H = group.startsWith('p4') ? tw : th;
  const row = Math.floor(y / H);
  let u = mod(x, W);
  const v = mod(y, H);
  if (group === 'cm' || group === 'cmm') { if (mod(row, 2) === 1) u = mod(u + W / 2, W); }
  const m = (a, n) => Math.min(a, n - a);
  let fu = u, fv = v;
  switch (group) {
    case 'p2': if (v >= H / 2) { fu = W - u; fv = H - v; } break;
    case 'pm': case 'cm': fu = m(u, W); break;
    case 'pg': if (v >= H / 2) { fu = W - u; fv = v - H / 2; } break;
    case 'pmm': case 'cmm': fu = m(u, W); fv = m(v, H); break;
    case 'pmg': if (v < H / 2) fu = m(u, W); else { fu = m(mod(u + W / 2, W), W); fv = H - v; } break;
    case 'pgg':
      if (u < W / 2 && v < H / 2) { /* fundamental */ }
      else if (u >= W / 2 && v < H / 2) { fu = u - W / 2; fv = H / 2 - v; }
      else if (u < W / 2) { fu = W / 2 - u; fv = v - H / 2; }
      else { fu = W - u; fv = H - v; }
      break;
    case 'p4': case 'p4m': case 'p4g': {
      let a = u - W / 2, b = v - W / 2;
      for (let k = 0; k < 4 && !(a >= 0 && b >= 0); k++) [a, b] = [b, -a];
      if (group === 'p4m' && b > a) [a, b] = [b, a];
      if (group === 'p4g' && a + b > W / 2) [a, b] = [W / 2 - b, W / 2 - a];
      fu = a; fv = b;
      break;
    }
    default: break;
  }
  return [fu, fv];
}

export function isSymmetric(get, w, h, sym) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = get(x, y);
    const checks = {
      mirrorX: [[w - 1 - x, y]], mirrorY: [[x, h - 1 - y]], mirrorXY: [[w - 1 - x, y], [x, h - 1 - y]], rot2: [[w - 1 - x, h - 1 - y]],
      rot4: w === h ? [[w - 1 - y, x]] : [[w - 1 - x, h - 1 - y]], d4: w === h ? [[w - 1 - x, y], [y, x]] : [[w - 1 - x, y], [x, h - 1 - y]],
    }[sym] || [];
    for (const [a, b] of checks) if (get(a, b) !== v) return false;
  }
  return true;
}
