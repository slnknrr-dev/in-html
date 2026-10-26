// carpet/estimate.js - what a rug needs: knots per colour, pile yarn (length and weight), warp and weft, knotting time,
// and the tufting alternative.
//
//   yarnEstimate(rug, { metersPerKg = 1600, knotsPerHour = 600, waste = 0.12, warpPerKnot = 2 }) -> {
//     knots, areaM2, colors: [{ role, hex, dye, knots, meters, grams }], pileGrams, warpMeters, weftMeters, hours,
//     tuftedGrams, finishedCm: [w, l] }
//
// A symmetric knot takes the pile twice (two tufts of pileMm) plus its wrap around two warps (about two knot widths);
// pile yarn of 1600 m/kg is a common two-ply rug wool. Warp: two warps per knot across, the length of the rug plus the
// fringe at both ends and 40 cm loom waste. Weft: two shoots after every row, 10 % take-up. Tufted: about 230 g of
// yarn per square metre and millimetre of pile.

// Rough planning numbers, not a bill of materials: all constants are typical values exposed as options. Knot width
// in mm is 25.4 / knots-per-inch; per-knot yarn = two pile tufts + the wrap (2.2 knot widths), plus waste.
export function yarnEstimate(rug, { metersPerKg = 1600, knotsPerHour = 600, waste = 0.12, warpPerKnot = 2 } = {}) {
  const counts = new Array(rug.palette.length).fill(0);
  for (const v of rug.cells) counts[v]++;
  const knotW = 25.4 / rug.kpiH; // mm
  const perKnotM = ((2 * rug.pileMm + 2.2 * knotW) / 1000) * (1 + waste);
  const colors = rug.palette.map((p, i) => ({ ...p, knots: counts[i], meters: counts[i] * perKnotM, grams: ((counts[i] * perKnotM) / metersPerKg) * 1000 })).filter((c) => c.knots > 0);
  const widthCm = (rug.width / rug.kpiH) * 2.54, lengthCm = (rug.height / rug.kpiV) * 2.54;
  const warpMeters = rug.width * warpPerKnot * ((lengthCm + 2 * rug.fringeCm + 40) / 100);
  const weftMeters = rug.height * 2 * (widthCm / 100) * 1.1;
  const knots = rug.width * rug.height;
  const areaM2 = (widthCm * lengthCm) / 10000;
  return {
    knots, areaM2, colors, pileGrams: colors.reduce((a, c) => a + c.grams, 0), warpMeters, weftMeters,
    hours: knots / knotsPerHour, tuftedGrams: areaM2 * rug.pileMm * 230, finishedCm: [Math.round(widthCm), Math.round(lengthCm)],
  };
}
