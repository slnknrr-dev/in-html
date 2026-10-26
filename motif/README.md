# motif/

Print design for textiles: vector motifs, repeat patterns (block, half-drop, brick, mirror, rotate), colourways,
seamless tile rendering, colour separations for screen printing, SVG export, and placement prints positioned on
pattern pieces. Rendering uses its own pure rasterizer, so the same tile is produced in Node (mockups, tests) and in
the browser. (The folder is `motif/`, not `print/`, to stay clear of printing pages.)

```js
import { renderUnit, separations, designSVG, seamlessCheck } from '../motif/repeat.js';

const design = { w: 10, h: 10, repeat: 'halfDrop', layers: [{ motif: 'flower', x: 0.3, y: 0.3, size: 4, color: 1 }],
  colorways: [{ name: 'Garden', colors: ['#f6f1e7', '#d0425b'] }] };
const tile = renderUnit(design, { pxPerCm: 12 });  // { width, height, data (RGBA), cm: [20, 10] } - seamless
```

## Files

| file | contents |
| --- | --- |
| `raster.js` | `canvas`, `fillPolys` (anti-aliased, non-zero winding, affine map, wrap-around), `drawImage` (bilinear, wrap), affine helpers `trsM`, `mulM`, `applyM`, `invM`, `hexToRgb` |
| `motifs.js` | `MOTIFS` (dot, ring, star, heart, leaf, flower, diamond, triangle, cross, moon, drop, paisley, chevron, wave, square, hexagon) in a unit box, `motifPolys`, `motifPath` |
| `repeat.js` | `REPEATS`, `DEFAULT_DESIGN`, `normalizeDesign`, `repeatUnit`, `renderUnit`, `renderInto` (tiles a design over a piece texture), `separations`, `designSVG`, `seamlessCheck`, `normalizePlacement` |
| `test.js` | `node motif/test.js` |

## Model

A design is a base cell (`w` × `h` cm) holding motif layers `{ motif | 'image', x, y (fractions of the cell), size (cm),
aspect, rot, color (index into the colourway), opacity }`, a repeat type and colourways (lists of colours; index
`background` fills the ground). The repeat unit holds the cell copies: block (1 cell), half-drop (2 columns, the
second dropped by half a cell), brick (2 rows, shifted by half), mirror (2 × 2 reflected), rotate (2 × 2 quarter
turns of a square cell). Motifs crossing the unit edge are drawn again on the opposite side, so units are seamless;
`seamlessCheck` renders a 2 × 2 block directly and compares it with the copied unit. Separations render the design
with key colours and assign every pixel to its top colour index (masks that never overlap) with the coverage of each
screen. Placement prints are `{ piece, side, x, y, w, h, rot, art }` in the piece's centimetres; the garment texture
builder of the mockup library composes them into the same coordinates the 3D mesh uses.

## Limits

- Motifs are flat colours (no gradients or strokes); text placements are rendered by the application (canvas text).
- Separations are by colour index (spot colours), not halftones; anti-aliased edges go to the nearest key.
