// garment/grade.js - grading across sizes: since every pattern is drafted from measurements, a graded set is the same
// garment drafted for the bodies of the chart sizes (body/sizes.js sizeBody), so the shapes keep their proportions
// (armhole depth, neck width, sleeve cap) instead of being shifted by fixed grade rules. The grade report lists, per
// piece, the growth of its width, height and seam lengths from size to size.
//
//   gradeGarment(spec, sex, sizes = [eu, ...], { system }) -> [{ size, eu, draft }]
//   gradeReport(graded) -> [{ piece, widths: [], heights: [], steps: { w: [], h: [] } }]

import { childSizeBody, sizeBody, sizeLabel, sizeRows } from '../body/sizes.js';
import { draftMeasurements } from '../body/measure.js';
import { draftGarment } from './garments.js';
import { pieceArea, pieceBBox } from './piece.js';

//
// Grading by re-drafting rather than by grade rules (fixed increments per point): proportional parts (armhole depth,
// neck width) scale with the body as real bodies do, and any garment the drafter supports grades for free. The
// cost is one full draft per size, which is milliseconds.
// Default size run: five consecutive chart rows, centred near the person's own size (children by height).
export function gradeGarment(spec, sex, sizes, o = {}) {
  // children (o.age < 15) are graded over the height sizes round their own height
  const child = o.age != null && o.age < 15;
  const rows = sizeRows(child ? 'child' : sex);
  const near = child ? Math.max(0, Math.min(rows.length - 5, rows.findIndex((r) => r.height >= (o.height || 120)) - 2)) : 2;
  const list = sizes && sizes.length ? sizes : rows.slice(near, near + 5).map((r) => r.eu);
  return list.map((eu) => {
    const row = rows.find((r) => r.eu === Number(eu)) || rows[0];
    const m = draftMeasurements(child ? childSizeBody(sex, row.height) : sizeBody(sex, row.eu));
    return { size: sizeLabel(row, o.system || 'EU', sex), eu: row.eu, draft: draftGarment(spec, m) };
  });
}

// Steps between neighbouring sizes; uneven steps flag a drafting discontinuity (a formula switching branch between
// sizes), which grade rules would hide.
export function gradeReport(graded) {
  const ids = graded[0]?.draft.pieces.map((p) => p.id) || [];
  return ids.map((id) => {
    const boxes = graded.map((g) => g.draft.pieces.find((p) => p.id === id)).map((p) => (p ? pieceBBox(p) : null));
    const widths = boxes.map((b) => (b ? b.w : NaN)), heights = boxes.map((b) => (b ? b.h : NaN));
    const step = (a) => a.slice(1).map((v, i) => v - a[i]);
    const areas = graded.map((g) => g.draft.pieces.find((p) => p.id === id)).map((p) => (p ? pieceArea(p) : NaN));
    return { piece: id, widths, heights, areas, steps: { w: step(widths), h: step(heights), a: step(areas) } };
  });
}
